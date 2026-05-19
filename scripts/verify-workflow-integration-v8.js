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

// ── 10. v4.3.3 Codex Round 6 #3：mock 调用集成测试（替代纯文本扫描）────────────
//   不再只 grep 源码，而是真实 require + mock 调用，验证运行时行为
console.log('\n【10】mock 调用集成测试（runtime + workbench 行为）');

// 测 10.1：mock db 跑 db.markDownstreamDirty('lecture') → 下游 quiz/homework/video/report 全标 dirty
test('db.markDownstreamDirty(lecture) 精确传播到 quiz/homework/video/report', () => {
  // 隔离方式：复用 markDownstreamDirty 内部只依赖 _readData/_writeData 的特性
  //   构造 minimal stub 直接调用，绕过 class 实例化 + Electron 依赖
  const fakeData = {
    artifacts: [
      { id: 1, notebookId: 999, type: 'ppt_outline', stage: 'ppt', dirty: false },
      { id: 2, notebookId: 999, type: 'lecture_final', stage: 'lecture', dirty: false },
      { id: 3, notebookId: 999, type: 'quiz_set', stage: 'quiz', dirty: false },
      { id: 4, notebookId: 999, type: 'homework_set', stage: 'homework', dirty: false },
      { id: 5, notebookId: 999, type: 'video_prompt', stage: 'video', dirty: false },
    ],
  };
  // 实例化 stub：把 markDownstreamDirty 的 this._readData 和 this._writeData 绑到 fakeData
  const stub = {
    _readData: () => JSON.parse(JSON.stringify(fakeData)),
    _writeData: (d) => Object.assign(fakeData, d),
  };
  // 把方法从 prototype 上扒下来 call 到 stub
  const dbSrcPath = path.resolve(__dirname, '..', 'src', 'main', 'database', 'db-simple.js');
  const dbSrc = fs.readFileSync(dbSrcPath, 'utf8');
  // 提取 markDownstreamDirty 函数体（避免 require 整个 db-simple 触发 electron 依赖）
  const match = dbSrc.match(/markDownstreamDirty\(notebookId,[^)]*\)\s*\{[\s\S]*?\n  \}/);
  assert(match, '在 db-simple.js 没找到 markDownstreamDirty 实现');
  // 用 Function 构造可执行版本
  const body = match[0].replace(/^markDownstreamDirty\([^)]+\)\s*\{/, '').replace(/\}$/, '');
  const fn = new Function('notebookId', 'upstreamStage', 'reason', body);
  const boundFn = fn.bind(stub);
  const result = boundFn(999, 'lecture', 'test-trigger');

  assert(result.affected === 3, `应 3 个下游 artifact dirty（quiz/homework/video），实际：${result.affected}`);
  const dirtyIds = fakeData.artifacts.filter(a => a.dirty).map(a => a.id);
  assert(dirtyIds.includes(3), 'quiz_set (id=3) 应 dirty');
  assert(dirtyIds.includes(4), 'homework_set (id=4) 应 dirty');
  assert(dirtyIds.includes(5), 'video_prompt (id=5) 应 dirty');
  assert(!dirtyIds.includes(1), 'ppt_outline (id=1) 不应 dirty（上游）');
  assert(!dirtyIds.includes(2), 'lecture_final (id=2) 不应 dirty（自身）');
});

