import type { Entity, ProjectPatch, Scene } from "../project/schema";
import { cloneJson, err, ok, type Result } from "../shared/types";

export type FolderMoveTransactionPlan = {
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  diffSummary: string;
};

export function planPersistentFolderMoveTransaction(
  scene: Scene,
  entity: Entity,
  folderId: string,
): Result<FolderMoveTransactionPlan> {
  if (!entity.persistent) return err("entity is not persistent");
  const targetFolder = scene.folders.find((folder) => folder.id === folderId);
  if (!targetFolder) return err(`folder not found: ${folderId}`);
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`stored entity not found: ${entity.id}`);

  const nextFolders = cloneJson(scene.folders);
  nextFolders.forEach((folder) => {
    folder.entityIds = folder.entityIds.filter((id) => id !== entity.id);
  });
  const nextTargetFolder = nextFolders.find((folder) => folder.id === folderId);
  if (!nextTargetFolder) return err(`folder not found: ${folderId}`);
  nextTargetFolder.entityIds.push(entity.id);

  const foldersPath = `/scenes/${scene.id}/folders` as ProjectPatch["path"];
  const entityFolderPath = `/scenes/${scene.id}/entities/${entity.id}/folderId` as ProjectPatch["path"];
  const previousFolderId = storedEntity.folderId;

  return ok({
    patches: [
      { op: "set", path: foldersPath, value: nextFolders },
      { op: "set", path: entityFolderPath, value: folderId },
    ],
    inversePatches: [
      { op: "set", path: foldersPath, value: cloneJson(scene.folders) },
      previousFolderId
        ? { op: "set", path: entityFolderPath, value: previousFolderId }
        : { op: "delete", path: entityFolderPath },
    ],
    diffSummary: `移动 ${entity.displayName} 到文件夹 ${targetFolder.displayName}。`,
  });
}
