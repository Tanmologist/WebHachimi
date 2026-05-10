import type { Entity, Project } from "../project/schema";
import { createEmptyProject } from "../project/schema";
import { makeId, type EntityId, type ResourceId } from "../shared/types";

type BuiltinBehavior = NonNullable<Entity["behavior"]>["builtin"];

export function createStarterProject(): Project {
  const created = createEmptyProject("WebHachimi v2 工作坊");
  if (!created.ok) throw new Error(created.error);

  const project = created.value;
  project.meta.name = "WebHachimi v2 工作坊";

  const scene = project.scenes[project.activeSceneId];
  scene.name = "玩法工作坊场景";
  scene.settings.width = 3200;
  scene.settings.height = 900;
  scene.settings.background = "#111313";
  scene.layers = [{ id: "world", displayName: "世界", order: 0, visible: true, locked: false }];

  const playerId = makeId<"EntityId">("ent") as EntityId;
  const attackTemplateId = makeId<"EntityId">("ent") as EntityId;
  const combatGroundId = makeId<"EntityId">("ent") as EntityId;
  const enemyId = makeId<"EntityId">("ent") as EntityId;
  const runnerPlayerId = makeId<"EntityId">("ent") as EntityId;
  const runnerGroundId = makeId<"EntityId">("ent") as EntityId;
  const runnerObstacleId = makeId<"EntityId">("ent") as EntityId;
  const runnerFinishId = makeId<"EntityId">("ent") as EntityId;
  const dividerId = makeId<"EntityId">("ent") as EntityId;
  const playerCurrentResourceId = makeId<"ResourceId">("res") as ResourceId;
  const playerDeathResourceId = makeId<"ResourceId">("res") as ResourceId;

  scene.entities[playerId] = makeBox({
    id: playerId,
    internalName: "Player",
    displayName: "格挡玩家",
    kind: "entity",
    x: 620,
    y: 240,
    w: 52,
    h: 68,
    color: "#35bd9a",
    body: "dynamic",
    behavior: "playerPlatformer",
    behaviorParams: {
      speed: 300,
      jump: 560,
      gravityScale: 1.15,
      fallGravityScale: 1.75,
      jumpReleaseGravityScale: 2.35,
      maxFallSpeed: 1250,
      health: 3,
      parryWindowFrames: 10,
      parryCooldownFrames: 18,
      attackStartupFrames: 4,
      attackActiveFrames: 4,
      attackCooldownFrames: 18,
      attackRange: 92,
      attackHeight: 78,
      attackTouchInset: 10,
      attackTouchVisibleMs: 220,
    },
    tags: ["combat", "player"],
    renderSlot: "current",
    renderResourceId: playerCurrentResourceId,
  });

  scene.entities[attackTemplateId] = makeBox({
    id: attackTemplateId,
    internalName: "Player_Attack_Hitbox",
    displayName: "普通攻击触摸盒模板",
    kind: "effect",
    x: 684,
    y: 240,
    w: 84,
    h: 40,
    color: "#d7a84a",
    body: "none",
    tags: ["runtime", "attack", "touch"],
    parentId: playerId,
    opacity: 0.32,
    persistent: false,
  });

  scene.entities[combatGroundId] = makeBox({
    id: combatGroundId,
    internalName: "Combat_Ground",
    displayName: "战斗地面",
    kind: "entity",
    x: 710,
    y: 320,
    w: 860,
    h: 48,
    color: "#6f756c",
    body: "static",
    tags: ["combat", "ground"],
  });

  scene.entities[enemyId] = makeBox({
    id: enemyId,
    internalName: "Enemy_Patrol",
    displayName: "格挡攻击者",
    kind: "entity",
    x: 730,
    y: 240,
    w: 52,
    h: 44,
    color: "#e06c6c",
    body: "kinematic",
    behavior: "enemyPatrol",
    behaviorParams: {
      speed: 0,
      left: 730,
      right: 730,
      health: 2,
      attackStartupFrames: 10,
      attackActiveFrames: 4,
      attackCooldownFrames: 24,
      attackRange: 110,
      attackHeight: 76,
      attackTouchInset: 10,
      attackTouchVisibleMs: 220,
      parryStunFrames: 16,
    },
    bodyVelocity: { x: -1, y: 0 },
    tags: ["combat", "enemy"],
  });

  scene.entities[runnerPlayerId] = makeBox({
    id: runnerPlayerId,
    internalName: "Runner_Player",
    displayName: "跑酷玩家",
    kind: "entity",
    x: -1100,
    y: 240,
    w: 52,
    h: 68,
    color: "#56b6ff",
    body: "dynamic",
    behavior: "playerPlatformer",
    behaviorParams: {
      speed: 360,
      jump: 640,
      gravityScale: 1,
      fallGravityScale: 1,
      jumpReleaseGravityScale: 1,
      maxFallSpeed: 1200,
      health: 3,
      attackRange: 84,
      attackHeight: 76,
      attackTouchInset: 8,
      attackTouchVisibleMs: 180,
    },
    tags: ["runner", "player"],
  });

  scene.entities[runnerGroundId] = makeBox({
    id: runnerGroundId,
    internalName: "Runner_Ground",
    displayName: "跑酷地面",
    kind: "entity",
    x: -760,
    y: 320,
    w: 1100,
    h: 48,
    color: "#8a8f84",
    body: "static",
    tags: ["runner", "ground"],
  });

  scene.entities[runnerObstacleId] = makeBox({
    id: runnerObstacleId,
    internalName: "Runner_Obstacle_Cactus",
    displayName: "跑酷障碍",
    kind: "entity",
    x: -860,
    y: 264,
    w: 40,
    h: 96,
    color: "#4f8d46",
    body: "static",
    tags: ["runner", "obstacle"],
  });

  scene.entities[runnerFinishId] = makeBox({
    id: runnerFinishId,
    internalName: "Runner_Finish_Marker",
    displayName: "跑酷终点",
    kind: "entity",
    x: -420,
    y: 220,
    w: 40,
    h: 160,
    color: "#f1c75b",
    body: "static",
    tags: ["runner", "finish"],
  });
  if (scene.entities[runnerFinishId].collider) {
    scene.entities[runnerFinishId].collider = {
      ...scene.entities[runnerFinishId].collider,
      solid: false,
      trigger: true,
    };
  }

  scene.entities[dividerId] = makeBox({
    id: dividerId,
    internalName: "Zone_Divider",
    displayName: "区域分隔",
    kind: "entity",
    x: -20,
    y: 180,
    w: 120,
    h: 330,
    color: "#3f4346",
    body: "static",
    tags: ["layout", "divider"],
  });

  project.resources[playerCurrentResourceId] = {
    id: playerCurrentResourceId,
    internalName: "Player_Current_Sprite",
    displayName: "玩家当前可视体",
    type: "sprite",
    description: "战斗玩家当前显示的可视体。",
    aiDescription: "战斗玩家的主可视体。",
    tags: ["player", "combat", "current"],
    attachments: [],
  };
  project.resources[playerDeathResourceId] = {
    id: playerDeathResourceId,
    internalName: "Player_Death_Fade_Sprite",
    displayName: "玩家死亡淡出",
    type: "sprite",
    description: "战斗玩家死亡后使用的淡出可视体。",
    aiDescription: "战斗玩家死亡淡出可视体。",
    tags: ["player", "death"],
    attachments: [],
  };

  scene.entities[playerId].resources.push(
    makeResourceBinding(playerDeathResourceId, "death", "死亡淡出可视体"),
    makeResourceBinding(playerCurrentResourceId, "current", "当前战斗可视体"),
  );

  scene.folders = [
    { id: "terrain", displayName: "地形", entityIds: [combatGroundId, runnerGroundId, runnerObstacleId, runnerFinishId, dividerId] },
    { id: "characters", displayName: "角色", entityIds: [playerId, enemyId, runnerPlayerId] },
    { id: "runtime", displayName: "运行时", entityIds: [attackTemplateId] },
  ];

  return project;
}

