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
assertRuntimeActionContext(scene, player);
assertRuntimeAttackLunge(scene, player);
assertDodgeWindow(scene, player, enemy);
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
  assert(normal.windows.some((window) => window.type === "movement" && window.phase === "startup"), "normal attack should expose a movement window");
  assert(normal.data?.moveOffsetX === 36 && normal.data?.moveDurationMs === 100, "normal attack should default to a short 100ms lunge");
  assert(normal.windows.some((window) => window.type === "armor" && window.armorLevel === 1), "normal attack should carry level 1 armor");

  assert(combatPhaseDurationMs(charged, "startup") === 200, "charged attack startup should follow the time table");
  assert(combatPhaseDurationMs(charged, "active") === 500, "charged attack active window should follow the time table");
  assert(charged.data?.chargeStage === 2, "charged action should preserve charge stage");
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
  assert(livePlayer.runtime.combatAction.windows.some((window) => window.type === "hitbox"), "runtime action context should include hitbox windows");
  assert(livePlayer.runtime.combatAction.windows.some((window) => window.type === "movement"), "runtime action context should include movement windows");

  const chargedWorld = new RuntimeWorld({ scene: sourceScene });
  chargedWorld.setInput(attackKey, true);
  chargedWorld.runFixedFrames(65);
  chargedWorld.setInput(attackKey, false);
  chargedWorld.runFixedFrame();
  const chargedStarted = mustEvent(chargedWorld, { type: "attackStarted", attackerId: sourcePlayer.id, "data.kind": "charged" });
  assert(chargedStarted.data?.actionId === "chargeAttack", "charged release should report the charge action id");

  const parryWorld = new RuntimeWorld({ scene: sourceScene });
  parryWorld.setInput(scopedKey(sourcePlayer, "parry"), true);
  parryWorld.runFixedFrame();
  parryWorld.setInput(scopedKey(sourcePlayer, "parry"), false);
  parryWorld.runFixedFrame();
  const parryStarted = mustEvent(parryWorld, { type: "parryStarted", defenderId: sourcePlayer.id });
  assert(parryStarted.data?.actionId === "parry", "parry should report its action id");
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
