import type { Entity, ProjectPatch, Scene } from "../project/schema";
import { cloneJson, err, ok, type EntityId, type Result } from "../shared/types";

export type EntityPropertyTransactionPlan = {
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  diffSummary: string;
  dirtyReason: string;
  noticeText: string;
};

const combatLevelParamLabels: Record<string, string> = {
  attackControlLevel: "普通攻击控制",
  attackArmorLevel: "普通攻击霸体",
  chargedAttackControlLevel: "蓄力攻击控制",
  chargedAttackArmorLevel: "蓄力攻击霸体",
  parryControlLevel: "振刀控制",
  parryArmorLevel: "振刀霸体",
  superParryAttackControlLevel: "振刀处决控制",
  superParryAttackArmorLevel: "振刀处决霸体",
};

export function planEntityPersistentTransaction(
  scene: Scene,
  entity: Entity,
  value: boolean,
): Result<EntityPropertyTransactionPlan> {
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`entity not found: ${entity.id}`);
  if (storedEntity.persistent === value) return err("entity persistent state is unchanged");
  const path = `/scenes/${scene.id}/entities/${storedEntity.id}/persistent` as ProjectPatch["path"];
  return ok({
    patches: [{ op: "set", path, value }],
    inversePatches: [{ op: "set", path, value: storedEntity.persistent }],
    diffSummary: `${value ? "设为" : "取消"}持久对象：${storedEntity.displayName}`,
    dirtyReason: `已更新 ${storedEntity.displayName} 持久状态`,
    noticeText: `${storedEntity.displayName}${value ? "已设为持久对象" : "已取消持久对象"}`,
  });
}

export function planEntityBodyModeTransaction(
  scene: Scene,
  entity: Entity,
  mode: string,
): Result<EntityPropertyTransactionPlan> {
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`entity not found: ${entity.id}`);
  if (!storedEntity.body) return err("entity has no body component");
  if (!["static", "dynamic", "kinematic"].includes(mode)) return err(`invalid body mode: ${mode}`);
  if (storedEntity.body.mode === mode) return err("entity body mode is unchanged");
  const path = `/scenes/${scene.id}/entities/${storedEntity.id}/body/mode` as ProjectPatch["path"];
  return ok({
    patches: [{ op: "set", path, value: mode }],
    inversePatches: [{ op: "set", path, value: storedEntity.body.mode }],
    diffSummary: `调整物理模式：${storedEntity.displayName} -> ${mode}`,
    dirtyReason: `已更新 ${storedEntity.displayName} 物理模式`,
    noticeText: `${storedEntity.displayName} 物理模式已改为 ${mode}`,
  });
}

export function planEntityColliderSolidTransaction(
  scene: Scene,
  entity: Entity,
  value: boolean,
): Result<EntityPropertyTransactionPlan> {
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`entity not found: ${entity.id}`);
  if (!storedEntity.collider) return err("entity has no collider component");
  if (!value && !storedEntity.collider.trigger) return err("collider must stay solid unless trigger is enabled");
  if (storedEntity.collider.solid === value) return err("entity collider solid state is unchanged");
  const path = `/scenes/${scene.id}/entities/${storedEntity.id}/collider/solid` as ProjectPatch["path"];
  return ok({
    patches: [{ op: "set", path, value }],
    inversePatches: [{ op: "set", path, value: storedEntity.collider.solid }],
    diffSummary: `${value ? "启用" : "禁用"}实体碰撞：${storedEntity.displayName}`,
    dirtyReason: `已更新 ${storedEntity.displayName} 碰撞属性`,
    noticeText: `${storedEntity.displayName}${value ? "已启用实体碰撞" : "已禁用实体碰撞"}`,
  });
}

