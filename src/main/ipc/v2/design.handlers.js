/**
 * v2 教学设计 handlers（Phase-9 阶段 C-2）
 *
 * 处理的 channel：
 *   v2:generateDesign      生成教学设计（AI 调用）
 *   v2:saveDesign          保存教学设计（老师手改后）
 *   v2:confirmDesign       确认（解锁下游 lecture 阶段）
 *   v2:getDesignData       读取当前 notebookId 的教学设计 artifact
 *
 * artifact_type='design_doc'，stage='design'
 */

const path = require('path');
const { dialog } = require('electron');
const designSvc = require('../../services/design.service');
const { resolveProviderConfig, createAiClientByConfig } = require('../../api/provider-config');
const { exportDesignWord } = require('../../export/design-word');

function register(ipcMain, getDeps) {
  // ── 生成 ───────────────────────────────────────────────────────────────
  ipcMain.handle('v2:generateDesign', async (event, payload = {}) => {
    const { db, ensureNotebookWorkspaceState } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');

      const notebookId = Number(payload.notebookId);
      if (!Number.isFinite(notebookId) || notebookId <= 0) {
        return { success: false, error: 'notebookId 无效' };
      }

      const notebook = ensureNotebookWorkspaceState
        ? ensureNotebookWorkspaceState(db.getNotebookById(notebookId))
        : db.getNotebookById(notebookId);
      if (!notebook) {
        return { success: false, error: 'Notebook not found' };
      }

      // 取上游 schedule artifact 作为参考（已 confirmed）
      let scheduleData = null;
      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId }) : [];
      const confirmedSchedule = allArtifacts
        .filter((a) => a.type === 'schedule_table' && a.stage === 'schedule' && a.confirmed)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
      if (confirmedSchedule?.content) {
        scheduleData = confirmedSchedule.content;
      }

      // AI 客户端
      const config = resolveProviderConfig({ payload, db });
      const aiClient = createAiClientByConfig(config);
      if (!aiClient) {
        return { success: false, error: '未配置有效的 AI 客户端' };
      }

      const courseContext = {
        school: payload.school || notebook.school || '广州纺校',
        totalHours: Number(payload.totalHours || notebook.totalHours) || 72,
        textbook: payload.textbook || notebook.textbook || notebook.teachingMaterials || '',
        softwareTools: notebook.softwareTools || '',
        jobTargets: notebook.jobTargets || '',
        industryScenarios: notebook.industryScenarios || '',
        learnerProfile: notebook.learnerProfile || '',
        courseGoal: notebook.description || '',
      };

      // Phase-9.5：lessonMeta 必填（前端传来的本节信息）
      const lessonMeta = payload.lessonMeta || {};
      if (!lessonMeta.topic) {
        return { success: false, error: '本节主题（lessonMeta.topic）不能为空——请在前端选/填本节主题' };
      }

      const result = await designSvc.generate({
        aiClient,
        courseName: payload.courseName || notebook.name || '课程',
        lessonMeta,
        scheduleData,
        courseContext,
      });

      if (!result.success) {
        return result;
      }

      const lm = result.data.design.lessonMeta || lessonMeta;
      const artifact = db.createArtifact({
        notebookId,
        type: 'design_doc',
        stage: 'design',
        title: `教学设计 · 第${lm.lessonNumber}节「${lm.topic}」（${lm.totalHours}学时）`,
        content: result.data.design,
        confirmed: false,
        status: 'draft',
        metadata: {
          generatedBy: 'design.service',
          phase: 'phase-9.5',
          // Phase-9.5：节课元信息进 metadata 方便后续 list/筛选
          lessonNumber: lm.lessonNumber,
          lessonTopic: lm.topic,
          lessonChapter: lm.chapter,
          lessonTotalHours: lm.totalHours,
          theoryHours: lm.theoryHours,
          practiceHours: lm.practiceHours,
          objectivesCount: result.data.design._stats?.objectivesCount,
          methodsCount: result.data.design._stats?.methodsCount,
        },
      });

      return {
        success: true,
        data: {
          notebookId,
          artifactId: artifact?.id,
          design: result.data.design,
          lessonMeta: lm,
        },
      };
    } catch (error) {
      console.error('[v2:generateDesign] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // Phase-9.5：list 所有节课设计（前端 tab 导航用）
  ipcMain.handle('v2:listDesignLessons', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };

      const items = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId: id }) : [];
      const lessons = items
        .filter((a) => a.type === 'design_doc' && a.stage === 'design')
        .map((a) => ({
          artifactId: a.id,
          lessonNumber: a.metadata?.lessonNumber || a.content?.lessonMeta?.lessonNumber || 1,
          topic: a.metadata?.lessonTopic || a.content?.lessonMeta?.topic || '（未命名）',
          chapter: a.metadata?.lessonChapter || a.content?.lessonMeta?.chapter || '',
          theoryHours: a.metadata?.theoryHours ?? a.content?.lessonMeta?.theoryHours ?? 0,
          practiceHours: a.metadata?.practiceHours ?? a.content?.lessonMeta?.practiceHours ?? 0,
          totalHours: a.metadata?.lessonTotalHours ?? a.content?.lessonMeta?.totalHours ?? 0,
          confirmed: !!a.confirmed,
          status: a.status,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        }))
        .sort((a, b) => (a.lessonNumber || 0) - (b.lessonNumber || 0));

      const totalAccumulatedHours = lessons
        .filter((l) => l.confirmed)
        .reduce((s, l) => s + (Number(l.totalHours) || 0), 0);

      return {
        success: true,
        data: {
          notebookId: id,
          lessons,
          totalAccumulatedHours,
          courseTotalHours: db.getNotebookById(id)?.totalHours || 72,
        },
      };
    } catch (error) {
      console.error('[v2:listDesignLessons] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 保存 ───────────────────────────────────────────────────────────
  ipcMain.handle('v2:saveDesign', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');

      const notebookId = Number(payload.notebookId);
      const artifactId = payload.artifactId ? Number(payload.artifactId) : null;
      const design = payload.design;

      if (!Number.isFinite(notebookId) || notebookId <= 0) {
        return { success: false, error: 'notebookId 无效' };
      }
      if (!design || typeof design !== 'object') {
        return { success: false, error: 'design 内容为空或非对象' };
      }

      let artifact;
      if (artifactId && db.updateArtifact) {
        artifact = db.updateArtifact(artifactId, { content: design, status: 'draft' });
      } else {
        artifact = db.createArtifact({
          notebookId,
          type: 'design_doc',
          stage: 'design',
          title: '教学设计（整门课）',
          content: design,
          confirmed: false,
          status: 'draft',
          metadata: { source: 'manual-save', phase: 'phase-9' },
        });
      }

      return {
        success: true,
        data: { notebookId, artifactId: artifact?.id, design },
      };
    } catch (error) {
      console.error('[v2:saveDesign] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 确认 ───────────────────────────────────────────────────────────
  ipcMain.handle('v2:confirmDesign', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');

      const notebookId = Number(payload.notebookId);
      const artifactId = Number(payload.artifactId);

      if (!Number.isFinite(notebookId) || notebookId <= 0) {
        return { success: false, error: 'notebookId 无效' };
      }
      if (!Number.isFinite(artifactId) || artifactId <= 0) {
        return { success: false, error: 'artifactId 无效（请先保存教学设计再确认）' };
      }

      if (!db.updateArtifact) {
        return { success: false, error: 'db.updateArtifact 不存在' };
      }

      db.updateArtifact(artifactId, {
        confirmed: true,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });

      return {
        success: true,
        data: { notebookId, artifactId, confirmed: true },
      };
    } catch (error) {
      console.error('[v2:confirmDesign] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 读取 ───────────────────────────────────────────────────────────
  ipcMain.handle('v2:getDesignData', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');

      // Phase-9.5：支持两种调用形式
      //   getDesignDataV2(notebookId)              → 返回最新一份
      //   getDesignDataV2({ notebookId, artifactId }) → 返回指定 artifactId 的设计
      let id, wantedArtifactId = null;
      if (typeof notebookId === 'object' && notebookId !== null) {
        id = Number(notebookId.notebookId);
        wantedArtifactId = notebookId.artifactId ? Number(notebookId.artifactId) : null;
      } else {
        id = Number(notebookId);
      }
      if (!Number.isFinite(id) || id <= 0) {
        return { success: false, error: 'notebookId 无效' };
      }

      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId: id }) : [];
      const designArtifacts = allArtifacts
        .filter((a) => a.type === 'design_doc' && a.stage === 'design')
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

      // 选取目标 artifact：优先 wantedArtifactId，否则取最新
      let target = null;
      if (wantedArtifactId) {
        target = designArtifacts.find((a) => Number(a.id) === wantedArtifactId) || null;
      }
      if (!target) target = designArtifacts[0] || null;

      return {
        success: true,
        data: {
          notebookId: id,
          artifactId: target?.id || null,
          design: target?.content || null,
          confirmed: target?.confirmed || false,
          status: target?.status || null,
          history: designArtifacts.map((a) => ({
            id: a.id,
            confirmed: a.confirmed,
            status: a.status,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
          })),
        },
      };
    } catch (error) {
      console.error('[v2:getDesignData] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 导出 Word ──────────────────────────────────────────────────────────
  ipcMain.handle('v2:exportDesignWord', async (event, payload = {}) => {
    const { db, mainWindow } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(payload.notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };
      const notebook = db.getNotebookById(id);
      if (!notebook) return { success: false, error: 'Notebook not found' };

      const items = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId: id }) : [];
      const latest = items.find((a) => a.type === 'design_doc' && a.stage === 'design');
      if (!latest || !latest.content) {
        return { success: false, error: '尚未生成教学设计，无法导出' };
      }
      // 嵌入信息图：优先用老师标记的"最终版"（confirmed=true），否则用最新一张
      const allInfographics = items
        .filter((a) => a.type === 'design_infographic' && a.stage === 'design')
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      const chosenInfographic = allInfographics.find((a) => a.confirmed) || allInfographics[0] || null;
      const infographicPath = chosenInfographic?.storagePath || null;

      const win = mainWindow || null;
      const picked = await dialog.showSaveDialog(win, {
        title: '导出教学设计 Word',
        defaultPath: `${notebook.name || '课程'}-教学设计.docx`,
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };

      const outputPath = picked.filePath.endsWith('.docx') ? picked.filePath : `${picked.filePath}.docx`;
      await exportDesignWord({
        courseName: notebook.name || '课程',
        design: latest.content,
        outputPath,
        infographicPath,
      });

      if (typeof db.createArtifact === 'function') {
        db.createArtifact({
          notebookId: id,
          type: 'design_export_word',
          stage: 'design',
          title: `${notebook.name || '课程'}-教学设计 Word 导出`,
          content: { filePath: outputPath },
          format: 'docx',
          status: 'exported',
          confirmed: true,
          storagePath: outputPath,
          previewText: path.basename(outputPath),
          sourceArtifactIds: [latest.id],
        });
      }

      return { success: true, data: { filePath: outputPath } };
    } catch (error) {
      console.error('[v2:exportDesignWord] 异常：', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
