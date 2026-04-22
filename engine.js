// engine.js —— 数学/坐标/视口/舞台渲染（不含交互）
(function (global) {
  'use strict';
  const S = global.State;
  const C = S.constants;
  const clamp = S.clamp;
  const getShapeWidth = S.getShapeWidth;
  const getShapeHeight = S.getShapeHeight;
  const getShapePivotX = S.getShapePivotX;
  const getShapePivotY = S.getShapePivotY;

  let stage, world, zoomBadge;

  function bindDom(refs) {
    stage = refs.stage;
    world = refs.world;
    zoomBadge = refs.zoomBadge;
  }

  function getObjectCenter(shape) {
    const w = getShapeWidth(shape);
    const h = getShapeHeight(shape);
    return { x: shape.x + w * getShapePivotX(shape), y: shape.y + h * getShapePivotY(shape) };
  }

  function getAngleBetween(center, point) {
    return Math.atan2(point.y - center.y, point.x - center.x) * (180 / Math.PI);
  }

  function worldToLocal(point, center, rotation) {
    const radians = (-rotation * Math.PI) / 180;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: dx * Math.cos(radians) - dy * Math.sin(radians),
      y: dx * Math.sin(radians) + dy * Math.cos(radians),
    };
  }

  function worldToBoxLocal(point, shape) {
    const center = getObjectCenter(shape);
    const local = worldToLocal(point, center, shape.rotation || 0);
    return {
      x: local.x + getShapeWidth(shape) * getShapePivotX(shape),
      y: local.y + getShapeHeight(shape) * getShapePivotY(shape),
    };
  }

  function rotateVector(x, y, rotation) {
    const radians = (rotation * Math.PI) / 180;
    return {
      x: x * Math.cos(radians) - y * Math.sin(radians),
      y: x * Math.sin(radians) + y * Math.cos(radians),
    };
  }

  function snapSize(size) {
    const snapped = Math.round(size / C.SIZE_SNAP_STEP) * C.SIZE_SNAP_STEP;
    return clamp(snapped, C.MIN_SHAPE_SIZE, C.MAX_SHAPE_SIZE);
  }

  function snapRotation(angle) {
    const snapped = Math.round(angle / C.ROTATION_SNAP_STEP) * C.ROTATION_SNAP_STEP;
    return Math.abs(snapped - angle) <= C.ROTATION_SNAP_THRESHOLD ? snapped : angle;
  }

  function getAxisSnapPoints(start, size) {
    return [start, start + size / 2, start + size];
  }

  function snapMove(target, nextX, nextY) {
    let snappedX = nextX;
    let snappedY = nextY;
    let bestXDiff = null;
    let bestYDiff = null;
    const targetXPoints = getAxisSnapPoints(nextX, getShapeWidth(target));
    const targetYPoints = getAxisSnapPoints(nextY, getShapeHeight(target));

    S.state.objects.forEach(function (shape) {
      if (shape.id === target.id) return;
      const otherXPoints = getAxisSnapPoints(shape.x, getShapeWidth(shape));
      const otherYPoints = getAxisSnapPoints(shape.y, getShapeHeight(shape));
      targetXPoints.forEach(function (p) {
        otherXPoints.forEach(function (op) {
          const diff = op - p;
          if (Math.abs(diff) <= C.SNAP_THRESHOLD && (bestXDiff === null || Math.abs(diff) < Math.abs(bestXDiff))) {
            bestXDiff = diff;
          }
        });
      });
      targetYPoints.forEach(function (p) {
        otherYPoints.forEach(function (op) {
          const diff = op - p;
          if (Math.abs(diff) <= C.SNAP_THRESHOLD && (bestYDiff === null || Math.abs(diff) < Math.abs(bestYDiff))) {
            bestYDiff = diff;
          }
        });
      });
    });

    if (bestXDiff !== null) snappedX = nextX + bestXDiff;
    if (bestYDiff !== null) snappedY = nextY + bestYDiff;
    return { x: Math.round(snappedX), y: Math.round(snappedY) };
  }

  function getStageRect() { return stage.getBoundingClientRect(); }

  function screenToWorld(clientX, clientY) {
    const rect = getStageRect();
    return {
      x: (clientX - rect.left - S.state.view.x) / S.state.view.scale,
      y: (clientY - rect.top - S.state.view.y) / S.state.view.scale,
    };
  }

  function getViewportCenterWorld() {
    const rect = getStageRect();
    return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function formatZoomPercent(scale) {
    const percent = scale * 100;
    if (percent >= 10) return Math.round(percent) + '%';
    if (percent >= 1) return percent.toFixed(1).replace(/\.0$/, '') + '%';
    return percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + '%';
  }

  function applyViewportTransform() {
    if (!world) return;
    world.style.transform = 'translate(' + S.state.view.x + 'px, ' + S.state.view.y + 'px) scale(' + S.state.view.scale + ')';
    if (zoomBadge) zoomBadge.textContent = formatZoomPercent(S.state.view.scale);
  }

  function getShapeStyle(shape) {
    return {
      background: shape.fill || '#9ca3af',
      borderStyle: 'solid',
      borderColor: shape.stroke || '#1f2937',
      borderWidth: (Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 1) + 'px',
      opacity: String(Number.isFinite(shape.opacity) ? shape.opacity : 1),
    };
  }

  function renderStage(handlers) {
    if (!world) return;
    world.innerHTML = '';
    S.state.objects.forEach(function (shape) {
      const width = getShapeWidth(shape);
      const height = getShapeHeight(shape);
      const pivotX = getShapePivotX(shape);
      const pivotY = getShapePivotY(shape);
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'shape-node';
      if (shape.id === S.state.selectedId && S.state.editMode) node.classList.add('selected');
      if (shape.isHitbox) node.classList.add('is-hitbox');
      if (shape.parentId) node.classList.add('is-child');

      node.dataset.id = shape.id;
      node.style.left = shape.x + 'px';
      node.style.top = shape.y + 'px';
      node.style.width = width + 'px';
      node.style.height = height + 'px';
      node.style.transform = 'rotate(' + (shape.rotation || 0) + 'deg)';
      node.style.transformOrigin = (pivotX * 100) + '% ' + (pivotY * 100) + '%';
      node.style.setProperty('--pivot-x', (pivotX * 100) + '%');
      node.style.setProperty('--pivot-y', (pivotY * 100) + '%');

      // 形状几何：圆形用 50%，三角形用 clip-path，其它一律方形（无圆角）
      if (shape.type === 'circle') {
        node.style.borderRadius = '50%';
      } else if (shape.type === 'triangle') {
        node.style.clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
        node.style.borderRadius = '0';
      } else {
        node.style.borderRadius = '0';
      }

      Object.assign(node.style, getShapeStyle(shape));

      const label = document.createElement('span');
      label.className = 'shape-name-pill';
      label.textContent = shape.name;
      node.append(label);

      node.addEventListener('click', function (event) {
        event.stopPropagation();
        handlers.onClick && handlers.onClick(shape, event);
      });
      node.addEventListener('contextmenu', function (event) {
        if (!S.state.editMode) return;
        event.preventDefault();
        event.stopPropagation();
        handlers.onContextMenu && handlers.onContextMenu(shape, event);
      });
      node.addEventListener('pointerdown', function (event) {
        if (!S.state.editMode || event.button !== 0) return;
        handlers.onPointerDown && handlers.onPointerDown(shape, event, node);
      });

      if (shape.id === S.state.selectedId && S.state.editMode) {
        const rotateGuide = document.createElement('span');
        rotateGuide.className = 'transform-guide';
        const rotateHandle = document.createElement('span');
        rotateHandle.className = 'transform-handle rotate-handle';
        rotateHandle.addEventListener('click', function (e) { e.stopPropagation(); });
        rotateHandle.addEventListener('pointerdown', function (event) {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          handlers.onRotateStart && handlers.onRotateStart(shape, event);
        });
        const pivotHandle = document.createElement('span');
        pivotHandle.className = 'transform-handle pivot-handle';
        pivotHandle.addEventListener('click', function (e) { e.stopPropagation(); });
        pivotHandle.addEventListener('pointerdown', function (event) {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          handlers.onPivotStart && handlers.onPivotStart(shape, event);
        });
        const resizeHandles = [
          { className: 'handle-n', x: 0, y: -1 }, { className: 'handle-e', x: 1, y: 0 },
          { className: 'handle-s', x: 0, y: 1 }, { className: 'handle-w', x: -1, y: 0 },
          { className: 'handle-nw', x: -1, y: -1 }, { className: 'handle-ne', x: 1, y: -1 },
          { className: 'handle-se', x: 1, y: 1 }, { className: 'handle-sw', x: -1, y: 1 },
        ];
        resizeHandles.forEach(function (handle) {
          const h = document.createElement('span');
          h.className = 'transform-handle resize-handle ' + handle.className;
          h.addEventListener('click', function (e) { e.stopPropagation(); });
          h.addEventListener('pointerdown', function (event) {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            handlers.onResizeStart && handlers.onResizeStart(shape, event, handle.x, handle.y, width, height, pivotX, pivotY);
          });
          node.appendChild(h);
        });
        node.append(rotateGuide, rotateHandle, pivotHandle);
      }

      world.appendChild(node);
    });
    applyViewportTransform();
  }

  global.Engine = {
    bindDom: bindDom,
    getObjectCenter: getObjectCenter,
    getAngleBetween: getAngleBetween,
    worldToLocal: worldToLocal,
    worldToBoxLocal: worldToBoxLocal,
    rotateVector: rotateVector,
    snapSize: snapSize,
    snapRotation: snapRotation,
    snapMove: snapMove,
    getStageRect: getStageRect,
    screenToWorld: screenToWorld,
    getViewportCenterWorld: getViewportCenterWorld,
    formatZoomPercent: formatZoomPercent,
    applyViewportTransform: applyViewportTransform,
    getThemeStyle: getShapeStyle,
    renderStage: renderStage,
  };
})(window);
