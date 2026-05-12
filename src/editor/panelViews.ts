import type { Entity, Resource, ResourceBinding } from "../project/schema";
import type { RuntimeWorld } from "../runtime/world";
import { bodyModeLabel, escapeHtml, formatScale, typeLabel } from "./viewText";
import type { CanvasTargetPart } from "./renderer";
import { imageAttachments, isVisualResource, resourceAnimationLabel, resourceEffectPresetLabel, resourceEffectPresetOptions } from "./resourceAnimation";

export function renderTreeItemHtml(
  entity: ReturnType<RuntimeWorld["allEntities"]>[number],
  selectedId: string,
  selectedPart: CanvasTargetPart,
  resources: Record<string, Resource> = {},
  collapsedNodes: ReadonlySet<string> = new Set(),
): string {
  const bodySelected = selectedId === entity.id && selectedPart === "body";
  const presentationSelected = selectedId === entity.id && selectedPart === "presentation";
  const presentationName = currentPresentationName(entity, resources);
  const nodeId = `entity:${entity.id}`;
  const hasPresentation = Boolean(entity.render);
  const collapsed = hasPresentation && collapsedNodes.has(nodeId);
  const presentationHidden = entity.render?.visible === false;
  return `
    <article class="v2-world-node">
      <div class="v2-tree-row">
        ${
          hasPresentation
            ? `<button class="v2-tree-toggle" data-tree-toggle="${escapeHtml(nodeId)}" type="button">${collapsed ? "▸" : "▾"}</button>`
            : `<span class="v2-tree-toggle-spacer"></span>`
        }
        <button class="v2-tree-item ${bodySelected ? "is-selected" : ""}" data-entity-id="${entity.id}" data-part="body" type="button" draggable="${entity.persistent ? "true" : "false"}">
          <span>${escapeHtml(entity.displayName)}</span>
          <small class="v2-tree-badge">${entity.persistent ? "本体" : "运行时"}</small>
        </button>
      </div>
      ${
        hasPresentation && !collapsed
          ? `<button class="v2-tree-item v2-tree-child ${presentationSelected ? "is-selected" : ""}" data-entity-id="${entity.id}" data-part="presentation" type="button">
              <span>↳ ${escapeHtml(presentationName)}</span>
              <small class="v2-tree-badge ${presentationHidden ? "is-muted" : ""}">${presentationHidden ? "隐藏" : "可视"}</small>
            </button>`
          : ""
      }
    </article>
  `;
}

