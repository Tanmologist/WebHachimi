// worldTree.js —— 世界树：展示场景中所有对象的层级列表，支持点击选中
(function (global) {
  'use strict';
  const S = global.State;

  const SHAPE_ICONS = {
    square: '□',
    circle: '○',
    triangle: '△',
    pen: '✒',
    brush: '🖊',
  };
  const ROLE_LABELS = {
    player: '主角',
    floor: '地面',
    enemy: '敌人',
    hitbox: '判定框',
    generic: '',
  };

  let dom;
  let requestRender;

  function init(refs, opts) {
    dom = refs;
    requestRender = opts.requestRender;
  }

  function render() {
    const list = dom.worldTreeList;
    if (!list) return;

    const objects = S.state.objects || [];
    const selectedId = S.state.selectedId;

    // 仅当内容发生变化时重建，避免闪烁
    const key = objects.map(function (o) {
      return o.id + ':' + o.name + ':' + (o.id === selectedId ? '1' : '0');
    }).join('|');
    if (list.dataset.renderKey === key) return;
    list.dataset.renderKey = key;

    list.innerHTML = '';

    if (!objects.length) {
      const empty = document.createElement('div');
      empty.className = 'world-tree-empty';
      empty.textContent = '场景中还没有对象。切换到编辑模式并点击左侧工具栏创建图形。';
      list.appendChild(empty);
      return;
    }

    // 按 parentId 分组
    const roots = objects.filter(function (o) { return !o.parentId; });
    const childMap = {};
    objects.forEach(function (o) {
      if (o.parentId) {
        if (!childMap[o.parentId]) childMap[o.parentId] = [];
        childMap[o.parentId].push(o);
      }
    });

    function buildItem(obj, depth) {
      const item = document.createElement('div');
      item.className = 'world-tree-item' + (obj.id === selectedId ? ' is-selected' : '');
      item.dataset.id = obj.id;
      item.style.paddingLeft = (8 + depth * 16) + 'px';
      item.title = obj.name + ' — ' + (obj.type || '') + (obj.role && obj.role !== 'generic' ? ' · ' + (ROLE_LABELS[obj.role] || obj.role) : '');

      const icon = document.createElement('span');
      icon.className = 'world-tree-icon';
      icon.textContent = SHAPE_ICONS[obj.type] || '◇';

      const name = document.createElement('span');
      name.className = 'world-tree-name';
      name.textContent = obj.name;

      const meta = document.createElement('span');
      meta.className = 'world-tree-meta';
      meta.textContent = obj.type || '';

      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(meta);

      if (obj.role && obj.role !== 'generic') {
        const role = document.createElement('span');
        role.className = 'world-tree-role';
        role.textContent = ROLE_LABELS[obj.role] || obj.role;
        item.appendChild(role);
      }

      item.addEventListener('click', function (e) {
        e.stopPropagation();
        S.state.selectedId = (S.state.selectedId === obj.id) ? null : obj.id;
        requestRender();
      });

      list.appendChild(item);

      // 递归渲染子对象
      const children = childMap[obj.id] || [];
      children.forEach(function (child) { buildItem(child, depth + 1); });
    }

    roots.forEach(function (obj) { buildItem(obj, 0); });
  }

  global.WorldTree = {
    init: init,
    render: render,
  };
})(window);
