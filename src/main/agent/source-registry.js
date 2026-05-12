/**
 * source-registry.js — Prompt 片段来源注册表（Phase-6 M1.1）
 *
 * 职责：为系统中所有 Prompt 片段（fragment）提供来源、优先级、生命周期、
 *      作用域元数据的注册与查询能力，是 Harness 治理体系的底座。
 *
 * 设计原则（参照《Claude Code 与 Codex 控制面设计》笔记）：
 *  1. 来源治理：每个 fragment 必须能回答"我是谁、来自哪里、能不能被覆盖、何时失效"
 *  2. 优先级显式化：同一装配现场出现冲突时，按 priority 数值比较（高者胜）
 *  3. 类型收敛：本项目场景下只暴露 6 种 type，避免过度结构化
 *  4. 不可变性：注册后的 fragment 元数据只读，修改需 unregister + register
 *
 * 类型枚举与默认优先级（数值越大优先级越高）：
 *   FRAGMENT_TYPE.PLATFORM_SAFETY  100   平台硬约束（H1-H8 摘要），最高
 *   FRAGMENT_TYPE.RETRY_FEEDBACK   75    重试反馈（必须靠后给模型强提醒）
 *   FRAGMENT_TYPE.TASK_GOAL        80    当前任务目标（仅次于安全规则）
 *   FRAGMENT_TYPE.PRODUCT_DEFAULT  50    产品级默认（abc-system.md 等）
 *   FRAGMENT_TYPE.PROJECT_RULE     40    课程级数据（notebook 5 字段、framework）
 *   FRAGMENT_TYPE.MEMORY           30    历史课程参考（强制不可覆盖当前）
 *
 * 约束：
 *  - 不依赖任何外部包，零运行时依赖
 *  - 与 prompts/ 目录的文件系统无耦合（注册表只存元数据，不读取文件内容）
 *  - 不缓存 prompt 文本，由 prompt-assembler 在装配时即时读取
 *  - 单文件不超过 600 行（CLAUDE.md 第七节）
 */

// ─── 类型枚举与优先级常量 ───────────────────────────────────
const FRAGMENT_TYPE = Object.freeze({
  PLATFORM_SAFETY: 'platform_safety',
  RETRY_FEEDBACK: 'retry_feedback',
  TASK_GOAL: 'task_goal',
  PRODUCT_DEFAULT: 'product_default',
  PROJECT_RULE: 'project_rule',
  MEMORY: 'memory',
});

const DEFAULT_PRIORITY = Object.freeze({
  [FRAGMENT_TYPE.PLATFORM_SAFETY]: 100,
  [FRAGMENT_TYPE.TASK_GOAL]: 80,
  [FRAGMENT_TYPE.RETRY_FEEDBACK]: 75,
  [FRAGMENT_TYPE.PRODUCT_DEFAULT]: 50,
  [FRAGMENT_TYPE.PROJECT_RULE]: 40,
  [FRAGMENT_TYPE.MEMORY]: 30,
});

const LIFETIME = Object.freeze({
  PERSISTENT: 'persistent',     // 应用生命周期内永久有效
  SESSION: 'session',           // 当前 notebook 会话有效
  TASK: 'task',                 // 当前 stage 任务有效
  SINGLE_CALL: 'single_call',   // 单次 LLM 调用有效
});

// 类型间的"硬覆盖关系"白名单：低优先级类型不允许被声明能覆盖高优先级类型
// 用于 register 时校验 canBeOverriddenBy 字段的合法性
const ALLOWED_OVERRIDE_RULES = Object.freeze({
  [FRAGMENT_TYPE.PLATFORM_SAFETY]: [],                                  // 不可被任何类型覆盖
  [FRAGMENT_TYPE.TASK_GOAL]: [FRAGMENT_TYPE.PLATFORM_SAFETY],
  [FRAGMENT_TYPE.RETRY_FEEDBACK]: [FRAGMENT_TYPE.PLATFORM_SAFETY],
  [FRAGMENT_TYPE.PRODUCT_DEFAULT]: [FRAGMENT_TYPE.PLATFORM_SAFETY, FRAGMENT_TYPE.TASK_GOAL],
  [FRAGMENT_TYPE.PROJECT_RULE]: [
    FRAGMENT_TYPE.PLATFORM_SAFETY,
    FRAGMENT_TYPE.TASK_GOAL,
    FRAGMENT_TYPE.PRODUCT_DEFAULT,
  ],
  [FRAGMENT_TYPE.MEMORY]: [
    FRAGMENT_TYPE.PLATFORM_SAFETY,
    FRAGMENT_TYPE.TASK_GOAL,
    FRAGMENT_TYPE.RETRY_FEEDBACK,
    FRAGMENT_TYPE.PRODUCT_DEFAULT,
    FRAGMENT_TYPE.PROJECT_RULE,
  ],
});

