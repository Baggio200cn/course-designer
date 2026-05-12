/**
 * formal.builder.js — formal-generator segSystemPrompt 的 fragment 装配构造器（Phase-6 M1.4.4）
 *
 * 职责：将 formal-generator.js 第 947-972 行的 segSystemPrompt 数组拼接逻辑，
 *      按 Harness 治理体系拆分为 8 个可识别的 fragment。
 *
 * 与 abc.builder 的关键差异：
 *  - 本 builder 接收 context 参数（segmentCount / segIndex / segLabel / localSegModuleCount /
 *    isFirst / isLast），因为 segSystemPrompt 中有 6 个动态变量
 *  - 部分 fragment 是 SINGLE_CALL 生命周期（每次分段调用都不同）
 *  - task_goal / project_rule 等运行时类型也参与装配（不只是 product_default）
 *
 * 8 个 fragment 拆分依据（一一对应原行号）：
 *   原 line 948  → product_default: formal_role_definition         （静态）
 *   原 line 949-951 → task_goal:    formal_task_goal               （动态：segmentCount）
 *   原 line 952  → product_default + output_style: formal_output_format  （静态）
 *   原 line 953-959 → product_default: formal_quality_standard     （动态：localSegModuleCount/segmentCount）
 *   原 line 960  → project_rule:   formal_opening_rule             （动态：isFirst）
 *   原 line 961  → project_rule:   formal_closing_rule             （动态：isLast）
 *   原 line 963  → product_default: formal_core_speaking           （静态）
 *   原 line 964-971 → platform_safety: formal_forbidden_descriptions （静态，多行）
 *
 * 装配后的 SLOT 顺序：
 *   1. platform_safety       — formal_forbidden_descriptions
 *   2. product_default (主)   — formal_core_speaking / formal_quality_standard / formal_role_definition (按 id 升序)
 *   3. project_rule          — formal_closing_rule / formal_opening_rule (按 id 升序)
 *   4. task_goal             — formal_task_goal
 *   5. product_default (output_style) — formal_output_format
 *
 * 注意：本 builder 不引入新的指令文字，所有内容与原 segSystemPrompt 字节一致。
 */

const { FRAGMENT_TYPE, LIFETIME } = require('../source-registry');
const { OUTPUT_STYLE_SCOPE } = require('../prompt-assembler');

const SOURCE_PREFIX = 'src/main/script/formal-generator.js#segSystemPrompt';

// ─── 静态内容常量（逐字保留原文）──────────────────────────
const ROLE_DEFINITION = '你是中职课程正式讲稿写作专家。';

const OUTPUT_FORMAT = '输出规范：JSON 对象 {"script":"Markdown格式的正式讲稿"}。';

const CORE_SPEAKING_RULE = '【最重要的规则】每个模块的"教师讲述"必须是老师真正会说出口的课堂口播正文。';

const FORBIDDEN_DESCRIPTIONS = [
  '绝对禁止以下"教学设计备注"出现在讲稿中：',
  '  × "学完这一段，学生应该能够针对..."',
  '  × "这里有一个常见误区..."',
  '  × "这一段要把XX讲成一条连续判断链..."',
  '  × "这一部分围绕XX展开，先把当前环节要解决的课堂问题交代清楚"',
  '  × "重点要把XX之间的关系讲清楚"',
  '这些是备课笔记，不是讲课稿。讲稿中只写老师对学生说的话。',
  '正确的写法：用案例引入→提问互动→讲解知识→回收总结。像真人老师一样讲课。',
].join('\n');

const QUALITY_STANDARD_SINGLE = '质量标准：教师讲述2200-3000字，推进词覆盖，提问≥10个。';

const TASK_SINGLE = '核心任务：基于已选候选讲稿，深度生成一版可直接上课使用的正式讲稿。';

