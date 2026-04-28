import type { ProjectStore } from "../project/projectStore";
import type {
  AcceptanceCriterion,
  AutonomyRun,
  Project,
  RuntimeSnapshot,
  Scene,
  TargetRef,
  Task,
  TestRecord,
  Transaction,
} from "../project/schema";
import { createTask } from "../project/tasks";
import { err, makeId, ok, type Result } from "../shared/types";
import type { AutonomyRunId, SnapshotId, TaskId, TestRecordId, TransactionId } from "../shared/types";
import { runAutonomousTestSuite, type AutonomousTestCaseReport, type AutonomousTestSuiteReport } from "../testing/autonomousTesting";
import type { TraceSink } from "../testing/telemetry";
import { AiTaskExecutor, type AiTaskExecutionResult } from "./taskExecutor";

export type AutonomyLoopOptions = {
  store: ProjectStore;
  executor?: AiTaskExecutor;
  traceSink?: TraceSink;
  traceLimit?: number;
  maxEntityChecks?: number;
};

export type AutonomyCycleOptions = {
  initialSnapshot?: RuntimeSnapshot;
  traceLimit?: number;
  includeReactionCase?: boolean;
  maxEntityChecks?: number;
  maxFailureTasks?: number;
};

export type AutonomyLoopRunOptions = AutonomyCycleOptions & {
  maxRounds?: number;
};

export type AutonomyCycleResult = {
  run: AutonomyRun;
  executedTask?: Task;
  executorResult?: AiTaskExecutionResult;
  suite: AutonomousTestSuiteReport;
  createdFailureTasks: Task[];
};

export type AutonomyLoopRunResult = {
  status: "idle" | AutonomyRun["status"];
  cycles: AutonomyCycleResult[];
};

export class AutonomyLoop {
  private readonly store: ProjectStore;
  private readonly executor: AiTaskExecutor;
  private readonly traceSink?: TraceSink;
  private readonly traceLimit: number;
  private readonly maxEntityChecks: number;

  constructor(options: AutonomyLoopOptions) {
    this.store = options.store;
    this.traceSink = options.traceSink;
    this.executor = options.executor || new AiTaskExecutor({ store: options.store, traceSink: options.traceSink });
    this.traceLimit = options.traceLimit ?? 140;
    this.maxEntityChecks = options.maxEntityChecks ?? 12;
  }

  runOnce(options: AutonomyCycleOptions = {}): Result<AutonomyCycleResult> {
    const startedAt = new Date().toISOString();
    const initialProject = this.store.project;
    const task = nextQueuedTaskInProject(initialProject);
    const sceneBeforeTask = activeScene(initialProject);
    if (!sceneBeforeTask) return err(`active scene not found: ${initialProject.activeSceneId}`);
    const readyTask = task ? this.ensureAcceptanceCriteria(initialProject, task, sceneBeforeTask) : undefined;

    let executorResult: AiTaskExecutionResult | undefined;
    if (readyTask) {
      const executed = this.executor.executeTask(readyTask.id);
      executorResult = executed.ok
        ? executed.value
        : {
            taskId: readyTask.id,
            status: "failed",
            rolledBack: false,
            error: executed.error,
          };
    }

    const projectAfterTask = this.store.project;
    const scene = activeScene(projectAfterTask);
    if (!scene) return err(`active scene not found: ${projectAfterTask.activeSceneId}`);
    const transaction = currentTransaction(projectAfterTask, executorResult?.transaction);
    const frozenSnapshot =
      options.initialSnapshot && options.initialSnapshot.sceneId === scene.id ? options.initialSnapshot : undefined;
    const suite = runAutonomousTestSuite({
      scene,
      initialSnapshot: frozenSnapshot,
      taskId: readyTask?.id,
      transactionId: transaction?.id,
      traceLimit: options.traceLimit ?? this.traceLimit,
      maxEntityChecks: options.maxEntityChecks ?? this.maxEntityChecks,
      includeReactionCase: options.includeReactionCase,
    });

    const suiteRecordIds = this.recordSuiteResults(suite, readyTask, transaction);
    const taskRecords = readyTask ? recordsForTask(this.store.project, readyTask.id) : [];
    const createdFailureTasks = this.createFailureTasks({
      cases: suite.cases,
      scene,
      parentTask: readyTask,
      executorResult,
      taskRecords,
      maxFailureTasks: options.maxFailureTasks ?? 3,
    });

    const runStatus = chooseRunStatus(executorResult, suite);
    const run = this.createAutonomyRun({
      startedAt,
      status: runStatus,
      task: readyTask,
      executorResult,
      suite,
      transaction,
      taskRecords,
      suiteRecordIds,
      createdFailureTasks,
    });
    this.store.recordAutonomyRun(run);
    this.publishRun(run, transaction);

    return ok({
      run,
      executedTask: readyTask,
      executorResult,
      suite,
      createdFailureTasks,
    });
  }

