const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const DatabaseManager = require('./database/db-simple');
const { exportNotebookWord, exportDiscussionWord, exportMergedDiscussionWord, exportLectureWord } = require('./export/word');
const {
  exportFrameworkMarkdown,
  buildFrameworkMarkdown,
  exportDiscussionMarkdown,
  resolveDiscussionMarkdown,
  mergeDiscussionWithInfographics
} = require('./export/markdown');
const { exportQuiz } = require('./export/quiz');
const { exportInteractiveHtml } = require('./export/interactive-html');
const { exportPblPack } = require('./export/pbl-pack');
const { exportCoursePpt } = require('./export/ppt');
const { generateFramework: generateFrameworkDeepseek } = require('./api/deepseek');
const { generateFramework: generateFrameworkArk } = require('./api/ark');
const { resolveProviderConfig, createAiClientByConfig } = require('./api/provider-config');
const { normalizeErrorMessage } = require('./api/request-utils');
const { auditNotebookQuality } = require('./quality/audit');
const { auditLectureStyle } = require('./quality/style-audit');
const { generateLectureABCDrafts } = require('./script/abc-generator');
const { generateFormalLectureScript } = require('./script/formal-generator');
const { normalizeTeacherStyleRubric } = require('./script/style-rubric');
const { PromptTemplateService } = require('./services/prompt-template.service');
const { ImageVersionService } = require('./services/image-version.service');
const { PromptAdvisorService } = require('./services/prompt-advisor.service');
const { ImageGeneratorService } = require('./services/image-generator.service');
const { InfographicCardService } = require('./services/infographic-card.service');
const { VideoGeneratorService } = require('./services/video-generator.service');
const {
  normalizeFrameworkContent,
  validateFrameworkContent
} = require('./api/framework-schema');
const {
  runGenerationPipeline,
  generateSceneOutlinesFromRequirements,
  generateFullScenes
} = require('./course');
const {
  PPT_TEMPLATE_PRESETS,
  PPT_FIXED_IMAGE_MODEL,
  ensurePptImagePromptForPage,
  buildPptLockedPrompt,
  getPptPageTaskId,
  videoPrompt
} = require('../shared/v2-stage-helpers');
const { createBackendEventBus } = require('./v2/backend-events');
const { createArtifactTracker } = require('./v2/artifact-tracker');
const { createExportRuntime } = require('./v2/export-runtime');
const { computeUnlockedStages, validateStageTransition } = require('./v2/contracts');
const {
  buildFrameworkPublicationContract,
  buildLecturePublicationContract,
  buildPptPublicationContract
} = require('./v2/publication-contracts');
const { createV2Runtime } = require('./v2/runtime');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-img',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);
app.setName('广纺织课程助手@liu');

// Detached Windows launches may have broken stdout/stderr pipes.
if (process.stdout && typeof process.stdout.on === 'function') {
  process.stdout.on('error', () => {});
}
if (process.stderr && typeof process.stderr.on === 'function') {
  process.stderr.on('error', () => {});
}

let db;
let promptTemplateService;
let imageVersionService;
let promptAdvisorService;
let imageGeneratorService;
let infographicCardService;
let videoGeneratorService;
let v2Runtime;
let backendEventBus;
let artifactTracker;
let exportRuntime;
const LEGACY_IPC_DISABLED = true;
const ensureDb = () => {
  if (!db) {
    throw new Error('Database not initialized');
  }
};
const logInfo = () => {};
const logError = () => {};
let mainWindow;

function inferInfocardStyle(courseName, topic, content) {
  const all = `${courseName} ${topic} ${content}`.toLowerCase();
  const styles = [];
  if (/服装|陈列|展示|搭配|时尚|纺织|面料|品牌/.test(all)) styles.push('新中式美学与时尚设计风格');
  else if (/电路|电子|焊接|元件|led|电气|电工/.test(all)) styles.push('工程技术蓝图风格');
  else if (/光学|光电|镜头|传感器|视觉/.test(all)) styles.push('科技精密仪器风格');
  else if (/机械|模具|数控|加工|制造/.test(all)) styles.push('工业制造蓝图风格');
  else styles.push('职业教育教学信息图');
  if (/案例|品牌|传播|海报|pop/.test(all)) styles.push('强调案例展示与视觉对比');
  if (/实践|操作|组装|动手|实训/.test(all)) styles.push('突出操作步骤与流程指引');
  if (/评价|标准|互评|检查|验收/.test(all)) styles.push('强调标准对照与评价框架');
  return styles.join('，') || '职业教育教学信息图';
}

function sanitizeWorkspaceSegment(value, fallback = '未命名课程') {
  const text = String(value || '').trim();
  const normalized = text
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim();
  return normalized || fallback;
}

function getTeacherWorkspaceRoot() {
  return path.join(app.getPath('documents'), '课程开发助手工作区');
}

function ensureNotebookWorkspaceDirs(notebook) {
  if (!notebook || !notebook.id) return null;
  const courseDir = sanitizeWorkspaceSegment(notebook.name, `课程-${notebook.id}`);
  const root = getTeacherWorkspaceRoot();
  const notebookRoot = path.join(root, courseDir);
  const subDirs = [
    notebookRoot,
    path.join(notebookRoot, 'framework'),
    path.join(notebookRoot, 'framework', 'infographics'),
    path.join(notebookRoot, 'lecture'),
    path.join(notebookRoot, 'ppt'),
    path.join(notebookRoot, 'ppt', 'images'),
    path.join(notebookRoot, 'video'),
    path.join(notebookRoot, 'assets'),
    path.join(notebookRoot, 'exports')
  ];
  subDirs.forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  return notebookRoot;
}

