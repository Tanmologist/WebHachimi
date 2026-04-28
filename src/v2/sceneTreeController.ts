import type { Entity, Scene } from "../project/schema";
import type { EntityId } from "../shared/types";
import { renderTreeItemHtml } from "./panelViews";
import { escapeHtml } from "./viewText";

export type SceneTreeCallbacks = {
  onSelectEntity: (entityId: string) => void;
  onMoveEntityToFolder: (entityId: EntityId, folderId: string) => void;
};

export function renderSceneTreeHtml(scene: Scene, entities: Entity[], selectedId: string): string {
  const folderHtml = scene.folders
    .map((folder) => {
      const children = folder.entityIds
        .map((id) => entities.find((entity) => entity.id === id))
        .filter(Boolean)
        .map((entity) => renderTreeItemHtml(entity!, selectedId))
        .join("");
      return `
        <section class="v2-folder" data-folder-id="${escapeHtml(folder.id)}">
          <header><span>${escapeHtml(folder.displayName)}</span><small>${visibleFolderCount(folder.entityIds, entities)}</small></header>
          ${children || `<p class="v2-empty">拖入对象到这里</p>`}
        </section>
      `;
    })
    .join("");
  const folderedIds = new Set(scene.folders.flatMap((folder) => folder.entityIds));
  const looseHtml = entities
    .filter((entity) => !folderedIds.has(entity.id))
    .map((entity) => renderTreeItemHtml(entity, selectedId))
    .join("");
  return `${folderHtml}${looseHtml ? `<section class="v2-folder"><header><span>未归类</span></header>${looseHtml}</section>` : ""}`;
}

function visibleFolderCount(entityIds: EntityId[], entities: Entity[]): number {
  const visibleIds = new Set(entities.map((entity) => entity.id));
  return entityIds.filter((id) => visibleIds.has(id)).length;
}

export function bindSceneTreeInteractions(tree: HTMLElement, callbacks: SceneTreeCallbacks): void {
  tree.querySelectorAll<HTMLButtonElement>("[data-entity-id]").forEach((button) => {
    button.addEventListener("click", () => {
      callbacks.onSelectEntity(button.dataset.entityId || "");
    });
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", button.dataset.entityId || "");
    });
  });
  tree.querySelectorAll<HTMLElement>("[data-folder-id]").forEach((folderNode) => {
    folderNode.addEventListener("dragover", (event) => event.preventDefault());
    folderNode.addEventListener("drop", (event) => {
      event.preventDefault();
      const entityId = event.dataTransfer?.getData("text/plain") as EntityId | undefined;
      const folderId = folderNode.dataset.folderId;
      if (!entityId || !folderId) return;
      callbacks.onMoveEntityToFolder(entityId, folderId);
    });
  });
}

export function moveEntityIntoFolder(scene: Scene, entities: Entity[], entityId: EntityId, folderId: string): boolean {
  scene.folders.forEach((folder) => {
    folder.entityIds = folder.entityIds.filter((id) => id !== entityId);
  });
  const targetFolder = scene.folders.find((folder) => folder.id === folderId);
  if (!targetFolder) return false;
  targetFolder.entityIds.push(entityId);
  const entity = scene.entities[entityId] || entities.find((item) => item.id === entityId);
  if (entity) entity.folderId = folderId;
  return true;
}
