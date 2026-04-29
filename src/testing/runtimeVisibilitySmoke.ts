import { createIntentPlan } from "../ai/intentPlanner";
import { createTask } from "../project/tasks";
import { RuntimeWorld } from "../runtime/world";
import { createStarterProject } from "../v2/starterProject";
import { renderSceneTreeHtml } from "../v2/sceneTreeController";

const project = createStarterProject();
const scene = project.scenes[project.activeSceneId];
if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);

const template = Object.values(scene.entities).find((entity) => !entity.persistent);
assert(template, "starter project should keep at least one non-persistent template entity");

const world = new RuntimeWorld({ scene });
assert(!world.allEntities().some((entity) => entity.id === template.id), "non-persistent template should not appear before spawn");

const treeHtml = renderSceneTreeHtml(scene, [...world.entities.values()], "", "body", project.resources);
assert(!treeHtml.includes(template.displayName), "non-persistent template should not appear in editor tree HTML");
assert(treeHtml.includes("↳"), "world tree should expose current presentation children under body entities");

const spawnedId = world.spawnTransient(template, 100);
assert(world.allEntities().some((entity) => entity.id === spawnedId), "spawned transient should appear in runtime world");
assert(![...world.entities.values()].some((entity) => entity.id === spawnedId), "spawned transient should not become editable persistent entity");

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
      aiPatchCount: plan.value.patches.length,
    },
    null,
    2,
  ),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
