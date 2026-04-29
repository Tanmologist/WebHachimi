import { Application, Container, Graphics, Text } from "pixi.js";
import type { Entity, Scene } from "../project/schema";
import type { RuntimeWorld } from "../runtime/world";
import type { Vec2 } from "../shared/types";

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
  private scale = 1;
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
    world.allEntities().forEach((entity) => this.drawEntity(entity));
    this.drawHud(world, player);
  }

  private layout(): void {
    const screen = this.app.screen;
    const targetWidth = this.scene?.settings.width || 1600;
    this.scale = clamp(screen.width / targetWidth, 0.55, 1.15);
    this.layoutWorld();
  }

  private layoutWorld(): void {
    this.worldLayer.scale.set(this.scale);
    this.worldLayer.position.set(
      this.app.screen.width / 2 - this.camera.x * this.scale,
      this.app.screen.height * 0.55 - this.camera.y * this.scale,
    );
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

  private drawEntity(entity: Entity): void {
    if (entity.render && !entity.render.visible) return;
    const graphics = this.takeGraphics();
    const size = entity.collider?.size || { x: 56, y: 56 };
    const color = parseColor(entity.render?.color || "#74a8bd");
    const alpha = entity.persistent ? entity.render?.opacity ?? 1 : Math.min(entity.render?.opacity ?? 1, 0.45);

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
    if (entity.collider?.solid) {
      graphics.setStrokeStyle({ width: 2, color: 0x0a0c0b, alpha: 0.62 });
      graphics.stroke();
    }
    graphics.position.set(entity.transform.position.x, entity.transform.position.y);
    graphics.rotation = entity.transform.rotation;
    graphics.scale.set(entity.transform.scale.x || 1, entity.transform.scale.y || 1);
    this.worldLayer.addChild(graphics);

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
    this.hudText.text = player
      ? `Frame ${world.clock.frame}  X ${Math.round(player.transform.position.x)}  Y ${Math.round(player.transform.position.y)}`
      : `Frame ${world.clock.frame}`;
    this.hudText.position.set(14, 12);
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
