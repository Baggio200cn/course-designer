/**
 * v2 在线测验 stage handlers — v4.3.3
 *
 * Channels:
 *   v2:quizGenerate    —— AI 基于 PPT 骨架 + 讲稿 生成测验题集
 *   v2:quizSave        —— 保存/更新 quiz_set artifact（status=draft）
 *   v2:quizConfirm     —— 标 confirmed=true 解锁下游
 *   v2:quizList        —— 列出本笔记本所有 quiz_set
 *   v2:quizGet         —— 读取单个 quiz_set 详情
 *   v2:quizExportWord  —— 导出测验题为 Word（含答案版 + 学生版）
 */

'use strict';

const { generateQuizFromPpt } = require('../../services/quiz.service');
const { resolveProviderConfig, createAiClientByConfig } = require('../../api/provider-config');

function pickLatestPptByLesson(items, lessonNumber) {
  return items
    .filter((a) => a.type === 'ppt_outline' && a.stage === 'ppt'
      && Number(a.metadata?.lessonNumber) === Number(lessonNumber))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0] || null;
}

function pickLatestLectureByLesson(items, lessonNumber) {
  return items
    .filter((a) => a.type === 'lecture_final' && a.stage === 'lecture'
      && Number(a.metadata?.lessonNumber) === Number(lessonNumber))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0] || null;
}

function register(ipcMain, getDeps) {
  function createAiClient(payload) {
    const { db } = getDeps();
    const config = resolveProviderConfig({ payload, db });
    return createAiClientByConfig(config);
  }

  // ── 生成测验 ─────────────────────────────────────────
  ipcMain.handle('v2:quizGenerate', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const lessonNumber = Number(payload.lessonNumber);
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      if (!Number.isFinite(lessonNumber) || lessonNumber <= 0) return { success: false, error: 'lessonNumber 无效' };

      const items = db.listArtifacts({ notebookId });
      const pptArtifact = pickLatestPptByLesson(items, lessonNumber);
      if (!pptArtifact) {
        return { success: false, error: `本节（第 ${lessonNumber} 节）尚无 PPT artifact，无法出题` };
      }
      const lectureArtifact = pickLatestLectureByLesson(items, lessonNumber);
      const pptPages = Array.isArray(pptArtifact.content?.pages) ? pptArtifact.content.pages
        : Array.isArray(pptArtifact.content?.pptPages) ? pptArtifact.content.pptPages
        : [];
      if (pptPages.length === 0) {
        return { success: false, error: 'PPT artifact 内 pages 为空' };
      }

      const lessonMeta = pptArtifact.metadata?.topic
        ? pptArtifact.metadata
        : (pptArtifact.content?.lessonMeta || {});

      const aiClient = createAiClient(payload);
      const result = await generateQuizFromPpt({
        aiClient,
        lessonMeta,
        pptPages,
        lectureScript: String(lectureArtifact?.content?.finalScript || lectureArtifact?.content?.draftScript || ''),
        options: payload.options || {},
      });
      if (!result.success) return result;

      return { success: true, data: { quizSet: result.quizSet } };
    } catch (e) {
      console.error('[v2:quizGenerate]', e);
      return { success: false, error: e.message };
    }
  });

  // ── 保存测验题集（draft） ──────────────────────────────
  ipcMain.handle('v2:quizSave', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const quizId = Number(payload.quizId);
      const metadata = payload.metadata || {};
      const content = payload.content || {};
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      if (!metadata.lessonNumber) return { success: false, error: 'metadata.lessonNumber 必填' };

      let artifact;
      const title = `第 ${metadata.lessonNumber} 节·在线测验（${(content.questions || []).length} 题）`;
      if (quizId && typeof db.updateArtifact === 'function') {
        artifact = db.updateArtifact(quizId, { content, metadata, title, status: 'draft' });
      } else {
        artifact = db.createArtifact({
          notebookId, type: 'quiz_set', stage: 'quiz',
          title, content, metadata, status: 'draft', confirmed: false,
        });
      }
      return { success: true, data: { quizId: artifact?.id, metadata } };
    } catch (e) {
      console.error('[v2:quizSave]', e);
      return { success: false, error: e.message };
    }
  });

  // ── 确认（解锁下游 video / report） ─────────────────────
  ipcMain.handle('v2:quizConfirm', async (event, payload = {}) => {
    const { db, syncWorkflowStageAvailability } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const quizId = Number(payload.quizId);
      if (!Number.isFinite(quizId) || quizId <= 0) return { success: false, error: 'quizId 无效' };
      const updated = db.updateArtifact(quizId, {
        confirmed: true, status: 'confirmed', confirmedAt: new Date().toISOString(),
      });
      const notebookId = Number(updated?.notebookId || payload.notebookId);
      if (Number.isFinite(notebookId) && notebookId > 0) {
        if (typeof syncWorkflowStageAvailability === 'function') {
          try { syncWorkflowStageAvailability(notebookId, { preferredStage: 'homework' }); } catch (_) {}
        }
        // v4.3.3 Codex #5：上游 quiz 改 → homework/video/report 标 dirty
        if (typeof db.markDownstreamDirty === 'function') {
          try { db.markDownstreamDirty(notebookId, 'quiz', 'quiz-confirmed'); } catch (_) {}
        }
      }
      return { success: true, data: { quizId, confirmed: true } };
    } catch (e) {
      console.error('[v2:quizConfirm]', e);
      return { success: false, error: e.message };
    }
  });

  // ── 列出本笔记本所有 quiz_set ──────────────────────────
  ipcMain.handle('v2:quizList', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };
      const items = db.listArtifacts({ notebookId: id });
      const quizzes = items
        .filter((a) => a.type === 'quiz_set' && a.stage === 'quiz')
        .sort((a, b) => (Number(a.metadata?.lessonNumber) || 0) - (Number(b.metadata?.lessonNumber) || 0))
        .map((a) => ({
          id: a.id,
          lessonNumber: Number(a.metadata?.lessonNumber) || 0,
          topic: a.metadata?.topic || '',
          totalQuestions: (a.content?.questions || []).length,
          confirmed: !!a.confirmed,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        }));
      return { success: true, data: { notebookId: id, quizzes } };
    } catch (e) {
      console.error('[v2:quizList]', e);
      return { success: false, error: e.message };
    }
  });

  // ── 读取单个 quiz_set ──────────────────────────────────
  ipcMain.handle('v2:quizGet', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const quizId = Number(payload.quizId);
      if (!Number.isFinite(quizId) || quizId <= 0) return { success: false, error: 'quizId 无效' };
      const items = db.listArtifacts({});
      const target = items.find((a) => Number(a.id) === quizId);
      if (!target) return { success: false, error: '未找到该 quiz_set' };
      return { success: true, data: { quiz: target } };
    } catch (e) {
      console.error('[v2:quizGet]', e);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
