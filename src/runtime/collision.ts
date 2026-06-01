// Owns broad-phase and narrow-phase collision queries for RuntimeWorld and editor
// picking helpers. Public entry points return project Entity references, while the
// private helpers keep AABB, oriented box, and polygon checks allocation-light
// enough for fixed-step runtime use.
import type { ColliderComponent, Entity } from "../project/schema";
import {
  boundsFor,
  boundsForPoints,
  boxAxes,
  boxCorners,
  entityColliderWorldPolygon as colliderWorldPolygon,
  entityUsesOrientedBox as canUseOrientedBox,
  overlaps,
  orientedBoxForEntity as orientedBoxFor,
  orientedBoxesOverlap,
  polygonsOverlap,
  projectCorners,
  rectAsOrientedBox as rectAsBox,
  rectPolygon,
} from "../project/entityGeometry";
import type { Rect, Vec2 } from "../shared/types";

export { boundsFor, overlaps } from "../project/entityGeometry";

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

const staticGridCellSize = 256;
const maxStaticGridCells = 64;

class CollisionBoundsCache {
  private readonly bounds = new Map<string, Rect>();

  forEntity(entity: Entity): Rect {
    const cached = this.bounds.get(entity.id);
    if (cached) return cached;
    const bounds = boundsFor(entity);
    this.bounds.set(entity.id, bounds);
    return bounds;
  }
}

class StaticCollisionBroadPhase {
  private readonly broad: Entity[] = [];
  private readonly grid = new Map<string, Entity[]>();
  private readonly order = new Map<string, number>();

  constructor(
    staticEntities: Entity[],
    private readonly boundsCache: CollisionBoundsCache,
    private readonly cellSize = staticGridCellSize,
  ) {
    staticEntities.forEach((entity, index) => this.insert(entity, index));
  }

  candidatesFor(bounds: Rect, seen: Set<string>): Entity[] {
    seen.clear();
    const candidates: Entity[] = [];
    for (const entity of this.broad) appendStaticCandidate(candidates, seen, entity);
    const range = gridRangeForBounds(bounds, this.cellSize);
    for (let cellY = range.minY; cellY <= range.maxY; cellY += 1) {
      for (let cellX = range.minX; cellX <= range.maxX; cellX += 1) {
        const bucket = this.grid.get(gridKey(cellX, cellY));
        if (!bucket) continue;
        for (const entity of bucket) appendStaticCandidate(candidates, seen, entity);
      }
    }
    candidates.sort((left, right) => (this.order.get(left.id) ?? 0) - (this.order.get(right.id) ?? 0));
    return candidates;
  }

  private insert(entity: Entity, index: number): void {
    this.order.set(entity.id, index);
    const bounds = this.boundsCache.forEntity(entity);
    const range = gridRangeForBounds(bounds, this.cellSize);
    const cellCount = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
    if (cellCount > maxStaticGridCells) {
      this.broad.push(entity);
      return;
    }
    for (let cellY = range.minY; cellY <= range.maxY; cellY += 1) {
      for (let cellX = range.minX; cellX <= range.maxX; cellX += 1) {
        const key = gridKey(cellX, cellY);
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(entity);
        else this.grid.set(key, [entity]);
      }
    }
  }
}

export class CollisionPairCollector {
  private readonly boundsCache = new CollisionBoundsCache();
  private readonly seenStaticIds = new Set<string>();

  collectDynamicPairs(entities: Entity[]): CollisionHit[] {
    const hits: CollisionHit[] = [];
    const dynamicEntities: Entity[] = [];
    const staticEntities: Entity[] = [];

    for (const entity of entities) {
      if (!entity.collider?.solid) continue;
      if (entity.body?.mode === "dynamic") dynamicEntities.push(entity);
      else staticEntities.push(entity);
    }

    const staticBroadPhase = new StaticCollisionBroadPhase(staticEntities, this.boundsCache);

    for (let index = 0; index < dynamicEntities.length; index += 1) {
      const dynamic = dynamicEntities[index];
      for (let otherIndex = index + 1; otherIndex < dynamicEntities.length; otherIndex += 1) {
        this.collectHit(dynamic, dynamicEntities[otherIndex], hits);
      }
      for (const other of staticBroadPhase.candidatesFor(this.boundsCache.forEntity(dynamic), this.seenStaticIds)) {
        this.collectHit(dynamic, other, hits);
      }
    }

    return hits;
  }

  private collectHit(a: Entity, b: Entity, hits: CollisionHit[]): void {
    if (!canCollide(a, b)) return;
    if (!overlaps(this.boundsCache.forEntity(a), this.boundsCache.forEntity(b))) return;
    const hit = collideAabb(a, b);
    if (hit) hits.push(hit);
  }
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
  return new CollisionPairCollector().collectDynamicPairs(entities);
}

function appendStaticCandidate(candidates: Entity[], seen: Set<string>, entity: Entity): void {
  if (seen.has(entity.id)) return;
  seen.add(entity.id);
  candidates.push(entity);
}

function gridRangeForBounds(bounds: Rect, cellSize: number): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.floor(bounds.x / cellSize),
    maxX: maxCellIndex(bounds.x, bounds.w, cellSize),
    minY: Math.floor(bounds.y / cellSize),
    maxY: maxCellIndex(bounds.y, bounds.h, cellSize),
  };
}

function maxCellIndex(start: number, size: number, cellSize: number): number {
  return Math.floor((start + Math.max(size, 0.001) - 0.001) / cellSize);
}

function gridKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function canCollide(a: Entity, b: Entity): boolean {
  if (!a.collider || !b.collider) return false;
  const includesTrigger = a.collider.trigger || b.collider.trigger;
  const includesSolid = a.collider.solid && b.collider.solid;
  if (!includesTrigger && !includesSolid) return false;
  return sharesLayer(a.collider, b.collider.layerMask) && sharesLayer(b.collider, a.collider.layerMask);
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

function sharesLayer(collider: ColliderComponent, layerMask: string[]): boolean {
  if (collider.layerMask.length === 0 || layerMask.length === 0) return true;
  return collider.layerMask.some((layer) => layerMask.includes(layer));
}
