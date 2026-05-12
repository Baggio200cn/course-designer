/**
 * platform-safety.builder.js — 业务级全局安全基线（Phase-6 M4.2）
 *
 * 职责：把所有 LLM 生成场景共享的"业务级硬红线"抽出为 PLATFORM_SAFETY fragment，
 *      由 prompt-assembler 在装配时统一前置注入，避免每个 builder 重复定义同一类禁忌。
 *
 * 与 CLAUDE.md 第二节 H1-H8 的关键区别：
 *  - H1-H8 是写给"开发者（Claude Code）"的元规则——指导如何修改代码（如"不要修改 contracts.js"）
 *  - 本 builder 是写给"业务 LLM（DeepSeek-V3/Ark）"的运行时硬约束——指导生成内容的边界
 *  - 两者互不重叠：H1-H8 不进 LLM systemPrompt，本基线不进开发者文档
 *
 * 4 条业务级全局基线：
 *  ① no_meta_descriptions    禁"教学设计备注式"句式（原 abc/formal 各自维护，统一抽离）
 *  ② no_ai_tone              禁 AI 腔与空话套话
 *  ③ vocational_redlines     职业教育垂直红线（具体术语 / 真实案例 / 三维目标 / 可巡视动作）
 *  ④ factual_grounding       内容真实性约束（仅依据上下文 + 上游 artifact + 通用规范）
 *
 * 按 stage 提供差异化基线（getBaselineForStage）：
 *  - 'lecture' / 'global'：全部 4 条
 *  - 'framework'：①③④（框架是结构化 JSON，不需要 ②no_ai_tone）
 *  - 'ppt'：全部 4 条
 *  - 'video'：①②④（视频提示词是分镜文本，③vocational_redlines 关联弱）
 *
 * 装配后所有基线 fragment 的 SLOT 落点：PLATFORM_SAFETY (slot 0)，最前。
 *
 * 单文件不超过 600 行（CLAUDE.md 第七节）
 */

const { FRAGMENT_TYPE, LIFETIME } = require('../source-registry');

// 来源标注：本 builder 内的内容是"业务级全局基线"，与 CLAUDE.md H1-H8 无关
const SOURCE_PREFIX = 'src/main/agent/builders/platform-safety.builder.js';
const BASELINE_SCOPE = 'global_baseline';

// ─── 4 条基线常量（全文，可直接 join 注入 LLM）──────────
const NO_META_DESCRIPTIONS = [
  '绝对禁止"教学设计备注式"句式出现在生成内容中：',
  '  × "学完这一段，学生应该能够..."',
  '  × "这里有一个常见误区..."',
  '  × "这一段要把XX讲成一条连续判断链..."',
  '  × "这一部分围绕XX展开，先把当前环节要解决的课堂问题交代清楚"',
  '  × "重点要把XX之间的关系讲清楚"',
  '这些是教师备课笔记的元描述，不是面向学生的口播或可执行内容。',
  '正确写法：用案例引入 → 具体提问 → 知识讲解 → 回收总结，写"老师真正会说的话"。',
].join('\n');

const NO_AI_TONE = [
  '禁止使用以下 AI 腔/空话/套话：',
  '  × "总而言之...综上所述...让我们一起..."',
  '  × "我们都知道...众所周知...毫无疑问..."',
  '  × 过度通用的形容词堆砌（如"重要的、关键的、核心的"在同一段内反复出现）',
  '  × 抽象口号式总结（如"这就是XX的精髓所在..."）',
  '要求：用具体动词、具体数字、具体动作描述，避免抽象总结与万能表达。',
].join('\n');

const VOCATIONAL_REDLINES = [
  '面向职业院校教学的硬红线（不可违反）：',
  '  × 不得用泛指术语替代具体软件名（如用"三维设计软件"替代"3ds Max 2024"）',
  '  × 不得编造非真实的行业案例、品牌或公司名',
  '  × 教学过程必须遵循"知识/技能/情感"三维目标结构',
  '  × 课堂动作必须可被巡视检查（不能只写抽象描述，要写"投影展示...""巡视检查...""学生回答...等"）',
  '  × 评价点必须明确（不能只写"评价学生表现"，要写具体评价标准）',
].join('\n');

const FACTUAL_GROUNDING = [
  '生成内容必须基于以下三类来源，不得自行虚构：',
  '  ① 用户提供的课程上下文（softwareTools / jobTargets / industryScenarios / learnerProfile / teachingMaterials）',
  '  ② 已确认的上游 artifact（如 framework 中的 objectives 与 teachingMethods）',
  '  ③ 通用职业教育规范（如三维目标、模块化结构、过程性评价）',
  '不得：',
  '  × 假设未在上下文中出现的事实',
  '  × 自创不存在的专业术语',
  '  × 编造数据、案例、品牌或人物',
].join('\n');

