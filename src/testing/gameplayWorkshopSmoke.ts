import type { CombatEvent, Entity, Project, Scene } from "../project/schema";
import type { EntityId } from "../shared/types";
import { RuntimeWorld } from "../runtime/world";
import { createStarterProject } from "../editor/starterProject";
import { InteractiveTestRunner } from "./interactiveTestRunner";
import { actorScopedKey } from "./timingSweep";

type SmokeResult = {
  name: string;
  status: "passed" | "failed";
  details: Record<string, unknown>;
  error?: string;
};

const results: SmokeResult[] = [];

runSmoke("runner workshop clears obstacle with frame-stepped control", () => {
  const project = createStarterProject();
  const scene = activeScene(project);
  const world = new RuntimeWorld({ scene });
  const controller = new InteractiveTestRunner({ world });
  const runner = findByInternalName(scene, "Runner_Player");
  const obstacle = findByInternalName(scene, "Runner_Obstacle_Cactus");
  const finish = findByInternalName(scene, "Runner_Finish_Marker");

  controller.step(12);
  const initialHealth = requireEntity(world, runner.id).runtime?.health ?? healthFromBehavior(runner);
  const rightKey = actorScopedKey(runner.id, "right");
  const jumpKey = actorScopedKey(runner.id, "jump");

  controller.press(rightKey);
  const jumpTrigger = controller.stepUntil({
    maxFrames: 120,
    label: "runner reaches jump trigger",
    predicate: () => {
      const liveRunner = requireEntity(world, runner.id);
      const liveObstacle = requireEntity(world, obstacle.id);
      return liveObstacle.transform.position.x - liveRunner.transform.position.x <= 138;
    },
  });
  assert(jumpTrigger.matched, "runner never reached jump trigger");
  const jumpedAt = jumpTrigger.frame;
  controller.tap(jumpKey, 1);

  const finishResult = controller.stepUntil({
    maxFrames: 200,
    label: "runner reaches finish",
    freezeOnMatch: true,
    checks: [
      {
        label: "runner clears obstacle and lands",
        target: { kind: "entity", entityId: runner.id },
        expect: {
          "transform.position.x": { $gt: finish.transform.position.x + 24 },
          grounded: true,
          "state.health": initialHealth,
        },
      },
    ],
  });
  controller.release(rightKey);
  controller.release(jumpKey);
  assert(finishResult.matched, finishResult.logs[0]?.message || "runner did not reach finish in time");

  const finalRunner = requireEntity(world, runner.id);
  return {
    jumpedAt,
    finalFrame: controller.frame,
    finalX: round(finalRunner.transform.position.x),
    obstacleX: obstacle.transform.position.x,
    finishX: finish.transform.position.x,
    grounded: finalRunner.runtime?.grounded === true,
  };
});

runSmoke("combat player short hop turns over quickly", () => {
  const project = createStarterProject();
  const scene = activeScene(project);
  const world = new RuntimeWorld({ scene });
  const controller = new InteractiveTestRunner({ world });
  const player = findByInternalName(scene, "Player");
  const jumpKey = actorScopedKey(player.id, "jump");

  controller.step(12);
  const startY = requireEntity(world, player.id).transform.position.y;
  controller.tap(jumpKey, 1);
  controller.step(20);

  const livePlayer = requireEntity(world, player.id);
  const turnFrame = controller.frame;
  const turnedOrLanded = livePlayer.body!.velocity.y > 0 || livePlayer.runtime?.grounded === true;
  assert(turnedOrLanded, `expected short hop to be falling or landed by frame ${controller.frame}, got velocity ${livePlayer.body!.velocity.y}`);
  if (!livePlayer.runtime?.grounded) assert(livePlayer.transform.position.y < startY, "player should still be above jump start while turning over");

  const landedFrame = livePlayer.runtime?.grounded === true
    ? controller.frame
    : controller.stepUntil({
        maxFrames: 55,
        label: "short hop lands",
        predicate: () => requireEntity(world, player.id).runtime?.grounded === true,
        freezeOnMatch: true,
      }).frame;
  assert(requireEntity(world, player.id).runtime?.grounded === true, "short hop did not land quickly");

  return {
    turnFrame,
    velocityY: round(livePlayer.body!.velocity.y),
    startY: round(startY),
    turnY: round(livePlayer.transform.position.y),
    landedFrame,
  };
});

