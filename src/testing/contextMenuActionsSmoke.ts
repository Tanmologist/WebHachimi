import type { ProjectPatch, Scene } from "../project/schema";
import { ProjectStore } from "../project/projectStore";
import type { CreateTransactionInput } from "../project/projectStore";
import { type EntityId } from "../shared/types";
import {
  planDeleteEntityTransaction,
  planDuplicateEntityTransaction,
  planPresentationVisibilityTransaction,
  planResetPresentationToBodyTransaction,
  planRenameEntityTransaction,
  planRenameResourceTransaction,
  type ContextMenuTransactionPlan,
} from "../v2/contextMenuActions";
import { createStarterProject } from "../v2/starterProject";

run("duplicate creates a persistent copy in the same folder and supports undo redo", () => {
  const store = new ProjectStore(createStarterProject());
  const scene = currentScene(store);
  const source = firstPersistentEntity(scene);
  const sourceFolder = scene.folders.find((folder) => folder.entityIds.includes(source.id));
  const plan = planDuplicateEntityTransaction(scene, source, {
    newId: "entity-context-copy" as EntityId,
    positionOffset: { x: 24, y: 12 },
  });
  assert(plan.ok, plan.ok ? "" : plan.error);

  applyPlan(store, plan.value);
  const copied = currentScene(store).entities["entity-context-copy"];
  assert(copied, "expected copied entity");
  assert(copied.displayName.includes("副本"), `expected readable duplicate name, got ${copied.displayName}`);
  assert(copied.transform.position.x === source.transform.position.x + 24, "expected copied x offset");
  assert(copied.transform.position.y === source.transform.position.y + 12, "expected copied y offset");
  if (sourceFolder) {
    const copiedFolder = currentScene(store).folders.find((folder) => folder.id === sourceFolder.id);
    assert(copiedFolder?.entityIds.includes(copied.id), "expected copy to be added to source folder");
  }
  assert(store.undo(), "expected duplicate undo to succeed");
  assert(!currentScene(store).entities["entity-context-copy"], "expected duplicate removed after undo");
  assert(store.redo(), "expected duplicate redo to succeed");
  assert(currentScene(store).entities["entity-context-copy"], "expected duplicate restored after redo");
});

run("delete removes entity from scene and folders and supports undo", () => {
  const store = new ProjectStore(createStarterProject());
  const scene = currentScene(store);
  const source = firstPersistentEntity(scene);
  const plan = planDeleteEntityTransaction(scene, source);
  assert(plan.ok, plan.ok ? "" : plan.error);

  applyPlan(store, plan.value);
  const afterDelete = currentScene(store);
  assert(!afterDelete.entities[source.id], "expected entity deleted");
  assert(!afterDelete.folders.some((folder) => folder.entityIds.includes(source.id)), "expected folder references removed");
  assert(store.undo(), "expected delete undo to succeed");
  const restored = currentScene(store);
  assert(restored.entities[source.id], "expected entity restored after undo");
  assert(restored.folders.some((folder) => folder.entityIds.includes(source.id)), "expected folder reference restored");
});

run("rename entity updates display name and supports undo redo", () => {
  const store = new ProjectStore(createStarterProject());
  const scene = currentScene(store);
  const source = firstPersistentEntity(scene);
  const oldName = source.displayName;
  const plan = planRenameEntityTransaction(scene, source, "重命名方块");
  assert(plan.ok, plan.ok ? "" : plan.error);

  applyPlan(store, plan.value);
  assert(currentScene(store).entities[source.id].displayName === "重命名方块", "expected entity display name updated");
  assert(currentScene(store).entities[source.id].internalName === source.internalName, "expected internal name preserved");
  assert(store.undo(), "expected entity rename undo to succeed");
  assert(currentScene(store).entities[source.id].displayName === oldName, "expected old name restored after undo");
  assert(store.redo(), "expected entity rename redo to succeed");
  assert(currentScene(store).entities[source.id].displayName === "重命名方块", "expected new name restored after redo");
});

run("rename entity rejects blank unchanged and runtime-only targets", () => {
  const project = createStarterProject();
  const scene = project.scenes[project.activeSceneId];
  const source = firstPersistentEntity(scene);
  assert(!planRenameEntityTransaction(scene, source, "   ").ok, "expected blank entity name rejected");
  assert(!planRenameEntityTransaction(scene, source, source.displayName).ok, "expected unchanged entity name rejected");
  source.persistent = false;
  assert(!planRenameEntityTransaction(scene, source, "运行时方块").ok, "expected runtime-only entity rename rejected");
});

