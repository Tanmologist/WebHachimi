import type { Entity, Project, RuntimeSnapshot, Scene } from "../project/schema";
import type { EntityId } from "../shared/types";
import { RuntimeWorld } from "../runtime/world";
import { createStarterProject } from "../v2/starterProject";
import { SimulationTestRunner } from "./simulationTestRunner";
import {
  planScriptedReaction,
  runReactionWindowSweep,
  runRepeatedScriptedReactionPlan,
  summarizeReactionWindowBounds,
} from "./timingSweep";

type SmokeResult = {
  name: string;
  status: "passed" | "failed";
  details: Record<string, unknown>;
  error?: string;
};

const results: SmokeResult[] = [];

runSmoke("wide sweep finds contiguous parry window and failures on both extremes", () => {
  const { scene, player, enemy } = combatPair();
  const planned = requirePlan(
    planScriptedReaction(scene, {
      attackerId: enemy.id,
      defenderId: player.id,
      attackKey: "attack",
      defenseKey: "parry",
      attackStartFrame: 4,
      defenseOffset: 0,
      defenderTarget: { kind: "entity", entityId: player.id },
      successChecks: [parrySuccessCheck(scene, enemy.id, player.id)],
    }),
  );

  const sweep = runReactionWindowSweep({
    scene,
    config: {
      attackerId: enemy.id,
      defenderId: player.id,
      attackKey: "attack",
      defenseKey: "parry",
      attackStartFrame: 4,
      expectedImpactFrame: planned.impactFrame - 1,
      defenseOffsets: [-20, -18, -16, -14, -12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8],
      defenderTarget: { kind: "entity", entityId: player.id },
      successChecks: [parrySuccessCheck(scene, enemy.id, player.id)],
    },
  });
  const bounds = summarizeReactionWindowBounds(sweep);

  assert(bounds.contiguousPassWindow, `expected contiguous pass window, gaps=${bounds.gapOffsets.join(",")}`);
  assert(bounds.firstPassingOffset === -10, `expected earliest passing offset -10, got ${String(bounds.firstPassingOffset)}`);
  assert(bounds.lastPassingOffset === 0, `expected latest passing offset 0, got ${String(bounds.lastPassingOffset)}`);
  assert(bounds.firstFailBefore === -12, `expected first fail before window at -12, got ${String(bounds.firstFailBefore)}`);
  assert(bounds.firstFailAfter === 2, `expected first fail after window at 2, got ${String(bounds.firstFailAfter)}`);

  return {
    firstPassingOffset: bounds.firstPassingOffset,
    lastPassingOffset: bounds.lastPassingOffset,
    firstFailBefore: bounds.firstFailBefore,
    firstFailAfter: bounds.firstFailAfter,
    passingOffsets: bounds.passingOffsets,
  };
});

runSmoke("frozen snapshot pass case stays deterministic across repeated replays", () => {
  const { scene, player, enemy } = combatPair();
  const initialSnapshot = freezeCombatSnapshot(scene, 12);
  const repeated = requirePlan(
    runRepeatedScriptedReactionPlan({
      scene,
      iterations: 24,
      config: {
        attackerId: enemy.id,
        defenderId: player.id,
        attackKey: "attack",
        defenseKey: "parry",
        attackStartFrame: initialSnapshot.frame + 12,
        defenseOffset: 0,
        defenderTarget: { kind: "entity", entityId: player.id },
        successChecks: [parrySuccessCheck(scene, enemy.id, player.id)],
        initialSnapshot,
      },
    }),
  );

  assert(repeated.status === "passed", `expected repeated pass case to pass, got ${repeated.status}`);
  assert(repeated.stable, `expected repeated pass case to stay stable, mismatches=${repeated.mismatchIterations.join(",")}`);
  assert(repeated.iterations.every((item) => item.status === "passed"), "expected every repeated pass iteration to pass");

  return {
    iterations: repeated.iterations.length,
    stable: repeated.stable,
    baselineSignatureLength: repeated.baselineSignature?.length || 0,
  };
});

