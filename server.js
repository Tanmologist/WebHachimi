'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PROJECT_FILE = path.join(DATA_DIR, 'project.json');
const V2_PROJECT_FILE = path.join(DATA_DIR, 'v2-project.json');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');
const PORT = Number(process.env.WEBHACHIMI_PORT) || 5577;
const MAX_BODY = 50 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers) {
  const outHeaders = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    outHeaders['Content-Type'] = outHeaders['Content-Type'] || 'application/json; charset=utf-8';
  }
  res.writeHead(status, outHeaders);
  if (body == null) res.end();
  else if (Buffer.isBuffer(body)) res.end(body);
  else if (typeof body === 'string') res.end(body);
  else res.end(JSON.stringify(body));
}

function safeJoin(relPath) {
  const abs = path.resolve(ROOT, relPath);
  const relative = path.relative(ROOT, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return abs;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function loadProject(file = PROJECT_FILE) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    return { empty: false, project: JSON.parse(text) };
  } catch (error) {
    if (error.code === 'ENOENT') return { empty: true, project: null };
    throw error;
  }
}

async function saveProject(project, file = PROJECT_FILE) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(ASSETS_DIR, { recursive: true });
  const copy = Object.assign({}, project, { savedAt: new Date().toISOString() });
  await extractDataUrlAttachments(copy);
  await fsp.writeFile(file, JSON.stringify(copy, null, 2), 'utf8');
  return { ok: true, savedAt: copy.savedAt };
}

async function saveV2Project(project) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(ASSETS_DIR, { recursive: true });
  const savedAt = new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(project));
  await extractDataUrlAttachments(copy);
  await fsp.writeFile(V2_PROJECT_FILE, JSON.stringify(copy, null, 2), 'utf8');
  return { ok: true, savedAt };
}

function extFromMime(mime, fallbackName) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'application/json') return 'json';
  const match = String(fallbackName || '').match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : 'bin';
}

function dataUrlToBuffer(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return Buffer.alloc(0);
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  return meta.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
}

async function extractDataUrlAttachments(root) {
  const writes = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.attachments)) {
      node.attachments.forEach((att) => {
        if (!att || typeof att !== 'object' || !att.dataUrl) return;
        const ext = extFromMime(att.mime, att.name);
        const id = String(att.id || 'asset-' + Date.now()).replace(/[^a-z0-9_-]/gi, '-');
        const rel = 'data/assets/' + id + '.' + ext;
        writes.push(fsp.writeFile(path.join(ROOT, rel), dataUrlToBuffer(att.dataUrl)));
        delete att.dataUrl;
        att.path = rel;
      });
    }
    Object.keys(node).forEach((key) => visit(node[key]));
  }
  visit(root);
  await Promise.all(writes);
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/health') {
    return send(res, 200, { ok: true, app: 'webhachimi-engine', port: PORT });
  }
  if (pathname === '/api/v2/project' && req.method === 'GET') {
    const result = await loadProject(V2_PROJECT_FILE);
    return send(res, 200, { ok: true, empty: result.empty, project: result.project });
  }
  if (pathname === '/api/v2/project' && req.method === 'POST') {
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8') || '{}');
    } catch (error) {
      return send(res, 400, { ok: false, error: 'invalid json' });
    }
    const project = payload.project || payload;
    if (!project || typeof project !== 'object') return send(res, 400, { ok: false, error: 'missing project' });
    if (project.kind !== 'webhachimi-v2-project' || project.version !== 1) {
      return send(res, 400, { ok: false, error: 'invalid v2 project payload' });
    }
    return send(res, 200, await saveV2Project(project));
  }
  if ((pathname === '/api/project' || pathname === '/api/scene') && req.method === 'GET') {
    const result = await loadProject();
    return send(res, 200, { ok: true, empty: result.empty, project: result.project, scene: result.project });
  }
  if ((pathname === '/api/project' || pathname === '/api/save') && req.method === 'POST') {
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8') || '{}');
    } catch (error) {
      return send(res, 400, { ok: false, error: 'invalid json' });
    }
    const project = payload.project || payload.scene || payload;
    if (!project || typeof project !== 'object') return send(res, 400, { ok: false, error: 'missing project' });
    return send(res, 200, await saveProject(project));
  }
  return false;
}

async function handleStatic(req, res, pathname) {
  if (pathname === '/favicon.ico') return send(res, 204, null, { 'Content-Type': 'image/x-icon' });
  const firstSegment = pathname.split('/').filter(Boolean)[0] || '';
  if (firstSegment === '.git') return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const abs = safeJoin(rel);
  if (!abs) return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  if (!fs.existsSync(abs)) return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  const stat = await fsp.stat(abs);
  if (stat.isDirectory()) return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  const ext = path.extname(abs).toLowerCase();
  const data = await fsp.readFile(abs);
  return send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, pathname);
      if (handled !== false) return;
    }
    await handleStatic(req, res, pathname);
  } catch (error) {
    send(res, 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://localhost:' + PORT + '/';
  console.log('WebHachimi Engine running at ' + url);
  if (!process.env.WEBHACHIMI_NO_BROWSER) {
    require('child_process').exec('start "" "' + url + '"');
  }
});
