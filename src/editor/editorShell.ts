import { escapeHtml } from "./viewText";

type PreviewDockTarget = "left" | "right" | "bottom" | "center" | "float";
type PreviewWindowId = string;
type PreviewSplitSide = "left" | "right" | "top" | "bottom";
type PreviewWindowState = "open" | "minimized" | "closed";
export type PreviewWorkspacePreset = "edit" | "focus" | "ai" | "debug";
type PreviewResizeEdge = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

type PreviewDropTarget =
  | { kind: "float"; target: "float" }
  | { kind: "dock"; target: Exclude<PreviewDockTarget, "float"> }
  | { kind: "split"; target: "center"; splitTargetId: PreviewWindowId; splitSide: PreviewSplitSide }
  | { kind: "tab"; target: "center"; tabTargetId: PreviewWindowId };

type DragState = {
  pointerId: number;
  panel: HTMLElement;
  startX: number;
  startY: number;
  panelLeft: number;
  panelTop: number;
  drop: PreviewDropTarget;
};

type ResizeState = {
  pointerId: number;
  panel: HTMLElement;
  edge: PreviewResizeEdge;
  startX: number;
  startY: number;
  panelLeft: number;
  panelTop: number;
  panelWidth: number;
  panelHeight: number;
};

export type PreviewWindowRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PreviewWorkspacePresetViewport = {
  width: number;
  height: number;
};

export type PreviewWorkspacePresetPlanEntry = {
  id: PreviewWindowId;
  state: PreviewWindowState;
  dock?: string;
  rect?: PreviewWindowRect;
};

type PreviewWindowSnapshot = {
  id: PreviewWindowId;
  title: string;
  state: PreviewWindowState;
  dock: string;
  rect?: PreviewWindowRect;
  custom?: boolean;
  tabGroup?: string;
  tabAnchor?: string;
  tabActive?: boolean;
};

type PreviewLayoutSnapshot = {
  version: 10;
  createdWindows: number;
  windows: PreviewWindowSnapshot[];
};

type PreviewWindowDefault = {
  state: PreviewWindowState;
  dock: string;
  style: string | null;
};

type PreviewController = {
  root: HTMLElement;
  workbench: HTMLElement;
  dockOverlay: HTMLElement;
  launcherMenu: HTMLElement;
  taskbarButtons: HTMLElement;
  pointerStatus: HTMLElement | null;
  noticeStatus: HTMLElement | null;
  dragState?: DragState;
  resizeState?: ResizeState;
  createdWindows: number;
  restoringLayout: boolean;
  defaultWindows: Map<PreviewWindowId, PreviewWindowDefault>;
};

const PREVIEW_LAYOUT_STORAGE_KEY = "webhachimi.v2.workbenchPreview.layout.v10";
const LEGACY_PREVIEW_LAYOUT_STORAGE_KEYS = [
  "webhachimi.v2.workbenchPreview.layout.v1",
  "webhachimi.v2.workbenchPreview.layout.v2",
  "webhachimi.v2.workbenchPreview.layout.v3",
  "webhachimi.v2.workbenchPreview.layout.v4",
  "webhachimi.v2.workbenchPreview.layout.v5",
  "webhachimi.v2.workbenchPreview.layout.v6",
  "webhachimi.v2.workbenchPreview.layout.v7",
  "webhachimi.v2.workbenchPreview.layout.v8",
  "webhachimi.v2.workbenchPreview.layout.v9",
];
const PREVIEW_MIN_WINDOW_WIDTH = 220;
const PREVIEW_MIN_WINDOW_HEIGHT = 150;
const previewWorkspacePresets = ["edit", "focus", "ai", "debug"] as const satisfies readonly PreviewWorkspacePreset[];

