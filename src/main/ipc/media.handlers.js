/**
 * 媒体生成 handlers — 9 个 IPC handlers
 *
 * 处理的 channel：
 *   v2:generateFrameworkInfographic（信息图生成，支持 layout/visualStyle 参数）
 *   v2:generateDiagram（SVG 教学结构图，baoyu-diagram 思路）
 *   v2:getInfographicOptions（获取布局/风格选项列表）
 *   images:listVersions, images:regenerate, images:generateStructured,
 *   images:generateGeneric, images:rollbackVersion（图片版本管理）
 *   videos:generateT2V（视频生成）
 *
 * 直接 require（稳定依赖）：
 *   path, fs, electron.BrowserWindow, ../shared/v2-stage-helpers
 *
 * 运行时依赖（通过 getDeps 惰性获取）：
 *   { db, ensureNotebookWorkspaceState, ensureNotebookWorkspaceDirs,
 *     infographicCardService, imageVersionService,
 *     imageGeneratorService, videoGeneratorService }
 *
 * 本地工具（从 index.js 提取，纯函数或仅依赖 Electron API）：
 *   inferInfocardStyle, withTimeout, renderHtmlToPngBuffer
 */

const path = require('path');
const fs = require('fs');
const { BrowserWindow } = require('electron');
const { PPT_FIXED_IMAGE_MODEL } = require('../../shared/v2-stage-helpers');
const { generateDiagram } = require('../services/diagram.service');
const { resolveProviderConfig, createAiClientByConfig } = require('../api/provider-config');
const { InfographicCardService } = require('../services/infographic-card.service');

// ── 本地工具（不依赖运行时服务实例） ─────────────────────────────────────────

/**
 * 根据课程名/主题/内容关键词推断信息图风格标签
 * @returns {string} 逗号分隔的风格描述
 */
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

/** 为 Promise 附加超时，超时后抛出带标签的错误 */
function withTimeout(promise, ms, label) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 用隐藏的 BrowserWindow 将 HTML 渲染为 PNG Buffer
 *
 * Phase-9 C-2 修正（2026-05-09）：旧版 capturePage() 不传 rect，Windows 上会被
 * BrowserWindow chrome (~38px) + DPI 缩放截断 → HTML 真实 1790px 但 PNG 只有 1069px
 * 修复：useContentSize + 等 fonts.ready+1000ms + 强制 setContentSize + capturePage 显式 rect
 *
 * ⚠ 注意：src/main/index.js 也有同名函数，那份给老 framework 流程用，与本份独立。
 * 修一处必须同步另一处！本文件这份给 v2:generateFrameworkInfographic / v2:generateStageInfographic 用。
 */
