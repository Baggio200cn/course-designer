import React, { useEffect, useMemo, useRef, useState } from 'react';
import FrameworkStage from './FrameworkStage';
import LectureStage from './LectureStage';
import PptStage from './PptStage';
import VideoStage from './VideoStage';
import {
  JIMENG_URL,
  PEXO_URL,
  PEXO_CODE,
  PPT_TEMPLATE_PRESETS,
  buildPptPagesFromLecture,
  buildPptTextFramework,
  ensurePptImagePromptForPage,
  getPptPageTaskId,
  videoPrompt
} from './stage-helpers';

const api = window.electronAPI;

const NOTEBOOK_FORM = {
  name: '',
  courseCode: '',
  totalHours: 72,
  theoryHours: 20,
  practiceHours: 52,
  grade: '二年级',
  prerequisite: '',
  description: '',
  // 富上下文字段（Phase-5B，用于提升 AI 生成质量）
  softwareTools: '',
  jobTargets: '',
  industryScenarios: '',
  learnerProfile: '',
  teachingMaterials: ''
};

const API_FORM = {
  ark: '',
  arkTextEndpoint: '',
  arkImageEndpoint: '',
  arkVideoEndpoint: ''
};

const STAGES = [
  { key: 'framework', title: '教学框架', hint: '结构化框架、确认稿与信息图' },
  { key: 'lecture', title: '讲稿', hint: 'A/B/C 草稿与正式讲稿' },
  { key: 'ppt', title: 'PPT', hint: '页级框架、候选图与导出' },
  { key: 'video', title: '视频提示词', hint: '即梦 / PEXO 桥接' }
];

const STAGE_TITLE_MAP = Object.fromEntries(STAGES.map((item) => [item.key, item.title]));
const STAGE_PRIMARY_ARTIFACTS = {
  framework: ['framework_json', 'framework_preview_md'],
  lecture: ['lecture_final'],
  ppt: ['ppt_outline'],
  video: ['video_prompt']
};
const EVENT_TYPE_LABELS = {
  'stage.entered': '进入阶段',
  'stage.unlocked': '解锁阶段',
  'artifact.changed': '产物更新',
  'artifact.confirmed': '产物确认',
  'operation.started': '任务开始',
  'operation.completed': '任务完成',
  'operation.failed': '任务失败',
  'export.requested': '请求导出',
  'export.blocked': '导出阻塞',
  'export.completed': '导出完成',
  'export.failed': '导出失败'
};

const STORAGE_KEYS = {
  selectedNotebookId: 'v2:selectedNotebookId',
  lectureStagePrefix: 'v2:lectureStage:'
};

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function artifactIsConfirmed(item) {
  if (!item || item.confirmed !== true) return false;
  return ['confirmed', 'exported', 'review_needed'].includes(String(item.status || ''));
}

function getNextStageKey(stage) {
  const index = STAGES.findIndex((item) => item.key === stage);
  return index >= 0 ? STAGES[index + 1]?.key || '' : '';
}

function formatStageNames(stages) {
  return arr(stages).map((item) => STAGE_TITLE_MAP[item] || item).join(' / ');
}

function formatEventLabel(type) {
  return EVENT_TYPE_LABELS[type] || String(type || '').replace(/\./g, ' / ') || '系统事件';
}

function formatOperationLabel(status) {
  const value = String(status || '').trim();
  if (value === 'completed') return '已完成';
  if (value === 'failed') return '失败';
  if (value === 'running') return '进行中';
  return value || '未知';
}

function resolveStageState({ stage, currentStage, unlockedStages, quality, artifacts }) {
  const safeArtifacts = arr(artifacts);
  const locked = !arr(unlockedStages).includes(stage);
  const confirmedCount = safeArtifacts.filter((item) => (
    STAGE_PRIMARY_ARTIFACTS[stage]?.includes(item.type) && artifactIsConfirmed(item)
  )).length;
  const nextStage = getNextStageKey(stage);
  const completed = nextStage ? arr(unlockedStages).includes(nextStage) : confirmedCount > 0;

  if (locked) {
    return { key: 'locked', label: '未解锁', tone: 'neutral', detail: '等待上一步确认后开放' };
  }
  if (quality?.valid === false) {
    return {
      key: 'blocked',
      label: '有阻塞',
      tone: 'danger',
      detail: arr(quality.errors)[0] || '当前阶段存在阻断问题'
    };
  }
  if (quality?.reviewNeeded) {
    return {
      key: 'review',
      label: '需复审',
      tone: 'warning',
      detail: arr(quality.reviewReasons)[0] || arr(quality.warnings)[0] || '建议人工复核当前内容'
    };
  }
  if (completed) {
    return {
      key: 'completed',
      label: '已完成',
      tone: 'success',
      detail: confirmedCount ? `已沉淀 ${confirmedCount} 个核心产物` : '已满足下游继续推进条件'
    };
  }
  if (currentStage === stage) {
    return {
      key: 'active',
      label: '处理中',
      tone: 'brand',
      detail: arr(quality?.warnings)[0] || '当前正在编辑和确认这一阶段'
    };
  }
  return {
    key: 'ready',
    label: '可进入',
    tone: 'info',
    detail: confirmedCount ? `已有 ${confirmedCount} 个核心产物` : '已解锁，可直接进入处理'
  };
}

