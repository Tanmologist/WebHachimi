import {
  createDockview,
  type DockviewApi,
  type GroupPanelPartInitParameters,
  type IContentRenderer,
  type IDockviewPanel,
  type ITabRenderer,
  type IWatermarkRenderer,
  type DroptargetOverlayModel,
  type DockviewTheme,
  type PanelTransfer,
  type TabPartInitParameters,
} from "dockview-core";

export type PanelId = "scene" | "properties" | "assets" | "library" | "tasks" | "output";
type DockviewGroupDropLocation = "tab" | "header_space" | "content" | "edge";
export type PanelState = "open" | "minimized" | "closed";
export type PanelPlacement = "docked" | "floating";
export type PanelDock = PanelPlacement;
export type ResizeTarget = "dockview";
export type DockEdge = "left" | "right" | "top" | "bottom";

export type FixedPanelLayout = {
  panel: PanelId;
  area: "scene" | "properties" | "assets" | "tasks" | "dock";
  state: PanelState;
  placement: PanelPlacement;
  visible: boolean;
  docked: boolean;
  floating: boolean;
  order: number;
};

export type StudioWorkspaceMode = "desktop" | "compact" | "narrow";

type DockContentId = PanelId;

type PanelLayoutControllerOptions = {
  root: HTMLElement;
  setNotice: (notice: string) => void;
  renderAll: () => void;
};

type DockPanelDefaults = {
  title: string;
  minimumWidth: number;
  minimumHeight: number;
  initialWidth: number;
  initialHeight: number;
};

type DockTitleDrag = {
  panel: PanelId;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  edge: DockEdge | undefined;
};

type DockEdgeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const panelOrder: PanelId[] = ["scene", "properties", "assets", "library", "tasks", "output"];
const dockComponentName = "webhachimi-panel";
const dockTabName = "webhachimi-tab";
export const dockDragStartThreshold = 6;
export const dockEdgeSnapThreshold = 36;
export const dockSingleTabMode = "fullwidth";
export const dockEdgeDropOverlay: DroptargetOverlayModel = {
  activationSize: { type: "pixels", value: 18 },
  size: { type: "pixels", value: 42 },
};
export const dockTheme: DockviewTheme = {
  name: "webhachimi-dark",
  className: "dockview-theme-dark",
  dndOverlayMounting: "absolute",
  dndPanelOverlay: "group",
};

const panelAreas: Record<PanelId, FixedPanelLayout["area"]> = {
  scene: "scene",
  properties: "properties",
  assets: "assets",
  library: "dock",
  tasks: "tasks",
  output: "dock",
};

const dockDefaults: Record<DockContentId, DockPanelDefaults> = {
  scene: { title: "世界", minimumWidth: 220, minimumHeight: 180, initialWidth: 300, initialHeight: 620 },
  properties: { title: "属性", minimumWidth: 260, minimumHeight: 180, initialWidth: 330, initialHeight: 360 },
  assets: { title: "资源", minimumWidth: 320, minimumHeight: 160, initialWidth: 520, initialHeight: 250 },
  library: { title: "资源库", minimumWidth: 320, minimumHeight: 220, initialWidth: 430, initialHeight: 420 },
  tasks: { title: "任务", minimumWidth: 280, minimumHeight: 180, initialWidth: 330, initialHeight: 310 },
  output: { title: "输出", minimumWidth: 320, minimumHeight: 150, initialWidth: 520, initialHeight: 210 },
};

export class PanelLayoutController {
  readonly panelState: Record<PanelId, PanelState> = {
    scene: "open",
    properties: "open",
    assets: "open",
    library: "closed",
    tasks: "open",
    output: "closed",
  };

  readonly panelPlacement: Record<PanelId, PanelPlacement> = defaultPanelPlacement();
  readonly panelSnaps: Partial<Record<PanelId, never>> = {};