function ensureNotebookWorkspaceState(notebook) {
  if (!notebook || !notebook.id) return notebook;
  const ensuredPath = ensureNotebookWorkspaceDirs(notebook);
  const patch = {};
  if (ensuredPath && notebook.workspacePath !== ensuredPath) {
    patch.workspacePath = ensuredPath;
  }
  if (!notebook.currentStage) {
    patch.currentStage = 'framework';
  }
  if (Object.keys(patch).length > 0) {
    return db.updateNotebook(notebook.id, patch);
  }
  return notebook;
}

function getDefaultWorkflowState(notebookId) {
  return {
    notebookId,
    currentStage: 'framework',
    unlockedStages: ['framework'],
    currentArtifactRefs: {},
    updatedAt: new Date().toISOString()
  };
}

function normalizeUnlockedStages(stages) {
  const base = ['framework'];
  const extra = Array.isArray(stages) ? stages : [];
  return Array.from(new Set([...base, ...extra.filter(Boolean)]));
}

function ensureWorkflowStateForNotebook(notebookId) {
  const notebook = db.getNotebookById(notebookId);
  if (!notebook) return null;
  const existing = db.getWorkflowState(notebookId) || getDefaultWorkflowState(notebookId);
  const currentStage = notebook.currentStage || existing.currentStage || 'framework';
  const unlockedStages = normalizeUnlockedStages(existing.unlockedStages || ['framework']);
  const next = db.upsertWorkflowState(notebookId, {
    ...existing,
    currentStage,
    unlockedStages
  });
  if (notebook.currentStage !== currentStage) {
    db.updateNotebook(notebookId, { currentStage });
  }
  return next;
}

function buildFrameworkPreviewMarkdown(notebookId) {
  const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
  if (!notebook) return null;
  const framework = db.getCurrentFramework(notebookId);
  if (!framework) return null;
  const modules = db.getModulesByNotebook(notebookId);
  const schedule = db.getTeachingSchedule(notebookId);
  const markdown = buildFrameworkMarkdown({
    notebook,
    framework,
    modules,
    schedule
  });
  return {
    notebook,
    framework,
    modules,
    schedule,
    markdown
  };
}

function syncFrameworkArtifacts(notebookId, options = {}) {
  const bundle = buildFrameworkPreviewMarkdown(notebookId);
  if (!bundle) return null;
  const workflow = ensureWorkflowStateForNotebook(notebookId) || getDefaultWorkflowState(notebookId);
  const isConfirmed = Boolean(options.confirmed || (workflow.unlockedStages || []).includes('lecture'));
  const quality = options.quality || {};
  const evidence = buildArtifactEvidence({
    stage: 'framework',
    quality,
    sourceRefs: [
      { kind: 'notebook', ref: String(notebookId), label: bundle.notebook.name || '课程' }
    ],
    reviewReasons: options.reviewReasons || []
  });
  const draftStatus = evidence.reviewFlags.length ? 'review_needed' : 'generated';
  const frameworkJsonSource = JSON.stringify(bundle.framework.content || {}, null, 2);
  const currentJsonArtifactId = workflow?.currentArtifactRefs?.frameworkJsonId;
  const currentPreviewArtifactId = workflow?.currentArtifactRefs?.frameworkPreviewId;
  let jsonArtifact = null;
  if (currentJsonArtifactId) {
    try {
      jsonArtifact = updateTrackedArtifact(currentJsonArtifactId, {
        title: `${bundle.notebook.name}-framework-json`,
        content: bundle.framework.content || {},
        previewText: frameworkJsonSource,
        format: 'json',
        status: isConfirmed ? 'confirmed' : draftStatus,
        confirmed: isConfirmed,
        reviewFlags: evidence.reviewFlags,
        validationResults: evidence.validationResults,
        sourceRefs: evidence.sourceRefs,
        blockingIssues: evidence.blockingIssues,
        lifecycle: {
          generatedAt: new Date().toISOString(),
          confirmedAt: isConfirmed ? new Date().toISOString() : null
        }
      });
    } catch {
      jsonArtifact = null;
    }
  }
  if (!jsonArtifact) {
    jsonArtifact = createTrackedArtifact(notebookId, {
      notebookId,
      type: 'framework_json',
      stage: 'framework',
      title: `${bundle.notebook.name}-framework-json`,
      content: bundle.framework.content || {},
      format: 'json',
      status: isConfirmed ? 'confirmed' : draftStatus,
      confirmed: isConfirmed,
      previewText: frameworkJsonSource,
      reviewFlags: evidence.reviewFlags,
      validationResults: evidence.validationResults,
      sourceRefs: evidence.sourceRefs,
      blockingIssues: evidence.blockingIssues
    });
  }

  let previewArtifact = null;
  if (currentPreviewArtifactId) {
    try {
      previewArtifact = updateTrackedArtifact(currentPreviewArtifactId, {
        title: `${bundle.notebook.name}-framework-preview`,
        content: bundle.markdown,
        previewText: bundle.markdown,
        format: 'md',
        status: isConfirmed ? 'confirmed' : draftStatus,
        confirmed: isConfirmed,
        sourceArtifactIds: [jsonArtifact.id],
        reviewFlags: evidence.reviewFlags,
        validationResults: evidence.validationResults,
        sourceRefs: [...evidence.sourceRefs, { kind: 'artifact', ref: String(jsonArtifact.id), label: 'framework-json' }],
        blockingIssues: evidence.blockingIssues,
        lifecycle: {
          generatedAt: new Date().toISOString(),
          confirmedAt: isConfirmed ? new Date().toISOString() : null
        }
      });
    } catch {
      previewArtifact = null;
    }
  }
  if (!previewArtifact) {
    previewArtifact = createTrackedArtifact(notebookId, {
      notebookId,
      type: 'framework_preview_md',
      stage: 'framework',
      title: `${bundle.notebook.name}-framework-preview`,
      content: bundle.markdown,
      format: 'md',
      status: isConfirmed ? 'confirmed' : draftStatus,
      confirmed: isConfirmed,
      previewText: bundle.markdown,
      sourceArtifactIds: [jsonArtifact.id],
      reviewFlags: evidence.reviewFlags,
      validationResults: evidence.validationResults,
      sourceRefs: [...evidence.sourceRefs, { kind: 'artifact', ref: String(jsonArtifact.id), label: 'framework-json' }],
      blockingIssues: evidence.blockingIssues
    });
  }

  const unlockedStages = normalizeUnlockedStages(
    options.unlockLecture ? [...(workflow.unlockedStages || []), 'lecture'] : workflow.unlockedStages
  );
  db.upsertWorkflowState(notebookId, {
    currentStage: options.nextStage || workflow.currentStage || 'framework',
    unlockedStages,
    currentArtifactRefs: {
      frameworkJsonId: jsonArtifact.id,
      frameworkPreviewId: previewArtifact.id
    }
  });
  const nextWorkflow = syncWorkflowStageAvailability(notebookId, {
    preferredStage: options.nextStage || workflow.currentStage || 'framework'
  });
  return {
    ...bundle,
    workflowState: nextWorkflow,
    artifacts: {
      frameworkJson: jsonArtifact,
      frameworkPreview: previewArtifact
    }
  };
}

