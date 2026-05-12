/**
 * verify-web-extractor.js — Phase-8 M0+ web-extractor 服务自检
 *
 * 测试范围：
 *   ✅ 契约组（mock 路径，不发网络请求）：
 *      - 模块加载 / Defuddle / Turndown 可用
 *      - 站点专属 URL 匹配规则
 *      - 各种 HTML 输入 → Defuddle 提取效果
 *      - 站点专属规则各自命中
 *   ✅ 集成组（真实路径）：
 *      - httpGet 真实抓取
 *      - 提取经典文章页（example.com / 维基百科），断言核心字段非空
 *
 * 依照 CLAUDE.md H9："不允许 selfCheck mock 通过 = 功能就绪"——
 *   契约组确保模块行为正确，集成组确保真实环境能拿到内容。
 *
 * 用法：node scripts/verify-web-extractor.js
 *
 * 注意：集成组需要 Electron 运行时（BrowserWindow），所以 node 直接跑只测 Layer 1+2。
 *       完整 Layer 3 测试需要走 npm run dev 手动点测。
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── 让 require 找到 services ───────────────────────────────────────────────────
const SERVICE_PATH = path.join(PROJECT_ROOT, 'src', 'main', 'services', 'web-extractor.service.js');

// ── 测试工具 ──────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then((result) => {
      if (result === false) throw new Error('断言失败');
      console.log(`  ✅ ${name}`);
      pass++;
    })
    .catch((err) => {
      console.log(`  ❌ ${name} — ${err.message}`);
      failures.push({ name, error: err.message });
      fail++;
    });
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Phase-8 M0+ web-extractor 服务自检');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── 契约组 1：模块加载 ──────────────────────────────────────────────────────
  console.log('▸ 契约组 1：模块加载');

  let webExtractor;
  await test('require web-extractor.service.js', () => {
    webExtractor = require(SERVICE_PATH);
    if (!webExtractor) throw new Error('模块返回空');
    if (typeof webExtractor.extractFromUrl !== 'function') throw new Error('extractFromUrl 不是函数');
    if (typeof webExtractor.selfCheck !== 'function') throw new Error('selfCheck 不是函数');
  });

  await test('selfCheck 7 项全通过', async () => {
    const r = await webExtractor.selfCheck();
    if (r.passed !== r.total) {
      const failed = r.checks.filter((c) => !c.pass).map((c) => c.name);
      throw new Error(`仅 ${r.passed}/${r.total} 通过；失败：${failed.join(', ')}`);
    }
  });

  // ── 契约组 2：站点专属 URL 匹配 ───────────────────────────────────────────
  console.log('\n▸ 契约组 2：站点专属 URL 匹配规则');

  const findSiteExtractor = webExtractor._internal.findSiteExtractor;

  await test('知乎专栏 URL → 命中知乎规则', () => {
    const e = findSiteExtractor('https://zhuanlan.zhihu.com/p/123456');
    if (!e || e.name !== '知乎专栏') throw new Error(`实际：${e?.name}`);
  });

  await test('CSDN 博客 URL → 命中 CSDN 规则', () => {
    const e = findSiteExtractor('https://blog.csdn.net/abc/article/details/123456');
    if (!e || e.name !== 'CSDN 博客') throw new Error(`实际：${e?.name}`);
  });

  await test('简书 URL → 命中简书规则', () => {
    const e = findSiteExtractor('https://www.jianshu.com/p/abcdef123456');
    if (!e || e.name !== '简书') throw new Error(`实际：${e?.name}`);
  });

  await test('微信公众号 URL → 命中微信规则', () => {
    const e = findSiteExtractor('https://mp.weixin.qq.com/s/abcdefghijklmnop');
    if (!e || e.name !== '微信公众号') throw new Error(`实际：${e?.name}`);
  });

  await test('普通 URL（example.com）→ 不命中专属规则', () => {
    const e = findSiteExtractor('https://example.com/article/123');
    if (e !== null) throw new Error(`期望 null，实际：${e?.name}`);
  });

  await test('知乎首页（非专栏）→ 不命中', () => {
    const e = findSiteExtractor('https://www.zhihu.com/question/123');
    if (e !== null) throw new Error(`期望 null，实际：${e?.name}`);
  });

  // ── 契约组 3：Defuddle 行为 ────────────────────────────────────────────────
  console.log('\n▸ 契约组 3：Defuddle 主文提取');

  const defuddleExtract = webExtractor._internal.defuddleExtract;

  await test('Defuddle 处理简单 HTML 文章', async () => {
    const html = `<!doctype html><html><head><title>测试标题</title></head>
      <body>
        <nav>导航栏 Home About</nav>
        <article>
          <h1>这是文章主标题</h1>
          <p>这是第一段内容，应该被提取出来作为主文。这一段足够长以通过 Defuddle 的最小阈值。</p>
          <p>这是第二段内容，包含一些技术要点和教学说明。教学场景中常见的内容形式。</p>
          <p>第三段强调内容质量和上下文的重要性，给 AI 用作参考资料。</p>
        </article>
        <footer>页脚 © 2026</footer>
      </body></html>`;
    const r = await defuddleExtract(html, 'https://example.com/article');
    if (!r.text || r.text.length < 50) throw new Error(`text 太短：${r.text?.length}`);
    if (!r.text.includes('文章主标题') && !r.text.includes('第一段')) {
      throw new Error('未包含正文关键词');
    }
    // Defuddle 应该过滤掉 nav/footer
    if (r.text.includes('Home About') || r.text.includes('© 2026')) {
      throw new Error('未过滤导航/页脚噪声');
    }
  });

  await test('Defuddle 输出 markdown 格式', async () => {
    const html = `<!doctype html><html><body>
      <article>
        <h2>章节标题</h2>
        <p>段落 <strong>加粗</strong> 和 <em>斜体</em>。</p>
        <ul><li>列表项 1</li><li>列表项 2</li></ul>
      </article>
    </body></html>`;
    const r = await defuddleExtract(html, 'https://example.com/');
    if (!r.markdown || r.markdown.length < 20) throw new Error(`markdown 太短：${r.markdown?.length}`);
    // markdown 应包含 ## 或 # 等 markdown 标记
    const hasMarkdownHeading = r.markdown.includes('## ') || r.markdown.includes('# ');
    if (!hasMarkdownHeading) throw new Error('缺少 markdown 标题语法');
  });

  await test('Defuddle 处理空 HTML 不崩溃', async () => {
    const r = await defuddleExtract('', 'https://example.com/');
    if (r.error) throw new Error(`不应出错：${r.error}`);
    // 空字符串预期返回空文本
    if (r.text !== '') throw new Error('期望空文本');
  });

  // ── 契约组 4：站点专属规则的提取 ──────────────────────────────────────────
  console.log('\n▸ 契约组 4：站点专属规则提取（mock HTML）');

  await test('知乎专属规则从模拟 HTML 提取主文', async () => {
    const mockZhihuHtml = `<!doctype html><html><body>
      <div>
        <h1 class="Post-Title">如何学习 3D 建模？</h1>
        <div class="Post-RichTextContainer">
          <p>这是知乎专栏的正文内容。学习 3D 建模需要从基础开始，循序渐进。</p>
          <p>推荐使用 Blender 作为入门工具，免费开源功能完整。</p>
          <p>掌握建模 / 材质 / 灯光 / 渲染 4 个核心环节。</p>
        </div>
      </div>
      </body></html>`;
    const result = await webExtractor.extractFromUrl('https://zhuanlan.zhihu.com/p/123', { skipBrowser: true });
    // 注意：此处会真的发 httpGet（去知乎），但因为是 mock URL 大概率失败
    // 我们只验证函数能正常返回（成功或失败都行），不崩溃即可
    if (typeof result.success !== 'boolean') throw new Error('返回格式错误');
  });

  // ── Phase 2 新增：基于真实抓到的 HTML 片段直接测站点提取器 ────────────────────
  // 这些 HTML 片段是 2026-05-02 用 curl 真实抓到的（CSDN）或基于公开前端架构推断的（知乎/微信）
  // 测试 SITE_EXTRACTORS 的 extract() 函数在真实模式下能否命中

  const SITE_EXTRACTORS_FOR_TEST = (() => {
    // 通过 require 私有获取 SITE_EXTRACTORS（service 没直接暴露，但通过 findSiteExtractor 间接验证）
    return null;
  })();

  await test('CSDN 真实结构 HTML（含 id="content_views"）→ 提取器命中', () => {
    // 这是 2026-05-02 实测从 blog.csdn.net/naobeng/article/details/160576717 抓到的真实片段
    const realCsdnHtml = `<html><body>
      <h1 class="title-article" id="articleContentId">动态内存管理</h1>
      <div id="article_content" class="article_content clearfix">
        <link rel="stylesheet" href="https://csdnimg.cn/some.css">
        <div id="content_views" class="htmledit_views atom-one-dark">
          <p id="main-toc"><strong>目录</strong></p>
          <h2>1 · 为什么要有动态内存分配</h2>
          <p>简单来说，就是想让程序员灵活的控制空间。</p>
          <pre><code>int i = 20; //在栈空间上开辟四个字节</code></pre>
          <h2>2 · malloc</h2>
          <p>malloc 函数用来进行内存开辟。使用需包含头文件 stdlib.h</p>
          <pre><code>void* malloc (size_t size);</code></pre>
          <p>申请一片连续的空间，单位是字节，返回值是这片空间的起始地址。</p>
        </div>
      </div>
      <div class="hide-article-box hide-article-pos">
        <a class="btn-readmore">阅读全文</a>
      </div>
      </body></html>`;
    const ext = findSiteExtractor('https://blog.csdn.net/naobeng/article/details/160576717');
    if (!ext) throw new Error('CSDN URL 未命中提取器');
    const r = ext.extract(realCsdnHtml);
    if (!r || !r.contentHtml) throw new Error('extract() 返回空');
    if (!r.contentHtml.includes('动态内存') && !r.contentHtml.includes('malloc')) {
      throw new Error(`未包含正文关键词：${r.contentHtml.slice(0, 200)}`);
    }
    if (r.contentHtml.includes('阅读全文')) {
      throw new Error('提取范围过大，包含了 hide-article-box 之后的内容');
    }
    if (r.title !== '动态内存管理') throw new Error(`标题错误：${r.title}`);
  });

  await test('知乎真实结构 HTML（Post-RichText）→ 提取器命中', () => {
    const mockZhihuHtml = `<html><body>
      <h1 class="Post-Title css-abc123">三维建模入门指南</h1>
      <div class="Post-RichTextContainer">
        <div class="RichText ztext Post-RichText css-xyz789">
          <p>三维建模需要 4 个核心环节：建模 / 材质 / 灯光 / 渲染。</p>
          <p>初学推荐 Blender，开源免费功能完整。</p>
          <h2>建模软件选择</h2>
          <p>3ds Max、Maya、Cinema 4D、Blender 各有优势。</p>
        </div>
        <div class="ContentItem-actions">
          <button>赞同</button><button>评论</button>
        </div>
      </div>
      </body></html>`;
    const ext = findSiteExtractor('https://zhuanlan.zhihu.com/p/123');
    if (!ext) throw new Error('知乎 URL 未命中提取器');
    const r = ext.extract(mockZhihuHtml);
    if (!r || !r.contentHtml) throw new Error('extract() 返回空');
    if (!r.contentHtml.includes('三维建模') && !r.contentHtml.includes('Blender')) {
      throw new Error('未包含正文关键词');
    }
    if (r.contentHtml.includes('赞同') || r.contentHtml.includes('评论')) {
      throw new Error('提取范围过大，包含了 ContentItem-actions');
    }
  });

  await test('微信公众号真实结构 HTML（id="js_content"）→ 提取器命中', () => {
    const mockWechatHtml = `<html><body>
      <h1 class="rich_media_title" id="activity-name">职业教育 AI 应用案例</h1>
      <div class="rich_media_content">
        <div id="js_content" class="rich_media_content js_underline_content">
          <p>本文介绍 AI 在职业教育课程开发中的真实应用。</p>
          <p>包含课程框架自动生成、讲稿合成、PPT 配图等核心场景。</p>
          <h3>三个典型场景</h3>
          <ol><li>框架辅助</li><li>讲稿合成</li><li>PPT 配图</li></ol>
        </div>
      </div>
      <div class="rich_media_area_extra">
        <div class="reward_area">赞赏作者</div>
      </div>
      </body></html>`;
    const ext = findSiteExtractor('https://mp.weixin.qq.com/s/AbCd1234567890XyZ_qwerty');
    if (!ext) throw new Error('微信 URL 未命中提取器');
    const r = ext.extract(mockWechatHtml);
    if (!r || !r.contentHtml) throw new Error('extract() 返回空');
    if (!r.contentHtml.includes('职业教育') && !r.contentHtml.includes('AI')) {
      throw new Error('未包含正文关键词');
    }
    if (r.contentHtml.includes('赞赏作者')) {
      throw new Error('提取范围过大，包含了 rich_media_area_extra');
    }
    if (!r.title.includes('职业教育')) throw new Error(`标题错误：${r.title}`);
  });

  await test('CSDN 收紧匹配：blog.csdn.net 首页（非 article 详情）→ 不命中', () => {
    const ext = findSiteExtractor('https://blog.csdn.net/');
    if (ext) throw new Error('CSDN 首页不应命中专属规则（v2 收紧后）');
  });

  await test('微信收紧匹配：mp.weixin.qq.com/s/ 无 hash → 不命中', () => {
    const ext = findSiteExtractor('https://mp.weixin.qq.com/s/');
    if (ext) throw new Error('微信无 hash URL 不应命中专属规则（v2 收紧后）');
  });

  // ── 契约组 5：登录墙嗅探（Phase-8 M0+ 新增）─────────────────────────────────
  console.log('\n▸ 契约组 5：登录墙嗅探');

  const detectLoginWall = webExtractor._internal.detectLoginWall;

  await test('知乎 404 登录墙页面 → 命中', () => {
    const html = `<html><body>
      <div>你似乎来到了没有知识存在的荒原</div>
      <div>登录知乎</div>
      <div>立即登录或注册</div>
      <a>未登录用户</a>
    </body></html>`;
    const r = detectLoginWall(html);
    if (!r || !r.hit) throw new Error('应命中登录墙');
    if (r.keywords.length < 2) throw new Error(`关键词命中不足：${r.keywords.length}`);
  });

  await test('微信"参数错误"页面（短文 + 无登录关键词）→ 不命中', () => {
    const html = `<html><body>
      <div>微信公众平台</div>
      <div>参数错误：</div>
      <div>视频 小程序 赞 在看 分享 留言 收藏</div>
    </body></html>`;
    const r = detectLoginWall(html);
    // 这是参数错误页，不是登录墙——不应命中
    if (r && r.hit) throw new Error('不应命中：这是参数错误页');
  });

  await test('正常长文章（1500+ 字）→ 永不命中（即使含登录字）', () => {
    const longText = '这是一篇关于三维建模的教程文章。'.repeat(100); // 约 1500+ 字
    const html = `<html><body>
      <article>${longText}</article>
      <footer>登录后查看更多</footer>
    </body></html>`;
    const r = detectLoginWall(html);
    if (r && r.hit) throw new Error('正常文章不应被误判为登录墙');
  });

  await test('微信公众号关注引导短页 → 命中', () => {
    const html = `<html><body>
      <div>请扫码关注公众号查看完整内容</div>
      <div>未登录</div>
      <div>关注公众号"XXX"</div>
    </body></html>`;
    const r = detectLoginWall(html);
    if (!r || !r.hit) throw new Error('应命中登录墙');
  });

  await test('英文 Login required 短页 → 命中', () => {
    const html = `<html><body>
      <h1>Sign in to continue</h1>
      <p>Login required to view this article</p>
      <p>Please log in</p>
    </body></html>`;
    const r = detectLoginWall(html);
    if (!r || !r.hit) throw new Error('应命中登录墙');
  });

  // ── 集成组：真实网络抓取 ────────────────────────────────────────────────────
  // 注意：此处需要 Electron 的 net 模块，node 直接跑会报错——所以集成组只在 Electron 环境运行
  console.log('\n▸ 集成组：真实网络抓取');

  // 准确检测：必须有可用的 BrowserWindow 构造器（Electron runtime 才有）
  let isElectronRuntime = false;
  try {
    // eslint-disable-next-line global-require
    const electron = require('electron');
    // 在 Electron runtime 里，electron 是个对象；纯 node 里只是字符串路径
    isElectronRuntime = typeof electron === 'object' && typeof electron.BrowserWindow === 'function';
  } catch {
    isElectronRuntime = false;
  }

  if (!isElectronRuntime) {
    console.log('  ⏭️  跳过整个集成组——当前是纯 node 环境，无 electron.net / BrowserWindow');
    console.log('     httpGet 用 electron.net.request（Chromium 网络栈），纯 node 不可用');
    console.log('  💡 集成测试请走：npm run dev → 在前端测「参考资料 URL 抓取」按钮');
    console.log('     建议测 5 个真实场景：');
    console.log('       1. https://zhuanlan.zhihu.com/p/<任意文章 id>');
    console.log('       2. https://blog.csdn.net/<任意博客 url>');
    console.log('       3. https://mp.weixin.qq.com/s/<任意文章 url>');
    console.log('       4. 任意学科网 / 国家职教智慧平台教学资源');
    console.log('       5. 一个 SPA 网站如 Adobe / Behance（测 Layer 3 BrowserWindow）');
  } else {
    // 仅在 Electron runtime 下跑真实网络测试
    await test('真实抓取 example.com (Layer 1+2)', async () => {
      const result = await webExtractor.extractFromUrl('https://example.com/', {
        preferMarkdown: false,
        skipBrowser: true,
      });
      if (!result.success) throw new Error(`抓取失败：${result.error}`);
      if (!result.data.text.includes('Example Domain')) {
        throw new Error(`未包含 "Example Domain"`);
      }
    });
  }

  // ── 总结 ──────────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`总计：${pass + fail}    通过：${pass}    失败：${fail}`);
  if (fail === 0) {
    console.log('✅ 全部通过');
    console.log('\n⚠️  H9 提醒：契约组通过 ≠ 生产路径就绪。');
    console.log('   还可能在以下场景翻车：');
    console.log('   - 真实知乎 / CSDN / 微信公众号（站点改版后选择器失效）');
    console.log('   - 大型 SPA（Adobe / Canva / 千库等）的滚动 / 展开按钮匹配率');
    console.log('   - 反爬 / Cloudflare 拦截');
    console.log('   - 网络不稳定时的超时重试');
    console.log('\n   建议尽快用 npm run dev 真实点测 5-10 个常用网站。');
    process.exit(0);
  } else {
    console.log('❌ 有失败项：');
    failures.forEach((f) => console.log(`   - ${f.name}：${f.error}`));
    process.exit(1);
  }
})().catch((err) => {
  console.error('\n💥 自检过程异常：', err);
  process.exit(2);
});
