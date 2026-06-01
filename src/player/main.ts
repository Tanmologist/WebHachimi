// Boots the standalone player entry: project loading, RuntimeWorld setup, input binding,
// editor handoff, and the requestAnimationFrame loop. Renderer-specific work stays in
// PlayerRenderer; simulation stays fixed-step inside RuntimeWorld.
import "./styles.css";
import { normalizeProjectDefaults, type Project } from "../project/schema";
import { consumeEditorHandoff, createEditorHandoff, restoreWorldFromHandoff, saveEditorHandoff } from "../project/editorHandoff";
import { currentProjectProfile, loadProject } from "../project/persistence";
import { RuntimeWorld } from "../runtime/world";
import { createStarterProject, repairKnownStarterLabels } from "../editor/starterProject";
import { bindPlayerInput } from "./input";
import { PlayerRenderer } from "./renderer";

const rootElement = document.querySelector<HTMLElement>("#player-root");
if (!rootElement) throw new Error("missing #player-root");
const root = rootElement;

root.hidden = false;
root.removeAttribute("aria-hidden");

root.innerHTML = `
  <section class="player-stage" data-role="stage">
    <p class="player-boot-status" data-role="boot-status" role="status" aria-live="polite">正在加载世界...</p>
  </section>
  <nav class="player-controls" aria-label="game controls">
    <section class="player-pad" aria-label="movement">
      <button class="player-button" data-input="left" type="button" aria-label="left">←</button>
      <button class="player-button" data-input="right" type="button" aria-label="right">→</button>
    </section>
    <section class="player-actions" aria-label="combat actions">
      <button class="player-button player-action" data-input="attack" type="button" aria-label="attack">攻/蓄</button>
      <button class="player-button player-action" data-input="parry" type="button" aria-label="parry">振</button>
      <button class="player-button player-jump" data-input="jump" type="button" aria-label="jump">跳</button>
    </section>
  </nav>
`;

let raf = 0;
let lastTime = performance.now();
let cleanup = () => {};

const stage = query<HTMLElement>('[data-role="stage"]');
const bootStatus = query<HTMLElement>('[data-role="boot-status"]');
const savedProjectTimeoutMs = 3000;

void boot().catch(showBootError);

async function boot(): Promise<void> {
  setBootStatus("正在加载世界...");
  const resumeHandoff = consumeEditorHandoff();
  const project = normalizeProjectDefaults(repairKnownStarterLabels(resumeHandoff?.project || (await loadPlayableProject())));
  const scene = project.scenes[project.activeSceneId];
  if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);

  const world = new RuntimeWorld({ scene });
  let renderer: PlayerRenderer | undefined;
  let input: ReturnType<typeof bindPlayerInput> | undefined;
  let removeEditorHandoffKey: (() => void) | undefined;
  let booted = false;

  try {
    renderer = new PlayerRenderer();
    await renderer.init({ host: stage, scene, resources: project.resources });

    input = bindPlayerInput(root, world);
    removeEditorHandoffKey = bindEditorHandoffKey(project, world);
    if (resumeHandoff) restoreWorldFromHandoff(world, resumeHandoff);
    world.setMode("game");
    lastTime = performance.now();

    cleanup = () => {
      cleanup = () => {};
      cancelAnimationFrame(raf);
      removeEditorHandoffKey?.();
      input?.destroy();
      renderer?.destroy();
    };
    booted = true;
    bootStatus.remove();
    loop(lastTime, renderer, world);
  } finally {
    if (!booted) {
      removeEditorHandoffKey?.();
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

function bindEditorHandoffKey(project: Project, world: RuntimeWorld): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "z" || isTypingTarget(event.target)) return;
    event.preventDefault();
    if (event.repeat) return;
    cleanup();
    saveEditorHandoff(createEditorHandoff(project, world));
    window.location.href = editorHandoffUrl();
  };
  window.addEventListener("keydown", onKeyDown, { passive: false });
  return () => window.removeEventListener("keydown", onKeyDown);
}

async function loadPlayableProject(): Promise<Project> {
  return embeddedProject() || (await savedProjectWithTimeout(savedProjectTimeoutMs)) || createStarterProject();
}

function embeddedProject(): Project | null {
  const element = document.querySelector<HTMLScriptElement>('script[type="application/json"][data-webhachimi-project]');
  const raw = element?.textContent?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Project;
    return parsed?.kind === "webhachimi-v2-project" && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function editorHandoffUrl(): string {
  const editorUrl = document.querySelector<HTMLMetaElement>('meta[name="webhachimi-editor-url"]')?.content || "/apps/webhachimi/editor.html";
  const separator = editorUrl.includes("?") ? "&" : "?";
  return `${editorUrl}${separator}from=player-freeze&project=${encodeURIComponent(currentProjectProfile())}`;
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
  bootStatus.classList.remove("is-error");
  bootStatus.textContent = message;
}

function showBootError(error: unknown): void {
  console.error("Player boot failed", error);
  bootStatus.classList.add("is-error");
  bootStatus.textContent = `游戏启动失败。\n${error instanceof Error ? error.message : String(error)}`;
}

window.addEventListener("beforeunload", () => {
  cleanup();
});
