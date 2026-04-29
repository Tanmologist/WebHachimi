import type { Entity, Resource, Scene } from "../project/schema";
import type { EntityId } from "../shared/types";
import { renderTreeItemHtml } from "./panelViews";
import type { CanvasTargetPart } from "./renderer";
import { escapeHtml } from "./viewText";

export type SceneTreeCallbacks = {
  onSelectEntity: (entityId: string, part: CanvasTargetPart) => void;
  onMoveEntityToFolder: (entityId: EntityId, folderId: string) => void;
  onToggleNode?: (nodeId: string) => void;
  onOpenContextMenu?: (target: { entityId: string; part: CanvasTargetPart; clientX: number; clientY: number }) => void;
};

export function renderSceneTreeHtml(
  scene: Scene,
  entities: Entity[],
  selectedId: string,
  selectedPart: CanvasTargetPart,
  resources: Record<string, Resource> = {},
  collapsedNodes: ReadonlySet<string> = new Set(),
): string {
  const folderHtml = scene.folders
    .map((folder) => {
      const nodeId = `folder:${folder.id}`;
      const collapsed = collapsedNodes.has(nodeId);
      const children = folder.entityIds
        .map((id) => entities.find((entity) => entity.id === id))
        .filter(Boolean)
        .map((entity) => renderTreeItemHtml(entity!, selectedId, selectedPart, resources, collapsedNodes))
        .join("");
      return `
        <section class="v2-folder" data-folder-id="${escapeHtml(folder.id)}" data-tree-collapsed="${collapsed ? "true" : "false"}">
          <header>
            <button class="v2-tree-toggle" data-tree-toggle="${escapeHtml(nodeId)}" type="button">${collapsed ? "▸" : "▾"}</button>
            <span>${escapeHtml(folder.displayName)}</span>
            <small>${visibleFolderCount(folder.entityIds, entities)}</small>
          </header>
          ${collapsed ? "" : children || `<p class="v2-empty">拖入对象到这里</p>`}
        </section>
      `;
    })
    .join("");
  const folderedIds = new Set(scene.folders.flatMap((folder) => folder.entityIds));
  const looseHtml = entities
    .filter((entity) => !folderedIds.has(entity.id))
    .map((entity) => renderTreeItemHtml(entity, selectedId, selectedPart, resources, collapsedNodes))
    .join("");
  const looseNodeId = "folder:__loose";
  const looseCollapsed = collapsedNodes.has(looseNodeId);
  return `${folderHtml}${
    looseHtml
      ? `<section class="v2-folder" data-tree-collapsed="${looseCollapsed ? "true" : "false"}">
          <header>
            <button class="v2-tree-toggle" data-tree-toggle="${looseNodeId}" type="button">${looseCollapsed ? "▸" : "▾"}</button>
            <span>未归类</span>
          </header>
          ${looseCollapsed ? "" : looseHtml}
        </section>`
      : ""
  }`;
}

function visibleFolderCount(entityIds: EntityId[], entities: Entity[]): number {
  const visibleIds = new Set(entities.map((entity) => entity.id));
  return entityIds.filter((id) => visibleIds.has(id)).length;
}

export function bindSceneTreeInteractions(tree: HTMLElement, callbacks: SceneTreeCallbacks): void {
  tree.querySelectorAll<HTMLButtonElement>("[data-tree-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onToggleNode?.(button.dataset.treeToggle || "");
    });
  });
  tree.querySelectorAll<HTMLButtonElement>("[data-entity-id]").forEach((button) => {
    button.addEventListener("click", () => {
      callbacks.onSelectEntity(button.dataset.entityId || "", (button.dataset.part as CanvasTargetPart | undefined) || "body");
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      callbacks.onOpenContextMenu?.({
        entityId: button.dataset.entityId || "",
        part: (button.dataset.part as CanvasTargetPart | undefined) || "body",
        clientX: event.clientX,
        clientY: event.clientY,
      });
    });
    button.addEventListener("dragstart", (event) => {
      if (button.draggable !== true || button.dataset.part === "presentation") {
        event.preventDefault();
        return;
      }
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
