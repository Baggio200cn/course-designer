/**
 * smoke-boot.js
 *
 * 主进程 headless 启动烟雾测试：
 *   - 不启动 Electron BrowserWindow
 *   - 但 require 所有 ipc/v2/*.handlers.js 文件
 *   - 模拟 ipcMain.handle 收集所有注册的 channel 名
 *   - 检查：① 每个文件可加载 ② 每个 register() 可调用 ③ channel 名列表正确
 */
const path = require('path');
const fs = require('fs');

console.log('=== 主进程 headless boot 测试 ===\n');

// ── Step 1: 模拟 electron 模块 ───────────────────────────
const channels = [];
const fakeIpcMain = {
  handle(channel, fn) {
    if (typeof fn !== 'function') throw new Error(`channel ${channel} 注册的不是函数`);
    channels.push(channel);
  },
};

// Mock the electron module before any handler requires it
const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake_electron.js');
  return originalResolve.call(this, request, parent, ...args);
};

// 写一个临时 fake electron 模块
const fakeElectronPath = path.join(__dirname, '_fake_electron.js');
fs.writeFileSync(fakeElectronPath, `
module.exports = {
  ipcMain: { handle: (channel, fn) => { global.__channels__.push(channel); } },
  app: { getPath: () => '/tmp', getAppPath: () => process.cwd() },
  dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) },
  BrowserWindow: function() { this.loadURL = () => {}; this.webContents = { send: () => {} }; },
  shell: { openPath: async () => '', openExternal: async () => true },
};
`);
global.__channels__ = channels;

// ── Step 2: require all ipc/v2 handlers ────────────────
const v2HandlersDir = path.join(__dirname, '..', 'src/main/ipc/v2');
const handlerFiles = fs.readdirSync(v2HandlersDir).filter((f) => f.endsWith('.handlers.js'));

console.log(`扫描 ${handlerFiles.length} 个 v2 handler 文件：\n`);

const errors = [];
const handlerStats = [];

for (const file of handlerFiles) {
  const fullPath = path.join(v2HandlersDir, file);
  const beforeCount = channels.length;
  try {
    delete require.cache[fullPath];
    const mod = require(fullPath);
    if (typeof mod.register !== 'function') {
      errors.push(`${file}：缺 register() 导出`);
      continue;
    }
    // 调用 register（用 fake ipcMain + fake getDeps）
    mod.register(fakeIpcMain, () => ({
      db: { listArtifacts: () => [], createArtifact: () => ({ id: 0 }), updateArtifact: () => ({}), getNotebookById: () => null, deleteArtifact: () => true },
      app: { getPath: () => '/tmp' },
      v2Runtime: { getLectureStageData: async () => ({}), saveLectureStage: async () => ({}), confirmLectureStage: async () => ({}) },
      ensureNotebookWorkspaceState: (x) => x,
      ensureNotebookWorkspaceDirs: () => '/tmp/ws',
    }));
    const newChannels = channels.length - beforeCount;
    handlerStats.push({ file, channels: newChannels });
    console.log(`  ✓ ${file} → 注册 ${newChannels} 个 channel`);
  } catch (e) {
    errors.push(`${file}：${e.message}`);
    console.log(`  ✗ ${file} → ${e.message}`);
  }
}

// ── Step 2.5: 也 require ipc 根目录的 handlers（如 media.handlers）─
console.log('\n扫描 ipc/ 根目录的 handlers：');
const rootIpcDir = path.join(__dirname, '..', 'src/main/ipc');
const rootHandlerFiles = fs.readdirSync(rootIpcDir).filter((f) => f.endsWith('.handlers.js'));
for (const file of rootHandlerFiles) {
  const fullPath = path.join(rootIpcDir, file);
  const beforeCount = channels.length;
  try {
    delete require.cache[fullPath];
    const mod = require(fullPath);
    if (typeof mod.register !== 'function') {
      console.log(`  · ${file}（无 register，跳过）`);
      continue;
    }
    mod.register(fakeIpcMain, () => ({
      db: { listArtifacts: () => [], createArtifact: () => ({ id: 0 }), updateArtifact: () => ({}), getNotebookById: () => null, deleteArtifact: () => true, getModulesByNotebook: () => [] },
      app: { getPath: () => '/tmp' },
      ensureNotebookWorkspaceState: (x) => x,
      ensureNotebookWorkspaceDirs: () => '/tmp/ws',
    }));
    console.log(`  ✓ ${file} → 注册 ${channels.length - beforeCount} 个 channel`);
  } catch (e) {
    errors.push(`ipc/${file}：${e.message}`);
    console.log(`  ✗ ${file} → ${e.message}`);
  }
}

// ── Step 3: 也 require 所有 service 文件 ───────────────
console.log('\n扫描 services：');
const servicesDir = path.join(__dirname, '..', 'src/main/services');
const serviceFiles = fs.readdirSync(servicesDir).filter((f) => f.endsWith('.service.js'));
for (const file of serviceFiles) {
  const fullPath = path.join(servicesDir, file);
  try {
    delete require.cache[fullPath];
    require(fullPath);
    console.log(`  ✓ ${file}`);
  } catch (e) {
    errors.push(`services/${file}：${e.message}`);
    console.log(`  ✗ ${file} → ${e.message}`);
  }
}

// ── Step 4: 检查 channels 是否覆盖我新加的 ───────────
console.log('\n关键新增 channel 是否注册：');
const expectedChannels = [
  'v2:saveSchedule',
  'v2:validateScheduleJson',         // P2-1
  'v2:deleteDesignLesson',           // 4.7
  'v2:listDeletedDesignLessons',     // P2-4
  'v2:restoreDesignLesson',          // P2-4
  'v2:lessonGenerateABC',            // 问题一
  'v2:lessonGenerateFormal',         // 问题一
  'v2:generatePptPlan',              // 问题二
  'v2:rebuildExerciseHtml',          // P2-3
  'v2:generateDiagram',              // 4.4
];
for (const c of expectedChannels) {
  if (channels.includes(c)) console.log(`  ✓ ${c}`);
  else { errors.push(`channel 未注册：${c}`); console.log(`  ✗ ${c} 未注册`); }
}

// 清理
try { fs.unlinkSync(fakeElectronPath); } catch (_) {}

// ── 总结 ───────────────────────────────────────────────
console.log('\n=== 结果 ===');
console.log(`Handler 文件：${handlerFiles.length} 个，共注册 ${channels.length} 个 IPC channel`);
console.log(`Service 文件：${serviceFiles.length} 个`);
console.log(`错误数：${errors.length}`);
if (errors.length > 0) {
  console.log('\n失败明细：');
  errors.forEach((e) => console.log('  - ' + e));
  process.exit(1);
} else {
  console.log('\n🎉 主进程所有 v2 handlers + services 加载干净 + 关键 channel 全部注册');
}
