// editor.js —— 编辑器协调器：模式切换 / 工具栏 / 视口平移 / 抽屉伸缩 / 上下文菜单 / 顶层 render
// 任务面板见 taskPanel.js；属性面板见 propertyPanel.js；对象拖拽见 dragController.js
(function (global) {
  'use strict';
  const S = global.State;
  const E = global.Engine;
  const DC = global.DragController;
  const TP = global.TaskPanel;
  const PP = global.PropertyPanel;
  const C = S.constants;
  const clamp = S.clamp;

  let dom;
  let setMessage;

  const panState = { active: false, startX: 0, startY: 0, originX: 0, originY: 0 };
  const drawerState = { active: false, startY: 0, startHeight: 0 };
  const marqueeState = {
    active: false, additive: false,
    startWorld: { x: 0, y: 0 },
    x: 0, y: 0, w: 0, h: 0,
  };
  let marqueeEl = null;
  let suppressNextStageClick = false;  // 框选结束后抑制一次 click 清选

  function init(refs, opts) {
    dom = refs;
    setMessage = opts.setMessage;
    marqueeEl = document.getElementById('marquee');
    DC.init({
      requestRender: render,
      requestStageRender: function () { E.renderStage(DC.getStageHandlers()); },
      openContextMenu: openContextMenu,
    });
    TP.init({ dom: dom, setMessage: setMessage, requestRender: render });
    PP.init({ dom: dom, setMessage: setMessage, requestRender: render });
    if (global.SketchTool) global.SketchTool.init(dom, { setMessage: setMessage, requestRender: render });
    if (global.WorldTree) global.WorldTree.init(dom, { requestRender: render });
    if (global.TaskManager) global.TaskManager.init(dom, { requestRender: render });
    if (global.ConsolePanel) global.ConsolePanel.init(dom, {});
    bindToolDock();
    bindDrawerHandles();
    bindContextMenu();
    bindStage();
    bindWindow();
  }

  // ===== 框选辅助 =====
  function updateMarqueeEl() {
    if (!marqueeEl) return;
    if (!marqueeState.active || marqueeState.w < 2 || marqueeState.h < 2) {
      marqueeEl.classList.add('hidden');
      return;
    }
    const sc = S.state.view.scale;
    const vx = S.state.view.x, vy = S.state.view.y;
    marqueeEl.style.left   = (marqueeState.x * sc + vx) + 'px';
    marqueeEl.style.top    = (marqueeState.y * sc + vy) + 'px';
    marqueeEl.style.width  = (marqueeState.w * sc) + 'px';
    marqueeEl.style.height = (marqueeState.h * sc) + 'px';
    marqueeEl.classList.remove('hidden');
  }

  function finishMarquee() {
    const mx0 = marqueeState.x, my0 = marqueeState.y;
    const mx1 = mx0 + marqueeState.w, my1 = my0 + marqueeState.h;
    const hit = S.state.objects.filter(function (obj) {
      if (obj.isHitbox || obj.uiSpace) return false;
      const ox1 = obj.x + S.getShapeWidth(obj), oy1 = obj.y + S.getShapeHeight(obj);
      return obj.x < mx1 && ox1 > mx0 && obj.y < my1 && oy1 > my0;
    });
    if (!marqueeState.additive) S.clearSelection();
    hit.forEach(function (obj) { S.addToSelection(obj.id); });
    if (hit.length) setMessage('已框选 ' + S.state.selectedIds.size + ' 个对象。（Shift 追加，Esc 取消）');
  }

  // ===== 创建形状 =====
  function createShape(type) {
    S.recordUndo('创建对象');
    const center = E.getViewportCenterWorld();
    const id = S.generateShapeId();
    const index = S.state.nextId - 1;
    const shape = S.normalizeShape({
      id: id, type: type,
      name: (C.SHAPE_TYPE_LABELS[type] || type) + ' ' + index,
      role: 'generic',
      width: 140, height: 140,
      x: Math.round(center.x - 70),
      y: Math.round(center.y - 70),
      pivotX: 0.5, pivotY: 0.5, rotation: 0, look: 'basic', theme: 'purple',
    }, index);
    S.ensureObjectInStage(shape);
    S.state.objects.push(shape);
    S.state.selectedId = shape.id;
    S.captureBaseline();
    render();
    setMessage('已创建 ' + shape.name + '。可在右键菜单或左下角面板编辑。');
  }

  function bindToolDock() {
    dom.createSquareBtn.addEventListener('click', function () { createShape('square'); });
    dom.createCircleBtn.addEventListener('click', function () { createShape('circle'); });
    dom.createTriangleBtn.addEventListener('click', function () { createShape('triangle'); });
    dom.createPenBtn.addEventListener('click', function () { createShape('pen'); });
    dom.createBrushBtn.addEventListener('click', function () { createShape('brush'); });
    dom.superSketchBtn.addEventListener('click', function () {
      if (global.SketchTool) global.SketchTool.toggle();
    });
    if (dom.snapshotForAiBtn) dom.snapshotForAiBtn.addEventListener('click', async function (event) {
      if (!global.CanvasSnapshot) { setMessage('CanvasSnapshot 未加载', 'error'); return; }
      try {
        if (event.shiftKey) {
          setMessage('📸 正在下载快照 PNG...', 'info');
          await global.CanvasSnapshot.downloadSnapshotPng();
          setMessage('✓ 已下载快照 PNG。', 'info');
          return;
        }
        setMessage('📸 正在生成快照...', 'info');
        const r = await global.CanvasSnapshot.copySnapshotToClipboard();
        if (r.partial) {
          setMessage('⚠️ 浏览器不支持图片剪贴板，已仅复制文本描述（' + r.textBytes + ' 字节）。', 'info');
        } else {
          setMessage('✓ 已复制：' + r.width + '×' + r.height + ' PNG（' + Math.round(r.pngBytes / 1024) + 'KB）+ 上下文描述（' + r.textBytes + ' 字节）。可粘贴给 ChatGPT/Claude。', 'info');
        }
      } catch (e) {
        setMessage('快照失败：' + e.message + '。提示：按住 Shift 再点此按钮可改为下载 PNG 文件。', 'error');
      }
    });
    if (dom.exportSceneBtn) dom.exportSceneBtn.addEventListener('click', exportScene);
    if (dom.importSceneBtn) dom.importSceneBtn.addEventListener('click', function () {
      if (dom.importSceneInput) dom.importSceneInput.click();
    });
    if (dom.importSceneInput) dom.importSceneInput.addEventListener('change', function () {
      const f = dom.importSceneInput.files && dom.importSceneInput.files[0];
      dom.importSceneInput.value = '';
      if (f) importScene(f);
    });
    if (dom.undoBtn) dom.undoBtn.addEventListener('click', performUndo);
    dom.resetGameBtn.addEventListener('click', function () {
      S.restoreFromBaseline();
      S.state.selectedId = null;
      render();
      setMessage('已重置游戏到上一次蓝图状态。');
    });
  }

  // ===== 模式切换：editMode 即 UI 模式；同时控制 Game.clock.paused =====
  function toggleEditMode() {
    S.state.editMode = !S.state.editMode;
    closeContextMenu();
    DC.cancel();
    panState.active = false;
    if (S.state.editMode) {
      // 进入暂停：清空撤销栈，只能撤销本次暂停期间的变更
      S.clearUndo();
    }
    if (global.Game && typeof global.Game.setPaused === 'function') {
      global.Game.setPaused(S.state.editMode);
    }
    S.state.selectedId = null;
    render();
    setMessage(S.state.editMode ? '已暂停（时钟冻结）。按 Z 继续。' : '游戏中…按 Z 暂停。');
  }

  // ===== 撤销 / 导出入 =====
  function performUndo() {
    if (!S.state.editMode) {
      setMessage('游戏中不能撤销。先按 Z 暂停。', 'error'); return;
    }
    const label = S.undo();
    if (!label) { setMessage('已在暂停起始状态，没有可撤销的步骤。', 'error'); return; }
    render();
    setMessage('← 已撤销：' + label + '（栈余 ' + S.undoStackSize() + ' 步）');
  }

  function exportScene() {
    if (!window.SceneIO) { setMessage('SceneIO 未加载', 'error'); return; }
    const bytes = window.SceneIO.exportSceneZip();
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url; a.download = 'webhachimi-scene-' + ts + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    const taskCount = (S.state.globalTasks || []).length;
    const attCount = (S.state.globalTasks || []).reduce(function (n, t) { return n + (t.attachments ? t.attachments.length : 0); }, 0);
    setMessage('已导出场景包（' + S.state.objects.length + ' 对象 / ' + taskCount + ' 任务 / ' + attCount + ' 附件）。解压到仓库即可 git 追踪。');
  }

  function importScene(file) {
    if (!window.SceneIO) { setMessage('SceneIO 未加载', 'error'); return; }
    window.SceneIO.importSceneFile(file).then(function (result) {
      if (!result || !result.ok) { setMessage('导入失败：' + (result && result.error || '未知错误'), 'error'); return; }
      render();
      setMessage('已导入场景：' + file.name + '。可 Ctrl+Z 撤销。');
    }).catch(function (e) {
      setMessage('读取文件失败：' + e.message, 'error');
    });
  }

  // ===== 上下文菜单 =====
  function getContextMenuObject() { return S.getObjectById(S.state.ui.contextMenu.objectId); }

  function closeContextMenu() {
    S.state.ui.contextMenu.open = false;
    S.state.ui.contextMenu.objectId = null;
    S.state.ui.contextMenu.renameValue = '';
    renderContextMenu();
  }

  function openContextMenu(objectId, clientX, clientY) {
    const target = S.getObjectById(objectId);
    if (!target) return;
    S.state.selectedId = objectId;
    S.state.ui.contextMenu.open = true;
    S.state.ui.contextMenu.x = clientX;
    S.state.ui.contextMenu.y = clientY;
    S.state.ui.contextMenu.objectId = objectId;
    S.state.ui.contextMenu.renameValue = target.name;
    render();
    requestAnimationFrame(function () {
      dom.contextMenuNameInput.focus();
      dom.contextMenuNameInput.select();
    });
  }

  function renameObjectFromMenu() {
    const target = getContextMenuObject();
    if (!target) return;
    const next = S.state.ui.contextMenu.renameValue.trim();
    if (!next) { setMessage('名称不能为空。', 'error'); return; }
    if (target.name === next) { closeContextMenu(); return; }
    S.recordUndo('重命名');
    target.name = next;
    S.captureBaseline();
    closeContextMenu();
    render();
    setMessage('已重命名为"' + next + '"。');
  }

  function deleteObjectFromMenu() {
    const target = getContextMenuObject();
    if (!target) return;
    S.recordUndo('删除对象');
    const id = target.id;
    S.state.objects = S.state.objects.filter(function (o) {
      return o.id !== id && o.parentId !== id;
    });
    if (S.state.selectedId === id) S.state.selectedId = null;
    S.captureBaseline();
    closeContextMenu();
    render();
    setMessage('已删除"' + target.name + '"。');
  }

  function bindContextMenu() {
    dom.contextMenuNameInput.addEventListener('input', function (e) {
      S.state.ui.contextMenu.renameValue = e.target.value;
    });
    dom.contextMenuNameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); renameObjectFromMenu(); }
      if (e.key === 'Escape') { e.preventDefault(); closeContextMenu(); }
    });
    dom.renameObjectBtn.addEventListener('click', renameObjectFromMenu);
    dom.deleteObjectBtn.addEventListener('click', deleteObjectFromMenu);
  }

  function renderContextMenu() {
    const target = getContextMenuObject();
    if (!S.state.editMode || !S.state.ui.contextMenu.open || !target) {
      dom.objectContextMenu.classList.add('hidden');
      dom.objectContextMenu.setAttribute('aria-hidden', 'true');
      return;
    }
    dom.objectContextMenu.classList.remove('hidden');
    dom.objectContextMenu.setAttribute('aria-hidden', 'false');
    dom.contextMenuTitle.textContent = target.name || '对象菜单';
    if (dom.contextMenuNameInput.value !== S.state.ui.contextMenu.renameValue) {
      dom.contextMenuNameInput.value = S.state.ui.contextMenu.renameValue;
    }
    const menuWidth = dom.objectContextMenu.offsetWidth || 220;
    const menuHeight = dom.objectContextMenu.offsetHeight || 120;
    const left = clamp(S.state.ui.contextMenu.x, 8, window.innerWidth - menuWidth - 8);
    const top = clamp(S.state.ui.contextMenu.y, 8, window.innerHeight - menuHeight - 8);
    dom.objectContextMenu.style.left = left + 'px';
    dom.objectContextMenu.style.top = top + 'px';
  }

  // ===== 活动面板高度调整 =====
  function getDrawerMaxHeight() { return Math.round(window.innerHeight * 0.75); }
  function applyDrawerHeight() {
    if (!S.state.ui.drawerHeight) S.state.ui.drawerHeight = 280;
    S.state.ui.drawerHeight = clamp(S.state.ui.drawerHeight, 80, getDrawerMaxHeight());
    if (!dom.taskDrawer.classList.contains('is-minimized')) {
      dom.taskDrawer.style.height = S.state.ui.drawerHeight + 'px';
    }
  }
  // 保持向后兼容：split 不再使用
  function applyDrawerSplit() {}

  function bindDrawerHandles() {
    dom.drawerHandle.addEventListener('pointerdown', function (e) {
      if (!S.state.editMode || e.button !== 0) return;
      e.preventDefault();
      drawerState.active = true;
      drawerState.startY = e.clientY;
      drawerState.startHeight = S.state.ui.drawerHeight || 280;
    });
  }

  // ===== 舞台事件 =====
  function bindStage() {
    dom.stage.addEventListener('click', function () {
      if (!S.state.editMode) return;
      if (suppressNextStageClick) { suppressNextStageClick = false; return; }
      closeContextMenu();
      S.clearSelection();
      render();
    });
    dom.stage.addEventListener('contextmenu', function (e) {
      if (!S.state.editMode) return;
      e.preventDefault();
      closeContextMenu();
    });
    dom.stage.addEventListener('pointerdown', function (e) {
      if (!S.state.editMode) return;
      if (e.button === 1) {
        e.preventDefault();
        panState.active = true;
        panState.startX = e.clientX;
        panState.startY = e.clientY;
        panState.originX = S.state.view.x;
        panState.originY = S.state.view.y;
        renderLayout();
        return;
      }
      if (e.button === 0 && !e.target.closest('[data-id]')) {
        // 空白区域左键 → 开始框选
        e.preventDefault();
        const ws = E.screenToWorld(e.clientX, e.clientY);
        marqueeState.active = true;
        marqueeState.additive = e.shiftKey;
        marqueeState.startWorld = { x: ws.x, y: ws.y };
        marqueeState.x = ws.x; marqueeState.y = ws.y;
        marqueeState.w = 0; marqueeState.h = 0;
      }
    });
    dom.stage.addEventListener('wheel', function (e) {
      if (!S.state.editMode) return;
      // 如果滚轮在 UI 面板内，不缩放世界（让面板自然滚动）
      if (e.target && e.target.closest && e.target.closest('.task-drawer, .props-body, .panel-pane, .ai-assistant-pane, .world-tree-list, .activity-panel, .panel-body, .panel-tabbar, .panel-task-list, .drawer-task-list')) return;
      e.preventDefault();
      const pointer = E.screenToWorld(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const nextScale = clamp(
        Number((S.state.view.scale * factor).toFixed(3)),
        C.MIN_SCALE,
        C.MAX_SCALE,
      );
      const rect = E.getStageRect();
      S.state.view.scale = nextScale;
      S.state.view.x = e.clientX - rect.left - pointer.x * nextScale;
      S.state.view.y = e.clientY - rect.top - pointer.y * nextScale;
      E.applyViewportTransform();
      S.persistState();
    }, { passive: false });
    dom.stage.addEventListener('auxclick', function (e) {
      if (S.state.editMode && e.button === 1) e.preventDefault();
    });
  }

  // ===== 全局指针/键盘 =====
  function bindWindow() {
    window.addEventListener('contextmenu', function (e) {
      if (e.target.closest && (e.target.closest('.canvas-app') || e.target.closest('.object-context-menu'))) {
        e.preventDefault();
      }
    });
    window.addEventListener('pointerdown', function (e) {
      if (!S.state.ui.contextMenu.open) return;
      const insideMenu = dom.objectContextMenu.contains(e.target);
      const onObject = e.target.closest && e.target.closest('[data-id]');
      if (!insideMenu && !onObject) closeContextMenu();
    });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('resize', function () {
      S.state.objects.forEach(S.ensureObjectInStage);
      E.applyViewportTransform();
      applyDrawerHeight();
      applyDrawerSplit();
      render();
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (S.state.ui.contextMenu.open) { closeContextMenu(); return; }
        if (S.state.editMode && S.state.selectedIds.size > 0) {
          S.clearSelection();
          render();
        }
        return;
      }
      const tag = document.activeElement && document.activeElement.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      // Ctrl+A 全选
      if (!typing && S.state.editMode && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const ids = S.state.objects.filter(function (o) { return !o.isHitbox; }).map(function (o) { return o.id; });
        S.state.selectedIds = new Set(ids);
        S.state.selectedId = ids.length ? ids[ids.length - 1] : null;
        render();
        setMessage('已全选 ' + ids.length + ' 个对象（Esc 取消）。');
        return;
      }
      // Delete / Backspace 批量删除
      if (!typing && S.state.editMode && (e.key === 'Delete' || e.key === 'Backspace') && S.state.selectedIds.size > 0) {
        e.preventDefault();
        const ids = Array.from(S.state.selectedIds);
        S.recordUndo('批量删除');
        S.state.objects = S.state.objects.filter(function (o) {
          return !S.state.selectedIds.has(o.id) && !S.state.selectedIds.has(o.parentId);
        });
        S.clearSelection();
        S.captureBaseline();
        render();
        setMessage('已删除 ' + ids.length + ' 个对象。');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        S.restoreFromBaseline();
        S.clearSelection();
        render();
        setMessage('（Ctrl+R）已重置游戏到上一次蓝图状态。');
        return;
      }
      if (typing && e.key.toLowerCase() !== 'z') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        performUndo();
        return;
      }
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); toggleEditMode(); }
    });
  }

  function onPointerMove(e) {
    if (drawerState.active) {
      S.state.ui.drawerHeight = drawerState.startHeight + (drawerState.startY - e.clientY);
      applyDrawerHeight();
    }

    if (marqueeState.active) {
      const cur = E.screenToWorld(e.clientX, e.clientY);
      marqueeState.x = Math.min(marqueeState.startWorld.x, cur.x);
      marqueeState.y = Math.min(marqueeState.startWorld.y, cur.y);
      marqueeState.w = Math.abs(cur.x - marqueeState.startWorld.x);
      marqueeState.h = Math.abs(cur.y - marqueeState.startWorld.y);
      updateMarqueeEl();
      return;
    }

    if (panState.active) {
      S.state.view.x = Math.round(panState.originX + (e.clientX - panState.startX));
      S.state.view.y = Math.round(panState.originY + (e.clientY - panState.startY));
      E.applyViewportTransform();
      return;
    }
    DC.handlePointerMove(e);
  }

  function onPointerUp() {
    // 框选结束
    if (marqueeState.active) {
      if (marqueeState.w > 4 && marqueeState.h > 4) {
        finishMarquee();
        suppressNextStageClick = true;  // 阻止随后的 click 事件清空选中
      }
      marqueeState.active = false;
      updateMarqueeEl();
      render();
      return;
    }
    const dragWasActive = DC.handlePointerUp();
    const otherWasActive = drawerState.active || panState.active;
    panState.active = false;
    drawerState.active = false;
    if (dragWasActive) {

      S.captureBaseline();
      S.persistState();
    } else if (otherWasActive) {
      S.persistState();
    }
    renderLayout();
  }

  // ===== 顶层 render =====
  function renderLayout() {
    document.body.classList.toggle('edit-mode', S.state.editMode);
    document.body.classList.toggle('play-mode', !S.state.editMode);
    document.body.classList.toggle('pan-mode', panState.active);
    dom.toolDock.setAttribute('aria-hidden', String(!S.state.editMode));
    dom.taskDrawer.setAttribute('aria-hidden', String(!S.state.editMode));
    dom.modeBadge.textContent = S.state.editMode ? '编辑模式' : '游戏模式';
    applyDrawerHeight();
    applyDrawerSplit();
    E.applyViewportTransform();
  }

  let _rafPending = false;
  function render() {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(function () {
      _rafPending = false;
      renderLayout();
      E.renderStage(DC.getStageHandlers());
      PP.render();
      TP.render();
      if (global.WorldTree) global.WorldTree.render();
      if (global.TaskManager) global.TaskManager.render();
      renderContextMenu();
      const showHint = S.state.editMode && S.state.objects.length === 0;
      dom.stageHint.classList.toggle('hidden', !showHint);
      if (showHint) dom.stageHint.innerHTML = '按 <kbd>Z</kbd> 返回游戏，先点左侧工具创建图形';
      TP.focusPendingTaskEditor();
      S.persistState();
    });
  }

  global.Editor = {
    init: init,
    render: render,
    renderLayout: renderLayout,
    toggleEditMode: toggleEditMode,
    closeContextMenu: closeContextMenu,
    createShape: createShape,
  };
})(window);