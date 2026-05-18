/**
 * smoke-preload-bridge.js
 *
 * 交叉对照：preload bridge ↔ IPC handler ↔ frontend usage
 *
 * 验证：
 *   ① preload 的每个 ipcRenderer.invoke('v2:X', ...) 都有对应的主进程 ipcMain.handle('v2:X', ...)
 *   ② 前端代码用的 api.XXX() 都在 preload 里定义
 *   ③ 没有"孤儿" handler（注册了但没被前端调用）—— 这不算错，仅提示
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readAll(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...readAll(full, ext));
    else if (item.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// ── 收集所有 ipcMain.handle('xxx', ...) 的 channel 名 ──
const handlerFiles = [
  ...readAll(path.join(ROOT, 'src/main/ipc'), '.js'),
];
const handlerChannels = new Set();
for (const f of handlerFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const re = /ipcMain\.handle\(['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content))) handlerChannels.add(m[1]);
}

// ── 收集 preload 里 ipcRenderer.invoke('xxx', ...) 的 channel 名 + 函数名 ──
const preloadFile = path.join(ROOT, 'src/preload/index.js');
const preloadContent = fs.readFileSync(preloadFile, 'utf8');
const preloadInvokes = new Set();
const preloadApiFns = new Set();

const invokeRe = /ipcRenderer\.invoke\(['"]([^'"]+)['"]/g;
let m;
while ((m = invokeRe.exec(preloadContent))) preloadInvokes.add(m[1]);

const apiFnRe = /^\s*([a-zA-Z][a-zA-Z0-9_]*):\s*\(.*?\)\s*=>/gm;
while ((m = apiFnRe.exec(preloadContent))) preloadApiFns.add(m[1]);

// ── 收集前端 api.XXX() 用法 ──
const rendererFiles = readAll(path.join(ROOT, 'src/renderer'), '.jsx');
rendererFiles.push(...readAll(path.join(ROOT, 'src/renderer'), '.js'));
const usedApiFns = new Set();
for (const f of rendererFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const re = /\bapi\??\.([a-zA-Z][a-zA-Z0-9_]*)\b/g;
  let mm;
  while ((mm = re.exec(content))) usedApiFns.add(mm[1]);
}

// ── 校验 ──
console.log('=== preload ↔ IPC handler ↔ frontend 交叉对照 ===\n');

console.log(`主进程 IPC handlers：${handlerChannels.size} 个 channel`);
console.log(`preload invokes：${preloadInvokes.size} 个 channel`);
console.log(`preload 暴露的 api 函数：${preloadApiFns.size} 个`);
console.log(`前端用到的 api 函数：${usedApiFns.size} 个\n`);

const errors = [];
const warnings = [];

// ① preload 调用的 channel 必须存在 handler
console.log('① preload invoke 的 channel 是否都有 handler：');
let missingHandlers = 0;
for (const ch of preloadInvokes) {
  if (!handlerChannels.has(ch)) {
    errors.push(`preload 调 'ipcRenderer.invoke("${ch}")' 但主进程未注册`);
    missingHandlers++;
    console.log(`  ✗ ${ch}`);
  }
}
if (missingHandlers === 0) console.log(`  ✓ 全部 ${preloadInvokes.size} 个 channel 都有对应 handler`);

// ② 前端用的 api 函数必须在 preload 里定义
console.log('\n② 前端用的 api 函数是否都在 preload：');
let missingPreloadFns = 0;
const knownNonPreload = new Set(['then', 'catch', 'finally']);  // promise methods 误匹配
for (const fn of usedApiFns) {
  if (knownNonPreload.has(fn)) continue;
  if (!preloadApiFns.has(fn)) {
    errors.push(`前端调 'api.${fn}()' 但 preload 未定义`);
    missingPreloadFns++;
    console.log(`  ✗ api.${fn}`);
  }
}
if (missingPreloadFns === 0) console.log(`  ✓ 前端所有 api.* 调用都有 preload 定义`);

// ③ 孤儿 handler（注册了但 preload 没桥接）—— 仅 warning
console.log('\n③ 孤儿 handler（注册了但 preload 没用）：');
let orphan = 0;
for (const ch of handlerChannels) {
  if (!preloadInvokes.has(ch)) {
    warnings.push(`handler '${ch}' 已注册但 preload 没桥接`);
    orphan++;
  }
}
if (orphan === 0) console.log('  ✓ 无孤儿 handler');
else console.log(`  ⚠ ${orphan} 个孤儿 handler（可能旧代码或调试用，非错误）`);

// 总结
console.log('\n=== 结果 ===');
console.log(`错误：${errors.length}`);
console.log(`警告：${warnings.length}`);
if (errors.length > 0) {
  console.log('\n错误明细：');
  errors.forEach((e) => console.log('  - ' + e));
  process.exit(1);
} else {
  console.log('\n🎉 preload ↔ handler ↔ frontend 三方对照通过');
}
