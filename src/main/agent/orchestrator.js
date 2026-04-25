/**
 * orchestrator.js — Agent 编排器核心（Phase-5C Step 3）
 *
 * 职责：自主驱动课程多阶段生成，无需用户逐步点击。
 * 流程：
 *  1. 评估笔记本当前状态（框架/讲稿/PPT 完成情况 + 质量）
 *  2. 决策下一步动作（规则引擎 + 质量反馈）
 *  3. 执行动作（调用现有生成器）
 *  4. 验证质量（validateLectureStage / validateFrameworkContent）
 *  5. 循环直到完成或超时
 *
 * 特性：
 *  - 每步骤结果写入 task_runtime 操作日志（可审计）
 *  - 超时 10 分钟自动停止
 *  - 每步骤后发送 agent:progress 事件（前端可实时展示）
 *  - 不修改已 confirmed 的 artifact
 *  - 遵守 contracts.js 阶段顺序（framework → lecture → ppt）
 *
 * 使用：
 *   const agent = createAgentOrchestrator(deps);
 *   const result = await agent.run(notebookId, { targetStages: ['framework', 'lecture'] });
 */

const { generateLectureABCDrafts } = require('../script/abc-generator');
const { normalizeFrameworkContent, validateFrameworkContent } = require('../api/framework-schema');
const { validateLectureStage } = require('../v2/quality');
const { buildLectureContext, buildPptContext } = require('./context-builder');
const { generateWithRetry } = require('./retry-loop');
const { generateFramework: generateFrameworkArk } = require('../api/ark');
const { saveMemory, buildMemoryContext } = require('./memory');  // Phase-5C Step 4
const { generatePptPlan } = require('../script/ppt-plan-generator');  // Phase-5D PPT
const { videoPrompt: buildVideoPromptText } = require('../../shared/v2-stage-helpers');  // Phase-5D Video

const AGENT_TIMEOUT_MS = 10 * 60 * 1000;  // 10 分钟硬超时
const MAX_STEPS = 12;                       // 防止意外无限循环

// ── 状态评估 ─────────────────────────────────────────────────────────────────

/**
 * 读取 DB，返回各阶段当前状态快照
 */
function assessNotebookState(db, notebookId) {
  const notebook = db.getNotebookById(notebookId);
  if (!notebook) return null;

  const framework = db.getCurrentFramework(notebookId);
  const modules = db.getModulesByNotebook(notebookId) || [];

  // 讲稿 artifact
  const lectureDraftsArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'lecture_drafts', 'lecture')
    : null;
  const lectureFinalArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'lecture_final', 'lecture')
    : null;

  // 框架质量
  let frameworkQuality = null;
  if (framework) {
    const content = framework.content || framework;
    const validation = validateFrameworkContent(content, notebook);
    frameworkQuality = {
      valid: validation.valid,
      errors: validation.errors || [],
      warnings: validation.warnings || []
    };
  }

  // 讲稿草稿
  const drafts = lectureDraftsArtifact?.content?.drafts || {};
  const draftCount = ['a', 'b', 'c'].filter((k) => String(drafts[k] || '').length > 200).length;

  // 正式讲稿
  const finalScript = lectureFinalArtifact?.content?.finalScript || '';
  let lectureQuality = null;
  if (finalScript) {
    lectureQuality = validateLectureStage(
      { drafts, selectedDraft: lectureDraftsArtifact?.content?.selectedDraft || 'a', finalScript },
      { requireFinal: true, totalHours: Number(notebook.totalHours) || 1 }
    );
  }

  // PPT artifact（Phase-5D）
  const pptOutlineArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'ppt_outline', 'ppt')
    : null;
  const pptPageCount = Array.isArray(pptOutlineArtifact?.content?.pptPages)
    ? pptOutlineArtifact.content.pptPages.length
    : 0;

  // Video artifact（Phase-5D）
  const videoPromptArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'video_prompt', 'video')
    : null;
  const videoPromptExists = Boolean(videoPromptArtifact?.content?.promptText);

  return {
    notebook,
    modules,
    framework,
    frameworkQuality,
    draftCount,
    drafts,
    finalScript,
    lectureQuality,
    pptPageCount,
    videoPromptExists
  };
}

