import type { BrushAnnotation, BrushContext, BrushStroke, Task, TargetRef } from "../project/schema";
import { err, makeId, ok, type Result } from "../shared/types";
import type { BrushAnnotationId, BrushStrokeId, TaskId, Vec2 } from "../shared/types";

export type SuperBrushDraft = {
  strokes: BrushStroke[];
  annotations: BrushAnnotation[];
  selectionTargets: TargetRef[];
  capturedSnapshotId?: string;
  selectionBox?: BrushContext["selectionBox"];
};

export type SuperBrushTaskInput = {
  title?: string;
  userText: string;
  draft: SuperBrushDraft;
};

export type SuperBrushAnnotationInput = {
  text: string;
  position: Vec2;
  targetRef?: TargetRef;
};

export function createEmptySuperBrushDraft(): SuperBrushDraft {
  return {
    strokes: [],
    annotations: [],
    selectionTargets: [],
  };
}

export function createSuperBrushStroke(points: Vec2[], color = "#35bd9a", width = 4, pressure?: number): Result<BrushStroke> {
  if (points.length < 2) return err("super brush stroke requires at least two points");
  return ok({
    id: makeId<"BrushStrokeId">("stroke") as BrushStrokeId,
    points,
    color,
    width,
    pressure,
  });
}

export function createSuperBrushAnnotation(input: SuperBrushAnnotationInput): Result<BrushAnnotation> {
  const text = input.text.trim();
  if (!text) return err("super brush annotation requires text");
  return ok({
    id: makeId<"BrushAnnotationId">("note") as BrushAnnotationId,
    text,
    position: input.position,
    targetRef: input.targetRef,
    createdAt: new Date().toISOString(),
  });
}

export function createTaskFromSuperBrush(input: SuperBrushTaskInput): Result<Task> {
  const userText = input.userText.trim();
  if (!userText) return err("super brush requires a task description");
  if (input.draft.strokes.length === 0 && input.draft.annotations.length === 0 && input.draft.selectionTargets.length === 0) {
    return err("super brush requires at least one stroke, annotation, or target");
  }
  const now = new Date().toISOString();
  const brushContext: BrushContext = {
    strokes: input.draft.strokes,
    annotations: input.draft.annotations,
    selectionBox: input.draft.selectionBox,
    targetEntityIds: input.draft.selectionTargets
      .filter((target): target is Extract<TargetRef, { kind: "entity" }> => target.kind === "entity")
      .map((target) => target.entityId),
    capturedSnapshotId: input.draft.capturedSnapshotId as BrushContext["capturedSnapshotId"],
    summary: summarizeSuperBrushDraft(input.draft),
  };
  return ok({
    id: makeId<"TaskId">("task") as TaskId,
    source: "superBrush",
    title: input.title?.trim() || userText.slice(0, 28),
    userText,
    status: "queued",
    targetRefs: input.draft.selectionTargets,
    brushContext,
    transactionRefs: [],
    testRecordRefs: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function shouldShowBrushPreview(task: Task, previewTaskId?: TaskId): boolean {
  return Boolean(task.brushContext && previewTaskId && task.id === previewTaskId);
}

export function summarizeSuperBrushDraft(draft: SuperBrushDraft): string {
  return `${draft.strokes.length} stroke${draft.strokes.length === 1 ? "" : "s"}, ${draft.annotations.length} annotation${draft.annotations.length === 1 ? "" : "s"}, ${draft.selectionTargets.length} target${draft.selectionTargets.length === 1 ? "" : "s"}`;
}
