// taskPanel.js —— 任务/备忘录面板（人类与 AI 共享的备忘录）
// 不解析任务文本，只负责增/删/改/渲染。文本命令的执行交给外部 AI。
(function (global) {
  'use strict';
  const S = global.State;

  let dom;
  let setMessage;
  let requestRender;

  // 是否显示已完成任务（默认隐藏）
  let showDone = false;
  // 动态注入的"显示已完成"切换按钮
  let doneToggleBtn = null;

  function init(deps) {
    dom = deps.dom;
    setMessage = deps.setMessage;
    requestRender = deps.requestRender;
    bindEvents();
    // 注入"显示已完成"切换按钮（紧靠 addTaskBtn）
    doneToggleBtn = document.createElement('button');
    doneToggleBtn.type = 'button';
    doneToggleBtn.className = 'inline-mini-button';
    doneToggleBtn.style.fontSize = '0.68rem';
    doneToggleBtn.title = '显示/隐藏已完成任务';
    doneToggleBtn.textContent = '显示完成';
    dom.addTaskBtn.insertAdjacentElement('afterend', doneToggleBtn);
    doneToggleBtn.addEventListener('click', function () {
      showDone = !showDone;
      requestRender();
    });
  }

  function bindEvents() {
    dom.addTaskBtn.addEventListener('click', addTopLevelTask);
    dom.runCommandBtn.addEventListener('click', function () {
      const ctx = getCurrentContext();
      const value = dom.commandInput.value.trim();
      if (!value) { setMessage('先写一段备注或任务。', 'error'); return; }
      S.recordUndo('新建任务');
      if (ctx.scope === 'group') {
        // 群体：命令记录到所有选中对象
        ctx.selectedObjects.forEach(function (obj) {
          obj.tasks = obj.tasks || [];
          const t = createTask(getNextTopLevelTaskPath(obj.tasks));
          t.text = value;
          obj.tasks.push(t);
        });
        dom.commandInput.value = '';
        S.captureBaseline();
        requestRender();
        setMessage('已记录到 ' + ctx.selectedObjects.length + ' 个对象。');
        return;
      }
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
  function createTask(path) { return { id: S.generateTaskId(), path: path, text: '', done: false, createdAt: new Date().toISOString() }; }
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
    const selectedObjs = S.getSelectedObjects ? S.getSelectedObjects() : [];
    // 群体模式：2 个或以上对象同时选中
    if (selectedObjs.length > 1) {
      return {
        scope: 'group',
        label: selectedObjs.length + ' 个对象（群体）',
        subtitle: '添加任务会同时写入所有选中对象。',
        tasks: [],
        selectedObjects: selectedObjs,
      };
    }
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
    if (ctx.scope === 'group') {
      // 群体任务：同步添加到所有选中对象
      S.recordUndo('群体新建任务');
      ctx.selectedObjects.forEach(function (obj) {
        obj.tasks = obj.tasks || [];
        const t = createTask(getNextTopLevelTaskPath(obj.tasks));
        obj.tasks.push(t);
      });
      S.captureBaseline();
      requestRender();
      setMessage('已向 ' + ctx.selectedObjects.length + ' 个对象各添加一条任务。');
      return;
    }
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
    dom.drawerEyebrow.textContent = ctx.scope === 'global' ? '全局' : ctx.scope === 'group' ? '群体' : '对象';
    dom.drawerTitle.textContent = ctx.label;
    dom.drawerSubtitle.textContent = ctx.subtitle;
    dom.commandInput.placeholder = ctx.scope === 'global'
      ? '例如：整个页面需要支持暗色主题…'
      : ctx.scope === 'group'
        ? '例如：所有选中对象都需要支持点击反馈…'
        : '例如：' + ctx.label + ' 还需要支持锁定';
    // 更新"显示已完成"按钮文字
    if (doneToggleBtn) {
      const tasks = ctx.scope === 'group'
        ? ctx.selectedObjects.reduce(function (acc, o) { return acc.concat(o.tasks || []); }, [])
        : ctx.tasks || [];
      const doneCount = tasks.filter(function (t) { return t.done; }).length;
      doneToggleBtn.textContent = showDone ? '隐藏完成' : ('显示完成' + (doneCount ? ' (' + doneCount + ')' : ''));
      doneToggleBtn.style.opacity = doneCount ? '1' : '0.4';
    }
  }

  function renderList(ctx) {
    dom.contextTaskList.innerHTML = '';
    // 群体模式
    if (ctx.scope === 'group') {
      const allTasks = [];
      ctx.selectedObjects.forEach(function (obj) {
        (obj.tasks || []).forEach(function (t) {
          if (!showDone && t.done) return;
          allTasks.push({ obj: obj, task: t });
        });
      });
      if (!allTasks.length) {
        const empty = document.createElement('div');
        empty.className = 'task-empty';
        empty.textContent = showDone
          ? '所有选中对象都没有任务。点"添加任务"会同时写入所有对象。'
          : '没有未完成任务。点"显示完成"查看已完成。';
        dom.contextTaskList.appendChild(empty);
      } else {
        allTasks.forEach(function (entry) {
          const row = document.createElement('div');
          row.className = 'task-card' + (entry.task.done ? ' done' : '');
          row.style.marginLeft = '0';
          const badge = document.createElement('strong');
          badge.className = 'task-card-title';
          badge.style.display = 'block';
          badge.textContent = entry.obj.name + ' · ' + entry.task.path;
          const text = document.createElement('p');
          text.style.cssText = 'margin:2px 0 0;font-size:0.72rem;color:var(--muted);';
          text.textContent = entry.task.text || '（无内容）';
          row.append(badge, text);
          dom.contextTaskList.appendChild(row);
        });
      }
      return;
    }
    // 过滤
    const source = sortTasks(ctx.tasks);
    const ordered = showDone ? source : source.filter(function (t) { return !t.done; });
    if (!ordered.length) {
      const empty = document.createElement('div');
      empty.className = 'task-empty';
      if (source.length && !showDone) {
        empty.textContent = '所有任务均已完成 ✓  点"显示完成"查看。';
      } else {
        empty.textContent = ctx.scope === 'global'
          ? '还没有全局任务。可以在上面输入框写一句保存。'
          : '这个对象还没有任务。可以在上面输入框写一句保存。';
      }
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

    const execBtn = document.createElement('button');
    execBtn.type = 'button';
    execBtn.className = 'inline-mini-button task-exec-btn';
    execBtn.textContent = '执行';
    execBtn.title = '激活此任务：写入 active-task.json，AI 可直接读取';
    execBtn.addEventListener('click', function () { executeTask(task, ctx); });

    actions.append(childBtn, checkLabel, execBtn);
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

    // ── 追问区 ──────────────────────────────────────────
    const replySection = document.createElement('div');
    replySection.className = 'task-reply-section';
    // 已有回复列表
    const replyList = document.createElement('div');
    replyList.className = 'task-reply-list';
    function renderReplies() {
      replyList.innerHTML = '';
      (task.replies || []).forEach(function (r) {
        const rRow = document.createElement('div');
        rRow.className = 'task-reply-row';
        const rTs = document.createElement('span');
        rTs.className = 'task-reply-ts';
        rTs.textContent = r.ts ? new Date(r.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const rText = document.createElement('span');
        rText.className = 'task-reply-text';
        rText.textContent = r.text;
        rRow.append(rTs, rText);
        replyList.appendChild(rRow);
      });
    }
    renderReplies();
    // 追问按钮 + 输入行
    const replyToggleBtn = document.createElement('button');
    replyToggleBtn.type = 'button';
    replyToggleBtn.className = 'inline-mini-button';
    replyToggleBtn.style.fontSize = '0.68rem';
    replyToggleBtn.textContent = '＋ 追问';
    const replyInputRow = document.createElement('div');
    replyInputRow.className = 'task-reply-input-row';
    replyInputRow.style.display = 'none';
    const replyInput = document.createElement('textarea');
    replyInput.className = 'task-text';
    replyInput.rows = 1;
    replyInput.placeholder = '追问或补充说明…';
    replyInput.style.cssText = 'min-height:28px;resize:vertical;';
    const replySubmit = document.createElement('button');
    replySubmit.type = 'button';
    replySubmit.className = 'primary-pill';
    replySubmit.style.fontSize = '0.72rem';
    replySubmit.textContent = '发送';
    replyInputRow.append(replyInput, replySubmit);
    replyToggleBtn.addEventListener('click', function () {
      const visible = replyInputRow.style.display !== 'none';
      replyInputRow.style.display = visible ? 'none' : 'flex';
      if (!visible) {
        replyInput.focus();
        // 展开后滚动到可见区域
        requestAnimationFrame(function () {
          replyInputRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    });
    replySubmit.addEventListener('click', function () {
      const text = replyInput.value.trim();
      if (!text) return;
      task.replies = task.replies || [];
      task.replies.push({ id: 'r-' + Date.now(), text: text, ts: new Date().toISOString() });
      replyInput.value = '';
      replyInputRow.style.display = 'none';
      S.persistState();
      renderReplies();
    });
    replyInput.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') replySubmit.click();
    });
    replySection.append(replyList, replyToggleBtn, replyInputRow);
    card.append(replySection);

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
        img.style.cursor = 'zoom-in';
        img.title = '点击预览';
        img.addEventListener('click', function () {
          const backdrop = document.createElement('div');
          backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:zoom-out;gap:10px;';
          const bigImg = document.createElement('img');
          bigImg.src = att.dataUrl;
          bigImg.style.cssText = 'max-width:90vw;max-height:85vh;object-fit:contain;border-radius:6px;box-shadow:0 8px 48px rgba(0,0,0,0.6);';
          const label = document.createElement('p');
          label.textContent = att.name;
          label.style.cssText = 'color:rgba(255,255,255,0.6);font-size:0.78rem;margin:0;';
          backdrop.append(bigImg, label);
          backdrop.addEventListener('click', function () { document.body.removeChild(backdrop); });
          document.body.appendChild(backdrop);
        });
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

  // ===== 任务执行：写入 active-task.json 供 AI 读取 =====
  function executeTask(task, ctx) {
    const payload = {
      taskId: task.id,
      taskPath: task.path,
      taskText: task.text,
      done: task.done,
      scope: ctx.scope,
      contextLabel: ctx.label,
      objects: S.state.objects,
      globalTasks: S.state.globalTasks,
      activatedAt: new Date().toISOString(),
    };
    fetch('/api/activate-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (r.ok) {
          setMessage('✓ 任务已激活（active-task.json）：' + (task.text || '').slice(0, 40) + '…', 'info');
        } else {
          setMessage('激活失败：' + (r.error || '未知'), 'error');
        }
      })
      .catch(function (e) {
        setMessage('激活失败（离线模式不支持此功能）：' + e.message, 'error');
      });
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