// ── 决策引擎 ─────────────────────────────────────────────────────────────────

/**
 * 规则引擎：根据状态决定下一步动作
 * 遵守 contracts.js 的 framework→lecture→ppt 顺序
 *
 * Phase-5C Step 5（Backtracking）：
 *  当讲稿正式稿 2 次仍不达标时，自动回溯重生成框架，并清空讲稿 artifacts。
 *  回溯后，讲稿相关计数器从 0 重新起算（只计回溯之后的步骤）。
 *  每轮 run() 最多回溯 1 次，防止无限循环。
 */
function decideNextAction(state, targetStages, stepLog) {
  const { framework, frameworkQuality, draftCount, finalScript, lectureQuality, pptPageCount, videoPromptExists } = state;

  // ── 全局计数（用于框架阶段和回溯次数） ──
  const globalCounts = {};
  stepLog.forEach((s) => {
    globalCounts[s.action] = (globalCounts[s.action] || 0) + 1;
  });

  // ── 回溯后的讲稿计数（Step 5：只统计最近一次回溯之后的讲稿步骤） ──
  let lastBacktrackIdx = -1;
  stepLog.forEach((s, i) => {
    if (s.action === 'backtrack_framework') lastBacktrackIdx = i;
  });
  const postBacktrackLog = stepLog.filter((_, i) => i > lastBacktrackIdx);
  const postCounts = {};
  postBacktrackLog.forEach((s) => {
    postCounts[s.action] = (postCounts[s.action] || 0) + 1;
  });

  const needs = (stage) => targetStages.includes(stage);

  // ── 框架阶段 ──
  if (needs('framework')) {
    if (!framework) {
      return { action: 'generate_framework', reason: '框架尚未生成', priority: 10 };
    }
    if (!frameworkQuality?.valid && (globalCounts['generate_framework'] || 0) < 2) {
      return {
        action: 'generate_framework',
        reason: `框架验证未通过：${(frameworkQuality?.errors || []).join('；')}`,
        priority: 9
      };
    }
  }

  // ── 讲稿阶段（需要框架通过） ──
  if (needs('lecture')) {
    if (!frameworkQuality?.valid) {
      return {
        action: 'done',
        reason: '框架质量不达标，无法进入讲稿阶段',
        status: 'blocked',
        blockReason: frameworkQuality?.errors?.join('；') || '框架验证失败'
      };
    }

    // 需要三稿（用回溯后计数）
    if (draftCount < 3 && (postCounts['generate_lecture_abc'] || 0) < 2) {
      return { action: 'generate_lecture_abc', reason: `讲稿草稿不足（当前 ${draftCount}/3 稿）`, priority: 8 };
    }

    // 需要正式稿（用回溯后计数）
    if (!finalScript && (postCounts['generate_lecture_formal'] || 0) < 1) {
      return { action: 'generate_lecture_formal', reason: '正式讲稿尚未生成', priority: 7 };
    }

    // 质量不达标：先尝试重试正式稿（用回溯后计数）
    if (finalScript && lectureQuality && !lectureQuality.valid &&
        (postCounts['generate_lecture_formal'] || 0) < 2) {
      return {
        action: 'generate_lecture_formal',
        reason: `正式讲稿质量不达标，重新生成：${(lectureQuality.errors || []).join('；')}`,
        priority: 6
      };
    }

    // ── Step 5 回溯触发条件 ──
    // 讲稿正式稿已重试 ≥2 次仍不达标，且本轮尚未回溯过 → 回溯框架
    if (needs('framework') &&
        finalScript && lectureQuality && !lectureQuality.valid &&
        (postCounts['generate_lecture_formal'] || 0) >= 2 &&
        (globalCounts['backtrack_framework'] || 0) === 0) {
      return {
        action: 'backtrack_framework',
        reason: `讲稿质量持续不达标（已重试 ${postCounts['generate_lecture_formal']} 次），自动回溯重生成框架`,
        priority: 11
      };
    }
  }

  // ── PPT 阶段（需要讲稿完成，Phase-5D）──
  if (needs('ppt')) {
    // 讲稿是 PPT 的硬前置条件
    if (!finalScript) {
      return {
        action: 'done',
        reason: 'PPT 阶段需要正式讲稿，但讲稿尚未完成',
        status: 'blocked',
        blockReason: '正式讲稿未完成，请先完成讲稿阶段'
      };
    }
    if (pptPageCount === 0 && (globalCounts['generate_ppt_plan'] || 0) < 2) {
      return { action: 'generate_ppt_plan', reason: 'PPT 页面规划尚未生成', priority: 5 };
    }
  }

  // ── 视频阶段（需要 PPT 完成，Phase-5D）──
  if (needs('video')) {
    // PPT 是视频的前置条件（若 ppt 同时在 targetStages 中）
    if (needs('ppt') && pptPageCount === 0) {
      return {
        action: 'done',
        reason: '视频阶段需要 PPT 页面，但 PPT 尚未完成',
        status: 'blocked',
        blockReason: 'PPT 页面未完成，请先完成 PPT 阶段'
      };
    }
    if (!videoPromptExists && (globalCounts['generate_video_prompt'] || 0) < 1) {
      return { action: 'generate_video_prompt', reason: '视频提示词尚未生成', priority: 4 };
    }
  }

  // ── 全部完成 ──
  return { action: 'done', reason: '目标阶段均已完成', status: 'success' };
}

