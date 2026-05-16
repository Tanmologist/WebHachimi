import "./styles.css";
import type { AiTaskExecutionResult, AiTaskExecutor } from "../ai/taskExecutor";
import { attackTouchKindForEntities, planMovedAttackMovementOffsets, planMovedAttackTouchOffsets } from "../combat/hitboxEdit";
import { entityFollowsParentTransform } from "../project/entityHierarchy";
import { createTask } from "../project/tasks";
import { normalizeProjectDefaults, type BrushContext, type BrushVisualEvidence, type BrushVisualFrame, type Entity, type Project, type ProjectPatch, type Scene } from "../project/schema";
import { consumeEditorHandoff } from "../project/editorHandoff";
import { ProjectStore } from "../project/projectStore";
import {
  createBrushContextFromSuperBrushDraft,
  createBrushVisualEvidence,
  createSuperBrushStroke,
  createTaskFromSuperBrush,
  hasMeaningfulSuperBrushContext,
  mergeSuperBrushTargets,
  rebuildSuperBrushDraftTargets,
  summarizeSuperBrushDraft,
  type BrushVisualEvidenceInput,
  type SuperBrushDraft,
} from "./superBrush";
import { RuntimeWorld } from "../runtime/world";
import { cloneJson, makeId, type EntityId, type Rect, type ResourceId, type Result, type SceneId, type Transform2D, type Vec2 } from "../shared/types";
import type { Resource, ResourceBinding, TargetRef, Task } from "../project/schema";
import {
  applyCanvasDragState,
  applyMultiCanvasDragState,
  applyParentChildMoveState,
  createCanvasDragState,
  createMultiCanvasDragState,
  createParentChildMoveState,
  cursorForTransformHandle,
  dragNotice,
  multiDragNotice,
  parentChildMoveDelta,
  setRotationSnapEnabled,
  setMoveSnapEnabled,
  type CanvasDragState,
  type MultiCanvasDragState,
  type ParentChildMoveState,
} from "./canvasTransform";
import { createStarterProject, repairKnownStarterLabels } from "./starterProject";
import { geometryAabb, targetGeometry, V2Renderer, type CanvasTargetPart, type ShapeDraftPreview, type TransformHandle } from "./renderer";
import { enterGameMode, leaveGameMode, mountEditorShell } from "./editorShell";
import { handleEditorKeyDown, handleEditorKeyUp } from "./keyboardController";
import { PanelLayoutController, type PanelId } from "./panelLayout";
import { renderInspectorHtml, renderResourceLibraryHtml, renderResourcesHtml } from "./panelViews";
import { bindSceneTreeInteractions, renderSceneTreeHtml } from "./sceneTreeController";
import { renderTaskPanelHtml } from "./taskPanelViews";
import { renderWorldManagerPopoverHtml } from "./worldManagerViews";
import {
  planAddWorldTransaction,
  planRemoveWorldTransaction,
  planRenameWorldTransaction,
  planSelectWorldTransaction,
  type WorldManagerActionPlan,
  type WorldManagerTransactionPlan,
} from "./worldManagerTransactions";
import { planPersistentFolderMoveTransaction } from "./folderMoveTransaction";
import {
  planBatchDeleteEntitiesTransaction,
  planBatchDuplicateEntitiesTransaction,
  planDeleteEntityTransaction,
  planDuplicateEntityTransaction,
  planRenameEntityTransaction,
  planRenameResourceTransaction,
  type ContextMenuTransactionPlan,
} from "./contextMenuActions";
import { createTaskWorkflowController } from "./taskWorkflowController";
import {
  escapeHtml,
  panelLabel,
  toolLabel,
} from "./viewText";
import { maintenanceSummary } from "./summaryModels";
import { buildProjectForSave, forceLoadProjectFromDiskForEditor, loadProjectForEditor, saveProjectFromEditor, saveProjectLocallyFromEditor } from "./persistenceController";
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
import {
  buildResourceEffectPreset,
  buildSequenceSpriteMetadata,
  buildSheetSpriteMetadata,
  imageAttachments,
  resourceEffectPresetLabel,
  resourceEffectPresetOptions,
  resourceHasAnimation,
  resourceHasTimelineEffect,
  type ResourceEffectPresetOption,
} from "./resourceAnimation";
import { AutoSaveController } from "./autoSaveController";
import { EditorTransactionController } from "./editorTransactionController";
import { EditorPerformanceController } from "./editorPerformanceController";
import { OutputLogController } from "./outputLogController";
import { TaskSummaryController } from "./taskSummaryController";
import { playerInputKeyForMouseButton, type PlayerInputKey } from "../player/input";
import {
  formatWorldSpeed,
  normalizeWorldSpeed,
  parseWorldSpeedInput,
  renderWorldSpeedControlElements,
  worldSpeedControlSignature,
} from "./worldSpeedControl";

const toolIds = ["select", "square", "circle", "leaf", "polygon", "superBrush"] as const;
type ToolId = (typeof toolIds)[number];
type ShapeToolId = Extract<ToolId, "square" | "circle" | "leaf">;
type ActiveSurface = "canvas" | "world";
type GameplayMouseInputKey = Extract<PlayerInputKey, "attack" | "parry">;
type ResourceEffectPresetSelection = ResourceEffectPresetOption["id"];
type ContextMenuAction =
  | "select-target"
  | "rename-entity"
  | "duplicate-entity"
  | "duplicate-here"
  | "create-box"
  | "create-circle"
  | "clear-selection"
  | "delete-target"
  | "delete-selected"
  | "duplicate-selected"
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
  worldPoint?: Vec2;
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

let scene = project.scenes[project.activeSceneId];
let world = new RuntimeWorld({ scene });
if (handoff?.snapshot) world.restoreSnapshot(handoff.snapshot);
const renderer = new V2Renderer();
let animatedResourcePresent = sceneHasVisibleAnimatedResource(project);
const DISK_AUTO_LOAD_INTERVAL_MS = 4000;

let selectedId = firstPersistentSceneEntityId(scene);
let selectedPart: CanvasTargetPart = "body";
let selectedIds: EntityId[] = selectedId ? [selectedId as EntityId] : [];
let selectionArea: Rect | undefined;
let activeTool: ToolId = "select";
let previewTaskId = "";
let localClipboardFallbackToken = 0;
let lastSeenDiskProjectSignature = projectDiskSignature(project);
let diskAutoLoadInFlight = false;
let pendingDiskUpdateSignature = "";
let notice = handoff
  ? `已从游戏暂停帧 ${handoff.snapshot.frame} 进入编辑器，按 Z 可继续运行`
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
let parentChildMoveDrag: ParentChildMoveState | undefined;
let multiCanvasDrag: MultiCanvasDragState | undefined;
let canvasCameraDrag: { pointerId: number; clientX: number; clientY: number; moved: boolean; clearSelectionOnClick?: boolean } | undefined;
const gameplayMouseInputs = new Map<number, GameplayMouseInputKey>();
let selectionBoxDrag: { pointerId: number; start: Vec2; current: Vec2; moved: boolean } | undefined;
let shapeDrag: ShapeDragState | undefined;
let polygonDraft: PolygonDraftState | undefined;
let spacePanActive = false;
let windowMenuOpen = false;
let worldManagerOpen = false;
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
  worldManager: "",
  worldSpeed: "",
};
const autoSave = new AutoSaveController({
  initialStatus: initialProject.loadedFromDisk ? "已从磁盘载入，自动保存就绪" : "自动保存就绪",
  saveProject: async () => {
    const projectForSave = buildCurrentProjectForSave();
    const result = await saveProjectFromEditor(projectForSave);
    if (result.result.storage === "api") lastSeenDiskProjectSignature = projectDiskSignature(projectForSave);
    return result.notice;
  },
  saveProjectLocally: () => saveProjectLocallyFromEditor(buildCurrentProjectForSave()).notice,
  shouldDeferSave: () => drawingBrush || superBrushTaskDialogOpen || Boolean(canvasDrag || shapeDrag || polygonDraft),
  render: renderUi,
});
const editorTransactions = new EditorTransactionController({
  store,
  syncWorldFromStore,
  markProjectDirty,
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
const treeNode = query<HTMLElement>('[data-role="tree"]');
const tasksNode = query<HTMLElement>('[data-role="tasks"]');
const inspectorNode = query<HTMLElement>('[data-role="inspector"]');
const resourcesNode = query<HTMLElement>('[data-role="resources"]');
const resourceLibraryNode = query<HTMLElement>('[data-role="resource-library"]');
const outputNode = query<HTMLElement>('[data-role="output"]');
const modeNode = query<HTMLElement>('[data-role="mode"]');
const saveStatusNode = query<HTMLElement>('[data-role="save-status"]');
const pointerNode = query<HTMLElement>('[data-role="pointer"]');
const noticeNode = query<HTMLElement>('[data-role="notice"]');
const frameNode = query<HTMLElement>('[data-role="frame"]');
const worldSpeedControl = query<HTMLElement>('[data-role="world-speed-control"]');
const worldSpeedRange = query<HTMLInputElement>('[data-role="world-speed-range"]');
const worldSpeedInput = query<HTMLInputElement>('[data-role="world-speed-input"]');
const worldSpeedValueNode = query<HTMLElement>('[data-role="world-speed-value"]');
const worldManagerToggle = query<HTMLButtonElement>("[data-world-manager-toggle]");
const worldManagerPopover = query<HTMLElement>('[data-role="world-manager-popover"]');
const polygonActionsNode = query<HTMLElement>('[data-role="polygon-actions"]');
const minimizedTrayNode = query<HTMLElement>('[data-role="minimized-tray"]');
const contextMenuNode = query<HTMLElement>('[data-role="context-menu"]');
const brushSummaryNode = query<HTMLElement>('[data-role="super-brush-summary"]');
const brushSummaryTextNode = query<HTMLElement>('[data-role="super-brush-summary-text"]');
const brushTaskModalNode = query<HTMLElement>('[data-role="super-brush-task-modal"]');
const brushTaskSummaryNode = query<HTMLElement>('[data-role="super-brush-task-summary"]');
const brushTaskErrorNode = query<HTMLElement>('[data-role="super-brush-task-error"]');
const toolButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-tool]"));
const surfaceButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-surface-target]"));
const worldSpeedPresetButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-world-speed-preset]"));
const confirmBrushButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-action="confirm-super-brush"]'));
const taskWorkflow = createTaskWorkflowController({
  store,
  executeNextAiTask,
  currentTargets,
  getPendingBrush: () => (superBrushTaskDialogOpen ? pendingBrush : undefined),
  setPendingBrush: (draft) => {
    pendingBrush = draft;
  },
  clearTaskInput: () => {
    taskInput.value = "";
    const visibleTaskInput = root.querySelector<HTMLTextAreaElement>('[data-role="visible-task-input"]');
    if (visibleTaskInput) visibleTaskInput.value = "";
  },
  focusTaskInput: () => {
    const visibleTaskInput = root.querySelector<HTMLTextAreaElement>('[data-role="visible-task-input"]');
    if (visibleTaskInput && !visibleTaskInput.hidden) visibleTaskInput.focus();
    else taskInput.focus();
  },
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
fitWorldToCanvas("initial", { render: false });
renderUi();
loop(lastTime);
const PROJECT_MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;
window.setInterval(runScheduledProjectMaintenance, PROJECT_MAINTENANCE_INTERVAL_MS);
window.setInterval(() => {
  void autoLoadProjectFromDisk();
}, DISK_AUTO_LOAD_INTERVAL_MS);

async function loadInitialProject(handoffProject?: Project): Promise<{ project: Project; notice: string; loadedFromDisk: boolean }> {
  if (handoffProject) {
    return {
      project: handoffProject,
      notice: "已接收游戏暂停现场，自动保存就绪",
      loadedFromDisk: false,
    };
  }

  const result = await loadProjectForEditor();
  if (result.project) {
    return {
      project: result.project,
      notice: `${result.notice} 自动保存已开启`,
      loadedFromDisk: true,
    };
  }

  return {
    project: createStarterProject(),
    notice: "未找到磁盘项目，已创建初始项目，自动保存已开启",
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

function bindUi(): void {
  const visibleTaskInput = root.querySelector<HTMLTextAreaElement>('[data-role="visible-task-input"]');
  root.querySelectorAll('[data-action="toggle-run"]').forEach((button) => button.addEventListener("click", toggleRun));
  worldSpeedRange.addEventListener("input", () => previewWorldSpeed(worldSpeedRange.value));
  worldSpeedRange.addEventListener("change", () => commitWorldSpeed(worldSpeedRange.value));
  worldSpeedInput.addEventListener("input", () => previewWorldSpeed(worldSpeedInput.value));
  worldSpeedInput.addEventListener("change", () => commitWorldSpeed(worldSpeedInput.value));
  worldSpeedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitWorldSpeed(worldSpeedInput.value);
      worldSpeedInput.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      renderWorldSpeedControl();
      worldSpeedInput.blur();
    }
  });
  worldSpeedPresetButtons.forEach((button) => {
    button.addEventListener("click", () => commitWorldSpeed(button.dataset.worldSpeedPreset || "1"));
  });
  root.querySelectorAll('[data-action="step"]').forEach((button) => {
    button.addEventListener("click", () => {
      world.runFixedFrame();
      renderAll();
    });
  });
  root.querySelectorAll('[data-action="fit-world"]').forEach((button) => {
    button.addEventListener("click", () => {
      fitWorldToCanvas("manual");
    });
  });
  root.querySelectorAll('[data-action="capture"]').forEach((button) => {
    button.addEventListener("click", () => {
      const snapshot = world.freezeForInspection();
      store.recordRuntimeSnapshot(snapshot);
      markProjectDirty("已捕捉冻结帧");
      notice = `已捕捉冻结帧 ${snapshot.frame}`;
      renderAll();
    });
  });
  root.querySelectorAll('[data-action="save-project"]').forEach((button) => {
    button.addEventListener("click", () => {
      void saveCurrentProject();
    });
  });
  root.querySelectorAll('[data-action="reload-project"]').forEach((button) => button.addEventListener("click", refreshProjectFromDisk));
  root.querySelectorAll('[data-action="force-reload-project"]').forEach((button) => {
    button.addEventListener("click", () => {
      void forceRefreshProjectFromDisk("manual");
    });
  });
  root.querySelector('[data-action="toggle-window-menu"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    windowMenuOpen = !windowMenuOpen;
    if (!windowMenuOpen) clearPendingWindowMenuClick();
    renderAll();
  });
  root.querySelectorAll('[data-action="queue-task"]').forEach((button) => {
    button.addEventListener("click", () => queueTaskFromComposer(visibleTaskInput));
  });
  root.querySelectorAll('[data-action="confirm-super-brush"]').forEach((button) => {
    button.addEventListener("click", openSuperBrushTaskDialog);
  });
  root.querySelectorAll('[data-action="back-super-brush"]').forEach((button) => {
    button.addEventListener("click", closeSuperBrushTaskDialog);
  });
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
  visibleTaskInput?.addEventListener("paste", onTaskInputPaste);
  visibleTaskInput?.addEventListener("keydown", (event) => {
    onResourcePasteKeyDown(event);
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      queueTaskFromComposer(visibleTaskInput);
    }
  });
  worldManagerToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    worldManagerOpen = !worldManagerOpen;
    renderUi();
  });
  worldManagerPopover.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  worldManagerPopover.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  resourceFileInput.addEventListener("change", () => {
    void importResourceFiles(Array.from(resourceFileInput.files || []));
    resourceFileInput.value = "";
  });

  const objectResourceInput = root.querySelector<HTMLInputElement>('[data-role="object-resource-input"]');
  const objectResourceDropZone = root.querySelector<HTMLElement>('[data-role="resource-drop-zone"]');
  const objectResourcesList = root.querySelector<HTMLElement>('[data-role="object-resources-list"]');

  objectResourceDropZone?.addEventListener("click", () => {
    objectResourceInput?.click();
  });
  objectResourceDropZone?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    objectResourceInput?.click();
  });

  objectResourceInput?.addEventListener("change", () => {
    const files = Array.from(objectResourceInput.files || []);
    if (files.length) void importResourceFiles(files);
    objectResourceInput.value = "";
  });

  objectResourceDropZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
    objectResourceDropZone.classList.add("is-dragover");
  });

  objectResourceDropZone?.addEventListener("dragleave", () => {
    objectResourceDropZone.classList.remove("is-dragover");
  });

  objectResourceDropZone?.addEventListener("drop", (event) => {
    event.preventDefault();
    objectResourceDropZone.classList.remove("is-dragover");
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) void importResourceFiles(files);
  });

  objectResourcesList?.addEventListener("click", (event) => {
    const removeButton = (event.target as HTMLElement).closest<HTMLButtonElement>(".resource-remove");
    if (!removeButton) return;
    const resourceEntry = removeButton.closest<HTMLElement>(".attached-resource");
    if (resourceEntry) resourceEntry.remove();
  });

  document.addEventListener("paste", (event) => {
    const target = event.target as HTMLElement | null;
    const isObjectResourceTarget = Boolean(target?.closest('[data-role="resource-drop-zone"], .object-resources-body'));
    if (!isObjectResourceTarget) return;
    const items = Array.from(event.clipboardData?.items || []);
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) {
      event.preventDefault();
      void importResourceFiles(files);
    }
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
    notice = "多边形绘制已取消";
    renderAll();
  });
  toolButtons.forEach((button) => {
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
  surfaceButtons.forEach((button) => {
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
        notice = `${panelLabel(panel)}已关闭`;
      } else {
        panelLayout.minimizePanel(panel);
        notice = `${panelLabel(panel)}已最小化到底部托盘`;
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
      notice = `${panelLabel(panel)}已恢复`;
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
  contextMenuNode.addEventListener("click", onContextMenuClick);
  contextMenuNode.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", onCanvasPointerDown);
  canvas.addEventListener("pointermove", onCanvasPointerMove);
  canvas.addEventListener("pointerup", onCanvasPointerUp);
  canvas.addEventListener("pointerleave", onCanvasPointerUp);
  canvas.addEventListener("pointercancel", cancelCanvasPointerInteraction);
  canvas.addEventListener("lostpointercapture", cancelCanvasPointerInteraction);
  canvas.addEventListener("contextmenu", onCanvasContextMenu);
  canvas.addEventListener("mousedown", onCanvasMouseDown, { passive: false });
  window.addEventListener("mouseup", onWindowMouseUp, { passive: false });
  canvas.addEventListener("dblclick", (event: MouseEvent) => {
    if (activeTool !== "select" || world.mode !== "editorFrozen") return;
    event.preventDefault();
    const point = renderer.screenToWorld(event.clientX, event.clientY);
    const picked = renderer.pickCanvasTarget(world, point, undefined);
    if (picked && picked.entity.collider) {
      selectedId = picked.entity.id;
      selectedPart = "body";
      selectedIds = [picked.entity.id as EntityId];
      selectionArea = undefined;
      notice = `已选中${picked.entity.displayName} 的本体（碰撞体）`;
      renderAll();
    }
  });
  canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
  canvas.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", resetTransformSnapState);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") resetTransformSnapState();
  });
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
    if (worldManagerOpen && !target.closest('[data-role="world-manager-popover"], [data-world-manager-toggle]')) {
      worldManagerOpen = false;
      changed = true;
    }
    if (changed) renderUi();
  });
}

