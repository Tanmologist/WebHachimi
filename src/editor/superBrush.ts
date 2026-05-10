import type {
  BrushAnnotation,
  BrushCompiledContext,
  BrushContext,
  BrushShapeInterpretation,
  BrushStroke,
  BrushVisualEvidence,
  BrushVisualFrame,
  Entity,
  Task,
  TargetRef,
} from "../project/schema";
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
  visualEvidence?: BrushVisualEvidenceInput;
};

export type BrushVisualEvidenceInput = {
  viewport?: {
    worldCenter: Vec2;
    zoom: number;
    canvasSize: Vec2;
  };
  entities?: Entity[];
  imageRefs?: Record<string, { imageRef: string; imageMime: string }>;
  capturedAt?: string;
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
  const brushContext = createBrushContextFromSuperBrushDraft(draft, input.visualEvidence);
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

export function createBrushContextFromSuperBrushDraft(draft: SuperBrushDraft, visualEvidenceInput: BrushVisualEvidenceInput = {}): BrushContext {
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
    visualEvidence: createBrushVisualEvidence(normalized, { ...visualEvidenceInput, compiled }),
  };
}

export function createBrushVisualEvidence(
  draft: SuperBrushDraft,
  input: BrushVisualEvidenceInput & { compiled?: BrushCompiledContext } = {},
): BrushVisualEvidence {
  const normalized = normalizeSuperBrushDraft(draft);
  const compiled = input.compiled || compileSuperBrushContext(normalized);
  const viewport = input.viewport ? normalizeViewport(input.viewport) : undefined;
  const brushBounds = brushEvidenceBounds(normalized, compiled);
  const cropWorldRect = expandRect(brushBounds, brushEvidencePadding(brushBounds));
  const overviewWorldRect = viewport?.visibleWorldRect || expandRect(cropWorldRect, Math.max(cropWorldRect.w, cropWorldRect.h) * 0.75);
  const frames: BrushVisualFrame[] = [
    {
      id: "overview",
      role: "overview",
      label: "Full canvas view with brush overlay",
      worldRect: overviewWorldRect,
      pixelRect: viewport ? { x: 0, y: 0, w: viewport.canvasSize.x, h: viewport.canvasSize.y } : undefined,
      ...imageRefFor(input.imageRefs, "overview", "overview"),
    },
    {
      id: "crop-main",
      role: "crop",
      label: "Padded brush-local crop",
      worldRect: cropWorldRect,
      pixelRect: viewport ? worldRectToPixelRect(cropWorldRect, viewport) : undefined,
      parentFrameId: "overview",
      ...imageRefFor(input.imageRefs, "crop-main", "crop"),
    },
    ...brushEvidenceTiles(cropWorldRect, compiled, viewport).map((tile, index) => ({
      id: `tile-${index + 1}`,
      role: "tile" as const,
      label: `Brush detail tile ${index + 1}`,
      worldRect: tile,
      pixelRect: viewport ? worldRectToPixelRect(tile, viewport) : undefined,
      parentFrameId: "crop-main",
      ...imageRefFor(input.imageRefs, `tile-${index + 1}`, "tile"),
    })),
  ];
  const entities = evidenceEntities(input.entities || [], cropWorldRect, viewport);
  return {
    version: 1,
    manifestId: makeId<"BrushEvidenceId">("brush-evidence"),
    coordinateSpace: "world",
    capture: {
      capturedAt: input.capturedAt || new Date().toISOString(),
      snapshotRef: normalized.capturedSnapshotId as BrushVisualEvidence["capture"]["snapshotRef"],
      viewport: viewport
        ? {
            worldCenter: viewport.worldCenter,
            zoom: viewport.zoom,
            canvasSize: viewport.canvasSize,
            visibleWorldRect: viewport.visibleWorldRect,
          }
        : undefined,
    },
    frames,
    anchors: brushEvidenceAnchors(compiled, entities, viewport),
    entities,
    shape: compiled.shape,
    warnings: brushEvidenceWarnings(frames, compiled.shape),
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
  const shape = interpretBrushShape(normalized, targetRefs, areas, paths);
  const evidence = compileBrushEvidence(normalized, targetRefs, areas.length, paths.length);
  return {
    version: 1,
    targetRefs,
    targetEntityIds: superBrushTargetEntityIds(targetRefs),
    strokeTargets,
    areas,
    paths,
    annotations,
    shape,
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

type NormalizedViewportEvidence = {
  worldCenter: Vec2;
  zoom: number;
  canvasSize: Vec2;
  visibleWorldRect: Rect;
};

function normalizeViewport(input: NonNullable<BrushVisualEvidenceInput["viewport"]>): NormalizedViewportEvidence {
  const zoom = Math.max(input.zoom || 1, 0.001);
  const canvasSize = {
    x: Math.max(1, roundCoord(input.canvasSize.x)),
    y: Math.max(1, roundCoord(input.canvasSize.y)),
  };
  const worldCenter = {
    x: roundCoord(input.worldCenter.x),
    y: roundCoord(input.worldCenter.y),
  };
  return {
    worldCenter,
    zoom: roundCoord(zoom),
    canvasSize,
    visibleWorldRect: {
      x: roundCoord(worldCenter.x - canvasSize.x / 2 / zoom),
      y: roundCoord(worldCenter.y - canvasSize.y / 2 / zoom),
      w: roundCoord(canvasSize.x / zoom),
      h: roundCoord(canvasSize.y / zoom),
    },
  };
}

function brushEvidenceBounds(draft: SuperBrushDraft, compiled: BrushCompiledContext): Rect {
  const rects = [
    draft.selectionBox,
    ...compiled.areas.map((area) => area.rect),
    ...compiled.strokeTargets.map((target) => target.bounds),
    ...compiled.paths.map((path) => rectFromPoints(path.points, 0)),
  ];
  return unionRects(rects) || { x: 0, y: 0, w: 1, h: 1 };
}

function brushEvidencePadding(rect: Rect): number {
  return Math.max(48, Math.min(240, Math.max(rect.w, rect.h) * 0.65));
}

function expandRect(rect: Rect, padding: number): Rect {
  return normalizeRect({
    x: rect.x - padding,
    y: rect.y - padding,
    w: rect.w + padding * 2,
    h: rect.h + padding * 2,
  });
}

function imageRefFor(
  refs: BrushVisualEvidenceInput["imageRefs"],
  frameId: string,
  role: BrushVisualFrame["role"],
): Pick<BrushVisualFrame, "imageRef" | "imageMime"> {
  const ref = refs?.[frameId] || refs?.[role];
  return ref ? { imageRef: ref.imageRef, imageMime: ref.imageMime } : {};
}

function worldRectToPixelRect(rect: Rect, viewport: NormalizedViewportEvidence): Rect {
  const topLeft = worldToPixel({ x: rect.x, y: rect.y }, viewport);
  const bottomRight = worldToPixel({ x: rect.x + rect.w, y: rect.y + rect.h }, viewport);
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  const w = Math.abs(bottomRight.x - topLeft.x);
  const h = Math.abs(bottomRight.y - topLeft.y);
  return {
    x: roundCoord(x),
    y: roundCoord(y),
    w: roundCoord(w),
    h: roundCoord(h),
  };
}

function worldToPixel(point: Vec2, viewport: NormalizedViewportEvidence): Vec2 {
  return {
    x: roundCoord(viewport.canvasSize.x / 2 + (point.x - viewport.worldCenter.x) * viewport.zoom),
    y: roundCoord(viewport.canvasSize.y / 2 + (point.y - viewport.worldCenter.y) * viewport.zoom),
  };
}

function brushEvidenceTiles(
  crop: Rect,
  compiled: BrushCompiledContext,
  viewport: NormalizedViewportEvidence | undefined,
): Rect[] {
  const longestPath = Math.max(0, ...compiled.paths.map((path) => path.length));
  const shouldTile = crop.w > 420 || crop.h > 320 || longestPath > 560;
  if (!shouldTile) return [];
  const minTileWorld = viewport ? Math.max(120, 180 / Math.max(viewport.zoom, 0.001)) : 160;
  let columns = crop.w >= crop.h * 1.25 ? 2 : 1;
  let rows = crop.h > crop.w * 1.1 ? 2 : 1;
  if (crop.w / columns < minTileWorld) columns = 1;
  if (crop.h / rows < minTileWorld) rows = 1;
  if (columns === 1 && rows === 1) return [];

  const tiles: Rect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push(
        normalizeRect({
          x: crop.x + (crop.w / columns) * column,
          y: crop.y + (crop.h / rows) * row,
          w: crop.w / columns,
          h: crop.h / rows,
        }),
      );
    }
  }
  return tiles.slice(0, 4);
}

function evidenceEntities(
  entities: Entity[],
  cropWorldRect: Rect,
  viewport: NormalizedViewportEvidence | undefined,
): BrushVisualEvidence["entities"] {
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return entities
    .map((entity) => ({ entity, bounds: entityWorldBounds(entity) }))
    .filter(({ bounds }) => rectsIntersect(bounds, cropWorldRect))
    .slice(0, labels.length)
    .map(({ entity, bounds }, index) => ({
      id: entity.id as BrushVisualEvidence["entities"][number]["id"],
      label: labels[index],
      displayName: entity.displayName,
      boundsWorld: bounds,
      boundsPixel: viewport ? worldRectToPixelRect(bounds, viewport) : undefined,
    }));
}

function entityWorldBounds(entity: Entity): Rect {
  const collider = entity.collider;
  const render = entity.render;
  const size = collider?.size || render?.size || { x: 64, y: 64 };
  const offset = collider?.offset || render?.offset || { x: 0, y: 0 };
  const scale = entity.transform.scale || { x: 1, y: 1 };
  const w = Math.max(1, Math.abs(size.x * scale.x));
  const h = Math.max(1, Math.abs(size.y * scale.y));
  const center = {
    x: entity.transform.position.x + offset.x,
    y: entity.transform.position.y + offset.y,
  };
  return normalizeRect({ x: center.x - w / 2, y: center.y - h / 2, w, h });
}

function rectsIntersect(left: Rect, right: Rect): boolean {
  return left.x <= right.x + right.w && left.x + left.w >= right.x && left.y <= right.y + right.h && left.y + left.h >= right.y;
}

function brushEvidenceAnchors(
  compiled: BrushCompiledContext,
  entities: BrushVisualEvidence["entities"],
  viewport: NormalizedViewportEvidence | undefined,
): BrushVisualEvidence["anchors"] {
  const anchors: BrushVisualEvidence["anchors"] = [];
  const primaryPath = [...compiled.paths].sort((left, right) => right.length - left.length)[0];
  if (primaryPath) {
    anchors.push(anchor("anchor-start", "S", "start", primaryPath.start, viewport, primaryPath.strokeId));
    anchors.push(anchor("anchor-end", "E", "end", primaryPath.end, viewport, primaryPath.strokeId));
  }
  if (compiled.shape.centerWorld) anchors.push(anchor("anchor-center", "C", "center", compiled.shape.centerWorld, viewport));
  for (const entity of entities) {
    anchors.push(anchor(`entity-${entity.label}`, entity.label, "entity", rectCenter(entity.boundsWorld), viewport, undefined, entity.id));
  }
  return anchors;
}

function anchor(
  id: string,
  label: string,
  kind: BrushVisualEvidence["anchors"][number]["kind"],
  world: Vec2,
  viewport: NormalizedViewportEvidence | undefined,
  strokeId?: BrushStrokeId,
  entityId?: BrushVisualEvidence["anchors"][number]["entityId"],
): BrushVisualEvidence["anchors"][number] {
  return {
    id,
    label,
    kind,
    world: { x: roundCoord(world.x), y: roundCoord(world.y) },
    pixel: viewport ? worldToPixel(world, viewport) : undefined,
    strokeId,
    entityId,
  };
}

function brushEvidenceWarnings(frames: BrushVisualFrame[], shape: BrushShapeInterpretation): string[] {
  const warnings: string[] = [];
  const crop = frames.find((frame) => frame.role === "crop");
  if (crop && (crop.worldRect.w < 32 || crop.worldRect.h < 32)) warnings.push("main crop is very small; keep surrounding context when reviewing image evidence");
  if (frames.filter((frame) => frame.role === "tile").length > 0) warnings.push("detail tiles are supplemental; use overview and crop for spatial context");
  if (shape.kind === "path" && !shape.startWorld) warnings.push("path has no reliable start anchor");
  return warnings;
}

function interpretBrushShape(
  draft: SuperBrushDraft,
  targetRefs: TargetRef[],
  areas: BrushCompiledContext["areas"],
  paths: BrushCompiledContext["paths"],
): BrushShapeInterpretation {
  const longestPath = [...paths].sort((left, right) => right.length - left.length)[0];
  const bounds = unionRects([
    draft.selectionBox,
    ...areas.map((area) => area.rect),
    ...paths.map((path) => rectFromPoints(path.points, 0)),
  ]);
  const closed = longestPath ? closedStrokePolygon(longestPath.points) : undefined;
  const notes: string[] = [];
  if (areas.length > 0) notes.push(`${areas.length} area candidate${areas.length === 1 ? "" : "s"}`);
  if (paths.length > 0) notes.push(`${paths.length} path candidate${paths.length === 1 ? "" : "s"}`);
  if (targetRefs.some((target) => target.kind === "entity")) notes.push("entity target anchors present");

  let kind: BrushShapeInterpretation["kind"] = "empty";
  if (closed) kind = "closed-shape";
  else if (areas.length > 0 && paths.length > 1) kind = "mixed";
  else if (areas.length > 0) kind = "area";
  else if (paths.length > 0) kind = "path";
  else if (targetRefs.length > 0) kind = "target-mark";

  return {
    kind,
    confidence: shapeConfidence(kind, areas.length, paths.length, targetRefs.length, Boolean(closed)),
    boundsWorld: bounds,
    startWorld: longestPath?.start,
    endWorld: longestPath?.end,
    centerWorld: bounds ? rectCenter(bounds) : undefined,
    approximatePolygon: closed,
    notes,
  };
}

function closedStrokePolygon(points: Vec2[]): Vec2[] | undefined {
  if (points.length < 4) return undefined;
  const first = points[0];
  const last = points[points.length - 1];
  const length = strokeLength(points);
  if (Math.hypot(first.x - last.x, first.y - last.y) > Math.max(12, length * 0.08)) return undefined;
  const simplified = simplifyPolyline(points, Math.max(6, length / 80)).slice(0, 24);
  return simplified.length >= 3 ? simplified : undefined;
}

function simplifyPolyline(points: Vec2[], minDistance: number): Vec2[] {
  const simplified: Vec2[] = [];
  for (const point of points) {
    const last = simplified[simplified.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) simplified.push(point);
  }
  const finalPoint = points[points.length - 1];
  const last = simplified[simplified.length - 1];
  if (finalPoint && last && (last.x !== finalPoint.x || last.y !== finalPoint.y)) simplified.push(finalPoint);
  return simplified;
}

function shapeConfidence(
  kind: BrushShapeInterpretation["kind"],
  areaCount: number,
  pathCount: number,
  targetCount: number,
  closed: boolean,
): number {
  const base = kind === "empty" ? 0.1 : 0.38;
  const areaScore = Math.min(areaCount, 2) * 0.16;
  const pathScore = Math.min(pathCount, 2) * 0.12;
  const targetScore = targetCount > 0 ? 0.12 : 0;
  const closedScore = closed ? 0.18 : 0;
  return roundCoord(clamp(base + areaScore + pathScore + targetScore + closedScore, 0.1, 0.95));
}

function rectCenter(rect: Rect): Vec2 {
  return {
    x: roundCoord(rect.x + rect.w / 2),
    y: roundCoord(rect.y + rect.h / 2),
  };
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