function splitLines(value) {
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function dt(value) {
  try {
    return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
  } catch {
    return String(value || '-');
  }
}

function shorten(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/* ─────────────────────────────────────────────────────────────────
   Canvas Slide 合成工具（纯本地，无网络，使用系统字体）
   将 AI 背景图 + 文字覆层合成为 1920×1080 PNG
───────────────────────────────────────────────────────────────── */

/** 十六进制颜色转 CSS rgb() 字符串 */
function hexToCssRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r},${g},${b})`;
}

/** 加载 Image 元素（接受 base64 data URL 或任何 src） */
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/** 中文字符串截断 */
function cTrunc(text, max) {
  const t = String(text || '').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** RGB: #RRGGBB → [r, g, b] */
function hexToRgbArr(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return [0, 0, 0];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** 背景图全幅居中裁剪平铺（cover） */
function drawBgCover(ctx, img, W = 1920, H = 1080) {
  const bw = img.naturalWidth || img.width;
  const bh = img.naturalHeight || img.height;
  const sc = Math.max(W / bw, H / bh);
  ctx.drawImage(img, (W - bw * sc) / 2, (H - bh * sc) / 2, bw * sc, bh * sc);
}

/** Guizang Hero 页类型集合（暗色全幅英雄布局） */
const _GUIZANG_HERO_SET = new Set(['封面', '模块页', '路线图', '课程导入']);

/**
 * Guizang Hero 渲染器：暗色全幅背景 + 放射光晕 + 幽灵字 + kicker + 衬线大标题
 */
function _renderGuizangHero(ctx, bgImg, page, template) {
  const W = 1920, H = 1080;
  const SERIF = '"SimSun","FangSong","STSong","Songti SC",serif';
  const SANS  = '"PingFang SC","Microsoft YaHei",sans-serif';
  const MONO  = '"Consolas","Courier New","IBM Plex Mono",monospace';

  // 1. 背景图全幅
  drawBgCover(ctx, bgImg, W, H);

  // 2. heroBackground 半透明叠加（86%，使画面足够暗）
  const [hr, hg, hb] = hexToRgbArr(template?.heroBackground || '#0A1F3D');
  ctx.fillStyle = `rgba(${hr},${hg},${hb},0.86)`;
  ctx.fillRect(0, 0, W, H);

  // 3. 放射光晕（左中，accentColor 微弱辉光）
  const [ar, ag, ab] = hexToRgbArr(template?.accentColor || '#F0A500');
  const glow = ctx.createRadialGradient(460, 420, 0, 460, 420, 700);
  glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.20)`);
  glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // 4. 幽灵文字（页型，衬线超大字，右下角，7% 不透明）
  const ghostText = String(page.pageType || '').slice(0, 4);
  if (ghostText) {
    ctx.save();
    ctx.font      = `300 300px ${SERIF}`;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.textAlign = 'right';
    ctx.fillText(ghostText, 1890, 1010);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // 5. Kicker（monospace，ruleColor，标题上方）
  const kicker  = page.kicker || page.pageType || '';
  const kickerY = 556;
  const [rr, rg, rb] = hexToRgbArr(template?.ruleColor || template?.accentColor || '#F0A500');
  if (kicker) {
    ctx.fillStyle = `rgb(${rr},${rg},${rb})`;
    ctx.font      = `500 22px ${MONO}`;
    ctx.fillText(String(kicker).toUpperCase(), 80, kickerY);
  }

  // 6. Kicker 下横线（ruleColor 88%，2px，900px 宽）
  ctx.strokeStyle = `rgba(${rr},${rg},${rb},0.88)`;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(80,  kickerY + 14);
  ctx.lineTo(980, kickerY + 14);
  ctx.stroke();

  // 7. 衬线大标题
  const title     = cTrunc(page.title || '', 24);
  const titleSize = title.length > 16 ? 58 : (title.length > 10 ? 70 : 82);
  ctx.font        = `700 ${titleSize}px ${SERIF}`;
  ctx.fillStyle   = '#FFFFFF';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur  = 16;
  ctx.fillText(title, 80, kickerY + 80);
  ctx.shadowBlur  = 0;

  // 8. Lead 文字（摘要/副标题，26px sans，白色 58%）
  const lead = cTrunc(page.summary || page.subtitle || '', 50);
  if (lead) {
    ctx.font      = `400 26px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.fillText(lead, 80, kickerY + 80 + titleSize + 24);
  }

  // 9. 右下角页码（mono，白色 28%）
  if (page.pageNumber != null) {
    ctx.font      = `400 20px ${MONO}`;
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.textAlign = 'right';
    ctx.fillText(String(page.pageNumber).padStart(2, '0'), 1860, 1055);
    ctx.textAlign = 'left';
  }
}

/**
 * Guizang Content 渲染器：左侧纸面板（45%）+ 右侧图片 + 衬线标题 + 要点列表
 */
function _renderGuizangContent(ctx, bgImg, page, template) {
  const W       = 1920, H = 1080;
  const PANEL_W = 864;
  const SERIF   = '"SimSun","FangSong","STSong","Songti SC",serif';
  const SANS    = '"PingFang SC","Microsoft YaHei",sans-serif';
  const MONO    = '"Consolas","Courier New","IBM Plex Mono",monospace';

  // 1. 背景图全幅（右侧可见）
  drawBgCover(ctx, bgImg, W, H);

  // 2. 左侧纸面板（paperPanel 颜色，93% 不透明）
  const [pr, pg, pb] = hexToRgbArr(template?.paperPanel || template?.background || '#F1F3F5');
  ctx.fillStyle = `rgba(${pr},${pg},${pb},0.93)`;
  ctx.fillRect(0, 0, PANEL_W, H);

  // 3. 左侧 4px 强调色竖条
  const [ar, ag, ab] = hexToRgbArr(template?.accentColor || '#2E86DE');
  ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
  ctx.fillRect(0, 0, 4, H);

  // 4. 面板深浅判断（深色面板用白字）
  const panelLuma   = pr * 0.299 + pg * 0.587 + pb * 0.114;
  const isDarkPanel = panelLuma < 128;
  const [ir, ig, ib] = hexToRgbArr(template?.textColor || '#0A1F3D');
  const inkColor    = isDarkPanel ? '#FFFFFF' : `rgb(${ir},${ig},${ib})`;
  const inkFaded    = isDarkPanel ? 'rgba(255,255,255,0.55)' : `rgba(${ir},${ig},${ib},0.55)`;

  // 5. 幽灵文字（页型前两字，超大衬线，面板左下，6% 不透明）
  const ghostText = String(page.pageType || '').slice(0, 2);
  if (ghostText) {
    ctx.save();
    ctx.font      = `300 260px ${SERIF}`;
    ctx.fillStyle = isDarkPanel ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    ctx.fillText(ghostText, 28, 1130);
    ctx.restore();
  }

  // 6. Kicker 标签
  const kicker  = page.kicker || page.pageType || '';
  const kickerY = 68;
  const [rr, rg, rb] = hexToRgbArr(template?.ruleColor || template?.accentColor || '#F0A500');
  if (kicker) {
    ctx.fillStyle = `rgb(${rr},${rg},${rb})`;
    ctx.font      = `500 20px ${MONO}`;
    ctx.fillText(String(kicker).toUpperCase(), 48, kickerY);
  }

  // 7. Kicker 下横线（accentColor 25%，1px）
  ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.25)`;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(48, kickerY + 14);
  ctx.lineTo(PANEL_W - 32, kickerY + 14);
  ctx.stroke();

  // 8. 衬线标题
  const title     = cTrunc(page.title || '', 20);
  const titleSize = title.length > 14 ? 46 : (title.length > 8 ? 56 : 68);
  ctx.font        = `700 ${titleSize}px ${SERIF}`;
  ctx.fillStyle   = inkColor;
  ctx.shadowColor = isDarkPanel ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.1)';
  ctx.shadowBlur  = 8;
  ctx.fillText(title, 48, 148 + titleSize);
  ctx.shadowBlur  = 0;

  // 9. 副标题
  if (page.subtitle) {
    ctx.font      = `400 22px ${SANS}`;
    ctx.fillStyle = inkFaded;
    ctx.fillText(cTrunc(page.subtitle, 36), 48, 148 + titleSize + 36);
  }

  // 10. 要点列表（最多 5 条，accent 圆点 + 文字）
  const keyPoints = String(page.keyContent || '')
    .split('\n')
    .map((s) => s.replace(/^[-\d.•·▸]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
  if (keyPoints.length > 0) {
    const listStartY = 148 + titleSize + (page.subtitle ? 72 : 48);
    const lineH      = 48;
    ctx.font         = `400 22px ${SANS}`;
    keyPoints.forEach((pt, i) => {
      const y = listStartY + i * lineH;
      if (y + 32 > H - 48) return;
      ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
      ctx.beginPath();
      ctx.arc(60, y - 6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = inkFaded;
      ctx.fillText(cTrunc(pt, 26), 76, y);
    });
  }

  // 11. 面板右边缘软渐变（与图片自然融合）
  const edgeGrad = ctx.createLinearGradient(PANEL_W - 110, 0, PANEL_W, 0);
  edgeGrad.addColorStop(0, `rgba(${pr},${pg},${pb},0.93)`);
  edgeGrad.addColorStop(1, `rgba(${pr},${pg},${pb},0)`);
  ctx.fillStyle = edgeGrad;
  ctx.fillRect(PANEL_W - 110, 0, 110, H);
}

/**
 * 合成单张 Slide 为 1920×1080 PNG
 * Guizang 模板走 Hero/Content 分支渲染；其余模板保持原底部渐变卡片布局（向后兼容）。
 */
async function compositePageSlide(page, template, notebookId, api) {
  const imgSrc = page?.imagePath || page?.imageUrl;
  if (!page || !page.needImage || !imgSrc || /^https?:\/\//i.test(imgSrc)) return '';

  try {
    // 1. 读取背景图 base64（IPC，避免 Canvas taint）
    const b64Res = await api.readFileAsBase64V2(imgSrc);
    if (!b64Res?.success || !b64Res?.data) return '';

    const bgImg = await loadImg(b64Res.data);

    // 2. 创建 1920×1080 Canvas
    const canvas = document.createElement('canvas');
    canvas.width  = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    // 3. Guizang 模板：分 Hero / Content 两种布局
    if (template?.variant === 'guizang') {
      if (_GUIZANG_HERO_SET.has(page.pageType)) {
        _renderGuizangHero(ctx, bgImg, page, template);
      } else {
        _renderGuizangContent(ctx, bgImg, page, template);
      }
      const pngBase64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      const saveRes = await api.saveCompositeSlideV2({ notebookId, pageId: page.id, imageBase64: pngBase64 });
      return saveRes?.success ? (saveRes.data?.compositePath || '') : '';
    }

    // 4. 非 Guizang：原底部渐变卡片布局（向后兼容）
    const bw = bgImg.naturalWidth  || bgImg.width;
    const bh = bgImg.naturalHeight || bgImg.height;
    const scale = Math.max(1920 / bw, 1080 / bh);
    ctx.drawImage(bgImg, (1920 - bw * scale) / 2, (1080 - bh * scale) / 2, bw * scale, bh * scale);

    const accentCss = hexToCssRgb(template?.accentColor) || 'rgb(233,30,140)';
    const isCover   = page.pageType === '封面';
    const isRoadmap = page.pageType === '路线图';
    const FONT      = '"Microsoft YaHei","PingFang SC","SimHei",sans-serif';

    if (isRoadmap) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, 0, 1920, 1080);
    } else if (isCover) {
      const coverGrad = ctx.createLinearGradient(0, 756, 0, 1080);
      coverGrad.addColorStop(0,   'rgba(0,0,0,0)');
      coverGrad.addColorStop(0.4, 'rgba(0,0,0,0.55)');
      coverGrad.addColorStop(1,   'rgba(0,0,0,0.82)');
      ctx.fillStyle = coverGrad;
      ctx.fillRect(0, 756, 1920, 324);

      const [ar, ag, ab] = (hexToCssRgb(template?.accentColor) || 'rgb(233,30,140)')
        .replace('rgb(', '').replace(')', '').split(',').map(Number);
      ctx.fillStyle = `rgba(${ar},${ag},${ab},1)`;
      ctx.fillRect(0, 1074, 1920, 6);

      const coverTitle = cTrunc(page.title || '', 18);
      const coverTSize = coverTitle.length > 12 ? 60 : (coverTitle.length > 8 ? 70 : 80);
      ctx.fillStyle    = '#FFFFFF';
      ctx.font         = `bold ${coverTSize}px ${FONT}`;
      ctx.textAlign    = 'center';
      ctx.shadowColor  = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur   = 12;
      ctx.fillText(coverTitle, 960, 990);
      if (page.subtitle) {
        ctx.font      = `28px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.shadowBlur = 6;
        ctx.fillText(cTrunc(page.subtitle, 40), 960, 1048);
      }
      ctx.textAlign  = 'left';
      ctx.shadowBlur = 0;
      ctx.fillStyle  = accentCss;
      ctx.fillRect(0, 0, 6, 1080);
    } else {
      const keyPoints = String(page.keyContent || '').split('\n')
        .map((s) => s.replace(/^[-\d.•·]+\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 4);
      const isCheck = /验收|检查/.test(page.pageType || '');
      const isSteps = /操作步骤|步骤/.test(page.pageType || '');

      ctx.fillStyle = accentCss;
      ctx.fillRect(0, 0, 4, 1080);

      if (page.pageType) {
        const tagText = page.pageType;
        const tagPad  = 18;
        ctx.font      = `bold 20px ${FONT}`;
        const tagW    = ctx.measureText(tagText).width + tagPad * 2;
        const tagH    = 34;
        const tagX    = 28;
        const tagY    = 22;
        ctx.fillStyle   = accentCss;
        ctx.globalAlpha = 0.85;
        const r = 8;
        ctx.beginPath();
        ctx.moveTo(tagX + r, tagY);
        ctx.lineTo(tagX + tagW - r, tagY);
        ctx.quadraticCurveTo(tagX + tagW, tagY, tagX + tagW, tagY + r);
        ctx.lineTo(tagX + tagW, tagY + tagH - r);
        ctx.quadraticCurveTo(tagX + tagW, tagY + tagH, tagX + tagW - r, tagY + tagH);
        ctx.lineTo(tagX + r, tagY + tagH);
        ctx.quadraticCurveTo(tagX, tagY + tagH, tagX, tagY + tagH - r);
        ctx.lineTo(tagX, tagY + r);
        ctx.quadraticCurveTo(tagX, tagY, tagX + r, tagY);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle   = '#FFFFFF';
        ctx.fillText(tagText, tagX + tagPad, tagY + 23);
      }

      const gradStart = keyPoints.length > 0 ? 540 : 680;
      const grad = ctx.createLinearGradient(0, gradStart, 0, 1080);
      grad.addColorStop(0,    'rgba(0,0,0,0)');
      grad.addColorStop(0.28, 'rgba(0,0,0,0.42)');
      grad.addColorStop(0.6,  'rgba(0,0,0,0.72)');
      grad.addColorStop(1,    'rgba(0,0,0,0.88)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, gradStart, 1920, 1080 - gradStart);

      const titleY    = keyPoints.length > 0 ? 718 : 820;
      ctx.fillStyle   = accentCss;
      ctx.fillRect(60, titleY - 10, 60, 5);

      const title     = cTrunc(page.title || '', 22);
      const titleSize = title.length > 16 ? 44 : (title.length > 10 ? 52 : 60);
      ctx.fillStyle   = '#FFFFFF';
      ctx.font        = `bold ${titleSize}px ${FONT}`;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur  = 8;
      ctx.fillText(title, 60, titleY + titleSize);
      ctx.shadowBlur  = 0;

      if (page.subtitle) {
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font      = `24px ${FONT}`;
        ctx.fillText(cTrunc(page.subtitle, 38), 62, titleY + titleSize + 38);
      }

      if (keyPoints.length > 0) {
        const chipY    = titleY + titleSize + (page.subtitle ? 80 : 52);
        const chipH    = 42;
        const chipPadX = 20;
        const chipGap  = 16;
        ctx.font       = `22px ${FONT}`;
        let chipX      = 60;
        keyPoints.forEach((pt, i) => {
          const label   = cTrunc(String(pt), 20);
          const badge   = isCheck ? '✓' : (isSteps ? String(i + 1) : '▸');
          const fullTxt = `${badge}  ${label}`;
          const chipW   = Math.min(ctx.measureText(fullTxt).width + chipPadX * 2, 420);
          if (chipX + chipW > 1860 && i > 0) chipX = 60;
          ctx.fillStyle   = accentCss;
          ctx.globalAlpha = 0.22;
          const cr = 8;
          ctx.beginPath();
          ctx.moveTo(chipX + cr, chipY);
          ctx.lineTo(chipX + chipW - cr, chipY);
          ctx.quadraticCurveTo(chipX + chipW, chipY, chipX + chipW, chipY + cr);
          ctx.lineTo(chipX + chipW, chipY + chipH - cr);
          ctx.quadraticCurveTo(chipX + chipW, chipY + chipH, chipX + chipW - cr, chipY + chipH);
          ctx.lineTo(chipX + cr, chipY + chipH);
          ctx.quadraticCurveTo(chipX, chipY + chipH, chipX, chipY + chipH - cr);
          ctx.lineTo(chipX, chipY + cr);
          ctx.quadraticCurveTo(chipX, chipY, chipX + cr, chipY);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle   = accentCss;
          ctx.fillRect(chipX, chipY, 3, chipH);
          ctx.fillStyle   = '#FFFFFF';
          ctx.shadowColor = 'rgba(0,0,0,0.4)';
          ctx.shadowBlur  = 4;
          ctx.fillText(fullTxt, chipX + chipPadX, chipY + 28);
          ctx.shadowBlur  = 0;
          chipX += chipW + chipGap;
        });
      }
    }

    // 5. 导出 PNG + 保存到磁盘
    const pngBase64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    const saveRes = await api.saveCompositeSlideV2({ notebookId, pageId: page.id, imageBase64: pngBase64 });
    return saveRes?.success ? (saveRes.data?.compositePath || '') : '';

  } catch (err) {
    console.warn('[composite] P' + page.pageNumber + ' 合成失败:', err.message);
    return '';
  }
}

function toLocalImgSrc(filePath) {
  if (!filePath) return '';
  if (/^https?:\/\//i.test(String(filePath || '').trim())) {
    return String(filePath).trim();
  }
  const normalized = String(filePath).replace(/\\/g, '/').replace(/^file:\/\/\//i, '');
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = String(driveMatch[2] || '').split('/').filter(Boolean).map((seg) => encodeURIComponent(seg)).join('/');
    return `local-img://${drive}/${rest}`;
  }
  const encoded = normalized.split('/').filter(Boolean).map((seg) => encodeURIComponent(seg)).join('/');
  return `local-img:///${encoded}`;
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || '{}'));
  } catch {
    return null;
  }
}

function readLocalStorage(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (value === null || typeof value === 'undefined' || value === '') {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore local cache failures
  }
}

function getLectureStageCacheKey(notebookId) {
  return `${STORAGE_KEYS.lectureStagePrefix}${Number(notebookId) || 0}`;
}

function readLectureStageCache(notebookId) {
  const raw = readLocalStorage(getLectureStageCacheKey(notebookId));
  if (!raw) return null;
  return parseJson(raw);
}

/**
 * 保证 page 数组中每个 id 唯一。
 * 旧数据（数据库中）可能因之前的 bug 导致重复 id，在此处修复。
 */
function deduplicatePptPageIds(pages) {
  const seen = new Set();
  return arr(pages).map((page, index) => {
    const id = String(page?.id || '');
    if (!id || seen.has(id)) {
      // 生成一个稳定的唯一 ID（不依赖时间戳，避免每次渲染都不同）
      const newId = `ppt-dedup-${index + 1}-${(id || 'noId').slice(-8)}`;
      seen.add(newId);
      return { ...page, id: newId };
    }
    seen.add(id);
    return page;
  });
}

function normalizePptPagesWithPrompts(pages, { template, courseName }) {
  // 先去重再 normalize，防止旧数据中重复 id 导致双选 bug
  return deduplicatePptPageIds(pages).map((page) => ensurePptImagePromptForPage(page, {
    courseName: courseName || '课程',
    template: template || PPT_TEMPLATE_PRESETS.pro_minimalist,
    imageAspect: page?.imageAspect || '16:9',
    imageQuality: page?.imageQuality || 'low'
  }));
}

function renderMarkdownPreview(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const blocks = [];
  let list = [];
  const flushList = () => {
    if (list.length) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };
  lines.forEach((raw) => {
    const line = String(raw || '').trim();
    if (!line) {
      flushList();
      return;
    }
    if (line.startsWith('# ')) {
      flushList();
      blocks.push({ type: 'h1', text: line.slice(2) });
      return;
    }
    if (line.startsWith('## ')) {
      flushList();
      blocks.push({ type: 'h2', text: line.slice(3) });
      return;
    }
    if (line.startsWith('### ')) {
      flushList();
      blocks.push({ type: 'h3', text: line.slice(4) });
      return;
    }
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      return;
    }
    flushList();
    blocks.push({ type: 'p', text: line });
  });
  flushList();
  return blocks;
}

function buildFrameworkFromEditor(editorData, notebook) {
  const courseInfo = editorData.courseInfo || {};
  return {
    courseInfo: {
      courseName: courseInfo.courseName || notebook?.name || '',
      courseCode: courseInfo.courseCode || notebook?.courseCode || '',
      totalHours: Number(courseInfo.totalHours) || 0,
      theoryHours: Number(courseInfo.theoryHours) || 0,
      practiceHours: Number(courseInfo.practiceHours) || 0,
      targetGrade: courseInfo.targetGrade || notebook?.grade || '',
      prerequisite: courseInfo.prerequisite || notebook?.prerequisite || ''
    },
    objectives: {
      knowledge: arr(editorData.objectives?.knowledge),
      skills: arr(editorData.objectives?.skills),
      attitude: arr(editorData.objectives?.attitude)
    },
    teachingMethods: {
      primary: editorData.teachingMethods?.primary || '',
      secondary: arr(editorData.teachingMethods?.secondary)
    },
    ideologicalElements: {
      craftsmanship: editorData.ideologicalElements?.craftsmanship || '',
      culturalConfidence: editorData.ideologicalElements?.culturalConfidence || '',
      other: editorData.ideologicalElements?.other || ''
    },
    modules: arr(editorData.modules).map((item, index) => ({
      number: Number(item.moduleNumber) || index + 1,
      name: item.name || `模块${index + 1}`,
      hours: Number(item.hours) || 0,
      description: item.description || '',
      keyPoints: arr(item.knowledgePoints),
      teachingMethods: item.teachingMethods || '',
      isCore: Boolean(item.isCore)
    }))
  };
}

function buildFrameworkMarkdown(notebook, framework, schedule) {
  const source = framework || {};
  const courseInfo = source.courseInfo || notebook || {};
  const objectives = source.objectives || {};
  const modules = arr(source.modules);
  const methods = source.teachingMethods || {};
  const politics = source.ideologicalElements || {};
  const scheduleList = arr(schedule);
  return [
    `# ${(courseInfo.courseName || notebook?.name || '课程')} 教学框架确认稿`,
    '',
    '## 课程信息',
    `- 课程名称：${courseInfo.courseName || notebook?.name || '-'}`,
    `- 专业代码：${courseInfo.courseCode || notebook?.courseCode || '-'}`,
    `- 授课对象：${courseInfo.targetGrade || notebook?.grade || '-'}`,
    `- 总学时：${courseInfo.totalHours || notebook?.totalHours || 0} 学时`,
    `- 先修课程：${courseInfo.prerequisite || notebook?.prerequisite || '-'}`,
    '',
    '## 教学目标',
    ...arr(objectives.knowledge).map((item) => `- 知识目标：${item}`),
    ...arr(objectives.skills).map((item) => `- 技能目标：${item}`),
    ...arr(objectives.attitude).map((item) => `- 素养目标：${item}`),
    '',
    '## 教学方法',
    `- 主要教学方法：${methods.primary || '-'}`,
    ...arr(methods.secondary).map((item) => `- 辅助教学方法：${item}`),
    '',
    '## 思政元素',
    `- 工匠精神：${politics.craftsmanship || '-'}`,
    `- 文化自信：${politics.culturalConfidence || '-'}`,
    `- 其他元素：${politics.other || '-'}`,
    '',
    '## 教学模块',
    ...(modules.length ? modules.map((item, index) => `- 模块${item.number || index + 1}：${item.name}（${item.hours || 0}学时）`) : ['- 暂无模块']),
    '',
    '## 教学进度表',
    ...(scheduleList.length ? scheduleList.map((item, index) => `- 环节${index + 1}：${item.topic || '-'}（${item.hours || 0}学时） ${item.assignment || ''}`.trim()) : ['- 暂无进度安排'])
  ].join('\n');
}

function getLectureValidationBlockingMessage(validation) {
  if (!validation || typeof validation !== 'object') return '';
  const missingSections = Array.isArray(validation.missingSections) ? validation.missingSections : [];
  if (missingSections.length) {
    return `正式讲稿缺少必要章节：${missingSections.join('、')}`;
  }
  if (validation.hasTeacherNarration === false || validation.hasClassroomActions === false) {
    return '正式讲稿缺少”教师讲述”或”课堂动作附栏”结构。';
  }
  // 字数检查改为非阻塞（不同学时字数要求不同，由后端 quality.js 做警告）
  if (validation.hasMetaInstructionLeak) {
    return '正式讲稿仍混入提示词或元说明。';
  }
  if (validation.hasBulletNarration) {
    return '正式讲稿教师讲述仍是提词卡式短句，未整理为正文段落。';
  }
  return '';
}

