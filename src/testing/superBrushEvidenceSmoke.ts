import { AiTaskExecutor } from "../ai/taskExecutor";
import { createStarterProject } from "../samples/starterProject";
import { createSuperBrushStroke, createTaskFromSuperBrush, type SuperBrushDraft } from "../editor/superBrush";
import { ProjectStore } from "../project/projectStore";
import type { Entity, Project, Rect } from "../project/schema";
import type { EntityId } from "../shared/types";

const store = new ProjectStore(createStarterProject());
const scene = activeScene(store.project);
const markedArea: Rect = { x: 100, y: 96, w: 168, h: 126 };
const stroke = createSuperBrushStroke([
  { x: 104, y: 108 },
  { x: 236, y: 100 },
  { x: 264, y: 166 },
  { x: 184, y: 228 },
  { x: 112, y: 184 },
  { x: 104, y: 108 },
]);
assert(stroke.ok, stroke.ok ? "" : stroke.error);

const draft: SuperBrushDraft = {
  strokes: [stroke.value],
  annotations: [],
  selectionTargets: [{ kind: "area", sceneId: scene.id, rect: markedArea }],
  strokeTargetRefs: {
    [stroke.value.id]: [{ kind: "area", sceneId: scene.id, rect: markedArea }],
  },
  selectionBox: markedArea,
};
const marker = makeEvidenceMarker("Evidence Marker", { x: 184, y: 160 });
const task = createTaskFromSuperBrush({
  userText: "Create a terrain here.",
  draft,
  visualEvidence: {
    capturedAt: "2026-05-10T00:00:00.000Z",
    viewport: {
      worldCenter: { x: 200, y: 160 },
      zoom: 2,
      canvasSize: { x: 800, y: 600 },
    },
    entities: [marker],
    imageRefs: {
      overview: { imageRef: "data:image/jpeg;base64,b3ZlcnZpZXc=", imageMime: "image/jpeg" },
      "crop-main": { imageRef: "data:image/jpeg;base64,Y3JvcA==", imageMime: "image/jpeg" },
    },
  },
});
assert(task.ok, task.ok ? "" : task.error);

const brushContext = task.value.brushContext;
assert(brushContext, "expected task to include brush context");
assert(brushContext.compiled?.shape.kind === "closed-shape", `expected closed-shape, got ${brushContext.compiled?.shape.kind}`);
assert((brushContext.compiled.shape.approximatePolygon?.length || 0) >= 3, "expected approximate polygon points");

const evidence = brushContext.visualEvidence;
assert(evidence, "expected visual evidence manifest");
assert(evidence.capture.viewport?.visibleWorldRect.w === 400, "expected viewport world width to be derived from zoom");
assert(evidence.frames.some((frame) => frame.role === "overview" && frame.imageRef?.startsWith("data:image/jpeg")), "expected overview screenshot ref");
const crop = evidence.frames.find((frame) => frame.role === "crop");
assert(crop, "expected main crop frame");
assert(rectContains(crop.worldRect, markedArea), "expected crop world rect to contain marked area");
assert(crop.pixelRect && crop.pixelRect.w > 0 && crop.pixelRect.h > 0, "expected crop pixel rect mapping");
assert(evidence.anchors.some((anchor) => anchor.kind === "start" && anchor.pixel), "expected start anchor with pixel position");
assert(evidence.anchors.some((anchor) => anchor.kind === "end" && anchor.pixel), "expected end anchor with pixel position");
assert(evidence.anchors.some((anchor) => anchor.kind === "center"), "expected shape center anchor");
assert(evidence.entities.some((entity) => entity.label === "A" && entity.boundsPixel), "expected intersecting entity label and pixel bounds");

store.upsertTask(task.value);
const run = new AiTaskExecutor({ store }).executeNextQueuedTask();
assert(run.ok, run.ok ? "" : run.error);
assert(run.value?.status === "passed", `expected terrain brush task to pass, got ${run.value?.status}`);
assert(run.value.transaction?.diffSummary.includes("super brush shape: closed-shape"), "expected AI diff summary to record confirmed brush shape");

