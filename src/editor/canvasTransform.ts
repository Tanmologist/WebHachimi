import type { ColliderComponent, Entity, RenderComponent } from "../project/schema";
import { boundsFor } from "../runtime/collision";
import type { Transform2D, Vec2, EntityId } from "../shared/types";
import type { CanvasTargetPart, TransformHandle } from "./renderer";
import { clamp, computeMultiSelectionBounds, fromLocal, toLocal } from "./renderer";

export type Bounds = { center: Vec2; width: number; height: number };

export type CanvasDragState =
  | {
      kind: "move";
      pointerId: number;
      entityId: string;
      part: CanvasTargetPart;
      originalTransform: Transform2D;
      originalCollider?: ColliderComponent;
      originalRender?: RenderComponent;
      offset: Vec2;
    }
  | {
      kind: "scale";
      pointerId: number;
      entityId: string;
      part: CanvasTargetPart;
      handle: TransformHandle;
      originalTransform: Transform2D;
      originalCollider?: ColliderComponent;
      originalRender?: RenderComponent;
      geometry: ScaleGeometry;
    }
  | {
      kind: "rotate";
      pointerId: number;
      entityId: string;
      part: CanvasTargetPart;
      originalTransform: Transform2D;
      originalCollider?: ColliderComponent;
      originalRender?: RenderComponent;
      center: Vec2;
      startAngle: number;
      startRotation: number;
    };

type ScaleGeometry = {
  center: Vec2;
  rotation: number;
  width: number;
  height: number;
  scale: Vec2;
};

const MIN_SIZE = 4;
const MAX_SIZE = 4096;
const EPSILON = 0.001;
const rotationSnapStep = Math.PI / 12;
const rotationSnapThreshold = Math.PI / 72;
const DEFAULT_MOVE_SNAP_THRESHOLD = 12;
const DEFAULT_GRID_SNAP_THRESHOLD = 6;
const DEFAULT_MOVE_GRID_SIZE = 48;

let rotationSnapEnabled = true;
let moveSnapEnabled = true;

export function setRotationSnapEnabled(enabled: boolean): void {
  rotationSnapEnabled = enabled;
}

export function setMoveSnapEnabled(enabled: boolean): void {
  moveSnapEnabled = enabled;
}

export function snapRotation(rotation: number): number {
  if (!rotationSnapEnabled) return rotation;
  const snapped = Math.round(rotation / rotationSnapStep) * rotationSnapStep;
  return Math.abs(snapped - rotation) <= rotationSnapThreshold ? snapped : rotation;
}

export function createCanvasDragState(
  pointerId: number,
  entity: Entity,
  part: CanvasTargetPart,
  handle: TransformHandle,
  point: Vec2,
): CanvasDragState {
  const originalTransform = cloneTransform(entity.transform);
  const originalCollider = entity.collider ? cloneCollider(entity.collider) : undefined;
  const originalRender = entity.render ? cloneRender(entity.render) : undefined;
  const center = targetCenter(entity, part);
  if (handle === "core") {
    return {
      kind: "move",
      pointerId,
      entityId: entity.id,
      part,
      originalTransform,
      originalCollider,
      originalRender,
      offset: {
        x: point.x - center.x,
        y: point.y - center.y,
      },
    };
  }
  if (handle === "rotate") {
    return {
      kind: "rotate",
      pointerId,
      entityId: entity.id,
      part,
      originalTransform,
      originalCollider,
      originalRender,
      center,
      startAngle: Math.atan2(point.y - center.y, point.x - center.x),
      startRotation:
        part === "presentation"
          ? entity.render?.rotation || 0
          : (entity.transform.rotation || 0) + (entity.collider?.rotation || 0),
    };
  }
  return {
    kind: "scale",
    pointerId,
    entityId: entity.id,
    part,
    handle,
    originalTransform,
    originalCollider,
    originalRender,
    geometry: scaleGeometry(entity, part),
  };
}

type MoveSnapContext = {
  allEntities: Entity[];
  movingEntityIds: ReadonlySet<string> | readonly string[];
  enabled?: boolean;
  snapThreshold?: number;
  gridSize?: number;
  gridSnapThreshold?: number;
};

