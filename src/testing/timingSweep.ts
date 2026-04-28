import { err, makeId, ok, type EntityId, type Result, type Vec2 } from "../shared/types";
import type {
  CombatEvent,
  FrameCheck,
  InputScript,
  InputStep,
  RuntimeSnapshot,
  Scene,
  TargetRef,
  TestLog,
  TestRecord,
  TestTimeScaleMode,
  TestTiming,
} from "../project/schema";
import { RuntimeWorld } from "../runtime/world";
import { InteractiveTestRunner } from "./interactiveTestRunner";
import { MemoryTraceSink, summarizeTraceForAi } from "./telemetry";
import type { TaskId, TestRecordId, TransactionId } from "../shared/types";

export type TimelineActor = {
  id: EntityId;
  role: "player" | "enemy" | "projectile" | "system";
};

export type TimelineInput = {
  actorId: EntityId;
  key: string;
  frame: number;
  durationFrames: number;
};

export type CombatProbe = {
  frame: number;
  label: string;
  checks: FrameCheck[];
};

export type FrameTimeline = {
  actors: TimelineActor[];
  inputs: TimelineInput[];
  probes: CombatProbe[];
  totalFrames: number;
};

export type ReactionWindowSweepConfig = {
  attackerId: EntityId;
  defenderId: EntityId;
  attackKey: string;
  defenseKey: string;
  attackStartFrame: number;
  expectedImpactFrame: number;
  defenseOffsets: number[];
  defenderTarget: TargetRef;
  successChecks: FrameCheck[];
};

export type ReactionWindowCase = {
  label: string;
  defenseOffset: number;
  timeline: FrameTimeline;
  script: InputScript;
};

export type ReactionWindowSweepRunOptions = {
  scene: Scene;
  config: ReactionWindowSweepConfig;
  taskId?: TaskId;
  transactionId?: TransactionId;
  traceLimit?: number;
};

export type ReactionWindowSweepCaseResult = {
  label: string;
  defenseOffset: number;
  status: "passed" | "failed" | "interrupted";
  testRecordId: TestRecordId;
  failureSnapshotRef?: TestRecord["failureSnapshotRef"];
  traceSummary: string;
  logs: TestLog[];
  script: InputScript;
};

export type ReactionWindowSweepRunResult = {
  status: "passed" | "failed";
  cases: ReactionWindowSweepCaseResult[];
};

export type ScriptedReactionPlanConfig = {
  attackerId: EntityId;
  defenderId: EntityId;
  attackKey: string;
  defenseKey: string;
  attackStartFrame: number;
  defenseOffset: number;
  defenderTarget: TargetRef;
  successChecks: FrameCheck[];
  maxProbeFrames?: number;
  testTimeScale?: number | "auto";
  initialSnapshot?: RuntimeSnapshot;
};

export type ScriptedReactionPlan = {
  impactFrame: number;
  attackInputFrame: number;
  attackStartedFrame?: number;
  defenseInputFrame: number;
  defenseOffset: number;
  probeFrame: number;
  timeline: FrameTimeline;
  script: InputScript;
  timeScale: number;
  timeScaleMode: TestTimeScaleMode;
  timeScaleReason: string;
  calculationSummary: string;
};

export type ScriptedReactionRunResult = {
  status: "passed" | "failed" | "interrupted";
  plan: ScriptedReactionPlan;
  record: TestRecord;
  testRecordId: TestRecordId;
  traceSummary: string;
  logs: TestLog[];
  timings: TestTiming[];
  snapshots: RuntimeSnapshot[];
  tickRate: number;
  timeScale: number;
  timeScaleMode?: TestTimeScaleMode;
  timeScaleReason?: string;
  script: InputScript;
};

export type GestureIntent = {
  startFrame: number;
  points: Vec2[];
  meaning: string;
};

