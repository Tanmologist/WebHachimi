import {
  createDockview,
  type DockviewApi,
  type GroupPanelPartInitParameters,
  type IContentRenderer,
  type IDockviewPanel,
  type ITabRenderer,
  type IWatermarkRenderer,
  type PanelTransfer,
  type TabPartInitParameters,
} from "dockview-core";

export type PanelId = "scene" | "properties" | "assets" | "library" | "tasks" | "output";
type DockviewGroupDropLocation = "tab" | "header_space" | "content" | "edge";
export type PanelState = "open" | "minimized" | "closed";
export type PanelPlacement = "docked" | "floating";
export type PanelDock = PanelPlacement;
export type ResizeTarget = "dockview";

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

const panelOrder: PanelId[] = ["scene", "properties", "assets", "library", "tasks", "output"];
const dockComponentName = "webhachimi-panel";
const dockTabName = "webhachimi-tab";

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
    return false;
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
      dndEdges: false,
      floatingGroupBounds: "boundedWithinViewport",
      noPanelsOverlay: "watermark",
      singleTabMode: "default",
      tabAnimation: "smooth",
      createComponent: (options) => new ExistingElementContentRenderer(this.root, this.parkingLot!, coerceDockContentId(options.id)),
      createTabComponent: () => new DockTabRenderer(),
      createWatermarkComponent: () => new EmptyWatermarkRenderer(),
    });
    this.dockview = dockview;
    this.bindDockviewEvents(dockview);

    this.withInternalMutation(() => {
      for (const panel of panelOrder) {
        if (this.panelState[panel] === "open") this.ensureDockPanel(panel);
      }
    });
    this.layoutDockview(dockview);
    return dockview;
  }

  private bindDockviewEvents(dockview: DockviewApi): void {
    dockview.onWillShowOverlay((event) => {
      if (isSelfReferentialDropTarget(event.getData(), event.group?.id, event.kind)) event.preventDefault();
    });
    dockview.onWillDrop((event) => {
      if (isSelfReferentialDropTarget(event.getData(), event.group?.id, event.kind)) event.preventDefault();
    });
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
      for (const panel of panelOrder) {
        const dockPanel = dockview.getPanel(panel);
        if (dockPanel) this.panelPlacement[panel] = dockPanel.api.location.type === "floating" ? "floating" : "docked";
      }
    });
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
