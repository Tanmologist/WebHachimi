import { AutonomyLoop } from "../ai/autonomyLoop";
import { AiTaskExecutor } from "../ai/taskExecutor";
import type { Entity, Project, RuntimeSnapshot } from "../project/schema";
import { ProjectStore } from "../project/projectStore";
import { createTask } from "../project/tasks";
import { makeId, type AutonomyRunId, type SnapshotId } from "../shared/types";
import { createStarterProject } from "../v2/starterProject";

type SmokeResult = {
  name: string;
  status: "passed" | "failed";
  details: Record<string, unknown>;
  error?: string;
};

const results: SmokeResult[] = [];

runSmoke("autonomy speed edit persists records", () => {
  const store = new ProjectStore(createStarterProject());
  const player = findPlayer(store.project);
  assert(player, "starter project must contain a playerPlatformer entity");

  const task = must(
    createTask({
      source: "user",
      title: "Set player speed",
      userText: "Set the player speed to 420.",
      targetRefs: [{ kind: "entity", entityId: player.id }],
      acceptanceCriteria: [
        {
          label: "player exists after speed edit",
          target: { kind: "entity", entityId: player.id },
          expect: { exists: true },
        },
      ],
    }),
  );
  store.upsertTask(task);

  const executor = new AiTaskExecutor({ store });
  const loop = new AutonomyLoop({ store, executor, traceLimit: 20, maxEntityChecks: 4 });
  const run = loop.runOnce({ includeReactionCase: false, maxEntityChecks: 4, maxFailureTasks: 0 });
  assert(run.ok, run.ok ? "" : run.error);

  const finalProject = store.project;
  const autonomyRuns = Object.values(finalProject.autonomyRuns);
  const testRecords = Object.values(finalProject.testRecords);
  const finalSpeed = playerSpeed(finalProject, player.id);

  assert(autonomyRuns.length === 1, `expected 1 autonomy run, got ${autonomyRuns.length}`);
  assert(testRecords.length > 0, "expected AutonomyLoop/AiTaskExecutor to write test records");
  assert(autonomyRuns[0].taskId === task.id, "expected autonomy run to reference executed task");
  assert(autonomyRuns[0].testRecordRefs.length > 0, "expected autonomy run to reference test records");
  assert(
    finalSpeed === 420,
    `expected player speed 420, got ${String(finalSpeed)}; autonomyRuns=${autonomyRuns.length}, testRecords=${testRecords.length}`,
  );

  return {
    taskId: task.id,
    runId: autonomyRuns[0].id,
    testRecords: testRecords.length,
    finalSpeed,
  };
});

runSmoke("failed task rolls back entity and keeps record links", () => {
  const store = new ProjectStore(createStarterProject());
  const beforeProject = store.project;
  const player = findPlayer(beforeProject);
  assert(player, "starter project must contain a playerPlatformer entity");
  const beforeEntity = JSON.stringify(activeScene(beforeProject).entities[player.id]);

  const task = must(
    createTask({
      source: "user",
      title: "Force executor rollback",
      userText: "Touch the player, but this acceptance check intentionally fails.",
      targetRefs: [{ kind: "entity", entityId: player.id }],
      acceptanceCriteria: [
        {
          label: "intentional rollback sentinel",
          target: { kind: "entity", entityId: player.id },
          expect: { "state.__rollbackSentinel": true },
        },
      ],
    }),
  );
  store.upsertTask(task);

  const result = new AiTaskExecutor({ store }).executeTask(task.id);
  assert(result.ok, result.ok ? "" : result.error);
  assert(result.value.status === "failed", `expected failed execution, got ${result.value.status}`);
  assert(result.value.rolledBack, "expected failed execution to roll back");
  assert(result.value.transaction, "expected rollback transaction result");

  const finalProject = store.project;
  const afterEntity = JSON.stringify(activeScene(finalProject).entities[player.id]);
  const finalTask = finalProject.tasks[task.id];
  const finalTransaction = result.value.transaction ? finalProject.transactions[result.value.transaction.id] : undefined;

  assert(afterEntity === beforeEntity, "expected rollback to restore player entity exactly");
  assert(finalTask?.status === "failed", `expected task status failed, got ${finalTask?.status}`);
  assert(finalTask.testRecordRefs.length > 0, "expected failed task to retain test record refs");
  assert(finalTransaction?.status === "rolledBack", `expected transaction status rolledBack, got ${finalTransaction?.status}`);
  assert(
    finalTransaction.testRecordRefs.length > 0,
    "expected rolledBack transaction to retain test record refs after rollback",
  );

  return {
    taskId: task.id,
    transactionId: finalTransaction.id,
    taskRecordRefs: finalTask.testRecordRefs.length,
    transactionRecordRefs: finalTransaction.testRecordRefs.length,
  };
});

runSmoke("maintenance protects autonomy run snapshots", () => {
  const store = new ProjectStore(createStarterProject());
  const project = store.project;
  const scene = activeScene(project);
  const snapshotId = makeId<"SnapshotId">("snap") as SnapshotId;
  const runId = makeId<"AutonomyRunId">("auto") as AutonomyRunId;
  const capturedAt = "2026-01-01T00:00:00.000Z";
  const now = "2026-01-02T00:00:00.000Z";

  const snapshot: RuntimeSnapshot = {
    id: snapshotId,
    sceneId: scene.id,
    mode: "editorFrozen",
    frame: 0,
    timeMs: 0,
    entities: {},
    transientEntities: {},
    input: {},
    combatEvents: [],
    capturedAt,
  };
  store.recordRuntimeSnapshot(snapshot);
  store.recordAutonomyRun({
    id: runId,
    mode: "selfTest",
    status: "passed",
    createdFailureTaskIds: [],
    testRecordRefs: [],
    snapshotRefs: [snapshotId],
    transactionRefs: [],
    traceSummary: "",
    decisionSummary: "synthetic maintenance guard",
    nextSteps: [],
    startedAt: capturedAt,
    finishedAt: capturedAt,
  });

  const report = store.runProjectMaintenance({
    now,
    orphanSnapshotAgeMs: 0,
    maxSnapshotAgeMs: 0,
    maxSnapshots: 0,
    minSnapshotsToKeep: 0,
    prunePassedTestSnapshots: true,
  });
  const finalProject = store.project;

  assert(!report.deletedSnapshotIds.includes(snapshotId), "autonomy-run snapshot was deleted");
  assert(Boolean(finalProject.snapshots[snapshotId]), "protected snapshot missing after maintenance");
  assert(report.protectedSnapshotIds.includes(snapshotId), "maintenance report did not mark autonomy snapshot protected");

  return {
    runId,
    snapshotId,
    protected: report.protectedSnapshotIds.length,
    deleted: report.deletedSnapshotIds.length,
  };
});

console.log(JSON.stringify({ status: results.every((result) => result.status === "passed") ? "passed" : "failed", results }, null, 2));

const failedCount = results.filter((result) => result.status === "failed").length;
if (failedCount > 0) throw new Error(`${failedCount} autonomy smoke check(s) failed`);

function runSmoke(name: string, fn: () => Record<string, unknown>): void {
  try {
    results.push({ name, status: "passed", details: fn() });
  } catch (error) {
    results.push({
      name,
      status: "failed",
      details: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function findPlayer(project: Project): Entity | undefined {
  return Object.values(activeScene(project).entities).find((entity) => entity.behavior?.builtin === "playerPlatformer");
}

function activeScene(project: Project) {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);
  return scene;
}

function playerSpeed(project: Project, playerId: string): unknown {
  return activeScene(project).entities[playerId]?.behavior?.params.speed;
}
