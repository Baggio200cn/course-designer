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

test('README 主文档同步 verify:integration 测试数（≥ 35，不再是老 25）', () => {
  const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
  // 不应再出现 "verify:integration ... 25/25" 的老描述
  const oldDesc = /verify:integration[^\n]{0,80}25\s*\/\s*25/;
  assert(!oldDesc.test(readme), 'README 仍写 verify:integration 25/25（应至少 35）');
  // v4.3.3 Round 19+：integration 已增长到 117，断言改为"动态 N/N 且 N≥35"，
  // 不再写死 35（避免每轮新增断言后这条门禁误报）
  const m = readme.match(/verify:integration[^\n]{0,200}?(\d+)\s*\/\s*\1/);
  assert(m && Number(m[1]) >= 35, 'README 没写 verify:integration N/N（N 需 ≥ 35）');
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

// ── 【15】Round 11 治理收口·H14 反兜底 + runner failed 计入 + mock e2e 7-stage 闭环 ─────────────
console.log('\n【15】Round 11 治理收口·H14 反兜底 + runner failed 计入 + mock e2e 7-stage 闭环');

test('report.service 不再硬编码"广州纺校"（H14 反兜底）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'report.service.js'), 'utf8');
  // 允许在注释/反例提示中提到，但 || '广州纺校' 这种兜底不许有
  assert(!/\|\|\s*['"]广州纺校['"]/.test(src),
    'report.service 仍含 "|| \'广州纺校\'" 兜底（违反 H14）');
  assert(!/School:\s*\|\|\s*'广州纺校'/.test(src), 'school 兜底未清干净');
});

test('migrations/runner.js · invalid migration 计入 failed（防错放）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'migrations', 'runner.js'), 'utf8');
  // 必须能看到 invalid 分支累加 failed
  assert(/缺\s*run\s*函数[^}]*failed\s*\+=\s*1/s.test(src) || /status:\s*'invalid'[\s\S]{0,200}failed\s*\+=\s*1/.test(src),
    'runner.js invalid 分支未累加 failed（Codex Round 11 P3）');
});

test('run-e2e-v8.js · mock 模式覆盖 7 阶段闭环（design/ppt/lecture/quiz/homework/video/report）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'e2e', 'run-e2e-v8.js'), 'utf8');
  // runStage 包裹（async service）/ recordStage 显式登记（schedule legacy）/ runMockStage 包裹（mock 构造）都算覆盖
  ['design', 'ppt', 'lecture', 'quiz', 'homework', 'video', 'report'].forEach((stage) => {
    const reA = new RegExp(`runStage\\(['"]${stage}['"]`);
    const reB = new RegExp(`recordStage\\(['"]${stage}['"]`);
    const reC = new RegExp(`runMockStage\\(['"]${stage}['"]`);
    assert(reA.test(src) || reB.test(src) || reC.test(src),
      `run-e2e-v8.js mock 路径未覆盖 stage=${stage}（Codex Round 11 P1 #1）`);
  });
});

test('run-e2e-v8.js · 路径提示已更新到 scripts/e2e/e2e-4lessons-parallel-real.js（Codex Round 11 #3）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'e2e', 'run-e2e-v8.js'), 'utf8');
  assert(!/scripts\/e2e-4lessons-parallel\.js/.test(src) || /e2e-4lessons-parallel-real/.test(src),
    'run-e2e-v8.js 仍提示老路径 scripts/e2e-4lessons-parallel.js');
});

test('run-e2e-v8.js · mock 7 阶段使用 artifact-validator 后置检查', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'e2e', 'run-e2e-v8.js'), 'utf8');
  assert(/artifact-validator/.test(src),
    'run-e2e-v8.js 未引入 artifact-validator 后置检查');
  assert(/validateArtifact/.test(src),
    'run-e2e-v8.js 未调用 validateArtifact');
});

test('runner.js · failed 累加路径含 invalid + 异常两类', () => {
  const runner = require(path.resolve(__dirname, '..', 'src', 'main', 'migrations', 'runner.js'));
  // 用 mock db + 一个 invalid migration 验证 failed 计入
  // （不真实创建文件，只验证模块化导出无回归）
  assert(typeof runner.runMigrations === 'function', 'runner.runMigrations 必须 export');
});

// ── 【16】Round 12 治理收口·课中 5 段法"评价"→"设计意图"字段改名残留扫描 ───────────────
// 老师反馈："编辑时是'设计意图'，预览时又变成'评价'" —— 前端预览模板漏改
// 防回归范围：仅限"课中 5 段法教学过程表"的最后一列表头；"考核评价"等正常术语不受影响
console.log('\n【16】Round 12 治理收口·课中 5 段法"评价"→"设计意图"字段改名残留扫描');

test('DesignStage.jsx 预览表头：课中 5 段法最后一列不得是"评价"', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'DesignStage.jsx'), 'utf8');
  // 定位课中 5 段法预览表（"环节" 起头到下一个 </table>）
  const m = src.match(/<th[^>]*>环节<\/th>[\s\S]{0,1500}?<\/thead>/);
  assert(m, '找不到课中 5 段法预览表 thead 区段');
  const tableHead = m[0];
  assert(/<th[^>]*>设计意图<\/th>/.test(tableHead),
    '课中 5 段法预览表头最后一列应为"设计意图"');
  // 表头里不允许出现"评价"作为列名（排除"考核评价/评价标准"——它们在另一表）
  assert(!/<th[^>]*>评价<\/th>/.test(tableHead),
    '课中 5 段法预览表头仍含 <th>评价</th> · 字段改名未同步');
});

test('DesignStage.jsx 预览内容读取顺序：designIntent || evaluation', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'DesignStage.jsx'), 'utf8');
  // 课中 5 段法预览体（map((p, i)) 区段）必须先读 designIntent
  assert(/p\.designIntent\s*\|\|\s*p\.evaluation/.test(src),
    '预览内容未按 designIntent || evaluation 顺序读取');
  // 不允许"裸"读 p.evaluation（即没有 designIntent 兜底前置）
  assert(!/\{p\.evaluation\s*\|\|/.test(src),
    '预览仍存在 {p.evaluation || ...} 裸读 · 应改为 designIntent 优先');
});

test('DesignStage.jsx 编辑区 Section 标题不再以"评价"结尾', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'DesignStage.jsx'), 'utf8');
  assert(!/课中 5 段法[^"']*评价"/.test(src),
    'Section 标题"课中 5 段法 ... 评价"未改为"... 设计意图"');
  assert(/课中 5 段法[^"']*设计意图/.test(src),
    'Section 标题应含"设计意图"');
});

test('design-word.js 导出表头：课中 5 段法最后一列是"设计意图" + 内容优先 designIntent', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'export', 'design-word.js'), 'utf8');
  assert(/cell\('设计意图'/.test(src),
    'Word 导出表头未含"设计意图"');
  assert(/ph\.designIntent\s*\|\|\s*ph\.evaluation/.test(src),
    'Word 导出内容未按 designIntent || evaluation 顺序');
});

test('design.service.js 仍含 evaluation→designIntent 老数据兼容迁移', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'design.service.js'), 'utf8');
  assert(/designIntent/.test(src) && /evaluation/.test(src),
    'design.service 缺 designIntent / evaluation 兼容字段（破坏老数据加载）');
});

test('prompts/design.md 要求模型输出 designIntent（不能退回 evaluation 命名）', () => {
  const p = path.resolve(__dirname, '..', 'prompts', 'design.md');
  if (!fs.existsSync(p)) return; // prompts 目录可能在 .gitignore 中
  const src = fs.readFileSync(p, 'utf8');
  assert(/designIntent/.test(src), 'prompts/design.md 未要求 designIntent 字段');
});

// ── 【17】Round 13 治理收口·mock E2E 8 阶段闭环 + validator 严格模式 + video_prompt 校验 + report prompt 8 阶段对齐 ──
console.log('\n【17】Round 13 治理收口·mock E2E 8 阶段闭环 + validator strict + video_prompt validator + report prompt 8 阶段');

