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

/**
 * Phase-7.7 P0-D：识别网络层错误（SSL handshake / 超时 / DNS / 连接重置）
 * 这些是 HTTP 状态码之外的错误，需要单独的重试 + 降级路径
 */
function isNetworkError(err) {
  if (!err) return false;
  const msg = String(err.message || err || '').toLowerCase();
  const code = String(err.code || err.cause?.code || '').toUpperCase();
  return /handshake|ssl|tls|econnreset|enotfound|etimedout|fetch failed|network|aborted/i.test(msg)
    || ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNABORTED'].includes(code);
}

async function postJsonWithRetry(url, apiKey, body, options = {}) {
  const {
    retries = 2,
    retryStatuses = [429, 500, 502, 503, 504],
    headers = {},
    backoffMs = 700
  } = options;

  let lastNetworkError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(body)
      });
    } catch (networkErr) {
      // Phase-7.7 P0-D：网络层错误（SSL handshake / 连接超时等）也走重试 + backoff
      if (isNetworkError(networkErr) && attempt < retries) {
        lastNetworkError = networkErr;
        console.warn(`[request-utils] 网络层错误（第 ${attempt + 1}/${retries + 1} 次），${backoffMs * (attempt + 1)}ms 后重试：${String(networkErr.message || '').slice(0, 100)}`);
        await delay(backoffMs * (attempt + 1));
        continue;
      }
      // 重试耗尽 / 非网络错误 → 抛明确的网络错误（让上层识别）
      const err = new Error(
        `网络连接失败（已重试 ${attempt} 次）：${String(networkErr.message || networkErr).slice(0, 200)}`
      );
      err.code = 'NETWORK_ERROR';
      err.cause = networkErr;
      err.retries = attempt;
      throw err;
    }

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

  // 重试耗尽且最后一次是网络错误（理论上上面已 throw，这里是兜底）
  if (lastNetworkError) {
    const err = new Error(`网络连接失败（已重试 ${retries + 1} 次）：${String(lastNetworkError.message || '').slice(0, 200)}`);
    err.code = 'NETWORK_ERROR';
    err.cause = lastNetworkError;
    throw err;
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
  normalizeErrorMessage,
  isNetworkError,   // P0-D: 供上层 service 识别网络错误后做"暂停"决策
};
