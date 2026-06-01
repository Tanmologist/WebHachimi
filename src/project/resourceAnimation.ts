// Owns timeline metadata and frame/effect resolution for project resources.
// Editor and player renderers both consume this project-domain service instead
// of depending on one another for animation semantics.
import type { Resource, ResourceAttachment, ResourceEffectMetadata, ResourceEffectPresetId, SpriteResourceMetadata } from "./schema";

export type ResourceFrameRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResourceFrameSelection = {
  attachment: ResourceAttachment;
  frameIndex: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  rect?: ResourceFrameRect;
};

export type TextureSize = {
  width: number;
  height: number;
};

export type ResourceEffectFrame = {
  alphaMultiplier: number;
  scaleMultiplier: number;
  tint?: number;
};

export type ResourceEffectPresetOption = {
  id: ResourceEffectPresetId | "none";
  label: string;
  summary: string;
};

export type VisualResource = Resource & { type: "image" | "sprite" | "animation" };

export const resourceEffectPresetOptions = [
  { id: "none", label: "无", summary: "保持原始资源" },
  { id: "deathFade", label: "死亡淡出", summary: "1.2 秒淡出并停在透明态" },
  { id: "hitFlash", label: "受击闪白", summary: "短促闪烁，适合受击反馈" },
  { id: "impactPulse", label: "冲击脉冲", summary: "快速放大回弹，适合命中特效" },
  { id: "ambientLoop", label: "呼吸循环", summary: "轻微循环脉冲，适合待机光效" },
] as const satisfies readonly ResourceEffectPresetOption[];

export function isVisualResource(resource: Resource | undefined): resource is VisualResource {
  return Boolean(resource && (resource.type === "image" || resource.type === "sprite" || resource.type === "animation"));
}

export function primaryImageAttachment(resource: Resource | undefined): ResourceAttachment | undefined {
  return resource?.attachments.find(isImageAttachment);
}

export function imageAttachments(resource: Resource | undefined): ResourceAttachment[] {
  return resource?.attachments.filter(isImageAttachment) || [];
}

export function resourceHasAnimation(resource: Resource | undefined): boolean {
  if (!resource?.sprite) return false;
  return resourceFrameCount(resource) > 1;
}

export function resourceHasTimelineEffect(resource: Resource | undefined): boolean {
  return Boolean(resource?.effect);
}

export function buildResourceEffectPreset(preset: ResourceEffectPresetId | "none"): ResourceEffectMetadata | undefined {
  if (preset === "none") return undefined;
  if (preset === "deathFade") {
    return {
      preset,
      durationMs: 1200,
      fadeOut: true,
      loop: false,
    };
  }
  if (preset === "hitFlash") {
    return {
      preset,
      durationMs: 320,
      blink: true,
      tint: "#ffffff",
      loop: false,
    };
  }
  if (preset === "impactPulse") {
    return {
      preset,
      durationMs: 420,
      pulseScale: 0.18,
      tint: "#fff1a8",
      loop: false,
    };
  }
  return {
    preset,
    durationMs: 1600,
    pulseScale: 0.06,
    tint: "#c9f6ff",
    loop: true,
  };
}

export function resourceEffectPresetLabel(resource: Resource | undefined): string {
  const id = resource?.effect?.preset || "none";
  return resourceEffectPresetOptions.find((option) => option.id === id)?.label || "无";
}

