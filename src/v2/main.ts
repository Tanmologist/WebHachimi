import "dockview-core/dist/styles/dockview.css";
import "./styles.css";
import type { AutonomyLoop } from "../ai/autonomyLoop";
import type { AiTaskExecutionResult, AiTaskExecutor } from "../ai/taskExecutor";
import { createTask } from "../project/tasks";
import { normalizeProjectDefaults, type BrushContext, type Entity, type Project, type ProjectPatch, type Resource, type ResourceBinding, type TargetRef, type Task } from "../project/schema";
import { consumeEditorHandoff } from "../project/editorHandoff";
import { ProjectStore } from "../project/projectStore";
import {
  createBrushContextFromSuperBrushDraft,
  createSuperBrushStroke,
  createTaskFromSuperBrush,
  hasMeaningfulSuperBrushContext,
  mergeSuperBrushTargets,
  summarizeSuperBrushDraft,
  type SuperBrushDraft,
} from "../editor/superBrush";
import { RuntimeWorld } from "../runtime/world";
import { cloneJson, makeId, type EntityId, type Rect, type ResourceId, type Result, type Transform2D, type Vec2 } from "../shared/types";
import type { AutonomousTestSuiteReport } from "../testing/autonomousTesting";
import {
  applyCanvasDragState,
  createCanvasDragState,
  cursorForTransformHandle,
  dragNotice,
  type CanvasDragState,
} from "./canvasTransform";
import { createStarterProject, repairKnownStarterLabels } from "./starterProject";
import { V2Renderer, type CanvasTargetPart, type ShapeDraftPreview, type TransformHandle } from "./renderer";
import { mountEditorShell } from "./editorShell";
import { handleEditorKeyDown, handleEditorKeyUp } from "./keyboardController";
import { PanelLayoutController, type PanelId } from "./panelLayout";
import { renderInspectorHtml, renderResourceLibraryHtml, renderResourcesHtml } from "./panelViews";
import { bindSceneTreeInteractions, renderSceneTreeHtml } from "./sceneTreeController";
import { renderTaskPanelHtml } from "./taskPanelViews";
import { planPersistentFolderMoveTransaction } from "./folderMoveTransaction";
import {
  planDeleteEntityTransaction,
  planDuplicateEntityTransaction,
  planPresentationVisibilityTransaction,
  planRemovePresentationTransaction,
  planResetPresentationToBodyTransaction,
  planRenameEntityTransaction,
  planRenameResourceTransaction,
  type ContextMenuTransactionPlan,
} from "./contextMenuActions";
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
} from "./summaryModels";
import { buildProjectForSave, loadProjectForEditor, saveProjectFromEditor, saveProjectLocallyFromEditor } from "./persistenceController";
import {
  isImageFileLike,
  looksLikeExternalResource,
  type ImportedFileResource,
  type ResourceImportMetadata,
  resourceImportMetadataFromFile,
  resourceImportMetadataFromSequence,
  resourceImportMetadataFromText,
  resourceTagsForType,
  sequenceGroupKeyFromFileName,
} from "./resourceImport";
import { buildSequenceSpriteMetadata, buildSheetSpriteMetadata, imageAttachments, resourceHasAnimation } from "./resourceAnimation";
import { AutoSaveController } from "./autoSaveController";
import { EditorPerformanceController } from "./editorPerformanceController";
import { OutputLogController } from "./outputLogController";
import { TaskSummaryController } from "./taskSummaryController";

const toolIds = ["select", "square", "circle", "leaf", "polygon", "superBrush"] as const;
type ToolId = (typeof toolIds)[number];
type ShapeToolId = Extract<ToolId, "square" | "circle" | "leaf">;
type ActiveSurface = "canvas" | "world";
type ContextMenuAction =
  | "select-target"
  | "rename-entity"
  | "duplicate-entity"
  | "delete-target"
  | "toggle-presentation"
  | "reset-presentation"
  | "remove-presentation"
  | "reset-viewport";

type ContextMenuItem = {
  action: ContextMenuAction;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
};

type LocalClipboardFilesResponse = {
  ok: boolean;
  files?: ResourceImportMetadata[];
  skipped?: Array<{ fileName?: string; reason: string }>;
  error?: string;
};

type ContextMenuState = {
  x: number;
  y: number;
  title: string;
  entityId?: string;
  part?: CanvasTargetPart;
  items: ContextMenuItem[];
};

type ShapeDragState = {
  pointerId: number;
  tool: ShapeToolId;
  start: Vec2;
  current: Vec2;
  moved: boolean;
  points: Vec2[];
};

type PolygonDraftState = {
  points: Vec2[];
};

const rootMaybe = document.querySelector<HTMLElement>("#v2-root");
if (!rootMaybe) throw new Error("missing #v2-root");
const root = rootMaybe;

const handoff = consumeEditorHandoff();
const initialProject = await loadInitialProject(handoff?.project);
const project = normalizeProjectDefaults(repairKnownStarterLabels(initialProject.project));
const store = new ProjectStore(project);
let aiExecutorInstance: AiTaskExecutor | undefined;
let autonomyLoopInstance: AutonomyLoop | undefined;
let scene = project.scenes[project.activeSceneId];
let world = new RuntimeWorld({ scene });
if (handoff?.snapshot) world.restoreSnapshot(handoff.snapshot);
const renderer = new V2Renderer();
let animatedResourcePresent = sceneHasVisibleAnimatedResource(project);

let selectedId = Object.keys(scene.entities)[0] || "";
let selectedPart: CanvasTargetPart = "body";
let selectedIds: EntityId[] = selectedId ? [selectedId as EntityId] : [];
let selectionArea: Rect | undefined;
let activeTool: ToolId = "select";
let previewTaskId = "";
let localClipboardFallbackToken = 0;
let notice = handoff
  ? `已从游戏暂停帧 ${handoff.snapshot.frame} 进入编辑器。按 Z 可继续运行。`
  : initialProject.notice;
let lastTime = performance.now();
let raf = 0;
let canvasDirty = true;
const editorPerformance = new EditorPerformanceController(lastTime);

let drawingBrush = false;
let drawingBrushPointerId: number | undefined;
let brushStartPoint: Vec2 | undefined;
let currentStrokePoints: Vec2[] = [];
let pendingBrush: SuperBrushDraft | undefined;
let superBrushTaskDialogOpen = false;
let superBrushTaskError = "";
let canvasDrag: CanvasDragState | undefined;
let canvasCameraDrag: { pointerId: number; clientX: number; clientY: number; moved: boolean } | undefined;
let selectionBoxDrag: { pointerId: number; start: Vec2; current: Vec2; moved: boolean } | undefined;
let shapeDrag: ShapeDragState | undefined;
let polygonDraft: PolygonDraftState | undefined;
let windowMenuOpen = false;
let pendingWindowMenuClick: number | undefined;
let activeSurface: ActiveSurface = "canvas";
let contextMenu: ContextMenuState | undefined;
const collapsedTreeNodes = new Set<string>();
const managedPanels: PanelId[] = ["scene", "properties", "assets", "library", "tasks", "output"];
const aiTraceByTask: Record<string, string> = {};
const outputLog = new OutputLogController();
const taskSummaries = new TaskSummaryController();
const uiRenderState = {
  tree: "",
  tasks: "",
  inspector: "",
  resources: "",
  resourceLibrary: "",
  output: "",
  minimizedTray: "",
  contextMenu: "",
  chrome: "",
  frame: "",
  layout: "",
};
const autoSave = new AutoSaveController({
  initialStatus: initialProject.loadedFromDisk ? "已从磁盘载入，自动保存就绪" : "自动保存就绪",
  saveProject: async () => {
    const result = await saveProjectFromEditor(buildCurrentProjectForSave());
    return result.notice;
  },
  saveProjectLocally: () => saveProjectLocallyFromEditor(buildCurrentProjectForSave()).notice,
  shouldDeferSave: () => drawingBrush || superBrushTaskDialogOpen || Boolean(canvasDrag || shapeDrag || polygonDraft),
  render: renderUi,
});
const panelLayout = new PanelLayoutController({
  root,
  setNotice(value) {
    notice = value;
  },
  renderAll,
  renderUi,
});

mountEditorShell(root);
panelLayout.applyPanelSizes();

const stageHost = query<HTMLElement>('[data-role="stage"]');
const taskInput = query<HTMLTextAreaElement>('[data-role="task-input"]');
const superBrushTaskInput = query<HTMLTextAreaElement>('[data-role="super-brush-task-input"]');
const resourceFileInput = query<HTMLInputElement>('[data-role="resource-file-input"]');
const taskWorkflow = createTaskWorkflowController({
  store,
  executeNextAiTask,
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

async function getAiExecutor(): Promise<AiTaskExecutor> {
  if (!aiExecutorInstance) {
    const { AiTaskExecutor } = await import("../ai/taskExecutor");
    aiExecutorInstance = new AiTaskExecutor({ store });
  }
  return aiExecutorInstance;
}

async function executeNextAiTask(): Promise<Result<AiTaskExecutionResult | undefined>> {
  const executor = await getAiExecutor();
  return executor.executeNextQueuedTask();
}

async function getAutonomyLoop(): Promise<AutonomyLoop> {
  if (!autonomyLoopInstance) {
    const [{ AutonomyLoop }, executor] = await Promise.all([import("../ai/autonomyLoop"), getAiExecutor()]);
    autonomyLoopInstance = new AutonomyLoop({ store, executor });
  }
  return autonomyLoopInstance;
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
    if (!windowMenuOpen) clearPendingWindowMenuClick();
    renderAll();
  });
  root.querySelector('[data-action="queue-task"]')?.addEventListener("click", () => taskWorkflow.queueTaskFromText(taskInput.value));
  root.querySelector('[data-action="confirm-super-brush"]')?.addEventListener("click", openSuperBrushTaskDialog);
  root.querySelector('[data-action="back-super-brush"]')?.addEventListener("click", closeSuperBrushTaskDialog);
  root.querySelector('[data-action="queue-super-brush-task"]')?.addEventListener("click", queueSuperBrushTaskFromDialog);
  root.querySelectorAll('[data-action="cancel-super-brush-session"]').forEach((button) => {
    button.addEventListener("click", cancelSuperBrushSession);
  });
  superBrushTaskInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      queueSuperBrushTaskFromDialog();
    }
  });
  taskInput.addEventListener("paste", onTaskInputPaste);
  taskInput.addEventListener("keydown", onResourcePasteKeyDown);
  resourceFileInput.addEventListener("change", () => {
    void importResourceFiles(Array.from(resourceFileInput.files || []));
    resourceFileInput.value = "";
  });
  const libraryPanelBody = root.querySelector<HTMLElement>('.v2-library-panel .v2-panel-body');
  libraryPanelBody?.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
  });
  libraryPanelBody?.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) {
      void importResourceFiles(files);
      return;
    }
    const text = event.dataTransfer?.getData("text/plain") || "";
    if (text.trim()) addResourceFromText(text);
  });
  root.querySelector('[data-action="confirm-polygon"]')?.addEventListener("click", finishPolygonDraft);
  root.querySelector('[data-action="cancel-polygon"]')?.addEventListener("click", () => {
    polygonDraft = undefined;
    notice = "多边形绘制已取消。";
    renderAll();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTool = parseToolId(button.dataset.tool);
      if (!nextTool) {
        notice = `Unknown tool: ${button.dataset.tool || ""}`;
        renderAll();
        return;
      }
      if (nextTool === "superBrush") {
        enterSuperBrushMode();
        return;
      }
      if (activeTool === "polygon" && nextTool !== "polygon") polygonDraft = undefined;
      activeTool = nextTool;
      contextMenu = undefined;
      notice = toolSwitchNotice(activeTool);
      renderAll();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open-panel]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (event.detail > 1) return;
      const panel = button.dataset.openPanel as PanelId | undefined;
      if (!panel) return;
      scheduleWindowMenuPanelClick(panel);
    });
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const panel = button.dataset.openPanel as PanelId | undefined;
      if (!panel) return;
      centerWindowPanel(panel);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-surface-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.surfaceTarget as ActiveSurface | undefined;
      if (target === "canvas") focusCanvasSurface();
      if (target === "world") focusWorldSurface();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-panel-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.dataset.panel as PanelId | undefined;
      if (!panel) return;
      if (button.dataset.panelAction === "close") {
        panelLayout.closePanel(panel);
        notice = `${panelLabel(panel)}已关闭。`;
      } else {
        panelLayout.minimizePanel(panel);
        notice = `${panelLabel(panel)}已最小化到底部托盘。`;
      }
      renderAll();
    });
  });
  root.addEventListener("click", (event) => {
    const restoreButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-restore-panel]");
    if (restoreButton) {
      const panel = restoreButton.dataset.restorePanel as PanelId | undefined;
      if (!panel) return;
      panelLayout.restorePanel(panel);
      notice = `${panelLabel(panel)}已恢复。`;
      renderAll();
      return;
    }

  });
  root.querySelectorAll<HTMLElement>("[data-window-drag]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      windowMenuOpen = false;
      panelLayout.startWindowDrag(event);
    });
  });
  root.querySelectorAll<HTMLElement>(".v2-window").forEach((panel) => {
    panel.addEventListener("pointerdown", () => {
      const panelId = panel.dataset.panel as PanelId | undefined;
      if (!panelId) return;
      if (panelId === "scene") activeSurface = "world";
      panelLayout.bringPanelToFront(panelId);
      if (!panelLayout.isDraggingWindow()) panelLayout.applyPanelSizes();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-resize]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => panelLayout.startPanelResize(event));
  });

  const canvas = renderer.canvas();
  canvas.tabIndex = 0;
  const contextMenuNode = query<HTMLElement>('[data-role="context-menu"]');
  contextMenuNode.addEventListener("click", onContextMenuClick);
  contextMenuNode.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", onCanvasPointerDown);
  canvas.addEventListener("pointermove", onCanvasPointerMove);
  canvas.addEventListener("pointerup", onCanvasPointerUp);
  canvas.addEventListener("pointerleave", onCanvasPointerUp);
  canvas.addEventListener("pointercancel", cancelCanvasPointerInteraction);
  canvas.addEventListener("lostpointercapture", cancelCanvasPointerInteraction);
  canvas.addEventListener("contextmenu", onCanvasContextMenu);
  canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
  canvas.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("pointermove", (event) => panelLayout.onPanelResizeMove(event));
  window.addEventListener("pointerup", (event) => panelLayout.stopPanelResize(event));
  window.addEventListener("pointercancel", (event) => panelLayout.stopPanelResize(event));
  window.addEventListener("pointermove", (event) => panelLayout.onWindowDragMove(event));
  window.addEventListener("pointerup", (event) => panelLayout.stopWindowDrag(event));
  window.addEventListener("pointercancel", (event) => panelLayout.stopWindowDrag(event));
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    let changed = false;
    if (contextMenu && !target.closest(".v2-context-menu")) {
      contextMenu = undefined;
      changed = true;
    }
    if (windowMenuOpen && !target.closest(".v2-window-manager")) {
      windowMenuOpen = false;
      clearPendingWindowMenuClick();
      changed = true;
    }
    if (changed) renderAll();
  });
}

