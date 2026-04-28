import type {
  BodyComponent,
  ColliderComponent,
  Entity,
  FrameCheck,
  InputScript,
  Project,
  ProjectPatch,
  RenderComponent,
  Resource,
  ResourceBinding,
  TargetRef,
  Task,
} from "../project/schema";
import { cloneJson, err, makeId, ok, type Result } from "../shared/types";
import type { ResourceId } from "../shared/types";

type EntityTarget = Extract<TargetRef, { kind: "entity" }>;
type ResourceTarget = Extract<TargetRef, { kind: "resource" }>;

export type PlannedAiEdit = {
  normalizedText: string;
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  testTarget: TargetRef;
  diffSummary: string;
  intents: string[];
};

export type AiTaskPlan = {
  normalizedText: string;
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  testScript: InputScript;
  diffSummary: string;
};

type BehaviorParamKey = (typeof behaviorParamKeys)[number];

type ParamSpec = {
  key: BehaviorParamKey;
  aliases: string[];
  min: number;
  max: number;
  integer?: boolean;
  fallback: number;
};

type RelativeParamRequest = {
  key: BehaviorParamKey;
  factor?: number;
  delta?: number;
  label: string;
};

type DescriptionUpdate = {
  text: string;
  field: "description" | "aiDescription" | "both";
};

type ColliderEdit = {
  size?: { x: number; y: number };
  radius?: number;
  solid?: boolean;
  trigger?: boolean;
};

type RenderEdit = {
  color?: string;
  opacity?: number;
};

const behaviorParamKeys = [
  "speed",
  "jump",
  "gravityScale",
  "friction",
  "health",
  "parryWindowFrames",
  "attackStartupFrames",
  "attackActiveFrames",
  "attackCooldownFrames",
  "attackRange",
] as const;

const paramSpecs: ParamSpec[] = [
  { key: "speed", aliases: ["speed", "move speed", "movement speed", "\u901f\u5ea6", "\u79fb\u52a8\u901f\u5ea6"], min: 0, max: 100000, fallback: 300 },
  { key: "jump", aliases: ["jump", "jump force", "jump speed", "\u8df3\u8dc3", "\u8df3\u529b", "\u8d77\u8df3"], min: 0, max: 100000, fallback: 620 },
  { key: "gravityScale", aliases: ["gravityScale", "gravity scale", "gravity", "\u91cd\u529b\u7f29\u653e", "\u91cd\u529b"], min: -10, max: 10, fallback: 1 },
  { key: "friction", aliases: ["friction", "\u6469\u64e6", "\u6469\u64e6\u529b", "\u6469\u64e6\u7cfb\u6570"], min: 0, max: 5, fallback: 0.8 },
  { key: "health", aliases: ["health", "hp", "hit points", "\u8840\u91cf", "\u751f\u547d", "\u751f\u547d\u503c"], min: 0, max: 100000, integer: true, fallback: 1 },
  { key: "parryWindowFrames", aliases: ["parryWindowFrames", "parry window", "parry frames", "\u683c\u6321\u7a97\u53e3", "\u5f39\u53cd\u7a97\u53e3", "\u683c\u6321\u5e27"], min: 0, max: 10000, integer: true, fallback: 8 },
  { key: "attackStartupFrames", aliases: ["attackStartupFrames", "attack startup", "startup frames", "\u653b\u51fb\u524d\u6447", "\u524d\u6447\u5e27"], min: 0, max: 10000, integer: true, fallback: 4 },
  { key: "attackActiveFrames", aliases: ["attackActiveFrames", "attack active", "active frames", "\u653b\u51fb\u6301\u7eed", "\u6709\u6548\u5e27", "\u6d3b\u8dc3\u5e27"], min: 0, max: 10000, integer: true, fallback: 4 },
  { key: "attackCooldownFrames", aliases: ["attackCooldownFrames", "attack cooldown", "cooldown frames", "\u653b\u51fb\u51b7\u5374", "\u786c\u76f4\u5e27", "\u51b7\u5374\u5e27"], min: 0, max: 10000, integer: true, fallback: 18 },
  { key: "attackRange", aliases: ["attackRange", "attack range", "range", "\u653b\u51fb\u8ddd\u79bb", "\u653b\u51fb\u8303\u56f4", "\u8303\u56f4"], min: 0, max: 100000, fallback: 64 },
];

