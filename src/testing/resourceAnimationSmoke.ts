import type { Resource } from "../project/schema";
import type { ResourceId } from "../shared/types";
import {
  buildResourceEffectPreset,
  buildSequenceSpriteMetadata,
  buildSheetSpriteMetadata,
  resourceAnimationLabel,
  resourceEffectFrameAtTime,
  resourceEffectPresetLabel,
  resourceFrameAtTime,
  resourceFrameCount,
  resourceHasTimelineEffect,
} from "../editor/resourceAnimation";
import { renderResourceLibraryHtml } from "../editor/panelViews";

run("sheet animation selects equal grid frames without mutating the source image", () => {
  const resource = makeResource("sheet", "sheet.png");
  resource.sprite = buildSheetSpriteMetadata({ columns: 4, rows: 4, frameCount: 16, fps: 8, loop: true });

  const frame = resourceFrameAtTime(resource, 250, { width: 128, height: 128 });
  assert(frame?.attachment.path === "/assets/sheet.png", "expected the original sheet attachment to be reused");
  assert(frame.frameIndex === 2, `expected frame 2, got ${frame?.frameIndex}`);
  assert(frame.rect?.x === 64 && frame.rect?.y === 0, `expected 64,0 rect, got ${JSON.stringify(frame?.rect)}`);
  assert(frame.rect.width === 32 && frame.rect.height === 32, "expected 32x32 frame rect");
  assert(resourceFrameCount(resource) === 16, "expected 16 sheet frames");
  assert(resourceAnimationLabel(resource).includes("sheet 4x4"), "expected sheet label");
});

run("sequence animation chooses ordered attachments and clamps non-looping playback", () => {
  const resource = makeResource("sequence", "walk_001.png", "walk_002.png", "walk_003.png");
  resource.sprite = buildSequenceSpriteMetadata({ frameCount: 3, fps: 10, loop: false });

  const middle = resourceFrameAtTime(resource, 150);
  assert(middle?.attachment.fileName === "walk_002.png", `expected second frame, got ${middle?.attachment.fileName}`);

  const late = resourceFrameAtTime(resource, 10000);
  assert(late?.attachment.fileName === "walk_003.png", `expected clamped final frame, got ${late?.attachment.fileName}`);
  assert(resourceFrameCount(resource) === 3, "expected 3 sequence frames");
  assert(resourceAnimationLabel(resource).includes("PNG sequence"), "expected sequence label");
});

run("effect presets produce timeline multipliers and labels", () => {
  const resource = makeResource("effect", "flash.png");
  resource.effect = buildResourceEffectPreset("deathFade");

  assert(resourceHasTimelineEffect(resource), "expected resource to report a timeline effect");
  assert(resourceEffectPresetLabel(resource) === "死亡淡出", `expected death fade label, got ${resourceEffectPresetLabel(resource)}`);

  const start = resourceEffectFrameAtTime(resource, 0);
  const end = resourceEffectFrameAtTime(resource, 1200);
  assert(start.alphaMultiplier === 1, `expected full alpha at start, got ${start.alphaMultiplier}`);
  assert(end.alphaMultiplier === 0, `expected transparent alpha at the end, got ${end.alphaMultiplier}`);

  resource.effect = buildResourceEffectPreset("impactPulse");
  const pulse = resourceEffectFrameAtTime(resource, 210);
  assert(pulse.scaleMultiplier > 1, `expected impact pulse to scale up, got ${pulse.scaleMultiplier}`);
  assert(typeof pulse.tint === "number", "expected impact pulse tint");
});

run("resource library exposes effect preset buttons", () => {
  const resource = makeResource("library-effect", "effect.png");
  const html = renderResourceLibraryHtml({ [resource.id]: resource });
  assert(html.includes("特效预设"), "expected resource library to render effect preset controls");
  assert(html.includes('data-effect-preset="deathFade"'), "expected death fade preset button");
  assert(html.includes('data-effect-preset="impactPulse"'), "expected impact pulse preset button");
});

run("resource library renders resource previews by type", () => {
  const image = makeResource("preview-image", "hero.png");
  const audio = makeResource("preview-audio", "theme.mp3");
  audio.type = "audio";
  audio.attachments[0].mime = "audio/mpeg";
  audio.attachments[0].path = "/assets/theme.mp3";
  const note = makeResource("preview-note");
  note.type = "note";
  note.description = "这是一段资源说明，可以直接在资源库里快速查看。";
  const material = makeResource("preview-material", "pack.zip");
  material.type = "material";
  material.attachments[0].mime = "application/zip";
  material.attachments[0].path = "/assets/pack.zip";

  const html = renderResourceLibraryHtml({
    [image.id]: image,
    [audio.id]: audio,
    [note.id]: note,
    [material.id]: material,
  });
  assert(html.includes("v2-resource-preview is-visual"), "expected visual preview shell");
  assert(html.includes('src="/assets/hero.png"'), "expected image preview src");
  assert(html.includes("v2-resource-preview is-audio"), "expected audio preview shell");
  assert(html.includes("<audio controls"), "expected audio preview controls");
  assert(html.includes("v2-resource-preview is-note"), "expected note preview shell");
  assert(html.includes("这是一段资源说明"), "expected note preview text");
  assert(html.includes("v2-resource-preview is-file"), "expected file preview shell");
  assert(html.includes("application/zip"), "expected file preview mime");
});

console.log(JSON.stringify({ status: "passed" }, null, 2));

function makeResource(name: string, ...fileNames: string[]): Resource {
  return {
    id: `res-${name}` as ResourceId,
    internalName: name,
    displayName: name,
    type: "image",
    description: "",
    tags: [],
    attachments: fileNames.map((fileName, index) => ({
      id: `att-${index}`,
      fileName,
      mime: "image/png",
      path: `/assets/${fileName}`,
    })),
  };
}

function run(name: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
