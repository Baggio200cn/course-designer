/**
 * ppt-pipeline-v2.js — PPT 双阶段生成 pipeline
 *
 * 历史：
 *   - 2026-05-15 v4.1.4 重构问题二：双阶段（讲稿大纲 → 逐页详情），替代单阶段全文生成
 *   - 2026-05-16 v4.2.0 Phase A'-3：design-first 重构
 *       工作流顺序改成 schedule → design → PPT → 讲稿 → video → report
 *       PPT 直接基于教学设计生成（不再基于讲稿），讲稿在 PPT 之后写
 *
 * 输入接口（向后兼容）：
 *   ✅ 推荐（v4.2.0+）：designContent + lessonMeta —— 按 sourceDesignSection 切片
 *   🪦 兼容（v4.1.x）：lectureScript —— 按 sourceSection 文本锚点切片
 *
 * 双阶段：
 *   阶段 1：教学设计 → AI 生成 page 大纲（pageType + title + sourceDesignSection），轻量 ~1500 token
 *   阶段 2：FOR EACH page (并发 4)：
 *     - 从 design 取对应 sourceDesignSection 字段（如 phases.授-讲授）的具体内容
 *     - 喂给 AI 生成单页详细 schema：keyContent + speakerNotes + dataPoint + caseExample + interactionPrompt + imagePrompt
 *
 * H 约束遵守：
 *   - H1: 不动 contracts.js
 *   - H3: 不在 quality.js 调用 AI
 *   - H5: prompt 在 prompts/ppt-outline.md + ppt-page-detail.md
 *   - H8: 不新增依赖（用内置 Promise 控制并发）
 */

const fs = require('fs');
const path = require('path');

const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