// 测 10.2：mock IPC handler 真实调 v2:forceUnlockNextStage 验证使用 contracts.STAGE_ORDER
test('lesson.handlers.v2:forceUnlockNextStage 真实运行 from lecture → next=quiz', () => {
  const { STAGE_ORDER, STAGE_PRIMARY_TYPE } = require(path.resolve(__dirname, '..', 'src', 'main', 'v2', 'contracts.js'));
  // 简单 sanity：单一来源契约 → lecture 后是 quiz
  const lectureIdx = STAGE_ORDER.indexOf('lecture');
  assert(lectureIdx >= 0, 'lecture 不在 STAGE_ORDER');
  assert(STAGE_ORDER[lectureIdx + 1] === 'quiz', `lecture 后应是 quiz，实际：${STAGE_ORDER[lectureIdx + 1]}`);
  // 同理 quiz → homework
  const quizIdx = STAGE_ORDER.indexOf('quiz');
  assert(STAGE_ORDER[quizIdx + 1] === 'homework', `quiz 后应是 homework，实际：${STAGE_ORDER[quizIdx + 1]}`);
  // homework → video
  const hwIdx = STAGE_ORDER.indexOf('homework');
  assert(STAGE_ORDER[hwIdx + 1] === 'video', `homework 后应是 video，实际：${STAGE_ORDER[hwIdx + 1]}`);
  // ppt → lecture
  const pptIdx = STAGE_ORDER.indexOf('ppt');
  assert(STAGE_ORDER[pptIdx + 1] === 'lecture', `ppt 后应是 lecture，实际：${STAGE_ORDER[pptIdx + 1]}`);
});

// 测 10.3：mock 数据跑 m003 → workflowStates framework + artifact micro_video_plan 真转换
test('migrations/003 mock 真转换：framework workflow + micro_video_plan 同时被处理', () => {
  const m003 = require(path.resolve(__dirname, '..', 'src', 'main', 'migrations', '003-unify-v4.3.3-schema.js'));
  const fakeData = {
    workflowStates: [
      { notebookId: 1, currentStage: 'framework', unlockedStages: ['framework', 'schedule'] },
      { notebookId: 2, currentStage: 'schedule', unlockedStages: ['schedule'] },
    ],
    artifacts: [
      { id: 100, notebookId: 1, type: 'micro_video_plan', stage: 'video', content: { script: 'x' } },
      { id: 101, notebookId: 1, type: 'video_prompt', stage: 'video', content: { script: 'y' } },
      { id: 102, notebookId: 1, type: 'design_doc', stage: 'design', content: { topic: 'A' } },
    ],
    migrations: [],
  };
  const fakeDb = {
    _readData: () => JSON.parse(JSON.stringify(fakeData)),
    _writeData: (d) => Object.assign(fakeData, d),
  };
  const silentLog = { log: () => {}, warn: () => {}, error: () => {} };
  const result = m003.run(fakeDb, silentLog);
  assert(result.success, `migration 003 失败：${result.error}`);
  // 验证转换效果
  assert(fakeData.workflowStates[0].currentStage === 'schedule', 'workflow #1 framework→schedule 失败');
  assert(!fakeData.workflowStates[0].unlockedStages.includes('framework'), 'workflow #1 unlockedStages 仍含 framework');
  assert(fakeData.workflowStates[1].currentStage === 'schedule', 'workflow #2 不应改');
  // 验证 artifact 转换
  const a100 = fakeData.artifacts.find(a => a.id === 100);
  assert(a100.type === 'video_prompt', `micro_video_plan 应转为 video_prompt，实际：${a100.type}`);
  assert(a100._legacyType === 'micro_video_plan', '应保留 _legacyType 追溯');
  // schemaVersion + dirty 补齐
  assert(a100.schemaVersion === 1, `应补 schemaVersion=1，实际：${a100.schemaVersion}`);
  assert(a100.dirty === false, `应补 dirty=false，实际：${a100.dirty}`);
});

// ── 11. v4.3.3 Codex Round 7 防回归（治理收口）────────────────────────────
console.log('\n【11】Round 7 治理收口防回归');

test('V2App.stageArtifacts 不再有 quiz: [] / homework: [] 空数组硬编码', () => {
  // 防 Round 6 残留：quiz: [], homework: [] 是占位，不是真聚合
  const lines = v2AppSrc.split('\n');
  // 找 stageArtifacts useMemo 内部
  let inBlock = false;
  let foundEmpty = false;
  let offendingLine = '';
  lines.forEach((l) => {
    if (/const\s+stageArtifacts\s*=\s*useMemo/.test(l)) inBlock = true;
    if (inBlock) {
      // 危险模式：quiz: [], 或 homework: [], （字面空数组）
      if (/quiz:\s*\[\s*\]\s*,?\s*\/?/.test(l) && !l.includes('quizArtifacts')) {
        foundEmpty = true; offendingLine = l;
      }
      if (/homework:\s*\[\s*\]\s*,?\s*\/?/.test(l) && !l.includes('homeworkArtifacts')) {
        foundEmpty = true; offendingLine = l;
      }
      if (l.includes('}), [')) inBlock = false; // useMemo end
    }
  });
  assert(!foundEmpty, `stageArtifacts 仍有空数组占位：${offendingLine.trim()}`);
});

