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
  getFrameworkStageDataV2: (notebookId) => ipcRenderer.invoke('v2:getFrameworkStageData', notebookId),
  saveFrameworkStageV2: (payload) => ipcRenderer.invoke('v2:saveFrameworkStage', payload),
  confirmFrameworkStageV2: (payload) => ipcRenderer.invoke('v2:confirmFrameworkStage', payload),
  confirmFrameworkInfographicV2: (payload) => ipcRenderer.invoke('v2:confirmFrameworkInfographic', payload),
  getLectureStageDataV2: (notebookId) => ipcRenderer.invoke('v2:getLectureStageData', notebookId),
  saveLectureStageV2: (payload) => ipcRenderer.invoke('v2:saveLectureStage', payload),
  confirmLectureStageV2: (payload) => ipcRenderer.invoke('v2:confirmLectureStage', payload),
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
  getVideoStageDataV2: (notebookId) => ipcRenderer.invoke('v2:getVideoStageData', notebookId),
  saveVideoStageV2: (payload) => ipcRenderer.invoke('v2:saveVideoStage', payload),
  getStageOperationsV2: (payload) => ipcRenderer.invoke('v2:getStageOperations', payload),

  // Phase-5C: Agent
  agentRun: (payload) => ipcRenderer.invoke('agent:run', payload),
  agentGetStatus: (notebookId) => ipcRenderer.invoke('agent:getStatus', notebookId),

  // 参考资料注入：URL 抓取 + DOCX 解析
  fetchUrlContent: (url) => ipcRenderer.invoke('system:fetchUrlContent', url),
  readDocxContent: (payload) => ipcRenderer.invoke('system:readDocxContent', payload),
});

console.log('鉁?棰勫姞杞借剼鏈凡娉ㄥ叆');

