import type { ColliderComponent, Entity, RenderComponent } from "../project/schema";
import type { Transform2D, Vec2 } from "../shared/types";
import type { CanvasTargetPart, TransformHandle } from "./renderer";

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

const rotationSnapStep = Math.PI / 12;
const rotationSnapTolerance = Math.PI / 30;

export function snapRotation(rotation: number): number {
  const snapped = Math.round(rotation / rotationSnapStep) * rotationSnapStep;
  return Math.abs(snapped - rotation) <= rotationSnapTolerance ? snapped : rotation;
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

export function applyCanvasDragState(entity: Entity, drag: CanvasDragState, point: Vec2): void {
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
    const bodyOffset = entity.collider?.offset || { x: 0, y: 0 };
    entity.transform.position = {
      x: center.x - bodyOffset.x,
      y: center.y - bodyOffset.y,
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

function toLocalPoint(point: Vec2, center: Vec2, rotation: number): Vec2 {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

function applyOneSidedScale(entity: Entity, drag: Extract<CanvasDragState, { kind: "scale" }>, point: Vec2): void {
  const local = toLocalPoint(point, drag.geometry.center, drag.geometry.rotation);
  const sides = scaleSides(drag.handle);
  let left = -drag.geometry.width / 2;
  let right = drag.geometry.width / 2;
  let top = -drag.geometry.height / 2;
  let bottom = drag.geometry.height / 2;

  if (sides.x === "left") left = Math.min(right - 4, local.x);
  if (sides.x === "right") right = Math.max(left + 4, local.x);
  if (sides.y === "top") top = Math.min(bottom - 4, local.y);
  if (sides.y === "bottom") bottom = Math.max(top + 4, local.y);

  const width = clamp(right - left, 4, 4096);
  const height = clamp(bottom - top, 4, 4096);
  const center = fromLocalPoint(drag.geometry.center, { x: (left + right) / 2, y: (top + bottom) / 2 }, drag.geometry.rotation);

  if (drag.part === "presentation") {
    entity.render ||= createDefaultRender(entity.collider?.size);
    const scale = drag.geometry.scale;
    entity.render.size = {
      x: clamp(width / Math.max(Math.abs(scale.x), 0.001), 4, 4096),
      y: clamp(height / Math.max(Math.abs(scale.y), 0.001), 4, 4096),
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
    x: clamp(width / Math.max(Math.abs(scale.x), 0.001), 4, 4096),
    y: clamp(height / Math.max(Math.abs(scale.y), 0.001), 4, 4096),
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
    width: size.x * Math.max(Math.abs(scale.x), 0.001),
    height: size.y * Math.max(Math.abs(scale.y), 0.001),
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

function fromLocalPoint(center: Vec2, local: Vec2, rotation: number): Vec2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + local.x * cos - local.y * sin,
    y: center.y + local.x * sin + local.y * cos,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
