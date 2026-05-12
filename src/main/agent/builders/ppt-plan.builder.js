/**
 * ppt-plan.builder.js — ppt-plan-generator systemPrompt 的 fragment 装配构造器（Phase-7.6 R7 / H12）
 *
 * 职责：把 prompts/ppt-plan.md 整段加载方式，升级为按 Harness 治理体系拆分的 fragment 列表，
 *      让 PPT 规划生成走 prompt-assembler，与 abc/formal/framework 装配体系打通。
 *
 * 与 abc.builder.js 设计对应：
 *   - 平台基线（H1-H8 + 业务安全基线）由 assembleWithBaseline 自动注入
 *   - 本 builder 负责产品级默认 fragment（角色 / 输出格式 / 页面规则 / 文字规范）
 *
 * 与 abc.builder 的差异：
 *   - 本 builder 接收 ctx 参数（动态规则需依赖 totalHours / hasLectureSections 等）
 *   - 输出格式 fragment scope=output_style，最末注入
 *
 * 拆分依据（4 个 fragment）：
 *   1. ppt_plan_role         角色定义（PRODUCT_DEFAULT，slot=1）
 *   2. ppt_plan_rules        页面规划规则（PRODUCT_DEFAULT，slot=1）
 *   3. ppt_plan_text_rules   文字内容规范（PRODUCT_DEFAULT，slot=1）
 *   4. ppt_plan_output       JSON 输出格式（PRODUCT_DEFAULT + scope=output_style，slot=6）
 *
 * 兼容性：保留 buildPptPlanSystemPromptLegacy()，从 prompts/ppt-plan.md 加载原版做回滚。
 */

const fs = require('fs');
const path = require('path');
const { FRAGMENT_TYPE, LIFETIME } = require('../source-registry');
const { OUTPUT_STYLE_SCOPE } = require('../prompt-assembler');

const SOURCE_PREFIX = 'prompts/ppt-plan.md';

// ─── 角色定义（静态）──────────────────────────────────────
const ROLE_DEFINITION = '你是职业教育 PPT 页面规划专家。根据正式讲稿和课程信息，生成一份结构化的 PPT 页面规划方案。';

// ─── 输出 JSON 格式（静态）────────────────────────────────
const OUTPUT_FORMAT = `输出严格为 JSON 对象，结构如下：
\`\`\`json
{
  "pages": [
    {
      "pageType": "封面|课程导入|路线图|模块导入|知识讲解|操作步骤|验收标准|课堂练习|总结收束",
      "title": "页面主标题（8字以内）",
      "subtitle": "副标题或时间标注（可空）",
      "keyContent": ["要点1","要点2","要点3"],
      "speakerNotes": "讲者备注：老师在此页应说的核心话（60-100字，来自讲稿原文，口播风格）",
      "needImage": true,
      "imagePrompt": "配图提示词（needImage=true 时必填，描述本页配图主体/风格/构图）",
      "sourceSection": "对应讲稿章节标题（必填，必须严格对应锚点章节之一）"
    }
  ]
}
\`\`\``;

// ─── 页面规划规则（静态主体 + 动态总页数表）───────────────
const PAGE_RULES_STATIC = `### 固定页面（不可省略）
1. **封面**（1页）：课程名、学校/班级、课时信息
2. **课程路线图**（1页）：模块总览，横向流程卡片

### 内容页面（根据讲稿动态决定）

**开场导入**（1-2页）：
- 内容 < 300字 → 1页
- 内容 ≥ 300字 → 2页（任务引入 + 学习目标）

**每个教学模块**（3-5页，根据内容量决定）：
- 必须有：模块导入页（情境/问题引入）
- 必须有：核心概念/知识讲解页（每2个知识点一页，最多4个知识点/页）
- 有操作内容时：操作步骤页（步骤 ≤ 6步可一页，否则拆两页）
- 有评价标准时：验收标准页（勾选清单形式）
- 模块知识点数量 ≤ 2 → 共2页；3-4个 → 共3页；5个以上 → 共4-5页

**课堂练习**（1-2页）：
- 任务说明页（任务描述 + 时间 + 分组要求）
- 评价标准页（如练习有详细标准则单独一页）

**总结收束**（1页）：重点回顾 + 作业要求 + 下节衔接

### speakerNotes 生成规范
- 直接从讲稿对应章节的"教师讲述"部分提取原文
- 保留老师口播语气（不要改成书面语）
- 控制在 80-120 字（严格限制，避免内容过长）
- 包含：过渡词 + 核心内容 + 提问或互动引导`;