  private readonly root: HTMLElement;
  private readonly setNotice: (notice: string) => void;
  private readonly renderAll: () => void;
  private dockview: DockviewApi | undefined;
  private parkingLot: HTMLElement | undefined;
  private focusedPanel: PanelId | undefined = "tasks";
  private layoutVersion = 0;
  private internalMutationDepth = 0;
  private editorPanelsHiddenForRuntime = false;
  private readonly preservedPanelRemovals = new Set<PanelId>();
  private dockDragActive = false;
  private dockDragFinishTimer: number | undefined;
  private dockTitleDrag: DockTitleDrag | undefined;
  private readonly onDockDragFinished = () => this.finishDockDragSoon();
  private readonly onDockTitlePointerDown = (event: PointerEvent) => this.startDockTitleDrag(event);
  private readonly onDockTitlePointerMove = (event: PointerEvent) => this.updateDockTitleDrag(event);
  private readonly onDockTitlePointerUp = (event: PointerEvent) => this.finishDockTitleDragFromPoint(event.clientX, event.clientY);
  private readonly onDockTitlePointerCancel = () => this.cancelDockTitleDrag();
  private readonly onDockTitleDragMove = (event: DragEvent) => this.updateDockTitleDragFromNativeDrag(event);
  private readonly onDockTitleDragEnd = (event: DragEvent) => this.finishDockTitleDragFromNativeDrag(event);

  constructor(options: PanelLayoutControllerOptions) {
    this.root = options.root;
    this.setNotice = options.setNotice;
    this.renderAll = options.renderAll;
  }

  applyPanelSizes(): void {
    const dockview = this.ensureDockview();
    if (!dockview) return;

    this.syncRuntimeMode(dockview);
    this.applyPlacementDatasets();
    this.layoutDockview(dockview);
  }

  bringPanelToFront(panel: PanelId): void {
    this.restorePanel(panel);
  }

  frontPanel(): PanelId | undefined {
    return this.focusedPanel;
  }

  layoutSignature(): string {
    const runtimeMode = this.root.dataset.runtimeMode || "editor";
    return [
      runtimeMode,
      this.layoutVersion,
      ...panelOrder.map((panel) => `${panel}:${this.panelState[panel]}:${this.panelPlacement[panel]}:${this.hasDockPanel(panel) ? 1 : 0}`),
    ].join("|");
  }

  minimizePanel(panel: PanelId): void {
    this.panelState[panel] = "minimized";
    this.closeDockPanel(panel, { preserveState: true });
    if (this.focusedPanel === panel) this.focusedPanel = this.nextOpenPanel();
    this.applyPanelSizes();
  }

  closePanel(panel: PanelId): void {
    this.panelState[panel] = "closed";
    this.closeDockPanel(panel, { preserveState: true });
    if (this.focusedPanel === panel) this.focusedPanel = this.nextOpenPanel();
    this.applyPanelSizes();
  }

  restorePanel(panel: PanelId): void {
    this.panelState[panel] = "open";
    const dockPanel = this.ensureDockPanel(panel);
    if (dockPanel) {
      this.panelPlacement[panel] = dockPanel.api.location.type === "floating" ? "floating" : "docked";
      this.focusDockPanel(dockPanel);
    }
    this.focusedPanel = panel;
    this.applyPanelSizes();
  }

  centerPanel(panel: PanelId): void {
    this.panelState[panel] = "open";
    const dockview = this.ensureDockview();
    const dockPanel = this.ensureDockPanel(panel);
    if (!dockview || !dockPanel) return;

    this.withInternalMutation(() => {
      dockview.addFloatingGroup(dockPanel, this.centerFloatingDefaults(panel));
    });
    this.panelPlacement[panel] = "floating";
    this.focusedPanel = panel;
    this.layoutVersion += 1;
    this.applyPanelSizes();
  }

  isDraggingWindow(): boolean {
    return this.dockDragActive;
  }

  startWindowDrag(_event: PointerEvent): void {
    // Dockview owns panel dragging.
  }

