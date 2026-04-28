import type { Project, RuntimeSnapshot } from "./schema";
import type { RuntimeWorld } from "../runtime/world";
import { cloneJson } from "../shared/types";

const EDITOR_HANDOFF_KEY = "webhachimi:v2:editor-handoff";

export type EditorHandoff = {
  kind: "webhachimi-v2-editor-handoff";
  version: 1;
  project: Project;
  snapshot: RuntimeSnapshot;
  createdAt: string;
};

export function createEditorHandoff(project: Project, world: RuntimeWorld): EditorHandoff {
  const snapshot = world.freezeForInspection();
  return {
    kind: "webhachimi-v2-editor-handoff",
    version: 1,
    project: mergeWorldIntoProject(project, world),
    snapshot,
    createdAt: new Date().toISOString(),
  };
}

export function restoreWorldFromHandoff(world: RuntimeWorld, handoff: EditorHandoff): void {
  world.restoreSnapshot(handoff.snapshot);
}

export function saveEditorHandoff(handoff: EditorHandoff): void {
  window.sessionStorage.setItem(EDITOR_HANDOFF_KEY, JSON.stringify(handoff));
}

export function consumeEditorHandoff(): EditorHandoff | null {
  const raw = window.sessionStorage.getItem(EDITOR_HANDOFF_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(EDITOR_HANDOFF_KEY);
  try {
    const parsed = JSON.parse(raw) as EditorHandoff;
    return isEditorHandoff(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mergeWorldIntoProject(project: Project, world: RuntimeWorld): Project {
  const next = cloneJson(project);
  const scene = next.scenes[next.activeSceneId];
  for (const entity of world.entities.values()) {
    if (entity.persistent) scene.entities[entity.id] = cloneJson(entity);
  }
  next.meta.updatedAt = new Date().toISOString();
  return next;
}

function isEditorHandoff(value: unknown): value is EditorHandoff {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const handoff = value as EditorHandoff;
  return (
    handoff.kind === "webhachimi-v2-editor-handoff" &&
    handoff.version === 1 &&
    handoff.project?.kind === "webhachimi-v2-project" &&
    handoff.project.version === 1 &&
    typeof handoff.snapshot?.sceneId === "string"
  );
}
