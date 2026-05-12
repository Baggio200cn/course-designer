/**
 * prompt-assembler.js — 统一 Prompt 装配器（Phase-6 M1.3）
 *
 * 职责：把一组 fragment（每个含 meta + content）按笔记 §3.2 的"装配位置策略"
 *      排序、包装、串接，产出最终发给 LLM 的 systemPrompt 字符串。
 *
 * 核心洞察（笔记 §3.2 末尾）：
 *  > "最高优先级规则通常应该靠前给出，便于模型建立行为边界；
 *  >  而当前任务、输出格式、历史摘要则靠后注入，便于模型把注意力落到当前要做的事情上。"
 *
 * 因此本装配器把"优先级（priority）"与"装配位置（slot）"解耦：
 *  - priority：冲突解决用（高者覆盖低者，由 source-registry 管理）
 *  - slot：注意力位置用（按 SLOT_ORDER 排，与 priority 数值无关）
 *
 * SLOT_ORDER（数值越小越靠前）：
 *   0  PLATFORM_SAFETY              建立行为边界，必须最前
 *   1  PRODUCT_DEFAULT (主)          产品级默认风格规则（abc-system.md 等）
 *   2  PROJECT_RULE                 项目级数据（notebook 5 字段、framework 上游）
 *   3  MEMORY                       历史课程参考（仅作 few-shot 风格）
 *   4  TASK_GOAL                    当前任务目标（接近末尾，强注意力）
 *   5  RETRY_FEEDBACK               重试反馈（倒数第二，强提醒）
 *   6  PRODUCT_DEFAULT (output_style) 输出格式规则（最末，最后一锤）
 *
 * 注意：output_style 仍属于 PRODUCT_DEFAULT 类型，通过 meta.scope === 'output_style'
 *      区分。这样不需要为输出风格新增类型，符合笔记"类型收敛"原则。
 *
 * 同一 slot 内的二级排序：
 *  - 先按 priority 降序（高优先级在前，便于模型先看到强约束）
 *  - 再按 id 升序（保证 Snapshot Test 字节级稳定）
 *
 * 约束：
 *  - 纯函数：相同输入 → 相同输出，无副作用
 *  - 不读文件：所有 content 由调用方提供（解耦文件系统）
 *  - 不调用 LLM：本层不发出网络请求
 *  - 单文件不超过 600 行
 */

const { FRAGMENT_TYPE } = require('./source-registry');
const { wrap } = require('./fragment-wrapper');

// ─── SLOT 常量 ──────────────────────────────────────────
const SLOT_ORDER = Object.freeze({
  PLATFORM_SAFETY: 0,
  PRODUCT_DEFAULT_MAIN: 1,
  PROJECT_RULE: 2,
  MEMORY: 3,
  TASK_GOAL: 4,
  RETRY_FEEDBACK: 5,
  PRODUCT_DEFAULT_OUTPUT_STYLE: 6,
});

const OUTPUT_STYLE_SCOPE = 'output_style';
const DEFAULT_SEPARATOR = '\n\n';

// ─── 内部工具 ────────────────────────────────────────────
/**
 * 根据 fragment meta 解析其装配位置（slot 编号）。
 * output_style scope 的 product_default 单独排在末尾 slot。
 * 未知 type 抛错（防止静默乱序）。
 */
function _resolveSlot(meta) {
  if (!meta || typeof meta !== 'object') {
    throw new Error('prompt-assembler: meta 必须是对象');
  }
  if (meta.type === FRAGMENT_TYPE.PRODUCT_DEFAULT && meta.scope === OUTPUT_STYLE_SCOPE) {
    return SLOT_ORDER.PRODUCT_DEFAULT_OUTPUT_STYLE;
  }
  switch (meta.type) {
    case FRAGMENT_TYPE.PLATFORM_SAFETY: return SLOT_ORDER.PLATFORM_SAFETY;
    case FRAGMENT_TYPE.PRODUCT_DEFAULT: return SLOT_ORDER.PRODUCT_DEFAULT_MAIN;
    case FRAGMENT_TYPE.PROJECT_RULE: return SLOT_ORDER.PROJECT_RULE;
    case FRAGMENT_TYPE.MEMORY: return SLOT_ORDER.MEMORY;
    case FRAGMENT_TYPE.TASK_GOAL: return SLOT_ORDER.TASK_GOAL;
    case FRAGMENT_TYPE.RETRY_FEEDBACK: return SLOT_ORDER.RETRY_FEEDBACK;
    default:
      throw new Error(`prompt-assembler: 未知 fragment type "${meta.type}"`);
  }
}