function applyConfirmedModuleImagesToFramework(notebookId) {
  const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
  const currentFramework = db.getCurrentFramework(notebookId);
  if (!notebook || !currentFramework) {
    throw new Error('Current framework not found');
  }

  const content = currentFramework.content || {};
  const cloned = JSON.parse(JSON.stringify(content || {}));
  const frameworkModules = Array.isArray(cloned.modules) ? cloned.modules : [];
  const modules = db.getModulesByNotebook(notebookId);

  cloned.modules = frameworkModules.map((item, index) => {
    const match = modules.find((m) => {
      const numberHit = Number(m.moduleNumber) > 0 && Number(m.moduleNumber) === Number(item.number || index + 1);
      const nameHit = String(m.name || '').trim() && String(m.name || '').trim() === String(item.name || '').trim();
      return numberHit || nameHit;
    });
    if (!match) return item;
    const structurePath = match?.content?.structureImagePath || '';
    const structureUrl = match?.content?.structureImageUrl || '';
    const structureMeta = match?.content?.structureImageMeta || null;
    if (!structurePath && !structureUrl) return item;
    return {
      ...item,
      structureImagePath: structurePath,
      structureImageUrl: structureUrl,
      structureImageMeta: structureMeta
    };
  });

  return db.createFramework(notebookId, cloned, 'append');
}

function buildFrameworkStageBundle(notebookId) {
  const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
  if (!notebook) {
    throw new Error('Notebook not found');
  }
  const syncResult = syncFrameworkArtifacts(notebookId) || {};
  return {
    notebook,
    workflowState: syncResult.workflowState || ensureWorkflowStateForNotebook(notebookId),
    frameworkRecord: db.getCurrentFramework(notebookId),
    frameworkVersions: db.listFrameworks(notebookId),
    modules: db.getModulesByNotebook(notebookId),
    schedule: db.getTeachingSchedule(notebookId) || [],
    resources: db.listResources({ notebookId }),
    workspace: {
      rootPath: notebook.workspacePath || ensureNotebookWorkspaceDirs(notebook)
    },
    artifacts: db.listArtifacts({ notebookId, stage: 'framework' })
  };
}

function buildV2BaseBundle(notebookId) {
  const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
  if (!notebook) {
    throw new Error('Notebook not found');
  }
  return {
    notebook,
    workflowState: ensureWorkflowStateForNotebook(notebookId),
    frameworkRecord: db.getCurrentFramework(notebookId),
    frameworkVersions: db.listFrameworks(notebookId),
    modules: db.getModulesByNotebook(notebookId),
    schedule: db.getTeachingSchedule(notebookId) || [],
    resources: db.listResources({ notebookId }),
    workspace: {
      rootPath: notebook.workspacePath || ensureNotebookWorkspaceDirs(notebook)
    }
  };
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return asArray(items).filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toValidationResults(stage, quality = {}, source = 'runtime') {
  const errors = asArray(quality.errors).map((message, index) => ({
    id: `${stage}-error-${index + 1}`,
    stage,
    source,
    severity: 'error',
    blocking: true,
    message: String(message || '')
  }));
  const warnings = asArray(quality.warnings).map((message, index) => ({
    id: `${stage}-warning-${index + 1}`,
    stage,
    source,
    severity: 'warning',
    blocking: false,
    message: String(message || '')
  }));
  return [...errors, ...warnings];
}

function toBlockingIssues(validationResults = []) {
  return asArray(validationResults)
    .filter((item) => item && item.blocking && String(item.message || '').trim())
    .map((item) => String(item.message || '').trim());
}

function toReviewFlags({ stage, quality = {}, reasons = [] }) {
  const qualityReasons = quality?.reviewNeeded === true
    ? asArray(quality.reviewReasons).map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  return uniqueBy(
    [...qualityReasons, ...asArray(reasons).map((item) => String(item || '').trim()).filter(Boolean)].map((reason, index) => ({
      id: `${stage}-review-${index + 1}`,
      stage,
      reason
    })),
    (item) => `${item.stage}:${item.reason}`
  );
}

function buildArtifactEvidence({ stage, quality = {}, sourceRefs = [], reviewReasons = [] }) {
  const validationResults = toValidationResults(stage, quality, 'runtime');
  return {
    validationResults,
    blockingIssues: toBlockingIssues(validationResults),
    reviewFlags: toReviewFlags({ stage, quality, reasons: reviewReasons }),
    sourceRefs: uniqueBy(
      asArray(sourceRefs)
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          kind: String(item.kind || 'artifact'),
          ref: String(item.ref || ''),
          label: String(item.label || '')
        }))
        .filter((item) => item.ref),
      (item) => `${item.kind}:${item.ref}`
    )
  };
}