export function mountEditorShell(root: HTMLElement): void {
  root.hidden = false;
  root.removeAttribute("aria-hidden");
  root.innerHTML = `
    <div class="workbench-preview" data-workbench-preview>
      <header class="workbench-titlebar">
        <nav class="workbench-menu" aria-label="主菜单">
          <button type="button" data-action="save-project">保存</button>
          <button type="button" data-action="hard-reconnect" title="Alt+R 完全重新加载前端和项目数据">重新连接</button>
          <button type="button" data-action="toggle-run">运行</button>
          <button type="button" data-world-manager-toggle aria-expanded="false">世界</button>
          <button type="button" data-window-launcher aria-expanded="false">窗口</button>
        </nav>
        <div class="command-center" role="search">
          <span class="command-center__mark"></span>
          <input type="text" value="WebHachimi：世界工作台预览" aria-label="命令中心" />
        </div>
        <div class="window-controls" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </header>

      <aside class="tool-page" data-preview-window="tools" data-window-title="工具" data-window-state="open">
        <button class="tool-page__button is-active" type="button" data-tool="select" aria-label="选择工具" title="选择">↖</button>
        <button class="tool-page__button" type="button" data-tool="square" aria-label="矩形工具" title="矩形">□</button>
        <button class="tool-page__button" type="button" data-tool="circle" aria-label="圆形工具" title="圆形">○</button>
        <button class="tool-page__button" type="button" data-tool="polygon" aria-label="多边形工具" title="多边形">⬠</button>
        <button class="tool-page__button" type="button" data-tool="superBrush" aria-label="超级画笔" title="超级画笔">✎</button>
        <span class="tool-page__spacer"></span>
        <button class="tool-page__button" type="button" data-action="toggle-run" aria-label="播放预览" title="播放">▶</button>
      </aside>

      <aside class="sidebar" data-dock-slot="left" data-preview-window="explorer" data-window-title="层级" data-window-state="open">
        <div class="pane-header">
          <span data-sidebar-title>层级</span>
          <div class="pane-actions">
            <button type="button" aria-label="最小化层级" data-window-minimize="explorer">-</button>
            <button type="button" aria-label="关闭层级" data-window-close="explorer">x</button>
          </div>
        </div>
        <div class="sidebar-workspace">
          <section class="hierarchy-panel" aria-label="层级">
            <div class="tree-list file-tree" data-role="tree"></div>
          </section>
          <section class="sidebar-inspector" aria-label="属性">
            <header class="sidebar-inspector__header">
              <span>属性</span>
              <small>当前选中对象</small>
            </header>
            <div class="inspector-body inspector-body--sidebar">
              <section class="inspector-properties" data-role="inspector"></section>
            </div>
          </section>
        </div>
      </aside>

      <section class="stage" data-role="stage" aria-label="编辑舞台">
        <div class="stage-grid"></div>
        <aside class="canvas-guide-panel" data-role="canvas-guide-panel" data-super-brush-target="editor-ui-panel" aria-label="UI 指导面板">
          <header>
            <span>UI 指导面板</span>
            <strong data-role="canvas-guide-state">待标注</strong>
          </header>
          <div class="canvas-guide-panel__body">
            <button type="button" data-tool="superBrush" title="超级画笔" aria-label="使用超级画笔">✎</button>
            <p data-role="canvas-guide-hint">用超级画笔圈住这里，写明要更新的界面行为。</p>
            <button type="button" data-action="confirm-super-brush">确认</button>
          </div>
        </aside>
      </section>

      <main class="editor-grid" data-dock-slot="center" data-preview-window="editor" data-window-title="世界" data-window-state="open">
        <div class="editor-tabs" role="tablist">
          <button class="tab is-active" type="button" role="tab" data-surface-target="canvas" aria-selected="true">世界画布</button>
          <button class="tab" type="button" role="tab" data-preview-open-window="workspace">AI 任务</button>
          <button class="tab" type="button" role="tab" data-action="toggle-run">预览</button>
          <div class="tab-spacer"></div>
          <div class="inline-window-actions">
            <button type="button" aria-label="最小化世界" data-window-minimize="editor">-</button>
            <button type="button" aria-label="关闭世界" data-window-close="editor">x</button>
          </div>
        </div>
        <div class="stage-toolbar">
          <button class="tab-action" type="button" data-action="fit-world">适配世界</button>
          <div class="zoom-control">100%</div>
        </div>
      </main>

      <aside class="ai-task-panel workspace-panel" data-dock-slot="right" data-preview-window="workspace" data-window-title="AI 任务" data-window-state="open">
        <div class="pane-header">
          <span>AI 任务</span>
          <div class="pane-actions">
            <button type="button" aria-label="最小化 AI 任务" data-window-minimize="workspace">-</button>
            <button type="button" aria-label="关闭 AI 任务" data-window-close="workspace">x</button>
          </div>
        </div>
        <div class="workspace-scroll">
          <section class="workspace-section">
            <header class="workspace-section__header">
              <span class="section-title">物体资源</span>
              <small>挂在当前对象上</small>
            </header>
            <div class="object-resources-body workspace-section__body">
              <div class="object-resources-drop-zone" data-role="resource-drop-zone" role="button" tabindex="0" aria-label="导入资源">
                <span>拖入文件、粘贴图片或点击添加资源</span>
                <input type="file" data-role="object-resource-input" multiple hidden />
              </div>
              <div data-role="resources">
                <div class="attached-resource-panel" data-role="object-resources-list">
                  <article class="attached-object">
                    <div class="attached-object__header">
                      <span>玩家身体</span>
                      <small>Object</small>
                    </div>
                    <div class="attached-resource">
                      <div class="attached-resource__header">
                        <strong>run_cycle_01.png</strong>
                        <small>图片</small>
                        <button type="button" class="resource-remove" aria-label="移除 run_cycle_01.png">x</button>
                      </div>
                      <textarea class="resource-description" rows="2" placeholder="描述这个资源的用途，例如：死亡后播放并在 1.6 秒内淡出。" aria-label="run_cycle_01.png 的资源描述">死亡后播放这张图片序列，并在 1.6 秒内慢慢消失。</textarea>
                    </div>
                    <div class="attached-resource">
                      <div class="attached-resource__header">
                        <strong>grass_tile.png</strong>
                        <small>地形</small>
                        <button type="button" class="resource-remove" aria-label="移除 grass_tile.png">x</button>
                      </div>
                      <textarea class="resource-description" rows="2" placeholder="描述这个资源的用途。" aria-label="grass_tile.png 的资源描述">作为脚下世界块的默认材质，跟随世界片段拼接。</textarea>
                    </div>
                  </article>
                </div>
              </div>
            </div>
          </section>
          <section class="workspace-section workspace-section--library">
            <header class="workspace-section__header">
              <span class="section-title">资源库</span>
              <small>工程级资源</small>
            </header>
            <div class="workspace-section__body resource-library" data-role="resource-library"></div>
          </section>
          <section class="workspace-section workspace-section--tasks">
            <header class="workspace-section__header">
              <span class="section-title">AI 任务</span>
              <small>当前工程队列</small>
            </header>
            <div class="task-stack" data-role="tasks">
              <article class="task-card is-active">
                <div class="task-card__title">生成碰撞检查</div>
                <div class="task-card__meta">排队中 - 世界范围</div>
              </article>
              <article class="task-card">
                <div class="task-card__title">绑定玩家奔跑序列</div>
                <div class="task-card__meta">草稿 - 挂靠资源</div>
              </article>
              <article class="task-card">
                <div class="task-card__title">检查摄像机构图</div>
                <div class="task-card__meta">就绪 - 视口</div>
              </article>
            </div>
            <div class="task-composer" data-role="ai-task-composer">
              <textarea data-role="visible-task-input" rows="3" placeholder="描述要交给 AI 的任务，例如：让死亡后的图片慢慢淡出。" aria-label="AI 任务输入"></textarea>
              <div class="task-composer__actions">
                <button class="is-primary" type="button" data-action="queue-task">发送</button>
              </div>
            </div>
          </section>
        </div>
      </aside>

      <section class="bottom-panel" data-dock-slot="bottom" data-preview-window="output" data-window-title="日志" data-window-state="open">
        <div class="panel-tabs">
          <span class="is-active" role="presentation">日志</span>
          <div class="tab-spacer"></div>
          <div class="inline-window-actions">
            <button type="button" aria-label="最小化日志" data-window-minimize="output">-</button>
            <button type="button" aria-label="关闭日志" data-window-close="output">x</button>
          </div>
        </div>
        <div class="output-console" data-role="output">
          <div><span>信息</span> 工作台预览正在运行。</div>
          <div><span>窗口</span> 窗口管理器就绪。</div>
          <div><span>世界</span> 世界管理器已接入工程场景列表。</div>
          <div><span>后端</span> 暂未连接。</div>
        </div>
      </section>

      <div class="dock-overlay" data-dock-overlay aria-hidden="true">
        <div class="dock-target dock-target--left" data-dock-zone="left" data-label="层级"></div>
        <div class="dock-target dock-target--right" data-dock-zone="right" data-label="AI 任务"></div>
        <div class="dock-target dock-target--bottom" data-dock-zone="bottom" data-label="日志"></div>
        <div class="dock-target dock-target--center" data-dock-zone="center" data-label="世界编辑组"></div>
      </div>

      <div class="world-manager-popover" data-role="world-manager-popover" hidden></div>
      <div class="world-speed-control" data-role="world-speed-control" aria-label="世界播放速度">
        <div class="world-speed-control__head">
          <span>世界速度</span>
          <strong data-role="world-speed-value">1x</strong>
        </div>
        <div class="world-speed-control__inputs">
          <input type="range" min="0" max="4" step="0.05" value="1" data-role="world-speed-range" aria-label="世界速度滑杆" />
          <input type="number" min="0" max="4" step="0.05" value="1" data-role="world-speed-input" aria-label="世界速度数值" />
        </div>
        <div class="world-speed-control__presets" aria-label="世界速度预设">
          <button type="button" data-world-speed-preset="0.5">0.5x</button>
          <button type="button" data-world-speed-preset="1">1x</button>
          <button type="button" data-world-speed-preset="2">2x</button>
        </div>
      </div>

      <footer class="window-taskbar" data-window-manager>
        <div class="window-launcher">
          <button class="taskbar-launcher" type="button" data-window-launcher aria-expanded="false">窗口</button>
          <div class="window-launcher-menu" data-window-launcher-menu hidden>
            <header>所有窗口</header>
            <div class="window-launcher-list" data-window-launcher-list></div>
            <footer>
              <div class="window-layout-presets" aria-label="工作区预设">
                <button type="button" data-window-preset="edit">编辑</button>
                <button type="button" data-window-preset="focus">专注</button>
                <button type="button" data-window-preset="ai">AI</button>
                <button type="button" data-window-preset="debug">调试</button>
              </div>
              <div class="window-launcher-actions">
                <button type="button" data-window-add>添加窗口</button>
                <button type="button" data-window-open-all>打开全部</button>
                <button type="button" data-window-reset-layout>重置布局</button>
              </div>
            </footer>
          </div>
        </div>
        <div class="taskbar-windows" data-taskbar-buttons aria-label="活动窗口"></div>
      </footer>

      <div class="runtime-status">
        <span data-role="mode">预览</span>
        <span data-role="save-status">静态外壳</span>
        <span data-role="pointer">吸附目标：浮动窗口</span>
        <span data-role="notice">世界工作台样机</span>
        <span data-role="frame">帧 0</span>
      </div>
    </div>

    <textarea data-role="task-input" hidden></textarea>
    <input data-role="resource-file-input" type="file" multiple hidden />
    <div data-role="context-menu" hidden></div>
    <div data-role="window-menu" hidden></div>
    <div data-role="polygon-actions" hidden></div>
    <div data-role="minimized-tray" hidden></div>
    <div class="super-brush-confirm" data-role="super-brush-summary" hidden>
      <div>
        <strong>超级画笔待确认</strong>
        <span data-role="super-brush-summary-text"></span>
      </div>
      <div class="super-brush-confirm__actions">
        <button class="is-secondary" type="button" data-action="cancel-super-brush-session">丢弃标记</button>
        <button class="is-primary" type="button" data-action="confirm-super-brush">确认并写 AI 任务</button>
      </div>
    </div>
    <section class="super-brush-task-modal" data-role="super-brush-task-modal" role="dialog" aria-modal="true" aria-labelledby="super-brush-task-title" hidden>
      <div class="super-brush-task-card">
        <header>
          <div>
            <b id="super-brush-task-title">确认超级画笔任务</b>
            <small>画笔只是标注。写清楚要 AI 做什么以后，才会插队成为任务。</small>
          </div>
          <button type="button" data-action="back-super-brush" aria-label="返回继续画">×</button>
        </header>
        <div class="super-brush-task-summary" data-role="super-brush-task-summary"></div>
        <textarea data-role="super-brush-task-input" placeholder="例如：把我圈出来的闭合区域生成一块可站立地形"></textarea>
        <div class="super-brush-task-error" data-role="super-brush-task-error" hidden></div>
        <footer>
          <button class="is-secondary" type="button" data-action="back-super-brush">返回继续画</button>
          <button class="is-secondary" type="button" data-action="cancel-super-brush-session">丢弃这次画笔</button>
          <button class="is-primary" type="button" data-action="queue-super-brush-task">插队 AI 任务</button>
        </footer>
      </div>
    </section>
  `;
  bindWorkbenchPreview(root);
}

