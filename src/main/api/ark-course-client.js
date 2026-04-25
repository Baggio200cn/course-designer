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

  async chatJson({ systemPrompt, userPrompt, temperature = 0.2, maxTokens = 4000 }) {
    const response = await postJson(`${this.baseURL}/chat/completions`, this.apiKey, {
      model: this.endpointId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
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