// Phase-8.5（2026-05-09）：五段式教学结构硬约束
// 触发原因：试点老师反馈 v3.1.0 正式稿"专业性和素材融合度没有明显提升"
// 详见 .claude/notes/2026-05-08-teacher-feedback-formal-script.md
const FIVE_STEP_TEACHING_RULE = [
  '【五段式教学结构硬约束——Phase-8.5】',
  '每个核心知识点（不是每段话，是每个核心知识点）必须包含完整的 5 段教学动作：',
  '  📺 投影展示：指明投影展示什么真实资料（含来源，如"Adobe Photoshop 官方 Select Subject 教程截图"）',
  '  👀 学生观察：让学生从展示资料里观察什么具体细节（如"观察主体抠出后边缘是否带杂色"）',
  '  🎤 教师讲解：基于资料里的具体专业名词、参数、操作步骤展开（如"Select Subject 通过 AI 一键完成主体识别，再配合图层蒙版调整边缘"）',
  '  ✋ 学生操作：让学生在软件里做什么具体动作（含参数，如"导入 T 恤产品图，使用选择主体抠出，将产品图放大到画面约 60%"）',
  '  ✓ 评价标准：4-6 个可观察、可量化的指标（如"标题与产品图是否左/中轴对齐 / 核心卖点字号是否为辅助文字 2 倍以上 / LOGO 面积是否在画面 5%-10%"）',
  '',
  '【反面示例——禁止这样写】',
  '  × "对齐对象"（笼统，没说什么对象、什么对齐方式、什么参数）',
  '  × "新建文档、替换素材"（教学动作说明等于没说）',
  '  × "符合四大排版原则"（评价标准笼统，无可观察指标）',
  '  × "大家要认真学习"、"有任何问题随时问我"（通用话术，不是专业讲解）',
  '',
  '【关于参考素材】如老师在 reference_material 段贴了素材：',
  '  - 必须把素材里的具体功能名（如 Select Subject / Brand Kit / 段落样式）嵌入"教师讲解"和"学生操作"两段',
  '  - 不允许只在讲稿里提到素材里的软件名而不引用具体功能（如只说"Photoshop"不说"Select Subject"）',
  '  - 五段式中"投影展示"段必须明确指出该素材的来源 URL 或文档名',
].join('\n');

// Phase-8.5：课时连贯性约束（基于总学时动态生成）
function _buildTimelineRule(c) {
  const totalHours = Number(c.totalHours) || 0;
  if (totalHours > 0 && totalHours <= 1.5) {
    return [
      '【课时连贯性约束——本课程总学时 ' + totalHours + '，即一节 90 分钟内完成】',
      '× 禁止使用"上节课我们学了..."、"下节课继续..."等跨节课表述',
      '× 禁止把同一节课内的不同模块说成"上节课/下节课"',
      '✓ 模块间的过渡用"任务 1 / 任务 2 / 任务 3"或"接下来我们做..."等同节内推进语',
    ].join('\n');
  }
  if (totalHours >= 2) {
    return [
      '【课时连贯性约束——本课程总学时 ' + totalHours + '，分多节课完成】',
      '✓ 允许"上节课我们学了..."等跨节课表述，但必须明确"上节课"指的具体内容',
      '✓ 模块间过渡要符合实际课节划分，不要把同一节内的内容拆成"上下节"',
    ].join('\n');
  }
  return '';
}

const OPENING_REQUIRED = '必须包含开场导入章节。';
const OPENING_SKIP = '不需要开场导入，直接从模块内容开始。';

const CLOSING_REQUIRED = '必须包含课堂练习与检查和总结收束章节。到总结收束的课堂动作后立即结束。';
const CLOSING_SKIP = '不需要总结收束，在最后一个模块结束后停止。';

// ─── 上下文校验 ──────────────────────────────────────────
/**
 * 归一化并校验 context 参数。
 * 缺省值与原 formal-generator.js 行为保持一致：
 *  - segmentCount 缺省 1（单段模式）
 *  - segIndex 缺省 0
 *  - segLabel 缺省 ''
 *  - localSegModuleCount 缺省 1（避免除零）
 *  - isFirst/isLast 缺省 true（单段必为首段且末段）
 */