// ── JSON 解析（含截断修复）────────────────────────────────────────────────
function parseJsonFromText(text) {
  let cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('未找到 JSON 对象边界');
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ── 简单 Promise 并发限制（无依赖）────────────────────────────────────────
async function withConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (e) {
        results[i] = { ok: false, error: e.message || String(e) };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── 把讲稿按章节锚点切片 ─────────────────────────────────────────────────
/**
 * 给定讲稿全文 + 章节标题列表，返回 { [章节标题]: 该章节正文段落 }
 *
 * 策略：
 *   1. 找到讲稿中每个章节标题出现的位置（用正则匹配，宽松：忽略前缀空格、【】、星号等装饰）
 *   2. 章节正文 = 从该章节标题位置到下一章节标题位置之间的文本
 *   3. 找不到锚点时，返回讲稿前 1500 字作为兜底
 */
function _sliceLectureBySection(lectureScript, sectionTitles) {
  const text = String(lectureScript || '');
  const slices = {};

  if (!Array.isArray(sectionTitles) || sectionTitles.length === 0) {
    return slices;
  }

  // 找每个章节标题的位置
  const positions = sectionTitles
    .map((title) => {
      const cleanTitle = String(title || '').trim();
      if (!cleanTitle) return null;
      // 在讲稿中找该标题（去掉【】等装饰）
      // 匹配方式：标题字串出现在行首或前面是非中文字符
      const escaped = cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      const m = text.match(re);
      return m ? { title: cleanTitle, pos: m.index } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.pos - b.pos);

  // 切片
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].pos;
    const end = i + 1 < positions.length ? positions[i + 1].pos : text.length;
    slices[positions[i].title] = text.slice(start, end).trim();
  }
  return slices;
}

// ── 2026-05-16 v4.2.0 Phase A'-3：把教学设计按 sourceDesignSection 切片 ──────
/**
 * 根据 design.content 与 lessonMeta，返回 { [sourceDesignSection]: 该字段的具体内容字符串 }
 *
 * 映射关系与 prompts/ppt-outline.md 中 sourceDesignSection 枚举严格对齐：
 *   lessonMeta / teachingObjectives.knowledge / teachingObjectives.skill / teachingObjectives.emotion
 *   keyPoints / difficulties / teachingMethods
 *   phases.启-导入 / phases.授-讲授 / phases.创-实操 / phases.展-反馈 / phases.拓-总结
 *   assessment / ideologicalElements
 *
 * 每个 slice 是给阶段 2 单页详情生成的"素材源"，AI 据此提炼 keyContent / dataPoint / caseExample。
 */
function _sliceDesignBySection(designContent, lessonMeta = {}) {
  const slices = {};
  if (!designContent || typeof designContent !== 'object') return slices;

  // ── lessonMeta ────────────────────────────────────────────────────────
  const lm = { ...(designContent.lessonMeta || {}), ...lessonMeta };
  const totalH = (Number(lm.theoryHours) || 0) + (Number(lm.practiceHours) || 0);
  slices['lessonMeta'] = [
    `节课编号：第 ${lm.lessonNumber || 1} 节`,
    `节课主题：${lm.topic || '本节课'}`,
    `学时：${totalH || lm.totalHours || '?'} 学时（理论 ${lm.theoryHours || 0} + 实操 ${lm.practiceHours || 0}）`,
    lm.classInfo ? `班级：${lm.classInfo}` : '',
    lm.classroom ? `教学场所：${lm.classroom}` : '',
  ].filter(Boolean).join('\n');

  // ── teachingObjectives 三维拆分 ───────────────────────────────────────
  const obj = designContent.teachingObjectives || {};
  if (Array.isArray(obj.knowledge) && obj.knowledge.length) {
    slices['teachingObjectives.knowledge'] = '【知识目标】\n' + obj.knowledge.map((x) => `- ${x}`).join('\n');
  }
  if (Array.isArray(obj.skill) && obj.skill.length) {
    slices['teachingObjectives.skill'] = '【技能目标】\n' + obj.skill.map((x) => `- ${x}`).join('\n');
  }
  if (Array.isArray(obj.emotion) && obj.emotion.length) {
    slices['teachingObjectives.emotion'] = '【素养目标】\n' + obj.emotion.map((x) => `- ${x}`).join('\n');
  }

  // ── keyPoints / difficulties ─────────────────────────────────────────
  if (Array.isArray(designContent.keyPoints) && designContent.keyPoints.length) {
    slices['keyPoints'] = '【教学重点】\n' + designContent.keyPoints.map((x) => `- ${x}`).join('\n');
  }
  if (Array.isArray(designContent.difficulties) && designContent.difficulties.length) {
    slices['difficulties'] = '【教学难点】\n' + designContent.difficulties.map((x) => `- ${x}`).join('\n');
  }

  // ── teachingMethods ──────────────────────────────────────────────────
  if (Array.isArray(designContent.teachingMethods) && designContent.teachingMethods.length) {
    slices['teachingMethods'] = '【教学方法】\n' + designContent.teachingMethods.map((m, i) => {
      const parts = [`${i + 1}. ${m.name || ''}`];
      if (m.desc) parts.push(`：${m.desc}`);
      if (m.applicable) parts.push(`（适用：${m.applicable}）`);
      if (m.example) parts.push(`\n   示例：${m.example}`);
      return parts.join('');
    }).join('\n');
  }

  // ── inClass.phases 5 段法 ────────────────────────────────────────────
  // 节课 design 的 phases 数组里每一项 p.phase 可能写成"启-导入"/"启"/"导入"/"启·导入"...
  // 用模糊正则识别归类到 5 个 key 之一；多段命中同一 key 时合并。
  const phases = Array.isArray(designContent.inClass?.phases) ? designContent.inClass.phases : [];
  const phaseRules = [
    { key: 'phases.启-导入', re: /启|导入/ },
    { key: 'phases.授-讲授', re: /授|讲授|讲解/ },
    { key: 'phases.创-实操', re: /创|实操|实践|操作/ },
    { key: 'phases.展-反馈', re: /展|反馈|互查|展示|点评/ },
    { key: 'phases.拓-总结', re: /拓|总结|拓展|延伸|收束/ },
  ];
  phases.forEach((p) => {
    const phaseName = String(p.phase || '').trim();
    if (!phaseName) return;
    const match = phaseRules.find((r) => r.re.test(phaseName));
    if (!match) return;
    const text = [
      `【${phaseName}】${p.duration ? `（${p.duration}）` : ''}`,
      p.teacherActions ? `教师动作：${p.teacherActions}` : '',
      p.studentActions ? `学生动作：${p.studentActions}` : '',
      p.designIntent ? `设计意图：${p.designIntent}` : '',
      p.itEnabler ? `信息化手段：${p.itEnabler}` : '',
      p.materials ? `所需素材：${p.materials}` : '',
    ].filter(Boolean).join('\n');
    if (slices[match.key]) slices[match.key] += '\n\n' + text;
    else slices[match.key] = text;
  });

  // ── assessment ───────────────────────────────────────────────────────
  const assess = designContent.assessment || {};
  if (Array.isArray(assess.components) && assess.components.length || assess.criteria) {
    const lines = ['【考核维度】'];
    if (Array.isArray(assess.components)) {
      assess.components.forEach((c) => {
        const head = `- ${c.name || ''}（权重 ${c.weight || 0}%）`;
        const detail = c.criteria || c.desc || '';
        lines.push(detail ? `${head}：${detail}` : head);
      });
    }
    if (assess.criteria) lines.push(`【判分标准】${assess.criteria}`);
    if (assess.method) lines.push(`【考核方式】${assess.method}`);
    slices['assessment'] = lines.join('\n');
  }

  // ── ideologicalElements ──────────────────────────────────────────────
  if (Array.isArray(designContent.ideologicalElements) && designContent.ideologicalElements.length) {
    slices['ideologicalElements'] = '【思政元素】\n' + designContent.ideologicalElements.map((x) => `- ${x}`).join('\n');
  }

  return slices;
}

/**
 * 把 design.content 摊平成一段 markdown，供阶段 1（大纲生成）AI 阅读用
 * 与阶段 2 的 slices 不同：阶段 1 需要一次性看到全貌做结构规划
 */
function _buildDesignDigestForOutline(designContent, lessonMeta = {}) {
  if (!designContent || typeof designContent !== 'object') return '';
  const slices = _sliceDesignBySection(designContent, lessonMeta);
  const sectionsOrder = [
    'lessonMeta',
    'teachingObjectives.knowledge',
    'teachingObjectives.skill',
    'teachingObjectives.emotion',
    'keyPoints',
    'difficulties',
    'teachingMethods',
    'phases.启-导入',
    'phases.授-讲授',
    'phases.创-实操',
    'phases.展-反馈',
    'phases.拓-总结',
    'assessment',
    'ideologicalElements',
  ];
  const lines = ['## 本节教学设计（design.content）— PPT 选材唯一依据'];
  sectionsOrder.forEach((key) => {
    if (slices[key]) {
      lines.push('');
      lines.push(`### sourceDesignSection: ${key}`);
      lines.push(slices[key]);
    }
  });
  return lines.join('\n');
}

/**
 * 阶段 1：生成 PPT 大纲（pageType + title + sourceDesignSection）
 *
 * @returns {Promise<{ pages: Array, raw: Object }>}
 */
async function generateOutline({
  aiClient,
  // 2026-05-16 v4.2.0 Phase A'-3：design-first 输入（优先）
  designContent = null,
  lessonMeta = {},
  // 兼容旧 v4.1.x lecture-based 输入
  lectureScript = '',
  courseName,
  totalHours,
  modules,
  lectureSections = [],
  lectureSectionSummary = '',
  externalReferences = [],   // 2026-05-15 v4.1.4：老师上传的外部参考 PPT/素材
}) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    throw new Error('未提供有效的 AI 客户端');
  }

  const hasDesign = designContent && typeof designContent === 'object'
    && (designContent.teachingObjectives || designContent.inClass || designContent.keyPoints);
  if (!hasDesign && !String(lectureScript || '').trim()) {
    throw new Error('design 与 lecture 都为空，无法生成 PPT 大纲');
  }

  const systemPrompt = loadPrompt('ppt-outline');
  const modulesSummary = (modules || []).map((m, i) =>
    `模块${i + 1}：${m.name || ''}（${(m.knowledgePoints || []).length}个知识点）`
  ).join('；') || '（无模块信息）';

  // ── 选材区块：design-first 优先，lecture fallback ────────────────────
  let sourceBlock;
  if (hasDesign) {
    sourceBlock = _buildDesignDigestForOutline(designContent, lessonMeta);
  } else {
    const sectionAnchorBlock = lectureSections.length
      ? '## 讲稿章节锚点（sourceSection 必须严格选下方之一）\n' +
        lectureSections.slice(0, 12).map((s, i) =>
          `- ${s.heading || `章节${i + 1}`}${(s.keyPoints || []).length ? `（关键点：${s.keyPoints.slice(0, 2).join('、')}）` : ''}`
        ).join('\n')
      : (lectureSectionSummary ? `## 讲稿章节锚点\n${lectureSectionSummary}` : '');
    sourceBlock = [
      sectionAnchorBlock,
      '',
      '## 🪦 兼容模式：讲稿全文（v4.1.x 老数据，无 design 时使用）',
      String(lectureScript).slice(0, 10000),
    ].filter(Boolean).join('\n');
  }

  // 2026-05-15 v4.1.4：把老师上传的外部参考 PPT/素材也注入到 prompt
  let externalRefBlock = '';
  if (Array.isArray(externalReferences) && externalReferences.length > 0) {
    const refLines = externalReferences.map((r, i) => {
      const head = r.kind === 'file' ? `📎 文件：${r.filename || '参考材料'}` : '📝 老师粘贴的参考';
      const snippet = String(r.content || '').slice(0, 1500);
      return `【参考 ${i + 1}】${head}\n${snippet}`;
    }).join('\n\n');
    externalRefBlock = [
      '## 🎯 老师上传的外部参考 PPT/素材（重要——用来指导本次 PPT 的风格 + 内容方向）',
      '',
      '老师提供的下方参考材料代表了 ta 想要的 PPT 形态——你需要在以下方面对齐：',
      '- 内容的详略：参考 PPT 每页有多少要点、举不举具体案例',
      '- 章节切分：参考 PPT 是按"模块/单元"还是按"步骤/环节"切',
      '- 案例风格：参考 PPT 是否含实拍图/示意图/数据对比',
      '- 互动设计：参考 PPT 是否有思考题/对话框/课堂任务',
      '',
      refLines,
      '',
    ].join('\n');
  }

  const userPrompt = [
    `## 课程信息`,
    `- 课程名：${courseName || '未命名课程'}`,
    `- 学时：${totalHours || 1}`,
    `- 模块：${modulesSummary}`,
    '',
    externalRefBlock,
    sourceBlock,
  ].filter(Boolean).join('\n');

  const rawText = await aiClient.chatJson({
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxTokens: 2500,   // 大纲 JSON ~25 页 × 50 token ≈ 1500，给足缓冲
  });

  const parsed = parseJsonFromText(rawText);
  const pagesRaw = Array.isArray(parsed.pages) ? parsed.pages : [];

  // 2026-05-15 v4.1.4：AI 大纲可能出现重复页（"验收标准"等多次），主动去重
  // 2026-05-16 v4.2.0：兼容 sourceDesignSection（design-first）+ sourceSection（旧 lecture-based）
  //   策略：(pageType + title + section) 三元组完全相同视为重复，保留首次出现
  //         "验收标准" / "课堂练习" / "操作步骤" 等内容型 pageType 也按 (pageType + section) 去重
  const seen = new Set();
  const DEDUP_BY_TYPE_AND_SECTION = new Set(['验收标准', '操作步骤', '课堂练习', '知识讲解', '案例展示']);
  const pages = [];
  let droppedCount = 0;
  for (let i = 0; i < pagesRaw.length; i++) {
    const p = pagesRaw[i];
    const pageType = String(p.pageType || '知识讲解');
    const title = String(p.title || `第${i + 1}页`).slice(0, 30);
    // v4.2.0：AI 返回 sourceDesignSection，回退到 sourceSection 兼容旧 prompt
    const sourceDesignSection = String(p.sourceDesignSection || p.sourceSection || '').trim();
    // 兼容字段：保留 sourceSection 以让下游旧代码（exports / 渲染）继续工作
    const sourceSection = sourceDesignSection;

    // 关键页型一律保留（不去重）
    const KEEP_ALWAYS = ['封面', '路线图', '总结收束', '谢谢', '动态练习'];
    if (!KEEP_ALWAYS.includes(pageType)) {
      const keyStrict = `${pageType}||${title}||${sourceDesignSection}`;
      if (seen.has(keyStrict)) { droppedCount++; continue; }
      if (DEDUP_BY_TYPE_AND_SECTION.has(pageType) && sourceDesignSection) {
        const keyLoose = `${pageType}||${sourceDesignSection}`;
        if (seen.has(keyLoose)) { droppedCount++; continue; }
        seen.add(keyLoose);
      }
      seen.add(keyStrict);
    }
    pages.push({ pageType, title, sourceSection, sourceDesignSection });
  }
  if (droppedCount > 0) {
    console.log(`[ppt-pipeline-v2] AI 大纲去重：剔除 ${droppedCount} 张重复页，最终 ${pages.length} 页`);
  }

  return { pages, raw: parsed };
}