function scheduleWindowMenuPanelClick(panel: PanelId): void {
  clearPendingWindowMenuClick();
  pendingWindowMenuClick = window.setTimeout(() => {
    pendingWindowMenuClick = undefined;
    activateWindowMenuPanel(panel);
  }, 180);
}

function clearPendingWindowMenuClick(): void {
  if (pendingWindowMenuClick === undefined) return;
  window.clearTimeout(pendingWindowMenuClick);
  pendingWindowMenuClick = undefined;
}

function activateWindowMenuPanel(panel: PanelId): void {
  const wasOpen = panelLayout.panelState[panel] === "open";
  windowMenuOpen = false;
  panelLayout.restorePanel(panel);
  if (panel === "scene") activeSurface = "world";
  notice = `${panelLabel(panel)}已${wasOpen ? "前置" : "打开"}。`;
  renderAll();
}

function focusCanvasSurface(): void {
  clearPendingWindowMenuClick();
  windowMenuOpen = false;
  activeSurface = "canvas";
  const canvas = renderer.canvas();
  canvas.tabIndex = 0;
  canvas.focus();
  notice = "已切换到画布。";
  renderAll();
}

function focusWorldSurface(): void {
  clearPendingWindowMenuClick();
  windowMenuOpen = false;
  activeSurface = "world";
  panelLayout.restorePanel("scene");
  const tree = root.querySelector<HTMLElement>('[data-role="tree"]');
  if (tree) {
    tree.tabIndex = 0;
    tree.focus();
  }
  notice = "已切换到世界。";
  renderAll();
}

function centerWindowPanel(panel: PanelId): void {
  clearPendingWindowMenuClick();
  windowMenuOpen = false;
  panelLayout.centerPanel(panel);
  if (panel === "scene") activeSurface = "world";
  notice = `${panelLabel(panel)}已归中。`;
  renderAll();
}

function startCanvasTransform(event: PointerEvent, entityId: string, part: CanvasTargetPart, handle: TransformHandle, point: Vec2): void {
  const entity = world.allEntities().find((item) => item.id === entityId);
  if (!entity) return;
  renderer.canvas().setPointerCapture(event.pointerId);
  canvasDrag = createCanvasDragState(event.pointerId, entity, part, handle, point);
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
  if (drag.part === "presentation") return commitPresentationTransform(entity, drag);
  const finalTransform = cloneJson(entity.transform);
  const finalCollider = cloneJson(entity.collider);
  const patches: ProjectPatch[] = [];
  const inversePatches: ProjectPatch[] = [];
  if (!sameTransform(drag.originalTransform, finalTransform)) {
    const transformPath = `/scenes/${scene.id}/entities/${entity.id}/transform` as ProjectPatch["path"];
    patches.push({ op: "set", path: transformPath, value: finalTransform });
    inversePatches.push({ op: "set", path: transformPath, value: drag.originalTransform });
  }
  if (!sameCollider(drag.originalCollider, finalCollider)) {
    const colliderPath = `/scenes/${scene.id}/entities/${entity.id}/collider` as ProjectPatch["path"];
    patches.push({ op: "set", path: colliderPath, value: finalCollider });
    inversePatches.push(
      drag.originalCollider ? { op: "set", path: colliderPath, value: drag.originalCollider } : { op: "delete", path: colliderPath },
    );
  }
  if (!patches.length) return undefined;

  const transaction = store.createTransaction({
    actor: "user",
    patches,
    inversePatches,
    diffSummary: `调整 ${entity.displayName} 本体的${transformActionLabel(drag.kind)}。`,
  });
  const result = store.apply(transaction);
  if (!result.ok) {
    syncWorldFromStore();
    return `变换未提交：${result.error}`;
  }
  syncWorldFromStore();
  markProjectDirty(`已调整 ${entity.displayName}`);
  return `已提交本体变换：${transformActionLabel(drag.kind)}。`;
}

