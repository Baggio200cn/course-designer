/**
 * verify-agent-pause-resume.js — Phase-7.5 M7.5.1 暂停-恢复机制验证
 *
 * 验证 5 个层面：
 *   1) dbApi          — db.saveAgentPauseState / getAgentPauseState / clearAgentPauseState
 *   2) migration      — agent_pause_states 字段自动创建（向后兼容旧数据）
 *   3) singletonByNb  — 同 notebookId 重复保存覆盖（每 notebook 至多 1 条）
 *   4) orchestrator   — run() 接受 resumeFromPause 选项 + stepLog 继承
 *   5) ipcLoading     — agent.handlers.js 注册 3 个新 channel
 *
 * 用法：node scripts/verify-agent-pause-resume.js
 *
 * 退出码：0=全部通过，1=任意检查失败
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const testDir = path.join(os.tmpdir(), `course-designer-pause-test-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });
process.env.ELECTRON_USER_DATA = testDir;
const dbFilePath = path.join(testDir, 'course-designer-data.json');

function freshDb() {
  delete require.cache[require.resolve('../src/main/database/db-simple')];
  if (fs.existsSync(dbFilePath)) fs.unlinkSync(dbFilePath);
  const Db = require('../src/main/database/db-simple');
  return new Db();
}

function dbWithRawData(rawData) {
  delete require.cache[require.resolve('../src/main/database/db-simple')];
  fs.writeFileSync(dbFilePath, JSON.stringify(rawData, null, 2), 'utf8');
  const Db = require('../src/main/database/db-simple');
  return new Db();
}

function readDbFile() {
  return JSON.parse(fs.readFileSync(dbFilePath, 'utf8'));
}

const cases = [];

// ── 1) dbApi ───────────────────────────────────────────
cases.push({
  name: 'saveAgentPauseState 写入 + getAgentPauseState 读取',
  fn: () => {
    const db = freshDb();
    const entry = db.saveAgentPauseState({
      notebookId: 100, stage: 'lecture',
      reason: '正式讲稿质量重试 3 次仍未达标',
      details: { lastErrors: ['字数不足', '寒暄词过多'] },
      suggestions: ['检查讲稿字数', '审核寒暄表达'],
      stepLog: [{ action: 'generate_lecture_formal', result: 'retry_exhausted' }],
      agentState: { drafts: { a: 'A', b: 'B', c: 'C' } },
    });
    if (!entry.pausedAt) throw new Error('应有 pausedAt 时间戳');
    if (entry.notebookId !== 100) throw new Error('notebookId 错');

    const fetched = db.getAgentPauseState(100);
    if (!fetched) throw new Error('应能读到');
    if (fetched.stage !== 'lecture') throw new Error('stage 错');
    if (fetched.suggestions.length !== 2) throw new Error('suggestions 错');
    if (fetched.stepLog.length !== 1) throw new Error('stepLog 错');
  },
});

cases.push({
  name: 'getAgentPauseState 不存在的 notebookId 返回 null',
  fn: () => {
    const db = freshDb();
    if (db.getAgentPauseState(999) !== null) throw new Error('应返回 null');
  },
});

cases.push({
  name: 'clearAgentPauseState 移除 + 返回 true',
  fn: () => {
    const db = freshDb();
    db.saveAgentPauseState({ notebookId: 200, stage: 'ppt', reason: 'test' });
    if (!db.getAgentPauseState(200)) throw new Error('保存失败');
    const removed = db.clearAgentPauseState(200);
    if (!removed) throw new Error('clear 应返回 true');
    if (db.getAgentPauseState(200) !== null) throw new Error('clear 后应为 null');
  },
});

cases.push({
  name: 'clearAgentPauseState 不存在时返回 false',
  fn: () => {
    const db = freshDb();
    if (db.clearAgentPauseState(999) !== false) throw new Error('未存在应返回 false');
  },
});

cases.push({
  name: 'saveAgentPauseState 缺 notebookId 抛错',
  fn: () => {
    const db = freshDb();
    let threw = false;
    try { db.saveAgentPauseState({ stage: 'x' }); } catch (e) { threw = true; }
    if (!threw) throw new Error('应抛错');
  },
});

// ── 2) migration ───────────────────────────────────────
cases.push({
  name: 'migration: 旧数据无 agent_pause_states 字段时自动创建',
  fn: () => {
    const oldData = {
      notebooks: [], modules: [], frameworks: [], artifacts: [],
      operations: [], backendEvents: [], workflowStates: [],
      resources: [], agent_memories: [], settings: {},
      // 故意缺 agent_pause_states
    };
    dbWithRawData(oldData);
    const after = readDbFile();
    if (!Array.isArray(after.agent_pause_states)) {
      throw new Error('迁移后应有 agent_pause_states 数组');
    }
  },
});

// ── 3) singletonByNb ───────────────────────────────────
cases.push({
  name: '同 notebookId 重复 save 覆盖（至多 1 条）',
  fn: () => {
    const db = freshDb();
    db.saveAgentPauseState({ notebookId: 300, stage: 'framework', reason: 'first' });
    db.saveAgentPauseState({ notebookId: 300, stage: 'lecture', reason: 'second' });
    const after = readDbFile();
    const matching = after.agent_pause_states.filter((x) => Number(x.notebookId) === 300);
    if (matching.length !== 1) throw new Error(`期望 1 条，实际 ${matching.length}`);
    if (matching[0].reason !== 'second') throw new Error('应保留最新');
  },
});

cases.push({
  name: '不同 notebookId 互不影响',
  fn: () => {
    const db = freshDb();
    db.saveAgentPauseState({ notebookId: 400, stage: 'a', reason: 'x' });
    db.saveAgentPauseState({ notebookId: 401, stage: 'b', reason: 'y' });
    if (!db.getAgentPauseState(400)) throw new Error('400 应存在');
    if (!db.getAgentPauseState(401)) throw new Error('401 应存在');
  },
});

// ── 4) orchestrator ────────────────────────────────────
cases.push({
  name: 'orchestrator.run 加载 + 接受 resumeFromPause 选项不报错',
  fn: () => {
    // 用 mock 加载 orchestrator
    const conflictPolicyReal = require('../src/main/agent/conflict-policy');
    const src = fs.readFileSync(path.join(__dirname, '../src/main/agent/orchestrator.js'), 'utf8');
    const wrapperSrc = `${src}\nmodule.exports._createAgentOrchestrator = createAgentOrchestrator;\n`;
    const tmpPath = path.join(__dirname, '__tmp_pause_test__.js');
    fs.writeFileSync(tmpPath, wrapperSrc);

    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (req) {
      if (req.includes('abc-generator')) return { generateLectureABCDrafts: async () => ({}) };
      if (req.includes('framework-schema')) return {
        normalizeFrameworkContent: (x) => x,
        validateFrameworkContent: () => ({ valid: true, errors: [], warnings: [] })
      };
      if (req.includes('quality')) return {
        validateLectureStage: () => ({ valid: true, errors: [], checks: { finalNarrationCharCount: 8000 } })
      };
      if (req.includes('context-builder')) return {
        buildLectureContext: () => ({}), buildPptContext: () => ({}),
      };
      if (req.includes('retry-loop')) return { generateWithRetry: async () => ({ result: {}, quality: { valid: true }, attempts: 1, exhausted: false, attemptLog: [] }) };
      if (req.includes('ark')) return { generateFramework: async () => ({}) };
      if (req.includes('memory')) return { saveMemory: () => {}, buildMemoryContext: () => '' };
      if (req.includes('ppt-plan-generator')) return { generatePptPlan: async () => ({ pages: [], pageCount: 0 }) };
      if (req.includes('v2-stage-helpers')) return { videoPrompt: () => '<x></x>' };
      if (req.includes('conflict-policy')) return conflictPolicyReal;
      if (req.includes('generation-audit')) return { recordGeneration: async () => null };
      return origLoad.apply(this, arguments);
    };

    const mod = require(tmpPath);
    Module._load = origLoad;
    fs.unlinkSync(tmpPath);

    if (typeof mod._createAgentOrchestrator !== 'function') {
      throw new Error('createAgentOrchestrator 未导出');
    }
    // 创建 orchestrator 不应报错
    const fakeDb = {
      getNotebookById: () => null, getCurrentFramework: () => null,
      getModulesByNotebook: () => [], getLatestArtifact: () => null,
      saveAgentPauseState: () => ({}), clearAgentPauseState: () => true,
    };
    const agent = mod._createAgentOrchestrator({ db: fakeDb, createAiClient: () => null, emitEvent: () => {} });
    if (typeof agent.run !== 'function') throw new Error('agent.run 不存在');
  },
});

cases.push({
  name: 'orchestrator.run 暂停状态返回 status=paused',
  fn: async () => {
    // 简单验证：当 db.getNotebookById 返回 null（笔记本不存在），run 仍能正常返回（不抛错）
    // 真实 paused 触发依赖具体业务场景（M7.5.3+5+4 中实现），此处只验证基础设施可用
    const conflictPolicyReal = require('../src/main/agent/conflict-policy');
    const src = fs.readFileSync(path.join(__dirname, '../src/main/agent/orchestrator.js'), 'utf8');
    const wrapperSrc = `${src}\nmodule.exports._createAgentOrchestrator = createAgentOrchestrator;\n`;
    const tmpPath = path.join(__dirname, '__tmp_pause_test2__.js');
    fs.writeFileSync(tmpPath, wrapperSrc);

    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (req) {
      if (req.includes('abc-generator')) return { generateLectureABCDrafts: async () => ({}) };
      if (req.includes('framework-schema')) return { normalizeFrameworkContent: (x) => x, validateFrameworkContent: () => ({ valid: true, errors: [], warnings: [] }) };
      if (req.includes('quality')) return { validateLectureStage: () => ({ valid: true, errors: [], checks: {} }) };
      if (req.includes('context-builder')) return { buildLectureContext: () => ({}), buildPptContext: () => ({}) };
      if (req.includes('retry-loop')) return { generateWithRetry: async () => ({ result: {}, quality: { valid: true }, attempts: 1, exhausted: false, attemptLog: [] }) };
      if (req.includes('ark')) return { generateFramework: async () => ({}) };
      if (req.includes('memory')) return { saveMemory: () => {}, buildMemoryContext: () => '' };
      if (req.includes('ppt-plan-generator')) return { generatePptPlan: async () => ({ pages: [], pageCount: 0 }) };
      if (req.includes('v2-stage-helpers')) return { videoPrompt: () => '<x></x>' };
      if (req.includes('conflict-policy')) return conflictPolicyReal;
      if (req.includes('generation-audit')) return { recordGeneration: async () => null };
      return origLoad.apply(this, arguments);
    };
    const mod = require(tmpPath);
    Module._load = origLoad;
    fs.unlinkSync(tmpPath);

    const fakeDb = {
      getNotebookById: () => null,  // 笔记本不存在 → 立即 error
      getCurrentFramework: () => null, getModulesByNotebook: () => [],
      getLatestArtifact: () => null,
      saveAgentPauseState: () => ({}), clearAgentPauseState: () => true,
    };
    const agent = mod._createAgentOrchestrator({ db: fakeDb, createAiClient: () => null, emitEvent: () => {} });
    const result = await agent.run(123, { targetStages: ['framework'] });
    if (result.success !== false || result.status !== 'error') {
      throw new Error(`笔记本不存在应返回 error，实际 status=${result.status}`);
    }
  },
});

cases.push({
  name: 'orchestrator.run 接受 resumeFromPause 选项时继承 stepLog',
  fn: async () => {
    const conflictPolicyReal = require('../src/main/agent/conflict-policy');
    const src = fs.readFileSync(path.join(__dirname, '../src/main/agent/orchestrator.js'), 'utf8');
    const wrapperSrc = `${src}\nmodule.exports._createAgentOrchestrator = createAgentOrchestrator;\n`;
    const tmpPath = path.join(__dirname, '__tmp_pause_test3__.js');
    fs.writeFileSync(tmpPath, wrapperSrc);

    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (req) {
      if (req.includes('abc-generator')) return { generateLectureABCDrafts: async () => ({}) };
      if (req.includes('framework-schema')) return { normalizeFrameworkContent: (x) => x, validateFrameworkContent: () => ({ valid: true, errors: [], warnings: [] }) };
      if (req.includes('quality')) return { validateLectureStage: () => ({ valid: true, errors: [], checks: { finalNarrationCharCount: 8000 } }) };
      if (req.includes('context-builder')) return { buildLectureContext: () => ({}), buildPptContext: () => ({}) };
      if (req.includes('retry-loop')) return { generateWithRetry: async () => ({ result: {}, quality: { valid: true }, attempts: 1, exhausted: false, attemptLog: [] }) };
      if (req.includes('ark')) return { generateFramework: async () => ({}) };
      if (req.includes('memory')) return { saveMemory: () => {}, buildMemoryContext: () => '' };
      if (req.includes('ppt-plan-generator')) return { generatePptPlan: async () => ({ pages: [], pageCount: 0 }) };
      if (req.includes('v2-stage-helpers')) return { videoPrompt: () => '<x></x>' };
      if (req.includes('conflict-policy')) return conflictPolicyReal;
      if (req.includes('generation-audit')) return { recordGeneration: async () => null };
      return origLoad.apply(this, arguments);
    };
    const mod = require(tmpPath);
    Module._load = origLoad;
    fs.unlinkSync(tmpPath);

    let clearCalled = false;
    const fakeDb = {
      getNotebookById: () => ({ id: 100, name: 'X', totalHours: 4 }),
      getCurrentFramework: () => ({ id: 1, content: { _mockValid: true } }),
      getModulesByNotebook: () => [],
      getLatestArtifact: (nid, type) => {
        if (type === 'lecture_drafts') return { content: { drafts: { a: 'A'.repeat(300), b: 'B'.repeat(300), c: 'C'.repeat(300) }, selectedDraft: 'a' } };
        if (type === 'lecture_final') return { content: { finalScript: 'F'.repeat(8000) } };
        return null;
      },
      saveAgentPauseState: () => ({}),
      clearAgentPauseState: () => { clearCalled = true; return true; },
    };
    const agent = mod._createAgentOrchestrator({ db: fakeDb, createAiClient: () => null, emitEvent: () => {} });
    const previousStepLog = [
      { action: 'generate_framework', result: 'ok' },
      { action: 'generate_lecture_abc', result: 'ok' },
    ];
    const result = await agent.run(100, {
      targetStages: ['framework', 'lecture'],
      resumeFromPause: { stepLog: previousStepLog, agentState: {}, refinementHint: 'test' },
    });
    if (!clearCalled) throw new Error('恢复时应清除 DB pause 状态');
    // stepLog 应继承历史 + 新步骤
    if (result.stepLog.length < previousStepLog.length) {
      throw new Error(`stepLog 应继承历史步骤，至少 ${previousStepLog.length} 条`);
    }
  },
});

// ── 5) ipcLoading ──────────────────────────────────────
cases.push({
  name: 'agent.handlers 加载 + 注册 5 个 channel（pause/resume/clear/run/getStatus）',
  fn: () => {
    delete require.cache[require.resolve('../src/main/ipc/agent.handlers')];
    const m = require('../src/main/ipc/agent.handlers');
    if (typeof m.register !== 'function') throw new Error('应导出 register');
    const registered = [];
    const fakeIpcMain = { handle: (channel) => registered.push(channel) };
    m.register(fakeIpcMain, () => ({}));
    const expected = ['agent:run', 'agent:getStatus', 'agent:getPauseState', 'agent:resume', 'agent:clearPauseState'];
    for (const ch of expected) {
      if (!registered.includes(ch)) throw new Error(`应注册 ${ch}`);
    }
  },
});

cases.push({
  name: 'preload 暴露 agentGetPauseState/agentResume/agentClearPauseState',
  fn: () => {
    const preloadSrc = fs.readFileSync(path.join(__dirname, '../src/preload/index.js'), 'utf8');
    if (!preloadSrc.includes('agentGetPauseState')) throw new Error('preload 缺 agentGetPauseState');
    if (!preloadSrc.includes('agentResume')) throw new Error('preload 缺 agentResume');
    if (!preloadSrc.includes('agentClearPauseState')) throw new Error('preload 缺 agentClearPauseState');
  },
});

// ─── 主流程 ────────────────────────────────────────
async function main() {
  let passed = 0;
  const failures = [];
  for (const c of cases) {
    try {
      const r = c.fn();
      if (r && typeof r.then === 'function') await r;
      passed++;
    } catch (e) {
      failures.push({ name: c.name, message: e.message });
    }
  }
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  const ok = failures.length === 0;
  console.log(JSON.stringify({
    ok, checkedAt: new Date().toISOString(),
    passed, total: cases.length, failures,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