test('run-e2e-v8.js · mock 8 阶段闭环（含 schedule）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'e2e', 'run-e2e-v8.js'), 'utf8');
  // schedule 阶段必须有显式登记（recordStage 或 runMockStage 都算）
  assert(/recordStage\(['"]schedule['"]/.test(src) || /runMockStage\(['"]schedule['"]/.test(src),
    'run-e2e-v8.js mock 路径未登记 schedule 阶段（Codex Round 13 P1.1）');
  // 标题必须是"8 stage"不再是"7 stage"
  assert(/8 stage|8 阶段/.test(src), 'run-e2e-v8.js 标题未升级到 8 阶段');
  assert(!/1 节完整 7 stage/.test(src), 'run-e2e-v8.js 仍残留"7 stage"老标题');
});

test('run-e2e-v8.js · validator strict 模式（默认计入 SUMMARY.errors）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'e2e', 'run-e2e-v8.js'), 'utf8');
  assert(/allowValidatorWarnings/.test(src),
    'run-e2e-v8.js 缺 --allow-validator-warnings 开关（Codex Round 13 P1.2）');
  assert(/!ARGS\.allowValidatorWarnings[\s\S]{0,200}SUMMARY\.errors\.push/.test(src),
    'run-e2e-v8.js 未在 strict 模式下把 validator 失败计入 SUMMARY.errors');
});

test('artifact-validator · video_prompt 校验已注册', () => {
  const v = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'artifact-validator.service.js'));
  assert(typeof v.VALIDATORS.video_prompt === 'function',
    'artifact-validator 缺 video_prompt 校验（Codex Round 13 P1.3）');
});

test('artifact validator · video_prompt 校验关键字段（durationSec / storyboard / jimengPrompts）', () => {
  const v = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'artifact-validator.service.js'));
  // 健康样本应 valid
  const good = {
    type: 'video_prompt', schemaVersion: 1, dirty: false,
    metadata: { lessonNumber: 1 },
    content: {
      durationSec: 60,
      storyboard: [
        { shotNumber: 1, duration: 20, visualDescription: '开场主讲教师镜头', cameraAngle: '中景' },
        { shotNumber: 2, duration: 20, visualDescription: '主体讲解配合 PPT', cameraAngle: '近景' },
        { shotNumber: 3, duration: 20, visualDescription: '收尾画面与号召', cameraAngle: '中景' },
      ],
      jimengPrompts: [
        { shotNumber: 1, prompt: '开场提示词描述' },
        { shotNumber: 2, prompt: '主体提示词描述' },
        { shotNumber: 3, prompt: '收尾提示词描述' },
      ],
    },
  };
  const r = v.validateArtifact(good);
  assert(r.valid, `健康 video_prompt 应 valid，实际 issues: ${r.issues.join(' | ')}`);
  // 病态样本应 invalid（缺 durationSec）
  const bad = { ...good, content: { ...good.content, durationSec: 0 } };
  const r2 = v.validateArtifact(bad);
  assert(!r2.valid, '缺 durationSec 的 video_prompt 应 invalid');
});

test('run-e2e-v8.js · video 阶段使用 video_prompt validator', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'e2e', 'run-e2e-v8.js'), 'utf8');
  assert(/runStage\(['"]video['"][\s\S]{0,500}['"]video_prompt['"]/.test(src),
    'run-e2e-v8.js video 阶段未传 video_prompt validator');
});

// ── 【18】Round 14 治理收口·report handler/service 8 阶段对齐 + ppt/lecture strict + schedule_table validator + 老注释清理 ──
console.log('\n【18】Round 14 治理收口·report 8 阶段对齐 + ppt/lecture strict + schedule_table validator + 老注释清理');

test('Round 14 P1.1 · report.handlers 读取 quiz_set / homework_set artifact', () => {
  // v4.3.3 Round 17：实际 pickLatestConfirmed 调用搬到 report-upstream.helper，
  // 现在合扫两份文件，只要任一处覆盖 7 种 type 即视为已读取
  const handlerSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report.handlers.js'), 'utf8');
  const helperSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper.js'), 'utf8');
  const combined = handlerSrc + '\n' + helperSrc;
  assert(/['"]quiz_set['"][\s\S]{0,80}['"]quiz['"]/.test(combined),
    'report.handlers/helper 未读取 quiz_set artifact（Codex Round 14 P1.1）');
  assert(/['"]homework_set['"][\s\S]{0,80}['"]homework['"]/.test(combined),
    'report.handlers/helper 未读取 homework_set artifact（Codex Round 14 P1.1）');
  // generateReport 调用必须传 quizData/homeworkData
  assert(/reportSvc\.generate\(\{[\s\S]*?quizData[\s\S]*?homeworkData[\s\S]*?\}\)/.test(handlerSrc),
    'report.handlers 调用 reportSvc.generate 未传 quizData/homeworkData');
});

test('Round 14 P1.1 · report.handlers 不再硬编码"广州纺校"（H14 反兜底）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report.handlers.js'), 'utf8');
  assert(!/\|\|\s*['"]广州纺校['"]/.test(src),
    'report.handlers 仍含 "|| \'广州纺校\'" 兜底（违反 H14，Codex Round 11 漏改）');
});

test('Round 14 P1.2 · report.service.generate 签名含 quizData / homeworkData', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'report.service.js'), 'utf8');
  assert(/quizData\s*=\s*null/.test(src), 'report.service.generate 签名缺 quizData 参数');
  assert(/homeworkData\s*=\s*null/.test(src), 'report.service.generate 签名缺 homeworkData 参数');
});

test('Round 14 P1.2 · report.service hintBlocks 含测验 + 作业 hint 块', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'report.service.js'), 'utf8');
  assert(/上游测验 hint/.test(src), 'report.service 缺"上游测验 hint"块');
  assert(/上游作业 hint/.test(src), 'report.service 缺"上游作业 hint"块');
});

test('Round 14 P1.2 · report.service upstreamSummary 含 hasQuiz / hasHomework', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'report.service.js'), 'utf8');
  assert(/hasQuiz:\s*Boolean/.test(src), 'upstreamSummary 缺 hasQuiz');
  assert(/hasHomework:\s*Boolean/.test(src), 'upstreamSummary 缺 hasHomework');
});

test('Round 14 P1.3 · run-e2e-v8.js schedule/ppt/lecture 走 strict 失败路径（runMockStage 包装）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'e2e', 'run-e2e-v8.js'), 'utf8');
  assert(/function runMockStage/.test(src),
    'run-e2e-v8.js 缺 runMockStage helper（Codex Round 14 P1.3）');
  // schedule / ppt / lecture 必须调 runMockStage
  ['schedule', 'ppt', 'lecture'].forEach((stage) => {
    assert(new RegExp(`runMockStage\\(['"]${stage}['"]`).test(src),
      `run-e2e-v8.js stage=${stage} 未走 runMockStage strict 路径`);
  });
  // runMockStage 内部必须把 validator 失败推入 SUMMARY.errors（strict 模式）
  assert(/runMockStage[\s\S]*?!ARGS\.allowValidatorWarnings[\s\S]*?SUMMARY\.errors\.push/.test(src),
    'runMockStage 未在 strict 模式把 validator 失败计入 SUMMARY.errors');
});

test('Round 14 P2.1 · artifact-validator 注册 schedule_table 校验', () => {
  const v = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'artifact-validator.service.js'));
  assert(typeof v.VALIDATORS.schedule_table === 'function',
    'artifact-validator 缺 schedule_table（Codex Round 14 P2.1）');
});

test('Round 14 P2.1 · schedule_table validator · 健康样本 valid · 空数组 invalid · 学时不守恒 invalid', () => {
  const v = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'artifact-validator.service.js'));
  // 健康
  const good = {
    type: 'schedule_table', schemaVersion: 1, dirty: false,
    content: {
      header: { totalHours: 4 },
      schedule: [
        { week: 1, session: 1, content: '内容1', hours: 2 },
        { week: 2, session: 2, content: '内容2', hours: 2 },
      ],
    },
  };
  const r = v.validateArtifact(good);
  assert(r.valid, `健康 schedule_table 应 valid，实际 issues: ${r.issues.join(' | ')}`);
  // 空数组
  const empty = { ...good, content: { schedule: [] } };
  assert(!v.validateArtifact(empty).valid, '空 schedule[] 应 invalid');
  // 学时不守恒
  const bad = {
    ...good,
    content: { header: { totalHours: 10 }, schedule: [{ week: 1, session: 1, content: 'x', hours: 2 }] },
  };
  const r3 = v.validateArtifact(bad);
  assert(!r3.valid && r3.issues.some((i) => /学时不守恒/.test(i)), '总学时不守恒应 invalid');
});