function commitPresentationTransform(entity: Entity, drag: CanvasDragState): string | undefined {
  const finalRender = cloneJson(entity.render);
  if (!finalRender || sameRender(drag.originalRender, finalRender)) return undefined;

  const path = `/scenes/${scene.id}/entities/${entity.id}/render` as ProjectPatch["path"];
  const transaction = store.createTransaction({
    actor: "user",
    patches: [{ op: "set", path, value: finalRender }],
    inversePatches: drag.originalRender ? [{ op: "set", path, value: drag.originalRender }] : [{ op: "delete", path }],
    diffSummary: `调整 ${entity.displayName} 当前可视体的${transformActionLabel(drag.kind)}。`,
  });
  const result = store.apply(transaction);
  if (!result.ok) {
    syncWorldFromStore();
    return `可视体变换未提交：${result.error}`;
  }
  syncWorldFromStore();
  markProjectDirty(`已调整 ${entity.displayName} 当前可视体`);
  return `已提交当前可视体变换：${transformActionLabel(drag.kind)}。`;
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

function sameCollider(left: Entity["collider"] | undefined, right: Entity["collider"] | undefined): boolean {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function sameRender(left: Entity["render"] | undefined, right: Entity["render"] | undefined): boolean {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function transformActionLabel(kind: CanvasDragState["kind"]): string {
  return kind === "move" ? "位置" : kind === "scale" ? "大小" : "旋转";
}

function onCanvasWheel(event: WheelEvent): void {
  event.preventDefault();
  contextMenu = undefined;
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
  if (drawingBrush && drawingBrushPointerId === event.pointerId) {
    drawingBrush = false;
    drawingBrushPointerId = undefined;
    brushStartPoint = undefined;
    currentStrokePoints = [];
    if (pendingBrush && !hasMeaningfulSuperBrushContext(pendingBrush)) pendingBrush = undefined;
    renderAll();
    return;
  }
  if (selectionBoxDrag?.pointerId === event.pointerId) {
    selectionBoxDrag = undefined;
    renderAll();
  }
  if (shapeDrag?.pointerId === event.pointerId) {
    shapeDrag = undefined;
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

function toolSwitchNotice(tool: ToolId): string {
  if (tool === "square") return "方块工具：在画布上拖动创建一个方形本体。";
  if (tool === "circle") return "圆形工具：在画布上拖动创建一个圆形本体；扇形参数后续接到属性面板。";
  if (tool === "leaf") return "柳叶笔：按住拖动画出自由轮廓，松开后自动闭环成碰撞本体。";
  if (tool === "polygon") return "多边形工具：逐点点击顶点，点确认或右键自动闭环。";
  if (tool === "superBrush") return "超级画笔：拖动圈出问题，单击对象可追加目标，然后在任务框描述要改什么。";
  return "已切换工具。";
}

function parseToolId(value?: string): ToolId | undefined {
  const normalized = (value || "").trim();
  const direct = toolIds.find((tool) => tool === normalized);
  if (direct) return direct;
  const lower = normalized.toLowerCase();
  if (["super-brush", "super brush", "superbrush", "brush"].includes(lower)) return "superBrush";
  if (normalized === "超级画笔" || normalized === "画笔") return "superBrush";
  return undefined;
}

function shapeToolFromActive(tool: ToolId): ShapeToolId | undefined {
  return tool === "square" || tool === "circle" || tool === "leaf" ? tool : undefined;
}

function enterSuperBrushMode(): void {
  activeTool = "superBrush";
  contextMenu = undefined;
  windowMenuOpen = false;
  superBrushTaskDialogOpen = false;
  superBrushTaskError = "";
  focusCanvasSurface();
  notice = "已进入超级画笔模式。右键撤销上一笔，顶部确认后填写任务。";
  renderAll();
}

function startSuperBrushStroke(event: PointerEvent, point: Vec2): void {
  const snapshot = world.freezeForInspection();
  store.recordRuntimeSnapshot(snapshot);
  const startTargets = mergeSuperBrushTargets(pendingBrush?.selectionTargets, targetsForSuperBrushClick(point));
  pendingBrush = {
    strokes: pendingBrush?.strokes || [],
    annotations: pendingBrush?.annotations || [],
    selectionTargets: startTargets,
    capturedSnapshotId: pendingBrush?.capturedSnapshotId || snapshot.id,
    selectionBox: pendingBrush?.selectionBox || selectionBoxFromTargets(startTargets),
  };
  markProjectDirty("已捕捉超级画笔上下文");
  drawingBrush = true;
  drawingBrushPointerId = event.pointerId;
  brushStartPoint = point;
  currentStrokePoints = [point];
  contextMenu = undefined;
  renderer.canvas().setPointerCapture(event.pointerId);
  notice = "正在记录超级画笔；可以连续画多笔，随后在任务框描述要改什么。";
  renderAll();
}

function onCanvasPointerDown(event: PointerEvent): void {
  activeSurface = "canvas";
  if (event.button === 1) {
    startCanvasCameraDrag(event);
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const shapeTool = shapeToolFromActive(activeTool);
  if (shapeTool && world.mode === "editorFrozen") {
    shapeDrag = { pointerId: event.pointerId, tool: shapeTool, start: point, current: point, moved: false, points: [point] };
    renderer.canvas().setPointerCapture(event.pointerId);
    contextMenu = undefined;
    notice = shapeTool === "leaf" ? "正在手绘轮廓；松开后自动闭环。" : `拖动创建${toolLabel(shapeTool)}本体。`;
    renderCanvasOnly();
    return;
  }
  if (activeTool === "polygon" && world.mode === "editorFrozen") {
    polygonDraft = {
      points: [...(polygonDraft?.points || []), point],
    };
    contextMenu = undefined;
    notice = polygonDraft.points.length >= 3 ? "多边形顶点已加入；点确认或右键闭环。" : "继续点击添加多边形顶点。";
    renderAll();
    return;
  }
  if (activeTool === "select" && world.mode === "editorFrozen") {
    const selected = selectedEntity();
    const handle = renderer.pickTransformHandle(selected, selectedPart, point);
    if (selected && handle) {
      startCanvasTransform(event, selected.id, selectedPart, handle, point);
      renderAll();
      return;
    }
  }
  if (activeTool === "superBrush") {
    startSuperBrushStroke(event, point);
    return;
  }

  const picked = renderer.pickCanvasTarget(world, point, selectedId ? { entityId: selectedId, part: selectedPart } : undefined);
  if (picked) {
    selectedId = picked.entity.id;
    selectedPart = picked.part;
    selectedIds = [picked.entity.id as EntityId];
    selectionArea = undefined;
    notice = `已选中：${picked.entity.displayName}${picked.part === "presentation" ? " 的当前可视体" : " 的本体"}`;
    renderAll();
    return;
  }
  if (activeTool === "select" && world.mode === "editorFrozen") {
    selectionBoxDrag = { pointerId: event.pointerId, start: point, current: point, moved: false };
    renderer.canvas().setPointerCapture(event.pointerId);
    notice = "拖动框选对象；空白框选会成为区域任务目标。";
    renderCanvasOnly();
  }
}

function onCanvasContextMenu(event: MouseEvent): void {
  event.preventDefault();
  if (activeTool === "superBrush" || pendingBrush || drawingBrush) {
    undoLastSuperBrushStrokeOrCancel();
    return;
  }
  if (activeTool === "polygon" && polygonDraft?.points.length) {
    finishPolygonDraft();
    return;
  }
  if (drawingBrush || canvasDrag || canvasCameraDrag || shapeDrag || world.mode === "game") {
    contextMenu = undefined;
    renderAll();
    return;
  }

  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const picked = renderer.pickCanvasTarget(world, point, selectedId ? { entityId: selectedId, part: selectedPart } : undefined);
  if (picked) {
    selectedId = picked.entity.id;
    selectedPart = picked.part;
    selectedIds = [picked.entity.id as EntityId];
    selectionArea = undefined;
    showEntityContextMenu(picked.entity, picked.part, event.clientX, event.clientY);
    return;
  }

  showCanvasContextMenu(event.clientX, event.clientY);
}

function showEntityContextMenu(entity: Entity, part: CanvasTargetPart, clientX: number, clientY: number): void {
  const items = contextMenuItemsForEntity(entity, part);
  contextMenu = {
    ...clampedContextMenuPosition(clientX, clientY, items.length),
    title: part === "presentation" ? `${entity.displayName} · 可视体` : entity.displayName,
    entityId: entity.id,
    part,
    items,
  };
  windowMenuOpen = false;
  renderAll();
}

function showCanvasContextMenu(clientX: number, clientY: number): void {
  contextMenu = {
    ...clampedContextMenuPosition(clientX, clientY, 1),
    title: "画布",
    items: [{ action: "reset-viewport", label: "重置视角", hint: "回到默认缩放和位置" }],
  };
  windowMenuOpen = false;
  renderAll();
}

function contextMenuItemsForEntity(entity: Entity, part: CanvasTargetPart): ContextMenuItem[] {
  if (part !== "presentation") {
    return [
      { action: "select-target", label: "选择", disabled: selectedId === entity.id && selectedPart === "body" },
      { action: "rename-entity", label: "重命名", disabled: !entity.persistent },
      { action: "duplicate-entity", label: "复制", disabled: !entity.persistent },
      { action: "delete-target", label: "删除", danger: true, disabled: !entity.persistent },
      { action: "reset-viewport", label: "重置视角", separatorBefore: true },
    ];
  }
  const presentationVisible = entity.render?.visible !== false;
  return [
    { action: "select-target", label: "选择", disabled: selectedId === entity.id && selectedPart === "presentation" },
    { action: "toggle-presentation", label: presentationVisible ? "隐藏" : "显示", disabled: !entity.render },
    { action: "reset-presentation", label: "贴合本体", disabled: !entity.render },
    { action: "delete-target", label: "删除", danger: true, disabled: !entity.persistent || !entity.render },
    { action: "reset-viewport", label: "重置视角", separatorBefore: true },
  ];
}

function clampedContextMenuPosition(clientX: number, clientY: number, itemCount: number): { x: number; y: number } {
  const width = 236;
  const height = 44 + itemCount * 38;
  return {
    x: Math.max(8, Math.min(clientX, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(clientY, window.innerHeight - height - 8)),
  };
}

function onContextMenuClick(event: MouseEvent): void {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-context-action]");
  if (!button || button.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  const state = contextMenu;
  const action = button.dataset.contextAction as ContextMenuAction | undefined;
  contextMenu = undefined;
  if (!state || !action) {
    renderAll();
    return;
  }
  runContextMenuAction(action, state);
}

function runContextMenuAction(action: ContextMenuAction, state: ContextMenuState): void {
  if (action === "reset-viewport") {
    renderer.resetViewport();
    notice = "视角已重置。";
    renderAll();
    return;
  }

  const entity = state.entityId ? editableEntity(state.entityId) : undefined;
  if (!entity) {
    notice = "右键目标已经不存在。";
    syncWorldFromStore();
    renderAll();
    return;
  }

  if (action === "select-target") {
    selectedId = entity.id;
    selectedPart = state.part || "body";
    selectedIds = [entity.id as EntityId];
    selectionArea = undefined;
    notice = selectedPart === "presentation" ? "已选择可视体。" : "已选择。";
    renderAll();
    return;
  }

  if (action === "rename-entity") {
    const nextName = window.prompt("重命名方块", entity.displayName);
    if (nextName === null) {
      notice = "已取消重命名。";
      renderAll();
      return;
    }
    applyContextMenuTransaction(planRenameEntityTransaction(scene, entity, nextName));
    return;
  }

  if (action === "delete-target") {
    if (state.part === "presentation") {
      if (!window.confirm(`删除「${entity.displayName}」的可视体？本体会保留。`)) {
        notice = "已取消删除。";
        renderAll();
        return;
      }
      applyContextMenuTransaction(planRemovePresentationTransaction(scene, entity));
      return;
    }
    if (!window.confirm(`删除「${entity.displayName}」？这个操作会进入项目历史。`)) {
      notice = "已取消删除。";
      renderAll();
      return;
    }
    applyContextMenuTransaction(planDeleteEntityTransaction(scene, entity));
    return;
  }

  if (action === "duplicate-entity") {
    applyContextMenuTransaction(planDuplicateEntityTransaction(scene, entity));
    return;
  }

  if (action === "toggle-presentation") {
    applyContextMenuTransaction(planPresentationVisibilityTransaction(scene, entity, entity.render?.visible === false));
    return;
  }

  if (action === "reset-presentation") {
    applyContextMenuTransaction(planResetPresentationToBodyTransaction(scene, entity));
    return;
  }

  if (action === "remove-presentation") {
    if (!window.confirm(`删除「${entity.displayName}」的当前可视体？本体会保留。`)) {
      notice = "已取消删除可视体。";
      renderAll();
      return;
    }
    applyContextMenuTransaction(planRemovePresentationTransaction(scene, entity));
  }
}

function applyContextMenuTransaction(planResult: Result<ContextMenuTransactionPlan>): void {
  if (!planResult.ok) {
    notice = `右键操作未提交：${planResult.error}`;
    renderAll();
    return;
  }
  const transaction = store.createTransaction({
    actor: "user",
    patches: planResult.value.patches,
    inversePatches: planResult.value.inversePatches,
    diffSummary: planResult.value.diffSummary,
  });
  const result = store.apply(transaction);
  if (!result.ok) {
    syncWorldFromStore();
    notice = `右键操作未提交：${result.error}`;
    renderAll();
    return;
  }
  syncWorldFromStore();
  if (planResult.value.selectedId && editableEntity(planResult.value.selectedId)) {
    selectedId = planResult.value.selectedId;
    selectedPart = planResult.value.selectedPart || "body";
    selectedIds = [planResult.value.selectedId];
    selectionArea = undefined;
  } else if (!editableEntity(selectedId)) {
    selectedId = Object.keys(scene.entities)[0] || "";
    selectedPart = "body";
    selectedIds = selectedId ? [selectedId as EntityId] : [];
    selectionArea = undefined;
  } else if (planResult.value.selectedPart) {
    selectedPart = planResult.value.selectedPart;
  }
  markProjectDirty(planResult.value.notice);
  notice = planResult.value.notice;
  renderAll();
}

function renameEntityFromInput(entityId: string, rawDisplayName: string): void {
  const entity = editableEntity(entityId);
  if (!entity) {
    notice = "重命名目标已经不存在。";
    syncWorldFromStore();
    renderAll();
    return;
  }
  applyContextMenuTransaction(planRenameEntityTransaction(scene, entity, rawDisplayName));
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
  if (selectionBoxDrag && selectionBoxDrag.pointerId === event.pointerId) {
    event.preventDefault();
    selectionBoxDrag.current = point;
    selectionBoxDrag.moved = selectionBoxDrag.moved || distance(selectionBoxDrag.start, point) > 8;
    renderCanvasOnly();
    return;
  }
  if (shapeDrag && shapeDrag.pointerId === event.pointerId) {
    event.preventDefault();
    shapeDrag.current = point;
    shapeDrag.moved = shapeDrag.moved || distance(shapeDrag.start, point) > 8;
    const lastPoint = shapeDrag.points[shapeDrag.points.length - 1];
    if (shapeDrag.tool === "leaf" && (!lastPoint || distance(lastPoint, point) >= 4)) shapeDrag.points.push(point);
    renderCanvasOnly();
    return;
  }
  updateCanvasCursor(point);
  if (!drawingBrush || drawingBrushPointerId !== event.pointerId) return;
  event.preventDefault();
  const last = currentStrokePoints[currentStrokePoints.length - 1];
  if (!last || distance(point, last) >= superBrushPointSpacing()) {
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
  if (selectionBoxDrag && selectionBoxDrag.pointerId === event.pointerId) {
    finishSelectionBox(event);
    return;
  }
  if (shapeDrag && shapeDrag.pointerId === event.pointerId) {
    finishShapeDrag(event);
    return;
  }
  if (!drawingBrush || drawingBrushPointerId !== event.pointerId) return;
  event.preventDefault();
  const finishedPoints = currentStrokePoints;
  const finishedStart = brushStartPoint || finishedPoints[0];
  const finishedEnd = finishedPoints[finishedPoints.length - 1] || finishedStart;
  drawingBrush = false;
  drawingBrushPointerId = undefined;
  brushStartPoint = undefined;
  releaseCanvasPointer(event.pointerId);
  const createdStroke = createSuperBrushStroke(finishedPoints);
  if (createdStroke.ok) {
    const strokeTargets = targetsForCompletedSuperBrushStroke(finishedPoints);
    pendingBrush = {
      strokes: [...(pendingBrush?.strokes || []), createdStroke.value],
      annotations: pendingBrush?.annotations || [],
      selectionTargets: mergeSuperBrushTargets(pendingBrush?.selectionTargets, strokeTargets),
      capturedSnapshotId: pendingBrush?.capturedSnapshotId,
      selectionBox: mergedSelectionBox(pendingBrush?.selectionBox, selectionBoxFromTargets(strokeTargets)),
    };
    notice = superBrushRecordedNotice();
  } else if (finishedStart && distance(finishedStart, finishedEnd) < superBrushClickDistance()) {
    const clickTargets = targetsForSuperBrushClick(finishedEnd);
    pendingBrush = clickTargets.length > 0
      ? {
          strokes: pendingBrush?.strokes || [],
          annotations: pendingBrush?.annotations || [],
          selectionTargets: mergeSuperBrushTargets(pendingBrush?.selectionTargets, clickTargets),
          capturedSnapshotId: pendingBrush?.capturedSnapshotId,
          selectionBox: mergedSelectionBox(pendingBrush?.selectionBox, selectionBoxFromTargets(clickTargets)),
        }
      : pendingBrush;
    if (pendingBrush && hasMeaningfulSuperBrushContext(pendingBrush)) {
      notice = superBrushRecordedNotice();
    } else {
      pendingBrush = undefined;
      notice = "超级画笔标记太短；请拖动画一笔，或单击对象追加目标。";
    }
  } else if (pendingBrush && !hasMeaningfulSuperBrushContext(pendingBrush)) {
    pendingBrush = undefined;
    notice = "超级画笔标记太短；请拖动画一笔，或单击对象追加目标。";
  }
  currentStrokePoints = [];
  renderAll();
}

function openSuperBrushTaskDialog(): void {
  if (!pendingBrush || !hasMeaningfulSuperBrushContext(pendingBrush)) {
    notice = "请先用超级画笔至少画一笔，再确认画笔。";
    renderAll();
    return;
  }
  superBrushTaskDialogOpen = true;
  superBrushTaskError = "";
  superBrushTaskInput.value = "";
  notice = "填写这次超级画笔任务，排队后会恢复编辑界面。";
  renderAll();
  superBrushTaskInput.focus();
}

function closeSuperBrushTaskDialog(): void {
  if (!superBrushTaskDialogOpen) return;
  superBrushTaskDialogOpen = false;
  superBrushTaskError = "";
  notice = "已返回超级画笔，可以继续补画或确认。";
  renderAll();
  renderer.canvas().focus();
}

function queueSuperBrushTaskFromDialog(): void {
  const draft = pendingBrush;
  const userText = superBrushTaskInput.value.trim();
  if (!draft || !hasMeaningfulSuperBrushContext(draft)) {
    superBrushTaskError = "画笔上下文已经为空，请返回重新绘制。";
    renderAll();
    return;
  }
  if (!userText) {
    superBrushTaskError = "请先描述这次超级画笔要让 AI 改什么。";
    superBrushTaskInput.focus();
    renderAll();
    return;
  }

  const result = createTaskFromSuperBrush({ userText, draft });
  if (!result.ok) {
    superBrushTaskError = result.error;
    superBrushTaskInput.focus();
    renderAll();
    return;
  }

  store.upsertTask(result.value);
  previewTaskId = result.value.id;
  pendingBrush = undefined;
  currentStrokePoints = [];
  drawingBrush = false;
  drawingBrushPointerId = undefined;
  brushStartPoint = undefined;
  superBrushTaskDialogOpen = false;
  superBrushTaskError = "";
  superBrushTaskInput.value = "";
  activeTool = "select";
  markProjectDirty("超级画笔任务已排队");
  notice = "超级画笔任务已排队。";
  renderAll();
}

function cancelSuperBrushSession(): void {
  if (!isSuperBrushModeActive() && !pendingBrush && !drawingBrush && currentStrokePoints.length === 0) {
    notice = "没有待取消的超级画笔上下文。";
    renderAll();
    return;
  }
  drawingBrush = false;
  drawingBrushPointerId = undefined;
  brushStartPoint = undefined;
  currentStrokePoints = [];
  pendingBrush = undefined;
  superBrushTaskDialogOpen = false;
  superBrushTaskError = "";
  superBrushTaskInput.value = "";
  activeTool = "select";
  notice = "已取消超级画笔，编辑界面已恢复。";
  renderAll();
}

function undoLastSuperBrushStrokeOrCancel(): void {
  if (drawingBrush) {
    drawingBrush = false;
    drawingBrushPointerId = undefined;
    brushStartPoint = undefined;
    currentStrokePoints = [];
    notice = "已取消当前这一笔。";
    renderAll();
    return;
  }
  if (!pendingBrush || pendingBrush.strokes.length <= 1) {
    cancelSuperBrushSession();
    return;
  }
  pendingBrush = {
    ...pendingBrush,
    strokes: pendingBrush.strokes.slice(0, -1),
  };
  notice = `已撤销上一笔：${summarizeSuperBrushDraft(pendingBrush)}。`;
  renderAll();
}

function finishSelectionBox(event: PointerEvent): void {
  if (!selectionBoxDrag) return;
  const finished = selectionBoxDrag;
  selectionBoxDrag = undefined;
  releaseCanvasPointer(event.pointerId);
  if (!finished.moved) {
    selectedId = "";
    selectedIds = [];
    selectionArea = undefined;
    notice = "已清空选择；任务会作为全局任务排队。";
    renderAll();
    return;
  }

  const rect = rectFromPoints(finished.start, finished.current);
  const targets = renderer.targetsInRect(world, rect);
  const entityIds = uniqueEntityIds(targets.map((target) => target.entity.id as EntityId));
  selectionArea = rect;
  selectedIds = entityIds;
  selectedId = entityIds[0] || "";
  selectedPart = "body";
  notice = entityIds.length
    ? `已框选 ${entityIds.length} 个本体；任务会作用于这些对象。`
    : "已框选空白区域；任务会作用于这个区域。";
  renderAll();
}

function finishShapeDrag(event: PointerEvent): void {
  if (!shapeDrag) return;
  const finished = shapeDrag;
  shapeDrag = undefined;
  releaseCanvasPointer(event.pointerId);
  if (world.mode !== "editorFrozen") {
    notice = "运行中不能创建本体，请先冻结编辑。";
    renderAll();
    return;
  }

  const entity = createEntityFromShapeDrag(finished);
  if (!entity) {
    notice = "轮廓点太少，未创建本体。";
    renderAll();
    return;
  }
  applyCreatedEntity(entity, `创建${toolLabel(finished.tool)}本体：${entity.displayName}`);
}

function finishPolygonDraft(): void {
  if (!polygonDraft?.points.length) {
    notice = "请先点击至少 3 个顶点。";
    renderAll();
    return;
  }
  if (world.mode !== "editorFrozen") {
    notice = "运行中不能创建本体，请先冻结编辑。";
    renderAll();
    return;
  }
  if (polygonDraft.points.length < 3) {
    notice = "多边形至少需要 3 个顶点。";
    renderAll();
    return;
  }
  const entity = createPolygonEntityFromWorldPoints(polygonDraft.points, "多边形本体", ["实体", "多边形碰撞"]);
  polygonDraft = undefined;
  if (!entity) {
    notice = "多边形面积太小，未创建本体。";
    renderAll();
    return;
  }
  applyCreatedEntity(entity, `创建多边形本体：${entity.displayName}`);
}

function applyCreatedEntity(entity: Entity, diffSummary: string): void {
  const patches: ProjectPatch[] = [
    {
      op: "set",
      path: `/scenes/${scene.id}/entities/${entity.id}` as ProjectPatch["path"],
      value: entity,
    },
  ];
  const inversePatches: ProjectPatch[] = [
    {
      op: "delete",
      path: `/scenes/${scene.id}/entities/${entity.id}` as ProjectPatch["path"],
    },
  ];
  const folder = scene.folders[0];
  if (folder) {
    const previousFolders = cloneJson(scene.folders);
    const nextFolders = cloneJson(scene.folders);
    const targetFolder = nextFolders.find((item) => item.id === folder.id);
    if (targetFolder && !targetFolder.entityIds.includes(entity.id)) targetFolder.entityIds.push(entity.id);
    entity.folderId = folder.id;
    patches.push({ op: "set", path: `/scenes/${scene.id}/folders` as ProjectPatch["path"], value: nextFolders });
    inversePatches.push({ op: "set", path: `/scenes/${scene.id}/folders` as ProjectPatch["path"], value: previousFolders });
  }

  const transaction = store.createTransaction({
    actor: "user",
    patches,
    inversePatches,
    diffSummary,
  });
  const result = store.apply(transaction);
  if (!result.ok) {
    notice = `创建本体失败：${result.error}`;
    syncWorldFromStore();
    renderAll();
    return;
  }
  syncWorldFromStore();
  selectedId = entity.id;
  selectedIds = [entity.id];
  selectedPart = "body";
  selectionArea = undefined;
  activeTool = "select";
  markProjectDirty("已创建本体");
  notice = `已创建 ${entity.displayName}。`;
  renderAll();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape" && isSuperBrushModeActive()) {
    event.preventDefault();
    if (superBrushTaskDialogOpen) closeSuperBrushTaskDialog();
    else cancelSuperBrushSession();
    return;
  }
  if (activeTool === "polygon" && polygonDraft?.points.length && !isTypingTarget(event.target)) {
    if (event.key === "Enter") {
      event.preventDefault();
      finishPolygonDraft();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      polygonDraft = undefined;
      notice = "多边形绘制已取消。";
      renderAll();
      return;
    }
  }
  if (event.key === "Escape" && contextMenu && !isTypingTarget(event.target)) {
    event.preventDefault();
    contextMenu = undefined;
    renderAll();
    return;
  }
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
  if (world.mode === "game") {
    windowMenuOpen = false;
    contextMenu = undefined;
  }
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
    selectedPart = "body";
    selectedIds = selectedId ? [selectedId as EntityId] : [];
    selectionArea = undefined;
    previewTaskId = "";
    resetTaskUiEvidence();
    drawingBrush = false;
    drawingBrushPointerId = undefined;
    brushStartPoint = undefined;
    pendingBrush = undefined;
    superBrushTaskDialogOpen = false;
    superBrushTaskError = "";
    superBrushTaskInput.value = "";
    currentStrokePoints = [];
    canvasDrag = undefined;
    shapeDrag = undefined;
    polygonDraft = undefined;
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
  autoSave.markDirty(reason);
}

async function flushAutoSaveNow(): Promise<boolean> {
  return autoSave.flushNow();
}

async function refreshProjectFromDisk(): Promise<void> {
  const flushed = await flushAutoSaveNow();
  if (!flushed) {
    notice = "请先结束当前拖动或画笔操作，然后再从磁盘刷新。";
    autoSave.setStatus("自动保存等待当前操作结束");
    renderAll();
    return;
  }
  try {
    const result = await loadProjectForEditor();
    if (!result.project) {
      notice = result.notice;
      autoSave.setStatus("磁盘没有可载入项目");
      renderAll();
      return;
    }
    store.replace(normalizeProjectDefaults(repairKnownStarterLabels(result.project)));
    rebuildWorldFromStore();
    selectedId = Object.keys(scene.entities)[0] || "";
    selectedPart = "body";
    selectedIds = selectedId ? [selectedId as EntityId] : [];
    selectionArea = undefined;
    previewTaskId = "";
    resetTaskUiEvidence();
    drawingBrush = false;
    drawingBrushPointerId = undefined;
    brushStartPoint = undefined;
    pendingBrush = undefined;
    superBrushTaskDialogOpen = false;
    superBrushTaskError = "";
    superBrushTaskInput.value = "";
    currentStrokePoints = [];
    canvasDrag = undefined;
    shapeDrag = undefined;
    polygonDraft = undefined;
    autoSave.reset("已从磁盘刷新，自动保存就绪");
    notice = `已从磁盘刷新。${result.notice}`;
  } catch (error) {
    notice = `刷新失败：${error instanceof Error ? error.message : String(error)}`;
  }
  renderAll();
}

function saveDirtyProjectLocallyNow(): void {
  autoSave.saveDirtyLocallyNow();
}

function resetTaskUiEvidence(): void {
  Object.keys(aiTraceByTask).forEach((taskId) => {
    delete aiTraceByTask[taskId];
  });
  taskSummaries.reset();
}

async function runTimingSweepDemo(): Promise<void> {
  const { planScriptedReaction } = await import("../testing/timingSweep");
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
  const executor = await getAiExecutor();
  const sweep = executor.runReactionWindowSweep({
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
  taskSummaries.setSweep(
    sweep.value.cases
      .map((item) => `${item.defenseOffset}\t${item.status}\t${expectedStatuses.get(item.defenseOffset) || "unknown"}\t${item.label}`)
      .join("\n"),
  );
  notice =
    mismatchedCount > 0
      ? `时间轴扫描发现 ${mismatchedCount} 个异常偏移，请检查震刀窗口。`
      : `时间轴扫描正常：震刀窗口 ${acceptedOffsets || "无"}，窗口外输入已正确排除。`;
  renderAll();
}

async function runScriptedTimelineDemo(): Promise<void> {
  const { runScriptedReactionPlan } = await import("../testing/timingSweep");
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

  taskSummaries.setScriptedRun(JSON.stringify(scriptedRunSummary(result.value)));
  notice =
    result.value.status === "passed"
      ? `脚本测试通过：AI 计算命中 tick ${result.value.plan.impactFrame}，在 tick ${result.value.plan.defenseInputFrame} 预输入震刀。`
      : `脚本测试未通过：AI 计算命中 tick ${result.value.plan.impactFrame}，请查看任务面板里的脚本摘要。`;
  renderAll();
}

async function runAutonomousTestDemo(): Promise<void> {
  const { runAutonomousTestSuite } = await import("../testing/autonomousTesting");
  const frozenSnapshot = world.freezeForInspection();
  store.recordRuntimeSnapshot(frozenSnapshot);
  const report = runAutonomousTestSuite({
    scene,
    initialSnapshot: frozenSnapshot,
    traceLimit: 120,
  });

  recordAutonomousSuite(report);
  markProjectDirty("自测记录已更新");

  taskSummaries.clearAutonomousRound();
  taskSummaries.setAutonomousSuite(JSON.stringify(autonomousSuiteSummary(report)));
  notice =
    report.status === "passed"
      ? `AI自测通过：${report.cases.length} 个用例，已从冻结现场收集日志。`
      : `AI自测发现 ${report.cases.filter((testCase) => testCase.status === "failed").length} 个失败，已生成测试失败任务。`;
  renderAll();
}

async function runAutonomousRound(): Promise<void> {
  const autonomySnapshot = world.freezeForInspection();
  const autonomyLoop = await getAutonomyLoop();
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
  const autonomousRound = taskSummaries.nextAutonomousRoundNumber();
  taskSummaries.setAutonomousSuite(JSON.stringify(autonomySuite));
  taskSummaries.setAutonomousRound(autonomousRoundSummaryFromCycle({
    round: autonomousRound,
    cycle: autonomyValue,
    translateEvidence: aiEvidenceText,
  }));
  markProjectDirty("自治轮次已更新");
  notice = `AI自治第 ${autonomousRound} 轮完成：${autonomyValue.run.decisionSummary}`;
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
  taskSummaries.setMaintenance(JSON.stringify(maintenanceSummary(report, "preview")));
  notice = `清理预览：可清理 ${report.deletedSnapshotIds.length} 个快照，约 ${formatKb(report.reclaimedApproxBytes)}。`;
  renderAll();
}

function runManualProjectMaintenance(): void {
  const report = store.runProjectMaintenance(manualMaintenanceOptions());
  markProjectDirty("项目维护已更新");
  taskSummaries.setMaintenance(JSON.stringify(maintenanceSummary(report, "manual")));
  notice =
    report.deletedSnapshotIds.length > 0
      ? `已清理 ${report.deletedSnapshotIds.length} 个旧快照，约 ${formatKb(report.reclaimedApproxBytes)}。`
      : "没有需要清理的旧快照。";
  renderAll();
}

function runScheduledProjectMaintenance(): void {
  if (document.hidden || drawingBrush || Boolean(canvasDrag) || Boolean(shapeDrag) || Boolean(polygonDraft)) return;
  const report = store.runProjectMaintenance({
    orphanSnapshotAgeMs: 30 * 60 * 1000,
    maxSnapshotAgeMs: 24 * 60 * 60 * 1000,
    maxSnapshots: 240,
    minSnapshotsToKeep: 80,
    prunePassedTestSnapshots: false,
  });
  if (report.deletedSnapshotIds.length === 0 && report.updatedRecordIds.length === 0) return;
  markProjectDirty("后台维护已更新");
  taskSummaries.setMaintenance(JSON.stringify(maintenanceSummary(report, "auto")));
  notice = `后台清理完成：${report.deletedSnapshotIds.length} 个旧快照。`;
  renderAll();
}

function renderAll(): void {
  const projectSnapshot = store.snapshot().project;
  renderCanvasNow(projectSnapshot);
  renderUi(projectSnapshot);
}

function renderCanvasNow(projectSnapshot?: Project): void {
  const renderStarted = performance.now();
  const snapshotProject = projectSnapshot || store.snapshot().project;
  const showEditorOverlays = world.mode !== "game";
  renderer.render(world, {
    selectedId: showEditorOverlays ? selectedId : undefined,
    selectedIds: showEditorOverlays ? currentSelectedEntityIds() : undefined,
    selectedPart: showEditorOverlays ? selectedPart : undefined,
    showBodyMaterial: showEditorOverlays,
    showEditorDecorations: showEditorOverlays,
    previewTask: showEditorOverlays ? currentPreviewTask(snapshotProject) : undefined,
    liveBrush: showEditorOverlays ? liveBrushContext() : undefined,
    shapeDraft: showEditorOverlays ? liveShapeDraft() : undefined,
    resources: snapshotProject.resources,
    animationTimeMs: world.mode === "game" ? world.clock.timeMs : performance.now(),
  });
  editorPerformance.recordRender(renderStarted, renderer.performanceStats());
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
  if (world.mode === "game" || canvasDirty || editorPerformance.shouldRenderAnimationFrame(time, animatedResourcePresent)) renderCanvasNow();
  raf = requestAnimationFrame(loop);
}

function superBrushUiState(): "idle" | "armed" | "drawing" | "pending" | "task" {
  if (superBrushTaskDialogOpen) return "task";
  if (drawingBrush) return "drawing";
  if (pendingBrush && hasMeaningfulSuperBrushContext(pendingBrush)) return "pending";
  return activeTool === "superBrush" ? "armed" : "idle";
}

function isSuperBrushModeActive(): boolean {
  return activeTool === "superBrush" || drawingBrush || Boolean(pendingBrush) || superBrushTaskDialogOpen;
}

function superBrushPointerText(): string {
  const base = `工具：${toolLabel(activeTool)}`;
  if (drawingBrush) return `${base} · 正在记录第 ${(pendingBrush?.strokes.length || 0) + 1} 笔`;
  if (pendingBrush && hasMeaningfulSuperBrushContext(pendingBrush)) return `${base} · ${summarizeSuperBrushDraft(pendingBrush)}`;
  if (activeTool === "superBrush") return `${base} · 拖动画笔或单击对象`;
  return base;
}

function superBrushSummaryText(): string {
  if (superBrushTaskDialogOpen && pendingBrush) return `已确认：${summarizeSuperBrushDraft(pendingBrush)}`;
  if (drawingBrush) return `正在记录第 ${(pendingBrush?.strokes.length || 0) + 1} 笔；右键取消当前笔。`;
  if (pendingBrush && hasMeaningfulSuperBrushContext(pendingBrush)) return `${summarizeSuperBrushDraft(pendingBrush)}；右键撤销上一笔。`;
  if (activeTool === "superBrush") return "拖动画布开始标记，右键撤销上一笔。";
  return "拖动画布开始标记";
}

function renderUi(projectSnapshot?: Project): void {
  const snapshotProject = projectSnapshot || store.snapshot().project;
  renderTree(snapshotProject);
  renderTasks(snapshotProject);
  renderInspector(snapshotProject);
  renderResources(snapshotProject);
  renderOutput();
  renderFrame();
  renderContextMenu();
  renderMinimizedTray();
  const windowMenuButton = root.querySelector<HTMLButtonElement>('[data-action="toggle-window-menu"]');
  windowMenuButton?.setAttribute("aria-haspopup", "menu");
  windowMenuButton?.setAttribute("aria-controls", "v2-window-menu");
  windowMenuButton?.setAttribute("aria-expanded", String(windowMenuOpen));
  const windowMenu = root.querySelector<HTMLElement>('[data-role="window-menu"]');
  windowMenu?.setAttribute("aria-hidden", String(!windowMenuOpen));
  root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    const isActive = parseToolId(button.dataset.tool) === activeTool;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open-panel]").forEach((button) => {
    const panel = button.dataset.openPanel as PanelId | undefined;
    const state = panel ? panelLayout.panelState[panel] : "closed";
    const isFront = Boolean(panel && panelLayout.frontPanel() === panel);
    button.dataset.panelState = state;
    button.dataset.panelFront = isFront ? "true" : "false";
    button.classList.toggle("is-open", state === "open");
    button.classList.toggle("is-minimized", state === "minimized");
    button.classList.toggle("is-front", isFront);
    button.setAttribute("role", "menuitemcheckbox");
    button.setAttribute("aria-checked", String(state === "open"));
    button.setAttribute("aria-current", isFront ? "true" : "false");
  });
  root.querySelectorAll<HTMLButtonElement>("[data-surface-target]").forEach((button) => {
    const target = button.dataset.surfaceTarget;
    const isActive = target === activeSurface;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(isActive));
  });
  root.querySelectorAll<HTMLElement>(".v2-panel[data-panel]").forEach((panel) => {
    const panelId = panel.dataset.panel as PanelId | undefined;
    if (!panelId) return;
    panel.setAttribute("aria-hidden", String(panelLayout.panelState[panelId] !== "open"));
  });
  const mode = query<HTMLElement>('[data-role="mode"]');
  mode.textContent = world.mode === "game" ? "游戏运行" : "编辑冻结";
  mode.classList.toggle("is-running", world.mode === "game");
  mode.setAttribute("role", "status");
  mode.setAttribute("aria-label", `Runtime mode: ${mode.textContent || ""}`);
  const saveStatusNode = query<HTMLElement>('[data-role="save-status"]');
  saveStatusNode.textContent = autoSave.status;
  saveStatusNode.setAttribute("role", "status");
  const pointerNode = query<HTMLElement>('[data-role="pointer"]');
  pointerNode.textContent = superBrushPointerText();
  pointerNode.setAttribute("aria-live", "polite");
  const noticeNode = query<HTMLElement>('[data-role="notice"]');
  noticeNode.textContent = notice;
  noticeNode.setAttribute("role", "status");
  noticeNode.setAttribute("aria-live", "polite");
  const polygonActions = query<HTMLElement>('[data-role="polygon-actions"]');
  polygonActions.hidden = !(activeTool === "polygon" && Boolean(polygonDraft?.points.length));
  polygonActions.setAttribute("aria-hidden", String(polygonActions.hidden));
  taskInput.placeholder = pendingBrush
    ? "描述这些画笔标记要让 AI 改什么"
    : "写给 AI 的任务";
  const brushSummary = superBrushSummaryText();
  const brushSummaryNode = query<HTMLElement>('[data-role="super-brush-summary"]');
  brushSummaryNode.textContent = brushSummary;
  const confirmBrushButton = root.querySelector<HTMLButtonElement>('[data-action="confirm-super-brush"]');
  if (confirmBrushButton) confirmBrushButton.disabled = drawingBrush || !pendingBrush || !hasMeaningfulSuperBrushContext(pendingBrush);
  const brushTaskModal = query<HTMLElement>('[data-role="super-brush-task-modal"]');
  brushTaskModal.hidden = !superBrushTaskDialogOpen;
  brushTaskModal.setAttribute("aria-hidden", String(!superBrushTaskDialogOpen));
  query<HTMLElement>('[data-role="super-brush-task-summary"]').textContent = brushSummary;
  query<HTMLElement>('[data-role="super-brush-task-error"]').textContent = superBrushTaskError;
  root.dataset.tool = activeTool;
  root.dataset.superBrushState = superBrushUiState();
  root.dataset.superBrushActive = String(isSuperBrushModeActive());
  root.dataset.scenePanel = panelLayout.panelState.scene;
  root.dataset.propertiesPanel = panelLayout.panelState.properties;
  root.dataset.assetsPanel = panelLayout.panelState.assets;
  root.dataset.libraryPanel = panelLayout.panelState.library;
  root.dataset.tasksPanel = panelLayout.panelState.tasks;
  root.dataset.outputPanel = panelLayout.panelState.output;
  root.dataset.windowMenu = windowMenuOpen ? "open" : "closed";
  root.dataset.runtimeMode = world.mode;
  root.dataset.activeSurface = activeSurface;
  applyPanelLayoutIfNeeded();
}

function applyPanelLayoutIfNeeded(): void {
  const signature = panelLayoutRenderSignature();
  if (uiRenderState.layout === signature) return;
  uiRenderState.layout = signature;
  panelLayout.applyPanelSizes();
}

function panelLayoutRenderSignature(): string {
  return panelLayout.layoutSignature();
}

function renderMinimizedTray(): void {
  const tray = query<HTMLElement>('[data-role="minimized-tray"]');
  const minimizedPanels = managedPanels.filter((panel) => panelLayout.panelState[panel] === "minimized");
  const signature = minimizedPanels.join("|");
  if (uiRenderState.minimizedTray === signature) return;
  uiRenderState.minimizedTray = signature;
  tray.hidden = minimizedPanels.length === 0;
  tray.setAttribute("aria-hidden", String(tray.hidden));
  tray.innerHTML = minimizedPanels
    .map(
      (panel) => `
        <button data-restore-panel="${panel}" type="button" title="恢复 ${escapeContextMenuHtml(panelLabel(panel))}" aria-label="Restore ${escapeContextMenuHtml(panelLabel(panel))}">
          ${escapeContextMenuHtml(panelLabel(panel))}
        </button>
      `,
    )
    .join("");
}

function renderContextMenu(): void {
  const menu = query<HTMLElement>('[data-role="context-menu"]');
  const signature = !contextMenu || world.mode === "game"
    ? "hidden"
    : `${contextMenu.x}|${contextMenu.y}|${contextMenu.title}|${contextMenu.entityId || ""}|${contextMenu.part || ""}|${contextMenu.items.map((item) => `${item.action}:${item.label}:${item.hint || ""}:${item.danger ? 1 : 0}:${item.disabled ? 1 : 0}:${item.separatorBefore ? 1 : 0}`).join("~")}`;
  if (uiRenderState.contextMenu === signature) return;
  uiRenderState.contextMenu = signature;
  if (!contextMenu || world.mode === "game") {
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");
    menu.innerHTML = "";
    return;
  }
  menu.hidden = false;
  menu.setAttribute("aria-hidden", "false");
  menu.setAttribute("aria-label", contextMenu.title);
  menu.style.left = `${contextMenu.x}px`;
  menu.style.top = `${contextMenu.y}px`;
  menu.innerHTML = `
    <header id="v2-context-menu-title">${escapeContextMenuHtml(contextMenu.title)}</header>
    <div class="v2-context-menu-list">
      ${contextMenu.items
        .map(
          (item) => `
            <button
              class="${item.danger ? "is-danger" : ""} ${item.separatorBefore ? "has-separator" : ""}"
              data-context-action="${item.action}"
              role="menuitem"
              type="button"
              aria-disabled="${item.disabled ? "true" : "false"}"
              ${item.disabled ? "disabled" : ""}
            >
              <span>${escapeContextMenuHtml(item.label)}</span>
              ${item.hint ? `<small>${escapeContextMenuHtml(item.hint)}</small>` : ""}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderFrame(): void {
  const text = `tick ${world.clock.frame} · ${(world.clock.timeMs / 1000).toFixed(2)}s · ${Math.round(1000 / world.clock.fixedStepMs)}t/s · ${editorPerformance.frameText}`;
  if (uiRenderState.frame === text) return;
  uiRenderState.frame = text;
  query<HTMLElement>('[data-role="frame"]').textContent = text;
}

function renderTree(projectSnapshot: Project): void {
  const signature = [scene.id, projectSnapshot.meta.updatedAt, selectedId, selectedPart, collapsedTreeSignature()].join("||");
  if (uiRenderState.tree === signature) return;
  uiRenderState.tree = signature;
  const tree = query<HTMLElement>('[data-role="tree"]');
  const entities = editableEntities();
  tree.innerHTML = renderSceneTreeHtml(scene, entities, selectedId, selectedPart, projectSnapshot.resources, collapsedTreeNodes);
  bindSceneTreeInteractions(tree, {
    onToggleNode: (nodeId) => {
      if (!nodeId) return;
      if (collapsedTreeNodes.has(nodeId)) {
        collapsedTreeNodes.delete(nodeId);
      } else {
        collapsedTreeNodes.add(nodeId);
      }
      renderAll();
    },
    onSelectEntity: (entityId, part) => {
      selectedId = entityId || selectedId;
      selectedPart = part;
      if (entityId) {
        selectedIds = [entityId as EntityId];
        selectionArea = undefined;
      }
      notice = part === "presentation" ? "当前可视体已选中。" : "世界本体已选中。";
      renderAll();
    },
    onMoveEntityToFolder: (entityId, folderId) => {
      moveEntityToFolder(entityId, folderId);
    },
    onOpenContextMenu: (target) => {
      const entity = editableEntity(target.entityId);
      if (!entity || world.mode === "game") return;
      selectedId = entity.id;
      selectedPart = target.part;
      selectedIds = [entity.id];
      selectionArea = undefined;
      showEntityContextMenu(entity, target.part, target.clientX, target.clientY);
    },
  });
}

function renderTasks(projectSnapshot: Project): void {
  const summarySignature = taskSummaries.signature();
  const signature = [projectSnapshot.meta.updatedAt, previewTaskId, aiTraceSignature(), summarySignature].join("||");
  if (uiRenderState.tasks === signature) return;
  uiRenderState.tasks = signature;
  const tasks = query<HTMLElement>('[data-role="tasks"]');
  tasks.innerHTML = renderTaskPanelHtml({
    project: projectSnapshot,
    previewTaskId,
    aiTraceByTask,
    summaries: taskSummaries.summaries(),
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

function renderInspector(projectSnapshot: Project): void {
  const signature = [projectSnapshot.meta.updatedAt, selectedId, selectedPart].join("||");
  if (uiRenderState.inspector === signature) return;
  uiRenderState.inspector = signature;
  const inspector = query<HTMLElement>('[data-role="inspector"]');
  const entity = editableEntity(selectedId);
  inspector.innerHTML = renderInspectorHtml(entity, selectedPart, projectSnapshot.resources);
  bindInspectorInteractions(inspector);
}

function bindInspectorInteractions(inspector: HTMLElement): void {
  const button = inspector.querySelector<HTMLButtonElement>('[data-action="rename-entity-inline"]');
  const entityId = button?.dataset.entityId;
  const input = entityId ? inspector.querySelector<HTMLInputElement>(`[data-entity-name="${entityId}"]`) : null;
  button?.addEventListener("click", () => {
    if (entityId && input) renameEntityFromInput(entityId, input.value);
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    renameEntityFromInput(entityId || "", input.value);
  });
}

function renderResources(projectSnapshot: Project): void {
  const resourcesNode = query<HTMLElement>('[data-role="resources"]');
  const libraryNode = query<HTMLElement>('[data-role="resource-library"]');
  const selectedEntities = currentSelectedEntityIds()
    .map((entityId) => editableEntity(entityId))
    .filter((entity): entity is Entity => Boolean(entity));
  const resources = projectSnapshot.resources;
  const selectedSignature = [projectSnapshot.meta.updatedAt, currentSelectedEntityIds().join(",")].join("||");
  if (uiRenderState.resources !== selectedSignature) {
    uiRenderState.resources = selectedSignature;
    resourcesNode.innerHTML = renderResourcesHtml(selectedEntities, resources);
    bindResourceInteractions(resourcesNode);
  }
  const librarySignature = projectSnapshot.meta.updatedAt;
  if (uiRenderState.resourceLibrary !== librarySignature) {
    uiRenderState.resourceLibrary = librarySignature;
    libraryNode.innerHTML = renderResourceLibraryHtml(resources);
    bindResourceInteractions(libraryNode);
  }
}

function renderOutput(): void {
  outputLog.remember(notice);
  const signature = outputLog.signature();
  if (uiRenderState.output === signature) return;
  uiRenderState.output = signature;
  const output = query<HTMLElement>('[data-role="output"]');
  output.innerHTML = outputLog.renderHtml();
}

function bindResourceInteractions(resourcesNode: HTMLElement): void {
  resourcesNode.querySelector<HTMLButtonElement>('[data-action="resource-open-file"]')?.addEventListener("click", () => {
    resourceFileInput.click();
  });
  const pasteInput = resourcesNode.querySelector<HTMLInputElement>('[data-role="resource-paste-input"]');
  pasteInput?.addEventListener("keydown", (event) => {
    if (isPasteShortcut(event)) {
      scheduleLocalClipboardFileFallback();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    addResourceFromText(pasteInput.value);
    pasteInput.value = "";
  });
  pasteInput?.addEventListener("paste", (event) => {
    cancelLocalClipboardFileFallback();
    if (handleResourceClipboardPaste(event)) pasteInput.value = "";
  });
  resourcesNode.querySelectorAll<HTMLButtonElement>('[data-action="rename-resource"]').forEach((button) => {
    button.addEventListener("click", () => {
      const resourceId = button.dataset.resourceId as ResourceId | undefined;
      const row = button.closest<HTMLElement>("[data-resource-row]");
      const input = row?.querySelector<HTMLInputElement>("[data-resource-name]");
      if (resourceId && input) renameResource(resourceId, input.value);
    });
  });
  resourcesNode.querySelectorAll<HTMLInputElement>("[data-resource-name]").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const resourceId = input.dataset.resourceName as ResourceId | undefined;
      if (resourceId) renameResource(resourceId, input.value);
    });
  });
  resourcesNode.querySelectorAll<HTMLButtonElement>('[data-action="save-resource-description"]').forEach((button) => {
    button.addEventListener("click", () => {
      const resourceId = button.dataset.resourceId as ResourceId | undefined;
      const input = resourceId ? resourcesNode.querySelector<HTMLInputElement>(`[data-resource-description="${resourceId}"]`) : null;
      if (resourceId && input) saveResourceDescription(resourceId, input.value);
    });
  });
  resourcesNode.querySelectorAll<HTMLButtonElement>('[data-action="save-resource-animation"]').forEach((button) => {
    button.addEventListener("click", () => {
      const resourceId = button.dataset.resourceId as ResourceId | undefined;
      const row = button.closest<HTMLElement>("[data-resource-row]");
      if (resourceId && row) saveResourceAnimation(resourceId, row);
    });
  });
  resourcesNode.querySelectorAll<HTMLButtonElement>('[data-action="clear-resource-animation"]').forEach((button) => {
    button.addEventListener("click", () => {
      const resourceId = button.dataset.resourceId as ResourceId | undefined;
      if (resourceId) clearResourceAnimation(resourceId);
    });
  });
}

function onTaskInputPaste(event: ClipboardEvent): void {
  cancelLocalClipboardFileFallback();
  handleResourceClipboardPaste(event);
}

function onResourcePasteKeyDown(event: KeyboardEvent): void {
  if (isPasteShortcut(event)) scheduleLocalClipboardFileFallback();
}

function isPasteShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && !event.altKey;
}

function cancelLocalClipboardFileFallback(): void {
  localClipboardFallbackToken += 1;
}

function scheduleLocalClipboardFileFallback(): void {
  const token = ++localClipboardFallbackToken;
  window.setTimeout(() => {
    if (token !== localClipboardFallbackToken) return;
    void importLocalClipboardResources({ silentEmpty: true });
  }, 120);
}

function handleResourceClipboardPaste(event: ClipboardEvent): boolean {
  const files = clipboardResourceFiles(event.clipboardData);
  if (files.length > 0) {
    event.preventDefault();
    void importResourceFiles(files);
    return true;
  }

  const text = clipboardResourceText(event.clipboardData).trim();
  if (looksLikeExternalResource(text)) {
    event.preventDefault();
    addResourceFromText(text);
    return true;
  }

  if (shouldTryLocalClipboardFiles(event.clipboardData)) {
    event.preventDefault();
    void importLocalClipboardResources();
    return true;
  }

  return false;
}

function clipboardResourceFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  const addFile = (file: File | null) => {
    if (!file) return;
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  Array.from(data.files || []).forEach(addFile);
  Array.from(data.items || []).forEach((item) => {
    if (item.kind === "file") addFile(item.getAsFile());
  });
  return files;
}

function clipboardResourceText(data: DataTransfer | null): string {
  if (!data) return "";
  return data.getData("text/plain") || data.getData("text/uri-list") || "";
}

function shouldTryLocalClipboardFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  const types = Array.from(data.types || []).map((type) => type.toLowerCase());
  return types.length === 0 || types.some((type) => type === "files");
}

async function importResourceFiles(files: File[]): Promise<void> {
  const supported = files;
  if (supported.length === 0) {
    notice = "没有从剪贴板或文件选择中读取到可用资源。";
    renderAll();
    return;
  }
  const imported: ImportedFileResource[] = [];
  for (let index = 0; index < supported.length; index += 1) {
    const file = supported[index];
    const dataUrl = await readFileAsDataUrl(file);
    imported.push({ file, dataUrl, index });
  }
  addImportedResources(resourceMetadataForImportedFiles(imported));
}

async function importLocalClipboardResources(options: { silentEmpty?: boolean } = {}): Promise<void> {
  let payload: LocalClipboardFilesResponse | undefined;
  try {
    const response = await fetch("/api/v2/clipboard-files", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WebHachimi-Clipboard-Read": "1" },
      body: "{}",
    });
    if (!response.ok) return;
    payload = await response.json() as LocalClipboardFilesResponse;
  } catch {
    return;
  }

  const files = payload?.files || [];
  if (files.length === 0) {
    let didSetNotice = false;
    if (payload?.skipped?.length) {
      notice = `剪贴板文件未导入：${payload.skipped.map((item) => item.fileName || item.reason).join("、")}`;
      didSetNotice = true;
    } else if (payload?.error) {
      notice = `剪贴板文件读取失败：${payload.error}`;
      didSetNotice = true;
    } else if (payload?.ok && !options.silentEmpty) {
      notice = "剪贴板里没有可导入文件。";
      didSetNotice = true;
    }
    if (didSetNotice) renderAll();
    return;
  }

  const imported = files.map((file, index) => ({
    file: { name: file.fileName, type: file.mime },
    dataUrl: file.path,
    index,
  }));
  addImportedResources(resourceMetadataForImportedFiles(imported));
}

function addResourceFromText(rawText: string): void {
  const metadata = resourceImportMetadataFromText(rawText);
  if (!metadata) {
    notice = "请先粘贴资源地址、data URL 或资源说明。";
    renderAll();
    return;
  }
  addImportedResource(metadata);
}

function addImportedResources(inputs: ResourceImportMetadata[]): void {
  inputs.forEach(addImportedResource);
}

function resourceMetadataForImportedFiles(files: ImportedFileResource[]): ResourceImportMetadata[] {
  const grouped = new Map<string, ImportedFileResource[]>();
  const singles: ImportedFileResource[] = [];
  for (const item of files) {
    const key = isImageFileLike(item.file) ? sequenceGroupKeyFromFileName(item.file.name) : undefined;
    if (!key) {
      singles.push(item);
      continue;
    }
    const group = grouped.get(key.key) || [];
    group.push(item);
    grouped.set(key.key, group);
  }

  const metadata: ResourceImportMetadata[] = [];
  for (const group of grouped.values()) {
    if (group.length >= 2) {
      metadata.push(resourceImportMetadataFromSequence(group));
    } else {
      singles.push(group[0]);
    }
  }
  singles.sort((left, right) => left.index - right.index);
  metadata.push(...singles.map((item) => resourceImportMetadataFromFile(item.file, item.dataUrl, item.index)));
  return metadata;
}

function addImportedResource(input: ResourceImportMetadata): void {
  const resourceId = makeId<"ResourceId">("res") as ResourceId;
  const attachments = input.attachments || (input.path
    ? [{
        fileName: input.fileName,
        mime: input.mime,
        path: input.path,
      }]
    : []);
  const resource: Resource = {
    id: resourceId,
    internalName: uniqueResourceInternalName(input.displayName),
    displayName: input.displayName || "未命名资源",
    type: input.type,
    description: input.description,
    tags: resourceTagsForType(input.type),
    attachments: attachments.map((attachment) => ({
      id: makeId<"ResourceAttachmentId">("att"),
      fileName: attachment.fileName,
      mime: attachment.mime,
      path: attachment.path,
    })),
    sprite: input.sprite ? cloneJson(input.sprite) : undefined,
  };
  const entity = editableEntity(selectedId);
  const patches: ProjectPatch[] = [{ op: "set", path: `/resources/${resource.id}` as ProjectPatch["path"], value: resource }];
  const inversePatches: ProjectPatch[] = [{ op: "delete", path: `/resources/${resource.id}` as ProjectPatch["path"] }];

  if (entity && isVisualResourceType(input.type)) {
    const bound = bindResourceToEntityPlan(entity, resource, input.description);
    patches.push(...bound.patches);
    inversePatches.push(...bound.inversePatches);
  }

  const transaction = store.createTransaction({
    actor: "user",
    patches,
    inversePatches,
    diffSummary: entity && isVisualResourceType(input.type)
      ? `添加资源并替换 ${entity.displayName} 的当前可视体`
      : `添加资源 ${resource.displayName}`,
  });
  const result = store.apply(transaction);
  if (!result.ok) {
    notice = `资源添加失败：${result.error}`;
    renderAll();
    return;
  }
  if (entity && isVisualResourceType(input.type)) {
    selectedId = entity.id;
    selectedPart = "presentation";
    selectedIds = [entity.id as EntityId];
    selectionArea = undefined;
  }
  syncWorldFromStore();
  markProjectDirty("资源已添加");
  notice = entity && isVisualResourceType(input.type)
    ? `已添加 ${resource.displayName}，并替换当前可视体。`
    : `已添加资源 ${resource.displayName}。`;
  renderAll();
}

function bindResourceToEntityPlan(entity: Entity, resource: Resource, description: string): { patches: ProjectPatch[]; inversePatches: ProjectPatch[] } {
  const storedEntity = scene.entities[entity.id];
  const previousResources = cloneJson(storedEntity.resources || []);
  const previousRender = storedEntity.render ? cloneJson(storedEntity.render) : undefined;
  const bodySize = bodyVisualSize(storedEntity);
  const binding: ResourceBinding = {
    resourceId: resource.id,
    slot: "current",
    description,
    localOffset: { x: 0, y: 0 },
    localRotation: 0,
    localScale: { x: 1, y: 1 },
  };
  const nextResources = [
    ...previousResources.filter((item) => item.slot !== "current" && item.resourceId !== resource.id),
    binding,
  ];
  const nextRender = {
    ...(storedEntity.render || {
      visible: true,
      color: "#ffffff",
      opacity: 1,
      layerId: "world",
    }),
    visible: true,
    color: "#ffffff",
    opacity: storedEntity.render?.opacity ?? 1,
    layerId: storedEntity.render?.layerId || "world",
    size: bodySize,
    offset: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    slot: "current",
    state: "current",
    resourceId: resource.id,
  };
  const resourcesPath = `/scenes/${scene.id}/entities/${storedEntity.id}/resources` as ProjectPatch["path"];
  const renderPath = `/scenes/${scene.id}/entities/${storedEntity.id}/render` as ProjectPatch["path"];
  return {
    patches: [
      { op: "set", path: resourcesPath, value: nextResources },
      { op: "set", path: renderPath, value: nextRender },
    ],
    inversePatches: [
      { op: "set", path: resourcesPath, value: previousResources },
      previousRender ? { op: "set", path: renderPath, value: previousRender } : { op: "delete", path: renderPath },
    ],
  };
}

function saveResourceDescription(resourceId: ResourceId, rawDescription: string): void {
  const description = rawDescription.trim();
  const projectSnapshot = store.snapshot().project;
  const resource = projectSnapshot.resources[resourceId];
  if (!resource) {
    notice = "资源已经不存在。";
    renderAll();
    return;
  }
  if (!description) {
    notice = "资源描述不能为空。";
    renderAll();
    return;
  }
  const nextResource: Resource = {
    ...cloneJson(resource),
    description,
    tags: uniqueStrings([...resource.tags, "待AI处理"]),
  };
  const patches: ProjectPatch[] = [{ op: "set", path: `/resources/${resourceId}` as ProjectPatch["path"], value: nextResource }];
  const inversePatches: ProjectPatch[] = [{ op: "set", path: `/resources/${resourceId}` as ProjectPatch["path"], value: cloneJson(resource) }];
  const bindingOwners = currentSelectedEntityIds()
    .map((entityId) => editableEntity(entityId))
    .filter((entity): entity is Entity => Boolean(entity?.resources.some((binding) => binding.resourceId === resourceId)));
  for (const entity of bindingOwners) {
    const previousBindings = cloneJson(entity.resources);
    const nextBindings = entity.resources.map((binding) =>
      binding.resourceId === resourceId ? { ...cloneJson(binding), description } : cloneJson(binding),
    );
    const bindingsPath = `/scenes/${scene.id}/entities/${entity.id}/resources` as ProjectPatch["path"];
    patches.push({ op: "set", path: bindingsPath, value: nextBindings });
    inversePatches.push({ op: "set", path: bindingsPath, value: previousBindings });
  }
  const transaction = store.createTransaction({
    actor: "user",
    patches,
    inversePatches,
    diffSummary: `保存资源描述：${resource.displayName}`,
  });
  const applyResult = store.apply(transaction);
  if (!applyResult.ok) {
    notice = `资源描述保存失败：${applyResult.error}`;
    renderAll();
    return;
  }
  const taskResult = createTask({
    source: "user",
    title: `标注资源：${resource.displayName}`,
    userText: `资源“${resource.displayName}”的描述：${description}\n请在后续 AI 编辑和生成时按这条描述理解它。`,
    targetRefs: resourceTaskTargets(resourceId),
  });
  if (taskResult.ok) {
    store.upsertTask(taskResult.value);
    previewTaskId = taskResult.value.id;
  }
  syncWorldFromStore();
  markProjectDirty("资源描述已保存并排队");
  notice = taskResult.ok ? "资源描述已保存，已作为 AI 待处理任务排队。" : "资源描述已保存，但任务排队失败。";
  renderAll();
}

function saveResourceAnimation(resourceId: ResourceId, row: HTMLElement): void {
  const projectSnapshot = store.snapshot().project;
  const resource = projectSnapshot.resources[resourceId];
  if (!resource) {
    notice = "资源已经不存在。";
    renderAll();
    return;
  }
  if (!isVisualResourceType(resource.type) && imageAttachments(resource).length === 0) {
    notice = "只有图片资源可以配置序列图或宫格动画。";
    renderAll();
    return;
  }
  const mode = row.querySelector<HTMLSelectElement>("[data-resource-animation-mode]")?.value || "static";
  if (mode === "static") {
    clearResourceAnimation(resourceId);
    return;
  }

  const nextResource = cloneJson(resource);
  nextResource.type = "animation";
  if (mode === "sequence") {
    const frameCount = imageAttachments(resource).length;
    if (frameCount < 2) {
      notice = "PNG 序列至少需要 2 张图片。";
      renderAll();
      return;
    }
    nextResource.sprite = buildSequenceSpriteMetadata({
      frameCount,
      fps: numericInputValue(row, "fps", resource.sprite?.fps || 8),
      loop: checkboxInputValue(row, "loop", resource.sprite?.loop !== false),
    });
  } else {
    const columns = numericInputValue(row, "columns", resource.sprite?.columns || 4);
    const rows = numericInputValue(row, "rows", resource.sprite?.rows || 4);
    if (columns < 1 || rows < 1) {
      notice = "宫格动画需要有效的行数和列数。";
      renderAll();
      return;
    }
    nextResource.sprite = buildSheetSpriteMetadata({
      columns,
      rows,
      frameCount: numericInputValue(row, "frame-count", resource.sprite?.frameCount || columns * rows),
      fps: numericInputValue(row, "fps", resource.sprite?.fps || 8),
      loop: checkboxInputValue(row, "loop", resource.sprite?.loop !== false),
      frameWidth: optionalNumericInputValue(row, "frame-width"),
      frameHeight: optionalNumericInputValue(row, "frame-height"),
      margin: numericInputValue(row, "margin", resource.sprite?.margin || 0),
      spacing: numericInputValue(row, "spacing", resource.sprite?.spacing || 0),
    });
  }
  applyResourceUpdate(resource, nextResource, `配置资源动画：${resource.displayName}`, `已配置 ${resource.displayName} 的动画切帧。`);
}

function clearResourceAnimation(resourceId: ResourceId): void {
  const projectSnapshot = store.snapshot().project;
  const resource = projectSnapshot.resources[resourceId];
  if (!resource) {
    notice = "资源已经不存在。";
    renderAll();
    return;
  }
  const nextResource = cloneJson(resource);
  delete nextResource.sprite;
  if (nextResource.type === "sprite" || nextResource.type === "animation") nextResource.type = "image";
  applyResourceUpdate(resource, nextResource, `清除资源动画：${resource.displayName}`, `已把 ${resource.displayName} 改回静态资源。`);
}

function applyResourceUpdate(previousResource: Resource, nextResource: Resource, diffSummary: string, successNotice: string): void {
  const resourcePath = `/resources/${previousResource.id}` as ProjectPatch["path"];
  const transaction = store.createTransaction({
    actor: "user",
    patches: [{ op: "set", path: resourcePath, value: nextResource }],
    inversePatches: [{ op: "set", path: resourcePath, value: cloneJson(previousResource) }],
    diffSummary,
  });
  const applyResult = store.apply(transaction);
  if (!applyResult.ok) {
    notice = `资源更新失败：${applyResult.error}`;
    renderAll();
    return;
  }
  syncWorldFromStore();
  markProjectDirty(successNotice);
  notice = successNotice;
  renderAll();
}

function numericInputValue(row: HTMLElement, name: string, fallback: number): number {
  const value = Number(row.querySelector<HTMLInputElement>(`[data-resource-animation-${name}]`)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function optionalNumericInputValue(row: HTMLElement, name: string): number | undefined {
  const raw = row.querySelector<HTMLInputElement>(`[data-resource-animation-${name}]`)?.value.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function checkboxInputValue(row: HTMLElement, name: string, fallback: boolean): boolean {
  const input = row.querySelector<HTMLInputElement>(`[data-resource-animation-${name}]`);
  return input ? input.checked : fallback;
}

function resourceTaskTargets(resourceId: ResourceId): TargetRef[] {
  const targets: TargetRef[] = [{ kind: "resource", resourceId }];
  for (const target of currentTargets()) {
    if (target.kind === "resource" && target.resourceId === resourceId) continue;
    targets.push(target);
  }
  return targets;
}

function renameResource(resourceId: ResourceId, rawDisplayName: string): void {
  const projectSnapshot = store.snapshot().project;
  const resource = projectSnapshot.resources[resourceId];
  if (!resource) {
    notice = "资源已经不存在。";
    renderAll();
    return;
  }
  const planResult = planRenameResourceTransaction(projectSnapshot.resources, resource, rawDisplayName);
  if (!planResult.ok) {
    notice = `资源重命名未提交：${planResult.error}`;
    renderAll();
    return;
  }
  const transaction = store.createTransaction({
    actor: "user",
    patches: planResult.value.patches,
    inversePatches: planResult.value.inversePatches,
    diffSummary: planResult.value.diffSummary,
  });
  const applyResult = store.apply(transaction);
  if (!applyResult.ok) {
    notice = `资源重命名失败：${applyResult.error}`;
    renderAll();
    return;
  }
  syncWorldFromStore();
  markProjectDirty(planResult.value.notice);
  notice = planResult.value.notice;
  renderAll();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("file read failed")));
    reader.readAsDataURL(file);
  });
}

function uniqueResourceInternalName(displayName: string): string {
  const preferred = displayName.trim().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "") || "resource";
  const names = new Set(Object.values(store.snapshot().project.resources).map((resource) => resource.internalName));
  let candidate = preferred;
  let index = 2;
  while (names.has(candidate)) {
    candidate = `${preferred}_${index}`;
    index += 1;
  }
  return candidate;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isVisualResourceType(type: Resource["type"]): boolean {
  return type === "image" || type === "sprite" || type === "animation";
}

function sceneHasVisibleAnimatedResource(projectSnapshot: Project): boolean {
  const activeScene = projectSnapshot.scenes[projectSnapshot.activeSceneId];
  if (!activeScene) return false;
  for (const entity of Object.values(activeScene.entities)) {
    if (!entity.render || entity.render.visible === false) continue;
    const resourceId =
      entity.render.resourceId ||
      entity.resources.find((binding) => binding.slot === (entity.render?.slot || "current"))?.resourceId;
    const resource = resourceId ? projectSnapshot.resources[resourceId] : undefined;
    if (resource && resourceHasAnimation(resource)) return true;
  }
  return false;
}

function bodyVisualSize(entity: Entity): Vec2 {
  if (!entity.collider) return entity.render?.size || { x: 60, y: 60 };
  if (entity.collider.shape === "circle") {
    const diameter = (entity.collider.radius || Math.min(entity.collider.size.x, entity.collider.size.y) / 2) * 2;
    return { x: diameter, y: diameter };
  }
  return cloneJson(entity.collider.size);
}

function currentPreviewTask(projectSnapshot?: Project): Task | undefined {
  if (!previewTaskId) return undefined;
  return (projectSnapshot || store.snapshot().project).tasks[previewTaskId];
}

function liveBrushContext(): BrushContext | undefined {
  if (selectionBoxDrag) {
    return {
      strokes: [],
      annotations: [],
      targetEntityIds: currentSelectedEntityIds(),
      selectionBox: rectFromPoints(selectionBoxDrag.start, selectionBoxDrag.current),
    };
  }
  if (shapeDrag) {
    if (shapeDrag.tool === "leaf") return undefined;
    return {
      strokes: [],
      annotations: [],
      targetEntityIds: [],
      selectionBox: normalizedShapeRect(shapeDrag),
    };
  }
  if (selectionArea && !pendingBrush && !drawingBrush) {
    return {
      strokes: [],
      annotations: [],
      targetEntityIds: currentSelectedEntityIds(),
      selectionBox: selectionArea,
    };
  }
  const liveStrokeResult = createSuperBrushStroke(currentStrokePoints);
  if (drawingBrush || liveStrokeResult.ok) {
    const liveTargets = liveStrokeResult.ok
      ? targetsForCompletedSuperBrushStroke(currentStrokePoints)
      : mergeSuperBrushTargets(pendingBrush?.selectionTargets);
    const draft: SuperBrushDraft = {
      strokes: [...(pendingBrush?.strokes || []), ...(liveStrokeResult.ok ? [liveStrokeResult.value] : [])],
      annotations: pendingBrush?.annotations || [],
      selectionTargets: mergeSuperBrushTargets(pendingBrush?.selectionTargets, liveTargets),
      capturedSnapshotId: pendingBrush?.capturedSnapshotId,
      selectionBox: mergedSelectionBox(pendingBrush?.selectionBox, selectionBoxFromTargets(liveTargets)),
    };
    return hasMeaningfulSuperBrushContext(draft) ? createBrushContextFromSuperBrushDraft(draft) : undefined;
  }
  if (!pendingBrush) return undefined;
  return createBrushContextFromSuperBrushDraft(pendingBrush);
}

function liveShapeDraft(): ShapeDraftPreview | undefined {
  if (shapeDrag?.tool === "leaf" && shapeDrag.points.length > 1) {
    return { points: shapeDrag.points, closed: shapeDrag.points.length >= 3 };
  }
  if (polygonDraft?.points.length) {
    return { points: polygonDraft.points, closed: polygonDraft.points.length >= 3 };
  }
  return undefined;
}

function targetsForSuperBrushStroke(points: Vec2[]): TargetRef[] {
  if (points.length < 2) return currentTargets();
  const rect = rectFromStrokePoints(points, 12);
  const entityIds = uniqueEntityIds(strokeHitEntityIds(points));
  if (entityIds.length > 0) return entityIds.map((entityId) => ({ kind: "entity", entityId }));
  return [{ kind: "area", sceneId: scene.id, rect }];
}

function targetsForCompletedSuperBrushStroke(points: Vec2[]): TargetRef[] {
  return targetsForSuperBrushStroke(points);
}

function targetsForSuperBrushClick(point: Vec2): TargetRef[] {
  const picked = renderer.pickCanvasTarget(world, point, selectedId ? { entityId: selectedId, part: selectedPart } : undefined);
  if (picked) return [{ kind: "entity", entityId: picked.entity.id as EntityId }];
  return [];
}

function selectionBoxFromTargets(targets: TargetRef[]): Rect | undefined {
  return targets
    .filter((target): target is Extract<TargetRef, { kind: "area" }> => target.kind === "area")
    .map((target) => target.rect)
    .reduce<Rect | undefined>((box, rect) => mergedSelectionBox(box, rect), undefined);
}

function mergedSelectionBox(left: Rect | undefined, right: Rect | undefined): Rect | undefined {
  if (!left) return right;
  if (!right) return left;
  const minX = Math.min(left.x, right.x);
  const minY = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.w, right.x + right.w);
  const maxY = Math.max(left.y + left.h, right.y + right.h);
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function superBrushPointSpacing(): number {
  return Math.max(1.5, 4 / Math.max(renderer.viewportState().zoom, 0.1));
}

function superBrushClickDistance(): number {
  return Math.max(5, 8 / Math.max(renderer.viewportState().zoom, 0.1));
}

function superBrushRecordedNotice(): string {
  if (!pendingBrush) return "超级画笔已记录，请输入任务描述后排队。";
  return `超级画笔已记录：${summarizeSuperBrushDraft(pendingBrush)}。输入任务描述后排队。`;
}

function rectFromStrokePoints(points: Vec2[], padding = 0): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX - padding,
    y: minY - padding,
    w: Math.max(1, maxX - minX) + padding * 2,
    h: Math.max(1, maxY - minY) + padding * 2,
  };
}

