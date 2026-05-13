import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { combatAttackRectForEntity } from "../combat/actions";
import type { Entity, Resource, Scene } from "../project/schema";
import { isAttackTouchEntity, isGameplayDebugEntity } from "../project/entityVisibility";
import { isVisualResource, resourceFrameAtTime, type ResourceFrameRect } from "../editor/resourceAnimation";
import { boundsFor } from "../runtime/collision";
import type { RuntimeWorld } from "../runtime/world";
import type { Vec2 } from "../shared/types";
import { playerCameraLayout } from "./cameraLayout";

export type PlayerRendererOptions = {
  host: HTMLElement;
  scene: Scene;
  resources?: Record<string, Resource>;
};

export class PlayerRenderer {
  readonly app = new Application();
  private readonly worldLayer = new Container();
  private readonly hudLayer = new Container();
  private readonly graphicsPool: Graphics[] = [];
  private readonly spritePool: Sprite[] = [];
  private readonly imageTextures = new Map<string, Texture>();
  private readonly frameTextures = new Map<string, Texture>();
  private readonly imageTextureLoads = new Map<string, Promise<void>>();
  private readonly hudText = new Text({
    text: "",
    style: {
      fill: "#e8eee9",
      fontFamily: "Inter, Microsoft YaHei, sans-serif",
      fontSize: 13,
      fontWeight: "700",
    },
  });
  private resizeObserver?: ResizeObserver;
  private removeResizeFallback?: () => void;
  private camera: Vec2 = { x: 0, y: 0 };
  private scene?: Scene;
  private backdrop?: Graphics;
  private horizon?: Graphics;
  private destroyed = false;
  private resources: Record<string, Resource> = {};
  private lastWorld?: RuntimeWorld;

  async init(options: PlayerRendererOptions): Promise<void> {
    this.scene = options.scene;
    this.resources = options.resources || {};
    await this.app.init({
      backgroundColor: parseColor(options.scene.settings.background),
      antialias: true,
      resizeTo: options.host,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
      autoDensity: true,
    });
    this.app.canvas.className = "player-canvas";
    options.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.worldLayer, this.hudLayer);
    this.hudLayer.addChild(this.hudText);