// ── 动作执行器 ────────────────────────────────────────────────────────────────

/**
 * 执行 generate_framework 动作
 * @param {string} [memoryContext] - 相似历史课程参考文本（来自 memory.js，可选）
 */
async function execGenerateFramework(db, notebookId, aiClient, helpers, memoryContext) {
  const { patchCourseProject, normalizeModuleInput } = helpers;
  const notebook = db.getNotebookById(notebookId);
  if (!notebook) throw new Error('Notebook not found');

  // 将历史相似课程参考追加到 description，供框架生成 Prompt 参考
  const baseDescription = notebook.description || '';
  const descriptionWithMemory = memoryContext
    ? `${baseDescription}\n\n${memoryContext}`.trim()
    : baseDescription;

  // 构建目标课程信息
  const targetCourse = {
    id: notebookId,
    name: notebook.name || '',
    courseCode: notebook.courseCode || '',
    totalHours: notebook.totalHours || 0,
    theoryHours: notebook.theoryHours || 0,
    practiceHours: notebook.practiceHours || 0,
    grade: notebook.grade || '',
    prerequisite: notebook.prerequisite || '',
    description: descriptionWithMemory,   // 含历史参考（Phase-5C Step 4）
    softwareTools: notebook.softwareTools || '',
    jobTargets: notebook.jobTargets || '',
    industryScenarios: notebook.industryScenarios || '',
    learnerProfile: notebook.learnerProfile || '',
    teachingMaterials: notebook.teachingMaterials || ''
  };

  // 使用 ArkCourseClient 生成框架（与 framework.handlers 一致）
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    throw new Error('AI 客户端未就绪，请先在设置中配置 API Key');
  }

  const rawFramework = await generateFrameworkArk(targetCourse, aiClient.apiKey, aiClient.endpointId);
  const normalized = normalizeFrameworkContent(rawFramework, targetCourse);
  const check = validateFrameworkContent(normalized, targetCourse);
  if (!check.valid) {
    throw new Error(`框架生成后验证失败：${check.errors.join('；')}`);
  }

  const framework = db.createFramework(notebookId, normalized, 'append');

  // 同步模块
  const autoModules = Array.isArray(normalized.modules) ? normalized.modules : [];
  if (autoModules.length > 0 && typeof normalizeModuleInput === 'function') {
    db.replaceModules(notebookId, autoModules.map((item, idx) => normalizeModuleInput({
      moduleNumber: item.number || idx + 1,
      name: item.name || `模块${idx + 1}`,
      hours: Number(item.hours) || 0,
      description: item.description || '',
      knowledgePoints: item.keyPoints || [],
      teachingMethods: item.teachingMethods || '',
      isCore: Boolean(item.isCore)
    })));
  }

  patchCourseProject(notebookId, {
    framework: normalized,
    modules: db.getModulesByNotebook(notebookId),
    dirty: true,
    dirtyReason: 'agent-framework-generated',
    dirtyAt: new Date().toISOString()
  });

  return { framework, warnings: check.warnings || [] };
}