function bindWorkbenchPreview(root: HTMLElement): void {
  const workbench = root.querySelector<HTMLElement>("[data-workbench-preview]");
  const dockOverlay = root.querySelector<HTMLElement>("[data-dock-overlay]");
  const launcherMenu = root.querySelector<HTMLElement>("[data-window-launcher-menu]");
  const taskbarButtons = root.querySelector<HTMLElement>("[data-taskbar-buttons]");
  const pointerStatus = root.querySelector<HTMLElement>('[data-role="pointer"]');
  const noticeStatus = root.querySelector<HTMLElement>('[data-role="notice"]');
  if (!workbench || !dockOverlay || !launcherMenu || !taskbarButtons) return;

  const controller: PreviewController = {
    root,
    workbench,
    dockOverlay,
    launcherMenu,
    taskbarButtons,
    pointerStatus,
    noticeStatus,
    createdWindows: 0,
    restoringLayout: false,
    defaultWindows: new Map(),
  };
  (root as any).__previewController = controller;

  const hasStoredLayout = Boolean(readPreviewLayoutSnapshot());
  syncPreviewWindowStates(controller);
  if (!hasStoredLayout) {
    controller.restoringLayout = true;
    applyDefaultPreviewTabGroups(controller);
    controller.restoringLayout = false;
  }
  controller.defaultWindows = captureDefaultPreviewWindows(root);
  hydrateStoredCustomWindows(controller);
  bindWindowChrome(controller);
  bindFloatingWindows(controller);
  bindPreviewOpenButtons(controller);
  if (hasStoredLayout) applyStoredPreviewLayout(controller);
  renderWindowManager(controller);
  syncWorkspacePresetButtons(controller);

  root.querySelectorAll<HTMLButtonElement>("[data-window-launcher]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const anchor = launcherAnchor(button);
      const isOpen = launcherMenu.hidden || launcherMenu.dataset.anchor !== anchor;
      launcherMenu.hidden = !isOpen;
      if (isOpen) {
        launcherMenu.dataset.anchor = anchor;
      } else {
        delete launcherMenu.dataset.anchor;
      }
      root.querySelectorAll<HTMLButtonElement>("[data-window-launcher]").forEach((toggle) => {
        toggle.setAttribute("aria-expanded", String(isOpen));
      });
    });
  });

  root.querySelector<HTMLButtonElement>("[data-window-add]")?.addEventListener("click", () => {
    addPreviewWindow(controller);
    closeLauncher(controller);
  });

  root.querySelector<HTMLButtonElement>("[data-window-open-all]")?.addEventListener("click", () => {
    allPreviewWindows(controller.root).forEach((windowNode) => setPreviewWindowState(controller, windowNode, "open"));
    closeLauncher(controller);
  });

  root.querySelector<HTMLButtonElement>("[data-window-reset-layout]")?.addEventListener("click", () => {
    resetPreviewLayout(controller);
    closeLauncher(controller);
  });

  root.querySelectorAll<HTMLButtonElement>("[data-window-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = button.dataset.windowPreset || "";
      if (!isPreviewWorkspacePreset(preset)) return;
      applyPreviewWorkspacePreset(controller, preset);
      closeLauncher(controller);
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("[data-window-manager]")) return;
    closeLauncher(controller);
  });
}

function bindWindowChrome(controller: PreviewController): void {
  controller.root.querySelectorAll<HTMLButtonElement>("[data-window-minimize]").forEach((button) => {
    if (button.dataset.windowChromeBound === "true") return;
    button.dataset.windowChromeBound = "true";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const target = windowById(controller.root, button.dataset.windowMinimize);
      if (target) setPreviewWindowState(controller, target, "minimized");
    });
  });

  controller.root.querySelectorAll<HTMLButtonElement>("[data-window-close]").forEach((button) => {
    if (button.dataset.windowChromeBound === "true") return;
    button.dataset.windowChromeBound = "true";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const target = windowById(controller.root, button.dataset.windowClose);
      if (target) setPreviewWindowState(controller, target, "closed");
    });
  });
}

function renderWindowManager(controller: PreviewController): void {
  renderTaskbar(controller);
  renderLauncher(controller);
}

function bindPreviewOpenButtons(controller: PreviewController): void {
  controller.root.querySelectorAll<HTMLButtonElement>("[data-preview-open-window]").forEach((button) => {
    if (button.dataset.previewOpenBound === "true") return;
    button.dataset.previewOpenBound = "true";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const targetId = button.dataset.previewOpenWindow || "";
      const target = windowById(controller.root, targetId);
      if (!target) return;
      setPreviewWindowState(controller, target, "open");
      if (target.dataset.tabGroup) activateTabbedWindow(controller, target.dataset.tabGroup, targetId);
      syncPreviewOpenButtons(controller, targetId);
      updatePointerStatus(controller.noticeStatus, `${windowTitle(target)}已打开`);
    });
  });
  const activeButton = controller.root.querySelector<HTMLButtonElement>("[data-preview-open-window].is-active");
  syncPreviewOpenButtons(controller, activeButton?.dataset.previewOpenWindow || "");
}

function syncPreviewOpenButtons(controller: PreviewController, activeWindowId: string): void {
  controller.root.querySelectorAll<HTMLButtonElement>("[data-preview-open-window]").forEach((button) => {
    const isActive = Boolean(activeWindowId) && button.dataset.previewOpenWindow === activeWindowId;
    button.classList.toggle("is-active", isActive);
    if (button.closest('[role="tablist"]')) {
      button.setAttribute("aria-selected", String(isActive));
      button.removeAttribute("aria-pressed");
    } else {
      button.setAttribute("aria-pressed", String(isActive));
    }
  });
}

function renderTaskbar(controller: PreviewController): void {
  controller.taskbarButtons.innerHTML = "";
  allPreviewWindows(controller.root)
    .filter((windowNode) => windowState(windowNode) !== "closed")
    .forEach((windowNode) => {
      const button = document.createElement("button");
      const state = windowState(windowNode);
      button.className = `window-button is-${state}`;
      button.type = "button";
      button.dataset.taskbarWindow = windowNode.dataset.previewWindow || "";
      button.setAttribute("aria-pressed", String(state === "open"));
      button.textContent = windowTitle(windowNode);
      button.title = state === "open" ? `最小化${windowTitle(windowNode)}` : `打开${windowTitle(windowNode)}`;
      button.addEventListener("click", () => {
        if (state === "open" && windowNode.dataset.tabGroup) {
          activateTabbedWindow(controller, windowNode.dataset.tabGroup, windowNode.dataset.previewWindow || "");
          if (controller.noticeStatus) controller.noticeStatus.textContent = `${windowTitle(windowNode)}已前置`;
          return;
        }
        setPreviewWindowState(controller, windowNode, state === "open" ? "minimized" : "open");
      });
      controller.taskbarButtons.appendChild(button);
    });
}

function renderLauncher(controller: PreviewController): void {
  const list = controller.launcherMenu.querySelector<HTMLElement>("[data-window-launcher-list]");
  if (!list) return;
  list.innerHTML = "";
  allPreviewWindows(controller.root).forEach((windowNode) => {
    const state = windowState(windowNode);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `launcher-window is-${state}`;
    button.dataset.launcherWindow = windowNode.dataset.previewWindow || "";
    button.innerHTML = `<span>${escapeHtml(windowTitle(windowNode))}</span><small>${windowStateLabel(state)}</small>`;
    button.addEventListener("click", () => {
      setPreviewWindowState(controller, windowNode, state === "closed" ? "open" : "closed");
    });
    list.appendChild(button);
  });
}

function bindFloatingWindows(controller: PreviewController): void {
  controller.root.querySelectorAll<HTMLElement>("[data-floating-window]").forEach((panel) => bindFloatingWindow(controller, panel));
}

function bindFloatingWindow(controller: PreviewController, panel: HTMLElement): void {
  if (panel.dataset.dragBound === "true") return;
  const dragHandle = panel.querySelector<HTMLElement>("[data-preview-drag]");
  const resetButton = panel.querySelector<HTMLButtonElement>("[data-preview-reset]");
  if (!dragHandle) return;
  panel.dataset.dragBound = "true";
  ensureResizeHandles(panel);

  resetButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    resetPreviewWindow(controller, panel);
  });

  panel.addEventListener("pointerdown", () => {
    panel.style.zIndex = String(nextWindowZ(controller.root));
  });

  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    beginPreviewDrag(controller, panel, dragHandle, event);
  });

  dragHandle.addEventListener("pointermove", (event) => updatePreviewDrag(controller, event));
  dragHandle.addEventListener("pointerup", (event) => finishPreviewDrag(controller, dragHandle, event));
  dragHandle.addEventListener("pointercancel", () => cancelPreviewDrag(controller));

  panel.querySelectorAll<HTMLElement>("[data-window-resize-edge]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      beginPreviewResize(controller, panel, handle, event);
    });
    handle.addEventListener("pointermove", (event) => updatePreviewResize(controller, event));
    handle.addEventListener("pointerup", (event) => finishPreviewResize(controller, handle, event));
    handle.addEventListener("pointercancel", () => cancelPreviewResize(controller));
  });
}

function ensureResizeHandles(panel: HTMLElement): void {
  if (panel.querySelector("[data-window-resize-edge]")) return;
  (["n", "e", "s", "w", "ne", "nw", "se", "sw"] as PreviewResizeEdge[]).forEach((edge) => {
    const handle = document.createElement("span");
    handle.className = `window-resize-handle window-resize-handle--${edge}`;
    handle.dataset.windowResizeEdge = edge;
    handle.title = "调整窗口大小";
    panel.appendChild(handle);
  });
}

