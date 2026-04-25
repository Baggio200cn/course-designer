/**
 * 框架阶段 handlers — 7 个 IPC handlers
 *
 * 处理的 channel：
 *   ai:generateFramework, framework:list, framework:getCurrent,
 *   framework:create, framework:update, framework:setCurrent,
 *   framework:syncStructureImages
 *
 * 注意：
 *   - framework:exportMerged 在 export.handlers.js（共用 exportRuntime/dialog）
 *   - schedule:get / schedule:save 在 system.handlers.js
 *
 * 稳定依赖（直接 require，不走 getDeps）：
 *   api/deepseek, api/ark, api/framework-schema, api/request-utils
 *
 * 运行时依赖（通过 getDeps 惰性获取）：
 *   { db, normalizeModuleInput, patchCourseProject }
 */

const { generateFramework: generateFrameworkDeepseek } = require('../api/deepseek');
const { generateFramework: generateFrameworkArk } = require('../api/ark');
const { normalizeFrameworkContent, validateFrameworkContent } = require('../api/framework-schema');
const { normalizeErrorMessage } = require('../api/request-utils');

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  /**
   * AI 生成教学框架
   * 支持双提供商（Ark / DeepSeek），Ark 侧有 model 候选人回退链
   */
  ipcMain.handle('ai:generateFramework', async (event, courseInfo) => {
    const { db, normalizeModuleInput, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const payload = courseInfo || {};
      const mode = payload.mode || 'append';
      const targetCourse = payload.courseInfo || payload;
      const notebookId = targetCourse?.id ?? targetCourse?.notebookId;
      if (!notebookId) {
        return { success: false, error: 'Notebook id missing' };
      }

      // 从数据库读取笔记本的富上下文字段，补充到 targetCourse（Phase-5B）
      const notebook = db.getNotebookById(Number(notebookId));
      if (notebook) {
        if (!targetCourse.softwareTools && notebook.softwareTools) targetCourse.softwareTools = notebook.softwareTools;
        if (!targetCourse.jobTargets && notebook.jobTargets) targetCourse.jobTargets = notebook.jobTargets;
        if (!targetCourse.industryScenarios && notebook.industryScenarios) targetCourse.industryScenarios = notebook.industryScenarios;
        if (!targetCourse.learnerProfile && notebook.learnerProfile) targetCourse.learnerProfile = notebook.learnerProfile;
        if (!targetCourse.teachingMaterials && notebook.teachingMaterials) targetCourse.teachingMaterials = notebook.teachingMaterials;
      }

      const hasArkTextConfig = Boolean(
        db.getApiKey('ark') &&
        (
          db.getApiKey('ark_endpoint_text') ||
          db.getApiKey('ark_endpoint') ||
          db.getApiKey('ark_endpoint_text_deepseek') ||
          db.getApiKey('ark_endpoint_doubao_text')
        )
      );
      const hasDeepseekConfig = Boolean(db.getApiKey('deepseek'));
      let provider = String(payload.provider || '').trim().toLowerCase();
      if (!provider) {
        provider = hasArkTextConfig ? 'ark' : 'deepseek';
      }
      if (provider === 'deepseek' && !hasDeepseekConfig && hasArkTextConfig) {
        provider = 'ark';
      }

      let frameworkContent;
      if (provider === 'ark') {
        const apiKey = db.getApiKey('ark');
        if (!apiKey) {
          return { success: false, error: 'Please configure the Ark API key first.' };
        }
        const requestedModel = payload.model || db.getApiKey('ark_model_text_default') || 'auto';
        const preferredModel = requestedModel === 'auto'
          ? (db.getApiKey('ark_model_text_default') || 'deepseek')
          : requestedModel;
        const fallbackOrder = ['deepseek', 'doubao_text'];
        const modelCandidates = requestedModel === 'auto'
          ? [preferredModel, ...fallbackOrder.filter((name) => name !== preferredModel)]
          : [preferredModel];

        let lastError = null;
        let attempted = 0;
        for (const model of modelCandidates) {
          const endpointId =
            payload.endpointId ||
            (model === 'deepseek' ? db.getApiKey('ark_endpoint_text_deepseek') : null) ||
            (model === 'doubao_text' ? db.getApiKey('ark_endpoint_doubao_text') : null) ||
            db.getApiKey(`ark_endpoint_${model}`) ||
            db.getApiKey('ark_endpoint_text') ||
            db.getApiKey('ark_endpoint') ||
            db.getApiKey(`ark_model_id_${model}`);
          if (!endpointId) {
            lastError = new Error('Please configure Ark text endpoint first.');
            continue;
          }
          attempted += 1;
          try {
            const rawFramework = await generateFrameworkArk(targetCourse, apiKey, endpointId);
            const normalized = normalizeFrameworkContent(rawFramework, targetCourse);
            const check = validateFrameworkContent(normalized, targetCourse);
            if (!check.valid) {
              lastError = new Error(`Model ${model} schema validation failed: ${check.errors.join('; ')}`);
              continue;
            }
            frameworkContent = {
              ...normalized,
              _meta: {
                provider: 'ark',
                requestedModel,
                routedModel: model,
                endpointId,
                warnings: check.warnings || []
              }
            };
            break;
          } catch (err) {
            lastError = err;
          }
        }
        if (!frameworkContent) {
          if (attempted === 0) {
            throw new Error('No Ark text endpoint available. Please set endpoint in API settings.');
          }
          throw lastError || new Error('All Ark model candidates failed');
        }
      } else {
        const apiKey = db.getApiKey('deepseek');
        if (!apiKey) {
          if (hasArkTextConfig) {
            return { success: false, error: 'DeepSeek 未配置，但已检测到 Ark 文本配置。请改用 Ark 作为文本生成提供方。' };
          }
          return { success: false, error: '请先配置文本生成所需的 API Key 与文本 Endpoint。' };
        }
        const rawFramework = await generateFrameworkDeepseek(targetCourse, apiKey);
        const normalized = normalizeFrameworkContent(rawFramework, targetCourse);
        const check = validateFrameworkContent(normalized, targetCourse);
        if (!check.valid) {
          return { success: false, error: `Deepseek schema validation failed: ${check.errors.join('; ')}` };
        }
        frameworkContent = {
          ...normalized,
          _meta: { provider: 'deepseek', warnings: check.warnings || [] }
        };
      }

      const framework = db.createFramework(notebookId, frameworkContent, mode);

      // 同步自动生成模块列表
      const autoModules = Array.isArray(frameworkContent?.modules) ? frameworkContent.modules : [];
      if (autoModules.length > 0) {
        const normalizedModules = autoModules.map((item, idx) => normalizeModuleInput({
          moduleNumber: item.number || idx + 1,
          name: item.name || `模块${idx + 1}`,
          hours: Number(item.hours) || 0,
          description: item.description || '',
          knowledgePoints: item.keyPoints || [],
          teachingMethods: item.teachingMethods || '',
          isCore: Boolean(item.isCore)
        }));
        db.replaceModules(notebookId, normalizedModules);
      }

      // 如果没有教学进度表，从模块自动创建
      const currentSchedule = db.getTeachingSchedule(notebookId);
      if (!Array.isArray(currentSchedule) || currentSchedule.length === 0) {
        const scheduleFromModules = (autoModules || []).map((item, idx) => ({
          week: idx + 1,
          topic: item.name || `模块${idx + 1}`,
          hours: Number(item.hours) || 1,
          methods: item.teachingMethods || '',
          assignment: ''
        }));
        if (scheduleFromModules.length > 0) {
          db.saveTeachingSchedule(notebookId, scheduleFromModules);
        }
      }

      patchCourseProject(notebookId, {
        courseCard: {
          id: targetCourse.id || notebookId,
          name: targetCourse.name || '',
          totalHours: targetCourse.totalHours || 0,
          grade: targetCourse.grade || ''
        },
        framework: frameworkContent || {},
        modules: db.getModulesByNotebook(notebookId),
        schedule: db.getTeachingSchedule(notebookId) || [],
        dirty: true,
        dirtyReason: 'framework-updated',
        dirtyAt: new Date().toISOString()
      });

      return { success: true, data: framework };
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) };
    }
  });

  // 列出笔记本下所有框架版本
  ipcMain.handle('framework:list', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const frameworks = db.listFrameworks(notebookId);
      return { success: true, data: frameworks };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 获取当前激活框架
  ipcMain.handle('framework:getCurrent', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const framework = db.getCurrentFramework(notebookId);
      return { success: true, data: framework };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 手动创建框架（不调 AI）
  ipcMain.handle('framework:create', async (event, { notebookId, content, mode }) => {
    const { db, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const framework = db.createFramework(notebookId, content, mode);
      patchCourseProject(notebookId, {
        framework: content || {},
        dirty: true,
        dirtyReason: 'framework-created',
        dirtyAt: new Date().toISOString()
      });
      return { success: true, data: framework };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 更新框架内容
  ipcMain.handle('framework:update', async (event, { frameworkId, content }) => {
    const { db, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const framework = db.updateFramework(frameworkId, content);
      patchCourseProject(framework?.notebookId, {
        framework: content || {},
        dirty: true,
        dirtyReason: 'framework-updated',
        dirtyAt: new Date().toISOString()
      });
      return { success: true, data: framework };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 切换当前激活的框架版本
  ipcMain.handle('framework:setCurrent', async (event, { notebookId, frameworkId }) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const framework = db.setCurrentFramework(notebookId, frameworkId);
      return { success: true, data: framework };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * 把模块表里的结构图路径同步写回框架 JSON
   * 触发时机：用户上传结构图后，前端调用此接口更新框架快照
   */
  ipcMain.handle('framework:syncStructureImages', async (event, { notebookId }) => {
    const { db, normalizeModuleInput } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const currentFramework = db.getCurrentFramework(notebookId);
      if (!currentFramework) {
        return { success: false, error: 'Current framework not found' };
      }

      const modules = db.getModulesByNotebook(notebookId);
      const content = currentFramework.content || currentFramework;
      const cloned = JSON.parse(JSON.stringify(content || {}));
      const frameworkModules = Array.isArray(cloned.modules) ? cloned.modules : [];

      const mergedModules = frameworkModules.map((item, index) => {
        const match = modules.find((m) => {
          const numberHit = Number(m.moduleNumber) > 0 && Number(m.moduleNumber) === Number(item.number || index + 1);
          const nameHit = String(m.name || '').trim() && String(m.name || '').trim() === String(item.name || '').trim();
          return numberHit || nameHit;
        });
        if (!match) return item;
        const structurePath = match?.content?.structureImagePath || null;
        const structureUrl = match?.content?.structureImageUrl || null;
        const structureMeta = match?.content?.structureImageMeta || null;
        if (!structurePath && !structureUrl) return item;
        return {
          ...item,
          structureImagePath: structurePath,
          structureImageUrl: structureUrl,
          structureImageMeta: structureMeta
        };
      });

      const nextContent = {
        ...cloned,
        modules: mergedModules,
        _meta: {
          ...(cloned._meta || {}),
          structureImageSyncedAt: new Date().toISOString()
        }
      };

      const framework = db.createFramework(notebookId, nextContent, 'append');
      const syncModules = Array.isArray(nextContent?.modules) ? nextContent.modules : [];
      if (syncModules.length > 0) {
        const normalizedModules = syncModules.map((item, idx) => normalizeModuleInput({
          moduleNumber: item.number || idx + 1,
          name: item.name || `模块${idx + 1}`,
          hours: Number(item.hours) || 0,
          description: item.description || '',
          knowledgePoints: item.keyPoints || item.knowledgePoints || [],
          teachingMethods: item.teachingMethods || '',
          isCore: Boolean(item.isCore)
        }));
        db.replaceModules(notebookId, normalizedModules);
      }
      return { success: true, data: framework };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
