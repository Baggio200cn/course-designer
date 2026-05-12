/**
 * verify-user-lock-migration.js — Phase-6 M2.1 lockedByUser 字段验证
 *
 * 验证 db-simple.js 的 lockedByUser 字段在以下场景下行为正确：
 *   1) createArtifact 默认行为（与 confirmed 同步）
 *   2) createArtifact 显式 lockedByUser 优先级
 *   3) updateArtifact 设 confirmed=true 自动联动锁定
 *   4) updateArtifact 显式 lockedByUser 优先级
 *   5) setArtifactLock 直接设置
 *   6) isArtifactLocked / isLatestArtifactLocked
 *   7) 迁移逻辑：旧数据 confirmed=true 应自动 lockedByUser=true（Q4 选项 B）
 *   8) 迁移逻辑：旧数据 confirmed=false 应 lockedByUser=false
 *
 * 用法：node scripts/verify-user-lock-migration.js
 *
 * 退出码：0=全部通过，1=任意检查失败
 *
 * 注意：脚本会在系统临时目录创建一个独立的 DB 文件做测试，不污染生产数据。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── 测试用临时 DB 目录 ────────────────────────────────────
const testDir = path.join(os.tmpdir(), `course-designer-m2-1-test-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });
process.env.ELECTRON_USER_DATA = testDir;
const dbFilePath = path.join(testDir, 'course-designer-data.json');

// ─── 工具函数 ──────────────────────────────────────────────
function freshDb() {
  // 清缓存确保每次拿到干净实例
  delete require.cache[require.resolve('../src/main/database/db-simple')];
  // 删旧 DB 文件让 initDatabase 走"全新初始化"分支
  if (fs.existsSync(dbFilePath)) fs.unlinkSync(dbFilePath);
  const Db = require('../src/main/database/db-simple');
  return new Db();
}

function dbWithRawData(rawData) {
  // 写入指定的旧格式数据，再实例化 DB 触发迁移
  delete require.cache[require.resolve('../src/main/database/db-simple')];
  fs.writeFileSync(dbFilePath, JSON.stringify(rawData, null, 2), 'utf8');
  const Db = require('../src/main/database/db-simple');
  return new Db();
}

function readDbFile() {
  return JSON.parse(fs.readFileSync(dbFilePath, 'utf8'));
}

// ─── 测试用例集 ────────────────────────────────────────────
const cases = [];

// 用例 1：createArtifact(confirmed=true) → 默认 lockedByUser=true
cases.push({
  name: 'createArtifact: confirmed=true 默认锁定',
  fn: () => {
    const db = freshDb();
    const a = db.createArtifact({ notebookId: 1, type: 'lecture_final', confirmed: true });
    if (a.lockedByUser !== true) {
      throw new Error(`期望 lockedByUser=true，实际 ${a.lockedByUser}`);
    }
  },
});

// 用例 2：createArtifact(confirmed=false) → 默认 lockedByUser=false
cases.push({
  name: 'createArtifact: confirmed=false 默认不锁',
  fn: () => {
    const db = freshDb();
    const a = db.createArtifact({ notebookId: 1, type: 'lecture_drafts', confirmed: false });
    if (a.lockedByUser !== false) {
      throw new Error(`期望 lockedByUser=false，实际 ${a.lockedByUser}`);
    }
  },
});

// 用例 3：createArtifact 显式 lockedByUser 优先（覆盖默认）
cases.push({
  name: 'createArtifact: 显式 lockedByUser=false 即使 confirmed=true 也不锁',
  fn: () => {
    const db = freshDb();
    const a = db.createArtifact({
      notebookId: 1, type: 'lecture_final', confirmed: true, lockedByUser: false,
    });
    if (a.lockedByUser !== false) {
      throw new Error(`显式输入应优先，期望 lockedByUser=false，实际 ${a.lockedByUser}`);
    }
  },
});

// 用例 4：updateArtifact(confirmed=true) 自动联动 lockedByUser=true
cases.push({
  name: 'updateArtifact: confirmed=true 自动锁定（Q2 触发场景 1）',
  fn: () => {
    const db = freshDb();
    const a = db.createArtifact({ notebookId: 1, type: 'framework' });  // 默认 confirmed=false
    if (a.lockedByUser !== false) throw new Error('初始应为未锁');
    const updated = db.updateArtifact(a.id, { confirmed: true });
    if (updated.lockedByUser !== true) {
      throw new Error(`updateArtifact 设 confirmed=true 应自动锁，实际 lockedByUser=${updated.lockedByUser}`);
    }
  },
});

// 用例 5：updateArtifact 显式 lockedByUser 优先
cases.push({
  name: 'updateArtifact: 显式 lockedByUser 优先于 confirmed 联动',
  fn: () => {
    const db = freshDb();
    const a = db.createArtifact({ notebookId: 1, type: 'framework' });
    const updated = db.updateArtifact(a.id, { confirmed: true, lockedByUser: false });
    if (updated.lockedByUser !== false) {
      throw new Error(`显式 lockedByUser=false 应保留，实际 ${updated.lockedByUser}`);
    }
    if (updated.confirmed !== true) {
      throw new Error('confirmed 应保留为 true');
    }
  },
});

// 用例 6：setArtifactLock 直接设置
cases.push({
  name: 'setArtifactLock: 显式锁定/解锁',
  fn: () => {
    const db = freshDb();
    const a = db.createArtifact({ notebookId: 1, type: 'ppt_outline' });
    const locked = db.setArtifactLock(a.id, true);
    if (!locked || locked.lockedByUser !== true) throw new Error('setArtifactLock(true) 失败');
    const unlocked = db.setArtifactLock(a.id, false);
    if (!unlocked || unlocked.lockedByUser !== false) throw new Error('setArtifactLock(false) 失败');
    // 不存在的 id 返回 null
    if (db.setArtifactLock(99999999, true) !== null) {
      throw new Error('不存在的 id 应返回 null');
    }
  },
});

// 用例 7：isArtifactLocked / isLatestArtifactLocked
cases.push({
  name: 'isArtifactLocked / isLatestArtifactLocked: 查询接口',
  fn: () => {
    const db = freshDb();
    const a1 = db.createArtifact({ notebookId: 42, type: 'lecture_final', confirmed: true });
    const a2 = db.createArtifact({ notebookId: 42, type: 'lecture_drafts' });
    if (db.isArtifactLocked(a1.id) !== true) throw new Error('a1 应锁定');
    if (db.isArtifactLocked(a2.id) !== false) throw new Error('a2 不应锁定');
    if (db.isArtifactLocked(99999999) !== false) throw new Error('不存在 id 应返回 false');

    if (db.isLatestArtifactLocked(42, 'lecture_final') !== true) {
      throw new Error('isLatestArtifactLocked(42, lecture_final) 应返回 true');
    }
    if (db.isLatestArtifactLocked(42, 'lecture_drafts') !== false) {
      throw new Error('isLatestArtifactLocked(42, lecture_drafts) 应返回 false');
    }
    if (db.isLatestArtifactLocked(999, 'lecture_final') !== false) {
      throw new Error('不存在的 notebook 应返回 false');
    }
  },
});

// 用例 8：迁移 — 旧数据 confirmed=true 自动 lockedByUser=true（Q4 选项 B）
cases.push({
  name: '迁移: 旧 artifact confirmed=true 自动加 lockedByUser=true',
  fn: () => {
    const oldData = {
      notebooks: [],
      modules: [],
      frameworks: [],
      artifacts: [
        // 没有 lockedByUser 字段的旧数据
        { id: 1001, notebookId: 1, type: 'lecture_final', confirmed: true, content: 'old lecture' },
        { id: 1002, notebookId: 1, type: 'lecture_drafts', confirmed: false, content: 'old drafts' },
      ],
      operations: [], backendEvents: [], workflowStates: [], resources: [],
      agent_memories: [], settings: {},
    };
    dbWithRawData(oldData);
    // 触发迁移后读 DB 文件
    const after = readDbFile();
    const a1 = after.artifacts.find((x) => x.id === 1001);
    const a2 = after.artifacts.find((x) => x.id === 1002);
    if (a1.lockedByUser !== true) {
      throw new Error(`迁移失败：旧 confirmed=true 应自动锁，实际 lockedByUser=${a1.lockedByUser}`);
    }
    if (a2.lockedByUser !== false) {
      throw new Error(`迁移失败：旧 confirmed=false 应不锁，实际 lockedByUser=${a2.lockedByUser}`);
    }
  },
});

// 用例 9：迁移幂等 — 第二次启动不应改变已迁移数据
cases.push({
  name: '迁移幂等: 已含 lockedByUser 字段的数据不被重置',
  fn: () => {
    const oldData = {
      notebooks: [],
      modules: [],
      frameworks: [],
      artifacts: [
        // 已迁移过的数据（user 之前手动改过解了锁）
        { id: 2001, notebookId: 1, type: 'lecture_final', confirmed: true, lockedByUser: false, content: 'x' },
      ],
      operations: [], backendEvents: [], workflowStates: [], resources: [],
      agent_memories: [], settings: {},
    };
    dbWithRawData(oldData);
    const after = readDbFile();
    const a = after.artifacts.find((x) => x.id === 2001);
    if (a.lockedByUser !== false) {
      throw new Error(`迁移破坏了已存在的 lockedByUser 状态：实际 ${a.lockedByUser}`);
    }
  },
});

// 用例 10：updateArtifact 仅传 confirmed=false 不应清除已有锁
cases.push({
  name: 'updateArtifact: confirmed=false 不应清除 lockedByUser',
  fn: () => {
    const db = freshDb();
    const a = db.createArtifact({ notebookId: 1, type: 'framework', confirmed: true });
    if (a.lockedByUser !== true) throw new Error('初始 confirmed=true 应锁');
    // 取消 confirm，但锁应保留（用户的手工编辑应继续受保护）
    const updated = db.updateArtifact(a.id, { confirmed: false });
    if (updated.lockedByUser !== true) {
      throw new Error(`仅取消 confirmed 不应解锁，实际 lockedByUser=${updated.lockedByUser}`);
    }
  },
});

// ─── 主流程 ────────────────────────────────────────────
function main() {
  const failures = [];
  let passed = 0;

  for (const c of cases) {
    try {
      c.fn();
      passed++;
    } catch (e) {
      failures.push({ name: c.name, message: e.message });
    }
  }

  // 清理临时目录
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (e) {
    // 清理失败不影响测试结果
  }

  const ok = failures.length === 0;
  const report = {
    ok,
    checkedAt: new Date().toISOString(),
    passed,
    total: cases.length,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
