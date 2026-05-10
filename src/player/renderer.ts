import { Application, Container, Graphics, Text } from "pixi.js";
import type { Entity, Scene } from "../project/schema";
import { boundsFor } from "../runtime/collision";
import type { RuntimeWorld } from "../runtime/world";
import type { Vec2 } from "../shared/types";
import { playerCameraLayout } from "./cameraLayout";

export type PlayerRendererOptions = {
  host: HTMLElement;
  scene: Scene;
};

export class PlayerRenderer {
  readonly app = new Application();
  private readonly worldLayer = new Container();
  private readonly hudLayer = new Container();
  private readonly graphicsPool: Graphics[] = [];
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

  async init(options: PlayerRendererOptions): Promise<void> {
    this.scene = options.scene;
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
    this.resizeObserver?.disconnect();
    this.removeResizeFallback?.();
    this.drainGraphicsPool();
    this.app.destroy(true);
  }

  render(world: RuntimeWorld): void {
    this.recycleWorldLayer();
    const player = findPlayer(world.allEntities());
    if (player) this.follow(player.transform.position);
    this.layoutWorld();
    this.drawBackdrop();
    this.drawAttackTelegraphs(world);
    world.allEntities().forEach((entity) => this.drawEntity(entity, world.clock.frame));
    world.allEntities().forEach((entity) => this.drawHealthBar(entity, world.clock.frame));
    this.drawHud(world, player);
  }

  private layout(): void {
    this.layoutWorld();
  }

  private layoutWorld(): void {
    const layout = playerCameraLayout(this.app.screen, this.camera);
    this.worldLayer.scale.set(layout.scale);
    this.worldLayer.position.set(layout.x, layout.y);
  }

  private follow(target: Vec2): void {
    this.camera.x += (target.x - this.camera.x) * 0.12;
    this.camera.y += (target.y - 40 - this.camera.y) * 0.1;
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

  private drawEntity(entity: Entity, frame: number): void {
    if (entity.render && !entity.render.visible) return;
    const graphics = this.takeGraphics();
    const size = entity.collider?.size || { x: 56, y: 56 };
    const flashed = frame <= (entity.runtime?.hitFlashUntilFrame ?? -1);
    const defeated = entity.runtime?.defeated === true;
    const attackTouch = isAttackTouchEntity(entity);
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
      "A/D move  W/Space jump  J attack  K parry",
      latest ? `Latest: ${latest}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    this.hudText.position.set(14, 12);
  }

  private drawAttackTelegraphs(world: RuntimeWorld): void {
    const frame = world.clock.frame;
    for (const entity of world.allEntities()) {
      if (entity.runtime?.defeated || !entity.collider) continue;
      const start = entity.runtime?.attackStartFrame;
      const activeUntil = entity.runtime?.attackActiveUntilFrame;
      if (start === undefined || activeUntil === undefined || frame > activeUntil) continue;
      const rect = attackRect(entity);
      const graphics = this.takeGraphics();
      if (frame < start) {
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
      this.drawWorldLabel(frame < start ? "WINDUP" : "ACTIVE", rect.x + rect.w / 2, rect.y - 4, frame < start ? "#ffe9a9" : "#ffd9de");
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

  private drawHealthBar(entity: Entity, frame: number): void {
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
    bar.fill({ color: entity.runtime?.defeated ? 0x6f756c : frame <= (entity.runtime?.hitFlashUntilFrame ?? -1) ? 0xf2d16b : 0x79d6ba, alpha: 0.95 });
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

  private drainGraphicsPool(): void {
    for (const item of this.graphicsPool.splice(0)) item.destroy();
  }
}

function findPlayer(entities: Entity[]): Entity | undefined {
  return entities.find((entity) => entity.behavior?.builtin === "playerPlatformer") || entities.find((entity) => entity.internalName === "Player");
}

function attackRect(entity: Entity): { x: number; y: number; w: number; h: number } {
  const bounds = boundsFor(entity);
  const direction = entity.runtime?.facing === -1 ? -1 : 1;
  const range = readNumberParam(entity, "attackRange") ?? Math.max(64, bounds.w);
  const height = readNumberParam(entity, "attackHeight") ?? bounds.h;
  const inset = Math.max(0, readNumberParam(entity, "attackTouchInset") ?? 8);
  return {
    x: direction === 1 ? bounds.x + bounds.w - inset : bounds.x - range,
    y: bounds.y + bounds.h / 2 - height / 2,
    w: range + inset,
    h: height,
  };
}

function isAttackTouchEntity(entity: Entity): boolean {
  return entity.tags.includes("attack") && entity.tags.includes("touch");
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
