import type { Project, Scene } from "../project/schema";
import { escapeHtml } from "./viewText";

export function renderWorldManagerPopoverHtml(project: Project): string {
  const scenes = sortedScenes(project);
  return `
    <div class="world-manager-popover__inner">
      <header class="world-manager-popover__header">
        <strong>世界管理器</strong>
        <button class="world-manager-action" data-world-manager-action="add" type="button">添加</button>
      </header>
      <div class="world-manager-list" role="list">
        ${
          scenes.length
            ? scenes.map((scene) => renderWorldManagerRow(project, scene, scenes.length)).join("")
            : `<p class="world-manager-empty">当前工程还没有世界。</p>`
        }
      </div>
    </div>
  `;
}

function renderWorldManagerRow(project: Project, scene: Scene, sceneCount: number): string {
  const active = project.activeSceneId === scene.id;
  const entityCount = Object.keys(scene.entities || {}).length;
  return `
    <article class="world-manager-row ${active ? "is-active" : ""}" data-world-manager-row="${escapeHtml(scene.id)}" role="listitem">
      <button class="world-manager-row__select" data-world-manager-action="select" data-scene-id="${escapeHtml(scene.id)}" type="button">
        <span>${escapeHtml(scene.name || "未命名世界")}</span>
        <small>${active ? "当前世界" : `${entityCount} 个对象`}</small>
      </button>
      <input data-world-manager-name="${escapeHtml(scene.id)}" type="text" value="${escapeHtml(scene.name || "")}" aria-label="重命名 ${escapeHtml(scene.name || "未命名世界")}" />
      <div class="world-manager-row__actions">
        <button class="world-manager-action" data-world-manager-action="rename" data-scene-id="${escapeHtml(scene.id)}" type="button">重命名</button>
        <button class="world-manager-action is-danger" data-world-manager-action="remove" data-scene-id="${escapeHtml(scene.id)}" type="button" ${sceneCount <= 1 ? "disabled" : ""}>移除</button>
      </div>
    </article>
  `;
}

function sortedScenes(project: Project): Scene[] {
  return Object.values(project.scenes).sort((left, right) => {
    if (left.id === project.activeSceneId) return -1;
    if (right.id === project.activeSceneId) return 1;
    return (left.name || "").localeCompare(right.name || "");
  });
}