  runUntilIdle(options: AutonomyLoopRunOptions = {}): Result<AutonomyLoopRunResult> {
    const maxRounds = Math.max(1, options.maxRounds ?? 1);
    const cycles: AutonomyCycleResult[] = [];
    for (let index = 0; index < maxRounds; index += 1) {
      const queuedTask = nextQueuedTaskInProject(this.store.project);
      if (!queuedTask) break;
      const cycle = this.runOnce(options);
      if (!cycle.ok) return cycle;
      cycles.push(cycle.value);
      if (cycle.value.run.status !== "passed") break;
    }
    return ok({
      status: cycles.length === 0 ? "idle" : cycles.some((cycle) => cycle.run.status !== "passed") ? cycles[cycles.length - 1].run.status : "passed",
      cycles,
    });
  }

  private ensureAcceptanceCriteria(project: Project, task: Task, scene: Scene): Task {
    const prepared = prepareTaskForAutonomy(project, task, scene);
    if (prepared.changed) this.store.upsertTask(prepared.task);
    return prepared.task;
  }

  private recordSuiteResults(
    suite: AutonomousTestSuiteReport,
    task: Task | undefined,
    transaction: Transaction | undefined,
  ): TestRecordId[] {
    const recordIds: TestRecordId[] = [];
    for (const testCase of suite.cases) {
      if (!testCase.record) continue;
      recordIds.push(testCase.record.id);
      const currentTask = task ? this.store.project.tasks[task.id] || task : undefined;
      const currentTransaction = transaction ? currentTransactionForStore(this.store.project, transaction) : undefined;
      this.store.recordTestResult(testCase.record, currentTask, currentTransaction, testCase.snapshots);
    }
    return uniqueRefs(recordIds);
  }

  private createFailureTasks(input: {
    cases: AutonomousTestCaseReport[];
    scene: Scene;
    parentTask?: Task;
    executorResult?: AiTaskExecutionResult;
    taskRecords: TestRecord[];
    maxFailureTasks: number;
  }): Task[] {
    const created: Task[] = [];
    if (input.parentTask && input.executorResult?.status === "failed") {
      const record = input.taskRecords.find((item) => item.result !== "passed");
      const task = this.createFailureTask({
        title: `Fix failed autonomous task: ${input.parentTask.title}`,
        userText: executorFailureTaskText(input.parentTask, input.executorResult, record),
        targetRefs: input.parentTask.targetRefs.length ? input.parentTask.targetRefs : [{ kind: "scene", sceneId: input.scene.id }],
        snapshotRef: record?.failureSnapshotRef || input.parentTask.snapshotRef,
        testRecord: record,
      });
      if (task) created.push(task);
    }

    const failures = input.cases
      .filter((testCase) => testCase.status === "failed" || testCase.status === "interrupted")
      .slice(0, Math.max(0, input.maxFailureTasks));
    for (const testCase of failures) {
      const task = this.createFailureTask({
        title: `Fix autonomous test failure: ${testCase.label}`,
        userText: failureTaskText(testCase, input.parentTask),
        targetRefs: [{ kind: "scene", sceneId: input.scene.id }],
        acceptanceCriteria: [
          {
            label: `rerun passes: ${testCase.label}`,
            target: { kind: "scene", sceneId: input.scene.id },
            expect: { exists: true },
          },
        ],
        snapshotRef: testCase.failureSnapshotRef,
        testRecord: testCase.record,
      });
      if (task) created.push(task);
    }
    return created;
  }

