export type DockPanelId = "scene" | "properties" | "assets" | "tasks";
export type DockEdge = "left" | "right" | "top" | "bottom";
export type DockSplitDirection = "row" | "column";

export type DockRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DockStackNode = {
  type: "stack";
  active: DockPanelId;
  panels: DockPanelId[];
};

export type DockSplitNode = {
  type: "split";
  direction: DockSplitDirection;
  sizes: number[];
  children: DockNode[];
};

export type DockEmptyNode = {
  type: "empty";
};

export type DockNode = DockStackNode | DockSplitNode | DockEmptyNode;

export type DockingState = {
  root: DockNode;
  floating: Partial<Record<DockPanelId, DockRect>>;
};

export type DockDropTarget =
  | { kind: "float" }
  | { kind: "root-edge"; edge: DockEdge }
  | { kind: "panel-edge"; panel: DockPanelId; edge: DockEdge }
  | { kind: "stack-center"; panel: DockPanelId };

export type DockDropPreview = {
  target: DockDropTarget;
  rect?: DockRect;
};

export const dockPanelOrder: DockPanelId[] = ["scene", "properties", "assets", "tasks"];

const rootDropThreshold = 48;
const rootOutsideDropThreshold = 180;
const splitGap = 1;

export function createDefaultDockingState(): DockingState {
  return {
    root: splitNode("row", [300, 420, 390], [
      stackNode("scene"),
      { type: "empty" },
      splitNode("column", [220, 420], [stackNode("properties"), stackNode("tasks")]),
    ]),
    floating: {
      assets: { x: 700, y: 238, width: 390, height: 154 },
    },
  };
}

export function stackNode(panel: DockPanelId): DockStackNode {
  return { type: "stack", active: panel, panels: [panel] };
}

export function splitNode(direction: DockSplitDirection, sizes: number[], children: DockNode[]): DockSplitNode {
  return { type: "split", direction, sizes: normalizeSizes(sizes, children.length), children };
}

export function resolveDockingRects(state: DockingState, workspace: DockRect): Partial<Record<DockPanelId, DockRect>> {
  const rects: Partial<Record<DockPanelId, DockRect>> = {};
  assignNodeRects(state.root, workspace, rects);
  const dockedPanels = collectPanelsInNode(state.root);
  for (const [panel, rect] of Object.entries(state.floating) as Array<[DockPanelId, DockRect | undefined]>) {
    if (rect && !dockedPanels.has(panel)) rects[panel] = rect;
  }
  return rects;
}

export function detectDockDropTarget(input: {
  pointer: { x: number; y: number };
  state: DockingState;
  rects: Partial<Record<DockPanelId, DockRect>>;
  workspace: DockRect;
  draggedPanel: DockPanelId;
}): DockDropTarget {
  const dockedRects: Partial<Record<DockPanelId, DockRect>> = {};
  for (const panel of dockPanelOrder) {
    if (isPanelInDockTree(input.state.root, panel)) dockedRects[panel] = input.rects[panel];
  }
  const panelTarget = panelEdgeTarget(input.pointer, dockedRects, input.draggedPanel);
  if (panelTarget) return panelTarget;

  const rootEdge = rootEdgeTarget(input.pointer, input.workspace);
  if (rootEdge) return { kind: "root-edge", edge: rootEdge };

  return { kind: "float" };
}

export function previewDockDrop(input: {
  state: DockingState;
  panel: DockPanelId;
  target: DockDropTarget;
  floatingRect: DockRect;
  workspace: DockRect;
}): DockDropPreview {
  if (input.target.kind === "float") return { target: input.target, rect: input.floatingRect };
  const next = applyDockDrop(input);
  const rect = resolveDockingRects(next, input.workspace)[input.panel];
  return { target: input.target, rect };
}

export function applyDockDrop(input: {
  state: DockingState;
  panel: DockPanelId;
  target: DockDropTarget;
  floatingRect: DockRect;
  workspace?: DockRect;
}): DockingState {
  const floating = { ...input.state.floating };
  delete floating[input.panel];

  const rootWithoutPanel = pruneEmpty(removePanelFromNode(input.state.root, input.panel));
  if (input.target.kind === "float") {
    return {
      root: rootWithoutPanel,
      floating: {
        ...floating,
        [input.panel]: input.floatingRect,
      },
    };
  }

  if (input.target.kind === "root-edge") {
    return {
      root: insertAtRootEdge(rootWithoutPanel, input.panel, input.target.edge, input.floatingRect, input.workspace),
      floating,
    };
  }

  if (input.target.kind === "panel-edge") {
    if (!isPanelInDockTree(rootWithoutPanel, input.target.panel)) {
      return {
        root: rootWithoutPanel,
        floating: {
          ...floating,
          [input.panel]: input.floatingRect,
        },
      };
    }
    return {
      root: pruneEmpty(insertAtPanelEdge(rootWithoutPanel, input.panel, input.target.panel, input.target.edge, input.floatingRect, input.workspace)),
      floating,
    };
  }

  if (!isPanelInDockTree(rootWithoutPanel, input.target.panel)) {
    return {
      root: rootWithoutPanel,
      floating: {
        ...floating,
        [input.panel]: input.floatingRect,
      },
    };
  }
  return {
    root: pruneEmpty(insertIntoStackCenter(rootWithoutPanel, input.panel, input.target.panel)),
    floating,
  };
}