runSmoke("parry workshop lands 100ms reaction and counter-hit", () => {
  const project = createStarterProject();
  const scene = activeScene(project);
  const world = new RuntimeWorld({ scene });
  const controller = new InteractiveTestRunner({ world });
  const player = findByInternalName(scene, "Player");
  const enemy = findByInternalName(scene, "Enemy_Patrol");

  controller.step(12);
  const initialPlayerHealth = requireEntity(world, player.id).runtime?.health ?? healthFromBehavior(player);
  const initialEnemyHealth = requireEntity(world, enemy.id).runtime?.health ?? healthFromBehavior(enemy);
  const attackKey = actorScopedKey(enemy.id, "attack");
  const parryKey = actorScopedKey(player.id, "parry");
  const counterKey = actorScopedKey(player.id, "attack");
  const attackFrame = controller.frame + 12;
  const parryFrame = attackFrame + 10;
  let counterFrame: number | undefined;

  for (let index = 0; index < 120; index += 1) {
    const frame = controller.frame;
    if (frame === attackFrame) controller.tap(attackKey, 1);
    else if (frame === parryFrame) controller.tap(parryKey, 1);
    else if (counterFrame !== undefined && frame === counterFrame) controller.tap(counterKey, 1);
    else controller.step(1);

    const parrySuccess = controller.findCombatEvent({ type: "parrySuccess", attackerId: enemy.id, defenderId: player.id });
    if (parrySuccess && counterFrame === undefined) counterFrame = controller.frame + 1;

    const counterHit = controller.findCombatEvent({ type: "hit", attackerId: player.id, defenderId: enemy.id });
    if (counterHit) break;
  }

  const parrySuccess = mustCombatEvent(controller, { type: "parrySuccess", attackerId: enemy.id, defenderId: player.id });
  const counterHit = mustCombatEvent(controller, { type: "hit", attackerId: player.id, defenderId: enemy.id });
  const reactionMs = (parryFrame - attackFrame) * controller.fixedStepMs;
  const verification = controller.assert(
    [
      {
        label: "parry success exists",
        target: { kind: "runtime", sceneId: scene.id },
        expect: { combatEvent: { type: "parrySuccess", attackerId: enemy.id, defenderId: player.id } },
      },
      {
        label: "counter hit exists",
        target: { kind: "runtime", sceneId: scene.id },
        expect: { combatEvent: { type: "hit", attackerId: player.id, defenderId: enemy.id } },
      },
      {
        label: "player keeps health after parry",
        target: { kind: "entity", entityId: player.id },
        expect: { "state.health": initialPlayerHealth },
      },
      {
        label: "enemy takes counter damage and stun",
        target: { kind: "entity", entityId: enemy.id },
        expect: {
          "state.health": initialEnemyHealth - 1,
          "state.hitStunUntilFrame": { $gte: parrySuccess.frame },
        },
      },
    ],
    { freeze: true, label: "parry workshop assertions" },
  );

  assert(reactionMs === 100, `expected 100ms reaction, got ${reactionMs}ms`);
  assert(counterHit.frame > parrySuccess.frame, "counter-hit did not occur after parry success");
  assert(verification.passed, verification.logs[0]?.message || "parry workshop assertions failed");

  return {
    attackFrame,
    parryFrame,
    reactionMs,
    parrySuccessFrame: parrySuccess.frame,
    counterHitFrame: counterHit.frame,
    enemyHealthAfter: requireEntity(world, enemy.id).runtime?.health,
    hitStunUntilFrame: requireEntity(world, enemy.id).runtime?.hitStunUntilFrame,
  };
});

runSmoke("combat slice lets player attack damage enemy", () => {
  const project = createStarterProject();
  const scene = activeScene(project);
  const player = findByInternalName(scene, "Player");
  const enemy = findByInternalName(scene, "Enemy_Patrol");
  setupCombatSliceActors(player, enemy, { enemyHealth: 2, autoEnemy: false });
  const world = new RuntimeWorld({ scene });
  const controller = new InteractiveTestRunner({ world });

  const attackKey = actorScopedKey(player.id, "attack");
  controller.tap(attackKey, 1);
  const hitResult = controller.stepUntil({
    maxFrames: 40,
    label: "player attack hits enemy",
    predicate: () => Boolean(controller.findCombatEvent({ type: "hit", attackerId: player.id, defenderId: enemy.id })),
    freezeOnMatch: true,
  });
  assert(hitResult.matched, hitResult.logs[0]?.message || "player attack did not hit enemy");

  const touch = mustCombatEvent(controller, { type: "attackTouch", attackerId: player.id, defenderId: enemy.id });
  const hit = mustCombatEvent(controller, { type: "hit", attackerId: player.id, defenderId: enemy.id });
  assert(touch.frame <= hit.frame, "attack touch should be recorded before damage resolves");
  const touchBoxes = world.allEntities().filter((entity) => !entity.persistent && entity.tags.includes("touch"));
  assert(touchBoxes.length > 0, "player attack should spawn a runtime touch box");
  assert(touch.data?.phase === "active" && touch.data?.window === "hitbox", "attack touch event should describe the active hitbox window");
  assert(
    !world.combatEvents.some((event) => event.type === "hit" && touchBoxes.some((box) => event.defenderId === box.id)),
    "runtime touch boxes should not be treated as damage targets",
  );
  controller.step(10);
  const lingeringTouchBoxes = world.allEntities().filter((entity) => !entity.persistent && entity.tags.includes("touch"));
  assert(lingeringTouchBoxes.length > 0, "attack touch box should linger long enough for visual inspection");

  const liveEnemy = requireEntity(world, enemy.id);
  assert(liveEnemy.runtime?.health === 1, `expected enemy health 1 after hit, got ${liveEnemy.runtime?.health}`);
  assert(!liveEnemy.runtime?.defeated, "enemy should survive the first hit");

  return {
    touchFrame: touch.frame,
    hitFrame: hit.frame,
    touchBoxCount: touchBoxes.length,
    lingeringTouchBoxCount: lingeringTouchBoxes.length,
    enemyHealth: liveEnemy.runtime?.health,
  };
});

