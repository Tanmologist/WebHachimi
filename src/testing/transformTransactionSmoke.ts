import type { Project, ProjectPatch } from "../project/schema";
import { ProjectStore } from "../project/projectStore";
import type { Transform2D } from "../shared/types";
import { createStarterProject } from "../v2/starterProject";

type SmokeResult = {
  name: string;
  status: "passed" | "failed";
  details: Record<string, unknown>;
  error?: string;
};

const results: SmokeResult[] = [];

runSmoke("user transform transaction applies and undo/redo restores", () => {
  const store = new ProjectStore(createStarterProject());
  const beforeProject = store.project;
  const scene = activeScene(beforeProject);
  const entity = Object.values(scene.entities).find((item) => item.persistent);
  assert(entity, "starter project must contain a persistent entity");

  const originalTransform = cloneTransform(entity.transform);
  const nextTransform: Transform2D = {
    position: {
      x: originalTransform.position.x + 24,
      y: originalTransform.position.y + 12,
    },
    rotation: originalTransform.rotation + 0.25,
    scale: {
      x: originalTransform.scale.x * 1.2,
      y: originalTransform.scale.y * 0.8,
    },
  };
  const path = `/scenes/${scene.id}/entities/${entity.id}/transform` as ProjectPatch["path"];
  const transaction = store.createTransaction({
    actor: "user",
    patches: [{ op: "set", path, value: nextTransform }],
    inversePatches: [{ op: "set", path, value: originalTransform }],
    diffSummary: `Adjust ${entity.displayName} transform.`,
  });

  const applied = store.apply(transaction);
  assert(applied.ok, applied.ok ? "" : applied.error);
  const appliedProject = store.project;
  const appliedEntity = activeScene(appliedProject).entities[entity.id];
  const appliedTransaction = appliedProject.transactions[transaction.id];

  assertTransform(appliedEntity.transform, nextTransform, "applied transform");
  assert(appliedTransaction?.actor === "user", `expected actor user, got ${appliedTransaction?.actor}`);
  assert(appliedTransaction?.status === "applied", `expected status applied, got ${appliedTransaction?.status}`);
  assert(Boolean(appliedTransaction.appliedAt), "expected appliedAt to be written");
  assert(appliedTransaction.diffSummary.length > 0, "expected diffSummary to be non-empty");
  assert(appliedTransaction.patches[0]?.path === path, "applied transaction path mismatch");
  const inversePatch = appliedTransaction.inversePatches[0];
  assert(inversePatch?.op === "set", `expected inverse patch op set, got ${inversePatch?.op}`);
  assertTransform(inversePatch.value as Transform2D, originalTransform, "inverse transform");

  assert(store.snapshot().canUndo, "expected transform transaction to be undoable");
  assert(store.undo(), "expected undo to succeed");
  const undoneProject = store.project;
  assertTransform(activeScene(undoneProject).entities[entity.id].transform, originalTransform, "undo transform");
  assert(!undoneProject.transactions[transaction.id], "expected undo to restore the pre-transaction project snapshot");
  assert(store.snapshot().canRedo, "expected transform transaction to be redoable");
  assert(store.redo(), "expected redo to succeed");
  const redoneProject = store.project;
  assertTransform(activeScene(redoneProject).entities[entity.id].transform, nextTransform, "redo transform");
  assert(redoneProject.transactions[transaction.id]?.status === "applied", "expected redo to restore the applied transaction");

  return {
    entityId: entity.id,
    transactionId: transaction.id,
    path,
    before: originalTransform.position,
    after: nextTransform.position,
  };
});

runSmoke("transform rollback restores inverse patch", () => {
  const store = new ProjectStore(createStarterProject());
  const scene = activeScene(store.project);
  const entity = Object.values(scene.entities).find((item) => item.persistent);
  assert(entity, "starter project must contain a persistent entity");

  const originalTransform = cloneTransform(entity.transform);
  const nextTransform: Transform2D = {
    ...originalTransform,
    position: {
      x: originalTransform.position.x - 16,
      y: originalTransform.position.y + 32,
    },
  };
  const path = `/scenes/${scene.id}/entities/${entity.id}/transform` as ProjectPatch["path"];
  const transaction = store.createTransaction({
    actor: "user",
    patches: [{ op: "set", path, value: nextTransform }],
    inversePatches: [{ op: "set", path, value: originalTransform }],
    diffSummary: `Adjust ${entity.displayName} transform for rollback.`,
  });

  const applied = store.apply(transaction);
  assert(applied.ok, applied.ok ? "" : applied.error);
  const rolledBack = store.rollback(transaction.id);
  assert(rolledBack.ok, rolledBack.ok ? "" : rolledBack.error);

  const finalProject = store.project;
  const finalEntity = activeScene(finalProject).entities[entity.id];
  const finalTransaction = finalProject.transactions[transaction.id];
  assertTransform(finalEntity.transform, originalTransform, "rolled back transform");
  assert(finalTransaction?.status === "rolledBack", `expected status rolledBack, got ${finalTransaction?.status}`);

  return {
    entityId: entity.id,
    transactionId: transaction.id,
    status: finalTransaction.status,
    restored: finalEntity.transform.position,
  };
});

console.log(JSON.stringify({ status: results.every((result) => result.status === "passed") ? "passed" : "failed", results }, null, 2));

const failedCount = results.filter((result) => result.status === "failed").length;
if (failedCount > 0) throw new Error(`${failedCount} transaction smoke check(s) failed`);

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

function activeScene(project: Project) {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);
  return scene;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertTransform(actual: Transform2D, expected: Transform2D, label: string): void {
  assert(actual.position.x === expected.position.x, `${label}: expected x ${expected.position.x}, got ${actual.position.x}`);
  assert(actual.position.y === expected.position.y, `${label}: expected y ${expected.position.y}, got ${actual.position.y}`);
  assert(actual.rotation === expected.rotation, `${label}: expected rotation ${expected.rotation}, got ${actual.rotation}`);
  assert(actual.scale.x === expected.scale.x, `${label}: expected scale.x ${expected.scale.x}, got ${actual.scale.x}`);
  assert(actual.scale.y === expected.scale.y, `${label}: expected scale.y ${expected.scale.y}, got ${actual.scale.y}`);
}

function cloneTransform(transform: Transform2D): Transform2D {
  return {
    position: { ...transform.position },
    rotation: transform.rotation,
    scale: { ...transform.scale },
  };
}
