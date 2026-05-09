import { AiTaskExecutor } from "../ai/taskExecutor";
import type { Project } from "../project/schema";
import { ProjectStore } from "../project/projectStore";
import type { EntityId, TaskId } from "../shared/types";
import { createStarterProject } from "../editor/starterProject";
import { createTaskWorkflowController } from "../editor/taskWorkflowController";
import {
  compileSuperBrushContext,
  createSuperBrushStroke,
  createTaskFromSuperBrush,
  rebuildSuperBrushDraftTargets,
  superBrushSelectionBox,
  type SuperBrushDraft,
} from "../editor/superBrush";

const store = new ProjectStore(createStarterProject());
const executor = new AiTaskExecutor({ store });
const player = findPlayer(store.project);
if (!player) throw new Error("starter project must contain a playerPlatformer entity");

let pendingBrush: SuperBrushDraft | undefined;
let notice = "";
let previewTaskId: TaskId | "" = "";
let clearedInput = false;
let focusCount = 0;
let renderCount = 0;
let syncCount = 0;
let projectChangeCount = 0;
const traces: Record<string, string> = {};

const controller = createTaskWorkflowController({
  store,
  executeNextAiTask: async () => executor.executeNextQueuedTask(),
  currentTargets: () => [{ kind: "entity", entityId: player.id }],
  getPendingBrush: () => pendingBrush,
  setPendingBrush: (draft) => {
    pendingBrush = draft;
  },
  clearTaskInput: () => {
    clearedInput = true;
  },
  focusTaskInput: () => {
    focusCount += 1;
  },
  setPreviewTaskId: (taskId) => {
    previewTaskId = taskId;
  },
  setAiTrace: (taskId, traceSummary) => {
    traces[taskId] = traceSummary;
  },
  syncWorldFromStore: () => {
    syncCount += 1;
  },
  onProjectChanged: () => {
    projectChangeCount += 1;
  },
  setNotice: (value) => {
    notice = value;
  },
  renderAll: () => {
    renderCount += 1;
  },
});

controller.queueTaskFromText("   ");
assert(focusCount === 1, `expected empty task to focus input once, got ${focusCount}`);
assert(renderCount === 1, `expected empty task to render once, got ${renderCount}`);
assert(notice.length > 0, "expected empty task notice");

controller.queueTaskFromText("Set the player speed to 420.");
const task = Object.values(store.project.tasks).find((item) => item.id === previewTaskId);
assert(task, "expected queued task to be stored and previewed");
assert(task.status === "queued", `expected task status queued, got ${task.status}`);
assert(clearedInput, "expected task input to be cleared after queue");
assert(!pendingBrush, "expected pending brush to be cleared after queue");
assert(getProjectChangeCount() === 1, `expected one project change after queue, got ${projectChangeCount}`);