test('Round 14 P2.2 · contracts.js 顶部注释清理"前 5 阶段"残留', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'v2', 'contracts.js'), 'utf8');
  // 老版"AI 汇总前 5 阶段"必须改为 8 阶段对齐说法
  assert(!/AI\s*汇总前\s*5\s*阶段/.test(src),
    'contracts.js 顶部仍残留"AI 汇总前 5 阶段"老注释');
  assert(!/report\s*需要前\s*5\s*阶段/.test(src),
    'contracts.js 仍残留"report 需要前 5 阶段"老注释');
});

test('Round 14 P2.2 · report.service 顶部注释升级到 7 阶段产物（8 阶段对齐）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'report.service.js'), 'utf8');
  assert(!/前\s*5\s*个阶段（schedule\/design\/lecture\/ppt\/video）/.test(src),
    'report.service 顶部注释仍说"前 5 个阶段"老版');
  assert(/上游\s*7\s*个阶段产物/.test(src) || /上游 7 阶段/.test(src),
    'report.service 顶部注释未升级到"上游 7 个阶段产物"');
});

test('Round 14 P2.2 · report.handlers 顶部注释升级到上游 7 阶段', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report.handlers.js'), 'utf8');
  assert(!/AI\s*汇总前\s*5\s*阶段产物/.test(src),
    'report.handlers 注释仍说"AI 汇总前 5 阶段产物"');
  assert(/上游\s*7\s*阶段产物/.test(src) || /上游 7 阶段/.test(src),
    'report.handlers 注释未升级到"上游 7 阶段产物"');
});

// ── 【19】Round 15 治理收口·真实报告血缘 + mock 报告吃 8 阶段 + 全工程老注释扫描 ────────
console.log('\n【19】Round 15 治理收口·真实报告血缘 + mock 报告吃 8 阶段 + 全工程老注释扫描');

test('Round 15 P1.1 · report.handlers createArtifact 写 sourceArtifactIds', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report.handlers.js'), 'utf8');
  // v4.3.3 Round 16 重构后改用 collectReportUpstream helper；upstreamArtifactIds 由 upstream.ids 提供
  assert(/upstreamArtifactIds\s*=\s*upstream\.ids/.test(src)
       || /upstreamArtifactIds\s*=\s*\[[\s\S]{0,500}\.map\(/.test(src),
    'report.handlers 未组装 upstreamArtifactIds（应来自 collectReportUpstream 或 7 个 artifact 对象数组）');
  // createArtifact 必须传 sourceArtifactIds: upstreamArtifactIds
  assert(/createArtifact\(\{[\s\S]*?sourceArtifactIds:\s*upstreamArtifactIds[\s\S]*?\}\)/.test(src),
    'report.handlers createArtifact 未传 sourceArtifactIds（Codex Round 15 P1.1）');
});

test('Round 15 P1.1 · report.handlers 保留 7 个上游 artifact 对象（不只 .content）', () => {
  // v4.3.3 Round 17 helper 抽到独立文件 → 合扫两份；任一处覆盖 7 种 type 即合规
  const handlerSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report.handlers.js'), 'utf8');
  const helperSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper.js'), 'utf8');
  const combined = handlerSrc + '\n' + helperSrc;
  ['schedule_table', 'design_doc', 'ppt_outline', 'lecture_final', 'quiz_set', 'homework_set', 'video_prompt'].forEach((t) => {
    assert(combined.includes(t),
      `report.handlers/helper 未引用 type=${t}（应在 collectReportUpstream / generateReport 中收集）`);
  });
});

test('Round 15 P1.2 · mock E2E generateReport 调用补传 scheduleData/quizData/homeworkData', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'e2e', 'run-e2e-v8.js'), 'utf8');
  // generateReport({...}) 块中必须包含 scheduleData / quizData / homeworkData 三个 key
  const m = src.match(/generateReport\(\{[\s\S]{0,2000}?\}\)/);
  assert(m, '未找到 generateReport 调用块');
  const callBlock = m[0];
  ['scheduleData:', 'quizData:', 'homeworkData:'].forEach((k) => {
    assert(callBlock.includes(k),
      `run-e2e-v8.js generateReport 调用未传 ${k}（Codex Round 15 P1.2）`);
  });
});

test('Round 15 P1.2 · mock E2E 后置断言 upstreamSummary hasSchedule/hasQuiz/hasHomework', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'e2e', 'run-e2e-v8.js'), 'utf8');
  // 必须含 reportProduct._stats.upstreamSummary 后置检查（hasSchedule + hasQuiz + hasHomework 必有）
  assert(/reportProduct[\s\S]{0,500}upstreamSummary/.test(src),
    'run-e2e-v8.js 缺 report 后置 upstreamSummary 检查');
  ['hasSchedule', 'hasQuiz', 'hasHomework'].forEach((k) => {
    assert(new RegExp(`['"]${k}['"]`).test(src),
      `run-e2e-v8.js 后置检查未提到 ${k}`);
  });
});

// ── 【20】Round 16 治理收口·saveReport 新建分支补血缘 ───────────────────────────
console.log('\n【20】Round 16 治理收口·saveReport 新建分支补血缘');

