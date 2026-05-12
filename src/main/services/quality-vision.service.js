/**
 * quality-vision.service.js — Phase-7.5 M7.5.2 图像质量审核服务
 *
 * 职责：对 Agent 自动生成的 PPT 配图做内容相关性 + 风格一致性审核，
 *      让"老师只需提示词微调即可用"的图片质量门槛有自动化检验。
 *
 * 设计原则：
 *  1. 模型可拔插：通过 deps.aiClient.chatVision 注入；缺省走 mock 模式
 *  2. 纯函数 + 模块级缓存：相同图像不重复请求 LLM
 *  3. 限流自适应：检测 429 / rate limit 时 exponential backoff 重试
 *  4. 不依赖真实 AI：单元测试始终可在 mock 模式下跑
 *  5. 遵守 CLAUDE.md H3：不调用业务生成模型，只对已生成结果做评分
 *
 * 公开 API：
 *  - assessImageQuality(input, deps?)            主审核入口
 *  - isQualityPass(assessment, thresholds?)      阈值判断
 *  - formatIssuesAsRefinementHint(assessment)    issues → 微调提示词
 *  - selfCheck()                                 内置 12 个用例
 *
 * 不引入新 npm 依赖：仅使用 fs / crypto。
 */

const fs = require('fs');
const crypto = require('crypto');

// ─── 常量 ─────────────────────────────────────────────────
const DEFAULT_RELEVANCE_THRESHOLD = 7;
const DEFAULT_STYLE_THRESHOLD = 7;
const MAX_RETRIES_DEFAULT = 3;
const BACKOFF_MS_BASE = 2000;
const VALID_CRITERIA = Object.freeze(['relevance_only', 'style_only', 'both']);

// ─── 模块级缓存 ────────────────────────────────────────────
// 使用 Map 而不是 LRU：本服务每次会话审核图片量级 < 100 张，
// Map 简单零依赖即可满足。需要更复杂淘汰策略时可由 deps.cache 注入。
const _moduleCache = new Map();

// ─── 工具函数 ──────────────────────────────────────────────
/**
 * 为图片输入生成稳定缓存 key。
 * 优先用 imagePath 的 SHA256，其次用 base64 前 100 字节的 SHA256，
 * 再附加 pageContext + styleAnchor + criteria 防止串味。
 *
 * 函数 > 30 行：负责把多种输入归一化为一致的字符串再 hash。
 */
