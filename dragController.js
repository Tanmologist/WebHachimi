// dragController.js —— 对象层交互：选中 / 拖拽移动 / 缩放 / 旋转 / 锚点
// 不涉及视口平移、抽屉伸缩、上下文菜单——那些仍在 editor.js
(function (global) {
  'use strict';
  const S = global.State;
  const E = global.Engine;
  const C = S.constants;
  const clamp = S.clamp;

  let requestRender;
  let requestStageRender;
  let openContextMenu;

  const dragState = {
    active: false,
    objectId: null,
    mode: 'move',
    handleX: 0, handleY: 0,
    offsetX: 0, offsetY: 0,
    centerX: 0, centerY: 0,
    startX: 0, startY: 0,
    startWidth: 0, startHeight: 0,
    startPivotX: 0.5, startPivotY: 0.5,
    startAngle: 0, startRotation: 0,
  };

  function init(deps) {
    requestRender = deps.requestRender;
    requestStageRender = deps.requestStageRender;
    openContextMenu = deps.openContextMenu;
  }

  function isActive() { return dragState.active; }
  function cancel() {
    dragState.active = false;
    dragState.objectId = null;
    dragState.mode = 'move';
  }

  function getStageHandlers() {
    return {
      onClick: onShapeClick,
      onContextMenu: onShapeContextMenu,
      onPointerDown: onShapePointerDown,
      onResizeStart: onResizeStart,
      onRotateStart: onRotateStart,
      onPivotStart: onPivotStart,
    };
  }

  function onShapeClick(shape) {
    if (!S.state.editMode) return;
    S.state.selectedId = shape.id;
    requestRender();
  }

  function onShapeContextMenu(shape, event) {
    openContextMenu(shape.id, event.clientX, event.clientY);
  }

  function onShapePointerDown(shape, event, node) {
    S.recordUndo('拖动');
    const pointer = E.screenToWorld(event.clientX, event.clientY);
    dragState.active = true;
    dragState.objectId = shape.id;
    dragState.mode = 'move';
    dragState.offsetX = pointer.x - shape.x;
    dragState.offsetY = pointer.y - shape.y;
    if (node.setPointerCapture) node.setPointerCapture(event.pointerId);
    S.state.selectedId = shape.id;
    requestRender();
  }

  function onResizeStart(shape, event, hx, hy, w, h, px, py) {
    S.recordUndo('缩放');
    dragState.active = true;
    dragState.objectId = shape.id;
    dragState.mode = 'resize';
    dragState.handleX = hx; dragState.handleY = hy;
    dragState.startX = shape.x; dragState.startY = shape.y;
    dragState.startWidth = w; dragState.startHeight = h;
    dragState.startPivotX = px; dragState.startPivotY = py;
    dragState.startRotation = shape.rotation || 0;
  }

  function onRotateStart(shape, event) {
    S.recordUndo('旋转');
    const center = E.getObjectCenter(shape);
    const pointer = E.screenToWorld(event.clientX, event.clientY);
    dragState.active = true;
    dragState.objectId = shape.id;
    dragState.mode = 'rotate';
    dragState.centerX = center.x;
    dragState.centerY = center.y;
    dragState.startAngle = E.getAngleBetween(center, pointer);
    dragState.startRotation = shape.rotation || 0;
  }

  function onPivotStart(shape) {
    S.recordUndo('调轴心');
    dragState.active = true;
    dragState.objectId = shape.id;
    dragState.mode = 'pivot';
  }

  // —— 在 editor 的 pointermove 里调用 ——
  // 返回 true 表示本次 move 已被 drag 消费
  function handlePointerMove(e) {
    if (!dragState.active || !dragState.objectId || !S.state.editMode) return false;
    const target = S.getObjectById(dragState.objectId);
    if (!target) return false;
    const pointer = E.screenToWorld(e.clientX, e.clientY);

    if (dragState.mode === 'resize') {
      const ref = {
        x: dragState.startX, y: dragState.startY,
        width: dragState.startWidth, height: dragState.startHeight,
        pivotX: dragState.startPivotX, pivotY: dragState.startPivotY,
        rotation: dragState.startRotation,
      };
      const local = E.worldToBoxLocal(pointer, ref);
      let left = 0, top = 0, right = dragState.startWidth, bottom = dragState.startHeight;
      if (dragState.handleX < 0) left = Math.min(local.x, right - C.MIN_SHAPE_SIZE);
      if (dragState.handleX > 0) right = Math.max(local.x, left + C.MIN_SHAPE_SIZE);
      if (dragState.handleY < 0) top = Math.min(local.y, bottom - C.MIN_SHAPE_SIZE);
      if (dragState.handleY > 0) bottom = Math.max(local.y, top + C.MIN_SHAPE_SIZE);
      const nextW = E.snapSize(right - left);
      const nextH = E.snapSize(bottom - top);
      if (dragState.handleX < 0) left = right - nextW;
      if (dragState.handleY < 0) top = bottom - nextH;
      const offset = E.rotateVector(left, top, dragState.startRotation);
      target.x = Math.round(dragState.startX + offset.x);
      target.y = Math.round(dragState.startY + offset.y);
      target.width = nextW; target.height = nextH;
      target.pivotX = dragState.startPivotX; target.pivotY = dragState.startPivotY;
      S.ensureObjectInStage(target);
      requestStageRender();
      return true;
    }

    if (dragState.mode === 'pivot') {
      const local = E.worldToBoxLocal(pointer, target);
      target.pivotX = clamp(local.x / S.getShapeWidth(target), 0, 1);
      target.pivotY = clamp(local.y / S.getShapeHeight(target), 0, 1);
      requestStageRender();
      return true;
    }

    if (dragState.mode === 'rotate') {
      const center = { x: dragState.centerX, y: dragState.centerY };
      const cur = E.getAngleBetween(center, pointer);
      target.rotation = E.snapRotation(
        S.normalizeRotation(dragState.startRotation + cur - dragState.startAngle),
      );
      requestStageRender();
      return true;
    }

    // move
    const next = E.snapMove(target, pointer.x - dragState.offsetX, pointer.y - dragState.offsetY);
    target.x = next.x; target.y = next.y;
    S.ensureObjectInStage(target);
    requestStageRender();
    return true;
  }

  // 返回 true 表示有 drag 被结束（外层负责 captureBaseline + persist）
  function handlePointerUp() {
    const wasActive = dragState.active;
    cancel();
    return wasActive;
  }

  global.DragController = {
    init: init,
    isActive: isActive,
    cancel: cancel,
    getStageHandlers: getStageHandlers,
    handlePointerMove: handlePointerMove,
    handlePointerUp: handlePointerUp,
  };
})(window);
