// taskPanel.js —— 任务/备忘录面板（人类与 AI 共享的备忘录）
// 不解析任务文本，只负责增/删/改/渲染。文本命令的执行交给外部 AI。
(function (global) {
  'use strict';
  const S = global.State;

  let dom;
  let setMessage;
  let requestRender;

  function init(deps) {
    dom = deps.dom;
    setMessage = deps.setMessage;
    requestRender = deps.requestRender;
    bindEvents();
  }

  function bindEvents() {
    dom.addTaskBtn.addEventListener('click', addTopLevelTask);
    dom.runCommandBtn.addEventListener('click', function () {
      const ctx = getCurrentContext();
      const value = dom.commandInput.value.trim();
      if (!value) { setMessage('先写一段备注或任务。', 'error'); return; }
      S.recordUndo('新建任务');
      const task = createTask(getNextTopLevelTaskPath(ctx.tasks));
      task.text = value;
      ctx.tasks.push(task);
      S.state.ui.pendingTaskFocus = task.id;
      dom.commandInput.value = '';
      S.captureBaseline();
      requestRender();
      setMessage('已记录到' + (ctx.scope === 'global' ? '全局任务' : '对象任务') + ' ' + task.path + '。');
    });
    dom.commandInput.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') dom.runCommandBtn.click();
    });
  }

  // —— 纯工具 ——
  function createTask(path) { return { id: S.generateTaskId(), path: path, text: '', done: false }; }
  function getTaskSegments(path) { return String(path).split('.').map(Number); }
  function compareTaskPaths(a, b) {
    const A = getTaskSegments(a); const B = getTaskSegments(b);
    const len = Math.max(A.length, B.length);
    for (let i = 0; i < len; i += 1) {
      const av = A[i] == null ? -1 : A[i];
      const bv = B[i] == null ? -1 : B[i];
      if (av !== bv) return av - bv;
    }
    return 0;
  }
  function sortTasks(tasks) { return tasks.slice().sort(function (a, b) { return compareTaskPaths(a.path, b.path); }); }
  function getNextTopLevelTaskPath(tasks) {
    const tops = tasks.map(function (t) { return getTaskSegments(t.path)[0] || 0; });
    return String(tops.length ? Math.max.apply(null, tops) + 1 : 1);
  }
  function getNextChildTaskPath(tasks, parentPath) {
    const parentDepth = getTaskSegments(parentPath).length;
    const direct = tasks.filter(function (t) {
      return String(t.path).indexOf(parentPath + '.') === 0
        && getTaskSegments(t.path).length === parentDepth + 1;
    });
    const indexes = direct.map(function (t) {
      const seg = getTaskSegments(t.path);
      return seg[seg.length - 1] || 0;
    });
    return parentPath + '.' + (indexes.length ? Math.max.apply(null, indexes) + 1 : 1);
  }

  function getCurrentContext() {
    const sel = S.getSelectedObject();
    if (sel) {
      sel.tasks = sel.tasks || [];
      return {
        scope: 'object',
        label: sel.name || '未命名对象',
        subtitle: '当前显示该对象的任务。点击空白可切回全局任务。',
        tasks: sel.tasks,
        selected: sel,
      };
    }
    return {
      scope: 'global',
      label: '全局任务',
      subtitle: '没选中对象时，这里就是整个项目的备忘录。',
      tasks: S.state.globalTasks,
      selected: null,
    };
  }

  function addTopLevelTask() {
    const ctx = getCurrentContext();
    S.recordUndo('新建任务');
    const t = createTask(getNextTopLevelTaskPath(ctx.tasks));
    ctx.tasks.push(t);
    S.state.ui.pendingTaskFocus = t.id;
    S.captureBaseline();
    requestRender();
  }

  function addChildTask(parent) {
    const ctx = getCurrentContext();
    S.recordUndo('新建子任务');
    const t = createTask(getNextChildTaskPath(ctx.tasks, parent.path));
    ctx.tasks.push(t);
    S.state.ui.pendingTaskFocus = t.id;
    S.captureBaseline();
    requestRender();
  }

  function focusPendingTaskEditor() {
    if (!S.state.ui.pendingTaskFocus) return;
    const editor = document.querySelector('[data-task-id="' + S.state.ui.pendingTaskFocus + '"]');
    if (!editor) return;
    const id = S.state.ui.pendingTaskFocus;
    requestAnimationFrame(function () {
      editor.focus();
      if (editor.setSelectionRange) editor.setSelectionRange(editor.value.length, editor.value.length);
      if (S.state.ui.pendingTaskFocus === id) S.state.ui.pendingTaskFocus = null;
    });
  }

  function renderHeader(ctx) {
    dom.drawerEyebrow.textContent = ctx.scope === 'global' ? '全局' : '对象';
    dom.drawerTitle.textContent = ctx.label;
    dom.drawerSubtitle.textContent = ctx.subtitle;
    dom.commandInput.placeholder = ctx.scope === 'global'
      ? '例如：整个页面需要支持暗色主题…'
      : '例如：' + ctx.label + ' 还需要支持锁定';
  }

  function renderList(ctx) {
    dom.contextTaskList.innerHTML = '';
    const ordered = sortTasks(ctx.tasks);
    if (!ordered.length) {
      const empty = document.createElement('div');
      empty.className = 'task-empty';
      empty.textContent = ctx.scope === 'global'
        ? '还没有全局任务。可以在上面输入框写一句保存。'
        : '这个对象还没有任务。可以在上面输入框写一句保存。';
      dom.contextTaskList.appendChild(empty);
      return;
    }
    ordered.forEach(function (task) {
      dom.contextTaskList.appendChild(buildTaskCard(task, ctx));
    });
  }

  function buildTaskCard(task, ctx) {
    const depth = getTaskSegments(task.path).length;
    const card = document.createElement('article');
    card.className = 'task-card' + (task.done ? ' done' : '');
    card.style.marginLeft = Math.min((depth - 1) * 18, 72) + 'px';

    const top = document.createElement('div');
    top.className = 'task-card-top';
    const title = document.createElement('strong');
    title.className = 'task-card-title';
    title.textContent = (ctx.scope === 'global' ? '全局' : '任务') + ' ' + task.path;

    const actions = document.createElement('div');
    actions.className = 'task-card-actions';
    const childBtn = document.createElement('button');
    childBtn.type = 'button';
    childBtn.className = 'inline-mini-button';
    childBtn.textContent = '＋子';
    childBtn.addEventListener('click', function () { addChildTask(task); });

    const checkLabel = document.createElement('label');
    checkLabel.className = 'task-check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.addEventListener('change', function () {
      task.done = checkbox.checked;
      S.captureBaseline();
      requestRender();
    });
    const checkText = document.createElement('span');
    checkText.textContent = '完成';
    checkLabel.append(checkbox, checkText);
    actions.append(childBtn, checkLabel);
    top.append(title, actions);

    const textarea = document.createElement('textarea');
    textarea.className = 'task-text';
    textarea.rows = 2;
    textarea.placeholder = depth === 1 ? '在这里写任务说明…' : '在这里写子任务说明…';
    textarea.value = task.text;
    textarea.dataset.taskId = task.id;
    textarea.addEventListener('input', function () {
      task.text = textarea.value;
      // 高频输入：只持久化，baseline 由结构变更/模式切换统一回收
      S.persistState();
    });

    card.append(top, textarea);

    // 附件区
    const attachBox = document.createElement('div');
    attachBox.className = 'task-attachments';
    renderAttachmentList(attachBox, task);

    const attachBar = document.createElement('div');
    attachBar.className = 'task-attach-bar';
    const fileBtn = document.createElement('button');
    fileBtn.type = 'button';
    fileBtn.className = 'inline-mini-button';
    fileBtn.textContent = '📎 加附件';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      ingestFiles(task, fileInput.files, attachBox);
      fileInput.value = '';
    });
    fileBtn.addEventListener('click', function () { fileInput.click(); });
    const dropHint = document.createElement('span');
    dropHint.className = 'task-attach-hint';
    dropHint.textContent = '或拖入 / 粘贴（Ctrl+V）图片到这张卡片';
    attachBar.append(fileBtn, fileInput, dropHint);
    card.append(attachBox, attachBar);

    // 把整张卡片设为 drop target
    card.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0) {
        e.preventDefault();
        card.classList.add('drag-over');
      }
    });
    card.addEventListener('dragleave', function () { card.classList.remove('drag-over'); });
    card.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      card.classList.remove('drag-over');
      ingestFiles(task, e.dataTransfer.files, attachBox);
    });

    // 粘贴：在卡片任意位置（含 textarea 内）按 Ctrl+V/Cmd+V 粘贴图片或文件
    card.addEventListener('paste', function (e) {
      const cd = e.clipboardData;
      if (!cd) return;
      const files = [];
      // 1) clipboardData.files（截图/复制的图片文件通常落在这里）
      if (cd.files && cd.files.length) {
        for (let i = 0; i < cd.files.length; i++) files.push(cd.files[i]);
      }
      // 2) items 中 kind==='file'（兜底，部分浏览器只走这里）
      if (!files.length && cd.items && cd.items.length) {
        for (let i = 0; i < cd.items.length; i++) {
          const it = cd.items[i];
          if (it.kind === 'file') {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        }
      }
      if (!files.length) return; // 没有文件，让原本的文本粘贴正常工作
      e.preventDefault();
      ingestFiles(task, files, attachBox);
    });

    return card;
  }

  // —— 附件相关 —— 
  const SOFT_WARN_BYTES = 4 * 1024 * 1024;  // > 4MB 弹警告，但仍允许
  const HARD_LIMIT_BYTES = 50 * 1024 * 1024; // 单文件硬上限 50MB（再大就拒绝，避免明确失败）

  function ingestFiles(task, fileList, attachBox) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    S.recordUndo('添加附件');
    let pending = files.length;
    let added = 0;
    let warned = 0;
    let rejected = 0;
    files.forEach(function (file) {
      if (file.size > HARD_LIMIT_BYTES) {
        rejected += 1;
        if (--pending === 0) finalize();
        return;
      }
      if (file.size > SOFT_WARN_BYTES) warned += 1;
      const reader = new FileReader();
      reader.onload = function () {
        task.attachments = task.attachments || [];
        task.attachments.push({
          id: 'att-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl: reader.result,
        });
        added += 1;
        if (--pending === 0) finalize();
      };
      reader.onerror = function () {
        rejected += 1;
        if (--pending === 0) finalize();
      };
      reader.readAsDataURL(file);
    });

    function finalize() {
      renderAttachmentList(attachBox, task);
      try { S.captureBaseline(); S.persistState(); } catch (e) {}
      const parts = [];
      if (added) parts.push('已附加 ' + added + ' 个文件到任务 ' + task.path);
      if (warned) parts.push('其中 ' + warned + ' 个超过 4MB，浏览器存储可能写不下');
      if (rejected) parts.push(rejected + ' 个超过 50MB 上限被拒绝');
      if (parts.length) setMessage(parts.join('；') + '。', warned || rejected ? 'error' : 'info');
    }
  }

  function renderAttachmentList(container, task) {
    container.innerHTML = '';
    const list = task.attachments || [];
    if (!list.length) return;
    list.forEach(function (att) {
      const item = document.createElement('div');
      item.className = 'attach-item';
      if (att.mime && att.mime.indexOf('image/') === 0) {
        const img = document.createElement('img');
        img.src = att.dataUrl;
        img.alt = att.name;
        img.className = 'attach-thumb';
        item.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'attach-icon';
        icon.textContent = '📄';
        item.appendChild(icon);
      }
      const meta = document.createElement('span');
      meta.className = 'attach-meta';
      meta.textContent = att.name + ' · ' + formatBytes(att.size);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'attach-del';
      del.title = '移除附件';
      del.textContent = '×';
      del.addEventListener('click', function () {
        S.recordUndo('删除附件');
        task.attachments = (task.attachments || []).filter(function (a) { return a.id !== att.id; });
        renderAttachmentList(container, task);
        S.captureBaseline();
      });
      item.append(meta, del);
      container.appendChild(item);
    });
  }

  function formatBytes(n) {
    if (!Number.isFinite(n)) return '';
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
    return (n / 1024 / 1024).toFixed(2) + 'MB';
  }

  function render() {
    const ctx = getCurrentContext();
    renderHeader(ctx);
    renderList(ctx);
  }

  global.TaskPanel = {
    init: init,
    render: render,
    getCurrentContext: getCurrentContext,
    addTopLevelTask: addTopLevelTask,
    addChildTask: addChildTask,
    focusPendingTaskEditor: focusPendingTaskEditor,
  };
})(window);