export function repairKnownStarterLabels(project: Project): Project {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) return project;

  if (shouldUseBuiltinLabel(project.meta.name, "WebHachimi v2 Workshops")) project.meta.name = "WebHachimi v2 工作坊";
  if (shouldUseBuiltinLabel(scene.name, "Gameplay Workshop Scene")) scene.name = "玩法工作坊场景";
  scene.layers.forEach((layer) => {
    if (layer.id === "world" && shouldUseBuiltinLabel(layer.displayName, "World")) layer.displayName = "世界";
  });

  const folderLabels: Record<string, { legacy: string; displayName: string }> = {
    terrain: { legacy: "Terrain", displayName: "地形" },
    characters: { legacy: "Characters", displayName: "角色" },
    runtime: { legacy: "Runtime", displayName: "运行时" },
  };
  scene.folders.forEach((folder) => {
    const label = folderLabels[folder.id];
    if (label && shouldUseBuiltinLabel(folder.displayName, label.legacy)) folder.displayName = label.displayName;
  });

  const entityLabels: Record<string, { legacy: string; displayName: string; tags: string[]; legacyDescription?: string; description?: string }> = {
    Player: { legacy: "Parry Player", displayName: "格挡玩家", tags: ["combat", "player"], legacyDescription: "Combat player controller.", description: "战斗玩家控制器。" },
    Player_Attack_Hitbox: { legacy: "Attack Template", displayName: "普通攻击触摸盒模板", tags: ["runtime", "attack", "touch"] },
    Combat_Ground: { legacy: "Combat Ground", displayName: "战斗地面", tags: ["combat", "ground"] },
    Enemy_Patrol: { legacy: "Parry Attacker", displayName: "格挡攻击者", tags: ["combat", "enemy"], legacyDescription: "Parry workshop attacker.", description: "格挡工作坊攻击者。" },
    Runner_Player: { legacy: "Runner Player", displayName: "跑酷玩家", tags: ["runner", "player"], legacyDescription: "Runner workshop controller.", description: "跑酷工作坊玩家控制器。" },
    Runner_Ground: { legacy: "Runner Ground", displayName: "跑酷地面", tags: ["runner", "ground"] },
    Runner_Obstacle_Cactus: { legacy: "Runner Obstacle", displayName: "跑酷障碍", tags: ["runner", "obstacle"] },
    Runner_Finish_Marker: { legacy: "Runner Finish", displayName: "跑酷终点", tags: ["runner", "finish"] },
    Zone_Divider: { legacy: "Zone Divider", displayName: "区域分隔", tags: ["layout", "divider"] },
  };

  Object.values(scene.entities).forEach((entity) => {
    repairKnownMovementTuning(entity);
    repairKnownCombatTouchTuning(entity);
    const labels = entityLabels[entity.internalName];
    if (!labels) return;
    if (shouldUseBuiltinLabel(entity.displayName, labels.legacy)) entity.displayName = labels.displayName;
    if (entity.tags.some(isBrokenLabel)) entity.tags = labels.tags;
    const legacyBehaviorDescriptions = [
      labels.legacyDescription,
      entity.behavior?.builtin === "playerPlatformer" ? "Combat or runner player controller." : undefined,
      entity.behavior?.builtin === "enemyPatrol" ? "Patrol attacker controller." : undefined,
    ];
    if (
      entity.behavior &&
      labels.description &&
      (isBrokenLabel(entity.behavior.description) || legacyBehaviorDescriptions.some((description) => description === entity.behavior?.description.trim()))
    ) {
      entity.behavior.description = labels.description;
    }
  });

  Object.values(project.resources).forEach((resource) => {
    if (resource.internalName === "Player_Current_Sprite") {
      if (shouldUseBuiltinLabel(resource.displayName, "Player Current Sprite")) resource.displayName = "玩家当前可视体";
      if (shouldUseBuiltinLabel(resource.description, "Current visible body for the combat player.")) resource.description = "战斗玩家当前显示的可视体。";
      if (shouldUseBuiltinLabel(resource.aiDescription || "", "Main combat player current sprite.")) resource.aiDescription = "战斗玩家的主可视体。";
      if (resource.tags.some(isBrokenLabel)) resource.tags = ["player", "combat", "current"];
    }
    if (resource.internalName === "Player_Death_Fade_Sprite") {
      if (shouldUseBuiltinLabel(resource.displayName, "Player Death Fade")) resource.displayName = "玩家死亡淡出";
      if (shouldUseBuiltinLabel(resource.description, "Fade-out sprite used after the combat player dies.")) resource.description = "战斗玩家死亡后使用的淡出可视体。";
      if (shouldUseBuiltinLabel(resource.aiDescription || "", "Combat player death fade sprite.")) resource.aiDescription = "战斗玩家死亡淡出可视体。";
      if (resource.tags.some(isBrokenLabel)) resource.tags = ["player", "death"];
    }
  });

  Object.values(scene.entities).forEach((entity) => {
    entity.resources.forEach((binding) => {
      const resource = project.resources[binding.resourceId];
      if (resource?.internalName === "Player_Current_Sprite") {
        if (shouldUseBuiltinLabel(binding.description, "Current combat sprite")) binding.description = "当前战斗可视体";
        if (shouldUseBuiltinLabel(binding.aiDescription || "", "Current combat sprite")) binding.aiDescription = "当前战斗可视体";
      }
      if (resource?.internalName === "Player_Death_Fade_Sprite") {
        if (shouldUseBuiltinLabel(binding.description, "Death fade sprite")) binding.description = "死亡淡出可视体";
        if (shouldUseBuiltinLabel(binding.aiDescription || "", "Death fade sprite")) binding.aiDescription = "死亡淡出可视体";
      }
    });
  });

  return project;
}

