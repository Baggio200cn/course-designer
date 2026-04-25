/**
 * review.service.js — AI 讲稿质量审核 + 自动修订服务（Phase-5B Layer 2）
 *
 * 功能：对已生成的正式讲稿做 AI 质量审核，发现问题后自动修订一次。
 * 解决的核心问题：
 *   1. 讲稿中仍然存在通用占位语言（"三维设计软件"、"相关案例"等）
 *   2. 内容与课程主题不匹配（错误的上下文残留）
 *   3. 开场/收束是模板套话，与本课内容无关
 *   4. 操作步骤太笼统，缺乏具体细节
 *
 * 使用方式：
 *   const { reviewAndRevise } = require('./review.service');
 *   const result = await reviewAndRevise({ script, notebookContext, aiClient });
 *   // result.revised 是修订后的讲稿（若 shouldRevise=true）
 *
 * 约束：
 *   - 本服务是独立于 quality.js 的 AI 审核层，quality.js 保持纯函数不变（H3 约束）
 *   - 只做一轮修订（避免无限循环）
 *   - 修订失败时静默返回原稿，不抛错到外层
 */

// ── 审核 Prompt ──────────────────────────────────────────────────────────────

const REVIEW_SYSTEM_PROMPT = `你是中职课程讲稿质量审核专家。对提供的讲稿做结构化质量审核，找出具体问题并给出修订建议。

审核维度：
1. 具体性：讲稿中是否有"相关软件"、"某工具"、"具体软件名"、"【此处填入】"等泛指占位，而非真实软件/工具名称
2. 一致性：讲稿内容是否与课程主题匹配（如课程是三维建模，讲稿中不应出现大量服饰搭配内容）
3. 开场质量：开场导入是否与本课主题直接相关（通用套话不算）
4. 操作可执行性：凡涉及软件操作，是否有具体步骤/菜单路径/快捷键（不能只说"打开软件""点击工具"）
5. 垃圾句：是否含有"这一段先把XX讲透"、"第X段必须"等写作指令残留

输出格式：JSON，严格遵循 schema，不要 Markdown 代码块，不要解释文字。`;

function buildReviewPrompt(script, notebookContext = {}) {
  const contextLines = [
    notebookContext.softwareTools ? `- 课程使用的具体软件：${notebookContext.softwareTools}` : '',
    notebookContext.jobTargets ? `- 目标职业岗位：${notebookContext.jobTargets}` : '',
    notebookContext.industryScenarios ? `- 行业场景：${notebookContext.industryScenarios}` : ''
  ].filter(Boolean);

  return [
    '<task>审核下面的讲稿，输出结构化评分和问题清单。</task>',
    '',
    contextLines.length > 0 ? `<course_context>\n${contextLines.join('\n')}\n</course_context>` : '',
    '',
    '<script_to_review>',
    script.slice(0, 6000),  // 限制 token
    '</script_to_review>',
    '',
    '<output_schema>',
    '{',
    '  "score": number,  // 1-10，7分以上可直接使用',
    '  "shouldRevise": boolean,  // score < 7 且有可修订的具体问题时为 true',
    '  "issues": [',
    '    {',
    '      "type": "placeholder|topic_mismatch|generic_opening|missing_steps|garbage_sentence",',
    '      "location": "问题所在位置（模块名或开头几个字）",',
    '      "text": "有问题的原文（≤30字）",',
    '      "fix": "具体修改建议（≤50字）"',
    '    }',
    '  ],',
    '  "summary": "一句话总结主要问题"',
    '}',
    '</output_schema>'
  ].filter(s => s !== null).join('\n');
}

// ── 修订 Prompt ──────────────────────────────────────────────────────────────

const REVISE_SYSTEM_PROMPT = `你是中职课程讲稿修订专家。根据审核意见对讲稿做精准修订，只改有问题的部分，保留好的内容。

修订原则：
1. 把"三维设计软件"类的泛指替换为审核意见中指定的真实软件名
2. 删除开场中与本课无关的套话，替换为与本课主题直接相关的导入
3. 补充缺失的操作步骤（具体菜单/快捷键）
4. 删除所有写作指令残留（"这一段先把XX讲透"等）
5. 不改动已经合格的内容，不增加字数超过原稿的20%

输出：只输出修订后的完整讲稿文本，不要任何解释。`;

