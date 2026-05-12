/**
 * v2 框架阶段 handlers — 4 个 IPC handlers
 *
 * 处理的 channel：
 *   v2:getFrameworkStageData, v2:saveFrameworkStage,
 *   v2:confirmFrameworkStage, v2:confirmFrameworkInfographic
 *
 * 注意：v2:generateFrameworkInfographic 不在这里（使用 BrowserWindow/HTML 渲染），
 *       推迟到 media.handlers.js 一起迁移。
 *
 * 所有 handler 都是 v2Runtime 方法的薄包装，不含业务逻辑。
 * getDeps() 返回：{ v2Runtime }
 */

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  ipcMain.handle('v2:getFrameworkStageData', async (event, notebookId) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.getFrameworkStageData(notebookId);
  });

  ipcMain.handle('v2:saveFrameworkStage', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    // Phase-6 M2.2：IPC 来源即用户操作，注入 _userInitiated 让 runtime 自动加锁
    return v2Runtime.saveFrameworkStage({ ...payload, _userInitiated: true });
  });

  ipcMain.handle('v2:confirmFrameworkStage', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.confirmFrameworkStage({ ...payload, _userInitiated: true });
  });

  ipcMain.handle('v2:confirmFrameworkInfographic', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.confirmFrameworkInfographic(payload);
  });
}

module.exports = { register };
