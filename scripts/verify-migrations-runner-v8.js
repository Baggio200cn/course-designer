/**
 * verify-migrations-runner-v8.js — v4.3.3 Codex Round 10 P0
 *
 * 验证 src/main/migrations/runner.js 真实跑通：
 *   1. 临时 DB 构造老数据（framework workflowState / micro_video_plan / 缺 schemaVersion 的 artifact）
 *   2. 调 runMigrations(db, { migrationDir, log }) 真实执行 001-004
 *   3. 断言：
 *      a) data.migrations 数组追加了 4 条记录
 *      b) workflowState framework → schedule
 *      c) micro_video_plan → video_prompt（_legacyType 保留）
 *      d) 所有 artifact 补 schemaVersion=1 + dirty=false
 *      e) notebook.currentStage=framework → schedule
 *   4. 跑两次：第二次 skipped（幂等性）
 *
 * 这覆盖了上一轮 Codex 第 7 轮 #1 真实使用路径 bug。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failures.push({ name, error: err.message });
    fail += 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\n═══ verify-migrations-runner-v8 · v4.3.3 真实执行链路验证 ═══\n');

// ── 构造临时 DB ────────────────────────────────────────────────────────
const tmpDb = path.join(os.tmpdir(), `migration-runner-test-${Date.now()}.json`);
const fakeData = {
  notebooks: [
    { id: 1, name: 'A', currentStage: 'framework' },
    { id: 2, name: 'B', currentStage: 'schedule' },
  ],
  workflowStates: [
    { notebookId: 1, currentStage: 'framework', unlockedStages: ['framework', 'schedule'] },
    { notebookId: 2, currentStage: 'schedule', unlockedStages: ['schedule', 'design'] },
  ],
  artifacts: [
    {
      id: 100, notebookId: 1, type: 'design_doc', stage: 'design',
      content: { topic: 'A', _legacy: true },
      // 缺 schemaVersion, dirty, status, confirmed
    },
    {
      id: 101, notebookId: 1, type: 'micro_video_plan', stage: 'video',
      content: { duration: 75 },
    },
    {
      id: 102, notebookId: 1, type: 'design_doc', stage: 'design',
      content: { topic: 'old version', size: 500 },
      status: 'deleted',  // 可恢复
    },
    {
      id: 103, notebookId: 2, type: 'ppt_outline', stage: 'ppt',
      content: { pages: [{ pageNumber: 1, title: 'A' }] },
      confirmed: true, status: 'confirmed',
    },
  ],
  migrations: [],
  globalState: {},
  settings: { app_version: '4.3.3' },
};
fs.writeFileSync(tmpDb, JSON.stringify(fakeData), 'utf8');

// 创建一个 minimal stub db（实现 _readData / _writeData）
const stubDb = {
  _readData: () => JSON.parse(fs.readFileSync(tmpDb, 'utf8')),
  _writeData: (d) => fs.writeFileSync(tmpDb, JSON.stringify(d, null, 2), 'utf8'),
};

// ── 1. runner.js 存在且 export runMigrations ─────────────────────────
console.log('【1】runner.js 模块结构');
test('runner.js 文件存在', () => {
  const runnerPath = path.resolve(__dirname, '..', 'src', 'main', 'migrations', 'runner.js');
  assert(fs.existsSync(runnerPath), 'src/main/migrations/runner.js 不存在');
});
test('runner.js export runMigrations 函数', () => {
  const runner = require(path.resolve(__dirname, '..', 'src', 'main', 'migrations', 'runner.js'));
  assert(typeof runner.runMigrations === 'function', 'runner.runMigrations 不是函数');
});

// ── 2. 首次跑 ───────────────────────────────────────────────────────
console.log('\n【2】首次 runMigrations 真实执行');
const { runMigrations } = require(path.resolve(__dirname, '..', 'src', 'main', 'migrations', 'runner.js'));
const migrationDir = path.resolve(__dirname, '..', 'src', 'main', 'migrations');
const silentLog = { log: () => {}, warn: () => {}, error: () => {} };
let firstResult;
test('runner 不报错执行', () => {
  firstResult = runMigrations(stubDb, { migrationDir, log: silentLog });
  assert(firstResult, 'runMigrations 返回空');
  assert(firstResult.success === true, `success 应 true，实际：${firstResult.success}`);
});
test('runner 至少扫描到 4 个 migration（001-004）', () => {
  assert(firstResult.total >= 4, `total 应 >= 4，实际：${firstResult.total}`);
});
test('首次执行 4 个 migration（executed=4, skipped=0）', () => {
  assert(firstResult.executed === 4, `executed 应 4，实际：${firstResult.executed}`);
  assert(firstResult.skipped === 0, `skipped 应 0，实际：${firstResult.skipped}`);
  assert(firstResult.failed === 0, `failed 应 0，实际：${firstResult.failed}`);
});

// ── 3. 断言 DB 被正确改造 ───────────────────────────────────────────
console.log('\n【3】DB 数据规范化（关键 P0 验证）');
const dbAfter = stubDb._readData();

test('data.migrations 数组追加了 ≥ 4 条记录', () => {
  assert(Array.isArray(dbAfter.migrations), 'migrations 不是数组');
  assert(dbAfter.migrations.length >= 4, `migrations 长度应 >= 4，实际：${dbAfter.migrations.length}`);
});
test('notebooks.currentStage framework → schedule (migration 004)', () => {
  const a = dbAfter.notebooks.find(n => n.id === 1);
  assert(a.currentStage === 'schedule', `notebook A 应是 schedule，实际：${a.currentStage}`);
  assert(a._legacyCurrentStage === 'framework', 'A 应保留 _legacyCurrentStage 标记');
});
test('workflowStates framework → schedule (migration 003)', () => {
  const w = dbAfter.workflowStates.find(w => w.notebookId === 1);
  assert(w.currentStage === 'schedule', `workflow 应 schedule，实际：${w.currentStage}`);
  assert(!w.unlockedStages.includes('framework'), 'unlockedStages 仍含 framework');
});
test('artifact micro_video_plan → video_prompt (migration 003)', () => {
  const a = dbAfter.artifacts.find(a => a.id === 101);
  assert(a.type === 'video_prompt', `type 应 video_prompt，实际：${a.type}`);
  assert(a._legacyType === 'micro_video_plan', '应保留 _legacyType 标记');
});
test('所有 artifact 补齐 schemaVersion=1 + dirty=false (migration 003)', () => {
  dbAfter.artifacts.forEach(a => {
    assert(a.schemaVersion === 1, `artifact ${a.id} schemaVersion 应 1，实际：${a.schemaVersion}`);
    assert(a.dirty === false, `artifact ${a.id} dirty 应 false，实际：${a.dirty}`);
  });
});

// ── 4. 幂等性：第二次跑全 skipped ─────────────────────────────────────
console.log('\n【4】幂等性 · 第二次跑全 skipped');
let secondResult;
test('第二次 runMigrations 不报错', () => {
  secondResult = runMigrations(stubDb, { migrationDir, log: silentLog });
});
test('第二次跑 skipped >= 4（不重复执行）', () => {
  assert(secondResult.skipped >= 4, `skipped 应 >= 4，实际：${secondResult.skipped}`);
  assert(secondResult.executed === 0, `executed 应 0，实际：${secondResult.executed}`);
});

// ── 5. db 不可用时降级 ─────────────────────────────────────────────
console.log('\n【5】db 缺失时降级（不抛错）');
test('db=null 时 runner 返回 error 不抛异常', () => {
  const r = runMigrations(null, { migrationDir, log: silentLog });
  assert(r.success === false, 'success 应 false');
  assert(/db unavailable|unavailable/i.test(r.error || ''), '应有 db unavailable 错误');
});
test('db 缺 _readData 时降级', () => {
  const r = runMigrations({ notExist: true }, { migrationDir, log: silentLog });
  assert(r.success === false, 'success 应 false');
});

// ── 6. index.js 真把 runner 接进 db init 后 ─────────────────────────
console.log('\n【6】index.js 集成（防回归）');
const indexSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
test('index.js require migrations/runner', () => {
  assert(/require\(['"]\.\/migrations\/runner['"]\)/.test(indexSrc), 'index.js 没 require runner');
});
test('index.js 调 runMigrations 在 db = new DatabaseManager() 之后', () => {
  const dbInitIdx = indexSrc.search(/db\s*=\s*new\s+DatabaseManager/);
  const runMigIdx = indexSrc.search(/runMigrations\s*\(/);
  assert(dbInitIdx >= 0, '找不到 db = new DatabaseManager()');
  assert(runMigIdx >= 0, '找不到 runMigrations() 调用');
  assert(runMigIdx > dbInitIdx,
    `runMigrations 必须在 db init 之后 · dbInit@${dbInitIdx}, runMig@${runMigIdx}`);
});
test('index.js 内联 migration scan 旧代码已移除', () => {
  // 旧的代码片段：if (fs.existsSync(migrationDir)) { migrationFiles.forEach... }
  const lines = indexSrc.split('\n');
  // 寻找 "migrationFiles.forEach" 不应再出现（已挪到 runner.js）
  const offending = lines.filter(l => /migrationFiles\s*\.\s*forEach/.test(l));
  assert(offending.length === 0, `index.js 仍含内联 migration 扫描代码：${offending.join(' | ')}`);
});

// 清理临时文件
try { fs.unlinkSync(tmpDb); } catch (_) {}

console.log(`\n═══ 结果：${pass}/${pass + fail} 通过 ═══`);
if (fail > 0) {
  console.log('\n失败列表：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}\n     ${f.error}`));
  process.exit(1);
}
process.exit(0);