function beginPreviewResize(controller: PreviewController, panel: HTMLElement, handle: HTMLElement, event: PointerEvent): void {
  const edge = handle.dataset.windowResizeEdge as PreviewResizeEdge | undefined;
  if (!edge) return;
  const panelRect = panel.getBoundingClientRect();
  const rootRect = controller.root.getBoundingClientRect();
  detachFromTabGroup(controller, panel);
  setPreviewWindowState(controller, panel, "open");
  panel.classList.remove("is-snapped", "is-split-peer");
  panel.classList.add("is-resizing");
  panel.dataset.dock = "float";
  panel.style.zIndex = String(nextWindowZ(controller.root));
  panel.style.left = `${panelRect.left - rootRect.left}px`;
  panel.style.top = `${panelRect.top - rootRect.top}px`;
  panel.style.width = `${panelRect.width}px`;
  panel.style.height = `${panelRect.height}px`;
  controller.resizeState = {
    pointerId: event.pointerId,
    panel,
    edge,
    startX: event.clientX,
    startY: event.clientY,
    panelLeft: panelRect.left - rootRect.left,
    panelTop: panelRect.top - rootRect.top,
    panelWidth: panelRect.width,
    panelHeight: panelRect.height,
  };
  handle.setPointerCapture(event.pointerId);
  updatePointerStatus(controller.pointerStatus, "调整窗口大小");
  event.preventDefault();
}

function updatePreviewResize(controller: PreviewController, event: PointerEvent): void {
  const resizeState = controller.resizeState;
  if (!resizeState || resizeState.pointerId !== event.pointerId) return;
  const rootRect = controller.root.getBoundingClientRect();
  const dx = event.clientX - resizeState.startX;
  const dy = event.clientY - resizeState.startY;
  const bounds = {
    left: 8,
    top: 38,
    right: rootRect.width - 8,
    bottom: rootRect.height - 44,
  };
  let left = resizeState.panelLeft;
  let top = resizeState.panelTop;
  let width = resizeState.panelWidth;
  let height = resizeState.panelHeight;

  if (resizeState.edge.includes("e")) {
    width = clamp(resizeState.panelWidth + dx, PREVIEW_MIN_WINDOW_WIDTH, bounds.right - left);
  }
  if (resizeState.edge.includes("s")) {
    height = clamp(resizeState.panelHeight + dy, PREVIEW_MIN_WINDOW_HEIGHT, bounds.bottom - top);
  }
  if (resizeState.edge.includes("w")) {
    const right = resizeState.panelLeft + resizeState.panelWidth;
    left = clamp(resizeState.panelLeft + dx, bounds.left, right - PREVIEW_MIN_WINDOW_WIDTH);
    width = right - left;
  }
  if (resizeState.edge.includes("n")) {
    const bottom = resizeState.panelTop + resizeState.panelHeight;
    top = clamp(resizeState.panelTop + dy, bounds.top, bottom - PREVIEW_MIN_WINDOW_HEIGHT);
    height = bottom - top;
  }

  resizeState.panel.style.left = `${left}px`;
  resizeState.panel.style.top = `${top}px`;
  resizeState.panel.style.width = `${width}px`;
  resizeState.panel.style.height = `${height}px`;
}

function finishPreviewResize(controller: PreviewController, handle: HTMLElement, event: PointerEvent): void {
  const resizeState = controller.resizeState;
  if (!resizeState || resizeState.pointerId !== event.pointerId) return;
  controller.resizeState = undefined;
  resizeState.panel.classList.remove("is-resizing");
  handle.releasePointerCapture(event.pointerId);
  updatePointerStatus(controller.pointerStatus, "浮动窗口");
  savePreviewLayout(controller);
}

function cancelPreviewResize(controller: PreviewController): void {
  controller.resizeState?.panel.classList.remove("is-resizing");
  controller.resizeState = undefined;
  updatePointerStatus(controller.pointerStatus, "浮动窗口");
}

function setPreviewWindowState(controller: PreviewController, windowNode: HTMLElement, state: PreviewWindowState): void {
  if (!controller.restoringLayout) clearActiveWorkspacePreset(controller);
  if (state !== "open") detachFromTabGroup(controller, windowNode);
  if (state !== "open") cacheFloatingWindowRect(controller.root, windowNode);
  windowNode.dataset.windowState = state;
  windowNode.hidden = state !== "open";
  if (state === "open" && windowNode.matches("[data-floating-window]")) {
    windowNode.style.zIndex = String(nextWindowZ(controller.root));
  }
  controller.workbench.setAttribute(`data-window-${windowNode.dataset.previewWindow || ""}`, state);
  if (controller.noticeStatus) controller.noticeStatus.textContent = `${windowTitle(windowNode)}已${windowStateLabel(state)}`;
  if (state === "open") syncPreviewOpenButtons(controller, windowNode.dataset.previewWindow || "");
  renderWindowManager(controller);
  savePreviewLayout(controller);
}

function beginPreviewDrag(controller: PreviewController, panel: HTMLElement, dragHandle: HTMLElement, event: PointerEvent): void {
  const panelRect = panel.getBoundingClientRect();
  const rootRect = controller.root.getBoundingClientRect();
  detachFromTabGroup(controller, panel);
  setPreviewWindowState(controller, panel, "open");
  panel.classList.remove("is-snapped", "is-split-peer");
  panel.dataset.dock = "float";
  panel.style.zIndex = String(nextWindowZ(controller.root));
  panel.style.width = `${panelRect.width}px`;
  panel.style.height = `${panelRect.height}px`;
  panel.style.left = `${panelRect.left - rootRect.left}px`;
  panel.style.top = `${panelRect.top - rootRect.top}px`;
  controller.dragState = {
    pointerId: event.pointerId,
    panel,
    startX: event.clientX,
    startY: event.clientY,
    panelLeft: panelRect.left - rootRect.left,
    panelTop: panelRect.top - rootRect.top,
    drop: { kind: "float", target: "float" },
  };
  dragHandle.setPointerCapture(event.pointerId);
  controller.dockOverlay.dataset.active = "true";
  event.preventDefault();
}

function updatePreviewDrag(controller: PreviewController, event: PointerEvent): void {
  const dragState = controller.dragState;
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const rootRect = controller.root.getBoundingClientRect();
  const left = dragState.panelLeft + event.clientX - dragState.startX;
  const top = dragState.panelTop + event.clientY - dragState.startY;
  dragState.panel.style.left = `${Math.max(8, Math.min(left, rootRect.width - 220))}px`;
  dragState.panel.style.top = `${Math.max(38, Math.min(top, rootRect.height - 160))}px`;
  dragState.drop = resolveDropTarget(controller.root, controller.workbench, dragState.panel, event.clientX, event.clientY, event.altKey);
  applyDropPreview(controller, dragState.drop);
  updatePointerStatus(controller.pointerStatus, dropTargetLabel(controller.root, dragState.drop));
}

function finishPreviewDrag(controller: PreviewController, dragHandle: HTMLElement, event: PointerEvent): void {
  const dragState = controller.dragState;
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  controller.dragState = undefined;
  dragHandle.releasePointerCapture(event.pointerId);
  controller.dockOverlay.dataset.active = "false";
  clearDropPreview(controller);

  if (dragState.drop.kind === "float") {
    updatePointerStatus(controller.pointerStatus, "浮动窗口");
    savePreviewLayout(controller);
    return;
  }
  if (dragState.drop.kind === "dock") {
    snapPreviewWindow(controller.root, dragState.panel, dragState.drop.target);
    updatePointerStatus(controller.pointerStatus, previewDockTargetLabel(dragState.drop.target));
    savePreviewLayout(controller);
    return;
  }
  if (dragState.drop.kind === "tab") {
    tabPreviewWindow(controller, dragState.panel, dragState.drop.tabTargetId);
    updatePointerStatus(controller.pointerStatus, "合并为标签页");
    savePreviewLayout(controller);
    return;
  }
  splitPreviewWindow(controller.root, dragState.panel, dragState.drop.splitTargetId, dragState.drop.splitSide);
  updatePointerStatus(controller.pointerStatus, `分屏到${previewSplitSideLabel(dragState.drop.splitSide)}`);
  savePreviewLayout(controller);
}

function cancelPreviewDrag(controller: PreviewController): void {
  controller.dragState = undefined;
  controller.dockOverlay.dataset.active = "false";
  clearDropPreview(controller);
}

function addPreviewWindow(controller: PreviewController): void {
  controller.createdWindows += 1;
  const windowId = `custom-${controller.createdWindows}`;
  const title = `窗口 ${controller.createdWindows}`;
  const template = document.createElement("template");
  template.innerHTML = floatingWindowMarkup(windowId, title, controller.createdWindows);
  const panel = template.content.firstElementChild as HTMLElement | null;
  if (!panel) return;
  const taskbar = controller.root.querySelector<HTMLElement>("[data-window-manager]");
  taskbar?.before(panel);
  bindWindowChrome(controller);
  bindFloatingWindow(controller, panel);
  setPreviewWindowState(controller, panel, "open");
}

