import {
  looksLikeExternalResource,
  resourceImportMetadataFromFile,
  resourceImportMetadataFromSequence,
  resourceImportMetadataFromText,
  resourceTagsForType,
  sequenceGroupKeyFromFileName,
} from "../v2/resourceImport";

run("file metadata accepts arbitrary and zero byte files", () => {
  const emptyJson = resourceImportMetadataFromFile({ name: "empty.json", type: "" }, "data:;base64,", 0);
  assert(emptyJson.displayName === "empty", "expected empty file display name from file name");
  assert(emptyJson.mime === "application/json", `expected json mime, got ${emptyJson.mime}`);
  assert(emptyJson.type === "note", `expected json files to import as note resources, got ${emptyJson.type}`);

  const archive = resourceImportMetadataFromFile({ name: "level-pack.zip", type: "" }, "data:application/zip;base64,", 1);
  assert(archive.displayName === "level-pack", "expected archive display name from file name");
  assert(archive.mime === "application/zip", `expected zip mime, got ${archive.mime}`);
  assert(archive.type === "material", `expected archive to import as material resource, got ${archive.type}`);
});

run("clipboard fallback names unnamed files", () => {
  const pastedImage = resourceImportMetadataFromFile({ name: "", type: "image/png" }, "data:image/png;base64,AAAA", 2);
  assert(pastedImage.fileName === "粘贴资源3.png", `expected png fallback name, got ${pastedImage.fileName}`);
  assert(pastedImage.displayName === "粘贴资源3", `expected display name without extension, got ${pastedImage.displayName}`);
  assert(pastedImage.type === "image", `expected pasted image type, got ${pastedImage.type}`);
});

run("text metadata preserves task text while importing resource references", () => {
  const note = resourceImportMetadataFromText("调整玩家跳跃手感");
  assert(note?.type === "note", `expected plain text note, got ${note?.type}`);
  assert(note.path === "", "expected plain text to stay as description-only resource");

  const imageUrl = resourceImportMetadataFromText("https://example.com/player.webp?cache=1");
  assert(imageUrl?.type === "image", `expected image URL type, got ${imageUrl?.type}`);
  assert(imageUrl.mime === "image/webp", `expected webp mime, got ${imageUrl?.mime}`);
  assert(imageUrl.displayName === "player", `expected URL file name display, got ${imageUrl.displayName}`);

  assert(looksLikeExternalResource("data:audio/wav;base64,AAAA"), "expected data audio resource reference");
  assert(!looksLikeExternalResource("请创建一个方块"), "expected regular task text to remain regular text");
});

run("resource tags match imported resource type", () => {
  assert(resourceTagsForType("image").includes("可视体"), "expected image tag");
  assert(resourceTagsForType("audio").includes("音频"), "expected audio tag");
  assert(resourceTagsForType("note").includes("资源笔记"), "expected note tag");
  assert(resourceTagsForType("material").includes("资源文件"), "expected material tag");
});

run("numbered PNG files can become one sequence resource", () => {
  const key = sequenceGroupKeyFromFileName("walk_001.png");
  assert(key?.key === "walk::png", `expected walk sequence key, got ${key?.key}`);
  assert(key.order === 1, `expected order 1, got ${key.order}`);

  const sequence = resourceImportMetadataFromSequence([
    { file: { name: "walk_002.png", type: "image/png" }, dataUrl: "data:image/png;base64,BBBB", index: 0 },
    { file: { name: "walk_001.png", type: "image/png" }, dataUrl: "data:image/png;base64,AAAA", index: 1 },
  ]);
  assert(sequence.type === "animation", `expected animation resource, got ${sequence.type}`);
  assert(sequence.sprite?.mode === "sequence", `expected sequence sprite metadata, got ${sequence.sprite?.mode}`);
  assert(sequence.attachments?.[0].fileName === "walk_001.png", `expected ordered first frame, got ${sequence.attachments?.[0].fileName}`);
  assert(sequence.attachments?.length === 2, `expected 2 attachments, got ${sequence.attachments?.length}`);
});

console.log(JSON.stringify({ status: "passed" }, null, 2));

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