export function targetDockEdge(target: DockDropTarget): DockEdge | "float" {
  if (target.kind === "root-edge" || target.kind === "panel-edge") return target.edge;
  return "float";
}

export function activateDockPanel(state: DockingState, panel: DockPanelId): DockingState {
  return {
    root: activatePanelInNode(state.root, panel),
    floating: { ...state.floating },
  };
}

export function resolveStackActivePanels(state: DockingState): Partial<Record<DockPanelId, DockPanelId>> {
  const activePanels: Partial<Record<DockPanelId, DockPanelId>> = {};
  assignStackActivePanels(state.root, activePanels);
  return activePanels;
}

export function isPanelInDockTree(node: DockNode, panel: DockPanelId): boolean {
  if (node.type === "stack") return node.panels.includes(panel);
  if (node.type === "split") return node.children.some((child) => isPanelInDockTree(child, panel));
  return false;
}

export function removePanelsFromDockingState(state: DockingState, panels: DockPanelId[]): DockingState {
  if (!panels.length) return state;
  const hidden = new Set(panels);
  let root = state.root;
  for (const panel of hidden) root = removePanelFromNode(root, panel);
  const floating = { ...state.floating };
  for (const panel of hidden) delete floating[panel];
  return {
    root: pruneEmpty(root),
    floating,
  };
}

function assignNodeRects(node: DockNode, rect: DockRect, rects: Partial<Record<DockPanelId, DockRect>>): void {
  if (node.type === "empty") return;
  if (node.type === "stack") {
    for (const panel of node.panels) rects[panel] = rect;
    return;
  }

  const spans = distributeSpans(node.direction === "row" ? rect.width : rect.height, node.sizes, node.children.length);
  let cursor = node.direction === "row" ? rect.x : rect.y;
  node.children.forEach((child, index) => {
    const span = spans[index];
    const childRect =
      node.direction === "row"
        ? { x: cursor, y: rect.y, width: span, height: rect.height }
        : { x: rect.x, y: cursor, width: rect.width, height: span };
    assignNodeRects(child, childRect, rects);
    cursor += span + splitGap;
  });
}

function collectPanelsInNode(node: DockNode, panels = new Set<DockPanelId>()): Set<DockPanelId> {
  if (node.type === "stack") {
    for (const panel of node.panels) panels.add(panel);
  }
  if (node.type === "split") {
    for (const child of node.children) collectPanelsInNode(child, panels);
  }
  return panels;
}

function rootEdgeTarget(pointer: { x: number; y: number }, workspace: DockRect): DockEdge | undefined {
  const left = workspace.x;
  const right = workspace.x + workspace.width;
  const top = workspace.y;
  const bottom = workspace.y + workspace.height;
  const edgeDistances: Array<{ edge: DockEdge; distance: number; insideCrossAxis: boolean }> = [
    { edge: "left", distance: pointer.x - left, insideCrossAxis: inExtendedRange(pointer.y, top, bottom) },
    { edge: "right", distance: right - pointer.x, insideCrossAxis: inExtendedRange(pointer.y, top, bottom) },
    { edge: "top", distance: pointer.y - top, insideCrossAxis: inExtendedRange(pointer.x, left, right) },
    { edge: "bottom", distance: bottom - pointer.y, insideCrossAxis: inExtendedRange(pointer.x, left, right) },
  ];
  const candidates = edgeDistances.filter(
    (candidate) =>
      candidate.insideCrossAxis &&
      candidate.distance <= rootDropThreshold &&
      candidate.distance >= -rootOutsideDropThreshold,
  );
  if (!candidates.length) return undefined;
  candidates.sort((leftCandidate, rightCandidate) => edgeScore(leftCandidate.distance) - edgeScore(rightCandidate.distance));
  return candidates[0].edge;
}

function edgeScore(distance: number): number {
  return distance < 0 ? 0 : distance;
}

function inExtendedRange(value: number, start: number, end: number): boolean {
  return value >= start - rootOutsideDropThreshold && value <= end + rootOutsideDropThreshold;
}

function panelEdgeTarget(
  pointer: { x: number; y: number },
  rects: Partial<Record<DockPanelId, DockRect>>,
  draggedPanel: DockPanelId,
): DockDropTarget | undefined {
  for (const panel of dockPanelOrder) {
    if (panel === draggedPanel) continue;
    const rect = rects[panel];
    if (!rect || !pointInside(pointer, rect)) continue;

    return { kind: "panel-edge", panel, edge: splitEdgeForPoint(pointer, rect) };
  }
  return undefined;
}

function splitEdgeForPoint(pointer: { x: number; y: number }, rect: DockRect): DockEdge {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const dx = pointer.x - centerX;
  const dy = pointer.y - centerY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "top" : "bottom";
}

