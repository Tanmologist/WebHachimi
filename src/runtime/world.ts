import type {
  CombatEvent,
  Entity,
  RuntimeEntityState,
  RuntimeSnapshot,
  Scene,
} from "../project/schema";
import { normalizeEntityDefaults, normalizeSceneSettings } from "../project/schema";
import { cloneJson, makeId } from "../shared/types";
import type { EntityId, RuntimeMode, SnapshotId } from "../shared/types";
import type { Rect, SceneId, Vec2 } from "../shared/types";
import { boundsFor, collectDynamicPairs, entityIntersectsRect } from "./collision";
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
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  hitStun: number;
  controlLevel: number;
  armorLevel: number;
  chargeStage?: number;
};

export class RuntimeWorld {
  readonly sceneId: SceneId;
  readonly clock: FixedStepClock;
  readonly gravity: Vec2;
  mode: RuntimeMode = "editorFrozen";
  entities = new Map<string, Entity>();
  transientEntities = new Map<string, Entity>();
  private entityListCache?: Entity[];
  input: Record<string, boolean> = {};
  actorInput: Record<string, Record<string, boolean>> = {};
  combatEvents: CombatEvent[] = [];
  lastSnapshot?: RuntimeSnapshot;

  constructor(options: RuntimeWorldOptions) {
    const settings = normalizeSceneSettings(cloneJson(options.scene.settings));
    this.sceneId = options.scene.id;
    this.gravity = cloneJson(settings.gravity);
    this.clock = new FixedStepClock({
      fixedStepMs: settings.fixedStepMs,
      maxStepsPerFrame: 5,
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

  pushDelta(deltaMs: number): void {
    const tick = this.clock.pushDelta(deltaMs);
    for (let index = 0; index < tick.steps; index += 1) this.stepFixed();
  }

  stepFixed(): void {
    const dt = this.clock.fixedStepMs / 1000;
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
    this.resolveSimpleCollisions();
    this.resolveCombatEvents();
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
          hitFlashUntilFrame: entity.runtime?.hitFlashUntilFrame,
          defeatFrame: entity.runtime?.defeatFrame,
          attackStartFrame: entity.runtime?.attackStartFrame,
          attackActiveUntilFrame: entity.runtime?.attackActiveUntilFrame,
          attackCooldownUntilFrame: entity.runtime?.attackCooldownUntilFrame,
          attackHitIds: entity.runtime?.attackHitIds,
          attackTouchEntityId: entity.runtime?.attackTouchEntityId,
          attackKind: entity.runtime?.attackKind,
          attackDamage: entity.runtime?.attackDamage,
          attackControlLevel: entity.runtime?.attackControlLevel,
          attackArmorLevel: entity.runtime?.attackArmorLevel,
          attackChargeStage: entity.runtime?.attackChargeStage,
          attackInputDown: entity.runtime?.attackInputDown,
          attackConsumedUntilRelease: entity.runtime?.attackConsumedUntilRelease,
          parryInputDown: entity.runtime?.parryInputDown,
          chargeStartedFrame: entity.runtime?.chargeStartedFrame,
          chargeHeldFrames: entity.runtime?.chargeHeldFrames,
          chargeStage: entity.runtime?.chargeStage,
          chargeStoredDamage: entity.runtime?.chargeStoredDamage,
          parryUntilFrame: entity.runtime?.parryUntilFrame,
          parryRecoveryUntilFrame: entity.runtime?.parryRecoveryUntilFrame,
          parryCooldownUntilFrame: entity.runtime?.parryCooldownUntilFrame,
          superParryUntilFrame: entity.runtime?.superParryUntilFrame,
          superParryLockUntilFrame: entity.runtime?.superParryLockUntilFrame,
          superParryBonusDamage: entity.runtime?.superParryBonusDamage,
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
        hitFlashUntilFrame: typeof state.state.hitFlashUntilFrame === "number" ? state.state.hitFlashUntilFrame : undefined,
        defeatFrame: typeof state.state.defeatFrame === "number" ? state.state.defeatFrame : undefined,
        attackStartFrame: typeof state.state.attackStartFrame === "number" ? state.state.attackStartFrame : undefined,
        attackActiveUntilFrame:
          typeof state.state.attackActiveUntilFrame === "number" ? state.state.attackActiveUntilFrame : undefined,
        attackCooldownUntilFrame:
          typeof state.state.attackCooldownUntilFrame === "number" ? state.state.attackCooldownUntilFrame : undefined,
        attackHitIds: Array.isArray(state.state.attackHitIds) ? cloneJson(state.state.attackHitIds) : [],
        attackTouchEntityId: typeof state.state.attackTouchEntityId === "string" ? state.state.attackTouchEntityId as EntityId : undefined,
        attackKind: attackKindFromValue(state.state.attackKind),
        attackDamage: typeof state.state.attackDamage === "number" ? state.state.attackDamage : undefined,
        attackControlLevel: typeof state.state.attackControlLevel === "number" ? state.state.attackControlLevel : undefined,
        attackArmorLevel: typeof state.state.attackArmorLevel === "number" ? state.state.attackArmorLevel : undefined,
        attackChargeStage: typeof state.state.attackChargeStage === "number" ? state.state.attackChargeStage : undefined,
        attackInputDown: state.state.attackInputDown === true,
        attackConsumedUntilRelease: state.state.attackConsumedUntilRelease === true,
        parryInputDown: state.state.parryInputDown === true,
        chargeStartedFrame: typeof state.state.chargeStartedFrame === "number" ? state.state.chargeStartedFrame : undefined,
        chargeHeldFrames: typeof state.state.chargeHeldFrames === "number" ? state.state.chargeHeldFrames : undefined,
        chargeStage: typeof state.state.chargeStage === "number" ? state.state.chargeStage : undefined,
        chargeStoredDamage: typeof state.state.chargeStoredDamage === "number" ? state.state.chargeStoredDamage : undefined,
        parryUntilFrame: typeof state.state.parryUntilFrame === "number" ? state.state.parryUntilFrame : undefined,
        parryRecoveryUntilFrame:
          typeof state.state.parryRecoveryUntilFrame === "number" ? state.state.parryRecoveryUntilFrame : undefined,
        parryCooldownUntilFrame:
          typeof state.state.parryCooldownUntilFrame === "number" ? state.state.parryCooldownUntilFrame : undefined,
        superParryUntilFrame: typeof state.state.superParryUntilFrame === "number" ? state.state.superParryUntilFrame : undefined,
        superParryLockUntilFrame: typeof state.state.superParryLockUntilFrame === "number" ? state.state.superParryLockUntilFrame : undefined,
        superParryBonusDamage: typeof state.state.superParryBonusDamage === "number" ? state.state.superParryBonusDamage : undefined,
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

  private applyBuiltinBehavior(entity: Entity): void {
    if (!entity.body) return;
    const frame = this.clock.frame;
    if (entity.runtime?.defeated) {
      this.stopEntity(entity);
      this.clearActiveAttack(entity);
      this.clearCharge(entity);
      return;
    }
    if (this.isHitStunned(entity, frame)) {
      this.stopEntity(entity);
      this.clearActiveAttack(entity);
      this.clearCharge(entity);
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
    const frame = this.clock.frame;
    const attackDown = this.isInputDown(entity, "attack");
    const parryDown = this.isInputDown(entity, "parry");
    const wasAttackDown = entity.runtime?.attackInputDown === true;
    const wasParryDown = entity.runtime?.parryInputDown === true;
    const attackPressed = attackDown && !wasAttackDown;
    const attackReleased = !attackDown && wasAttackDown;
    const parryPressed = parryDown && !wasParryDown;

    if (!attackDown && entity.runtime?.attackConsumedUntilRelease) {
      entity.runtime = { ...entity.runtime, attackInputDown: false, attackConsumedUntilRelease: false, parryInputDown: parryDown };
      return;
    }

    if (this.isCombatActionLocked(entity, frame)) {
      entity.runtime = {
        ...entity.runtime,
        attackInputDown: attackDown,
        attackConsumedUntilRelease: entity.runtime?.attackConsumedUntilRelease === true || attackPressed || parryPressed,
        parryInputDown: parryDown,
      };
      return;
    }

    if (parryPressed) {
      const fromCharge = attackDown && (entity.runtime?.chargeHeldFrames ?? 0) > 0;
      if (fromCharge) {
        this.clearCharge(entity);
        entity.runtime = { ...entity.runtime, attackInputDown: attackDown, attackConsumedUntilRelease: true, parryInputDown: parryDown };
      }
      this.tryStartParry(entity, { fromCharge });
    }

    if (entity.runtime?.attackConsumedUntilRelease) {
      entity.runtime = { ...entity.runtime, attackInputDown: attackDown, parryInputDown: parryDown };
      return;
    }

    if (attackPressed && this.hasSuperParryReady(entity, frame)) {
      this.tryStartAttack(entity, { kind: "superParry" });
      entity.runtime = { ...entity.runtime, attackInputDown: attackDown, attackConsumedUntilRelease: true, parryInputDown: parryDown };
      return;
    }

    if (attackPressed) this.beginCharge(entity);
    if (attackDown) this.updateCharge(entity, wasAttackDown);
    if (attackReleased) this.releaseChargeAttack(entity);

    entity.runtime = { ...entity.runtime, attackInputDown: attackDown, parryInputDown: parryDown };
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

  private chargeThresholdFrames(entity: Entity): number {
    return Math.max(1, Math.floor(numberParam(entity, "chargeThresholdFrames") ?? 60));
  }

  private chargeStageFrames(entity: Entity): number {
    return Math.max(1, Math.floor(numberParam(entity, "chargeStageFrames") ?? this.chargeThresholdFrames(entity)));
  }

  private hasSuperParryReady(entity: Entity, frame = this.clock.frame): boolean {
    return frame <= (entity.runtime?.superParryUntilFrame ?? -1);
  }

  private isSuperParryMoveLocked(entity: Entity, frame = this.clock.frame): boolean {
    return frame <= (entity.runtime?.superParryLockUntilFrame ?? -1);
  }

  private isAttackActionLocked(entity: Entity, frame = this.clock.frame): boolean {
    return frame < (entity.runtime?.attackCooldownUntilFrame ?? -1);
  }

  private isParryActionLocked(entity: Entity, frame = this.clock.frame): boolean {
    return frame < (entity.runtime?.parryRecoveryUntilFrame ?? -1);
  }

  private isCombatActionLocked(entity: Entity, frame = this.clock.frame): boolean {
    return this.isAttackActionLocked(entity, frame) || this.isParryActionLocked(entity, frame);
  }

  private isCombatMovementLocked(entity: Entity, frame = this.clock.frame): boolean {
    return this.isAttackActionLocked(entity, frame) || this.isParryActionLocked(entity, frame);
  }

  private attackConfig(entity: Entity, kind: AttackKind, chargeStageInput?: number): AttackConfig {
    if (kind === "charged") {
      const chargeStage = Math.max(1, Math.floor(chargeStageInput || entity.runtime?.chargeStage || 1));
      const baseDamage = Math.max(1, numberParam(entity, "chargedAttackDamage") ?? (numberParam(entity, "attackDamage") ?? 1) * 2);
      const growth = Math.max(1, numberParam(entity, "chargedAttackDamageGrowth") ?? 1.2);
      const storedDamage = entity.runtime?.chargeStoredDamage ?? 0;
      return {
        kind,
        startup: Math.max(0, Math.floor(numberParam(entity, "chargedAttackStartupFrames") ?? 20)),
        active: Math.max(1, Math.floor(numberParam(entity, "chargedAttackActiveFrames") ?? 50)),
        recovery: Math.max(0, Math.floor(numberParam(entity, "chargedAttackRecoveryFrames") ?? numberParam(entity, "chargedAttackCooldownFrames") ?? 30)),
        damage: roundDamage(baseDamage * Math.pow(growth, chargeStage - 1) + storedDamage),
        hitStun: Math.max(0, Math.floor(numberParam(entity, "chargedAttackHitStunFrames") ?? 80)),
        controlLevel: Math.max(1, Math.floor(numberParam(entity, "chargedAttackControlLevel") ?? 3)),
        armorLevel: Math.max(0, Math.floor(numberParam(entity, "chargedAttackArmorLevel") ?? 3)),
        chargeStage,
      };
    }
    if (kind === "superParry") {
      const baseDamage = Math.max(1, numberParam(entity, "attackDamage") ?? 1);
      const multiplier = Math.max(1, numberParam(entity, "superParryAttackBaseDamageMultiplier") ?? 3);
      return {
        kind,
        startup: Math.max(0, Math.floor(numberParam(entity, "superParryAttackStartupFrames") ?? 4)),
        active: Math.max(1, Math.floor(numberParam(entity, "superParryAttackActiveFrames") ?? 12)),
        recovery: Math.max(0, Math.floor(numberParam(entity, "superParryAttackRecoveryFrames") ?? numberParam(entity, "superParryAttackCooldownFrames") ?? 22)),
        damage: roundDamage(baseDamage * multiplier + (entity.runtime?.superParryBonusDamage ?? 0)),
        hitStun: Math.max(0, Math.floor(numberParam(entity, "superParryAttackHitStunFrames") ?? 60)),
        controlLevel: Math.max(1, Math.floor(numberParam(entity, "superParryAttackControlLevel") ?? 4)),
        armorLevel: Math.max(0, Math.floor(numberParam(entity, "superParryAttackArmorLevel") ?? 4)),
      };
    }
    return {
      kind,
      startup: Math.max(0, Math.floor(numberParam(entity, "attackStartupFrames") ?? 10)),
      active: Math.max(1, Math.floor(numberParam(entity, "attackActiveFrames") ?? 30)),
      recovery: Math.max(0, Math.floor(numberParam(entity, "attackRecoveryFrames") ?? numberParam(entity, "attackCooldownFrames") ?? 20)),
      damage: Math.max(1, numberParam(entity, "attackDamage") ?? 1),
      hitStun: Math.max(0, Math.floor(numberParam(entity, "attackHitStunFrames") ?? 100)),
      controlLevel: Math.max(1, Math.floor(numberParam(entity, "attackControlLevel") ?? 1)),
      armorLevel: Math.max(0, Math.floor(numberParam(entity, "attackArmorLevel") ?? 1)),
    };
  }

  private attackDamage(entity: Entity): number {
    if (typeof entity.runtime?.attackDamage === "number") return entity.runtime.attackDamage;
    const kind = entity.runtime?.attackKind || "normal";
    return entity.runtime?.attackKind ? this.attackConfig(entity, kind, entity.runtime.attackChargeStage).damage : Math.max(1, numberParam(entity, "attackDamage") ?? 1);
  }

  private attackHitStun(entity: Entity): number {
    return this.attackConfig(entity, entity.runtime?.attackKind || "normal", entity.runtime?.attackChargeStage).hitStun;
  }

  private attackControlLevel(entity: Entity): number {
    return entity.runtime?.attackControlLevel ?? this.attackConfig(entity, entity.runtime?.attackKind || "normal", entity.runtime?.attackChargeStage).controlLevel;
  }

  private currentArmorLevel(entity: Entity): number {
    const frame = this.clock.frame;
    if (frame <= (entity.runtime?.parryUntilFrame ?? -1)) return Math.max(0, Math.floor(numberParam(entity, "parryArmorLevel") ?? 3));
    if (frame <= (entity.runtime?.attackActiveUntilFrame ?? -1) || frame < (entity.runtime?.attackStartFrame ?? -1)) {
      return Math.max(0, Math.floor(entity.runtime?.attackArmorLevel ?? 0));
    }
    const heldFrames = entity.runtime?.chargeHeldFrames ?? 0;
    if (heldFrames > 0) {
      const threshold = this.chargeThresholdFrames(entity);
      const firstArmorFrames = Math.max(0, Math.floor(numberParam(entity, "chargeNoArmorFrames") ?? Math.floor(threshold / 2)));
      if (heldFrames < firstArmorFrames) return 0;
      return heldFrames < threshold ? 1 : 2;
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

  private attackKindNumberParam(entity: Entity, kind: AttackKind, suffix: string): number | undefined {
    if (kind === "charged") return numberParam(entity, `chargedAttack${suffix}`);
    if (kind === "superParry") return numberParam(entity, `superParryAttack${suffix}`);
    return undefined;
  }

  private beginCharge(entity: Entity): void {
    const frame = this.clock.frame;
    entity.runtime = {
      ...entity.runtime,
      chargeStartedFrame: frame,
      chargeHeldFrames: 0,
      chargeStage: 0,
      chargeStoredDamage: entity.runtime?.chargeStoredDamage ?? 0,
    };
    this.emitCombatEvent({
      type: "chargeStarted",
      attackerId: entity.id,
      sourceId: entity.id,
      message: `${entity.displayName} began charging attack.`,
      data: { thresholdFrames: this.chargeThresholdFrames(entity), stageFrames: this.chargeStageFrames(entity) },
    });
  }

  private updateCharge(entity: Entity, wasAttackDown: boolean): void {
    const previousHeld = wasAttackDown ? entity.runtime?.chargeHeldFrames ?? 0 : 0;
    const heldFrames = previousHeld + 1;
    const stage = heldFrames >= this.chargeThresholdFrames(entity) ? Math.max(1, Math.floor(heldFrames / this.chargeStageFrames(entity))) : 0;
    entity.runtime = {
      ...entity.runtime,
      chargeHeldFrames: heldFrames,
      chargeStage: stage,
      chargeStartedFrame: entity.runtime?.chargeStartedFrame ?? this.clock.frame,
    };
  }

  private releaseChargeAttack(entity: Entity): void {
    const heldFrames = entity.runtime?.chargeHeldFrames ?? 0;
    const chargeStage = heldFrames >= this.chargeThresholdFrames(entity) ? Math.max(1, Math.floor(heldFrames / this.chargeStageFrames(entity))) : 0;
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
        data: { kind, heldFrames, chargeStage, storedDamage },
      });
    }
  }

  private tryStartAttack(entity: Entity, options: { kind?: AttackKind; chargeStage?: number } = {}): boolean {
    const frame = this.clock.frame;
    if (entity.runtime?.defeated || this.isHitStunned(entity, frame)) return false;
    const attackCooldownUntil = entity.runtime?.attackCooldownUntilFrame ?? -1;
    const attackActiveUntil = entity.runtime?.attackActiveUntilFrame ?? -1;
    if (frame < attackCooldownUntil || frame <= attackActiveUntil) return false;
    const config = this.attackConfig(entity, options.kind || "normal", options.chargeStage);
    const activeStartFrame = frame + config.startup;
    const activeUntilFrame = activeStartFrame + config.active - 1;
    const cooldownUntilFrame = frame + config.startup + config.active + config.recovery;
    if (config.kind === "superParry") {
      entity.runtime = {
        ...entity.runtime,
        superParryUntilFrame: undefined,
        superParryLockUntilFrame: undefined,
        superParryBonusDamage: undefined,
      };
    }
    entity.runtime = {
      ...entity.runtime,
      attackStartFrame: activeStartFrame,
      attackActiveUntilFrame: activeUntilFrame,
      attackCooldownUntilFrame: cooldownUntilFrame,
      attackHitIds: [],
      attackTouchEntityId: undefined,
      attackKind: config.kind,
      attackDamage: config.damage,
      attackControlLevel: config.controlLevel,
      attackArmorLevel: config.armorLevel,
      attackChargeStage: config.chargeStage,
    };
    this.emitCombatEvent({
      type: "attackStarted",
      attackerId: entity.id,
      sourceId: entity.id,
      message: `${entity.displayName} started ${attackKindLabel(config.kind)}.`,
      data: {
        kind: config.kind,
        startup: config.startup,
        active: config.active,
        recovery: config.recovery,
        cooldown: config.startup + config.active + config.recovery,
        activeStartFrame,
        activeUntilFrame,
        cooldownUntilFrame,
        damage: config.damage,
        hitStun: config.hitStun,
        controlLevel: config.controlLevel,
        armorLevel: config.armorLevel,
        chargeStage: config.chargeStage,
      },
    });
    return true;
  }

  private tryStartParry(entity: Entity, options: { fromCharge?: boolean } = {}): boolean {
    const frame = this.clock.frame;
    if (entity.runtime?.defeated || this.isHitStunned(entity, frame)) return false;
    if (!options.fromCharge && this.isAttackActionLocked(entity, frame)) return false;
    if (this.isParryActionLocked(entity, frame)) return false;
    const parryCooldownUntil = entity.runtime?.parryCooldownUntilFrame ?? -1;
    if (frame < parryCooldownUntil) return false;
    const windowFrames = Math.max(1, Math.floor(numberParam(entity, "parryWindowFrames") ?? 20));
    const recoveryFrames = Math.max(0, Math.floor(numberParam(entity, "parryRecoveryFrames") ?? numberParam(entity, "parryCooldownFrames") ?? 30));
    const cooldown = windowFrames + recoveryFrames;
    entity.runtime = {
      ...entity.runtime,
      parryUntilFrame: frame + windowFrames - 1,
      parryRecoveryUntilFrame: frame + cooldown,
      parryCooldownUntilFrame: frame + cooldown,
    };
    this.emitCombatEvent({
      type: "parryStarted",
      defenderId: entity.id,
      sourceId: entity.id,
      message: `${entity.displayName} opened shock parry window.`,
      data: { windowFrames, recoveryFrames, cooldown, fromCharge: options.fromCharge === true, armorLevel: numberParam(entity, "parryArmorLevel") ?? 3 },
    });
    return true;
  }

  private resolveCombatEvents(): void {
    const frame = this.clock.frame;
    const entities = this.allEntities();
    for (const attacker of entities) {
      if (!this.canUseAttackTouch(attacker)) continue;
      if (attacker.runtime?.defeated || this.isHitStunned(attacker, frame)) continue;
      const activeFrom = attacker.runtime?.attackStartFrame ?? Number.POSITIVE_INFINITY;
      const activeUntil = attacker.runtime?.attackActiveUntilFrame ?? -1;
      if (frame < activeFrom || frame > activeUntil) continue;

      const hitIds = new Set(attacker.runtime?.attackHitIds || []);
      const attackArea = this.attackTouchBounds(attacker);
      const attackKind = attacker.runtime?.attackKind || "normal";
      const rawDamage = this.attackDamage(attacker);
      const controlLevel = this.attackControlLevel(attacker);
      const hitStunFrames = this.attackHitStun(attacker);
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
          data: { actionId: attackKind, kind: attackKind, phase: "active", window: "hitbox", rect: cloneJson(attackArea), controlLevel },
        });
        const parryUntil = defender.runtime?.parryUntilFrame ?? -1;
        const parryControlLevel = numberParam(defender, "parryControlLevel") ?? 3;
        if (frame <= parryUntil && controlLevel <= parryControlLevel) {
          this.resolveParrySuccess(attacker, defender, hitIds, { attackKind, rawDamage, controlLevel });
          continue;
        }

        const armorLevel = this.currentArmorLevel(defender);
        const damageResult = this.damageAfterArmor(rawDamage, controlLevel, armorLevel, defender);
        if (damageResult.resistedDamage > 0 && (defender.runtime?.chargeHeldFrames ?? 0) > 0) {
          defender.runtime = {
            ...defender.runtime,
            chargeStoredDamage: (defender.runtime?.chargeStoredDamage ?? 0) + damageResult.resistedDamage,
          };
        }
        const currentHealth = defender.runtime?.health ?? numberParam(defender, "health") ?? 1;
        const nextHealth = Math.max(0, currentHealth - damageResult.damage);
        const stunned = damageResult.damage > 0 && controlLevel > armorLevel && hitStunFrames > 0;
        defender.runtime = {
          ...defender.runtime,
          health: nextHealth,
          hitFlashUntilFrame: frame + (numberParam(defender, "hitFlashFrames") ?? 8),
          hitStunUntilFrame: stunned ? Math.max(defender.runtime?.hitStunUntilFrame ?? -1, frame + hitStunFrames) : defender.runtime?.hitStunUntilFrame,
        };
        if (stunned) {
          this.stopEntity(defender);
          this.clearActiveAttack(defender);
          this.clearCharge(defender);
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
            hitStunFrames: stunned ? hitStunFrames : 0,
            chargeStage: attacker.runtime?.attackChargeStage,
          },
        });
        if (nextHealth <= 0) this.defeatEntity(defender, attacker);
      }
      attacker.runtime = { ...attacker.runtime, attackHitIds: [...hitIds] };
    }
  }

