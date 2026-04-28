import type { CombatEvent, FrameCheck, RuntimeSnapshot, TestLog } from "../project/schema";
import type { TaskId, TransactionId } from "../shared/types";
import type { RuntimeWorld } from "../runtime/world";
import type { TraceSink } from "./telemetry";
import { combatEventExists, evaluateFrameChecks, frameChecksPass, matchesExpectation, readPath, type CheckEvaluation } from "./testAssertions";

export type InteractiveTestRunnerOptions = {
  world: RuntimeWorld;
  taskId?: TaskId;
  transactionId?: TransactionId;
  traceSink?: TraceSink;
  initialSnapshot?: RuntimeSnapshot;
};

export type InteractivePredicateContext = {
  world: RuntimeWorld;
  frame: number;
  snapshot: RuntimeSnapshot;
};

export type CaptureOptions = {
  checks?: FrameCheck[];
  freeze?: boolean;
  label?: string;
  recordSnapshot?: boolean;
};

export type CaptureResult = CheckEvaluation & {
  snapshot: RuntimeSnapshot;
};

export type StepUntilOptions = {
  maxFrames: number;
  checks?: FrameCheck[];
  predicate?: (context: InteractivePredicateContext) => boolean;
  label?: string;
  freezeOnMatch?: boolean;
  freezeOnTimeout?: boolean;
  recordSnapshot?: boolean;
};

export type StepUntilResult = {
  matched: boolean;
  frame: number;
  snapshot: RuntimeSnapshot;
  logs: TestLog[];
};

export class InteractiveTestRunner {
  private readonly logs: TestLog[] = [];
  private readonly snapshots: RuntimeSnapshot[] = [];
  private combatTraceCursor: number;

  constructor(private readonly options: InteractiveTestRunnerOptions) {
    if (options.initialSnapshot) {
      options.world.restoreSnapshot(options.initialSnapshot);
      this.snapshots.push(options.initialSnapshot);
    }
    this.combatTraceCursor = options.world.combatEvents.length;
  }

  get frame(): number {
    return this.options.world.clock.frame;
  }

  get timeMs(): number {
    return this.options.world.clock.timeMs;
  }

  get fixedStepMs(): number {
    return this.options.world.clock.fixedStepMs;
  }

  get recordedLogs(): TestLog[] {
    return [...this.logs];
  }

  get recordedSnapshots(): RuntimeSnapshot[] {
    return [...this.snapshots];
  }

  press(key: string): void {
    this.options.world.setInput(key, true);
    this.emit("input", "info", `press ${key}`);
  }

  release(key: string): void {
    this.options.world.setInput(key, false);
    this.emit("input", "info", `release ${key}`);
  }

  tap(key: string, frames = 1): void {
    const duration = Math.max(1, Math.floor(frames));
    this.press(key);
    this.step(duration);
    this.release(key);
  }

  step(frames = 1): void {
    const count = Math.max(0, Math.floor(frames));
    for (let index = 0; index < count; index += 1) {
      this.options.world.runFixedFrame();
      this.emitNewCombatEvents();
    }
  }

  capture(options: CaptureOptions = {}): CaptureResult {
    const snapshot = options.freeze ? this.options.world.freezeForInspection() : this.options.world.captureSnapshot();
    if (options.recordSnapshot !== false) this.snapshots.push(snapshot);
    const evaluation = options.checks ? evaluateFrameChecks(snapshot, options.checks, this.frame) : { passed: true, logs: [] };
    this.logs.push(...evaluation.logs);
    if (options.label) {
      const suffix = options.checks ? ` (${options.checks.length} checks)` : "";
      this.emit("test", evaluation.passed ? "info" : "warning", `${options.label}${suffix}`, { snapshotId: snapshot.id });
    }
    return { ...evaluation, snapshot };
  }

  assert(checks: FrameCheck[], options: Omit<CaptureOptions, "checks"> = {}): CaptureResult {
    return this.capture({ ...options, checks });
  }