export function renderInspectorHtml(
  entity: Entity | undefined,
  selectedPart: CanvasTargetPart = "body",
  resources: Record<string, Resource> = {},
): string {
  if (!entity) {
    return `
      <article class="v2-card">
        <small class="v2-kicker">属性</small>
        <b>未选中对象</b>
      </article>
    `;
  }
  const colliderOffset = entity.collider?.offset || { x: 0, y: 0 };
  const renderOffset = entity.render?.offset || { x: 0, y: 0 };
  const renderSize = entity.render?.size || { x: 0, y: 0 };
  const editingPresentation = selectedPart === "presentation";
  const description = entity.behavior?.normalizedDescription || entity.behavior?.description || "暂无描述";
  const summaryBadges = [
    typeLabel(entity.kind),
    bodyKindLabel(entity),
    entity.persistent ? "持久对象" : "运行时对象",
    entity.render?.visible === false ? "当前可视体已隐藏" : "当前可视体可见",
  ];
  const bodyMode = entity.body?.mode || "static";
  const bodyModeOptions = ["static", "dynamic", "kinematic"]
    .map((m) => `<option value="${m}"${bodyMode === m ? " selected" : ""}>${bodyModeLabel(m)}</option>`)
    .join("");
  return `
    <article class="v2-card is-primary">
      <small class="v2-kicker">属性</small>
      <b>${escapeHtml(entity.displayName)}</b>
      <p>${editingPresentation ? "当前正在编辑可视体，可直接检查偏移、旋转和资源挂靠。" : "当前正在编辑世界本体，可直接检查碰撞、物理、缩放与对象标签。"}</p>
      <div class="v2-inline-badges">${summaryBadges.map(renderPill).join("")}</div>
    </article>
    <div class="v2-name-edit">
      <input data-entity-name="${escapeHtml(entity.id)}" type="text" value="${escapeHtml(entity.displayName)}" placeholder="对象名称" />
      <button data-action="rename-entity-inline" data-entity-id="${escapeHtml(entity.id)}" type="button" ${entity.persistent ? "" : "disabled"}>重命名</button>
    </div>
    <div class="v2-prop-toggles">
      <label class="v2-prop-row">
        <input type="checkbox" data-prop="persistent" data-entity-id="${escapeHtml(entity.id)}"${entity.persistent ? " checked" : ""} />
        <span>持久对象</span>
      </label>
      <label class="v2-prop-row">
        <span>物理模式</span>
        <select data-prop="bodyMode" data-entity-id="${escapeHtml(entity.id)}">${bodyModeOptions}</select>
      </label>
      <label class="v2-prop-row">
        <input type="checkbox" data-prop="colliderSolid" data-entity-id="${escapeHtml(entity.id)}"${entity.collider?.solid !== false ? " checked" : ""} />
        <span>实体碰撞</span>
      </label>
      <label class="v2-prop-row">
        <input type="checkbox" data-prop="colliderTrigger" data-entity-id="${escapeHtml(entity.id)}"${entity.collider?.trigger ? " checked" : ""} />
        <span>触发器</span>
      </label>
      <label class="v2-prop-row">
        <input type="checkbox" data-prop="renderVisible" data-entity-id="${escapeHtml(entity.id)}"${entity.render?.visible !== false ? " checked" : ""} />
        <span>可视体可见</span>
      </label>
    </div>
    <small>内部命名：${escapeHtml(entity.internalName)}</small>
    <small>行为说明：${escapeHtml(description)}</small>
    <dl>
      <dt>本体类型</dt><dd>${bodyKindLabel(entity)}</dd>
      <dt>碰撞能力</dt><dd>${colliderLabel(entity)}</dd>
      <dt>本体尺寸</dt><dd>${collisionSizeLabel(entity)}</dd>
      <dt>本体偏移</dt><dd>${Math.round(colliderOffset.x)}, ${Math.round(colliderOffset.y)}</dd>
      <dt>本体旋转</dt><dd>${Math.round((((entity.transform.rotation || 0) + (entity.collider?.rotation || 0)) * 180) / Math.PI)}°</dd>
      <dt>当前可视体</dt><dd>${presentationLabel(entity, resources)}</dd>
      <dt>可视尺寸</dt><dd>${Math.round(renderSize.x)} × ${Math.round(renderSize.y)}</dd>
      <dt>可视偏移</dt><dd>${Math.round(renderOffset.x)}, ${Math.round(renderOffset.y)}</dd>
      <dt>可视旋转</dt><dd>${Math.round(((entity.render?.rotation || 0) * 180) / Math.PI)}°</dd>
      <dt>位置</dt><dd>${Math.round(entity.transform.position.x)}, ${Math.round(entity.transform.position.y)}</dd>
      <dt>大小</dt><dd>${formatScale(entity.transform.scale.x)} × ${formatScale(entity.transform.scale.y)}</dd>
      <dt>物理</dt><dd>${bodyModeLabel(bodyMode)}</dd>
      <dt>描述</dt><dd>${escapeHtml(description)}</dd>
      <dt>标签</dt><dd>${escapeHtml(entity.tags.join(" / ") || "暂无")}</dd>
    </dl>
  `;
}

export function renderResourcesHtml(entities: Entity[], resources: Record<string, Resource>): string {
  if (entities.length === 0) {
    return `
      <article class="v2-card">
        <small class="v2-kicker">对象资源</small>
        <b>未选中对象</b>
      </article>
    `;
  }
  const resourceCount = entities.reduce((sum, entity) => sum + entity.resources.length + (entity.render ? 1 : 0), 0);
  const multiSelect = entities.length > 1;
  const selectedLabel = multiSelect ? `已选中 ${entities.length} 个对象` : entities[0]?.displayName || "当前对象";

  return `
    <article class="v2-card">
      <small class="v2-kicker">对象资源</small>
      <b>${escapeHtml(selectedLabel)}</b>
      <p>${multiSelect ? "当前面板会把多个选中对象的资源分组展示，方便统一检查当前可视体、补充说明或回填切帧配置。" : "当前面板会聚合这个对象的当前可视体、说明资源和动画配置。导入新图片后，也会从这里继续完善描述。 "}</p>
      <div class="v2-metrics">
        ${renderMetric("对象", entities.length)}
        ${renderMetric("资源项", resourceCount)}
        ${renderMetric("可视体", entities.filter((entity) => entity.render).length)}
      </div>
    </article>
    ${entities
      .map((entity) => `
        <article class="v2-resource-entity">
          <header>
            <div>
              <b>${escapeHtml(entity.displayName)}</b>
              <small>${entity.render ? "可视体与挂靠资源" : "仅挂靠资源"}</small>
            </div>
            <small>${entity.resources.length + (entity.render ? 1 : 0)} 项</small>
          </header>
          ${renderEntityResourceSections(entity, resources)}
        </article>
      `)
      .join("")}
  `;
}

