import "./styles.css";
import { AutonomyLoop } from "../ai/autonomyLoop";
import { AiTaskExecutor } from "../ai/taskExecutor";
import { createTask } from "../project/tasks";
import { normalizeProjectDefaults, type BrushContext, type Entity, type Project, type ProjectPatch, type TargetRef, type Task } from "../project/schema";
import { consumeEditorHandoff } from "../project/editorHandoff";
import { ProjectStore } from "../project/projectStore";
import { createSuperBrushStroke, type SuperBrushDraft } from "../editor/superBrush";
import { RuntimeWorld } from "../runtime/world";
import { cloneJson, type EntityId, type Transform2D, type Vec2 } from "../shared/types";
import { runAutonomousTestSuite, type AutonomousTestSuiteReport } from "../testing/autonomousTesting";
import { planScriptedReaction, runScriptedReactionPlan } from "../testing/timingSweep";
import {
  applyCanvasDragState,
  createCanvasDragState,
  cursorForTransformHandle,
  dragNotice,
  type CanvasDragState,
} from "./canvasTransform";
import { createStarterProject, repairKnownStarterLabels } from "./starterProject";
import { V2Renderer, type TransformHandle } from "./renderer";
import { mountEditorShell } from "./editorShell";
import { handleEditorKeyDown, handleEditorKeyUp } from "./keyboardController";
import { PanelLayoutController, type PanelId } from "./panelLayout";
import { renderInspectorHtml, renderResourcesHtml } from "./panelViews";
import { bindSceneTreeInteractions, renderSceneTreeHtml } from "./sceneTreeController";
import { renderTaskPanelHtml } from "./taskPanelViews";
import { planPersistentFolderMoveTransaction } from "./folderMoveTransaction";
import { createTaskWorkflowController } from "./taskWorkflowController";
import {
  aiEvidenceText,
  autonomousCaseLabel,
  formatKb,
  formatOffset,
  panelLabel,
  toolLabel,
} from "./viewText";
import {
  autonomousRoundSummaryFromCycle,
  autonomousSuiteSummary,
  latestAutonomyRoundSummaryFromProject,
  maintenanceSummary,
  manualMaintenanceOptions,
  reactionSweepExpectations,
  scriptedRunSummary,
  type AutonomousGeneratedTask,
  type AutonomousRoundSummary,
} from "./summaryModels";
import { buildProjectForSave, loadProjectForEditor, saveProjectFromEditor, saveProjectLocallyFromEditor } from "./persistenceController";

type ToolId = "select" | "superBrush" | "shape" | "assist";

const rootMaybe = document.querySelector<HTMLElement>("#v2-root");
if (!rootMaybe) throw new Error("missing #v2-root");
const root = rootMaybe;

const handoff = consumeEditorHandoff();
const initialProject = await loadInitialProject(handoff?.project);
const project = normalizeProjectDefaults(repairKnownStarterLabels(initialProject.project));
const store = new ProjectStore(project);
const aiExecutor = new AiTaskExecutor({ store });
const autonomyLoop = new AutonomyLoop({ store, executor: aiExecutor });
let scene = project.scenes[project.activeSceneId];
let world = new RuntimeWorld({ scene });
if (handoff?.snapshot) world.restoreSnapshot(handoff.snapshot);
const renderer = new V2Renderer();

let selectedId = Object.keys(scene.entities)[0] || "";
let activeTool: ToolId = "select";
let previewTaskId = "";
let notice = handoff
  ? `已从游戏暂停帧 ${handoff.snapshot.frame} 进入编辑器。按 Z 可继续运行。`
  : initialProject.notice;
let lastTime = performance.now();
let raf = 0;
let canvasDirty = true;
let saveStatus = initialProject.loadedFromDisk ? "已从磁盘载入，自动保存就绪" : "自动保存就绪";
let autoSaveTimer: number | undefined;
let autoSaveDirty = false;
let autoSaveInFlight = false;
let autoSaveAgain = false;
let autoSaveActivePromise: Promise<void> | undefined;

let drawingBrush = false;
let currentStrokePoints: Vec2[] = [];
let pendingBrush: SuperBrushDraft | undefined;
let canvasDrag: CanvasDragState | undefined;
let canvasCameraDrag: { pointerId: number; clientX: number; clientY: number; moved: boolean } | undefined;
let windowMenuOpen = false;
const aiTraceByTask: Record<string, string> = {};
let lastSweepSummary = "";
let lastScriptedRunSummary = "";
let lastAutonomousSuiteSummary = "";
let lastMaintenanceSummary = "";
let autonomousRoundCounter = 0;
let lastAutonomousRoundSummary: AutonomousRoundSummary | undefined;
const panelLayout = new PanelLayoutController({
  root,
  setNotice(value) {
    notice = value;
  },
  renderAll,
});

mountEditorShell(root);

const stageHost = query<HTMLElement>('[data-role="stage"]');
const taskInput = query<HTMLTextAreaElement>('[data-role="task-input"]');
const taskWorkflow = createTaskWorkflowController({
  store,
  aiExecutor,
  currentTargets,
  getPendingBrush: () => pendingBrush,
  setPendingBrush: (draft) => {
    pendingBrush = draft;
  },
  clearTaskInput: () => {
    taskInput.value = "";
  },
  focusTaskInput: () => taskInput.focus(),
  setPreviewTaskId: (taskId) => {
    previewTaskId = taskId;
  },
  setAiTrace: (taskId, traceSummary) => {
    aiTraceByTask[taskId] = traceSummary;
  },
  syncWorldFromStore,
  onProjectChanged: markProjectDirty,
  setNotice: (value) => {
    notice = value;
  },
  renderAll,
});
panelLayout.applyPanelSizes();
await renderer.init({ host: stageHost });