function _computeCacheKey(input) {
  const { imagePath, imageBase64, pageContext, styleAnchor, criteria } = input || {};
  let imageFingerprint = '';
  if (typeof imagePath === 'string' && imagePath.trim()) {
    imageFingerprint = `path:${imagePath.trim()}`;
  } else if (typeof imageBase64 === 'string' && imageBase64.length > 0) {
    // 取前 100 字节做指纹（足够区分不同图，又避免大字符串频繁 hash）
    const head = imageBase64.slice(0, 100);
    imageFingerprint = `b64:${head}`;
  } else {
    imageFingerprint = 'empty';
  }
  const payload = JSON.stringify({
    img: imageFingerprint,
    page: String(pageContext || ''),
    style: String(styleAnchor || ''),
    crit: String(criteria || 'both'),
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * 校验输入合法性。返回 { ok, error? }。
 * 必须至少有 imagePath 或 imageBase64 之一。
 */
function _validateInput(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: '输入必须是对象' };
  }
  const { imagePath, imageBase64, criteria } = input;
  const hasPath = typeof imagePath === 'string' && imagePath.trim();
  const hasB64 = typeof imageBase64 === 'string' && imageBase64.length > 0;
  if (!hasPath && !hasB64) {
    return { ok: false, error: '必须提供 imagePath 或 imageBase64 之一' };
  }
  if (criteria !== undefined && !VALID_CRITERIA.includes(criteria)) {
    return {
      ok: false,
      error: `criteria 必须是 ${VALID_CRITERIA.join(' / ')} 之一，收到 ${JSON.stringify(criteria)}`,
    };
  }
  return { ok: true };
}

/**
 * 加载图片为可传给视觉模型的数据。
 * 优先 base64；imagePath 时同步读文件转 base64。
 * 返回 { ok, data?, error? }。
 */
function _loadImageData(input) {
  if (typeof input.imageBase64 === 'string' && input.imageBase64.length > 0) {
    return { ok: true, data: input.imageBase64 };
  }
  if (typeof input.imagePath === 'string' && input.imagePath.trim()) {
    try {
      const buf = fs.readFileSync(input.imagePath);
      return { ok: true, data: buf.toString('base64') };
    } catch (e) {
      return { ok: false, error: `读取图片失败: ${e.message}` };
    }
  }
  return { ok: false, error: '无可用图片数据' };
}

/**
 * 构建给视觉模型的 system / user prompt。
 * 严格要求模型按 JSON 返回，避免松散自然语言难以解析。
 */
function _buildVisionPrompts(input) {
  const { pageContext, styleAnchor, criteria = 'both' } = input;
  const wantRelevance = criteria === 'both' || criteria === 'relevance_only';
  const wantStyle = criteria === 'both' || criteria === 'style_only';

  const systemPrompt = [
    '你是职业教育 PPT 配图审核专家。',
    '你的任务：对一张 PPT 配图做评分，输出严格 JSON。',
    '评分维度：',
    wantRelevance ? '- relevanceScore: 0-10 整数，图片内容与"页面主题文字"的契合度' : '',
    wantStyle ? '- styleScore: 0-10 整数，图片与"风格基线描述"的视觉风格一致性' : '',
    '- issues: string[] 具体问题点（如"图片是商场鸟瞰图，但页面在讲店铺三维表现"）',
    '- suggestions: string[] 给后续重新生成图片的微调建议（中文，可直接拼接到 imagePrompt）',
    '不要输出解释、不要 Markdown 包裹，仅输出 JSON 对象。',
  ].filter(Boolean).join('\n');

  const userPrompt = [
    '【页面文字主题】',
    String(pageContext || '(未提供)'),
    '',
    '【风格基线描述】',
    String(styleAnchor || '(未提供)'),
    '',
    '【评分要求】',
    `criteria=${criteria}`,
    '请审视附图后输出 JSON。',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

/**
 * 解析模型返回的 JSON 文本。失败时返回保守默认值（避免上游崩溃）。
 * 函数 > 30 行：处理 ```json``` 包裹、纯 JSON、缺字段的多种情况。
 */
function _parseVisionResponse(rawText, criteria) {
  const wantRelevance = criteria === 'both' || criteria === 'relevance_only';
  const wantStyle = criteria === 'both' || criteria === 'style_only';

  let text = String(rawText || '').trim();
  // 去掉 ```json ... ``` 或 ``` ... ``` 包裹
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) text = fenced[1].trim();

  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    // 尝试抠出第一个 { ... }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(text.slice(start, end + 1));
      } catch { /* 仍然失败 */ }
    }
  }

  if (!obj || typeof obj !== 'object') {
    return {
      relevanceScore: wantRelevance ? 0 : null,
      styleScore: wantStyle ? 0 : null,
      issues: ['模型返回无法解析为 JSON'],
      suggestions: [],
      raw: { _parseFailed: true, original: rawText },
    };
  }

  const relevanceScore = wantRelevance
    ? _clampScore(obj.relevanceScore)
    : null;
  const styleScore = wantStyle ? _clampScore(obj.styleScore) : null;
  const issues = Array.isArray(obj.issues) ? obj.issues.map(String) : [];
  const suggestions = Array.isArray(obj.suggestions) ? obj.suggestions.map(String) : [];

  return { relevanceScore, styleScore, issues, suggestions, raw: obj };
}

/** 把任意值钳制到 [0, 10] 整数；非法值返回 0。 */
function _clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/** 判断错误是否属于限流。 */
function _isRateLimitError(err) {
  if (!err || !err.message) return false;
  const m = String(err.message).toLowerCase();
  return m.includes('429') || m.includes('rate limit') || m.includes('too many requests');
}

