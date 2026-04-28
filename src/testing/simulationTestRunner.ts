import type { FrameCheck, InputScript, InputStep, RuntimeSnapshot, TestLog, TestRecord, TestTiming } from "../project/schema";
import { makeId } from "../shared/types";
import type { TaskId, TestRecordId, TransactionId } from "../shared/types";
import type { RuntimeWorld } from "../runtime/world";
import type { TraceSink } from "./telemetry";
import { evaluateFrameChecks } from "./testAssertions";

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

    for (let stepIndex = 0; stepIndex < options.script.steps.length; stepIndex += 1) {
      const step = options.script.steps[stepIndex];
      const rawStep = step as unknown;
      const startTick = options.world.clock.frame;
      const startTimeMs = options.world.clock.timeMs;
      let interrupted = false;

      switch (step.op) {
        case "wait": {
          const ticks = stepTicks(step, 0, scriptTickRate, worldTickRate);
          this.emit(options, "test", "debug", `wait ${ticks} ticks`);
          options.world.runFixedTicks(ticks);
          combatTraceCursor = this.emitNewCombatEvents(options, combatTraceCursor);
          break;
        }
        case "hold": {
          const ticks = stepTicks(step, 0, scriptTickRate, worldTickRate);
          this.emit(options, "input", "info", `hold ${step.key} for ${ticks} ticks`);
          options.world.setInput(step.key, true);
          options.world.runFixedTicks(ticks);
          options.world.setInput(step.key, false);
          combatTraceCursor = this.emitNewCombatEvents(options, combatTraceCursor);
          break;
        }
        case "tap": {
          const ticks = stepTicks(step, 1, scriptTickRate, worldTickRate);
          this.emit(options, "input", "info", `tap ${step.key} for ${ticks} ticks`);
          options.world.setInput(step.key, true);
          options.world.runFixedTicks(ticks);
          options.world.setInput(step.key, false);
          combatTraceCursor = this.emitNewCombatEvents(options, combatTraceCursor);
          break;
        }
        case "freezeAndInspect": {
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
          const evaluation = evaluateFrameChecks(snapshot, step.checks, options.world.clock.frame);
          logs.push(...evaluation.logs);
          if (!evaluation.passed && result === "passed") {
            result = "failed";
            failureSnapshotRef = snapshot.id;
          }
          options.world.setMode("game");
          break;
        }
        default: {
          const snapshot = options.world.freezeForInspection();
          const op = readUnknownStepOp(rawStep);
          const message = `Unsupported input step op "${op}" at index ${stepIndex}.`;
          snapshots.push(snapshot);
          logs.push({
            level: "error",
            frame: options.world.clock.frame,
            message,
          });
          this.emit(options, "test", "error", message, {
            stepIndex,
            op,
            snapshotId: snapshot.id,
          });
          result = "interrupted";
          failureSnapshotRef = snapshot.id;
          interrupted = true;
          break;
        }
      }

      timings.push(createTiming(step, stepIndex, startTick, startTimeMs, options.world.clock.frame, options.world.clock.timeMs, timeScale));
      if (interrupted) break;
    }

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

function readUnknownStepOp(step: unknown): string {
  if (!step || typeof step !== "object" || !("op" in step)) return "unknown";
  return String((step as { op?: unknown }).op ?? "unknown");
}

function timingLabel(step: InputStep): string {
  if (step.op === "wait") return "Wait";
  if (step.op === "hold") return `Hold ${step.key}`;
  if (step.op === "tap") return `Tap ${step.key}`;
  return "Freeze and inspect";
}
