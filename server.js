'use strict';

const http = require('http');
const { randomBytes } = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { URL } = require('url');
const {
  WEBHACHIMI_EDITOR_ENTRY,
  createProjectProfiles,
  projectProfilesByRoute,
} = require('./project-profiles.cjs');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const LOCAL_DATA_DIR = path.join(DATA_DIR, 'local');
const PROJECT_SEED_FILE = path.join(DATA_DIR, 'project.json');
const PROJECT_FILE = path.join(LOCAL_DATA_DIR, 'project.json');
const ASSETS_DIR = path.join(ROOT, 'resources');
const DIST_V2_DIR = path.join(ROOT, 'dist-v2');
const PROJECT_PROFILES = createProjectProfiles(ROOT);
const PROJECT_PROFILES_BY_ROUTE = projectProfilesByRoute(PROJECT_PROFILES);
const DEFAULT_ENTRY_PATH = normalizeEntryPath(process.env.WEBHACHIMI_ENTRY_PATH || '/' + WEBHACHIMI_EDITOR_ENTRY);
const PORT = Number(process.env.WEBHACHIMI_PORT) || 5577;
const MAX_BODY = 50 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const MAX_CLIPBOARD_FILES = 10;
const MAX_CLIPBOARD_FILE_BYTES = 8 * 1024 * 1024;
const MAX_CLIPBOARD_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_ATTACHMENT_FILE_BYTES = 8 * 1024 * 1024;
const LOCAL_API_COOKIE = 'webhachimi_local_token_' + PORT;
const LOCAL_API_TOKEN = randomBytes(24).toString('hex');

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
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'model/obj',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const ROOT_STATIC_FILES = new Set([
  'index.html',
  'app.js',
  'styles.css',
  'editor-preview.html',
  'editor-preview.css',
  'apps/webhachimi/editor.html',
  'games/hachimi-nanbei-lvdong/index.html',
  'games/hachimi-nanbei-lvdong/editor.html',
]);

const BUILT_APP_FILES = new Set([
  'apps/webhachimi/editor.html',
  'games/hachimi-nanbei-lvdong/index.html',
  'games/hachimi-nanbei-lvdong/editor.html',
]);

const SAFE_ATTACHMENT_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/flac',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/pdf',
  'application/zip',
  'application/octet-stream',
  'model/gltf-binary',
  'model/gltf+json',
  'model/obj',
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
]);

function send(res, status, body, headers) {
  const outHeaders = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  outHeaders['Set-Cookie'] = outHeaders['Set-Cookie'] || localApiCookie();
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    outHeaders['Content-Type'] = outHeaders['Content-Type'] || 'application/json; charset=utf-8';
  }
  res.writeHead(status, outHeaders);
  if (body == null) res.end();
  else if (Buffer.isBuffer(body)) res.end(body);
  else if (typeof body === 'string') res.end(body);
  else res.end(JSON.stringify(body));
}

function normalizeEntryPath(value) {
  const entryPath = String(value || '').trim();
  if (entryPath.startsWith('/') && !entryPath.startsWith('//') && !entryPath.includes('\0')) return entryPath;
  return '/' + WEBHACHIMI_EDITOR_ENTRY;
}

function localApiCookie() {
  return LOCAL_API_COOKIE + '=' + LOCAL_API_TOKEN + '; Path=/; HttpOnly; SameSite=Strict';
}

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return cookies;
      cookies[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
      return cookies;
    }, {});
}

function hasLocalApiToken(req) {
  const headerToken = String(req.headers['x-webhachimi-local-token'] || '');
  const cookieToken = parseCookies(req)[LOCAL_API_COOKIE] || '';
  return headerToken === LOCAL_API_TOKEN || cookieToken === LOCAL_API_TOKEN;
}

function isSameOrigin(req) {
  const host = String(req.headers.host || '');
  if (!host) return false;
  const origin = String(req.headers.origin || '');
  if (origin) return urlHost(origin) === host;
  const referer = String(req.headers.referer || '');
  return referer ? urlHost(referer) === host : true;
}

function urlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function requireLocalApiAccess(req, res) {
  if (!isSameOrigin(req)) {
    send(res, 403, { ok: false, error: 'same-origin request required' });
    return false;
  }
  if (!hasLocalApiToken(req)) {
    send(res, 403, { ok: false, error: 'local session token required' });
    return false;
  }
  return true;
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

async function loadProject(file = PROJECT_FILE, fallbackFile = PROJECT_SEED_FILE) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    return { empty: false, project: JSON.parse(text) };
  } catch (error) {
    if (error.code === 'ENOENT' && fallbackFile) return loadProject(fallbackFile, null);
    if (error.code === 'ENOENT') return { empty: true, project: null };
    throw error;
  }
}