function _normalizeContext(ctx) {
  const c = ctx || {};
  return {
    segmentCount: Math.max(1, Number(c.segmentCount) || 1),
    segIndex: Math.max(0, Number(c.segIndex) || 0),
    segLabel: typeof c.segLabel === 'string' ? c.segLabel : '',
    localSegModuleCount: Math.max(1, Number(c.localSegModuleCount) || 1),
    isFirst: c.isFirst !== false,   // 默认 true
    isLast: c.isLast !== false,     // 默认 true
    // Phase-8.5：注入 totalHours 用于课时连贯性约束
    totalHours: Number(c.totalHours) || 0,
  };
}

// ─── 动态内容构造（与原代码字面表达逐字对应）──────────────────
function _buildTaskContent(c) {
  return c.segmentCount > 1
    ? `当前任务：生成${c.segmentCount}课时课程的第${c.segIndex + 1}课时正式讲稿${c.segLabel}。`
    : TASK_SINGLE;
}

function _buildQualityContent(c) {
  if (c.segmentCount > 1) {
    // 与原 formal-generator.js 行 955-958 的 `+` 拼接逐字一致
    return `质量标准：本段教师讲述总计必须达到 2200-3000 字（本段共${c.localSegModuleCount}个模块，` +
      `每个模块"教师讲述"不少于${Math.round(1800 / c.localSegModuleCount)}字，` +
      `写 3-5 句连续口播正文，不要写成摘要式短句）；` +
      `推进词覆盖；提问≥${Math.max(3, Math.round(10 / c.segmentCount))}个。`;
  }
  return QUALITY_STANDARD_SINGLE;
}

function _buildOpeningContent(c) {
  return c.isFirst ? OPENING_REQUIRED : OPENING_SKIP;
}

function _buildClosingContent(c) {
  return c.isLast ? CLOSING_REQUIRED : CLOSING_SKIP;
}

// ─── 公共 API ───────────────────────────────────────────
/**
 * 构造 formal-generator 的 segSystemPrompt fragment 列表。
 *
 * @param {Object} ctx - 运行时上下文
 * @param {number} ctx.segmentCount      - 总段数（>1 多段模式，=1 单段模式）
 * @param {number} ctx.segIndex          - 当前段索引（0-based）
 * @param {string} ctx.segLabel          - 段标签（如 '（第1课时）'）
 * @param {number} ctx.localSegModuleCount - 当前段模块数
 * @param {boolean} ctx.isFirst          - 是否首段（影响开场要求）
 * @param {boolean} ctx.isLast           - 是否末段（影响收束要求）
 * @returns {Array<{meta: Object, content: string}>}
 */