export function applyCanvasDragState(
  entity: Entity,
  drag: CanvasDragState,
  point: Vec2,
  moveSnapContext?: MoveSnapContext,
): void {
  if (drag.kind === "move") {
    if (drag.part === "presentation") {
      const center = {
        x: point.x - drag.offset.x,
        y: point.y - drag.offset.y,
      };
      entity.render ||= createDefaultRender(entity.collider?.size);
      entity.render.offset = {
        x: center.x - entity.transform.position.x,
        y: center.y - entity.transform.position.y,
      };
      return;
    }
    const center = {
      x: point.x - drag.offset.x,
      y: point.y - drag.offset.y,
    };
    const snappedCenter = snapMoveCenter({
      sourceEntity: entity,
      targetCenter: center,
      candidateEntities: moveSnapContext?.allEntities || [],
      movingEntityIds: moveSnapContext?.movingEntityIds || [entity.id],
      enabled: moveSnapContext?.enabled ?? moveSnapEnabled,
      snapThreshold: moveSnapContext?.snapThreshold ?? DEFAULT_MOVE_SNAP_THRESHOLD,
      gridSize: moveSnapContext ? moveSnapContext.gridSize ?? DEFAULT_MOVE_GRID_SIZE : undefined,
      gridSnapThreshold: moveSnapContext?.gridSnapThreshold ?? DEFAULT_GRID_SNAP_THRESHOLD,
    });
    const bodyOffset = entity.collider?.offset || { x: 0, y: 0 };
    entity.transform.position = {
      x: snappedCenter.x - bodyOffset.x,
      y: snappedCenter.y - bodyOffset.y,
    };
    return;
  }
  if (drag.kind === "rotate") {
    const angle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x);
    const rotation = snapRotation(drag.startRotation + angle - drag.startAngle);
    if (drag.part === "presentation") {
      entity.render ||= createDefaultRender(entity.collider?.size);
      entity.render.rotation = rotation;
      return;
    }
    entity.transform.rotation = rotation - (entity.collider?.rotation || 0);
    return;
  }
  applyOneSidedScale(entity, drag, point);
}

function snapMoveCenter(params: {
  sourceEntity: Entity;
  targetCenter: Vec2;
  candidateEntities: Entity[];
  movingEntityIds: ReadonlySet<string> | readonly string[];
  enabled?: boolean;
  snapThreshold?: number;
  gridSize?: number;
  gridSnapThreshold?: number;
}): Vec2 {
  if (params.enabled === false) return params.targetCenter;
  if (!params.sourceEntity.collider) return params.targetCenter;

  const bodyOffset = params.sourceEntity.collider.offset || { x: 0, y: 0 };
  const probeEntity: Entity = {
    ...params.sourceEntity,
    transform: {
      ...params.sourceEntity.transform,
      position: {
        x: params.targetCenter.x - bodyOffset.x,
        y: params.targetCenter.y - bodyOffset.y,
      },
    },
    collider: params.sourceEntity.collider,
  };
  const sourceBounds = boundsFor(probeEntity);
  const snap = computeMoveSnap({
    sourceBounds,
    candidateEntities: params.candidateEntities,
    movingEntityIds: params.movingEntityIds,
    snapThreshold: params.snapThreshold ?? DEFAULT_MOVE_SNAP_THRESHOLD,
    gridSize: params.gridSize,
    gridSnapThreshold: params.gridSnapThreshold,
    enabled: params.enabled,
  });
  return {
    x: params.targetCenter.x + snap.x,
    y: params.targetCenter.y + snap.y,
  };
}

