const { createTaskRuntime } = require('./task-runtime');
const {
  validateLectureStage,
  validatePptStage,
  validateVideoStage
} = require('./quality');
// Phase-6 M3.2：质量失败时用户强制接受裁决
const { resolveConflict, CONFLICT_TYPE } = require('../agent/conflict-policy');

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
      const userInitiated = payload._userInitiated === true;  // Phase-6 M2.2
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
            reviewReasons: quality.reviewReasons,
            userInitiated  // Phase-6 M2.2 透传
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
      const userInitiated = payload._userInitiated === true;  // Phase-6 M2.2
      const userForceAccept = payload.userForceAccept === true;  // Phase-6 M3.2
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'framework',
          action: 'confirm',
          summary: userForceAccept ? '确认教学框架阶段（用户强制接受）' : '确认教学框架阶段'
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          let quality = { stage: 'framework', valid: true, errors: [], warnings: [] };
          let frameworkForceAccepted = false;

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
            // Phase-6 M3.2：用 conflict-policy 裁决质量失败 vs 用户强制接受
            const conflictDecision = resolveConflict(CONFLICT_TYPE.QUALITY_VS_USER_ACCEPT, {
              quality, userForceAccept,
            });
            if (conflictDecision.blocksAgent) {
              throw new Error(validation.errors.join('; '));
            }
            frameworkForceAccepted = !validation.valid && userForceAccept;
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
            reviewReasons: quality.reviewReasons,
            userInitiated  // Phase-6 M2.2 透传
          });
          patchCourseProject(notebookId, {
            dirty: false,
            dirtyReason: 'framework-confirmed',
            dirtyAt: new Date().toISOString()
          });

          // Phase-7.7 A3（2026-04-30）：手动 confirm framework 时写 memory
          // 把框架的教学目标 + 教学方法摘要保存，下次相似课程的 prompt 自动注入
          try {
            const memory = require('../agent/memory');
            const fwContent = (db.getCurrentFramework(notebookId)?.content) || {};
            const objectives = fwContent.objectives || {};
            const objSummary = [
              ...(Array.isArray(objectives.knowledge) ? objectives.knowledge.slice(0, 3) : []),
              ...(Array.isArray(objectives.skills) ? objectives.skills.slice(0, 3) : []),
              ...(Array.isArray(objectives.attitude) ? objectives.attitude.slice(0, 2) : []),
            ].filter(Boolean).join('；');
            const methods = fwContent.teachingMethods || {};
            const methodSummary = [methods.primary || '', ...(Array.isArray(methods.secondary) ? methods.secondary : [])]
              .filter(Boolean).join('、');
            memory.saveMemory(db, notebookId, {
              frameworkObjectives: objSummary.slice(0, 500),
              frameworkTeachingMethods: methodSummary.slice(0, 200),
              lectureCharCount: 0,  // 此阶段未生成讲稿，confirmLectureStage 时会更新
              styleHints: '',
            });
          } catch (memErr) {
            console.warn('[runtime.confirmFramework] saveMemory 失败（非致命）:', memErr.message);
          }

          // Phase-6 M3.2：强制接受时附加警告 + 审计标记
          const finalWarnings = frameworkForceAccepted
            ? [...(quality.warnings || []), `[force-accepted] 用户在质量未达标的情况下强制接受：${quality.errors.join('；')}`]
            : (quality.warnings || []);

          return {
            output: { unlockedStage: 'lecture', forceAccepted: frameworkForceAccepted },
            warnings: finalWarnings,
            outputArtifactIds: Object.values(syncResult?.artifacts || {}).map((item) => item?.id).filter(Boolean),
            metadata: { quality, forceAccepted: frameworkForceAccepted },
            value: {
              success: true,
              data: attachRuntimeMeta(buildFrameworkStageBundle(notebookId), notebookId, 'framework', quality),
              artifacts: syncResult?.artifacts || {},
              quality,
              forceAccepted: frameworkForceAccepted,
              warnings: finalWarnings
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
        // D9.1（2026-05-18）：per-lesson 模式下用 confirmedHours 作为分母
        //   不是 notebook.totalHours（72），而是已确认节课累计学时
        //   这样"4 学时一节" → 期望字数 8800-12000，不再误报 158400 不足
        const lectureData = bundle.lectureData;
        const effectiveHours = lectureData.perLessonMode
          ? Math.max(1, lectureData.perLessonStats?.confirmedHours || lectureData.perLessonStats?.totalLessonHours || 1)
          : Number(bundle.notebook?.totalHours) || 1;
        const quality = validateLectureStage(lectureData, { requireFinal: false, totalHours: effectiveHours });
        return {
          success: true,
          data: attachRuntimeMeta(bundle, safeNotebookId, 'lecture', quality)
        };
      });
    },

    saveLectureStage(payload = {}) {
      const userInitiated = payload._userInitiated === true;  // Phase-6 M2.2
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
            reviewReasons: quality.reviewReasons,
            userInitiated  // Phase-6 M2.2
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
            sourceRefs: draftsArtifact?.id ? [{ kind: 'artifact', ref: String(draftsArtifact.id), label: 'lecture-drafts' }] : [],
            userInitiated  // Phase-6 M2.2
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
      const userInitiated = payload._userInitiated === true;  // Phase-6 M2.2
      const userForceAccept = payload.userForceAccept === true;  // Phase-6 M3.2
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'lecture',
          action: 'confirm',
          summary: userForceAccept ? '确认讲稿阶段（用户强制接受）' : '确认讲稿阶段'
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          const normalized = normalizeLectureStagePayload(payload);
          const quality = validateLectureStage(normalized, { requireFinal: true, totalHours: Number(notebook.totalHours) || 1 });
          // Phase-6 M3.2：质量失败时用 conflict-policy 裁决
          const conflictDecision = resolveConflict(CONFLICT_TYPE.QUALITY_VS_USER_ACCEPT, {
            quality, userForceAccept,
          });
          if (conflictDecision.blocksAgent) {
            // 用户未选择强制接受 → 保持原抛错行为
            throw new Error(quality.errors.join('; '));
          }
          // 标记是否为"强制接受"路径（写入 metadata 用于审计）
          const isForceAccepted = !quality.valid && userForceAccept;
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
            reviewReasons: quality.reviewReasons,
            userInitiated  // Phase-6 M2.2
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
            sourceRefs: draftsArtifact?.id ? [{ kind: 'artifact', ref: String(draftsArtifact.id), label: 'lecture-drafts' }] : [],
            userInitiated  // Phase-6 M2.2
          });
          db.upsertWorkflowState(notebookId, {
            currentArtifactRefs: {
              lectureDraftsId: draftsArtifact.id,
              lectureFinalId: finalArtifact.id
            }
          });
          // v4.3.3 Codex #2：新流程 lecture → quiz（不再 lecture → ppt）
          syncWorkflowStageAvailability?.(notebookId, { preferredStage: 'quiz' });
          // v4.3.3 Codex #5：上游 lecture 改 → 下游 quiz/homework/video/report 标 dirty
          if (typeof db.markDownstreamDirty === 'function') {
            try { db.markDownstreamDirty(notebookId, 'lecture', 'lecture-confirmed'); } catch (_) {}
          }
          patchCourseProject(notebookId, {
            dirty: false,
            dirtyReason: 'lecture-confirmed',
            dirtyAt: new Date().toISOString()
          });

          // Phase-7.7 A3（2026-04-30）：手动 confirm 讲稿时自动写 memory
          // 老师感受到"系统越用越懂我的课程"——下次新建相似主题课程时，
          // memory.buildMemoryContext 会把本次成功案例作为 few-shot 注入 prompt。
          // 失败不阻塞 confirm（memory 是辅助能力，缺失也不影响主流程）。
          try {
            const memory = require('../agent/memory');
            const finalScriptText = String(normalized.finalScript || '');
            const narrationCharCount = (finalScriptText.match(/教师讲述[:：][\s\S]*?(?=##|课堂动作|$)/g) || [])
              .reduce((sum, block) => sum + block.replace(/[\s\W]/g, '').length, 0);
            memory.saveMemory(db, notebookId, {
              frameworkObjectives: '',  // 框架目标在 confirmFrameworkStage 已写
              frameworkTeachingMethods: '',
              lectureCharCount: narrationCharCount || finalScriptText.length,
              styleHints: normalized.instruction || '',
            });
          } catch (memErr) {
            console.warn('[runtime.confirmLecture] saveMemory 失败（非致命）:', memErr.message);
          }

          // Phase-6 M3.2：强制接受时附加警告 + 审计标记
          const finalWarnings = isForceAccepted
            ? [...(quality.warnings || []), `[force-accepted] 用户在质量未达标的情况下强制接受：${quality.errors.join('；')}`]
            : (quality.warnings || []);

          return {
            output: { unlockedStage: 'ppt', forceAccepted: isForceAccepted },
            warnings: finalWarnings,
            outputArtifactIds: [draftsArtifact?.id, finalArtifact?.id].filter(Boolean),
            metadata: { quality, forceAccepted: isForceAccepted, conflictDecision: conflictDecision.resolution },
            value: {
              success: true,
              data: attachRuntimeMeta(buildLectureStageBundle(notebookId), notebookId, 'lecture', quality),
              artifacts: { lectureDrafts: draftsArtifact, lectureFinal: finalArtifact },
              quality,
              forceAccepted: isForceAccepted,
              warnings: finalWarnings
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
        // D9.2（2026-05-18）：per-lesson 模式下用确认节累计学时作为页数门槛分母
        //   旧 bug：16 页单节 PPT vs 72 学时建议 30-40 页 → 误报"页数偏少"
        const pptData = bundle.pptData;
        const effectiveHours = pptData.perLessonMode
          ? Math.max(1, pptData.perLessonStats?.confirmedHours || pptData.perLessonStats?.totalLessonHours || 1)
          : 0;
        const quality = validatePptStage(pptData, { requirePages: false, totalHours: effectiveHours });
        return {
          success: true,
          data: attachRuntimeMeta(bundle, safeNotebookId, 'ppt', quality)
        };
      });
    },

    savePptStage(payload = {}) {
      const userInitiated = payload._userInitiated === true;  // Phase-6 M2.2
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

          // 2026-05-17 v4.2.0 Bug 修复：把 lessonContext 持久化到 metadata
          //   旧 bug：savePptStage 不存 metadata.lessonContext，老师重启后 confirmPptStage 找不到节课学时，回退用 72 学时（整门课）验证 → "页数严重不足"误报
          //   修法：从 payload.lessonContext 提取节课信息 → 写入 artifact.metadata
          const _lcPayload = payload?.lessonContext || {};
          const _theoryH = Number(_lcPayload.theoryHours) || 0;
          const _practiceH = Number(_lcPayload.practiceHours) || 0;
          const _totalH = Number(_lcPayload.totalHours) || (_theoryH + _practiceH);
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
            reviewReasons: quality.reviewReasons,
            userInitiated,  // Phase-6 M2.2
            // 2026-05-17 v4.2.0：节课信息持久化到 metadata（供 confirmPpt 学时验证 fallback）
            metadata: _lcPayload && (_lcPayload.lessonNumber || _totalH > 0) ? {
              lessonNumber: _lcPayload.lessonNumber || 0,
              topic: _lcPayload.topic || '',
              chapter: _lcPayload.chapter || '',
              theoryHours: _theoryH,
              practiceHours: _practiceH,
              totalHours: _totalH,
              designId: _lcPayload.designId || null,
              lessonId: _lcPayload.lessonId || null,
              lessonContext: _lcPayload,
            } : undefined,
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
      const userInitiated = payload._userInitiated === true;  // Phase-6 M2.2
      const userForceAccept = payload.userForceAccept === true;  // Phase-6 M3.2
      return respond(async () => {
        const notebookId = Number(payload.notebookId);
        const { value, operation } = await taskRuntime.runStageAction({
          notebookId,
          stage: 'ppt',
          action: 'confirm',
          summary: userForceAccept ? '确认 PPT 阶段（用户强制接受）' : '确认 PPT 阶段'
        }, async () => {
          const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
          if (!notebook) throw new Error('Notebook not found');
          const normalized = normalizePptStagePayload(payload);
          // 2026-05-16 v4.1.4 真 P2 修复：PPT 阶段已经按 per-lesson 模式生成（3-4 学时单节课）
          //   但 confirm 校验仍用 notebook.totalHours = 36 → 误判"页数严重不足"
          //   修法：优先用 payload 里的 lessonContext.totalHours（节课学时）
          //   兜底用 notebook.totalHours（兼容整门课模式的旧数据）
          // 2026-05-17 v4.2.0 加固：payload 没传 lessonContext 时（如老师重启 Electron 后直接点确认），
          //   从 db 最新 ppt_outline / design_doc artifact 的 metadata 反推节课学时
          let lessonHours = Number(payload?.lessonContext?.totalHours) || 0;
          let fallbackSource = '';
          if (lessonHours === 0) {
            // 兜底 1：会话上下文 activeDesignArtifactId
            const session = typeof db.getSessionContext === 'function' ? db.getSessionContext(notebookId) : null;
            const designId = session?.activeDesignArtifactId;
            const designArt = designId && typeof db.getArtifactById === 'function' ? db.getArtifactById(designId) : null;
            const dlm = designArt?.metadata || {};
            const dh = (Number(dlm.theoryHours) || 0) + (Number(dlm.practiceHours) || 0);
            if (dh > 0) { lessonHours = dh; fallbackSource = `session.activeDesign #${designId}`; }
          }
          if (lessonHours === 0) {
            // 兜底 2：最新 ppt_outline artifact 的 metadata.lessonContext
            const latest = typeof db.getLatestArtifact === 'function' ? db.getLatestArtifact(notebookId, 'ppt_outline', 'ppt') : null;
            const meta = latest?.metadata || {};
            const ph = Number(meta.lessonContext?.totalHours) || ((Number(meta.theoryHours) || 0) + (Number(meta.practiceHours) || 0));
            if (ph > 0) { lessonHours = ph; fallbackSource = `latest ppt_outline #${latest?.id}`; }
          }
          const validationTotalHours = lessonHours > 0
            ? lessonHours
            : (Number(notebook.totalHours) || 1);
          if (lessonHours > 0) {
            console.log(`[v2:confirmPptStage] 按节课模式校验：${lessonHours} 学时${fallbackSource ? ` (兜底自 ${fallbackSource})` : ' (来自 payload.lessonContext)'}（不是整门课的 ${notebook.totalHours}）`);
          } else {
            console.warn(`[v2:confirmPptStage] ⚠ 无 lessonContext 且无 design/ppt artifact 兜底，回退用整门课 ${notebook.totalHours} 学时验证（可能触发"页数严重不足"误报）`);
          }
          const quality = validatePptStage(normalized, {
            requirePages: true,
            totalHours: validationTotalHours,
          });
          // Phase-6 M3.2：用 conflict-policy 裁决
          const conflictDecision = resolveConflict(CONFLICT_TYPE.QUALITY_VS_USER_ACCEPT, {
            quality, userForceAccept,
          });
          if (conflictDecision.blocksAgent) {
            throw new Error(quality.errors.join('; '));
          }
          const pptForceAccepted = !quality.valid && userForceAccept;

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
            reviewReasons: quality.reviewReasons,
            userInitiated  // Phase-6 M2.2
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
          // v4.3.3 Codex #2：新流程 ppt → lecture（不再 ppt → video）
          syncWorkflowStageAvailability?.(notebookId, { preferredStage: 'lecture' });
          // v4.3.3 Codex #5：上游 ppt 改 → 下游 lecture/quiz/homework/video/report 全标 dirty
          if (typeof db.markDownstreamDirty === 'function') {
            try { db.markDownstreamDirty(notebookId, 'ppt', 'ppt-confirmed'); } catch (_) {}
          }
          patchCourseProject(notebookId, {
            dirty: false,
            dirtyReason: 'ppt-confirmed',
            dirtyAt: new Date().toISOString()
          });

          // Phase-6 M3.2：强制接受时附加警告 + 审计标记
          const finalWarnings = pptForceAccepted
            ? [...(quality.warnings || []), `[force-accepted] 用户在质量未达标的情况下强制接受：${quality.errors.join('；')}`]
            : (quality.warnings || []);

          return {
            output: { unlockedStage: 'video', pageCount: normalized.pptPages.length, forceAccepted: pptForceAccepted },
            warnings: finalWarnings,
            outputArtifactIds: [outlineArtifact?.id, ...pageArtifacts.map((item) => item?.id)].filter(Boolean),
            metadata: { quality, forceAccepted: pptForceAccepted },
            value: {
              success: true,
              data: attachRuntimeMeta(buildPptStageBundle(notebookId), notebookId, 'ppt', quality),
              artifacts: { pptOutline: outlineArtifact, pageImages: pageArtifacts },
              quality,
              forceAccepted: pptForceAccepted,
              warnings: finalWarnings
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
      const userInitiated = payload._userInitiated === true;  // Phase-6 M2.2
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
            reviewReasons: quality.reviewReasons,
            userInitiated  // Phase-6 M2.2
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
