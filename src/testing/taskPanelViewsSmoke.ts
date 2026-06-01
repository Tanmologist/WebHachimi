import type { Task } from "../project/schema";
import { createTask } from "../project/tasks";
import { createStarterProject } from "../samples/starterProject";
import { renderTaskPanelHtml } from "../editor/taskPanelViews";
import type { EntityId, TaskId } from "../shared/types";

const project = createStarterProject();
const scene = project.scenes[project.activeSceneId];
const selectedEntity = Object.values(scene.entities).find((entity) => entity.persistent);
assert(selectedEntity, "expected starter project to have a persistent entity");

const selectedTask = makeTask({
  id: "task-selected-object" as TaskId,
  title: "Selected object task",
  userText: "Tune the selected object.",
  createdAt: "2026-01-01T00:00:00.000Z",
  targetRefs: [{ kind: "entity", entityId: selectedEntity.id as EntityId }],
});
const newerGlobalTask = makeTask({
  id: "task-newer-global" as TaskId,
  title: "Newer global task",
  userText: "Check the whole scene.",
  createdAt: "2026-01-02T00:00:00.000Z",
  targetRefs: [{ kind: "scene", sceneId: scene.id }],
});
project.tasks = {
  [selectedTask.id]: selectedTask,
  [newerGlobalTask.id]: newerGlobalTask,
};

const selectedHtml = renderTaskPanelHtml({
  project,
  previewTaskId: "",
  aiTraceByTask: {},
  selectedEntityIds: [selectedEntity.id as EntityId],
});
assert(
  selectedHtml.indexOf("Selected object task") < selectedHtml.indexOf("Newer global task"),
  "expected selected entity task to render before newer unrelated task",
);
assert(selectedHtml.includes("当前选中相关"), "expected selected task to be labelled as related");

const chronologicalHtml = renderTaskPanelHtml({
  project,
  previewTaskId: "",
  aiTraceByTask: {},
  selectedEntityIds: [],
});
assert(
  chronologicalHtml.indexOf("Newer global task") < chronologicalHtml.indexOf("Selected object task"),
  "expected tasks without selected entity to keep newest-first order",
);

console.log(JSON.stringify({ status: "passed" }, null, 2));

function makeTask(input: Pick<Task, "id" | "title" | "userText" | "createdAt" | "targetRefs">): Task {
  const task = createTask({ source: "user", title: input.title, userText: input.userText, targetRefs: input.targetRefs });
  assert(task.ok, task.ok ? "" : task.error);
  return {
    ...task.value,
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    testRecordRefs: [],
    transactionRefs: [],
    targetRefs: input.targetRefs,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
