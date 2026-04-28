import type { BrushAnnotation, BrushStroke, Task, TargetRef } from "./schema";
import { makeId, type Result, ok, err } from "../shared/types";
import type { TaskId, TaskStatus } from "../shared/types";

export type CreateTaskInput = {
  source: Task["source"];
  title?: string;
  userText: string;
  acceptanceCriteria?: Task["acceptanceCriteria"];
  targetRefs?: TargetRef[];
};

export function createTask(input: CreateTaskInput): Result<Task> {
  const text = input.userText.trim();
  if (!text) return err("task requires user text");
  const now = new Date().toISOString();
  return ok({
    id: makeId<"TaskId">("task") as TaskId,
    source: input.source,
    title: input.title?.trim() || text.slice(0, 32),
    userText: text,
    acceptanceCriteria: input.acceptanceCriteria,
    status: "queued",
    targetRefs: input.targetRefs || [],
    transactionRefs: [],
    testRecordRefs: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function transitionTask(task: Task, status: TaskStatus, normalizedText?: string): Task {
  return {
    ...task,
    status,
    normalizedText: normalizedText ?? task.normalizedText,
    updatedAt: new Date().toISOString(),
  };
}

export type TaskPreviewModel = {
  taskId: TaskId;
  title: string;
  source: Task["source"];
  status: TaskStatus;
  targetCount: number;
  strokes: BrushStroke[];
  annotations: BrushAnnotation[];
  summary: string;
};

export function getTaskPreviewModel(task: Task): TaskPreviewModel {
  const strokes = task.brushContext?.strokes ?? [];
  const annotations = task.brushContext?.annotations ?? [];
  return {
    taskId: task.id,
    title: task.title,
    source: task.source,
    status: task.status,
    targetCount: task.targetRefs.length,
    strokes,
    annotations,
    summary: task.brushContext?.summary || summarizeTaskContext(task),
  };
}

export function summarizeTaskContext(task: Task): string {
  const strokes = task.brushContext?.strokes.length ?? 0;
  const annotations = task.brushContext?.annotations.length ?? 0;
  const targets = task.targetRefs.length;
  if (strokes || annotations) {
    return `${strokes} stroke${strokes === 1 ? "" : "s"}, ${annotations} annotation${annotations === 1 ? "" : "s"}, ${targets} target${targets === 1 ? "" : "s"}`;
  }
  return `${targets} target${targets === 1 ? "" : "s"}`;
}