  onWindowDragMove(_event: PointerEvent): void {
    // Dockview owns panel dragging.
  }

  stopWindowDrag(_event: PointerEvent): void {
    // Dockview owns panel dragging.
  }

  startPanelResize(_event: PointerEvent): void {
    // Dockview owns sash and floating-group resizing.
  }

  onPanelResizeMove(_event: PointerEvent): void {
    // Dockview owns sash and floating-group resizing.
  }

  stopPanelResize(_event: PointerEvent): void {
    // Dockview owns sash and floating-group resizing.
  }

  private ensureDockview(): DockviewApi | undefined {
    if (this.dockview) return this.dockview;

    const dockHost = this.dockHostElement();
    if (!dockHost) return undefined;

    this.parkingLot = this.createParkingLot();
    const dockview = createDockview(dockHost, {
      defaultTabComponent: dockTabName,
      dndEdges: dockEdgeDropOverlay,
      floatingGroupBounds: "boundedWithinViewport",
      noPanelsOverlay: "watermark",
      singleTabMode: dockSingleTabMode,
      tabAnimation: "smooth",
      theme: dockTheme,
      createComponent: (options) => new ExistingElementContentRenderer(this.root, this.parkingLot!, coerceDockContentId(options.id)),
      createTabComponent: () => new DockTabRenderer(),
      createWatermarkComponent: () => new EmptyWatermarkRenderer(),
    });
    this.dockview = dockview;
    this.bindDockviewEvents(dockview);
    this.layoutDockview(dockview);

    this.withInternalMutation(() => {
      for (const panel of panelOrder) {
        if (this.panelState[panel] === "open") this.ensureDockPanel(panel);
      }
    });
    this.layoutDockview(dockview);
    return dockview;
  }

  private bindDockviewEvents(dockview: DockviewApi): void {
    const ownerDocument = this.root.ownerDocument;
    ownerDocument.addEventListener("pointerdown", this.onDockTitlePointerDown, true);
    ownerDocument.addEventListener("pointermove", this.onDockTitlePointerMove, true);
    ownerDocument.addEventListener("pointerup", this.onDockTitlePointerUp, true);
    ownerDocument.addEventListener("pointercancel", this.onDockTitlePointerCancel, true);
    ownerDocument.addEventListener("dragover", this.onDockTitleDragMove, true);
    ownerDocument.addEventListener("dragend", this.onDockTitleDragEnd, true);
    ownerDocument.addEventListener("drop", this.onDockTitleDragEnd, true);
    ownerDocument.addEventListener("dragend", this.onDockDragFinished, true);
    ownerDocument.addEventListener("drop", this.onDockDragFinished, true);
    ownerDocument.addEventListener("pointerup", this.onDockDragFinished, true);
    ownerDocument.addEventListener("pointercancel", this.onDockDragFinished, true);
    dockview.onWillDragPanel(() => this.beginDockDrag());
    dockview.onWillDragGroup(() => this.beginDockDrag());
    dockview.onWillShowOverlay((event) => {
      if (isSelfReferentialDropTarget(event.getData(), event.group?.id, event.kind)) {
        event.preventDefault();
        return;
      }
      this.beginDockDrag();
    });
    dockview.onWillDrop((event) => {
      if (isSelfReferentialDropTarget(event.getData(), event.group?.id, event.kind)) event.preventDefault();
    });
    dockview.onDidDrop(() => this.finishDockDragSoon());
    dockview.onDidActivePanelChange((panel) => {
      const panelId = asPanelId(panel?.id);
      if (!panelId || !panel) return;
      this.focusedPanel = panelId;
      this.panelPlacement[panelId] = panel.api.location.type === "floating" ? "floating" : "docked";
      this.requestRender();
    });
    dockview.onDidRemovePanel((panel) => {
      const panelId = asPanelId(panel.id);
      if (!panelId) return;
      const preserved = this.preservedPanelRemovals.delete(panelId);
      if (!preserved && this.panelState[panelId] === "open") this.panelState[panelId] = "closed";
      if (this.focusedPanel === panelId) this.focusedPanel = this.nextOpenPanel();
      this.requestRender();
    });
    dockview.onDidAddPanel((panel) => {
      const panelId = asPanelId(panel.id);
      if (!panelId) return;
      this.panelState[panelId] = "open";
      this.panelPlacement[panelId] = panel.api.location.type === "floating" ? "floating" : "docked";
      this.requestRender();
    });
    dockview.onDidLayoutChange(() => {
      this.layoutVersion += 1;
      this.syncPanelPlacements(dockview);
    });
  }

