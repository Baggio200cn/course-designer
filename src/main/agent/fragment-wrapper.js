/**
 * fragment-wrapper.js — Prompt 片段边界包装器（Phase-6 M1.2）
 *
 * 职责：把 fragment 元数据 + 文本内容包装为带边界标记的字符串，
 *      供 prompt-assembler 拼装最终 prompt 时使用；
 *      同时提供 unwrap 反向解析能力（用于 Snapshot Test 与调试）。
 *
 * 设计原则（参照《Claude Code 与 Codex 控制面设计》笔记 §6 / §9.2）：
 *  1. 统一边界标签：所有类型共用 <FRAGMENT type="..."> 形式，避免多套标签干扰
 *  2. 元数据可序列化：来源、优先级、生命周期等在边界标记的属性上
 *  3. 内容最小转义：仅当 content 中出现可能破坏边界的字面量时插入零宽空格
 *  4. 往返一致性：unwrap(wrap(meta, content)) === { meta, content }
 *  5. 字节级稳定：相同输入永远产出相同输出（Snapshot Test 前提）
 *
 * 边界格式（属性顺序固定为 type → id → priority → source → lifetime → scope）：
 *   <FRAGMENT type="PROJECT_RULE" id="notebook_software_tools" priority="40"
 *             source="notebook.softwareTools" lifetime="session" scope="global">
 *   本课程使用 3ds Max 2024、V-Ray 6.x、Adobe Photoshop 2024
 *   </FRAGMENT>
 *
 * 内容转义规则：
 *  - content 中出现字面量 "</FRAGMENT>" 时，将其替换为 "<​/FRAGMENT>"
 *    （零宽空格不可见但能破坏边界正则匹配）
 *  - unwrap 时反向还原零宽空格
 *  - 属性值中的双引号转义为 &quot;，& 转义为 &amp;
 *
 * 约束：
 *  - 不依赖任何外部包，零运行时依赖
 *  - 与 source-registry 通过 meta 对象解耦（不直接调用 register）
 *  - 单文件不超过 600 行（CLAUDE.md 第七节）
 */

const { FRAGMENT_TYPE, LIFETIME } = require('./source-registry');

// ─── 常量 ───────────────────────────────────────────────
const ZWSP = '​';                                // 零宽空格，用于打断边界字面量
const BOUNDARY_TAG = 'FRAGMENT';                      // 统一边界标签名
const SENTINEL_END = `</${BOUNDARY_TAG}>`;            // 关闭标签字面量
const ESCAPED_END = `<${ZWSP}/${BOUNDARY_TAG}>`;      // 转义后的关闭标签
const ATTR_ORDER = ['type', 'id', 'priority', 'source', 'lifetime', 'scope']; // 序列化时的固定属性顺序

// 边界匹配正则（非贪婪，匹配最近的合法关闭标签）
// - 开标签必须形如 <FRAGMENT 属性...>
// - 关闭标签必须为字面量 </FRAGMENT>（不带 ZWSP，被转义的会被忽略）
const BOUNDARY_REGEX = /<FRAGMENT\s+([^>]+)>\n([\s\S]*?)\n<\/FRAGMENT>/g;

// 属性提取正则（key="value" 形式，value 中的双引号已转义为 &quot;）
const ATTR_REGEX = /(\w+)="([^"]*)"/g;

// ─── 转义/反转义工具 ──────────────────────────────────────
/**
 * 转义属性值：& → &amp;（必须先做），" → &quot;
 * 顺序很重要：先转义 & 再转义 "，否则 &quot; 中的 & 会被二次转义
 */
