import type { Resource, ResourceAttachment, SpriteResourceMetadata } from "../project/schema";

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

export type VisualResource = Resource & { type: "image" | "sprite" | "animation" };

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