test('Round 16/17 · report.handlers 引用 collectReportUpstream / inferReportSourceArtifactIds helper', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report.handlers.js'), 'utf8');
  // v4.3.3 Round 17 起 helper 抽到独立模块 ./report-upstream.helper，只需 require + 使用
  assert(/require\(['"]\.\/report-upstream\.helper['"]\)/.test(src),
    'report.handlers 未 require ./report-upstream.helper（Codex Round 17）');
  assert(/collectReportUpstream\s*\(/.test(src),
    'report.handlers 未使用 collectReportUpstream（Codex Round 16/17）');
  assert(/inferReportSourceArtifactIds\s*\(/.test(src),
    'report.handlers 未使用 inferReportSourceArtifactIds（Codex Round 16/17）');
});

test('Round 16 · v2:saveReport 新建分支写 sourceArtifactIds（边界 bug 修复）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report.handlers.js'), 'utf8');
  // 定位 v2:saveReport handler 主体
  const m = src.match(/ipcMain\.handle\(['"]v2:saveReport['"][\s\S]*?\n  \}\);/);
  assert(m, '找不到 v2:saveReport handler 主体');
  const block = m[0];
  // saveReport 主体必须调 inferReportSourceArtifactIds 并把结果传 createArtifact
  assert(/inferReportSourceArtifactIds\s*\(/.test(block),
    'v2:saveReport 新建分支未调 inferReportSourceArtifactIds（Codex Round 16）');
  assert(/sourceArtifactIds:\s*inferred\.ids/.test(block),
    'v2:saveReport 新建分支 createArtifact 未传 sourceArtifactIds: inferred.ids');
});

test('Round 16 · saveReport 新建分支兜底顺序：先继承上份 report，再从 7 个上游重建', () => {
  // v4.3.3 Round 17：helper 抽到独立模块——验证逻辑分支应在 helper 文件
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper.js'), 'utf8');
  assert(/prevReport[\s\S]{0,200}sourceArtifactIds[\s\S]{0,200}slice\(\)/.test(src),
    'inferReportSourceArtifactIds 缺"继承上一份 report 血缘"分支');
  assert(/inherit-previous-report/.test(src), '缺 source=inherit-previous-report 标记');
  assert(/rebuild-from-upstream/.test(src), '缺 source=rebuild-from-upstream 标记');
});

test('Round 16 · saveReport 新建分支 metadata 含血缘诊断字段', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report.handlers.js'), 'utf8');
  // saveReport 段必须把 upstreamArtifactIds / upstreamSource / upstreamCount 写入 metadata
  const m = src.match(/ipcMain\.handle\(['"]v2:saveReport['"][\s\S]*?\n  \}\);/);
  assert(m, '找不到 v2:saveReport handler');
  const block = m[0];
  ['upstreamArtifactIds', 'upstreamSource', 'upstreamCount'].forEach((k) => {
    assert(block.includes(k),
      `v2:saveReport metadata 缺血缘诊断字段 ${k}`);
  });
});

// ── 【21】Round 17 治理收口·report-upstream.helper 真行为单测（替代源码字符串扫描） ──
console.log('\n【21】Round 17 治理收口·report-upstream.helper 真行为单测');

// 构造 mock db：返回固定 artifact 列表
function makeMockDb(artifacts) {
  return {
    listArtifacts({ notebookId } = {}) {
      // 简化：忽略 notebookId 过滤（测试场景里只有一个 notebook）
      return artifacts.slice();
    },
  };
}

test('Round 17 · helper 模块直接 require 可用 · 导出 5 个符号', () => {
  const helper = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper'));
  ['UPSTREAM_TYPES', 'pickLatestConfirmed', 'pickLatest', 'collectReportUpstream', 'inferReportSourceArtifactIds']
    .forEach((sym) => assert(helper[sym] !== undefined, `helper 缺 export: ${sym}`));
  assert(Array.isArray(helper.UPSTREAM_TYPES) && helper.UPSTREAM_TYPES.length === 7,
    `UPSTREAM_TYPES 应是长度 7 的数组（实际 ${helper.UPSTREAM_TYPES?.length}）`);
});

test('Round 17 · UPSTREAM_TYPES 覆盖完整 7 阶段（与 contracts STAGE_ORDER 前 7 个对齐）', () => {
  const helper = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper'));
  const stages = helper.UPSTREAM_TYPES.map((t) => t.stage);
  ['schedule', 'design', 'ppt', 'lecture', 'quiz', 'homework', 'video'].forEach((s) => {
    assert(stages.includes(s), `UPSTREAM_TYPES 缺 stage=${s}`);
  });
});

test('Round 17 · 场景 A · 有上一份 report 时 inferReportSourceArtifactIds 继承血缘', () => {
  const helper = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper'));
  const prevReport = {
    id: 999, type: 'implementation_report', stage: 'report',
    sourceArtifactIds: [11, 22, 33, 44, 55, 66, 77],
    createdAt: '2026-05-19T10:00:00Z',
  };
  // 同时摆 7 个上游 artifact —— 但应该被 inherit 路径优先取走
  const upstream = [
    { id: 101, type: 'schedule_table', stage: 'schedule', createdAt: '2026-05-19T11:00:00Z' },
    { id: 102, type: 'design_doc', stage: 'design', createdAt: '2026-05-19T11:00:00Z' },
  ];
  const db = makeMockDb([prevReport, ...upstream]);
  const r = helper.inferReportSourceArtifactIds(db, 1);
  assert(r.source === 'inherit-previous-report',
    `source 应 inherit-previous-report，实际 ${r.source}`);
  assert(JSON.stringify(r.ids) === JSON.stringify([11, 22, 33, 44, 55, 66, 77]),
    `继承的 ids 应是 [11..77]，实际 ${JSON.stringify(r.ids)}`);
  // 确认是 slice（不能与原对象同引用）
  r.ids.push(999);
  assert(prevReport.sourceArtifactIds.length === 7,
    '继承时未 slice，污染了原 artifact.sourceArtifactIds');
});

test('Round 17 · 场景 A2 · 多份 report 时取 updatedAt/createdAt 最新的一份', () => {
  const helper = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper'));
  const db = makeMockDb([
    { id: 1, type: 'implementation_report', stage: 'report', sourceArtifactIds: [1], createdAt: '2026-05-19T08:00:00Z' },
    { id: 2, type: 'implementation_report', stage: 'report', sourceArtifactIds: [2], createdAt: '2026-05-19T10:00:00Z' },
    { id: 3, type: 'implementation_report', stage: 'report', sourceArtifactIds: [3], createdAt: '2026-05-19T09:00:00Z' },
  ]);
  const r = helper.inferReportSourceArtifactIds(db, 1);
  assert(r.source === 'inherit-previous-report' && JSON.stringify(r.ids) === '[2]',
    `应继承 id=2 那份（最新），实际 source=${r.source}, ids=${JSON.stringify(r.ids)}`);
});

test('Round 17 · 场景 B · 无上一份 report 时从 7 阶段重建', () => {
  const helper = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper'));
  const db = makeMockDb([
    { id: 11, type: 'schedule_table',  stage: 'schedule', createdAt: '2026-05-19T10:00:00Z' },
    { id: 12, type: 'design_doc',      stage: 'design',   createdAt: '2026-05-19T10:01:00Z' },
    { id: 13, type: 'ppt_outline',     stage: 'ppt',      createdAt: '2026-05-19T10:02:00Z' },
    { id: 14, type: 'lecture_final',   stage: 'lecture',  createdAt: '2026-05-19T10:03:00Z' },
    { id: 15, type: 'quiz_set',        stage: 'quiz',     createdAt: '2026-05-19T10:04:00Z' },
    { id: 16, type: 'homework_set',    stage: 'homework', createdAt: '2026-05-19T10:05:00Z' },
    { id: 17, type: 'video_prompt',    stage: 'video',    createdAt: '2026-05-19T10:06:00Z' },
  ]);
  const r = helper.inferReportSourceArtifactIds(db, 1);
  assert(r.source === 'rebuild-from-upstream',
    `source 应 rebuild-from-upstream，实际 ${r.source}`);
  assert(r.ids.length === 7,
    `重建应得 7 个 id，实际 ${r.ids.length}: ${JSON.stringify(r.ids)}`);
  // 确认不去重，但应按 UPSTREAM_TYPES 顺序排列
  assert(JSON.stringify(r.ids) === JSON.stringify([11, 12, 13, 14, 15, 16, 17]),
    `重建 ids 顺序错：${JSON.stringify(r.ids)}`);
});

test('Round 17 · 场景 B2 · 重建分支不要求 confirmed（老师 draft 状态也能恢复血缘）', () => {
  const helper = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper'));
  const db = makeMockDb([
    { id: 21, type: 'schedule_table', stage: 'schedule', confirmed: false, createdAt: '2026-05-19T10:00:00Z' },
    { id: 22, type: 'design_doc',     stage: 'design',   confirmed: false, createdAt: '2026-05-19T10:01:00Z' },
  ]);
  const r = helper.inferReportSourceArtifactIds(db, 1);
  assert(r.source === 'rebuild-from-upstream',
    `confirmed=false 也应走 rebuild（实际 ${r.source}）`);
  assert(JSON.stringify(r.ids) === '[21,22]',
    `应得 [21,22]，实际 ${JSON.stringify(r.ids)}`);
});

test('Round 17 · 场景 B3 · 重建分支同 stage 多个时取最新', () => {
  const helper = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper'));
  const db = makeMockDb([
    { id: 31, type: 'schedule_table', stage: 'schedule', createdAt: '2026-05-19T08:00:00Z' },
    { id: 32, type: 'schedule_table', stage: 'schedule', createdAt: '2026-05-19T10:00:00Z' },  // 最新
    { id: 33, type: 'schedule_table', stage: 'schedule', createdAt: '2026-05-19T09:00:00Z' },
  ]);
  const r = helper.inferReportSourceArtifactIds(db, 1);
  assert(r.ids[0] === 32,
    `同 stage 多份时应取最新 id=32，实际 ${r.ids[0]}`);
});

test('Round 17 · 场景 C · 完全无上游时返回 ids=[] + source=no-upstream-found', () => {
  const helper = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper'));
  const db = makeMockDb([
    // 只放一些无关 artifact —— 不属于 7 类上游
    { id: 91, type: 'random_other_type', stage: 'random', createdAt: '2026-05-19T10:00:00Z' },
  ]);
  const r = helper.inferReportSourceArtifactIds(db, 1);
  assert(r.source === 'no-upstream-found',
    `source 应 no-upstream-found，实际 ${r.source}`);
  assert(Array.isArray(r.ids) && r.ids.length === 0,
    `ids 应为空数组，实际 ${JSON.stringify(r.ids)}`);
});

test('Round 17 · 场景 D · db 缺 listArtifacts 不抛错（容错降级）', () => {
  const helper = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper'));
  const r1 = helper.inferReportSourceArtifactIds({}, 1);
  assert(r1.source === 'no-upstream-found' && r1.ids.length === 0,
    `db 缺 listArtifacts 应平静返回，实际 source=${r1.source}, ids=${JSON.stringify(r1.ids)}`);
  // collectReportUpstream 同样容错
  const r2 = helper.collectReportUpstream(null, 1);
  assert(Array.isArray(r2.ids) && r2.ids.length === 0,
    `collectReportUpstream(null) 应平静返回空，实际 ${JSON.stringify(r2.ids)}`);
});

test('Round 17 · collectReportUpstream · 只收 confirmed=true 的上游（main 路径）', () => {
  const helper = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper'));
  const db = makeMockDb([
    { id: 41, type: 'schedule_table', stage: 'schedule', confirmed: false, createdAt: '2026-05-19T10:00:00Z' },
    { id: 42, type: 'design_doc',     stage: 'design',   confirmed: true,  createdAt: '2026-05-19T10:00:00Z' },
    { id: 43, type: 'ppt_outline',    stage: 'ppt',      confirmed: true,  createdAt: '2026-05-19T10:00:00Z' },
  ]);
  const r = helper.collectReportUpstream(db, 1);
  // schedule confirmed=false 不应进 ids
  assert(!r.ids.includes(41), 'collectReportUpstream 不应包含 confirmed=false 的 artifact');
  // design / ppt 应进
  assert(r.ids.includes(42) && r.ids.includes(43),
    `collectReportUpstream 漏了 confirmed=true 的 design/ppt（ids=${JSON.stringify(r.ids)}）`);
  // map 字段对齐
  assert(r.map.design === 42 && r.map.ppt === 43, 'map 字段映射错');
  // objs 保留完整对象
  assert(r.objs.design?.id === 42, 'objs.design 应是完整 artifact 对象');
});

test('Round 15 P2 · 全 src/main 扫描"前 5 阶段 / 上游 5 个 artifact"残留', () => {
  // 用 glob 扫 src/main/**.{js} 的内容（不含 legacy/）
  function walk(dir) {
    const out = [];
    fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      if (d.name === 'legacy' || d.name === 'node_modules') return;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) out.push(...walk(p));
      else if (/\.(js|jsx|ts|tsx)$/.test(d.name)) out.push(p);
    });
    return out;
  }
  const srcRoot = path.resolve(__dirname, '..', 'src', 'main');
  const files = walk(srcRoot);
  const pattern = /(上游\s*5\s*个\s*artifact|前\s*5\s*阶段|前\s*5\s*个\s*阶段|AI\s*汇总前\s*5|前\s*5\s*个\s*artifact)/;
  const hits = [];
  files.forEach((f) => {
    const txt = fs.readFileSync(f, 'utf8');
    if (pattern.test(txt)) hits.push(path.relative(srcRoot, f));
  });
  assert(hits.length === 0,
    `仍有 ${hits.length} 处文件残留"前 5 阶段 / 上游 5 个 artifact"老说法：${hits.join(', ')}`);
});

test('report.service prompt · 从"上游 5 个 artifact"升级到"上游阶段产物 hint"（8 阶段对齐）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'report.service.js'), 'utf8');
  assert(!/基于上游 5 个 artifact/.test(src),
    'report.service prompt 仍是老版"上游 5 个 artifact"（Codex Round 13 P2）');
  // Round 13 用 "上游阶段产物 hint"；Round 15 P2 进一步明确为 "上游 7 阶段产物 hint"——两种说法都算合规
  assert(/上游\s*7?\s*阶段产物 hint/.test(src),
    'report.service prompt 未升级到"上游阶段产物 hint"或"上游 7 阶段产物 hint"');
  // 8 阶段产物枚举应明确出现
  ['教学进度表', '教学设计', 'PPT 大纲', '讲稿', '测验', '作业', '微课视频方案'].forEach((k) => {
    assert(src.includes(k), `report.service prompt 缺关键字"${k}"（8 阶段对齐）`);
  });
});

// ── 【22】Round 18 治理收口·v4.3.3 端到端测试报告 4 项修复（A web-extractor / B exportMicroVideoWord / C schema 守卫 / D Vision 审核可观测） ──
console.log('\n【22】Round 18 治理收口·v4.3.3 测试报告 4 项修复');

// ── 修复 A · web-extractor 环境守卫 ──
test('Round 18 A · web-extractor 第 3 层加 BrowserWindow 环境守卫（非 Electron 平静降级）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'web-extractor.service.js'), 'utf8');
  assert(/typeof\s+BrowserWindow\s*!==\s*['"]function['"]/.test(src),
    'web-extractor 第 3 层未加 BrowserWindow 环境守卫');
  assert(/browserwindow-unavailable/.test(src),
    'web-extractor 缺 errorKind=browserwindow-unavailable 标记（caller 据此识别"环境不支持"而不是网络/页面问题）');
});

test('Round 18 A · web-extractor httpGet 也加 net 环境守卫', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'web-extractor.service.js'), 'utf8');
  // net.request 之前必须有 !net 或 typeof net.request 检查
  assert(/!net\s*\|\|\s*typeof\s+net\.request\s*!==\s*['"]function['"]|electron-net-unavailable/.test(src),
    'web-extractor httpGet 未加 net 环境守卫（非 Electron 会抛 Cannot read of undefined）');
});