/**
 * 阶段 2：为单页 PPT 生成详细内容
 *
 * @returns {Promise<Object>} 完整 page 对象
 */
/**
 * 2026-05-16 v4.1.4 Phase 2：根据课程名 / 上下文推断整门课的 mainAccentColor
 *   工科类（光电/电子/机械）→ 科技蓝 #2563EB
 *   服装/陈列/视觉 → 时尚粉 #E91E8C
 *   传统/国学/工艺 → 中国红 #C8102E
 *   信息技术/计算机 → 极客紫 #6B21A8
 *   医护/食品 → 健康绿 #10B981
 *   其它 → 深海蓝 #2E86DE（兜底）
 */
function inferMainAccentColor({ courseName = '', courseContext = {} }) {
  const text = `${courseName} ${courseContext.softwareTools || ''} ${courseContext.industryScenarios || ''} ${courseContext.jobTargets || ''}`.toLowerCase();
  if (/光|电|机械|工程|自动化|材料|精密|制造/.test(text)) return '#2563EB';
  if (/服装|陈列|视觉|时尚|形象|美妆|造型/.test(text)) return '#E91E8C';
  if (/中医|中药|国学|传统|工艺|文化遗产|非遗|国潮/.test(text)) return '#C8102E';
  if (/计算机|编程|前端|后端|算法|网络|信息技术|web|app/.test(text)) return '#6B21A8';
  if (/医|护|药|食品|营养|健康|生物/.test(text)) return '#10B981';
  return '#2E86DE';
}

