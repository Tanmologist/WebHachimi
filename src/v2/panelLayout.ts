import {
  activateDockPanel,
  applyDockDrop,
  createDefaultDockingState,
  detectDockDropTarget,
  dockPanelOrder,
  removePanelsFromDockingState,
  resolveDockingRects,
  resolveStackActivePanels,
  targetDockEdge,
  type DockDropTarget,
  type DockEdge,
  type DockingState,
  type DockPanelId,
  type DockRect,
} from "./dockingLayout";

export type PanelId = DockPanelId;
export type PanelState = "open" | "minimized" | "closed";
export type ResizeTarget = "scene-width" | "right-width" | "properties-height" | "assets-height";
export type PanelDock = "float" | DockEdge;

export type FloatingPanelLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  dock: PanelDock;
};

export type PanelRect = DockRect;

export type DockedPanelLayout = {
  panel: PanelId;
  layout: FloatingPanelLayout;
};

type WindowDragState = {
  panel: PanelId;
  pointerId: number;
  startX: number;
  startY: number;
  layout: FloatingPanelLayout;
  previewTarget: DockDropTarget;
};

type PanelSizes = {
  sceneWidth: number;
  rightWidth: number;
  propertiesHeight: number;
  assetsHeight: number;
};

type PanelLayoutControllerOptions = {
  root: HTMLElement;
  setNotice: (notice: string) => void;
  renderAll: () => void;
};

const panelOrder: PanelId[] = [...dockPanelOrder];
const snapThreshold = 48;
const snapHysteresis = 18;
const dockGap = 1;
const minDockedPanelSpan = 120;
const minSideWidth = 180;
const minCenterSpan = 140;

export class PanelLayoutController {
  readonly panelState: Record<PanelId, PanelState> = {
    scene: "open",
    properties: "open",
    assets: "open",
    tasks: "open",
  };

  readonly panelSizes: PanelSizes = {
    sceneWidth: 300,
    rightWidth: 390,
    propertiesHeight: 220,
    assetsHeight: 150,
  };

  readonly panelWindows: Record<PanelId, FloatingPanelLayout> = {
    scene: { x: 10, y: 10, width: 300, height: 560, z: 11, dock: "left" },
    properties: { x: 700, y: 10, width: 390, height: 220, z: 12, dock: "right" },
    assets: { x: 700, y: 238, width: 390, height: 154, z: 13, dock: "float" },
    tasks: { x: 700, y: 400, width: 390, height: 420, z: 14, dock: "right" },
  };

  private windowDrag: WindowDragState | undefined;
  private dockingState: DockingState = createDefaultDockingState();
  private zCounter = 30;
  private defaultsAligned = false;
  private readonly root: HTMLElement;
  private readonly setNotice: (notice: string) => void;
  private readonly renderAll: () => void;

  constructor(options: PanelLayoutControllerOptions) {
    this.root = options.root;
    this.setNotice = options.setNotice;
    this.renderAll = options.renderAll;
  }

  applyPanelSizes(): void {
    this.alignDefaultWindows();
    const workspace = this.workspaceRect();
    const visibleState = this.visibleDockingState();
    const dockedRects = resolveDockingRects(visibleState, workspace);
    const activePanels = resolveStackActivePanels(visibleState);
    for (const panel of panelOrder) this.applyWindow(panel, dockedRects[panel], activePanels[panel]);
  }

