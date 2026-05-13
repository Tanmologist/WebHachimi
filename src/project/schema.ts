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
import type { CombatActionRuntime } from "../combat/types";

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
  timeScale: number;
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
  size?: Vec2;
  offset?: Vec2;
  rotation?: number;
  scale?: Vec2;
  slot?: string;
  state?: string;
  resourceId?: ResourceId;
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
  offset?: Vec2;
  rotation?: number;
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
  defeated?: boolean;
  hitFlashUntilMs?: number;
  defeatTimeMs?: number;
  hitFlashUntilFrame?: number;
  defeatFrame?: number;
  combatAction?: CombatActionRuntime;
  attackStartMs?: number;
  attackActiveUntilMs?: number;
  attackCooldownUntilMs?: number;
  attackStartFrame?: number;
  attackActiveUntilFrame?: number;
  attackCooldownUntilFrame?: number;
  attackHitIds?: EntityId[];
  attackTouchEntityId?: EntityId;
  attackMovementTargetEntityId?: EntityId;
  attackMoveStartedMs?: number;
  attackMoveUntilMs?: number;
  attackMoveOffsetX?: number;
  attackMoveOffsetY?: number;
  attackMoveTargetX?: number;
  attackMoveTargetY?: number;
  attackKind?: "normal" | "charged" | "superParry";
  attackDamage?: number;
  attackControlLevel?: number;
  attackArmorLevel?: number;
  attackChargeStage?: number;
  attackInputDown?: boolean;
  attackConsumedUntilRelease?: boolean;
  parryInputDown?: boolean;
  dodgeInputDown?: boolean;
  dodgeStartedMs?: number;
  dodgeUntilMs?: number;
  dodgeRecoveryUntilMs?: number;
  dodgeStartedFrame?: number;
  dodgeUntilFrame?: number;
  dodgeRecoveryUntilFrame?: number;
  chargeStartedMs?: number;
  chargeHeldMs?: number;
  chargeStartedFrame?: number;
  chargeHeldFrames?: number;
  chargeStage?: number;
  chargeStoredDamage?: number;
  parryStartedMs?: number;
  parryAnimationUntilMs?: number;
  parryUntilMs?: number;
  parryRecoveryUntilMs?: number;
  parryCooldownUntilMs?: number;
  parryStartedFrame?: number;
  parryAnimationUntilFrame?: number;
  parryUntilFrame?: number;
  parryRecoveryUntilFrame?: number;
  parryCooldownUntilFrame?: number;
  superParryUntilMs?: number;
  superParryLockUntilMs?: number;
  superParryUntilFrame?: number;
  superParryLockUntilFrame?: number;
  superParryBonusDamage?: number;
  hitStunUntilMs?: number;
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
  sprite?: SpriteResourceMetadata;
  effect?: ResourceEffectMetadata;
};

export type ResourceAttachment = {
  id: string;
  fileName: string;
  mime: string;
  path: string;
};

export type SpriteResourceMode = "sheet" | "sequence";

export type SpriteResourceMetadata = {
  mode: SpriteResourceMode;
  columns?: number;
  rows?: number;
  frameWidth?: number;
  frameHeight?: number;
  frameCount?: number;
  fps?: number;
  loop?: boolean;
  margin?: number;
  spacing?: number;
};

export type ResourceEffectPresetId = "deathFade" | "hitFlash" | "impactPulse" | "ambientLoop";

export type ResourceEffectMetadata = {
  preset: ResourceEffectPresetId;
  durationMs?: number;
  fadeOut?: boolean;
  blink?: boolean;
  pulseScale?: number;
  tint?: string;
  loop?: boolean;
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
  verificationPlan?: VerificationPlan;
  status: TaskStatus;
  targetRefs: TargetRef[];
  parentTaskId?: TaskId;
  subtaskIds?: TaskId[];
  decomposition?: TaskDecomposition;
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
  version?: 1;
  strokes: BrushStroke[];
  annotations: BrushAnnotation[];
  selectionBox?: Rect;
  targetEntityIds: EntityId[];
  capturedSnapshotId?: SnapshotId;
  summary?: string;
  raw?: BrushRawContext;
  compiled?: BrushCompiledContext;
  visualEvidence?: BrushVisualEvidence;
};

export type BrushRawContext = {
  strokes: BrushStroke[];
  annotations: BrushAnnotation[];
  targetRefs: TargetRef[];
  selectionBox?: Rect;
  capturedSnapshotId?: SnapshotId;
};

export type BrushCompiledContext = {
  version: 1;
  targetRefs: TargetRef[];
  targetEntityIds: EntityId[];
  strokeTargets: BrushStrokeTargetContext[];
  areas: BrushAreaContext[];
  paths: BrushPathContext[];
  annotations: BrushAnnotationContext[];
  shape: BrushShapeInterpretation;
  confidence: number;
  evidence: string[];
};