export function planEntityColliderTriggerTransaction(
  scene: Scene,
  entity: Entity,
  value: boolean,
): Result<EntityPropertyTransactionPlan> {
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`entity not found: ${entity.id}`);
  if (!storedEntity.collider) return err("entity has no collider component");
  if (!value && !storedEntity.collider.solid) return err("collider must stay trigger unless solid is enabled");
  if (storedEntity.collider.trigger === value) return err("entity collider trigger state is unchanged");
  const path = `/scenes/${scene.id}/entities/${storedEntity.id}/collider/trigger` as ProjectPatch["path"];
  return ok({
    patches: [{ op: "set", path, value }],
    inversePatches: [{ op: "set", path, value: storedEntity.collider.trigger }],
    diffSummary: `${value ? "设为" : "取消"}触发器：${storedEntity.displayName}`,
    dirtyReason: `已更新 ${storedEntity.displayName} 触发器属性`,
    noticeText: `${storedEntity.displayName}${value ? "已设为触发器" : "已取消触发器"}`,
  });
}

export function planEntityRenderVisibleTransaction(
  scene: Scene,
  entity: Entity,
  value: boolean,
): Result<EntityPropertyTransactionPlan> {
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`entity not found: ${entity.id}`);
  if (!storedEntity.render) return err("entity has no render component");
  if (storedEntity.render.visible === value) return err("entity render visibility is unchanged");
  const path = `/scenes/${scene.id}/entities/${storedEntity.id}/render/visible` as ProjectPatch["path"];
  return ok({
    patches: [{ op: "set", path, value }],
    inversePatches: [{ op: "set", path, value: storedEntity.render.visible }],
    diffSummary: `${value ? "显示" : "隐藏"}可视体：${storedEntity.displayName}`,
    dirtyReason: `已更新 ${storedEntity.displayName} 可视体可见性`,
    noticeText: `${storedEntity.displayName} 可视体已${value ? "显示" : "隐藏"}`,
  });
}

export function planCombatLevelParamTransaction(
  scene: Scene,
  entityId: EntityId,
  key: string,
  rawValue: string,
): Result<EntityPropertyTransactionPlan> {
  if (!isCombatLevelParamKey(key)) return err("invalid combat level field");
  const nextValue = Math.max(0, Math.floor(Number(rawValue)));
  if (!Number.isFinite(nextValue)) return err("invalid combat level value");
  const storedEntity = scene.entities[entityId];
  const params = storedEntity?.behavior?.params;
  if (!storedEntity || !params) return err(`entity combat params not found: ${entityId}`);
  const previousValue = params[key];
  if (typeof previousValue === "number" && previousValue === nextValue) return err("combat level is unchanged");

  const patches: ProjectPatch[] = [];
  const inversePatches: ProjectPatch[] = [];
  appendBehaviorParamPatch(patches, inversePatches, scene.id, storedEntity.id, key, nextValue, previousValue, hasOwnParam(params, key));
  return ok({
    patches,
    inversePatches,
    diffSummary: `调整 ${storedEntity.displayName} 的战斗等级 ${key}=${nextValue}`,
    dirtyReason: `已调整 ${storedEntity.displayName} 战斗等级`,
    noticeText: `${storedEntity.displayName} 的 ${combatLevelParamLabel(key)} 已改为 ${nextValue}`,
  });
}

export function appendBehaviorParamPatch(
  patches: ProjectPatch[],
  inversePatches: ProjectPatch[],
  sceneId: string,
  entityId: EntityId,
  key: string,
  nextValue: number,
  previousValue: unknown,
  hadPreviousValue: boolean,
): void {
  const path = `/scenes/${sceneId}/entities/${entityId}/behavior/params/${key}` as ProjectPatch["path"];
  patches.push({ op: "set", path, value: nextValue });
  inversePatches.push(hadPreviousValue ? { op: "set", path, value: cloneJson(previousValue) } : { op: "delete", path });
}

export function hasOwnParam(params: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(params, key);
}

export function isCombatLevelParamKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(combatLevelParamLabels, key);
}

export function combatLevelParamLabel(key: string): string {
  return combatLevelParamLabels[key] || key;
}
