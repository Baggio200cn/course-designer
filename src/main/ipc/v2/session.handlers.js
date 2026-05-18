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
 * ⚠ TODO(D12) · 2026-05-18 v4.3.3 Sprint B
 *   当前 SimpleDb 没有真正实现 getSessionContext / updateSessionContext / switchActiveLesson /
 *   setActiveArtifact 这 4 个方法。所有 handler 走 typeof db.xxx === 'function' 检查兜底返回 null。
 *   这意味着：
 *     - 老师切节课 → SessionContext 在前端能用，但**刷新后丢**（DB 没存）
 *     - 跨 stage 一致性靠前端 useEffect 自己保持
 *   D12 必须：
 *     1. 在 db-simple.js 真正加 sessions 表 + 4 个方法
 *     2. 在每个 setX 后做 db._writeData() 持久化
 *     3. 前端用 useSession 替代分散 useState
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