export function buildReactionWindowSweep(config: ReactionWindowSweepConfig): ReactionWindowCase[] {
  return config.defenseOffsets.map((offset) => {
    const defenseFrame = Math.max(0, config.expectedImpactFrame + offset);
    const timeline: FrameTimeline = {
      actors: [
        { id: config.attackerId, role: "enemy" },
        { id: config.defenderId, role: "player" },
      ],
      inputs: [
        {
          actorId: config.attackerId,
          key: config.attackKey,
          frame: config.attackStartFrame,
          durationFrames: 1,
        },
        {
          actorId: config.defenderId,
          key: config.defenseKey,
          frame: defenseFrame,
          durationFrames: 1,
        },
      ],
      probes: [
        {
          frame: config.expectedImpactFrame + 1,
          label: `inspect defense offset ${offset}`,
          checks: config.successChecks,
        },
      ],
      totalFrames: Math.max(config.expectedImpactFrame + 8, defenseFrame + 8),
    };
    return {
      label: `defense ${offset >= 0 ? "+" : ""}${offset}f`,
      defenseOffset: offset,
      timeline,
      script: compileTimelineToInputScript(timeline, config.defenderTarget),
    };
  });
}

export function runReactionWindowSweep(options: ReactionWindowSweepRunOptions): ReactionWindowSweepRunResult {
  const cases = buildReactionWindowSweep(options.config);
  const results = cases.map((testCase) => {
    const traceSink = new MemoryTraceSink();
    const execution = executeInteractiveTimeline({
      scene: options.scene,
      taskId: options.taskId,
      transactionId: options.transactionId,
      traceSink,
      timeline: testCase.timeline,
      script: testCase.script,
      fallbackTarget: options.config.defenderTarget,
    });
    const record = execution.record;

    return {
      label: testCase.label,
      defenseOffset: testCase.defenseOffset,
      status: record.result,
      testRecordId: record.id,
      failureSnapshotRef: record.failureSnapshotRef,
      traceSummary: summarizeTraceForAi(traceSink.drain(), options.traceLimit),
      logs: record.logs,
      script: testCase.script,
    };
  });

  return {
    status: results.every((result) => result.status === "passed") ? "passed" : "failed",
    cases: results,
  };
}

export function planScriptedReaction(scene: Scene, config: ScriptedReactionPlanConfig): Result<ScriptedReactionPlan> {
  const impact = findFirstImpactFrame(scene, config);
  if (!impact) {
    return err(`could not calculate impact tick within ${config.maxProbeFrames ?? 90} ticks`);
  }

  const defenseInputFrame = Math.max(0, impact.frame - 1 + config.defenseOffset);
  const timeline: FrameTimeline = {
    actors: [
      { id: config.attackerId, role: "enemy" },
      { id: config.defenderId, role: "player" },
    ],
    inputs: [
      {
        actorId: config.attackerId,
        key: config.attackKey,
        frame: config.attackStartFrame,
        durationFrames: 1,
      },
      {
        actorId: config.defenderId,
        key: config.defenseKey,
        frame: defenseInputFrame,
        durationFrames: 1,
      },
    ],
    probes: [
      {
        frame: impact.frame,
        label: `scripted reaction check at tick ${impact.frame}`,
        checks: config.successChecks,
      },
    ],
    totalFrames: Math.max(impact.frame + 8, defenseInputFrame + 8),
  };
  const tickRate = scene.settings.tickRate || Math.round(1000 / scene.settings.fixedStepMs);
  const timeScaleDecision = chooseTestTimeScale(
    scene,
    config,
    impact.frame,
    defenseInputFrame,
    Math.max(0, timeline.totalFrames - (config.initialSnapshot?.frame ?? 0)),
    tickRate,
  );
  const script: InputScript = {
    ...compileTimelineToInputScript(timeline, config.defenderTarget, config.initialSnapshot?.frame ?? 0),
    tickRate,
    timeScale: timeScaleDecision.timeScale,
    timeScaleMode: timeScaleDecision.mode,
    timeScaleReason: timeScaleDecision.reason,
  };
  return ok({
    impactFrame: impact.frame,
    attackInputFrame: config.attackStartFrame,
    attackStartedFrame: impact.attackStartedFrame,
    defenseInputFrame,
    defenseOffset: config.defenseOffset,
    probeFrame: impact.frame,
    timeline,
    script,
    timeScale: timeScaleDecision.timeScale,
    timeScaleMode: timeScaleDecision.mode,
    timeScaleReason: timeScaleDecision.reason,
    calculationSummary: [
      `attack input tick ${config.attackStartFrame}`,
      impact.attackStartedFrame === undefined ? undefined : `attack started tick ${impact.attackStartedFrame}`,
      `${impact.event.type} impact tick ${impact.frame}`,
      `defense input tick ${defenseInputFrame}`,
      `${timeScaleDecision.mode === "ai-auto" ? "AI auto" : "manual"} slow scale ${timeScaleDecision.timeScale}x`,
    ]
      .filter(Boolean)
      .join(" / "),
  });
}

