/**
 * 导出 handlers — 9 个 IPC handlers
 *
 * 处理的 channel：
 *   word:exportNotebook, word:exportDiscussion, word:exportLecture,
 *   ppt:exportCourse, quiz:export, interactive:exportHtml,
 *   pbl:exportPack, framework:exportMerged,
 *   v2:exportKnowledgeCards（知识点卡片 HTML 导出，baoyu-image-cards 思路）
 *
 * 直接 require（稳定依赖）：
 *   path, fs, electron, ../export/* 各模块
 *
 * 运行时依赖（通过 getDeps 惰性获取）：
 *   { db, exportRuntime, createTrackedArtifact, resolveArtifactByRefOrLatest,
 *     buildFrameworkPublicationBundle, buildLecturePublicationBundle,
 *     buildPptPublicationBundle, mainWindow }
 *
 * 本地工具函数（从 index.js 提取，纯函数，不依赖运行时状态）：
 *   IMAGE_MIME_MAP, toPdfImageSrc, markdownToHtml
 */

const path = require('path');
const fs = require('fs');
const { BrowserWindow, dialog } = require('electron');
const { exportNotebookWord, exportDiscussionWord, exportLectureWord } = require('../export/word');
const {
  exportFrameworkMarkdown,
  exportDiscussionMarkdown
} = require('../export/markdown');
const { exportQuiz } = require('../export/quiz');
const { exportInteractiveHtml } = require('../export/interactive-html');
const { exportPblPack } = require('../export/pbl-pack');
const { exportCoursePpt } = require('../export/ppt');
const { exportKnowledgeCards } = require('../export/knowledge-cards');
const { exportInteractiveKnowledgeCards } = require('../export/knowledge-cards-interactive');  // Phase-7.7 A3-C：互动测试卡片

// ── 本地工具函数（纯函数，可直接 require，无运行时状态依赖） ────────────────

const IMAGE_MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp'
};

/** 将本地图片路径转换为 PDF 可嵌入的 data URI，远程 URL 直接透传 */
function toPdfImageSrc(srcRaw) {
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
}

/** 将 Markdown 文本转为简单 HTML，供 BrowserWindow.printToPDF 渲染 */
function markdownToHtml(markdownText) {
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
}

