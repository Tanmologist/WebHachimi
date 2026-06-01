import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { chromium } from "playwright";

// Verifies a generated static game export is self-contained enough to run
// without the editor/project API. The smoke first inspects the package, then
// boots it through a tiny static server in Chromium to catch runtime failures.
const exportDir = path.resolve(process.argv[2] || "exports/smoke-hachimi-nanbei-lvdong");

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const indexPath = path.join(exportDir, "index.html");
  const editorPath = path.join(exportDir, "editor.html");
  const html = readFileSync(indexPath, "utf8");
  const editorHtml = readFileSync(editorPath, "utf8");

  assert(html.includes("data-webhachimi-project"), "exported index should embed project JSON");
  assert(html.includes("webhachimi-static-export"), "exported game should identify static export mode");
  assert(html.includes("webhachimi-editor-url"), "exported game should expose the static editor URL");
  assert(!html.includes("webhachimi-disable-editor-handoff"), "exported game should keep editor handoff enabled");
  assert(!html.includes("webhachimi-project-endpoint"), "exported game should not depend on project API metadata");
  assert(!html.includes("../../assets/"), "exported game should use root-level asset paths");
  assert(html.includes("./assets/"), "exported game should reference copied assets");
  assert(editorHtml.includes("data-webhachimi-project"), "exported editor should embed project JSON");
  assert(!editorHtml.includes("webhachimi-project-endpoint"), "exported editor should not depend on project API metadata");
  assert(!editorHtml.includes("../../assets/"), "exported editor should use root-level asset paths");

  const project = embeddedProjectFromHtml(html);
  assert(!String(project.meta?.name || "").includes("???"), "exported project title should be readable");
  assertRuntimeOnlyProject(project);

  const attachmentPaths = Object.values(project.resources || {})
    .flatMap((resource: any) => Array.isArray(resource.attachments) ? resource.attachments : [])
    .map((attachment: any) => String(attachment.path || ""))
    .filter(Boolean);

  assert(attachmentPaths.length > 0, "exported project should keep resource attachments");
  assert(
    attachmentPaths.every((resourcePath) => isStaticAttachmentPath(resourcePath)),
    "exported attachment paths should be static-package relative",
  );

  const localResourcePaths = attachmentPaths.filter((value) => value.startsWith("./resources/"));
  for (const resourcePath of localResourcePaths) {
    const filePath = path.join(exportDir, resourcePath.slice("./".length));
    assert(existsSync(filePath), `exported resource file should exist: ${resourcePath}`);
  }

  const manifest = JSON.parse(readFileSync(path.join(exportDir, "export-manifest.json"), "utf8"));
  assert(manifest.resourceCount === new Set(localResourcePaths).size, "manifest resource count should match copied resource files");

  await assertBrowserCanBoot(exportDir);

  console.log(JSON.stringify({
    status: "passed",
    exportDir,
    attachmentCount: attachmentPaths.length,
    localResourceCount: localResourcePaths.length,
  }, null, 2));
}

function assertRuntimeOnlyProject(project: any): void {
  for (const key of ["tasks", "transactions", "testRecords", "snapshots", "autonomyRuns"]) {
    assert(Object.keys(project[key] || {}).length === 0, `exported project should omit editor history: ${key}`);
  }
}

function isStaticAttachmentPath(resourcePath: string): boolean {
  return resourcePath.startsWith("./resources/") || resourcePath.startsWith("data:") || /^https?:\/\//i.test(resourcePath);
}

