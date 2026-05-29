/**
 * 005-backfill-metadata-lessonnumber.js
 *
 * v4.3.3 · Codex 老师反馈审计第 1 轮（2026-05-29）
 *
 * 根因：createArtifact 此前未保存 metadata 字段（已修），导致历史 artifact 的
 * metadata.lessonNumber 全部丢失。但节次信息其实散落在：
 *   - content.lessonMeta.lessonNumber
 *   - content.lessonContext.lessonNumber
 *   - metadata.lessonContext.lessonNumber（若曾通过 update 写入）
 *
 * 本 migration 把这些来源回填到 metadata.lessonNumber，让 quiz/homework/ppt/lecture/report
 * 的按节匹配在老数据上也能恢复（否则测验/作业会报"本节尚无 PPT/讲稿"或串课）。
 *
 * 只回填"缺 metadata.lessonNumber 但 content 能解析出节次"的 artifact，幂等。
 */

'use strict';

const MIGRATION_ID = '005-backfill-metadata-lessonnumber';
const MIGRATION_VERSION = 1;

// 与 src/main/v2/artifact-lesson.js 的解析优先级保持一致（此处内联，避免 migration 依赖运行时模块）
function resolveLessonNumber(a) {
  const md = a.metadata || {};
  const content = a.content || {};
  const candidates = [
    md.lessonNumber,
    md.lessonContext && md.lessonContext.lessonNumber,
    content.lessonMeta && content.lessonMeta.lessonNumber,
    content.lessonContext && content.lessonContext.lessonNumber,
    content.metadata && content.metadata.lessonNumber,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

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

    let fixed = 0;
    let alreadyOk = 0;
    if (Array.isArray(data.artifacts)) {
      data.artifacts = data.artifacts.map((a) => {
        if (!a || typeof a !== 'object') return a;
        const md = (a.metadata && typeof a.metadata === 'object') ? a.metadata : {};
        // 已有正整数 metadata.lessonNumber → 跳过
        if (Number.isFinite(Number(md.lessonNumber)) && Number(md.lessonNumber) > 0) {
          alreadyOk += 1;
          return a;
        }
        const ln = resolveLessonNumber(a);
        if (ln === null) return a; // content 也解析不出节次（如 schedule_table 整门课产物）→ 不动
        fixed += 1;
        return { ...a, metadata: { ...md, lessonNumber: ln } };
      });
    }

    migrations.push({ id: MIGRATION_ID, version: MIGRATION_VERSION, ranAt: new Date().toISOString(), fixed, alreadyOk });
    data.migrations = migrations;
    db._writeData(data);

    log.log(`[migration:${MIGRATION_ID}] 完成 · 回填 ${fixed} 个 artifact 的 metadata.lessonNumber（已正确 ${alreadyOk} 个）`);
    return { success: true, stats: { fixed, alreadyOk } };
  } catch (e) {
    log.error(`[migration:${MIGRATION_ID}] 异常:`, e.message);
    return { success: false, error: e.message };
  }
}

module.exports = { run, MIGRATION_ID, MIGRATION_VERSION };
