import type { Entity } from "../project/schema";
import type { Transform2D, Vec2 } from "../shared/types";
import type { TransformHandle } from "./renderer";

export type CanvasDragState =
  | { kind: "move"; pointerId: number; entityId: string; originalTransform: Transform2D; offset: Vec2 }
  | { kind: "scale"; pointerId: number; entityId: string; originalTransform: Transform2D; startScale: Vec2 }
  | { kind: "rotate"; pointerId: number; entityId: string; originalTransform: Transform2D; startAngle: number; startRotation: number };

export function createCanvasDragState(pointerId: number, entity: Entity, handle: TransformHandle, point: Vec2): CanvasDragState {
  if (handle === "core") {
    return {
      kind: "move",
      pointerId,
      entityId: entity.id,
      originalTransform: cloneTransform(entity.transform),
      offset: {
        x: point.x - entity.transform.position.x,
        y: point.y - entity.transform.position.y,
      },
    };
  }
  if (handle === "rotate") {
    return {
      kind: "rotate",
      pointerId,
      entityId: entity.id,
      originalTransform: cloneTransform(entity.transform),
      startAngle: Math.atan2(point.y - entity.transform.position.y, point.x - entity.transform.position.x),
      startRotation: entity.transform.rotation || 0,
    };
  }
  return {
    kind: "scale",
    pointerId,
    entityId: entity.id,
    originalTransform: cloneTransform(entity.transform),
    startScale: { ...entity.transform.scale },
  };
}

export function applyCanvasDragState(entity: Entity, drag: CanvasDragState, point: Vec2): void {
  if (drag.kind === "move") {
    entity.transform.position = {
      x: point.x - drag.offset.x,
      y: point.y - drag.offset.y,
    };
    return;
  }
  if (drag.kind === "rotate") {
    const angle = Math.atan2(point.y - entity.transform.position.y, point.x - entity.transform.position.x);
    entity.transform.rotation = drag.startRotation + angle - drag.startAngle;
    return;
  }
  const local = toLocalPoint(point, entity.transform.position, entity.collider ? 0 : entity.transform.rotation || 0);
  const size = entity.collider?.size || { x: 60, y: 60 };
  entity.transform.scale = {
    x: clamp((Math.max(4, Math.abs(local.x) - 5) * 2) / Math.max(size.x, 1), 0.15, 8),
    y: clamp((Math.max(4, Math.abs(local.y) - 5) * 2) / Math.max(size.y, 1), 0.15, 8),
  };
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
