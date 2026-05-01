import type { Project, TargetRef, Task } from "../project/schema";
import { err, ok, type Result } from "../shared/types";

export function validateExplicitTaskTargets(project: Project, task: Task): Result<void> {
  const invalid = explicitTaskTargets(task).filter((target) => !targetExists(project, target));
  if (invalid.length === 0) return ok(undefined);
  return err(`stale target reference(s): ${invalid.map(describeTarget).join(", ")}`);
}

export function explicitTaskTargets(task: Task): TargetRef[] {
  const refs = [
    ...task.targetRefs,
    ...(task.brushContext?.raw?.targetRefs || []),
    ...(task.brushContext?.compiled?.targetRefs || []),
  ];
  const seen = new Set<string>();
  return refs.filter((target) => {
    const key = JSON.stringify(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function targetExists(project: Project, target: TargetRef): boolean {
  if (target.kind === "scene") return Boolean(project.scenes[target.sceneId]);
  if (target.kind === "entity") return Object.values(project.scenes).some((scene) => Boolean(scene.entities[target.entityId]));
  if (target.kind === "resource") return Boolean(project.resources[target.resourceId]);
  if (target.kind === "area") return Boolean(project.scenes[target.sceneId]);
  if (target.kind === "runtime") return !target.sceneId || Boolean(project.scenes[target.sceneId]);
  return false;
}

function describeTarget(target: TargetRef): string {
  if (target.kind === "scene") return `scene:${target.sceneId}`;
  if (target.kind === "entity") return `entity:${target.entityId}`;
  if (target.kind === "resource") return `resource:${target.resourceId}`;
  if (target.kind === "area") return `area:${target.sceneId}`;
  return `runtime:${target.sceneId || "*"}`;
}