function buildFrameworkPreview(framework, notebook, modules, schedule) {
  const source = framework && typeof framework === 'object' ? framework : {};
  const courseInfo = source.courseInfo || notebook || {};
  const objectives = source.objectives || {};
  const methods = source.teachingMethods || {};
  const politics = source.ideologicalElements || {};
  return {
    courseInfo: [
      ['课程名称', courseInfo.courseName || notebook?.name || '-'],
      ['专业代码', courseInfo.courseCode || notebook?.courseCode || '-'],
      ['授课对象', courseInfo.targetGrade || notebook?.grade || '-'],
      ['总学时', `${courseInfo.totalHours || notebook?.totalHours || 0} 学时`],
      ['先修课程', courseInfo.prerequisite || notebook?.prerequisite || '-']
    ],
    objectives: [
      { label: '知识目标', items: arr(objectives.knowledge) },
      { label: '技能目标', items: arr(objectives.skills) },
      { label: '素养目标', items: arr(objectives.attitude) }
    ],
    modules: arr(modules).map((item, index) => ({
      key: item.id || index,
      title: `模块${item.moduleNumber || index + 1}：${item.name || '未命名模块'}`,
      hours: item.hours || 0,
      summary: item.description || '',
      infographic: item.content?.structureImagePath || item.content?.structureImageUrl || '',
      infographicDraft: item.content?.v2DraftInfographicWorkspaceImagePath || item.content?.v2DraftInfographicPath || ''
    })),
    methods: [methods.primary, ...arr(methods.secondary)].filter(Boolean),
    politics: [politics.craftsmanship, politics.culturalConfidence, politics.other].filter(Boolean),
    schedule: arr(schedule).map((item, index) => ({
      key: `${item.week || index + 1}-${index}`,
      title: item.topic || `环节 ${index + 1}`,
      meta: `${item.hours || 0} 学时`,
      summary: item.assignment || item.methods || ''
    }))
  };
}

function frameworkToEditor(notebook, frameworkRecord, modules, schedule) {
  const source = frameworkRecord?.content || {};
  const courseInfo = source.courseInfo || {};
  const objectives = source.objectives || {};
  const methods = source.teachingMethods || {};
  const politics = source.ideologicalElements || {};
  const sourceModules = arr(source.modules);
  const rows = arr(modules).length
    ? arr(modules).map((item, index) => ({
      id: item.id || `module-${index + 1}`,
      moduleNumber: Number(item.moduleNumber) || index + 1,
      name: item.name || '',
      hours: Number(item.hours) || 0,
      description: item.description || '',
      knowledgePoints: arr(item.knowledgePoints),
      teachingMethods: item.teachingMethods || '',
      isCore: Boolean(item.isCore),
      content: item.content || {}
    }))
    : sourceModules.map((item, index) => ({
      id: `module-${index + 1}`,
      moduleNumber: Number(item.number) || index + 1,
      name: item.name || '',
      hours: Number(item.hours) || 0,
      description: item.description || '',
      knowledgePoints: arr(item.keyPoints),
      teachingMethods: item.teachingMethods || '',
      isCore: Boolean(item.isCore),
      content: {}
    }));

  return {
    courseInfo: {
      courseName: courseInfo.courseName || notebook?.name || '',
      courseCode: courseInfo.courseCode || notebook?.courseCode || '',
      targetGrade: courseInfo.targetGrade || notebook?.grade || '',
      prerequisite: courseInfo.prerequisite || notebook?.prerequisite || '',
      totalHours: Number(courseInfo.totalHours || notebook?.totalHours || 0),
      theoryHours: Number(courseInfo.theoryHours || notebook?.theoryHours || 0),
      practiceHours: Number(courseInfo.practiceHours || notebook?.practiceHours || 0)
    },
    objectives: {
      knowledge: arr(objectives.knowledge),
      skills: arr(objectives.skills),
      attitude: arr(objectives.attitude)
    },
    teachingMethods: {
      primary: methods.primary || '',
      secondary: arr(methods.secondary)
    },
    ideologicalElements: {
      craftsmanship: politics.craftsmanship || '',
      culturalConfidence: politics.culturalConfidence || '',
      other: politics.other || ''
    },
    modules: rows,
    schedule: arr(schedule).map((item, index) => ({
      id: `${item.week || index + 1}-${index}`,
      week: Number(item.week) || index + 1,
      topic: item.topic || '',
      hours: Number(item.hours) || 0,
      methods: item.methods || '',
      assignment: item.assignment || ''
    }))
  };
}

function HomeView({ notebooks, onSelect, onCreateClick, onApiClick }) {
  return (
    <main className="v2-home">
      <section className="v2-home-hero">
        <h2>V2 阶段工作台</h2>
        <p>主入口只保留 API 配置和新建笔记本。进入笔记本后按框架、讲稿、PPT、视频提示词顺序推进。</p>
        <div className="v2-inline-actions">
          <button className="v2-btn v2-btn-primary" onClick={onCreateClick}>新建笔记本</button>
          <button className="v2-btn v2-btn-secondary" onClick={onApiClick}>API 配置</button>
        </div>
      </section>
      <section className="v2-home-list">
        <div className="v2-panel-head">
          <h3>已有笔记本</h3>
          <span className="v2-hint">{`共 ${notebooks.length} 个`}</span>
        </div>
        <div className="v2-home-notebooks">
          {notebooks.length ? notebooks.map((item) => (
            <button key={item.id} className="v2-notebook-card" onClick={() => onSelect(item.id)}>
              <strong>{item.name}</strong>
              <span>{`${item.totalHours || 0} 学时 · ${item.grade || '-'}`}</span>
              <span>{dt(item.updatedAt || item.createdAt)}</span>
            </button>
          )) : <p className="v2-hint">当前还没有笔记本。</p>}
        </div>
      </section>
    </main>
  );
}

