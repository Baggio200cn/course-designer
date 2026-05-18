/**
 * lecture-from-ppt-generator.js — PPT 驱动的讲稿生成器（v4.2.0 Phase A'-5 新建）
 *
 * 背景：
 *   v4.2.0 工作流顺序改为 schedule → design → PPT → 讲稿 → video → report
 *   老师原话："讲稿是根据 PPT 来讲的，PPT 是根据教学设计来做的"
 *
 * 与 formal-generator.js 的区别：
 *   formal-generator：基于 ABC 草稿 / 模块知识点生成讲稿（v4.1.x lecture-based 流程）
 *   本生成器       ：基于已确认的 PPT 页面数组逐页生成口播稿（v4.2.0 design-first 流程）
 *
 * 输出契约（与 prompts/lecture-from-ppt.md 严格对齐）：
 *   一份 markdown 文档，含：
 *     # 标题
 *     ## 整节开场
 *     ## 【SLIDE-1】...
 *     ## 【SLIDE-2】...
 *     ...
 *     ## 【SLIDE-N】...
 *     ## 整节收束
 *
 * H 约束遵守：
 *   - H1: 不动 contracts.js
 *   - H3: 不在 quality.js 调用 AI
 *   - H5: prompt 在 prompts/lecture-from-ppt.md
 *   - H8: 不新增依赖
 *   - H12: 不绕过 prompt-assembler——本路径 systemPrompt 来自单文件 prompt，本身就是源治理
 */

const fs = require('fs');
const path = require('path');

const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

