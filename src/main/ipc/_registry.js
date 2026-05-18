/**
 * IPC Handler 注册中心
 *
 * 使用方式：
 *   const { registerAll } = require('./ipc/_registry');
 *   registerAll(ipcMain, getDeps);
 *
 * getDeps 是一个惰性求值函数：() => { db, app, ...services, ...helpers }
 * 在 handler 实际被调用时（而非注册时）执行，确保 db 等资源已初始化。
 *
 * 迁移进度（Phase-5A）：
 *   [x] notebook.handlers.js  — 6 handlers（+notebook:update, notebook:generateResearch）
 *   [x] module.handlers.js    — 7 handlers
 *   [x] framework.handlers.js — 7 handlers（含 ai:generateFramework）
 *   [x] course.handlers.js    — 6 handlers
 *   [x] lecture.handlers.js   — 4 handlers（含 script:generate* + quality:audit*）
 *   [x] v2/framework.handlers.js — 4 handlers
 *   [x] v2/lecture.handlers.js  — 3 handlers
 *   [x] v2/ppt.handlers.js      — 4 handlers
 *   [x] v2/video.handlers.js    — 7 handlers（含 workflow/artifact/event）
 *   [x] export.handlers.js    — 9 handlers（word/ppt/quiz/html/pbl/zip + knowledge-cards）
 *   [x] resource.handlers.js  — 11 handlers
 *   [x] media.handlers.js     — 9 handlers（含 v2:generateFrameworkInfographic + v2:generateDiagram + v2:getInfographicOptions）
 *   [x] prompt.handlers.js    — 8 handlers（legacy disabled，保留完整逻辑）
 *   [x] system.handlers.js    — 7 handlers（schedule/settings/util/workspace）
 *   [x] agent.handlers.js    — 2 handlers（agent:run, agent:getStatus）Phase-5C
 */

const notebookHandlers = require('./notebook.handlers');
const moduleHandlers = require('./module.handlers');
// P1.3 删除（2026-05-17）：v3 framework + 旧 lecture + Agent 自动模式整套下线
// const frameworkHandlers = require('./framework.handlers');     // v3 framework，已删
// const lectureHandlers = require('./lecture.handlers');         // 旧 script:* + quality:*，已删
// const v2FrameworkHandlers = require('./v2/framework.handlers'); // v2 framework，已删
// const agentHandlers = require('./agent.handlers');             // Agent 自动模式，已删
const courseHandlers = require('./course.handlers');
const v2ScheduleHandlers = require('./v2/schedule.handlers'); // Phase-9 C-1：教学进度表
const v2DesignHandlers = require('./v2/design.handlers');     // Phase-9 C-2：教学设计
const v2LectureHandlers = require('./v2/lecture.handlers');
const v2PptHandlers = require('./v2/ppt.handlers');
const v2VideoHandlers = require('./v2/video.handlers');
const v2MicroVideoHandlers = require('./v2/micro-video.handlers'); // Phase-9 C-3：微课视频整套方案
const v2ReportHandlers = require('./v2/report.handlers');         // Phase-9 C-4：教学实施报告
const v2LessonHandlers = require('./v2/lesson.handlers');         // Phase-9 课堂讲稿（多节课）
const v2QuizHandlers = require('./v2/quiz.handlers');             // v4.3.3 Step 5 在线测验
const v2HomeworkHandlers = require('./v2/homework.handlers');     // v4.3.3 Step 6 课后作业
const v2SessionHandlers = require('./v2/session.handlers');       // 2026-05-16 v4.2.0 Phase A：会话上下文
const exportHandlers = require('./export.handlers');
const resourceHandlers = require('./resource.handlers');
const mediaHandlers = require('./media.handlers');
const promptHandlers = require('./prompt.handlers');
const systemHandlers = require('./system.handlers');
const workbenchHandlers = require('./workbench.handlers'); // Phase-7.7 A3: 教师日志

/**
 * 注册所有已迁移的 IPC handlers
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps - 惰性依赖获取函数
 */
function registerAll(ipcMain, getDeps) {
  notebookHandlers.register(ipcMain, getDeps);
  moduleHandlers.register(ipcMain, getDeps);
  courseHandlers.register(ipcMain, getDeps);
  // P1.3 删除（2026-05-17）：frameworkHandlers / lectureHandlers / v2FrameworkHandlers / agentHandlers 已下线
  v2ScheduleHandlers.register(ipcMain, getDeps);  // ① 教学进度表
  v2DesignHandlers.register(ipcMain, getDeps);    // ② 教学设计
  v2PptHandlers.register(ipcMain, getDeps);       // ③ 课件生成
  v2LessonHandlers.register(ipcMain, getDeps);    // ④ 讲稿生成（多节课模型）
  v2LectureHandlers.register(ipcMain, getDeps);   // ④ 讲稿辅助（导入 / 基于 ppt 生成）
  v2QuizHandlers.register(ipcMain, getDeps);      // ⑤ 在线测验（v4.3.3 新增）
  v2HomeworkHandlers.register(ipcMain, getDeps);  // ⑥ 课后作业（v4.3.3 新增）
  v2MicroVideoHandlers.register(ipcMain, getDeps); // ⑦ 视频提示词
  v2VideoHandlers.register(ipcMain, getDeps);     // ⑦ 视频 seedance 实调
  v2ReportHandlers.register(ipcMain, getDeps);    // ⑧ 教学实施报告
  v2SessionHandlers.register(ipcMain, getDeps);   // 会话上下文（跨 stage 实体绑定）
  exportHandlers.register(ipcMain, getDeps);
  resourceHandlers.register(ipcMain, getDeps);
  mediaHandlers.register(ipcMain, getDeps);
  promptHandlers.register(ipcMain, getDeps);
  systemHandlers.register(ipcMain, getDeps);
  workbenchHandlers.register(ipcMain, getDeps);   // 教师日志
}

module.exports = { registerAll };