/**
 * 比较两个 item（{meta, content}）的装配先后顺序。
 *
 * 三层排序（保证稳定性）：
 *   1. slot 升序（位置策略）
 *   2. priority 降序（同 slot 内强约束在前）
 *   3. id 升序（最终回退保证字节级稳定）
 */
function _compareItems(a, b) {
  const slotA = _resolveSlot(a.meta);
  const slotB = _resolveSlot(b.meta);
  if (slotA !== slotB) return slotA - slotB;
  if (a.meta.priority !== b.meta.priority) return b.meta.priority - a.meta.priority;
  if (a.meta.id < b.meta.id) return -1;
  if (a.meta.id > b.meta.id) return 1;
  return 0;
}

/**
 * 校验 items 数组的合法性。
 * 抛错条件：
 *  - items 非数组
 *  - 任一项缺 meta 或 content
 *  - id 在 items 内重复（同一次装配中不允许同 id 出现两次）
 */
function _validateItems(items) {
  if (!Array.isArray(items)) {
    throw new Error('prompt-assembler: items 必须是数组');
  }
  const seen = new Set();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') {
      throw new Error(`prompt-assembler: items[${i}] 必须是 {meta, content} 对象`);
    }
    if (!item.meta || typeof item.meta !== 'object') {
      throw new Error(`prompt-assembler: items[${i}].meta 必须是对象`);
    }
    if (typeof item.content !== 'string') {
      throw new Error(`prompt-assembler: items[${i}].content 必须是字符串，收到 ${typeof item.content}`);
    }
    const id = item.meta.id;
    if (typeof id !== 'string' || !id) {
      throw new Error(`prompt-assembler: items[${i}].meta.id 必须是非空字符串`);
    }
    if (seen.has(id)) {
      throw new Error(`prompt-assembler: id 重复 "${id}"，同一次装配中不允许同 id 出现两次`);
    }
    seen.add(id);
  }
}

// ─── 公共 API ────────────────────────────────────────────
/**
 * 把一组 fragment 装配为最终的 prompt 字符串。
 *
 * @param {Array<{meta: Object, content: string}>} items - 待装配的 fragment 列表
 * @param {Object} [options]
 * @param {string} [options.separator='\n\n'] - 各 fragment 之间的分隔符
 * @param {boolean} [options.skipEmpty=true] - 是否过滤 content 为空的 fragment
 * @returns {string} 最终的 prompt 字符串
 */
function assemble(items, options = {}) {
  _validateItems(items);
  if (items.length === 0) return '';

  const skipEmpty = options.skipEmpty !== false;
  const separator = typeof options.separator === 'string' ? options.separator : DEFAULT_SEPARATOR;

  const filtered = skipEmpty
    ? items.filter((item) => item.content && item.content.length > 0)
    : items;

  if (filtered.length === 0) return '';

  const sorted = [...filtered].sort(_compareItems);
  return sorted.map(({ meta, content }) => wrap(meta, content)).join(separator);
}

/**
 * 与 assemble 相同，但额外返回装配过程报告（用于调试 / Snapshot Test）。
 *
 * 返回结构：
 *   {
 *     prompt: '...',                      // 最终 prompt 字符串
 *     order: [{ id, type, slot, priority }, ...], // 实际装配顺序
 *     stats: {
 *       fragmentCount: 4,
 *       totalChars: 856,
 *       byType: { platform_safety: 1, product_default: 2, ... },
 *       bySlot: { 0: 1, 1: 2, 2: 1, ... }
 *     }
 *   }
 */
function assembleWithReport(items, options = {}) {
  _validateItems(items);
  const skipEmpty = options.skipEmpty !== false;
  const filtered = skipEmpty
    ? items.filter((item) => item.content && item.content.length > 0)
    : items;

  const sorted = [...filtered].sort(_compareItems);
  const separator = typeof options.separator === 'string' ? options.separator : DEFAULT_SEPARATOR;
  const prompt = sorted.map(({ meta, content }) => wrap(meta, content)).join(separator);

  const order = sorted.map(({ meta }) => ({
    id: meta.id,
    type: meta.type,
    slot: _resolveSlot(meta),
    priority: meta.priority,
  }));

  const byType = {};
  const bySlot = {};
  for (const item of filtered) {
    byType[item.meta.type] = (byType[item.meta.type] || 0) + 1;
    const slot = _resolveSlot(item.meta);
    bySlot[slot] = (bySlot[slot] || 0) + 1;
  }

  return {
    prompt,
    order,
    stats: {
      fragmentCount: filtered.length,
      totalChars: prompt.length,
      byType,
      bySlot,
    },
  };
}

