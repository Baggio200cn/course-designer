/**
 * context-builder.js — 跨阶段上下文构建器（Phase-5C Step 2）
 *
 * 职责：在生成各阶段内容前，从 DB 读取上游阶段的输出，
 * 构建富上下文对象，注入到当前阶段的 AI prompt 中。
 *
 * 跨阶段注入关系（与 contracts.js 对齐）：
 *   framework  →  lecture : objectives（知识/技能/态度目标）+ teachingMethods
 *   lecture    →  ppt     : finalScript 的章节标题 + 关键知识点摘要
 *   ppt        →  video   : pptPages 标题列表（预留）
 *
 * 约束：
 *   - 纯数据读取 + 字符串构建，无 AI 调用，无副作用
 *   - 返回值是 notebookContext 的扩展字段，生成器通过已有接口消费
 *   - 所有字段都是 optional：上游阶段不存在时返回空字符串，不报错
 */

/**
 * 从框架 content 中提取简洁的目标摘要字符串
 * 格式："知识：A、B；技能：C、D；态度：E"
 *
 * @param {Object} frameworkContent - db.getCurrentFramework().content
 * @returns {string}
 */
function extractObjectivesSummary(frameworkContent) {
  if (!frameworkContent || typeof frameworkContent !== 'object') return '';

  const objectives = frameworkContent.objectives || {};
  const parts = [];

  const knowledge = Array.isArray(objectives.knowledge) ? objectives.knowledge : [];
  const skills = Array.isArray(objectives.skills) ? objectives.skills : [];
  const attitude = Array.isArray(objectives.attitude) ? objectives.attitude : [];

  if (knowledge.length > 0) {
    parts.push(`知识目标：${knowledge.slice(0, 3).join('、')}`);
  }
  if (skills.length > 0) {
    parts.push(`技能目标：${skills.slice(0, 3).join('、')}`);
  }
  if (attitude.length > 0) {
    parts.push(`情感目标：${attitude.slice(0, 2).join('、')}`);
  }

  return parts.join('；');
}

/**
 * 提取框架的主要教学方法
 *
 * @param {Object} frameworkContent
 * @returns {string}
 */
function extractTeachingMethodsSummary(frameworkContent) {
  if (!frameworkContent || typeof frameworkContent !== 'object') return '';
  const methods = frameworkContent.teachingMethods;
  if (!methods) return '';
  if (typeof methods === 'string') return methods;
  if (methods.primary) {
    const secondary = Array.isArray(methods.secondary) && methods.secondary.length > 0
      ? `；辅助：${methods.secondary.slice(0, 2).join('、')}`
      : '';
    return `${methods.primary}${secondary}`;
  }
  return '';
}

/**
 * 从正式讲稿中提取章节摘要（用于 lecture→ppt 注入）
 * 返回格式：[{ heading: '模块1：名称', keyPoints: ['知识点1', '知识点2'] }, ...]
 *
 * @param {string} finalScript - 正式讲稿 Markdown 文本
 * @returns {Array<{ heading: string, keyPoints: string[] }>}
 */
function extractLectureSections(finalScript) {
  if (!finalScript || typeof finalScript !== 'string') return [];

  const lines = finalScript.split(/\r?\n/);
  const sections = [];
  let currentSection = null;
  let narrationLines = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (/^##?\s+/.test(trimmed)) {
      // 保存上一个章节
      if (currentSection) {
        sections.push({
          heading: currentSection,
          // 提取讲述内容的前2句作为 key points（用于 PPT 摘要）
          keyPoints: narrationLines.slice(0, 2).filter((s) => s.length > 8)
        });
      }
      currentSection = trimmed.replace(/^##?\s+/, '').replace(/（[\d\-～～分钟]+）/, '').trim();
      narrationLines = [];
    } else if (/^教师讲述[:：]/.test(trimmed)) {
      // 重置讲述收集
    } else if (currentSection && trimmed && !/^课堂动作|^教师讲述/.test(trimmed) && !trimmed.startsWith('-')) {
      if (trimmed.length > 12) {
        narrationLines.push(trimmed.replace(/[。！？].*/, '').slice(0, 40));
      }
    }
  });

  // 最后一个章节
  if (currentSection) {
    sections.push({
      heading: currentSection,
      keyPoints: narrationLines.slice(0, 2).filter((s) => s.length > 8)
    });
  }

  return sections;
}

/**
 * 为讲稿生成阶段构建上游框架的跨阶段上下文
 *
 * 调用方：lecture.handlers.js 的 script:generateABC 和 script:generateFormal
 *
 * @param {Object} db - 数据库实例
 * @param {number} notebookId
 * @returns {{
 *   frameworkObjectives: string,    // 知识/技能/态度目标摘要
 *   frameworkTeachingMethods: string // 主要教学方法
 * }}
 */
function buildLectureContext(db, notebookId) {
  const empty = { frameworkObjectives: '', frameworkTeachingMethods: '' };

  try {
    const framework = db.getCurrentFramework(notebookId);
    if (!framework) return empty;
    const content = framework.content || framework;
    return {
      frameworkObjectives: extractObjectivesSummary(content),
      frameworkTeachingMethods: extractTeachingMethodsSummary(content)
    };
  } catch {
    return empty;
  }
}

/**
 * 为 PPT 生成阶段构建上游讲稿的跨阶段上下文
 *
 * 调用方：ppt 相关 handler（Phase-5C 后续扩展）
 *
 * @param {Object} db
 * @param {number} notebookId
 * @returns {{
 *   lectureSections: Array,        // 章节摘要列表
 *   lectureSectionSummary: string  // 紧凑字符串版本，用于 prompt 注入
 * }}
 */
function buildPptContext(db, notebookId) {
  const empty = { lectureSections: [], lectureSectionSummary: '' };

  try {
    const finalArtifact = db.getLatestArtifact
      ? db.getLatestArtifact(notebookId, 'lecture_final', 'lecture')
      : null;
    const finalScript = finalArtifact?.content?.finalScript || '';
    if (!finalScript) return empty;

    const sections = extractLectureSections(finalScript);
    const summary = sections
      .map((s) => `${s.heading}${s.keyPoints.length ? '（' + s.keyPoints[0] + '）' : ''}`)
      .join('；');

    return { lectureSections: sections, lectureSectionSummary: summary };
  } catch {
    return empty;
  }
}

module.exports = {
  buildLectureContext,
  buildPptContext,
  extractObjectivesSummary,
  extractTeachingMethodsSummary,
  extractLectureSections
};