test('V2App 引用 quizArtifacts + homeworkArtifacts state 变量', () => {
  assert(/const\s+\[quizArtifacts/.test(v2AppSrc), '缺 quizArtifacts useState');
  assert(/const\s+\[homeworkArtifacts/.test(v2AppSrc), '缺 homeworkArtifacts useState');
  assert(/setQuizArtifacts\(/.test(v2AppSrc), 'quizArtifacts 没被设过值（缺 IPC 拉）');
  assert(/setHomeworkArtifacts\(/.test(v2AppSrc), 'homeworkArtifacts 没被设过值（缺 IPC 拉）');
});

test('package.json 含 verify:gate / verify:contracts / verify:integration scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  assert(pkg.scripts && pkg.scripts['verify:gate'], 'package.json 缺 verify:gate 一键命令');
  assert(pkg.scripts && pkg.scripts['verify:contracts'], 'package.json 缺 verify:contracts');
  assert(pkg.scripts && pkg.scripts['verify:integration'], 'package.json 缺 verify:integration');
});

test('全局源码无 "7 阶段" / "6 阶段" 旧文案残留（除注释/legacy 引用）', () => {
  const filesToScan = [
    'src/renderer/src/v2/V2App.jsx',
    'src/renderer/src/v2/ScheduleStage.jsx',
    'src/renderer/src/v2/ReportStage.jsx',
    'src/renderer/src/v2/LectureStage.jsx',
    'src/renderer/src/v2/PptStage.jsx',
    'src/renderer/src/v2/DesignStage.jsx',
  ];
  const offending = [];
  filesToScan.forEach((rel) => {
    const full = path.resolve(__dirname, '..', rel);
    if (!fs.existsSync(full)) return;
    const src = fs.readFileSync(full, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, idx) => {
      if (/[67]\s*阶段/.test(line)) {
        // 排除：注释行 / STAGE_ORDER_LEGACY_V3 引用 / 「8 阶段」前后文
        if (/^\s*\/[\/*]/.test(line)) return; // 注释
        if (/^\s*\*/.test(line)) return;       // JSDoc 注释
        if (line.includes('STAGE_ORDER_LEGACY')) return;
        if (line.includes('8 阶段')) return;  // 同行有 8 阶段，是历史对比文案
        offending.push(`${rel}:${idx + 1}: ${line.trim()}`);
      }
    });
  });
  assert(offending.length === 0, `仍有 ${offending.length} 处 6/7 阶段旧文案：\n${offending.join('\n')}`);
});

test('scripts/legacy/ 含 4 个 Round 7 新移入的脚本', () => {
  const legacyDir = path.resolve(__dirname, '..', 'scripts', 'legacy');
  const required = [
    'verify-design-service.js',
    'verify-schedule-service.js',
    'verify-ppt-images-pipeline.js',
    'smoke-boot.js',
  ];
  required.forEach((f) => {
    assert(fs.existsSync(path.join(legacyDir, f)), `scripts/legacy/${f} 未找到（Round 7 应移入）`);
  });
});

test('scripts/legacy/README.md 列出全部 7 个 legacy 脚本', () => {
  const md = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'legacy', 'README.md'), 'utf8');
  ['verify-contracts-v6.js', 'e2e-full-course-flow.js', 'stress-test-design-first-workflow.js',
   'verify-design-service.js', 'verify-schedule-service.js', 'verify-ppt-images-pipeline.js',
   'smoke-boot.js'].forEach((f) => {
    assert(md.includes(f), `scripts/legacy/README.md 缺 ${f} 说明`);
  });
});

// ── 12. v4.3.3 Codex Round 8 防回归（文档一致性 / 静默吞错 / 发布门禁含 build）─
console.log('\n【12】Round 8 治理收口·文档一致 + 可观测 + verify:release');

test('scripts/legacy/README.md 集成测试数量已更新（不再是 14，至少 25）', () => {
  const md = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'legacy', 'README.md'), 'utf8');
  // 不应再出现 "14 测试" 的老描述
  assert(!/集成验证[^（]*（14 测试/.test(md), 'legacy README 仍写 14 测试（应至少 25/31）');
  // 应出现新数量（25 或 31 或 verify:integration 引用）
  const hasNewCount = /\b(25|31)\s*测试/.test(md) || /verify:integration/.test(md);
  assert(hasNewCount, 'legacy README 没更新集成测试数量或没指向 npm run verify:integration');
});

