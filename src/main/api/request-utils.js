function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function extractApiDetail(raw) {
  const parsed = safeJsonParse(raw);
  const detail = parsed?.error?.message || parsed?.message || parsed?.error?.detail || raw || 'Unknown error';
  const requestId =
    parsed?.error?.request_id ||
    parsed?.request_id ||
    parsed?.requestId ||
    String(detail || '').match(/request id[:：]\s*([a-z0-9_-]+)/i)?.[1] ||
    '';
  return {
    parsed,
    detail: String(detail || '').trim() || 'Unknown error',
    requestId: String(requestId || '').trim()
  };
}

function buildApiErrorMessage({ status, detail, requestId, retries = 0 }) {
  const retrySuffix = retries > 0 ? `，系统已自动重试 ${retries} 次仍未成功` : '';
  let message = '';

  if (status === 429) {
    message = `文本服务当前繁忙${retrySuffix}，请稍后再试。`;
  } else if ([500, 502, 503, 504].includes(status)) {
    message = `文本服务暂时不可用${retrySuffix}，请稍后再试。`;
  } else if (status === 401 || status === 403) {
    message = `接口鉴权失败（${status}），请检查 API Key 和 Endpoint 配置。`;
  } else if (status === 404) {
    message = '接口地址或模型 Endpoint 不可用，请检查文本 Endpoint 配置。';
  } else {
    message = `接口调用失败（${status}）。`;
  }

  const detailText = String(detail || '').trim();
  const detailSuffix =
    detailText && !/service is currently unable to handle additional requests/i.test(detailText)
      ? ` 详情：${detailText}`
      : '';
  const requestSuffix = requestId ? ` 请求ID：${requestId}` : '';
  return `${message}${detailSuffix}${requestSuffix}`.trim();
}

function createApiError({ status, detail, requestId, retries = 0 }) {
  const error = new Error(buildApiErrorMessage({ status, detail, requestId, retries }));
  error.status = status;
  error.detail = detail;
  error.requestId = requestId;
  error.retries = retries;
  return error;
}

async function postJsonWithRetry(url, apiKey, body, options = {}) {
  const {
    retries = 2,
    retryStatuses = [429, 500, 502, 503, 504],
    headers = {},
    backoffMs = 700
  } = options;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body)
    });

    const raw = await response.text();
    if (response.ok) {
      try {
        return raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`API 返回了非 JSON 响应：${String(raw || '').slice(0, 300)}`);
      }
    }

    const { detail, requestId } = extractApiDetail(raw);
    const shouldRetry = retryStatuses.includes(response.status) && attempt < retries;
    if (shouldRetry) {
      await delay(backoffMs * (attempt + 1));
      continue;
    }

    throw createApiError({
      status: response.status,
      detail,
      requestId,
      retries: attempt
    });
  }

  throw new Error('接口请求失败：未知错误');
}

function normalizeErrorMessage(error) {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  return String(error.message || error.detail || '未知错误');
}

module.exports = {
  postJsonWithRetry,
  normalizeErrorMessage
};