const TEXT_RULES = `### 文字内容规范
- \`title\`：8字以内，动词优先（"判断陈列优劣""认识色彩搭配"）
- \`keyContent\`：每条 ≤ 20字，用行动性语言；操作步骤以数字开头；知识点以名词短语
- 禁止：将讲稿口播原文直接作为 keyContent
- 禁止：keyContent 超过 5 条

### imagePrompt 生成规范（Phase-7.6 R4 强制要求）
- 当 needImage=true 时，imagePrompt 必填，且必须 ≥ 20 字
- 内容包含：图主体描述 + 风格关键词 + 构图提示
- 禁止只写"配图""相关图片"等空洞词
- 与该页 keyContent 主题对应，避免偏题

### sourceSection 生成规范（Phase-7.6 R5 跨阶段对应）
- 必须从讲稿章节锚点列表中精确选取一个章节标题
- 不允许虚构章节名（如讲稿没有"模块5"，PPT 不能有"模块5"页）
- sourceSection 缺失或不在锚点列表中 → confirm 阶段会被 quality.js 标 error`;

// ─── 总页数表（按 totalHours 动态）────────────────────────
function _buildPageCountGuide(totalHours) {
  const hours = Number(totalHours) || 1;
  const recommendation = hours <= 1 ? '8-12 页'
    : hours <= 2 ? '14-18 页'
    : hours <= 4 ? '22-30 页'
    : '30-40 页';
  return `### 总页数参考（本课程 ${hours} 学时）

建议总页数：**${recommendation}**

| 课时 | 建议总页数 |
|------|---------|
| 1学时 | 8-12页 |
| 2学时 | 14-18页 |
| 4学时 | 22-30页 |
| 6学时 | 30-40页 |`;
}

// ─── 上下文校验 ────────────────────────────────────────
function _normalizeContext(ctx) {
  const c = ctx || {};
  return {
    totalHours: Math.max(1, Number(c.totalHours) || 1),
    hasLectureSections: Boolean(c.hasLectureSections),
  };
}

// ─── 公共 API ────────────────────────────────────────
/**
 * 构造 ppt-plan-generator 的 systemPrompt fragment 列表。
 *
 * @param {Object} ctx
 * @param {number} ctx.totalHours - 课时数（用于动态总页数指引）
 * @param {boolean} [ctx.hasLectureSections] - 是否有讲稿章节锚点（标志 sourceSection 必填强度）
 * @returns {Array<{meta, content}>}
 */
function buildPptPlanSystemFragments(ctx) {
  const c = _normalizeContext(ctx);

  return [
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'ppt_plan_role_definition',
        priority: 50,
        source: `${SOURCE_PREFIX}#role`,
        lifetime: LIFETIME.PERSISTENT,
        scope: 'ppt_plan_stage',
      },
      content: ROLE_DEFINITION,
    },
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'ppt_plan_page_rules',
        priority: 50,
        source: `${SOURCE_PREFIX}#page-rules`,
        lifetime: LIFETIME.PERSISTENT,
        scope: 'ppt_plan_stage',
      },
      content: `## 页面规划规则\n\n${PAGE_RULES_STATIC}`,
    },
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'ppt_plan_text_rules',
        priority: 50,
        source: `${SOURCE_PREFIX}#text-rules`,
        lifetime: LIFETIME.PERSISTENT,
        scope: 'ppt_plan_stage',
      },
      content: TEXT_RULES,
    },
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'ppt_plan_page_count',
        priority: 50,
        source: `${SOURCE_PREFIX}#page-count`,
        lifetime: LIFETIME.SINGLE_CALL,    // 动态：依赖 totalHours
        scope: 'ppt_plan_stage',
      },
      content: _buildPageCountGuide(c.totalHours),
    },
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'ppt_plan_output_format',
        priority: 50,
        source: `${SOURCE_PREFIX}#output`,
        lifetime: LIFETIME.PERSISTENT,
        scope: OUTPUT_STYLE_SCOPE,         // 关键：scope=output_style，prompt-assembler 排到末尾 slot
      },
      content: `## 输出格式\n\n${OUTPUT_FORMAT}`,
    },
  ];
}

