/**
 * 001-recover-orphan-artifacts.js
 *
 * P0-1 修复 · 2026-05-18 v4.3.3
 *
 * 背景：
 *   老师反馈「我昨天用 4.1.4 生成了 36 个教学设计，现在没了」
 *   根因：跨版本 schema 升级时部分 artifact 被标记 status='deleted'，
 *        或 notebookId 指向不存在的 notebook 而被前端过滤
 *
 * 修复策略（保守）：
 *   1. 不修改任何 artifact（保留原状态）
 *   2. 扫描全库，识别"潜在丢失"的 artifact：
 *      a) status='deleted' 但 content 非空（≥ 50 字节）
 *      b) notebookId 不在 notebooks 表中（孤儿）
 *      c) v4.0 前的老 type（framework_json / framework_preview_md）但仍有 content
 *   3. 把识别结果写入 db.workflowState 顶层字段 `_recoverable`
 *   4. 教师日志页面读 `_recoverable` 显示「🔍 找回 N 条历史数据」按钮
 *
 * 不做的事：
 *   - 不自动恢复（status='deleted' → 'draft'）—— 怕误伤老师确认过的删除操作
 *   - 不删孤儿—— 老师可能后续找回那个 notebook
 *
 * 运行时机：每次 app 启动时执行一次（migration_log 防重）
 */

'use strict';

const MIGRATION_ID = '001-recover-orphan-artifacts';
const MIGRATION_VERSION = 1;

function run(db, log = console) {
  try {
    if (!db || typeof db._readData !== 'function') {
      log.warn(`[migration:${MIGRATION_ID}] db 不可用，跳过`);
      return { success: false, skipped: true, reason: 'db unavailable' };
    }

    const data = db._readData();
    const migrations = Array.isArray(data.migrations) ? data.migrations : [];
    if (migrations.some((m) => m.id === MIGRATION_ID && m.version >= MIGRATION_VERSION)) {
      log.log(`[migration:${MIGRATION_ID}] 已执行过 v${MIGRATION_VERSION}，跳过`);
      return { success: true, skipped: true };
    }

    const notebooks = Array.isArray(data.notebooks) ? data.notebooks : [];
    const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
    const notebookIds = new Set(notebooks.map((n) => Number(n.id)));

    const recoverable = [];
    artifacts.forEach((a) => {
      const contentSize = a.content
        ? (typeof a.content === 'string' ? a.content.length : JSON.stringify(a.content).length)
        : 0;
      const reasons = [];
      if (a.status === 'deleted' && contentSize >= 50) reasons.push('已标记删除但内容非空');
      if (a.notebookId && !notebookIds.has(Number(a.notebookId))) reasons.push('指向不存在的笔记本');
      if (['framework_json', 'framework_preview_md'].includes(a.type) && contentSize >= 50) {
        reasons.push('v4.0 前的老 type 仍有内容');
      }
      if (reasons.length > 0) {
        recoverable.push({
          id: a.id,
          notebookId: a.notebookId,
          type: a.type,
          stage: a.stage,
          title: a.title || '(无标题)',
          updatedAt: a.updatedAt || a.createdAt,
          status: a.status,
          contentSize,
          reasons,
        });
      }
    });

    // 写入 migrations 表登记 + workflowState._recoverable（供 UI 读）
    if (typeof db._writeData === 'function') {
      const next = db._readData();
      next.migrations = Array.isArray(next.migrations) ? next.migrations : [];
      next.migrations.push({
        id: MIGRATION_ID,
        version: MIGRATION_VERSION,
        runAt: new Date().toISOString(),
        recoverableCount: recoverable.length,
      });
      // 把 recoverable 列表挂到 globalState，让 UI 通过 IPC 取
      next.globalState = next.globalState || {};
      next.globalState._recoverable = recoverable;
      next.globalState._recoverableUpdatedAt = new Date().toISOString();
      db._writeData(next);
    }

    log.log(`[migration:${MIGRATION_ID}] 完成。扫描 ${artifacts.length} 个 artifact，发现 ${recoverable.length} 个可恢复项`);
    if (recoverable.length > 0) {
      log.warn(`[migration:${MIGRATION_ID}] ⚠ 老师反馈的「数据丢失」可能与此有关。详情见教师日志 → 🔍 找回历史数据`);
    }

    return { success: true, recoverableCount: recoverable.length, recoverable };
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