/** 简单 sleep（可被 deps.sleep 注入替代以加速测试）。 */
function _defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 主入口 ─────────────────────────────────────────────────
/**
 * 图像质量审核主函数。
 *
 * @param {Object} input
 * @param {string} [input.imagePath] 本地图片绝对路径
 * @param {string} [input.imageBase64] base64 图片数据
 * @param {string} [input.pageContext] 该图所属页面文字内容
 * @param {string} [input.styleAnchor] 风格基线描述
 * @param {string} [input.criteria='both'] 'relevance_only' | 'style_only' | 'both'
 * @param {Object} [deps]
 * @param {Object} [deps.aiClient] 含 chatVision 方法的视觉客户端
 * @param {Function} [deps.assessFn] 直接注入审核函数（高优先级，覆盖 aiClient）
 * @param {Map}      [deps.cache] 自定义缓存
 * @param {boolean}  [deps.mockMode] 强制 mock
 * @param {number}   [deps.maxRetries] 最大重试次数
 * @param {Function} [deps.sleep] 自定义 sleep（用于加速测试）
 * @returns {Promise<Object>}
 */
async function assessImageQuality(input, deps = {}) {
  // 1) 输入校验
  const v = _validateInput(input);
  if (!v.ok) return { ok: false, error: v.error };

  const criteria = input.criteria || 'both';
  const cache = deps.cache instanceof Map ? deps.cache : _moduleCache;
  const cacheKey = _computeCacheKey(input);

  // 2) 缓存命中
  if (cache.has(cacheKey)) {
    const hit = cache.get(cacheKey);
    return { ...hit, fromCache: true };
  }

  // 3) 决定走 mock / 真实 / 生产降级（Phase-7.6 R2）
  const assessFn = typeof deps.assessFn === 'function' ? deps.assessFn : null;
  const aiClient = deps.aiClient;
  const explicitMock = deps.mockMode === true;          // 测试场景显式指定
  const noVisionClient = !assessFn && (!aiClient || typeof aiClient.chatVision !== 'function');

  // 测试 / 显式 mock：保持原行为（默认通过）
  if (explicitMock) {
    const result = _buildMockResult(criteria);
    cache.set(cacheKey, result);
    return { ...result, fromCache: false };
  }

  // Phase-7.6 R2：生产环境无 Vision client → 返回"需人工审核"
  // 不再静默 mock 通过！让上游 pipeline 标记 manual_review 触发暂停
  if (noVisionClient) {
    const result = {
      ok: true,
      relevanceScore: 0,
      styleScore: 0,
      issues: ['Vision 审核服务未配置（缺多模态 aiClient.chatVision）'],
      suggestions: ['请在 API 配置中确认文本 Endpoint 已使用多模态模型（如 doubao-1.5-pro）'],
      needsManualReview: true,    // ★ 关键标志：让上游识别为"需人工审核"
      raw: { _productionDegraded: true, reason: 'no_vision_client' },
    };
    cache.set(cacheKey, result);
    return { ...result, fromCache: false };
  }

  // 4) 加载图片数据（真实模式才需要）
  const loaded = _loadImageData(input);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  // 5) 构建 prompt
  const { systemPrompt, userPrompt } = _buildVisionPrompts(input);

  // 6) 带 backoff 的调用
  const maxRetries = typeof deps.maxRetries === 'number' ? deps.maxRetries : MAX_RETRIES_DEFAULT;
  const sleep = typeof deps.sleep === 'function' ? deps.sleep : _defaultSleep;

  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      let rawText;
      if (assessFn) {
        rawText = await assessFn({ systemPrompt, userPrompt, imageData: loaded.data, criteria });
      } else {
        rawText = await aiClient.chatVision({
          systemPrompt,
          userPrompt,
          imageData: loaded.data,
          temperature: 0.1,
          maxTokens: 800,
        });
      }
      const parsed = _parseVisionResponse(rawText, criteria);
      const result = {
        ok: true,
        relevanceScore: parsed.relevanceScore,
        styleScore: parsed.styleScore,
        issues: parsed.issues,
        suggestions: parsed.suggestions,
        raw: parsed.raw,
        fromCache: false,
        attempts: attempt + 1,
      };
      cache.set(cacheKey, { ...result, fromCache: false });
      return result;
    } catch (e) {
      lastError = e;
      // Phase-7.7 P0-D：网络错误（SSL handshake / 超时）走 backoff 重试，耗尽后降级 needsManualReview
      const isNetwork = e.code === 'NETWORK_ERROR'
        || /handshake|ssl|tls|econnreset|etimedout|fetch failed/i.test(String(e.message || ''));
      if (isNetwork) {
        if (attempt < maxRetries - 1) {
          const wait = BACKOFF_MS_BASE * Math.pow(2, attempt);
          console.warn(`[quality-vision] 网络错误第 ${attempt + 1}/${maxRetries} 次，${wait}ms 后重试`);
          await sleep(wait);
          continue;
        }
        // 网络错误重试耗尽 → 降级为 needsManualReview（与 R2 逻辑一致）
        return {
          ok: true,
          relevanceScore: 0, styleScore: 0,
          issues: [`视觉模型网络连接失败（已重试 ${maxRetries} 次）：${String(e.message || '').slice(0, 100)}`],
          suggestions: ['检查网络连接 / 火山引擎 API 状态', '稍后重新生成此页', '人工审核当前生成的图片'],
          needsManualReview: true,
          raw: { _networkErrorDegraded: true, errorCode: e.code || 'unknown' },
          fromCache: false,
        };
      }
      if (_isRateLimitError(e)) {
        if (attempt < maxRetries - 1) {
          const wait = BACKOFF_MS_BASE * Math.pow(2, attempt); // 2s → 4s → 8s
          await sleep(wait);
          continue;
        }
        // 限流但已耗尽重试
        return {
          ok: false,
          error: `视觉模型限流，已重试 ${maxRetries} 次仍失败: ${e.message}`,
        };
      }
      // 非限流非网络错误立即返回失败
      return { ok: false, error: `视觉模型调用失败: ${e.message}` };
    }
  }
  return {
    ok: false,
    error: `视觉模型调用失败（已重试 ${maxRetries} 次）: ${lastError ? lastError.message : 'unknown'}`,
  };
}

