import type {
  CombatEvent,
  Entity,
  RuntimeEntityState,
  RuntimeSnapshot,
  Scene,
} from "../project/schema";
import {
  buildCombatActionRuntime,
  combatActionDefForEntity,
  combatActionIdForAttackKind,
  combatActionTotalDurationMs,
  combatAttackRectForEntity,
  combatAttackStatsForEntity,
  combatPhaseDurationMs,
  combatWindowIsOpen,
} from "../combat/actions";
import type { CombatActionId, CombatActionRuntime } from "../combat/types";
import { normalizeEntityDefaults, normalizeSceneSettings, normalizeSceneTimeScale } from "../project/schema";
import { entityFollowsParentTransform } from "../project/entityHierarchy";
import { cloneJson, makeId } from "../shared/types";
import type { EntityId, RuntimeMode, SnapshotId } from "../shared/types";
import type { Rect, SceneId, Vec2 } from "../shared/types";
import { collectDynamicPairs, entityIntersectsRect, overlaps } from "./collision";
import { FixedStepClock } from "./time";

export type RuntimeWorldOptions = {
  scene: Scene;
};

type RuntimeEntityFlags = {
  grounded: boolean;
  wasGrounded: boolean;
  ageMs: number;
  lifetimeMs?: number;
  patrolDirection: -1 | 1;
};

type AttackKind = NonNullable<NonNullable<Entity["runtime"]>["attackKind"]>;

type AttackConfig = {
  kind: AttackKind;
  actionId: CombatActionId;
  actionRuntime: CombatActionRuntime;
  startupMs: number;
  activeMs: number;
  recoveryMs: number;
  damage: number;
  hitStunMs: number;
  controlLevel: number;
  armorLevel: number;
  moveOffsetX: number;
  moveOffsetY: number;
  moveDurationMs: number;
  chargeStage?: number;
};

type ActiveAttackState = {
  entity: Entity;
  kind: AttackKind;
  rect: Rect;
  controlLevel: number;
  armorLevel: number;
};

export class RuntimeWorld {
  readonly sceneId: SceneId;
  readonly clock: FixedStepClock;
  readonly gravity: Vec2;
  timeScale: number;
  mode: RuntimeMode = "editorFrozen";
  entities = new Map<string, Entity>();
  transientEntities = new Map<string, Entity>();
  private entityListCache?: Entity[];
  input: Record<string, boolean> = {};
  actorInput: Record<string, Record<string, boolean>> = {};
  combatEvents: CombatEvent[] = [];
  lastSnapshot?: RuntimeSnapshot;
  screenShakeStartedMs = 0;
  screenShakeUntilMs = 0;
  screenShakeMagnitude = 0;

  constructor(options: RuntimeWorldOptions) {
    const settings = normalizeSceneSettings(cloneJson(options.scene.settings));
    this.sceneId = options.scene.id;
    this.gravity = cloneJson(settings.gravity);
    this.timeScale = settings.timeScale;
    this.clock = new FixedStepClock({
      fixedStepMs: settings.fixedStepMs,
      maxStepsPerFrame: 16,
    });
    Object.values(options.scene.entities).forEach((entity) => {
      const copy = cloneJson(entity);
      normalizeEntityDefaults(copy);
      this.normalizeRuntime(copy);
      if (copy.persistent) this.entities.set(copy.id, copy);
    });
  }

  setMode(mode: RuntimeMode): RuntimeSnapshot | undefined {
    this.mode = mode;
    this.clock.setMode(mode);
    if (mode === "editorFrozen") {
      this.lastSnapshot = this.captureSnapshot();
      return this.lastSnapshot;
    }
    return undefined;
  }

  toggleEditorFreeze(): RuntimeSnapshot | undefined {
    return this.setMode(this.mode === "game" ? "editorFrozen" : "game");
  }

  setTimeScale(value: number): void {
    this.timeScale = normalizeSceneTimeScale(value);
  }

  screenShakeOffset(): Vec2 {
    const remainingMs = this.screenShakeUntilMs - this.clock.timeMs;
    if (remainingMs <= 0 || this.screenShakeMagnitude <= 0) return { x: 0, y: 0 };
    const durationMs = Math.max(this.clock.fixedStepMs, this.screenShakeUntilMs - this.screenShakeStartedMs);
    const strength = this.screenShakeMagnitude * Math.max(0, remainingMs / durationMs);
    const phase = this.clock.frame * 1.618 + this.clock.timeMs * 0.037;
    return {
      x: Math.sin(phase * 2.1) * strength,
      y: Math.cos(phase * 2.7) * strength * 0.65,
    };
  }

  pushDelta(deltaMs: number): void {
    const tick = this.clock.pushDelta(deltaMs * this.timeScale);
    for (let index = 0; index < tick.steps; index += 1) this.stepFixed();
  }

  stepFixed(): void {
    const dt = this.clock.fixedStepMs / 1000;
    const beforeMovementPositions = this.captureEntityPositions();
    this.beginFixedStep();
    const all = this.allEntities();
    for (const entity of all) {
      if (!entity.body || entity.body.mode === "static" || entity.body.mode === "none") continue;
      this.applyBuiltinBehavior(entity);
      const gravityScale = this.effectiveGravityScale(entity);
      entity.body.velocity.x += this.gravity.x * gravityScale * dt;
      entity.body.velocity.y += this.gravity.y * gravityScale * dt;
      const maxFallSpeed = numberParam(entity, "maxFallSpeed");
      if (maxFallSpeed !== undefined && maxFallSpeed > 0 && entity.body.velocity.y > maxFallSpeed) {
        entity.body.velocity.y = maxFallSpeed;
      }
      entity.transform.position.x += entity.body.velocity.x * dt;
      entity.transform.position.y += entity.body.velocity.y * dt;
    }
    this.propagateChildTranslationFromParentDelta(beforeMovementPositions);
    const beforeCollisionPositions = this.captureEntityPositions();
    this.resolveSimpleCollisions();
    this.propagateChildTranslationFromParentDelta(beforeCollisionPositions);
    this.resolveCombatEvents();
    this.updateCombatPresentationStates();
    this.cleanupExpiredTransients();
  }

  spawnTransient(entity: Entity, lifetimeMs?: number): EntityId {
    const transient = cloneJson(entity);
    normalizeEntityDefaults(transient);
    let id = transient.id;
    if (this.entities.has(id) || this.transientEntities.has(id)) {
      id = makeId<"EntityId">("transient") as EntityId;
      transient.id = id;
    }
    transient.persistent = false;
    transient.runtime = {
      ...transient.runtime,
      ageMs: 0,
      lifetimeMs: lifetimeMs ?? transient.runtime?.lifetimeMs ?? numberParam(transient, "lifetimeMs") ?? numberParam(transient, "ttlMs"),
    };
    this.normalizeRuntime(transient);
    this.transientEntities.set(id, transient);
    this.invalidateEntityListCache();
    return id;
  }

  setInput(key: string, pressed: boolean): void {
    this.input[key] = pressed;
    const scoped = parseActorScopedKey(key);
    if (scoped) {
      this.actorInput[scoped.entityId] = {
        ...(this.actorInput[scoped.entityId] || {}),
        [scoped.key]: pressed,
      };
    }
  }

  runFixedFrame(): void {
    this.clock.stepOnce();
    this.stepFixed();
    if (this.mode === "editorFrozen") this.lastSnapshot = this.captureSnapshot();
  }

  runFixedTicks(ticks: number): void {
    this.setMode("game");
    for (let index = 0; index < ticks; index += 1) this.runFixedFrame();
  }

  runFixedFrames(frames: number): void {
    this.runFixedTicks(frames);
  }

  freezeForInspection(): RuntimeSnapshot {
    return this.setMode("editorFrozen") || this.captureSnapshot();
  }

  captureSnapshot(): RuntimeSnapshot {
    const entities: Record<string, RuntimeEntityState> = {};
    for (const entity of this.allEntities()) {
      entities[entity.id] = {
        entityId: entity.id,
        transform: cloneJson(entity.transform),
        velocity: cloneJson(entity.body?.velocity || { x: 0, y: 0 }),
        bodyMode: entity.body?.mode,
        ageMs: entity.runtime?.ageMs,
        lifetimeMs: entity.runtime?.lifetimeMs,
        grounded: entity.runtime?.grounded,
        timers: {},
        state: {
          patrolDirection: entity.runtime?.patrolDirection,
          wasGrounded: entity.runtime?.wasGrounded,
          facing: entity.runtime?.facing,
          health: entity.runtime?.health,
          defeated: entity.runtime?.defeated,
          hitFlashUntilMs: entity.runtime?.hitFlashUntilMs,
          defeatTimeMs: entity.runtime?.defeatTimeMs,
          hitFlashUntilFrame: entity.runtime?.hitFlashUntilFrame,
          defeatFrame: entity.runtime?.defeatFrame,
          combatAction: entity.runtime?.combatAction,
          attackStartMs: entity.runtime?.attackStartMs,
          attackActiveUntilMs: entity.runtime?.attackActiveUntilMs,
          attackCooldownUntilMs: entity.runtime?.attackCooldownUntilMs,
          attackStartFrame: entity.runtime?.attackStartFrame,
          attackActiveUntilFrame: entity.runtime?.attackActiveUntilFrame,
          attackCooldownUntilFrame: entity.runtime?.attackCooldownUntilFrame,
          attackHitIds: entity.runtime?.attackHitIds,
          attackTouchEntityId: entity.runtime?.attackTouchEntityId,
          attackMovementTargetEntityId: entity.runtime?.attackMovementTargetEntityId,
          attackMoveStartedMs: entity.runtime?.attackMoveStartedMs,
          attackMoveUntilMs: entity.runtime?.attackMoveUntilMs,
          attackMoveOffsetX: entity.runtime?.attackMoveOffsetX,
          attackMoveOffsetY: entity.runtime?.attackMoveOffsetY,
          attackMoveTargetX: entity.runtime?.attackMoveTargetX,
          attackMoveTargetY: entity.runtime?.attackMoveTargetY,
          attackKind: entity.runtime?.attackKind,
          attackDamage: entity.runtime?.attackDamage,
          attackControlLevel: entity.runtime?.attackControlLevel,
          attackArmorLevel: entity.runtime?.attackArmorLevel,
          attackChargeStage: entity.runtime?.attackChargeStage,
          attackInputDown: entity.runtime?.attackInputDown,
          attackConsumedUntilRelease: entity.runtime?.attackConsumedUntilRelease,
          parryInputDown: entity.runtime?.parryInputDown,
          dodgeInputDown: entity.runtime?.dodgeInputDown,
          dodgeStartedMs: entity.runtime?.dodgeStartedMs,
          dodgeUntilMs: entity.runtime?.dodgeUntilMs,
          dodgeRecoveryUntilMs: entity.runtime?.dodgeRecoveryUntilMs,
          dodgeStartedFrame: entity.runtime?.dodgeStartedFrame,
          dodgeUntilFrame: entity.runtime?.dodgeUntilFrame,
          dodgeRecoveryUntilFrame: entity.runtime?.dodgeRecoveryUntilFrame,
          chargeStartedMs: entity.runtime?.chargeStartedMs,
          chargeHeldMs: entity.runtime?.chargeHeldMs,
          chargeStartedFrame: entity.runtime?.chargeStartedFrame,
          chargeHeldFrames: entity.runtime?.chargeHeldFrames,
          chargeStage: entity.runtime?.chargeStage,
          chargeStoredDamage: entity.runtime?.chargeStoredDamage,
          parryStartedMs: entity.runtime?.parryStartedMs,
          parryAnimationUntilMs: entity.runtime?.parryAnimationUntilMs,
          parryUntilMs: entity.runtime?.parryUntilMs,
          parryRecoveryUntilMs: entity.runtime?.parryRecoveryUntilMs,
          parryCooldownUntilMs: entity.runtime?.parryCooldownUntilMs,
          parryStartedFrame: entity.runtime?.parryStartedFrame,
          parryAnimationUntilFrame: entity.runtime?.parryAnimationUntilFrame,
          parryUntilFrame: entity.runtime?.parryUntilFrame,
          parryRecoveryUntilFrame: entity.runtime?.parryRecoveryUntilFrame,
          parryCooldownUntilFrame: entity.runtime?.parryCooldownUntilFrame,
          superParryUntilMs: entity.runtime?.superParryUntilMs,
          superParryLockUntilMs: entity.runtime?.superParryLockUntilMs,
          superParryUntilFrame: entity.runtime?.superParryUntilFrame,
          superParryLockUntilFrame: entity.runtime?.superParryLockUntilFrame,
          superParryBonusDamage: entity.runtime?.superParryBonusDamage,
          hitStunUntilMs: entity.runtime?.hitStunUntilMs,
          hitStunUntilFrame: entity.runtime?.hitStunUntilFrame,
        },
      };
    }
    const clockState = this.clock.captureState();
    return {
      id: makeId<"SnapshotId">("snapshot") as SnapshotId,
      sceneId: this.sceneId,
      mode: this.mode,
      frame: clockState.frame,
      timeMs: clockState.timeMs,
      clockAccumulatorMs: clockState.accumulatorMs,
      entities,
      transientEntities: cloneJson(Object.fromEntries(this.transientEntities)),
      input: cloneJson(this.input),
      combatEvents: cloneJson(this.combatEvents),
      capturedAt: new Date().toISOString(),
    };
  }

