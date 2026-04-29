import {
  createFixedPanelLayout,
  dockDragStartThreshold,
  dockEdgeDropOverlay,
  dockEdgeSnapThreshold,
  dockSingleTabMode,
  dockTheme,
  hasDockDragTravelled,
  resolveDockEdgeFromPoint,
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
assert(dockEdgeDropOverlay.activationSize?.type === "pixels", "dock edge drop activation should be explicit");
assert((dockEdgeDropOverlay.activationSize?.value || 0) > 0, "dock edge drop activation should not be disabled");
assert((dockEdgeDropOverlay.size?.value || 0) >= 20, "dock edge drop target should be large enough to hit");
assert(dockSingleTabMode === "fullwidth", "single-panel floating window titles should be draggable dock tabs");
assert(dockTheme.dndOverlayMounting === "absolute", "dock root edge drop targets must mount at the dockview root");
assert(dockTheme.dndPanelOverlay === "group", "dock drop feedback should include the tab header group");
assert(resolveDockEdgeFromPoint({ x: 1001, y: 320 }, { left: 20, top: 40, width: 980, height: 700 }) === "right", "right edge release should dock to the right");
assert(resolveDockEdgeFromPoint({ x: 22, y: 320 }, { left: 20, top: 40, width: 980, height: 700 }) === "left", "left edge release should dock to the left");
assert(resolveDockEdgeFromPoint({ x: 400, y: 48 }, { left: 20, top: 40, width: 980, height: 700 }) === "top", "top edge release should dock to the top");
assert(resolveDockEdgeFromPoint({ x: 400, y: 742 }, { left: 20, top: 40, width: 980, height: 700 }) === "bottom", "bottom edge release should dock to the bottom");
assert(resolveDockEdgeFromPoint({ x: 400, y: 320 }, { left: 20, top: 40, width: 980, height: 700 }) === undefined, "center release should not dock");
assert(hasDockDragTravelled({ x: 10, y: 10 }, { x: 10 + dockDragStartThreshold, y: 10 }), "dock title drag should arm after threshold travel");
assert(!hasDockDragTravelled({ x: 10, y: 10 }, { x: 10 + dockDragStartThreshold - 1, y: 10 }), "dock title click should not dock without real drag travel");
assert(dockEdgeSnapThreshold >= 30, "dock edge snap threshold should be easy to hit by pointer release");

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