// ── 注册入口 ──────────────────────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  /** 获取聚焦窗口或回退到主窗口，作为 dialog 的父窗口 */
  function getWin() {
    const { mainWindow } = getDeps();
    return BrowserWindow.getFocusedWindow() || mainWindow;
  }

  /**
   * 保证文件路径带正确扩展名。
   * showSaveDialog 的 extensions 过滤器只是提示，当文件名含 "." 时（如 "课程2.1"）
   * Windows 会把最后一段当扩展名，导致保存时缺少正确后缀。
   * @param {string} filePath
   * @param {string} ext  不带点，如 'docx' / 'pptx'
   */
  function ensureExt(filePath, ext) {
    const dotExt = `.${ext.toLowerCase()}`;
    return filePath.toLowerCase().endsWith(dotExt) ? filePath : filePath + dotExt;
  }

  // ── Word 导出 ──────────────────────────────────────────────────────────────

  // 导出笔记本教学设计为 Word（framework 阶段）
  ipcMain.handle('word:exportNotebook', async (event, notebookId) => {
    const { db, exportRuntime, createTrackedArtifact, resolveArtifactByRefOrLatest } = getDeps();
    return exportRuntime.run({
      notebookId: Number(notebookId),
      stage: 'framework',
      format: 'docx',
      variant: 'notebook-word'
    }, async () => {
      if (!db) throw new Error('Database not initialized');
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const modules = db.getModulesByNotebook(notebookId);
      const schedule = db.getTeachingSchedule(notebookId);
      const framework = db.getCurrentFramework(notebookId);
      const picked = await dialog.showSaveDialog(getWin(), {
        title: '导出教学设计 Word',
        defaultPath: `${notebook.name || '课程教学设计'}.docx`,
        filters: [{ name: 'Word Document', extensions: ['docx'] }]
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };
      const filePath = await exportNotebookWord({ notebook, modules, schedule, framework, outputPath: ensureExt(picked.filePath, 'docx') });
      const artifact = createTrackedArtifact(Number(notebookId), {
        type: 'framework_export_word',
        stage: 'framework',
        title: `${notebook.name || '课程'}-教学设计Word导出`,
        content: { filePath },
        format: 'docx',
        status: 'exported',
        confirmed: true,
        storagePath: filePath,
        previewText: path.basename(filePath),
        sourceArtifactIds: [
          resolveArtifactByRefOrLatest(Number(notebookId), 'frameworkJsonId', 'framework_json', 'framework')?.id,
          resolveArtifactByRefOrLatest(Number(notebookId), 'frameworkPreviewId', 'framework_preview_md', 'framework')?.id
        ].filter(Boolean),
        sourceRefs: [{ kind: 'file', ref: filePath, label: 'notebook-word-export' }]
      });
      return { data: { filePath }, eventArtifactId: artifact?.id || null, eventPayload: { filePath } };
    });
  });

  // 导出讨论稿为 Word
  ipcMain.handle('word:exportDiscussion', async (event, payload = {}) => {
    const { db, exportRuntime, createTrackedArtifact } = getDeps();
    const notebookId = Number(payload.notebookId);
    return exportRuntime.run({
      notebookId,
      stage: 'framework',
      format: 'docx',
      variant: 'discussion-word'
    }, async () => {
      if (!db) throw new Error('Database not initialized');
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const picked = await dialog.showSaveDialog(getWin(), {
        title: '导出讨论稿 Word',
        defaultPath: `${notebook.name || '讨论稿'}.docx`,
        filters: [{ name: 'Word Document', extensions: ['docx'] }]
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };
      const filePath = await exportDiscussionWord({
        notebook,
        discussionDraft: payload.discussionDraft || '',
        comments: Array.isArray(payload.comments) ? payload.comments : [],
        outputPath: ensureExt(picked.filePath, 'docx')
      });
      const artifact = createTrackedArtifact(notebookId, {
        type: 'discussion_export_word',
        stage: 'framework',
        title: `${notebook.name || '课程'}-讨论稿Word导出`,
        content: { filePath },
        format: 'docx',
        status: 'exported',
        confirmed: true,
        storagePath: filePath,
        previewText: path.basename(filePath),
        sourceRefs: [{ kind: 'file', ref: filePath, label: 'discussion-word-export' }]
      });
      return { data: { filePath }, eventArtifactId: artifact?.id || null, eventPayload: { filePath } };
    });
  });

  // 导出正式讲课稿为 Word（lecture 阶段，含出版校验）
  ipcMain.handle('word:exportLecture', async (event, payload = {}) => {
    const { db, exportRuntime, createTrackedArtifact, buildLecturePublicationBundle } = getDeps();
    const notebookId = Number(payload.notebookId);
    if (!db) return { success: false, error: 'Database not initialized' };
    const publication = buildLecturePublicationBundle(notebookId, payload);
    return exportRuntime.run({
      notebookId,
      stage: 'lecture',
      format: 'docx',
      variant: 'lecture-word',
      blockingIssues: publication.blockingIssues
    }, async () => {
      if (!db) throw new Error('Database not initialized');
      const { notebook } = publication;
      const picked = await dialog.showSaveDialog(getWin(), {
        title: '导出正式讲课稿 Word',
        defaultPath: `${notebook.name || '正式讲课稿'}.docx`,
        filters: [{ name: 'Word Document', extensions: ['docx'] }]
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };
      const filePath = await exportLectureWord({
        notebook,
        lectureTitle: publication.lectureTitle,
        lectureScript: publication.finalScript,
        mergeReport: publication.mergeReport,
        outputPath: ensureExt(picked.filePath, 'docx')
      });
      const artifact = createTrackedArtifact(notebookId, {
        type: 'lecture_export_word',
        stage: 'lecture',
        title: `${notebook.name || '课程'}-讲稿Word导出`,
        content: {
          filePath,
          lectureTitle: publication.lectureTitle,
          lectureFinalArtifactId: publication.lectureFinalArtifact?.id || null
        },
        format: 'docx',
        status: publication.reviewFlags.length ? 'review_needed' : 'exported',
        confirmed: true,
        storagePath: filePath,
        previewText: path.basename(filePath),
        sourceArtifactIds: publication.sourceArtifactIds,
        validationResults: publication.validationResults,
        reviewFlags: publication.reviewFlags,
        sourceRefs: [...publication.sourceRefs, { kind: 'file', ref: filePath, label: 'lecture-docx-export' }]
      });
      return {
        data: { filePath },
        eventArtifactId: artifact?.id || null,
        eventPayload: { filePath, reviewNeeded: publication.reviewFlags.length > 0 }
      };
    });
  });

  // ── PPT 导出 ───────────────────────────────────────────────────────────────

  // 导出课程 PPT（ppt 阶段，含出版校验）
  ipcMain.handle('ppt:exportCourse', async (event, payload = {}) => {
    const { db, exportRuntime, createTrackedArtifact, buildPptPublicationBundle } = getDeps();
    const notebookId = Number(payload.notebookId);
    if (!db) return { success: false, error: 'Database not initialized' };
    const publication = buildPptPublicationBundle(notebookId, payload);
    return exportRuntime.run({
      notebookId,
      stage: 'ppt',
      format: 'pptx',
      variant: 'course-ppt',
      blockingIssues: publication.blockingIssues
    }, async () => {
      if (!db) throw new Error('Database not initialized');
      const { notebook } = publication;
      const picked = await dialog.showSaveDialog(getWin(), {
        title: '导出课程PPT',
        defaultPath: `${notebook.name || '课程课件'}.pptx`,
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };
      const filePath = await exportCoursePpt({
        notebook: publication.notebook,
        framework: publication.framework,
        modules: publication.modules,
        lectureScript: publication.lectureScript,
        pptOutline: publication.pptOutline,
        pptPages: publication.pptPages,
        templateBackground: publication.templateBackground,
        templateKey: publication.templateKey,
        outputPath: ensureExt(picked.filePath, 'pptx')
      });
      const artifact = createTrackedArtifact(notebookId, {
        type: 'ppt_export_file',
        stage: 'ppt',
        title: `${notebook.name || '课程'}-PPT导出`,
        content: {
          filePath,
          templateKey: publication.templateKey,
          pptOutlineArtifactId: publication.outlineArtifact?.id || null
        },
        format: 'pptx',
        status: publication.reviewFlags.length ? 'review_needed' : 'exported',
        confirmed: true,
        storagePath: filePath,
        previewText: path.basename(filePath),
        sourceArtifactIds: publication.sourceArtifactIds,
        validationResults: publication.validationResults,
        reviewFlags: publication.reviewFlags,
        sourceRefs: [...publication.sourceRefs, { kind: 'file', ref: filePath, label: 'ppt-export' }]
      });
      return {
        data: { filePath },
        eventArtifactId: artifact?.id || null,
        eventPayload: { filePath, reviewNeeded: publication.reviewFlags.length > 0 }
      };
    });
  });

  // ── 其他格式导出 ──────────────────────────────────────────────────────────

  // 导出课堂测验（md/json/html 三种格式）
  ipcMain.handle('quiz:export', async (event, payload = {}) => {
    const { db, exportRuntime, createTrackedArtifact } = getDeps();
    const notebookId = Number(payload.notebookId);
    const format = String(payload.format || 'md').toLowerCase();
    return exportRuntime.run({
      notebookId,
      stage: 'framework',
      format,
      variant: 'quiz-export'
    }, async () => {
      if (!db) throw new Error('Database not initialized');
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const coursePipeline = notebook.courseProject?.sceneBundle || notebook.coursePipeline || {};
      const ext = format === 'json' ? 'json' : (format === 'html' ? 'html' : 'md');
      const picked = await dialog.showSaveDialog(getWin(), {
        title: '导出课堂测验',
        defaultPath: `${notebook.name || '课程'}-课堂测验.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };
      const filePath = exportQuiz({ notebook, coursePipeline, outputPath: picked.filePath, format });
      const artifact = createTrackedArtifact(notebookId, {
        type: 'quiz_export_file',
        stage: 'framework',
        title: `${notebook.name || '课程'}-课堂测验导出`,
        content: { filePath, format },
        format: ext,
        status: 'exported',
        confirmed: true,
        storagePath: filePath,
        previewText: path.basename(filePath),
        sourceRefs: [
          { kind: 'workflow', ref: String(notebookId), label: 'quiz-workflow' },
          { kind: 'file', ref: filePath, label: 'quiz-export' }
        ]
      });
      return { data: { filePath }, eventArtifactId: artifact?.id || null, eventPayload: { filePath } };
    });
  });

  // 导出互动 HTML 内容包
  ipcMain.handle('interactive:exportHtml', async (event, payload = {}) => {
    const { db, exportRuntime, createTrackedArtifact } = getDeps();
    const notebookId = Number(payload.notebookId);
    return exportRuntime.run({
      notebookId,
      stage: 'framework',
      format: 'html',
      variant: 'interactive-html'
    }, async () => {
      if (!db) throw new Error('Database not initialized');
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const coursePipeline = notebook.courseProject?.sceneBundle || notebook.coursePipeline || {};
      const picked = await dialog.showSaveDialog(getWin(), {
        title: '导出互动 HTML',
        defaultPath: `${notebook.name || '课程'}-互动内容包.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }]
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };
      const filePath = exportInteractiveHtml({ notebook, coursePipeline, outputPath: picked.filePath });
      const artifact = createTrackedArtifact(notebookId, {
        type: 'interactive_export_file',
        stage: 'framework',
        title: `${notebook.name || '课程'}-互动内容包导出`,
        content: { filePath, format: 'html' },
        format: 'html',
        status: 'exported',
        confirmed: true,
        storagePath: filePath,
        previewText: path.basename(filePath),
        sourceRefs: [
          { kind: 'workflow', ref: String(notebookId), label: 'interactive-workflow' },
          { kind: 'file', ref: filePath, label: 'interactive-export' }
        ]
      });
      return { data: { filePath }, eventArtifactId: artifact?.id || null, eventPayload: { filePath } };
    });
  });

  // 导出 PBL 项目任务包（Markdown）
  ipcMain.handle('pbl:exportPack', async (event, payload = {}) => {
    const { db, exportRuntime, createTrackedArtifact } = getDeps();
    const notebookId = Number(payload.notebookId);
    return exportRuntime.run({
      notebookId,
      stage: 'framework',
      format: 'md',
      variant: 'pbl-pack'
    }, async () => {
      if (!db) throw new Error('Database not initialized');
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const coursePipeline = notebook.courseProject?.sceneBundle || notebook.coursePipeline || {};
      const picked = await dialog.showSaveDialog(getWin(), {
        title: '导出 PBL 项目任务包',
        defaultPath: `${notebook.name || '课程'}-PBL项目任务包.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };
      const filePath = exportPblPack({ notebook, coursePipeline, outputPath: picked.filePath });
      const artifact = createTrackedArtifact(notebookId, {
        type: 'pbl_export_file',
        stage: 'framework',
        title: `${notebook.name || '课程'}-PBL任务包导出`,
        content: { filePath, format: 'md' },
        format: 'md',
        status: 'exported',
        confirmed: true,
        storagePath: filePath,
        previewText: path.basename(filePath),
        sourceRefs: [
          { kind: 'workflow', ref: String(notebookId), label: 'pbl-workflow' },
          { kind: 'file', ref: filePath, label: 'pbl-export' }
        ]
      });
      return { data: { filePath }, eventArtifactId: artifact?.id || null, eventPayload: { filePath } };
    });
  });

  // 导出框架合并确认稿（支持 md / docx / pdf 三种格式）
  ipcMain.handle('framework:exportMerged', async (event, payload = {}) => {
    const { db, exportRuntime, createTrackedArtifact, buildFrameworkPublicationBundle } = getDeps();
    const notebookId = Number(payload.notebookId);
    const format = String(payload.format || 'md').toLowerCase();
    const discussionDraft = String(payload.discussionDraft || '');
    if (!db) return { success: false, error: 'Database not initialized' };
    const publication = buildFrameworkPublicationBundle(notebookId, {
      discussionDraft,
      structureSlots: payload.structureSlots
    });
    return exportRuntime.run({
      notebookId,
      stage: 'framework',
      format,
      variant: 'framework-merged',
      blockingIssues: publication.blockingIssues
    }, async () => {
      if (!db) throw new Error('Database not initialized');
      const {
        notebook,
        structureSlots,
        mergedDraft,
        resolvedMarkdown,
        sourceArtifactIds,
        validationResults,
        reviewFlags,
        sourceRefs
      } = publication;
      const win = getWin();

      if (format === 'docx') {
        const picked = await dialog.showSaveDialog(win, {
          title: '导出课程教学设计 Word',
          defaultPath: `${notebook.name || '课程教学设计'}.docx`,
          filters: [{ name: 'Word Document', extensions: ['docx'] }]
        });
        if (picked.canceled || !picked.filePath) return { cancelled: true };
        const filePath = await exportNotebookWord({
          notebook,
          modules: publication.modules || [],
          schedule: publication.schedule || [],
          framework: publication.framework || {},
          outputPath: ensureExt(picked.filePath, 'docx')
        });
        const artifact = createTrackedArtifact(notebookId, {
          notebookId,
          type: 'framework_export_file',
          stage: 'framework',
          title: `${notebook.name || '课程'}-框架确认稿导出`,
          content: { filePath, format: 'docx' },
          format: 'docx',
          status: reviewFlags.length ? 'review_needed' : 'exported',
          confirmed: true,
          storagePath: filePath,
          previewText: path.basename(filePath),
          sourceArtifactIds,
          validationResults,
          reviewFlags,
          sourceRefs: [...sourceRefs, { kind: 'file', ref: filePath, label: 'framework-docx-export' }]
        });
        return {
          data: { filePath },
          eventArtifactId: artifact?.id || null,
          eventPayload: { filePath, reviewNeeded: reviewFlags.length > 0 }
        };
      }

      if (format === 'pdf') {
        const picked = await dialog.showSaveDialog(win, {
          title: '导出合并确认稿 PDF',
          defaultPath: `${notebook.name || '教学设计确认稿'}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        });
        if (picked.canceled || !picked.filePath) return { cancelled: true };
        const html = markdownToHtml(resolvedMarkdown);
        const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
        await pdfWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
        const buffer = await pdfWindow.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true
        });
        fs.writeFileSync(picked.filePath, buffer);
        pdfWindow.destroy();
        const artifact = createTrackedArtifact(notebookId, {
          notebookId,
          type: 'framework_export_file',
          stage: 'framework',
          title: `${notebook.name || '课程'}-框架确认稿导出`,
          content: { filePath: picked.filePath, format: 'pdf' },
          format: 'pdf',
          status: reviewFlags.length ? 'review_needed' : 'exported',
          confirmed: true,
          storagePath: picked.filePath,
          previewText: path.basename(picked.filePath),
          sourceArtifactIds,
          validationResults,
          reviewFlags,
          sourceRefs: [...sourceRefs, { kind: 'file', ref: picked.filePath, label: 'framework-pdf-export' }]
        });
        return {
          data: { filePath: picked.filePath },
          eventArtifactId: artifact?.id || null,
          eventPayload: { filePath: picked.filePath, reviewNeeded: reviewFlags.length > 0 }
        };
      }

      // 默认：Markdown 格式
      const picked = await dialog.showSaveDialog(win, {
        title: '导出合并确认稿 Markdown',
        defaultPath: `${notebook.name || '教学设计确认稿'}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };
      const filePath = discussionDraft.trim()
        ? exportDiscussionMarkdown({
          discussionDraft,
          structureSlots,
          outputPath: picked.filePath
        })
        : exportFrameworkMarkdown({
          notebook,
          framework: publication.framework,
          modules: publication.modules,
          schedule: publication.schedule,
          outputPath: picked.filePath
        });
      const artifact = createTrackedArtifact(notebookId, {
        notebookId,
        type: 'framework_export_file',
        stage: 'framework',
        title: `${notebook.name || '课程'}-框架确认稿导出`,
        content: { filePath, format: 'md' },
        format: 'md',
        status: reviewFlags.length ? 'review_needed' : 'exported',
        confirmed: true,
        storagePath: filePath,
        previewText: path.basename(filePath),
        sourceArtifactIds,
        validationResults,
        reviewFlags,
        sourceRefs: [...sourceRefs, { kind: 'file', ref: filePath, label: 'framework-md-export' }]
      });
      return {
        data: { filePath },
        eventArtifactId: artifact?.id || null,
        eventPayload: { filePath, reviewNeeded: reviewFlags.length > 0 }
      };
    });
  });
  // ── 知识点卡片导出（baoyu-image-cards 思路）──────────────────────────────

  // 将课程所有模块的知识点生成精美 HTML 卡片汇总页，可在浏览器打印/截图
  ipcMain.handle('v2:exportKnowledgeCards', async (event, payload = {}) => {
    const { db, exportRuntime, createTrackedArtifact } = getDeps();
    const notebookId = Number(payload.notebookId);
    return exportRuntime.run({
      notebookId,
      stage: 'framework',
      format: 'html',
      variant: 'knowledge-cards'
    }, async () => {
      if (!db) throw new Error('Database not initialized');
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const modules = db.getModulesByNotebook(notebookId);
      if (!modules || modules.length === 0) {
        return { success: false, error: '该课程暂无模块数据，请先生成教学框架' };
      }

      const picked = await dialog.showSaveDialog(getWin(), {
        title: '导出知识点卡片',
        defaultPath: `${notebook.name || '课程'}-知识点卡片.html`,
        filters: [{ name: 'HTML 网页', extensions: ['html'] }]
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };

      const filePath = exportKnowledgeCards({
        notebook,
        modules,
        outputPath: ensureExt(picked.filePath, 'html'),
        style: String(payload.style || 'professional')
      });

      const artifact = createTrackedArtifact(notebookId, {
        type: 'knowledge_cards_export',
        stage: 'framework',
        title: `${notebook.name || '课程'}-知识点卡片导出`,
        content: { filePath, style: payload.style || 'professional' },
        format: 'html',
        status: 'exported',
        confirmed: true,
        storagePath: filePath,
        previewText: path.basename(filePath),
        sourceRefs: [{ kind: 'file', ref: filePath, label: 'knowledge-cards-export' }]
      });

      return {
        data: { filePath },
        eventArtifactId: artifact?.id || null,
        eventPayload: { filePath }
      };
    });
  });

  // Phase-7.7 A3-C（2026-04-30）：互动测试卡片导出
  // 区别于上方静态版（v2:exportKnowledgeCards）：互动版含翻卡 / 学习标记 / 自检小测 / 进度追踪
  // 老师可在课堂用大屏展示让学生互动，或下发给学生在课后手机/电脑上自学测试
  ipcMain.handle('v2:exportInteractiveCards', async (event, payload = {}) => {
    const { db, exportRuntime, createTrackedArtifact } = getDeps();
    const notebookId = Number(payload.notebookId);
    return exportRuntime.run({
      notebookId,
      stage: 'framework',
      format: 'html',
      variant: 'interactive-cards'
    }, async () => {
      if (!db) throw new Error('Database not initialized');
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const modules = db.getModulesByNotebook(notebookId);
      if (!modules || modules.length === 0) {
        return { success: false, error: '该课程暂无模块数据，请先生成教学框架' };
      }
      // 检查每个模块至少有一个知识点
      const totalKp = modules.reduce((acc, m) => acc + (Array.isArray(m.knowledgePoints || m.keyPoints) ? (m.knowledgePoints || m.keyPoints).length : 0), 0);
      if (totalKp === 0) {
        return { success: false, error: '所有模块都没有知识点，请先在框架阶段补充知识点' };
      }

      const picked = await dialog.showSaveDialog(getWin(), {
        title: '导出互动测试卡片（学生端）',
        defaultPath: `${notebook.name || '课程'}-互动测试卡片.html`,
        filters: [{ name: 'HTML 网页', extensions: ['html'] }]
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };

      const filePath = exportInteractiveKnowledgeCards({
        notebook,
        modules,
        outputPath: ensureExt(picked.filePath, 'html')
      });

      const artifact = createTrackedArtifact(notebookId, {
        type: 'interactive_cards_export',
        stage: 'framework',
        title: `${notebook.name || '课程'}-互动测试卡片导出`,
        content: { filePath },
        format: 'html',
        status: 'exported',
        confirmed: true,
        storagePath: filePath,
        previewText: path.basename(filePath),
        sourceRefs: [{ kind: 'file', ref: filePath, label: 'interactive-cards-export' }]
      });

      return {
        data: { filePath },
        eventArtifactId: artifact?.id || null,
        eventPayload: { filePath }
      };
    });
  });
}

module.exports = { register };
