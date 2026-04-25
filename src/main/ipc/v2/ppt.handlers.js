/**
 * v2 PPT 阶段 handlers — 5 个 IPC handlers
 *
 * 处理的 channel：
 *   v2:getPptStageData, v2:savePptStage,
 *   v2:confirmPptStage, v2:generatePptPageCandidates,
 *   v2:generatePptPlan（Phase-5C 新增：AI 驱动的 PPT 页面规划）
 *
 * 所有 handler 都是 v2Runtime 方法的薄包装，不含业务逻辑。
 * getDeps() 返回：{ v2Runtime, db }
 */

const fs   = require('fs');
const path = require('path');

const { generatePptPlan } = require('../../script/ppt-plan-generator');
const { resolveProviderConfig, createAiClientByConfig } = require('../../api/provider-config');
const { buildPptContext } = require('../../agent/context-builder');  // Phase-5D：讲稿→PPT 跨阶段上下文

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  function createAiClient(payload) {
    const { db } = getDeps();
    const config = resolveProviderConfig({ payload, db });
    return createAiClientByConfig(config);
  }

  ipcMain.handle('v2:getPptStageData', async (event, notebookId) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.getPptStageData(notebookId);
  });

  ipcMain.handle('v2:savePptStage', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.savePptStage(payload);
  });

  ipcMain.handle('v2:confirmPptStage', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.confirmPptStage(payload);
  });

  // 生成 PPT 页面候选内容（AI 调用，由 v2Runtime 管理重试和状态）
  ipcMain.handle('v2:generatePptPageCandidates', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.generatePptPageCandidates(payload);
  });

  /**
   * AI 驱动的 PPT 页面规划（Phase-5C 新增）
   *
   * 接收讲稿 + 课程信息，调用 generatePptPlan 生成完整页面规划。
   * 返回结构化 page 数组，包含 pageType / title / keyContent / speakerNotes。
   */
  ipcMain.handle('v2:generatePptPlan', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const notebook = notebookId ? db.getNotebookById(notebookId) : null;
      const modules = notebookId ? db.getModulesByNotebook(notebookId) : [];
      const aiClient = createAiClient(payload);
      const courseName = payload.courseName || notebook?.name || '课程';
      const totalHours = Number(notebook?.totalHours) || Number(payload.totalHours) || 1;

      // Phase-5D：跨阶段上下文注入 — 从 DB 读取正式讲稿章节摘要
      // 若前端已传入 lectureScript，以前端传入为准；否则从 DB artifact 读取
      const pptCtx = notebookId ? buildPptContext(db, notebookId) : { lectureSections: [], lectureSectionSummary: '' };
      const lectureScriptFromPayload = String(payload.lectureScript || '');

      // 优先使用前端传入的讲稿；若为空，则从 DB 读取 lecture_final artifact
      let effectiveLectureScript = lectureScriptFromPayload;
      if (!effectiveLectureScript && notebookId && typeof db.getLatestArtifact === 'function') {
        const finalArtifact = db.getLatestArtifact(notebookId, 'lecture_final', 'lecture');
        effectiveLectureScript = finalArtifact?.content?.finalScript || '';
      }

      const { pages, rawPlan, pageCount } = await generatePptPlan({
        lectureScript: effectiveLectureScript,
        courseName,
        totalHours,
        modules: payload.modules || modules,
        aiClient,
        prevPages: Array.isArray(payload.prevPages) ? payload.prevPages : [],
        imageAspect: String(payload.imageAspect || '16:9'),
        imageQuality: String(payload.imageQuality || 'low')
      });

      return {
        success: true,
        data: {
          pages,
          pageCount,
          templateKey: payload.templateKey || 'pro_minimalist'
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * 读取本地图片文件，返回 base64 data URL
   * 供 Canvas 合成时安全加载本地文件（file:// 协议在 Canvas 中可能被 taint 拦截）
   */
  ipcMain.handle('v2:readFileAsBase64', async (event, filePath) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('文件路径为空');
      }
      const absPath = String(filePath).trim();
      if (!fs.existsSync(absPath)) {
        throw new Error(`文件不存在：${absPath}`);
      }
      const buf  = fs.readFileSync(absPath);
      const ext  = path.extname(absPath).toLowerCase().replace('.', '') || 'png';
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return { success: true, data: `data:${mime};base64,${buf.toString('base64')}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * 保存 Canvas 合成后的 PNG 到本地磁盘
   * payload: { notebookId, pageId, imageBase64 }
   * 返回: { success, data: { compositePath } }
   */
  ipcMain.handle('v2:saveCompositeSlide', async (event, payload = {}) => {
    const { app } = getDeps();
    try {
      const { notebookId, pageId, imageBase64 } = payload;
      if (!notebookId || !pageId || !imageBase64) {
        throw new Error('缺少参数：notebookId / pageId / imageBase64');
      }
      const outputDir = path.join(
        app.getPath('userData'),
        'generated-composites',
        String(notebookId)
      );
      fs.mkdirSync(outputDir, { recursive: true });

      const fileName    = `composite-${pageId}-${Date.now()}.png`;
      const filePath    = path.join(outputDir, fileName);
      const base64Clean = String(imageBase64).replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(base64Clean, 'base64'));

      return { success: true, data: { compositePath: filePath } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