function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function unescapeAttr(value) {
  return String(value).replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/**
 * 转义内容：仅当字面量 </FRAGMENT> 出现时插入零宽空格打断
 * 不对其他字符做任何处理（保留代码示例、Markdown、中文等原貌）
 */
function escapeContent(content) {
  return String(content).split(SENTINEL_END).join(ESCAPED_END);
}

function unescapeContent(content) {
  return String(content).split(ESCAPED_END).join(SENTINEL_END);
}

// ─── 元数据校验 ──────────────────────────────────────────
/**
 * 校验 wrap 输入的 meta 对象，要求字段齐全且类型合法。
 * 不通过抛 Error，通过返回归一化的 meta（不修改原对象）。
 *
 * 与 source-registry._validate 的区别：
 *  - 本函数允许 meta 不在注册表中（支持运行时临时构造，如 retry_feedback）
 *  - 但仍强制要求 type/id/source/priority/lifetime/scope 6 个字段齐全
 */
function _validateMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    throw new Error('fragment-wrapper: meta 必须是对象');
  }
  if (!Object.values(FRAGMENT_TYPE).includes(meta.type)) {
    throw new Error(`fragment-wrapper: type 必须是 FRAGMENT_TYPE 之一，收到 ${JSON.stringify(meta.type)}`);
  }
  if (typeof meta.id !== 'string' || !meta.id.trim() || /\s/.test(meta.id)) {
    throw new Error(`fragment-wrapper: id 必须是非空且不含空格的字符串，收到 ${JSON.stringify(meta.id)}`);
  }
  if (typeof meta.source !== 'string' || !meta.source.trim()) {
    throw new Error(`fragment-wrapper: source 必须是非空字符串，收到 ${JSON.stringify(meta.source)}`);
  }
  if (typeof meta.priority !== 'number' || meta.priority < 0 || meta.priority > 100) {
    throw new Error(`fragment-wrapper: priority 必须是 [0,100] 数值，收到 ${meta.priority}`);
  }
  const lifetime = meta.lifetime || LIFETIME.SESSION;
  if (!Object.values(LIFETIME).includes(lifetime)) {
    throw new Error(`fragment-wrapper: lifetime 必须是 LIFETIME 之一，收到 ${JSON.stringify(meta.lifetime)}`);
  }
  return {
    type: meta.type,
    id: meta.id,
    priority: meta.priority,
    source: meta.source,
    lifetime,
    scope: typeof meta.scope === 'string' && meta.scope.trim() ? meta.scope : 'global',
  };
}

// ─── 公共 API ────────────────────────────────────────────
/**
 * 把 fragment 元数据与内容包装为带边界标记的字符串。
 *
 * 输出格式（行为稳定，可作为 Snapshot 比对基线）：
 *   <FRAGMENT type="..." id="..." priority="..." source="..." lifetime="..." scope="...">
 *   {escapedContent}
 *   </FRAGMENT>
 *
 * @param {Object} meta - fragment 元数据（type/id/priority/source/lifetime/scope）
 * @param {string} content - 原始文本内容
 * @returns {string} 包装后的字符串
 */
function wrap(meta, content) {
  const normalizedMeta = _validateMeta(meta);
  if (typeof content !== 'string') {
    throw new Error(`fragment-wrapper: content 必须是字符串，收到 ${typeof content}`);
  }

  // 构造属性字符串（按 ATTR_ORDER 固定顺序）
  const attrs = ATTR_ORDER
    .map((key) => `${key}="${escapeAttr(normalizedMeta[key])}"`)
    .join(' ');

  // 内容转义后用换行隔开边界与正文（提升模型可读性）
  const escapedContent = escapeContent(content);
  return `<${BOUNDARY_TAG} ${attrs}>\n${escapedContent}\n</${BOUNDARY_TAG}>`;
}

/**
 * 解析包装后的字符串，提取所有 fragment 的元数据与内容。
 * 用于 Snapshot Test 反推、调试时检查装配输出、压缩时识别边界。
 *
 * @param {string} text - 含一个或多个 <FRAGMENT> 边界的字符串
 * @returns {Array<{meta: Object, content: string, raw: string}>} 解析结果数组
 */
function unwrap(text) {
  if (typeof text !== 'string' || !text) return [];
  const results = [];
  // 重置 regex lastIndex（全局匹配状态隔离）
  const regex = new RegExp(BOUNDARY_REGEX.source, 'g');
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [raw, attrsStr, escapedContent] = match;
    const meta = _parseAttrs(attrsStr);
    const content = unescapeContent(escapedContent);
    results.push({ meta, content, raw });
  }
  return results;
}

/**
 * 解析属性字符串为对象。
 * 输入：'type="PROJECT_RULE" id="abc" priority="40" ...'
 * 输出：{ type: 'PROJECT_RULE', id: 'abc', priority: 40, ... }
 *
 * 注意：priority 会自动转为数字；其他属性值经 unescapeAttr 还原。
 */