function computeMoveSnap(params: {
  sourceBounds: { x: number; y: number; w: number; h: number };
  candidateEntities: Entity[];
  movingEntityIds: ReadonlySet<string> | readonly string[];
  snapThreshold?: number;
  gridSize?: number;
  gridSnapThreshold?: number;
  enabled?: boolean;
}): Vec2 {
  if (params.enabled === false) return { x: 0, y: 0 };
  const snapThreshold = params.snapThreshold ?? DEFAULT_MOVE_SNAP_THRESHOLD;
  const gridSize = params.gridSize && params.gridSize > 0 ? params.gridSize : undefined;
  const gridSnapThreshold = params.gridSnapThreshold ?? DEFAULT_GRID_SNAP_THRESHOLD;
  const movingIds = toIdSet(params.movingEntityIds);

  const sourceLeft = params.sourceBounds.x;
  const sourceRight = params.sourceBounds.x + params.sourceBounds.w;
  const sourceCenterX = params.sourceBounds.x + params.sourceBounds.w / 2;
  const sourceTop = params.sourceBounds.y;
  const sourceBottom = params.sourceBounds.y + params.sourceBounds.h;
  const sourceCenterY = params.sourceBounds.y + params.sourceBounds.h / 2;

  let bestDeltaX = 0;
  let bestDeltaY = 0;
  let bestDistanceX = snapThreshold + 1;
  let bestDistanceY = snapThreshold + 1;

  for (const candidate of params.candidateEntities) {
    if (!candidate.collider || movingIds.has(candidate.id)) continue;
    const bounds = boundsFor(candidate);
    const left = bounds.x;
    const right = bounds.x + bounds.w;
    const centerX = bounds.x + bounds.w / 2;
    const top = bounds.y;
    const bottom = bounds.y + bounds.h;
    const centerY = bounds.y + bounds.h / 2;

    const xSnap = closestAnchorSnap([sourceLeft, sourceCenterX, sourceRight], [left, centerX, right], snapThreshold);
    if (xSnap && xSnap.distance < bestDistanceX) {
      bestDistanceX = xSnap.distance;
      bestDeltaX = xSnap.delta;
    }

    const ySnap = closestAnchorSnap([sourceTop, sourceCenterY, sourceBottom], [top, centerY, bottom], snapThreshold);
    if (ySnap && ySnap.distance < bestDistanceY) {
      bestDistanceY = ySnap.distance;
      bestDeltaY = ySnap.delta;
    }
  }

  if (gridSize) {
    const gridX = closestGridSnap([sourceLeft, sourceCenterX, sourceRight], gridSize, gridSnapThreshold);
    if (gridX && gridX.distance < bestDistanceX) {
      bestDistanceX = gridX.distance;
      bestDeltaX = gridX.delta;
    }
    const gridY = closestGridSnap([sourceTop, sourceCenterY, sourceBottom], gridSize, gridSnapThreshold);
    if (gridY && gridY.distance < bestDistanceY) {
      bestDistanceY = gridY.distance;
      bestDeltaY = gridY.delta;
    }
  }

  return { x: bestDeltaX, y: bestDeltaY };
}

function closestAnchorSnap(sourceAnchors: number[], targetAnchors: number[], threshold: number): { delta: number; distance: number } | undefined {
  let best: { delta: number; distance: number } | undefined;
  for (const source of sourceAnchors) {
    for (const target of targetAnchors) {
      const delta = target - source;
      const distance = Math.abs(delta);
      if (distance <= threshold && (!best || distance < best.distance)) best = { delta, distance };
    }
  }
  return best;
}

function closestGridSnap(sourceAnchors: number[], gridSize: number, threshold: number): { delta: number; distance: number } | undefined {
  let best: { delta: number; distance: number } | undefined;
  for (const source of sourceAnchors) {
    const target = Math.round(source / gridSize) * gridSize;
    const delta = target - source;
    const distance = Math.abs(delta);
    if (distance <= threshold && (!best || distance < best.distance)) best = { delta, distance };
  }
  return best;
}

function toIdSet(values: ReadonlySet<string> | readonly string[]): Set<string> {
  return values instanceof Set ? values : new Set(values);
}

type DragKind = "move" | "scale" | "rotate";

function actionLabels(kind: DragKind): { start: string; finish: string } {
  if (kind === "move") return { start: "移动", finish: "位置已调整" };
  if (kind === "scale") return { start: "缩放", finish: "大小已调整" };
  return { start: "旋转", finish: "旋转已调整" };
}

export function dragNotice(kind: CanvasDragState["kind"], phase: "start" | "finish"): string {
  if (phase === "finish") {
    return kind === "move" ? "对象位置已调整。" : kind === "scale" ? "对象大小已调整。" : "对象旋转已调整。";
  }
  return kind === "move" ? "正在通过核心点移动对象。" : kind === "scale" ? "正在调整对象大小。" : "正在旋转对象。";
}