/**
 * 2026-05-16 v4.1.4 Phase 2：兜底 layoutType
 *   AI 没返回或返回不合法时，按 pageType 默认推断
 */
const VALID_LAYOUT_TYPES = new Set([
  'hero', 'two-column', 'image-bleed', 'diagram-center', 'quote', 'table', 'bullet-list',
]);
function defaultLayoutTypeFor(pageType, keyContentCount = 0) {
  const pt = String(pageType || '').trim();
  if (pt === '封面' || pt === '谢谢') return 'hero';
  if (pt === '总结收束') return 'hero';
  if (pt === '课程导入' || pt === '模块导入') return 'image-bleed';
  if (pt === '路线图' || pt === '操作步骤') return 'diagram-center';
  if (pt === '验收标准') return 'table';
  if (pt === '课堂练习') return 'quote';
  if (pt === '动态练习') return 'bullet-list';
  if (pt === '知识讲解' || pt === '案例展示') {
    return keyContentCount >= 5 ? 'bullet-list' : 'two-column';
  }
  return 'bullet-list';
}

function defaultThemeModeFor(pageType, layoutType) {
  const pt = String(pageType || '').trim();
  if (pt === '封面' || pt === '谢谢' || pt === '总结收束') return 'dark';
  if (pt === '课程导入') return 'dark';
  if (layoutType === 'image-bleed') return 'dark';
  return 'light';
}