runSmoke("combat slice auto enemy can be parried and defeated", () => {
  const project = createStarterProject();
  const scene = activeScene(project);
  const player = findByInternalName(scene, "Player");
  const enemy = findByInternalName(scene, "Enemy_Patrol");
  setupCombatSliceActors(player, enemy, { enemyHealth: 1, autoEnemy: true });
  const world = new RuntimeWorld({ scene });
  const controller = new InteractiveTestRunner({ world });

  const parryKey = actorScopedKey(player.id, "parry");
  const attackKey = actorScopedKey(player.id, "attack");
  const initialPlayerHealth = requireEntity(world, player.id).runtime?.health ?? healthFromBehavior(player);
  let parryQueuedFor: number | undefined;
  let counterQueuedFor: number | undefined;

  for (let index = 0; index < 120; index += 1) {
    const frame = controller.frame;
    const enemyAttack = controller.findCombatEvent({ type: "attackStarted", attackerId: enemy.id });
    if (enemyAttack && parryQueuedFor === undefined) parryQueuedFor = enemyAttack.frame + 10;
    const parrySuccess = controller.findCombatEvent({ type: "parrySuccess", attackerId: enemy.id, defenderId: player.id });
    if (parrySuccess && counterQueuedFor === undefined) counterQueuedFor = frame + 1;

    if (parryQueuedFor !== undefined && frame === parryQueuedFor) controller.tap(parryKey, 1);
    else if (counterQueuedFor !== undefined && frame === counterQueuedFor) controller.tap(attackKey, 1);
    else controller.step(1);

    if (controller.findCombatEvent({ type: "defeated", attackerId: player.id, defenderId: enemy.id })) break;
  }

  const parrySuccess = mustCombatEvent(controller, { type: "parrySuccess", attackerId: enemy.id, defenderId: player.id });
  const defeated = mustCombatEvent(controller, { type: "defeated", attackerId: player.id, defenderId: enemy.id });
  const livePlayer = requireEntity(world, player.id);
  const liveEnemy = requireEntity(world, enemy.id);
  assert(livePlayer.runtime?.health === initialPlayerHealth, "player should keep health after parry");
  assert(liveEnemy.runtime?.defeated === true, "enemy should be marked defeated");
  assert(defeated.frame > parrySuccess.frame, "defeat should happen after parry success");

  return {
    parryFrame: parrySuccess.frame,
    defeatedFrame: defeated.frame,
    playerHealth: livePlayer.runtime?.health,
    enemyDefeated: liveEnemy.runtime?.defeated,
  };
});

