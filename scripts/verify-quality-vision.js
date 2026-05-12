/**
 * verify-quality-vision.js — Phase-7.5 M7.5.2 图像质量审核 service 验证脚本
 *
 * 验证 4 个层面：
 *   1) selfCheck         — quality-vision.service 内置 12 个用例
 *   2) integrationMock   — 完整调 service 的 mock 路径（5 个场景）
 *   3) integrationReal   — 模拟真实 aiClient 调用（mock chatVision）
 *   4) cacheAndRetry     — 缓存命中 + 限流退避验证
 *
 * 用法：node scripts/verify-quality-vision.js
 *
 * 退出码：0=全部通过，1=任意失败
 */

const path = require('path');
const service = require(path.join(__dirname, '..', 'src', 'main', 'services', 'quality-vision.service.js'));

const {
  assessImageQuality,
  isQualityPass,
  formatIssuesAsRefinementHint,
  selfCheck,
  _clearCache,
} = service;

// ─── 1) selfCheck ────────────────────────────────────────
async function runSelfCheck() {
  return await selfCheck();
}

// ─── 2) integrationMock：完整调 service mock 路径 ─────────
async function runIntegrationMock() {
  const result = { passed: 0, total: 0, failures: [] };
  const cases = [];

  // 场景 1：Phase-7.6 R2 — 缺 aiClient 走"生产降级"路径，返回 needsManualReview
  cases.push({
    name: 'no aiClient → needs manual review (R2 production-degraded)',
    fn: async () => {
      const r = await assessImageQuality(
        { imageBase64: 'AAA', pageContext: '店铺三维表现', styleAnchor: '专业职教风' },
        { cache: new Map() },
      );
      if (!r.ok) throw new Error('降级路径仍 ok:true');
      if (r.needsManualReview !== true) throw new Error('应标记 needsManualReview:true');
      if (isQualityPass(r)) throw new Error('降级路径不应通过 isQualityPass');
    },
  });

  // 场景 2：mockMode 显式开启 + relevance_only
  cases.push({
    name: 'mockMode + relevance_only',
    fn: async () => {
      const r = await assessImageQuality(
        { imageBase64: 'BBB', criteria: 'relevance_only' },
        { cache: new Map(), mockMode: true },
      );
      if (r.styleScore !== null) throw new Error('styleScore 应=null');
      if (typeof r.relevanceScore !== 'number') throw new Error('relevanceScore 应是数字');
    },
  });

  // 场景 3：mockMode 显式开启 + style_only
  cases.push({
    name: 'mockMode + style_only',
    fn: async () => {
      const r = await assessImageQuality(
        { imageBase64: 'CCC', criteria: 'style_only' },
        { cache: new Map(), mockMode: true },
      );
      if (r.relevanceScore !== null) throw new Error('relevanceScore 应=null');
    },
  });

  // 场景 4：mockMode 强制开启（即使提供了 aiClient）
  cases.push({
    name: 'mockMode forces mock',
    fn: async () => {
      const r = await assessImageQuality(
        { imageBase64: 'DDD' },
        {
          aiClient: { chatVision: async () => '{"relevanceScore":3}' },
          mockMode: true,
          cache: new Map(),
        },
      );
      if (!r.raw._mock) throw new Error('mockMode=true 应强制走 mock 而不调用 aiClient');
    },
  });

  // 场景 5：缺失输入
  cases.push({
    name: 'missing image input rejected',
    fn: async () => {
      const r = await assessImageQuality({ pageContext: 'x' });
      if (r.ok !== false) throw new Error('缺图应返回 ok:false');
    },
  });

  for (const c of cases) {
    result.total++;
    try {
      await c.fn();
      result.passed++;
    } catch (e) {
      result.failures.push({ name: c.name, message: e.message });
    }
  }
  return result;
}

