// serverSync.js —— 与本地 server 自动同步
// 启动时检测 /api/health；若运行在 server 模式（双击 start.bat 启的），则：
//   - 从 /api/scene 拉取场景，把 attachment.path 转回 dataUrl 注入回 State
//   - 挂 State.setPersistHook(debounce POST /api/save) 实现自动落盘
// 若运行在 file:// 模式，全部跳过，走纯 localStorage 老路径。
(function (global) {
  'use strict';
  const S = global.State;

  const SAVE_DEBOUNCE_MS = 600;
  const FORCE_INTERVAL_MS = 30000; // 30 秒定时强制保存：连续操作下也保证最迟 30 秒落盘一次
  let active = false;
  let saveTimer = null;
  let forceTimer = null;
  let pendingSave = false;
  let lastSaveAt = 0;
  let listener = null;

  async function detect() {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (!r.ok) return false;
      const j = await r.json();
      return !!(j && j.ok && j.server === 'webhachimi');
    } catch { return false; }
  }

  async function fetchAssetAsDataUrl(path, mime) {
    const r = await fetch('/' + path, { cache: 'no-store' });
    if (!r.ok) throw new Error('fetch ' + path + ' 失败 ' + r.status);
    const blob = await r.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('blob → dataUrl 失败'));
      fr.readAsDataURL(blob);
    });
  }

  async function rehydrate(scene) {
    // 把 attachment 的 path 转成 dataUrl 注入回去
    if (!scene || !Array.isArray(scene.globalTasks)) return scene;
    for (const t of scene.globalTasks) {
      if (!Array.isArray(t.attachments)) continue;
      for (const a of t.attachments) {
        if (a.dataUrl) continue;
        if (!a.path) continue;
        try { a.dataUrl = await fetchAssetAsDataUrl(a.path, a.mime); }
        catch (e) { console.warn('附件加载失败', a.path, e.message); a.dataUrl = ''; }
      }
    }
    return scene;
  }

  async function loadFromServer() {
    const r = await fetch('/api/scene', { cache: 'no-store' });
    if (!r.ok) throw new Error('GET /api/scene 失败 ' + r.status);
    const j = await r.json();
    if (j.empty || !j.scene) return { empty: true };
    const scene = await rehydrate(j.scene);
    const result = S.importSceneJSON(JSON.stringify(scene));
    if (!result.ok) throw new Error('应用 server 场景失败：' + result.error);
    S.clearUndo();
    return { empty: false, savedAt: scene.savedAt };
  }

  async function saveToServer() {
    const scene = JSON.parse(S.exportSceneJSON());
    const r = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene }),
    });
    if (!r.ok) throw new Error('POST /api/save 失败 ' + r.status);
    const j = await r.json();
    lastSaveAt = Date.now();
    if (typeof listener === 'function') {
      try { listener({ kind: 'saved', savedAt: j.savedAt, attachments: j.attachments }); }
      catch (e) { console.warn(e); }
    }
    return j;
  }

  function scheduleSave() {
    if (!active) return;
    pendingSave = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      if (!pendingSave) return;
      pendingSave = false;
      try {
        if (typeof listener === 'function') listener({ kind: 'saving' });
        await saveToServer();
      } catch (e) {
        console.warn('自动保存失败', e);
        if (typeof listener === 'function') listener({ kind: 'error', error: e.message });
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function activate() {
    active = true;
    S.setPersistHook(scheduleSave);
    // 定时强制保存：每 FORCE_INTERVAL_MS 检查一次，如有未落盘改动就立即 flush
    if (forceTimer) clearInterval(forceTimer);
    forceTimer = setInterval(async () => {
      if (!active || !pendingSave) return;
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      pendingSave = false;
      try {
        if (typeof listener === 'function') listener({ kind: 'saving', forced: true });
        await saveToServer();
      } catch (e) {
        console.warn('定时强制保存失败', e);
        if (typeof listener === 'function') listener({ kind: 'error', error: e.message });
      }
    }, FORCE_INTERVAL_MS);
    // 关闭页面前 flush（用 sendBeacon 走 fire-and-forget，避免被 unload 截断）
    window.addEventListener('beforeunload', () => {
      if (!active || !pendingSave) return;
      try {
        const scene = JSON.parse(S.exportSceneJSON());
        const blob = new Blob([JSON.stringify({ scene })], { type: 'application/json' });
        navigator.sendBeacon('/api/save', blob);
      } catch (e) { /* 忽略 */ }
    });
  }

  function setListener(fn) { listener = typeof fn === 'function' ? fn : null; }
  function isActive() { return active; }
  function lastSaved() { return lastSaveAt; }
  async function flushNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (pendingSave) { pendingSave = false; await saveToServer(); }
  }

  global.ServerSync = {
    detect, loadFromServer, saveToServer, activate,
    setListener, isActive, lastSaved, flushNow,
  };
})(window);
