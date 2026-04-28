import type { FrameCheck, InputScript, RuntimeSnapshot, Scene, TestLog, TestRecord, TestTiming } from "../project/schema";
import type { EntityId, TaskId, TransactionId } from "../shared/types";
import { RuntimeWorld } from "../runtime/world";
import { SimulationTestRunner } from "./simulationTestRunner";
import { MemoryTraceSink, summarizeTraceForAi } from "./telemetry";
import { runReactionWindowEdgeSearch, runScriptedReactionPlan } from "./timingSweep";

export type AutonomousTestStatus = "passed" | "failed" | "interrupted";

export type AutonomousTestSuiteOptions = {
  scene: Scene;
  initialSnapshot?: RuntimeSnapshot;
  taskId?: TaskId;
  transactionId?: TransactionId;
  traceLimit?: number;
  maxEntityChecks?: number;
  includeReactionCase?: boolean;
  includeReactionBoundaryCase?: boolean;
  reactionPair?: {
    attackerId: EntityId;
    defenderId: EntityId;
  };
};

export type AutonomousLogSummary = {
  total: number;
  errors: number;
  warnings: number;
  sample: TestLog[];
};

export type AutonomousTimingSummary = {
  steps: number;
  totalDurationMs: number;
  totalScaledDurationMs: number;
  slowestStep?: Pick<TestTiming, "stepIndex" | "op" | "label" | "durationMs" | "scaledDurationMs">;
};

export type AutonomousTestCaseReport = {
  id: string;
  label: string;
  kind: "structure" | "scriptedReaction" | "reactionBoundary";
  status: AutonomousTestStatus;
  record?: TestRecord;
  snapshots: RuntimeSnapshot[];
  testRecordId?: TestRecord["id"];
  failureSnapshotRef?: TestRecord["failureSnapshotRef"];
  traceSummary: string;
  logs: AutonomousLogSummary;
  timings: AutonomousTimingSummary;
  aiNotes: string[];
};

export type AutonomousTestSuiteReport = {
  status: AutonomousTestStatus;
  cases: AutonomousTestCaseReport[];
  traceSummary: string;
  logs: AutonomousLogSummary;
  timings: AutonomousTimingSummary;
  snapshots: RuntimeSnapshot[];
  usedFrozenSnapshot: boolean;
  aiNextSteps: string[];
};

export function runAutonomousTestSuite(options: AutonomousTestSuiteOptions): AutonomousTestSuiteReport {
  const traceLimit = options.traceLimit ?? 80;
  const usedFrozenSnapshot = Boolean(options.initialSnapshot && options.initialSnapshot.sceneId === options.scene.id);
  const cases: AutonomousTestCaseReport[] = [runStructureCase(options, usedFrozenSnapshot, traceLimit)];

  if (options.includeReactionCase !== false) {
    const reactionCase = runAutonomousReactionCase(options, usedFrozenSnapshot, traceLimit);
    if (reactionCase) cases.push(reactionCase);
  }

  if (options.includeReactionBoundaryCase !== false) {
    const boundaryCase = runAutonomousReactionBoundaryCase(options, usedFrozenSnapshot, traceLimit);
    if (boundaryCase) cases.push(boundaryCase);
  }

  const status = cases.some((testCase) => testCase.status === "failed")
    ? "failed"
    : cases.some((testCase) => testCase.status === "interrupted")
      ? "interrupted"
      : "passed";

  return {
    status,
    cases,
    traceSummary: cases.map((testCase) => `## ${testCase.label}\n${testCase.traceSummary || "(no trace)"}`).join("\n\n"),
    logs: mergeLogSummaries(cases.map((testCase) => testCase.logs)),
    timings: mergeTimingSummaries(cases.map((testCase) => testCase.timings)),
    snapshots: uniqueSnapshots(cases.flatMap((testCase) => testCase.snapshots)),
    usedFrozenSnapshot,
    aiNextSteps: buildNextSteps(status, cases, options, usedFrozenSnapshot),
  };
}