// ─── 内部存储（模块级单例）──────────────────────────────────
// 使用 Map 保证插入顺序可追溯，便于调试时按注册时序输出
const _registry = new Map();

// ─── 校验工具 ────────────────────────────────────────────
/**
 * 校验单个 fragment 注册请求的合法性。
 * 不通过时抛 Error（包含具体字段名和原因），通过时返回归一化后的元数据对象。
 *
 * 强校验项：
 *  - id 非空字符串（不允许空格）
 *  - type 在 FRAGMENT_TYPE 枚举内
 *  - source 非空字符串（必须能定位到文件路径或运行时来源）
 *  - lifetime 在 LIFETIME 枚举内（缺省补 SESSION）
 *  - priority 数值且在 [0, 100]（缺省补类型默认优先级）
 *  - canBeOverriddenBy 数组（缺省按 ALLOWED_OVERRIDE_RULES 推导）
 *  - scope 非空字符串（缺省补 'global'）
 */
function _validate(meta) {
  if (!meta || typeof meta !== 'object') {
    throw new Error('source-registry: fragment 元数据必须是对象');
  }
  if (typeof meta.id !== 'string' || !meta.id.trim() || /\s/.test(meta.id)) {
    throw new Error(`source-registry: id 必须是非空且不含空格的字符串，收到 ${JSON.stringify(meta.id)}`);
  }
  if (!Object.values(FRAGMENT_TYPE).includes(meta.type)) {
    throw new Error(`source-registry: type 必须是 FRAGMENT_TYPE 之一，收到 ${JSON.stringify(meta.type)}`);
  }
  if (typeof meta.source !== 'string' || !meta.source.trim()) {
    throw new Error(`source-registry: source 必须是非空字符串（如 'prompts/abc-system.md' 或 'runtime:retry_loop'），收到 ${JSON.stringify(meta.source)}`);
  }

  const lifetime = meta.lifetime || LIFETIME.SESSION;
  if (!Object.values(LIFETIME).includes(lifetime)) {
    throw new Error(`source-registry: lifetime 必须是 LIFETIME 之一，收到 ${JSON.stringify(meta.lifetime)}`);
  }

  const priority = (typeof meta.priority === 'number')
    ? meta.priority
    : DEFAULT_PRIORITY[meta.type];
  if (typeof priority !== 'number' || priority < 0 || priority > 100) {
    throw new Error(`source-registry: priority 必须是 [0,100] 范围内的数值，收到 ${meta.priority}`);
  }

  // 校验 canBeOverriddenBy 不能包含本类型不被允许的覆盖关系
  const allowedOverrides = ALLOWED_OVERRIDE_RULES[meta.type] || [];
  const canBeOverriddenBy = Array.isArray(meta.canBeOverriddenBy)
    ? meta.canBeOverriddenBy
    : allowedOverrides;

  for (const ovType of canBeOverriddenBy) {
    if (!Object.values(FRAGMENT_TYPE).includes(ovType)) {
      throw new Error(`source-registry: canBeOverriddenBy 包含无效类型 ${JSON.stringify(ovType)}`);
    }
    if (!allowedOverrides.includes(ovType)) {
      throw new Error(
        `source-registry: 类型 ${meta.type} 不允许被 ${ovType} 覆盖（违反硬覆盖规则）。` +
        `允许列表：${JSON.stringify(allowedOverrides)}`
      );
    }
  }

  return Object.freeze({
    id: meta.id,
    type: meta.type,
    source: meta.source,
    scope: typeof meta.scope === 'string' && meta.scope.trim() ? meta.scope : 'global',
    priority,
    lifetime,
    canBeOverriddenBy: Object.freeze([...canBeOverriddenBy]),
    description: typeof meta.description === 'string' ? meta.description : '',
    registeredAt: new Date().toISOString(),
  });
}