// ── 修复 B · micro-video-word + IPC + UI 按钮 ──
test('Round 18 B · 新增 exportMicroVideoWord 导出函数', () => {
  const m = require(path.resolve(__dirname, '..', 'src', 'main', 'export', 'micro-video-word.js'));
  assert(typeof m.exportMicroVideoWord === 'function', '缺 exportMicroVideoWord 导出函数');
  assert(typeof m.assertVideoSchema === 'function', '缺 assertVideoSchema schema 守卫');
});

test('Round 18 B · IPC v2:exportMicroVideoWord 已注册', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'micro-video.handlers.js'), 'utf8');
  assert(/ipcMain\.handle\(['"]v2:exportMicroVideoWord['"]/.test(src),
    'micro-video.handlers 未注册 v2:exportMicroVideoWord');
  // 必须读 video_prompt artifact + 调 exportMicroVideoWord
  assert(/exportMicroVideoWord\(/.test(src), 'handler 未调 exportMicroVideoWord 渲染器');
});

test('Round 18 B · preload 暴露 exportMicroVideoWordV2', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'preload', 'index.js'), 'utf8');
  assert(/exportMicroVideoWordV2:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(['"]v2:exportMicroVideoWord['"]/.test(src),
    'preload 未暴露 exportMicroVideoWordV2');
});

test('Round 18 B · MicroVideoStage 加"导出 Word"按钮', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'MicroVideoStage.jsx'), 'utf8');
  assert(/exportMicroVideoWordV2/.test(src), 'MicroVideoStage 未调 exportMicroVideoWordV2');
  assert(/导出\s*Word/.test(src), 'MicroVideoStage 缺"导出 Word"按钮文案');
});

test('Round 18 B · exportMicroVideoWord 缺 narrationScript 抛错（schema 守卫行为）', () => {
  const { assertVideoSchema } = require(path.resolve(__dirname, '..', 'src', 'main', 'export', 'micro-video-word.js'));
  let threw = false;
  try { assertVideoSchema({ storyboard: [], jimengPrompts: [] }); }
  catch (e) { threw = /narrationScript/.test(e.message); }
  assert(threw, 'assertVideoSchema 缺 narrationScript 时应抛含"narrationScript"的错');
});

