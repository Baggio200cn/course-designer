/**
 * smoke-feature-trace.js
 *
 * 端到端静态 trace：6 个修复点的"前端调用 → preload bridge → IPC handler → service"完整链路是否成对
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cache = {};
function read(file) {
  if (!cache[file]) cache[file] = fs.readFileSync(file, 'utf8');
  return cache[file];
}

function check(label, frontPattern, frontFile, preloadFn, channel, handlerFile, servicePattern, serviceFile) {
  const errors = [];
  const tick = (b) => b ? '✓' : '✗';

  // ① 前端有这个调用
  if (frontPattern && frontFile) {
    const frontOk = new RegExp(frontPattern).test(read(path.join(ROOT, frontFile)));
    if (!frontOk) errors.push(`前端 ${frontFile} 没有 ${frontPattern}`);
  }

  // ② preload 定义了这个 fn → 这个 channel
  if (preloadFn && channel) {
    const preloadOk = new RegExp(`${preloadFn}\\s*:\\s*\\([^)]*\\)\\s*=>\\s*ipcRenderer\\.invoke\\(['"]${channel}['"]`).test(read(path.join(ROOT, 'src/preload/index.js')));
    if (!preloadOk) errors.push(`preload 没把 ${preloadFn} → ${channel}`);
  }

  // ③ handler 注册了这个 channel
  if (channel && handlerFile) {
    const handlerOk = new RegExp(`ipcMain\\.handle\\(['"]${channel}['"]`).test(read(path.join(ROOT, handlerFile)));
    if (!handlerOk) errors.push(`${handlerFile} 没注册 ${channel}`);
  }

  // ④ handler/相关文件 调了对应 service
  if (servicePattern && serviceFile && handlerFile) {
    const serviceOk = new RegExp(servicePattern).test(read(path.join(ROOT, handlerFile)));
    if (!serviceOk) errors.push(`${handlerFile} 没引用 service ${servicePattern}`);
    const serviceFileOk = fs.existsSync(path.join(ROOT, serviceFile));
    if (!serviceFileOk) errors.push(`service 文件不存在 ${serviceFile}`);
  }

  console.log(`${tick(errors.length === 0)} [${label}]`);
  if (errors.length) errors.forEach((e) => console.log(`    ↳ ${e}`));
  return errors.length === 0;
}

console.log('=== 6 大修复点的端到端链路检查 ===\n');

const results = [];

// 1. 问题 4.1：宽容解析进度表 JSON
results.push(check(
  '4.1 宽容解析',
  'validateScheduleJsonV2',                       // 前端调用
  'src/renderer/src/v2/V2App.jsx',
  'validateScheduleJsonV2',                       // preload fn
  'v2:validateScheduleJson',                      // channel
  'src/main/ipc/v2/schedule.handlers.js',         // handler
  'tolerantParseSchedule',                        // service 调用
  'src/main/services/schedule.service.js'         // service 文件
));

// 2. 问题 4.4：diagram 学时 grounding
results.push(check(
  '4.4 diagram 学时',
  'generateDiagram\\(',
  'src/main/ipc/media.handlers.js',
  'generateDiagramV2',                            // (前端用 generateDiagramV2)
  'v2:generateDiagram',
  'src/main/ipc/media.handlers.js',
  "require\\(['\"]\\.\\./services/diagram\\.service['\"]",
  'src/main/services/diagram.service.js'
));

// 3. 问题 4.7 + P2-4：删除节课
results.push(check(
  '4.7 + P2-4 删除节课',
  'deleteDesignLessonV2',
  'src/renderer/src/v2/V2App.jsx',
  'deleteDesignLessonV2',
  'v2:deleteDesignLesson',
  'src/main/ipc/v2/design.handlers.js',
  null, null
));

// 4. P2-4：恢复节课
results.push(check(
  'P2-4 回收站恢复',
  'restoreDesignLessonV2',
  'src/renderer/src/v2/V2App.jsx',
  'restoreDesignLessonV2',
  'v2:restoreDesignLesson',
  'src/main/ipc/v2/design.handlers.js',
  null, null
));

// 5. 问题一 B：相关性过滤层
results.push(check(
  '问题一 B 相关性过滤',
  "require\\(['\"]\\.\\./\\.\\./services/reference-filter\\.service['\"]",
  'src/main/ipc/v2/lesson.handlers.js',
  'lessonGenerateABCV2',
  'v2:lessonGenerateABC',
  'src/main/ipc/v2/lesson.handlers.js',
  'filterByRelevance',
  'src/main/services/reference-filter.service.js'
));

// 6. 问题三 F + P2-3：动态练习生成 + 重建 HTML
// 链路 1：pipeline 自动生成（在 ppt-pipeline-v2.js 内）
results.push(check(
  '问题三 F 动态练习（自动生成）',
  'generateDynamicExercise',
  'src/main/script/ppt-pipeline-v2.js',
  null, null, null,
  null,
  'src/main/services/ppt-dynamic-exercise.service.js'
));
// 链路 2：老师编辑后重建 HTML
results.push(check(
  'P2-3 练习重建 HTML',
  'rebuildExerciseHtmlV2',
  'src/renderer/src/v2/PptStage.jsx',
  'rebuildExerciseHtmlV2',
  'v2:rebuildExerciseHtml',
  'src/main/ipc/v2/ppt.handlers.js',
  'buildExerciseHtml',
  'src/main/services/ppt-dynamic-exercise.service.js'
));

// 7. 问题二：PPT 双阶段 + P2-5 进度推送
results.push(check(
  '问题二 PPT 双阶段',
  'generatePptPlanV2',
  'src/main/ipc/v2/ppt.handlers.js',
  'generatePptPlanV2',
  'v2:generatePptPlan',
  'src/main/ipc/v2/ppt.handlers.js',
  null, null
));

// 8. P2-5：进度事件监听
results.push(check(
  'P2-5 进度事件',
  'onPptProgress',
  'src/renderer/src/v2/PptStage.jsx',
  null,                                            // 这是事件订阅，不是 invoke
  null,
  null,
  null, null
));

// 总结
const failed = results.filter((r) => !r).length;
console.log(`\n=== ${results.length - failed}/${results.length} 链路完整 ===`);
if (failed > 0) process.exit(1);