  startWindowDrag(event: PointerEvent): void {
    if ((event.target as HTMLElement).closest("button, textarea, input, select, a")) return;
    const handle = event.currentTarget as HTMLElement;
    const panel = handle.dataset.windowDrag as PanelId | undefined;
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();
    const layout = this.currentFloatingLayout(panel);
    this.panelWindows[panel] = layout;
    this.bringPanelToFront(panel);
    this.windowDrag = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      layout: { ...layout },
      previewTarget: { kind: "float" },
    };
    handle.setPointerCapture(event.pointerId);
    this.root.classList.add("is-dragging-window");
    this.applyDockPreview(panel, { kind: "float" });
    this.applyWindow(panel);
  }

  onWindowDragMove(event: PointerEvent): void {
    if (!this.windowDrag || event.pointerId !== this.windowDrag.pointerId) return;
    event.preventDefault();
    const workspace = this.workspaceRect();
    const pointer = this.pointerInWorkspace(event);
    const dx = event.clientX - this.windowDrag.startX;
    const dy = event.clientY - this.windowDrag.startY;
    const layout = this.panelWindows[this.windowDrag.panel];
    const next = constrainWindowLayout(
      {
        ...layout,
        dock: "float",
        x: this.windowDrag.layout.x + dx,
        y: this.windowDrag.layout.y + dy,
      },
      workspace,
    );
    const visibleState = this.visibleDockingState();
    const rects = resolveDockingRects(visibleState, workspace);
    const previewTarget = this.normalizeUiDropTarget(
      detectDockDropTarget({
        pointer,
        state: visibleState,
        rects,
        workspace,
        draggedPanel: this.windowDrag.panel,
      }),
    );
    this.windowDrag.previewTarget = previewTarget;
    layout.dock = "float";
    layout.x = next.x;
    layout.y = next.y;
    layout.width = next.width;
    layout.height = next.height;
    this.applyDockPreview(this.windowDrag.panel, previewTarget, layout);
    this.applyWindow(this.windowDrag.panel);
  }

  stopWindowDrag(event: PointerEvent): void {
    if (!this.windowDrag || event.pointerId !== this.windowDrag.pointerId) return;
    const panel = this.windowDrag.panel;
    const target = this.normalizeUiDropTarget(this.windowDrag.previewTarget);
    const dock = this.dockForTarget(target);
    this.windowDrag = undefined;
    this.root.classList.remove("is-dragging-window");
    this.applyDockPreview(panel, { kind: "float" });
    const workspace = this.workspaceRect();
    const floatingLayout = constrainWindowLayout({ ...this.panelWindows[panel], dock: "float" }, workspace);
    this.dockingState = applyDockDrop({
      state: this.dockingState,
      panel,
      target,
      floatingRect: toDockRect(floatingLayout),
      workspace,
    });
    this.panelWindows[panel] = { ...floatingLayout, dock };
    this.bringPanelToFront(panel);
    this.setNotice(dock === "float" ? `${panelDisplayName(panel)}窗口已浮动。` : `${panelDisplayName(panel)}窗口已停靠到${dockDisplayName(dock)}。`);
    this.renderAll();
  }

  bringPanelToFront(panel: PanelId): void {
    this.dockingState = activateDockPanel(this.dockingState, panel);
    this.panelWindows[panel].z = ++this.zCounter;
  }

  isDraggingWindow(): boolean {
    return Boolean(this.windowDrag);
  }

  hasOpenRightPanel(): boolean {
    return this.panelState.properties === "open" || this.panelState.assets === "open" || this.panelState.tasks === "open";
  }

  startPanelResize(event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    const panel = handle.dataset.panelResize as PanelId | undefined;
    if (!panel) return;
    this.startWindowDrag(event);
  }

  onPanelResizeMove(_event: PointerEvent): void {
    return;
  }

  stopPanelResize(_event: PointerEvent): void {
    return;
  }

  private alignDefaultWindows(): void {
    if (this.defaultsAligned) return;
    const workspace = this.workspaceBounds();
    const rightX = Math.max(320, workspace.width - 400);
    this.panelWindows.properties.x = rightX;
    this.panelWindows.assets.x = rightX;
    this.panelWindows.tasks.x = rightX;
    this.panelWindows.scene.height = Math.max(360, workspace.height - 20);
    this.panelWindows.tasks.height = Math.max(280, workspace.height - this.panelWindows.tasks.y - 10);
    this.defaultsAligned = true;
  }

  private applyWindow(panel: PanelId, dockedRect?: PanelRect, activePanel?: PanelId): void {
    const element = this.root.querySelector<HTMLElement>(`.v2-window[data-panel="${panel}"]`);
    if (!element) return;
    if (activePanel && activePanel !== panel) {
      element.style.display = "none";
      return;
    }
    element.style.display = "";
    const workspace = this.workspaceRect();
    const current = this.panelWindows[panel];
    const floatingSource = this.dockingState.floating[panel];
    const layout = constrainWindowLayout(
      current.dock === "float" && floatingSource ? { ...current, ...floatingSource, dock: "float" } : current,
      workspace,
    );
    const rect = layout.dock === "float" ? layout : dockedRect || dockRect(layout.dock, workspace, layout);
    this.panelWindows[panel] = { ...layout, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    element.style.left = `${Math.round(rect.x)}px`;
    element.style.top = `${Math.round(rect.y)}px`;
    element.style.width = `${Math.round(rect.width)}px`;
    element.style.height = `${Math.round(rect.height)}px`;
    element.style.zIndex = String(layout.z);
    element.dataset.dock = layout.dock;
  }

  private currentFloatingLayout(panel: PanelId): FloatingPanelLayout {
    const layout = this.panelWindows[panel];
    const workspace = this.workspaceRect();
    if (layout.dock === "float") return constrainWindowLayout({ ...layout, dock: "float" }, workspace);
    const dockedRects = resolveDockingRects(this.visibleDockingState(), workspace);
    const rect = dockedRects[panel] || dockRect(layout.dock, workspace, layout);
    return constrainWindowLayout({ ...layout, ...rect, dock: "float" }, workspace);
  }

  private applyDockPreview(panel: PanelId, target: DockDropTarget, floatingLayout = this.panelWindows[panel]): void {
    const dock = this.dockForTarget(target);
    this.root.dataset.dockPreview = target.kind === "stack-center" ? "stack" : dock;
    const preview = this.root.querySelector<HTMLElement>(".v2-dock-preview");
    if (!preview) return;
    if (target.kind === "float" || dock === "float") {
      preview.removeAttribute("style");
      return;
    }
    const workspace = this.workspaceRect();
    const floatingRect = toDockRect(constrainWindowLayout({ ...floatingLayout, dock: "float" }, workspace));
    const committedState = applyDockDrop({
      state: this.dockingState,
      panel,
      target,
      floatingRect,
      workspace,
    });
    const visibleCommittedState = removePanelsFromDockingState(committedState, this.hiddenPanelIds());
    const rect = resolveDockingRects(visibleCommittedState, workspace)[panel] || dockRect(dock, workspace, this.panelWindows[panel]);
    preview.style.left = `${Math.round(rect.x)}px`;
    preview.style.top = `${Math.round(rect.y)}px`;
    preview.style.width = `${Math.round(rect.width)}px`;
    preview.style.height = `${Math.round(rect.height)}px`;
  }

  private visibleDockingState(): DockingState {
    return removePanelsFromDockingState(this.dockingState, this.hiddenPanelIds());
  }

  private hiddenPanelIds(): PanelId[] {
    return panelOrder.filter((panel) => this.panelState[panel] !== "open");
  }

  private normalizeUiDropTarget(target: DockDropTarget): DockDropTarget {
    return target;
  }

  private dockForTarget(target: DockDropTarget): PanelDock {
    if (target.kind === "stack-center") return this.panelWindows[target.panel]?.dock || "float";
    return targetDockEdge(target);
  }

  private pointerInWorkspace(event: PointerEvent): { x: number; y: number } {
    const workspace = this.root.querySelector<HTMLElement>(".v2-workspace");
    const rect = workspace?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left || 0),
      y: event.clientY - (rect?.top || 0),
    };
  }

  private workspaceBounds(): { width: number; height: number } {
    const workspace = this.root.querySelector<HTMLElement>(".v2-workspace");
    return {
      width: workspace?.clientWidth || 1200,
      height: workspace?.clientHeight || 760,
    };
  }

  private workspaceRect(): PanelRect {
    const bounds = this.workspaceBounds();
    return { x: 0, y: 0, width: bounds.width, height: bounds.height };
  }
}

