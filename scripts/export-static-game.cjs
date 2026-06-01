'use strict';

// Owns static player export packaging for a concrete project profile.
// The exporter consumes an existing Vite game build, embeds project JSON into a
// root-level index.html, and copies referenced resource attachments beside it.
// Exported packages are static-host friendly and do not require the local API.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  HACHIMI_GAME_ENTRY,
  createProjectProfiles,
} = require('../project-profiles.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PROFILE_ID = 'hachimi-nanbei-lvdong';
const DEFAULT_EXPORT_ROOT = path.join(ROOT, 'exports');

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const profiles = createProjectProfiles(ROOT);
  const profile = profiles.find((candidate) => candidate.id === options.profileId);
  if (!profile) throw new Error(`unknown project profile: ${options.profileId}`);

  const entryRel = entryForProfile(profile.id);
  const buildDir = buildDirForProfile(profile.id);
  const outDir = path.resolve(options.outDir || path.join(DEFAULT_EXPORT_ROOT, profile.id));
  assertExportPath(outDir);

  if (!options.skipBuild) runBuild(profile.id);

  const entryPath = path.join(buildDir, entryRel);
  const assetsDir = path.join(buildDir, 'assets');
  if (!fs.existsSync(entryPath)) throw new Error(`missing built game entry: ${entryPath}`);
  if (!fs.existsSync(assetsDir)) throw new Error(`missing built assets directory: ${assetsDir}`);

  const project = await loadProfileProject(profile);
  const resourcesDir = path.join(outDir, 'resources');
  const copiedResources = [];
  const exportedProject = rewriteProjectAttachmentPaths(createStaticRuntimeProject(project), profile, resourcesDir, copiedResources);
  const uniqueResources = uniqueCopiedResources(copiedResources);

  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });
  await copyDir(assetsDir, path.join(outDir, 'assets'));
  await fsp.mkdir(resourcesDir, { recursive: true });
  await copyReferencedResources(uniqueResources);

  const html = await buildExportHtml(entryPath, exportedProject);
  await fsp.writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  await fsp.writeFile(
    path.join(outDir, 'export-manifest.json'),
    JSON.stringify({
      kind: 'webhachimi-static-game-export',
      version: 1,
      profile: profile.id,
      sourceEntry: entryRel,
      resourceCount: uniqueResources.length,
      exportedAt: new Date().toISOString(),
    }, null, 2),
    'utf8',
  );

  console.log(JSON.stringify({
    ok: true,
    profile: profile.id,
    outDir,
    entry: path.join(outDir, 'index.html'),
    resources: uniqueResources.length,
  }, null, 2));
}

function parseArgs(args) {
  const options = {
    profileId: DEFAULT_PROFILE_ID,
    outDir: '',
    skipBuild: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out') {
      if (!args[index + 1] || args[index + 1].startsWith('-')) throw new Error('--out requires a directory');
      options.outDir = args[index + 1] || '';
      index += 1;
    } else if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (!arg.startsWith('-')) {
      options.profileId = arg;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

function entryForProfile(profileId) {
  if (profileId === DEFAULT_PROFILE_ID) return HACHIMI_GAME_ENTRY;
  throw new Error(`profile does not have a static game entry yet: ${profileId}`);
}

function buildDirForProfile(profileId) {
  if (profileId === DEFAULT_PROFILE_ID) return path.join(ROOT, 'dist-hachimi-nanbei-lvdong');
  throw new Error(`profile does not have a game build directory yet: ${profileId}`);
}

function runBuild(profileId) {
  if (profileId !== DEFAULT_PROFILE_ID) throw new Error(`no build command configured for profile: ${profileId}`);
  const viteCli = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteCli)) throw new Error(`missing local Vite CLI: ${viteCli}`);
  execFileSync(process.execPath, [viteCli, 'build', '--mode', 'game'], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
  });
}

function assertExportPath(outDir) {
  const relative = path.relative(ROOT, outDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`export output must stay inside workspace: ${outDir}`);
  }
  const exportRelative = path.relative(DEFAULT_EXPORT_ROOT, outDir);
  if (!exportRelative) {
    throw new Error(`export output must be a child directory of exports/: ${outDir}`);
  }
  if (exportRelative.startsWith('..') || path.isAbsolute(exportRelative)) {
    throw new Error(`export output must stay inside exports/: ${outDir}`);
  }
}

async function loadProfileProject(profile) {
  const candidates = [profile.projectFile, profile.projectSeedFile].filter(Boolean);
  for (const file of candidates) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  throw new Error(`profile has no readable project file: ${profile.id}`);
}

