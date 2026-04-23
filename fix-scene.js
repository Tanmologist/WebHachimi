// fix-scene.js - 修正 scene.json：清理重复石头、修正地形坐标、修正 nextId
'use strict';
const fs = require('fs');
const path = require('path');

const SCENE_FILE = path.join(__dirname, 'scene.json');
const scene = JSON.parse(fs.readFileSync(SCENE_FILE, 'utf8'));

// 移除所有旧的石头和错误地形（只保留 主角 shape-1 和 地板 shape-2）
const keepIds = new Set(['shape-1', 'shape-2']);
scene.objects = scene.objects.filter(o => keepIds.has(o.id));

function makeObj(id, name, x, y, w, h, fill) {
  return {
    id, type: 'square', name, role: 'floor', width: w, height: h, x, y,
    pivotX: 0.5, pivotY: 0.5, rotation: 0, fill, stroke: '#1f2937',
    strokeWidth: 1, opacity: 1, tasks: [], parentId: null,
    isHitbox: false, lifetime: 0, points: null
  };
}

// ==============================================================
// task-3 石头：草图轮廓范围 x=211~957, y=-157~172
// 主地板顶面 y=40，石头底部应 = 40 → y = 40 - height
// 石头散布在主地板上 x=260~590 范围内（在草图左半圆内）
// ==============================================================
const stoneFloorTop = 40;
const stones = [
  { id: 'shape-3',  name: '石头1', x: 255, h: 38, w: 44 },
  { id: 'shape-4',  name: '石头2', x: 340, h: 32, w: 36 },
  { id: 'shape-5',  name: '石头3', x: 430, h: 44, w: 52 },
  { id: 'shape-6',  name: '石头4', x: 510, h: 30, w: 38 },
  { id: 'shape-7',  name: '石头5', x: 575, h: 42, w: 48 },
];
for (const s of stones) {
  scene.objects.push(makeObj(s.id, s.name, s.x, stoneFloorTop - s.h, s.w, s.h, '#6b7280'));
}

// ==============================================================
// task-4 地形：草图轮廓范围 x=95~660, y=130~295
// 解码轮廓轨迹：左壁 x≈95~120, 底部 y≈265~295, 右壁 x≈635~660
// 轮廓内有两个平台（从采样点 y≈229, 226 推算）
// ==============================================================
const terrain = [
  // 左壁 - 草图左边缘 x≈95, 从 y=100（地板下方）到 y=270
  { id: 'shape-8',  name: '左壁',   x: 95,  y: 100, w: 22, h: 170, fill: '#374151' },
  // 右壁 - 草图右边缘 x≈638, 从 y=130 到 y=270
  { id: 'shape-9',  name: '右壁',   x: 638, y: 130, w: 22, h: 140, fill: '#374151' },
  // 底部地板 - 草图最低处 y≈265~295
  { id: 'shape-10', name: '底部地板', x: 117, y: 270, w: 521, h: 25, fill: '#1d4ed8' },
  // 左内平台 - 草图左内侧凸起 y≈225~235, x≈120~250
  { id: 'shape-11', name: '左内平台', x: 120, y: 228, w: 130, h: 18, fill: '#1e40af' },
  // 右内平台 - 草图右内侧 y≈220~230, x≈530~660
  { id: 'shape-12', name: '右内平台', x: 510, y: 222, w: 130, h: 18, fill: '#1e40af' },
  // 中央最低台阶 - 草图中央最深处 y≈280, x≈330~480
  { id: 'shape-13', name: '中央台阶', x: 320, y: 253, w: 160, h: 18, fill: '#1e40af' },
];
for (const t of terrain) {
  const obj = makeObj(t.id, t.name, t.x, t.y, t.w, t.h, t.fill);
  // 使用 t.fill 而不是 makeObj 的默认值
  scene.objects.push(obj);
}

// 修正 nextId
const maxNum = scene.objects.reduce((m, o) => {
  const digits = (o.id || '').replace(/[^0-9]/g, '');
  const n = digits ? parseInt(digits, 10) : 0;
  return Math.max(m, isNaN(n) ? 0 : n);
}, 0);
scene.nextId = maxNum + 1;

// 标记所有任务完成
for (const t of (scene.globalTasks || [])) {
  t.done = true;
}

fs.writeFileSync(SCENE_FILE, JSON.stringify(scene, null, 2), 'utf8');
console.log('修正完成');
console.log('对象:', scene.objects.map(o => o.id + ':' + o.name + '(x=' + o.x + ',y=' + o.y + ')').join('\n  '));
console.log('nextId:', scene.nextId);
