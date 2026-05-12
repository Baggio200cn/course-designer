/**
 * reset-for-phase9.js — Phase-9 升级前的数据清理脚本
 *
 * 执行内容：
 *   1. 清空 JSON 数据文件的所有 notebook / artifact / module / operation 数据
 *   2. 提示用户手动删除老工作区目录（不自动删，避免误删）
 *
 * 用法：node scripts/reset-for-phase9.js
 *
 * ⚠️ 警告：
 *   - 此脚本会清空所有现有课程数据，不可恢复
 *   - 仅在 Phase-9 升级前运行一次（用户已批准 2026-05-09）
 *   - 跑完后启动新版（驭课 Agent v4.0.0），从全新 6 阶段流程重新开始
 *
 * 数据存储说明（驭课 Agent 用的是 JSON 文件，不是 SQLite）：
 *   位置：%APPDATA%\Roaming\ai-course-designer\course-designer-data.json
 *   结构：{ notebooks:[], artifacts:[], modules:[], operations:[], settings:{...} }
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const DB_PATH = path.join(
  os.homedir(),
  'AppData', 'Roaming', 'ai-course-designer',
  'course-designer-data.json'
);

const OLD_WORKSPACE = path.join(os.homedir(), 'Documents', '课程开发助手工作区');
const NEW_WORKSPACE = path.join(os.homedir(), 'Documents', '驭课Agent工作区');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Phase-9 数据清理脚本（驭课 Agent v4.0.0 升级前用）');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ── 1. JSON 数据文件清理 ──
if (!fs.existsSync(DB_PATH)) {
  console.log('⚠️  数据文件不存在：');
  console.log(`   ${DB_PATH}`);
  console.log('   说明 v3.x 从未启动过，跳过数据清理\n');
} else {
  const sizeKB = (fs.statSync(DB_PATH).size / 1024).toFixed(1);
  console.log(`找到数据文件：${DB_PATH}（${sizeKB} KB）\n`);

  // 备份原数据到 .bak（防误删后悔）
  const backupPath = DB_PATH + '.before-phase9-' + Date.now() + '.bak';
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`💾 已备份原数据到：`);
  console.log(`   ${backupPath}\n`);

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const normalized = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    const data = JSON.parse(normalized);

    // 业务数据：清空，但保留 settings（API Key 等用户配置）
    const dataKeys = ['notebooks', 'artifacts', 'modules', 'operations', 'task_runtime', 'agent_memories', 'teaching_schedules'];
    let totalCleared = 0;

    for (const key of dataKeys) {
      if (Array.isArray(data[key])) {
        const before = data[key].length;
        data[key] = [];
        if (before > 0) {
          console.log(`  ✅ ${key}：清空 ${before} 条`);
          totalCleared += before;
        } else {
          console.log(`  ⏭️  ${key}：本来就是空的`);
        }
      } else if (data[key] !== undefined) {
        console.log(`  ⏭️  ${key}：非数组类型，跳过`);
      }
    }

    // 写回
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    console.log(`\n✅ 数据清理完成，共清空 ${totalCleared} 条业务数据`);
    console.log('   保留：settings 配置（API Key / 4 个 Endpoint / 用户偏好）\n');
  } catch (e) {
    console.error('❌ 清理失败：', e.message);
    console.error('   备份文件已存在，可手动恢复：' + backupPath);
    process.exit(1);
  }
}

// ── 2. 老工作区目录提示（不自动删） ──
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('工作区目录（老师产物文件——本脚本不自动删，由你决定）');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (fs.existsSync(OLD_WORKSPACE)) {
  console.log(`📂 老工作区存在（v3.x 用的）：`);
  console.log(`   ${OLD_WORKSPACE}\n`);
  console.log(`   建议手动操作：`);
  console.log(`   ① 备份重要 docx/pptx 到桌面（如果还有用）`);
  console.log(`   ② 删除整个目录`);
  console.log(`\n   PowerShell 删除命令（确认无重要文件后再跑）：`);
  console.log(`   Remove-Item -Recurse -Force "${OLD_WORKSPACE}"\n`);
} else {
  console.log(`⚠️  老工作区不存在（v3.x 从未生成过课程文件，无需清理）\n`);
}

console.log(`📂 新工作区（v4.0.0 起用）：`);
console.log(`   ${NEW_WORKSPACE}`);
console.log(`   首次启动驭课 Agent v4.0.0 时会自动创建\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Phase-9 清理完成。下一步：');
console.log('  1. 手动删除老工作区目录（如果不要了）');
console.log('  2. 启动 npm run dev 验证 v4.0.0 改名生效');
console.log('  3. 等阶段 B/C/D 完成后，从全新 6 阶段流程重新建课程');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
