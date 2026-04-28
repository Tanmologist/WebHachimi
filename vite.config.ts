import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const projectFile = path.join(rootDir, "data", "v2-project.json");
const assetsDir = path.join(rootDir, "data", "assets");

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
      server.middlewares.use("/api/v2/project", async (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        try {
          if (req.method === "GET") {
            const project = await readStoredProject();
            sendJson(res, project ? { project } : { empty: true });
            return;
          }

          if (req.method === "POST") {
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
  try {
    const text = await readFile(projectFile, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return isV2Project(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readRequestJson(req: { on: (event: string, callback: (chunk?: Buffer) => void) => void }): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk?: Buffer) => {
      if (chunk) chunks.push(chunk);
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
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === "webhachimi-v2-project" &&
    (value as Record<string, unknown>).version === 1
  );
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
        if (typeof attachment.dataUrl !== "string") return;
        const name = typeof attachment.fileName === "string" ? attachment.fileName : typeof attachment.name === "string" ? attachment.name : "";
        const ext = extFromMime(typeof attachment.mime === "string" ? attachment.mime : "", name);
        const rawId = typeof attachment.id === "string" ? attachment.id : `asset-${Date.now()}-${writes.length}`;
        const id = rawId.replace(/[^a-z0-9_-]/gi, "-");
        const rel = `data/assets/${id}.${ext}`;
        writes.push(writeFile(path.join(rootDir, rel), dataUrlToBuffer(attachment.dataUrl)));
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

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return Buffer.alloc(0);
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  return meta.includes(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8");
}

function sendJson(res: { end: (body: string) => void }, body: unknown): void {
  res.end(JSON.stringify(body));
}
