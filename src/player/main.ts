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
  <section class="player-stage" data-role="stage"></section>
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

const stage = query<HTMLElement>('[data-role="stage"]');
const resumeHandoff = consumeEditorHandoff();
const project = normalizeProjectDefaults(repairKnownStarterLabels(resumeHandoff?.project || (await loadPlayableProject())));
const scene = project.scenes[project.activeSceneId];
const world = new RuntimeWorld({ scene });
const renderer = new PlayerRenderer();

let raf = 0;
let lastTime = performance.now();

await renderer.init({ host: stage, scene });
const input = bindPlayerInput(root, world);
const removeEditorHandoffKey = bindEditorHandoffKey();
if (resumeHandoff) restoreWorldFromHandoff(world, resumeHandoff);
world.setMode("game");
loop(lastTime);

function loop(time: number): void {
  const delta = Math.min(time - lastTime, 80);
  lastTime = time;
  world.pushDelta(delta);
  renderer.render(world);
  raf = requestAnimationFrame(loop);
}

function query<T extends HTMLElement>(selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

function bindEditorHandoffKey(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "z" || isTypingTarget(event.target)) return;
    event.preventDefault();
    if (event.repeat) return;
    cancelAnimationFrame(raf);
    saveEditorHandoff(createEditorHandoff(project, world));
    window.location.href = editorHandoffUrl();
  };
  window.addEventListener("keydown", onKeyDown, { passive: false });
  return () => window.removeEventListener("keydown", onKeyDown);
}

async function loadPlayableProject(): Promise<Project> {
  return normalizeProjectDefaults(repairKnownStarterLabels(embeddedProject() || (await savedProject()) || createStarterProject()));
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

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(raf);
  removeEditorHandoffKey();
  input.destroy();
  renderer.destroy();
});
