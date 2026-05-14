import { combatActionDefForEntity, combatAttackRectForEntity, combatPhaseDurationMs } from "../combat/actions";
import { planMovedAttackMovementOffsets, planMovedAttackTouchOffsets } from "../combat/hitboxEdit";
import type { CombatEvent, Entity, Project, Scene } from "../project/schema";
import { createStarterProject } from "../editor/starterProject";
import { RuntimeWorld } from "../runtime/world";

const project = createStarterProject();
const scene = activeScene(project);
const player = findByInternalName(scene, "Player");
const enemy = findByInternalName(scene, "Enemy_Patrol");

assertActionDefinitions(player);
assertRelativeHitboxEditing(player);
assertRelativeMovementEditing(player);
assertGlobalInputTargetsDefaultPlayerOnly(scene, player, enemy);
assertRuntimeActionContext(scene, player);
assertRuntimeAttackLunge(scene, player);
assertBufferedChargeAfterNormalRecovery(scene, player);
assertNormalAttackClashInterrupts(scene, player, enemy);
assertControlArmorResolution(scene, player, enemy);
assertParryControlBoundary(scene, player, enemy);
assertDodgeWindow(scene, player, enemy);
assertPerfectDodgeAttackShadow(scene, player, enemy);
assertTickRateIndependentTiming(scene, player);

console.log("combat action protocol smoke passed");

function assertActionDefinitions(entity: Entity): void {
  const normal = combatActionDefForEntity(entity, "normalAttack");
  const charged = combatActionDefForEntity(entity, "chargeAttack", { chargeStage: 2 });
  const parry = combatActionDefForEntity(entity, "parry");
  const dodge = combatActionDefForEntity(entity, "dodge");

  assert(combatPhaseDurationMs(normal, "startup") === 100, "normal attack startup should follow the time table");
  assert(combatPhaseDurationMs(normal, "active") === 300, "normal attack active window should follow the time table");
  assert(combatPhaseDurationMs(normal, "recovery") === 200, "normal attack recovery should follow the time table");
  assert(normal.windows.some((window) => window.type === "hitbox" && window.phase === "active"), "normal attack needs an active hitbox window");
  assert(normal.windows.some((window) => window.type === "attackShadow" && window.phase === "startup"), "normal attack needs a startup attack shadow");
  assert(normal.windows.some((window) => window.type === "movement" && window.phase === "startup"), "normal attack should expose a movement window");
  assert(normal.data?.moveOffsetX === 36 && normal.data?.moveDurationMs === 100, "normal attack should default to a short 100ms lunge");
  assert(normal.windows.some((window) => window.type === "armor" && window.armorLevel === 1), "normal attack should carry level 1 armor");

  assert(combatPhaseDurationMs(charged, "startup") === 100, "charged attack startup should follow the time table");
  assert(combatPhaseDurationMs(charged, "active") === 500, "charged attack active window should follow the time table");
  assert(charged.data?.chargeStage === 2, "charged action should preserve charge stage");
  assert(charged.windows.some((window) => window.type === "attackShadow" && window.phase === "startup"), "charged attack needs a startup attack shadow");
  assert(charged.windows.some((window) => window.type === "hitbox" && window.controlLevel === 3), "charged hitbox should carry level 3 control");

  assert(combatPhaseDurationMs(parry, "active") === 200, "parry active window should be 200ms");
  assert(parry.windows.some((window) => window.type === "parry" && window.controlLevel === 3), "parry should counter control level 3 and below");

  assert(combatPhaseDurationMs(dodge, "evade") === 180, "dodge should expose an invulnerable evade phase");
  assert(dodge.windows.some((window) => window.type === "invulnerable"), "dodge should have an invulnerable window");
}

