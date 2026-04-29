import type { ColliderComponent, Entity } from "../project/schema";
import type { Rect, Vec2 } from "../shared/types";

export type CollisionHit = {
  a: Entity;
  b: Entity;
  normal: Vec2;
  depth: number;
  trigger: boolean;
};

export type CollisionQuery = {
  rect: Rect;
  layerMask?: string[];
  includeTriggers?: boolean;
};

export function boundsFor(entity: Entity): Rect {
  const polygon = colliderWorldPolygon(entity);
  if (polygon && !canUseOrientedBox(entity)) return boundsForPoints(polygon);
  const size = entity.collider?.size || { x: 0, y: 0 };
  const scale = entity.transform.scale || { x: 1, y: 1 };
  const w = size.x * Math.max(Math.abs(scale.x), 0.001);
  const h = size.y * Math.max(Math.abs(scale.y), 0.001);
  const rotation = (entity.transform.rotation || 0) + (entity.collider?.rotation || 0);
  const extents = rotatedAabbSize(w, h, rotation);
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

export function queryEntities(entities: Entity[], query: CollisionQuery): Entity[] {
  return entities.filter((entity) => {
    const collider = entity.collider;
    if (!collider) return false;
    if (!query.includeTriggers && collider.trigger) return false;
    if (query.layerMask && !sharesLayer(collider, query.layerMask)) return false;
    return entityIntersectsRect(entity, query.rect);
  });
}

export function entityIntersectsRect(entity: Entity, rect: Rect): boolean {
  if (!entity.collider) return false;
  const polygon = colliderWorldPolygon(entity);
  if (polygon && !canUseOrientedBox(entity)) return polygonsOverlap(polygon, rectPolygon(rect));
  if (!canUseOrientedBox(entity)) return overlaps(boundsFor(entity), rect);
  return orientedBoxesOverlap(orientedBoxFor(entity), rectAsBox(rect));
}

export function collectPairs(entities: Entity[]): CollisionHit[] {
  const hits: CollisionHit[] = [];
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const a = entities[i];
      const b = entities[j];
      if (!a.collider || !b.collider) continue;
      if (!canCollide(a, b)) continue;
      const hit = collideAabb(a, b);
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

export function collectDynamicPairs(entities: Entity[]): CollisionHit[] {
  const hits: CollisionHit[] = [];
  const solidEntities = entities.filter((entity) => entity.collider?.solid);
  const dynamicEntities = solidEntities.filter((entity) => entity.body?.mode === "dynamic");
  const boundsCache = new Map<string, Rect>();
  const seenPairs = new Set<string>();

  for (const dynamic of dynamicEntities) {
    for (const other of solidEntities) {
      if (dynamic.id === other.id) continue;
      const key = dynamic.id < other.id ? `${dynamic.id}|${other.id}` : `${other.id}|${dynamic.id}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      if (!canCollide(dynamic, other)) continue;
      if (!overlaps(cachedBounds(dynamic, boundsCache), cachedBounds(other, boundsCache))) continue;
      const hit = collideAabb(dynamic, other);
      if (hit) hits.push(hit);
    }
  }

  return hits;
}

function canCollide(a: Entity, b: Entity): boolean {
  if (!a.collider || !b.collider) return false;
  const includesTrigger = a.collider.trigger || b.collider.trigger;
  const includesSolid = a.collider.solid && b.collider.solid;
  if (!includesTrigger && !includesSolid) return false;
  return sharesLayer(a.collider, b.collider.layerMask) && sharesLayer(b.collider, a.collider.layerMask);
}

function cachedBounds(entity: Entity, cache: Map<string, Rect>): Rect {
  const cached = cache.get(entity.id);
  if (cached) return cached;
  const bounds = boundsFor(entity);
  cache.set(entity.id, bounds);
  return bounds;
}

function collideAabb(a: Entity, b: Entity): CollisionHit | null {
  const oriented = collideOrientedBoxes(a, b);
  if (oriented) return oriented;
  if (oriented === null && canUseOrientedBox(a) && canUseOrientedBox(b)) return null;
  const polygonHit = collidePolygons(a, b);
  if (polygonHit !== undefined) return polygonHit;
  return collideBounds(a, b);
}

function collideBounds(a: Entity, b: Entity): CollisionHit | null {
  const ab = boundsFor(a);
  const bb = boundsFor(b);
  if (!overlaps(ab, bb)) return null;
  const dx = ab.x + ab.w / 2 - (bb.x + bb.w / 2);
  const dy = ab.y + ab.h / 2 - (bb.y + bb.h / 2);
  const px = ab.w / 2 + bb.w / 2 - Math.abs(dx);
  const py = ab.h / 2 + bb.h / 2 - Math.abs(dy);
  const trigger = Boolean(a.collider?.trigger || b.collider?.trigger);
  if (px < py) return { a, b, normal: { x: Math.sign(dx) || 1, y: 0 }, depth: px, trigger };
  return { a, b, normal: { x: 0, y: Math.sign(dy) || 1 }, depth: py, trigger };
}

function collidePolygons(a: Entity, b: Entity): CollisionHit | null | undefined {
  if (canUseOrientedBox(a) && canUseOrientedBox(b)) return undefined;
  const polygonA = colliderWorldPolygon(a);
  const polygonB = colliderWorldPolygon(b);
  if (!polygonA || !polygonB) return undefined;
  if (!overlaps(boundsForPoints(polygonA), boundsForPoints(polygonB))) return null;
  if (!polygonsOverlap(polygonA, polygonB)) return null;
  return collideBounds(a, b);
}

function collideOrientedBoxes(a: Entity, b: Entity): CollisionHit | null | undefined {
  if (!canUseOrientedBox(a) || !canUseOrientedBox(b)) return undefined;
  const boxA = orientedBoxFor(a);
  const boxB = orientedBoxFor(b);
  const axes = [...boxAxes(boxA), ...boxAxes(boxB)];
  const centerDelta = { x: boxA.center.x - boxB.center.x, y: boxA.center.y - boxB.center.y };
  let bestDepth = Number.POSITIVE_INFINITY;
  let bestNormal: Vec2 | undefined;
  for (const axis of axes) {
    const projectionA = projectCorners(boxCorners(boxA), axis);
    const projectionB = projectCorners(boxCorners(boxB), axis);
    const depth = Math.min(projectionA.max, projectionB.max) - Math.max(projectionA.min, projectionB.min);
    if (depth <= 0) return null;
    if (depth < bestDepth) {
      bestDepth = depth;
      const direction = centerDelta.x * axis.x + centerDelta.y * axis.y < 0 ? -1 : 1;
      bestNormal = { x: axis.x * direction, y: axis.y * direction };
    }
  }
  if (!bestNormal || !Number.isFinite(bestDepth)) return null;
  return { a, b, normal: bestNormal, depth: bestDepth, trigger: Boolean(a.collider?.trigger || b.collider?.trigger) };
}

function orientedBoxesOverlap(a: OrientedBox, b: OrientedBox): boolean {
  for (const axis of [...boxAxes(a), ...boxAxes(b)]) {
    const projectionA = projectCorners(boxCorners(a), axis);
    const projectionB = projectCorners(boxCorners(b), axis);
    const depth = Math.min(projectionA.max, projectionB.max) - Math.max(projectionA.min, projectionB.min);
    if (depth <= 0) return false;
  }
  return true;
}

function colliderWorldPolygon(entity: Entity): Vec2[] | undefined {
  if (!entity.collider) return undefined;
  if (canUseOrientedBox(entity)) return boxCorners(orientedBoxFor(entity));
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

function rectPolygon(rect: Rect): Vec2[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
}

function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
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

function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects = current.y > point.y !== previous.y > point.y && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || 0.000001) + current.x;
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

function boundsForPoints(points: Vec2[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function rotateLocalPoint(center: Vec2, local: Vec2, rotation: number): Vec2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + local.x * cos - local.y * sin,
    y: center.y + local.x * sin + local.y * cos,
  };
}

function subtract(left: Vec2, right: Vec2): Vec2 {
  return { x: left.x - right.x, y: left.y - right.y };
}

function cross(left: Vec2, right: Vec2): number {
  return left.x * right.y - left.y * right.x;
}

function sharesLayer(collider: ColliderComponent, layerMask: string[]): boolean {
  if (collider.layerMask.length === 0 || layerMask.length === 0) return true;
  return collider.layerMask.some((layer) => layerMask.includes(layer));
}

function colliderCenter(entity: Entity): Vec2 {
  const offset = entity.collider?.offset || { x: 0, y: 0 };
  return {
    x: entity.transform.position.x + offset.x,
    y: entity.transform.position.y + offset.y,
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

type OrientedBox = {
  center: Vec2;
  width: number;
  height: number;
  rotation: number;
};

function canUseOrientedBox(entity: Entity): boolean {
  return Boolean(entity.collider && (!entity.collider.shape || entity.collider.shape === "box"));
}

function orientedBoxFor(entity: Entity): OrientedBox {
  const size = entity.collider?.size || { x: 0, y: 0 };
  const scale = entity.transform.scale || { x: 1, y: 1 };
  return {
    center: colliderCenter(entity),
    width: size.x * Math.max(Math.abs(scale.x), 0.001),
    height: size.y * Math.max(Math.abs(scale.y), 0.001),
    rotation: (entity.transform.rotation || 0) + (entity.collider?.rotation || 0),
  };
}

function rectAsBox(rect: Rect): OrientedBox {
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

function boxAxes(box: OrientedBox): Vec2[] {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  return [
    { x: cos, y: sin },
    { x: -sin, y: cos },
  ];
}

function boxCorners(box: OrientedBox): Vec2[] {
  const hw = box.width / 2;
  const hh = box.height / 2;
  return [
    localToWorld(box, { x: -hw, y: -hh }),
    localToWorld(box, { x: hw, y: -hh }),
    localToWorld(box, { x: hw, y: hh }),
    localToWorld(box, { x: -hw, y: hh }),
  ];
}

function localToWorld(box: OrientedBox, local: Vec2): Vec2 {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  return {
    x: box.center.x + local.x * cos - local.y * sin,
    y: box.center.y + local.x * sin + local.y * cos,
  };
}

function projectCorners(corners: Vec2[], axis: Vec2): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const value = corner.x * axis.x + corner.y * axis.y;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}