export function renderResourceLibraryHtml(resources: Record<string, Resource>): string {
  const allResources = Object.values(resources).sort((left, right) => left.displayName.localeCompare(right.displayName));
  const images = allResources.filter(isVisualResource);
  const notes = allResources.filter((resource) => resource.type === "note");
  const other = allResources.filter((resource) => !isVisualResource(resource) && resource.type !== "note");
  return `
    <article class="v2-card">
      <small class="v2-kicker">资源库</small>
      <b>${allResources.length ? `已收录 ${allResources.length} 项资源` : "资源库为空"}</b>
      <p>把图片、GIF、说明文本或外部资源地址导入到这里，再分配到对象的当前可视体、死亡态或其他 slot。资源说明越清晰，后续 AI 任务越容易利用它们。</p>
      <div class="v2-metrics">
        ${renderMetric("图片", images.length)}
        ${renderMetric("说明", notes.length)}
        ${renderMetric("其他", other.length)}
      </div>
    </article>
    <section class="v2-resource-import" data-resource-dropzone="true">
      <h3>添加资源</h3>
      <div class="v2-resource-actions">
        <button data-action="resource-open-file" type="button">打开文件</button>
      </div>
      <input data-role="resource-paste-input" type="text" placeholder="粘贴资源地址、data URL，或一段资源说明后按 Enter" />
      <small>复制电脑文件后可直接在任务输入框或这里粘贴；选中对象时导入图片，会优先替换它的当前可视体。</small>
    </section>
    ${
      allResources.length
        ? [
            renderLibrarySection("图片 / GIF", images),
            renderLibrarySection("说明", notes),
            renderLibrarySection("其他", other),
          ].join("")
        : `<article class="v2-card"><b>还没有资源</b><p>先导入一张图片、一个 GIF，或一段简短的资源说明；后续对象就能直接挂靠和复用。</p></article>`
    }
  `;
}

function renderEntityResourceSections(entity: Entity, resources: Record<string, Resource>): string {
  const currentRows = [
    renderDefaultVisualRow(entity, resources),
    ...entity.resources
      .filter((binding) => isCurrentResource(entity, binding))
      .map((binding) => renderResourceBindingRow(binding, resources[binding.resourceId], "当前")),
  ].filter(Boolean);
  const visualRows = entity.resources
    .filter((binding) => !isCurrentResource(entity, binding) && isVisualResource(resources[binding.resourceId]))
    .map((binding) => renderResourceBindingRow(binding, resources[binding.resourceId], "图片"));
  const noteRows = entity.resources
    .filter((binding) => !isCurrentResource(entity, binding) && resources[binding.resourceId]?.type === "note")
    .map((binding) => renderResourceBindingRow(binding, resources[binding.resourceId], "说明"));
  const otherRows = entity.resources
    .filter((binding) => {
      const resource = resources[binding.resourceId];
      return !isCurrentResource(entity, binding) && !isVisualResource(resource) && resource?.type !== "note";
    })
    .map((binding) => renderResourceBindingRow(binding, resources[binding.resourceId], "资源"));

  const sections = [
    renderResourceSection("当前可视体", currentRows),
    renderResourceSection("图片 / GIF", visualRows),
    renderResourceSection("说明", noteRows),
    renderResourceSection("其他", otherRows),
  ].join("");
  return sections || `<p class="v2-empty">此对象还没有挂靠资源。可以先在“资源库”导入图片或说明，再回到这里绑定。</p>`;
}

function renderResourceSection(title: string, rows: string[]): string {
  if (rows.length === 0) return "";
  return `
    <section class="v2-resource-section">
      <header class="v2-section-head">
        <h3>${escapeHtml(title)}</h3>
        <small>${rows.length} 项</small>
      </header>
      ${rows.join("")}
    </section>
  `;
}

function renderLibrarySection(title: string, rows: Resource[]): string {
  if (rows.length === 0) return "";
  return `
    <section class="v2-resource-section">
      <header class="v2-section-head">
        <h3>${escapeHtml(title)}</h3>
        <small>${rows.length} 项</small>
      </header>
      ${rows.map(renderLibraryResourceRow).join("")}
    </section>
  `;
}

