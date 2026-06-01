// Boots the standalone player entry: project loading, RuntimeWorld setup,
// input binding, static-editor handoff, restart controls, and the animation
// loop. Rendering stays in PlayerRenderer; simulation stays in RuntimeWorld.
import "./styles.css";
import { embeddedProjectFromDocument } from "../project/embeddedProject";
import { consumeEditorHandoff, saveEditorHandoff } from "../project/editorHandoff";
import { currentProjectEndpoint, currentProjectProfile, loadProject } from "../project/persistence";
import { normalizeProjectDefaults, type Project } from "../project/schema";
import { createEditorHandoff, restoreWorldFromHandoff } from "../runtime/editorHandoff";
import { RuntimeWorld } from "../runtime/world";
import { createStarterProject } from "../samples/starterProject";
import { bindPlayerInput } from "./input";
import { PlayerRenderer } from "./renderer";

type ProjectSource = "auto" | "embedded" | "saved";

const rootElement = document.querySelector<HTMLElement>("#player-root");
if (!rootElement) throw new Error("missing #player-root");
const root = rootElement;

root.hidden = false;
root.removeAttribute("aria-hidden");

root.innerHTML = `
  <section class="player-stage" data-role="stage">
    <p class="player-boot-status" data-role="boot-status" role="status" aria-live="polite">正在加载世界...</p>
  </section>
  <aside class="player-toolbar" aria-label="player tools">
    <button class="player-tool-button is-primary" data-player-action="edit" type="button" title="按 Z 进入编辑器">编辑 Z</button>
    <button class="player-tool-button" data-player-action="reset-scene" type="button">重置场景</button>
    <button class="player-tool-button" data-player-action="reconnect" type="button">重新连接</button>
    <details class="player-settings">
      <summary>快速设置</summary>
      <div class="player-settings-panel" aria-label="world speed">
        <span>世界速度</span>
        <button class="player-tool-button" data-player-speed="0.5" type="button">0.5x</button>
        <button class="player-tool-button" data-player-speed="1" type="button">1x</button>
        <button class="player-tool-button" data-player-speed="2" type="button">2x</button>
      </div>
    </details>
    <span class="player-tool-status" data-role="tool-status" role="status" aria-live="polite">游戏模式</span>
  </aside>
  <nav class="player-controls" aria-label="game controls">
    <section class="player-pad" aria-label="movement">
      <button class="player-button" data-input="left" type="button" aria-label="left">←</button>
      <button class="player-button" data-input="right" type="button" aria-label="right">→</button>
    </section>
    <section class="player-actions" aria-label="combat actions">
      <button class="player-button player-action" data-input="attack" type="button" aria-label="attack">攻</button>
      <button class="player-button player-action" data-input="parry" type="button" aria-label="parry">防</button>
      <button class="player-button player-jump" data-input="jump" type="button" aria-label="jump">跳</button>
    </section>
  </nav>
`;

let raf = 0;
let lastTime = performance.now();
let cleanup = () => {};

const stage = query<HTMLElement>('[data-role="stage"]');
const bootStatus = query<HTMLElement>('[data-role="boot-status"]');
const toolStatus = query<HTMLElement>('[data-role="tool-status"]');
const savedProjectTimeoutMs = 3000;

void boot().catch(showBootError);

async function boot(options: { projectSource?: ProjectSource; notice?: string } = {}): Promise<void> {
  cleanup();
  setBootStatus("正在加载世界...");
  setToolStatus(options.notice || "正在连接项目...");

  const resumeHandoff = editorHandoffDisabled() ? null : consumeEditorHandoff();
  const project = normalizeProjectDefaults(resumeHandoff?.project || (await loadPlayableProject(options.projectSource || "auto")));
  const scene = project.scenes[project.activeSceneId];
  if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);

  const world = new RuntimeWorld({ scene });
  let renderer: PlayerRenderer | undefined;
  let input: ReturnType<typeof bindPlayerInput> | undefined;
  let removePlayerTools: (() => void) | undefined;
  let booted = false;

  try {
    renderer = new PlayerRenderer();
    await renderer.init({ host: stage, scene, resources: project.resources });

    input = bindPlayerInput(root, world);
    removePlayerTools = bindPlayerTools(project, world);
    if (resumeHandoff) restoreWorldFromHandoff(world, resumeHandoff);
    world.setMode("game");
    lastTime = performance.now();

    cleanup = () => {
      cleanup = () => {};
      cancelAnimationFrame(raf);
      removePlayerTools?.();
      input?.destroy();
      renderer?.destroy();
    };
    booted = true;
    bootStatus.hidden = true;
    setToolStatus(resumeHandoff ? "已从编辑器继续运行，按 Z 回到编辑器" : options.notice || "游戏模式：按 Z 进入编辑器");
    loop(lastTime, renderer, world);
  } finally {
    if (!booted) {
      removePlayerTools?.();
      input?.destroy();
      renderer?.destroy();
    }
  }
}

function loop(time: number, renderer: PlayerRenderer, world: RuntimeWorld): void {
  const delta = Math.min(time - lastTime, 80);
  lastTime = time;
  world.pushDelta(delta);
  renderer.render(world, delta);
  raf = requestAnimationFrame((nextTime) => loop(nextTime, renderer, world));
}

