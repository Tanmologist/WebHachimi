import type { Entity } from "./schema";

export function entityHasVisiblePresentation(entity: Entity): boolean {
  return Boolean(entity.render && entity.render.visible !== false);
}

export function isAttackTouchEntity(entity: Entity): boolean {
  return entity.tags.includes("attack") && entity.tags.includes("touch");
}

export function isAttackMovementTargetEntity(entity: Entity): boolean {
  return entity.tags.includes("attack") && entity.tags.includes("movement-target");
}

export function isGameplayDebugEntity(entity: Entity): boolean {
  const layerMask = entity.collider?.layerMask || [];
  return (
    isAttackTouchEntity(entity) ||
    isAttackMovementTargetEntity(entity) ||
    layerMask.includes("combat-touch") ||
    layerMask.includes("combat-movement") ||
    (entity.tags.includes("debug") && entity.tags.includes("collision"))
  );
}