function runStructureCase(options: AutonomousTestSuiteOptions, usedFrozenSnapshot: boolean, traceLimit: number): AutonomousTestCaseReport {
  const traceSink = new MemoryTraceSink();
  const world = new RuntimeWorld({ scene: options.scene });
  if (usedFrozenSnapshot && options.initialSnapshot) world.restoreSnapshot(options.initialSnapshot);

  const script: InputScript = {
    tickRate: options.scene.settings.tickRate,
    timeScale: 1,
    timeScaleMode: "ai-auto",
    timeScaleReason: "Autonomous structure smoke test keeps real-time pacing.",
    steps: [
      { op: "wait", ticks: 1 },
      { op: "freezeAndInspect", checks: buildStructureChecks(options.scene, options.maxEntityChecks ?? 12) },
    ],
  };
  const testResult = new SimulationTestRunner({ traceSink }).run({
    taskId: options.taskId,
    transactionId: options.transactionId,
    world,
    script,
    initialSnapshot: usedFrozenSnapshot ? options.initialSnapshot : undefined,
  });
  const record = testResult.record;
  const logs = addSnapshotLog(record.logs, options, usedFrozenSnapshot);

  return {
    id: "structure-smoke",
    label: "Scene structure smoke",
    kind: "structure",
    status: record.result,
    record,
    snapshots: testResult.snapshots,
    testRecordId: record.id,
    failureSnapshotRef: record.failureSnapshotRef,
    traceSummary: summarizeTraceForAi(traceSink.drain(), traceLimit),
    logs: summarizeLogs(logs),
    timings: summarizeTimings(record.timings || []),
    aiNotes: record.result === "passed" ? ["Scene and sampled runtime entities survived a freeze inspection."] : ["Inspect failed frame checks first."],
  };
}

function runAutonomousReactionCase(
  options: AutonomousTestSuiteOptions,
  usedFrozenSnapshot: boolean,
  traceLimit: number,
): AutonomousTestCaseReport | undefined {
  const pair = resolveReactionPair(options);
  const player = pair?.defender;
  const enemy = pair?.attacker;
  if (!player || !enemy) return undefined;

  const baseFrame = usedFrozenSnapshot && options.initialSnapshot ? options.initialSnapshot.frame : 0;
  const attackStartFrame = baseFrame + Math.max(1, Math.round((4 * (options.scene.settings.tickRate || 100)) / 60));
  const result = runScriptedReactionPlan({
    scene: options.scene,
    taskId: options.taskId,
    transactionId: options.transactionId,
    traceLimit,
    config: {
      attackerId: enemy.id,
      defenderId: player.id,
      attackKey: "attack",
      defenseKey: "parry",
      attackStartFrame,
      defenseOffset: 0,
      defenderTarget: { kind: "entity", entityId: player.id },
      successChecks: [
        {
          label: "parry success event exists",
          target: { kind: "runtime", sceneId: options.scene.id },
          expect: { combatEvent: { type: "parrySuccess", attackerId: enemy.id, defenderId: player.id } },
        },
      ],
      initialSnapshot: usedFrozenSnapshot ? options.initialSnapshot : undefined,
      testTimeScale: "auto",
    },
  });

  if (!result.ok) {
    const log: TestLog = { level: "warning", frame: 0, message: result.error };
    return {
      id: "scripted-reaction",
      label: "Autonomous parry reaction",
      kind: "scriptedReaction",
      status: "interrupted",
      snapshots: [],
      traceSummary: "",
      logs: summarizeLogs([log]),
      timings: summarizeTimings([]),
      aiNotes: ["Could not derive a reliable hit frame for the player/enemy pair."],
    };
  }

  return {
    id: "scripted-reaction",
    label: "Autonomous parry reaction",
    kind: "scriptedReaction",
    status: result.value.status,
    record: result.value.record,
    snapshots: result.value.snapshots,
    testRecordId: result.value.testRecordId,
    traceSummary: result.value.traceSummary,
    logs: summarizeLogs(result.value.logs),
    timings: summarizeTimings(result.value.timings),
    aiNotes: [
      result.value.plan.calculationSummary,
      result.value.status === "passed" ? "Parry timing matched the generated reaction plan." : "Review combat trace and timing window.",
    ],
  };
}