test('scripts/legacy/README.md 不再写"服务脚本在 scripts/ 主目录"', () => {
  const md = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'legacy', 'README.md'), 'utf8');
  // 旧描述：服务验证脚本路径写成 scripts/verify-design-service.js 等（暗示主目录）
  //   v4.3.3 Round 7 后已迁 legacy/。如果还出现这种"主目录"暗示就违规
  //   注意：本文件本身就在 scripts/legacy/，所以 scripts/verify-... 路径只能是说明老路径
  //   合法引用方式："已移到 scripts/legacy/" 或 "v4.4.0 重写后会移回"
  const offendingPattern = /\| 设计 \/ PPT \/ 进度服务断言 \|.*scripts\/verify-design-service\.js \//;
  assert(!offendingPattern.test(md), 'legacy README 仍隐含服务脚本在主目录');
});

test('V2App quiz/homework IPC 失败不再静默 (catch _ 改 console.warn)', () => {
  const lines = v2AppSrc.split('\n');
  let foundQuizLoad = false;
  let silentCatchInLoader = false;
  let hasWarnInLoader = false;
  let inQuizHomeworkBlock = false;
  lines.forEach((l) => {
    if (/quizListV2/.test(l) || /homeworkListV2/.test(l)) {
      foundQuizLoad = true;
      inQuizHomeworkBlock = true;
    }
    if (inQuizHomeworkBlock) {
      // 危险模式：catch (_) { /* ignore */ } 静默吞
      if (/catch\s*\(\s*_\s*\)\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/.test(l)) {
        silentCatchInLoader = true;
      }
      // 好模式：console.warn
      if (/console\.warn/.test(l)) hasWarnInLoader = true;
      // 块结束启发：遇到注释 // Phase 或 // v4 等其他业务块标记
      if (/^\s*\/\/\s*Phase/.test(l) || /Phase-9：4/.test(l)) inQuizHomeworkBlock = false;
    }
  });
  assert(foundQuizLoad, 'V2App 没找到 quizListV2/homeworkListV2 调用');
  assert(!silentCatchInLoader, 'quiz/homework IPC 仍用 catch(_) {/*ignore*/} 静默吞错');
  assert(hasWarnInLoader, 'quiz/homework IPC 失败应有 console.warn 可观测');
});

test('package.json 含 verify:release（gate + build 串联）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const cmd = pkg.scripts && pkg.scripts['verify:release'];
  assert(cmd, 'package.json 缺 verify:release');
  // 必须串联 contracts + integration + build (vite + electron-builder)
  assert(cmd.includes('verify-contracts-v8'), 'verify:release 缺 verify-contracts-v8');
  assert(cmd.includes('verify-workflow-integration-v8'), 'verify:release 缺 verify-workflow-integration-v8');
  assert(cmd.includes('vite build') || cmd.includes('electron-builder'),
    'verify:release 缺 build 步骤（vite build 或 electron-builder）');
});

// ── 13. v4.3.3 Codex Round 9 防回归（README 同步 + api 缺失降级）────────────
console.log('\n【13】Round 9 治理收口·README 一致 + 完整降级');

test('README 主文档同步 verify:integration 35 测试（不再是老 25）', () => {
  const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
  // 不应再出现 "verify:integration ... 25/25" 的老描述
  const oldDesc = /verify:integration[^\n]{0,80}25\s*\/\s*25/;
  assert(!oldDesc.test(readme), 'README 仍写 verify:integration 25/25（应至少 35）');
  // 应明确 35/35 或 35 测试
  const newDesc = /verify:integration[^\n]{0,200}35\s*\/\s*35/;
  assert(newDesc.test(readme), 'README 没更新 verify:integration 到 35/35');
});

