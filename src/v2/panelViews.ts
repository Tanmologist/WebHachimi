import type { Entity, Resource } from "../project/schema";
import type { RuntimeWorld } from "../runtime/world";
import { escapeHtml, formatScale, typeLabel } from "./viewText";

export function renderTreeItemHtml(entity: ReturnType<RuntimeWorld["allEntities"]>[number], selectedId: string): string {
  return `
    <button class="v2-tree-item ${selectedId === entity.id ? "is-selected" : ""}" data-entity-id="${entity.id}" type="button" draggable="true">
      <span>${escapeHtml(entity.displayName)}</span>
      <em>${entity.persistent ? typeLabel(entity.kind) : "临时"}</em>
    </button>
  `;
}

export function renderInspectorHtml(entity: Entity | undefined): string {
  if (!entity) return `<strong>未选中对象</strong>`;
  return `
    <strong>${escapeHtml(entity.displayName)}</strong>
    <small>实际命名：${escapeHtml(entity.internalName)}</small>
    <dl>
      <dt>对象类型</dt><dd>${typeLabel(entity.kind)}</dd>
      <dt>碰撞体</dt><dd>${colliderLabel(entity)}</dd>
      <dt>碰撞尺寸</dt><dd>${collisionSizeLabel(entity)}</dd>
      <dt>表现体</dt><dd>${presentationLabel(entity)}</dd>
      <dt>位置</dt><dd>${Math.round(entity.transform.position.x)}, ${Math.round(entity.transform.position.y)}</dd>
      <dt>大小</dt><dd>${formatScale(entity.transform.scale.x)} × ${formatScale(entity.transform.scale.y)}</dd>
      <dt>表现旋转</dt><dd>${Math.round((entity.transform.rotation * 180) / Math.PI)}°</dd>
      <dt>物理旋转</dt><dd>未启用（AABB）</dd>
      <dt>物理</dt><dd>${entity.body?.mode || "none"}</dd>
      <dt>描述</dt><dd>${escapeHtml(entity.behavior?.normalizedDescription || entity.behavior?.description || "暂无")}</dd>
      <dt>标签</dt><dd>${escapeHtml(entity.tags.join(" / ") || "暂无")}</dd>
    </dl>
  `;
}

export function renderResourcesHtml(entity: Entity | undefined, resources: Record<string, Resource>): string {
  if (!entity) return `<p class="v2-empty">未选中对象。</p>`;
  const rows = entity.resources
    .map((binding) => {
      const resource = resources[binding.resourceId];
      return `
        <article class="v2-resource-row">
          <b>${escapeHtml(resource?.displayName || "资源")}</b>
          <p>${escapeHtml(binding.aiDescription || binding.description || resource?.aiDescription || resource?.description || "暂无描述")}</p>
          <small>槽位：${escapeHtml(binding.slot || "默认")} · 偏移 ${Math.round(binding.localOffset.x)}, ${Math.round(binding.localOffset.y)}</small>
        </article>
      `;
    })
    .join("");
  return (
    rows ||
    `<article class="v2-card"><b>${escapeHtml(entity.displayName)}</b><p>此对象暂无资源。后续图片、动图、音效和资源批注都放在这里，不和属性混在一起。</p></article>`
  );
}

function colliderLabel(entity: Entity): string {
  if (!entity.collider) return "无碰撞体";
  const shape = ({ box: "矩形", circle: "圆形", polygon: "闭合形状" } satisfies Record<string, string>)[entity.collider.shape] || entity.collider.shape;
  const mode = entity.collider.solid ? "实体碰撞" : entity.collider.trigger ? "触发区" : "仅标记";
  return `${mode} / ${shape}`;
}

function collisionSizeLabel(entity: Entity): string {
  if (!entity.collider) return "无";
  const scale = entity.transform.scale;
  const rawSize =
    entity.collider.shape === "circle"
      ? {
          x: (entity.collider.radius || Math.min(entity.collider.size.x, entity.collider.size.y) / 2) * 2,
          y: (entity.collider.radius || Math.min(entity.collider.size.x, entity.collider.size.y) / 2) * 2,
        }
      : entity.collider.size;
  const width = Math.round(rawSize.x * Math.max(Math.abs(scale.x), 0.001));
  const height = Math.round(rawSize.y * Math.max(Math.abs(scale.y), 0.001));
  return `${width} × ${height}（真实物理框）`;
}

function presentationLabel(entity: Entity): string {
  if (!entity.render) return "无表现体";
  const visible = entity.render.visible ? "可见" : "隐藏";
  return `${visible} / ${entity.render.color} / ${Math.round(entity.render.opacity * 100)}%`;
}
