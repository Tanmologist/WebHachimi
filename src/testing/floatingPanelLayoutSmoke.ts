import {
  constrainWindowLayout,
  detectDockZone,
  dockRect,
  resolveDockedPanelRects,
  resolveDockPreviewRect,
  type FloatingPanelLayout,
  type PanelRect,
} from "../v2/panelLayout";

const workspace = { width: 900, height: 620 };
const base: FloatingPanelLayout = { x: 120, y: 80, width: 300, height: 220, z: 4, dock: "float" };

assertLayout(constrainWindowLayout(base, workspace), base, "stable layout should not move");

const tooLarge = constrainWindowLayout({ ...base, width: 2000, height: 2000 }, workspace);
assert(tooLarge.width === 880, `expected width clamp to 880, got ${tooLarge.width}`);
assert(tooLarge.height === 600, `expected height clamp to 600, got ${tooLarge.height}`);

const offscreen = constrainWindowLayout({ ...base, x: 2000, y: 2000 }, workspace);
assert(offscreen.x === 2000, `expected offscreen x to remain 2000, got ${offscreen.x}`);
assert(offscreen.y === 2000, `expected offscreen y to remain 2000, got ${offscreen.y}`);

const negative = constrainWindowLayout({ ...base, x: -100, y: -80 }, workspace);
assert(negative.x === -100, `expected negative x to remain -100, got ${negative.x}`);
assert(negative.y === -80, `expected negative y to remain -80, got ${negative.y}`);

assert(detectDockZone({ x: 48, y: 300 }, workspace) === "left", "expected left edge docking at threshold");
assert(detectDockZone({ x: 49, y: 300 }, workspace) === "float", "expected left edge to release past threshold");
assert(detectDockZone({ x: 852, y: 300 }, workspace) === "right", "expected right edge docking at threshold");
assert(detectDockZone({ x: 851, y: 300 }, workspace) === "float", "expected right edge to release past threshold");
assert(detectDockZone({ x: 400, y: 48 }, workspace) === "top", "expected top edge docking at threshold");
assert(detectDockZone({ x: 400, y: 49 }, workspace) === "float", "expected top edge to release past threshold");
assert(detectDockZone({ x: 400, y: 572 }, workspace) === "bottom", "expected bottom edge docking at threshold");
assert(detectDockZone({ x: 400, y: 571 }, workspace) === "float", "expected bottom edge to release past threshold");
assert(detectDockZone({ x: 400, y: -24 }, workspace) === "top", "expected top edge docking outside workspace");
assert(detectDockZone({ x: 400, y: 644 }, workspace) === "bottom", "expected bottom edge docking outside workspace");
assert(detectDockZone({ x: -24, y: 300 }, workspace) === "left", "expected left edge docking outside workspace");
assert(detectDockZone({ x: 924, y: 300 }, workspace) === "right", "expected right edge docking outside workspace");
assert(detectDockZone({ x: 40, y: 300 }, workspace, "left") === "left", "expected left hysteresis to keep docking inside buffer");
assert(detectDockZone({ x: 60, y: 300 }, workspace, "left") === "left", "expected previous left dock to keep hysteresis");
assert(detectDockZone({ x: 70, y: 300 }, workspace, "left") === "float", "expected previous left dock to release outside hysteresis");
assert(detectDockZone({ x: 8, y: 20 }, workspace) === "left", "nearest corner edge should win left");
assert(detectDockZone({ x: 20, y: 8 }, workspace) === "top", "nearest corner edge should win top");

const leftDock = dockRect("left", workspace, base);
const rightDock = dockRect("right", workspace, base);
const bottomDock = dockRect("bottom", workspace, base);
assert(leftDock.x === 0 && leftDock.y === 0 && leftDock.height === workspace.height, "left dock should fill workspace height");
assert(rightDock.x + rightDock.width === workspace.width, "right dock should touch right edge");
assert(bottomDock.y + bottomDock.height === workspace.height, "bottom dock should touch bottom edge");