function runAutonomousReactionBoundaryCase(
  options: AutonomousTestSuiteOptions,
  usedFrozenSnapshot: boolean,
  traceLimit: number,
): AutonomousTestCaseReport | undefined {
  const pair = resolveReactionPair(options);
  const player = pair?.defender;
  const enemy = pair?.attacker;
  if (!player || !enemy) return undefined;

  const baseFrame = usedFrozenSnapshot && options.initialSnapshot ? options.initialSnapshot.frame : 0;
  const attackStartFrame = baseFrame + Math.max(1, Math.round((4 * (options.scene.settings.tickRate || 100)) / 60));
  const result = runReactionWindowEdgeSearch({
    scene: options.scene,
    taskId: options.taskId,
    transactionId: options.transactionId,
    traceLimit,
    config: {
      attackerId: enemy.id,
      defenderId: player.id,
      attackKey: "attack",
      defenseKey: "parry",
      attackStartFrame,
      defenseOffset: 0,
      minOffset: -20,
      maxOffset: 8,
      anchorOffset: 0,
      defenderTarget: { kind: "entity", entityId: player.id },
      successChecks: [
        {
          label: "parry success event exists",
          target: { kind: "runtime", sceneId: options.scene.id },
          expect: { combatEvent: { type: "parrySuccess", attackerId: enemy.id, defenderId: player.id } },
        },
      ],
      initialSnapshot: usedFrozenSnapshot ? options.initialSnapshot : undefined,
      testTimeScale: "auto",
    },
  });

  if (!result.ok) {
    const log: TestLog = { level: "warning", frame: 0, message: result.error };
    return {
      id: "reaction-boundary",
      label: "Autonomous reaction boundary",
      kind: "reactionBoundary",
      status: "interrupted",
      snapshots: [],
      traceSummary: "",
      logs: summarizeLogs([log]),
      timings: summarizeTimings([]),
      aiNotes: ["Could not search for a stable reaction boundary window."],
    };
  }

  const boundaryLogs = result.value.cases.flatMap((item) => item.logs);
  const boundaryStatus: AutonomousTestStatus =
    result.value.foundPassingWindow && result.value.bounds.contiguousPassWindow ? "passed" : "failed";
  const firstFailure = result.value.cases.find((item) => item.status !== "passed");
  const traceSummary = result.value.cases
    .map((item) => `${item.label}: ${item.status}${item.failureSnapshotRef ? ` @ ${item.failureSnapshotRef}` : ""}`)
    .join("\n");

  return {
    id: "reaction-boundary",
    label: "Autonomous reaction boundary",
    kind: "reactionBoundary",
    status: boundaryStatus,
    snapshots: [],
    testRecordId: result.value.cases[0]?.testRecordId,
    failureSnapshotRef: firstFailure?.failureSnapshotRef,
    traceSummary,
    logs: summarizeLogs(boundaryLogs),
    timings: summarizeTimings([]),
    aiNotes: [
      result.value.foundPassingWindow
        ? `Parry window ${String(result.value.bounds.firstPassingOffset)}f..${String(result.value.bounds.lastPassingOffset)}f`
        : "No passing reaction window found within configured offset range.",
      result.value.bounds.contiguousPassWindow
        ? "Boundary window is contiguous inside the searched range."
        : `Boundary search found gaps at ${result.value.bounds.gapOffsets.join(", ")}.`,
    ],
  };
}

function resolveReactionPair(
  options: AutonomousTestSuiteOptions,
): { attacker: Scene["entities"][string]; defender: Scene["entities"][string] } | undefined {
  if (options.reactionPair) {
    const attacker = options.scene.entities[options.reactionPair.attackerId];
    const defender = options.scene.entities[options.reactionPair.defenderId];
    if (attacker?.behavior?.builtin === "enemyPatrol" && defender?.behavior?.builtin === "playerPlatformer") {
      return { attacker, defender };
    }
  }

  const entities = Object.values(options.scene.entities);
  const defenders = entities.filter((entity) => entity.behavior?.builtin === "playerPlatformer");
  const attackers = entities.filter((entity) => entity.behavior?.builtin === "enemyPatrol");
  if (attackers.length === 0 || defenders.length === 0) return undefined;

  const bestPair = attackers
    .flatMap((attacker) => defenders.map((defender) => ({ attacker, defender, score: scoreReactionPair(attacker, defender) })))
    .sort((left, right) => right.score - left.score)[0];
  return bestPair ? { attacker: bestPair.attacker, defender: bestPair.defender } : undefined;
}

function buildStructureChecks(scene: Scene, maxEntityChecks: number): FrameCheck[] {
  const checks: FrameCheck[] = [
    {
      label: "scene snapshot matches active scene",
      target: { kind: "scene" as const, sceneId: scene.id },
      expect: { exists: true },
    },
  ];
  const runtimeEntities = Object.values(scene.entities).filter((entity) => entity.persistent !== false);
  for (const entity of runtimeEntities.slice(0, Math.max(0, maxEntityChecks))) {
    checks.push({
      label: `entity exists: ${entity.displayName || entity.internalName || entity.id}`,
      target: { kind: "entity" as const, entityId: entity.id as EntityId },
      expect: { exists: true },
    });
  }
  return checks;
}

function addSnapshotLog(logs: TestLog[], options: AutonomousTestSuiteOptions, usedFrozenSnapshot: boolean): TestLog[] {
  if (!options.initialSnapshot) return logs;
  if (usedFrozenSnapshot) return [{ level: "info", frame: options.initialSnapshot.frame, message: `Used frozen snapshot ${options.initialSnapshot.id}.` }, ...logs];
  return [
    {
      level: "warning",
      frame: options.initialSnapshot.frame,
      message: `Ignored frozen snapshot ${options.initialSnapshot.id} because it belongs to scene ${options.initialSnapshot.sceneId}.`,
    },
    ...logs,
  ];
}

