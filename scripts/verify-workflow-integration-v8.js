/**
 * verify-workflow-integration-v8.js — v4.3.3 集成验证
 *
 * 验证 contracts.js 之外的集成点（v6/v8 契约脚本只覆盖契约本身，集成漂移要单独验）：
 *   1. runtime output.unlockedStage 与 contracts 期望 preferredStage 一致（避免再漂移）
 *   2. workbench fieldMap 把 video_prompt 写入 activeMicroVideoId
 *   3. migrations/004 真能把 notebook.currentStage='framework' 迁到 'schedule'
 *   4. workbench.STAGE_PRIMARY_TYPE 真从 contracts.js 拉（单一来源）
 *   5. session.handlers.v2:getStageContracts IPC 暴露契约（前端拉源）
 *
 * 互补关系：
 *   verify-contracts-v8.js → 契约内部
 *   verify-workflow-integration-v8.js → 契约 × 各业务模块的连接
 */

'use strict';

const path = require('path');
const fs = require('fs');

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

console.log('\n═══ verify-workflow-integration-v8 · v4.3.3 集成验证 ═══\n');

// ── 1. runtime output.unlockedStage 与 contracts 顺序对齐 ────────────────
console.log('【1】runtime output.unlockedStage 与 STAGE_ORDER 对齐（防回归）');
const runtimeSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'v2', 'runtime.js'), 'utf8');
test('lecture confirm 返回 unlockedStage: quiz（不是老 ppt）', () => {
  // 找 lecture confirmation 路径附近的 output 返回
  const lectureSection = runtimeSrc.match(/dirtyReason: 'lecture-confirmed'[\s\S]{0,2000}?output: \{[^}]+\}/);
  assert(lectureSection, 'lecture-confirmed 路径未找到');
  assert(/unlockedStage:\s*['"]quiz['"]/.test(lectureSection[0]),
    `lecture 路径应返回 'quiz'，实际：${lectureSection[0].match(/unlockedStage:\s*['"][\w]+['"]/)?.[0]}`);
});
test('ppt confirm 返回 unlockedStage: lecture（不是老 video）', () => {
  const pptSection = runtimeSrc.match(/dirtyReason: 'ppt-confirmed'[\s\S]{0,2000}?output: \{[^}]+\}/);
  assert(pptSection, 'ppt-confirmed 路径未找到');
  assert(/unlockedStage:\s*['"]lecture['"]/.test(pptSection[0]),
    `ppt 路径应返回 'lecture'，实际：${pptSection[0].match(/unlockedStage:\s*['"][\w]+['"]/)?.[0]}`);
});
test('runtime 不再出现 unlockedStage: framework', () => {
  assert(!/unlockedStage:\s*['"]framework['"]/.test(runtimeSrc), 'runtime.js 仍含 unlockedStage: framework');
});

// ── 2. workbench fieldMap 含 video_prompt 映射 ───────────────────────────
console.log('\n【2】workbench fieldMap 映射完整');
const workbenchSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'workbench.handlers.js'), 'utf8');
test('workbench fieldMap 含 video_prompt → activeMicroVideoId', () => {
  assert(/video_prompt:\s*['"]activeMicroVideoId['"]/.test(workbenchSrc),
    'fieldMap 缺 video_prompt 映射');
});
test('workbench fieldMap 含 quiz_set + homework_set', () => {
  assert(/quiz_set:\s*['"]activeQuizId['"]/.test(workbenchSrc), '缺 quiz_set');
  assert(/homework_set:\s*['"]activeHomeworkId['"]/.test(workbenchSrc), '缺 homework_set');
});
test('workbench 仍保留 micro_video_plan legacy alias', () => {
  assert(/micro_video_plan:\s*['"]activeMicroVideoId['"]/.test(workbenchSrc),
    '老数据兼容性丢了：缺 micro_video_plan legacy alias');
});

// ── 3. workbench.STAGE_PRIMARY_TYPE 从 contracts.js 拉 ───────────────────
console.log('\n【3】workbench STAGE_PRIMARY_TYPE 单一来源');
test('workbench.handlers.js 引用 contracts STAGE_PRIMARY_TYPE', () => {
  assert(/require\(['"]\.\.\/v2\/contracts['"]\)/.test(workbenchSrc)
    || /require\(['"]\.\.\/v2\/contracts\.js['"]\)/.test(workbenchSrc),
    'workbench 没 require contracts.js');
  assert(/STAGE_PRIMARY_TYPE/.test(workbenchSrc), '缺 STAGE_PRIMARY_TYPE 解构');
});

// ── 4. migrations/004 真能迁移 notebook.currentStage ─────────────────────
console.log('\n【4】migrations/004 notebooks.currentStage 迁移');
const m004 = require(path.resolve(__dirname, '..', 'src', 'main', 'migrations', '004-migrate-notebook-currentStage.js'));
test('migrations/004 export run 函数', () => {
  assert(typeof m004.run === 'function', 'run 不是函数');
  assert(m004.MIGRATION_ID === '004-migrate-notebook-currentStage', `MIGRATION_ID 错：${m004.MIGRATION_ID}`);
});
test('mock 老 notebook 跑 004 → currentStage framework→schedule', () => {
  // 构造 mock db
  const fakeData = {
    notebooks: [
      { id: 1, name: 'A', currentStage: 'framework' },
      { id: 2, name: 'B', currentStage: 'schedule' },
      { id: 3, name: 'C', currentStage: 'design' },
    ],
    migrations: [],
  };
  const fakeDb = {
    _readData: () => JSON.parse(JSON.stringify(fakeData)),
    _writeData: (d) => Object.assign(fakeData, d),
  };
  const silentLog = { log: () => {}, warn: () => {}, error: () => {} };
  const result = m004.run(fakeDb, silentLog);
  assert(result.success, `migration 失败：${result.error}`);
  assert(result.notebookFixed === 1, `应修 1 个，实际 ${result.notebookFixed}`);
  assert(fakeData.notebooks[0].currentStage === 'schedule', `notebook A 仍是 ${fakeData.notebooks[0].currentStage}`);
  assert(fakeData.notebooks[0]._legacyCurrentStage === 'framework', 'A 应有 _legacyCurrentStage 标记');
  assert(fakeData.notebooks[1].currentStage === 'schedule', 'B 不应改');
  assert(fakeData.notebooks[2].currentStage === 'design', 'C 不应改');
});
test('migrations/004 幂等：已跑过的 migration 跳过', () => {
  const fakeData = {
    notebooks: [{ id: 1, name: 'A', currentStage: 'framework' }],
    migrations: [{ id: '004-migrate-notebook-currentStage', version: 1, runAt: new Date().toISOString() }],
  };
  const fakeDb = {
    _readData: () => JSON.parse(JSON.stringify(fakeData)),
    _writeData: (d) => Object.assign(fakeData, d),
  };
  const silentLog = { log: () => {}, warn: () => {}, error: () => {} };
  const result = m004.run(fakeDb, silentLog);
  assert(result.skipped === true, '应跳过已跑的 migration');
});

// ── 5. session.handlers v2:getStageContracts IPC 暴露 ────────────────────
console.log('\n【5】v2:getStageContracts IPC 单一来源暴露');
const sessionSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'session.handlers.js'), 'utf8');
test('session.handlers 注册 v2:getStageContracts', () => {
  assert(/['"]v2:getStageContracts['"]/.test(sessionSrc), '缺 v2:getStageContracts handler 注册');
});
test('preload 暴露 getStageContractsV2 给前端', () => {
  const preloadSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'preload', 'index.js'), 'utf8');
  assert(/getStageContractsV2/.test(preloadSrc), 'preload 缺 getStageContractsV2');
});

// ── 6. framework fallback 残留扫描（防回归）──────────────────────────────
console.log('\n【6】framework fallback 残留扫描');
const indexSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
test('index.js syncFrameworkArtifacts 不再 fallback framework', () => {
  // 找 currentStage: ... || 'framework' 模式
  const matches = indexSrc.match(/currentStage:[^,]*\|\|[^,]*['"]framework['"]/g) || [];
  assert(matches.length === 0, `index.js 仍有 ${matches.length} 处 framework fallback：\n${matches.join('\n')}`);
});
test('db-simple.js 默认 workflowState 是 schedule（不是 framework）', () => {
  const dbSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'database', 'db-simple.js'), 'utf8');
  // 找 ' currentStage: ... framework' 模式（注意：comment 里可以有 framework 不算违反）
  const lines = dbSrc.split('\n');
  const offending = lines.filter((l) =>
    /currentStage:\s*['"]framework['"]/.test(l)
    && !l.trim().startsWith('//')
    && !l.trim().startsWith('*')
  );
  assert(offending.length === 0, `db-simple.js 仍有 ${offending.length} 处非注释 framework 默认值：${offending.join(' | ')}`);
});

// ── 结果汇总 ─────────────────────────────────────────────────────────────
console.log(`\n═══ 结果：${pass}/${pass + fail} 通过 ═══`);
if (fail > 0) {
  console.log('\n失败列表：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}\n     ${f.error}`));
  process.exit(1);
}
process.exit(0);
