/**
 * research.service.js — AI 课程研究建议服务（Phase-5B）
 *
 * 功能：根据教师填写的课程基本信息，调用 AI（doubao/deepseek）
 * 从知识库中合成课程设计参考建议，包括：
 *   - 推荐的具体软件工具
 *   - 对应的职业岗位
 *   - 行业应用场景
 *   - 适用的课程标准 / 教材
 *   - 学情建议
 *
 * 设计原则：
 *   - 双模式：mode='ai'（知识库，默认）/ mode='search'（预留，联网就绪时启用）
 *   - 纯服务层，不依赖 ipcMain，不操作 DB
 *   - 所有 AI 调用通过传入的 aiClient 完成，与 abc-generator.js 保持一致
 */

const RESEARCH_SYSTEM_PROMPT = `你是职业院校课程设计顾问。根据教师提供的课程信息，生成具体可用的课程设计参考建议。

输出要求：
1. 只输出合法 JSON，不要 Markdown 代码块，不要解释文字。
2. 建议必须具体、可操作，禁止空话套话。
3. 软件工具必须写真实软件名+版本号（如"Blender 4.x"），禁止写"三维软件"等泛指。
4. 职业岗位必须是真实存在的职业名称（对应国家职业分类目录）。
5. 课程标准必须引用真实存在的文件名称。`;

/**
 * 构建研究建议的 user prompt
 * @param {Object} courseInfo
 * @returns {string}
 */
function buildResearchPrompt(courseInfo) {
  const lines = [
    '<task>',
    '根据以下课程信息，生成课程设计参考建议。',
    '</task>',
    '',
    '<course_info>',
    `课程名称：${courseInfo.name || courseInfo.courseName || ''}`,
    `课程代码：${courseInfo.courseCode || ''}`,
    `总学时：${courseInfo.totalHours || ''}（理论${courseInfo.theoryHours || 0}，实践${courseInfo.practiceHours || 0}）`,
    `授课对象：${courseInfo.grade || ''}`,
    `先修课程：${courseInfo.prerequisite || ''}`,
    `课程描述：${courseInfo.description || ''}`,
    courseInfo.softwareTools ? `教师已填写的软件工具：${courseInfo.softwareTools}` : '',
    courseInfo.jobTargets ? `教师已填写的岗位：${courseInfo.jobTargets}` : '',
    '</course_info>',
    '',
    '<output_schema>',
    '返回 JSON 对象，结构如下：',
    '{',
    '  "softwareTools": {',
    '    "primary": "主要软件工具（名称+版本）",',
    '    "secondary": ["辅助工具1", "辅助工具2"],',
    '    "reason": "为什么选这些工具（1-2句）"',
    '  },',
    '  "jobTargets": {',
    '    "main": ["主要岗位1", "主要岗位2"],',
    '    "related": ["关联岗位1"],',
    '    "certifications": ["对应证书/资格（如有）"]',
    '  },',
    '  "industryScenarios": {',
    '    "primary": "核心应用场景（1-2句）",',
    '    "examples": ["具体场景案例1", "具体场景案例2"]',
    '  },',
    '  "courseStandards": {',
    '    "national": "适用的国家/行业课程标准名称（如无则填null）",',
    '    "textbooks": ["推荐教材1（作者，出版社，版次）", "推荐教材2"],',
    '    "references": ["参考资源1", "参考资源2"]',
    '  },',
    '  "learnerProfile": {',
    '    "priorKnowledge": "学生通常具备的已有知识",',
    '    "commonDifficulties": "该类课程学生最常见的学习困难",',
    '    "teachingSuggestion": "针对学情的教学策略建议（1-2句）"',
    '  },',
    '  "summary": "一句话概括本课程的核心定位"',
    '}',
    '</output_schema>'
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * 解析 AI 返回的研究建议 JSON
 * @param {string} text
 * @returns {Object|null}
 */
function parseResearchResult(text) {
  try {
    const jsonMatch =
      text.match(/```json\s*([\s\S]*?)\s*```/) ||
      text.match(/```\s*([\s\S]*?)\s*```/);
    const raw = jsonMatch ? jsonMatch[1] : text.trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 生成课程研究建议
 *
 * @param {Object} options
 * @param {Object} options.courseInfo - 课程基本信息（来自 notebook）
 * @param {Object} options.aiClient - AI 客户端（需实现 chatJson 或 chat 方法）
 * @param {string} [options.mode='ai'] - 'ai'=知识库建议，'search'=联网（预留）
 * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
 */
async function generateResearchSuggestions({ courseInfo = {}, aiClient = null, mode = 'ai' }) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    return { success: false, error: '未提供有效的 AI 客户端' };
  }

  const userPrompt = buildResearchPrompt(courseInfo);

  try {
    // ArkCourseClient.chatJson 返回字符串，需要自行解析
    const text = await aiClient.chatJson({
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      userPrompt,
      temperature: 0.4,
      maxTokens: 2000
    });

    const parsed = parseResearchResult(String(text || ''));
    if (!parsed) {
      return { success: false, error: 'AI 返回内容无法解析为 JSON，请重试' };
    }
    return { success: true, data: parsed, mode };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { generateResearchSuggestions };