function assertRelativeHitboxEditing(entity: Entity): void {
  entity.runtime = { ...entity.runtime, facing: 1, attackKind: "charged" };
  const baseline = combatAttackRectForEntity(entity);
  entity.behavior!.params.chargedAttackTouchOffsetX = 24;
  entity.behavior!.params.chargedAttackTouchOffsetY = -10;
  const shifted = combatAttackRectForEntity(entity);
  assert(round(shifted.x - baseline.x) === 24, "charged attack should use its own relative x offset");
  assert(round(shifted.y - baseline.y) === -10, "charged attack should use its own relative y offset");

  const rightFacingEdit = planMovedAttackTouchOffsets(entity.behavior!.params, "charged", 1, { x: 14, y: -6 });
  assert(rightFacingEdit.offsetXKey === "chargedAttackTouchOffsetX", "charged touch edits should write charged x offset");
  assert(rightFacingEdit.nextX === 38 && rightFacingEdit.nextY === -16, "right-facing touch move should add local forward/up offsets");

  const leftFacingEdit = planMovedAttackTouchOffsets(entity.behavior!.params, "charged", -1, { x: 14, y: -6 });
  assert(leftFacingEdit.nextX === 10 && leftFacingEdit.nextY === -16, "left-facing touch move should invert world x into local forward offset");
  delete entity.behavior!.params.chargedAttackTouchOffsetX;
  delete entity.behavior!.params.chargedAttackTouchOffsetY;
  entity.runtime = { ...entity.runtime, attackKind: undefined };
}

function assertRelativeMovementEditing(entity: Entity): void {
  const rightFacingEdit = planMovedAttackMovementOffsets(entity.behavior!.params, "normal", 1, { x: 18, y: 4 });
  assert(rightFacingEdit.offsetXKey === "attackMoveOffsetX", "normal movement edits should write normal x offset");
  assert(rightFacingEdit.nextX === 54 && rightFacingEdit.nextY === 4, "right-facing move target should add local forward/up offsets");

  const leftFacingEdit = planMovedAttackMovementOffsets(entity.behavior!.params, "normal", -1, { x: 18, y: 4 });
  assert(leftFacingEdit.nextX === 18 && leftFacingEdit.nextY === 4, "left-facing move target should invert world x into local forward offset");
}

function assertGlobalInputTargetsDefaultPlayerOnly(sourceScene: Scene, sourcePlayer: Entity, sourceEnemy: Entity): void {
  const world = new RuntimeWorld({ scene: sourceScene });
  assert(world.defaultPlayerInputActorId() === sourcePlayer.id, "global gameplay input should be assigned to the combat player actor");
  const enemy = requireEntity(world, sourceEnemy.id);
  enemy.behavior!.params.targetInternalName = "";
  enemy.behavior!.params.speed = 0;
  enemy.behavior!.params.left = enemy.transform.position.x;
  enemy.behavior!.params.right = enemy.transform.position.x;

  world.setInput("attack", true);
  world.runFixedFrame();
  world.setInput("attack", false);
  world.runFixedFrame();

  const playerStarted = mustEvent(world, { type: "attackStarted", attackerId: sourcePlayer.id });
  const enemyStarted = world.combatEvents.find((event) => event.type === "attackStarted" && event.attackerId === sourceEnemy.id);
  assert(playerStarted.data?.kind === "normal", "global attack should drive the default player actor");
  assert(!enemyStarted, "global attack should not be consumed by enemy actors");
}