function floatingWindowMarkup(windowId: PreviewWindowId, title: string, index: number): string {
  const left = 360 + index * 22;
  const top = 154 + index * 18;
  return `
    <section class="floating-tool-window preview-extra-window" data-floating-window data-dock="float" data-preview-window="${escapeHtml(windowId)}" data-window-title="${escapeHtml(title)}" data-window-state="open" style="left: ${left}px; top: ${top}px;">
      <div class="floating-tool-window__title" data-preview-drag>
        <span>${escapeHtml(title)}</span>
        <div class="pane-actions">
          <button type="button" data-preview-reset aria-label="重置浮动位置">浮动</button>
          <button type="button" aria-label="最小化${escapeHtml(title)}" data-window-minimize="${escapeHtml(windowId)}">-</button>
          <button type="button" aria-label="关闭${escapeHtml(title)}" data-window-close="${escapeHtml(windowId)}">x</button>
        </div>
      </div>
      <div class="task-stack">
        <article class="task-card is-active">
          <div class="task-card__title">临时工作区</div>
          <div class="task-card__meta">拖到边缘吸附，按 Alt 拖到标题区合并</div>
        </article>
        <article class="task-card">
          <div class="task-card__title">布局占位</div>
          <div class="task-card__meta">后续可替换成真实面板内容</div>
        </article>
      </div>
    </section>
  `;
}

function resolveDropTarget(root: HTMLElement, workbench: HTMLElement, activePanel: HTMLElement, x: number, y: number, allowTabMerge = false): PreviewDropTarget {
  const rect = workbench.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return { kind: "float", target: "float" };

  const relativeX = x - rect.left;
  const relativeY = y - rect.top;
  if (relativeX < 80) return { kind: "dock", target: "left" };
  if (relativeX > rect.width - 120) return { kind: "dock", target: "right" };
  if (relativeY > rect.height - 80) return { kind: "dock", target: "bottom" };

  const splitTarget = splitTargetAtPoint(root, activePanel, x, y);
  if (splitTarget) {
    const splitSide = resolveSplitSide(splitTarget.getBoundingClientRect(), x, y);
    if (allowTabMerge && (splitSide === "center" || splitSide === "top") && isTabMergeZone(splitTarget, x, y)) {
      return {
        kind: "tab",
        target: "center",
        tabTargetId: splitTarget.dataset.previewWindow || "",
      };
    }
    if (splitSide === "center") return { kind: "float", target: "float" };
    return {
      kind: "split",
      target: "center",
      splitTargetId: splitTarget.dataset.previewWindow || "",
      splitSide,
    };
  }

  if (relativeY > rect.height - 230) return { kind: "dock", target: "bottom" };
  if (relativeX < 290) return { kind: "dock", target: "left" };
  if (relativeX > rect.width - 330) return { kind: "dock", target: "right" };
  return { kind: "dock", target: "center" };
}

function splitTargetAtPoint(root: HTMLElement, activePanel: HTMLElement, x: number, y: number): HTMLElement | undefined {
  const candidates = allPreviewWindows(root)
    .filter((candidate) => candidate !== activePanel && !candidate.hidden)
    .map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width >= 96 && rect.height >= 80 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
    .sort((left, right) => left.rect.width * left.rect.height - right.rect.width * right.rect.height);
  return candidates[0]?.candidate;
}

function resolveSplitSide(rect: DOMRect, x: number, y: number): PreviewSplitSide | "center" {
  const relativeX = (x - rect.left) / Math.max(1, rect.width);
  const relativeY = (y - rect.top) / Math.max(1, rect.height);
  if (relativeX >= 0.35 && relativeX <= 0.65 && relativeY >= 0.28 && relativeY <= 0.72) return "center";
  if (relativeX < 0.35) return "left";
  if (relativeX > 0.65) return "right";
  if (relativeY < 0.35) return "top";
  if (relativeY > 0.65) return "bottom";
  return relativeX < 0.5 ? "left" : "right";
}

function isTabMergeZone(target: HTMLElement, x: number, y: number): boolean {
  const rect = target.getBoundingClientRect();
  const relativeX = (x - rect.left) / Math.max(1, rect.width);
  const relativeY = y - rect.top;
  if (relativeX < 0.2 || relativeX > 0.8) return false;
  return relativeY >= 0 && relativeY <= (target.classList.contains("has-merged-tabs") ? 64 : 42);
}

function applyDropPreview(controller: PreviewController, drop: PreviewDropTarget): void {
  clearDropPreview(controller);
  controller.workbench.dataset.dropKind = drop.kind;
  if (drop.kind === "dock") {
    controller.workbench.dataset.dropTarget = drop.target;
    return;
  }
  if (drop.kind === "split") {
    controller.workbench.dataset.dropTarget = "center";
    const target = windowById(controller.root, drop.splitTargetId);
    if (!target) return;
    target.classList.add("is-split-candidate");
    target.dataset.splitSide = drop.splitSide;
    target.dataset.splitLabel = `分屏到${previewSplitSideLabel(drop.splitSide)}`;
    return;
  }
  if (drop.kind === "tab") {
    controller.workbench.dataset.dropTarget = "center";
    const target = windowById(controller.root, drop.tabTargetId);
    if (!target) return;
    target.classList.add("is-tab-candidate");
    target.dataset.tabLabel = "合并为标签页";
  }
}

function clearDropPreview(controller: PreviewController): void {
  delete controller.workbench.dataset.dropKind;
  delete controller.workbench.dataset.dropTarget;
  controller.root.querySelectorAll<HTMLElement>(".is-split-candidate").forEach((target) => {
    target.classList.remove("is-split-candidate");
    delete target.dataset.splitSide;
    delete target.dataset.splitLabel;
  });
  controller.root.querySelectorAll<HTMLElement>(".is-tab-candidate").forEach((target) => {
    target.classList.remove("is-tab-candidate");
    delete target.dataset.tabLabel;
  });
}

function tabPreviewWindow(controller: PreviewController, panel: HTMLElement, targetWindowId: PreviewWindowId): void {
  const target = windowById(controller.root, targetWindowId);
  const panelId = panel.dataset.previewWindow || "";
  if (!target || !panelId || target === panel) return;
  const groupId = target.dataset.tabGroup || panel.dataset.tabGroup || nextTabGroupId(controller.root);
  target.dataset.tabGroup = groupId;
  panel.dataset.tabGroup = groupId;
  target.dataset.tabAnchor = target.dataset.tabAnchor || target.dataset.previewWindow || "";
  panel.dataset.tabAnchor = target.dataset.tabAnchor;
  panel.dataset.dock = `tab-${target.dataset.previewWindow || "group"}`;
  panel.classList.add("is-tabbed-peer");
  panel.hidden = true;
  renderMergedTabs(controller, groupId, target.dataset.previewWindow || "");
  controller.root.dataset.previewDock = "tab";
}

function renderMergedTabs(controller: PreviewController, groupId: string, activeWindowId: PreviewWindowId): void {
  const members = tabGroupMembers(controller.root, groupId).filter((member) => windowState(member) === "open");
  if (members.length <= 1) {
    members.forEach((member) => detachFromTabGroup(controller, member));
    return;
  }
  members.forEach((member) => {
    member.classList.add("has-merged-tabs");
    member.querySelector<HTMLElement>(":scope > .merged-window-tabs")?.remove();
    const tabs = document.createElement("div");
    tabs.className = "merged-window-tabs";
    tabs.setAttribute("role", "tablist");
    members.forEach((tabMember) => {
      const tabButton = document.createElement("button");
      const tabId = tabMember.dataset.previewWindow || "";
      tabButton.type = "button";
      tabButton.className = tabId === activeWindowId ? "is-active" : "";
      tabButton.dataset.mergedTabWindow = tabId;
      tabButton.setAttribute("role", "tab");
      tabButton.setAttribute("aria-selected", String(tabId === activeWindowId));
      tabButton.textContent = windowTitle(tabMember);
      tabButton.addEventListener("click", (event) => {
        event.stopPropagation();
        activateTabbedWindow(controller, groupId, tabId);
      });
      bindMergedTabDrag(controller, tabButton, groupId, tabId);
      tabs.appendChild(tabButton);
    });
    member.prepend(tabs);
  });
  activateTabbedWindow(controller, groupId, activeWindowId);
}

function activateTabbedWindow(controller: PreviewController, groupId: string, activeWindowId: PreviewWindowId): void {
  const members = tabGroupMembers(controller.root, groupId);
  const anchor = tabGroupAnchor(controller.root, members);
  const anchorRect = anchor?.getBoundingClientRect();
  members.forEach((member) => {
    const memberId = member.dataset.previewWindow || "";
    const isActive = memberId === activeWindowId;
    member.dataset.tabActive = String(isActive);
    member.querySelectorAll<HTMLButtonElement>(":scope > .merged-window-tabs button").forEach((button) => {
      const buttonActive = button.dataset.mergedTabWindow === activeWindowId;
      button.classList.toggle("is-active", buttonActive);
      button.setAttribute("aria-selected", String(buttonActive));
    });
    if (member.matches("[data-floating-window]")) {
      member.hidden = !isActive;
      if (isActive && anchorRect) {
        positionFloatingWindow(controller.root, member, {
          left: anchorRect.left,
          top: anchorRect.top,
          width: anchorRect.width,
          height: anchorRect.height,
        });
      }
    }
  });
  syncPreviewOpenButtons(controller, activeWindowId);
  renderTaskbar(controller);
  savePreviewLayout(controller);
}

