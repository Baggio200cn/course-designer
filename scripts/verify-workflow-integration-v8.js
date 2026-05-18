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

// ── 6. V2App.jsx 前端阶段过滤包含 quiz/homework（Codex Round 5 #1 防回归）─────
console.log('\n【6】V2App STAGE_KEYS 必须包含 quiz/homework');
const v2AppSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'V2App.jsx'), 'utf8');
test('V2App 不再存在硬编码 6 阶段 STAGE_KEYS（旧 STAGE_KEYS_V4 = [...6...]）', () => {
  // 旧危险模式：STAGE_KEYS_V4 = ['schedule', 'design', 'ppt', 'lecture', 'video', 'report']
  //   该数组**不**含 quiz / homework → 会把这两阶段从 unlockedStages 过滤掉
  // 现在应该全是动态 stageContracts.STAGE_ORDER || 8 阶段 fallback
  const dangerousLine = /STAGE_KEYS[\w_]*\s*=\s*\[[^\]]*'video'[^\]]*\][^\n]*$/m;
  const lines = v2AppSrc.split('\n');
  const offending = lines.filter((l) => {
    // 硬编码且不包含 quiz/homework 的危险数组
    if (!dangerousLine.test(l)) return false;
    if (l.includes('quiz') || l.includes('homework')) return false;
    // 排除注释行
    if (l.trim().startsWith('//') || l.trim().startsWith('*')) return false;
    return true;
  });
  assert(offending.length === 0, `V2App 仍有 ${offending.length} 处硬编码 6 阶段 STAGE_KEYS：\n${offending.join('\n')}`);
});
test('V2App STAGE_KEYS fallback 包含 quiz/homework（防 stageContracts 加载失败时降级）', () => {
  // 必须能找到一个 fallback 8 阶段数组（带 quiz + homework）
  const fallback8 = /\[[^\]]*'quiz'[^\]]*'homework'[^\]]*\]|\[[^\]]*'homework'[^\]]*'quiz'[^\]]*\]/;
  assert(fallback8.test(v2AppSrc), 'V2App 找不到 8 阶段 fallback 数组（应在 stageContracts || [...] 形式中）');
});
test('V2App 使用 stageContracts.STAGE_ORDER 作为 STAGE_KEYS 主权源', () => {
  // 应该有 stageContracts?.STAGE_ORDER ||  ... 模式（不只是 handleForceUnlockNext 一处）
  const stageKeysUsageRe = /STAGE_KEYS[\w_]*\s*=\s*stageContracts\??\.?\s*STAGE_ORDER/;
  assert(stageKeysUsageRe.test(v2AppSrc),
    'V2App 的 STAGE_KEYS 未接管为 stageContracts.STAGE_ORDER（仍硬编码会过滤 quiz/homework）');
});

// ── 7. session.handlers setActiveArtifact fieldMap 含 quiz/homework ──────────
console.log('\n【7】session.handlers setActiveArtifact 支持 quiz/homework');
test('session.handlers fieldMap 含 quiz: activeQuizId', () => {
  assert(/quiz:\s*['"]activeQuizId['"]/.test(sessionSrc), 'fieldMap 缺 quiz 映射');
});
test('session.handlers fieldMap 含 homework: activeHomeworkId', () => {
  assert(/homework:\s*['"]activeHomeworkId['"]/.test(sessionSrc), 'fieldMap 缺 homework 映射');
});

// ── 8. workbench STAGE_TYPES / TYPE_LABEL 也从 contracts 拉（Codex Round 5 #5）──
console.log('\n【8】workbench STAGE_TYPES / TYPE_LABEL 单一来源');
test('workbench import ARTIFACT_TYPES_BY_STAGE 从 contracts', () => {
  assert(/ARTIFACT_TYPES_BY_STAGE/.test(workbenchSrc), 'workbench 缺 ARTIFACT_TYPES_BY_STAGE 引入');
});
test('workbench import ARTIFACT_TYPE_LABEL 从 contracts', () => {
  assert(/ARTIFACT_TYPE_LABEL/.test(workbenchSrc), 'workbench 缺 ARTIFACT_TYPE_LABEL 引入');
});
test('contracts.js 导出 ARTIFACT_TYPE_LABEL + ARTIFACT_TYPES_BY_STAGE', () => {
  const contracts = require(path.resolve(__dirname, '..', 'src', 'main', 'v2', 'contracts.js'));
  assert(contracts.ARTIFACT_TYPE_LABEL, 'contracts.js 没导出 ARTIFACT_TYPE_LABEL');
  assert(contracts.ARTIFACT_TYPES_BY_STAGE, 'contracts.js 没导出 ARTIFACT_TYPES_BY_STAGE');
  assert(contracts.ARTIFACT_TYPE_LABEL.quiz_set, 'ARTIFACT_TYPE_LABEL 缺 quiz_set');
  assert(contracts.ARTIFACT_TYPE_LABEL.homework_set, 'ARTIFACT_TYPE_LABEL 缺 homework_set');
  assert(contracts.ARTIFACT_TYPE_LABEL.video_prompt, 'ARTIFACT_TYPE_LABEL 缺 video_prompt');
});

// ── 9. framework fallback 残留扫描（防回归）──────────────────────────────
console.log('\n【9】framework fallback 残留扫描');
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