function buildFormalSystemFragments(ctx) {
  const c = _normalizeContext(ctx);

  return [
    // ① 角色定义（静态，PRODUCT_DEFAULT）
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'formal_role_definition',
        priority: 50,
        source: `${SOURCE_PREFIX}:role`,
        lifetime: LIFETIME.PERSISTENT,
        scope: 'lecture_formal_stage',
      },
      content: ROLE_DEFINITION,
    },

    // ② 当前任务（动态，TASK_GOAL）
    {
      meta: {
        type: FRAGMENT_TYPE.TASK_GOAL,
        id: 'formal_task_goal',
        priority: 80,
        source: `${SOURCE_PREFIX}:task`,
        lifetime: LIFETIME.SINGLE_CALL,
        scope: 'lecture_formal_stage',
      },
      content: _buildTaskContent(c),
    },

    // ③ 输出格式（静态，PRODUCT_DEFAULT + output_style scope）
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'formal_output_format',
        priority: 50,
        source: `${SOURCE_PREFIX}:output`,
        lifetime: LIFETIME.PERSISTENT,
        scope: OUTPUT_STYLE_SCOPE,
      },
      content: OUTPUT_FORMAT,
    },

    // ④ 质量标准（动态，PRODUCT_DEFAULT）
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'formal_quality_standard',
        priority: 50,
        source: `${SOURCE_PREFIX}:quality`,
        lifetime: LIFETIME.SINGLE_CALL,
        scope: 'lecture_formal_stage',
      },
      content: _buildQualityContent(c),
    },

    // ⑤ 开场导入规则（动态，PROJECT_RULE）
    {
      meta: {
        type: FRAGMENT_TYPE.PROJECT_RULE,
        id: 'formal_opening_rule',
        priority: 40,
        source: `${SOURCE_PREFIX}:opening`,
        lifetime: LIFETIME.SINGLE_CALL,
        scope: 'lecture_formal_stage',
      },
      content: _buildOpeningContent(c),
    },

    // ⑥ 收束规则（动态，PROJECT_RULE）
    {
      meta: {
        type: FRAGMENT_TYPE.PROJECT_RULE,
        id: 'formal_closing_rule',
        priority: 40,
        source: `${SOURCE_PREFIX}:closing`,
        lifetime: LIFETIME.SINGLE_CALL,
        scope: 'lecture_formal_stage',
      },
      content: _buildClosingContent(c),
    },

    // ⑦ 核心要求（静态，PRODUCT_DEFAULT）
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'formal_core_speaking',
        priority: 50,
        source: `${SOURCE_PREFIX}:core`,
        lifetime: LIFETIME.PERSISTENT,
        scope: 'lecture_formal_stage',
      },
      content: CORE_SPEAKING_RULE,
    },

    // ⑧ 禁忌（静态，PLATFORM_SAFETY）
    {
      meta: {
        type: FRAGMENT_TYPE.PLATFORM_SAFETY,
        id: 'formal_forbidden_descriptions',
        priority: 100,
        source: `${SOURCE_PREFIX}:forbidden`,
        lifetime: LIFETIME.PERSISTENT,
        scope: 'lecture_formal_stage',
      },
      content: FORBIDDEN_DESCRIPTIONS,
    },

    // ⑨ Phase-8.5：五段式教学结构硬约束（静态，PRODUCT_DEFAULT）
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'formal_five_step_teaching_rule',
        priority: 50,
        source: `${SOURCE_PREFIX}:five_step`,
        lifetime: LIFETIME.PERSISTENT,
        scope: 'lecture_formal_stage',
      },
      content: FIVE_STEP_TEACHING_RULE,
    },

    // ⑩ Phase-8.5：课时连贯性约束（动态，PROJECT_RULE）
    ...(c.totalHours > 0 ? [{
      meta: {
        type: FRAGMENT_TYPE.PROJECT_RULE,
        id: 'formal_timeline_consistency',
        priority: 40,
        source: `${SOURCE_PREFIX}:timeline`,
        lifetime: LIFETIME.SINGLE_CALL,
        scope: 'lecture_formal_stage',
      },
      content: _buildTimelineRule(c),
    }] : []),
  ];
}

/**
 * 旧路径回滚函数：返回与 formal-generator.js 改造前 segSystemPrompt 字节一致的字符串。
 *
 * 关键约束：本函数输出必须与原 formal-generator.js 第 947-972 行
 *           `[...].filter(Boolean).join('\n')` 的结果**逐字相同**。
 *           任何修改必须同步比对原始代码。
 */
function buildFormalSystemPromptLegacy(ctx) {
  const c = _normalizeContext(ctx);
  return [
    ROLE_DEFINITION,
    _buildTaskContent(c),
    OUTPUT_FORMAT,
    _buildQualityContent(c),
    _buildOpeningContent(c),
    _buildClosingContent(c),
    '',
    CORE_SPEAKING_RULE,
    // 禁忌段落原代码是分行写的，这里用同一份多行字符串保持等价
    // 但要注意：原代码 filter(Boolean) 过滤掉单独的空字符串，
    // 而禁忌段每行都是非空，所以 join 后等价于把每行都保留下来
    ...FORBIDDEN_DESCRIPTIONS.split('\n'),
  ].filter(Boolean).join('\n');
}

