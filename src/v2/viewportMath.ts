import type { Vec2 } from "../shared/types";

export type ViewportState = {
  x: number;
  y: number;
  zoom: number;
};

export type ViewportScreen = {
  width: number;
  height: number;
};

export const MIN_VIEWPORT_ZOOM = 0.2;
export const MAX_VIEWPORT_ZOOM = 4;

export function defaultViewportState(): ViewportState {
  return { x: 0, y: 0, zoom: 1 };
}

export function screenToWorldPoint(viewport: ViewportState, screen: ViewportScreen, local: Vec2): Vec2 {
  return {
    x: (local.x - screen.width / 2) / viewport.zoom + viewport.x,
    y: (local.y - screen.height / 2) / viewport.zoom + viewport.y,
  };
}

export function worldToScreenPoint(viewport: ViewportState, screen: ViewportScreen, world: Vec2): Vec2 {
  return {
    x: screen.width / 2 + (world.x - viewport.x) * viewport.zoom,
    y: screen.height / 2 + (world.y - viewport.y) * viewport.zoom,
  };
}

export function panViewport(viewport: ViewportState, deltaScreen: Vec2): ViewportState {
  return {
    ...viewport,
    x: viewport.x - deltaScreen.x / viewport.zoom,
    y: viewport.y - deltaScreen.y / viewport.zoom,
  };
}

export function zoomViewportAt(
  viewport: ViewportState,
  screen: ViewportScreen,
  local: Vec2,
  deltaY: number,
): ViewportState {
  const before = screenToWorldPoint(viewport, screen, local);
  const wheelFactor = Math.pow(1.0015, -deltaY);
  const zoom = clamp(viewport.zoom * wheelFactor, MIN_VIEWPORT_ZOOM, MAX_VIEWPORT_ZOOM);
  return {
    x: before.x - (local.x - screen.width / 2) / zoom,
    y: before.y - (local.y - screen.height / 2) / zoom,
    zoom,
  };
}

export function clampViewportZoom(zoom: number): number {
  return clamp(zoom, MIN_VIEWPORT_ZOOM, MAX_VIEWPORT_ZOOM);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
