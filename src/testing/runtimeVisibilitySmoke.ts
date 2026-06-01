import { createIntentPlan } from "../ai/intentPlanner";
import { createTask } from "../project/tasks";
import { RuntimeWorld } from "../runtime/world";
import { createStarterProject } from "../editor/starterProject";
import { renderSceneTreeHtml } from "../editor/sceneTreeController";
import type { Entity } from "../project/schema";
import type { EntityId } from "../shared/types";

const project = createStarterProject();
const scene = project.scenes[project.activeSceneId];
if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);

const template = Object.values(scene.entities).find((entity) => !entity.persistent);
assert(template, "starter project should keep at least one non-persistent template entity");

const world = new RuntimeWorld({ scene });
assert(!world.allEntities().some((entity) => entity.id === template.id), "non-persistent template should not appear before spawn");
const stableEntityView = world.allEntities();
assert(world.allEntities() === stableEntityView, "runtime entity view should reuse the merged cache until invalidated");

const treeHtml = renderSceneTreeHtml(scene, [...world.entities.values()], "", "body", project.resources);
assert(!treeHtml.includes(template.displayName), "non-persistent template should not appear in editor tree HTML");
assert(treeHtml.includes("↳"), "world tree should expose current presentation children under body entities");

const spawnedId = world.spawnTransient(template, 100);
assert(world.allEntities().some((entity) => entity.id === spawnedId), "spawned transient should appear in runtime world");
assert(world.allEntities() !== stableEntityView, "spawning a transient should invalidate the merged runtime entity view");
assert(world.entityById(spawnedId) === world.transientEntities.get(spawnedId), "by-id lookup should include spawned transient entities");
assert(![...world.entities.values()].some((entity) => entity.id === spawnedId), "spawned transient should not become editable persistent entity");
const runtimeTreeHtml = renderSceneTreeHtml(scene, world.allEntities(), "", "body", project.resources);
assert(runtimeTreeHtml.includes(template.displayName), "spawned runtime objects should appear in world tree for inspection");

const task = createTask({
  source: "user",
  title: "Do not edit runtime template",
  userText: "Set attack range to 999 on the attack hitbox.",
  targetRefs: [{ kind: "entity", entityId: template.id }],
});
assert(task.ok, task.ok ? "" : task.error);
const plan = createIntentPlan(project, task.value);
assert(plan.ok, plan.ok ? "" : plan.error);
assert(!plan.value.patches.some((patch) => patch.path.includes(`/entities/${template.id}`)), "AI plan should not patch non-persistent template entities");

const parentFollowScene = {
  ...scene,
  settings: {
    ...scene.settings,
    gravity: { x: 0, y: 0 },
  },
  entities: {
    parent: parentFollowEntity("parent" as EntityId, undefined, 100, 100, { x: 100, y: 0 }, "dynamic"),
    child: parentFollowEntity("child" as EntityId, "parent" as EntityId, 132, 92, { x: 0, y: 0 }, "none"),
    grandchild: parentFollowEntity("grandchild" as EntityId, "child" as EntityId, 145, 94, { x: 0, y: 0 }, "none"),
    projectile: projectileEntity("projectile" as EntityId, "parent" as EntityId, 180, 100),
  },
};
const parentFollowWorld = new RuntimeWorld({ scene: parentFollowScene });
parentFollowWorld.setMode("game");
parentFollowWorld.runFixedFrame();
const liveParent = requireEntity(parentFollowWorld, "parent");
const liveChild = requireEntity(parentFollowWorld, "child");
const liveGrandchild = requireEntity(parentFollowWorld, "grandchild");
const liveProjectile = requireEntity(parentFollowWorld, "projectile");
assert(round(liveChild.transform.position.x - liveParent.transform.position.x) === 32, "child should keep x offset after parent movement");
assert(round(liveChild.transform.position.y - liveParent.transform.position.y) === -8, "child should keep y offset after parent movement");
assert(round(liveGrandchild.transform.position.x - liveChild.transform.position.x) === 13, "grandchild should keep x offset after parent movement");
assert(round(liveProjectile.transform.position.x) === 180, "projectile source parent should not make the shot follow parent movement");

console.log(
  JSON.stringify(
    {
      status: "passed",
      hiddenTemplate: {
        id: template.id,
        displayName: template.displayName,
      },
      spawnedId,
      editableCount: world.entities.size,
      runtimeCount: world.allEntities().length,
      parentFollow: {
        parentX: round(liveParent.transform.position.x),
        childX: round(liveChild.transform.position.x),
        projectileX: round(liveProjectile.transform.position.x),
      },
      aiPatchCount: plan.value.patches.length,
    },
    null,
    2,
  ),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parentFollowEntity(
  id: EntityId,
  parentId: EntityId | undefined,
  x: number,
  y: number,
  velocity: { x: number; y: number },
  mode: "dynamic" | "none",
): Entity {
  return {
    id,
    internalName: id,
    displayName: id,
    kind: mode === "none" ? "effect" : "entity",
    persistent: true,
    parentId,
    transform: {
      position: { x, y },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    body: {
      mode,
      velocity,
      gravityScale: 0,
      friction: 0,
      bounce: 0,
    },
    collider: {
      shape: "box",
      size: { x: 10, y: 10 },
      solid: mode !== "none",
      trigger: mode === "none",
      layerMask: ["world"],
    },
    resources: [],
    tags: [],
  };
}

function projectileEntity(id: EntityId, parentId: EntityId, x: number, y: number): Entity {
  return {
    ...parentFollowEntity(id, parentId, x, y, { x: 0, y: 0 }, "none"),
    kind: "entity",
    internalName: "Bullet",
    displayName: "Bullet",
    behavior: {
      builtin: "projectile",
      description: "shot bullet",
      params: {},
    },
    tags: ["projectile", "bullet"],
  };
}

function requireEntity(world: RuntimeWorld, entityId: string): Entity {
  const entity = world.entityById(entityId as EntityId);
  if (!entity) throw new Error(`runtime entity not found: ${entityId}`);
  return entity;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
