/**
 * v2 视频阶段 + 工作流状态 handlers — 7 个 IPC handlers
 *
 * 处理的 channel（v2 视频阶段）：
 *   v2:getVideoStageData, v2:saveVideoStage, v2:getStageOperations
 *
 * 处理的 channel（工作流状态管理）：
 *   workflow:getState, workflow:setStage,
 *   backend:listEvents, artifact:list
 *
 * 工作流相关 handler 放在这里的理由：它们管理跨 stage 的状态转换，
 * 与 video 作为流水线终点阶段语义上最接近。
 *
 * 稳定依赖（直接 require）：
 *   v2/contracts（validateStageTransition）
 *
 * 运行时依赖（通过 getDeps 惰性获取）：
 *   { v2Runtime, db, ensureWorkflowStateForNotebook,
 *     normalizeUnlockedStages, emitBackendEvent, backendEventBus }
 */

const { validateStageTransition } = require('../../v2/contracts');

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  // ── v2 视频阶段（薄包装）──────────────────────────────────────────────────

  ipcMain.handle('v2:getVideoStageData', async (event, notebookId) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.getVideoStageData(notebookId);
  });

  ipcMain.handle('v2:saveVideoStage', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    // Phase-6 M2.2：IPC 来源即用户操作，注入 _userInitiated 让 runtime 自动加锁
    return v2Runtime.saveVideoStage({ ...payload, _userInitiated: true });
  });

  // 获取当前所有 stage 的可用操作列表（用于前端渲染操作按钮）
  ipcMain.handle('v2:getStageOperations', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.getStageOperations(payload);
  });

  // ── 工作流状态管理 ────────────────────────────────────────────────────────

  // 获取笔记本当前 stage 状态（unlockedStages, currentStage 等）
  ipcMain.handle('workflow:getState', async (event, notebookId) => {
    const { db, ensureWorkflowStateForNotebook } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const workflowState = ensureWorkflowStateForNotebook(Number(notebookId));
      return { success: true, data: workflowState };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 切换当前 stage，校验依赖链后更新并广播 stage.entered 事件
  ipcMain.handle('workflow:setStage', async (event, payload = {}) => {
    const { db, ensureNotebookWorkspaceState, normalizeUnlockedStages, emitBackendEvent } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const nextStage = String(payload.stage || '').trim();
      const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
      if (!notebook) {
        return { success: false, error: 'Notebook not found' };
      }
      const validation = validateStageTransition({
        targetStage: nextStage,
        artifacts: db.listArtifacts({ notebookId })
      });
      if (!validation.allowed) {
        return { success: false, error: validation.blockingIssues.join('；') || 'Stage is locked' };
      }
      const nextWorkflow = db.upsertWorkflowState(notebookId, {
        currentStage: nextStage,
        unlockedStages: normalizeUnlockedStages(validation.unlockedStages)
      });
      db.updateNotebook(notebookId, { currentStage: nextStage });
      emitBackendEvent({
        notebookId,
        scope: 'workflow',
        type: 'stage.entered',
        stage: nextStage,
        payload: { unlockedStages: validation.unlockedStages }
      });
      return { success: true, data: nextWorkflow };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 列出后端事件（用于前端轮询进度）
  ipcMain.handle('backend:listEvents', async (event, filters = {}) => {
    const { db, backendEventBus } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      return { success: true, data: backendEventBus.list(filters || {}) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 列出产物记录（artifact tracker）
  ipcMain.handle('artifact:list', async (event, filters = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const items = db.listArtifacts(filters || {});
      return { success: true, data: items };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