async function saveProject(project, file = PROJECT_FILE) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.mkdir(ASSETS_DIR, { recursive: true });
  const copy = Object.assign({}, project, { savedAt: new Date().toISOString() });
  await extractDataUrlAttachments(copy);
  await writeFileAtomic(file, JSON.stringify(copy, null, 2), 'utf8');
  return { ok: true, savedAt: copy.savedAt };
}

async function saveProfileProject(project, profile) {
  await fsp.mkdir(path.dirname(profile.projectFile), { recursive: true });
  await fsp.mkdir(profile.assetsDir, { recursive: true });
  const savedAt = new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(project));
  await extractDataUrlAttachments(copy, profile);
  await writeFileAtomic(profile.projectFile, JSON.stringify(copy, null, 2), 'utf8');
  return { ok: true, savedAt };
}

async function writeFileAtomic(file, data, encoding) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    await fsp.writeFile(tempFile, data, encoding);
    await fsp.rename(tempFile, file);
  } catch (error) {
    await fsp.rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
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

function fileNameWithMimeExtension(fileName, mime, extension) {
  if (!fileName || !extension || mimeFromFileName(fileName) === mime) return fileName || '';
  const cleanExtension = String(extension).replace(/^\./, '');
  return String(fileName).replace(/(\.[a-z0-9]+)?$/i, '.' + cleanExtension);
}

function dataUrlToBuffer(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return Buffer.alloc(0);
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  return meta.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
}

async function extractDataUrlAttachments(root, profile) {
  const writes = [];
  const targetAssetsDir = profile ? profile.assetsDir : ASSETS_DIR;
  const targetAssetPrefix = profile ? profile.assetUrlPrefix : 'resources';
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.attachments)) {
      node.attachments.forEach((att) => {
        if (!att || typeof att !== 'object') return;
        const dataUrl = typeof att.dataUrl === 'string'
          ? att.dataUrl
          : typeof att.path === 'string' && att.path.startsWith('data:')
            ? att.path
            : '';
        if (!dataUrl) return;
        const parsed = parseDataUrl(dataUrl);
        if (!parsed) return;
        const name = typeof att.fileName === 'string' ? att.fileName : typeof att.name === 'string' ? att.name : '';
        const mime = sniffMimeFromBuffer(parsed.buffer) || parsed.mime || att.mime || mimeFromFileName(name);
        if (!isSafeAttachment(mime, parsed.buffer)) return;
        const ext = extFromMime(mime, name);
        const id = String(att.id || 'asset-' + Date.now()).replace(/[^a-z0-9_-]/gi, '-');
        const fileName = id + '.' + ext;
        writes.push(writeFileAtomic(path.join(targetAssetsDir, fileName), parsed.buffer));
        delete att.dataUrl;
        att.mime = mime;
        const normalizedFileName = fileNameWithMimeExtension(name, mime, ext);
        if (normalizedFileName) att.fileName = normalizedFileName;
        att.path = targetAssetPrefix + '/' + fileName;
      });
    }
    Object.keys(node).forEach((key) => visit(node[key]));
  }
  visit(root);
  await Promise.all(writes);
}

function parseDataUrl(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?$/i.exec(meta);
  if (!match) return null;
  const mime = String(match[1] || 'text/plain').toLowerCase();
  const buffer = match[2] ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
  return { mime, buffer };
}

function sniffMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return '';
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  const text = buffer.slice(0, 256).toString('utf8').trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'image/svg+xml';
  return '';
}

function isSafeAttachment(mime, buffer) {
  if (!SAFE_ATTACHMENT_MIME.has(mime)) return false;
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_ATTACHMENT_FILE_BYTES) return false;
  if (mime === 'image/svg+xml') return isSafeSvg(buffer.toString('utf8'));
  return true;
}

function isSafeSvg(text) {
  return !/<script[\s>]/i.test(text) && !/\son[a-z]+\s*=/i.test(text) && !/javascript:/i.test(text);
}

