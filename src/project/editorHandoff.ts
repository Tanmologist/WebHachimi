// Owns the browser-session data envelope used when switching between player and
// editor pages. This project-layer module validates and stores handoff payloads;
// RuntimeWorld-specific create/restore behavior lives in runtime/editorHandoff.
import type { Project, RuntimeSnapshot } from "./schema";

const EDITOR_HANDOFF_KEY = "webhachimi:editor-handoff";

export type EditorHandoff = {
  kind: "webhachimi-v2-editor-handoff";
  version: 1;
  project: Project;
  snapshot: RuntimeSnapshot;
  createdAt: string;
};

type HandoffStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export class EditorHandoffStore {
  constructor(
    private readonly storage: HandoffStorage,
    private readonly key = EDITOR_HANDOFF_KEY,
  ) {}

  save(handoff: EditorHandoff): void {
    this.storage.setItem(this.key, JSON.stringify(handoff));
  }

  consume(): EditorHandoff | null {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    this.storage.removeItem(this.key);
    try {
      const parsed = JSON.parse(raw) as EditorHandoff;
      return isEditorHandoff(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export function saveEditorHandoff(handoff: EditorHandoff): void {
  browserEditorHandoffStore().save(handoff);
}

export function consumeEditorHandoff(): EditorHandoff | null {
  return browserEditorHandoffStore().consume();
}

function browserEditorHandoffStore(): EditorHandoffStore {
  return new EditorHandoffStore(window.sessionStorage);
}

export function isEditorHandoff(value: unknown): value is EditorHandoff {
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
