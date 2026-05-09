import {
  normalizeProjectDefaults,
  type Project,
  type ProjectPatch,
  type RuntimeSnapshot,
  type Task,
  type TestRecord,
  type Transaction,
  type AutonomyRun,
} from "./schema";
import { applyProjectMaintenance, planProjectMaintenance, type ProjectMaintenanceOptions, type ProjectMaintenanceReport } from "./maintenance";
import { applyTransaction, dryRunTransaction, rollbackTransaction } from "./transactions";
import { projectHash, summarizeTransaction } from "./diff";
import { cloneJson, err, makeId, ok, type Result } from "../shared/types";
import type { TaskId, TransactionId } from "../shared/types";

export type ProjectStoreSnapshot = {
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
};

export type CreateTransactionInput = {
  actor: Transaction["actor"];
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  taskId?: TaskId;
  diffSummary?: string;
};

const MAX_HISTORY = 128;

export class ProjectStore {
  private projectValue: Project;
  private readonly history: Project[] = [];
  private readonly future: Project[] = [];

  constructor(project: Project) {
    this.projectValue = normalizeProjectDefaults(cloneJson(project));
  }

  get project(): Project {
    return normalizeProjectDefaults(cloneJson(this.projectValue));
  }

  // Hot paths such as rendering and AI planning can read through this accessor
  // to avoid cloning the full project graph on every access. Callers must treat
  // the returned object as immutable.
  peekProject(): Project {
    return this.projectValue;
  }

  exportProject(): Project {
    return this.project;
  }

  replace(project: Project): void {
    this.history.length = 0;
    this.future.length = 0;
    this.projectValue = normalizeProjectDefaults(cloneJson(project));
  }

  snapshot(): ProjectStoreSnapshot {
    return {
      project: this.project,
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
    };
  }

  createTransaction(input: CreateTransactionInput): Transaction {
    const transaction: Transaction = {
      id: makeId<"TransactionId">("txn") as TransactionId,
      actor: input.actor,
      status: "dryRun",
      baseProjectHash: projectHash(this.projectValue),
      taskId: input.taskId,
      patches: input.patches,
      inversePatches: input.inversePatches,
      diffSummary: input.diffSummary || "",
      testRecordRefs: [],
      createdAt: new Date().toISOString(),
    };
    return { ...transaction, diffSummary: summarizeTransaction(transaction) };
  }

  dryRun(transaction: Transaction): Result<Project> {
    const result = dryRunTransaction(this.projectValue, transaction);
    if (!result.ok) return result;
    return ok(normalizeProjectDefaults(result.value.project));
  }

  apply(transaction: Transaction): Result<Transaction> {
    if (transaction.baseProjectHash !== projectHash(this.projectValue)) {
      return err("transaction base project hash does not match current project");
    }
    const result = applyTransaction(this.projectValue, transaction);
    if (!result.ok) return result;
    this.pushHistory(cloneJson(this.projectValue));
    this.future.length = 0;
    this.projectValue = normalizeProjectDefaults(result.value.project);
    return ok(result.value.transaction);
  }

  rollback(transactionId: TransactionId): Result<Transaction> {
    const transaction = this.projectValue.transactions[transactionId];
    if (!transaction) return err(`transaction not found: ${transactionId}`);
    if (transaction.status !== "applied") return err(`transaction is not applied: ${transaction.status}`);
    const laterApplied = latestAppliedTransaction(this.projectValue);
    if (laterApplied && laterApplied.id !== transactionId) {
      return err(`cannot rollback ${transactionId}; latest applied transaction is ${laterApplied.id}`);
    }
    const result = rollbackTransaction(this.projectValue, transaction);
    if (!result.ok) return result;
    this.pushHistory(cloneJson(this.projectValue));
    this.future.length = 0;
    this.projectValue = normalizeProjectDefaults(result.value.project);
    return ok(result.value.transaction);
  }