export function cursorForTransformHandle(handle: TransformHandle): string {
  if (handle === "core") return "move";
  if (handle === "rotate") return "grab";
  if (handle === "scale-e" || handle === "scale-w") return "ew-resize";
  if (handle === "scale-n" || handle === "scale-s") return "ns-resize";
  return handle === "scale-nw" || handle === "scale-se" ? "nwse-resize" : "nesw-resize";
}

function applyOneSidedScale(entity: Entity, drag: Extract<CanvasDragState, { kind: "scale" }>, point: Vec2): void {
  const local = toLocal(drag.geometry.center, point, drag.geometry.rotation);
  const sides = scaleSides(drag.handle);
  let left = -drag.geometry.width / 2;
  let right = drag.geometry.width / 2;
  let top = -drag.geometry.height / 2;
  let bottom = drag.geometry.height / 2;

  if (sides.x === "left") left = Math.min(right - 4, local.x);
  if (sides.x === "right") right = Math.max(left + 4, local.x);
  if (sides.y === "top") top = Math.min(bottom - 4, local.y);
  if (sides.y === "bottom") bottom = Math.max(top + 4, local.y);

  const width = clamp(right - left, MIN_SIZE, MAX_SIZE);
  const height = clamp(bottom - top, MIN_SIZE, MAX_SIZE);
  const center = fromLocal(drag.geometry.center, { x: (left + right) / 2, y: (top + bottom) / 2 }, drag.geometry.rotation);

  if (drag.part === "presentation") {
    entity.render ||= createDefaultRender(entity.collider?.size);
    const scale = drag.geometry.scale;
    entity.render.size = {
      x: clamp(width / Math.max(Math.abs(scale.x), EPSILON), MIN_SIZE, MAX_SIZE),
      y: clamp(height / Math.max(Math.abs(scale.y), EPSILON), MIN_SIZE, MAX_SIZE),
    };
    entity.render.offset = {
      x: center.x - entity.transform.position.x,
      y: center.y - entity.transform.position.y,
    };
    return;
  }

  entity.collider ||= createDefaultCollider();
  const scale = drag.geometry.scale;
  const bodyOffset = entity.collider.offset || { x: 0, y: 0 };
  entity.transform.position = {
    x: center.x - bodyOffset.x,
    y: center.y - bodyOffset.y,
  };
  entity.collider.size = {
    x: clamp(width / Math.max(Math.abs(scale.x), EPSILON), MIN_SIZE, MAX_SIZE),
    y: clamp(height / Math.max(Math.abs(scale.y), EPSILON), MIN_SIZE, MAX_SIZE),
  };
  if (entity.collider.shape === "circle") entity.collider.radius = Math.min(entity.collider.size.x, entity.collider.size.y) / 2;
}

function scaleGeometry(entity: Entity, part: CanvasTargetPart): ScaleGeometry {
  const transformScale = entity.transform.scale || { x: 1, y: 1 };
  const renderScale = entity.render?.scale || { x: 1, y: 1 };
  const size = part === "presentation" ? entity.render?.size || defaultPresentationSize(entity.collider?.size) : entity.collider?.size || { x: 60, y: 60 };
  const scale =
    part === "presentation"
      ? { x: renderScale.x * transformScale.x, y: renderScale.y * transformScale.y }
      : transformScale;
  return {
    center: targetCenter(entity, part),
    rotation:
      part === "presentation"
        ? (entity.transform.rotation || 0) + (entity.render?.rotation || 0)
        : (entity.transform.rotation || 0) + (entity.collider?.rotation || 0),
    width: size.x * Math.max(Math.abs(scale.x), EPSILON),
    height: size.y * Math.max(Math.abs(scale.y), EPSILON),
    scale: { ...scale },
  };
}

function targetCenter(entity: Entity, part: CanvasTargetPart): Vec2 {
  if (part === "presentation") {
    const offset = entity.render?.offset || { x: 0, y: 0 };
    return {
      x: entity.transform.position.x + offset.x,
      y: entity.transform.position.y + offset.y,
    };
  }
  const offset = entity.collider?.offset || { x: 0, y: 0 };
  return {
    x: entity.transform.position.x + offset.x,
    y: entity.transform.position.y + offset.y,
  };
}

