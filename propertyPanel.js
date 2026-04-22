// propertyPanel.js —— 抽屉左侧的属性表单 + 实体列表 + 面包屑
(function (global) {
  'use strict';
  const S = global.State;
  const C = S.constants;

  let dom;
  let setMessage;
  let requestRender;

  function init(deps) {
    dom = deps.dom;
    setMessage = deps.setMessage;
    requestRender = deps.requestRender;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buildEntityListItem(obj, depth) {
    const li = document.createElement('li');
    li.className = 'entity-item'
      + (obj.id === S.state.selectedId ? ' selected' : '')
      + (obj.isHitbox ? ' hitbox' : '');
    li.style.paddingLeft = (depth * 12) + 'px';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'entity-btn';
    btn.innerHTML = '<span class="entity-name">' + escapeHtml(obj.name) + '</span>'
      + '<span class="entity-meta">' + (C.SHAPE_TYPE_LABELS[obj.type] || obj.type)
      + ' · ' + Math.round(obj.width) + '×' + Math.round(obj.height) + '</span>';
    btn.addEventListener('click', function () {
      S.state.selectedId = obj.id;
      requestRender();
    });
    li.appendChild(btn);
    return li;
  }

  function bindPropertyInputs(refs) {
    refs.nameInput.addEventListener('input', function (e) {
      const sel = S.getSelectedObject();
      if (!sel) return;
      sel.name = e.target.value.trim() || '未命名对象';
      // 高频输入：只持久化，baseline 由 pointerup / 模式切换回收
      const pill = dom.world.querySelector('[data-id="' + sel.id + '"] .shape-name-pill');
      if (pill) pill.textContent = sel.name;
      S.persistState();
    });
    refs.widthInput.addEventListener('input', function (e) {
      updateSelected({ width: Number(e.target.value) || C.MIN_SHAPE_SIZE });
    });
    refs.heightInput.addEventListener('input', function (e) {
      updateSelected({ height: Number(e.target.value) || C.MIN_SHAPE_SIZE });
    });
    refs.xInput.addEventListener('input', function (e) {
      updateSelected({ x: Number(e.target.value) || 0 });
    });
    refs.yInput.addEventListener('input', function (e) {
      updateSelected({ y: Number(e.target.value) || 0 });
    });
    refs.rotationInput.addEventListener('input', function (e) {
      updateSelected({ rotation: S.normalizeRotation(Number(e.target.value) || 0) });
    });
    refs.fillInput.addEventListener('input', function (e) {
      updateSelected({ fill: e.target.value });
    });
    refs.strokeInput.addEventListener('input', function (e) {
      updateSelected({ stroke: e.target.value });
    });
    refs.strokeWidthInput.addEventListener('input', function (e) {
      const v = Number(e.target.value);
      updateSelected({ strokeWidth: Number.isFinite(v) ? Math.max(0, Math.min(20, v)) : 1 });
    });
    refs.opacityInput.addEventListener('input', function (e) {
      const v = Number(e.target.value);
      updateSelected({ opacity: Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1 });
    });
  }

  function updateSelected(patch) {
    const sel = S.getSelectedObject();
    if (!sel) return;
    Object.assign(sel, patch);
    S.ensureObjectInStage(sel);
    S.captureBaseline();
    requestRender();
  }

  function render() {
    dom.propsBody.innerHTML = '';
    const sel = S.getSelectedObject();

    if (!sel) {
      const note = document.createElement('p');
      note.className = 'subtle-text props-empty';
      note.textContent = '没有选中对象。下面是当前画板上的全部实体，可以点击选中：';
      dom.propsBody.appendChild(note);
      const list = document.createElement('ul');
      list.className = 'entity-list';
      S.state.objects.filter(function (o) { return !o.parentId; })
        .forEach(function (o) { list.appendChild(buildEntityListItem(o, 0)); });
      if (!list.children.length) {
        const empty = document.createElement('div');
        empty.className = 'task-empty';
        empty.textContent = '还没有任何对象。在左侧工具栏点一下形状即可创建。';
        dom.propsBody.appendChild(empty);
      } else {
        dom.propsBody.appendChild(list);
      }
      return;
    }

    const parent = sel.parentId ? S.getObjectById(sel.parentId) : null;
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'entity-breadcrumb';
    if (parent) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'inline-mini-button';
      back.textContent = '↑ ' + parent.name;
      back.title = '回到父级';
      back.addEventListener('click', function () {
        S.state.selectedId = parent.id;
        requestRender();
      });
      breadcrumb.appendChild(back);
    }
    const here = document.createElement('strong');
    here.className = 'entity-current';
    here.textContent = sel.name;
    breadcrumb.appendChild(here);
    dom.propsBody.appendChild(breadcrumb);

    const form = document.createElement('div');
    form.className = 'props-form';
    form.innerHTML =
      '<label class="field"><span>名称</span><input id="nameInput" type="text" maxlength="40" /></label>' +
      '<label class="field"><span>填充色</span><input id="fillInput" type="color" /></label>' +
      '<label class="field"><span>描边色</span><input id="strokeInput" type="color" /></label>' +
      '<label class="field"><span>描边</span><input id="strokeWidthInput" type="number" min="0" max="20" step="1" /></label>' +
      '<label class="field"><span>不透明度</span><input id="opacityInput" type="number" min="0" max="1" step="0.05" /></label>' +
      '<label class="field"><span>X</span><input id="xInput" type="number" step="1" /></label>' +
      '<label class="field"><span>Y</span><input id="yInput" type="number" step="1" /></label>' +
      '<label class="field"><span>宽</span><input id="widthInput" type="number" min="40" step="1" /></label>' +
      '<label class="field"><span>高</span><input id="heightInput" type="number" min="40" step="1" /></label>' +
      '<label class="field"><span>旋转°</span><input id="rotationInput" type="number" step="1" /></label>';
    dom.propsBody.appendChild(form);

    const saveBar = document.createElement('div');
    saveBar.className = 'props-save-bar';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'inline-mini-button';
    saveBtn.textContent = '💾 保存属性';
    saveBtn.addEventListener('click', function () {
      const cur = S.getSelectedObject();
      if (!cur) return;
      S.ensureObjectInStage(cur);
      S.captureBaseline();
      S.persistState();
      setMessage('已保存「' + cur.name + '」的属性。');
    });
    saveBar.appendChild(saveBtn);
    dom.propsBody.appendChild(saveBar);

    const refs = {
      nameInput: form.querySelector('#nameInput'),
      fillInput: form.querySelector('#fillInput'),
      strokeInput: form.querySelector('#strokeInput'),
      strokeWidthInput: form.querySelector('#strokeWidthInput'),
      opacityInput: form.querySelector('#opacityInput'),
      xInput: form.querySelector('#xInput'),
      yInput: form.querySelector('#yInput'),
      widthInput: form.querySelector('#widthInput'),
      heightInput: form.querySelector('#heightInput'),
      rotationInput: form.querySelector('#rotationInput'),
    };
    refs.nameInput.value = sel.name;
    refs.fillInput.value = (typeof sel.fill === 'string' && /^#[0-9a-fA-F]{6}$/.test(sel.fill)) ? sel.fill : '#9ca3af';
    refs.strokeInput.value = (typeof sel.stroke === 'string' && /^#[0-9a-fA-F]{6}$/.test(sel.stroke)) ? sel.stroke : '#1f2937';
    refs.strokeWidthInput.value = String(Number.isFinite(sel.strokeWidth) ? sel.strokeWidth : 1);
    refs.opacityInput.value = String(Number.isFinite(sel.opacity) ? sel.opacity : 1);
    refs.xInput.value = String(Math.round(sel.x));
    refs.yInput.value = String(Math.round(sel.y));
    refs.widthInput.value = String(Math.round(S.getShapeWidth(sel)));
    refs.heightInput.value = String(Math.round(S.getShapeHeight(sel)));
    refs.rotationInput.value = String(Math.round(sel.rotation || 0));
    bindPropertyInputs(refs);

    const children = S.getChildren(sel.id);
    const childHeader = document.createElement('div');
    childHeader.className = 'entity-section-head';
    childHeader.textContent = '子实体（' + children.length + '）';
    dom.propsBody.appendChild(childHeader);
    if (!children.length) {
      const empty = document.createElement('div');
      empty.className = 'task-empty subtle';
      empty.textContent = '没有子实体。游戏中由它产生的判定框、特效会成为它的子实体。';
      dom.propsBody.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'entity-list';
      children.forEach(function (c) { list.appendChild(buildEntityListItem(c, 1)); });
      dom.propsBody.appendChild(list);
    }
  }

  global.PropertyPanel = {
    init: init,
    render: render,
    escapeHtml: escapeHtml,
  };
})(window);
