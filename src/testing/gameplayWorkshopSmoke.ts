import type { CombatEvent, Entity, Project, Scene } from "../project/schema";
import type { EntityId } from "../shared/types";
import { RuntimeWorld } from "../runtime/world";
import { createStarterProject } from "../v2/starterProject";
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