function query<T extends HTMLElement>(selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

function bindPlayerTools(project: Project, world: RuntimeWorld): () => void {
  const cleanupHandlers: Array<() => void> = [];
  const editButton = root.querySelector<HTMLButtonElement>('[data-player-action="edit"]');
  const resetButton = root.querySelector<HTMLButtonElement>('[data-player-action="reset-scene"]');
  const reconnectButton = root.querySelector<HTMLButtonElement>('[data-player-action="reconnect"]');
  const speedButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-player-speed]"));
  const editDisabled = editorHandoffDisabled();

  if (editButton) {
    editButton.disabled = editDisabled;
    editButton.title = editDisabled ? "当前页面没有导出编辑器" : "按 Z 进入编辑器";
    const onEditClick = () => startEditorHandoff(project, world);
    editButton.addEventListener("click", onEditClick);
    cleanupHandlers.push(() => editButton.removeEventListener("click", onEditClick));
  }

  if (resetButton) {
    const onResetClick = () => {
      void boot({ projectSource: "embedded", notice: "场景已重置为导出演示" }).catch(showBootError);
    };
    resetButton.addEventListener("click", onResetClick);
    cleanupHandlers.push(() => resetButton.removeEventListener("click", onResetClick));
  }

  if (reconnectButton) {
    const onReconnectClick = () => {
      void boot({ projectSource: "saved", notice: "已重新连接项目数据" }).catch(showBootError);
    };
    reconnectButton.addEventListener("click", onReconnectClick);
    cleanupHandlers.push(() => reconnectButton.removeEventListener("click", onReconnectClick));
  }

  speedButtons.forEach((button) => {
    const onSpeedClick = () => {
      const speed = Number(button.dataset.playerSpeed || "1");
      if (!Number.isFinite(speed) || speed <= 0) return;
      world.setTimeScale(speed);
      setToolStatus(`世界速度 ${speed}x`);
      syncSpeedButtons(speed);
    };
    button.addEventListener("click", onSpeedClick);
    cleanupHandlers.push(() => button.removeEventListener("click", onSpeedClick));
  });
  syncSpeedButtons(world.timeScale);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "z" || isTypingTarget(event.target) || editDisabled) return;
    event.preventDefault();
    if (event.repeat) return;
    startEditorHandoff(project, world);
  };
  window.addEventListener("keydown", onKeyDown, { passive: false });
  cleanupHandlers.push(() => window.removeEventListener("keydown", onKeyDown));

  return () => cleanupHandlers.forEach((dispose) => dispose());
}

function syncSpeedButtons(speed: number): void {
  root.querySelectorAll<HTMLButtonElement>("[data-player-speed]").forEach((button) => {
    const value = Number(button.dataset.playerSpeed || "1");
    button.classList.toggle("is-active", Math.abs(value - speed) < 0.001);
  });
}

function startEditorHandoff(project: Project, world: RuntimeWorld): void {
  if (editorHandoffDisabled()) {
    setToolStatus("当前导出没有可用编辑器");
    return;
  }
  saveEditorHandoff(createEditorHandoff(project, world));
  cleanup();
  window.location.href = editorHandoffUrl();
}

function editorHandoffDisabled(): boolean {
  const value = document.querySelector<HTMLMetaElement>('meta[name="webhachimi-disable-editor-handoff"]')?.content.trim().toLowerCase();
  return value === "1" || value === "true";
}

async function loadPlayableProject(source: ProjectSource): Promise<Project> {
  if (source === "embedded") return embeddedProject() || createStarterProject(starterProjectOptionsFromPage());
  if (source === "saved") return (await savedProjectWithTimeout(savedProjectTimeoutMs)) || embeddedProject() || createStarterProject(starterProjectOptionsFromPage());
  return embeddedProject() || (await savedProjectWithTimeout(savedProjectTimeoutMs)) || createStarterProject(starterProjectOptionsFromPage());
}

function starterProjectOptionsFromPage(): { resourceBasePath?: string } {
  const resourceBasePath = document.querySelector<HTMLMetaElement>('meta[name="webhachimi-sample-resource-base"]')?.content.trim();
  return resourceBasePath ? { resourceBasePath } : {};
}

function embeddedProject(): Project | null {
  return embeddedProjectFromDocument();
}

function editorHandoffUrl(): string {
  const editorUrl = document.querySelector<HTMLMetaElement>('meta[name="webhachimi-editor-url"]')?.content || "/apps/webhachimi/editor.html";
  const separator = editorUrl.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    from: "player-freeze",
    project: currentProjectProfile(),
  });
  const projectEndpoint = currentProjectEndpoint();
  if (projectEndpoint) params.set("projectEndpoint", projectEndpoint);
  return `${editorUrl}${separator}${params.toString()}`;
}

async function savedProject(): Promise<Project | null> {
  try {
    const result = await loadProject();
    return result.project;
  } catch {
    return null;
  }
}

async function savedProjectWithTimeout(timeoutMs: number): Promise<Project | null> {
  let timeoutId = 0;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([savedProject(), timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function setBootStatus(message: string): void {
  bootStatus.hidden = false;
  bootStatus.classList.remove("is-error");
  bootStatus.textContent = message;
}

function setToolStatus(message: string): void {
  toolStatus.textContent = message;
}

function showBootError(error: unknown): void {
  console.error("Player boot failed", error);
  bootStatus.classList.add("is-error");
  bootStatus.hidden = false;
  bootStatus.textContent = `游戏启动失败。\n${error instanceof Error ? error.message : String(error)}`;
  setToolStatus("连接失败");
}

window.addEventListener("beforeunload", () => {
  cleanup();
});
