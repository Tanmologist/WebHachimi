import type { FrameCheck, InputScript, InputStep, RuntimeSnapshot, TargetRef, TestLog, TestRecord, TestTiming } from "../project/schema";
import { makeId } from "../shared/types";
import type { TaskId, TestRecordId, TransactionId } from "../shared/types";
import type { RuntimeWorld } from "../runtime/world";
import type { TraceSink } from "./telemetry";

export type SimulationTestOptions = {
  taskId?: TaskId;
  transactionId?: TransactionId;
  world: RuntimeWorld;
  script: InputScript;
  initialSnapshot?: RuntimeSnapshot;
};

export type SimulationTestResult = {
  record: TestRecord;
  snapshots: RuntimeSnapshot[];
};

export type SimulationTestRunnerOptions = {
  traceSink?: TraceSink;
  timeScale?: number;
};

type CheckEvaluation = {
  passed: boolean;
  logs: TestLog[];
};

export class SimulationTestRunner {
  constructor(private readonly options: SimulationTestRunnerOptions = {}) {}

  run(options: SimulationTestOptions): SimulationTestResult {
    const logs: TestLog[] = [];
    const checks: FrameCheck[] = [];
    const timings: TestTiming[] = [];
    const snapshots: RuntimeSnapshot[] = [];
    const initialSnapshotRef = options.initialSnapshot?.id;
    if (options.initialSnapshot) snapshots.push(options.initialSnapshot);
    let result: TestRecord["result"] = "passed";
    let failureSnapshotRef = undefined as TestRecord["failureSnapshotRef"];
    let combatTraceCursor = options.world.combatEvents.length;
    const worldTickRate = Math.round(1000 / options.world.clock.fixedStepMs);
    const scriptTickRate = normalizedTickRate(options.script.tickRate) ?? worldTickRate;
    const timeScale = normalizedTimeScale(options.script.timeScale ?? this.options.timeScale);
    if (options.script.tickRate !== undefined && scriptTickRate !== worldTickRate) {
      logs.push({
        level: "warning",
        frame: options.world.clock.frame,
        message: `Input script tickRate ${scriptTickRate} was converted to world tickRate ${worldTickRate}.`,
      });
      this.emit(options, "test", "warning", `convert script tickRate ${scriptTickRate} to world tickRate ${worldTickRate}`);
    }

    options.script.steps.forEach((step, stepIndex) => {
      const startTick = options.world.clock.frame;
      const startTimeMs = options.world.clock.timeMs;
      if (step.op === "wait") {
        const ticks = stepTicks(step, 0, scriptTickRate, worldTickRate);
        this.emit(options, "test", "debug", `wait ${ticks} ticks`);
        options.world.runFixedTicks(ticks);
        combatTraceCursor = this.emitNewCombatEvents(options, combatTraceCursor);
      } else if (step.op === "hold") {
        const ticks = stepTicks(step, 0, scriptTickRate, worldTickRate);
        this.emit(options, "input", "info", `hold ${step.key} for ${ticks} ticks`);
        options.world.setInput(step.key, true);
        options.world.runFixedTicks(ticks);
        options.world.setInput(step.key, false);
        combatTraceCursor = this.emitNewCombatEvents(options, combatTraceCursor);
      } else if (step.op === "tap") {
        const ticks = stepTicks(step, 1, scriptTickRate, worldTickRate);
        this.emit(options, "input", "info", `tap ${step.key} for ${ticks} ticks`);
        options.world.setInput(step.key, true);
        options.world.runFixedTicks(ticks);
        options.world.setInput(step.key, false);
        combatTraceCursor = this.emitNewCombatEvents(options, combatTraceCursor);
      } else if (step.op === "freezeAndInspect") {
        const snapshot = options.world.freezeForInspection();
        snapshots.push(snapshot);
        checks.push(...step.checks);
        logs.push({
          level: "info",
          frame: options.world.clock.frame,
          message: `Frozen for ${step.checks.length} checks at ${snapshot.id}.`,
        });
        this.emit(options, "test", "info", `freeze and inspect ${step.checks.length} checks`, {
          snapshotId: snapshot.id,
        });
        const evaluation = evaluateChecks(snapshot, step.checks, options.world.clock.frame);
        logs.push(...evaluation.logs);
        if (!evaluation.passed && result === "passed") {
          result = "failed";
          failureSnapshotRef = snapshot.id;
        }
        options.world.setMode("game");
      }
      timings.push(createTiming(step, stepIndex, startTick, startTimeMs, options.world.clock.frame, options.world.clock.timeMs, timeScale));
    });

    return {
      record: {
        id: makeId<"TestRecordId">("test") as TestRecordId,
        taskId: options.taskId,
        transactionId: options.transactionId,
        script: options.script,
        result,
        frameChecks: checks,
        initialSnapshotRef,
        failureSnapshotRef,
        snapshotRefs: snapshots.map((snapshot) => snapshot.id),
        logs,
        timings,
        tickRate: worldTickRate,
        scriptTickRate,
        timeScale,
        timeScaleMode: options.script.timeScaleMode,
        timeScaleReason: options.script.timeScaleReason,
        createdAt: new Date().toISOString(),
      },
      snapshots,
    };
  }

