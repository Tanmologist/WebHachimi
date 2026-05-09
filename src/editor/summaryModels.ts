import type { AutonomyCycleResult } from "../ai/autonomyLoop";
import type { ProjectMaintenanceReport } from "../project/maintenance";
import type { Project, Task } from "../project/schema";
import type { AutonomousTestSuiteReport } from "../testing/autonomousTesting";
import type { ScriptedReactionRunResult } from "../testing/timingSweep";

export type SweepSummaryItem = { offset: number; status: string; expected?: string; label: string };
export type ScriptedRunSummary = {
  result: string;
  tickRate: number;
  timeScale: number;
  timeScaleMode?: "manual" | "ai-auto";
  timeScaleReason?: string;
  impactFrame: number;
  attackInputFrame: number;
  attackStartedFrame?: number;
  defenseInputFrame: number;
  probeFrame: number;
  stepCount: number;
  totalGameMs: number;
  totalScaledMs: number;
  traceSummary: string;
  timings: Array<{
    label: string;
    startTick: number;
    endTick: number;
    durationTicks: number;
    durationMs: number;
    scaledStartTimeMs: number;
    scaledEndTimeMs: number;
    scaledDurationMs: number;
  }>;
};
export type AutonomousSuiteSummary = {
  status: string;
  usedFrozenSnapshot: boolean;
  caseCount: number;
  passed: number;
  failed: number;
  interrupted: number;
  logErrors: number;
  logWarnings: number;
  totalDurationMs: number;
  totalScaledDurationMs: number;
  snapshotCount: number;
  traceSummary: string;
  aiNextSteps: string[];
  cases: Array<{
    label: string;
    kind: string;
    status: string;
    testRecordId?: string;
    failureSnapshotRef?: string;
    logs: { total: number; errors: number; warnings: number };
    timings: { steps: number; totalDurationMs: number; totalScaledDurationMs: number };
    aiNotes: string[];
  }>;
};
export type AutonomousGeneratedTask = {
  id: string;
  title: string;
  snapshotRef?: string;
  testRecordRefs: string[];
};
export type AutonomousRoundSummary = {
  round: number;
  startedAt: string;
  taskId?: string;
  taskTitle?: string;
  taskStatus: "passed" | "failed" | "skipped";
  taskRolledBack: boolean;
  taskError?: string;
  transactionId?: string;
  generatedTasks: AutonomousGeneratedTask[];
  snapshotRefs: string[];
  testRecordRefs: string[];
  suiteStatus: string;
  suiteCaseCount: number;
  suitePassed: number;
  suiteFailed: number;
  suiteInterrupted: number;
  logErrors: number;
  logWarnings: number;
  usedFrozenSnapshot: boolean;
  aiNextSteps: string[];
  traceSummary: string;
};
export type MaintenanceSummary = {
  mode: "preview" | "manual" | "auto";
  scannedAt: string;
  beforeSnapshots: number;
  afterSnapshots: number;
  deletedSnapshots: number;
  updatedRecords: number;
  protectedSnapshots: number;
  orphanSnapshots: number;
  stalePassedSnapshots: number;
  reclaimedApproxKb: number;
  reasons: string[];
};

export function parseSweepSummary(summary: string): SweepSummaryItem[] {
  return summary
    .split("\n")
    .map((line) => {
      const [offsetRaw, status, expectedOrLabel, ...labelParts] = line.split("\t");
      const hasExpected = expectedOrLabel === "passed" || expectedOrLabel === "failed" || expectedOrLabel === "interrupted";
      return {
        offset: Number(offsetRaw),
        status: status || "interrupted",
        expected: hasExpected ? expectedOrLabel : undefined,
        label: hasExpected ? labelParts.join("\t") || line : expectedOrLabel || line,
      };
    })
    .filter((item) => Number.isFinite(item.offset));
}

