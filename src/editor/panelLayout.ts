export type PanelId = "scene" | "properties" | "assets" | "library" | "tasks" | "output";
export type PanelState = "open" | "minimized" | "closed";
export type PanelPlacement = "removed";
export type ResizeTarget = "none";

export type FixedPanelLayout = {
  panel: PanelId;
  area: "removed";
  state: PanelState;
  placement: PanelPlacement;
  visible: false;
  docked: false;
  floating: false;
  order: number;
};

export type StudioWorkspaceMode = "headless";

type PanelLayoutControllerOptions = {
  root: HTMLElement;
  setNotice: (notice: string) => void;
  renderAll: () => void;
  renderUi?: () => void;
};

const panelOrder: PanelId[] = ["scene", "properties", "assets", "library", "tasks", "output"];

export class PanelLayoutController {
  readonly panelState: Record<PanelId, PanelState> = closedPanelState();
  readonly panelPlacement: Record<PanelId, PanelPlacement> = removedPanelPlacement();
  readonly panelSnaps: Partial<Record<PanelId, never>> = {};

  private layoutVersion = 0;

  constructor(private readonly options: PanelLayoutControllerOptions) {
    this.options.root.hidden = false;
    this.options.root.removeAttribute("aria-hidden");
  }

  applyPanelSizes(): void {
    this.options.root.hidden = false;
    this.options.root.dataset.ui = "workbench-preview";
  }

  bringPanelToFront(_panel: PanelId): void {
    this.bump();
  }

  frontPanel(): PanelId | undefined {
    return undefined;
  }

  layoutSignature(): string {
    return `headless:${this.layoutVersion}`;
  }

  minimizePanel(panel: PanelId): void {
    this.panelState[panel] = "closed";
    this.bump();
  }

  closePanel(panel: PanelId): void {
    this.panelState[panel] = "closed";
    this.bump();
  }

  restorePanel(panel: PanelId): void {
    this.panelState[panel] = "closed";
    this.bump();
  }

  centerPanel(panel: PanelId): void {
    this.panelState[panel] = "closed";
    this.bump();
  }

  isDraggingWindow(): boolean {
    return false;
  }

  startWindowDrag(_event: PointerEvent): void {}
  onWindowDragMove(_event: PointerEvent): void {}
  stopWindowDrag(_event: PointerEvent): void {}
  startPanelResize(_event: PointerEvent): void {}
  onPanelResizeMove(_event: PointerEvent): void {}
  stopPanelResize(_event: PointerEvent): void {}

  private bump(): void {
    this.layoutVersion += 1;
    this.applyPanelSizes();
  }
}

export function createFixedPanelLayout(
  panelState: Record<PanelId, PanelState>,
  _panelPlacement: Record<PanelId, PanelPlacement> = removedPanelPlacement(),
): FixedPanelLayout[] {
  return panelOrder.map((panel, order) => ({
    panel,
    area: "removed",
    state: panelState[panel] || "closed",
    placement: "removed",
    visible: false,
    docked: false,
    floating: false,
    order,
  }));
}

export function resolveStudioWorkspaceMode(_width: number): StudioWorkspaceMode {
  return "headless";
}

function closedPanelState(): Record<PanelId, PanelState> {
  return {
    scene: "closed",
    properties: "closed",
    assets: "closed",
    library: "closed",
    tasks: "closed",
    output: "closed",
  };
}

function removedPanelPlacement(): Record<PanelId, PanelPlacement> {
  return {
    scene: "removed",
    properties: "removed",
    assets: "removed",
    library: "removed",
    tasks: "removed",
    output: "removed",
  };
}
