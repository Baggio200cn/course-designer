/**
 * pptx-parser.service.js — 轻量 .pptx 文字提取（v4.3.0 D3）
 *
 * 方案：jszip 解压 + 提取 ppt/slides/slideN.xml 的 <a:t> 文本节点
 * 不引入新依赖（jszip 已在 node_modules）
 * 不解析图片/动画/版式，仅提取**纯文字**供 AI 学排版/详略
 */

const JSZip = require('jszip');

/**
 * 从 buffer 解析 .pptx，返回每页文字数组
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<{ slides: string[], totalChars: number, slideCount: number }>}
 */
async function parsePptxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  // 提取所有 ppt/slides/slideN.xml（N 排序）
  const slideFiles = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide(\d+)\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] || 0);
      return na - nb;
    });

  const slides = [];
  for (const fname of slideFiles) {
    const xml = await zip.file(fname).async('string');
    // 提取所有 <a:t>...</a:t> 文本（PowerPoint Text Run）
    const texts = [];
    const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const text = m[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
      if (text.trim()) texts.push(text.trim());
    }
    slides.push(texts.join(' · '));
  }
  const totalChars = slides.reduce((s, t) => s + t.length, 0);
  return { slides, totalChars, slideCount: slides.length };
}

/**
 * 转换成给 AI 的"风格参考文本"
 * 包含：总页数 / 每页字数 / 每页 30 字内摘要（让 AI 看排版疏密 + 内容详略，不抄具体文字）
 */
function formatForStyleReference({ slides, slideCount, totalChars }) {
  const lines = [
    `[PPT 风格参考 · 共 ${slideCount} 页 · 总文字量 ${totalChars} 字]`,
    `平均每页 ${Math.round(totalChars / Math.max(1, slideCount))} 字（参考详略密度）`,
    '',
    '─── 每页结构 ───',
  ];
  slides.forEach((s, i) => {
    const preview = s.length > 80 ? s.slice(0, 80) + '…' : s;
    lines.push(`第 ${i + 1} 页（${s.length} 字）：${preview}`);
  });
  return lines.join('\n');
}

module.exports = { parsePptxBuffer, formatForStyleReference };