const stackedRight = resolveDockedPanelRects(
  [
    { panel: "properties", layout: { ...base, width: 300, height: 180, dock: "right", y: 10 } },
    { panel: "tasks", layout: { ...base, width: 300, height: 420, dock: "right", y: 400 } },
  ],
  workspace,
);
assert(stackedRight.properties, "expected properties dock rect");
assert(stackedRight.tasks, "expected tasks dock rect");
assert(stackedRight.properties.x === stackedRight.tasks.x, "right dock stack should share x");
assert(stackedRight.properties.y + stackedRight.properties.height <= stackedRight.tasks.y, "right docked panels should not overlap vertically");
assert(Math.round(stackedRight.tasks.y + stackedRight.tasks.height) === workspace.height, "last right docked panel should fill to bottom");
assertNoOverlapAndInside(Object.values(stackedRight), workspace, "stacked right");

const reversedRight = resolveDockedPanelRects(
  [
    { panel: "tasks", layout: { ...base, width: 300, height: 420, dock: "right", y: 10 } },
    { panel: "properties", layout: { ...base, width: 300, height: 180, dock: "right", y: 400 } },
  ],
  workspace,
);
assert(reversedRight.tasks && reversedRight.properties, "expected reversed right dock rects");
assert(reversedRight.tasks.y < reversedRight.properties.y, "same-edge ordering should follow drop axis, not fixed panel order");

const rightStackEntries = [
  { panel: "properties" as const, layout: { ...base, width: 300, height: 180, dock: "right" as const, y: 10 } },
  { panel: "tasks" as const, layout: { ...base, width: 300, height: 420, dock: "right" as const, y: 400 } },
];
const assetsPreviewRight = resolveDockPreviewRect({
  panel: "assets",
  dock: "right",
  layout: { ...base, width: 300, height: 154, dock: "float", y: 238 },
  entries: rightStackEntries,
  workspace,
});
const assetsFinalRight = resolveDockedPanelRects(
  [...rightStackEntries, { panel: "assets", layout: { ...base, width: 300, height: 154, dock: "right", y: 238 } }],
  workspace,
).assets;
assert(assetsPreviewRight && assetsFinalRight, "expected preview and final rect for assets in right dock");
assertRect(assetsPreviewRight, assetsFinalRight, "right dock preview should match final resolved rect");
assert(assetsPreviewRight.height < dockRect("right", workspace, base).height, "right stack preview should not use full-height standalone dock rect");

const topAndRightEntries = [
  { panel: "tasks" as const, layout: { ...base, width: 300, height: 150, dock: "top" as const, x: 0 } },
  { panel: "properties" as const, layout: { ...base, width: 300, height: 180, dock: "right" as const, y: 180 } },
];
const assetsPreviewLeft = resolveDockPreviewRect({
  panel: "assets",
  dock: "left",
  layout: { ...base, width: 260, height: 154, dock: "float", y: 260 },
  entries: topAndRightEntries,
  workspace,
});
const assetsFinalLeft = resolveDockedPanelRects(
  [...topAndRightEntries, { panel: "assets", layout: { ...base, width: 260, height: 154, dock: "left", y: 260 } }],
  workspace,
).assets;
assert(assetsPreviewLeft && assetsFinalLeft, "expected preview and final rect for assets in left dock with top band");
assertRect(assetsPreviewLeft, assetsFinalLeft, "left dock preview should respect top band and match final rect");
assert(assetsPreviewLeft.y > 0, "left dock preview should not cover the top dock band");

const crowdedWorkspace = { width: 440, height: 360 };
const allEdges = resolveDockedPanelRects(
  [
    { panel: "scene", layout: { ...base, width: 260, height: 220, dock: "left" } },
    { panel: "properties", layout: { ...base, width: 260, height: 180, dock: "right" } },
    { panel: "assets", layout: { ...base, width: 260, height: 150, dock: "bottom" } },
    { panel: "tasks", layout: { ...base, width: 260, height: 150, dock: "top" } },
  ],
  crowdedWorkspace,
);
assert(allEdges.scene && allEdges.properties && allEdges.assets && allEdges.tasks, "expected all dock rects in crowded workspace");
assertNoOverlapAndInside(Object.values(allEdges), crowdedWorkspace, "crowded all-edge docks");

