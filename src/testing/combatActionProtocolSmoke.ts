import { combatActionDefForEntity, combatPhaseFrames } from "../combat/actions";
import type { CombatEvent, Entity, Project, Scene } from "../project/schema";
import { createStarterProject } from "../editor/starterProject";
import { RuntimeWorld } from "../runtime/world";

const project = createStarterProject();
const scene = activeScene(project);
const player = findByInternalName(scene, "Player");
const enemy = findByInternalName(scene, "Enemy_Patrol");

assertActionDefinitions(player);
assertRuntimeActionContext(scene, player);
assertDodgeWindow(scene, player, enemy);

console.log("combat action protocol smoke passed");

function assertActionDefinitions(entity: Entity): void {
  const normal = combatActionDefForEntity(entity, "normalAttack");
  const charged = combatActionDefForEntity(entity, "chargeAttack", { chargeStage: 2 });
  const parry = combatActionDefForEntity(entity, "parry");
  const dodge = combatActionDefForEntity(entity, "dodge");

  assert(combatPhaseFrames(normal, "startup") === 10, "normal attack startup should follow the doc table");
  assert(combatPhaseFrames(normal, "active") === 30, "normal attack active window should follow the doc table");
  assert(combatPhaseFrames(normal, "recovery") === 20, "normal attack recovery should follow the doc table");
  assert(normal.windows.some((window) => window.type === "hitbox" && window.phase === "active"), "normal attack needs an active hitbox window");
  assert(normal.windows.some((window) => window.type === "armor" && window.armorLevel === 1), "normal attack should carry level 1 armor");

  assert(combatPhaseFrames(charged, "startup") === 20, "charged attack startup should follow the doc table");
  assert(combatPhaseFrames(charged, "active") === 50, "charged attack active window should follow the doc table");
  assert(charged.data?.chargeStage === 2, "charged action should preserve charge stage");
  assert(charged.windows.some((window) => window.type === "hitbox" && window.controlLevel === 3), "charged hitbox should carry level 3 control");

  assert(combatPhaseFrames(parry, "active") === 20, "parry active window should be 0.2s / 20 frames");
  assert(parry.windows.some((window) => window.type === "parry" && window.controlLevel === 3), "parry should counter control level 3 and below");

  assert(combatPhaseFrames(dodge, "evade") === 18, "dodge should expose an invulnerable evade phase");
  assert(dodge.windows.some((window) => window.type === "invulnerable"), "dodge should have an invulnerable window");
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
  const livePlayer = requireEntity(world, sourcePlayer.id);
  assert(livePlayer.runtime?.combatAction?.actionId === "normalAttack", "runtime should store the current action context");
  assert(livePlayer.runtime.combatAction.windows.some((window) => window.type === "hitbox"), "runtime action context should include hitbox windows");

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
  assert(requireEntity(world, sourcePlayer.id).runtime?.dodgeUntilFrame !== undefined, "dodge should write an invulnerable runtime window");
  assert(!world.combatEvents.some((event) => event.type === "hit" && event.defenderId === sourcePlayer.id), "player should not be hit during the dodge invulnerable window");
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