runSmoke("scoped inputs keep runner and combat zones isolated", () => {
  const project = createStarterProject();
  const scene = activeScene(project);
  const world = new RuntimeWorld({ scene });
  const controller = new InteractiveTestRunner({ world });
  const runner = findByInternalName(scene, "Runner_Player");
  const player = findByInternalName(scene, "Player");
  const enemy = findByInternalName(scene, "Enemy_Patrol");

  controller.step(12);
  const initialPlayerX = requireEntity(world, player.id).transform.position.x;
  const initialEnemyX = requireEntity(world, enemy.id).transform.position.x;
  const initialRunnerX = requireEntity(world, runner.id).transform.position.x;

  const runnerRightKey = actorScopedKey(runner.id, "right");
  const runnerJumpKey = actorScopedKey(runner.id, "jump");
  controller.press(runnerRightKey);
  for (let index = 0; index < 45; index += 1) {
    if (index === 18) controller.tap(runnerJumpKey, 1);
    else controller.step(1);
  }
  controller.release(runnerRightKey);
  controller.release(runnerJumpKey);

  const isolation = controller.assert(
    [
      {
        label: "runner advances under scoped input",
        target: { kind: "entity", entityId: runner.id },
        expect: { "transform.position.x": { $gt: initialRunnerX + 120 } },
      },
      {
        label: "combat player does not drift",
        target: { kind: "entity", entityId: player.id },
        expect: { "transform.position.x": { $approx: { value: initialPlayerX, tolerance: 0.001 } } },
      },
      {
        label: "combat attacker does not drift",
        target: { kind: "entity", entityId: enemy.id },
        expect: { "transform.position.x": { $approx: { value: initialEnemyX, tolerance: 0.001 } } },
      },
      {
        label: "runner input does not create combat events",
        target: { kind: "runtime", sceneId: scene.id },
        expect: { combatEvent: false },
      },
    ],
    { freeze: true, label: "zone isolation assertions" },
  );
  assert(isolation.passed, isolation.logs[0]?.message || "zone isolation assertions failed");

  return {
    initialRunnerX: round(initialRunnerX),
    runnerAfterRun: round(requireEntity(world, runner.id).transform.position.x),
    playerAfterRun: round(requireEntity(world, player.id).transform.position.x),
    enemyAfterRun: round(requireEntity(world, enemy.id).transform.position.x),
    combatEvents: world.combatEvents.length,
  };
});

console.log(JSON.stringify({ status: results.every((result) => result.status === "passed") ? "passed" : "failed", results }, null, 2));

const failedCount = results.filter((result) => result.status === "failed").length;
if (failedCount > 0) throw new Error(`${failedCount} gameplay workshop smoke check(s) failed`);

function runSmoke(name: string, fn: () => Record<string, unknown>): void {
  try {
    results.push({ name, status: "passed", details: fn() });
  } catch (error) {
    results.push({
      name,
      status: "failed",
      details: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function activeScene(project: Project): Scene {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);
  return scene;
}

function findByInternalName(scene: Scene, internalName: string): Entity {
  const entity = Object.values(scene.entities).find((item) => item.internalName === internalName);
  if (!entity) throw new Error(`entity not found: ${internalName}`);
  return entity;
}

function requireEntity(world: RuntimeWorld, entityId: string): Entity {
  const entity = world.entityById(entityId as EntityId);
  if (!entity) throw new Error(`runtime entity not found: ${entityId}`);
  return entity;
}

function mustCombatEvent(controller: InteractiveTestRunner, expected: Partial<CombatEvent>): CombatEvent {
  const event = controller.findCombatEvent(expected);
  if (!event) throw new Error(`combat event not found: ${JSON.stringify(expected)}`);
  return event;
}

function setupCombatSliceActors(player: Entity, enemy: Entity, options: { enemyHealth: number; autoEnemy: boolean }): void {
  player.transform.position = { x: 0, y: 240 };
  player.body!.velocity = { x: 0, y: 0 };
  player.runtime = {
    ...player.runtime,
    health: 3,
    facing: 1,
    defeated: false,
    attackStartFrame: undefined,
    attackActiveUntilFrame: undefined,
    attackCooldownUntilFrame: undefined,
    parryUntilFrame: undefined,
    parryCooldownUntilFrame: undefined,
  };
  player.behavior!.params = {
    ...player.behavior!.params,
    health: 3,
    attackStartupFrames: 4,
    attackActiveFrames: 5,
    attackCooldownFrames: 16,
    attackRange: 128,
    attackHeight: 90,
    attackDamage: 1,
    parryWindowFrames: 7,
    parryCooldownFrames: 16,
  };

  enemy.transform.position = { x: 118, y: 240 };
  enemy.body!.velocity = { x: 0, y: 0 };
  enemy.runtime = {
    ...enemy.runtime,
    health: options.enemyHealth,
    facing: -1,
    patrolDirection: -1,
    defeated: false,
    attackStartFrame: undefined,
    attackActiveUntilFrame: undefined,
    attackCooldownUntilFrame: undefined,
  };
  enemy.behavior!.params = {
    ...enemy.behavior!.params,
    speed: options.autoEnemy ? 90 : 0,
    left: 118,
    right: 118,
    health: options.enemyHealth,
    attackStartupFrames: 12,
    attackActiveFrames: 5,
    attackCooldownFrames: 28,
    attackRange: 128,
    attackHeight: 90,
    attackDamage: 1,
    parryStunFrames: 18,
    ...(options.autoEnemy
      ? {
          targetInternalName: "Player",
          aggroRange: 360,
          preferredDistance: 86,
        }
      : {}),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function healthFromBehavior(entity: Entity): number {
  const health = entity.behavior?.params.health;
  return typeof health === "number" ? health : 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