export function constrainWindowLayout(
  layout: FloatingPanelLayout,
  workspace: { width: number; height: number },
): FloatingPanelLayout {
  const minWidth = 220;
  const minHeight = 120;
  const maxWidth = Math.max(minWidth, workspace.width - 20);
  const maxHeight = Math.max(minHeight, workspace.height - 20);
  const width = clamp(layout.width, minWidth, maxWidth);
  const height = clamp(layout.height, minHeight, maxHeight);
  return {
    ...layout,
    width,
    height,
    x: layout.x,
    y: layout.y,
  };
}

export function detectDockZone(
  pointer: { x: number; y: number },
  workspace: { width: number; height: number },
  previousDock: PanelDock = "float",
): PanelDock {
  const threshold = snapThreshold + (previousDock === "float" ? 0 : snapHysteresis);
  const dockCandidates: Array<{ dock: Exclude<PanelDock, "float">; distance: number }> = [
    { dock: "left", distance: pointer.x },
    { dock: "right", distance: workspace.width - pointer.x },
    { dock: "top", distance: pointer.y },
    { dock: "bottom", distance: workspace.height - pointer.y },
  ];
  const candidates = dockCandidates.filter((candidate) => candidate.distance >= -180 && candidate.distance <= threshold);

  if (!candidates.length) return "float";
  candidates.sort((left, right) => {
    const leftScore = left.distance < 0 ? 0 : left.distance;
    const rightScore = right.distance < 0 ? 0 : right.distance;
    if (leftScore !== rightScore) return leftScore - rightScore;
    if (left.dock === previousDock) return -1;
    if (right.dock === previousDock) return 1;
    return dockPriority(left.dock) - dockPriority(right.dock);
  });
  return candidates[0].dock;
}

