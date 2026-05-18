/**
 * v2 讲稿阶段 handlers — 5 个 IPC handlers
 *
 * 处理的 channel：
 *   v2:getLectureStageData, v2:saveLectureStage, v2:confirmLectureStage,
 *   v2:importLectureArtifact （Phase-6 M4.1：导入现有讲稿）
 *   v2:generateLectureFromPpt （v4.2.0 Phase A'-6：PPT 驱动讲稿生成）
 *
 * 所有 handler 都是 v2Runtime 方法的薄包装，不含业务逻辑。
 * getDeps() 返回：{ v2Runtime, db }
 */

const { importLectureFromFile } = require('../../services/lecture-importer.service');
// v4.2.0 Phase A'-6：新增 PPT 驱动讲稿生成器
const { generateLectureFromPpt } = require('../../script/lecture-from-ppt-generator');
const { resolveProviderConfig, createAiClientByConfig } = require('../../api/provider-config');

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

  // 2026-05-16 v4.2.0 Phase A'-6：PPT 驱动讲稿生成
  //   payload: { notebookId, pptArtifactId?, designArtifactId?, styleRubricText? }
  //   流程：
  //     1. 从 session 取 activePptOutlineId / activeDesignArtifactId（payload 可覆盖）
  //     2. 读取 PPT 页面 + design 上下文
  //     3. 调用 generateLectureFromPpt 生成逐页对应讲稿
  //     4. 把生成稿 + coverage 报告返回前端（不直接落库——由前端确认后保存）
  ipcMain.handle('v2:generateLectureFromPpt', async (event, payload = {}) => {
    try {
      const { db } = getDeps();
      if (!db) throw new Error('Database not initialized');

      const notebookId = Number(payload.notebookId);
      if (!notebookId) throw new Error('缺少 notebookId');
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) throw new Error(`找不到 notebook ${notebookId}`);

      // 取 session 上下文（v4.2.0 新增）
      const session = (typeof db.getSessionContext === 'function')
        ? db.getSessionContext(notebookId)
        : {};

      // ── 1. 解析 PPT artifact ────────────────────────────────────────
      const pptArtifactId = payload.pptArtifactId || session?.activePptOutlineId;
      let pptArtifact = null;
      if (pptArtifactId && typeof db.getArtifactById === 'function') {
        pptArtifact = db.getArtifactById(pptArtifactId);
      }
      if (!pptArtifact && typeof db.getLatestArtifact === 'function') {
        pptArtifact = db.getLatestArtifact(notebookId, 'ppt_outline', 'ppt');
      }
      if (!pptArtifact) {
        return {
          success: false,
          error: 'PPT 驱动讲稿需要先有已确认的 PPT。请回到 PPT 阶段完成生成并确认。',
        };
      }
      const pptPages = Array.isArray(pptArtifact.content?.pages) ? pptArtifact.content.pages : [];
      if (pptPages.length === 0) {
        return { success: false, error: 'PPT artifact 中没有 pages 数据，无法生成讲稿' };
      }

      // ── 2. 解析 design artifact（提供上下文，可选） ─────────────────
      const designArtifactId = payload.designArtifactId
        || pptArtifact.metadata?.designArtifactId
        || session?.activeDesignArtifactId;
      let designArtifact = null;
      if (designArtifactId && typeof db.getArtifactById === 'function') {
        designArtifact = db.getArtifactById(designArtifactId);
      }
      if (!designArtifact && typeof db.getLatestArtifact === 'function') {
        designArtifact = db.getLatestArtifact(notebookId, 'design_doc', 'design');
      }
      const designContent = designArtifact?.content || null;
      const lessonMeta = designArtifact?.metadata
        || pptArtifact.metadata?.lessonMeta
        || {};

      // ── 3. 准备 AI 客户端 + 上下文 ──────────────────────────────────
      const config = resolveProviderConfig({ payload, db, purpose: 'lecture_formal' });
      const aiClient = createAiClientByConfig(config);

      const courseName = payload.courseName || notebook?.name || '课程';
      const lessonTotalHours = (Number(lessonMeta.theoryHours) || 0) + (Number(lessonMeta.practiceHours) || 0);
      const totalHours = lessonTotalHours > 0
        ? lessonTotalHours
        : (Number(payload.totalHours) || Number(notebook?.totalHours) || 1);

      const courseContext = {
        softwareTools: notebook?.softwareTools || '',
        jobTargets: notebook?.jobTargets || '',
        industryScenarios: notebook?.industryScenarios || '',
        learnerProfile: notebook?.learnerProfile || '',
      };

      console.log(`[v2:generateLectureFromPpt] notebook=${notebookId} ppt=${pptArtifact.id} (${pptPages.length} 页) design=${designArtifact?.id || 'none'} 学时=${totalHours}`);

      // ── 4. 生成讲稿 ─────────────────────────────────────────────────
      const result = await generateLectureFromPpt({
        aiClient,
        pptPages,
        designContent,
        lessonMeta,
        courseName,
        totalHours,
        courseContext,
        styleRubricText: payload.styleRubricText || '',
      });

      console.log(`[v2:generateLectureFromPpt] 完成：${result.coverage.actualCount}/${result.coverage.expectedCount} 页覆盖（缺 ${result.coverage.missingSlides.length} 页）`);

      return {
        success: true,
        data: {
          script: result.script,
          coverage: result.coverage,
          sourceMeta: {
            pptArtifactId: pptArtifact.id,
            designArtifactId: designArtifact?.id || null,
            pptPageCount: pptPages.length,
            courseName,
            totalHours,
            lessonNumber: lessonMeta.lessonNumber,
            topic: lessonMeta.topic,
          },
          attemptLog: result.attemptLog,
        },
      };
    } catch (e) {
      console.error('[v2:generateLectureFromPpt] 失败：', e);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