// ─── 公共 API ────────────────────────────────────────────
/**
 * 注册一个 fragment 元数据。
 * 同 id 重复注册会抛错（避免静默覆盖），需要更新时先 unregister。
 *
 * @param {Object} meta - fragment 元数据
 * @returns {Object} 归一化、冻结后的元数据对象
 */
function register(meta) {
  const normalized = _validate(meta);
  if (_registry.has(normalized.id)) {
    throw new Error(`source-registry: id "${normalized.id}" 已注册，请先 unregister 或换用其他 id`);
  }
  _registry.set(normalized.id, normalized);
  return normalized;
}

/**
 * 注销一个 fragment（用于热更新场景）。返回被注销的元数据，未找到返回 null。
 */
function unregister(id) {
  if (typeof id !== 'string') return null;
  const meta = _registry.get(id);
  if (!meta) return null;
  _registry.delete(id);
  return meta;
}

/**
 * 查询单个 fragment 元数据。未找到返回 null。
 */
function get(id) {
  if (typeof id !== 'string') return null;
  return _registry.get(id) || null;
}

/**
 * 查询某类型下所有已注册的 fragment，按注册顺序返回。
 * @param {string} type - FRAGMENT_TYPE 之一
 */
function listByType(type) {
  if (!Object.values(FRAGMENT_TYPE).includes(type)) return [];
  const result = [];
  for (const meta of _registry.values()) {
    if (meta.type === type) result.push(meta);
  }
  return result;
}

/**
 * 列出所有 fragment 元数据（用于调试 / 装配快照）。
 */
function listAll() {
  return Array.from(_registry.values());
}

/**
 * 按优先级降序排序一组 fragment（不修改原数组）。
 * 同优先级时按 type 字典序、再按 id 字典序保证稳定性（snapshot test 友好）。
 *
 * @param {Array} fragments - 待排序的 fragment 元数据数组
 * @returns {Array} 排序后的新数组
 */
function sortByPriority(fragments) {
  if (!Array.isArray(fragments)) return [];
  return [...fragments].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  });
}

/**
 * 检查 a 是否能被 b 覆盖。
 * 用于 prompt-assembler 在拼装时决定冲突解决方向。
 *
 * 规则：
 *  - b.type 必须在 a.canBeOverriddenBy 列表里
 *  - 或者 b.priority > a.priority（同类型场景）
 *
 * @param {Object} a - 被覆盖方
 * @param {Object} b - 覆盖方
 * @returns {boolean}
 */
function canOverride(a, b) {
  if (!a || !b) return false;
  if (a.canBeOverriddenBy && a.canBeOverriddenBy.includes(b.type)) return true;
  if (a.type === b.type && b.priority > a.priority) return true;
  return false;
}

/**
 * 清空整个注册表（仅供测试使用，生产代码不应调用）。
 */
function _clearAll() {
  _registry.clear();
}

/**
 * 注册表当前大小。
 */
function size() {
  return _registry.size;
}

// ─── 自检函数（供 verify-prompt-assembly.js 调用）────────────
/**
 * 内置自检：覆盖 register / get / listByType / sortByPriority / canOverride
 * 五个核心 API 的基本场景。失败抛错，成功返回 { passed, total }。
 *
 * 不依赖外部测试框架，可在 verify 脚本中直接调用。
 */
