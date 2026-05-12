const { postJsonWithRetry } = require('./request-utils');

function extractJsonArray(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end < start) return null;
  const sliced = candidate.slice(start, end + 1);
  return JSON.parse(sliced);
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  const sliced = candidate.slice(start, end + 1);
  return JSON.parse(sliced);
}

async function postJson(url, apiKey, body) {
  return postJsonWithRetry(url, apiKey, body, { retries: 2 });
}

class ArkCourseClient {
  constructor({ apiKey, endpointId, baseURL = 'https://ark.cn-beijing.volces.com/api/v3' }) {
    this.apiKey = apiKey;
    this.endpointId = endpointId;
    this.baseURL = baseURL;
  }

  /**
   * Phase-7.7 B7（2026-04-29）：加 responseFormat 参数，支持火山的 JSON 严格输出模式。
   *   - 默认 false（保持向后兼容，纯文本模式）
   *   - true 时传 `response_format: { type: "json_object" }`，强制模型输出严格 JSON
   *
   * 背景：formal-generator 让 AI 输出 `{"script": "..."}` 结构，但 AI 在长文本内容里
   *      经常忘记转义双引号，导致 JSON.parse 失败 → 全段走 fallback。
   *      启用 JSON Mode 后，平台保证返回内容是合法 JSON。
   *
   * 注意：开 JSON Mode 时 systemPrompt 必须明确包含"JSON"字样（火山 API 要求），
   *      否则会报错。formal-generator 的 systemPrompt 已包含此约束。
   */
  async chatJson({ systemPrompt, userPrompt, temperature = 0.2, maxTokens = 8000, responseFormat = false }) {
    const body = {
      model: this.endpointId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      max_tokens: maxTokens
    };
    const wantJsonMode = responseFormat === true || responseFormat === 'json_object';
    if (wantJsonMode) {
      body.response_format = { type: 'json_object' };
    }

    try {
      const response = await postJson(`${this.baseURL}/chat/completions`, this.apiKey, body);
      return response?.choices?.[0]?.message?.content || '';
    } catch (err) {
      const msg = String(err?.message || '');
      // Phase-9 兼容修复（2026-05-10）：
      // doubao 的某些 endpoint（如 ep-m-...多模态文本端点）不支持 response_format=json_object，
      // 会返回 400 "json_object is not supported by this model"。
      // 这里捕获该错误，自动去掉 response_format 重试一次（降级到纯文本 JSON 模式）。
      const isJsonModeUnsupported = wantJsonMode && (
        msg.includes('json_object') &&
        (msg.includes('is not supported') || msg.includes('not valid'))
      );
      if (isJsonModeUnsupported) {
        console.warn('[ark-course-client] 当前 endpoint 不支持 json_object response_format，自动降级为纯文本 JSON 模式重试');
        const fallbackBody = { ...body };
        delete fallbackBody.response_format;
        const response = await postJson(`${this.baseURL}/chat/completions`, this.apiKey, fallbackBody);
        return response?.choices?.[0]?.message?.content || '';
      }
      throw err;
    }
  }

  /**
   * Phase-7.6 R1: 多模态视觉理解调用（用于 PPT 配图 / 框架信息图质量审核）
   *
   * 前提：endpointId 必须指向支持视觉输入的多模态模型（如 doubao-1.5-pro / doubao-vision-pro）
   *
   * @param {Object} params
   * @param {string} params.systemPrompt
   * @param {string} params.userPrompt
   * @param {string} params.imageData - base64 图片字符串（不含 data:image 前缀）或完整 data URL
   * @param {string} [params.imageFormat='png'] - png / jpeg / webp
   * @param {number} [params.temperature=0.1]
   * @param {number} [params.maxTokens=800]
   * @returns {Promise<string>} 模型返回的文本（含 JSON 评分）
   */
  async chatVision({ systemPrompt, userPrompt, imageData, imageFormat = 'png', temperature = 0.1, maxTokens = 800 }) {
    if (!imageData) throw new Error('chatVision: imageData 必填');
    // 兼容 base64 / data URL 两种输入
    const dataUrl = String(imageData).startsWith('data:')
      ? imageData
      : `data:image/${imageFormat};base64,${imageData}`;

    const response = await postJson(`${this.baseURL}/chat/completions`, this.apiKey, {
      model: this.endpointId,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ],
      temperature,
      max_tokens: maxTokens
    });
    return response?.choices?.[0]?.message?.content || '';
  }

  async generateSceneOutlines({ requirementsText, courseInfo, styleCard }) {
    const systemPrompt = [
      '你是课程设计专家。',
      '根据用户需求输出 SceneOutline JSON 数组。',
      '仅输出 JSON 数组，不要解释。'
    ].join('\n');

    const userPrompt = [
      '请生成课程场景大纲，场景类型仅允许: slide, quiz, interactive, pbl。',
      '每个对象包含: id,type,title,description,durationMin,moduleRef,language。',
      'quiz 必须带 quizConfig；interactive 必须带 interactiveConfig；pbl 必须带 pblConfig。',
      '课程信息:',
      JSON.stringify(courseInfo || {}, null, 2),
      '风格卡:',
      JSON.stringify(styleCard || {}, null, 2),
      '需求文本:',
      String(requirementsText || '')
    ].join('\n');

    const text = await this.chatJson({
      systemPrompt,
      userPrompt,
      temperature: 0.15,
      maxTokens: 6000
    });
    const parsed = extractJsonArray(text);
    if (!Array.isArray(parsed)) {
      throw new Error('Ark outlines parse failed: response is not a JSON array');
    }
    return parsed;
  }

  async generateScene(outline) {
    const systemPrompt = [
      '你是教学内容生成器。',
      '请基于场景大纲生成单个 Scene JSON 对象。',
      '仅输出 JSON 对象，不要解释。'
    ].join('\n');

    const userPrompt = [
      '请输出字段: id,type,title,moduleRef,content,actions,notes,assets。',
      '根据 type 生成对应 content:',
      '- slide: {title,summary,keyPoints,visualHint}',
      '- quiz: {title,questions,config}',
      '- interactive: {title,html,config}',
      '- pbl: {title,projectConfig}',
      '场景大纲:',
      JSON.stringify(outline || {}, null, 2)
    ].join('\n');

    const text = await this.chatJson({
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxTokens: 6000
    });
    const parsed = extractJsonObject(text);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Ark scene parse failed: response is not a JSON object');
    }
    return parsed;
  }
}

module.exports = {
  ArkCourseClient
};
