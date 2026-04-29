import type { Entity } from "../project/schema";
import { boundsFor, collectPairs, entityIntersectsRect, overlaps, queryEntities } from "../runtime/collision";
import type { EntityId } from "../shared/types";

const rotated = makeBody("rotated" as EntityId, 0, 0, 100, 20, Math.PI / 4);
const corner = makeBody("corner" as EntityId, 50, 50, 20, 20, 0);
const direct = makeBody("direct" as EntityId, 20, 20, 20, 20, 0);
const triangle = makePolygon("triangle" as EntityId, 0, 0, [
  { x: -40, y: 30 },
  { x: 0, y: -30 },
  { x: 40, y: 30 },
]);
const triangleCornerAabbOnly = makeBody("triangle-corner" as EntityId, -34, -25, 10, 10, 0);
const triangleCenter = makeBody("triangle-center" as EntityId, 0, 8, 10, 10, 0);

assert(overlaps(boundsFor(rotated), boundsFor(corner)), "rotated body AABB should overlap the corner probe");
assert(collectPairs([rotated, corner]).length === 0, "oriented collision should reject empty AABB corner space");
assert(collectPairs([rotated, direct]).length === 1, "oriented collision should keep true body overlaps");
assert(!entityIntersectsRect(rotated, boundsFor(corner)), "rect query should reject empty rotated-body corner space");
assert(queryEntities([rotated], { rect: boundsFor(corner) }).length === 0, "queryEntities should use oriented body geometry");
assert(entityIntersectsRect(rotated, boundsFor(direct)), "rect query should keep real rotated-body intersections");
assert(overlaps(boundsFor(triangle), boundsFor(triangleCornerAabbOnly)), "triangle AABB should overlap the corner probe");
assert(collectPairs([triangle, triangleCornerAabbOnly]).length === 0, "polygon collision should reject empty AABB corner space");
assert(collectPairs([triangle, triangleCenter]).length === 1, "polygon collision should keep true polygon overlaps");
assert(!entityIntersectsRect(triangle, boundsFor(triangleCornerAabbOnly)), "rect query should use polygon geometry, not only polygon AABB");
assert(entityIntersectsRect(triangle, boundsFor(triangleCenter)), "rect query should hit the actual triangle body");

console.log(JSON.stringify({ status: "passed" }, null, 2));

function makeBody(id: EntityId, x: number, y: number, w: number, h: number, rotation: number): Entity {
  return {
    id,
    internalName: String(id),
    displayName: String(id),
    kind: "entity",
    persistent: true,
    transform: {
      position: { x, y },
      rotation,
      scale: { x: 1, y: 1 },
    },
    body: {
      mode: "static",
      velocity: { x: 0, y: 0 },
      gravityScale: 0,
      friction: 0.8,
      bounce: 0,
    },
    collider: {
      shape: "box",
      size: { x: w, y: h },
      offset: { x: 0, y: 0 },
      rotation: 0,
      solid: true,
      trigger: false,
      layerMask: ["world"],
    },
    resources: [],
    tags: [],
  };
}

function makePolygon(id: EntityId, x: number, y: number, points: Array<{ x: number; y: number }>): Entity {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    ...makeBody(id, x, y, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0),
    collider: {
      shape: "polygon",
      size: { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) },
      points,
      offset: { x: 0, y: 0 },
      rotation: 0,
      solid: true,
      trigger: false,
      layerMask: ["world"],
    },
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
