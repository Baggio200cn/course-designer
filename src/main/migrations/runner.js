/**
 * runner.js — v4.3.3 Codex Round 10 P0 修复（2026-05-19）
 *
 * 抽出 migration 扫描 + 执行逻辑，从 index.js 内联调用解耦。
 * 解决根因：index.js 旧逻辑写在 db 实例化前 → migration 全部 "db 不可用，跳过"。
 *
 * 用法：
 *   const { runMigrations } = require('./migrations/runner');
 *   runMigrations(db, { migrationDir, log });
 *
 * 设计原则：
 *   - 必须接受已实例化的 db（不内部假设全局 db）
 *   - 失败容错（单个 migration fail 不阻断其他）
 *   - 返回 { success, total, executed, skipped, failed, results }
 *   - 同步执行（migration 体本身可能写文件，需要 IO 完成）
 */

'use strict';

const fs = require('fs');
const path = require('path');

function runMigrations(db, options = {}) {
  const log = options.log || console;
  const migrationDir = options.migrationDir || path.join(__dirname);  // 默认本目录

  if (!db || typeof db._readData !== 'function') {
    log.warn('[migrations:runner] db 未实例化或缺 _readData，跳过全部 migration');
    return { success: false, total: 0, executed: 0, skipped: 0, failed: 0, error: 'db unavailable', results: [] };
  }

  if (!fs.existsSync(migrationDir)) {
    log.warn('[migrations:runner] 目录不存在:', migrationDir);
    return { success: false, total: 0, executed: 0, skipped: 0, failed: 0, error: 'directory not found', results: [] };
  }

  const migrationFiles = fs.readdirSync(migrationDir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_') && f !== 'runner.js' && f !== 'README.js')
    .sort();

  const results = [];
  let executed = 0;
  let skipped = 0;
  let failed = 0;

  migrationFiles.forEach((f) => {
    const fullPath = path.join(migrationDir, f);
    try {
      const m = require(fullPath);
      if (typeof m.run !== 'function') {
        log.warn(`[migrations:runner] ${f} 缺 run 函数，跳过`);
        results.push({ file: f, status: 'invalid', reason: 'no run function' });
        return;
      }
      const result = m.run(db, log);
      if (result?.skipped) {
        skipped += 1;
        results.push({ file: f, status: 'skipped', migrationId: m.MIGRATION_ID });
      } else if (result?.success === false) {
        failed += 1;
        results.push({ file: f, status: 'failed', migrationId: m.MIGRATION_ID, error: result.error });
        log.error(`[migrations:runner] ${f} 业务失败:`, result.error);
      } else {
        executed += 1;
        results.push({ file: f, status: 'executed', migrationId: m.MIGRATION_ID, stats: result?.stats || result });
      }
      // 提示可恢复 artifact 数量
      if (result?.recoverableCount > 0) {
        log.warn(`[migrations:runner] ⚠ ${result.recoverableCount} 个 artifact 可恢复（${f}）`);
      }
    } catch (e) {
      failed += 1;
      results.push({ file: f, status: 'failed', error: e.message });
      log.error(`[migrations:runner] ${f} 加载/执行异常:`, e.message);
    }
  });

  const total = migrationFiles.length;
  log.log(`[migrations:runner] 完成 · 总 ${total} · 执行 ${executed} · 跳过 ${skipped} · 失败 ${failed}`);
  return { success: failed === 0, total, executed, skipped, failed, results };
}

module.exports = { runMigrations };
