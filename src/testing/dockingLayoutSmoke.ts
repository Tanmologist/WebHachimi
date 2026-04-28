import {
  activateDockPanel,
  applyDockDrop,
  createDefaultDockingState,
  detectDockDropTarget,
  isPanelInDockTree,
  previewDockDrop,
  removePanelsFromDockingState,
  resolveDockingRects,
  resolveStackActivePanels,
  type DockDropTarget,
  type DockingState,
  type DockNode,
  type DockPanelId,
  type DockRect,
} from "../v2/dockingLayout";

const workspace: DockRect = { x: 0, y: 0, width: 1200, height: 800 };

let state = createDefaultDockingState();
let rects = resolveDockingRects(state, workspace);
assert(isPanelInDockTree(state.root, "scene"), "scene should start in dock tree");
assert(isPanelInDockTree(state.root, "properties"), "properties should start in dock tree");
assert(isPanelInDockTree(state.root, "tasks"), "tasks should start in dock tree");
assert(!isPanelInDockTree(state.root, "assets"), "assets should start floating");
assert(rects.assets, "assets should have a floating rect");
assertSingleOwnership(state, "default layout");
assertDockedNoOverlap(state, workspace, "default layout");

assertDetectsFloatingPanelAsFloat(state, rects.assets);
assertDetectsPanelTargetBeforeRootEdge(state);
assertDetectsOutsideRootEdges(state);
assertRootBottomDropUsesReasonableBand(state);
assertPanelEdgeDropDoesNotCollapseTarget(state);

const rootLeftTarget: DockDropTarget = { kind: "root-edge", edge: "left" };
assertPreviewMatchesFinal(state, "assets", rootLeftTarget, rects.assets);
state = applyDockDrop({
  state,
  panel: "assets",
  target: rootLeftTarget,
  floatingRect: rects.assets,
  workspace,
});
assert(isPanelInDockTree(state.root, "assets"), "assets should enter the dock tree after root-edge drop");
assert(!state.floating.assets, "assets should leave floating storage after root-edge drop");
assertSingleOwnership(state, "after assets root-edge drop");
assertDockedNoOverlap(state, workspace, "after assets root-edge drop");

rects = resolveDockingRects(state, workspace);
assert(rects.assets, "assets should keep a resolved dock rect");
const panelLeftTarget: DockDropTarget = { kind: "panel-edge", panel: "properties", edge: "left" };
assertPreviewMatchesFinal(state, "assets", panelLeftTarget, rects.assets);
state = applyDockDrop({
  state,
  panel: "assets",
  target: panelLeftTarget,
  floatingRect: rects.assets,
  workspace,
});
assertSingleOwnership(state, "after assets panel-edge drop");
assertDockedNoOverlap(state, workspace, "after assets panel-edge drop");

rects = resolveDockingRects(state, workspace);
const floatingRect: DockRect = { x: 64, y: 72, width: 360, height: 220 };
assertPreviewMatchesFinal(state, "assets", { kind: "float" }, floatingRect);
state = applyDockDrop({
  state,
  panel: "assets",
  target: { kind: "float" },
  floatingRect,
  workspace,
});
assert(!isPanelInDockTree(state.root, "assets"), "assets should leave dock tree after floating");
assertRect(resolveDockingRects(state, workspace).assets, floatingRect, "floating assets rect should be stable");
assertSingleOwnership(state, "after assets float");

const visibleWithoutProperties = removePanelsFromDockingState(state, ["properties"]);
const hiddenRects = resolveDockingRects(visibleWithoutProperties, workspace);
assert(!hiddenRects.properties, "hidden properties should not reserve layout space");
assert(resolveDockingRects(state, workspace).properties, "original state should keep hidden panel position for reopening");
assertSingleOwnership(visibleWithoutProperties, "visible layout without properties");
assertSingleOwnership(state, "original layout after visibility filter");

const hiddenDropRect: DockRect = { x: 120, y: 90, width: 300, height: 180 };
const hiddenPreviewState = removePanelsFromDockingState(
  applyDockDrop({
    state,
    panel: "assets",
    target: { kind: "root-edge", edge: "top" },
    floatingRect: hiddenDropRect,
    workspace,
  }),
  ["properties"],
);
const hiddenFinalState = removePanelsFromDockingState(
  applyDockDrop({
    state,
    panel: "assets",
    target: { kind: "root-edge", edge: "top" },
    floatingRect: hiddenDropRect,
    workspace,
  }),
  ["properties"],
);
assertRect(
  resolveDockingRects(hiddenPreviewState, workspace).assets,
  resolveDockingRects(hiddenFinalState, workspace).assets,
  "hidden-panel preview basis should match committed visible layout",
);

