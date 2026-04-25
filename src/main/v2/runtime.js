const { createTaskRuntime } = require('./task-runtime');
const {
  validateLectureStage,
  validatePptStage,
  validateVideoStage
} = require('./quality');

function createV2Runtime(deps = {}) {
  const {
    db,
    imageGeneratorService,
    imageVersionService,
    helpers = {},
    constants = {}
  } = deps;
  const taskRuntime = createTaskRuntime({ db, emitEvent: helpers.emitBackendEvent });
  const {
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
  } = helpers;
  const {
    PPT_TEMPLATE_PRESETS,
    PPT_FIXED_IMAGE_MODEL,
    ensurePptImagePromptForPage,
    buildPptLockedPrompt,
    getPptPageTaskId
  } = constants;

  function getFrameworkQuality(bundle = {}) {
    const validation = validateFrameworkContent(bundle.frameworkRecord?.content || {}, bundle.notebook || {});
    return {
      stage: 'framework',
      valid: validation.valid,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
      reviewNeeded: Boolean(validation.reviewNeeded),
      reviewReasons: validation.reviewReasons || []
    };
  }

  function attachRuntimeMeta(bundle, notebookId, stage, quality = null) {
    return {
      ...bundle,
      quality,
      operations: taskRuntime.listStageOperations({ notebookId, stage, limit: 20 })
    };
  }

  function getErrorMessage(error, fallback = '未知错误') {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
    if (typeof error.detail === 'string' && error.detail.trim()) return error.detail.trim();
    if (Array.isArray(error.errors) && error.errors.length) {
      return error.errors.map((item) => getErrorMessage(item, '')).filter(Boolean).join('；') || fallback;
    }
    try {
      const serialized = JSON.stringify(error);
      return serialized && serialized !== '{}' ? serialized : fallback;
    } catch (_) {
      return fallback;
    }
  }

  async function respond(handler) {
    try {
      ensureDb();
      return await handler();
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  function unwrapOperationResult(result, operation) {
    const root = result && typeof result === 'object' ? result : {};
    const payload = root.value && typeof root.value === 'object' ? { ...root.value } : { ...root };
    if (!Object.prototype.hasOwnProperty.call(payload, 'success')) {
      payload.success = true;
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'warnings') && Array.isArray(root.warnings)) {
      payload.warnings = root.warnings;
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'metadata') && root.metadata && typeof root.metadata === 'object') {
      payload.metadata = root.metadata;
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'output') && root.output && typeof root.output === 'object') {
      payload.output = root.output;
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'outputArtifactIds') && Array.isArray(root.outputArtifactIds)) {
      payload.outputArtifactIds = root.outputArtifactIds;
    }
    return {
      ...payload,
      operation
    };
  }

  const api = {
    getFrameworkStageData(notebookId) {
      return respond(async () => {
        const safeNotebookId = Number(notebookId);
        const bundle = buildFrameworkStageBundle(safeNotebookId);
        return {
          success: true,
          data: attachRuntimeMeta(bundle, safeNotebookId, 'framework', getFrameworkQuality(bundle))
        };
      });
    },

    saveFrameworkStage(payload = {}) {
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'framework',
          action: 'save',
          summary: '保存教学框架阶段',
          input: {
            moduleCount: Array.isArray(payload.modules) ? payload.modules.length : 0,
            scheduleCount: Array.isArray(payload.schedule) ? payload.schedule.length : 0
          }
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          const normalizedFramework = normalizeFrameworkContent(payload.framework || {}, notebook);
          const validation = validateFrameworkContent(normalizedFramework, notebook);
          if (!validation.valid) {
            throw new Error(validation.errors.join('; '));
          }

          const current = db.getCurrentFramework(notebookId);
          if (current?.id) db.updateFramework(current.id, normalizedFramework);
          else db.createFramework(notebookId, normalizedFramework, 'append');

          if (Array.isArray(payload.modules)) {
            db.replaceModules(notebookId, payload.modules.map((item) => normalizeModuleInput(item)));
          }
          if (Array.isArray(payload.schedule)) {
            db.saveTeachingSchedule(notebookId, normalizeScheduleInput(payload.schedule));
          }

          patchCourseProject(notebookId, {
            framework: normalizedFramework,
            dirty: true,
            dirtyReason: 'v2-framework-saved',
            dirtyAt: new Date().toISOString()
          });
          const quality = {
            stage: 'framework',
            valid: validation.valid,
            errors: validation.errors || [],
            warnings: validation.warnings || [],
            reviewNeeded: Boolean(validation.reviewNeeded),
            reviewReasons: validation.reviewReasons || []
          };
          syncFrameworkArtifacts(notebookId, {
            quality,
            reviewReasons: quality.reviewReasons
          });
          return {
            output: { workflowStage: 'framework', valid: validation.valid },
            warnings: validation.warnings || [],
            metadata: { quality },
            value: {
              success: true,
              data: attachRuntimeMeta(buildFrameworkStageBundle(notebookId), notebookId, 'framework', quality),
              warnings: validation.warnings || [],
              quality
            }
          };
        });
        return unwrapOperationResult(value, operation);
      });
    },

    confirmFrameworkStage(payload = {}) {
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'framework',
          action: 'confirm',
          summary: '确认教学框架阶段'
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          let quality = { stage: 'framework', valid: true, errors: [], warnings: [] };

          if (payload.framework || payload.modules || payload.schedule) {
            const normalizedFramework = normalizeFrameworkContent(
              payload.framework || (db.getCurrentFramework(notebookId)?.content || {}),
              notebook
            );
            const validation = validateFrameworkContent(normalizedFramework, notebook);
            quality = {
              stage: 'framework',
              valid: validation.valid,
              errors: validation.errors || [],
              warnings: validation.warnings || [],
              reviewNeeded: Boolean(validation.reviewNeeded),
              reviewReasons: validation.reviewReasons || []
            };
            if (!validation.valid) throw new Error(validation.errors.join('; '));
            const current = db.getCurrentFramework(notebookId);
            if (current?.id) db.updateFramework(current.id, normalizedFramework);
            else db.createFramework(notebookId, normalizedFramework, 'append');
            if (Array.isArray(payload.modules)) {
              db.replaceModules(notebookId, payload.modules.map((item) => normalizeModuleInput(item)));
            }
            if (Array.isArray(payload.schedule)) {
              db.saveTeachingSchedule(notebookId, normalizeScheduleInput(payload.schedule));
            }
          }

          const syncResult = syncFrameworkArtifacts(notebookId, {
            confirmed: true,
            unlockLecture: true,
            nextStage: 'lecture',
            quality,
            reviewReasons: quality.reviewReasons
          });
          patchCourseProject(notebookId, {
            dirty: false,
            dirtyReason: 'framework-confirmed',
            dirtyAt: new Date().toISOString()
          });

          return {
            output: { unlockedStage: 'lecture' },
            warnings: quality.warnings || [],
            outputArtifactIds: Object.values(syncResult?.artifacts || {}).map((item) => item?.id).filter(Boolean),
            metadata: { quality },
            value: {
              success: true,
              data: attachRuntimeMeta(buildFrameworkStageBundle(notebookId), notebookId, 'framework', quality),
              artifacts: syncResult?.artifacts || {},
              quality
            }
          };
        });
        return unwrapOperationResult(value, operation);
      });
    },

    confirmFrameworkInfographic(payload = {}) {
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'framework',
          action: 'confirm-infographic',
          summary: '确认模块信息图'
        }, async () => {
          const moduleId = Number(payload.moduleId);
          const imageData = payload.imageData || {};
          const updatedModule = db.setModuleStructureImage(moduleId, imageData);
          const workflow = ensureWorkflowStateForNotebook(notebookId);
          const sourceArtifactIds = [
            workflow?.currentArtifactRefs?.frameworkJsonId,
            workflow?.currentArtifactRefs?.frameworkPreviewId
          ].filter(Boolean);
          const infographicPatch = {
            type: 'framework_infographic',
            stage: 'framework',
            title: `${payload.topic || updatedModule?.name || '模块'}-信息图`,
            content: {
              moduleId,
              moduleName: updatedModule?.name || '',
              prompt: imageData.prompt || '',
              htmlPath: imageData.htmlPath || imageData.workspaceHtmlPath || '',
              imagePath: imageData.workspaceImagePath || imageData.imagePath || '',
              resourceId: imageData.resourceId || null
            },
            format: 'png',
            status: 'confirmed',
            confirmed: true,
            storagePath: imageData.workspaceImagePath || imageData.imagePath || null,
            previewText: payload.topic || updatedModule?.name || '',
            sourceArtifactIds,
            sourceRefs: [
              { kind: 'artifact', ref: String(sourceArtifactIds[0] || ''), label: 'framework-source' },
              { kind: 'resource', ref: String(imageData.resourceId || ''), label: 'framework-infographic-resource' }
            ].filter((item) => item.ref),
            validationResults: [],
            reviewFlags: [],
            blockingIssues: []
          };
          const artifact = createTrackedArtifact(notebookId, infographicPatch);
          applyConfirmedModuleImagesToFramework(notebookId);
          emitBackendEvent?.({
            notebookId,
            scope: 'artifact',
            type: 'framework.infographic.confirmed',
            stage: 'framework',
            artifactId: artifact?.id || null,
            payload: {
              artifactType: 'framework_infographic',
              moduleId
            }
          });
          return {
            output: { moduleId, infographicConfirmed: true },
            outputArtifactIds: artifact?.id ? [artifact.id] : [],
            value: {
              success: true,
              data: (() => {
                const bundle = buildFrameworkStageBundle(notebookId);
                return attachRuntimeMeta(bundle, notebookId, 'framework', getFrameworkQuality(bundle));
              })()
            }
          };
        });
        return unwrapOperationResult(value, operation);
      });
    },

    getLectureStageData(notebookId) {
      return respond(async () => {
        const safeNotebookId = Number(notebookId);
        const bundle = buildLectureStageBundle(safeNotebookId);
        const quality = validateLectureStage(bundle.lectureData, { requireFinal: false, totalHours: Number(bundle.notebook?.totalHours) || 1 });
        return {
          success: true,
          data: attachRuntimeMeta(bundle, safeNotebookId, 'lecture', quality)
        };
      });
    },

    saveLectureStage(payload = {}) {
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'lecture',
          action: 'save',
          summary: '保存讲稿阶段'
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          const normalized = normalizeLectureStagePayload(payload);
          const quality = validateLectureStage(normalized, { requireFinal: false, totalHours: Number(notebook.totalHours) || 1 });
          const draftsPreview = ['a', 'b', 'c']
            .map((key) => `${key}:${String(normalized.drafts[key] || '').slice(0, 16)}`)
            .join(' ');

          const draftsArtifact = upsertStageArtifact(notebookId, {
            refKey: 'lectureDraftsId',
            type: 'lecture_drafts',
            stage: 'lecture',
            title: `${notebook.name || '课程'}-讲稿A/B/C`,
            content: {
              instruction: normalized.instruction,
              drafts: normalized.drafts,
              selectedDraft: normalized.selectedDraft
            },
            format: 'json',
            status: quality.reviewNeeded ? 'review_needed' : (db.getLatestArtifact(notebookId, 'lecture_drafts', 'lecture') ? 'edited' : 'generated'),
            confirmed: false,
            previewText: draftsPreview,
            quality,
            reviewReasons: quality.reviewReasons
          });
          const finalArtifact = upsertStageArtifact(notebookId, {
            refKey: 'lectureFinalId',
            type: 'lecture_final',
            stage: 'lecture',
            title: `${notebook.name || '课程'}-正式讲稿`,
            content: {
              instruction: normalized.instruction,
              selectedDraft: normalized.selectedDraft,
              finalScript: normalized.finalScript
            },
            format: 'json',
            status: quality.reviewNeeded ? 'review_needed' : (db.getLatestArtifact(notebookId, 'lecture_final', 'lecture') ? 'edited' : 'generated'),
            confirmed: false,
            previewText: String(normalized.finalScript || '').slice(0, 120),
            sourceArtifactIds: draftsArtifact?.id ? [draftsArtifact.id] : [],
            quality,
            reviewReasons: quality.reviewReasons,
            sourceRefs: draftsArtifact?.id ? [{ kind: 'artifact', ref: String(draftsArtifact.id), label: 'lecture-drafts' }] : []
          });

          patchCourseProject(notebookId, {
            dirty: true,
            dirtyReason: 'v2-lecture-saved',
            dirtyAt: new Date().toISOString()
          });

          return {
            output: { hasFinalScript: Boolean(String(normalized.finalScript || '').trim()) },
            warnings: quality.warnings,
            outputArtifactIds: [draftsArtifact?.id, finalArtifact?.id].filter(Boolean),
            metadata: { quality },
            value: {
              success: true,
              data: attachRuntimeMeta(buildLectureStageBundle(notebookId), notebookId, 'lecture', quality),
              artifacts: { lectureDrafts: draftsArtifact, lectureFinal: finalArtifact },
              quality
            }
          };
        });
        return unwrapOperationResult(value, operation);
      });
    },

    confirmLectureStage(payload = {}) {
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'lecture',
          action: 'confirm',
          summary: '确认讲稿阶段'
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          const normalized = normalizeLectureStagePayload(payload);
          const quality = validateLectureStage(normalized, { requireFinal: true, totalHours: Number(notebook.totalHours) || 1 });
          if (!quality.valid) throw new Error(quality.errors.join('; '));
          const draftsPreview = ['a', 'b', 'c']
            .map((key) => `${key}:${String(normalized.drafts[key] || '').slice(0, 16)}`)
            .join(' ');

          const draftsArtifact = upsertStageArtifact(notebookId, {
            refKey: 'lectureDraftsId',
            type: 'lecture_drafts',
            stage: 'lecture',
            title: `${notebook.name || '课程'}-讲稿A/B/C`,
            content: {
              instruction: normalized.instruction,
              drafts: normalized.drafts,
              selectedDraft: normalized.selectedDraft
            },
            format: 'json',
            status: 'confirmed',
            confirmed: true,
            previewText: draftsPreview,
            quality,
            reviewReasons: quality.reviewReasons
          });
          const finalArtifact = upsertStageArtifact(notebookId, {
            refKey: 'lectureFinalId',
            type: 'lecture_final',
            stage: 'lecture',
            title: `${notebook.name || '课程'}-正式讲稿`,
            content: {
              instruction: normalized.instruction,
              selectedDraft: normalized.selectedDraft,
              finalScript: normalized.finalScript
            },
            format: 'json',
            status: 'confirmed',
            confirmed: true,
            previewText: String(normalized.finalScript || '').slice(0, 120),
            sourceArtifactIds: draftsArtifact?.id ? [draftsArtifact.id] : [],
            quality,
            reviewReasons: quality.reviewReasons,
            sourceRefs: draftsArtifact?.id ? [{ kind: 'artifact', ref: String(draftsArtifact.id), label: 'lecture-drafts' }] : []
          });
          db.upsertWorkflowState(notebookId, {
            currentArtifactRefs: {
              lectureDraftsId: draftsArtifact.id,
              lectureFinalId: finalArtifact.id
            }
          });
          syncWorkflowStageAvailability?.(notebookId, { preferredStage: 'ppt' });
          patchCourseProject(notebookId, {
            dirty: false,
            dirtyReason: 'lecture-confirmed',
            dirtyAt: new Date().toISOString()
          });

          return {
            output: { unlockedStage: 'ppt' },
            warnings: quality.warnings,
            outputArtifactIds: [draftsArtifact?.id, finalArtifact?.id].filter(Boolean),
            metadata: { quality },
            value: {
              success: true,
              data: attachRuntimeMeta(buildLectureStageBundle(notebookId), notebookId, 'lecture', quality),
              artifacts: { lectureDrafts: draftsArtifact, lectureFinal: finalArtifact },
              quality
            }
          };
        });
        return unwrapOperationResult(value, operation);
      });
    },

    getPptStageData(notebookId) {
      return respond(async () => {
        const safeNotebookId = Number(notebookId);
        const bundle = buildPptStageBundle(safeNotebookId);
        const quality = validatePptStage(bundle.pptData, { requirePages: false });
        return {
          success: true,
          data: attachRuntimeMeta(bundle, safeNotebookId, 'ppt', quality)
        };
      });
    },

    savePptStage(payload = {}) {
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'ppt',
          action: 'save',
          summary: '保存 PPT 阶段'
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          const normalized = normalizePptStagePayload(payload);
          const quality = validatePptStage(normalized, { requirePages: false });

          const outlineArtifact = upsertStageArtifact(notebookId, {
            refKey: 'pptOutlineId',
            type: 'ppt_outline',
            stage: 'ppt',
            title: `${notebook.name || '课程'}-PPT页级框架`,
            content: normalized,
            format: 'json',
            status: quality.reviewNeeded ? 'review_needed' : (db.getLatestArtifact(notebookId, 'ppt_outline', 'ppt') ? 'edited' : 'generated'),
            confirmed: false,
            previewText: normalized.pptOutline.slice(0, 120),
            quality,
            reviewReasons: quality.reviewReasons
          });
          const pageArtifacts = upsertPptPageImageArtifacts(notebookId, normalized.pptPages, {
            status: 'edited',
            confirmed: false,
            parentArtifactId: outlineArtifact.id,
            sourceArtifactIds: [outlineArtifact.id]
          });

          patchCourseProject(notebookId, {
            dirty: true,
            dirtyReason: 'v2-ppt-saved',
            dirtyAt: new Date().toISOString()
          });

          return {
            output: { pageCount: normalized.pptPages.length },
            warnings: quality.warnings,
            outputArtifactIds: [outlineArtifact?.id, ...pageArtifacts.map((item) => item?.id)].filter(Boolean),
            metadata: { quality },
            value: {
              success: true,
              data: attachRuntimeMeta(buildPptStageBundle(notebookId), notebookId, 'ppt', quality),
              artifacts: { pptOutline: outlineArtifact, pageImages: pageArtifacts },
              quality
            }
          };
        });
        return unwrapOperationResult(value, operation);
      });
    },

    confirmPptStage(payload = {}) {
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'ppt',
          action: 'confirm',
          summary: '确认 PPT 阶段'
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          const normalized = normalizePptStagePayload(payload);
          const quality = validatePptStage(normalized, { requirePages: true });
          if (!quality.valid) throw new Error(quality.errors.join('; '));

          const outlineArtifact = upsertStageArtifact(notebookId, {
            refKey: 'pptOutlineId',
            type: 'ppt_outline',
            stage: 'ppt',
            title: `${notebook.name || '课程'}-PPT页级框架`,
            content: normalized,
            format: 'json',
            status: 'confirmed',
            confirmed: true,
            previewText: normalized.pptOutline.slice(0, 120),
            quality,
            reviewReasons: quality.reviewReasons
          });
          const pageArtifacts = upsertPptPageImageArtifacts(notebookId, normalized.pptPages, {
            status: 'confirmed',
            confirmed: true,
            parentArtifactId: outlineArtifact.id,
            sourceArtifactIds: [outlineArtifact.id]
          });
          db.upsertWorkflowState(notebookId, {
            currentArtifactRefs: {
              pptOutlineId: outlineArtifact.id
            }
          });
          syncWorkflowStageAvailability?.(notebookId, { preferredStage: 'video' });
          patchCourseProject(notebookId, {
            dirty: false,
            dirtyReason: 'ppt-confirmed',
            dirtyAt: new Date().toISOString()
          });

          return {
            output: { unlockedStage: 'video', pageCount: normalized.pptPages.length },
            warnings: quality.warnings,
            outputArtifactIds: [outlineArtifact?.id, ...pageArtifacts.map((item) => item?.id)].filter(Boolean),
            metadata: { quality },
            value: {
              success: true,
              data: attachRuntimeMeta(buildPptStageBundle(notebookId), notebookId, 'ppt', quality),
              artifacts: { pptOutline: outlineArtifact, pageImages: pageArtifacts },
              quality
            }
          };
        });
        return unwrapOperationResult(value, operation);
      });
    },

    generatePptPageCandidates(payload = {}) {
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'ppt',
          action: 'generate-candidates',
          summary: '生成 PPT 页候选图'
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          const rawPage = normalizePptPage(payload.page || {}, 0);
          let page = rawPage;
          if (!page.id) throw new Error('page.id is required');
          if (!page.needImage) throw new Error('Current page does not require image');

          const templateKey = PPT_TEMPLATE_PRESETS[payload.templateKey] ? String(payload.templateKey) : 'pro_minimalist';
          const template = PPT_TEMPLATE_PRESETS[templateKey] || PPT_TEMPLATE_PRESETS.pro_minimalist;
          const courseName = String(payload.courseName || notebook.name || '课程');
          if (typeof ensurePptImagePromptForPage === 'function') {
            page = ensurePptImagePromptForPage(rawPage, {
              courseName,
              template,
              imageAspect: rawPage.imageAspect || '16:9',
              imageQuality: rawPage.imageQuality || 'low'
            });
          }
          const taskId = getPptPageTaskId(notebookId, page.id);
          const promptLocked = buildPptLockedPrompt({
            courseName,
            page,
            template,
            aspect: page.imageAspect || '16:9',
            quality: page.imageQuality || 'low',
            customRequirements: String(page.imagePrompt || '').trim()
          });
          const variantHints = [
            '【候选A】构图变体：左侧主体 + 右侧留白。',
            '【候选B】构图变体：中轴平衡 + 前景元素聚焦。',
            '【候选C】构图变体：右侧主体 + 左侧留白。'
          ];
          const successResults = [];
          const failed = [];

          for (let i = 0; i < variantHints.length; i += 1) {
            try {
              const generated = await imageGeneratorService.generateImage({
                promptFinal: `${promptLocked}\n${variantHints[i]}`,
                model: PPT_FIXED_IMAGE_MODEL,
                sceneType: 'generic',
                notebookId,
                taskId,
                size: payload.size || '2560x1440'
              });
              const version = imageVersionService.createImageVersion(generated.taskId, generated.promptFinal, {
                model: generated.model,
                sceneType: generated.sceneType,
                imagePath: generated.imagePath,
                imageUrl: generated.imageUrl,
                resourceId: generated.resourceId,
                status: 'generated'
              });
              // 给生成的图片追加结构化标签
              if (generated.resourceId) {
                try {
                  db.addResourceTags(generated.resourceId, [
                    `课程:${courseName}`,
                    `页面:P${page.pageNumber || ''}-${page.title || ''}`,
                    `页型:${page.pageType || ''}`,
                    `阶段:ppt`,
                    `用途:PPT插图`
                  ]);
                } catch {}
              }
              successResults.push({ ...generated, version });
            } catch (error) {
              failed.push(`候选${i + 1}失败：${getErrorMessage(error)}`);
            }
          }

          if (!successResults.length) {
            throw new Error(failed.join('；') || 'No image candidates generated');
          }

          const selected = successResults[successResults.length - 1];
          const outlineArtifact = resolveArtifactByRefOrLatest(notebookId, 'pptOutlineId', 'ppt_outline', 'ppt');
          const existing = findPptPageImageArtifact(notebookId, page.id);
          const imageArtifactPatch = {
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
              imagePath: selected.imagePath || '',
              imageUrl: selected.imageUrl || '',
              imageModel: selected.model || PPT_FIXED_IMAGE_MODEL,
              taskId,
              candidateCount: successResults.length,
              selectedVersionId: selected.version?.id || null
            },
            format: 'json',
            status: 'generated',
            confirmed: false,
            storagePath: selected.imagePath || null,
            previewText: page.title || '',
            parentArtifactId: outlineArtifact?.id || null,
            sourceArtifactIds: outlineArtifact?.id ? [outlineArtifact.id] : []
          };
          const artifact = existing?.id
            ? updateTrackedArtifact(existing.id, imageArtifactPatch)
            : createTrackedArtifact(notebookId, imageArtifactPatch);

          return {
            output: { pageId: page.id, candidateCount: successResults.length },
            warnings: failed,
            outputArtifactIds: artifact?.id ? [artifact.id] : [],
            metadata: { taskId, failedCount: failed.length },
            value: {
              success: true,
              data: {
                page: {
                  ...page,
                  imagePath: selected.imagePath || '',
                  imageUrl: selected.imageUrl || '',
                  imageModel: selected.model || PPT_FIXED_IMAGE_MODEL
                },
                versions: imageVersionService.listImageVersions(taskId),
                failed,
                taskId,
                artifact
              }
            }
          };
        });
        return unwrapOperationResult(value, operation);
      });
    },

    getVideoStageData(notebookId) {
      return respond(async () => {
        const safeNotebookId = Number(notebookId);
        const bundle = buildVideoStageBundle(safeNotebookId);
        const quality = validateVideoStage(bundle.videoData, { requirePrompt: false });
        return {
          success: true,
          data: attachRuntimeMeta(bundle, safeNotebookId, 'video', quality)
        };
      });
    },

    saveVideoStage(payload = {}) {
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'video',
          action: 'save',
          summary: '保存视频提示词阶段'
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          const normalized = normalizeVideoStagePayload(payload);
          const quality = validateVideoStage(normalized, { requirePrompt: false });
          const promptArtifact = upsertStageArtifact(notebookId, {
            refKey: 'videoPromptId',
            type: 'video_prompt',
            stage: 'video',
            title: `${notebook.name || '课程'}-视频提示词`,
            content: normalized,
            format: 'json',
            status: quality.reviewNeeded ? 'review_needed' : (db.getLatestArtifact(notebookId, 'video_prompt', 'video') ? 'edited' : 'generated'),
            confirmed: false,
            previewText: normalized.promptText.slice(0, 120),
            quality,
            reviewReasons: quality.reviewReasons
          });
          patchCourseProject(notebookId, {
            dirty: true,
            dirtyReason: 'v2-video-saved',
            dirtyAt: new Date().toISOString()
          });

          return {
            output: { hasPromptText: Boolean(String(normalized.promptText || '').trim()) },
            warnings: quality.warnings,
            outputArtifactIds: promptArtifact?.id ? [promptArtifact.id] : [],
            metadata: { quality },
            value: {
              success: true,
              data: attachRuntimeMeta(buildVideoStageBundle(notebookId), notebookId, 'video', quality),
              artifacts: { videoPrompt: promptArtifact },
              quality
            }
          };
        });
        return unwrapOperationResult(value, operation);
      });
    },

    getStageOperations(payload = {}) {
      return respond(async () => ({
        success: true,
        data: taskRuntime.listStageOperations({
          notebookId: Number(payload.notebookId),
          stage: String(payload.stage || '').trim(),
          limit: Number(payload.limit) || 50
        })
      }));
    }
  };

  return api;
}

module.exports = {
  createV2Runtime
};