function pointInside(point: { x: number; y: number }, rect: DockRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function insertAtRootEdge(root: DockNode, panel: DockPanelId, edge: DockEdge, rect: DockRect, workspace?: DockRect): DockNode {
  const direction: DockSplitDirection = edge === "left" || edge === "right" ? "row" : "column";
  const panelSize = preferredDockInsertSize(edge, rect, workspace);
  const panelStack = stackNode(panel);
  if (root.type === "split" && root.direction === direction) {
    const children = edge === "left" || edge === "top" ? [panelStack, ...root.children] : [...root.children, panelStack];
    const sizes = edge === "left" || edge === "top" ? [panelSize, ...root.sizes] : [...root.sizes, panelSize];
    return splitNode(direction, sizes, children);
  }
  return edge === "left" || edge === "top"
    ? splitNode(direction, [panelSize, 1], [panelStack, root])
    : splitNode(direction, [1, panelSize], [root, panelStack]);
}

function insertAtPanelEdge(
  root: DockNode,
  panel: DockPanelId,
  targetPanel: DockPanelId,
  edge: DockEdge,
  rect: DockRect,
  workspace?: DockRect,
): DockNode {
  const direction: DockSplitDirection = edge === "left" || edge === "right" ? "row" : "column";
  const panelSize = preferredDockInsertSize(edge, rect, workspace);
  const newStack = stackNode(panel);

  function visit(node: DockNode): DockNode {
    if (node.type === "stack" && node.panels.includes(targetPanel)) {
      const children = edge === "left" || edge === "top" ? [newStack, node] : [node, newStack];
      const sizes = edge === "left" || edge === "top" ? [panelSize, panelSize] : [panelSize, panelSize];
      return splitNode(direction, sizes, children);
    }
    if (node.type !== "split") return node;
    return splitNode(node.direction, node.sizes, node.children.map(visit));
  }

  return visit(root);
}

function preferredDockInsertSize(edge: DockEdge, rect: DockRect, workspace?: DockRect): number {
  if (edge === "left" || edge === "right") {
    const max = workspace ? Math.max(220, Math.min(460, Math.round(workspace.width * 0.42))) : 460;
    return clamp(rect.width, 220, max);
  }
  const max = workspace ? Math.max(150, Math.min(360, Math.round(workspace.height * 0.42))) : 360;
  return clamp(rect.height, 150, max);
}

function insertIntoStackCenter(root: DockNode, panel: DockPanelId, targetPanel: DockPanelId): DockNode {
  function visit(node: DockNode): DockNode {
    if (node.type === "stack" && node.panels.includes(targetPanel)) {
      return {
        type: "stack",
        active: panel,
        panels: [...node.panels.filter((item) => item !== panel), panel],
      };
    }
    if (node.type !== "split") return node;
    return splitNode(node.direction, node.sizes, node.children.map(visit));
  }

  return visit(root);
}

function activatePanelInNode(node: DockNode, panel: DockPanelId): DockNode {
  if (node.type === "stack") {
    return node.panels.includes(panel) ? { ...node, active: panel } : node;
  }
  if (node.type !== "split") return node;
  return splitNode(node.direction, node.sizes, node.children.map((child) => activatePanelInNode(child, panel)));
}

function assignStackActivePanels(node: DockNode, activePanels: Partial<Record<DockPanelId, DockPanelId>>): void {
  if (node.type === "stack") {
    for (const panel of node.panels) activePanels[panel] = node.active;
    return;
  }
  if (node.type === "split") {
    for (const child of node.children) assignStackActivePanels(child, activePanels);
  }
}

function removePanelFromNode(node: DockNode, panel: DockPanelId): DockNode {
  if (node.type === "empty") return node;
  if (node.type === "stack") {
    const panels = node.panels.filter((item) => item !== panel);
    if (!panels.length) return { type: "empty" };
    return { type: "stack", active: panels.includes(node.active) ? node.active : panels[0], panels };
  }
  return splitNode(node.direction, node.sizes, node.children.map((child) => removePanelFromNode(child, panel)));
}

function pruneEmpty(node: DockNode): DockNode {
  if (node.type !== "split") return node;
  const pairs = node.children
    .map((child, index) => ({ child: pruneEmpty(child), size: node.sizes[index] ?? 1 }))
    .filter((pair) => pair.child.type !== "empty");
  const children = pairs.map((pair) => pair.child);
  const sizes = pairs.map((pair) => pair.size);
  if (children.length === 0) return { type: "empty" };
  if (children.length === 1) return children[0];
  return splitNode(node.direction, sizes, children);
}

function distributeSpans(total: number, sizes: number[], count: number): number[] {
  if (count <= 0) return [];
  const available = Math.max(0, total - splitGap * (count - 1));
  const normalized = normalizeSizes(sizes, count);
  const weightTotal = normalized.reduce((sum, size) => sum + Math.max(0.001, size), 0);
  let remaining = available;
  return normalized.map((size, index) => {
    if (index === count - 1) return remaining;
    const span = available * (Math.max(0.001, size) / weightTotal);
    remaining -= span;
    return span;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function normalizeSizes(sizes: number[], count: number): number[] {
  return Array.from({ length: count }, (_item, index) => Math.max(0.001, sizes[index] ?? 1));
}