  restoreSnapshot(snapshot: RuntimeSnapshot, restoreMode = true): void {
    this.clock.restoreState({
      frame: snapshot.frame,
      timeMs: snapshot.timeMs,
      accumulatorMs: snapshot.clockAccumulatorMs ?? 0,
    });
    this.input = cloneJson(snapshot.input);
    this.actorInput = actorInputFromFlatInput(this.input);
    this.combatEvents = cloneJson(snapshot.combatEvents || []);
    this.transientEntities = new Map(Object.entries(cloneJson(snapshot.transientEntities)));
    this.invalidateEntityListCache();
    this.transientEntities.forEach((entity) => this.normalizeRuntime(entity));
    for (const state of Object.values(snapshot.entities)) {
      const entity = this.entities.get(state.entityId) || this.transientEntities.get(state.entityId);
      if (!entity) continue;
      entity.transform = cloneJson(state.transform);
      if (entity.body) entity.body.velocity = cloneJson(state.velocity);
      entity.runtime = {
        ...entity.runtime,
        ageMs: state.ageMs ?? entity.runtime?.ageMs ?? 0,
        lifetimeMs: state.lifetimeMs ?? entity.runtime?.lifetimeMs,
        grounded: state.grounded ?? false,
        wasGrounded: state.state.wasGrounded === true,
        patrolDirection: state.state.patrolDirection === -1 ? -1 : 1,
        facing: state.state.facing === -1 ? -1 : 1,
        health: typeof state.state.health === "number" ? state.state.health : entity.runtime?.health,
        defeated: state.state.defeated === true,
        hitFlashUntilMs: runtimeStateMs(state.state, "hitFlashUntilMs", "hitFlashUntilFrame"),
        defeatTimeMs: runtimeStateMs(state.state, "defeatTimeMs", "defeatFrame"),
        hitFlashUntilFrame: typeof state.state.hitFlashUntilFrame === "number" ? state.state.hitFlashUntilFrame : undefined,
        defeatFrame: typeof state.state.defeatFrame === "number" ? state.state.defeatFrame : undefined,
        combatAction: combatActionRuntimeFromValue(state.state.combatAction),
        attackStartMs: runtimeStateMs(state.state, "attackStartMs", "attackStartFrame"),
        attackActiveUntilMs: runtimeStateMs(state.state, "attackActiveUntilMs", "attackActiveUntilFrame"),
        attackCooldownUntilMs: runtimeStateMs(state.state, "attackCooldownUntilMs", "attackCooldownUntilFrame"),
        attackStartFrame: typeof state.state.attackStartFrame === "number" ? state.state.attackStartFrame : undefined,
        attackActiveUntilFrame:
          typeof state.state.attackActiveUntilFrame === "number" ? state.state.attackActiveUntilFrame : undefined,
        attackCooldownUntilFrame:
          typeof state.state.attackCooldownUntilFrame === "number" ? state.state.attackCooldownUntilFrame : undefined,
        attackHitIds: Array.isArray(state.state.attackHitIds) ? cloneJson(state.state.attackHitIds) : [],
        attackTouchEntityId: typeof state.state.attackTouchEntityId === "string" ? state.state.attackTouchEntityId as EntityId : undefined,
        attackMovementTargetEntityId:
          typeof state.state.attackMovementTargetEntityId === "string" ? state.state.attackMovementTargetEntityId as EntityId : undefined,
        attackMoveStartedMs: typeof state.state.attackMoveStartedMs === "number" ? state.state.attackMoveStartedMs : undefined,
        attackMoveUntilMs: typeof state.state.attackMoveUntilMs === "number" ? state.state.attackMoveUntilMs : undefined,
        attackMoveOffsetX: typeof state.state.attackMoveOffsetX === "number" ? state.state.attackMoveOffsetX : undefined,
        attackMoveOffsetY: typeof state.state.attackMoveOffsetY === "number" ? state.state.attackMoveOffsetY : undefined,
        attackMoveTargetX: typeof state.state.attackMoveTargetX === "number" ? state.state.attackMoveTargetX : undefined,
        attackMoveTargetY: typeof state.state.attackMoveTargetY === "number" ? state.state.attackMoveTargetY : undefined,
        attackKind: attackKindFromValue(state.state.attackKind),
        attackDamage: typeof state.state.attackDamage === "number" ? state.state.attackDamage : undefined,
        attackControlLevel: typeof state.state.attackControlLevel === "number" ? state.state.attackControlLevel : undefined,
        attackArmorLevel: typeof state.state.attackArmorLevel === "number" ? state.state.attackArmorLevel : undefined,
        attackChargeStage: typeof state.state.attackChargeStage === "number" ? state.state.attackChargeStage : undefined,
        attackInputDown: state.state.attackInputDown === true,
        attackConsumedUntilRelease: state.state.attackConsumedUntilRelease === true,
        parryInputDown: state.state.parryInputDown === true,
        dodgeInputDown: state.state.dodgeInputDown === true,
        dodgeStartedMs: runtimeStateMs(state.state, "dodgeStartedMs", "dodgeStartedFrame"),
        dodgeUntilMs: runtimeStateMs(state.state, "dodgeUntilMs", "dodgeUntilFrame"),
        dodgeRecoveryUntilMs: runtimeStateMs(state.state, "dodgeRecoveryUntilMs", "dodgeRecoveryUntilFrame"),
        dodgeStartedFrame: typeof state.state.dodgeStartedFrame === "number" ? state.state.dodgeStartedFrame : undefined,
        dodgeUntilFrame: typeof state.state.dodgeUntilFrame === "number" ? state.state.dodgeUntilFrame : undefined,
        dodgeRecoveryUntilFrame:
          typeof state.state.dodgeRecoveryUntilFrame === "number" ? state.state.dodgeRecoveryUntilFrame : undefined,
        chargeStartedMs: runtimeStateMs(state.state, "chargeStartedMs", "chargeStartedFrame"),
        chargeHeldMs: runtimeStateMs(state.state, "chargeHeldMs", "chargeHeldFrames"),
        chargeStartedFrame: typeof state.state.chargeStartedFrame === "number" ? state.state.chargeStartedFrame : undefined,
        chargeHeldFrames: typeof state.state.chargeHeldFrames === "number" ? state.state.chargeHeldFrames : undefined,
        chargeStage: typeof state.state.chargeStage === "number" ? state.state.chargeStage : undefined,
        chargeStoredDamage: typeof state.state.chargeStoredDamage === "number" ? state.state.chargeStoredDamage : undefined,
        parryStartedMs: runtimeStateMs(state.state, "parryStartedMs", "parryStartedFrame"),
        parryAnimationUntilMs: runtimeStateMs(state.state, "parryAnimationUntilMs", "parryAnimationUntilFrame"),
        parryUntilMs: runtimeStateMs(state.state, "parryUntilMs", "parryUntilFrame"),
        parryRecoveryUntilMs: runtimeStateMs(state.state, "parryRecoveryUntilMs", "parryRecoveryUntilFrame"),
        parryCooldownUntilMs: runtimeStateMs(state.state, "parryCooldownUntilMs", "parryCooldownUntilFrame"),
        parryStartedFrame: typeof state.state.parryStartedFrame === "number" ? state.state.parryStartedFrame : undefined,
        parryAnimationUntilFrame:
          typeof state.state.parryAnimationUntilFrame === "number" ? state.state.parryAnimationUntilFrame : undefined,
        parryUntilFrame: typeof state.state.parryUntilFrame === "number" ? state.state.parryUntilFrame : undefined,
        parryRecoveryUntilFrame:
          typeof state.state.parryRecoveryUntilFrame === "number" ? state.state.parryRecoveryUntilFrame : undefined,
        parryCooldownUntilFrame:
          typeof state.state.parryCooldownUntilFrame === "number" ? state.state.parryCooldownUntilFrame : undefined,
        superParryUntilMs: runtimeStateMs(state.state, "superParryUntilMs", "superParryUntilFrame"),
        superParryLockUntilMs: runtimeStateMs(state.state, "superParryLockUntilMs", "superParryLockUntilFrame"),
        superParryUntilFrame: typeof state.state.superParryUntilFrame === "number" ? state.state.superParryUntilFrame : undefined,
        superParryLockUntilFrame: typeof state.state.superParryLockUntilFrame === "number" ? state.state.superParryLockUntilFrame : undefined,
        superParryBonusDamage: typeof state.state.superParryBonusDamage === "number" ? state.state.superParryBonusDamage : undefined,
        hitStunUntilMs: runtimeStateMs(state.state, "hitStunUntilMs", "hitStunUntilFrame"),
        hitStunUntilFrame: typeof state.state.hitStunUntilFrame === "number" ? state.state.hitStunUntilFrame : undefined,
      };
    }
    if (restoreMode) {
      this.mode = snapshot.mode;
      this.clock.setMode(snapshot.mode);
    }
  }