  freeze(label?: string): RuntimeSnapshot {
    return this.capture({ freeze: true, label }).snapshot;
  }

  resume(): void {
    this.options.world.setMode("game");
    this.emit("test", "info", "resume game mode");
  }

  restore(snapshot: RuntimeSnapshot, restoreMode = true): void {
    this.options.world.restoreSnapshot(snapshot, restoreMode);
    this.emit("test", "info", `restore snapshot ${snapshot.id}`, { snapshotId: snapshot.id });
  }

  stepUntil(options: StepUntilOptions): StepUntilResult {
    if (!options.checks && !options.predicate) throw new Error("stepUntil requires checks or predicate");
    const maxFrames = Math.max(1, Math.floor(options.maxFrames));
    const label = options.label || "stepUntil";
    this.emit("test", "info", `${label} start`, { maxFrames });

    for (let index = 0; index < maxFrames; index += 1) {
      this.step(1);
      const snapshot = this.options.world.captureSnapshot();
      const predicateMatched = options.predicate ? options.predicate(this.context(snapshot)) : true;
      const checksMatched = options.checks ? frameChecksPass(snapshot, options.checks) : true;
      if (!predicateMatched || !checksMatched) continue;

      const finalSnapshot = options.freezeOnMatch ? this.options.world.freezeForInspection() : snapshot;
      if (options.recordSnapshot !== false) this.snapshots.push(finalSnapshot);
      const evaluation = options.checks ? evaluateFrameChecks(finalSnapshot, options.checks, this.frame) : { passed: true, logs: [] };
      this.logs.push(...evaluation.logs);
      this.emit("test", "info", `${label} matched`, { frame: this.frame, snapshotId: finalSnapshot.id });
      return { matched: true, frame: this.frame, snapshot: finalSnapshot, logs: evaluation.logs };
    }

    const timeoutSnapshot = options.freezeOnTimeout ? this.options.world.freezeForInspection() : this.options.world.captureSnapshot();
    if (options.recordSnapshot !== false) this.snapshots.push(timeoutSnapshot);
    const evaluation = options.checks ? evaluateFrameChecks(timeoutSnapshot, options.checks, this.frame) : { passed: false, logs: [] };
    const timeoutLog: TestLog = {
      level: "error",
      frame: this.frame,
      message: `${label}: no match within ${maxFrames} frames.`,
    };
    this.logs.push(timeoutLog, ...evaluation.logs);
    this.emit("test", "warning", `${label} timed out`, { frame: this.frame, snapshotId: timeoutSnapshot.id });
    return { matched: false, frame: this.frame, snapshot: timeoutSnapshot, logs: [timeoutLog, ...evaluation.logs] };
  }

  hasCombatEvent(expected: unknown): boolean {
    return combatEventExists(this.options.world.captureSnapshot(), expected);
  }

  findCombatEvent(expected: Partial<CombatEvent>): CombatEvent | undefined {
    return this.options.world.combatEvents.find((event) => {
      return Object.entries(expected).every(([key, value]) => {
        return matchesExpectation(readPath(event, key), value);
      });
    });
  }

  private context(snapshot: RuntimeSnapshot): InteractivePredicateContext {
    return {
      world: this.options.world,
      frame: this.frame,
      snapshot,
    };
  }

  private emit(
    channel: "input" | "test" | "combat",
    level: "debug" | "info" | "warning" | "error",
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.options.traceSink?.publish({
      channel,
      level,
      frame: this.frame,
      timeMs: this.timeMs,
      taskId: this.options.taskId,
      transactionId: this.options.transactionId,
      message,
      data,
    });
  }

  private emitNewCombatEvents(): void {
    const events = this.options.world.combatEvents.slice(this.combatTraceCursor);
    for (const event of events) {
      this.emit("combat", "info", event.message, {
        type: event.type,
        attackerId: event.attackerId,
        defenderId: event.defenderId,
        sourceId: event.sourceId,
        targetId: event.targetId,
      });
    }
    this.combatTraceCursor = this.options.world.combatEvents.length;
  }
}
