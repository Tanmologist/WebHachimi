// worldTree.js -- 世界树：VS Code 风格文件夹+列表，支持折叠/展开、多选高亮
(function (global) {
  'use strict';
  const S = global.State;

  const SHAPE_ICONS = { square: '\u25a1', circle: '\u25cb', triangle: '\u25b3', pen: '\u2712', brush: '\uD83D\uDD8A' };
  const ROLE_LABELS = { player: '主角', floor: '地面', enemy: '敌人', hitbox: '判定框', generic: '通用' };
  // 虚拟角色文件夹的排序优先级
  const ROLE_ORDER = ['player', 'enemy', 'hitbox', 'floor', 'generic'];

  let dom;
  let requestRender;
  // 折叠状态：key = parentId 或 "role:xxx"
  const collapsed = {};

  function init(refs, opts) {
    dom = refs;
    requestRender = opts.requestRender;
  }

  function render() {
    const list = dom.worldTreeList;
    if (!list) return;

    const objects = S.state.objects || [];
    const selectedId = S.state.selectedId;
    const selectedIds = S.state.selectedIds || new Set();

    // 缓存 key（含多选状态）
    const key = objects.map(function (o) {
      const sel = selectedIds.has(o.id) ? '2' : (o.id === selectedId ? '1' : '0');
      return o.id + ':' + o.name + ':' + sel + ':' + (o.parentId || '') + ':' + (collapsed[o.id] ? 'c' : 'e');
    }).join('|') + JSON.stringify(Object.keys(collapsed));
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

    // 构建子对象映射（基于 parentId）
    const childMap = {};
    objects.forEach(function (o) {
      if (o.parentId) {
        if (!childMap[o.parentId]) childMap[o.parentId] = [];
        childMap[o.parentId].push(o);
      }
    });
    // 真正的根对象（无 parentId）
    const roots = objects.filter(function (o) { return !o.parentId; });

    // 判断是否有任何显式 parentId 层级
    const hasExplicitHierarchy = objects.some(function (o) { return !!o.parentId; });

    // 递归构建一行
    function buildItem(obj, depth) {
      const children = childMap[obj.id] || [];
      const hasChildren = children.length > 0;
      const isFolderCollapsed = hasChildren && collapsed[obj.id];
      const isSelected = selectedIds.has(obj.id) || obj.id === selectedId;
      const isPrimary  = obj.id === selectedId;

      const row = document.createElement('div');
      row.className = 'wt-row'
        + (isSelected ? (isPrimary ? ' wt-primary' : ' wt-selected') : '')
        + (obj.isHitbox ? ' wt-hitbox' : '');
      row.dataset.id = obj.id;
      row.style.paddingLeft = (4 + depth * 16) + 'px';
      const roleLabel = obj.role && obj.role !== 'generic' ? ' \u00b7 ' + (ROLE_LABELS[obj.role] || obj.role) : '';
      row.title = obj.name + ' (' + (obj.type || '') + roleLabel + ')';

      // 折叠箭头
      const arrow = document.createElement('span');
      arrow.className = 'wt-arrow';
      if (hasChildren) {
        arrow.textContent = isFolderCollapsed ? '\u25b6' : '\u25bc';
        arrow.addEventListener('click', function (e) {
          e.stopPropagation();
          collapsed[obj.id] = !collapsed[obj.id];
          list.dataset.renderKey = '';
          render();
        });
      } else {
        arrow.textContent = '';
      }

      // 图标
      const icon = document.createElement('span');
      icon.className = 'wt-icon';
      icon.textContent = hasChildren
        ? (isFolderCollapsed ? '\uD83D\uDCC1' : '\uD83D\uDCC2')
        : (SHAPE_ICONS[obj.type] || '\u25c7');

      // 名称
      const name = document.createElement('span');
      name.className = 'wt-name';
      name.textContent = obj.name;

      // Role 徽章（虚拟分组模式下不重复显示）
      if (!hasExplicitHierarchy && obj.role && obj.role !== 'generic') {
        row.append(arrow, icon, name);
      } else if (obj.role && obj.role !== 'generic') {
        const badge = document.createElement('span');
        badge.className = 'wt-badge';
        badge.textContent = ROLE_LABELS[obj.role] || obj.role;
        row.append(arrow, icon, name, badge);
      } else {
        row.append(arrow, icon, name);
      }

      row.addEventListener('click', function (e) {
        e.stopPropagation();
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          S.toggleSelection(obj.id);
        } else {
          S.setSelection(obj.id);
        }
        requestRender();
      });

      list.appendChild(row);

      if (hasChildren && !isFolderCollapsed) {
        children.forEach(function (child) { buildItem(child, depth + 1); });
      }
    }

    if (hasExplicitHierarchy) {
      // 有显式层级时，直接渲染 parentId 树
      roots.forEach(function (obj) { buildItem(obj, 0); });
    } else {
      // 无层级时，按 role 虚拟分组，显示文件夹
      const roleGroups = {};
      roots.forEach(function (obj) {
        const role = obj.role || 'generic';
        if (!roleGroups[role]) roleGroups[role] = [];
        roleGroups[role].push(obj);
      });

      const roleKeys = Object.keys(roleGroups).sort(function (a, b) {
        const ai = ROLE_ORDER.indexOf(a), bi = ROLE_ORDER.indexOf(b);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });

      roleKeys.forEach(function (role) {
        const group = roleGroups[role];
        const folderKey = 'role:' + role;
        const isFolderCollapsed = collapsed[folderKey];

        // 文件夹行
        const folderRow = document.createElement('div');
        folderRow.className = 'wt-row wt-folder';
        folderRow.style.paddingLeft = '4px';

        const fArrow = document.createElement('span');
        fArrow.className = 'wt-arrow';
        fArrow.textContent = isFolderCollapsed ? '\u25b6' : '\u25bc';
        fArrow.addEventListener('click', function (e) {
          e.stopPropagation();
          collapsed[folderKey] = !collapsed[folderKey];
          list.dataset.renderKey = '';
          render();
        });

        const fIcon = document.createElement('span');
        fIcon.className = 'wt-icon';
        fIcon.textContent = isFolderCollapsed ? '\uD83D\uDCC1' : '\uD83D\uDCC2';

        const fName = document.createElement('span');
        fName.className = 'wt-name wt-folder-name';
        fName.textContent = ROLE_LABELS[role] || role;

        const fCount = document.createElement('span');
        fCount.className = 'wt-badge';
        fCount.textContent = group.length + ' \u4e2a';

        folderRow.append(fArrow, fIcon, fName, fCount);
        folderRow.addEventListener('click', function (e) {
          e.stopPropagation();
          collapsed[folderKey] = !collapsed[folderKey];
          list.dataset.renderKey = '';
          render();
        });
        list.appendChild(folderRow);

        if (!isFolderCollapsed) {
          group.forEach(function (obj) { buildItem(obj, 1); });
        }
      });
    }
  }

  global.WorldTree = {
    init: init,
    render: render,
  };
})(window);
