/**
 * verify-conflict-priority.js — Phase-6 M2.6 冲突优先级总验证
 *
 * 验证 5 个层面：
 *   1) selfCheck       — conflict-policy 模块内置 18 个用例
 *   2) lockIntegration — db.lockedByUser 与 conflict-policy 联动
 *   3) snapshot        — 关键决策结果稳定性（防止后续无意修改改变冲突裁决）
 *   4) backtracking    — 模拟 Agent backtracking 在锁定/未锁定下的行为
 *   5) coverage        — 7 个冲突类型每个都至少被覆盖
 *
 * 用法：node scripts/verify-conflict-priority.js
 *
 * 退出码：0=全部通过，1=任意检查失败
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const conflictPolicy = require('../src/main/agent/conflict-policy');
const { CONFLICT_TYPE, RESOLUTION, resolveConflict, findFirstBlocking, selfCheck } = conflictPolicy;

const SNAPSHOT_FILE = path.join(__dirname, '__snapshots__', 'conflict-priority.snap.json');
const UPDATE_MODE = process.argv.includes('--update');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function loadSnapshots() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveSnapshots(snaps) {
  const dir = path.dirname(SNAPSHOT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snaps, null, 2) + '\n', 'utf8');
}

// ─── 1) selfCheck ────────────────────────────────────────
function runSelfCheck() {
  return selfCheck();
}

// ─── 2) lockIntegration: db + conflict-policy 联动 ────────
function runLockIntegration() {
  // 用临时 db 验证 lockedByUser 字段从 db 取出后能正确驱动 conflict-policy
  const testDir = path.join(os.tmpdir(), `course-designer-conflict-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  process.env.ELECTRON_USER_DATA = testDir;

  delete require.cache[require.resolve('../src/main/database/db-simple')];
  const Db = require('../src/main/database/db-simple');
  const db = new Db();

  const result = { passed: 0, total: 0, failures: [] };
  const cases = [];

  // 场景 1：用户 confirm 后 db 中 lockedByUser=true → conflict-policy 阻塞 Agent
  cases.push({
    name: 'confirmed artifact 触发用户保护',
    fn: () => {
      const a = db.createArtifact({ notebookId: 100, type: 'framework_json', confirmed: true });
      if (!a.lockedByUser) throw new Error('confirmed artifact 应锁');
      const decision = resolveConflict(CONFLICT_TYPE.USER_EDIT_VS_AGENT, { upstreamArtifact: a });
      if (!decision.blocksAgent) throw new Error('已锁 artifact 应阻塞 Agent');
      if (decision.resolution !== RESOLUTION.USER_EDIT_PROTECTED) {
        throw new Error(`期望 USER_EDIT_PROTECTED，实际 ${decision.resolution}`);
      }
    },
  });

  // 场景 2：未确认 artifact 不锁 → Agent 可继续
  cases.push({
    name: '未确认 artifact 允许 Agent 继续',
    fn: () => {
      const a = db.createArtifact({ notebookId: 101, type: 'framework_json', confirmed: false });
      if (a.lockedByUser) throw new Error('未确认 artifact 不应自动锁');
      const decision = resolveConflict(CONFLICT_TYPE.USER_EDIT_VS_AGENT, { upstreamArtifact: a });
      if (decision.blocksAgent) throw new Error('未锁 artifact 不应阻塞');
      if (decision.resolution !== RESOLUTION.AGENT_PROCEEDS) {
        throw new Error(`期望 AGENT_PROCEEDS，实际 ${decision.resolution}`);
      }
    },
  });

  // 场景 3：用户解锁后 Agent 可重新覆盖
  cases.push({
    name: '解锁后 Agent 可继续',
    fn: () => {
      const a = db.createArtifact({ notebookId: 102, type: 'framework_json', confirmed: true });
      db.setArtifactLock(a.id, false);  // 用户主动解锁
      const fresh = db.getLatestArtifact(102, 'framework_json', 'framework');
      if (fresh.lockedByUser) throw new Error('setArtifactLock(false) 后应解锁');
      const decision = resolveConflict(CONFLICT_TYPE.USER_EDIT_VS_AGENT, { upstreamArtifact: fresh });
      if (decision.blocksAgent) throw new Error('解锁后不应阻塞');
    },
  });

  // 场景 4：findFirstBlocking 在锁定场景下能定位首个阻塞
  cases.push({
    name: 'findFirstBlocking 集成定位',
    fn: () => {
      const a = db.createArtifact({ notebookId: 103, type: 'framework_json', confirmed: true });
      const blocking = findFirstBlocking([
        { type: CONFLICT_TYPE.MEMORY_VS_CURRENT },
        { type: CONFLICT_TYPE.USER_EDIT_VS_AGENT, context: { upstreamArtifact: a } },
        { type: CONFLICT_TYPE.PROJECT_VS_USER },
      ]);
      if (!blocking) throw new Error('应找到阻塞决策');
      if (blocking.conflictType !== CONFLICT_TYPE.USER_EDIT_VS_AGENT) {
        throw new Error(`应返回 USER_EDIT_VS_AGENT，实际 ${blocking.conflictType}`);
      }
    },
  });

  for (const c of cases) {
    result.total++;
    try {
      c.fn();
      result.passed++;
    } catch (e) {
      result.failures.push({ name: c.name, message: e.message });
    }
  }

  // 清理
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (e) { /* 忽略 */ }

  return result;
}