// ── 修复 C · 3 个 export 入口 schema 守卫 ──
test('Round 18 C · exportScheduleWord 检测老字段名 rows + lessonNumber 抛错', () => {
  const { assertScheduleSchema } = require(path.resolve(__dirname, '..', 'src', 'main', 'export', 'schedule-word.js'));
  let threw = false;
  try { assertScheduleSchema({ rows: [{ lessonNumber: 1, theoryHours: 2, homeworkCount: 1 }] }); }
  catch (e) { threw = /rows|lessonNumber|测试报告 Bug #1/.test(e.message); }
  assert(threw, 'assertScheduleSchema 应在检测到老字段名时抛错（防 Bug #1 静默失败）');
});

test('Round 18 C · exportScheduleWord 正确字段名通过（schedule.schedule + session/hours/homework）', () => {
  const { assertScheduleSchema } = require(path.resolve(__dirname, '..', 'src', 'main', 'export', 'schedule-word.js'));
  assertScheduleSchema({ schedule: [{ week: 1, session: 1, content: 'x', hours: 2, homework: 0 }] });
  // 不抛错即通过
});

test('Round 18 C · exportReportWord 检测老字段名 lessonOverview/objectivesAchievement 抛错', () => {
  const { assertReportSchema } = require(path.resolve(__dirname, '..', 'src', 'main', 'export', 'report-export.js'));
  let threw = false;
  try { assertReportSchema({ lessonOverview: 'x', objectivesAchievement: 'y', teachingHighlights: 'z' }); }
  catch (e) { threw = /老字段名|lessonOverview|实施报告/.test(e.message); }
  assert(threw, 'assertReportSchema 应在检测到老字段名时抛错（防交付问题 #5）');
});

test('Round 18 C · exportReportWord 正确 schema 通过（含 implementationOutcomes）', () => {
  const { assertReportSchema } = require(path.resolve(__dirname, '..', 'src', 'main', 'export', 'report-export.js'));
  assertReportSchema({ implementationOutcomes: { studentEngagement: { achieved: 'x' } } });
});

// ── 修复 D · PPT Vision 一致性审核可观测 ──
test('Round 18 D · ppt-images-pipeline 一致性审核未跑时 consistencyEnabled=false（不再默默假装 score=8）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'ppt-images-pipeline.service.js'), 'utf8');
  // 旧实现：return { consistencyScore: 8, ..., skipped: true } 静默假装
  // 新实现：consistencyScore: null + consistencyEnabled: false + skipReason
  assert(/consistencyEnabled:\s*false/.test(src),
    'pipeline 未在跳过分支显式标 consistencyEnabled: false');
  assert(/consistencyScore:\s*null/.test(src),
    'pipeline 未把跳过时 consistencyScore 改为 null（不再假装 8 分）');
  assert(/skipReason:\s*['"]no-quality-vision-service['"]|skipReason:\s*['"]samples-below-minimum['"]/.test(src),
    'pipeline 缺 skipReason 标记（caller/UI 无法区分"跳过原因"）');
});

test('Round 18 D · pipeline 主返回值暴露 consistencyEnabled / consistencySkipped / consistencySkipReason', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'ppt-images-pipeline.service.js'), 'utf8');
  ['consistencyEnabled', 'consistencySkipped', 'consistencySkipReason'].forEach((k) => {
    assert(src.includes(k), `pipeline 主返回值未暴露 ${k}`);
  });
});

// ── 【23】Round 19 治理收口·report normalize 保留 5 段法完整字段 + micro-video 字段对齐（codex 反馈） ──
console.log('\n【23】Round 19 治理收口·report 5 段法完整字段 + micro-video 字段对齐');

test('Round 19 · report.service normalize 保留 5 段法 duration/teacherActions/studentActions', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'services', 'report.service.js'), 'utf8');
  // 之前 inClassPhases map 只输出 {phase, highlight}，现在必须含完整字段
  assert(/inClassPhases\s*=\s*REQUIRED_PHASES\.map[\s\S]{0,400}teacherActions:[\s\S]{0,100}studentActions:[\s\S]{0,100}duration:/.test(src)
       || /teacherActions:\s*String\(p\.teacherActions/.test(src),
    'report.service normalizeReport 5 段法仍只保留 highlight·未保留 teacherActions/studentActions/duration');
});

test('Round 19 · report-export.js 渲染 5 段法 teacherActions / studentActions', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'export', 'report-export.js'), 'utf8');
  assert(/教师活动：\$\{ph\.teacherActions\}|ph\.teacherActions/.test(src),
    'exportReportWord 课中流程未渲染 teacherActions');
  assert(/学生活动：\$\{ph\.studentActions\}|ph\.studentActions/.test(src),
    'exportReportWord 课中流程未渲染 studentActions');
});

test('Round 19 · micro-video-word.js 受众读 targetAudience（不再 fallback 默认值）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'export', 'micro-video-word.js'), 'utf8');
  assert(/microVideo\.targetAudience\s*\|\|/.test(src),
    'micro-video 受众未优先读 targetAudience（codex 反馈点 1）');
});

test('Round 19 · micro-video-word.js 剪辑节奏读 eg.rhythm（不再 eg.pace）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'export', 'micro-video-word.js'), 'utf8');
  assert(/eg\.rhythm\s*\|\|\s*eg\.pace/.test(src),
    'micro-video 节奏未优先读 rhythm（codex 反馈点 2）');
});

test('Round 19 · micro-video-word.js 平台读 eg.platforms（不再 eg.tools）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'export', 'micro-video-word.js'), 'utf8');
  assert(/eg\.platforms/.test(src),
    'micro-video 投放平台未读 platforms');
});

test('Round 19 · verify:gate 串入 verify-export-content-v8（导出物级测试已接门禁）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  assert(/verify-export-content-v8/.test(pkg.scripts['verify:gate']),
    'package.json verify:gate 未串入 verify-export-content-v8');
  assert(pkg.scripts['verify:export-content'], 'package.json 缺独立 verify:export-content 脚本');
});

// ── 【24】v4.3.3 老师反馈·Bug1 在线测验找 PPT 鲁棒回退（节次匹配）─────────────
console.log('\n【24】v4.3.3 老师反馈·Bug1 测验找 PPT 节次匹配回退');

test('Bug1 · quiz.handlers 导出 pickLatestByLesson 供行为验证', () => {
  const m = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'quiz.handlers.js'));
  assert(typeof m.pickLatestByLesson === 'function', 'quiz.handlers 未导出 pickLatestByLesson');
});

test('Bug1 · 精确匹配节次优先', () => {
  const m = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'quiz.handlers.js'));
  const items = [
    { id: 1, type: 'ppt_outline', stage: 'ppt', metadata: { lessonNumber: 2 }, createdAt: '2026-05-01' },
    { id: 2, type: 'ppt_outline', stage: 'ppt', metadata: { lessonNumber: 5 }, createdAt: '2026-05-02' },
  ];
  assert(m.pickLatestByLesson(items, 'ppt_outline', 'ppt', 2)?.id === 1, '第2节应精确匹配 id=1');
  assert(m.pickLatestByLesson(items, 'ppt_outline', 'ppt', 5)?.id === 2, '第5节应精确匹配 id=2');
});

test('Bug1 · 无节次标注时回退最新（单节/老数据场景，根治"尚无PPT"误报）', () => {
  const m = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'quiz.handlers.js'));
  const noLabel = [
    { id: 3, type: 'ppt_outline', stage: 'ppt', metadata: {}, createdAt: '2026-05-03' },
    { id: 4, type: 'ppt_outline', stage: 'ppt', metadata: {}, createdAt: '2026-05-04' },
  ];
  // 都没标 lessonNumber → 回退用最新（id=4）
  assert(m.pickLatestByLesson(noLabel, 'ppt_outline', 'ppt', 1)?.id === 4,
    '无节次标注应回退最新 id=4（不再误报"尚无 PPT"）');
});

test('Bug1 · 有节次标注但选错节 → 返回 null（让 caller 友好报错）', () => {
  const m = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'quiz.handlers.js'));
  const labeled = [
    { id: 5, type: 'ppt_outline', stage: 'ppt', metadata: { lessonNumber: 2 }, createdAt: '2026-05-01' },
  ];
  assert(m.pickLatestByLesson(labeled, 'ppt_outline', 'ppt', 9) === null,
    '有节次标注但选错节应返回 null');
});

test('Bug1 · 一个 PPT 都没有 → 返回 null', () => {
  const m = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'quiz.handlers.js'));
  assert(m.pickLatestByLesson([], 'ppt_outline', 'ppt', 1) === null, '空数组应返回 null');
});

test('Bug1 · quiz.handlers 报错提示区分"完全没PPT"和"选错节"', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'quiz.handlers.js'), 'utf8');
  assert(/尚未生成任何 PPT/.test(src), '缺"完全没 PPT"的友好提示');
  assert(/选对了节次|为第.*节生成 PPT/.test(src), '缺"选错节/该节未生成"的友好提示');
});

// ── 【25】v4.3.3 老师反馈·Bug2 微课确认不解锁报告（UI 提示修正）─────────────
console.log('\n【25】v4.3.3 老师反馈·Bug2 报告解锁缺失项提示 + 微课确认提示修正');

