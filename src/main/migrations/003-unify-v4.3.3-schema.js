/**
 * 003-unify-v4.3.3-schema.js
 *
 * v4.3.3 Sprint B 收口（2026-05-18）· Codex #8 响应
 *
 * 1/2 号 migration 只"找回数据"，没做完整 schema 转换。本 migration 把老数据规范化到 v4.3.3 契约。
 *
 * 转换内容（保守，不删除任何字段，只 normalize）：
 *   A. workflowStates 里 currentStage='framework' / unlockedStages 含 'framework'
 *      → currentStage='schedule' / unlockedStages 滤掉 'framework'
 *   B. artifact.type='micro_video_plan' 时加 alias 字段 _legacyType='micro_video_plan'，
 *      并把 type 改为 'video_prompt'（前端/workbench 统一查 video_prompt）
 *   C. artifact 缺 schemaVersion 时补 schemaVersion=1
 *   D. artifact 缺 dirty 时补 dirty=false
 *
 * 不改动：
 *   - 老 artifact 的 content / metadata
 *   - 已 confirmed 状态
 *   - 任何 design_doc 内容（001/002 已处理 weekRange 兼容）
 */

'use strict';

const MIGRATION_ID = '003-unify-v4.3.3-schema';
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

    let workflowFixed = 0;
    let typeFixed = 0;
    let schemaVersionFixed = 0;
    let dirtyFixed = 0;

    // A. workflowStates: framework → schedule
    if (Array.isArray(data.workflowStates)) {
      data.workflowStates = data.workflowStates.map((w) => {
        if (!w) return w;
        let changed = false;
        const next = { ...w };
        if (next.currentStage === 'framework') {
          next.currentStage = 'schedule';
          changed = true;
        }
        if (Array.isArray(next.unlockedStages) && next.unlockedStages.includes('framework')) {
          next.unlockedStages = next.unlockedStages.filter((s) => s !== 'framework');
          if (!next.unlockedStages.includes('schedule')) next.unlockedStages.unshift('schedule');
          changed = true;
        }
        if (changed) {
          next.migratedAt = new Date().toISOString();
          next.migratedFrom = 'framework';
          workflowFixed += 1;
        }
        return next;
      });
    }

    // B/C/D · artifacts
    if (Array.isArray(data.artifacts)) {
      data.artifacts = data.artifacts.map((a) => {
        if (!a || typeof a !== 'object') return a;
        const next = { ...a };
        let changed = false;
        // B · micro_video_plan → video_prompt
        if (next.type === 'micro_video_plan') {
          next._legacyType = 'micro_video_plan';
          next.type = 'video_prompt';
          changed = true;
          typeFixed += 1;
        }
        // C · 补 schemaVersion
        if (typeof next.schemaVersion !== 'number' || next.schemaVersion <= 0) {
          next.schemaVersion = 1;
          changed = true;
          schemaVersionFixed += 1;
        }
        // D · 补 dirty 字段
        if (next.dirty === undefined) {
          next.dirty = false;
          next.dirtyReason = null;
          next.dirtyAt = null;
          changed = true;
          dirtyFixed += 1;
        }
        // 同时 stage='framework' 也归到 schedule（极少数老 artifact）
        if (next.stage === 'framework') {
          next._legacyStage = 'framework';
          next.stage = 'schedule';
          changed = true;
        }
        if (changed) {
          next.updatedAt = new Date().toISOString();
        }
        return next;
      });
    }

    // 写 migration log
    data.migrations = Array.isArray(data.migrations) ? data.migrations : [];
    data.migrations.push({
      id: MIGRATION_ID,
      version: MIGRATION_VERSION,
      runAt: new Date().toISOString(),
      stats: { workflowFixed, typeFixed, schemaVersionFixed, dirtyFixed },
    });
    db._writeData(data);

    log.log(`[migration:${MIGRATION_ID}] 完成 · workflow framework→schedule: ${workflowFixed} · micro_video_plan→video_prompt: ${typeFixed} · 补 schemaVersion: ${schemaVersionFixed} · 补 dirty: ${dirtyFixed}`);

    return {
      success: true,
      stats: { workflowFixed, typeFixed, schemaVersionFixed, dirtyFixed },
    };
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
