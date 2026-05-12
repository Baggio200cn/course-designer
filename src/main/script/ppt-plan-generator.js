/**
 * ppt-plan-generator.js — AI 驱动的 PPT 页面规划生成器（Phase-5C PPT 重构）
 *
 * 职责：
 *   1. 接收正式讲稿 + 课程信息，调用 AI 生成结构化 PPT 页面规划（JSON）
 *   2. 每页包含：pageType / title / subtitle / keyContent / speakerNotes / needImage / sourceSection
 *   3. 合并到现有 page 数据结构，保留已有图片字段
 *
 * 约束：
 *   - 使用 prompts/ppt-plan.md 作为 system prompt（符合 H5）
 *   - 不修改 quality.js / contracts.js（符合 H3 / H1）
 *   - 单函数文件，无副作用，可独立测试
 *
 * 输出结构（每个 page 对象）：
 *   {
 *     id, pageKey, pageNumber, pageType, title, subtitle,
 *     keyContent, speakerNotes, needImage, sourceSection,
 *     summary, narrativeGoal, keyContent (joined string),
 *     imageModel, imageAspect, imageQuality, imagePrompt, imagePath, imageUrl
 *   }
 */

const fs = require('fs');
const path = require('path');

// Phase-7.6 R7：走统一 prompt 装配器（H12）
const { buildPptPlanSystemFragments, buildPptPlanSystemPromptLegacy } = require('../agent/builders/ppt-plan.builder');
const { assembleWithBaseline } = require('../agent/prompt-assembler');

// Prompt 装配器开关：true 走 fragment 装配（默认）；false 回退到 prompts/ppt-plan.md 原文
// 应急回滚：把这个常量改为 false
const USE_ASSEMBLER = true;

const PPT_FIXED_IMAGE_MODEL = 'seedream';
const PROMPT_DIR = path.join(__dirname, '../../../prompts');

/** 加载 prompt 文件（复用 prompt-registry 的最小版本逻辑） */
function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

/**
 * 将 AI 返回的 pages 数组映射为系统标准 page 对象，合并保留已有图片字段。
 *
 * @param {Object} aiPage - AI 返回的单个 page 对象
 * @param {number} index - 页面序号（0-based）
 * @param {Object} prevPage - 精确匹配到的已有 page 对象（仅用于保留图片，不传 index-fallback）
 * @param {string} imageAspect - 图片比例
 * @param {string} imageQuality - 图片质量
 * @param {string} resolvedId - 已由调用方保证唯一的 id
 * @returns {Object} 标准 page 对象
 */
function mergeAiPageWithPrev(aiPage, index, prevPage, imageAspect, imageQuality, resolvedId, courseContext) {
  const prev = prevPage || {};
  const keyContent = Array.isArray(aiPage.keyContent)
    ? aiPage.keyContent
    : String(aiPage.keyContent || '').split(/\n/).filter(Boolean);

  const needImage = typeof aiPage.needImage === 'boolean' ? aiPage.needImage : true;
  const pageType = String(aiPage.pageType || '内容页');
  const title = String(aiPage.title || `第${index + 1}页`).slice(0, 24);

  // Phase-7.6 R4：强制为 needImage 页面生成 imagePrompt
  // 优先级：AI 输出 > 上一版保留 > 自动构造 fallback
  // 不允许 needImage=true 但 imagePrompt 为空——会让深度配图流水线静默跳过
  let imagePrompt = String(aiPage.imagePrompt || prev.imagePrompt || '').trim();
  if (needImage && !imagePrompt) {
    imagePrompt = _buildFallbackImagePrompt({
      pageType, title,
      subtitle: String(aiPage.subtitle || ''),
      keyContent,
      courseName: courseContext?.courseName || '',
      sourceSection: String(aiPage.sourceSection || ''),
    });
  }

  return {
    id: resolvedId || `ppt-plan-${index + 1}`,
    pageKey: prev.pageKey || `plan-${index + 1}`,
    pageNumber: index + 1,
    pageType,
    title,
    subtitle: String(aiPage.subtitle || prev.subtitle || ''),
    summary: keyContent.slice(0, 2).join('；') || '',
    speakerNotes: String(aiPage.speakerNotes || prev.speakerNotes || ''),
    sourceSection: String(aiPage.sourceSection || ''),
    narrativeGoal: '帮助学生完成这一页的核心理解与动作。',
    keyContent: keyContent.join('\n'),
    visual: '辅助理解的课堂视觉图',
    layout: '标题 + 信息块',
    moduleId: prev.moduleId || '',
    needImage,
    imageModel: prev.imageModel || PPT_FIXED_IMAGE_MODEL,
    imageAspect: prev.imageAspect || imageAspect || '16:9',
    imageQuality: prev.imageQuality || imageQuality || 'low',
    imagePrompt,
    imagePath: prev.imagePath || '',
    imageUrl: prev.imageUrl || ''
  };
}

