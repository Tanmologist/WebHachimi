// Owns project-level verification checks that do not require stepping a runtime
// world. AI task execution and autonomous suites call this alongside scripted
// runtime checks to validate persisted project state.
import type { AssertionFailure, Project, ProjectCheck, TargetRef, TestLog } from "../project/schema";
import type { SceneId } from "../shared/types";
import { matchesExpectation, readPath } from "./testAssertions";

export type ProjectCheckEvaluation = {
  passed: boolean;
  logs: TestLog[];
  failures: AssertionFailure[];
};

export function evaluateProjectChecks(project: Project, checks: ProjectCheck[]): ProjectCheckEvaluation {
  const logs: TestLog[] = [];
  const failures: AssertionFailure[] = [];
  let passed = true;

  for (const check of checks) {
    const context = resolveProjectTarget(project, check.target);
    for (const [key, expected] of Object.entries(check.expect)) {
      const actual = key === "exists" ? context.exists : readPath(context.value, key);
      if (matchesExpectation(actual, expected)) continue;
      passed = false;
      const message = `${check.label}: expected ${key} to be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`;
      failures.push({
        source: "project",
        label: check.label,
        target: check.target,
        path: key,
        expected,
        actual,
        matcher: matcherLabel(expected),
        message,
      });
      logs.push({
        level: "error",
        frame: 0,
        message,
      });
    }
  }

  if (checks.length > 0 && passed) {
    logs.push({
      level: "info",
      frame: 0,
      message: `Project verification passed ${checks.length} check${checks.length === 1 ? "" : "s"}.`,
    });
  }

  return { passed, logs, failures };
}

export function resolveProjectTarget(project: Project, target: TargetRef): { exists: boolean; value: unknown } {
  if (target.kind === "scene") {
    const scene = project.scenes[target.sceneId];
    return { exists: Boolean(scene), value: scene };
  }
  if (target.kind === "entity") {
    const entity = Object.values(project.scenes)
      .map((scene) => scene.entities[target.entityId])
      .find(Boolean);
    return { exists: Boolean(entity), value: entity };
  }
  if (target.kind === "resource") {
    const resource = project.resources[target.resourceId];
    return { exists: Boolean(resource), value: resource };
  }
  if (target.kind === "area") {
    const scene = project.scenes[target.sceneId as SceneId];
    return { exists: Boolean(scene), value: target.rect };
  }
  if (target.kind === "editorUi") return { exists: true, value: target };
  return { exists: true, value: project };
}

function matcherLabel(expected: unknown): string | undefined {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return undefined;
  const keys = Object.keys(expected).filter((key) => key.startsWith("$"));
  return keys.length ? keys.join(",") : undefined;
}
