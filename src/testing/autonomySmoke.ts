import { AutonomyLoop } from "../ai/autonomyLoop";
import { AiTaskExecutor } from "../ai/taskExecutor";
import type { Entity, Project, RuntimeSnapshot } from "../project/schema";
import { ProjectStore } from "../project/projectStore";
import { createTask } from "../project/tasks";
import { makeId, type AutonomyRunId, type SnapshotId } from "../shared/types";
import { createStarterProject } from "../editor/starterProject";

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
  assert(run.value.suite.testPlan.runProjectVerification, "expected task-aware suite to run project verification");
  assert(
    run.value.suite.cases.some((testCase) => testCase.kind === "projectVerification"),
    "expected autonomy suite to include a project verification case",
  );
  assert(
    testRecords.some((record) => record.projectChecks?.some((check) => Object.prototype.hasOwnProperty.call(check.expect, "behavior.params.speed"))),
    "expected speed edit record to retain a behavior.params.speed project check",
  );
  assert(
    testRecords.some((record) => record.frameChecks.some((check) => Object.prototype.hasOwnProperty.call(check.expect, "velocity.x"))),
    "expected speed edit record to retain a runtime velocity.x check",
  );

  return {
    taskId: task.id,
    runId: autonomyRuns[0].id,
    testRecords: testRecords.length,
    suiteCases: run.value.suite.cases.map((testCase) => testCase.kind),
    finalSpeed,
  };
});

runSmoke("stale explicit targets fail before transactions", () => {
  const staleProject = createStarterProject();
  const stalePlayer = findPlayer(staleProject);
  assert(stalePlayer, "expected stale source project to contain player");
  const store = new ProjectStore(createStarterProject());
  const task = must(
    createTask({
      source: "user",
      title: "Stale target",
      userText: "Set the player speed to 420.",
      targetRefs: [{ kind: "entity", entityId: stalePlayer.id }],
    }),
  );
  store.upsertTask(task);

  const result = new AiTaskExecutor({ store }).executeTask(task.id);
  assert(result.ok, result.ok ? "" : result.error);
  assert(result.value.status === "failed", `expected stale target task to fail, got ${result.value.status}`);
  assert(result.value.error?.includes("stale target reference"), `expected stale target error, got ${result.value.error}`);
  assert(Object.keys(store.project.transactions).length === 0, "stale target should not create a transaction");
  assert(store.project.tasks[task.id].status === "failed", "stale target task should be marked failed");

  return {
    taskId: task.id,
    error: result.value.error || "",
    transactions: Object.keys(store.project.transactions).length,
  };
});

runSmoke("explicit sequential task decomposes and runs subtasks", () => {
  const store = new ProjectStore(createStarterProject());
  const player = findPlayer(store.project);
  assert(player, "starter project must contain a playerPlatformer entity");
  const parent = must(
    createTask({
      source: "user",
      title: "Sequential edit",
      userText: "Set the player speed to 420; then make the player red.",
      targetRefs: [],
    }),
  );
  store.upsertTask(parent);

  const loop = new AutonomyLoop({ store, executor: new AiTaskExecutor({ store }), traceLimit: 20, maxEntityChecks: 4 });
  const run = loop.runUntilIdle({ maxRounds: 3, includeReactionCase: false, maxFailureTasks: 0 });
  assert(run.ok, run.ok ? "" : run.error);
  assert(run.value.status === "passed", `expected decomposed task chain to pass, got ${run.value.status}`);

  const project = store.project;
  const finalPlayer = activeScene(project).entities[player.id];
  const parentTask = project.tasks[parent.id];
  const childTasks = (parentTask.subtaskIds || []).map((id) => project.tasks[id]);
  assert(parentTask.status === "passed", `expected parent passed, got ${parentTask.status}`);
  assert(childTasks.length === 2, `expected 2 subtasks, got ${childTasks.length}`);
  assert(childTasks.every((task) => task?.parentTaskId === parent.id), "expected subtasks to reference parent");
  assert(childTasks.every((task) => task?.status === "passed"), "expected subtasks to pass");
  assert(finalPlayer.behavior?.params.speed === 420, `expected final speed 420, got ${String(finalPlayer.behavior?.params.speed)}`);
  assert(finalPlayer.render?.color === "#e06c6c", `expected final color red, got ${finalPlayer.render?.color}`);

  return {
    parentTaskId: parent.id,
    subtaskIds: parentTask.subtaskIds || [],
    cycleCount: run.value.cycles.length,
    speed: finalPlayer.behavior?.params.speed,
    color: finalPlayer.render?.color,
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
  const failedRecord = Object.values(finalProject.testRecords).find((record) => record.taskId === task.id && record.result !== "passed");
  assert(failedRecord, "expected failed task to retain a failed test record");
  assert(
    failedRecord.assertionFailures?.some((failure) => failure.path === "state.__rollbackSentinel"),
    "expected failed test record to include a structured rollback sentinel assertion failure",
  );
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
    assertionFailures: failedRecord.assertionFailures?.length ?? 0,
  };
});

