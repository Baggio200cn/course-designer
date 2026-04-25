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
const frameworkHandlers = require('./framework.handlers');
const courseHandlers = require('./course.handlers');
const lectureHandlers = require('./lecture.handlers');
const v2FrameworkHandlers = require('./v2/framework.handlers');
const v2LectureHandlers = require('./v2/lecture.handlers');
const v2PptHandlers = require('./v2/ppt.handlers');
const v2VideoHandlers = require('./v2/video.handlers');
const exportHandlers = require('./export.handlers');
const resourceHandlers = require('./resource.handlers');
const mediaHandlers = require('./media.handlers');
const promptHandlers = require('./prompt.handlers');
const systemHandlers = require('./system.handlers');
const agentHandlers = require('./agent.handlers');         // Phase-5C: Agent

/**
 * 注册所有已迁移的 IPC handlers
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps - 惰性依赖获取函数
 */
function registerAll(ipcMain, getDeps) {
  notebookHandlers.register(ipcMain, getDeps);
  moduleHandlers.register(ipcMain, getDeps);
  frameworkHandlers.register(ipcMain, getDeps);
  courseHandlers.register(ipcMain, getDeps);
  lectureHandlers.register(ipcMain, getDeps);
  v2FrameworkHandlers.register(ipcMain, getDeps);
  v2LectureHandlers.register(ipcMain, getDeps);
  v2PptHandlers.register(ipcMain, getDeps);
  v2VideoHandlers.register(ipcMain, getDeps);
  exportHandlers.register(ipcMain, getDeps);
  resourceHandlers.register(ipcMain, getDeps);
  mediaHandlers.register(ipcMain, getDeps);
  promptHandlers.register(ipcMain, getDeps);
  systemHandlers.register(ipcMain, getDeps);
  agentHandlers.register(ipcMain, getDeps);              // Phase-5C: Agent
  // ...
}

module.exports = { registerAll };
