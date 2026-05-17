import { createSuperBrushAnnotation, createSuperBrushStroke, createTaskFromSuperBrush, mergeSuperBrushTargets, type SuperBrushDraft } from "../editor/superBrush";
import {
  CANVAS_GUIDE_PANEL_ID,
  CANVAS_GUIDE_PANEL_LABEL,
  canvasGuidePanelAnnotationInput,
  canvasGuidePanelTargetsForStroke,
} from "../editor/canvasGuidePanel";
import type { SceneId } from "../shared/types";

const sceneId = "scene-guide-smoke" as SceneId;
const panelRect = { left: 100, top: 80, right: 340, bottom: 220, width: 240, height: 140 };
const screenToWorld = (point: { x: number; y: number }) => ({ x: point.x - 40, y: point.y + 20 });

const missTargets = canvasGuidePanelTargetsForStroke({
  sceneId,
  panelRect,
  clientPoints: [{ x: 40, y: 40 }],
  screenToWorld,
});
assert(missTargets.length === 0, "expected off-panel brush to avoid guide panel targets");

const hitTargets = canvasGuidePanelTargetsForStroke({
  sceneId,
  panelRect,
  clientPoints: [
    { x: 120, y: 100 },
    { x: 210, y: 170 },
  ],
  screenToWorld,
});
const guideTarget = hitTargets.find((target) => target.kind === "editorUi");
const areaTarget = hitTargets.find((target) => target.kind === "area");
assert(guideTarget && guideTarget.kind === "editorUi" && guideTarget.uiId === CANVAS_GUIDE_PANEL_ID, "expected editor UI target for guide panel hit");
assert(guideTarget.label === CANVAS_GUIDE_PANEL_LABEL, "expected editor UI target label");
assert(areaTarget && areaTarget.kind === "area" && areaTarget.rect.x === 60, `expected world rect x 60, got ${areaTarget?.kind === "area" ? areaTarget.rect.x : "none"}`);
assert(areaTarget.rect.w === 240, `expected world rect width 240, got ${areaTarget.rect.w}`);

const annotationInput = canvasGuidePanelAnnotationInput({ panelRect, screenToWorld });
assert(annotationInput.text === CANVAS_GUIDE_PANEL_LABEL, "expected annotation text to name guide panel");
assert(annotationInput.position.x === 180 && annotationInput.position.y === 170, "expected annotation at panel center in world space");

const stroke = createSuperBrushStroke([
  { x: 60, y: 100 },
  { x: 300, y: 240 },
]);
assert(stroke.ok, `expected guide stroke to be valid: ${stroke.ok ? "" : stroke.error}`);
const annotation = createSuperBrushAnnotation({ ...annotationInput, targetRef: guideTarget });
assert(annotation.ok, `expected guide annotation to be valid: ${annotation.ok ? "" : annotation.error}`);
const draft: SuperBrushDraft = {
  strokes: [stroke.value],
  annotations: [annotation.value],
  selectionTargets: mergeSuperBrushTargets(hitTargets),
  strokeTargetRefs: {
    [stroke.value.id]: hitTargets,
  },
};
const task = createTaskFromSuperBrush({ userText: "把这个 UI 指导面板改成更适合超级画笔更新的面板。", draft });
assert(task.ok, `expected guide panel super brush task to be valid: ${task.ok ? "" : task.error}`);
assert(task.value.targetRefs.some((target) => target.kind === "editorUi"), "expected task target refs to keep editor UI target");
assert(task.value.brushContext?.raw?.targetRefs.some((target) => target.kind === "editorUi"), "expected raw brush context to keep editor UI target");
assert(task.value.brushContext?.compiled?.targetRefs.some((target) => target.kind === "editorUi"), "expected compiled brush context to keep editor UI target");
assert(task.value.brushContext?.annotations[0]?.text === CANVAS_GUIDE_PANEL_LABEL, "expected brush annotation to name guide panel");

console.log(
  JSON.stringify(
    {
      status: "passed",
      targetKinds: hitTargets.map((target) => target.kind),
      guideTarget: guideTarget.uiId,
      taskId: task.value.id,
      brushSummary: task.value.brushContext?.summary,
    },
    null,
    2,
  ),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
