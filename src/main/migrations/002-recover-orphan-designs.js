/**
 * 002-recover-orphan-designs.js
 *
 * v4.3.3 Sprint A.5 · P0-1 子任务（2026-05-18）
 *
 * 老师反馈：「我昨天用 4.1.4 生成了 36 个教学设计，现在没了」
 *
 * 根因分析（结合 db 实际数据 + bug retrospective）：
 *   - v4.1.4 schedule 字段：`{ week, lessonNumber, chapter, content, method, ... }`
 *   - v4.2.0 起 schedule 重构：`weekRange / lessonNumber / chapter / topic ...`，字段名变了
 *   - v4.1.4 创建的 design artifact 在 metadata 里写 `weekRange='第 5 周'` 形式
 *   - v4.2.0+ 的 design 创建器期望 `weekRange='第 3-4 周'` 形式 + lessonNumber 是数字
 *   - 老 design 的 weekRange 在新版本被前端"过滤"掉，但 DB 里没删
 *
 * 修复策略（保守）：
 *   - 不修改任何老 design artifact 字段
 *   - 仅扫描 → 把所有 design_doc 类型 artifact 标进 `globalState._recoverable`
 *     条件：metadata.lessonNumber 缺失 / weekRange 格式异常 / chapter 但没有 topic
 *   - 教师日志「🔍 找回历史数据」UI 已有，复用即可
 *   - 老师手动点「↩ 恢复」时，handler 会把 status 从 'deleted' / 'orphan' 改回 'draft'
 *
 * 与 001 的区别：
 *   - 001 处理通用孤儿 artifact（status='deleted' 但有内容 / framework_json 老 type）
 *   - 002 专门处理 design_doc 因 schedule schema 变化导致的"看似消失"
 *
 * 运行时机：每次 app 启动一次（migrations 数组防重）
 */

'use strict';

const MIGRATION_ID = '002-recover-orphan-designs';
const MIGRATION_VERSION = 1;

function isLegacyDesignSchema(metadata) {
  if (!metadata || typeof metadata !== 'object') return true;
  // v4.1.4 老格式特征：
  // 1. 没有 lessonNumber 字段（v4.0+ 必填）
  // 2. weekRange 是单周「第 N 周」而不是范围「第 X-Y 周」
  // 3. 有 chapter 但 topic 字段空
  if (!metadata.lessonNumber) return true;
  if (metadata.weekRange && !/-/.test(String(metadata.weekRange))
      && /第\s*\d+\s*周/.test(String(metadata.weekRange))) return true;
  if (metadata.chapter && !metadata.topic) return true;
  return false;
}

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

    const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
    const orphanDesigns = [];

    artifacts.forEach((a) => {
      if (a.type !== 'design_doc' || a.stage !== 'design') return;
      const contentSize = a.content
        ? (typeof a.content === 'string' ? a.content.length : JSON.stringify(a.content).length)
        : 0;
      if (contentSize < 100) return;  // 空内容跳过
      const isLegacy = isLegacyDesignSchema(a.metadata);
      // 是否在前端被过滤：
      // - status=deleted 必然不显示
      // - 没有 lessonNumber 大概率不显示（前端按 lessonNumber 分组）
      const likelyHidden = a.status === 'deleted' || !a.metadata?.lessonNumber;
      if (isLegacy && likelyHidden) {
        orphanDesigns.push({
          id: a.id,
          notebookId: a.notebookId,
          type: a.type,
          stage: a.stage,
          title: a.title || '(老 design · 无标题)',
          updatedAt: a.updatedAt || a.createdAt,
          status: a.status,
          contentSize,
          reasons: [
            'design_doc 但 metadata 不符合 v4.0+ 规范',
            !a.metadata?.lessonNumber ? '缺 lessonNumber' : null,
            a.metadata?.weekRange && !/-/.test(String(a.metadata?.weekRange)) ? `weekRange 老格式: ${a.metadata.weekRange}` : null,
            a.metadata?.chapter && !a.metadata?.topic ? '有 chapter 但无 topic' : null,
            a.status === 'deleted' ? 'status=deleted' : null,
          ].filter(Boolean),
        });
      }
    });

    // 把孤儿 design 合并进 globalState._recoverable
    if (typeof db._writeData === 'function') {
      const next = db._readData();
      next.migrations = Array.isArray(next.migrations) ? next.migrations : [];
      next.migrations.push({
        id: MIGRATION_ID,
        version: MIGRATION_VERSION,
        runAt: new Date().toISOString(),
        orphanDesignsCount: orphanDesigns.length,
      });
      next.globalState = next.globalState || {};
      const existing = Array.isArray(next.globalState._recoverable) ? next.globalState._recoverable : [];
      // 去重 by id
      const existingIds = new Set(existing.map((e) => Number(e.id)));
      const newOnes = orphanDesigns.filter((o) => !existingIds.has(Number(o.id)));
      next.globalState._recoverable = [...existing, ...newOnes];
      next.globalState._recoverableUpdatedAt = new Date().toISOString();
      db._writeData(next);
    }

    log.log(`[migration:${MIGRATION_ID}] 完成。扫描 ${artifacts.length} 个 artifact，发现 ${orphanDesigns.length} 个老格式 design_doc`);
    if (orphanDesigns.length > 0) {
      log.warn(`[migration:${MIGRATION_ID}] ⚠ 老师反馈的「4.1.4 → 4.3.x 36 个 design 没了」可能就是这些。教师日志「🔍 找回历史数据」可点恢复`);
    }

    return { success: true, orphanDesignsCount: orphanDesigns.length, orphanDesigns };
  } catch (err) {
    log.error(`[migration:${MIGRATION_ID}] 失败:`, err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  MIGRATION_ID,
  MIGRATION_VERSION,
  run,
  isLegacyDesignSchema,  // 暴露给测试
};