/**
 * 执行 generate_lecture_abc 动作
 * @param {string} [memoryContext] - 相似历史课程参考文本（Phase-5C Step 4）
 */
async function execGenerateLectureABC(db, notebookId, aiClient, helpers, memoryContext) {
  const { patchCourseProject } = helpers;
  const notebook = db.getNotebookById(notebookId);
  if (!notebook) throw new Error('Notebook not found');

  const modules = db.getModulesByNotebook(notebookId) || [];
  const frameworkCtx = buildLectureContext(db, notebookId);

  // 将历史参考追加到风格提示文本（Phase-5C Step 4）
  const styleRubricText = memoryContext ? memoryContext : '';

  const result = await generateLectureABCDrafts({
    courseName: notebook.name || '课程',
    modules,
    styleRubricText,
    aiClient,
    totalHours: Number(notebook.totalHours) || 1,
    notebookContext: {
      softwareTools: notebook.softwareTools || '',
      jobTargets: notebook.jobTargets || '',
      industryScenarios: notebook.industryScenarios || '',
      learnerProfile: notebook.learnerProfile || '',
      frameworkObjectives: frameworkCtx.frameworkObjectives,
      frameworkTeachingMethods: frameworkCtx.frameworkTeachingMethods
    }
  });

  patchCourseProject(notebookId, {
    lectureDrafts: { a: result.a || '', b: result.b || '', c: result.c || '' },
    dirty: true,
    dirtyReason: 'agent-lecture-abc-generated',
    dirtyAt: new Date().toISOString()
  });

  const hasDrafts = ['a', 'b', 'c'].filter((k) => String(result[k] || '').length > 200).length;
  return { drafts: { a: result.a, b: result.b, c: result.c }, draftCount: hasDrafts };
}

/**
 * 执行 generate_lecture_formal 动作（接入 Step 1 的 retry-loop）
 * @param {string} [memoryContext] - 相似历史课程参考文本（Phase-5C Step 4）
 */
async function execGenerateLectureFormal(db, notebookId, aiClient, helpers, state, memoryContext) {
  const { patchCourseProject } = helpers;
  const notebook = db.getNotebookById(notebookId);
  if (!notebook) throw new Error('Notebook not found');

  const modules = db.getModulesByNotebook(notebookId) || [];
  const frameworkCtx = buildLectureContext(db, notebookId);
  const notebookContext = {
    softwareTools: notebook.softwareTools || '',
    jobTargets: notebook.jobTargets || '',
    industryScenarios: notebook.industryScenarios || '',
    learnerProfile: notebook.learnerProfile || '',
    frameworkObjectives: frameworkCtx.frameworkObjectives,
    frameworkTeachingMethods: frameworkCtx.frameworkTeachingMethods
  };

  const drafts = state.drafts || {};

  // 将历史参考追加到风格提示文本（Phase-5C Step 4）
  const styleRubricText = memoryContext ? memoryContext : '';

  const { result, quality, attempts, exhausted, attemptLog } = await generateWithRetry(
    {
      drafts,
      preferred: 'a',
      styleRubricText,
      courseName: notebook.name || '课程',
      modules,
      aiClient,
      totalHours: Number(notebook.totalHours) || 1,
      notebookContext
    },
    { maxAttempts: 3 }
  );

  patchCourseProject(notebookId, {
    finalLectureScript: result.script || '',
    dirty: true,
    dirtyReason: exhausted ? 'agent-formal-retry-exhausted' : 'agent-formal-generated',
    dirtyAt: new Date().toISOString()
  });

  return {
    script: result.script,
    quality,
    attempts,
    exhausted,
    attemptLog,
    narrationCharCount: quality.checks?.finalNarrationCharCount || 0
  };
}

// ── 回溯支撑 ──────────────────────────────────────────────────────────────────

/**
 * 清空讲稿相关 artifacts（回溯前调用）
 * 将 lecture_drafts 和 lecture_final 的内容置为空，
 * 使下一次 assessNotebookState 时 draftCount=0, finalScript=''。
 */
