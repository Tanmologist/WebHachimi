import { loadProject, saveProject, saveProjectLocally, type LoadProjectResult, type SaveProjectResult } from "../project/persistence";
import type { Entity, Project, Scene } from "../project/schema";
import { cloneJson } from "../shared/types";

export type BuildProjectForSaveInput = {
  project: Project;
  scene: Scene;
  entities: Iterable<Entity>;
};

export type LoadProjectOutcome = {
  project: Project | null;
  notice: string;
  result: LoadProjectResult;
};

export type SaveProjectOutcome = {
  notice: string;
  result: SaveProjectResult;
};

export function buildProjectForSave(input: BuildProjectForSaveInput): Project {
  const exportedProject = cloneJson(input.project);
  const activeScene = exportedProject.scenes[exportedProject.activeSceneId];
  if (!activeScene) return exportedProject;

  for (const entity of input.entities) {
    if (entity.persistent) activeScene.entities[entity.id] = cloneJson(entity);
  }
  activeScene.folders = cloneJson(input.scene.folders);
  activeScene.layers = cloneJson(input.scene.layers);
  syncEntityFolderIds(activeScene);
  exportedProject.meta.updatedAt = new Date().toISOString();
  return exportedProject;
}

export async function saveProjectFromEditor(project: Project): Promise<SaveProjectOutcome> {
  const result = await saveProject(project);
  return { result, notice: formatSaveNotice(result) };
}

export function saveProjectLocallyFromEditor(project: Project): SaveProjectOutcome {
  const result = saveProjectLocally(project);
  return { result, notice: formatSaveNotice(result) };
}

export async function loadProjectForEditor(): Promise<LoadProjectOutcome> {
  const result = await loadProject();
  return {
    result,
    project: result.project,
    notice: result.project ? formatLoadNotice(result) : "没有已保存的项目。",
  };
}

function formatSaveNotice(result: SaveProjectResult): string {
  const storage = storageLabel(result.storage);
  return result.savedAt ? `项目已自动保存${storage}：${result.savedAt}` : `项目已自动保存${storage}。`;
}

function formatLoadNotice(result: LoadProjectResult): string {
  return `项目已从磁盘载入${storageLabel(result.storage)}。`;
}

function storageLabel(storage: LoadProjectResult["storage"] | SaveProjectResult["storage"]): string {
  return storage === "local" ? "（本地浏览器）" : storage === "api" ? "（磁盘）" : "";
}

function syncEntityFolderIds(scene: Scene): void {
  const folderByEntityId = new Map<string, string>();
  for (const folder of scene.folders) {
    for (const entityId of folder.entityIds) folderByEntityId.set(entityId, folder.id);
  }
  for (const entity of Object.values(scene.entities)) {
    const folderId = folderByEntityId.get(entity.id);
    if (folderId) entity.folderId = folderId;
    else delete entity.folderId;
  }
}
