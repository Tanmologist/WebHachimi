import type { BrushAnnotation, BrushContext, BrushStroke, Task, TargetRef } from "../project/schema";
import { err, makeId, ok, type Result } from "../shared/types";
import type { BrushAnnotationId, BrushStrokeId, Rect, TaskId, Vec2 } from "../shared/types";

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
  const normalizedPoints = normalizeStrokePoints(points);
  if (normalizedPoints.length < 2) return err("super brush stroke requires at least two points");
  if (strokeLength(normalizedPoints) < 3) return err("super brush stroke is too short");
  return ok({
    id: makeId<"BrushStrokeId">("stroke") as BrushStrokeId,
    points: normalizedPoints,
    color: color.trim() || "#35bd9a",
    width: clamp(width, 1, 24),
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
  const brushContext = createBrushContextFromSuperBrushDraft(draft);
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
  return `${normalized.strokes.length} stroke${normalized.strokes.length === 1 ? "" : "s"}, ${normalized.annotations.length} note${normalized.annotations.length === 1 ? "" : "s"}, ${specificTargetCount} target${specificTargetCount === 1 ? "" : "s"}, ${areaCount} area${areaCount === 1 ? "" : "s"}`;
}

export function normalizeSuperBrushDraft(draft: SuperBrushDraft): SuperBrushDraft {
  const selectionTargets = mergeSuperBrushTargets(draft.selectionTargets);
  const normalized: SuperBrushDraft = {
    strokes: draft.strokes,
    annotations: draft.annotations,
    selectionTargets,
    capturedSnapshotId: draft.capturedSnapshotId,
    selectionBox: draft.selectionBox,
  };
  return {
    ...normalized,
    capturedSnapshotId: draft.capturedSnapshotId,
    selectionBox: superBrushSelectionBox(normalized),
  };
}

export function hasMeaningfulSuperBrushContext(draft: SuperBrushDraft): boolean {
  const normalized = normalizeSuperBrushDraft(draft);
  return (
    normalized.strokes.length > 0 ||
    normalized.annotations.length > 0 ||
    Boolean(superBrushSelectionBox(normalized)) ||
    normalized.selectionTargets.some((target) => target.kind !== "scene")
  );
}

export function createBrushContextFromSuperBrushDraft(draft: SuperBrushDraft): BrushContext {
  const normalized = normalizeSuperBrushDraft(draft);
  return {
    strokes: normalized.strokes,
    annotations: normalized.annotations,
    selectionBox: superBrushSelectionBox(normalized),
    targetEntityIds: superBrushTargetEntityIds(normalized.selectionTargets),
    capturedSnapshotId: normalized.capturedSnapshotId as BrushContext["capturedSnapshotId"],
    summary: summarizeSuperBrushDraft(normalized),
  };
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
  return unionRects([
    draft.selectionBox,
    ...draft.selectionTargets
      .filter((target): target is Extract<TargetRef, { kind: "area" }> => target.kind === "area")
      .map((target) => target.rect),
  ]);
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

function normalizeStrokePoints(points: Vec2[]): Vec2[] {
  const normalized: Vec2[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const current = { x: roundCoord(point.x), y: roundCoord(point.y) };
    const previous = normalized[normalized.length - 1];
    if (!previous || Math.hypot(current.x - previous.x, current.y - previous.y) >= 1.5) normalized.push(current);
  }
  return normalized;
}

function strokeLength(points: Vec2[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return total;
}

function unionRects(rects: Array<Rect | undefined>): Rect | undefined {
  const values = rects.filter((rect): rect is Rect => Boolean(rect));
  if (values.length === 0) return undefined;
  let minX = values[0].x;
  let minY = values[0].y;
  let maxX = values[0].x + values[0].w;
  let maxY = values[0].y + values[0].h;
  for (const rect of values.slice(1)) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
