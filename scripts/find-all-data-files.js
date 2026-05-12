/**
 * 诊断脚本：找出系统里所有 course-designer-data.json，对比内容定位"真实数据文件"。
 *
 * 起因：dry-run 找到 Electron\course-designer-data.json，但里面没 ark_endpoint_text 配置，
 *       而 npm run dev 跑出来的日志却命中了 ark_endpoint_text_deepseek=ep-20260302100227-7vbtm。
 *       说明存在多个 data.json，应用实际用的不是 dry-run 看的那个。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const appData = process.env.APPDATA || '';
if (!appData) {
  console.error('找不到 APPDATA，无法扫描');
  process.exit(1);
}

console.log('扫描 APPDATA：', appData);
console.log('查找所有 course-designer-data.json...\n');

const dirs = fs.readdirSync(appData, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const found = [];
for (const dir of dirs) {
  const p = path.join(appData, dir, 'course-designer-data.json');
  if (fs.existsSync(p)) {
    const stat = fs.statSync(p);
    found.push({ dir, fullPath: p, size: stat.size, mtime: stat.mtime });
  }
}

if (found.length === 0) {
  console.log('❌ 没找到任何 course-designer-data.json');
  process.exit(1);
}

// 按修改时间倒序（最新的在最前）
found.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

console.log(`共找到 ${found.length} 个文件：\n`);
for (const f of found) {
  console.log(`📁 ${f.dir}/course-designer-data.json`);
  console.log(`   完整路径：${f.fullPath}`);
  console.log(`   大小：${f.size} 字节`);
  console.log(`   最后修改：${f.mtime.toISOString()}（${f.mtime.toLocaleString('zh-CN')}）`);

  try {
    const data = JSON.parse(fs.readFileSync(f.fullPath, 'utf8'));
    const settings = data.settings || {};
    const arkKeys = Object.keys(settings)
      .filter((k) => k.startsWith('api_key_') && !k.endsWith('_encrypted') && !k.endsWith('_updated_at'));

    console.log(`   ark_*/deepseek api_key_* 配置（${arkKeys.length} 个）：`);
    for (const k of arkKeys) {
      let v = settings[k];
      let display = v;
      if (typeof v === 'string' && settings[`${k}_encrypted`]) {
        try {
          const decoded = Buffer.from(v, 'base64').toString('utf8');
          display = decoded.length > 12
            ? decoded.slice(0, 8) + '...' + decoded.slice(-4)
            : decoded;
        } catch {}
      }
      console.log(`     • ${k.replace(/^api_key_/, '')} = ${display}`);
    }
    console.log(`   notebook 数：${(data.notebooks || []).length}`);
  } catch (e) {
    console.log(`   ⚠️ JSON 解析失败：${e.message}`);
  }
  console.log('');
}

console.log('═══════════════════════════════════════════');
console.log('建议：');
console.log('  • 最新修改时间的那个文件，就是 npm run dev 当前正在用的真实数据文件。');
console.log('  • 看哪个文件里有 ark_endpoint_text_deepseek 这条 key，就是要清理的目标。');
console.log('  • 把目标文件路径告诉 Claude，下一步专门清理它。');