/**
 * 构造 mock 模式下的固定通过结果。
 */
function _buildMockResult(criteria) {
  const wantRelevance = criteria === 'both' || criteria === 'relevance_only';
  const wantStyle = criteria === 'both' || criteria === 'style_only';
  return {
    ok: true,
    relevanceScore: wantRelevance ? 8 : null,
    styleScore: wantStyle ? 8 : null,
    issues: [],
    suggestions: [],
    raw: { _mock: true },
    fromCache: false,
    attempts: 0,
  };
}

// ─── 阈值判断 ──────────────────────────────────────────────
/**
 * 判断 assessment 是否达到通过阈值。
 * - 未计算的维度（null）视为通过（不卡）
 * - 自定义阈值 thresholds.relevance / thresholds.style
 *
 * @returns {boolean}
 */
function isQualityPass(assessment, thresholds = {}) {
  if (!assessment || assessment.ok !== true) return false;
  // Phase-7.6 R2：needsManualReview 标记直接判失败（生产环境无 vision client 的降级路径）
  if (assessment.needsManualReview === true) return false;
  const relThreshold = typeof thresholds.relevance === 'number'
    ? thresholds.relevance
    : DEFAULT_RELEVANCE_THRESHOLD;
  const styleThreshold = typeof thresholds.style === 'number'
    ? thresholds.style
    : DEFAULT_STYLE_THRESHOLD;

  if (assessment.relevanceScore !== null && assessment.relevanceScore !== undefined) {
    if (assessment.relevanceScore < relThreshold) return false;
  }
  if (assessment.styleScore !== null && assessment.styleScore !== undefined) {
    if (assessment.styleScore < styleThreshold) return false;
  }
  return true;
}

/**
 * 把 assessment.issues + suggestions 拼成中文微调提示词，
 * 直接可附加到下次 imagePrompt 末尾。
 */
