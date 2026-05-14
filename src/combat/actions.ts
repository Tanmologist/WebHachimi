import type { Entity } from "../project/schema";
import type { Rect } from "../shared/types";
import { boundsFor } from "../runtime/collision";
import type {
  CombatActionDef,
  CombatActionId,
  CombatActionRuntime,
  CombatAttackKind,
  CombatAttackStats,
  CombatPhaseDef,
  CombatPhaseId,
  CombatRuntimePhase,
  CombatRuntimeWindow,
  CombatWindowDef,
  CombatWindowShape,
  CombatWindowType,
} from "./types";
import { combatAttackKindFromValue } from "./hitboxEdit";

type CombatActionBuildOptions = {
  chargeStage?: number;
};

const LEGACY_COMBAT_FRAME_MS = 10;

export function combatActionIdForAttackKind(kind: CombatAttackKind): CombatActionId {
  if (kind === "charged") return "chargeAttack";
  if (kind === "superParry") return "superParryExecution";
  return "normalAttack";
}

export function combatAttackKindForActionId(actionId: CombatActionId): CombatAttackKind | undefined {
  if (actionId === "chargeAttack") return "charged";
  if (actionId === "superParryExecution") return "superParry";
  if (actionId === "normalAttack") return "normal";
  return undefined;
}

export function combatActionDefForEntity(
  entity: Entity,
  actionId: CombatActionId,
  options: CombatActionBuildOptions = {},
): CombatActionDef {
  if (actionId === "chargeAttack") return attackActionDef(entity, "charged", options);
  if (actionId === "superParryExecution") return attackActionDef(entity, "superParry", options);
  if (actionId === "parry") return parryActionDef(entity);
  if (actionId === "dodge") return dodgeActionDef(entity);
  return attackActionDef(entity, "normal", options);
}

export function combatAttackStatsForEntity(
  entity: Entity,
  kind: CombatAttackKind,
  chargeStageInput?: number,
): CombatAttackStats {
  const action = combatActionDefForEntity(entity, combatActionIdForAttackKind(kind), { chargeStage: chargeStageInput });
  return {
    kind,
    action,
    startupMs: combatPhaseDurationMs(action, "startup"),
    activeMs: combatPhaseDurationMs(action, "active"),
    recoveryMs: combatPhaseDurationMs(action, "recovery"),
    damage: actionNumber(action, "damage", 1),
    hitStunMs: actionNumber(action, "hitStunMs", 0),
    controlLevel: actionNumber(action, "controlLevel", 1),
    armorLevel: actionNumber(action, "armorLevel", 0),
    moveOffsetX: actionNumber(action, "moveOffsetX", 0),
    moveOffsetY: actionNumber(action, "moveOffsetY", 0),
    moveDurationMs: actionNumber(action, "moveDurationMs", 0),
    chargeStage: typeof action.data?.chargeStage === "number" ? action.data.chargeStage : undefined,
  };
}

export function buildCombatActionRuntime(action: CombatActionDef, startedMs: number): CombatActionRuntime {
  const phases: CombatRuntimePhase[] = [];
  let cursor = startedMs;
  for (const phase of action.phases) {
    const durationMs = Math.max(0, phase.durationMs);
    if (durationMs <= 0) continue;
    phases.push({
      id: phase.id,
      label: phase.label,
      startsAtMs: cursor,
      untilMs: cursor + durationMs,
    });
    cursor += durationMs;
  }
  const firstMs = phases[0]?.startsAtMs ?? startedMs;
  const lastMs = phases[phases.length - 1]?.untilMs ?? startedMs;
  const windows: CombatRuntimeWindow[] = [];
  for (const window of action.windows) {
    const phase = window.phase === "all" ? undefined : phases.find((item) => item.id === window.phase);
    if (window.phase !== "all" && !phase) continue;
    windows.push({
      id: window.id,
      type: window.type,
      label: window.label,
      startsAtMs: phase?.startsAtMs ?? firstMs,
      untilMs: phase?.untilMs ?? lastMs,
      level: window.level,
      controlLevel: window.controlLevel,
      armorLevel: window.armorLevel,
      shape: window.shape,
    });
  }
  return {
    actionId: action.id,
    label: action.label,
    startedMs,
    phases,
    windows,
  };
}

export function combatPhaseDurationMs(action: CombatActionDef, phaseId: CombatPhaseId): number {
  return action.phases.find((phase) => phase.id === phaseId)?.durationMs ?? 0;
}

export function combatActionTotalDurationMs(action: CombatActionDef): number {
  return action.phases.reduce((total, phase) => total + Math.max(0, phase.durationMs), 0);
}

export function combatPhaseFrames(action: CombatActionDef, phaseId: CombatPhaseId): number {
  return Math.round(combatPhaseDurationMs(action, phaseId) / LEGACY_COMBAT_FRAME_MS);
}

