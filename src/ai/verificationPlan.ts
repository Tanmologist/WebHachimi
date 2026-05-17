import type {
  Entity,
  FrameCheck,
  InputStep,
  Project,
  ProjectCheck,
  ProjectPatch,
  Resource,
  TargetRef,
  Task,
  VerificationPlan,
  VerificationTestIntent,
} from "../project/schema";
import type { EntityId, ResourceId, SceneId } from "../shared/types";

export type CreateVerificationPlanInput = {
  project: Project;
  task: Task;
  normalizedText: string;
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  testTarget: TargetRef;
  intents: string[];
};

type ParsedPatchPath =
  | { kind: "entity"; sceneId: SceneId; entityId: EntityId }
  | { kind: "resource"; resourceId: ResourceId }
  | { kind: "scene"; sceneId: SceneId }
  | { kind: "other" };

export function createVerificationPlan(input: CreateVerificationPlanInput): VerificationPlan {
  const runtime = runtimeVerificationFromPatches(input.project, input.patches);
  const frameChecks = mergeFrameChecks([
    ...(input.task.acceptanceCriteria || []).filter((check) => check.target.kind !== "resource" && check.target.kind !== "editorUi"),
    { label: "planned edit target remains inspectable", target: input.testTarget, expect: { exists: true } },
    ...brushTargetFrameChecks(input.task),
    ...runtime.frameChecks,
  ]);
  const projectChecks = mergeProjectChecks([
    ...targetProjectChecks(input.project, input.task, input.testTarget),
    ...patchProjectChecks(input.project, input.patches),
  ]);
  const testIntents = inferTestIntents(input, projectChecks);
  return {
    version: 1,
    summary: summarizeVerificationPlan(frameChecks, projectChecks, testIntents),
    frameChecks,
    runtimeSetupSteps: runtime.setupSteps,
    projectChecks,
    testIntents,
    notes: buildNotes(input, frameChecks, projectChecks),
  };
}

function brushTargetFrameChecks(task: Task): FrameCheck[] {
  const refs = task.brushContext?.compiled?.targetRefs || [];
  return refs
    .filter((target) => target.kind !== "resource" && target.kind !== "editorUi")
    .slice(0, 8)
    .map((target, index) => ({
      label: `super brush target ${index + 1} remains inspectable`,
      target,
      expect: { exists: true },
    }));
}

function targetProjectChecks(project: Project, task: Task, testTarget: TargetRef): ProjectCheck[] {
  const targets = uniqueTargets([testTarget, ...task.targetRefs, ...(task.brushContext?.compiled?.targetRefs || [])]);
  const checks: ProjectCheck[] = [];
  const scene = project.scenes[project.activeSceneId];
  if (scene) {
    checks.push({
      label: "active scene exists after planned edit",
      target: { kind: "scene", sceneId: scene.id },
      expect: { exists: true },
    });
  }
  for (const target of targets.slice(0, 12)) {
    if (target.kind === "runtime" || target.kind === "area" || target.kind === "editorUi") continue;
    checks.push({
      label: `project target exists: ${target.kind}`,
      target,
      expect: { exists: true },
    });
  }
  return checks;
}

function patchProjectChecks(project: Project, patches: ProjectPatch[]): ProjectCheck[] {
  const checks: ProjectCheck[] = [];
  for (const patch of patches) {
    const parsed = parsePatchPath(patch.path);
    if (parsed.kind === "entity") {
      const before = project.scenes[parsed.sceneId]?.entities[parsed.entityId];
      if (patch.op === "delete") {
        checks.push({
          label: `planned entity delete applied: ${parsed.entityId}`,
          target: { kind: "entity", entityId: parsed.entityId },
          expect: { exists: false },
        });
      } else if (isEntity(patch.value)) {
        const expect = entityExpectations(before, patch.value);
        checks.push({
          label: `planned entity edit applied: ${patch.value.displayName || patch.value.internalName || parsed.entityId}`,
          target: { kind: "entity", entityId: parsed.entityId },
          expect,
        });
      }
    } else if (parsed.kind === "resource") {
      if (patch.op === "delete") {
        checks.push({
          label: `planned resource delete applied: ${parsed.resourceId}`,
          target: { kind: "resource", resourceId: parsed.resourceId },
          expect: { exists: false },
        });
      } else if (isResource(patch.value)) {
        checks.push({
          label: `planned resource edit applied: ${patch.value.displayName || patch.value.internalName || parsed.resourceId}`,
          target: { kind: "resource", resourceId: parsed.resourceId },
          expect: resourceExpectations(patch.value),
        });
      }
    } else if (parsed.kind === "scene") {
      checks.push({
        label: `planned scene edit applied: ${parsed.sceneId}`,
        target: { kind: "scene", sceneId: parsed.sceneId },
        expect: { exists: true },
      });
    }
  }
  return checks;
}

