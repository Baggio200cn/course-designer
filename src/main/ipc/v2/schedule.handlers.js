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
        totalHours: Number(payload.totalHours || notebook.totalHours) || 0,   // T7：禁止硬编码兜底
        theoryHours: Number(payload.theoryHours || notebook.theoryHours) || undefined,
        practiceHours: Number(payload.practiceHours || notebook.practiceHours) || undefined,
        // 2026-05-15 v4.1.4：每次课学时（必须由老师在创建/编辑上文时提供）
        hoursPerSession: Number(payload.hoursPerSession || notebook.hoursPerSession) || 0,
        // T8 修复（2026-05-17）：1 学时分钟数（必须由老师按学校标准提供，无兜底）
        minutesPerHour: Number(payload.minutesPerHour || notebook.minutesPerHour) || 0,
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
    const { db, ensureNotebookWorkspaceState } = getDeps();
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

      // 2026-05-15 老师反馈 4.1 加固：手编后必须走 normalize，避免老师删了字段后下游崩
      // 取 notebook 中的 teacher/className/totalHours 作为反编造断言的 ctx 输入
      const notebook = ensureNotebookWorkspaceState
        ? ensureNotebookWorkspaceState(db.getNotebookById(notebookId))
        : db.getNotebookById(notebookId);
      const ctx = {
        courseName: notebook?.name || schedule.header?.courseName || '课程',
        teacher: notebook?.teacher || '',
        className: notebook?.className || notebook?.audience || '',
        school: notebook?.school || '广州纺校',
        semester: notebook?.semester || '',
        department: notebook?.department || '',
        textbook: notebook?.textbook || notebook?.teachingMaterials || '',
        totalHours: Number(notebook?.totalHours) || Number(schedule.header?.totalHours) || 0,  // T7
        // 2026-05-15 v4.1.4：手动保存时也带 hoursPerSession（含老数据从已存进度表读）
        hoursPerSession: Number(notebook?.hoursPerSession)
          || Number(schedule.header?.hoursPerSession)
          || 0,
        // T8（2026-05-17）：1 学时分钟数（老师按学校标准配，无兜底）
        minutesPerHour: Number(notebook?.minutesPerHour)
          || Number(schedule.header?.minutesPerHour)
          || 0,
      };
      const normalized = scheduleSvc.normalizeFromUserEdit(schedule, ctx);

      // 如有 artifactId，更新；否则新建 draft
      let artifact;
      if (artifactId && db.updateArtifact) {
        artifact = db.updateArtifact(artifactId, { content: normalized, status: 'draft' });
      } else {
        artifact = db.createArtifact({
          notebookId,
          type: 'schedule_table',
          stage: 'schedule',
          title: `${normalized.header?.totalHours || '?'} 学时教学进度表`,   // T7
          content: normalized,
          confirmed: false,
          status: 'draft',
          metadata: { source: 'manual-save', phase: 'phase-9', normalized: true },
        });
      }

      // P6 修复（2026-05-18）：默认场景（AI 自家生成 / 老师手编辑保存）不返回 importAudit
      //   原因：normalize 内部的 detectScheduleFieldGaps 把"AI 没显式返回的字段（已用默认值兜底）"也当成"缺失警告"，
      //   对老师造成困惑（"我表格里 method 明明有值'讲授'啊？"）
      //   仅 v2:validateScheduleJson（老师手动粘贴外部 AI 生成的 JSON）路径才需要 alias 兼容报告
      return {
        success: true,
        data: {
          notebookId,
          artifactId: artifact?.id,
          schedule: normalized,
          // importAudit 已下线（不再误报）
        },
      };
    } catch (error) {
      console.error('[v2:saveSchedule] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 宽容解析进度表 JSON（供 UI 端"JSON 编辑模式"保存前预校验） ───────
  // 2026-05-15 新增：把宽容解析 + 行列错误定位放到主进程，供 V2App.handleSaveSchedule 用
  ipcMain.handle('v2:validateScheduleJson', async (event, payload = {}) => {
    try {
      const rawText = String(payload.jsonText || '');
      const result = scheduleSvc.tolerantParseSchedule(rawText);
      if (result.error) {
        return { success: false, error: result.error, line: result.line, column: result.column };
      }
      // 2026-05-15 v4.1.3：把 alias 兼容审计带回前端供 UI 显示
      return {
        success: true,
        data: result.data,
        repaired: !!result.repaired,
        aliasesUsed: result.aliasesUsed || [],
        importWarnings: result.importWarnings || [],
      };
    } catch (error) {
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

      // v4.3.3 Codex #5：上游 schedule 改 → 整条下游链全标 dirty
      if (typeof db.markDownstreamDirty === 'function') {
        try { db.markDownstreamDirty(notebookId, 'schedule', 'schedule-confirmed'); } catch (_) {}
      }

      // contracts.computeUnlockedStages 会基于新 artifact 自然解锁 design 阶段
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
    const { db, ensureNotebookWorkspaceState } = getDeps();
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

      // T6 修复（2026-05-17）：老数据加载时过一次 idempotent normalize
      //   场景：v4.1 时代存的 schedule.chapter='一（续）'，新版下游按 chapter 聚合会拆错。
      //   normalize 会自动拆出 chapterSub/chapterDisplay/补 _stats 等新字段，新数据无害。
      let scheduleContent = latest?.content || null;
      if (scheduleContent && typeof scheduleContent === 'object' && Array.isArray(scheduleContent.schedule)) {
        try {
          const nb = ensureNotebookWorkspaceState
            ? ensureNotebookWorkspaceState(db.getNotebookById(id))
            : db.getNotebookById(id);
          const ctx = {
            courseName: nb?.name || scheduleContent.header?.courseName || '课程',
            teacher: nb?.teacher || '',
            className: nb?.className || nb?.audience || '',
            school: nb?.school || '',                       // T7：删"广州纺校"硬编码
            semester: nb?.semester || '',
            department: nb?.department || '',
            textbook: nb?.textbook || nb?.teachingMaterials || '',
            totalHours: Number(nb?.totalHours) || Number(scheduleContent.header?.totalHours) || 0,  // T7
            hoursPerSession: Number(nb?.hoursPerSession) || Number(scheduleContent.header?.hoursPerSession) || 0,
            minutesPerHour: Number(nb?.minutesPerHour) || Number(scheduleContent.header?.minutesPerHour) || 0,  // T8
          };
          scheduleContent = scheduleSvc.normalizeFromUserEdit(scheduleContent, ctx);
        } catch (e) {
          console.warn('[v2:getScheduleData] T6 normalize 失败（回退原数据，不阻塞）:', e.message);
        }
      }

      return {
        success: true,
        data: {
          notebookId: id,
          artifactId: latest?.id || null,
          schedule: scheduleContent,
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
      // T6 修复（2026-05-17）：导出前过一次 idempotent normalize（保护老 artifact 导出仍正确）
      let exportSchedule = latest.content;
      if (exportSchedule && typeof exportSchedule === 'object' && Array.isArray(exportSchedule.schedule)) {
        try {
          const ctx = {
            courseName: notebook?.name || exportSchedule.header?.courseName || '课程',
            teacher: notebook?.teacher || '',
            className: notebook?.className || notebook?.audience || '',
            school: notebook?.school || '',                  // T7
            semester: notebook?.semester || '',
            department: notebook?.department || '',
            textbook: notebook?.textbook || notebook?.teachingMaterials || '',
            totalHours: Number(notebook?.totalHours) || Number(exportSchedule.header?.totalHours) || 0,  // T7
            hoursPerSession: Number(notebook?.hoursPerSession) || Number(exportSchedule.header?.hoursPerSession) || 0,
            minutesPerHour: Number(notebook?.minutesPerHour) || Number(exportSchedule.header?.minutesPerHour) || 0,  // T8
          };
          exportSchedule = scheduleSvc.normalizeFromUserEdit(exportSchedule, ctx);
        } catch (e) {
          console.warn('[v2:exportScheduleWord] T6 normalize 失败（回退原数据，不阻塞）:', e.message);
        }
      }
      await exportScheduleWord({ schedule: exportSchedule, outputPath });

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
