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
import type { SceneId, Vec2 } from "../shared/types";
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
      entity.body.velocity.x += this.gravity.x * entity.body.gravityScale * dt;
      entity.body.velocity.y += this.gravity.y * entity.body.gravityScale * dt;
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
          attackStartFrame: entity.runtime?.attackStartFrame,
          attackActiveUntilFrame: entity.runtime?.attackActiveUntilFrame,
          attackCooldownUntilFrame: entity.runtime?.attackCooldownUntilFrame,
          attackHitIds: entity.runtime?.attackHitIds,
          parryUntilFrame: entity.runtime?.parryUntilFrame,
          parryCooldownUntilFrame: entity.runtime?.parryCooldownUntilFrame,
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
        attackStartFrame: typeof state.state.attackStartFrame === "number" ? state.state.attackStartFrame : undefined,
        attackActiveUntilFrame:
          typeof state.state.attackActiveUntilFrame === "number" ? state.state.attackActiveUntilFrame : undefined,
        attackCooldownUntilFrame:
          typeof state.state.attackCooldownUntilFrame === "number" ? state.state.attackCooldownUntilFrame : undefined,
        attackHitIds: Array.isArray(state.state.attackHitIds) ? cloneJson(state.state.attackHitIds) : [],
        parryUntilFrame: typeof state.state.parryUntilFrame === "number" ? state.state.parryUntilFrame : undefined,
        parryCooldownUntilFrame:
          typeof state.state.parryCooldownUntilFrame === "number" ? state.state.parryCooldownUntilFrame : undefined,
        hitStunUntilFrame: typeof state.state.hitStunUntilFrame === "number" ? state.state.hitStunUntilFrame : undefined,
      };
    }
    if (restoreMode) {
      this.mode = snapshot.mode;
      this.clock.setMode(snapshot.mode);
    }
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
    const flags = this.runtimeFlags(entity);
    const fallbackSpeed = Math.abs(entity.body.velocity.x) || 90;
    const speed = numberParam(entity, "speed") ?? fallbackSpeed;
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
    const attackPressed = this.isInputDown(entity, "attack");
    const parryPressed = this.isInputDown(entity, "parry");
    const attackCooldownUntil = entity.runtime?.attackCooldownUntilFrame ?? -1;
    const parryCooldownUntil = entity.runtime?.parryCooldownUntilFrame ?? -1;

    if (attackPressed && frame >= attackCooldownUntil) {
      const startup = numberParam(entity, "attackStartupFrames") ?? 4;
      const active = numberParam(entity, "attackActiveFrames") ?? 4;
      const cooldown = numberParam(entity, "attackCooldownFrames") ?? 18;
      entity.runtime = {
        ...entity.runtime,
        attackStartFrame: frame + startup,
        attackActiveUntilFrame: frame + startup + active,
        attackCooldownUntilFrame: frame + cooldown,
        attackHitIds: [],
      };
      this.emitCombatEvent({
        type: "attackStarted",
        attackerId: entity.id,
        sourceId: entity.id,
        message: `${entity.displayName} started attack.`,
        data: { startup, active, cooldown },
      });
    }

    if (parryPressed && frame >= parryCooldownUntil) {
      const windowFrames = numberParam(entity, "parryWindowFrames") ?? 5;
      const cooldown = numberParam(entity, "parryCooldownFrames") ?? 16;
      entity.runtime = {
        ...entity.runtime,
        parryUntilFrame: frame + windowFrames,
        parryCooldownUntilFrame: frame + cooldown,
      };
      this.emitCombatEvent({
        type: "parryStarted",
        defenderId: entity.id,
        sourceId: entity.id,
        message: `${entity.displayName} opened parry window.`,
        data: { windowFrames, cooldown },
      });
    }
  }

  private resolveCombatEvents(): void {
    const frame = this.clock.frame;
    const entities = this.allEntities();
    for (const attacker of entities) {
      if (!attacker.collider) continue;
      const activeFrom = attacker.runtime?.attackStartFrame ?? Number.POSITIVE_INFINITY;
      const activeUntil = attacker.runtime?.attackActiveUntilFrame ?? -1;
      if (frame < activeFrom || frame > activeUntil) continue;

      const hitIds = new Set(attacker.runtime?.attackHitIds || []);
      const attackArea = this.attackBounds(attacker);
      for (const defender of entities) {
        if (defender.id === attacker.id || defender.kind !== "entity" || !defender.collider) continue;
        if (defender.body?.mode === "static" || hitIds.has(defender.id)) continue;
        if (!entityIntersectsRect(defender, attackArea)) continue;

        hitIds.add(defender.id);
        const parryUntil = defender.runtime?.parryUntilFrame ?? -1;
        if (frame <= parryUntil) {
          const stunFrames = numberParam(attacker, "parryStunFrames") ?? 14;
          attacker.runtime = {
            ...attacker.runtime,
            hitStunUntilFrame: frame + stunFrames,
            attackActiveUntilFrame: frame,
            attackHitIds: [...hitIds],
          };
          this.emitCombatEvent({
            type: "parrySuccess",
            attackerId: attacker.id,
            defenderId: defender.id,
            sourceId: defender.id,
            targetId: attacker.id,
            message: `${defender.displayName} parried ${attacker.displayName}.`,
            data: { stunFrames },
          });
          continue;
        }

        const nextHealth = (defender.runtime?.health ?? numberParam(defender, "health") ?? 1) - 1;
        defender.runtime = { ...defender.runtime, health: nextHealth };
        attacker.runtime = { ...attacker.runtime, attackHitIds: [...hitIds] };
        this.emitCombatEvent({
          type: "hit",
          attackerId: attacker.id,
          defenderId: defender.id,
          sourceId: attacker.id,
          targetId: defender.id,
          message: `${attacker.displayName} hit ${defender.displayName}.`,
          data: { health: nextHealth },
        });
      }
      attacker.runtime = { ...attacker.runtime, attackHitIds: [...hitIds] };
    }
  }

  private attackBounds(entity: Entity): { x: number; y: number; w: number; h: number } {
    const bounds = boundsFor(entity);
    const direction = entity.runtime?.facing === -1 ? -1 : 1;
    const range = numberParam(entity, "attackRange") ?? Math.max(64, bounds.w);
    const height = numberParam(entity, "attackHeight") ?? bounds.h;
    return {
      x: direction === 1 ? bounds.x + bounds.w : bounds.x - range,
      y: bounds.y + bounds.h / 2 - height / 2,
      w: range,
      h: height,
    };
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
