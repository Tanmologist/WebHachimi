import { cloneJson, type SceneId } from "../shared/types";
import { createStarterProject } from "../editor/starterProject";
import { renderWorldManagerPopoverHtml } from "../editor/worldManagerViews";

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

console.log(JSON.stringify({ status: "passed" }, null, 2));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
