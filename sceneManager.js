// sceneManager.js —— 多场景/关卡切换管理器
// 依赖：state.js, engine.js, serverSync.js（可选）
(function (global) {
  'use strict';

  // 内置淡入淡出过渡遮罩
  let _overlay = null;
  function getOverlay() {
    if (_overlay) return _overlay;
    _overlay = document.createElement('div');
    _overlay.id = 'sceneTransitionOverlay';
    Object.assign(_overlay.style, {
      position: 'fixed', inset: '0', background: '#000',
      opacity: '0', pointerEvents: 'none',
      transition: 'opacity 0.3s ease',
      zIndex: '99999',
    });
    document.body.appendChild(_overlay);
    return _overlay;
  }

  function fadeOut() {
    return new Promise(function (resolve) {
      const ov = getOverlay();
      ov.style.pointerEvents = 'auto';
      ov.style.opacity = '1';
      setTimeout(resolve, 320);
    });
  }
  function fadeIn() {
    return new Promise(function (resolve) {
      const ov = getOverlay();
      ov.style.opacity = '0';
      ov.style.pointerEvents = 'none';
      setTimeout(resolve, 320);
    });
  }

  async function applyScene(sceneData, opts) {
    const fade = opts && opts.fade !== false;
    if (fade) await fadeOut();

    // 暂停游戏
    if (global.Game) global.Game.setPaused(true);

    // 用 applyFullSnapshot 加载新场景（会调用 captureBaseline + persistState）
    State.applyFullSnapshot
      ? State.applyFullSnapshot(JSON.stringify(sceneData))
      : (() => {
          // fallback: 直接赋值
          if (Array.isArray(sceneData.objects)) {
            State.state.objects = sceneData.objects.map(function (s, i) {
              return State.normalizeShape(s, i);
            });
          }
          if (Array.isArray(sceneData.globalTasks)) State.state.globalTasks = sceneData.globalTasks;
          if (Number.isFinite(sceneData.nextId)) State.state.nextId = sceneData.nextId;
          State.captureBaseline();
          State.persistState();
        })();

    // 重新渲染 UI
    if (global.Editor && Editor.render) Editor.render();
    if (global.WorldTree && WorldTree.render) WorldTree.render();
    if (global.TaskManager && TaskManager.render) TaskManager.render();
    if (global.AIEngine) {
      const aiPane = document.getElementById('aiAssistantPane');
      if (aiPane) AIEngine.renderPanel(aiPane);
    }

    if (fade) await fadeIn();

    // 恢复游戏（如果之前在游戏模式）
    if (global.Game && !State.state.editMode) global.Game.setPaused(false);
  }

  const SceneManager = {
    _currentId: 'default',

    /** 获取当前场景 ID */
    get currentId() { return this._currentId; },

    /**
     * 列出服务器上所有场景
     * @returns {Promise<Array<{id,file}>>}
     */
    async listScenes() {
      const resp = await fetch('/api/scenes');
      const data = await resp.json();
      return data.scenes || [];
    },

    /**
     * 从服务器加载指定场景并切换到它
     * @param {string} sceneId   - 场景 ID（对应 scene-<id>.json）
     * @param {object} [opts]    - { fade: true }
     */
    async loadScene(sceneId, opts) {
      const resp = await fetch('/api/scene/' + sceneId);
      if (!resp.ok) {
        console.error('[SceneManager] 找不到场景：', sceneId);
        return false;
      }
      const data = await resp.json();
      if (!data.ok || !data.scene) {
        console.error('[SceneManager] 加载场景失败：', data.error);
        return false;
      }
      await applyScene(data.scene, opts);
      this._currentId = sceneId;
      console.info('[SceneManager] 已切换到场景：', sceneId);
      return true;
    },

    /**
     * 保存当前场景到服务器
     * @param {string} [sceneId]   - 场景 ID，默认用当前 ID
     */
    async saveCurrentScene(sceneId) {
      const id = sceneId || this._currentId;
      const scene = State.exportSceneJSON ? JSON.parse(State.exportSceneJSON()) : State.state;
      const resp = await fetch('/api/scene/' + id + '/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scene),
      });
      const data = await resp.json();
      if (data.ok) console.info('[SceneManager] 已保存场景：scene-' + id + '.json');
      return data.ok;
    },

    /**
     * 直接切换到一个已经在内存中的场景对象（不经过服务器）
     * 可用于 AI 注入代码快速加载场景
     */
    async applyScene(sceneData, opts) {
      await applyScene(sceneData, opts);
      this._currentId = (sceneData && sceneData.id) || 'dynamic';
    },
  };

  global.SceneManager = SceneManager;
})(window);