export function combatActionTotalFrames(action: CombatActionDef): number {
  return Math.round(combatActionTotalDurationMs(action) / LEGACY_COMBAT_FRAME_MS);
}

export function combatAttackRectForEntity(entity: Entity): Rect {
  const runtimeHitbox = entity.runtime?.combatAction?.windows.find(
    (window) => window.type === "hitbox" && window.shape?.type === "forwardBox",
  )?.shape;
  const kind = combatAttackKindFromValue(entity.runtime?.attackKind) ?? "normal";
  const shape = runtimeHitbox || attackHitboxShape(entity, kind);
  return rectForForwardBox(entity, shape);
}

export function combatAttackShadowRectForEntity(entity: Entity): Rect {
  const runtimeShadow = entity.runtime?.combatAction?.windows.find(
    (window) => window.type === "attackShadow" && window.shape?.type === "forwardBox",
  )?.shape;
  const kind = combatAttackKindFromValue(entity.runtime?.attackKind) ?? "normal";
  const shape = runtimeShadow || attackHitboxShape(entity, kind);
  return rectForForwardBox(entity, shape);
}

export function combatWindowIsOpen(
  runtime: CombatActionRuntime | undefined,
  type: CombatWindowType,
  timeMs: number,
): CombatRuntimeWindow | undefined {
  return runtime?.windows.find((window) => window.type === type && timeMs >= window.startsAtMs && timeMs < window.untilMs);
}

function attackActionDef(entity: Entity, kind: CombatAttackKind, options: CombatActionBuildOptions): CombatActionDef {
  const stats = attackNumbers(entity, kind, options.chargeStage);
  const phases = attackPhases(stats.startupMs, stats.activeMs, stats.recoveryMs);
  const windows: CombatWindowDef[] = [
    {
      id: `${combatActionIdForAttackKind(kind)}-shadow`,
      type: "attackShadow",
      phase: "startup",
      label: "Attack shadow",
      controlLevel: stats.controlLevel,
      shape: attackHitboxShape(entity, kind),
    },
    {
      id: `${combatActionIdForAttackKind(kind)}-hitbox`,
      type: "hitbox",
      phase: "active",
      label: "命中盒",
      controlLevel: stats.controlLevel,
      shape: attackHitboxShape(entity, kind),
    },
    ...(stats.moveDurationMs > 0 && (Math.abs(stats.moveOffsetX) > 0.001 || Math.abs(stats.moveOffsetY) > 0.001)
      ? [
          {
            id: `${combatActionIdForAttackKind(kind)}-movement`,
            type: "movement" as const,
            phase: "startup" as const,
            label: "动作位移",
          },
        ]
      : []),
    {
      id: `${combatActionIdForAttackKind(kind)}-armor`,
      type: "armor",
      phase: "all",
      label: "霸体",
      armorLevel: stats.armorLevel,
      level: stats.armorLevel,
    },
    {
      id: `${combatActionIdForAttackKind(kind)}-movement-lock`,
      type: "movementLock",
      phase: "all",
      label: "动作锁定",
    },
  ];
  const data: Record<string, number | string | boolean> = {
    attackKind: kind,
    damage: stats.damage,
    hitStunMs: stats.hitStunMs,
    controlLevel: stats.controlLevel,
    armorLevel: stats.armorLevel,
    moveOffsetX: stats.moveOffsetX,
    moveOffsetY: stats.moveOffsetY,
    moveDurationMs: stats.moveDurationMs,
  };
  if (typeof stats.chargeStage === "number") data.chargeStage = stats.chargeStage;
  return {
    id: combatActionIdForAttackKind(kind),
    label: attackLabel(kind),
    input: "attack",
    phases,
    windows,
    data,
  };
}

function parryActionDef(entity: Entity): CombatActionDef {
  const active = durationParam(entity, ["parryWindowMs"], ["parryWindowFrames"], 200, 1);
  const recovery = durationParam(entity, ["parryRecoveryMs", "parryCooldownMs"], ["parryRecoveryFrames", "parryCooldownFrames"], 300, 0);
  const armorLevel = integerParam(entity, ["parryArmorLevel"], 3, 0);
  const controlLevel = integerParam(entity, ["parryControlLevel"], 3, 1);
  return {
    id: "parry",
    label: "振刀",
    input: "parry",
    phases: [
      phase("active", "有效", active),
      phase("recovery", "失败硬直", recovery),
    ],
    windows: [
      {
        id: "parry-window",
        type: "parry",
        phase: "active",
        label: "弹反窗口",
        controlLevel,
        level: controlLevel,
      },
      {
        id: "parry-armor",
        type: "armor",
        phase: "active",
        label: "振刀霸体",
        armorLevel,
        level: armorLevel,
      },
      {
        id: "parry-movement-lock",
        type: "movementLock",
        phase: "all",
        label: "动作锁定",
      },
    ],
    data: {
      windowMs: active,
      recoveryMs: recovery,
      controlLevel,
      armorLevel,
    },
  };
}

