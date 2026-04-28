import type { Entity, Project } from "../project/schema";
import { createEmptyProject } from "../project/schema";
import { makeId, type EntityId, type ResourceId } from "../shared/types";

export function createStarterProject(): Project {
  const created = createEmptyProject("WebHachimi v2 示例");
  if (!created.ok) throw new Error(created.error);

  const project = created.value;
  project.meta.name = "WebHachimi v2 编辑器";
  const scene = project.scenes[project.activeSceneId];
  scene.name = "测试场景";
  scene.layers = [{ id: "world", displayName: "世界", order: 0, visible: true, locked: false }];

  const playerId = makeId<"EntityId">("ent") as EntityId;
  const attackId = makeId<"EntityId">("ent") as EntityId;
  const groundId = makeId<"EntityId">("ent") as EntityId;
  const ledgeId = makeId<"EntityId">("ent") as EntityId;
  const enemyId = makeId<"EntityId">("ent") as EntityId;
  const shadowResourceId = makeId<"ResourceId">("res") as ResourceId;

  scene.entities[playerId] = makeBox({
    id: playerId,
    internalName: "Player",
    displayName: "玩家",
    kind: "entity",
    x: -280,
    y: 120,
    w: 52,
    h: 68,
    color: "#35bd9a",
    body: "dynamic",
    behavior: "playerPlatformer",
    tags: ["玩家", "实体", "硬质碰撞"],
  });

  scene.entities[attackId] = makeBox({
    id: attackId,
    internalName: "Player_Attack_Hitbox",
    displayName: "普通攻击判定",
    kind: "effect",
    x: -214,
    y: 120,
    w: 72,
    h: 38,
    color: "#d7a84a",
    body: "none",
    tags: ["临时对象", "攻击判定", "表现预览"],
    parentId: playerId,
    opacity: 0.32,
  });
  scene.entities[attackId].persistent = false;

  scene.entities[groundId] = makeBox({
    id: groundId,
    internalName: "Ground_Main",
    displayName: "主地面",
    kind: "entity",
    x: 0,
    y: 310,
    w: 760,
    h: 48,
    color: "#969a90",
    body: "static",
    tags: ["地面", "硬质地面"],
  });

  scene.entities[ledgeId] = makeBox({
    id: ledgeId,
    internalName: "Ground_Ledge_Left",
    displayName: "左侧平台",
    kind: "entity",
    x: 190,
    y: 110,
    w: 240,
    h: 34,
    color: "#969a90",
    body: "static",
    tags: ["地面", "平台", "硬质地面"],
  });

  scene.entities[enemyId] = makeBox({
    id: enemyId,
    internalName: "Enemy_Patrol",
    displayName: "巡逻敌人",
    kind: "entity",
    x: -120,
    y: 246,
    w: 52,
    h: 44,
    color: "#e06c6c",
    body: "kinematic",
    behavior: "enemyPatrol",
    tags: ["敌人", "实体"],
  });
  if (scene.entities[enemyId].body) scene.entities[enemyId].body.velocity.x = -70;

  project.resources[shadowResourceId] = {
    id: shadowResourceId,
    internalName: "Player_Death_Fade_Sprite",
    displayName: "死亡淡出残影",
    type: "sprite",
    description: "玩家死亡后使用的残影图，逐渐变透明并消失。",
    aiDescription: "死亡后残影，淡出消失。",
    tags: ["玩家", "死亡", "表现体"],
    attachments: [],
  };
  scene.entities[playerId].resources.push({
    resourceId: shadowResourceId,
    slot: "death",
    description: "死亡后使用这张图，缓慢淡出。",
    aiDescription: "死亡残影淡出。",
    localOffset: { x: 0, y: 0 },
    localRotation: 0,
    localScale: { x: 1, y: 1 },
  });

  scene.folders = [
    { id: "terrain", displayName: "地面", entityIds: [groundId, ledgeId] },
    { id: "characters", displayName: "角色", entityIds: [playerId, enemyId] },
    { id: "runtime", displayName: "运行时捕捉", entityIds: [attackId] },
  ];

  return project;
}

