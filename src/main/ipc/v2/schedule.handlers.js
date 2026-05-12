/**
 * v2 教学进度表 handlers（Phase-9 阶段 C-1）
 *
 * 处理的 channel：
 *   v2:generateSchedule    生成进度表（AI 调用）
 *   v2:saveSchedule        保存进度表（老师手改后）
 *   v2:confirmSchedule     确认进度表（解锁下游 design 阶段）
 *   v2:getScheduleData     读取当前 notebookId 的进度表 artifact
 *
 * getDeps() 返回：{ db, ensureNotebookWorkspaceState }
 *
 * 数据持久化：
 *   - 不走 v2Runtime（按 .claude/notes/2026-05-09-phase9-runtime-strategy.md 决策）
 *   - 直接 db.createArtifact / db.updateArtifact，type='schedule_table'，stage='schedule'
 */

const path = require('path');
const { dialog } = require('electron');
const scheduleSvc = require('../../services/schedule.service');
const { resolveProviderConfig, createAiClientByConfig } = require('../../api/provider-config');
const { exportScheduleWord } = require('../../export/schedule-word');

function register(ipcMain, getDeps) {
  // ── 生成 ───────────────────────────────────────────────────────────────
  ipcMain.handle('v2:generateSchedule', async (event, payload = {}) => {
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

      // AI 客户端
      const config = resolveProviderConfig({ payload, db });
      const aiClient = createAiClientByConfig(config);
      if (!aiClient) {
        return { success: false, error: '未配置有效的 AI 客户端（先在右上角"API 配置"里填）' };
      }

      // 课程上下文：从 notebook 字段 + payload 合并
      const courseContext = {
        teacher: payload.teacher || notebook.teacher || '',
        school: payload.school || notebook.school || '广州纺校',
        department: payload.department || notebook.department || '',
        semester: payload.semester || notebook.semester || '',
        className: payload.className || notebook.className || notebook.audience || '',
        textbook: payload.textbook || notebook.textbook || notebook.teachingMaterials || '',
        totalHours: Number(payload.totalHours || notebook.totalHours) || 72,
        theoryHours: Number(payload.theoryHours || notebook.theoryHours) || undefined,
        practiceHours: Number(payload.practiceHours || notebook.practiceHours) || undefined,
        courseGoal: payload.courseGoal || notebook.description || '',
        softwareTools: notebook.softwareTools || '',
        jobTargets: notebook.jobTargets || '',
        industryScenarios: notebook.industryScenarios || '',
      };

      // 调用 service
      const result = await scheduleSvc.generate({
        aiClient,
        courseName: payload.courseName || notebook.name || '课程',
        courseContext,
      });

      if (!result.success) {
        return result;
      }

      // 写入 artifact（type='schedule_table'，stage='schedule'，confirmed=false）
      const artifact = db.createArtifact({
        notebookId,
        type: 'schedule_table',
        stage: 'schedule',
        title: `${courseContext.totalHours} 学时教学进度表`,
        content: result.data.schedule,
        confirmed: false,
        status: 'draft',
        metadata: {
          generatedBy: 'schedule.service',
          phase: 'phase-9',
          rowCount: result.data.schedule.schedule.length,
        },
      });

      return {
        success: true,
        data: {
          notebookId,
          artifactId: artifact?.id,
          schedule: result.data.schedule,
        },
      };
    } catch (error) {
      console.error('[v2:generateSchedule] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 保存（老师手改后写回） ────────────────────────────────────────────
  ipcMain.handle('v2:saveSchedule', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');

      const notebookId = Number(payload.notebookId);
      const artifactId = payload.artifactId ? Number(payload.artifactId) : null;
      const schedule = payload.schedule;

      if (!Number.isFinite(notebookId) || notebookId <= 0) {
        return { success: false, error: 'notebookId 无效' };
      }
      if (!schedule || typeof schedule !== 'object') {
        return { success: false, error: 'schedule 内容为空或非对象' };
      }

      // 如有 artifactId，更新；否则新建 draft
      let artifact;
      if (artifactId && db.updateArtifact) {
        artifact = db.updateArtifact(artifactId, { content: schedule, status: 'draft' });
      } else {
        artifact = db.createArtifact({
          notebookId,
          type: 'schedule_table',
          stage: 'schedule',
          title: `${schedule.header?.totalHours || 72} 学时教学进度表`,
          content: schedule,
          confirmed: false,
          status: 'draft',
          metadata: { source: 'manual-save', phase: 'phase-9' },
        });
      }

      return {
        success: true,
        data: { notebookId, artifactId: artifact?.id, schedule },
      };
    } catch (error) {
      console.error('[v2:saveSchedule] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 确认（触发 stage 解锁） ─────────────────────────────────────────
  ipcMain.handle('v2:confirmSchedule', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');

      const notebookId = Number(payload.notebookId);
      const artifactId = Number(payload.artifactId);

      if (!Number.isFinite(notebookId) || notebookId <= 0) {
        return { success: false, error: 'notebookId 无效' };
      }
      if (!Number.isFinite(artifactId) || artifactId <= 0) {
        return { success: false, error: 'artifactId 无效（请先保存进度表再确认）' };
      }

      if (!db.updateArtifact) {
        return { success: false, error: 'db.updateArtifact 不存在（数据库版本不兼容）' };
      }

      const artifact = db.updateArtifact(artifactId, {
        confirmed: true,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });

      // contracts.computeUnlockedStages 会基于新 artifact 自然解锁 design 阶段
      // （前端拿 stageData 时会重新计算 unlockedStages）

      return {
        success: true,
        data: {
          notebookId,
          artifactId,
          confirmed: true,
        },
      };
    } catch (error) {
      console.error('[v2:confirmSchedule] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 读取当前进度表 ──────────────────────────────────────────────────────
  ipcMain.handle('v2:getScheduleData', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');

      const id = Number(notebookId);
      if (!Number.isFinite(id) || id <= 0) {
        return { success: false, error: 'notebookId 无效' };
      }

      // 取最新的 schedule_table artifact
      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId: id }) : [];
      const scheduleArtifacts = allArtifacts
        .filter((a) => a.type === 'schedule_table' && a.stage === 'schedule')
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

      const latest = scheduleArtifacts[0] || null;

      return {
        success: true,
        data: {
          notebookId: id,
          artifactId: latest?.id || null,
          schedule: latest?.content || null,
          confirmed: latest?.confirmed || false,
          status: latest?.status || null,
          history: scheduleArtifacts.map((a) => ({
            id: a.id,
            confirmed: a.confirmed,
            status: a.status,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
          })),
        },
      };
    } catch (error) {
      console.error('[v2:getScheduleData] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 导出 Word ──────────────────────────────────────────────────────────
  ipcMain.handle('v2:exportScheduleWord', async (event, payload = {}) => {
    const { db, mainWindow } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(payload.notebookId);
      if (!Number.isFinite(id) || id <= 0) {
        return { success: false, error: 'notebookId 无效' };
      }
      const notebook = db.getNotebookById(id);
      if (!notebook) return { success: false, error: 'Notebook not found' };

      // 取最新 schedule_table artifact
      const items = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId: id }) : [];
      const latest = items.find((a) => a.type === 'schedule_table' && a.stage === 'schedule');
      if (!latest || !latest.content) {
        return { success: false, error: '尚未生成进度表，无法导出' };
      }

      const win = mainWindow || null;
      const picked = await dialog.showSaveDialog(win, {
        title: '导出教学进度表 Word',
        defaultPath: `${notebook.name || '课程'}-教学进度表.docx`,
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };

      const outputPath = picked.filePath.endsWith('.docx') ? picked.filePath : `${picked.filePath}.docx`;
      await exportScheduleWord({ schedule: latest.content, outputPath });

      // 写一条 export artifact，便于 ArtifactPanel 显示
      if (typeof db.createArtifact === 'function') {
        db.createArtifact({
          notebookId: id,
          type: 'schedule_export_word',
          stage: 'schedule',
          title: `${notebook.name || '课程'}-教学进度表 Word 导出`,
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
      console.error('[v2:exportScheduleWord] 异常：', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