function emitBackendEvent(event = {}) {
  return backendEventBus?.emit({
    scope: event.scope || 'workflow',
    type: event.type || 'unknown',
    stage: event.stage || '',
    notebookId: Number(event.notebookId) || null,
    artifactId: event.artifactId || null,
    payload: event.payload || {}
  });
}

function syncWorkflowStageAvailability(notebookId, options = {}) {
  const workflow = ensureWorkflowStateForNotebook(notebookId) || getDefaultWorkflowState(notebookId);
  const artifacts = db.listArtifacts({ notebookId });
  const unlockedStages = normalizeUnlockedStages(computeUnlockedStages(artifacts));
  const previousUnlocked = normalizeUnlockedStages(workflow.unlockedStages || ['framework']);
  const preferredStage = String(options.preferredStage || workflow.currentStage || 'framework').trim();
  const nextStage = unlockedStages.includes(preferredStage)
    ? preferredStage
    : unlockedStages[unlockedStages.length - 1] || 'framework';
  const nextWorkflow = db.upsertWorkflowState(notebookId, {
    currentStage: nextStage,
    unlockedStages
  });
  db.updateNotebook(notebookId, { currentStage: nextStage });

  unlockedStages
    .filter((stage) => !previousUnlocked.includes(stage))
    .forEach((stage) => {
      emitBackendEvent({
        notebookId,
        scope: 'workflow',
        type: 'stage.unlocked',
        stage,
        payload: {
          unlockedStage: stage,
          previousUnlocked,
          unlockedStages
        }
      });
    });

  return nextWorkflow;
}

function collectFrameworkStructureSlots(modules = []) {
  return asArray(modules).flatMap((moduleItem, index) => {
    const imagePath = String(moduleItem?.content?.structureImagePath || moduleItem?.structureImagePath || '').trim();
    const imageUrl = String(moduleItem?.content?.structureImageUrl || moduleItem?.structureImageUrl || '').trim();
    if (!imagePath && !imageUrl) return [];
    return [{
      id: String(moduleItem?.id || `framework-module-${index + 1}`),
      title: String(moduleItem?.name || `模块${index + 1}`),
      imagePath,
      imageUrl,
      insertAfterLineIndex: -1
    }];
  });
}

function buildFrameworkPublicationBundle(notebookId, options = {}) {
  const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
  if (!notebook) {
    throw new Error('Notebook not found');
  }
  const framework = db.getCurrentFramework(notebookId);
  if (!framework) {
    throw new Error('Current framework not found');
  }
  const modules = db.getModulesByNotebook(notebookId);
  const schedule = db.getTeachingSchedule(notebookId);
  const workflow = ensureWorkflowStateForNotebook(notebookId);
  const structureSlots = asArray(options.structureSlots).length
    ? asArray(options.structureSlots)
    : collectFrameworkStructureSlots(modules);
  const frameworkArtifactIds = [
    workflow?.currentArtifactRefs?.frameworkJsonId,
    workflow?.currentArtifactRefs?.frameworkPreviewId
  ].filter(Boolean);
  const infographicArtifacts = db.listArtifacts({ notebookId, type: 'framework_infographic', stage: 'framework' })
    .filter((item) => item.confirmed);
  return {
    notebook,
    framework,
    modules,
    schedule,
    workflow,
    ...buildFrameworkPublicationContract({
      notebookId,
      notebook,
      framework,
      modules,
      schedule,
      structureSlots,
      discussionDraft: options.discussionDraft,
      frameworkArtifactIds,
      infographicArtifacts,
      buildFrameworkMarkdown,
      mergeDiscussionWithInfographics,
      resolveDiscussionMarkdown
    })
  };
}

function buildLecturePublicationBundle(notebookId, options = {}) {
  const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
  if (!notebook) {
    throw new Error('Notebook not found');
  }
  const workflow = ensureWorkflowStateForNotebook(notebookId);
  const lectureFinalArtifact = resolveArtifactByRefOrLatest(notebookId, 'lectureFinalId', 'lecture_final', 'lecture');
  const lectureDraftsArtifact = resolveArtifactByRefOrLatest(notebookId, 'lectureDraftsId', 'lecture_drafts', 'lecture');
  return {
    notebook,
    workflow,
    lectureFinalArtifact,
    lectureDraftsArtifact,
    ...buildLecturePublicationContract({
      notebookId,
      notebook,
      lectureFinalArtifact,
      lectureDraftsArtifact,
      lectureTitle: options.lectureTitle,
      lectureScript: options.lectureScript,
      mergeReport: options.mergeReport
    })
  };
}