async function readClipboardFileResources() {
  const entries = await readClipboardFileEntries();
  const files = [];
  const skipped = [];
  let totalBytes = 0;

  for (const entry of entries.slice(0, MAX_CLIPBOARD_FILES)) {
    const filePath = String(entry.FullName || entry.fullName || '').trim();
    const fileName = String(entry.Name || entry.name || path.basename(filePath)).trim();
    if (!filePath || !path.isAbsolute(filePath)) {
      skipped.push({ fileName, reason: 'invalid path' });
      continue;
    }

    let info;
    try {
      info = await fsp.stat(filePath);
    } catch (error) {
      skipped.push({ fileName, reason: 'not readable' });
      continue;
    }
    if (!info.isFile()) {
      skipped.push({ fileName, reason: 'not a file' });
      continue;
    }
    if (info.size > MAX_CLIPBOARD_FILE_BYTES) {
      skipped.push({ fileName, reason: 'file too large' });
      continue;
    }
    if (totalBytes + info.size > MAX_CLIPBOARD_TOTAL_BYTES) {
      skipped.push({ fileName, reason: 'clipboard selection too large' });
      continue;
    }

    const buffer = await fsp.readFile(filePath);
    const mime = mimeFromFileName(fileName);
    totalBytes += info.size;
    files.push({
      displayName: fileNameWithoutExtension(fileName) || fileName,
      fileName,
      mime,
      path: 'data:' + mime + ';base64,' + buffer.toString('base64'),
      description: '',
      type: resourceTypeFromMimeOrPath(mime, fileName),
    });
  }

  if (entries.length > MAX_CLIPBOARD_FILES) {
    skipped.push({ reason: 'only the first ' + MAX_CLIPBOARD_FILES + ' files were read' });
  }

  return { ok: true, files, skipped };
}

async function readClipboardFileEntries() {
  if (process.platform !== 'win32') return [];
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$files = Get-Clipboard -Format FileDropList",
    "if ($null -eq $files) { '[]'; exit }",
    "@($files | ForEach-Object { [pscustomobject]@{ FullName = $_.FullName; Name = $_.Name } }) | ConvertTo-Json -Compress",
  ].join('; ');
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const raw = String(result.stdout || '').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function mimeFromFileName(fileName) {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return MIME['.' + ext] || {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.obj': 'model/obj',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }['.' + ext] || 'application/octet-stream';
}

function resourceTypeFromMimeOrPath(mime, fileName) {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || ['json', 'md', 'txt', 'csv'].includes(ext)) return 'note';
  return 'material';
}

function fileNameWithoutExtension(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}