/**
 * Phase-7.6 R5：构造讲稿章节锚点段，让 AI 把每页 PPT 显式对应到讲稿章节
 *
 * 输出格式（注入到 userPrompt）：
 *   ## 讲稿章节锚点
 *   PPT 每页必须明确标注对应的讲稿章节（用 sourceSection 字段）：
 *   - 章节1：开场导入（关键点：xx、xx）
 *   - 章节2：模块1 xxx（关键点：xx）
 *   - ...
 *
 * 缺数据时返回空字符串（不强行注入空内容，避免 prompt 噪音）
 */
function _buildSectionAnchorBlock(lectureSections, lectureSectionSummary) {
  if (Array.isArray(lectureSections) && lectureSections.length > 0) {
    const lines = lectureSections.slice(0, 12).map((s, i) => {
      const heading = String(s.heading || '').trim() || `章节${i + 1}`;
      const keyPoints = Array.isArray(s.keyPoints) && s.keyPoints.length
        ? `（关键点：${s.keyPoints.slice(0, 2).join('、')}）`
        : '';
      return `- ${heading}${keyPoints}`;
    });
    return [
      `## 讲稿章节锚点（PPT 页面必须对应）`,
      `PPT 每页的 sourceSection 字段必须严格对应下列讲稿章节之一，不允许虚构或偏题：`,
      ...lines,
    ].join('\n');
  }
  if (typeof lectureSectionSummary === 'string' && lectureSectionSummary.length > 10) {
    return [
      `## 讲稿章节锚点`,
      `PPT 页面 sourceSection 必须对应下列章节：`,
      lectureSectionSummary,
    ].join('\n');
  }
  return '';   // 缺数据时不注入，避免空标题噪音
}

/**
 * Phase-7.6 R4：当 AI 没生成 imagePrompt 时的 fallback 构造器
 * 基于页面元数据 + 课程上下文构造合理的图片 prompt
 */
function _buildFallbackImagePrompt({ pageType, title, subtitle, keyContent, courseName, sourceSection }) {
  const parts = [];
  // 类型化前缀
  if (pageType.includes('封面') || pageType.includes('cover')) {
    parts.push(`${courseName || '课程'}封面图`);
  } else if (pageType.includes('总结') || pageType.includes('summary')) {
    parts.push(`${courseName || '课程'}总结概念图`);
  } else if (pageType.includes('路线图') || pageType.includes('roadmap')) {
    parts.push(`${courseName || '课程'}模块路线图，分阶段展示`);
  } else {
    parts.push(`教学场景图：${title}`);
  }
  if (subtitle) parts.push(`，副标题"${subtitle}"`);
  if (Array.isArray(keyContent) && keyContent.length > 0) {
    parts.push(`，关键内容：${keyContent.slice(0, 2).join('、')}`);
  }
  if (sourceSection) parts.push(`，对应讲稿章节"${sourceSection}"`);
  parts.push('，专业教学风格，配色协调，构图清晰，避免堆砌文字');
  return parts.join('');
}

/**
 * 用 AI 生成 PPT 页面规划
 *
 * @param {Object} params
 * @param {string}   params.lectureScript   - 正式讲稿全文
 * @param {string}   params.courseName      - 课程名称
 * @param {number}   params.totalHours      - 课时数
 * @param {Array}    [params.modules]       - 教学模块列表
 * @param {Object}   params.aiClient        - AI 客户端（需有 chatJson 方法）
 * @param {Array}    [params.prevPages]     - 现有 page 数据（用于保留图片）
 * @param {string}   [params.imageAspect]   - 图片比例（默认 '16:9'）
 * @param {string}   [params.imageQuality]  - 图片质量（默认 'low'）
 *
 * @returns {Promise<{
 *   pages: Array,       // 合并后的完整 page 对象数组
 *   rawPlan: Object,    // AI 返回的原始 JSON
 *   pageCount: number   // 生成页数
 * }>}
 */