export function runScriptedReactionPlan(options: {
  scene: Scene;
  config: ScriptedReactionPlanConfig;
  taskId?: TaskId;
  transactionId?: TransactionId;
  traceLimit?: number;
}): Result<ScriptedReactionRunResult> {
  const planned = planScriptedReaction(options.scene, options.config);
  if (!planned.ok) return planned;
  const traceSink = new MemoryTraceSink();
  const testResult = executeInteractiveTimeline({
    scene: options.scene,
    taskId: options.taskId,
    transactionId: options.transactionId,
    traceSink,
    timeline: planned.value.timeline,
    script: planned.value.script,
    initialSnapshot: options.config.initialSnapshot,
    fallbackTarget: options.config.defenderTarget,
  });
  const record = testResult.record;
  return ok({
    status: record.result,
    plan: planned.value,
    record,
    testRecordId: record.id,
    traceSummary: summarizeTraceForAi(traceSink.drain(), options.traceLimit),
    logs: record.logs,
    timings: record.timings || [],
    snapshots: testResult.snapshots,
    tickRate: record.tickRate || planned.value.script.tickRate || 100,
    timeScale: record.timeScale || planned.value.script.timeScale || 1,
    timeScaleMode: record.timeScaleMode || planned.value.script.timeScaleMode,
    timeScaleReason: record.timeScaleReason || planned.value.script.timeScaleReason,
    script: planned.value.script,
  });
}