function selfCheck() {
  const cases = [];
  const _backup = listAll();
  _clearAll();

  // 用例 1：基本注册与查询
  cases.push(() => {
    const meta = register({
      id: 'test_safety_001',
      type: FRAGMENT_TYPE.PLATFORM_SAFETY,
      source: 'test:safety',
      description: '测试安全规则',
    });
    if (meta.priority !== 100) throw new Error('default priority for platform_safety should be 100');
    if (meta.lifetime !== LIFETIME.SESSION) throw new Error('default lifetime should be session');
    if (get('test_safety_001') !== meta) throw new Error('get() should return registered meta');
  });

  // 用例 2：重复注册必须抛错
  cases.push(() => {
    let threw = false;
    try {
      register({
        id: 'test_safety_001',
        type: FRAGMENT_TYPE.PLATFORM_SAFETY,
        source: 'test:safety',
      });
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('duplicate id should throw');
  });

  // 用例 3：非法 type 必须抛错
  cases.push(() => {
    let threw = false;
    try {
      register({ id: 'test_invalid_type', type: 'unknown_type', source: 'test' });
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('invalid type should throw');
  });

  // 用例 4：listByType 返回正确分组
  cases.push(() => {
    register({ id: 'test_product_a', type: FRAGMENT_TYPE.PRODUCT_DEFAULT, source: 'prompts/a.md' });
    register({ id: 'test_product_b', type: FRAGMENT_TYPE.PRODUCT_DEFAULT, source: 'prompts/b.md' });
    register({ id: 'test_memory_a', type: FRAGMENT_TYPE.MEMORY, source: 'memory:42' });
    const products = listByType(FRAGMENT_TYPE.PRODUCT_DEFAULT);
    if (products.length !== 2) throw new Error(`listByType product expected 2, got ${products.length}`);
    const memos = listByType(FRAGMENT_TYPE.MEMORY);
    if (memos.length !== 1) throw new Error(`listByType memory expected 1, got ${memos.length}`);
  });

  // 用例 5：sortByPriority 按优先级降序、同级按 type/id 稳定排序
  cases.push(() => {
    const fragments = [
      { id: 'b', type: FRAGMENT_TYPE.MEMORY, priority: 30, source: 's' },
      { id: 'a', type: FRAGMENT_TYPE.PLATFORM_SAFETY, priority: 100, source: 's' },
      { id: 'c', type: FRAGMENT_TYPE.RETRY_FEEDBACK, priority: 75, source: 's' },
      { id: 'd', type: FRAGMENT_TYPE.TASK_GOAL, priority: 80, source: 's' },
    ];
    const sorted = sortByPriority(fragments);
    if (sorted.map((f) => f.id).join(',') !== 'a,d,c,b') {
      throw new Error(`sortByPriority order wrong: ${sorted.map((f) => f.id).join(',')}`);
    }
  });

  // 用例 6：canOverride 跨类型校验
  cases.push(() => {
    const safety = { id: 's', type: FRAGMENT_TYPE.PLATFORM_SAFETY, priority: 100, canBeOverriddenBy: [] };
    const memory = { id: 'm', type: FRAGMENT_TYPE.MEMORY, priority: 30, canBeOverriddenBy: [
      FRAGMENT_TYPE.PLATFORM_SAFETY, FRAGMENT_TYPE.TASK_GOAL,
      FRAGMENT_TYPE.RETRY_FEEDBACK, FRAGMENT_TYPE.PRODUCT_DEFAULT,
      FRAGMENT_TYPE.PROJECT_RULE,
    ]};
    if (canOverride(safety, memory)) throw new Error('memory should NOT override platform_safety');
    if (!canOverride(memory, safety)) throw new Error('platform_safety should override memory');
  });

  // 用例 7：非法 canBeOverriddenBy（低级想覆盖高级）必须抛错
  cases.push(() => {
    let threw = false;
    try {
      register({
        id: 'test_evil_safety',
        type: FRAGMENT_TYPE.PLATFORM_SAFETY,
        source: 'test',
        canBeOverriddenBy: [FRAGMENT_TYPE.MEMORY],
      });
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('platform_safety claiming to be overridden by memory should throw');
  });

  // 用例 8：unregister 返回与移除
  cases.push(() => {
    const removed = unregister('test_safety_001');
    if (!removed || removed.id !== 'test_safety_001') throw new Error('unregister should return meta');
    if (get('test_safety_001') !== null) throw new Error('after unregister, get should return null');
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

  // 恢复注册表（避免污染调用方）
  _clearAll();
  for (const meta of _backup) {
    _registry.set(meta.id, meta);
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
  // 枚举
  FRAGMENT_TYPE,
  LIFETIME,
  DEFAULT_PRIORITY,
  ALLOWED_OVERRIDE_RULES,

  // 核心 API
  register,
  unregister,
  get,
  listByType,
  listAll,
  sortByPriority,
  canOverride,
  size,

  // 测试辅助
  selfCheck,
  _clearAll,
};