function strokeHitEntityIds(points: Vec2[]): EntityId[] {
  const hitIds = new Set<EntityId>();
  for (const point of sampleStrokePoints(points, 10)) {
    const hitRect = { x: point.x - 12, y: point.y - 12, w: 24, h: 24 };
    for (const target of renderer.targetsInRect(world, hitRect)) {
      hitIds.add(target.entity.id as EntityId);
    }
  }
  return [...hitIds];
}

function sampleStrokePoints(points: Vec2[], step: number): Vec2[] {
  const samples: Vec2[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = Math.max(distance(start, end), 1);
    const count = Math.max(1, Math.ceil(length / step));
    for (let sampleIndex = 0; sampleIndex <= count; sampleIndex += 1) {
      const t = sampleIndex / count;
      samples.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      });
    }
  }
  return samples;
}

function currentTargets(): TargetRef[] {
  const entityIds = currentSelectedEntityIds();
  if (entityIds.length > 0) return entityIds.map((entityId) => ({ kind: "entity", entityId }));
  if (selectionArea) return [{ kind: "area", sceneId: scene.id, rect: selectionArea }];
  return [{ kind: "scene", sceneId: scene.id }];
}

function currentSelectedEntityIds(): EntityId[] {
  if (selectedId && !selectedIds.includes(selectedId as EntityId)) return [selectedId as EntityId].filter((id) => Boolean(editableEntity(id)));
  return selectedIds.filter((id) => Boolean(editableEntity(id)));
}