/**
 * 工具方法：从 items 列表中按 type 过滤。
 * 供 stage-specific builder 复用（避免重复 filter 代码）。
 */
function filterByType(items, type) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item.meta && item.meta.type === type);
}

/**
 * Phase-6 M4.2：带全局基线注入的装配。
 *
 * 自动前置 platform-safety.builder 提供的业务级安全基线（4 条 PLATFORM_SAFETY），
 * 让所有 builder 不必各自维护"禁教学设计备注 / 禁 AI 腔 / 职业教育红线 / 真实性约束"。
 *
 * 去重策略：若调用方传入的 fragments 中已有同 id 基线（如手工注入了
 * 'baseline_no_ai_tone'），则保留调用方版本，跳过本次注入——避免 id 冲突。
 *
 * @param {Array} items - 业务 fragment 列表（同 assemble() 的输入）
 * @param {Object} [options]
 * @param {string} [options.stage='global'] - 'framework' / 'lecture' / 'ppt' / 'video' / 'global'
 * @param {boolean} [options.withBaseline=true] - 是否注入基线（false 时回退为普通 assemble）
 * @param {string} [options.separator]
 * @param {boolean} [options.skipEmpty]
 * @returns {string} 最终 prompt
 */
function assembleWithBaseline(items, options = {}) {
  const withBaseline = options.withBaseline !== false;
  if (!withBaseline) return assemble(items, options);

  // 延迟 require 避免循环依赖（platform-safety.builder 也 require 了 source-registry）
  const { buildPlatformSafetyBaselineFragments, isBaselineFragmentId } =
    require('./builders/platform-safety.builder');

  const baseline = buildPlatformSafetyBaselineFragments(options.stage);

  // 去重：调用方已有同 id 的 fragment 则跳过基线注入
  const callerIds = new Set(
    (Array.isArray(items) ? items : [])
      .map((it) => it && it.meta && it.meta.id)
      .filter(Boolean)
  );
  const dedupedBaseline = baseline.filter((b) => !callerIds.has(b.meta.id));

  return assemble([...dedupedBaseline, ...(Array.isArray(items) ? items : [])], options);
}

/**
 * 工具方法：检查 items 是否包含某 id 的 fragment。
 */
function hasFragment(items, id) {
  if (!Array.isArray(items) || typeof id !== 'string') return false;
  return items.some((item) => item.meta && item.meta.id === id);
}

// ─── 自检函数 ────────────────────────────────────────────
/**
 * 内置自检：覆盖 slot 解析、排序、装配、报告等核心场景。
 * 失败抛错，成功返回 { passed, total }。
 */
