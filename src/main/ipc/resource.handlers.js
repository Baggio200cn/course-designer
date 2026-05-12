/**
 * 素材资源 handlers — 11 个 IPC handlers
 *
 * 处理的 channel：
 *   resource:list, resource:delete, resource:getById, resource:update,
 *   resource:addTags, resource:listByTags, resource:listByModule,
 *   resource:listTags, resource:open, resource:import, resource:reindexLibrary
 *
 * 直接 require（稳定依赖）：
 *   path, fs, electron { BrowserWindow, dialog, shell, app }
 *
 * 运行时依赖（通过 getDeps 惰性获取）：
 *   { db, mainWindow, markCourseProjectDirty }
 *
 * 本地工具（从 index.js 提取，纯函数）：
 *   RESOURCE_EXT_TYPE, inferResourceType, getTeacherWorkspaceRoot
 */

const path = require('path');
const fs = require('fs');
const { BrowserWindow, dialog, shell, app } = require('electron');

// ── 本地工具（纯函数，不依赖运行时状态） ─────────────────────────────────────

const RESOURCE_EXT_TYPE = {
  '.md': 'text',
  '.txt': 'text',
  '.doc': 'doc',
  '.docx': 'doc',
  '.pdf': 'pdf',
  '.ppt': 'ppt',
  '.pptx': 'ppt',
  '.xls': 'sheet',
  '.xlsx': 'sheet',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image'
};

/** 根据文件扩展名推断素材类型 */
function inferResourceType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return RESOURCE_EXT_TYPE[ext] || 'other';
}

/** 返回教师工作区根目录（桌面文档文件夹下的固定目录） */
function getTeacherWorkspaceRoot() {
  return path.join(app.getPath('documents'), '驭课Agent工作区');
}

// ── 注册入口 ──────────────────────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  // ── 基础 CRUD ──────────────────────────────────────────────────────────────

  ipcMain.handle('resource:list', async (event, filters) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const resources = db.listResources(filters || {});
      return { success: true, data: resources };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('resource:delete', async (event, resourceId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      db.deleteResource(resourceId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('resource:getById', async (event, resourceId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const resource = db.getResourceById(resourceId);
      return { success: true, data: resource };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('resource:update', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const { resourceId, ...patch } = payload;
      const updated = db.updateResource(resourceId, patch);
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── 标签操作 ───────────────────────────────────────────────────────────────

  ipcMain.handle('resource:addTags', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const updated = db.addResourceTags(payload.resourceId, payload.tags || []);
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('resource:listByTags', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const resources = db.listResourcesByTags(payload.tags || [], {
        notebookId: payload.notebookId,
        type: payload.type
      });
      return { success: true, data: resources };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('resource:listByModule', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const resources = db.listResourcesByModule(payload.notebookId, payload.moduleRef);
      return { success: true, data: resources };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('resource:listTags', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const tags = db.listResourceTags(notebookId || null);
      return { success: true, data: tags };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── 文件操作 ───────────────────────────────────────────────────────────────

  // 用系统默认程序打开素材文件或 URL
  ipcMain.handle('resource:open', async (event, storagePath) => {
    try {
      const target = String(storagePath || '').trim();
      if (!target) return { success: false, error: 'storagePath is required' };
      if (/^https?:\/\//i.test(target)) {
        await shell.openExternal(target);
        return { success: true };
      }
      const result = await shell.openPath(target);
      if (result) return { success: false, error: result };
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 从本地文件系统导入素材，复制到 asset-library 目录并存入 DB
  ipcMain.handle('resource:import', async (event, payload = {}) => {
    const { db, mainWindow, markCourseProjectDirty } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      const picked = await dialog.showOpenDialog(win, {
        title: '导入素材文件',
        properties: ['openFile', 'multiSelections']
      });
      if (picked.canceled || !picked.filePaths?.length) {
        return { success: true, data: [] };
      }

      const targetDir = path.join(app.getPath('userData'), 'asset-library');
      fs.mkdirSync(targetDir, { recursive: true });

      const results = [];
      for (const sourcePath of picked.filePaths) {
        const stat = fs.statSync(sourcePath);
        const originalName = path.basename(sourcePath);
        const uniqueName = `${Date.now()}-${Math.floor(Math.random() * 10000)}-${originalName}`;
        const storagePath = path.join(targetDir, uniqueName);
        fs.copyFileSync(sourcePath, storagePath);
        const resource = db.createResource({
          notebookId: payload.notebookId || null,
          originalName,
          name: payload.rename || originalName,
          sourcePath,
          storagePath,
          type: inferResourceType(originalName),
          size: stat.size,
          tags: Array.isArray(payload.tags) ? payload.tags : []
        });
        results.push(resource);
      }

      const notebookId = Number(payload.notebookId);
      if (Number.isFinite(notebookId) && notebookId > 0 && results.length > 0) {
        markCourseProjectDirty(notebookId, 'resources-imported');
      }
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 扫描 course-library/raw 目录，将所有文件注册到资源库
  ipcMain.handle('resource:reindexLibrary', async () => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const roots = [
        path.join(app.getAppPath(), 'resources', 'course-library', 'raw'),
        path.join(process.cwd(), 'resources', 'course-library', 'raw')
      ];
      const root = roots.find((item) => fs.existsSync(item));
      if (!root) return { success: true, data: [] };

      const names = fs.readdirSync(root);
      const upserted = [];
      for (const name of names) {
        const fullPath = path.join(root, name);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;
        const item = db.upsertResourceByStoragePath({
          name,
          originalName: name,
          sourcePath: fullPath,
          storagePath: fullPath,
          type: inferResourceType(name),
          size: stat.size,
          tags: ['课程库']
        });
        upserted.push(item);
      }
      return { success: true, data: upserted };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