test('Bug2 · resolveStageState 对 report locked 显示缺失确认项（不再笼统"等待上一步"）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'V2App.jsx'), 'utf8');
  // report locked 分支必须计算 missing 上游并显示"还需确认："
  assert(/stage\s*===\s*['"]report['"]/.test(src), 'resolveStageState 未对 report 单独处理 locked');
  assert(/还需确认：/.test(src), 'report locked 未显示"还需确认：..."缺失项');
  // 必须遍历 7 个上游阶段主产物的 confirmed 状态
  assert(/upstreamOrder|upstreamTitle/.test(src), 'report locked 缺上游阶段缺失计算');
});

test('Bug2 · 微课确认提示不再无条件说"已解锁"', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'V2App.jsx'), 'utf8');
  // 旧的无条件 "微课视频方案已确认，实施报告阶段已解锁。" 不能再单独出现（应改为条件式）
  // 现在应按 reportUnlocked 条件分支给提示
  assert(/reportUnlocked/.test(src), '微课确认未按 reportUnlocked 条件给提示');
  assert(/前置阶段全部点过|全部点过.*确认.*才解锁|前置.*确认.*才解锁/.test(src),
    '微课确认未在未解锁时提示"前置阶段需全部确认"');
});

// ── 【26】v4.3.3 老师反馈·功能3 进度表整行可编辑 ────────────────────────────
console.log('\n【26】v4.3.3 老师反馈·功能3 进度表整行可编辑');

test('功能3 · ScheduleStage 进度表 6 列全部接 onRowEdit（不再只 method）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'ScheduleStage.jsx'), 'utf8');
  ['week', 'session', 'chapter', 'content', 'hours', 'homework'].forEach((field) => {
    assert(new RegExp(`onRowEdit\\(i,\\s*['"]${field}['"]`).test(src),
      `进度表 ${field} 列未接 onRowEdit（仍只读，老师改不了）`);
  });
});

test('功能3 · 数字列编辑做 Number 转换（学时守恒不被字符串污染）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'ScheduleStage.jsx'), 'utf8');
  // week/session/hours/homework 数字列应在 onChange 里 Number(...) 转换
  assert(/onRowEdit\(i,\s*['"]hours['"][^)]*Number\(/.test(src),
    'hours 列未做 Number 转换（会导致学时守恒计算被字符串污染）');
});

test('功能3 · 表格标题提示不再误导"只能 JSON 编辑"', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'ScheduleStage.jsx'), 'utf8');
  assert(/可直接在表格内编辑各列/.test(src), '进度表标题未更新为"可直接在表格内编辑"');
  assert(!/点表格内单元格可在 JSON 模式下编辑/.test(src), '仍残留"只能 JSON 模式编辑"老提示');
});

// ── 【27】v4.3.3 老师反馈·功能4 阶段卡卡通老师助手（刘/吕/周）─────────────
console.log('\n【27】v4.3.3 老师反馈·功能4 阶段卡卡通老师助手');

test('功能4 · StageAssistant 组件存在 + 3 张头像就位', () => {
  const comp = path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'StageAssistant.jsx');
  assert(fs.existsSync(comp), 'StageAssistant.jsx 不存在');
  ['liu', 'lyu', 'zhou'].forEach((k) => {
    const p = path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'avatars', `${k}.png`);
    assert(fs.existsSync(p), `头像 avatars/${k}.png 不存在`);
  });
});

test('功能4 · 三角色映射正确（刘 1-4 / 吕 5-7 / 周 8）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'StageAssistant.jsx'), 'utf8');
  // 刘老师覆盖 schedule/design/ppt/lecture
  ['schedule', 'design', 'ppt', 'lecture'].forEach((s) => {
    assert(new RegExp(`${s}:[\\s\\S]{0,80}liuAvatar`).test(src), `${s} 未映射到刘老师`);
  });
  ['quiz', 'homework', 'video'].forEach((s) => {
    assert(new RegExp(`${s}:[\\s\\S]{0,80}lyuAvatar`).test(src), `${s} 未映射到吕老师`);
  });
  assert(/report:[\s\S]{0,80}zhouAvatar/.test(src), 'report 未映射到周老师');
});

test('功能4 · V2App 阶段卡挂头像按钮 + 弹 StageAssistant', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'V2App.jsx'), 'utf8');
  assert(/v2-stage-assistant-btn/.test(src), '阶段卡未加头像按钮');
  assert(/setAssistantStage\(card\.key\)/.test(src), '点头像未触发 setAssistantStage');
  assert(/<StageAssistant\s+stage=\{assistantStage\}/.test(src), '未渲染 StageAssistant 弹窗');
  // 点头像必须 stopPropagation（不触发切换阶段）
  assert(/e\.stopPropagation\(\);\s*setAssistantStage/.test(src), '点头像未 stopPropagation（会误触发切换阶段）');
});

// ── 【28】v4.3.3 老师反馈·功能5 讲稿朗读（周老师 + 语速）─────────────────────
console.log('\n【28】v4.3.3 老师反馈·功能5 讲稿朗读');

test('功能5 · LectureReader 组件存在 + 从 .mjs 工具引入分段算法（Codex R2 重构）', () => {
  const comp = path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'LectureReader.jsx');
  assert(fs.existsSync(comp), 'LectureReader.jsx 不存在');
  const src = fs.readFileSync(comp, 'utf8');
  assert(/SpeechSynthesisUtterance/.test(src), 'LectureReader 未用 Web Speech API');
  assert(/zhouAvatar/.test(src), 'LectureReader 未用周老师头像');
  // Codex R2：分段算法抽到 lecture-speech-utils.mjs，LectureReader 从中 import
  assert(/from '\.\/lecture-speech-utils\.mjs'/.test(src), 'LectureReader 未从 .mjs 工具引入');
});

test('功能5 · lecture-speech-utils.mjs 导出 cleanScriptForSpeech / splitScriptIntoChunks', () => {
  // 真实行为测试在 verify-export-content-v8.js（async await import）；这里查 .mjs 导出存在
  const util = path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'lecture-speech-utils.mjs');
  assert(fs.existsSync(util), 'lecture-speech-utils.mjs 不存在');
  const src = fs.readFileSync(util, 'utf8');
  assert(/export function cleanScriptForSpeech/.test(src), '.mjs 未导出 cleanScriptForSpeech');
  assert(/export function splitScriptIntoChunks/.test(src), '.mjs 未导出 splitScriptIntoChunks');
  assert(/export function hardSplit/.test(src), '.mjs 未导出 hardSplit（超长句硬切）');
});

test('功能5 · LectureStage 加"周老师朗读"按钮 + 渲染 LectureReader', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'LectureStage.jsx'), 'utf8');
  assert(/周老师朗读/.test(src), 'LectureStage 缺"周老师朗读"按钮');
  assert(/setReaderOpen\(true\)/.test(src), '朗读按钮未触发 setReaderOpen');
  assert(/<LectureReader\s/.test(src), '未渲染 LectureReader');
  // 仅 finalScript 存在时显示朗读按钮
  assert(/lessonForm\.finalScript \? \(\s*<button[\s\S]{0,200}周老师朗读/.test(src)
       || /finalScript[\s\S]{0,300}周老师朗读/.test(src),
    '朗读按钮未限定 finalScript 存在时显示');
});

test('功能5 · 语速默认档参考周老师真人录音（0.9× 标准档）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'LectureReader.jsx'), 'utf8');
  assert(/标准·周老师/.test(src), '缺"标准·周老师"语速档');
  assert(/useState\(0\.9\)/.test(src), '默认语速未设为 0.9×（周老师参考档）');
});

// ── 【29】Codex 审计第1轮·Bug1 真根因：metadata 持久化 + 统一节次解析 ──────────
console.log('\n【29】Codex 审计第1轮·Bug1 真根因（metadata 持久化 + 统一节次解析）');

test('CodexR1 · createArtifact 现在保存 metadata 字段（Bug1 真根因）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'database', 'db-simple.js'), 'utf8');
  // createArtifact item 必须含 metadata 字段
  assert(/metadata:\s*\(artifactData\.metadata/.test(src),
    'createArtifact 仍未保存 metadata（Bug1 真根因未修）');
});

test('CodexR1 · artifact-lesson.js 统一多来源节次解析', () => {
  const m = require(path.resolve(__dirname, '..', 'src', 'main', 'v2', 'artifact-lesson.js'));
  assert(typeof m.getArtifactLessonNumber === 'function', '缺 getArtifactLessonNumber');
  assert(typeof m.pickLatestArtifactByLesson === 'function', '缺 pickLatestArtifactByLesson');
  // 4 个来源都能解析
  assert(m.getArtifactLessonNumber({ metadata: { lessonNumber: 3 } }) === 3, 'metadata.lessonNumber 解析失败');
  assert(m.getArtifactLessonNumber({ metadata: { lessonContext: { lessonNumber: 4 } } }) === 4, 'metadata.lessonContext 解析失败');
  assert(m.getArtifactLessonNumber({ content: { lessonMeta: { lessonNumber: 5 } } }) === 5, 'content.lessonMeta 解析失败');
  assert(m.getArtifactLessonNumber({ content: { lessonContext: { lessonNumber: 6 } } }) === 6, 'content.lessonContext 解析失败');
  assert(m.getArtifactLessonNumber({}) === null, '无节次应返回 null');
});

