/**
 * reference-filter.service.js
 *
 * 参考资料相关性预过滤层（2026-05-15 老师反馈问题一 B 层修复）
 *
 * 问题背景：
 *   Phase-7.7 E5 引入"强制引用 ≥2 处素材"规则，但缺少主题相关性过滤——
 *   老师贴 4 个 URL 中只要混入 1 个离题素材（如 Adobe 课程目录、Unsplash 协议），
 *   AI 就会被迫引用，造成讲稿偏题。
 *
 * 修法：在 lecture 生成前，用轻量 AI 调用对每条素材打相关性分（0-10），
 *      <5 分的素材在传入 generator 前被剔除。
 *
 * 设计原则：
 *   - 单次调用，所有素材在一个 prompt 里批量评分（节省 token + 网络往返）
 *   - 失败兜底：AI 调用失败时**保留所有素材**（宁可偏题也不要全无）
 *   - 提供详细审计日志（每条素材的评分 + 原因 + 是否保留）
 *   - 阈值可配置（默认 5）
 *
 * H 约束遵守：
 *   - H1: 不动 contracts.js
 *   - H3: 不在 quality.js 调用 AI
 *   - H5: prompt 在 prompts/reference-filter.md
 *   - H12: 不使用 prompt-assembler（这是独立的非生成场景，简单 system + user 即可）
 */

const fs = require('fs');
const path = require('path');

const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

/**
 * 把素材列表压缩成 prompt 友好的字符串
 *
 * @param {Array<{kind, url, filename, content}>} references
 * @returns {string}
 */
function _compactReferences(references) {
  const lines = [];
  references.forEach((r, i) => {
    const head = r.kind === 'url' ? `URL: ${r.url || ''}`
              : r.kind === 'file' ? `File: ${r.filename || ''}`
              : 'Text: 老师粘贴';
    const snippet = String(r.content || '').slice(0, 500).replace(/\s+/g, ' ');  // 单条 500 字摘要够判断
    lines.push(`【素材 ${i + 1}】${head}`);
    lines.push(snippet);
    lines.push('---');
  });
  return lines.join('\n');
}

/**
 * 解析 AI 返回的 JSON
 */
