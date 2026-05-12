/**
 * web-extractor.service.js — 统一网页内容深度提取服务
 *
 * 替代原 system.handlers.js 里的双层 (httpGet + BrowserWindow) 抓取逻辑。
 * 引入 Defuddle（Mozilla Readability 升级版，TS 写的，2025 年新作）+ 中国常用站点专属规则。
 *
 * ── 策略层级（Phase-9.5：5 层）──
 *   ① 站点专属提取器 —— 匹配 URL 模式则用专门规则（知乎/CSDN/简书/微信公众号）
 *   ② httpGet + Defuddle —— 服务端渲染网站（学科网/职教云/iyiou）
 *   ③ BrowserWindow + Stealth + 自动滚动 + Defuddle —— SPA 网站（Canva/Adobe/Behance）
 *      Phase-9.5 升级：注入 stealth 脚本隐藏 navigator.webdriver + 真实 Sec-Ch-Ua headers
 *   ④ 兜底 raw innerText —— Defuddle 失败但 HTML 仍有内容时
 *   ⑤ Jina Reader API（r.jina.ai）—— 最终救援，免费无 Key，覆盖 cloudflare 强反爬 + PDF + 重 JS 站
 *      适用：britannica / medium / 李宁年报 PDF / 任何前 4 层抓不到的
 *
 * ── 设计原则 ──
 *   - 不引入 ML 模型，纯启发式 + 开源库（Defuddle MIT, Turndown MIT）
 *   - 不依赖付费 API（Jina Reader 免费，每月 1M 字符额度）
 *   - 老师零配置、零下载、零等待
 */

const { net, BrowserWindow } = require('electron');
const TurndownService = require('turndown');

// defuddle/node 是 ESM-only，CommonJS 项目用动态 import 懒加载 + 缓存
let _Defuddle = null;
async function getDefuddle() {
  if (!_Defuddle) {
    const mod = await import('defuddle/node');
    _Defuddle = mod.Defuddle;
  }
  return _Defuddle;
}

// ── 常量 ───────────────────────────────────────────────────────────────────────

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HTTP_TIMEOUT_MS = 15000;
const HTTP_MAX_BYTES = 2 * 1024 * 1024;       // 2 MB（Defuddle 需要完整 HTML，不能截）
const BROWSER_TIMEOUT_MS = 20000;             // 20 秒（Phase-8 M0+ 真实测试后从 35s 降到 20s——知乎登录墙等待无意义）
const BROWSER_RENDER_WAIT_MS = 2500;          // SPA 初始化等待
const SCROLL_CYCLES = 4;                      // 自动滚动次数（懒加载触发）
const SCROLL_INTERVAL_MS = 600;
const MIN_USEFUL_CHARS = 200;                 // 少于此字数视为"抓取不成功"
const OUTPUT_MAX_CHARS = 8000;                // 给 AI 用的上下文上限

// ── Phase-9.5：Stealth 注入脚本（隐藏自动化指纹）─────────────────────────────
// 在 BrowserWindow 每次导航时尽早注入，让目标站点检测时看不出"机器人"
const STEALTH_INJECTION_SCRIPT = `
(function() {
  try {
    // 1. 隐藏 navigator.webdriver（最关键的反爬检测点）
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

    // 2. 伪造 plugins 列表（headless Chrome 默认为空）
    Object.defineProperty(navigator, 'plugins', {
      get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }],
      configurable: true,
    });

    // 3. 伪造 languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true,
    });

    // 4. 伪造 chrome 对象（headless 没有 chrome.runtime/chrome.loadTimes）
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return { requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000, commitLoadTime: Date.now() / 1000 };
      };
    }
    if (!window.chrome.csi) window.chrome.csi = function() { return { startE: Date.now(), onloadT: Date.now() }; };

    // 5. 修复 permissions 接口（headless 行为不一致）
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      );
    }

    // 6. WebGL vendor / renderer 伪造（部分高级反爬会查）
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.apply(this, [parameter]);
    };

    // 7. 屏幕 / 硬件并发数（headless 常为 1）
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
  } catch (e) {
    // 静默：注入失败不应该阻断页面加载
  }
})();
`;

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

// ── 站点专属提取器 ─────────────────────────────────────────────────────────────
// 每个 extractor 接收 raw HTML 字符串 + URL，返回 { title, contentHtml } 或 null
//
// 加新站点的方法：在 SITE_EXTRACTORS 数组追加一项，包含 match (URL 正则) 和 extract (HTML→主文)