function rectFromPoints(start: Vec2, end: Vec2): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return { x, y, w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
}

function createEntityFromShapeDrag(drag: ShapeDragState): Entity | undefined {
  if (drag.tool === "leaf") {
    return createPolygonEntityFromWorldPoints(drag.points, "柳叶本体", ["实体", "柳叶笔", "多边形碰撞"]);
  }
  const rect = normalizedShapeRect(drag);
  const id = makeId<"EntityId">("ent") as EntityId;
  const displayName = nextEntityDisplayName(shapeDisplayBase(drag.tool));
  const shape = drag.tool === "circle" ? "circle" : "box";
  return {
    id,
    internalName: uniqueEntityInternalName(displayName),
    displayName,
    kind: "entity",
    persistent: true,
    transform: {
      position: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    body: {
      mode: "static",
      velocity: { x: 0, y: 0 },
      gravityScale: 0,
      friction: 0.8,
      bounce: 0,
    },
    collider: {
      shape,
      size: { x: rect.w, y: rect.h },
      radius: drag.tool === "circle" ? Math.min(rect.w, rect.h) / 2 : undefined,
      solid: true,
      trigger: false,
      layerMask: ["world"],
      offset: { x: 0, y: 0 },
      rotation: 0,
    },
    resources: [],
    tags: ["实体", "硬质碰撞"],
  };
}

function normalizedShapeRect(drag: ShapeDragState): Rect {
  const raw = drag.moved ? rectFromPoints(drag.start, drag.current) : { x: drag.start.x - 32, y: drag.start.y - 32, w: 64, h: 64 };
  const minSize = 24;
  const center = { x: raw.x + raw.w / 2, y: raw.y + raw.h / 2 };
  if (drag.tool === "square" || drag.tool === "circle") {
    const side = Math.max(minSize, raw.w, raw.h);
    return { x: center.x - side / 2, y: center.y - side / 2, w: side, h: side };
  }
  return {
    x: center.x - Math.max(minSize, raw.w) / 2,
    y: center.y - Math.max(minSize, raw.h) / 2,
    w: Math.max(minSize, raw.w),
    h: Math.max(minSize, raw.h),
  };
}

function createPolygonEntityFromWorldPoints(worldPoints: Vec2[], baseName: string, tags: string[]): Entity | undefined {
  const geometry = polygonGeometryFromWorldPoints(worldPoints);
  if (!geometry) return undefined;
  const id = makeId<"EntityId">("ent") as EntityId;
  const displayName = nextEntityDisplayName(baseName);
  return {
    id,
    internalName: uniqueEntityInternalName(displayName),
    displayName,
    kind: "entity",
    persistent: true,
    transform: {
      position: geometry.center,
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    body: {
      mode: "static",
      velocity: { x: 0, y: 0 },
      gravityScale: 0,
      friction: 0.8,
      bounce: 0,
    },
    collider: {
      shape: "polygon",
      size: geometry.size,
      points: geometry.localPoints,
      solid: true,
      trigger: false,
      layerMask: ["world"],
      offset: { x: 0, y: 0 },
      rotation: 0,
    },
    resources: [],
    tags,
  };
}

function polygonGeometryFromWorldPoints(points: Vec2[]): { center: Vec2; size: Vec2; localPoints: Vec2[] } | undefined {
  const cleaned = simplifyPolygonPoints(closeEnoughDedup(points), 4);
  if (cleaned.length < 3) return undefined;
  const xs = cleaned.map((point) => point.x);
  const ys = cleaned.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const size = { x: Math.max(4, maxX - minX), y: Math.max(4, maxY - minY) };
  if (size.x < 4 || size.y < 4 || Math.abs(polygonArea(cleaned)) < 12) return undefined;
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  return {
    center,
    size,
    localPoints: cleaned.map((point) => ({ x: point.x - center.x, y: point.y - center.y })),
  };
}

function closeEnoughDedup(points: Vec2[]): Vec2[] {
  const cleaned: Vec2[] = [];
  for (const point of points) {
    const last = cleaned[cleaned.length - 1];
    if (!last || distance(last, point) >= 2) cleaned.push({ x: point.x, y: point.y });
  }
  if (cleaned.length > 2 && distance(cleaned[0], cleaned[cleaned.length - 1]) < 8) cleaned.pop();
  return cleaned;
}

function simplifyPolygonPoints(points: Vec2[], minDistance: number): Vec2[] {
  if (points.length <= 3) return points;
  const simplified: Vec2[] = [];
  for (const point of points) {
    const last = simplified[simplified.length - 1];
    if (!last || distance(last, point) >= minDistance) simplified.push(point);
  }
  return removeNearlyCollinearPoints(simplified);
}

function removeNearlyCollinearPoints(points: Vec2[]): Vec2[] {
  if (points.length <= 3) return points;
  return points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const cross = Math.abs((point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x));
    return cross > 2;
  });
}

