import { cloneJson, type SceneId } from "../shared/types";
import { createStarterProject } from "../editor/starterProject";
import { renderWorldManagerPopoverHtml } from "../editor/worldManagerViews";
import {
  planAddWorldTransaction,
  planRemoveWorldTransaction,
  planRenameWorldTransaction,
  planSelectWorldTransaction,
  uniqueWorldName,
} from "../editor/worldManagerTransactions";

const project = createStarterProject();
const activeScene = project.scenes[project.activeSceneId];
const secondScene = cloneJson(activeScene);
secondScene.id = "scene-second" as SceneId;
secondScene.name = "第二世界";
secondScene.entities = {};
project.scenes[secondScene.id] = secondScene;

const html = renderWorldManagerPopoverHtml(project);
assert(html.includes("世界管理器"), "expected popover title");
assert(html.includes('data-world-manager-action="add"'), "expected add action");
assert(html.includes('data-world-manager-action="select"'), "expected select action");
assert(html.includes('data-world-manager-action="rename"'), "expected rename action");
assert(html.includes('data-world-manager-action="remove"'), "expected remove action");
assert(html.includes(activeScene.name), "expected active scene name");
assert(html.includes("第二世界"), "expected second scene name");
assert(!html.includes("disabled>移除"), "expected remove enabled when multiple scenes exist");

delete project.scenes[secondScene.id];
const singleHtml = renderWorldManagerPopoverHtml(project);
assert(singleHtml.includes("disabled>移除"), "expected remove disabled for single remaining scene");

assert(uniqueWorldName(project, activeScene.name) === `${activeScene.name} 2`, "expected unique world names to increment");
const addPlan = planAddWorldTransaction(project);
assert(addPlan.ok && addPlan.value.kind === "transaction", "expected add world to create a transaction");
assert(addPlan.ok && addPlan.value.kind === "transaction" && addPlan.value.transaction.patches.length === 2, "expected add world transaction to set scene and active scene");
const selectPlan = planSelectWorldTransaction(project, project.activeSceneId);
assert(selectPlan.ok && selectPlan.value.kind === "notice", "expected selecting current world to be a notice");
const emptyRenamePlan = planRenameWorldTransaction(project, project.activeSceneId, "   ");
assert(emptyRenamePlan.ok && emptyRenamePlan.value.kind === "notice", "expected empty rename to be a notice");
const renamePlan = planRenameWorldTransaction(project, project.activeSceneId, "新名字");
assert(renamePlan.ok && renamePlan.value.kind === "transaction", "expected valid rename to create a transaction");
const blockedRemovePlan = planRemoveWorldTransaction(project, project.activeSceneId);
assert(blockedRemovePlan.ok && blockedRemovePlan.value.kind === "notice", "expected removing last world to be blocked by notice");
project.scenes[secondScene.id] = secondScene;
const removePlan = planRemoveWorldTransaction(project, secondScene.id);
assert(removePlan.ok && removePlan.value.kind === "transaction", "expected remove with multiple worlds to create a transaction");

console.log(JSON.stringify({ status: "passed" }, null, 2));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
