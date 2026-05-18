/**
 * workbench.handlers.js — 教师日志（2026-05-16 v4.2.0 重写）
 *
 * 修复 v4.1.x 工作台失效问题（用 framework_json 老 type，新 6-stage 数据全显示 0）。
 * 重写支持：
 *   - v4.0+ 6 stage 完成度（schedule / design / lecture / ppt / video / report）
 *   - 每个 notebook 历史 artifact 列表（最近 30 条），含 type/title/updatedAt/storagePath
 *   - 点击历史 artifact → 跳回原 stage 自动加载该 artifact（前端用）
 *
 * IPC：
 *   workbench:getStats          —— 工作台概览统计 + 每个 notebook 的历史 artifact
 *   workbench:openHistoryArtifact —— 一键跳回该 artifact 所在 stage 并加载（更新 sessionContext）
 */

'use strict';

// v4.3.3 Codex Round 4 #1：单一来源 · STAGE_PRIMARY_TYPE 从 contracts.js 引用
const { STAGE_PRIMARY_TYPE: CONTRACTS_PRIMARY_TYPE } = require('../v2/contracts');

const STAGE_TYPES = {
  schedule: ['schedule_table', 'schedule_export_word'],
  design: ['design_doc', 'design_infographic', 'design_export_word'],
  lecture: ['lecture_final', 'lecture_drafts', 'lecture_export_word'],
  ppt: ['ppt_outline', 'ppt_page_image', 'ppt_export_file'],
  quiz: ['quiz_set'],            // v4.3.3
  homework: ['homework_set'],    // v4.3.3
  // v4.3.3 Codex #3：实际生成的是 video_prompt（micro-video.handlers.js 第 67 行），
  //   micro_video_plan 作为 legacy alias 兼容老数据，新数据全用 video_prompt
  video: ['video_prompt', 'micro_video_plan'],
  report: ['implementation_report'],
};

// v4.3.3 Codex Round 4 #1：不再本地定义，从 contracts.js 单一来源拉
//   旧代码留作 fallback 仅在 contracts 加载失败时启用
const STAGE_PRIMARY_TYPE = CONTRACTS_PRIMARY_TYPE || {
  schedule: 'schedule_table',
  design: 'design_doc',
  lecture: 'lecture_final',
  ppt: 'ppt_outline',
  quiz: 'quiz_set',
  homework: 'homework_set',
  video: 'video_prompt',
  report: 'implementation_report',
};

const TYPE_LABEL = {
  schedule_table: '📅 教学进度表',
  schedule_export_word: '📅 进度表 Word',
  design_doc: '🎯 教学设计',
  design_infographic: '🎯 设计信息图',
  design_export_word: '🎯 设计 Word',
  lecture_drafts: '🎤 讲稿草稿',
  lecture_final: '🎤 正式讲稿',
  lecture_export_word: '🎤 讲稿 Word',
  ppt_outline: '📊 PPT 大纲',
  ppt_page_image: '📊 PPT 页图',
  ppt_export_file: '📊 PPT 文件',
  quiz_set: '📝 在线测验',        // v4.3.3
  homework_set: '📚 课后作业',    // v4.3.3
  micro_video_plan: '🎬 微课视频方案',
  implementation_report: '📝 实施报告',
};

function inferStageFromType(type) {
  for (const [stage, types] of Object.entries(STAGE_TYPES)) {
    if (types.includes(type)) return stage;
  }
  return 'unknown';
}