  private startDockTitleDrag(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    if (!target || !this.isDockTitleDragTarget(target)) return;
    const panel = this.panelIdFromDockGroupTarget(target);
    if (!panel) return;
    const dockPanel = this.dockview?.getPanel(panel);
    if (!dockPanel || dockPanel.api.location.type !== "floating") return;

    this.dockTitleDrag = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      edge: undefined,
    };
    this.beginDockDrag();
  }

  private updateDockTitleDrag(event: PointerEvent): void {
    const drag = this.dockTitleDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.updateDockTitleDragPoint(event.clientX, event.clientY);
  }

  private updateDockTitleDragFromNativeDrag(event: DragEvent): void {
    if (!this.dockTitleDrag || !hasUsableClientPoint(event)) return;
    this.updateDockTitleDragPoint(event.clientX, event.clientY);
  }

  private updateDockTitleDragPoint(clientX: number, clientY: number): void {
    const drag = this.dockTitleDrag;
    if (!drag) return;
    drag.lastX = clientX;
    drag.lastY = clientY;
    drag.edge = this.dockEdgeAtClientPoint(clientX, clientY);
    this.updateDockEdgePreview(drag.edge);
  }

  private finishDockTitleDragFromPoint(clientX: number, clientY: number): void {
    if (!this.dockTitleDrag) return;
    this.updateDockTitleDragPoint(clientX, clientY);
    this.finishDockTitleDragSoon(false);
  }

  private finishDockTitleDragFromNativeDrag(event: DragEvent): void {
    if (!this.dockTitleDrag) return;
    if (hasUsableClientPoint(event)) this.updateDockTitleDragPoint(event.clientX, event.clientY);
    this.finishDockTitleDragSoon(false);
  }

  private finishDockTitleDragSoon(cancelled: boolean): void {
    this.ownerWindow().setTimeout(() => this.finishDockTitleDrag(cancelled), 0);
  }

  private cancelDockTitleDrag(): void {
    this.finishDockTitleDragSoon(true);
  }

  private finishDockTitleDrag(cancelled: boolean): void {
    const drag = this.dockTitleDrag;
    if (!drag) return;
    this.dockTitleDrag = undefined;
    this.updateDockEdgePreview(undefined);

    const moved = hasDockDragTravelled({ x: drag.startX, y: drag.startY }, { x: drag.lastX, y: drag.lastY });
    if (!cancelled && moved && drag.edge) this.dockFloatingPanelToEdge(drag.panel, drag.edge);
    this.finishDockDragSoon();
  }

  private dockFloatingPanelToEdge(panel: PanelId, edge: DockEdge): void {
    const dockPanel = this.dockview?.getPanel(panel);
    if (!dockPanel || dockPanel.api.location.type !== "floating") return;

    this.withInternalMutation(() => {
      dockPanel.api.group.api.moveTo({ position: edge });
    });
    this.focusedPanel = panel;
    this.panelPlacement[panel] = "docked";
    this.layoutVersion += 1;
    this.setNotice(`${dockDefaults[panel].title}已贴到${dockEdgeLabel(edge)}。`);
    this.applyPanelSizes();
    this.requestRender();
  }

  private dockEdgeAtClientPoint(clientX: number, clientY: number): DockEdge | undefined {
    const dockHost = this.dockHostElement();
    if (!dockHost) return undefined;
    const rect = dockHost.getBoundingClientRect();
    return resolveDockEdgeFromPoint({ x: clientX, y: clientY }, rect);
  }

  private updateDockEdgePreview(edge: DockEdge | undefined): void {
    const preview = this.root.querySelector<HTMLElement>('[data-role="snap-preview"]');
    const dockHost = this.dockHostElement();
    if (!preview || !dockHost || !edge) {
      if (preview) {
        preview.hidden = true;
        delete preview.dataset.edge;
      }
      return;
    }

    const rootRect = this.root.getBoundingClientRect();
    const hostRect = dockHost.getBoundingClientRect();
    const left = hostRect.left - rootRect.left;
    const top = hostRect.top - rootRect.top;
    const edgeSize = Math.max(42, dockEdgeDropOverlay.size?.value || 42);
    preview.hidden = false;
    preview.dataset.edge = edge;
    preview.style.left = `${Math.round(edge === "right" ? left + hostRect.width - edgeSize : left)}px`;
    preview.style.top = `${Math.round(edge === "bottom" ? top + hostRect.height - edgeSize : top)}px`;
    preview.style.width = `${Math.round(edge === "left" || edge === "right" ? edgeSize : hostRect.width)}px`;
    preview.style.height = `${Math.round(edge === "top" || edge === "bottom" ? edgeSize : hostRect.height)}px`;
  }

  private isDockTitleDragTarget(target: HTMLElement): boolean {
    if (target.closest("button, input, textarea, select, a, [data-panel-action]")) return false;
    return Boolean(target.closest(".v2-dock-host .dv-tabs-and-actions-container"));
  }

  private panelIdFromDockGroupTarget(target: HTMLElement): PanelId | undefined {
    const groupElement = target.closest<HTMLElement>(".dv-groupview");
    const content = groupElement?.querySelector<HTMLElement>("[data-dock-content]");
    return asPanelId(content?.dataset.dockContent);
  }

  private beginDockDrag(): void {
    const ownerWindow = this.ownerWindow();
    if (this.dockDragFinishTimer !== undefined) {
      ownerWindow.clearTimeout(this.dockDragFinishTimer);
      this.dockDragFinishTimer = undefined;
    }
    this.dockDragActive = true;
    this.root.dataset.dockDragging = "true";
    this.root.classList.add("is-dragging-window");
  }

  private finishDockDragSoon(): void {
    if (!this.dockDragActive) return;
    const ownerWindow = this.ownerWindow();
    if (this.dockDragFinishTimer !== undefined) ownerWindow.clearTimeout(this.dockDragFinishTimer);
    this.dockDragFinishTimer = ownerWindow.setTimeout(() => this.finishDockDrag(), 80);
  }

  private finishDockDrag(): void {
    const ownerWindow = this.ownerWindow();
    if (this.dockDragFinishTimer !== undefined) {
      ownerWindow.clearTimeout(this.dockDragFinishTimer);
      this.dockDragFinishTimer = undefined;
    }
    if (!this.dockDragActive) return;
    this.dockDragActive = false;
    delete this.root.dataset.dockDragging;
    this.root.classList.remove("is-dragging-window");
    this.syncPanelPlacements();
    this.applyPlacementDatasets();
    this.requestRender();
  }

  private ensureDockPanel(panel: PanelId): IDockviewPanel | undefined {
    const dockview = this.ensureDockview();
    if (!dockview) return undefined;
    const existing = dockview.getPanel(panel);
    if (existing) return existing;

    const defaults = dockDefaults[panel];
    return this.withInternalMutation(() =>
      dockview.addPanel({
        id: panel,
        title: defaults.title,
        component: dockComponentName,
        tabComponent: dockTabName,
        params: { panel, closable: true },
        minimumWidth: defaults.minimumWidth,
        minimumHeight: defaults.minimumHeight,
        initialWidth: defaults.initialWidth,
        initialHeight: defaults.initialHeight,
        renderer: "onlyWhenVisible",
        floating: this.initialFloatingPosition(panel),
      }),
    );
  }

  private initialFloatingPosition(panel: PanelId): { x: number; y: number; width: number; height: number } {
    const { width, height } = this.floatingSize(panel);
    const host = this.dockHostElement();
    const hostWidth = host?.clientWidth || window.innerWidth || 1200;
    const hostHeight = host?.clientHeight || window.innerHeight || 760;
    const rightX = Math.max(12, hostWidth - width - 14);
    const bottomY = Math.max(12, hostHeight - height - 14);
    const centeredX = Math.max(12, Math.round((hostWidth - width) / 2));
    const centeredY = Math.max(12, Math.round((hostHeight - height) / 2));
    const positionByPanel: Record<PanelId, { x: number; y: number }> = {
      scene: { x: 12, y: 12 },
      properties: { x: rightX, y: 12 },
      assets: { x: Math.max(12, Math.round(hostWidth * 0.34)), y: bottomY },
      library: { x: centeredX, y: centeredY },
      tasks: { x: rightX, y: Math.min(Math.max(12, 390), bottomY) },
      output: { x: centeredX, y: bottomY },
    };
    return { ...positionByPanel[panel], width, height };
  }

  private centerFloatingDefaults(panel: PanelId): { x: number; y: number; width: number; height: number } {
    const { width, height } = this.floatingSize(panel);
    const host = this.dockHostElement();
    const hostWidth = host?.clientWidth || window.innerWidth || 1200;
    const hostHeight = host?.clientHeight || window.innerHeight || 760;
    return {
      x: Math.max(12, Math.round((hostWidth - width) / 2)),
      y: Math.max(12, Math.round((hostHeight - height) / 2)),
      width,
      height,
    };
  }

  private floatingSize(panel: PanelId): { width: number; height: number } {
    const defaults = dockDefaults[panel];
    const host = this.dockHostElement();
    const hostWidth = host?.clientWidth || window.innerWidth || 1200;
    const hostHeight = host?.clientHeight || window.innerHeight || 760;
    return {
      width: Math.min(defaults.initialWidth, Math.max(defaults.minimumWidth, hostWidth - 80)),
      height: Math.min(defaults.initialHeight, Math.max(defaults.minimumHeight, hostHeight - 80)),
    };
  }

  private focusDockPanel(panel: IDockviewPanel): void {
    this.withInternalMutation(() => {
      this.dockview?.focus();
      panel.api.group.model.openPanel(panel);
      panel.api.group.model.setActive(true);
    });
  }

  private closeDockPanel(panel: PanelId, options?: { preserveState?: boolean }): void {
    const dockPanel = this.dockview?.getPanel(panel);
    if (!dockPanel) return;
    this.withInternalMutation(() => {
      if (options?.preserveState) this.preservedPanelRemovals.add(panel);
      this.dockview?.removePanel(dockPanel);
    });
  }

  private syncRuntimeMode(dockview: DockviewApi): void {
    const gameMode = this.root.dataset.runtimeMode === "game";
    if (gameMode === this.editorPanelsHiddenForRuntime) return;

    this.editorPanelsHiddenForRuntime = gameMode;
    if (gameMode) {
      this.withInternalMutation(() => {
        for (const panel of panelOrder) this.closeDockPanel(panel, { preserveState: true });
      });
      return;
    }

    this.withInternalMutation(() => {
      for (const panel of panelOrder) {
        if (this.panelState[panel] === "open") this.ensureDockPanel(panel);
      }
    });
    this.layoutDockview(dockview);
  }

  private applyPlacementDatasets(): void {
    this.root.dataset.scenePlacement = this.panelPlacement.scene;
    this.root.dataset.propertiesPlacement = this.panelPlacement.properties;
    this.root.dataset.assetsPlacement = this.panelPlacement.assets;
    this.root.dataset.libraryPlacement = this.panelPlacement.library;
    this.root.dataset.tasksPlacement = this.panelPlacement.tasks;
    this.root.dataset.outputPlacement = this.panelPlacement.output;
    this.root.dataset.leftSnap = "closed";
    this.root.dataset.rightSnap = "closed";
    this.root.dataset.topSnap = "closed";
    this.root.dataset.bottomSnap = "closed";
  }

  private layoutDockview(dockview: DockviewApi): void {
    const dockHost = this.dockHostElement();
    if (!dockHost) return;
    const width = dockHost.clientWidth || Math.max(360, window.innerWidth - 50);
    const height = dockHost.clientHeight || Math.max(240, window.innerHeight - 66);
    dockview.layout(width, height);
  }

  private syncPanelPlacements(dockview = this.dockview): void {
    if (!dockview) return;
    for (const panel of panelOrder) {
      const dockPanel = dockview.getPanel(panel);
      if (dockPanel) this.panelPlacement[panel] = dockPanel.api.location.type === "floating" ? "floating" : "docked";
    }
  }

  private ownerWindow(): Window {
    return this.root.ownerDocument.defaultView || window;
  }

  private hasDockPanel(panel: PanelId): boolean {
    return Boolean(this.dockview?.getPanel(panel));
  }

  private dockHostElement(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>('[data-role="dockview"]');
  }

  private createParkingLot(): HTMLElement {
    const existing = this.root.querySelector<HTMLElement>('[data-role="dockview-parking"]');
    if (existing) return existing;
    const parking = document.createElement("div");
    parking.className = "v2-dock-parking";
    parking.dataset.role = "dockview-parking";
    parking.hidden = true;
    this.root.append(parking);
    return parking;
  }

  private requestRender(): void {
    this.layoutVersion += 1;
    if (this.internalMutationDepth > 0) return;
    this.renderAll();
  }

  private withInternalMutation<T>(callback: () => T): T {
    this.internalMutationDepth += 1;
    try {
      return callback();
    } finally {
      this.internalMutationDepth -= 1;
    }
  }

  private nextOpenPanel(): PanelId | undefined {
    for (const panel of [...panelOrder].reverse()) {
      if (this.panelState[panel] === "open" && this.hasDockPanel(panel)) return panel;
    }
    return undefined;
  }
}