function selfCheck() {
  const cases = [];

  // 测试用 fragment 构造器
  const F = (type, id, priority, content, scope) => ({
    meta: { type, id, priority, source: `s:${id}`, lifetime: 'session', scope: scope || 'global' },
    content,
  });

  // 用例 1：单个 fragment 装配
  cases.push(() => {
    const out = assemble([F(FRAGMENT_TYPE.PLATFORM_SAFETY, 'a', 100, 'safety')]);
    if (!out.includes('type="platform_safety"')) throw new Error('单 fragment 装配失败');
    if (!out.includes('safety\n</FRAGMENT>')) throw new Error('单 fragment 内容缺失');
  });

  // 用例 2：跨 slot 排序（platform_safety → task_goal → retry_feedback）
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.RETRY_FEEDBACK, 'r', 75, 'retry'),
      F(FRAGMENT_TYPE.TASK_GOAL, 't', 80, 'task'),
      F(FRAGMENT_TYPE.PLATFORM_SAFETY, 'p', 100, 'platform'),
    ];
    const out = assemble(items);
    const pIdx = out.indexOf('platform');
    const tIdx = out.indexOf('task');
    const rIdx = out.indexOf('retry');
    if (!(pIdx < tIdx && tIdx < rIdx)) {
      throw new Error(`slot 顺序错误：platform=${pIdx}, task=${tIdx}, retry=${rIdx}`);
    }
  });

  // 用例 3：同 slot 内 priority 降序
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.PRODUCT_DEFAULT, 'low', 30, 'low_pri'),
      F(FRAGMENT_TYPE.PRODUCT_DEFAULT, 'high', 60, 'high_pri'),
    ];
    const out = assemble(items);
    if (out.indexOf('high_pri') > out.indexOf('low_pri')) {
      throw new Error('同 slot 内未按 priority 降序');
    }
  });

  // 用例 4：同 slot 同 priority 按 id 升序（稳定性）
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.PROJECT_RULE, 'zebra', 40, 'z_content'),
      F(FRAGMENT_TYPE.PROJECT_RULE, 'apple', 40, 'a_content'),
    ];
    const out = assemble(items);
    if (out.indexOf('a_content') > out.indexOf('z_content')) {
      throw new Error('同优先级未按 id 升序');
    }
  });

  // 用例 5：output_style scope 排到末尾
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.PRODUCT_DEFAULT, 'output', 50, 'output_format', 'output_style'),
      F(FRAGMENT_TYPE.PRODUCT_DEFAULT, 'main', 50, 'main_default'),
      F(FRAGMENT_TYPE.RETRY_FEEDBACK, 'retry', 75, 'retry_text'),
    ];
    const out = assemble(items);
    const mainIdx = out.indexOf('main_default');
    const retryIdx = out.indexOf('retry_text');
    const outputIdx = out.indexOf('output_format');
    if (!(mainIdx < retryIdx && retryIdx < outputIdx)) {
      throw new Error(`output_style 应在末尾，实际：main=${mainIdx}, retry=${retryIdx}, output=${outputIdx}`);
    }
  });

  // 用例 6：retry_feedback 在 task_goal 之后（笔记 §3.2 关键诉求）
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.TASK_GOAL, 't', 80, 'task_text'),
      F(FRAGMENT_TYPE.RETRY_FEEDBACK, 'r', 75, 'retry_text'),
    ];
    const out = assemble(items);
    if (out.indexOf('task_text') > out.indexOf('retry_text')) {
      throw new Error('retry_feedback 应在 task_goal 之后（强提醒在末尾）');
    }
  });

  // 用例 7：memory slot 在 task_goal 之前但在 project_rule 之后
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.MEMORY, 'm', 30, 'memory_text'),
      F(FRAGMENT_TYPE.PROJECT_RULE, 'p', 40, 'project_text'),
      F(FRAGMENT_TYPE.TASK_GOAL, 't', 80, 'task_text'),
    ];
    const out = assemble(items);
    const projectIdx = out.indexOf('project_text');
    const memoryIdx = out.indexOf('memory_text');
    const taskIdx = out.indexOf('task_text');
    if (!(projectIdx < memoryIdx && memoryIdx < taskIdx)) {
      throw new Error(`slot 顺序错：project=${projectIdx}, memory=${memoryIdx}, task=${taskIdx}`);
    }
  });

  // 用例 8：assembleWithReport 返回正确 stats 与 order
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.PLATFORM_SAFETY, 'safety', 100, 'safety'),
      F(FRAGMENT_TYPE.PRODUCT_DEFAULT, 'main', 50, 'main'),
      F(FRAGMENT_TYPE.PROJECT_RULE, 'p1', 40, 'p1'),
      F(FRAGMENT_TYPE.PROJECT_RULE, 'p2', 40, 'p2'),
    ];
    const report = assembleWithReport(items);
    if (report.stats.fragmentCount !== 4) throw new Error('fragmentCount 错');
    if (report.stats.byType.project_rule !== 2) throw new Error('byType 统计错');
    if (report.order[0].id !== 'safety') throw new Error('order 第一项应为 safety');
    if (report.order[report.order.length - 1].id !== 'p2') {
      throw new Error('order 最后一项应为 p2（同 slot 同 priority 按 id 升序）');
    }
    if (typeof report.prompt !== 'string' || report.prompt.length === 0) {
      throw new Error('report.prompt 应为非空字符串');
    }
  });

  // 用例 9：id 重复抛错
  cases.push(() => {
    let threw = false;
    try {
      assemble([
        F(FRAGMENT_TYPE.PROJECT_RULE, 'dup', 40, 'a'),
        F(FRAGMENT_TYPE.PROJECT_RULE, 'dup', 40, 'b'),
      ]);
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('id 重复应抛错');
  });

  // 用例 10：空数组返回空字符串
  cases.push(() => {
    if (assemble([]) !== '') throw new Error('空数组应返回空字符串');
  });

  // 用例 11：skipEmpty 默认过滤空内容
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.PROJECT_RULE, 'a', 40, ''),
      F(FRAGMENT_TYPE.PROJECT_RULE, 'b', 40, 'has_content'),
    ];
    const out = assemble(items);
    // 应只有 b 被装配
    if (out.indexOf('has_content') === -1) throw new Error('非空内容丢失');
    const fragmentCount = (out.match(/<FRAGMENT/g) || []).length;
    if (fragmentCount !== 1) throw new Error(`空内容应被过滤，实际有 ${fragmentCount} 个 FRAGMENT`);
  });

  // 用例 12：skipEmpty=false 时保留空内容
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.PROJECT_RULE, 'a', 40, ''),
      F(FRAGMENT_TYPE.PROJECT_RULE, 'b', 40, 'x'),
    ];
    const out = assemble(items, { skipEmpty: false });
    const fragmentCount = (out.match(/<FRAGMENT/g) || []).length;
    if (fragmentCount !== 2) throw new Error(`skipEmpty=false 时应保留空内容，实际 ${fragmentCount}`);
  });

  // 用例 13：装配输出可被 fragment-wrapper.unwrap 反向解析
  cases.push(() => {
    const { unwrap } = require('./fragment-wrapper');
    const items = [
      F(FRAGMENT_TYPE.PLATFORM_SAFETY, 'a', 100, 'safety'),
      F(FRAGMENT_TYPE.TASK_GOAL, 'b', 80, 'task'),
      F(FRAGMENT_TYPE.MEMORY, 'c', 30, 'memory'),
    ];
    const out = assemble(items);
    const parsed = unwrap(out);
    if (parsed.length !== 3) throw new Error(`往返解析数量错：${parsed.length}`);
    if (parsed[0].meta.id !== 'a' || parsed[1].meta.id !== 'c' || parsed[2].meta.id !== 'b') {
      // a (safety, slot 0) → c (memory, slot 3) → b (task, slot 4)
      throw new Error(`往返装配顺序错：${parsed.map((p) => p.meta.id).join(',')}`);
    }
  });

  // 用例 14：未知 type 抛错
  cases.push(() => {
    let threw = false;
    try {
      assemble([{ meta: { type: 'unknown_type', id: 'x', priority: 50, source: 's' }, content: 'c' }]);
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('未知 type 应抛错');
  });

  // 用例 15：filterByType / hasFragment 工具
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.PROJECT_RULE, 'a', 40, '1'),
      F(FRAGMENT_TYPE.MEMORY, 'b', 30, '2'),
      F(FRAGMENT_TYPE.PROJECT_RULE, 'c', 40, '3'),
    ];
    if (filterByType(items, FRAGMENT_TYPE.PROJECT_RULE).length !== 2) throw new Error('filterByType 错');
    if (!hasFragment(items, 'b')) throw new Error('hasFragment 应返回 true');
    if (hasFragment(items, 'nonexistent')) throw new Error('hasFragment 应返回 false');
  });

  // 用例 16：snapshot 字节稳定性（同输入两次装配结果完全一致）
  cases.push(() => {
    const items = [
      F(FRAGMENT_TYPE.PLATFORM_SAFETY, 'safety', 100, 'safety'),
      F(FRAGMENT_TYPE.PRODUCT_DEFAULT, 'main', 50, 'main'),
      F(FRAGMENT_TYPE.PROJECT_RULE, 'p1', 40, 'p1'),
      F(FRAGMENT_TYPE.PROJECT_RULE, 'p2', 40, 'p2'),
      F(FRAGMENT_TYPE.MEMORY, 'm', 30, 'm'),
      F(FRAGMENT_TYPE.TASK_GOAL, 't', 80, 't'),
      F(FRAGMENT_TYPE.RETRY_FEEDBACK, 'r', 75, 'r'),
    ];
    const out1 = assemble(items);
    // 即使打乱输入顺序，输出也应一致
    const shuffled = [items[3], items[0], items[6], items[2], items[5], items[1], items[4]];
    const out2 = assemble(shuffled);
    if (out1 !== out2) throw new Error('装配输出未达到字节级稳定（snapshot 要求）');
  });

  // 执行全部用例
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
  return {
    passed,
    total: cases.length,
    failures,
    success: failures.length === 0,
  };
}

// ─── 导出 ────────────────────────────────────────────────
module.exports = {
  // 常量
  SLOT_ORDER,
  OUTPUT_STYLE_SCOPE,
  DEFAULT_SEPARATOR,

  // 核心 API
  assemble,
  assembleWithReport,
  assembleWithBaseline,   // Phase-6 M4.2

  // 工具方法
  filterByType,
  hasFragment,

  // 测试辅助
  selfCheck,

  // 内部工具（导出供高级场景使用）
  _resolveSlot,
  _compareItems,
};
