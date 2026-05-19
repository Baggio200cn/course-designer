/**
 * v2 教学实施报告 handlers（Phase-9 阶段 C-4 · v4.3.3 Codex Round 14 P1.1 升级 8 阶段对齐）
 *
 * 处理的 channel：
 *   v2:generateReport      生成教学实施报告（AI 汇总上游 7 阶段产物 · schedule/design/ppt/lecture/quiz/homework/video）
 *   v2:saveReport          保存（老师手填实施成效 / 反思改进后）
 *   v2:confirmReport       确认（最终阶段，无下游解锁）
 *   v2:getReportData       读取当前 notebookId 的实施报告
 *
 * artifact_type='implementation_report'，stage='report'
 *
 * 注意：
 *   - report 是 STAGE_ORDER 的最后阶段，confirm 后无下游可解锁，仅做归档标记
 *   - 生成时 AI 只填"自动汇总区"；老师手填实施成效 / 反思改进
 *   - 上游 7 阶段中任何一个 artifact 缺失都允许，AI 不得编造缺失阶段的内容
 */

const path = require('path');
const { dialog } = require('electron');
const reportSvc = require('../../services/report.service');
const { resolveProviderConfig, createAiClientByConfig } = require('../../api/provider-config');
const {
  exportReportWord,
  exportReportMarkdown,
  exportReportHtml,
  exportReportPdf,
} = require('../../export/report-export');

function pickLatestConfirmed(artifacts, type, stage) {
  return artifacts
    .filter((a) => a.type === type && a.stage === stage && a.confirmed)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
}