function isJsonRequest(req) {
  return String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim() === 'application/json';
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isV2Project(value) {
  if (!isRecord(value)) return false;
  if (value.kind !== 'webhachimi-v2-project' || value.version !== 1) return false;
  if (typeof value.activeSceneId !== 'string') return false;
  if (!isRecord(value.meta) || typeof value.meta.name !== 'string') return false;
  if (!isRecord(value.scenes) || !isRecord(value.resources) || !isRecord(value.tasks)) return false;
  if (!isRecord(value.transactions) || !isRecord(value.testRecords)) return false;
  const activeScene = value.scenes[value.activeSceneId];
  return isRecord(activeScene) && isRecord(activeScene.entities);
}

function projectProfileForAssetPath(pathname) {
  return PROJECT_PROFILES.find((profile) => pathname === profile.assetUrlPrefix || pathname.startsWith(profile.assetUrlPrefix + '/'));
}

function profileAssetFilePath(profile, pathname) {
  const prefix = profile.assetUrlPrefix + '/';
  if (!pathname.startsWith(prefix)) return null;
  const fileName = pathname.slice(prefix.length);
  if (!fileName || fileName.includes('/') || fileName.startsWith('.')) return null;
  const abs = path.resolve(profile.assetsDir, fileName);
  const relative = path.relative(profile.assetsDir, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return abs;
}

async function handleApi(req, res, pathname) {
  const assetProfile = projectProfileForAssetPath(pathname);
  if (assetProfile) {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method not allowed' });
    if (!requireLocalApiAccess(req, res)) return true;
    const abs = profileAssetFilePath(assetProfile, pathname);
    if (!abs || !fs.existsSync(abs)) return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(abs).toLowerCase();
    const data = await fsp.readFile(abs);
    return send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  }
  if (pathname === '/api/health') {
    return send(res, 200, { ok: true, app: 'webhachimi-engine', port: PORT });
  }
  if (pathname === '/api/v2/clipboard-files') {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });
    if (!requireLocalApiAccess(req, res)) return true;
    if (req.headers['x-webhachimi-clipboard-read'] !== '1') {
      return send(res, 403, { ok: false, error: 'clipboard read header required' });
    }
    return send(res, 200, await readClipboardFileResources());
  }
  const projectProfile = PROJECT_PROFILES_BY_ROUTE.get(pathname);
  if (projectProfile && req.method === 'GET') {
    if (!requireLocalApiAccess(req, res)) return true;
    const result = await loadProject(projectProfile.projectFile, projectProfile.projectSeedFile || null);
    return send(res, 200, { ok: true, empty: result.empty, project: result.project });
  }
  if (projectProfile && req.method === 'POST') {
    if (!requireLocalApiAccess(req, res)) return true;
    if (!isJsonRequest(req)) return send(res, 415, { ok: false, error: 'application/json required' });
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8') || '{}');
    } catch (error) {
      return send(res, 400, { ok: false, error: 'invalid json' });
    }
    const project = payload.project || payload;
    if (!project || typeof project !== 'object') return send(res, 400, { ok: false, error: 'missing project' });
    if (!isV2Project(project)) {
      return send(res, 400, { ok: false, error: 'invalid v2 project payload' });
    }
    return send(res, 200, await saveProfileProject(project, projectProfile));
  }
  if (projectProfile) {
    return send(res, 405, { ok: false, error: 'method not allowed' });
  }
  if ((pathname === '/api/project' || pathname === '/api/scene') && req.method === 'GET') {
    if (!requireLocalApiAccess(req, res)) return true;
    const result = await loadProject();
    return send(res, 200, { ok: true, empty: result.empty, project: result.project, scene: result.project });
  }
  if ((pathname === '/api/project' || pathname === '/api/save') && req.method === 'POST') {
    if (!requireLocalApiAccess(req, res)) return true;
    if (!isJsonRequest(req)) return send(res, 415, { ok: false, error: 'application/json required' });
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
  if (pathname === '/') return send(res, 302, null, { Location: DEFAULT_ENTRY_PATH });
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const normalizedRel = rel.replace(/\\/g, '/');
  const builtAbs = builtStaticPath(normalizedRel);
  if (!builtAbs && BUILT_APP_FILES.has(normalizedRel)) {
    return send(res, 503, buildMissingMessage(normalizedRel), { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (!builtAbs && !isAllowedStaticPath(normalizedRel)) return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  if (!builtAbs && normalizedRel.startsWith('resources/') && !hasLocalApiToken(req)) {
    return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (!builtAbs && normalizedRel.startsWith('games/hachimi-nanbei-lvdong/resources/') && !hasLocalApiToken(req)) {
    return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const abs = builtAbs || safeJoin(rel);
  if (!abs) return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  if (!fs.existsSync(abs)) return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  const stat = await fsp.stat(abs);
  if (stat.isDirectory()) return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  const ext = path.extname(abs).toLowerCase();
  const data = await fsp.readFile(abs);
  return send(res, 200, data, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': staticCacheControl(normalizedRel, Boolean(builtAbs)),
  });
}

function buildMissingMessage(entry) {
  return [
    'WebHachimi production build is missing for ' + entry + '.',
    'Run `npm run build` before `npm run serve`, or use `npm run dev:editor` for source-mode development.',
  ].join('\n');
}

function staticCacheControl(rel, built) {
  if (built && rel.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'no-store';
}

function builtStaticPath(rel) {
  if (!isSafeStaticRel(rel)) return null;
  if (BUILT_APP_FILES.has(rel)) {
    const abs = path.join(DIST_V2_DIR, rel);
    return fs.existsSync(abs) ? abs : null;
  }
  if (!rel.startsWith('assets/') || !isAllowedBuiltAssetPath(rel)) return null;
  const abs = path.resolve(DIST_V2_DIR, rel);
  const relative = path.relative(DIST_V2_DIR, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return fs.existsSync(abs) ? abs : null;
}

function isAllowedStaticPath(rel) {
  if (!isSafeStaticRel(rel)) return false;
  if (ROOT_STATIC_FILES.has(rel)) return true;
  if (rel.startsWith('resources/')) return isAllowedAssetPath(rel);
  if (rel.startsWith('games/hachimi-nanbei-lvdong/resources/')) return isAllowedAssetPath(rel, 'games/hachimi-nanbei-lvdong/resources/');
  return false;
}

function isSafeStaticRel(rel) {
  return Boolean(rel) && !rel.includes('\0') && !rel.split('/').some((part) => part.startsWith('.'));
}

function isAllowedBuiltAssetPath(rel) {
  const ext = path.extname(rel).toLowerCase();
  return Boolean(MIME[ext]) && !rel.slice('assets/'.length).includes('/');
}

function isAllowedAssetPath(rel, prefix = 'resources/') {
  const ext = path.extname(rel).toLowerCase();
  return Boolean(MIME[ext]) && !rel.slice(prefix.length).includes('/');
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
  const url = 'http://localhost:' + PORT + DEFAULT_ENTRY_PATH;
  console.log('WebHachimi Engine running at ' + url);
  if (!process.env.WEBHACHIMI_NO_BROWSER) {
    openBrowserUrl(url);
  }
});

function openBrowserUrl(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(command, args, { windowsHide: true }, () => {});
}
