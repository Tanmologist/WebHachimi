// server.js —— WebHachimi 本地同步服务
// 极小 HTTP 服务：把浏览器和磁盘连起来。仅监听 127.0.0.1，外网无法访问。
//
// 启动：node server.js  （或双击 start.bat）
// 端点：
//   GET  /                      → 重定向到 index.html
//   GET  /<file>                → 静态文件
//   GET  /api/scene             → 返回当前 scene.json（首次为空）
//   GET  /api/scenes            → 列出所有 scene-*.json 文件
//   GET  /api/scene/:id         → 加载指定 scene-<id>.json
//   POST /api/scene/:id/save    → 保存到指定 scene-<id>.json
//   POST /api/save              → 接收完整场景，自动拆分附件到 assets/，写 scene.json
//   GET  /api/health            → 健康检查
//   WS   /ws                    → WebSocket 广播总线（所有客户端互发消息）
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const url = require('url');

// WebSocket 支持（需要 npm install ws）
let WebSocketServer = null;
try { WebSocketServer = require('ws').WebSocketServer; } catch (e) {}

const ROOT = __dirname;
const ASSETS_DIR = path.join(ROOT, 'assets');
const SCENE_FILE = path.join(ROOT, 'scene.json');
const PORT = Number(process.env.WEBHACHIMI_PORT) || 5577;
const CONSOLE_LOG_FILE = path.join(ROOT, 'console-log.json');
const MAX_LOG_ENTRIES = 500;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.ico':  'image/x-icon',
};

function safeJoin(rel) {
  const p = path.normalize(path.join(ROOT, rel));
  if (!p.startsWith(ROOT)) return null;
  return p;
}

function extFromMime(mime, fallbackName) {
  if (typeof mime === 'string') {
    if (mime === 'image/png')  return 'png';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/gif')  return 'gif';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/svg+xml') return 'svg';
    if (mime === 'application/json') return 'json';
    if (mime === 'application/x-super-sketch+json') return 'json';
    if (mime === 'text/plain') return 'txt';
  }
  if (typeof fallbackName === 'string') {
    const m = fallbackName.match(/\.([a-z0-9]+)$/i);
    if (m) return m[1].toLowerCase();
  }
  return 'bin';
}

function dataUrlToBuffer(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return Buffer.alloc(0);
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  if (meta.indexOf(';base64') >= 0) return Buffer.from(body, 'base64');
  return Buffer.from(decodeURIComponent(body), 'utf8');
}

async function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(status, h);
  if (body == null) res.end();
  else if (Buffer.isBuffer(body)) res.end(body);
  else if (typeof body === 'string') res.end(body);
  else res.end(JSON.stringify(body));
}

async function loadScene() {
  try {
    const text = await fsp.readFile(SCENE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    return { ok: true, scene: parsed };
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, scene: null, empty: true };
    return { ok: false, error: e.message };
  }
}