function register(ipcMain, getDeps) {
  // ── 生成 ───────────────────────────────────────────────────────────
  ipcMain.handle('v2:generateReport', async (event, payload = {}) => {
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
      if (!notebook) return { success: false, error: 'Notebook not found' };

      // v4.3.3 Codex Round 14 P1.1：取上游 7 阶段 confirmed artifact 作为 hint
      // schedule / design / ppt / lecture / quiz / homework / video
      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId }) : [];
      const scheduleData = pickLatestConfirmed(allArtifacts, 'schedule_table', 'schedule')?.content || null;
      const designData = pickLatestConfirmed(allArtifacts, 'design_doc', 'design')?.content || null;
      const pptData = pickLatestConfirmed(allArtifacts, 'ppt_outline', 'ppt')?.content || null;
      const lectureData = pickLatestConfirmed(allArtifacts, 'lecture_final', 'lecture')?.content || null;
      const quizData = pickLatestConfirmed(allArtifacts, 'quiz_set', 'quiz')?.content || null;
      const homeworkData = pickLatestConfirmed(allArtifacts, 'homework_set', 'homework')?.content || null;
      const microVideoData = pickLatestConfirmed(allArtifacts, 'video_prompt', 'video')?.content || null;

      const config = resolveProviderConfig({ payload, db });
      const aiClient = createAiClientByConfig(config);
      if (!aiClient) {
        return { success: false, error: '未配置有效的 AI 客户端' };
      }

      // v4.3.3 Codex Round 14 P1.1：H14 反模板化 · 不再硬编码"广州纺校"兜底
      //   缺失时留空，让 report.service 内部的"（未填，AI 请勿编造，从产物中查找）"提示生效
      const courseContext = {
        school: payload.school || notebook.school || '',
        academicYear: payload.academicYear || notebook.academicYear || '',
        term: payload.term || notebook.term || '',
        teacher: payload.teacher || notebook.teacher || '',
        softwareTools: notebook.softwareTools || '',
        jobTargets: notebook.jobTargets || '',
        industryScenarios: notebook.industryScenarios || '',
      };

      const result = await reportSvc.generate({
        aiClient,
        courseName: payload.courseName || notebook.name || '课程',
        scheduleData,
        designData,
        pptData,
        lectureData,
        // v4.3.3 Codex Round 14 P1.1：传入 quiz / homework 数据
        quizData,
        homeworkData,
        microVideoData,
        courseContext,
      });

      if (!result.success) return result;

      const artifact = db.createArtifact({
        notebookId,
        type: 'implementation_report',
        stage: 'report',
        title: `教学实施报告：${result.data.report.courseName || notebook.name || '本课程'}`,
        content: result.data.report,
        confirmed: false,
        status: 'draft',
        metadata: {
          generatedBy: 'report.service',
          phase: 'phase-9',
          upstreamCount: result.data.report._stats?.upstreamCount,
          upstreamSummary: result.data.report._stats?.upstreamSummary,
        },
      });

      return {
        success: true,
        data: {
          notebookId,
          artifactId: artifact?.id,
          report: result.data.report,
        },
      };
    } catch (error) {
      console.error('[v2:generateReport] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 保存（老师手填后） ──────────────────────────────────────────
  ipcMain.handle('v2:saveReport', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const artifactId = payload.artifactId ? Number(payload.artifactId) : null;
      const report = payload.report;

      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      if (!report || typeof report !== 'object') return { success: false, error: 'report 内容无效' };

      let artifact;
      if (artifactId && db.updateArtifact) {
        artifact = db.updateArtifact(artifactId, { content: report, status: 'draft' });
      } else {
        artifact = db.createArtifact({
          notebookId,
          type: 'implementation_report',
          stage: 'report',
          title: `教学实施报告：${report.courseName || '手动保存'}`,
          content: report,
          confirmed: false,
          status: 'draft',
          metadata: { source: 'manual-save', phase: 'phase-9' },
        });
      }

      return { success: true, data: { notebookId, artifactId: artifact?.id, report } };
    } catch (error) {
      console.error('[v2:saveReport] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 确认（最终阶段，仅归档标记） ─────────────────────────────
  ipcMain.handle('v2:confirmReport', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const artifactId = Number(payload.artifactId);
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      if (!Number.isFinite(artifactId) || artifactId <= 0) return { success: false, error: 'artifactId 无效' };
      if (!db.updateArtifact) return { success: false, error: 'db.updateArtifact 不存在' };

      db.updateArtifact(artifactId, {
        confirmed: true,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });

      return { success: true, data: { notebookId, artifactId, confirmed: true } };
    } catch (error) {
      console.error('[v2:confirmReport] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 读取 ───────────────────────────────────────────────────────────
  ipcMain.handle('v2:getReportData', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };

      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId: id }) : [];
      const reportArtifacts = allArtifacts
        .filter((a) => a.type === 'implementation_report' && a.stage === 'report')
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

      const latest = reportArtifacts[0] || null;
      return {
        success: true,
        data: {
          notebookId: id,
          artifactId: latest?.id || null,
          report: latest?.content || null,
          confirmed: latest?.confirmed || false,
          status: latest?.status || null,
          history: reportArtifacts.map((a) => ({
            id: a.id, confirmed: a.confirmed, status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt,
          })),
        },
      };
    } catch (error) {
      console.error('[v2:getReportData] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 导出 4 格式：Word / Markdown / HTML / PDF ──────────────────────────
  // 老师可选任一格式输出最终报告
  async function pickReportArtifact(notebookId) {
    const { db } = getDeps();
    const items = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId }) : [];
    const reports = items
      .filter((a) => a.type === 'implementation_report' && a.stage === 'report')
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    return reports[0] || null;
  }

  async function exportFlow({ payload, ext, label, exportFn }) {
    const { db, mainWindow } = getDeps();
    if (!db) throw new Error('Database not initialized');
    const id = Number(payload.notebookId);
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };
    const notebook = db.getNotebookById(id);
    if (!notebook) return { success: false, error: 'Notebook not found' };
    const reportArtifact = await pickReportArtifact(id);
    if (!reportArtifact) return { success: false, error: '尚未生成实施报告' };

    const picked = await dialog.showSaveDialog(mainWindow || null, {
      title: `导出实施报告 ${label}`,
      defaultPath: `${notebook.name || '课程'}-教学实施报告.${ext}`,
      filters: [{ name: label, extensions: [ext] }],
    });
    if (picked.canceled || !picked.filePath) return { cancelled: true };
    const outputPath = picked.filePath.endsWith(`.${ext}`) ? picked.filePath : `${picked.filePath}.${ext}`;
    await exportFn({ report: reportArtifact.content, outputPath });

    if (typeof db.createArtifact === 'function') {
      db.createArtifact({
        notebookId: id,
        type: `report_export_${ext}`,
        stage: 'report',
        title: `${notebook.name || '课程'}-教学实施报告 ${label} 导出`,
        content: { filePath: outputPath },
        format: ext,
        status: 'exported',
        confirmed: true,
        storagePath: outputPath,
        previewText: path.basename(outputPath),
        sourceArtifactIds: [reportArtifact.id],
      });
    }
    return { success: true, data: { filePath: outputPath } };
  }

  ipcMain.handle('v2:reportExportWord', async (event, payload = {}) => {
    try { return await exportFlow({ payload, ext: 'docx', label: 'Word', exportFn: exportReportWord }); }
    catch (e) { console.error('[v2:reportExportWord]', e); return { success: false, error: e.message }; }
  });
  ipcMain.handle('v2:reportExportMarkdown', async (event, payload = {}) => {
    try { return await exportFlow({ payload, ext: 'md', label: 'Markdown', exportFn: exportReportMarkdown }); }
    catch (e) { console.error('[v2:reportExportMarkdown]', e); return { success: false, error: e.message }; }
  });
  ipcMain.handle('v2:reportExportHtml', async (event, payload = {}) => {
    try { return await exportFlow({ payload, ext: 'html', label: 'HTML', exportFn: exportReportHtml }); }
    catch (e) { console.error('[v2:reportExportHtml]', e); return { success: false, error: e.message }; }
  });
  ipcMain.handle('v2:reportExportPdf', async (event, payload = {}) => {
    try { return await exportFlow({ payload, ext: 'pdf', label: 'PDF', exportFn: exportReportPdf }); }
    catch (e) { console.error('[v2:reportExportPdf]', e); return { success: false, error: e.message }; }
  });
}

module.exports = { register };