function renderDefaultVisualRow(entity: Entity, resources: Record<string, Resource>): string {
  if (!entity.render || entity.render.resourceId) return "";
  return `
    <article class="v2-resource-row is-default-visual">
      <b>${escapeHtml(currentPresentationName(entity, resources))}</b>
      <p>默认纯色可视体；图片导入后会被替换。</p>
      <small>${escapeHtml(entity.render.color || "当前颜色")}</small>
    </article>
  `;
}

function renderResourceBindingRow(binding: ResourceBinding, resource: Resource | undefined, label: string): string {
  const description = binding.description || resource?.description || "";
  const resourceId = binding.resourceId;
  return `
    <article class="v2-resource-row" data-resource-row="${escapeHtml(resourceId)}">
      <b>${escapeHtml(resource?.displayName || "资源")}</b>
      <div class="v2-name-edit">
        <input data-resource-name="${escapeHtml(resourceId)}" type="text" value="${escapeHtml(resource?.displayName || "")}" placeholder="资源名称" ${resource ? "" : "disabled"} />
        <button data-action="rename-resource" data-resource-id="${escapeHtml(resourceId)}" type="button" ${resource ? "" : "disabled"}>重命名</button>
      </div>
      <p>${escapeHtml(binding.aiDescription || binding.description || resource?.aiDescription || resource?.description || "暂无描述")}</p>
      <input data-resource-description="${escapeHtml(resourceId)}" type="text" value="${escapeHtml(description)}" placeholder="用一个词或一句话描述这个资源" />
      ${renderResourceAnimationControls(resource)}
      ${renderResourceEffectPresetControls(resource)}
      <footer>
        <small>${escapeHtml(label)} · ${escapeHtml(binding.slot || "current")}${resource ? ` · ${escapeHtml(resourceKindLabel(resource.type))} · ${escapeHtml(resourceAnimationLabel(resource))} · ${escapeHtml(resourceEffectPresetLabel(resource))}` : ""}</small>
        <button data-action="save-resource-description" data-resource-id="${escapeHtml(resourceId)}" type="button">保存</button>
      </footer>
    </article>
  `;
}

function renderLibraryResourceRow(resource: Resource): string {
  return `
    <article class="v2-resource-row is-library-resource" data-resource-row="${escapeHtml(resource.id)}">
      ${renderLibraryResourcePreview(resource)}
      <b>${escapeHtml(resource.displayName)}</b>
      <div class="v2-name-edit">
        <input data-resource-name="${escapeHtml(resource.id)}" type="text" value="${escapeHtml(resource.displayName)}" placeholder="资源名称" />
        <button data-action="rename-resource" data-resource-id="${escapeHtml(resource.id)}" type="button">重命名</button>
      </div>
      <p>${escapeHtml(resource.aiDescription || resource.description || "暂无描述")}</p>
      <input data-resource-description="${escapeHtml(resource.id)}" type="text" value="${escapeHtml(resource.description || "")}" placeholder="用一个词或一句话描述这个资源" />
      ${renderResourceAnimationControls(resource)}
      ${renderResourceEffectPresetControls(resource)}
      <footer>
        <small>${escapeHtml(resourceKindLabel(resource.type))} · ${escapeHtml(resourceAnimationLabel(resource))} · ${escapeHtml(resourceEffectPresetLabel(resource))}${resource.tags.includes("待AI处理") ? " · 待AI处理" : ""}</small>
        <button data-action="save-resource-description" data-resource-id="${escapeHtml(resource.id)}" type="button">保存</button>
      </footer>
    </article>
  `;
}

