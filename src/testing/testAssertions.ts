import type { FrameCheck, RuntimeSnapshot, TargetRef, TestLog } from "../project/schema";

export type CheckEvaluation = {
  passed: boolean;
  logs: TestLog[];
};

type MatcherObject = Record<string, unknown>;

export function evaluateFrameChecks(snapshot: RuntimeSnapshot, checks: FrameCheck[], frame: number): CheckEvaluation {
  const logs: TestLog[] = [];
  let passed = true;

  for (const check of checks) {
    const context = resolveTarget(snapshot, check.target);
    for (const [key, expected] of Object.entries(check.expect)) {
      const evaluation = evaluateCheckExpectation(context, snapshot, key, expected);
      if (evaluation.passed) continue;
      passed = false;
      logs.push({
        level: "error",
        frame,
        message: `${check.label}: expected ${key} to be ${JSON.stringify(evaluation.expected)}, got ${JSON.stringify(evaluation.actual)}.`,
      });
    }
  }

  return { passed, logs };
}

export function frameChecksPass(snapshot: RuntimeSnapshot, checks: FrameCheck[]): boolean {
  return evaluateFrameChecks(snapshot, checks, snapshot.frame).passed;
}

export function resolveTarget(snapshot: RuntimeSnapshot, target: TargetRef): { exists: boolean; value: unknown } {
  if (target.kind === "scene") return { exists: target.sceneId === snapshot.sceneId, value: { sceneId: snapshot.sceneId } };
  if (target.kind === "entity") {
    const entity = snapshot.entities[target.entityId];
    return { exists: Boolean(entity), value: entity };
  }
  if (target.kind === "area") return { exists: target.sceneId === snapshot.sceneId, value: target.rect };
  if (target.kind === "runtime") return { exists: !target.sceneId || target.sceneId === snapshot.sceneId, value: snapshot };
  return { exists: false, value: undefined };
}

export function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

export function matchesExpectation(actual: unknown, expected: unknown): boolean {
  if (isMatcherObject(expected)) return matchesMatcherObject(actual, expected);
  if (typeof expected === "number" && typeof actual === "number") return Math.abs(actual - expected) < 0.0001;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function combatEventExists(snapshot: RuntimeSnapshot, expected: unknown): boolean {
  if (typeof expected === "boolean") return expected ? snapshot.combatEvents.length > 0 : snapshot.combatEvents.length === 0;
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return false;
  const partial = expected as Record<string, unknown>;
  return snapshot.combatEvents.some((event) => {
    return Object.entries(partial).every(([key, value]) => matchesExpectation(readPath(event, key), value));
  });
}

function evaluateCheckExpectation(
  context: { exists: boolean; value: unknown },
  snapshot: RuntimeSnapshot,
  key: string,
  expected: unknown,
): { passed: boolean; actual: unknown; expected: unknown } {
  if (key === "exists") {
    return { passed: matchesExpectation(context.exists, expected), actual: context.exists, expected };
  }
  if (key === "combatEvent") {
    if (typeof expected === "boolean") {
      const actual = snapshot.combatEvents.length > 0;
      return { passed: matchesExpectation(actual, expected), actual, expected };
    }
    const actual = combatEventExists(snapshot, expected);
    return { passed: matchesExpectation(actual, true), actual, expected: true };
  }
  const actual = readPath(context.value, key);
  return { passed: matchesExpectation(actual, expected), actual, expected };
}

function isMatcherObject(value: unknown): value is MatcherObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).some((key) => key.startsWith("$"));
}

function matchesMatcherObject(actual: unknown, matcher: MatcherObject): boolean {
  return Object.entries(matcher).every(([operator, operand]) => {
    if (operator === "$eq") return matchesExpectation(actual, operand);
    if (operator === "$ne") return !matchesExpectation(actual, operand);
    if (operator === "$gt") return typeof actual === "number" && typeof operand === "number" && actual > operand;
    if (operator === "$gte") return typeof actual === "number" && typeof operand === "number" && actual >= operand;
    if (operator === "$lt") return typeof actual === "number" && typeof operand === "number" && actual < operand;
    if (operator === "$lte") return typeof actual === "number" && typeof operand === "number" && actual <= operand;
    if (operator === "$between") {
      return (
        typeof actual === "number" &&
        Array.isArray(operand) &&
        operand.length === 2 &&
        typeof operand[0] === "number" &&
        typeof operand[1] === "number" &&
        actual >= operand[0] &&
        actual <= operand[1]
      );
    }
    if (operator === "$in") return Array.isArray(operand) && operand.some((item) => matchesExpectation(actual, item));
    if (operator === "$contains") return containsExpectation(actual, operand);
    if (operator === "$truthy") return operand === true && Boolean(actual);
    if (operator === "$falsy") return operand === true && !actual;
    if (operator === "$defined") return operand === true ? actual !== undefined : actual === undefined;
    if (operator === "$approx") return matchesApproximateNumber(actual, operand);
    if (operator === "$not") return !matchesExpectation(actual, operand);
    return false;
  });
}

function containsExpectation(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string" && typeof expected === "string") return actual.includes(expected);
  if (Array.isArray(actual)) return actual.some((item) => matchesExpectation(item, expected));
  if (actual && typeof actual === "object" && typeof expected === "string") return expected in (actual as Record<string, unknown>);
  return false;
}

function matchesApproximateNumber(actual: unknown, operand: unknown): boolean {
  if (typeof actual !== "number") return false;
  if (typeof operand === "number") return Math.abs(actual - operand) < 0.0001;
  if (!operand || typeof operand !== "object" || Array.isArray(operand)) return false;
  const value = (operand as Record<string, unknown>).value;
  const tolerance = (operand as Record<string, unknown>).tolerance;
  return typeof value === "number" && Math.abs(actual - value) <= (typeof tolerance === "number" ? tolerance : 0.0001);
}