const colorNames: Record<string, string> = {
  red: "#e06c6c",
  blue: "#4a8fd7",
  green: "#35bd9a",
  yellow: "#d7c84a",
  orange: "#d78a4a",
  purple: "#9a6bd7",
  pink: "#e68ac2",
  white: "#ffffff",
  black: "#111313",
  gray: "#969a90",
  grey: "#969a90",
  cyan: "#4ad7d1",
  "\u7ea2": "#e06c6c",
  "\u84dd": "#4a8fd7",
  "\u7eff": "#35bd9a",
  "\u9ec4": "#d7c84a",
  "\u6a59": "#d78a4a",
  "\u7d2b": "#9a6bd7",
  "\u7c89": "#e68ac2",
  "\u767d": "#ffffff",
  "\u9ed1": "#111313",
  "\u7070": "#969a90",
  "\u9752": "#4ad7d1",
};

export function createIntentPlan(project: Project, task: Task): Result<AiTaskPlan> {
  const normalizedText = normalizeTaskText(task.userText);
  const planned = planAiTaskEdit(project, task, normalizedText);
  if (planned.ok) {
    return ok({
      normalizedText: planned.value.normalizedText,
      patches: planned.value.patches,
      inversePatches: planned.value.inversePatches,
      testScript: createSmokeScript(planned.value.testTarget, task.acceptanceCriteria),
      diffSummary: planned.value.diffSummary,
    });
  }
  return createFallbackPlan(project, task, normalizedText);
}

export function planAiTaskEdit(project: Project, task: Task, normalizedText: string): Result<PlannedAiEdit> {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) return err(`active scene not found: ${project.activeSceneId}`);

  const text = normalizedText || task.normalizedText || task.userText;
  const entityTargets = existingEntityTargets(scene.entities, task.targetRefs);
  const resourceTargets = existingResourceTargets(project.resources, task.targetRefs);
  const patches: ProjectPatch[] = [];
  const inversePatches: ProjectPatch[] = [];
  const intents: string[] = [];
  const touchedTargets: TargetRef[] = [];

  const explicitParams = parseBehaviorParamEdits(text);
  const relativeParams = parseRelativeParamRequests(text);
  const behaviorDescription = extractBehaviorDescription(text);
  const colliderEdit = parseColliderEdit(text);
  const renderEdit = parseRenderEdit(text);
  const hasEntityIntent =
    explicitParams.size > 0 ||
    relativeParams.length > 0 ||
    Boolean(behaviorDescription) ||
    hasColliderEdit(colliderEdit) ||
    hasRenderEdit(renderEdit);

  if (hasEntityIntent && entityTargets.length > 0) {
    for (const target of entityTargets) {
      const entity = scene.entities[target.entityId];
      const next = cloneJson(entity);
      const entityIntents: string[] = [];

      if (behaviorDescription) {
        ensureBehavior(next).description = behaviorDescription;
        next.behavior!.normalizedDescription = normalizedText;
        entityIntents.push("behavior.description");
      }

      const appliedParamLabels = applyBehaviorParamEdits(next, explicitParams, relativeParams);
      entityIntents.push(...appliedParamLabels);

      if (hasColliderEdit(colliderEdit)) {
        applyColliderEdit(next, colliderEdit);
        entityIntents.push(...colliderIntentLabels(colliderEdit));
      }

      if (hasRenderEdit(renderEdit)) {
        applyRenderEdit(next, renderEdit);
        entityIntents.push(...renderIntentLabels(renderEdit));
      }

      if (entityIntents.length === 0) continue;
      const path = `/scenes/${scene.id}/entities/${entity.id}` as const;
      upsertEntityPatch(patches, inversePatches, path, entity, next);
      touchedTargets.push(target);
      intents.push(`${entity.displayName}: ${entityIntents.join(", ")}`);
    }
  }

  const bindingUpdate = extractBindingDescriptionUpdate(text, task.targetRefs);
  if (bindingUpdate && entityTargets.length > 0) {
    const resourceTargetIds = new Set(resourceTargets.map((target) => target.resourceId));
    for (const target of entityTargets) {
      const entity = scene.entities[target.entityId];
      const matchingIndexes = resourceBindingIndexes(entity, resourceTargetIds, text);
      if (matchingIndexes.length === 0) continue;
      const path = `/scenes/${scene.id}/entities/${entity.id}` as const;
      const next = existingEntityPatchValue(patches, path) || cloneJson(entity);
      for (const index of matchingIndexes) applyBindingDescriptionUpdate(next.resources[index], bindingUpdate);
      upsertEntityPatch(patches, inversePatches, path, entity, next);
      touchedTargets.push(target);
      intents.push(`${entity.displayName}: resource binding ${bindingUpdate.field}`);
    }
  }

  const resourceUpdate = extractResourceDescriptionUpdate(text, task.targetRefs);
  if (resourceUpdate && resourceTargets.length > 0 && !wantsBindingDescription(text, task.targetRefs)) {
    for (const target of resourceTargets) {
      const resource = project.resources[target.resourceId];
      const next = cloneJson(resource);
      applyResourceDescriptionUpdate(next, resourceUpdate);
      const path = `/resources/${resource.id}` as const;
      patches.push({ op: "set", path, value: next });
      inversePatches.push({ op: "set", path, value: resource });
      touchedTargets.push({ kind: "scene", sceneId: project.activeSceneId });
      intents.push(`${resource.displayName}: resource ${resourceUpdate.field}`);
    }
  }

  if (patches.length === 0) return err("no safe AI edit intent recognized");

  return ok({
    normalizedText,
    patches,
    inversePatches,
    testTarget: chooseTestTarget(touchedTargets, project.activeSceneId),
    diffSummary: `AI task edit: ${intents.join("; ")}.`,
    intents,
  });
}