// Phase-8 M0+ Phase 2 (2026-05-02)：
// CSDN 用 curl 验证了真实结构（id="content_views" 是关键内容容器，class 是 htmledit_views）。
// 知乎/简书/微信对 curl 反爬严，离线无法验证 → 用宽松多模式匹配，覆盖各种 class 命名变体。
const SITE_EXTRACTORS = [
  {
    name: '知乎专栏',
    match: /^https?:\/\/zhuanlan\.zhihu\.com\//,
    extract(html) {
      // 知乎前端用 React + emotion，class 经常带哈希后缀
      // 但 Post-Title / Post-RichText 等"业务命名"基本不变
      const title =
        matchOne(html, /<h1[^>]*class="[^"]*Post-Title[^"]*"[^>]*>([\s\S]*?)<\/h1>/) ||
        matchOne(html, /<h1[^>]*class="[^"]*PostTitle[^"]*"[^>]*>([\s\S]*?)<\/h1>/) ||
        matchOne(html, /<h1[^>]*class="[^"]*QuestionHeader-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/);
      // 多个候选容器，按精度顺序尝试
      const body =
        matchOne(html, /<div[^>]*class="[^"]*Post-RichText[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="[^"]*ContentItem-actions/) ||
        matchOne(html, /<div[^>]*class="[^"]*Post-RichTextContainer[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="(?:Post-NormalSub|Voters|RichContent-actions)/) ||
        matchOne(html, /<div[^>]*class="[^"]*RichContent-inner[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/) ||
        matchOne(html, /<div[^>]*class="[^"]*Post-RichText[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      return body ? { title: stripTags(title || ''), contentHtml: body } : null;
    },
  },
  {
    name: 'CSDN 博客',
    match: /^https?:\/\/blog\.csdn\.net\/.+\/article\/details\//,  // 收紧：必须是 article 详情页
    extract(html) {
      // 实测验证（2026-05-02）：标题用 title-article，内容用 id="content_views"（class 是 htmledit_views）
      const title = matchOne(html, /<h1[^>]*class="[^"]*title-article[^"]*"[^>]*>([\s\S]*?)<\/h1>/);
      // 关键：用 id="content_views" 精准定位（实测最准）
      // 该容器需要找到正确的闭合 </div>——用启发式：直到下一个 <div class="aside-content"> 或 <div class="hide-article-box"> 或 article_content 闭合前
      const body =
        matchOne(html, /<div[^>]*id="content_views"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="(?:hide-article-box|aside-content|article-bar-bottom|recommend|comment)/) ||
        matchOne(html, /<div[^>]*id="content_views"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/) ||
        matchOne(html, /<div[^>]*id="content_views"[^>]*>([\s\S]*)/);  // 最后兜底（贪婪）
      return body ? { title: stripTags(title || ''), contentHtml: body } : null;
    },
  },
  {
    name: '简书',
    match: /^https?:\/\/www\.jianshu\.com\/p\/[a-f0-9]+/,  // 收紧：必须是 hex 文章 ID
    extract(html) {
      // 简书用 React，class 哈希后缀变化频繁。用业务标签 + nuxt 数据双策略
      const title =
        matchOne(html, /<h1[^>]*class="[^"]*_1RuRku[^"]*"[^>]*>([\s\S]*?)<\/h1>/) ||
        matchOne(html, /<h1[^>]*class="[^"]*_2zeTMs[^"]*"[^>]*>([\s\S]*?)<\/h1>/) ||
        matchOne(html, /<h1[^>]*class="[^"]*[A-Za-z0-9]{6,}[^"]*"[^>]*>([\s\S]*?)<\/h1>/) ||
        matchOne(html, /<title>([\s\S]*?)\s*-\s*简书<\/title>/) ||
        matchOne(html, /<title>([\s\S]*?)<\/title>/);
      const body =
        matchOne(html, /<article[^>]*class="[^"]*_2rhmJa[^"]*"[^>]*>([\s\S]*?)<\/article>/) ||
        matchOne(html, /<article[^>]*class="[^"]*[A-Za-z0-9]{6,}[^"]*"[^>]*>([\s\S]*?)<\/article>/) ||
        matchOne(html, /<article[^>]*>([\s\S]*?)<\/article>/) ||
        matchOne(html, /<div[^>]*data-name="article"[^>]*>([\s\S]*?)<\/div>/);
      return body ? { title: stripTags(title || ''), contentHtml: body } : null;
    },
  },
  {
    name: '微信公众号',
    match: /^https?:\/\/mp\.weixin\.qq\.com\/s\?|^https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]+/,  // 严格匹配真实文章 URL
    extract(html) {
      // js_content 是微信公众号铁打不变的 ID（10+ 年没改过）
      const title =
        matchOne(html, /<h1[^>]*class="[^"]*rich_media_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/) ||
        matchOne(html, /<h2[^>]*class="[^"]*rich_media_title[^"]*"[^>]*>([\s\S]*?)<\/h2>/) ||
        matchOne(html, /<h1[^>]*id="activity-name"[^>]*>([\s\S]*?)<\/h1>/) ||
        matchOne(html, /<title>([\s\S]*?)<\/title>/);
      // js_content 容器后面跟的是固定的几个区块（赞赏 / 留言 / 推荐）
      const body =
        matchOne(html, /<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<div[^>]*id="js_pc_qr_code/) ||
        matchOne(html, /<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*class="(?:rich_media_area_extra|rich_media_extra|reward_area)/) ||
        matchOne(html, /<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/) ||
        matchOne(html, /<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>/);
      return body ? { title: stripTags(title || ''), contentHtml: body } : null;
    },
  },
];

function matchOne(text, regex) {
  if (!text) return '';
  const m = text.match(regex);
  return m ? m[1] : '';
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findSiteExtractor(url) {
  return SITE_EXTRACTORS.find((e) => e.match.test(url)) || null;
}

// ── 登录墙嗅探 ─────────────────────────────────────────────────────────────────
// Phase-8 M0+ 真实测试发现：知乎对未登录访问会一直等用户操作，
//   BrowserWindow 加载完后 DOM 上看到的几乎全是登录引导/扫码/注册引导，
//   主文极少（< 1500 字）。这种情况下没必要再走 Defuddle，
//   直接给老师"建议手动复制粘贴"反馈，避免老师等下游链路再失败。
//
// 触发条件（同时满足才视为登录墙）：
//   1. HTML 文字总量 < 1500 字（去除标签后）
//   2. HTML 中出现以下高频关键词中的至少 2 个：
//      请登录 / 请扫码 / 关注公众号 / 未登录 / 立即登录 / 登录后查看 /
//      Sign in to / Login required / 验证码 / 滑动验证

const LOGIN_WALL_PATTERNS = [
  '请登录', '请扫码', '关注公众号', '未登录', '立即登录', '登录后查看',
  '注册即代表', '扫码登录', '账号登录', '手机号登录', '微信登录',
  '没有知识存在的荒原',  // 知乎 404 关键词
  '验证码', '滑动验证', '人机验证', '安全验证',
  'Sign in to', 'Login required', 'Please log in',
];

function detectLoginWall(html) {
  if (!html) return null;
  const text = stripTags(html);
  if (text.length >= 1500) return null;  // 主文够长就不可能是登录墙

  const hits = LOGIN_WALL_PATTERNS.filter((p) => html.includes(p));
  if (hits.length >= 2) {
    return { hit: true, keywords: hits, textLength: text.length };
  }
  return null;
}

// ── HTTP 抓取 ──────────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    const request = net.request({ url, method: 'GET', redirect: 'follow' });
    request.setHeader('User-Agent', DEFAULT_USER_AGENT);
    request.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
    request.setHeader('Cache-Control', 'no-cache');

    const timer = setTimeout(() => {
      try { request.abort(); } catch (_) {}
      done(reject, new Error(`请求超时（${HTTP_TIMEOUT_MS / 1000}秒）`));
    }, HTTP_TIMEOUT_MS);

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
        if (totalSize > HTTP_MAX_BYTES) {
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

// ── BrowserWindow 渲染 + 自动滚动 ───────────────────────────────────────────────
// 比原 D4 实现增强：
//   - 自动滚到底（4 轮）触发懒加载
//   - 启发式点击「展开全文」按钮
//   - 取页面渲染完成后的完整 HTML（不是 innerText）→ 交给 Defuddle

function fetchRenderedHtml(url) {
  return new Promise((resolve, reject) => {
    let win = null;
    let settled = false;

    const cleanup = () => {
      try { if (win && !win.isDestroyed()) { win.destroy(); win = null; } } catch {}
    };
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(val);
    };

    const timer = setTimeout(() => done(reject, new Error(`页面加载超时（${BROWSER_TIMEOUT_MS / 1000}秒）`)), BROWSER_TIMEOUT_MS);

    try {
      win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      win.webContents.setUserAgent(DEFAULT_USER_AGENT);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      // Phase-9.5（2026-05-12）：BrowserWindow Stealth 注入
      // 真实浏览器指纹模拟——隐藏 navigator.webdriver / 加 plugins/languages/chrome
      // 用 didFrameNavigate（在每个文档载入早期注入，比 dom-ready 更早）
      win.webContents.on('did-start-navigation', () => {
        if (!win || win.isDestroyed()) return;
        win.webContents.executeJavaScript(STEALTH_INJECTION_SCRIPT, true).catch(() => {});
      });

      // 加真实浏览器 headers 模拟（含 Accept-Language / Sec-Ch-Ua 等）
      win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';
        headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
        headers['Sec-Ch-Ua'] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
        headers['Sec-Ch-Ua-Mobile'] = '?0';
        headers['Sec-Ch-Ua-Platform'] = '"Windows"';
        headers['Sec-Fetch-Dest'] = 'document';
        headers['Sec-Fetch-Mode'] = 'navigate';
        headers['Sec-Fetch-Site'] = 'none';
        headers['Sec-Fetch-User'] = '?1';
        headers['Upgrade-Insecure-Requests'] = '1';
        // 去掉 Electron 默认的 Sec-Ch-Ua 中的"HeadlessChrome"标识
        Object.keys(headers).forEach((k) => {
          if (typeof headers[k] === 'string' && /HeadlessChrome|Electron/i.test(headers[k])) {
            delete headers[k];
          }
        });
        callback({ requestHeaders: headers });
      });

      let loadFinished = false;
      win.webContents.on('did-finish-load', async () => {
        if (loadFinished) return;
        loadFinished = true;
        try {
          // 等 SPA 初始化
          await new Promise((r) => setTimeout(r, BROWSER_RENDER_WAIT_MS));
          if (settled || !win || win.isDestroyed()) return;

          // 自动滚动 + 启发式点击「展开全文」
          await win.webContents.executeJavaScript(`
            (async function() {
              const sleep = (ms) => new Promise(r => setTimeout(r, ms));

              // 1) 滚到底 ${SCROLL_CYCLES} 轮，触发懒加载
              for (let i = 0; i < ${SCROLL_CYCLES}; i++) {
                window.scrollTo(0, document.body.scrollHeight);
                await sleep(${SCROLL_INTERVAL_MS});
              }
              window.scrollTo(0, 0); // 滚回顶部

              // 2) 启发式点击「展开全文 / Read More / 显示更多 / 查看更多」按钮
              const expandSelectors = [
                'button[class*="expand" i]',
                'a[class*="expand" i]',
                'button[class*="more" i]',
                'a[class*="more" i]',
                '[role="button"][aria-expanded="false"]',
              ];
              const expandTexts = ['展开全文', '展开', 'Read more', 'Show more', '显示更多', '查看全文', '查看更多', '阅读全文'];

              const clickIfMatches = (el) => {
                try {
                  const text = (el.innerText || el.textContent || '').trim();
                  if (text.length < 20 && expandTexts.some(t => text.includes(t))) {
                    el.click();
                    return true;
                  }
                } catch {}
                return false;
              };

              let clicks = 0;
              for (const sel of expandSelectors) {
                for (const el of document.querySelectorAll(sel)) {
                  if (clicks >= 3) break;
                  if (clickIfMatches(el)) clicks++;
                }
              }
              // 兜底：扫描所有 button/a 找文字匹配
              if (clicks === 0) {
                for (const el of document.querySelectorAll('button, a, span[role="button"]')) {
                  if (clicks >= 3) break;
                  if (clickIfMatches(el)) clicks++;
                }
              }

              if (clicks > 0) await sleep(800); // 等展开内容加载

              return clicks;
            })()
          `, true);

          if (settled || !win || win.isDestroyed()) return;

          // 取完整渲染后的 HTML
          const html = await win.webContents.executeJavaScript(
            `document.documentElement ? document.documentElement.outerHTML : document.body.outerHTML`,
            true
          );
          clearTimeout(timer);
          done(resolve, String(html || ''));
        } catch (e) {
          clearTimeout(timer);
          done(reject, new Error(`渲染失败：${e.message}`));
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

// ── Defuddle 主文提取 ──────────────────────────────────────────────────────────

async function defuddleExtract(html, url) {
  if (!html || html.length < 100) {
    return { title: '', text: '', markdown: '', contentHtml: '' };
  }
  try {
    const Defuddle = await getDefuddle();
    // 不开 markdown 选项：让 Defuddle 返回 HTML，自己用 turndown 转 markdown
    // 这样能同时拿到 HTML（供站点规则后处理）+ markdown（供 AI）+ 纯文本
    const result = await Defuddle(html, url, {});
    const contentHtml = result.content || '';
    const markdown = contentHtml ? turndown.turndown(contentHtml) : '';
    const text = stripTags(contentHtml);
    return {
      title: result.title || '',
      text: text.slice(0, OUTPUT_MAX_CHARS),
      markdown: markdown.slice(0, OUTPUT_MAX_CHARS),
      contentHtml,
      author: result.author || '',
      site: result.site || '',
      wordCount: result.wordCount || 0,
    };
  } catch (e) {
    console.warn('[web-extractor] Defuddle 失败：', e.message);
    return { title: '', text: '', markdown: '', contentHtml: '', error: e.message };
  }
}

// ── 主入口 ─────────────────────────────────────────────────────────────────────

/**
 * 从 URL 提取网页主文内容
 *
 * @param {string} url
 * @param {object} [options]
 * @param {boolean} [options.preferMarkdown=true]   返回 markdown 而非纯文本
 * @param {boolean} [options.skipBrowser=false]     不走 BrowserWindow（用于快速测试）
 * @returns {Promise<{
 *   success: boolean,
 *   data?: {
 *     text: string,         // 提取后的纯文本
 *     markdown: string,     // 提取后的 markdown
 *     title: string,
 *     url: string,
 *     method: 'site:zhihu'|'site:csdn'|...|'http'|'browser'|'raw',
 *     charCount: number,
 *   },
 *   error?: string,
 * }>}
 */
async function extractFromUrl(url, options = {}) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) {
    return { success: false, error: '请输入完整 URL（以 http:// 或 https:// 开头）' };
  }
  const { preferMarkdown = true, skipBrowser = false } = options;

  // ── 第 1 层：站点专属规则（最快最准，针对中国常用站点）──────────────────────
  const siteExt = findSiteExtractor(target);
  let httpHtml = '';
  let httpError = null;

  // 如果 URL 匹配专属站点，httpGet 拿到 HTML 后先尝试专属规则
  try {
    httpHtml = await httpGet(target);

    if (siteExt) {
      const siteRes = siteExt.extract(httpHtml, target);
      if (siteRes && siteRes.contentHtml && stripTags(siteRes.contentHtml).length >= MIN_USEFUL_CHARS) {
        const markdown = turndown.turndown(siteRes.contentHtml).slice(0, OUTPUT_MAX_CHARS);
        const text = stripTags(siteRes.contentHtml).slice(0, OUTPUT_MAX_CHARS);
        return {
          success: true,
          data: {
            text,
            markdown,
            title: siteRes.title || '',
            url: target,
            method: `site:${siteExt.name}`,
            charCount: preferMarkdown ? markdown.length : text.length,
          },
        };
      }
      console.log(`[web-extractor] 站点专属规则 [${siteExt.name}] 未命中，回退到 Defuddle`);
    }
  } catch (e) {
    httpError = e.message;
  }

  // ── 第 2 层：httpGet HTML + Defuddle ──────────────────────────────────────
  if (httpHtml && httpHtml.length >= 500) {
    const def = await defuddleExtract(httpHtml, target);
    if ((def.markdown || def.text || '').length >= MIN_USEFUL_CHARS) {
      return {
        success: true,
        data: {
          text: def.text,
          markdown: def.markdown,
          title: def.title,
          url: target,
          method: 'http+defuddle',
          charCount: preferMarkdown ? def.markdown.length : def.text.length,
        },
      };
    }
  }

  if (skipBrowser) {
    return {
      success: false,
      error: `httpGet 内容不足${httpError ? `（${httpError}）` : ''}，且 skipBrowser=true 跳过了浏览器渲染。`,
    };
  }

  // ── 第 3 层：BrowserWindow + 自动滚动 + Defuddle ─────────────────────────
  console.log(`[web-extractor] httpGet/Defuddle 不足，启动 BrowserWindow：${target}`);
  let renderedHtml = '';
  try {
    renderedHtml = await fetchRenderedHtml(target);
  } catch (e) {
    // Phase 1.5：分类错误 → 给老师可执行的应对建议
    const isTimeout = /超时|timeout/i.test(e.message);
    const friendlyMsg = isTimeout
      ? `该页面加载较慢（${BROWSER_TIMEOUT_MS / 1000} 秒未完成）。\n建议：\n  ① 浏览器打开此页面，等加载完后 Ctrl+A 全选 → Ctrl+C 复制 → 粘贴到下方文本框\n  ② 或换一个更具体的子页面（首页通常加载慢，子页面快）`
      : `渲染失败：${e.message}。\n建议：浏览器打开此页面 → 手动复制可见文字 → 粘贴到下方文本框。`;
    return {
      success: false,
      error: friendlyMsg,
      errorKind: isTimeout ? 'timeout' : 'render_error',  // 前端可据此分类展示
      url: target,
    };
  }

  // Phase-8 M0+：登录墙嗅探——避免老师拿到无意义的"登录引导页"内容
  const wall = detectLoginWall(renderedHtml);
  if (wall) {
    console.log(`[web-extractor] 检测到登录墙：${target}（命中关键词 ${wall.keywords.length} 个，主文 ${wall.textLength} 字）`);
    return {
      success: false,
      error: `该网站需要登录才能查看完整内容（检测到：${wall.keywords.slice(0, 3).join(' / ')}）。\n建议：\n  ① 浏览器打开此页面 → 登录账号 → 复制可见正文 → 粘贴到下方文本框\n  ② 或者换一个公开可访问的页面重试`,
      errorKind: 'login_wall',
      url: target,
    };
  }

  if (renderedHtml && renderedHtml.length >= 500) {
    // 渲染后再次尝试站点专属规则（有些 SPA 渲染完才能匹配）
    if (siteExt) {
      const siteRes = siteExt.extract(renderedHtml, target);
      if (siteRes && siteRes.contentHtml && stripTags(siteRes.contentHtml).length >= MIN_USEFUL_CHARS) {
        const markdown = turndown.turndown(siteRes.contentHtml).slice(0, OUTPUT_MAX_CHARS);
        const text = stripTags(siteRes.contentHtml).slice(0, OUTPUT_MAX_CHARS);
        return {
          success: true,
          data: {
            text,
            markdown,
            title: siteRes.title || '',
            url: target,
            method: `site:${siteExt.name}+browser`,
            charCount: preferMarkdown ? markdown.length : text.length,
          },
        };
      }
    }

    const def = await defuddleExtract(renderedHtml, target);
    if ((def.markdown || def.text || '').length >= MIN_USEFUL_CHARS) {
      return {
        success: true,
        data: {
          text: def.text,
          markdown: def.markdown,
          title: def.title,
          url: target,
          method: 'browser+defuddle',
          charCount: preferMarkdown ? def.markdown.length : def.text.length,
        },
      };
    }
  }

  // ── 第 4 层：兜底 raw text ───────────────────────────────────────────────
  const fallbackHtml = renderedHtml || httpHtml;
  if (fallbackHtml) {
    const text = stripTags(
      fallbackHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    ).slice(0, OUTPUT_MAX_CHARS);
    if (text.length >= 50) {
      return {
        success: true,
        data: {
          text,
          markdown: text,
          title: '',
          url: target,
          method: 'raw',
          charCount: text.length,
        },
      };
    }
  }

  // ── 第 5 层（Phase-9.5）：Jina Reader API 兜底 ───────────────────────────
  // 用 Jina AI 的 r.jina.ai 服务（免费，无需 API Key）做最终救援
  // 适用：britannica/medium/cloudflare 重反爬站；李宁年报这种 PDF；强 JS 渲染站
  console.log(`[web-extractor] 前 4 层全失败，启动 Layer 5：Jina Reader → ${target}`);
  try {
    const jinaResult = await fetchViaJinaReader(target);
    if (jinaResult && jinaResult.length >= MIN_USEFUL_CHARS) {
      const truncated = jinaResult.slice(0, OUTPUT_MAX_CHARS);
      return {
        success: true,
        data: {
          text: truncated,
          markdown: truncated,
          title: '',
          url: target,
          method: 'jina-reader',
          charCount: truncated.length,
        },
      };
    }
  } catch (e) {
    console.log(`[web-extractor] Jina Reader 兜底也失败：${e.message}`);
  }

  return {
    success: false,
    error: `页面内容过少（< 50 字），且 Jina Reader 兜底也失败。可能原因：①需要登录；②反爬虫拦截；③该 URL 是图片/视频等非文本资源。\n建议：浏览器打开此页面 → 手动复制可见文字 → 粘贴到下方文本框。`,
    errorKind: 'content_too_short',
    url: target,
  };
}

/**
 * Phase-9.5 Layer 5：Jina Reader API（免费、无 API Key、覆盖 cloudflare/SPA/PDF）
 *
 * 调用方式：GET https://r.jina.ai/{encodeURIComponent(targetUrl)}
 *   → 返回干净的 Markdown（已经做了反爬 + JS 渲染 + 正文提取）
 *
 * 免费额度：每月 1M 字符（轻度使用绰绰有余）
 *   重度使用：在 https://jina.ai/reader 申请免费 API Key，提高额度
 *
 * 适用场景：
 *   - britannica/medium/cloudflare 重反爬英文 SPA
 *   - 李宁年报 PDF（Jina 自动 OCR PDF）
 *   - 任何前 4 层都抓不到的 URL
 */
async function fetchViaJinaReader(targetUrl) {
  const jinaEndpoint = `https://r.jina.ai/${targetUrl}`;
  const request = net.request({
    method: 'GET',
    url: jinaEndpoint,
    redirect: 'follow',
  });
  request.setHeader('Accept', 'text/markdown, text/plain');
  request.setHeader('User-Agent', DEFAULT_USER_AGENT);

  return new Promise((resolve, reject) => {
    let body = '';
    const timer = setTimeout(() => {
      try { request.abort(); } catch (_) {}
      reject(new Error('Jina Reader 30 秒超时'));
    }, 30000);

    request.on('response', (response) => {
      if (response.statusCode >= 400) {
        clearTimeout(timer);
        reject(new Error(`Jina Reader 返回 ${response.statusCode}`));
        return;
      }
      response.on('data', (chunk) => {
        if (body.length < HTTP_MAX_BYTES) body += chunk.toString('utf8');
      });
      response.on('end', () => {
        clearTimeout(timer);
        resolve(body);
      });
      response.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    request.on('error', (e) => { clearTimeout(timer); reject(e); });
    request.end();
  });
}

// ── 自检（轻量） ────────────────────────────────────────────────────────────────
// 不做网络调用，只检查模块加载和站点匹配规则
async function selfCheck() {
  const checks = [];

  let defuddleOk = false;
  try {
    const Defuddle = await getDefuddle();
    defuddleOk = typeof Defuddle === 'function';
  } catch (e) {
    defuddleOk = false;
  }
  checks.push({
    name: 'defuddle/node 动态加载',
    pass: defuddleOk,
  });

  checks.push({
    name: 'turndown 已加载',
    pass: typeof turndown.turndown === 'function',
  });

  checks.push({
    name: '知乎 URL 匹配',
    pass: findSiteExtractor('https://zhuanlan.zhihu.com/p/123456')?.name === '知乎专栏',
  });

  checks.push({
    name: 'CSDN URL 匹配',
    pass: findSiteExtractor('https://blog.csdn.net/abc/article/details/123')?.name === 'CSDN 博客',
  });

  checks.push({
    name: '微信公众号 URL 匹配',
    pass: findSiteExtractor('https://mp.weixin.qq.com/s/abcdef')?.name === '微信公众号',
  });

  checks.push({
    name: '不匹配的 URL 返回 null',
    pass: findSiteExtractor('https://example.com/foo') === null,
  });

  checks.push({
    name: 'turndown 转 markdown',
    pass: turndown.turndown('<h1>Title</h1><p>Body</p>').includes('# Title'),
  });

  const passed = checks.filter((c) => c.pass).length;
  return { total: checks.length, passed, checks };
}

module.exports = {
  extractFromUrl,
  selfCheck,
  // 暴露内部工具供测试
  _internal: { httpGet, defuddleExtract, findSiteExtractor, fetchRenderedHtml, detectLoginWall },
};
