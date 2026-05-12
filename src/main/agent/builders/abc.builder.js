/**
 * abc.builder.js — abc-generator systemPrompt 的 fragment 装配构造器（Phase-6 M1.4.1）
 *
 * 职责：将原本硬编码在 abc-generator.js 第 851-856 行的 systemPrompt 4 行散文，
 *      按 Harness 治理体系拆分为可识别、可追溯、可调试的 fragment 列表。
 *
 * 设计原则：
 *  - 拆分依据：每行原 prompt 在角色 / 输出格式 / 核心要求 / 安全禁忌中分别属于不同治理层
 *  - 当前阶段：source 字段忠实标注当前真实来源（abc-generator.js 内联），
 *              不做 prompt 文件外迁（H5 允许已有的暂不动，等 Phase-7 统一迁移到 prompts/）
 *  - 行为兼容：fragment 内容文本与原 systemPrompt 逐字相同，仅是组织方式变了
 *  - 不依赖运行时上下文：所有内容都是产品级默认规则，函数无参数
 *
 * 与原 systemPrompt 的对应关系：
 *   原第 1 行（角色定义）          → product_default: abc_role_definition
 *   原第 2 行（输出格式 JSON）      → product_default + scope=output_style: abc_output_format
 *   原第 3 行（核心要求：口播）     → product_default: abc_core_requirement
 *   原第 4 行（绝对禁止：备注）     → platform_safety: abc_forbidden_meta_descriptions
 *
 * 装配后的 SLOT 顺序（由 prompt-assembler 决定）：
 *   1. platform_safety (abc_forbidden_meta_descriptions)  — 最前，建立行为边界
 *   2. product_default (abc_role_definition)              — 角色身份
 *   3. product_default (abc_core_requirement)             — 核心要求
 *   4. product_default + output_style (abc_output_format) — 末尾，最后一锤
 *
 * 这种顺序优于原 4 行散文：
 *  - 安全禁忌前置，模型先建立"不能写备注"的边界，再展开角色行为
 *  - 输出格式最末，模型在准备生成时最后一次看到"输出 JSON"，最不易遗忘
 */

const { FRAGMENT_TYPE, LIFETIME } = require('../source-registry');
const { OUTPUT_STYLE_SCOPE } = require('../prompt-assembler');

// 来源标注：标识 fragment 内容当前的真实出处（用于调试与外迁追踪）
const SOURCE_PREFIX = 'src/main/script/abc-generator.js#systemPrompt';

// ─── 原 systemPrompt 内容（按职责拆分，逐字保留）─────────────
const ROLE_DEFINITION = '你是中职课程讲稿编写专家，擅长把教学框架转化为老师可直接授课的课堂口播讲稿。';

// 注意：以下三段引号使用 U+201C/U+201D 中文引号（非 ASCII 直引号），与
// abc-generator.js 第 853-855 行原硬编码逐字一致。任何修改必须同步比对原文。
const OUTPUT_FORMAT = '输出规范：JSON 格式 {“a”:””,”b”:””,”c”:””}。';

const CORE_REQUIREMENT = '核心要求：每个模块的”教师讲述”必须是老师真正会说出口的话——包含具体案例、数据、提问、互动，像站在讲台上对着学生说话。';

const FORBIDDEN_META_DESCRIPTIONS = '绝对禁止：不要写教学设计备注（如”学完这一段学生应该能够...”、”这一段要把XX讲成判断链...”），这些是备课笔记不是讲课稿。';

// ─── 公共 API ───────────────────────────────────────────
/**
 * 构造 abc-generator 的 systemPrompt fragment 列表。
 * 返回数组每项形如 { meta, content }，可直接喂给 prompt-assembler.assemble。
 *
 * 当前不接收参数——所有 fragment 都是产品级默认规则，与运行时上下文无关。
 * 未来若需注入项目级或任务级 fragment，应通过新函数（如 buildAbcUserFragments）
 * 提供，避免本函数的 stateless 特性被破坏。
 *
 * @returns {Array<{meta: Object, content: string}>}
 */