  syncPersistentEntities(scene: Scene): void {
    const persistentIds = new Set<string>();
    Object.values(scene.entities).forEach((entity) => {
      const copy = cloneJson(entity);
      normalizeEntityDefaults(copy);
      this.normalizeRuntime(copy);
      if (!copy.persistent) return;
      this.entities.set(copy.id, copy);
      persistentIds.add(copy.id);
    });
    for (const entityId of [...this.entities.keys()]) {
      if (!persistentIds.has(entityId)) this.entities.delete(entityId);
    }
    this.invalidateEntityListCache();
  }

  entityById(entityId: EntityId | undefined): Entity | undefined {
    if (!entityId) return undefined;
    return this.entities.get(entityId) || this.transientEntities.get(entityId);
  }

  allEntities(): Entity[] {
    if (!this.entityListCache) this.entityListCache = [...this.entities.values(), ...this.transientEntities.values()];
    return this.entityListCache;
  }

  private resolveSimpleCollisions(): void {
    const hits = collectDynamicPairs(this.allEntities());
    for (const hit of hits) {
      if (hit.trigger) continue;
      const dynamic = hit.a.body?.mode === "dynamic" ? hit.a : hit.b.body?.mode === "dynamic" ? hit.b : undefined;
      if (!dynamic || !dynamic.body) continue;
      const direction = dynamic === hit.a ? 1 : -1;
      const separationNormal = { x: hit.normal.x * direction, y: hit.normal.y * direction };
      dynamic.transform.position.x += separationNormal.x * hit.depth;
      dynamic.transform.position.y += separationNormal.y * hit.depth;
      if (hit.normal.y !== 0) dynamic.body.velocity.y = 0;
      if (hit.normal.x !== 0) dynamic.body.velocity.x = 0;
      if (separationNormal.y < 0) {
        this.runtimeFlags(dynamic).grounded = true;
        dynamic.runtime = { ...dynamic.runtime, grounded: true };
      }
    }
  }

  private beginFixedStep(): void {
    const dtMs = this.clock.fixedStepMs;
    for (const entity of this.allEntities()) {
      const flags = this.runtimeFlags(entity);
      flags.wasGrounded = flags.grounded;
      flags.grounded = false;
      flags.ageMs += dtMs;
      entity.runtime = {
        ...entity.runtime,
        ageMs: flags.ageMs,
        lifetimeMs: flags.lifetimeMs,
        wasGrounded: flags.wasGrounded,
        grounded: false,
        patrolDirection: flags.patrolDirection,
      };
    }
  }

  private captureEntityPositions(): Map<string, Vec2> {
    return new Map(this.allEntities().map((entity) => [entity.id, { ...entity.transform.position }]));
  }

