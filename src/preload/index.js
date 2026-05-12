const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Notebooks
  createNotebook: (data) => ipcRenderer.invoke('notebook:create', data),
  getAllNotebooks: () => ipcRenderer.invoke('notebook:getAll'),
  getNotebookById: (id) => ipcRenderer.invoke('notebook:getById', id),
  deleteNotebook: (id) => ipcRenderer.invoke('notebook:delete', id),
  updateNotebook: (id, data) => ipcRenderer.invoke('notebook:update', { id, data }),
  generateNotebookResearch: (payload) => ipcRenderer.invoke('notebook:generateResearch', payload),

  // Frameworks & AI
  generateFramework: (courseInfo) => ipcRenderer.invoke('ai:generateFramework', courseInfo),
  rebuildSingleCourseFlow: (payload) => ipcRenderer.invoke('course:rebuildSingleFlow', payload),
  generateLectureABC: (payload) => ipcRenderer.invoke('script:generateABC', payload),
  generateFormalLecture: (payload) => ipcRenderer.invoke('script:generateFormal', payload),
  auditLectureStyle: (payload) => ipcRenderer.invoke('quality:auditStyle', payload),
  saveDiscussionDraft: (payload) => ipcRenderer.invoke('course:saveDiscussionDraft', payload),
  saveCourseProjectPatch: (payload) => ipcRenderer.invoke('course:saveProjectPatch', payload),
  listFrameworks: (notebookId) => ipcRenderer.invoke('framework:list', notebookId),
  getCurrentFramework: (notebookId) => ipcRenderer.invoke('framework:getCurrent', notebookId),
  createFramework: (payload) => ipcRenderer.invoke('framework:create', payload),
  updateFramework: (payload) => ipcRenderer.invoke('framework:update', payload),
  setCurrentFramework: (payload) => ipcRenderer.invoke('framework:setCurrent', payload),
  syncStructureImagesToFramework: (payload) => ipcRenderer.invoke('framework:syncStructureImages', payload),

  // Teaching schedule
  getTeachingSchedule: (notebookId) => ipcRenderer.invoke('schedule:get', notebookId),
  saveTeachingSchedule: (payload) => ipcRenderer.invoke('schedule:save', payload),

  // Modules
  listModules: (notebookId) => ipcRenderer.invoke('module:list', notebookId),
  createModule: (payload) => ipcRenderer.invoke('module:create', payload),
  updateModule: (payload) => ipcRenderer.invoke('module:update', payload),
  updateModuleContent: (payload) => ipcRenderer.invoke('module:updateContent', payload),
  deleteModule: (payload) => ipcRenderer.invoke('module:delete', payload),
  replaceModules: (payload) => ipcRenderer.invoke('module:replace', payload),
  setModuleStructureImage: (payload) => ipcRenderer.invoke('module:setStructureImage', payload),

  // Settings
  saveApiKey: (provider, apiKey) =>
    ipcRenderer.invoke('settings:saveApiKey', { provider, apiKey }),
  getApiKey: (provider) => ipcRenderer.invoke('settings:getApiKey', provider),

  // Quality
  auditNotebookQuality: (notebookId) => ipcRenderer.invoke('quality:auditNotebook', notebookId),

  // Resources
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

  // Export
  exportNotebookWord: (notebookId) => ipcRenderer.invoke('word:exportNotebook', notebookId),
  exportDiscussionWord: (payload) => ipcRenderer.invoke('word:exportDiscussion', payload),
  exportLectureWord: (payload) => ipcRenderer.invoke('word:exportLecture', payload),
  exportMergedFramework: (payload) => ipcRenderer.invoke('framework:exportMerged', payload),
  exportQuiz: (payload) => ipcRenderer.invoke('quiz:export', payload),
  exportInteractiveHtml: (payload) => ipcRenderer.invoke('interactive:exportHtml', payload),
  exportPblPack: (payload) => ipcRenderer.invoke('pbl:exportPack', payload),
  // Prompt templates & advice
  getPromptTemplate: (payload) => ipcRenderer.invoke('prompt:getTemplate', payload),
  savePromptTemplate: (payload) => ipcRenderer.invoke('prompt:saveTemplate', payload),
  renderPromptTemplate: (payload) => ipcRenderer.invoke('prompt:render', payload),
  getPromptAdvice: (payload) => ipcRenderer.invoke('prompt:getAdvice', payload),
  applyPromptAdvice: (payload) => ipcRenderer.invoke('prompt:applyAdvice', payload),
  getInfocardTemplate: () => ipcRenderer.invoke('infocard:getTemplate'),
  saveInfocardTemplate: (payload) => ipcRenderer.invoke('infocard:saveTemplate', payload),
  generateInfocard: (payload) => ipcRenderer.invoke('infocard:generate', payload),

  // Image versioning
  generateStructuredImage: (payload) => ipcRenderer.invoke('images:generateStructured', payload),
  generateGenericImage: (payload) => ipcRenderer.invoke('images:generateGeneric', payload),
  listImageVersions: (taskId) => ipcRenderer.invoke('images:listVersions', taskId),
  regenerateImageVersion: (payload) => ipcRenderer.invoke('images:regenerate', payload),
  rollbackImageVersion: (payload) => ipcRenderer.invoke('images:rollbackVersion', payload),
  generateVideoT2V: (payload) => ipcRenderer.invoke('videos:generateT2V', payload),
  exportCoursePpt: (payload) => ipcRenderer.invoke('ppt:exportCourse', payload),
  generateFrameworkInfographicV2: (payload) => ipcRenderer.invoke('v2:generateFrameworkInfographic', payload),
  // Phase-9：阶段通用信息图（design/lecture 用）
  generateStageInfographicV2: (payload) => ipcRenderer.invoke('v2:generateStageInfographic', payload),
  confirmStageInfographicV2: (payload) => ipcRenderer.invoke('v2:confirmStageInfographic', payload),
  getFrameworkStageDataV2: (notebookId) => ipcRenderer.invoke('v2:getFrameworkStageData', notebookId),
  saveFrameworkStageV2: (payload) => ipcRenderer.invoke('v2:saveFrameworkStage', payload),
  confirmFrameworkStageV2: (payload) => ipcRenderer.invoke('v2:confirmFrameworkStage', payload),
  confirmFrameworkInfographicV2: (payload) => ipcRenderer.invoke('v2:confirmFrameworkInfographic', payload),
  // Phase-9 C-1：教学进度表（v4.0.0 起 stage 起点）
  generateScheduleV2: (payload) => ipcRenderer.invoke('v2:generateSchedule', payload),
  saveScheduleV2: (payload) => ipcRenderer.invoke('v2:saveSchedule', payload),
  confirmScheduleV2: (payload) => ipcRenderer.invoke('v2:confirmSchedule', payload),
  getScheduleDataV2: (notebookId) => ipcRenderer.invoke('v2:getScheduleData', notebookId),
  exportScheduleWordV2: (payload) => ipcRenderer.invoke('v2:exportScheduleWord', payload),
  // Phase-9 C-2：教学设计
  generateDesignV2: (payload) => ipcRenderer.invoke('v2:generateDesign', payload),
  saveDesignV2: (payload) => ipcRenderer.invoke('v2:saveDesign', payload),
  confirmDesignV2: (payload) => ipcRenderer.invoke('v2:confirmDesign', payload),
  // Phase-9.5：getDesignData 支持 (notebookId) 或 ({notebookId, artifactId})
  getDesignDataV2: (notebookIdOrPayload) => ipcRenderer.invoke('v2:getDesignData', notebookIdOrPayload),
  // Phase-9.5：列出所有节课设计
  listDesignLessonsV2: (notebookId) => ipcRenderer.invoke('v2:listDesignLessons', notebookId),
  exportDesignWordV2: (payload) => ipcRenderer.invoke('v2:exportDesignWord', payload),
  // Phase-9 C-3：微课视频整套方案（脚本+分镜+提示词+拍摄+剪辑）
  generateMicroVideoV2: (payload) => ipcRenderer.invoke('v2:generateMicroVideo', payload),
  saveMicroVideoV2: (payload) => ipcRenderer.invoke('v2:saveMicroVideo', payload),
  confirmMicroVideoV2: (payload) => ipcRenderer.invoke('v2:confirmMicroVideo', payload),
  getMicroVideoDataV2: (notebookId) => ipcRenderer.invoke('v2:getMicroVideoData', notebookId),
  // Phase-9 C-4：教学实施报告（最终阶段）
  generateReportV2: (payload) => ipcRenderer.invoke('v2:generateReport', payload),
  saveReportV2: (payload) => ipcRenderer.invoke('v2:saveReport', payload),
  confirmReportV2: (payload) => ipcRenderer.invoke('v2:confirmReport', payload),
  getReportDataV2: (notebookId) => ipcRenderer.invoke('v2:getReportData', notebookId),
  // Phase-9 报告 4 格式导出
  reportExportWordV2: (payload) => ipcRenderer.invoke('v2:reportExportWord', payload),
  reportExportMarkdownV2: (payload) => ipcRenderer.invoke('v2:reportExportMarkdown', payload),
  reportExportHtmlV2: (payload) => ipcRenderer.invoke('v2:reportExportHtml', payload),
  reportExportPdfV2: (payload) => ipcRenderer.invoke('v2:reportExportPdf', payload),
  getLectureStageDataV2: (notebookId) => ipcRenderer.invoke('v2:getLectureStageData', notebookId),
  // Phase-9 多节课讲稿
  lessonListV2: (notebookId) => ipcRenderer.invoke('v2:lessonList', notebookId),
  lessonGetV2: (payload) => ipcRenderer.invoke('v2:lessonGet', payload),
  lessonGenerateABCV2: (payload) => ipcRenderer.invoke('v2:lessonGenerateABC', payload),
  lessonGenerateFormalV2: (payload) => ipcRenderer.invoke('v2:lessonGenerateFormal', payload),
  lessonSaveV2: (payload) => ipcRenderer.invoke('v2:lessonSave', payload),
  lessonConfirmV2: (payload) => ipcRenderer.invoke('v2:lessonConfirm', payload),
  lessonExportWordV2: (payload) => ipcRenderer.invoke('v2:lessonExportWord', payload),
  saveLectureStageV2: (payload) => ipcRenderer.invoke('v2:saveLectureStage', payload),
  confirmLectureStageV2: (payload) => ipcRenderer.invoke('v2:confirmLectureStage', payload),
  // Phase-6 M4.1：导入现有讲稿合法入口
  importLectureArtifactV2: (payload) => ipcRenderer.invoke('v2:importLectureArtifact', payload),
  getPptStageDataV2: (notebookId) => ipcRenderer.invoke('v2:getPptStageData', notebookId),
  savePptStageV2: (payload) => ipcRenderer.invoke('v2:savePptStage', payload),
  confirmPptStageV2: (payload) => ipcRenderer.invoke('v2:confirmPptStage', payload),
  generatePptPageCandidatesV2: (payload) => ipcRenderer.invoke('v2:generatePptPageCandidates', payload),
  generatePptPlanV2: (payload) => ipcRenderer.invoke('v2:generatePptPlan', payload),
  readFileAsBase64V2: (filePath) => ipcRenderer.invoke('v2:readFileAsBase64', filePath),
  saveCompositeSlideV2: (payload) => ipcRenderer.invoke('v2:saveCompositeSlide', payload),
  generateDiagramV2: (payload) => ipcRenderer.invoke('v2:generateDiagram', payload),
  getInfographicOptionsV2: () => ipcRenderer.invoke('v2:getInfographicOptions'),
  exportKnowledgeCardsV2: (payload) => ipcRenderer.invoke('v2:exportKnowledgeCards', payload),
  exportInteractiveCardsV2: (payload) => ipcRenderer.invoke('v2:exportInteractiveCards', payload),  // A3-C: 互动测试卡片
  getVideoStageDataV2: (notebookId) => ipcRenderer.invoke('v2:getVideoStageData', notebookId),
  saveVideoStageV2: (payload) => ipcRenderer.invoke('v2:saveVideoStage', payload),
  getStageOperationsV2: (payload) => ipcRenderer.invoke('v2:getStageOperations', payload),

  // Phase-5C: Agent
  agentRun: (payload) => ipcRenderer.invoke('agent:run', payload),
  agentGetStatus: (notebookId) => ipcRenderer.invoke('agent:getStatus', notebookId),
  // Phase-7.5 M7.5.1: 暂停-恢复机制
  agentGetPauseState: (notebookId) => ipcRenderer.invoke('agent:getPauseState', notebookId),
  agentResume: (payload) => ipcRenderer.invoke('agent:resume', payload),
  agentClearPauseState: (notebookId) => ipcRenderer.invoke('agent:clearPauseState', notebookId),

  // 参考资料注入：URL 抓取 + DOCX 解析
  fetchUrlContent: (url) => ipcRenderer.invoke('system:fetchUrlContent', url),
  readDocxContent: (payload) => ipcRenderer.invoke('system:readDocxContent', payload),

  // Phase-7.7 A3: 我的工作台
  workbenchGetStats: () => ipcRenderer.invoke('workbench:getStats'),
});

console.log('鉁?棰勫姞杞借剼鏈凡娉ㄥ叆');