function buildAbcSystemFragments() {
  return [
    {
      meta: {
        type: FRAGMENT_TYPE.PLATFORM_SAFETY,
        id: 'abc_forbidden_meta_descriptions',
        priority: 100,
        source: `${SOURCE_PREFIX}:forbidden`,
        lifetime: LIFETIME.PERSISTENT,
        scope: 'lecture_abc_stage',
      },
      content: FORBIDDEN_META_DESCRIPTIONS,
    },
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'abc_role_definition',
        priority: 50,
        source: `${SOURCE_PREFIX}:role`,
        lifetime: LIFETIME.PERSISTENT,
        scope: 'lecture_abc_stage',
      },
      content: ROLE_DEFINITION,
    },
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'abc_core_requirement',
        priority: 50,
        source: `${SOURCE_PREFIX}:core`,
        lifetime: LIFETIME.PERSISTENT,
        scope: 'lecture_abc_stage',
      },
      content: CORE_REQUIREMENT,
    },
    {
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT,
        id: 'abc_output_format',
        priority: 50,
        source: `${SOURCE_PREFIX}:output`,
        lifetime: LIFETIME.PERSISTENT,
        scope: OUTPUT_STYLE_SCOPE,  // 关键：标 output_style，prompt-assembler 会排到末尾 slot
      },
      content: OUTPUT_FORMAT,
    },
  ];
}

/**
 * 工具：返回原 systemPrompt 的"旧路径"字符串（保持与改造前完全一致）。
 *
 * 用途：abc-generator.js 中的 USE_ASSEMBLER 开关一旦关闭，应回退到此函数，
 *      保证业务行为可一键回滚。
 */
function buildAbcSystemPromptLegacy() {
  return [
    ROLE_DEFINITION,
    OUTPUT_FORMAT,
    CORE_REQUIREMENT,
    FORBIDDEN_META_DESCRIPTIONS,
  ].join('\n');
}

// ─── 自检函数 ────────────────────────────────────────────
/**
 * 内置自检：验证 buildAbcSystemFragments 输出符合预期。
 * 失败抛错，成功返回 { passed, total }。
 */