async function generatePptPlan(params) {
  const {
    lectureScript,
    courseName,
    totalHours = 1,
    modules = [],
    aiClient,
    prevPages = [],
    imageAspect = '16:9',
    imageQuality = 'low',
    // Phase-7.6 R5：跨阶段上下文（来自 buildPptContext，包含讲稿章节摘要）
    lectureSections = [],          // [{ heading, keyPoints }, ...]
    lectureSectionSummary = '',     // 紧凑字符串版本
  } = params;

  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    throw new Error('未提供有效的 AI 客户端');
  }
  if (!lectureScript || !lectureScript.trim()) {
    throw new Error('讲稿内容为空，无法生成 PPT 规划');
  }

  // Phase-7.6 R7：走统一 prompt 装配器（H12）
  // 关闭 USE_ASSEMBLER 可一键回退到 loadPrompt('ppt-plan') 原文
  const systemPrompt = USE_ASSEMBLER
    ? assembleWithBaseline(
        buildPptPlanSystemFragments({
          totalHours,
          hasLectureSections: Array.isArray(lectureSections) && lectureSections.length > 0,
        }),
        { stage: 'ppt' }
      )
    : buildPptPlanSystemPromptLegacy();

  // 构建用户消息：包含讲稿和课程基本信息
  const modulesSummary = Array.isArray(modules) && modules.length
    ? modules.map((m, i) => `模块${i + 1}：${m.name || ''}（${(m.knowledgePoints || []).length}个知识点）`).join('；')
    : '（无模块信息）';

  // Phase-7.6 R5：构造讲稿章节锚点段
  // 优先使用 lectureSections（结构化），其次 lectureSectionSummary（字符串）
  const sectionAnchorBlock = _buildSectionAnchorBlock(lectureSections, lectureSectionSummary);

  const userPrompt = [
    `## 课程信息`,
    `- 课程名称：${courseName || '未命名课程'}`,
    `- 课时数：${totalHours} 学时`,
    `- 教学模块：${modulesSummary}`,
    '',
    sectionAnchorBlock,                // R5：注入讲稿章节锚点（PPT 页面必须对应到具体章节）
    '',
    `## 正式讲稿`,
    String(lectureScript).slice(0, 12000) // 防止超 token
  ].filter(Boolean).join('\n');

  // 调用 AI，要求返回 JSON
  // Phase-7.7 D3（2026-04-30）：maxTokens 6000 → 16000
  // 终端日志显示 14 页规划 JSON 被截断（截断位置 5321），6000 token 装不下：
  //   每页约 200-300 token（含 speakerNotes 80-120 字）× 14 页 ≈ 4000-4500 token
  //   再加上模板说明、示例 → 单段 6000 容易越界
  // 16000 token 给足缓冲，且非 reasoning model（doubao-1.5-pro）成本可控。
  const rawText = await aiClient.chatJson({
    systemPrompt,
    userPrompt,
    temperature: 0.3,
    maxTokens: 16000
  });

  // 解析 JSON（含截断自动修复）
  let rawPlan;
  try {
    // chatJson 返回字符串，可能带 markdown 代码块
    let cleaned = String(rawText || '')
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    // 尝试直接解析
    try {
      rawPlan = JSON.parse(cleaned);
    } catch (_firstErr) {
      // JSON 被截断时自动修复：找到最后一个完整的 page 对象结尾 }，截断后补齐结构
      // 策略：找到最后一个 "}" 后跟 "]" 或 "}" 的位置
      const lastCompletePageEnd = cleaned.lastIndexOf('},\n    {');
      const lastSinglePageEnd = cleaned.lastIndexOf('}\n  ]');
      const cutAt = Math.max(lastCompletePageEnd, lastSinglePageEnd);
      if (cutAt > 100) {
        // 截到最后一个完整 page，补齐 JSON 结构
        const partial = cleaned.slice(0, cutAt + 1);
        const repaired = partial + '\n  ]\n}';
        console.warn('[ppt-plan-generator] JSON 截断，已自动修复（截断位置：', cutAt, '）');
        rawPlan = JSON.parse(repaired);
      } else {
        throw new Error(`AI 返回的 PPT 规划 JSON 解析失败：${_firstErr.message}\n原始内容：${String(rawText || '').slice(0, 200)}`);
      }
    }
  } catch (parseErr) {
    throw new Error(`AI 返回的 PPT 规划 JSON 解析失败：${parseErr.message}\n原始内容：${String(rawText || '').slice(0, 200)}`);
  }

  // 校验结构
  if (!rawPlan || !Array.isArray(rawPlan.pages) || rawPlan.pages.length === 0) {
    throw new Error('AI 返回的 PPT 规划结构不正确（缺少 pages 数组或为空）');
  }

  // 将 AI 返回的 pages 映射为标准结构，保留现有图片数据
  // 关键：用 claimedIds 防止同一个 prev page 被多个 AI 页面引用，导致 id 重复（双选 bug）
  const claimedIds = new Set();
  const usedIds = new Set(); // 最终分配 id 的全局去重

  const pages = rawPlan.pages.map((aiPage, index) => {
    // 优先：通过 pageType + title 精确匹配，且该 prev 尚未被其他 AI 页面 claim
    let prev = null;
    const exactMatch = prevPages.find(
      (p) => p.pageType === aiPage.pageType && p.title === aiPage.title && !claimedIds.has(p.id)
    );
    if (exactMatch) {
      prev = exactMatch;
      claimedIds.add(exactMatch.id);
    }
    // 注意：不再使用 prevPages[index] 作为 fallback，
    // 因为它会与 exactMatch 冲突，导致同一 prev.id 被两个 AI 页面继承

    // 确保最终 id 在本次生成中唯一
    let candidateId = prev?.id || `ppt-plan-${index + 1}`;
    if (usedIds.has(candidateId)) {
      candidateId = `ppt-plan-${index + 1}`;
      // 若还是重复（极端情况），加时间戳后缀
      if (usedIds.has(candidateId)) candidateId = `ppt-plan-${index + 1}-${Date.now()}`;
    }
    usedIds.add(candidateId);

    return mergeAiPageWithPrev(aiPage, index, prev, imageAspect, imageQuality, candidateId, { courseName });
  });

  console.log(`[ppt-plan-generator] 生成 ${pages.length} 页 PPT 规划（课时=${totalHours}，目标=${totalHours <= 1 ? '8-12' : totalHours <= 2 ? '14-18' : '22-30'}页）`);

  return {
    pages,
    rawPlan,
    pageCount: pages.length
  };
}

module.exports = { generatePptPlan };