  private createFailureTask(input: {
    title: string;
    userText: string;
    targetRefs: TargetRef[];
    acceptanceCriteria?: AcceptanceCriterion[];
    snapshotRef?: SnapshotId;
    testRecord?: TestRecord;
  }): Task | undefined {
    if (input.testRecord && existingFailureTaskForRecord(this.store.project, input.testRecord.id)) return undefined;
    const result = createTask({
      source: "testFailure",
      title: input.title.slice(0, 80),
      userText: input.userText,
      targetRefs: input.targetRefs,
      acceptanceCriteria: input.acceptanceCriteria,
    });
    if (!result.ok) return undefined;
    const task: Task = {
      ...result.value,
      snapshotRef: input.snapshotRef,
      testRecordRefs: input.testRecord ? [input.testRecord.id] : [],
      normalizedText: normalizeTaskText(input.userText),
    };
    this.store.upsertTask(task);
    return task;
  }

  private createAutonomyRun(input: {
    startedAt: string;
    status: AutonomyRun["status"];
    task?: Task;
    executorResult?: AiTaskExecutionResult;
    suite: AutonomousTestSuiteReport;
    transaction?: Transaction;
    taskRecords: TestRecord[];
    suiteRecordIds: TestRecordId[];
    createdFailureTasks: Task[];
  }): AutonomyRun {
    const testRecordRefs = uniqueRefs([...input.taskRecords.map((record) => record.id), ...input.suiteRecordIds]);
    const snapshotRefs = uniqueRefs([
      ...input.taskRecords.flatMap((record) => record.snapshotRefs || []),
      ...input.suite.snapshots.map((snapshot) => snapshot.id),
      ...input.suite.cases.map((testCase) => testCase.failureSnapshotRef).filter((id): id is SnapshotId => Boolean(id)),
    ]);
    const transactionRefs = uniqueRefs(input.transaction ? [input.transaction.id] : []);
    const traceSummary = [input.executorResult?.traceSummary, ...input.taskRecords.map((record) => record.traceSummary), input.suite.traceSummary]
      .filter((item): item is string => Boolean(item))
      .join("\n\n");
    return {
      id: makeId<"AutonomyRunId">("auto") as AutonomyRunId,
      mode: input.task ? "task" : "selfTest",
      status: input.status,
      taskId: input.task?.id,
      createdFailureTaskIds: input.createdFailureTasks.map((task) => task.id),
      testRecordRefs,
      snapshotRefs,
      transactionRefs,
      traceSummary,
      decisionSummary: buildDecisionSummary(input),
      nextSteps: buildNextSteps(input),
      startedAt: input.startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  private publishRun(run: AutonomyRun, transaction: Transaction | undefined): void {
    this.traceSink?.publish({
      channel: "ai",
      level: run.status === "passed" ? "info" : "warning",
      frame: 0,
      taskId: run.taskId,
      transactionId: transaction?.id,
      message: run.decisionSummary,
      data: { autonomyRunId: run.id },
    });
  }
}

export const AutonomyManager = AutonomyLoop;

type PreparedTask = {
  task: Task;
  changed: boolean;
};

export function prepareTaskForAutonomy(project: Project, task: Task, scene = activeScene(project)): PreparedTask {
  const generated = generateAcceptanceCriteria(project, task, scene);
  const acceptanceCriteria = mergeAcceptanceCriteria(task.acceptanceCriteria || [], generated);
  const draftTask: Task = {
    ...task,
    acceptanceCriteria,
    normalizedText: task.normalizedText || normalizeTaskText(task.userText),
  };
  const changed = JSON.stringify(draftTask) !== JSON.stringify(task);
  const nextTask = changed ? { ...draftTask, updatedAt: new Date().toISOString() } : draftTask;
  return { task: nextTask, changed };
}

export function generateAcceptanceCriteria(project: Project, task: Task, scene = activeScene(project)): AcceptanceCriterion[] {
  const refs = task.targetRefs.length ? task.targetRefs : scene ? [{ kind: "scene" as const, sceneId: scene.id }] : [];
  const checks: AcceptanceCriterion[] = scene
    ? [
        {
          label: "active scene remains inspectable",
          target: { kind: "scene", sceneId: scene.id },
          expect: { exists: true },
        },
      ]
    : [];
  for (const target of refs.slice(0, 8)) {
    const check = criterionForTarget(project, scene, target, checks.length + 1);
    if (check) checks.push(check);
  }
  return mergeAcceptanceCriteria([], checks);
}

export function nextQueuedTaskInProject(project: Project): Task | undefined {
  return Object.values(project.tasks)
    .filter((task) => task.status === "queued")
    .sort((left, right) => taskPriority(left) - taskPriority(right) || left.createdAt.localeCompare(right.createdAt))[0];
}

function activeScene(project: Project): Scene | undefined {
  return project.scenes[project.activeSceneId];
}

function criterionForTarget(project: Project, scene: Scene | undefined, target: TargetRef, index: number): AcceptanceCriterion | undefined {
  if (target.kind === "resource") return undefined;
  if (target.kind === "entity" && !project.scenes[project.activeSceneId]?.entities[target.entityId]) return undefined;
  if (target.kind === "area" && scene && target.sceneId !== scene.id) return undefined;
  return {
    label: `acceptance ${index}: ${target.kind} target exists`,
    target,
    expect: { exists: true },
  };
}

function mergeAcceptanceCriteria(existing: AcceptanceCriterion[], generated: AcceptanceCriterion[]): AcceptanceCriterion[] {
  const seen = new Set<string>();
  const merged: AcceptanceCriterion[] = [];
  for (const criterion of [...existing, ...generated]) {
    if (criterion.target.kind === "resource") continue;
    const normalized: AcceptanceCriterion = {
      label: criterion.label.trim() || "acceptance check",
      target: criterion.target,
      expect: criterion.expect,
    };
    const key = `${normalized.label}:${JSON.stringify(normalized.target)}:${JSON.stringify(normalized.expect)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }
  return merged;
}

function taskPriority(task: Task): number {
  if (task.source === "testFailure") return 0;
  if (task.source === "user" || task.source === "superBrush") return 1;
  return 2;
}

function chooseRunStatus(executorResult: AiTaskExecutionResult | undefined, suite: AutonomousTestSuiteReport): AutonomyRun["status"] {
  if (suite.status === "interrupted") return "interrupted";
  if (suite.status === "failed" || executorResult?.status === "failed") return "failed";
  return "passed";
}

function currentTransaction(project: Project, transaction: Transaction | undefined): Transaction | undefined {
  return transaction ? project.transactions[transaction.id] || transaction : undefined;
}

function currentTransactionForStore(project: Project, transaction: Transaction): Transaction {
  return project.transactions[transaction.id] || transaction;
}

function recordsForTask(project: Project, taskId: TaskId): TestRecord[] {
  const byId = new Map<string, TestRecord>();
  const task = project.tasks[taskId];
  for (const id of task?.testRecordRefs || []) {
    const record = project.testRecords[id];
    if (record) byId.set(record.id, record);
  }
  for (const record of Object.values(project.testRecords)) {
    if (record.taskId === taskId) byId.set(record.id, record);
  }
  return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function existingFailureTaskForRecord(project: Project, testRecordId: TestRecordId): Task | undefined {
  return Object.values(project.tasks).find((task) => task.source === "testFailure" && task.testRecordRefs.includes(testRecordId));
}

function buildDecisionSummary(input: {
  task?: Task;
  executorResult?: AiTaskExecutionResult;
  suite: AutonomousTestSuiteReport;
  transaction?: Transaction;
  taskRecords: TestRecord[];
  createdFailureTasks: Task[];
}): string {
  const subject = input.task ? `task ${input.task.id} (${input.task.title})` : "project self-test";
  const executor = input.executorResult
    ? `executor=${input.executorResult.status}${input.executorResult.rolledBack ? " rolledBack=true" : ""}`
    : "executor=skipped";
  const transaction = input.transaction ? `transaction=${input.transaction.id} ${input.transaction.status}` : "transaction=none";
  const latestRecord = input.taskRecords[0]
    ? `latestTaskTest=${input.taskRecords[0].id} ${input.taskRecords[0].result}`
    : "latestTaskTest=none";
  return `${subject}: ${executor}; ${transaction}; suite=${input.suite.status} (${input.suite.cases.length} cases, ${input.suite.logs.errors} errors, ${input.suite.logs.warnings} warnings); ${latestRecord}; followUps=${input.createdFailureTasks.length}.`;
}

function buildNextSteps(input: {
  executorResult?: AiTaskExecutionResult;
  suite: AutonomousTestSuiteReport;
  createdFailureTasks: Task[];
}): string[] {
  const steps = [...input.suite.aiNextSteps];
  if (input.executorResult?.error) steps.unshift(`Inspect executor error: ${input.executorResult.error}`);
  if (input.createdFailureTasks.length > 0) steps.unshift("Run or inspect the generated testFailure task before continuing autonomous work.");
  if (steps.length === 0 && input.suite.status === "passed") steps.push("Evidence recorded; continue with the next queued task.");
  return uniqueRefs(steps);
}

function executorFailureTaskText(parentTask: Task, execution: AiTaskExecutionResult, record: TestRecord | undefined): string {
  return [
    `Autonomous executor failed while working on task ${parentTask.id}: ${parentTask.title}.`,
    `Executor status: ${execution.status}; rolledBack=${execution.rolledBack}.`,
    execution.error ? `Executor error: ${execution.error}.` : "",
    execution.transaction ? `Transaction: ${execution.transaction.id} (${execution.transaction.status}).` : "",
    record ? `Test record: ${record.id} (${record.result}).` : "",
    record?.failureSnapshotRef ? `Failure snapshot: ${record.failureSnapshotRef}.` : "",
    record?.traceSummary || execution.traceSummary ? `Trace summary: ${record?.traceSummary || execution.traceSummary}` : "",
    "Next step: inspect the referenced test record and snapshot, then make the smallest fix that turns this task green.",
  ]
    .filter(Boolean)
    .join("\n");
}

function failureTaskText(testCase: AutonomousTestCaseReport, parentTask: Task | undefined): string {
  return [
    parentTask ? `Parent task: ${parentTask.id} (${parentTask.title}).` : "Autonomous self-test failed.",
    `Failed case: ${testCase.label}.`,
    `Status: ${testCase.status}.`,
    testCase.failureSnapshotRef ? `Failure snapshot: ${testCase.failureSnapshotRef}.` : "",
    testCase.testRecordId || testCase.record?.id ? `Test record: ${testCase.testRecordId || testCase.record?.id}.` : "",
    testCase.aiNotes.length ? `AI notes: ${testCase.aiNotes.join(" ")}` : "",
    testCase.traceSummary ? `Trace summary: ${testCase.traceSummary}` : "",
    "Next step: inspect the failure snapshot/test record, repair the underlying scene or behavior issue, and rerun the autonomous suite.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeTaskText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function uniqueRefs<T extends string>(refs: T[]): T[] {
  return [...new Set(refs)];
}

export type AutonomyManager = AutonomyLoop;