bindUi();
renderUi();
loop(lastTime);
window.setInterval(runScheduledProjectMaintenance, 10 * 60 * 1000);

async function loadInitialProject(handoffProject?: Project): Promise<{ project: Project; notice: string; loadedFromDisk: boolean }> {
  if (handoffProject) {
    return {
      project: handoffProject,
      notice: "已接收游戏暂停现场，自动保存就绪。",
      loadedFromDisk: false,
    };
  }

  const result = await loadProjectForEditor();
  if (result.project) {
    return {
      project: result.project,
      notice: `${result.notice} 自动保存已开启。`,
      loadedFromDisk: true,
    };
  }

  return {
    project: createStarterProject(),
    notice: "未找到磁盘项目，已创建初始项目。自动保存已开启。",
    loadedFromDisk: false,
  };
}

function bindUi(): void {
  root.querySelector('[data-action="toggle-run"]')?.addEventListener("click", toggleRun);
  root.querySelector('[data-action="step"]')?.addEventListener("click", () => {
    world.runFixedFrame();
    renderAll();
  });
  root.querySelector('[data-action="capture"]')?.addEventListener("click", () => {
    const snapshot = world.freezeForInspection();
    store.recordRuntimeSnapshot(snapshot);
    markProjectDirty("已捕捉冻结帧");
    notice = `已捕捉冻结帧 ${snapshot.frame}`;
    renderAll();
  });
  root.querySelector('[data-action="reload-project"]')?.addEventListener("click", refreshProjectFromDisk);
  root.querySelector('[data-action="toggle-window-menu"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    windowMenuOpen = !windowMenuOpen;
    renderAll();
  });
  root.querySelector('[data-action="queue-task"]')?.addEventListener("click", () => taskWorkflow.queueTaskFromText(taskInput.value));
  root.querySelector('[data-action="run-ai-task"]')?.addEventListener("click", taskWorkflow.runNextAiTask);
  root.querySelectorAll('[data-action="run-autonomous-round"]').forEach((button) => {
    button.addEventListener("click", runAutonomousRound);
  });
  root.querySelector('[data-action="run-autonomous-test"]')?.addEventListener("click", runAutonomousTestDemo);
  root.querySelector('[data-action="preview-cleanup"]')?.addEventListener("click", previewProjectMaintenance);
  root.querySelector('[data-action="run-cleanup"]')?.addEventListener("click", runManualProjectMaintenance);
  root.querySelector('[data-action="run-sweep"]')?.addEventListener("click", runTimingSweepDemo);
  root.querySelector('[data-action="run-scripted-test"]')?.addEventListener("click", runScriptedTimelineDemo);
  root.querySelector('[data-action="clear-brush"]')?.addEventListener("click", () => {
    pendingBrush = undefined;
    currentStrokePoints = [];
    notice = "画笔上下文已清除。";
    renderAll();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTool = (button.dataset.tool || "select") as ToolId;
      notice = activeTool === "superBrush" ? "超级画笔会在松开后要求输入任务。" : "已切换工具。";
      renderAll();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.dataset.openPanel as PanelId | undefined;
      if (!panel) return;
      if (panelLayout.panelState[panel] !== "open") panelLayout.panelState[panel] = "open";
      panelLayout.bringPanelToFront(panel);
      windowMenuOpen = false;
      notice = `${panelLabel(panel)}已${panelLayout.panelState[panel] === "open" ? "打开" : "关闭"}。`;
      renderAll();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-panel-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.dataset.panel as PanelId | undefined;
      if (!panel) return;
      panelLayout.panelState[panel] = button.dataset.panelAction === "close" ? "closed" : "minimized";
      notice = `${panelLabel(panel)}已${panelLayout.panelState[panel] === "closed" ? "关闭" : "最小化"}，可从左侧贴边按钮恢复。`;
      renderAll();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.dataset.openPanel as PanelId | undefined;
      if (!panel) return;
      if (panelLayout.panelState[panel] === "open") panelLayout.bringPanelToFront(panel);
      notice = `${panelLabel(panel)}已${panelLayout.panelState[panel] === "open" ? "打开" : "关闭"}。`;
      renderAll();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-panel-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.dataset.panel as PanelId | undefined;
      if (!panel) return;
      notice = `${panelLabel(panel)}已${panelLayout.panelState[panel] === "closed" ? "关闭" : "最小化"}，可从窗口菜单恢复。`;
      renderAll();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-window-drag]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => panelLayout.startWindowDrag(event));
  });
  root.querySelectorAll<HTMLElement>(".v2-window").forEach((panel) => {
    panel.addEventListener("pointerdown", () => {
      const panelId = panel.dataset.panel as PanelId | undefined;
      if (!panelId) return;
      panelLayout.bringPanelToFront(panelId);
      if (!panelLayout.isDraggingWindow()) panelLayout.applyPanelSizes();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-resize]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => panelLayout.startPanelResize(event));
  });

  const canvas = renderer.canvas();
  canvas.addEventListener("pointerdown", onCanvasPointerDown);
  canvas.addEventListener("pointermove", onCanvasPointerMove);
  canvas.addEventListener("pointerup", onCanvasPointerUp);
  canvas.addEventListener("pointerleave", onCanvasPointerUp);
  canvas.addEventListener("pointercancel", cancelCanvasPointerInteraction);
  canvas.addEventListener("lostpointercapture", cancelCanvasPointerInteraction);
  canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
  canvas.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("pointermove", (event) => panelLayout.onPanelResizeMove(event));
  window.addEventListener("pointerup", (event) => panelLayout.stopPanelResize(event));
  window.addEventListener("pointermove", (event) => panelLayout.onWindowDragMove(event));
  window.addEventListener("pointerup", (event) => panelLayout.stopWindowDrag(event));
  document.addEventListener("pointerdown", (event) => {
    if (!windowMenuOpen) return;
    if ((event.target as HTMLElement).closest(".v2-window-manager")) return;
    windowMenuOpen = false;
    renderAll();
  });
}

