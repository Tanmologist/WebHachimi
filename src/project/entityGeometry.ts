// Owns world-space geometry derived from project Entity collider data. Runtime
// collision, combat windows, editor selection, and player debug rendering share
// these helpers so entity bounds stay consistent without cross-importing each
// other's modules.
import type { Entity } from "./schema";
import type { Rect, Vec2 } from "../shared/types";

export type OrientedBox = {
  center: Vec2;
  width: number;
  height: number;
  rotation: number;
};

export function boundsFor(entity: Entity): Rect {
  const polygon = entityColliderWorldPolygon(entity);
  if (polygon && !entityUsesOrientedBox(entity)) return boundsForPoints(polygon);
  const size = entity.collider?.size || { x: 0, y: 0 };
  const scale = entity.transform.scale || { x: 1, y: 1 };
  const width = size.x * Math.max(Math.abs(scale.x), 0.001);
  const height = size.y * Math.max(Math.abs(scale.y), 0.001);
  const rotation = (entity.transform.rotation || 0) + (entity.collider?.rotation || 0);
  const extents = rotatedAabbSize(width, height, rotation);
  const center = colliderCenter(entity);
  return {
    x: center.x - extents.x / 2,
    y: center.y - extents.y / 2,
    w: extents.x,
    h: extents.y,
  };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function entityColliderWorldPolygon(entity: Entity): Vec2[] | undefined {
  if (!entity.collider) return undefined;
  if (entityUsesOrientedBox(entity)) return boxCorners(orientedBoxForEntity(entity));
  if (entity.collider.shape === "circle") return circlePolygon(entity);
  if (entity.collider.shape === "polygon" && entity.collider.points && entity.collider.points.length >= 3) {
    const center = colliderCenter(entity);
    const rotation = (entity.transform.rotation || 0) + (entity.collider.rotation || 0);
    const scale = entity.transform.scale || { x: 1, y: 1 };
    return entity.collider.points.map((point) =>
      rotateLocalPoint(
        center,
        {
          x: point.x * Math.max(Math.abs(scale.x), 0.001),
          y: point.y * Math.max(Math.abs(scale.y), 0.001),
        },
        rotation,
      ),
    );
  }
  return undefined;
}

export function entityUsesOrientedBox(entity: Entity): boolean {
  return Boolean(entity.collider && (!entity.collider.shape || entity.collider.shape === "box"));
}

export function orientedBoxForEntity(entity: Entity): OrientedBox {
  const size = entity.collider?.size || { x: 0, y: 0 };
  const scale = entity.transform.scale || { x: 1, y: 1 };
  return {
    center: colliderCenter(entity),
    width: size.x * Math.max(Math.abs(scale.x), 0.001),
    height: size.y * Math.max(Math.abs(scale.y), 0.001),
    rotation: (entity.transform.rotation || 0) + (entity.collider?.rotation || 0),
  };
}

export function rectAsOrientedBox(rect: Rect): OrientedBox {
  return {
    center: {
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
    },
    width: rect.w,
    height: rect.h,
    rotation: 0,
  };
}

export function orientedBoxesOverlap(a: OrientedBox, b: OrientedBox): boolean {
  for (const axis of [...boxAxes(a), ...boxAxes(b)]) {
    const projectionA = projectCorners(boxCorners(a), axis);
    const projectionB = projectCorners(boxCorners(b), axis);
    const depth = Math.min(projectionA.max, projectionB.max) - Math.max(projectionA.min, projectionB.min);
    if (depth <= 0) return false;
  }
  return true;
}

export function rectPolygon(rect: Rect): Vec2[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
}

export function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  if (a.some((point) => pointInPolygon(point, b))) return true;
  if (b.some((point) => pointInPolygon(point, a))) return true;
  for (let indexA = 0; indexA < a.length; indexA += 1) {
    const aStart = a[indexA];
    const aEnd = a[(indexA + 1) % a.length];
    for (let indexB = 0; indexB < b.length; indexB += 1) {
      if (segmentsIntersect(aStart, aEnd, b[indexB], b[(indexB + 1) % b.length])) return true;
    }
  }
  return false;
}

export function boundsForPoints(points: Vec2[]): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boxAxes(box: OrientedBox): Vec2[] {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  return [
    { x: cos, y: sin },
    { x: -sin, y: cos },
  ];
}

export function boxCorners(box: OrientedBox): Vec2[] {
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  return [
    localToWorld(box, { x: -halfWidth, y: -halfHeight }),
    localToWorld(box, { x: halfWidth, y: -halfHeight }),
    localToWorld(box, { x: halfWidth, y: halfHeight }),
    localToWorld(box, { x: -halfWidth, y: halfHeight }),
  ];
}

export function projectCorners(corners: Vec2[], axis: Vec2): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const value = corner.x * axis.x + corner.y * axis.y;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function colliderCenter(entity: Entity): Vec2 {
  const offset = entity.collider?.offset || { x: 0, y: 0 };
  return {
    x: entity.transform.position.x + offset.x,
    y: entity.transform.position.y + offset.y,
  };
}

function circlePolygon(entity: Entity): Vec2[] {
  const center = colliderCenter(entity);
  const size = entity.collider?.size || { x: 0, y: 0 };
  const scale = entity.transform.scale || { x: 1, y: 1 };
  const radius = entity.collider?.radius || Math.min(size.x, size.y) / 2;
  const radiusX = Math.max(0.001, (radius || size.x / 2) * Math.max(Math.abs(scale.x), 0.001));
  const radiusY = Math.max(0.001, (radius || size.y / 2) * Math.max(Math.abs(scale.y), 0.001));
  const rotation = (entity.transform.rotation || 0) + (entity.collider?.rotation || 0);
  const points: Vec2[] = [];
  for (let index = 0; index < 24; index += 1) {
    const angle = (Math.PI * 2 * index) / 24;
    points.push(rotateLocalPoint(center, { x: Math.cos(angle) * radiusX, y: Math.sin(angle) * radiusY }, rotation));
  }
  return points;
}

function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || 0.000001) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const ab1 = cross(subtract(c, a), subtract(b, a));
  const ab2 = cross(subtract(d, a), subtract(b, a));
  const cd1 = cross(subtract(a, c), subtract(d, c));
  const cd2 = cross(subtract(b, c), subtract(d, c));
  return ab1 * ab2 <= 0 && cd1 * cd2 <= 0;
}

function rotateLocalPoint(center: Vec2, local: Vec2, rotation: number): Vec2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + local.x * cos - local.y * sin,
    y: center.y + local.x * sin + local.y * cos,
  };
}

function rotatedAabbSize(width: number, height: number, rotation: number): Vec2 {
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  return {
    x: width * cos + height * sin,
    y: width * sin + height * cos,
  };
}

function localToWorld(box: OrientedBox, local: Vec2): Vec2 {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  return {
    x: box.center.x + local.x * cos - local.y * sin,
    y: box.center.y + local.x * sin + local.y * cos,
  };
}

function subtract(left: Vec2, right: Vec2): Vec2 {
  return { x: left.x - right.x, y: left.y - right.y };
}

function cross(left: Vec2, right: Vec2): number {
  return left.x * right.y - left.y * right.x;
}