runSmoke("frozen snapshot negative control stays deterministic outside the parry window", () => {
  const { scene, player, enemy } = combatPair();
  const initialSnapshot = freezeCombatSnapshot(scene, 12);
  const repeated = requirePlan(
    runRepeatedScriptedReactionPlan({
      scene,
      iterations: 12,
      config: {
        attackerId: enemy.id,
        defenderId: player.id,
        attackKey: "attack",
        defenseKey: "parry",
        attackStartFrame: initialSnapshot.frame + 12,
        defenseOffset: 4,
        defenderTarget: { kind: "entity", entityId: player.id },
        successChecks: [parrySuccessCheck(scene, enemy.id, player.id)],
        initialSnapshot,
      },
    }),
  );

  assert(repeated.status === "failed", `expected negative control to fail, got ${repeated.status}`);
  assert(repeated.stable, `expected negative control to stay stable, mismatches=${repeated.mismatchIterations.join(",")}`);
  assert(repeated.iterations.every((item) => item.status === "failed"), "expected every negative-control iteration to fail");

  return {
    iterations: repeated.iterations.length,
    stable: repeated.stable,
    failureSnapshotRefs: repeated.iterations.slice(0, 3).map((item) => item.failureSnapshotRef),
  };
});

runSmoke("unsupported input steps interrupt instead of false-passing", () => {
  const scene = activeScene(createStarterProject());
  const world = new RuntimeWorld({ scene });
  const result = new SimulationTestRunner().run({
    world,
    script: {
      steps: [{ op: "wait", ticks: 1 }, { op: "rewindToBookmark", label: "bookmark-x" } as never],
    },
  });

  const lastLog = result.record.logs[result.record.logs.length - 1];
  assert(result.record.result === "interrupted", `expected interrupted, got ${result.record.result}`);
  assert(lastLog?.message.includes("Unsupported input step op"), "expected unsupported-step error log");
  assert(Boolean(result.record.failureSnapshotRef), "expected failureSnapshotRef for interrupted script");

  return {
    result: result.record.result,
    failureSnapshotRef: result.record.failureSnapshotRef,
    lastLog: lastLog?.message,
  };
});

runSmoke("unreachable impact plans fail fast instead of hanging", () => {
  const { scene, player, enemy } = combatPair();
  const planned = planScriptedReaction(scene, {
    attackerId: enemy.id,
    defenderId: player.id,
    attackKey: "attack",
    defenseKey: "parry",
    attackStartFrame: 120,
    defenseOffset: 0,
    defenderTarget: { kind: "entity", entityId: player.id },
    successChecks: [parrySuccessCheck(scene, enemy.id, player.id)],
    maxProbeFrames: 20,
  });

  assert(!planned.ok, "expected unreachable impact plan to fail");

  return {
    error: planned.error,
  };
});

console.log(JSON.stringify({ status: results.every((result) => result.status === "passed") ? "passed" : "failed", results }, null, 2));

const failedCount = results.filter((result) => result.status === "failed").length;
if (failedCount > 0) throw new Error(`${failedCount} extreme timing smoke check(s) failed`);

function activeScene(project: Project): Scene {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);
  return scene;
}

function combatPair(): { scene: Scene; player: Entity; enemy: Entity } {
  const scene = activeScene(createStarterProject());
  const entities = Object.values(scene.entities);
  const player = entities.find((entity) => entity.behavior?.builtin === "playerPlatformer" && entity.tags.includes("combat"));
  const enemy = entities.find((entity) => entity.behavior?.builtin === "enemyPatrol" && entity.tags.includes("combat"));
  if (!player || !enemy) throw new Error("combat pair not found in starter project");
  return { scene, player, enemy };
}

function freezeCombatSnapshot(scene: Scene, frames: number): RuntimeSnapshot {
  const world = new RuntimeWorld({ scene });
  world.runFixedTicks(frames);
  return world.freezeForInspection();
}

function parrySuccessCheck(scene: Scene, attackerId: EntityId, defenderId: EntityId) {
  return {
    label: "parry success event exists",
    target: { kind: "runtime" as const, sceneId: scene.id },
    expect: { combatEvent: { type: "parrySuccess", attackerId, defenderId } },
  };
}

function requirePlan<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
