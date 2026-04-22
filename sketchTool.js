// sketchTool.js —— 超智能画笔（包工头比划工具）
// 核心理念：用户在画布上自由勾画一段「大致规划」（不是永久几何对象），
// 然后强制写一段任务说明，与笔迹一起作为附件交给 AI。
// 笔迹是临时的、规划性的，不进入 state.objects；只作为新建 globalTask 的附件存在。
(function (global) {
  'use strict';
  const S = global.State;
  const E = global.Engine;

  let dom;
  let setMessage;
  let requestRender;
  let active = false;
  let strokes = [];          // [{points:[{x,y},...]}] 世界坐标
  let currentStroke = null;
  let svgEl = null;          // overlay svg
  let pathLayer = null;      // svg <g>
  let toolbarEl = null;      // 顶部小工具条（撤销 / 提交 / 取消）
  let modalEl = null;        // 提交浮窗

  function init(refs, opts) {
    dom = refs;
    setMessage = opts.setMessage || function () {};
    requestRender = opts.requestRender || function () {};
  }

  function isActive() { return active; }

  function toggle() { active ? cancel() : enter(); }

  function enter() {
    if (!S.state.editMode) {
      setMessage('超画笔只能在编辑模式使用。先按 Z 暂停。', 'error');
      return;
    }
    active = true;
    strokes = [];
    currentStroke = null;
    buildOverlay();
    document.body.classList.add('sketch-active');
    if (dom && dom.superSketchBtn) dom.superSketchBtn.classList.add('active');
    setMessage('超画笔：在画布上随便比划，画完点「📝 提交规划」写说明给 AI。');
  }

  function cancel() {
    active = false;
    strokes = [];
    currentStroke = null;
    teardownOverlay();
    teardownModal();
    document.body.classList.remove('sketch-active');
    if (dom && dom.superSketchBtn) dom.superSketchBtn.classList.remove('active');
  }

  // ===== overlay: 一层贴在 stage 上的 SVG，pointerdown 由它接管 =====
  function buildOverlay() {
    if (svgEl) return;
    const stage = dom.stage;
    svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.classList.add('sketch-overlay');
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    pathLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svgEl.appendChild(pathLayer);
    stage.appendChild(svgEl);
    sizeOverlay();

    svgEl.addEventListener('pointerdown', onPointerDown);
    svgEl.addEventListener('pointermove', onPointerMove);
    svgEl.addEventListener('pointerup', onPointerUp);
    svgEl.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', sizeOverlay);

    // 顶部小工具条
    toolbarEl = document.createElement('div');
    toolbarEl.className = 'sketch-toolbar';
    toolbarEl.innerHTML = ''
      + '<span class="sketch-tool-title">🖌 超画笔</span>'
      + '<button type="button" data-act="undo">↶ 撤销一笔</button>'
      + '<button type="button" data-act="clear">🗑 清空</button>'
      + '<button type="button" data-act="submit" class="primary">📝 提交规划</button>'
      + '<button type="button" data-act="cancel">取消</button>';
    toolbarEl.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'undo')   { strokes.pop(); redraw(); }
      else if (act === 'clear')  { strokes = []; redraw(); }
      else if (act === 'submit') { onSubmitClick(); }
      else if (act === 'cancel') { cancel(); }
    });
    stage.appendChild(toolbarEl);
  }

  function teardownOverlay() {
    if (svgEl && svgEl.parentNode) svgEl.parentNode.removeChild(svgEl);
    if (toolbarEl && toolbarEl.parentNode) toolbarEl.parentNode.removeChild(toolbarEl);
    svgEl = null; pathLayer = null; toolbarEl = null;
    window.removeEventListener('resize', sizeOverlay);
  }

  function sizeOverlay() {
    if (!svgEl) return;
    const rect = E.getStageRect();
    svgEl.setAttribute('width', String(rect.width));
    svgEl.setAttribute('height', String(rect.height));
    svgEl.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height);
  }

  // ===== 绘制 =====
  function onPointerDown(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    svgEl.setPointerCapture(e.pointerId);
    const w = E.screenToWorld(e.clientX, e.clientY);
    currentStroke = { points: [w] };
    strokes.push(currentStroke);
    redraw();
  }

  function onPointerMove(e) {
    if (!active || !currentStroke) return;
    const w = E.screenToWorld(e.clientX, e.clientY);
    const last = currentStroke.points[currentStroke.points.length - 1];
    // 抽稀：距离 < 2 像素就跳过（按世界坐标差也行）
    if (last && Math.hypot(w.x - last.x, w.y - last.y) < 2 / S.state.view.scale) return;
    currentStroke.points.push(w);
    redraw();
  }

  function onPointerUp(e) {
    if (!active) return;
    if (svgEl.hasPointerCapture(e.pointerId)) svgEl.releasePointerCapture(e.pointerId);
    currentStroke = null;
  }

  // ===== 绘制：把世界坐标的 strokes 实时投到 svg 屏幕坐标 =====
  function redraw() {
    if (!pathLayer) return;
    pathLayer.innerHTML = '';
    const rect = E.getStageRect();
    const v = S.state.view;
    strokes.forEach(function (s) {
      if (!s.points.length) return;
      let d = '';
      s.points.forEach(function (p, i) {
        const sx = p.x * v.scale + v.x;
        const sy = p.y * v.scale + v.y;
        d += (i === 0 ? 'M' : 'L') + sx.toFixed(1) + ' ' + sy.toFixed(1) + ' ';
      });
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d.trim());
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#f59e0b');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('opacity', '0.85');
      pathLayer.appendChild(path);
    });
    // 当前未完成笔触末端的小圆点（提示）
    void rect;
  }

  // ===== 提交：弹浮窗强制写说明 =====
  function onSubmitClick() {
    const totalPts = strokes.reduce(function (a, s) { return a + s.points.length; }, 0);
    if (!strokes.length || totalPts < 2) {
      setMessage('还没画呢，先在画布上随便比划几笔。', 'error');
      return;
    }
    openModal();
  }

  function openModal() {
    teardownModal();
    modalEl = document.createElement('div');
    modalEl.className = 'sketch-modal-backdrop';
    modalEl.innerHTML = ''
      + '<div class="sketch-modal">'
      +   '<h3>📝 给 AI 写一段说明</h3>'
      +   '<p class="sketch-modal-hint">这一笔规划是临时的，提交后会作为附件挂在新建的全局任务上交给 AI。'
      +   ' 比如：<em>把所有正方形排在这条心形路径上</em> · <em>这个区域大致做成背包面板</em>。</p>'
      +   '<textarea placeholder="说明你画的东西希望 AI 怎么处理…" rows="4"></textarea>'
      +   '<div class="sketch-modal-actions">'
      +     '<button type="button" data-act="cancel">取消</button>'
      +     '<button type="button" data-act="confirm" class="primary">提交给 AI</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(modalEl);
    const ta = modalEl.querySelector('textarea');
    setTimeout(function () { ta.focus(); }, 0);
    modalEl.addEventListener('click', function (e) {
      if (e.target === modalEl) { /* 点遮罩不关，强制写说明 */ return; }
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.getAttribute('data-act') === 'cancel') { teardownModal(); return; }
      if (btn.getAttribute('data-act') === 'confirm') {
        const text = (ta.value || '').trim();
        if (!text) {
          ta.focus();
          ta.classList.add('shake');
          setTimeout(function () { ta.classList.remove('shake'); }, 400);
          return;
        }
        commitSketchTask(text);
      }
    });
  }

  function teardownModal() {
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    modalEl = null;
  }

  // ===== 提交：构建 sketch 附件 + 新建 globalTask =====
  function commitSketchTask(text) {
    S.recordUndo('提交超画笔规划');
    const bounds = computeBounds(strokes);
    const svgString = buildStandaloneSvg(strokes, bounds);
    const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString);
    const sketchPayload = {
      kind: 'super-sketch',
      bounds: bounds,
      strokes: strokes.map(function (s) {
        return { points: s.points.map(function (p) { return { x: Math.round(p.x), y: Math.round(p.y) }; }) };
      }),
    };

    const path = String(S.state.globalTasks.length + 1);
    const task = {
      id: S.generateTaskId(),
      path: path,
      text: text,
      done: false,
      attachments: [
        {
          id: 'sketch-' + Date.now(),
          name: '超画笔规划-' + path + '.svg',
          mime: 'image/svg+xml',
          size: svgString.length,
          dataUrl: dataUrl,
        },
        {
          id: 'sketch-meta-' + Date.now(),
          name: '超画笔结构-' + path + '.json',
          mime: 'application/x-super-sketch+json',
          size: JSON.stringify(sketchPayload).length,
          dataUrl: 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(JSON.stringify(sketchPayload)))),
        },
      ],
    };
    S.state.globalTasks.push(task);
    S.state.ui.pendingTaskFocus = task.id;
    try { S.captureBaseline(); S.persistState(); } catch (err) {}
    setMessage('已提交超画笔规划：任务 ' + path + ' 已创建并附上笔迹。', 'info');
    cancel();
    requestRender();
  }

  function computeBounds(strokes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    strokes.forEach(function (s) {
      s.points.forEach(function (p) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
    });
    if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
  }

  function buildStandaloneSvg(strokes, b) {
    const pad = 16;
    const w = Math.max(1, b.w + pad * 2);
    const h = Math.max(1, b.h + pad * 2);
    let paths = '';
    strokes.forEach(function (s) {
      let d = '';
      s.points.forEach(function (p, i) {
        const x = (p.x - b.x) + pad;
        const y = (p.y - b.y) + pad;
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      });
      paths += '<path d="' + d.trim() + '" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>';
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">'
         + '<rect width="100%" height="100%" fill="#0b1220"/>'
         + paths
         + '</svg>';
  }

  global.SketchTool = {
    init: init,
    toggle: toggle,
    isActive: isActive,
    cancel: cancel,
  };
})(window);
