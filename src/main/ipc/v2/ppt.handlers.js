/**
 * v2 PPT 阶段 handlers — 5 个 IPC handlers
 *
 * 处理的 channel：
 *   v2:getPptStageData, v2:savePptStage,
 *   v2:confirmPptStage, v2:generatePptPageCandidates,
 *   v2:generatePptPlan（Phase-5C 新增：AI 驱动的 PPT 页面规划）
 *
 * 所有 handler 都是 v2Runtime 方法的薄包装，不含业务逻辑。
 * getDeps() 返回：{ v2Runtime, db }
 */

const fs   = require('fs');
const path = require('path');

const { generatePptPlan } = require('../../script/ppt-plan-generator');
// 2026-05-15 问题二重构：双阶段 pipeline（大纲 → 逐页详情）
const { generatePptPlanV2 } = require('../../script/ppt-pipeline-v2');
// v4.3.0 D1+D2（2026-05-18）：PPT 视觉 token AI 推荐
const { suggestAccentColors, suggestImageStyle, IMAGE_STYLE_PRESETS } = require('../../services/ppt-design-tokens.service');
// 2026-05-15 P2-3：动态练习 HTML 重建（老师编辑题目后）
const { buildExerciseHtml } = require('../../services/ppt-dynamic-exercise.service');
const { resolveProviderConfig, createAiClientByConfig } = require('../../api/provider-config');
const { buildPptContext } = require('../../agent/context-builder');  // Phase-5D：讲稿→PPT 跨阶段上下文

