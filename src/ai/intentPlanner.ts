import type {
  BodyComponent,
  BrushCompiledContext,
  ColliderComponent,
  Entity,
  FrameCheck,
  InputScript,
  Project,
  ProjectPatch,
  RenderComponent,
  Resource,
  ResourceBinding,
  Scene,
  TargetRef,
  Task,
  VerificationPlan,
} from "../project/schema";
import { cloneJson, err, makeId, ok, type Result } from "../shared/types";
import type { EntityId, ResourceId } from "../shared/types";
import type { Vec2 } from "../shared/types";
import { createVerificationPlan } from "./verificationPlan";

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
  verificationPlan: VerificationPlan;
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
    const verificationPlan = createVerificationPlan({
      project,
      task,
      normalizedText,
      patches: planned.value.patches,
      inversePatches: planned.value.inversePatches,
      testTarget: planned.value.testTarget,
      intents: planned.value.intents,
    });
    return ok({
      normalizedText: planned.value.normalizedText,
      patches: planned.value.patches,
      inversePatches: planned.value.inversePatches,
      testScript: createSmokeScript(planned.value.testTarget, verificationPlan.frameChecks, verificationPlan.runtimeSetupSteps),
      verificationPlan,
      diffSummary: planned.value.diffSummary,
    });
  }
  return createFallbackPlan(project, task, normalizedText);
}

