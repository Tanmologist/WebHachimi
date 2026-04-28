import { AiTaskExecutor } from "../ai/taskExecutor";
import { ProjectStore } from "../project/projectStore";
import { planScriptedReaction } from "./timingSweep";
import { createStarterProject } from "../v2/starterProject";

const project = createStarterProject();
const store = new ProjectStore(project);
const ai = new AiTaskExecutor({ store });
const scene = project.scenes[project.activeSceneId];
const entities = Object.values(scene.entities);
const player = entities.find((entity) => entity.behavior?.builtin === "playerPlatformer");
const enemy = entities.find((entity) => entity.behavior?.builtin === "enemyPatrol");

if (!player || !enemy) throw new Error("smoke sweep requires starter player and enemy");

const attackStartTick = Math.max(1, Math.round((4 * (scene.settings.tickRate || 100)) / 60));
const plannedImpact = planScriptedReaction(scene, {
  attackerId: enemy.id,
  defenderId: player.id,
  attackKey: "attack",
  defenseKey: "parry",
  attackStartFrame: attackStartTick,
  defenseOffset: 0,
  defenderTarget: { kind: "entity", entityId: player.id },
  successChecks: [
    {
      label: "parry success event exists",
      target: { kind: "runtime", sceneId: scene.id },
      expect: { combatEvent: { type: "parrySuccess", attackerId: enemy.id, defenderId: player.id } },
    },
  ],
});
if (!plannedImpact.ok) throw new Error(plannedImpact.error);

const sweep = ai.runReactionWindowSweep({
  attackerId: enemy.id,
  defenderId: player.id,
  attackKey: "attack",
  defenseKey: "parry",
  attackStartFrame: attackStartTick,
  expectedImpactFrame: plannedImpact.value.impactFrame - 1,
  defenseOffsets: [-10, -8, -6, -4, -2, 0, 2, 4, 6],
  defenderTarget: { kind: "entity", entityId: player.id },
  successChecks: [
    {
      label: "parry success event exists",
      target: { kind: "runtime", sceneId: scene.id },
      expect: { combatEvent: { type: "parrySuccess", attackerId: enemy.id, defenderId: player.id } },
    },
  ],
});

if (!sweep.ok) throw new Error(sweep.error);

const expected = new Map<number, "passed" | "failed">([
  [-10, "failed"],
  [-8, "passed"],
  [-6, "passed"],
  [-4, "passed"],
  [-2, "passed"],
  [0, "passed"],
  [2, "failed"],
  [4, "failed"],
  [6, "failed"],
]);
const actual = new Map(sweep.value.cases.map((item) => [item.defenseOffset, item.status]));
for (const [offset, status] of expected) {
  if (actual.get(offset) !== status) {
    throw new Error(`offset ${offset} expected ${status}, got ${actual.get(offset)}`);
  }
}

const cases = sweep.value.cases.map((item) => {
  const expectedStatus = expected.get(item.defenseOffset);
  return {
    offset: item.defenseOffset,
    actual: item.status,
    expected: expectedStatus,
    matched: item.status === expectedStatus,
  };
});

console.log(
  JSON.stringify(
    {
      status: "passed",
      meaning: "The reaction-window expectations matched. Failed cases are intentional negative controls outside the parry window.",
      rawSweepStatus: sweep.value.status,
      cases,
    },
    null,
    2,
  ),
);