function existingEntityTargets(entities: Record<string, Entity>, targets: TargetRef[]): EntityTarget[] {
  return targets.filter(
    (target): target is EntityTarget => target.kind === "entity" && Boolean(entities[target.entityId]?.persistent),
  );
}

function existingResourceTargets(resources: Record<string, Resource>, targets: TargetRef[]): ResourceTarget[] {
  return targets.filter(
    (target): target is ResourceTarget => target.kind === "resource" && Boolean(resources[target.resourceId]),
  );
}

function existingEntityPatchValue(patches: ProjectPatch[], path: ProjectPatch["path"]): Entity | undefined {
  const existing = patches.find((patch) => patch.op === "set" && patch.path === path);
  if (!existing || existing.op !== "set") return undefined;
  return cloneJson(existing.value as Entity);
}

function upsertEntityPatch(
  patches: ProjectPatch[],
  inversePatches: ProjectPatch[],
  path: ProjectPatch["path"],
  original: Entity,
  next: Entity,
): void {
  const existingIndex = patches.findIndex((patch) => patch.op === "set" && patch.path === path);
  if (existingIndex >= 0) {
    patches[existingIndex] = { op: "set", path, value: next };
    return;
  }
  patches.push({ op: "set", path, value: next });
  inversePatches.push({ op: "set", path, value: original });
}

function parseBehaviorParamEdits(text: string): Map<BehaviorParamKey, number> {
  const result = new Map<BehaviorParamKey, number>();
  for (const spec of paramSpecs) {
    const value = findNumberForAliases(text, spec.aliases);
    if (value === undefined) continue;
    result.set(spec.key, normalizeParamValue(value, spec));
  }
  return result;
}

function parseRelativeParamRequests(text: string): RelativeParamRequest[] {
  const lower = text.toLowerCase();
  const requests: RelativeParamRequest[] = [];
  if (hasAny(lower, ["faster", "quicker", "speed up", "\u66f4\u5feb", "\u52a0\u5feb", "\u52a0\u901f"])) {
    requests.push({ key: "speed", factor: 1.25, label: "speed +25%" });
  }
  if (hasAny(lower, ["slower", "slow down", "\u66f4\u6162", "\u51cf\u901f", "\u6162\u4e00\u70b9"])) {
    requests.push({ key: "speed", factor: 0.75, label: "speed -25%" });
  }
  if (hasAny(lower, ["jump higher", "higher jump", "\u8df3\u66f4\u9ad8", "\u8df3\u5f97\u66f4\u9ad8"])) {
    requests.push({ key: "jump", factor: 1.2, label: "jump +20%" });
  }
  if (hasAny(lower, ["lower jump", "shorter jump", "\u8df3\u4f4e", "\u8df3\u5f97\u4f4e"])) {
    requests.push({ key: "jump", factor: 0.8, label: "jump -20%" });
  }
  if (hasAny(lower, ["more health", "tougher", "\u66f4\u591a\u8840", "\u66f4\u8010\u6253", "\u589e\u52a0\u8840\u91cf"])) {
    requests.push({ key: "health", delta: 1, label: "health +1" });
  }
  if (hasAny(lower, ["less health", "weaker", "\u66f4\u5c11\u8840", "\u964d\u4f4e\u8840\u91cf", "\u51cf\u5c11\u8840\u91cf"])) {
    requests.push({ key: "health", delta: -1, label: "health -1" });
  }
  return requests;
}