function runtimeVerificationFromPatches(
  project: Project,
  patches: ProjectPatch[],
): { setupSteps: InputStep[]; frameChecks: FrameCheck[] } {
  for (const patch of patches) {
    const parsed = parsePatchPath(patch.path);
    if (parsed.kind !== "entity" || patch.op === "delete" || !isEntity(patch.value)) continue;
    const before = project.scenes[parsed.sceneId]?.entities[parsed.entityId];
    const after = patch.value;
    const speed = changedNumber(before?.behavior?.params?.speed, after.behavior?.params?.speed);
    if (speed !== undefined && after.behavior?.builtin === "playerPlatformer") {
      return {
        setupSteps: [{ op: "hold", key: "right", ticks: 2 }],
        frameChecks: [
          {
            label: "runtime player speed follows behavior.params.speed",
            target: { kind: "entity", entityId: after.id },
            expect: { "velocity.x": { $approx: { value: speed, tolerance: 0.1 } } },
          },
        ],
      };
    }

    const health = changedNumber(before?.behavior?.params?.health, after.behavior?.params?.health);
    if (health !== undefined) {
      return {
        setupSteps: [],
        frameChecks: [
          {
            label: "runtime health follows behavior.params.health",
            target: { kind: "entity", entityId: after.id },
            expect: { "state.health": health },
          },
        ],
      };
    }
  }
  return { setupSteps: [], frameChecks: [] };
}

function entityExpectations(before: Entity | undefined, after: Entity): Record<string, unknown> {
  const expect: Record<string, unknown> = { exists: true };
  if (!before || before.kind !== after.kind) expect.kind = after.kind;
  addChangedScalar(expect, "displayName", before?.displayName, after.displayName);
  addChangedScalar(expect, "internalName", before?.internalName, after.internalName);
  addChangedScalar(expect, "persistent", before?.persistent, after.persistent);
  addChangedVec(expect, "transform.position", before?.transform.position, after.transform.position);
  addChangedScalar(expect, "transform.rotation", before?.transform.rotation, after.transform.rotation);
  addChangedVec(expect, "transform.scale", before?.transform.scale, after.transform.scale);

  if (after.render) {
    addChangedScalar(expect, "render.visible", before?.render?.visible, after.render.visible);
    addChangedScalar(expect, "render.color", before?.render?.color, after.render.color);
    addChangedScalar(expect, "render.opacity", before?.render?.opacity, after.render.opacity);
    addChangedVec(expect, "render.size", before?.render?.size, after.render.size);
    addChangedScalar(expect, "render.resourceId", before?.render?.resourceId, after.render.resourceId);
    addChangedScalar(expect, "render.state", before?.render?.state, after.render.state);
  }

  if (after.collider) {
    addChangedScalar(expect, "collider.shape", before?.collider?.shape, after.collider.shape);
    addChangedVec(expect, "collider.size", before?.collider?.size, after.collider.size);
    addChangedVec(expect, "collider.offset", before?.collider?.offset, after.collider.offset);
    addChangedScalar(expect, "collider.radius", before?.collider?.radius, after.collider.radius);
    addChangedScalar(expect, "collider.solid", before?.collider?.solid, after.collider.solid);
    addChangedScalar(expect, "collider.trigger", before?.collider?.trigger, after.collider.trigger);
  }

  if (after.body) {
    addChangedScalar(expect, "body.mode", before?.body?.mode, after.body.mode);
    addChangedVec(expect, "body.velocity", before?.body?.velocity, after.body.velocity);
    addChangedScalar(expect, "body.gravityScale", before?.body?.gravityScale, after.body.gravityScale);
    addChangedScalar(expect, "body.friction", before?.body?.friction, after.body.friction);
  }

  if (after.behavior) {
    addChangedScalar(expect, "behavior.description", before?.behavior?.description, after.behavior.description);
    addChangedScalar(expect, "behavior.normalizedDescription", before?.behavior?.normalizedDescription, after.behavior.normalizedDescription);
    addChangedScalar(expect, "behavior.builtin", before?.behavior?.builtin, after.behavior.builtin);
    const keys = uniqueStrings([...Object.keys(before?.behavior?.params || {}), ...Object.keys(after.behavior.params || {})]);
    for (const key of keys) addChangedScalar(expect, `behavior.params.${key}`, before?.behavior?.params?.[key], after.behavior.params[key]);
  }

  addChangedScalar(expect, "resources.length", before?.resources.length, after.resources.length);
  for (const tag of changedTags(before?.tags || [], after.tags)) {
    expect.tags = { $contains: tag };
  }
  return expect;
}

function resourceExpectations(resource: Resource): Record<string, unknown> {
  const expect: Record<string, unknown> = {
    exists: true,
    type: resource.type,
  };
  if (resource.description) expect.description = resource.description;
  if (resource.aiDescription) expect.aiDescription = resource.aiDescription;
  if (resource.tags.includes("ai")) expect.tags = { $contains: "ai" };
  return expect;
}

