// Owns the policy for selecting autonomous verification cases from scene/task
// context. Keeping this decision logic separate lets AI and verification
// runners evolve independently from editor presentation.
import type { Scene, Task, Transaction, VerificationPlan, VerificationTestIntent } from "../project/schema";

export type AutonomousTestPlan = {
  runStructure: boolean;
  runProjectVerification: boolean;
  runReaction: boolean;
  runReactionBoundary: boolean;
  reasons: string[];
};

export type PlanAutonomousTestsInput = {
  scene: Scene;
  task?: Task;
  transaction?: Transaction;
  verificationPlan?: VerificationPlan;
  includeReactionCase?: boolean;
  includeReactionBoundaryCase?: boolean;
};

export function planAutonomousTests(input: PlanAutonomousTestsInput): AutonomousTestPlan {
  const intents = new Set<VerificationTestIntent>(input.verificationPlan?.testIntents || []);
  const hasTaskContext = Boolean(input.task || input.verificationPlan || input.transaction);
  const combatRelevant = hasCombatPair(input.scene) && hasCombatIntent(input, intents);
  const projectCheckable = Boolean(
    input.verificationPlan?.projectChecks.length && (!input.transaction || input.transaction.status === "applied"),
  );
  const defaultSelfTest = !hasTaskContext;
  const reactionFamilyDisabled = input.includeReactionCase === false && input.includeReactionBoundaryCase !== true;
  const runReaction =
    input.includeReactionCase === false ? false : input.includeReactionCase === true || defaultSelfTest || combatRelevant;
  const runReactionBoundary =
    reactionFamilyDisabled || input.includeReactionBoundaryCase === false
      ? false
      : input.includeReactionBoundaryCase === true || defaultSelfTest || (combatRelevant && (intents.has("timing") || intents.has("combat")));

  return {
    runStructure: true,
    runProjectVerification: projectCheckable,
    runReaction,
    runReactionBoundary,
    reasons: buildReasons({
      hasTaskContext,
      projectCheckable,
      runReaction,
      runReactionBoundary,
      combatRelevant,
      intents,
    }),
  };
}

function hasCombatIntent(input: PlanAutonomousTestsInput, intents: Set<VerificationTestIntent>): boolean {
  if (intents.has("combat") || intents.has("timing")) return true;
  const text = `${input.task?.normalizedText || ""} ${input.task?.userText || ""} ${input.transaction?.diffSummary || ""}`.toLowerCase();
  return /\b(?:combat|attack|parry|hit|enemy)\b/i.test(text) || ["战斗", "攻击", "格挡", "弹反", "敌人"].some((needle) => text.includes(needle));
}

function hasCombatPair(scene: Scene): boolean {
  const entities = Object.values(scene.entities);
  return (
    entities.some((entity) => entity.behavior?.builtin === "playerPlatformer") &&
    entities.some((entity) => entity.behavior?.builtin === "enemyPatrol")
  );
}

function buildReasons(input: {
  hasTaskContext: boolean;
  projectCheckable: boolean;
  runReaction: boolean;
  runReactionBoundary: boolean;
  combatRelevant: boolean;
  intents: Set<VerificationTestIntent>;
}): string[] {
  const reasons: string[] = ["structure smoke always runs"];
  if (input.projectCheckable) reasons.push("project verification checks planned transaction fields");
  if (!input.hasTaskContext) reasons.push("self-test mode keeps broad reaction coverage");
  if (input.combatRelevant) reasons.push("combat/timing intent enables reaction coverage");
  if (!input.runReaction && input.hasTaskContext) reasons.push("reaction case skipped because task is not combat-related");
  if (!input.runReactionBoundary && input.hasTaskContext) reasons.push("reaction boundary skipped because task is not timing-related");
  if (input.intents.size > 0) reasons.push(`verification intents: ${[...input.intents].join(", ")}`);
  return reasons;
}
