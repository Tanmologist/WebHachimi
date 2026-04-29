import type { Entity } from "../project/schema";
import type { EntityId } from "../shared/types";
import { applyCanvasDragState, createCanvasDragState, snapRotation } from "../v2/canvasTransform";

run("body east handle scales body from one side without resizing presentation", () => {
  const entity = createEntity();
  entity.transform.rotation = 0;
  const drag = createCanvasDragState(1, entity, "body", "scale-e", { x: 150, y: 100 });
  applyCanvasDragState(entity, drag, { x: 180, y: 100 });

  assert(entity.transform.position.x === 115, `expected center x 115, got ${entity.transform.position.x}`);
  assert(entity.transform.position.y === 100, `expected center y unchanged, got ${entity.transform.position.y}`);
  assert(entity.transform.scale.x === 1, `expected body scale.x unchanged, got ${entity.transform.scale.x}`);
  assert(entity.collider?.size.x === 130, `expected body width 130, got ${entity.collider?.size.x}`);
  assert(entity.render?.size?.x === 100, `expected presentation width unchanged, got ${entity.render?.size?.x}`);
  assert(leftEdge(entity) === 50, `expected left edge anchored at 50, got ${leftEdge(entity)}`);
});

run("presentation rotation edits presentation without changing body rotation", () => {
  const entity = createEntity();
  const drag = createCanvasDragState(2, entity, "presentation", "rotate", { x: 100, y: 70 });
  applyCanvasDragState(entity, drag, { x: 130, y: 100 });

  assert(entity.transform.rotation === 0.25, `expected body rotation unchanged, got ${entity.transform.rotation}`);
  assert((entity.collider?.rotation || 0) === 0, `expected collider local rotation unchanged, got ${entity.collider?.rotation}`);
  assert(Math.abs((entity.render?.rotation || 0) - Math.PI / 2) < 0.000001, `expected presentation rotation 90deg, got ${entity.render?.rotation}`);
});

run("rotation snaps near 15 degree marks", () => {
  const nearRightAngle = Math.PI / 2 + Math.PI / 90;
  const betweenMarks = Math.PI / 2 + Math.PI / 24;

  assert(snapRotation(nearRightAngle) === Math.PI / 2, `expected near-right-angle snap, got ${snapRotation(nearRightAngle)}`);
  assert(snapRotation(betweenMarks) === betweenMarks, `expected between-marks rotation to stay free, got ${snapRotation(betweenMarks)}`);
});

run("presentation scale edits presentation size and offset without changing body size", () => {
  const entity = createEntity();
  entity.transform.rotation = 0;
  const drag = createCanvasDragState(3, entity, "presentation", "scale-e", { x: 150, y: 100 });
  applyCanvasDragState(entity, drag, { x: 170, y: 100 });

  assert(entity.transform.position.x === 100, `expected entity position unchanged, got ${entity.transform.position.x}`);
  assert(entity.collider?.size.x === 100, `expected body width unchanged, got ${entity.collider?.size.x}`);
  assert(entity.render?.size?.x === 120, `expected presentation width 120, got ${entity.render?.size?.x}`);
  assert(entity.render?.size?.y === 60, `expected presentation height unchanged, got ${entity.render?.size?.y}`);
  assert(entity.render?.offset?.x === 10, `expected presentation offset x 10, got ${entity.render?.offset?.x}`);
});

run("body move uses collider offset as the body center", () => {
  const entity = createEntity();
  entity.collider!.offset = { x: 10, y: 5 };
  const drag = createCanvasDragState(4, entity, "body", "core", { x: 110, y: 105 });
  applyCanvasDragState(entity, drag, { x: 150, y: 145 });

  assert(entity.transform.position.x === 140, `expected transform x 140, got ${entity.transform.position.x}`);
  assert(entity.transform.position.y === 140, `expected transform y 140, got ${entity.transform.position.y}`);
});

run("body rotation preserves collider local rotation", () => {
  const entity = createEntity();
  entity.transform.rotation = 0.25;
  entity.collider!.rotation = 0.25;
  const drag = createCanvasDragState(5, entity, "body", "rotate", { x: 100, y: 70 });
  applyCanvasDragState(entity, drag, { x: 130, y: 100 });

  const expectedTransformRotation = snapRotation(0.5 + Math.PI / 2) - 0.25;
  assert(Math.abs(entity.transform.rotation - expectedTransformRotation) < 0.000001, `expected body transform rotation adjusted around collider local rotation, got ${entity.transform.rotation}`);
  assert(entity.collider?.rotation === 0.25, `expected collider local rotation unchanged, got ${entity.collider?.rotation}`);
});

run("presentation scale accounts for parent scale", () => {
  const entity = createEntity();
  entity.transform.rotation = 0;
  entity.transform.scale = { x: 2, y: 1 };
  const drag = createCanvasDragState(6, entity, "presentation", "scale-e", { x: 200, y: 100 });
  applyCanvasDragState(entity, drag, { x: 240, y: 100 });

  assert(entity.render?.size?.x === 120, `expected presentation stored width 120, got ${entity.render?.size?.x}`);
  assert(entity.render?.offset?.x === 20, `expected presentation offset x 20, got ${entity.render?.offset?.x}`);
});

console.log(JSON.stringify({ status: "passed" }, null, 2));

function createEntity(): Entity {
  return {
    id: "entity-test" as EntityId,
    internalName: "test",
    displayName: "Test",
    kind: "entity",
    persistent: true,
    transform: {
      position: { x: 100, y: 100 },
      rotation: 0.25,
      scale: { x: 1, y: 1 },
    },
    render: {
      visible: true,
      color: "#74a8bd",
      opacity: 1,
      layerId: "world",
      size: { x: 100, y: 60 },
      offset: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      slot: "current",
      state: "current",
    },
    collider: {
      shape: "box",
      size: { x: 100, y: 60 },
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

function leftEdge(entity: Entity): number {
  return entity.transform.position.x - ((entity.collider?.size.x || 0) * Math.abs(entity.transform.scale.x)) / 2;
}

function run(name: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
