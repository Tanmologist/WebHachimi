import type { Entity, RuntimeComponent } from "./schema";

export function persistentRuntimeForProject(runtime: RuntimeComponent | undefined): RuntimeComponent | undefined {
  if (!runtime) return undefined;
  const next: RuntimeComponent = {};
  if (typeof runtime.lifetimeMs === "number") next.lifetimeMs = runtime.lifetimeMs;
  return Object.keys(next).length ? next : undefined;
}

export function stripVolatileRuntimeState(entity: Entity): Entity {
  const runtime = persistentRuntimeForProject(entity.runtime);
  if (runtime) entity.runtime = runtime;
  else delete entity.runtime;
  return entity;
}