export type BrushVisualEvidence = {
  version: 1;
  manifestId: string;
  coordinateSpace: "world";
  capture: BrushVisualCaptureContext;
  frames: BrushVisualFrame[];
  anchors: BrushVisualAnchor[];
  entities: BrushVisualEntity[];
  shape: BrushShapeInterpretation;
  warnings: string[];
};

export type BrushVisualCaptureContext = {
  capturedAt: string;
  snapshotRef?: SnapshotId;
  viewport?: {
    worldCenter: Vec2;
    zoom: number;
    canvasSize: Vec2;
    visibleWorldRect: Rect;
  };
};

export type BrushVisualFrame = {
  id: string;
  role: "overview" | "crop" | "tile";
  label: string;
  worldRect: Rect;
  pixelRect?: Rect;
  parentFrameId?: string;
  imageRef?: string;
  imageMime?: string;
};

export type BrushVisualAnchor = {
  id: string;
  label: string;
  kind: "start" | "end" | "center" | "corner" | "entity";
  world: Vec2;
  pixel?: Vec2;
  strokeId?: BrushStrokeId;
  entityId?: EntityId;
};

export type BrushVisualEntity = {
  id: EntityId;
  label: string;
  displayName: string;
  boundsWorld: Rect;
  boundsPixel?: Rect;
};

export type BrushShapeInterpretation = {
  kind: "empty" | "target-mark" | "area" | "path" | "closed-shape" | "mixed";
  confidence: number;
  boundsWorld?: Rect;
  startWorld?: Vec2;
  endWorld?: Vec2;
  centerWorld?: Vec2;
  approximatePolygon?: Vec2[];
  notes: string[];
};

export type BrushStrokeTargetContext = {
  strokeId: BrushStrokeId;
  targetRefs: TargetRef[];
  bounds: Rect;
  length: number;
  pointCount: number;
  confidence: number;
};

export type BrushAreaContext = {
  id: string;
  source: "selectionBox" | "target" | "stroke";
  rect: Rect;
  targetRefs: TargetRef[];
  confidence: number;
};

export type BrushPathContext = {
  id: string;
  strokeId: BrushStrokeId;
  points: Vec2[];
  start: Vec2;
  end: Vec2;
  length: number;
  targetRefs: TargetRef[];
  confidence: number;
};

export type BrushAnnotationContext = {
  annotationId: BrushAnnotationId;
  text: string;
  position: Vec2;
  targetRef?: TargetRef;
  confidence: number;
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
  | "/activeSceneId"
  | `/meta/${string}`
  | `/scenes/${string}`
  | `/scenes/${string}/settings/${string}`
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
  timeMs: number;
  type:
    | "chargeStarted"
    | "chargeReleased"
    | "attackStarted"
    | "attackTouch"
    | "attackClash"
    | "parryStarted"
    | "parrySuccess"
    | "superParryReady"
    | "dodgeStarted"
    | "hit"
    | "defeated";
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
  projectChecks?: ProjectCheck[];
  assertionFailures?: AssertionFailure[];
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

export type ProjectCheck = {
  label: string;
  target: TargetRef;
  expect: Record<string, unknown>;
};

export type VerificationTestIntent =
  | "structure"
  | "project"
  | "resource"
  | "spatial"
  | "collision"
  | "behavior"
  | "visual"
  | "combat"
  | "timing"
  | "runtime";

export type VerificationPlan = {
  version: 1;
  summary: string;
  frameChecks: FrameCheck[];
  runtimeSetupSteps: InputStep[];
  projectChecks: ProjectCheck[];
  testIntents: VerificationTestIntent[];
  notes: string[];
};

export type TaskDecomposition = {
  version: 1;
  reason: string;
  parentText: string;
  segments: string[];
  createdTaskIds: TaskId[];
};

export type AssertionFailure = {
  source: "frame" | "project";
  label: string;
  target: TargetRef;
  path: string;
  expected: unknown;
  actual: unknown;
  matcher?: string;
  frame?: number;
  snapshotRef?: SnapshotId;
  message: string;
};

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
          timeScale: 1,
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
  Object.values(project.resources).forEach((resource) => normalizeResourceDefaults(resource));
  Object.values(project.scenes).forEach((scene) => {
    normalizeSceneSettings(scene.settings);
    Object.values(scene.entities).forEach((entity) => normalizeEntityDefaults(entity));
  });
  return project;
}