function renderLibraryResourcePreview(resource: Resource): string {
  const visualAttachments = imageAttachments(resource);
  if (visualAttachments.length > 0) {
    const primary = visualAttachments[0];
    const frameStrip = visualAttachments.length > 1
      ? `
        <div class="v2-resource-preview-strip" aria-label="序列帧缩略图">
          ${visualAttachments.slice(0, 5).map(renderResourcePreviewThumb).join("")}
          ${
            visualAttachments.length > 5
              ? `<span class="v2-resource-preview-more">+${visualAttachments.length - 5}</span>`
              : ""
          }
        </div>
      `
      : "";
    const previewLabel = visualAttachments.length > 1 ? `${visualAttachments.length} 帧序列` : primary.fileName;
    return `
      <figure class="v2-resource-preview is-visual">
        <img src="${escapeHtml(primary.path)}" alt="${escapeHtml(resource.displayName)} 预览" loading="lazy" />
        <figcaption>${escapeHtml(previewLabel)}</figcaption>
        ${frameStrip}
      </figure>
    `;
  }

  const attachment = resource.attachments[0];
  if (resource.type === "audio" && attachment?.path) {
    return `
      <div class="v2-resource-preview is-audio">
        <audio controls preload="metadata" src="${escapeHtml(attachment.path)}"></audio>
        <small>${escapeHtml(attachment.fileName || resource.displayName)}</small>
      </div>
    `;
  }

  if (resource.type === "note") {
    const noteText = compactPreviewText(resource.description || resource.aiDescription || attachment?.fileName || "", "暂无可预览内容");
    return `
      <div class="v2-resource-preview is-note">
        <p>${escapeHtml(noteText)}</p>
      </div>
    `;
  }

  if (attachment) {
    return `
      <div class="v2-resource-preview is-file">
        <span>FILE</span>
        <div>
          <b>${escapeHtml(attachment.fileName || resource.displayName)}</b>
          <small>${escapeHtml(attachment.mime || resource.type)}</small>
        </div>
      </div>
    `;
  }

  return `
    <div class="v2-resource-preview is-empty">
      <small>暂无可预览附件</small>
    </div>
  `;
}

function renderResourcePreviewThumb(attachment: Resource["attachments"][number]): string {
  return `<img src="${escapeHtml(attachment.path)}" alt="${escapeHtml(attachment.fileName)}" loading="lazy" />`;
}

function renderResourceAnimationControls(resource: Resource | undefined): string {
  if (!resource || imageAttachments(resource).length === 0) return "";
  const sprite = resource.sprite;
  const mode = sprite?.mode || "static";
  const columns = sprite?.columns || 4;
  const rows = sprite?.rows || 4;
  const sequenceFrames = imageAttachments(resource).length;
  const frameCount = sprite?.frameCount || (mode === "sequence" ? sequenceFrames : columns * rows);
  const fps = sprite?.fps || 8;
  const frameWidth = sprite?.frameWidth || "";
  const frameHeight = sprite?.frameHeight || "";
  const margin = sprite?.margin || 0;
  const spacing = sprite?.spacing || 0;
  const loop = sprite?.loop !== false;
  return `
    <section class="v2-resource-animation">
      <label>
        <span>类型</span>
        <select data-resource-animation-mode>
          ${animationOption("static", "静态", mode)}
          ${animationOption("sheet", "宫格", mode)}
          ${animationOption("sequence", "序列", mode)}
        </select>
      </label>
      <label>
        <span>列</span>
        <input data-resource-animation-columns type="number" min="1" step="1" value="${columns}" />
      </label>
      <label>
        <span>行</span>
        <input data-resource-animation-rows type="number" min="1" step="1" value="${rows}" />
      </label>
      <label>
        <span>帧</span>
        <input data-resource-animation-frame-count type="number" min="1" step="1" value="${frameCount}" />
      </label>
      <label>
        <span>FPS</span>
        <input data-resource-animation-fps type="number" min="1" step="1" value="${fps}" />
      </label>
      <label>
        <span>宽</span>
        <input data-resource-animation-frame-width type="number" min="1" step="1" value="${frameWidth}" />
      </label>
      <label>
        <span>高</span>
        <input data-resource-animation-frame-height type="number" min="1" step="1" value="${frameHeight}" />
      </label>
      <label>
        <span>边</span>
        <input data-resource-animation-margin type="number" min="0" step="1" value="${margin}" />
      </label>
      <label>
        <span>距</span>
        <input data-resource-animation-spacing type="number" min="0" step="1" value="${spacing}" />
      </label>
      <label class="v2-resource-animation-toggle">
        <input data-resource-animation-loop type="checkbox" ${loop ? "checked" : ""} />
        <span>循环</span>
      </label>
      <div class="v2-resource-animation-actions">
        <button data-action="save-resource-animation" data-resource-id="${escapeHtml(resource.id)}" type="button">应用切帧</button>
        <button data-action="clear-resource-animation" data-resource-id="${escapeHtml(resource.id)}" type="button">静态</button>
      </div>
    </section>
  `;
}

