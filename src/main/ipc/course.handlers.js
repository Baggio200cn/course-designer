/**
 * 课程流水线 handlers — 6 个 IPC handlers
 *
 * 处理的 channel：
 *   course:generateOutlines, course:generateScenes, course:runPipeline,
 *   course:rebuildSingleFlow, course:saveDiscussionDraft, course:saveProjectPatch
 *
 * 注意：quality:auditStyle / quality:auditNotebook / script:generate* 不在这里，
 *       它们属于 lecture.handlers.js。
 *
 * 稳定依赖（直接 require）：
 *   api/provider-config, api/request-utils, course/
 *
 * 运行时依赖（通过 getDeps 惰性获取）：
 *   { db, patchCourseProject }
 */

const { resolveProviderConfig, createAiClientByConfig } = require('../api/provider-config');
const { normalizeErrorMessage } = require('../api/request-utils');
const {
  runGenerationPipeline,
  generateSceneOutlinesFromRequirements,
  generateFullScenes
} = require('../course');

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  /** 用当前 db 的 API key 配置创建 AI 客户端 */
  function createAiClient(payload) {
    const { db } = getDeps();
    const config = resolveProviderConfig({ payload, db });
    return createAiClientByConfig(config);
  }

  // 生成场景大纲（二阶段流水线第一阶段）
  ipcMain.handle('course:generateOutlines', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const aiClient = createAiClient(payload);
      const result = await generateSceneOutlinesFromRequirements({
        requirementsText: payload.requirementsText || '',
        courseInfo: payload.courseInfo || {},
        styleCard: payload.styleCard || null,
        aiClient,
        logger: console
      });
      return { success: result.success, data: result.data, errors: result.errors, warnings: result.warnings };
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) };
    }
  });

  // 生成完整场景内容（二阶段流水线第二阶段）
  ipcMain.handle('course:generateScenes', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const aiClient = createAiClient(payload);
      const result = await generateFullScenes(payload.sceneOutlines || [], {
        aiClient,
        logger: console
      });
      return { success: result.success, data: result.data, errors: result.errors, warnings: result.warnings };
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) };
    }
  });

  // 运行完整课程生成流水线，生成成功后持久化到数据库
  ipcMain.handle('course:runPipeline', async (event, payload = {}) => {
    const { db, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const aiClient = createAiClient(payload);
      const result = await runGenerationPipeline({
        requirementsText: payload.requirementsText || '',
        courseInfo: payload.courseInfo || {},
        styleCard: payload.styleCard || null,
        aiClient,
        logger: console
      });
      const notebookId = Number(payload.notebookId);
      if (result?.success && Number.isFinite(notebookId) && notebookId > 0) {
        try {
          const existing = db.getNotebookById(notebookId);
          const previousProject = existing?.courseProject && typeof existing.courseProject === 'object'
            ? existing.courseProject
            : {};
          const nextProject = {
            ...previousProject,
            courseCard: {
              id: existing?.id || notebookId,
              name: existing?.name || '',
              totalHours: existing?.totalHours || 0,
              grade: existing?.grade || ''
            },
            requirementsText: payload.requirementsText || '',
            sceneBundle: result.data || null,
            dirty: false,
            lastCompiledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          db.updateNotebook(notebookId, {
            courseRequirementsText: payload.requirementsText || '',
            coursePipeline: result.data || null,
            coursePipelineUpdatedAt: new Date().toISOString(),
            courseProject: nextProject
          });
        } catch (persistError) {
          console.log('Persist course pipeline failed:', persistError);
        }
      }
      return { success: result.success, data: result.data, warnings: result.warnings, errors: result.errors };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 根据现有数据重新生成单条课程流（增量刷新）
  ipcMain.handle('course:rebuildSingleFlow', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const modules = db.getModulesByNotebook(notebookId);
      const schedule = db.getTeachingSchedule(notebookId) || [];
      const resources = db.listResources({ notebookId });
      const materialDigest = resources.slice(0, 30).map((item) => ({
        id: item.id,
        name: item.name || item.originalName || '',
        type: item.type || 'other',
        updatedAt: item.updatedAt || item.createdAt
      }));
      const aiClient = createAiClient(payload);
      const requirementsText = String(
        payload.requirementsText ||
        notebook.courseRequirementsText ||
        notebook.courseProject?.requirementsText ||
        ''
      );
      const run = await runGenerationPipeline({
        requirementsText,
        courseInfo: {
          ...notebook,
          modules,
          teachingSchedule: schedule,
          materialDigest,
          language: 'zh-CN'
        },
        styleCard: payload.styleCard || null,
        aiClient,
        logger: console
      });
      if (!run?.success) return { success: false, error: run?.error || run?.errors?.join('；') || 'rebuild failed' };
      const previousProject = notebook.courseProject && typeof notebook.courseProject === 'object'
        ? notebook.courseProject
        : {};
      const courseProject = {
        ...previousProject,
        courseCard: {
          id: notebook.id,
          name: notebook.name || '',
          totalHours: notebook.totalHours || 0,
          grade: notebook.grade || ''
        },
        framework: db.getCurrentFramework(notebookId)?.content || previousProject.framework || {},
        schedule,
        modules,
        requirementsText,
        materialDigest,
        sceneBundle: run.data || null,
        dirty: false,
        lastCompiledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.updateNotebook(notebookId, {
        courseRequirementsText: requirementsText,
        courseProject,
        coursePipeline: run.data || null,
        coursePipelineUpdatedAt: new Date().toISOString()
      });
      return { success: true, data: courseProject };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 保存讨论稿草稿（确认稿前的修改稿）
  ipcMain.handle('course:saveDiscussionDraft', async (event, payload = {}) => {
    const { db, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const discussionDraft = String(payload.discussionDraft || '');
      const comments = Array.isArray(payload.comments) ? payload.comments : [];
      const updated = patchCourseProject(notebookId, {
        discussionDraft,
        discussionComments: comments,
        dirty: true,
        dirtyReason: 'discussion-updated',
        dirtyAt: new Date().toISOString()
      });
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 通用课程项目字段补丁（前端局部更新）
  ipcMain.handle('course:saveProjectPatch', async (event, payload = {}) => {
    const { db, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : {};
      const updated = patchCourseProject(notebookId, {
        ...patch,
        dirty: true,
        dirtyReason: patch.dirtyReason || 'course-project-patch',
        dirtyAt: new Date().toISOString()
      });
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
