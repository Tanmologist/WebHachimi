import { AiTaskExecutor } from "../ai/taskExecutor";
import type { Project } from "../project/schema";
import { ProjectStore } from "../project/projectStore";
import type { EntityId, TaskId } from "../shared/types";
import { createStarterProject } from "../v2/starterProject";
import { createTaskWorkflowController } from "../v2/taskWorkflowController";
import { createSuperBrushStroke, type SuperBrushDraft } from "../editor/superBrush";

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
  aiExecutor: executor,
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

controller.runNextAiTask();
const finalProject = store.project;
const finalTask = finalProject.tasks[task.id];
assert(syncCount === 1, `expected syncWorldFromStore to run once after AI execution, got ${syncCount}`);
assert(finalTask.status === "passed", `expected AI task status passed, got ${finalTask.status}`);
assert(playerSpeed(finalProject, player.id) === 420, `expected player speed 420, got ${playerSpeed(finalProject, player.id)}`);
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
const taskCountBeforeTargetOnlyBrush = Object.keys(store.project.tasks).length;
controller.queueTaskFromText("This target-only click should not become a super brush task.");
assert(
  Object.keys(store.project.tasks).length === taskCountBeforeTargetOnlyBrush,
  "expected target-only empty brush to be rejected",
);
assert(!pendingBrush, "expected invalid target-only brush to be cleared");

const stroke = createSuperBrushStroke([
  { x: 0, y: 0 },
  { x: 48, y: 0 },
]);
assert(stroke.ok, "expected test brush stroke to be valid");
pendingBrush = {
  strokes: [stroke.value],
  annotations: [],
  selectionTargets: [{ kind: "entity", entityId: player.id }],
  selectionBox: { x: 0, y: -12, w: 48, h: 24 },
};
controller.queueTaskFromText("Use the super brush context to make this target green.");
const superBrushTask = store.project.tasks[previewTaskId];
assert(superBrushTask, "expected super brush task to be stored and previewed");
assert(superBrushTask.source === "superBrush", `expected superBrush source, got ${superBrushTask.source}`);
assert(superBrushTask.brushContext?.strokes.length === 1, "expected super brush task to keep one stroke");
assert(
  superBrushTask.brushContext?.targetEntityIds.includes(player.id),
  "expected super brush task to identify the selected entity target",
);
assert(superBrushTask.brushContext?.selectionBox?.w === 48, "expected super brush task to keep selection box");
assert(superBrushTask.brushContext?.summary?.includes("1 stroke"), "expected super brush summary to mention stroke count");
assert(!pendingBrush, "expected pending brush to be cleared after valid super brush queue");

console.log(
  JSON.stringify(
    {
      status: "passed",
      taskId: task.id,
      finalStatus: finalTask.status,
      finalSpeed: playerSpeed(finalProject, player.id),
      superBrushTaskId: superBrushTask.id,
      superBrushSummary: superBrushTask.brushContext?.summary,
      focusCount,
      renderCount,
      syncCount,
      traceCount: Object.keys(traces).length,
    },
    null,
    2,
  ),
);

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
