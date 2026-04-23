// taskManager.js —— 任务管理器：聚合所有任务（全局 + 各对象）按时间排序
(function (global) {
  'use strict';
  const S = global.State;

  let dom;
  let requestRender;
  let filterMode = 'all'; // 'all' | 'todo' | 'done'

  function init(refs, opts) {
    dom = refs;
    requestRender = opts.requestRender;
    if (dom.taskMgrFilter) {
      dom.taskMgrFilter.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        filterMode = btn.getAttribute('data-filter');
        dom.taskMgrFilter.querySelectorAll('[data-filter]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        render();
      });
    }
  }

  // ===== 聚合所有任务 =====
  function collectAllTasks() {
    const result = [];

    // 全局任务
    (S.state.globalTasks || []).forEach(function (t) {
      result.push({ task: t, scope: 'global', scopeLabel: '全局', objectId: null });
    });

    // 各对象任务
    (S.state.objects || []).forEach(function (obj) {
      (obj.tasks || []).forEach(function (t) {
        result.push({ task: t, scope: 'object', scopeLabel: obj.name || obj.id, objectId: obj.id });
      });
    });

    // 按创建时间排序（旧→新，没有 createdAt 的排最前）
    result.sort(function (a, b) {
      const ta = a.task.createdAt || '';
      const tb = b.task.createdAt || '';
      if (!ta && !tb) return 0;
      if (!ta) return -1;
      if (!tb) return 1;
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    return result;
  }

  function render() {
    const list = dom.taskMgrList;
    if (!list) return;
    list.innerHTML = '';

    let items = collectAllTasks();
    if (filterMode === 'todo') items = items.filter(function (i) { return !i.task.done; });
    else if (filterMode === 'done') items = items.filter(function (i) { return i.task.done; });

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'world-tree-empty';
      empty.textContent = filterMode === 'all'
        ? '暂无任务。在「任务」面板中为全局或对象添加任务。'
        : (filterMode === 'todo' ? '没有未完成的任务。' : '没有已完成的任务。');
      list.appendChild(empty);
      return;
    }

    items.forEach(function (item) {
      list.appendChild(buildRow(item));
    });
  }

  function buildRow(item) {
    const { task, scopeLabel, scope, objectId } = item;
    const row = document.createElement('div');
    row.className = 'tmgr-row' + (task.done ? ' is-done' : '');
    row.dataset.taskId = task.id;

    // 勾选框
    const checkWrap = document.createElement('label');
    checkWrap.className = 'tmgr-check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.addEventListener('change', function () {
      task.done = checkbox.checked;
      row.classList.toggle('is-done', task.done);
      S.captureBaseline();
      S.persistState();
    });
    checkWrap.appendChild(checkbox);

    // 作用域徽章
    const badge = document.createElement('span');
    badge.className = 'tmgr-badge tmgr-badge-' + scope;
    badge.textContent = scopeLabel;

    // 路径标签
    const pathLabel = document.createElement('span');
    pathLabel.className = 'tmgr-path';
    pathLabel.textContent = task.path;

    // 任务文本（可编辑）
    const textEl = document.createElement('span');
    textEl.className = 'tmgr-text';
    textEl.textContent = task.text || '（空任务）';
    textEl.title = task.text;
    textEl.contentEditable = 'true';
    textEl.spellcheck = false;
    textEl.addEventListener('blur', function () {
      const newText = textEl.textContent.trim();
      if (newText !== task.text) {
        task.text = newText;
        S.captureBaseline();
        S.persistState();
      }
    });
    textEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textEl.blur(); }
      if (e.key === 'Escape') { textEl.textContent = task.text; textEl.blur(); }
    });

    // 时间戳
    const timeEl = document.createElement('span');
    timeEl.className = 'tmgr-time';
    if (task.createdAt) {
      const d = new Date(task.createdAt);
      timeEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      timeEl.title = d.toLocaleString();
    }

    // 删除按钮
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'tmgr-del';
    delBtn.title = '删除此任务';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', function () {
      S.recordUndo('删除任务');
      if (scope === 'global') {
        S.state.globalTasks = (S.state.globalTasks || []).filter(function (t) { return t.id !== task.id; });
      } else if (objectId) {
        const obj = S.getObjectById(objectId);
        if (obj) obj.tasks = (obj.tasks || []).filter(function (t) { return t.id !== task.id; });
      }
      S.captureBaseline();
      requestRender();
    });

    row.append(checkWrap, badge, pathLabel, textEl, timeEl, delBtn);
    return row;
  }

  global.TaskManager = {
    init: init,
    render: render,
  };
})(window);