async function saveScene(scene) {
  // 拆出所有 attachments 中的 dataUrl，写入 assets/，scene.json 中保留 path
  await fsp.mkdir(ASSETS_DIR, { recursive: true });
  const usedNames = new Set();
  const writtenFiles = new Set();

  function pickPath(att) {
    const ext = extFromMime(att.mime, att.name);
    let base = (att.id || 'asset') + '.' + ext;
    let final = base;
    let n = 1;
    while (usedNames.has(final)) final = (att.id || 'asset') + '-' + (++n) + '.' + ext;
    usedNames.add(final);
    return 'assets/' + final;
  }

  async function processTaskList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const t of list) {
      const cloneT = Object.assign({}, t);
      const newAtts = [];
      for (const a of (t.attachments || [])) {
        let path_ = a.path;
        if (a.dataUrl) {
          path_ = pickPath(a);
          const buf = dataUrlToBuffer(a.dataUrl);
          const abs = safeJoin(path_);
          if (abs) {
            await fsp.writeFile(abs, buf);
            writtenFiles.add(path_);
          }
        }
        newAtts.push({
          id: a.id, name: a.name, mime: a.mime, size: a.size,
          path: path_,
        });
      }
      cloneT.attachments = newAtts;
      out.push(cloneT);
    }
    return out;
  }

  const persisted = Object.assign({}, scene);
  persisted.kind = 'webhachimi-scene';
  persisted.version = 2;
  persisted.savedAt = new Date().toISOString();
  persisted.globalTasks = await processTaskList(scene.globalTasks);

  await fsp.writeFile(SCENE_FILE, JSON.stringify(persisted, null, 2), 'utf8');

  // 清理孤儿 assets（不被任何 attachment.path 引用的）
  try {
    const referenced = new Set();
    for (const t of persisted.globalTasks || []) {
      for (const a of (t.attachments || [])) {
        if (a.path) referenced.add(path.basename(a.path));
      }
    }
    const files = await fsp.readdir(ASSETS_DIR).catch(() => []);
    for (const f of files) {
      if (!referenced.has(f)) {
        await fsp.unlink(path.join(ASSETS_DIR, f)).catch(() => {});
      }
    }
  } catch {}

  return { ok: true, savedAt: persisted.savedAt, attachments: writtenFiles.size };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = url.parse(req.url, true);
    const pathname = decodeURIComponent(u.pathname || '/');

    // === API ===
    if (pathname === '/api/health') {
      return send(res, 200, { ok: true, server: 'webhachimi', port: PORT });
    }
    if (pathname === '/api/scene' && req.method === 'GET') {
      const r = await loadScene();
      if (!r.ok) return send(res, 500, { ok: false, error: r.error });
      return send(res, 200, { ok: true, scene: r.scene, empty: !!r.empty });
    }
    // === 多场景管理 ===
    // GET /api/scenes → 列出所有 scene-*.json
    if (pathname === '/api/scenes' && req.method === 'GET') {
      const files = fs.readdirSync(ROOT).filter(f => /^scene(-\w+)?\.json$/.test(f));
      const scenes = files.map(f => ({ id: f.replace(/^scene-?(.*)\.json$/, '$1') || 'default', file: f }));
      return send(res, 200, { ok: true, scenes });
    }
    // GET /api/scene/:id → 加载 scene-<id>.json
    const sceneLoadMatch = pathname.match(/^\/api\/scene\/([a-zA-Z0-9_-]+)$/);
    if (sceneLoadMatch && req.method === 'GET') {
      const sceneId = sceneLoadMatch[1];
      const file = path.join(ROOT, 'scene-' + sceneId + '.json');
      if (!fs.existsSync(file)) return send(res, 404, { ok: false, error: '场景 ' + sceneId + ' 不存在' });
      try {
        const raw = await fsp.readFile(file, 'utf8');
        return send(res, 200, { ok: true, scene: JSON.parse(raw), sceneId });
      } catch (e) { return send(res, 500, { ok: false, error: e.message }); }
    }
    // POST /api/scene/:id/save → 保存到 scene-<id>.json
    const sceneSaveMatch = pathname.match(/^\/api\/scene\/([a-zA-Z0-9_-]+)\/save$/);
    if (sceneSaveMatch && req.method === 'POST') {
      const sceneId = sceneSaveMatch[1];
      const file = path.join(ROOT, 'scene-' + sceneId + '.json');
      const buf = await readBody(req, 200 * 1024 * 1024);
      let payload;
      try { payload = JSON.parse(buf.toString('utf8')); }
      catch (e) { return send(res, 400, { ok: false, error: 'JSON 解析失败' }); }
      const scene = payload && payload.scene ? payload.scene : payload;
      await fsp.writeFile(file, JSON.stringify(scene, null, 2), 'utf8');
      return send(res, 200, { ok: true, saved: 'scene-' + sceneId + '.json' });
    }
    if (pathname === '/api/save' && req.method === 'POST') {
      const buf = await readBody(req, 200 * 1024 * 1024); // 200MB cap
      let payload;
      try { payload = JSON.parse(buf.toString('utf8')); }
      catch (e) { return send(res, 400, { ok: false, error: 'JSON 解析失败：' + e.message }); }
      const scene = payload && payload.scene ? payload.scene : payload;
      if (!scene || typeof scene !== 'object') return send(res, 400, { ok: false, error: '请求体缺少 scene 对象' });
      const r = await saveScene(scene);
      return send(res, 200, r);
    }
    if (pathname === '/api/activate-task' && req.method === 'POST') {
      const buf = await readBody(req, 5 * 1024 * 1024); // 5MB cap
      let payload;
      try { payload = JSON.parse(buf.toString('utf8')); }
      catch (e) { return send(res, 400, { ok: false, error: 'JSON 解析失败：' + e.message }); }
      if (!payload || typeof payload !== 'object') return send(res, 400, { ok: false, error: '无效的请求体' });
      const activeTaskFile = path.join(ROOT, 'active-task.json');
      await fsp.writeFile(activeTaskFile, JSON.stringify(payload, null, 2), 'utf8');
      return send(res, 200, { ok: true, path: 'active-task.json', activatedAt: payload.activatedAt });
    }
    if (pathname === '/api/log' && req.method === 'POST') {
      const buf = await readBody(req, 64 * 1024); // 64KB cap per entry
      let entry;
      try { entry = JSON.parse(buf.toString('utf8')); }
      catch (e) { return send(res, 400, { ok: false, error: 'JSON 解析失败' }); }
      let logEntries = [];
      try {
        const existing = await fsp.readFile(CONSOLE_LOG_FILE, 'utf8');
        logEntries = JSON.parse(existing);
        if (!Array.isArray(logEntries)) logEntries = [];
      } catch (e) { logEntries = []; }
      logEntries.push(entry);
      if (logEntries.length > MAX_LOG_ENTRIES) logEntries = logEntries.slice(-MAX_LOG_ENTRIES);
      await fsp.writeFile(CONSOLE_LOG_FILE, JSON.stringify(logEntries, null, 2), 'utf8');
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/console-log' && req.method === 'GET') {
      try {
        const text = await fsp.readFile(CONSOLE_LOG_FILE, 'utf8');
        const data = JSON.parse(text);
        return send(res, 200, { ok: true, entries: Array.isArray(data) ? data : [] });
      } catch (e) {
        return send(res, 200, { ok: true, entries: [] });
      }
    }
    // POST /api/inject-objects  { objects: [...], tasks?: [...] }
    // 把 objects 合并进 scene.json（ID 已存在则跳过），可选更新 globalTasks
    if (pathname === '/api/inject-objects' && req.method === 'POST') {
      const buf = await readBody(req, 5 * 1024 * 1024);
      let payload;
      try { payload = JSON.parse(buf.toString('utf8')); }
      catch (e) { return send(res, 400, { ok: false, error: 'JSON 解析失败' }); }
      const r = await loadScene();
      if (!r.ok) return send(res, 500, { ok: false, error: r.error });
      const scene = r.scene || { kind: 'webhachimi-scene', version: 2, objects: [], globalTasks: [], nextId: 1 };
      if (!Array.isArray(scene.objects)) scene.objects = [];
      const existing = new Set(scene.objects.map(o => o.id));
      let added = 0;
      for (const obj of (payload.objects || [])) {
        if (!existing.has(obj.id)) {
          scene.objects.push(obj);
          existing.add(obj.id);
          added++;
        }
      }
      // 更新 nextId 以反映新对象
      const maxNum = scene.objects.reduce((m, o) => {
        const n = parseInt((o.id || '').replace(/\D/g, ''), 10);
        return isNaN(n) ? m : Math.max(m, n);
      }, 0);
      if (maxNum >= (scene.nextId || 0)) scene.nextId = maxNum + 1;
      // 可选：合并更新 globalTasks
      if (Array.isArray(payload.tasks)) {
        if (!Array.isArray(scene.globalTasks)) scene.globalTasks = [];
        for (const t of payload.tasks) {
          const idx = scene.globalTasks.findIndex(x => x.id === t.id);
          if (idx >= 0) Object.assign(scene.globalTasks[idx], t);
          else scene.globalTasks.push(t);
        }
      }
      await fsp.writeFile(SCENE_FILE, JSON.stringify(scene, null, 2), 'utf8');
      return send(res, 200, { ok: true, added, nextId: scene.nextId });
    }

    // === 静态文件 ===
    let target = pathname === '/' ? '/index.html' : pathname;
    const abs = safeJoin('.' + target);
    if (!abs) return send(res, 403, 'forbidden');
    if (!fs.existsSync(abs)) return send(res, 404, 'not found: ' + target);
    const stat = await fsp.stat(abs);
    if (stat.isDirectory()) return send(res, 403, 'forbidden (directory)');
    const ext = path.extname(abs).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const data = await fsp.readFile(abs);
    return send(res, 200, data, { 'Content-Type': mime });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = 'http://localhost:' + PORT + '/';
  console.log('═══════════════════════════════════════════');
  console.log('  WebHachimi 本地同步服务已启动');
  console.log('  地址: ' + addr);
  console.log('  仅监听 127.0.0.1（外网无法访问）');
  console.log('  按 Ctrl+C 停止');
  console.log('═══════════════════════════════════════════');

  // ─── WebSocket 广播总线 ───
  if (WebSocketServer) {
    const wss = new WebSocketServer({ server });
    const clients = new Set();
    wss.on('connection', function (ws) {
      clients.add(ws);
      ws.on('message', function (msg) {
        // 广播给所有其他客户端
        clients.forEach(function (c) {
          if (c !== ws && c.readyState === 1 /* OPEN */) c.send(msg);
        });
      });
      ws.on('close', function () { clients.delete(ws); });
      ws.on('error', function () { clients.delete(ws); });
      ws.send(JSON.stringify({ type: 'hello', port: PORT }));
    });
    console.log('  WebSocket: ws://localhost:' + PORT + '/ws (通过 server upgrade)');
  } else {
    console.log('  WebSocket 未启用（运行 npm install 可启用）');
  }

  // 自动开浏览器
  if (!process.env.WEBHACHIMI_NO_BROWSER) {
    const { exec } = require('child_process');
    if (process.platform === 'win32') exec('start "" "' + addr + '"');
    else if (process.platform === 'darwin') exec('open "' + addr + '"');
    else exec('xdg-open "' + addr + '"');
  }
});