export function planAiTaskEdit(project: Project, task: Task, normalizedText: string): Result<PlannedAiEdit> {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) return err(`active scene not found: ${project.activeSceneId}`);

  const text = normalizedText || task.normalizedText || task.userText;
  const brushContext = task.brushContext?.compiled;
  const explicitTargetRefs = effectiveTaskTargets(task);
  const effectiveTargetRefs = explicitTargetRefs.length ? explicitTargetRefs : inferTextTargets(project, scene, text);
  const entityTargets = existingEntityTargets(scene.entities, effectiveTargetRefs);
  const resourceTargets = existingResourceTargets(project.resources, effectiveTargetRefs);
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

  applyBrushSpatialEdits({
    project,
    scene,
    text,
    normalizedText,
    entityTargets,
    brushContext,
    patches,
    inversePatches,
    touchedTargets,
    intents,
  });

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

  const bindingUpdate = extractBindingDescriptionUpdate(text, effectiveTargetRefs);
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

  const resourceUpdate = extractResourceDescriptionUpdate(text, effectiveTargetRefs);
  if (resourceUpdate && resourceTargets.length > 0 && !wantsBindingDescription(text, effectiveTargetRefs)) {
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

function effectiveTaskTargets(task: Task): TargetRef[] {
  return mergeTargets(task.targetRefs, task.brushContext?.compiled?.targetRefs);
}

function mergeTargets(...targetGroups: Array<TargetRef[] | undefined>): TargetRef[] {
  const merged = new Map<string, TargetRef>();
  for (const targets of targetGroups) {
    for (const target of targets || []) merged.set(targetKey(target), target);
  }
  return [...merged.values()];
}

function inferTextTargets(project: Project, scene: Scene, text: string): TargetRef[] {
  const lower = text.toLowerCase();
  const entity = inferTextEntity(scene, lower);
  if (entity) return [{ kind: "entity", entityId: entity.id }];
  const resource = inferTextResource(project, lower);
  if (resource) return [{ kind: "resource", resourceId: resource.id }];
  return [];
}

function inferTextEntity(scene: Scene, lowerText: string): Entity | undefined {
  const entities = Object.values(scene.entities);
  if (hasAny(lowerText, ["player", "hero", "character"])) {
    return bestNamedEntity(entities, (entity) => entity.behavior?.builtin === "playerPlatformer" || hasEntityWord(entity, "player"));
  }
  if (hasAny(lowerText, ["enemy", "attacker", "foe"])) {
    return bestNamedEntity(entities, (entity) => entity.behavior?.builtin === "enemyPatrol" || hasEntityWord(entity, "enemy") || hasEntityWord(entity, "attacker"));
  }
  return entities.find((entity) => {
    const name = `${entity.displayName} ${entity.internalName}`.toLowerCase();
    return name.length > 2 && lowerText.includes(name);
  });
}

function inferTextResource(project: Project, lowerText: string): Resource | undefined {
  if (!hasAny(lowerText, ["resource", "asset", "sprite", "image", "animation", "audio"])) return undefined;
  const resources = Object.values(project.resources);
  return resources.find((resource) => {
    const name = `${resource.displayName} ${resource.internalName}`.toLowerCase();
    return name.length > 2 && lowerText.includes(name);
  });
}

function bestNamedEntity(entities: Entity[], predicate: (entity: Entity) => boolean): Entity | undefined {
  return entities.find(predicate);
}

function hasEntityWord(entity: Entity, word: string): boolean {
  const lower = `${entity.displayName} ${entity.internalName} ${(entity.tags || []).join(" ")}`.toLowerCase();
  return lower.includes(word);
}

function applyBrushSpatialEdits(input: {
  project: Project;
  scene: Scene;
  text: string;
  normalizedText: string;
  entityTargets: EntityTarget[];
  brushContext?: BrushCompiledContext;
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  touchedTargets: TargetRef[];
  intents: string[];
}): void {
  const brush = input.brushContext;
  if (!brush) return;

  const shape = brushShape(brush);
  const area = primaryBrushArea(brush);
  const path = primaryBrushPath(brush);
  if (shape.kind !== "empty") {
    input.intents.push(`super brush shape: ${shape.kind} confidence ${shape.confidence}`);
  }

  if (area && wantsBrushVisualEntity(input.text)) {
    const generated = createBrushVisualResourceEntity(input.scene, brush, area.rect, input.text, input.normalizedText);
    const resourcePath = `/resources/${generated.resource.id}` as const;
    const entityPath = `/scenes/${input.scene.id}/entities/${generated.entity.id}` as const;
    input.patches.push({ op: "set", path: resourcePath, value: generated.resource });
    input.inversePatches.push({ op: "delete", path: resourcePath });
    input.patches.push({ op: "set", path: entityPath, value: generated.entity });
    input.inversePatches.push({ op: "delete", path: entityPath });
    input.touchedTargets.push({ kind: "resource", resourceId: generated.resource.id as ResourceId });
    input.touchedTargets.push({ kind: "entity", entityId: generated.entity.id as EntityId });
    input.intents.push(`super brush visual: generated ${generated.entity.displayName}`);
  }

  if (area && wantsBrushAreaEntity(input.text)) {
    const entity = createBrushAreaEntity(input.scene, brush, area.rect, input.text, input.normalizedText);
    const entityPath = `/scenes/${input.scene.id}/entities/${entity.id}` as const;
    input.patches.push({ op: "set", path: entityPath, value: entity });
    input.inversePatches.push({ op: "delete", path: entityPath });
    input.touchedTargets.push({ kind: "entity", entityId: entity.id as EntityId });
    input.intents.push(`super brush area: created ${entity.displayName}`);
  }

  if (area && wantsColliderFromBrushArea(input.text) && input.entityTargets.length > 0) {
    for (const target of input.entityTargets) {
      const entity = input.scene.entities[target.entityId];
      const entityPath = `/scenes/${input.scene.id}/entities/${entity.id}` as const;
      const next = existingEntityPatchValue(input.patches, entityPath) || cloneJson(entity);
      const collider = ensureCollider(next);
      collider.size = { x: area.rect.w, y: area.rect.h };
      collider.offset = {
        x: roundTo(area.rect.x + area.rect.w / 2 - next.transform.position.x, 4),
        y: roundTo(area.rect.y + area.rect.h / 2 - next.transform.position.y, 4),
      };
      upsertEntityPatch(input.patches, input.inversePatches, entityPath, entity, next);
      input.touchedTargets.push(target);
      input.intents.push(`${entity.displayName}: collider from super brush area ${area.rect.w}x${area.rect.h}`);
    }
  }

  if (path && wantsPatrolPath(input.text) && input.entityTargets.length > 0) {
    for (const target of input.entityTargets) {
      const entity = input.scene.entities[target.entityId];
      const entityPath = `/scenes/${input.scene.id}/entities/${entity.id}` as const;
      const next = existingEntityPatchValue(input.patches, entityPath) || cloneJson(entity);
      const params = ensureBehavior(next).params;
      next.behavior!.builtin = next.behavior!.builtin || "enemyPatrol";
      next.behavior!.normalizedDescription = input.normalizedText;
      params.left = roundTo(Math.min(path.start.x, path.end.x), 4);
      params.right = roundTo(Math.max(path.start.x, path.end.x), 4);
      if (params.speed === undefined) params.speed = Math.max(30, Math.round(path.length / 2));
      upsertEntityPatch(input.patches, input.inversePatches, entityPath, entity, next);
      input.touchedTargets.push(target);
      input.intents.push(`${entity.displayName}: patrol path from super brush stroke`);
    }
  }
}

function primaryBrushArea(brush: BrushCompiledContext): BrushCompiledContext["areas"][number] | undefined {
  return [...brush.areas].sort((left, right) => {
    const score = brushAreaSourceScore(right.source) - brushAreaSourceScore(left.source);
    if (score !== 0) return score;
    return areaSize(right.rect) - areaSize(left.rect);
  })[0];
}

function primaryBrushPath(brush: BrushCompiledContext): BrushCompiledContext["paths"][number] | undefined {
  return [...brush.paths].sort((left, right) => right.length - left.length)[0];
}

function brushShape(brush: BrushCompiledContext): BrushCompiledContext["shape"] {
  return brush.shape || { kind: "empty", confidence: 0.1, notes: [] };
}

function brushAreaSourceScore(source: BrushCompiledContext["areas"][number]["source"]): number {
  if (source === "target") return 3;
  if (source === "selectionBox") return 2;
  return 1;
}

function areaSize(rect: { w: number; h: number }): number {
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

function wantsBrushAreaEntity(text: string): boolean {
  const lower = text.toLowerCase();
  const createIntent = hasAny(lower, [
    "create",
    "add",
    "place",
    "spawn",
    "generate",
    "make",
    "\u521b\u5efa",
    "\u6dfb\u52a0",
    "\u751f\u6210",
    "\u653e\u7f6e",
    "\u52a0",
  ]);
  return createIntent && Boolean(brushAreaEntityKind(text));
}

function wantsBrushVisualEntity(text: string): boolean {
  const lower = text.toLowerCase();
  const createIntent = hasAny(lower, [
    "create",
    "add",
    "place",
    "spawn",
    "generate",
    "make",
    "draw",
    "paint",
    "sketch",
    "\u521b\u5efa",
    "\u6dfb\u52a0",
    "\u751f\u6210",
    "\u653e\u7f6e",
    "\u753b",
    "\u7ed8\u5236",
    "\u52a0",
  ]);
  return createIntent && Boolean(brushVisualEntityKind(text));
}

function brushVisualEntityKind(text: string): "cloud" | undefined {
  const lower = text.toLowerCase();
  if (hasAny(lower, ["cloud", "mist", "\u4e91", "\u4e91\u6735", "\u4e91\u5c42", "\u96fe"])) return "cloud";
  return undefined;
}

function brushAreaEntityKind(text: string): BrushAreaEntityKind | undefined {
  const lower = text.toLowerCase();
  if (hasAny(lower, ["hazard", "danger", "damage zone", "spike", "\u5371\u9669", "\u4f24\u5bb3", "\u523a"])) return "hazard";
  if (hasAny(lower, ["terrain", "landform", "\u5730\u5f62", "\u5730\u8c8c"])) return "terrain";
  if (hasAny(lower, ["trigger", "sensor", "zone", "\u89e6\u53d1", "\u533a\u57df", "\u611f\u5e94"])) return "trigger";
  if (hasAny(lower, ["platform", "ground", "block", "floor", "\u5e73\u53f0", "\u5730\u9762", "\u65b9\u5757", "\u5899"])) return "platform";
  return undefined;
}

function wantsColliderFromBrushArea(text: string): boolean {
  const lower = text.toLowerCase();
  return hasAny(lower, [
    "collider",
    "collision",
    "hitbox",
    "hurtbox",
    "body size",
    "\u78b0\u649e",
    "\u5224\u5b9a",
    "\u53d7\u51fb",
    "\u653b\u51fb\u6846",
  ]);
}

function wantsPatrolPath(text: string): boolean {
  const lower = text.toLowerCase();
  return hasAny(lower, ["patrol", "path", "route", "walk between", "\u5de1\u903b", "\u8def\u5f84", "\u8def\u7ebf", "\u6765\u56de\u8d70"]);
}

type BrushAreaEntityKind = "hazard" | "trigger" | "platform" | "terrain";

function createBrushVisualResourceEntity(
  scene: Scene,
  brush: BrushCompiledContext,
  rect: { x: number; y: number; w: number; h: number },
  text: string,
  normalizedText: string,
): { resource: Resource; entity: Entity } {
  const kind = brushVisualEntityKind(text) || "cloud";
  const resourceId = makeId<"ResourceId">("res") as ResourceId;
  const entityId = makeId<"EntityId">("ent") as EntityId;
  const polygon = brushShape(brush).kind === "closed-shape" ? brushPolygonGeometry(brushClosedShapePoints(brush)) : undefined;
  const displayName = kind === "cloud" ? "\u8d85\u7ea7\u753b\u7b14\u4e91\u6735" : "\u8d85\u7ea7\u753b\u7b14\u56fe\u50cf";
  const visualSize = polygon?.size || { x: rect.w, y: rect.h };
  const visualCenter = polygon?.center || { x: roundTo(rect.x + rect.w / 2, 4), y: roundTo(rect.y + rect.h / 2, 4) };
  const resource: Resource = {
    id: resourceId,
    internalName: `SuperBrushCloud_${resourceId.slice(-6)}`,
    displayName: "\u4e91\u6735\u7a0b\u5e8f\u8d34\u56fe",
    type: "image",
    description: "\u6839\u636e\u8d85\u7ea7\u753b\u7b14\u6807\u6ce8\u751f\u6210\u7684\u900f\u660e\u4e91\u6735\u8d34\u56fe\u3002",
    aiDescription: normalizedText.slice(0, 240),
    tags: ["ai", "super-brush", "cloud", "texture"],
    attachments: [
      {
        id: `att-${resourceId.slice(-8)}`,
        fileName: "super-brush-cloud.svg",
        mime: "image/svg+xml",
        path: proceduralCloudSvgDataUrl(resourceId),
      },
    ],
  };
  const binding: ResourceBinding = {
    resourceId,
    slot: "current",
    description: "\u8d85\u7ea7\u753b\u7b14\u751f\u6210\u4e91\u6735\u8d34\u56fe",
    aiDescription: normalizedText.slice(0, 240),
    localOffset: { x: 0, y: 0 },
    localRotation: 0,
    localScale: { x: 1, y: 1 },
  };
  const entity: Entity = {
    id: entityId,
    internalName: `super_brush_cloud_${entityId.slice(-6)}`,
    displayName,
    kind: "effect",
    persistent: true,
    transform: {
      position: visualCenter,
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    render: {
      visible: true,
      color: "#ffffff",
      opacity: 0.96,
      layerId: scene.layers[0]?.id || "world",
      size: visualSize,
      offset: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      resourceId,
      slot: "current",
      state: "current",
    },
    body: {
      mode: "none",
      velocity: { x: 0, y: 0 },
      gravityScale: 0,
      friction: 0,
      bounce: 0,
    },
    collider: polygon
      ? {
          shape: "polygon",
          size: polygon.size,
          points: polygon.localPoints,
          solid: false,
          trigger: false,
          layerMask: ["world"],
          offset: { x: 0, y: 0 },
          rotation: 0,
        }
      : undefined,
    resources: [binding],
    tags: ["super-brush", "ai-generated", "cloud", "texture"],
  };
  return { resource, entity };
}

function createBrushAreaEntity(
  scene: Scene,
  brush: BrushCompiledContext,
  rect: { x: number; y: number; w: number; h: number },
  text: string,
  normalizedText: string,
): Entity {
  const kind = brushAreaEntityKind(text) || "trigger";
  const id = makeId<"EntityId">("ent") as EntityId;
  const displayName = brushAreaEntityDisplayName(kind);
  const solid = kind === "platform" || kind === "terrain";
  const trigger = !solid;
  const shape = brushShape(brush);
  const polygon = shape.kind === "closed-shape" ? brushPolygonGeometry(brushClosedShapePoints(brush)) : undefined;
  const baseEntity: Entity = {
    id,
    internalName: `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${id.slice(-6)}`,
    displayName,
    kind: trigger ? "trigger" : "entity",
    persistent: true,
    transform: {
      position: polygon?.center || { x: roundTo(rect.x + rect.w / 2, 4), y: roundTo(rect.y + rect.h / 2, 4) },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    body: {
      mode: "static",
      velocity: { x: 0, y: 0 },
      gravityScale: 0,
      friction: 0.8,
      bounce: 0,
    },
    collider: polygon
      ? {
          shape: "polygon",
          size: polygon.size,
          points: polygon.localPoints,
          offset: { x: 0, y: 0 },
          rotation: 0,
          solid,
          trigger,
          layerMask: ["world"],
        }
      : {
          shape: "box",
          size: { x: rect.w, y: rect.h },
          offset: { x: 0, y: 0 },
          rotation: 0,
          solid,
          trigger,
          layerMask: ["world"],
        },
    behavior: trigger
      ? {
          description: kind === "hazard" ? "Super brush generated hazard trigger." : "Super brush generated trigger zone.",
          normalizedDescription: normalizedText,
          params: kind === "hazard" ? { damage: 1 } : {},
        }
      : undefined,
    resources: [],
    tags: ["super-brush", kind, ...(polygon ? ["closed-shape"] : [])],
  };
  if (polygon) return baseEntity;
  return {
    ...baseEntity,
    render: {
      visible: true,
      color: kind === "hazard" ? "#d06969" : kind === "terrain" ? "#6f8f64" : kind === "platform" ? "#71818f" : "#d7c84a",
      opacity: solid ? 1 : 0.45,
      layerId: scene.layers[0]?.id || "world",
      size: { x: rect.w, y: rect.h },
      offset: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
  };
}

function brushClosedShapePoints(brush: BrushCompiledContext): Vec2[] | undefined {
  const shape = brushShape(brush);
  if (shape.kind !== "closed-shape") return undefined;
  const path = primaryBrushPath(brush);
  if (path?.points.length && path.points.length >= 4) return path.points;
  return shape.approximatePolygon;
}

function brushPolygonGeometry(points: Vec2[] | undefined): { center: Vec2; size: Vec2; localPoints: Vec2[] } | undefined {
  const cleaned = simplifyBrushPolygon(points || [], 4);
  if (cleaned.length < 3) return undefined;
  const xs = cleaned.map((point) => point.x);
  const ys = cleaned.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const size = { x: Math.max(4, roundTo(maxX - minX, 4)), y: Math.max(4, roundTo(maxY - minY, 4)) };
  if (Math.abs(brushPolygonArea(cleaned)) < 12) return undefined;
  const center = { x: roundTo((minX + maxX) / 2, 4), y: roundTo((minY + maxY) / 2, 4) };
  return {
    center,
    size,
    localPoints: cleaned.map((point) => ({ x: roundTo(point.x - center.x, 4), y: roundTo(point.y - center.y, 4) })),
  };
}

function simplifyBrushPolygon(points: Vec2[], minDistance: number): Vec2[] {
  const cleaned: Vec2[] = [];
  for (const point of points) {
    const last = cleaned[cleaned.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) cleaned.push(point);
  }
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first && last && cleaned.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < minDistance) cleaned.pop();
  return removeNearlyCollinearBrushPoints(cleaned);
}

function removeNearlyCollinearBrushPoints(points: Vec2[]): Vec2[] {
  if (points.length <= 3) return points;
  return points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const cross = Math.abs((point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x));
    return cross > 2;
  });
}

function brushPolygonArea(points: Vec2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function proceduralCloudSvgDataUrl(seed: string): string {
  const hueShift = seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 14;
  const blue = 236 + (hueShift % 8);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 512">
  <defs>
    <filter id="soft" x="-15%" y="-20%" width="130%" height="145%">
      <feGaussianBlur stdDeviation="10"/>
    </filter>
    <linearGradient id="cloudFill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.58" stop-color="#eef7ff"/>
      <stop offset="1" stop-color="rgb(217,233,${blue})"/>
    </linearGradient>
    <linearGradient id="shadowFill" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#bdd6eb" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#7c9ab5" stop-opacity="0.18"/>
    </linearGradient>
  </defs>
  <g opacity="0.95">
    <ellipse cx="512" cy="336" rx="378" ry="96" fill="#6f8faa" opacity="0.18" filter="url(#soft)"/>
    <path d="M156 352c-42-5-74-39-74-82 0-46 37-84 83-84 12 0 24 3 35 8 30-69 98-117 177-117 61 0 117 29 153 76 30-22 67-35 107-35 88 0 162 64 176 149 59 7 104 57 104 118 0 66-53 119-119 119H172c-54 0-98-44-98-98 0-25 9-47 24-64 16 8 36 12 58 10z" fill="url(#cloudFill)"/>
    <path d="M170 379c80 38 210 48 322 20 126-32 214-23 336 10-15 56-65 95-124 95H172c-54 0-98-44-98-98 0-14 3-27 8-39 25 4 54 8 88 12z" fill="url(#shadowFill)" opacity="0.82"/>
    <ellipse cx="296" cy="242" rx="138" ry="113" fill="#ffffff" opacity="0.72"/>
    <ellipse cx="494" cy="210" rx="164" ry="132" fill="#ffffff" opacity="0.66"/>
    <ellipse cx="681" cy="274" rx="176" ry="124" fill="#ffffff" opacity="0.58"/>
    <path d="M170 383c118 50 233 53 350 24 95-24 196-10 304 24" fill="none" stroke="#c2d8ea" stroke-width="18" stroke-linecap="round" opacity="0.32"/>
  </g>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function brushAreaEntityDisplayName(kind: BrushAreaEntityKind): string {
  if (kind === "hazard") return "Brush Hazard Zone";
  if (kind === "terrain") return "Brush Terrain";
  if (kind === "platform") return "Brush Platform";
  return "Brush Trigger Zone";
}

function targetKey(target: TargetRef): string {
  if (target.kind === "scene") return `scene:${target.sceneId}`;
  if (target.kind === "entity") return `entity:${target.entityId}`;
  if (target.kind === "resource") return `resource:${target.resourceId}`;
  if (target.kind === "runtime") return `runtime:${target.sceneId || ""}`;
  return `area:${target.sceneId}:${target.rect.x}:${target.rect.y}:${target.rect.w}:${target.rect.h}`;
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
  if (hasAny(lower, ["twice as fast", "double speed", "double the speed", "2x speed", "x2 speed"])) {
    requests.push({ key: "speed", factor: 2, label: "speed x2" });
  } else if (hasAny(lower, ["half as fast", "half speed", "halve speed", "50% speed"])) {
    requests.push({ key: "speed", factor: 0.5, label: "speed x0.5" });
  } else if (hasAny(lower, ["faster", "quicker", "speed up", "\u66f4\u5feb", "\u52a0\u5feb", "\u52a0\u901f"])) {
    requests.push({ key: "speed", factor: 1.25, label: "speed +25%" });
  } else if (hasAny(lower, ["slower", "slow down", "\u66f4\u6162", "\u51cf\u901f", "\u6162\u4e00\u70b9"])) {
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
    /(?:collider|collision|hitbox|hurtbox|\u78b0\u649e|\u5224\u5b9a|\u78b0\u649e\u4f53).{0,24}?(\d+(?:\.\d+)?)\s*(?:[xX*]|\bby\b)\s*(\d+(?:\.\d+)?)/i,
    /(?:size|width height|\u5c3a\u5bf8|\u5927\u5c0f|\u5bbd\u9ad8).{0,16}?(\d+(?:\.\d+)?)\s*(?:[xX*]|\bby\b)\s*(\d+(?:\.\d+)?)/i,
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
  const hasVisualIntent = hasColorIntent || hasAny(lower, ["make", "set", "turn", "change", "become", "paint"]);
  for (const [name, value] of Object.entries(colorNames)) {
    const isAsciiName = /^[a-z]+$/.test(name);
    const matched = isAsciiName ? new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text) : text.includes(name);
    if (matched && (hasVisualIntent || !isAsciiName)) return value;
  }
  return undefined;
}

function parseOpacity(text: string): number | undefined {
  const explicit = findNumberForAliases(text, ["opacity", "alpha", "\u900f\u660e\u5ea6", "\u4e0d\u900f\u660e\u5ea6"]);
  if (explicit !== undefined) return normalizeOpacity(explicit);
  const lower = text.toLowerCase();
  const transparentPercent = lower.match(/(\d+(?:\.\d+)?)\s*%?\s*transparent/);
  if (transparentPercent) return normalizeOpacity(Number(transparentPercent[1]));
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
  if (hasAny(lower, ["trigger zone", "make trigger", "make it a trigger", "as trigger", "a trigger", "\u89e6\u53d1\u5668", "\u8bbe\u4e3a\u89e6\u53d1"])) return true;
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
  const targets = effectiveTaskTargets(task);
  const entityTarget = existingEntityTargets(scene.entities, targets)[0];
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
    const patches: ProjectPatch[] = [{ op: "set", path, value: next }];
    const inversePatches: ProjectPatch[] = [{ op: "set", path, value: entity }];
    const verificationPlan = createVerificationPlan({
      project,
      task,
      normalizedText,
      patches,
      inversePatches,
      testTarget: entityTarget,
      intents: [`${entity.displayName}: fallback annotation`],
    });
    return ok({
      normalizedText,
      patches,
      inversePatches,
      testScript: createSmokeScript(entityTarget, verificationPlan.frameChecks, verificationPlan.runtimeSetupSteps),
      verificationPlan,
      diffSummary: `AI fallback: update ${entity.displayName} annotation.`,
    });
  }

  const resourceId = makeId<"ResourceId">("res") as ResourceId;
  const path = `/resources/${resourceId}` as const;
  const target = targets.find((item) => item.kind === "scene") || { kind: "scene" as const, sceneId: project.activeSceneId };
  const resource: Resource = {
    id: resourceId,
    internalName: `AiTaskNote_${task.id}`,
    displayName: `AI Task Note ${task.id}`,
    type: "note",
    description: normalizedText,
    aiDescription: normalizedText.slice(0, 240),
    tags: ["ai", "task", "note"],
    attachments: [],
  };
  const patches: ProjectPatch[] = [{ op: "set", path, value: resource }];
  const inversePatches: ProjectPatch[] = [{ op: "delete", path }];
  const verificationPlan = createVerificationPlan({
    project,
    task,
    normalizedText,
    patches,
    inversePatches,
    testTarget: target,
    intents: ["fallback resource note"],
  });
  return ok({
    normalizedText,
    patches,
    inversePatches,
    testScript: createSmokeScript(target, verificationPlan.frameChecks, verificationPlan.runtimeSetupSteps),
    verificationPlan,
    diffSummary: `AI fallback: add task note for ${task.id}.`,
  });
}

function createSmokeScript(target: TargetRef, acceptanceCriteria: FrameCheck[] = [], setupSteps: InputScript["steps"] = []): InputScript {
  const checks = acceptanceCriteria.filter((check) => check.target.kind !== "resource");
  return {
    steps: [
      { op: "wait", ticks: 2 },
      ...setupSteps,
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
