const fs = require('fs');
const path = require('path');
const { postJsonWithRetry } = require('../api/request-utils');

const MIN_IMAGE_PIXELS = 3686400;
const SIZE_PRESETS = [
  { width: 2560, height: 1440, ratio: 16 / 9 },
  { width: 2304, height: 1728, ratio: 4 / 3 },
  { width: 2048, height: 2048, ratio: 1 },
  { width: 1728, height: 2304, ratio: 3 / 4 },
  { width: 1440, height: 2560, ratio: 9 / 16 }
];

function sanitizeFileName(value) {
  return String(value || 'image')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function normalizeImageResponse(payload) {
  const dataItem = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (dataItem?.url) {
    return { imageUrl: dataItem.url, imageBase64: null };
  }
  if (dataItem?.b64_json) {
    return { imageUrl: null, imageBase64: dataItem.b64_json };
  }

  const content = payload?.choices?.[0]?.message?.content || '';
  const urlMatch = String(content).match(/https?:\/\/\S+/i);
  if (urlMatch) {
    return { imageUrl: urlMatch[0], imageBase64: null };
  }

  return { imageUrl: null, imageBase64: null };
}

async function postJson(url, apiKey, body) {
  return postJsonWithRetry(url, apiKey, body, { retries: 2 });
}

function roundUpToStep(value, step = 64) {
  return Math.ceil(Number(value || 0) / step) * step;
}

function upscaleImageSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
  const ratio = width / height;
  const preset = SIZE_PRESETS
    .slice()
    .sort((a, b) => Math.abs(a.ratio - ratio) - Math.abs(b.ratio - ratio))[0];

  if (preset && Math.abs(preset.ratio - ratio) <= 0.18 && preset.width >= width && preset.height >= height) {
    return `${preset.width}x${preset.height}`;
  }

  const scale = Math.sqrt(MIN_IMAGE_PIXELS / (width * height));
  const nextWidth = Math.min(4096, roundUpToStep(width * scale));
  const nextHeight = Math.min(4096, roundUpToStep(height * scale));
  if (nextWidth * nextHeight < MIN_IMAGE_PIXELS) {
    if (nextWidth <= nextHeight) {
      return `${Math.min(4096, roundUpToStep(nextWidth * 1.1))}x${nextHeight}`;
    }
    return `${nextWidth}x${Math.min(4096, roundUpToStep(nextHeight * 1.1))}`;
  }
  return `${nextWidth}x${nextHeight}`;
}