/**
 * 2026-05-16 v4.2.0 Phase A'-3：serializeDesignAsScript 已退休
 *
 * 原方案是把 design.content 摊平成"伪讲稿"字符串再喂给 pipeline 按文本锚点切片，
 * 是从 v4.1.x lecture-based pipeline 过渡到 design-first 的临时桥接方案。
 *
 * Phase A'-3 起：pipeline 直接接收 designContent + lessonMeta，
 * 内部用 _sliceDesignBySection 按 sourceDesignSection 枚举切片，
 * 与 prompts/ppt-outline.md 的 14 个枚举值严格对齐。
 *
 * 此处函数保留为空 stub 仅为防止外部误调用报错——未来 Phase B 可彻底删除。
 */

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  function createAiClient(payload) {
    const { db } = getDeps();
    const config = resolveProviderConfig({ payload, db });
    return createAiClientByConfig(config);
  }

  ipcMain.handle('v2:getPptStageData', async (event, notebookId) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.getPptStageData(notebookId);
  });

  ipcMain.handle('v2:savePptStage', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    // Phase-6 M2.2：IPC 来源即用户操作，注入 _userInitiated 让 runtime 自动加锁
    return v2Runtime.savePptStage({ ...payload, _userInitiated: true });
  });

  ipcMain.handle('v2:confirmPptStage', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.confirmPptStage({ ...payload, _userInitiated: true });
  });

  // 生成 PPT 页面候选内容（AI 调用，由 v2Runtime 管理重试和状态）
  ipcMain.handle('v2:generatePptPageCandidates', async (event, payload = {}) => {
    const { v2Runtime } = getDeps();
    return v2Runtime.generatePptPageCandidates(payload);
  });

  /**
   * AI 驱动的 PPT 页面规划（Phase-5C 新增）
   *
   * 接收讲稿 + 课程信息，调用 generatePptPlan 生成完整页面规划。
   * 返回结构化 page 数组，包含 pageType / title / keyContent / speakerNotes。
   */
  // v4.3.0 D1+D2（2026-05-18）：PPT 视觉 token AI 推荐
  //   切到 PPT 阶段时调用，AI 推 3-5 个主色候选 + 1 个配图风格 preset
  //   老师可自定义覆盖（H14 反编造：AI 推但不锁）
  ipcMain.handle('v2:suggestPptDesignTokens', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      const notebookId = Number(payload.notebookId);
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const config = resolveProviderConfig({ payload, db });
      const aiClient = createAiClientByConfig(config);
      const courseContext = {
        industryScenarios: notebook.industryScenarios || '',
        jobTargets: notebook.jobTargets || '',
        learnerProfile: notebook.learnerProfile || '',
        softwareTools: notebook.softwareTools || '',
      };
      const [colorResult, styleResult] = await Promise.all([
        suggestAccentColors({ aiClient, courseName: notebook.name || '', courseContext }),
        suggestImageStyle({ aiClient, courseName: notebook.name || '', courseContext }),
      ]);
      return {
        success: true,
        data: {
          accentCandidates: colorResult.candidates,
          recommendedAccent: colorResult.recommended,
          imageStylePreset: styleResult.preset,
          imageStyleReason: styleResult.reason,
          allImageStylePresets: styleResult.allPresets,
          _aiFallback: colorResult._fallback || styleResult._fallback || false,
        },
      };
    } catch (e) {
      console.error('[v2:suggestPptDesignTokens] 异常:', e);
      return { success: false, error: e.message };
    }
  });

  // 2026-05-16 v4.2.0 Phase A'-8：列出所有已确认的 design_doc，供 PPT 阶段"目标节课"选择器使用
  //   v4.2.0 新工作流：PPT 基于 design 生成（不再基于 lecture）
  //   旧 v2:listConfirmedLessons 仍保留供 v4.1.x 兼容
  ipcMain.handle('v2:listConfirmedDesigns', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };
      const items = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId: id }) : [];
      const designs = items
        .filter((a) => a.type === 'design_doc' && a.stage === 'design' && a.status !== 'deleted' && a.confirmed)
        .sort((a, b) => {
          const ln = (Number(a.metadata?.lessonNumber) || 0) - (Number(b.metadata?.lessonNumber) || 0);
          if (ln !== 0) return ln;
          return new Date(a.createdAt) - new Date(b.createdAt);
        })
        .map((a) => {
          // P6 修复（2026-05-18）：design.handlers 在 createArtifact 时没把 lessonMeta 同步到 metadata
          //   → 老师在 PPT 阶段看到「第 0 节·未命名（0 学时）」
          //   修：fallback 从 content.lessonMeta 取
          const meta = a.metadata || {};
          const lm = (a.content && a.content.lessonMeta) || {};
          const lessonNumber = Number(meta.lessonNumber) || Number(lm.lessonNumber) || 0;
          const topic = meta.topic || lm.topic || '';
          const chapter = meta.chapter || lm.chapter || '';
          const theory = Number(meta.theoryHours) || Number(lm.theoryHours) || 0;
          const practice = Number(meta.practiceHours) || Number(lm.practiceHours) || 0;
          return {
            designId: a.id,
            lessonNumber,
            topic,
            chapter,
            theoryHours: theory,
            practiceHours: practice,
            totalHours: theory + practice,
            updatedAt: a.updatedAt,
          };
        });
      // P6（2026-05-18）：加诊断日志，让 dev log 能看到拉到的 design 列表
      console.log(`[v2:listConfirmedDesigns] notebookId=${id} → ${designs.length} 个 confirmed design:`,
        designs.map(d => `第${d.lessonNumber}节·${d.topic||'?'}`).join(' / ') || '（空）');
      return { success: true, data: { designs } };
    } catch (e) {
      console.error('[v2:listConfirmedDesigns] 异常：', e);
      return { success: false, error: e.message };
    }
  });

  // 2026-05-16 v4.1.4 真 P2：列出所有已确认的 lecture_final（v4.1.x 兼容）
  ipcMain.handle('v2:listConfirmedLessons', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };
      const items = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId: id }) : [];
      const lessons = items
        .filter((a) => a.type === 'lecture_final' && a.stage === 'lecture' && a.status !== 'deleted' && a.confirmed)
        .sort((a, b) => {
          const ln = (Number(a.metadata?.lessonNumber) || 0) - (Number(b.metadata?.lessonNumber) || 0);
          if (ln !== 0) return ln;
          return new Date(a.createdAt) - new Date(b.createdAt);
        })
        .map((a) => {
          const meta = a.metadata || {};
          const theory = Number(meta.theoryHours) || 0;
          const practice = Number(meta.practiceHours) || 0;
          return {
            lessonId: a.id,
            lessonNumber: meta.lessonNumber || 0,
            topic: meta.topic || '',
            chapter: meta.chapter || '',
            theoryHours: theory,
            practiceHours: practice,
            totalHours: theory + practice,
            updatedAt: a.updatedAt,
          };
        });
      return { success: true, data: { lessons } };
    } catch (e) {
      console.error('[v2:listConfirmedLessons] 异常：', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('v2:generatePptPlan', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const notebook = notebookId ? db.getNotebookById(notebookId) : null;
      const modules = notebookId ? db.getModulesByNotebook(notebookId) : [];
      const aiClient = createAiClient(payload);

      // 2026-05-16 v4.2.0 Phase A'：PPT 工作流顺序重构
      //   新顺序：schedule → design → PPT → lecture
      //   PPT 现在直接基于 design 生成（不再依赖 lecture）
      //
      //   target 优先级：
      //   ① payload.designId（前端显式传）
      //   ② session.activeDesignArtifactId（会话上下文）
      //   ③ 只有 1 节确认 design → 自动用
      //   ④ 多节确认 design 但未选 → 报错
      //   ⑤ 老 lecture-based 数据兼容：若没 design 但有 lecture，回落老逻辑（v4.1.x 旧数据用户）
      let targetDesign = null;
      let targetLesson = null;  // 兼容字段，部分代码仍用
      const wantedDesignId = payload.designId ? Number(payload.designId) : null;
      const wantedLessonId = payload.lessonId ? Number(payload.lessonId) : null;
      const allConfirmedDesigns = notebookId && typeof db.listArtifacts === 'function'
        ? db.listArtifacts({ notebookId, type: 'design_doc', stage: 'design' })
            .filter((a) => a.confirmed && a.status !== 'deleted')
        : [];

      if (wantedDesignId) {
        targetDesign = allConfirmedDesigns.find((a) => Number(a.id) === wantedDesignId) || null;
      }
      if (!targetDesign && typeof db.getSessionContext === 'function') {
        const sessionCtx = db.getSessionContext(notebookId);
        const sessionDesignId = Number(sessionCtx?.activeDesignArtifactId) || null;
        if (sessionDesignId) {
          targetDesign = allConfirmedDesigns.find((a) => Number(a.id) === sessionDesignId) || null;
          if (targetDesign) {
            console.log(`[v2:generatePptPlan] 走会话上下文：activeDesignArtifactId=${sessionDesignId} (第 ${targetDesign.metadata?.lessonNumber} 节·${targetDesign.metadata?.topic})`);
          }
        }
      }
      if (!targetDesign && allConfirmedDesigns.length === 1) {
        targetDesign = allConfirmedDesigns[0];
        console.log(`[v2:generatePptPlan] 唯一确认设计 → 第 ${targetDesign.metadata?.lessonNumber} 节`);
      }
      if (!targetDesign && allConfirmedDesigns.length > 1) {
        return {
          success: false,
          error: `检测到 ${allConfirmedDesigns.length} 节已确认教学设计但未指定目标节课。请在顶部面包屑里切到目标节课。`,
        };
      }

      // 老 lecture-based 兼容：若没 design 但有 lecture（v4.1.x 老用户）
      if (!targetDesign) {
        const allConfirmedLectures = notebookId && typeof db.listArtifacts === 'function'
          ? db.listArtifacts({ notebookId, type: 'lecture_final', stage: 'lecture' })
              .filter((a) => a.confirmed && a.status !== 'deleted')
          : [];
        if (wantedLessonId) {
          targetLesson = allConfirmedLectures.find((a) => Number(a.id) === wantedLessonId) || null;
        }
        if (!targetLesson && allConfirmedLectures.length === 1) {
          targetLesson = allConfirmedLectures[0];
        }
        if (targetLesson) {
          console.log(`[v2:generatePptPlan] 老 v4.1.x 兼容模式：基于 lecture 生成（建议改用 design）`);
        }
      }

      // 至少要有 design 或 lecture 之一
      if (!targetDesign && !targetLesson) {
        return {
          success: false,
          error: 'v4.2.0 PPT 阶段需要先在『教学设计』阶段完成并确认节课设计。\n\n工作流：教学进度表 → 教学设计 → PPT → 讲稿 → 视频 → 报告\n\n请回到「教学设计」阶段：\n1. 选择一节课（如第 6 节·思维导图实训）\n2. 点「AI 生成设计」\n3. 老师审核后点「确认完成」\n4. 再回 PPT 阶段，「目标设计」下拉会出现刚确认的节课',
        };
      }

      const courseName = payload.courseName || notebook?.name || '课程';
      // P6 严重 bug 修复（2026-05-18）：design.handlers 保存时 metadata 是空对象，
      //   lessonMeta 数据全部在 content.lessonMeta。
      //   原代码只读 targetDesign.metadata → 拿到 {} → lessonTotalHours=0 →
      //   兜底到整门课 totalHours=72 → AI 跑整门课 PPT（严重偏离！）
      //   老师反馈："怎么开始规划 72 学时的 PPT?什么意思？赶紧停止"
      const designContent = targetDesign?.content || null;
      const designContentMeta = designContent?.lessonMeta || {};
      const lessonMeta = {
        ...(designContentMeta),
        ...(targetDesign?.metadata || targetLesson?.metadata || {}),
      };
      // 确保 lessonMeta 关键字段一定有值（content.lessonMeta fallback）
      lessonMeta.lessonNumber = lessonMeta.lessonNumber || designContentMeta.lessonNumber || 0;
      lessonMeta.topic = lessonMeta.topic || designContentMeta.topic || '';
      lessonMeta.chapter = lessonMeta.chapter || designContentMeta.chapter || '';
      lessonMeta.weekRange = lessonMeta.weekRange || designContentMeta.weekRange || '';
      lessonMeta.theoryHours = Number(lessonMeta.theoryHours) || Number(designContentMeta.theoryHours) || 0;
      lessonMeta.practiceHours = Number(lessonMeta.practiceHours) || Number(designContentMeta.practiceHours) || 0;

      const lessonTotalHours = Number(lessonMeta.theoryHours) + Number(lessonMeta.practiceHours);

      // ⚠ 关键：totalHours 必须用节课学时；如果还是 0 → 报错不让走整门课兜底（避免再发 72 学时 PPT 的坑）
      if (targetDesign && lessonTotalHours <= 0) {
        return {
          success: false,
          error: `❌ 目标设计「第 ${lessonMeta.lessonNumber || '?'} 节」缺少 theoryHours / practiceHours 字段。无法生成 PPT。请回到「教学设计」阶段重新生成 + 确认该节设计。`,
        };
      }
      const totalHours = lessonTotalHours > 0
        ? lessonTotalHours
        : (Number(payload.totalHours) || 1);
      // 注：v4.3.0 起，totalHours 不再用 notebook.totalHours 兜底（曾经导致单节 PPT 误跑整门课规划）

      if (targetDesign) {
        console.log(`[v2:generatePptPlan] 🎯 基于设计模式：第 ${lessonMeta.lessonNumber} 节·${lessonMeta.topic}（${totalHours} 学时） 来源=design`);
      } else if (targetLesson) {
        console.log(`[v2:generatePptPlan] ⚠ 兼容模式：基于 lecture 生成 PPT（建议升级到 design-first 流程）`);
      }

      // Phase-5D：跨阶段上下文注入
      const pptCtx = notebookId ? buildPptContext(db, notebookId) : { lectureSections: [], lectureSectionSummary: '' };
      const lectureScriptFromPayload = String(payload.lectureScript || '');

      // 2026-05-16 v4.2.0 Phase A'-3：构造 pipeline input
      //   ✅ 优先：design.content（pipeline 内部按 sourceDesignSection 14 个枚举值切片）
      //   🪦 兜底：lecture.finalScript（v4.1.x 老数据，pipeline 按文本锚点切片）
      let effectiveLectureScript = lectureScriptFromPayload;
      if (!effectiveLectureScript && !targetDesign && targetLesson) {
        effectiveLectureScript = targetLesson.content?.finalScript || '';
      }
      if (!effectiveLectureScript && !targetDesign && notebookId && typeof db.getLatestArtifact === 'function') {
        const finalArtifact = db.getLatestArtifact(notebookId, 'lecture_final', 'lecture');
        effectiveLectureScript = finalArtifact?.content?.finalScript || '';
      }

      // 2026-05-15 问题二重构：默认走 V2 双阶段 pipeline（payload.usePptV1=true 可回退旧路径）
      const usePptV1 = payload.usePptV1 === true;
      const courseContextForPpt = {
        softwareTools: notebook?.softwareTools || '',
        jobTargets: notebook?.jobTargets || '',
        industryScenarios: notebook?.industryScenarios || '',
        learnerProfile: notebook?.learnerProfile || '',
      };

      let pages, rawPlan, pageCount;
      if (usePptV1) {
        console.log('[v2:generatePptPlan] 使用 V1 单阶段 pipeline（payload.usePptV1=true）');
        const r = await generatePptPlan({
          lectureScript: effectiveLectureScript,
          courseName,
          totalHours,
          modules: payload.modules || modules,
          aiClient,
          prevPages: Array.isArray(payload.prevPages) ? payload.prevPages : [],
          imageAspect: String(payload.imageAspect || '16:9'),
          imageQuality: String(payload.imageQuality || 'low'),
          lectureSections: pptCtx.lectureSections || [],
          lectureSectionSummary: pptCtx.lectureSectionSummary || '',
        });
        pages = r.pages; rawPlan = r.rawPlan; pageCount = r.pageCount;
      } else {
        console.log('[v2:generatePptPlan] 使用 V2 双阶段 pipeline（大纲 → 逐页详情）');
        // 2026-05-15 P2-5：通过 IPC event.sender 把进度事件推到渲染进程
        // 2026-05-16 v4.2.0 Phase A'-3：design-first 主输入，lecture 仅旧数据兜底
        const r = await generatePptPlanV2({
          // ✅ v4.2.0 主输入：design-first
          designContent: designContent || null,
          lessonMeta,
          // 🪦 v4.1.x 兼容：lecture-based
          lectureScript: effectiveLectureScript,
          courseName,
          totalHours,
          modules: payload.modules || modules,
          aiClient,
          prevPages: Array.isArray(payload.prevPages) ? payload.prevPages : [],
          lectureSections: pptCtx.lectureSections || [],
          lectureSectionSummary: pptCtx.lectureSectionSummary || '',
          courseContext: courseContextForPpt,
          externalReferences: Array.isArray(payload.externalReferences) ? payload.externalReferences : [],
          concurrency: 4,
          onProgress: (evt) => {
            try {
              if (event?.sender && !event.sender.isDestroyed()) {
                event.sender.send('v2:pptProgress', { notebookId, ...evt });
              }
            } catch (_) { /* ignore */ }
          },
        });
        pages = r.pages; rawPlan = r.rawPlan; pageCount = r.pageCount;
        if (r.failedCount > 0) {
          console.warn(`[v2:generatePptPlan] V2 pipeline 有 ${r.failedCount} 页走兜底`);
        }
        // 2026-05-16 v4.1.4 Phase 2：把 mainAccentColor 挂到 rawPlan，前端 / publication 都能取
        if (r.mainAccentColor && rawPlan) {
          rawPlan.mainAccentColor = r.mainAccentColor;
        }
      }

      // 2026-05-16 v4.2.0 Phase A'：PPT 绑定到 design（主流程）或 lecture（兼容老数据）
      //   下次进 PPT 阶段 → session 仍指向同一节课的 design / lecture
      if (notebookId && typeof db.updateSessionContext === 'function') {
        try {
          const sessionPatch = {
            activeLessonNumber: Number(lessonMeta.lessonNumber) || undefined,
          };
          if (targetDesign) sessionPatch.activeDesignArtifactId = Number(targetDesign.id);
          if (targetLesson) sessionPatch.activeLectureArtifactId = Number(targetLesson.id);
          db.updateSessionContext(notebookId, sessionPatch);
        } catch (sessionErr) {
          console.warn('[v2:generatePptPlan] 更新 session 失败：', sessionErr.message);
        }
      }

      return {
        success: true,
        data: {
          pages,
          pageCount,
          templateKey: payload.templateKey || 'pro_minimalist',
          // 2026-05-16 v4.1.4 Phase 2：透传给前端，UI 用来渲染预览的"主色徽章"
          mainAccentColor: rawPlan?.mainAccentColor || '',
          // 2026-05-16 v4.2.0 Phase A'：告诉前端这套 PPT 是为哪节课生成的（基于 design 或 lecture）
          lessonContext: (targetDesign || targetLesson) ? {
            // v4.2.0：以 design 为主键；lecture 兼容字段保留
            designId: targetDesign?.id || null,
            lessonId: targetLesson?.id || null,
            lessonNumber: lessonMeta.lessonNumber || 0,
            topic: lessonMeta.topic || '',
            chapter: lessonMeta.chapter || '',
            theoryHours: Number(lessonMeta.theoryHours) || 0,
            practiceHours: Number(lessonMeta.practiceHours) || 0,
            totalHours,
            source: targetDesign ? 'design' : 'lecture',
          } : null,
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * 2026-05-16 v4.1.4 Phase 2 新增：逐页重生
   *
   * payload: {
   *   notebookId,
   *   page,              // 原 page JSON（完整 schema）
   *   instruction,       // 老师自然语言修改指令
   *   referenceImageDesc,// 可选，参考图被 vision 解析后的描述文字
   *   mainAccentColor,   // 整门课主色，AI 普通页 accentColor 留空时回落
   * }
   * 返回: { success, data: { page: 新版 page JSON } }
   */
  ipcMain.handle('v2:regeneratePptPage', async (event, payload = {}) => {
    const fsx = require('fs');
    const pathx = require('path');
    try {
      const { db } = getDeps();
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const page = payload.page || {};
      const instruction = String(payload.instruction || '').trim();
      const referenceImageDesc = String(payload.referenceImageDesc || '').trim();
      if (!instruction && !referenceImageDesc) {
        return { success: false, error: '修改指令和参考图至少要有一个' };
      }
      const notebook = notebookId ? db.getNotebookById(notebookId) : null;
      const courseName = notebook?.name || '课程';
      const aiClient = createAiClient(payload);

      // 加载 prompt
      const promptPath = pathx.join(__dirname, '../../../../prompts/ppt-page-regenerate.md');
      const systemPrompt = fsx.readFileSync(promptPath, 'utf8');

      // 取该页对应讲稿段落（若 page.sourceSection 有值）
      let sectionExcerpt = '';
      try {
        if (typeof db.getLatestArtifact === 'function') {
          const finalArtifact = db.getLatestArtifact(notebookId, 'lecture_final', 'lecture');
          const fullScript = finalArtifact?.content?.finalScript || '';
          if (fullScript && page.sourceSection) {
            // 简单截取该章节附近 1500 字
            const idx = fullScript.indexOf(page.sourceSection);
            if (idx >= 0) {
              sectionExcerpt = fullScript.slice(idx, idx + 1500);
            }
          }
        }
      } catch (_) { /* ignore */ }

      const mainAccentColor = payload.mainAccentColor || '#2E86DE';

      const userPrompt = [
        `## 课程信息`,
        `- 课程名：${courseName}`,
        `- 整门课主 accentColor：${mainAccentColor}`,
        '',
        `## 原页面 JSON`,
        '```json',
        JSON.stringify(page, null, 2),
        '```',
        '',
        sectionExcerpt
          ? [`## 该页对应的讲稿章节原文（参考素材）`, sectionExcerpt.slice(0, 1500)].join('\n')
          : `## 该页对应讲稿章节原文：（缺失，仅按指令精修）`,
        '',
        `## 老师修改指令（关键输入）`,
        instruction || '（未填，仅按参考图调整）',
        '',
        referenceImageDesc
          ? [`## 参考图片描述`, referenceImageDesc].join('\n')
          : '',
        '',
        `请按上述指令对该页做精修，输出新版本 JSON。`,
      ].filter(Boolean).join('\n');

      const rawText = await aiClient.chatJson({
        systemPrompt,
        userPrompt,
        temperature: 0.4,
        maxTokens: 1800,
      });

      // 解析 + 合并兜底（缺失字段从原页拷贝）
      let parsed;
      try {
        const cleaned = String(rawText || '')
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        const s = cleaned.indexOf('{');
        const e = cleaned.lastIndexOf('}');
        parsed = JSON.parse(cleaned.slice(s, e + 1));
      } catch (parseErr) {
        return { success: false, error: `AI 返回的 JSON 解析失败：${parseErr.message}` };
      }

      const merged = { ...page, ...parsed };
      return { success: true, data: { page: merged } };
    } catch (error) {
      console.error('[v2:regeneratePptPage] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 2026-05-16 v4.1.4：单独重生动态练习题（不重生整个 PPT）
   *
   * payload: {
   *   notebookId,
   *   pages,             // 当前 PPT 全部页面（出题素材）
   *   courseName,
   *   totalHours,
   * }
   * 返回: { success, data: { exercises, exerciseHtml, title, subtitle } }
   */
  ipcMain.handle('v2:regenerateDynamicExercise', async (event, payload = {}) => {
    try {
      const notebookId = Number(payload.notebookId);
      const pages = Array.isArray(payload.pages) ? payload.pages : [];
      if (pages.length === 0) {
        return { success: false, error: 'PPT 页面为空，无法出题' };
      }
      const { db } = getDeps();
      const notebook = notebookId && db ? db.getNotebookById(notebookId) : null;
      const courseName = String(payload.courseName || notebook?.name || '课程');
      const totalHours = Number(payload.totalHours) || Number(notebook?.totalHours) || 1;

      const aiClient = createAiClient(payload);
      console.log(`[v2:regenerateDynamicExercise] 开始重生：${pages.length} 页源材料，课程「${courseName}」`);

      const { generateDynamicExercise } = require('../../services/ppt-dynamic-exercise.service');
      const result = await generateDynamicExercise({
        aiClient,
        pages,
        courseName,
        totalHours,
      });
      const ex = result.exercisePage;
      console.log(`[v2:regenerateDynamicExercise] ✅ 成功：${result.exercises.length} 道题`);
      return {
        success: true,
        data: {
          exercises: result.exercises,
          exerciseHtml: ex.exerciseHtml,
          title: ex.title,
          subtitle: ex.subtitle,
          keyContent: ex.keyContent,
        }
      };
    } catch (e) {
      console.error(`[v2:regenerateDynamicExercise] ❌ 失败：${e.message}`);
      console.error(e.stack);
      return { success: false, error: e.message };
    }
  });

  /**
   * 2026-05-16 v4.1.4：导出动态练习 HTML 到磁盘
   *   老师可以提前把这个 HTML 文件拷到课堂电脑、U 盘，不依赖驭课 Agent 也能打开演示
   *
   * payload: { exerciseHtml, title, notebookId }
   * 返回: { success, data: { filePath } }
   */
  ipcMain.handle('v2:exportExerciseHtml', async (event, payload = {}) => {
    const fsx = require('fs');
    const pathx = require('path');
    try {
      const html = String(payload.exerciseHtml || '').trim();
      if (!html || html.length < 100) {
        return { success: false, error: 'exerciseHtml 为空或损坏' };
      }
      const title = String(payload.title || '课堂动态练习');
      const { dialog } = require('electron');
      const picked = await dialog.showSaveDialog({
        title: '导出课堂练习交互页',
        defaultPath: `${title.replace(/[\\/:*?"<>|]+/g, '-')}.html`,
        filters: [{ name: 'HTML 文件', extensions: ['html'] }]
      });
      if (picked.canceled || !picked.filePath) return { success: false, error: '已取消' };
      fsx.writeFileSync(picked.filePath, html, 'utf8');
      console.log(`[v2:exportExerciseHtml] ✅ 已导出到 ${picked.filePath}`);
      return { success: true, data: { filePath: picked.filePath } };
    } catch (e) {
      console.error('[v2:exportExerciseHtml] ❌ 导出失败：', e);
      return { success: false, error: e.message };
    }
  });

  /**
   * 2026-05-16 v4.1.4：课堂演示 —— 打开全屏窗口播放动态练习 HTML
   *
   * payload: { exerciseHtml: '<html>...</html>', title: '课堂动态练习' }
   * 老师上课点击此函数 → 弹出独立全屏窗口 → 学生在大屏看题 + 老师/学生点选答题 → 即时反馈
   */
  ipcMain.handle('v2:openExercisePresentation', async (event, payload = {}) => {
    try {
      const { BrowserWindow } = require('electron');
      const html = String(payload.exerciseHtml || '').trim();
      if (!html) return { success: false, error: '动态练习 HTML 为空，请先生成题目' };

      const title = String(payload.title || '课堂动态练习');
      const win = new BrowserWindow({
        title,
        width: 1280, height: 800,
        useContentSize: true,
        backgroundColor: '#FFFFFF',
        show: false,
        autoHideMenuBar: true,
        webPreferences: { sandbox: false, contextIsolation: true, nodeIntegration: false },
      });

      // 在 HTML body 末尾注入演示工具栏（全屏 / 关闭按钮 + 进度提示）
      const presentationToolbar = `
        <div id="__present_toolbar" style="
          position:fixed; top:0; left:0; right:0; z-index:99999;
          background:rgba(15,23,42,0.92); color:#fff;
          padding:8px 16px; display:flex; align-items:center; gap:12px;
          font-family:system-ui,sans-serif; font-size:13px;
          box-shadow:0 2px 8px rgba(0,0,0,0.2);
        ">
          <span style="font-weight:700; flex:1">🎯 ${title}</span>
          <button onclick="document.documentElement.requestFullscreen()" style="
            background:#2563EB; color:#fff; border:none; padding:6px 12px;
            border-radius:4px; cursor:pointer; font-size:12px; font-weight:600;
          ">⛶ 全屏</button>
          <button onclick="window.close()" style="
            background:#DC2626; color:#fff; border:none; padding:6px 12px;
            border-radius:4px; cursor:pointer; font-size:12px; font-weight:600;
          ">✕ 关闭</button>
        </div>
        <div style="height:42px"></div>
      `;
      const injectedHtml = html.replace(/<body[^>]*>/i, (m) => m + presentationToolbar);

      await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(injectedHtml)}`);
      win.show();
      win.focus();
      // 自动尝试全屏（部分系统需要用户手势才允许 fullscreen API，所以也提供工具栏按钮）
      try { win.setFullScreen(true); } catch (_) { /* ignore */ }

      console.log(`[v2:openExercisePresentation] ✅ 演示窗口已打开（${title}）`);
      return { success: true };
    } catch (e) {
      console.error('[v2:openExercisePresentation] ❌ 打开失败：', e);
      return { success: false, error: e.message };
    }
  });

  /**
   * 读取本地图片文件，返回 base64 data URL
   * 供 Canvas 合成时安全加载本地文件（file:// 协议在 Canvas 中可能被 taint 拦截）
   */
  ipcMain.handle('v2:readFileAsBase64', async (event, filePath) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('文件路径为空');
      }
      const absPath = String(filePath).trim();
      if (!fs.existsSync(absPath)) {
        throw new Error(`文件不存在：${absPath}`);
      }
      const buf  = fs.readFileSync(absPath);
      const ext  = path.extname(absPath).toLowerCase().replace('.', '') || 'png';
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return { success: true, data: `data:${mime};base64,${buf.toString('base64')}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * 保存 Canvas 合成后的 PNG 到本地磁盘
   * payload: { notebookId, pageId, imageBase64 }
   * 返回: { success, data: { compositePath } }
   */
  ipcMain.handle('v2:saveCompositeSlide', async (event, payload = {}) => {
    const { app } = getDeps();
    try {
      const { notebookId, pageId, imageBase64 } = payload;
      if (!notebookId || !pageId || !imageBase64) {
        throw new Error('缺少参数：notebookId / pageId / imageBase64');
      }
      const outputDir = path.join(
        app.getPath('userData'),
        'generated-composites',
        String(notebookId)
      );
      fs.mkdirSync(outputDir, { recursive: true });

      const fileName    = `composite-${pageId}-${Date.now()}.png`;
      const filePath    = path.join(outputDir, fileName);
      const base64Clean = String(imageBase64).replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(base64Clean, 'base64'));

      return { success: true, data: { compositePath: filePath } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 2026-05-15 P2-3：老师编辑动态练习题后重建 HTML ────────────────────
  // payload: { exercises, title, subtitle, courseName }
  // 返回: { success, data: { html } }
  ipcMain.handle('v2:rebuildExerciseHtml', async (event, payload = {}) => {
    try {
      const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
      if (exercises.length === 0) {
        return { success: false, error: 'exercises 数组为空' };
      }
      const html = buildExerciseHtml({
        title: payload.title || '课堂动态练习',
        subtitle: payload.subtitle || '互动检验本节学习成果',
        exercises,
        courseName: payload.courseName || '',
      });
      return { success: true, data: { html } };
    } catch (err) {
      console.error('[v2:rebuildExerciseHtml] 异常：', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