  private resolveParrySuccess(
    attacker: Entity,
    defender: Entity,
    hitIds: Set<EntityId>,
    attack: { attackKind: AttackKind; rawDamage: number; controlLevel: number },
  ): void {
    const frame = this.clock.frame;
    const charged = attack.attackKind === "charged";
    const stunFrames = charged
      ? numberParam(attacker, "chargedParryStunFrames") ?? numberParam(defender, "chargedParryStunFrames") ?? 120
      : numberParam(attacker, "parryShockStunFrames") ?? numberParam(attacker, "parryStunFrames") ?? 14;
    const superFrames = numberParam(defender, "superParryFrames") ?? 200;
    const lockFrames = numberParam(defender, "superParryLockFrames") ?? 50;
    const bonusMultiplier = numberParam(defender, "superParryDamageMultiplier") ?? 2;
    const bonusDamage = roundDamage(attack.rawDamage * bonusMultiplier);

    attacker.runtime = {
      ...attacker.runtime,
      hitStunUntilFrame: frame + stunFrames,
      hitFlashUntilFrame: frame + Math.max(3, Math.floor(stunFrames / 2)),
      attackStartFrame: undefined,
      attackActiveUntilFrame: undefined,
      attackHitIds: [...hitIds],
      attackTouchEntityId: undefined,
      attackKind: undefined,
      attackDamage: undefined,
      attackControlLevel: undefined,
      attackArmorLevel: undefined,
      attackChargeStage: undefined,
    };
    defender.runtime = {
      ...defender.runtime,
      parryUntilFrame: undefined,
      parryRecoveryUntilFrame: undefined,
      superParryUntilFrame: frame + superFrames,
      superParryLockUntilFrame: frame + lockFrames,
      superParryBonusDamage: bonusDamage,
      hitFlashUntilFrame: frame + Math.max(4, Math.floor(lockFrames / 4)),
    };
    this.emitCombatEvent({
      type: "parrySuccess",
      attackerId: attacker.id,
      defenderId: defender.id,
      sourceId: defender.id,
      targetId: attacker.id,
      message: `${defender.displayName} shocked ${attacker.displayName}'s ${attackKindLabel(attack.attackKind)} aside.`,
      data: { stunFrames, kind: attack.attackKind, controlLevel: attack.controlLevel, charged, bonusDamage },
    });
    this.emitCombatEvent({
      type: "superParryReady",
      attackerId: defender.id,
      defenderId: attacker.id,
      sourceId: defender.id,
      targetId: attacker.id,
      message: `${defender.displayName} entered super parry counter window.`,
      data: { superFrames, lockFrames, bonusDamage },
    });
  }