function buildPptPublicationBundle(notebookId, options = {}) {
  const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
  if (!notebook) {
    throw new Error('Notebook not found');
  }
  const workflow = ensureWorkflowStateForNotebook(notebookId);
  const modules = db.getModulesByNotebook(notebookId);
  const framework = db.getCurrentFramework(notebookId);
  const outlineArtifact = resolveArtifactByRefOrLatest(notebookId, 'pptOutlineId', 'ppt_outline', 'ppt');
  const outlineContent = asPlainObject(outlineArtifact?.content);
  const pageImageArtifacts = db.listArtifacts({ notebookId, type: 'ppt_page_image', stage: 'ppt' })
    .filter((item) => item.confirmed || item.status === 'generated');
  return {
    notebook,
    workflow,
    modules,
    framework,
    outlineArtifact,
    ...buildPptPublicationContract({
      notebookId,
      outlineArtifact,
      outlineContent,
      pptPages: options.pptPages,
      pptOutline: options.pptOutline,
      templateKey: options.templateKey,
      lectureScript: options.lectureScript,
      templateBackground: options.templateBackground,
      pageImageArtifacts
    })
  };
}

function resolveArtifactByRefOrLatest(notebookId, refKey, type, stage) {
  const workflow = ensureWorkflowStateForNotebook(notebookId);
  const refId = workflow?.currentArtifactRefs?.[refKey];
  if (refId) {
    const byRef = db.listArtifacts({ notebookId, stage }).find((item) => Number(item.id) === Number(refId));
    if (byRef) return byRef;
  }
  return db.getLatestArtifact(notebookId, type, stage);
}

function upsertStageArtifact(notebookId, options = {}) {
  const workflow = ensureWorkflowStateForNotebook(notebookId);
  const refKey = String(options.refKey || '').trim();
  const evidence = buildArtifactEvidence({
    stage: options.stage || 'framework',
    quality: options.quality || {},
    sourceRefs: options.sourceRefs || [],
    reviewReasons: options.reviewReasons || []
  });
  const patch = {
    notebookId,
    type: options.type || 'unknown',
    stage: options.stage || 'framework',
    title: options.title || options.type || '未命名产物',
    content: options.content ?? null,
    format: options.format || 'json',
    status: options.status || 'generated',
    confirmed: Boolean(options.confirmed),
    storagePath: options.storagePath || null,
    previewText: options.previewText || null,
    parentArtifactId: options.parentArtifactId || null,
    sourceArtifactIds: Array.isArray(options.sourceArtifactIds) ? options.sourceArtifactIds : [],
    diffSummary: options.diffSummary || null,
    reviewFlags: Array.isArray(options.reviewFlags) ? options.reviewFlags : evidence.reviewFlags,
    validationResults: Array.isArray(options.validationResults) ? options.validationResults : evidence.validationResults,
    sourceRefs: Array.isArray(options.sourceRefs) ? options.sourceRefs : evidence.sourceRefs,
    blockingIssues: Array.isArray(options.blockingIssues) ? options.blockingIssues : evidence.blockingIssues,
    lifecycle: options.lifecycle && typeof options.lifecycle === 'object'
      ? options.lifecycle
      : {
          generatedAt: new Date().toISOString(),
          confirmedAt: options.confirmed ? new Date().toISOString() : null
        }
  };

  let artifact = null;
  const refId = refKey ? workflow?.currentArtifactRefs?.[refKey] : null;
  if (refId) {
    try {
      artifact = updateTrackedArtifact(refId, patch);
    } catch {
      artifact = null;
    }
  }
  if (!artifact) {
    artifact = createTrackedArtifact(notebookId, patch);
  }
  if (refKey) {
    db.upsertWorkflowState(notebookId, {
      currentArtifactRefs: {
        [refKey]: artifact.id
      }
    });
  }
  return artifact;
}

function createTrackedArtifact(notebookId, patch = {}) {
  return artifactTracker
    ? artifactTracker.create(notebookId, patch)
    : db.createArtifact({ notebookId, ...patch });
}

function updateTrackedArtifact(artifactId, patch = {}) {
  return artifactTracker
    ? artifactTracker.update(artifactId, patch)
    : db.updateArtifact(artifactId, patch);
}

function summarizeLectureDrafts(drafts) {
  const safe = asPlainObject(drafts);
  return ['a', 'b', 'c']
    .map((key) => {
      const text = String(safe[key] || '').replace(/\s+/g, ' ').trim();
      return `${key.toUpperCase()}:${text.slice(0, 32) || '空'}`;
    })
    .join(' ');
}

function normalizeLectureStagePayload(payload = {}) {
  const drafts = asPlainObject(payload.drafts);
  const selectedDraft = String(payload.selectedDraft || 'a').toLowerCase();
  return {
    instruction: String(payload.instruction || '').trim(),
    drafts: {
      a: String(drafts.a || ''),
      b: String(drafts.b || ''),
      c: String(drafts.c || '')
    },
    selectedDraft: ['a', 'b', 'c'].includes(selectedDraft) ? selectedDraft : 'a',
    finalScript: String(payload.finalScript || '')
  };
}

function buildLectureStageBundle(notebookId) {
  const base = buildV2BaseBundle(notebookId);
  const draftsArtifact = resolveArtifactByRefOrLatest(notebookId, 'lectureDraftsId', 'lecture_drafts', 'lecture');
  const finalArtifact = resolveArtifactByRefOrLatest(notebookId, 'lectureFinalId', 'lecture_final', 'lecture');
  const draftsContent = asPlainObject(draftsArtifact?.content);
  const finalContent = asPlainObject(finalArtifact?.content);
  const lectureData = {
    instruction: String(finalContent.instruction || draftsContent.instruction || ''),
    drafts: {
      a: String(asPlainObject(draftsContent.drafts).a || ''),
      b: String(asPlainObject(draftsContent.drafts).b || ''),
      c: String(asPlainObject(draftsContent.drafts).c || '')
    },
    selectedDraft: String(finalContent.selectedDraft || draftsContent.selectedDraft || 'a'),
    finalScript: String(finalContent.finalScript || ''),
    artifacts: db.listArtifacts({ notebookId, stage: 'lecture' })
  };
  return {
    ...base,
    artifacts: lectureData.artifacts,
    lectureData
  };
}