async function generateOnePageDetail({
  aiClient,
  page,                    // { pageType, title, sourceSection, sourceDesignSection }
  sectionExcerpt,          // 该 page 对应的素材（design slice 或 讲稿段落）
  courseName,
  totalHours,
  courseContext = {},
  mainAccentColor = '#2E86DE',
}) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    throw new Error('未提供有效的 AI 客户端');
  }

  const systemPrompt = loadPrompt('ppt-page-detail');

  const contextLines = [];
  if (courseContext.softwareTools) contextLines.push(`软件工具：${courseContext.softwareTools}`);
  if (courseContext.jobTargets) contextLines.push(`岗位：${courseContext.jobTargets}`);
  if (courseContext.industryScenarios) contextLines.push(`行业场景：${courseContext.industryScenarios}`);
  if (courseContext.learnerProfile) contextLines.push(`学情：${courseContext.learnerProfile}`);

  const sourceDesignSection = page.sourceDesignSection || page.sourceSection || '';
  const isDesignFirst = Boolean(page.sourceDesignSection);

  const userPrompt = [
    `## 课程信息`,
    `- 课程名：${courseName || '未命名课程'}`,
    `- 学时：${totalHours || 1}`,
    contextLines.length ? `- 上下文：${contextLines.join(' | ')}` : '',
    `- 整门课主 accentColor（mainAccentColor）：${mainAccentColor}`,
    '',
    `## 本页元信息（已由第一阶段确定，保持一致）`,
    `- pageType：${page.pageType}`,
    `- title：${page.title}`,
    `- sourceDesignSection：${sourceDesignSection}`,
    `- sourceSection（兼容字段，与 sourceDesignSection 同值）：${sourceDesignSection}`,
    '',
    sectionExcerpt
      ? [
          isDesignFirst
            ? `## 本页对应的教学设计字段内容（v4.2.0 素材来源——detail 细节必须由此提炼）`
            : `## 本页对应的讲稿章节原文（详细化的依据）`,
          sectionExcerpt.slice(0, 2000),
        ].join('\n')
      : `## 本页无明确字段锚点 → 自由发挥但要严格符合 pageType / title 主题`,
    '',
    `请生成本页的完整 JSON 详情。其中 layoutType / accentColor / themeMode 三字段按 system prompt 的决策表填写：`,
    `  - layoutType：从 hero / two-column / image-bleed / diagram-center / quote / table / bullet-list 七选一`,
    `  - accentColor：普通教学页留空字符串（走主色 ${mainAccentColor}），仅 quote/警示/案例完成态等强调页才单独指定`,
    `  - themeMode：light（教学内容页）/ dark（封面/谢谢/总结/课程导入）`,
  ].filter(Boolean).join('\n');

  const rawText = await aiClient.chatJson({
    systemPrompt,
    userPrompt,
    temperature: 0.3,
    maxTokens: 1500,
  });

  const parsed = parseJsonFromText(rawText);

  // 合并 + 兜底
  //   pageType/title/section 由阶段 1 决定，阶段 2 不允许改写——避免"谢谢"页被误改成其他类型
  const keyContent = Array.isArray(parsed.keyContent)
    ? parsed.keyContent.filter(Boolean).map((x) => String(x).slice(0, 30)).slice(0, 5)
    : [];

  // 2026-05-16 v4.1.4 Phase 2：layoutType / accentColor / themeMode 兜底
  let layoutType = String(parsed.layoutType || '').trim().toLowerCase();
  if (!VALID_LAYOUT_TYPES.has(layoutType)) {
    layoutType = defaultLayoutTypeFor(page.pageType, keyContent.length);
  }
  let accentColor = String(parsed.accentColor || '').trim();
  if (accentColor && !/^#[0-9A-Fa-f]{6}$/.test(accentColor)) accentColor = '';  // 非法 hex → 走主色
  let themeMode = String(parsed.themeMode || '').trim().toLowerCase();
  if (themeMode !== 'light' && themeMode !== 'dark') {
    themeMode = defaultThemeModeFor(page.pageType, layoutType);
  }

  return {
    pageType: String(page.pageType || parsed.pageType),
    title: String(page.title || parsed.title).slice(0, 30),
    subtitle: String(parsed.subtitle || '').slice(0, 60),
    keyContent,
    speakerNotes: String(parsed.speakerNotes || '').slice(0, 300),
    dataPoint: String(parsed.dataPoint || '').slice(0, 80),
    caseExample: String(parsed.caseExample || '').slice(0, 100),
    interactionPrompt: String(parsed.interactionPrompt || '').slice(0, 80),
    imagePrompt: String(parsed.imagePrompt || '').slice(0, 200),
    needImage: parsed.needImage !== false,
    // 双字段并存：sourceSection 兼容旧渲染 / sourceDesignSection 新流程权威字段
    sourceSection: sourceDesignSection,
    sourceDesignSection,
    // 2026-05-16 v4.1.4 Phase 2 新增字段
    layoutType,
    accentColor,     // '' = 走主色；hex = 单页强调色
    themeMode,
  };
}