function buildRevisePrompt(script, issues, notebookContext = {}) {
  const issueLines = issues
    .slice(0, 6)  // 最多处理6个问题，避免 prompt 过长
    .map((iss, i) => `${i + 1}. [${iss.type}] 位置：${iss.location}；原文：「${iss.text}」；修改建议：${iss.fix}`)
    .join('\n');

  const contextLines = [
    notebookContext.softwareTools ? `使用软件：${notebookContext.softwareTools}` : '',
    notebookContext.jobTargets ? `目标岗位：${notebookContext.jobTargets}` : ''
  ].filter(Boolean).join('；');

  return [
    contextLines ? `<course_context>${contextLines}</course_context>` : '',
    '',
    '<issues_to_fix>',
    issueLines,
    '</issues_to_fix>',
    '',
    '<original_script>',
    script,
    '</original_script>'
  ].filter(Boolean).join('\n');
}

// ── JSON 解析 ────────────────────────────────────────────────────────────────

function parseReviewResult(text) {
  try {
    const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/```\s*([\s\S]*?)\s*```/i);
    const raw = fenced ? fenced[1] : text.trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 审核讲稿，若有问题则自动修订一次
 *
 * @param {Object} options
 * @param {string} options.script - 原始正式讲稿
 * @param {Object} [options.notebookContext] - 课程富上下文（软件/岗位等）
 * @param {Object} options.aiClient - AI 客户端（需实现 chatJson 方法）
 * @param {boolean} [options.autoRevise=true] - 是否在发现问题时自动修订
 * @returns {Promise<{
 *   reviewed: boolean,
 *   score: number,
 *   shouldRevise: boolean,
 *   issues: Array,
 *   summary: string,
 *   revised: string|null,
 *   revised_success: boolean
 * }>}
 */
async function reviewAndRevise({ script, notebookContext = {}, aiClient, autoRevise = true }) {
  const SKIP = {
    reviewed: false, score: 0, shouldRevise: false,
    issues: [], summary: '', revised: null, revised_success: false
  };

  if (!script || !aiClient || typeof aiClient.chatJson !== 'function') return SKIP;

  // ── Step 1: 审核 ──────────────────────────────────────────────────────────
  let reviewData = null;
  try {
    const reviewText = await aiClient.chatJson({
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      userPrompt: buildReviewPrompt(script, notebookContext),
      temperature: 0.1,  // 极低温度，保证审核稳定
      maxTokens: 1200
    });
    reviewData = parseReviewResult(String(reviewText || ''));
  } catch {
    return SKIP;  // 审核失败静默跳过，不影响主流程
  }

  if (!reviewData) return SKIP;

  const score = Number(reviewData.score) || 5;
  const shouldRevise = Boolean(reviewData.shouldRevise) && score < 7;
  const issues = Array.isArray(reviewData.issues) ? reviewData.issues : [];
  const summary = String(reviewData.summary || '');

  const baseResult = { reviewed: true, score, shouldRevise, issues, summary, revised: null, revised_success: false };

  // ── Step 2: 修订（仅当 shouldRevise=true 且 autoRevise=true）────────────
  if (!shouldRevise || !autoRevise || issues.length === 0) {
    return baseResult;
  }

  try {
    const revisedText = await aiClient.chatJson({
      systemPrompt: REVISE_SYSTEM_PROMPT,
      userPrompt: buildRevisePrompt(script, issues, notebookContext),
      temperature: 0.25,
      maxTokens: Math.max(4000, Math.ceil(script.length / 2))  // 修订稿约与原稿等长
    });

    const revised = String(revisedText || '').trim();
    if (revised.length > script.length * 0.5) {
      // 修订稿长度合理（至少是原稿一半），认为修订成功
      return { ...baseResult, revised, revised_success: true };
    }
  } catch {
    // 修订失败，静默返回审核结果
  }

  return baseResult;
}

module.exports = { reviewAndRevise };