export function scriptedRunSummary(result: ScriptedReactionRunResult): ScriptedRunSummary {
  const timings = result.timings.map((timing) => ({
    label: timing.label,
    startTick: timing.startTick,
    endTick: timing.endTick,
    durationTicks: timing.durationTicks,
    durationMs: timing.durationMs,
    scaledStartTimeMs: timing.scaledStartTimeMs,
    scaledEndTimeMs: timing.scaledEndTimeMs,
    scaledDurationMs: timing.scaledDurationMs,
  }));
  const totalGameMs = timings.reduce((sum, timing) => sum + timing.durationMs, 0);
  const totalScaledMs = timings.reduce((sum, timing) => sum + timing.scaledDurationMs, 0);
  return {
    result: result.status,
    tickRate: result.tickRate,
    timeScale: result.timeScale,
    timeScaleMode: result.timeScaleMode,
    timeScaleReason: result.timeScaleReason,
    impactFrame: result.plan.impactFrame,
    attackInputFrame: result.plan.attackInputFrame,
    attackStartedFrame: result.plan.attackStartedFrame,
    defenseInputFrame: result.plan.defenseInputFrame,
    probeFrame: result.plan.probeFrame,
    stepCount: result.script.steps.length,
    totalGameMs,
    totalScaledMs,
    traceSummary: result.traceSummary,
    timings,
  };
}

export function autonomousSuiteSummary(report: AutonomousTestSuiteReport): AutonomousSuiteSummary {
  return {
    status: report.status,
    usedFrozenSnapshot: report.usedFrozenSnapshot,
    caseCount: report.cases.length,
    passed: report.cases.filter((testCase) => testCase.status === "passed").length,
    failed: report.cases.filter((testCase) => testCase.status === "failed").length,
    interrupted: report.cases.filter((testCase) => testCase.status === "interrupted").length,
    logErrors: report.logs.errors,
    logWarnings: report.logs.warnings,
    totalDurationMs: report.timings.totalDurationMs,
    totalScaledDurationMs: report.timings.totalScaledDurationMs,
    snapshotCount: report.snapshots.length,
    traceSummary: report.traceSummary,
    aiNextSteps: report.aiNextSteps,
    cases: report.cases.map((testCase) => ({
      label: testCase.label,
      kind: testCase.kind,
      status: testCase.status,
      testRecordId: testCase.testRecordId,
      failureSnapshotRef: testCase.failureSnapshotRef,
      logs: {
        total: testCase.logs.total,
        errors: testCase.logs.errors,
        warnings: testCase.logs.warnings,
      },
      timings: {
        steps: testCase.timings.steps,
        totalDurationMs: testCase.timings.totalDurationMs,
        totalScaledDurationMs: testCase.timings.totalScaledDurationMs,
      },
      aiNotes: testCase.aiNotes,
    })),
  };
}

export function autonomousRoundSummaryFromCycle(input: {
  round: number;
  cycle: AutonomyCycleResult;
  translateEvidence?: (text: string) => string;
}): AutonomousRoundSummary {
  const suite = autonomousSuiteSummary(input.cycle.suite);
  const generatedTasks = input.cycle.createdFailureTasks.map((task) => generatedTaskSummary(task));
  const taskStatus: AutonomousRoundSummary["taskStatus"] = input.cycle.executedTask
    ? input.cycle.executorResult?.status ?? "failed"
    : "skipped";

  return {
    round: input.round,
    startedAt: input.cycle.run.startedAt,
    taskId: input.cycle.run.taskId,
    taskTitle: input.cycle.executedTask?.title,
    taskStatus,
    taskRolledBack: Boolean(input.cycle.executorResult?.rolledBack),
    taskError: input.cycle.executorResult?.error,
    transactionId: input.cycle.run.transactionRefs[0],
    generatedTasks,
    snapshotRefs: input.cycle.run.snapshotRefs,
    testRecordRefs: input.cycle.run.testRecordRefs,
    suiteStatus: input.cycle.run.status,
    suiteCaseCount: suite.caseCount,
    suitePassed: suite.passed,
    suiteFailed: suite.failed,
    suiteInterrupted: suite.interrupted,
    logErrors: suite.logErrors,
    logWarnings: suite.logWarnings,
    usedFrozenSnapshot: suite.usedFrozenSnapshot,
    aiNextSteps: buildAutonomousRoundNextSteps(
      taskStatus,
      generatedTasks.length,
      input.cycle.run.nextSteps,
      input.translateEvidence,
    ),
    traceSummary: input.cycle.run.traceSummary,
  };
}

