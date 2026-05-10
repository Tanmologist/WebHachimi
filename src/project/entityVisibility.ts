import type { Entity } from "./schema";

export function entityHasVisiblePresentation(entity: Entity): boolean {
  return Boolean(entity.render && entity.render.visible !== false);
}

export function isAttackTouchEntity(entity: Entity): boolean {
  return entity.tags.includes("attack") && entity.tags.includes("touch");
}

export function isGameplayDebugEntity(entity: Entity): boolean {
  const layerMask = entity.collider?.layerMask || [];
  return isAttackTouchEntity(entity) || layerMask.includes("combat-touch") || (entity.tags.includes("debug") && entity.tags.includes("collision"));
}