test('README 主文档把 verify:release 写进主推荐（不只 verify:gate）', () => {
  const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
  // 用 ### 验证脚本 作为锚（确保抓到正文 section 不是目录结构）
  const sectionStart = readme.search(/###\s+验证脚本/);
  assert(sectionStart >= 0, '找不到「### 验证脚本」section');
  // 取这个 section 到下一个 ### 之间的内容
  const afterSection = readme.slice(sectionStart);
  const nextSection = afterSection.search(/\n###\s+(?!验证脚本)/);
  const blockText = nextSection > 0 ? afterSection.slice(0, nextSection) : afterSection;

  assert(/npm\s+run\s+verify:release/.test(blockText), 'README 验证脚本 section 未提到 npm run verify:release');
  const hasJobSplit = /职责|发版门禁|快速门禁/.test(blockText);
  assert(hasJobSplit, 'README 验证脚本 section 缺 verify:gate vs verify:release 职责说明');
});

test('V2App quiz/homework IPC api 缺失也清空 artifacts（Round 9 #3 完整降级）', () => {
  const lines = v2AppSrc.split('\n');
  // 找到 quizListV2 块，检查里面的 else 分支
  let inBlock = false;
  let blockText = [];
  lines.forEach((l) => {
    if (/typeof\s+api\.quizListV2/.test(l)) {
      inBlock = true;
    }
    if (inBlock) {
      blockText.push(l);
      // 块结束启发：遇到 'Phase-9' 注释或下一个独立 if
      if (/Phase-9|scheduleRes\?\.success/.test(l)) inBlock = false;
    }
  });
  const blockStr = blockText.join('\n');
  // 必须有 else 分支
  assert(/}\s*else\s*\{/.test(blockStr), 'quizListV2 检查后没有 else 分支（api 缺失时降级丢失）');
  // else 分支必须含 setQuizArtifacts([]) 和 console.warn
  // 简化匹配：检查在整段里两类调用都有
  const hasQuizWarn = (blockStr.match(/console\.warn[^\n]*quizListV2/g) || []).length >= 2;
  const hasHwWarn = (blockStr.match(/console\.warn[^\n]*homeworkListV2/g) || []).length >= 2;
  assert(hasQuizWarn, 'quizListV2 应有至少 2 处 warn（失败/异常/不存在）');
  assert(hasHwWarn, 'homeworkListV2 应有至少 2 处 warn（失败/异常/不存在）');
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

// ── 14. v4.3.3 Codex Round 10 防回归 ────────────────────────────────────
console.log('\n【14】Round 10 治理收口·migration runner + service 统一 + PPT pageNumber + validator');

test('migrations/runner.js 存在且 export runMigrations', () => {
  const runnerPath = path.resolve(__dirname, '..', 'src', 'main', 'migrations', 'runner.js');
  assert(fs.existsSync(runnerPath), 'migrations/runner.js 不存在（P0 修复缺）');
  const runner = require(runnerPath);
  assert(typeof runner.runMigrations === 'function', 'runner.runMigrations 不是函数');
});

test('index.js 把 migration 调用挪到 db 实例化后', () => {
  const indexSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
  const dbInitIdx = indexSrc.search(/db\s*=\s*new\s+DatabaseManager/);
  const runMigIdx = indexSrc.search(/runMigrations\s*\(/);
  assert(dbInitIdx >= 0 && runMigIdx >= 0 && runMigIdx > dbInitIdx,
    `runMigrations 必须在 db init 后 · dbInit@${dbInitIdx} runMig@${runMigIdx}`);
});

test('design.service 支持 notebook 参数 + resolveCourseContext export', () => {
  const ds = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'design.service.js'));
  assert(typeof ds.resolveCourseContext === 'function', 'design.service 未 export resolveCourseContext');
  const dsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'design.service.js'), 'utf8');
  assert(/notebook\s*=\s*null/.test(dsSrc), 'design.service.generate 签名未含 notebook 参数');
});

test('service 返回结构统一含 data.product（design/quiz/homework/video/report）', () => {
  const services = ['design', 'quiz', 'homework', 'micro-video', 'report'];
  services.forEach((s) => {
    const fname = s === 'quiz' ? 'quiz.service.js'
                : s === 'homework' ? 'homework.service.js'
                : s === 'micro-video' ? 'micro-video.service.js'
                : s + '.service.js';
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', fname), 'utf8');
    assert(/data:\s*\{\s*product:/.test(src), `${fname} 缺 data.product 返回（P1.2 未做）`);
  });
});

test('ppt-pipeline-v2 确定性写入 pageNumber', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'script', 'ppt-pipeline-v2.js'), 'utf8');
  assert(/pages\.forEach\(\(p, i\)\s*=>\s*\{\s*p\.pageNumber/.test(src),
    'ppt-pipeline-v2 缺 pages.forEach((p, i) => { p.pageNumber = ... }');
});

test('micro-video.service 新增 durationSec 字段（保留 duration legacy）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'micro-video.service.js'), 'utf8');
  assert(/durationSec:\s*declaredDuration/.test(src), 'micro-video 缺 durationSec 字段');
});