  private attackTouchBounds(entity: Entity): Rect {
    const bounds = boundsFor(entity);
    const direction = entity.runtime?.facing === -1 ? -1 : 1;
    const kind = entity.runtime?.attackKind || "normal";
    const range = this.attackKindNumberParam(entity, kind, "Range") ?? numberParam(entity, "attackRange") ?? Math.max(64, bounds.w);
    const height = this.attackKindNumberParam(entity, kind, "Height") ?? numberParam(entity, "attackHeight") ?? bounds.h;
    const inset = Math.max(0, numberParam(entity, "attackTouchInset") ?? 8);
    const offsetX = numberParam(entity, "attackTouchOffsetX") ?? 0;
    const offsetY = numberParam(entity, "attackTouchOffsetY") ?? 0;
    return {
      x: (direction === 1 ? bounds.x + bounds.w - inset : bounds.x - range) + direction * offsetX,
      y: bounds.y + bounds.h / 2 - height / 2 + offsetY,
      w: range + inset,
      h: height,
    };
  }

  private canUseAttackTouch(entity: Entity): boolean {
    if (entity.kind !== "entity" || !entity.collider) return false;
    return Boolean(entity.behavior?.builtin === "playerPlatformer" || entity.behavior?.builtin === "enemyPatrol");
  }

