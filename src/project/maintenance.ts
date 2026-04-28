import type { Project, RuntimeSnapshot, TestRecord } from "./schema";
import type { SnapshotId, TestRecordId } from "../shared/types";

export type ProjectMaintenanceOptions = {
  now?: string;
  orphanSnapshotAgeMs?: number;
  maxSnapshotAgeMs?: number;
  maxSnapshots?: number;
  minSnapshotsToKeep?: number;
  prunePassedTestSnapshots?: boolean;
};

export type ProjectMaintenanceReport = {
  scannedAt: string;
  options: Required<ProjectMaintenanceOptions>;
  before: {
    snapshots: number;
    testRecords: number;
  };
  after: {
    snapshots: number;
    testRecords: number;
  };
  deletedSnapshotIds: SnapshotId[];
  updatedRecordIds: TestRecordId[];
  protectedSnapshotIds: SnapshotId[];
  orphanSnapshotIds: SnapshotId[];
  stalePassedSnapshotIds: SnapshotId[];
  reclaimedApproxBytes: number;
  reasons: Record<string, string>;
};

type SnapshotUse = {
  id: SnapshotId;
  capturedMs: number;
  taskRefs: number;
  brushRefs: number;
  autonomyRefs: number;
  recordRefs: TestRecordId[];
  passedRecordRefs: TestRecordId[];
  failedRecordRefs: TestRecordId[];
  isFailureSnapshot: boolean;
};

const DEFAULT_OPTIONS: Required<ProjectMaintenanceOptions> = {
  now: "",
  orphanSnapshotAgeMs: 30 * 60 * 1000,
  maxSnapshotAgeMs: 24 * 60 * 60 * 1000,
  maxSnapshots: 120,
  minSnapshotsToKeep: 20,
  prunePassedTestSnapshots: false,
};

export function planProjectMaintenance(project: Project, options: ProjectMaintenanceOptions = {}): ProjectMaintenanceReport {
  const resolved = resolveOptions(options);
  const uses = collectSnapshotUses(project, resolved);
  const recentKeep = new Set(
    [...uses.values()]
      .sort((left, right) => right.capturedMs - left.capturedMs)
      .slice(0, resolved.minSnapshotsToKeep)
      .map((use) => use.id),
  );
  const protectedIds = new Set<SnapshotId>();
  const orphanIds = new Set<SnapshotId>();
  const stalePassedIds = new Set<SnapshotId>();
  const deleteIds = new Set<SnapshotId>();
  const reasons: Record<string, string> = {};

  for (const use of uses.values()) {
    if (
      use.taskRefs > 0 ||
      use.brushRefs > 0 ||
      use.autonomyRefs > 0 ||
      use.isFailureSnapshot ||
      use.failedRecordRefs.length > 0 ||
      recentKeep.has(use.id)
    ) {
      protectedIds.add(use.id);
    }
  }

  for (const use of uses.values()) {
    if (protectedIds.has(use.id)) continue;
    const ageMs = Math.max(0, Date.parse(resolved.now) - use.capturedMs);
    const isOrphan = use.recordRefs.length === 0 && use.taskRefs === 0 && use.brushRefs === 0 && use.autonomyRefs === 0;
    const isPassedOnly = use.recordRefs.length > 0 && use.recordRefs.length === use.passedRecordRefs.length;
    if (isOrphan && ageMs >= resolved.orphanSnapshotAgeMs) {
      orphanIds.add(use.id);
      deleteIds.add(use.id);
      reasons[use.id] = `orphan snapshot older than ${formatDuration(resolved.orphanSnapshotAgeMs)}`;
    } else if (resolved.prunePassedTestSnapshots && isPassedOnly && ageMs >= resolved.maxSnapshotAgeMs) {
      stalePassedIds.add(use.id);
      deleteIds.add(use.id);
      reasons[use.id] = `passed-test snapshot older than ${formatDuration(resolved.maxSnapshotAgeMs)}`;
    }
  }

  const sortedOldest = [...uses.values()].sort((left, right) => left.capturedMs - right.capturedMs);
  for (const use of sortedOldest) {
    if (uses.size - deleteIds.size <= resolved.maxSnapshots) break;
    if (protectedIds.has(use.id) || deleteIds.has(use.id)) continue;
    deleteIds.add(use.id);
    reasons[use.id] = `snapshot cap ${resolved.maxSnapshots} exceeded`;
  }

  const deletedSnapshotIds = [...deleteIds];
  const updatedRecordIds = recordsTouchedByDeletedSnapshots(project, new Set(deletedSnapshotIds));
  const reclaimedApproxBytes = deletedSnapshotIds.reduce((sum, id) => {
    const snapshot = project.snapshots[id];
    return sum + (snapshot ? JSON.stringify(snapshot).length : 0);
  }, 0);

  return {
    scannedAt: resolved.now,
    options: resolved,
    before: {
      snapshots: Object.keys(project.snapshots).length,
      testRecords: Object.keys(project.testRecords).length,
    },
    after: {
      snapshots: Math.max(0, Object.keys(project.snapshots).length - deletedSnapshotIds.length),
      testRecords: Object.keys(project.testRecords).length,
    },
    deletedSnapshotIds,
    updatedRecordIds,
    protectedSnapshotIds: [...protectedIds],
    orphanSnapshotIds: [...orphanIds],
    stalePassedSnapshotIds: [...stalePassedIds],
    reclaimedApproxBytes,
    reasons,
  };
}

