export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ProjectId = Brand<string, "ProjectId">;
export type SceneId = Brand<string, "SceneId">;
export type EntityId = Brand<string, "EntityId">;
export type ResourceId = Brand<string, "ResourceId">;
export type TaskId = Brand<string, "TaskId">;
export type BrushStrokeId = Brand<string, "BrushStrokeId">;
export type BrushAnnotationId = Brand<string, "BrushAnnotationId">;
export type TransactionId = Brand<string, "TransactionId">;
export type SnapshotId = Brand<string, "SnapshotId">;
export type TestRecordId = Brand<string, "TestRecordId">;
export type AutonomyRunId = Brand<string, "AutonomyRunId">;

export type Vec2 = {
  x: number;
  y: number;
};

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Transform2D = {
  position: Vec2;
  rotation: number;
  scale: Vec2;
};

export type RuntimeMode = "game" | "editorFrozen";
export type BodyMode = "static" | "dynamic" | "kinematic" | "none";
export type ShapeKind = "box" | "circle" | "polygon";
export type TaskStatus = "draft" | "queued" | "running" | "passed" | "failed" | "rolledBack";
export type TransactionStatus = "dryRun" | "applied" | "failed" | "rolledBack";

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<E extends string>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function makeId<T extends string>(prefix: string): Brand<string, T> {
  const value = `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  return value as Brand<string, T>;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