function assertRuntimeActionContext(sourceScene: Scene, sourcePlayer: Entity): void {
  const world = new RuntimeWorld({ scene: sourceScene });
  const attackKey = scopedKey(sourcePlayer, "attack");
  world.setInput(attackKey, true);
  world.runFixedFrame();
  world.setInput(attackKey, false);
  world.runFixedFrame();

  const normalStarted = mustEvent(world, { type: "attackStarted", attackerId: sourcePlayer.id });
  assert(normalStarted.data?.actionId === "normalAttack", "runtime normal attack should report the action id");
  assert(normalStarted.data?.moveOffsetX === 36 && normalStarted.data?.moveDurationMs === 100, "runtime normal attack should report lunge data");
  const livePlayer = requireEntity(world, sourcePlayer.id);
  assert(livePlayer.runtime?.combatAction?.actionId === "normalAttack", "runtime should store the current action context");
  assert(livePlayer.runtime.attackArmorLevel === 1 && livePlayer.runtime.attackControlLevel === 1, "runtime should expose normal armor and control levels");
  assert(livePlayer.runtime.combatAction.windows.some((window) => window.type === "hitbox"), "runtime action context should include hitbox windows");
  assert(livePlayer.runtime.combatAction.windows.some((window) => window.type === "movement"), "runtime action context should include movement windows");
  world.runFixedFrames(12);
  const touch = world.allEntities().find((entity) => entity.tags.includes("touch") && entity.parentId === sourcePlayer.id);
  assert(touch?.runtime?.attackControlLevel === 1, "runtime attack touch should carry its control level for editor labels");

  const chargedWorld = new RuntimeWorld({ scene: sourceScene });
  chargedWorld.setInput(attackKey, true);
  chargedWorld.runFixedFrames(65);
  chargedWorld.setInput(attackKey, false);
  chargedWorld.runFixedFrame();
  const chargedStarted = mustEvent(chargedWorld, { type: "attackStarted", attackerId: sourcePlayer.id, "data.kind": "charged" });
  assert(chargedStarted.data?.actionId === "chargeAttack", "charged release should report the charge action id");

  const parryWorld = new RuntimeWorld({ scene: sourceScene });
  const parryPlayer = requireEntity(parryWorld, sourcePlayer.id);
  parryPlayer.behavior!.params.parryControlLevel = 3.7;
  parryPlayer.behavior!.params.parryArmorLevel = -1;
  parryWorld.setInput(scopedKey(sourcePlayer, "parry"), true);
  parryWorld.runFixedFrame();
  parryWorld.setInput(scopedKey(sourcePlayer, "parry"), false);
  parryWorld.runFixedFrame();
  const parryStarted = mustEvent(parryWorld, { type: "parryStarted", defenderId: sourcePlayer.id });
  assert(parryStarted.data?.actionId === "parry", "parry should report its action id");
  assert(parryStarted.data?.controlLevel === 3 && parryStarted.data?.armorLevel === 0, "parry event levels should match clamped action windows");
}

function assertRuntimeAttackLunge(sourceScene: Scene, sourcePlayer: Entity): void {
  const world = new RuntimeWorld({ scene: sourceScene });
  const player = requireEntity(world, sourcePlayer.id);
  player.body!.gravityScale = 0;
  player.behavior!.params.gravityScale = 0;
  player.runtime = { ...player.runtime, facing: 1 };
  const startX = player.transform.position.x;
  const attackKey = scopedKey(sourcePlayer, "attack");
  world.setInput(attackKey, true);
  world.runFixedFrame();
  world.setInput(attackKey, false);
  world.runFixedFrame();
  world.runFixedFrames(6);
  const movedPlayer = requireEntity(world, sourcePlayer.id);
  assert(movedPlayer.transform.position.x > startX + 20, "normal attack should lunge the actor forward");
  const target = world.allEntities().find((entity) => entity.tags.includes("movement-target") && entity.parentId === sourcePlayer.id);
  assert(target, "normal attack should spawn an editable movement target marker");
}

