/**
 * v2 课后作业 stage handlers — v4.3.3
 *
 * Channels:
 *   v2:homeworkGenerate    —— AI 基于讲稿 + PPT 生成作业题集
 *   v2:homeworkSave        —— 保存/更新 homework_set artifact
 *   v2:homeworkConfirm     —— 标 confirmed=true
 *   v2:homeworkList        —— 列出本笔记本所有 homework_set
 *   v2:homeworkGet         —— 读取单个详情
 */

'use strict';

const { generateHomeworkFromLecture } = require('../../services/homework.service');
const { resolveProviderConfig, createAiClientByConfig } = require('../../api/provider-config');
// v4.3.3 修复（codex 审计 2026-05-30）：列表"已确认"复用统一规则（confirmed + status），不读裸字段。
const { isArtifactConfirmed } = require('../../v2/contracts');
// v4.3.3 Bug1 真根因修复（codex 审计 2026-05-29 · 问题4）：
//   课后作业找讲稿/PPT 同样改用统一多来源节次解析 + 鲁棒回退，
//   不再只读 metadata.lessonNumber（否则 createArtifact 没存 metadata 时报"本节尚无讲稿"）。
const { pickLatestArtifactByLesson } = require('../../v2/artifact-lesson');

function pickLatestByLessonAndType(items, lessonNumber, type, stage) {
  return pickLatestArtifactByLesson(items, type, stage, lessonNumber);
}

function register(ipcMain, getDeps) {
  function createAiClient(payload) {
    const { db } = getDeps();
    const config = resolveProviderConfig({ payload, db });
    return createAiClientByConfig(config);
  }

  ipcMain.handle('v2:homeworkGenerate', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const lessonNumber = Number(payload.lessonNumber);
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      if (!Number.isFinite(lessonNumber) || lessonNumber <= 0) return { success: false, error: 'lessonNumber 无效' };

      const items = db.listArtifacts({ notebookId });
      const lectureArtifact = pickLatestByLessonAndType(items, lessonNumber, 'lecture_final', 'lecture');
      if (!lectureArtifact) {
        return { success: false, error: `本节（第 ${lessonNumber} 节）尚无讲稿 artifact，无法出作业` };
      }
      const pptArtifact = pickLatestByLessonAndType(items, lessonNumber, 'ppt_outline', 'ppt');
      const pptPages = pptArtifact
        ? (Array.isArray(pptArtifact.content?.pages) ? pptArtifact.content.pages
          : Array.isArray(pptArtifact.content?.pptPages) ? pptArtifact.content.pptPages : [])
        : [];

      const lessonMeta = lectureArtifact.metadata?.topic
        ? lectureArtifact.metadata
        : (lectureArtifact.content?.lessonMeta || {});

      const aiClient = createAiClient(payload);
      const result = await generateHomeworkFromLecture({
        aiClient,
        lessonMeta,
        pptPages,
        lectureScript: String(lectureArtifact?.content?.finalScript || lectureArtifact?.content?.draftScript || ''),
        options: payload.options || {},
      });
      if (!result.success) return result;
      return { success: true, data: { homeworkSet: result.homeworkSet } };
    } catch (e) {
      console.error('[v2:homeworkGenerate]', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('v2:homeworkSave', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const homeworkId = Number(payload.homeworkId);
      const metadata = payload.metadata || {};
      const content = payload.content || {};
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      if (!metadata.lessonNumber) return { success: false, error: 'metadata.lessonNumber 必填' };

      let artifact;
      const title = `第 ${metadata.lessonNumber} 节·课后作业（${(content.tasks || []).length} 道）`;
      if (homeworkId && typeof db.updateArtifact === 'function') {
        // v4.3.3 修复（codex 审计 2026-05-30）：编辑保存后把 confirmed 置回 false，
        //   消除"confirmed=true 但 status=draft"不一致态（报告悄悄锁回、UI 仍显示已确认）。
        artifact = db.updateArtifact(homeworkId, { content, metadata, title, status: 'draft', confirmed: false });
      } else {
        artifact = db.createArtifact({
          notebookId, type: 'homework_set', stage: 'homework',
          title, content, metadata, status: 'draft', confirmed: false,
        });
      }
      // v4.3.3 codex 复审（2026-05-30）：保存=撤销确认，下游 video/report 标 dirty，避免状态滞后。
      if (typeof db.markDownstreamDirty === 'function') {
        try { db.markDownstreamDirty(notebookId, 'homework', 'homework-edited'); } catch (_) {}
      }
      return { success: true, data: { homeworkId: artifact?.id, metadata } };
    } catch (e) {
      console.error('[v2:homeworkSave]', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('v2:homeworkConfirm', async (event, payload = {}) => {
    const { db, syncWorkflowStageAvailability } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const homeworkId = Number(payload.homeworkId);
      if (!Number.isFinite(homeworkId) || homeworkId <= 0) return { success: false, error: 'homeworkId 无效' };
      const updated = db.updateArtifact(homeworkId, {
        confirmed: true, status: 'confirmed', confirmedAt: new Date().toISOString(),
      });
      const notebookId = Number(updated?.notebookId || payload.notebookId);
      if (Number.isFinite(notebookId) && notebookId > 0) {
        if (typeof syncWorkflowStageAvailability === 'function') {
          try { syncWorkflowStageAvailability(notebookId, { preferredStage: 'video' }); } catch (_) {}
        }
        // v4.3.3 Codex #5：上游 homework 改 → video/report 标 dirty
        if (typeof db.markDownstreamDirty === 'function') {
          try { db.markDownstreamDirty(notebookId, 'homework', 'homework-confirmed'); } catch (_) {}
        }
      }
      return { success: true, data: { homeworkId, confirmed: true } };
    } catch (e) {
      console.error('[v2:homeworkConfirm]', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('v2:homeworkList', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };
      const items = db.listArtifacts({ notebookId: id });
      const homeworks = items
        .filter((a) => a.type === 'homework_set' && a.stage === 'homework')
        .sort((a, b) => (Number(a.metadata?.lessonNumber) || 0) - (Number(b.metadata?.lessonNumber) || 0))
        .map((a) => ({
          id: a.id,
          lessonNumber: Number(a.metadata?.lessonNumber) || 0,
          topic: a.metadata?.topic || '',
          totalTasks: (a.content?.tasks || []).length,
          totalEstimatedMinutes: a.content?.metadata?.totalEstimatedMinutes || 0,
          confirmed: isArtifactConfirmed(a),
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        }));
      return { success: true, data: { notebookId: id, homeworks } };
    } catch (e) {
      console.error('[v2:homeworkList]', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('v2:homeworkGet', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const homeworkId = Number(payload.homeworkId);
      if (!Number.isFinite(homeworkId) || homeworkId <= 0) return { success: false, error: 'homeworkId 无效' };
      const items = db.listArtifacts({});
      const target = items.find((a) => Number(a.id) === homeworkId);
      if (!target) return { success: false, error: '未找到该 homework_set' };
      return { success: true, data: { homework: target } };
    } catch (e) {
      console.error('[v2:homeworkGet]', e);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