  private emit(
    options: SimulationTestOptions,
    channel: "input" | "test" | "combat",
    level: "debug" | "info" | "warning" | "error",
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.options.traceSink?.publish({
      channel,
      level,
      frame: options.world.clock.frame,
      timeMs: options.world.clock.timeMs,
      taskId: options.taskId,
      transactionId: options.transactionId,
      message,
      data,
    });
  }

  private emitNewCombatEvents(options: SimulationTestOptions, cursor: number): number {
    const events = options.world.combatEvents.slice(cursor);
    for (const event of events) {
      this.options.traceSink?.publish({
        channel: "combat",
        level: "info",
        frame: event.frame,
        timeMs: event.frame * options.world.clock.fixedStepMs,
        taskId: options.taskId,
        transactionId: options.transactionId,
        message: event.message,
        data: {
        type: event.type,
        attackerId: event.attackerId,
        defenderId: event.defenderId,
        sourceId: event.sourceId,
        targetId: event.targetId,
        },
      });
    }
    return options.world.combatEvents.length;
  }
}

function stepTicks(
  step: Extract<InputStep, { op: "wait" | "hold" | "tap" }>,
  fallback = 0,
  scriptTickRate: number,
  worldTickRate: number,
): number {
  if (step.ticks !== undefined) return convertTicks(step.ticks, scriptTickRate, worldTickRate);
  if (step.frames !== undefined) return convertTicks(step.frames, 60, worldTickRate);
  return convertTicks(fallback, worldTickRate, worldTickRate);
}

function convertTicks(value: number, fromTickRate: number, toTickRate: number): number {
  const sourceTicks = Math.max(0, Math.floor(value));
  if (sourceTicks === 0) return 0;
  if (fromTickRate === toTickRate) return sourceTicks;
  return Math.max(1, Math.round((sourceTicks * toTickRate) / fromTickRate));
}

function normalizedTickRate(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || !value || value <= 0) return undefined;
  return Math.max(1, Math.round(value));
}

function normalizedTimeScale(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? value : 1;
}

function createTiming(
  step: InputStep,
  stepIndex: number,
  startTick: number,
  startTimeMs: number,
  endTick: number,
  endTimeMs: number,
  timeScale: number,
): TestTiming {
  const durationMs = Math.max(0, endTimeMs - startTimeMs);
  return {
    stepIndex,
    op: step.op,
    key: "key" in step ? step.key : undefined,
    label: timingLabel(step),
    startTick,
    endTick,
    durationTicks: Math.max(0, endTick - startTick),
    startTimeMs,
    endTimeMs,
    durationMs,
    scaledStartTimeMs: startTimeMs * timeScale,
    scaledEndTimeMs: endTimeMs * timeScale,
    scaledDurationMs: durationMs * timeScale,
    timeScale,
  };
}

function timingLabel(step: InputStep): string {
  if (step.op === "wait") return "等待";
  if (step.op === "hold") return `按住 ${step.key}`;
  if (step.op === "tap") return `点击 ${step.key}`;
  return "冻结检查";
}

function evaluateChecks(snapshot: RuntimeSnapshot, checks: FrameCheck[], frame: number): CheckEvaluation {
  const logs: TestLog[] = [];
  let passed = true;

  for (const check of checks) {
    const context = resolveTarget(snapshot, check.target);
    for (const [key, expected] of Object.entries(check.expect)) {
      const expectedValue = key === "combatEvent" ? true : expected;
      const actual = key === "exists" ? context.exists : key === "combatEvent" ? hasCombatEvent(snapshot, expected) : readPath(context.value, key);
      if (!matchesExpectation(actual, expectedValue)) {
        passed = false;
        logs.push({
          level: "error",
          frame,
          message: `${check.label}: expected ${key} to be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
        });
      }
    }
  }

  return { passed, logs };
}

function resolveTarget(snapshot: RuntimeSnapshot, target: TargetRef): { exists: boolean; value: unknown } {
  if (target.kind === "scene") return { exists: target.sceneId === snapshot.sceneId, value: { sceneId: snapshot.sceneId } };
  if (target.kind === "entity") {
    const entity = snapshot.entities[target.entityId];
    return { exists: Boolean(entity), value: entity };
  }
  if (target.kind === "area") return { exists: target.sceneId === snapshot.sceneId, value: target.rect };
  if (target.kind === "runtime") return { exists: !target.sceneId || target.sceneId === snapshot.sceneId, value: snapshot };
  return { exists: false, value: undefined };
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function matchesExpectation(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number" && typeof actual === "number") return Math.abs(actual - expected) < 0.0001;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function hasCombatEvent(snapshot: RuntimeSnapshot, expected: unknown): boolean {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return false;
  const partial = expected as Record<string, unknown>;
  return snapshot.combatEvents.some((event) => {
    return Object.entries(partial).every(([key, value]) => {
      return JSON.stringify((event as unknown as Record<string, unknown>)[key]) === JSON.stringify(value);
    });
  });
}