// ─── 3) integrationReal：模拟真实 aiClient ────────────────
async function runIntegrationReal() {
  const result = { passed: 0, total: 0, failures: [] };
  const cases = [];

  // 场景 1：aiClient.chatVision 返回标准 JSON
  cases.push({
    name: 'real aiClient json response',
    fn: async () => {
      const fakeClient = {
        chatVision: async ({ systemPrompt, userPrompt }) => {
          if (!systemPrompt.includes('PPT 配图审核专家')) {
            throw new Error('system prompt 异常');
          }
          if (!userPrompt.includes('页面文字主题')) {
            throw new Error('user prompt 应包含页面文字主题段');
          }
          return JSON.stringify({
            relevanceScore: 9,
            styleScore: 8,
            issues: ['色彩偏冷'],
            suggestions: ['加入暖色调元素'],
          });
        },
      };
      const r = await assessImageQuality(
        { imageBase64: 'XXXX', pageContext: '店铺三维', styleAnchor: '暖色专业风' },
        { aiClient: fakeClient, cache: new Map() },
      );
      if (!r.ok) throw new Error(`应成功，实=${JSON.stringify(r)}`);
      if (r.relevanceScore !== 9 || r.styleScore !== 8) throw new Error('解析评分错');
      if (r.issues.length !== 1 || !r.issues[0].includes('色彩偏冷')) throw new Error('issues 解析错');
      if (r.attempts !== 1) throw new Error(`attempts 应=1，实=${r.attempts}`);
    },
  });

  // 场景 2：返回包了 ```json``` 代码块
  cases.push({
    name: 'real aiClient fenced json',
    fn: async () => {
      const fakeClient = {
        chatVision: async () => '```json\n{"relevanceScore":7,"styleScore":7,"issues":[],"suggestions":[]}\n```',
      };
      const r = await assessImageQuality(
        { imageBase64: 'YYYY' },
        { aiClient: fakeClient, cache: new Map() },
      );
      if (!r.ok || r.relevanceScore !== 7) throw new Error('fenced JSON 应能解析');
    },
  });

  // 场景 3：模型返回非 JSON 文本 → 走容错 fallback
  cases.push({
    name: 'real aiClient garbage response → fallback parse',
    fn: async () => {
      const fakeClient = { chatVision: async () => '抱歉无法分析' };
      const r = await assessImageQuality(
        { imageBase64: 'ZZZZ' },
        { aiClient: fakeClient, cache: new Map() },
      );
      if (!r.ok) throw new Error('解析失败也应 ok:true（fallback）');
      if (r.relevanceScore !== 0) throw new Error('解析失败 relevance 应=0（保守值）');
      if (!r.raw._parseFailed) throw new Error('应标记 _parseFailed');
      if (!isQualityPass(r) === false) { /* 0 必然不通过，OK */ }
      if (isQualityPass(r)) throw new Error('解析失败的 0 分不应通过');
    },
  });

  // 场景 4：assessFn 优先于 aiClient
  cases.push({
    name: 'assessFn overrides aiClient',
    fn: async () => {
      let aiCalled = false;
      const fakeClient = {
        chatVision: async () => { aiCalled = true; return '{}'; },
      };
      const fakeAssess = async () => '{"relevanceScore":10,"styleScore":10,"issues":[],"suggestions":[]}';
      const r = await assessImageQuality(
        { imageBase64: 'AAAA' },
        { aiClient: fakeClient, assessFn: fakeAssess, cache: new Map() },
      );
      if (aiCalled) throw new Error('assessFn 存在时不应调 aiClient');
      if (r.relevanceScore !== 10) throw new Error('assessFn 返回未生效');
    },
  });

  // 场景 5：分数被钳制到 [0,10]
  cases.push({
    name: 'score clamping',
    fn: async () => {
      const fakeClient = {
        chatVision: async () => '{"relevanceScore":15,"styleScore":-3,"issues":[],"suggestions":[]}',
      };
      const r = await assessImageQuality(
        { imageBase64: 'BBBB' },
        { aiClient: fakeClient, cache: new Map() },
      );
      if (r.relevanceScore !== 10) throw new Error(`15 应钳制到 10，实=${r.relevanceScore}`);
      if (r.styleScore !== 0) throw new Error(`-3 应钳制到 0，实=${r.styleScore}`);
    },
  });

  for (const c of cases) {
    result.total++;
    try {
      await c.fn();
      result.passed++;
    } catch (e) {
      result.failures.push({ name: c.name, message: e.message });
    }
  }
  return result;
}