function scaleSides(handle: TransformHandle): { x?: "left" | "right"; y?: "top" | "bottom" } {
  const suffix = handle.startsWith("scale-") ? handle.slice("scale-".length) : "";
  return {
    x: suffix.includes("w") ? "left" : suffix.includes("e") ? "right" : undefined,
    y: suffix.includes("n") ? "top" : suffix.includes("s") ? "bottom" : undefined,
  };
}

function cloneTransform(transform: Transform2D): Transform2D {
  return {
    position: { ...transform.position },
    rotation: transform.rotation,
    scale: { ...transform.scale },
  };
}

function cloneCollider(collider: ColliderComponent): ColliderComponent {
  return {
    ...collider,
    size: { ...collider.size },
    offset: collider.offset ? { ...collider.offset } : undefined,
    points: collider.points?.map((point) => ({ ...point })),
    layerMask: [...collider.layerMask],
  };
}

function cloneRender(render: RenderComponent): RenderComponent {
  return {
    ...render,
    size: render.size ? { ...render.size } : undefined,
    offset: render.offset ? { ...render.offset } : undefined,
    scale: render.scale ? { ...render.scale } : undefined,
  };
}

function createDefaultCollider(): ColliderComponent {
  return {
    shape: "box",
    size: { x: 64, y: 64 },
    offset: { x: 0, y: 0 },
    rotation: 0,
    solid: true,
    trigger: false,
    layerMask: ["world"],
  };
}

function createDefaultRender(bodySize?: Vec2): RenderComponent {
  return {
    visible: true,
    color: "#74a8bd",
    opacity: 1,
    layerId: "world",
    size: defaultPresentationSize(bodySize),
    offset: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    slot: "current",
    state: "current",
  };
}

function defaultPresentationSize(bodySize?: Vec2): Vec2 {
  const size = bodySize || { x: 64, y: 64 };
  return {
    x: Math.max(12, size.x),
    y: Math.max(12, size.y),
  };
}

export type MultiEntityEntry = {
  entityId: EntityId;
  originalTransform: Transform2D;
  originalCollider?: ColliderComponent;
};

export type MultiCanvasDragState =
  | {
      kind: "move";
      pointerId: number;
      entries: MultiEntityEntry[];
      groupBounds: Bounds;
      offset: Vec2;
    }
  | {
      kind: "scale";
      pointerId: number;
      entries: MultiEntityEntry[];
      handle: TransformHandle;
      groupBounds: Bounds;
    }
  | {
      kind: "rotate";
      pointerId: number;
      entries: MultiEntityEntry[];
      groupBounds: Bounds;
      startAngle: number;
    };

export function createMultiCanvasDragState(
  pointerId: number,
  entities: Entity[],
  handle: TransformHandle,
  point: Vec2,
): MultiCanvasDragState {
  const groupBounds = computeMultiSelectionBounds(entities);
  const entries: MultiEntityEntry[] = entities.map((entity) => ({
    entityId: entity.id,
    originalTransform: cloneTransform(entity.transform),
    originalCollider: entity.collider ? cloneCollider(entity.collider) : undefined,
  }));

  if (handle === "core") {
    return {
      kind: "move",
      pointerId,
      entries,
      groupBounds,
      offset: { x: point.x - groupBounds.center.x, y: point.y - groupBounds.center.y },
    };
  }
  if (handle === "rotate") {
    return {
      kind: "rotate",
      pointerId,
      entries,
      groupBounds,
      startAngle: Math.atan2(point.y - groupBounds.center.y, point.x - groupBounds.center.x),
    };
  }
  return {
    kind: "scale",
    pointerId,
    entries,
    handle,
    groupBounds,
  };
}