function clearLectureArtifacts(db, notebookId) {
  if (typeof db.getLatestArtifact !== 'function' || typeof db.updateArtifact !== 'function') return;

  const draftsArtifact = db.getLatestArtifact(notebookId, 'lecture_drafts', 'lecture');
  if (draftsArtifact) {
    db.updateArtifact(draftsArtifact.id, {
      content: { drafts: {}, clearedByBacktrack: true, clearedAt: new Date().toISOString() }
    });
  }

  const finalArtifact = db.getLatestArtifact(notebookId, 'lecture_final', 'lecture');
  if (finalArtifact) {
    db.updateArtifact(finalArtifact.id, {
      content: { finalScript: '', clearedByBacktrack: true, clearedAt: new Date().toISOString() }
    });
  }
}

/**
 * 执行 backtrack_framework 动作（Phase-5C Step 5）
 * 步骤：
 *  1. 清空讲稿 artifacts（让 assessNotebookState 认为讲稿从未生成过）
 *  2. 重新生成框架（复用 execGenerateFramework 逻辑）
 */
async function execBacktrackFramework(db, notebookId, aiClient, helpers, memoryContext) {
  console.log(`[agent] 回溯：清空讲稿 artifacts → 重生成框架 (notebookId=${notebookId})`);
  clearLectureArtifacts(db, notebookId);
  return execGenerateFramework(db, notebookId, aiClient, helpers, memoryContext);
}

// ── PPT 生成执行器（Phase-5D）────────────────────────────────────────────────────

/**
 * 执行 generate_ppt_plan 动作
 *
 * 流程：
 *  1. 从 DB 读取正式讲稿（lecture_final artifact）
 *  2. 调用 generatePptPlan 生成页面规划
 *  3. 通过 v2Runtime.savePptStage 持久化保存
 *
 * @param {Object} db - 数据库实例
 * @param {number} notebookId
 * @param {Object} aiClient - AI 客户端（需有 chatJson 方法）
 * @param {Object} v2Runtime - v2 运行时（用于保存 PPT 数据）
 * @returns {Promise<{ pages: Array, pageCount: number }>}
 */
async function execGeneratePptPlan(db, notebookId, aiClient, v2Runtime) {
  const notebook = db.getNotebookById(notebookId);
  if (!notebook) throw new Error('Notebook not found');

  // 从 DB artifact 读取正式讲稿
  const finalArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'lecture_final', 'lecture')
    : null;
  const finalScript = finalArtifact?.content?.finalScript || '';
  if (!finalScript) throw new Error('正式讲稿内容为空，无法生成 PPT 规划');

  const modules = db.getModulesByNotebook(notebookId) || [];

  // 读取现有 PPT 页面，保留已生成的图片数据
  const pptOutlineArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'ppt_outline', 'ppt')
    : null;
  const prevPages = Array.isArray(pptOutlineArtifact?.content?.pptPages)
    ? pptOutlineArtifact.content.pptPages
    : [];

  // 获取讲稿章节摘要，用于辅助 AI 生成更对齐的 PPT 结构
  const pptCtx = buildPptContext(db, notebookId);

  const { pages, pageCount } = await generatePptPlan({
    lectureScript: finalScript,
    courseName: notebook.name || '课程',
    totalHours: Number(notebook.totalHours) || 1,
    modules,
    aiClient,
    prevPages,
    imageAspect: '16:9',
    imageQuality: 'low'
  });

  console.log(`[agent] PPT 规划生成完成：${pageCount} 页 (lectureSections=${pptCtx.lectureSections.length})`);

  // 通过 v2Runtime 保存 PPT 阶段数据（与手动保存路径完全一致）
  if (v2Runtime && typeof v2Runtime.savePptStage === 'function') {
    const saveResult = await v2Runtime.savePptStage({
      notebookId,
      pptPages: pages,
      templateKey: 'pro_minimalist',
      pptOutline: '',
      selectedPageId: pages[0]?.id || ''
    });
    if (saveResult && !saveResult.success) {
      throw new Error(`PPT 保存失败：${saveResult.error || '未知错误'}`);
    }
  } else {
    throw new Error('v2Runtime 未就绪，无法保存 PPT 阶段数据');
  }

  return { pages, pageCount };
}

