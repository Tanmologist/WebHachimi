import type { Project, ProjectPatch, Task } from "../project/schema";
import { cloneJson, err, ok, type Result } from "../shared/types";

export type TaskTransactionPlan = {
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  diffSummary: string;
  dirtyReason: string;
  noticeText: string;
};

export type TaskTransactionLabels = {
  diffSummary?: string;
  dirtyReason?: string;
  noticeText?: string;
};

export function planUpsertTaskTransaction(
  projectSnapshot: Project,
  task: Task,
  labels: TaskTransactionLabels = {},
): Result<TaskTransactionPlan> {
  if (!task.id) return err("task id is required");
  const previousTask = projectSnapshot.tasks[task.id];
  const path = `/tasks/${task.id}` as ProjectPatch["path"];
  return ok({
    patches: [{ op: "set", path, value: cloneJson(task) }],
    inversePatches: previousTask
      ? [{ op: "set", path, value: cloneJson(previousTask) }]
      : [{ op: "delete", path }],
    diffSummary: labels.diffSummary || `排队任务：${task.title || task.userText}`,
    dirtyReason: labels.dirtyReason || "任务已排队",
    noticeText: labels.noticeText || "任务已排队",
  });
}
