/**
 * 系统级 handlers — 7 个 IPC handlers
 *
 * 处理的 channel：
 *   schedule:get, schedule:save（教学进度表）
 *   settings:saveApiKey, settings:getApiKey（API 密钥）
 *   util:openExternalUrl（外部链接）
 *   workspace:getNotebookRoot, workspace:openNotebookRoot（工作区目录）
 *
 * 直接 require（稳定依赖）：
 *   path, electron { app, shell }
 *
 * 运行时依赖（通过 getDeps 惰性获取）：
 *   { db, patchCourseProject, ensureNotebookWorkspaceState, ensureNotebookWorkspaceDirs }
 *
 * 本地工具（从 index.js 提取，纯函数）：
 *   normalizeScheduleInput, getTeacherWorkspaceRoot
 */

const path = require('path');
const { app, shell, net } = require('electron');
const mammoth = require('mammoth');

// ── URL 文本提取工具（纯函数） ───────────────────────────────────────────────────

/**
 * 发起 HTTP/HTTPS GET 请求，返回响应文本
 * 使用 Electron net 模块（Chromium 网络栈），兼容 CDN/反爬站点
 * 自动跟随重定向，超时 15 秒，内容上限 500KB
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    const request = net.request({
      url,
      method: 'GET',
      redirect: 'follow'
    });

    // 使用真实 Chrome User-Agent，避免被 CDN 拦截
    request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    request.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
    request.setHeader('Cache-Control', 'no-cache');

    const timer = setTimeout(() => {
      try { request.abort(); } catch (_) {}
      done(reject, new Error('请求超时（15秒）'));
    }, 15000);

    request.on('response', (response) => {
      clearTimeout(timer);
      if (response.statusCode !== 200) {
        done(reject, new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let totalSize = 0;
      response.on('data', (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
        if (totalSize > 500 * 1024) {
          // 超过 500KB 截断，已足够提取文本
          done(resolve, Buffer.concat(chunks).toString('utf8'));
        }
      });
      response.on('end', () => done(resolve, Buffer.concat(chunks).toString('utf8')));
      response.on('error', (e) => done(reject, e));
    });

    request.on('error', (e) => { clearTimeout(timer); done(reject, e); });
    request.end();
  });
}

/**
 * 从 HTML 字符串中提取可读文本（去标签、去脚本/样式）
 * 返回最多 3000 字（避免 prompt 过长）
 */
function extractTextFromHtml(html, maxChars = 3000) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[\s]{3,}/g, '\n')
    .trim();
  // 优先保留前 maxChars 字内容
  return text.length > maxChars ? text.slice(0, maxChars) + '…（已截断至 3000 字）' : text;
}

// ── 本地工具（纯函数） ─────────────────────────────────────────────────────────

/**
 * 验证并规范化教学进度表数组，确保每条目有 topic 和正值 hours
 * @param {Array} schedule
 * @returns {Array<{ week, topic, hours, methods, assignment }>}
 */
function normalizeScheduleInput(schedule) {
  const list = Array.isArray(schedule) ? schedule : [];
  return list.map((item, index) => {
    const week = Number(item?.week) || index + 1;
    const topic = String(item?.topic || '').trim();
    const hours = Number(item?.hours) || 0;
    const methods = String(item?.methods || '').trim();
    const assignment = String(item?.assignment || '').trim();
    if (!topic) throw new Error(`Schedule item ${index + 1} is missing topic`);
    if (hours <= 0) throw new Error(`第 ${index + 1} 条进度表时长必须大于 0`);
    return { week, topic, hours, methods, assignment };
  });
}

/** 返回教师工作区根目录路径 */
function getTeacherWorkspaceRoot() {
  return path.join(app.getPath('documents'), '课程开发助手工作区');
}

