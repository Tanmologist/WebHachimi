import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import type { BrushContext, Entity, Resource, Task } from "../project/schema";
import { boundsFor } from "../runtime/collision";
import type { RuntimeWorld } from "../runtime/world";
import type { Vec2 } from "../shared/types";
import { entityHasVisiblePresentation, isAttackTouchEntity, isGameplayDebugEntity } from "../project/entityVisibility";
import { isVisualResource, resourceEffectFrameAtTime, resourceFrameAtTime, type ResourceFrameRect } from "./resourceAnimation";
import {
  centerViewportOnWorldPoint,
  clampViewportZoom,
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

export type PickCanvasTargetOptions = {
  excludeBody?: boolean;
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

const MIN_SCALE_EPSILON = 0.08;

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
  private destroyed = false;

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
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.removeResizeFallback?.();
    this.frameTextures.forEach((texture) => texture.destroy(false));
    this.frameTextures.clear();
    this.lastRender = undefined;
    this.destroyPools();
    const appWithResizeHook = this.app as Application & { _cancelResize?: () => void };
    if (typeof appWithResizeHook._cancelResize !== "function") appWithResizeHook._cancelResize = () => {};
    try {
      if (this.hasLiveRenderer()) this.app.destroy(true);
    } catch {
      this.app.canvas?.remove();
    }
  }

  canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  render(world: RuntimeWorld, options: RenderOverlayOptions = {}): void {
    if (!this.hasLiveRenderer()) return;
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
    const isMultiSelect = selectedIds && selectedIds.size > 1;
    if (showBodyMaterial) this.drawGrid();
    if (!showEditorDecorations) {
      this.drawGameplayAttackTelegraphs(world);
      this.drawGameplayChargeStates(world);
    }
    for (const entity of entities) {
      const selectedPart = !isMultiSelect && selectedIds?.has(entity.id)
        ? entity.id === options.selectedId
          ? options.selectedPart || "body"
          : "body"
        : undefined;
      this.drawEntity(world, entity, selectedPart, showBodyMaterial, showEditorDecorations, resources, options.animationTimeMs || 0);
    }
    if (showEditorDecorations) {
      if (isMultiSelect) {
        const selectedEntities = entities.filter((e) => selectedIds!.has(e.id));
        this.drawMultiSelection(selectedEntities);
      }
      this.drawTaskPreview(world, options.previewTask?.brushContext);
      this.drawTaskPreview(world, options.liveBrush, true);
      this.drawShapeDraft(options.shapeDraft);
    } else {
      entities.forEach((entity) => this.drawGameplayHealthBar(entity, world.clock.frame));
    }
    this.stats.visibleObjects = this.worldLayer.children.length + this.overlayLayer.children.length;
    this.stats.renderedAt = performance.now();
    this.stats.renderMs = this.stats.renderedAt - started;
  }

  performanceStats(): Readonly<RendererStats> {
    return this.stats;
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

  centerOnWorldPoint(point: Vec2, zoom?: number): ViewportState {
    this.viewport = centerViewportOnWorldPoint(this.viewport, point, zoom);
    this.layoutWorld();
    return this.viewportState();
  }

  fitWorldBounds(bounds: { x: number; y: number; w: number; h: number }, padding = 96): ViewportState {
    const screen = this.screenSize();
    const width = Math.max(1, bounds.w);
    const height = Math.max(1, bounds.h);
    const usableWidth = Math.max(1, screen.width - padding * 2);
    const usableHeight = Math.max(1, screen.height - padding * 2);
    const zoom = clampViewportZoom(Math.min(usableWidth / width, usableHeight / height, 1.25));
    this.viewport = centerViewportOnWorldPoint(
      this.viewport,
      {
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h / 2,
      },
      zoom,
    );
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

  pickCanvasTarget(world: RuntimeWorld, point: Vec2, currentSelection?: CanvasSelection, options?: PickCanvasTargetOptions): PickedCanvasTarget | undefined {
    const hits: PickedCanvasTarget[] = [];
    const entities = world.allEntities();
    for (let index = entities.length - 1; index >= 0; index -= 1) {
      appendCanvasHitTargets(hits, entities[index], point);
    }
    const filtered = options?.excludeBody ? hits.filter((h) => h.part !== "body") : hits;
    if (filtered.length <= 1) return filtered[0];
    const selectedIndex = filtered.findIndex(
      (hit) => hit.entity.id === currentSelection?.entityId && hit.part === currentSelection.part,
    );
    return filtered[(selectedIndex + 1) % filtered.length] || filtered[0];
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

  private destroyPools(): void {
    for (const item of this.graphicsPool.splice(0)) item.destroy();
    for (const item of this.spritePool.splice(0)) item.destroy();
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
    if (!this.hasLiveRenderer()) return { width: 1, height: 1 };
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  private clientToLocalPoint(clientX: number, clientY: number): Vec2 {
    if (!this.hasLiveRenderer()) return { x: 0, y: 0 };
    const rect = this.app.canvas.getBoundingClientRect();
    const screen = this.screenSize();
    const scaleX = rect.width ? screen.width / rect.width : 1;
    const scaleY = rect.height ? screen.height / rect.height : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  private hasLiveRenderer(): boolean {
    return Boolean((this.app as unknown as { renderer?: unknown }).renderer);
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
    if (!showEditorDecorations && isGameplayDebugEntity(entity)) return;
    const hasVisiblePresentation = entityHasVisiblePresentation(entity);
    if ((showBodyMaterial && !hasVisiblePresentation) || (showEditorDecorations && !hasVisiblePresentation)) {
      this.drawBody(entity, selectedPart === "body", showBodyMaterial);
    }
    this.drawPresentation(
      world,
      entity,
      selectedPart === "presentation",
      showEditorDecorations,
      resources,
      presentationAnimationTimeMs(entity, world, animationTimeMs),
    );
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
    world: RuntimeWorld,
    entity: Entity,
    selected: boolean,
    showEditorDecorations: boolean,
    resources: Record<string, Resource> = {},
    animationTimeMs = 0,
  ): void {
    if (!entity.render || entity.render.visible === false) return;
    const resource = presentationResource(entity, resources);
    if (resource) {
      this.drawPresentationImage(world, entity, selected, showEditorDecorations, resource, animationTimeMs);
      return;
    }
    const attackTouch = isAttackTouchEntity(entity);
    const presentation = this.takeGraphics();
    drawPresentationShape(presentation, entity);
    presentation.fill({
      color: attackTouch ? 0xff4d5d : parseColor(entity.render.color || "#74a8bd"),
      alpha: attackTouch ? Math.max(entity.render.opacity ?? 0, 0.48) : entity.render.opacity ?? 1,
    });
    if (showEditorDecorations || selected || attackTouch) {
      presentation.setStrokeStyle({
        width: attackTouch ? 3 : selected ? 2 : 1,
        color: attackTouch ? 0xfff1a8 : selected ? 0x77b8df : 0x101211,
        alpha: attackTouch ? 0.98 : selected ? 0.95 : 0.72,
      });
      presentation.stroke();
    }
    this.worldLayer.addChild(presentation);
    if (attackTouch) this.drawCombatDebugLabel(entity, "TOUCH BOX");
    if (showEditorDecorations) this.drawPresentationLabel(entity, selected);
  }

  private drawPresentationImage(
    world: RuntimeWorld,
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
      if (!showEditorDecorations) return;
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
    const effectFrame = resourceEffectActiveInContext(resource, entity, world, showEditorDecorations)
      ? resourceEffectFrameAtTime(resource, resourceEffectTimeMs(resource, entity, world, animationTimeMs), { previewLoop: showEditorDecorations })
      : { alphaMultiplier: 1, scaleMultiplier: 1 };
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(geometry.center.x, geometry.center.y);
    sprite.rotation = geometry.rotation;
    sprite.width = drawSize.width * effectFrame.scaleMultiplier;
    sprite.height = drawSize.height * effectFrame.scaleMultiplier;
    sprite.alpha = (entity.render?.opacity ?? 1) * effectFrame.alphaMultiplier;
    if (effectFrame.tint !== undefined) sprite.tint = effectFrame.tint;
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

  private drawGameplayAttackTelegraphs(world: RuntimeWorld): void {
    const frame = world.clock.frame;
    for (const entity of world.allEntities()) {
      if (entity.runtime?.defeated || !entity.collider) continue;
      const start = entity.runtime?.attackStartFrame;
      const activeUntil = entity.runtime?.attackActiveUntilFrame;
      const cooldownUntil = entity.runtime?.attackCooldownUntilFrame;
      if (start === undefined || activeUntil === undefined || cooldownUntil === undefined || frame >= cooldownUntil) continue;
      if (frame > activeUntil) {
        const bounds = boundsFor(entity);
        const graphics = this.takeGraphics();
        graphics.roundRect(bounds.x - 5, bounds.y - 5, bounds.w + 10, bounds.h + 10, 8);
        graphics.setStrokeStyle({ width: 2, color: 0x9aa0a6, alpha: 0.72 });
        graphics.stroke();
        this.worldLayer.addChild(graphics);
        this.drawCombatRectLabel({ x: bounds.x, y: bounds.y - 6, w: bounds.w, h: 1 }, "RECOVERY");
        continue;
      }
      const rect = gameplayAttackRect(entity);
      const graphics = this.takeGraphics();
      graphics.rect(rect.x, rect.y, rect.w, rect.h);
      if (frame < start) {
        graphics.fill({ color: 0xffd166, alpha: 0.18 });
        graphics.setStrokeStyle({ width: 2, color: 0xffd166, alpha: 0.68 });
      } else {
        graphics.fill({ color: 0xff4d5d, alpha: 0.24 });
        graphics.setStrokeStyle({ width: 3, color: 0xff4d5d, alpha: 0.82 });
      }
      graphics.stroke();
      this.worldLayer.addChild(graphics);
      this.drawCombatRectLabel(rect, frame < start ? "WINDUP" : "ACTIVE");
    }
  }

  private drawGameplayChargeStates(world: RuntimeWorld): void {
    const frame = world.clock.frame;
    for (const entity of world.allEntities()) {
      if (entity.runtime?.defeated || !entity.collider) continue;
      const charging = (entity.runtime?.chargeHeldFrames ?? 0) > 0;
      const superReady = frame <= (entity.runtime?.superParryUntilFrame ?? -1);
      if (!charging && !superReady) continue;
      const bounds = boundsFor(entity);
      const graphics = this.takeGraphics();
      const pulse = 0.5 + Math.sin(frame * 0.32) * 0.18;
      graphics.roundRect(bounds.x - 8, bounds.y - 8, bounds.w + 16, bounds.h + 16, 10);
      graphics.setStrokeStyle({ width: superReady ? 4 : 3, color: superReady ? 0xb8fff0 : 0x69b7ff, alpha: superReady ? 0.9 : pulse });
      graphics.stroke();
      this.worldLayer.addChild(graphics);
      const stage = entity.runtime?.chargeStage ?? 0;
      this.drawCombatRectLabel(
        { x: bounds.x, y: bounds.y - 18, w: bounds.w, h: 1 },
        superReady ? "SUPER" : stage > 0 ? `CHARGE ${stage}` : "CHARGING",
      );
    }
  }

  private drawGameplayHealthBar(entity: Entity, frame: number): void {
    const maxHealth = readNumberParam(entity, "health");
    const health = entity.runtime?.health ?? maxHealth;
    if (maxHealth === undefined || health === undefined) return;
    if (!entity.behavior && !entity.tags.some((tag) => gameplayTag(tag))) return;
    const bounds = boundsFor(entity);
    const width = Math.max(38, Math.min(96, bounds.w * 1.25));
    const height = 6;
    const x = bounds.x + bounds.w / 2 - width / 2;
    const y = bounds.y - 16;
    const ratio = clamp(health / Math.max(1, maxHealth), 0, 1);
    const bar = this.takeGraphics();
    bar.roundRect(x, y, width, height, 3);
    bar.fill({ color: 0x111817, alpha: 0.78 });
    bar.roundRect(x + 1, y + 1, Math.max(0, (width - 2) * ratio), height - 2, 2);
    bar.fill({ color: entity.runtime?.defeated ? 0x6f756c : frame <= (entity.runtime?.hitFlashUntilFrame ?? -1) ? 0xf2d16b : 0x79d6ba, alpha: 0.95 });
    this.worldLayer.addChild(bar);
  }

  private loadImageTexture(imagePath: string): void {
    if (this.imageTextureLoads.has(imagePath)) return;
    const load = Assets.load<Texture>(imagePath)
      .then((texture) => {
        this.imageTextures.set(imagePath, texture);
        if (this.lastRender && this.hasLiveRenderer()) this.render(this.lastRender.world, this.lastRender.options);
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

  private drawCombatDebugLabel(entity: Entity, text: string): void {
    const geometry = targetGeometry(entity, "presentation");
    const label = new Text({
      text,
      style: {
        fill: "#fff1a8",
        fontFamily: "Inter, Microsoft YaHei, sans-serif",
        fontSize: 12,
        fontWeight: "800",
      },
    });
    label.anchor.set(0.5, 1);
    label.position.set(geometry.center.x, geometry.center.y - geometry.height / 2 - 4);
    this.worldLayer.addChild(label);
  }

  private drawCombatRectLabel(rect: { x: number; y: number; w: number; h: number }, text: string): void {
    const label = new Text({
      text,
      style: {
        fill: text === "ACTIVE" ? "#ffd9de" : "#ffe9a9",
        fontFamily: "Inter, Microsoft YaHei, sans-serif",
        fontSize: 11,
        fontWeight: "800",
      },
    });
    label.anchor.set(0.5, 1);
    label.position.set(rect.x + rect.w / 2, rect.y - 4);
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
      overlay.setStrokeStyle({ width: 2, color: 0x4ecdc4, alpha: 1 });
      overlay.circle(core.position.x, core.position.y, 6);
      overlay.stroke();
      overlay.circle(core.position.x, core.position.y, 3);
      overlay.fill({ color: 0x4ecdc4, alpha: 1 });
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

  private drawMultiSelection(entities: Entity[]): void {
    const bounds = computeMultiSelectionBounds(entities);
    const overlay = this.takeGraphics();
    const color = 0xd7a84a;
    const hw = bounds.width / 2 + 5;
    const hh = bounds.height / 2 + 5;

    overlay.setStrokeStyle({ width: 1, color, alpha: 0.9 });
    overlay.rect(bounds.center.x - hw, bounds.center.y - hh, hw * 2, hh * 2);
    overlay.stroke();

    const handles = multiSelectionHandles(bounds);

    for (const corner of handles.corners) {
      overlay.rect(corner.x - 4, corner.y - 4, 8, 8);
      overlay.fill({ color: 0x101211, alpha: 1 });
      overlay.setStrokeStyle({ width: 1, color, alpha: 1 });
      overlay.stroke();
    }
    for (const edge of handles.edges) {
      overlay.rect(edge.x - 3, edge.y - 3, 6, 6);
      overlay.fill({ color: 0x101211, alpha: 1 });
      overlay.setStrokeStyle({ width: 1, color, alpha: 1 });
      overlay.stroke();
    }

    overlay.moveTo(bounds.center.x, bounds.center.y - hh);
    overlay.lineTo(bounds.center.x, handles.rotate.y);
    overlay.stroke();
    overlay.circle(bounds.center.x, handles.rotate.y, 5);
    overlay.fill({ color: 0x101211, alpha: 1 });
    overlay.setStrokeStyle({ width: 1, color, alpha: 1 });
    overlay.stroke();

    overlay.setStrokeStyle({ width: 2, color: 0x4ecdc4, alpha: 1 });
    overlay.circle(bounds.center.x, bounds.center.y, 6);
    overlay.stroke();
    overlay.circle(bounds.center.x, bounds.center.y, 3);
    overlay.fill({ color: 0x4ecdc4, alpha: 1 });

    this.overlayLayer.addChild(overlay);
  }

  pickMultiTransformHandle(entities: Entity[], point: Vec2): TransformHandle | undefined {
    const bounds = computeMultiSelectionBounds(entities);
    const handles = multiSelectionHandles(bounds);

    const all: Array<{ kind: TransformHandle; position: Vec2; radius: number }> = [
      { kind: "scale-nw", position: handles.corners[0], radius: 9 },
      { kind: "scale-ne", position: handles.corners[1], radius: 9 },
      { kind: "scale-se", position: handles.corners[2], radius: 9 },
      { kind: "scale-sw", position: handles.corners[3], radius: 9 },
      { kind: "scale-n", position: handles.edges[0], radius: 8 },
      { kind: "scale-e", position: handles.edges[1], radius: 8 },
      { kind: "scale-s", position: handles.edges[2], radius: 8 },
      { kind: "scale-w", position: handles.edges[3], radius: 8 },
      { kind: "rotate", position: handles.rotate, radius: 10 },
      { kind: "core", position: bounds.center, radius: 8 },
    ];

    for (const handle of all) {
      if (Math.hypot(point.x - handle.position.x, point.y - handle.position.y) <= handle.radius) return handle.kind;
    }
    return undefined;
  }

  private drawTaskPreview(world: RuntimeWorld, context?: BrushContext, live = false): void {
    if (!context) return;
    const graphics = this.takeGraphics();
    const pixel = 1 / Math.max(this.viewport.zoom, 0.1);
    const accent = live ? 0x40c89c : 0xd7a84a;
    const targetIds = new Set(context.targetEntityIds);
    for (const entity of world.allEntities()) {
      if (!targetIds.has(entity.id)) continue;
      this.drawBrushTargetHighlight(graphics, entity, accent, pixel, live);
    }
    if (context.selectionBox) {
      graphics.rect(context.selectionBox.x, context.selectionBox.y, context.selectionBox.w, context.selectionBox.h);
      graphics.fill({ color: accent, alpha: live ? 0.09 : 0.06 });
      graphics.setStrokeStyle({ width: 2 * pixel, color: accent, alpha: live ? 0.92 : 0.78 });
      graphics.stroke();
    }
    for (const stroke of context.strokes) {
      if (stroke.points.length < 2) continue;
      const width = Math.max(stroke.width, live ? 4 : 3) * pixel;
      graphics.setStrokeStyle({ width: width + 4 * pixel, color: 0x0b1110, alpha: live ? 0.72 : 0.58 });
      drawPolyline(graphics, stroke.points);
      graphics.stroke();
      graphics.setStrokeStyle({
        width,
        color: parseColor(stroke.color),
        alpha: live ? 0.96 : 0.82,
      });
      drawPolyline(graphics, stroke.points);
      graphics.stroke();
      const last = stroke.points[stroke.points.length - 1];
      graphics.circle(last.x, last.y, Math.max(3.5 * pixel, width * 0.7));
      graphics.fill({ color: parseColor(stroke.color), alpha: live ? 0.96 : 0.82 });
      graphics.setStrokeStyle({ width: 1.5 * pixel, color: 0x0b1110, alpha: 0.72 });
      graphics.stroke();
    }
    this.overlayLayer.addChild(graphics);
    for (const annotation of context.annotations) this.drawBrushAnnotation(annotation.text, annotation.position, accent, pixel, live);
  }

  private drawBrushTargetHighlight(graphics: Graphics, entity: Entity, color: number, pixel: number, live: boolean): void {
    if (entity.collider) {
      drawBodyShape(graphics, entity);
      graphics.fill({ color, alpha: live ? 0.08 : 0.05 });
      graphics.setStrokeStyle({ width: 2.25 * pixel, color, alpha: live ? 0.92 : 0.72 });
      graphics.stroke();
    }
    if (entity.render && entity.render.visible !== false) {
      drawGeometryBox(graphics, targetGeometry(entity, "presentation"));
      graphics.setStrokeStyle({ width: 1.75 * pixel, color, alpha: live ? 0.82 : 0.62 });
      graphics.stroke();
    }
  }

  private drawBrushAnnotation(text: string, position: Vec2, color: number, pixel: number, live: boolean): void {
    const label = new Text({
      text,
      style: {
        fill: live ? "#f6fffb" : "#fff5d8",
        fontFamily: "Inter, Microsoft YaHei, sans-serif",
        fontSize: 11,
        fontWeight: "700",
      },
    });
    label.position.set(position.x + 6 * pixel, position.y - 6 * pixel);
    label.scale.set(pixel);
    label.alpha = live ? 0.96 : 0.84;
    this.overlayLayer.addChild(label);

    const marker = this.takeGraphics();
    marker.circle(position.x, position.y, 4 * pixel);
    marker.fill({ color, alpha: live ? 0.94 : 0.78 });
    marker.setStrokeStyle({ width: 1.5 * pixel, color: 0x0b1110, alpha: 0.72 });
    marker.stroke();
    this.overlayLayer.addChild(marker);
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

function drawPolyline(graphics: Graphics, points: Vec2[]): void {
  const [first, ...rest] = points;
  if (!first) return;
  graphics.moveTo(first.x, first.y);
  rest.forEach((point) => graphics.lineTo(point.x, point.y));
}

function gridStepForZoom(zoom: number): number {
  let step = 48;
  while (step * zoom < 18) step *= 2;
  while (step * zoom > 120 && step > 12) step /= 2;
  return step;
}

function bodyMaterialStyle(entity: Entity): BodyMaterialStyle {
  if (isAttackTouchEntity(entity)) {
    return {
      stroke: 0xfff1a8,
      fill: 0x4a1018,
      texture: 0xffd9de,
      fillAlpha: 0.52,
      selectedFillAlpha: 0.62,
      textureAlpha: 0.2,
      selectedTextureAlpha: 0.32,
    };
  }
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
  const bodyGeometry = targetGeometry(entity, "body");
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
    { kind: "core", position: bodyGeometry.center, radius: 8 },
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
        x: point.x * Math.max(Math.abs(scale.x), MIN_SCALE_EPSILON),
      y: point.y * Math.max(Math.abs(scale.y), MIN_SCALE_EPSILON),
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

export function geometryAabb(geometry: { center: Vec2; rotation: number; width: number; height: number }): { x: number; y: number; w: number; h: number } {
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

export function computeMultiSelectionBounds(entities: Entity[]): { center: Vec2; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of entities) {
    const geom = targetGeometry(entity, "body");
    const aabb = geometryAabb(geom);
    if (aabb.x < minX) minX = aabb.x;
    if (aabb.y < minY) minY = aabb.y;
    if (aabb.x + aabb.w > maxX) maxX = aabb.x + aabb.w;
    if (aabb.y + aabb.h > maxY) maxY = aabb.y + aabb.h;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: Math.max(width, 4),
    height: Math.max(height, 4),
  };
}

function normalizeRect(rect: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const x = rect.w < 0 ? rect.x + rect.w : rect.x;
  const y = rect.h < 0 ? rect.y + rect.h : rect.y;
  return { x, y, w: Math.abs(rect.w), h: Math.abs(rect.h) };
}

function multiSelectionHandles(bounds: { center: Vec2; width: number; height: number }): {
  corners: Vec2[];
  edges: Vec2[];
  rotate: Vec2;
} {
  const hw = bounds.width / 2 + 5;
  const hh = bounds.height / 2 + 5;
  return {
    corners: [
      { x: bounds.center.x - hw, y: bounds.center.y - hh },
      { x: bounds.center.x + hw, y: bounds.center.y - hh },
      { x: bounds.center.x + hw, y: bounds.center.y + hh },
      { x: bounds.center.x - hw, y: bounds.center.y + hh },
    ],
    edges: [
      { x: bounds.center.x, y: bounds.center.y - hh },
      { x: bounds.center.x + hw, y: bounds.center.y },
      { x: bounds.center.x, y: bounds.center.y + hh },
      { x: bounds.center.x - hw, y: bounds.center.y },
    ],
    rotate: { x: bounds.center.x, y: bounds.center.y - hh - 28 },
  };
}

function rectsIntersect(left: { x: number; y: number; w: number; h: number }, right: { x: number; y: number; w: number; h: number }): boolean {
  return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

export function targetGeometry(entity: Entity, part: CanvasTargetPart): { center: Vec2; rotation: number; width: number; height: number } {
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
      width: size.x * Math.max(Math.abs(scale.x), MIN_SCALE_EPSILON) * Math.max(Math.abs(transformScale.x), MIN_SCALE_EPSILON),
      height: size.y * Math.max(Math.abs(scale.y), MIN_SCALE_EPSILON) * Math.max(Math.abs(transformScale.y), MIN_SCALE_EPSILON),
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
    width: size.x * Math.max(Math.abs(transformScale.x), MIN_SCALE_EPSILON),
    height: size.y * Math.max(Math.abs(transformScale.y), MIN_SCALE_EPSILON),
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
          x: point.x * Math.max(Math.abs(entity.transform.scale.x), MIN_SCALE_EPSILON),
          y: point.y * Math.max(Math.abs(entity.transform.scale.y), MIN_SCALE_EPSILON),
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

function presentationAnimationTimeMs(entity: Entity, world: RuntimeWorld, fallbackTimeMs: number): number {
  const isParrySlot = entity.render?.slot === "parry" || entity.render?.state === "parry";
  const isAttackSlot = entity.render?.slot === "attack" || entity.render?.state === "attack";
  const startedFrame = isParrySlot ? entity.runtime?.parryStartedFrame : isAttackSlot ? entity.runtime?.attackStartFrame : undefined;
  if (typeof startedFrame === "number") {
    return Math.max(0, (world.clock.frame - startedFrame) * world.clock.fixedStepMs);
  }
  return fallbackTimeMs;
}

function resourceEffectActiveInContext(resource: Resource, entity: Entity, world: RuntimeWorld, showEditorDecorations: boolean): boolean {
  if (!resource.effect) return false;
  if (showEditorDecorations || resource.effect.loop) return true;
  if (resource.effect.preset === "deathFade") return entity.runtime?.defeated === true && typeof entity.runtime.defeatFrame === "number";
  if (resource.effect.preset === "hitFlash") return typeof entity.runtime?.hitFlashUntilFrame === "number" && world.clock.frame <= entity.runtime.hitFlashUntilFrame;
  if (resource.effect.preset === "impactPulse") {
    const start = entity.runtime?.attackStartFrame;
    const activeUntil = entity.runtime?.attackActiveUntilFrame;
    return typeof start === "number" && world.clock.frame >= start && world.clock.frame <= (activeUntil ?? start);
  }
  return true;
}

function resourceEffectTimeMs(resource: Resource, entity: Entity, world: RuntimeWorld, fallbackTimeMs: number): number {
  if (!resource.effect) return fallbackTimeMs;
  if (resource.effect.preset === "deathFade" && typeof entity.runtime?.defeatFrame === "number") {
    return Math.max(0, (world.clock.frame - entity.runtime.defeatFrame) * world.clock.fixedStepMs);
  }
  if (resource.effect.preset === "hitFlash" && typeof entity.runtime?.hitFlashUntilFrame === "number") {
    const duration = Math.max(60, resource.effect.durationMs || 320);
    const remaining = Math.max(0, entity.runtime.hitFlashUntilFrame - world.clock.frame) * world.clock.fixedStepMs;
    return Math.max(0, duration - remaining);
  }
  if (resource.effect.preset === "impactPulse" && typeof entity.runtime?.attackStartFrame === "number") {
    return Math.max(0, (world.clock.frame - entity.runtime.attackStartFrame) * world.clock.fixedStepMs);
  }
  return fallbackTimeMs;
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

export function fromLocal(center: Vec2, local: Vec2, rotation: number): Vec2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + local.x * cos - local.y * sin,
    y: center.y + local.x * sin + local.y * cos,
  };
}

export function toLocal(center: Vec2, point: Vec2, rotation: number): Vec2 {
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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function gameplayAttackRect(entity: Entity): { x: number; y: number; w: number; h: number } {
  const bounds = boundsFor(entity);
  const direction = entity.runtime?.facing === -1 ? -1 : 1;
  const kind = entity.runtime?.attackKind || "normal";
  const range = readAttackKindParam(entity, kind, "Range") ?? readNumberParam(entity, "attackRange") ?? Math.max(64, bounds.w);
  const height = readAttackKindParam(entity, kind, "Height") ?? readNumberParam(entity, "attackHeight") ?? bounds.h;
  const inset = Math.max(0, readNumberParam(entity, "attackTouchInset") ?? 8);
  const offsetX = readNumberParam(entity, "attackTouchOffsetX") ?? 0;
  const offsetY = readNumberParam(entity, "attackTouchOffsetY") ?? 0;
  const x = (direction >= 0 ? bounds.x + bounds.w - inset : bounds.x - range) + direction * offsetX;
  const y = bounds.y + bounds.h / 2 - height / 2 + offsetY;
  return { x, y, w: range + inset, h: height };
}

function readAttackKindParam(entity: Entity, kind: string, suffix: string): number | undefined {
  if (kind === "charged") return readNumberParam(entity, `chargedAttack${suffix}`);
  if (kind === "superParry") return readNumberParam(entity, `superParryAttack${suffix}`);
  return undefined;
}

function readNumberParam(entity: Entity, key: string): number | undefined {
  const value = entity.behavior?.params?.[key];
  return typeof value === "number" ? value : undefined;
}

function gameplayTag(tag: string): boolean {
  const normalized = tag.toLowerCase();
  return normalized.includes("enemy") || normalized.includes("player") || tag.includes("敌") || tag.includes("玩家");
}

function resetDisplayObject(item: Graphics | Sprite): void {
  item.position.set(0, 0);
  item.scale.set(1, 1);
  item.rotation = 0;
  item.alpha = 1;
  item.visible = true;
  if (item instanceof Sprite) item.tint = 0xffffff;
}

function parseColor(value: string): number {
  const normalized = value.startsWith("#") ? value.slice(1) : value;
  return Number.parseInt(normalized, 16);
}