export function normalizeResourceDefaults(resource: Resource): Resource {
  resource.tags ||= [];
  resource.attachments ||= [];
  if (resource.effect) normalizeResourceEffectDefaults(resource);
  if (!resource.sprite) return resource;
  if (resource.sprite.mode !== "sheet" && resource.sprite.mode !== "sequence") {
    delete resource.sprite;
    return resource;
  }
  if (!Number.isFinite(resource.sprite.fps) || (resource.sprite.fps ?? 0) <= 0) resource.sprite.fps = 8;
  if (resource.sprite.loop === undefined) resource.sprite.loop = true;
  if (resource.sprite.frameCount !== undefined) resource.sprite.frameCount = Math.max(1, Math.floor(resource.sprite.frameCount));
  if (resource.sprite.columns !== undefined) resource.sprite.columns = Math.max(1, Math.floor(resource.sprite.columns));
  if (resource.sprite.rows !== undefined) resource.sprite.rows = Math.max(1, Math.floor(resource.sprite.rows));
  if (resource.sprite.frameWidth !== undefined) resource.sprite.frameWidth = Math.max(1, Math.floor(resource.sprite.frameWidth));
  if (resource.sprite.frameHeight !== undefined) resource.sprite.frameHeight = Math.max(1, Math.floor(resource.sprite.frameHeight));
  if (resource.sprite.margin !== undefined) resource.sprite.margin = Math.max(0, Math.floor(resource.sprite.margin));
  if (resource.sprite.spacing !== undefined) resource.sprite.spacing = Math.max(0, Math.floor(resource.sprite.spacing));
  return resource;
}

function normalizeResourceEffectDefaults(resource: Resource): void {
  if (!resource.effect) return;
  if (!["deathFade", "hitFlash", "impactPulse", "ambientLoop"].includes(resource.effect.preset)) {
    delete resource.effect;
    return;
  }
  if (resource.effect.durationMs !== undefined) resource.effect.durationMs = Math.max(60, Math.floor(resource.effect.durationMs));
  if (resource.effect.pulseScale !== undefined) resource.effect.pulseScale = Math.max(0, Math.min(1, Number(resource.effect.pulseScale) || 0));
  if (resource.effect.tint && !/^#[0-9a-fA-F]{6}$/.test(resource.effect.tint)) delete resource.effect.tint;
}

export function normalizeSceneSettings(settings: SceneSettings): SceneSettings {
  const tickRate = Number.isFinite(settings.tickRate) && settings.tickRate > 0 ? settings.tickRate : 100;
  settings.tickRate = tickRate;
  settings.fixedStepMs = 1000 / tickRate;
  settings.timeScale = normalizeSceneTimeScale(settings.timeScale);
  return settings;
}

export function normalizeSceneTimeScale(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.round(Math.max(0, Math.min(4, numeric)) * 100) / 100;
}

export function normalizeEntityDefaults(entity: Entity): Entity {
  if (entity.render) normalizeRenderDefaults(entity);
  if (entity.kind !== "entity") return entity;
  if (!entity.collider) {
    entity.collider = {
      shape: "box",
      size: { x: 64, y: 64 },
      offset: { x: 0, y: 0 },
      rotation: 0,
      solid: true,
      trigger: false,
      layerMask: ["world"],
    };
  } else {
    if (!entity.collider.shape) entity.collider.shape = "box";
    if (!entity.collider.size || entity.collider.size.x <= 0 || entity.collider.size.y <= 0) {
      entity.collider.size = { x: 64, y: 64 };
    }
    if (!entity.collider.offset) entity.collider.offset = { x: 0, y: 0 };
    if (!Number.isFinite(entity.collider.rotation)) entity.collider.rotation = 0;
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

function normalizeRenderDefaults(entity: Entity): void {
  if (!entity.render) return;
  const bodySize = entity.collider?.size || { x: 64, y: 64 };
  if (!entity.render.size || entity.render.size.x <= 0 || entity.render.size.y <= 0) {
    entity.render.size = defaultRenderSize(bodySize);
  } else if (isLegacyDefaultRenderSize(entity.render.size, bodySize)) {
    entity.render.size = defaultRenderSize(bodySize);
  }
  if (!entity.render.offset) entity.render.offset = { x: 0, y: 0 };
  if (!Number.isFinite(entity.render.rotation)) entity.render.rotation = 0;
  if (!entity.render.scale) entity.render.scale = { x: 1, y: 1 };
  entity.render.slot ||= "current";
  entity.render.state ||= "current";
}

function defaultRenderSize(bodySize: Vec2): Vec2 {
  return {
    x: Math.max(12, bodySize.x),
    y: Math.max(12, bodySize.y),
  };
}

function isLegacyDefaultRenderSize(renderSize: Vec2, bodySize: Vec2): boolean {
  return Math.abs(renderSize.x - Math.max(12, bodySize.x * 0.72)) < 0.001 && Math.abs(renderSize.y - Math.max(12, bodySize.y * 0.72)) < 0.001;
}