function normalizeImageSize(sizeInput) {
  const raw = String(sizeInput || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return '';
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
  if (width < 1024 || height < 1024) return '';
  if (width > 4096 || height > 4096) return '';
  if (width * height < MIN_IMAGE_PIXELS) {
    return upscaleImageSize(width, height);
  }
  return `${width}x${height}`;
}

function normalizeImageGenerationError(error, endpointId, model) {
  const message = String(error?.message || '').trim();
  if (!message) return error;
  if (message.includes('image generation is only supported by certain models')) {
    return new Error(`当前图片 Endpoint 不支持图像生成：${endpointId}。请在 API 配置里为 ${model} 填写可用的图片生成 Endpoint。`);
  }
  if (/parameter [`'"]?size[`'"]?.*not valid|image size must be at least\s*(\d+)\s*pixels/i.test(message)) {
    return new Error(`图片生成失败：当前图片尺寸不符合接口要求。系统已切换到更大的默认尺寸，请重试；如果仍失败，请检查图片 Endpoint 是否限制固定尺寸。详情：${message}`);
  }
  return error;
}

class ImageGeneratorService {
  constructor(db, appRef) {
    this.db = db;
    this.app = appRef;
    this.baseURL = 'https://ark.cn-beijing.volces.com/api/v3';
  }

  getEndpointByModel(model) {
    const modelName = model || 'seedream';
    const aliases = {
      seedream: ['ark_endpoint_structure_image', 'ark_endpoint_seedream', 'ark_endpoint_glm'],
      doubao_image: ['ark_endpoint_generic_image', 'ark_endpoint_doubao_image', 'ark_endpoint_doubao']
    };
    const aliasKeys = aliases[modelName] || [];
    for (const key of aliasKeys) {
      const value = this.db.getApiKey(key);
      if (value) return value;
    }

    return (
      this.db.getApiKey('ark_endpoint_image') ||
      this.db.getApiKey(`ark_endpoint_${modelName}_image`) ||
      this.db.getApiKey(`ark_endpoint_${modelName}`) ||
      this.db.getApiKey('ark_endpoint') ||
      null
    );
  }

  getApiKey() {
    return this.db.getApiKey('ark');
  }

  async saveImageToDisk({ imageUrl, imageBase64, prompt, model, sceneType }) {
    const outputDir = path.join(this.app.getPath('userData'), 'generated-images');
    fs.mkdirSync(outputDir, { recursive: true });
    const stamp = Date.now();
    const baseName = sanitizeFileName(`${sceneType}-${model}-${stamp}`);
    const filePath = path.join(outputDir, `${baseName}.png`);

    if (imageBase64) {
      fs.writeFileSync(filePath, Buffer.from(imageBase64, 'base64'));
      return { filePath, sourceUrl: null };
    }

    if (imageUrl) {
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          return { filePath: '', sourceUrl: imageUrl, downloadError: `Download image failed (${response.status})` };
        }
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
        return { filePath, sourceUrl: imageUrl, downloadError: null };
      } catch (error) {
        return {
          filePath: '',
          sourceUrl: imageUrl,
          downloadError: String(error?.message || 'Download image failed')
        };
      }
    }

    throw new Error(`No image returned for prompt: ${String(prompt || '').slice(0, 80)}`);
  }

  async generateImage({ promptFinal, model, sceneType, notebookId, taskId, size }) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Please configure Ark API key first');
    }
    const endpointId = this.getEndpointByModel(model);
    if (!endpointId) {
      throw new Error(`Please configure Ark endpoint for model: ${model}`);
    }

    let response;
    try {
      const normalizedSize = normalizeImageSize(size) || (sceneType === 'structured' ? '2048x2048' : '1792x1024');
      const body = {
        model: endpointId,
        prompt: String(promptFinal || '').trim()
      };
      if (normalizedSize) {
        body.size = normalizedSize;
      }
      response = await postJson(`${this.baseURL}/images/generations`, apiKey, body);
    } catch (error) {
      throw normalizeImageGenerationError(error, endpointId, model);
    }

    const parsed = normalizeImageResponse(response);
    const saved = await this.saveImageToDisk({
      imageUrl: parsed.imageUrl,
      imageBase64: parsed.imageBase64,
      prompt: promptFinal,
      model,
      sceneType
    });

    const resource = saved.filePath
      ? (() => {
        const stat = fs.statSync(saved.filePath);
        return this.db.createResource({
          notebookId: notebookId || null,
          originalName: path.basename(saved.filePath),
          name: path.basename(saved.filePath),
          sourcePath: saved.sourceUrl || null,
          storagePath: saved.filePath,
          type: 'image',
          size: stat.size,
          tags: ['AI生成', model || 'unknown', sceneType || 'generic'],
          stage: sceneType === 'structured' ? 'framework' : 'ppt',
          category: sceneType === 'structured' ? '信息图' : '教学插图'
        });
      })()
      : null;

    return {
      taskId,
      model,
      endpointId,
      sceneType,
      promptFinal,
      size: normalizeImageSize(size) || (sceneType === 'structured' ? '2048x2048' : null),
      imagePath: saved.filePath || '',
      imageUrl: saved.sourceUrl || null,
      resourceId: resource?.id || null,
      downloadError: saved.downloadError || null,
      createdAt: new Date().toISOString()
    };
  }
}

module.exports = {
  ImageGeneratorService,
  normalizeImageSize
};
