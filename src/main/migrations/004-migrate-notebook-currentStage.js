/**
 * 004-migrate-notebook-currentStage.js
 *
 * v4.3.3 · Codex Round 3 #4 补丁（2026-05-18）
 *
 * 003 处理了 workflowStates 的 framework → schedule，但 notebooks 表里
 * notebook.currentStage 字段仍可能是 'framework'。这条字段在 ensureWorkflowStateForNotebook
 * 里被读到，会把 framework 带回运行时。
 *
 * 本 migration 把所有 notebook.currentStage='framework' 改为 'schedule'。
 * 不改其他字段。
 */

'use strict';

const MIGRATION_ID = '004-migrate-notebook-currentStage';
const MIGRATION_VERSION = 1;

function run(db, log = console) {
  try {
    if (!db || typeof db._readData !== 'function') {
      log.warn(`[migration:${MIGRATION_ID}] db 不可用，跳过`);
      return { success: false, skipped: true };
    }
    const data = db._readData();
    const migrations = Array.isArray(data.migrations) ? data.migrations : [];
    if (migrations.some((m) => m.id === MIGRATION_ID && m.version >= MIGRATION_VERSION)) {
      log.log(`[migration:${MIGRATION_ID}] 已执行过 v${MIGRATION_VERSION}，跳过`);
      return { success: true, skipped: true };
    }

    let notebookFixed = 0;
    if (Array.isArray(data.notebooks)) {
      data.notebooks = data.notebooks.map((nb) => {
        if (!nb) return nb;
        if (nb.currentStage === 'framework') {
          notebookFixed += 1;
          return {
            ...nb,
            currentStage: 'schedule',
            _legacyCurrentStage: 'framework',
            migratedAt: new Date().toISOString(),
          };
        }
        return nb;
      });
    }

    data.migrations = Array.isArray(data.migrations) ? data.migrations : [];
    data.migrations.push({
      id: MIGRATION_ID,
      version: MIGRATION_VERSION,
      runAt: new Date().toISOString(),
      notebookFixed,
    });
    db._writeData(data);

    log.log(`[migration:${MIGRATION_ID}] 完成 · 修复 ${notebookFixed} 个 notebook.currentStage=framework → schedule`);
    return { success: true, notebookFixed };
  } catch (err) {
    log.error(`[migration:${MIGRATION_ID}] 失败:`, err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  MIGRATION_ID,
  MIGRATION_VERSION,
  run,
};