export function applyProjectMaintenance(project: Project, report: ProjectMaintenanceReport): void {
  const deleted = new Set(report.deletedSnapshotIds);
  if (deleted.size === 0) return;
  for (const id of deleted) delete project.snapshots[id];
  for (const record of Object.values(project.testRecords)) pruneRecordSnapshotRefs(record, deleted);
  project.meta.updatedAt = new Date().toISOString();
}

function collectSnapshotUses(project: Project, options: Required<ProjectMaintenanceOptions>): Map<SnapshotId, SnapshotUse> {
  const uses = new Map<SnapshotId, SnapshotUse>();
  for (const [id, snapshot] of Object.entries(project.snapshots)) {
    uses.set(id as SnapshotId, {
      id: id as SnapshotId,
      capturedMs: snapshotTimeMs(snapshot, options.now),
      taskRefs: 0,
      brushRefs: 0,
      autonomyRefs: 0,
      recordRefs: [],
      passedRecordRefs: [],
      failedRecordRefs: [],
      isFailureSnapshot: false,
    });
  }

  for (const task of Object.values(project.tasks)) {
    if (task.snapshotRef) ensureUse(uses, task.snapshotRef, options.now).taskRefs += 1;
    if (task.brushContext?.capturedSnapshotId) ensureUse(uses, task.brushContext.capturedSnapshotId, options.now).brushRefs += 1;
  }

  for (const record of Object.values(project.testRecords)) {
    const ids = recordSnapshotIds(record);
    for (const id of ids) {
      const use = ensureUse(uses, id, record.createdAt || options.now);
      use.recordRefs.push(record.id);
      if (record.result === "passed") use.passedRecordRefs.push(record.id);
      else use.failedRecordRefs.push(record.id);
    }
    if (record.failureSnapshotRef) ensureUse(uses, record.failureSnapshotRef, record.createdAt || options.now).isFailureSnapshot = true;
  }

  for (const run of Object.values(project.autonomyRuns || {})) {
    for (const id of run.snapshotRefs || []) {
      ensureUse(uses, id, run.finishedAt || run.startedAt || options.now).autonomyRefs += 1;
    }
  }

  return uses;
}

function ensureUse(uses: Map<SnapshotId, SnapshotUse>, id: SnapshotId, fallbackDate: string): SnapshotUse {
  const existing = uses.get(id);
  if (existing) return existing;
  const use: SnapshotUse = {
    id,
    capturedMs: safeTimeMs(fallbackDate, Date.now()),
    taskRefs: 0,
    brushRefs: 0,
    autonomyRefs: 0,
    recordRefs: [],
    passedRecordRefs: [],
    failedRecordRefs: [],
    isFailureSnapshot: false,
  };
  uses.set(id, use);
  return use;
}

function recordSnapshotIds(record: TestRecord): SnapshotId[] {
  return [...new Set([record.initialSnapshotRef, record.failureSnapshotRef, ...(record.snapshotRefs || [])].filter(Boolean) as SnapshotId[])];
}

function recordsTouchedByDeletedSnapshots(project: Project, deleted: Set<SnapshotId>): TestRecordId[] {
  return Object.values(project.testRecords)
    .filter((record) => recordSnapshotIds(record).some((id) => deleted.has(id)))
    .map((record) => record.id);
}

function pruneRecordSnapshotRefs(record: TestRecord, deleted: Set<SnapshotId>): void {
  if (record.initialSnapshotRef && deleted.has(record.initialSnapshotRef)) delete record.initialSnapshotRef;
  if (record.failureSnapshotRef && deleted.has(record.failureSnapshotRef)) delete record.failureSnapshotRef;
  if (record.snapshotRefs) record.snapshotRefs = record.snapshotRefs.filter((id) => !deleted.has(id));
}

function snapshotTimeMs(snapshot: RuntimeSnapshot, fallbackDate: string): number {
  const capturedAt = "capturedAt" in snapshot ? (snapshot as RuntimeSnapshot & { capturedAt?: string }).capturedAt : undefined;
  return safeTimeMs(capturedAt || fallbackDate, Date.now());
}

function resolveOptions(options: ProjectMaintenanceOptions): Required<ProjectMaintenanceOptions> {
  const now = options.now || new Date().toISOString();
  return {
    now,
    orphanSnapshotAgeMs: positiveNumber(options.orphanSnapshotAgeMs, DEFAULT_OPTIONS.orphanSnapshotAgeMs),
    maxSnapshotAgeMs: positiveNumber(options.maxSnapshotAgeMs, DEFAULT_OPTIONS.maxSnapshotAgeMs),
    maxSnapshots: positiveNumber(options.maxSnapshots, DEFAULT_OPTIONS.maxSnapshots),
    minSnapshotsToKeep: positiveNumber(options.minSnapshotsToKeep, DEFAULT_OPTIONS.minSnapshotsToKeep),
    prunePassedTestSnapshots: options.prunePassedTestSnapshots ?? DEFAULT_OPTIONS.prunePassedTestSnapshots,
  };
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value >= 0 ? value : fallback;
}

function safeTimeMs(value: string, fallback: number): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : fallback;
}

function formatDuration(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${Math.round(ms / (60 * 1000))}m`;
}