const duplicatedState: DockingState = {
  ...createDefaultDockingState(),
  floating: {
    ...createDefaultDockingState().floating,
    scene: { x: 8, y: 8, width: 80, height: 80 },
  },
};
assert(
  resolveDockingRects(duplicatedState, workspace).scene?.width !== 80,
  "docked rect should win over stale duplicate floating rects",
);

const stackTarget: DockDropTarget = { kind: "stack-center", panel: "tasks" };
assertPreviewMatchesFinal(state, "assets", stackTarget, floatingRect);
const stacked = applyDockDrop({
  state,
  panel: "assets",
  target: stackTarget,
  floatingRect,
  workspace,
});
assert(isPanelInDockTree(stacked.root, "assets"), "stack-center should be supported by pure engine");
assertSingleOwnership(stacked, "after stack-center drop");
assert(resolveStackActivePanels(stacked).assets === "assets", "dropped stack panel should become active");
const reactivatedTasks = activateDockPanel(stacked, "tasks");
assert(resolveStackActivePanels(reactivatedTasks).assets === "tasks", "activating a stack mate should update the active stack panel");

console.log(
  JSON.stringify(
    {
      status: "passed",
      finalFloating: resolveDockingRects(state, workspace).assets,
      dockedPanels: collectDockPanels(state.root),
    },
    null,
    2,
  ),
);

function assertDetectsFloatingPanelAsFloat(state: DockingState, floatingPanelRect: DockRect | undefined): void {
  assert(floatingPanelRect, "expected floating panel rect");
  const target = detectDockDropTarget({
    pointer: { x: floatingPanelRect.x + 12, y: floatingPanelRect.y + 12 },
    state,
    rects: resolveDockingRects(state, workspace),
    workspace,
    draggedPanel: "scene",
  });
  assert(target.kind === "float", "floating panels should not become panel-edge dock targets");
}

function assertDetectsPanelTargetBeforeRootEdge(state: DockingState): void {
  const sceneRect = resolveDockingRects(state, workspace).scene;
  assert(sceneRect, "expected scene rect");
  const edgeTarget = detectDockDropTarget({
    pointer: { x: sceneRect.x + 12, y: sceneRect.y + 80 },
    state,
    rects: resolveDockingRects(state, workspace),
    workspace,
    draggedPanel: "assets",
  });
  assert(edgeTarget.kind === "panel-edge" && edgeTarget.panel === "scene", "panel edge should win over root edge inside a docked panel");

  const centerTarget = detectDockDropTarget({
    pointer: { x: sceneRect.x + sceneRect.width / 2, y: sceneRect.y + sceneRect.height / 2 },
    state,
    rects: resolveDockingRects(state, workspace),
    workspace,
    draggedPanel: "assets",
  });
  assert(centerTarget.kind === "panel-edge" && centerTarget.panel === "scene", "center drop should split the existing panel by default");
  assert(centerTarget.edge === "right", `center drop should choose a stable split edge, got ${centerTarget.edge}`);

  const lowerTarget = detectDockDropTarget({
    pointer: { x: sceneRect.x + sceneRect.width / 2, y: sceneRect.y + sceneRect.height * 0.82 },
    state,
    rects: resolveDockingRects(state, workspace),
    workspace,
    draggedPanel: "assets",
  });
  assert(lowerTarget.kind === "panel-edge" && lowerTarget.panel === "scene" && lowerTarget.edge === "bottom", "lower half should split below the existing panel");

  const upperTarget = detectDockDropTarget({
    pointer: { x: sceneRect.x + sceneRect.width / 2, y: sceneRect.y + sceneRect.height * 0.18 },
    state,
    rects: resolveDockingRects(state, workspace),
    workspace,
    draggedPanel: "assets",
  });
  assert(upperTarget.kind === "panel-edge" && upperTarget.panel === "scene" && upperTarget.edge === "top", "upper half should split above the existing panel");
}

function assertDetectsOutsideRootEdges(state: DockingState): void {
  const rects = resolveDockingRects(state, workspace);
  const cases: Array<{ pointer: { x: number; y: number }; edge: string }> = [
    { pointer: { x: 600, y: -24 }, edge: "top" },
    { pointer: { x: 600, y: 824 }, edge: "bottom" },
    { pointer: { x: -24, y: 400 }, edge: "left" },
    { pointer: { x: 1224, y: 400 }, edge: "right" },
  ];
  for (const testCase of cases) {
    const target = detectDockDropTarget({ pointer: testCase.pointer, state, rects, workspace, draggedPanel: "assets" });
    assert(target.kind === "root-edge" && target.edge === testCase.edge, `expected outside ${testCase.edge} root-edge target`);
  }
}