function createStaticRuntimeProject(project) {
  const next = JSON.parse(JSON.stringify(project));
  next.tasks = {};
  next.transactions = {};
  next.testRecords = {};
  next.snapshots = {};
  next.autonomyRuns = {};
  return next;
}

function rewriteProjectAttachmentPaths(project, profile, resourcesDir, copiedResources) {
  const next = JSON.parse(JSON.stringify(project));
  Object.values(next.resources || {}).forEach((resource) => rewriteResourceAttachmentPaths(resource, profile, resourcesDir, copiedResources));
  return next;
}

function rewriteResourceAttachmentPaths(resource, profile, resourcesDir, copiedResources) {
  if (!resource || typeof resource !== 'object' || !Array.isArray(resource.attachments)) return;
  resource.attachments.forEach((attachment) => {
    if (!attachment || typeof attachment !== 'object') return;
    const rawPath = typeof attachment.path === 'string' ? attachment.path.trim() : '';
    if (isEmbeddedOrRemoteAttachmentPath(rawPath)) return;
    const source = resolveAttachmentSource(rawPath, profile);
    if (!source) {
      throw new Error(`unable to resolve attachment for static export: ${attachment.id || resource.id || 'unknown'} -> ${rawPath || '(empty path)'}`);
    }
    const fileName = path.basename(source);
    copiedResources.push({ source, target: path.join(resourcesDir, fileName) });
    attachment.path = `./resources/${fileName}`;
  });
}

function isEmbeddedOrRemoteAttachmentPath(rawPath) {
  return rawPath.startsWith('data:') || /^https?:\/\//i.test(rawPath);
}

function resolveAttachmentSource(rawPath, profile) {
  const normalized = rawPath.replace(/\\/g, '/').split(/[?#]/)[0];
  const urlPath = normalized.startsWith('./') ? normalized.slice(2) : normalized;
  const prefixes = [
    profile.assetUrlPrefix.replace(/^\//, ''),
    profile.assetUrlPrefix,
    'resources',
    '/resources',
  ];
  for (const prefix of prefixes) {
    const cleanPrefix = prefix.replace(/\/$/, '');
    if (urlPath === cleanPrefix || !urlPath.startsWith(`${cleanPrefix}/`)) continue;
    const fileName = urlPath.slice(cleanPrefix.length + 1);
    return safeAssetFile(profile.assetsDir, fileName) || safeWorkspaceFile(path.join(ROOT, 'resources'), fileName);
  }
  return safeAssetFile(profile.assetsDir, path.basename(urlPath));
}

function safeAssetFile(baseDir, fileName) {
  const file = safeWorkspaceFile(baseDir, fileName);
  return file && fs.existsSync(file) ? file : undefined;
}

function safeWorkspaceFile(baseDir, fileName) {
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.startsWith('.')) return undefined;
  const abs = path.resolve(baseDir, fileName);
  const relative = path.relative(baseDir, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return abs;
}

function uniqueCopiedResources(resources) {
  const byTarget = new Map();
  for (const resource of resources) {
    const targetKey = process.platform === 'win32' ? resource.target.toLowerCase() : resource.target;
    const previous = byTarget.get(targetKey);
    if (previous && previous.source !== resource.source) {
      throw new Error(`resource filename collision: ${resource.target}`);
    }
    byTarget.set(targetKey, resource);
  }
  return Array.from(byTarget.values());
}

async function copyReferencedResources(resources) {
  for (const resource of resources) {
    await fsp.mkdir(path.dirname(resource.target), { recursive: true });
    await fsp.copyFile(resource.source, resource.target);
  }
}

async function buildExportHtml(entryPath, project) {
  const original = await fsp.readFile(entryPath, 'utf8');
  const projectJson = escapeScriptJson(JSON.stringify(project));
  const staticExportMeta = '    <meta name="webhachimi-disable-editor-handoff" content="1" />\n';
  const embeddedProject = `    <script type="application/json" data-webhachimi-project>${projectJson}</script>\n`;
  let html = original
    .replaceAll('../../assets/', './assets/')
    .replace(/^\s*<meta name="webhachimi-project-endpoint"[^>]*>\s*\n/gm, '')
    .replace(/^\s*<meta name="webhachimi-sample-resource-base"[^>]*>\s*\n/gm, '')
    .replace(/^\s*<meta name="webhachimi-editor-url"[^>]*>\s*\n/gm, '')
    .replace('</head>', `${staticExportMeta}${embeddedProject}</head>`);
  if (!html.includes('data-webhachimi-project')) throw new Error('failed to embed project json');
  return html;
}

function escapeScriptJson(json) {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function copyDir(source, target) {
  await fsp.mkdir(target, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else if (entry.isFile()) await fsp.copyFile(from, to);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
