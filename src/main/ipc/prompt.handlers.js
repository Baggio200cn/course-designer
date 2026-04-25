/**
 * Prompt 模板 + Infocard handlers — 8 个 IPC handlers
 *
 * 处理的 channel：
 *   prompt:getTemplate, prompt:saveTemplate, prompt:render,
 *   prompt:getAdvice, prompt:applyAdvice（Prompt 模板管理）
 *   infocard:getTemplate, infocard:saveTemplate, infocard:generate（信息图模板）
 *
 * ⚠️ 注意：所有 handler 均由 LEGACY_DISABLED 标志保护，当前全部返回
 *    { success: false, error: 'legacy ... API disabled' }。
 *    代码逻辑完整保留，等待 Phase-5B Prompt Registry 统一替换。
 *
 * 直接 require（稳定依赖）：
 *   electron.BrowserWindow（infocard:generate 的截图依赖）
 *
 * 运行时依赖（通过 getDeps 惰性获取）：
 *   { db, promptTemplateService, promptAdvisorService,
 *     infographicCardService, imageVersionService }
 *
 * 本地工具（infocard:generate 所需，与 media.handlers.js 中保持一致）：
 *   withTimeout, renderHtmlToPngBuffer
 */

const { BrowserWindow } = require('electron');

// ── 是否禁用 Legacy Prompt API（与 index.js 中的 LEGACY_IPC_DISABLED 对应）──
const LEGACY_DISABLED = true;

// ── 本地工具（infocard:generate 截图辅助，legacy 保留） ───────────────────────

function withTimeout(promise, ms, label) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function renderHtmlToPngBuffer(html, width = 1000, height = 1400) {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: false }
  });
  try {
    await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
    const contentSize = await withTimeout(win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const waitFonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        waitFonts.then(() => {
          setTimeout(() => resolve({
            width: Math.ceil(document.documentElement.scrollWidth || document.body.scrollWidth || ${width}),
            height: Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || ${height})
          }), 300);
        });
      });
    `), 15000, 'Infocard content size evaluation');
    const nextWidth = Math.max(width, Number(contentSize?.width) || width);
    const nextHeight = Math.max(height, Number(contentSize?.height) || height);
    if (nextWidth !== width || nextHeight !== height) {
      win.setContentSize(nextWidth, nextHeight);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const image = await withTimeout(win.webContents.capturePage(), 20000, 'Infocard capture');
    return image.toPNG();
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

// ── 注册入口 ──────────────────────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  // ── Prompt 模板管理（Legacy API，当前已禁用） ─────────────────────────────

  ipcMain.handle('prompt:getTemplate', async (event, payload = {}) => {
    const { db, promptTemplateService } = getDeps();
    try {
      if (LEGACY_DISABLED) return { success: false, error: 'legacy prompt template API disabled' };
      if (!db) throw new Error('Database not initialized');
      const item = promptTemplateService.getPromptTemplate(
        payload.sceneType,
        payload.model,
        payload.courseId
      );
      return { success: true, data: item };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('prompt:saveTemplate', async (event, payload = {}) => {
    const { db, promptTemplateService } = getDeps();
    try {
      if (LEGACY_DISABLED) return { success: false, error: 'legacy prompt template API disabled' };
      if (!db) throw new Error('Database not initialized');
      const item = promptTemplateService.savePromptTemplate(
        payload.sceneType,
        payload.model,
        payload.scope,
        payload.template,
        payload.courseId
      );
      return { success: true, data: item };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('prompt:render', async (event, payload = {}) => {
    const { db, promptTemplateService } = getDeps();
    try {
      if (LEGACY_DISABLED) return { success: false, error: 'legacy prompt template API disabled' };
      if (!db) throw new Error('Database not initialized');
      const rendered = promptTemplateService.renderPrompt(payload.template, payload.params);
      return { success: true, data: { prompt: rendered } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('prompt:getAdvice', async (event, payload = {}) => {
    const { promptAdvisorService } = getDeps();
    try {
      if (LEGACY_DISABLED) return { success: false, error: 'legacy prompt advice API disabled' };
      const advice = promptAdvisorService.buildPromptAdvice(
        payload.sceneType,
        payload.model,
        payload.currentPrompt,
        payload.userFeedback
      );
      return { success: true, data: advice };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('prompt:applyAdvice', async (event, payload = {}) => {
    const { promptAdvisorService } = getDeps();
    try {
      if (LEGACY_DISABLED) return { success: false, error: 'legacy prompt advice API disabled' };
      const prompt = promptAdvisorService.applyAdviceToPrompt(
        payload.currentPrompt,
        payload.advicePatch
      );
      return { success: true, data: { prompt } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Infocard 模板管理（Legacy API，当前已禁用） ───────────────────────────

  ipcMain.handle('infocard:getTemplate', async () => {
    const { db, infographicCardService } = getDeps();
    try {
      if (LEGACY_DISABLED) return { success: false, error: 'legacy infocard API disabled' };
      if (!db) throw new Error('Database not initialized');
      return { success: true, data: { template: infographicCardService.getPromptTemplate() } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('infocard:saveTemplate', async (event, payload = {}) => {
    const { db, infographicCardService } = getDeps();
    try {
      if (LEGACY_DISABLED) return { success: false, error: 'legacy infocard API disabled' };
      if (!db) throw new Error('Database not initialized');
      return { success: true, data: infographicCardService.savePromptTemplate(payload.template || '') };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // infocard:generate — legacy，保留完整逻辑待 Phase-5B 迁移
  ipcMain.handle('infocard:generate', async (event, payload = {}) => {
    const { db, infographicCardService, imageVersionService } = getDeps();
    try {
      if (LEGACY_DISABLED) return { success: false, error: 'legacy infocard API disabled' };
      if (!db) throw new Error('Database not initialized');
      const taskId = payload.taskId || `infocard-${Date.now()}`;
      const html = await infographicCardService.generateHtml({
        provider: payload.provider || 'ark',
        endpointId: payload.endpointId || null,
        promptFinal: payload.promptFinal
      });
      const pngBuffer = await renderHtmlToPngBuffer(
        html,
        Number(payload.width) || 1000,
        Number(payload.height) || 1400
      );
      const saved = infographicCardService.saveArtifacts({
        html,
        pngBuffer,
        title: payload.title || 'teaching-infocard',
        notebookId: payload.courseId || payload.notebookId || null
      });
      const version = imageVersionService.createImageVersion(
        taskId,
        payload.promptFinal,
        {
          model: 'infocard_html',
          sceneType: 'structured',
          imagePath: saved.imagePath,
          imageUrl: null,
          resourceId: saved.resourceId,
          status: 'generated'
        }
      );
      return {
        success: true,
        data: {
          taskId,
          model: 'infocard_html',
          sceneType: 'structured',
          imagePath: saved.imagePath,
          imageUrl: '',
          htmlPath: saved.htmlPath,
          resourceId: saved.resourceId,
          createdAt: new Date().toISOString(),
          version
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