// ── 视频提示词生成执行器（Phase-5D）──────────────────────────────────────────────

/**
 * 执行 generate_video_prompt 动作
 *
 * 流程：
 *  1. 从 DB 读取正式讲稿 + PPT 页面（用于图片参考）
 *  2. 调用 buildVideoPromptText 生成视频提示词文本
 *  3. 通过 v2Runtime.saveVideoStage 持久化保存
 *
 * 注意：视频提示词生成是纯文本操作，不调用 AI；
 *       promptText 内容基于讲稿内容由模板函数自动生成。
 *
 * @param {Object} db - 数据库实例
 * @param {number} notebookId
 * @param {Object} v2Runtime - v2 运行时
 * @returns {Promise<{ promptText: string }>}
 */
async function execGenerateVideoPrompt(db, notebookId, v2Runtime) {
  const notebook = db.getNotebookById(notebookId);
  if (!notebook) throw new Error('Notebook not found');

  // 读取正式讲稿
  const finalArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'lecture_final', 'lecture')
    : null;
  const finalScript = finalArtifact?.content?.finalScript || '';

  // 读取 PPT 页面（用于封面/总结图片参考，无图时 videoPrompt 会优雅降级）
  const pptOutlineArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'ppt_outline', 'ppt')
    : null;
  const pptPages = Array.isArray(pptOutlineArtifact?.content?.pptPages)
    ? pptOutlineArtifact.content.pptPages
    : [];

  // 使用共享模板函数生成视频提示词
  const promptText = buildVideoPromptText(
    notebook.name || '课程',
    '专业稳重',
    finalScript,
    pptPages
  );

  // 通过 v2Runtime 保存视频阶段数据
  if (v2Runtime && typeof v2Runtime.saveVideoStage === 'function') {
    const saveResult = await v2Runtime.saveVideoStage({
      notebookId,
      promptText,
      style: '专业稳重',
      engine: 'jimeng'
    });
    if (saveResult && !saveResult.success) {
      throw new Error(`视频提示词保存失败：${saveResult.error || '未知错误'}`);
    }
  } else {
    throw new Error('v2Runtime 未就绪，无法保存视频阶段数据');
  }

  return { promptText };
}

// ── 编排器工厂 ────────────────────────────────────────────────────────────────

/**
 * 创建 Agent 编排器实例
 *
 * @param {Object} deps
 * @param {Object} deps.db - 数据库实例
 * @param {Function} deps.createAiClient - () => ArkCourseClient
 * @param {Function} deps.emitEvent - (payload) => void，发送进度事件到前端
 * @param {Object} deps.helpers - { patchCourseProject, normalizeModuleInput }
 * @param {Object} [deps.v2Runtime] - v2 运行时（PPT/Video 阶段保存需要，Phase-5D）
 * @returns {{ run: Function }}
 */