function queueTaskFromComposer(visibleTaskInput: HTMLTextAreaElement | null): void {
  const text = (visibleTaskInput?.value || taskInput.value).trim();
  if (visibleTaskInput) taskInput.value = text;
  const shouldIgnoreUnconfirmedBrush = Boolean(text && pendingBrush && hasMeaningfulSuperBrushContext(pendingBrush) && !superBrushTaskDialogOpen);
  if (shouldIgnoreUnconfirmedBrush) {
    pendingBrush = undefined;
    currentStrokePoints = [];
    drawingBrush = false;
    drawingBrushPointerId = undefined;
    brushStartPoint = undefined;
    activeTool = "select";
  }
  taskWorkflow.queueTaskFromText(text);
  if (shouldIgnoreUnconfirmedBrush) notice = "未确认的超级画笔已忽略；已按普通 AI 任务发送";
  if (visibleTaskInput && !text) visibleTaskInput.focus();
  renderAll();
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
  notice = `${panelLabel(panel)}${wasOpen ? "前置" : "打开"}。`;
  renderAll();
}

function focusCanvasSurface(): void {
  clearPendingWindowMenuClick();
  windowMenuOpen = false;
  activeSurface = "canvas";
  const canvas = renderer.canvas();
  canvas.tabIndex = 0;
  canvas.focus();
  notice = "已切换到画布";
  renderUi();
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
  notice = "已切换到世界";
  renderUi();
}

function centerWindowPanel(panel: PanelId): void {
  clearPendingWindowMenuClick();
  windowMenuOpen = false;
  panelLayout.centerPanel(panel);
  if (panel === "scene") activeSurface = "world";
  notice = `${panelLabel(panel)}已归中`;
  renderAll();
}

function addWorldFromManager(): void {
  applyWorldManagerPlan(planAddWorldTransaction(store.peekProject()));
}

function selectWorldFromManager(sceneId: SceneId): void {
  applyWorldManagerPlan(planSelectWorldTransaction(store.peekProject(), sceneId));
}

function renameWorldFromManager(sceneId: SceneId, rawName: string): void {
  applyWorldManagerPlan(planRenameWorldTransaction(store.peekProject(), sceneId, rawName));
}

function removeWorldFromManager(sceneId: SceneId): void {
  applyWorldManagerPlan(planRemoveWorldTransaction(store.peekProject(), sceneId));
}

function applyWorldManagerPlan(result: Result<WorldManagerActionPlan>): void {
  if (!result.ok) {
    notice = `世界管理器操作失败：${result.error}`;
    renderUi();
    return;
  }
  if (result.value.kind === "notice") {
    notice = result.value.noticeText;
    renderUi();
    return;
  }
  applyWorldManagerTransaction(result.value.transaction);
}

function applyWorldManagerTransaction(input: WorldManagerTransactionPlan): void {
  const result = editorTransactions.apply({
    actor: "user",
    patches: input.patches,
    inversePatches: input.inversePatches,
    diffSummary: input.diffSummary,
    dirtyReason: input.dirtyReason,
    syncOnSuccess: false,
    syncOnFailure: false,
  });
  if (!result.ok) {
    syncWorldFromStore();
    notice = `世界管理器操作失败：${result.error}`;
    renderAll();
    return;
  }
  rebuildWorldFromStore();
  if (input.resetSelection !== false) resetSelectionToFirstEditableEntity();
  notice = input.noticeText;
  renderAll();
}

function resetSelectionToFirstEditableEntity(): void {
  selectedId = firstEditableEntityId();
  selectedPart = "body";
  selectedIds = selectedId ? [selectedId as EntityId] : [];
  selectionArea = undefined;
}

function previewWorldSpeed(rawValue: string): void {
  const nextSpeed = parseWorldSpeedInput(rawValue);
  if (nextSpeed === undefined) return;
  world.setTimeScale(nextSpeed);
  renderWorldSpeedControl({ force: true, preserveInput: document.activeElement === worldSpeedInput });
  renderFrame();
}

function commitWorldSpeed(rawValue: string): void {
  const nextSpeed = parseWorldSpeedInput(rawValue);
  if (nextSpeed === undefined) {
    notice = "世界速度需要是 0 到 4 之间的数字";
    renderWorldSpeedControl({ force: true });
    renderUi();
    return;
  }
  const projectSnapshot = store.peekProject();
  const activeScene = projectSnapshot.scenes[projectSnapshot.activeSceneId];
  if (!activeScene) return;
  const previousSpeed = normalizeWorldSpeed(activeScene.settings.timeScale);
  world.setTimeScale(nextSpeed);
  if (Math.abs(previousSpeed - nextSpeed) < 0.001) {
    notice = `世界速度已是 ${formatWorldSpeed(nextSpeed)}`;
    renderWorldSpeedControl({ force: true });
    renderFrame();
    return;
  }

  const speedPath = `/scenes/${activeScene.id}/settings/timeScale` as ProjectPatch["path"];
  const result = editorTransactions.apply({
    actor: "user",
    patches: [{ op: "set", path: speedPath, value: nextSpeed }],
    inversePatches: [{ op: "set", path: speedPath, value: previousSpeed }],
    diffSummary: `设置世界速度为 ${formatWorldSpeed(nextSpeed)}`,
    dirtyReason: `世界速度已调整为 ${formatWorldSpeed(nextSpeed)}`,
    syncOnSuccess: false,
    syncOnFailure: false,
  });
  if (!result.ok) {
    syncWorldFromStore();
    notice = `世界速度更新失败：${result.error}`;
    renderAll();
    return;
  }
  scene = store.peekProject().scenes[store.peekProject().activeSceneId];
  world.setTimeScale(nextSpeed);
  notice = `世界速度已调整为 ${formatWorldSpeed(nextSpeed)}`;
  renderAll();
}

function focusEntityOnCanvas(entityId: string, part: CanvasTargetPart): void {
  const entity = editableEntity(entityId);
  if (!entity) {
    syncWorldFromStore();
    notice = "定位目标已经不存在，世界树已刷新";
    renderAll();
    return;
  }
  const geometry = targetGeometry(entity, part);
  selectedId = entity.id;
  selectedPart = part;
  selectedIds = [entity.id];
  selectionArea = undefined;
  activeSurface = "canvas";
  renderer.centerOnWorldPoint(geometry.center);
  notice = part === "presentation" ? `已定位到 ${entity.displayName} 的可视体` : `已定位到 ${entity.displayName}`;
  renderAll();
}

function fitWorldToCanvas(source: "initial" | "manual" = "manual", options: { render?: boolean } = {}): void {
  const bounds = editableWorldBounds();
  const entities = editableEntities();
  if (!bounds) {
    notice = "世界树里没有可适配的本体；画布为空。";
    if (options.render !== false) renderAll();
    return;
  }
  const viewport = renderer.fitWorldBounds(bounds);
  notice =
    source === "initial"
      ? `已载入 ${entities.length} 个本体，并适配到画布中心。`
      : `已适配 ${entities.length} 个本体到画布中心：${Math.round(viewport.x)}, ${Math.round(viewport.y)} / ${Math.round(viewport.zoom * 100)}%。`;
  if (options.render !== false) renderAll();
}

function editableWorldBounds(): Rect | undefined {
  const bounds: Rect[] = [];
  for (const entity of editableEntities()) {
    bounds.push(geometryAabb(targetGeometry(entity, "body")));
    if (entity.render && entity.render.visible !== false) {
      bounds.push(geometryAabb(targetGeometry(entity, "presentation")));
    }
  }
  return mergeBounds(bounds);
}

