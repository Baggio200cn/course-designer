/**
 * generation-audit.service.js — Agent 生成调用的完整审计日志（Phase-7.6 R8）
 *
 * 职责：每次 LLM 调用（讲稿/框架/PPT 规划/信息图/Vision 审核）保存：
 *   - prompt（system + user）的字符摘要 + sha256
 *   - model endpoint
 *   - raw output（前 2KB）
 *   - quality 校验结果
 *   - retry reasons（如有）
 *   - 时间戳 + 总耗时
 *
 * 用途：
 *   1. 调试："为什么这次生成的讲稿不达标" → 看 prompt 实际内容
 *   2. 商业化："Agent 真的按规则跑了吗" → 审计可追溯
 *   3. 回归对比：新版 prompt 改造后输出是否变好
 *
 * 设计：
 *   - 写入 db.generation_audit 表（新 schema 字段）
 *   - 老旧数据迁移：缺字段时自动初始化空数组
 *   - 调用方零侵入：record(payload) 异步 fire-and-forget，失败 console.warn 不抛错
 *   - 单笔记本审计上限：默认 200 条，超出按时间淘汰最老
 *
 * 单文件 < 600 行
 */

const crypto = require('crypto');

const DEFAULT_MAX_PER_NOTEBOOK = 200;
const RAW_OUTPUT_TRUNCATE_BYTES = 2048;

/**
 * 计算字符串的 sha256（前 12 字节十六进制）
 * 用于 prompt fingerprint，无需保留全文也可识别"同一 prompt"
 */
function _hash(text) {
  return crypto.createHash('sha256')
    .update(String(text || ''), 'utf8')
    .digest('hex')
    .slice(0, 24);
}

/**
 * 构造一条审计记录的标准化 payload
 *
 * @param {Object} input
 * @param {number} input.notebookId         必填
 * @param {string} input.stage              'framework' | 'lecture_abc' | 'lecture_formal' | 'ppt_plan' | 'framework_infographic' | 'ppt_image' | 'vision_audit'
 * @param {string} [input.endpoint]         AI endpoint ID
 * @param {string} [input.systemPrompt]     完整 system prompt（仅存哈希 + 长度）
 * @param {string} [input.userPrompt]       完整 user prompt（仅存哈希 + 长度）
 * @param {string} [input.rawOutput]        AI 返回原文（截断 2KB 后存）
 * @param {Object} [input.quality]          quality.js 校验结果（valid / errors / warnings）
 * @param {Array}  [input.retryReasons]     重试链每次的失败原因（含 attempt / message）
 * @param {number} [input.attemptCount]     总尝试次数
 * @param {number} [input.durationMs]       总耗时（含重试）
 * @param {string} [input.outcome]          'success' | 'paused' | 'fallback' | 'error'
 * @param {Object} [input.extra]            自由扩展字段（如 visionAssessment 数据）
 *
 * @returns {Object} 标准化 audit 记录
 */
function buildAuditEntry(input = {}) {
  const sysPrompt = String(input.systemPrompt || '');
  const usrPrompt = String(input.userPrompt || '');
  const rawOut = String(input.rawOutput || '');

  return {
    id: Date.now() + Math.floor(Math.random() * 100000),
    notebookId: Number(input.notebookId) || null,
    stage: String(input.stage || 'unknown'),
    endpoint: String(input.endpoint || ''),

    // Prompt 指纹（不存全文以省空间，但可识别"同一 prompt"）
    systemPromptHash: _hash(sysPrompt),
    systemPromptLength: sysPrompt.length,
    userPromptHash: _hash(usrPrompt),
    userPromptLength: usrPrompt.length,

    // 原始输出（截断）
    rawOutputTruncated: rawOut.length > RAW_OUTPUT_TRUNCATE_BYTES
      ? rawOut.slice(0, RAW_OUTPUT_TRUNCATE_BYTES) + `\n[...truncated, total ${rawOut.length} bytes]`
      : rawOut,
    rawOutputLength: rawOut.length,

    // 质量结果
    quality: input.quality && typeof input.quality === 'object'
      ? {
          valid: Boolean(input.quality.valid),
          errorCount: Array.isArray(input.quality.errors) ? input.quality.errors.length : 0,
          warningCount: Array.isArray(input.quality.warnings) ? input.quality.warnings.length : 0,
          firstErrors: Array.isArray(input.quality.errors) ? input.quality.errors.slice(0, 3) : [],
        }
      : null,

    // 重试链
    retryReasons: Array.isArray(input.retryReasons) ? input.retryReasons.slice(0, 5) : [],
    attemptCount: Number(input.attemptCount) || 1,
    durationMs: Number(input.durationMs) || 0,

    outcome: String(input.outcome || 'success'),
    extra: input.extra && typeof input.extra === 'object' ? input.extra : null,

    createdAt: new Date().toISOString(),
  };
}