// ── 把 PPT 页面数组序列化成给 AI 看的"逐页清单" ──────────────────────────
function _serializePptPagesForPrompt(pages = []) {
  if (!Array.isArray(pages) || pages.length === 0) return '（PPT 页面为空）';

  return pages.map((p, i) => {
    const idx = i + 1;
    const lines = [`### 【PPT-${idx}】${p.title || `第${idx}页`}（pageType：${p.pageType || '知识讲解'}）`];
    if (p.subtitle) lines.push(`副标题：${p.subtitle}`);
    if (Array.isArray(p.keyContent) && p.keyContent.length) {
      lines.push('要点：');
      p.keyContent.forEach((k) => lines.push(`  - ${k}`));
    }
    if (p.speakerNotes) lines.push(`讲者备注：${p.speakerNotes}`);
    if (p.dataPoint) lines.push(`关键数据：${p.dataPoint}`);
    if (p.caseExample) lines.push(`涉及案例：${p.caseExample}`);
    if (p.interactionPrompt) lines.push(`课堂互动：${p.interactionPrompt}`);
    if (p.sourceDesignSection || p.sourceSection) {
      lines.push(`对应教学设计字段：${p.sourceDesignSection || p.sourceSection}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

// ── 把教学设计上下文序列化成精简块 ──────────────────────────────────────
function _serializeDesignDigest(designContent = {}, lessonMeta = {}) {
  if (!designContent || typeof designContent !== 'object') return '';
  const lm = { ...(designContent.lessonMeta || {}), ...lessonMeta };
  const lines = [];

  lines.push(`节课：第 ${lm.lessonNumber || '?'} 节 · ${lm.topic || '本节课'}`);

  const obj = designContent.teachingObjectives || {};
  if (obj.knowledge?.length || obj.skill?.length || obj.emotion?.length) {
    lines.push('教学目标：');
    if (obj.knowledge?.length) lines.push(`  · 知识 → ${obj.knowledge.join('；')}`);
    if (obj.skill?.length) lines.push(`  · 技能 → ${obj.skill.join('；')}`);
    if (obj.emotion?.length) lines.push(`  · 素养 → ${obj.emotion.join('；')}`);
  }
  if (designContent.keyPoints?.length) lines.push(`重点：${designContent.keyPoints.join('；')}`);
  if (designContent.difficulties?.length) lines.push(`难点：${designContent.difficulties.join('；')}`);

  const phases = designContent.inClass?.phases || [];
  if (phases.length) {
    lines.push('5 段法节奏：');
    phases.forEach((p) => {
      lines.push(`  · ${p.phase || ''}（${p.duration || ''}）`);
    });
  }
  if (designContent.ideologicalElements?.length) {
    lines.push(`思政元素：${designContent.ideologicalElements.join('；')}`);
  }
  return lines.join('\n');
}

// ── 从 AI 输出的 markdown 中切片 SLIDE 段落 ──────────────────────────────
function parseSlideSegments(markdown = '') {
  const text = String(markdown || '');
  // 匹配 ## 【SLIDE-N】... 章节，到下一个 ## 之前
  const segments = [];
  const re = /##\s*【SLIDE-(\d+)】([^\n]*)\n([\s\S]*?)(?=\n##\s|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    segments.push({
      slideNumber: Number(m[1]),
      heading: (m[2] || '').trim(),
      body: (m[3] || '').trim(),
    });
  }
  return segments;
}

// ── 覆盖率检查（讲稿质量门槛核心） ──────────────────────────────────────
function checkPptCoverage(markdown = '', pptPages = []) {
  const segments = parseSlideSegments(markdown);
  const slideNumbers = new Set(segments.map((s) => s.slideNumber));
  const expectedCount = pptPages.length;
  const missingSlides = [];
  const duplicateSlides = [];

  // 1. 检查每个 PPT 页是否都有对应 SLIDE
  for (let i = 1; i <= expectedCount; i++) {
    if (!slideNumbers.has(i)) missingSlides.push(i);
  }

  // 2. 检查是否有重复编号
  const seen = new Set();
  segments.forEach((s) => {
    if (seen.has(s.slideNumber)) duplicateSlides.push(s.slideNumber);
    seen.add(s.slideNumber);
  });

  // 3. 检查超出范围编号（如 PPT 只有 10 页，但讲稿出现 SLIDE-15）
  const outOfRange = segments
    .filter((s) => s.slideNumber > expectedCount || s.slideNumber < 1)
    .map((s) => s.slideNumber);

  // 4. 检查每个 SLIDE 段落长度
  const tooShort = segments.filter((s) => {
    const wordCount = s.body.replace(/\s+/g, '').length;
    return wordCount < 30;   // 少于 30 字基本是空话
  }).map((s) => s.slideNumber);

  return {
    expectedCount,
    actualCount: segments.length,
    missingSlides,
    duplicateSlides,
    outOfRange,
    tooShort,
    allCovered: missingSlides.length === 0 && duplicateSlides.length === 0 && outOfRange.length === 0,
    coverage: expectedCount > 0 ? (expectedCount - missingSlides.length) / expectedCount : 0,
  };
}

/**
 * 主入口：基于已确认的 PPT 页面数组生成对应讲稿
 *
 * @param {Object} params
 * @param {Object} params.aiClient — 必须含 chat(systemPrompt, userPrompt, ...) 方法
 * @param {Array} params.pptPages — 已确认的 PPT 页面数组（含 keyContent / speakerNotes 等）
 * @param {Object} [params.designContent] — 教学设计内容（用于上下文）
 * @param {Object} [params.lessonMeta] — 节课元信息
 * @param {string} params.courseName
 * @param {number} [params.totalHours]
 * @param {Object} [params.courseContext] — softwareTools / jobTargets / industryScenarios / learnerProfile
 * @param {string} [params.styleRubricText] — 老师风格 Rubric
 * @returns {Promise<{ script, coverage, raw, attemptLog }>}
 */
async function generateLectureFromPpt(params = {}) {
  const {
    aiClient,
    pptPages = [],
    designContent = null,
    lessonMeta = {},
    courseName = '课程',
    totalHours = 1,
    courseContext = {},
    styleRubricText = '',
    // 2026-05-17 v4.2.0：mode 切换
    //   'slide-by-slide' = 旧 PPT 页 1:1 逐页解说（不推荐，与原 v4.x 设计偏离）
    //   'full-script'    = 完整课堂讲稿（按 5 段法时间线，每章节 ≥800 字教师讲述）← 默认
    mode = 'full-script',
  } = params;

  if (!aiClient || (typeof aiClient.chat !== 'function' && typeof aiClient.chatJson !== 'function')) {
    throw new Error('未提供有效的 AI 客户端（需含 chat 或 chatJson 方法）');
  }
  if (!Array.isArray(pptPages) || pptPages.length === 0) {
    throw new Error('PPT 页面数组为空，无法生成 PPT 驱动讲稿');
  }

  // 2026-05-17 v4.2.0：按 mode 选 prompt
  const promptName = mode === 'full-script' ? 'lecture-full-script' : 'lecture-from-ppt';
  const systemPrompt = loadPrompt(promptName);
  const pptListBlock = _serializePptPagesForPrompt(pptPages);
  const designBlock = _serializeDesignDigest(designContent, lessonMeta);

  const ctxLines = [];
  if (courseContext.softwareTools) ctxLines.push(`软件工具：${courseContext.softwareTools}`);
  if (courseContext.jobTargets) ctxLines.push(`岗位：${courseContext.jobTargets}`);
  if (courseContext.industryScenarios) ctxLines.push(`行业场景：${courseContext.industryScenarios}`);
  if (courseContext.learnerProfile) ctxLines.push(`学情：${courseContext.learnerProfile}`);

  // 2026-05-17 v4.2.0：3 路参考素材（URL / 上传文件 / 老师自由提示词）拼到 userPrompt
  const referenceContext = params.referenceContext || {};
  const refBlocks = [];
  if (referenceContext.urlContent) {
    refBlocks.push(`### URL 抓取参考资料（${referenceContext.urlSource || '老师提供'}）\n${String(referenceContext.urlContent).slice(0, 3000)}`);
  }
  if (referenceContext.uploadContent) {
    refBlocks.push(`### 老师上传的参考文件（${referenceContext.uploadFilename || ''}）\n${String(referenceContext.uploadContent).slice(0, 3000)}`);
  }
  if (referenceContext.freePrompt) {
    refBlocks.push(`### 老师自由提示词（必须遵守所有指令）\n${referenceContext.freePrompt}`);
  }
  const referenceBlock = refBlocks.length > 0 ? `\n## 老师补充的参考素材（必须在讲稿中真实引用）\n\n${refBlocks.join('\n\n')}\n` : '';

  // 模式 A：full-script（完整课堂讲稿，按 5 段法时间线）
  const userPromptFullScript = [
    `## 课程信息`,
    `- 课程名：${courseName}`,
    `- 学时：${totalHours} 节`,
    ctxLines.length ? `- 上下文：${ctxLines.join(' | ')}` : '',
    '',
    designBlock ? `## 教学设计完整内容（讲稿章节必须按 5 段法 phases 组织）\n${designBlock}` : '',
    referenceBlock,
    styleRubricText ? `## 老师风格 Rubric（口播语气参考）\n${String(styleRubricText).slice(0, 1500)}` : '',
    '',
    `## PPT 确认稿摘要（讲稿在合适章节引用 "PPT 第 X 页"，**不要逐页解说**）`,
    pptListBlock,
    '',
    `## 输出要求`,
    `1. 严格按 5 段法（启-导入 / 授-讲授 / 创-实操 / 展-反馈 / 拓-总结）组织讲稿章节`,
    `2. 每章节含「教师讲述」（连续口播 400-1500 字）+「课堂动作附栏」（教师/学生动作列表）`,
    `3. 总字数 ≥ ${Math.max(1500, totalHours * 1250)} 字，教师讲述合计 ≥ ${Math.max(1000, totalHours * 900)} 字`,
    `4. PPT 在合适位置引用（"这时切到 PPT 第 X 页"），不要逐页解说`,
    `5. URL/上传文件/自由提示词内容必须真正引用，不能空喊`,
    `6. 思政元素自然嵌入 1-2 处`,
  ].filter(Boolean).join('\n');

  // 模式 B：slide-by-slide（旧逐页解说模式，保留向后兼容）
  const userPromptSlideBySlide = [
    `## 课程信息`,
    `- 课程名：${courseName}`,
    `- 学时：${totalHours}`,
    ctxLines.length ? `- 上下文：${ctxLines.join(' | ')}` : '',
    '',
    designBlock ? `## 教学设计上下文（节课目标 / 重难点 / 5 段法节奏）\n${designBlock}` : '',
    '',
    styleRubricText ? `## 老师风格 Rubric（口播语气参考）\n${String(styleRubricText).slice(0, 1500)}` : '',
    '',
    `## 已确认的 PPT 页面清单（共 ${pptPages.length} 页 · 讲稿必须一一对应）`,
    pptListBlock,
    '',
    `## 输出要求`,
    `1. 严格按 ${pptPages.length} 页 PPT 生成 ${pptPages.length} 个【SLIDE-N】段落`,
    `2. 编号从 1 到 ${pptPages.length} 递增、不跳号、不重号`,
    `3. 每个 SLIDE 段落必须含三要素：①过渡承接 ②核心讲解（念出 dataPoint / caseExample）③下页过渡`,
    `4. interactionPrompt 必须念给学生，不允许跳过`,
    `5. 整节开场 + 整节收束两段必须有，不计入 SLIDE 编号`,
  ].filter(Boolean).join('\n');

  const userPrompt = mode === 'full-script' ? userPromptFullScript : userPromptSlideBySlide;

  // 用 chat 接口生成（非 JSON）
  let rawText;
  if (typeof aiClient.chat === 'function') {
    rawText = await aiClient.chat({
      systemPrompt,
      userPrompt,
      temperature: 0.5,
      maxTokens: 16000,   // 2026-05-17 v4.2.0：full-script 模式需要 ≥5000 字 ≈ 10000+ tokens
    });
  } else {
    // 退而用 chatJson（包一层 wrapper）
    rawText = await aiClient.chatJson({
      systemPrompt: systemPrompt + '\n\n⚠ 本次输出 markdown 而非 JSON，但请保留段落结构',
      userPrompt,
      temperature: 0.5,
      maxTokens: 16000,   // 2026-05-17 v4.2.0：full-script 模式需要 ≥5000 字 ≈ 10000+ tokens
    });
  }

  const script = String(rawText || '').trim();
  const coverage = checkPptCoverage(script, pptPages);

  return {
    script,
    coverage,
    raw: rawText,
    attemptLog: [
      {
        attempt: 1,
        slideExpected: pptPages.length,
        slideActual: coverage.actualCount,
        missingCount: coverage.missingSlides.length,
        coverage: coverage.coverage,
      },
    ],
  };
}

// ── 自检 ────────────────────────────────────────────────────────────────
function selfCheck() {
  const checks = [];

  checks.push({
    name: 'prompts/lecture-from-ppt.md 可加载',
    pass: (() => {
      try { return loadPrompt('lecture-from-ppt').length > 200; } catch { return false; }
    })(),
  });

  checks.push({
    name: 'parseSlideSegments 切 5 段',
    pass: (() => {
      const md = `# Title
## 整节开场
开场
## 【SLIDE-1】封面
内容一
## 【SLIDE-2】路线图
内容二
## 【SLIDE-3】知识讲解
内容三
## 整节收束
收尾`;
      const segs = parseSlideSegments(md);
      return segs.length === 3 && segs[0].slideNumber === 1 && segs[2].slideNumber === 3;
    })(),
  });

  checks.push({
    name: 'checkPptCoverage 检出缺失页',
    pass: (() => {
      const md = `## 【SLIDE-1】a\nx\n## 【SLIDE-3】c\ny`;
      const pages = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];
      const cov = checkPptCoverage(md, pages);
      return cov.missingSlides.length === 1 && cov.missingSlides[0] === 2 && !cov.allCovered;
    })(),
  });

  checks.push({
    name: 'checkPptCoverage 检出重复页',
    pass: (() => {
      const md = `## 【SLIDE-1】a\nx\n## 【SLIDE-1】a\ny\n## 【SLIDE-2】b\nz`;
      const pages = [{ title: 'a' }, { title: 'b' }];
      const cov = checkPptCoverage(md, pages);
      return cov.duplicateSlides.includes(1);
    })(),
  });

  checks.push({
    name: 'checkPptCoverage 全覆盖通过',
    pass: (() => {
      const md = `## 【SLIDE-1】a\n${'x'.repeat(50)}\n## 【SLIDE-2】b\n${'y'.repeat(50)}`;
      const pages = [{ title: 'a' }, { title: 'b' }];
      const cov = checkPptCoverage(md, pages);
      return cov.allCovered && cov.coverage === 1;
    })(),
  });

  checks.push({
    name: '_serializePptPagesForPrompt 含 keyContent / interactionPrompt',
    pass: (() => {
      const pages = [
        { title: '色彩三要素', pageType: '知识讲解', keyContent: ['色相', '明度'], dataPoint: 'F9 缓动', interactionPrompt: '小组讨论' },
      ];
      const out = _serializePptPagesForPrompt(pages);
      return out.includes('色彩三要素') && out.includes('色相') && out.includes('F9 缓动') && out.includes('小组讨论');
    })(),
  });

  return checks;
}

module.exports = {
  generateLectureFromPpt,
  parseSlideSegments,
  checkPptCoverage,
  selfCheck,
  _internal: {
    loadPrompt,
    _serializePptPagesForPrompt,
    _serializeDesignDigest,
  },
};
