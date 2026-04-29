import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const projectSeedFile = path.join(rootDir, "data", "v2-project.json");
const projectFile = path.join(rootDir, "data", "local", "v2-project.json");
const assetsDir = path.join(rootDir, "data", "assets");
const execFileAsync = promisify(execFile);
const maxClipboardFiles = 10;
const maxClipboardFileBytes = 8 * 1024 * 1024;
const maxClipboardTotalBytes = 24 * 1024 * 1024;
const maxProjectBodyBytes = 50 * 1024 * 1024;
const maxAttachmentFileBytes = 8 * 1024 * 1024;
const localApiCookiePrefix = "webhachimi_local_token_";
const localApiToken = randomBytes(24).toString("hex");
const safeAttachmentMime = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  "audio/flac",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
  "application/zip",
  "application/octet-stream",
  "model/gltf-binary",
  "model/gltf+json",
  "model/obj",
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
]);

export default defineConfig({
  base: "./",
  plugins: [projectApiPlugin()],
  build: {
    outDir: "dist-v2",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        v2: "v2.html",
        player: "player.html",
      },
    },
  },
});

function projectApiPlugin() {
  return {
    name: "webhachimi-project-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        setLocalApiCookie(req, res);
        const pathname = requestPathname(req.url || "/");
        if (isDeniedViteStaticPath(pathname, req)) {
          res.statusCode = 403;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("forbidden");
          return;
        }
        next();
      });

      server.middlewares.use("/api/v2/clipboard-files", async (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        try {
          if (req.method !== "POST") {
            res.statusCode = 405;
            sendJson(res, { ok: false, error: "method not allowed" });
            return;
          }
          if (!requireLocalApiAccess(req, res)) return;
          if (req.headers["x-webhachimi-clipboard-read"] !== "1") {
            res.statusCode = 403;
            sendJson(res, { ok: false, error: "clipboard read header required" });
            return;
          }
          sendJson(res, await readClipboardFileResources());
        } catch (error) {
          res.statusCode = 500;
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use("/api/v2/project", async (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        try {
          if (req.method === "GET") {
            if (!requireLocalApiAccess(req, res)) return;
            const project = await readStoredProject();
            sendJson(res, project ? { project } : { empty: true });
            return;
          }

          if (req.method === "POST") {
            if (!requireLocalApiAccess(req, res)) return;
            if (!isJsonRequest(req)) {
              res.statusCode = 415;
              sendJson(res, { ok: false, error: "application/json required" });
              return;
            }
            const payload = await readRequestJson(req);
            const project = projectFromPayload(payload);
            if (!isV2Project(project)) {
              res.statusCode = 400;
              sendJson(res, { ok: false, error: "invalid v2 project payload" });
              return;
            }
            const savedAt = await saveStoredProject(project);
            sendJson(res, { ok: true, savedAt });
            return;
          }

          res.statusCode = 405;
          sendJson(res, { ok: false, error: "method not allowed" });
        } catch (error) {
          res.statusCode = 500;
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}

function setLocalApiCookie(
  req: { headers: Record<string, string | string[] | undefined> },
  res: { setHeader: (name: string, value: string) => void },
): void {
  res.setHeader("Set-Cookie", `${localApiCookieName(req)}=${localApiToken}; Path=/; HttpOnly; SameSite=Strict`);
}

function requestPathname(url: string): string {
  try {
    return decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return "/";
  }
}

function isDeniedViteStaticPath(pathname: string, req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const clean = pathname.replace(/\\/g, "/");
  if (clean.startsWith("/.git/")) return true;
  if (clean.endsWith(".log")) return true;
  if (clean.startsWith("/data/local/")) return true;
  if (clean.startsWith("/data/assets/") && !hasLocalApiToken(req)) return true;
  if (clean === "/data/project.json" || clean === "/data/v2-project.json") return true;
  if (clean === "/package-lock.json" || clean === "/package.json") return true;
  return false;
}

function requireLocalApiAccess(
  req: { headers: Record<string, string | string[] | undefined> },
  res: { statusCode: number },
): boolean {
  if (!isSameOrigin(req)) {
    res.statusCode = 403;
    sendJson(res, { ok: false, error: "same-origin request required" });
    return false;
  }
  if (!hasLocalApiToken(req)) {
    res.statusCode = 403;
    sendJson(res, { ok: false, error: "local session token required" });
    return false;
  }
  return true;
}

function hasLocalApiToken(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const headerToken = headerValue(req.headers["x-webhachimi-local-token"]);
  const cookieToken = parseCookieHeader(headerValue(req.headers.cookie))[localApiCookieName(req)] || "";
  return headerToken === localApiToken || cookieToken === localApiToken;
}

function localApiCookieName(req: { headers: Record<string, string | string[] | undefined> }): string {
  const host = headerValue(req.headers.host).replace(/[^a-z0-9_-]/gi, "_") || "dev";
  return `${localApiCookiePrefix}${host}`;
}

function isSameOrigin(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const host = headerValue(req.headers.host);
  if (!host) return false;
  const origin = headerValue(req.headers.origin);
  if (origin) return urlHost(origin) === host;
  const referer = headerValue(req.headers.referer);
  return referer ? urlHost(referer) === host : true;
}

function urlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function parseCookieHeader(raw: string): Record<string, string> {
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, part) => {
      const eq = part.indexOf("=");
      if (eq < 0) return cookies;
      cookies[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
      return cookies;
    }, {});
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function isJsonRequest(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  return headerValue(req.headers["content-type"]).toLowerCase().split(";")[0].trim() === "application/json";
}

type ClipboardFileEntry = {
  FullName?: string;
  fullName?: string;
  Name?: string;
  name?: string;
};

async function readClipboardFileResources(): Promise<Record<string, unknown>> {
  const entries = await readClipboardFileEntries();
  const files: Array<Record<string, unknown>> = [];
  const skipped: Array<{ fileName?: string; reason: string }> = [];
  let totalBytes = 0;

  for (const entry of entries.slice(0, maxClipboardFiles)) {
    const filePath = String(entry.FullName || entry.fullName || "").trim();
    const fileName = String(entry.Name || entry.name || path.basename(filePath)).trim();
    if (!filePath || !path.isAbsolute(filePath)) {
      skipped.push({ fileName, reason: "invalid path" });
      continue;
    }

    let info;
    try {
      info = await stat(filePath);
    } catch {
      skipped.push({ fileName, reason: "not readable" });
      continue;
    }
    if (!info.isFile()) {
      skipped.push({ fileName, reason: "not a file" });
      continue;
    }
    if (info.size > maxClipboardFileBytes) {
      skipped.push({ fileName, reason: "file too large" });
      continue;
    }
    if (totalBytes + info.size > maxClipboardTotalBytes) {
      skipped.push({ fileName, reason: "clipboard selection too large" });
      continue;
    }

    const buffer = await readFile(filePath);
    const mime = mimeFromFileName(fileName);
    totalBytes += info.size;
    files.push({
      displayName: fileNameWithoutExtension(fileName) || fileName,
      fileName,
      mime,
      path: `data:${mime};base64,${buffer.toString("base64")}`,
      description: "",
      type: resourceTypeFromMimeOrPath(mime, fileName),
    });
  }

  if (entries.length > maxClipboardFiles) {
    skipped.push({ reason: `only the first ${maxClipboardFiles} files were read` });
  }

  return { ok: true, files, skipped };
}

async function readClipboardFileEntries(): Promise<ClipboardFileEntry[]> {
  if (process.platform !== "win32") return [];
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$files = Get-Clipboard -Format FileDropList",
    "if ($null -eq $files) { '[]'; exit }",
    "@($files | ForEach-Object { [pscustomobject]@{ FullName = $_.FullName; Name = $_.Name } }) | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const raw = String(stdout || "").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as ClipboardFileEntry | ClipboardFileEntry[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function mimeFromFileName(fileName: string): string {
  const extension = path.extname(fileName).slice(1).toLowerCase();
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
  return mimeByExtension[extension] || "application/octet-stream";
}

function resourceTypeFromMimeOrPath(mime: string, fileName: string): string {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/") || ["json", "md", "txt", "csv"].includes(extension)) return "note";
  return "material";
}

function fileNameWithoutExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

async function saveStoredProject(project: Record<string, unknown>): Promise<string> {
  await mkdir(path.dirname(projectFile), { recursive: true });
  await mkdir(assetsDir, { recursive: true });
  const savedAt = new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
  await extractDataUrlAttachments(copy);
  await writeFile(projectFile, `${JSON.stringify(copy, null, 2)}\n`, "utf8");
  return savedAt;
}

async function readStoredProject(): Promise<unknown | null> {
  const local = await readProjectFile(projectFile);
  if (local) return local;
  return readProjectFile(projectSeedFile);
}

async function readProjectFile(filePath: string): Promise<unknown | null> {
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return isV2Project(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readRequestJson(req: { on: (event: string, callback: (chunk?: Buffer) => void) => void }): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    let size = 0;
    req.on("data", (chunk?: Buffer) => {
      if (!chunk) return;
      size += chunk.length;
      if (size > maxProjectBodyBytes) {
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", resolve);
    req.on("error", (error) => reject(error));
  });
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function projectFromPayload(payload: Record<string, unknown>): unknown {
  return isV2Project(payload.project) ? payload.project : payload;
}

function isV2Project(value: unknown): value is Record<string, unknown> {
  const project = asRecord(value);
  if (!project) return false;
  const meta = asRecord(project.meta);
  const scenes = asRecord(project.scenes);
  const activeScene = scenes ? asRecord(scenes[project.activeSceneId as string]) : undefined;
  return (
    project.kind === "webhachimi-v2-project" &&
    project.version === 1 &&
    typeof project.activeSceneId === "string" &&
    Boolean(meta) &&
    typeof meta?.name === "string" &&
    Boolean(scenes) &&
    Boolean(activeScene) &&
    Boolean(asRecord(activeScene?.entities)) &&
    Boolean(asRecord(project.resources)) &&
    Boolean(asRecord(project.tasks)) &&
    Boolean(asRecord(project.transactions)) &&
    Boolean(asRecord(project.testRecords))
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function extractDataUrlAttachments(root: unknown): Promise<void> {
  const writes: Promise<void>[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.attachments)) {
      record.attachments.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const attachment = item as Record<string, unknown>;
        const dataUrl = typeof attachment.dataUrl === "string"
          ? attachment.dataUrl
          : typeof attachment.path === "string" && attachment.path.startsWith("data:")
            ? attachment.path
            : "";
        if (!dataUrl) return;
        const parsed = parseDataUrl(dataUrl);
        if (!parsed || !isSafeAttachment(parsed.mime, parsed.buffer)) return;
        const name = typeof attachment.fileName === "string" ? attachment.fileName : typeof attachment.name === "string" ? attachment.name : "";
        const ext = extFromMime(parsed.mime || (typeof attachment.mime === "string" ? attachment.mime : ""), name);
        const rawId = typeof attachment.id === "string" ? attachment.id : `asset-${Date.now()}-${writes.length}`;
        const id = rawId.replace(/[^a-z0-9_-]/gi, "-");
        const rel = `data/assets/${id}.${ext}`;
        writes.push(writeFile(path.join(rootDir, rel), parsed.buffer));
        delete attachment.dataUrl;
        attachment.path = rel;
      });
    }
    Object.keys(record).forEach((key) => visit(record[key]));
  };
  visit(root);
  await Promise.all(writes);
}

function extFromMime(mime: string, fallbackName: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/webp") return "webp";
  if (mime === "application/json") return "json";
  const match = fallbackName.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "bin";
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | undefined {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return undefined;
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?$/i.exec(meta);
  if (!match) return undefined;
  const mime = (match[1] || "text/plain").toLowerCase();
  const buffer = match[2] ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8");
  return { mime, buffer };
}

function isSafeAttachment(mime: string, buffer: Buffer): boolean {
  if (!safeAttachmentMime.has(mime)) return false;
  if (buffer.length > maxAttachmentFileBytes) return false;
  if (mime === "image/svg+xml") return isSafeSvg(buffer.toString("utf8"));
  return true;
}

function isSafeSvg(text: string): boolean {
  return !/<script[\s>]/i.test(text) && !/\son[a-z]+\s*=/i.test(text) && !/javascript:/i.test(text);
}

function sendJson(res: { end: (body: string) => void }, body: unknown): void {
  res.end(JSON.stringify(body));
}
