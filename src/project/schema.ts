import type {
  BodyMode,
  BrushAnnotationId,
  BrushStrokeId,
  AutonomyRunId,
  EntityId,
  Rect,
  ResourceId,
  Result,
  RuntimeMode,
  SceneId,
  ShapeKind,
  SnapshotId,
  TaskId,
  TaskStatus,
  TestRecordId,
  TransactionId,
  TransactionStatus,
  Transform2D,
  Vec2,
} from "../shared/types";
import { makeId, ok } from "../shared/types";

export type ProjectMeta = {
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type SceneSettings = {
  width: number;
  height: number;
  background: string;
  gravity: Vec2;
  tickRate: number;
  fixedStepMs: number;
};

export type Project = {
  kind: "webhachimi-v2-project";
  version: 1;
  meta: ProjectMeta;
  activeSceneId: SceneId;
  scenes: Record<string, Scene>;
  resources: Record<string, Resource>;
  tasks: Record<string, Task>;
  transactions: Record<string, Transaction>;
  testRecords: Record<string, TestRecord>;
  snapshots: Record<string, RuntimeSnapshot>;
  autonomyRuns: Record<string, AutonomyRun>;
};

export type Scene = {
  id: SceneId;
  name: string;
  settings: SceneSettings;
  entities: Record<string, Entity>;
  folders: SceneFolder[];
  layers: SceneLayer[];
};

export type SceneFolder = {
  id: string;
  displayName: string;
  entityIds: EntityId[];
};

export type SceneLayer = {
  id: string;
  displayName: string;
  order: number;
  visible: boolean;
  locked: boolean;
};

export type Entity = {
  id: EntityId;
  internalName: string;
  displayName: string;
  kind: "entity" | "presentation" | "trigger" | "effect" | "custom";
  persistent: boolean;
  transform: Transform2D;
  render?: RenderComponent;
  body?: BodyComponent;
  collider?: ColliderComponent;
  behavior?: BehaviorComponent;
  runtime?: RuntimeComponent;
  resources: ResourceBinding[];
  tags: string[];
  parentId?: EntityId;
  folderId?: string;
};

export type RenderComponent = {
  visible: boolean;
  color: string;
  opacity: number;
  layerId: string;
};

export type BodyComponent = {
  mode: BodyMode;
  velocity: Vec2;
  gravityScale: number;
  friction: number;
  bounce: number;
};

export type ColliderComponent = {
  shape: ShapeKind;
  size: Vec2;
  radius?: number;
  points?: Vec2[];
  solid: boolean;
  trigger: boolean;
  layerMask: string[];
};

export type BehaviorComponent = {
  description: string;
  normalizedDescription?: string;
  builtin?: "playerPlatformer" | "enemyPatrol" | "projectile" | "collectible";
  params: Record<string, number | string | boolean>;
};

export type RuntimeComponent = {
  lifetimeMs?: number;
  ageMs?: number;
  grounded?: boolean;
  wasGrounded?: boolean;
  patrolDirection?: -1 | 1;
  facing?: -1 | 1;
  health?: number;
  attackStartFrame?: number;
  attackActiveUntilFrame?: number;
  attackCooldownUntilFrame?: number;
  attackHitIds?: EntityId[];
  parryUntilFrame?: number;
  parryCooldownUntilFrame?: number;
  hitStunUntilFrame?: number;
};

export type Resource = {
  id: ResourceId;
  internalName: string;
  displayName: string;
  type: "image" | "sprite" | "animation" | "audio" | "material" | "note";
  description: string;
  aiDescription?: string;
  tags: string[];
  attachments: ResourceAttachment[];
};

export type ResourceAttachment = {
  id: string;
  fileName: string;
  mime: string;
  path: string;
};

export type ResourceBinding = {
  resourceId: ResourceId;
  slot: string;
  description: string;
  aiDescription?: string;
  localOffset: Vec2;
  localRotation: number;
  localScale: Vec2;
};

export type Task = {
  id: TaskId;
  source: "user" | "superBrush" | "ai" | "testFailure";
  title: string;
  userText: string;
  normalizedText?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  status: TaskStatus;
  targetRefs: TargetRef[];
  brushContext?: BrushContext;
  snapshotRef?: SnapshotId;
  transactionRefs: TransactionId[];
  testRecordRefs: TestRecordId[];
  createdAt: string;
  updatedAt: string;
};

export type TargetRef =
  | { kind: "scene"; sceneId: SceneId }
  | { kind: "entity"; entityId: EntityId }
  | { kind: "resource"; resourceId: ResourceId }
  | { kind: "area"; sceneId: SceneId; rect: Rect }
  | { kind: "runtime"; sceneId?: SceneId };

export type BrushContext = {
  strokes: BrushStroke[];
  annotations: BrushAnnotation[];
  selectionBox?: Rect;
  targetEntityIds: EntityId[];
  capturedSnapshotId?: SnapshotId;
  summary?: string;
};

export type BrushStroke = {
  id: BrushStrokeId;
  points: Vec2[];
  color: string;
  width: number;
  pressure?: number;
};

export type BrushAnnotation = {
  id: BrushAnnotationId;
  text: string;
  position: Vec2;
  targetRef?: TargetRef;
  createdAt: string;
};

export type Transaction = {
  id: TransactionId;
  taskId?: TaskId;
  actor: "user" | "ai" | "system";
  status: TransactionStatus;
  baseProjectHash: string;
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  diffSummary: string;
  testRecordRefs: TestRecordId[];
  createdAt: string;
  appliedAt?: string;
  rolledBackAt?: string;
};

export type ProjectPatchPath =
  | `/meta/${string}`
  | `/scenes/${string}`
  | `/resources/${string}`
  | `/tasks/${string}`
  | `/transactions/${string}`
  | `/testRecords/${string}`
  | `/snapshots/${string}`
  | `/autonomyRuns/${string}`;

export type ProjectPatch =
  | { op: "set"; path: ProjectPatchPath; value: unknown }
  | { op: "delete"; path: ProjectPatchPath }
  | { op: "append"; path: ProjectPatchPath; value: unknown };

export type RuntimeSnapshot = {
  id: SnapshotId;
  sceneId: SceneId;
  mode: RuntimeMode;
  frame: number;
  timeMs: number;
  clockAccumulatorMs?: number;
  entities: Record<string, RuntimeEntityState>;
  transientEntities: Record<string, Entity>;
  input: Record<string, boolean>;
  combatEvents: CombatEvent[];
  randomSeedState?: string;
  capturedAt?: string;
};

export type RuntimeEntityState = {
  entityId: EntityId;
  transform: Transform2D;
  velocity: Vec2;
  bodyMode?: BodyMode;
  ageMs?: number;
  lifetimeMs?: number;
  grounded?: boolean;
  animationFrame?: number;
  timers: Record<string, number>;
  state: Record<string, unknown>;
};

export type CombatEvent = {
  id: string;
  frame: number;
  type: "attackStarted" | "parryStarted" | "parrySuccess" | "hit";
  attackerId?: EntityId;
  defenderId?: EntityId;
  sourceId?: EntityId;
  targetId?: EntityId;
  message: string;
  data?: Record<string, unknown>;
};

export type TestRecord = {
  id: TestRecordId;
  taskId?: TaskId;
  transactionId?: TransactionId;
  script: InputScript;
  result: "passed" | "failed" | "interrupted";
  frameChecks: FrameCheck[];
  initialSnapshotRef?: SnapshotId;
  failureSnapshotRef?: SnapshotId;
  snapshotRefs?: SnapshotId[];
  logs: TestLog[];
  timings?: TestTiming[];
  tickRate?: number;
  scriptTickRate?: number;
  timeScale?: number;
  timeScaleMode?: TestTimeScaleMode;
  timeScaleReason?: string;
  traceSummary?: string;
  createdAt: string;
};

export type InputScript = {
  tickRate?: number;
  timeScale?: number;
  timeScaleMode?: TestTimeScaleMode;
  timeScaleReason?: string;
  steps: InputStep[];
};

export type TestTimeScaleMode = "manual" | "ai-auto";

export type InputStep =
  | { op: "hold"; key: string; ticks?: number; frames?: number }
  | { op: "tap"; key: string; ticks?: number; frames?: number }
  | { op: "wait"; ticks?: number; frames?: number }
  | { op: "freezeAndInspect"; checks: FrameCheck[] };

export type FrameCheck = {
  label: string;
  target: TargetRef;
  expect: Record<string, unknown>;
};

export type AcceptanceCriterion = FrameCheck;

export type AutonomyRun = {
  id: AutonomyRunId;
  mode: "task" | "selfTest";
  status: "passed" | "failed" | "interrupted";
  taskId?: TaskId;
  createdFailureTaskIds: TaskId[];
  testRecordRefs: TestRecordId[];
  snapshotRefs: SnapshotId[];
  transactionRefs: TransactionId[];
  traceSummary: string;
  decisionSummary: string;
  nextSteps: string[];
  startedAt: string;
  finishedAt: string;
};

export type TestLog = {
  level: "info" | "warning" | "error";
  frame: number;
  message: string;
};

export type TestTiming = {
  stepIndex: number;
  op: InputStep["op"];
  key?: string;
  label: string;
  startTick: number;
  endTick: number;
  durationTicks: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  scaledStartTimeMs: number;
  scaledEndTimeMs: number;
  scaledDurationMs: number;
  timeScale: number;
};

export function createEmptyProject(name = "未命名游戏"): Result<Project> {
  const now = new Date().toISOString();
  const sceneId = makeId<"SceneId">("scene");
  return ok(normalizeProjectDefaults({
    kind: "webhachimi-v2-project",
    version: 1,
    meta: { name, createdAt: now, updatedAt: now },
    activeSceneId: sceneId,
    scenes: {
      [sceneId]: {
        id: sceneId,
        name: "主场景",
        settings: {
          width: 1600,
          height: 900,
          background: "#111313",
          gravity: { x: 0, y: 1600 },
          tickRate: 100,
          fixedStepMs: 1000 / 100,
        },
        entities: {},
        folders: [],
        layers: [{ id: "world", displayName: "世界", order: 0, visible: true, locked: false }],
      },
    },
    resources: {},
    tasks: {},
    transactions: {},
    testRecords: {},
    snapshots: {},
    autonomyRuns: {},
  }));
}

export function normalizeProjectDefaults(project: Project): Project {
  project.resources ||= {};
  project.tasks ||= {};
  project.transactions ||= {};
  project.testRecords ||= {};
  project.snapshots ||= {};
  project.autonomyRuns ||= {};
  Object.values(project.scenes).forEach((scene) => {
    normalizeSceneSettings(scene.settings);
    Object.values(scene.entities).forEach((entity) => normalizeEntityDefaults(entity));
  });
  return project;
}

export function normalizeSceneSettings(settings: SceneSettings): SceneSettings {
  const tickRate = Number.isFinite(settings.tickRate) && settings.tickRate > 0 ? settings.tickRate : 100;
  settings.tickRate = tickRate;
  settings.fixedStepMs = 1000 / tickRate;
  return settings;
}

export function normalizeEntityDefaults(entity: Entity): Entity {
  if (entity.kind !== "entity") return entity;
  if (!entity.collider) {
    entity.collider = {
      shape: "box",
      size: { x: 64, y: 64 },
      solid: true,
      trigger: false,
      layerMask: ["world"],
    };
  } else {
    if (!entity.collider.shape) entity.collider.shape = "box";
    if (!entity.collider.size || entity.collider.size.x <= 0 || entity.collider.size.y <= 0) {
      entity.collider.size = { x: 64, y: 64 };
    }
    if (!entity.collider.trigger && !entity.collider.solid) entity.collider.solid = true;
    if (!Array.isArray(entity.collider.layerMask) || entity.collider.layerMask.length === 0) {
      entity.collider.layerMask = ["world"];
    }
  }
  if (!entity.body) {
    entity.body = {
      mode: "static",
      velocity: { x: 0, y: 0 },
      gravityScale: 0,
      friction: 0.8,
      bounce: 0,
    };
  }
  return entity;
}