function _parseFilterJson(rawText) {
  const trimmed = String(rawText || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 未返回 JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * 主入口：对一批参考资料做相关性预过滤
 *
 * @param {Object} params
 * @param {Object} params.aiClient       - AI 客户端（需 chatJson）
 * @param {string} params.courseName     - 课程名
 * @param {string} [params.lessonTopic]  - 本节主题（可选，更具体）
 * @param {Array}  params.references     - [{kind, url, filename, content}]
 * @param {number} [params.threshold=5]  - 相关性阈值，低于此分数的素材被剔除
 *
 * @returns {Promise<{
 *   filtered: Array,         // 通过过滤的素材（保留原对象）
 *   dropped: Array,          // 被丢弃的素材 [{ref, relevance, reason}]
 *   audit: Array,            // 所有素材的评分明细 [{idx, ref, relevance, reason, kept}]
 *   warning?: string,        // AI 调用失败时的兜底说明
 * }>}
 */
async function filterByRelevance({
  aiClient,
  courseName,
  lessonTopic = '',
  references = [],
  threshold = 5,
}) {
  // 边界情形：素材 ≤ 1 → 跳过过滤（没有比较意义）
  if (!Array.isArray(references) || references.length <= 1) {
    return {
      filtered: references || [],
      dropped: [],
      audit: (references || []).map((r, i) => ({
        idx: i + 1, ref: r, relevance: 10, reason: '单条素材跳过过滤', kept: true,
      })),
    };
  }

  // 无 AI 客户端 → 兜底返回全保留
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    return {
      filtered: references,
      dropped: [],
      audit: references.map((r, i) => ({
        idx: i + 1, ref: r, relevance: 10, reason: 'AI 客户端不可用，兜底保留', kept: true,
      })),
      warning: 'AI 客户端不可用——已跳过相关性过滤，全部保留',
    };
  }

  const systemPrompt = loadPrompt('reference-filter');
  const refBlock = _compactReferences(references);

  const userPrompt = [
    `## 课程名（核心主题）`,
    courseName || '未命名课程',
    '',
    lessonTopic ? `## 本节主题（更具体）` : '',
    lessonTopic || '',
    '',
    `## 待评判素材（共 ${references.length} 条）`,
    refBlock,
    '',
    `请对每条素材输出 0-10 分相关性评分（按 idx 顺序），严格 JSON 输出。`,
  ].filter(Boolean).join('\n');

  let parsed;
  try {
    const rawText = await aiClient.chatJson({
      systemPrompt,
      userPrompt,
      temperature: 0.1,
      maxTokens: 1500,   // 评分 JSON 不需要多 token
    });
    parsed = _parseFilterJson(rawText);
  } catch (e) {
    // 失败兜底：全保留 + 警告
    console.warn('[reference-filter] AI 调用失败，兜底全保留：', e.message);
    return {
      filtered: references,
      dropped: [],
      audit: references.map((r, i) => ({
        idx: i + 1, ref: r, relevance: 10, reason: 'AI 评分失败，兜底保留', kept: true,
      })),
      warning: `AI 评分失败（${e.message}）——已兜底保留所有素材`,
    };
  }

  // 把评分结果按 idx 映射回原素材
  const filtersByIdx = new Map();
  for (const f of (parsed.filters || [])) {
    if (Number.isInteger(f.idx) && f.idx >= 1 && f.idx <= references.length) {
      filtersByIdx.set(f.idx, {
        relevance: Number(f.relevance) || 0,
        reason: String(f.reason || '').slice(0, 60),
      });
    }
  }

  const audit = references.map((ref, i) => {
    const idx = i + 1;
    const score = filtersByIdx.get(idx);
    if (!score) {
      // AI 漏评分 → 默认保留（宁可错放也不错杀）
      return { idx, ref, relevance: 10, reason: 'AI 未评分，兜底保留', kept: true };
    }
    return {
      idx, ref,
      relevance: score.relevance,
      reason: score.reason,
      kept: score.relevance >= threshold,
    };
  });

  const filtered = audit.filter((a) => a.kept).map((a) => a.ref);
  const dropped = audit.filter((a) => !a.kept).map((a) => ({
    ref: a.ref, relevance: a.relevance, reason: a.reason,
  }));

  // 边界保护：如果全部被丢弃，至少保留最高分那条（防止 AI 把整批打成低分时全无素材）
  if (filtered.length === 0 && audit.length > 0) {
    const highest = [...audit].sort((a, b) => b.relevance - a.relevance)[0];
    filtered.push(highest.ref);
    highest.kept = true;
    return {
      filtered,
      dropped: dropped.filter((d) => d.ref !== highest.ref),
      audit,
      warning: '所有素材相关性都低于阈值，已保留得分最高的那条作为兜底',
    };
  }

  return { filtered, dropped, audit };
}

// ── 自检 ────────────────────────────────────────────────────────────────
function selfCheck() {
  const checks = [];

  checks.push({
    name: 'prompts/reference-filter.md 可加载',
    pass: (() => {
      try { return loadPrompt('reference-filter').length > 100; } catch { return false; }
    })(),
  });

  checks.push({
    name: '单条素材跳过过滤',
    pass: (async () => {
      const r = await filterByRelevance({ aiClient: null, courseName: '测试', references: [{ kind: 'url', url: 'http://a.com', content: 'x' }] });
      return r.filtered.length === 1 && r.dropped.length === 0;
    }),
  });

  return checks;
}

module.exports = {
  filterByRelevance,
  selfCheck,
  // 暴露给 verify
  _internal: { _compactReferences, _parseFilterJson, loadPrompt },
};