// ─── 基线条目元数据表 ────────────────────────────────
// 每条基线保存（id, content, applicableStages）
const BASELINE_ITEMS = Object.freeze([
  {
    id: 'baseline_no_meta_descriptions',
    content: NO_META_DESCRIPTIONS,
    applicableStages: ['lecture', 'ppt', 'global'],   // framework 是 JSON 结构，不需要这条
  },
  {
    id: 'baseline_no_ai_tone',
    content: NO_AI_TONE,
    applicableStages: ['lecture', 'ppt', 'video', 'global'],  // framework 同上
  },
  {
    id: 'baseline_vocational_redlines',
    content: VOCATIONAL_REDLINES,
    applicableStages: ['framework', 'lecture', 'ppt', 'global'],  // video 关联弱
  },
  {
    id: 'baseline_factual_grounding',
    content: FACTUAL_GROUNDING,
    applicableStages: ['framework', 'lecture', 'ppt', 'video', 'global'],
  },
]);

// 已知 stage 集合（用于参数校验）
const KNOWN_STAGES = Object.freeze(['framework', 'lecture', 'ppt', 'video', 'global']);

// ─── 公共 API ────────────────────────────────────────
/**
 * 构造业务级 PLATFORM_SAFETY 基线 fragment 列表。
 *
 * @param {string} [stage='global'] - 'framework' / 'lecture' / 'ppt' / 'video' / 'global'
 *                                     未知或缺省 → 返回全部基线（'global'）
 * @returns {Array<{meta: Object, content: string}>}
 */
function buildPlatformSafetyBaselineFragments(stage) {
  const normalizedStage = KNOWN_STAGES.includes(stage) ? stage : 'global';
  const items = BASELINE_ITEMS.filter((item) => item.applicableStages.includes(normalizedStage));

  return items.map((item) => ({
    meta: {
      type: FRAGMENT_TYPE.PLATFORM_SAFETY,
      id: item.id,
      priority: 100,
      source: `${SOURCE_PREFIX}#${item.id}`,
      lifetime: LIFETIME.PERSISTENT,
      scope: BASELINE_SCOPE,
    },
    content: item.content,
  }));
}

/**
 * 工具：返回某 stage 适用的基线 id 列表（不含完整 content，便于轻量决策）。
 */
function getBaselineIdsForStage(stage) {
  const normalizedStage = KNOWN_STAGES.includes(stage) ? stage : 'global';
  return BASELINE_ITEMS
    .filter((item) => item.applicableStages.includes(normalizedStage))
    .map((item) => item.id);
}

/**
 * 工具：判断给定 fragment id 是否属于本 builder 注册的基线（用于 prompt-assembler 去重）。
 */
function isBaselineFragmentId(fragmentId) {
  if (typeof fragmentId !== 'string') return false;
  return BASELINE_ITEMS.some((item) => item.id === fragmentId);
}

