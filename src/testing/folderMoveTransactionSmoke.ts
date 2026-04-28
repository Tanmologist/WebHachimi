import type { Project } from "../project/schema";
import { ProjectStore } from "../project/projectStore";
import { cloneJson, type EntityId } from "../shared/types";
import { planPersistentFolderMoveTransaction } from "../v2/folderMoveTransaction";
import { createStarterProject } from "../v2/starterProject";

const store = new ProjectStore(createStarterProject());
const project = store.project;
const scene = activeScene(project);
const sourceFolder = scene.folders.find((folder) => folder.entityIds.length > 0);
if (!sourceFolder) throw new Error("starter project must contain a populated folder");
const entityId = sourceFolder.entityIds[0];
const entity = scene.entities[entityId];
if (!entity) throw new Error(`folder entity not found: ${entityId}`);
const targetFolder = scene.folders.find((folder) => folder.id !== sourceFolder.id);
if (!targetFolder) throw new Error("starter project must contain a second folder");

const originalFolders = cloneJson(scene.folders);
const originalFolderId = entity.folderId;
const plan = planPersistentFolderMoveTransaction(scene, entity, targetFolder.id);
if (!plan.ok) throw new Error(plan.error);

const transaction = store.createTransaction({ actor: "user", ...plan.value });
const applied = store.apply(transaction);
if (!applied.ok) throw new Error(applied.error);

let updatedScene = activeScene(store.project);
assert(updatedScene.entities[entityId].folderId === targetFolder.id, "applied folderId should point at target folder");
assert(folderContains(updatedScene, targetFolder.id, entityId), "target folder should contain moved entity");
assert(!folderContains(updatedScene, sourceFolder.id, entityId), "source folder should no longer contain moved entity");
assert(store.snapshot().canUndo, "folder move should be undoable");

const rolledBack = store.rollback(transaction.id);
if (!rolledBack.ok) throw new Error(rolledBack.error);
updatedScene = activeScene(store.project);
assertFolders(updatedScene.folders, originalFolders, "rollback folders");
assert(updatedScene.entities[entityId].folderId === originalFolderId, "rollback should restore original entity folderId state");
assert(store.project.transactions[transaction.id]?.status === "rolledBack", "rollback should mark transaction rolledBack");

console.log(
  JSON.stringify(
    {
      status: "passed",
      entityId,
      sourceFolderId: sourceFolder.id,
      targetFolderId: targetFolder.id,
      transactionId: transaction.id,
    },
    null,
    2,
  ),
);

function activeScene(project: Project) {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);
  return scene;
}

function folderContains(scene: ReturnType<typeof activeScene>, folderId: string, entityId: EntityId): boolean {
  return Boolean(scene.folders.find((folder) => folder.id === folderId)?.entityIds.includes(entityId));
}

function assertFolders(actual: ReturnType<typeof activeScene>["folders"], expected: ReturnType<typeof activeScene>["folders"], label: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: folder state mismatch`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