async function renderHtmlToPngBuffer(html, width = 1000, height = 1400) {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,                 // 关键：width/height 指内容区，不含窗口 chrome
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: false, offscreen: false }
  });
  try {
    await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
    const contentSize = await withTimeout(win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const waitFonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        waitFonts.then(() => {
          // 1000ms 给 SVG/字体充足渲染时间（旧 300ms 不够）
          setTimeout(() => resolve({
            width: Math.ceil(document.documentElement.scrollWidth || document.body.scrollWidth || ${width}),
            height: Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || ${height})
          }), 1000);
        });
      });
    `), 20000, 'Infocard content size evaluation');

    const realW = Math.max(width, Number(contentSize?.width) || width);
    const realH = Math.max(height, Number(contentSize?.height) || height);

    // 强制 setContentSize（不论原始尺寸是否够大，都重设以触发 viewport reflow）
    win.setContentSize(realW, realH);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 显式 rect，避免 capturePage 默认截窗口可见区域导致下半截丢失
    const image = await withTimeout(
      win.webContents.capturePage({ x: 0, y: 0, width: realW, height: realH }),
      30000,
      'Infocard capture'
    );
    console.log(`[media-handlers renderHtmlToPngBuffer] requested=${width}x${height} content=${contentSize?.width}x${contentSize?.height} captured=${realW}x${realH}`);
    return image.toPNG();
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

// ── 注册入口 ──────────────────────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  // ── 信息图生成（v2 framework 阶段）────────────────────────────────────────

  // 生成课程模块信息图：AI 生成 HTML → 截图为 PNG → 写入工作区 + 素材库
  // Phase baoyu-B: 支持 layout（布局）和 visualStyle（视觉风格）参数
  ipcMain.handle('v2:generateFrameworkInfographic', async (event, payload = {}) => {
    const {
      db,
      ensureNotebookWorkspaceState,
      ensureNotebookWorkspaceDirs,
      infographicCardService
    } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
      if (!notebook) return { success: false, error: 'Notebook not found' };

      const topic = String(payload.topic || '教学模块信息图').trim();
      const content = String(payload.content || '').trim();
      if (!content) return { success: false, error: 'Infographic content is required' };

      const courseName = notebook.name || '课程';
      const autoStyle = inferInfocardStyle(courseName, topic, content);
      const style = String(payload.style || '').trim() || autoStyle;
      // Phase-5B: 将笔记本富上下文注入信息图 Prompt，提升具体性
      const softwareContext = notebook.softwareTools
        ? `本课使用软件/工具：${notebook.softwareTools}（卡片底部提示条请显示此信息）`
        : '';
      const jobContext = notebook.jobTargets
        ? `面向职业岗位：${notebook.jobTargets}`
        : '';

      // Phase baoyu-B: 使用增强版 prompt（支持 layout/visualStyle）
      const layout = String(payload.layout || 'grid_cards');
      const visualStyle = String(payload.visualStyle || 'professional');
      const promptFinal =
        String(payload.promptFinal || '').trim() ||
        infographicCardService.buildEnhancedPrompt({
          course_name: courseName,
          topic,
          content,
          style,
          software_context: softwareContext,
          job_context: jobContext,
          layout,
          visualStyle
        });

      const html = await infographicCardService.generateHtml({
        provider: payload.provider || 'ark',
        endpointId: payload.endpointId || null,
        promptFinal,
        layout,       // 传入布局类型，用于动态构建 system prompt
        visualStyle   // 传入视觉风格，用于动态构建 system prompt
      });
      const pngBuffer = await renderHtmlToPngBuffer(
        html,
        Number(payload.width) || 1000,
        Number(payload.height) || 1400
      );
      const saved = infographicCardService.saveArtifacts({
        html,
        pngBuffer,
        title: `${courseName}-${topic}`,
        notebookId
      });

      // 追加结构化标签到素材库
      if (saved.resourceId) {
        try {
          db.addResourceTags(saved.resourceId, [
            `课程:${courseName}`,
            `模块:${topic}`,
            `阶段:framework`,
            `用途:教学信息图`
          ]);
        } catch {}
      }

      const workspaceRoot = notebook.workspacePath || ensureNotebookWorkspaceDirs(notebook);
      const notebookInfoDir = path.join(workspaceRoot, 'framework', 'infographics');
      fs.mkdirSync(notebookInfoDir, { recursive: true });
      const workspaceImagePath = path.join(notebookInfoDir, path.basename(saved.imagePath));
      const workspaceHtmlPath = path.join(notebookInfoDir, path.basename(saved.htmlPath));
      fs.copyFileSync(saved.imagePath, workspaceImagePath);
      fs.copyFileSync(saved.htmlPath, workspaceHtmlPath);

      return {
        success: true,
        data: {
          notebookId,
          topic,
          promptFinal,
          layout,
          visualStyle,
          imagePath: saved.imagePath,
          htmlPath: saved.htmlPath,
          workspaceImagePath,
          workspaceHtmlPath,
          resourceId: saved.resourceId
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Phase-9（驭课 Agent v4.0.0）：通用阶段信息图生成
  // 给 design / lecture 等新阶段复用，不再绑死 framework 目录
  // ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('v2:generateStageInfographic', async (event, payload = {}) => {
    const {
      db,
      ensureNotebookWorkspaceState,
      ensureNotebookWorkspaceDirs,
      infographicCardService
    } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
      if (!notebook) return { success: false, error: 'Notebook not found' };

      const stage = String(payload.stage || 'design').trim();   // 'design' | 'lecture' | 'schedule' | ...
      const topic = String(payload.topic || `${stage} 信息图`).trim();
      const content = String(payload.content || '').trim();
      if (!content) return { success: false, error: '信息图正文（content）必填' };

      const courseName = notebook.name || '课程';
      const layout = String(payload.layout || 'magazine_module');
      const visualStyle = String(payload.visualStyle || 'magazine_module');

      const softwareContext = notebook.softwareTools
        ? `本课使用软件/工具：${notebook.softwareTools}（卡片底部提示条请显示此信息）`
        : '';
      const jobContext = notebook.jobTargets ? `面向职业岗位：${notebook.jobTargets}` : '';

      const promptFinal =
        String(payload.promptFinal || '').trim() ||
        infographicCardService.buildEnhancedPrompt({
          course_name: courseName,
          topic,
          content,
          style: payload.style || '',
          software_context: softwareContext,
          job_context: jobContext,
          layout,
          visualStyle
        });

      const html = await infographicCardService.generateHtml({
        provider: payload.provider || 'ark',
        endpointId: payload.endpointId || null,
        promptFinal,
        layout,
        visualStyle
      });
      const pngBuffer = await renderHtmlToPngBuffer(
        html,
        Number(payload.width) || 1000,
        Number(payload.height) || 1400
      );
      const saved = infographicCardService.saveArtifacts({
        html,
        pngBuffer,
        title: `${courseName}-${stage}-${topic}`,
        notebookId
      });

      // 阶段化保存路径：${workspace}/${stage}/infographics/
      const workspaceRoot = notebook.workspacePath || ensureNotebookWorkspaceDirs(notebook);
      const notebookInfoDir = path.join(workspaceRoot, stage, 'infographics');
      fs.mkdirSync(notebookInfoDir, { recursive: true });
      const workspaceImagePath = path.join(notebookInfoDir, path.basename(saved.imagePath));
      const workspaceHtmlPath = path.join(notebookInfoDir, path.basename(saved.htmlPath));
      fs.copyFileSync(saved.imagePath, workspaceImagePath);
      fs.copyFileSync(saved.htmlPath, workspaceHtmlPath);

      // 写一条 artifact，便于 ArtifactPanel 显示
      // Phase-9.5：sourceDesignArtifactId 关联本节视角信息图到具体的 design artifact（整门课视角为 null）
      const sourceDesignArtifactId = payload.sourceDesignArtifactId ? Number(payload.sourceDesignArtifactId) : null;
      const viewLevel = (layout === 'design_overview') ? 'course' : 'lesson';
      let artifactId = null;
      if (typeof db.createArtifact === 'function') {
        const a = db.createArtifact({
          notebookId,
          type: `${stage}_infographic`,
          stage,
          title: `${courseName}-${topic}（${layout}/${visualStyle}）`,
          content: {
            imagePath: workspaceImagePath, htmlPath: workspaceHtmlPath,
            layout, visualStyle, topic,
            // Phase-9.5：视角与节课关联（供前端筛选）
            viewLevel,                       // 'course' | 'lesson'
            sourceDesignArtifactId,          // 关联的 design artifact id（仅 lesson 视角有效）
          },
          format: 'png',
          status: 'generated',
          confirmed: false,
          storagePath: workspaceImagePath,
          previewText: path.basename(workspaceImagePath),
          sourceArtifactIds: sourceDesignArtifactId ? [sourceDesignArtifactId] : [],
        });
        artifactId = a?.id || null;
      }

      return {
        success: true,
        data: {
          notebookId,
          stage,
          topic,
          layout,
          visualStyle,
          imagePath: workspaceImagePath,
          htmlPath: workspaceHtmlPath,
          artifactId,
          resourceId: saved.resourceId
        }
      };
    } catch (error) {
      console.error('[v2:generateStageInfographic] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 标记某张信息图为"最终版"（导出时优先用）──────────────────────────────
  ipcMain.handle('v2:confirmStageInfographic', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const artifactId = Number(payload.artifactId);
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      if (!Number.isFinite(artifactId) || artifactId <= 0) return { success: false, error: 'artifactId 无效' };
      if (typeof db.updateArtifact !== 'function') return { success: false, error: 'db.updateArtifact 不存在' };

      // 同阶段同类型其他 infographic 取消 confirmed（保证只有一张是最终版）
      if (typeof db.listArtifacts === 'function') {
        const items = db.listArtifacts({ notebookId });
        const target = items.find((a) => a.id === artifactId);
        if (target) {
          items
            .filter((a) => a.type === target.type && a.stage === target.stage && a.confirmed && a.id !== artifactId)
            .forEach((a) => {
              try { db.updateArtifact(a.id, { confirmed: false, status: 'generated' }); } catch (_) {}
            });
        }
      }

      db.updateArtifact(artifactId, {
        confirmed: true,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });
      return { success: true, data: { notebookId, artifactId, confirmed: true } };
    } catch (error) {
      console.error('[v2:confirmStageInfographic] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── SVG 教学结构图生成（baoyu-diagram 思路）──────────────────────────────

  // 生成 SVG 矢量教学结构图，不消耗图像 token，速度快、精度高
  ipcMain.handle('v2:generateDiagram', async (event, payload = {}) => {
    const { db, ensureNotebookWorkspaceState, ensureNotebookWorkspaceDirs } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const notebook = notebookId ? ensureNotebookWorkspaceState(db.getNotebookById(notebookId)) : null;
      const modules = notebookId ? db.getModulesByNotebook(notebookId) : (payload.modules || []);
      const courseName = payload.courseName || notebook?.name || '课程';
      const diagramType = String(payload.diagramType || 'hierarchy');

      // 创建 AI 客户端
      const config = resolveProviderConfig({ payload, db });
      const aiClient = createAiClientByConfig(config);
      if (!aiClient) return { success: false, error: '未配置有效的 AI 客户端' };

      // 确定输出目录（工作区 framework/diagrams/）
      let outputDir = null;
      if (notebook) {
        const workspaceRoot = notebook.workspacePath || ensureNotebookWorkspaceDirs(notebook);
        outputDir = path.join(workspaceRoot, 'framework', 'diagrams');
      }

      // Phase-8.5：magazine 类型需要 courseContext 生成 description / jobs / tools / goal 等
      const courseContext = notebook ? {
        description: notebook.description || '',
        softwareTools: notebook.softwareTools || '',
        jobTargets: notebook.jobTargets || '',
        industryScenarios: notebook.industryScenarios || '',
        learnerProfile: notebook.learnerProfile || '',
        teachingMaterials: notebook.teachingMaterials || '',
        objectives: notebook.objectives || '',
        grade: notebook.audience || notebook.grade || ''
      } : {};

      const result = await generateDiagram({ aiClient, modules, courseName, diagramType, outputDir, courseContext });

      // 将 SVG 内容和路径写入工作区（同时保留 data URI 供前端预览）
      const svgDataUri = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(result.svg)}`;

      return {
        success: true,
        data: {
          notebookId,
          diagramType,
          svg: result.svg,
          svgPath: result.svgPath,
          svgDataUri,
          courseName
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 获取信息图布局/风格选项列表（供前端渲染选择器）
  ipcMain.handle('v2:getInfographicOptions', async () => {
    return {
      success: true,
      data: {
        layouts: InfographicCardService.getLayouts(),
        styles: InfographicCardService.getStyles()
      }
    };
  });

  // ── 图片版本管理 ───────────────────────────────────────────────────────────

  ipcMain.handle('images:listVersions', async (event, taskId) => {
    const { db, imageVersionService } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const items = imageVersionService.listImageVersions(taskId);
      return { success: true, data: items };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('images:regenerate', async (event, payload = {}) => {
    const { db, imageVersionService } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const item = imageVersionService.createImageVersion(
        payload.taskId,
        payload.promptFinal,
        {
          model: payload.model,
          imagePath: payload.imagePath,
          imageUrl: payload.imageUrl,
          status: payload.status || 'regenerate',
          sceneType: payload.sceneType,
          courseId: payload.courseId
        }
      );
      return { success: true, data: item };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 生成结构化图片（如 PPT 页面配图），并保存版本记录
  ipcMain.handle('images:generateStructured', async (event, payload = {}) => {
    const { db, imageGeneratorService, imageVersionService } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const generated = await imageGeneratorService.generateImage({
        promptFinal: payload.promptFinal,
        model: payload.model || 'seedream',
        sceneType: 'structured',
        notebookId: payload.courseId || payload.notebookId || null,
        taskId: payload.taskId || `structured-${Date.now()}`,
        size: payload.size
      });
      const version = imageVersionService.createImageVersion(
        generated.taskId,
        generated.promptFinal,
        {
          model: generated.model,
          sceneType: generated.sceneType,
          imagePath: generated.imagePath,
          imageUrl: generated.imageUrl,
          resourceId: generated.resourceId,
          status: 'generated'
        }
      );
      return { success: true, data: { ...generated, version } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 生成通用图片（PPT 场景使用固定模型，其他场景可自选）
  ipcMain.handle('images:generateGeneric', async (event, payload = {}) => {
    const { db, imageGeneratorService, imageVersionService } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const modelForGeneric = payload.useCase === 'ppt'
        ? (payload.model || PPT_FIXED_IMAGE_MODEL || 'seedream')
        : (payload.model || 'doubao_image');
      const generated = await imageGeneratorService.generateImage({
        promptFinal: payload.promptFinal,
        model: modelForGeneric,
        sceneType: 'generic',
        notebookId: payload.courseId || payload.notebookId || null,
        taskId: payload.taskId || `generic-${Date.now()}`,
        size: payload.size
      });
      const version = imageVersionService.createImageVersion(
        generated.taskId,
        generated.promptFinal,
        {
          model: generated.model,
          sceneType: generated.sceneType,
          imagePath: generated.imagePath,
          imageUrl: generated.imageUrl,
          resourceId: generated.resourceId,
          status: 'generated'
        }
      );
      return { success: true, data: { ...generated, version } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('images:rollbackVersion', async (event, payload = {}) => {
    const { db, imageVersionService } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const versionRef = payload.version ?? payload.versionId ?? payload.versionNumber ?? payload.id;
      const item = imageVersionService.rollbackImageVersion(payload.taskId, versionRef);
      return { success: true, data: item };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── 视频生成 ───────────────────────────────────────────────────────────────

  ipcMain.handle('videos:generateT2V', async (event, payload = {}) => {
    const { db, videoGeneratorService } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const generated = await videoGeneratorService.generateVideo({
        prompt: payload.prompt,
        notebookId: payload.notebookId || payload.courseId || null,
        model: payload.model || 'doubao-seedance-2.0-pro',
        durationSec: payload.durationSec || 60,
        segmentDurationSec: payload.segmentDurationSec || 0,
        withBgm: typeof payload.withBgm === 'boolean' ? payload.withBgm : true,
        startFramePath: payload.startFramePath || '',
        startFrameUrl: payload.startFrameUrl || '',
        endFramePath: payload.endFramePath || '',
        endFrameUrl: payload.endFrameUrl || ''
      });
      return { success: true, data: generated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