export function dockRect(
  dock: PanelDock,
  workspace: { width: number; height: number },
  layout: FloatingPanelLayout,
): PanelRect {
  const sideWidth = clamp(layout.width, 220, Math.max(220, Math.min(460, Math.round(workspace.width * 0.34))));
  const bandHeight = clamp(layout.height, 150, Math.max(150, Math.min(360, Math.round(workspace.height * 0.42))));
  if (dock === "left") return { x: 0, y: 0, width: sideWidth, height: workspace.height };
  if (dock === "right") return { x: workspace.width - sideWidth, y: 0, width: sideWidth, height: workspace.height };
  if (dock === "top") return { x: 0, y: 0, width: workspace.width, height: bandHeight };
  if (dock === "bottom") return { x: 0, y: workspace.height - bandHeight, width: workspace.width, height: bandHeight };
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}

export function resolveDockedPanelRects(
  entries: DockedPanelLayout[],
  workspace: { width: number; height: number },
): Partial<Record<PanelId, PanelRect>> {
  const groups = {
    left: sortDockGroup(entries.filter((entry) => entry.layout.dock === "left"), "left"),
    right: sortDockGroup(entries.filter((entry) => entry.layout.dock === "right"), "right"),
    top: sortDockGroup(entries.filter((entry) => entry.layout.dock === "top"), "top"),
    bottom: sortDockGroup(entries.filter((entry) => entry.layout.dock === "bottom"), "bottom"),
  } satisfies Record<Exclude<PanelDock, "float">, DockedPanelLayout[]>;

  const verticalBands = allocateOpposingSpans({
    firstDesired: groups.top.length ? dockBandHeight(groups.top, workspace) : 0,
    secondDesired: groups.bottom.length ? dockBandHeight(groups.bottom, workspace) : 0,
    total: workspace.height,
    firstPresent: groups.top.length > 0,
    secondPresent: groups.bottom.length > 0,
    minimum: 120,
    reserve: minCenterSpan,
  });
  const sideY = verticalBands.first;
  const sideHeight = Math.max(80, workspace.height - verticalBands.first - verticalBands.second);
  const sideWidths = allocateOpposingSpans({
    firstDesired: groups.left.length ? dockSideWidth(groups.left, workspace) : 0,
    secondDesired: groups.right.length ? dockSideWidth(groups.right, workspace) : 0,
    total: workspace.width,
    firstPresent: groups.left.length > 0,
    secondPresent: groups.right.length > 0,
    minimum: minSideWidth,
    reserve: minCenterSpan,
  });
  const rects: Partial<Record<PanelId, PanelRect>> = {};

  assignHorizontalDockRects(rects, groups.top, workspace, 0, verticalBands.first);
  assignHorizontalDockRects(rects, groups.bottom, workspace, workspace.height - verticalBands.second, verticalBands.second);
  assignVerticalDockRects(rects, groups.left, workspace, 0, sideY, sideHeight, sideWidths.first);
  assignVerticalDockRects(rects, groups.right, workspace, workspace.width - sideWidths.second, sideY, sideHeight, sideWidths.second);
  return rects;
}

export function resolveDockPreviewRect(input: {
  panel: PanelId;
  dock: PanelDock;
  layout: FloatingPanelLayout;
  entries: DockedPanelLayout[];
  workspace: { width: number; height: number };
}): PanelRect | undefined {
  if (input.dock === "float") return undefined;
  const entries = input.entries.filter((entry) => entry.panel !== input.panel && entry.layout.dock !== "float");
  const candidateLayout = constrainWindowLayout({ ...input.layout, dock: input.dock }, input.workspace);
  const rects = resolveDockedPanelRects([...entries, { panel: input.panel, layout: candidateLayout }], input.workspace);
  return rects[input.panel];
}

function assignVerticalDockRects(
  rects: Partial<Record<PanelId, PanelRect>>,
  group: DockedPanelLayout[],
  workspace: { width: number; height: number },
  x: number,
  y: number,
  height: number,
  width = dockSideWidth(group, workspace),
): void {
  if (group.length === 0 || width <= 0 || height <= 0) return;
  const spans = distributeDockSpans(
    Math.max(0, height - dockGap * (group.length - 1)),
    group.map((entry) => entry.layout.height),
  );
  let cursor = y;
  group.forEach((entry, index) => {
    rects[entry.panel] = { x, y: cursor, width, height: spans[index] };
    cursor += spans[index] + dockGap;
  });
}