export default function V2App() {
  const isDesktop = Boolean(api);
  const [notebooks, setNotebooks] = useState([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState(null);
  const [selectedNotebook, setSelectedNotebook] = useState(null);
  const [workflowState, setWorkflowState] = useState({ currentStage: 'framework', unlockedStages: ['framework'] });
  const [resources, setResources] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(NOTEBOOK_FORM);
  const [showEditCtx, setShowEditCtx] = useState(false);     // 编辑现有笔记本富上下文
  const [editCtxForm, setEditCtxForm] = useState({});        // 正在编辑的笔记本上下文字段
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchResult, setResearchResult] = useState(null);
  const [agentBusy, setAgentBusy] = useState(false);          // Phase-5C: Agent 运行中
  const [agentLog, setAgentLog] = useState(null);             // Phase-5C: Agent 执行日志
  const [referenceContext, setReferenceContext] = useState(''); // Phase-5C: 参考资料注入
  const [refFetchBusy, setRefFetchBusy] = useState(false);     // Phase-5C: URL 读取中
  const [showApi, setShowApi] = useState(false);
  const [apiForm, setApiForm] = useState(API_FORM);
  const [assistantStatus, setAssistantStatus] = useState('请选择一个笔记本，先完成 V2 阶段冒烟。');
  const [busyKey, setBusyKey] = useState('');
  const [frameworkRecord, setFrameworkRecord] = useState(null);
  const [frameworkVersions, setFrameworkVersions] = useState([]);
  const [editorData, setEditorData] = useState(frameworkToEditor(null, null, [], []));
  const [requirementText, setRequirementText] = useState('');
  const [rightTab, setRightTab] = useState('preview');
  const [rawJsonText, setRawJsonText] = useState('{}');
  const [rawJsonError, setRawJsonError] = useState('');
  const [frameworkArtifacts, setFrameworkArtifacts] = useState([]);
  const [infographicBusyKey, setInfographicBusyKey] = useState('');
  const [infographicLayout, setInfographicLayout] = useState('grid_cards');
  const [infographicStyle, setInfographicStyle] = useState('professional');
  const [diagramBusy, setDiagramBusy] = useState(false);
  const [diagramResult, setDiagramResult] = useState(null); // { svg, svgDataUri, svgPath, diagramType }
  // ── 方向三：教师配图控制层 ──────────────────────────────────────────────────
  const [coverImageBusy, setCoverImageBusy] = useState(false);
  const [coverConfirmed, setCoverConfirmed] = useState(false);
  const [styleAnchor, setStyleAnchor] = useState('');
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, running: false });
  const [lectureState, setLectureState] = useState({ instruction: '', drafts: { a: '', b: '', c: '' }, selectedDraft: 'a', finalScript: '' });
  const [lectureReview, setLectureReview] = useState(null);  // Phase-5B: AI 审核结果
  const [lectureArtifacts, setLectureArtifacts] = useState([]);
  const [pptState, setPptState] = useState({ templateKey: 'pro_minimalist', pptOutline: '', pptPages: [], selectedPageId: '' });
  const pptStateRef = useRef(pptState);
  pptStateRef.current = pptState;
  const [pptArtifacts, setPptArtifacts] = useState([]);
  const [pptVersions, setPptVersions] = useState([]);
  const [videoState, setVideoState] = useState({ promptText: '', style: '专业稳重', engine: 'jimeng' });
  const [videoArtifacts, setVideoArtifacts] = useState([]);
  const [backendEvents, setBackendEvents] = useState([]);
  const [stageRuntimeMeta, setStageRuntimeMeta] = useState({
    framework: { quality: null, operations: [] },
    lecture: { quality: null, operations: [] },
    ppt: { quality: null, operations: [] },
    video: { quality: null, operations: [] }
  });
  const notebookLoadSeqRef = useRef(0);
  const lectureEditRef = useRef({ notebookId: null, editedAt: 0 });
  const currentStage = workflowState?.currentStage || selectedNotebook?.currentStage || 'framework';
  const unlockedStages = arr(workflowState?.unlockedStages).length ? arr(workflowState.unlockedStages) : ['framework'];
  const busy = Boolean(busyKey);
  const currentRuntimeMeta = stageRuntimeMeta[currentStage] || { quality: null, operations: [] };
  const stageArtifacts = useMemo(() => ({
    framework: frameworkArtifacts,
    lecture: lectureArtifacts,
    ppt: pptArtifacts,
    video: videoArtifacts
  }), [frameworkArtifacts, lectureArtifacts, pptArtifacts, videoArtifacts]);
  const stageCards = useMemo(() => (
    STAGES.map((item) => ({
      ...item,
      state: resolveStageState({
        stage: item.key,
        currentStage,
        unlockedStages,
        quality: stageRuntimeMeta[item.key]?.quality,
        artifacts: stageArtifacts[item.key]
      })
    }))
  ), [currentStage, unlockedStages, stageRuntimeMeta, stageArtifacts]);
  const currentStageCard = stageCards.find((item) => item.key === currentStage) || stageCards[0];
  const currentStageEvents = useMemo(() => (
    arr(backendEvents).filter((item) => !item.stage || item.stage === currentStage).slice(0, 6)
  ), [backendEvents, currentStage]);

  const frameworkJson = useMemo(() => buildFrameworkFromEditor(editorData, selectedNotebook), [editorData, selectedNotebook]);
  const frameworkPreview = useMemo(
    () => buildFrameworkPreview(frameworkJson, selectedNotebook, editorData.modules, editorData.schedule),
    [frameworkJson, selectedNotebook, editorData]
  );
  const markdownBlocks = useMemo(
    () => renderMarkdownPreview(buildFrameworkMarkdown(selectedNotebook, frameworkJson, editorData.schedule)),
    [selectedNotebook, frameworkJson, editorData.schedule]
  );
  const selectedDraftText = lectureState.drafts?.[lectureState.selectedDraft] || '';
  const currentTemplate = PPT_TEMPLATE_PRESETS[pptState.templateKey] || PPT_TEMPLATE_PRESETS.pro_minimalist;
  const currentPptPage = useMemo(
    () => arr(pptState.pptPages).find((item) => item.id === pptState.selectedPageId) || null,
    [pptState]
  );
  const updateLectureStateFromUser = (updater) => {
    lectureEditRef.current = {
      notebookId: selectedNotebookId,
      editedAt: Date.now()
    };
    setLectureState((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  };

  const loadNotebookList = async (preserveId = selectedNotebookId || Number(readLocalStorage(STORAGE_KEYS.selectedNotebookId)) || null) => {
    const response = await api.getAllNotebooks();
    const list = response?.success ? arr(response.data) : [];
    setNotebooks(list);
    if (preserveId && list.some((item) => item.id === preserveId)) {
      setSelectedNotebookId(preserveId);
      return preserveId;
    }
    const nextId = list[0]?.id || null;
    setSelectedNotebookId(nextId);
    return nextId;
  };

  const loadApiForm = async () => {
    const [arkRes, textRes, imageRes, imageFallbackRes, videoRes] = await Promise.all([
      api.getApiKey('ark'),
      api.getApiKey('ark_endpoint_text'),
      api.getApiKey('ark_endpoint_image'),
      api.getApiKey('ark_endpoint'),
      api.getApiKey('ark_endpoint_video_t2v')
    ]);
    setApiForm({
      ark: arkRes?.success ? String(arkRes.data || '') : '',
      arkTextEndpoint: textRes?.success ? String(textRes.data || '') : '',
      arkImageEndpoint: imageRes?.success
        ? String(imageRes.data || imageFallbackRes?.data || '')
        : String(imageFallbackRes?.data || ''),
      arkVideoEndpoint: videoRes?.success ? String(videoRes.data || '') : ''
    });
  };

  const updateStageRuntimeMeta = (stage, data) => {
    if (!stage) return;
    setStageRuntimeMeta((prev) => ({
      ...prev,
      [stage]: {
        quality: data?.quality || null,
        operations: arr(data?.operations)
      }
    }));
  };

  const loadNotebookContext = async (notebookId) => {
    if (!notebookId) return;
    const loadSeq = notebookLoadSeqRef.current + 1;
    notebookLoadSeqRef.current = loadSeq;
    const loadStartedAt = Date.now();
    const responses = await Promise.all([
      api.getNotebookById(notebookId),
      api.getWorkflowState(notebookId),
      api.listResources({ notebookId }),
      api.listBackendEvents ? api.listBackendEvents({ notebookId, limit: 24 }) : Promise.resolve({ success: true, data: [] }),
      api.getFrameworkStageDataV2(notebookId),
      api.getLectureStageDataV2(notebookId),
      api.getPptStageDataV2(notebookId),
      api.getVideoStageDataV2(notebookId)
    ]);
    if (loadSeq !== notebookLoadSeqRef.current) return;
    const [notebookRes, workflowRes, resourceRes, eventsRes, frameworkRes, lectureRes, pptRes, videoRes] = responses;
    if (!notebookRes?.success) {
      window.alert(`加载笔记本失败：${notebookRes?.error || '未知错误'}`);
      return;
    }
    const notebook = notebookRes.data;
    setSelectedNotebook(notebook);
    setWorkflowState(
      workflowRes?.success
        ? workflowRes.data
        : { currentStage: notebook.currentStage || 'framework', unlockedStages: ['framework'] }
    );
    setResources(resourceRes?.success ? arr(resourceRes.data) : []);
    setBackendEvents(eventsRes?.success ? arr(eventsRes.data) : []);
    setWorkspace(frameworkRes?.success ? frameworkRes.data?.workspace : null);

    if (frameworkRes?.success) {
      const data = frameworkRes.data;
      updateStageRuntimeMeta('framework', data);
      const nextEditor = frameworkToEditor(notebook, data.frameworkRecord, data.modules, data.schedule);
      setFrameworkRecord(data.frameworkRecord || null);
      setFrameworkVersions(arr(data.frameworkVersions));
      setFrameworkArtifacts(arr(data.artifacts));
      setEditorData(nextEditor);
      setRawJsonText(JSON.stringify(buildFrameworkFromEditor(nextEditor, notebook), null, 2));
      setRawJsonError('');
    }
    if (lectureRes?.success) {
      const data = lectureRes.data;
      const cachedLectureState = readLectureStageCache(notebookId);
      updateStageRuntimeMeta('lecture', data);
      const localEdit = lectureEditRef.current;
      const shouldPreserveLocalLectureState = Number(localEdit?.notebookId) === Number(notebookId)
        && Number(localEdit?.editedAt || 0) > loadStartedAt;
      if (!shouldPreserveLocalLectureState) {
        setLectureState({
          instruction: String(cachedLectureState?.instruction || data.lectureData?.instruction || ''),
          drafts: {
            a: String(cachedLectureState?.drafts?.a || data.lectureData?.drafts?.a || ''),
            b: String(cachedLectureState?.drafts?.b || data.lectureData?.drafts?.b || ''),
            c: String(cachedLectureState?.drafts?.c || data.lectureData?.drafts?.c || '')
          },
          selectedDraft: String(cachedLectureState?.selectedDraft || data.lectureData?.selectedDraft || 'a'),
          finalScript: String(cachedLectureState?.finalScript || data.lectureData?.finalScript || '')
        });
        lectureEditRef.current = { notebookId, editedAt: 0 };
      }
      setLectureArtifacts(arr(data.lectureData?.artifacts));
    }
    if (pptRes?.success) {
      const data = pptRes.data;
      const templateKey = data.pptData?.templateKey || 'pro_minimalist';
      const normalizedPages = normalizePptPagesWithPrompts(arr(data.pptData?.pptPages), {
        template: PPT_TEMPLATE_PRESETS[templateKey] || PPT_TEMPLATE_PRESETS.pro_minimalist,
        courseName: notebook?.name || '课程'
      });
      // 确保 selectedPageId 指向实际存在的页面（dedup 后 id 可能已变更）
      const savedSelectedId = data.pptData?.selectedPageId || '';
      const validSelectedId = normalizedPages.find((p) => p.id === savedSelectedId)?.id
        || normalizedPages[0]?.id || '';
      updateStageRuntimeMeta('ppt', data);
      setPptState({
        templateKey,
        pptOutline: data.pptData?.pptOutline || '',
        pptPages: normalizedPages,
        selectedPageId: validSelectedId
      });
      setPptArtifacts(arr(data.pptData?.artifacts));
    }
    if (videoRes?.success) {
      const data = videoRes.data;
      updateStageRuntimeMeta('video', data);
      setVideoState({
        promptText: data.videoData?.promptText || '',
        style: data.videoData?.style || '专业稳重',
        engine: data.videoData?.engine || 'jimeng'
      });
      setVideoArtifacts(arr(data.videoData?.artifacts));
    }
    // 切换笔记本时强制刷新状态栏，清除上一个笔记本的瞬态状态
    setAssistantStatus(`已加载《${notebook.name || '课程'}》，当前位于 ${STAGE_TITLE_MAP[workflowRes?.data?.currentStage || notebook.currentStage || 'framework'] || '教学框架'} 阶段。`);
    setLectureReview(null);
    setResearchResult(null);
    setResearchBusy(false);
    setAgentLog(null);       // 清除上一个课程的 agent 日志
    setReferenceContext(''); // 清除上一个课程的参考资料
  };

  useEffect(() => {
    if (!isDesktop) return;
    loadNotebookList();
    loadApiForm();
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop || !selectedNotebookId) return;
    loadNotebookContext(selectedNotebookId);
  }, [isDesktop, selectedNotebookId]);

  useEffect(() => {
    if (!selectedNotebookId) {
      writeLocalStorage(STORAGE_KEYS.selectedNotebookId, '');
      return;
    }
    writeLocalStorage(STORAGE_KEYS.selectedNotebookId, String(selectedNotebookId));
  }, [selectedNotebookId]);

  useEffect(() => {
    if (!selectedNotebookId) return;
    writeLocalStorage(getLectureStageCacheKey(selectedNotebookId), JSON.stringify({
      instruction: String(lectureState.instruction || ''),
      drafts: {
        a: String(lectureState.drafts?.a || ''),
        b: String(lectureState.drafts?.b || ''),
        c: String(lectureState.drafts?.c || '')
      },
      selectedDraft: String(lectureState.selectedDraft || 'a'),
      finalScript: String(lectureState.finalScript || ''),
      savedAt: new Date().toISOString()
    }));
  }, [selectedNotebookId, lectureState]);

  useEffect(() => {
    if (!selectedNotebookId || !pptState.selectedPageId) {
      setPptVersions([]);
      return;
    }
    const taskId = getPptPageTaskId(selectedNotebookId, pptState.selectedPageId);
    api.listImageVersions(taskId).then((response) => {
      setPptVersions(response?.success ? arr(response.data) : []);
    });
  }, [selectedNotebookId, pptState.selectedPageId]);

  const updateNotebookCache = (notebook) => {
    if (!notebook?.id) return;
    setNotebooks((prev) => prev.map((item) => (item.id === notebook.id ? notebook : item)));
  };

  const selectStage = async (stage) => {
    if (!selectedNotebookId || !unlockedStages.includes(stage)) return;
    const response = await api.setWorkflowStage({ notebookId: selectedNotebookId, stage });
    if (!response?.success) {
      window.alert(`切换阶段失败：${response?.error || '未知错误'}`);
      return;
    }
    setWorkflowState(response.data);
    setAssistantStatus(`已切换到 ${STAGES.find((item) => item.key === stage)?.title || stage} 阶段。`);
    await loadNotebookContext(selectedNotebookId);
  };

  const saveFrameworkStage = async (options = {}) => {
    if (!selectedNotebookId) return false;
    setBusyKey('framework-save');
    try {
      const response = await api.saveFrameworkStageV2({
        notebookId: selectedNotebookId,
        framework: buildFrameworkFromEditor(editorData, selectedNotebook),
        modules: editorData.modules,
        schedule: editorData.schedule
      });
      if (!response?.success) {
        window.alert(`保存教学框架失败：${response?.error || '未知错误'}`);
        return false;
      }
      setAssistantStatus(options.previewOnly ? '框架已保存，右侧预览已同步。' : '教学框架已保存。');
      await loadNotebookContext(selectedNotebookId);
      updateNotebookCache(response.data?.notebook);
      return true;
    } finally {
      setBusyKey('');
    }
  };

  const handleGenerateFramework = async () => {
    if (!selectedNotebookId || !selectedNotebook) return;
    if (!String(requirementText || '').trim()) {
      window.alert('请先填写本轮需求。');
      return;
    }
    setBusyKey('framework-generate');
    try {
      const response = await api.generateFramework({
        courseInfo: {
          ...selectedNotebook,
          description: [selectedNotebook.description, `修订要求：${requirementText.trim()}`].filter(Boolean).join('\n')
        }
      });
      if (!response?.success) {
        window.alert(`生成教学框架失败：${response?.error || '未知错误'}`);
        return;
      }
      setAssistantStatus('教学框架已生成，请检查卡片和右侧确认稿预览。');
      await loadNotebookContext(selectedNotebookId);
    } finally {
      setBusyKey('');
    }
  };

  const handleConfirmFramework = async () => {
    if (!selectedNotebookId) return;
    setBusyKey('framework-confirm');
    try {
      const response = await api.confirmFrameworkStageV2({
        notebookId: selectedNotebookId,
        framework: buildFrameworkFromEditor(editorData, selectedNotebook),
        modules: editorData.modules,
        schedule: editorData.schedule
      });
      if (!response?.success) {
        window.alert(`确认教学框架失败：${response?.error || '未知错误'}`);
        return;
      }
      setAssistantStatus('教学框架已确认，讲稿阶段已解锁。');
      await loadNotebookContext(selectedNotebookId);
    } finally {
      setBusyKey('');
    }
  };

  const handleExportFrameworkWord = async () => {
    if (!selectedNotebookId) return;
    const response = await api.exportMergedFramework({ notebookId: selectedNotebookId, format: 'docx' });
    if (!response?.success) {
      window.alert(`导出确认稿失败：${response?.error || '未知错误'}`);
      return;
    }
    if (response.data?.filePath) {
      setAssistantStatus(`框架确认稿已导出：${response.data.filePath}`);
    }
  };

  // ── Phase baoyu-A：SVG 教学结构图生成 ─────────────────────────────────────

  const handleGenerateDiagram = async (diagramType = 'hierarchy') => {
    if (!selectedNotebookId) return;
    setDiagramBusy(true);
    setAssistantStatus(`AI 正在生成${diagramType === 'mindmap' ? '思维导图' : diagramType === 'flowchart' ? '流程图' : diagramType === 'timeline' ? '时间轴' : '知识结构图'}…`);
    try {
      const response = await api.generateDiagramV2({
        notebookId: selectedNotebookId,
        courseName: selectedNotebook?.name || '课程',
        diagramType
      });
      if (!response?.success) {
        window.alert(`生成结构图失败：${response?.error || '未知错误'}`);
        return;
      }
      setDiagramResult(response.data);
      setAssistantStatus(`✅ ${diagramType} 结构图已生成，可在右侧查看或下载 SVG。`);
    } finally {
      setDiagramBusy(false);
    }
  };

  // ── Phase baoyu-B：信息图生成（支持 layout/visualStyle）────────────────────

  const handleGenerateInfographic = async (moduleItem) => {
    if (!selectedNotebookId) return;
    setInfographicBusyKey(String(moduleItem.id));
    try {
      const response = await api.generateFrameworkInfographicV2({
        notebookId: selectedNotebookId,
        topic: moduleItem.name || '教学模块信息图',
        content: [moduleItem.description, ...arr(moduleItem.knowledgePoints)].filter(Boolean).join('\n'),
        style: '教学框架信息图',
        layout: infographicLayout,
        visualStyle: infographicStyle,
        promptFinal: String(moduleItem.content?.v2DraftInfographicPrompt || '').trim()
      });
      if (!response?.success) {
        window.alert(`生成信息图失败：${response?.error || '未知错误'}`);
        return;
      }
      setEditorData((prev) => ({
        ...prev,
        modules: prev.modules.map((item) => (
          item.id === moduleItem.id
            ? {
              ...item,
              content: {
                ...(item.content || {}),
                v2DraftInfographicPath: response.data?.imagePath || '',
                v2DraftInfographicWorkspaceImagePath: response.data?.workspaceImagePath || '',
                v2DraftInfographicHtmlPath: response.data?.workspaceHtmlPath || '',
                v2DraftInfographicPrompt: response.data?.promptFinal || '',
                v2DraftInfographicResourceId: response.data?.resourceId || null
              }
            }
            : item
        ))
      }));
      setAssistantStatus(`已生成模块信息图草稿：${moduleItem.name || '未命名模块'}。`);
    } finally {
      setInfographicBusyKey('');
    }
  };

  const handleConfirmInfographic = async (moduleItem) => {
    if (!selectedNotebookId) return;
    if (!moduleItem.id) {
      window.alert('请先保存框架，让模块写入数据库后再确认信息图。');
      return;
    }
    const imageData = {
      prompt: moduleItem.content?.v2DraftInfographicPrompt || '',
      imagePath: moduleItem.content?.v2DraftInfographicPath || '',
      workspaceImagePath: moduleItem.content?.v2DraftInfographicWorkspaceImagePath || '',
      workspaceHtmlPath: moduleItem.content?.v2DraftInfographicHtmlPath || '',
      resourceId: moduleItem.content?.v2DraftInfographicResourceId || null
    };
    if (!imageData.imagePath && !imageData.workspaceImagePath) {
      window.alert('请先生成信息图草稿。');
      return;
    }
    setInfographicBusyKey(`confirm-${moduleItem.id}`);
    try {
      const response = await api.confirmFrameworkInfographicV2({
        notebookId: selectedNotebookId,
        moduleId: moduleItem.id,
        topic: moduleItem.name || '教学模块信息图',
        imageData
      });
      if (!response?.success) {
        window.alert(`确认信息图失败：${response?.error || '未知错误'}`);
        return;
      }
      setAssistantStatus(`模块信息图已确认：${moduleItem.name || '未命名模块'}。`);
      await loadNotebookContext(selectedNotebookId);
    } finally {
      setInfographicBusyKey('');
    }
  };

  // ── Phase baoyu-C：知识点卡片导出 ─────────────────────────────────────────

  const handleExportKnowledgeCards = async () => {
    if (!selectedNotebookId) return;
    setBusyKey('knowledge-cards');
    try {
      const response = await api.exportKnowledgeCardsV2({
        notebookId: selectedNotebookId,
        style: 'professional'
      });
      if (response?.cancelled) return;
      if (!response?.success && !response?.data) {
        window.alert(`导出知识点卡片失败：${response?.error || '未知错误'}`);
        return;
      }
      setAssistantStatus(`📚 知识点卡片已导出：${response.data?.filePath || ''}`);
    } finally {
      setBusyKey('');
    }
  };

  const persistLectureState = async (nextState, confirm = false) => {
    const method = confirm ? api.confirmLectureStageV2 : api.saveLectureStageV2;
    const response = await method({ notebookId: selectedNotebookId, ...nextState });
    if (!response?.success) {
      window.alert(`${confirm ? '确认' : '保存'}讲稿阶段失败：${response?.error || '未知错误'}`);
      return false;
    }
    await loadNotebookContext(selectedNotebookId);
    return true;
  };

  const handleGenerateLectureDrafts = async () => {
    if (!selectedNotebookId) return;
    setBusyKey('lecture-drafts');
    try {
      const response = await api.generateLectureABC({
        notebookId: selectedNotebookId,
        courseName: selectedNotebook?.name || '课程',
        modules: editorData.modules,
        styleRubricText: lectureState.instruction,
        referenceContext  // 参考资料同步注入 A/B/C 生成
      });
      if (!response?.success) {
        window.alert(`生成讲稿 A/B/C 失败：${response?.error || '未知错误'}`);
        return;
      }
      const nextState = {
        ...lectureState,
        drafts: {
          a: String(response.data?.a || ''),
          b: String(response.data?.b || ''),
          c: String(response.data?.c || '')
        }
      };
      setLectureState(nextState);
      await persistLectureState(nextState, false);
      setAssistantStatus('A/B/C 候选讲稿已生成，请先选择更认可的方向，再补充要求生成正式稿。');
    } finally {
      setBusyKey('');
    }
  };

  // ── Phase-5C 参考资料：URL 抓取（支持多 URL，用";"分隔，并行读取）──────────
  const handleFetchRefUrl = async (rawInput) => {
    if (!rawInput) return;
    // 按分号或换行分割，去除空白，过滤空项
    const urls = rawInput
      .split(/[;；\n]/)
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http'));
    if (urls.length === 0) return;
    setRefFetchBusy(true);
    try {
      // 并行抓取所有 URL
      const results = await Promise.allSettled(urls.map((u) => api.fetchUrlContent(u)));
      const texts = [];
      const errors = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.success && r.value.data?.text) {
          texts.push(`【来源 ${i + 1}：${urls[i]}】\n${r.value.data.text}`);
        } else {
          const msg = r.status === 'fulfilled' ? r.value?.error : r.reason?.message;
          errors.push(`URL ${i + 1}（${urls[i]}）：${msg || '读取失败'}`);
        }
      });
      if (texts.length > 0) {
        setReferenceContext((prev) => (prev ? prev + '\n\n' + texts.join('\n\n') : texts.join('\n\n')));
      }
      if (errors.length > 0) {
        window.alert(`以下 URL 读取失败，请手动复制粘贴：\n${errors.join('\n')}`);
      }
    } finally {
      setRefFetchBusy(false);
    }
  };

  // ── Phase-5C 参考资料：.docx 教案上传 ──────────────────────────────────────
  const handleDocxUpload = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      window.alert('文件过大（限 5MB），请上传较小的教案文件');
      return;
    }
    setRefFetchBusy(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      // 转 base64 传给主进程
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      bytes.forEach((b) => { binary += String.fromCharCode(b); });
      const base64 = window.btoa(binary);
      const res = await api.readDocxContent({ base64, filename: file.name });
      if (res?.success && res.data?.text) {
        setReferenceContext((prev) => (prev ? prev + '\n\n' + res.data.text : res.data.text));
      } else {
        window.alert(`解析失败：${res?.error || '无法读取文档，请手动复制粘贴'}`);
      }
    } finally {
      setRefFetchBusy(false);
    }
  };
  // ── End 参考资料 ────────────────────────────────────────────────────────────

  // ── Phase-5C/5D Agent：一键生成框架 + 讲稿 + PPT ──────────────────────────
  const handleAgentRun = async () => {
    if (!selectedNotebookId || agentBusy) return;
    setAgentBusy(true);
    setAgentLog(null);
    setAssistantStatus('🤖 Agent 启动中，正在自动完成框架 + 讲稿 + PPT 生成…');

    // 每 3s 轮询 agentGetStatus 展示实时进度（emitBackendEvent 写 DB，不推 IPC）
    let pollCount = 0;
    const pollInterval = setInterval(async () => {
      try {
        pollCount++;
        const statusRes = await api.agentGetStatus(selectedNotebookId);
        if (statusRes?.success && statusRes.data) {
          const { framework, lecture, ppt } = statusRes.data;
          const done = [];
          if (framework?.valid) done.push('框架✓');
          if (lecture?.valid) done.push('讲稿✓');
          if (ppt?.hasPages) done.push('PPT✓');
          const currentText = !framework?.valid ? '正在生成框架…'
            : !lecture?.valid ? '正在生成讲稿…'
            : !ppt?.hasPages ? '正在生成 PPT…'
            : '收尾中…';
          setAssistantStatus(
            `🤖 Agent 运行中 (${pollCount * 3}s)：${done.length ? done.join(' ') + ' | ' : ''}${currentText}`
          );
        }
      } catch {}
    }, 3000);

    try {
      const response = await api.agentRun({
        notebookId: selectedNotebookId,
        targetStages: ['framework', 'lecture', 'ppt']   // Step A: 包含 PPT 阶段
      });
      if (response?.success) {
        const { status, stepLog, summary } = response.data || {};
        setAgentLog({ status, stepLog: stepLog || [], summary });
        const icon = status === 'success' ? '✅' : status === 'blocked' ? '⚠️' : '❌';
        setAssistantStatus(`${icon} Agent 完成：${summary || '已结束'}`);
        // 刷新当前阶段数据
        if (selectedNotebookId) await loadNotebookContext(selectedNotebookId);
      } else {
        setAssistantStatus(`❌ Agent 失败：${response?.error || '未知错误'}`);
      }
    } catch (err) {
      setAssistantStatus(`❌ Agent 异常：${err.message}`);
    } finally {
      clearInterval(pollInterval);
      setAgentBusy(false);
    }
  };
  // ── End Agent ──────────────────────────────────────────────────────────────

  const handleGenerateFormalLecture = async () => {
    if (!selectedNotebookId) return;
    setBusyKey('lecture-formal');
    setLectureReview(null);  // 清除上次审核结果
    try {
      const response = await api.generateFormalLecture({
        notebookId: selectedNotebookId,
        drafts: lectureState.drafts,
        preferred: lectureState.selectedDraft,
        styleRubricText: lectureState.instruction,
        courseName: selectedNotebook?.name || '课程',
        modules: editorData.modules,
        totalHours: Number(selectedNotebook?.totalHours) || 1,
        keepStructure: true,
        referenceContext  // Phase-5C：老师上传/粘贴的参考资料
      });
      if (!response?.success) {
        window.alert(`生成正式讲稿失败：${response?.error || '未知错误'}`);
        return;
      }
      const nextState = { ...lectureState, finalScript: String(response.data?.script || '') };
      const blockingMessage = getLectureValidationBlockingMessage(response.data?.meta?.validation);
      setLectureState(nextState);
      // Phase-5B: 捕获 AI 审核结果（若后端返回）
      if (response.data?.review) {
        setLectureReview(response.data.review);
      }
      if (blockingMessage) {
        writeLocalStorage(getLectureStageCacheKey(selectedNotebookId), JSON.stringify({
          instruction: String(nextState.instruction || ''),
          drafts: {
            a: String(nextState.drafts?.a || ''),
            b: String(nextState.drafts?.b || ''),
            c: String(nextState.drafts?.c || '')
          },
          selectedDraft: String(nextState.selectedDraft || 'a'),
          finalScript: String(nextState.finalScript || ''),
          savedAt: new Date().toISOString()
        }));
        setAssistantStatus(`正式讲稿生成异常：${blockingMessage}`);
        window.alert(`正式讲稿生成结果未通过校验：${blockingMessage}\n\n请重新生成，或调整补充要求后再试。`);
        return;
      }
      await persistLectureState(nextState, false);
      // Phase-5B: 状态栏附上审核简报
      const reviewNote = response.data?.review
        ? (response.data.review.revised ? '（已 AI 自动修订）' : `（AI 评分 ${response.data.review.score}/10）`)
        : '';
      setAssistantStatus(`已基于 ${String(lectureState.selectedDraft || 'a').toUpperCase()} 稿深度生成正式讲稿。${reviewNote}`);
    } finally {
      setBusyKey('');
    }
  };

  const handleSaveLectureStage = async (nextState) => {
    if (!selectedNotebookId) return;
    setBusyKey('lecture-save');
    try {
      const ok = await persistLectureState(nextState, false);
      if (ok) {
        setAssistantStatus(`讲稿阶段已保存，当前已选择 ${String(nextState?.selectedDraft || 'a').toUpperCase()} 稿作为后续正式稿方向。`);
      }
    } finally {
      setBusyKey('');
    }
  };

  const handleConfirmLecture = async () => {
    if (!String(lectureState.finalScript || '').trim()) {
      window.alert('请先生成或填写正式讲稿。');
      return;
    }
    setBusyKey('lecture-confirm');
    try {
      const ok = await persistLectureState(lectureState, true);
      if (ok) setAssistantStatus('讲稿阶段已确认，PPT 阶段已解锁。');
    } finally {
      setBusyKey('');
    }
  };

  const handleExportLecture = async () => {
    if (!selectedNotebookId) return;
    const response = await api.exportLectureWord({
      notebookId: selectedNotebookId,
      lectureTitle: `正式讲课稿：${selectedNotebook?.name || '课程'}`,
      lectureScript: lectureState.finalScript,
      mergeReport: ''
    });
    if (!response?.success) {
      window.alert(`导出讲稿失败：${response?.error || '未知错误'}`);
      return;
    }
    await loadNotebookContext(selectedNotebookId);
    if (response.data?.filePath) setAssistantStatus(`讲稿 Word 已导出：${response.data.filePath}`);
  };

  const savePptStage = async (nextState) => {
    const normalizedState = {
      ...nextState,
      pptPages: normalizePptPagesWithPrompts(nextState?.pptPages, {
        template: PPT_TEMPLATE_PRESETS[nextState?.templateKey] || currentTemplate,
        courseName: selectedNotebook?.name || '课程'
      })
    };
    const response = await api.savePptStageV2({ notebookId: selectedNotebookId, ...normalizedState });
    if (!response?.success) {
      window.alert(`保存 PPT 阶段失败：${response?.error || '未知错误'}`);
      return false;
    }
    // 保存成功后更新本地 state（不从 DB 重新加载，避免覆盖用户编辑）
    setPptState(normalizedState);
    return true;
  };

  const handleGeneratePptOutline = async () => {
    if (!String(lectureState.finalScript || '').trim()) {
      window.alert('请先确认正式讲稿。');
      return;
    }
    // 若已有 AI 规划页面，询问用户是否覆盖
    const existingCount = Array.isArray(pptState.pptPages) ? pptState.pptPages.length : 0;
    if (existingCount > 0) {
      const ok = window.confirm(
        `当前已有 ${existingCount} 个页面（含 AI 规划内容）。\n\n「生成页级框架」会按讲稿章节 1:1 重新映射，仅生成 ${Math.max(existingCount - 10, 6)}-10 页左右，且会覆盖现有规划。\n\n建议使用「✨ AI 规划页面」获得更合理的页数安排。\n\n确定要用「生成页级框架」覆盖吗？`
      );
      if (!ok) return;
    }
    setBusyKey('ppt-outline');
    try {
      // 重新生成框架时清除所有旧数据，从零开始
      const imageOnlyPrev = [];
      const pages = buildPptPagesFromLecture({
        lectureScript: lectureState.finalScript,
        modules: editorData.modules,
        courseName: selectedNotebook?.name || '课程',
        template: currentTemplate,
        imageAspect: '16:9',
        imageQuality: 'low',
        prevPages: imageOnlyPrev
      });
      const nextState = {
        ...pptState,
        pptPages: pages,
        selectedPageId: pages[0]?.id || '',
        pptOutline: buildPptTextFramework({
          courseName: selectedNotebook?.name || '课程',
          template: currentTemplate,
          pages
        })
      };
      setPptState(nextState);
      await savePptStage(nextState);
      setAssistantStatus(`PPT 页级框架已生成，共 ${pages.length} 页。`);
    } finally {
      setBusyKey('');
    }
  };

  const handleGeneratePptPlan = async () => {
    const script = String(lectureState.finalScript || '').trim();
    if (!script) {
      window.alert('请先确认正式讲稿，再使用 AI 规划页面。');
      return;
    }
    setBusyKey('ppt-plan');
    setAssistantStatus('AI 正在分析讲稿，规划 PPT 页面结构…');
    try {
      const response = await api.generatePptPlanV2({
        notebookId: selectedNotebookId,
        lectureScript: script,
        courseName: selectedNotebook?.name || '课程',
        totalHours: Number(selectedNotebook?.totalHours) || 1,
        modules: editorData.modules,
        prevPages: pptState.pptPages,
        imageAspect: '16:9',
        imageQuality: 'low',
        templateKey: pptState.templateKey || 'pro_minimalist'
      });
      if (!response?.success) {
        setAssistantStatus(`AI 页面规划失败：${response?.error || '未知错误'}`);
        window.alert(`AI 页面规划失败：${response?.error || '未知错误'}`);
        return;
      }
      const { pages: rawPages, pageCount } = response.data;
      // 客户端再次去重，防止服务端极端情况下仍有重复 id
      const pages = deduplicatePptPageIds(rawPages);
      const nextState = {
        ...pptState,
        pptPages: pages,
        selectedPageId: pages[0]?.id || '',
        pptOutline: buildPptTextFramework({
          courseName: selectedNotebook?.name || '课程',
          template: currentTemplate,
          pages
        })
      };
      setPptState(nextState);
      await savePptStage(nextState);
      // 新规划完成后重置封面确认状态，风格锚点需要重新生成
      setCoverConfirmed(false);
      setStyleAnchor('');
      setBatchProgress({ current: 0, total: 0, running: false });
      setAssistantStatus(`✨ AI 已规划 ${pageCount} 页 PPT，包含演讲者备注。下一步：② 生成封面配图确认风格。`);
    } finally {
      setBusyKey('');
    }
  };

  const handleGenerateCurrentPageCandidates = async () => {
    if (!selectedNotebookId || !currentPptPage) return;
    setBusyKey('ppt-candidates');
    try {
      // 强制清空旧 imagePrompt，重建零文字视觉 prompt（不含标题/内容，防止 AI 烧字进图）
      const normalizedPage = ensurePptImagePromptForPage(
        { ...currentPptPage, imagePrompt: '' },
        {
          courseName: selectedNotebook?.name || '课程',
          template: currentTemplate,
          imageAspect: currentPptPage.imageAspect || '16:9',
          imageQuality: currentPptPage.imageQuality || 'low'
        }
      );
      const response = await api.generatePptPageCandidatesV2({
        notebookId: selectedNotebookId,
        templateKey: pptState.templateKey,
        courseName: selectedNotebook?.name || '课程',
        page: normalizedPage
      });
      if (!response?.success) {
        window.alert(`生成候选图失败：${response?.error || '未知错误'}`);
        return;
      }
      const latest = pptStateRef.current;
      const updatedPage = { ...currentPptPage, ...normalizedPage, ...response.data?.page };
      const nextState = {
        ...latest,
        pptPages: (latest.pptPages || []).map((item) => (
          item.id === currentPptPage.id ? updatedPage : item
        ))
      };
      setPptState(nextState);
      pptStateRef.current = nextState;
      setPptVersions(arr(response.data?.versions));
      await savePptStage(nextState);
      setAssistantStatus('配图已生成，正在合成完整 Slide…');

      // 自动 Canvas 合成
      const template = PPT_TEMPLATE_PRESETS[pptState.templateKey] || PPT_TEMPLATE_PRESETS.pro_minimalist;
      const compositePath = await compositePageSlide(updatedPage, template, selectedNotebookId, api);
      if (compositePath) {
        const withComposite = {
          ...pptStateRef.current,
          pptPages: pptStateRef.current.pptPages.map((item) =>
            item.id === currentPptPage.id ? { ...item, compositeImagePath: compositePath } : item
          )
        };
        setPptState(withComposite);
        pptStateRef.current = withComposite;
        await savePptStage(withComposite);
        setAssistantStatus('✅ Slide 合成完成，预览已更新。');
      } else {
        setAssistantStatus('当前页候选图已生成，并写回页级数据。');
      }
    } finally {
      setBusyKey('');
    }
  };

  // ── 方向三：Step 2 — 生成封面配图 ──────────────────────────────────────────

  const handleGenerateCoverImage = async () => {
    if (!selectedNotebookId) return;
    const pages = arr(pptState.pptPages);
    const coverPage = pages.find((p) => p.pageType === '封面') || pages[0];
    if (!coverPage) {
      window.alert('请先完成 AI 页面规划（步骤①），再生成封面配图。');
      return;
    }
    setCoverImageBusy(true);
    setCoverConfirmed(false);
    setStyleAnchor('');
    setAssistantStatus('正在生成封面配图，请稍候…（约 15-30 秒）');
    try {
      // 封面也强制清空旧 imagePrompt，重建零文字 prompt
      const normalizedPage = ensurePptImagePromptForPage(
        { ...coverPage, imagePrompt: '' },
        {
          courseName: selectedNotebook?.name || '课程',
          template: currentTemplate,
          imageAspect: coverPage.imageAspect || '16:9',
          imageQuality: coverPage.imageQuality || 'low'
        }
      );
      const response = await api.generatePptPageCandidatesV2({
        notebookId: selectedNotebookId,
        templateKey: pptState.templateKey,
        courseName: selectedNotebook?.name || '课程',
        page: normalizedPage
      });
      if (!response?.success) {
        window.alert(`封面配图失败：${response?.error || '未知错误'}`);
        return;
      }
      const nextState = {
        ...pptStateRef.current,
        pptPages: (pptStateRef.current.pptPages || []).map((item) =>
          item.id === coverPage.id ? { ...item, ...normalizedPage, ...response.data?.page } : item
        ),
        selectedPageId: coverPage.id
      };
      setPptState(nextState);
      pptStateRef.current = nextState;
      setPptVersions(arr(response.data?.versions));
      await savePptStage(nextState);
      setAssistantStatus('封面配图已生成！查看右侧预览，满意后点击「✅ 确认风格，开始批量」。');
    } finally {
      setCoverImageBusy(false);
    }
  };

  // ── 方向三：Step 2b — 确认封面风格，生成风格锚点 ────────────────────────────

  const handleConfirmCoverStyle = () => {
    const templateStyle = currentTemplate?.imageStyle || '专业教育扁平插图风格，配色统一，笔触简洁';
    const anchor = `【风格一致性锁定】全套配图必须与封面保持完全相同的视觉风格：${templateStyle}。配色系、笔触风格、插图调性高度统一，不允许出现与封面风格相悖的元素。`;
    setStyleAnchor(anchor);
    setCoverConfirmed(true);
    setAssistantStatus(`✅ 封面风格已锁定。现在点击「③ 批量生成全部配图」，系统将自动为所有页面配图并保持风格一致。`);
  };

  // ── 方向三：Step 3 — 批量生成所有配图（携带风格锚点） ─────────────────────

  const handleBatchGenerateImages = async () => {
    if (!selectedNotebookId) return;
    const allPages = arr(pptStateRef.current.pptPages);
    const coverPage = allPages.find((p) => p.pageType === '封面') || allPages[0];
    // 生成所有「需要配图」的页面（含已有图片的页面，换模板后需全部重新生成）
    const pagesToGenerate = allPages.filter((p) => p.needImage);
    if (pagesToGenerate.length === 0) {
      window.alert('当前没有任何页面标记为「需要配图」。');
      return;
    }
    setBatchProgress({ current: 0, total: pagesToGenerate.length, running: true });
    setAssistantStatus(`批量配图开始，共 ${pagesToGenerate.length} 页，请勿关闭窗口…`);

    let currentPages = [...allPages];

    for (let i = 0; i < pagesToGenerate.length; i++) {
      const page = pagesToGenerate[i];
      setBatchProgress({ current: i + 1, total: pagesToGenerate.length, running: true });
      setAssistantStatus(`批量配图中 ${i + 1}/${pagesToGenerate.length}：${page.title || `第${page.pageNumber}页`}…`);
      try {
        // 强制清空旧 imagePrompt，让 ensurePptImagePromptForPage 用新的零文字 prompt 重建。
        // 旧 prompt 包含 "${cleanTitle}" 等内容，会导致 AI 把文字烧进背景图。
        const normalizedPage = ensurePptImagePromptForPage(
          { ...page, imagePrompt: '' },
          {
            courseName: selectedNotebook?.name || '课程',
            template: currentTemplate,
            imageAspect: page.imageAspect || '16:9',
            imageQuality: page.imageQuality || 'low'
          }
        );
        const response = await api.generatePptPageCandidatesV2({
          notebookId: selectedNotebookId,
          templateKey: pptState.templateKey,
          courseName: selectedNotebook?.name || '课程',
          page: normalizedPage
        });
        if (!response?.success) {
          console.warn(`[batch] P${page.pageNumber} 生成失败：${response?.error}`);
          continue;
        }
        const updatedBatchPage = { ...page, ...normalizedPage, ...response.data?.page };
        currentPages = currentPages.map((item) =>
          item.id === page.id ? updatedBatchPage : item
        );
        const nextState = { ...pptStateRef.current, pptPages: currentPages };
        setPptState(nextState);
        pptStateRef.current = nextState;
        await savePptStage(nextState);

        // Canvas 合成（不阻塞进度条）
        const batchTemplate = PPT_TEMPLATE_PRESETS[pptStateRef.current.templateKey] || PPT_TEMPLATE_PRESETS.pro_minimalist;
        compositePageSlide(updatedBatchPage, batchTemplate, selectedNotebookId, api).then((cPath) => {
          if (!cPath) return;
          const withC = {
            ...pptStateRef.current,
            pptPages: pptStateRef.current.pptPages.map((it) =>
              it.id === page.id ? { ...it, compositeImagePath: cPath } : it
            )
          };
          setPptState(withC);
          pptStateRef.current = withC;
          savePptStage(withC).catch(() => {});
        }).catch(() => {});
      } catch (err) {
        console.warn(`[batch] P${page.pageNumber} 异常：`, err.message);
      }
    }

    setBatchProgress({ current: 0, total: 0, running: false });
    setAssistantStatus(`🎉 批量配图完成！共生成 ${pagesToGenerate.length} 页。`);
  };

  const handleRollbackPptVersion = async (version) => {
    if (!selectedNotebookId || !currentPptPage) return;
    const taskId = getPptPageTaskId(selectedNotebookId, currentPptPage.id);
    const response = await api.rollbackImageVersion({ taskId, versionId: version.id });
    if (!response?.success) {
      window.alert(`回退图片版本失败：${response?.error || '未知错误'}`);
      return;
    }
    // 用 ref 读取最新 state，避免闭包覆盖其他页面的图片
    const latest = pptStateRef.current;
    const nextState = {
      ...latest,
      pptPages: (latest.pptPages || []).map((item) => (
        item.id === currentPptPage.id
          ? { ...item, imagePath: response.data?.imagePath || '', imageUrl: response.data?.imageUrl || '', imageModel: response.data?.model || item.imageModel }
          : item
      ))
    };
    setPptState(nextState);
    pptStateRef.current = nextState;
    await savePptStage(nextState);
    const listRes = await api.listImageVersions(taskId);
    setPptVersions(listRes?.success ? arr(listRes.data) : []);
    setAssistantStatus('已回退到选中图片版本。');
  };

  const handleConfirmPpt = async () => {
    const latest = pptStateRef.current;
    if (!(latest.pptPages || []).length) {
      window.alert('请先生成页级框架。');
      return;
    }
    setBusyKey('ppt-confirm');
    try {
      const normalizedState = {
        ...latest,
        pptPages: normalizePptPagesWithPrompts(latest.pptPages, {
          template: currentTemplate,
          courseName: selectedNotebook?.name || '课程'
        })
      };
      const response = await api.confirmPptStageV2({ notebookId: selectedNotebookId, ...normalizedState });
      if (!response?.success) {
        window.alert(`确认 PPT 阶段失败：${response?.error || '未知错误'}`);
        return;
      }
      await loadNotebookContext(selectedNotebookId);
      setAssistantStatus('PPT 阶段已确认，视频提示词阶段已解锁。');
    } finally {
      setBusyKey('');
    }
  };

  const handleExportPpt = async () => {
    if (!selectedNotebookId) return;
    // 用 ref 读取最新 state，避免闭包问题
    const latestPptState = pptStateRef.current;
    const latestPages = normalizePptPagesWithPrompts(latestPptState.pptPages, {
      template: PPT_TEMPLATE_PRESETS[latestPptState.templateKey] || currentTemplate,
      courseName: selectedNotebook?.name || '课程'
    });
    const stateToExport = { ...latestPptState, pptPages: latestPages };
    // 先保存
    const saveOk = await savePptStage(stateToExport);
    if (!saveOk) return;
    // 再确认
    await api.confirmPptStageV2({ notebookId: selectedNotebookId, ...stateToExport }).catch(() => {});
    // 诊断日志：导出时每页的图片路径
    console.log('[PPT导出] 各页imagePath:');
    (stateToExport.pptPages || []).forEach((p, i) => {
      console.log(`  P${i + 1} [${p.pageType}] imagePath=${p.imagePath ? p.imagePath.slice(-50) : '(空)'}`);
    });
    // 最后导出
    const response = await api.exportCoursePpt({
      notebookId: selectedNotebookId,
      templateKey: stateToExport.templateKey,
      lectureScript: lectureState.finalScript,
      pptOutline: stateToExport.pptOutline,
      pptPages: stateToExport.pptPages,
      templateBackground: null
    });
    if (!response?.success) {
      window.alert(`导出 PPT 失败：${response?.error || '未知错误'}`);
      return;
    }
    await loadNotebookContext(selectedNotebookId);
    if (response.data?.filePath) setAssistantStatus(`PPT 已导出：${response.data.filePath}`);
  };

  const saveVideoStage = async (nextState) => {
    const response = await api.saveVideoStageV2({ notebookId: selectedNotebookId, ...nextState });
    if (!response?.success) {
      window.alert(`保存视频阶段失败：${response?.error || '未知错误'}`);
      return false;
    }
    await loadNotebookContext(selectedNotebookId);
    return true;
  };

  const handleGenerateVideoPrompt = async () => {
    const nextState = { ...videoState, promptText: videoPrompt(selectedNotebook?.name || '课程', videoState.style, lectureState.finalScript, pptStateRef.current?.pptPages || []) };
    setVideoState(nextState);
    await saveVideoStage(nextState);
    setAssistantStatus('视频提示词已生成。');
  };

  const handleCopyVideoPrompt = async () => {
    if (!String(videoState.promptText || '').trim()) {
      window.alert('请先生成视频提示词。');
      return;
    }
    try {
      await navigator.clipboard.writeText(videoState.promptText);
      setAssistantStatus('视频提示词已复制。');
    } catch {
      window.alert('复制失败。');
    }
  };

  const handleOpenJimeng = async () => {
    await handleCopyVideoPrompt();
    await api.openExternalUrl(JIMENG_URL);
  };

  const handleOpenPexo = async () => {
    await api.openExternalUrl(PEXO_URL);
  };

  const handleCopyPexoInfo = async () => {
    try {
      await navigator.clipboard.writeText(`PEXO 主页：${PEXO_URL}\n邀请码：${PEXO_CODE}`);
      setAssistantStatus('PEXO 邀请码信息已复制。');
    } catch {
      window.alert(`PEXO 主页：${PEXO_URL}\n邀请码：${PEXO_CODE}`);
    }
  };

  // 打开"编辑课程上下文"弹窗，预填当前笔记本的字段
  const openEditCtx = () => {
    if (!selectedNotebook) return;
    setEditCtxForm({
      softwareTools: selectedNotebook.softwareTools || '',
      jobTargets: selectedNotebook.jobTargets || '',
      industryScenarios: selectedNotebook.industryScenarios || '',
      learnerProfile: selectedNotebook.learnerProfile || '',
      teachingMaterials: selectedNotebook.teachingMaterials || ''
    });
    setShowEditCtx(true);
  };

  // 保存编辑后的课程上下文到数据库
  const saveEditCtx = async () => {
    if (!selectedNotebookId) return;
    const response = await api.updateNotebook(selectedNotebookId, editCtxForm);
    if (!response?.success) {
      window.alert(`保存失败：${response?.error || '未知错误'}`);
      return;
    }
    // 更新本地 selectedNotebook
    setSelectedNotebook((prev) => prev ? { ...prev, ...editCtxForm } : prev);
    setShowEditCtx(false);
    setAssistantStatus('课程上下文已更新，下次生成时将使用新信息。');
  };

  const createNotebook = async () => {
    const payload = { ...createForm, name: String(createForm.name || '').trim() };
    if (!payload.name) {
      window.alert('请填写课程名称。');
      return;
    }
    const response = await api.createNotebook(payload);
    if (!response?.success) {
      window.alert(`创建笔记本失败：${response?.error || '未知错误'}`);
      return;
    }
    setShowCreate(false);
    setCreateForm(NOTEBOOK_FORM);
    setResearchResult(null);
    const nextId = await loadNotebookList(response.data?.id);
    if (nextId) setSelectedNotebookId(nextId);
  };

  // AI 课程研究建议：根据当前表单信息生成软件/岗位/课程标准等参考
  const generateResearch = async () => {
    const name = String(createForm.name || '').trim();
    if (!name) {
      window.alert('请先填写课程名称，再获取 AI 建议。');
      return;
    }
    setResearchBusy(true);
    setResearchResult(null);
    try {
      const response = await api.generateNotebookResearch({
        courseInfo: {
          name,
          courseCode: createForm.courseCode,
          totalHours: createForm.totalHours,
          theoryHours: createForm.theoryHours,
          practiceHours: createForm.practiceHours,
          grade: createForm.grade,
          prerequisite: createForm.prerequisite,
          description: createForm.description,
          softwareTools: createForm.softwareTools,
          jobTargets: createForm.jobTargets
        },
        autoSave: false  // 创建前不保存到 DB，等用户确认
      });
      if (!response?.success) {
        window.alert(`AI 建议生成失败：${response?.error || '未知错误'}`);
        return;
      }
      setResearchResult(response.data);
    } finally {
      setResearchBusy(false);
    }
  };

  // 将 AI 建议一键填入表单
  const applyResearchToForm = () => {
    if (!researchResult) return;
    setCreateForm((prev) => ({
      ...prev,
      softwareTools: prev.softwareTools || [
        researchResult.softwareTools?.primary,
        ...(researchResult.softwareTools?.secondary || [])
      ].filter(Boolean).join('、'),
      jobTargets: prev.jobTargets || (researchResult.jobTargets?.main || []).join('、'),
      industryScenarios: prev.industryScenarios || researchResult.industryScenarios?.primary || '',
      teachingMaterials: prev.teachingMaterials || researchResult.courseStandards?.national || '',
      learnerProfile: prev.learnerProfile || researchResult.learnerProfile?.teachingSuggestion || ''
    }));
    setResearchResult(null);  // 填入后收起建议面板
  };

  const saveApiFormAction = async () => {
    await Promise.all([
      api.saveApiKey('ark', apiForm.ark.trim()),
      api.saveApiKey('ark_endpoint_text', apiForm.arkTextEndpoint.trim()),
      api.saveApiKey('ark_endpoint_image', apiForm.arkImageEndpoint.trim()),
      api.saveApiKey('ark_endpoint', apiForm.arkImageEndpoint.trim()),
      api.saveApiKey('ark_endpoint_video_t2v', apiForm.arkVideoEndpoint.trim())
    ]);
    setShowApi(false);
    setAssistantStatus('API 配置已保存。');
  };

  const importResources = async () => {
    if (!selectedNotebookId) return;
    const response = await api.importResources({ notebookId: selectedNotebookId });
    if (!response?.success) {
      window.alert(`导入素材失败：${response?.error || '未知错误'}`);
      return;
    }
    await loadNotebookContext(selectedNotebookId);
  };

  const deleteResource = async (resourceId) => {
    if (!window.confirm('确认删除这个素材吗？')) return;
    const response = await api.deleteResource(resourceId);
    if (!response?.success) {
      window.alert(`删除素材失败：${response?.error || '未知错误'}`);
      return;
    }
    await loadNotebookContext(selectedNotebookId);
  };

  const handleSaveRawJson = async () => {
    const parsed = parseJson(rawJsonText);
    if (!parsed) {
      setRawJsonError('JSON 格式错误');
      return;
    }
    setRawJsonError('');
    const nextModules = arr(parsed.modules).map((item, index) => {
      const match = editorData.modules.find((moduleItem) => (
        Number(moduleItem.moduleNumber) === Number(item.number || index + 1)
        || String(moduleItem.name || '').trim() === String(item.name || '').trim()
      ));
      return {
        id: match?.id || `module-${index + 1}`,
        moduleNumber: Number(item.number) || index + 1,
        name: item.name || '',
        hours: Number(item.hours) || 0,
        description: item.description || '',
        knowledgePoints: arr(item.keyPoints),
        teachingMethods: item.teachingMethods || '',
        isCore: Boolean(item.isCore),
        content: match?.content || {}
      };
    });
    const nextEditor = frameworkToEditor(selectedNotebook, { content: parsed }, nextModules, editorData.schedule);
    setEditorData(nextEditor);
    await saveFrameworkStage();
  };

  if (!isDesktop) {
    return <div className="v2-shell"><main className="v2-home"><div className="v2-placeholder">请在 Electron 桌面环境中运行。</div></main></div>;
  }

  return (
    <div className="v2-shell">
      <header className="v2-topbar">
        <h1>刘老师<span className="v2-title-agent">agent</span> V2.1</h1>
        <div className="v2-topbar-actions">
          <button className="v2-btn v2-btn-secondary" onClick={() => { loadApiForm(); setShowApi(true); }}>API 配置</button>
          <button className="v2-btn v2-btn-primary" onClick={() => setShowCreate(true)}>新建笔记本</button>
        </div>
      </header>

      {!selectedNotebookId ? (
        <HomeView notebooks={notebooks} onSelect={setSelectedNotebookId} onCreateClick={() => setShowCreate(true)} onApiClick={() => { loadApiForm(); setShowApi(true); }} />
      ) : (
        <div className="v2-layout">
          <aside className="v2-sidebar">
            <section className="v2-sidebar-section">
              <div className="v2-panel-head">
                <h3>笔记本</h3>
                <span className="v2-hint">{`${notebooks.length} 个`}</span>
              </div>
              <div className="v2-notebook-list">
                {notebooks.map((item) => (
                  <button key={item.id} className={`v2-notebook-card ${item.id === selectedNotebookId ? 'active' : ''}`} onClick={() => setSelectedNotebookId(item.id)}>
                    <strong>{item.name}</strong>
                    <span>{`${item.totalHours || 0} 学时 · ${item.grade || '-'}`}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="v2-sidebar-section">
              <h3>阶段导航</h3>
              <div className="v2-stage-nav">
                {stageCards.map((item, index) => {
                  const locked = !unlockedStages.includes(item.key);
                  return (
                    <button
                      key={item.key}
                      className={`v2-stage-item ${currentStage === item.key ? 'active' : ''} ${locked ? 'locked' : ''}`}
                      onClick={() => selectStage(item.key)}
                      disabled={locked}
                    >
                      <div className="v2-stage-item-top">
                        <span className="v2-stage-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className={`v2-status-pill tone-${item.state.tone}`}>{item.state.label}</span>
                      </div>
                      <strong>{item.title}</strong>
                      <span>{item.hint}</span>
                      <small>{item.state.detail}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="v2-sidebar-section">
              <div className="v2-panel-head">
                <h3>素材与工作区</h3>
                <div className="v2-inline-actions">
                  <button className="v2-btn v2-btn-xs" onClick={importResources}>导入</button>
                  <button className="v2-btn v2-btn-xs" onClick={() => api.openNotebookWorkspaceRoot(selectedNotebookId)}>打开工作区</button>
                </div>
              </div>
              <p className="v2-workspace-path">{workspace?.rootPath || selectedNotebook?.workspacePath || '未初始化工作区'}</p>
              <div className="v2-resource-list">
                {resources.length ? resources.map((item) => (
                  <div key={item.id} className="v2-resource-item">
                    <strong>{item.title || item.fileName || '未命名素材'}</strong>
                    <span>{dt(item.updatedAt || item.createdAt)}</span>
                    <div className="v2-inline-actions">
                      <button className="v2-btn v2-btn-xs" onClick={() => api.openResource(item.storagePath)}>打开</button>
                      <button className="v2-btn v2-btn-xs" onClick={() => deleteResource(item.id)}>删除</button>
                    </div>
                  </div>
                )) : <p className="v2-hint">当前还没有素材。</p>}
              </div>
            </section>
          </aside>

          <main className="v2-main">
            <section className="v2-course-head">
              {/* ── 课程标题行：图标 + 名称 + Chips + 编辑按钮 ── */}
              <div className="v2-course-header-bar">
                <div className="v2-course-icon">
                  {(selectedNotebook?.name || '课')[0]}
                </div>
                <div className="v2-course-header-body">
                  <h2 className="v2-course-name">{selectedNotebook?.name || '未命名课程'}</h2>
                  <div className="v2-chip-row">
                    {selectedNotebook?.courseCode && (
                      <span className="v2-chip">📋 {selectedNotebook.courseCode}</span>
                    )}
                    {selectedNotebook?.totalHours > 0 && (
                      <span className="v2-chip">⏱ {selectedNotebook.totalHours} 学时</span>
                    )}
                    {selectedNotebook?.grade && (
                      <span className="v2-chip">👥 {selectedNotebook.grade}</span>
                    )}
                    {String(selectedNotebook?.softwareTools || '').split(/[,，、\n]+/).filter(Boolean).slice(0, 3).map((t, i) => (
                      <span key={`sw-${i}`} className="v2-chip v2-chip-tech">🖥 {t.trim()}</span>
                    ))}
                    {String(selectedNotebook?.jobTargets || '').split(/[,，、\n]+/).filter(Boolean).slice(0, 2).map((t, i) => (
                      <span key={`jt-${i}`} className="v2-chip v2-chip-job">💼 {t.trim()}</span>
                    ))}
                  </div>
                  {(selectedNotebook?.workspacePath || workspace?.rootPath) && (
                    <p className="v2-workspace-path">📁 {selectedNotebook?.workspacePath || workspace?.rootPath}</p>
                  )}
                </div>
                <button className="v2-btn v2-btn-xs" onClick={openEditCtx} title="编辑软件工具、目标岗位等信息">
                  ✏️ 编辑上下文
                </button>
              </div>

              {/* ── 四阶段流程进度条 ── */}
              <div className="v2-pipeline-wrap">
                <div className="v2-pipeline-label">课程开发进度</div>
                <div className="v2-pipeline">
                  {stageCards.map((card, idx) => {
                    const tone = card.state?.tone || 'neutral';
                    const stateKey = card.state?.key || 'locked';
                    const isLocked = stateKey === 'locked';
                    // 当前阶段且有正在运行的生成任务时，显示"生成中"状态
                    const isGenerating = busy && currentStage === card.key && busyKey.startsWith(card.key);
                    return (
                      <div
                        key={card.key}
                        className={`v2-pipeline-step v2-step-tone-${tone}${currentStage === card.key ? ' v2-step-current' : ''}${isLocked ? ' v2-step-locked' : ''}${isGenerating ? ' v2-step-generating' : ''}`}
                        onClick={() => !isLocked && selectStage(card.key)}
                        role={isLocked ? undefined : 'button'}
                      >
                        <div className="v2-step-header">
                          <div className={`v2-step-num v2-step-num-${tone}`}>
                            {isGenerating ? '⏳' : stateKey === 'completed' ? '✓' : `0${idx + 1}`}
                          </div>
                          <span className="v2-step-name">{card.title}</span>
                          {isGenerating
                            ? <span className="v2-step-badge v2-badge-generating">AI 生成中…</span>
                            : <span className={`v2-step-badge v2-badge-tone-${tone}`}>{card.state?.label || '未解锁'}</span>
                          }
                        </div>
                        <div className="v2-step-desc">
                          {isGenerating ? '正在调用 AI 生成，请稍候…' : (card.state?.detail || card.hint)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── 阻塞行动卡（仅当前阶段有阻断时显示） ── */}
              {currentStageCard?.state?.key === 'blocked' && (
                <div className="v2-block-alert">
                  <div className="v2-block-alert-icon">⚠️</div>
                  <div className="v2-block-alert-body">
                    <div className="v2-block-alert-title">当前阻塞：{currentStageCard.state.detail}</div>
                    <div className="v2-block-alert-desc">
                      请修复上方错误后继续，或使用 Agent 自动重新生成。
                    </div>
                    <div className="v2-block-alert-actions">
                      <button className="v2-btn-agent-danger" onClick={handleAgentRun} disabled={agentBusy || busy}>
                        {agentBusy ? '⏳ 运行中…' : '🤖 Agent 一键生成'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* ── 工作区双栏：运行时 + Agent 面板 ── */}
            <div className="v2-workspace-grid">
              {/* 左栏：阶段运行时 */}
              <section className="v2-runtime-summary">
                <div className="v2-panel-head">
                  <h3>阶段运行时</h3>
                  <span className="v2-hint">{STAGES.find((item) => item.key === currentStage)?.title || currentStage}</span>
                </div>
                <div className="v2-runtime-banner">
                  <div>
                    <span className="v2-runtime-eyebrow">后端契约对齐</span>
                    <strong>{currentStageCard?.state?.detail || '当前阶段可继续推进'}</strong>
                  </div>
                  <div className="v2-runtime-stats">
                    <div>
                      <b>{arr(currentRuntimeMeta.quality?.errors).length}</b>
                      <span>阻塞</span>
                    </div>
                    <div>
                      <b>{arr(currentRuntimeMeta.quality?.warnings).length}</b>
                      <span>提示</span>
                    </div>
                    <div>
                      <b>{arr(currentRuntimeMeta.operations).length}</b>
                      <span>操作</span>
                    </div>
                  </div>
                </div>
                <div className="v2-runtime-grid">
                  <div className="v2-runtime-card">
                    <strong>质量检查</strong>
                    <span>
                      {currentRuntimeMeta.quality?.valid === false
                        ? '存在阻断项'
                        : (currentRuntimeMeta.quality?.reviewNeeded ? '需复审' : '可继续')}
                    </span>
                    {arr(currentRuntimeMeta.quality?.errors).length ? (
                      <div className="v2-quality-block v2-quality-error">
                        <span className="v2-quality-label">❌ 阻断问题（必须修复后才能继续）</span>
                        <ul>
                          {arr(currentRuntimeMeta.quality?.errors).map((item, index) => (
                            <li key={`err-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {arr(currentRuntimeMeta.quality?.warnings).length ? (
                      <div className="v2-quality-block v2-quality-warn">
                        <span className="v2-quality-label">⚠ 建议改进</span>
                        <ul>
                          {arr(currentRuntimeMeta.quality?.warnings).map((item, index) => (
                            <li key={`warn-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (arr(currentRuntimeMeta.quality?.errors).length === 0
                        ? <p className="v2-hint">当前阶段没有额外提示。</p>
                        : null)}
                    {arr(currentRuntimeMeta.quality?.reviewReasons).length ? (
                      <div className="v2-note-box">
                        <strong>建议人工复核</strong>
                        <ul>
                          {arr(currentRuntimeMeta.quality?.reviewReasons).map((item, index) => <li key={`review-${index}`}>{item}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <div className="v2-runtime-card">
                    <div className="v2-runtime-card-head">
                      <strong>最近操作</strong>
                      <span>{arr(currentRuntimeMeta.operations).length ? '主进程回写' : '暂无'}</span>
                    </div>
                    {arr(currentRuntimeMeta.operations).length ? (
                      <div className="v2-runtime-ops">
                        {arr(currentRuntimeMeta.operations).slice(0, 5).map((item) => (
                          <div key={item.id} className="v2-runtime-op">
                            <b>{item.summary || item.action || '未命名操作'}</b>
                            <span>{`${item.status || '-'} · ${dt(item.updatedAt || item.createdAt)}`}</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="v2-hint">当前阶段还没有操作记录。</p>}
                  </div>
                  <div className="v2-runtime-card">
                    <div className="v2-runtime-card-head">
                      <strong>后端事件流</strong>
                      <span>{currentStageEvents.length ? '实时对齐' : '暂无'}</span>
                    </div>
                    {currentStageEvents.length ? (
                      <div className="v2-runtime-ops">
                        {currentStageEvents.map((item) => (
                          <div key={item.id || `${item.type}-${item.createdAt}`} className="v2-runtime-op">
                            <b>{formatEventLabel(item.type)}</b>
                            <span>{`${dt(item.createdAt)} · ${item.stage ? (STAGE_TITLE_MAP[item.stage] || item.stage) : '系统级'}`}</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="v2-hint">当前阶段还没有事件回写。</p>}
                  </div>
                </div>
              </section>

              {/* 右栏：Agent 智能生成面板 */}
              <div className="v2-agent-panel">
                <div className="v2-agent-panel-head">
                  <span className="v2-agent-panel-icon">🤖</span>
                  <div>
                    <div className="v2-agent-panel-title">Agent 智能生成</div>
                    <div className="v2-agent-panel-sub">自动完成框架 + 讲稿 + PPT 的全流程生成</div>
                  </div>
                </div>

                {/* 覆盖阶段 chips */}
                <div className="v2-agent-scope-row">
                  <span className="v2-chip v2-chip-agent">📐 教学框架</span>
                  <span className="v2-chip v2-chip-agent">📝 课程讲稿</span>
                  <span className="v2-chip v2-chip-agent">🖼️ PPT 规划</span>
                </div>

                {/* 运行按钮 */}
                <button
                  className="v2-btn-agent v2-btn-agent-full"
                  onClick={handleAgentRun}
                  disabled={agentBusy || busy}
                >
                  {agentBusy ? '⏳ 运行中，请稍候…' : '🚀 一键生成全部阶段'}
                </button>

                {/* 当前状态提示 */}
                {assistantStatus && (
                  <div className="v2-agent-status-row">
                    <span className="v2-agent-status-dot" />
                    <span className="v2-agent-status-text">{assistantStatus}</span>
                  </div>
                )}

                {/* Agent 执行日志 */}
                {agentLog && (
                  <div className="v2-agent-log-wrap">
                    <div className={`v2-agent-log-banner ${agentLog.status === 'success' ? 'ok' : agentLog.status === 'blocked' ? 'warn' : 'error'}`}>
                      <span className="v2-agent-log-status">
                        {agentLog.status === 'success' ? '✅ 成功' : agentLog.status === 'blocked' ? '⚠️ 阻塞' : '❌ 失败'}
                      </span>
                      <span className="v2-agent-log-summary">{agentLog.summary}</span>
                    </div>
                    <ol className="v2-agent-step-log">
                      {(agentLog.stepLog || []).map((step, i) => (
                        <li
                          key={i}
                          className={`v2-agent-step ${step.isBacktrack ? 'backtrack' : step.result === 'ok' ? 'ok' : step.result === 'error' ? 'error' : 'warn'}`}
                        >
                          {step.isBacktrack && <span>⤴ </span>}
                          <span className="v2-agent-step-action">{step.action}</span>
                          <span className="v2-agent-step-reason">{step.reason}</span>
                          {step.qualityScore != null && (
                            <span className="v2-agent-step-meta">Q{step.qualityScore}</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {!agentLog && !agentBusy && (
                  <p className="v2-hint v2-agent-hint">点击上方按钮，Agent 将自动规划并依次完成各个生成阶段。</p>
                )}
              </div>
            </div>

            {currentStage === 'framework' ? (
              <FrameworkStage
                assistantStatus={assistantStatus}
                requirementText={requirementText}
                setRequirementText={setRequirementText}
                busy={busy}
                busyKey={busyKey}
                frameworkRecord={frameworkRecord}
                handleGenerateFramework={handleGenerateFramework}
                saveFrameworkStage={saveFrameworkStage}
                handleConfirmFramework={handleConfirmFramework}
                handleExportFrameworkWord={handleExportFrameworkWord}
                editorData={editorData}
                updateCourseInfo={(field, value) => setEditorData((prev) => ({ ...prev, courseInfo: { ...prev.courseInfo, [field]: value } }))}
                updateObjective={(field, value) => setEditorData((prev) => ({ ...prev, objectives: { ...prev.objectives, [field]: splitLines(value) } }))}
                updateTeachingMethod={(field, value) => setEditorData((prev) => ({ ...prev, teachingMethods: { ...prev.teachingMethods, [field]: field === 'secondary' ? splitLines(value) : value } }))}
                updatePolitics={(field, value) => setEditorData((prev) => ({ ...prev, ideologicalElements: { ...prev.ideologicalElements, [field]: value } }))}
                addModule={() => setEditorData((prev) => ({ ...prev, modules: [...prev.modules, { id: `module-${Date.now()}`, moduleNumber: prev.modules.length + 1, name: '', hours: 0, description: '', knowledgePoints: [], teachingMethods: '', isCore: false, content: {} }] }))}
                removeModule={(index) => setEditorData((prev) => ({ ...prev, modules: prev.modules.filter((_, i) => i !== index) }))}
                updateModuleField={(index, field, value) => setEditorData((prev) => ({ ...prev, modules: prev.modules.map((item, i) => i === index ? { ...item, [field]: field === 'knowledgePoints' ? splitLines(value) : value } : item) }))}
                handleGenerateInfographic={handleGenerateInfographic}
                handleConfirmInfographic={handleConfirmInfographic}
                infographicBusyKey={infographicBusyKey}
                infographicLayout={infographicLayout}
                setInfographicLayout={setInfographicLayout}
                infographicStyle={infographicStyle}
                setInfographicStyle={setInfographicStyle}
                handleGenerateDiagram={handleGenerateDiagram}
                diagramBusy={diagramBusy}
                diagramResult={diagramResult}
                handleExportKnowledgeCards={handleExportKnowledgeCards}
                addSchedule={() => setEditorData((prev) => ({ ...prev, schedule: [...prev.schedule, { id: `schedule-${Date.now()}`, week: prev.schedule.length + 1, topic: '', hours: 2, methods: '', assignment: '' }] }))}
                removeSchedule={(index) => setEditorData((prev) => ({ ...prev, schedule: prev.schedule.filter((_, i) => i !== index) }))}
                updateSchedule={(index, patch) => setEditorData((prev) => ({ ...prev, schedule: prev.schedule.map((item, i) => i === index ? { ...item, ...patch } : item) }))}
                preview={frameworkPreview}
                rightTab={rightTab}
                setRightTab={setRightTab}
                rawJsonText={rawJsonText}
                setRawJsonText={setRawJsonText}
                rawJsonError={rawJsonError}
                handleSaveRawJson={handleSaveRawJson}
                buildFrameworkFromEditor={buildFrameworkFromEditor}
                notebook={selectedNotebook}
                frameworkVersions={frameworkVersions}
                selectedNotebookId={selectedNotebookId}
                api={api}
                loadFrameworkStage={loadNotebookContext}
                setAssistantStatus={setAssistantStatus}
                markdownBlocks={markdownBlocks}
                artifacts={frameworkArtifacts}
                dt={dt}
                toLocalImgSrc={toLocalImgSrc}
                arr={arr}
              />
            ) : null}

            {currentStage === 'lecture' ? (
              <LectureStage
                lectureState={lectureState}
                setLectureState={updateLectureStateFromUser}
                assistantStatus={assistantStatus}
                busy={busy}
                selectedDraftText={selectedDraftText}
                handleGenerateLectureDrafts={handleGenerateLectureDrafts}
                saveLectureStage={handleSaveLectureStage}
                handleGenerateFormalLecture={handleGenerateFormalLecture}
                handleConfirmLecture={handleConfirmLecture}
                handleExportLecture={handleExportLecture}
                artifacts={lectureArtifacts}
                dt={dt}
                api={api}
                shorten={shorten}
                lectureReview={lectureReview}
                referenceContext={referenceContext}
                onReferenceContextChange={setReferenceContext}
                onFetchRefUrl={handleFetchRefUrl}
                onDocxUpload={handleDocxUpload}
                refFetchBusy={refFetchBusy}
                courseName={selectedNotebook?.name || ''}
              />
            ) : null}

            {currentStage === 'ppt' ? (
              <PptStage
                pptState={pptState}
                setPptState={setPptState}
                assistantStatus={assistantStatus}
                busy={busy}
                currentTemplate={currentTemplate}
                currentPage={currentPptPage}
                currentVersions={pptVersions}
                handleGeneratePptOutline={handleGeneratePptOutline}
                handleGeneratePptPlan={handleGeneratePptPlan}
                savePptStage={savePptStage}
                handleConfirmPpt={handleConfirmPpt}
                handleExportPpt={handleExportPpt}
                handleGenerateCurrentPageCandidates={handleGenerateCurrentPageCandidates}
                handleRollbackPptVersion={handleRollbackPptVersion}
                handleGenerateCoverImage={handleGenerateCoverImage}
                coverImageBusy={coverImageBusy}
                coverConfirmed={coverConfirmed}
                styleAnchor={styleAnchor}
                handleConfirmCoverStyle={handleConfirmCoverStyle}
                handleBatchGenerateImages={handleBatchGenerateImages}
                batchProgress={batchProgress}
                artifacts={pptArtifacts}
                dt={dt}
                api={api}
                toLocalImgSrc={toLocalImgSrc}
                shorten={shorten}
                templates={PPT_TEMPLATE_PRESETS}
              />
            ) : null}

            {currentStage === 'video' ? (
              <VideoStage
                videoState={videoState}
                setVideoState={setVideoState}
                assistantStatus={assistantStatus}
                busy={busy}
                handleGenerateVideoPrompt={handleGenerateVideoPrompt}
                handleSaveVideoStage={saveVideoStage}
                handleCopyVideoPrompt={handleCopyVideoPrompt}
                handleOpenJimeng={handleOpenJimeng}
                handleOpenPexo={handleOpenPexo}
                handleCopyPexoInfo={handleCopyPexoInfo}
                artifacts={videoArtifacts}
                dt={dt}
                api={api}
              />
            ) : null}
          </main>
        </div>
      )}

      {showCreate ? (
        <div className="v2-modal-mask">
          <div className="v2-modal">
            <div className="v2-panel-head">
              <h3>新建笔记本</h3>
              <button className="v2-btn v2-btn-xs" onClick={() => setShowCreate(false)}>关闭</button>
            </div>
            <div className="v2-grid-two">
              <div><label className="v2-label">课程名称</label><input value={createForm.name} onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))} /></div>
              <div><label className="v2-label">课程代码</label><input value={createForm.courseCode} onChange={(e) => setCreateForm((prev) => ({ ...prev, courseCode: e.target.value }))} /></div>
              <div><label className="v2-label">授课对象</label><input value={createForm.grade} onChange={(e) => setCreateForm((prev) => ({ ...prev, grade: e.target.value }))} /></div>
              <div><label className="v2-label">先修课程</label><input value={createForm.prerequisite} onChange={(e) => setCreateForm((prev) => ({ ...prev, prerequisite: e.target.value }))} /></div>
              <div><label className="v2-label">总学时</label><input type="number" value={createForm.totalHours} onChange={(e) => setCreateForm((prev) => ({ ...prev, totalHours: Number(e.target.value) || 0 }))} /></div>
              <div><label className="v2-label">理论学时</label><input type="number" value={createForm.theoryHours} onChange={(e) => setCreateForm((prev) => ({ ...prev, theoryHours: Number(e.target.value) || 0 }))} /></div>
              <div><label className="v2-label">实践学时</label><input type="number" value={createForm.practiceHours} onChange={(e) => setCreateForm((prev) => ({ ...prev, practiceHours: Number(e.target.value) || 0 }))} /></div>
            </div>
            <label className="v2-label">课程描述</label>
            <textarea rows={3} value={createForm.description} onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="简要描述本课程的定位、内容范围和能力培养目标" />

            <div className="v2-section-divider">
              <span>课程特征（填写越详细，AI 生成质量越高）</span>
            </div>

            {/* AI 建议入口 */}
            <div className="v2-research-bar">
              <button
                className="v2-btn v2-btn-outline"
                onClick={generateResearch}
                disabled={researchBusy}
                title="根据课程名称和描述，AI 从知识库生成软件工具、岗位、课程标准等参考建议"
              >
                {researchBusy ? '⏳ AI 生成中…' : '✨ AI 帮我想（软件/岗位/课标建议）'}
              </button>
            </div>

            {/* AI 建议结果展示 */}
            {researchResult && (
              <div className="v2-research-panel">
                <div className="v2-research-panel-head">
                  <span>AI 建议（基于知识库）</span>
                  <button className="v2-btn v2-btn-xs" onClick={() => setResearchResult(null)}>关闭</button>
                </div>
                <div className="v2-research-items">
                  {researchResult.softwareTools?.primary && (
                    <div className="v2-research-item">
                      <span className="v2-research-label">推荐软件</span>
                      <span>{researchResult.softwareTools.primary}
                        {researchResult.softwareTools.secondary?.length > 0 && `；${researchResult.softwareTools.secondary.join('、')}`}
                      </span>
                    </div>
                  )}
                  {researchResult.jobTargets?.main?.length > 0 && (
                    <div className="v2-research-item">
                      <span className="v2-research-label">目标岗位</span>
                      <span>{researchResult.jobTargets.main.join('、')}</span>
                    </div>
                  )}
                  {researchResult.industryScenarios?.primary && (
                    <div className="v2-research-item">
                      <span className="v2-research-label">应用场景</span>
                      <span>{researchResult.industryScenarios.primary}</span>
                    </div>
                  )}
                  {researchResult.courseStandards?.national && (
                    <div className="v2-research-item">
                      <span className="v2-research-label">课程标准</span>
                      <span>{researchResult.courseStandards.national}</span>
                    </div>
                  )}
                  {researchResult.learnerProfile?.commonDifficulties && (
                    <div className="v2-research-item">
                      <span className="v2-research-label">常见困难</span>
                      <span>{researchResult.learnerProfile.commonDifficulties}</span>
                    </div>
                  )}
                </div>
                <button className="v2-btn v2-btn-primary v2-research-apply" onClick={applyResearchToForm}>
                  → 填入表单（可继续编辑）
                </button>
              </div>
            )}

            <div className="v2-grid-two">
              <div>
                <label className="v2-label">
                  使用的具体软件工具
                  <span className="v2-label-hint">填写后 AI 将直接使用软件真实名称，不再写"相关软件"</span>
                </label>
                <input
                  value={createForm.softwareTools}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, softwareTools: e.target.value }))}
                  placeholder="如：Blender 4.x、3ds Max 2024、Photoshop CC"
                />
              </div>
              <div>
                <label className="v2-label">
                  目标职业岗位
                  <span className="v2-label-hint">AI 将把案例和技能点与真实岗位任务挂钩</span>
                </label>
                <input
                  value={createForm.jobTargets}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, jobTargets: e.target.value }))}
                  placeholder="如：橱窗陈列师、店铺视觉设计师、陈列顾问"
                />
              </div>
              <div>
                <label className="v2-label">
                  行业应用场景
                  <span className="v2-label-hint">用于开场导入和课堂案例取材</span>
                </label>
                <input
                  value={createForm.industryScenarios}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, industryScenarios: e.target.value }))}
                  placeholder="如：服装零售品牌门店、商业展示空间、电商视觉设计"
                />
              </div>
              <div>
                <label className="v2-label">
                  参考教材 / 课程标准
                  <span className="v2-label-hint">AI 生成框架时优先对齐该标准</span>
                </label>
                <input
                  value={createForm.teachingMaterials}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, teachingMaterials: e.target.value }))}
                  placeholder="如：《服装陈列设计》（第2版）、中职服装设计课程标准2022"
                />
              </div>
            </div>

            <label className="v2-label">
              学情说明
              <span className="v2-label-hint">描述学生已有基础，影响讲稿难度和举例方式</span>
            </label>
            <textarea
              rows={2}
              value={createForm.learnerProfile}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, learnerProfile: e.target.value }))}
              placeholder="如：二年级学生，已学过美术基础和设计构成，无3D软件经验，动手能力强但空间想象力较弱"
            />

            <div className="v2-inline-actions">
              <button className="v2-btn v2-btn-primary" onClick={createNotebook}>创建</button>
            </div>
          </div>
        </div>
      ) : null}

      {showEditCtx ? (
        <div className="v2-modal-mask">
          <div className="v2-modal">
            <div className="v2-panel-head">
              <h3>编辑课程上下文</h3>
              <button className="v2-btn v2-btn-xs" onClick={() => setShowEditCtx(false)}>关闭</button>
            </div>
            <div className="v2-status-box">
              <span>说明</span>
              <strong>这些字段会让 AI 在生成框架、讲稿、信息图时使用真实的软件名和岗位名，而不是泛指表达。</strong>
            </div>

            <label className="v2-label">
              使用的具体软件工具
              <span className="v2-label-hint">填写后 AI 将直接使用软件真实名称，不再写"相关软件"</span>
            </label>
            <input
              value={editCtxForm.softwareTools || ''}
              onChange={(e) => setEditCtxForm((prev) => ({ ...prev, softwareTools: e.target.value }))}
              placeholder="如：Blender 4.x、3ds Max 2024、Photoshop CC"
            />

            <label className="v2-label">
              目标职业岗位
              <span className="v2-label-hint">AI 将把案例和技能点与真实岗位任务挂钩</span>
            </label>
            <input
              value={editCtxForm.jobTargets || ''}
              onChange={(e) => setEditCtxForm((prev) => ({ ...prev, jobTargets: e.target.value }))}
              placeholder="如：橱窗陈列师、店铺视觉设计师、陈列顾问"
            />

            <label className="v2-label">
              行业应用场景
              <span className="v2-label-hint">用于开场导入和课堂案例教材</span>
            </label>
            <input
              value={editCtxForm.industryScenarios || ''}
              onChange={(e) => setEditCtxForm((prev) => ({ ...prev, industryScenarios: e.target.value }))}
              placeholder="如：服装零售品牌门店、商业展示空间、电商视觉设计"
            />

            <label className="v2-label">
              参考教材 / 课程标准
              <span className="v2-label-hint">AI 生成框架时优先对齐课标</span>
            </label>
            <input
              value={editCtxForm.teachingMaterials || ''}
              onChange={(e) => setEditCtxForm((prev) => ({ ...prev, teachingMaterials: e.target.value }))}
              placeholder="如：《服装陈列设计》（第2版）、中职服装设计课程标准2022"
            />

            <label className="v2-label">
              学情说明
              <span className="v2-label-hint">描述学生已有基础，影响讲稿难度和举例方式</span>
            </label>
            <textarea
              rows={2}
              value={editCtxForm.learnerProfile || ''}
              onChange={(e) => setEditCtxForm((prev) => ({ ...prev, learnerProfile: e.target.value }))}
              placeholder="如：二年级学生，已学过美术基础和设计构成，无3D软件经验，动手能力强但空间想象力较弱"
            />

            <div className="v2-inline-actions">
              <button className="v2-btn v2-btn-primary" onClick={saveEditCtx}>保存上下文</button>
              <button className="v2-btn v2-btn-secondary" onClick={() => setShowEditCtx(false)}>取消</button>
            </div>
          </div>
        </div>
      ) : null}

      {showApi ? (
        <div className="v2-modal-mask">
          <div className="v2-modal">
            <div className="v2-panel-head">
              <h3>API 配置</h3>
              <button className="v2-btn v2-btn-xs" onClick={() => setShowApi(false)}>关闭</button>
            </div>
            <div className="v2-status-box">
              <span>填写说明</span>
              <strong>API Key 用于身份鉴权，3 个 Endpoint 分别决定文本生成、图片生成、视频生成调用到哪个模型端点。</strong>
            </div>
            <label className="v2-label">1. API Key</label>
            <p className="v2-field-note">老师只需要填写平台分配的密钥。系统会在调用文本、图片、视频能力时统一使用这个 Key 做鉴权。</p>
            <input
              value={apiForm.ark}
              placeholder="例如：sk-... 或平台分配的 API Key"
              onChange={(e) => setApiForm((prev) => ({ ...prev, ark: e.target.value }))}
            />
            <label className="v2-label">2. 文本类 Endpoint</label>
            <p className="v2-field-note">用于教学框架、讲稿、PPT 文案、信息图文案等文本生成任务。一般填写 `ep-...` 形式的文本模型端点。</p>
            <input
              value={apiForm.arkTextEndpoint}
              placeholder="例如：ep-xxxxxxxx-text"
              onChange={(e) => setApiForm((prev) => ({ ...prev, arkTextEndpoint: e.target.value }))}
            />
            <label className="v2-label">3. 图片生成 Endpoint</label>
            <p className="v2-field-note">用于信息图、PPT 配图候选图等图片生成任务。一般填写支持图像生成的 `ep-...` 端点。</p>
            <input
              value={apiForm.arkImageEndpoint}
              placeholder="例如：ep-xxxxxxxx-image"
              onChange={(e) => setApiForm((prev) => ({ ...prev, arkImageEndpoint: e.target.value }))}
            />
            <label className="v2-label">4. 视频类 Endpoint</label>
            <p className="v2-field-note">用于视频生成或视频桥接相关能力。一般填写支持视频任务的 `ep-...` 端点。</p>
            <input
              value={apiForm.arkVideoEndpoint}
              placeholder="例如：ep-xxxxxxxx-video"
              onChange={(e) => setApiForm((prev) => ({ ...prev, arkVideoEndpoint: e.target.value }))}
            />
            <div className="v2-inline-actions">
              <button className="v2-btn v2-btn-primary" onClick={saveApiFormAction}>保存设置</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