function startCanvasTransform(event: PointerEvent, entityId: string, handle: TransformHandle, point: Vec2): void {
  const entity = world.allEntities().find((item) => item.id === entityId);
  if (!entity) return;
  renderer.canvas().setPointerCapture(event.pointerId);
  canvasDrag = createCanvasDragState(event.pointerId, entity, handle, point);
  notice = dragNotice(canvasDrag.kind, "start");
}

function updateCanvasTransform(point: Vec2): void {
  if (!canvasDrag) return;
  const entity = world.allEntities().find((item) => item.id === canvasDrag?.entityId);
  if (!entity) return;
  applyCanvasDragState(entity, canvasDrag, point);
}

function selectedEntity() {
  return editableEntity(selectedId);
}

function editableEntities(): Entity[] {
  return [...world.entities.values()];
}

function editableEntity(entityId: string): Entity | undefined {
  return world.entities.get(entityId);
}

function commitCanvasTransform(drag: CanvasDragState): string | undefined {
  const entity = world.allEntities().find((item) => item.id === drag.entityId);
  if (!entity) {
    syncWorldFromStore();
    return "对象状态已刷新，未提交本次变换。";
  }
  if (!entity.persistent) return undefined;
  const finalTransform = cloneJson(entity.transform);
  if (sameTransform(drag.originalTransform, finalTransform)) return undefined;

  const path = `/scenes/${scene.id}/entities/${entity.id}/transform` as ProjectPatch["path"];
  const transaction = store.createTransaction({
    actor: "user",
    patches: [{ op: "set", path, value: finalTransform }],
    inversePatches: [{ op: "set", path, value: drag.originalTransform }],
    diffSummary: `调整 ${entity.displayName} 的${transformActionLabel(drag.kind)}。`,
  });
  const result = store.apply(transaction);
  if (!result.ok) {
    syncWorldFromStore();
    return `变换未提交：${result.error}`;
  }
  syncWorldFromStore();
  markProjectDirty(`已调整 ${entity.displayName}`);
  return `已提交变换事务：${transformActionLabel(drag.kind)}。`;
}

function sameTransform(left: Transform2D, right: Transform2D): boolean {
  return (
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.rotation === right.rotation &&
    left.scale.x === right.scale.x &&
    left.scale.y === right.scale.y
  );
}

function transformActionLabel(kind: CanvasDragState["kind"]): string {
  return kind === "move" ? "位置" : kind === "scale" ? "大小" : "旋转";
}

function onCanvasWheel(event: WheelEvent): void {
  event.preventDefault();
  if (!event.deltaY) return;
  const viewport = renderer.zoomAt(event.clientX, event.clientY, normalizedWheelDeltaY(event));
  notice = `画布缩放 ${Math.round(viewport.zoom * 100)}%`;
  renderAll();
}

function startCanvasCameraDrag(event: PointerEvent): void {
  event.preventDefault();
  renderer.canvas().setPointerCapture(event.pointerId);
  canvasCameraDrag = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    moved: false,
  };
  notice = "正在移动画布视角。";
  renderAll();
}

function updateCanvasCameraDrag(event: PointerEvent): boolean {
  if (!canvasCameraDrag || canvasCameraDrag.pointerId !== event.pointerId) return false;
  event.preventDefault();
  const deltaX = event.clientX - canvasCameraDrag.clientX;
  const deltaY = event.clientY - canvasCameraDrag.clientY;
  if (deltaX || deltaY) {
    renderer.panBy(deltaX, deltaY);
    canvasCameraDrag = {
      ...canvasCameraDrag,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: true,
    };
    renderCanvasOnly();
  }
  return true;
}

function finishCanvasCameraDrag(event: PointerEvent): boolean {
  if (!canvasCameraDrag || canvasCameraDrag.pointerId !== event.pointerId) return false;
  event.preventDefault();
  const finishedDrag = canvasCameraDrag;
  canvasCameraDrag = undefined;
  releaseCanvasPointer(event.pointerId);
  const viewport = renderer.viewportState();
  notice = finishedDrag.moved
    ? `画布视角 ${Math.round(viewport.x)}, ${Math.round(viewport.y)} / ${Math.round(viewport.zoom * 100)}%`
    : `画布缩放 ${Math.round(viewport.zoom * 100)}%`;
  renderAll();
  return true;
}

function cancelCanvasPointerInteraction(event: PointerEvent): void {
  if (canvasCameraDrag?.pointerId === event.pointerId) {
    canvasCameraDrag = undefined;
    renderAll();
    return;
  }
  if (canvasDrag?.pointerId === event.pointerId) {
    canvasDrag = undefined;
    syncWorldFromStore();
    renderAll();
    return;
  }
  if (drawingBrush) {
    drawingBrush = false;
    currentStrokePoints = [];
    renderAll();
  }
}

function releaseCanvasPointer(pointerId: number): void {
  const canvas = renderer.canvas();
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
}