function bindMergedTabDrag(controller: PreviewController, tabButton: HTMLButtonElement, groupId: string, tabId: PreviewWindowId): void {
  let pending: { pointerId: number; startX: number; startY: number; started: boolean } | undefined;

  tabButton.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pending = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
    };
    tabButton.setPointerCapture(event.pointerId);
  });

  tabButton.addEventListener("pointermove", (event) => {
    if (!pending || pending.pointerId !== event.pointerId || pending.started) return;
    const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
    if (distance < 8) return;
    const windowNode = windowById(controller.root, tabId);
    const dragHandle = windowNode?.querySelector<HTMLElement>("[data-preview-drag]");
    if (!windowNode || !dragHandle) return;
    pending.started = true;
    activateTabbedWindow(controller, groupId, tabId);
    beginPreviewDrag(controller, windowNode, dragHandle, event);
    event.preventDefault();
  });

  const clearPending = (event: PointerEvent): void => {
    if (!pending || pending.pointerId !== event.pointerId) return;
    if (tabButton.hasPointerCapture(event.pointerId)) tabButton.releasePointerCapture(event.pointerId);
    pending = undefined;
  };

  tabButton.addEventListener("pointerup", clearPending);
  tabButton.addEventListener("pointercancel", clearPending);
}

function detachFromTabGroup(controller: PreviewController, windowNode: HTMLElement): void {
  const groupId = windowNode.dataset.tabGroup;
  if (!groupId) return;
  delete windowNode.dataset.tabGroup;
  delete windowNode.dataset.tabAnchor;
  delete windowNode.dataset.tabActive;
  windowNode.classList.remove("has-merged-tabs", "is-tabbed-peer");
  windowNode.querySelector<HTMLElement>(":scope > .merged-window-tabs")?.remove();
  const rest = tabGroupMembers(controller.root, groupId);
  if (rest.length <= 1) {
    rest.forEach((member) => {
      delete member.dataset.tabGroup;
      delete member.dataset.tabAnchor;
      delete member.dataset.tabActive;
      member.classList.remove("has-merged-tabs", "is-tabbed-peer");
      member.querySelector<HTMLElement>(":scope > .merged-window-tabs")?.remove();
      if (windowState(member) === "open") member.hidden = false;
    });
    renderTaskbar(controller);
    return;
  }
  renderMergedTabs(controller, groupId, rest[0]?.dataset.previewWindow || "");
}