/**
 * 主入口：双阶段生成 PPT 完整页面规划
 *
 * @param {Object} params 同原 generatePptPlan 参数（向后兼容）
 * @returns {Promise<{ pages, rawPlan, pageCount, pipeline: 'v2-two-stage' }>}
 */
async function generatePptPlanV2(params) {
  const {
    // 2026-05-16 v4.2.0 Phase A'-3：design-first 主输入
    designContent = null,
    lessonMeta = {},
    // 兼容 v4.1.x：lecture-based 输入
    lectureScript = '',
    courseName,
    totalHours = 1,
    modules = [],
    aiClient,
    prevPages = [],
    lectureSections = [],
    lectureSectionSummary = '',
    courseContext = {},
    externalReferences = [],    // 2026-05-15 v4.1.4：老师上传的外部参考 PPT/素材
    concurrency = 4,           // 第二阶段并发上限
    onProgress = null,          // 2026-05-15 P2-5：进度回调 (event) => void
  } = params;

  // 进度推送辅助
  const emit = (phase, payload) => {
    if (typeof onProgress === 'function') {
      try { onProgress({ phase, ...payload }); } catch (_) { /* ignore */ }
    }
  };

  const hasDesign = designContent && typeof designContent === 'object'
    && (designContent.teachingObjectives || designContent.inClass || designContent.keyPoints);
  const mode = hasDesign ? 'design-first' : 'lecture-fallback';
  console.log(`[ppt-pipeline-v2] 输入模式：${mode}（design=${hasDesign ? 'Y' : 'N'} / lecture=${lectureScript ? 'Y' : 'N'}）`);

  // ── 阶段 1：生成大纲 ──────────────────────────────────────────────────
  emit('outline-start', { totalHours, mode });
  console.log(`[ppt-pipeline-v2] 阶段 1：生成 ${totalHours} 学时课程的 PPT 大纲…`);
  const outline = await generateOutline({
    aiClient,
    designContent, lessonMeta,           // v4.2.0 design-first
    lectureScript,                       // v4.1.x 兼容
    courseName, totalHours, modules,
    lectureSections, lectureSectionSummary,
    externalReferences,
  });
  console.log(`[ppt-pipeline-v2] 大纲完成：${outline.pages.length} 页`);
  emit('outline-done', { totalPages: outline.pages.length });

  // ── 准备素材切片（design 优先，lecture 兜底）──────────────────────────
  let sectionSlices = {};
  if (hasDesign) {
    sectionSlices = _sliceDesignBySection(designContent, lessonMeta);
    const sliceKeys = Object.keys(sectionSlices);
    console.log(`[ppt-pipeline-v2] design 切片：${sliceKeys.length} 个字段命中 (${sliceKeys.join(', ')})`);
  } else {
    const sectionTitles = outline.pages.map((p) => p.sourceSection).filter(Boolean);
    sectionSlices = _sliceLectureBySection(lectureScript, sectionTitles);
    console.log(`[ppt-pipeline-v2] 讲稿切片：${Object.keys(sectionSlices).length} 个章节命中`);
  }

  // 2026-05-16 v4.1.4 Phase 2：整门课主色（用于普通页留空 accentColor 时兜底）
  const mainAccentColor = inferMainAccentColor({ courseName, courseContext });
  console.log(`[ppt-pipeline-v2] 推断整门课主色：${mainAccentColor}`);

  // ── 阶段 2：并发生成每页详情 ─────────────────────────────────────────
  console.log(`[ppt-pipeline-v2] 阶段 2：并发 ${concurrency} 路生成每页详情…`);
  emit('detail-start', { totalPages: outline.pages.length, concurrency });

  let completedCount = 0;
  const results = await withConcurrency(outline.pages, concurrency, async (page, idx) => {
    // v4.2.0：design-first 优先按 sourceDesignSection 取片，向下兼容 sourceSection
    const sliceKey = page.sourceDesignSection || page.sourceSection || '';
    const excerpt = sectionSlices[sliceKey] || '';
    try {
      const detail = await generateOnePageDetail({
        aiClient, page,
        sectionExcerpt: excerpt,
        courseName, totalHours, courseContext,
        mainAccentColor,
      });
      completedCount++;
      emit('detail-page-done', { current: completedCount, total: outline.pages.length, pageTitle: page.title });
      return detail;
    } catch (e) {
      console.warn(`[ppt-pipeline-v2] 第 ${idx + 1} 页详情生成失败：${e.message}，使用兜底`);
      completedCount++;
      emit('detail-page-done', { current: completedCount, total: outline.pages.length, pageTitle: page.title, error: e.message });
      const fallbackLayout = defaultLayoutTypeFor(page.pageType, 0);
      return {
        pageType: page.pageType,
        title: page.title,
        subtitle: '',
        keyContent: [],
        speakerNotes: excerpt.slice(0, 200) || '（素材切片缺失，建议手动补充）',
        dataPoint: '',
        caseExample: '',
        interactionPrompt: '',
        imagePrompt: `${courseName || '课程'}相关教学场景图，${page.title}`,
        needImage: true,
        sourceSection: sliceKey,
        sourceDesignSection: sliceKey,
        layoutType: fallbackLayout,
        accentColor: '',
        themeMode: defaultThemeModeFor(page.pageType, fallbackLayout),
        _generateError: e.message,
      };
    }
  });

  const pages = results.map((r) => r.ok ? r.value : r);
  // failedCount 由两部分组成：
  //   (a) withConcurrency 内部失败（极少，因为 generateOnePageDetail 自己 catch 了）
  //   (b) 返回值里带 _generateError 标记（兜底页）
  const failedCount = results.filter((r) => !r.ok || r.value?._generateError).length;
  console.log(`[ppt-pipeline-v2] 完成：${pages.length} 页（失败 ${failedCount} 页走兜底）`);

  // 合并 prevPages 的图片（若有，保留老师手工调整过的配图）
  if (Array.isArray(prevPages) && prevPages.length > 0) {
    pages.forEach((p, i) => {
      if (prevPages[i]?.imageDataUri && !p.imageDataUri) {
        p.imageDataUri = prevPages[i].imageDataUri;
        p.imagePrompt = prevPages[i].imagePrompt || p.imagePrompt;
      }
    });
  }

  emit('detail-all-done', { totalPages: pages.length, failedCount });

  // P6 删除（2026-05-18）：动态练习页插入整段下线
  //   v4.3 七阶段工作流：PPT 阶段只产 PPT；练习题独立到「⑤ 课堂互动测验 + 作业」stage
  //   老师反馈："在线测试题环节+课后作业环节，放置在后面。这里没有这个模块啦"
  //   原 v4.2 代码已不再触发（默认 SKIP），但保留代码影响阅读 → 整段删除
  let exerciseInserted = false;
  let exerciseError = null;
  if (false) {  // 永不进入
    try {
      emit('exercise-start', {});
      const { generateDynamicExercise } = require('../services/ppt-dynamic-exercise.service');
      console.log(`[ppt-pipeline-v2] 🎯 开始生成动态练习页（${pages.length} 页教学内容作为出题素材）`);
      const exerciseStartTime = Date.now();

      const exerciseResult = await generateDynamicExercise({
        aiClient,
        pages,
        courseName,
        totalHours,
      });

      const exerciseElapsed = Date.now() - exerciseStartTime;
      console.log(`[ppt-pipeline-v2] ✅ 动态练习页生成完成（耗时 ${exerciseElapsed}ms，共 ${exerciseResult.exercises?.length || 0} 题）`);

      const exercisePage = exerciseResult.exercisePage;
      // 找到"谢谢"页位置，把 exercisePage 插在它前面；若没找到，追加到末尾
      const thanksIdx = pages.findIndex((p) =>
        String(p.pageType || '').includes('谢谢') ||
        String(p.title || '').includes('谢谢') ||
        String(p.title || '').toLowerCase().includes('thank')
      );
      if (thanksIdx >= 0) {
        pages.splice(thanksIdx, 0, exercisePage);
        console.log(`[ppt-pipeline-v2] 📌 动态练习页插入到第 ${thanksIdx + 1} 位（"谢谢"页前）`);
      } else {
        pages.push(exercisePage);
        console.log(`[ppt-pipeline-v2] 📌 动态练习页追加到末尾（未找到"谢谢"页）`);
      }
      exerciseInserted = true;
      emit('exercise-done', { exerciseCount: exercisePage.exercises?.length || 0 });
    } catch (exErr) {
      exerciseError = exErr.message;
      console.error(`[ppt-pipeline-v2] ❌ 动态练习页生成失败：${exErr.message}`);
      console.error(`[ppt-pipeline-v2]    失败原因详情：`, exErr.stack || exErr);
      console.warn(`[ppt-pipeline-v2]    主流程不阻断，将插入"失败提示页"让老师看到`);
      emit('exercise-failed', { error: exErr.message });

      // 2026-05-16 v4.1.4 Q4：插入失败诊断 placeholder 页，不让老师以为消失了
      const placeholderPage = {
        pageType: '动态练习',
        title: '课堂动态练习（生成失败，可手动重试）',
        subtitle: 'AI 出题失败 · 请点页面下方"重试"按钮',
        keyContent: [
          `失败原因：${exErr.message}`,
          '常见原因 1：AI 返回 JSON 格式不合法',
          '常见原因 2：AI 输出 0 道题（讲稿内容过短）',
          '解决方案 1：在 PPT 阶段点"重新规划页面"重试',
          '解决方案 2：检查讲稿内容是否足够丰富（≥ 3000 字）',
        ],
        speakerNotes: `AI 动态练习生成失败：${exErr.message}。老师可手动在此页编辑题目，或在 PPT 阶段重新规划。`,
        dataPoint: '',
        caseExample: '',
        interactionPrompt: '本页生成失败，请联系老师手动补充题目',
        imagePrompt: '',
        needImage: false,
        sourceSection: '动态练习（失败）',
        layoutType: 'bullet-list',
        accentColor: '#DC2626',   // 红色警示
        themeMode: 'light',
        exercises: [],            // 空数组，前端"练习题 (0)"标签会触发警示
        exerciseHtml: '',
        _generationFailed: true,
        _failureReason: exErr.message,
      };
      const thanksIdx = pages.findIndex((p) =>
        String(p.pageType || '').includes('谢谢')
      );
      if (thanksIdx >= 0) {
        pages.splice(thanksIdx, 0, placeholderPage);
      } else {
        pages.push(placeholderPage);
      }
      console.warn(`[ppt-pipeline-v2]    已插入失败诊断 placeholder（红色警示色）`);
    }
  }

  emit('all-done', { totalPages: pages.length, exerciseInserted });

  return {
    pages,
    rawPlan: { pages, mainAccentColor },
    pageCount: pages.length,
    pipeline: 'v2-two-stage',
    mode,                  // 'design-first' | 'lecture-fallback'
    failedCount,
    exerciseInserted,
    // 2026-05-16 v4.1.4 Phase 2：返回整门课主色给前端，用于"AI 自主决定"模式下统一渲染
    mainAccentColor,
  };
}

