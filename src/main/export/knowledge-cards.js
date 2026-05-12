/**
 * knowledge-cards.js — 知识点卡片 HTML 导出（baoyu-image-cards 思路移植）
 *
 * 职责：
 *   将课程所有模块的知识点生成精美 HTML 卡片汇总页
 *   输出完全自包含的 HTML 文件，可直接在浏览器打开、截图或打印
 *
 * 特点：
 *   - 纯模板方式，不需要额外 AI 调用
 *   - 每个知识点一张卡片，按模块分组
 *   - 设计风格：专业教育风，适合职业院校
 *   - 支持 4 种卡片风格：professional / minimalist / tech / warm
 */

const fs = require('fs');
const path = require('path');

/** HTML 特殊字符转义 */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 根据索引取卡片强调色（轮换4种） */
const ACCENT_COLORS = ['#1B3A6B', '#2E86DE', '#27AE60', '#E67E22'];
const ICON_BG_COLORS = ['#EEF2FF', '#DBEAFE', '#DCFCE7', '#FEF3C7', '#FCE7F3', '#F0FDF4'];

/** 从知识点文本提取 emoji/图标（首字符是 emoji 则用它，否则用序号） */
function getKpIcon(kpText, index) {
  const text = String(kpText || '');
  // 匹配常见 emoji
  const emojiMatch = text.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u);
  if (emojiMatch) return emojiMatch[0];
  return String(index + 1).padStart(2, '0');
}

/** 清理知识点文字（去掉头部 emoji/序号） */
function cleanKpText(kpText) {
  return String(kpText || '').replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u, '').trim();
}

/** 生成单个知识点卡片 HTML */
function renderKnowledgeCard(kpText, kpIndex, moduleIndex, style) {
  const icon = getKpIcon(kpText, kpIndex);
  const text = cleanKpText(kpText);
  const iconBg = ICON_BG_COLORS[(moduleIndex * 3 + kpIndex) % ICON_BG_COLORS.length];
  const accent = ACCENT_COLORS[moduleIndex % ACCENT_COLORS.length];

  // 简单分割：如果知识点文字包含 "：" 或 ":", 前面是标题
  const colonIdx = text.search(/[：:]/);
  let title = text;
  let desc = '';
  if (colonIdx > 0 && colonIdx < 20) {
    title = text.slice(0, colonIdx).trim();
    desc = text.slice(colonIdx + 1).trim();
  }

  return `
    <div class="kp-card" style="border-top: 3px solid ${accent};">
      <div class="kp-card-icon" style="background: ${iconBg}; color: ${accent};">${esc(icon)}</div>
      <div class="kp-card-content">
        <div class="kp-card-title" style="color: ${accent};">${esc(title)}</div>
        ${desc ? `<div class="kp-card-desc">${esc(desc)}</div>` : ''}
      </div>
    </div>`;
}

/** 生成模块块 HTML */
function renderModuleBlock(module, moduleIndex) {
  const kps = Array.isArray(module.knowledgePoints) ? module.knowledgePoints : [];
  const accent = ACCENT_COLORS[moduleIndex % ACCENT_COLORS.length];

  const kpCards = kps.map((kp, kpIdx) => {
    const kpText = typeof kp === 'string' ? kp : (kp.title || kp.name || '');
    return renderKnowledgeCard(kpText, kpIdx, moduleIndex);
  }).join('');

  const descHtml = module.description
    ? `<div class="module-desc">${esc(module.description)}</div>` : '';

  return `
  <section class="module-section">
    <div class="module-header" style="background: ${accent};">
      <span class="module-number">模块 ${moduleIndex + 1}</span>
      <span class="module-name">${esc(module.name || '未命名模块')}</span>
      <span class="module-kp-count">${kps.length} 个知识点</span>
    </div>
    ${descHtml}
    <div class="kp-grid">
      ${kpCards || '<div class="kp-empty">（暂无知识点）</div>'}
    </div>
  </section>`;
}