function executeInteractiveTimeline(options: {
  scene: Scene;
  timeline: FrameTimeline;
  script: InputScript;
  fallbackTarget: TargetRef;
  taskId?: TaskId;
  transactionId?: TransactionId;
  traceSink?: MemoryTraceSink;
  initialSnapshot?: RuntimeSnapshot;
}): { record: TestRecord; snapshots: RuntimeSnapshot[] } {
  const world = new RuntimeWorld({ scene: options.scene });
  const controller = new InteractiveTestRunner({
    world,
    taskId: options.taskId,
    transactionId: options.transactionId,
    traceSink: options.traceSink,
    initialSnapshot: options.initialSnapshot,
  });
  const checks: FrameCheck[] = [];
  const logs: TestLog[] = [];
  const timings: TestTiming[] = [];
  const worldTickRate = Math.round(1000 / world.clock.fixedStepMs);
  const scriptTickRate = normalizedTickRate(options.script.tickRate) ?? worldTickRate;
  const timeScale = normalizedTimeScale(options.script.timeScale);
  const initialSnapshotRef = options.initialSnapshot?.id;
  let result: TestRecord["result"] = "passed";
  let failureSnapshotRef = undefined as TestRecord["failureSnapshotRef"];
  let cursor = controller.frame;

  if (options.script.tickRate !== undefined && scriptTickRate !== worldTickRate) {
    logs.push({
      level: "warning",
      frame: controller.frame,
      message: `Input script tickRate ${scriptTickRate} was converted to world tickRate ${worldTickRate}.`,
    });
  }

  const inputs = [...options.timeline.inputs].sort((left, right) => left.frame - right.frame);
  const probes = [...options.timeline.probes].sort((left, right) => left.frame - right.frame);
  const markers = [
    ...inputs.map((input) => ({ frame: input.frame, input })),
    ...probes.map((probe) => ({ frame: probe.frame, probe })),
  ].sort((left, right) => left.frame - right.frame);

  for (const marker of markers) {
    if (marker.frame > cursor) {
      const startTick = controller.frame;
      const startTimeMs = controller.timeMs;
      controller.step(marker.frame - cursor);
      timings.push(createTimingRecord({ op: "wait", ticks: marker.frame - cursor }, timings.length, startTick, startTimeMs, controller.frame, controller.timeMs, timeScale));
      cursor = controller.frame;
    }

    if ("input" in marker && marker.input) {
      const startTick = controller.frame;
      const startTimeMs = controller.timeMs;
      controller.tap(actorScopedKey(marker.input.actorId, marker.input.key), marker.input.durationFrames);
      timings.push(
        createTimingRecord(
          { op: "tap", key: actorScopedKey(marker.input.actorId, marker.input.key), ticks: marker.input.durationFrames },
          timings.length,
          startTick,
          startTimeMs,
          controller.frame,
          controller.timeMs,
          timeScale,
        ),
      );
      cursor = controller.frame;
      continue;
    }

    if ("probe" in marker && marker.probe) {
      const probeChecks = marker.probe.checks.length
        ? marker.probe.checks
        : [{ label: marker.probe.label, target: options.fallbackTarget, expect: { exists: true } }];
      const startTick = controller.frame;
      const startTimeMs = controller.timeMs;
      const evaluation = controller.assert(probeChecks, { freeze: true, label: marker.probe.label });
      logs.push({
        level: "info",
        frame: controller.frame,
        message: `Frozen for ${probeChecks.length} checks at ${evaluation.snapshot.id}.`,
      });
      logs.push(...evaluation.logs);
      checks.push(...probeChecks);
      if (!evaluation.passed && result === "passed") {
        result = "failed";
        failureSnapshotRef = evaluation.snapshot.id;
      }
      controller.resume();
      timings.push(createTimingRecord({ op: "freezeAndInspect", checks: probeChecks }, timings.length, startTick, startTimeMs, controller.frame, controller.timeMs, timeScale));
      cursor = controller.frame;
    }
  }

  if (options.timeline.totalFrames > cursor) {
    const startTick = controller.frame;
    const startTimeMs = controller.timeMs;
    controller.step(options.timeline.totalFrames - cursor);
    timings.push(
      createTimingRecord(
        { op: "wait", ticks: options.timeline.totalFrames - cursor },
        timings.length,
        startTick,
        startTimeMs,
        controller.frame,
        controller.timeMs,
        timeScale,
      ),
    );
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
      snapshotRefs: controller.recordedSnapshots.map((snapshot) => snapshot.id),
      logs,
      timings,
      tickRate: worldTickRate,
      scriptTickRate,
      timeScale,
      timeScaleMode: options.script.timeScaleMode,
      timeScaleReason: options.script.timeScaleReason,
      createdAt: new Date().toISOString(),
    },
    snapshots: controller.recordedSnapshots,
  };
}

export function compileTimelineToInputScript(timeline: FrameTimeline, fallbackTarget: TargetRef, startFrame = 0): InputScript {
  const steps: InputScript["steps"] = [];
  let cursor = Math.max(0, Math.floor(startFrame));
  const inputs = [...timeline.inputs].sort((left, right) => left.frame - right.frame);
  const probes = [...timeline.probes].sort((left, right) => left.frame - right.frame);
  const markers = [
    ...inputs.map((input) => ({ frame: input.frame, input })),
    ...probes.map((probe) => ({ frame: probe.frame, probe })),
  ].sort((left, right) => left.frame - right.frame);

  for (const marker of markers) {
    if (marker.frame > cursor) steps.push({ op: "wait", ticks: marker.frame - cursor });
    cursor = marker.frame;
    if ("input" in marker && marker.input) {
      const key = actorScopedKey(marker.input.actorId, marker.input.key);
      steps.push({ op: "tap", key, ticks: marker.input.durationFrames });
      cursor += marker.input.durationFrames;
    } else if ("probe" in marker && marker.probe) {
      steps.push({
        op: "freezeAndInspect",
        checks: marker.probe.checks.length
          ? marker.probe.checks
          : [{ label: marker.probe.label, target: fallbackTarget, expect: { exists: true } }],
      });
    }
  }

  if (timeline.totalFrames > cursor) steps.push({ op: "wait", ticks: timeline.totalFrames - cursor });
  return { steps };
}

