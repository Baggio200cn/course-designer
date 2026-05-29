/**
 * lecture-speech-utils.mjs — v4.3.3 Codex 审计第2轮（2026-05-30）
 *
 * 讲稿朗读的纯文本处理工具（ESM，无 React / 无图片 import），便于：
 *   - renderer（Vite ESM）直接 import
 *   - verify 脚本用 await import() 做真实行为单测（不再只字符串扫描）
 */

// 去 markdown 标记，保留可朗读正文
export function cleanScriptForSpeech(text) {
  return String(text || '')
    .replace(/^#+\s*/gm, '')              // 标题井号
    .replace(/\*\*(.*?)\*\*/g, '$1')       // 加粗
    .replace(/^\s*[-•*]\s+/gm, '')         // 列表符号
    .replace(/[#*`>_~|]/g, '')             // 残余 markdown 符号
    .replace(/\n{2,}/g, '\n')              // 多空行
    .trim();
}

/**
 * 超长片段硬切（Codex R2 问题1）：
 *   单句若超过 maxLen 且无句末标点，优先在逗号/顿号/冒号/空格断点切，
 *   实在没有断点就按 maxLen 硬切——保证每片 ≤ maxLen。
 */
export function hardSplit(s, maxLen) {
  const out = [];
  let rest = String(s);
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    const cut = Math.max(
      window.lastIndexOf('，'), window.lastIndexOf('、'),
      window.lastIndexOf('：'), window.lastIndexOf(':'),
      window.lastIndexOf(','), window.lastIndexOf(' '),
    );
    const useCut = cut < maxLen * 0.5 ? (maxLen - 1) : cut;
    out.push(rest.slice(0, useCut + 1).trim());
    rest = rest.slice(useCut + 1);
  }
  if (rest.trim()) out.push(rest.trim());
  return out.filter(Boolean);
}

/**
 * 把讲稿切成 ≤ maxLen 的朗读块（保证上限，顺序与内容不丢）。
 *   一级：按句末标点 + 换行切句
 *   二级：超长句 hardSplit
 *   三级：相邻短句合并到 ≤ maxLen
 */
export function splitScriptIntoChunks(text, maxLen = 180) {
  const clean = cleanScriptForSpeech(text);
  if (!clean) return [];
  const sentences = clean.split(/(?<=[。！？!?；;\n])/).map((s) => s.trim()).filter(Boolean);
  const pieces = [];
  for (const s of sentences) {
    if (s.length <= maxLen) pieces.push(s);
    else pieces.push(...hardSplit(s, maxLen));
  }
  const chunks = [];
  let buf = '';
  for (const p of pieces) {
    if (buf && (buf + p).length > maxLen) { chunks.push(buf); buf = p; }
    else buf += p;
  }
  if (buf) chunks.push(buf);
  return chunks;
}
