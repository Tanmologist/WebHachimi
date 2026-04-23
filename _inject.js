// 临时注入脚本 - 直接修改 scene.json 添加地形对象
'use strict';
const fs = require('fs');
const path = require('path');

const SCENE_FILE = path.join(__dirname, 'scene.json');
const scene = JSON.parse(fs.readFileSync(SCENE_FILE, 'utf8'));

const newObjects = [
  { id:"shape-3", type:"square", name:"石头1", role:"floor", width:40, height:35, x:120, y:5, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#6b7280", stroke:"#374151", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
  { id:"shape-4", type:"square", name:"石头2", role:"floor", width:55, height:45, x:280, y:-5, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#4b5563", stroke:"#374151", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
  { id:"shape-5", type:"square", name:"石头3", role:"floor", width:30, height:28, x:430, y:12, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#6b7280", stroke:"#374151", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
  { id:"shape-6", type:"square", name:"石头4", role:"floor", width:50, height:40, x:-80, y:0, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#9ca3af", stroke:"#374151", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
  { id:"shape-7", type:"square", name:"石头5", role:"floor", width:35, height:30, x:520, y:10, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#4b5563", stroke:"#374151", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
  { id:"shape-8", type:"square", name:"左墙", role:"floor", width:30, height:500, x:-230, y:-400, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#1e3a5f", stroke:"#1f2937", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
  { id:"shape-9", type:"square", name:"右墙", role:"floor", width:30, height:500, x:600, y:-400, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#1e3a5f", stroke:"#1f2937", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
  { id:"shape-10", type:"square", name:"上层平台L", role:"floor", width:200, height:20, x:-150, y:-200, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#1d4ed8", stroke:"#1f2937", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
  { id:"shape-11", type:"square", name:"上层平台R", role:"floor", width:220, height:20, x:280, y:-250, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#1d4ed8", stroke:"#1f2937", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
  { id:"shape-12", type:"square", name:"中间隔断", role:"floor", width:20, height:120, x:200, y:-80, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#374151", stroke:"#1f2937", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
  { id:"shape-13", type:"square", name:"顶部天花板", role:"floor", width:860, height:20, x:-230, y:-400, pivotX:0.5, pivotY:0.5, rotation:0, fill:"#1e3a5f", stroke:"#1f2937", strokeWidth:1, opacity:1, tasks:[], parentId:null, isHitbox:false, lifetime:0, points:null },
];

const existing = new Set((scene.objects || []).map(o => o.id));
let added = 0;
for (const obj of newObjects) {
  if (!existing.has(obj.id)) {
    scene.objects.push(obj);
    added++;
  }
}

// 标记所有任务完成
for (const t of (scene.globalTasks || [])) {
  t.done = true;
}

// 更新 nextId
const maxNum = scene.objects.reduce((m, o) => {
  const n = parseInt((o.id || '').replace(/\D/g, ''), 10);
  return isNaN(n) ? m : Math.max(m, n);
}, 0);
scene.nextId = maxNum + 1;

fs.writeFileSync(SCENE_FILE, JSON.stringify(scene, null, 2), 'utf8');
console.log('注入完成，添加了', added, '个对象，nextId =', scene.nextId);