  private propagateChildTranslationFromParentDelta(previousPositions: ReadonlyMap<string, Vec2>): void {
    const entities = this.allEntities();
    const byParent = new Map<string, Entity[]>();
    const byId = new Map<string, Entity>();
    for (const entity of entities) {
      byId.set(entity.id, entity);
      const parentId = entity.parentId;
      if (!parentId || !entityFollowsParentTransform(entity)) continue;
      const children = byParent.get(parentId) || [];
      children.push(entity);
      byParent.set(parentId, children);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (entity: Entity) => {
      if (visited.has(entity.id) || visiting.has(entity.id)) return;
      visiting.add(entity.id);
      const previous = previousPositions.get(entity.id);
      const delta = previous
        ? {
            x: entity.transform.position.x - previous.x,
            y: entity.transform.position.y - previous.y,
          }
        : { x: 0, y: 0 };

      for (const child of byParent.get(entity.id) || []) {
        if (child.id === entity.id) continue;
        if (Math.abs(delta.x) >= 0.001 || Math.abs(delta.y) >= 0.001) {
          child.transform.position.x += delta.x;
          child.transform.position.y += delta.y;
        }
        visit(child);
      }
      visiting.delete(entity.id);
      visited.add(entity.id);
    };

    for (const entity of entities) {
      if (!entity.parentId || !byId.has(entity.parentId)) visit(entity);
    }
    for (const entity of entities) visit(entity);
  }

  private applyBuiltinBehavior(entity: Entity): void {
    if (!entity.body) return;
    const timeMs = this.clock.timeMs;
    if (entity.runtime?.defeated) {
      this.stopEntity(entity);
      this.clearActiveAttack(entity);
      this.clearCharge(entity);
      this.clearDodge(entity);
      return;
    }
    if (this.isHitStunned(entity, timeMs)) {
      this.stopEntity(entity);
      this.clearActiveAttack(entity);
      this.clearCharge(entity);
      this.clearDodge(entity);
      return;
    }
    if (entity.behavior?.builtin === "enemyPatrol") {
      this.applyEnemyPatrol(entity);
    } else if (entity.behavior?.builtin === "playerPlatformer") {
      this.applyPlayerPlatformer(entity);
    }
    this.applyCombatInput(entity);
  }

  private applyPlayerPlatformer(entity: Entity): void {
    if (!entity.body) return;
    const speed = numberParam(entity, "speed") ?? 300;
    const jump = numberParam(entity, "jump") ?? 620;
    const left = this.isInputDown(entity, "left", "a");
    const right = this.isInputDown(entity, "right", "d");
    const jumpPressed = this.isInputDown(entity, "jump", "w", "space");
    if (this.isSuperParryMoveLocked(entity)) {
      entity.body.velocity.x = 0;
      return;
    }
    if (this.applyDodgeMovement(entity)) return;
    if (this.applyAttackMovement(entity)) return;
    if (this.isCombatMovementLocked(entity)) {
      entity.body.velocity.x = 0;
      return;
    }
    entity.body.velocity.x = left === right ? 0 : right ? speed : -speed;
    if (left !== right) entity.runtime = { ...entity.runtime, facing: right ? 1 : -1 };
    const flags = this.runtimeFlags(entity);
    if (jumpPressed && flags.wasGrounded) {
      entity.body.velocity.y = -jump;
      flags.wasGrounded = false;
      flags.grounded = false;
      entity.runtime = { ...entity.runtime, grounded: false };
    }
  }

  private applyEnemyPatrol(entity: Entity): void {
    if (!entity.body) return;
    if (this.applyDodgeMovement(entity)) return;
    if (this.applyAttackMovement(entity)) return;
    if (this.isCombatMovementLocked(entity)) {
      entity.body.velocity.x = 0;
      if (entity.body.mode === "kinematic") entity.body.velocity.y = 0;
      return;
    }
    const flags = this.runtimeFlags(entity);
    const fallbackSpeed = Math.abs(entity.body.velocity.x) || 90;
    const speed = numberParam(entity, "speed") ?? fallbackSpeed;
    const targetName = stringParam(entity, "targetInternalName");
    if (targetName) {
      const target = this.findEntityByInternalName(targetName);
      if (target && !target.runtime?.defeated) {
        const dx = target.transform.position.x - entity.transform.position.x;
        const dy = Math.abs(target.transform.position.y - entity.transform.position.y);
        const aggroRange = numberParam(entity, "aggroRange") ?? 420;
        const preferredDistance = numberParam(entity, "preferredDistance") ?? Math.max(48, (numberParam(entity, "attackRange") ?? 110) * 0.55);
        const attackRange = numberParam(entity, "attackRange") ?? 110;
        const attackHeight = numberParam(entity, "attackHeight") ?? 76;
        const direction: -1 | 1 = dx < 0 ? -1 : 1;
        if (Math.abs(dx) <= aggroRange && dy <= Math.max(attackHeight * 1.5, 120)) {
          flags.patrolDirection = direction;
          entity.runtime = { ...entity.runtime, patrolDirection: direction, facing: direction };
          entity.body.velocity.x = Math.abs(dx) > preferredDistance ? speed * direction : 0;
          entity.body.velocity.y = 0;
          if (Math.abs(dx) <= attackRange && dy <= attackHeight) this.tryStartAttack(entity);
          return;
        }
      }
    }
    const left = numberParam(entity, "left");
    const right = numberParam(entity, "right");
    if (left !== undefined && entity.transform.position.x <= left) flags.patrolDirection = 1;
    if (right !== undefined && entity.transform.position.x >= right) flags.patrolDirection = -1;
    entity.body.velocity.x = speed * flags.patrolDirection;
    entity.body.velocity.y = 0;
    entity.runtime = { ...entity.runtime, patrolDirection: flags.patrolDirection, facing: flags.patrolDirection };
  }

  private applyCombatInput(entity: Entity): void {
    if (!entity.collider) return;
    const timeMs = this.clock.timeMs;
    const attackDown = this.isInputDown(entity, "attack");
    const parryDown = this.isInputDown(entity, "parry");
    const dodgeDown = this.isInputDown(entity, "dodge", "shift");
    const wasAttackDown = entity.runtime?.attackInputDown === true;
    const wasParryDown = entity.runtime?.parryInputDown === true;
    const wasDodgeDown = entity.runtime?.dodgeInputDown === true;
    const attackPressed = attackDown && !wasAttackDown;
    const attackReleased = !attackDown && wasAttackDown;
    const parryPressed = parryDown && !wasParryDown;
    const dodgePressed = dodgeDown && !wasDodgeDown;

    if (!attackDown && entity.runtime?.attackConsumedUntilRelease) {
      entity.runtime = {
        ...entity.runtime,
        attackInputDown: false,
        attackConsumedUntilRelease: false,
        parryInputDown: parryDown,
        dodgeInputDown: dodgeDown,
      };
      return;
    }

    if (dodgePressed && this.tryStartDodge(entity)) {
      this.clearCharge(entity);
      entity.runtime = {
        ...entity.runtime,
        attackInputDown: attackDown,
        attackConsumedUntilRelease: entity.runtime?.attackConsumedUntilRelease === true || attackDown,
        parryInputDown: parryDown,
        dodgeInputDown: dodgeDown,
      };
      return;
    }

    if (this.isCombatActionLocked(entity, timeMs)) {
      entity.runtime = {
        ...entity.runtime,
        attackInputDown: attackDown,
        attackConsumedUntilRelease: entity.runtime?.attackConsumedUntilRelease === true || attackPressed || parryPressed || dodgePressed,
        parryInputDown: parryDown,
        dodgeInputDown: dodgeDown,
      };
      return;
    }

    if (parryPressed) {
      const fromCharge = attackDown && (entity.runtime?.chargeHeldMs ?? 0) > 0;
      if (fromCharge) {
        this.clearCharge(entity);
        entity.runtime = {
          ...entity.runtime,
          attackInputDown: attackDown,
          attackConsumedUntilRelease: true,
          parryInputDown: parryDown,
          dodgeInputDown: dodgeDown,
        };
      }
      this.tryStartParry(entity, { fromCharge });
    }

    if (entity.runtime?.attackConsumedUntilRelease) {
      entity.runtime = { ...entity.runtime, attackInputDown: attackDown, parryInputDown: parryDown, dodgeInputDown: dodgeDown };
      return;
    }

    if (attackPressed && this.hasSuperParryReady(entity, timeMs)) {
      this.tryStartAttack(entity, { kind: "superParry" });
      entity.runtime = {
        ...entity.runtime,
        attackInputDown: attackDown,
        attackConsumedUntilRelease: true,
        parryInputDown: parryDown,
        dodgeInputDown: dodgeDown,
      };
      return;
    }

    if (attackPressed) this.beginCharge(entity);
    if (attackDown) this.updateCharge(entity, wasAttackDown);
    if (attackReleased) this.releaseChargeAttack(entity);

    entity.runtime = { ...entity.runtime, attackInputDown: attackDown, parryInputDown: parryDown, dodgeInputDown: dodgeDown };
  }

  private effectiveGravityScale(entity: Entity): number {
    if (!entity.body) return 0;
    const baseGravityScale = numberParam(entity, "gravityScale") ?? entity.body.gravityScale;
    if (entity.behavior?.builtin !== "playerPlatformer") return baseGravityScale;
    if (entity.body.velocity.y > 0) return numberParam(entity, "fallGravityScale") ?? baseGravityScale;
    const jumpHeld = this.isInputDown(entity, "jump", "w", "space");
    if (entity.body.velocity.y < 0 && !jumpHeld) {
      return numberParam(entity, "jumpReleaseGravityScale") ?? numberParam(entity, "lowJumpGravityScale") ?? numberParam(entity, "fallGravityScale") ?? baseGravityScale;
    }
    return baseGravityScale;
  }

  private chargeThresholdMs(entity: Entity): number {
    return Math.max(1, numberParam(entity, "chargeThresholdMs") ?? legacyFramesToMs(numberParam(entity, "chargeThresholdFrames") ?? 60));
  }

  private chargeStageMs(entity: Entity): number {
    return Math.max(1, numberParam(entity, "chargeStageMs") ?? legacyFramesToMs(numberParam(entity, "chargeStageFrames")) ?? this.chargeThresholdMs(entity));
  }

  private hasSuperParryReady(entity: Entity, timeMs = this.clock.timeMs): boolean {
    return timeMs < (entity.runtime?.superParryUntilMs ?? -1);
  }

  private isSuperParryMoveLocked(entity: Entity, timeMs = this.clock.timeMs): boolean {
    return timeMs < (entity.runtime?.superParryLockUntilMs ?? -1);
  }

  private applyDodgeMovement(entity: Entity, timeMs = this.clock.timeMs): boolean {
    if (!entity.body || timeMs >= (entity.runtime?.dodgeUntilMs ?? -1)) return false;
    const direction = entity.runtime?.facing === -1 ? -1 : 1;
    entity.body.velocity.x = this.dodgeSpeed(entity) * direction;
    if (entity.body.mode === "kinematic") entity.body.velocity.y = 0;
    return true;
  }

  private applyAttackMovement(entity: Entity, timeMs = this.clock.timeMs): boolean {
    if (!entity.body || timeMs >= (entity.runtime?.attackMoveUntilMs ?? -1)) return false;
    const targetX = entity.runtime?.attackMoveTargetX;
    const targetY = entity.runtime?.attackMoveTargetY;
    if (typeof targetX !== "number" || typeof targetY !== "number") return false;
    const remainingMs = Math.max(this.clock.fixedStepMs, (entity.runtime?.attackMoveUntilMs ?? timeMs) - timeMs);
    const remainingSeconds = remainingMs / 1000;
    entity.body.velocity.x = (targetX - entity.transform.position.x) / remainingSeconds;
    if (Math.abs(entity.runtime?.attackMoveOffsetY ?? 0) > 0.001 || entity.body.mode === "kinematic") {
      entity.body.velocity.y = (targetY - entity.transform.position.y) / remainingSeconds;
    }
    this.syncAttackMovementTargetEntity(entity);
    return true;
  }

  private dodgeSpeed(entity: Entity, action = combatActionDefForEntity(entity, "dodge")): number {
    const value = action.data?.speed;
    return typeof value === "number" && Number.isFinite(value) ? value : numberParam(entity, "dodgeSpeed") ?? 650;
  }

  private isAttackActionLocked(entity: Entity, timeMs = this.clock.timeMs): boolean {
    return timeMs < (entity.runtime?.attackCooldownUntilMs ?? -1);
  }

  private isParryActionLocked(entity: Entity, timeMs = this.clock.timeMs): boolean {
    return timeMs < (entity.runtime?.parryRecoveryUntilMs ?? -1);
  }

  private isDodgeActionLocked(entity: Entity, timeMs = this.clock.timeMs): boolean {
    return timeMs < (entity.runtime?.dodgeRecoveryUntilMs ?? -1);
  }

  private isDodgeInvulnerable(entity: Entity, timeMs = this.clock.timeMs): boolean {
    return Boolean(combatWindowIsOpen(entity.runtime?.combatAction, "invulnerable", timeMs)) || timeMs < (entity.runtime?.dodgeUntilMs ?? -1);
  }

  private isCombatActionLocked(entity: Entity, timeMs = this.clock.timeMs): boolean {
    return this.isAttackActionLocked(entity, timeMs) || this.isParryActionLocked(entity, timeMs) || this.isDodgeActionLocked(entity, timeMs);
  }

  private isCombatMovementLocked(entity: Entity, timeMs = this.clock.timeMs): boolean {
    return this.isAttackActionLocked(entity, timeMs) || this.isParryActionLocked(entity, timeMs);
  }

  private attackConfig(entity: Entity, kind: AttackKind, chargeStageInput?: number): AttackConfig {
    const stats = combatAttackStatsForEntity(entity, kind, chargeStageInput);
    return {
      kind: stats.kind,
      actionId: stats.action.id,
      actionRuntime: buildCombatActionRuntime(stats.action, this.clock.timeMs),
      startupMs: stats.startupMs,
      activeMs: stats.activeMs,
      recoveryMs: stats.recoveryMs,
      damage: stats.damage,
      hitStunMs: stats.hitStunMs,
      controlLevel: stats.controlLevel,
      armorLevel: stats.armorLevel,
      moveOffsetX: stats.moveOffsetX,
      moveOffsetY: stats.moveOffsetY,
      moveDurationMs: stats.moveDurationMs,
      chargeStage: stats.chargeStage,
    };
  }

  private attackDamage(entity: Entity): number {
    if (typeof entity.runtime?.attackDamage === "number") return entity.runtime.attackDamage;
    const kind = entity.runtime?.attackKind || "normal";
    return entity.runtime?.attackKind ? this.attackConfig(entity, kind, entity.runtime.attackChargeStage).damage : Math.max(1, numberParam(entity, "attackDamage") ?? 1);
  }

  private attackHitStun(entity: Entity): number {
    return this.attackConfig(entity, entity.runtime?.attackKind || "normal", entity.runtime?.attackChargeStage).hitStunMs;
  }

  private attackControlLevel(entity: Entity): number {
    return entity.runtime?.attackControlLevel ?? this.attackConfig(entity, entity.runtime?.attackKind || "normal", entity.runtime?.attackChargeStage).controlLevel;
  }

  private activeAttackState(entity: Entity, timeMs = this.clock.timeMs): ActiveAttackState | undefined {
    if (!this.canUseAttackTouch(entity) || entity.runtime?.defeated || this.isHitStunned(entity, timeMs)) return undefined;
    const activeFrom = entity.runtime?.attackStartMs ?? Number.POSITIVE_INFINITY;
    const activeUntil = entity.runtime?.attackActiveUntilMs ?? -1;
    if (timeMs < activeFrom || timeMs >= activeUntil) return undefined;
    return {
      entity,
      kind: entity.runtime?.attackKind || "normal",
      rect: this.attackTouchBounds(entity),
      controlLevel: this.attackControlLevel(entity),
      armorLevel: this.currentArmorLevel(entity),
    };
  }

  private currentArmorLevel(entity: Entity): number {
    const timeMs = this.clock.timeMs;
    const armorWindow = combatWindowIsOpen(entity.runtime?.combatAction, "armor", timeMs);
    if (armorWindow) return Math.max(0, Math.floor(armorWindow.armorLevel ?? armorWindow.level ?? 0));
    if (timeMs < (entity.runtime?.parryUntilMs ?? -1)) return Math.max(0, Math.floor(numberParam(entity, "parryArmorLevel") ?? 3));
    if (timeMs < (entity.runtime?.attackActiveUntilMs ?? -1) || timeMs < (entity.runtime?.attackStartMs ?? -1)) {
      return Math.max(0, Math.floor(entity.runtime?.attackArmorLevel ?? 0));
    }
    const heldMs = entity.runtime?.chargeHeldMs ?? 0;
    if (heldMs > 0) {
      const threshold = this.chargeThresholdMs(entity);
      const firstArmorMs = Math.max(0, numberParam(entity, "chargeNoArmorMs") ?? legacyFramesToMs(numberParam(entity, "chargeNoArmorFrames")) ?? threshold / 2);
      if (heldMs < firstArmorMs) return 0;
      return heldMs < threshold ? 1 : 2;
    }
    return 0;
  }

  private damageAfterArmor(rawDamage: number, controlLevel: number, armorLevel: number, defender: Entity): { damage: number; resistedDamage: number } {
    if (controlLevel > armorLevel) return { damage: rawDamage, resistedDamage: 0 };
    const k = numberParam(defender, "armorMitigationK") ?? 0.5;
    const diff = Math.max(0, armorLevel - controlLevel);
    const damage = roundDamage(rawDamage * (1 / (2 + k * diff)));
    return { damage, resistedDamage: roundDamage(rawDamage - damage) };
  }

  private triggerScreenShake(magnitude: number, durationMs: number): void {
    const timeMs = this.clock.timeMs;
    if (timeMs >= this.screenShakeUntilMs) this.screenShakeMagnitude = 0;
    this.screenShakeStartedMs = timeMs;
    this.screenShakeUntilMs = Math.max(this.screenShakeUntilMs, timeMs + Math.max(this.clock.fixedStepMs, durationMs));
    this.screenShakeMagnitude = Math.max(this.screenShakeMagnitude, magnitude);
  }

  private beginCharge(entity: Entity): void {
    const timeMs = this.clock.timeMs;
    entity.runtime = {
      ...entity.runtime,
      chargeStartedMs: timeMs,
      chargeHeldMs: 0,
      chargeStartedFrame: this.msToFrame(timeMs),
      chargeHeldFrames: 0,
      chargeStage: 0,
      chargeStoredDamage: entity.runtime?.chargeStoredDamage ?? 0,
    };
    this.emitCombatEvent({
      type: "chargeStarted",
      attackerId: entity.id,
      sourceId: entity.id,
      message: `${entity.displayName} began charging attack.`,
      data: { thresholdMs: this.chargeThresholdMs(entity), stageMs: this.chargeStageMs(entity) },
    });
  }

  private updateCharge(entity: Entity, wasAttackDown: boolean): void {
    const previousHeld = wasAttackDown ? entity.runtime?.chargeHeldMs ?? 0 : 0;
    const heldMs = previousHeld + this.clock.fixedStepMs;
    const stage = heldMs >= this.chargeThresholdMs(entity) ? Math.max(1, Math.floor(heldMs / this.chargeStageMs(entity))) : 0;
    entity.runtime = {
      ...entity.runtime,
      chargeHeldMs: heldMs,
      chargeHeldFrames: this.msToFrame(heldMs),
      chargeStage: stage,
      chargeStartedMs: entity.runtime?.chargeStartedMs ?? this.clock.timeMs,
      chargeStartedFrame: entity.runtime?.chargeStartedFrame ?? this.clock.frame,
    };
  }

  private releaseChargeAttack(entity: Entity): void {
    const heldMs = entity.runtime?.chargeHeldMs ?? 0;
    const chargeStage = heldMs >= this.chargeThresholdMs(entity) ? Math.max(1, Math.floor(heldMs / this.chargeStageMs(entity))) : 0;
    const storedDamage = entity.runtime?.chargeStoredDamage ?? 0;
    const kind: AttackKind = chargeStage > 0 ? "charged" : "normal";
    const started = this.tryStartAttack(entity, { kind, chargeStage });
    this.clearCharge(entity);
    if (started) {
      this.emitCombatEvent({
        type: "chargeReleased",
        attackerId: entity.id,
        sourceId: entity.id,
        message: `${entity.displayName} released ${attackKindLabel(kind)}.`,
        data: { kind, heldMs, chargeStage, storedDamage },
      });
    }
  }

  private tryStartAttack(entity: Entity, options: { kind?: AttackKind; chargeStage?: number } = {}): boolean {
    const timeMs = this.clock.timeMs;
    if (entity.runtime?.defeated || this.isHitStunned(entity, timeMs)) return false;
    const attackCooldownUntil = entity.runtime?.attackCooldownUntilMs ?? -1;
    const attackActiveUntil = entity.runtime?.attackActiveUntilMs ?? -1;
    if (timeMs < attackCooldownUntil || timeMs < attackActiveUntil) return false;
    const config = this.attackConfig(entity, options.kind || "normal", options.chargeStage);
    const activeStartMs = timeMs + config.startupMs;
    const activeUntilMs = activeStartMs + config.activeMs;
    const cooldownUntilMs = timeMs + config.startupMs + config.activeMs + config.recoveryMs;
    if (config.kind === "superParry") {
      entity.runtime = {
        ...entity.runtime,
        superParryUntilMs: undefined,
        superParryLockUntilMs: undefined,
        superParryUntilFrame: undefined,
        superParryLockUntilFrame: undefined,
        superParryBonusDamage: undefined,
      };
    }
    const direction = entity.runtime?.facing === -1 ? -1 : 1;
    const hasMove = config.moveDurationMs > 0 && (Math.abs(config.moveOffsetX) > 0.001 || Math.abs(config.moveOffsetY) > 0.001);
    const moveUntilMs = hasMove ? timeMs + config.moveDurationMs : undefined;
    const moveTargetX = hasMove ? entity.transform.position.x + direction * config.moveOffsetX : undefined;
    const moveTargetY = hasMove ? entity.transform.position.y + config.moveOffsetY : undefined;
    entity.runtime = {
      ...entity.runtime,
      attackStartMs: activeStartMs,
      attackActiveUntilMs: activeUntilMs,
      attackCooldownUntilMs: cooldownUntilMs,
      attackStartFrame: this.msToFrame(activeStartMs),
      attackActiveUntilFrame: this.msToFrame(activeUntilMs - this.clock.fixedStepMs),
      attackCooldownUntilFrame: this.msToFrame(cooldownUntilMs),
      attackHitIds: [],
      attackTouchEntityId: undefined,
      attackMoveStartedMs: hasMove ? timeMs : undefined,
      attackMoveUntilMs: moveUntilMs,
      attackMoveOffsetX: hasMove ? config.moveOffsetX : undefined,
      attackMoveOffsetY: hasMove ? config.moveOffsetY : undefined,
      attackMoveTargetX: moveTargetX,
      attackMoveTargetY: moveTargetY,
      attackMovementTargetEntityId: undefined,
      attackKind: config.kind,
      attackDamage: config.damage,
      attackControlLevel: config.controlLevel,
      attackArmorLevel: config.armorLevel,
      attackChargeStage: config.chargeStage,
      combatAction: config.actionRuntime,
    };
    this.emitCombatEvent({
      type: "attackStarted",
      attackerId: entity.id,
      sourceId: entity.id,
      message: `${entity.displayName} started ${attackKindLabel(config.kind)}.`,
      data: {
        actionId: config.actionId,
        kind: config.kind,
        startupMs: config.startupMs,
        activeMs: config.activeMs,
        recoveryMs: config.recoveryMs,
        cooldownMs: config.startupMs + config.activeMs + config.recoveryMs,
        activeStartMs,
        activeUntilMs,
        cooldownUntilMs,
        startup: this.msToFrame(config.startupMs),
        active: this.msToFrame(config.activeMs),
        recovery: this.msToFrame(config.recoveryMs),
        cooldown: this.msToFrame(config.startupMs + config.activeMs + config.recoveryMs),
        activeStartFrame: this.msToFrame(activeStartMs),
        activeUntilFrame: this.msToFrame(activeUntilMs - this.clock.fixedStepMs),
        cooldownUntilFrame: this.msToFrame(cooldownUntilMs),
        damage: config.damage,
        hitStunMs: config.hitStunMs,
        hitStun: this.msToFrame(config.hitStunMs),
        controlLevel: config.controlLevel,
        armorLevel: config.armorLevel,
        moveOffsetX: config.moveOffsetX,
        moveOffsetY: config.moveOffsetY,
        moveDurationMs: config.moveDurationMs,
        moveTargetX,
        moveTargetY,
        chargeStage: config.chargeStage,
        phases: cloneJson(config.actionRuntime.phases),
        windows: cloneJson(config.actionRuntime.windows),
      },
    });
    if (hasMove) this.applyAttackMovement(entity, timeMs);
    return true;
  }

  private tryStartDodge(entity: Entity): boolean {
    const timeMs = this.clock.timeMs;
    if (entity.runtime?.defeated || this.isHitStunned(entity, timeMs)) return false;
    if (this.isCombatActionLocked(entity, timeMs)) return false;
    const action = combatActionDefForEntity(entity, "dodge");
    const actionRuntime = buildCombatActionRuntime(action, timeMs);
    const evadeMs = Math.max(1, combatPhaseDurationMs(action, "evade"));
    const recoveryMs = Math.max(0, combatPhaseDurationMs(action, "recovery"));
    const cooldownMs = combatActionTotalDurationMs(action);
    const speed = this.dodgeSpeed(entity, action);
    const direction = entity.runtime?.facing === -1 ? -1 : 1;
    if (entity.body) entity.body.velocity.x = speed * direction;
    entity.runtime = {
      ...entity.runtime,
      combatAction: actionRuntime,
      dodgeStartedMs: timeMs,
      dodgeUntilMs: timeMs + evadeMs,
      dodgeRecoveryUntilMs: timeMs + cooldownMs,
      dodgeStartedFrame: this.msToFrame(timeMs),
      dodgeUntilFrame: this.msToFrame(timeMs + evadeMs - this.clock.fixedStepMs),
      dodgeRecoveryUntilFrame: this.msToFrame(timeMs + cooldownMs),
      attackTouchEntityId: undefined,
    };
    this.emitCombatEvent({
      type: "dodgeStarted",
      sourceId: entity.id,
      targetId: entity.id,
      message: `${entity.displayName} started dodge.`,
      data: {
        actionId: action.id,
        evadeMs,
        recoveryMs,
        cooldownMs,
        evadeFrames: this.msToFrame(evadeMs),
        recoveryFrames: this.msToFrame(recoveryMs),
        cooldown: this.msToFrame(cooldownMs),
        speed,
        direction,
        phases: cloneJson(actionRuntime.phases),
        windows: cloneJson(actionRuntime.windows),
      },
    });
    return true;
  }

  private tryStartParry(entity: Entity, options: { fromCharge?: boolean } = {}): boolean {
    const timeMs = this.clock.timeMs;
    if (entity.runtime?.defeated || this.isHitStunned(entity, timeMs)) return false;
    if (!options.fromCharge && this.isAttackActionLocked(entity, timeMs)) return false;
    if (this.isParryActionLocked(entity, timeMs)) return false;
    const parryCooldownUntil = entity.runtime?.parryCooldownUntilMs ?? -1;
    if (timeMs < parryCooldownUntil) return false;
    const action = combatActionDefForEntity(entity, "parry");
    const actionRuntime = buildCombatActionRuntime(action, timeMs);
    const windowMs = Math.max(1, combatPhaseDurationMs(action, "active"));
    const recoveryMs = Math.max(0, combatPhaseDurationMs(action, "recovery"));
    const cooldownMs = windowMs + recoveryMs;
    const animationMs = Math.max(1, numberParam(entity, "parryAnimationMs") ?? legacyFramesToMs(numberParam(entity, "parryAnimationFrames")) ?? cooldownMs);
    entity.runtime = {
      ...entity.runtime,
      combatAction: actionRuntime,
      parryStartedMs: timeMs,
      parryAnimationUntilMs: timeMs + animationMs,
      parryUntilMs: timeMs + windowMs,
      parryRecoveryUntilMs: timeMs + cooldownMs,
      parryCooldownUntilMs: timeMs + cooldownMs,
      parryStartedFrame: this.msToFrame(timeMs),
      parryAnimationUntilFrame: this.msToFrame(timeMs + animationMs - this.clock.fixedStepMs),
      parryUntilFrame: this.msToFrame(timeMs + windowMs - this.clock.fixedStepMs),
      parryRecoveryUntilFrame: this.msToFrame(timeMs + cooldownMs),
      parryCooldownUntilFrame: this.msToFrame(timeMs + cooldownMs),
    };
    this.emitCombatEvent({
      type: "parryStarted",
      defenderId: entity.id,
      sourceId: entity.id,
      message: `${entity.displayName} opened shock parry window.`,
      data: {
        actionId: action.id,
        windowMs,
        recoveryMs,
        cooldownMs,
        animationMs,
        windowFrames: this.msToFrame(windowMs),
        recoveryFrames: this.msToFrame(recoveryMs),
        cooldown: this.msToFrame(cooldownMs),
        animationFrames: this.msToFrame(animationMs),
        fromCharge: options.fromCharge === true,
        armorLevel: numberParam(entity, "parryArmorLevel") ?? 3,
        controlLevel: numberParam(entity, "parryControlLevel") ?? 3,
        phases: cloneJson(actionRuntime.phases),
        windows: cloneJson(actionRuntime.windows),
      },
    });
    return true;
  }

  private resolveCombatEvents(): void {
    const timeMs = this.clock.timeMs;
    const entities = this.allEntities();
    const clashedIds = this.resolveAttackClashes(entities, timeMs);
    for (const attacker of entities) {
      if (clashedIds.has(attacker.id)) continue;
      if (!this.canUseAttackTouch(attacker)) continue;
      if (attacker.runtime?.defeated || this.isHitStunned(attacker, timeMs)) continue;
      const activeFrom = attacker.runtime?.attackStartMs ?? Number.POSITIVE_INFINITY;
      const activeUntil = attacker.runtime?.attackActiveUntilMs ?? -1;
      if (timeMs < activeFrom || timeMs >= activeUntil) continue;

      const hitIds = new Set(attacker.runtime?.attackHitIds || []);
      const attackArea = this.attackTouchBounds(attacker);
      const attackKind = attacker.runtime?.attackKind || "normal";
      const rawDamage = this.attackDamage(attacker);
      const controlLevel = this.attackControlLevel(attacker);
      const hitStunMs = this.attackHitStun(attacker);
      this.syncAttackTouchEntity(attacker, attackArea);
      for (const defender of entities) {
        if (hitIds.has(defender.id) || !this.canReceiveAttackTouch(attacker, defender)) continue;
        if (!entityIntersectsRect(defender, attackArea)) continue;

        hitIds.add(defender.id);
        this.emitCombatEvent({
          type: "attackTouch",
          attackerId: attacker.id,
          defenderId: defender.id,
          sourceId: attacker.id,
          targetId: defender.id,
          message: `${attacker.displayName} 的普通攻击触摸到 ${defender.displayName}。`,
          data: {
            actionId: combatActionIdForAttackKind(attackKind),
            kind: attackKind,
            phase: "active",
            window: "hitbox",
            rect: cloneJson(attackArea),
            controlLevel,
          },
        });
        const parryUntil = defender.runtime?.parryUntilMs ?? -1;
        const parryControlLevel = numberParam(defender, "parryControlLevel") ?? 3;
        if (timeMs < parryUntil && controlLevel <= parryControlLevel) {
          this.resolveParrySuccess(attacker, defender, hitIds, { attackKind, rawDamage, controlLevel });
          continue;
        }

        const armorLevel = this.currentArmorLevel(defender);
        const damageResult = this.damageAfterArmor(rawDamage, controlLevel, armorLevel, defender);
        if (damageResult.resistedDamage > 0 && (defender.runtime?.chargeHeldMs ?? 0) > 0) {
          defender.runtime = {
            ...defender.runtime,
            chargeStoredDamage: (defender.runtime?.chargeStoredDamage ?? 0) + damageResult.resistedDamage,
          };
        }
        const currentHealth = defender.runtime?.health ?? numberParam(defender, "health") ?? 1;
        const nextHealth = Math.max(0, currentHealth - damageResult.damage);
        const stunned = damageResult.damage > 0 && controlLevel > armorLevel && hitStunMs > 0;
        defender.runtime = {
          ...defender.runtime,
          health: nextHealth,
          hitFlashUntilMs: timeMs + (numberParam(defender, "hitFlashMs") ?? legacyFramesToMs(numberParam(defender, "hitFlashFrames")) ?? 80),
          hitFlashUntilFrame: this.msToFrame(timeMs + (numberParam(defender, "hitFlashMs") ?? legacyFramesToMs(numberParam(defender, "hitFlashFrames")) ?? 80)),
          hitStunUntilMs: stunned ? Math.max(defender.runtime?.hitStunUntilMs ?? -1, timeMs + hitStunMs) : defender.runtime?.hitStunUntilMs,
          hitStunUntilFrame: stunned ? this.msToFrame(Math.max(defender.runtime?.hitStunUntilMs ?? -1, timeMs + hitStunMs)) : defender.runtime?.hitStunUntilFrame,
        };
        if (stunned) {
          this.stopEntity(defender);
          this.clearActiveAttack(defender);
          this.clearCharge(defender);
          this.clearDodge(defender);
        }
        attacker.runtime = { ...attacker.runtime, attackHitIds: [...hitIds] };
        this.emitCombatEvent({
          type: "hit",
          attackerId: attacker.id,
          defenderId: defender.id,
          sourceId: attacker.id,
          targetId: defender.id,
          message: `${attacker.displayName} hit ${defender.displayName}.`,
          data: {
            kind: attackKind,
            health: nextHealth,
            damage: damageResult.damage,
            rawDamage,
            resistedDamage: damageResult.resistedDamage,
            controlLevel,
            armorLevel,
            stunned,
            hitStunMs: stunned ? hitStunMs : 0,
            hitStunFrames: stunned ? this.msToFrame(hitStunMs) : 0,
            chargeStage: attacker.runtime?.attackChargeStage,
          },
        });
        if (nextHealth <= 0) this.defeatEntity(defender, attacker);
      }
      attacker.runtime = { ...attacker.runtime, attackHitIds: [...hitIds] };
    }
  }

  private resolveAttackClashes(entities: Entity[], timeMs: number): Set<EntityId> {
    const active = entities
      .map((entity) => this.activeAttackState(entity, timeMs))
      .filter((state): state is ActiveAttackState => Boolean(state));
    const clashedIds = new Set<EntityId>();
    for (let i = 0; i < active.length; i += 1) {
      const a = active[i];
      if (clashedIds.has(a.entity.id)) continue;
      for (let j = i + 1; j < active.length; j += 1) {
        const b = active[j];
        if (clashedIds.has(b.entity.id)) continue;
        if (!overlaps(a.rect, b.rect)) continue;
        if (!this.attacksCanClash(a, b)) continue;
        this.resolveAttackClash(a, b);
        clashedIds.add(a.entity.id);
        clashedIds.add(b.entity.id);
        break;
      }
    }
    return clashedIds;
  }

  private attacksCanClash(a: ActiveAttackState, b: ActiveAttackState): boolean {
    return a.controlLevel <= b.armorLevel && b.controlLevel <= a.armorLevel;
  }

  private resolveAttackClash(a: ActiveAttackState, b: ActiveAttackState): void {
    const shakeMs = Math.max(this.clock.fixedStepMs, numberParam(a.entity, "attackClashShakeMs") ?? numberParam(b.entity, "attackClashShakeMs") ?? 120);
    const shakeMagnitude = Math.max(0, numberParam(a.entity, "attackClashShakeMagnitude") ?? numberParam(b.entity, "attackClashShakeMagnitude") ?? 6);
    const recoveryMs = Math.max(this.clock.fixedStepMs, numberParam(a.entity, "attackClashRecoveryMs") ?? numberParam(b.entity, "attackClashRecoveryMs") ?? 120);
    this.syncAttackTouchEntity(a.entity, a.rect);
    this.syncAttackTouchEntity(b.entity, b.rect);
    this.stopEntity(a.entity);
    this.stopEntity(b.entity);
    this.clearActiveAttack(a.entity);
    this.clearActiveAttack(b.entity);
    a.entity.runtime = {
      ...a.entity.runtime,
      attackCooldownUntilMs: this.clock.timeMs + recoveryMs,
      attackCooldownUntilFrame: this.msToFrame(this.clock.timeMs + recoveryMs),
    };
    b.entity.runtime = {
      ...b.entity.runtime,
      attackCooldownUntilMs: this.clock.timeMs + recoveryMs,
      attackCooldownUntilFrame: this.msToFrame(this.clock.timeMs + recoveryMs),
    };
    this.triggerScreenShake(shakeMagnitude, shakeMs);
    this.emitCombatEvent({
      type: "attackClash",
      attackerId: a.entity.id,
      defenderId: b.entity.id,
      sourceId: a.entity.id,
      targetId: b.entity.id,
      message: `${a.entity.displayName} and ${b.entity.displayName} clashed and interrupted each other.`,
      data: {
        interrupted: true,
        aKind: a.kind,
        bKind: b.kind,
        aControlLevel: a.controlLevel,
        bControlLevel: b.controlLevel,
        aArmorLevel: a.armorLevel,
        bArmorLevel: b.armorLevel,
        shakeMs,
        shakeMagnitude,
        recoveryMs,
        aRect: cloneJson(a.rect),
        bRect: cloneJson(b.rect),
      },
    });
  }

  private resolveParrySuccess(
    attacker: Entity,
    defender: Entity,
    hitIds: Set<EntityId>,
    attack: { attackKind: AttackKind; rawDamage: number; controlLevel: number },
  ): void {
    const timeMs = this.clock.timeMs;
    const charged = attack.attackKind === "charged";
    const stunMs = charged
      ? numberParam(attacker, "chargedParryStunMs") ?? numberParam(defender, "chargedParryStunMs") ?? legacyFramesToMs(numberParam(attacker, "chargedParryStunFrames") ?? numberParam(defender, "chargedParryStunFrames") ?? 120)
      : numberParam(attacker, "parryShockStunMs") ?? numberParam(attacker, "parryStunMs") ?? legacyFramesToMs(numberParam(attacker, "parryShockStunFrames") ?? numberParam(attacker, "parryStunFrames") ?? 14);
    const superMs = numberParam(defender, "superParryMs") ?? legacyFramesToMs(numberParam(defender, "superParryFrames") ?? 200);
    const lockMs = numberParam(defender, "superParryLockMs") ?? legacyFramesToMs(numberParam(defender, "superParryLockFrames") ?? 50);
    const bonusMultiplier = numberParam(defender, "superParryDamageMultiplier") ?? 2;
    const bonusDamage = roundDamage(attack.rawDamage * bonusMultiplier);

    attacker.runtime = {
      ...attacker.runtime,
      hitStunUntilMs: timeMs + stunMs,
      hitFlashUntilMs: timeMs + Math.max(30, stunMs / 2),
      hitStunUntilFrame: this.msToFrame(timeMs + stunMs),
      hitFlashUntilFrame: this.msToFrame(timeMs + Math.max(30, stunMs / 2)),
      attackStartMs: undefined,
      attackActiveUntilMs: undefined,
      attackCooldownUntilMs: undefined,
      attackMoveStartedMs: undefined,
      attackMoveUntilMs: undefined,
      attackMoveOffsetX: undefined,
      attackMoveOffsetY: undefined,
      attackMoveTargetX: undefined,
      attackMoveTargetY: undefined,
      attackMovementTargetEntityId: undefined,
      attackStartFrame: undefined,
      attackActiveUntilFrame: undefined,
      attackHitIds: [...hitIds],
      attackTouchEntityId: undefined,
      attackKind: undefined,
      attackDamage: undefined,
      attackControlLevel: undefined,
      attackArmorLevel: undefined,
      attackChargeStage: undefined,
      combatAction: undefined,
    };
    defender.runtime = {
      ...defender.runtime,
      combatAction: undefined,
      parryUntilMs: undefined,
      parryRecoveryUntilMs: undefined,
      parryUntilFrame: undefined,
      parryRecoveryUntilFrame: undefined,
      superParryUntilMs: timeMs + superMs,
      superParryLockUntilMs: timeMs + lockMs,
      superParryUntilFrame: this.msToFrame(timeMs + superMs),
      superParryLockUntilFrame: this.msToFrame(timeMs + lockMs),
      superParryBonusDamage: bonusDamage,
      hitFlashUntilMs: timeMs + Math.max(40, lockMs / 4),
      hitFlashUntilFrame: this.msToFrame(timeMs + Math.max(40, lockMs / 4)),
    };
    this.emitCombatEvent({
      type: "parrySuccess",
      attackerId: attacker.id,
      defenderId: defender.id,
      sourceId: defender.id,
      targetId: attacker.id,
      message: `${defender.displayName} shocked ${attacker.displayName}'s ${attackKindLabel(attack.attackKind)} aside.`,
      data: { stunMs, stunFrames: this.msToFrame(stunMs), kind: attack.attackKind, controlLevel: attack.controlLevel, charged, bonusDamage },
    });
    this.emitCombatEvent({
      type: "superParryReady",
      attackerId: defender.id,
      defenderId: attacker.id,
      sourceId: defender.id,
      targetId: attacker.id,
      message: `${defender.displayName} entered super parry counter window.`,
      data: { superMs, lockMs, superFrames: this.msToFrame(superMs), lockFrames: this.msToFrame(lockMs), bonusDamage },
    });
  }

  private attackTouchBounds(entity: Entity): Rect {
    return combatAttackRectForEntity(entity);
  }

  private canUseAttackTouch(entity: Entity): boolean {
    if (entity.kind !== "entity" || !entity.collider) return false;
    return Boolean(entity.behavior?.builtin === "playerPlatformer" || entity.behavior?.builtin === "enemyPatrol");
  }

  private canReceiveAttackTouch(attacker: Entity, defender: Entity): boolean {
    if (defender.id === attacker.id || defender.kind !== "entity" || !defender.collider) return false;
    if (defender.runtime?.defeated) return false;
    if (this.isDodgeInvulnerable(defender)) return false;
    if (defender.body?.mode !== "dynamic" && defender.body?.mode !== "kinematic") return false;
    return hasHealth(defender);
  }

  private syncAttackTouchEntity(attacker: Entity, rect: Rect): void {
    const existingId = attacker.runtime?.attackTouchEntityId;
    const existing = existingId ? this.transientEntities.get(existingId) : undefined;
    const lifetimeMs = Math.max(this.clock.fixedStepMs * 2, numberParam(attacker, "attackTouchVisibleMs") ?? 220);
    if (existing) {
      existing.transform.position = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      if (existing.render) {
        existing.render.size = { x: rect.w, y: rect.h };
        existing.render.opacity = 0.32;
      }
      if (existing.collider) existing.collider.size = { x: rect.w, y: rect.h };
      existing.runtime = {
        ...existing.runtime,
        ageMs: 0,
        lifetimeMs,
        attackKind: attacker.runtime?.attackKind,
        attackControlLevel: attacker.runtime?.attackControlLevel,
        attackArmorLevel: attacker.runtime?.attackArmorLevel,
        combatAction: attacker.runtime?.combatAction,
      };
      return;
    }

    const touchEntity: Entity = {
      id: makeId<"EntityId">("touch") as EntityId,
      internalName: "Attack_Touch_Box",
      displayName: "普通攻击触摸盒",
      kind: "effect",
      persistent: false,
      parentId: attacker.id,
      folderId: "runtime",
      transform: {
        position: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
      render: {
        visible: true,
        color: "#ff4d5d",
        opacity: 0.32,
        layerId: attacker.render?.layerId || "world",
        size: { x: rect.w, y: rect.h },
        offset: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
      body: {
        mode: "none",
        velocity: { x: 0, y: 0 },
        gravityScale: 0,
        friction: 0,
        bounce: 0,
      },
      collider: {
        shape: "box",
        size: { x: rect.w, y: rect.h },
        solid: false,
        trigger: true,
        layerMask: ["combat-touch"],
      },
      resources: [],
      tags: ["runtime", "attack", "touch"],
      runtime: {
        ageMs: 0,
        lifetimeMs,
        attackKind: attacker.runtime?.attackKind,
        attackControlLevel: attacker.runtime?.attackControlLevel,
        attackArmorLevel: attacker.runtime?.attackArmorLevel,
        combatAction: attacker.runtime?.combatAction,
      },
    };
    const touchId = this.spawnTransient(touchEntity, lifetimeMs);
    attacker.runtime = { ...attacker.runtime, attackTouchEntityId: touchId };
  }

  private syncAttackMovementTargetEntity(attacker: Entity): void {
    const targetX = attacker.runtime?.attackMoveTargetX;
    const targetY = attacker.runtime?.attackMoveTargetY;
    if (typeof targetX !== "number" || typeof targetY !== "number") return;
    const existingId = attacker.runtime?.attackMovementTargetEntityId;
    const existing = existingId ? this.transientEntities.get(existingId) : undefined;
    const lifetimeMs = Math.max(this.clock.fixedStepMs * 2, numberParam(attacker, "attackMovementTargetVisibleMs") ?? 520);
    if (existing) {
      existing.transform.position = { x: targetX, y: targetY };
      existing.runtime = {
        ...existing.runtime,
        ageMs: 0,
        lifetimeMs,
        attackKind: attacker.runtime?.attackKind,
        combatAction: attacker.runtime?.combatAction,
      };
      return;
    }

    const markerSize = Math.max(10, numberParam(attacker, "attackMovementTargetSize") ?? 16);
    const targetEntity: Entity = {
      id: makeId<"EntityId">("move-target") as EntityId,
      internalName: "Attack_Movement_Target",
      displayName: "普通攻击位移目标",
      kind: "effect",
      persistent: false,
      parentId: attacker.id,
      folderId: "runtime",
      transform: {
        position: { x: targetX, y: targetY },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
      render: {
        visible: true,
        color: "#54d87b",
        opacity: 0.92,
        layerId: attacker.render?.layerId || "world",
        size: { x: markerSize, y: markerSize },
        offset: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
      body: {
        mode: "none",
        velocity: { x: 0, y: 0 },
        gravityScale: 0,
        friction: 0,
        bounce: 0,
      },
      collider: {
        shape: "box",
        size: { x: markerSize, y: markerSize },
        solid: false,
        trigger: true,
        layerMask: ["combat-movement"],
      },
      resources: [],
      tags: ["runtime", "attack", "movement-target"],
      runtime: {
        ageMs: 0,
        lifetimeMs,
        attackKind: attacker.runtime?.attackKind,
        combatAction: attacker.runtime?.combatAction,
      },
    };
    const targetId = this.spawnTransient(targetEntity, lifetimeMs);
    attacker.runtime = { ...attacker.runtime, attackMovementTargetEntityId: targetId };
  }

  private updateCombatPresentationStates(): void {
    const timeMs = this.clock.timeMs;
    for (const entity of this.allEntities()) {
      if (!entity.render) continue;
      const slot = entity.runtime?.defeated
        ? "death"
        : timeMs < (entity.runtime?.parryAnimationUntilMs ?? -1)
          ? "parry"
          : this.isAttackAnimating(entity, timeMs)
            ? "attack"
            : "current";
      this.applyPresentationSlot(entity, slot);
    }
  }

  private isAttackAnimating(entity: Entity, timeMs: number): boolean {
    const start = entity.runtime?.attackStartMs;
    const cooldownUntil = entity.runtime?.attackCooldownUntilMs;
    return typeof start === "number" && typeof cooldownUntil === "number" && timeMs >= start && timeMs < cooldownUntil;
  }

  private applyPresentationSlot(entity: Entity, slot: string): void {
    if (!entity.render) return;
    const binding = entity.resources.find((item) => item.slot === slot);
    if (!binding) {
      if (slot === "current") entity.render = { ...entity.render, slot: "current", state: "current" };
      return;
    }
    entity.render = {
      ...entity.render,
      slot,
      state: slot,
      resourceId: binding.resourceId,
    };
  }

  private emitCombatEvent(event: Omit<CombatEvent, "id" | "frame" | "timeMs">): CombatEvent {
    const next: CombatEvent = {
      ...event,
      id: `combat-${this.combatEvents.length + 1}-${Date.now().toString(36)}`,
      frame: this.clock.frame,
      timeMs: this.clock.timeMs,
    };
    this.combatEvents.push(next);
    return next;
  }

  private defeatEntity(entity: Entity, source: Entity): void {
    if (entity.runtime?.defeated) return;
    const timeMs = this.clock.timeMs;
    entity.runtime = {
      ...entity.runtime,
      defeated: true,
      defeatTimeMs: timeMs,
      defeatFrame: this.clock.frame,
      health: 0,
      hitFlashUntilMs: timeMs + 120,
      hitFlashUntilFrame: this.msToFrame(timeMs + 120),
    };
    this.stopEntity(entity);
    this.clearActiveAttack(entity);
    this.clearCharge(entity);
    this.clearDodge(entity);
    this.emitCombatEvent({
      type: "defeated",
      attackerId: source.id,
      defenderId: entity.id,
      sourceId: source.id,
      targetId: entity.id,
      message: `${entity.displayName} was defeated by ${source.displayName}.`,
      data: { defeated: true },
    });
  }

  private stopEntity(entity: Entity): void {
    if (!entity.body) return;
    entity.body.velocity.x = 0;
    if (entity.body.mode === "kinematic") entity.body.velocity.y = 0;
  }

  private clearActiveAttack(entity: Entity): void {
    entity.runtime = {
      ...entity.runtime,
      attackStartMs: undefined,
      attackActiveUntilMs: undefined,
      attackCooldownUntilMs: undefined,
      attackMoveStartedMs: undefined,
      attackMoveUntilMs: undefined,
      attackMoveOffsetX: undefined,
      attackMoveOffsetY: undefined,
      attackMoveTargetX: undefined,
      attackMoveTargetY: undefined,
      attackMovementTargetEntityId: undefined,
      attackStartFrame: undefined,
      attackActiveUntilFrame: undefined,
      attackCooldownUntilFrame: undefined,
      attackHitIds: entity.runtime?.attackHitIds || [],
      attackTouchEntityId: undefined,
      attackKind: undefined,
      attackDamage: undefined,
      attackControlLevel: undefined,
      attackArmorLevel: undefined,
      attackChargeStage: undefined,
      combatAction: isAttackCombatAction(entity.runtime?.combatAction?.actionId) ? undefined : entity.runtime?.combatAction,
    };
  }

  private clearCharge(entity: Entity): void {
    entity.runtime = {
      ...entity.runtime,
      chargeStartedMs: undefined,
      chargeHeldMs: undefined,
      chargeStartedFrame: undefined,
      chargeHeldFrames: undefined,
      chargeStage: undefined,
      chargeStoredDamage: undefined,
    };
  }

  private clearDodge(entity: Entity): void {
    entity.runtime = {
      ...entity.runtime,
      dodgeStartedMs: undefined,
      dodgeUntilMs: undefined,
      dodgeRecoveryUntilMs: undefined,
      dodgeStartedFrame: undefined,
      dodgeUntilFrame: undefined,
      dodgeRecoveryUntilFrame: undefined,
      combatAction: entity.runtime?.combatAction?.actionId === "dodge" ? undefined : entity.runtime?.combatAction,
    };
  }

  private isHitStunned(entity: Entity, timeMs: number): boolean {
    return timeMs < (entity.runtime?.hitStunUntilMs ?? -1);
  }

  private msToFrame(timeMs: number): number {
    return Math.max(0, Math.round(timeMs / this.clock.fixedStepMs));
  }

  private findEntityByInternalName(internalName: string): Entity | undefined {
    return this.allEntities().find((entity) => entity.internalName === internalName);
  }

  private isInputDown(entity: Entity, key: string, ...aliases: string[]): boolean {
    const scoped = this.actorInput[entity.id] || {};
    return [key, ...aliases].some((candidate) => Boolean(scoped[candidate] || this.input[candidate]));
  }

  private cleanupExpiredTransients(): void {
    let removed = false;
    for (const [id, entity] of this.transientEntities) {
      const lifetimeMs = entity.runtime?.lifetimeMs;
      const ageMs = entity.runtime?.ageMs ?? 0;
      if (lifetimeMs !== undefined && ageMs >= lifetimeMs) {
        this.transientEntities.delete(id);
        removed = true;
      }
    }
    if (removed) this.invalidateEntityListCache();
  }

  private normalizeRuntime(entity: Entity): void {
    const initialDirection = entity.runtime?.patrolDirection ?? (entity.body && entity.body.velocity.x < 0 ? -1 : 1);
    const lifetimeMs = entity.runtime?.lifetimeMs ?? numberParam(entity, "lifetimeMs") ?? numberParam(entity, "ttlMs");
    entity.runtime = {
      ...entity.runtime,
      ageMs: entity.runtime?.ageMs ?? 0,
      lifetimeMs,
      grounded: entity.runtime?.grounded ?? false,
      wasGrounded: entity.runtime?.wasGrounded ?? false,
      patrolDirection: initialDirection,
      facing: entity.runtime?.facing ?? initialDirection,
      health: entity.runtime?.health ?? numberParam(entity, "health"),
      defeated: entity.runtime?.defeated ?? false,
      hitFlashUntilMs: entity.runtime?.hitFlashUntilMs ?? legacyFramesToMs(entity.runtime?.hitFlashUntilFrame),
      defeatTimeMs: entity.runtime?.defeatTimeMs ?? legacyFramesToMs(entity.runtime?.defeatFrame),
      hitFlashUntilFrame: entity.runtime?.hitFlashUntilFrame,
      defeatFrame: entity.runtime?.defeatFrame,
      combatAction: combatActionRuntimeFromValue(entity.runtime?.combatAction),
      attackStartMs: entity.runtime?.attackStartMs ?? legacyFramesToMs(entity.runtime?.attackStartFrame),
      attackActiveUntilMs: entity.runtime?.attackActiveUntilMs ?? legacyFramesToMs(entity.runtime?.attackActiveUntilFrame),
      attackCooldownUntilMs: entity.runtime?.attackCooldownUntilMs ?? legacyFramesToMs(entity.runtime?.attackCooldownUntilFrame),
      attackMovementTargetEntityId: entity.runtime?.attackMovementTargetEntityId,
      attackMoveStartedMs: entity.runtime?.attackMoveStartedMs,
      attackMoveUntilMs: entity.runtime?.attackMoveUntilMs,
      attackMoveOffsetX: entity.runtime?.attackMoveOffsetX,
      attackMoveOffsetY: entity.runtime?.attackMoveOffsetY,
      attackMoveTargetX: entity.runtime?.attackMoveTargetX,
      attackMoveTargetY: entity.runtime?.attackMoveTargetY,
      attackKind: attackKindFromValue(entity.runtime?.attackKind),
      attackInputDown: entity.runtime?.attackInputDown ?? false,
      attackConsumedUntilRelease: entity.runtime?.attackConsumedUntilRelease ?? false,
      parryInputDown: entity.runtime?.parryInputDown ?? false,
      dodgeInputDown: entity.runtime?.dodgeInputDown ?? false,
      dodgeStartedMs: entity.runtime?.dodgeStartedMs ?? legacyFramesToMs(entity.runtime?.dodgeStartedFrame),
      dodgeUntilMs: entity.runtime?.dodgeUntilMs ?? legacyFramesToMs(entity.runtime?.dodgeUntilFrame),
      dodgeRecoveryUntilMs: entity.runtime?.dodgeRecoveryUntilMs ?? legacyFramesToMs(entity.runtime?.dodgeRecoveryUntilFrame),
      dodgeStartedFrame: entity.runtime?.dodgeStartedFrame,
      dodgeUntilFrame: entity.runtime?.dodgeUntilFrame,
      dodgeRecoveryUntilFrame: entity.runtime?.dodgeRecoveryUntilFrame,
      chargeStartedMs: entity.runtime?.chargeStartedMs ?? legacyFramesToMs(entity.runtime?.chargeStartedFrame),
      chargeHeldMs: entity.runtime?.chargeHeldMs ?? legacyFramesToMs(entity.runtime?.chargeHeldFrames),
      parryStartedMs: entity.runtime?.parryStartedMs ?? legacyFramesToMs(entity.runtime?.parryStartedFrame),
      parryAnimationUntilMs: entity.runtime?.parryAnimationUntilMs ?? legacyFramesToMs(entity.runtime?.parryAnimationUntilFrame),
      parryUntilMs: entity.runtime?.parryUntilMs ?? legacyFramesToMs(entity.runtime?.parryUntilFrame),
      parryRecoveryUntilMs: entity.runtime?.parryRecoveryUntilMs ?? legacyFramesToMs(entity.runtime?.parryRecoveryUntilFrame),
      parryCooldownUntilMs: entity.runtime?.parryCooldownUntilMs ?? legacyFramesToMs(entity.runtime?.parryCooldownUntilFrame),
      parryStartedFrame: entity.runtime?.parryStartedFrame,
      parryAnimationUntilFrame: entity.runtime?.parryAnimationUntilFrame,
      parryRecoveryUntilFrame: entity.runtime?.parryRecoveryUntilFrame,
      superParryUntilMs: entity.runtime?.superParryUntilMs ?? legacyFramesToMs(entity.runtime?.superParryUntilFrame),
      superParryLockUntilMs: entity.runtime?.superParryLockUntilMs ?? legacyFramesToMs(entity.runtime?.superParryLockUntilFrame),
      hitStunUntilMs: entity.runtime?.hitStunUntilMs ?? legacyFramesToMs(entity.runtime?.hitStunUntilFrame),
    };
  }

  private runtimeFlags(entity: Entity): RuntimeEntityFlags {
    const direction = entity.runtime?.patrolDirection === -1 ? -1 : 1;
    return {
      grounded: Boolean(entity.runtime?.grounded),
      wasGrounded: Boolean(entity.runtime?.wasGrounded ?? entity.runtime?.grounded),
      ageMs: entity.runtime?.ageMs ?? 0,
      lifetimeMs: entity.runtime?.lifetimeMs,
      patrolDirection: direction,
    };
  }

  private invalidateEntityListCache(): void {
    this.entityListCache = undefined;
  }
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

function legacyFramesToMs(frames: number): number;
function legacyFramesToMs(frames: number | undefined): number | undefined;
function legacyFramesToMs(frames: number | undefined): number | undefined {
  return typeof frames === "number" && Number.isFinite(frames) ? frames * 10 : undefined;
}

function runtimeStateMs(state: Record<string, unknown>, msKey: string, legacyFrameKey: string): number | undefined {
  const ms = state[msKey];
  if (typeof ms === "number" && Number.isFinite(ms)) return ms;
  const frames = state[legacyFrameKey];
  return typeof frames === "number" && Number.isFinite(frames) ? legacyFramesToMs(frames) : undefined;
}

function attackKindFromValue(value: unknown): AttackKind | undefined {
  return value === "normal" || value === "charged" || value === "superParry" ? value : undefined;
}

function combatActionRuntimeFromValue(value: unknown): CombatActionRuntime | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<CombatActionRuntime>;
  if (!isCombatActionId(candidate.actionId)) return undefined;
  if (!Array.isArray(candidate.phases) || !Array.isArray(candidate.windows)) return undefined;
  const legacy = value as {
    startedFrame?: unknown;
    phases?: Array<{ startsAtFrame?: unknown; untilFrame?: unknown }>;
    windows?: Array<{ startsAtFrame?: unknown; untilFrame?: unknown }>;
  };
  const startedMs =
    typeof candidate.startedMs === "number" && Number.isFinite(candidate.startedMs)
      ? candidate.startedMs
      : typeof legacy.startedFrame === "number" && Number.isFinite(legacy.startedFrame)
        ? legacyFramesToMs(legacy.startedFrame)
        : undefined;
  if (startedMs === undefined) return undefined;
  const next = cloneJson(candidate) as CombatActionRuntime;
  next.startedMs = startedMs;
  next.phases = next.phases.map((phase, index) => ({
    ...phase,
    startsAtMs:
      typeof phase.startsAtMs === "number" && Number.isFinite(phase.startsAtMs)
        ? phase.startsAtMs
        : legacyFramesToMs(legacy.phases?.[index]?.startsAtFrame as number | undefined) ?? startedMs,
    untilMs:
      typeof phase.untilMs === "number" && Number.isFinite(phase.untilMs)
        ? phase.untilMs
        : legacyFramesToMs(legacy.phases?.[index]?.untilFrame as number | undefined) ?? startedMs,
  }));
  next.windows = next.windows.map((window, index) => ({
    ...window,
    startsAtMs:
      typeof window.startsAtMs === "number" && Number.isFinite(window.startsAtMs)
        ? window.startsAtMs
        : legacyFramesToMs(legacy.windows?.[index]?.startsAtFrame as number | undefined) ?? startedMs,
    untilMs:
      typeof window.untilMs === "number" && Number.isFinite(window.untilMs)
        ? window.untilMs
        : legacyFramesToMs(legacy.windows?.[index]?.untilFrame as number | undefined) ?? startedMs,
  }));
  return next;
}

function isCombatActionId(value: unknown): value is CombatActionId {
  return (
    value === "normalAttack" ||
    value === "chargeAttack" ||
    value === "parry" ||
    value === "dodge" ||
    value === "superParryExecution"
  );
}

function isAttackCombatAction(actionId: CombatActionId | undefined): boolean {
  return actionId === "normalAttack" || actionId === "chargeAttack" || actionId === "superParryExecution";
}

function attackKindLabel(kind: AttackKind): string {
  if (kind === "charged") return "charged attack";
  if (kind === "superParry") return "super parry counter";
  return "normal attack";
}

function roundDamage(value: number): number {
  return Math.round(value * 100) / 100;
}

function hasHealth(entity: Entity): boolean {
  return typeof entity.runtime?.health === "number" || numberParam(entity, "health") !== undefined;
}

function stringParam(entity: Entity, key: string): string | undefined {
  const value = entity.behavior?.params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseActorScopedKey(key: string): { entityId: EntityId; key: string } | undefined {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) return undefined;
  return {
    entityId: key.slice(0, separator) as EntityId,
    key: key.slice(separator + 1),
  };
}

function actorInputFromFlatInput(input: Record<string, boolean>): Record<string, Record<string, boolean>> {
  const actorInput: Record<string, Record<string, boolean>> = {};
  for (const [key, pressed] of Object.entries(input)) {
    const scoped = parseActorScopedKey(key);
    if (!scoped) continue;
    actorInput[scoped.entityId] = {
      ...(actorInput[scoped.entityId] || {}),
      [scoped.key]: pressed,
    };
  }
  return actorInput;
}
