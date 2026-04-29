import {
  createFixedPanelLayout,
  dockDragStartThreshold,
  dockEdgeSnapHeightRatio,
  dockEdgeSnapMargin,
  dockEdgeSnapThreshold,
  dockEdgeSnapWidthRatio,
  dockSingleTabMode,
  dockTheme,
  hasDockDragTravelled,
  resolveDockEdgeFromPoint,
  resolveDockEdgeSnapRect,
  resolveStudioWorkspaceMode,
  type FixedPanelLayout,
  type PanelId,
  type PanelPlacement,
  type PanelState,
} from "../v2/panelLayout";

const openState: Record<PanelId, PanelState> = {
  scene: "open",
  properties: "open",
  assets: "open",
  library: "closed",
  tasks: "open",
  output: "closed",
};

const layout = createFixedPanelLayout(openState);
assertPanel(layout, "scene", "scene", true, "floating", 0);
assertPanel(layout, "properties", "properties", true, "floating", 1);
assertPanel(layout, "assets", "assets", true, "floating", 2);
assertPanel(layout, "library", "dock", false, "floating", 3);
assertPanel(layout, "tasks", "tasks", true, "floating", 4);
assertPanel(layout, "output", "dock", false, "floating", 5);
assert(layout.filter((panel) => panel.visible).length === 4, "core studio panels should start visible");
assert(layout.filter((panel) => panel.floating).length === 4, "visible default panels should float over the fixed canvas");

const floatingPlacement: Record<PanelId, PanelPlacement> = {
  scene: "floating",
  properties: "floating",
  assets: "floating",
  library: "floating",
  tasks: "floating",
  output: "floating",
};
const explicitLayout = createFixedPanelLayout(openState, floatingPlacement);
assertPanel(explicitLayout, "library", "dock", false, "floating", 3);
assertPanel(explicitLayout, "output", "dock", false, "floating", 5);

assert(resolveStudioWorkspaceMode(1440) === "desktop", "wide workspace should use desktop layout");
assert(resolveStudioWorkspaceMode(1179) === "compact", "medium workspace should use compact layout");
assert(resolveStudioWorkspaceMode(759) === "narrow", "small workspace should use narrow layout");
assert(dockSingleTabMode === "fullwidth", "single-panel floating window titles should be draggable dock tabs");
assert(dockTheme.dndOverlayMounting === "absolute", "dock drag overlays should mount at stable viewport coordinates");
assert(resolveDockEdgeFromPoint({ x: 1001, y: 320 }, { left: 20, top: 40, width: 980, height: 700 }) === "right", "right edge release should dock to the right");
assert(resolveDockEdgeFromPoint({ x: 22, y: 320 }, { left: 20, top: 40, width: 980, height: 700 }) === "left", "left edge release should dock to the left");
assert(resolveDockEdgeFromPoint({ x: 400, y: 48 }, { left: 20, top: 40, width: 980, height: 700 }) === "top", "top edge release should dock to the top");
assert(resolveDockEdgeFromPoint({ x: 400, y: 742 }, { left: 20, top: 40, width: 980, height: 700 }) === "bottom", "bottom edge release should dock to the bottom");
assert(resolveDockEdgeFromPoint({ x: 400, y: 320 }, { left: 20, top: 40, width: 980, height: 700 }) === undefined, "center release should not dock");
assert(hasDockDragTravelled({ x: 10, y: 10 }, { x: 10 + dockDragStartThreshold, y: 10 }), "dock title drag should arm after threshold travel");
assert(!hasDockDragTravelled({ x: 10, y: 10 }, { x: 10 + dockDragStartThreshold - 1, y: 10 }), "dock title click should not dock without real drag travel");
assert(dockEdgeSnapThreshold >= 30, "dock edge snap threshold should be easy to hit by pointer release");
assert(dockEdgeSnapMargin >= 8, "edge-snapped floating windows should keep a small visual gutter");
assert(dockEdgeSnapWidthRatio < 0.5, "side snaps should not cover the whole fixed canvas");
assert(dockEdgeSnapHeightRatio < 0.5, "top/bottom snaps should not cover the whole fixed canvas");

const rightSnap = resolveDockEdgeSnapRect(
  "right",
  { width: 1200, height: 720 },
  { minimumWidth: 260, minimumHeight: 180, initialWidth: 520, initialHeight: 250 },
);
assert(rightSnap.x > 700, "right snap should attach the floating window to the right edge");
assert(rightSnap.y === dockEdgeSnapMargin, "right snap should keep the top gutter");
assert(rightSnap.height === 720 - dockEdgeSnapMargin * 2, "right snap should span the usable height");
assert(rightSnap.width < 600, "right snap should remain an overlay strip instead of becoming the canvas");

const bottomSnap = resolveDockEdgeSnapRect(
  "bottom",
  { width: 1200, height: 720 },
  { minimumWidth: 320, minimumHeight: 150, initialWidth: 520, initialHeight: 250 },
);
assert(bottomSnap.y > 430, "bottom snap should attach the floating window to the bottom edge");
assert(bottomSnap.width === 1200 - dockEdgeSnapMargin * 2, "bottom snap should span the usable width");

console.log(
  JSON.stringify(
    {
      status: "passed",
      placement: "dockview-core",
      visiblePanels: layout.filter((panel) => panel.visible).map((panel) => panel.panel),
      floatingPanels: layout.filter((panel) => panel.floating).map((panel) => panel.panel),
    },
    null,
    2,
  ),
);

function assertPanel(
  layout: FixedPanelLayout[],
  panel: PanelId,
  area: FixedPanelLayout["area"],
  visible: boolean,
  placement: PanelPlacement,
  order: number,
): void {
  const entry = layout.find((item) => item.panel === panel);
  assert(entry, `expected ${panel} layout entry`);
  assert(entry.area === area, `${panel} should keep the ${area} area marker`);
  assert(entry.visible === visible, `${panel} visible should be ${visible}`);
  assert(entry.placement === placement, `${panel} placement should be ${placement}`);
  assert(entry.docked === (visible && placement === "docked"), `${panel} docked marker should match placement`);
  assert(entry.floating === (visible && placement === "floating"), `${panel} floating marker should match placement`);
  assert(entry.order === order, `${panel} order should be ${order}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
