import { AutonomyLoop } from "../ai/autonomyLoop";
import { AiTaskExecutor } from "../ai/taskExecutor";
import type { Project } from "../project/schema";
import { ProjectStore } from "../project/projectStore";
import { createTask } from "../project/tasks";
import { createStarterProject } from "../v2/starterProject";
import { autonomousRoundSummaryFromCycle, latestAutonomyRoundSummaryFromProject } from "../v2/summaryModels";

const store = new ProjectStore(createStarterProject());
const player = findPlayer(store.project);
assert(player, "starter project must contain a playerPlatformer entity");

const taskResult = createTask({
  source: "user",
  title: "Set player speed",
  userText: "Set the player speed to 420.",
  targetRefs: [{ kind: "entity", entityId: player.id }],
});
assert(taskResult.ok, taskResult.ok ? "" : taskResult.error);
store.upsertTask(taskResult.value);

const loop = new AutonomyLoop({
  store,
  executor: new AiTaskExecutor({ store }),
  traceLimit: 20,
  maxEntityChecks: 4,
});
const cycle = loop.runOnce({ includeReactionCase: false, maxEntityChecks: 4, maxFailureTasks: 0 });
assert(cycle.ok, cycle.ok ? "" : cycle.error);

const liveSummary = autonomousRoundSummaryFromCycle({
  round: 3,
  cycle: cycle.value,
  translateEvidence: (text) => `translated:${text}`,
});
const latestSummary = latestAutonomyRoundSummaryFromProject(store.project);
assert(latestSummary, "expected latest autonomy summary from project");

assert(liveSummary.round === 3, `expected live round 3, got ${liveSummary.round}`);
assert(liveSummary.taskId === taskResult.value.id, "expected live summary to reference executed task");
assert(liveSummary.taskTitle === taskResult.value.title, "expected live summary to keep task title");
assert(liveSummary.taskStatus === "passed", `expected live task status passed, got ${liveSummary.taskStatus}`);
assert(liveSummary.suiteCaseCount === cycle.value.suite.cases.length, "expected live suite case count to match cycle suite");
assert(liveSummary.suitePassed + liveSummary.suiteFailed + liveSummary.suiteInterrupted === liveSummary.suiteCaseCount, "expected live suite totals to add up");
assert(liveSummary.aiNextSteps.some((step) => step.startsWith("translated:")), "expected live next steps to pass through evidence translation");
assert(latestSummary.taskId === liveSummary.taskId, "expected latest project summary to reference the same task");
assert(latestSummary.transactionId === liveSummary.transactionId, "expected latest project summary to reference the same transaction");
assert(latestSummary.testRecordRefs.length === liveSummary.testRecordRefs.length, "expected latest project summary to keep test record refs");
assert(latestSummary.generatedTasks.length === liveSummary.generatedTasks.length, "expected latest project summary to keep generated task count");

const selfTestStore = new ProjectStore(createStarterProject());
const selfTestLoop = new AutonomyLoop({
  store: selfTestStore,
  executor: new AiTaskExecutor({ store: selfTestStore }),
  traceLimit: 20,
  maxEntityChecks: 4,
});
const selfTestCycle = selfTestLoop.runOnce({ includeReactionCase: false, maxEntityChecks: 4, maxFailureTasks: 0 });
assert(selfTestCycle.ok, selfTestCycle.ok ? "" : selfTestCycle.error);
const selfTestSummary = autonomousRoundSummaryFromCycle({ round: 1, cycle: selfTestCycle.value });
assert(selfTestSummary.taskStatus === "skipped", `expected self-test task status skipped, got ${selfTestSummary.taskStatus}`);
assert(selfTestSummary.aiNextSteps.some((step) => step.includes("队列为空")), "expected self-test summary to mention empty queue");

console.log(
  JSON.stringify(
    {
      status: "passed",
      live: {
        round: liveSummary.round,
        taskStatus: liveSummary.taskStatus,
        suiteCaseCount: liveSummary.suiteCaseCount,
        testRecordRefs: liveSummary.testRecordRefs.length,
      },
      latest: {
        round: latestSummary.round,
        taskStatus: latestSummary.taskStatus,
        suiteCaseCount: latestSummary.suiteCaseCount,
      },
      selfTest: {
        taskStatus: selfTestSummary.taskStatus,
        nextSteps: selfTestSummary.aiNextSteps.length,
      },
    },
    null,
    2,
  ),
);

function findPlayer(project: Project) {
  return Object.values(activeScene(project).entities).find((entity) => entity.behavior?.builtin === "playerPlatformer");
}

function activeScene(project: Project) {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);
  return scene;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
