const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function normalizeEndpointId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^ep-[\w-]+$/i.test(raw)) return raw;
  const match = raw.match(/(ep-[\w-]+)/i);
  return match ? match[1] : raw;
}

function uniqueNonEmpty(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const v = String(item || '').trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

async function requestJson(url, apiKey, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw;
    try {
      const data = raw ? JSON.parse(raw) : null;
      detail = data?.error?.message || data?.message || raw || JSON.stringify(data);
    } catch {
      detail = raw;
    }
    const normalizedDetail = String(detail || '').trim();
    if (res.status === 404 && (!normalizedDetail || normalizedDetail === 'null')) {
      throw new Error(`API error (404): endpoint not found for ${url}`);
    }
    throw new Error(`API error (${res.status}): ${normalizedDetail || 'Unknown error'}`);
  }

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`API 返回了非 JSON 响应：${String(raw || '').slice(0, 300)}`);
  }
}

function sanitizeFileName(value) {
  return String(value || 'video')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function getMimeTypeByExt(filePath) {
  const ext = String(path.extname(filePath || '') || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function localPathToDataUrl(filePath) {
  const abs = String(filePath || '').trim();
  if (!abs || !fs.existsSync(abs)) return '';
  const buf = fs.readFileSync(abs);
  const mime = getMimeTypeByExt(abs);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function normalizeFrameUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^data:image\//i.test(raw)) return raw;
  return '';
}

function resolveFrameDataUrl(framePath, frameUrl) {
  const fromUrl = normalizeFrameUrl(frameUrl);
  if (fromUrl) return fromUrl;
  return localPathToDataUrl(framePath);
}

function ensurePromptTypographyAndHumanStability(prompt) {
  const base = String(prompt || '').trim();
  const extra = [
    '',
    '硬性要求：',
    '- 允许出现一个清晰中文大标题（每段最多一次，字数<=8，必须清晰可辨）。',
    '- 小字补充内容仅允许英文短词/英文短句，不允许小号中文。',
    '- 严禁乱码、错字、伪字、随机字符与文字堆叠。',
    '- 人物必须自然稳定：面部五官、手指数量、肢体比例、服装边缘不可变形。',
    '- 镜头中若出现人物，优先半身/远景，减少极端近景脸部变形风险。',
    '- 仅输出画面与音乐氛围，不输出口播人声。'
  ].join('\n');
  return `${base}${extra}`.trim();
}

function splitPromptByTimeline(prompt, count, segmentDurationSec = 10) {
  const text = String(prompt || '').trim();
  if (!text) return Array.from({ length: count }).map(() => '');
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const intro = lines.find((x) => /前10秒|开场|抓注意力/.test(x)) || '开场节奏强、快速建立课程主题。';
  const middle = lines.find((x) => /中段|重点呈现|镜头建议/.test(x)) || '中段展示教学场景与信息图元素。';
  const ending = lines.find((x) => /后10秒|收束|课程价值|口号/.test(x)) || '结尾收束并给出课程价值感。';
  return Array.from({ length: count }).map((_, idx) => {
    const start = idx * segmentDurationSec;
    const end = (idx + 1) * segmentDurationSec;
    if (idx === 0) return `${text}\n分段指令：第1段（${start}-${end}秒）仅做开场。${intro}`;
    if (idx === count - 1) return `${text}\n分段指令：第${idx + 1}段（${start}-${end}秒，收束段）完成结尾。${ending}`;
    return `${text}\n分段指令：第${idx + 1}段（${start}-${end}秒，中段）聚焦教学关键信息。${middle}`;
  });
}

function parseVideoResponse(payload) {
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (first?.url) return { videoUrl: first.url, videoBase64: null };
  if (first?.b64_json) return { videoUrl: null, videoBase64: first.b64_json };
  if (payload?.output_url) return { videoUrl: payload.output_url, videoBase64: null };
  if (payload?.video_url) return { videoUrl: payload.video_url, videoBase64: null };
  if (payload?.content?.video_url) return { videoUrl: payload.content.video_url, videoBase64: null };
  const content = payload?.choices?.[0]?.message?.content || '';
  const match = String(content).match(/https?:\/\/\S+/i);
  if (match) return { videoUrl: match[0], videoBase64: null };
  return { videoUrl: null, videoBase64: null };
}

function parseTaskMeta(payload) {
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  const taskId = String(
    payload?.id ||
    payload?.task_id ||
    first?.id ||
    first?.task_id ||
    ''
  ).trim();
  const status = String(
    payload?.status ||
    first?.status ||
    ''
  ).trim().toLowerCase();
  return { taskId, status };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ffmpegExists() {
  const paths = resolveFfmpegCandidates();
  return paths.length > 0;
}

function resolveFfmpegCandidates() {
  const candidates = [
    'ffmpeg',
    process.env.FFMPEG_PATH,
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\Gyan\\FFmpeg\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')
  ].filter(Boolean);
  return candidates.filter((cmd) => {
    try {
      const result = spawnSync(cmd, ['-version'], { encoding: 'utf8' });
      return result.status === 0;
    } catch {
      return false;
    }
  });
}

function concatVideosWithFfmpeg(segmentPaths, outputPath) {
  const ffmpegCmd = resolveFfmpegCandidates()[0];
  if (!ffmpegCmd) {
    throw new Error('未找到可用 ffmpeg 可执行文件。请安装 ffmpeg 或设置环境变量 FFMPEG_PATH。');
  }
  const listPath = `${outputPath}.concat.txt`;
  const escaped = segmentPaths
    .map((p) => `file '${String(p).replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(listPath, escaped, 'utf8');
  const concatRes = spawnSync(ffmpegCmd, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outputPath
  ], { encoding: 'utf8' });
  try { fs.unlinkSync(listPath); } catch {}
  if (concatRes.status !== 0) {
    throw new Error(`ffmpeg concat failed: ${concatRes.stderr || concatRes.stdout || 'unknown error'}`);
  }
}

async function createVideoTask(baseURL, apiKey, candidateModel, prompt, segmentDurationSec = 10, withBgm = true, startFrameDataUrl = '', endFrameDataUrl = '') {
  const createRoutes = [
    '/contents/generations/tasks',
    '/videos/generations',
    '/video/generations'
  ];

  const tried = [];
  let last404 = '';
  const promptText = String(prompt || '').trim();
  const contentItems = [];
  if (startFrameDataUrl) {
    contentItems.push({ type: 'image_url', image_url: { url: startFrameDataUrl } });
  }
  contentItems.push({ type: 'text', text: promptText });
  if (endFrameDataUrl) {
    contentItems.push({ type: 'image_url', image_url: { url: endFrameDataUrl } });
  }

  const bodyVariants = [
    {
      model: candidateModel,
      prompt: promptText,
      duration: segmentDurationSec,
      ratio: '16:9',
      resolution: '1080p',
      generate_audio: Boolean(withBgm),
      negative_prompt: 'garbled text, gibberish, typo, unreadable letters, deformed face, extra fingers, broken limbs, distorted body, twisted clothes'
    },
    {
      model: candidateModel,
      content: contentItems,
      duration: segmentDurationSec,
      ratio: '16:9',
      resolution: '1080p',
      generate_audio: Boolean(withBgm),
      negative_prompt: 'garbled text, gibberish, typo, unreadable letters, deformed face, extra fingers, broken limbs, distorted body, twisted clothes'
    }
  ];

  for (const route of createRoutes) {
    const url = `${baseURL}${route}`;
    for (const body of bodyVariants) {
      try {
        const payload = await requestJson(url, apiKey, {
          method: 'POST',
          body
        });
        return { payload, createRoute: route };
      } catch (error) {
        const msg = String(error?.message || '');
        const bodyTag = Object.prototype.hasOwnProperty.call(body, 'content') ? 'content' : 'prompt';
        if (msg.includes('API error (404)')) {
          tried.push(`${route}[${bodyTag}]`);
          last404 = msg;
          continue;
        }
        if (msg.includes('API error (400)') || msg.includes('API error (422)')) {
          tried.push(`${route}[${bodyTag}]`);
          continue;
        }
        throw error;
      }
    }
  }

  throw new Error(`视频创建接口不可用：模型 ${candidateModel}，已尝试 ${tried.join(' / ')}。${last404 ? ` 最后错误：${last404}` : ''}`);
}

async function queryVideoTask(baseURL, apiKey, taskId, createRoute) {
  const queryRoutes = uniqueNonEmpty([
    createRoute === '/contents/generations/tasks' ? `/contents/generations/tasks/${taskId}` : '',
    createRoute === '/videos/generations' ? `/videos/generations/tasks/${taskId}` : '',
    createRoute === '/video/generations' ? `/video/generations/tasks/${taskId}` : '',
    `/contents/generations/tasks/${taskId}`,
    `/videos/generations/tasks/${taskId}`,
    `/videos/generations/${taskId}`,
    `/video/generations/${taskId}`
  ]);

  let lastNon404Error = '';
  for (const route of queryRoutes) {
    const url = `${baseURL}${route}`;
    try {
      const payload = await requestJson(url, apiKey, { method: 'GET' });
      return payload;
    } catch (error) {
      const msg = String(error?.message || '');
      if (msg.includes('API error (404)')) {
        continue;
      }
      lastNon404Error = msg;
    }
  }

  if (lastNon404Error) {
    throw new Error(`视频任务查询失败：${lastNon404Error}`);
  }
  throw new Error(`视频任务查询接口不可用：taskId=${taskId}`);
}

class VideoGeneratorService {
  constructor(db, appRef) {
    this.db = db;
    this.app = appRef;
    this.baseURLs = [
      String(this.db?.getApiKey?.('ark_video_base_url') || '').trim(),
      'https://operator.las.cn-beijing.volces.com/api/v1',
      'https://ark.cn-beijing.volces.com/api/v3'
    ].filter(Boolean);
  }

  async generateVideo({
    prompt,
    notebookId,
    model,
    durationSec = 60,
    segmentDurationSec = 0,
    withBgm = true,
    startFramePath = '',
    startFrameUrl = '',
    endFramePath = '',
    endFrameUrl = ''
  }) {
    const apiKey = this.db.getApiKey('ark');
    if (!apiKey) throw new Error('Please configure Ark API key first');

    const configuredEndpoint = normalizeEndpointId(this.db.getApiKey('ark_endpoint_video_t2v'));
    const requestedEndpoint = normalizeEndpointId(model);
    const modelCandidates = uniqueNonEmpty([
      configuredEndpoint,
      /^ep-/i.test(requestedEndpoint) ? requestedEndpoint : ''
    ]);
    if (!modelCandidates.length || !/^ep-/i.test(modelCandidates[0])) {
      throw new Error('未检测到可用视频 Endpoint。请在 API 配置中填写 Seedance 2.0 对应的视频端点（ark_endpoint_video_t2v，格式为 ep-...）。');
    }

    const outputDir = path.join(this.app.getPath('userData'), 'generated-videos');
    fs.mkdirSync(outputDir, { recursive: true });
    const targetDuration = Math.max(10, Number(durationSec) || 60);
    const configuredSegmentDuration = Number(segmentDurationSec) || 0;
    const segmentDuration = configuredSegmentDuration > 0
      ? Math.max(10, configuredSegmentDuration)
      : (targetDuration === 60 ? 15 : 10);
    const segmentCount = Math.max(1, Math.ceil(targetDuration / segmentDuration));
    const segmentPrompts = splitPromptByTimeline(
      ensurePromptTypographyAndHumanStability(prompt),
      segmentCount,
      segmentDuration
    );
    const segmentPaths = [];
    const startFrameDataUrl = resolveFrameDataUrl(startFramePath, startFrameUrl);
    const endFrameDataUrl = resolveFrameDataUrl(endFramePath, endFrameUrl);

    let usedModel = '';
    let usedCreateRoute = '';
    let usedBaseURL = '';
    let lastError = '';

    for (let s = 0; s < segmentCount; s += 1) {
      let payload = null;
      for (const baseURL of this.baseURLs) {
        for (const candidate of modelCandidates) {
          try {
            const created = await createVideoTask(
              baseURL,
              apiKey,
              candidate,
              segmentPrompts[s],
              segmentDuration,
              withBgm,
              s === 0 ? startFrameDataUrl : '',
              s === segmentCount - 1 ? endFrameDataUrl : ''
            );
            payload = created.payload;
            usedModel = candidate;
            usedCreateRoute = created.createRoute;
            usedBaseURL = baseURL;
            break;
          } catch (error) {
            lastError = String(error?.message || '');
          }
        }
        if (payload) break;
      }
      if (!payload) {
      throw new Error(`视频生成接口不可用：已尝试视频 Endpoint ${modelCandidates.join(' / ')}。${lastError ? ` 最后错误：${lastError}` : ''}`);
    }

      let parsed = parseVideoResponse(payload);
      if (!parsed.videoUrl && !parsed.videoBase64) {
        const task = parseTaskMeta(payload);
        if (!task.taskId) {
          throw new Error(`第${s + 1}段任务已提交，但未返回可用任务ID与下载地址。`);
        }

        let pollPayload = payload;
        for (let i = 0; i < 40; i += 1) {
          await sleep(3000);
          pollPayload = await queryVideoTask(usedBaseURL, apiKey, task.taskId, usedCreateRoute);
          parsed = parseVideoResponse(pollPayload);
          if (parsed.videoUrl || parsed.videoBase64) {
            break;
          }
          const status = parseTaskMeta(pollPayload).status;
          if (['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
            throw new Error(`视频任务执行失败：segment=${s + 1}, taskId=${task.taskId}, status=${status}`);
          }
        }
      }

      if (!parsed.videoUrl && !parsed.videoBase64) {
        throw new Error(`第${s + 1}段轮询后仍未拿到下载地址，请稍后重试。`);
      }

      const segmentPath = path.join(outputDir, `${sanitizeFileName(`${usedModel || model || 'video'}-${Date.now()}-seg${s + 1}`)}.mp4`);
      if (parsed.videoBase64) {
        fs.writeFileSync(segmentPath, Buffer.from(parsed.videoBase64, 'base64'));
      } else {
        const res = await fetch(parsed.videoUrl);
        if (!res.ok) throw new Error(`Download video failed (${res.status})`);
        const arrayBuffer = await res.arrayBuffer();
        fs.writeFileSync(segmentPath, Buffer.from(arrayBuffer));
      }
      segmentPaths.push(segmentPath);
    }

    const filePath = path.join(outputDir, `${sanitizeFileName(`${usedModel || model || 'video'}-${Date.now()}-full`)}.mp4`);
    if (segmentPaths.length === 1) {
      fs.copyFileSync(segmentPaths[0], filePath);
    } else {
      if (!ffmpegExists()) {
        throw new Error('检测到目标时长超过单段限制，但本机未安装 ffmpeg，无法自动拼接为 60 秒视频。请先安装 ffmpeg 后重试。');
      }
      concatVideosWithFfmpeg(segmentPaths, filePath);
    }

    const stat = fs.statSync(filePath);
    const resource = this.db.createResource({
      notebookId: notebookId || null,
      originalName: path.basename(filePath),
      name: path.basename(filePath),
      sourcePath: null,
      storagePath: filePath,
      type: 'video',
      size: stat.size,
      tags: ['AI生成', 'video', `duration_${targetDuration}s`, withBgm ? 'with_bgm' : 'mute']
    });

    return {
      model: usedModel || model || 't2v',
      prompt,
      endpointId: usedModel,
      createRoute: usedCreateRoute,
      baseURL: usedBaseURL,
      targetDuration,
      segmentCount,
      videoPath: filePath,
      videoUrl: null,
      resourceId: resource.id,
      createdAt: new Date().toISOString()
    };
  }
}

module.exports = {
  VideoGeneratorService
};
