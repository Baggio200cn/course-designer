/**
 * Phase-7.7 B5：清理 JSON 数据文件里残留的 deepseek 时代 key（zero-deps 版）。
 *
 * 真相：本项目不用 SQLite，是 JSON 文件存储（src/main/database/db-simple.js）。
 * 设置存在 data.settings.api_key_${provider}（base64 encoded）+ ${...}_encrypted + ${...}_updated_at。
 *
 * 本脚本：
 *   1. 自动查找数据文件（productName / name / 自定义路径都试）
 *   2. 备份原文件到 .bak
 *   3. 删除 deepseek 残留 key
 *   4. 写回 + 打印对账日志
 *
 * 用法：node scripts/clean-legacy-deepseek-keys.js
 *      node scripts/clean-legacy-deepseek-keys.js --dry-run    # 只看不改
 */
'use strict';

const fs = require('fs');
const path = require('path');

const dryRun = process.argv.includes('--dry-run');

// 支持 --target=<完整路径> 显式指定数据文件（优先级最高）
let dbFile = null;
const targetArg = process.argv.find((a) => a.startsWith('--target='));
if (targetArg) {
  dbFile = targetArg.replace(/^--target=/, '').trim();
  if (!fs.existsSync(dbFile)) {
    console.error('❌ --target 指定的文件不存在：', dbFile);
    process.exit(1);
  }
  console.log('使用 --target 指定文件：', dbFile);
}

// ── 自动找：扫所有候选，选 mtime 最新的（Phase-7.7 B5 改进）────
if (!dbFile) {
  const appData = process.env.APPDATA || '';
  if (!appData) {
    console.error('❌ APPDATA 未设置，无法自动定位数据文件。请用 --target=<路径> 显式指定。');
    process.exit(1);
  }

  const found = [];
  try {
    for (const d of fs.readdirSync(appData, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(appData, d.name, 'course-designer-data.json');
      if (fs.existsSync(p)) {
        found.push({ path: p, mtime: fs.statSync(p).mtime });
      }
    }
  } catch (e) {
    console.error('❌ 扫描 APPDATA 失败：', e.message);
    process.exit(1);
  }

  if (found.length === 0) {
    console.error('❌ APPDATA 下找不到任何 course-designer-data.json');
    process.exit(1);
  }

  // 按 mtime 倒序，最新的在前
  found.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (found.length > 1) {
    console.log(`⚠️ 检测到 ${found.length} 个数据文件，自动选最新修改的那个：\n`);
    found.forEach((f, i) => {
      console.log(`  ${i === 0 ? '✅' : '  '} ${f.mtime.toISOString()} ${f.path}`);
    });
    console.log('\n如果选错了，请用 --target=<完整路径> 显式指定。\n');
  }

  dbFile = found[0].path;
}

console.log('数据文件：', dbFile);
const stat = fs.statSync(dbFile);
console.log('文件大小：', stat.size, '字节');

// ── 读取 ──────────────────────────────────────────────────────
const raw = fs.readFileSync(dbFile, 'utf8');
let data;
try { data = JSON.parse(raw); } catch (e) {
  console.error('❌ JSON 解析失败：', e.message);
  process.exit(1);
}

if (!data.settings || typeof data.settings !== 'object') {
  console.error('❌ data.settings 不是对象，文件结构可能损坏');
  process.exit(1);
}

// ── 打印当前 ark_* 配置 ────────────────────────────────────────
const arkKeys = Object.keys(data.settings).filter((k) => k.startsWith('api_key_ark') || k.startsWith('api_key_deepseek'));

console.log('\n清理前 settings 里的 ark/deepseek 相关 key：');
if (arkKeys.length === 0) {
  console.log('  （无）');
} else {
  arkKeys.forEach((k) => {
    let v = data.settings[k];
    let display = v;
    // base64 encoded 的 key 试图解码显示前 8 + 后 4
    if (k.endsWith('_encrypted') || k.endsWith('_updated_at')) {
      display = String(v);
    } else if (typeof v === 'string' && data.settings[`${k}_encrypted`]) {
      try {
        const decoded = Buffer.from(v, 'base64').toString('utf8');
        display = decoded.length > 12
          ? decoded.slice(0, 8) + '...' + decoded.slice(-4)
          : decoded;
      } catch { display = '(无法解码)'; }
    }
    console.log(`  ${k} = ${display}`);
  });
}

// ── 清理目标 ──────────────────────────────────────────────────
// saveApiKey('ark_endpoint_text_deepseek', xxx) 会写 3 个 entry：
//   api_key_ark_endpoint_text_deepseek         (base64 value)
//   api_key_ark_endpoint_text_deepseek_encrypted = true
//   api_key_ark_endpoint_text_deepseek_updated_at = ISO
// 全部清掉。
const targets = ['ark_endpoint_text_deepseek', 'ark_model_text_default'];
let deletedCount = 0;
const deletedKeys = [];

for (const t of targets) {
  for (const suffix of ['', '_encrypted', '_updated_at']) {
    const fullKey = `api_key_${t}${suffix}`;
    if (Object.prototype.hasOwnProperty.call(data.settings, fullKey)) {
      if (!dryRun) delete data.settings[fullKey];
      deletedKeys.push(fullKey);
      deletedCount++;
    }
  }
}

if (deletedCount === 0) {
  console.log('\n— 无任何旧 key 需要清理（已干净状态）。');
  process.exit(0);
}

console.log(`\n${dryRun ? '[dry-run] 将' : '已'}删除以下 entry：`);
deletedKeys.forEach((k) => console.log(`  - ${k}`));

if (dryRun) {
  console.log('\n--dry-run 模式，未写入。重跑去掉 --dry-run 即可执行。');
  process.exit(0);
}

// ── 备份 + 写回 ───────────────────────────────────────────────
const backupFile = dbFile + '.bak.' + Date.now();
fs.copyFileSync(dbFile, backupFile);
console.log('\n已备份原文件到：', backupFile);

fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
console.log('✅ 已写入新文件，删除', deletedCount, '条 entry。');

// ── 重新读取确认 ──────────────────────────────────────────────
const verifyData = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const remainingArk = Object.keys(verifyData.settings).filter((k) => k.startsWith('api_key_ark') || k.startsWith('api_key_deepseek'));

console.log('\n清理后剩余的 ark/deepseek key：');
remainingArk.forEach((k) => {
  if (k.endsWith('_encrypted') || k.endsWith('_updated_at')) return; // 不展示元数据
  const v = verifyData.settings[k];
  if (typeof v === 'string' && verifyData.settings[`${k}_encrypted`]) {
    try {
      const decoded = Buffer.from(v, 'base64').toString('utf8');
      const display = decoded.length > 12
        ? decoded.slice(0, 8) + '...' + decoded.slice(-4)
        : decoded;
      console.log(`  ${k} = ${display}`);
    } catch { console.log(`  ${k} = (无法解码)`); }
  } else {
    console.log(`  ${k} = ${v}`);
  }
});

console.log('\n下一步：');
console.log('  1. 重启应用：在跑 npm run dev 的窗口按 Ctrl+C，然后 npm run dev');
console.log('  2. 触发一次 AI 调用（点 Agent 一键生成）');
console.log('  3. 期望终端日志：[provider-config] model=doubao_text endpoint=ep-m-20260327105914-k629s from=db.ark_endpoint_text');
