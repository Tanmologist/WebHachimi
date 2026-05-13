import type { Entity } from "./schema";

export function entityUsesAnchorLink(entity: Entity): boolean {
  return Boolean(entity.parentId && !isDetachedProjectileEntity(entity));
}

export function entityFollowsParentTransform(entity: Entity): boolean {
  return entityUsesAnchorLink(entity);
}

export function isDetachedProjectileEntity(entity: Entity): boolean {
  if (entity.behavior?.builtin === "projectile") return true;
  const tokens = [
    entity.internalName,
    entity.displayName,
    ...entity.tags,
  ].map((value) => value.toLowerCase());
  return tokens.some((token) =>
    token.includes("projectile") ||
    token.includes("bullet") ||
    token.includes("ammo") ||
    token.includes("子弹") ||
    token.includes("投射") ||
    token.includes("飞弹"),
  );
}