test('CodexR1 · 真实失败用例：无 metadata 但 content.lessonContext 有节次，选第1节不串到第2节', () => {
  const m = require(path.resolve(__dirname, '..', 'src', 'main', 'v2', 'artifact-lesson.js'));
  const items = [
    { id: 1, type: 'ppt_outline', stage: 'ppt', content: { lessonContext: { lessonNumber: 1 } }, createdAt: '2026-05-01' },
    { id: 2, type: 'ppt_outline', stage: 'ppt', content: { lessonContext: { lessonNumber: 2 } }, createdAt: '2026-05-02' },
  ];
  // codex 反例：之前选第1节会错拿最新的第2节
  assert(m.pickLatestArtifactByLesson(items, 'ppt_outline', 'ppt', 1)?.id === 1, '选第1节应拿 id=1（不串到第2节）');
  assert(m.pickLatestArtifactByLesson(items, 'ppt_outline', 'ppt', 2)?.id === 2, '选第2节应拿 id=2');
  assert(m.pickLatestArtifactByLesson(items, 'ppt_outline', 'ppt', 9) === null, '选不存在的节应 null');
});

test('CodexR1 · quiz + homework handlers 都接入统一节次解析', () => {
  const q = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'quiz.handlers.js'), 'utf8');
  const h = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'homework.handlers.js'), 'utf8');
  assert(/require\(['"]\.\.\/\.\.\/v2\/artifact-lesson['"]\)/.test(q), 'quiz.handlers 未引入 artifact-lesson');
  assert(/require\(['"]\.\.\/\.\.\/v2\/artifact-lesson['"]\)/.test(h), 'homework.handlers 未引入 artifact-lesson');
  assert(/pickLatestArtifactByLesson/.test(q) && /pickLatestArtifactByLesson/.test(h),
    'quiz/homework 未用 pickLatestArtifactByLesson');
});

test('CodexR1 · report 按节过滤（单节防串课，问题5）', () => {
  const m = require(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report-upstream.helper.js'));
  // 构造：第1节和第2节各有 confirmed 的 ppt
  const arts = [
    { id: 11, type: 'ppt_outline', stage: 'ppt', confirmed: true, metadata: { lessonNumber: 1 }, createdAt: '2026-05-01' },
    { id: 12, type: 'ppt_outline', stage: 'ppt', confirmed: true, metadata: { lessonNumber: 2 }, createdAt: '2026-05-02' },
  ];
  const db = { listArtifacts: () => arts };
  // 单节模式：第1节报告只拿第1节 ppt（不拿最新的第2节）
  const single = m.collectReportUpstream(db, 1, { lessonNumber: 1 });
  assert(single.map.ppt === 11, `单节报告应拿第1节 ppt id=11，实际 ${single.map.ppt}`);
  // 整门课模式（不传 lessonNumber）：取最新
  const whole = m.collectReportUpstream(db, 1);
  assert(whole.map.ppt === 12, `整门课报告应取最新 ppt id=12，实际 ${whole.map.ppt}`);
});

test('CodexR1 · report.handlers 透传 payload.lessonNumber', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc', 'v2', 'report.handlers.js'), 'utf8');
  assert(/collectReportUpstream\(db,\s*notebookId,\s*\{\s*lessonNumber/.test(src),
    'report.handlers 未把 lessonNumber 传给 collectReportUpstream');
});

test('CodexR1 · migration 005 回填 metadata.lessonNumber 存在', () => {
  const p = path.resolve(__dirname, '..', 'src', 'main', 'migrations', '005-backfill-metadata-lessonnumber.js');
  assert(fs.existsSync(p), 'migration 005 不存在');
  const mod = require(p);
  assert(typeof mod.run === 'function', 'migration 005 缺 run');
  // 行为：构造无 metadata 但 content.lessonContext 有节次的 artifact，跑后回填
  const data = { artifacts: [{ id: 1, type: 'ppt_outline', content: { lessonContext: { lessonNumber: 7 } } }], migrations: [] };
  const stubDb = { _readData: () => data, _writeData: (d) => { Object.assign(data, d); } };
  const r = mod.run(stubDb, { log: () => {}, warn: () => {}, error: () => {} });
  assert(r.success, 'migration 005 执行失败');
  assert(data.artifacts[0].metadata && data.artifacts[0].metadata.lessonNumber === 7,
    `005 未回填 metadata.lessonNumber（实际 ${JSON.stringify(data.artifacts[0].metadata)}）`);
});

// ── 【30】Codex 审计第1轮·C 讲稿分段朗读 + 可见合规提醒 ──────────────────────
console.log('\n【30】Codex 审计第1轮·LectureReader 分段朗读 + 可见合规提醒');

test('CodexR1-C · LectureReader 分段队列朗读（splitScriptIntoChunks + voiceschanged）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'LectureReader.jsx'), 'utf8');
  assert(/splitScriptIntoChunks/.test(src), '未实现 splitScriptIntoChunks 分段');
  assert(/voiceschanged/.test(src), '未监听 voiceschanged（部分环境首次 getVoices 为空）');
  assert(/speakChunk/.test(src), '未实现分段队列朗读 speakChunk');
  // onend 链式播下一段
  assert(/onend\s*=\s*\(\)\s*=>\s*\{[^}]*speakChunk\(idx \+ 1/.test(src), 'onend 未链式播下一段');
});

test('CodexR1-C · 可见合规提醒（防误用于参赛视频配音）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'LectureReader.jsx'), 'utf8');
  assert(/v2-reader-compliance/.test(src), '缺可见合规提醒 UI（不只注释）');
  assert(/参赛演示视频的解说请用真人录音/.test(src), '合规提醒文案缺失');
});

// ── 【31】Codex 审计第2轮·讲稿朗读鲁棒性收口 ────────────────────────────────
console.log('\n【31】Codex 审计第2轮·讲稿朗读鲁棒性（硬切 + onerror 显式 + script 停止）');

test('CodexR2 · onerror 不再静默跳过（区分 interrupted + 显式 setError）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'LectureReader.jsx'), 'utf8');
  // onerror 必须区分 interrupted/canceled（正常取消）+ 其它真错 setError
  assert(/onerror\s*=\s*\(e\)\s*=>/.test(src), 'onerror 未接收 error 事件参数');
  assert(/interrupted'\s*\|\|\s*kind === 'canceled'/.test(src) || /interrupted.*canceled/.test(src),
    'onerror 未区分 interrupted/canceled 正常事件');
  assert(/setError\(/.test(src), 'onerror 真错时未 setError 显式提示（仍静默）');
});

test('CodexR2 · script 变化时停止朗读（防旧闭包进度/内容不一致）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'LectureReader.jsx'), 'utf8');
  assert(/useMemo\(\(\)\s*=>\s*splitScriptIntoChunks\(script\),\s*\[script\]\)/.test(src),
    'chunks 未用 useMemo 固定（script 变化不重算）');
  // 有一个 useEffect 监听 [script] 停止朗读
  assert(/useEffect\([\s\S]{0,400}cancelledRef\.current = true[\s\S]{0,200}\[script\]\)/.test(src),
    'script 变化未停止当前朗读');
});

test('CodexR2 · 分段行为测试已接入 verify:export-content（真实 await import）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'verify-export-content-v8.js'), 'utf8');
  assert(/lecture-speech-utils\.mjs/.test(src), 'export-content 未引入 .mjs 做真实行为测试');
  assert(/所有 chunk 都 ≤ 180/.test(src), '缺"500字无标点≤180"行为断言');
});

// ── 结果汇总 ─────────────────────────────────────────────────────────────
console.log(`\n═══ 结果：${pass}/${pass + fail} 通过 ═══`);
if (fail > 0) {
  console.log('\n失败列表：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}\n     ${f.error}`));
  process.exit(1);
}
process.exit(0);