function dodgeActionDef(entity: Entity): CombatActionDef {
  const evade = durationParam(entity, ["dodgeInvulnerableMs", "dodgeActiveMs"], ["dodgeInvulnerableFrames", "dodgeActiveFrames"], 180, 1);
  const recovery = durationParam(entity, ["dodgeRecoveryMs", "dodgeCooldownMs"], ["dodgeRecoveryFrames", "dodgeCooldownFrames"], 120, 0);
  const distance = numberParam(entity, "dodgeDistance") ?? 86;
  const speed = numberParam(entity, "dodgeSpeed") ?? 650;
  return {
    id: "dodge",
    label: "闪避",
    input: "dodge",
    phases: [
      phase("evade", "无敌位移", evade),
      phase("recovery", "收招", recovery),
    ],
    windows: [
      {
        id: "dodge-invulnerable",
        type: "invulnerable",
        phase: "evade",
        label: "无敌帧",
      },
      {
        id: "dodge-movement",
        type: "movement",
        phase: "evade",
        label: "位移",
      },
      {
        id: "dodge-movement-lock",
        type: "movementLock",
        phase: "all",
        label: "动作锁定",
      },
    ],
    data: {
      evadeMs: evade,
      recoveryMs: recovery,
      distance,
      speed,
    },
  };
}

function attackNumbers(entity: Entity, kind: CombatAttackKind, chargeStageInput?: number): Omit<CombatAttackStats, "kind" | "action"> {
  if (kind === "charged") {
    const chargeStage = Math.max(1, Math.floor(chargeStageInput || entity.runtime?.chargeStage || 1));
    const baseDamage = Math.max(1, numberParam(entity, "chargedAttackDamage") ?? (numberParam(entity, "attackDamage") ?? 1) * 2);
    const growth = Math.max(1, numberParam(entity, "chargedAttackDamageGrowth") ?? 1.2);
    const storedDamage = entity.runtime?.chargeStoredDamage ?? 0;
    return {
      startupMs: durationParam(entity, ["chargedAttackStartupMs"], ["chargedAttackStartupFrames"], 100, 0),
      activeMs: durationParam(entity, ["chargedAttackActiveMs"], ["chargedAttackActiveFrames"], 500, 1),
      recoveryMs: durationParam(
        entity,
        ["chargedAttackRecoveryMs", "chargedAttackCooldownMs"],
        ["chargedAttackRecoveryFrames", "chargedAttackCooldownFrames"],
        300,
        0,
      ),
      damage: roundDamage(baseDamage * Math.pow(growth, chargeStage - 1) + storedDamage),
      hitStunMs: durationParam(entity, ["chargedAttackHitStunMs"], ["chargedAttackHitStunFrames"], 800, 0),
      controlLevel: integerParam(entity, ["chargedAttackControlLevel"], 3, 1),
      armorLevel: integerParam(entity, ["chargedAttackArmorLevel"], 3, 0),
      moveOffsetX: numberParam(entity, "chargedAttackMoveOffsetX") ?? 0,
      moveOffsetY: numberParam(entity, "chargedAttackMoveOffsetY") ?? 0,
      moveDurationMs: durationParam(entity, ["chargedAttackMoveDurationMs"], ["chargedAttackMoveDurationFrames"], 200, 0),
      chargeStage,
    };
  }
  if (kind === "superParry") {
    const baseDamage = Math.max(1, numberParam(entity, "attackDamage") ?? 1);
    const multiplier = Math.max(1, numberParam(entity, "superParryAttackBaseDamageMultiplier") ?? 3);
    return {
      startupMs: durationParam(entity, ["superParryAttackStartupMs"], ["superParryAttackStartupFrames"], 40, 0),
      activeMs: durationParam(entity, ["superParryAttackActiveMs"], ["superParryAttackActiveFrames"], 120, 1),
      recoveryMs: durationParam(
        entity,
        ["superParryAttackRecoveryMs", "superParryAttackCooldownMs"],
        ["superParryAttackRecoveryFrames", "superParryAttackCooldownFrames"],
        220,
        0,
      ),
      damage: roundDamage(baseDamage * multiplier + (entity.runtime?.superParryBonusDamage ?? 0)),
      hitStunMs: durationParam(entity, ["superParryAttackHitStunMs"], ["superParryAttackHitStunFrames"], 600, 0),
      controlLevel: integerParam(entity, ["superParryAttackControlLevel"], 4, 1),
      armorLevel: integerParam(entity, ["superParryAttackArmorLevel"], 4, 0),
      moveOffsetX: numberParam(entity, "superParryAttackMoveOffsetX") ?? 0,
      moveOffsetY: numberParam(entity, "superParryAttackMoveOffsetY") ?? 0,
      moveDurationMs: durationParam(entity, ["superParryAttackMoveDurationMs"], ["superParryAttackMoveDurationFrames"], 120, 0),
    };
  }
  return {
    startupMs: durationParam(entity, ["attackStartupMs"], ["attackStartupFrames"], 100, 0),
    activeMs: durationParam(entity, ["attackActiveMs"], ["attackActiveFrames"], 300, 1),
    recoveryMs: durationParam(entity, ["attackRecoveryMs", "attackCooldownMs"], ["attackRecoveryFrames", "attackCooldownFrames"], 200, 0),
    damage: Math.max(1, numberParam(entity, "attackDamage") ?? 1),
    hitStunMs: durationParam(entity, ["attackHitStunMs"], ["attackHitStunFrames"], 1000, 0),
    controlLevel: integerParam(entity, ["attackControlLevel"], 1, 1),
    armorLevel: integerParam(entity, ["attackArmorLevel"], 1, 0),
    moveOffsetX: numberParam(entity, "attackMoveOffsetX") ?? 36,
    moveOffsetY: numberParam(entity, "attackMoveOffsetY") ?? 0,
    moveDurationMs: durationParam(entity, ["attackMoveDurationMs"], ["attackMoveDurationFrames"], 100, 0),
  };
}