/**
 * 异步记录一条审计（fire-and-forget，失败仅 console.warn）
 *
 * @param {Object} db - 数据库实例（需有 _readData / _writeData 或 createGenerationAudit 方法）
 * @param {Object} input - 同 buildAuditEntry
 * @returns {Promise<Object|null>} 记录的 entry 或 null（失败时）
 */
async function recordGeneration(db, input) {
  if (!db || typeof db !== 'object') {
    console.warn('[generation-audit] db 缺失，跳过记录');
    return null;
  }
  try {
    const entry = buildAuditEntry(input);
    if (typeof db.createGenerationAudit === 'function') {
      return db.createGenerationAudit(entry);
    }
    // 兜底：直接走 _readData/_writeData
    if (typeof db._readData === 'function' && typeof db._writeData === 'function') {
      const data = db._readData();
      data.generation_audit = Array.isArray(data.generation_audit) ? data.generation_audit : [];
      data.generation_audit.push(entry);
      // 单笔记本上限淘汰
      const maxPerNb = DEFAULT_MAX_PER_NOTEBOOK;
      const sameNbEntries = data.generation_audit.filter(
        (e) => Number(e.notebookId) === Number(entry.notebookId)
      );
      if (sameNbEntries.length > maxPerNb) {
        const toRemove = sameNbEntries.length - maxPerNb;
        // 按 createdAt 排序，移除最老的 N 条
        const sortedByAge = sameNbEntries.sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? -1 : 1);
        const idsToRemove = new Set(sortedByAge.slice(0, toRemove).map((e) => e.id));
        data.generation_audit = data.generation_audit.filter((e) => !idsToRemove.has(e.id));
      }
      db._writeData(data);
      return entry;
    }
    console.warn('[generation-audit] db 缺 createGenerationAudit / _readData，跳过记录');
    return null;
  } catch (err) {
    console.warn('[generation-audit] 记录失败（非致命）:', err.message);
    return null;
  }
}

/**
 * 查询某 notebook 的最近 N 条审计（用于 UI / 调试）
 */
function listRecent(db, notebookId, limit = 30) {
  if (!db || typeof db._readData !== 'function') return [];
  try {
    const data = db._readData();
    const all = Array.isArray(data.generation_audit) ? data.generation_audit : [];
    return all
      .filter((e) => Number(e.notebookId) === Number(notebookId))
      .sort((a, b) => (a.createdAt || '') > (b.createdAt || '') ? -1 : 1)
      .slice(0, limit);
  } catch (err) {
    return [];
  }
}

/**
 * 自检：验证 buildAuditEntry / recordGeneration / listRecent 行为
 */