void (async () => {
await controller.runNextAiTask();
const finalProject = store.project;
const finalTask = finalProject.tasks[task.id];
assert(syncCount === 1, `expected syncWorldFromStore to run once after AI execution, got ${syncCount}`);
assert(finalTask.status === "passed", `expected AI task status passed, got ${finalTask.status}`);
assert(playerSpeed(finalProject, player.id) === 420, `expected player speed 420, got ${playerSpeed(finalProject, player.id)}`);
assert(
  finalTask.verificationPlan?.projectChecks.some((check) => Object.prototype.hasOwnProperty.call(check.expect, "behavior.params.speed")),
  "expected speed task verification plan to check behavior.params.speed",
);
const speedRecord = Object.values(finalProject.testRecords).find((record) => record.taskId === task.id);
assert(speedRecord, "expected speed task test record to be stored");
assert(
  speedRecord.projectChecks?.some((check) => Object.prototype.hasOwnProperty.call(check.expect, "behavior.params.speed")),
  "expected speed task test record to retain project checks",
);
assert((speedRecord.assertionFailures?.length ?? 0) === 0, "expected passing speed task to have no assertion failures");
assert(Object.keys(traces).length > 0, "expected AI trace to be recorded");
assert(previewTaskId === task.id, "expected executed task to remain previewed");
assert(getProjectChangeCount() === 2, `expected two project changes after AI execution, got ${projectChangeCount}`);

pendingBrush = {
  strokes: [],
  annotations: [],
  selectionTargets: [{ kind: "scene", sceneId: store.project.activeSceneId }],
};
const taskCountBeforeEmptyBrush = Object.keys(store.project.tasks).length;
controller.queueTaskFromText("This should not become a super brush task.");
assert(
  Object.keys(store.project.tasks).length === taskCountBeforeEmptyBrush,
  "expected scene-only empty brush to be rejected",
);
assert(!pendingBrush, "expected invalid empty brush to be cleared");

pendingBrush = {
  strokes: [],
  annotations: [],
  selectionTargets: [{ kind: "entity", entityId: player.id }],
};
controller.queueTaskFromText("Use the clicked super brush target to make the player brighter.");
const targetOnlyBrushTask = store.project.tasks[previewTaskId];
assert(targetOnlyBrushTask, "expected entity-only super brush task to be stored");
assert(targetOnlyBrushTask.source === "superBrush", `expected entity-only brush source, got ${targetOnlyBrushTask.source}`);
assert(
  targetOnlyBrushTask.brushContext?.targetEntityIds.includes(player.id),
  "expected entity-only super brush task to preserve clicked target",
);
assert(targetOnlyBrushTask.brushContext?.strokes.length === 0, "expected entity-only brush task to have no strokes");
assert(!pendingBrush, "expected entity-only brush to be cleared after queue");

const stroke = createSuperBrushStroke([
  { x: 0, y: 0 },
  { x: 48, y: 0 },
]);
assert(stroke.ok, "expected test brush stroke to be valid");
pendingBrush = {
  strokes: [stroke.value],
  annotations: [],
  selectionTargets: [
    { kind: "entity", entityId: player.id },
    { kind: "area", sceneId: store.project.activeSceneId, rect: { x: 0, y: -12, w: 48, h: 24 } },
    { kind: "area", sceneId: store.project.activeSceneId, rect: { x: 60, y: 10, w: 20, h: 20 } },
  ],
  selectionBox: { x: 0, y: -12, w: 48, h: 24 },
};
const mergedBrushBox = superBrushSelectionBox(pendingBrush);
assert(mergedBrushBox?.x === 0, "expected merged brush selection box to keep the left edge");
assert(mergedBrushBox?.w === 80, `expected merged brush selection width 80, got ${mergedBrushBox?.w}`);

const firstTrackedStroke = createSuperBrushStroke([
  { x: 0, y: 0 },
  { x: 20, y: 0 },
]);
const secondTrackedStroke = createSuperBrushStroke([
  { x: 90, y: 10 },
  { x: 130, y: 10 },
]);
assert(firstTrackedStroke.ok, "expected first tracked brush stroke to be valid");
assert(secondTrackedStroke.ok, "expected second tracked brush stroke to be valid");
const trackedBrush = rebuildSuperBrushDraftTargets({
  strokes: [firstTrackedStroke.value, secondTrackedStroke.value],
  annotations: [],
  selectionTargets: [],
  strokeTargetRefs: {
    [firstTrackedStroke.value.id]: [{ kind: "entity", entityId: player.id }],
    [secondTrackedStroke.value.id]: [{ kind: "area", sceneId: store.project.activeSceneId, rect: { x: 90, y: -2, w: 40, h: 24 } }],
  },
});
const trackedAfterUndo = rebuildSuperBrushDraftTargets({
  ...trackedBrush,
  strokes: [firstTrackedStroke.value],
});
assert(trackedAfterUndo.selectionTargets.length === 1, "expected undo to remove the last stroke target refs");
assert(trackedAfterUndo.selectionTargets[0]?.kind === "entity", "expected undo to keep only the first stroke target");
assert(!trackedAfterUndo.selectionBox, "expected undo to remove the last stroke area box");
controller.queueTaskFromText("Use the super brush context to make this target green.");
const superBrushTask = store.project.tasks[previewTaskId];
assert(superBrushTask, "expected super brush task to be stored and previewed");
assert(superBrushTask.source === "superBrush", `expected superBrush source, got ${superBrushTask.source}`);
assert(superBrushTask.brushContext?.strokes.length === 1, "expected super brush task to keep one stroke");
assert(
  superBrushTask.brushContext?.targetEntityIds.includes(player.id),
  "expected super brush task to identify the selected entity target",
);
assert(superBrushTask.brushContext?.selectionBox?.w === 80, "expected super brush task to keep merged selection box");
assert(superBrushTask.brushContext?.summary?.includes("1 stroke"), "expected super brush summary to mention stroke count");
assert(superBrushTask.brushContext?.compiled?.strokeTargets.length === 1, "expected compiled brush context to keep stroke-target evidence");
assert(superBrushTask.brushContext?.compiled?.areas.length, "expected compiled brush context to expose area evidence");
assert(superBrushTask.brushContext?.raw?.targetRefs.length, "expected raw brush context to keep original target refs");
assert(!pendingBrush, "expected pending brush to be cleared after valid super brush queue");

const areaStore = new ProjectStore(createStarterProject());
const areaSceneId = areaStore.project.activeSceneId;
const areaStroke = createSuperBrushStroke([
  { x: 300, y: 320 },
  { x: 420, y: 320 },
]);
assert(areaStroke.ok, "expected area stroke to be valid");
const areaDraft: SuperBrushDraft = {
  strokes: [areaStroke.value],
  annotations: [],
  selectionTargets: [{ kind: "area", sceneId: areaSceneId, rect: { x: 300, y: 300, w: 120, h: 40 } }],
  strokeTargetRefs: {
    [areaStroke.value.id]: [{ kind: "area", sceneId: areaSceneId, rect: { x: 300, y: 300, w: 120, h: 40 } }],
  },
};
const compiledArea = compileSuperBrushContext(areaDraft);
assert(compiledArea.areas.length > 0, "expected compiler to turn area stroke into area evidence");
const areaTask = createTaskFromSuperBrush({ userText: "Add a danger zone here.", draft: areaDraft });
assert(areaTask.ok, "expected area brush task to be valid");
areaStore.upsertTask(areaTask.value);
const areaRun = new AiTaskExecutor({ store: areaStore }).executeNextQueuedTask();
assert(areaRun.ok, "expected area brush AI execution to run");
assert(areaRun.value?.status === "passed", `expected area brush task to pass, got ${areaRun.value?.status}`);
const hazard = Object.values(activeScene(areaStore.project).entities).find((entity) => entity.tags.includes("super-brush") && entity.tags.includes("hazard"));
assert(hazard, "expected super brush area intent to create a hazard entity");
assert(hazard.collider?.trigger === true, "expected generated hazard to be a trigger");
assert(hazard.collider?.size.x === 120 && hazard.collider.size.y === 40, "expected generated hazard to use brush area size");
const areaFinalTask = areaStore.project.tasks[areaTask.value.id];
assert(
  areaFinalTask.verificationPlan?.projectChecks.some((check) => Object.prototype.hasOwnProperty.call(check.expect, "collider.size.x")),
  "expected area brush verification plan to check generated collider width",
);
const areaRecord = Object.values(areaStore.project.testRecords).find((record) => record.taskId === areaTask.value.id);
assert(areaRecord?.projectChecks?.length, "expected area brush execution to retain project-level checks");

console.log(
  JSON.stringify(
    {
      status: "passed",
      taskId: task.id,
      finalStatus: finalTask.status,
      finalSpeed: playerSpeed(finalProject, player.id),
      superBrushTaskId: superBrushTask.id,
      superBrushSummary: superBrushTask.brushContext?.summary,
      compiledAreaCount: superBrushTask.brushContext?.compiled?.areas.length,
      generatedHazardId: hazard.id,
      focusCount,
      renderCount,
      syncCount,
      traceCount: Object.keys(traces).length,
    },
    null,
    2,
  ),
);
})();

function findPlayer(project: Project) {
  return Object.values(activeScene(project).entities).find((entity) => entity.behavior?.builtin === "playerPlatformer");
}

function activeScene(project: Project) {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);
  return scene;
}

function playerSpeed(project: Project, playerId: EntityId): number | undefined {
  return activeScene(project).entities[playerId]?.behavior?.params.speed as number | undefined;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function getProjectChangeCount(): number {
  return projectChangeCount;
}
