/**
 * volc-voice-clone.js — 火山引擎声音复刻（豆包声音复刻 2.0）语音合成客户端
 *
 * v4.3.3 功能5+（老师反馈 · 2026-05-30）：讲稿"周老师真声"朗读。
 *
 * 鉴权与接口（按火山控制台「快捷 API 接入」示例，新版 x-api-key 方式）：
 *   POST https://openspeech.bytedance.com/api/v1/tts
 *   header: x-api-key: {apiKey}  +  Content-Type: application/json
 *   body: {
 *     app:    { cluster: "volcano_icl" },          // 声音复刻 2.0 固定 volcano_icl
 *     user:   { uid: "yuke-agent" },
 *     audio:  { voice_type: speakerId, encoding: "mp3", speed_ratio },
 *     request:{ reqid, text, operation: "query" }  // query = 一次性返回 base64 mp3
 *   }
 *   返回 JSON: { code:3000, message:"success", data:"<base64 mp3>", ... }
 *
 * 注意：
 *   - 凭证（apiKey / speakerId）走配置，不硬编码进仓库。
 *   - operation:"query" 是非流式，整段 text 一次合成；调用方应控制 text 长度（计费按字符）。
 */
'use strict';

const https = require('https');
const crypto = require('crypto');

const TTS_HOST = 'openspeech.bytedance.com';
const TTS_PATH = '/api/v1/tts';
const CLUSTER = 'volcano_icl';   // 豆包声音复刻 2.0

/**
 * 构造合成请求 body（纯函数，便于单测）。
 * @param {Object} p
 * @param {string} p.speakerId  音色 ID（S_xxx）
 * @param {string} p.text       待合成文本
 * @param {number} [p.speedRatio=1.0] 语速 0.2–3.0
 * @param {string} [p.encoding='mp3']
 * @param {string} [p.uid='yuke-agent']
 * @returns {Object}
 */
function buildSynthesisBody({ speakerId, text, speedRatio = 1.0, encoding = 'mp3', uid = 'yuke-agent' }) {
  if (!speakerId) throw new Error('缺 speakerId（音色 ID）');
  if (!text) throw new Error('缺 text（待合成文本）');
  const ratio = Number(speedRatio);
  return {
    app: { cluster: CLUSTER },
    user: { uid: String(uid || 'yuke-agent') },
    audio: {
      voice_type: String(speakerId),
      encoding: String(encoding || 'mp3'),
      speed_ratio: Number.isFinite(ratio) && ratio >= 0.2 && ratio <= 3.0 ? ratio : 1.0,
    },
    request: {
      reqid: crypto.randomUUID(),
      text: String(text),
      operation: 'query',
    },
  };
}

/**
 * 调用火山声音复刻合成，返回 base64 mp3。
 * @param {Object} p
 * @param {string} p.apiKey      x-api-key
 * @param {string} p.speakerId
 * @param {string} p.text
 * @param {number} [p.speedRatio]
 * @returns {Promise<{ success:boolean, audioBase64?:string, encoding?:string, error?:string, code?:number }>}
 */
function synthesizeVoice({ apiKey, speakerId, text, speedRatio = 1.0 }) {
  return new Promise((resolve) => {
    if (!apiKey) return resolve({ success: false, error: '未配置声音复刻 API Key' });
    if (!speakerId) return resolve({ success: false, error: '未配置音色 ID（Speaker ID）' });
    if (!text || !String(text).trim()) return resolve({ success: false, error: '合成文本为空' });

    let body;
    try {
      body = JSON.stringify(buildSynthesisBody({ speakerId, text, speedRatio }));
    } catch (e) {
      return resolve({ success: false, error: e.message });
    }

    const req = https.request({
      host: TTS_HOST,
      path: TTS_PATH,
      method: 'POST',
      headers: {
        'x-api-key': String(apiKey),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(raw); }
        catch { return resolve({ success: false, error: `返回非 JSON（HTTP ${res.statusCode}）：${raw.slice(0, 200)}` }); }
        // 火山成功 code 3000；data 为 base64 mp3
        if (json && (json.code === 3000 || json.code === 0) && json.data) {
          resolve({ success: true, audioBase64: json.data, encoding: 'mp3', code: json.code });
        } else {
          resolve({ success: false, error: json?.message || `合成失败（code ${json?.code}）`, code: json?.code });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: '合成超时（60s）' }); });
    req.on('error', (e) => resolve({ success: false, error: `网络错误：${e.message}` }));
    req.write(body);
    req.end();
  });
}

// ── 自检（不调真实 API，只验证 body 构造）────────────────────────────────
function selfCheck() {
  const checks = [];
  checks.push({
    name: 'buildSynthesisBody 含 cluster=volcano_icl + voice_type + operation=query',
    pass: (() => {
      try {
        const b = buildSynthesisBody({ speakerId: 'S_test', text: '你好' });
        return b.app.cluster === 'volcano_icl'
          && b.audio.voice_type === 'S_test'
          && b.request.operation === 'query'
          && typeof b.request.reqid === 'string' && b.request.reqid.length > 0;
      } catch { return false; }
    })(),
  });
  checks.push({
    name: 'speed_ratio 越界回落 1.0',
    pass: (() => {
      const b = buildSynthesisBody({ speakerId: 'S', text: 'x', speedRatio: 99 });
      return b.audio.speed_ratio === 1.0;
    })(),
  });
  checks.push({
    name: 'speed_ratio 合法值保留',
    pass: buildSynthesisBody({ speakerId: 'S', text: 'x', speedRatio: 0.9 }).audio.speed_ratio === 0.9,
  });
  checks.push({
    name: '缺 speakerId 抛错',
    pass: (() => { try { buildSynthesisBody({ text: 'x' }); return false; } catch { return true; } })(),
  });
  const passed = checks.filter((c) => c.pass).length;
  return { total: checks.length, passed, checks };
}

module.exports = { synthesizeVoice, buildSynthesisBody, selfCheck, CLUSTER };