run("rename resource updates display name and supports undo redo", () => {
  const store = new ProjectStore(createStarterProject());
  const resource = firstResource(store);
  const oldName = resource.displayName;
  const plan = planRenameResourceTransaction(store.project.resources, resource, "重命名资源");
  assert(plan.ok, plan.ok ? "" : plan.error);

  applyPlan(store, plan.value);
  assert(store.project.resources[resource.id].displayName === "重命名资源", "expected resource display name updated");
  assert(store.project.resources[resource.id].internalName === resource.internalName, "expected resource internal name preserved");
  assert(store.undo(), "expected resource rename undo to succeed");
  assert(store.project.resources[resource.id].displayName === oldName, "expected resource old name restored after undo");
  assert(store.redo(), "expected resource rename redo to succeed");
  assert(store.project.resources[resource.id].displayName === "重命名资源", "expected resource new name restored after redo");
});

run("rename resource rejects blank and unchanged names", () => {
  const store = new ProjectStore(createStarterProject());
  const resource = firstResource(store);
  assert(!planRenameResourceTransaction(store.project.resources, resource, "").ok, "expected blank resource name rejected");
  assert(!planRenameResourceTransaction(store.project.resources, resource, resource.displayName).ok, "expected unchanged resource name rejected");
});

run("presentation visibility and reset only edit render component", () => {
  const project = createStarterProject();
  const scene = project.scenes[project.activeSceneId];
  const source = firstRenderedEntity(scene);
  source.render!.visible = true;
  source.render!.offset = { x: 13, y: -9 };
  source.render!.rotation = 0.75;
  source.render!.scale = { x: 1.4, y: 0.8 };
  source.render!.size = { x: 31, y: 27 };
  const store = new ProjectStore(project);

  let liveScene = currentScene(store);
  let liveEntity = liveScene.entities[source.id];
  const hidePlan = planPresentationVisibilityTransaction(liveScene, liveEntity, false);
  assert(hidePlan.ok, hidePlan.ok ? "" : hidePlan.error);
  applyPlan(store, hidePlan.value);
  assert(currentScene(store).entities[source.id].render?.visible === false, "expected render hidden");

  liveScene = currentScene(store);
  liveEntity = liveScene.entities[source.id];
  const resetPlan = planResetPresentationToBodyTransaction(liveScene, liveEntity);
  assert(resetPlan.ok, resetPlan.ok ? "" : resetPlan.error);
  applyPlan(store, resetPlan.value);
  const render = currentScene(store).entities[source.id].render;
  const collider = currentScene(store).entities[source.id].collider;
  assert(render?.visible === true, "expected reset to show render");
  assert(render?.offset, "expected render offset");
  assert(render.offset.x === 0 && render.offset.y === 0, "expected render offset reset");
  assert(render?.rotation === 0, "expected render rotation reset");
  assert(render?.scale, "expected render scale");
  assert(render.scale.x === 1 && render.scale.y === 1, "expected render scale reset");
  assert(render?.size?.x === collider?.size.x && render?.size?.y === collider?.size.y, "expected render size to match body");
});

console.log(JSON.stringify({ status: "passed" }, null, 2));

function currentScene(store: ProjectStore): Scene {
  const project = store.project;
  return project.scenes[project.activeSceneId];
}

function firstPersistentEntity(scene: Scene) {
  const entity = Object.values(scene.entities).find((item) => item.persistent);
  assert(entity, "expected persistent entity");
  return entity;
}

function firstRenderedEntity(scene: Scene) {
  const entity = Object.values(scene.entities).find((item) => item.persistent && item.render);
  assert(entity, "expected rendered entity");
  return entity;
}

function firstResource(store: ProjectStore) {
  const resource = Object.values(store.project.resources)[0];
  assert(resource, "expected starter resource");
  return resource;
}

function applyPlan(store: ProjectStore, plan: ContextMenuTransactionPlan): void {
  const transactionInput: CreateTransactionInput = {
    actor: "user",
    patches: plan.patches as ProjectPatch[],
    inversePatches: plan.inversePatches as ProjectPatch[],
    diffSummary: plan.diffSummary,
  };
  const transaction = store.createTransaction(transactionInput);
  const result = store.apply(transaction);
  assert(result.ok, result.ok ? "" : result.error);
}

function run(name: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
