import type { Resource } from "../project/schema";
import type { ResourceId } from "../shared/types";
import {
  buildSequenceSpriteMetadata,
  buildSheetSpriteMetadata,
  resourceAnimationLabel,
  resourceFrameAtTime,
  resourceFrameCount,
} from "../v2/resourceAnimation";

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