function summarizeLogs(logs: TestLog[]): AutonomousLogSummary {
  return {
    total: logs.length,
    errors: logs.filter((log) => log.level === "error").length,
    warnings: logs.filter((log) => log.level === "warning").length,
    sample: logs.slice(0, 8),
  };
}

function summarizeTimings(timings: TestTiming[]): AutonomousTimingSummary {
  const slowestStep = timings.reduce<TestTiming | undefined>((slowest, timing) => {
    return !slowest || timing.durationMs > slowest.durationMs ? timing : slowest;
  }, undefined);
  return {
    steps: timings.length,
    totalDurationMs: sum(timings.map((timing) => timing.durationMs)),
    totalScaledDurationMs: sum(timings.map((timing) => timing.scaledDurationMs)),
    slowestStep: slowestStep && {
      stepIndex: slowestStep.stepIndex,
      op: slowestStep.op,
      label: slowestStep.label,
      durationMs: slowestStep.durationMs,
      scaledDurationMs: slowestStep.scaledDurationMs,
    },
  };
}

function mergeLogSummaries(summaries: AutonomousLogSummary[]): AutonomousLogSummary {
  return {
    total: sum(summaries.map((summary) => summary.total)),
    errors: sum(summaries.map((summary) => summary.errors)),
    warnings: sum(summaries.map((summary) => summary.warnings)),
    sample: summaries.flatMap((summary) => summary.sample).slice(0, 12),
  };
}

function mergeTimingSummaries(summaries: AutonomousTimingSummary[]): AutonomousTimingSummary {
  const slowestStep = summaries
    .map((summary) => summary.slowestStep)
    .filter(isTimingStepSummary)
    .sort((left, right) => right.durationMs - left.durationMs)[0];
  return {
    steps: sum(summaries.map((summary) => summary.steps)),
    totalDurationMs: sum(summaries.map((summary) => summary.totalDurationMs)),
    totalScaledDurationMs: sum(summaries.map((summary) => summary.totalScaledDurationMs)),
    slowestStep,
  };
}

function buildNextSteps(
  status: AutonomousTestStatus,
  cases: AutonomousTestCaseReport[],
  options: AutonomousTestSuiteOptions,
  usedFrozenSnapshot: boolean,
): string[] {
  const steps: string[] = [];
  const boundaryCase = cases.find((testCase) => testCase.kind === "reactionBoundary");
  if (options.initialSnapshot && !usedFrozenSnapshot) steps.push("Capture a fresh frozen snapshot for this scene before rerunning.");
  if (status === "failed") steps.push("Open the first failed case logs and inspect its failureSnapshotRef.");
  if (status === "interrupted") steps.push("Add or tune combat-capable player/enemy behaviors so the reaction planner can derive an impact frame.");
  if (boundaryCase?.status === "failed") steps.push("Inspect the reaction boundary case to see whether the timing window shifted or developed gaps.");
  if (!cases.some((testCase) => testCase.kind === "scriptedReaction")) steps.push("Add a playerPlatformer and enemyPatrol pair to enable autonomous reaction-window coverage.");
  if (status === "passed") steps.push("Broaden coverage with scene-specific checks for resources, triggers, or task acceptance criteria.");
  return steps;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function uniqueSnapshots(snapshots: RuntimeSnapshot[]): RuntimeSnapshot[] {
  const seen = new Set<string>();
  return snapshots.filter((snapshot) => {
    if (seen.has(snapshot.id)) return false;
    seen.add(snapshot.id);
    return true;
  });
}

function isTimingStepSummary(value: AutonomousTimingSummary["slowestStep"]): value is NonNullable<AutonomousTimingSummary["slowestStep"]> {
  return Boolean(value);
}

function scoreReactionPair(attacker: Scene["entities"][string], defender: Scene["entities"][string]): number {
  const attackerTags = new Set(attacker.tags || []);
  const defenderTags = new Set(defender.tags || []);
  const sharedTags = [...attackerTags].filter((tag) => defenderTags.has(tag));
  const distance = Math.abs(attacker.transform.position.x - defender.transform.position.x) + Math.abs(attacker.transform.position.y - defender.transform.position.y);

  let score = 0;
  if (attackerTags.has("combat")) score += 8;
  if (defenderTags.has("combat")) score += 8;
  if (attackerTags.has("enemy")) score += 3;
  if (defenderTags.has("player")) score += 3;
  if (sharedTags.includes("combat")) score += 12;
  if (sharedTags.includes("runner")) score -= 12;
  score -= Math.min(10, distance / 120);
  return score;
}
