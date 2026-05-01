import type { BrushAnnotation, BrushCompiledContext, BrushContext, BrushStroke, Task, TargetRef } from "../project/schema";
import { err, makeId, ok, type Result } from "../shared/types";
import type { BrushAnnotationId, BrushStrokeId, Rect, TaskId, Vec2 } from "../shared/types";

export type SuperBrushDraft = {
  strokes: BrushStroke[];
  annotations: BrushAnnotation[];
  selectionTargets: TargetRef[];
  strokeTargetRefs?: Partial<Record<string, TargetRef[]>>;
  manualTargetRefs?: TargetRef[];
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
  const normalized = rebuildSuperBrushDraftTargets(draft);
  return {
    ...normalized,
    capturedSnapshotId: draft.capturedSnapshotId,
    selectionBox: superBrushSelectionBox(normalized),
  };
}

export function rebuildSuperBrushDraftTargets(draft: SuperBrushDraft): SuperBrushDraft {
  const strokeTargetRefs = normalizeStrokeTargetRefs(draft.strokeTargetRefs, draft.strokes);
  const manualTargetRefs = mergeSuperBrushTargets(draft.manualTargetRefs);
  const hasTargetMetadata = Boolean(strokeTargetRefs || draft.manualTargetRefs);
  const selectionTargets = hasTargetMetadata
    ? mergeSuperBrushTargets(
        manualTargetRefs,
        ...draft.strokes.map((stroke) => strokeTargetRefs?.[stroke.id] || []),
      )
    : mergeSuperBrushTargets(draft.selectionTargets);
  const rebuilt: SuperBrushDraft = {
    ...draft,
    selectionTargets,
    strokeTargetRefs,
    manualTargetRefs: manualTargetRefs.length > 0 ? manualTargetRefs : undefined,
    selectionBox: hasTargetMetadata ? undefined : draft.selectionBox,
  };
  return {
    ...rebuilt,
    selectionBox: superBrushSelectionBox(rebuilt),
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
  const compiled = compileSuperBrushContext(normalized);
  return {
    version: 1,
    strokes: normalized.strokes,
    annotations: normalized.annotations,
    selectionBox: superBrushSelectionBox(normalized),
    targetEntityIds: compiled.targetEntityIds,
    capturedSnapshotId: normalized.capturedSnapshotId as BrushContext["capturedSnapshotId"],
    summary: summarizeSuperBrushDraft(normalized),
    raw: {
      strokes: normalized.strokes,
      annotations: normalized.annotations,
      targetRefs: normalized.selectionTargets,
      selectionBox: superBrushSelectionBox(normalized),
      capturedSnapshotId: normalized.capturedSnapshotId as BrushContext["capturedSnapshotId"],
    },
    compiled,
  };
}

export function compileSuperBrushContext(draft: SuperBrushDraft): BrushCompiledContext {
  const normalized = normalizeSuperBrushDraft(draft);
  const annotationTargets = normalized.annotations
    .map((annotation) => annotation.targetRef)
    .filter((target): target is TargetRef => Boolean(target));
  const targetRefs = mergeSuperBrushTargets(normalized.selectionTargets, annotationTargets);
  const strokeTargets = normalized.strokes.map((stroke) => {
    const refs = mergeSuperBrushTargets(normalized.strokeTargetRefs?.[stroke.id]);
    return {
      strokeId: stroke.id,
      targetRefs: refs,
      bounds: rectFromPoints(stroke.points, Math.max(1, stroke.width / 2)),
      length: roundCoord(strokeLength(stroke.points)),
      pointCount: stroke.points.length,
      confidence: refs.length > 0 ? 0.85 : 0.55,
    };
  });
  const areas = compileBrushAreas(normalized, strokeTargets);
  const paths = normalized.strokes
    .filter((stroke) => stroke.points.length >= 2 && strokeLength(stroke.points) >= 12)
    .map((stroke, index) => {
      const refs = mergeSuperBrushTargets(normalized.strokeTargetRefs?.[stroke.id]);
      const length = strokeLength(stroke.points);
      return {
        id: `path:${stroke.id || index}`,
        strokeId: stroke.id,
        points: stroke.points,
        start: stroke.points[0],
        end: stroke.points[stroke.points.length - 1],
        length: roundCoord(length),
        targetRefs: refs,
        confidence: refs.some((target) => target.kind === "entity") ? 0.7 : 0.6,
      };
    });
  const annotations = normalized.annotations.map((annotation) => ({
    annotationId: annotation.id,
    text: annotation.text,
    position: annotation.position,
    targetRef: annotation.targetRef,
    confidence: annotation.targetRef ? 0.85 : 0.65,
  }));
  const evidence = compileBrushEvidence(normalized, targetRefs, areas.length, paths.length);
  return {
    version: 1,
    targetRefs,
    targetEntityIds: superBrushTargetEntityIds(targetRefs),
    strokeTargets,
    areas,
    paths,
    annotations,
    confidence: brushConfidence(targetRefs, strokeTargets.length, areas.length, annotations.length),
    evidence,
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

function compileBrushAreas(
  draft: SuperBrushDraft,
  strokeTargets: BrushCompiledContext["strokeTargets"],
): BrushCompiledContext["areas"] {
  const areas = new Map<string, BrushCompiledContext["areas"][number]>();
  const addArea = (source: BrushCompiledContext["areas"][number]["source"], rect: Rect | undefined, targetRefs: TargetRef[], confidence: number) => {
    if (!rect) return;
    const normalizedRect = normalizeRect(rect);
    const key = `${source}:${normalizedRect.x}:${normalizedRect.y}:${normalizedRect.w}:${normalizedRect.h}`;
    areas.set(key, {
      id: key,
      source,
      rect: normalizedRect,
      targetRefs: mergeSuperBrushTargets(targetRefs),
      confidence,
    });
  };

  addArea("selectionBox", draft.selectionBox, draft.selectionTargets, 0.75);
  for (const target of draft.selectionTargets) {
    if (target.kind === "area") addArea("target", target.rect, [target], 0.85);
  }
  for (const strokeTarget of strokeTargets) {
    const areaTargets = strokeTarget.targetRefs.filter((target): target is Extract<TargetRef, { kind: "area" }> => target.kind === "area");
    if (areaTargets.length > 0) {
      for (const target of areaTargets) addArea("target", target.rect, [target], 0.85);
    } else if (strokeTarget.targetRefs.length === 0) {
      addArea("stroke", strokeTarget.bounds, [], 0.55);
    }
  }
  return [...areas.values()];
}

function compileBrushEvidence(draft: SuperBrushDraft, targets: TargetRef[], areaCount: number, pathCount: number): string[] {
  const evidence = [
    `${draft.strokes.length} stroke${draft.strokes.length === 1 ? "" : "s"}`,
    `${draft.annotations.length} annotation${draft.annotations.length === 1 ? "" : "s"}`,
    `${targets.length} compiled target${targets.length === 1 ? "" : "s"}`,
  ];
  if (areaCount > 0) evidence.push(`${areaCount} area${areaCount === 1 ? "" : "s"}`);
  if (pathCount > 0) evidence.push(`${pathCount} path${pathCount === 1 ? "" : "s"}`);
  if (draft.capturedSnapshotId) evidence.push("runtime snapshot captured");
  return evidence;
}

function brushConfidence(
  targets: TargetRef[],
  strokeCount: number,
  areaCount: number,
  annotationCount: number,
): number {
  const targetScore = targets.some((target) => target.kind === "entity" || target.kind === "resource") ? 0.35 : 0;
  const areaScore = areaCount > 0 ? 0.2 : 0;
  const strokeScore = strokeCount > 0 ? 0.2 : 0;
  const annotationScore = annotationCount > 0 ? 0.15 : 0;
  return roundCoord(clamp(0.2 + targetScore + areaScore + strokeScore + annotationScore, 0.2, 0.95));
}

function normalizeStrokeTargetRefs(
  strokeTargetRefs: SuperBrushDraft["strokeTargetRefs"],
  strokes: BrushStroke[],
): SuperBrushDraft["strokeTargetRefs"] {
  if (!strokeTargetRefs) return undefined;
  const normalized: Record<string, TargetRef[]> = {};
  for (const stroke of strokes) {
    const targets = mergeSuperBrushTargets(strokeTargetRefs[stroke.id]);
    if (targets.length > 0) normalized[stroke.id] = targets;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
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

function rectFromPoints(points: Vec2[], padding = 0): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const point of points.slice(1)) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return normalizeRect({
    x: minX - padding,
    y: minY - padding,
    w: Math.max(1, maxX - minX) + padding * 2,
    h: Math.max(1, maxY - minY) + padding * 2,
  });
}

function normalizeRect(rect: Rect): Rect {
  const x = roundCoord(rect.w < 0 ? rect.x + rect.w : rect.x);
  const y = roundCoord(rect.h < 0 ? rect.y + rect.h : rect.y);
  return {
    x,
    y,
    w: Math.max(1, roundCoord(Math.abs(rect.w))),
    h: Math.max(1, roundCoord(Math.abs(rect.h))),
  };
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