function attackPhases(startupMs: number, activeMs: number, recoveryMs: number): CombatPhaseDef[] {
  return [
    phase("startup", "前摇", startupMs),
    phase("active", "有效", activeMs),
    phase("recovery", "后摇", recoveryMs),
  ];
}

function attackHitboxShape(entity: Entity, kind: CombatAttackKind): CombatWindowShape {
  const bounds = boundsFor(entity);
  return {
    type: "forwardBox",
    range: attackKindNumberParam(entity, kind, "Range") ?? numberParam(entity, "attackRange") ?? Math.max(64, bounds.w),
    height: attackKindNumberParam(entity, kind, "Height") ?? numberParam(entity, "attackHeight") ?? bounds.h,
    inset: Math.max(0, numberParam(entity, "attackTouchInset") ?? 8),
    offsetX: attackKindNumberParam(entity, kind, "TouchOffsetX") ?? numberParam(entity, "attackTouchOffsetX") ?? 0,
    offsetY: attackKindNumberParam(entity, kind, "TouchOffsetY") ?? numberParam(entity, "attackTouchOffsetY") ?? 0,
  };
}

function rectForForwardBox(entity: Entity, shape: CombatWindowShape): Rect {
  const bounds = boundsFor(entity);
  if (shape.type === "bodyBox") return bounds;
  const direction = entity.runtime?.facing === -1 ? -1 : 1;
  return {
    x: (direction === 1 ? bounds.x + bounds.w - shape.inset : bounds.x - shape.range) + direction * shape.offsetX,
    y: bounds.y + bounds.h / 2 - shape.height / 2 + shape.offsetY,
    w: shape.range + shape.inset,
    h: shape.height,
  };
}

function phase(id: CombatPhaseId, label: string, durationMs: number): CombatPhaseDef {
  return { id, label, durationMs: Math.max(0, durationMs) };
}

function actionNumber(action: CombatActionDef, key: string, fallback: number): number {
  const value = action.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function durationParam(entity: Entity, msKeys: string[], legacyFrameKeys: string[], fallbackMs: number, minMs: number): number {
  for (const key of msKeys) {
    const value = numberParam(entity, key);
    if (value !== undefined) return Math.max(minMs, value);
  }
  for (const key of legacyFrameKeys) {
    const value = numberParam(entity, key);
    if (value !== undefined) return Math.max(minMs, value * LEGACY_COMBAT_FRAME_MS);
  }
  return Math.max(minMs, fallbackMs);
}

function integerParam(entity: Entity, keys: string[], fallback: number, min: number): number {
  for (const key of keys) {
    const value = numberParam(entity, key);
    if (value !== undefined) return Math.max(min, Math.floor(value));
  }
  return Math.max(min, Math.floor(fallback));
}

function numberParam(entity: Entity, key: string): number | undefined {
  const value = entity.behavior?.params[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function attackKindNumberParam(entity: Entity, kind: CombatAttackKind, suffix: string): number | undefined {
  if (kind === "charged") return numberParam(entity, `chargedAttack${suffix}`);
  if (kind === "superParry") return numberParam(entity, `superParryAttack${suffix}`);
  return undefined;
}

function attackLabel(kind: CombatAttackKind): string {
  if (kind === "charged") return "蓄力攻击";
  if (kind === "superParry") return "振刀处决";
  return "普通攻击";
}

function roundDamage(value: number): number {
  return Math.round(value * 100) / 100;
}
