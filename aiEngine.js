// aiEngine.js —— 内置 LLM 助手引擎：读取场景+任务，调用 LLM，解析动作并应用到游戏
(function (global) {
  'use strict';

  const LS_APIKEY   = 'wh-ai-apikey';
  const LS_ENDPOINT = 'wh-ai-endpoint';
  const LS_MODEL    = 'wh-ai-model';
  const DEFAULT_EP  = 'https://api.openai.com/v1/chat/completions';
  const DEFAULT_MODEL = 'gpt-4o';

  // ─── 系统提示（English for best LLM performance） ───
  const SYSTEM_PROMPT = `You are the AI engine embedded in WebHachimi, a spatial-prompt 2D game prototyping tool.

The canvas uses a 2D coordinate system: X increases right, Y increases DOWN. Object positions are their top-left corners.

Object schema:
  id (string), type ("square"), name (string), role ("player"|"floor"|"hitbox"|"generic"),
  x (number), y (number), width (number), height (number),
  fill (#hex), stroke (#hex), strokeWidth (0-20), opacity (0-1),
  pivotX (0.5), pivotY (0.5), rotation (degrees),
  tasks ([]), parentId (null), isHitbox (false), lifetime (0), points (null)

Typical layout: main floor at y=40 height=60 (top surface y=40), player spawns around y=-80 height=80.
Stone on floor: stone.y = 40 - stone.height  (bottom of stone = top of floor).

You MUST respond with ONLY valid JSON in this exact format:
{
  "explanation": "中文解释：逐步说明你做了什么以及为什么",
  "actions": [
    {"type":"addObject","object":{...all required fields...}},
    {"type":"modifyObject","id":"shape-X","changes":{"field":value}},
    {"type":"removeObject","id":"shape-X"},
    {"type":"injectCode","name":"hook name","code":"JS code string"},
    {"type":"markTaskDone","taskId":"task-X"},
    {"type":"setParent","id":"shape-X","parentId":"shape-Y"},
    {"type":"removeParent","id":"shape-X"}
  ]
}

For injectCode: code runs in browser window context. Use Game.addUpdateHook(name, fn) to inject per-frame logic.
Sketch notes: stroke coordinates ARE world coordinates. Use bounds and sampled profile for precise placement.
Use markTaskDone to mark the task done after completing it.
Use setParent/removeParent to reorganize the world tree hierarchy: setParent sets a shape's parentId to group it under another shape; removeParent clears parentId making the shape top-level.
Do NOT wrap response in markdown fences — output raw JSON only.`;

  // ─── 内部状态 ───
  let _logs = [];
  let _onLog = null;
  let _running = false;

  function emit(type, text) {
    const entry = { type, text, ts: Date.now() };
    _logs.push(entry);
    if (_onLog) try { _onLog(entry); } catch (e) {}
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function makeLogEl(entry) {
    const div = document.createElement('div');
    div.className = 'ai-log-entry ai-log-' + entry.type;
    const icons = { info: '·', warn: '⚠', error: '✗', think: '…', explain: '💬', action: '→' };
    div.textContent = (icons[entry.type] || '·') + ' ' + entry.text;
    return div;
  }

  // ─── 主模块 ───
  const AIEngine = {
    // Accessors
    getApiKey:   () => localStorage.getItem(LS_APIKEY) || '',
    setApiKey:   (v) => localStorage.setItem(LS_APIKEY, v),
    getEndpoint: () => localStorage.getItem(LS_ENDPOINT) || DEFAULT_EP,
    setEndpoint: (v) => localStorage.setItem(LS_ENDPOINT, v),
    getModel:    () => localStorage.getItem(LS_MODEL) || DEFAULT_MODEL,
    setModel:    (v) => localStorage.setItem(LS_MODEL, v),
    isRunning:   () => _running,
    getLogs:     () => _logs.slice(),
    onLog:       (cb) => { _onLog = cb; },

    init() { /* no-op; DOM work happens in renderPanel */ },

    // ─── 渲染 AI 助手面板 ───
    renderPanel(pane) {
      if (!pane) return;
      const tasks = State.state.globalTasks || [];
      const apiKey = this.getApiKey();
      const ep     = this.getEndpoint();
      const model  = this.getModel();

      pane.innerHTML = '';

      // ── 设置区 ──
      const settingsEl = document.createElement('div');
      settingsEl.className = 'ai-settings';
      settingsEl.innerHTML =
        '<label class="ai-label">OpenAI API Key</label>' +
        '<div class="ai-row">' +
          '<input type="password" id="aiApiKeyInput" class="ai-input" placeholder="sk-..." value="' + escHtml(apiKey) + '">' +
          '<button id="aiKeySaveBtn" class="filter-btn" type="button">保存</button>' +
        '</div>' +
        '<div class="ai-row ai-row-sm">' +
          '<input type="text" id="aiEndpointInput" class="ai-input ai-input-sm" placeholder="' + escHtml(DEFAULT_EP) + '"' +
            ' value="' + (ep !== DEFAULT_EP ? escHtml(ep) : '') + '">' +
          '<input type="text" id="aiModelInput" class="ai-input ai-input-xs" placeholder="' + escHtml(DEFAULT_MODEL) + '"' +
            ' value="' + (model !== DEFAULT_MODEL ? escHtml(model) : '') + '">' +
        '</div>';
      pane.appendChild(settingsEl);

      // ── 任务列表 ──
      const taskSec = document.createElement('div');
      taskSec.className = 'ai-task-section';
      if (!tasks.length) {
        taskSec.innerHTML = '<p class="ai-empty">暂无全局任务。先在"任务"面板添加任务。</p>';
      } else {
        const ul = document.createElement('ul');
        ul.className = 'ai-task-list';
        tasks.forEach(function (task) {
          const li = document.createElement('li');
          li.className = 'ai-task-item' + (task.done ? ' is-done' : '');
          const btnClass = 'ai-run-btn filter-btn' + (_running ? ' is-disabled' : '');
          li.innerHTML =
            '<span class="ai-task-text">' + escHtml(task.path + '. ' + (task.text || '（无说明）')) + '</span>' +
            '<button class="' + btnClass + '" type="button" data-taskid="' + escHtml(task.id) + '">' +
              (_running ? '执行中…' : task.done ? '↺ 重执行' : '▶ AI执行') +
            '</button>';
          ul.appendChild(li);
        });
        taskSec.appendChild(ul);
      }
      pane.appendChild(taskSec);

      // ── 日志区 ──
      const logHeader = document.createElement('div');
      logHeader.className = 'ai-log-header';
      logHeader.innerHTML =
        '<span>AI 解释流</span>' +
        '<button id="aiClearLogBtn" class="filter-btn" type="button">清空</button>';
      pane.appendChild(logHeader);

      const logDiv = document.createElement('div');
      logDiv.id = 'aiLogDiv';
      logDiv.className = 'ai-log';
      _logs.forEach(function (e) { logDiv.appendChild(makeLogEl(e)); });
      logDiv.scrollTop = logDiv.scrollHeight;
      pane.appendChild(logDiv);

      // ── 事件绑定 ──
      const self = this;

      const saveBtn = pane.querySelector('#aiKeySaveBtn');
      if (saveBtn) saveBtn.addEventListener('click', function () {
        const key   = (pane.querySelector('#aiApiKeyInput').value   || '').trim();
        const epVal = (pane.querySelector('#aiEndpointInput').value || '').trim();
        const mdVal = (pane.querySelector('#aiModelInput').value    || '').trim();
        self.setApiKey(key);
        if (epVal) self.setEndpoint(epVal);
        else localStorage.removeItem(LS_ENDPOINT);
        if (mdVal) self.setModel(mdVal);
        else localStorage.removeItem(LS_MODEL);
        emit('info', '设置已保存。');
        self.renderPanel(pane);
      });

      const clearBtn = pane.querySelector('#aiClearLogBtn');
      if (clearBtn) clearBtn.addEventListener('click', function () {
        _logs = [];
        self.renderPanel(pane);
      });

      pane.querySelectorAll('.ai-run-btn').forEach(function (btn) {
        if (btn.classList.contains('is-disabled')) return;
        btn.addEventListener('click', async function () {
          const tid  = btn.dataset.taskid;
          const task = State.state.globalTasks.find(function (t) { return t.id === tid; });
          if (!task) return;
          await self.executeTask(task);
          self.renderPanel(pane);
        });
      });
    },

    // ─── 执行一条任务 ───
    async executeTask(task) {
      if (_running) { emit('warn', '已有任务正在执行，请稍候…'); return; }
      if (!this.getApiKey()) { emit('error', '请先在上方填写 API Key 并保存。'); return; }
      _running = true;
      emit('info', '─── 开始执行：' + task.path + '. ' + (task.text || '（无说明）') + ' ───');
      try {
        // 序列化场景
        let sceneJson = '{}';
        try { sceneJson = JSON.stringify(State.serializeForAI(), null, 2); } catch (e) {}

        // 解码草图附件
        let sketchInfo = '';
        (task.attachments || []).forEach(function (att) {
          if (att.mime === 'application/x-super-sketch+json' && att.dataUrl) {
            try {
              const b64 = att.dataUrl.split(',')[1];
              const sketch = JSON.parse(atob(b64));
              const pts  = (sketch.strokes && sketch.strokes[0] && sketch.strokes[0].points) || [];
              const step = Math.max(1, Math.floor(pts.length / 20));
              const sample = pts.filter(function (_, i) { return i % step === 0; });
              sketchInfo += '\nSketch "' + att.name + '": bounds=' +
                JSON.stringify(sketch.bounds) + ', profile=' + JSON.stringify(sample);
            } catch (e) {}
          }
        });

        const userMsg =
          'Current scene (JSON):\n' + sceneJson +
          '\n\nTask to execute (id=' + task.id + ', path=' + task.path + '):\n' +
          (task.text || '(no text description)') + sketchInfo;

        emit('think', '正在调用 LLM…');
        const rawResp = await this._callLLM(userMsg);
        emit('think', '解析 LLM 响应…');

        let parsed;
        try {
          // Strip markdown fences if present
          const m = rawResp.match(/```(?:json)?\s*([\s\S]*?)```/) || rawResp.match(/(\{[\s\S]*\})/);
          const jsonStr = m ? (m[1] || m[0]).trim() : rawResp.trim();
          parsed = JSON.parse(jsonStr);
        } catch (e) {
          emit('error', '无法解析 JSON 响应：' + rawResp.slice(0, 400));
          return;
        }

        if (parsed.explanation) {
          emit('explain', parsed.explanation);
        }

        if (Array.isArray(parsed.actions) && parsed.actions.length) {
          emit('info', '执行 ' + parsed.actions.length + ' 个操作…');
          this._applyActions(parsed.actions);
        } else {
          emit('info', '模型未返回任何操作。');
        }

        emit('info', '─── 完成 ───');
      } catch (e) {
        emit('error', '执行失败：' + (e.message || String(e)));
      } finally {
        _running = false;
      }
    },

    // ─── 调用 LLM API ───
    async _callLLM(userMsg) {
      const resp = await fetch(this.getEndpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.getApiKey(),
        },
        body: JSON.stringify({
          model: this.getModel(),
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: userMsg },
          ],
          temperature: 0.2,
          max_tokens: 3000,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error('API ' + resp.status + ': ' + errText.slice(0, 300));
      }
      const data = await resp.json();
      return data.choices[0].message.content;
    },

    // ─── 应用动作到场景 ───
    _applyActions(actions) {
      let dirty = false;

      actions.forEach(function (a) {
        try {
          if (a.type === 'addObject') {
            if (!a.object || !a.object.id) { emit('warn', 'addObject 缺少 id，已跳过'); return; }
            // 若 id 已存在则先移除（替换语义）
            State.state.objects = State.state.objects.filter(function (o) { return o.id !== a.object.id; });
            const norm = State.normalizeShape(a.object, State.state.objects.length);
            State.state.objects.push(norm);
            emit('action', '+ 添加 ' + (a.object.name || a.object.id) + '  (' + a.object.x + ', ' + a.object.y + ')');
            dirty = true;

          } else if (a.type === 'modifyObject') {
            const obj = State.state.objects.find(function (o) { return o.id === a.id; });
            if (!obj) { emit('warn', 'modifyObject：找不到 ' + a.id); return; }
            Object.assign(obj, a.changes || {});
            emit('action', '✎ 修改 ' + a.id);
            dirty = true;

          } else if (a.type === 'removeObject') {
            const before = State.state.objects.length;
            State.state.objects = State.state.objects.filter(function (o) { return o.id !== a.id; });
            emit('action', State.state.objects.length < before ? '✕ 删除 ' + a.id : '（找不到 ' + a.id + '）');
            dirty = true;

          } else if (a.type === 'injectCode') {
            // eslint-disable-next-line no-new-func
            new Function('State', 'Game', 'Engine', a.code)(
              global.State, global.Game, global.Engine
            );
            emit('action', '⚡ 注入代码：' + (a.name || '匿名'));

          } else if (a.type === 'markTaskDone') {
            const gt = State.state.globalTasks.find(function (t) { return t.id === a.taskId; });
            if (gt) { gt.done = true; emit('action', '✓ 标记完成：' + a.taskId); dirty = true; }
            else emit('warn', 'markTaskDone：找不到 ' + a.taskId);

          } else if (a.type === 'setParent') {
            const child = State.state.objects.find(function (o) { return o.id === a.id; });
            const parent = State.state.objects.find(function (o) { return o.id === a.parentId; });
            if (!child) { emit('warn', 'setParent：找不到子对象 ' + a.id); return; }
            if (!parent) { emit('warn', 'setParent：找不到父对象 ' + a.parentId); return; }
            if (a.parentId === a.id) { emit('warn', 'setParent：不能把对象设为自身的父级'); return; }
            child.parentId = a.parentId;
            emit('action', '🔗 ' + a.id + ' → 子级：' + a.parentId);
            dirty = true;

          } else if (a.type === 'removeParent') {
            const obj = State.state.objects.find(function (o) { return o.id === a.id; });
            if (!obj) { emit('warn', 'removeParent：找不到 ' + a.id); return; }
            obj.parentId = null;
            emit('action', '⬆ ' + a.id + ' 提升至顶层');
            dirty = true;

          } else {
            emit('warn', '未知动作类型：' + a.type);
          }
        } catch (e) {
          emit('error', '动作 ' + a.type + ' 出错：' + e.message);
        }
      });

      if (dirty) {
        // 修正 nextId
        const maxNum = State.state.objects.reduce(function (m, o) {
          const d = (o.id || '').replace(/[^0-9]/g, '');
          const n = d ? parseInt(d, 10) : 0;
          return Math.max(m, isNaN(n) ? 0 : n);
        }, 0);
        if (maxNum >= State.state.nextId) State.state.nextId = maxNum + 1;

        State.captureBaseline();
        State.persistState();            // 也会触发 ServerSync（通过 onPersisted 钩子）
        if (global.Editor  && global.Editor.render)    global.Editor.render();
        if (global.WorldTree && global.WorldTree.render) global.WorldTree.render();
        if (global.TaskManager && global.TaskManager.render) global.TaskManager.render();
      }
    },
  };

  global.AIEngine = AIEngine;
})(window);
