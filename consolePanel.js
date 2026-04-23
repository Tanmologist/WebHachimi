// consolePanel.js —— 控制台面板：截获 console 输出 + window.onerror，显示在面板中
// AI 可通过 GET /api/console-log 实时读取最新的日志条目。
(function (global) {
  'use strict';

  const MAX_ENTRIES = 200;
  const entries = [];        // { ts, type, msg }[]
  let filterType = 'all';    // 'all' | 'error' | 'warn' | 'log'
  let dom;
  let serverAvailable = false; // 检测到 localhost server 后才 POST

  // ===== 拦截 console =====
  const origLog   = console.log.bind(console);
  const origWarn  = console.warn.bind(console);
  const origError = console.error.bind(console);

  function intercept(type, orig) {
    return function () {
      orig.apply(console, arguments);
      const msg = Array.from(arguments).map(function (a) {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a, null, 2); } catch (e) { return String(a); }
      }).join(' ');
      pushEntry(type, msg);
    };
  }

  console.log   = intercept('log',   origLog);
  console.warn  = intercept('warn',  origWarn);
  console.error = intercept('error', origError);

  window.addEventListener('error', function (e) {
    pushEntry('error', (e.message || '未知错误') + (e.filename ? '\n  at ' + e.filename + ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    pushEntry('error', '未处理的 Promise 拒绝: ' + reason);
  });

  // ===== 内部记录 =====
  function pushEntry(type, msg) {
    const entry = { ts: new Date().toISOString(), type: type, msg: msg };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    renderEntry(entry);
    if (serverAvailable) sendToServer(entry);
  }

  function sendToServer(entry) {
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(function () { /* 静默失败 */ });
  }

  // ===== 检测 server =====
  fetch('/api/health').then(function () { serverAvailable = true; }).catch(function () {});

  // ===== DOM 渲染 =====
  function init(refs, opts) {
    dom = refs;
    if (!dom.consolePanelList) return;

    // 绑定过滤按钮
    if (dom.consoleFilter) {
      dom.consoleFilter.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        filterType = btn.getAttribute('data-filter');
        dom.consoleFilter.querySelectorAll('[data-filter]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        rebuildList();
      });
    }
    if (dom.consoleClearBtn) {
      dom.consoleClearBtn.addEventListener('click', function () {
        entries.length = 0;
        rebuildList();
      });
    }

    // 把已有的 entries 渲染出来
    rebuildList();
  }

  function rebuildList() {
    const list = dom.consolePanelList;
    if (!list) return;
    list.innerHTML = '';
    entries.forEach(function (e) {
      if (filterType !== 'all' && e.type !== filterType) return;
      list.appendChild(buildRow(e));
    });
    list.scrollTop = list.scrollHeight;
  }

  function renderEntry(entry) {
    const list = dom && dom.consolePanelList;
    if (!list) return;
    if (filterType !== 'all' && entry.type !== filterType) return;
    list.appendChild(buildRow(entry));
    list.scrollTop = list.scrollHeight;
  }

  function buildRow(entry) {
    const row = document.createElement('div');
    row.className = 'console-row console-' + entry.type;

    const ts = document.createElement('span');
    ts.className = 'console-ts';
    const d = new Date(entry.ts);
    ts.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const type = document.createElement('span');
    type.className = 'console-type';
    type.textContent = entry.type === 'error' ? '✕' : entry.type === 'warn' ? '⚠' : 'ℹ';

    const msg = document.createElement('span');
    msg.className = 'console-msg';
    msg.textContent = entry.msg;

    row.append(ts, type, msg);
    return row;
  }

  function render() { /* 实时追加，无需主动调用 */ }

  global.ConsolePanel = {
    init: init,
    render: render,
    getEntries: function () { return entries.slice(); },
  };
})(window);