function repairKnownCombatTouchTuning(entity: Entity): void {
  const behavior = entity.behavior;
  if (!behavior) return;
  const builtin = behavior.builtin;
  if (builtin !== "playerPlatformer" && builtin !== "enemyPatrol") return;
  const params = behavior.params;
  if (entity.internalName === "Player" || entity.internalName === "Enemy_Patrol") {
    setNumberDefault(params, "attackTouchInset", 10);
    setNumberDefault(params, "attackTouchVisibleMs", 220);
    return;
  }
  if (typeof params.attackRange === "number" || typeof params.attackRange === "string") {
    setNumberDefault(params, "attackTouchInset", 8);
    setNumberDefault(params, "attackTouchVisibleMs", 180);
  }
}

function repairKnownMovementTuning(entity: Entity): void {
  if (entity.behavior?.builtin !== "playerPlatformer") return;
  const params = entity.behavior.params;
  if (entity.internalName === "Player") {
    if (isUnsetOrLegacyNumber(params.jump, 620)) params.jump = 560;
    setNumberDefault(params, "gravityScale", 1.15);
    setNumberDefault(params, "fallGravityScale", 1.75);
    setNumberDefault(params, "jumpReleaseGravityScale", 2.35);
    setNumberDefault(params, "maxFallSpeed", 1250);
    return;
  }
  if (entity.internalName === "Runner_Player") {
    setNumberDefault(params, "gravityScale", 1);
    setNumberDefault(params, "fallGravityScale", 1);
    setNumberDefault(params, "jumpReleaseGravityScale", 1);
    setNumberDefault(params, "maxFallSpeed", 1200);
  }
}

