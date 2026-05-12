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
// Phase-6 M2.4：用户编辑保护——backtracking 前显式裁决冲突
const { resolveConflict, CONFLICT_TYPE } = require('./conflict-policy');
// Phase-7.6 R8：生成审计日志
const { recordGeneration } = require('../services/generation-audit.service');

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

  // Phase-7 B1/B2/B3：扩展产物状态评估
  const fwInfographicArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'framework_infographic', 'framework')
    : null;
  const frameworkInfographicExists = Boolean(fwInfographicArtifact?.content?.htmlPath || fwInfographicArtifact?.content?.imagePath);

  const knowledgeCardsArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'knowledge_cards_html', 'framework')
    : null;
  const knowledgeCardsExists = Boolean(knowledgeCardsArtifact?.content?.outputPath);

  // PPT 配图状态：所有页面是否已配图（同时考虑 needsManualReview）
  // Phase-7.6 R6：不只看"图存不存在"，还要看"是否被 Vision 标 manual_review"
  const pptPages = pptOutlineArtifact?.content?.pptPages || [];
  const pptPagesWithImages = pptPages.filter((p) => p && (p.imagePath || p.imageUrl)).length;
  const pptPagesNeedingManualReview = pptPages.filter((p) =>
    p && (p.qualityStatus === 'manual_review' || p.needsManualReview === true)
  ).length;
  // R6：真正"完成" = 所有需图页都有图 + 没有 manual_review 标记
  const pptImagesAllReady = pptPages.length > 0
    && pptPagesWithImages === pptPages.length
    && pptPagesNeedingManualReview === 0;

  // R6：Framework 信息图、知识卡片"完成"判断也加上 needsManualReview
  const frameworkInfographicQualityPass = frameworkInfographicExists
    && fwInfographicArtifact?.content?.qualityScore !== undefined
    && fwInfographicArtifact.content.qualityScore >= 7
    && !(fwInfographicArtifact.content.needsManualReview === true);

  // Phase-7.7 B21（2026-04-29）：检查 framework 是否被用户锁定
  // M2.4 已在 execBacktrackFramework 内做了 lock 保护，但 decideNextAction 还会决定回溯，
  // 导致用户看到"Agent 决定回溯 → 被锁阻止"的两步事件，体验混乱。
  // 现在：decide 阶段就检查 frameworkLocked，被锁则不再触发 backtrack——直接落入 done/blocked。
  const fwArtifactForLock = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'framework_json', 'framework')
    : null;
  const frameworkLocked = Boolean(fwArtifactForLock?.lockedByUser);

  return {
    notebook,
    modules,
    framework,
    frameworkQuality,
    frameworkLocked,   // B21：让 decideNextAction 跳过被锁 framework 的回溯决策
    draftCount,
    drafts,
    finalScript,
    lectureQuality,
    pptPageCount,
    videoPromptExists,
    // Phase-7
    frameworkInfographicExists,
    knowledgeCardsExists,
    pptPagesCount: pptPages.length,
    pptPagesWithImages,
    pptImagesAllReady,
    // Phase-7.6 R6：质量通过判断（区别于"仅产物存在"）
    pptPagesNeedingManualReview,
    frameworkInfographicQualityPass,
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
function decideNextAction(state, targetStages, stepLog, capabilities = {}) {
  const {
    framework, frameworkQuality, draftCount, finalScript, lectureQuality,
    pptPageCount, videoPromptExists,
    // Phase-7
    frameworkInfographicExists, knowledgeCardsExists, pptImagesAllReady, pptPagesCount,
    // Phase-7.7 B21：框架是否被用户锁定（lockedByUser=true），用于跳过 backtrack 触发
    frameworkLocked,
  } = state;

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
    // Phase-7.7 B11（2026-04-29）：framework artifact 存在但"内容空壳"也算"未生成"。
    // 之前 Agent 看到 truthy framework 就直接跳过——但用户从已有笔记本复制时，artifact 壳被复制了
    // 内容（objectives/modules）却没复制，导致 Agent 跳过生成。
    // 修法：仅当 frameworkQuality 也 invalid 时（说明 validate 真的不通过），把"内容空壳"判为
    // "尚未生成"（priority 10）；这样不破坏旧测试 mock 里 valid=true 但 modules=[] 的假设。
    const fwContent = framework?.content || framework || {};
    const fwHasNoSubstance = !fwContent.objectives
      || !Array.isArray(fwContent.modules)
      || fwContent.modules.length === 0;
    // B11：与下面的"valid=false 重试"分支同步限制重试次数 < 2，避免无限重生成
    if (fwHasNoSubstance && !frameworkQuality?.valid
        && (globalCounts['generate_framework'] || 0) < 2) {
      return {
        action: 'generate_framework',
        reason: '框架 artifact 存在但内容缺失（objectives/modules 为空），视为尚未生成',
        priority: 10
      };
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
    // Phase-7.7 B21（2026-04-29）：跳过被用户锁定的 framework，避免"决定回溯 → 被锁阻止"的两步混乱事件。
    //   被锁场景下，落入下面的 done/blocked，让 Agent 终止运行，老师手动介入修讲稿/解锁框架。
    if (needs('framework') &&
        finalScript && lectureQuality && !lectureQuality.valid &&
        (postCounts['generate_lecture_formal'] || 0) >= 2 &&
        (globalCounts['backtrack_framework'] || 0) === 0 &&
        !frameworkLocked) {
      return {
        action: 'backtrack_framework',
        reason: `讲稿质量持续不达标（已重试 ${postCounts['generate_lecture_formal']} 次），自动回溯重生成框架`,
        priority: 11
      };
    }
  }

  // ── Phase-7.7 D2（2026-04-30）：framework 周边产物先于 ppt 触发 ──
  // 之前 framework_infographic / knowledge_cards 的 if 在 ppt 阶段判断之后，
  // 当讲稿完成、PPT 还没规划时，会先 return generate_ppt_plan，
  // 信息图/知识卡片永远跑不到。把它们挪到 ppt 阶段之前，确保 framework 周边产物先完成。
  if (needs('framework') && framework && frameworkQuality?.valid
      && !frameworkInfographicExists
      && capabilities.canGenerateFrameworkInfographic === true
      && (globalCounts['generate_framework_infographic'] || 0) === 0) {
    return { action: 'generate_framework_infographic', reason: '教学框架信息图尚未生成', priority: 8 };
  }

  if (needs('framework') && framework && frameworkQuality?.valid
      && !knowledgeCardsExists
      && capabilities.canExportKnowledgeCards === true
      && (globalCounts['export_knowledge_cards'] || 0) === 0) {
    return { action: 'export_knowledge_cards', reason: '知识点卡片 HTML 尚未导出', priority: 7 };
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

  // ── Phase-7 B2: PPT 配图批量生成（capability-gated）──
  // 触发：PPT 页面已生成 + 还有页面缺配图 + 系统具备配图能力 + 重试 < 1
  if (needs('ppt') && pptPageCount > 0 && !pptImagesAllReady
      && capabilities.canGeneratePptImages === true
      && (globalCounts['generate_ppt_images_batch'] || 0) < 1) {
    return { action: 'generate_ppt_images_batch', reason: 'PPT 页面配图未完成', priority: 6 };
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
 * Phase-7.7 B2：把记忆参考 + 老师从 pause modal 提交的微调提示合并成单一 styleRubricText 字符串
 * 优先级：refinementHint 在前（最强提醒）+ 历史参考在后
 * 任一为空时直接退化为另一方，避免空段拼接造成 AI 误解。
 */
function composeStyleRubric(memoryContext, refinementHint) {
  const parts = [];
  const hint = String(refinementHint || '').trim();
  if (hint) {
    parts.push(
      '===老师人工微调要求（最高优先级，必须按此重新生成）===',
      hint,
      '==========================================='
    );
  }
  const memo = String(memoryContext || '').trim();
  if (memo) {
    parts.push(memo);
  }
  return parts.join('\n\n');
}

/**
 * 执行 generate_lecture_abc 动作
 * @param {string} [memoryContext] - 相似历史课程参考文本（Phase-5C Step 4）
 * @param {string} [refinementHint] - 老师从 pause modal 提交的微调提示（B2 新增）
 */
async function execGenerateLectureABC(db, notebookId, aiClient, helpers, memoryContext, refinementHint) {
  const { patchCourseProject } = helpers;
  const notebook = db.getNotebookById(notebookId);
  if (!notebook) throw new Error('Notebook not found');

  const modules = db.getModulesByNotebook(notebookId) || [];
  const frameworkCtx = buildLectureContext(db, notebookId);

  // 将历史参考追加到风格提示文本（Phase-5C Step 4）
  // B2 修复：把老师在 pause modal 里填的 refinementHint 也并入风格提示，让生成真正读到
  const styleRubricText = composeStyleRubric(memoryContext, refinementHint);

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
 * @param {string} [refinementHint] - 老师从 pause modal 提交的微调提示（B2 新增）
 *
 * Phase-7.7 B6（2026-04-29）：
 *   优先用 helpers.createLectureFormalClient() 创建的专用 client；
 *   缺失（用户没在 UI 配置正式稿专用 endpoint）则 fallback 到通用 aiClient。
 *   设计目的：让正式稿走快/便宜的非 reasoning 模型（如 doubao-1.5-pro），
 *   其他文本任务（vision 审核等）仍走多模态模型（doubao-seed-2.0-pro）。
 */
async function execGenerateLectureFormal(db, notebookId, aiClient, helpers, state, memoryContext, refinementHint) {
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
  // B2 修复：老师从 pause modal 提交的 refinementHint 也并入，否则微调白填
  const styleRubricText = composeStyleRubric(memoryContext, refinementHint);

  // B6：优先用专用 client，缺失则 fallback（保持向后兼容）
  let actualAiClient = aiClient;
  if (typeof helpers.createLectureFormalClient === 'function') {
    const dedicated = helpers.createLectureFormalClient();
    if (dedicated) {
      actualAiClient = dedicated;
      console.log('[orchestrator] execGenerateLectureFormal 使用正式稿专用 client（ark_endpoint_lecture_formal）');
    } else {
      console.log('[orchestrator] execGenerateLectureFormal 未配置正式稿专用 endpoint，fallback 到通用 client');
    }
  }

  const { result, quality, attempts, exhausted, attemptLog } = await generateWithRetry(
    {
      drafts,
      preferred: 'a',
      styleRubricText,
      courseName: notebook.name || '课程',
      modules,
      aiClient: actualAiClient,
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
 * 执行 backtrack_framework 动作（Phase-5C Step 5 + Phase-6 M2.4 用户保护）
 *
 * 步骤：
 *  1. M2.4：先检查 framework artifact 是否被用户锁定（lockedByUser=true）
 *     如锁定 → 立即返回 { blocked: true }，调用方应停止 backtracking 并向用户报告
 *  2. 如未锁定，清空讲稿 artifacts（让 assessNotebookState 认为讲稿从未生成过）
 *  3. 重新生成框架（复用 execGenerateFramework 逻辑）
 *
 * 返回值：
 *  - 正常路径：execGenerateFramework 的结果（含 quality / framework / warnings）
 *  - 被阻塞：{ blocked: true, blockReason, conflictType, resolution, framework: null }
 */
async function execBacktrackFramework(db, notebookId, aiClient, helpers, memoryContext) {
  // ── M2.4：检查 framework 上游 artifact 是否被用户锁 ──
  const frameworkArtifact = typeof db.getLatestArtifact === 'function'
    ? db.getLatestArtifact(notebookId, 'framework_json', 'framework')
    : null;
  const decision = resolveConflict(CONFLICT_TYPE.USER_EDIT_VS_AGENT, {
    upstreamArtifact: frameworkArtifact,
  });
  if (decision.blocksAgent) {
    console.log(`[agent] 回溯被用户锁阻止：${decision.reason}`);
    return {
      blocked: true,
      blockReason: decision.reason,
      conflictType: decision.conflictType,
      resolution: decision.resolution,
      framework: null,
      quality: null,
      warnings: [decision.reason],
    };
  }

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
    imageQuality: 'low',
    // Phase-7.6 R5：跨阶段讲稿章节锚点（让 PPT 每页对应到讲稿章节，不偏题）
    lectureSections: pptCtx.lectureSections || [],
    lectureSectionSummary: pptCtx.lectureSectionSummary || '',
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

    // Phase-7.5 M7.5.1：支持从暂停状态恢复
    // resumeFromPause: { stepLog, agentState, refinementHint }
    const resumeFromPause = options.resumeFromPause || null;
    const stepLog = resumeFromPause && Array.isArray(resumeFromPause.stepLog)
      ? [...resumeFromPause.stepLog]   // 继承历史 stepLog（拷贝防引用污染）
      : [];
    // Phase-7.7 B2：把老师在 pause modal 里填的微调提示从 resumeFromPause 提取到闭包里，
    // 后续 execGenerateLectureABC / execGenerateLectureFormal 都能读到，并通过 composeStyleRubric
    // 真正拼到 styleRubricText（之前只 emit 事件、没注入到生成 prompt）
    const refinementHint = (resumeFromPause && typeof resumeFromPause.refinementHint === 'string')
      ? resumeFromPause.refinementHint.trim() : '';

    const emit = (type, payload) => {
      try {
        if (typeof emitEvent === 'function') {
          emitEvent({ notebookId, scope: 'agent', type, ...payload });
        }
      } catch {}
      // Phase-7.7 D5（2026-04-30）：诊断日志——把 Agent 关键事件同步打到终端
      // 之前 emit 只发前端事件，终端看不到 Agent 当前在执行什么动作，
      // 当 helper 里 await 卡死（如 fetch failed 重试中），用户完全无法判断 Agent 状态。
      // 现在：agent.executing / agent.decision / agent.completed / agent.failed / agent.timeout
      // 这些关键事件会同步 console.log，方便诊断。
      if (type === 'agent.decision') {
        console.log(`[agent.decision] step=${payload.step} action=${payload.action} reason=${payload.reason || ''}`);
      } else if (type === 'agent.executing') {
        console.log(`[agent.executing] step=${payload.step} action=${payload.action} message=${payload.message || ''}`);
      } else if (type === 'agent.completed') {
        console.log(`[agent.completed] summary=${payload.summary || ''}`);
      } else if (type === 'agent.timeout' || type === 'agent.error') {
        console.log(`[agent.${type.split('.')[1]}] ${JSON.stringify(payload).slice(0, 200)}`);
      }
    };

    /**
     * Phase-7.5 M7.5.1：暂停 Agent，写 DB + emit 事件，返回 paused 结果
     * 使用场景：质量重试耗尽 / 关键依赖缺失 / 显式收到外部 pause 信号
     */
    function pauseAgent({ stage, reason, details = {}, suggestions = [], agentState = {} }) {
      const pauseEntry = {
        notebookId, stage: stage || 'unknown', reason: reason || '原因未指明',
        details, suggestions, stepLog, agentState,
        pausedAt: new Date().toISOString(),
      };
      // B3 诊断：把 saveAgentPauseState 的调用 / 成功 / 失败状态都打日志，
      // 用于排查"恢复时 DB 找不到 pauseState"的根因
      let saveOk = false;
      let saveErrMsg = null;
      const saveExists = typeof db.saveAgentPauseState === 'function';
      console.log(`[agent.pause] 触发暂停 stage=${pauseEntry.stage} reason=${pauseEntry.reason}`);
      console.log(`[agent.pause] db.saveAgentPauseState typeof=${typeof db.saveAgentPauseState} (saveExists=${saveExists})`);
      if (!saveExists) {
        saveErrMsg = 'db.saveAgentPauseState 未实现';
        console.error(`[agent.pause] ❌ ${saveErrMsg}——pause 状态不会持久化，恢复时必失败`);
      } else {
        try {
          db.saveAgentPauseState(pauseEntry);
          saveOk = true;
          console.log(`[agent.pause] ✅ saveAgentPauseState 已写 DB（notebookId=${notebookId}）`);
          // 立即回读做断言（避免静默"看似成功实则没写入"）
          try {
            if (typeof db.getAgentPauseState === 'function') {
              const readBack = db.getAgentPauseState(notebookId);
              if (!readBack) {
                console.error('[agent.pause] ⚠️ 立即回读返回 null——saveAgentPauseState 实际未持久化！');
                saveOk = false;
                saveErrMsg = '回读 pauseState 返回 null';
              } else {
                console.log(`[agent.pause] ✅ 回读校验通过 stage=${readBack.stage} pausedAt=${readBack.pausedAt}`);
              }
            }
          } catch (rbErr) {
            console.warn('[agent.pause] 回读校验抛错（非致命）:', rbErr.message);
          }
        } catch (e) {
          saveErrMsg = e.message;
          console.error('[agent.pause] ❌ saveAgentPauseState 抛错:', e.stack || e.message);
        }
      }
      emit('agent.needs_human_intervention', {
        stage: pauseEntry.stage, reason: pauseEntry.reason,
        details: pauseEntry.details, suggestions: pauseEntry.suggestions,
        persisted: saveOk, // B3：把持久化结果暴露给前端，便于诊断
        persistError: saveErrMsg,
      });
      return {
        success: false, status: 'paused',
        stepLog, summary: `Agent 暂停：${reason}`,
        pauseInfo: pauseEntry,
        pausePersisted: saveOk, // 让 IPC 层 / 前端可以看到
        pausePersistError: saveErrMsg,
        finalState: assessNotebookState(db, notebookId),
      };
    }

    emit('agent.started', { targetStages, notebookId, resumed: Boolean(resumeFromPause) });
    if (resumeFromPause) {
      emit('agent.resumed', {
        previousStepCount: stepLog.length,
        refinementHint: refinementHint || null,
        refinementHintLength: refinementHint.length, // B2 诊断用
      });
      // B2 诊断：把 hint 是否真注入打到日志，方便测试时确认
      console.log(
        `[agent] resume 已捕获 refinementHint（${refinementHint.length} 字），` +
        `将通过 composeStyleRubric 注入到 lecture 生成 styleRubricText`
      );
      // 恢复时清除 DB pause 状态，避免下次又被识别为暂停
      try {
        if (typeof db.clearAgentPauseState === 'function') {
          db.clearAgentPauseState(notebookId);
        }
      } catch (e) { /* 非致命 */ }
    }

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

      // 决策（Phase-7：传入 capabilities，由 helpers 注入函数的存在性决定可用能力）
      const capabilities = {
        canGenerateFrameworkInfographic: typeof helpers?.generateFrameworkInfographic === 'function',
        canExportKnowledgeCards: typeof helpers?.exportKnowledgeCards === 'function',
        canGeneratePptImages: typeof helpers?.generatePptImagesBatch === 'function',
      };
      const decision = decideNextAction(state, targetStages, stepLog, capabilities);
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
          const fwStart = Date.now();
          execResult = await execGenerateFramework(db, notebookId, aiClient, helpers, memoryContext);
          stepEntry.result = 'ok';
          stepEntry.warnings = execResult.warnings;

          // Phase-7.6 R8：审计日志
          recordGeneration(db, {
            notebookId, stage: 'framework',
            endpoint: aiClient?.endpointId || '',
            rawOutput: JSON.stringify(execResult.framework?.content || execResult.framework || {}).slice(0, 4000),
            quality: { valid: true, errors: [], warnings: execResult.warnings || [] },
            attemptCount: 1,
            durationMs: Date.now() - fwStart,
            outcome: 'success',
            extra: { moduleCount: (execResult.framework?.content?.modules || []).length },
          });

          // Phase-7.6 R3 修复：移除 userForceAccept=true 兜底
          //   - execGenerateFramework 内部已做 validateFrameworkContent（quality 必通过）
          //   - 这里 confirmFrameworkStage 不传 userForceAccept，让 quality 校验自然进行
          //   - 若 confirm 抛错（quality 真有问题）→ 调 pauseAgent 暂停（不再静默 force accept）
          if (v2Runtime && typeof v2Runtime.confirmFrameworkStage === 'function') {
            try {
              await v2Runtime.confirmFrameworkStage({
                notebookId,
                framework: execResult.framework?.content || execResult.framework,
                modules: db.getModulesByNotebook(notebookId),
                // 不再传 userForceAccept；若 quality.invalid 会让 confirm 抛错由 catch 处理
              });
            } catch (confirmErr) {
              // 质量校验未通过 → 暂停 Agent 等老师介入
              console.warn('[agent] framework 阶段质量未达标（暂停 Agent 等介入）:', confirmErr.message);
              stepEntry.completedAt = new Date().toISOString();
              stepLog.push(stepEntry);
              return pauseAgent({
                stage: 'framework',
                reason: `教学框架质量校验未通过：${confirmErr.message}`,
                details: { confirmError: confirmErr.message },
                suggestions: [
                  '在 UI 中手动编辑框架内容（补全缺失的目标 / 模块结构）',
                  '提供"微调提示词"（如"增加过程性评价模块""三维目标更具体"）让 Agent 重新生成',
                  '点击"跳过此步"，框架留为草稿状态，手动完善',
                ],
                agentState: { framework: execResult.framework },
              });
            }
          }

        } else if (decision.action === 'backtrack_framework') {
          // Phase-5C Step 5：讲稿质量不达标，回溯重生成框架
          emit('agent.executing', {
            step,
            action: 'backtrack_framework',
            message: '讲稿质量不达标，自动回溯：清空讲稿 → 重生成框架…'
          });
          execResult = await execBacktrackFramework(db, notebookId, aiClient, helpers, memoryContext);
          // M2.4：检查回溯是否被用户锁阻塞
          if (execResult && execResult.blocked) {
            stepEntry.result = 'blocked_by_user_lock';
            stepEntry.blockReason = execResult.blockReason;
            stepEntry.conflictType = execResult.conflictType;
            stepEntry.warnings = execResult.warnings;
            stepEntry.isBacktrack = true;
            stepEntry.completedAt = new Date().toISOString();
            stepLog.push(stepEntry);
            emit('agent.blocked_by_user_lock', {
              step,
              stage: 'framework',
              reason: execResult.blockReason,
              resolution: execResult.resolution,
            });
            // 终止整个 Agent run——锁定的 artifact 必须等用户主动解锁后才能重试
            return {
              success: false,
              status: 'blocked',
              stepLog,
              summary: `回溯被用户保护阻止：${execResult.blockReason}`,
              blockReason: execResult.blockReason,
              conflictType: execResult.conflictType,
              finalState: assessNotebookState(db, notebookId),
            };
          }
          stepEntry.result = 'ok';
          stepEntry.warnings = execResult.warnings;
          stepEntry.isBacktrack = true;

        } else if (decision.action === 'generate_lecture_abc') {
          emit('agent.executing', { step, action: 'generate_lecture_abc', message: '正在生成讲稿 A/B/C 三稿…' });
          execResult = await execGenerateLectureABC(db, notebookId, aiClient, helpers, memoryContext, refinementHint);
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
          const formalStart = Date.now();
          execResult = await execGenerateLectureFormal(db, notebookId, aiClient, helpers, state, memoryContext, refinementHint);
          stepEntry.result = execResult.exhausted ? 'retry_exhausted' : 'ok';
          stepEntry.attempts = execResult.attempts;
          stepEntry.narrationCharCount = execResult.narrationCharCount;

          // Phase-7.6 R8：审计日志
          recordGeneration(db, {
            notebookId, stage: 'lecture_formal',
            endpoint: aiClient?.endpointId || '',
            rawOutput: execResult.script || '',
            quality: execResult.quality,
            retryReasons: Array.isArray(execResult.attemptLog)
              ? execResult.attemptLog.map((a, i) => ({ attempt: i + 1, message: a.reason || a.error || 'unknown' }))
              : [],
            attemptCount: execResult.attempts || 1,
            durationMs: Date.now() - formalStart,
            outcome: execResult.exhausted ? 'fallback' : 'success',
            extra: { narrationCharCount: execResult.narrationCharCount },
          });

          // Step B: 正式讲稿持久化到 DB
          // Phase-7.5 M7.5.3 A1 改造：移除 userForceAccept 兜底，改为质量未达标时暂停 Agent
          //   - quality.valid=true → 正常 confirm，解锁下游 PPT 阶段
          //   - quality.invalid + 重试已耗尽 → 暂停 Agent + emit 事件等老师介入
          //   - 不再用 userForceAccept=true 强制接受低质量讲稿
          if (v2Runtime && typeof v2Runtime.saveLectureStage === 'function') {
            const lecturePayload = {
              notebookId,
              drafts: state.drafts,
              selectedDraft: 'a',
              finalScript: execResult.script || ''
            };
            try {
              await v2Runtime.saveLectureStage(lecturePayload);
              // Phase-7.7 P0-A 修复：exhausted 优先（即使 quality.valid=true，retry-loop 知道字数不达标）
              // 防御性双保险：quality.js 已升 error，但若 quality.valid 仍 true 且 exhausted=true，
              // 说明 retry-loop 的 isAcceptable 与 quality.valid 口径不一致——直接以 exhausted 为准 pause
              if (execResult.exhausted) {
                stepEntry.completedAt = new Date().toISOString();
                stepLog.push(stepEntry);
                return pauseAgent({
                  stage: 'lecture',
                  reason: `正式讲稿经过 ${execResult.attempts || 3} 次重试仍未达质量标准（讲述字数 ${execResult.narrationCharCount} 字）`,
                  details: {
                    qualityErrors: (execResult.quality?.errors || []).slice(0, 5),
                    qualityWarnings: (execResult.quality?.warnings || []).slice(0, 3),
                    narrationCharCount: execResult.narrationCharCount || 0,
                    attempts: execResult.attempts || 0,
                  },
                  suggestions: [
                    '在 UI 中手动编辑讲稿（修改字数不足的章节、删除寒暄词）',
                    '提供"微调提示词"重新生成（如"增加教学案例""提高互动密度"）',
                    '点击"接受当前版本"——讲稿留为草稿，可后续手动完善',
                  ],
                  agentState: {
                    drafts: state.drafts,
                    finalScript: execResult.script || '',
                    lastQuality: execResult.quality,
                  },
                });
              }
              // 未 exhausted（含 quality.valid=true 正常成功路径）→ 正常 confirm 解锁下游
              if (execResult.quality?.valid) {
                await v2Runtime.confirmLectureStage(lecturePayload);
              }
              // quality.invalid 但 exhausted=false：理论上 retry-loop 应继续重试，不会到这里
            } catch (saveErr) {
              console.warn('[agent] 讲稿持久化/确认失败（非致命）:', saveErr.message);
            }
          }

        } else if (decision.action === 'generate_ppt_plan') {
          // Phase-5D: PPT 页面规划生成
          emit('agent.executing', { step, action: 'generate_ppt_plan', message: '正在生成 PPT 页面规划…' });
          const pptStart = Date.now();
          execResult = await execGeneratePptPlan(db, notebookId, aiClient, v2Runtime);
          stepEntry.result = 'ok';
          stepEntry.pageCount = execResult.pageCount;

          // Phase-7.6 R8：审计日志
          recordGeneration(db, {
            notebookId, stage: 'ppt_plan',
            endpoint: aiClient?.endpointId || '',
            rawOutput: JSON.stringify(execResult.pages || []).slice(0, 4000),
            quality: { valid: execResult.pageCount > 0, errors: [], warnings: [] },
            attemptCount: 1,
            durationMs: Date.now() - pptStart,
            outcome: 'success',
            extra: { pageCount: execResult.pageCount },
          });

          // Phase-7.6 R3：PPT confirm 移除 userForceAccept；质量未达标暂停 Agent
          if (v2Runtime && typeof v2Runtime.confirmPptStage === 'function' && (execResult.pages || []).length > 0) {
            try {
              await v2Runtime.confirmPptStage({
                notebookId,
                pptPages: execResult.pages,
                templateKey: 'pro_minimalist',
                // 不再传 userForceAccept；让 quality 校验自然进行
              });
            } catch (confirmErr) {
              console.warn('[agent] PPT 阶段质量未达标（暂停 Agent）:', confirmErr.message);
              stepEntry.completedAt = new Date().toISOString();
              stepLog.push(stepEntry);
              return pauseAgent({
                stage: 'ppt',
                reason: `PPT 页面规划质量校验未通过：${confirmErr.message}`,
                details: { pageCount: execResult.pageCount, confirmError: confirmErr.message },
                suggestions: [
                  '在 UI 中手动编辑 PPT 页面（补全缺失的标题 / imagePrompt / 关键内容）',
                  '提供"微调提示词"重新生成 PPT 规划',
                  '点击"跳过此步"，PPT 留为草稿状态',
                ],
                agentState: { pptPages: execResult.pages },
              });
            }
          }

        } else if (decision.action === 'generate_framework_infographic') {
          // Phase-7 B1：教学框架信息图生成（capability-gated，需 helpers.generateFrameworkInfographic 注入）
          emit('agent.executing', { step, action: 'generate_framework_infographic', message: '正在生成教学框架信息图…' });
          if (typeof helpers?.generateFrameworkInfographic !== 'function') {
            stepEntry.result = 'skipped';
            stepEntry.warning = 'helpers.generateFrameworkInfographic 未注入，跳过';
          } else {
            try {
              const fwState = assessNotebookState(db, notebookId);
              execResult = await helpers.generateFrameworkInfographic({
                db, notebookId, framework: fwState.framework, modules: fwState.modules,
              });
              stepEntry.result = 'ok';
              stepEntry.imagePath = execResult?.imagePath || null;
              stepEntry.htmlPath = execResult?.htmlPath || null;
            } catch (err) {
              stepEntry.result = 'error_non_fatal';
              stepEntry.error = err.message;
              console.warn('[agent] 框架信息图生成失败（非致命）:', err.message);
            }
          }

        } else if (decision.action === 'export_knowledge_cards') {
          // Phase-7 B3：知识点卡片 HTML 导出（capability-gated）
          emit('agent.executing', { step, action: 'export_knowledge_cards', message: '正在导出互动知识点卡片…' });
          if (typeof helpers?.exportKnowledgeCards !== 'function') {
            stepEntry.result = 'skipped';
            stepEntry.warning = 'helpers.exportKnowledgeCards 未注入，跳过';
          } else {
            try {
              const fwState = assessNotebookState(db, notebookId);
              execResult = await helpers.exportKnowledgeCards({
                db, notebookId, notebook: fwState.notebook, modules: fwState.modules,
              });
              stepEntry.result = 'ok';
              stepEntry.outputPath = execResult?.outputPath || null;
            } catch (err) {
              stepEntry.result = 'error_non_fatal';
              stepEntry.error = err.message;
              console.warn('[agent] 知识点卡片导出失败（非致命）:', err.message);
            }
          }

        } else if (decision.action === 'generate_ppt_images_batch') {
          // Phase-7.5 M7.5.5：PPT 配图深度生成（封面+styleAnchor+Vision 双审核+一致性复核）
          emit('agent.executing', { step, action: 'generate_ppt_images_batch', message: '正在深度生成 PPT 配图（封面 → 内容页 Vision 双审核 → 一致性复核）…' });
          if (typeof helpers?.generatePptImagesBatch !== 'function') {
            stepEntry.result = 'skipped';
            stepEntry.warning = 'helpers.generatePptImagesBatch 未注入，跳过';
          } else {
            try {
              execResult = await helpers.generatePptImagesBatch({
                db, notebookId, aiClient,
              });
              stepEntry.result = 'ok';
              stepEntry.imagesGenerated = execResult?.imagesGenerated || 0;
              stepEntry.imagesSkipped = execResult?.imagesSkipped || 0;
              stepEntry.imagesFailed = execResult?.imagesFailed || 0;
              stepEntry.needsReviewCount = execResult?.needsReviewCount || 0;
              stepEntry.styleAnchor = execResult?.styleAnchor || null;
              stepEntry.consistencyScore = execResult?.consistencyScore || null;
            } catch (err) {
              // M7.5.5：流水线返回 paused 时 helper 抛带 pausePayload 的错误，调 pauseAgent
              if (err.pausePayload) {
                stepEntry.result = 'paused';
                stepEntry.pauseReason = err.pausePayload.reason;
                stepEntry.completedAt = new Date().toISOString();
                stepLog.push(stepEntry);
                return pauseAgent({
                  stage: 'ppt_images',
                  reason: err.pausePayload.reason,
                  details: err.pausePayload.details || {},
                  suggestions: err.pausePayload.suggestions || [],
                  agentState: { phase: err.pausePayload.details?.phase },
                });
              }
              stepEntry.result = 'error_non_fatal';
              stepEntry.error = err.message;
              console.warn('[agent] PPT 配图深度生成失败（非致命）:', err.message);
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
