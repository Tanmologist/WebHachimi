import {
  createFixedPanelLayout,
  resolveStudioWorkspaceMode,
  type FixedPanelLayout,
  type PanelId,
  type PanelPlacement,
  type PanelState,
} from "../editor/panelLayout";

const openState: Record<PanelId, PanelState> = {
  scene: "open",
  properties: "open",
  assets: "open",
  library: "open",
  tasks: "open",
  output: "open",
};

const layout = createFixedPanelLayout(openState);
for (const panel of layout) assertRemoved(panel);

assert(resolveStudioWorkspaceMode(1440) === "headless", "workspace mode should stay headless after UI removal");
assert(resolveStudioWorkspaceMode(390) === "headless", "small viewports should not revive a compact UI");

console.log(
  JSON.stringify(
    {
      status: "passed",
      placement: "removed",
      visiblePanels: layout.filter((panel) => panel.visible).map((panel) => panel.panel),
    },
    null,
    2,
  ),
);

function assertRemoved(entry: FixedPanelLayout): void {
  const placement: PanelPlacement = "removed";
  assert(entry.area === "removed", `${entry.panel} area should be removed`);
  assert(entry.placement === placement, `${entry.panel} placement should be removed`);
  assert(entry.visible === false, `${entry.panel} should never be visible`);
  assert(entry.docked === false, `${entry.panel} should never dock`);
  assert(entry.floating === false, `${entry.panel} should never float`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
