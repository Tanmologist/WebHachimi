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

type CombatActionBuildOptions = {
  chargeStage?: number;
};

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
    startup: combatPhaseFrames(action, "startup"),
    active: combatPhaseFrames(action, "active"),
    recovery: combatPhaseFrames(action, "recovery"),
    damage: actionNumber(action, "damage", 1),
    hitStun: actionNumber(action, "hitStunFrames", 0),
    controlLevel: actionNumber(action, "controlLevel", 1),
    armorLevel: actionNumber(action, "armorLevel", 0),
    chargeStage: typeof action.data?.chargeStage === "number" ? action.data.chargeStage : undefined,
  };
}

export function buildCombatActionRuntime(action: CombatActionDef, startedFrame: number): CombatActionRuntime {
  const phases: CombatRuntimePhase[] = [];
  let cursor = startedFrame;
  for (const phase of action.phases) {
    const frames = Math.max(0, Math.floor(phase.frames));
    if (frames <= 0) continue;
    phases.push({
      id: phase.id,
      label: phase.label,
      startsAtFrame: cursor,
      untilFrame: cursor + frames - 1,
    });
    cursor += frames;
  }
  const firstFrame = phases[0]?.startsAtFrame ?? startedFrame;
  const lastFrame = phases[phases.length - 1]?.untilFrame ?? startedFrame;
  const windows: CombatRuntimeWindow[] = [];
  for (const window of action.windows) {
    const phase = window.phase === "all" ? undefined : phases.find((item) => item.id === window.phase);
    if (window.phase !== "all" && !phase) continue;
    windows.push({
      id: window.id,
      type: window.type,
      label: window.label,
      startsAtFrame: phase?.startsAtFrame ?? firstFrame,
      untilFrame: phase?.untilFrame ?? lastFrame,
      level: window.level,
      controlLevel: window.controlLevel,
      armorLevel: window.armorLevel,
      shape: window.shape,
    });
  }
  return {
    actionId: action.id,
    label: action.label,
    startedFrame,
    phases,
    windows,
  };
}

export function combatPhaseFrames(action: CombatActionDef, phaseId: CombatPhaseId): number {
  return action.phases.find((phase) => phase.id === phaseId)?.frames ?? 0;
}

export function combatActionTotalFrames(action: CombatActionDef): number {
  return action.phases.reduce((total, phase) => total + Math.max(0, Math.floor(phase.frames)), 0);
}

export function combatAttackRectForEntity(entity: Entity): Rect {
  const runtimeHitbox = entity.runtime?.combatAction?.windows.find(
    (window) => window.type === "hitbox" && window.shape?.type === "forwardBox",
  )?.shape;
  const kind = combatAttackKindFromValue(entity.runtime?.attackKind) ?? "normal";
  const shape = runtimeHitbox || attackHitboxShape(entity, kind);
  return rectForForwardBox(entity, shape);
}

export function combatWindowIsOpen(
  runtime: CombatActionRuntime | undefined,
  type: CombatWindowType,
  frame: number,
): CombatRuntimeWindow | undefined {
  return runtime?.windows.find((window) => window.type === type && frame >= window.startsAtFrame && frame <= window.untilFrame);
}

function attackActionDef(entity: Entity, kind: CombatAttackKind, options: CombatActionBuildOptions): CombatActionDef {
  const stats = attackNumbers(entity, kind, options.chargeStage);
  const phases = attackPhases(stats.startup, stats.active, stats.recovery);
  const windows: CombatWindowDef[] = [
    {
      id: `${combatActionIdForAttackKind(kind)}-hitbox`,
      type: "hitbox",
      phase: "active",
      label: "命中盒",
      controlLevel: stats.controlLevel,
      shape: attackHitboxShape(entity, kind),
    },
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
    hitStunFrames: stats.hitStun,
    controlLevel: stats.controlLevel,
    armorLevel: stats.armorLevel,
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
  const active = frameParam(entity, ["parryWindowFrames"], 20, 1);
  const recovery = frameParam(entity, ["parryRecoveryFrames", "parryCooldownFrames"], 30, 0);
  const armorLevel = frameParam(entity, ["parryArmorLevel"], 3, 0);
  const controlLevel = frameParam(entity, ["parryControlLevel"], 3, 1);
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
      windowFrames: active,
      recoveryFrames: recovery,
      controlLevel,
      armorLevel,
    },
  };
}

