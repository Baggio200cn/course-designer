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
// v4.3.3 修复（codex 审计 2026-05-30）：列表"已确认"复用统一规则（confirmed + status），不读裸字段。
const { isArtifactConfirmed } = require('../../v2/contracts');

// v4.3.3 Bug1 真根因修复（codex 审计 2026-05-29）：
//   改用统一的 pickLatestArtifactByLesson（多来源解析 lessonNumber：metadata / metadata.lessonContext
//   / content.lessonMeta / content.lessonContext），根治"createArtifact 没存 metadata 时按节匹配失败、
//   多节课无 metadata 时串课"问题。
const { pickLatestArtifactByLesson, getArtifactLessonNumber } = require('../../v2/artifact-lesson');

function pickLatestByLesson(items, type, stage, lessonNumber) {
  return pickLatestArtifactByLesson(items, type, stage, lessonNumber);
}

function pickLatestPptByLesson(items, lessonNumber) {
  return pickLatestArtifactByLesson(items, 'ppt_outline', 'ppt', lessonNumber);
}

function pickLatestLectureByLesson(items, lessonNumber) {
  return pickLatestArtifactByLesson(items, 'lecture_final', 'lecture', lessonNumber);
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
        // v4.3.3 Bug1：区分"完全没 PPT"和"选错节"两种情况，给可执行提示
        const anyPpt = items.some((a) => a.type === 'ppt_outline' && a.stage === 'ppt');
        const error = anyPpt
          ? `第 ${lessonNumber} 节没有对应的 PPT。已有其它节次的 PPT，请确认上方"选择节课"选对了节次；或回到"教学课件"阶段为第 ${lessonNumber} 节生成 PPT。`
          : `本笔记本尚未生成任何 PPT。请先回到"教学课件"阶段生成并确认 PPT，再来出题。`;
        return { success: false, error };
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
    const { db, syncWorkflowStageAvailability } = getDeps();
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
        // v4.3.3 修复（codex 审计 2026-05-30）：编辑保存后必须把 confirmed 置回 false，
        //   否则留下"confirmed=true 但 status=draft"不一致态——报告悄悄锁回、UI 仍显示已确认。
        artifact = db.updateArtifact(quizId, { content, metadata, title, status: 'draft', confirmed: false });
      } else {
        artifact = db.createArtifact({
          notebookId, type: 'quiz_set', stage: 'quiz',
          title, content, metadata, status: 'draft', confirmed: false,
        });
      }
      // v4.3.3 codex 复审（2026-05-30）：保存=改成草稿（撤销确认），下游 video/report 标 dirty。
      if (typeof db.markDownstreamDirty === 'function') {
        try { db.markDownstreamDirty(notebookId, 'quiz', 'quiz-edited'); } catch (_) {}
      }
      // v4.3.3 codex 第3轮复审（2026-05-30）：保存撤销确认后必须按 artifacts 重算 unlockedStages，
      //   否则持久化 workflow 仍含 report（报告阶段卡保持"已解锁"）。syncWorkflowStageAvailability
      //   内部走 computeUnlockedStages(artifacts) 重算，保持 currentStage 在 quiz。
      if (typeof syncWorkflowStageAvailability === 'function') {
        try { syncWorkflowStageAvailability(notebookId, { preferredStage: 'quiz' }); } catch (_) {}
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
          confirmed: isArtifactConfirmed(a),
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

// v4.3.3 Bug1：导出 pickLatestByLesson 供行为单测（验证节次匹配回退逻辑）
module.exports = { register, pickLatestByLesson, pickLatestPptByLesson };
