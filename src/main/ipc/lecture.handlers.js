/**
 * 讲稿生成 + 质量审计 handlers — 4 个 IPC handlers
 *
 * 处理的 channel：
 *   script:generateABC, script:generateFormal,
 *   quality:auditStyle, quality:auditNotebook
 *
 * 注意：schedule:get / schedule:save 不在这里，属于 system.handlers.js。
 *
 * 稳定依赖（直接 require）：
 *   script/abc-generator, script/formal-generator, script/style-rubric,
 *   quality/style-audit, quality/audit, api/provider-config
 *
 * 运行时依赖（通过 getDeps 惰性获取）：
 *   { db, patchCourseProject }
 */

const { generateLectureABCDrafts } = require('../script/abc-generator');
const { normalizeTeacherStyleRubric } = require('../script/style-rubric');
const { auditLectureStyle } = require('../quality/style-audit');
const { auditNotebookQuality } = require('../quality/audit');
const { resolveProviderConfig, createAiClientByConfig } = require('../api/provider-config');
const { reviewAndRevise } = require('../services/review.service');      // Phase-5B: AI review loop
const { generateWithRetry } = require('../agent/retry-loop');           // Phase-5C: Auto-Retry
const { buildLectureContext } = require('../agent/context-builder');    // Phase-5C: Cross-Stage Context

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  /** 用当前 db 的 API key 配置创建 AI 客户端
   *
   * Phase-7.7 B6（2026-04-29）：加可选 purpose 参数。
   *   - createAiClient(payload)                     → 通用 endpoint（向后兼容）
   *   - createAiClient(payload, 'lecture_formal')   → 正式稿专用 endpoint，缺则 fallback
   */
  function createAiClient(payload, purpose) {
    const { db } = getDeps();
    const config = resolveProviderConfig({ payload, db, purpose });
    return createAiClientByConfig(config);
  }

  /**
   * 生成讲稿三稿（A/B/C）
   * A = 精讲版，B = 互动版，C = 精简版
   * 生成后附带 auditLectureStyle 的风格评分
   */
  ipcMain.handle('script:generateABC', async (event, payload = {}) => {
    const { db, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const notebook = notebookId ? db.getNotebookById(notebookId) : null;
      const modules = notebookId ? db.getModulesByNotebook(notebookId) : [];
      const aiClient = createAiClient(payload);
      const courseName = payload.courseName || notebook?.name || '课程';
      // Phase-5C Cross-Stage：从框架阶段读取教学目标注入讲稿生成
      const frameworkCtx = buildLectureContext(db, notebookId);
      const result = await generateLectureABCDrafts({
        courseName,
        modules: payload.modules || modules,
        styleRubricText: payload.styleRubricText || '',
        aiClient,
        totalHours: Number(notebook?.totalHours) || Number(payload.totalHours) || 1,
        notebookContext: {
          softwareTools: notebook?.softwareTools || '',
          jobTargets: notebook?.jobTargets || '',
          industryScenarios: notebook?.industryScenarios || '',
          learnerProfile: notebook?.learnerProfile || '',
          // Phase-5C：上游框架阶段输出
          frameworkObjectives: frameworkCtx.frameworkObjectives,
          frameworkTeachingMethods: frameworkCtx.frameworkTeachingMethods,
          // 参考资料：老师提供的 URL/文档内容，注入 A/B/C 用于精准化专业术语和案例
          referenceContext: String(payload.referenceContext || '').slice(0, 6000)
        }
      });
      const audit = {
        a: auditLectureStyle({ text: result.a, styleRubric: result.style }),
        b: auditLectureStyle({ text: result.b, styleRubric: result.style }),
        c: auditLectureStyle({ text: result.c, styleRubric: result.style })
      };
      if (Number.isFinite(notebookId) && notebookId > 0) {
        patchCourseProject(notebookId, {
          lectureDrafts: { a: result.a || '', b: result.b || '', c: result.c || '' },
          lectureDraftAudit: audit,
          dirty: true,
          dirtyReason: 'lecture-drafts-generated',
          dirtyAt: new Date().toISOString()
        });
      }
      return { success: true, data: { ...result, audit } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * 生成正式讲稿（Phase-5C：接入 Auto-Retry Loop）
   *
   * 流程：
   *  1. generateWithRetry — 最多 3 次自动重试，每次把质量问题反馈给 AI
   *  2. reviewAndRevise  — 有富上下文时做 AI 审核 + 自动修订（Phase-5B 保留）
   *  3. auditLectureStyle — 风格审计（纯函数）
   */
  ipcMain.handle('script:generateFormal', async (event, payload = {}) => {
    const { db, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const notebook = notebookId ? db.getNotebookById(notebookId) : null;
      const modules = notebookId ? db.getModulesByNotebook(notebookId) : [];
      // B6：正式稿生成走专用 endpoint（如配置）；其他 lecture 路径仍走通用
      const aiClient = createAiClient(payload, 'lecture_formal');
      const styleRubricText = payload.styleRubricText || '';
      const courseName = payload.courseName || notebook?.name || '课程';
      const totalHours = Number(notebook?.totalHours) || Number(payload.totalHours) || 1;
      // Phase-5C Cross-Stage：从框架阶段读取教学目标注入正式讲稿生成
      const frameworkCtxFormal = buildLectureContext(db, notebookId);
      const notebookContext = {
        softwareTools: notebook?.softwareTools || '',
        jobTargets: notebook?.jobTargets || '',
        industryScenarios: notebook?.industryScenarios || '',
        learnerProfile: notebook?.learnerProfile || '',
        // Phase-5C：上游框架阶段输出
        frameworkObjectives: frameworkCtxFormal.frameworkObjectives,
        frameworkTeachingMethods: frameworkCtxFormal.frameworkTeachingMethods,
        // Phase-5C：老师提供的参考资料（教案/URL 提取文本/DOCX 内容）
        referenceContext: String(payload.referenceContext || '').slice(0, 5000),
        // Phase-8.5：注入 totalHours 给 review.service 用于课时连贯性审核
        totalHours
      };

      // ── Phase-5C: Auto-Retry Loop ─────────────────────────────────────────
      // generateWithRetry 内部调用 generateFormalLectureScript，
      // 每次生成后用 validateLectureStage 检验，不达标则注入质量反馈重试
      const { result, quality: retryQuality, attempts, exhausted, attemptLog } = await generateWithRetry(
        {
          drafts: payload.drafts || {},
          preferred: payload.preferred || 'a',
          styleRubricText,
          courseName,
          modules: payload.modules || modules,
          aiClient,
          totalHours,
          notebookContext
        },
        {
          maxAttempts: 3,
          onAttempt: ({ attempt: n, narrationCount, accepted }) => {
            console.log(`[lecture.handlers] generateFormal attempt ${n}: narration=${narrationCount}, accepted=${accepted}`);
          }
        }
      );
      // ── End Auto-Retry ────────────────────────────────────────────────────

      // ── Phase-5B: AI Review Loop ──────────────────────────────────────────
      // 只在有富上下文且 payload 未明确跳过审核时触发
      const hasRichContext = Boolean(notebookContext.softwareTools || notebookContext.jobTargets);
      const skipReview = payload.skipReview === true;
      let reviewMeta = null;
      let finalScript = result.script || '';

      if (hasRichContext && !skipReview && aiClient) {
        reviewMeta = await reviewAndRevise({
          script: finalScript,
          notebookContext,
          aiClient,
          autoRevise: true
        });
        // 若 AI 修订成功且修订稿长度合理，使用修订稿
        if (reviewMeta.revised_success && reviewMeta.revised) {
          finalScript = reviewMeta.revised;
        }
      }
      // ── End Review Loop ───────────────────────────────────────────────────

      const styleRubric = normalizeTeacherStyleRubric(styleRubricText);
      const audit = auditLectureStyle({ text: finalScript, styleRubric });
      const dirtyReason = exhausted
        ? 'final-lecture-generated-retry-exhausted'
        : reviewMeta?.revised_success
          ? 'final-lecture-generated-revised'
          : 'final-lecture-generated';

      if (Number.isFinite(notebookId) && notebookId > 0) {
        patchCourseProject(notebookId, {
          finalLectureScript: finalScript,
          finalLectureAudit: audit,
          dirty: true,
          dirtyReason,
          dirtyAt: new Date().toISOString()
        });
      }

      return {
        success: true,
        data: {
          ...result,
          script: finalScript,
          audit,
          // Agent 元数据：重试情况
          agentMeta: {
            attempts,
            exhausted,
            attemptLog,
            finalNarrationCharCount: retryQuality.checks?.finalNarrationCharCount || 0
          },
          // Phase-5B：审核结果（Phase-8.5 扩展 subscores 4 维度）
          review: reviewMeta ? {
            score: reviewMeta.score,
            issues: reviewMeta.issues,
            summary: reviewMeta.summary,
            revised: reviewMeta.revised_success,
            // Phase-8.5：素材融合深度 / 五段式 / 课时连贯性 / 版权安全 4 项子分
            subscores: reviewMeta.subscores || null
          } : null
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 对单段文本做风格审计（纯函数，不调 AI，不访问 db）
  ipcMain.handle('quality:auditStyle', async (event, payload = {}) => {
    try {
      const styleRubric = normalizeTeacherStyleRubric(payload.styleRubricText || '');
      const audit = auditLectureStyle({ text: payload.text || '', styleRubric });
      return { success: true, data: audit };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 对整个笔记本做综合质量审计（框架完整性/模块覆盖/进度表一致性）
  ipcMain.handle('quality:auditNotebook', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebook = db.getNotebookById(notebookId);
      const modules = db.getModulesByNotebook(notebookId);
      const schedule = db.getTeachingSchedule(notebookId);
      const framework = db.getCurrentFramework(notebookId);
      const audit = auditNotebookQuality({ notebook, modules, schedule, framework });
      return { success: true, data: audit };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
