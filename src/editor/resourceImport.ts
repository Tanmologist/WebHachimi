import type { Resource, SpriteResourceMetadata } from "../project/schema";
import { buildSequenceSpriteMetadata } from "./resourceAnimation";

export type ResourceImportMetadata = {
  displayName: string;
  fileName: string;
  mime: string;
  path: string;
  description: string;
  type: Resource["type"];
  attachments?: ResourceImportAttachmentMetadata[];
  sprite?: SpriteResourceMetadata;
};

export type ClipboardFileLike = {
  name: string;
  type: string;
};

export type ResourceImportAttachmentMetadata = {
  fileName: string;
  mime: string;
  path: string;
};

export type ImportedFileResource = {
  file: ClipboardFileLike;
  dataUrl: string;
  index: number;
};

export type SequenceFileKey = {
  key: string;
  order: number;
};

export function resourceImportMetadataFromFile(file: ClipboardFileLike, dataUrl: string, index: number): ResourceImportMetadata {
  const rawFileName = file.name || clipboardFallbackFileName(file, index);
  const mime = mimeForImportedFile(file, dataUrl, rawFileName);
  const fileName = fileNameForMime(rawFileName, mime);
  return {
    displayName: fileNameWithoutExtension(fileName) || fileName,
    fileName,
    mime,
    path: dataUrl,
    description: "",
    type: resourceTypeFromMimeOrPath(mime, fileName),
  };
}

export function resourceImportMetadataFromSequence(items: ImportedFileResource[]): ResourceImportMetadata {
  const ordered = [...items].sort((left, right) => {
    const leftKey = sequenceGroupKeyFromFileName(left.file.name);
    const rightKey = sequenceGroupKeyFromFileName(right.file.name);
    return (leftKey?.order ?? left.index) - (rightKey?.order ?? right.index);
  });
  const first = ordered[0];
  const firstRawFileName = first?.file.name || "sequence.png";
  const firstMime = first ? mimeForImportedFile(first.file, first.dataUrl, firstRawFileName) : mimeFromFileName(firstRawFileName, "image/png");
  const firstFileName = fileNameForMime(firstRawFileName, firstMime);
  const displayName = sequenceDisplayName(firstFileName);
  const attachments = ordered.map((item) => {
    const rawFileName = item.file.name || clipboardFallbackFileName(item.file, item.index);
    const mime = mimeForImportedFile(item.file, item.dataUrl, rawFileName);
    const fileName = fileNameForMime(rawFileName, mime);
    return {
      fileName,
      mime,
      path: item.dataUrl,
    };
  });
  return {
    displayName,
    fileName: firstFileName,
    mime: firstMime,
    path: first?.dataUrl || "",
    description: "",
    type: "animation",
    attachments,
    sprite: buildSequenceSpriteMetadata({ frameCount: Math.max(1, attachments.length), fps: 8, loop: true }),
  };
}

export function sequenceGroupKeyFromFileName(fileName: string): SequenceFileKey | undefined {
  const name = fileName.split(/[\\/]/).pop() || fileName;
  const match = /^(.*?)(?:[-_. ]?)(\d+)(\.[^.]+)$/i.exec(name);
  if (!match) return undefined;
  const extension = match[3].slice(1).toLowerCase();
  if (!["png", "webp", "jpg", "jpeg", "gif"].includes(extension)) return undefined;
  const base = match[1].replace(/[-_. ]+$/, "");
  if (!base) return undefined;
  return {
    key: `${base.toLowerCase()}::${extension}`,
    order: Number.parseInt(match[2], 10),
  };
}

export function isImageFileLike(file: ClipboardFileLike): boolean {
  return resourceTypeFromMimeOrPath(file.type || mimeFromFileName(file.name), file.name) === "image";
}

export function resourceImportMetadataFromText(rawText: string): ResourceImportMetadata | undefined {
  const text = rawText.trim();
  if (!text) return undefined;
  const isResourceReference = looksLikeExternalResource(text);
  const mime = isResourceReference ? mimeFromResourceText(text) : "text/plain";
  return {
    displayName: isResourceReference ? resourceNameFromPath(text) : text.slice(0, 24),
    fileName: isResourceReference ? resourceNameFromPath(text) : "note.txt",
    mime,
    path: isResourceReference ? text : "",
    description: isResourceReference ? "" : text,
    type: isResourceReference ? resourceTypeFromMimeOrPath(mime, text) : "note",
  };
}