export function resourceEffectFrameAtTime(
  resource: Resource,
  timeMs: number,
  options: { previewLoop?: boolean } = {},
): ResourceEffectFrame {
  const effect = resource.effect;
  if (!effect) return defaultEffectFrame();
  const duration = Math.max(60, effect.durationMs || 1000);
  const elapsed = Math.max(0, timeMs);
  const shouldLoop = effect.loop === true || options.previewLoop === true;
  const finished = !shouldLoop && elapsed >= duration;
  const localTime = shouldLoop ? elapsed % duration : Math.min(elapsed, duration);
  const t = clamp01(localTime / duration);
  const tint = effect.tint ? parseHexColor(effect.tint) : undefined;

  if (finished && !effect.fadeOut) return defaultEffectFrame();

  let alphaMultiplier = 1;
  if (effect.fadeOut) alphaMultiplier *= 1 - smoothStep(t);
  if (effect.blink && !finished) alphaMultiplier *= 0.58 + Math.abs(Math.sin(t * Math.PI * 6)) * 0.42;

  let scaleMultiplier = 1;
  if (effect.pulseScale && !finished) {
    const wave = effect.loop ? 0.5 + Math.sin(t * Math.PI * 2) * 0.5 : Math.sin(t * Math.PI);
    scaleMultiplier += Math.max(0, wave) * effect.pulseScale;
  }

  return {
    alphaMultiplier: clamp(alphaMultiplier, 0, 1.2),
    scaleMultiplier: clamp(scaleMultiplier, 0.2, 2),
    tint: finished ? undefined : tint,
  };
}

export function resourceFrameCount(resource: Resource | undefined): number {
  if (!resource?.sprite) return 1;
  if (resource.sprite.mode === "sequence") {
    return Math.max(1, Math.min(resource.sprite.frameCount || Number.POSITIVE_INFINITY, imageAttachments(resource).length || 1));
  }
  const columns = positiveInt(resource.sprite.columns);
  const rows = positiveInt(resource.sprite.rows);
  return Math.max(1, resource.sprite.frameCount || (columns && rows ? columns * rows : 1));
}

export function resourceAnimationLabel(resource: Resource): string {
  if (!resource.sprite) return "static image";
  const fps = positiveNumber(resource.sprite.fps) || 8;
  if (resource.sprite.mode === "sequence") return `PNG sequence · ${resourceFrameCount(resource)} frames · ${fps} fps`;
  const columns = positiveInt(resource.sprite.columns) || 1;
  const rows = positiveInt(resource.sprite.rows) || 1;
  return `sheet ${columns}x${rows} · ${resourceFrameCount(resource)} frames · ${fps} fps`;
}

export function resourceFrameAtTime(resource: Resource, timeMs: number, sourceSize?: TextureSize): ResourceFrameSelection | undefined {
  const sprite = resource.sprite;
  if (!sprite) {
    const attachment = primaryImageAttachment(resource);
    return attachment ? { attachment, frameIndex: 0, frameCount: 1, fps: 0, loop: true } : undefined;
  }

  if (sprite.mode === "sequence") {
    const attachments = imageAttachments(resource);
    if (attachments.length === 0) return undefined;
    const frameCount = Math.max(1, Math.min(sprite.frameCount || attachments.length, attachments.length));
    const frameIndex = animationFrameIndex(timeMs, sprite, frameCount);
    return {
      attachment: attachments[frameIndex] || attachments[0],
      frameIndex,
      frameCount,
      fps: positiveNumber(sprite.fps) || 8,
      loop: sprite.loop !== false,
    };
  }

  const attachment = primaryImageAttachment(resource);
  if (!attachment) return undefined;
  const metrics = sheetMetrics(sprite, sourceSize);
  const frameCount = Math.max(1, Math.min(sprite.frameCount || metrics.columns * metrics.rows, metrics.columns * metrics.rows));
  const frameIndex = animationFrameIndex(timeMs, sprite, frameCount);
  return {
    attachment,
    frameIndex,
    frameCount,
    fps: positiveNumber(sprite.fps) || 8,
    loop: sprite.loop !== false,
    rect: sheetFrameRect(metrics, frameIndex, sourceSize),
  };
}

