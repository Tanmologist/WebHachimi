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
  const size = entity.collider?.size || { x: 0, y: 0 };
  const scale = entity.transform.scale || { x: 1, y: 1 };
  const w = size.x * Math.max(Math.abs(scale.x), 0.001);
  const h = size.y * Math.max(Math.abs(scale.y), 0.001);
  return {
    x: entity.transform.position.x - w / 2,
    y: entity.transform.position.y - h / 2,
    w,
    h,
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
    return overlaps(boundsFor(entity), query.rect);
  });
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

function canCollide(a: Entity, b: Entity): boolean {
  if (!a.collider || !b.collider) return false;
  const includesTrigger = a.collider.trigger || b.collider.trigger;
  const includesSolid = a.collider.solid && b.collider.solid;
  if (!includesTrigger && !includesSolid) return false;
  return sharesLayer(a.collider, b.collider.layerMask) && sharesLayer(b.collider, a.collider.layerMask);
}

function collideAabb(a: Entity, b: Entity): CollisionHit | null {
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

function sharesLayer(collider: ColliderComponent, layerMask: string[]): boolean {
  if (collider.layerMask.length === 0 || layerMask.length === 0) return true;
  return collider.layerMask.some((layer) => layerMask.includes(layer));
}
