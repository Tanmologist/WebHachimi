import type { TargetRef } from "../project/schema";
import type { Rect, SceneId, Vec2 } from "../shared/types";

export const CANVAS_GUIDE_PANEL_LABEL = "UI 指导面板";
export const CANVAS_GUIDE_PANEL_ID = "canvas-guide-panel";

export type ClientRectLike = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;

export type CanvasGuidePanelTargetInput = {
  sceneId: SceneId;
  panelRect?: ClientRectLike;
  clientPoints: Vec2[];
  screenToWorld: (point: Vec2) => Vec2;
};

export type CanvasGuidePanelAnnotationInput = {
  panelRect: ClientRectLike;
  screenToWorld: (point: Vec2) => Vec2;
};

export function canvasGuidePanelTargetsForStroke(input: CanvasGuidePanelTargetInput): TargetRef[] {
  if (!input.panelRect || !isUsablePanelRect(input.panelRect)) return [];
  if (!input.clientPoints.some((point) => clientPointInRect(point, input.panelRect!))) return [];
  const rect = clientRectToWorldRect(input.panelRect, input.screenToWorld);
  return [
    {
      kind: "editorUi",
      uiId: CANVAS_GUIDE_PANEL_ID,
      label: CANVAS_GUIDE_PANEL_LABEL,
      rect,
    },
    {
      kind: "area",
      sceneId: input.sceneId,
      rect,
    },
  ];
}

export function canvasGuidePanelAnnotationInput(input: CanvasGuidePanelAnnotationInput): { text: string; position: Vec2 } {
  const center = {
    x: input.panelRect.left + input.panelRect.width / 2,
    y: input.panelRect.top + input.panelRect.height / 2,
  };
  return {
    text: CANVAS_GUIDE_PANEL_LABEL,
    position: input.screenToWorld(center),
  };
}

export function clientPointInRect(point: Vec2, rect: ClientRectLike): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function clientRectToWorldRect(rect: ClientRectLike, screenToWorld: (point: Vec2) => Vec2): Rect {
  const topLeft = screenToWorld({ x: rect.left, y: rect.top });
  const bottomRight = screenToWorld({ x: rect.right, y: rect.bottom });
  const minX = Math.min(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const maxY = Math.max(topLeft.y, bottomRight.y);
  return {
    x: roundCoord(minX),
    y: roundCoord(minY),
    w: Math.max(1, roundCoord(maxX - minX)),
    h: Math.max(1, roundCoord(maxY - minY)),
  };
}

function isUsablePanelRect(rect: ClientRectLike): boolean {
  return rect.width >= 24 && rect.height >= 24;
}

function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}