const terrain = Object.values(activeScene(store.project).entities).find((entity) => entity.tags.includes("terrain") && entity.tags.includes("closed-shape"));
assert(terrain, "expected closed-shape terrain entity");
assert(terrain.collider?.shape === "polygon", `expected polygon collider, got ${terrain.collider?.shape}`);
assert((terrain.collider.points?.length || 0) >= 3, "expected polygon collider points");
assert(terrain.collider.solid === true, "expected generated terrain to be solid");
assert(terrain.collider.trigger === false, "expected generated terrain not to be a trigger");

const cloudStore = new ProjectStore(createStarterProject());
const cloudScene = activeScene(cloudStore.project);
const cloudArea: Rect = { x: -240, y: -380, w: 520, h: 220 };
const cloudStroke = createSuperBrushStroke([
  { x: -210, y: -290 },
  { x: -150, y: -360 },
  { x: -48, y: -340 },
  { x: 20, y: -380 },
  { x: 132, y: -332 },
  { x: 228, y: -282 },
  { x: 180, y: -210 },
  { x: 44, y: -196 },
  { x: -108, y: -204 },
  { x: -210, y: -290 },
]);
assert(cloudStroke.ok, cloudStroke.ok ? "" : cloudStroke.error);
const cloudTask = createTaskFromSuperBrush({
  userText: "画一个这样的云 可以使用ai 生成 也可以使用算法",
  draft: {
    strokes: [cloudStroke.value],
    annotations: [],
    selectionTargets: [{ kind: "area", sceneId: cloudScene.id, rect: cloudArea }],
    strokeTargetRefs: {
      [cloudStroke.value.id]: [{ kind: "area", sceneId: cloudScene.id, rect: cloudArea }],
    },
    selectionBox: cloudArea,
  },
});
assert(cloudTask.ok, cloudTask.ok ? "" : cloudTask.error);
cloudStore.upsertTask(cloudTask.value);
const cloudRun = new AiTaskExecutor({ store: cloudStore }).executeNextQueuedTask();
assert(cloudRun.ok, cloudRun.ok ? "" : cloudRun.error);
assert(cloudRun.value?.status === "passed", `expected cloud brush task to pass, got ${cloudRun.value?.status}`);
const cloudProject = cloudStore.project;
const cloud = Object.values(activeScene(cloudProject).entities).find((entity) => entity.tags.includes("cloud") && entity.tags.includes("ai-generated"));
assert(cloud, "expected generated cloud entity");
assert(cloud.kind === "effect", `expected cloud to be an effect entity, got ${cloud.kind}`);
assert(cloud.render?.resourceId, "expected generated cloud to bind an image resource");
assert(cloud.collider?.shape === "polygon", "expected cloud to retain the brush outline as a polygon body");
const cloudResource = cloudProject.resources[cloud.render.resourceId];
assert(cloudResource, "expected generated cloud resource");
assert(cloudResource.type === "image", `expected cloud resource to be an image, got ${cloudResource.type}`);
assert(cloudResource.attachments[0]?.path.startsWith("data:image/svg+xml"), "expected procedural cloud SVG data URL");
assert(
  cloudProject.tasks[cloudTask.value.id]?.verificationPlan?.projectChecks.some((check) => Object.prototype.hasOwnProperty.call(check.expect, "render.resourceId")),
  "expected cloud verification plan to check render.resourceId",
);

console.log(JSON.stringify({ status: "passed" }, null, 2));

function activeScene(project: Project) {
  const scene = project.scenes[project.activeSceneId];
  if (!scene) throw new Error("active scene missing");
  return scene;
}

function makeEvidenceMarker(displayName: string, position: { x: number; y: number }): Entity {
  return {
    id: "ent-evidence-marker" as EntityId,
    internalName: "evidence_marker",
    displayName,
    kind: "entity",
    persistent: true,
    transform: {
      position,
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    render: {
      visible: true,
      color: "#ffffff",
      opacity: 1,
      layerId: "world",
      size: { x: 32, y: 32 },
      offset: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    resources: [],
    tags: [],
  };
}

function rectContains(outer: Rect, inner: Rect): boolean {
  return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