export function buildSheetSpriteMetadata(input: {
  columns: number;
  rows: number;
  frameCount?: number;
  fps?: number;
  loop?: boolean;
  frameWidth?: number;
  frameHeight?: number;
  margin?: number;
  spacing?: number;
}): SpriteResourceMetadata {
  const columns = Math.max(1, Math.floor(input.columns));
  const rows = Math.max(1, Math.floor(input.rows));
  return {
    mode: "sheet",
    columns,
    rows,
    frameCount: Math.max(1, Math.min(Math.floor(input.frameCount || columns * rows), columns * rows)),
    fps: Math.max(1, Number(input.fps) || 8),
    loop: input.loop !== false,
    frameWidth: optionalPositiveInt(input.frameWidth),
    frameHeight: optionalPositiveInt(input.frameHeight),
    margin: Math.max(0, Math.floor(input.margin || 0)),
    spacing: Math.max(0, Math.floor(input.spacing || 0)),
  };
}

export function buildSequenceSpriteMetadata(input: { frameCount: number; fps?: number; loop?: boolean }): SpriteResourceMetadata {
  return {
    mode: "sequence",
    frameCount: Math.max(1, Math.floor(input.frameCount)),
    fps: Math.max(1, Number(input.fps) || 8),
    loop: input.loop !== false,
  };
}

export function isImageAttachment(attachment: ResourceAttachment): boolean {
  return attachment.mime.startsWith("image/") || attachment.path.startsWith("data:image/");
}

function animationFrameIndex(timeMs: number, sprite: SpriteResourceMetadata, frameCount: number): number {
  const fps = positiveNumber(sprite.fps) || 8;
  const rawIndex = Math.max(0, Math.floor((Math.max(0, timeMs) / 1000) * fps));
  if (sprite.loop === false) return Math.min(frameCount - 1, rawIndex);
  return rawIndex % frameCount;
}

function sheetMetrics(sprite: SpriteResourceMetadata, sourceSize?: TextureSize): Required<Pick<SpriteResourceMetadata, "columns" | "rows" | "frameWidth" | "frameHeight" | "margin" | "spacing">> {
  const columns = positiveInt(sprite.columns) || 1;
  const rows = positiveInt(sprite.rows) || 1;
  const margin = Math.max(0, Math.floor(sprite.margin || 0));
  const spacing = Math.max(0, Math.floor(sprite.spacing || 0));
  const frameWidth =
    positiveInt(sprite.frameWidth) ||
    Math.max(1, Math.floor(((sourceSize?.width || columns) - margin * 2 - spacing * Math.max(0, columns - 1)) / columns));
  const frameHeight =
    positiveInt(sprite.frameHeight) ||
    Math.max(1, Math.floor(((sourceSize?.height || rows) - margin * 2 - spacing * Math.max(0, rows - 1)) / rows));
  return { columns, rows, frameWidth, frameHeight, margin, spacing };
}

function sheetFrameRect(
  metrics: Required<Pick<SpriteResourceMetadata, "columns" | "rows" | "frameWidth" | "frameHeight" | "margin" | "spacing">>,
  frameIndex: number,
  sourceSize?: TextureSize,
): ResourceFrameRect {
  const column = frameIndex % metrics.columns;
  const row = Math.floor(frameIndex / metrics.columns);
  const x = metrics.margin + column * (metrics.frameWidth + metrics.spacing);
  const y = metrics.margin + row * (metrics.frameHeight + metrics.spacing);
  const maxWidth = sourceSize ? Math.max(1, sourceSize.width - x) : metrics.frameWidth;
  const maxHeight = sourceSize ? Math.max(1, sourceSize.height - y) : metrics.frameHeight;
  return {
    x,
    y,
    width: Math.min(metrics.frameWidth, maxWidth),
    height: Math.min(metrics.frameHeight, maxHeight),
  };
}

function positiveInt(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : undefined;
}

function optionalPositiveInt(value: number | undefined): number | undefined {
  return positiveInt(value);
}

function positiveNumber(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value && value > 0 ? value : undefined;
}

function defaultEffectFrame(): ResourceEffectFrame {
  return { alphaMultiplier: 1, scaleMultiplier: 1 };
}

function smoothStep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseHexColor(value: string): number | undefined {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return undefined;
  return Number.parseInt(value.slice(1), 16);
}
