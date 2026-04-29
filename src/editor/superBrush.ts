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
  const draft = normalizeSuperBrushDraft(input.draft);
  if (!hasMeaningfulSuperBrushContext(draft)) {
    return err("super brush requires at least one stroke, annotation, or marked area");
  }
  const now = new Date().toISOString();
  const brushContext: BrushContext = {
    strokes: draft.strokes,
    annotations: draft.annotations,
    selectionBox: superBrushSelectionBox(draft),
    targetEntityIds: superBrushTargetEntityIds(draft.selectionTargets),
    capturedSnapshotId: draft.capturedSnapshotId as BrushContext["capturedSnapshotId"],
    summary: summarizeSuperBrushDraft(draft),
  };
  return ok({
    id: makeId<"TaskId">("task") as TaskId,
    source: "superBrush",
    title: input.title?.trim() || userText.slice(0, 28),
    userText,
    status: "queued",
    targetRefs: draft.selectionTargets,
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
  const normalized = normalizeSuperBrushDraft(draft);
  const areaCount = superBrushSelectionBox(normalized) ? 1 : 0;
  const specificTargetCount = normalized.selectionTargets.filter((target) => target.kind !== "scene").length;
  return `${normalized.strokes.length} stroke${normalized.strokes.length === 1 ? "" : "s"}, ${normalized.annotations.length} annotation${normalized.annotations.length === 1 ? "" : "s"}, ${specificTargetCount} target${specificTargetCount === 1 ? "" : "s"}, ${areaCount} area${areaCount === 1 ? "" : "s"}`;
}

export function normalizeSuperBrushDraft(draft: SuperBrushDraft): SuperBrushDraft {
  return {
    strokes: draft.strokes,
    annotations: draft.annotations,
    selectionTargets: mergeSuperBrushTargets(draft.selectionTargets),
    capturedSnapshotId: draft.capturedSnapshotId,
    selectionBox: draft.selectionBox || areaTargetBox(draft.selectionTargets),
  };
}

export function hasMeaningfulSuperBrushContext(draft: SuperBrushDraft): boolean {
  const normalized = normalizeSuperBrushDraft(draft);
  return (
    normalized.strokes.length > 0 ||
    normalized.annotations.length > 0 ||
    Boolean(superBrushSelectionBox(normalized))
  );
}

export function mergeSuperBrushTargets(...targetGroups: Array<TargetRef[] | undefined>): TargetRef[] {
  const merged = new Map<string, TargetRef>();
  for (const targets of targetGroups) {
    for (const target of targets || []) {
      merged.set(superBrushTargetKey(target), target);
    }
  }
  const values = [...merged.values()];
  const hasSpecificTarget = values.some((target) => target.kind !== "scene");
  return hasSpecificTarget ? values.filter((target) => target.kind !== "scene") : values;
}

export function superBrushTargetEntityIds(targets: TargetRef[]): BrushContext["targetEntityIds"] {
  return mergeSuperBrushTargets(targets)
    .filter((target): target is Extract<TargetRef, { kind: "entity" }> => target.kind === "entity")
    .map((target) => target.entityId);
}

export function superBrushSelectionBox(draft: SuperBrushDraft): BrushContext["selectionBox"] {
  return draft.selectionBox || areaTargetBox(draft.selectionTargets);
}

function areaTargetBox(targets: TargetRef[]): BrushContext["selectionBox"] {
  return targets.find((target): target is Extract<TargetRef, { kind: "area" }> => target.kind === "area")?.rect;
}

function superBrushTargetKey(target: TargetRef): string {
  if (target.kind === "scene") return `scene:${target.sceneId}`;
  if (target.kind === "entity") return `entity:${target.entityId}`;
  if (target.kind === "resource") return `resource:${target.resourceId}`;
  if (target.kind === "runtime") return `runtime:${target.sceneId || ""}`;
  return `area:${target.sceneId}:${target.rect.x}:${target.rect.y}:${target.rect.w}:${target.rect.h}`;
}