function assertBufferedChargeAfterNormalRecovery(sourceScene: Scene, sourcePlayer: Entity): void {
  const world = new RuntimeWorld({ scene: sourceScene });
  const player = requireEntity(world, sourcePlayer.id);
  player.body!.gravityScale = 0;
  player.behavior!.params.gravityScale = 0;
  const attackKey = scopedKey(sourcePlayer, "attack");

  world.setInput(attackKey, true);
  world.runFixedFrame();
  world.setInput(attackKey, false);
  world.runFixedFrame();

  const normalStarted = mustEvent(world, { type: "attackStarted", attackerId: sourcePlayer.id, "data.kind": "normal" });
  const activeUntilMs = normalStarted.data?.activeUntilMs;
  const cooldownUntilMs = normalStarted.data?.cooldownUntilMs;
  assert(typeof activeUntilMs === "number", "normal attack should report active end timing");
  assert(typeof cooldownUntilMs === "number", "normal attack should report cooldown end timing");

  while (world.clock.timeMs < activeUntilMs + world.clock.fixedStepMs) world.runFixedFrame();
  assert(world.clock.timeMs < cooldownUntilMs, "test should press attack during normal attack recovery");

  world.setInput(attackKey, true);
  world.runFixedFrame();
  const bufferStartMs = world.clock.timeMs;
  const bufferedPlayer = requireEntity(world, sourcePlayer.id);
  assert(bufferedPlayer.runtime?.attackBufferedChargeStartMs === bufferStartMs, "recovery attack press should buffer charge start time");

  while (world.clock.timeMs < cooldownUntilMs) world.runFixedFrame();
  const chargingPlayer = requireEntity(world, sourcePlayer.id);
  assert(chargingPlayer.runtime?.chargeStartedMs === bufferStartMs, "buffered charge should begin from the recovery press time");
  assert((chargingPlayer.runtime?.chargeHeldMs ?? 0) > world.clock.fixedStepMs, "buffered charge should count hold time spent in recovery");
  assert(
    world.combatEvents.some((event) => event.type === "chargeStarted" && event.timeMs >= cooldownUntilMs && event.data?.buffered === true),
    "buffered charge start should be reported when recovery ends",
  );

  for (let index = 0; index < 120 && (requireEntity(world, sourcePlayer.id).runtime?.chargeStage ?? 0) < 1; index += 1) {
    world.runFixedFrame();
  }
  world.setInput(attackKey, false);
  world.runFixedFrame();

  const chargedStarted = world.combatEvents.find(
    (event) => event.type === "attackStarted" && event.timeMs > normalStarted.timeMs && event.data?.kind === "charged",
  );
  assert(chargedStarted?.data?.actionId === "chargeAttack", "holding buffered recovery input should release a charged attack next");
}

function assertNormalAttackClashInterrupts(sourceScene: Scene, sourcePlayer: Entity, sourceEnemy: Entity): void {
  const world = new RuntimeWorld({ scene: sourceScene });
  const player = requireEntity(world, sourcePlayer.id);
  const enemy = requireEntity(world, sourceEnemy.id);
  player.body!.gravityScale = 0;
  enemy.body!.gravityScale = 0;
  enemy.behavior!.params.targetInternalName = "";
  player.transform.position = { x: 0, y: 260 };
  enemy.transform.position = { x: 78, y: 260 };
  player.runtime = { ...player.runtime, facing: 1 };
  enemy.runtime = { ...enemy.runtime, facing: -1 };
  const playerAttack = scopedKey(sourcePlayer, "attack");
  const enemyAttack = scopedKey(sourceEnemy, "attack");
  world.setInput(playerAttack, true);
  world.setInput(enemyAttack, true);
  world.runFixedFrame();
  world.setInput(playerAttack, false);
  world.setInput(enemyAttack, false);
  world.runFixedFrame();
  for (let i = 0; i < 20 && !world.combatEvents.some((event) => event.type === "attackClash"); i += 1) {
    world.runFixedFrame();
  }

  const clash = mustEvent(world, { type: "attackClash", attackerId: sourcePlayer.id, defenderId: sourceEnemy.id });
  assert(clash.data?.interrupted === true, "normal attack clash should report an interrupt");
  assert(requireEntity(world, sourcePlayer.id).runtime?.combatAction === undefined, "player attack animation should be interrupted on clash");
  assert(requireEntity(world, sourceEnemy.id).runtime?.combatAction === undefined, "enemy attack animation should be interrupted on clash");
  assert((requireEntity(world, sourcePlayer.id).runtime?.attackCooldownUntilMs ?? 0) > clash.timeMs, "player should get a short clash recovery lock");
  assert(world.screenShakeUntilMs > clash.timeMs, "attack clash should trigger a short screen shake");
  assert(!world.combatEvents.some((event) => event.type === "hit" && (event.attackerId === sourcePlayer.id || event.attackerId === sourceEnemy.id)), "clashed normal attacks should not continue into hit damage");
}

