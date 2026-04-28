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

type CombatTrialResult = {
  attackFrame: number;
  parryFrame: number;
  parrySuccessFrame?: number;
  playerHitFrame?: number;
  counterHitFrame?: number;
  playerHealthAfter?: number;
  enemyHealthAfter?: number;
};

const results: SmokeResult[] = [];

runSmoke("scaled timeline can seek, rewind, and preserve deterministic runner state", () => {
  const scene = activeScene(createStarterProject());
  const world = new RuntimeWorld({ scene });
  const controller = new InteractiveTestRunner({ world, timeScale: 12 });
  const runner = findByInternalName(scene, "Runner_Player");
  const rightKey = actorScopedKey(runner.id, "right");

  controller.press(rightKey);
  const firstAdvance = controller.stepScaledDuration(480, { rounding: "ceil" });
  const bookmark = controller.bookmark("runner-4f");
  const secondAdvance = controller.seekToScaledTimeMs(1200, { rounding: "ceil" });
  const rewind = controller.seekToScaledTimeMs(600, { allowRewind: true, rounding: "ceil" });
  controller.release(rightKey);

  assert(firstAdvance.frame === 4, `expected frame 4 after first scaled step, got ${firstAdvance.frame}`);
  assert(firstAdvance.scaledTimeMs === 480, `expected scaled time 480ms, got ${firstAdvance.scaledTimeMs}`);
  assert(bookmark.frame === 4, `expected bookmark at frame 4, got ${bookmark.frame}`);
  assert(secondAdvance.frame === 10, `expected seek target frame 10, got ${secondAdvance.frame}`);
  assert(secondAdvance.scaledTimeMs === 1200, `expected scaled seek time 1200ms, got ${secondAdvance.scaledTimeMs}`);
  assert(rewind.rewound, "expected scaled seek to rewind");
  assert(rewind.rewindBookmark === "runner-4f", `expected rewind from runner-4f, got ${rewind.rewindBookmark}`);
  assert(rewind.frame === 5, `expected rewind seek to land on frame 5, got ${rewind.frame}`);
  assert(rewind.scaledTimeMs === 600, `expected rewind scaled time 600ms, got ${rewind.scaledTimeMs}`);

  const bookmarkX = bookmark.snapshot.entities[runner.id]?.transform.position.x;
  const rewindX = requireEntity(world, runner.id).transform.position.x;
  assert(typeof bookmarkX === "number", "runner bookmark position missing");
  assert(rewindX > bookmarkX, "runner did not advance after rewound seek replay");

  return {
    fixedStepMs: controller.fixedStepMs,
    scaledFixedStepMs: controller.scaledFixedStepMs,
    firstAdvanceFrame: firstAdvance.frame,
    secondAdvanceFrame: secondAdvance.frame,
    rewindFrame: rewind.frame,
    bookmarkX: round(bookmarkX),
    rewindX: round(rewindX),
  };
});

runSmoke("combat bookmark can replay parry trials with stable outcomes", () => {
  const scene = activeScene(createStarterProject());
  const world = new RuntimeWorld({ scene });
  const controller = new InteractiveTestRunner({ world, timeScale: 12 });
  const player = findByInternalName(scene, "Player");
  const enemy = findByInternalName(scene, "Enemy_Patrol");

  controller.step(12);
  controller.bookmark("combat-start", { freeze: true });

  const successA = runCombatTrial(controller, world, player.id, enemy.id, 10);
  const successB = runCombatTrial(controller, world, player.id, enemy.id, 10);
  const lateFail = runCombatTrial(controller, world, player.id, enemy.id, 16);

  assert(successA.parrySuccessFrame !== undefined, "expected first combat replay to parry successfully");
  assert(successB.parrySuccessFrame !== undefined, "expected second combat replay to parry successfully");
  assert(successA.parrySuccessFrame === successB.parrySuccessFrame, "parry success frame changed between identical replays");
  assert(successA.counterHitFrame === successB.counterHitFrame, "counter-hit frame changed between identical replays");
  assert(lateFail.parrySuccessFrame === undefined, "late replay should not produce parry success");
  assert(typeof lateFail.playerHitFrame === "number", "late replay should produce an enemy hit");

  return {
    successParryFrame: successA.parrySuccessFrame,
    successCounterFrame: successA.counterHitFrame,
    repeatParryFrame: successB.parrySuccessFrame,
    lateFailHitFrame: lateFail.playerHitFrame,
    lateFailPlayerHealth: lateFail.playerHealthAfter,
  };
});

console.log(JSON.stringify({ status: results.every((result) => result.status === "passed") ? "passed" : "failed", results }, null, 2));

const failedCount = results.filter((result) => result.status === "failed").length;
if (failedCount > 0) throw new Error(`${failedCount} interactive time control smoke check(s) failed`);

function runCombatTrial(
  controller: InteractiveTestRunner,
  world: RuntimeWorld,
  playerId: EntityId,
  enemyId: EntityId,
  parryOffsetFrames: number,
): CombatTrialResult {
  controller.restoreBookmark("combat-start");
  controller.resume();

  const attackKey = actorScopedKey(enemyId, "attack");
  const parryKey = actorScopedKey(playerId, "parry");
  const counterKey = actorScopedKey(playerId, "attack");
  const attackFrame = controller.frame + 12;
  const parryFrame = attackFrame + parryOffsetFrames;
  let counterFrame: number | undefined;

  for (let index = 0; index < 120; index += 1) {
    const frame = controller.frame;
    let acted = false;
    if (frame === attackFrame) {
      controller.tap(attackKey, 1);
      acted = true;
    } else if (frame === parryFrame) {
      controller.tap(parryKey, 1);
      acted = true;
    } else if (counterFrame !== undefined && frame === counterFrame) {
      controller.tap(counterKey, 1);
      acted = true;
    }
    if (!acted) controller.step(1);

    const parrySuccess = controller.findCombatEvent({ type: "parrySuccess", attackerId: enemyId, defenderId: playerId });
    if (parrySuccess && counterFrame === undefined) counterFrame = controller.frame + 1;

    const counterHit = controller.findCombatEvent({ type: "hit", attackerId: playerId, defenderId: enemyId });
    const playerHit = controller.findCombatEvent({ type: "hit", attackerId: enemyId, defenderId: playerId });
    if (counterHit || playerHit) break;
  }

  controller.freeze(`combat trial ${parryOffsetFrames}`);
  const player = requireEntity(world, playerId);
  const enemy = requireEntity(world, enemyId);
  return {
    attackFrame,
    parryFrame,
    parrySuccessFrame: findCombatEventFrame(controller, { type: "parrySuccess", attackerId: enemyId, defenderId: playerId }),
    playerHitFrame: findCombatEventFrame(controller, { type: "hit", attackerId: enemyId, defenderId: playerId }),
    counterHitFrame: findCombatEventFrame(controller, { type: "hit", attackerId: playerId, defenderId: enemyId }),
    playerHealthAfter: player.runtime?.health,
    enemyHealthAfter: enemy.runtime?.health,
  };
}

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

function requireEntity(world: RuntimeWorld, entityId: EntityId): Entity {
  const entity = world.entityById(entityId);
  if (!entity) throw new Error(`runtime entity not found: ${entityId}`);
  return entity;
}

function findCombatEventFrame(controller: InteractiveTestRunner, expected: Partial<CombatEvent>): number | undefined {
  return controller.findCombatEvent(expected)?.frame;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