const firstPass = resolveDockedPanelRects(
  [
    { panel: "scene", layout: { ...base, dock: "left", y: 20 } },
    { panel: "assets", layout: { ...base, dock: "left", y: 260 } },
    { panel: "tasks", layout: { ...base, dock: "bottom", x: 120 } },
  ],
  workspace,
);
const secondPass = resolveDockedPanelRects(
  [
    { panel: "scene", layout: { ...base, dock: "left", y: 20 } },
    { panel: "assets", layout: { ...base, dock: "left", y: 260 } },
    { panel: "tasks", layout: { ...base, dock: "bottom", x: 120 } },
  ],
  workspace,
);
assert(JSON.stringify(firstPass) === JSON.stringify(secondPass), "docked layout resolution should be deterministic");

console.log(
  JSON.stringify(
    {
      status: "passed",
      stable: constrainWindowLayout(base, workspace),
      tooLarge,
      offscreen,
      negative,
      docks: {
        left: leftDock,
        right: rightDock,
        bottom: bottomDock,
        stackedRight,
        reversedRight,
        allEdges,
      },
    },
    null,
    2,
  ),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rectsOverlap(a: PanelRect, b: PanelRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function assertNoOverlapAndInside(rects: PanelRect[], bounds: { width: number; height: number }, label: string): void {
  const rounded = rects.map((rect) => ({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }));
  rounded.forEach((rect, index) => {
    assertInside(rect, bounds, `${label} rect ${index}`);
  });
  for (let leftIndex = 0; leftIndex < rounded.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < rounded.length; rightIndex++) {
      assert(!rectsOverlap(rounded[leftIndex], rounded[rightIndex]), `${label} rects ${leftIndex} and ${rightIndex} should not overlap`);
    }
  }
}

function assertRect(actual: PanelRect, expected: PanelRect, label: string): void {
  assert(Math.round(actual.x) === Math.round(expected.x), `${label}: expected x ${expected.x}, got ${actual.x}`);
  assert(Math.round(actual.y) === Math.round(expected.y), `${label}: expected y ${expected.y}, got ${actual.y}`);
  assert(Math.round(actual.width) === Math.round(expected.width), `${label}: expected width ${expected.width}, got ${actual.width}`);
  assert(Math.round(actual.height) === Math.round(expected.height), `${label}: expected height ${expected.height}, got ${actual.height}`);
}

function assertInside(rect: PanelRect, bounds: { width: number; height: number }, label: string): void {
  assert(rect.x >= 0, `${label}: x should be inside bounds`);
  assert(rect.y >= 0, `${label}: y should be inside bounds`);
  assert(rect.x + rect.width <= bounds.width, `${label}: right edge should be inside bounds`);
  assert(rect.y + rect.height <= bounds.height, `${label}: bottom edge should be inside bounds`);
}

function toRect(layout: FloatingPanelLayout): PanelRect {
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}

function assertLayout(actual: FloatingPanelLayout, expected: FloatingPanelLayout, label: string): void {
  assert(actual.x === expected.x, `${label}: expected x ${expected.x}, got ${actual.x}`);
  assert(actual.y === expected.y, `${label}: expected y ${expected.y}, got ${actual.y}`);
  assert(actual.width === expected.width, `${label}: expected width ${expected.width}, got ${actual.width}`);
  assert(actual.height === expected.height, `${label}: expected height ${expected.height}, got ${actual.height}`);
  assert(actual.z === expected.z, `${label}: expected z ${expected.z}, got ${actual.z}`);
  assert(actual.dock === expected.dock, `${label}: expected dock ${expected.dock}, got ${actual.dock}`);
}