function applyBehaviorParamEdits(
  entity: Entity,
  explicitParams: Map<BehaviorParamKey, number>,
  relativeParams: RelativeParamRequest[],
): string[] {
  const labels: string[] = [];
  const params = ensureBehavior(entity).params;
  for (const [key, value] of explicitParams) {
    params[key] = value;
    mirrorRuntimeParam(entity, key, value);
    labels.push(`behavior.params.${key}=${value}`);
  }
  for (const request of relativeParams) {
    if (explicitParams.has(request.key)) continue;
    const spec = paramSpecs.find((item) => item.key === request.key);
    if (!spec) continue;
    const current = currentParamValue(entity, request.key, spec.fallback);
    const nextValue = normalizeParamValue((current * (request.factor ?? 1)) + (request.delta ?? 0), spec);
    params[request.key] = nextValue;
    mirrorRuntimeParam(entity, request.key, nextValue);
    labels.push(`behavior.params.${request.key}=${nextValue}`);
  }
  return labels;
}

function currentParamValue(entity: Entity, key: BehaviorParamKey, fallback: number): number {
  if (key === "gravityScale" && typeof entity.body?.gravityScale === "number") return entity.body.gravityScale;
  if (key === "friction" && typeof entity.body?.friction === "number") return entity.body.friction;
  if (key === "health" && typeof entity.runtime?.health === "number") return entity.runtime.health;
  const value = entity.behavior?.params[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function mirrorRuntimeParam(entity: Entity, key: BehaviorParamKey, value: number): void {
  if (key === "gravityScale") ensureBody(entity).gravityScale = value;
  if (key === "friction") ensureBody(entity).friction = value;
  if (key === "health") entity.runtime = { ...entity.runtime, health: value };
}

function parseColliderEdit(text: string): ColliderEdit {
  const size = parseColliderSize(text);
  const radius = findNumberForAliases(text, ["radius", "collider radius", "hitbox radius", "\u534a\u5f84", "\u78b0\u649e\u534a\u5f84"]);
  const solid = parseBooleanForAliases(text, ["solid", "blocking", "\u5b9e\u5fc3", "\u963b\u6321", "\u78b0\u649e\u56fa\u4f53"]);
  const trigger = parseBooleanForAliases(text, ["trigger", "sensor", "\u89e6\u53d1\u5668", "\u89e6\u53d1", "\u611f\u5e94\u533a"]);
  return {
    size,
    radius: radius === undefined ? undefined : clamp(radius, 0.001, 10000),
    solid: solid ?? parseImplicitSolid(text),
    trigger: trigger ?? parseImplicitTrigger(text),
  };
}

function parseColliderSize(text: string): { x: number; y: number } | undefined {
  const pairPatterns = [
    /(?:collider|collision|hitbox|hurtbox|\u78b0\u649e|\u5224\u5b9a|\u78b0\u649e\u4f53).{0,24}?(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)/i,
    /(?:size|width height|\u5c3a\u5bf8|\u5927\u5c0f|\u5bbd\u9ad8).{0,16}?(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)/i,
  ];
  for (const pattern of pairPatterns) {
    const match = text.match(pattern);
    if (match) return { x: clamp(Number(match[1]), 0.001, 10000), y: clamp(Number(match[2]), 0.001, 10000) };
  }

  const width = findNumberForAliases(text, ["collider width", "hitbox width", "width", "w", "\u78b0\u649e\u5bbd\u5ea6", "\u5bbd\u5ea6", "\u5bbd"]);
  const height = findNumberForAliases(text, ["collider height", "hitbox height", "height", "h", "\u78b0\u649e\u9ad8\u5ea6", "\u9ad8\u5ea6", "\u9ad8"]);
  if (width === undefined && height === undefined) return undefined;
  return {
    x: clamp(width ?? height ?? 64, 0.001, 10000),
    y: clamp(height ?? width ?? 64, 0.001, 10000),
  };
}

function applyColliderEdit(entity: Entity, edit: ColliderEdit): void {
  const collider = ensureCollider(entity);
  if (edit.size) collider.size = cloneJson(edit.size);
  if (edit.radius !== undefined) {
    collider.radius = edit.radius;
    if (collider.shape === "box") collider.shape = "circle";
    collider.size = { x: edit.radius * 2, y: edit.radius * 2 };
  }
  if (edit.solid !== undefined) collider.solid = edit.solid;
  if (edit.trigger !== undefined) collider.trigger = edit.trigger;
}

function parseRenderEdit(text: string): RenderEdit {
  const color = parseColor(text);
  const opacity = parseOpacity(text);
  return { color, opacity };
}

function parseColor(text: string): string | undefined {
  const hex = text.match(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i)?.[0];
  if (hex) return normalizeHexColor(hex);
  const lower = text.toLowerCase();
  const hasColorIntent = hasAny(lower, ["color", "colour", "tint", "fill", "\u989c\u8272", "\u67d3\u8272", "\u586b\u5145"]);
  for (const [name, value] of Object.entries(colorNames)) {
    const isAsciiName = /^[a-z]+$/.test(name);
    const matched = isAsciiName ? new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text) : text.includes(name);
    if (matched && (hasColorIntent || !isAsciiName)) return value;
  }
  return undefined;
}

function parseOpacity(text: string): number | undefined {
  const explicit = findNumberForAliases(text, ["opacity", "alpha", "\u900f\u660e\u5ea6", "\u4e0d\u900f\u660e\u5ea6"]);
  if (explicit !== undefined) return normalizeOpacity(explicit);
  const lower = text.toLowerCase();
  if (hasAny(lower, ["fully transparent", "\u5b8c\u5168\u900f\u660e"])) return 0;
  if (hasAny(lower, ["semi transparent", "semi-transparent", "half transparent", "\u534a\u900f\u660e"])) return 0.5;
  if (hasAny(lower, ["opaque", "\u4e0d\u900f\u660e"])) return 1;
  return undefined;
}

function applyRenderEdit(entity: Entity, edit: RenderEdit): void {
  const render = ensureRender(entity);
  if (edit.color) render.color = edit.color;
  if (edit.opacity !== undefined) render.opacity = edit.opacity;
}

function extractBehaviorDescription(text: string): string | undefined {
  const lower = text.toLowerCase();
  const hasIntent =
    hasAny(lower, ["behavior description", "behaviour description", "behavior desc", "behaviour desc"]) ||
    (hasAny(lower, ["behavior", "behaviour", "\u884c\u4e3a"]) && hasAny(lower, ["description", "desc", "\u63cf\u8ff0", "\u8bf4\u660e"]));
  if (!hasIntent) return undefined;
  return extractDescriptionText(text) || sanitizeDescription(text);
}

function extractResourceDescriptionUpdate(text: string, targets: TargetRef[]): DescriptionUpdate | undefined {
  const hasResourceTarget = targets.some((target) => target.kind === "resource");
  const lower = text.toLowerCase();
  const hasResourceIntent = hasResourceTarget || hasAny(lower, ["resource", "asset", "\u8d44\u6e90", "\u7d20\u6750"]);
  if (!hasResourceIntent) return undefined;
  const description = extractDescriptionText(text) || sanitizeDescription(text);
  if (!description) return undefined;
  return {
    text: description,
    field: requestedDescriptionField(text),
  };
}

function extractBindingDescriptionUpdate(text: string, targets: TargetRef[]): DescriptionUpdate | undefined {
  if (!wantsBindingDescription(text, targets)) return undefined;
  const description = extractDescriptionText(text) || sanitizeDescription(text);
  if (!description) return undefined;
  return {
    text: description,
    field: requestedDescriptionField(text),
  };
}

function wantsBindingDescription(text: string, targets: TargetRef[]): boolean {
  const lower = text.toLowerCase();
  const hasEntityAndResourceTargets = targets.some((target) => target.kind === "entity") && targets.some((target) => target.kind === "resource");
  return hasEntityAndResourceTargets || hasAny(lower, ["binding", "resource binding", "slot", "\u7ed1\u5b9a", "\u8d44\u6e90\u7ed1\u5b9a", "\u63d2\u69fd", "\u69fd\u4f4d"]);
}

function requestedDescriptionField(text: string): DescriptionUpdate["field"] {
  const lower = text.toLowerCase();
  if (hasAny(lower, ["ai description", "aidescription", "ai_desc", "\u0041\u0049\u63cf\u8ff0", "\u667a\u80fd\u63cf\u8ff0"])) return "aiDescription";
  if (hasAny(lower, ["description", "desc", "\u63cf\u8ff0", "\u8bf4\u660e"])) return "both";
  return "both";
}

function applyResourceDescriptionUpdate(resource: Resource, update: DescriptionUpdate): void {
  if (update.field === "description" || update.field === "both") resource.description = update.text;
  if (update.field === "aiDescription" || update.field === "both") resource.aiDescription = update.text;
}

function applyBindingDescriptionUpdate(binding: ResourceBinding, update: DescriptionUpdate): void {
  if (update.field === "description" || update.field === "both") binding.description = update.text;
  if (update.field === "aiDescription" || update.field === "both") binding.aiDescription = update.text;
}

function resourceBindingIndexes(entity: Entity, resourceTargetIds: Set<string>, text: string): number[] {
  if (entity.resources.length === 0) return [];
  const explicitSlot = extractSlotName(text);
  const matches = entity.resources
    .map((binding, index) => ({ binding, index }))
    .filter(({ binding }) => {
      if (resourceTargetIds.size > 0 && !resourceTargetIds.has(binding.resourceId)) return false;
      if (explicitSlot && binding.slot.toLowerCase() !== explicitSlot.toLowerCase()) return false;
      return true;
    })
    .map(({ index }) => index);
  if (matches.length > 0) return matches;
  if (resourceTargetIds.size === 0 && wantsBindingDescription(text, [])) return [0];
  return [];
}

function extractSlotName(text: string): string | undefined {
  const match = text.match(/(?:slot|\u63d2\u69fd|\u69fd\u4f4d)\s*(?:=|:|\u4e3a|\u662f|to)?\s*([a-z0-9_-]+)/i);
  return match?.[1];
}

function extractDescriptionText(text: string): string | undefined {
  const quoted = extractQuotedText(text);
  if (quoted) return quoted;
  const markerPattern =
    "(?:description|desc|ai description|aidescription|behavior description|behaviour description|\\u63cf\\u8ff0|\\u8bf4\\u660e|\\u884c\\u4e3a\\u63cf\\u8ff0)";
  const verbPattern = "(?:to|as|=|:|\\uff1a|\\u4e3a|\\u662f|\\u6539\\u6210|\\u6539\\u4e3a|\\u8bbe\\u4e3a|\\u8bbe\\u7f6e\\u4e3a|\\u66f4\\u65b0\\u4e3a)";
  const match = text.match(new RegExp(`${markerPattern}.{0,12}?${verbPattern}\\s*(.+)$`, "i"));
  return match ? sanitizeDescription(match[1]) : undefined;
}

function extractQuotedText(text: string): string | undefined {
  const quotePattern = new RegExp("[\"'`\\u201c\\u201d\\u2018\\u2019](.+?)[\"'`\\u201c\\u201d\\u2018\\u2019]");
  const match = text.match(quotePattern);
  return match ? sanitizeDescription(match[1]) : undefined;
}

function sanitizeDescription(value: string): string | undefined {
  const cleaned = value
    .trim()
    .replace(new RegExp("^[\\s:=:\\uff1a,\\uff0c.\\u3002-]+"), "")
    .replace(new RegExp("[\\s.\\u3002]+$"), "")
    .slice(0, 240)
    .trim();
  return cleaned || undefined;
}

function hasColliderEdit(edit: ColliderEdit): boolean {
  return Boolean(edit.size || edit.radius !== undefined || edit.solid !== undefined || edit.trigger !== undefined);
}

function hasRenderEdit(edit: RenderEdit): boolean {
  return Boolean(edit.color || edit.opacity !== undefined);
}

function colliderIntentLabels(edit: ColliderEdit): string[] {
  const labels: string[] = [];
  if (edit.size) labels.push(`collider.size=${edit.size.x}x${edit.size.y}`);
  if (edit.radius !== undefined) labels.push(`collider.radius=${edit.radius}`);
  if (edit.solid !== undefined) labels.push(`collider.solid=${edit.solid}`);
  if (edit.trigger !== undefined) labels.push(`collider.trigger=${edit.trigger}`);
  return labels;
}

function renderIntentLabels(edit: RenderEdit): string[] {
  const labels: string[] = [];
  if (edit.color) labels.push(`render.color=${edit.color}`);
  if (edit.opacity !== undefined) labels.push(`render.opacity=${edit.opacity}`);
  return labels;
}

function ensureBehavior(entity: Entity): NonNullable<Entity["behavior"]> {
  entity.behavior ||= {
    description: "AI editable behavior.",
    params: {},
  };
  entity.behavior.params ||= {};
  return entity.behavior;
}

function ensureBody(entity: Entity): BodyComponent {
  entity.body ||= {
    mode: "static",
    velocity: { x: 0, y: 0 },
    gravityScale: 0,
    friction: 0.8,
    bounce: 0,
  };
  return entity.body;
}

function ensureCollider(entity: Entity): ColliderComponent {
  entity.collider ||= {
    shape: "box",
    size: { x: 64, y: 64 },
    solid: true,
    trigger: false,
    layerMask: ["world"],
  };
  return entity.collider;
}

function ensureRender(entity: Entity): RenderComponent {
  entity.render ||= {
    visible: true,
    color: "#ffffff",
    opacity: 1,
    layerId: "world",
  };
  return entity.render;
}

function findNumberForAliases(text: string, aliases: string[]): number | undefined {
  const aliasPattern = aliases.map(escapeRegExp).join("|");
  const numberPattern = "(-?\\d+(?:\\.\\d+)?)\\s*(%)?";
  const afterAlias = new RegExp(
    `(?:${aliasPattern})\\s*(?:=|:|\\uff1a|to|as|at|\\u4e3a|\\u5230|\\u81f3|\\u6210|\\u6539\\u6210|\\u6539\\u4e3a|\\u8bbe\\u4e3a|\\u8bbe\\u7f6e\\u4e3a|\\u8c03\\u6574\\u4e3a|\\u8c03\\u6574\\u5230|\\u53d8\\u6210|\\u53d8\\u4e3a)?\\s*${numberPattern}`,
    "i",
  );
  const afterMatch = text.match(afterAlias);
  if (afterMatch) return numberFromMatch(afterMatch);

  const beforeAlias = new RegExp(`${numberPattern}\\s*(?:${aliasPattern})`, "i");
  const beforeMatch = text.match(beforeAlias);
  if (beforeMatch) return numberFromMatch(beforeMatch);
  return undefined;
}

function numberFromMatch(match: RegExpMatchArray): number | undefined {
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return match[2] === "%" ? value / 100 : value;
}

function parseBooleanForAliases(text: string, aliases: string[]): boolean | undefined {
  const aliasPattern = aliases.map(escapeRegExp).join("|");
  const pattern = new RegExp(
    `(?:${aliasPattern})\\s*(?:=|:|\\uff1a|to|as|is|\\u4e3a|\\u662f|\\u8bbe\\u4e3a|\\u8bbe\\u7f6e\\u4e3a)?\\s*(true|false|on|off|yes|no|1|0|\\u5f00|\\u5173|\\u5f00\\u542f|\\u5173\\u95ed|\\u662f|\\u5426)`,
    "i",
  );
  const match = text.match(pattern);
  if (!match) return undefined;
  return parseBooleanToken(match[1]);
}

function parseBooleanToken(token: string): boolean | undefined {
  const lower = token.toLowerCase();
  if (["true", "on", "yes", "1", "\u5f00", "\u5f00\u542f", "\u662f"].includes(lower)) return true;
  if (["false", "off", "no", "0", "\u5173", "\u5173\u95ed", "\u5426"].includes(lower)) return false;
  return undefined;
}

function parseImplicitSolid(text: string): boolean | undefined {
  const lower = text.toLowerCase();
  if (hasAny(lower, ["non-solid", "not solid", "pass through", "no collision", "\u4e0d\u963b\u6321", "\u53ef\u7a7f\u900f", "\u7a7f\u900f"])) return false;
  if (hasAny(lower, ["solid", "blocking", "\u963b\u6321", "\u5b9e\u5fc3", "\u56fa\u4f53\u78b0\u649e"])) return true;
  return undefined;
}

function parseImplicitTrigger(text: string): boolean | undefined {
  const lower = text.toLowerCase();
  if (hasAny(lower, ["not trigger", "disable trigger", "\u5173\u95ed\u89e6\u53d1", "\u4e0d\u662f\u89e6\u53d1"])) return false;
  if (hasAny(lower, ["trigger zone", "make trigger", "as trigger", "\u89e6\u53d1\u5668", "\u8bbe\u4e3a\u89e6\u53d1"])) return true;
  return undefined;
}

function normalizeParamValue(value: number, spec: ParamSpec): number {
  const clamped = clamp(value, spec.min, spec.max);
  return spec.integer ? Math.round(clamped) : roundTo(clamped, 4);
}

function normalizeOpacity(value: number): number {
  const normalized = value > 1 ? value / 100 : value;
  return roundTo(clamp(normalized, 0, 1), 4);
}

function normalizeHexColor(value: string): string {
  const lower = value.toLowerCase();
  if (lower.length !== 4) return lower;
  return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`;
}

function chooseTestTarget(targets: TargetRef[], activeSceneId: Project["activeSceneId"]): TargetRef {
  return targets.find((target) => target.kind === "entity") || { kind: "scene", sceneId: activeSceneId };
}

function createFallbackPlan(project: Project, task: Task, normalizedText: string): Result<AiTaskPlan> {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) return err(`active scene not found: ${project.activeSceneId}`);
  const entityTarget = existingEntityTargets(scene.entities, task.targetRefs)[0];
  if (entityTarget) {
    const entity = scene.entities[entityTarget.entityId];
    const next = cloneJson(entity);
    next.tags = uniqueRefs([...next.tags, "ai-reviewed"]);
    next.behavior = {
      description: next.behavior?.description || "AI editable entity annotation.",
      builtin: next.behavior?.builtin,
      params: next.behavior?.params || {},
      normalizedDescription: normalizedText,
    };
    const path = `/scenes/${scene.id}/entities/${entity.id}` as const;
    return ok({
      normalizedText,
      patches: [{ op: "set", path, value: next }],
      inversePatches: [{ op: "set", path, value: entity }],
      testScript: createSmokeScript(entityTarget, task.acceptanceCriteria),
      diffSummary: `AI fallback: update ${entity.displayName} annotation.`,
    });
  }

  const resourceId = makeId<"ResourceId">("res") as ResourceId;
  const path = `/resources/${resourceId}` as const;
  const target = task.targetRefs.find((item) => item.kind === "scene") || { kind: "scene" as const, sceneId: project.activeSceneId };
  return ok({
    normalizedText,
    patches: [
      {
        op: "set",
        path,
        value: {
          id: resourceId,
          internalName: `AiTaskNote_${task.id}`,
          displayName: `AI Task Note ${task.id}`,
          type: "note",
          description: normalizedText,
          aiDescription: normalizedText.slice(0, 240),
          tags: ["ai", "task", "note"],
          attachments: [],
        },
      },
    ],
    inversePatches: [{ op: "delete", path }],
    testScript: createSmokeScript(target, task.acceptanceCriteria),
    diffSummary: `AI fallback: add task note for ${task.id}.`,
  });
}

function createSmokeScript(target: TargetRef, acceptanceCriteria: FrameCheck[] = []): InputScript {
  const checks = acceptanceCriteria.filter((check) => check.target.kind !== "resource");
  return {
    steps: [
      { op: "wait", ticks: 2 },
      {
        op: "freezeAndInspect",
        checks: checks.length ? checks : [{ label: "target remains available after AI edit", target, expect: { exists: true } }],
      },
    ],
  };
}

function normalizeTaskText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function uniqueRefs<T extends string>(refs: T[]): T[] {
  return [...new Set(refs)];
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