function mergeBounds(bounds: Rect[]): Rect | undefined {
  const first = bounds[0];
  if (!first) return undefined;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.w;
  let maxY = first.y + first.h;
  for (let index = 1; index < bounds.length; index += 1) {
    const bound = bounds[index];
    minX = Math.min(minX, bound.x);
    minY = Math.min(minY, bound.y);
    maxX = Math.max(maxX, bound.x + bound.w);
    maxY = Math.max(maxY, bound.y + bound.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function startCanvasTransform(event: PointerEvent, entityId: string, part: CanvasTargetPart, handle: TransformHandle, point: Vec2): void {
  const entity = canvasTransformEntity(entityId);
  if (!entity) return;
  parentChildMoveDrag = undefined;
  if (isAttackTouchDebugEntity(entity)) {
    if (handle !== "core") {
      notice = "TOUCH BOX 目前只支持移动；大小仍通过父角色的攻击范围/高度参数调整。";
      return;
    }
    renderer.canvas().setPointerCapture(event.pointerId);
    canvasDrag = createCanvasDragState(event.pointerId, entity, "body", "core", point);
    notice = "正在移动 TOUCH BOX；松开后会按当前攻击动作写入父角色的相对偏移。";
    return;
  }
  if (isAttackMovementTargetDebugEntity(entity)) {
    if (handle !== "core") {
      notice = "MOVE 目标点目前只支持移动；拖动小点会写回这类攻击的动作位移。";
      return;
    }
    renderer.canvas().setPointerCapture(event.pointerId);
    canvasDrag = createCanvasDragState(event.pointerId, entity, "body", "core", point);
    notice = "正在移动 MOVE 目标点；松开后会写入父角色当前攻击动作的位移距离。";
    return;
  }
  if (!entity.persistent || !scene.entities[entity.id]) return;
  renderer.canvas().setPointerCapture(event.pointerId);
  canvasDrag = createCanvasDragState(event.pointerId, entity, part, handle, point);
  if (canvasDrag.kind === "move" && part === "body") {
    parentChildMoveDrag = createParentChildMoveState(entity, childEntitiesForParent(entity.id as EntityId));
  }
  notice = dragNotice(canvasDrag.kind, "start");
}

function startMultiCanvasTransform(event: PointerEvent, entities: Entity[], handle: TransformHandle, point: Vec2): void {
  parentChildMoveDrag = undefined;
  renderer.canvas().setPointerCapture(event.pointerId);
  multiCanvasDrag = createMultiCanvasDragState(event.pointerId, entities, handle, point);
  notice = multiDragNotice(multiCanvasDrag.kind, "start", entities.length);
}

function updateCanvasTransform(point: Vec2): void {
  if (!canvasDrag) return;
  const entity = canvasTransformEntity(canvasDrag.entityId);
  if (!entity) return;
  const isTouch = isAttackTouchDebugEntity(entity);
  applyCanvasDragState(entity, canvasDrag, point, {
    allEntities: isTouch ? [] : editableEntities(),
    movingEntityIds: [canvasDrag.entityId],
    enabled: !isTouch,
  });
  if (parentChildMoveDrag && parentChildMoveDrag.parentId === entity.id) {
    applyParentChildMoveState(world.allEntities(), parentChildMoveDrag, entity);
  }
}

function updateMultiCanvasTransform(point: Vec2): void {
  if (!multiCanvasDrag) return;
  const entityIds = multiCanvasDrag.entries.map((e) => e.entityId);
  const entities = entityIds.map((id) => editableEntity(id)).filter(Boolean) as Entity[];
  applyMultiCanvasDragState(entities, multiCanvasDrag, point, {
    allEntities: editableEntities(),
    movingEntityIds: entityIds,
  });
}

function selectedEntity() {
  return world.entityById(selectedId as EntityId);
}

function editableEntities(): Entity[] {
  return [...world.entities.values()];
}

function sceneTreeEntities(): Entity[] {
  return world.allEntities();
}

function childEntitiesForParent(parentId: EntityId): Entity[] {
  const byParent = new Map<string, Entity[]>();
  for (const entity of world.allEntities()) {
    const parentId = entity.parentId;
    if (!parentId || !entityFollowsParentTransform(entity)) continue;
    const list = byParent.get(parentId) || [];
    list.push(entity);
    byParent.set(parentId, list);
  }

  const descendants: Entity[] = [];
  const seen = new Set<string>([parentId]);
  const visit = (entityId: EntityId) => {
    for (const child of byParent.get(entityId) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      descendants.push(child);
      visit(child.id as EntityId);
    }
  };
  visit(parentId);
  return descendants;
}

function editableEntity(entityId: string): Entity | undefined {
  return world.entities.get(entityId);
}

function canvasTransformEntity(entityId: string): Entity | undefined {
  const entity = editableEntity(entityId);
  if (entity) return entity;
  const runtimeEntity = world.entityById(entityId as EntityId);
  return runtimeEntity && (isAttackTouchDebugEntity(runtimeEntity) || isAttackMovementTargetDebugEntity(runtimeEntity)) ? runtimeEntity : undefined;
}

function isAttackTouchDebugEntity(entity: Entity | undefined): boolean {
  return Boolean(
    entity &&
      !entity.persistent &&
      entity.parentId &&
      entity.tags.includes("attack") &&
      entity.tags.includes("touch"),
  );
}

function isAttackMovementTargetDebugEntity(entity: Entity | undefined): boolean {
  return Boolean(
    entity &&
      !entity.persistent &&
      entity.parentId &&
      entity.tags.includes("attack") &&
      entity.tags.includes("movement-target"),
  );
}

function commitCanvasTransform(drag: CanvasDragState, parentChildMove?: ParentChildMoveState): string | undefined {
  const entity = editableEntity(drag.entityId);
  if (!entity) {
    const runtimeEntity = world.entityById(drag.entityId as EntityId);
    if (runtimeEntity && isAttackTouchDebugEntity(runtimeEntity)) return commitAttackTouchDebugTransform(runtimeEntity, drag);
    if (runtimeEntity && isAttackMovementTargetDebugEntity(runtimeEntity)) return commitAttackMovementTargetTransform(runtimeEntity, drag);
    syncWorldFromStore();
    return "对象状态已刷新，未提交本次变换";
  }
  if (!entity.persistent || !scene.entities[entity.id]) {
    syncWorldFromStore();
    return "运行时对象暂不支持提交变换";
  }
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
  appendParentChildMovePatches(patches, inversePatches, parentChildMove, entity);
  if (!patches.length) return undefined;

  const result = editorTransactions.apply({
    actor: "user",
    patches,
    inversePatches,
    diffSummary: `调整 ${entity.displayName} 本体${transformActionLabel(drag.kind)}。`,
    dirtyReason: `已调整 ${entity.displayName}`,
  });
  if (!result.ok) {
    return `变换未提交：${result.error}`;
  }
  return `已提交本体变换：${transformActionLabel(drag.kind)}。`;
}

function appendParentChildMovePatches(
  patches: ProjectPatch[],
  inversePatches: ProjectPatch[],
  parentChildMove: ParentChildMoveState | undefined,
  parent: Entity,
): void {
  if (!parentChildMove || parentChildMove.parentId !== parent.id) return;
  const delta = parentChildMoveDelta(parentChildMove, parent);
  if (Math.abs(delta.x) < 0.001 && Math.abs(delta.y) < 0.001) return;

  for (const entry of parentChildMove.entries) {
    const child = editableEntity(entry.entityId);
    if (!child || !child.persistent || !scene.entities[child.id]) continue;
    const finalTransform = cloneJson(child.transform);
    if (sameTransform(entry.originalTransform, finalTransform)) continue;
    const transformPath = `/scenes/${scene.id}/entities/${child.id}/transform` as ProjectPatch["path"];
    patches.push({ op: "set", path: transformPath, value: finalTransform });
    inversePatches.push({ op: "set", path: transformPath, value: entry.originalTransform });
  }
}

function commitAttackTouchDebugTransform(touch: Entity, drag: CanvasDragState): string | undefined {
  if (drag.kind !== "move") {
    touch.transform = cloneJson(drag.originalTransform);
    touch.collider = drag.originalCollider ? cloneJson(drag.originalCollider) : undefined;
    touch.render = drag.originalRender ? cloneJson(drag.originalRender) : undefined;
    return "普通攻击 TOUCH BOX 目前只支持移动；大小请改父角色的 attackRange / attackHeight。";
  }
  const ownerId = touch.parentId;
  const owner = ownerId ? editableEntity(ownerId) : undefined;
  const storedOwner = ownerId ? scene.entities[ownerId] : undefined;
  const params = storedOwner?.behavior?.params;
  if (!owner || !storedOwner || !params) {
    syncWorldFromStore();
    return "普通攻击 TOUCH BOX 的父角色已刷新，本次移动未提交。";
  }

  const direction = owner.runtime?.facing === -1 ? -1 : 1;
  const dx = touch.transform.position.x - drag.originalTransform.position.x;
  const dy = touch.transform.position.y - drag.originalTransform.position.y;
  const kind = attackTouchKindForEntities(touch, owner);
  const edit = planMovedAttackTouchOffsets(params, kind, direction, { x: dx, y: dy });
  const previousRawX = params[edit.offsetXKey];
  const previousRawY = params[edit.offsetYKey];

  if (Math.abs(edit.nextX - edit.previousX) < 0.001 && Math.abs(edit.nextY - edit.previousY) < 0.001) {
    return "已选中普通攻击 TOUCH BOX；拖动可调整位置。";
  }

  const patches: ProjectPatch[] = [];
  const inversePatches: ProjectPatch[] = [];
  pushBehaviorParamPatch(patches, inversePatches, storedOwner.id, edit.offsetXKey, edit.nextX, previousRawX, hasOwnParam(params, edit.offsetXKey));
  pushBehaviorParamPatch(patches, inversePatches, storedOwner.id, edit.offsetYKey, edit.nextY, previousRawY, hasOwnParam(params, edit.offsetYKey));

  const result = editorTransactions.apply({
    actor: "user",
    patches,
    inversePatches,
    diffSummary: `调整 ${storedOwner.displayName} ${attackTouchKindLabel(kind)} TOUCH BOX 偏移。`,
    dirtyReason: `已调整 ${storedOwner.displayName} ${attackTouchKindLabel(kind)} TOUCH BOX`,
  });
  if (!result.ok) return `${attackTouchKindLabel(kind)} TOUCH BOX 偏移未提交：${result.error}`;
  selectedId = touch.id;
  selectedPart = "body";
  selectedIds = [touch.id as EntityId];
  selectionArea = undefined;
  return `已写入 ${storedOwner.displayName} 的${attackTouchKindLabel(kind)} TOUCH BOX 偏移：前向 ${edit.nextX}，上下 ${edit.nextY}。`;
}

function commitAttackMovementTargetTransform(target: Entity, drag: CanvasDragState): string | undefined {
  if (drag.kind !== "move") {
    target.transform = cloneJson(drag.originalTransform);
    target.collider = drag.originalCollider ? cloneJson(drag.originalCollider) : undefined;
    target.render = drag.originalRender ? cloneJson(drag.originalRender) : undefined;
    return "MOVE 目标点目前只支持移动。";
  }
  const ownerId = target.parentId;
  const owner = ownerId ? editableEntity(ownerId) : undefined;
  const storedOwner = ownerId ? scene.entities[ownerId] : undefined;
  const params = storedOwner?.behavior?.params;
  if (!owner || !storedOwner || !params) {
    syncWorldFromStore();
    return "MOVE 目标点的父角色已刷新，本次移动未提交。";
  }

  const direction = owner.runtime?.facing === -1 ? -1 : 1;
  const dx = target.transform.position.x - drag.originalTransform.position.x;
  const dy = target.transform.position.y - drag.originalTransform.position.y;
  const kind = attackTouchKindForEntities(target, owner);
  const edit = planMovedAttackMovementOffsets(params, kind, direction, { x: dx, y: dy });
  const previousRawX = params[edit.offsetXKey];
  const previousRawY = params[edit.offsetYKey];

  if (Math.abs(edit.nextX - edit.previousX) < 0.001 && Math.abs(edit.nextY - edit.previousY) < 0.001) {
    return "已选中 MOVE 目标点；拖动可调整动作位移。";
  }

  const patches: ProjectPatch[] = [];
  const inversePatches: ProjectPatch[] = [];
  pushBehaviorParamPatch(patches, inversePatches, storedOwner.id, edit.offsetXKey, edit.nextX, previousRawX, hasOwnParam(params, edit.offsetXKey));
  pushBehaviorParamPatch(patches, inversePatches, storedOwner.id, edit.offsetYKey, edit.nextY, previousRawY, hasOwnParam(params, edit.offsetYKey));

  const result = editorTransactions.apply({
    actor: "user",
    patches,
    inversePatches,
    diffSummary: `调整 ${storedOwner.displayName} ${attackTouchKindLabel(kind)} 动作位移。`,
    dirtyReason: `已调整 ${storedOwner.displayName} ${attackTouchKindLabel(kind)} 动作位移`,
  });
  if (!result.ok) return `${attackTouchKindLabel(kind)} 动作位移未提交：${result.error}`;
  selectedId = target.id;
  selectedPart = "body";
  selectedIds = [target.id as EntityId];
  selectionArea = undefined;
  return `已写入 ${storedOwner.displayName} 的${attackTouchKindLabel(kind)}动作位移：前向 ${edit.nextX}，上下 ${edit.nextY}。`;
}

function commitMultiCanvasTransform(drag: MultiCanvasDragState): string | undefined {
  const patches: ProjectPatch[] = [];
  const inversePatches: ProjectPatch[] = [];
  let changedCount = 0;

  for (const entry of drag.entries) {
    const entity = editableEntity(entry.entityId);
    if (!entity || !entity.persistent || !scene.entities[entity.id]) continue;
    const finalTransform = cloneJson(entity.transform);
    if (!sameTransform(entry.originalTransform, finalTransform)) {
      const transformPath = `/scenes/${scene.id}/entities/${entity.id}/transform` as ProjectPatch["path"];
      patches.push({ op: "set", path: transformPath, value: finalTransform });
      inversePatches.push({ op: "set", path: transformPath, value: entry.originalTransform });
      changedCount++;
    }
  }

  if (!patches.length) return undefined;

  const result = editorTransactions.apply({
    actor: "user",
    patches,
    inversePatches,
    diffSummary: `批量调整 ${changedCount} 个对象的${transformActionLabel(drag.kind)}。`,
    dirtyReason: `已批量调整 ${changedCount} 个对象`,
  });
  if (!result.ok) {
    return `批量变换未提交：${result.error}`;
  }
  return `已提交批量变换：${transformActionLabel(drag.kind)}${changedCount} 个对象）。`;
}

function commitPresentationTransform(entity: Entity, drag: CanvasDragState): string | undefined {
  const finalRender = cloneJson(entity.render);
  if (!finalRender || sameRender(drag.originalRender, finalRender)) return undefined;

  const path = `/scenes/${scene.id}/entities/${entity.id}/render` as ProjectPatch["path"];
  const result = editorTransactions.apply({
    actor: "user",
    patches: [{ op: "set", path, value: finalRender }],
    inversePatches: drag.originalRender ? [{ op: "set", path, value: drag.originalRender }] : [{ op: "delete", path }],
    diffSummary: `调整 ${entity.displayName} 当前可视体的${transformActionLabel(drag.kind)}。`,
    dirtyReason: `已调整 ${entity.displayName} 当前可视体`,
  });
  if (!result.ok) {
    return `可视体变换未提交${result.error}`;
  }
  return `已提交当前可视体变换${transformActionLabel(drag.kind)}。`;
}

function pushBehaviorParamPatch(
  patches: ProjectPatch[],
  inversePatches: ProjectPatch[],
  entityId: EntityId,
  key: string,
  nextValue: number,
  previousValue: unknown,
  hadPreviousValue: boolean,
): void {
  const path = `/scenes/${scene.id}/entities/${entityId}/behavior/params/${key}` as ProjectPatch["path"];
  patches.push({ op: "set", path, value: nextValue });
  inversePatches.push(hadPreviousValue ? { op: "set", path, value: previousValue } : { op: "delete", path });
}

function hasOwnParam(params: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(params, key);
}

function attackTouchKindLabel(kind: "normal" | "charged" | "superParry"): string {
  if (kind === "charged") return "蓄力攻击";
  if (kind === "superParry") return "振刀处决";
  return "普通攻击";
}

const combatLevelParamLabels: Record<string, string> = {
  attackControlLevel: "普通攻击控制",
  attackArmorLevel: "普通攻击霸体",
  chargedAttackControlLevel: "蓄力攻击控制",
  chargedAttackArmorLevel: "蓄力攻击霸体",
  parryControlLevel: "振刀控制",
  parryArmorLevel: "振刀霸体",
  superParryAttackControlLevel: "振刀处决控制",
  superParryAttackArmorLevel: "振刀处决霸体",
};

function isCombatLevelParamKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(combatLevelParamLabels, key);
}

function combatLevelParamLabel(key: string): string {
  return combatLevelParamLabels[key] || key;
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

function startCanvasCameraDrag(event: PointerEvent, options: { clearSelectionOnClick?: boolean } = {}): void {
  event.preventDefault();
  const canvas = renderer.canvas();
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = "grabbing";
  canvasCameraDrag = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    moved: false,
    clearSelectionOnClick: options.clearSelectionOnClick,
  };
  notice = "正在移动画布视角";
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
  renderer.canvas().style.cursor = spacePanActive ? "grab" : "default";
  if (!finishedDrag.moved && finishedDrag.clearSelectionOnClick) {
    selectedId = "";
    selectedIds = [];
    selectionArea = undefined;
    notice = "已清空选择；拖拽空白区域可移动画布视角";
    renderAll();
    return true;
  }
  const viewport = renderer.viewportState();
  notice = finishedDrag.moved
    ? `画布视角 ${Math.round(viewport.x)}, ${Math.round(viewport.y)} / ${Math.round(viewport.zoom * 100)}%`
    : `画布缩放 ${Math.round(viewport.zoom * 100)}%`;
  renderAll();
  return true;
}

function cancelCanvasPointerInteraction(event: PointerEvent): void {
  if (releaseGameplayMouseInputs(event)) {
    releaseCanvasPointer(event.pointerId);
    renderAll();
    return;
  }
  if (canvasCameraDrag?.pointerId === event.pointerId) {
    canvasCameraDrag = undefined;
    renderer.canvas().style.cursor = spacePanActive ? "grab" : "default";
    renderAll();
    return;
  }
  if (canvasDrag?.pointerId === event.pointerId) {
    canvasDrag = undefined;
    parentChildMoveDrag = undefined;
    syncWorldFromStore();
    renderAll();
    return;
  }
  if (multiCanvasDrag?.pointerId === event.pointerId) {
    multiCanvasDrag = undefined;
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

function startGameplayMouseInput(button: number, event?: Pick<Event, "preventDefault">): boolean {
  if (world.mode !== "game") return false;
  const inputKey = playerInputKeyForMouseButton(button);
  if (!inputKey) return false;
  event?.preventDefault();
  renderer.canvas().focus();
  gameplayMouseInputs.set(button, inputKey);
  world.setInput(inputKey, true);
  return true;
}

function finishGameplayMouseInput(button: number, event?: Pick<Event, "preventDefault">): boolean {
  const inputKey = gameplayMouseInputs.get(button);
  if (!inputKey) return false;
  event?.preventDefault();
  gameplayMouseInputs.delete(button);
  world.setInput(inputKey, hasGameplayMouseInput(inputKey));
  return true;
}

function releaseGameplayMouseInputs(event?: Pick<Event, "preventDefault">): boolean {
  if (gameplayMouseInputs.size === 0) return false;
  event?.preventDefault();
  gameplayMouseInputs.clear();
  world.setInput("attack", false);
  world.setInput("parry", false);
  return true;
}

function hasGameplayMouseInput(inputKey: GameplayMouseInputKey): boolean {
  for (const value of gameplayMouseInputs.values()) {
    if (value === inputKey) return true;
  }
  return false;
}

function normalizedWheelDeltaY(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(window.innerHeight, 1);
  return event.deltaY;
}

function toolSwitchNotice(tool: ToolId): string {
  if (tool === "select") return "选择工具：点击对象选中，拖动空白移动视角，按住 Shift 拖动框选。";
  if (tool === "square") return "方块工具：在画布上拖动创建一个方形本体";
  if (tool === "circle") return "圆形工具：在画布上拖动创建一个圆形本体；参数后续接到属性面板";
  if (tool === "leaf") return "柳叶笔：按住拖动画出自由轮廓，松开后自动闭环成碰撞本体";
  if (tool === "polygon") return "多边形工具：逐点点击顶点，点确认或右键自动闭环";
  if (tool === "superBrush") return "超级画笔：拖动圈出问题，单击对象可追加目标，然后在任务框描述要改什么";
  return "已切换工具";
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
  notice = "已进入超级画笔模式，右键撤销上一笔，顶部确认后填写任务";
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
    strokeTargetRefs: pendingBrush?.strokeTargetRefs,
    manualTargetRefs: pendingBrush?.manualTargetRefs,
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
  notice = "正在记录超级画笔；可以连续画多笔，随后在任务框描述要改什么";
  renderAll();
}

function onCanvasPointerDown(event: PointerEvent): void {
  activeSurface = "canvas";
  if (world.mode === "game") {
    if (startGameplayMouseInput(event.button, event)) {
      renderer.canvas().setPointerCapture(event.pointerId);
    }
    return;
  }
  if (event.button === 1) {
    startCanvasCameraDrag(event);
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();
  if (spacePanActive && world.mode === "editorFrozen") {
    startCanvasCameraDrag(event);
    return;
  }
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const shapeTool = shapeToolFromActive(activeTool);
  if (shapeTool && world.mode === "editorFrozen") {
    shapeDrag = { pointerId: event.pointerId, tool: shapeTool, start: point, current: point, moved: false, points: [point] };
    renderer.canvas().setPointerCapture(event.pointerId);
    contextMenu = undefined;
    notice = shapeTool === "leaf" ? "正在手绘轮廓；松开后自动闭环" : `拖动创建${toolLabel(shapeTool)}本体。`;
    renderCanvasOnly();
    return;
  }
  if (activeTool === "polygon" && world.mode === "editorFrozen") {
    polygonDraft = {
      points: [...(polygonDraft?.points || []), point],
    };
    contextMenu = undefined;
    notice = polygonDraft.points.length >= 3 ? "多边形顶点已加入；点确认或右键闭环" : "继续点击添加多边形顶点";
    renderAll();
    return;
  }
  if (activeTool === "select" && world.mode === "editorFrozen") {
    const entityIds = currentSelectedEntityIds();
    if (entityIds.length > 1) {
      const selectedEntities = entityIds.map((id) => editableEntity(id)).filter(Boolean) as Entity[];
      const handle = renderer.pickMultiTransformHandle(selectedEntities, point);
      if (handle) {
        startMultiCanvasTransform(event, selectedEntities, handle, point);
        renderAll();
        return;
      }
    } else {
      const selected = selectedEntity();
      const handle = renderer.pickTransformHandle(selected, selectedPart, point);
      if (selected && handle) {
        const part = handle === "core" ? "body" : selectedPart;
        startCanvasTransform(event, selected.id, part, handle, point);
        renderAll();
        return;
      }
      if (selected) {
        const excludeBody = selectedPart === "presentation";
        const hit = renderer.pickCanvasTarget(world, point, { entityId: selected.id, part: selectedPart }, { excludeBody });
        if (hit && hit.entity.id === selected.id && hit.part === selectedPart) {
          startCanvasTransform(event, selected.id, selectedPart, "core", point);
          renderAll();
          return;
        }
      }
    }
  }
  if (activeTool === "superBrush") {
    startSuperBrushStroke(event, point);
    return;
  }

  const picked = renderer.pickCanvasTarget(world, point, selectedId ? { entityId: selectedId, part: selectedPart } : undefined);
  if (picked) {
    const pickedStoredEntity = scene.entities[picked.entity.id];
    const pickedAttackTouch = isAttackTouchDebugEntity(picked.entity);
    if ((!pickedStoredEntity || !pickedStoredEntity.persistent) && !pickedAttackTouch) return;
    selectedId = picked.entity.id;
    selectedPart = pickedAttackTouch ? "body" : picked.part;
    selectedIds = [picked.entity.id as EntityId];
    selectionArea = undefined;
    if (pickedAttackTouch && activeTool === "select" && world.mode === "editorFrozen") {
      startCanvasTransform(event, picked.entity.id, "body", "core", point);
      renderAll();
      return;
    }
    notice = `已选择${picked.entity.displayName}${picked.part === "presentation" ? "的当前可视体" : "的本体"}`;
    renderAll();
    return;
  }
  if (activeTool === "select" && world.mode === "editorFrozen") {
    if (!event.shiftKey) {
      startCanvasCameraDrag(event, { clearSelectionOnClick: true });
      return;
    }
    selectionBoxDrag = { pointerId: event.pointerId, start: point, current: point, moved: false };
    renderer.canvas().setPointerCapture(event.pointerId);
    notice = "按住 Shift 拖动框选对象；空白拖动画布会移动视角";
    renderCanvasOnly();
  }
}

function onCanvasMouseDown(event: MouseEvent): void {
  startGameplayMouseInput(event.button, event);
}

function onWindowMouseUp(event: MouseEvent): void {
  finishGameplayMouseInput(event.button, event);
}

function onCanvasContextMenu(event: MouseEvent): void {
  event.preventDefault();
  if (world.mode === "game") {
    contextMenu = undefined;
    return;
  }
  if (activeTool === "superBrush" || pendingBrush || drawingBrush) {
    undoLastSuperBrushStrokeOrCancel();
    return;
  }
  if (activeTool === "polygon" && polygonDraft?.points.length) {
    finishPolygonDraft();
    return;
  }
  if (drawingBrush || canvasDrag || canvasCameraDrag || shapeDrag) {
    contextMenu = undefined;
    renderAll();
    return;
  }

  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const pickHint = selectedIds.length <= 1 && selectedId ? { entityId: selectedId, part: selectedPart } : undefined;
  const picked = renderer.pickCanvasTarget(world, point, pickHint);

  if (picked) {
    const alreadySelected = selectedIds.length > 1 && selectedIds.includes(picked.entity.id as EntityId);
    if (alreadySelected) {
      showMultiEntityContextMenu(picked.entity, event.clientX, event.clientY, point);
    } else {
      selectedId = picked.entity.id;
      selectedPart = "body";
      selectedIds = [picked.entity.id as EntityId];
      selectionArea = undefined;
      showEntityContextMenu(picked.entity, picked.part, event.clientX, event.clientY, point);
    }
    return;
  }

  if (selectedIds.length > 1) {
    showMultiEntityContextMenu(null, event.clientX, event.clientY, point);
    return;
  }

  showCanvasContextMenu(event.clientX, event.clientY, point);
}

function showEntityContextMenu(entity: Entity, part: CanvasTargetPart, clientX: number, clientY: number, worldPoint: Vec2): void {
  const items = contextMenuItemsForEntity(entity, part);
  contextMenu = {
    ...clampedContextMenuPosition(clientX, clientY, items.length),
    title: entity.displayName,
    entityId: entity.id,
    part: "body",
    worldPoint,
    items,
  };
  windowMenuOpen = false;
  renderAll();
}

function showMultiEntityContextMenu(entity: Entity | null, clientX: number, clientY: number, worldPoint: Vec2): void {
  const count = selectedIds.length;
  const items: ContextMenuItem[] = [
    { action: "duplicate-selected", label: `复制选中的 ${count} 个本体`, hint: "向右下偏移一段" },
    { action: "delete-selected", label: `删除选中的 ${count} 个本体`, danger: true, separatorBefore: true },
    { action: "clear-selection", label: "清除选择", separatorBefore: true },
    { action: "reset-viewport", label: "重置视角", separatorBefore: true },
  ];
  contextMenu = {
    ...clampedContextMenuPosition(clientX, clientY, items.length),
    title: entity ? `已选中 ${count} 个本体` : `画布 · 已选中 ${count} 个本体`,
    entityId: entity?.id,
    part: "body",
    worldPoint,
    items,
  };
  windowMenuOpen = false;
  renderAll();
}

function showCanvasContextMenu(clientX: number, clientY: number, worldPoint: Vec2): void {
  const hasSelection = Boolean(selectedId || selectedIds.length || selectionArea);
  const items: ContextMenuItem[] = [
    { action: "create-box", label: "新建方块", hint: "64 x 64 对象" },
    { action: "create-circle", label: "新建圆形", hint: "64 x 64 对象" },
    ...(hasSelection ? [{ action: "clear-selection" as const, label: "清除选择", separatorBefore: true }] : []),
    { action: "reset-viewport", label: "重置视角", hint: "回到默认缩放和位", separatorBefore: true },
  ];
  contextMenu = {
    ...clampedContextMenuPosition(clientX, clientY, items.length),
    title: "画布",
    worldPoint,
    items,
  };
  windowMenuOpen = false;
  renderAll();
}

function contextMenuItemsForEntity(entity: Entity, part: CanvasTargetPart): ContextMenuItem[] {
  void part;
  return [
    { action: "select-target", label: "选择", disabled: selectedId === entity.id && selectedPart === "body" },
    { action: "rename-entity", label: "重命名", disabled: !entity.persistent },
    { action: "duplicate-entity", label: "复制", hint: "向右下偏移一段", disabled: !entity.persistent },
    { action: "duplicate-here", label: "复制到此", disabled: !entity.persistent },
    { action: "delete-target", label: "删除", danger: true, separatorBefore: true, disabled: !entity.persistent },
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
    notice = "视角已重置";
    renderAll();
    return;
  }

  if (action === "clear-selection") {
    selectedId = "";
    selectedIds = [];
    selectedPart = "body";
    selectionArea = undefined;
    notice = "已清除选择";
    renderAll();
    return;
  }

  if (action === "create-box" || action === "create-circle") {
    createEntityFromContextMenu(action === "create-box" ? "square" : "circle", state.worldPoint);
    return;
  }

  if (action === "delete-selected") {
    deleteCurrentSelection();
    return;
  }

  if (action === "duplicate-selected") {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      notice = "没有选中的本体";
      renderAll();
      return;
    }
    applyBatchContextMenuTransaction(planBatchDuplicateEntitiesTransaction(scene, ids));
    return;
  }

  const entity = state.entityId ? editableEntity(state.entityId) : undefined;
  if (!entity) {
    notice = "右键目标已经不存在";
    syncWorldFromStore();
    renderAll();
    return;
  }

  if (action === "select-target") {
    selectedId = entity.id;
    selectedPart = "body";
    selectedIds = [entity.id as EntityId];
    selectionArea = undefined;
    notice = "已选择";
    renderAll();
    return;
  }

  if (action === "rename-entity") {
    const nextName = window.prompt("重命名本体", entity.displayName);
    if (nextName === null) {
      notice = "已取消重命名";
      renderAll();
      return;
    }
    applyContextMenuTransaction(planRenameEntityTransaction(scene, entity, nextName));
    return;
  }

  if (action === "delete-target") {
    if (!window.confirm(`删除「${entity.displayName}」？这个操作会进入项目历史。`)) {
      notice = "已取消删除";
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

  if (action === "duplicate-here") {
    const positionOffset = state.worldPoint
      ? {
          x: state.worldPoint.x - entity.transform.position.x,
          y: state.worldPoint.y - entity.transform.position.y,
        }
      : undefined;
    applyContextMenuTransaction(planDuplicateEntityTransaction(scene, entity, { positionOffset }));
    return;
  }

}

function createEntityFromContextMenu(tool: ShapeToolId, point?: Vec2): void {
  if (world.mode !== "editorFrozen") {
    notice = "运行中不能创建本体，请先冻结编辑";
    renderAll();
    return;
  }
  if (!point) {
    notice = "没有可用的右键位置，未创建本体";
    renderAll();
    return;
  }
  const entity = createEntityFromShapeDrag({
    pointerId: -1,
    tool,
    start: point,
    current: point,
    moved: false,
    points: [point],
  });
  if (!entity) {
    notice = "创建失败：右键位置无效";
    renderAll();
    return;
  }
  applyCreatedEntity(entity, `右键创建${toolLabel(tool)}本体${entity.displayName}`);
}

function applyContextMenuTransaction(planResult: Result<ContextMenuTransactionPlan>): void {
  if (!planResult.ok) {
    notice = `右键操作未提交：${planResult.error}`;
    renderAll();
    return;
  }
  const result = editorTransactions.apply({
    actor: "user",
    patches: planResult.value.patches,
    inversePatches: planResult.value.inversePatches,
    diffSummary: planResult.value.diffSummary,
    dirtyReason: planResult.value.notice,
  });
  if (!result.ok) {
    notice = `右键操作未提交：${result.error}`;
    renderAll();
    return;
  }
  if (planResult.value.selectedId && editableEntity(planResult.value.selectedId)) {
    selectedId = planResult.value.selectedId;
    selectedPart = planResult.value.selectedPart || "body";
    selectedIds = [planResult.value.selectedId];
    selectionArea = undefined;
  } else if (!editableEntity(selectedId)) {
    selectedId = firstEditableEntityId();
    selectedPart = "body";
    selectedIds = selectedId ? [selectedId as EntityId] : [];
    selectionArea = undefined;
  } else if (planResult.value.selectedPart) {
    selectedPart = planResult.value.selectedPart;
  }
  notice = planResult.value.notice;
  renderAll();
}

function applyBatchContextMenuTransaction(planResult: Result<ContextMenuTransactionPlan>): void {
  if (!planResult.ok) {
    notice = `批量操作未提交：${planResult.error}`;
    renderAll();
    return;
  }
  const result = editorTransactions.apply({
    actor: "user",
    patches: planResult.value.patches,
    inversePatches: planResult.value.inversePatches,
    diffSummary: planResult.value.diffSummary,
    dirtyReason: planResult.value.notice,
  });
  if (!result.ok) {
    notice = `批量操作未提交：${result.error}`;
    renderAll();
    return;
  }
  if (planResult.value.selectedId && editableEntity(planResult.value.selectedId)) {
    selectedId = planResult.value.selectedId;
    selectedPart = planResult.value.selectedPart || "body";
    selectedIds = [planResult.value.selectedId];
  } else {
    selectedId = "";
    selectedIds = [];
  }
  selectionArea = undefined;
  notice = planResult.value.notice;
  renderAll();
}

function deleteCurrentSelection(): void {
  const ids = currentSelectedEntityIds();
  if (ids.length === 0) {
    notice = "没有选中的本体";
    renderAll();
    return;
  }
  const label = ids.length === 1 ? "1 个本体" : `${ids.length} 个本体`;
  if (!window.confirm(`删除选中的 ${label}？这个操作会进入项目历史。`)) {
    notice = "已取消删除";
    renderAll();
    return;
  }
  applyBatchContextMenuTransaction(planBatchDeleteEntitiesTransaction(scene, ids));
}

function renameEntityFromInput(entityId: string, rawDisplayName: string): void {
  const entity = editableEntity(entityId);
  if (!entity) {
    notice = "重命名目标已经不存在";
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
  if (multiCanvasDrag && multiCanvasDrag.pointerId === event.pointerId) {
    event.preventDefault();
    updateMultiCanvasTransform(point);
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
  if (finishGameplayMouseInput(event.button, event)) {
    releaseCanvasPointer(event.pointerId);
    return;
  }
  if (finishCanvasCameraDrag(event)) return;
  if (canvasDrag && canvasDrag.pointerId === event.pointerId) {
    const finishedDrag = canvasDrag;
    const finishedParentChildMove = parentChildMoveDrag;
    canvasDrag = undefined;
    parentChildMoveDrag = undefined;
    releaseCanvasPointer(event.pointerId);
    notice = commitCanvasTransform(finishedDrag, finishedParentChildMove) || dragNotice(finishedDrag.kind, "finish");
    renderAll();
    return;
  }
  if (multiCanvasDrag && multiCanvasDrag.pointerId === event.pointerId) {
    const finishedDrag = multiCanvasDrag;
    multiCanvasDrag = undefined;
    releaseCanvasPointer(event.pointerId);
    notice = commitMultiCanvasTransform(finishedDrag) || multiDragNotice(finishedDrag.kind, "finish", finishedDrag.entries.length);
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
    const strokeTargetRefs = {
      ...(pendingBrush?.strokeTargetRefs || {}),
      [createdStroke.value.id]: strokeTargets,
    };
    pendingBrush = rebuildSuperBrushDraftTargets({
      strokes: [...(pendingBrush?.strokes || []), createdStroke.value],
      annotations: pendingBrush?.annotations || [],
      selectionTargets: pendingBrush?.selectionTargets || [],
      strokeTargetRefs,
      manualTargetRefs: pendingBrush?.manualTargetRefs,
      capturedSnapshotId: pendingBrush?.capturedSnapshotId,
      selectionBox: pendingBrush?.selectionBox,
    });
    notice = superBrushRecordedNotice();
  } else if (finishedStart && distance(finishedStart, finishedEnd) < superBrushClickDistance()) {
    const clickTargets = targetsForSuperBrushClick(finishedEnd);
    pendingBrush =
      clickTargets.length > 0
        ? rebuildSuperBrushDraftTargets({
            strokes: pendingBrush?.strokes || [],
            annotations: pendingBrush?.annotations || [],
            selectionTargets: pendingBrush?.selectionTargets || [],
            strokeTargetRefs: pendingBrush?.strokeTargetRefs,
            manualTargetRefs: mergeSuperBrushTargets(pendingBrush?.manualTargetRefs, clickTargets),
            capturedSnapshotId: pendingBrush?.capturedSnapshotId,
            selectionBox: pendingBrush?.selectionBox,
          })
        : pendingBrush;
    if (pendingBrush && hasMeaningfulSuperBrushContext(pendingBrush)) {
      notice = superBrushRecordedNotice();
    } else {
      pendingBrush = undefined;
      notice = "超级画笔标记太短；请拖动画一笔，或单击对象追加目标";
    }
  } else if (pendingBrush && !hasMeaningfulSuperBrushContext(pendingBrush)) {
    pendingBrush = undefined;
    notice = "超级画笔标记太短；请拖动画一笔，或单击对象追加目标";
  }
  currentStrokePoints = [];
  renderAll();
}

function openSuperBrushTaskDialog(): void {
  if (!pendingBrush || !hasMeaningfulSuperBrushContext(pendingBrush)) {
    notice = "请先用超级画笔至少画一笔，再确认画笔";
    renderAll();
    return;
  }
  superBrushTaskDialogOpen = true;
  superBrushTaskError = "";
  superBrushTaskInput.value = "";
  notice = "填写这次超级画笔任务，排队后会恢复编辑界面";
  renderAll();
  superBrushTaskInput.focus();
}

function closeSuperBrushTaskDialog(): void {
  if (!superBrushTaskDialogOpen) return;
  superBrushTaskDialogOpen = false;
  superBrushTaskError = "";
  notice = "已返回超级画笔，可以继续补画或确认";
  renderAll();
  renderer.canvas().focus();
}

function queueSuperBrushTaskFromDialog(): void {
  const draft = pendingBrush;
  const userText = superBrushTaskInput.value.trim();
  if (!draft || !hasMeaningfulSuperBrushContext(draft)) {
    superBrushTaskError = "画笔上下文已经为空，请返回重新绘制";
    renderAll();
    return;
  }
  if (!userText) {
    superBrushTaskError = "请先描述这次超级画笔要让 AI 改什么";
    superBrushTaskInput.focus();
    renderAll();
    return;
  }

  const result = createTaskFromSuperBrush({
    userText,
    draft,
    visualEvidence: buildSuperBrushVisualEvidenceInput(draft),
  });
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
  markProjectDirty("超级画笔任务已排");
  notice = "超级画笔任务已排队";
  renderAll();
}

function buildSuperBrushVisualEvidenceInput(draft: SuperBrushDraft): BrushVisualEvidenceInput {
  const viewport = renderer.viewportState();
  const canvas = renderer.canvas();
  const canvasSize = {
    x: Math.max(1, canvas.clientWidth || canvas.width || 1),
    y: Math.max(1, canvas.clientHeight || canvas.height || 1),
  };
  const evidence = createBrushVisualEvidence(draft, {
    viewport: {
      worldCenter: { x: viewport.x, y: viewport.y },
      zoom: viewport.zoom,
      canvasSize,
    },
    entities: editableEntities(),
  });
  return {
    capturedAt: evidence.capture.capturedAt,
    viewport: {
      worldCenter: { x: viewport.x, y: viewport.y },
      zoom: viewport.zoom,
      canvasSize,
    },
    entities: editableEntities(),
    imageRefs: captureBrushEvidenceImageRefs(evidence),
  };
}

function captureBrushEvidenceImageRefs(evidence: BrushVisualEvidence): BrushVisualEvidenceInput["imageRefs"] {
  const refs: NonNullable<BrushVisualEvidenceInput["imageRefs"]> = {};
  for (const frame of evidence.frames) {
    const imageRef = captureBrushFrameDataUrl(frame);
    if (!imageRef) continue;
    refs[frame.id] = { imageRef, imageMime: "image/jpeg" };
  }
  return Object.keys(refs).length > 0 ? refs : undefined;
}

function captureBrushFrameDataUrl(frame: BrushVisualFrame): string | undefined {
  const canvas = renderer.canvas();
  const sourceRect = frame.pixelRect || { x: 0, y: 0, w: canvas.clientWidth || canvas.width, h: canvas.clientHeight || canvas.height };
  const cssWidth = Math.max(1, canvas.clientWidth || canvas.width || 1);
  const cssHeight = Math.max(1, canvas.clientHeight || canvas.height || 1);
  const visibleRect = intersectRects(sourceRect, { x: 0, y: 0, w: cssWidth, h: cssHeight });
  if (!visibleRect || visibleRect.w < 2 || visibleRect.h < 2) return undefined;

  const scaleX = canvas.width / cssWidth;
  const scaleY = canvas.height / cssHeight;
  const sx = Math.max(0, Math.round(visibleRect.x * scaleX));
  const sy = Math.max(0, Math.round(visibleRect.y * scaleY));
  const sw = Math.max(1, Math.min(canvas.width - sx, Math.round(visibleRect.w * scaleX)));
  const sh = Math.max(1, Math.min(canvas.height - sy, Math.round(visibleRect.h * scaleY)));
  const maxSide = frame.role === "overview" ? 900 : 720;
  const outputScale = Math.min(1, maxSide / Math.max(sw, sh));
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(sw * outputScale));
  output.height = Math.max(1, Math.round(sh * outputScale));
  const context = output.getContext("2d");
  if (!context) return undefined;
  context.drawImage(canvas, sx, sy, sw, sh, 0, 0, output.width, output.height);
  try {
    return output.toDataURL("image/jpeg", 0.82);
  } catch {
    return undefined;
  }
}

function intersectRects(left: Rect, right: Rect): Rect | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const maxX = Math.min(left.x + left.w, right.x + right.w);
  const maxY = Math.min(left.y + left.h, right.y + right.h);
  if (maxX <= x || maxY <= y) return undefined;
  return { x, y, w: maxX - x, h: maxY - y };
}

function cancelSuperBrushSession(): void {
  if (!isSuperBrushModeActive() && !pendingBrush && !drawingBrush && currentStrokePoints.length === 0) {
    notice = "没有待取消的超级画笔上下文";
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
  notice = "已取消超级画笔，编辑界面已恢复";
  renderAll();
}

function undoLastSuperBrushStrokeOrCancel(): void {
  if (drawingBrush) {
    drawingBrush = false;
    drawingBrushPointerId = undefined;
    brushStartPoint = undefined;
    currentStrokePoints = [];
    notice = "已取消当前这一笔";
    renderAll();
    return;
  }
  if (!pendingBrush || pendingBrush.strokes.length <= 1) {
    cancelSuperBrushSession();
    return;
  }
  pendingBrush = rebuildSuperBrushDraftTargets({
    ...pendingBrush,
    strokes: pendingBrush.strokes.slice(0, -1),
  });
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
    notice = "已清空选择；任务会作为全局任务排队";
    renderAll();
    return;
  }

  const rect = rectFromPoints(finished.start, finished.current);
  const targets = renderer.targetsInRect(world, rect);
  const entityIds = uniqueEntityIds(targets.map((target) => target.entity.id as EntityId)).filter((entityId) => Boolean(editableEntity(entityId)));
  if (entityIds.length > 0) {
    selectionArea = undefined;
    selectedIds = entityIds;
    selectedId = entityIds[0];
    selectedPart = "body";
    notice = `已框选 ${entityIds.length} 个本体；任务会作用于这些对象。`;
  } else {
    selectionArea = rect;
    selectedIds = [];
    selectedId = "";
    selectedPart = "body";
    notice = "已框选空白区域；任务会作用于这个区域";
  }
  renderAll();
}

function finishShapeDrag(event: PointerEvent): void {
  if (!shapeDrag) return;
  const finished = shapeDrag;
  shapeDrag = undefined;
  releaseCanvasPointer(event.pointerId);
  if (world.mode !== "editorFrozen") {
    notice = "运行中不能创建本体，请先冻结编辑";
    renderAll();
    return;
  }

  const entity = createEntityFromShapeDrag(finished);
  if (!entity) {
    notice = "轮廓点太少，未创建本体";
    renderAll();
    return;
  }
  applyCreatedEntity(entity, `创建${toolLabel(finished.tool)}本体${entity.displayName}`);
}

function finishPolygonDraft(): void {
  if (!polygonDraft?.points.length) {
    notice = "请先点击至少 3 个顶点";
    renderAll();
    return;
  }
  if (world.mode !== "editorFrozen") {
    notice = "运行中不能创建本体，请先冻结编辑";
    renderAll();
    return;
  }
  if (polygonDraft.points.length < 3) {
    notice = "多边形至少需要 3 个顶点";
    renderAll();
    return;
  }
  const entity = createPolygonEntityFromWorldPoints(polygonDraft.points, "Polygon Body", ["entity", "polygon-collider"]);
  polygonDraft = undefined;
  if (!entity) {
    notice = "多边形面积太小，未创建本体";
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

  const result = editorTransactions.apply({
    actor: "user",
    patches,
    inversePatches,
    diffSummary,
    dirtyReason: "已创建本体",
  });
  if (!result.ok) {
    notice = `创建本体失败${result.error}`;
    renderAll();
    return;
  }
  selectedId = entity.id;
  selectedIds = [entity.id];
  selectedPart = "body";
  selectionArea = undefined;
  activeTool = "select";
  notice = `已创建${entity.displayName}。`;
  renderAll();
}

function onKeyDown(event: KeyboardEvent): void {
  const isShortcut = (event.ctrlKey || event.metaKey) && !event.altKey && !isTypingTarget(event.target);
  if (isShortcut) {
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y") {
      event.preventDefault();
      if (event.repeat) return;

      const isRedo = key === "y" || event.shiftKey;
      const previousSceneId = store.peekProject().activeSceneId;
      const didApply = isRedo ? store.redo() : store.undo();
      if (!didApply) {
        notice = isRedo ? "无可重做" : "无可撤销";
        renderAll();
        return;
      }
      const nextSceneId = store.peekProject().activeSceneId;
      if (previousSceneId !== nextSceneId || world.sceneId !== nextSceneId) {
        rebuildWorldFromStore();
        resetSelectionToFirstEditableEntity();
      } else {
        syncWorldFromStore();
      }
      markProjectDirty(isRedo ? "已重做" : "已撤销");
      renderAll();
      return;
    }
  }

  if (event.key === "Control" || event.key === "Meta") {
    setRotationSnapEnabled(false);
    setMoveSnapEnabled(false);
  }
  if (event.code === "Space" && world.mode !== "game" && !isTypingTarget(event.target)) {
    event.preventDefault();
    spacePanActive = true;
    renderer.canvas().style.cursor = "grab";
    return;
  }
  if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey && world.mode !== "game" && !isTypingTarget(event.target)) {
    event.preventDefault();
    const selected = selectedId || selectedIds[0];
    if (selected) focusEntityOnCanvas(selected, selectedPart);
    else fitWorldToCanvas("manual");
    return;
  }
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
      notice = "多边形绘制已取消";
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
  if (event.key === "Escape" && worldManagerOpen && !isTypingTarget(event.target)) {
    event.preventDefault();
    worldManagerOpen = false;
    renderUi();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && !isTypingTarget(event.target)) {
    event.preventDefault();
    if (event.repeat) return;
    contextMenu = undefined;
    deleteCurrentSelection();
    return;
  }
  handleEditorKeyDown(event, {
    isTypingTarget,
    onToggleRun: toggleRun,
    setInput: (key, pressed) => world.setInput(key, pressed),
  });
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key === "Control" || event.key === "Meta") {
    resetTransformSnapState();
  }
  if (event.code === "Space") {
    spacePanActive = false;
    renderer.canvas().style.cursor = "default";
  }
  handleEditorKeyUp(event, {
    isTypingTarget,
    onToggleRun: toggleRun,
    setInput: (key, pressed) => world.setInput(key, pressed),
  });
}

function resetTransformSnapState(): void {
  setRotationSnapEnabled(true);
  setMoveSnapEnabled(true);
  spacePanActive = false;
}

function toggleRun(): void {
  const snapshot = world.toggleEditorFreeze();
  if (world.mode === "game") {
    releaseGameplayInputs();
    windowMenuOpen = false;
    contextMenu = undefined;
    enterGameMode(root);
    syncGameCameraToPlayer();
  } else {
    releaseGameplayInputs();
    leaveGameMode(root);
  }
  notice =
    world.mode === "game"
      ? "游戏运行中，当前画布继续计时，按 Z 原地冻结"
      : `编辑冻结，当前运行状态已暂停${snapshot ? `，捕捉帧 ${snapshot.frame}` : ""}`;
  renderAll();
}

function syncGameCameraToPlayer(): void {
  const player = gameCameraPlayer();
  if (!player) return;
  renderer.centerOnWorldPoint({ x: player.transform.position.x, y: player.transform.position.y - 80 }, 1);
}

function gameCameraPlayer(): Entity | undefined {
  return world.allEntities().find((entity) => entity.internalName === "Player") || world.allEntities().find((entity) => entity.behavior?.builtin === "playerPlatformer");
}

function releaseGameplayInputs(): void {
  releaseGameplayMouseInputs();
  world.setInput("left", false);
  world.setInput("right", false);
  world.setInput("jump", false);
  world.setInput("attack", false);
  world.setInput("parry", false);
}

async function saveCurrentProject(): Promise<void> {
  try {
    const projectForSave = buildProjectForSave({
      project: store.exportProject(),
      scene,
      entities: world.entities.values(),
    });
    const result = await saveProjectFromEditor(projectForSave);
    if (result.result.storage === "api") lastSeenDiskProjectSignature = projectDiskSignature(projectForSave);
    notice = result.notice;
  } catch (error) {
    notice = `保存失败${error instanceof Error ? error.message : String(error)}`;
  }
  renderAll();
} // end rebuildWorldFromStore

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
    notice = "请先结束当前拖动或画笔操作，然后再从磁盘刷新";
    autoSave.setStatus("自动保存等待当前操作结束");
    renderAll();
    return;
  }
  try {
    const result = await loadProjectForEditor();
    if (!result.project) {
      notice = result.notice;
      autoSave.setStatus("磁盘没有可载入项");
      renderAll();
      return;
    }
    applyLoadedProjectFromDisk(result.project, "已从磁盘刷新，自动保存就绪", `已从磁盘刷新${result.notice}`);
  } catch (error) {
    notice = `刷新失败${error instanceof Error ? error.message : String(error)}`;
  }
  renderAll();
}

async function forceRefreshProjectFromDisk(source: "manual" | "auto"): Promise<void> {
  try {
    const result = await forceLoadProjectFromDiskForEditor({ writeLocal: true });
    if (!result.project) {
      notice = result.notice;
      autoSave.setStatus("磁盘没有可载入项");
      renderAll();
      return;
    }
    applyLoadedProjectFromDisk(
      result.project,
      source === "auto" ? "已自动载入磁盘更新，自动保存就绪" : "已强制从磁盘刷新，自动保存就绪",
      source === "auto" ? `检测到磁盘项目更新，已自动载入${result.notice}` : `已强制从磁盘刷新${result.notice}`,
    );
  } catch (error) {
    notice = `强制刷新失败${error instanceof Error ? error.message : String(error)}`;
  }
  renderAll();
}

async function autoLoadProjectFromDisk(): Promise<void> {
  if (diskAutoLoadInFlight || document.hidden) return;
  if (autoSave.hasPendingChanges || drawingBrush || Boolean(canvasDrag || shapeDrag || polygonDraft)) return;
  diskAutoLoadInFlight = true;
  try {
    const result = await forceLoadProjectFromDiskForEditor({ writeLocal: false });
    if (!result.project) return;
    const diskSignature = projectDiskSignature(result.project);
    if (diskSignature === lastSeenDiskProjectSignature) return;
    if (!isProjectNewerThanCurrent(result.project)) return;
    if (isTypingTarget(document.activeElement)) {
      if (pendingDiskUpdateSignature !== diskSignature) {
        pendingDiskUpdateSignature = diskSignature;
        notice = "检测到磁盘项目更新；当前正在输入，结束输入后会自动载入，或点右侧“从磁盘刷新”";
        renderAll();
      }
      return;
    }
    await forceRefreshProjectFromDisk("auto");
  } finally {
    diskAutoLoadInFlight = false;
  }
}

function applyLoadedProjectFromDisk(projectFromDisk: Project, saveStatus: string, nextNotice: string): void {
  const normalizedProject = normalizeProjectDefaults(repairKnownStarterLabels(projectFromDisk));
  store.replace(normalizedProject);
  saveProjectLocallyFromEditor(normalizedProject);
  rebuildWorldFromStore();
  selectedId = firstEditableEntityId();
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
  parentChildMoveDrag = undefined;
  shapeDrag = undefined;
  polygonDraft = undefined;
  invalidateUiRenderCache();
  lastSeenDiskProjectSignature = projectDiskSignature(normalizedProject);
  pendingDiskUpdateSignature = "";
  autoSave.reset(saveStatus);
  notice = nextNotice;
}

function projectDiskSignature(projectSnapshot: Project): string {
  return [
    projectSnapshot.meta.updatedAt,
    projectSnapshot.activeSceneId,
    Object.keys(projectSnapshot.scenes).length,
    Object.keys(projectSnapshot.resources).length,
    Object.keys(projectSnapshot.tasks).length,
    Object.keys(projectSnapshot.transactions).length,
  ].join("|");
}

function isProjectNewerThanCurrent(projectFromDisk: Project): boolean {
  const diskTime = Date.parse(projectFromDisk.meta.updatedAt);
  const currentProject = store.peekProject();
  const currentTime = Date.parse(currentProject.meta.updatedAt);
  if (Number.isNaN(diskTime) || Number.isNaN(currentTime)) {
    return projectDiskSignature(projectFromDisk) !== projectDiskSignature(currentProject);
  }
  return diskTime > currentTime;
}

function invalidateUiRenderCache(): void {
  (Object.keys(uiRenderState) as Array<keyof typeof uiRenderState>).forEach((key) => {
    uiRenderState[key] = "";
  });
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
  markProjectDirty("后台维护已更");
  taskSummaries.setMaintenance(JSON.stringify(maintenanceSummary(report, "auto")));
  notice = `后台清理完成${report.deletedSnapshotIds.length} 个旧快照。`;
  renderUi();
}

function renderAll(): void {
  const projectSnapshot = store.peekProject();
  renderCanvasNow(projectSnapshot);
  renderUi(projectSnapshot);
}

function renderCanvasNow(projectSnapshot?: Project): void {
  const snapshotProject = projectSnapshot || store.peekProject();
  const showEditorOverlays = world.mode !== "game";
  if (world.mode === "game") syncGameCameraToPlayer();
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
  editorPerformance.recordRender(renderer.performanceStats());
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
  const base = `工具${toolLabel(activeTool)}`;
  if (drawingBrush) return `${base} · 正在记录第 ${(pendingBrush?.strokes.length || 0) + 1} 笔`;
  if (pendingBrush && hasMeaningfulSuperBrushContext(pendingBrush)) return `${base} · ${summarizeSuperBrushDraft(pendingBrush)}`;
  if (activeTool === "superBrush") return `${base} · 拖动画笔或单击对象`;
  return base;
}

function superBrushSummaryText(): string {
  if (superBrushTaskDialogOpen && pendingBrush) return `已确认：${summarizeSuperBrushDraft(pendingBrush)}`;
  if (drawingBrush) return `正在记录第 ${(pendingBrush?.strokes.length || 0) + 1} 笔；右键取消当前笔`;
  if (pendingBrush && hasMeaningfulSuperBrushContext(pendingBrush)) return `${summarizeSuperBrushDraft(pendingBrush)}；右键撤销上一笔`;
  if (activeTool === "superBrush") return "拖动画布开始标记，右键撤销上一笔";
  return "拖动画布开始标记";
}

function renderUi(projectSnapshot?: Project): void {
  const snapshotProject = projectSnapshot || store.peekProject();
  const brushState = superBrushUiState();
  const brushSummary = superBrushSummaryText();
  const canConfirmBrush = Boolean(pendingBrush && !drawingBrush && hasMeaningfulSuperBrushContext(pendingBrush as SuperBrushDraft));

  root.hidden = false;
  root.removeAttribute("aria-hidden");
  root.dataset.ui = "workbench-preview";
  root.dataset.tool = activeTool;
  root.dataset.superBrushState = brushState;
  root.dataset.superBrushActive = String(isSuperBrushModeActive());
  root.dataset.runtimeMode = world.mode;
  renderTree(snapshotProject);
  renderTasks(snapshotProject);
  renderInspector(snapshotProject);
  renderResources(snapshotProject);
  renderOutput();
  renderWorldManager(snapshotProject);
  renderWorldSpeedControl();
  renderFrame();
  renderContextMenu();
  renderMinimizedTray();
  toolButtons.forEach((button) => {
    const isActive = parseToolId(button.dataset.tool) === activeTool;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  surfaceButtons.forEach((button) => {
    const target = button.dataset.surfaceTarget;
    const isActive = target === activeSurface;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(isActive));
  });
  modeNode.textContent = world.mode === "game" ? "游戏运行" : "编辑冻结";
  modeNode.classList.toggle("is-running", world.mode === "game");
  modeNode.setAttribute("role", "status");
  modeNode.setAttribute("aria-label", `Runtime mode: ${modeNode.textContent || ""}`);
  saveStatusNode.textContent = autoSave.status;
  saveStatusNode.setAttribute("role", "status");
  pointerNode.textContent = superBrushPointerText();
  pointerNode.setAttribute("aria-live", "polite");
  noticeNode.textContent = notice;
  noticeNode.setAttribute("role", "status");
  noticeNode.setAttribute("aria-live", "polite");
  polygonActionsNode.hidden = !(activeTool === "polygon" && Boolean(polygonDraft?.points.length));
  polygonActionsNode.setAttribute("aria-hidden", String(polygonActionsNode.hidden));
  taskInput.placeholder = pendingBrush
    ? "描述这些画笔标记要让 AI 改什么"
    : "写给 AI 的任务";
  brushSummaryNode.hidden = !isSuperBrushModeActive() || superBrushTaskDialogOpen;
  brushSummaryNode.setAttribute("aria-hidden", String(brushSummaryNode.hidden));
  brushSummaryTextNode.textContent = brushSummary;
  confirmBrushButtons.forEach((button) => {
    button.disabled = !canConfirmBrush;
  });
  brushTaskModalNode.hidden = !superBrushTaskDialogOpen;
  brushTaskModalNode.setAttribute("aria-hidden", String(!superBrushTaskDialogOpen));
  brushTaskSummaryNode.textContent = brushSummary;
  brushTaskErrorNode.textContent = superBrushTaskError;
  brushTaskErrorNode.hidden = !superBrushTaskError;
  brushTaskErrorNode.setAttribute("aria-hidden", String(!superBrushTaskError));
  root.dataset.scenePanel = panelLayout.panelState.scene;
  root.dataset.propertiesPanel = panelLayout.panelState.properties;
  root.dataset.assetsPanel = panelLayout.panelState.assets;
  root.dataset.libraryPanel = panelLayout.panelState.library;
  root.dataset.tasksPanel = panelLayout.panelState.tasks;
  root.dataset.outputPanel = panelLayout.panelState.output;
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
  const minimizedPanels = managedPanels.filter((panel) => panelLayout.panelState[panel] === "minimized");
  const signature = minimizedPanels.join("|");
  if (uiRenderState.minimizedTray === signature) return;
  uiRenderState.minimizedTray = signature;
  minimizedTrayNode.hidden = minimizedPanels.length === 0;
  minimizedTrayNode.setAttribute("aria-hidden", String(minimizedTrayNode.hidden));
  minimizedTrayNode.innerHTML = minimizedPanels
    .map(
      (panel) => `
        <button data-restore-panel="${panel}" type="button" title="恢复 ${escapeHtml(panelLabel(panel))}" aria-label="Restore ${escapeHtml(panelLabel(panel))}">
          ${escapeHtml(panelLabel(panel))}
        </button>
      `,
    )
    .join("");
}

function renderContextMenu(): void {
  const signature = !contextMenu || world.mode === "game"
    ? "hidden"
    : `${contextMenu.x}|${contextMenu.y}|${contextMenu.title}|${contextMenu.entityId || ""}|${contextMenu.part || ""}|${contextMenu.items.map((item) => `${item.action}:${item.label}:${item.hint || ""}:${item.danger ? 1 : 0}:${item.disabled ? 1 : 0}:${item.separatorBefore ? 1 : 0}`).join("~")}`;
  if (uiRenderState.contextMenu === signature) return;
  uiRenderState.contextMenu = signature;
  if (!contextMenu || world.mode === "game") {
    contextMenuNode.hidden = true;
    contextMenuNode.setAttribute("aria-hidden", "true");
    contextMenuNode.innerHTML = "";
    return;
  }
  contextMenuNode.classList.add("v2-context-menu");
  contextMenuNode.hidden = false;
  contextMenuNode.setAttribute("aria-hidden", "false");
  contextMenuNode.setAttribute("role", "menu");
  contextMenuNode.setAttribute("aria-label", contextMenu.title);
  contextMenuNode.style.left = `${contextMenu.x}px`;
  contextMenuNode.style.top = `${contextMenu.y}px`;
  contextMenuNode.innerHTML = `
    <header id="v2-context-menu-title">${escapeHtml(contextMenu.title)}</header>
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
              <span>${escapeHtml(item.label)}</span>
              ${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ""}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderFrame(): void {
  const text = editorPerformance.getHudText(world.clock.frame, world.clock.timeMs, world.clock.fixedStepMs);
  if (uiRenderState.frame === text) return;
  uiRenderState.frame = text;
  frameNode.textContent = text;
}

function renderTree(projectSnapshot: Project): void {
  const entities = sceneTreeEntities();
  const signature = sceneTreeRenderSignature(projectSnapshot, entities);
  if (uiRenderState.tree === signature) return;
  uiRenderState.tree = signature;
  treeNode.innerHTML = renderSceneTreeHtml(scene, entities, selectedId, selectedPart, projectSnapshot.resources, collapsedTreeNodes);
  bindSceneTreeInteractions(treeNode, {
    onToggleNode: (nodeId) => {
      if (!nodeId) return;
      if (collapsedTreeNodes.has(nodeId)) {
        collapsedTreeNodes.delete(nodeId);
      } else {
        collapsedTreeNodes.add(nodeId);
      }
      renderUi(projectSnapshot);
    },
    onSelectEntity: (entityId, part) => {
      selectedId = (entityId as EntityId) || selectedId;
      selectedPart = part;
      if (entityId) {
        selectedIds = [entityId as EntityId];
        selectionArea = undefined;
      }
      notice = part === "presentation" ? "当前可视体已选中" : "世界本体已选中";
      renderAll();
    },
    onMoveEntityToFolder: (entityId, folderId) => {
      moveEntityToFolder(entityId, folderId);
    },
    onFocusEntity: (entityId, part) => {
      focusEntityOnCanvas(entityId, part);
    },
    onOpenContextMenu: (target) => {
      const entity = editableEntity(target.entityId);
      if (!entity || world.mode === "game") return;
      selectedId = entity.id;
      selectedPart = "body";
      selectedIds = [entity.id];
      selectionArea = undefined;
      showEntityContextMenu(entity, "body", target.clientX, target.clientY, entity.transform.position);
    },
  });
}

function sceneTreeRenderSignature(projectSnapshot: Project, entities: Entity[]): string {
  const entitySignature = entities
    .map((entity) =>
      [
        entity.id,
        entity.displayName,
        entity.folderId || "",
        entity.persistent ? "persistent" : "runtime",
        entity.render ? "rendered" : "headless",
        entity.render?.visible === false ? "hidden" : "visible",
        entity.render?.resourceId || "",
      ].join(":"),
    )
    .sort()
    .join("|");
  const folderSignature = scene.folders
    .map((folder) => [folder.id, folder.displayName, folder.entityIds.join(",")].join(":"))
    .join("|");
  const resourceSignature = Object.values(projectSnapshot.resources)
    .map((resource) => [resource.id, resource.displayName, resource.type].join(":"))
    .sort()
    .join("|");
  return [
    scene.id,
    projectSnapshot.meta.updatedAt,
    selectedId,
    selectedPart,
    collapsedTreeSignature(),
    folderSignature,
    entitySignature,
    resourceSignature,
  ].join("||");
}

function renderTasks(projectSnapshot: Project): void {
  const summarySignature = taskSummaries.signature();
  const selectedEntityIds = currentSelectedEntityIds();
  const signature = [projectSnapshot.meta.updatedAt, previewTaskId, aiTraceSignature(), summarySignature, selectedEntityIds.join(",")].join("||");
  if (uiRenderState.tasks === signature) return;
  uiRenderState.tasks = signature;
  tasksNode.innerHTML = renderTaskPanelHtml({
    project: projectSnapshot,
    previewTaskId,
    aiTraceByTask,
    selectedEntityIds,
    summaries: taskSummaries.summaries(),
  });
  tasksNode.querySelectorAll<HTMLButtonElement>("[data-preview-task]").forEach((button) => {
    button.addEventListener("click", () => {
      previewTaskId = previewTaskId === button.dataset.previewTask ? "" : button.dataset.previewTask || "";
      notice = previewTaskId ? "正在预览任务上下文" : "任务预览已关闭";
      renderAll();
    });
  });
}



function renderInspector(projectSnapshot: Project): void {
  const runtimeEntity = selectedId ? world.entityById(selectedId as EntityId) : undefined;
  const signature = [projectSnapshot.meta.updatedAt, selectedId, selectedPart, runtimeEntity?.runtime?.ageMs ?? ""].join("||");
  if (uiRenderState.inspector === signature) return;
  uiRenderState.inspector = signature;
  inspectorNode.innerHTML = renderInspectorHtml(runtimeEntity, selectedPart, projectSnapshot.resources, world.clock.timeMs);
  bindInspectorInteractions(inspectorNode);
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

  inspector.querySelectorAll<HTMLInputElement>('[data-prop="persistent"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = checkbox.dataset.entityId;
      if (!id) return;
      setEntityPersistent(id, checkbox.checked);
    });
  });

  inspector.querySelectorAll<HTMLSelectElement>('[data-prop="bodyMode"]').forEach((select) => {
    select.addEventListener("change", () => {
      const id = select.dataset.entityId;
      if (!id) return;
      setEntityBodyMode(id, select.value);
    });
  });

  inspector.querySelectorAll<HTMLInputElement>('[data-prop="colliderSolid"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = checkbox.dataset.entityId;
      if (!id) return;
      setEntityColliderSolid(id, checkbox.checked);
    });
  });

  inspector.querySelectorAll<HTMLInputElement>('[data-prop="colliderTrigger"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = checkbox.dataset.entityId;
      if (!id) return;
      setEntityColliderTrigger(id, checkbox.checked);
    });
  });

  inspector.querySelectorAll<HTMLInputElement>('[data-prop="renderVisible"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = checkbox.dataset.entityId;
      if (!id) return;
      setEntityRenderVisible(id, checkbox.checked);
    });
  });

  inspector.querySelectorAll<HTMLInputElement>("[data-combat-level-param]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.entityId;
      const key = input.dataset.combatLevelParam;
      if (!id || !key) return;
      setCombatLevelParam(id, key, input.value);
    });
  });
}

function setEntityPersistent(entityId: string, value: boolean): void {
  const entity = editableEntity(entityId);
  if (!entity) return;
  const path = `/scenes/${scene.id}/entities/${entityId}/persistent` as ProjectPatch["path"];
  const result = editorTransactions.apply({
    actor: "user",
    patches: [{ op: "set", path, value }],
    inversePatches: [{ op: "set", path, value: entity.persistent }],
    diffSummary: `${value ? "设为" : "取消"}持久对象${entity.displayName}`,
    dirtyReason: `已更新 ${entity.displayName} 持久状态`,
    syncOnFailure: false,
  });
  if (result.ok) {
    notice = `${entity.displayName}${value ? "已设为持久对象" : "已取消持久对象"}`;
    renderAll();
  } else {
    notice = `属性更新失败：${result.error}`;
  }
}

function setEntityBodyMode(entityId: string, mode: string): void {
  const entity = editableEntity(entityId);
  if (!entity) return;
  const path = `/scenes/${scene.id}/entities/${entityId}/body/mode` as ProjectPatch["path"];
  const oldMode = entity.body?.mode || "static";
  const result = editorTransactions.apply({
    actor: "user",
    patches: [{ op: "set", path, value: mode }],
    inversePatches: [{ op: "set", path, value: oldMode }],
    diffSummary: `调整物理模式${entity.displayName} 为 ${mode}`,
    dirtyReason: `已更新 ${entity.displayName} 物理模式`,
    syncOnFailure: false,
  });
  if (result.ok) {
    notice = `${entity.displayName} 物理模式已改为 ${mode}。`;
    renderAll();
  } else {
    notice = `属性更新失败：${result.error}`;
  }
}

function setEntityColliderSolid(entityId: string, value: boolean): void {
  const entity = editableEntity(entityId);
  if (!entity) return;
  const path = `/scenes/${scene.id}/entities/${entityId}/collider/solid` as ProjectPatch["path"];
  const oldValue = entity.collider?.solid !== false;
  const result = editorTransactions.apply({
    actor: "user",
    patches: [{ op: "set", path, value }],
    inversePatches: [{ op: "set", path, value: oldValue }],
    diffSummary: `${value ? "启用" : "禁用"}实体碰撞${entity.displayName}`,
    dirtyReason: `已更新 ${entity.displayName} 碰撞属性`,
    syncOnFailure: false,
  });
  if (result.ok) {
    notice = `${entity.displayName}${value ? "已启用实体碰撞" : "已禁用实体碰撞"}`;
    renderAll();
  } else {
    notice = `属性更新失败：${result.error}`;
  }
}

function setEntityColliderTrigger(entityId: string, value: boolean): void {
  const entity = editableEntity(entityId);
  if (!entity) return;
  const path = `/scenes/${scene.id}/entities/${entityId}/collider/trigger` as ProjectPatch["path"];
  const oldValue = entity.collider?.trigger || false;
  const result = editorTransactions.apply({
    actor: "user",
    patches: [{ op: "set", path, value }],
    inversePatches: [{ op: "set", path, value: oldValue }],
    diffSummary: `${value ? "设为" : "取消"}触发器：${entity.displayName}`,
    dirtyReason: `已更新 ${entity.displayName} 触发器属性`,
    syncOnFailure: false,
  });
  if (result.ok) {
    notice = `${entity.displayName}${value ? "已设为触发器" : "已取消触发器"}`;
    renderAll();
  } else {
    notice = `属性更新失败：${result.error}`;
  }
}

function setEntityRenderVisible(entityId: string, value: boolean): void {
  const entity = editableEntity(entityId);
  if (!entity) return;
  const path = `/scenes/${scene.id}/entities/${entityId}/render/visible` as ProjectPatch["path"];
  const oldValue = entity.render?.visible !== false;
  const result = editorTransactions.apply({
    actor: "user",
    patches: [{ op: "set", path, value }],
    inversePatches: [{ op: "set", path, value: oldValue }],
    diffSummary: `${value ? "显示" : "隐藏"}可视体：${entity.displayName}`,
    dirtyReason: `已更新 ${entity.displayName} 可视体可见性`,
    syncOnFailure: false,
  });
  if (result.ok) {
    notice = `${entity.displayName} 可视体已${value ? "显示" : "隐藏"}`;
    renderAll();
  } else {
    notice = `属性更新失败：${result.error}`;
  }
}

function renderResources(projectSnapshot: Project): void {
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
    resourceLibraryNode.innerHTML = renderResourceLibraryHtml(resources);
    bindResourceInteractions(resourceLibraryNode);
  }
}

function renderOutput(): void {
  outputLog.remember(notice);
  const signature = outputLog.signature();
  if (uiRenderState.output === signature) return;
  uiRenderState.output = signature;
  outputNode.innerHTML = outputLog.renderHtml();
}

function renderWorldManager(projectSnapshot: Project): void {
  const sceneSignature = Object.values(projectSnapshot.scenes)
    .map((item) => [item.id, item.name, Object.keys(item.entities || {}).length].join(":"))
    .sort()
    .join("|");
  const signature = [worldManagerOpen ? "open" : "closed", projectSnapshot.activeSceneId, sceneSignature].join("||");
  if (uiRenderState.worldManager === signature) return;
  uiRenderState.worldManager = signature;
  worldManagerToggle.classList.toggle("is-active", worldManagerOpen);
  worldManagerToggle.setAttribute("aria-expanded", String(worldManagerOpen));
  worldManagerPopover.hidden = !worldManagerOpen;
  worldManagerPopover.setAttribute("aria-hidden", String(!worldManagerOpen));
  if (!worldManagerOpen) {
    worldManagerPopover.innerHTML = "";
    return;
  }
  worldManagerPopover.innerHTML = renderWorldManagerPopoverHtml(projectSnapshot);
  bindWorldManagerInteractions(worldManagerPopover);
}

function renderWorldSpeedControl(options: { force?: boolean; preserveInput?: boolean } = {}): void {
  const signature = worldSpeedControlSignature({
    sceneId: world.sceneId,
    speed: world.timeScale,
    mode: world.mode,
  });
  if (!options.force && uiRenderState.worldSpeed === signature) return;
  uiRenderState.worldSpeed = signature;
  renderWorldSpeedControlElements({
    control: worldSpeedControl,
    range: worldSpeedRange,
    input: worldSpeedInput,
    valueNode: worldSpeedValueNode,
    presetButtons: worldSpeedPresetButtons,
  }, {
    sceneId: world.sceneId,
    speed: world.timeScale,
    mode: world.mode,
  }, {
    preserveInput: options.preserveInput,
  });
}

function bindWorldManagerInteractions(popover: HTMLElement): void {
  popover.querySelectorAll<HTMLButtonElement>("[data-world-manager-action]").forEach((button) => {
    const runAction = () => runWorldManagerAction(popover, button);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runAction();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      runAction();
    });
  });
  popover.querySelectorAll<HTMLInputElement>("[data-world-manager-name]").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const sceneId = input.dataset.worldManagerName as SceneId | undefined;
      if (sceneId) renameWorldFromManager(sceneId, input.value);
    });
  });
}

function runWorldManagerAction(popover: HTMLElement, button: HTMLButtonElement): void {
  if (button.disabled) return;
  const action = button.dataset.worldManagerAction || "";
  const sceneId = button.dataset.sceneId as SceneId | undefined;
  if (action === "add") addWorldFromManager();
  else if (action === "select" && sceneId) selectWorldFromManager(sceneId);
  else if (action === "rename" && sceneId) {
    const input = popover.querySelector<HTMLInputElement>(`[data-world-manager-name="${sceneId}"]`);
    renameWorldFromManager(sceneId, input?.value || "");
  } else if (action === "remove" && sceneId) {
    removeWorldFromManager(sceneId);
  }
}

function setCombatLevelParam(entityId: string, key: string, rawValue: string): void {
  if (!isCombatLevelParamKey(key)) {
    notice = "战斗等级字段无效";
    renderAll();
    return;
  }
  const nextValue = Math.max(0, Math.floor(Number(rawValue)));
  if (!Number.isFinite(nextValue)) {
    notice = "请输入有效的战斗等级数值";
    renderAll();
    return;
  }
  const storedEntity = scene.entities[entityId as EntityId];
  const params = storedEntity?.behavior?.params;
  if (!storedEntity || !params) {
    notice = "战斗等级目标已经不存在";
    syncWorldFromStore();
    renderAll();
    return;
  }
  const previousValue = params[key];
  if (typeof previousValue === "number" && previousValue === nextValue) {
    notice = `${storedEntity.displayName} 的战斗等级未变化`;
    renderAll();
    return;
  }
  const patches: ProjectPatch[] = [];
  const inversePatches: ProjectPatch[] = [];
  pushBehaviorParamPatch(patches, inversePatches, storedEntity.id, key, nextValue, previousValue, hasOwnParam(params, key));
  const result = editorTransactions.apply({
    actor: "user",
    patches,
    inversePatches,
    diffSummary: `调整 ${storedEntity.displayName} 的战斗等级 ${key}=${nextValue}。`,
    dirtyReason: `已调整 ${storedEntity.displayName} 战斗等级`,
  });
  if (result.ok) {
    notice = `${storedEntity.displayName} 的 ${combatLevelParamLabel(key)} 已改为 ${nextValue}`;
    renderAll();
  } else {
    notice = `战斗等级更新失败：${result.error}`;
  }
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
  resourcesNode.querySelectorAll<HTMLButtonElement>('[data-action="apply-resource-effect-preset"]').forEach((button) => {
    button.addEventListener("click", () => {
      const resourceId = button.dataset.resourceId as ResourceId | undefined;
      const preset = parseResourceEffectPreset(button.dataset.effectPreset);
      if (resourceId && preset) applyResourceEffectPreset(resourceId, preset);
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
    notice = "没有从剪贴板或文件选择中读取到可用资源";
    renderAll();
    return;
  }
  const imported = await Promise.all(
    supported.map(async (file, index) => ({
      file,
      dataUrl: await readFileAsDataUrl(file),
      index,
    })),
  );
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
      notice = `剪贴板文件未导入${payload.skipped.map((item) => item.fileName || item.reason).join("")}`;
      didSetNotice = true;
    } else if (payload?.error) {
      notice = `剪贴板文件读取失败：${payload.error}`;
      didSetNotice = true;
    } else if (payload?.ok && !options.silentEmpty) {
      notice = "剪贴板里没有可导入文件";
      didSetNotice = true;
    }
    if (didSetNotice) renderUi();
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
    notice = "请先粘贴资源地址、data URL 或资源说明";
    renderUi();
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
    displayName: input.displayName || "未命名资",
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

  const result = editorTransactions.apply({
    actor: "user",
    patches,
    inversePatches,
    diffSummary: entity && isVisualResourceType(input.type)
      ? `添加资源并替换 ${entity.displayName} 的当前可视体`
      : `添加资源 ${resource.displayName}`,
    dirtyReason: "资源已添加",
    syncOnFailure: false,
  });
  if (!result.ok) {
    notice = `资源添加失败${result.error}`;
    renderAll();
    return;
  }
  if (entity && isVisualResourceType(input.type)) {
    selectedId = entity.id;
    selectedPart = "presentation";
    selectedIds = [entity.id as EntityId];
    selectionArea = undefined;
  }
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
  const projectSnapshot = store.peekProject();
  const resource = projectSnapshot.resources[resourceId];
  if (!resource) {
    notice = "资源已经不存在";
    renderUi();
    return;
  }
  if (!description) {
    notice = "资源描述不能为空";
    renderUi();
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
  const applyResult = editorTransactions.apply({
    actor: "user",
    patches,
    inversePatches,
    diffSummary: `保存资源描述${resource.displayName}`,
    syncOnSuccess: false,
    syncOnFailure: false,
  });
  if (!applyResult.ok) {
    notice = `资源描述保存失败${applyResult.error}`;
    renderAll();
    return;
  }
  const taskResult = createTask({
    source: "user",
    title: `标注资源${resource.displayName}`,
    userText: `资源${resource.displayName}”的描述${description}\n请在后续 AI 编辑和生成时按这条描述理解它。`,
    targetRefs: resourceTaskTargets(resourceId),
  });
  if (taskResult.ok) {
    store.upsertTask(taskResult.value);
    previewTaskId = taskResult.value.id;
  }
  syncWorldFromStore();
  markProjectDirty("资源描述已保存并排队");
  notice = taskResult.ok ? "资源描述已保存，已作为 AI 待处理任务排队" : "资源描述已保存，但任务排队失败";
  renderAll();
}

function saveResourceAnimation(resourceId: ResourceId, row: HTMLElement): void {
  const projectSnapshot = store.peekProject();
  const resource = projectSnapshot.resources[resourceId];
  if (!resource) {
    notice = "资源已经不存在";
    renderAll();
    return;
  }
  if (!isVisualResourceType(resource.type) && imageAttachments(resource).length === 0) {
    notice = "只有图片资源可以配置序列图或宫格动画";
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
      notice = "PNG 序列至少需要 2 张图片";
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
      notice = "宫格动画需要有效的行数和列数";
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
  applyResourceUpdate(resource, nextResource, `配置资源动画${resource.displayName}`, `已配置 ${resource.displayName} 的动画切帧。`);
}

function clearResourceAnimation(resourceId: ResourceId): void {
  const projectSnapshot = store.peekProject();
  const resource = projectSnapshot.resources[resourceId];
  if (!resource) {
    notice = "资源已经不存在";
    renderAll();
    return;
  }
  const nextResource = cloneJson(resource);
  delete nextResource.sprite;
  if (nextResource.type === "sprite" || nextResource.type === "animation") nextResource.type = "image";
  applyResourceUpdate(resource, nextResource, `清除资源动画${resource.displayName}`, `已把 ${resource.displayName} 改回静态资源。`);
}

function applyResourceEffectPreset(resourceId: ResourceId, preset: ResourceEffectPresetSelection): void {
  const projectSnapshot = store.peekProject();
  const resource = projectSnapshot.resources[resourceId];
  if (!resource) {
    notice = "特效预设目标资源已经不存在";
    renderAll();
    return;
  }
  if (!isVisualResourceType(resource.type)) {
    notice = "只有图片、精灵或动画资源可以应用特效预设";
    renderAll();
    return;
  }
  const nextResource = cloneJson(resource);
  const effect = buildResourceEffectPreset(preset);
  if (effect) {
    nextResource.effect = effect;
  } else {
    delete nextResource.effect;
  }
  nextResource.tags = uniqueStrings([
    ...nextResource.tags.filter((tag) => !tag.startsWith("特效:")),
    effect ? `特效:${resourceEffectPresetLabel(nextResource)}` : "",
  ]);
  applyResourceUpdate(
    resource,
    nextResource,
    `应用资源特效${resource.displayName}`,
    `已把 ${resource.displayName} 的特效预设切到 ${resourceEffectPresetLabel(nextResource)}。`,
  );
}

function applyResourceUpdate(previousResource: Resource, nextResource: Resource, diffSummary: string, successNotice: string): void {
  const resourcePath = `/resources/${previousResource.id}` as ProjectPatch["path"];
  const applyResult = editorTransactions.apply({
    actor: "user",
    patches: [{ op: "set", path: resourcePath, value: nextResource }],
    inversePatches: [{ op: "set", path: resourcePath, value: cloneJson(previousResource) }],
    diffSummary,
    dirtyReason: successNotice,
    syncOnFailure: false,
  });
  if (!applyResult.ok) {
    notice = `资源更新失败${applyResult.error}`;
    renderAll();
    return;
  }
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

function parseResourceEffectPreset(value: string | undefined): ResourceEffectPresetSelection | undefined {
  return resourceEffectPresetOptions.find((option) => option.id === value)?.id;
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
  const projectSnapshot = store.peekProject();
  const resource = projectSnapshot.resources[resourceId];
  if (!resource) {
    notice = "资源已经不存在";
    renderAll();
    return;
  }
  const planResult = planRenameResourceTransaction(projectSnapshot.resources, resource, rawDisplayName);
  if (!planResult.ok) {
    notice = `资源重命名未提交${planResult.error}`;
    renderAll();
    return;
  }
  const applyResult = editorTransactions.apply({
    actor: "user",
    patches: planResult.value.patches,
    inversePatches: planResult.value.inversePatches,
    diffSummary: planResult.value.diffSummary,
    dirtyReason: planResult.value.notice,
    syncOnFailure: false,
  });
  if (!applyResult.ok) {
    notice = `资源重命名失败：${applyResult.error}`;
    renderAll();
    return;
  }
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
  const names = new Set(Object.values(store.peekProject().resources).map((resource) => resource.internalName));
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
    if (resource && (resourceHasAnimation(resource) || resourceHasTimelineEffect(resource))) return true;
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
  return (projectSnapshot || store.peekProject()).tasks[previewTaskId];
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
    const strokeTargetRefs = liveStrokeResult.ok
      ? {
          ...(pendingBrush?.strokeTargetRefs || {}),
          [liveStrokeResult.value.id]: liveTargets,
        }
      : pendingBrush?.strokeTargetRefs;
    const draft: SuperBrushDraft = rebuildSuperBrushDraftTargets({
      strokes: [...(pendingBrush?.strokes || []), ...(liveStrokeResult.ok ? [liveStrokeResult.value] : [])],
      annotations: pendingBrush?.annotations || [],
      selectionTargets: mergeSuperBrushTargets(pendingBrush?.selectionTargets, liveTargets),
      strokeTargetRefs,
      manualTargetRefs: pendingBrush?.manualTargetRefs,
      capturedSnapshotId: pendingBrush?.capturedSnapshotId,
      selectionBox: pendingBrush?.selectionBox,
    });
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
  if (!pendingBrush) return "超级画笔已记录，请输入任务描述后排队";
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

function reconcileSelectionWithWorld(): void {
  const requestedIds = [...selectedIds];
  if (selectedId) requestedIds.unshift(selectedId as EntityId);
  const validIds = uniqueEntityIds(requestedIds).filter((id) => Boolean(editableEntity(id)));
  const selectedStillExists = Boolean(selectedId && editableEntity(selectedId));

  if (!selectedStillExists && (selectedId || selectedIds.length > 0)) {
    selectedId = validIds[0] || firstEditableEntityId();
    selectedPart = "body";
  }

  if (selectedId && !editableEntity(selectedId)) {
    selectedId = "";
    selectedPart = "body";
  }

  if (selectedId && selectedPart === "presentation" && !editableEntity(selectedId)?.render) {
    selectedPart = "body";
  }

  selectedIds = selectedId ? uniqueEntityIds([selectedId as EntityId, ...validIds]) : [];
  if (selectedIds.length > 0) selectionArea = undefined;
}

function firstEditableEntityId(): EntityId | "" {
  return (editableEntities()[0]?.id as EntityId | undefined) || "";
}

function firstPersistentSceneEntityId(targetScene: Scene): EntityId | "" {
  return (Object.values(targetScene.entities).find((entity) => entity.persistent)?.id as EntityId | undefined) || "";
}

function rectFromPoints(start: Vec2, end: Vec2): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return { x, y, w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
}

function createEntityFromShapeDrag(drag: ShapeDragState): Entity | undefined {
  if (drag.tool === "leaf") {
    return createPolygonEntityFromWorldPoints(drag.points, "Leaf Body", ["entity", "leaf-brush", "polygon-collider"]);
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
  if (!drag.moved) return { x: drag.start.x - 32, y: drag.start.y - 32, w: 64, h: 64 };
  const raw = rectFromPoints(drag.start, drag.current);
  const minSize = 8;
  if (raw.w >= minSize && raw.h >= minSize) return raw;
  const signX = drag.current.x >= drag.start.x ? 1 : -1;
  const signY = drag.current.y >= drag.start.y ? 1 : -1;
  const width = Math.max(minSize, raw.w);
  const height = Math.max(minSize, raw.h);
  return {
    x: signX >= 0 ? drag.start.x : drag.start.x - width,
    y: signY >= 0 ? drag.start.y : drag.start.y - height,
    w: width,
    h: height,
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
    notice = "临时对象不进入世界文件夹；它只属于运行时调试";
    renderAll();
    return;
  }

  const plan = planPersistentFolderMoveTransaction(scene, entity, folderId);
  if (!plan.ok) {
    notice = `文件夹移动未提交${plan.error}`;
    renderAll();
    return;
  }
  const result = editorTransactions.apply({
    actor: "user",
    patches: plan.value.patches,
    inversePatches: plan.value.inversePatches,
    diffSummary: plan.value.diffSummary,
    dirtyReason: "文件夹移动已更新",
  });
  if (!result.ok) {
    notice = `文件夹移动未提交${result.error}`;
    renderAll();
    return;
  }

  selectedId = entityId;
  selectedPart = "body";
  selectedIds = [entityId];
  selectionArea = undefined;
  notice = "已提交文件夹移动事务";
  renderAll();
}

function syncWorldFromStore(): void {
  const latestProject = store.peekProject();
  const latestScene = latestProject.scenes[latestProject.activeSceneId];
  scene = latestScene;
  animatedResourcePresent = sceneHasVisibleAnimatedResource(latestProject);
  world.syncPersistentEntities(latestScene);
  world.setTimeScale(latestScene.settings.timeScale);
  reconcileSelectionWithWorld();
}

function rebuildWorldFromStore(): void {
  const latestProject = store.peekProject();
  scene = latestProject.scenes[latestProject.activeSceneId];
  animatedResourcePresent = sceneHasVisibleAnimatedResource(latestProject);
  world = new RuntimeWorld({ scene });
  reconcileSelectionWithWorld();
}

function updateCanvasCursor(point: Vec2): void {
  const canvas = renderer.canvas();
  if (spacePanActive && world.mode !== "game") {
    canvas.style.cursor = "grab";
    return;
  }
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
  const entityIds = currentSelectedEntityIds();
  if (entityIds.length > 1) {
    const selectedEntities = entityIds.map((id) => editableEntity(id)).filter(Boolean) as Entity[];
    const handle = renderer.pickMultiTransformHandle(selectedEntities, point);
    canvas.style.cursor = handle ? cursorForTransformHandle(handle) : "default";
    return;
  }
  const selected = selectedEntity();
  const handle = renderer.pickTransformHandle(selected, selectedPart, point);
  if (handle) {
    canvas.style.cursor = isAttackTouchDebugEntity(selected) ? (handle === "core" ? "move" : "not-allowed") : cursorForTransformHandle(handle);
    return;
  }
  canvas.style.cursor = renderer.pickCanvasTarget(world, point, selectedId ? { entityId: selectedId, part: selectedPart } : undefined)
    ? "pointer"
    : world.mode === "editorFrozen"
      ? "grab"
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


function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

window.addEventListener("pagehide", () => {
  saveDirtyProjectLocallyNow();
});

if (typeof window !== "undefined") {
  (window as any).__v2_test__ = {
    getSelectedIds: () => [...selectedIds],
    getSelectedId: () => selectedId,
    getSelectionArea: () => selectionArea,
    getContextMenu: () => contextMenu,
    getNotice: () => notice,
    getWorld: () => world,
    getRenderer: () => renderer,
    setSelectedIds: (ids: string[]) => {
      selectedIds = ids as EntityId[];
      selectedId = (ids[0] as EntityId | undefined) || "";
      selectedPart = "body";
      selectionArea = undefined;
      renderAll();
    },
    simulateRightClick: (clientX: number, clientY: number) => {
      const point = renderer.screenToWorld(clientX, clientY);
      const pickHint = selectedIds.length <= 1 && selectedId ? { entityId: selectedId, part: selectedPart } : undefined;
      const picked = renderer.pickCanvasTarget(world, point, pickHint);
      if (picked) {
        const alreadySelected = selectedIds.length > 1 && selectedIds.includes(picked.entity.id as EntityId);
        if (alreadySelected) {
          showMultiEntityContextMenu(picked.entity, clientX, clientY, point);
        } else {
          selectedId = picked.entity.id;
          selectedPart = "body";
          selectedIds = [picked.entity.id as EntityId];
          selectionArea = undefined;
          showEntityContextMenu(picked.entity, picked.part, clientX, clientY, point);
        }
      } else if (selectedIds.length > 1) {
        showMultiEntityContextMenu(null, clientX, clientY, point);
      } else {
        showCanvasContextMenu(clientX, clientY, point);
      }
    },
  };
}

window.addEventListener("beforeunload", () => {
  saveDirtyProjectLocallyNow();
  cancelAnimationFrame(raf);
  renderer.destroy();
});