export function createFixedPanelLayout(
  panelState: Record<PanelId, PanelState>,
  panelPlacement: Record<PanelId, PanelPlacement> = defaultPanelPlacement(),
): FixedPanelLayout[] {
  return panelOrder.map((panel, index) => {
    const placement = panelPlacement[panel];
    const visible = panelState[panel] === "open";
    return {
      panel,
      area: panelAreas[panel],
      state: panelState[panel],
      placement,
      visible,
      docked: visible && placement === "docked",
      floating: visible && placement === "floating",
      order: index,
    };
  });
}

export function resolveStudioWorkspaceMode(width: number): StudioWorkspaceMode {
  if (width < 760) return "narrow";
  if (width < 1180) return "compact";
  return "desktop";
}

function defaultPanelPlacement(): Record<PanelId, PanelPlacement> {
  return {
    scene: "floating",
    properties: "floating",
    assets: "floating",
    library: "floating",
    tasks: "floating",
    output: "floating",
  };
}

function coerceDockContentId(value: string | undefined): DockContentId {
  return asPanelId(value) || "scene";
}

function asPanelId(value: string | undefined): PanelId | undefined {
  return panelOrder.includes(value as PanelId) ? (value as PanelId) : undefined;
}

export function hasDockDragTravelled(
  start: { x: number; y: number },
  end: { x: number; y: number },
  threshold = dockDragStartThreshold,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return dx * dx + dy * dy >= threshold * threshold;
}