export function latestAutonomyRoundSummaryFromProject(project: Project): AutonomousRoundSummary | undefined {
  const runs = Object.values(project.autonomyRuns || {}).sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));
  const run = runs[0];
  if (!run) return undefined;
  const records = run.testRecordRefs.map((id) => project.testRecords[id]).filter(Boolean);
  const generatedTasks = run.createdFailureTaskIds
    .map((id) => project.tasks[id])
    .filter((task): task is Task => Boolean(task))
    .map((task) => generatedTaskSummary(task));
  const task = run.taskId ? project.tasks[run.taskId] : undefined;
  return {
    round: runs.length,
    startedAt: run.startedAt,
    taskId: run.taskId,
    taskTitle: task?.title,
    taskStatus: task ? (run.status === "interrupted" ? "failed" : run.status) : "skipped",
    taskRolledBack: false,
    taskError: run.status === "failed" ? run.decisionSummary : undefined,
    transactionId: run.transactionRefs[0],
    generatedTasks,
    snapshotRefs: run.snapshotRefs,
    testRecordRefs: run.testRecordRefs,
    suiteStatus: run.status,
    suiteCaseCount: records.length,
    suitePassed: records.filter((record) => record.result === "passed").length,
    suiteFailed: records.filter((record) => record.result === "failed").length,
    suiteInterrupted: records.filter((record) => record.result === "interrupted").length,
    logErrors: records.reduce((sum, record) => sum + record.logs.filter((log) => log.level === "error").length, 0),
    logWarnings: records.reduce((sum, record) => sum + record.logs.filter((log) => log.level === "warning").length, 0),
    usedFrozenSnapshot: run.snapshotRefs.length > 0,
    aiNextSteps: run.nextSteps,
    traceSummary: run.traceSummary || run.decisionSummary,
  };
}

export function buildAutonomousRoundNextSteps(
  taskStatus: AutonomousRoundSummary["taskStatus"],
  generatedCount: number,
  suiteSteps: string[],
  translateEvidence: (text: string) => string = (text) => text,
): string[] {
  const steps = suiteSteps.map(translateEvidence);
  if (generatedCount > 0) steps.unshift("优先执行新生成的测试失败任务。");
  if (taskStatus === "failed") steps.unshift("先查看本轮任务 trace 与回滚结果。");
  if (taskStatus === "skipped") steps.unshift("队列为空；可以补充验收任务，或继续扩大自治测试覆盖。");
  return uniqueStrings(steps);
}

export function maintenanceSummary(report: ProjectMaintenanceReport, mode: MaintenanceSummary["mode"]): MaintenanceSummary {
  return {
    mode,
    scannedAt: report.scannedAt,
    beforeSnapshots: report.before.snapshots,
    afterSnapshots: report.after.snapshots,
    deletedSnapshots: report.deletedSnapshotIds.length,
    updatedRecords: report.updatedRecordIds.length,
    protectedSnapshots: report.protectedSnapshotIds.length,
    orphanSnapshots: report.orphanSnapshotIds.length,
    stalePassedSnapshots: report.stalePassedSnapshotIds.length,
    reclaimedApproxKb: Math.round(report.reclaimedApproxBytes / 1024),
    reasons: Object.entries(report.reasons).map(([id, reason]) => `${id}: ${reason}`),
  };
}