function setNumberDefault(params: Record<string, number | string | boolean>, key: string, value: number): void {
  if (typeof params[key] !== "number") params[key] = value;
}

function isUnsetOrLegacyNumber(value: number | string | boolean | undefined, legacy: number): boolean {
  if (value === undefined) return true;
  if (typeof value === "number") return value === legacy;
  if (typeof value === "string") return Number(value) === legacy;
  return false;
}

type BoxInput = {
  id: EntityId;
  internalName: string;
  displayName: string;
  kind: Entity["kind"];
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  body: "static" | "dynamic" | "kinematic" | "none";
  behavior?: Extract<BuiltinBehavior, "playerPlatformer" | "enemyPatrol">;
  behaviorParams?: Record<string, number>;
  bodyVelocity?: { x: number; y: number };
  tags: string[];
  parentId?: EntityId;
  opacity?: number;
  persistent?: boolean;
  renderSlot?: string;
  renderResourceId?: ResourceId;
};

function makeBox(input: BoxInput): Entity {
  const gravityScale = input.body === "dynamic" ? 1 : 0;
  const defaultVelocity = input.body === "kinematic" ? { x: 90, y: 0 } : { x: 0, y: 0 };
  return {
    id: input.id,
    internalName: input.internalName,
    displayName: input.displayName,
    kind: input.kind,
    persistent: input.persistent ?? true,
    transform: {
      position: { x: input.x, y: input.y },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    render: {
      visible: true,
      color: input.color,
      opacity: input.opacity ?? 1,
      layerId: "world",
      size: { x: Math.max(12, input.w), y: Math.max(12, input.h) },
      offset: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      slot: input.renderSlot || "current",
      state: input.renderSlot || "current",
      resourceId: input.renderResourceId,
    },
    body: {
      mode: input.body,
      velocity: input.bodyVelocity || defaultVelocity,
      gravityScale,
      friction: 0.8,
      bounce: 0,
    },
    collider: {
      shape: "box",
      size: { x: input.w, y: input.h },
      solid: input.body !== "none",
      trigger: input.kind === "effect",
      layerMask: ["world"],
    },
    behavior: input.behavior
      ? {
          builtin: input.behavior,
          description: input.behavior === "playerPlatformer" ? "战斗或跑酷玩家控制器。" : "巡逻攻击者控制器。",
          params: {
            ...(input.behavior === "playerPlatformer"
              ? {
                  speed: 300,
                  jump: 560,
                  gravityScale: 1.15,
                  fallGravityScale: 1.75,
                  jumpReleaseGravityScale: 2.35,
                  maxFallSpeed: 1250,
                  health: 3,
                  parryWindowFrames: 8,
                  parryCooldownFrames: 24,
                  attackStartupFrames: 4,
                  attackActiveFrames: 4,
                  attackCooldownFrames: 18,
                  attackRange: Math.max(84, input.w + 24),
                  attackHeight: input.h + 12,
                  attackTouchInset: 8,
                  attackTouchVisibleMs: 180,
                }
              : {
                  speed: 70,
                  left: input.x - 90,
                  right: input.x + 90,
                  health: 1,
                  attackStartupFrames: 13,
                  attackActiveFrames: 7,
                  attackCooldownFrames: 30,
                  attackRange: 210,
                  attackHeight: input.h + 26,
                  attackTouchInset: 8,
                  attackTouchVisibleMs: 180,
                  parryStunFrames: 23,
                }),
            ...input.behaviorParams,
          },
        }
      : undefined,
    resources: [],
    tags: input.tags,
    parentId: input.parentId,
  };
}

function makeResourceBinding(resourceId: ResourceId, slot: string, description: string) {
  return {
    resourceId,
    slot,
    description,
    aiDescription: description,
    localOffset: { x: 0, y: 0 },
    localRotation: 0,
    localScale: { x: 1, y: 1 },
  };
}

function isBrokenLabel(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const questionCount = [...trimmed].filter((char) => char === "?").length;
  return trimmed.includes("锟") || (questionCount >= 2 && questionCount >= Math.ceil(trimmed.length * 0.5));
}

function shouldUseBuiltinLabel(value: string, legacy?: string): boolean {
  const trimmed = value.trim();
  return isBrokenLabel(trimmed) || Boolean(legacy && trimmed === legacy);
}