function _parseAttrs(attrsStr) {
  const result = {};
  const regex = new RegExp(ATTR_REGEX.source, 'g');
  let match;
  while ((match = regex.exec(attrsStr)) !== null) {
    const [, key, rawValue] = match;
    const value = unescapeAttr(rawValue);
    if (key === 'priority') {
      const num = Number(value);
      result[key] = Number.isFinite(num) ? num : value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 工具方法：判断字符串是否包含至少一个完整 fragment 边界。
 */
function hasFragment(text) {
  if (typeof text !== 'string' || !text) return false;
  return new RegExp(BOUNDARY_REGEX.source).test(text);
}

/**
 * 工具方法：把多个 wrap 后的字符串拼接成最终 prompt。
 * 默认用双换行分隔（便于模型识别块边界），可由调用方覆盖 separator。
 */
function joinWrapped(wrappedList, separator = '\n\n') {
  if (!Array.isArray(wrappedList)) return '';
  return wrappedList.filter((s) => typeof s === 'string' && s.length > 0).join(separator);
}

// ─── 自检函数 ────────────────────────────────────────────
/**
 * 内置自检：覆盖 wrap / unwrap / 转义 / 往返一致性等核心场景。
 * 失败抛错，成功返回 { passed, total }。
 */
function selfCheck() {
  const cases = [];

  // 用例 1：基本 wrap 形态
  cases.push(() => {
    const out = wrap(
      { type: FRAGMENT_TYPE.PROJECT_RULE, id: 'p1', priority: 40, source: 'notebook.x', lifetime: 'session' },
      '本课程使用 3ds Max 2024'
    );
    const expected = `<FRAGMENT type="project_rule" id="p1" priority="40" source="notebook.x" lifetime="session" scope="global">\n本课程使用 3ds Max 2024\n</FRAGMENT>`;
    if (out !== expected) {
      throw new Error(`wrap 输出不符预期：\n实际：${JSON.stringify(out)}\n预期：${JSON.stringify(expected)}`);
    }
  });

  // 用例 2：unwrap 还原元数据与内容
  cases.push(() => {
    const wrapped = wrap(
      { type: FRAGMENT_TYPE.MEMORY, id: 'mem_42', priority: 30, source: 'memory:42', lifetime: 'persistent' },
      '历史课程：Blender 三维建模'
    );
    const parsed = unwrap(wrapped);
    if (parsed.length !== 1) throw new Error(`unwrap 应返回 1 项，实际 ${parsed.length}`);
    const { meta, content } = parsed[0];
    if (meta.type !== FRAGMENT_TYPE.MEMORY) throw new Error('unwrap meta.type 错误');
    if (meta.priority !== 30 || typeof meta.priority !== 'number') throw new Error('unwrap meta.priority 应为 number 30');
    if (meta.id !== 'mem_42') throw new Error('unwrap meta.id 错误');
    if (content !== '历史课程：Blender 三维建模') throw new Error('unwrap content 错误');
  });

  // 用例 3：往返一致性（roundtrip）
  cases.push(() => {
    const meta = {
      type: FRAGMENT_TYPE.TASK_GOAL,
      id: 'goal_1',
      priority: 80,
      source: 'user_request',
      lifetime: 'single_call',
      scope: 'lecture_stage',
    };
    const content = '为《店铺三维表现》生成 4 学时正式讲稿';
    const wrapped = wrap(meta, content);
    const [parsed] = unwrap(wrapped);
    if (parsed.content !== content) throw new Error('roundtrip content 不一致');
    for (const key of ATTR_ORDER) {
      if (parsed.meta[key] !== meta[key]) {
        throw new Error(`roundtrip meta.${key} 不一致: 期望 ${meta[key]} 实际 ${parsed.meta[key]}`);
      }
    }
  });

  // 用例 4：内容含 </FRAGMENT> 字面量时的转义保护
  cases.push(() => {
    const dangerous = '示例代码：if (text.includes("</FRAGMENT>")) { return false; }';
    const wrapped = wrap(
      { type: FRAGMENT_TYPE.PRODUCT_DEFAULT, id: 'p2', priority: 50, source: 's' },
      dangerous
    );
    // 包装后边界仍唯一，unwrap 应正确还原
    const parsed = unwrap(wrapped);
    if (parsed.length !== 1) throw new Error(`边界保护失败，unwrap 数量 ${parsed.length}`);
    if (parsed[0].content !== dangerous) {
      throw new Error('转义后还原内容不一致');
    }
    // 验证 wrapped 里没有未转义的 </FRAGMENT>（除尾部那一个）
    const occurrences = (wrapped.match(/<\/FRAGMENT>/g) || []).length;
    if (occurrences !== 1) throw new Error(`wrapped 中应只有 1 个未转义 </FRAGMENT>，实际 ${occurrences}`);
  });

  // 用例 5：属性值含双引号需转义
  cases.push(() => {
    const wrapped = wrap(
      { type: FRAGMENT_TYPE.PROJECT_RULE, id: 'p3', priority: 40, source: 'notebook["key"]' },
      '内容'
    );
    if (!wrapped.includes('source="notebook[&quot;key&quot;]"')) {
      throw new Error('属性 source 中的双引号应转义为 &quot;');
    }
    const [parsed] = unwrap(wrapped);
    if (parsed.meta.source !== 'notebook["key"]') {
      throw new Error('属性反转义失败');
    }
  });

  // 用例 6：多个 fragment 串接后的批量解析
  cases.push(() => {
    const f1 = wrap({ type: FRAGMENT_TYPE.PLATFORM_SAFETY, id: 'a', priority: 100, source: 's1' }, '安全');
    const f2 = wrap({ type: FRAGMENT_TYPE.TASK_GOAL, id: 'b', priority: 80, source: 's2' }, '任务');
    const f3 = wrap({ type: FRAGMENT_TYPE.MEMORY, id: 'c', priority: 30, source: 's3' }, '记忆');
    const joined = joinWrapped([f1, f2, f3]);
    const parsed = unwrap(joined);
    if (parsed.length !== 3) throw new Error(`批量解析数量错：${parsed.length}`);
    if (parsed[0].meta.id !== 'a' || parsed[1].meta.id !== 'b' || parsed[2].meta.id !== 'c') {
      throw new Error('批量解析顺序错');
    }
  });

  // 用例 7：非法 meta 抛错
  cases.push(() => {
    let threw = false;
    try {
      wrap({ type: 'unknown', id: 'x', priority: 50, source: 's' }, 'content');
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('非法 type 应抛错');

    threw = false;
    try {
      wrap({ type: FRAGMENT_TYPE.MEMORY, id: 'has space', priority: 30, source: 's' }, 'c');
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('id 含空格应抛错');

    threw = false;
    try {
      wrap({ type: FRAGMENT_TYPE.MEMORY, id: 'ok', priority: 999, source: 's' }, 'c');
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('priority 超出 [0,100] 应抛错');
  });

  // 用例 8：空字符串与 hasFragment
  cases.push(() => {
    if (hasFragment('')) throw new Error('空字符串 hasFragment 应为 false');
    if (hasFragment('普通文本无边界')) throw new Error('无边界文本 hasFragment 应为 false');
    const wrapped = wrap(
      { type: FRAGMENT_TYPE.PROJECT_RULE, id: 'h', priority: 40, source: 's' },
      '内容'
    );
    if (!hasFragment(wrapped)) throw new Error('包装后 hasFragment 应为 true');
  });

  // 用例 9：scope 缺省补 'global'，lifetime 缺省补 'session'
  cases.push(() => {
    const wrapped = wrap(
      { type: FRAGMENT_TYPE.PROJECT_RULE, id: 'def', priority: 40, source: 's' },
      'x'
    );
    const [parsed] = unwrap(wrapped);
    if (parsed.meta.scope !== 'global') throw new Error('scope 缺省应为 global');
    if (parsed.meta.lifetime !== 'session') throw new Error('lifetime 缺省应为 session');
  });

  // 用例 10：属性顺序固定（snapshot 稳定性）
  cases.push(() => {
    // 即使 meta 输入字段顺序打乱，输出属性顺序仍按 ATTR_ORDER
    const wrapped = wrap(
      { scope: 'lecture_stage', source: 's', lifetime: 'task', priority: 50, id: 'ord', type: FRAGMENT_TYPE.PRODUCT_DEFAULT },
      'x'
    );
    const expectedAttrPart = `<FRAGMENT type="product_default" id="ord" priority="50" source="s" lifetime="task" scope="lecture_stage">`;
    if (!wrapped.startsWith(expectedAttrPart)) {
      throw new Error(`属性顺序不稳定，实际开头：${wrapped.slice(0, expectedAttrPart.length)}`);
    }
  });

  // 用例 11：内容多次出现 </FRAGMENT> 全部被转义
  cases.push(() => {
    const dangerous = '一次：</FRAGMENT> 二次：</FRAGMENT> 三次：</FRAGMENT>';
    const wrapped = wrap(
      { type: FRAGMENT_TYPE.PRODUCT_DEFAULT, id: 'm', priority: 50, source: 's' },
      dangerous
    );
    const occurrences = (wrapped.match(/<\/FRAGMENT>/g) || []).length;
    if (occurrences !== 1) throw new Error(`多次危险字面量未全部转义，剩 ${occurrences} 次`);
    const [parsed] = unwrap(wrapped);
    if (parsed.content !== dangerous) throw new Error('多次转义后还原失败');
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
  ZWSP,
  BOUNDARY_TAG,
  BOUNDARY_REGEX,
  ATTR_ORDER,

  // 核心 API
  wrap,
  unwrap,
  hasFragment,
  joinWrapped,

  // 转义辅助（导出供 prompt-assembler / Snapshot Test 使用）
  escapeAttr,
  unescapeAttr,
  escapeContent,
  unescapeContent,

  // 测试辅助
  selfCheck,
};
