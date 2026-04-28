import { Application, Container, Graphics, Text } from "pixi.js";
import type { BrushContext, Entity, Task } from "../project/schema";
import { boundsFor } from "../runtime/collision";
import type { RuntimeWorld } from "../runtime/world";
import type { Vec2 } from "../shared/types";
import {
  defaultViewportState,
  panViewport,
  screenToWorldPoint,
  zoomViewportAt,
  type ViewportState,
} from "./viewportMath";

export type TransformHandle = "core" | "scale-nw" | "scale-ne" | "scale-se" | "scale-sw" | "rotate";

export type V2RendererOptions = {
  host: HTMLElement;
};

export type RenderOverlayOptions = {
  selectedId?: string;
  previewTask?: Task;
  liveBrush?: BrushContext;
};

export class V2Renderer {
  readonly app = new Application();
  private readonly worldLayer = new Container();
  private readonly overlayLayer = new Container();
  private viewport = defaultViewportState();
  private resizeObserver?: ResizeObserver;
  private removeResizeFallback?: () => void;

  async init(options: V2RendererOptions): Promise<void> {
    await this.app.init({
      backgroundColor: 0x0f1110,
      antialias: true,
      resizeTo: options.host,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    this.app.canvas.className = "v2-canvas";
    options.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.worldLayer, this.overlayLayer);
    if ("ResizeObserver" in globalThis) {
      this.resizeObserver = new ResizeObserver(() => this.layoutWorld());
      this.resizeObserver.observe(options.host);
    } else {
      const onResize = () => this.layoutWorld();
      window.addEventListener("resize", onResize);
      this.removeResizeFallback = () => window.removeEventListener("resize", onResize);
    }
    this.layoutWorld();
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.removeResizeFallback?.();
    this.app.destroy(true);
  }

  canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  render(world: RuntimeWorld, options: RenderOverlayOptions = {}): void {
    this.worldLayer.removeChildren();
    this.overlayLayer.removeChildren();
    this.drawGrid();
    for (const entity of world.allEntities()) this.drawEntity(world, entity, options.selectedId === entity.id);
    this.drawTaskPreview(options.previewTask?.brushContext);
    this.drawTaskPreview(options.liveBrush, true);
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    return screenToWorldPoint(this.viewport, this.screenSize(), this.clientToLocalPoint(clientX, clientY));
  }

  viewportState(): ViewportState {
    return { ...this.viewport };
  }

  zoomAt(clientX: number, clientY: number, deltaY: number): ViewportState {
    this.viewport = zoomViewportAt(this.viewport, this.screenSize(), this.clientToLocalPoint(clientX, clientY), deltaY);
    this.layoutWorld();
    return this.viewportState();
  }

  panBy(deltaX: number, deltaY: number): ViewportState {
    this.viewport = panViewport(this.viewport, { x: deltaX, y: deltaY });
    this.layoutWorld();
    return this.viewportState();
  }

  resetViewport(): ViewportState {
    this.viewport = defaultViewportState();
    this.layoutWorld();
    return this.viewportState();
  }

  pickEntity(world: RuntimeWorld, point: Vec2, currentSelectedId?: string): Entity | undefined {
    const hits = world
      .allEntities()
      .filter((entity) => {
        const bounds = boundsFor(entity);
        return point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h;
      })
      .reverse();
    if (hits.length <= 1) return hits[0];
    const selectedIndex = hits.findIndex((entity) => entity.id === currentSelectedId);
    return hits[(selectedIndex + 1) % hits.length] || hits[0];
  }

  pickTransformHandle(entity: Entity | undefined, point: Vec2): TransformHandle | undefined {
    if (!entity) return undefined;
    const handles = selectionHandles(entity);
    for (const handle of handles) {
      if (Math.hypot(point.x - handle.position.x, point.y - handle.position.y) <= handle.radius) return handle.kind;
    }
    return undefined;
  }

  private layoutWorld(): void {
    const screen = this.screenSize();
    const zoom = this.viewport.zoom;
    const x = screen.width / 2 - this.viewport.x * zoom;
    const y = screen.height / 2 - this.viewport.y * zoom;
    this.worldLayer.position.set(x, y);
    this.overlayLayer.position.set(x, y);
    this.worldLayer.scale.set(zoom);
    this.overlayLayer.scale.set(zoom);
  }

  private drawGrid(): void {
    const graphics = new Graphics();
    const screen = this.screenSize();
    const topLeft = screenToWorldPoint(this.viewport, screen, { x: 0, y: 0 });
    const bottomRight = screenToWorldPoint(this.viewport, screen, { x: screen.width, y: screen.height });
    const step = gridStepForZoom(this.viewport.zoom);
    const left = Math.floor(topLeft.x / step) * step;
    const top = Math.floor(topLeft.y / step) * step;
    const right = bottomRight.x;
    const bottom = bottomRight.y;
    graphics.setStrokeStyle({ width: 1 / this.viewport.zoom, color: 0x252a28, alpha: 0.64 });
    for (let x = left; x < right; x += step) {
      graphics.moveTo(x, top);
      graphics.lineTo(x, bottom);
    }
    for (let y = top; y < bottom; y += step) {
      graphics.moveTo(left, y);
      graphics.lineTo(right, y);
    }
    graphics.stroke();
    this.worldLayer.addChild(graphics);
  }

  private screenSize(): { width: number; height: number } {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  private clientToLocalPoint(clientX: number, clientY: number): Vec2 {
    const rect = this.app.canvas.getBoundingClientRect();
    const scaleX = rect.width ? this.app.screen.width / rect.width : 1;
    const scaleY = rect.height ? this.app.screen.height / rect.height : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  private drawEntity(world: RuntimeWorld, entity: Entity, selected: boolean): void {
    this.drawColliderOverlay(entity, selected);
    if (entity.render && !entity.render.visible) {
      if (selected) this.drawSelection(entity);
      return;
    }
    const size = entity.collider?.size || { x: 60, y: 60 };
    const graphics = new Graphics();
    const color = parseColor(entity.render?.color || "#74a8bd");
    const alpha = entity.persistent ? entity.render?.opacity ?? 1 : Math.min(entity.render?.opacity ?? 1, 0.42);

    if (entity.collider?.shape === "circle") {
      graphics.circle(0, 0, entity.collider.radius || Math.min(size.x, size.y) / 2);
    } else if (entity.collider?.shape === "polygon" && entity.collider.points?.length) {
      const [first, ...rest] = entity.collider.points;
      graphics.moveTo(first.x, first.y);
      rest.forEach((point) => graphics.lineTo(point.x, point.y));
      graphics.closePath();
    } else {
      graphics.rect(-size.x / 2, -size.y / 2, size.x, size.y);
    }

    graphics.fill({ color, alpha });
    graphics.setStrokeStyle({
      width: selected ? 3 : 1,
      color: selected ? 0x35bd9a : entity.persistent ? 0x0b0d0c : 0xd7a84a,
      alpha: selected ? 1 : 0.9,
    });
    graphics.stroke();
    graphics.position.set(entity.transform.position.x, entity.transform.position.y);
    graphics.rotation = entity.transform.rotation;
    graphics.scale.set(entity.transform.scale.x || 1, entity.transform.scale.y || 1);
    this.worldLayer.addChild(graphics);

    if (entity.parentId) this.drawCoreLink(world, entity);
    this.drawLabel(entity, selected);
    if (selected) this.drawSelection(entity);
  }

  private drawColliderOverlay(entity: Entity, selected: boolean): void {
    if (!entity.collider) return;
    const bounds = boundsFor(entity);
    const overlay = new Graphics();
    const color = entity.collider.trigger ? 0x8f7dff : entity.collider.solid ? 0xd7a84a : 0x74a8bd;
    overlay.rect(bounds.x, bounds.y, bounds.w, bounds.h);
    if (selected) overlay.fill({ color, alpha: 0.06 });
    overlay.setStrokeStyle({ width: selected ? 2 : 1, color, alpha: selected ? 0.95 : 0.38 });
    overlay.stroke();
    this.overlayLayer.addChild(overlay);
  }

  private drawLabel(entity: Entity, selected: boolean): void {
    const label = new Text({
      text: entity.displayName,
      style: {
        fill: selected ? "#c9f2e7" : "#ece9df",
        fontFamily: "Inter, Microsoft YaHei, sans-serif",
        fontSize: 12,
        fontWeight: "700",
      },
    });
    label.anchor.set(0.5, 0.5);
    label.position.set(entity.transform.position.x, entity.transform.position.y);
    this.worldLayer.addChild(label);
  }

  private drawCoreLink(world: RuntimeWorld, entity: Entity): void {
    const parent = world.allEntities().find((item) => item.id === entity.parentId);
    if (!parent) return;
    const from = parent.transform.position;
    const to = entity.transform.position;
    if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) < 2) return;
    const link = new Graphics();
    link.setStrokeStyle({ width: 1, color: 0xd7a84a, alpha: 0.72 });
    link.moveTo(from.x, from.y);
    link.lineTo(to.x, to.y);
    link.stroke();
    this.overlayLayer.addChild(link);
  }

  private drawSelection(entity: Entity): void {
    const overlay = new Graphics();
    const handles = selectionHandles(entity);
    const corners = handles.filter((handle) => handle.kind.startsWith("scale"));
    const rotateHandle = handles.find((handle) => handle.kind === "rotate");
    const core = handles.find((handle) => handle.kind === "core");
    overlay.setStrokeStyle({ width: 1, color: 0x35bd9a, alpha: 0.9 });
    if (corners.length === 4) {
      overlay.moveTo(corners[0].position.x, corners[0].position.y);
      corners.slice(1).forEach((handle) => overlay.lineTo(handle.position.x, handle.position.y));
      overlay.closePath();
    }
    overlay.stroke();
    if (rotateHandle && corners.length >= 2) {
      const topCenter = midpoint(corners[0].position, corners[1].position);
      overlay.moveTo(topCenter.x, topCenter.y);
      overlay.lineTo(rotateHandle.position.x, rotateHandle.position.y);
      overlay.stroke();
    }
    if (core) {
      overlay.circle(core.position.x, core.position.y, 4);
      overlay.fill({ color: 0x35bd9a, alpha: 1 });
    }
    for (const handle of corners) {
      overlay.rect(handle.position.x - 3, handle.position.y - 3, 6, 6);
      overlay.fill({ color: 0x101211, alpha: 1 });
      overlay.setStrokeStyle({ width: 1, color: 0x35bd9a, alpha: 1 });
      overlay.stroke();
    }
    if (rotateHandle) {
      overlay.circle(rotateHandle.position.x, rotateHandle.position.y, 5);
      overlay.fill({ color: 0x101211, alpha: 1 });
      overlay.setStrokeStyle({ width: 1, color: 0xd7a84a, alpha: 1 });
      overlay.stroke();
    }
    this.overlayLayer.addChild(overlay);
  }

  private drawTaskPreview(context?: BrushContext, live = false): void {
    if (!context) return;
    const graphics = new Graphics();
    for (const stroke of context.strokes) {
      const [first, ...rest] = stroke.points;
      if (!first) continue;
      graphics.setStrokeStyle({
        width: live ? Math.max(stroke.width, 3) : stroke.width,
        color: parseColor(stroke.color),
        alpha: live ? 0.9 : 0.78,
      });
      graphics.moveTo(first.x, first.y);
      rest.forEach((point) => graphics.lineTo(point.x, point.y));
      graphics.stroke();
    }
    if (context.selectionBox) {
      graphics.setStrokeStyle({ width: 2, color: live ? 0x35bd9a : 0xd7a84a, alpha: live ? 0.9 : 0.78 });
      graphics.rect(context.selectionBox.x, context.selectionBox.y, context.selectionBox.w, context.selectionBox.h);
      graphics.stroke();
    }
    this.overlayLayer.addChild(graphics);
  }
}

function gridStepForZoom(zoom: number): number {
  let step = 48;
  while (step * zoom < 18) step *= 2;
  while (step * zoom > 120 && step > 12) step /= 2;
  return step;
}

function selectionHandles(entity: Entity): Array<{ kind: TransformHandle; position: Vec2; radius: number }> {
  const size = entity.collider?.size || { x: 60, y: 60 };
  const scale = entity.transform.scale || { x: 1, y: 1 };
  const hw = (size.x * Math.max(Math.abs(scale.x), 0.08)) / 2 + 5;
  const hh = (size.y * Math.max(Math.abs(scale.y), 0.08)) / 2 + 5;
  const center = entity.transform.position;
  const rotation = entity.collider ? 0 : entity.transform.rotation || 0;
  const corners = [
    { kind: "scale-nw" as const, local: { x: -hw, y: -hh } },
    { kind: "scale-ne" as const, local: { x: hw, y: -hh } },
    { kind: "scale-se" as const, local: { x: hw, y: hh } },
    { kind: "scale-sw" as const, local: { x: -hw, y: hh } },
  ];
  return [
    ...corners.map((corner) => ({ kind: corner.kind, position: fromLocal(center, corner.local, rotation), radius: 9 })),
    { kind: "rotate", position: fromLocal(center, { x: 0, y: -hh - 28 }, rotation), radius: 10 },
    { kind: "core", position: center, radius: 8 },
  ];
}

function fromLocal(center: Vec2, local: Vec2, rotation: number): Vec2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + local.x * cos - local.y * sin,
    y: center.y + local.x * sin + local.y * cos,
  };
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function parseColor(value: string): number {
  const normalized = value.startsWith("#") ? value.slice(1) : value;
  return Number.parseInt(normalized, 16);
}
