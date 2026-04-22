// sceneIO.js —— 场景 zip 打包/解包
// 自包含 STORE-mode zip 实现（无压缩，仅 CRC32），把 scene.json + assets/* 打成一个文件
// 目的：让场景能 git 友好地存储 —— scene.json 纯文本可 diff，附件作为独立二进制文件
(function (global) {
  'use strict';
  const S = global.State;

  // ===== CRC32 =====
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ===== STORE-mode zip writer =====
  function buildZip(entries) {
    const enc = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const e of entries) {
      const nameBytes = enc.encode(e.name);
      const c = crc32(e.data);
      const sz = e.data.length;
      const local = new Uint8Array(30 + nameBytes.length + sz);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true);   // STORE
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0x21, true); // date stub: 1980-01-01
      dv.setUint32(14, c, true);
      dv.setUint32(18, sz, true);
      dv.setUint32(22, sz, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      local.set(e.data, 30 + nameBytes.length);
      locals.push(local);

      const central = new Uint8Array(46 + nameBytes.length);
      const dvc = new DataView(central.buffer);
      dvc.setUint32(0, 0x02014b50, true);
      dvc.setUint16(4, 20, true);
      dvc.setUint16(6, 20, true);
      dvc.setUint16(8, 0, true);
      dvc.setUint16(10, 0, true);
      dvc.setUint16(12, 0, true);
      dvc.setUint16(14, 0x21, true);
      dvc.setUint32(16, c, true);
      dvc.setUint32(20, sz, true);
      dvc.setUint32(24, sz, true);
      dvc.setUint16(28, nameBytes.length, true);
      dvc.setUint16(30, 0, true);
      dvc.setUint16(32, 0, true);
      dvc.setUint16(34, 0, true);
      dvc.setUint16(36, 0, true);
      dvc.setUint32(38, 0, true);
      dvc.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centrals.push(central);
      offset += local.length;
    }
    const cdSize = centrals.reduce((a, b) => a + b.length, 0);
    const cdOffset = offset;
    const eocd = new Uint8Array(22);
    const dve = new DataView(eocd.buffer);
    dve.setUint32(0, 0x06054b50, true);
    dve.setUint16(4, 0, true);
    dve.setUint16(6, 0, true);
    dve.setUint16(8, entries.length, true);
    dve.setUint16(10, entries.length, true);
    dve.setUint32(12, cdSize, true);
    dve.setUint32(16, cdOffset, true);
    dve.setUint16(20, 0, true);

    const total = offset + cdSize + 22;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of locals) { out.set(p, pos); pos += p.length; }
    for (const p of centrals) { out.set(p, pos); pos += p.length; }
    out.set(eocd, pos);
    return out;
  }

  // ===== STORE-mode zip reader =====
  function readZip(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocdPos = -1;
    const minStart = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= minStart; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocdPos = i; break; }
    }
    if (eocdPos < 0) throw new Error('未找到 zip EOCD（不是合法的 zip）');
    const cdOffset = dv.getUint32(eocdPos + 16, true);
    const totalEntries = dv.getUint16(eocdPos + 10, true);
    const entries = [];
    const dec = new TextDecoder();
    let p = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 中心目录损坏');
      const method = dv.getUint16(p + 10, true);
      if (method !== 0) throw new Error('zip 包含压缩项（仅支持 STORE）');
      const sz = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOffset = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = dv.getUint16(localOffset + 26, true);
      const lExtraLen = dv.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + sz);
      entries.push({ name: name, data: data });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  // ===== mime → ext =====
  function extFromMime(mime, fallbackName) {
    if (typeof mime === 'string') {
      if (mime === 'image/png') return 'png';
      if (mime === 'image/jpeg') return 'jpg';
      if (mime === 'image/gif') return 'gif';
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

  // ===== dataUrl <-> bytes =====
  function dataUrlToBytes(dataUrl) {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return new Uint8Array(0);
    const meta = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    if (meta.indexOf(';base64') >= 0) {
      const bin = atob(body);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    }
    // url-encoded
    const decoded = decodeURIComponent(body);
    return new TextEncoder().encode(decoded);
  }

  function bytesToDataUrl(bytes, mime) {
    const m = mime || 'application/octet-stream';
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return 'data:' + m + ';base64,' + btoa(s);
  }

  // ===== 主流程 =====

  function exportSceneZip() {
    const st = S.state;
    const usedNames = new Set();
    const entries = [];

    // 复制 globalTasks 但替换 dataUrl → path
    function pickPath(att) {
      const ext = extFromMime(att.mime, att.name);
      let base = (att.id || 'asset') + '.' + ext;
      let final = base;
      let n = 1;
      while (usedNames.has(final)) { final = (att.id || 'asset') + '-' + (++n) + '.' + ext; }
      usedNames.add(final);
      return 'assets/' + final;
    }

    function processTaskList(list) {
      return (list || []).map(function (t) {
        const cloneT = JSON.parse(JSON.stringify(t));
        cloneT.attachments = (t.attachments || []).map(function (a) {
          const path = pickPath(a);
          const bytes = dataUrlToBytes(a.dataUrl);
          entries.push({ name: path, data: bytes });
          return { id: a.id, name: a.name, mime: a.mime, size: a.size, path: path };
        });
        return cloneT;
      });
    }

    const sceneObj = {
      kind: 'webhachimi-scene',
      version: 2,
      exportedAt: new Date().toISOString(),
      objects: st.objects,
      globalTasks: processTaskList(st.globalTasks),
      nextId: st.nextId,
      nextTaskId: st.nextTaskId,
      view: st.view,
      ui: { drawerHeight: st.ui.drawerHeight, drawerSplit: st.ui.drawerSplit },
    };
    const sceneText = JSON.stringify(sceneObj, null, 2);
    entries.unshift({ name: 'scene.json', data: new TextEncoder().encode(sceneText) });

    // README 说明
    const readme = '# WebHachimi 场景包\n\n'
      + '- scene.json：场景布局、对象、任务、附件元数据（纯文本，git 友好）\n'
      + '- assets/：附件实体（图片、SVG、JSON）\n\n'
      + '在页面里点「📂 导入」选这个 .zip 即可还原。\n';
    entries.push({ name: 'README.md', data: new TextEncoder().encode(readme) });

    return buildZip(entries);
  }

  async function importSceneFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    if (isZip) return importSceneZipBytes(buf);
    // 否则按 JSON 处理（兼容 v1 单 JSON 格式）
    const text = new TextDecoder().decode(buf);
    return S.importSceneJSON(text);
  }

  function importSceneZipBytes(buf) {
    let entries;
    try { entries = readZip(buf); } catch (e) { return { ok: false, error: 'zip 解析失败：' + e.message }; }
    const sceneEntry = entries.find(function (e) { return e.name === 'scene.json'; });
    if (!sceneEntry) return { ok: false, error: 'zip 内未找到 scene.json' };
    let scene;
    try { scene = JSON.parse(new TextDecoder().decode(sceneEntry.data)); }
    catch (e) { return { ok: false, error: 'scene.json 解析失败：' + e.message }; }
    if (!scene || scene.kind !== 'webhachimi-scene') {
      return { ok: false, error: 'scene.json kind 不正确（必须是 webhachimi-scene）' };
    }

    const assetMap = new Map();
    entries.forEach(function (e) { if (e.name.indexOf('assets/') === 0) assetMap.set(e.name, e.data); });

    function rehydrateTaskList(list) {
      return (list || []).map(function (t) {
        const cloneT = Object.assign({}, t);
        cloneT.attachments = (t.attachments || []).map(function (a) {
          if (a.dataUrl) return a; // 已自带 dataUrl 直接用
          if (!a.path) return a;
          const bytes = assetMap.get(a.path);
          if (!bytes) return Object.assign({}, a, { dataUrl: '' });
          return Object.assign({}, a, { dataUrl: bytesToDataUrl(bytes, a.mime) });
        });
        return cloneT;
      });
    }
    scene.globalTasks = rehydrateTaskList(scene.globalTasks);
    return S.importSceneJSON(JSON.stringify(scene));
  }

  global.SceneIO = {
    exportSceneZip: exportSceneZip,
    importSceneFile: importSceneFile,
  };
})(window);
