import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import type { BrushContext, Entity, Resource, Task } from "../project/schema";
import type { RuntimeWorld } from "../runtime/world";
import type { Vec2 } from "../shared/types";
import { isVisualResource, resourceFrameAtTime, type ResourceFrameRect } from "./resourceAnimation";
import {
  defaultViewportState,
  panViewport,
  screenToWorldPoint,
  zoomViewportAt,
  type ViewportState,
} from "./viewportMath";

export type CanvasTargetPart = "body" | "presentation";
export type CanvasSelection = {
  entityId: string;
  part: CanvasTargetPart;
};

export type PickedCanvasTarget = {
  entity: Entity;
  part: CanvasTargetPart;
};

export type TransformHandle =
  | "core"
  | "scale-n"
  | "scale-e"
  | "scale-s"
  | "scale-w"
  | "scale-nw"
  | "scale-ne"
  | "scale-se"
  | "scale-sw"
  | "rotate";

export type V2RendererOptions = {
  host: HTMLElement;
};

export type RenderOverlayOptions = {
  selectedId?: string;
  selectedIds?: string[];
  selectedPart?: CanvasTargetPart;
  showBodyMaterial?: boolean;
  showEditorDecorations?: boolean;
  previewTask?: Task;
  liveBrush?: BrushContext;
  shapeDraft?: ShapeDraftPreview;
  resources?: Record<string, Resource>;
  animationTimeMs?: number;
};

export type RendererStats = {
  renderedAt: number;
  renderMs: number;
  graphicsReused: number;
  graphicsCreated: number;
  spritesReused: number;
  spritesCreated: number;
  visibleObjects: number;
};

export type ShapeDraftPreview = {
  points: Vec2[];
  closed: boolean;
};

type BodyMaterialStyle = {
  stroke: number;
  fill: number;
  texture: number;
  fillAlpha: number;
  selectedFillAlpha: number;
  textureAlpha: number;
  selectedTextureAlpha: number;
};

const emptyResources: Record<string, Resource> = {};

export class V2Renderer {
  readonly app = new Application();
  private readonly worldLayer = new Container();
  private readonly overlayLayer = new Container();
  private readonly imageTextures = new Map<string, Texture>();
  private readonly frameTextures = new Map<string, Texture>();
  private readonly imageTextureLoads = new Map<string, Promise<void>>();
  private readonly graphicsPool: Graphics[] = [];
  private readonly spritePool: Sprite[] = [];
  private lastRender?: { world: RuntimeWorld; options: RenderOverlayOptions };
  private stats: RendererStats = {
    renderedAt: 0,
    renderMs: 0,
    graphicsReused: 0,
    graphicsCreated: 0,
    spritesReused: 0,
    spritesCreated: 0,
    visibleObjects: 0,
  };
  private viewport = defaultViewportState();
  private resizeObserver?: ResizeObserver;
  private removeResizeFallback?: () => void;