export function resolveDockEdgeFromPoint(
  point: { x: number; y: number },
  rect: DockEdgeRect,
  threshold = dockEdgeSnapThreshold,
): DockEdge | undefined {
  const x = point.x - rect.left;
  const y = point.y - rect.top;
  if (x < -threshold || x > rect.width + threshold || y < -threshold || y > rect.height + threshold) return undefined;

  const distances: Array<{ edge: DockEdge; distance: number }> = [
    { edge: "left", distance: Math.abs(x) },
    { edge: "right", distance: Math.abs(rect.width - x) },
    { edge: "top", distance: Math.abs(y) },
    { edge: "bottom", distance: Math.abs(rect.height - y) },
  ];
  const nearest = distances.reduce((best, next) => (next.distance < best.distance ? next : best));
  return nearest.distance <= threshold ? nearest.edge : undefined;
}

function hasUsableClientPoint(event: DragEvent): boolean {
  return Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && (event.clientX !== 0 || event.clientY !== 0);
}

function dockEdgeLabel(edge: DockEdge): string {
  if (edge === "left") return "左侧";
  if (edge === "right") return "右侧";
  if (edge === "top") return "顶部";
  return "底部";
}

function isSelfReferentialDropTarget(
  transfer: PanelTransfer | undefined,
  targetGroupId: string | undefined,
  kind: DockviewGroupDropLocation,
): boolean {
  if (!transfer || !targetGroupId || transfer.groupId !== targetGroupId) return false;
  if (kind === "tab" || kind === "header_space") return false;
  return true;
}