function normalizePptPage(page = {}, index = 0) {
  return {
    id: String(page.id || `ppt-page-${index + 1}`),
    pageKey: String(page.pageKey || page.id || `ppt-page-${index + 1}`),
    pageNumber: Number(page.pageNumber) || index + 1,
    pageType: String(page.pageType || '内容页'),
    title: String(page.title || `第${index + 1}页`),
    subtitle: String(page.subtitle || ''),
    summary: String(page.summary || ''),
    narrativeGoal: String(page.narrativeGoal || ''),
    keyContent: page.keyContent || '',
    visual: String(page.visual || ''),
    layout: String(page.layout || ''),
    moduleId: String(page.moduleId || ''),
    needImage: typeof page.needImage === 'boolean' ? page.needImage : true,
    imagePrompt: String(page.imagePrompt || ''),
    imagePath: String(page.imagePath || ''),
    imageUrl: String(page.imageUrl || ''),
    imageModel: String(page.imageModel || PPT_FIXED_IMAGE_MODEL),
    imageAspect: String(page.imageAspect || '16:9'),
    imageQuality: String(page.imageQuality || 'low'),
    referenceImagePath: String(page.referenceImagePath || ''),
    referenceImageUrl: String(page.referenceImageUrl || ''),
    referenceImageName: String(page.referenceImageName || '')
  };
}

function normalizePptStagePayload(payload = {}) {
  const pptPages = Array.isArray(payload.pptPages)
    ? payload.pptPages.map((item, index) => normalizePptPage(item, index))
    : [];
  const selectedPageId = String(payload.selectedPageId || pptPages[0]?.id || '');
  return {
    templateKey: PPT_TEMPLATE_PRESETS[payload.templateKey] ? String(payload.templateKey) : 'pro_minimalist',
    pptOutline: String(payload.pptOutline || ''),
    pptPages,
    selectedPageId
  };
}

function findPptPageImageArtifact(notebookId, pageId) {
  return db.listArtifacts({ notebookId, type: 'ppt_page_image', stage: 'ppt' }).find((item) => {
    const content = asPlainObject(item.content);
    return String(content.pageId || '') === String(pageId || '');
  }) || null;
}

function upsertPptPageImageArtifacts(notebookId, pptPages, options = {}) {
  const sourceArtifactIds = Array.isArray(options.sourceArtifactIds) ? options.sourceArtifactIds : [];
  return (Array.isArray(pptPages) ? pptPages : [])
    .filter((page) => String(page.imagePath || page.imageUrl || '').trim())
    .map((page) => {
      const patch = {
        notebookId,
        type: 'ppt_page_image',
        stage: 'ppt',
        title: `PPT页图-第${page.pageNumber || 0}页-${page.title || '未命名页面'}`,
        content: {
          pageId: page.id,
          pageNumber: page.pageNumber,
          title: page.title || '',
          summary: page.summary || '',
          imagePrompt: page.imagePrompt || '',
          imagePath: page.imagePath || '',
          imageUrl: page.imageUrl || '',
          imageModel: page.imageModel || PPT_FIXED_IMAGE_MODEL,
          taskId: getPptPageTaskId(notebookId, page.id)
        },
        format: 'json',
        status: options.status || 'generated',
        confirmed: Boolean(options.confirmed),
        storagePath: page.imagePath || null,
        previewText: page.title || '',
        parentArtifactId: options.parentArtifactId || null,
        sourceArtifactIds
      };
      const existing = findPptPageImageArtifact(notebookId, page.id);
      if (existing?.id) {
        return updateTrackedArtifact(existing.id, patch);
      }
      return createTrackedArtifact(notebookId, patch);
    });
}

function buildPptStageBundle(notebookId) {
  const base = buildV2BaseBundle(notebookId);
  const outlineArtifact = resolveArtifactByRefOrLatest(notebookId, 'pptOutlineId', 'ppt_outline', 'ppt');
  const outlineContent = asPlainObject(outlineArtifact?.content);
  const pptPages = Array.isArray(outlineContent.pptPages)
    ? outlineContent.pptPages.map((item, index) => normalizePptPage(item, index))
    : [];
  const pptData = {
    templateKey: String(outlineContent.templateKey || 'pro_minimalist'),
    pptOutline: String(outlineContent.pptOutline || ''),
    pptPages,
    selectedPageId: String(outlineContent.selectedPageId || pptPages[0]?.id || ''),
    artifacts: db.listArtifacts({ notebookId, stage: 'ppt' })
  };
  return {
    ...base,
    artifacts: pptData.artifacts,
    pptData
  };
}

function normalizeVideoStagePayload(payload = {}) {
  return {
    promptText: String(payload.promptText || ''),
    style: String(payload.style || '专业稳重'),
    engine: String(payload.engine || 'jimeng') === 'pexo' ? 'pexo' : 'jimeng'
  };
}

function buildVideoStageBundle(notebookId) {
  const base = buildV2BaseBundle(notebookId);
  const promptArtifact = resolveArtifactByRefOrLatest(notebookId, 'videoPromptId', 'video_prompt', 'video');
  const promptContent = asPlainObject(promptArtifact?.content);
  const videoData = {
    promptText: String(promptContent.promptText || ''),
    style: String(promptContent.style || '专业稳重'),
    engine: String(promptContent.engine || 'jimeng'),
    artifacts: db.listArtifacts({ notebookId, stage: 'video' })
  };
  return {
    ...base,
    artifacts: videoData.artifacts,
    videoData
  };
}

function createCourseAiClient(payload = {}) {
  const config = resolveProviderConfig({ payload, db });
  return createAiClientByConfig(config);
}