// ─── 4) cacheAndRetry：缓存与限流 ────────────────────────
async function runCacheAndRetry() {
  const result = { passed: 0, total: 0, failures: [] };
  const cases = [];

  // 场景 1：缓存命中后不再调 aiClient
  cases.push({
    name: 'cache hit avoids second aiClient call',
    fn: async () => {
      let calls = 0;
      const fakeClient = {
        chatVision: async () => { calls++; return '{"relevanceScore":8,"styleScore":8,"issues":[],"suggestions":[]}'; },
      };
      const cache = new Map();
      const inp = { imageBase64: 'CACHEKEY1', pageContext: 'p', styleAnchor: 's' };
      const r1 = await assessImageQuality(inp, { aiClient: fakeClient, cache });
      const r2 = await assessImageQuality(inp, { aiClient: fakeClient, cache });
      if (calls !== 1) throw new Error(`aiClient 应只调 1 次，实=${calls}`);
      if (r1.fromCache !== false) throw new Error('首次不应是缓存');
      if (r2.fromCache !== true) throw new Error('二次应是缓存');
    },
  });

  // 场景 2：不同 pageContext 不共享缓存
  cases.push({
    name: 'different pageContext bypasses cache',
    fn: async () => {
      let calls = 0;
      const fakeClient = {
        chatVision: async () => { calls++; return '{"relevanceScore":7,"styleScore":7,"issues":[],"suggestions":[]}'; },
      };
      const cache = new Map();
      await assessImageQuality({ imageBase64: 'IMG', pageContext: 'A' }, { aiClient: fakeClient, cache });
      await assessImageQuality({ imageBase64: 'IMG', pageContext: 'B' }, { aiClient: fakeClient, cache });
      if (calls !== 2) throw new Error(`不同 pageContext 应各调 1 次，实=${calls}`);
    },
  });

  // 场景 3：限流 backoff 顺序
  cases.push({
    name: 'rate limit backoff sequence',
    fn: async () => {
      let calls = 0;
      const sleeps = [];
      const fakeClient = {
        chatVision: async () => {
          calls++;
          if (calls < 3) throw new Error('429 too many requests');
          return '{"relevanceScore":9,"styleScore":9,"issues":[],"suggestions":[]}';
        },
      };
      const r = await assessImageQuality(
        { imageBase64: 'BACKOFF' },
        {
          aiClient: fakeClient,
          cache: new Map(),
          maxRetries: 5,
          sleep: async (ms) => { sleeps.push(ms); },
        },
      );
      if (!r.ok) throw new Error('应最终成功');
      if (sleeps.join(',') !== '2000,4000') throw new Error(`backoff 应 [2000,4000]，实 [${sleeps.join(',')}]`);
    },
  });

  // 场景 4：耗尽重试后失败
  cases.push({
    name: 'rate limit exhausted',
    fn: async () => {
      const fakeClient = {
        chatVision: async () => { throw new Error('rate limit'); },
      };
      const r = await assessImageQuality(
        { imageBase64: 'EXHAUST' },
        { aiClient: fakeClient, cache: new Map(), maxRetries: 2, sleep: async () => {} },
      );
      if (r.ok !== false) throw new Error('耗尽应返回 ok:false');
    },
  });

  // 场景 5：formatIssuesAsRefinementHint 集成
  cases.push({
    name: 'formatIssuesAsRefinementHint integration',
    fn: async () => {
      const fakeClient = {
        chatVision: async () => JSON.stringify({
          relevanceScore: 4,
          styleScore: 5,
          issues: ['图片是商场鸟瞰图，与店铺三维表现主题不符'],
          suggestions: ['改为单店室内透视', '强调展示道具'],
        }),
      };
      const r = await assessImageQuality(
        { imageBase64: 'HINT', pageContext: '店铺三维表现' },
        { aiClient: fakeClient, cache: new Map() },
      );
      const hint = formatIssuesAsRefinementHint(r);
      if (!hint.includes('单店室内透视')) throw new Error('hint 应包含 suggestion');
      if (isQualityPass(r)) throw new Error('4/5 不应通过默认阈值');
    },
  });

  for (const c of cases) {
    result.total++;
    try {
      await c.fn();
      result.passed++;
    } catch (e) {
      result.failures.push({ name: c.name, message: e.message });
    }
  }
  return result;
}

// ─── 主流程 ─────────────────────────────────────────────
async function main() {
  _clearCache();
  const checkedAt = new Date().toISOString();

  const selfCheckRes = await runSelfCheck();
  const integMock = await runIntegrationMock();
  const integReal = await runIntegrationReal();
  const cacheRetry = await runCacheAndRetry();

  const ok =
    selfCheckRes.failures.length === 0 &&
    integMock.failures.length === 0 &&
    integReal.failures.length === 0 &&
    cacheRetry.failures.length === 0;

  const passed =
    selfCheckRes.passed + integMock.passed + integReal.passed + cacheRetry.passed;
  const total =
    selfCheckRes.total + integMock.total + integReal.total + cacheRetry.total;
  const failures = [
    ...selfCheckRes.failures.map((f) => ({ section: 'selfCheck', ...f })),
    ...integMock.failures.map((f) => ({ section: 'integrationMock', ...f })),
    ...integReal.failures.map((f) => ({ section: 'integrationReal', ...f })),
    ...cacheRetry.failures.map((f) => ({ section: 'cacheAndRetry', ...f })),
  ];

  const report = {
    ok,
    passed,
    total,
    failures,
    checkedAt,
    breakdown: {
      selfCheck: { passed: selfCheckRes.passed, total: selfCheckRes.total },
      integrationMock: { passed: integMock.passed, total: integMock.total },
      integrationReal: { passed: integReal.passed, total: integReal.total },
      cacheAndRetry: { passed: cacheRetry.passed, total: cacheRetry.total },
    },
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message, stack: e.stack }, null, 2));
  process.exit(1);
});