// ── 自检 ────────────────────────────────────────────────────────────────
function selfCheck() {
  const checks = [];

  checks.push({
    name: 'prompts/ppt-outline.md + ppt-page-detail.md 可加载',
    pass: (() => {
      try {
        return loadPrompt('ppt-outline').length > 100 && loadPrompt('ppt-page-detail').length > 100;
      } catch { return false; }
    })(),
  });

  // 章节切片测试（旧 lecture-based）
  checks.push({
    name: '_sliceLectureBySection 按锚点切片',
    pass: (() => {
      const text = '【开场导入】这是开场内容。\n【模块 1】模块一内容。\n【总结收束】结束语。';
      const titles = ['开场导入', '模块 1', '总结收束'];
      const slices = _sliceLectureBySection(text, titles);
      return Object.keys(slices).length === 3 && slices['开场导入']?.includes('开场内容');
    })(),
  });

  // 2026-05-16 v4.2.0 Phase A'-3：design-first 切片测试
  checks.push({
    name: '_sliceDesignBySection 按 design 字段切片',
    pass: (() => {
      const design = {
        lessonMeta: { lessonNumber: 3, topic: '路径动画', theoryHours: 1, practiceHours: 1 },
        teachingObjectives: {
          knowledge: ['理解路径动画原理', '掌握关键帧设置'],
          skill: ['能独立完成路径动画案例'],
          emotion: ['培养细节意识'],
        },
        keyPoints: ['路径绑定', '关键帧节奏'],
        difficulties: ['缓动函数选择'],
        teachingMethods: [{ name: '案例驱动', desc: '从真实案例反推原理' }],
        inClass: {
          phases: [
            { phase: '启-导入', duration: '5min', teacherActions: '播放案例', studentActions: '观察' },
            { phase: '授-讲授', duration: '20min', teacherActions: '演示步骤', studentActions: '跟练' },
            { phase: '创-实操', duration: '30min', teacherActions: '巡场指导', studentActions: '独立完成' },
            { phase: '展-反馈', duration: '15min', teacherActions: '组织互评', studentActions: '展示作品' },
            { phase: '拓-总结', duration: '10min', teacherActions: '点评升华', studentActions: '反思' },
          ],
        },
        assessment: { components: [{ name: '作品完成度', weight: 40 }, { name: '路径准确度', weight: 30 }] },
        ideologicalElements: ['工匠精神'],
      };
      const slices = _sliceDesignBySection(design);
      return slices['lessonMeta']?.includes('路径动画')
        && slices['teachingObjectives.knowledge']?.includes('关键帧')
        && slices['keyPoints']?.includes('路径绑定')
        && slices['phases.启-导入']?.includes('播放案例')
        && slices['phases.授-讲授']?.includes('演示步骤')
        && slices['phases.创-实操']?.includes('巡场')
        && slices['phases.展-反馈']?.includes('互评')
        && slices['phases.拓-总结']?.includes('点评')
        && slices['assessment']?.includes('作品完成度')
        && slices['ideologicalElements']?.includes('工匠精神');
    })(),
  });

  // 并发控制测试
  checks.push({
    name: 'withConcurrency 并发限制',
    pass: (async () => {
      const items = [1, 2, 3, 4, 5];
      const results = await withConcurrency(items, 2, async (n) => n * 2);
      return results.every((r) => r.ok) && results.map((r) => r.value).join() === '2,4,6,8,10';
    }),
  });

  return checks;
}

module.exports = {
  generatePptPlanV2,
  generateOutline,
  // 2026-05-16 v4.1.4 Phase 2 暴露给 export / 前端 / verify
  inferMainAccentColor,
  defaultLayoutTypeFor,
  defaultThemeModeFor,
  VALID_LAYOUT_TYPES,
  generateOnePageDetail,
  selfCheck,
  _internal: {
    _sliceLectureBySection,
    _sliceDesignBySection,            // 2026-05-16 v4.2.0 Phase A'-3
    _buildDesignDigestForOutline,     // 2026-05-16 v4.2.0 Phase A'-3
    withConcurrency,
    parseJsonFromText,
    loadPrompt,
  },
};
