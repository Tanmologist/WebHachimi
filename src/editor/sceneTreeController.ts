import type { Entity, Resource, Scene } from "../project/schema";
import type { EntityId } from "../shared/types";
import { renderTreeItemHtml } from "./panelViews";
import type { CanvasTargetPart } from "./renderer";
import { escapeHtml } from "./viewText";

export type SceneTreeCallbacks = {
  onSelectEntity: (entityId: string, part: CanvasTargetPart) => void;
  onMoveEntityToFolder: (entityId: EntityId, folderId: string) => void;
  onToggleNode?: (nodeId: string) => void;
  onFilterChange?: (value: string) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
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
  filterText = "",
): string {
  const entityById = new Map(entities.map((entity) => [entity.id, entity] as const));
  const runtimeFolder = scene.folders.find((folder) => folder.id === "runtime");
  const runtimeEntities = entities.filter((entity) => !entity.persistent);
  const folderedIds = new Set(scene.folders.flatMap((folder) => folder.entityIds));
  if (runtimeFolder) runtimeEntities.forEach((entity) => folderedIds.add(entity.id));
  const looseEntities = entities.filter((entity) => !folderedIds.has(entity.id));
  const normalizedFilter = filterText.trim();
  const filterMatchCount = normalizedFilter
    ? entities.filter((entity) => sceneTreeSearchText(entity, resources).toLocaleLowerCase().includes(normalizedFilter.toLocaleLowerCase())).length
    : entities.length;
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
            <span class="v2-folder-icon" aria-hidden="true">${collapsed ? "▸" : "▾"}</span>
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
  const treeBody = `${folderHtml}${
    looseHtml
      ? `<section class="v2-folder" data-tree-collapsed="${looseCollapsed ? "true" : "false"}">
          <header>
            <button class="v2-tree-toggle" data-tree-toggle="${looseNodeId}" type="button">${looseCollapsed ? "▸" : "▾"}</button>
            <span class="v2-folder-icon" aria-hidden="true">${looseCollapsed ? "▸" : "▾"}</span>
            <span>未归类</span>
            <small>${looseEntities.length} 项</small>
          </header>
          ${looseCollapsed ? "" : `<p class="v2-folder-hint">这些对象还没有归到任何分组，适合在结构稳定后再整理。</p>${looseHtml}`}
        </section>`
      : ""
  }`;

  return `<div class="v2-scene-panel">
    <div class="v2-tree-filter">
      <span aria-hidden="true">⌕</span>
      <input data-scene-tree-filter type="text" value="${escapeHtml(filterText)}" placeholder="筛选层级对象" aria-label="筛选层级" />
      <button data-scene-tree-filter-clear type="button" aria-label="清除筛选" ${normalizedFilter ? "" : "hidden"}>×</button>
    </div>
    <div class="v2-tree-summary">
      <span>${escapeHtml(scene.name || "Workspace")}</span>
      <small data-tree-filter-count data-total-count="${escapeHtml(String(entities.length))}" data-loose-count="${escapeHtml(String(looseEntities.length))}">${normalizedFilter ? `匹配 ${filterMatchCount}/${entities.length}` : `${entities.length} 个对象 · ${looseEntities.length} 个未归类`}</small>
    </div>
    <div class="v2-tree-actions" aria-label="层级快捷操作">
      <button data-scene-tree-expand-all type="button">全部展开</button>
      <button data-scene-tree-collapse-all type="button">全部折叠</button>
    </div>
    <section class="v2-folder v2-folder--root" data-tree-collapsed="false">
      <header>
        <span class="v2-tree-toggle-spacer"></span>
        <span class="v2-folder-icon" aria-hidden="true">▾</span>
        <span>${escapeHtml(scene.name || "Workspace")}</span>
        <small>${scene.folders.length} 组</small>
      </header>
      <div class="v2-folder__children">${treeBody}</div>
    </section>
  </div>`;
}

export function bindSceneTreeInteractions(tree: HTMLElement, callbacks: SceneTreeCallbacks): void {
  const filterInput = tree.querySelector<HTMLInputElement>("[data-scene-tree-filter]");
  const filterClear = tree.querySelector<HTMLButtonElement>("[data-scene-tree-filter-clear]");
  if (filterInput) {
    const syncFilter = () => {
      callbacks.onFilterChange?.(filterInput.value);
      applySceneTreeFilter(tree, filterInput.value);
      if (filterClear) filterClear.hidden = filterInput.value.trim().length === 0;
    };
    filterInput.addEventListener("input", syncFilter);
    applySceneTreeFilter(tree, filterInput.value);
  }
  filterClear?.addEventListener("click", (event) => {
    event.preventDefault();
    if (!filterInput) return;
    filterInput.value = "";
    callbacks.onFilterChange?.("");
    applySceneTreeFilter(tree, "");
    filterClear.hidden = true;
    filterInput.focus();
  });
  tree.querySelector<HTMLButtonElement>("[data-scene-tree-expand-all]")?.addEventListener("click", (event) => {
    event.preventDefault();
    callbacks.onExpandAll?.();
  });
  tree.querySelector<HTMLButtonElement>("[data-scene-tree-collapse-all]")?.addEventListener("click", (event) => {
    event.preventDefault();
    callbacks.onCollapseAll?.();
  });
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

function applySceneTreeFilter(tree: HTMLElement, rawFilter: string): void {
  const query = rawFilter.trim().toLocaleLowerCase();
  let visibleCount = 0;
  tree.querySelectorAll<HTMLElement>(".v2-world-node").forEach((node) => {
    const searchText = (node.dataset.treeSearch || "").toLocaleLowerCase();
    node.hidden = Boolean(query) && !searchText.includes(query);
    if (!node.hidden) visibleCount += 1;
  });
  tree.querySelectorAll<HTMLElement>(".v2-folder").forEach((folder) => {
    const childNodes = [...folder.querySelectorAll<HTMLElement>(".v2-world-node")];
    const hasVisibleChild = childNodes.some((node) => !node.hidden);
    const headerText = folder.querySelector("header")?.textContent?.toLocaleLowerCase() || "";
    folder.dataset.filterEmpty = Boolean(query) && !hasVisibleChild && !headerText.includes(query) ? "true" : "false";
  });
  const countNode = tree.querySelector<HTMLElement>("[data-tree-filter-count]");
  if (countNode) {
    const total = Number(countNode.dataset.totalCount || visibleCount);
    const loose = Number(countNode.dataset.looseCount || 0);
    countNode.textContent = query ? `匹配 ${visibleCount}/${total}` : `${total} 个对象 · ${loose} 个未归类`;
  }
}

function sceneTreeSearchText(entity: Entity, resources: Record<string, Resource>): string {
  const resourceName = entity.render?.resourceId ? resources[entity.render.resourceId]?.displayName : "";
  return [
    entity.displayName,
    entity.internalName,
    entity.kind,
    entity.persistent ? "本体" : "运行时",
    entity.render?.visible === false ? "隐藏" : "可视",
    resourceName || "",
  ].join(" ");
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