function dodgeActionDef(entity: Entity): CombatActionDef {
  const evade = frameParam(entity, ["dodgeInvulnerableFrames", "dodgeActiveFrames"], 18, 1);
  const recovery = frameParam(entity, ["dodgeRecoveryFrames", "dodgeCooldownFrames"], 12, 0);
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
      evadeFrames: evade,
      recoveryFrames: recovery,
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
      startup: frameParam(entity, ["chargedAttackStartupFrames"], 20, 0),
      active: frameParam(entity, ["chargedAttackActiveFrames"], 50, 1),
      recovery: frameParam(entity, ["chargedAttackRecoveryFrames", "chargedAttackCooldownFrames"], 30, 0),
      damage: roundDamage(baseDamage * Math.pow(growth, chargeStage - 1) + storedDamage),
      hitStun: frameParam(entity, ["chargedAttackHitStunFrames"], 80, 0),
      controlLevel: frameParam(entity, ["chargedAttackControlLevel"], 3, 1),
      armorLevel: frameParam(entity, ["chargedAttackArmorLevel"], 3, 0),
      chargeStage,
    };
  }
  if (kind === "superParry") {
    const baseDamage = Math.max(1, numberParam(entity, "attackDamage") ?? 1);
    const multiplier = Math.max(1, numberParam(entity, "superParryAttackBaseDamageMultiplier") ?? 3);
    return {
      startup: frameParam(entity, ["superParryAttackStartupFrames"], 4, 0),
      active: frameParam(entity, ["superParryAttackActiveFrames"], 12, 1),
      recovery: frameParam(entity, ["superParryAttackRecoveryFrames", "superParryAttackCooldownFrames"], 22, 0),
      damage: roundDamage(baseDamage * multiplier + (entity.runtime?.superParryBonusDamage ?? 0)),
      hitStun: frameParam(entity, ["superParryAttackHitStunFrames"], 60, 0),
      controlLevel: frameParam(entity, ["superParryAttackControlLevel"], 4, 1),
      armorLevel: frameParam(entity, ["superParryAttackArmorLevel"], 4, 0),
    };
  }
  return {
    startup: frameParam(entity, ["attackStartupFrames"], 10, 0),
    active: frameParam(entity, ["attackActiveFrames"], 30, 1),
    recovery: frameParam(entity, ["attackRecoveryFrames", "attackCooldownFrames"], 20, 0),
    damage: Math.max(1, numberParam(entity, "attackDamage") ?? 1),
    hitStun: frameParam(entity, ["attackHitStunFrames"], 100, 0),
    controlLevel: frameParam(entity, ["attackControlLevel"], 1, 1),
    armorLevel: frameParam(entity, ["attackArmorLevel"], 1, 0),
  };
}

function attackPhases(startup: number, active: number, recovery: number): CombatPhaseDef[] {
  return [
    phase("startup", "前摇", startup),
    phase("active", "有效", active),
    phase("recovery", "后摇", recovery),
  ];
}

function attackHitboxShape(entity: Entity, kind: CombatAttackKind): CombatWindowShape {
  const bounds = boundsFor(entity);
  return {
    type: "forwardBox",
    range: attackKindNumberParam(entity, kind, "Range") ?? numberParam(entity, "attackRange") ?? Math.max(64, bounds.w),
    height: attackKindNumberParam(entity, kind, "Height") ?? numberParam(entity, "attackHeight") ?? bounds.h,
    inset: Math.max(0, numberParam(entity, "attackTouchInset") ?? 8),
    offsetX: numberParam(entity, "attackTouchOffsetX") ?? 0,
    offsetY: numberParam(entity, "attackTouchOffsetY") ?? 0,
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

function phase(id: CombatPhaseId, label: string, frames: number): CombatPhaseDef {
  return { id, label, frames: Math.max(0, Math.floor(frames)) };
}

function actionNumber(action: CombatActionDef, key: string, fallback: number): number {
  const value = action.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function frameParam(entity: Entity, keys: string[], fallback: number, min: number): number {
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

function combatAttackKindFromValue(value: unknown): CombatAttackKind | undefined {
  return value === "normal" || value === "charged" || value === "superParry" ? value : undefined;
}

function attackLabel(kind: CombatAttackKind): string {
  if (kind === "charged") return "蓄力攻击";
  if (kind === "superParry") return "振刀处决";
  return "普通攻击";
}

function roundDamage(value: number): number {
  return Math.round(value * 100) / 100;
}
