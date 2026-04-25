const { ArkCourseClient } = require('./ark-course-client');

function normalizeModelName(model) {
  const raw = String(model || '').trim().toLowerCase();
  if (!raw) return 'deepseek';
  if (raw.includes('deepseek')) return 'deepseek';
  if (raw.includes('doubao')) return 'doubao_text';
  return raw;
}

function resolveProviderConfig({ payload = {}, db }) {
  const provider = String(payload.provider || 'ark').toLowerCase();
  const model = normalizeModelName(payload.model || db?.getApiKey?.('ark_model_text_default') || 'deepseek');
  const endpointId =
    payload.endpointId ||
    (model === 'deepseek' ? db?.getApiKey?.('ark_endpoint_text_deepseek') : null) ||
    (model === 'doubao_text' ? db?.getApiKey?.('ark_endpoint_doubao_text') : null) ||
    db?.getApiKey?.(`ark_endpoint_${model}`) ||
    db?.getApiKey?.('ark_endpoint_text') ||
    db?.getApiKey?.('ark_endpoint') ||
    '';

  const apiKey = String(
    payload.apiKey ||
    (provider === 'deepseek' ? db?.getApiKey?.('deepseek') : db?.getApiKey?.('ark')) ||
    ''
  ).trim();

  return {
    provider,
    model,
    endpointId: String(endpointId || '').trim(),
    apiKey
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