function patchCourseProject(notebookId, patch = {}) {
  if (!Number.isFinite(Number(notebookId)) || Number(notebookId) <= 0) return null;
  const notebook = db.getNotebookById(Number(notebookId));
  if (!notebook) return null;
  const current = notebook.courseProject && typeof notebook.courseProject === 'object'
    ? notebook.courseProject
    : {};
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  db.updateNotebook(Number(notebookId), { courseProject: next });
  return next;
}

function markCourseProjectDirty(notebookId, reason = '') {
  return patchCourseProject(notebookId, {
    dirty: true,
    dirtyReason: reason || 'changed',
    dirtyAt: new Date().toISOString()
  });
}

const RESOURCE_EXT_TYPE = {
  '.md': 'text',
  '.txt': 'text',
  '.doc': 'doc',
  '.docx': 'doc',
  '.pdf': 'pdf',
  '.ppt': 'ppt',
  '.pptx': 'ppt',
  '.xls': 'sheet',
  '.xlsx': 'sheet',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image'
};

const IMAGE_MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp'
};

const inferResourceType = (filename) => {
  const ext = path.extname(filename || '').toLowerCase();
  return RESOURCE_EXT_TYPE[ext] || 'other';
};

const toPdfImageSrc = (srcRaw) => {
  const value = String(srcRaw || '').trim();
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) {
    return value;
  }

  let localPath = value;
  if (value.startsWith('file:///')) {
    localPath = decodeURIComponent(value.replace(/^file:\/\/\//, ''));
  }
  localPath = localPath.replace(/\//g, path.sep);

  if (!fs.existsSync(localPath)) {
    return value.startsWith('file:') ? value : `file:///${value.replace(/\\/g, '/')}`;
  }

  const ext = path.extname(localPath).toLowerCase();
  const mime = IMAGE_MIME_MAP[ext] || 'application/octet-stream';
  const base64 = fs.readFileSync(localPath).toString('base64');
  return `data:${mime};base64,${base64}`;
};

const markdownToHtml = (markdownText) => {
  const escaped = String(markdownText || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const html = escaped
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
      if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
      if (/^!\[.*\]\(.+\)$/.test(line)) {
        const match = line.match(/^!\[(.*)\]\((.+)\)$/);
        const alt = match?.[1] || 'image';
        const srcRaw = match?.[2] || '';
        const src = toPdfImageSrc(srcRaw);
        return `<p><img alt="${alt}" src="${src}" style="max-width:100%;border:1px solid #e5e7eb;border-radius:8px;" /></p>`;
      }
      if (!line.trim()) return '<p></p>';
      return `<p>${line}</p>`;
    })
    .join('\n')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g, '');
  return `<!doctype html><html><head><meta charset="utf-8"/><style>body{font-family:"Microsoft YaHei",sans-serif;padding:24px;color:#111827}h1,h2,h3{color:#111827}p,li{line-height:1.7;font-size:14px}</style></head><body>${html}</body></html>`;
};