  private canReceiveAttackTouch(attacker: Entity, defender: Entity): boolean {
    if (defender.id === attacker.id || defender.kind !== "entity" || !defender.collider) return false;
    if (defender.runtime?.defeated) return false;
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
      existing.runtime = { ...existing.runtime, ageMs: 0, lifetimeMs };
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
      },
    };
    const touchId = this.spawnTransient(touchEntity, lifetimeMs);
    attacker.runtime = { ...attacker.runtime, attackTouchEntityId: touchId };
  }

  private emitCombatEvent(event: Omit<CombatEvent, "id" | "frame">): CombatEvent {
    const next: CombatEvent = {
      ...event,
      id: `combat-${this.combatEvents.length + 1}-${Date.now().toString(36)}`,
      frame: this.clock.frame,
    };
    this.combatEvents.push(next);
    return next;
  }

  private defeatEntity(entity: Entity, source: Entity): void {
    if (entity.runtime?.defeated) return;
    const frame = this.clock.frame;
    entity.runtime = {
      ...entity.runtime,
      defeated: true,
      defeatFrame: frame,
      health: 0,
      hitFlashUntilFrame: frame + 12,
    };
    this.stopEntity(entity);
    this.clearActiveAttack(entity);
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
      attackStartFrame: undefined,
      attackActiveUntilFrame: undefined,
      attackHitIds: entity.runtime?.attackHitIds || [],
      attackTouchEntityId: undefined,
      attackKind: undefined,
      attackDamage: undefined,
      attackControlLevel: undefined,
      attackArmorLevel: undefined,
      attackChargeStage: undefined,
    };
  }

  private clearCharge(entity: Entity): void {
    entity.runtime = {
      ...entity.runtime,
      chargeStartedFrame: undefined,
      chargeHeldFrames: undefined,
      chargeStage: undefined,
      chargeStoredDamage: undefined,
    };
  }

  private isHitStunned(entity: Entity, frame: number): boolean {
    return frame <= (entity.runtime?.hitStunUntilFrame ?? -1);
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
      hitFlashUntilFrame: entity.runtime?.hitFlashUntilFrame,
      defeatFrame: entity.runtime?.defeatFrame,
      attackKind: attackKindFromValue(entity.runtime?.attackKind),
      attackInputDown: entity.runtime?.attackInputDown ?? false,
      attackConsumedUntilRelease: entity.runtime?.attackConsumedUntilRelease ?? false,
      parryInputDown: entity.runtime?.parryInputDown ?? false,
      parryRecoveryUntilFrame: entity.runtime?.parryRecoveryUntilFrame,
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

function attackKindFromValue(value: unknown): AttackKind | undefined {
  return value === "normal" || value === "charged" || value === "superParry" ? value : undefined;
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