function inferTestIntents(input: CreateVerificationPlanInput, projectChecks: ProjectCheck[]): VerificationTestIntent[] {
  const values = new Set<VerificationTestIntent>(["structure"]);
  if (projectChecks.length > 0) values.add("project");
  const text = input.normalizedText.toLowerCase();
  const semanticIntents = input.intents.map(intentSemanticText).join(" ").toLowerCase();
  const haystack = `${text} ${semanticIntents} ${input.patches.map((patch) => patch.path).join(" ")}`;

  if (hasAny(haystack, ["resource", "binding", "sprite", "animation", "image", "audio", "素材", "资源", "动画"])) values.add("resource");
  if (hasAny(haystack, ["position", "move", "area", "zone", "patrol", "path", "区域", "范围", "路径", "巡逻"])) values.add("spatial");
  if (hasAny(haystack, ["collider", "collision", "hitbox", "trigger", "hazard", "碰撞", "触发", "危险", "判定"])) values.add("collision");
  if (hasAny(haystack, ["behavior", "speed", "jump", "gravity", "health", "行为", "速度", "跳", "重力", "血量"])) values.add("behavior");
  if (hasAny(haystack, ["render", "color", "opacity", "visible", "颜色", "透明", "显示"])) values.add("visual");
  if (hasCombatIntentText(haystack)) values.add("combat");
  if (hasAny(haystack, ["frame", "window", "cooldown", "startup", "active", "timing", "帧", "窗口", "冷却", "前摇", "时序"])) values.add("timing");
  if (input.task.source === "testFailure") values.add("runtime");
  return [...values];
}

function intentSemanticText(intent: string): string {
  const separator = intent.indexOf(":");
  return separator >= 0 ? intent.slice(separator + 1) : intent;
}

function parsePatchPath(path: string): ParsedPatchPath {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "scenes" && segments[1] && segments.length === 2) {
    return { kind: "scene", sceneId: segments[1] as SceneId };
  }
  if (segments[0] === "scenes" && segments[1] && segments[2] === "entities" && segments[3]) {
    return { kind: "entity", sceneId: segments[1] as SceneId, entityId: segments[3] as EntityId };
  }
  if (segments[0] === "resources" && segments[1]) {
    return { kind: "resource", resourceId: segments[1] as ResourceId };
  }
  return { kind: "other" };
}

function addChangedScalar(expect: Record<string, unknown>, path: string, before: unknown, after: unknown): void {
  if (after === undefined) return;
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  expect[path] = after;
}

function changedNumber(before: unknown, after: unknown): number | undefined {
  if (typeof after !== "number" || !Number.isFinite(after)) return undefined;
  if (typeof before === "number" && Math.abs(before - after) < 0.0001) return undefined;
  return after;
}

function addChangedVec(
  expect: Record<string, unknown>,
  path: string,
  before: { x: number; y: number } | undefined,
  after: { x: number; y: number } | undefined,
): void {
  if (!after) return;
  addChangedScalar(expect, `${path}.x`, before?.x, after.x);
  addChangedScalar(expect, `${path}.y`, before?.y, after.y);
}

function changedTags(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before);
  return after.filter((tag) => !beforeSet.has(tag)).slice(0, 1);
}

function mergeFrameChecks(checks: FrameCheck[]): FrameCheck[] {
  const seen = new Set<string>();
  const merged: FrameCheck[] = [];
  for (const check of checks) {
    if (check.target.kind === "resource") continue;
    if (check.target.kind === "editorUi") continue;
    const key = `${check.label}:${JSON.stringify(check.target)}:${JSON.stringify(check.expect)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(check);
  }
  return merged;
}

function mergeProjectChecks(checks: ProjectCheck[]): ProjectCheck[] {
  const merged = new Map<string, ProjectCheck>();
  for (const check of checks) {
    const key = JSON.stringify(check.target);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...check, expect: { ...check.expect } });
      continue;
    }
    existing.expect = { ...existing.expect, ...check.expect };
    existing.label = existing.label === check.label ? existing.label : `${existing.label}; ${check.label}`;
  }
  return [...merged.values()];
}

function uniqueTargets(targets: TargetRef[]): TargetRef[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = JSON.stringify(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeVerificationPlan(
  frameChecks: FrameCheck[],
  projectChecks: ProjectCheck[],
  testIntents: VerificationTestIntent[],
): string {
  return `Verification plan: ${frameChecks.length} runtime check(s), ${projectChecks.length} project check(s), intents=${testIntents.join(", ")}.`;
}

function buildNotes(input: CreateVerificationPlanInput, frameChecks: FrameCheck[], projectChecks: ProjectCheck[]): string[] {
  const notes = [input.intents.length ? `planned intents: ${input.intents.join("; ")}` : ""];
  if (frameChecks.length === 0) notes.push("No runtime frame checks were derived.");
  if (projectChecks.length === 0) notes.push("No project-level checks were derived.");
  return notes.filter(Boolean);
}

function isEntity(value: unknown): value is Entity {
  return Boolean(value && typeof value === "object" && "id" in value && "transform" in value && "resources" in value && "tags" in value);
}

function isResource(value: unknown): value is Resource {
  return Boolean(value && typeof value === "object" && "id" in value && "type" in value && "attachments" in value && "tags" in value);
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}

function hasCombatIntentText(text: string): boolean {
  return /\b(?:combat|attack|parry|hit|enemy)\b/i.test(text) || hasAny(text, ["战斗", "攻击", "格挡", "弹反", "敌人"]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
