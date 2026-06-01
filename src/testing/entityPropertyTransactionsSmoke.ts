import type { ProjectPatch, Scene } from "../project/schema";
import { ProjectStore, type CreateTransactionInput } from "../project/projectStore";
import { createStarterProject } from "../samples/starterProject";
import {
  planCombatLevelParamTransaction,
  planEntityBodyModeTransaction,
  planEntityColliderSolidTransaction,
  planEntityColliderTriggerTransaction,
  planEntityPersistentTransaction,
  planEntityRenderVisibleTransaction,
  type EntityPropertyTransactionPlan,
} from "../editor/entityPropertyTransactions";

run("persistent flag writes through a reversible transaction", () => {
  const store = new ProjectStore(createStarterProject());
  const scene = currentScene(store);
  const entity = firstEditableEntity(scene);
  const plan = planEntityPersistentTransaction(scene, entity, !entity.persistent);
  assert(plan.ok, plan.ok ? "" : plan.error);

  applyPlan(store, plan.value);
  assert(currentScene(store).entities[entity.id].persistent === !entity.persistent, "expected persistent flag to change");
  assert(store.snapshot().canUndo, "expected property transaction to be undoable");
  assert(store.undo(), "expected undo to restore persistent flag");
  assert(currentScene(store).entities[entity.id].persistent === entity.persistent, "expected persistent flag restored after undo");
  assert(store.redo(), "expected redo to reapply persistent flag");
  assert(currentScene(store).entities[entity.id].persistent === !entity.persistent, "expected persistent flag restored after redo");
});

run("body collider and render plans update only their target fields", () => {
  const store = new ProjectStore(createStarterProject());
  let scene = currentScene(store);
  let entity = firstEditableEntity(scene);
  const originalPosition = entity.transform.position;

  const nextMode = entity.body?.mode === "kinematic" ? "dynamic" : "kinematic";
  const bodyPlan = planEntityBodyModeTransaction(scene, entity, nextMode);
  assert(bodyPlan.ok, bodyPlan.ok ? "" : bodyPlan.error);
  applyPlan(store, bodyPlan.value);

  scene = currentScene(store);
  entity = scene.entities[entity.id];
  assert(entity.body?.mode === nextMode, "expected body mode to change");
  assert(entity.transform.position.x === originalPosition.x && entity.transform.position.y === originalPosition.y, "expected transform untouched");

  const invalidSolidPlan = planEntityColliderSolidTransaction(scene, entity, false);
  assert(!invalidSolidPlan.ok, "expected disabling solid without trigger to be rejected");

  const triggerPlan = planEntityColliderTriggerTransaction(scene, entity, !entity.collider!.trigger);
  assert(triggerPlan.ok, triggerPlan.ok ? "" : triggerPlan.error);
  applyPlan(store, triggerPlan.value);
  scene = currentScene(store);
  entity = scene.entities[entity.id];
  assert(entity.collider?.trigger === triggerPlan.value.patches[0].value, "expected collider trigger to change");

  const solidPlan = planEntityColliderSolidTransaction(scene, entity, !entity.collider!.solid);
  assert(solidPlan.ok, solidPlan.ok ? "" : solidPlan.error);
  applyPlan(store, solidPlan.value);
  scene = currentScene(store);
  entity = scene.entities[entity.id];
  assert(entity.collider?.solid === solidPlan.value.patches[0].value, "expected collider solid to change");

  const renderPlan = planEntityRenderVisibleTransaction(scene, entity, !entity.render!.visible);
  assert(renderPlan.ok, renderPlan.ok ? "" : renderPlan.error);
  applyPlan(store, renderPlan.value);
  assert(currentScene(store).entities[entity.id].render?.visible === renderPlan.value.patches[0].value, "expected render visibility to change");
});

run("combat level plans validate keys values and inverse patches", () => {
  const store = new ProjectStore(createStarterProject());
  const scene = currentScene(store);
  const entity = firstCombatEntity(scene);
  const before = Number(entity.behavior?.params.attackControlLevel);
  const plan = planCombatLevelParamTransaction(scene, entity.id, "attackControlLevel", String(before + 2));
  assert(plan.ok, plan.ok ? "" : plan.error);

  applyPlan(store, plan.value);
  assert(currentScene(store).entities[entity.id].behavior?.params.attackControlLevel === before + 2, "expected combat level to change");
  assert(store.undo(), "expected combat level undo to succeed");
  assert(currentScene(store).entities[entity.id].behavior?.params.attackControlLevel === before, "expected combat level restored after undo");

  assert(!planCombatLevelParamTransaction(scene, entity.id, "notACombatLevel", "3").ok, "expected invalid combat key rejected");
  assert(!planCombatLevelParamTransaction(scene, entity.id, "attackControlLevel", "not-a-number").ok, "expected invalid combat value rejected");
  assert(!planCombatLevelParamTransaction(scene, entity.id, "attackControlLevel", String(before)).ok, "expected unchanged combat level rejected");
});

console.log(JSON.stringify({ status: "passed" }, null, 2));

function currentScene(store: ProjectStore): Scene {
  const project = store.project;
  return project.scenes[project.activeSceneId];
}

function firstEditableEntity(scene: Scene) {
  const entity = Object.values(scene.entities).find((item) => item.persistent && item.body && item.collider && item.render);
  assert(entity, "expected editable entity with body collider and render");
  return entity;
}

function firstCombatEntity(scene: Scene) {
  const entity = Object.values(scene.entities).find((item) => typeof item.behavior?.params.attackControlLevel === "number");
  assert(entity, "expected combat entity");
  return entity;
}

function applyPlan(store: ProjectStore, plan: EntityPropertyTransactionPlan): void {
  const input: CreateTransactionInput = {
    actor: "user",
    patches: plan.patches as ProjectPatch[],
    inversePatches: plan.inversePatches as ProjectPatch[],
    diffSummary: plan.diffSummary,
  };
  const transaction = store.createTransaction(input);
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