function normalizedWheelDeltaY(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(window.innerHeight, 1);
  return event.deltaY;
}

function onCanvasPointerDown(event: PointerEvent): void {
  if (event.button === 1) {
    startCanvasCameraDrag(event);
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  if (activeTool === "select" && world.mode === "editorFrozen") {
    const selected = selectedEntity();
    const handle = renderer.pickTransformHandle(selected, point);
    if (selected && handle) {
      startCanvasTransform(event, selected.id, handle, point);
      renderAll();
      return;
    }
  }
  if (activeTool === "superBrush") {
    const snapshot = world.freezeForInspection();
    store.recordRuntimeSnapshot(snapshot);
    markProjectDirty("已捕捉画笔上下文");
    drawingBrush = true;
    currentStrokePoints = [point];
    pendingBrush = {
      strokes: [],
      annotations: [],
      selectionTargets: currentTargets(),
      capturedSnapshotId: snapshot.id,
    };
    renderer.canvas().setPointerCapture(event.pointerId);
    notice = "正在记录超级画笔。松开后输入任务描述。";
    renderAll();
    return;
  }

  const picked = renderer.pickEntity(world, point, selectedId);
  if (picked) {
    selectedId = picked.id;
    notice = `已选中：${picked.displayName}`;
    renderAll();
  }
}

function onCanvasPointerMove(event: PointerEvent): void {
  if (updateCanvasCameraDrag(event)) return;
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  if (canvasDrag && canvasDrag.pointerId === event.pointerId) {
    event.preventDefault();
    updateCanvasTransform(point);
    renderCanvasOnly();
    return;
  }
  updateCanvasCursor(point);
  if (!drawingBrush) return;
  const last = currentStrokePoints[currentStrokePoints.length - 1];
  if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 4) {
    currentStrokePoints.push(point);
    renderCanvasOnly();
  }
}

function onCanvasPointerUp(event: PointerEvent): void {
  if (finishCanvasCameraDrag(event)) return;
  if (canvasDrag && canvasDrag.pointerId === event.pointerId) {
    const finishedDrag = canvasDrag;
    canvasDrag = undefined;
    releaseCanvasPointer(event.pointerId);
    notice = commitCanvasTransform(finishedDrag) || dragNotice(finishedDrag.kind, "finish");
    renderAll();
    return;
  }
  if (!drawingBrush) return;
  drawingBrush = false;
  releaseCanvasPointer(event.pointerId);
  const createdStroke = createSuperBrushStroke(currentStrokePoints);
  if (createdStroke.ok) {
    pendingBrush = {
      strokes: [...(pendingBrush?.strokes || []), createdStroke.value],
      annotations: pendingBrush?.annotations || [],
      selectionTargets: pendingBrush?.selectionTargets || currentTargets(),
      capturedSnapshotId: pendingBrush?.capturedSnapshotId,
    };
    notice = "超级画笔已记录，请输入任务描述后排队。";
    taskInput.focus();
  }
  currentStrokePoints = [];
  renderAll();
}

function onKeyDown(event: KeyboardEvent): void {
  handleEditorKeyDown(event, {
    isTypingTarget,
    onToggleRun: toggleRun,
    setInput: (key, pressed) => world.setInput(key, pressed),
  });
}

function onKeyUp(event: KeyboardEvent): void {
  handleEditorKeyUp(event, {
    isTypingTarget,
    onToggleRun: toggleRun,
    setInput: (key, pressed) => world.setInput(key, pressed),
  });
}

function toggleRun(): void {
  const snapshot = world.toggleEditorFreeze();
  if (world.mode === "game") windowMenuOpen = false;
  notice =
    world.mode === "game"
      ? "游戏运行中。同一画布继续计时，按 Z 原地冻结。"
      : `编辑冻结，同一运行状态已暂停。${snapshot ? `捕捉帧 ${snapshot.frame}` : ""}`;
  renderAll();
}

async function saveCurrentProject(): Promise<void> {
  try {
    const projectForSave = buildProjectForSave({
      project: store.exportProject(),
      scene,
      entities: world.entities.values(),
    });
    const result = await saveProjectFromEditor(projectForSave);
    notice = result.notice;
  } catch (error) {
    notice = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  }
  renderAll();
}

async function loadSavedProject(): Promise<void> {
  try {
    const result = await loadProjectForEditor();
    if (!result.project) {
      notice = result.notice;
      renderAll();
      return;
    }
    store.replace(result.project);
    rebuildWorldFromStore();
    selectedId = Object.keys(scene.entities)[0] || "";
    previewTaskId = "";
    resetTaskUiEvidence();
    drawingBrush = false;
    pendingBrush = undefined;
    currentStrokePoints = [];
    canvasDrag = undefined;
    notice = result.notice;
  } catch (error) {
    notice = `加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
  renderAll();
}

function buildCurrentProjectForSave(): Project {
  return buildProjectForSave({
    project: store.exportProject(),
    scene,
    entities: world.entities.values(),
  });
}

function markProjectDirty(reason: string): void {
  autoSaveDirty = true;
  saveStatus = `${reason}，等待自动保存`;
  scheduleAutoSave();
}

function scheduleAutoSave(delayMs = 700): void {
  if (autoSaveTimer !== undefined) window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = undefined;
    void flushAutoSaveNow();
  }, delayMs);
}

async function flushAutoSaveNow(): Promise<boolean> {
  if (!autoSaveDirty && !autoSaveAgain) return true;
  if (drawingBrush || canvasDrag) {
    scheduleAutoSave(500);
    return false;
  }
  if (autoSaveInFlight) {
    autoSaveAgain = true;
    await autoSaveActivePromise;
    if (autoSaveDirty || autoSaveAgain) return flushAutoSaveNow();
    return true;
  }

  if (autoSaveTimer !== undefined) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = undefined;
  }

  autoSaveActivePromise = (async () => {
    autoSaveInFlight = true;
    autoSaveDirty = false;
    autoSaveAgain = false;
    saveStatus = "正在自动保存";
    renderUi();
    try {
      const result = await saveProjectFromEditor(buildCurrentProjectForSave());
      saveStatus = result.notice;
    } catch (error) {
      autoSaveDirty = true;
      saveStatus = `自动保存失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      autoSaveInFlight = false;
      autoSaveActivePromise = undefined;
      if (autoSaveAgain || autoSaveDirty) scheduleAutoSave(900);
      renderUi();
    }
  })();
  await autoSaveActivePromise;
  return !autoSaveDirty;
}

