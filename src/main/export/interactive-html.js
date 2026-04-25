const fs = require('fs');

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function collectInteractiveScenes(coursePipeline = {}) {
  return toList(coursePipeline.scenes).filter(
    (scene) => String(scene?.type || '').toLowerCase() === 'interactive'
  );
}

function sanitizeHtml(html) {
  const raw = String(html || '');
  if (!raw.trim()) return '';
  return raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');
}

function buildInteractiveHtml({ notebook, coursePipeline }) {
  const scenes = collectInteractiveScenes(coursePipeline);
  const blocks = scenes.map((scene, idx) => {
    const clean = sanitizeHtml(scene?.content?.html || '');
    const fallback = `<div class="empty">场景 ${idx + 1} 暂无可渲染 HTML 内容，请先补充 interactive 场景内容。</div>`;
    return `
      <section class="scene">
        <h2>互动场景 ${idx + 1}：${scene.title || `互动场景${idx + 1}`}</h2>
        <div class="iframe-wrap">
          <iframe
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            srcdoc="${(clean || fallback)
              .replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')}"></iframe>
        </div>
      </section>
    `;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${notebook?.name || '课程'} 互动内容包</title>
  <style>
    body { margin: 24px; font-family: "Microsoft YaHei", sans-serif; color: #111827; background: #f8fafc; }
    h1,h2 { margin: 0 0 12px; }
    .scene { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .iframe-wrap { border: 1px solid #d1d5db; border-radius: 10px; overflow: hidden; background: #fff; }
    iframe { width: 100%; height: 680px; border: 0; }
    .empty { color: #6b7280; padding: 16px; }
  </style>
</head>
<body>
  <h1>${notebook?.name || '课程'} 互动 HTML 包</h1>
  ${blocks || '<p>暂无 interactive 场景。</p>'}
</body>
</html>`;
}

function exportInteractiveHtml({ notebook, coursePipeline, outputPath }) {
  const html = buildInteractiveHtml({ notebook, coursePipeline });
  fs.writeFileSync(outputPath, html, 'utf8');
  return outputPath;
}

module.exports = {
  exportInteractiveHtml,
  buildInteractiveHtml
};

