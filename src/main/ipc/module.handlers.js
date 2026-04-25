/**
 * 模块 CRUD handlers — 7 个 IPC handlers
 *
 * 处理的 channel：
 *   module:list, module:create, module:update, module:updateContent,
 *   module:delete, module:replace, module:setStructureImage
 *
 * 注意：framework:syncStructureImages 不在这里，它属于 framework.handlers.js。
 *
 * getDeps() 返回：{ db, normalizeModuleInput, patchCourseProject }
 */

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  // 列出笔记本下所有模块
  ipcMain.handle('module:list', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const modules = db.getModulesByNotebook(notebookId);
      return { success: true, data: modules };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 创建模块，同时更新课程项目的 dirty 标记
  ipcMain.handle('module:create', async (event, { notebookId, moduleData }) => {
    const { db, normalizeModuleInput, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const normalized = normalizeModuleInput(moduleData);
      const moduleId = db.createModule(notebookId, normalized);
      const modules = db.getModulesByNotebook(notebookId);
      const created = modules.find((m) => m.id === moduleId) || null;
      patchCourseProject(notebookId, {
        modules,
        dirty: true,
        dirtyReason: 'module-created',
        dirtyAt: new Date().toISOString()
      });
      return { success: true, data: created };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 更新模块基本信息
  ipcMain.handle('module:update', async (event, { moduleId, updateData }) => {
    const { db, normalizeModuleInput, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const normalized = normalizeModuleInput(updateData);
      const updated = db.updateModule(moduleId, normalized);
      const modules = db.getModulesByNotebook(updated?.notebookId);
      patchCourseProject(updated?.notebookId, {
        modules,
        dirty: true,
        dirtyReason: 'module-updated',
        dirtyAt: new Date().toISOString()
      });
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 更新模块内容（支持 merge 模式）
  ipcMain.handle('module:updateContent', async (event, { moduleId, contentPatch, merge = true }) => {
    const { db, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const updated = db.updateModuleContent(moduleId, contentPatch || {}, Boolean(merge));
      const modules = db.getModulesByNotebook(updated?.notebookId);
      patchCourseProject(updated?.notebookId, {
        modules,
        dirty: true,
        dirtyReason: 'module-content-updated',
        dirtyAt: new Date().toISOString()
      });
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 删除模块，同步更新课程项目状态
  ipcMain.handle('module:delete', async (event, { moduleId }) => {
    const { db, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const target = db.getModuleById(moduleId);
      db.deleteModule(moduleId);
      if (target?.notebookId) {
        patchCourseProject(target.notebookId, {
          modules: db.getModulesByNotebook(target.notebookId),
          dirty: true,
          dirtyReason: 'module-deleted',
          dirtyAt: new Date().toISOString()
        });
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 批量替换笔记本下所有模块（框架 AI 生成后调用）
  ipcMain.handle('module:replace', async (event, { notebookId, modules }) => {
    const { db, normalizeModuleInput, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const normalized = (modules || []).map((item) => normalizeModuleInput(item));
      const replaced = db.replaceModules(notebookId, normalized);
      patchCourseProject(notebookId, {
        modules: replaced,
        dirty: true,
        dirtyReason: 'modules-replaced',
        dirtyAt: new Date().toISOString()
      });
      return { success: true, data: replaced };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 设置模块结构图（上传图片后回写路径）
  ipcMain.handle('module:setStructureImage', async (event, { moduleId, imageData }) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const updated = db.setModuleStructureImage(moduleId, imageData || {});
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