function assertControlArmorResolution(sourceScene: Scene, sourcePlayer: Entity, sourceEnemy: Entity): void {
  const resisted = runArmorHitTrial(sourceScene, sourcePlayer, sourceEnemy, { controlLevel: 1, armorLevel: 2 });
  assert(resisted.hit.data?.damage === 4, "control below armor should apply armor mitigation");
  assert(resisted.hit.data?.resistedDamage === 6, "resisted damage should record the mitigated amount");
  assert(resisted.hit.data?.stunned === false, "control below armor should not stun");
  assert(requireEntity(resisted.world, sourceEnemy.id).runtime?.chargeHeldMs !== undefined, "resisted hit should not clear charge armor");

  const broken = runArmorHitTrial(sourceScene, sourcePlayer, sourceEnemy, { controlLevel: 3, armorLevel: 2 });
  assert(broken.hit.data?.damage === 10, "control above armor should deal full damage");
  assert(broken.hit.data?.resistedDamage === 0, "broken armor should not resist damage");
  assert(broken.hit.data?.stunned === true, "control above armor should stun");
  assert(requireEntity(broken.world, sourceEnemy.id).runtime?.chargeHeldMs === undefined, "stun should clear charge armor");
}

function assertParryControlBoundary(sourceScene: Scene, sourcePlayer: Entity, sourceEnemy: Entity): void {
  const failed = runParryBoundaryTrial(sourceScene, sourcePlayer, sourceEnemy, 2);
  assert(!failed.world.combatEvents.some((event) => event.type === "parrySuccess"), "parry should not catch attacks above parry control level");
  assert(failed.world.combatEvents.some((event) => event.type === "hit" && event.defenderId === sourcePlayer.id), "failed parry boundary should fall through to hit resolution");

  const matched = runParryBoundaryTrial(sourceScene, sourcePlayer, sourceEnemy, 3);
  assert(matched.world.combatEvents.some((event) => event.type === "parrySuccess" && event.attackerId === sourceEnemy.id), "parry should catch attacks at its control level");
  assert(!matched.world.combatEvents.some((event) => event.type === "hit" && event.defenderId === sourcePlayer.id), "successful parry should prevent defender hit damage");
}

function runArmorHitTrial(
  sourceScene: Scene,
  sourcePlayer: Entity,
  sourceEnemy: Entity,
  levels: { controlLevel: number; armorLevel: number },
): { world: RuntimeWorld; hit: CombatEvent } {
  const world = new RuntimeWorld({ scene: sourceScene });
  const player = requireEntity(world, sourcePlayer.id);
  const enemy = requireEntity(world, sourceEnemy.id);
  player.body!.gravityScale = 0;
  enemy.body!.gravityScale = 0;
  delete enemy.behavior!.builtin;
  player.behavior!.params.gravityScale = 0;
  player.behavior!.params.attackDamage = 10;
  player.behavior!.params.attackControlLevel = levels.controlLevel;
  player.behavior!.params.attackHitStunMs = 300;
  player.behavior!.params.attackMoveOffsetX = 0;
  enemy.behavior!.params.health = 20;
  enemy.runtime = {
    ...enemy.runtime,
    health: 20,
    chargeHeldMs: 600,
    chargeStage: 1,
    facing: -1,
  };
  if (levels.armorLevel <= 1) enemy.runtime.chargeHeldMs = 300;
  player.transform.position = { x: 0, y: 260 };
  enemy.transform.position = { x: 78, y: 260 };
  player.runtime = { ...player.runtime, facing: 1 };

  world.setInput(scopedKey(sourcePlayer, "attack"), true);
  world.runFixedFrame();
  world.setInput(scopedKey(sourcePlayer, "attack"), false);
  for (let index = 0; index < 40 && !world.combatEvents.some((event) => event.type === "hit" && event.defenderId === sourceEnemy.id); index += 1) {
    world.runFixedFrame();
  }
  return { world, hit: mustEvent(world, { type: "hit", attackerId: sourcePlayer.id, defenderId: sourceEnemy.id }) };
}