runSmoke("natural language edit probes stay semantic and task-aware", () => {
  const inferred = runUntargetedPlayerTask("Set the player speed to 420.");
  assert(playerSpeed(inferred.project, inferred.player.id) === 420, `expected targetless player speed 420, got ${String(playerSpeed(inferred.project, inferred.player.id))}`);
  assert(inferred.task.verificationPlan?.testIntents.includes("behavior"), "expected targetless player task to infer behavior intent");
  assert(!inferred.task.verificationPlan?.testIntents.includes("combat"), "targetless speed task should not be tagged as combat");

  const relative = runPlayerTask("Make the player twice as fast.");
  assert(playerSpeed(relative.project, relative.player.id) === 600, `expected twice-as-fast speed 600, got ${String(playerSpeed(relative.project, relative.player.id))}`);
  assert(!relative.task.verificationPlan?.testIntents.includes("combat"), "speed-only task should not be tagged as combat because the player display name contains Parry");

  const visual = runPlayerTask("Make the player red and 50% transparent.");
  assert(visual.player.render?.color === "#e06c6c", `expected red render color, got ${visual.player.render?.color}`);
  assert(visual.player.render?.opacity === 0.5, `expected opacity 0.5, got ${visual.player.render?.opacity}`);
  assert(visual.task.verificationPlan?.testIntents.includes("visual"), "expected visual task intent");
  assert(!visual.task.verificationPlan?.testIntents.includes("combat"), "visual task should not be tagged as combat");

  const collider = runPlayerTask("Set the player hitbox to 80 by 40 and make it a trigger.");
  assert(collider.player.collider?.size.x === 80 && collider.player.collider.size.y === 40, "expected hitbox size 80x40");
  assert(collider.player.collider?.trigger === true, "expected hitbox to become a trigger");
  assert(collider.task.verificationPlan?.testIntents.includes("collision"), "expected collision task intent");
  assert(!collider.task.verificationPlan?.testIntents.includes("combat"), "hitbox should not be tagged as combat just because it contains hit");

  return {
    inferredSpeed: playerSpeed(inferred.project, inferred.player.id),
    relativeSpeed: playerSpeed(relative.project, relative.player.id),
    visual: {
      color: visual.player.render?.color,
      opacity: visual.player.render?.opacity,
    },
    collider: collider.player.collider?.size,
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

function runPlayerTask(userText: string): { project: Project; player: Entity; task: Project["tasks"][string] } {
  return runPlayerTaskWithTargets(userText, true);
}

function runUntargetedPlayerTask(userText: string): { project: Project; player: Entity; task: Project["tasks"][string] } {
  return runPlayerTaskWithTargets(userText, false);
}

function runPlayerTaskWithTargets(userText: string, includeTarget: boolean): { project: Project; player: Entity; task: Project["tasks"][string] } {
  const store = new ProjectStore(createStarterProject());
  const player = findPlayer(store.project);
  assert(player, "starter project must contain a playerPlatformer entity");
  const task = must(
    createTask({
      source: "user",
      title: userText.slice(0, 32),
      userText,
      targetRefs: includeTarget ? [{ kind: "entity", entityId: player.id }] : [],
    }),
  );
  store.upsertTask(task);
  const execution = new AiTaskExecutor({ store }).executeTask(task.id);
  assert(execution.ok, execution.ok ? "" : execution.error);
  assert(execution.value.status === "passed", `expected player task to pass, got ${execution.value.status}`);
  const project = store.project;
  const updatedPlayer = activeScene(project).entities[player.id];
  assert(updatedPlayer, "expected player to exist after task execution");
  return { project, player: updatedPlayer, task: project.tasks[task.id] };
}
