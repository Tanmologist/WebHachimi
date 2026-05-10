import type { Entity, Resource, Scene } from "../project/schema";
import type { EntityId } from "../shared/types";
import { renderTreeItemHtml } from "./panelViews";
import type { CanvasTargetPart } from "./renderer";
import { escapeHtml } from "./viewText";

export type SceneTreeCallbacks = {
  onSelectEntity: (entityId: string, part: CanvasTargetPart) => void;
  onMoveEntityToFolder: (entityId: EntityId, folderId: string) => void;
  onToggleNode?: (nodeId: string) => void;
  onFocusEntity?: (entityId: string, part: CanvasTargetPart) => void;
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
  const entityById = new Map(entities.map((entity) => [entity.id, entity] as const));
  const runtimeFolder = scene.folders.find((folder) => folder.id === "runtime");
  const runtimeEntities = entities.filter((entity) => !entity.persistent);
  const folderedIds = new Set(scene.folders.flatMap((folder) => folder.entityIds));
  if (runtimeFolder) runtimeEntities.forEach((entity) => folderedIds.add(entity.id));
  const looseEntities = entities.filter((entity) => !folderedIds.has(entity.id));
  const folderHtml = scene.folders
    .map((folder) => {
      const nodeId = `folder:${folder.id}`;
      const collapsed = collapsedNodes.has(nodeId);
      const baseChildren = folder.entityIds
        .map((id) => entityById.get(id))
        .filter(Boolean) as Entity[];
      const runtimeChildren = folder.id === runtimeFolder?.id ? runtimeEntities.filter((entity) => !folder.entityIds.includes(entity.id)) : [];
      const folderChildren = [...baseChildren, ...runtimeChildren];
      const children = folderChildren
        .map((entity) => renderTreeItemHtml(entity, selectedId, selectedPart, resources, collapsedNodes))
        .join("");
      return `
        <section class="v2-folder" data-folder-id="${escapeHtml(folder.id)}" data-tree-collapsed="${collapsed ? "true" : "false"}">
          <header>
            <button class="v2-tree-toggle" data-tree-toggle="${escapeHtml(nodeId)}" type="button">${collapsed ? "▸" : "▾"}</button>
            <span>${escapeHtml(folder.displayName)}</span>
            <small>${folderChildren.length} 项</small>
          </header>
          ${collapsed ? "" : children || `<p class="v2-empty v2-empty-compact">空</p>`}
        </section>
      `;
    })
    .join("");
  const looseHtml = looseEntities
    .map((entity) => renderTreeItemHtml(entity, selectedId, selectedPart, resources, collapsedNodes))
    .join("");
  const looseNodeId = "folder:__loose";
  const looseCollapsed = collapsedNodes.has(looseNodeId);
  const overview = `
    <article class="v2-card v2-scene-overview">
      <small class="v2-kicker">当前场景</small>
      <b>${escapeHtml(scene.name || "未命名场景")}</b>
      <div class="v2-metrics">
        ${renderMetric("分组", scene.folders.length)}
        ${renderMetric("对象", entities.length)}
        ${renderMetric("运行时", runtimeEntities.length)}
        ${renderMetric("资源", Object.keys(resources).length)}
        ${renderMetric("未归类", looseEntities.length)}
      </div>
    </article>
  `;

  return `${overview}${folderHtml}${
    looseHtml
      ? `<section class="v2-folder" data-tree-collapsed="${looseCollapsed ? "true" : "false"}">
          <header>
            <button class="v2-tree-toggle" data-tree-toggle="${looseNodeId}" type="button">${looseCollapsed ? "▸" : "▾"}</button>
            <span>未归类</span>
            <small>${looseEntities.length} 项</small>
          </header>
          ${looseCollapsed ? "" : `<p class="v2-folder-hint">这些对象还没有归到任何分组，适合在结构稳定后再整理。</p>${looseHtml}`}
        </section>`
      : ""
  }`;
}

function renderMetric(label: string, value: number): string {
  return `
    <span>
      <small>${escapeHtml(label)}</small>
      <b>${escapeHtml(String(value))}</b>
    </span>
  `;
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
    button.addEventListener("click", (event) => {
      const entityId = button.dataset.entityId || "";
      const part = (button.dataset.part as CanvasTargetPart | undefined) || "body";
      const clickKey = `${entityId}:${part}`;
      const now = Date.now();
      const lastClickAt = Number(tree.dataset.lastEntityClickAt || 0);
      const isDoubleClick = tree.dataset.lastEntityClickKey === clickKey && now - lastClickAt <= 420;
      tree.dataset.lastEntityClickKey = clickKey;
      tree.dataset.lastEntityClickAt = String(now);
      if (isDoubleClick) {
        event.preventDefault();
        delete tree.dataset.lastEntityClickKey;
        delete tree.dataset.lastEntityClickAt;
        callbacks.onFocusEntity?.(entityId, part);
        return;
      }
      callbacks.onSelectEntity(entityId, part);
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
