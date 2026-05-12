const { ArkCourseClient } = require('./ark-course-client');

/**
 * Phase-7.7 B5：把硬编码的 'deepseek' 默认值改成 'doubao_text'
 *   原因：用户已不再使用 deepseek 端点，但 normalizeModelName 仍把"未识别"的输入映射到 deepseek，
 *         导致 resolveProviderConfig 优先去查 ark_endpoint_text_deepseek，命中老端点 → RPM 限流。
 *   现在：未识别 → doubao_text，与用户实际配置（豆包文本端点）保持一致。
 */
function normalizeModelName(model) {
  const raw = String(model || '').trim().toLowerCase();
  if (!raw) return 'doubao_text';
  if (raw.includes('deepseek')) return 'deepseek';
  if (raw.includes('doubao')) return 'doubao_text';
  return raw;
}

/**
 * 解析当前请求应使用的 AI provider / model / endpoint / apiKey。
 *
 * Phase-7.7 B5 改动：
 *   1. 默认 model 从 'deepseek' 改成 'doubao_text'
 *   2. 增加诊断日志：打印实际命中的 endpoint key
 *   3. deepseek 端点 key 命中时 console.warn 提示老师可能用着过期端点
 *
 * Phase-7.7 B6 改动（2026-04-29）：
 *   增加 purpose 参数，支持"按用途选 endpoint"：
 *     - purpose='lecture_formal' → 优先 ark_endpoint_lecture_formal（正式稿专用），fallback 到 ark_endpoint_text
 *     - purpose='general' / undefined → 保持现状（仅 ark_endpoint_text）
 *
 *   背景：doubao-seed-2.0-pro reasoning model 太慢/易触发 burst 保护，
 *   老师创建了 doubao-1-5-pro-32k 给正式稿用，但其他场景（vision 审核）仍需 seed 2.0 pro。
 *
 *   向后兼容：未传 purpose 行为完全不变。
 *
 * @param {Object} args
 * @param {Object} [args.payload]
 * @param {Object} [args.db]
 * @param {'lecture_formal'|'general'} [args.purpose] - 调用目的，影响 endpoint 查找优先级
 */
function resolveProviderConfig({ payload = {}, db, purpose }) {
  const provider = String(payload.provider || 'ark').toLowerCase();
  const model = normalizeModelName(
    payload.model || db?.getApiKey?.('ark_model_text_default') || 'doubao_text'
  );

  // 显式记录每个 key 的命中情况，便于诊断"为什么调了 X 端点"
  const trace = { source: null, value: '' };
  const tryKey = (label, val) => {
    if (val && !trace.value) {
      trace.source = label;
      trace.value = String(val).trim();
    }
  };

  // B5 优先级修复（2026-04-29）：
  // 之前 ark_endpoint_text_deepseek 优先于 ark_endpoint_text，导致用户在 UI 改了新端点
  // （写入 ark_endpoint_text）但被旧的 ark_endpoint_text_deepseek 截胡。
  // 现在的优先级（自上而下）：
  //   1. payload.endpointId                  ——单次调用显式指定，最高
  //   2. ark_endpoint_lecture_formal （仅 purpose='lecture_formal' 时） ——B6 正式稿专用
  //   3. ark_endpoint_text                   ——UI 设置面板「2. 文本生成 Endpoint」实际填的值
  //   4. ark_endpoint_doubao_text            ——历史细分 key（仅 model=doubao 时）
  //   5. ark_endpoint_text_deepseek          ——历史细分 key（仅 model=deepseek 时）
  //   6. ark_endpoint_${model}               ——通用兜底
  //   7. ark_endpoint                        ——最老的兜底
  // 设计原则：UI 字段（用户最新意图）始终高于细分 key（历史遗留）。
  // B6：purpose 专用字段插在 payload.endpointId 之后、ark_endpoint_text 之前——
  //     使得"用户为正式稿专门配的 endpoint"生效，但单次调用 payload.endpointId 仍最高。
  tryKey('payload.endpointId', payload.endpointId);
  if (purpose === 'lecture_formal') {
    tryKey('db.ark_endpoint_lecture_formal', db?.getApiKey?.('ark_endpoint_lecture_formal'));
  }
  tryKey('db.ark_endpoint_text', db?.getApiKey?.('ark_endpoint_text'));
  if (model === 'doubao_text') tryKey('db.ark_endpoint_doubao_text', db?.getApiKey?.('ark_endpoint_doubao_text'));
  if (model === 'deepseek') tryKey('db.ark_endpoint_text_deepseek', db?.getApiKey?.('ark_endpoint_text_deepseek'));
  tryKey(`db.ark_endpoint_${model}`, db?.getApiKey?.(`ark_endpoint_${model}`));
  tryKey('db.ark_endpoint', db?.getApiKey?.('ark_endpoint'));

  const endpointId = trace.value;

  const apiKey = String(
    payload.apiKey ||
    (provider === 'deepseek' ? db?.getApiKey?.('deepseek') : db?.getApiKey?.('ark')) ||
    ''
  ).trim();

  // B5 诊断日志：每次解析都打印（开发期），便于"到底用哪个端点"对账
  // 仅在 endpoint 真的解析到时打——避免完全没配置时刷屏
  if (endpointId) {
    const purposeTag = purpose ? ` purpose=${purpose}` : '';
    console.log(
      `[provider-config] model=${model}${purposeTag} endpoint=${endpointId} ` +
      `from=${trace.source} apiKey=${apiKey ? '(set)' : '(empty)'}`
    );
    // 兜底警示：老师把 deepseek 端点填到了 ark_endpoint_text，但 model 已切到 doubao
    // 通过 endpointId 模式无法可靠识别，这里只在 source 是 deepseek 专用 key 时提醒
    if (trace.source === 'db.ark_endpoint_text_deepseek') {
      console.warn(
        '[provider-config] ⚠️ 当前命中 ark_endpoint_text_deepseek（旧 deepseek 端点）。' +
        '若该端点已绑 deepseek-v3-1，可能触发 RPM 限流——建议在 UI「文本生成 Endpoint」里改为 doubao 端点。'
      );
    }
  } else if (apiKey) {
    // 有 API Key 但没解析到 endpoint —— 显式 warn 而非静默
    console.warn(
      `[provider-config] ⚠️ 已配置 apiKey 但未解析到 endpoint（model=${model}）。` +
      `请在 UI 设置「2. 文本生成 Endpoint」填写 ep-xxx，否则 AI 调用会失败。`
    );
  }

  return {
    provider,
    model,
    endpointId,
    apiKey,
    // B5：把命中来源也返回出去，调用方需要诊断时可以打日志
    _endpointTrace: trace.source,
  };
}

function createAiClientByConfig(config) {
  if (!config?.apiKey) return null;
  if (config.provider !== 'ark' && config.provider !== 'deepseek') return null;
  if (!config.endpointId) return null;
  return new ArkCourseClient({
    apiKey: config.apiKey,
    endpointId: config.endpointId
  });
}

module.exports = {
  normalizeModelName,
  resolveProviderConfig,
  createAiClientByConfig
};