const withTimeout = (promise, ms, label) => {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

const renderHtmlToPngBuffer = async (html, width = 1000, height = 1400) => {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: false
    }
  });

  try {
    await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
    const contentSize = await withTimeout(win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const waitFonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        waitFonts.then(() => {
          setTimeout(() => resolve({
            width: Math.ceil(document.documentElement.scrollWidth || document.body.scrollWidth || ${width}),
            height: Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || ${height})
          }), 300);
        });
      });
    `), 15000, 'Infocard content size evaluation');
    const nextWidth = Math.max(width, Number(contentSize?.width) || width);
    const nextHeight = Math.max(height, Number(contentSize?.height) || height);
    if (nextWidth !== width || nextHeight !== height) {
      win.setContentSize(nextWidth, nextHeight);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const image = await withTimeout(win.webContents.capturePage(), 20000, 'Infocard capture');
    return image.toPNG();
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
};

const normalizeModuleInput = (moduleData) => {
  const payload = {
    moduleNumber: Number(moduleData?.moduleNumber) || 1,
    name: String(moduleData?.name || '').trim(),
    hours: Number(moduleData?.hours) || 0,
    description: String(moduleData?.description || '').trim(),
    knowledgePoints: Array.isArray(moduleData?.knowledgePoints)
      ? moduleData.knowledgePoints.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    teachingMethods: String(moduleData?.teachingMethods || '').trim(),
    isCore: Boolean(moduleData?.isCore)
  };
  if (!payload.name) {
    throw new Error('妯″潡鍚嶇О涓嶈兘涓虹┖');
  }
  if (payload.moduleNumber <= 0) {
    throw new Error('妯″潡搴忓彿蹇呴』澶т簬 0');
  }
  if (payload.hours < 0) {
    throw new Error('Module hours cannot be negative');
  }
  return payload;
};

const normalizeScheduleInput = (schedule) => {
  const list = Array.isArray(schedule) ? schedule : [];
  return list.map((item, index) => {
    const week = Number(item?.week) || index + 1;
    const topic = String(item?.topic || '').trim();
    const hours = Number(item?.hours) || 0;
    const methods = String(item?.methods || '').trim();
    const assignment = String(item?.assignment || '').trim();
    if (!topic) {
      throw new Error(`Schedule item ${index + 1} is missing topic`);
    }
    if (hours <= 0) {
      throw new Error(`绗?${index + 1} 鏉¤繘搴﹀鏃跺繀椤诲ぇ浜?0`);
    }
    return { week, topic, hours, methods, assignment };
  });
};
function createWindow() {
  mainWindow = new BrowserWindow({
    title: '刘老师课程助手 v2版',
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    icon: path.join(__dirname, '../../resources/icons/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js')
    }
  });
  const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL).catch(() => {
      const localRenderer = path.join(__dirname, '../../dist/renderer/index.html');
      mainWindow.loadFile(localRenderer).catch(() => {});
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}
app.whenReady().then(() => {
  protocol.handle('local-img', async (request) => {
    try {
      const urlObj = new URL(String(request.url || ''));
      let rawPath = '';

      if (/^[A-Za-z]$/.test(urlObj.hostname || '')) {
        // Format: local-img://c/Users/...  ->  C:/Users/...
        rawPath = `${urlObj.hostname.toUpperCase()}:${decodeURIComponent(urlObj.pathname || '')}`;
      } else {
        rawPath = decodeURIComponent(
          String(request.url || '').replace(/^local-img:\/\/\/?/i, '')
        );
      }

      if (/^[A-Za-z]\//.test(rawPath)) {
        // Fallback for c/Users/... (missing colon)
        rawPath = `${rawPath.slice(0, 1).toUpperCase()}:${rawPath.slice(1)}`;
      }
      if (/^\/[A-Za-z]:\//.test(rawPath)) rawPath = rawPath.slice(1);

      const filePath = rawPath.replace(/\//g, path.sep);
      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('Not Found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      return new Response(String(error?.message || 'Bad Request'), { status: 400 });
    }
  });
  db = new DatabaseManager();
  backendEventBus = createBackendEventBus({ db });
  artifactTracker = createArtifactTracker({
    db,
    emitEvent: emitBackendEvent
  });
  exportRuntime = createExportRuntime({
    emitEvent: emitBackendEvent
  });
  promptTemplateService = new PromptTemplateService(db);
  imageVersionService = new ImageVersionService(db);
  promptAdvisorService = new PromptAdvisorService();
  imageGeneratorService = new ImageGeneratorService(db, app);
  infographicCardService = new InfographicCardService(db, app);
  videoGeneratorService = new VideoGeneratorService(db, app);
  v2Runtime = createV2Runtime({
    db,
    imageGeneratorService,
    imageVersionService,
    helpers: {
      ensureDb,
      ensureNotebookWorkspaceState,
      normalizeFrameworkContent,
      validateFrameworkContent,
      normalizeModuleInput,
      normalizeScheduleInput,
      patchCourseProject,
      syncFrameworkArtifacts,
      buildFrameworkStageBundle,
      buildLectureStageBundle,
      buildPptStageBundle,
      buildVideoStageBundle,
      normalizeLectureStagePayload,
      upsertStageArtifact,
      normalizePptStagePayload,
      upsertPptPageImageArtifacts,
      resolveArtifactByRefOrLatest,
      normalizePptPage,
      findPptPageImageArtifact,
      applyConfirmedModuleImagesToFramework,
      normalizeUnlockedStages,
      ensureWorkflowStateForNotebook,
      normalizeVideoStagePayload,
      syncWorkflowStageAvailability,
      emitBackendEvent,
      createTrackedArtifact,
      updateTrackedArtifact
    },
    constants: {
      PPT_TEMPLATE_PRESETS,
      PPT_FIXED_IMAGE_MODEL,
      ensurePptImagePromptForPage,
      buildPptLockedPrompt,
      getPptPageTaskId
    }
  });
  logInfo('Database initialized');
  logInfo('Electron main process started');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
// ─── IPC Handler 注册（Phase-5A 逐步迁移）────────────────────────────────────
// getDeps：惰性求值，在 handler 调用时读取（此时 app.whenReady 已初始化 db）
const getDeps = () => ({
  db,
  ensureNotebookWorkspaceState,
  ensureNotebookWorkspaceDirs,
  ensureWorkflowStateForNotebook,
  normalizeUnlockedStages,
  syncWorkflowStageAvailability,
  emitBackendEvent,
  createTrackedArtifact,
  updateTrackedArtifact,
  resolveArtifactByRefOrLatest,
  normalizeModuleInput,
  patchCourseProject,
  v2Runtime,
  backendEventBus,
  // export group
  exportRuntime,
  buildFrameworkPublicationBundle,
  buildLecturePublicationBundle,
  buildPptPublicationBundle,
  mainWindow,
  // resource group
  markCourseProjectDirty,
  // media group
  infographicCardService,
  imageVersionService,
  imageGeneratorService,
  videoGeneratorService,
  // prompt group
  promptTemplateService,
  promptAdvisorService
});
const { registerAll } = require('./ipc/_registry');
registerAll(ipcMain, getDeps);
// ─────────────────────────────────────────────────────────────────────────────
// ai:generateFramework → 已迁移至 src/main/ipc/framework.handlers.js

// course:generateOutlines / generateScenes → 已迁移至 src/main/ipc/course.handlers.js

// course:runPipeline / rebuildSingleFlow → 已迁移至 src/main/ipc/course.handlers.js

// script:generateABC / generateFormal / quality:auditStyle
// → 已迁移至 src/main/ipc/lecture.handlers.js

// course:saveDiscussionDraft / saveProjectPatch → 已迁移至 src/main/ipc/course.handlers.js

// framework:list / getCurrent / create / update / setCurrent
// → 已迁移至 src/main/ipc/framework.handlers.js

// schedule:get/save → 已迁移至 src/main/ipc/system.handlers.js
// settings:saveApiKey/getApiKey → 已迁移至 src/main/ipc/system.handlers.js
// util:openExternalUrl / workspace:getNotebookRoot / openNotebookRoot → src/main/ipc/system.handlers.js
// prompt:* / infocard:* → 已迁移至 src/main/ipc/prompt.handlers.js

// v2:generateFrameworkInfographic / images:* / videos:generateT2V → 已迁移至 src/main/ipc/media.handlers.js