function assertRootBottomDropUsesReasonableBand(state: DockingState): void {
  const next = applyDockDrop({
    state,
    panel: "scene",
    target: { kind: "root-edge", edge: "bottom" },
    floatingRect: { x: 0, y: 0, width: 300, height: workspace.height },
    workspace,
  });
  const sceneRect = resolveDockingRects(next, workspace).scene;
  assert(sceneRect, "expected scene rect after bottom drop");
  assert(sceneRect.height <= 360, `bottom dock band should be capped, got ${sceneRect.height}`);
}

function assertPanelEdgeDropDoesNotCollapseTarget(state: DockingState): void {
  const next = applyDockDrop({
    state,
    panel: "assets",
    target: { kind: "panel-edge", panel: "tasks", edge: "bottom" },
    floatingRect: { x: 0, y: 0, width: 390, height: workspace.height },
    workspace,
  });
  const nextRects = resolveDockingRects(next, workspace);
  assert(nextRects.tasks && nextRects.assets, "expected tasks and assets after panel-edge split");
  assert(nextRects.tasks.height > 100, `panel-edge target should not collapse, got ${nextRects.tasks.height}`);
  assert(nextRects.assets.height > 100, `panel-edge inserted panel should not collapse, got ${nextRects.assets.height}`);
}

function assertPreviewMatchesFinal(state: DockingState, panel: DockPanelId, target: DockDropTarget, floatingRect: DockRect | undefined): void {
  assert(floatingRect, `expected floating rect for ${panel}`);
  const preview = previewDockDrop({ state, panel, target, floatingRect, workspace }).rect;
  const final = resolveDockingRects(applyDockDrop({ state, panel, target, floatingRect, workspace }), workspace)[panel];
  assertRect(preview, final, `${panel} ${target.kind} preview should match final rect`);
}

function assertSingleOwnership(state: DockingState, label: string): void {
  const dockCounts = new Map<DockPanelId, number>();
  for (const panel of collectDockPanels(state.root)) dockCounts.set(panel, (dockCounts.get(panel) || 0) + 1);
  for (const panel of ["scene", "properties", "assets", "tasks"] as DockPanelId[]) {
    const total = (dockCounts.get(panel) || 0) + (state.floating[panel] ? 1 : 0);
    assert(total <= 1, `${label}: ${panel} should not appear in both dock tree and floating storage`);
  }
}

function assertDockedNoOverlap(state: DockingState, bounds: DockRect, label: string): void {
  const rects = resolveDockingRects(state, bounds);
  const dockedRects = collectDockPanels(state.root).map((panel) => rects[panel]).filter(Boolean) as DockRect[];
  for (const rect of dockedRects) assertInside(rect, bounds, label);
  for (let left = 0; left < dockedRects.length; left++) {
    for (let right = left + 1; right < dockedRects.length; right++) {
      assert(!rectsOverlap(dockedRects[left], dockedRects[right]), `${label}: docked rects should not overlap`);
    }
  }
}

function collectDockPanels(node: DockNode): DockPanelId[] {
  if (node.type === "empty") return [];
  if (node.type === "stack") return [...node.panels];
  return node.children.flatMap(collectDockPanels);
}

function assertRect(actual: DockRect | undefined, expected: DockRect | undefined, label: string): void {
  assert(actual, `${label}: expected actual rect`);
  assert(expected, `${label}: expected expected rect`);
  assert(Math.round(actual.x) === Math.round(expected.x), `${label}: expected x ${expected.x}, got ${actual.x}`);
  assert(Math.round(actual.y) === Math.round(expected.y), `${label}: expected y ${expected.y}, got ${actual.y}`);
  assert(Math.round(actual.width) === Math.round(expected.width), `${label}: expected width ${expected.width}, got ${actual.width}`);
  assert(Math.round(actual.height) === Math.round(expected.height), `${label}: expected height ${expected.height}, got ${actual.height}`);
}

function assertInside(rect: DockRect, bounds: DockRect, label: string): void {
  assert(rect.x >= bounds.x, `${label}: rect left should be inside bounds`);
  assert(rect.y >= bounds.y, `${label}: rect top should be inside bounds`);
  assert(rect.x + rect.width <= bounds.x + bounds.width, `${label}: rect right should be inside bounds`);
  assert(rect.y + rect.height <= bounds.y + bounds.height, `${label}: rect bottom should be inside bounds`);
}

function rectsOverlap(a: DockRect, b: DockRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