export function repairKnownStarterLabels(project: Project): Project {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) return project;
  if (isBrokenLabel(project.meta.name)) project.meta.name = "WebHachimi v2 编辑器";
  if (isBrokenLabel(scene.name)) scene.name = "测试场景";

  const folderNames: Record<string, string> = {
    terrain: "地面",
    characters: "角色",
    runtime: "运行时捕捉",
  };
  scene.folders.forEach((folder) => {
    const label = folderNames[folder.id];
    if (label && isBrokenLabel(folder.displayName)) folder.displayName = label;
  });

  const entityNames: Record<string, { displayName: string; tags: string[]; description?: string }> = {
    Player: {
      displayName: "玩家",
      tags: ["玩家", "实体", "硬质碰撞"],
      description: "玩家平台移动控制器",
    },
    Player_Attack_Hitbox: {
      displayName: "普通攻击判定",
      tags: ["临时对象", "攻击判定", "表现预览"],
    },
    Ground_Main: {
      displayName: "主地面",
      tags: ["地面", "硬质地面"],
    },
    Ground_Ledge_Left: {
      displayName: "左侧平台",
      tags: ["地面", "平台", "硬质地面"],
    },
    Enemy_Patrol: {
      displayName: "巡逻敌人",
      tags: ["敌人", "实体"],
      description: "敌人左右巡逻",
    },
  };
  Object.values(scene.entities).forEach((entity) => {
    const labels = entityNames[entity.internalName];
    if (labels) {
      if (isBrokenLabel(entity.displayName)) entity.displayName = labels.displayName;
      if (entity.tags.some(isBrokenLabel)) entity.tags = labels.tags;
      if (entity.behavior && labels.description && isBrokenLabel(entity.behavior.description)) {
        entity.behavior.description = labels.description;
      }
    }
    entity.resources.forEach((attachment) => {
      const resource = project.resources[attachment.resourceId];
      if (resource?.internalName !== "Player_Death_Fade_Sprite") return;
      if (isBrokenLabel(attachment.description)) attachment.description = "死亡后使用这张图，并缓慢淡出。";
      if (isBrokenLabel(attachment.aiDescription || "")) attachment.aiDescription = "死亡残影淡出。";
    });
  });

  Object.values(project.resources).forEach((resource) => {
    if (resource.internalName !== "Player_Death_Fade_Sprite") return;
    if (isBrokenLabel(resource.displayName)) resource.displayName = "死亡淡出残影";
    if (isBrokenLabel(resource.description)) resource.description = "玩家死亡后使用的残影图，逐渐变透明并消失。";
    if (isBrokenLabel(resource.aiDescription || "")) resource.aiDescription = "死亡后残影，淡出消失。";
    if (resource.tags.some(isBrokenLabel)) resource.tags = ["玩家", "死亡", "表现体"];
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
  behavior?: "playerPlatformer" | "enemyPatrol";
  tags: string[];
  parentId?: EntityId;
  opacity?: number;
};

function makeBox(input: BoxInput): Entity {
  const gravityScale = input.body === "dynamic" ? 1 : 0;
  return {
    id: input.id,
    internalName: input.internalName,
    displayName: input.displayName,
    kind: input.kind,
    persistent: true,
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
    },
    body: {
      mode: input.body,
      velocity: input.body === "kinematic" ? { x: 90, y: 0 } : { x: 0, y: 0 },
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
          description: input.behavior === "playerPlatformer" ? "玩家平台移动控制器" : "敌人左右巡逻",
          params:
            input.behavior === "playerPlatformer"
              ? { speed: 300, jump: 620, health: 3, parryWindowFrames: 8, parryCooldownFrames: 27 }
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
                },
        }
      : undefined,
    resources: [],
    tags: input.tags,
    parentId: input.parentId,
  };
}

function isBrokenLabel(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const questionCount = [...trimmed].filter((char) => char === "?").length;
  return trimmed.includes("�") || (questionCount >= 2 && questionCount >= Math.ceil(trimmed.length * 0.5));
}