function normalizedTickRate(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || !value || value <= 0) return undefined;
  return Math.max(1, Math.round(value));
}

function normalizedTimeScale(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? value : 1;
}

function createTimingRecord(
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

export function actorScopedKey(actorId: EntityId, key: string): string {
  return `${actorId}:${key}`;
}

export function gestureToTimelineInput(actorId: EntityId, key: string, gesture: GestureIntent): TimelineInput {
  const durationFrames = Math.max(1, Math.round(gesture.points.length / 3));
  return {
    actorId,
    key,
    frame: gesture.startFrame,
    durationFrames,
  };
}

type TimeScaleDecision = {
  timeScale: number;
  mode: TestTimeScaleMode;
  reason: string;
};

function chooseTestTimeScale(
  scene: Scene,
  config: ScriptedReactionPlanConfig,
  impactFrame: number,
  defenseInputFrame: number,
  totalTimelineTicks: number,
  tickRate: number,
): TimeScaleDecision {
  if (typeof config.testTimeScale === "number") {
    const timeScale = clampTimeScale(config.testTimeScale);
    return {
      timeScale,
      mode: "manual",
      reason: `Manual test slow scale ${timeScale}x.`,
    };
  }

  const defender = scene.entities[config.defenderId];
  const parryWindowTicks = readBehaviorNumber(defender, "parryWindowFrames") ?? 8;
  const tickMs = 1000 / tickRate;
  const reactionWindowMs = parryWindowTicks * tickMs;
  const inputLeadMs = Math.max(0, impactFrame - defenseInputFrame) * tickMs;
  const timelineMs = totalTimelineTicks * tickMs;
  const precisionScale =
    reactionWindowMs <= 60 ? 24 : reactionWindowMs <= 90 ? 16 : reactionWindowMs <= 130 ? 12 : reactionWindowMs <= 200 ? 8 : 4;
  const leadBoost = inputLeadMs <= 20 ? 4 : inputLeadMs <= 50 ? 2 : 0;
  const lengthAdjustment = timelineMs > 2000 ? -4 : timelineMs > 1000 ? -2 : 0;
  const timeScale = clampTimeScale(precisionScale + leadBoost + lengthAdjustment);
  return {
    timeScale,
    mode: "ai-auto",
    reason: `AI selected ${timeScale}x from ${Math.round(reactionWindowMs)}ms reaction window, ${Math.round(
      inputLeadMs,
    )}ms input lead, ${Math.round(timelineMs)}ms script span.`,
  };
}

function clampTimeScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(60, Math.max(1, Math.round(value)));
}

function readBehaviorNumber(entity: Scene["entities"][string] | undefined, key: string): number | undefined {
  const value = entity?.behavior?.params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function findFirstImpactFrame(
  scene: Scene,
  config: ScriptedReactionPlanConfig,
): { frame: number; event: CombatEvent; attackStartedFrame?: number } | undefined {
  const world = new RuntimeWorld({ scene });
  if (config.initialSnapshot) world.restoreSnapshot(config.initialSnapshot);
  const attackInput = actorScopedKey(config.attackerId, config.attackKey);
  const maxFrames = config.maxProbeFrames ?? 90;
  let attackStartedFrame: number | undefined;
  let attackReleased = false;

  for (let index = 0; index < maxFrames; index += 1) {
    if (world.clock.frame === config.attackStartFrame) world.setInput(attackInput, true);
    world.runFixedFrame();
    if (!attackReleased && world.clock.frame > config.attackStartFrame) {
      world.setInput(attackInput, false);
      attackReleased = true;
    }

    for (const event of world.combatEvents) {
      if (event.type === "attackStarted" && event.attackerId === config.attackerId && attackStartedFrame === undefined) {
        attackStartedFrame = event.frame;
      }
      if (event.type !== "hit") continue;
      if (event.attackerId === config.attackerId && event.defenderId === config.defenderId) {
        return { frame: event.frame, event, attackStartedFrame };
      }
    }
  }

  return undefined;
}
