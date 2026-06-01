// Owns editor-space geometry calculations shared by renderer and canvas transforms.
// The functions here stay free of Pixi/runtime drawing state so smoke tests can
// import them without constructing a renderer. Renderer re-exports selected APIs
// for existing call sites that still import from ./renderer.
import type { Entity } from "../project/schema";
import type { Vec2 } from "../shared/types";

export type CanvasTargetPart = "body" | "presentation";

export type TargetGeometry = {
  center: Vec2;
  rotation: number;
  width: number;
  height: number;
};

export type GeometryAabb = { x: number; y: number; w: number; h: number };

export const MIN_SCALE_EPSILON = 0.08;

export function geometryAabb(geometry: TargetGeometry): GeometryAabb {
  const hw = geometry.width / 2;
  const hh = geometry.height / 2;
  const points = [
    fromLocal(geometry.center, { x: -hw, y: -hh }, geometry.rotation),
    fromLocal(geometry.center, { x: hw, y: -hh }, geometry.rotation),
    fromLocal(geometry.center, { x: hw, y: hh }, geometry.rotation),
    fromLocal(geometry.center, { x: -hw, y: hh }, geometry.rotation),
  ];
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

export function computeMultiSelectionBounds(entities: Entity[]): { center: Vec2; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of entities) {
    const geom = targetGeometry(entity, "body");
    const aabb = geometryAabb(geom);
    if (aabb.x < minX) minX = aabb.x;
    if (aabb.y < minY) minY = aabb.y;
    if (aabb.x + aabb.w > maxX) maxX = aabb.x + aabb.w;
    if (aabb.y + aabb.h > maxY) maxY = aabb.y + aabb.h;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: Math.max(width, 4),
    height: Math.max(height, 4),
  };
}

export function targetGeometry(entity: Entity, part: CanvasTargetPart): TargetGeometry {
  const transformScale = entity.transform.scale || { x: 1, y: 1 };
  if (part === "presentation") {
    const bodySize = entity.collider?.size || { x: 60, y: 60 };
    const size = entity.render?.size || { x: Math.max(12, bodySize.x), y: Math.max(12, bodySize.y) };
    const scale = entity.render?.scale || { x: 1, y: 1 };
    const offset = entity.render?.offset || { x: 0, y: 0 };
    return {
      center: {
        x: entity.transform.position.x + offset.x,
        y: entity.transform.position.y + offset.y,
      },
      rotation: (entity.transform.rotation || 0) + (entity.render?.rotation || 0),
      width: size.x * Math.max(Math.abs(scale.x), MIN_SCALE_EPSILON) * Math.max(Math.abs(transformScale.x), MIN_SCALE_EPSILON),
      height: size.y * Math.max(Math.abs(scale.y), MIN_SCALE_EPSILON) * Math.max(Math.abs(transformScale.y), MIN_SCALE_EPSILON),
    };
  }
  const size = entity.collider?.size || entity.render?.size || { x: 60, y: 60 };
  const offset = entity.collider?.offset || { x: 0, y: 0 };
  return {
    center: {
      x: entity.transform.position.x + offset.x,
      y: entity.transform.position.y + offset.y,
    },
    rotation: (entity.transform.rotation || 0) + (entity.collider?.rotation || 0),
    width: size.x * Math.max(Math.abs(transformScale.x), MIN_SCALE_EPSILON),
    height: size.y * Math.max(Math.abs(transformScale.y), MIN_SCALE_EPSILON),
  };
}

export function fromLocal(center: Vec2, local: Vec2, rotation: number): Vec2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + local.x * cos - local.y * sin,
    y: center.y + local.x * sin + local.y * cos,
  };
}

export function toLocal(center: Vec2, point: Vec2, rotation: number): Vec2 {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const GeometryMath = {
  clamp,
  computeMultiSelectionBounds,
  fromLocal,
  geometryAabb,
  targetGeometry,
  toLocal,
} as const;
