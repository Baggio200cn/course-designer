/**
 * verify-operation-compression.js — Phase-6 M3.1 长会话日志压缩验证
 *
 * 验证 5 个层面：
 *   1) coreFieldsRetained — 压缩后核心字段（id/status/timestamps/error）必须保留
 *   2) detailCompressed   — input/output/metadata/warnings 被压缩为摘要
 *   3) failurePreserved   — failed 状态 operation 默认不压缩（保留全量调试信息）
 *   4) idempotent         — 重复压缩不产生副作用
 *   5) batchCompact       — compactOperationsByNotebook 批量压缩 + 字节节省统计
 *
 * 用法：node scripts/verify-operation-compression.js
 *
 * 退出码：0=全部通过，1=任意检查失败
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 临时 DB 目录
const testDir = path.join(os.tmpdir(), `course-designer-m3-1-test-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });
process.env.ELECTRON_USER_DATA = testDir;
const dbFilePath = path.join(testDir, 'course-designer-data.json');

function freshDb() {
  delete require.cache[require.resolve('../src/main/database/db-simple')];
  if (fs.existsSync(dbFilePath)) fs.unlinkSync(dbFilePath);
  const Db = require('../src/main/database/db-simple');
  return new Db();
}

function makeFatOperation(db, overrides = {}) {
  // 构造一个含大量数据的成功 operation
  return db.createOperation({
    notebookId: 999,
    stage: 'lecture',
    action: 'save',
    status: 'completed',
    summary: '保存讲稿阶段',
    input: {
      moduleCount: 5,
      lectureLength: 8000,
      _padding: 'x'.repeat(500),  // 模拟大输入
    },
    output: {
      hasFinalScript: true,
      wordCount: 8123,
      script: 'A'.repeat(1000),    // 大字符串字段，应被压缩
    },
    warnings: ['warning1', 'warning2', 'warning3', 'warning4', 'warning5'],
    metadata: {
      quality: {
        valid: true,
        checks: { finalNarrationCharCount: 7800, qualityScore: 9 },
        errors: [],
        warnings: [],
        bigField: 'B'.repeat(800),  // 应被丢弃
      },
    },
    outputArtifactIds: [101, 102],
    finishedAt: new Date().toISOString(),
    ...overrides,
  });
}

const cases = [];

// 用例 1：核心字段在压缩后仍保留
cases.push({
  name: '核心字段 id/status/summary/timestamps/outputArtifactIds 压缩后保留',
  fn: () => {
    const db = freshDb();
    const op = makeFatOperation(db);
    const compressed = db.compressOperationDetail(op.id, { level: 'auto' });
    if (!compressed) throw new Error('压缩返回 null');
    if (compressed.id !== op.id) throw new Error('id 丢失');
    if (compressed.status !== 'completed') throw new Error('status 丢失');
    if (compressed.summary !== '保存讲稿阶段') throw new Error('summary 丢失');
    if (!compressed.startedAt || !compressed.finishedAt) throw new Error('timestamps 丢失');
    if (!Array.isArray(compressed.outputArtifactIds) || compressed.outputArtifactIds.length !== 2) {
      throw new Error('outputArtifactIds 丢失');
    }
  },
});

// 用例 2：input 被压缩为 byteSize 摘要
cases.push({
  name: 'input 大对象压缩为 byteSize 摘要',
  fn: () => {
    const db = freshDb();
    const op = makeFatOperation(db);
    const compressed = db.compressOperationDetail(op.id);
    if (!compressed.input || !compressed.input._summary) {
      throw new Error('input 未被压缩为摘要：' + JSON.stringify(compressed.input));
    }
    if (typeof compressed.input.byteSize !== 'number' || compressed.input.byteSize === 0) {
      throw new Error('byteSize 应为正数');
    }
  },
});

// 用例 3：output 仅保留 boolean/number/short string 字段
cases.push({
  name: 'output 大字符串被剔除，保留 boolean/number',
  fn: () => {
    const db = freshDb();
    const op = makeFatOperation(db);
    const compressed = db.compressOperationDetail(op.id);
    if (compressed.output.hasFinalScript !== true) throw new Error('boolean 字段应保留');
    if (compressed.output.wordCount !== 8123) throw new Error('number 字段应保留');
    if (compressed.output.script) throw new Error('大字符串 script 应被剔除');
  },
});

// 用例 4：metadata.quality 关键指标保留
cases.push({
  name: 'metadata.quality.valid 与 checks 数字保留',
  fn: () => {
    const db = freshDb();
    const op = makeFatOperation(db);
    const compressed = db.compressOperationDetail(op.id);
    if (!compressed.metadata.quality) throw new Error('quality 应保留');
    if (compressed.metadata.quality.valid !== true) throw new Error('quality.valid 应保留');
    if (compressed.metadata.quality.checks?.finalNarrationCharCount !== 7800) {
      throw new Error('数字 checks 应保留');
    }
    if (compressed.metadata.quality.bigField) throw new Error('bigField 应被剔除');
  },
});

// 用例 5：warnings 截断到前 3 条
cases.push({
  name: 'warnings 数组截断到前 3 条',
  fn: () => {
    const db = freshDb();
    const op = makeFatOperation(db);
    const compressed = db.compressOperationDetail(op.id);
    if (!Array.isArray(compressed.warnings)) throw new Error('warnings 应是数组');
    if (compressed.warnings.length !== 3) {
      throw new Error(`warnings 应截断到 3，实际 ${compressed.warnings.length}`);
    }
  },
});

// 用例 6：failed 状态默认不压缩
cases.push({
  name: 'failed operation 默认不压缩（保留全量调试信息）',
  fn: () => {
    const db = freshDb();
    const op = db.createOperation({
      notebookId: 999, stage: 'lecture', action: 'save', status: 'failed',
      input: { large: 'x'.repeat(500) },
      output: { script: 'BIG'.repeat(300) },
      error: 'Validation failed: 字数不足',
      finishedAt: new Date().toISOString(),
    });
    const result = db.compressOperationDetail(op.id, { level: 'auto' });
    // auto 模式下 failed 不压缩
    if (result._compressed) throw new Error('failed 不应被自动压缩');
    if (result.error !== 'Validation failed: 字数不足') throw new Error('error 应保留');
    if (!result.input || !result.input.large) throw new Error('input 应保留');
  },
});

// 用例 7：success_summary 强制压缩 failed
cases.push({
  name: 'level=success_summary 强制压缩 failed',
  fn: () => {
    const db = freshDb();
    const op = db.createOperation({
      notebookId: 999, stage: 'lecture', action: 'save', status: 'failed',
      input: { large: 'x'.repeat(500) },
      error: 'fatal',
      finishedAt: new Date().toISOString(),
    });
    const result = db.compressOperationDetail(op.id, { level: 'success_summary' });
    if (result._compressed !== 'success_summary') throw new Error('应被强制压缩');
    if (result.error !== 'fatal') throw new Error('error 字段始终保留');
  },
});

// 用例 8：archive 模式极致压缩
cases.push({
  name: 'level=archive 清空所有可选字段',
  fn: () => {
    const db = freshDb();
    const op = makeFatOperation(db);
    const result = db.compressOperationDetail(op.id, { level: 'archive' });
    if (result.input !== null) throw new Error('archive 应清空 input');
    if (result.output !== null) throw new Error('archive 应清空 output');
    if (!result.metadata._archived) throw new Error('metadata 应标记 _archived');
    if (result.warnings.length !== 0) throw new Error('warnings 应清空');
  },
});

// 用例 9：幂等——重复压缩不重复修改
cases.push({
  name: '幂等：重复压缩不变 _compressed 字段',
  fn: () => {
    const db = freshDb();
    const op = makeFatOperation(db);
    const r1 = db.compressOperationDetail(op.id);
    const r1Stamp = r1.updatedAt;
    // 立即再压一次（同 level）应无变化
    const r2 = db.compressOperationDetail(op.id);
    if (r2.updatedAt !== r1Stamp) {
      throw new Error('幂等失败：重复压缩 updatedAt 改变了');
    }
  },
});

// 用例 10：不存在的 id 返回 null
cases.push({
  name: '不存在的 operationId 返回 null',
  fn: () => {
    const db = freshDb();
    if (db.compressOperationDetail(99999999) !== null) throw new Error('应返回 null');
  },
});

// 用例 11：compactOperationsByNotebook 批量压缩 + 节省字节统计
cases.push({
  name: '批量压缩：compactOperationsByNotebook 返回节省统计',
  fn: () => {
    const db = freshDb();
    // 创建 5 个 fat completed operations
    for (let i = 0; i < 5; i++) makeFatOperation(db);
    // 1 个 failed
    db.createOperation({
      notebookId: 999, stage: 'lecture', action: 'save', status: 'failed',
      error: 'oops',
      finishedAt: new Date().toISOString(),
    });
    const res = db.compactOperationsByNotebook(999);
    // 5 个被压缩，1 个 failed 跳过
    if (res.compressedCount !== 5) {
      throw new Error(`期望压缩 5 个，实际 ${res.compressedCount}`);
    }
    if (res.skippedCount !== 1) {
      throw new Error(`期望跳过 1 个，实际 ${res.skippedCount}`);
    }
    if (res.byteSavedEstimate <= 0) {
      throw new Error(`字节节省应 > 0，实际 ${res.byteSavedEstimate}`);
    }
  },
});

// 用例 12：跨 notebook 隔离
cases.push({
  name: 'compactOperationsByNotebook 仅影响指定 notebook',
  fn: () => {
    const db = freshDb();
    makeFatOperation(db, { notebookId: 100 });
    makeFatOperation(db, { notebookId: 200 });
    const res = db.compactOperationsByNotebook(100);
    if (res.compressedCount !== 1) throw new Error('应只压缩 notebook=100 的');
    // notebook 200 仍未压缩
    const allOps = db.listOperations({ notebookId: 200 });
    if (!allOps[0] || allOps[0]._compressed) {
      throw new Error('notebook 200 不应被压缩');
    }
  },
});

// 用例 13：task-runtime 集成 — 成功路径自动压缩
cases.push({
  name: 'task-runtime: 成功 operation 自动压缩',
  fn: () => {
    const db = freshDb();
    const { createTaskRuntime } = require('../src/main/v2/task-runtime');
    const events = [];
    const taskRuntime = createTaskRuntime({ db, emitEvent: (e) => events.push(e) });

    return (async () => {
      await taskRuntime.runStageAction(
        { notebookId: 999, stage: 'lecture', action: 'save', summary: '测试' },
        async () => ({
          output: { hasFinalScript: true, wordCount: 8000, script: 'X'.repeat(1000) },
          metadata: { quality: { valid: true } },
          warnings: [],
        })
      );
      // 验证 db 中已被压缩
      const ops = db.listOperations({ notebookId: 999 });
      if (ops.length !== 1) throw new Error(`应有 1 条 operation，实际 ${ops.length}`);
      const op = ops[0];
      if (!op._compressed) throw new Error('成功 operation 应被自动压缩');
      if (op.output && op.output.script) throw new Error('大字符串应被剔除');
    })();
  },
});

// 用例 14：task-runtime 失败路径不压缩
cases.push({
  name: 'task-runtime: 失败 operation 不压缩',
  fn: () => {
    const db = freshDb();
    const { createTaskRuntime } = require('../src/main/v2/task-runtime');
    const taskRuntime = createTaskRuntime({ db, emitEvent: () => {} });

    return (async () => {
      try {
        await taskRuntime.runStageAction(
          { notebookId: 999, stage: 'lecture', action: 'save', input: { large: 'x'.repeat(500) } },
          async () => { throw new Error('mock failure'); }
        );
        throw new Error('should have thrown');
      } catch (e) {
        if (e.message === 'should have thrown') throw e;
      }
      const ops = db.listOperations({ notebookId: 999 });
      const op = ops[0];
      if (op.status !== 'failed') throw new Error('应为 failed');
      if (op._compressed) throw new Error('failed 不应被压缩');
      if (!op.error) throw new Error('error 应保留');
    })();
  },
});

// ─── 主流程 ────────────────────────────────────────────
async function main() {
  let passed = 0;
  const failures = [];
  for (const c of cases) {
    try {
      const result = c.fn();
      if (result && typeof result.then === 'function') await result;
      passed++;
    } catch (e) {
      failures.push({ name: c.name, message: e.message });
    }
  }

  // 清理
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (e) { /* 忽略 */ }

  const ok = failures.length === 0;
  console.log(JSON.stringify({
    ok,
    checkedAt: new Date().toISOString(),
    passed,
    total: cases.length,
    failures,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
