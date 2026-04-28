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
  timeScale?: number;
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

export type TimeQuantization = "floor" | "ceil" | "nearest";

export type InteractiveTimeCursor = {
  frame: number;
  timeMs: number;
  scaledTimeMs: number;
  fixedStepMs: number;
  scaledFixedStepMs: number;
  timeScale: number;
};

export type TimeBookmark = InteractiveTimeCursor & {
  label: string;
  snapshot: RuntimeSnapshot;
};

export type SeekOptions = {
  allowRewind?: boolean;
  freezeOnArrival?: boolean;
  captureOnArrival?: boolean;
};

export type SeekTimeOptions = SeekOptions & {
  rounding?: TimeQuantization;
};

export type SeekResult = InteractiveTimeCursor & {
  rewound: boolean;
  snapshot?: RuntimeSnapshot;
  rewindBookmark?: string;
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
  private readonly bookmarks = new Map<string, TimeBookmark>();
  private readonly timelineScale: number;
  private combatTraceCursor: number;

  constructor(private readonly options: InteractiveTestRunnerOptions) {
    this.timelineScale = normalizeTimeScale(options.timeScale);
    if (options.initialSnapshot) {
      options.world.restoreSnapshot(options.initialSnapshot);
      this.snapshots.push(options.initialSnapshot);
    }
    this.rememberBookmark("__initial__", options.initialSnapshot || options.world.captureSnapshot());
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

  get scaledTimeMs(): number {
    return this.toScaledTimeMs(this.timeMs);
  }

  get scaledFixedStepMs(): number {
    return this.fixedStepMs * this.timelineScale;
  }

  get timeScale(): number {
    return this.timelineScale;
  }

  get recordedLogs(): TestLog[] {
    return [...this.logs];
  }

  get recordedSnapshots(): RuntimeSnapshot[] {
    return [...this.snapshots];
  }

  currentTime(): InteractiveTimeCursor {
    return {
      frame: this.frame,
      timeMs: this.timeMs,
      scaledTimeMs: this.scaledTimeMs,
      fixedStepMs: this.fixedStepMs,
      scaledFixedStepMs: this.scaledFixedStepMs,
      timeScale: this.timelineScale,
    };
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

  bookmark(label: string, options: Omit<CaptureOptions, "checks"> = {}): TimeBookmark {
    const snapshot = this.capture({
      ...options,
      label: options.label || `bookmark ${label}`,
    }).snapshot;
    const bookmark = this.rememberBookmark(label, snapshot);
    this.emit("test", "info", `bookmark ${label}`, {
      snapshotId: snapshot.id,
      frame: bookmark.frame,
      scaledTimeMs: bookmark.scaledTimeMs,
    });
    return bookmark;
  }

  getBookmark(label: string): TimeBookmark | undefined {
    return this.bookmarks.get(label);
  }

  resume(): void {
    this.options.world.setMode("game");
    this.emit("test", "info", "resume game mode");
  }

  restore(snapshot: RuntimeSnapshot, restoreMode = true): void {
    this.options.world.restoreSnapshot(snapshot, restoreMode);
    this.combatTraceCursor = this.options.world.combatEvents.length;
    this.emit("test", "info", `restore snapshot ${snapshot.id}`, { snapshotId: snapshot.id });
  }

  restoreBookmark(label: string, restoreMode = true): TimeBookmark {
    const bookmark = this.bookmarks.get(label);
    if (!bookmark) throw new Error(`bookmark not found: ${label}`);
    this.restore(bookmark.snapshot, restoreMode);
    this.emit("test", "info", `restore bookmark ${label}`, {
      snapshotId: bookmark.snapshot.id,
      frame: bookmark.frame,
      scaledTimeMs: bookmark.scaledTimeMs,
    });
    return bookmark;
  }

  seekToFrame(targetFrame: number, options: SeekOptions = {}): SeekResult {
    const desiredFrame = Math.max(0, Math.floor(targetFrame));
    let rewound = false;
    let rewindBookmark: TimeBookmark | undefined;

    if (desiredFrame < this.frame) {
      if (!options.allowRewind) {
        throw new Error(`cannot seek backward from frame ${this.frame} to ${desiredFrame} without allowRewind`);
      }
      rewindBookmark = this.findBookmarkAtOrBefore(desiredFrame);
      if (!rewindBookmark) throw new Error(`no bookmark available at or before frame ${desiredFrame}`);
      this.restore(rewindBookmark.snapshot);
      rewound = true;
    }

    if (desiredFrame > this.frame) this.step(desiredFrame - this.frame);

    const snapshot = this.captureArrivalSnapshot(options);
    const cursor = this.currentTime();
    this.emit("test", "info", `seek frame ${desiredFrame}`, {
      rewound,
      rewindBookmark: rewindBookmark?.label,
      snapshotId: snapshot?.id,
      scaledTimeMs: cursor.scaledTimeMs,
    });
    return {
      ...cursor,
      rewound,
      snapshot,
      rewindBookmark: rewindBookmark?.label,
    };
  }

  seekToTimeMs(targetTimeMs: number, options: SeekTimeOptions = {}): SeekResult {
    const desiredTimeMs = Math.max(0, targetTimeMs);
    return this.seekToFrame(this.quantizeTimeToFrame(desiredTimeMs, options.rounding), options);
  }

  seekToScaledTimeMs(targetScaledTimeMs: number, options: SeekTimeOptions = {}): SeekResult {
    const desiredScaledMs = Math.max(0, targetScaledTimeMs);
    return this.seekToTimeMs(desiredScaledMs / this.timelineScale, options);
  }

  stepScaledDuration(durationScaledMs: number, options: SeekTimeOptions = {}): SeekResult {
    const nextScaledTimeMs = this.scaledTimeMs + Math.max(0, durationScaledMs);
    return this.seekToScaledTimeMs(nextScaledTimeMs, options);
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

  private captureArrivalSnapshot(options: SeekOptions): RuntimeSnapshot | undefined {
    if (options.freezeOnArrival) {
      const snapshot = this.options.world.freezeForInspection();
      this.snapshots.push(snapshot);
      return snapshot;
    }
    if (options.captureOnArrival) {
      const snapshot = this.options.world.captureSnapshot();
      this.snapshots.push(snapshot);
      return snapshot;
    }
    return undefined;
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

  private rememberBookmark(label: string, snapshot: RuntimeSnapshot): TimeBookmark {
    const bookmark: TimeBookmark = {
      label,
      snapshot,
      frame: snapshot.frame,
      timeMs: snapshot.timeMs,
      scaledTimeMs: this.toScaledTimeMs(snapshot.timeMs),
      fixedStepMs: this.fixedStepMs,
      scaledFixedStepMs: this.scaledFixedStepMs,
      timeScale: this.timelineScale,
    };
    this.bookmarks.set(label, bookmark);
    return bookmark;
  }

  private findBookmarkAtOrBefore(frame: number): TimeBookmark | undefined {
    let best: TimeBookmark | undefined;
    for (const bookmark of this.bookmarks.values()) {
      if (bookmark.frame > frame) continue;
      if (!best || bookmark.frame > best.frame) best = bookmark;
    }
    return best;
  }

  private quantizeTimeToFrame(timeMs: number, rounding: TimeQuantization = "nearest"): number {
    const rawFrame = timeMs / this.fixedStepMs;
    if (rounding === "floor") return Math.max(0, Math.floor(rawFrame));
    if (rounding === "ceil") return Math.max(0, Math.ceil(rawFrame));
    return Math.max(0, Math.round(rawFrame));
  }

  private toScaledTimeMs(timeMs: number): number {
    return timeMs * this.timelineScale;
  }
}

function normalizeTimeScale(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? value : 1;
}