export function parseMaintenanceSummary(summary: string): MaintenanceSummary | undefined {
  try {
    const parsed = JSON.parse(summary) as Partial<MaintenanceSummary>;
    if (
      parsed.mode !== "preview" &&
      parsed.mode !== "manual" &&
      parsed.mode !== "auto"
    ) {
      return undefined;
    }
    if (
      typeof parsed.scannedAt !== "string" ||
      typeof parsed.beforeSnapshots !== "number" ||
      typeof parsed.afterSnapshots !== "number" ||
      typeof parsed.deletedSnapshots !== "number" ||
      typeof parsed.updatedRecords !== "number" ||
      typeof parsed.protectedSnapshots !== "number" ||
      typeof parsed.orphanSnapshots !== "number" ||
      typeof parsed.stalePassedSnapshots !== "number" ||
      typeof parsed.reclaimedApproxKb !== "number"
    ) {
      return undefined;
    }
    return {
      mode: parsed.mode,
      scannedAt: parsed.scannedAt,
      beforeSnapshots: parsed.beforeSnapshots,
      afterSnapshots: parsed.afterSnapshots,
      deletedSnapshots: parsed.deletedSnapshots,
      updatedRecords: parsed.updatedRecords,
      protectedSnapshots: parsed.protectedSnapshots,
      orphanSnapshots: parsed.orphanSnapshots,
      stalePassedSnapshots: parsed.stalePassedSnapshots,
      reclaimedApproxKb: parsed.reclaimedApproxKb,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.filter((reason): reason is string => typeof reason === "string") : [],
    };
  } catch {
    return undefined;
  }
}

export function manualMaintenanceOptions() {
  return {
    orphanSnapshotAgeMs: 30 * 60 * 1000,
    maxSnapshotAgeMs: 24 * 60 * 60 * 1000,
    maxSnapshots: 120,
    minSnapshotsToKeep: 20,
    prunePassedTestSnapshots: true,
  };
}

export function parseAutonomousSuiteSummary(summary: string): AutonomousSuiteSummary | undefined {
  try {
    const parsed = JSON.parse(summary) as Partial<AutonomousSuiteSummary>;
    if (
      typeof parsed.status !== "string" ||
      typeof parsed.usedFrozenSnapshot !== "boolean" ||
      typeof parsed.caseCount !== "number" ||
      typeof parsed.passed !== "number" ||
      typeof parsed.failed !== "number" ||
      typeof parsed.interrupted !== "number" ||
      typeof parsed.logErrors !== "number" ||
      typeof parsed.logWarnings !== "number" ||
      typeof parsed.totalDurationMs !== "number" ||
      typeof parsed.totalScaledDurationMs !== "number" ||
      typeof parsed.snapshotCount !== "number" ||
      !Array.isArray(parsed.cases)
    ) {
      return undefined;
    }
    return {
      status: parsed.status,
      usedFrozenSnapshot: parsed.usedFrozenSnapshot,
      caseCount: parsed.caseCount,
      passed: parsed.passed,
      failed: parsed.failed,
      interrupted: parsed.interrupted,
      logErrors: parsed.logErrors,
      logWarnings: parsed.logWarnings,
      totalDurationMs: parsed.totalDurationMs,
      totalScaledDurationMs: parsed.totalScaledDurationMs,
      snapshotCount: parsed.snapshotCount,
      traceSummary: typeof parsed.traceSummary === "string" ? parsed.traceSummary : "",
      aiNextSteps: Array.isArray(parsed.aiNextSteps) ? parsed.aiNextSteps.filter((item): item is string => typeof item === "string") : [],
      cases: parseAutonomousCases(parsed.cases),
    };
  } catch {
    return undefined;
  }
}

export function parseAutonomousCases(value: unknown[]): AutonomousSuiteSummary["cases"] {
  return value
    .map((item) => {
      const row = item as Partial<AutonomousSuiteSummary["cases"][number]>;
      if (
        typeof row.label !== "string" ||
        typeof row.kind !== "string" ||
        typeof row.status !== "string" ||
        !row.logs ||
        !row.timings
      ) {
        return undefined;
      }
      return {
        label: row.label,
        kind: row.kind,
        status: row.status,
        ...(typeof row.testRecordId === "string" ? { testRecordId: row.testRecordId } : {}),
        ...(typeof row.failureSnapshotRef === "string" ? { failureSnapshotRef: row.failureSnapshotRef } : {}),
        logs: {
          total: typeof row.logs.total === "number" ? row.logs.total : 0,
          errors: typeof row.logs.errors === "number" ? row.logs.errors : 0,
          warnings: typeof row.logs.warnings === "number" ? row.logs.warnings : 0,
        },
        timings: {
          steps: typeof row.timings.steps === "number" ? row.timings.steps : 0,
          totalDurationMs: typeof row.timings.totalDurationMs === "number" ? row.timings.totalDurationMs : 0,
          totalScaledDurationMs: typeof row.timings.totalScaledDurationMs === "number" ? row.timings.totalScaledDurationMs : 0,
        },
        aiNotes: Array.isArray(row.aiNotes) ? row.aiNotes.filter((note): note is string => typeof note === "string") : [],
      };
    })
    .filter((item): item is AutonomousSuiteSummary["cases"][number] => Boolean(item));
}

