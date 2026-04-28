import type { Project, Task, Transaction } from "../project/schema";
import { transitionTask } from "../project/tasks";
import type { ProjectStore } from "../project/projectStore";
import { RuntimeWorld } from "../runtime/world";
import { err, ok, type Result } from "../shared/types";
import type { TaskId } from "../shared/types";
import { SimulationTestRunner } from "../testing/simulationTestRunner";
import { MemoryTraceSink, summarizeTraceForAi, type TraceSink } from "../testing/telemetry";
import {
  runReactionWindowSweep as runTestingReactionWindowSweep,
  type ReactionWindowSweepConfig,
  type ReactionWindowSweepRunResult,
} from "../testing/timingSweep";
import { createIntentPlan } from "./intentPlanner";

export type AiTaskExecutorOptions = {
  store: ProjectStore;
  testRunner?: SimulationTestRunner;
  traceSink?: TraceSink;
};

export type AiTaskExecutionResult = {
  taskId: TaskId;
  status: "passed" | "failed";
  transaction?: Transaction;
  dryRunProject?: Project;
  rolledBack: boolean;
  error?: string;
  traceSummary?: string;
};

export class AiTaskExecutor {
  private readonly store: ProjectStore;
  private readonly testRunner: SimulationTestRunner;
  private readonly traceSink: TraceSink;

  constructor(options: AiTaskExecutorOptions) {
    this.store = options.store;
    this.traceSink = options.traceSink || new MemoryTraceSink();
    this.testRunner = options.testRunner || new SimulationTestRunner({ traceSink: this.traceSink });
  }

  executeNextQueuedTask(): Result<AiTaskExecutionResult | undefined> {
    const task = nextQueuedTask(this.store.project);
    if (!task) return ok(undefined);
    return this.executeTask(task.id);
  }

  executeTask(taskId: TaskId): Result<AiTaskExecutionResult> {
    if (this.traceSink instanceof MemoryTraceSink) this.traceSink.clear();
    const project = this.store.project;
    const task = project.tasks[taskId];
    if (!task) return err(`task not found: ${taskId}`);
    if (task.status !== "queued") return err(`task is not queued: ${task.status}`);

    const runningTask = transitionTask(task, "running", normalizeTaskText(task.userText));
    this.store.upsertTask(runningTask);

    const plan = createIntentPlan(this.store.project, runningTask);
    if (!plan.ok) return this.failTask(runningTask, plan.error);

    const transaction = this.store.createTransaction({
      actor: "ai",
      taskId,
      patches: plan.value.patches,
      inversePatches: plan.value.inversePatches,
      diffSummary: plan.value.diffSummary,
    });

    const dryRun = this.store.dryRun(transaction);
    if (!dryRun.ok) return this.failTask(runningTask, dryRun.error, transaction);

    const applied = this.store.apply(transaction);
    if (!applied.ok) return this.failTask(runningTask, applied.error, transaction, dryRun.value);

    const appliedProject = this.store.project;
    const scene = appliedProject.scenes[appliedProject.activeSceneId];
    const testResult = this.testRunner.run({
      taskId,
      transactionId: applied.value.id,
      world: new RuntimeWorld({ scene }),
      script: plan.value.testScript,
    });
    const record = testResult.record;
    const traceSummary = this.traceSink instanceof MemoryTraceSink ? summarizeTraceForAi(this.traceSink.drain()) : undefined;
    const recordWithTrace = traceSummary ? { ...record, traceSummary } : record;

    const finalStatus = recordWithTrace.result === "passed" ? "passed" : "failed";
    const finishedTask = {
      ...transitionTask(runningTask, finalStatus, plan.value.normalizedText),
      transactionRefs: uniqueRefs([...runningTask.transactionRefs, applied.value.id]),
    };
    this.store.recordTestResult(recordWithTrace, finishedTask, applied.value, testResult.snapshots);

    let rolledBack = false;
    let finalTransaction = this.store.project.transactions[applied.value.id] || applied.value;
    if (recordWithTrace.result !== "passed") {
      const rollback = this.store.rollback(applied.value.id);
      if (!rollback.ok) {
        return err(`test failed and rollback failed: ${rollback.error}`);
      }
      rolledBack = true;
      finalTransaction = rollback.value;
    }

    return ok({
      taskId,
      status: finalStatus,
      transaction: finalTransaction,
      dryRunProject: dryRun.value,
      rolledBack,
      traceSummary,
    });
  }

  runReactionWindowSweep(
    config: ReactionWindowSweepConfig,
    options: { taskId?: TaskId; sceneId?: string; traceLimit?: number } = {},
  ): Result<ReactionWindowSweepRunResult> {
    const scene = this.store.project.scenes[options.sceneId || this.store.project.activeSceneId];
    if (!scene) return err(`scene not found: ${options.sceneId || this.store.project.activeSceneId}`);
    return ok(
      runTestingReactionWindowSweep({
        scene,
        config,
        taskId: options.taskId,
        traceLimit: options.traceLimit,
      }),
    );
  }

  private failTask(
    task: Task,
    errorMessage: string,
    transaction?: Transaction,
    dryRunProject?: Project,
  ): Result<AiTaskExecutionResult> {
    this.store.upsertTask(transitionTask(task, "failed", task.normalizedText));
    return ok({
      taskId: task.id,
      status: "failed",
      transaction,
      dryRunProject,
      rolledBack: false,
      error: errorMessage,
    });
  }
}

function nextQueuedTask(project: Project): Task | undefined {
  return Object.values(project.tasks)
    .filter((task) => task.status === "queued")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}

function normalizeTaskText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function uniqueRefs<T extends string>(refs: T[]): T[] {
  return [...new Set(refs)];
}