function selfCheck() {
  const cases = [];

  cases.push({
    name: 'buildAuditEntry 标准化基础字段',
    fn: () => {
      const entry = buildAuditEntry({
        notebookId: 1, stage: 'lecture_formal', endpoint: 'ep-x',
        systemPrompt: 'sys', userPrompt: 'user',
        rawOutput: 'ai-out',
        quality: { valid: true, errors: [], warnings: [] },
        attemptCount: 1, durationMs: 500,
      });
      if (entry.notebookId !== 1) throw new Error('notebookId 错');
      if (entry.stage !== 'lecture_formal') throw new Error('stage 错');
      if (!entry.systemPromptHash) throw new Error('systemPromptHash 缺失');
      if (entry.systemPromptLength !== 3) throw new Error('systemPromptLength 错');
      if (entry.quality.valid !== true) throw new Error('quality.valid 错');
      if (!entry.createdAt) throw new Error('createdAt 缺失');
    },
  });

  cases.push({
    name: 'rawOutput 超 2KB 截断',
    fn: () => {
      const longOut = 'A'.repeat(3000);
      const entry = buildAuditEntry({ notebookId: 1, stage: 'x', rawOutput: longOut });
      if (entry.rawOutputLength !== 3000) throw new Error('rawOutputLength 错');
      if (!entry.rawOutputTruncated.includes('truncated')) throw new Error('应含 truncated 标记');
      if (entry.rawOutputTruncated.length > 2200) throw new Error('截断后应 < 2200');
    },
  });

  cases.push({
    name: 'recordGeneration 写入 mock db',
    fn: async () => {
      const data = { generation_audit: [] };
      const fakeDb = {
        _readData: () => data,
        _writeData: (d) => { data.generation_audit = d.generation_audit; },
      };
      const r = await recordGeneration(fakeDb, {
        notebookId: 1, stage: 'lecture_formal', systemPrompt: 'a', userPrompt: 'b',
      });
      if (!r) throw new Error('应返回记录');
      if (data.generation_audit.length !== 1) throw new Error('应写入 1 条');
    },
  });

  cases.push({
    name: 'recordGeneration 单 notebook 超 200 条淘汰最老',
    fn: async () => {
      const data = { generation_audit: [] };
      // 预填 200 条
      for (let i = 0; i < 200; i++) {
        data.generation_audit.push({
          id: i, notebookId: 1, stage: 'x',
          createdAt: new Date(Date.now() - (200 - i) * 1000).toISOString(),
        });
      }
      const fakeDb = {
        _readData: () => data,
        _writeData: (d) => { data.generation_audit = d.generation_audit; },
      };
      await recordGeneration(fakeDb, { notebookId: 1, stage: 'lecture_formal' });
      // 应淘汰最老的（id=0），新增 1 条
      const ids = data.generation_audit.map((e) => e.id);
      if (ids.includes(0)) throw new Error('最老的 id=0 应被淘汰');
      if (data.generation_audit.length !== 200) throw new Error(`应保持 200，实际 ${data.generation_audit.length}`);
    },
  });

  cases.push({
    name: 'recordGeneration db 缺失返回 null 不抛',
    fn: async () => {
      const r1 = await recordGeneration(null, { notebookId: 1 });
      if (r1 !== null) throw new Error('null db 应返回 null');
      const r2 = await recordGeneration({}, { notebookId: 1 });
      if (r2 !== null) throw new Error('空 db 应返回 null');
    },
  });

  cases.push({
    name: 'listRecent 按 createdAt 倒序返回',
    fn: () => {
      const data = {
        generation_audit: [
          { id: 1, notebookId: 1, createdAt: '2026-04-28T10:00:00.000Z' },
          { id: 2, notebookId: 1, createdAt: '2026-04-28T11:00:00.000Z' },
          { id: 3, notebookId: 2, createdAt: '2026-04-28T12:00:00.000Z' },
          { id: 4, notebookId: 1, createdAt: '2026-04-28T09:00:00.000Z' },
        ],
      };
      const fakeDb = { _readData: () => data };
      const r = listRecent(fakeDb, 1, 10);
      if (r.length !== 3) throw new Error(`期望 3 条 nb=1，实际 ${r.length}`);
      if (r[0].id !== 2) throw new Error('应按 createdAt 倒序，最新的 id=2');
    },
  });

  cases.push({
    name: 'systemPromptHash 同 prompt 哈希一致',
    fn: () => {
      const e1 = buildAuditEntry({ notebookId: 1, stage: 'x', systemPrompt: 'hello' });
      const e2 = buildAuditEntry({ notebookId: 2, stage: 'y', systemPrompt: 'hello' });
      if (e1.systemPromptHash !== e2.systemPromptHash) throw new Error('同 prompt 哈希应一致');
      const e3 = buildAuditEntry({ notebookId: 1, stage: 'x', systemPrompt: 'world' });
      if (e1.systemPromptHash === e3.systemPromptHash) throw new Error('不同 prompt 哈希应不同');
    },
  });

  cases.push({
    name: 'recordGeneration 调 db.createGenerationAudit（如存在）',
    fn: async () => {
      let calledWith = null;
      const fakeDb = {
        createGenerationAudit: (entry) => { calledWith = entry; return entry; },
      };
      await recordGeneration(fakeDb, { notebookId: 1, stage: 'lecture_abc' });
      if (!calledWith || calledWith.stage !== 'lecture_abc') {
        throw new Error('应调 createGenerationAudit');
      }
    },
  });

  return (async () => {
    let passed = 0;
    const failures = [];
    for (let i = 0; i < cases.length; i++) {
      try {
        const r = cases[i].fn();
        if (r && typeof r.then === 'function') await r;
        passed++;
      } catch (e) {
        failures.push({ caseIndex: i + 1, name: cases[i].name, message: e.message });
      }
    }
    return { passed, total: cases.length, failures, success: failures.length === 0 };
  })();
}

module.exports = {
  buildAuditEntry,
  recordGeneration,
  listRecent,
  selfCheck,
  // 常量
  DEFAULT_MAX_PER_NOTEBOOK,
  RAW_OUTPUT_TRUNCATE_BYTES,
};