async function assertBrowserCanBoot(rootDir: string): Promise<void> {
  await withStaticServer(rootDir, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const failedRequests: string[] = [];
      const badResponses: string[] = [];
      const apiRequests: string[] = [];

      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
      });
      page.on("requestfailed", (request) => {
        failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`);
      });
      page.on("response", (response) => {
        if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
          badResponses.push(`${response.status()} ${response.url()}`);
        }
      });

      await page.goto(`${baseUrl}/index.html`, { waitUntil: "domcontentloaded" });
      const canvas = page.locator(".player-canvas");
      await canvas.waitFor({ state: "visible", timeout: 15000 });
      await page.waitForTimeout(500);

      const bootError = await page.locator(".player-boot-status.is-error").textContent({ timeout: 300 }).catch(() => "");
      assert(!bootError, `exported player boot error: ${bootError}`);

      const box = await canvas.boundingBox();
      assert(Boolean(box) && box!.width >= 300 && box!.height >= 200, "exported player canvas should be visible and sized");
      const canvasSize = await canvas.evaluate((node) => ({
        width: (node as HTMLCanvasElement).width,
        height: (node as HTMLCanvasElement).height,
      }));
      assert(canvasSize.width > 0 && canvasSize.height > 0, "exported player canvas backing store should be initialized");

      await page.keyboard.down("ArrowRight");
      await page.waitForTimeout(120);
      await page.keyboard.up("ArrowRight");
      await page.keyboard.press("KeyJ");
      await page.waitForTimeout(250);

      const editButton = page.locator('[data-player-action="edit"]');
      await editButton.waitFor({ state: "visible", timeout: 5000 });
      const resetButton = page.locator('[data-player-action="reset-scene"]');
      await resetButton.waitFor({ state: "visible", timeout: 5000 });
      const reconnectButton = page.locator('[data-player-action="reconnect"]');
      await reconnectButton.waitFor({ state: "visible", timeout: 5000 });
      await reconnectButton.click();
      await page.waitForFunction(() => document.querySelector('[data-role="tool-status"]')?.textContent?.includes("已完全重新连接"));
      await page.locator(".player-canvas").waitFor({ state: "visible", timeout: 15000 });
      await resetButton.click();
      await page.locator(".player-canvas").waitFor({ state: "visible", timeout: 15000 });
      await page.keyboard.press("KeyZ");
      await page.waitForURL(`${baseUrl}/editor.html?**`, { timeout: 15000 });
      const editorCanvas = page.locator("#v2-root canvas");
      await editorCanvas.waitFor({ state: "visible", timeout: 15000 });
      const commandCenter = page.locator('[data-role="command-center"]');
      const commandCenterValue = await commandCenter.inputValue({ timeout: 5000 });
      assert(commandCenterValue.includes("·"), `editor command center should show live project status, got ${commandCenterValue}`);
      assert(!commandCenterValue.includes("正在载入项目"), "editor command center should not keep the static loading placeholder");
      assert(!commandCenterValue.includes("???"), `editor command center should not expose corrupted project labels, got ${commandCenterValue}`);
      assert(await commandCenter.getAttribute("readonly") !== null, "editor command center should be readonly status, not fake input");
      const zoomText = await page.locator('[data-role="zoom-control"]').textContent({ timeout: 5000 });
      assert(Boolean(zoomText?.includes("%")), `editor zoom control should show live zoom, got ${zoomText}`);
      const modeBefore = await page.locator('[data-role="mode"]').textContent({ timeout: 5000 });
      await page.keyboard.press("KeyZ");
      await page.waitForTimeout(300);
      const modeAfter = await page.locator('[data-role="mode"]').textContent({ timeout: 5000 });
      assert(modeBefore !== modeAfter, `editor Z should toggle runtime mode, before=${modeBefore}, after=${modeAfter}`);
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyR");
      await page.keyboard.up("Alt");
      await page.locator("#v2-root canvas").waitFor({ state: "visible", timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('[data-role="notice"]')?.textContent?.includes("已完全重新连接"));

      assert(apiRequests.length === 0, `exported game should not request local APIs: ${apiRequests.join(", ")}`);
      assert(failedRequests.length === 0, `exported game should not have failed requests: ${failedRequests.join(", ")}`);
      assert(badResponses.length === 0, `exported game should not load error responses: ${badResponses.join(", ")}`);
      assert(pageErrors.length === 0, `exported game should not throw page errors: ${pageErrors.join("\n")}`);
      assert(consoleErrors.length === 0, `exported game should not log console errors: ${consoleErrors.join("\n")}`);
    } finally {
      await browser.close();
    }
  });
}

async function withStaticServer(rootDir: string, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => serveStatic(rootDir, request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object", "static smoke server should have an address");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function serveStatic(rootDir: string, request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end("method not allowed");
    return;
  }

  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  const pathname = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
  const filePath = path.resolve(rootDir, `.${pathname.replace(/\\/g, "/")}`);
  const relative = path.relative(rootDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }

  let fileStat;
  try {
    fileStat = statSync(filePath);
  } catch {
    response.writeHead(404);
    response.end("not found");
    return;
  }
  if (!fileStat.isFile()) {
    response.writeHead(404);
    response.end("not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeFromPath(filePath),
    "Content-Length": fileStat.size,
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function mimeFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".ogg") return "audio/ogg";
  return "application/octet-stream";
}

function embeddedProjectFromHtml(source: string): any {
  const match = /<script type="application\/json" data-webhachimi-project>([\s\S]*?)<\/script>/.exec(source);
  assert(match, "embedded project script should be present");
  return JSON.parse(unescapeScriptJson(match[1]));
}

function unescapeScriptJson(source: string): string {
  return source
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