  upsertTask(task: Task): void {
    this.pushHistory(cloneJson(this.projectValue));
    this.future.length = 0;
    this.projectValue.tasks[task.id] = cloneJson(task);
    this.projectValue.meta.updatedAt = new Date().toISOString();
  }

  recordRuntimeSnapshot(snapshot: RuntimeSnapshot): void {
    this.pushHistory(cloneJson(this.projectValue));
    this.future.length = 0;
    this.projectValue.snapshots[snapshot.id] = cloneJson(snapshot);
    this.projectValue.meta.updatedAt = new Date().toISOString();
  }

  recordRuntimeSnapshots(snapshots: RuntimeSnapshot[]): void {
    if (snapshots.length === 0) return;
    this.pushHistory(cloneJson(this.projectValue));
    this.future.length = 0;
    for (const snapshot of snapshots) this.projectValue.snapshots[snapshot.id] = cloneJson(snapshot);
    this.projectValue.meta.updatedAt = new Date().toISOString();
  }

  recordTestResult(record: TestRecord, task?: Task, transaction?: Transaction, snapshots: RuntimeSnapshot[] = []): void {
    this.pushHistory(cloneJson(this.projectValue));
    this.future.length = 0;
    for (const snapshot of snapshots) this.projectValue.snapshots[snapshot.id] = cloneJson(snapshot);
    this.projectValue.testRecords[record.id] = cloneJson(record);

    if (task) {
      const existing = this.projectValue.tasks[task.id] || task;
      this.projectValue.tasks[task.id] = {
        ...cloneJson(task),
        testRecordRefs: uniqueRefs([...existing.testRecordRefs, record.id]),
        updatedAt: new Date().toISOString(),
      };
    }

    if (transaction) {
      const existing = this.projectValue.transactions[transaction.id] || transaction;
      this.projectValue.transactions[transaction.id] = {
        ...cloneJson(existing),
        testRecordRefs: uniqueRefs([...existing.testRecordRefs, record.id]),
      };
    }

    this.projectValue.meta.updatedAt = new Date().toISOString();
  }

  recordAutonomyRun(run: AutonomyRun): void {
    this.pushHistory(cloneJson(this.projectValue));
    this.future.length = 0;
    this.projectValue.autonomyRuns[run.id] = cloneJson(run);
    this.projectValue.meta.updatedAt = new Date().toISOString();
  }

  previewProjectMaintenance(options: ProjectMaintenanceOptions = {}): ProjectMaintenanceReport {
    return planProjectMaintenance(this.projectValue, options);
  }

  runProjectMaintenance(options: ProjectMaintenanceOptions = {}): ProjectMaintenanceReport {
    const report = planProjectMaintenance(this.projectValue, options);
    if (report.deletedSnapshotIds.length === 0 && report.updatedRecordIds.length === 0) return report;
    this.pushHistory(cloneJson(this.projectValue));
    this.future.length = 0;
    applyProjectMaintenance(this.projectValue, report);
    this.projectValue = normalizeProjectDefaults(this.projectValue);
    return report;
  }

  undo(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.future.push(cloneJson(this.projectValue));
    this.projectValue = normalizeProjectDefaults(previous);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.pushHistory(cloneJson(this.projectValue));
    this.projectValue = normalizeProjectDefaults(next);
    return true;
  }

  private pushHistory(snapshot: Project): void {
    this.history.push(snapshot);
    trimHistory(this.history);
  }
}

function uniqueRefs<T extends string>(refs: T[]): T[] {
  return [...new Set(refs)];
}

function latestAppliedTransaction(project: Project): Transaction | undefined {
  return Object.values(project.transactions)
    .filter((transaction) => transaction.status === "applied")
    .sort((left, right) => (right.appliedAt || right.createdAt).localeCompare(left.appliedAt || left.createdAt))[0];
}

function trimHistory(history: Project[]): void {
  if (history.length <= MAX_HISTORY) return;
  history.splice(0, history.length - MAX_HISTORY);
}
