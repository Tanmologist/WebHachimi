import type { Project, ProjectPatch, Scene } from "../project/schema";
import { cloneJson, err, makeId, ok, type Result, type SceneId } from "../shared/types";

export type WorldManagerTransactionPlan = {
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  diffSummary: string;
  dirtyReason: string;
  noticeText: string;
  resetSelection?: boolean;
};

export type WorldManagerActionPlan =
  | { kind: "transaction"; transaction: WorldManagerTransactionPlan }
  | { kind: "notice"; noticeText: string };

export function planAddWorldTransaction(projectSnapshot: Project): Result<WorldManagerActionPlan> {
  const sourceScene = projectSnapshot.scenes[projectSnapshot.activeSceneId] || Object.values(projectSnapshot.scenes)[0];
  if (!sourceScene) return err("没有可复制设置的世界");
  const sceneId = makeId<"SceneId">("scene") as SceneId;
  const sceneName = uniqueWorldName(projectSnapshot, "新世界");
  const sceneValue: Scene = {
    id: sceneId,
    name: sceneName,
    settings: cloneJson(sourceScene.settings),
    entities: {},
    folders: [],
    layers: cloneJson(sourceScene.layers?.length ? sourceScene.layers : [{ id: "world", displayName: "世界", order: 0, visible: true, locked: false }]),
  };
  return ok({
    kind: "transaction",
    transaction: {
      patches: [
        { op: "set", path: `/scenes/${sceneId}` as ProjectPatch["path"], value: sceneValue },
        { op: "set", path: "/activeSceneId" as ProjectPatch["path"], value: sceneId },
      ],
      inversePatches: [
        { op: "delete", path: `/scenes/${sceneId}` as ProjectPatch["path"] },
        { op: "set", path: "/activeSceneId" as ProjectPatch["path"], value: projectSnapshot.activeSceneId },
      ],
      diffSummary: `添加世界：${sceneName}`,
      dirtyReason: `已添加世界 ${sceneName}`,
      noticeText: `已添加并切换到 ${sceneName}`,
    },
  });
}

export function planSelectWorldTransaction(projectSnapshot: Project, sceneId: SceneId): Result<WorldManagerActionPlan> {
  const target = projectSnapshot.scenes[sceneId];
  if (!target) return err("目标世界不存在");
  const targetName = worldDisplayName(target);
  if (projectSnapshot.activeSceneId === sceneId) {
    return ok({ kind: "notice", noticeText: `${targetName} 已经是当前世界` });
  }
  return ok({
    kind: "transaction",
    transaction: {
      patches: [{ op: "set", path: "/activeSceneId" as ProjectPatch["path"], value: sceneId }],
      inversePatches: [{ op: "set", path: "/activeSceneId" as ProjectPatch["path"], value: projectSnapshot.activeSceneId }],
      diffSummary: `切换世界：${targetName}`,
      dirtyReason: `已切换世界 ${targetName}`,
      noticeText: `已切换到 ${targetName}`,
    },
  });
}

export function planRenameWorldTransaction(projectSnapshot: Project, sceneId: SceneId, rawName: string): Result<WorldManagerActionPlan> {
  const sceneValue = projectSnapshot.scenes[sceneId];
  if (!sceneValue) return err("目标世界不存在");
  const nextName = rawName.trim();
  if (!nextName) return ok({ kind: "notice", noticeText: "世界名称不能为空" });
  if (nextName === sceneValue.name) return ok({ kind: "notice", noticeText: "世界名称没有变化" });
  return ok({
    kind: "transaction",
    transaction: {
      patches: [{ op: "set", path: `/scenes/${sceneId}/name` as ProjectPatch["path"], value: nextName }],
      inversePatches: [{ op: "set", path: `/scenes/${sceneId}/name` as ProjectPatch["path"], value: sceneValue.name }],
      diffSummary: `重命名世界：${sceneValue.name} -> ${nextName}`,
      dirtyReason: `已重命名世界 ${nextName}`,
      noticeText: `世界已重命名为 ${nextName}`,
      resetSelection: false,
    },
  });
}

export function planRemoveWorldTransaction(projectSnapshot: Project, sceneId: SceneId): Result<WorldManagerActionPlan> {
  const scenes = Object.values(projectSnapshot.scenes);
  const sceneValue = projectSnapshot.scenes[sceneId];
  if (!sceneValue) return err("目标世界不存在");
  if (scenes.length <= 1) return ok({ kind: "notice", noticeText: "至少需要保留一个世界" });
  const nextActiveSceneId = projectSnapshot.activeSceneId === sceneId
    ? scenes.find((item) => item.id !== sceneId)?.id as SceneId | undefined
    : projectSnapshot.activeSceneId;
  if (!nextActiveSceneId) return err("没有可切换的世界");
  const patches: ProjectPatch[] = [];
  const inversePatches: ProjectPatch[] = [];
  if (projectSnapshot.activeSceneId !== nextActiveSceneId) {
    patches.push({ op: "set", path: "/activeSceneId" as ProjectPatch["path"], value: nextActiveSceneId });
    inversePatches.push({ op: "set", path: "/activeSceneId" as ProjectPatch["path"], value: projectSnapshot.activeSceneId });
  }
  patches.push({ op: "delete", path: `/scenes/${sceneId}` as ProjectPatch["path"] });
  inversePatches.unshift({ op: "set", path: `/scenes/${sceneId}` as ProjectPatch["path"], value: cloneJson(sceneValue) });
  const removedName = worldDisplayName(sceneValue);
  return ok({
    kind: "transaction",
    transaction: {
      patches,
      inversePatches,
      diffSummary: `移除世界：${removedName}`,
      dirtyReason: `已移除世界 ${removedName}`,
      noticeText: `已移除 ${removedName}`,
    },
  });
}

export function uniqueWorldName(projectSnapshot: Project, baseName: string): string {
  const existing = new Set(Object.values(projectSnapshot.scenes).map((item) => item.name));
  if (!existing.has(baseName)) return baseName;
  let index = 2;
  while (existing.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

function worldDisplayName(scene: Scene): string {
  return scene.name || "未命名世界";
}