// ── 注册入口 ──────────────────────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  // ── 教学进度表 ─────────────────────────────────────────────────────────────

  ipcMain.handle('schedule:get', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const schedule = db.getTeachingSchedule(notebookId);
      return { success: true, data: schedule };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('schedule:save', async (event, { notebookId, schedule }) => {
    const { db, patchCourseProject } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const normalized = normalizeScheduleInput(schedule);
      const saved = db.saveTeachingSchedule(notebookId, normalized);
      patchCourseProject(notebookId, {
        schedule: normalized,
        dirty: true,
        dirtyReason: 'schedule-updated',
        dirtyAt: new Date().toISOString()
      });
      return { success: true, data: saved };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── API 密钥管理 ───────────────────────────────────────────────────────────

  ipcMain.handle('settings:saveApiKey', async (event, { provider, apiKey }) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      db.saveApiKey(provider, apiKey);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:getApiKey', async (event, provider) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const apiKey = db.getApiKey(provider);
      return { success: true, data: apiKey };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── 外部链接 ───────────────────────────────────────────────────────────────

  ipcMain.handle('util:openExternalUrl', async (event, url) => {
    try {
      const target = String(url || '').trim();
      if (!/^https?:\/\//i.test(target)) {
        return { success: false, error: 'invalid url' };
      }
      await shell.openExternal(target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── 工作区目录 ─────────────────────────────────────────────────────────────

  // 获取笔记本工作区根路径（并确保目录已创建）
  ipcMain.handle('workspace:getNotebookRoot', async (event, notebookId) => {
    const { db, ensureNotebookWorkspaceState, ensureNotebookWorkspaceDirs } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebook = ensureNotebookWorkspaceState(db.getNotebookById(Number(notebookId)));
      if (!notebook) return { success: false, error: 'Notebook not found' };
      return {
        success: true,
        data: {
          rootPath: notebook.workspacePath || ensureNotebookWorkspaceDirs(notebook),
          docsRoot: getTeacherWorkspaceRoot()
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── 参考资料：URL 文本提取 ─────────────────────────────────────────────────────
  // 抓取公开网页内容，去除 HTML 标签后返回纯文本供老师注入讲稿生成
  ipcMain.handle('system:fetchUrlContent', async (event, url) => {
    try {
      const target = String(url || '').trim();
      if (!/^https?:\/\//i.test(target)) {
        return { success: false, error: '请输入完整 URL（以 http:// 或 https:// 开头）' };
      }
      const html = await httpGet(target);
      const text = extractTextFromHtml(html, 3000);
      if (text.length < 50) {
        return { success: false, error: '页面内容过少，可能需要登录或不支持直接读取' };
      }
      return { success: true, data: { text, charCount: text.length, url: target } };
    } catch (error) {
      return {
        success: false,
        error: `${error.message}（该页面可能需要登录，请手动复制内容粘贴）`
      };
    }
  });

  // ── 参考资料：.docx 教案解析 ──────────────────────────────────────────────────
  // 接受 base64 编码的 .docx 文件内容，用 mammoth 提取纯文本
  ipcMain.handle('system:readDocxContent', async (event, { base64, filename }) => {
    try {
      if (!base64) return { success: false, error: '文件内容为空' };
      const buffer = Buffer.from(base64, 'base64');
      // mammoth 提取纯文本（忽略格式，只要文字）
      const result = await mammoth.extractRawText({ buffer });
      const raw = String(result.value || '').trim();
      if (raw.length < 20) {
        return { success: false, error: '文档内容过少或格式不支持' };
      }
      // 截取前 5000 字
      const text = raw.length > 5000 ? raw.slice(0, 5000) + '…（已截断至 5000 字）' : raw;
      return {
        success: true,
        data: { text, charCount: text.length, filename: String(filename || '文档') }
      };
    } catch (error) {
      return { success: false, error: `解析失败：${error.message}` };
    }
  });

  // 用系统文件管理器打开笔记本工作区目录
  ipcMain.handle('workspace:openNotebookRoot', async (event, notebookId) => {
    const { db, ensureNotebookWorkspaceState } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebook = ensureNotebookWorkspaceState(db.getNotebookById(Number(notebookId)));
      if (!notebook?.workspacePath) {
        return { success: false, error: 'Notebook workspace not found' };
      }
      const result = await shell.openPath(notebook.workspacePath);
      if (result) return { success: false, error: result };
      return { success: true, data: { rootPath: notebook.workspacePath } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
