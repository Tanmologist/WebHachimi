import type { AiTaskExecutionResult } from "../ai/taskExecutor";
import { createTask } from "../project/tasks";
import type { ProjectStore } from "../project/projectStore";
import type { TargetRef } from "../project/schema";
import type { Result, TaskId } from "../shared/types";
import { createTaskFromSuperBrush, type SuperBrushDraft } from "../editor/superBrush";

export type TaskWorkflowControllerDeps = {
  store: ProjectStore;
  executeNextAiTask: () => Promise<Result<AiTaskExecutionResult | undefined>>;
  currentTargets: () => TargetRef[];
  getPendingBrush: () => SuperBrushDraft | undefined;
  setPendingBrush: (draft: SuperBrushDraft | undefined) => void;
  clearTaskInput: () => void;
  focusTaskInput: () => void;
  setPreviewTaskId: (taskId: TaskId | "") => void;
  setAiTrace: (taskId: TaskId, traceSummary: string) => void;
  syncWorldFromStore: () => void;
  onProjectChanged: (reason: string) => void;
  setNotice: (notice: string) => void;
  renderAll: () => void;
};

export type TaskWorkflowController = {
  queueTaskFromText: (text: string) => void;
  runNextAiTask: () => Promise<void>;
};

export function createTaskWorkflowController(deps: TaskWorkflowControllerDeps): TaskWorkflowController {
  return {
    queueTaskFromText(text) {
      const trimmed = text.trim();
      if (!trimmed) {
        deps.setNotice("任务描述不能为空。");
        deps.focusTaskInput();
        deps.renderAll();
        return;
      }

      const pendingBrush = deps.getPendingBrush();
      const result = pendingBrush
        ? createTaskFromSuperBrush({ userText: trimmed, draft: pendingBrush })
        : createTask({ source: "user", userText: trimmed, targetRefs: deps.currentTargets() });

      if (!result.ok) {
        deps.setNotice(result.error);
        if (pendingBrush) deps.setPendingBrush(undefined);
        deps.focusTaskInput();
        deps.renderAll();
        return;
      }

      deps.store.upsertTask(result.value);
      deps.onProjectChanged("任务已排队");
      deps.setPreviewTaskId(result.value.id);
      deps.setPendingBrush(undefined);
      deps.clearTaskInput();
      deps.setNotice("任务已排队，AI 执行器会优先处理任务列表。");
      deps.renderAll();
    },

    async runNextAiTask() {
      let result: Result<AiTaskExecutionResult | undefined>;
      try {
        result = await deps.executeNextAiTask();
      } catch (error) {
        deps.setNotice(`AI 执行失败：${error instanceof Error ? error.message : String(error)}`);
        deps.renderAll();
        return;
      }
      if (!result.ok) {
        deps.setNotice(`AI 执行失败：${result.error}`);
        deps.renderAll();
        return;
      }
      if (!result.value) {
        deps.setNotice("没有排队中的任务。");
        deps.renderAll();
        return;
      }

      deps.syncWorldFromStore();
      deps.onProjectChanged("AI 任务结果已更新");
      const status = result.value.status === "passed" ? "完成" : "失败";
      const rollbackText = result.value.rolledBack ? "，已回滚" : "";
      deps.setNotice(`AI 任务${status}${rollbackText}。`);
      deps.setPreviewTaskId(result.value.taskId);
      if (result.value.traceSummary) deps.setAiTrace(result.value.taskId, result.value.traceSummary);
      deps.renderAll();
    },
  };
}
