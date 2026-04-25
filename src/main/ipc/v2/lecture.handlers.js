/**
 * v2 讲稿阶段 handlers — 3 个 IPC handlers
 *
 * 处理的 channel：
 *   v2:getLectureStageData, v2:saveLectureStage, v2:confirmLectureStage
 *
 * 所有 handler 都是 v2Runtime 方法的薄包装，不含业务逻辑。
 * getDeps() 返回：{ v2Runtime }
 */

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  ipcMain.handle('v2:getLectureStageData', async (event, notebookId) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.getLectureStageData(notebookId);
  });

  ipcMain.handle('v2:saveLectureStage', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.saveLectureStage(payload);
  });

  ipcMain.handle('v2:confirmLectureStage', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.confirmLectureStage(payload);
  });
}

module.exports = { register };
