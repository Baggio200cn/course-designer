/**
 * session.handlers.js — 2026-05-16 v4.2.0 Phase A
 *
 * 会话上下文 IPC：统一管理"老师当前选中的节课 / 设计 / 讲稿 / PPT / 微课 / 报告"
 * 所有 stage 切节课走 v2:switchActiveLesson，确保跨 stage 上下文同步。
 *
 * IPC 列表：
 *   v2:getSessionContext        读取会话上下文
 *   v2:updateSessionContext     部分字段更新
 *   v2:switchActiveLesson       切节课（同步切对应 design/lecture/ppt）
 *   v2:setActiveArtifact        切某类 artifact 当前版本（如切到某个 design 版本）
 *
 * ✅ D12 已落地（2026-05-18 v4.3.3 Sprint B）
 *   db-simple.js 真实实现 getSessionContext / updateSessionContext / switchActiveLesson / setActiveArtifact
 *   数据存到 data.sessions[notebookId] = { activeLessonNumber, activeDesignArtifactId, ... }
 *   每次 update 自动 _writeData 持久化，刷新不丢
 *
 * 仍待 D11 在前端实现：
 *   用 useSession() hook 替代散落在 V2App.jsx 的 selectedDesignArtifactId 等 useState
 */

'use strict';

function register(ipcMain, getDeps) {
  ipcMain.handle('v2:getSessionContext', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };
      // P6（2026-05-18）：db.getSessionContext 在 SimpleDb 没实现，兜底返回 null（不阻塞 UI）
      const ctx = typeof db.getSessionContext === 'function' ? db.getSessionContext(id) : null;
      return { success: true, data: ctx };
    } catch (e) {
      console.error('[v2:getSessionContext]', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('v2:updateSessionContext', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(payload.notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };
      const patch = { ...payload };
      delete patch.notebookId;
      // P6（2026-05-18）：SimpleDb 未实现 session API，兜底
      const ctx = typeof db.updateSessionContext === 'function' ? db.updateSessionContext(id, patch) : null;
      return { success: true, data: ctx };
    } catch (e) {
      console.error('[v2:updateSessionContext]', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('v2:switchActiveLesson', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(payload.notebookId);
      const lessonNumber = Number(payload.lessonNumber);
      if (!Number.isFinite(id) || !Number.isFinite(lessonNumber)) {
        return { success: false, error: 'notebookId / lessonNumber 无效' };
      }
      // P6（2026-05-18）：SimpleDb 未实现 switchActiveLesson，兜底（不阻塞，UI 自己同步切节课）
      const ctx = typeof db.switchActiveLesson === 'function'
        ? db.switchActiveLesson(id, lessonNumber)
        : { activeLessonNumber: lessonNumber };
      console.log(`[v2:switchActiveLesson] 切到第 ${lessonNumber} 节 → design=${ctx?.activeDesignArtifactId} lecture=${ctx?.activeLectureArtifactId} ppt=${ctx?.activePptOutlineId}`);
      return { success: true, data: ctx };
    } catch (e) {
      console.error('[v2:switchActiveLesson]', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('v2:setActiveArtifact', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(payload.notebookId);
      const kind = String(payload.kind || ''); // 'design' | 'lecture' | 'ppt' | 'microVideo' | 'report'
      const artifactId = Number(payload.artifactId) || null;
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };
      const fieldMap = {
        design: 'activeDesignArtifactId',
        lecture: 'activeLectureArtifactId',
        ppt: 'activePptOutlineId',
        microVideo: 'activeMicroVideoId',
        report: 'activeReportId',
      };
      const field = fieldMap[kind];
      if (!field) return { success: false, error: `kind 无效：${kind}` };
      const ctx = db.updateSessionContext(id, { [field]: artifactId });
      return { success: true, data: ctx };
    } catch (e) {
      console.error('[v2:setActiveArtifact]', e);
      return { success: false, error: e.message };
    }
  });

  // workbench:getStats 已在 src/main/ipc/workbench.handlers.js 注册（2026-05-16 v4.2.0 重写为 6-stage 版本）
}

module.exports = { register };