/** 构建完整 HTML */
function buildHtml({ notebook, modules, style = 'professional' }) {
  const courseName = esc(notebook?.name || '课程');
  const totalKps = modules.reduce((sum, m) => sum + (m.knowledgePoints?.length || 0), 0);
  const now = new Date().toLocaleDateString('zh-CN');

  const moduleBlocks = modules.map((m, i) => renderModuleBlock(m, i)).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${courseName} — 知识点卡片</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif;
    background: #F3F4F8;
    color: #1A1A2E;
    line-height: 1.6;
  }
  /* ── 页面头部 ── */
  .page-header {
    background: linear-gradient(135deg, #1B3A6B 0%, #2E86DE 100%);
    color: #fff;
    padding: 40px 48px 32px;
    position: relative;
    overflow: hidden;
  }
  .page-header::after {
    content: '';
    position: absolute;
    right: -40px; top: -40px;
    width: 240px; height: 240px;
    background: rgba(255,255,255,0.06);
    border-radius: 50%;
  }
  .page-title { font-size: 32px; font-weight: 800; letter-spacing: 1px; }
  .page-subtitle { font-size: 15px; opacity: 0.82; margin-top: 8px; }
  .page-meta {
    display: flex; gap: 24px; margin-top: 20px;
    font-size: 13px; opacity: 0.72;
  }
  .page-meta span { display: flex; align-items: center; gap: 6px; }

  /* ── 内容区 ── */
  .page-content { max-width: 1200px; margin: 0 auto; padding: 40px 24px; }

  /* ── 模块区块 ── */
  .module-section {
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    margin-bottom: 32px;
    box-shadow: 0 2px 12px rgba(27,58,107,0.08);
  }
  .module-header {
    display: flex; align-items: center; gap: 16px;
    padding: 16px 24px;
    color: #fff;
  }
  .module-number {
    font-size: 12px; font-weight: 700;
    background: rgba(255,255,255,0.25);
    padding: 3px 10px; border-radius: 20px;
    white-space: nowrap;
  }
  .module-name { font-size: 18px; font-weight: 700; flex: 1; }
  .module-kp-count {
    font-size: 12px; opacity: 0.85;
    background: rgba(255,255,255,0.18);
    padding: 3px 10px; border-radius: 20px;
  }
  .module-desc {
    padding: 12px 24px;
    font-size: 13px; color: #64748B;
    background: #F8FAFC;
    border-bottom: 1px solid #E2E8F0;
  }

  /* ── 知识点网格 ── */
  .kp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1px;
    background: #E2E8F0;
  }
  .kp-empty { padding: 24px; color: #94A3B8; font-size: 14px; background: #fff; }

  /* ── 知识点卡片 ── */
  .kp-card {
    background: #fff;
    padding: 20px;
    display: flex; align-items: flex-start; gap: 14px;
    transition: background 0.15s;
  }
  .kp-card:hover { background: #FAFBFF; }
  .kp-card-icon {
    width: 42px; height: 42px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 800;
    flex-shrink: 0;
  }
  .kp-card-content { flex: 1; min-width: 0; }
  .kp-card-title {
    font-size: 15px; font-weight: 700;
    line-height: 1.4;
    word-break: break-all;
  }
  .kp-card-desc {
    font-size: 13px; color: #64748B;
    margin-top: 6px; line-height: 1.6;
  }

  /* ── 页脚 ── */
  .page-footer {
    text-align: center; padding: 32px;
    color: #94A3B8; font-size: 13px;
    border-top: 1px solid #E2E8F0;
  }

  /* ── 打印优化 ── */
  @media print {
    body { background: #fff; }
    .page-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .module-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .module-section { break-inside: avoid; box-shadow: none; border: 1px solid #E2E8F0; }
    .kp-card:hover { background: #fff; }
  }
</style>
</head>
<body>

<header class="page-header">
  <div class="page-title">📚 ${courseName}</div>
  <div class="page-subtitle">知识点卡片汇总 — 共 ${modules.length} 个教学模块，${totalKps} 个知识点</div>
  <div class="page-meta">
    <span>🗓 生成日期：${now}</span>
    <span>📂 ${modules.length} 个模块</span>
    <span>🧩 ${totalKps} 个知识点</span>
  </div>
</header>

<main class="page-content">
  ${moduleBlocks}
</main>

<footer class="page-footer">
  优课创 Agent v3.0.0 · 知识点卡片导出 · 可在浏览器中 Ctrl+P 打印或截图保存
</footer>

</body>
</html>`;
}

/**
 * 导出知识点卡片 HTML 文件
 *
 * @param {Object} params
 * @param {Object}   params.notebook   - 笔记本对象
 * @param {Array}    params.modules    - 模块数组（含 knowledgePoints）
 * @param {string}   params.outputPath - 输出文件路径（.html）
 * @param {string}   [params.style]    - 卡片风格（professional | minimalist | tech | warm）
 * @returns {string} 实际写入的文件路径
 */
function exportKnowledgeCards({ notebook, modules, outputPath, style = 'professional' }) {
  if (!outputPath) throw new Error('输出路径不能为空');
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error('没有模块数据，无法生成知识点卡片');
  }

  const html = buildHtml({ notebook, modules, style });
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');

  console.log(`[knowledge-cards] 导出完成：${outputPath}（${modules.length} 模块，${html.length} 字节）`);
  return outputPath;
}

module.exports = { exportKnowledgeCards };
