/**
 * preload/index.js — IPC API 暴露（v4.3.0 瘦身版）
 *
 * P1.1 大清理（2026-05-17）：
 *   - 删除 A/B/C 三稿生成体系（lessonGenerateABC / generateLectureABC / generateFormalLecture / auditLectureStyle）
 *   - 删除 Agent 自动模式（agentRun / agentGetStatus / agentGetPauseState / agentResume / agentClearPauseState）
 *   - 删除 v3 framework legacy（generateFramework / framework:* / listFrameworks / createFramework / updateFramework / setCurrentFramework / syncStructureImagesToFramework / exportMergedFramework）
 *   - 删除 v2 framework stage（getFrameworkStageDataV2 / saveFrameworkStageV2 / confirmFrameworkStageV2 / confirmFrameworkInfographicV2 / generateFrameworkInfographicV2）
 *   - 删除质量审计旧 IPC（auditNotebookQuality）
 *   - 删除 discussion / project patch 等已废 IPC
 *
 * v4.3.0 工作流：① schedule → ② design → ③ ppt → ④ lecture（1稿+改+正式稿）→ ⑤ quiz+homework → ⑥ video（提示词+seedance）→ ⑦ report
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ═══ 基础：Notebook + Settings + Resources + Workflow ═══
  createNotebook: (data) => ipcRenderer.invoke('notebook:create', data),
  getAllNotebooks: () => ipcRenderer.invoke('notebook:getAll'),
  getNotebookById: (id) => ipcRenderer.invoke('notebook:getById', id),
  deleteNotebook: (id) => ipcRenderer.invoke('notebook:delete', id),
  updateNotebook: (id, data) => ipcRenderer.invoke('notebook:update', { id, data }),
  generateNotebookResearch: (payload) => ipcRenderer.invoke('notebook:generateResearch', payload),

  saveApiKey: (provider, apiKey) => ipcRenderer.invoke('settings:saveApiKey', { provider, apiKey }),
  getApiKey: (provider) => ipcRenderer.invoke('settings:getApiKey', provider),

  listResources: (filters) => ipcRenderer.invoke('resource:list', filters),
  importResources: (payload) => ipcRenderer.invoke('resource:import', payload),
  reindexResources: () => ipcRenderer.invoke('resource:reindexLibrary'),
  openResource: (storagePath) => ipcRenderer.invoke('resource:open', storagePath),
  openExternalUrl: (url) => ipcRenderer.invoke('util:openExternalUrl', url),
  getNotebookWorkspaceRoot: (notebookId) => ipcRenderer.invoke('workspace:getNotebookRoot', notebookId),
  openNotebookWorkspaceRoot: (notebookId) => ipcRenderer.invoke('workspace:openNotebookRoot', notebookId),
  deleteResource: (resourceId) => ipcRenderer.invoke('resource:delete', resourceId),

  getWorkflowState: (notebookId) => ipcRenderer.invoke('workflow:getState', notebookId),
  setWorkflowStage: (payload) => ipcRenderer.invoke('workflow:setStage', payload),
  listArtifacts: (filters) => ipcRenderer.invoke('artifact:list', filters),
  listBackendEvents: (filters) => ipcRenderer.invoke('backend:listEvents', filters),

  // ═══ Module（旧版，可能 P3 时随 framework 一起清） ═══
  listModules: (notebookId) => ipcRenderer.invoke('module:list', notebookId),
  createModule: (payload) => ipcRenderer.invoke('module:create', payload),
  updateModule: (payload) => ipcRenderer.invoke('module:update', payload),
  updateModuleContent: (payload) => ipcRenderer.invoke('module:updateContent', payload),
  deleteModule: (payload) => ipcRenderer.invoke('module:delete', payload),
  replaceModules: (payload) => ipcRenderer.invoke('module:replace', payload),
  setModuleStructureImage: (payload) => ipcRenderer.invoke('module:setStructureImage', payload),

  // ═══ 通用导出 ═══
  exportNotebookWord: (notebookId) => ipcRenderer.invoke('word:exportNotebook', notebookId),
  exportDiscussionWord: (payload) => ipcRenderer.invoke('word:exportDiscussion', payload),
  exportLectureWord: (payload) => ipcRenderer.invoke('word:exportLecture', payload),
  exportQuiz: (payload) => ipcRenderer.invoke('quiz:export', payload),
  exportInteractiveHtml: (payload) => ipcRenderer.invoke('interactive:exportHtml', payload),
  exportPblPack: (payload) => ipcRenderer.invoke('pbl:exportPack', payload),

  // ═══ Prompt template / Infocard ═══
  getPromptTemplate: (payload) => ipcRenderer.invoke('prompt:getTemplate', payload),
  savePromptTemplate: (payload) => ipcRenderer.invoke('prompt:saveTemplate', payload),
  renderPromptTemplate: (payload) => ipcRenderer.invoke('prompt:render', payload),
  getPromptAdvice: (payload) => ipcRenderer.invoke('prompt:getAdvice', payload),
  applyPromptAdvice: (payload) => ipcRenderer.invoke('prompt:applyAdvice', payload),
  getInfocardTemplate: () => ipcRenderer.invoke('infocard:getTemplate'),
  saveInfocardTemplate: (payload) => ipcRenderer.invoke('infocard:saveTemplate', payload),
  generateInfocard: (payload) => ipcRenderer.invoke('infocard:generate', payload),

  // ═══ Image / Video 共用工具 ═══
  generateStructuredImage: (payload) => ipcRenderer.invoke('images:generateStructured', payload),
  generateGenericImage: (payload) => ipcRenderer.invoke('images:generateGeneric', payload),
  listImageVersions: (taskId) => ipcRenderer.invoke('images:listVersions', taskId),
  regenerateImageVersion: (payload) => ipcRenderer.invoke('images:regenerate', payload),
  rollbackImageVersion: (payload) => ipcRenderer.invoke('images:rollbackVersion', payload),
  generateVideoT2V: (payload) => ipcRenderer.invoke('videos:generateT2V', payload),

  // ═══ ① 教学进度表 ═══
  generateScheduleV2: (payload) => ipcRenderer.invoke('v2:generateSchedule', payload),
  saveScheduleV2: (payload) => ipcRenderer.invoke('v2:saveSchedule', payload),
  validateScheduleJsonV2: (payload) => ipcRenderer.invoke('v2:validateScheduleJson', payload),
  confirmScheduleV2: (payload) => ipcRenderer.invoke('v2:confirmSchedule', payload),
  getScheduleDataV2: (notebookId) => ipcRenderer.invoke('v2:getScheduleData', notebookId),
  exportScheduleWordV2: (payload) => ipcRenderer.invoke('v2:exportScheduleWord', payload),

  // ═══ ② 教学设计（按节）═══
  generateDesignV2: (payload) => ipcRenderer.invoke('v2:generateDesign', payload),
  saveDesignV2: (payload) => ipcRenderer.invoke('v2:saveDesign', payload),
  confirmDesignV2: (payload) => ipcRenderer.invoke('v2:confirmDesign', payload),
  getDesignDataV2: (notebookIdOrPayload) => ipcRenderer.invoke('v2:getDesignData', notebookIdOrPayload),
  listDesignLessonsV2: (notebookId) => ipcRenderer.invoke('v2:listDesignLessons', notebookId),
  exportDesignWordV2: (payload) => ipcRenderer.invoke('v2:exportDesignWord', payload),
  deleteDesignLessonV2: (payload) => ipcRenderer.invoke('v2:deleteDesignLesson', payload),
  listDeletedDesignLessonsV2: (notebookId) => ipcRenderer.invoke('v2:listDeletedDesignLessons', notebookId),
  restoreDesignLessonV2: (payload) => ipcRenderer.invoke('v2:restoreDesignLesson', payload),
  // 设计阶段信息图（AI 自决 layout，不再走 6 种固定模板）
  generateStageInfographicV2: (payload) => ipcRenderer.invoke('v2:generateStageInfographic', payload),
  confirmStageInfographicV2: (payload) => ipcRenderer.invoke('v2:confirmStageInfographic', payload),
  generateDiagramV2: (payload) => ipcRenderer.invoke('v2:generateDiagram', payload),
  getInfographicOptionsV2: () => ipcRenderer.invoke('v2:getInfographicOptions'),

  // ═══ ③ PPT 课件 ═══
  getPptStageDataV2: (notebookId) => ipcRenderer.invoke('v2:getPptStageData', notebookId),
  savePptStageV2: (payload) => ipcRenderer.invoke('v2:savePptStage', payload),
  confirmPptStageV2: (payload) => ipcRenderer.invoke('v2:confirmPptStage', payload),
  generatePptPlanV2: (payload) => ipcRenderer.invoke('v2:generatePptPlan', payload),
  // v4.3.0 D1+D2（2026-05-18）：PPT 视觉 token AI 推荐
  suggestPptDesignTokensV2: (payload) => ipcRenderer.invoke('v2:suggestPptDesignTokens', payload),
  generatePptPageCandidatesV2: (payload) => ipcRenderer.invoke('v2:generatePptPageCandidates', payload),
  regeneratePptPageV2: (payload) => ipcRenderer.invoke('v2:regeneratePptPage', payload),
  saveCompositeSlideV2: (payload) => ipcRenderer.invoke('v2:saveCompositeSlide', payload),
  exportCoursePpt: (payload) => ipcRenderer.invoke('ppt:exportCourse', payload),
  onPptProgress: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('v2:pptProgress', wrapped);
    return () => ipcRenderer.removeListener('v2:pptProgress', wrapped);
  },
  listConfirmedDesignsV2: (notebookId) => ipcRenderer.invoke('v2:listConfirmedDesigns', notebookId),

  // ═══ ④ 讲稿（新流程：1 稿 + 老师改 + 正式稿）═══
  // P1.1（2026-05-17）：lessonGenerateDraft 替代废弃的 lessonGenerateABC
  lessonGenerateDraftV2: (payload) => ipcRenderer.invoke('v2:lessonGenerateDraft', payload),
  lessonGenerateFormalV2: (payload) => ipcRenderer.invoke('v2:lessonGenerateFormal', payload),
  // v4.3.0 D6.5（2026-05-18）：辅助对话 patch 讲稿
  lessonChatPatchV2: (payload) => ipcRenderer.invoke('v2:lessonChatPatch', payload),
  // v4.3.0 D7（2026-05-18）：lecture 阶段启动数据（PPT 列表 + 默认 lessonMeta 预填）
  getLectureBootstrapV2: (payload) => ipcRenderer.invoke('v2:getLectureBootstrap', payload),
  // v4.3.0 D9.3（2026-05-18）：手动强制解锁下游 stage（绕过质量门槛）
  forceUnlockNextStageV2: (payload) => ipcRenderer.invoke('v2:forceUnlockNextStage', payload),

  // ═══ ⑤ 在线测验（v4.3.3 新增） ═══
  quizGenerateV2: (payload) => ipcRenderer.invoke('v2:quizGenerate', payload),
  quizSaveV2: (payload) => ipcRenderer.invoke('v2:quizSave', payload),
  quizConfirmV2: (payload) => ipcRenderer.invoke('v2:quizConfirm', payload),
  quizListV2: (notebookId) => ipcRenderer.invoke('v2:quizList', notebookId),
  quizGetV2: (payload) => ipcRenderer.invoke('v2:quizGet', payload),

  // ═══ ⑥ 课后作业（v4.3.3 新增） ═══
  homeworkGenerateV2: (payload) => ipcRenderer.invoke('v2:homeworkGenerate', payload),
  homeworkSaveV2: (payload) => ipcRenderer.invoke('v2:homeworkSave', payload),
  homeworkConfirmV2: (payload) => ipcRenderer.invoke('v2:homeworkConfirm', payload),
  homeworkListV2: (notebookId) => ipcRenderer.invoke('v2:homeworkList', notebookId),
  homeworkGetV2: (payload) => ipcRenderer.invoke('v2:homeworkGet', payload),
  lessonListV2: (notebookId) => ipcRenderer.invoke('v2:lessonList', notebookId),
  lessonGetV2: (payload) => ipcRenderer.invoke('v2:lessonGet', payload),
  lessonSaveV2: (payload) => ipcRenderer.invoke('v2:lessonSave', payload),
  lessonConfirmV2: (payload) => ipcRenderer.invoke('v2:lessonConfirm', payload),
  lessonRepairMetaFromTitleV2: (payload) => ipcRenderer.invoke('v2:lessonRepairMetaFromTitle', payload),
  lessonExportWordV2: (payload) => ipcRenderer.invoke('v2:lessonExportWord', payload),
  // Lecture stage 通用（read/save/confirm/import）
  getLectureStageDataV2: (notebookId) => ipcRenderer.invoke('v2:getLectureStageData', notebookId),
  saveLectureStageV2: (payload) => ipcRenderer.invoke('v2:saveLectureStage', payload),
  confirmLectureStageV2: (payload) => ipcRenderer.invoke('v2:confirmLectureStage', payload),
  importLectureArtifactV2: (payload) => ipcRenderer.invoke('v2:importLectureArtifact', payload),
  generateLectureFromPptV2: (payload) => ipcRenderer.invoke('v2:generateLectureFromPpt', payload),
  listConfirmedLessonsV2: (notebookId) => ipcRenderer.invoke('v2:listConfirmedLessons', notebookId),

  // ═══ ⑤ 课堂互动测验 + 作业（基于讲稿生成）═══
  // 2026-05-17：单独重生动态练习题
  regenerateDynamicExerciseV2: (payload) => ipcRenderer.invoke('v2:regenerateDynamicExercise', payload),
  openExercisePresentationV2: (payload) => ipcRenderer.invoke('v2:openExercisePresentation', payload),
  exportExerciseHtmlV2: (payload) => ipcRenderer.invoke('v2:exportExerciseHtml', payload),
  rebuildExerciseHtmlV2: (payload) => ipcRenderer.invoke('v2:rebuildExerciseHtml', payload),
  exportInteractiveCardsV2: (payload) => ipcRenderer.invoke('v2:exportInteractiveCards', payload),
  exportKnowledgeCardsV2: (payload) => ipcRenderer.invoke('v2:exportKnowledgeCards', payload),

  // ═══ ⑥ 视频生成（提示词 + seedance 实调出 mp4）═══
  generateMicroVideoV2: (payload) => ipcRenderer.invoke('v2:generateMicroVideo', payload),
  saveMicroVideoV2: (payload) => ipcRenderer.invoke('v2:saveMicroVideo', payload),
  confirmMicroVideoV2: (payload) => ipcRenderer.invoke('v2:confirmMicroVideo', payload),
  getMicroVideoDataV2: (notebookId) => ipcRenderer.invoke('v2:getMicroVideoData', notebookId),
  // v4.3.3 测试报告 #4 修复：微课方案 Word 导出
  exportMicroVideoWordV2: (payload) => ipcRenderer.invoke('v2:exportMicroVideoWord', payload),
  getVideoStageDataV2: (notebookId) => ipcRenderer.invoke('v2:getVideoStageData', notebookId),
  saveVideoStageV2: (payload) => ipcRenderer.invoke('v2:saveVideoStage', payload),

  // ═══ ⑦ 教学实施报告 ═══
  generateReportV2: (payload) => ipcRenderer.invoke('v2:generateReport', payload),
  saveReportV2: (payload) => ipcRenderer.invoke('v2:saveReport', payload),
  confirmReportV2: (payload) => ipcRenderer.invoke('v2:confirmReport', payload),
  getReportDataV2: (notebookId) => ipcRenderer.invoke('v2:getReportData', notebookId),
  reportExportWordV2: (payload) => ipcRenderer.invoke('v2:reportExportWord', payload),
  reportExportMarkdownV2: (payload) => ipcRenderer.invoke('v2:reportExportMarkdown', payload),
  reportExportHtmlV2: (payload) => ipcRenderer.invoke('v2:reportExportHtml', payload),
  reportExportPdfV2: (payload) => ipcRenderer.invoke('v2:reportExportPdf', payload),

  // ═══ Session 上下文 + 操作日志 + 工作台 ═══
  // v4.3.3 Codex Round 4 #1：单一来源契约
  getStageContractsV2: () => ipcRenderer.invoke('v2:getStageContracts'),
  getSessionContextV2: (notebookId) => ipcRenderer.invoke('v2:getSessionContext', notebookId),
  updateSessionContextV2: (payload) => ipcRenderer.invoke('v2:updateSessionContext', payload),
  switchActiveLessonV2: (payload) => ipcRenderer.invoke('v2:switchActiveLesson', payload),
  setActiveArtifactV2: (payload) => ipcRenderer.invoke('v2:setActiveArtifact', payload),
  getStageOperationsV2: (payload) => ipcRenderer.invoke('v2:getStageOperations', payload),
  workbenchGetStats: () => ipcRenderer.invoke('workbench:getStats'),
  workbenchOpenHistoryArtifact: (payload) => ipcRenderer.invoke('workbench:openHistoryArtifact', payload),
  // v4.3.3 P0-1：跨版本数据找回
  workbenchListRecoverable: () => ipcRenderer.invoke('workbench:listRecoverable'),
  workbenchRestoreArtifact: (payload) => ipcRenderer.invoke('workbench:restoreArtifact', payload),

  // ═══ 参考素材：URL 抓取 + 多格式解析 ═══
  fetchUrlContent: (url) => ipcRenderer.invoke('system:fetchUrlContent', url),
  readDocxContent: (payload) => ipcRenderer.invoke('system:readDocxContent', payload),
  // v4.3.0 D3（2026-05-18）：.pptx 参考素材解析
  readPptxContent: (payload) => ipcRenderer.invoke('system:readPptxContent', payload),
  // v4.3.0 D6.4（2026-05-18）：PDF 数字版抽取 + 图片 OCR（复用多模态文本端点 ep-m-...）
  readPdfContent: (payload) => ipcRenderer.invoke('system:readPdfContent', payload),
  readImageOcr: (payload) => ipcRenderer.invoke('v2:readImageOcr', payload),
  readFileAsBase64V2: (filePath) => ipcRenderer.invoke('v2:readFileAsBase64', filePath),
});

console.log('[preload] v4.3.0 API 已注入（已删 ABC / Agent / Framework / 模板锚定）');