function assignHorizontalDockRects(
  rects: Partial<Record<PanelId, PanelRect>>,
  group: DockedPanelLayout[],
  workspace: { width: number; height: number },
  y: number,
  height: number,
): void {
  if (group.length === 0 || height <= 0) return;
  const spans = distributeDockSpans(
    Math.max(0, workspace.width - dockGap * (group.length - 1)),
    group.map((entry) => entry.layout.width),
  );
  let cursor = 0;
  group.forEach((entry, index) => {
    rects[entry.panel] = { x: cursor, y, width: spans[index], height };
    cursor += spans[index] + dockGap;
  });
}

function dockSideWidth(group: DockedPanelLayout[], workspace: { width: number; height: number }): number {
  if (group.length === 0) return 0;
  return Math.max(...group.map((entry) => dockRect(entry.layout.dock, workspace, entry.layout).width));
}

function dockBandHeight(group: DockedPanelLayout[], workspace: { width: number; height: number }): number {
  if (group.length === 0) return 0;
  return Math.max(...group.map((entry) => dockRect(entry.layout.dock, workspace, entry.layout).height));
}

function distributeDockSpans(total: number, desiredSpans: number[]): number[] {
  if (desiredSpans.length === 0) return [];
  const minimum = Math.min(minDockedPanelSpan, total / desiredSpans.length);
  const base = desiredSpans.map(() => minimum);
  let remaining = Math.max(0, total - minimum * desiredSpans.length);
  const weights = desiredSpans.map((span) => Math.max(1, span - minimum));
  const weightTotal = weights.reduce((sum, span) => sum + span, 0) || desiredSpans.length;
  return base.map((span, index) => {
    if (index === base.length - 1) return span + remaining;
    const extra = (remaining * weights[index]) / weightTotal;
    remaining -= extra;
    return span + extra;
  });
}

function allocateOpposingSpans(input: {
  firstDesired: number;
  secondDesired: number;
  total: number;
  firstPresent: boolean;
  secondPresent: boolean;
  minimum: number;
  reserve: number;
}): { first: number; second: number } {
  if (!input.firstPresent && !input.secondPresent) return { first: 0, second: 0 };

  const first = input.firstPresent ? input.firstDesired : 0;
  const second = input.secondPresent ? input.secondDesired : 0;
  const presentCount = Number(input.firstPresent) + Number(input.secondPresent);
  const usable = Math.max(0, input.total - input.reserve);
  const minimum = Math.min(input.minimum, presentCount ? usable / presentCount : 0);
  const desiredTotal = first + second;
  if (desiredTotal <= usable) return { first, second };

  let remaining = Math.max(0, usable - (input.firstPresent ? minimum : 0) - (input.secondPresent ? minimum : 0));
  let nextFirst = input.firstPresent ? minimum : 0;
  let nextSecond = input.secondPresent ? minimum : 0;
  const firstWeight = input.firstPresent ? Math.max(1, first - minimum) : 0;
  const secondWeight = input.secondPresent ? Math.max(1, second - minimum) : 0;
  const weightTotal = firstWeight + secondWeight || 1;
  nextFirst += remaining * (firstWeight / weightTotal);
  remaining -= remaining * (firstWeight / weightTotal);
  nextSecond += remaining;
  return { first: nextFirst, second: nextSecond };
}

function sortDockGroup(group: DockedPanelLayout[], dock: Exclude<PanelDock, "float">): DockedPanelLayout[] {
  const axis = dock === "left" || dock === "right" ? "y" : "x";
  return [...group].sort((left, right) => {
    const delta = left.layout[axis] - right.layout[axis];
    if (delta !== 0) return delta;
    return panelOrder.indexOf(left.panel) - panelOrder.indexOf(right.panel);
  });
}

function dockPriority(dock: Exclude<PanelDock, "float">): number {
  return ({ left: 0, right: 1, top: 2, bottom: 3 } satisfies Record<Exclude<PanelDock, "float">, number>)[dock];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function toDockRect(layout: FloatingPanelLayout): DockRect {
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}

function panelDisplayName(panel: PanelId): string {
  return ({ scene: "层级", properties: "检查器", assets: "资源", tasks: "任务" } satisfies Record<PanelId, string>)[panel];
}

function dockDisplayName(dock: PanelDock): string {
  return ({ float: "浮动区", left: "左侧", right: "右侧", top: "上侧", bottom: "下侧" } satisfies Record<PanelDock, string>)[dock];
}
