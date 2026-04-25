/**
 * agent.handlers.js — Agent 编排器 IPC handlers（Phase-5C Step 3）
 *
 * 处理的 channel：
 *   agent:run        — 启动 Agent 对一个笔记本执行多阶段自动生成
 *   agent:getStatus  — 获取笔记本各阶段当前质量状态
 *
 * 设计原则：
 *   - handlers 只做参数验证 + 调用 orchestrator，不含业务逻辑
 *   - agent:run 是长时 IPC（可能 3-5 分钟），前端需展示进度条
 *   - 进度通过 emitBackendEvent 实时推送（scope: 'agent'）
 *   - 错误通过 { success: false, error } 返回，不抛到外层
 */

const { createAgentOrchestrator, assessNotebookState } = require('../agent/orchestrator');
const { resolveProviderConfig, createAiClientByConfig } = require('../api/provider-config');

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  /**
   * agent:run — 启动 Agent 自动生成流水线
   *
   * payload: {
   *   notebookId: number,
   *   targetStages?: string[],   // 默认 ['framework', 'lecture']
   *   provider?: string,         // 默认从 db 读取
   *   model?: string
   * }
   *
   * 返回：{
   *   success: boolean,
   *   data: {
   *     status: 'success'|'blocked'|'timeout'|'error',
   *     stepLog: Array,
   *     summary: string,
   *     finalState: Object|null
   *   }
   * }
   */
  ipcMain.handle('agent:run', async (event, payload = {}) => {
    // getDeps() 直接暴露 patchCourseProject / normalizeModuleInput，没有 helpers 嵌套层
    const { db, emitBackendEvent, patchCourseProject, normalizeModuleInput, v2Runtime } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      if (!notebookId) throw new Error('notebookId 不能为空');

      const notebook = db.getNotebookById(notebookId);
      if (!notebook) throw new Error(`找不到笔记本 ${notebookId}`);

      // 创建 AI 客户端工厂（惰性，在 orchestrator 内部使用）
      function createAiClient() {
        const config = resolveProviderConfig({ payload, db });
        return createAiClientByConfig(config);
      }

      // Phase-5D：默认目标阶段扩展为 framework → lecture → ppt
      const targetStages = Array.isArray(payload.targetStages)
        ? payload.targetStages
        : ['framework', 'lecture', 'ppt'];

      const agent = createAgentOrchestrator({
        db,
        createAiClient,
        emitEvent: emitBackendEvent,
        helpers: {
          patchCourseProject,    // 从 getDeps() 直接获取，非 helpers?.xxx
          normalizeModuleInput
        },
        v2Runtime  // Phase-5D：PPT 保存需要 v2Runtime
      });

      const result = await agent.run(notebookId, {
        targetStages,
        maxSteps: 15  // PPT 阶段增加步骤上限
      });

      return { success: result.success, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * agent:getStatus — 获取笔记本当前各阶段完成情况和质量摘要
   *
   * 纯只读操作，用于前端展示 Agent 状态面板
   */
  ipcMain.handle('agent:getStatus', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const safeId = Number(notebookId);
      const state = assessNotebookState(db, safeId);
      if (!state) {
        return { success: false, error: '找不到该笔记本' };
      }
      return {
        success: true,
        data: {
          notebookId: safeId,
          courseName: state.notebook?.name || '',
          framework: {
            exists: Boolean(state.framework),
            valid: Boolean(state.frameworkQuality?.valid),
            errors: state.frameworkQuality?.errors || [],
            warnings: state.frameworkQuality?.warnings || []
          },
          lecture: {
            draftCount: state.draftCount || 0,
            hasFinalScript: Boolean(state.finalScript),
            valid: Boolean(state.lectureQuality?.valid),
            errors: state.lectureQuality?.errors || [],
            warnings: state.lectureQuality?.warnings || [],
            narrationCharCount: state.lectureQuality?.checks?.finalNarrationCharCount || 0
          },
          // Phase-5D：PPT 阶段状态
          ppt: {
            pageCount: state.pptPageCount || 0,
            hasPages: (state.pptPageCount || 0) > 0
          },
          // Phase-5D：视频阶段状态
          video: {
            hasPrompt: Boolean(state.videoPromptExists)
          }
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