// ─── 自检 ────────────────────────────────────────────
function selfCheck() {
  const cases = [];

  // 用例 1：默认（无 stage）返回全部 4 条
  cases.push(() => {
    const fragments = buildPlatformSafetyBaselineFragments();
    if (fragments.length !== 4) {
      throw new Error(`默认应返回 4 条基线，实际 ${fragments.length}`);
    }
  });

  // 用例 2：'global' stage 返回全部 4 条
  cases.push(() => {
    const fragments = buildPlatformSafetyBaselineFragments('global');
    if (fragments.length !== 4) throw new Error(`global 应返回 4 条`);
  });

  // 用例 3：'framework' 不含 no_meta_descriptions / no_ai_tone
  cases.push(() => {
    const fragments = buildPlatformSafetyBaselineFragments('framework');
    const ids = fragments.map((f) => f.meta.id);
    if (ids.includes('baseline_no_meta_descriptions')) {
      throw new Error('framework 不应含 no_meta_descriptions（JSON 结构无关）');
    }
    if (ids.includes('baseline_no_ai_tone')) {
      throw new Error('framework 不应含 no_ai_tone（JSON 结构无关）');
    }
    if (!ids.includes('baseline_vocational_redlines')) {
      throw new Error('framework 应含 vocational_redlines');
    }
    if (!ids.includes('baseline_factual_grounding')) {
      throw new Error('framework 应含 factual_grounding');
    }
  });

  // 用例 4：'lecture' 含全部 4 条
  cases.push(() => {
    const fragments = buildPlatformSafetyBaselineFragments('lecture');
    if (fragments.length !== 4) {
      throw new Error(`lecture 应含 4 条，实际 ${fragments.length}`);
    }
  });

  // 用例 5：'video' 不含 vocational_redlines（关联弱）
  cases.push(() => {
    const fragments = buildPlatformSafetyBaselineFragments('video');
    const ids = fragments.map((f) => f.meta.id);
    if (ids.includes('baseline_vocational_redlines')) {
      throw new Error('video 不应含 vocational_redlines');
    }
  });

  // 用例 6：未知 stage 回退到 global（4 条）
  cases.push(() => {
    const fragments = buildPlatformSafetyBaselineFragments('unknown_stage_xxx');
    if (fragments.length !== 4) {
      throw new Error(`未知 stage 应回退 global=4 条，实际 ${fragments.length}`);
    }
  });

  // 用例 7：所有 fragment 都是 PLATFORM_SAFETY 类型 + priority=100 + scope=global_baseline
  cases.push(() => {
    const fragments = buildPlatformSafetyBaselineFragments('lecture');
    for (const f of fragments) {
      if (f.meta.type !== FRAGMENT_TYPE.PLATFORM_SAFETY) {
        throw new Error(`${f.meta.id} type 应为 PLATFORM_SAFETY`);
      }
      if (f.meta.priority !== 100) throw new Error(`${f.meta.id} priority 应为 100`);
      if (f.meta.scope !== BASELINE_SCOPE) throw new Error(`${f.meta.id} scope 应为 ${BASELINE_SCOPE}`);
      if (f.meta.lifetime !== LIFETIME.PERSISTENT) throw new Error(`${f.meta.id} lifetime 应为 PERSISTENT`);
    }
  });

  // 用例 8：内容非空且包含关键禁忌
  cases.push(() => {
    const fragments = buildPlatformSafetyBaselineFragments('lecture');
    for (const f of fragments) {
      if (typeof f.content !== 'string' || f.content.length < 50) {
        throw new Error(`${f.meta.id} content 过短或非字符串`);
      }
    }
    const noMetaContent = fragments.find((f) => f.meta.id === 'baseline_no_meta_descriptions').content;
    if (!noMetaContent.includes('学完这一段')) {
      throw new Error('no_meta_descriptions 应含核心禁忌"学完这一段"');
    }
    const noAiContent = fragments.find((f) => f.meta.id === 'baseline_no_ai_tone').content;
    if (!noAiContent.includes('AI 腔')) throw new Error('no_ai_tone 应含"AI 腔"关键词');
    const factualContent = fragments.find((f) => f.meta.id === 'baseline_factual_grounding').content;
    if (!factualContent.includes('softwareTools')) {
      throw new Error('factual_grounding 应含具体上下文字段名');
    }
  });

  // 用例 9：getBaselineIdsForStage 返回正确 id 列表
  cases.push(() => {
    const ids = getBaselineIdsForStage('framework');
    if (ids.length !== 2) throw new Error(`framework 应有 2 个基线 id，实际 ${ids.length}`);
    if (!ids.includes('baseline_vocational_redlines')) throw new Error('应含 vocational_redlines');
  });

  // 用例 10：isBaselineFragmentId 正确识别
  cases.push(() => {
    if (!isBaselineFragmentId('baseline_no_meta_descriptions')) throw new Error('应识别基线 id');
    if (isBaselineFragmentId('abc_role_definition')) throw new Error('不应识别业务 id');
    if (isBaselineFragmentId('')) throw new Error('空字符串应返回 false');
    if (isBaselineFragmentId(null)) throw new Error('null 应返回 false');
  });

  // 用例 11：装配输出顺序——基线在最前（slot=0 PLATFORM_SAFETY）
  cases.push(() => {
    const { assemble } = require('../prompt-assembler');
    const baseline = buildPlatformSafetyBaselineFragments('lecture');
    const businessFragments = [
      {
        meta: {
          type: FRAGMENT_TYPE.PRODUCT_DEFAULT, id: 'biz_role', priority: 50,
          source: 'test', lifetime: LIFETIME.PERSISTENT, scope: 'lecture_stage',
        },
        content: '业务角色定义',
      },
    ];
    const out = assemble([...baseline, ...businessFragments]);
    const firstBaselineIdx = out.indexOf('baseline_no_meta_descriptions');
    const businessIdx = out.indexOf('biz_role');
    if (firstBaselineIdx === -1) throw new Error('装配输出缺基线');
    if (businessIdx === -1) throw new Error('装配输出缺业务 fragment');
    if (firstBaselineIdx > businessIdx) {
      throw new Error('基线应排在业务 fragment 之前（PLATFORM_SAFETY slot=0）');
    }
  });

  // 用例 12：基线 id 唯一不重复
  cases.push(() => {
    const fragments = buildPlatformSafetyBaselineFragments('global');
    const ids = fragments.map((f) => f.meta.id);
    if (new Set(ids).size !== ids.length) throw new Error('基线 id 重复');
  });

  // 用例 13：H1-H8 字样不出现（避免开发者约束泄漏到 LLM）
  cases.push(() => {
    const fragments = buildPlatformSafetyBaselineFragments('global');
    for (const f of fragments) {
      if (/H[1-8]|contracts\.js|index\.js|quality\.js|npm install/.test(f.content)) {
        throw new Error(`${f.meta.id} 含开发者约束字样，违反"业务级基线"职责边界：${f.content.slice(0, 50)}`);
      }
    }
  });

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
  // 主 API
  buildPlatformSafetyBaselineFragments,
  getBaselineIdsForStage,
  isBaselineFragmentId,

  // 内容常量（供测试断言 & 后续 abc/formal builder 引用消除重复时使用）
  NO_META_DESCRIPTIONS,
  NO_AI_TONE,
  VOCATIONAL_REDLINES,
  FACTUAL_GROUNDING,

  // 元数据表
  BASELINE_ITEMS,
  KNOWN_STAGES,
  BASELINE_SCOPE,

  // 测试辅助
  selfCheck,
};