function runParryBoundaryTrial(sourceScene: Scene, sourcePlayer: Entity, sourceEnemy: Entity, parryControlLevel: number): { world: RuntimeWorld } {
  const world = new RuntimeWorld({ scene: sourceScene });
  const player = requireEntity(world, sourcePlayer.id);
  const enemy = requireEntity(world, sourceEnemy.id);
  player.body!.gravityScale = 0;
  enemy.body!.gravityScale = 0;
  enemy.behavior!.builtin = "playerPlatformer";
  player.behavior!.params.gravityScale = 0;
  player.behavior!.params.parryControlLevel = parryControlLevel;
  enemy.behavior!.params.gravityScale = 0;
  enemy.behavior!.params.attackControlLevel = 3;
  enemy.behavior!.params.attackDamage = 10;
  enemy.behavior!.params.attackMoveOffsetX = 0;
  enemy.behavior!.params.attackRange = 120;
  player.transform.position = { x: 0, y: 260 };
  enemy.transform.position = { x: 78, y: 260 };
  player.runtime = { ...player.runtime, facing: 1, health: 20 };
  enemy.runtime = { ...enemy.runtime, facing: -1 };

  world.setInput(scopedKey(sourcePlayer, "parry"), true);
  world.setInput(scopedKey(sourceEnemy, "attack"), true);
  world.runFixedFrame();
  world.setInput(scopedKey(sourcePlayer, "parry"), false);
  world.setInput(scopedKey(sourceEnemy, "attack"), false);
  for (let index = 0; index < 40 && !world.combatEvents.some((event) => event.type === "hit" || event.type === "parrySuccess"); index += 1) {
    world.runFixedFrame();
  }
  return { world };
}

function assertDodgeWindow(sourceScene: Scene, sourcePlayer: Entity, sourceEnemy: Entity): void {
  const world = new RuntimeWorld({ scene: sourceScene });
  const player = requireEntity(world, sourcePlayer.id);
  const enemy = requireEntity(world, sourceEnemy.id);
  player.body!.gravityScale = 0;
  player.behavior!.params.gravityScale = 0;
  enemy.body!.gravityScale = 0;
  enemy.behavior!.params.targetInternalName = "";
  enemy.transform.position.x = player.transform.position.x + 72;
  enemy.transform.position.y = player.transform.position.y;
  enemy.runtime = { ...enemy.runtime, facing: -1 };

  world.setInput(scopedKey(sourceEnemy, "attack"), true);
  world.runFixedFrame();
  world.setInput(scopedKey(sourceEnemy, "attack"), false);
  world.runFixedFrame();
  world.runFixedFrames(6);
  world.setInput(scopedKey(sourcePlayer, "dodge"), true);
  world.runFixedFrame();
  world.setInput(scopedKey(sourcePlayer, "dodge"), false);
  world.runFixedFrames(16);

  const dodgeStarted = mustEvent(world, { type: "dodgeStarted", sourceId: sourcePlayer.id });
  assert(dodgeStarted.data?.actionId === "dodge", "dodge should report its action id");
  assert(requireEntity(world, sourcePlayer.id).runtime?.dodgeUntilMs !== undefined, "dodge should write an invulnerable runtime window");
  assert(!world.combatEvents.some((event) => event.type === "hit" && event.defenderId === sourcePlayer.id), "player should not be hit during the dodge invulnerable window");
}

