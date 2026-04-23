// state.js —— 纯数据中心：状态、常量、规范化、快照、持久化
(function (global) {
  'use strict';

  const WORLD_SIZE = 4000;
  const MIN_SCALE = 0.001;
  const MAX_SCALE = 3;
  const MIN_SHAPE_SIZE = 40;
  const MAX_SHAPE_SIZE = Number.POSITIVE_INFINITY;
  const SNAP_THRESHOLD = 8;
  const SIZE_SNAP_STEP = 14;
  const ROTATION_SNAP_STEP = 15;
  const ROTATION_SNAP_THRESHOLD = 4;
  const STORAGE_KEY = 'named-graphic-editor-state-v3';

  const SHAPE_TYPES = ['square', 'circle', 'triangle', 'pen', 'brush'];
  const SHAPE_TYPE_LABELS = {
    square: '正方形',
    circle: '圆形',
    triangle: '三角形',
    pen: '自由图形',
    brush: '手绘图形',
  };

  // 运行时角色：决定一个对象在游戏循环里扮演什么。
  // - 'player'  : 受 WASD/鼠标控制的主角
  // - 'floor'   : 参与 AABB 碰撞的地板
  // - 'hitbox'  : 战斗判定框（带 lifetime 自动消亡）
  // - 'generic' : 普通装饰/草图实体（默认）
  const SHAPE_ROLES = ['generic', 'player', 'floor', 'hitbox'];

  // 兼容老存档：根据 name 推断 role（仅在 role 缺失时执行一次）
  function inferRoleFromName(raw) {
    if (raw && raw.isHitbox) return 'hitbox';
    const name = typeof raw?.name === 'string' ? raw.name : '';
    if (name === '主角') return 'player';
    if (name.indexOf('地板') >= 0) return 'floor';
    return 'generic';
  }

  const state = {
    editMode: true,
    objects: [],
    baseline: null,
    selectedId: null,
    selectedIds: new Set(),   // 多选集合（始终与 selectedId 保持同步）
    nextId: 1,
    nextTaskId: 1,
    globalTasks: [],
    ui: {
      pendingTaskFocus: null,
      drawerHeight: 220,
      drawerSplit: 0.42,
      contextMenu: { open: false, x: 0, y: 0, objectId: null, renameValue: '' },
    },
    view: { x: 0, y: 0, scale: 1 },
  };

  function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
  function normalizeRotation(angle) { return (((angle + 180) % 360) + 360) % 360 - 180; }
  function getShapeWidth(shape) {
    const value = Number(shape?.width) || Number(shape?.size) || 140;
    return clamp(value, MIN_SHAPE_SIZE, MAX_SHAPE_SIZE);
  }
  function getShapeHeight(shape) {
    const value = Number(shape?.height) || Number(shape?.size) || 140;
    return clamp(value, MIN_SHAPE_SIZE, MAX_SHAPE_SIZE);
  }
  function getShapePivotX(shape) {
    return Number.isFinite(Number(shape?.pivotX)) ? clamp(Number(shape.pivotX), 0, 1) : 0.5;
  }
  function getShapePivotY(shape) {
    return Number.isFinite(Number(shape?.pivotY)) ? clamp(Number(shape.pivotY), 0, 1) : 0.5;
  }
  function ensureObjectInStage(shape) {
    shape.width = getShapeWidth(shape);
    shape.height = getShapeHeight(shape);
    shape.pivotX = getShapePivotX(shape);
    shape.pivotY = getShapePivotY(shape);
    shape.x = Number(shape.x) || 0;
    shape.y = Number(shape.y) || 0;
  }
  function normalizeTask(task, fallbackIndex) {
    const legacyTitle = typeof task?.title === 'string' ? task.title : '';
    const pathMatch = legacyTitle.match(/(\d+(?:\.\d+)*)/);
    return {
      id: typeof task?.id === 'string' ? task.id : `task-${state.nextTaskId++}`,
      path: typeof task?.path === 'string' && task.path.trim()
        ? task.path
        : pathMatch?.[1] ?? String(fallbackIndex + 1),
      text: typeof task?.text === 'string' ? task.text : '',
      done: Boolean(task?.done),
      // 附件：每条任务可挂多个文件/图片，AI 能读到 dataUrl 用于生成贴图等
      attachments: Array.isArray(task?.attachments)
        ? task.attachments
            .filter((a) => a && typeof a.dataUrl === 'string')
            .map((a) => ({
              id: typeof a.id === 'string' ? a.id : `att-${state.nextTaskId++}`,
              name: typeof a.name === 'string' ? a.name : 'file',
              mime: typeof a.mime === 'string' ? a.mime : 'application/octet-stream',
              size: Number.isFinite(Number(a.size)) ? Number(a.size) : 0,
              dataUrl: a.dataUrl,
            }))
        : [],
      replies: Array.isArray(task?.replies)
        ? task.replies.filter(function (r) { return r && typeof r.text === 'string'; }).map(function (r) {
            return {
              id: typeof r.id === 'string' ? r.id : 'r-' + Date.now(),
              text: r.text,
              ts: typeof r.ts === 'string' ? r.ts : null,
            };
          })
        : [],
    };
  }

  // 兼容老存档：旧的 theme 关键字映射成实色
  const THEME_TO_FILL = {
    purple: '#7c3aed', red: '#ef4444', blue: '#2563eb', green: '#16a34a',
  };
  function pickColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const v = value.trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
    return fallback;
  }

  function normalizeShape(raw, index) {
    const type = SHAPE_TYPES.includes(raw?.type) ? raw.type : 'square';
    const id = typeof raw?.id === 'string' ? raw.id : `shape-${index + 1}`;
    const isHitbox = Boolean(raw?.isHitbox);
    const explicitRole = SHAPE_ROLES.includes(raw?.role) ? raw.role : null;
    const role = explicitRole ?? inferRoleFromName(raw);
    const fillFromTheme = THEME_TO_FILL[raw?.theme];
    const fill = pickColor(raw?.fill, fillFromTheme || '#9ca3af');
    const stroke = pickColor(raw?.stroke, '#1f2937');
    const strokeWidthRaw = Number(raw?.strokeWidth);
    const strokeWidth = Number.isFinite(strokeWidthRaw) ? clamp(strokeWidthRaw, 0, 20) : 1;
    const opacityRaw = Number(raw?.opacity);
    const opacity = Number.isFinite(opacityRaw) ? clamp(opacityRaw, 0, 1) : 1;
    return {
      id,
      type,
      name: typeof raw?.name === 'string' && raw.name.trim()
        ? raw.name
        : `${SHAPE_TYPE_LABELS[type]} ${index + 1}`,
      role,
      width: getShapeWidth(raw),
      height: getShapeHeight(raw),
      x: Number(raw?.x) || 0,
      y: Number(raw?.y) || 0,
      pivotX: getShapePivotX(raw),
      pivotY: getShapePivotY(raw),
      rotation: Number.isFinite(Number(raw?.rotation)) ? normalizeRotation(Number(raw.rotation)) : 0,
      fill,
      stroke,
      strokeWidth,
      opacity,
      tasks: Array.isArray(raw?.tasks)
        ? raw.tasks.map((task, taskIndex) => normalizeTask(task, taskIndex))
        : [],
      parentId: typeof raw?.parentId === 'string' ? raw.parentId : null,
      isHitbox,
      lifetime: Number.isFinite(Number(raw?.lifetime)) ? Number(raw.lifetime) : null,
      points: Array.isArray(raw?.points) ? raw.points.slice() : null,
      // 精灵 / 文本内容（由 AIEngine 或手动赋值）
      sprite: typeof raw?.sprite === 'string' ? raw.sprite : null,
      spriteFit: typeof raw?.spriteFit === 'string' ? raw.spriteFit : null,
      text: typeof raw?.text === 'string' ? raw.text : null,
      // 锚点系统（uiSpace=true 时生效）
      uiSpace: Boolean(raw?.uiSpace),
      anchorX: (raw?.anchorX !== null && raw?.anchorX !== undefined && Number.isFinite(Number(raw.anchorX))) ? Number(raw.anchorX) : null,
      anchorY: (raw?.anchorY !== null && raw?.anchorY !== undefined && Number.isFinite(Number(raw.anchorY))) ? Number(raw.anchorY) : null,
      widthPct: (raw?.widthPct !== null && raw?.widthPct !== undefined && Number.isFinite(Number(raw.widthPct))) ? Number(raw.widthPct) : null,
      heightPct: (raw?.heightPct !== null && raw?.heightPct !== undefined && Number.isFinite(Number(raw.heightPct))) ? Number(raw.heightPct) : null,
    };
  }

  function generateShapeId() { const id = `shape-${state.nextId}`; state.nextId += 1; return id; }
  function generateTaskId()  { const id = `task-${state.nextTaskId}`; state.nextTaskId += 1; return id; }
  function getSelectedObject() { return state.objects.find((item) => item.id === state.selectedId) ?? null; }
  function getObjectById(id)   { return state.objects.find((item) => item.id === id) ?? null; }
  function getChildren(parentId) { return state.objects.filter((item) => item.parentId === parentId); }
  function getObjectsByRole(role) { return state.objects.filter((item) => item.role === role); }
  function getFirstObjectByRole(role) { return state.objects.find((item) => item.role === role) ?? null; }

  function captureBaseline() {
    state.baseline = state.objects
      .filter((obj) => !obj.isHitbox)
      .map((obj) => JSON.parse(JSON.stringify(obj)));
  }

  function restoreFromBaseline() {
    if (!state.baseline) { state.objects = []; return; }
    state.objects = state.baseline.map((obj, index) => normalizeShape(obj, index));
    state.objects.forEach(ensureObjectInStage);
  }

  function snapshotLiveIntoBaseline() {
    state.objects.forEach((obj) => {
      if (obj.isHitbox) {
        obj.isHitbox = false;
        obj.lifetime = null;
        if (obj.role === 'hitbox') obj.role = 'generic';
      }
    });
    captureBaseline();
  }
  function persistState() {
    const objectsToSave = state.baseline ?? state.objects;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          objects: objectsToSave,
          nextId: state.nextId,
          nextTaskId: state.nextTaskId,
          globalTasks: state.globalTasks,
          ui: { drawerHeight: state.ui.drawerHeight, drawerSplit: state.ui.drawerSplit },
          view: state.view,
        }),
      );
    } catch (error) {
      console.warn('保存到本地存储失败。', error);
    }
    // 给上层（如 ServerSync）一个钩子，可订阅状态变化触发自动同步
    if (typeof onPersisted === 'function') {
      try { onPersisted(); } catch (e) { console.warn('onPersisted 钩子异常', e); }
    }
  }
  let onPersisted = null;
  function setPersistHook(fn) { onPersisted = typeof fn === 'function' ? fn : null; }

  function loadPersistedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const legacy = raw ? null : localStorage.getItem('named-graphic-editor-state-v2');
      const text = raw || legacy;
      if (!text) return;
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed.objects)) {
        state.objects = parsed.objects.map((shape, index) => normalizeShape(shape, index));
      }
      if (Array.isArray(parsed.globalTasks)) {
        state.globalTasks = parsed.globalTasks.map((task, index) => normalizeTask(task, index));
      }
      if (Number.isFinite(parsed.nextId)) state.nextId = parsed.nextId;
      if (Number.isFinite(parsed.nextTaskId)) state.nextTaskId = parsed.nextTaskId;
      if (parsed.view) {
        state.view.x = Number(parsed.view.x) || 0;
        state.view.y = Number(parsed.view.y) || 0;
        state.view.scale = clamp(Number(parsed.view.scale) || 1, MIN_SCALE, MAX_SCALE);
      }
      if (Number.isFinite(parsed?.ui?.drawerHeight)) {
        state.ui.drawerHeight = parsed.ui.drawerHeight;
      } else if (Number.isFinite(parsed?.ui?.taskDrawerHeight)) {
        state.ui.drawerHeight = parsed.ui.taskDrawerHeight;
      }
      if (Number.isFinite(parsed?.ui?.drawerSplit)) {
        state.ui.drawerSplit = clamp(parsed.ui.drawerSplit, 0.18, 0.82);
      }
    } catch (error) {
      console.warn('读取本地状态失败，已回退到默认状态。', error);
    }
    state.objects.forEach(ensureObjectInStage);
    if (state.nextId <= state.objects.length) state.nextId = state.objects.length + 1;
    const taskIds = [
      ...state.globalTasks.map((task) => task.id),
      ...state.objects.flatMap((shape) => shape.tasks.map((task) => task.id)),
    ];
    const maxTaskId = taskIds.reduce((max, taskId) => {
      const match = String(taskId).match(/task-(\d+)/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    if (state.nextTaskId <= maxTaskId) state.nextTaskId = maxTaskId + 1;
    captureBaseline();
  }
  // —— AI 接口：把整张画布序列化为 AI 友好快照 ——
  function serializeForAI() {
    const summarizeAttachment = (a) => ({
      id: a.id, name: a.name, mime: a.mime, size: a.size, dataUrl: a.dataUrl,
    });
    const summarizeTask = (task) => ({
      path: task.path,
      text: task.text,
      done: task.done,
      attachments: (task.attachments || []).map(summarizeAttachment),
    });
    const objects = state.objects
      .filter((obj) => !obj.isHitbox)
      .map((obj) => ({
        id: obj.id,
        name: obj.name,
        role: obj.role,
        type: obj.type,
        parentId: obj.parentId,
        x: Math.round(obj.x),
        y: Math.round(obj.y),
        width: Math.round(obj.width),
        height: Math.round(obj.height),
        rotation: Math.round(obj.rotation || 0),
        pivotX: Number(obj.pivotX.toFixed(3)),
        pivotY: Number(obj.pivotY.toFixed(3)),
        fill: obj.fill,
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
        opacity: obj.opacity,
        tasks: obj.tasks.map(summarizeTask),
      }));
    return {
      version: 2,
      world: { width: WORLD_SIZE, height: WORLD_SIZE },
      view: { x: state.view.x, y: state.view.y, scale: state.view.scale },
      globalTasks: state.globalTasks.map(summarizeTask),
      objects,
    };
  }

  // ===== 撤销栈（仅在编辑模式下使用） =====
  // 每次结构变更"之前"由调用方 record 一帧；undo() 弹栈应用。
  // 进入编辑模式时 clearUndo()。栈空时弹回 false 表示"已在初始状态"。
  const undoStack = [];
  const MAX_UNDO = 80;

  function captureFullSnapshot() {
    return JSON.stringify({
      objects: state.objects,
      globalTasks: state.globalTasks,
      nextId: state.nextId,
      nextTaskId: state.nextTaskId,
      view: state.view,
    });
  }

  function applyFullSnapshot(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { return false; }
    if (!parsed) return false;
    if (Array.isArray(parsed.objects)) {
      state.objects = parsed.objects.map((s, i) => normalizeShape(s, i));
      state.objects.forEach(ensureObjectInStage);
    }
    if (Array.isArray(parsed.globalTasks)) {
      state.globalTasks = parsed.globalTasks.map((t, i) => normalizeTask(t, i));
    }
    if (Number.isFinite(parsed.nextId)) state.nextId = parsed.nextId;
    if (Number.isFinite(parsed.nextTaskId)) state.nextTaskId = parsed.nextTaskId;
    if (parsed.view) {
      state.view.x = Number.isFinite(parsed.view.x) ? parsed.view.x : state.view.x;
      state.view.y = Number.isFinite(parsed.view.y) ? parsed.view.y : state.view.y;
      state.view.scale = Number.isFinite(parsed.view.scale) ? parsed.view.scale : state.view.scale;
    }
    state.selectedId = null;
    captureBaseline();
    persistState();
    return true;
  }

  function recordUndo(label) {
    undoStack.push({ label: label || '', snapshot: captureFullSnapshot() });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }
  function clearUndo() { undoStack.length = 0; }
  function undoStackSize() { return undoStack.length; }
  function undo() {
    const frame = undoStack.pop();
    if (!frame) return null;
    applyFullSnapshot(frame.snapshot);
    return frame.label || '上一步';
  }

  // ===== 反向保存：导出/导入完整场景 JSON（用于 git 版本化） =====
  function exportSceneJSON() {
    return JSON.stringify({
      kind: 'webhachimi-scene',
      version: 1,
      exportedAt: new Date().toISOString(),
      objects: state.objects,
      globalTasks: state.globalTasks,
      nextId: state.nextId,
      nextTaskId: state.nextTaskId,
      view: state.view,
      ui: { drawerHeight: state.ui.drawerHeight, drawerSplit: state.ui.drawerSplit },
    }, null, 2);
  }

  function importSceneJSON(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: 'JSON 解析失败' }; }
    if (!parsed || parsed.kind !== 'webhachimi-scene') {
      return { ok: false, error: '不是有效的 WebHachimi 场景文件（缺少 kind 字段）' };
    }
    recordUndo('导入场景前');
    const ok = applyFullSnapshot(JSON.stringify(parsed));
    return ok ? { ok: true } : { ok: false, error: '应用快照失败' };
  }

  // ===== 多选辅助 =====
  function clearSelection() {
    state.selectedId = null;
    state.selectedIds = new Set();
  }
  function setSelection(id) {
    state.selectedId = id || null;
    state.selectedIds = id ? new Set([id]) : new Set();
  }
  function addToSelection(id) {
    state.selectedIds.add(id);
    state.selectedId = id;
  }
  function removeFromSelection(id) {
    state.selectedIds.delete(id);
    if (state.selectedId === id) {
      const arr = Array.from(state.selectedIds);
      state.selectedId = arr.length ? arr[arr.length - 1] : null;
    }
  }
  function toggleSelection(id) {
    if (state.selectedIds.has(id)) { removeFromSelection(id); } else { addToSelection(id); }
  }
  function getSelectedObjects() {
    return state.objects.filter(function (o) { return state.selectedIds.has(o.id); });
  }

  global.State = {
    state,
    constants: {
      WORLD_SIZE, MIN_SCALE, MAX_SCALE, MIN_SHAPE_SIZE, MAX_SHAPE_SIZE,
      SNAP_THRESHOLD, SIZE_SNAP_STEP, ROTATION_SNAP_STEP, ROTATION_SNAP_THRESHOLD,
      STORAGE_KEY, SHAPE_TYPES, SHAPE_TYPE_LABELS, SHAPE_ROLES,
    },
    clamp, normalizeRotation,
    getShapeWidth, getShapeHeight, getShapePivotX, getShapePivotY,
    ensureObjectInStage, normalizeShape, normalizeTask,
    generateShapeId, generateTaskId,
    getSelectedObject, getObjectById, getChildren,
    getObjectsByRole, getFirstObjectByRole,
    captureBaseline, restoreFromBaseline, snapshotLiveIntoBaseline,
    persistState, loadPersistedState, setPersistHook,
    serializeForAI,
    recordUndo, undo, clearUndo, undoStackSize,
    exportSceneJSON, importSceneJSON,
    clearSelection, setSelection, addToSelection, removeFromSelection, toggleSelection, getSelectedObjects,
  };
})(window);