async function refreshProjectFromDisk(): Promise<void> {
  const flushed = await flushAutoSaveNow();
  if (!flushed) {
    notice = "请先结束当前拖动或画笔操作，然后再从磁盘刷新。";
    saveStatus = "自动保存等待当前操作结束";
    renderAll();
    return;
  }
  try {
    const result = await loadProjectForEditor();
    if (!result.project) {
      notice = result.notice;
      saveStatus = "磁盘没有可载入项目";
      renderAll();
      return;
    }
    store.replace(normalizeProjectDefaults(repairKnownStarterLabels(result.project)));
    rebuildWorldFromStore();
    selectedId = Object.keys(scene.entities)[0] || "";
    previewTaskId = "";
    resetTaskUiEvidence();
    drawingBrush = false;
    pendingBrush = undefined;
    currentStrokePoints = [];
    canvasDrag = undefined;
    autoSaveDirty = false;
    autoSaveAgain = false;
    saveStatus = "已从磁盘刷新，自动保存就绪";
    notice = `已从磁盘刷新。${result.notice}`;
  } catch (error) {
    notice = `刷新失败：${error instanceof Error ? error.message : String(error)}`;
  }
  renderAll();
}

function saveDirtyProjectLocallyNow(): void {
  if (!autoSaveDirty && !autoSaveAgain) return;
  try {
    const result = saveProjectLocallyFromEditor(buildCurrentProjectForSave());
    saveStatus = result.notice;
    autoSaveDirty = false;
    autoSaveAgain = false;
  } catch (error) {
    saveStatus = `本地暂存失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function resetTaskUiEvidence(): void {
  Object.keys(aiTraceByTask).forEach((taskId) => {
    delete aiTraceByTask[taskId];
  });
  lastSweepSummary = "";
  lastScriptedRunSummary = "";
  lastAutonomousSuiteSummary = "";
  lastMaintenanceSummary = "";
  lastAutonomousRoundSummary = undefined;
  autonomousRoundCounter = 0;
}

function runTimingSweepDemo(): void {
  const entities = world.allEntities();
  const player = entities.find((entity) => entity.behavior?.builtin === "playerPlatformer");
  const enemy = entities.find((entity) => entity.behavior?.builtin === "enemyPatrol");
  if (!player || !enemy) {
    notice = "时间轴扫描需要玩家和敌人对象。";
    renderAll();
    return;
  }
  const attackStartTick = legacyFrameToTick(4);
  const plannedImpact = planScriptedReaction(scene, {
    attackerId: enemy.id,
    defenderId: player.id,
    attackKey: "attack",
    defenseKey: "parry",
    attackStartFrame: attackStartTick,
    defenseOffset: 0,
    defenderTarget: { kind: "entity", entityId: player.id },
    successChecks: [
      {
        label: "计算震刀命中 tick",
        target: { kind: "runtime", sceneId: scene.id },
        expect: { combatEvent: { type: "parrySuccess", attackerId: enemy.id, defenderId: player.id } },
      },
    ],
  });
  if (!plannedImpact.ok) {
    notice = `时间轴扫描规划失败：${plannedImpact.error}`;
    renderAll();
    return;
  }
  const sweep = aiExecutor.runReactionWindowSweep({
    attackerId: enemy.id,
    defenderId: player.id,
    attackKey: "attack",
    defenseKey: "parry",
    attackStartFrame: attackStartTick,
    expectedImpactFrame: plannedImpact.value.impactFrame - 1,
    defenseOffsets: [-10, -8, -6, -4, -2, 0, 2, 4, 6],
    defenderTarget: { kind: "entity", entityId: player.id },
    successChecks: [
      {
        label: "判定帧出现震刀成功事件",
        target: { kind: "runtime", sceneId: scene.id },
        expect: { combatEvent: { type: "parrySuccess", attackerId: enemy.id, defenderId: player.id } },
      },
    ],
  });
  if (!sweep.ok) {
    notice = `时间轴扫描失败：${sweep.error}`;
    renderAll();
    return;
  }
  const expectedStatuses = reactionSweepExpectations();
  const mismatchedCount = sweep.value.cases.filter((item) => item.status !== expectedStatuses.get(item.defenseOffset)).length;
  const acceptedOffsets = sweep.value.cases
    .filter((item) => item.status === "passed")
    .map((item) => formatOffset(item.defenseOffset))
    .join(" / ");
  lastSweepSummary = sweep.value.cases
    .map((item) => `${item.defenseOffset}\t${item.status}\t${expectedStatuses.get(item.defenseOffset) || "unknown"}\t${item.label}`)
    .join("\n");
  notice =
    mismatchedCount > 0
      ? `时间轴扫描发现 ${mismatchedCount} 个异常偏移，请检查震刀窗口。`
      : `时间轴扫描正常：震刀窗口 ${acceptedOffsets || "无"}，窗口外输入已正确排除。`;
  renderAll();
}

function runScriptedTimelineDemo(): void {
  const frozenSnapshot = world.freezeForInspection();
  const entities = world.allEntities();
  const player = entities.find((entity) => entity.behavior?.builtin === "playerPlatformer");
  const enemy = entities.find((entity) => entity.behavior?.builtin === "enemyPatrol");
  if (!player || !enemy) {
    notice = "脚本测试需要玩家和敌人对象。";
    renderAll();
    return;
  }

  const result = runScriptedReactionPlan({
    scene,
    traceLimit: 14,
    config: {
      attackerId: enemy.id,
      defenderId: player.id,
      attackKey: "attack",
      defenseKey: "parry",
      attackStartFrame: frozenSnapshot.frame + legacyFrameToTick(4),
      defenseOffset: 0,
      testTimeScale: "auto",
      initialSnapshot: frozenSnapshot,
      defenderTarget: { kind: "entity", entityId: player.id },
      successChecks: [
        {
          label: "脚本预输入触发震刀成功事件",
          target: { kind: "runtime", sceneId: scene.id },
          expect: { combatEvent: { type: "parrySuccess", attackerId: enemy.id, defenderId: player.id } },
        },
      ],
    },
  });
  if (!result.ok) {
    notice = `脚本测试规划失败：${result.error}`;
    renderAll();
    return;
  }

  lastScriptedRunSummary = JSON.stringify(scriptedRunSummary(result.value));
  notice =
    result.value.status === "passed"
      ? `脚本测试通过：AI 计算命中 tick ${result.value.plan.impactFrame}，在 tick ${result.value.plan.defenseInputFrame} 预输入震刀。`
      : `脚本测试未通过：AI 计算命中 tick ${result.value.plan.impactFrame}，请查看任务面板里的脚本摘要。`;
  renderAll();
}

function runAutonomousTestDemo(): void {
  const frozenSnapshot = world.freezeForInspection();
  store.recordRuntimeSnapshot(frozenSnapshot);
  const report = runAutonomousTestSuite({
    scene,
    initialSnapshot: frozenSnapshot,
    traceLimit: 120,
  });

  recordAutonomousSuite(report);
  markProjectDirty("自测记录已更新");

  lastAutonomousRoundSummary = undefined;
  lastAutonomousSuiteSummary = JSON.stringify(autonomousSuiteSummary(report));
  notice =
    report.status === "passed"
      ? `AI自测通过：${report.cases.length} 个用例，已从冻结现场收集日志。`
      : `AI自测发现 ${report.cases.filter((testCase) => testCase.status === "failed").length} 个失败，已生成测试失败任务。`;
  renderAll();
}

function runAutonomousRound(): void {
  const autonomySnapshot = world.freezeForInspection();
  const autonomyOutcome = autonomyLoop.runOnce({
    initialSnapshot: autonomySnapshot,
    traceLimit: 140,
  });
  if (autonomyOutcome.ok === false) {
    notice = `AI自治失败：${autonomyOutcome.error}`;
    renderAll();
    return;
  }
  const autonomyValue = autonomyOutcome.value;
  syncWorldFromStore();
  scene = store.project.scenes[store.project.activeSceneId];

  const autonomySuite = autonomousSuiteSummary(autonomyValue.suite);
  if (autonomyValue.executorResult?.traceSummary && autonomyValue.executorResult.taskId) {
    aiTraceByTask[autonomyValue.executorResult.taskId] = autonomyValue.executorResult.traceSummary;
  }
  for (const task of autonomyValue.createdFailureTasks) {
    aiTraceByTask[task.id] = autonomyValue.run.traceSummary;
  }
  lastAutonomousSuiteSummary = JSON.stringify(autonomySuite);
  lastAutonomousRoundSummary = autonomousRoundSummaryFromCycle({
    round: ++autonomousRoundCounter,
    cycle: autonomyValue,
    translateEvidence: aiEvidenceText,
  });
  markProjectDirty("自治轮次已更新");
  notice = `AI自治第 ${autonomousRoundCounter} 轮完成：${autonomyValue.run.decisionSummary}`;
  renderAll();
}

function recordAutonomousSuite(report: AutonomousTestSuiteReport): AutonomousGeneratedTask[] {
  const generatedTasks: AutonomousGeneratedTask[] = [];
  for (const testCase of report.cases) {
    if (testCase.record) store.recordTestResult(testCase.record, undefined, undefined, testCase.snapshots);
    if (testCase.status !== "failed") continue;
    const label = autonomousCaseLabel(testCase.label);
    const taskResult = createTask({
      source: "testFailure",
      title: `AI自测失败：${label}`,
      userText: [
        `AI 自测失败：${label}。`,
        testCase.failureSnapshotRef ? `失败快照：${testCase.failureSnapshotRef}。` : "",
        testCase.aiNotes.map(aiEvidenceText).join(" "),
      ]
        .filter(Boolean)
        .join(" "),
      targetRefs: [{ kind: "scene", sceneId: scene.id }],
    });
    if (!taskResult.ok) continue;
    const failureTask: Task = {
      ...taskResult.value,
      snapshotRef: testCase.failureSnapshotRef,
      testRecordRefs: testCase.record ? [testCase.record.id] : [],
    };
    store.upsertTask(failureTask);
    aiTraceByTask[failureTask.id] = testCase.traceSummary || report.traceSummary;
    generatedTasks.push({
      id: failureTask.id,
      title: failureTask.title,
      snapshotRef: failureTask.snapshotRef,
      testRecordRefs: failureTask.testRecordRefs,
    });
  }
  return generatedTasks;
}

function previewProjectMaintenance(): void {
  const report = store.previewProjectMaintenance(manualMaintenanceOptions());
  lastMaintenanceSummary = JSON.stringify(maintenanceSummary(report, "preview"));
  notice = `清理预览：可清理 ${report.deletedSnapshotIds.length} 个快照，约 ${formatKb(report.reclaimedApproxBytes)}。`;
  renderAll();
}

function runManualProjectMaintenance(): void {
  const report = store.runProjectMaintenance(manualMaintenanceOptions());
  markProjectDirty("项目维护已更新");
  lastMaintenanceSummary = JSON.stringify(maintenanceSummary(report, "manual"));
  notice =
    report.deletedSnapshotIds.length > 0
      ? `已清理 ${report.deletedSnapshotIds.length} 个旧快照，约 ${formatKb(report.reclaimedApproxBytes)}。`
      : "没有需要清理的旧快照。";
  renderAll();
}

function runScheduledProjectMaintenance(): void {
  if (document.hidden || drawingBrush || Boolean(canvasDrag)) return;
  const report = store.runProjectMaintenance({
    orphanSnapshotAgeMs: 30 * 60 * 1000,
    maxSnapshotAgeMs: 24 * 60 * 60 * 1000,
    maxSnapshots: 240,
    minSnapshotsToKeep: 80,
    prunePassedTestSnapshots: false,
  });
  if (report.deletedSnapshotIds.length === 0 && report.updatedRecordIds.length === 0) return;
  markProjectDirty("后台维护已更新");
  lastMaintenanceSummary = JSON.stringify(maintenanceSummary(report, "auto"));
  notice = `后台清理完成：${report.deletedSnapshotIds.length} 个旧快照。`;
  renderAll();
}

function renderAll(): void {
  renderCanvasNow();
  renderUi();
}

function renderCanvasNow(): void {
  const showEditorOverlays = world.mode !== "game";
  renderer.render(world, {
    selectedId: showEditorOverlays ? selectedId : undefined,
    previewTask: showEditorOverlays ? currentPreviewTask() : undefined,
    liveBrush: showEditorOverlays ? liveBrushContext() : undefined,
  });
  canvasDirty = false;
  renderFrame();
}

function renderCanvasOnly(): void {
  canvasDirty = true;
}

function loop(time: number): void {
  const delta = time - lastTime;
  lastTime = time;
  world.pushDelta(delta);
  if (world.mode === "game" || canvasDirty) renderCanvasNow();
  raf = requestAnimationFrame(loop);
}

function renderUi(): void {
  renderTree();
  renderTasks();
  renderInspector();
  renderResources();
  renderFrame();
  root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === activeTool);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open-panel]").forEach((button) => {
    const panel = button.dataset.openPanel as PanelId | undefined;
    button.classList.toggle("is-active", Boolean(panel && panelLayout.panelState[panel] === "open"));
  });
  const queuedCount = Object.values(store.snapshot().project.tasks).filter((task) => task.status === "queued").length;
  root.querySelectorAll<HTMLButtonElement>('[data-action="run-autonomous-round"]').forEach((button) => {
    button.classList.add("is-emphasis");
    button.title = queuedCount > 0 ? `自动执行 1 个排队任务并自测；当前队列 ${queuedCount} 个` : "队列为空时会直接运行自治自测";
  });
  const mode = query<HTMLElement>('[data-role="mode"]');
  mode.textContent = world.mode === "game" ? "游戏运行" : "编辑冻结";
  mode.classList.toggle("is-running", world.mode === "game");
  query<HTMLElement>('[data-role="save-status"]').textContent = saveStatus;
  query<HTMLElement>('[data-role="pointer"]').textContent = `工具：${toolLabel(activeTool)}`;
  query<HTMLElement>('[data-role="notice"]').textContent = notice;
  root.dataset.tool = activeTool;
  root.dataset.scenePanel = panelLayout.panelState.scene;
  root.dataset.propertiesPanel = panelLayout.panelState.properties;
  root.dataset.assetsPanel = panelLayout.panelState.assets;
  root.dataset.tasksPanel = panelLayout.panelState.tasks;
  root.dataset.rightDock = panelLayout.hasOpenRightPanel() ? "open" : "closed";
  root.dataset.windowMenu = windowMenuOpen ? "open" : "closed";
  root.dataset.runtimeMode = world.mode;
  panelLayout.applyPanelSizes();
}

function renderFrame(): void {
  query<HTMLElement>('[data-role="frame"]').textContent =
    `tick ${world.clock.frame} · ${(world.clock.timeMs / 1000).toFixed(2)}s · ${Math.round(1000 / world.clock.fixedStepMs)}t/s`;
}

function renderTree(): void {
  const tree = query<HTMLElement>('[data-role="tree"]');
  const entities = editableEntities();
  tree.innerHTML = renderSceneTreeHtml(scene, entities, selectedId);
  bindSceneTreeInteractions(tree, {
    onSelectEntity: (entityId) => {
      selectedId = entityId || selectedId;
      notice = "层级对象已选中。";
      renderAll();
    },
    onMoveEntityToFolder: (entityId, folderId) => {
      moveEntityToFolder(entityId, folderId);
    },
  });
}

function renderTasks(): void {
  const tasks = query<HTMLElement>('[data-role="tasks"]');
  const snapshot = store.snapshot().project;
  tasks.innerHTML = renderTaskPanelHtml({
    project: snapshot,
    previewTaskId,
    aiTraceByTask,
    autonomousRoundSummary: lastAutonomousRoundSummary || (lastAutonomousSuiteSummary ? undefined : latestAutonomyRoundSummaryFromProject(snapshot)),
    lastMaintenanceSummary,
    lastAutonomousSuiteSummary,
    lastScriptedRunSummary,
    lastSweepSummary,
  });
  tasks.querySelectorAll<HTMLButtonElement>("[data-preview-task]").forEach((button) => {
    button.addEventListener("click", () => {
      previewTaskId = previewTaskId === button.dataset.previewTask ? "" : button.dataset.previewTask || "";
      notice = previewTaskId ? "正在预览任务上下文。" : "任务预览已关闭。";
      renderAll();
    });
  });
}

function legacyFrameToTick(frames: number): number {
  return Math.max(1, Math.round((frames * (scene.settings.tickRate || 100)) / 60));
}

function renderInspector(): void {
  const inspector = query<HTMLElement>('[data-role="inspector"]');
  const entity = editableEntity(selectedId);
  inspector.innerHTML = renderInspectorHtml(entity);
}

function renderResources(): void {
  const resourcesNode = query<HTMLElement>('[data-role="resources"]');
  const entity = editableEntity(selectedId);
  resourcesNode.innerHTML = renderResourcesHtml(entity, store.snapshot().project.resources);
}

function currentPreviewTask(): Task | undefined {
  if (!previewTaskId) return undefined;
  return store.snapshot().project.tasks[previewTaskId];
}

function liveBrushContext(): BrushContext | undefined {
  const liveStrokeResult = createSuperBrushStroke(currentStrokePoints);
  if (liveStrokeResult.ok) {
    return {
      strokes: [liveStrokeResult.value],
      annotations: [],
      targetEntityIds: editableEntity(selectedId) ? [selectedId as EntityId] : [],
      capturedSnapshotId: pendingBrush?.capturedSnapshotId as BrushContext["capturedSnapshotId"],
    };
  }
  if (!pendingBrush) return undefined;
  return {
    strokes: pendingBrush.strokes,
    annotations: pendingBrush.annotations,
    targetEntityIds: pendingBrush.selectionTargets
      .filter((target): target is Extract<TargetRef, { kind: "entity" }> => target.kind === "entity")
      .map((target) => target.entityId),
    capturedSnapshotId: pendingBrush.capturedSnapshotId as BrushContext["capturedSnapshotId"],
    summary: pendingBrush.strokes.length ? `${pendingBrush.strokes.length} 条画笔轨迹` : undefined,
  };
}

function currentTargets(): TargetRef[] {
  return editableEntity(selectedId) ? [{ kind: "entity", entityId: selectedId as EntityId }] : [{ kind: "scene", sceneId: scene.id }];
}

function moveEntityToFolder(entityId: EntityId, folderId: string): void {
  const entity = world.entities.get(entityId);
  if (!entity?.persistent) {
    notice = "临时对象不进入层级文件夹；它只属于运行时调试。";
    renderAll();
    return;
  }

  const plan = planPersistentFolderMoveTransaction(scene, entity, folderId);
  if (!plan.ok) {
    notice = `文件夹移动未提交：${plan.error}`;
    renderAll();
    return;
  }
  const transaction = store.createTransaction({
    actor: "user",
    patches: plan.value.patches,
    inversePatches: plan.value.inversePatches,
    diffSummary: plan.value.diffSummary,
  });
  const result = store.apply(transaction);
  if (!result.ok) {
    syncWorldFromStore();
    notice = `文件夹移动未提交：${result.error}`;
    renderAll();
    return;
  }

  selectedId = entityId;
  syncWorldFromStore();
  markProjectDirty("文件夹移动已更新");
  notice = "已提交文件夹移动事务。";
  renderAll();
}

function syncWorldFromStore(): void {
  const latestProject = store.project;
  const latestScene = latestProject.scenes[latestProject.activeSceneId];
  scene = latestScene;
  for (const entityId of [...world.entities.keys()]) {
    if (!latestScene.entities[entityId]) world.entities.delete(entityId);
  }
  Object.values(latestScene.entities).forEach((entity) => {
    if (entity.persistent) world.entities.set(entity.id, cloneJson(entity));
  });
}

function rebuildWorldFromStore(): void {
  const latestProject = store.project;
  scene = latestProject.scenes[latestProject.activeSceneId];
  world = new RuntimeWorld({ scene });
}

function updateCanvasCursor(point: Vec2): void {
  const canvas = renderer.canvas();
  if (activeTool === "superBrush") {
    canvas.style.cursor = "crosshair";
    return;
  }
  if (activeTool !== "select") {
    canvas.style.cursor = "default";
    return;
  }
  const handle = renderer.pickTransformHandle(selectedEntity(), point);
  if (handle) {
    canvas.style.cursor = cursorForTransformHandle(handle);
    return;
  }
  canvas.style.cursor = renderer.pickEntity(world, point, selectedId) ? "pointer" : "default";
}

function query<T extends HTMLElement>(selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

window.addEventListener("pagehide", () => {
  saveDirtyProjectLocallyNow();
});

window.addEventListener("beforeunload", () => {
  saveDirtyProjectLocallyNow();
  cancelAnimationFrame(raf);
  renderer.destroy();
});
