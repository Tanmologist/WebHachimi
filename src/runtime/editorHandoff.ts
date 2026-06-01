// Owns RuntimeWorld-specific handoff behavior between player and editor modes.
// The project handoff module stores the serializable payload; this bridge knows
// how to freeze, merge persistent runtime entities, and restore snapshots.
import type { Project } from "../project/schema";
import type { EditorHandoff } from "../project/editorHandoff";
import { stripVolatileRuntimeState } from "../project/runtimeState";
import { cloneJson } from "../shared/types";
import type { RuntimeWorld } from "./world";

export class EditorHandoffRuntimeBridge {
  create(project: Project, world: RuntimeWorld): EditorHandoff {
    const snapshot = world.freezeForInspection();
    return {
      kind: "webhachimi-v2-editor-handoff",
      version: 1,
      project: this.mergeWorldIntoProject(project, world),
      snapshot,
      createdAt: new Date().toISOString(),
    };
  }

  restore(world: RuntimeWorld, handoff: EditorHandoff): void {
    world.restoreSnapshot(handoff.snapshot);
  }

  private mergeWorldIntoProject(project: Project, world: RuntimeWorld): Project {
    const next = cloneJson(project);
    const scene = next.scenes[next.activeSceneId];
    for (const entity of world.entities.values()) {
      if (entity.persistent) scene.entities[entity.id] = stripVolatileRuntimeState(cloneJson(entity));
    }
    next.meta.updatedAt = new Date().toISOString();
    return next;
  }
}

export const editorHandoffRuntimeBridge = new EditorHandoffRuntimeBridge();

export function createEditorHandoff(project: Project, world: RuntimeWorld): EditorHandoff {
  return editorHandoffRuntimeBridge.create(project, world);
}

export function restoreWorldFromHandoff(world: RuntimeWorld, handoff: EditorHandoff): void {
  editorHandoffRuntimeBridge.restore(world, handoff);
}