export function applyMultiCanvasDragState(
  entities: Entity[],
  drag: MultiCanvasDragState,
  point: Vec2,
  moveSnapContext?: MoveSnapContext,
): void {
  const entityMap = new Map(entities.map((e) => [e.id, e]));
  if (drag.kind === "move") {
    const newCenter = { x: point.x - drag.offset.x, y: point.y - drag.offset.y };
    const movedBounds = {
      x: newCenter.x - drag.groupBounds.width / 2,
      y: newCenter.y - drag.groupBounds.height / 2,
      w: drag.groupBounds.width,
      h: drag.groupBounds.height,
    };
    const snap = computeMoveSnap({
      sourceBounds: movedBounds,
      candidateEntities: moveSnapContext?.allEntities || entities,
      movingEntityIds: moveSnapContext?.movingEntityIds || drag.entries.map((entry) => entry.entityId),
      snapThreshold: moveSnapContext?.snapThreshold ?? DEFAULT_MOVE_SNAP_THRESHOLD,
      gridSize: moveSnapContext ? moveSnapContext.gridSize ?? DEFAULT_MOVE_GRID_SIZE : undefined,
      gridSnapThreshold: moveSnapContext?.gridSnapThreshold ?? DEFAULT_GRID_SNAP_THRESHOLD,
      enabled: moveSnapContext?.enabled ?? moveSnapEnabled,
    });
    const dx = newCenter.x - drag.groupBounds.center.x + snap.x;
    const dy = newCenter.y - drag.groupBounds.center.y + snap.y;
    for (const entry of drag.entries) {
      const entity = entityMap.get(entry.entityId);
      if (!entity) continue;
      entity.transform.position = {
        x: entry.originalTransform.position.x + dx,
        y: entry.originalTransform.position.y + dy,
      };
    }
    return;
  }
  if (drag.kind === "rotate") {
    const angle = Math.atan2(point.y - drag.groupBounds.center.y, point.x - drag.groupBounds.center.x);
    const deltaAngle = snapRotation(angle - drag.startAngle);
    const cos = Math.cos(deltaAngle);
    const sin = Math.sin(deltaAngle);
    const cx = drag.groupBounds.center.x;
    const cy = drag.groupBounds.center.y;
    for (const entry of drag.entries) {
      const entity = entityMap.get(entry.entityId);
      if (!entity) continue;
      const ox = entry.originalTransform.position.x - cx;
      const oy = entry.originalTransform.position.y - cy;
      entity.transform.position = {
        x: cx + ox * cos - oy * sin,
        y: cy + ox * sin + oy * cos,
      };
      entity.transform.rotation = (entry.originalTransform.rotation || 0) + deltaAngle;
    }
    return;
  }
  applyMultiScale(entities, drag, point);
}

function applyMultiScale(entities: Entity[], drag: Extract<MultiCanvasDragState, { kind: "scale" }>, point: Vec2): void {
  const entityMap = new Map(entities.map((e) => [e.id, e]));
  const bounds = drag.groupBounds;
  const sides = scaleSides(drag.handle);

  let left = bounds.center.x - bounds.width / 2;
  let right = bounds.center.x + bounds.width / 2;
  let top = bounds.center.y - bounds.height / 2;
  let bottom = bounds.center.y + bounds.height / 2;

  if (sides.x === "left") left = Math.min(right - MIN_SIZE, point.x);
  if (sides.x === "right") right = Math.max(left + MIN_SIZE, point.x);
  if (sides.y === "top") top = Math.min(bottom - MIN_SIZE, point.y);
  if (sides.y === "bottom") bottom = Math.max(top + MIN_SIZE, point.y);

  const newWidth = Math.max(MIN_SIZE, right - left);
  const newHeight = Math.max(MIN_SIZE, bottom - top);
  const newCenter = { x: (left + right) / 2, y: (top + bottom) / 2 };

  const sx = bounds.width > 0 ? newWidth / bounds.width : 1;
  const sy = bounds.height > 0 ? newHeight / bounds.height : 1;

  for (const entry of drag.entries) {
    const entity = entityMap.get(entry.entityId);
    if (!entity) continue;
    const ox = entry.originalTransform.position.x - bounds.center.x;
    const oy = entry.originalTransform.position.y - bounds.center.y;
    entity.transform.position = {
      x: newCenter.x + ox * sx,
      y: newCenter.y + oy * sy,
    };
    entity.transform.scale = {
      x: (entry.originalTransform.scale?.x || 1) * sx,
      y: (entry.originalTransform.scale?.y || 1) * sy,
    };
  }
}

export function multiDragNotice(kind: MultiCanvasDragState["kind"], phase: "start" | "finish", count: number): string {
  const labels = actionLabels(kind);
  if (phase === "finish") return `${count} 个对象${labels.finish}。`;
  return `正在${labels.start} ${count} 个对象。`;
}