// ─── 自检函数 ────────────────────────────────────────────
/**
 * 内置自检：覆盖单段/多段、首段/中段/末段等组合，
 * 并字节级对比 legacy 输出与原代码硬编码的预期。
 */
function selfCheck() {
  const cases = [];

  // 用例 1：单段默认上下文（无 totalHours）返回 9 个 fragment（Phase-8.5 加了五段式硬约束）
  cases.push(() => {
    const fragments = buildFormalSystemFragments({ segmentCount: 1 });
    if (fragments.length !== 9) throw new Error(`应返回 9 个 fragment（含 Phase-8.5 五段式），实际 ${fragments.length}`);
  });

  // 用例 1b：传 totalHours 后返回 10 个 fragment（多一个课时连贯性约束）
  cases.push(() => {
    const fragments = buildFormalSystemFragments({ segmentCount: 1, totalHours: 1.5 });
    if (fragments.length !== 10) throw new Error(`传 totalHours=1.5 应返回 10 个 fragment，实际 ${fragments.length}`);
    const timeline = fragments.find((f) => f.meta.id === 'formal_timeline_consistency');
    if (!timeline || !timeline.content.includes('禁止使用')) {
      throw new Error(`课时连贯性 fragment 内容错（1.5 学时应禁止"上节课"）`);
    }
  });

  // 用例 1c：五段式 fragment 必含
  cases.push(() => {
    const fragments = buildFormalSystemFragments({ segmentCount: 1 });
    const fiveStep = fragments.find((f) => f.meta.id === 'formal_five_step_teaching_rule');
    if (!fiveStep) throw new Error('缺少 formal_five_step_teaching_rule fragment');
    if (!fiveStep.content.includes('📺 投影展示') || !fiveStep.content.includes('✓ 评价标准')) {
      throw new Error('五段式 fragment 内容缺失关键段');
    }
  });

  // 用例 2：每个 fragment 完整 meta（id 不重复、priority 数值、source/lifetime 必有）
  cases.push(() => {
    const fragments = buildFormalSystemFragments({ segmentCount: 2, segIndex: 0, isFirst: true, isLast: false });
    const ids = fragments.map((f) => f.meta.id);
    if (new Set(ids).size !== ids.length) throw new Error('id 重复');
    for (const item of fragments) {
      if (typeof item.meta.priority !== 'number') throw new Error(`${item.meta.id} priority 非数值`);
      if (typeof item.meta.source !== 'string' || !item.meta.source) throw new Error(`${item.meta.id} source 缺失`);
      if (typeof item.meta.lifetime !== 'string') throw new Error(`${item.meta.id} lifetime 缺失`);
      if (!item.content) throw new Error(`${item.meta.id} content 为空`);
    }
  });

  // 用例 3：单段模式 task content
  cases.push(() => {
    const fragments = buildFormalSystemFragments({ segmentCount: 1 });
    const task = fragments.find((f) => f.meta.id === 'formal_task_goal');
    if (task.content !== TASK_SINGLE) throw new Error('单段 task 内容错');
  });

  // 用例 4：多段模式 task content 含段号
  cases.push(() => {
    const fragments = buildFormalSystemFragments({
      segmentCount: 4, segIndex: 1, segLabel: '（第2课时）',
      localSegModuleCount: 2, isFirst: false, isLast: false,
    });
    const task = fragments.find((f) => f.meta.id === 'formal_task_goal');
    if (task.content !== '当前任务：生成4课时课程的第2课时正式讲稿（第2课时）。') {
      throw new Error(`多段 task 内容错：${task.content}`);
    }
  });

  // 用例 5：isFirst=true 时 opening 是"必须包含"
  cases.push(() => {
    const f1 = buildFormalSystemFragments({ segmentCount: 2, isFirst: true, isLast: false });
    const o1 = f1.find((f) => f.meta.id === 'formal_opening_rule');
    if (o1.content !== OPENING_REQUIRED) throw new Error('isFirst=true 时 opening 错');

    const f2 = buildFormalSystemFragments({ segmentCount: 2, isFirst: false, isLast: false });
    const o2 = f2.find((f) => f.meta.id === 'formal_opening_rule');
    if (o2.content !== OPENING_SKIP) throw new Error('isFirst=false 时 opening 错');
  });

  // 用例 6：isLast=false 时 closing 是"不需要总结收束..."
  cases.push(() => {
    const fragments = buildFormalSystemFragments({ segmentCount: 2, isFirst: false, isLast: false });
    const closing = fragments.find((f) => f.meta.id === 'formal_closing_rule');
    if (closing.content !== CLOSING_SKIP) throw new Error(`isLast=false closing 错：${closing.content}`);
  });

  // 用例 7：多段质量标准包含动态字数计算
  cases.push(() => {
    const fragments = buildFormalSystemFragments({
      segmentCount: 4, localSegModuleCount: 2, isFirst: true, isLast: false,
    });
    const quality = fragments.find((f) => f.meta.id === 'formal_quality_standard');
    // 1800/2 = 900, 10/4 = 2.5 → round → 3, max(3, 3) = 3
    if (!quality.content.includes('每个模块"教师讲述"不少于900字')) {
      throw new Error(`动态字数计算错：${quality.content}`);
    }
    if (!quality.content.includes('提问≥3个')) {
      throw new Error(`动态提问数计算错：${quality.content}`);
    }
  });

  // 用例 8：legacy 输出在 segmentCount=1 默认 ctx 下与原硬编码字节一致
  cases.push(() => {
    const legacy = buildFormalSystemPromptLegacy({
      segmentCount: 1, segIndex: 0, segLabel: '',
      localSegModuleCount: 4, isFirst: true, isLast: true,
    });
    const expected = [
      '你是中职课程正式讲稿写作专家。',
      '核心任务：基于已选候选讲稿，深度生成一版可直接上课使用的正式讲稿。',
      '输出规范：JSON 对象 {"script":"Markdown格式的正式讲稿"}。',
      '质量标准：教师讲述2200-3000字，推进词覆盖，提问≥10个。',
      '必须包含开场导入章节。',
      '必须包含课堂练习与检查和总结收束章节。到总结收束的课堂动作后立即结束。',
      '【最重要的规则】每个模块的"教师讲述"必须是老师真正会说出口的课堂口播正文。',
      '绝对禁止以下"教学设计备注"出现在讲稿中：',
      '  × "学完这一段，学生应该能够针对..."',
      '  × "这里有一个常见误区..."',
      '  × "这一段要把XX讲成一条连续判断链..."',
      '  × "这一部分围绕XX展开，先把当前环节要解决的课堂问题交代清楚"',
      '  × "重点要把XX之间的关系讲清楚"',
      '这些是备课笔记，不是讲课稿。讲稿中只写老师对学生说的话。',
      '正确的写法：用案例引入→提问互动→讲解知识→回收总结。像真人老师一样讲课。',
    ].join('\n');
    if (legacy !== expected) {
      // 找首个差异位置
      for (let i = 0; i < Math.max(legacy.length, expected.length); i++) {
        if (legacy[i] !== expected[i]) {
          throw new Error(`legacy 输出在第 ${i} 位差异：actual=${JSON.stringify(legacy.slice(Math.max(0, i - 5), i + 15))} expected=${JSON.stringify(expected.slice(Math.max(0, i - 5), i + 15))}`);
        }
      }
      throw new Error(`legacy 长度不一致：${legacy.length} vs ${expected.length}`);
    }
  });

  // 用例 9：legacy 多段中段（非首非末）输出与原代码逻辑一致
  cases.push(() => {
    const legacy = buildFormalSystemPromptLegacy({
      segmentCount: 4, segIndex: 1, segLabel: '（第2课时）',
      localSegModuleCount: 2, isFirst: false, isLast: false,
    });
    // 多段中段应包含：当前任务（含段号）、动态质量标准、不需要开场、不需要总结
    if (!legacy.includes('当前任务：生成4课时课程的第2课时正式讲稿（第2课时）。')) {
      throw new Error('多段 legacy 缺 task');
    }
    if (!legacy.includes('不需要开场导入，直接从模块内容开始。')) {
      throw new Error('多段中段 legacy 缺 skip-opening');
    }
    if (!legacy.includes('不需要总结收束，在最后一个模块结束后停止。')) {
      throw new Error('多段中段 legacy 缺 skip-closing');
    }
  });

  // 用例 10：装配后顺序符合 SLOT_ORDER（platform_safety 最前，output_style 最末）
  cases.push(() => {
    const { assemble } = require('../prompt-assembler');
    const fragments = buildFormalSystemFragments({ segmentCount: 1 });
    const out = assemble(fragments);
    const safetyIdx = out.indexOf('formal_forbidden_descriptions');
    const outputIdx = out.indexOf('formal_output_format');
    const taskIdx = out.indexOf('formal_task_goal');
    if (safetyIdx < 0 || outputIdx < 0 || taskIdx < 0) {
      throw new Error('装配输出缺失关键 fragment');
    }
    if (!(safetyIdx < taskIdx)) throw new Error('platform_safety 应排在 task_goal 之前');
    if (!(taskIdx < outputIdx)) throw new Error('task_goal 应排在 output_style 之前');
  });

  // 用例 11：装配输出可被 unwrap 完整还原 9 段内容（Phase-8.5：含五段式硬约束）
  cases.push(() => {
    const { assemble } = require('../prompt-assembler');
    const { unwrap } = require('../fragment-wrapper');
    const fragments = buildFormalSystemFragments({ segmentCount: 1 });
    const out = assemble(fragments);
    const parsed = unwrap(out);
    if (parsed.length !== 9) throw new Error(`unwrap 数量错：${parsed.length}（应为 9，含 Phase-8.5 五段式）`);
    // 关键内容能被完整还原
    const allContents = parsed.map((p) => p.content).join('\n');
    if (!allContents.includes(ROLE_DEFINITION)) throw new Error('unwrap 缺 role');
    if (!allContents.includes(OUTPUT_FORMAT)) throw new Error('unwrap 缺 output');
    if (!allContents.includes(CORE_SPEAKING_RULE)) throw new Error('unwrap 缺 core');
    if (!allContents.includes(FORBIDDEN_DESCRIPTIONS)) throw new Error('unwrap 缺 forbidden');
    if (!allContents.includes('📺 投影展示')) throw new Error('unwrap 缺五段式 fragment');
  });

  // 用例 12：默认 ctx 时 isFirst/isLast 都为 true（保持单段模式行为）
  cases.push(() => {
    const fragments = buildFormalSystemFragments({});
    const opening = fragments.find((f) => f.meta.id === 'formal_opening_rule');
    const closing = fragments.find((f) => f.meta.id === 'formal_closing_rule');
    if (opening.content !== OPENING_REQUIRED) throw new Error('默认 isFirst 应为 true');
    if (closing.content !== CLOSING_REQUIRED) throw new Error('默认 isLast 应为 true');
  });

  // 执行
  let passed = 0;
  const failures = [];
  for (let i = 0; i < cases.length; i++) {
    try {
      cases[i]();
      passed++;
    } catch (e) {
      failures.push({ caseIndex: i + 1, message: e.message });
    }
  }
  return { passed, total: cases.length, failures, success: failures.length === 0 };
}

module.exports = {
  buildFormalSystemFragments,
  buildFormalSystemPromptLegacy,

  // 内容常量
  ROLE_DEFINITION,
  OUTPUT_FORMAT,
  CORE_SPEAKING_RULE,
  FORBIDDEN_DESCRIPTIONS,
  QUALITY_STANDARD_SINGLE,
  TASK_SINGLE,
  OPENING_REQUIRED,
  OPENING_SKIP,
  CLOSING_REQUIRED,
  CLOSING_SKIP,

  selfCheck,
};