    if ("ResizeObserver" in globalThis) {
      this.resizeObserver = new ResizeObserver(() => this.layout());
      this.resizeObserver.observe(options.host);
    } else {
      const onResize = () => this.layout();
      window.addEventListener("resize", onResize);
      this.removeResizeFallback = () => window.removeEventListener("resize", onResize);
    }
    this.layout();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.removeResizeFallback?.();
    this.frameTextures.forEach((texture) => texture.destroy(false));
    this.frameTextures.clear();
    this.drainGraphicsPool();
    this.drainSpritePool();
    try {
      if (this.hasLiveRenderer()) this.app.destroy(true);
    } catch {
      this.app.canvas?.remove();
    }
  }

  render(world: RuntimeWorld): void {
    if (!this.hasLiveRenderer()) return;
    this.lastWorld = world;
    this.recycleWorldLayer();
    const player = findPlayer(world.allEntities());
    if (player) this.follow(player.transform.position);
    this.layoutWorld(world.screenShakeOffset());
    this.drawBackdrop();
    this.drawAttackTelegraphs(world);
    this.drawChargeStates(world);
    world.allEntities().forEach((entity) => this.drawEntity(entity, world));
    world.allEntities().forEach((entity) => this.drawHealthBar(entity, world));
    this.drawHud(world, player);
  }

  private layout(): void {
    this.layoutWorld();
  }

  private layoutWorld(offset: Vec2 = { x: 0, y: 0 }): void {
    const layout = playerCameraLayout(this.app.screen, this.camera);
    this.worldLayer.scale.set(layout.scale);
    this.worldLayer.position.set(layout.x + offset.x, layout.y + offset.y);
  }

  private follow(target: Vec2): void {
    this.camera.x += (target.x - this.camera.x) * 0.12;
    this.camera.y += (target.y - 40 - this.camera.y) * 0.1;
  }

  private hasLiveRenderer(): boolean {
    return Boolean((this.app as unknown as { renderer?: unknown }).renderer);
  }

  private drawBackdrop(): void {
    const scene = this.scene;
    if (!scene) return;
    if (!this.backdrop) {
      this.backdrop = new Graphics();
      this.backdrop.rect(-scene.settings.width / 2, -scene.settings.height / 2, scene.settings.width, scene.settings.height);
      this.backdrop.fill({ color: parseColor(scene.settings.background), alpha: 1 });
      this.worldLayer.addChild(this.backdrop);
    }
    if (!this.horizon) {
      this.horizon = new Graphics();
      this.horizon.rect(-scene.settings.width / 2, scene.settings.height / 2 - 220, scene.settings.width, 220);
      this.horizon.fill({ color: 0x171b1a, alpha: 1 });
      this.worldLayer.addChild(this.horizon);
    }
  }

  private drawEntity(entity: Entity, world: RuntimeWorld): void {
    if (isGameplayDebugEntity(entity)) return;
    if (entity.render && !entity.render.visible) return;
    const attackTouch = isAttackTouchEntity(entity);
    const useActionResource =
      entity.render?.slot === "parry" ||
      entity.render?.state === "parry" ||
      entity.render?.slot === "attack" ||
      entity.render?.state === "attack";
    const resource = !attackTouch && useActionResource ? presentationResource(entity, this.resources) : undefined;
    if (resource && this.drawEntityImage(entity, resource, presentationAnimationTimeMs(entity, world))) {
      if (entity.runtime?.defeated === true) this.drawDefeatedMark(entity);
      return;
    }
    const graphics = this.takeGraphics();
    const size = entity.collider?.size || { x: 56, y: 56 };
    const flashed = world.clock.timeMs < (entity.runtime?.hitFlashUntilMs ?? -1);
    const defeated = entity.runtime?.defeated === true;
    const color = attackTouch ? 0xff4d5d : flashed ? 0xf4fff7 : parseColor(entity.render?.color || "#74a8bd");
    const baseAlpha = entity.persistent ? entity.render?.opacity ?? 1 : Math.min(entity.render?.opacity ?? 1, 0.45);
    const alpha = attackTouch ? Math.max(baseAlpha, 0.5) : defeated ? Math.min(baseAlpha, 0.28) : baseAlpha;

    if (entity.collider?.shape === "circle") {
      graphics.circle(0, 0, entity.collider.radius || Math.min(size.x, size.y) / 2);
    } else if (entity.collider?.shape === "polygon" && entity.collider.points?.length) {
      const [first, ...rest] = entity.collider.points;
      graphics.moveTo(first.x, first.y);
      rest.forEach((point) => graphics.lineTo(point.x, point.y));
      graphics.closePath();
    } else {
      graphics.roundRect(-size.x / 2, -size.y / 2, size.x, size.y, entity.body?.mode === "dynamic" ? 10 : 4);
    }

    graphics.fill({ color, alpha });
    if (entity.collider?.solid || attackTouch) {
      graphics.setStrokeStyle({ width: attackTouch ? 3 : 2, color: attackTouch ? 0xfff1a8 : 0x0a0c0b, alpha: attackTouch ? 0.98 : 0.62 });
      graphics.stroke();
    }
    if (defeated) {
      graphics.setStrokeStyle({ width: 4, color: 0xf2d16b, alpha: 0.82 });
      graphics.moveTo(-size.x * 0.35, -size.y * 0.35);
      graphics.lineTo(size.x * 0.35, size.y * 0.35);
      graphics.moveTo(size.x * 0.35, -size.y * 0.35);
      graphics.lineTo(-size.x * 0.35, size.y * 0.35);
      graphics.stroke();
    }
    graphics.position.set(entity.transform.position.x, entity.transform.position.y);
    graphics.rotation = entity.transform.rotation;
    graphics.scale.set(entity.transform.scale.x || 1, entity.transform.scale.y || 1);
    this.worldLayer.addChild(graphics);

    if (attackTouch) this.drawWorldLabel("TOUCH BOX", entity.transform.position.x, entity.transform.position.y - size.y / 2 - 4, "#fff1a8");
    if (entity.behavior?.builtin === "playerPlatformer") this.drawPlayerFace(entity, size);
  }

  private drawEntityImage(entity: Entity, resource: Resource, animationTimeMs: number): boolean {
    const pendingFrame = resourceFrameAtTime(resource, animationTimeMs);
    const imagePath = pendingFrame?.attachment.path;
    if (!imagePath) return false;
    const texture = this.imageTextures.get(imagePath);
    if (!texture) {
      this.loadImageTexture(imagePath);
      return false;
    }
    const frame = resourceFrameAtTime(resource, animationTimeMs, { width: texture.width, height: texture.height }) || pendingFrame;
    const drawTexture = this.textureForFrame(texture, imagePath, frame?.rect);
    const size = entity.render?.size || entity.collider?.size || { x: 56, y: 56 };
    const drawSize = containedImageSize(drawTexture, { width: size.x, height: size.y });
    const sprite = this.takeSprite(drawTexture);
    const direction = entity.runtime?.facing === -1 ? -1 : 1;
    const offset = entity.render?.offset || { x: 0, y: 0 };
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(entity.transform.position.x + offset.x, entity.transform.position.y + offset.y);
    sprite.rotation = entity.transform.rotation + (entity.render?.rotation || 0);
    sprite.scale.set(direction * (drawSize.width / Math.max(1, drawTexture.width)), drawSize.height / Math.max(1, drawTexture.height));
    sprite.alpha = entity.runtime?.defeated ? Math.min(entity.render?.opacity ?? 1, 0.28) : entity.render?.opacity ?? 1;
    this.worldLayer.addChild(sprite);
    return true;
  }

  private drawDefeatedMark(entity: Entity): void {
    const graphics = this.takeGraphics();
    const size = entity.collider?.size || { x: 56, y: 56 };
    graphics.setStrokeStyle({ width: 4, color: 0xf2d16b, alpha: 0.82 });
    graphics.moveTo(-size.x * 0.35, -size.y * 0.35);
    graphics.lineTo(size.x * 0.35, size.y * 0.35);
    graphics.moveTo(size.x * 0.35, -size.y * 0.35);
    graphics.lineTo(-size.x * 0.35, size.y * 0.35);
    graphics.stroke();
    graphics.position.set(entity.transform.position.x, entity.transform.position.y);
    graphics.rotation = entity.transform.rotation;
    graphics.scale.set(entity.transform.scale.x || 1, entity.transform.scale.y || 1);
    this.worldLayer.addChild(graphics);
  }

  private drawPlayerFace(entity: Entity, size: Vec2): void {
    const face = this.takeGraphics();
    const eyeY = -size.y * 0.12;
    face.circle(-size.x * 0.16, eyeY, 4);
    face.circle(size.x * 0.16, eyeY, 4);
    face.fill({ color: 0x10221d, alpha: 0.95 });
    face.position.set(entity.transform.position.x, entity.transform.position.y);
    face.rotation = entity.transform.rotation;
    face.scale.set(entity.transform.scale.x || 1, entity.transform.scale.y || 1);
    this.worldLayer.addChild(face);
  }

  private drawHud(world: RuntimeWorld, player?: Entity): void {
    const hp = player ? ` HP ${player.runtime?.health ?? readNumberParam(player, "health") ?? "-"}` : "";
    const latest = world.combatEvents[world.combatEvents.length - 1]?.message;
    this.hudText.text = [
      player ? `Frame ${world.clock.frame}  X ${Math.round(player.transform.position.x)}  Y ${Math.round(player.transform.position.y)}${hp}` : `Frame ${world.clock.frame}`,
      "A/D move  W/Space jump  LMB/J attack  hold LMB/J charge  RMB/K parry  Shift/L dodge",
      latest ? `Latest: ${latest}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    this.hudText.position.set(14, 12);
  }

  private drawAttackTelegraphs(world: RuntimeWorld): void {
    const timeMs = world.clock.timeMs;
    for (const entity of world.allEntities()) {
      if (entity.runtime?.defeated || !entity.collider) continue;
      const start = entity.runtime?.attackStartMs;
      const activeUntil = entity.runtime?.attackActiveUntilMs;
      const cooldownUntil = entity.runtime?.attackCooldownUntilMs;
      if (start === undefined || activeUntil === undefined || cooldownUntil === undefined || timeMs >= cooldownUntil) continue;
      if (timeMs >= activeUntil) {
        const bounds = boundsFor(entity);
        const graphics = this.takeGraphics();
        graphics.roundRect(bounds.x - 5, bounds.y - 5, bounds.w + 10, bounds.h + 10, 8);
        graphics.setStrokeStyle({ width: 2, color: 0x9aa0a6, alpha: 0.72 });
        graphics.stroke();
        this.worldLayer.addChild(graphics);
        this.drawWorldLabel("RECOVERY", bounds.x + bounds.w / 2, bounds.y - 4, "#d7dadf");
        continue;
      }
      const rect = attackRect(entity);
      const graphics = this.takeGraphics();
      if (timeMs < start) {
        graphics.rect(rect.x, rect.y, rect.w, rect.h);
        graphics.fill({ color: 0xffd166, alpha: 0.18 });
        graphics.setStrokeStyle({ width: 2, color: 0xffd166, alpha: 0.68 });
        graphics.stroke();
      } else {
        graphics.rect(rect.x, rect.y, rect.w, rect.h);
        graphics.fill({ color: 0xff4d5d, alpha: 0.24 });
        graphics.setStrokeStyle({ width: 3, color: 0xff4d5d, alpha: 0.82 });
        graphics.stroke();
      }
      this.worldLayer.addChild(graphics);
      this.drawWorldLabel(timeMs < start ? "WINDUP" : "ACTIVE", rect.x + rect.w / 2, rect.y - 4, timeMs < start ? "#ffe9a9" : "#ffd9de");
    }
  }

  private drawChargeStates(world: RuntimeWorld): void {
    const frame = world.clock.frame;
    const timeMs = world.clock.timeMs;
    for (const entity of world.allEntities()) {
      if (entity.runtime?.defeated || !entity.collider) continue;
      const charging = (entity.runtime?.chargeHeldMs ?? 0) > 0;
      const superReady = timeMs < (entity.runtime?.superParryUntilMs ?? -1);
      if (!charging && !superReady) continue;
      const bounds = boundsFor(entity);
      const graphics = this.takeGraphics();
      const pulse = 0.5 + Math.sin(frame * 0.32) * 0.18;
      graphics.roundRect(bounds.x - 8, bounds.y - 8, bounds.w + 16, bounds.h + 16, 10);
      graphics.setStrokeStyle({ width: superReady ? 4 : 3, color: superReady ? 0xb8fff0 : 0x69b7ff, alpha: superReady ? 0.9 : pulse });
      graphics.stroke();
      this.worldLayer.addChild(graphics);
      const stage = entity.runtime?.chargeStage ?? 0;
      const label = superReady ? "SUPER" : stage > 0 ? `CHARGE ${stage}` : "CHARGING";
      this.drawWorldLabel(label, bounds.x + bounds.w / 2, bounds.y - 22, superReady ? "#b8fff0" : "#a9d8ff");
    }
  }

  private drawWorldLabel(text: string, x: number, y: number, fill: string): void {
    const label = new Text({
      text,
      style: {
        fill,
        fontFamily: "Inter, Microsoft YaHei, sans-serif",
        fontSize: 11,
        fontWeight: "800",
      },
    });
    label.anchor.set(0.5, 1);
    label.position.set(x, y);
    this.worldLayer.addChild(label);
  }

  private drawHealthBar(entity: Entity, world: RuntimeWorld): void {
    const maxHealth = readNumberParam(entity, "health");
    const health = entity.runtime?.health ?? maxHealth;
    if (maxHealth === undefined || health === undefined) return;
    if (!entity.behavior && !entity.tags.some((tag) => tag.toLowerCase().includes("enemy") || tag.toLowerCase().includes("player"))) return;
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
    bar.fill({ color: entity.runtime?.defeated ? 0x6f756c : world.clock.timeMs < (entity.runtime?.hitFlashUntilMs ?? -1) ? 0xf2d16b : 0x79d6ba, alpha: 0.95 });
    this.worldLayer.addChild(bar);
  }

  private recycleWorldLayer(): void {
    const keep = new Set([this.backdrop, this.horizon].filter(Boolean));
    const children = this.worldLayer.children.slice();
    for (const child of children) {
      if (keep.has(child as Graphics)) continue;
      this.worldLayer.removeChild(child);
      if (child instanceof Graphics) {
        resetGraphics(child);
        this.graphicsPool.push(child);
      } else if (child instanceof Sprite) {
        resetSprite(child);
        this.spritePool.push(child);
      } else {
        child.destroy({ children: true });
      }
    }
  }

  private takeGraphics(): Graphics {
    const item = this.graphicsPool.pop();
    if (item) {
      resetGraphics(item);
      return item;
    }
    return new Graphics();
  }

  private takeSprite(texture: Texture): Sprite {
    const item = this.spritePool.pop();
    if (item) {
      resetSprite(item);
      item.texture = texture;
      return item;
    }
    return new Sprite(texture);
  }

  private drainGraphicsPool(): void {
    for (const item of this.graphicsPool.splice(0)) item.destroy();
  }

  private drainSpritePool(): void {
    for (const item of this.spritePool.splice(0)) item.destroy();
  }

  private loadImageTexture(imagePath: string): void {
    if (this.imageTextureLoads.has(imagePath)) return;
    const load = Assets.load<Texture>(imagePath)
      .then((texture) => {
        this.imageTextures.set(imagePath, texture);
        if (this.lastWorld && this.hasLiveRenderer()) this.render(this.lastWorld);
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
}

function findPlayer(entities: Entity[]): Entity | undefined {
  return entities.find((entity) => entity.behavior?.builtin === "playerPlatformer") || entities.find((entity) => entity.internalName === "Player");
}

function attackRect(entity: Entity): { x: number; y: number; w: number; h: number } {
  return combatAttackRectForEntity(entity);
}

function presentationResource(entity: Entity, resources: Record<string, Resource>): Resource | undefined {
  const resourceId = entity.render?.resourceId;
  const resource = resourceId ? resources[resourceId] : undefined;
  return isVisualResource(resource) ? resource : undefined;
}

function presentationAnimationTimeMs(entity: Entity, world: RuntimeWorld): number {
  const isParrySlot = entity.render?.slot === "parry" || entity.render?.state === "parry";
  const isAttackSlot = entity.render?.slot === "attack" || entity.render?.state === "attack";
  const startedMs = isParrySlot ? entity.runtime?.parryStartedMs : isAttackSlot ? entity.runtime?.attackStartMs : undefined;
  if (typeof startedMs === "number") {
    return Math.max(0, world.clock.timeMs - startedMs);
  }
  return world.clock.timeMs;
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

function readNumberParam(entity: Entity, key: string): number | undefined {
  const value = entity.behavior?.params[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseColor(value: string): number {
  const normalized = value.startsWith("#") ? value.slice(1) : value;
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : 0x111313;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resetGraphics(item: Graphics): void {
  item.clear();
  item.position.set(0, 0);
  item.scale.set(1, 1);
  item.rotation = 0;
  item.alpha = 1;
  item.visible = true;
}

function resetSprite(item: Sprite): void {
  item.position.set(0, 0);
  item.scale.set(1, 1);
  item.rotation = 0;
  item.alpha = 1;
  item.visible = true;
  item.tint = 0xffffff;
}