function tabGroupMembers(root: HTMLElement, groupId: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[data-tab-group="${groupId}"]`)];
}

function tabGroupAnchor(root: HTMLElement, members: HTMLElement[]): HTMLElement | undefined {
  const anchorId = members.find((member) => member.dataset.tabAnchor)?.dataset.tabAnchor;
  if (anchorId) return windowById(root, anchorId);
  return members.find((member) => !member.matches("[data-floating-window]")) || members.find((member) => !member.hidden) || members[0];
}

function snapPreviewWindow(root: HTMLElement, panel: HTMLElement, target: Exclude<PreviewDockTarget, "float">): void {
  const slot = root.querySelector<HTMLElement>(`[data-dock-slot="${target}"]`);
  if (!slot) return;
  const slotRect = slot.getBoundingClientRect();
  panel.dataset.dock = target;
  panel.classList.add("is-snapped");
  panel.classList.remove("is-split-peer");
  positionFloatingWindow(root, panel, {
    left: slotRect.left + 8,
    top: slotRect.top + 8,
    width: Math.max(220, slotRect.width - 16),
    height: Math.max(140, slotRect.height - 16),
  });
  root.dataset.previewDock = target;
}

function splitPreviewWindow(root: HTMLElement, panel: HTMLElement, targetWindowId: PreviewWindowId, side: PreviewSplitSide): void {
  const target = windowById(root, targetWindowId);
  if (!target) return;
  const targetRect = target.getBoundingClientRect();
  const activeRect = splitRect(targetRect, side);
  panel.dataset.dock = `split-${side}`;
  panel.classList.add("is-snapped", "is-split-peer");
  positionFloatingWindow(root, panel, activeRect);

  if (target.matches("[data-floating-window]")) {
    const peerSide = oppositeSplitSide(side);
    const peerRect = splitRect(targetRect, peerSide);
    target.dataset.dock = `split-${peerSide}`;
    target.classList.add("is-snapped", "is-split-peer");
    positionFloatingWindow(root, target, peerRect);
  }
}

function splitRect(rect: DOMRect, side: PreviewSplitSide): { left: number; top: number; width: number; height: number } {
  if (side === "left") return { left: rect.left + 6, top: rect.top + 6, width: Math.max(96, rect.width / 2 - 9), height: Math.max(140, rect.height - 12) };
  if (side === "right") return { left: rect.left + rect.width / 2 + 3, top: rect.top + 6, width: Math.max(96, rect.width / 2 - 9), height: Math.max(140, rect.height - 12) };
  if (side === "top") return { left: rect.left + 6, top: rect.top + 6, width: Math.max(220, rect.width - 12), height: Math.max(120, rect.height / 2 - 9) };
  return { left: rect.left + 6, top: rect.top + rect.height / 2 + 3, width: Math.max(220, rect.width - 12), height: Math.max(120, rect.height / 2 - 9) };
}

function positionFloatingWindow(root: HTMLElement, panel: HTMLElement, rect: { left: number; top: number; width: number; height: number }): void {
  const rootRect = root.getBoundingClientRect();
  panel.style.left = `${rect.left - rootRect.left}px`;
  panel.style.top = `${rect.top - rootRect.top}px`;
  panel.style.width = `${rect.width}px`;
  panel.style.height = `${rect.height}px`;
  panel.style.zIndex = String(nextWindowZ(root));
  setCachedWindowRect(panel, {
    left: Math.round(rect.left - rootRect.left),
    top: Math.round(rect.top - rootRect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
}

function resetPreviewWindow(controller: PreviewController, panel: HTMLElement): void {
  panel.dataset.dock = "float";
  panel.classList.remove("is-snapped", "is-split-peer");
  panel.style.left = "";
  panel.style.top = "";
  panel.style.width = "";
  panel.style.height = "";
  panel.style.zIndex = String(nextWindowZ(controller.root));
  controller.root.dataset.previewDock = "float";
  updatePointerStatus(controller.pointerStatus, "浮动窗口");
  savePreviewLayout(controller);
}

function captureDefaultPreviewWindows(root: HTMLElement): Map<PreviewWindowId, PreviewWindowDefault> {
  const defaults = new Map<PreviewWindowId, PreviewWindowDefault>();
  allPreviewWindows(root).forEach((windowNode) => {
    const id = windowNode.dataset.previewWindow || "";
    if (!id) return;
    defaults.set(id, {
      state: windowState(windowNode),
      dock: windowNode.dataset.dock || "float",
      style: windowNode.getAttribute("style"),
    });
  });
  return defaults;
}

function syncPreviewWindowStates(controller: PreviewController): void {
  allPreviewWindows(controller.root).forEach((windowNode) => {
    const id = windowNode.dataset.previewWindow || "";
    let state = windowState(windowNode);
    if (state === "open" && shouldStartMinimizedOnCompact(id)) {
      state = "minimized";
      windowNode.dataset.windowState = state;
    }
    windowNode.hidden = state !== "open";
    controller.workbench.setAttribute(`data-window-${id}`, state);
  });
}

function shouldStartMinimizedOnCompact(windowId: PreviewWindowId): boolean {
  if (typeof window === "undefined" || !window.matchMedia("(max-width: 720px)").matches) return false;
  return windowId === "explorer" || windowId === "workspace";
}

export function previewWorkspacePresetPlan(
  preset: PreviewWorkspacePreset,
  viewport: PreviewWorkspacePresetViewport,
): PreviewWorkspacePresetPlanEntry[] {
  void viewport;
  const base: PreviewWorkspacePresetPlanEntry[] = [
    { id: "tools", state: "open" },
    { id: "editor", state: "open" },
  ];

  if (preset === "focus") {
    return [
      ...base,
      { id: "explorer", state: "minimized" },
      { id: "workspace", state: "minimized" },
      { id: "output", state: "closed" },
    ];
  }

  if (preset === "ai") {
    return [
      ...base,
      { id: "explorer", state: "minimized" },
      { id: "workspace", state: "open" },
      { id: "output", state: "open" },
    ];
  }

  if (preset === "debug") {
    return [
      ...base,
      { id: "explorer", state: "open" },
      { id: "workspace", state: "minimized" },
      { id: "output", state: "open" },
    ];
  }

  return [
    ...base,
    { id: "explorer", state: "open" },
    { id: "workspace", state: "open" },
    { id: "output", state: "open" },
  ];
}

function applyPreviewWorkspacePreset(controller: PreviewController, preset: PreviewWorkspacePreset): void {
  const rootRect = controller.root.getBoundingClientRect();
  const plan = new Map(
    previewWorkspacePresetPlan(preset, { width: rootRect.width, height: rootRect.height }).map((entry) => [entry.id, entry]),
  );

  controller.restoringLayout = true;
  clearDropPreview(controller);
  allPreviewWindows(controller.root).forEach((windowNode) => {
    const windowId = windowNode.dataset.previewWindow || "";
    const entry = plan.get(windowId);
    clearWindowGrouping(windowNode);

    if (entry) {
      applyPreviewWindowState(controller, windowNode, entry.state);
      windowNode.dataset.dock = entry.dock || windowNode.dataset.dock || "float";
      applyPresetWindowStyle(controller, windowNode, entry, rootRect);
      return;
    }

    if (windowId.startsWith("custom-")) {
      applyPreviewWindowState(controller, windowNode, "minimized");
    }
  });
  controller.restoringLayout = false;

  controller.workbench.dataset.workspacePreset = preset;
  syncPreviewOpenButtons(controller, "editor");
  syncWorkspacePresetButtons(controller);
  renderWindowManager(controller);
  updatePointerStatus(controller.pointerStatus, `${previewWorkspacePresetLabel(preset)}布局`);
  if (controller.noticeStatus) controller.noticeStatus.textContent = `已切换到${previewWorkspacePresetLabel(preset)}布局`;
  savePreviewLayout(controller);
}

function applyPresetWindowStyle(
  controller: PreviewController,
  windowNode: HTMLElement,
  entry: PreviewWorkspacePresetPlanEntry,
  rootRect: DOMRect,
): void {
  if (!windowNode.matches("[data-floating-window]")) {
    windowNode.classList.remove("is-snapped", "is-split-peer", "is-tabbed-peer");
    return;
  }

  windowNode.classList.toggle("is-snapped", Boolean(entry.dock && entry.dock !== "float" && !entry.dock.startsWith("tab-")));
  windowNode.classList.toggle("is-split-peer", Boolean(entry.dock?.startsWith("split-")));
  windowNode.classList.toggle("is-tabbed-peer", Boolean(entry.dock?.startsWith("tab-")));
  if (!entry.rect) {
    restoreDefaultStyle(windowNode, controller.defaultWindows.get(entry.id)?.style ?? windowNode.getAttribute("style"));
    return;
  }

  positionFloatingWindow(controller.root, windowNode, {
    left: rootRect.left + entry.rect.left,
    top: rootRect.top + entry.rect.top,
    width: entry.rect.width,
    height: entry.rect.height,
  });
}

function applyPreviewWindowState(controller: PreviewController, windowNode: HTMLElement, state: PreviewWindowState): void {
  if (state !== "open") cacheFloatingWindowRect(controller.root, windowNode);
  windowNode.dataset.windowState = state;
  windowNode.hidden = state !== "open";
  if (state === "open" && windowNode.matches("[data-floating-window]")) windowNode.style.zIndex = String(nextWindowZ(controller.root));
  controller.workbench.setAttribute(`data-window-${windowNode.dataset.previewWindow || ""}`, state);
}

function clearWindowGrouping(windowNode: HTMLElement): void {
  delete windowNode.dataset.tabGroup;
  delete windowNode.dataset.tabAnchor;
  delete windowNode.dataset.tabActive;
  windowNode.classList.remove("has-merged-tabs", "is-tabbed-peer", "is-split-peer", "is-snapped");
  windowNode.querySelector<HTMLElement>(":scope > .merged-window-tabs")?.remove();
}

function clearActiveWorkspacePreset(controller: PreviewController): void {
  if (!controller.workbench.dataset.workspacePreset) return;
  delete controller.workbench.dataset.workspacePreset;
  syncWorkspacePresetButtons(controller);
}

function syncWorkspacePresetButtons(controller: PreviewController): void {
  const activePreset = controller.workbench.dataset.workspacePreset;
  controller.root.querySelectorAll<HTMLButtonElement>("[data-window-preset]").forEach((button) => {
    const isActive = Boolean(activePreset) && button.dataset.windowPreset === activePreset;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function isPreviewWorkspacePreset(value: string): value is PreviewWorkspacePreset {
  return (previewWorkspacePresets as readonly string[]).includes(value);
}

function previewWorkspacePresetLabel(preset: PreviewWorkspacePreset): string {
  if (preset === "focus") return "专注";
  if (preset === "ai") return "AI";
  if (preset === "debug") return "调试";
  return "编辑";
}

function applyDefaultPreviewTabGroups(controller: PreviewController): void {
  void controller;
}

function hydrateStoredCustomWindows(controller: PreviewController): void {
  const snapshot = readPreviewLayoutSnapshot();
  if (!snapshot) return;
  const maxCustomIndex = snapshot.windows.reduce((maxIndex, windowSnapshot) => {
    if (!windowSnapshot.id.startsWith("custom-")) return maxIndex;
    return Math.max(maxIndex, Number(windowSnapshot.id.slice("custom-".length)) || 0);
  }, snapshot.createdWindows || 0);
  controller.createdWindows = Math.max(controller.createdWindows, maxCustomIndex);
  snapshot.windows
    .filter((windowSnapshot) => windowSnapshot.custom || windowSnapshot.id.startsWith("custom-"))
    .forEach((windowSnapshot) => {
      if (windowById(controller.root, windowSnapshot.id)) return;
      const index = Number(windowSnapshot.id.slice("custom-".length)) || 0;
      const template = document.createElement("template");
      template.innerHTML = floatingWindowMarkup(windowSnapshot.id, windowSnapshot.title || previewWindowLabel(windowSnapshot.id), index);
      const panel = template.content.firstElementChild as HTMLElement | null;
      const taskbar = controller.root.querySelector<HTMLElement>("[data-window-manager]");
      if (panel) taskbar?.before(panel);
    });
}

function applyStoredPreviewLayout(controller: PreviewController): void {
  const snapshot = readPreviewLayoutSnapshot();
  if (!snapshot) return;
  controller.restoringLayout = true;
  controller.createdWindows = Math.max(controller.createdWindows, snapshot.createdWindows || 0);
  const groups = new Map<string, PreviewWindowId>();

  snapshot.windows.forEach((windowSnapshot) => {
    const windowNode = windowById(controller.root, windowSnapshot.id);
    if (!windowNode) return;
    windowNode.dataset.windowTitle = windowSnapshot.title || previewWindowLabel(windowSnapshot.id);
    windowNode.dataset.windowState = windowSnapshot.state;
    windowNode.dataset.dock = windowSnapshot.dock || "float";
    windowNode.hidden = windowSnapshot.state !== "open";
    restoreFloatingWindowStyle(controller.root, windowNode, windowSnapshot.rect);
    controller.workbench.setAttribute(`data-window-${windowSnapshot.id}`, windowSnapshot.state);

    windowNode.classList.toggle("is-snapped", windowSnapshot.dock !== "float" && !windowSnapshot.dock.startsWith("tab-"));
    windowNode.classList.toggle("is-split-peer", windowSnapshot.dock.startsWith("split-"));
    windowNode.classList.toggle("is-tabbed-peer", windowSnapshot.dock.startsWith("tab-"));
    windowNode.classList.remove("has-merged-tabs");
    windowNode.querySelector<HTMLElement>(":scope > .merged-window-tabs")?.remove();

    if (windowSnapshot.tabGroup) {
      windowNode.dataset.tabGroup = windowSnapshot.tabGroup;
      if (windowSnapshot.tabAnchor) windowNode.dataset.tabAnchor = windowSnapshot.tabAnchor;
      if (!groups.has(windowSnapshot.tabGroup) || windowSnapshot.tabActive) groups.set(windowSnapshot.tabGroup, windowSnapshot.id);
    } else {
      delete windowNode.dataset.tabGroup;
      delete windowNode.dataset.tabAnchor;
      delete windowNode.dataset.tabActive;
    }
  });

  groups.forEach((activeWindowId, groupId) => renderMergedTabs(controller, groupId, activeWindowId));
  controller.restoringLayout = false;
}

function restoreFloatingWindowStyle(root: HTMLElement, windowNode: HTMLElement, rect: PreviewWindowRect | undefined): void {
  if (!windowNode.matches("[data-floating-window]")) return;
  if (!rect) return;
  positionFloatingWindow(root, windowNode, rect);
}

function savePreviewLayout(controller: PreviewController): void {
  if (controller.restoringLayout) return;
  const snapshot: PreviewLayoutSnapshot = {
    version: 10,
    createdWindows: controller.createdWindows,
    windows: allPreviewWindows(controller.root).map((windowNode) => previewWindowSnapshot(controller.root, windowNode)),
  };
  try {
    localStorage.setItem(PREVIEW_LAYOUT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    if (controller.noticeStatus) controller.noticeStatus.textContent = "布局暂时无法保存";
  }
}

function previewWindowSnapshot(root: HTMLElement, windowNode: HTMLElement): PreviewWindowSnapshot {
  const id = windowNode.dataset.previewWindow || "";
  const snapshot: PreviewWindowSnapshot = {
    id,
    title: windowTitle(windowNode),
    state: windowState(windowNode),
    dock: windowNode.dataset.dock || "float",
    custom: id.startsWith("custom-"),
  };
  const rect = windowRect(root, windowNode);
  if (rect) snapshot.rect = rect;
  if (windowNode.dataset.tabGroup) snapshot.tabGroup = windowNode.dataset.tabGroup;
  if (windowNode.dataset.tabAnchor) snapshot.tabAnchor = windowNode.dataset.tabAnchor;
  if (windowNode.dataset.tabActive === "true") snapshot.tabActive = true;
  return snapshot;
}

function readPreviewLayoutSnapshot(): PreviewLayoutSnapshot | undefined {
  try {
    const raw = localStorage.getItem(PREVIEW_LAYOUT_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<PreviewLayoutSnapshot>;
    if (parsed.version !== 10 || !Array.isArray(parsed.windows)) return undefined;
    return parsed as PreviewLayoutSnapshot;
  } catch {
    return undefined;
  }
}

function resetPreviewLayout(controller: PreviewController): void {
  controller.restoringLayout = true;
  try {
    localStorage.removeItem(PREVIEW_LAYOUT_STORAGE_KEY);
    LEGACY_PREVIEW_LAYOUT_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Reset still restores the visible layout even if browser storage is unavailable.
  }

  allPreviewWindows(controller.root)
    .filter((windowNode) => (windowNode.dataset.previewWindow || "").startsWith("custom-"))
    .forEach((windowNode) => windowNode.remove());

  controller.defaultWindows.forEach((defaultWindow, windowId) => {
    const windowNode = windowById(controller.root, windowId);
    if (!windowNode) return;
    windowNode.dataset.windowState = defaultWindow.state;
    windowNode.dataset.dock = defaultWindow.dock;
    windowNode.hidden = defaultWindow.state !== "open";
    restoreDefaultStyle(windowNode, defaultWindow.style);
    windowNode.classList.remove("is-snapped", "is-split-peer", "is-tabbed-peer", "has-merged-tabs");
    windowNode.querySelector<HTMLElement>(":scope > .merged-window-tabs")?.remove();
    delete windowNode.dataset.tabGroup;
    delete windowNode.dataset.tabAnchor;
    delete windowNode.dataset.tabActive;
    controller.workbench.setAttribute(`data-window-${windowId}`, defaultWindow.state);
  });

  controller.createdWindows = 0;
  delete controller.root.dataset.previewDock;
  clearActiveWorkspacePreset(controller);
  applyDefaultPreviewTabGroups(controller);
  controller.restoringLayout = false;
  bindWindowChrome(controller);
  bindFloatingWindows(controller);
  renderWindowManager(controller);
  updatePointerStatus(controller.pointerStatus, "默认布局");
  if (controller.noticeStatus) controller.noticeStatus.textContent = "布局已重置";
}

function restoreDefaultStyle(windowNode: HTMLElement, style: string | null): void {
  delete windowNode.dataset.layoutLeft;
  delete windowNode.dataset.layoutTop;
  delete windowNode.dataset.layoutWidth;
  delete windowNode.dataset.layoutHeight;
  if (style === null) {
    windowNode.removeAttribute("style");
    return;
  }
  windowNode.setAttribute("style", style);
}

function windowRect(root: HTMLElement, windowNode: HTMLElement): PreviewWindowRect | undefined {
  if (!windowNode.matches("[data-floating-window]")) return undefined;
  const cached = cachedWindowRect(windowNode);
  if (windowNode.hidden && cached) return cached;
  const rootRect = root.getBoundingClientRect();
  const rect = windowNode.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return cached;
  const currentRect = {
    left: Math.round(rect.left - rootRect.left),
    top: Math.round(rect.top - rootRect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
  setCachedWindowRect(windowNode, currentRect);
  return currentRect;
}

function cacheFloatingWindowRect(root: HTMLElement, windowNode: HTMLElement): void {
  const rect = windowRect(root, windowNode);
  if (rect) setCachedWindowRect(windowNode, rect);
}

function cachedWindowRect(windowNode: HTMLElement): PreviewWindowRect | undefined {
  const left = Number(windowNode.dataset.layoutLeft);
  const top = Number(windowNode.dataset.layoutTop);
  const width = Number(windowNode.dataset.layoutWidth);
  const height = Number(windowNode.dataset.layoutHeight);
  if (![left, top, width, height].every(Number.isFinite)) return undefined;
  return { left, top, width, height };
}

function setCachedWindowRect(windowNode: HTMLElement, rect: PreviewWindowRect): void {
  windowNode.dataset.layoutLeft = String(rect.left);
  windowNode.dataset.layoutTop = String(rect.top);
  windowNode.dataset.layoutWidth = String(rect.width);
  windowNode.dataset.layoutHeight = String(rect.height);
}

function updatePointerStatus(node: HTMLElement | null, label: string): void {
  if (!node) return;
  node.textContent = `吸附目标：${label}`;
}

function dropTargetLabel(root: HTMLElement, drop: PreviewDropTarget): string {
  if (drop.kind === "float") return "浮动窗口";
  if (drop.kind === "dock") return previewDockTargetLabel(drop.target);
  if (drop.kind === "tab") {
    const target = windowById(root, drop.tabTargetId);
    const targetLabel = target ? windowTitle(target) : previewWindowLabel(drop.tabTargetId);
    return `${targetLabel} · 合并为标签页`;
  }
  const target = windowById(root, drop.splitTargetId);
  const targetLabel = target ? windowTitle(target) : previewWindowLabel(drop.splitTargetId);
  return `${targetLabel} · ${previewSplitSideLabel(drop.splitSide)} 1/2`;
}

function allPreviewWindows(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-preview-window]")].filter((node) => !node.matches("[data-role]"));
}

function windowById(root: HTMLElement, windowId: PreviewWindowId | undefined): HTMLElement | undefined {
  if (!windowId) return undefined;
  return root.querySelector<HTMLElement>(`[data-preview-window="${windowId}"]`) || undefined;
}

function windowState(windowNode: HTMLElement): PreviewWindowState {
  const state = windowNode.dataset.windowState;
  if (state === "minimized" || state === "closed") return state;
  return "open";
}

function windowTitle(windowNode: HTMLElement): string {
  return windowNode.dataset.windowTitle || previewWindowLabel(windowNode.dataset.previewWindow || "");
}

function windowStateLabel(state: PreviewWindowState): string {
  if (state === "open") return "打开";
  if (state === "minimized") return "最小化";
  return "关闭";
}

function previewWindowLabel(windowId: PreviewWindowId): string {
  if (windowId === "tools") return "工具";
  if (windowId === "explorer") return "层级";
  if (windowId === "editor") return "世界";
  if (windowId === "workspace") return "AI 任务";
  if (windowId === "output") return "日志";
  if (windowId.startsWith("custom-")) return `窗口 ${windowId.slice("custom-".length)}`;
  return "窗口";
}

function previewDockTargetLabel(target: Exclude<PreviewDockTarget, "float">): string {
  if (target === "left") return "左侧栏";
  if (target === "right") return "右侧任务";
  if (target === "bottom") return "日志";
  return "编辑器组";
}

function previewSplitSideLabel(side: PreviewSplitSide): string {
  if (side === "left") return "左半区";
  if (side === "right") return "右半区";
  if (side === "top") return "上半区";
  return "下半区";
}

function oppositeSplitSide(side: PreviewSplitSide): PreviewSplitSide {
  if (side === "left") return "right";
  if (side === "right") return "left";
  if (side === "top") return "bottom";
  return "top";
}

function closeLauncher(controller: PreviewController): void {
  controller.launcherMenu.hidden = true;
  delete controller.launcherMenu.dataset.anchor;
  controller.root.querySelectorAll<HTMLButtonElement>("[data-window-launcher]").forEach((toggle) => {
    toggle.setAttribute("aria-expanded", "false");
  });
}

function launcherAnchor(button: HTMLElement): "titlebar" | "taskbar" {
  return button.closest(".workbench-titlebar") ? "titlebar" : "taskbar";
}

function nextWindowZ(root: HTMLElement): number {
  const current = Number(root.dataset.windowZ || "40") + 1;
  root.dataset.windowZ = String(current);
  return current;
}

function nextTabGroupId(root: HTMLElement): string {
  const current = Number(root.dataset.tabGroupSeq || "0") + 1;
  root.dataset.tabGroupSeq = String(current);
  return `tab-group-${current}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function enterGameMode(root: HTMLElement): void {
  const workbench = root.querySelector(".workbench-preview");
  if (workbench) workbench.classList.add("is-game-mode");
}

export function leaveGameMode(root: HTMLElement): void {
  const workbench = root.querySelector(".workbench-preview");
  if (workbench) workbench.classList.remove("is-game-mode");
}