export function parseScriptedRunSummary(summary: string): ScriptedRunSummary | undefined {
  try {
    const parsed = JSON.parse(summary) as Partial<ScriptedRunSummary>;
    if (
      typeof parsed.result !== "string" ||
      typeof parsed.tickRate !== "number" ||
      typeof parsed.timeScale !== "number" ||
      typeof parsed.impactFrame !== "number" ||
      typeof parsed.attackInputFrame !== "number" ||
      typeof parsed.defenseInputFrame !== "number" ||
      typeof parsed.probeFrame !== "number" ||
      typeof parsed.stepCount !== "number" ||
      typeof parsed.totalGameMs !== "number" ||
      typeof parsed.totalScaledMs !== "number"
    ) {
      return undefined;
    }
    return {
      result: parsed.result,
      tickRate: parsed.tickRate,
      timeScale: parsed.timeScale,
      timeScaleMode: parsed.timeScaleMode === "manual" || parsed.timeScaleMode === "ai-auto" ? parsed.timeScaleMode : undefined,
      timeScaleReason: typeof parsed.timeScaleReason === "string" ? parsed.timeScaleReason : "",
      impactFrame: parsed.impactFrame,
      attackInputFrame: parsed.attackInputFrame,
      attackStartedFrame: typeof parsed.attackStartedFrame === "number" ? parsed.attackStartedFrame : undefined,
      defenseInputFrame: parsed.defenseInputFrame,
      probeFrame: parsed.probeFrame,
      stepCount: parsed.stepCount,
      totalGameMs: parsed.totalGameMs,
      totalScaledMs: parsed.totalScaledMs,
      traceSummary: typeof parsed.traceSummary === "string" ? parsed.traceSummary : "",
      timings: parseTimingRows(parsed.timings),
    };
  } catch {
    return undefined;
  }
}

export function parseTimingRows(value: unknown): ScriptedRunSummary["timings"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Partial<ScriptedRunSummary["timings"][number]>;
      if (
        typeof row.label !== "string" ||
        typeof row.startTick !== "number" ||
        typeof row.endTick !== "number" ||
        typeof row.durationTicks !== "number" ||
        typeof row.durationMs !== "number" ||
        typeof row.scaledDurationMs !== "number"
      ) {
        return undefined;
      }
      return {
        label: row.label,
        startTick: row.startTick,
        endTick: row.endTick,
        durationTicks: row.durationTicks,
        durationMs: row.durationMs,
        scaledStartTimeMs: typeof row.scaledStartTimeMs === "number" ? row.scaledStartTimeMs : 0,
        scaledEndTimeMs: typeof row.scaledEndTimeMs === "number" ? row.scaledEndTimeMs : row.scaledDurationMs,
        scaledDurationMs: row.scaledDurationMs,
      };
    })
    .filter((item): item is ScriptedRunSummary["timings"][number] => Boolean(item));
}

export function reactionSweepExpectations(): Map<number, "passed" | "failed"> {
  return new Map([
    [-10, "failed"],
    [-8, "passed"],
    [-6, "passed"],
    [-4, "passed"],
    [-2, "passed"],
    [0, "passed"],
    [2, "failed"],
    [4, "failed"],
    [6, "failed"],
  ]);
}

function generatedTaskSummary(task: Task): AutonomousGeneratedTask {
  return {
    id: task.id,
    title: task.title,
    snapshotRef: task.snapshotRef,
    testRecordRefs: task.testRecordRefs,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
