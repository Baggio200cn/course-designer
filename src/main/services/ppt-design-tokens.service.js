/**
 * ppt-design-tokens.service.js — PPT 视觉 token AI 推荐（v4.3.0 D1+D2）
 *
 * 替代原 ppt-pipeline-v2.js#inferMainAccentColor 的"6 类正则硬匹配"，
 * 改为调用 AI 实时推荐：
 *   - mainAccentColor: 3-5 个候选 hex + 名字 + 理由（老师挑或自定义）
 *   - imageStylePreset: 推荐 1 个最契合课程的风格 preset
 *
 * 设计原则（H14 反编造）：
 *   - 不再用硬编码正则匹配 6 类课程
 *   - AI 看课程上下文（名/学校/学生画像/行业/软件）自由推
 *   - 老师永远有"自定义 hex"兜底，不被 AI 绑死
 */

const IMAGE_STYLE_PRESETS = [
  { key: 'flat',         name: '🎨 现代扁平化',  desc: '色块分明，线条清晰，专业教育氛围（最常用）' },
  { key: 'illustration', name: '✏️ 插画风',      desc: '柔和手绘感，亲和力强（适合艺术/文创课）' },
  { key: 'realistic',    name: '📸 写实摄影',    desc: '真实场景照片质感（适合工科/操作类课）' },
  { key: 'guochao',      name: '🏮 国潮中式',    desc: '传统纹样配现代色彩（适合国学/传统工艺）' },
  { key: 'minimal',      name: '⚪ 极简留白',    desc: '大量留白 + 单色 + 几何（适合理工/设计课）' },
];

/**
 * AI 推荐主色候选（3-5 个 hex）
 * @returns {Promise<{ candidates: [{ hex, name, reason }], recommended: string }>}
 */
async function suggestAccentColors({ aiClient, courseName, courseContext = {} }) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    // AI 不可用 → 返回安全兜底（5 个常用色），第一个标记为"通用"
    return {
      candidates: [
        { hex: '#2E86DE', name: '深海蓝', reason: '通用安全色，专业沉稳' },
        { hex: '#10B981', name: '健康绿', reason: '清新活力' },
        { hex: '#E91E8C', name: '时尚粉', reason: '时尚/创意/服装' },
        { hex: '#6B21A8', name: '极客紫', reason: '科技/编程' },
        { hex: '#C8102E', name: '中国红', reason: '传统/国潮' },
      ],
      recommended: '#2E86DE',
      _fallback: true,
    };
  }
  const ctxLines = [
    `课程名：${courseName || '（未填）'}`,
    courseContext.industryScenarios ? `行业场景：${courseContext.industryScenarios}` : '',
    courseContext.jobTargets ? `面向岗位：${courseContext.jobTargets}` : '',
    courseContext.learnerProfile ? `学情：${courseContext.learnerProfile}` : '',
    courseContext.softwareTools ? `软件工具：${courseContext.softwareTools}` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt = [
    '你是教学课件视觉设计专家。根据老师提供的课程上下文，推荐 3-5 个最契合的 PPT 整门课主色（accent color）。',
    '',
    '## 输出要求',
    '返回 JSON：{"candidates":[{"hex":"#RRGGBB","name":"色名","reason":"简短理由 ≤ 30 字"}], "recommended":"#RRGGBB"}',
    '',
    '## 选色原则',
    '1. 第 1 个是 AI 最推荐的（最符合课程气质）',
    '2. 候选要差异化（不要 5 个都是蓝色调）',
    '3. hex 要专业感的色（不要太鲜艳/太暗淡）',
    '4. reason 解释为什么这个色契合该课程（不超 30 字）',
    '5. 严禁使用以下不专业色：#FF0000 纯红 / #00FF00 纯绿 / #0000FF 纯蓝',
  ].join('\n');

  const userPrompt = [
    '## 课程上下文',
    ctxLines || '（仅有课程名，请基于课程名气质推荐）',
    '',
    '请返回 3-5 个主色候选 + 推荐 1 个最优。',
  ].join('\n');

  try {
    const rawText = await aiClient.chatJson({ systemPrompt, userPrompt, temperature: 0.4, maxTokens: 800 });
    let parsed;
    try {
      const cleaned = String(rawText || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`AI 返回非合法 JSON：${e.message}`);
    }
    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates
      .filter(c => typeof c?.hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.hex))
      .slice(0, 5)
      .map(c => ({ hex: c.hex.toUpperCase(), name: String(c.name || '').slice(0, 16), reason: String(c.reason || '').slice(0, 60) })) : [];
    if (candidates.length === 0) throw new Error('AI 未返回有效候选');
    const recommended = (parsed?.recommended && /^#[0-9A-Fa-f]{6}$/.test(parsed.recommended)) ? parsed.recommended.toUpperCase() : candidates[0].hex;
    return { candidates, recommended };
  } catch (e) {
    console.warn('[ppt-design-tokens] AI 推主色失败，回退安全色：', e.message);
    return {
      candidates: [
        { hex: '#2E86DE', name: '深海蓝', reason: '通用安全色（AI 推断失败）' },
      ],
      recommended: '#2E86DE',
      _fallback: true,
      _aiError: e.message,
    };
  }
}

/**
 * AI 推荐配图风格 preset（从 5 种里挑 1 个，给出理由）
 * @returns {Promise<{ preset: string, reason: string, allPresets: array }>}
 */
async function suggestImageStyle({ aiClient, courseName, courseContext = {} }) {
  const allPresets = IMAGE_STYLE_PRESETS;
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    return { preset: 'flat', reason: '通用默认（AI 不可用）', allPresets, _fallback: true };
  }
  const ctxLines = [
    `课程名：${courseName || '（未填）'}`,
    courseContext.industryScenarios ? `行业场景：${courseContext.industryScenarios}` : '',
    courseContext.learnerProfile ? `学情：${courseContext.learnerProfile}` : '',
  ].filter(Boolean).join('\n');
  const systemPrompt = [
    '你是教学课件视觉风格顾问。根据课程上下文，从下列 5 种配图风格 preset 里挑 1 个最契合的，并给出理由。',
    '',
    '## 5 种风格 preset',
    ...allPresets.map(p => `- ${p.key}：${p.name} —— ${p.desc}`),
    '',
    '## 输出要求',
    '返回 JSON：{"preset":"key","reason":"理由 ≤ 50 字"}',
    'preset 必须是上面 5 个 key 之一。',
  ].join('\n');
  const userPrompt = ['## 课程上下文', ctxLines || '（仅有课程名）', '', '请挑 1 个 preset。'].join('\n');
  try {
    const rawText = await aiClient.chatJson({ systemPrompt, userPrompt, temperature: 0.3, maxTokens: 300 });
    const cleaned = String(rawText || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);
    const preset = allPresets.find(p => p.key === parsed?.preset)?.key || 'flat';
    const reason = String(parsed?.reason || '').slice(0, 100);
    return { preset, reason, allPresets };
  } catch (e) {
    console.warn('[ppt-design-tokens] AI 推风格失败，回退 flat：', e.message);
    return { preset: 'flat', reason: '通用默认（AI 推断失败）', allPresets, _fallback: true, _aiError: e.message };
  }
}

module.exports = {
  IMAGE_STYLE_PRESETS,
  suggestAccentColors,
  suggestImageStyle,
};