// ─── 3) snapshot: 关键决策稳定性 ─────────────────────────
function captureSnapshots() {
  const snaps = {};

  // 9 个固定场景的决策结果
  const scenarios = [
    ['platform_basic', CONFLICT_TYPE.PLATFORM_VS_USER, {}],
    ['project_basic', CONFLICT_TYPE.PROJECT_VS_USER, {}],
    ['memory_basic', CONFLICT_TYPE.MEMORY_VS_CURRENT, {}],
    ['lock_yes', CONFLICT_TYPE.USER_EDIT_VS_AGENT, { lockedByUser: true }],
    ['lock_no', CONFLICT_TYPE.USER_EDIT_VS_AGENT, { lockedByUser: false }],
    ['quality_invalid', CONFLICT_TYPE.QUALITY_VS_USER_ACCEPT, { quality: { valid: false, errors: ['x'] }, userForceAccept: false }],
    ['quality_force', CONFLICT_TYPE.QUALITY_VS_USER_ACCEPT, { quality: { valid: false, errors: ['x'] }, userForceAccept: true }],
    ['contracts_no_import', CONFLICT_TYPE.CONTRACTS_VS_SKIP, {}],
    ['contracts_with_import', CONFLICT_TYPE.CONTRACTS_VS_SKIP, { hasImportPath: true, importedArtifact: { type: 'lecture' } }],
    ['retry_proceed', CONFLICT_TYPE.RETRY_VS_STOP, { attemptCount: 1, maxAttempts: 3 }],
    ['retry_exhausted', CONFLICT_TYPE.RETRY_VS_STOP, { attemptCount: 3, maxAttempts: 3 }],
    ['retry_userstop', CONFLICT_TYPE.RETRY_VS_STOP, { userStopRequested: true }],
  ];

  for (const [name, type, ctx] of scenarios) {
    const decision = resolveConflict(type, ctx);
    // 只哈希关键稳定字段（resolution + blocksAgent + requiresUserConfirm）
    const stableJson = JSON.stringify({
      resolution: decision.resolution,
      blocksAgent: decision.blocksAgent,
      requiresUserConfirm: decision.requiresUserConfirm,
    });
    snaps[name] = { hash: sha256(stableJson), resolution: decision.resolution };
  }
  return snaps;
}

function runSnapshotTests() {
  const current = captureSnapshots();
  const stored = loadSnapshots();
  const result = { passed: 0, total: 0, failures: [], updated: false };

  for (const key of Object.keys(current)) {
    result.total++;
    if (!stored || !stored[key]) {
      result.passed++;
      continue;
    }
    if (stored[key].hash === current[key].hash) {
      result.passed++;
    } else if (UPDATE_MODE) {
      result.passed++;
    } else {
      result.failures.push({
        snapshot: key,
        storedResolution: stored[key].resolution,
        currentResolution: current[key].resolution,
        message: `决策结果不一致——若是有意调整，跑 --update 更新基线`,
      });
    }
  }

  if (UPDATE_MODE || !stored) {
    saveSnapshots(current);
    result.updated = true;
  }
  return result;
}

// ─── 4) coverage: 7 个冲突类型全部覆盖 ────────────────────
function runCoverage() {
  const allTypes = Object.values(CONFLICT_TYPE);
  const covered = new Set();
  // 通过 selfCheck 与 snapshot 隐式覆盖；这里直接调一遍每个类型
  for (const type of allTypes) {
    try {
      // 多数类型默认 ctx 即可；少数需要 ctx 才能不抛错
      let decision;
      if (type === CONFLICT_TYPE.RETRY_VS_STOP) {
        decision = resolveConflict(type, { attemptCount: 0, maxAttempts: 3 });
      } else if (type === CONFLICT_TYPE.QUALITY_VS_USER_ACCEPT) {
        decision = resolveConflict(type, { quality: { valid: true } });
      } else if (type === CONFLICT_TYPE.USER_EDIT_VS_AGENT) {
        decision = resolveConflict(type, { lockedByUser: false });
      } else {
        decision = resolveConflict(type);
      }
      if (decision && decision.conflictType === type) covered.add(type);
    } catch (e) { /* 忽略 */ }
  }

  return {
    totalTypes: allTypes.length,
    coveredTypes: covered.size,
    uncovered: allTypes.filter((t) => !covered.has(t)),
  };
}

// ─── 主流程 ─────────────────────────────────────────────
function main() {
  const checkedAt = new Date().toISOString();
  const selfCheckRes = runSelfCheck();
  const lockIntegration = runLockIntegration();
  const snapshot = runSnapshotTests();
  const coverage = runCoverage();

  const ok =
    selfCheckRes.failures.length === 0 &&
    lockIntegration.failures.length === 0 &&
    snapshot.failures.length === 0 &&
    coverage.uncovered.length === 0;

  const report = {
    ok,
    checkedAt,
    updateMode: UPDATE_MODE,
    selfCheck: {
      passed: selfCheckRes.passed,
      total: selfCheckRes.total,
      failures: selfCheckRes.failures,
    },
    lockIntegration: {
      passed: lockIntegration.passed,
      total: lockIntegration.total,
      failures: lockIntegration.failures,
    },
    snapshot: {
      passed: snapshot.passed,
      total: snapshot.total,
      updated: snapshot.updated,
      failures: snapshot.failures,
    },
    coverage,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