/**
 * 旧路径回滚函数：直接从 prompts/ppt-plan.md 加载原文。
 * 当 USE_ASSEMBLER 开关关闭时调用，保证业务行为可一键回滚。
 */
function buildPptPlanSystemPromptLegacy() {
  const promptPath = path.join(__dirname, '../../../../prompts/ppt-plan.md');
  return fs.readFileSync(promptPath, 'utf8').trim();
}

// ─── 自检 ────────────────────────────────────────
function selfCheck() {
  const cases = [];

  cases.push({
    name: '默认 ctx 返回 5 个 fragment',
    fn: () => {
      const fragments = buildPptPlanSystemFragments({});
      if (fragments.length !== 5) throw new Error(`期望 5，实际 ${fragments.length}`);
    },
  });

  cases.push({
    name: '每个 fragment 完整 meta + 非空 content',
    fn: () => {
      const fragments = buildPptPlanSystemFragments({ totalHours: 4 });
      for (const f of fragments) {
        if (!f.meta?.id || !f.meta.source || typeof f.meta.priority !== 'number') {
          throw new Error(`缺 meta: ${JSON.stringify(f.meta)}`);
        }
        if (!f.content || f.content.length < 5) throw new Error(`空 content: ${f.meta.id}`);
      }
    },
  });

  cases.push({
    name: 'output_format 标 scope=output_style',
    fn: () => {
      const fragments = buildPptPlanSystemFragments({});
      const output = fragments.find(f => f.meta.id === 'ppt_plan_output_format');
      if (output.meta.scope !== OUTPUT_STYLE_SCOPE) {
        throw new Error(`期望 scope=${OUTPUT_STYLE_SCOPE}，实际 ${output.meta.scope}`);
      }
    },
  });

  cases.push({
    name: '页数指引根据 totalHours 动态变化',
    fn: () => {
      const f1 = buildPptPlanSystemFragments({ totalHours: 1 });
      const f4 = buildPptPlanSystemFragments({ totalHours: 4 });
      const c1 = f1.find(x => x.meta.id === 'ppt_plan_page_count').content;
      const c4 = f4.find(x => x.meta.id === 'ppt_plan_page_count').content;
      if (!c1.includes('8-12')) throw new Error('1 学时应建议 8-12 页');
      if (!c4.includes('22-30')) throw new Error('4 学时应建议 22-30 页');
    },
  });

  cases.push({
    name: '装配后顺序：output_format 在末尾',
    fn: () => {
      const { assemble } = require('../prompt-assembler');
      const fragments = buildPptPlanSystemFragments({ totalHours: 2 });
      const out = assemble(fragments);
      const outputIdx = out.indexOf('ppt_plan_output_format');
      const roleIdx = out.indexOf('ppt_plan_role_definition');
      if (outputIdx < roleIdx) throw new Error('output_format 应在 role 之后（末尾 slot）');
    },
  });

  cases.push({
    name: 'imagePrompt 强制要求 + sourceSection 强制要求 进入 prompt',
    fn: () => {
      const fragments = buildPptPlanSystemFragments({});
      const text = fragments.map(f => f.content).join('\n');
      if (!text.includes('imagePrompt')) throw new Error('应含 imagePrompt 规范');
      if (!text.includes('sourceSection')) throw new Error('应含 sourceSection 规范');
    },
  });

  cases.push({
    name: 'legacy 函数返回 ppt-plan.md 原文',
    fn: () => {
      const legacy = buildPptPlanSystemPromptLegacy();
      if (typeof legacy !== 'string' || legacy.length < 200) throw new Error('legacy 内容过短');
      if (!legacy.includes('PPT 页面规划专家')) throw new Error('legacy 应含原文 marker');
    },
  });

  let passed = 0;
  const failures = [];
  for (let i = 0; i < cases.length; i++) {
    try { cases[i].fn(); passed++; }
    catch (e) { failures.push({ caseIndex: i + 1, name: cases[i].name, message: e.message }); }
  }
  return { passed, total: cases.length, failures, success: failures.length === 0 };
}

module.exports = {
  buildPptPlanSystemFragments,
  buildPptPlanSystemPromptLegacy,
  ROLE_DEFINITION, OUTPUT_FORMAT, PAGE_RULES_STATIC, TEXT_RULES,
  selfCheck,
};
