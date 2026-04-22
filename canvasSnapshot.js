// canvasSnapshot.js —— 把当前画布快照成 PNG 给 AI 看
// 把场景里的对象用 SVG 重绘（不截 DOM，避免 UI 元素污染），
// 然后转成 PNG，连同 serializeForAI 文本描述一起复制到剪贴板。
// 用户可以直接粘贴到 ChatGPT / Claude 这类 vision 模型。
(function (global) {
  'use strict';
  const S = global.State;

  const PADDING = 60;
  const MIN_VIEW = 400;
  const LABEL_FONT = 'bold 14px system-ui, sans-serif';
  const META_FONT = '11px system-ui, sans-serif';

  function shapeBounds(shape) {
    const w = S.getShapeWidth(shape);
    const h = S.getShapeHeight(shape);
    // 简化：旋转后 AABB 用对角线长度近似（保证完全包含）
    const r = (shape.rotation || 0) * Math.PI / 180;
    const cx = shape.x + w * S.getShapePivotX(shape);
    const cy = shape.y + h * S.getShapePivotY(shape);
    const cosA = Math.abs(Math.cos(r));
    const sinA = Math.abs(Math.sin(r));
    const aabbW = w * cosA + h * sinA;
    const aabbH = w * sinA + h * cosA;
    return {
      x: cx - aabbW / 2,
      y: cy - aabbH / 2,
      x2: cx + aabbW / 2,
      y2: cy + aabbH / 2,
      cx: cx, cy: cy,
    };
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  function shapeToSvg(shape) {
    const w = S.getShapeWidth(shape);
    const h = S.getShapeHeight(shape);
    const px = w * S.getShapePivotX(shape);
    const py = h * S.getShapePivotY(shape);
    const rot = shape.rotation || 0;
    const fill = shape.fill || '#9ca3af';
    const stroke = shape.stroke || '#1f2937';
    const sw = Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 1;
    const op = Number.isFinite(shape.opacity) ? shape.opacity : 1;
    // 局部坐标 (0,0)-(w,h)，translate(shape.x,shape.y)，绕 (px,py) 旋转
    const transform = 'translate(' + shape.x + ',' + shape.y + ') rotate(' + rot + ' ' + px + ' ' + py + ')';
    const common = 'fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" opacity="' + op + '"';
    let body = '';
    if (shape.type === 'square') {
      body = '<rect x="0" y="0" width="' + w + '" height="' + h + '" ' + common + ' />';
    } else if (shape.type === 'circle') {
      body = '<ellipse cx="' + (w / 2) + '" cy="' + (h / 2) + '" rx="' + (w / 2) + '" ry="' + (h / 2) + '" ' + common + ' />';
    } else if (shape.type === 'triangle') {
      body = '<polygon points="' + (w / 2) + ',0 0,' + h + ' ' + w + ',' + h + '" ' + common + ' />';
    } else if ((shape.type === 'pen' || shape.type === 'brush') && Array.isArray(shape.points) && shape.points.length) {
      // 局部坐标已经是 0..w,0..h 范围（state 里 points 通常是局部）
      const d = shape.points.map(function (p, i) { return (i ? 'L' : 'M') + p.x + ',' + p.y; }).join(' ');
      const closed = shape.type === 'brush' ? ' Z' : '';
      body = '<path d="' + d + closed + '" ' + common + ' fill="' + (shape.type === 'pen' ? 'none' : fill) + '" />';
    } else {
      // 兜底：画一个虚线 bounding box
      body = '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="none" stroke="' + stroke + '" stroke-width="1" stroke-dasharray="4 3" opacity="0.6" />';
    }
    // 名字标签：在对象左上方
    const label = '<g transform="translate(' + (-rot ? 0 : 0) + ',-6)"><text x="0" y="0" font="' + LABEL_FONT + '" fill="#e5e7eb" stroke="#0f172a" stroke-width="3" paint-order="stroke" font-family="system-ui" font-size="14" font-weight="bold">' + escapeXml(shape.name || shape.id) + '</text></g>';
    return '<g transform="' + transform + '">' + body + label + '</g>';
  }

  function buildSceneSvg() {
    const objects = S.state.objects;
    if (!objects.length) {
      // 空场景占位
      return {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect width="600" height="200" fill="#0f172a"/><text x="300" y="100" text-anchor="middle" fill="#94a3b8" font-family="system-ui" font-size="16">（空场景）</text></svg>',
        width: 600, height: 200,
      };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    objects.forEach(function (s) {
      const b = shapeBounds(s);
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x2 > maxX) maxX = b.x2;
      if (b.y2 > maxY) maxY = b.y2;
    });
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const viewW = Math.max(MIN_VIEW, contentW + PADDING * 2);
    const viewH = Math.max(MIN_VIEW, contentH + PADDING * 2);
    const offX = PADDING - minX + (viewW - contentW - PADDING * 2) / 2;
    const offY = PADDING - minY + (viewH - contentH - PADDING * 2) / 2;

    // 网格背景（每 50px 一道淡线，方便 AI 读坐标感）
    const gridStep = 50;
    let grid = '';
    for (let gx = 0; gx < viewW; gx += gridStep) grid += '<line x1="' + gx + '" y1="0" x2="' + gx + '" y2="' + viewH + '" stroke="#1e293b" stroke-width="1" />';
    for (let gy = 0; gy < viewH; gy += gridStep) grid += '<line x1="0" y1="' + gy + '" x2="' + viewW + '" y2="' + gy + '" stroke="#1e293b" stroke-width="1" />';

    const shapes = objects.map(shapeToSvg).join('\n');
    // 信息条
    const info = '<text x="12" y="20" font-family="system-ui" font-size="12" fill="#94a3b8">WebHachimi 场景快照 · ' + objects.length + ' 对象 · ' + new Date().toLocaleString() + '</text>';

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + viewW + '" height="' + viewH + '" viewBox="0 0 ' + viewW + ' ' + viewH + '">' +
      '<rect width="' + viewW + '" height="' + viewH + '" fill="#0f172a"/>' +
      grid +
      '<g transform="translate(' + offX + ',' + offY + ')">' + shapes + '</g>' +
      info +
      '</svg>';

    return { svg: svg, width: viewW, height: viewH };
  }

  async function svgToPngBlob(svgString, scale) {
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = function () {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth * scale;
          canvas.height = img.naturalHeight * scale;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (b) {
            if (!b) reject(new Error('canvas toBlob 失败'));
            else resolve(b);
          }, 'image/png');
        };
        img.onerror = function () { reject(new Error('SVG 图像加载失败')); };
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function buildAiBrief() {
    // 给 AI 的"上下文摘要"，比纯 JSON 易读
    const lines = [];
    lines.push('# WebHachimi 当前场景快照（粘贴给 AI 用）');
    lines.push('');
    lines.push('这是一张"空间化 prompt 画布"：用户在画布上排放几何对象，对象上挂着任务备注。下面给出对象布局和任务清单，请基于此理解用户意图。');
    lines.push('');
    lines.push('## 对象 (' + S.state.objects.length + ')');
    S.state.objects.forEach(function (s) {
      const w = S.getShapeWidth(s), h = S.getShapeHeight(s);
      const tag = '- **' + (s.name || s.id) + '** (' + s.type + ')';
      const meta = ' · ' + Math.round(w) + '×' + Math.round(h) + ' · 位置 (' + Math.round(s.x) + ',' + Math.round(s.y) + ')';
      const role = s.role ? ' · 角色:' + s.role : '';
      const fill = ' · 填色:' + s.fill;
      const rot = s.rotation ? ' · 旋转:' + Math.round(s.rotation) + '°' : '';
      const op = s.opacity != null && s.opacity < 1 ? ' · 不透明度:' + s.opacity : '';
      lines.push(tag + meta + role + fill + rot + op);
    });
    if (S.state.globalTasks && S.state.globalTasks.length) {
      lines.push('');
      lines.push('## 全局任务 (' + S.state.globalTasks.length + ')');
      S.state.globalTasks.forEach(function (t, i) {
        const checked = t.done ? '✅' : '⬜';
        lines.push('' + (i + 1) + '. ' + checked + ' ' + (t.text || '(空)'));
        if (t.attachments && t.attachments.length) {
          t.attachments.forEach(function (a) {
            lines.push('   - 📎 ' + a.name + ' (' + a.mime + ', ' + a.size + 'B)');
          });
        }
      });
    }
    lines.push('');
    lines.push('---');
    lines.push('坐标系：x 向右、y 向下；原点 (0,0) 在画布中心附近。');
    lines.push('随附的 PNG 图是上述对象的视觉布局快照（含 50px 网格 + 对象名称标注）。');
    return lines.join('\n');
  }

  async function copySnapshotToClipboard() {
    const { svg, width, height } = buildSceneSvg();
    const scale = width * height < 600 * 600 ? 2 : 1;
    const pngBlob = await svgToPngBlob(svg, scale);
    const text = buildAiBrief();
    const textBlob = new Blob([text], { type: 'text/plain' });
    if (navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({
        'image/png': pngBlob,
        'text/plain': textBlob,
      });
      await navigator.clipboard.write([item]);
      return { ok: true, width: width, height: height, scale: scale, textBytes: text.length, pngBytes: pngBlob.size };
    }
    // 退化：仅复制文本
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return { ok: true, partial: true, textBytes: text.length };
    }
    throw new Error('剪贴板 API 不可用');
  }

  async function downloadSnapshotPng() {
    const { svg, width } = buildSceneSvg();
    const scale = width < 600 ? 2 : 1;
    const blob = await svgToPngBlob(svg, scale);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url; a.download = 'webhachimi-snapshot-' + ts + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  global.CanvasSnapshot = {
    buildSceneSvg: buildSceneSvg,
    buildAiBrief: buildAiBrief,
    copySnapshotToClipboard: copySnapshotToClipboard,
    downloadSnapshotPng: downloadSnapshotPng,
  };
})(window);