class ExistingElementContentRenderer implements IContentRenderer {
  readonly element = document.createElement("div");
  private adoptedElement: HTMLElement | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly parkingLot: HTMLElement,
    private readonly contentId: DockContentId,
  ) {
    this.element.className = "v2-dock-panel-content";
    this.element.dataset.dockContent = contentId;
  }

  init(_params: GroupPanelPartInitParameters): void {
    const source = this.sourceElement();
    if (!source) return;
    this.adoptedElement = source;
    source.dataset.dockviewContent = this.contentId;
    this.element.replaceChildren(source);
  }

  layout(width: number, height: number): void {
    this.element.style.width = `${Math.max(0, Math.round(width))}px`;
    this.element.style.height = `${Math.max(0, Math.round(height))}px`;
  }

  dispose(): void {
    if (!this.adoptedElement) return;
    this.parkingLot.append(this.adoptedElement);
    this.adoptedElement = undefined;
  }

  private sourceElement(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`.v2-window[data-panel="${this.contentId}"]`);
  }
}

class EmptyWatermarkRenderer implements IWatermarkRenderer {
  readonly element = document.createElement("div");

  init(): void {
    this.element.className = "v2-dock-watermark";
  }

  dispose(): void {
    this.element.remove();
  }
}

class DockTabRenderer implements ITabRenderer {
  readonly element = document.createElement("div");
  private readonly titleElement = document.createElement("span");
  private readonly closeButton = document.createElement("button");
  private disposables: Array<() => void> = [];

  constructor() {
    this.element.className = "v2-dock-tab";
    this.titleElement.className = "v2-dock-tab-title";
    this.closeButton.className = "v2-dock-tab-close";
    this.closeButton.type = "button";
    this.closeButton.textContent = "x";
    this.element.append(this.titleElement, this.closeButton);
  }

  init(params: TabPartInitParameters): void {
    this.titleElement.textContent = params.title;
    this.closeButton.hidden = params.params?.closable === false;
    const titleDisposable = params.api.onDidTitleChange((event) => {
      this.titleElement.textContent = event.title;
    });
    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      params.api.close();
    };
    this.closeButton.addEventListener("pointerdown", onPointerDown);
    this.closeButton.addEventListener("click", onClick);
    this.disposables = [
      () => titleDisposable.dispose(),
      () => this.closeButton.removeEventListener("pointerdown", onPointerDown),
      () => this.closeButton.removeEventListener("click", onClick),
    ];
  }

  dispose(): void {
    for (const dispose of this.disposables) dispose();
    this.disposables = [];
  }
}
