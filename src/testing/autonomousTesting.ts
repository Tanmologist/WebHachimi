import type {
  AssertionFailure,
  FrameCheck,
  InputScript,
  Project,
  RuntimeSnapshot,
  Scene,
  Task,
  TestLog,
  TestRecord,
  TestTiming,
  Transaction,
  VerificationPlan,
} from "../project/schema";
import { makeId } from "../shared/types";
import type { EntityId, TaskId, TestRecordId, TransactionId } from "../shared/types";
import { RuntimeWorld } from "../runtime/world";
import { evaluateProjectChecks } from "./projectVerification";
import { SimulationTestRunner } from "./simulationTestRunner";
import { MemoryTraceSink, summarizeTraceForAi } from "./telemetry";
import { planAutonomousTests, type AutonomousTestPlan } from "./testPlanner";
import { runReactionWindowEdgeSearch, runScriptedReactionPlan } from "./timingSweep";

export type AutonomousTestStatus = "passed" | "failed" | "interrupted";

export type AutonomousTestSuiteOptions = {
  project?: Project;
  scene: Scene;
  task?: Task;
  transaction?: Transaction;
  verificationPlan?: VerificationPlan;
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
  kind: "structure" | "projectVerification" | "scriptedReaction" | "reactionBoundary";
  status: AutonomousTestStatus;
  record?: TestRecord;
  snapshots: RuntimeSnapshot[];
  testRecordId?: TestRecord["id"];
  failureSnapshotRef?: TestRecord["failureSnapshotRef"];
  traceSummary: string;
  logs: AutonomousLogSummary;
  timings: AutonomousTimingSummary;
  assertionFailures: AssertionFailure[];
  aiNotes: string[];
};

export type AutonomousTestSuiteReport = {
  status: AutonomousTestStatus;
  cases: AutonomousTestCaseReport[];
  traceSummary: string;
  logs: AutonomousLogSummary;
  timings: AutonomousTimingSummary;
  testPlan: AutonomousTestPlan;
  snapshots: RuntimeSnapshot[];
  usedFrozenSnapshot: boolean;
  aiNextSteps: string[];
};

export function runAutonomousTestSuite(options: AutonomousTestSuiteOptions): AutonomousTestSuiteReport {
  const traceLimit = options.traceLimit ?? 80;
  const usedFrozenSnapshot = Boolean(options.initialSnapshot && options.initialSnapshot.sceneId === options.scene.id);
  const verificationPlan = options.verificationPlan || options.task?.verificationPlan;
  const testPlan = planAutonomousTests({
    scene: options.scene,
    task: options.task,
    transaction: options.transaction,
    verificationPlan,
    includeReactionCase: options.includeReactionCase,
    includeReactionBoundaryCase: options.includeReactionBoundaryCase,
  });
  const cases: AutonomousTestCaseReport[] = [];

  if (testPlan.runProjectVerification && options.project && verificationPlan) {
    cases.push(runProjectVerificationCase(options, verificationPlan));
  }

  if (testPlan.runStructure) {
    cases.push(runStructureCase(options, verificationPlan, usedFrozenSnapshot, traceLimit));
  }

  if (testPlan.runReaction) {
    const reactionCase = runAutonomousReactionCase(options, usedFrozenSnapshot, traceLimit);
    if (reactionCase) cases.push(reactionCase);
  }

  if (testPlan.runReactionBoundary) {
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
    testPlan,
    snapshots: uniqueSnapshots(cases.flatMap((testCase) => testCase.snapshots)),
    usedFrozenSnapshot,
    aiNextSteps: buildNextSteps(status, cases, options, usedFrozenSnapshot, testPlan),
  };
}

