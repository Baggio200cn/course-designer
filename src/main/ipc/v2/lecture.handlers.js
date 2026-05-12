/**
 * v2 讲稿阶段 handlers — 4 个 IPC handlers
 *
 * 处理的 channel：
 *   v2:getLectureStageData, v2:saveLectureStage, v2:confirmLectureStage,
 *   v2:importLectureArtifact （Phase-6 M4.1：导入现有讲稿）
 *
 * 所有 handler 都是 v2Runtime 方法的薄包装，不含业务逻辑。
 * getDeps() 返回：{ v2Runtime }
 */

const { importLectureFromFile } = require('../../services/lecture-importer.service');

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
    // Phase-6 M2.2：IPC 来源即用户操作，注入 _userInitiated 让 runtime 自动加锁
    return v2Runtime.saveLectureStage({ ...payload, _userInitiated: true });
  });

  ipcMain.handle('v2:confirmLectureStage', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.confirmLectureStage({ ...payload, _userInitiated: true });
  });

  // Phase-6 M4.1：导入现有讲稿合法入口
  // payload: { notebookId, filePath, instruction? }
  // 内部走 conflict-policy.CONTRACTS_VS_SKIP 裁决，绕过 lecture 生成阶段直接进 ppt
  ipcMain.handle('v2:importLectureArtifact', async (event, payload = {}) => {
    try {
      const { v2Runtime } = getDeps();
      return await importLectureFromFile(payload, { v2Runtime });
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