function formatIssuesAsRefinementHint(assessment) {
  if (!assessment || assessment.ok !== true) return '';
  const issues = Array.isArray(assessment.issues) ? assessment.issues : [];
  const sugs = Array.isArray(assessment.suggestions) ? assessment.suggestions : [];
  if (issues.length === 0 && sugs.length === 0) return '';

  const parts = [];
  if (issues.length) {
    parts.push('上一版图片的问题：');
    issues.forEach((it, i) => parts.push(`${i + 1}. ${it}`));
  }
  if (sugs.length) {
    parts.push('请在重新生成时调整：');
    sugs.forEach((s, i) => parts.push(`${i + 1}. ${s}`));
  }
  return parts.join('\n');
}

/**
 * 清空模块级缓存（仅供测试）。
 */
function _clearCache() {
  _moduleCache.clear();
}

// ─── selfCheck ─────────────────────────────────────────────
/**
 * 内置自检：覆盖 12 个用例。无外部依赖，可在 verify 脚本中直接跑。
 * 函数 > 30 行：覆盖空输入 / mock / 缓存 / criteria / 阈值 / 重试等多个分支。
 */
async function selfCheck() {
  const must = (cond, msg) => { if (!cond) throw new Error(msg); };
  const cases = [
    ['empty input rejected', async () => {
      const r = await assessImageQuality({});
      must(r.ok === false, '空输入应返回 ok:false');
      must(typeof r.error === 'string' && r.error, '应包含 error 字符串');
    }],
    // Phase-7.6 R2 改造：缺 aiClient 时不再默认通过，而是返回 needsManualReview
    ['no aiClient → needs manual review (R2 production-degraded)', async () => {
      const r = await assessImageQuality(
        { imageBase64: 'AAAA', pageContext: 'p', styleAnchor: 's' },
        { cache: new Map() },
      );
      must(r.ok === true, '降级路径仍 ok:true（让上游识别 needsManualReview 标志）');
      must(r.needsManualReview === true, '应标记 needsManualReview:true');
      must(r.raw && r.raw._productionDegraded === true, '应标记 _productionDegraded');
      must(r.relevanceScore === 0 && r.styleScore === 0, '降级路径分数应为 0');
    }],
    ['explicit mockMode returns passing scores (test-only)', async () => {
      const r = await assessImageQuality(
        { imageBase64: 'BBBB' },
        { cache: new Map(), mockMode: true },   // ★ R2 后必须显式 mockMode 才走旧 mock 通过
      );
      must(r.relevanceScore === 8, `mock relevance 应=8，实=${r.relevanceScore}`);
      must(r.styleScore === 8, `mock style 应=8，实=${r.styleScore}`);
      must(Array.isArray(r.issues) && r.issues.length === 0, 'mock issues 应为空数组');
      must(r.raw && r.raw._mock === true, '应标记 _mock:true');
    }],
    ['cache hit on second call', async () => {
      const cache = new Map();
      const inp = { imageBase64: 'CCCC', pageContext: 'x' };
      const r1 = await assessImageQuality(inp, { cache });
      must(r1.fromCache === false, '首次不应缓存命中');
      const r2 = await assessImageQuality(inp, { cache });
      must(r2.fromCache === true, '二次应缓存命中');
    }],
    ['relevance_only excludes styleScore (mockMode)', async () => {
      const r = await assessImageQuality(
        { imageBase64: 'DDDD', criteria: 'relevance_only' },
        { cache: new Map(), mockMode: true },   // R2: 显式 mock
      );
      must(r.styleScore === null, `styleScore 应=null，实=${r.styleScore}`);
      must(typeof r.relevanceScore === 'number', 'relevanceScore 应是数字');
    }],
    ['style_only excludes relevanceScore (mockMode)', async () => {
      const r = await assessImageQuality(
        { imageBase64: 'EEEE', criteria: 'style_only' },
        { cache: new Map(), mockMode: true },
      );
      must(r.relevanceScore === null, 'relevanceScore 应=null');
      must(typeof r.styleScore === 'number', 'styleScore 应是数字');
    }],
    ['isQualityPass default threshold', async () => {
      must(isQualityPass({ ok: true, relevanceScore: 8, styleScore: 8 }), '8/8 应通过');
      must(!isQualityPass({ ok: true, relevanceScore: 6, styleScore: 8 }), 'relevance=6 应不通过');
      must(!isQualityPass({ ok: false, error: 'x' }), 'ok:false 应不通过');
    }],
    ['isQualityPass custom thresholds', async () => {
      const a = { ok: true, relevanceScore: 8, styleScore: 8 };
      must(isQualityPass(a), '8/8 默认应通过');
      must(!isQualityPass(a, { relevance: 9, style: 9 }), '阈值=9 时 8/8 应不通过');
      must(isQualityPass({ ok: true, relevanceScore: 9, styleScore: null }), 'null 维度应忽略');
    }],
    ['formatIssuesAsRefinementHint produces Chinese hint', async () => {
      const a = {
        ok: true,
        issues: ['图片是商场鸟瞰图，但页面在讲店铺三维表现'],
        suggestions: ['改为单店内饰透视', '加入展示道具与货架'],
      };
      const hint = formatIssuesAsRefinementHint(a);
      must(hint.includes('上一版图片的问题'), '应含问题段标题');
      must(hint.includes('请在重新生成时调整'), '应含建议段标题');
      must(hint.includes('单店内饰透视'), '应包含 suggestion 内容');
      must(formatIssuesAsRefinementHint({ ok: true, issues: [], suggestions: [] }) === '',
        '空 issues+suggestions 应返回空串');
    }],
    ['429 retries with backoff and eventually succeeds', async () => {
      let calls = 0;
      const sleeps = [];
      const fakeAssess = async () => {
        calls++;
        if (calls < 3) throw new Error('HTTP 429 Too Many Requests');
        return JSON.stringify({ relevanceScore: 9, styleScore: 9, issues: [], suggestions: [] });
      };
      const r = await assessImageQuality(
        { imageBase64: 'FFFF', criteria: 'both' },
        { assessFn: fakeAssess, cache: new Map(), maxRetries: 5, sleep: async (ms) => sleeps.push(ms) },
      );
      must(r.ok === true, `应最终成功，实=${JSON.stringify(r)}`);
      must(calls === 3, `应调用 3 次，实=${calls}`);
      must(sleeps[0] === 2000 && sleeps[1] === 4000, `backoff 应=[2000,4000]，实=${JSON.stringify(sleeps)}`);
      must(r.attempts === 3, `attempts 应=3，实=${r.attempts}`);
    }],
    ['429 exhausted returns error', async () => {
      let calls = 0;
      const r = await assessImageQuality(
        { imageBase64: 'GGGG' },
        {
          assessFn: async () => { calls++; throw new Error('rate limit hit'); },
          cache: new Map(), maxRetries: 2, sleep: async () => {},
        },
      );
      must(r.ok === false, '耗尽后应返回 ok:false');
      must(String(r.error).includes('已重试'), 'error 应说明重试耗尽');
      must(calls === 2, `应调用 2 次，实=${calls}`);
    }],
    ['non-rate-limit error returns immediately', async () => {
      let calls = 0;
      const r = await assessImageQuality(
        { imageBase64: 'HHHH' },
        {
          assessFn: async () => { calls++; throw new Error('Internal Server Error 500'); },
          cache: new Map(), maxRetries: 3, sleep: async () => {},
        },
      );
      must(r.ok === false, '应返回 ok:false');
      must(calls === 1, `非限流应只调 1 次，实=${calls}`);
    }],
  ];

  let passed = 0;
  const failures = [];
  for (let i = 0; i < cases.length; i++) {
    const [name, fn] = cases[i];
    try { await fn(); passed++; }
    catch (e) { failures.push({ caseIndex: i + 1, name, message: e.message }); }
  }
  return { passed, total: cases.length, failures, success: failures.length === 0 };
}

// ─── 导出 ────────────────────────────────────────────────
module.exports = {
  // 常量
  DEFAULT_RELEVANCE_THRESHOLD,
  DEFAULT_STYLE_THRESHOLD,
  VALID_CRITERIA,

  // 主 API
  assessImageQuality,
  isQualityPass,
  formatIssuesAsRefinementHint,

  // 自检
  selfCheck,

  // 测试辅助
  _clearCache,
  _computeCacheKey,
};