function runProjectVerificationCase(options: AutonomousTestSuiteOptions, verificationPlan: VerificationPlan): AutonomousTestCaseReport {
  const project = options.project;
  if (!project) {
    const log: TestLog = { level: "warning", frame: 0, message: "Project verification skipped because no project was supplied." };
    return {
      id: "project-verification",
      label: "Project verification",
      kind: "projectVerification",
      status: "interrupted",
      snapshots: [],
      traceSummary: verificationPlan.summary,
      logs: summarizeLogs([log]),
      timings: summarizeTimings([]),
      assertionFailures: [],
      aiNotes: ["Supply the project to run project-level verification checks."],
    };
  }
  const evaluation = evaluateProjectChecks(project, verificationPlan.projectChecks);
  const record: TestRecord = {
    id: makeId<"TestRecordId">("test") as TestRecordId,
    taskId: options.taskId,
    transactionId: options.transactionId,
    script: { steps: [] },
    result: evaluation.passed ? "passed" : "failed",
    frameChecks: [],
    projectChecks: verificationPlan.projectChecks,
    assertionFailures: evaluation.failures,
    logs: evaluation.logs,
    timings: [],
    createdAt: new Date().toISOString(),
  };

  return {
    id: "project-verification",
    label: "Project verification",
    kind: "projectVerification",
    status: record.result,
    record,
    snapshots: [],
    testRecordId: record.id,
    traceSummary: verificationPlan.summary,
    logs: summarizeLogs(record.logs),
    timings: summarizeTimings([]),
    assertionFailures: evaluation.failures,
    aiNotes:
      record.result === "passed"
        ? ["Project-level expectations matched the planned transaction."]
        : ["Inspect structured assertionFailures for the exact project field mismatch."],
  };
}

function runStructureCase(
  options: AutonomousTestSuiteOptions,
  verificationPlan: VerificationPlan | undefined,
  usedFrozenSnapshot: boolean,
  traceLimit: number,
): AutonomousTestCaseReport {
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
      ...(verificationPlan?.runtimeSetupSteps || []),
      { op: "freezeAndInspect", checks: buildStructureChecks(options.scene, options.maxEntityChecks ?? 12, verificationPlan?.frameChecks || []) },
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
    assertionFailures: record.assertionFailures || [],
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
      assertionFailures: [],
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
    assertionFailures: result.value.record.assertionFailures || [],
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
      assertionFailures: [],
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
    assertionFailures: result.value.cases.flatMap((item) => item.assertionFailures || []),
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

function buildStructureChecks(scene: Scene, maxEntityChecks: number, plannedChecks: FrameCheck[] = []): FrameCheck[] {
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
  return mergeFrameChecks([...checks, ...plannedChecks.filter((check) => check.target.kind !== "resource")]);
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
  testPlan: AutonomousTestPlan,
): string[] {
  const steps: string[] = [];
  const boundaryCase = cases.find((testCase) => testCase.kind === "reactionBoundary");
  const failedAssertion = cases.flatMap((testCase) => testCase.assertionFailures)[0];
  if (options.initialSnapshot && !usedFrozenSnapshot) steps.push("Capture a fresh frozen snapshot for this scene before rerunning.");
  if (failedAssertion) steps.push(`Inspect assertion failure: ${failedAssertion.label} at ${failedAssertion.path}.`);
  if (status === "failed") steps.push("Open the first failed case logs and inspect its failureSnapshotRef.");
  if (status === "interrupted") steps.push("Add or tune combat-capable player/enemy behaviors so the reaction planner can derive an impact frame.");
  if (boundaryCase?.status === "failed") steps.push("Inspect the reaction boundary case to see whether the timing window shifted or developed gaps.");
  if (testPlan.runReaction && !cases.some((testCase) => testCase.kind === "scriptedReaction")) {
    steps.push("Add a playerPlatformer and enemyPatrol pair to enable autonomous reaction-window coverage.");
  }
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

function mergeFrameChecks(checks: FrameCheck[]): FrameCheck[] {
  const seen = new Set<string>();
  return checks.filter((check) => {
    const key = `${check.label}:${JSON.stringify(check.target)}:${JSON.stringify(check.expect)}`;
    if (seen.has(key)) return false;
    seen.add(key);
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