function assertPerfectDodgeAttackShadow(sourceScene: Scene, sourcePlayer: Entity, sourceEnemy: Entity): void {
  const world = new RuntimeWorld({ scene: sourceScene });
  const player = requireEntity(world, sourcePlayer.id);
  const enemy = requireEntity(world, sourceEnemy.id);
  player.body!.mode = "kinematic";
  enemy.body!.mode = "kinematic";
  player.body!.gravityScale = 0;
  player.behavior!.params.gravityScale = 0;
  enemy.body!.gravityScale = 0;
  enemy.behavior!.params.targetInternalName = "";
  enemy.behavior!.params.left = -999;
  enemy.behavior!.params.right = 999;
  enemy.behavior!.params.attackMoveOffsetX = 0;
  player.transform.position = { x: 0, y: 260 };
  enemy.transform.position = { x: 78, y: 260 };
  player.runtime = { ...player.runtime, facing: -1, health: 20 };
  enemy.runtime = { ...enemy.runtime, facing: -1, patrolDirection: -1 };

  world.setInput(scopedKey(sourcePlayer, "dodge"), true);
  world.setInput(scopedKey(sourceEnemy, "attack"), true);
  world.runFixedFrame();
  world.setInput(scopedKey(sourcePlayer, "dodge"), false);
  world.setInput(scopedKey(sourceEnemy, "attack"), false);
  for (let index = 0; index < 50 && !world.combatEvents.some((event) => event.type === "perfectDodge"); index += 1) {
    world.runFixedFrame();
  }

  const perfect = mustEvent(world, { type: "perfectDodge", attackerId: sourceEnemy.id, defenderId: sourcePlayer.id });
  assert(perfect.data?.window === "attackShadow", "perfect dodge should be driven by the startup attack shadow");
  assert(requireEntity(world, sourcePlayer.id).runtime?.perfectDodgeUntilMs !== undefined, "perfect dodge should drive the gray screen overlay timer");
  world.runFixedFrames(40);
  assert(!world.combatEvents.some((event) => event.type === "hit" && event.attackerId === sourceEnemy.id && event.defenderId === sourcePlayer.id), "perfect dodge should consume that attack for the dodging body");
}

function assertTickRateIndependentTiming(sourceScene: Scene, sourcePlayer: Entity): void {
  const slowScene = cloneJson(sourceScene);
  slowScene.settings.tickRate = 50;
  slowScene.settings.fixedStepMs = 20;

  const world = new RuntimeWorld({ scene: slowScene });
  const attackKey = scopedKey(sourcePlayer, "attack");
  world.setInput(attackKey, true);
  world.runFixedFrame();
  world.setInput(attackKey, false);
  world.runFixedFrame();
  const normalStarted = mustEvent(world, { type: "attackStarted", attackerId: sourcePlayer.id });
  assert(normalStarted.data?.startupMs === 100, "normal attack startup should stay 100ms at 50Hz");
  assert(normalStarted.data?.activeStartMs === normalStarted.timeMs + 100, "active start should be time-based, not tick-count based");

  const chargedWorld = new RuntimeWorld({ scene: slowScene });
  chargedWorld.setInput(attackKey, true);
  chargedWorld.runFixedFrames(31);
  chargedWorld.setInput(attackKey, false);
  chargedWorld.runFixedFrame();
  const chargedStarted = mustEvent(chargedWorld, { type: "attackStarted", attackerId: sourcePlayer.id, "data.kind": "charged" });
  assert(chargedStarted.data?.actionId === "chargeAttack", "600ms charge threshold should still trigger at 50Hz");
}

function activeScene(sourceProject: Project): Scene {
  const scene = sourceProject.scenes[sourceProject.activeSceneId];
  if (!scene) throw new Error(`active scene not found: ${sourceProject.activeSceneId}`);
  return scene;
}

function findByInternalName(sourceScene: Scene, internalName: string): Entity {
  const entity = Object.values(sourceScene.entities).find((item) => item.internalName === internalName);
  if (!entity) throw new Error(`entity not found: ${internalName}`);
  return entity;
}

function requireEntity(world: RuntimeWorld, entityId: string): Entity {
  const entity = world.entityById(entityId);
  if (!entity) throw new Error(`runtime entity not found: ${entityId}`);
  return entity;
}

function scopedKey(entity: Entity, key: string): string {
  return `${entity.id}:${key}`;
}

function mustEvent(world: RuntimeWorld, expected: Partial<CombatEvent> & Record<string, unknown>): CombatEvent {
  const event = world.combatEvents.find((candidate) => eventMatches(candidate, expected));
  if (!event) throw new Error(`combat event not found: ${JSON.stringify(expected)}`);
  return event;
}

function eventMatches(event: CombatEvent, expected: Partial<CombatEvent> & Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (readPath(event, key) !== value) return false;
  }
  return true;
}

function readPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
