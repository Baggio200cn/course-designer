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
const { app, shell, net, BrowserWindow } = require('electron');
const mammoth = require('mammoth');

// Phase-8 M0+（2026-05-02）：URL 抓取改走统一 web-extractor service
// 该 service 封装了 4 层策略：站点专属 → httpGet+Defuddle → BrowserWindow+Defuddle → 兜底
// 详见 src/main/services/web-extractor.service.js 顶部注释
const webExtractor = require('../services/web-extractor.service');

/**
 * @deprecated Phase-8 M0+ 起此函数仅作为 web-extractor 不可用时的兜底
 * Phase-7.7 D4（2026-04-30）：用隐藏 BrowserWindow 抓取 SPA 网站
 *
 * @param {string} url
 * @returns {Promise<string>} 页面渲染后的纯文本（最多 8000 字）
 */
async function fetchUrlContentWithBrowser(url) {
  return new Promise((resolve, reject) => {
    let win = null;
    let settled = false;

    const cleanup = () => {
      try {
        if (win && !win.isDestroyed()) {
          win.destroy();
          win = null;
        }
      } catch {}
    };
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(val);
    };

    // 30 秒总超时（含加载 + 等待 JS 渲染）
    const timer = setTimeout(() => done(reject, new Error('页面加载超时（30秒）')), 30000);

    try {
      win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          // 拒绝弹窗 / 自动播放等干扰
          backgroundThrottling: false,
        },
      });

      win.webContents.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );

      // 关闭弹窗、新窗口跳转
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      let loadFinished = false;

      win.webContents.on('did-finish-load', async () => {
        if (loadFinished) return;
        loadFinished = true;
        try {
          // 等 2.5 秒让 SPA 的 React/Vue 初始化 + 数据请求完成
          await new Promise((r) => setTimeout(r, 2500));
          if (settled || !win || win.isDestroyed()) return;
          // 取页面主体文本，优先 main/article 区域
          const text = await win.webContents.executeJavaScript(
            `
            (function() {
              try {
                // 移除 script/style 减少噪音
                document.querySelectorAll('script,style,noscript').forEach(el => el.remove());
                const main = document.querySelector('main, article, [role="main"], .content, #content');
                const body = main || document.body;
                if (!body) return '';
                return (body.innerText || body.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 8000);
              } catch (e) {
                return '__ERR__' + e.message;
              }
            })()
          `,
            true
          );
          clearTimeout(timer);
          done(resolve, String(text || ''));
        } catch (e) {
          clearTimeout(timer);
          done(reject, new Error(`提取内容失败：${e.message}`));
        }
      });

      win.webContents.on('did-fail-load', (event, errorCode, errorDesc) => {
        clearTimeout(timer);
        done(reject, new Error(`加载失败（${errorCode}）：${errorDesc || '未知原因'}`));
      });

      win.loadURL(url).catch((e) => {
        clearTimeout(timer);
        done(reject, e);
      });
    } catch (e) {
      clearTimeout(timer);
      done(reject, e);
    }
  });
}

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
  return path.join(app.getPath('documents'), '驭课Agent工作区');
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
  // Phase-8 M0+（2026-05-02）：4 层抓取策略（src/main/services/web-extractor.service.js）
  //   ① 站点专属规则（知乎/CSDN/简书/微信公众号）—— 命中则毫秒级精准提取
  //   ② httpGet HTML + Defuddle —— 服务端渲染网站，秒级
  //   ③ BrowserWindow + 自动滚动 + 启发式点击「展开全文」+ Defuddle —— SPA 网站，10-15 秒
  //   ④ 兜底 raw text —— 前三层全部失败时
  //
  // 升级说明：相比原 D4 的双层（httpGet → BrowserWindow innerText），现在新增：
  //   - Defuddle 取代 innerText：从满页噪声中精准提取主文（基于 Mozilla Readability，2025 升级版）
  //   - 自动滚动 4 轮：触发懒加载 / 折叠展开
  //   - 启发式点击「展开全文 / Read more」
  //   - 中国常用站点专属规则
  //   - 输出 markdown 格式，AI 上下文更友好
  ipcMain.handle('system:fetchUrlContent', async (event, url) => {
    try {
      const result = await webExtractor.extractFromUrl(url, { preferMarkdown: true });
      if (!result.success) {
        return { success: false, error: result.error };
      }
      // 兼容老调用方：text 字段保留为主要内容（markdown 优先），保留旧字段名
      return {
        success: true,
        data: {
          text: result.data.markdown || result.data.text,
          charCount: result.data.charCount,
          url: result.data.url,
          method: result.data.method,        // 'site:知乎专栏' / 'http+defuddle' / 'browser+defuddle' / 'raw'
          title: result.data.title || '',    // 新增字段：页面标题
        },
      };
    } catch (err) {
      console.error('[system:fetchUrlContent] 未捕获异常：', err);
      return { success: false, error: `抓取异常：${err.message}` };
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
