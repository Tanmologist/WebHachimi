// app.js —— 引导：加载状态、收集 DOM 引用、启动编辑器与游戏
(function () {
  'use strict';

  const dom = {
    stage: document.getElementById('stage'),
    world: document.getElementById('world'),
    stageHint: document.getElementById('stageHint'),
    statusMessage: document.getElementById('statusMessage'),
    modeBadge: document.getElementById('modeBadge'),
    zoomBadge: document.getElementById('zoomBadge'),

    toolDock: document.getElementById('toolDock'),
    createSquareBtn: document.getElementById('createSquareBtn'),
    createCircleBtn: document.getElementById('createCircleBtn'),
    createTriangleBtn: document.getElementById('createTriangleBtn'),
    createPenBtn: document.getElementById('createPenBtn'),
    createBrushBtn: document.getElementById('createBrushBtn'),
    superSketchBtn: document.getElementById('superSketchBtn'),
    snapshotForAiBtn: document.getElementById('snapshotForAiBtn'),
    undoBtn: document.getElementById('undoBtn'),
    exportSceneBtn: document.getElementById('exportSceneBtn'),
    importSceneBtn: document.getElementById('importSceneBtn'),
    importSceneInput: document.getElementById('importSceneInput'),
    resetGameBtn: document.getElementById('resetGameBtn'),

    taskDrawer: document.getElementById('taskDrawer'),
    drawerHandle: document.getElementById('drawerHandle'),
    drawerSplitter: document.getElementById('drawerSplitter'),
    drawerEyebrow: document.getElementById('drawerEyebrow'),
    drawerTitle: document.getElementById('drawerTitle'),
    drawerSubtitle: document.getElementById('drawerSubtitle'),

    propsBody: document.getElementById('propsBody'),
    worldTreeList: document.getElementById('worldTreeList'),
    taskMgrList: document.getElementById('taskMgrList'),
    taskMgrFilter: document.getElementById('taskMgrFilter'),
    consolePanelList: document.getElementById('consolePanelList'),
    consoleFilter: document.getElementById('consoleFilter'),
    consoleClearBtn: document.getElementById('consoleClearBtn'),
    contextTaskList: document.getElementById('contextTaskList'),
    addTaskBtn: document.getElementById('addTaskBtn'),
    commandInput: document.getElementById('commandInput'),
    runCommandBtn: document.getElementById('runCommandBtn'),

    objectContextMenu: document.getElementById('objectContextMenu'),
    contextMenuTitle: document.getElementById('contextMenuTitle'),
    contextMenuNameInput: document.getElementById('contextMenuNameInput'),
    renameObjectBtn: document.getElementById('renameObjectBtn'),
    deleteObjectBtn: document.getElementById('deleteObjectBtn'),
  };

  let messageTimer = null;
  function setMessage(text, tone) {
    if (!dom.statusMessage) return;
    dom.statusMessage.textContent = text;
    dom.statusMessage.dataset.tone = tone || 'info';
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = setTimeout(function () {
      dom.statusMessage.textContent = '';
      dom.statusMessage.dataset.tone = 'info';
    }, 4200);
  }

  State.loadPersistedState();

  if (State.state.objects.length === 0) {
    const player = State.normalizeShape({
      id: State.generateShapeId(), type: 'square', name: '主角',
      role: 'player',
      x: 80, y: -80, width: 80, height: 80,
      look: 'fancy', theme: 'green',
    }, 0);
    const floor = State.normalizeShape({
      id: State.generateShapeId(), type: 'square', name: '地板',
      role: 'floor',
      x: -200, y: 40, width: 800, height: 60,
      look: 'basic', theme: 'blue',
    }, 1);
    State.state.objects.push(player, floor);
    State.captureBaseline();
  }

  Engine.bindDom(dom);
  Editor.init(dom, {
    renderAll: function () { Editor.render(); },
    setMessage: setMessage,
  });
  Game.init(dom, {
    renderStageOnly: function () {
      Engine.renderStage({
        onClick: function () {}, onContextMenu: function () {},
        onPointerDown: function () {}, onResizeStart: function () {},
        onRotateStart: function () {}, onPivotStart: function () {},
      });
    },
  });

  Editor.render();
  // 初始为编辑模式 → 时钟也应处于暂停
  Game.setPaused(State.state.editMode);
  Game.start();

  setMessage('就绪。按 Z 切换编辑/游戏模式；编辑模式下右键对象重命名或删除。');

  // ===== 服务器同步检测 =====
  // 如果是双击 start.bat 启动的（运行在 http://localhost），自动接管：
  //   - 从 server 加载最新场景（覆盖 localStorage）
  //   - 之后所有改动自动 POST 落盘到 scene.json + assets/
  // 如果是直接双击 index.html（file://），跳过，继续走 localStorage 老路径。
  (async function tryServerSync() {
    if (!window.ServerSync) return;
    const ok = await window.ServerSync.detect();
    if (!ok) {
      setMessage('提示：当前是离线模式（file://）。要让场景自动落盘到磁盘并让团队 git 协作，请双击 start.bat 启动同步服务。', 'info');
      return;
    }
    try {
      const r = await window.ServerSync.loadFromServer();
      window.ServerSync.activate();
      window.ServerSync.setListener(function (ev) {
        if (ev.kind === 'saving') setMessage('💾 同步中…', 'info');
        else if (ev.kind === 'saved') setMessage('✓ 已同步到磁盘 · ' + (ev.attachments || 0) + ' 附件 · ' + new Date().toLocaleTimeString(), 'info');
        else if (ev.kind === 'error') setMessage('同步失败：' + ev.error, 'error');
      });
      Editor.render();
      if (r.empty) {
        // server 上还没有 scene.json：把当前 localStorage 内容立即推送上去建立初始版本
        setMessage('已连接同步服务（仓库内还没有 scene.json，正在上传当前内容作为初始版本）...', 'info');
        try { await window.ServerSync.saveToServer(); } catch (e) { console.warn(e); }
        setMessage('✓ 已建立 scene.json 初始版本，之后改动会自动落盘。', 'info');
      } else {
        setMessage('✓ 已从同步服务加载场景（最后保存：' + (r.savedAt || '未知') + '），改动会自动落盘到 scene.json + assets/。', 'info');
      }
    } catch (e) {
      console.warn('serverSync 启动失败', e);
      setMessage('同步服务连接失败：' + e.message + '，已回退到离线模式。', 'error');
    }
  })();

  // ===== 活动面板 Tab 切换 & 最小化 =====
  (function initPanelTabs() {
    const panel = dom.taskDrawer;
    if (!panel) return;

    const tabs = panel.querySelectorAll('.panel-tab[data-pane]');
    const minimizeBtn = document.getElementById('panelMinimizeBtn');

    function switchTo(paneId) {
      tabs.forEach(function (t) {
        const active = t.dataset.pane === paneId;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      panel.querySelectorAll('.panel-pane').forEach(function (p) {
        if (p.id === paneId) {
          p.removeAttribute('hidden');
          p.classList.add('is-active');
        } else {
          p.setAttribute('hidden', '');
          p.classList.remove('is-active');
        }
      });
      // 切换到世界树时强制重渲
      if (paneId === 'paneWorldTree' && window.WorldTree) window.WorldTree.render();
      // 切换到属性时强制重渲
      if (paneId === 'paneProps' && window.Editor) window.Editor.render();
      // 切换到任务管理器时强制重渲
      if (paneId === 'paneTaskMgr' && window.TaskManager) window.TaskManager.render();
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        // 如果面板已最小化，先展开
        if (panel.classList.contains('is-minimized')) {
          panel.classList.remove('is-minimized');
          if (minimizeBtn) minimizeBtn.textContent = '—';
        }
        switchTo(tab.dataset.pane);
      });
    });

    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', function () {
        const minimized = panel.classList.toggle('is-minimized');
        minimizeBtn.textContent = minimized ? '□' : '—';
        minimizeBtn.title = minimized ? '展开面板' : '最小化面板';
      });
    }
  })();
})();