function register(ipcMain, getDeps) {
  ipcMain.handle('workbench:getStats', async () => {
    try {
      const { db } = getDeps();
      if (!db) return { success: false, error: 'Database not initialized' };

      const allData = typeof db._readData === 'function' ? db._readData() : { notebooks: [], artifacts: [] };
      const notebooks = Array.isArray(allData.notebooks) ? allData.notebooks : [];
      const artifacts = Array.isArray(allData.artifacts) ? allData.artifacts : [];
      const memories = (typeof db.getAgentMemories === 'function' ? db.getAgentMemories() : []) || [];

      const courseRows = notebooks.map((nb) => {
        const myArts = artifacts.filter(
          (a) => Number(a.notebookId) === Number(nb.id) && a.status !== 'deleted'
        );
        const stageStatus = {};
        Object.entries(STAGE_PRIMARY_TYPE).forEach(([stage, type]) => {
          const arts = myArts.filter((a) => a.type === type);
          const confirmedArt = arts.find((a) => a.confirmed);
          const latest = arts.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
          stageStatus[stage] = {
            generated: arts.length > 0,
            confirmed: !!confirmedArt,
            count: arts.length,
            latestArtifactId: latest?.id || null,
            latestUpdatedAt: latest?.updatedAt || '',
          };
        });
        const confirmedCount = Object.values(stageStatus).filter((s) => s.confirmed).length;
        const generatedCount = Object.values(stageStatus).filter((s) => s.generated).length;

        // 历史 artifact 列表（最近 30 条 + 老师能"随时打开"）
        const recentArtifacts = myArts
          .filter((a) => Boolean(TYPE_LABEL[a.type]))
          .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
          .slice(0, 30)
          .map((a) => ({
            id: a.id,
            type: a.type,
            typeLabel: TYPE_LABEL[a.type] || a.type,
            stage: a.stage || inferStageFromType(a.type),
            title: a.title || '未命名',
            confirmed: !!a.confirmed,
            status: a.status,
            storagePath: a.storagePath || '',
            updatedAt: a.updatedAt,
            createdAt: a.createdAt,
            lessonNumber: Number(a.metadata?.lessonNumber) || 0,
            lessonTopic: a.metadata?.topic || a.metadata?.lessonTopic || '',
          }));

        return {
          notebookId: nb.id,
          name: nb.name || '未命名课程',
          totalHours: Number(nb.totalHours) || 0,
          stageStatus,
          confirmedCount,
          generatedCount,
          completionPct: Math.round((confirmedCount / 8) * 100),  // v4.3.3 八阶段
          createdAt: nb.createdAt,
          updatedAt: nb.updatedAt,
          recentArtifacts,
          sessionContext: nb.sessionContext || null,
          memorySaved: memories.some((m) => m.notebookId === nb.id),
        };
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

      // 整体统计
      const stageCompletion = {};
      Object.keys(STAGE_PRIMARY_TYPE).forEach((stage) => {
        stageCompletion[stage] = courseRows.filter((c) => c.stageStatus[stage].confirmed).length;
      });
      const totalNotebooks = courseRows.length;
      const overallPct = totalNotebooks > 0
        ? Math.round(courseRows.reduce((s, c) => s + c.completionPct, 0) / totalNotebooks)
        : 0;

      return {
        success: true,
        data: {
          // v4.0+ 6 stage 维度
          totalNotebooks,
          totalArtifacts: artifacts.length,
          stageCompletion,
          overallCompletionRate: overallPct,
          courses: courseRows,
          memories: memories.slice(-10).reverse(),
          totalMemories: memories.length,
          generatedAt: new Date().toISOString(),

          // 向后兼容旧 UI 字段（v4.1.x MyWorkbench 里用过）
          confirmedFrameworks: stageCompletion.schedule || 0,
          confirmedLectures: stageCompletion.lecture || 0,
          confirmedPpts: stageCompletion.ppt || 0,
          recentActivities: courseRows.map((c) => ({
            notebookId: c.notebookId,
            name: c.name,
            totalHours: c.totalHours,
            updatedAt: c.updatedAt,
            stages: {
              schedule: c.stageStatus.schedule.confirmed,
              design: c.stageStatus.design.confirmed,
              ppt: c.stageStatus.ppt.confirmed,
              lecture: c.stageStatus.lecture.confirmed,
              quiz: c.stageStatus.quiz?.confirmed || false,        // v4.3.3
              homework: c.stageStatus.homework?.confirmed || false, // v4.3.3
              video: c.stageStatus.video.confirmed,
              report: c.stageStatus.report.confirmed,
            },
            memorySaved: c.memorySaved,
          })),
          avgRegenerations: '—',
        },
      };
    } catch (e) {
      console.error('[workbench:getStats]', e);
      return { success: false, error: e.message };
    }
  });

  /**
   * v4.3.3 · P0-1 数据恢复 IPC
   *   返回 migration 001 扫描出的可恢复 artifact 列表
   */
  ipcMain.handle('workbench:listRecoverable', async () => {
    try {
      const { db } = getDeps();
      if (!db) return { success: false, error: 'Database not initialized' };
      const data = typeof db._readData === 'function' ? db._readData() : {};
      const list = data?.globalState?._recoverable || [];
      return {
        success: true,
        data: {
          recoverable: list,
          updatedAt: data?.globalState?._recoverableUpdatedAt || null,
        },
      };
    } catch (e) {
      console.error('[workbench:listRecoverable]', e);
      return { success: false, error: e.message };
    }
  });

  /**
   * v4.3.3 · 把某个 recoverable artifact 状态从 'deleted' 改回 'draft'
   *   不删任何东西，仅"取消标记"
   */
  ipcMain.handle('workbench:restoreArtifact', async (event, payload = {}) => {
    try {
      const { db } = getDeps();
      if (!db) return { success: false, error: 'Database not initialized' };
      const artifactId = Number(payload.artifactId);
      if (!Number.isFinite(artifactId) || artifactId <= 0) return { success: false, error: 'artifactId 无效' };
      if (typeof db.updateArtifact !== 'function') return { success: false, error: 'db.updateArtifact 不可用' };
      const updated = db.updateArtifact(artifactId, {
        status: 'draft',
        restoredAt: new Date().toISOString(),
        restoredFrom: payload.reason || 'P0-1 数据找回',
      });
      // 同步移出 _recoverable 列表
      const data = db._readData();
      if (data?.globalState?._recoverable) {
        data.globalState._recoverable = data.globalState._recoverable.filter((r) => Number(r.id) !== artifactId);
        db._writeData(data);
      }
      return { success: true, data: { artifactId, status: 'draft', updated } };
    } catch (e) {
      console.error('[workbench:restoreArtifact]', e);
      return { success: false, error: e.message };
    }
  });

  /**
   * 一键打开历史 artifact：
   *   - 更新该 notebook 的 sessionContext（设 active 字段指向该 artifact）
   *   - 返回该 artifact 所属 stage，让前端跳过去
   */
  ipcMain.handle('workbench:openHistoryArtifact', async (event, payload = {}) => {
    try {
      const { db } = getDeps();
      if (!db) return { success: false, error: 'Database not initialized' };

      const notebookId = Number(payload.notebookId);
      const artifactId = Number(payload.artifactId);
      if (!Number.isFinite(notebookId) || !Number.isFinite(artifactId)) {
        return { success: false, error: 'notebookId / artifactId 无效' };
      }

      const artifact = typeof db.getArtifactById === 'function'
        ? db.getArtifactById(artifactId)
        : (typeof db._readData === 'function'
            ? (db._readData().artifacts || []).find((a) => Number(a.id) === artifactId)
            : null);
      if (!artifact) return { success: false, error: '未找到该 artifact' };

      const stage = artifact.stage || inferStageFromType(artifact.type);
      // v4.3.3 Codex Round 3 #3：补 quiz_set / homework_set / video_prompt（新主类型）
      //   micro_video_plan 作为 legacy alias 仍保留兼容老 artifact
      const fieldMap = {
        design_doc: 'activeDesignArtifactId',
        lecture_final: 'activeLectureArtifactId',
        ppt_outline: 'activePptOutlineId',
        quiz_set: 'activeQuizId',
        homework_set: 'activeHomeworkId',
        video_prompt: 'activeMicroVideoId',
        micro_video_plan: 'activeMicroVideoId',  // legacy
        implementation_report: 'activeReportId',
      };
      const sessionField = fieldMap[artifact.type];
      const lessonNumber = Number(artifact.metadata?.lessonNumber) || null;

      const patch = {};
      if (sessionField) patch[sessionField] = artifactId;
      if (lessonNumber) patch.activeLessonNumber = lessonNumber;

      let newSession = null;
      if (typeof db.updateSessionContext === 'function' && Object.keys(patch).length > 0) {
        newSession = db.updateSessionContext(notebookId, patch);
      }

      return {
        success: true,
        data: {
          stage,
          artifactId,
          artifactType: artifact.type,
          notebookId,
          sessionContext: newSession,
          // 如果是文件型 artifact，前端可直接开打文件
          storagePath: artifact.storagePath || '',
        }
      };
    } catch (e) {
      console.error('[workbench:openHistoryArtifact]', e);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
