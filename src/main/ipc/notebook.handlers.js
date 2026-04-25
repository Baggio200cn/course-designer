/**
 * 笔记本 CRUD handlers — 6 个 IPC handlers
 *
 * 处理的 channel：
 *   notebook:create, notebook:getAll, notebook:getById, notebook:delete,
 *   notebook:update（更新富上下文字段），
 *   notebook:generateResearch（AI 课程研究建议，Phase-5B）
 *
 * getDeps() 每次调用时求值（惰性），保证拿到 app.whenReady 之后已初始化的 db。
 * getDeps 返回：{ db, ensureNotebookWorkspaceState }
 *
 * 直接 require（稳定依赖）：
 *   research.service（AI 研究建议，无 ipcMain 依赖）
 *   api/ark + api/deepseek（创建 aiClient）
 */

const { generateResearchSuggestions } = require('../services/research.service');
const { resolveProviderConfig, createAiClientByConfig } = require('../api/provider-config');

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {() => { db: object, ensureNotebookWorkspaceState: Function }} getDeps
 */
function register(ipcMain, getDeps) {
  // 创建笔记本，同时初始化工作区目录
  ipcMain.handle('notebook:create', async (event, data) => {
    const { db, ensureNotebookWorkspaceState } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebook = db.createNotebook(data);
      const hydrated = ensureNotebookWorkspaceState(notebook);
      return { success: true, data: hydrated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 获取所有笔记本，自动补齐工作区路径
  ipcMain.handle('notebook:getAll', async () => {
    const { db, ensureNotebookWorkspaceState } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebooks = db.getAllNotebooks().map((nb) => ensureNotebookWorkspaceState(nb));
      return { success: true, data: notebooks };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 按 id 获取单个笔记本
  ipcMain.handle('notebook:getById', async (event, id) => {
    const { db, ensureNotebookWorkspaceState } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebook = ensureNotebookWorkspaceState(db.getNotebookById(id));
      return { success: true, data: notebook };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 删除笔记本（仅删除数据库记录，不删除磁盘文件）
  ipcMain.handle('notebook:delete', async (event, id) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      db.deleteNotebook(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 更新笔记本（富上下文字段，Phase-5B）
  ipcMain.handle('notebook:update', async (event, { id, data }) => {
    const { db, ensureNotebookWorkspaceState } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      if (!id) throw new Error('Notebook id missing');
      const updated = db.updateNotebook(Number(id), data);
      if (!updated) return { success: false, error: 'Notebook not found' };
      return { success: true, data: ensureNotebookWorkspaceState(updated) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // AI 课程研究建议（Phase-5B）
  // 根据课程基本信息，从 AI 知识库生成软件工具/岗位/课程标准等参考建议
  ipcMain.handle('notebook:generateResearch', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const config = resolveProviderConfig({ payload, db });
      const aiClient = createAiClientByConfig(config);
      if (!aiClient) {
        return { success: false, error: '未配置可用的 AI API，请先在设置中配置 Ark 或 DeepSeek 密钥' };
      }
      // courseInfo 来自 payload 或从 DB 读取笔记本
      let courseInfo = payload.courseInfo || {};
      if (payload.notebookId && !courseInfo.name) {
        const nb = db.getNotebookById(Number(payload.notebookId));
        if (nb) courseInfo = { ...nb, ...courseInfo };
      }
      const result = await generateResearchSuggestions({
        courseInfo,
        aiClient,
        mode: payload.mode || 'ai'
      });
      // 若生成成功且传了 notebookId，自动保存到笔记本的 researchNotes 字段
      if (result.success && payload.notebookId && payload.autoSave !== false) {
        db.updateNotebook(Number(payload.notebookId), {
          researchNotes: { ...result.data, generatedAt: new Date().toISOString() }
        });
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
