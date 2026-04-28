import type { Entity, Project } from "../project/schema";
import { createEmptyProject } from "../project/schema";
import { makeId, type EntityId, type ResourceId } from "../shared/types";

type BuiltinBehavior = NonNullable<Entity["behavior"]>["builtin"];

export function createStarterProject(): Project {
  const created = createEmptyProject("WebHachimi v2 Workshops");
  if (!created.ok) throw new Error(created.error);

  const project = created.value;
  project.meta.name = "WebHachimi v2 Workshops";

  const scene = project.scenes[project.activeSceneId];
  scene.name = "Gameplay Workshop Scene";
  scene.settings.width = 3200;
  scene.settings.height = 900;
  scene.settings.background = "#111313";
  scene.layers = [{ id: "world", displayName: "World", order: 0, visible: true, locked: false }];

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
    displayName: "Parry Player",
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
      jump: 620,
      health: 3,
      parryWindowFrames: 10,
      parryCooldownFrames: 18,
      attackStartupFrames: 4,
      attackActiveFrames: 4,
      attackCooldownFrames: 18,
      attackRange: 92,
      attackHeight: 78,
    },
    tags: ["combat", "player"],
    renderSlot: "current",
    renderResourceId: playerCurrentResourceId,
  });

  scene.entities[attackTemplateId] = makeBox({
    id: attackTemplateId,
    internalName: "Player_Attack_Hitbox",
    displayName: "Attack Template",
    kind: "effect",
    x: 684,
    y: 240,
    w: 84,
    h: 40,
    color: "#d7a84a",
    body: "none",
    tags: ["runtime", "attack"],
    parentId: playerId,
    opacity: 0.32,
    persistent: false,
  });

  scene.entities[combatGroundId] = makeBox({
    id: combatGroundId,
    internalName: "Combat_Ground",
    displayName: "Combat Ground",
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
    displayName: "Parry Attacker",
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
      parryStunFrames: 16,
    },
    bodyVelocity: { x: -1, y: 0 },
    tags: ["combat", "enemy"],
  });

  scene.entities[runnerPlayerId] = makeBox({
    id: runnerPlayerId,
    internalName: "Runner_Player",
    displayName: "Runner Player",
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
      health: 3,
      attackRange: 84,
      attackHeight: 76,
    },
    tags: ["runner", "player"],
  });

  scene.entities[runnerGroundId] = makeBox({
    id: runnerGroundId,
    internalName: "Runner_Ground",
    displayName: "Runner Ground",
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
    displayName: "Runner Obstacle",
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
    displayName: "Runner Finish",
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
    displayName: "Zone Divider",
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
    displayName: "Player Current Sprite",
    type: "sprite",
    description: "Current visible body for the combat player.",
    aiDescription: "Main combat player current sprite.",
    tags: ["player", "combat", "current"],
    attachments: [],
  };
  project.resources[playerDeathResourceId] = {
    id: playerDeathResourceId,
    internalName: "Player_Death_Fade_Sprite",
    displayName: "Player Death Fade",
    type: "sprite",
    description: "Fade-out sprite used after the combat player dies.",
    aiDescription: "Combat player death fade sprite.",
    tags: ["player", "death"],
    attachments: [],
  };

  scene.entities[playerId].resources.push(
    makeResourceBinding(playerDeathResourceId, "death", "Death fade sprite"),
    makeResourceBinding(playerCurrentResourceId, "current", "Current combat sprite"),
  );

  scene.folders = [
    { id: "terrain", displayName: "Terrain", entityIds: [combatGroundId, runnerGroundId, runnerObstacleId, runnerFinishId, dividerId] },
    { id: "characters", displayName: "Characters", entityIds: [playerId, enemyId, runnerPlayerId] },
    { id: "runtime", displayName: "Runtime", entityIds: [attackTemplateId] },
  ];

  return project;
}

export function repairKnownStarterLabels(project: Project): Project {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) return project;

  if (isBrokenLabel(project.meta.name)) project.meta.name = "WebHachimi v2 Workshops";
  if (isBrokenLabel(scene.name)) scene.name = "Gameplay Workshop Scene";

  const folderLabels: Record<string, string> = {
    terrain: "Terrain",
    characters: "Characters",
    runtime: "Runtime",
  };
  scene.folders.forEach((folder) => {
    const label = folderLabels[folder.id];
    if (label && isBrokenLabel(folder.displayName)) folder.displayName = label;
  });

  const entityLabels: Record<string, { displayName: string; tags: string[]; description?: string }> = {
    Player: { displayName: "Parry Player", tags: ["combat", "player"], description: "Combat player controller." },
    Player_Attack_Hitbox: { displayName: "Attack Template", tags: ["runtime", "attack"] },
    Combat_Ground: { displayName: "Combat Ground", tags: ["combat", "ground"] },
    Enemy_Patrol: { displayName: "Parry Attacker", tags: ["combat", "enemy"], description: "Parry workshop attacker." },
    Runner_Player: { displayName: "Runner Player", tags: ["runner", "player"], description: "Runner workshop controller." },
    Runner_Ground: { displayName: "Runner Ground", tags: ["runner", "ground"] },
    Runner_Obstacle_Cactus: { displayName: "Runner Obstacle", tags: ["runner", "obstacle"] },
    Runner_Finish_Marker: { displayName: "Runner Finish", tags: ["runner", "finish"] },
    Zone_Divider: { displayName: "Zone Divider", tags: ["layout", "divider"] },
  };

  Object.values(scene.entities).forEach((entity) => {
    const labels = entityLabels[entity.internalName];
    if (!labels) return;
    if (isBrokenLabel(entity.displayName)) entity.displayName = labels.displayName;
    if (entity.tags.some(isBrokenLabel)) entity.tags = labels.tags;
    if (entity.behavior && labels.description && isBrokenLabel(entity.behavior.description)) {
      entity.behavior.description = labels.description;
    }
  });

  Object.values(project.resources).forEach((resource) => {
    if (resource.internalName === "Player_Current_Sprite") {
      if (isBrokenLabel(resource.displayName)) resource.displayName = "Player Current Sprite";
      if (isBrokenLabel(resource.description)) resource.description = "Current visible body for the combat player.";
      if (isBrokenLabel(resource.aiDescription || "")) resource.aiDescription = "Main combat player current sprite.";
      if (resource.tags.some(isBrokenLabel)) resource.tags = ["player", "combat", "current"];
    }
    if (resource.internalName === "Player_Death_Fade_Sprite") {
      if (isBrokenLabel(resource.displayName)) resource.displayName = "Player Death Fade";
      if (isBrokenLabel(resource.description)) resource.description = "Fade-out sprite used after the combat player dies.";
      if (isBrokenLabel(resource.aiDescription || "")) resource.aiDescription = "Combat player death fade sprite.";
      if (resource.tags.some(isBrokenLabel)) resource.tags = ["player", "death"];
    }
  });

  return project;
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
          description: input.behavior === "playerPlatformer" ? "Combat or runner player controller." : "Patrol attacker controller.",
          params: {
            ...(input.behavior === "playerPlatformer"
              ? {
                  speed: 300,
                  jump: 620,
                  health: 3,
                  parryWindowFrames: 8,
                  parryCooldownFrames: 24,
                  attackStartupFrames: 4,
                  attackActiveFrames: 4,
                  attackCooldownFrames: 18,
                  attackRange: Math.max(84, input.w + 24),
                  attackHeight: input.h + 12,
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
