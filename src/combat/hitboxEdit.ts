import type { Entity } from "../project/schema";
import type { Vec2 } from "../shared/types";
import type { CombatAttackKind } from "./types";

export type AttackTouchOffsetEdit = {
  kind: CombatAttackKind;
  offsetXKey: string;
  offsetYKey: string;
  previousX: number;
  previousY: number;
  nextX: number;
  nextY: number;
};

export type AttackMovementOffsetEdit = {
  kind: CombatAttackKind;
  offsetXKey: string;
  offsetYKey: string;
  previousX: number;
  previousY: number;
  nextX: number;
  nextY: number;
};

export function attackTouchKindForEntities(touch: Entity, owner: Entity): CombatAttackKind {
  return combatAttackKindFromValue(touch.runtime?.attackKind) || combatAttackKindFromValue(owner.runtime?.attackKind) || "normal";
}

export function attackTouchOffsetKeysForKind(kind: CombatAttackKind): { x: string; y: string } {
  if (kind === "charged") return { x: "chargedAttackTouchOffsetX", y: "chargedAttackTouchOffsetY" };
  if (kind === "superParry") return { x: "superParryAttackTouchOffsetX", y: "superParryAttackTouchOffsetY" };
  return { x: "attackTouchOffsetX", y: "attackTouchOffsetY" };
}

export function attackMovementOffsetKeysForKind(kind: CombatAttackKind): { x: string; y: string } {
  if (kind === "charged") return { x: "chargedAttackMoveOffsetX", y: "chargedAttackMoveOffsetY" };
  if (kind === "superParry") return { x: "superParryAttackMoveOffsetX", y: "superParryAttackMoveOffsetY" };
  return { x: "attackMoveOffsetX", y: "attackMoveOffsetY" };
}

export function planMovedAttackTouchOffsets(
  params: Record<string, number | string | boolean>,
  kind: CombatAttackKind,
  facingDirection: -1 | 1,
  delta: Vec2,
): AttackTouchOffsetEdit {
  const keys = attackTouchOffsetKeysForKind(kind);
  const fallbackX = kind === "normal" ? 0 : numberParamValue(params.attackTouchOffsetX) ?? 0;
  const fallbackY = kind === "normal" ? 0 : numberParamValue(params.attackTouchOffsetY) ?? 0;
  const previousX = numberParamValue(params[keys.x]) ?? fallbackX;
  const previousY = numberParamValue(params[keys.y]) ?? fallbackY;
  return {
    kind,
    offsetXKey: keys.x,
    offsetYKey: keys.y,
    previousX,
    previousY,
    nextX: roundCombatParam(previousX + delta.x * facingDirection),
    nextY: roundCombatParam(previousY + delta.y),
  };
}

export function planMovedAttackMovementOffsets(
  params: Record<string, number | string | boolean>,
  kind: CombatAttackKind,
  facingDirection: -1 | 1,
  delta: Vec2,
): AttackMovementOffsetEdit {
  const keys = attackMovementOffsetKeysForKind(kind);
  const fallbackX = kind === "normal" ? 36 : 0;
  const fallbackY = 0;
  const previousX = numberParamValue(params[keys.x]) ?? fallbackX;
  const previousY = numberParamValue(params[keys.y]) ?? fallbackY;
  return {
    kind,
    offsetXKey: keys.x,
    offsetYKey: keys.y,
    previousX,
    previousY,
    nextX: roundCombatParam(previousX + delta.x * facingDirection),
    nextY: roundCombatParam(previousY + delta.y),
  };
}

export function combatAttackKindFromValue(value: unknown): CombatAttackKind | undefined {
  return value === "normal" || value === "charged" || value === "superParry" ? value : undefined;
}

export function numberParamValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function roundCombatParam(value: number): number {
  return Math.round(value * 100) / 100;
}