function createAgentOrchestrator({ db, createAiClient, emitEvent, helpers, v2Runtime }) {
  /**
   * 运行 Agent 完整流水线
   *
   * @param {number} notebookId
   * @param {Object} [options]
   * @param {string[]} [options.targetStages=['framework','lecture']]  目标阶段
   * @param {number}   [options.maxSteps=12]  最大步骤数
   * @returns {Promise<{
   *   success: boolean,
   *   status: 'success'|'blocked'|'timeout'|'error',
   *   stepLog: Array,
   *   summary: string,
   *   finalState: Object|null
   * }>}
   */
  async function run(notebookId, options = {}) {
    const targetStages = Array.isArray(options.targetStages)
      ? options.targetStages
      : ['framework', 'lecture'];
    const maxSteps = Math.min(Number(options.maxSteps) || MAX_STEPS, 20);
    const startTime = Date.now();
    const stepLog = [];

    const emit = (type, payload) => {
      try {
        if (typeof emitEvent === 'function') {
          emitEvent({ notebookId, scope: 'agent', type, ...payload });
        }
      } catch {}
    };

    emit('agent.started', { targetStages, notebookId });

    const aiClient = createAiClient();
    if (!aiClient) {
      return {
        success: false,
        status: 'error',
        stepLog,
        summary: 'AI 客户端未就绪，请先配置 API Key',
        finalState: null
      };
    }

    // Phase-5C Step 4：构建历史相似课程记忆上下文（run 开始时一次性构建）
    const currentNotebook = db.getNotebookById(notebookId);
    const memoryContext = currentNotebook ? buildMemoryContext(db, currentNotebook) : '';
    if (memoryContext) {
      console.log(`[agent] 找到历史相似课程参考，将注入生成上下文`);
      emit('agent.memory_loaded', { notebookId, hasMemory: true });
    }

    for (let step = 0; step < maxSteps; step++) {
      // 超时检查
      if (Date.now() - startTime > AGENT_TIMEOUT_MS) {
        emit('agent.timeout', { step, elapsed: Date.now() - startTime });
        return {
          success: false,
          status: 'timeout',
          stepLog,
          summary: `Agent 执行超时（已运行 ${Math.round((Date.now() - startTime) / 1000)} 秒）`,
          finalState: assessNotebookState(db, notebookId)
        };
      }

      // 评估状态
      const state = assessNotebookState(db, notebookId);
      if (!state) {
        return { success: false, status: 'error', stepLog, summary: '笔记本不存在', finalState: null };
      }

      // 决策
      const decision = decideNextAction(state, targetStages, stepLog);
      emit('agent.decision', { step, action: decision.action, reason: decision.reason });

      const stepEntry = {
        step,
        action: decision.action,
        reason: decision.reason,
        startedAt: new Date().toISOString()
      };

      // 终止条件
      if (decision.action === 'done') {
        stepEntry.result = 'done';
        stepLog.push(stepEntry);
        const isBlocked = decision.status === 'blocked';
        emit('agent.done', { step, status: decision.status, summary: decision.reason });

        // Phase-5C Step 4：成功完成时保存记忆
        if (!isBlocked && decision.status !== 'error') {
          try {
            const frameworkCtxForMemory = buildLectureContext(db, notebookId);
            const narrationCount = state.lectureQuality?.checks?.finalNarrationCharCount || 0;
            saveMemory(db, notebookId, {
              frameworkObjectives: frameworkCtxForMemory.frameworkObjectives,
              frameworkTeachingMethods: frameworkCtxForMemory.frameworkTeachingMethods,
              lectureCharCount: narrationCount,
              styleHints: ''
            });
          } catch (memErr) {
            console.warn('[agent] 记忆保存失败（不影响主流程）:', memErr.message);
          }
        }

        return {
          success: !isBlocked,
          status: decision.status || 'success',
          stepLog,
          summary: decision.reason,
          finalState: state,
          blockReason: decision.blockReason || null
        };
      }

      // 执行动作
      try {
        let execResult = null;

        if (decision.action === 'generate_framework') {
          emit('agent.executing', { step, action: 'generate_framework', message: '正在生成教学框架…' });
          execResult = await execGenerateFramework(db, notebookId, aiClient, helpers, memoryContext);
          stepEntry.result = 'ok';
          stepEntry.warnings = execResult.warnings;

        } else if (decision.action === 'backtrack_framework') {
          // Phase-5C Step 5：讲稿质量不达标，回溯重生成框架
          emit('agent.executing', {
            step,
            action: 'backtrack_framework',
            message: '讲稿质量不达标，自动回溯：清空讲稿 → 重生成框架…'
          });
          execResult = await execBacktrackFramework(db, notebookId, aiClient, helpers, memoryContext);
          stepEntry.result = 'ok';
          stepEntry.warnings = execResult.warnings;
          stepEntry.isBacktrack = true;

        } else if (decision.action === 'generate_lecture_abc') {
          emit('agent.executing', { step, action: 'generate_lecture_abc', message: '正在生成讲稿 A/B/C 三稿…' });
          execResult = await execGenerateLectureABC(db, notebookId, aiClient, helpers, memoryContext);
          stepEntry.result = 'ok';
          stepEntry.draftCount = execResult.draftCount;

          // Step B: 将 ABC 草稿持久化到 DB（修复 assessNotebookState 读不到草稿的 bug）
          if (v2Runtime && typeof v2Runtime.saveLectureStage === 'function') {
            try {
              await v2Runtime.saveLectureStage({
                notebookId,
                drafts: execResult.drafts,
                selectedDraft: 'a',
                finalScript: ''
              });
            } catch (saveErr) {
              console.warn('[agent] 草稿持久化失败（非致命）:', saveErr.message);
            }
          }

        } else if (decision.action === 'generate_lecture_formal') {
          emit('agent.executing', { step, action: 'generate_lecture_formal', message: '正在生成正式讲稿（最多 3 次自动重试）…' });
          execResult = await execGenerateLectureFormal(db, notebookId, aiClient, helpers, state, memoryContext);
          stepEntry.result = execResult.exhausted ? 'retry_exhausted' : 'ok';
          stepEntry.attempts = execResult.attempts;
          stepEntry.narrationCharCount = execResult.narrationCharCount;

          // Step B: 正式讲稿持久化到 DB；质量达标时同时 confirm 解锁 PPT 阶段
          if (v2Runtime && typeof v2Runtime.saveLectureStage === 'function') {
            const lecturePayload = {
              notebookId,
              drafts: state.drafts,
              selectedDraft: 'a',
              finalScript: execResult.script || ''
            };
            try {
              await v2Runtime.saveLectureStage(lecturePayload);
              // 质量达标时自动 confirm，解锁 UI 的 PPT 阶段入口
              if (execResult.quality?.valid) {
                await v2Runtime.confirmLectureStage(lecturePayload);
              }
            } catch (saveErr) {
              console.warn('[agent] 讲稿持久化/确认失败（非致命）:', saveErr.message);
            }
          }

        } else if (decision.action === 'generate_ppt_plan') {
          // Phase-5D: PPT 页面规划生成
          emit('agent.executing', { step, action: 'generate_ppt_plan', message: '正在生成 PPT 页面规划…' });
          execResult = await execGeneratePptPlan(db, notebookId, aiClient, v2Runtime);
          stepEntry.result = 'ok';
          stepEntry.pageCount = execResult.pageCount;

          // Step B: PPT 保存后 confirm 阶段，解锁 UI 的视频阶段入口
          if (v2Runtime && typeof v2Runtime.confirmPptStage === 'function' && (execResult.pages || []).length > 0) {
            try {
              await v2Runtime.confirmPptStage({
                notebookId,
                pptPages: execResult.pages,
                templateKey: 'pro_minimalist'
              });
            } catch (confirmErr) {
              console.warn('[agent] PPT 阶段确认失败（非致命）:', confirmErr.message);
            }
          }

        } else if (decision.action === 'generate_video_prompt') {
          // Phase-5D: 视频提示词生成（纯模板，无 AI 调用）
          emit('agent.executing', { step, action: 'generate_video_prompt', message: '正在生成视频提示词…' });
          execResult = await execGenerateVideoPrompt(db, notebookId, v2Runtime);
          stepEntry.result = 'ok';
          stepEntry.promptLength = (execResult.promptText || '').length;
        }

        stepEntry.completedAt = new Date().toISOString();
        stepLog.push(stepEntry);
        emit('agent.step_done', { step, action: decision.action, result: stepEntry.result });

      } catch (err) {
        stepEntry.result = 'error';
        stepEntry.error = err.message;
        stepEntry.completedAt = new Date().toISOString();
        stepLog.push(stepEntry);
        emit('agent.step_error', { step, action: decision.action, error: err.message });

        // 执行出错直接终止
        return {
          success: false,
          status: 'error',
          stepLog,
          summary: `步骤 ${step + 1}（${decision.action}）执行失败：${err.message}`,
          finalState: assessNotebookState(db, notebookId)
        };
      }
    }

    // 超出最大步骤数
    return {
      success: false,
      status: 'timeout',
      stepLog,
      summary: `已执行 ${maxSteps} 步仍未完成，请检查生成质量`,
      finalState: assessNotebookState(db, notebookId)
    };
  }

  return { run };
}

module.exports = { createAgentOrchestrator, assessNotebookState };