export function looksLikeExternalResource(value: string): boolean {
  return /^data:[^;,]+[;,]/i.test(value) || /^(https?|file):\/\/.+\.(png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg|m4a|flac|json|txt|md|csv|pdf|zip|glb|gltf|obj|fbx|ttf|otf|woff2?)([?#].*)?$/i.test(value);
}

export function mimeFromResourceText(value: string, fallback = "application/octet-stream"): string {
  const dataUrlMatch = /^data:([^;,]+)/i.exec(value);
  if (dataUrlMatch) return dataUrlMatch[1];
  return mimeFromFileName(value, fallback);
}

export function mimeForImportedFile(file: ClipboardFileLike, dataUrl: string, fileName = file.name): string {
  const sniffedMime = mimeFromDataUrlSignature(dataUrl);
  if (sniffedMime) return sniffedMime;
  return file.type || mimeFromResourceText(dataUrl, mimeFromFileName(fileName));
}

export function mimeFromFileName(value: string, fallback = "application/octet-stream"): string {
  const extension = fileExtension(value);
  const mimeByExtension: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    flac: "audio/flac",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    pdf: "application/pdf",
    zip: "application/zip",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    obj: "model/obj",
    fbx: "application/octet-stream",
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  return (extension && mimeByExtension[extension]) || fallback;
}

export function resourceTypeFromMimeOrPath(mime: string, value: string): Resource["type"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/") || ["json", "md", "txt", "csv"].includes(fileExtension(value))) return "note";
  return "material";
}

export function resourceTagsForType(type: Resource["type"]): string[] {
  if (type === "image" || type === "sprite" || type === "animation") return ["可视体"];
  if (type === "audio") return ["音频"];
  if (type === "note") return ["资源笔记"];
  return ["资源文件"];
}

export function resourceNameFromPath(value: string): string {
  if (/^data:/i.test(value)) return resourceTypeFromMimeOrPath(mimeFromResourceText(value), value) === "image" ? "粘贴图片资源" : "粘贴资源";
  try {
    const url = new URL(value);
    return fileNameWithoutExtension(decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "")) || "远程资源";
  } catch {
    return fileNameWithoutExtension(value.split(/[\\/]/).pop() || value) || "资源";
  }
}

function sequenceDisplayName(fileName: string): string {
  const name = fileNameWithoutExtension(fileName.split(/[\\/]/).pop() || fileName);
  return name.replace(/[-_. ]?\d+$/, "") || name || "PNG sequence";
}

export function clipboardFallbackFileName(file: ClipboardFileLike, index: number): string {
  const extensionByMime: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "text/plain": "txt",
    "application/json": "json",
    "application/pdf": "pdf",
  };
  const extension = extensionByMime[file.type] || "bin";
  return `粘贴资源${index + 1}.${extension}`;
}

export function fileNameWithoutExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function fileExtension(value: string): string {
  const cleanValue = value.split(/[?#]/, 1)[0];
  const match = /\.([a-z0-9]+)$/i.exec(cleanValue);
  return match?.[1].toLowerCase() || "";
}

function fileNameForMime(fileName: string, mime: string): string {
  const extension = extensionForMime(mime);
  if (!extension) return fileName;
  if (!fileExtension(fileName)) return `${fileName}.${extension}`;
  return mimeFromFileName(fileName, "") === mime ? fileName : fileName.replace(/\.[^.]+$/, `.${extension}`);
}

function extensionForMime(mime: string): string | undefined {
  const extensionByMime: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
  };
  return extensionByMime[mime];
}

function mimeFromDataUrlSignature(value: string): string | undefined {
  if (!/^data:/i.test(value)) return undefined;
  const comma = value.indexOf(",");
  if (comma < 0) return undefined;
  const meta = value.slice(0, comma);
  const body = value.slice(comma + 1).trim();
  if (/;base64/i.test(meta)) {
    const compact = body.replace(/\s/g, "");
    if (compact.startsWith("iVBORw0KGgo")) return "image/png";
    if (compact.startsWith("/9j/")) return "image/jpeg";
    if (compact.startsWith("R0lGOD")) return "image/gif";
    if (compact.startsWith("Qk")) return "image/bmp";
    const decoded = decodeBase64Prefix(compact);
    if (decoded?.startsWith("RIFF") && decoded.slice(8, 12) === "WEBP") return "image/webp";
    if (looksLikeSvgText(decoded)) return "image/svg+xml";
    return undefined;
  }
  return looksLikeSvgText(decodeDataUrlTextPrefix(body)) ? "image/svg+xml" : undefined;
}

function decodeBase64Prefix(value: string): string | undefined {
  if (typeof atob !== "function") return undefined;
  try {
    return atob(value.slice(0, 48));
  } catch {
    return undefined;
  }
}

function decodeDataUrlTextPrefix(value: string): string | undefined {
  try {
    return decodeURIComponent(value.slice(0, 256));
  } catch {
    return undefined;
  }
}

function looksLikeSvgText(value: string | undefined): boolean {
  const text = value?.trimStart().slice(0, 256).toLowerCase() || "";
  return text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"));
}