function polygonArea(points: Vec2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function shapeDisplayBase(tool: ShapeToolId): string {
  if (tool === "square") return "方块本体";
  if (tool === "circle") return "圆形本体";
  return "柳叶本体";
}

function nextEntityDisplayName(base: string): string {
  const names = new Set(Object.values(scene.entities).map((entity) => entity.displayName));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function uniqueEntityInternalName(displayName: string): string {
  const preferred = displayName.trim().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "") || "entity";
  const names = new Set(Object.values(scene.entities).map((entity) => entity.internalName));
  let candidate = preferred;
  let index = 2;
  while (names.has(candidate)) {
    candidate = `${preferred}_${index}`;
    index += 1;
  }
  return candidate;
}

function uniqueEntityIds(ids: EntityId[]): EntityId[] {
  return [...new Set(ids)];
}

function distance(left: Vec2, right: Vec2): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function moveEntityToFolder(entityId: EntityId, folderId: string): void {
  const entity = world.entities.get(entityId);
  if (!entity?.persistent) {
    notice = "临时对象不进入世界文件夹；它只属于运行时调试。";
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
  selectedPart = "body";
  selectedIds = [entityId];
  selectionArea = undefined;
  syncWorldFromStore();
  markProjectDirty("文件夹移动已更新");
  notice = "已提交文件夹移动事务。";
  renderAll();
}

function syncWorldFromStore(): void {
  const latestProject = store.project;
  const latestScene = latestProject.scenes[latestProject.activeSceneId];
  scene = latestScene;
  animatedResourcePresent = sceneHasVisibleAnimatedResource(latestProject);
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
  animatedResourcePresent = sceneHasVisibleAnimatedResource(latestProject);
  world = new RuntimeWorld({ scene });
}

function updateCanvasCursor(point: Vec2): void {
  const canvas = renderer.canvas();
  if (activeTool === "superBrush") {
    canvas.style.cursor = "crosshair";
    return;
  }
  if (shapeToolFromActive(activeTool)) {
    canvas.style.cursor = "crosshair";
    return;
  }
  if (activeTool === "polygon") {
    canvas.style.cursor = "crosshair";
    return;
  }
  if (activeTool !== "select") {
    canvas.style.cursor = "default";
    return;
  }
  const handle = renderer.pickTransformHandle(selectedEntity(), selectedPart, point);
  if (handle) {
    canvas.style.cursor = cursorForTransformHandle(handle);
    return;
  }
  canvas.style.cursor = renderer.pickCanvasTarget(world, point, selectedId ? { entityId: selectedId, part: selectedPart } : undefined)
    ? "pointer"
    : "default";
}

function query<T extends HTMLElement>(selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

function collapsedTreeSignature(): string {
  return [...collapsedTreeNodes].sort().join("|");
}

function aiTraceSignature(): string {
  return Object.entries(aiTraceByTask)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([taskId, trace]) => `${taskId}:${trace}`)
    .join("|");
}

function escapeContextMenuHtml(value: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => {
    return replacements[character] || character;
  });
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