function renderResourceEffectPresetControls(resource: Resource | undefined): string {
  if (!isVisualResource(resource)) return "";
  const activePreset = resource.effect?.preset || "none";
  return `
    <section class="v2-resource-effect-presets" aria-label="特效预设">
      <header>
        <span>特效预设</span>
        <small>${escapeHtml(resourceEffectPresetLabel(resource))}</small>
      </header>
      <div class="v2-effect-preset-grid">
        ${resourceEffectPresetOptions
          .map(
            (preset) => `
              <button
                class="${preset.id === activePreset ? "is-active" : ""}"
                data-action="apply-resource-effect-preset"
                data-resource-id="${escapeHtml(resource.id)}"
                data-effect-preset="${escapeHtml(preset.id)}"
                type="button"
                title="${escapeHtml(preset.summary)}"
              >
                <span>${escapeHtml(preset.label)}</span>
                <small>${escapeHtml(preset.summary)}</small>
              </button>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function animationOption(value: string, label: string, selectedMode: string): string {
  return `<option value="${value}" ${selectedMode === value ? "selected" : ""}>${label}</option>`;
}

function renderMetric(label: string, value: number): string {
  return `
    <span>
      <small>${escapeHtml(label)}</small>
      <b>${escapeHtml(String(value))}</b>
    </span>
  `;
}

function renderPill(value: string): string {
  return `<span class="v2-pill">${escapeHtml(value)}</span>`;
}

function compactPreviewText(value: string, fallback: string): string {
  const compact = value.replace(/\s+/g, " ").trim() || fallback;
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function isCurrentResource(entity: Entity, binding: ResourceBinding): boolean {
  return binding.resourceId === entity.render?.resourceId || binding.slot === (entity.render?.slot || "current");
}

function colliderLabel(entity: Entity): string {
  if (!entity.collider || entity.body?.mode === "none" || entity.collider.solid === false) return "不可碰撞本体";
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

function presentationLabel(entity: Entity, resources: Record<string, Resource> = {}): string {
  if (!entity.render) return "无可视体";
  const name = currentPresentationName(entity, resources);
  const visible = entity.render.visible ? "可见" : "隐藏";
  return `${name} / ${visible} / ${Math.round(entity.render.opacity * 100)}%`;
}

function bodyKindLabel(entity: Entity): string {
  if (entity.body?.mode === "dynamic" || entity.body?.mode === "kinematic") return "可动本体";
  if (entity.body?.mode === "none" || entity.collider?.solid === false) return "背景本体";
  if (entity.collider?.trigger) return "触发本体";
  return entity.persistent ? "固定本体" : "运行时本体";
}

function currentPresentationName(entity: Entity, resources: Record<string, Resource>): string {
  const presentation = currentPresentationBinding(entity, resources);
  if (presentation?.resource?.displayName) return presentation.resource.displayName;
  const state = stateLabel(entity.render?.state || entity.render?.slot || "");
  if (state) return `${state}可视体`;
  return `${visualColorName(entity.render?.color)}可视体`;
}

function currentPresentationBinding(entity: Entity, resources: Record<string, Resource>): { binding?: ResourceBinding; resource?: Resource } | undefined {
  if (!entity.render) return undefined;
  const byResourceId = entity.render.resourceId
    ? entity.resources.find((binding) => binding.resourceId === entity.render?.resourceId)
    : undefined;
  const bySlot = entity.render.slot ? entity.resources.find((binding) => binding.slot === entity.render?.slot) : undefined;
  const binding = byResourceId || bySlot;
  return binding ? { binding, resource: resources[binding.resourceId] } : undefined;
}

function stateLabel(value: string): string {
  return (
    {
      current: "当前",
      idle: "站立",
      run: "奔跑",
      walk: "行走",
      attack: "攻击",
      death: "死亡",
    } satisfies Record<string, string>
  )[value] || "";
}

function resourceKindLabel(type: string): string {
  return (
    {
      sprite: "图片资源",
      note: "说明资源",
      audio: "音频资源",
      data: "数据资源",
    } satisfies Record<string, string>
  )[type] || type;
}

function visualColorName(value = ""): string {
  const normalized = value.trim().toLowerCase();
  return (
    {
      "#ff00ff": "品红色",
      "#ff4fd8": "品红色",
      "#e06c6c": "红色",
      "#df7171": "红色",
      "#35bd9a": "青绿色",
      "#40c89c": "青绿色",
      "#74a8bd": "蓝灰色",
      "#77b8df": "蓝色",
      "#969a90": "灰色",
      "#d7a84a": "琥珀色",
    } satisfies Record<string, string>
  )[normalized] || "当前";
}