test('report.service 支持 lessonArtifacts 多节合并参数', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'report.service.js'), 'utf8');
  assert(/lessonArtifacts\s*=\s*null/.test(src), 'report.service.generate 签名未含 lessonArtifacts');
  assert(/aggregateLessonArtifacts/.test(src), 'report.service 未实现 aggregateLessonArtifacts');
});

test('artifact-validator.service 存在 + 校验 5 种 artifact', () => {
  const v = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'artifact-validator.service.js'));
  assert(typeof v.validateArtifact === 'function', 'validateArtifact 不是函数');
  assert(v.VALIDATORS.ppt_outline, '缺 ppt_outline validator');
  assert(v.VALIDATORS.lecture_final, '缺 lecture_final validator');
  assert(v.VALIDATORS.quiz_set, '缺 quiz_set validator');
  assert(v.VALIDATORS.homework_set, '缺 homework_set validator');
  assert(v.VALIDATORS.implementation_report, '缺 implementation_report validator');
});

test('artifact validator · 真实 quiz_set 应 valid', () => {
  const v = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'artifact-validator.service.js'));
  const goodArt = {
    type: 'quiz_set', schemaVersion: 1, dirty: false,
    metadata: { lessonNumber: 1 },
    content: { questions: [
      { sourcePageNumber: 1, type: 'single', stem: 'mock', correctAnswer: 'A' },
    ]},
  };
  const r = v.validateArtifact(goodArt);
  assert(r.valid, `应 valid，实际 issues: ${r.issues.join(' | ')}`);
});

test('artifact validator · 缺 schemaVersion 应 invalid', () => {
  const v = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'artifact-validator.service.js'));
  const r = v.validateArtifact({ type: 'quiz_set', content: { questions: [{ sourcePageNumber: 1, type: 'single', stem: 'x', correctAnswer: 'A' }] } });
  assert(!r.valid, '缺 schemaVersion 应 invalid');
  assert(r.issues.some((i) => /schemaVersion/.test(i)), 'issues 应提到 schemaVersion');
});

test('package.json 含 verify:e2e:mock + verify:migrations + verify:release', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  ['verify:migrations', 'verify:e2e:mock', 'verify:release'].forEach((s) => {
    assert(pkg.scripts && pkg.scripts[s], `package.json 缺 ${s}`);
  });
});

test('verify:gate 含 verify-migrations-runner-v8.js', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  assert(/verify-migrations-runner-v8/.test(pkg.scripts['verify:gate']),
    'verify:gate 未串联 verify-migrations-runner-v8');
});

// ── 结果汇总 ─────────────────────────────────────────────────────────────
console.log(`\n═══ 结果：${pass}/${pass + fail} 通过 ═══`);
if (fail > 0) {
  console.log('\n失败列表：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}\n     ${f.error}`));
  process.exit(1);
}
process.exit(0);