  async init(options: V2RendererOptions): Promise<void> {
    await this.app.init({
      backgroundColor: 0x0f1110,
      antialias: true,
      resizeTo: options.host,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
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
    this.frameTextures.forEach((texture) => texture.destroy(false));
    this.frameTextures.clear();
    this.app.destroy(true);
  }

  canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  render(world: RuntimeWorld, options: RenderOverlayOptions = {}): void {
    const started = performance.now();
    this.lastRender = { world, options };
    this.recycleLayer(this.worldLayer);
    this.recycleLayer(this.overlayLayer);
    this.stats.graphicsReused = 0;
    this.stats.graphicsCreated = 0;
    this.stats.spritesReused = 0;
    this.stats.spritesCreated = 0;
    const showBodyMaterial = options.showBodyMaterial !== false;
    const showEditorDecorations = options.showEditorDecorations !== false;
    const selectedIds = options.selectedIds?.length
      ? new Set(options.selectedIds)
      : options.selectedId
        ? new Set([options.selectedId])
        : undefined;
    const entities = world.allEntities();
    const resources = options.resources || emptyResources;
    if (showBodyMaterial) this.drawGrid();
    for (const entity of entities) {
      const selectedPart = selectedIds?.has(entity.id)
        ? entity.id === options.selectedId
          ? options.selectedPart || "body"
          : "body"
        : undefined;
      this.drawEntity(world, entity, selectedPart, showBodyMaterial, showEditorDecorations, resources, options.animationTimeMs || 0);
    }
    if (showEditorDecorations) {
      this.drawTaskPreview(options.previewTask?.brushContext);
      this.drawTaskPreview(options.liveBrush, true);
      this.drawShapeDraft(options.shapeDraft);
    }
    this.stats.visibleObjects = this.worldLayer.children.length + this.overlayLayer.children.length;
    this.stats.renderedAt = performance.now();
    this.stats.renderMs = this.stats.renderedAt - started;
  }

  performanceStats(): RendererStats {
    return { ...this.stats };
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
    return this.pickCanvasTarget(world, point, currentSelectedId ? { entityId: currentSelectedId, part: "body" } : undefined)?.entity;
  }

  pickCanvasTarget(world: RuntimeWorld, point: Vec2, currentSelection?: CanvasSelection): PickedCanvasTarget | undefined {
    const hits: PickedCanvasTarget[] = [];
    const entities = world.allEntities();
    for (let index = entities.length - 1; index >= 0; index -= 1) {
      appendCanvasHitTargets(hits, entities[index], point);
    }
    if (hits.length <= 1) return hits[0];
    const selectedIndex = hits.findIndex(
      (hit) => hit.entity.id === currentSelection?.entityId && hit.part === currentSelection.part,
    );
    return hits[(selectedIndex + 1) % hits.length] || hits[0];
  }

  pickTransformHandle(entity: Entity | undefined, part: CanvasTargetPart, point: Vec2): TransformHandle | undefined {
    if (!entity) return undefined;
    const handles = selectionHandles(entity, part);
    for (const handle of handles) {
      if (Math.hypot(point.x - handle.position.x, point.y - handle.position.y) <= handle.radius) return handle.kind;
    }
    return undefined;
  }

  targetsInRect(world: RuntimeWorld, rect: { x: number; y: number; w: number; h: number }): PickedCanvasTarget[] {
    const normalized = normalizeRect(rect);
    const targets: PickedCanvasTarget[] = [];
    for (const entity of world.allEntities()) {
      appendRectTargets(targets, entity, normalized);
    }
    return targets;
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

  private recycleLayer(layer: Container): void {
    const children = layer.removeChildren();
    for (const child of children) {
      if (child instanceof Graphics) {
        resetDisplayObject(child);
        child.clear();
        this.graphicsPool.push(child);
      } else if (child instanceof Sprite) {
        resetDisplayObject(child);
        child.anchor.set(0, 0);
        this.spritePool.push(child);
      } else {
        child.destroy({ children: true });
      }
    }
  }

  private takeGraphics(): Graphics {
    const item = this.graphicsPool.pop();
    if (item) {
      this.stats.graphicsReused += 1;
      item.clear();
      resetDisplayObject(item);
      return item;
    }
    this.stats.graphicsCreated += 1;
    return new Graphics();
  }

  private takeSprite(texture: Texture): Sprite {
    const item = this.spritePool.pop();
    if (item) {
      this.stats.spritesReused += 1;
      resetDisplayObject(item);
      item.texture = texture;
      return item;
    }
    this.stats.spritesCreated += 1;
    return new Sprite(texture);
  }

  private drawGrid(): void {
    const graphics = this.takeGraphics();
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

  private drawEntity(
    world: RuntimeWorld,
    entity: Entity,
    selectedPart?: CanvasTargetPart,
    showBodyMaterial = true,
    showEditorDecorations = true,
    resources: Record<string, Resource> = {},
    animationTimeMs = 0,
  ): void {
    const hasVisiblePresentation = Boolean(entity.render && entity.render.visible !== false);
    if (showBodyMaterial || !hasVisiblePresentation) this.drawBody(entity, selectedPart === "body", showBodyMaterial);
    this.drawPresentation(entity, selectedPart === "presentation", showEditorDecorations, resources, animationTimeMs);
    if (showEditorDecorations && entity.parentId) this.drawCoreLink(world, entity);
    if (showEditorDecorations && selectedPart) this.drawSelection(entity, selectedPart);
  }

  private drawBody(entity: Entity, selected: boolean, textured = true): void {
    const body = this.takeGraphics();
    const style = bodyMaterialStyle(entity);
    drawBodyShape(body, entity);
    body.fill({ color: style.fill, alpha: textured ? (selected ? style.selectedFillAlpha : style.fillAlpha) : 0.84 });
    body.setStrokeStyle({ width: selected ? 3 : 1.5, color: style.stroke, alpha: selected ? 1 : 0.86 });
    body.stroke();
    if (textured) drawBodyTexture(body, entity, style, selected);
    this.worldLayer.addChild(body);
  }

  private drawPresentation(
    entity: Entity,
    selected: boolean,
    showEditorDecorations: boolean,
    resources: Record<string, Resource> = {},
    animationTimeMs = 0,
  ): void {
    if (!entity.render || entity.render.visible === false) return;
    const resource = presentationResource(entity, resources);
    if (resource) {
      this.drawPresentationImage(entity, selected, showEditorDecorations, resource, animationTimeMs);
      return;
    }
    const presentation = this.takeGraphics();
    drawPresentationShape(presentation, entity);
    presentation.fill({ color: parseColor(entity.render.color || "#74a8bd"), alpha: entity.render.opacity ?? 1 });
    if (showEditorDecorations || selected) {
      presentation.setStrokeStyle({
        width: selected ? 2 : 1,
        color: selected ? 0x77b8df : 0x101211,
        alpha: selected ? 0.95 : 0.72,
      });
      presentation.stroke();
    }
    this.worldLayer.addChild(presentation);
    if (showEditorDecorations) this.drawPresentationLabel(entity, selected);
  }

  private drawPresentationImage(
    entity: Entity,
    selected: boolean,
    showEditorDecorations: boolean,
    resource: Resource,
    animationTimeMs: number,
  ): void {
    const geometry = targetGeometry(entity, "presentation");
    const pendingFrame = resourceFrameAtTime(resource, animationTimeMs);
    const imagePath = pendingFrame?.attachment.path;
    if (!imagePath) return;
    const texture = this.imageTextures.get(imagePath);
    if (!texture) {
      this.loadImageTexture(imagePath);
      const pending = this.takeGraphics();
      drawGeometryBox(pending, geometry);
      pending.fill({ color: 0x0b1f26, alpha: selected ? 0.48 : 0.32 });
      pending.setStrokeStyle({ width: selected ? 2 : 1, color: selected ? 0x77b8df : 0x101211, alpha: selected ? 0.95 : 0.72 });
      pending.stroke();
      this.worldLayer.addChild(pending);
      return;
    }
    const frame = resourceFrameAtTime(resource, animationTimeMs, { width: texture.width, height: texture.height }) || pendingFrame;
    const drawTexture = this.textureForFrame(texture, imagePath, frame?.rect);
    const sprite = this.takeSprite(drawTexture);
    const drawSize = containedImageSize(drawTexture, geometry);
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(geometry.center.x, geometry.center.y);
    sprite.rotation = geometry.rotation;
    sprite.width = drawSize.width;
    sprite.height = drawSize.height;
    sprite.alpha = entity.render?.opacity ?? 1;
    this.worldLayer.addChild(sprite);

    if (!showEditorDecorations && !selected) return;
    const outline = this.takeGraphics();
    drawGeometryBox(outline, geometry);
    outline.setStrokeStyle({
      width: selected ? 2 : 1,
      color: selected ? 0x77b8df : 0x101211,
      alpha: selected ? 0.95 : 0.72,
    });
    outline.stroke();
    this.worldLayer.addChild(outline);
  }

  private loadImageTexture(imagePath: string): void {
    if (this.imageTextureLoads.has(imagePath)) return;
    const load = Assets.load<Texture>(imagePath)
      .then((texture) => {
        this.imageTextures.set(imagePath, texture);
        if (this.lastRender) this.render(this.lastRender.world, this.lastRender.options);
      })
      .catch(() => undefined)
      .finally(() => {
        this.imageTextureLoads.delete(imagePath);
      });
    this.imageTextureLoads.set(imagePath, load);
  }

  private textureForFrame(texture: Texture, imagePath: string, rect: ResourceFrameRect | undefined): Texture {
    if (!rect) return texture;
    const key = `${imagePath}|${rect.x},${rect.y},${rect.width},${rect.height}`;
    const cached = this.frameTextures.get(key);
    if (cached) return cached;
    const frameTexture = new Texture({
      source: texture.source,
      frame: new Rectangle(rect.x, rect.y, rect.width, rect.height),
    });
    this.frameTextures.set(key, frameTexture);
    return frameTexture;
  }

  private drawPresentationLabel(entity: Entity, selected: boolean): void {
    if (!entity.render || entity.render.visible === false) return;
    const geometry = targetGeometry(entity, "presentation");
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
    label.position.set(geometry.center.x, geometry.center.y);
    label.rotation = geometry.rotation;
    this.worldLayer.addChild(label);
  }

  private drawCoreLink(world: RuntimeWorld, entity: Entity): void {
    const parent = world.entityById(entity.parentId);
    if (!parent) return;
    const from = parent.transform.position;
    const to = entity.transform.position;
    if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) < 2) return;
    const link = this.takeGraphics();
    link.setStrokeStyle({ width: 1, color: 0xd7a84a, alpha: 0.72 });
    link.moveTo(from.x, from.y);
    link.lineTo(to.x, to.y);
    link.stroke();
    this.overlayLayer.addChild(link);
  }

  private drawSelection(entity: Entity, part: CanvasTargetPart): void {
    const overlay = this.takeGraphics();
    const handles = selectionHandles(entity, part);
    const corners = handles.filter((handle) => cornerHandleOrder.includes(handle.kind as (typeof cornerHandleOrder)[number]));
    const edges = handles.filter((handle) => edgeHandleOrder.includes(handle.kind as (typeof edgeHandleOrder)[number]));
    const rotateHandle = handles.find((handle) => handle.kind === "rotate");
    const core = handles.find((handle) => handle.kind === "core");
    const color = part === "presentation" ? 0x77b8df : bodyMaterialStyle(entity).stroke;
    overlay.setStrokeStyle({ width: 1, color, alpha: 0.9 });
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
      overlay.fill({ color, alpha: 1 });
    }
    for (const handle of [...corners, ...edges]) {
      const radius = handle.kind.includes("-") ? 3 : 4;
      overlay.rect(handle.position.x - radius, handle.position.y - radius, radius * 2, radius * 2);
      overlay.fill({ color: 0x101211, alpha: 1 });
      overlay.setStrokeStyle({ width: 1, color, alpha: 1 });
      overlay.stroke();
    }
    if (rotateHandle) {
      overlay.circle(rotateHandle.position.x, rotateHandle.position.y, 5);
      overlay.fill({ color: 0x101211, alpha: 1 });
      overlay.setStrokeStyle({ width: 1, color, alpha: 1 });
      overlay.stroke();
    }
    this.overlayLayer.addChild(overlay);
  }

  private drawTaskPreview(context?: BrushContext, live = false): void {
    if (!context) return;
    const graphics = this.takeGraphics();
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

  private drawShapeDraft(draft?: ShapeDraftPreview): void {
    if (!draft || draft.points.length === 0) return;
    const graphics = this.takeGraphics();
    graphics.setStrokeStyle({ width: 2, color: 0x86d36c, alpha: 0.95 });
    const [first, ...rest] = draft.points;
    graphics.moveTo(first.x, first.y);
    rest.forEach((point) => graphics.lineTo(point.x, point.y));
    if (draft.closed && draft.points.length >= 3) graphics.closePath();
    if (draft.closed && draft.points.length >= 3) graphics.fill({ color: 0x86d36c, alpha: 0.12 });
    graphics.stroke();
    for (const point of draft.points) {
      graphics.circle(point.x, point.y, 3.5);
      graphics.fill({ color: 0x101211, alpha: 1 });
      graphics.setStrokeStyle({ width: 1, color: 0x86d36c, alpha: 1 });
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

function bodyMaterialStyle(entity: Entity): BodyMaterialStyle {
  if (entity.collider?.trigger) {
    return {
      stroke: 0xb98cff,
      fill: 0x201329,
      texture: 0xf0e5ff,
      fillAlpha: 0.12,
      selectedFillAlpha: 0.22,
      textureAlpha: 0.28,
      selectedTextureAlpha: 0.5,
    };
  }
  if (entity.body?.mode === "dynamic" || entity.body?.mode === "kinematic") {
    return {
      stroke: 0x55d4ff,
      fill: 0x082733,
      texture: 0xd9f8ff,
      fillAlpha: 0.42,
      selectedFillAlpha: 0.52,
      textureAlpha: 0.24,
      selectedTextureAlpha: 0.48,
    };
  }
  if (entity.body?.mode === "none" || entity.collider?.solid === false) {
    return {
      stroke: 0x77817b,
      fill: 0x171a18,
      texture: 0xa9b1ab,
      fillAlpha: 0.36,
      selectedFillAlpha: 0.46,
      textureAlpha: 0.12,
      selectedTextureAlpha: 0.28,
    };
  }
  return {
    stroke: 0xf1efe7,
    fill: 0x101211,
    texture: 0xffffff,
    fillAlpha: 0.48,
    selectedFillAlpha: 0.58,
    textureAlpha: 0.18,
    selectedTextureAlpha: 0.42,
  };
}

const cornerHandleOrder = ["scale-nw", "scale-ne", "scale-se", "scale-sw"] as const;
const edgeHandleOrder = ["scale-n", "scale-e", "scale-s", "scale-w"] as const;

function selectionHandles(entity: Entity, part: CanvasTargetPart): Array<{ kind: TransformHandle; position: Vec2; radius: number }> {
  const geometry = targetGeometry(entity, part);
  const hw = geometry.width / 2 + 5;
  const hh = geometry.height / 2 + 5;
  const corners = [
    { kind: "scale-nw" as const, local: { x: -hw, y: -hh } },
    { kind: "scale-ne" as const, local: { x: hw, y: -hh } },
    { kind: "scale-se" as const, local: { x: hw, y: hh } },
    { kind: "scale-sw" as const, local: { x: -hw, y: hh } },
  ];
  const edges = [
    { kind: "scale-n" as const, local: { x: 0, y: -hh } },
    { kind: "scale-e" as const, local: { x: hw, y: 0 } },
    { kind: "scale-s" as const, local: { x: 0, y: hh } },
    { kind: "scale-w" as const, local: { x: -hw, y: 0 } },
  ];
  return [
    ...corners.map((corner) => ({ kind: corner.kind, position: fromLocal(geometry.center, corner.local, geometry.rotation), radius: 9 })),
    ...edges.map((edge) => ({ kind: edge.kind, position: fromLocal(geometry.center, edge.local, geometry.rotation), radius: 8 })),
    { kind: "rotate", position: fromLocal(geometry.center, { x: 0, y: -hh - 28 }, geometry.rotation), radius: 10 },
    { kind: "core", position: geometry.center, radius: 8 },
  ];
}

function appendCanvasHitTargets(targets: PickedCanvasTarget[], entity: Entity, point: Vec2): void {
  if (entity.render && entity.render.visible !== false && pointInTarget(entity, "presentation", point)) {
    targets.push({ entity, part: "presentation" });
  }
  if (entity.collider && pointInTarget(entity, "body", point)) targets.push({ entity, part: "body" });
}

function appendRectTargets(
  targets: PickedCanvasTarget[],
  entity: Entity,
  rect: { x: number; y: number; w: number; h: number },
): void {
  if (entity.collider) {
    const polygon = bodyWorldPolygon(entity);
    const bodyRect = polygon ? pointsAabb(polygon) : geometryAabb(targetGeometry(entity, "body"));
    if (rectsIntersect(rect, bodyRect) && (!polygon || rectIntersectsPolygon(rect, polygon))) {
      targets.push({ entity, part: "body" });
    }
  }
  if (entity.render && entity.render.visible !== false) {
    const presentationRect = geometryAabb(targetGeometry(entity, "presentation"));
    if (rectsIntersect(rect, presentationRect)) targets.push({ entity, part: "presentation" });
  }
}

function pointInTarget(entity: Entity, part: CanvasTargetPart, point: Vec2): boolean {
  if (part === "body") {
    const polygon = bodyWorldPolygon(entity);
    if (polygon) return pointInPolygon(point, polygon);
  }
  const geometry = targetGeometry(entity, part);
  const local = toLocal(geometry.center, point, geometry.rotation);
  if (part === "body" && entity.collider?.shape === "circle") {
    const rx = geometry.width / 2;
    const ry = geometry.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    return (local.x * local.x) / (rx * rx) + (local.y * local.y) / (ry * ry) <= 1;
  }
  return Math.abs(local.x) <= geometry.width / 2 && Math.abs(local.y) <= geometry.height / 2;
}

function bodyWorldPolygon(entity: Entity): Vec2[] | undefined {
  if (entity.collider?.shape !== "polygon" || !entity.collider.points || entity.collider.points.length < 3) return undefined;
  const geometry = targetGeometry(entity, "body");
  const scale = entity.transform.scale || { x: 1, y: 1 };
  return entity.collider.points.map((point) =>
    fromLocal(
      geometry.center,
      {
        x: point.x * Math.max(Math.abs(scale.x), 0.08),
        y: point.y * Math.max(Math.abs(scale.y), 0.08),
      },
      geometry.rotation,
    ),
  );
}

function pointsAabb(points: Vec2[]): { x: number; y: number; w: number; h: number } {
  const first = points[0];
  let minX = first?.x || 0;
  let maxX = minX;
  let minY = first?.y || 0;
  let maxY = minY;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function rectIntersectsPolygon(rect: { x: number; y: number; w: number; h: number }, polygon: Vec2[]): boolean {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true;
  if (polygon.some((point) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
      if (segmentsIntersect(start, end, corners[cornerIndex], corners[(cornerIndex + 1) % corners.length])) return true;
    }
  }
  return false;
}

function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects = current.y > point.y !== previous.y > point.y && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || 0.000001) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const ab1 = cross(subtract(c, a), subtract(b, a));
  const ab2 = cross(subtract(d, a), subtract(b, a));
  const cd1 = cross(subtract(a, c), subtract(d, c));
  const cd2 = cross(subtract(b, c), subtract(d, c));
  return ab1 * ab2 <= 0 && cd1 * cd2 <= 0;
}

function subtract(left: Vec2, right: Vec2): Vec2 {
  return { x: left.x - right.x, y: left.y - right.y };
}

function cross(left: Vec2, right: Vec2): number {
  return left.x * right.y - left.y * right.x;
}

function geometryAabb(geometry: { center: Vec2; rotation: number; width: number; height: number }): { x: number; y: number; w: number; h: number } {
  const hw = geometry.width / 2;
  const hh = geometry.height / 2;
  const points = [
    fromLocal(geometry.center, { x: -hw, y: -hh }, geometry.rotation),
    fromLocal(geometry.center, { x: hw, y: -hh }, geometry.rotation),
    fromLocal(geometry.center, { x: hw, y: hh }, geometry.rotation),
    fromLocal(geometry.center, { x: -hw, y: hh }, geometry.rotation),
  ];
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

function normalizeRect(rect: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const x = rect.w < 0 ? rect.x + rect.w : rect.x;
  const y = rect.h < 0 ? rect.y + rect.h : rect.y;
  return { x, y, w: Math.abs(rect.w), h: Math.abs(rect.h) };
}

function rectsIntersect(left: { x: number; y: number; w: number; h: number }, right: { x: number; y: number; w: number; h: number }): boolean {
  return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

function targetGeometry(entity: Entity, part: CanvasTargetPart): { center: Vec2; rotation: number; width: number; height: number } {
  const transformScale = entity.transform.scale || { x: 1, y: 1 };
  if (part === "presentation") {
    const bodySize = entity.collider?.size || { x: 60, y: 60 };
    const size = entity.render?.size || { x: Math.max(12, bodySize.x), y: Math.max(12, bodySize.y) };
    const scale = entity.render?.scale || { x: 1, y: 1 };
    const offset = entity.render?.offset || { x: 0, y: 0 };
    return {
      center: {
        x: entity.transform.position.x + offset.x,
        y: entity.transform.position.y + offset.y,
      },
      rotation: (entity.transform.rotation || 0) + (entity.render?.rotation || 0),
      width: size.x * Math.max(Math.abs(scale.x), 0.08) * Math.max(Math.abs(transformScale.x), 0.08),
      height: size.y * Math.max(Math.abs(scale.y), 0.08) * Math.max(Math.abs(transformScale.y), 0.08),
    };
  }
  const size = entity.collider?.size || entity.render?.size || { x: 60, y: 60 };
  const offset = entity.collider?.offset || { x: 0, y: 0 };
  return {
    center: {
      x: entity.transform.position.x + offset.x,
      y: entity.transform.position.y + offset.y,
    },
    rotation: (entity.transform.rotation || 0) + (entity.collider?.rotation || 0),
    width: size.x * Math.max(Math.abs(transformScale.x), 0.08),
    height: size.y * Math.max(Math.abs(transformScale.y), 0.08),
  };
}

function drawBodyShape(graphics: Graphics, entity: Entity): void {
  const geometry = targetGeometry(entity, "body");
  const hw = geometry.width / 2;
  const hh = geometry.height / 2;
  if (entity.collider?.shape === "circle") {
    graphics.ellipse(geometry.center.x, geometry.center.y, hw, hh);
    return;
  }
  const points =
    entity.collider?.shape === "polygon" && entity.collider.points?.length
      ? entity.collider.points.map((point) => ({
          x: point.x * Math.max(Math.abs(entity.transform.scale.x), 0.08),
          y: point.y * Math.max(Math.abs(entity.transform.scale.y), 0.08),
        }))
      : [
          { x: -hw, y: -hh },
          { x: hw, y: -hh },
          { x: hw, y: hh },
          { x: -hw, y: hh },
        ];
  const [first, ...rest] = points.map((point) => fromLocal(geometry.center, point, geometry.rotation));
  if (!first) return;
  graphics.moveTo(first.x, first.y);
  rest.forEach((point) => graphics.lineTo(point.x, point.y));
  graphics.closePath();
}

function drawPresentationShape(graphics: Graphics, entity: Entity): void {
  const geometry = targetGeometry(entity, "presentation");
  drawGeometryBox(graphics, geometry);
}

function presentationResource(entity: Entity, resources: Record<string, Resource>): Resource | undefined {
  const resourceId = entity.render?.resourceId;
  const resource = resourceId ? resources[resourceId] : undefined;
  return isVisualResource(resource) ? resource : undefined;
}

function containedImageSize(texture: Texture, box: { width: number; height: number }): { width: number; height: number } {
  const sourceWidth = texture.width || box.width;
  const sourceHeight = texture.height || box.height;
  if (sourceWidth <= 0 || sourceHeight <= 0 || box.width <= 0 || box.height <= 0) return { width: box.width, height: box.height };
  const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  };
}

function drawBodyTexture(graphics: Graphics, entity: Entity, style: BodyMaterialStyle, selected: boolean): void {
  if (entity.collider?.shape === "polygon") return;
  const geometry = targetGeometry(entity, "body");
  const hw = geometry.width / 2;
  const hh = geometry.height / 2;
  if (hw <= 0 || hh <= 0) return;
  const step = clamp(Math.min(geometry.width, geometry.height) / 4, 10, 18);
  graphics.setStrokeStyle({
    width: 1,
    color: style.texture,
    alpha: selected ? style.selectedTextureAlpha : style.textureAlpha,
  });

  if (entity.collider?.shape === "circle") {
    for (let x = -hw + step; x < hw; x += step) {
      const yLimit = hh * Math.sqrt(Math.max(0, 1 - (x * x) / (hw * hw)));
      drawLocalLine(graphics, geometry, { x, y: -yLimit }, { x, y: yLimit });
    }
    for (let y = -hh + step; y < hh; y += step) {
      const xLimit = hw * Math.sqrt(Math.max(0, 1 - (y * y) / (hh * hh)));
      drawLocalLine(graphics, geometry, { x: -xLimit, y }, { x: xLimit, y });
    }
    graphics.stroke();
    return;
  }

  for (let x = -hw + step; x < hw; x += step) {
    drawLocalLine(graphics, geometry, { x, y: -hh }, { x, y: hh });
  }
  for (let y = -hh + step; y < hh; y += step) {
    drawLocalLine(graphics, geometry, { x: -hw, y }, { x: hw, y });
  }
  graphics.stroke();
}

function drawGeometryBox(graphics: Graphics, geometry: { center: Vec2; rotation: number; width: number; height: number }): void {
  const hw = geometry.width / 2;
  const hh = geometry.height / 2;
  const points = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((point) => fromLocal(geometry.center, point, geometry.rotation));
  const [first, ...rest] = points;
  graphics.moveTo(first.x, first.y);
  rest.forEach((point) => graphics.lineTo(point.x, point.y));
  graphics.closePath();
}

function drawLocalLine(
  graphics: Graphics,
  geometry: { center: Vec2; rotation: number },
  from: Vec2,
  to: Vec2,
): void {
  const start = fromLocal(geometry.center, from, geometry.rotation);
  const end = fromLocal(geometry.center, to, geometry.rotation);
  graphics.moveTo(start.x, start.y);
  graphics.lineTo(end.x, end.y);
}

function fromLocal(center: Vec2, local: Vec2, rotation: number): Vec2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + local.x * cos - local.y * sin,
    y: center.y + local.x * sin + local.y * cos,
  };
}

function toLocal(center: Vec2, point: Vec2, rotation: number): Vec2 {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resetDisplayObject(item: Graphics | Sprite): void {
  item.position.set(0, 0);
  item.scale.set(1, 1);
  item.rotation = 0;
  item.alpha = 1;
  item.visible = true;
}

function parseColor(value: string): number {
  const normalized = value.startsWith("#") ? value.slice(1) : value;
  return Number.parseInt(normalized, 16);
}
