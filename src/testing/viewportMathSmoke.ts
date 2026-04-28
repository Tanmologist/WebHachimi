import {
  defaultViewportState,
  panViewport,
  screenToWorldPoint,
  worldToScreenPoint,
  zoomViewportAt,
  type ViewportScreen,
} from "../v2/viewportMath";

const screen: ViewportScreen = { width: 1000, height: 700 };
const center = { x: screen.width / 2, y: screen.height / 2 };
const viewport = defaultViewportState();

assertPoint(screenToWorldPoint(viewport, screen, center), { x: 0, y: 0 }, "center maps to origin");
assertPoint(worldToScreenPoint(viewport, screen, { x: 120, y: -80 }), { x: 620, y: 270 }, "world to screen");

const zoomLocal = { x: 720, y: 420 };
const worldBeforeZoom = screenToWorldPoint(viewport, screen, zoomLocal);
const zoomed = zoomViewportAt(viewport, screen, zoomLocal, -240);
const worldAfterZoom = screenToWorldPoint(zoomed, screen, zoomLocal);
assert(zoomed.zoom > viewport.zoom, `expected zoom in, got ${zoomed.zoom}`);
assertPoint(worldAfterZoom, worldBeforeZoom, "cursor anchored zoom");

const panned = panViewport(zoomed, { x: 80, y: -40 });
assert(panned.x < zoomed.x, "dragging screen right should move camera left");
assert(panned.y > zoomed.y, "dragging screen up should move camera down");
const sameWorldAfterPan = screenToWorldPoint(panned, screen, worldToScreenPoint(panned, screen, worldBeforeZoom));
assertPoint(sameWorldAfterPan, worldBeforeZoom, "pan keeps transforms reversible");

const minClamped = zoomViewportAt(viewport, screen, center, 100000);
const maxClamped = zoomViewportAt(viewport, screen, center, -100000);
assert(minClamped.zoom === 0.2, `expected min zoom clamp, got ${minClamped.zoom}`);
assert(maxClamped.zoom === 4, `expected max zoom clamp, got ${maxClamped.zoom}`);

console.log(
  JSON.stringify(
    {
      status: "passed",
      zoom: {
        before: viewport.zoom,
        after: zoomed.zoom,
        cursorWorld: worldAfterZoom,
      },
      pan: {
        x: panned.x,
        y: panned.y,
      },
      clamps: {
        min: minClamped.zoom,
        max: maxClamped.zoom,
      },
    },
    null,
    2,
  ),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertPoint(actual: { x: number; y: number }, expected: { x: number; y: number }, label: string): void {
  assert(nearlyEqual(actual.x, expected.x), `${label}: expected x ${expected.x}, got ${actual.x}`);
  assert(nearlyEqual(actual.y, expected.y), `${label}: expected y ${expected.y}, got ${actual.y}`);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}