function selfCheck() {
  const cases = [];

  // 用例 1：返回恰好 4 个 fragment
  cases.push(() => {
    const fragments = buildAbcSystemFragments();
    if (fragments.length !== 4) throw new Error(`应返回 4 个 fragment，实际 ${fragments.length}`);
  });

  // 用例 2：每个 fragment 都有完整 meta 和非空 content
  cases.push(() => {
    const fragments = buildAbcSystemFragments();
    for (const item of fragments) {
      if (!item.meta || !item.content) throw new Error('fragment 缺 meta 或 content');
      if (typeof item.meta.id !== 'string' || !item.meta.id) throw new Error('fragment.meta.id 缺失');
      if (typeof item.meta.source !== 'string' || !item.meta.source) throw new Error('fragment.meta.source 缺失');
      if (typeof item.meta.priority !== 'number') throw new Error('fragment.meta.priority 非数值');
      if (typeof item.meta.lifetime !== 'string') throw new Error('fragment.meta.lifetime 非字符串');
    }
  });

  // 用例 3：4 段内容与原硬编码 systemPrompt 完全一致（逐字）
  cases.push(() => {
    const fragments = buildAbcSystemFragments();
    const byId = Object.fromEntries(fragments.map((f) => [f.meta.id, f.content]));
    if (byId.abc_role_definition !== ROLE_DEFINITION) throw new Error('role 内容不一致');
    if (byId.abc_output_format !== OUTPUT_FORMAT) throw new Error('output 内容不一致');
    if (byId.abc_core_requirement !== CORE_REQUIREMENT) throw new Error('core 内容不一致');
    if (byId.abc_forbidden_meta_descriptions !== FORBIDDEN_META_DESCRIPTIONS) throw new Error('forbidden 内容不一致');
  });

  // 用例 4：output_format 标记 scope=output_style
  cases.push(() => {
    const fragments = buildAbcSystemFragments();
    const output = fragments.find((f) => f.meta.id === 'abc_output_format');
    if (!output) throw new Error('未找到 abc_output_format fragment');
    if (output.meta.scope !== OUTPUT_STYLE_SCOPE) {
      throw new Error(`output_format scope 应为 "${OUTPUT_STYLE_SCOPE}"，实际 "${output.meta.scope}"`);
    }
  });

  // 用例 5：装配后顺序符合预期 SLOT 排序
  cases.push(() => {
    const { assemble } = require('../prompt-assembler');
    const fragments = buildAbcSystemFragments();
    const out = assemble(fragments);
    const safetyIdx = out.indexOf('abc_forbidden_meta_descriptions');
    const roleIdx = out.indexOf('abc_role_definition');
    const coreIdx = out.indexOf('abc_core_requirement');
    const outputIdx = out.indexOf('abc_output_format');
    if (safetyIdx < 0 || roleIdx < 0 || coreIdx < 0 || outputIdx < 0) {
      throw new Error('装配输出缺少某个 fragment id');
    }
    if (!(safetyIdx < roleIdx)) {
      throw new Error(`platform_safety 未排在最前：safety=${safetyIdx}, role=${roleIdx}`);
    }
    if (!(coreIdx < outputIdx)) {
      throw new Error(`output_style 未排在末尾：core=${coreIdx}, output=${outputIdx}`);
    }
  });

  // 用例 6：装配输出可被 unwrap 完整还原 4 段内容
  cases.push(() => {
    const { assemble } = require('../prompt-assembler');
    const { unwrap } = require('../fragment-wrapper');
    const fragments = buildAbcSystemFragments();
    const out = assemble(fragments);
    const parsed = unwrap(out);
    if (parsed.length !== 4) throw new Error(`unwrap 数量错：${parsed.length}`);
    const allContents = parsed.map((p) => p.content);
    if (!allContents.includes(ROLE_DEFINITION)) throw new Error('unwrap 未还原 role');
    if (!allContents.includes(OUTPUT_FORMAT)) throw new Error('unwrap 未还原 output');
    if (!allContents.includes(CORE_REQUIREMENT)) throw new Error('unwrap 未还原 core');
    if (!allContents.includes(FORBIDDEN_META_DESCRIPTIONS)) throw new Error('unwrap 未还原 forbidden');
  });

  // 用例 7：legacy 路径返回原硬编码 systemPrompt 字符串（字节级一致）
  cases.push(() => {
    const legacy = buildAbcSystemPromptLegacy();
    const expected = [
      '你是中职课程讲稿编写专家，擅长把教学框架转化为老师可直接授课的课堂口播讲稿。',
      '输出规范：JSON 格式 {“a”:””,”b”:””,”c”:””}。',
      '核心要求：每个模块的”教师讲述”必须是老师真正会说出口的话——包含具体案例、数据、提问、互动，像站在讲台上对着学生说话。',
      '绝对禁止：不要写教学设计备注（如”学完这一段学生应该能够...”、”这一段要把XX讲成判断链...”），这些是备课笔记不是讲课稿。',
    ].join('\n');
    if (legacy !== expected) {
      throw new Error('legacy 路径输出与原 systemPrompt 字节不一致——回滚保证失效！');
    }
  });

  // 用例 8：fragment id 在数组内不重复（防止 assembler 抛错）
  cases.push(() => {
    const fragments = buildAbcSystemFragments();
    const ids = fragments.map((f) => f.meta.id);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new Error('fragment id 重复');
    }
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
  // 主入口
  buildAbcSystemFragments,
  buildAbcSystemPromptLegacy,

  // 内容常量（供回滚开关 / 调试 / 测试断言使用）
  ROLE_DEFINITION,
  OUTPUT_FORMAT,
  CORE_REQUIREMENT,
  FORBIDDEN_META_DESCRIPTIONS,

  // 测试辅助
  selfCheck,
};
