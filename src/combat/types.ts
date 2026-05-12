import type { Rect } from "../shared/types";

export type CombatAttackKind = "normal" | "charged" | "superParry";

export type CombatActionId =
  | "normalAttack"
  | "chargeAttack"
  | "parry"
  | "dodge"
  | "superParryExecution";

export type CombatPhaseId = "startup" | "active" | "evade" | "recovery";

export type CombatWindowType =
  | "hitbox"
  | "armor"
  | "parry"
  | "invulnerable"
  | "movement"
  | "movementLock"
  | "chargeStore";

export type CombatWindowShape =
  | {
      type: "forwardBox";
      range: number;
      height: number;
      inset: number;
      offsetX: number;
      offsetY: number;
    }
  | {
      type: "bodyBox";
    };

export type CombatPhaseDef = {
  id: CombatPhaseId;
  label: string;
  frames: number;
};

export type CombatWindowDef = {
  id: string;
  type: CombatWindowType;
  phase: CombatPhaseId | "all";
  label: string;
  level?: number;
  controlLevel?: number;
  armorLevel?: number;
  shape?: CombatWindowShape;
};

export type CombatActionDef = {
  id: CombatActionId;
  label: string;
  input: "attack" | "parry" | "dodge";
  phases: CombatPhaseDef[];
  windows: CombatWindowDef[];
  data?: Record<string, number | string | boolean>;
};

export type CombatRuntimePhase = {
  id: CombatPhaseId;
  label: string;
  startsAtFrame: number;
  untilFrame: number;
};

export type CombatRuntimeWindow = {
  id: string;
  type: CombatWindowType;
  label: string;
  startsAtFrame: number;
  untilFrame: number;
  level?: number;
  controlLevel?: number;
  armorLevel?: number;
  shape?: CombatWindowShape;
};

export type CombatActionRuntime = {
  actionId: CombatActionId;
  label: string;
  startedFrame: number;
  phases: CombatRuntimePhase[];
  windows: CombatRuntimeWindow[];
};

export type CombatAttackStats = {
  kind: CombatAttackKind;
  action: CombatActionDef;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  hitStun: number;
  controlLevel: number;
  armorLevel: number;
  chargeStage?: number;
};

export type CombatRect = Rect;
