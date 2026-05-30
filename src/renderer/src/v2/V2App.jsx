import React, { useEffect, useMemo, useRef, useState } from 'react';
// v4.3.3 新版 · 应用 logo（绿底金马·驭字）— 由 scripts/icon/rebuild-icons.js 生成
import logoSrc from '../assets/logo.png';
// v4.3.3 功能4（老师反馈）· 阶段卡卡通老师助手（刘/吕/周）
import { StageAssistant, stageAssistantAvatar, stageAssistantTeacher } from './StageAssistant';
// P1.1d 删除（2026-05-17）：FrameworkStage / WorkflowPauseModal 整 v3 framework + Agent 自动模式下线
// import FrameworkStage from './FrameworkStage';   // 已删
// import WorkflowPauseModal from './WorkflowPauseModal';  // 已删
import LectureStage from './LectureStage';
import PptStage from './PptStage';
import VideoStage from './VideoStage';            // legacy
// v4.3.3 七阶段工作流
import ScheduleStage from './ScheduleStage';
import DesignStage from './DesignStage';
import MicroVideoStage from './MicroVideoStage';
import ReportStage from './ReportStage';
// v4.3.3 八阶段：在线测验 + 课后作业
import QuizStage from './QuizStage';
import HomeworkStage from './HomeworkStage';
import MyWorkbench from './MyWorkbench';                 // 教师日志
import { SessionProvider } from './SessionContext';      // 2026-05-16 v4.2.0 Phase A
import SessionBreadcrumb from './SessionBreadcrumb';     // 2026-05-16 v4.2.0 Phase A
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

// Phase-9（驭课 Agent v4.0.0）：新建教学进度表表单——按广州纺校真实样例字段
//   旧字段（课程代码 / 理论学时 / 实践学时 / 先修课程）已移除：
//   - 学时拆分由 schedule.service 默认（理论 32 + 实训 36 + 考核 4 = 72）
//   - 课程代码不影响任何阶段
//   - 先修课程并入"课程描述"
const NOTEBOOK_FORM = {
  name: '',
  // 教学进度表 header 必填项（与 prompts/schedule.md 严格对齐）
  teacher: '',
  // P6 修复（2026-05-18）：删硬编码默认值（H14 反编造铁律）—— 老师自填，AI 不再用模板锚定
  school: '',
  department: '',
  semester: '',
  className: '',
  textbook: '',
  totalHours: '',                  // P2（2026-05-17）：删硬编码 72，AI 从老师上传素材识别 → 老师可校对
  // 2026-05-15 v4.1.4：每次课学时数（必填，无默认）—— 老师可自定义
  hoursPerSession: '',
  // P2（2026-05-17）：每学时分钟数（老师按学校标准填，必填，无默认）
  minutesPerHour: '',
  description: '',
  // 富上下文字段（用于提升 AI 生成质量，跨 6 阶段共用）
  softwareTools: '',
  jobTargets: '',
  industryScenarios: '',
  learnerProfile: '',
};

const API_FORM = {
  ark: '',
  arkTextEndpoint: '',
  arkLectureFormalEndpoint: '',  // B6：正式稿专用 endpoint（可选）
  arkImageEndpoint: '',
  arkVideoEndpoint: '',
  // v4.3.3 功能5+：声音复刻（周老师真声朗读）
  voiceCloneApiKey: '',
  voiceCloneSpeakerId: ''
};

// P1.1d 删除（2026-05-17）：Agent 自动模式整套已下线，ENABLE_AGENT_UI 永久 false
// 所有 ENABLE_AGENT_UI 包住的 Block 会被 dead code 消除
const ENABLE_AGENT_UI = false;

// Phase-9（2026-05-09）：6 阶段工作流（驭课 Agent v4.0.0）
//   schedule → design → lecture → ppt → video（micro-video 整套方案）→ report
//   旧 framework 阶段已移除（数据全清，不做迁移）
// 2026-05-16 v4.2.0 Phase A'：调换 lecture / ppt 顺序，对齐老师真实工作流
//   讲稿是根据 PPT 来讲的 → 必须先有 PPT 再写讲稿
const STAGES = [
  { key: 'schedule', title: '教学进度表', hint: '按周排课、章节、实训类目' },
  { key: 'design',   title: '教学设计',   hint: '整门课级别 5 段教学法 + 考核权重' },
  { key: 'ppt',      title: '教学课件',   hint: '基于教学设计的页级框架 + 配图 + 导出' },
  { key: 'lecture',  title: '课堂讲稿',   hint: '基于 PPT 逐页的教师口播稿' },
  // v4.3.3 八阶段：新增 quiz / homework
  { key: 'quiz',     title: '在线测验',   hint: 'AI 基于每页 PPT + 讲稿出题（每页 1-2 题 + 综合题）' },
  { key: 'homework', title: '课后作业',   hint: 'AI 基于讲稿出 3-5 道作业（每学时 30-60 分钟练习量）' },
  { key: 'video',    title: '微课视频',   hint: '脚本+分镜+即梦提示词+拍摄+剪辑' },
  { key: 'report',   title: '教学实施报告', hint: 'AI 自动汇总 + 老师手填实施成效' }
];

const STAGE_TITLE_MAP = Object.fromEntries(STAGES.map((item) => [item.key, item.title]));
const STAGE_PRIMARY_ARTIFACTS = {
  schedule: ['schedule_table'],
  design:   ['design_doc'],
  lecture:  ['lecture_final'],
  ppt:      ['ppt_outline'],
  quiz:     ['quiz_set'],          // v4.3.3
  homework: ['homework_set'],      // v4.3.3
  video:    ['video_prompt'],
  report:   ['implementation_report']
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
  // v4.3.3 Bug3 修复（老师测试 2026-05-30）：
  //   "已完成"直接看本阶段是否有已确认的主产物（confirmedCount>0），
  //   不再用"下游是否解锁"反推——后者在状态滞后/确认后又改回草稿时会把未确认阶段误显示为"已完成"。
  const completed = confirmedCount > 0;

  if (locked) {
    // v4.3.3 Bug2 修复（老师反馈 · 2026-05-29）：
    //   实施报告需前 7 个阶段全部 confirmed 才解锁。老师反馈"微课确认了报告仍不解锁"，
    //   根因是教学课件/课堂讲稿处于"可继续·有改进建议"状态未点确认。
    //   这里在 report 卡 locked 时，明确列出还差哪几个阶段确认（不再笼统"等待上一步"）。
    if (stage === 'report') {
      const upstreamOrder = ['schedule', 'design', 'ppt', 'lecture', 'quiz', 'homework', 'video'];
      const upstreamTitle = {
        schedule: '教学进度表', design: '教学设计', ppt: '教学课件', lecture: '课堂讲稿',
        quiz: '在线测验', homework: '课后作业', video: '微课视频',
      };
      const missing = upstreamOrder.filter((s) => {
        const types = STAGE_PRIMARY_ARTIFACTS[s] || [];
        return !safeArtifacts.some((a) => types.includes(a.type) && artifactIsConfirmed(a));
      }).map((s) => upstreamTitle[s]);
      if (missing.length > 0) {
        return { key: 'locked', label: '未解锁', tone: 'neutral', detail: `还需确认：${missing.join('、')}` };
      }
    }
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
      // 2026-05-16 v4.1.4 老师反馈："已确认仍显示需复审"
      //   reviewNeeded 是软提示（字数 / 章节 / 推进词密度），不阻断"完成本阶段"。
      //   把硬感的"需复审"改成"可继续·有改进建议"，避免老师误以为还不能下一步。
      label: '可继续·有改进建议',
      tone: 'warning',
      detail: arr(quality.reviewReasons)[0] || arr(quality.warnings)[0] || '内容已可用，仍有可优化的细节'
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
        {/* v4.3.3 新版 · 启动屏 hero logo */}
        <img src={logoSrc} alt="驭课 Agent" className="v2-home-logo" draggable={false} />
        <h2>驭课 Agent · 8 阶段工作流</h2>
        <p>从教学进度表起步，依次完成 教学进度表 → 教学设计 → 教学课件 → 课堂讲稿 → 在线测验 → 课后作业 → 微课视频 → 教学实施报告（v4.3.3 新工作流）。</p>
        <div className="v2-inline-actions">
          <button className="v2-btn v2-btn-primary" onClick={onCreateClick}>新建教学进度表</button>
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
  // Phase-9：默认起点从 'framework' 改为 'schedule'
  const [workflowState, setWorkflowState] = useState({ currentStage: 'schedule', unlockedStages: ['schedule'] });
  // v4.3.3 功能4：当前弹出的阶段助手（null = 不弹）
  const [assistantStage, setAssistantStage] = useState(null);
  const [resources, setResources] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(NOTEBOOK_FORM);
  const [showEditCtx, setShowEditCtx] = useState(false);     // 编辑现有笔记本富上下文
  const [editCtxForm, setEditCtxForm] = useState({});        // 正在编辑的笔记本上下文字段
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchResult, setResearchResult] = useState(null);
  // P1.1d（2026-05-17）：Agent 自动模式已废，state 仅保留 stub 让 dead UI 引用不崩；ENABLE_AGENT_UI=false 永不渲染
  const [agentBusy] = useState(false);
  const [agentLog] = useState(null);
  const [agentPauseState] = useState(null);
  const handleAgentRun = () => {};
  const handleAgentResume = () => {};
  const handleAgentDismissPause = () => {};
  const [referenceContext, setReferenceContext] = useState(''); // Phase-5C: 参考资料注入
  const [refFetchBusy, setRefFetchBusy] = useState(false);     // Phase-5C: URL 读取中
  const [refFetchErrors, setRefFetchErrors] = useState([]);    // Phase-8 M0+: 失败 URL 列表化展示
                                                                // 每项 { url, message, kind: 'timeout'|'login_wall'|'render_error'|'content_too_short' }
  const [showApi, setShowApi] = useState(false);
  const [showWorkbench, setShowWorkbench] = useState(false);  // A3：教师日志显示开关
  // v4.3.3 Codex Round 4 #1：单一来源契约（IPC 拉 contracts.js 内容）
  const [stageContracts, setStageContracts] = useState(null);
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
  // Phase-8.5：模块信息图默认走 magazine_module 杂志风格（前端 UI 已删除选择器，仅保留 state 兼容旧调用）
  const [infographicLayout, setInfographicLayout] = useState('magazine_module');
  const [infographicStyle, setInfographicStyle] = useState('magazine_module');
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
  const [pptState, setPptState] = useState({
    templateKey: 'pro_minimalist',
    pptOutline: '',
    pptPages: [],
    selectedPageId: '',
    // 2026-05-15 v4.1.4：外部参考素材（老师可上传 PPT 截图/参考文档影响生成风格 + 内容）
    externalReferences: [],   // [{ kind: 'text'|'file', filename?, content }]
    // 2026-05-16 v4.1.4 Phase 2：AI 推断的整门课主色，逐页 accentColor 为空时回落到此
    mainAccentColor: '',
    notebookId: null,         // 透传给 regeneratePptPageV2 用
    // 2026-05-16 v4.1.4 真 P2：PPT 按节课模式
    targetLessonId: null,     // 老师在 PPT 顶部选的目标节课 id（v4.1.x 兼容）
    targetDesignId: null,     // v4.2.0：design-first 流程目标 design id
    lessonContext: null,      // { lessonId, lessonNumber, topic, chapter, theoryHours, practiceHours, totalHours }
    confirmedLessons: [],     // [{ lessonId, lessonNumber, topic, totalHours }] 供 v4.1.x 选择器渲染
    confirmedDesigns: [],     // v4.2.0：[{ designId, lessonNumber, topic, totalHours }] 供 design-first 选择器
    // 2026-05-16 v4.1.4 Q2-②：配图质量等级（low / medium / high）—— 默认 medium
    imageQuality: 'medium',
  });
  const pptStateRef = useRef(pptState);
  pptStateRef.current = pptState;
  const [pptArtifacts, setPptArtifacts] = useState([]);
  const [pptVersions, setPptVersions] = useState([]);
  const [videoState, setVideoState] = useState({ promptText: '', style: '专业稳重', engine: 'jimeng' });  // legacy
  const [videoArtifacts, setVideoArtifacts] = useState([]);
  const [backendEvents, setBackendEvents] = useState([]);

  // Phase-9（驭课 Agent v4.0.0）：6 阶段工作流的 4 个新阶段 state
  const [scheduleState, setScheduleState] = useState({
    school: '', totalHours: 0, textbook: '',          // P2：删硬编码 72 / 广州纺校
    schedule: null, jsonText: '', artifactId: null, confirmed: false,
  });
  const [scheduleArtifacts, setScheduleArtifacts] = useState([]);

  const [designState, setDesignState] = useState({
    design: null, jsonText: '', artifactId: null, confirmed: false,
    // Phase-9.5：本节信息表单（生成前由老师填，生成后从 design.lessonMeta 反向同步）
    lessonForm: { lessonNumber: 1, topic: '', chapter: '', weekRange: '', theoryHours: 2, practiceHours: 2 },
  });
  const [designArtifacts, setDesignArtifacts] = useState([]);
  // Phase-9.5：所有节课设计列表 + 累计学时
  const [designLessons, setDesignLessons] = useState([]);
  const [designAccumulatedHours, setDesignAccumulatedHours] = useState(0);       // 已确认
  const [designDesignedHours, setDesignDesignedHours] = useState(0);              // 已设计（v4.1.4 加）

  const [microVideoState, setMicroVideoState] = useState({
    videoTopic: '', style: '写实教学风',
    microVideo: null, jsonText: '', artifactId: null, confirmed: false,
  });

  const [reportState, setReportState] = useState({
    report: null, artifactId: null, confirmed: false,
  });
  const [reportArtifacts, setReportArtifacts] = useState([]);
  // v4.3.3 Codex Round 7 #3：quiz/homework artifact 真聚合（不再空数组占位）
  const [quizArtifacts, setQuizArtifacts] = useState([]);
  const [homeworkArtifacts, setHomeworkArtifacts] = useState([]);

  const [stageRuntimeMeta, setStageRuntimeMeta] = useState({
    framework: { quality: null, operations: [] },  // legacy
    schedule: { quality: null, operations: [] },
    design: { quality: null, operations: [] },
    lecture: { quality: null, operations: [] },
    ppt: { quality: null, operations: [] },
    video: { quality: null, operations: [] },
    report: { quality: null, operations: [] }
  });
  const notebookLoadSeqRef = useRef(0);
  const lectureEditRef = useRef({ notebookId: null, editedAt: 0 });
  // Phase-9：老笔记本（v3.x）的 currentStage 可能是 'framework'，新流程已没有这个阶段——静默矫正为 'schedule'
  const rawCurrentStage = workflowState?.currentStage || selectedNotebook?.currentStage || 'schedule';
  // v4.3.3 Codex Round 5 #1 高风险修复（2026-05-18）：
  //   旧 STAGE_KEYS_V4 是 6 阶段，会把 quiz/homework 阶段从 unlockedStages 过滤掉
  //   现在主权 → stageContracts.STAGE_ORDER（IPC 拉的 8 阶段），fallback 也用 8 阶段
  const STAGE_KEYS_V4 = stageContracts?.STAGE_ORDER
    || ['schedule', 'design', 'ppt', 'lecture', 'quiz', 'homework', 'video', 'report'];
  const currentStage = STAGE_KEYS_V4.includes(rawCurrentStage) ? rawCurrentStage : 'schedule';
  const rawUnlockedStages = arr(workflowState?.unlockedStages);
  const unlockedStages = rawUnlockedStages.length
    ? rawUnlockedStages.map((s) => s === 'framework' ? 'schedule' : s).filter((s) => STAGE_KEYS_V4.includes(s))
    : ['schedule'];
  const busy = Boolean(busyKey);
  const currentRuntimeMeta = stageRuntimeMeta[currentStage] || { quality: null, operations: [] };
  // v4.3.3 Codex Round 7 #3：8 阶段真聚合（quiz/homework 不再空数组占位）
  //   每个 stage 都从对应 state 拉真 artifact 列表，让 confirmedCount / stageCards 准确
  const stageArtifacts = useMemo(() => ({
    framework: frameworkArtifacts,       // legacy 兼容
    schedule: scheduleArtifacts,
    design: designArtifacts,
    ppt: pptArtifacts,
    lecture: lectureArtifacts,
    quiz: quizArtifacts,                 // v4.3.3 Round 7：真 quiz_set artifact 列表
    homework: homeworkArtifacts,         // v4.3.3 Round 7：真 homework_set artifact 列表
    video: videoArtifacts,
    report: reportArtifacts,
  }), [frameworkArtifacts, scheduleArtifacts, designArtifacts, pptArtifacts, lectureArtifacts, quizArtifacts, homeworkArtifacts, videoArtifacts, reportArtifacts]);
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
    // B6：增加 ark_endpoint_lecture_formal（正式稿专用）字段加载
    const [arkRes, textRes, imageRes, imageFallbackRes, videoRes, lectureFormalRes, voiceKeyRes, voiceSpeakerRes] = await Promise.all([
      api.getApiKey('ark'),
      api.getApiKey('ark_endpoint_text'),
      api.getApiKey('ark_endpoint_image'),
      api.getApiKey('ark_endpoint'),
      api.getApiKey('ark_endpoint_video_t2v'),
      api.getApiKey('ark_endpoint_lecture_formal'),
      // v4.3.3 功能5+：声音复刻凭证
      api.getApiKey('voice_clone_api_key'),
      api.getApiKey('voice_clone_speaker_id'),
    ]);
    setApiForm({
      ark: arkRes?.success ? String(arkRes.data || '') : '',
      arkTextEndpoint: textRes?.success ? String(textRes.data || '') : '',
      arkImageEndpoint: imageRes?.success
        ? String(imageRes.data || imageFallbackRes?.data || '')
        : String(imageFallbackRes?.data || ''),
      arkVideoEndpoint: videoRes?.success ? String(videoRes.data || '') : '',
      arkLectureFormalEndpoint: lectureFormalRes?.success ? String(lectureFormalRes.data || '') : '',
      voiceCloneApiKey: voiceKeyRes?.success ? String(voiceKeyRes.data || '') : '',
      voiceCloneSpeakerId: voiceSpeakerRes?.success ? String(voiceSpeakerRes.data || '') : '',
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
      Promise.resolve({ success: false, data: { frameworkRecord: null, modules: [], schedule: [] } }),  // P1.1d：getFrameworkStageDataV2 已下线
      api.getLectureStageDataV2(notebookId),
      api.getPptStageDataV2(notebookId),
      api.getVideoStageDataV2(notebookId),  // legacy
      // Phase-9 4 个新阶段
      api.getScheduleDataV2 ? api.getScheduleDataV2(notebookId) : Promise.resolve({ success: false }),
      api.getDesignDataV2 ? api.getDesignDataV2(notebookId) : Promise.resolve({ success: false }),
      api.getMicroVideoDataV2 ? api.getMicroVideoDataV2(notebookId) : Promise.resolve({ success: false }),
      api.getReportDataV2 ? api.getReportDataV2(notebookId) : Promise.resolve({ success: false }),
    ]);
    if (loadSeq !== notebookLoadSeqRef.current) return;
    const [notebookRes, workflowRes, resourceRes, eventsRes, frameworkRes, lectureRes, pptRes, videoRes,
      scheduleRes, designRes, microVideoRes, reportRes] = responses;
    if (!notebookRes?.success) {
      window.alert(`加载笔记本失败：${notebookRes?.error || '未知错误'}`);
      return;
    }
    const notebook = notebookRes.data;
    setSelectedNotebook(notebook);
    setWorkflowState(
      workflowRes?.success
        ? workflowRes.data
        : { currentStage: notebook.currentStage || 'schedule', unlockedStages: ['schedule'] }
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
      setPptState((prev) => ({
        ...prev,
        notebookId: selectedNotebookId,   // P6（2026-05-18）：必传，否则 PptStage 内的 IPC 调用拿 null 报"没有 design"
        templateKey,
        pptOutline: data.pptData?.pptOutline || '',
        pptPages: normalizedPages,
        selectedPageId: validSelectedId,
      }));
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

    // v4.3.3 Codex Round 9 #3：quiz/homework IPC 完整降级（含 api 函数不存在分支）
    //   3 个分支全部清空 artifacts + warn：
    //   (a) api 函数不存在  →  preload 没注入（dev 没重启 / 老版本 .exe）→ 清空 + warn
    //   (b) IPC success=false →  后端返回失败 → 清空 + warn
    //   (c) IPC 抛错       →  通信异常 → 清空 + warn
    //   避免任何降级路径留旧数据
    if (typeof api.quizListV2 === 'function') {
      try {
        const quizRes = await api.quizListV2(notebookId);
        if (quizRes?.success) {
          setQuizArtifacts(arr(quizRes.data?.quizzes || quizRes.data));
        } else {
          console.warn(`[loadNotebookContext] quizListV2 返回失败:`, quizRes?.error || quizRes);
          setQuizArtifacts([]);
        }
      } catch (e) {
        console.warn(`[loadNotebookContext] quizListV2 异常:`, e?.message || e);
        setQuizArtifacts([]);
      }
    } else {
      console.warn('[loadNotebookContext] api.quizListV2 未注入（preload 旧版本或 dev 未重启）→ quiz artifacts 清空');
      setQuizArtifacts([]);
    }
    if (typeof api.homeworkListV2 === 'function') {
      try {
        const hwRes = await api.homeworkListV2(notebookId);
        if (hwRes?.success) {
          setHomeworkArtifacts(arr(hwRes.data?.homeworks || hwRes.data));
        } else {
          console.warn(`[loadNotebookContext] homeworkListV2 返回失败:`, hwRes?.error || hwRes);
          setHomeworkArtifacts([]);
        }
      } catch (e) {
        console.warn(`[loadNotebookContext] homeworkListV2 异常:`, e?.message || e);
        setHomeworkArtifacts([]);
      }
    } else {
      console.warn('[loadNotebookContext] api.homeworkListV2 未注入（preload 旧版本或 dev 未重启）→ homework artifacts 清空');
      setHomeworkArtifacts([]);
    }

    // Phase-9：4 个新阶段的数据回填（驭课 Agent v4.0.0）
    if (scheduleRes?.success) {
      const d = scheduleRes.data || {};
      const loadedSchedule = d.schedule || null;
      const loadedHeader = loadedSchedule?.header || {};
      // 2026-05-15 v4.1.2：input 字段从 schedule.header 或 notebook prefill，避免老师看不到当前值
      //   优先级：已存在 schedule 的 header > notebook 上的字段 > 老默认值
      const notebookForPrefill = selectedNotebookId ? notebooks.find((n) => n.id === selectedNotebookId) : null;
      setScheduleState((prev) => ({
        ...prev,
        schedule: loadedSchedule,
        jsonText: loadedSchedule ? JSON.stringify(loadedSchedule, null, 2) : '',
        artifactId: d.artifactId || null,
        confirmed: !!d.confirmed,
        // 三层 fallback prefill
        school: loadedHeader.school || notebookForPrefill?.school || prev.school || '',         // P2
        totalHours: loadedHeader.totalHours || notebookForPrefill?.totalHours || prev.totalHours || 0,  // P2
        textbook: loadedHeader.textbook || notebookForPrefill?.textbook || prev.textbook || '',
      }));
      // 拉取 schedule 相关 artifact 列表（含导出的 Word 文件）
      try {
        const listRes = await api.listArtifacts({ notebookId, stage: 'schedule' });
        if (listRes?.success) setScheduleArtifacts(arr(listRes.data));
      } catch (_) { /* ignore */ }
    }
    if (designRes?.success) {
      const d = designRes.data || {};
      setDesignState((prev) => ({
        ...prev,
        design: d.design || null,
        jsonText: d.design ? JSON.stringify(d.design, null, 2) : '',
        artifactId: d.artifactId || null,
        confirmed: !!d.confirmed,
        // 反向同步 lessonForm（如有）
        lessonForm: d.design?.lessonMeta || prev.lessonForm,
      }));
      try {
        const listRes = await api.listArtifacts({ notebookId, stage: 'design' });
        if (listRes?.success) setDesignArtifacts(arr(listRes.data));
      } catch (_) { /* ignore */ }
      // Phase-9.5：拉所有节课设计 + 累计学时
      try {
        const lessonsRes = await api.listDesignLessonsV2?.(notebookId);
        if (lessonsRes?.success) {
          setDesignLessons(arr(lessonsRes.data?.lessons));
          setDesignAccumulatedHours(Number(lessonsRes.data?.totalAccumulatedHours) || 0);
        setDesignDesignedHours(Number(lessonsRes.data?.totalDesignedHours) || 0);
        }
      } catch (_) { /* ignore */ }
    }
    if (microVideoRes?.success) {
      const d = microVideoRes.data || {};
      setMicroVideoState((prev) => ({
        ...prev,
        microVideo: d.microVideo || null,
        jsonText: d.microVideo ? JSON.stringify(d.microVideo, null, 2) : '',
        artifactId: d.artifactId || null,
        confirmed: !!d.confirmed,
        videoTopic: d.microVideo?.videoTopic || prev.videoTopic,
      }));
    }
    if (reportRes?.success) {
      const d = reportRes.data || {};
      setReportState({
        report: d.report || null,
        artifactId: d.artifactId || null,
        confirmed: !!d.confirmed,
      });
    }
    // 切换笔记本时强制刷新状态栏，清除上一个笔记本的瞬态状态
    setAssistantStatus(`已加载《${notebook.name || '课程'}》，当前位于 ${STAGE_TITLE_MAP[workflowRes?.data?.currentStage || notebook.currentStage || 'schedule'] || '教学进度表'} 阶段。`);
    setLectureReview(null);
    setResearchResult(null);
    setResearchBusy(false);
    // P1.1d 删除：setAgentLog 已下线（Agent 模式废弃）
    setReferenceContext(''); // 清除上一个课程的参考资料
    // P1.1d 删除（2026-05-17）：Agent 暂停状态加载已下线
  };

  useEffect(() => {
    if (!isDesktop) return;
    loadNotebookList();
    loadApiForm();
    // v4.3.3 Codex Round 4 #1：mount 时拉契约常量，让 STAGE_ORDER/PRIMARY_TYPE/TITLE 来自后端
    if (typeof api.getStageContractsV2 === 'function') {
      api.getStageContractsV2().then((res) => {
        if (res?.success) setStageContracts(res.data);
      }).catch((e) => console.warn('[stageContracts] 拉取失败，用本地 fallback:', e));
    }
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

  // 2026-05-16 v4.2.0 Phase A'-8：进入 PPT 阶段时优先加载已确认 design 列表（design-first 流程）
  //   v4.1.x 兼容：同时加载已确认 lecture 列表（lecture-fallback 流程）
  useEffect(() => {
    if (!selectedNotebookId) return;
    if (currentStage !== 'ppt') return;

    const loaders = [];
    if (typeof api.listConfirmedDesignsV2 === 'function') {
      loaders.push(
        api.listConfirmedDesignsV2(selectedNotebookId)
          .then((res) => res?.success ? arr(res.data?.designs) : [])
          .catch(() => [])
      );
    } else {
      loaders.push(Promise.resolve([]));
    }
    if (typeof api.listConfirmedLessonsV2 === 'function') {
      loaders.push(
        api.listConfirmedLessonsV2(selectedNotebookId)
          .then((res) => res?.success ? arr(res.data?.lessons) : [])
          .catch(() => [])
      );
    } else {
      loaders.push(Promise.resolve([]));
    }

    Promise.all(loaders).then(([designs, lessons]) => {
      setPptState((prev) => ({
        ...prev,
        confirmedDesigns: designs,
        confirmedLessons: lessons,
        // 自动选最近一个 design 作默认（design-first 优先）
        targetDesignId: prev.targetDesignId
          || (designs.length === 1 ? designs[0].designId : null)
          || designs[designs.length - 1]?.designId
          || null,
        // 旧 lecture 选择器同样自动选一个（兼容兜底）
        targetLessonId: prev.targetLessonId
          || (lessons.length === 1 ? lessons[0].lessonId : null)
          || lessons[lessons.length - 1]?.lessonId
          || null,
      }));
    });
  }, [selectedNotebookId, currentStage]);

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

  // D9.3（2026-05-18）：手动强制解锁下游 stage（绕过质量门槛）
  const handleForceUnlockNext = async (fromStage) => {
    if (!selectedNotebookId) return;
    if (typeof api.forceUnlockNextStageV2 !== 'function') {
      window.alert('❌ 强制解锁 API 未注入 — 请完整重启 Electron（preload 已更新）');
      return;
    }
    // v4.3.3 Codex Round 4 #1：优先用后端单一来源契约（stageContracts 在 mount 时 IPC 拉）；
    //   stageContracts 未就绪时回退到本地常量（与 contracts.js 严格一致，仅作 fallback）
    const STAGE_TITLE = stageContracts?.STAGE_TITLE || {
      schedule: '教学进度表', design: '教学设计', ppt: '教学课件', lecture: '课堂讲稿',
      quiz: '在线测验', homework: '课后作业', video: '微课视频', report: '教学实施报告',
    };
    const STAGE_ORDER = stageContracts?.STAGE_ORDER || ['schedule', 'design', 'ppt', 'lecture', 'quiz', 'homework', 'video', 'report'];
    const idx = STAGE_ORDER.indexOf(fromStage);
    if (idx < 0 || idx >= STAGE_ORDER.length - 1) {
      window.alert(`${STAGE_TITLE[fromStage] || fromStage} 已是最后阶段，无需解锁下游`);
      return;
    }
    const nextStage = STAGE_ORDER[idx + 1];
    const reason = window.prompt(
      `⚙ 强制解锁下游：${STAGE_TITLE[fromStage]} → ${STAGE_TITLE[nextStage]}\n\n` +
      `用途：质量校验误报 / 已确认通过但门槛卡住 / 老师明确想跳过\n\n` +
      `请简短说明原因（写入审计日志，不会影响操作）：`,
      `${STAGE_TITLE[fromStage]} 已确认完，质检误报，老师手动放行`
    );
    if (reason === null) return;  // 取消
    const res = await api.forceUnlockNextStageV2({ notebookId: selectedNotebookId, fromStage, reason });
    if (!res?.success) {
      window.alert(`强制解锁失败：${res?.error || '未知'}`);
      return;
    }
    setAssistantStatus(`✅ ${res.data?.message || '已解锁下游'}`);
    await loadNotebookContext(selectedNotebookId);
  };

  // v4.3.3 D14（2026-05-18）：framework stub 已彻底移除
  //   原 4 个 stub（saveFrameworkStage / handleGenerateFramework / handleConfirmFramework / handleExportFrameworkWord）
  //   和唯一调用方 handleSaveRawJson（line 3225）一并删除

  // ── Phase baoyu-A：SVG 教学结构图生成 ─────────────────────────────────────

  const handleGenerateDiagram = async (diagramType = 'hierarchy') => {
    if (!selectedNotebookId) return;
    setDiagramBusy(true);
    setAssistantStatus(`AI 正在生成${diagramType === 'mindmap' ? '思维导图' : diagramType === 'flowchart' ? '流程图' : diagramType === 'timeline' ? '时间轴' : diagramType === 'magazine' ? '杂志信息图（5 层结构 + 模块网格 + 行动清单 + 目标横幅）' : '知识结构图'}…`);
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
      // P1.1d（2026-05-17）：generateFrameworkInfographicV2 已下线（v3 framework），改用 generateStageInfographicV2 走 design 通道
      const response = await api.generateStageInfographicV2({
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
      // P1.1d（2026-05-17）：confirmFrameworkInfographicV2 已下线，统一走 confirmStageInfographicV2
      const response = await api.confirmStageInfographicV2({
        notebookId: selectedNotebookId,
        moduleId: moduleItem.id,
        topic: moduleItem.name || '教学模块信息图',
        imageData,
        stage: 'design',
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

  // Phase-7.7 A3-C（2026-04-30）：互动测试卡片导出（学生端 HTML，含翻卡 + 自检小测）
  const handleExportInteractiveCards = async () => {
    if (!selectedNotebookId) return;
    setBusyKey('interactive-cards');
    try {
      const response = await api.exportInteractiveCardsV2({ notebookId: selectedNotebookId });
      if (response?.cancelled) return;
      if (!response?.success && !response?.data) {
        window.alert(`导出互动测试卡片失败：${response?.error || '未知错误'}`);
        return;
      }
      setAssistantStatus(`🎮 互动测试卡片已导出：${response.data?.filePath || ''}（可发给学生在浏览器打开）`);
    } finally {
      setBusyKey('');
    }
  };

  const persistLectureState = async (nextState, confirm = false) => {
    const method = confirm ? api.confirmLectureStageV2 : api.saveLectureStageV2;
    const response = await method({ notebookId: selectedNotebookId, ...nextState });
    if (!response?.success) {
      // Phase-7.7 B16（2026-04-29）：confirm 被 quality 拒收时，给老师明确的三条出路指引。
      // 严格按 H10：不引入 force_accept，但提供可操作的解决路径，避免老师卡死。
      const errMsg = response?.error || '未知错误';
      if (confirm) {
        const guidanceLines = [
          `❌ 讲稿质量未达标，确认失败：`,
          ``,
          errMsg,
          ``,
          `📌 请从以下三种方式中选一种解决：`,
          ``,
          `① 【最快】上传教案素材：`,
          `   把已有教案/教材内容（.docx / .md / .txt）粘贴或上传到上方"教学素材辅助生成"区，`,
          `   然后点【合成正式稿】重新生成（AI 会融合素材扩写到达标字数）。`,
          ``,
          `② 【手动】在编辑器里补写：`,
          `   直接在讲稿编辑器扩写各章节的"教师讲述"段落，每章节加 100-300 字案例/讨论；`,
          `   然后再点【确认讲稿】。`,
          ``,
          `③ 【调整结构】修改课程参数：`,
          `   点上方【编辑课程上下文】，把"学时"改小一些（如 4 学时 → 2 学时），`,
          `   字数门槛会同比降低（每学时门槛 2200 字）。`,
          ``,
          `提示：Agent 不会强制接受不达标讲稿——这是为了保证最终交付物可直接使用。`,
        ];
        window.alert(guidanceLines.join('\n'));
        setAssistantStatus(`⚠️ 讲稿确认被拒：${errMsg.slice(0, 80)}（看弹窗里的三条出路）`);
      } else {
        window.alert(`保存讲稿阶段失败：${errMsg}`);
      }
      return false;
    }
    await loadNotebookContext(selectedNotebookId);
    return true;
  };

  // P1.1d 删除（2026-05-17）：handleGenerateLectureDrafts (旧 A/B/C 三稿入口) 已下线
  // 新流程由 LectureStage 内部走 lessonGenerateDraftV2 + lessonGenerateFormalV2

  // ── Phase-5C 参考资料：URL 抓取（支持多 URL，用";"分隔，并行读取）──────────
  // Phase-7.7 D3（2026-04-30）：修复 D1 的过度匹配——
  //   D1（旧）：按行分割 → 每行当 URL → 自动补 https:// → 把中文标题/项目符号也当 URL
  //   D3（新）：用正则从混合文本里"挖出"所有真正的 http(s):// URL，忽略其他文字
  //   同时：识别 SPA 网站（Canva/Adobe/Unsplash/Behance 等）给老师明确警告——
  //         这些站点 httpGet 不执行 JS，抓的是空 HTML 框架，建议手动复制内容
  const handleFetchRefUrl = async (rawInput) => {
    if (!rawInput || !String(rawInput).trim()) {
      window.alert('请先在输入框里粘贴 URL（学科网/职教云等传统服务端渲染网站效果好；SPA 站点建议手动复制内容）');
      return;
    }
    // D3：用正则从任意文本里提取真 URL（处理 markdown / 多行 / 混合中文标题等场景）
    // URL 只允许 ASCII 字符——明确排除中文 + 全角符号，避免把"https://Adobe官方学习"这种伪 URL 抓出来
    const urlRegex = /https?:\/\/[a-zA-Z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+/gi;
    const allUrls = String(rawInput).match(urlRegex) || [];
    // 去重 + 去除末尾标点 + 过滤无 TLD 的伪 URL（必须有域名点或 localhost）
    const isRealUrl = (u) => /^https?:\/\/[^\s/]+\.[^\s/]+/.test(u) || /^https?:\/\/localhost/.test(u);
    const urls = [...new Set(
      allUrls
        .map((u) => u.replace(/[.,;:!?)）]+$/, ''))
        .filter(isRealUrl)
    )];

    if (urls.length === 0) {
      window.alert('未能从输入里识别出 URL。\n请直接粘贴含 https:// 或 http:// 前缀的链接。');
      return;
    }

    // D4：现在后端已支持 BrowserWindow 渲染 SPA，不再提前警告，直接尝试抓取
    // 但 SPA 抓取慢（每个 5-10 秒），多 URL 时给老师总耗时预估
    const SPA_HOSTS = ['canva.com', 'canva.cn', 'adobe.com', 'unsplash.com', 'behance.net', '588ku.com'];
    const spaUrls = urls.filter((u) => SPA_HOSTS.some((h) => u.includes(h)));
    if (urls.length >= 3 || spaUrls.length > 0) {
      const estSec = Math.ceil(urls.length * (spaUrls.length > 0 ? 8 : 2));
      setAssistantStatus(`🔗 准备抓取 ${urls.length} 个 URL${spaUrls.length > 0 ? `（含 ${spaUrls.length} 个 SPA 站点，需 BrowserWindow 渲染）` : ''}，预计 ${estSec} 秒…`);
    }
    setRefFetchBusy(true);
    setRefFetchErrors([]);  // 清空上次失败列表
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
          // Phase-8 M0+：保留 errorKind 供 UI 分类显示
          const kind = r.status === 'fulfilled' ? r.value?.errorKind : 'unknown';
          errors.push({ url: urls[i], message: msg || '读取失败', kind });
        }
      });
      if (texts.length > 0) {
        setReferenceContext((prev) => (prev ? prev + '\n\n' + texts.join('\n\n') : texts.join('\n\n')));
      }
      if (errors.length > 0) {
        // 列表化展示在 modal 而不是 alert
        setRefFetchErrors(errors);
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
      // B17（2026-04-29）：扩展支持 .md / .markdown / .txt（前端直接读文本，不走主进程 docx 解析）
      const lowerName = String(file.name || '').toLowerCase();
      const isPlainText = lowerName.endsWith('.md') || lowerName.endsWith('.markdown') || lowerName.endsWith('.txt');

      let extractedText = '';
      if (isPlainText) {
        // 纯文本直接读
        extractedText = await file.text();
      } else if (lowerName.endsWith('.docx')) {
        // .docx 走主进程 mammoth 解析
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        bytes.forEach((b) => { binary += String.fromCharCode(b); });
        const base64 = window.btoa(binary);
        const res = await api.readDocxContent({ base64, filename: file.name });
        if (res?.success && res.data?.text) {
          extractedText = res.data.text;
        } else {
          window.alert(`解析失败：${res?.error || '无法读取文档，请手动复制粘贴'}`);
          return;
        }
      } else {
        window.alert(`不支持的文件类型：${file.name}\n支持的格式：.docx / .md / .markdown / .txt\nPDF 暂未支持，请先转 .docx 或复制粘贴`);
        return;
      }

      // B17：合并到 referenceContext，但保证总长度不超过 10000 字
      const cleanText = String(extractedText || '').trim();
      if (!cleanText) {
        window.alert('文件内容为空');
        return;
      }
      setReferenceContext((prev) => {
        const merged = prev ? prev + '\n\n' + cleanText : cleanText;
        if (merged.length > 10000) {
          window.alert(`合并后总素材超过 10000 字（${merged.length} 字），已截断。如需完整素材请先清空当前内容再上传。`);
          return merged.slice(0, 10000);
        }
        return merged;
      });
    } finally {
      setRefFetchBusy(false);
    }
  };
  // ── End 参考资料 ────────────────────────────────────────────────────────────

  // ── P1.1d 删除（2026-05-17）：Agent 自动模式整套（handleAgentRun / handleAgentResume / handleAgentDismissPause）已下线
  // 原 Phase-5C/5D/7.5 Agent UI + IPC 全部移除，老师只走"手动按阶段确认"工作流。

  // P1.1d 删除（2026-05-17）：旧版 handleGenerateFormalLecture（基于 drafts.a/b/c selectedDraft 走 generateFormalLecture）已下线
  // 新流程在 LectureStage 内部调 lessonGenerateFormalV2({ priorDraft })

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
    // 2026-05-16 v4.2.0 Phase A'-8：design-first 优先
    //   ① pptState.targetDesignId（v4.2.0 新选择器）→ 后端走 design-first pipeline
    //   ② pptState.targetLessonId（v4.1.x 兼容选择器）→ 后端走 lecture-fallback
    //   ③ 都没选 → 后端自动按 session / 最近一节决定
    //   totalHours 不再传 notebook.totalHours = 36（让后端按节课 metadata 算）
    const targetDesignId = pptState.targetDesignId || null;
    const targetLessonId = pptState.targetLessonId || null;
    setBusyKey('ppt-plan');
    setAssistantStatus(targetDesignId
      ? `AI 正在基于教学设计规划 PPT 页面结构…（design-first 流程）`
      : targetLessonId
        ? `AI 正在基于已确认讲稿规划 PPT 页面结构…（v4.1.x 兼容）`
        : `AI 正在按最新会话上下文规划 PPT 页面结构…`);
    try {
      const response = await api.generatePptPlanV2({
        notebookId: selectedNotebookId,
        // v4.2.0 design-first：传 designId（优先）
        designId: targetDesignId,
        // v4.1.x 兼容：传 lessonId
        lessonId: targetLessonId,
        courseName: selectedNotebook?.name || '课程',
        modules: editorData.modules,
        prevPages: pptState.pptPages,
        imageAspect: '16:9',
        imageQuality: pptState.imageQuality || 'medium',
        templateKey: pptState.templateKey || 'pro_minimalist',
        // v4.3.3 D1+D2（2026-05-18）：透传老师选的主色 + 配图风格
        mainAccentColor: pptState.mainAccentColor || '',
        imageStylePreset: pptState.imageStylePreset || 'flat',
        // v4.3.3 D3（2026-05-18）：拆 styleReferences vs contentReferences
        styleReferences: (pptState.externalReferences || []).filter(r => (r.purpose || 'content') === 'style'),
        contentReferences: (pptState.externalReferences || []).filter(r => (r.purpose || 'content') === 'content'),
        // 兼容老调用方
        externalReferences: pptState.externalReferences || [],
      });
      if (!response?.success) {
        setAssistantStatus(`AI 页面规划失败：${response?.error || '未知错误'}`);
        window.alert(`AI 页面规划失败：${response?.error || '未知错误'}`);
        return;
      }
      const { pages: rawPages, pageCount, mainAccentColor, lessonContext } = response.data;
      // 客户端再次去重，防止服务端极端情况下仍有重复 id
      const pages = deduplicatePptPageIds(rawPages);
      const nextState = {
        ...pptState,
        pptPages: pages,
        selectedPageId: pages[0]?.id || '',
        // 2026-05-16 v4.1.4 Phase 2：捕获并存储 AI 推断的整门课主色
        mainAccentColor: mainAccentColor || pptState.mainAccentColor || '#2E86DE',
        notebookId: selectedNotebookId,
        // 2026-05-16 v4.1.4 真 P2：记录这套 PPT 是为哪节课生成的
        lessonContext: lessonContext || null,
        targetLessonId: lessonContext?.lessonId || pptState.targetLessonId || null,
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
      const lessonTip = lessonContext
        ? `为「第 ${lessonContext.lessonNumber} 节·${lessonContext.topic}（${lessonContext.totalHours} 学时）」`
        : '为整门课';
      setAssistantStatus(`✨ AI 已${lessonTip}规划 ${pageCount} 页 PPT（主色 ${mainAccentColor || '默认'}）。下一步：② 生成封面配图确认风格。`);
    } finally {
      setBusyKey('');
    }
  };

  const handleGenerateCurrentPageCandidates = async () => {
    if (!selectedNotebookId || !currentPptPage) return;
    setBusyKey('ppt-candidates');
    try {
      // Phase-7.7 C8-1（2026-04-29）：尊重老师手工编辑的 imagePrompt
      // 之前 `imagePrompt: ''` 强制清空——老师在 textarea 改的内容被无情覆盖回模板默认值，
      // 用户反馈"封面配图提示词修改，结果它仍然生成原来的配图"就是这个 bug。
      // 现在：不强制清空。ensurePptImagePromptForPage 会判断 imagePrompt 是否已有值——
      //   - 有值（老师编辑过 或 上次生成留下的）→ 直接保留
      //   - 空值（老师故意清空想重新自动生成）→ 自动重建零文字 prompt
      // 老师想重新自动生成的场景：清空 textarea → 点【生成此页配图】即可。
      const normalizedPage = ensurePptImagePromptForPage(
        currentPptPage,
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
      // C8-1：封面也尊重老师编辑的 imagePrompt（去掉强制清空）
      // 老师想重新自动生成时，清空 textarea 即可触发自动重建
      const normalizedPage = ensurePptImagePromptForPage(
        coverPage,
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
    // P6 修复（2026-05-18）：accurate 计数，不再无脑"批量配图完成"误导老师
    let succeededCount = 0;
    const failedList = [];

    for (let i = 0; i < pagesToGenerate.length; i++) {
      const page = pagesToGenerate[i];
      setBatchProgress({ current: i + 1, total: pagesToGenerate.length, running: true });
      setAssistantStatus(`批量配图中 ${i + 1}/${pagesToGenerate.length}：${page.title || `第${page.pageNumber}页`}…`);
      try {
        // 2026-05-16 v4.1.4 Q2-①：不再清空 AI imagePrompt
        //   旧逻辑因"AI prompt 含标题文字可能被烧进图"一刀切清空，
        //   把 V2 pipeline stage 2 精心生成的"光电产业人才需求层级俯拍"等真实页面级 prompt 丢了。
        //   新逻辑：ensurePptImagePromptForPage 内部判断：
        //     - 已有 AI imagePrompt（≥15 字）→ 叠加"零文字铁律"等安全约束
        //     - 没有 / 太短 → 走旧 fallback 模板
        //
        // 2026-05-16 v4.1.4 问题 2 修复：封面/路线图强制重生 imagePrompt
        //   旧版"一键生成"对所有页直接复用已有 imagePrompt → 改了 spec 也不生效
        //   修法：对封面/路线图清空 imagePrompt，强制走新版 guizang hero spec
        const forceRegenerate = (page.pageType === '封面' || page.pageType === '路线图');
        const pageForPrompt = forceRegenerate ? { ...page, imagePrompt: '' } : page;
        const normalizedPage = ensurePptImagePromptForPage(
          pageForPrompt,
          {
            courseName: selectedNotebook?.name || '课程',
            template: currentTemplate,
            imageAspect: page.imageAspect || '16:9',
            imageQuality: page.imageQuality || pptState.imageQuality || 'medium'
          }
        );
        // Phase-9 调试：打印实际生成的 imagePrompt，方便老师诊断"图为何相似"
        console.log(`[batch-image] P${page.pageNumber} 标题=「${page.title}」`);
        console.log(`[batch-image] P${page.pageNumber} prompt=`, normalizedPage.imagePrompt);
        console.log(`[batch-image] P${page.pageNumber} prompt 含"视觉概念引导":`, /本页视觉概念引导/.test(normalizedPage.imagePrompt || ''));
        console.log(`[batch-image] P${page.pageNumber} prompt 含本页标题语义:`, (normalizedPage.imagePrompt || '').includes(String(page.title || '').slice(0, 8)));
        const response = await api.generatePptPageCandidatesV2({
          notebookId: selectedNotebookId,
          templateKey: pptState.templateKey,
          courseName: selectedNotebook?.name || '课程',
          page: normalizedPage
        });
        if (!response?.success) {
          console.warn(`[batch] P${page.pageNumber} 生成失败：${response?.error}`);
          failedList.push({ page: page.pageNumber, error: response?.error || '未知' });
          continue;
        }
        const updatedBatchPage = { ...page, ...normalizedPage, ...response.data?.page };
        // 真正成功 = 拿到 imagePath
        if (updatedBatchPage.imagePath || updatedBatchPage.imageUrl) succeededCount++;
        else failedList.push({ page: page.pageNumber, error: '后端返回 success=true 但无 imagePath' });
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
        failedList.push({ page: page.pageNumber, error: err.message });
      }
    }

    setBatchProgress({ current: 0, total: 0, running: false });
    // P6 修复（2026-05-18）：accurate 反馈，0 成功时弹诊断弹窗
    if (succeededCount === 0) {
      setAssistantStatus(`❌ 批量配图全部失败（0/${pagesToGenerate.length}）。详情见 F12 console`);
      const sample = failedList.slice(0, 3).map(f => `  P${f.page}: ${f.error}`).join('\n');
      window.alert(`批量配图全部失败！\n\n共 ${pagesToGenerate.length} 页，0 成功。\n\n前 3 条失败原因：\n${sample}\n\n常见原因：\n1. API key/endpoint 未配置（右上 API 配置）\n2. 网络/AI 服务问题\n3. imagePrompt 为空\n\n按 F12 看 DevTools console 完整堆栈`);
    } else if (failedList.length > 0) {
      setAssistantStatus(`⚠ 批量配图：${succeededCount}/${pagesToGenerate.length} 成功，${failedList.length} 失败`);
    } else {
      setAssistantStatus(`🎉 批量配图完成！${succeededCount}/${pagesToGenerate.length} 页全部成功`);
    }
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

  // ────────────────────────────────────────────────────────────────────
  // Phase-9（驭课 Agent v4.0.0）：4 个新阶段的 generate / save / confirm 处理
  // ────────────────────────────────────────────────────────────────────

  // C-1：教学进度表
  const handleGenerateSchedule = async () => {
    if (!selectedNotebookId) return;
    setBusyKey('schedule:generate');
    setAssistantStatus('正在生成教学进度表...');
    try {
      // 2026-05-15 bug 修复 + v4.1.4：传 hoursPerSession（来自 notebook）
      const cleanSchool = String(scheduleState.school || '').trim();
      const totalHoursNum = Number(scheduleState.totalHours);
      const notebookHoursPerSession = Number(selectedNotebook?.hoursPerSession) || 0;
      if (!notebookHoursPerSession || notebookHoursPerSession <= 0) {
        window.alert(
          '⚠ 笔记本缺少【每次课学时】配置。\n\n请点上方"📝 编辑上文"按钮 → 在"表头基本信息"中填写【每次课学时】（例如 2 或 4），再来生成进度表。'
        );
        setBusyKey('');
        return;
      }
      const res = await api.generateScheduleV2({
        notebookId: selectedNotebookId,
        courseName: selectedNotebook?.name || '',
        school: cleanSchool || undefined,
        totalHours: Number.isFinite(totalHoursNum) && totalHoursNum > 0 ? totalHoursNum : undefined,
        textbook: scheduleState.textbook || undefined,
        hoursPerSession: notebookHoursPerSession,
      });
      if (!res?.success) { window.alert(`生成失败：${res?.error || '未知'}`); return; }
      const sch = res.data.schedule;
      // 2026-05-15 P2-6：保留反编造审计供 UI 显示绿条
      const audit = sch?._fabricationAudit || null;
      setScheduleState((prev) => ({
        ...prev,
        schedule: sch,
        jsonText: JSON.stringify(sch, null, 2),
        artifactId: res.data.artifactId,
        confirmed: false,
        fabricationAudit: audit,
      }));
      // 2026-05-15 v4.1.4 bug fix：先 loadNotebookContext 再 setAssistantStatus，
      //   否则 loadNotebookContext 末尾的"已加载《...》"会覆盖"生成成功"提示
      await loadNotebookContext(selectedNotebookId);
      if (audit) {
        const fieldList = audit.corrections.map((c) => c.field).join(' / ');
        setAssistantStatus(`✅ 教学进度表已生成（系统已修正 AI 编造的 ${audit.count} 处字段：${fieldList}）`);
      } else {
        setAssistantStatus('✅ 教学进度表已生成。');
      }
    } finally { setBusyKey(''); }
  };
  const handleSaveSchedule = async (state) => {
    if (!selectedNotebookId) return;
    let payload = state.schedule;
    // 2026-05-15 老师反馈 4.1：JSON 编辑模式走宽容解析（主进程端做 normalize + 错误定位）
    let importAuditFromValidate = null;
    if (state.jsonText && state.jsonText.trim()) {
      const validate = await api.validateScheduleJsonV2({ jsonText: state.jsonText });
      if (!validate?.success) {
        const locInfo = validate.line ? `\n位置：第 ${validate.line} 行 第 ${validate.column || '?'} 列` : '';
        window.alert(
          `❌ JSON 格式错误（已尝试自动修复 中文引号 / 注释 / 尾逗号 等，仍无法解析）：\n\n${validate.error || '未知错误'}${locInfo}\n\n` +
          `💡 建议：\n` +
          `  1. 检查是否漏了 } 或 "\n` +
          `  2. 字符串值不能用中文双引号（“”）\n` +
          `  3. 数字值不要加引号\n` +
          `  4. 数组/对象末项后不要留逗号`
        );
        return;
      }
      payload = validate.data;
      if (validate.repaired) {
        setAssistantStatus('⚠ JSON 已自动修复（中文引号 / 尾逗号等），请确认保存结果。');
      }
      // 2026-05-15 v4.1.3：收集 alias 兼容审计（DeepSeek 等外部 AI 的字段名映射）
      if ((validate.aliasesUsed?.length || 0) > 0 || (validate.importWarnings?.length || 0) > 0) {
        importAuditFromValidate = {
          aliasesUsed: validate.aliasesUsed || [],
          warnings: validate.importWarnings || [],
        };
      }
    }
    const res = await api.saveScheduleV2({ notebookId: selectedNotebookId, artifactId: state.artifactId, schedule: payload });
    if (!res?.success) { window.alert(`保存失败：${res?.error || '未知'}`); return; }
    // 服务端会回写 normalize 后的 schedule，前端同步更新（防止老师误删字段后下游崩）
    const finalSchedule = res.data?.schedule || payload;
    // 合并 audit：validate 阶段的 + 服务端 normalize 阶段的
    const mergedAudit = res.data?.importAudit || importAuditFromValidate;
    setScheduleState((prev) => ({
      ...prev,
      schedule: finalSchedule,
      jsonText: JSON.stringify(finalSchedule, null, 2),
      artifactId: res.data.artifactId,
      importAudit: mergedAudit,  // 2026-05-15 v4.1.3：UI 据此显示黄色警告条
    }));
    if (mergedAudit && (mergedAudit.aliasesUsed?.length > 0 || mergedAudit.warnings?.length > 0)) {
      const aliasCount = mergedAudit.aliasesUsed?.length || 0;
      const warnCount = mergedAudit.warnings?.length || 0;
      setAssistantStatus(`✅ 进度表已保存。⚠ 检测到外部 AI 字段命名（${aliasCount} 项已兼容映射）/ ${warnCount} 项字段缺失，详情见黄色警告条。`);
    } else {
      setAssistantStatus('进度表已保存（已规范化字段）。');
    }
  };
  const handleConfirmSchedule = async () => {
    if (!selectedNotebookId || !scheduleState.artifactId) return;
    const res = await api.confirmScheduleV2({ notebookId: selectedNotebookId, artifactId: scheduleState.artifactId });
    if (!res?.success) { window.alert(`确认失败：${res?.error || '未知'}`); return; }
    setScheduleState((prev) => ({ ...prev, confirmed: true }));
    setAssistantStatus('进度表已确认，教学设计阶段已解锁。');
    await loadNotebookContext(selectedNotebookId);
  };
  const handleExportScheduleWord = async () => {
    if (!selectedNotebookId) return;
    setAssistantStatus('正在导出教学进度表 Word...');
    const res = await api.exportScheduleWordV2({ notebookId: selectedNotebookId });
    if (res?.cancelled) { setAssistantStatus('已取消导出。'); return; }
    if (!res?.success) { window.alert(`导出失败：${res?.error || '未知'}`); setAssistantStatus('导出失败'); return; }
    setAssistantStatus(`✅ 已导出：${res.data?.filePath || ''}`);
    await loadNotebookContext(selectedNotebookId);
  };

  // C-2：教学设计（Phase-9.5：按节课）
  const handleGenerateDesign = async (lessonForm) => {
    if (!selectedNotebookId) return;
    const lm = lessonForm || designState.lessonForm || {};
    if (!lm.topic) { window.alert('请先填本节主题'); return; }
    setBusyKey('design:generate');
    setAssistantStatus(`正在生成第 ${lm.lessonNumber || 1} 节「${lm.topic}」教学设计...`);
    try {
      const res = await api.generateDesignV2({
        notebookId: selectedNotebookId,
        courseName: selectedNotebook?.name || '',
        lessonMeta: {
          lessonNumber: lm.lessonNumber,
          topic: lm.topic,
          chapter: lm.chapter,
          weekRange: lm.weekRange,
          theoryHours: lm.theoryHours,
          practiceHours: lm.practiceHours,
        },
      });
      if (!res?.success) { window.alert(`生成失败：${res?.error || '未知'}`); return; }
      const d = res.data.design;
      // 2026-05-15 v4.1.4 bug fix：先 loadNotebookContext 拉最新 artifact 列表（用于 designLessons tab），
      //   然后再 setDesignState（覆盖 loadNotebookContext 可能拉到的"次新"设计 + 重新设置状态）
      await loadNotebookContext(selectedNotebookId);
      setDesignState((prev) => ({
        ...prev,
        design: d,
        jsonText: JSON.stringify(d, null, 2),
        artifactId: res.data.artifactId,
        confirmed: false,
        // 把 lessonMeta 反向同步回 lessonForm
        lessonForm: { ...prev.lessonForm, ...(res.data.lessonMeta || {}) },
      }));
      // 状态消息在 loadNotebookContext 之后设置，否则被它的"已加载《...》"覆盖
      setAssistantStatus(`✅ 第 ${lm.lessonNumber} 节教学设计已生成（${(d?.objective || '').length} 字目标 · ${(d?.inClass?.phases || []).length} 段教学法）`);
    } finally { setBusyKey(''); }
  };

  // Phase-9.5：切换节课（按 design artifactId）
  const switchDesignLesson = async (artifactId) => {
    if (!selectedNotebookId || !artifactId) return;
    const res = await api.getDesignDataV2({ notebookId: selectedNotebookId, artifactId });
    if (!res?.success) { window.alert(`切换失败：${res?.error || '未知'}`); return; }
    const d = res.data.design;
    setDesignState((prev) => ({
      ...prev,
      design: d,
      jsonText: d ? JSON.stringify(d, null, 2) : '',
      artifactId: res.data.artifactId,
      confirmed: !!res.data.confirmed,
      lessonForm: d?.lessonMeta || prev.lessonForm,
    }));
    setAssistantStatus(`已切换到第 ${d?.lessonMeta?.lessonNumber || '?'} 节「${d?.lessonMeta?.topic || ''}」`);
    // 2026-05-16 v4.2.0 Phase A：切换设计节课 → 同步 session（让讲稿/PPT 知道当前节课）
    const lessonN = Number(d?.lessonMeta?.lessonNumber) || 0;
    if (lessonN > 0 && typeof api.switchActiveLessonV2 === 'function') {
      try {
        await api.switchActiveLessonV2({ notebookId: selectedNotebookId, lessonNumber: lessonN });
        // 让 session 显式记录这个 designId（switchActiveLesson 会自动查 design，但万一查不到要兜底）
        await api.setActiveArtifactV2({ notebookId: selectedNotebookId, kind: 'design', artifactId: res.data.artifactId });
      } catch (e) { /* 兜底 */ }
    }
  };

  // Phase-9.5：新建一节（清空 lessonForm 让老师重新填，编号自动 +1）
  const newDesignLesson = () => {
    const nextLessonNumber = (designLessons.reduce((max, l) => Math.max(max, l.lessonNumber || 0), 0) || 0) + 1;
    setDesignState({
      design: null,
      jsonText: '',
      artifactId: null,
      confirmed: false,
      lessonForm: { lessonNumber: nextLessonNumber, topic: '', chapter: '', weekRange: '', theoryHours: 2, practiceHours: 2 },
    });
    setAssistantStatus(`已新建第 ${nextLessonNumber} 节，请填主题后点"生成"`);
  };

  // 2026-05-15 老师反馈 4.7 + P2-4：软删除某节教学设计（可从回收站恢复）
  const deleteDesignLesson = async (artifactId, lessonLabel) => {
    if (!selectedNotebookId || !artifactId) return;
    const ok = window.confirm(
      `确认删除「${lessonLabel || '本节'}」教学设计？\n\n` +
      `ℹ 本次为软删除，节课会进入【回收站】，可随时恢复。\n` +
      `⚠ 已确认的本节讲稿 / PPT / 视频 / 报告会失去关联，恢复后需重新校对。\n\n` +
      `点【确定】删除（可恢复），点【取消】保留。`
    );
    if (!ok) return;
    const res = await api.deleteDesignLessonV2({ notebookId: selectedNotebookId, artifactId });
    if (!res?.success) { window.alert(`删除失败：${res?.error || '未知'}`); return; }

    // 删除成功后刷新 designLessons 列表 + 清空当前编辑
    try {
      const lessonsRes = await api.listDesignLessonsV2?.(selectedNotebookId);
      if (lessonsRes?.success) {
        setDesignLessons(arr(lessonsRes.data?.lessons));
        setDesignAccumulatedHours(Number(lessonsRes.data?.totalAccumulatedHours) || 0);
        setDesignDesignedHours(Number(lessonsRes.data?.totalDesignedHours) || 0);
      }
    } catch (_) { /* ignore */ }
    setDesignState({
      design: null,
      jsonText: '',
      artifactId: null,
      confirmed: false,
      lessonForm: { lessonNumber: 1, topic: '', chapter: '', weekRange: '', theoryHours: 2, practiceHours: 2 },
    });
    setAssistantStatus(`✅ 已删除「${lessonLabel || '本节'}」教学设计（已进入回收站，可恢复）`);
  };

  // 2026-05-15 P2-4：从回收站恢复某节教学设计
  const restoreDesignLesson = async (artifactId) => {
    if (!selectedNotebookId || !artifactId) return;
    const res = await api.restoreDesignLessonV2?.({ artifactId });
    if (!res?.success) { window.alert(`恢复失败：${res?.error || '未知'}`); return; }
    // 刷新 lessons 列表
    try {
      const lessonsRes = await api.listDesignLessonsV2?.(selectedNotebookId);
      if (lessonsRes?.success) {
        setDesignLessons(arr(lessonsRes.data?.lessons));
        setDesignAccumulatedHours(Number(lessonsRes.data?.totalAccumulatedHours) || 0);
        setDesignDesignedHours(Number(lessonsRes.data?.totalDesignedHours) || 0);
      }
    } catch (_) { /* ignore */ }
    setAssistantStatus('✅ 已从回收站恢复节课');
  };
  const handleSaveDesign = async (state) => {
    if (!selectedNotebookId) return;
    let payload = state.design;
    if (state.jsonText) { try { payload = JSON.parse(state.jsonText); } catch (e) {
      window.alert('JSON 格式错误：' + e.message); return;
    }}
    const res = await api.saveDesignV2({ notebookId: selectedNotebookId, artifactId: state.artifactId, design: payload });
    if (!res?.success) { window.alert(`保存失败：${res?.error || '未知'}`); return; }
    setDesignState((prev) => ({ ...prev, design: payload, artifactId: res.data.artifactId }));
    setAssistantStatus('教学设计已保存。');
  };
  const handleConfirmDesign = async () => {
    if (!selectedNotebookId || !designState.artifactId) return;
    const res = await api.confirmDesignV2({ notebookId: selectedNotebookId, artifactId: designState.artifactId });
    if (!res?.success) { window.alert(`确认失败：${res?.error || '未知'}`); return; }
    setDesignState((prev) => ({ ...prev, confirmed: true }));
    setAssistantStatus('教学设计已确认，讲稿阶段已解锁。');
    await loadNotebookContext(selectedNotebookId);
  };
  const handleExportDesignWord = async () => {
    if (!selectedNotebookId) return;
    setAssistantStatus('正在导出教学设计 Word...');
    const res = await api.exportDesignWordV2({ notebookId: selectedNotebookId });
    if (res?.cancelled) { setAssistantStatus('已取消导出。'); return; }
    if (!res?.success) { window.alert(`导出失败：${res?.error || '未知'}`); setAssistantStatus('导出失败'); return; }
    setAssistantStatus(`✅ 已导出：${res.data?.filePath || ''}`);
    await loadNotebookContext(selectedNotebookId);
  };
  // Phase-9：教学设计信息图（AI 生成 PNG，复用 infographic-card.service）
  // Phase-9.5 升级：按 layout 切换数据源
  //   design_overview（整门课视角）→ 用所有 lessons 聚合数据
  //   其他 6 种布局（本节视角）→ 用当前选中的 designState.design
  const handleGenerateDesignInfographic = async ({ layout, visualStyle } = {}) => {
    if (!selectedNotebookId) return;
    const layoutKey = layout || 'design_overview';
    const isCourseLevel = layoutKey === 'design_overview';

    // 数据可用性检查
    if (isCourseLevel && designLessons.length === 0) {
      window.alert('整门课视角需要至少 1 节课设计——请先在"按节课"区生成');
      return;
    }
    if (!isCourseLevel && !designState.design) {
      window.alert('本节视角需要选中节课——请在"按节课"区点击或新建一节');
      return;
    }
    // 2026-05-15 v4.1.4 T2 修复：信息图丢失 bug
    //   根因：若 designState.artifactId 为 null（刚生成未保存），sourceDesignArtifactId
    //   被写成 null → DesignStage 过滤器把无 sourceDesignArtifactId 的本节图全部隐藏
    //   → 老师以为"信息图消失了"
    //   修法：本节视角下先确保 design 已保存到 DB，拿到 artifactId 再生图
    let designArtifactIdForLink = designState.artifactId || null;
    if (!isCourseLevel && !designArtifactIdForLink) {
      try {
        const saveRes = await api.saveDesignV2({
          notebookId: selectedNotebookId,
          artifactId: null,
          design: designState.design,
        });
        if (saveRes?.success && saveRes.data?.artifactId) {
          designArtifactIdForLink = saveRes.data.artifactId;
          setDesignState((prev) => ({ ...prev, artifactId: saveRes.data.artifactId }));
        }
      } catch (_) { /* ignore — 即使 save 失败，仍允许生成图（只是会缺关联） */ }
    }
    setAssistantStatus(`🎨 正在调用 AI 生成${isCourseLevel ? '整门课' : '本节'}信息图（60-120 秒）...`);

    const totalHours = scheduleState?.schedule?.header?.totalHours || selectedNotebook?.totalHours || 0;   // P2
    const learnerProfile = selectedNotebook?.learnerProfile || '';
    const jobTargets = selectedNotebook?.jobTargets || '';
    const courseGoal = selectedNotebook?.description || '';

    // ═══ 按视角拼装 content ═══
    let content = '';
    let topic = '';
    let imgWidth = 1200, imgHeight = 1900;

    if (isCourseLevel) {
      // ─── 整门课视角：聚合所有 lessons 数据 ───
      const allKnowledge = new Set();
      const allSkill = new Set();
      const allEmotion = new Set();
      const allKeyPoints = new Set();
      const allDifficulties = new Set();
      const allMethods = new Set();
      const allIdeology = new Set();

      for (const lesson of designLessons) {
        try {
          // listDesignLessons 返回的是元信息，需要拉每节的完整 content
          const lRes = await api.getDesignDataV2({ notebookId: selectedNotebookId, artifactId: lesson.artifactId });
          if (!lRes?.success) continue;
          const ld = lRes.data?.design || {};
          (ld.teachingObjectives?.knowledge || []).forEach((k) => allKnowledge.add(k));
          (ld.teachingObjectives?.skill || []).forEach((k) => allSkill.add(k));
          (ld.teachingObjectives?.emotion || []).forEach((k) => allEmotion.add(k));
          (ld.keyPoints || []).forEach((k) => allKeyPoints.add(k));
          (ld.difficulties || []).forEach((k) => allDifficulties.add(k));
          (ld.teachingMethods || []).forEach((m) => allMethods.add(m.name || ''));
          (ld.ideologicalElements || []).forEach((k) => allIdeology.add(k));
        } catch (_) { /* ignore single lesson failure */ }
      }
      const sumHours = designLessons.reduce((s, l) => s + (Number(l.totalHours) || 0), 0);
      const lessonTopics = designLessons.map((l) => `第${l.lessonNumber}节 ${l.topic}`).join('；');

      // 2026-05-16 v4.1.4 第四轮：data-only 化（整门课视角同步）
      //   原版 section header 含 (h=200, 红底, 灰底, 深蓝底) 等版面圣旨
      //   现在改成纯数据段，让 system prompt 的 design_overview spec 完全主导版面
      content = [
        '课程数据 · 整门课聚合',
        `课程名：${selectedNotebook?.name || '本课程'}`,
        `总学时：${totalHours}`,
        `已设计节课数：${designLessons.length}`,
        `累计已设计学时：${sumHours}`,
        '',
        '【学情起点】',
        `学情说明：${learnerProfile || '中职二年级学生'}`,
        '整门课教学难点（合并所有节课，按需取前 6 条）：',
        ...Array.from(allDifficulties).slice(0, 6).map((d) => `  - ${d}`),
        '',
        '【三类教学目标（合集）】',
        `知识目标：${Array.from(allKnowledge).slice(0, 5).join('；') || '—'}`,
        `技能目标：${Array.from(allSkill).slice(0, 5).join('；') || '—'}`,
        `素养目标：${Array.from(allEmotion).slice(0, 5).join('；') || '—'}`,
        '',
        '【整门课重点（合集）】',
        Array.from(allKeyPoints).slice(0, 6).join('；') || '—',
        '',
        '【整门课学习路径】',
        `已设计节课列表：${lessonTopics || '（无）'}`,
        '',
        '【教学方法谱】',
        `全部使用的教学方法（去重）：${Array.from(allMethods).slice(0, 8).join(' / ') || '—'}`,
        '',
        '【思政元素】',
        Array.from(allIdeology).join(' / ') || '—',
        '',
        '【能力达成出口】',
        `学完后能：${courseGoal ? courseGoal.slice(0, 60) : '完成完整能力体系'}`,
        `对接岗位：${jobTargets || '相关行业岗位'}`,
        `钩子句（"学完后能"短句）：${jobTargets ? `胜任「${jobTargets.split(/[、，,]/)[0]}」` : '相关岗位工作'}`,
        '',
        '【HERO 数字徽章数据】',
        `学时：${totalHours} / 目标条数：${allKnowledge.size + allSkill.size + allEmotion.size} / 方法数：${allMethods.size} / 节课数：${designLessons.length}`,
      ].filter(Boolean).join('\n');
      topic = `${selectedNotebook?.name || '本课程'}-整门课教学设计概览（${designLessons.length} 节聚合）`;
    } else {
      // ─── 本节视角：用当前选中的 design ───
      const d = designState.design;
      const obj = d.teachingObjectives || {};
      const phases = d.inClass?.phases || [];
      const components = d.assessment?.components || [];
      const methods = d.teachingMethods || [];
      const lm = d.lessonMeta || {};

      // 2026-05-16 v4.1.4 第四轮：data-only 化
      //   原版 section header 含 (顶部，h=160) 等位置标注 + (按 layout 决定) 等元说明
      //   这些会被 AI 当成版面圣旨，覆盖 system prompt 的 layout spec
      //   现在 section header 改成纯语义标签，无任何位置/尺寸/颜色提示
      content = [
        `课程数据 · 本节信息`,
        `课次：第 ${lm.lessonNumber || '?'} 节`,
        `主题：${lm.topic || '未命名'}`,
        `章节：${lm.chapter || '—'}`,
        `周次：${lm.weekRange || '—'}`,
        `学时：${lm.totalHours || 0} 学时（理论 ${lm.theoryHours || 0} + 实践 ${lm.practiceHours || 0}）`,
        '',
        '【教学目标 · 三类】',
        `知识目标：${(obj.knowledge || []).join('；') || '—'}`,
        `技能目标：${(obj.skill || []).join('；') || '—'}`,
        `素养目标：${(obj.emotion || []).join('；') || '—'}`,
        '',
        '【重难点】',
        `重点：${(d.keyPoints || []).join('；') || '—'}`,
        `难点：${(d.difficulties || []).join('；') || '—'}`,
        '',
        '【教学方法】（每条务必带 desc 说明，避免只剩标题）',
        ...methods.slice(0, 6).map((m, i) => {
          const parts = [`${i + 1}. ${m.name}`];
          if (m.applicable) parts.push(`适用：${m.applicable}`);
          if (m.desc) parts.push(`说明：${m.desc}`);
          return `  ${parts.join('；')}`;
        }),
        '',
        '【5 段法流程】',
        ...phases.map((p, i) => `  第${i + 1}段 ${p.phase} · ${p.duration || '—'}`),
        '',
        '【考核维度】',
        ...components.map((c) => `  ${c.name}：${c.weight}%`),
        '',
        '【思政元素】',
        (d.ideologicalElements || []).join('；') || '—',
      ].filter(Boolean).join('\n');
      topic = `${selectedNotebook?.name || '本课程'}-第${lm.lessonNumber || '?'}节·${lm.topic || ''}`;
      // 本节视角图相对小一点（不需要 design_overview 那么大）
      imgWidth = 1000; imgHeight = 1400;
    }

    const res = await api.generateStageInfographicV2({
      notebookId: selectedNotebookId,
      stage: 'design',
      topic,
      content,
      layout: layoutKey,
      visualStyle: visualStyle || 'professional',
      width: imgWidth,
      height: imgHeight,
      // Phase-9.5：关联到当前 design artifact（仅本节视角时）
      // 2026-05-15 v4.1.4 T2：用上一步可能新建的 designArtifactIdForLink，避免空关联
      sourceDesignArtifactId: isCourseLevel ? null : designArtifactIdForLink,
      // 同时把节课元信息塞进 content，便于"老数据 / 无关联"时的兜底匹配
      sourceLessonNumber: isCourseLevel ? null : (designState.design?.lessonMeta?.lessonNumber || null),
      sourceLessonTopic: isCourseLevel ? null : (designState.design?.lessonMeta?.topic || ''),
    });
    if (!res?.success) {
      window.alert(`信息图生成失败：${res?.error || '未知'}`);
      setAssistantStatus('信息图生成失败');
      return;
    }
    setAssistantStatus(`✅ 信息图已生成：${res.data?.imagePath || ''}`);
    await loadNotebookContext(selectedNotebookId);
  };

  // C-3：微课视频
  const handleGenerateMicroVideo = async () => {
    if (!selectedNotebookId) return;
    setBusyKey('video:generate');
    setAssistantStatus('正在生成微课视频整套方案...');
    try {
      const res = await api.generateMicroVideoV2({
        notebookId: selectedNotebookId,
        courseName: selectedNotebook?.name || '',
        videoTopic: microVideoState.videoTopic,
      });
      if (!res?.success) { window.alert(`生成失败：${res?.error || '未知'}`); return; }
      const mv = res.data.microVideo;
      setMicroVideoState((prev) => ({
        ...prev, microVideo: mv, jsonText: JSON.stringify(mv, null, 2),
        artifactId: res.data.artifactId, confirmed: false,
      }));
      setAssistantStatus('微课视频方案已生成。');
      await loadNotebookContext(selectedNotebookId);
    } finally { setBusyKey(''); }
  };
  const handleSaveMicroVideo = async (state) => {
    if (!selectedNotebookId) return;
    let payload = state.microVideo;
    if (state.jsonText) { try { payload = JSON.parse(state.jsonText); } catch (e) {
      window.alert('JSON 格式错误：' + e.message); return;
    }}
    const res = await api.saveMicroVideoV2({ notebookId: selectedNotebookId, artifactId: state.artifactId, microVideo: payload });
    if (!res?.success) { window.alert(`保存失败：${res?.error || '未知'}`); return; }
    // v4.3.3 修复（老师测试 2026-05-30）：保存=改成草稿态，confirmed 已被后端置回 false，
    //   本地 confirmed 也同步清掉，并提示需要重新点"确认"才能解锁报告（避免"保存后报告悄悄锁回"困惑）。
    setMicroVideoState((prev) => ({ ...prev, microVideo: payload, artifactId: res.data.artifactId, confirmed: false }));
    setAssistantStatus('✅ 微课视频方案已保存为草稿。如需解锁实施报告，请重新点「确认（解锁实施报告）」。');
    await loadNotebookContext(selectedNotebookId);
  };
  const handleConfirmMicroVideo = async () => {
    if (!selectedNotebookId || !microVideoState.artifactId) return;
    const res = await api.confirmMicroVideoV2({ notebookId: selectedNotebookId, artifactId: microVideoState.artifactId });
    if (!res?.success) { window.alert(`确认失败：${res?.error || '未知'}`); return; }
    setMicroVideoState((prev) => ({ ...prev, confirmed: true }));
    await loadNotebookContext(selectedNotebookId);
    // v4.3.3 Bug2 修复（老师反馈）：不再无条件说"已解锁"——实施报告需前 7 阶段全部确认。
    //   loadNotebookContext 刷新后按真实 unlockedStages 给提示，避免误导。
    const wf = await api.getWorkflowState(selectedNotebookId).catch(() => null);
    const reportUnlocked = arr(wf?.unlockedStages || wf?.data?.unlockedStages).includes('report');
    setAssistantStatus(reportUnlocked
      ? '微课视频方案已确认，实施报告阶段已解锁。'
      : '微课视频方案已确认。实施报告需"教学课件 / 课堂讲稿 / 在线测验 / 课后作业 / 微课视频"等前置阶段全部点过"确认"才解锁——请检查上方卡片是否还有未确认的阶段。');
  };
  const handleCopyJimengPrompts = async () => {
    const prompts = microVideoState.microVideo?.jimengPrompts || [];
    if (prompts.length === 0) { window.alert('请先生成方案。'); return; }
    const text = prompts.map((p, i) => `镜头 ${i + 1}：\n${typeof p === 'string' ? p : (p.prompt || '')}`).join('\n\n');
    try { await navigator.clipboard.writeText(text); setAssistantStatus(`已复制 ${prompts.length} 条即梦提示词。`); }
    catch { window.alert('复制失败。'); }
  };

  // C-4：教学实施报告
  const handleGenerateReport = async () => {
    if (!selectedNotebookId) return;
    setBusyKey('report:generate');
    setAssistantStatus('正在汇总前 5 阶段产物，生成实施报告...');
    try {
      const res = await api.generateReportV2({
        notebookId: selectedNotebookId,
        courseName: selectedNotebook?.name || '',
      });
      if (!res?.success) { window.alert(`生成失败：${res?.error || '未知'}`); return; }
      setReportState({ report: res.data.report, artifactId: res.data.artifactId, confirmed: false });
      setAssistantStatus('实施报告已生成，请补填实施成效与反思改进。');
      await loadNotebookContext(selectedNotebookId);
    } finally { setBusyKey(''); }
  };
  const handleSaveReport = async (state) => {
    if (!selectedNotebookId || !state.report) return;
    const res = await api.saveReportV2({ notebookId: selectedNotebookId, artifactId: state.artifactId, report: state.report });
    if (!res?.success) { window.alert(`保存失败：${res?.error || '未知'}`); return; }
    setReportState((prev) => ({ ...prev, artifactId: res.data.artifactId }));
    setAssistantStatus('实施报告（含手填内容）已保存。');
  };
  const handleConfirmReport = async () => {
    if (!selectedNotebookId || !reportState.artifactId) return;
    const res = await api.confirmReportV2({ notebookId: selectedNotebookId, artifactId: reportState.artifactId });
    if (!res?.success) { window.alert(`确认失败：${res?.error || '未知'}`); return; }
    setReportState((prev) => ({ ...prev, confirmed: true }));
    setAssistantStatus('实施报告已确认归档。本课程的 8 阶段工作流完成。');
    await loadNotebookContext(selectedNotebookId);
  };
  // Phase-9 报告 4 格式导出
  const handleExportReport = async (format) => {
    if (!selectedNotebookId) return;
    const apiMap = {
      word: 'reportExportWordV2',
      markdown: 'reportExportMarkdownV2',
      html: 'reportExportHtmlV2',
      pdf: 'reportExportPdfV2',
    };
    const fnName = apiMap[format];
    if (!fnName || typeof api[fnName] !== 'function') {
      window.alert(`❌ 未知导出格式或 API 未加载：${format}\n请完整重启 Electron`);
      return;
    }
    setAssistantStatus(`正在导出 ${format.toUpperCase()} 格式...`);
    try {
      const res = await api[fnName]({ notebookId: selectedNotebookId });
      if (res?.cancelled) { setAssistantStatus('已取消'); return; }
      if (!res?.success) {
        window.alert(`导出失败：${res?.error || '未知'}`);
        setAssistantStatus(`导出失败：${res?.error || '未知'}`);
        return;
      }
      setAssistantStatus(`✅ 已导出：${res.data?.filePath || ''}`);
      await loadNotebookContext(selectedNotebookId);
    } catch (e) {
      window.alert(`💥 异常：${e.message}`);
    }
  };

  // 打开"编辑课程上下文"弹窗，预填当前笔记本的字段
  // 2026-05-15 v4.1.4：扩展 — 加入 teacher/className/department/semester/totalHours/textbook
  //   解决"老师创建时漏填这几项，后续无法补"的问题
  const openEditCtx = () => {
    if (!selectedNotebook) return;
    setEditCtxForm({
      // 原有：富上下文
      softwareTools: selectedNotebook.softwareTools || '',
      jobTargets: selectedNotebook.jobTargets || '',
      industryScenarios: selectedNotebook.industryScenarios || '',
      learnerProfile: selectedNotebook.learnerProfile || '',
      teachingMaterials: selectedNotebook.teachingMaterials || '',
      // 新增：表头基本信息（这些会出现在右侧表头）
      teacher: selectedNotebook.teacher || '',
      className: selectedNotebook.className || '',
      department: selectedNotebook.department || '',
      semester: selectedNotebook.semester || '',
      school: selectedNotebook.school || '广州纺校',
      totalHours: selectedNotebook.totalHours || '',     // P2：不再硬编码 72 兜底
      textbook: selectedNotebook.textbook || '',
      // 2026-05-15 v4.1.4：每次课学时数（创建时已填，编辑时可改）
      hoursPerSession: selectedNotebook.hoursPerSession || '',
      minutesPerHour: selectedNotebook.minutesPerHour || '',   // P2（2026-05-17）
    });
    setShowEditCtx(true);
  };

  // 保存编辑后的课程上下文到数据库
  // 2026-05-15 v4.1.4：保存后同步到当前 schedule.header（让右侧表头立刻更新）
  const saveEditCtx = async () => {
    if (!selectedNotebookId) return;
    const response = await api.updateNotebook(selectedNotebookId, editCtxForm);
    if (!response?.success) {
      window.alert(`保存失败：${response?.error || '未知错误'}`);
      return;
    }
    // 更新本地 selectedNotebook
    setSelectedNotebook((prev) => prev ? { ...prev, ...editCtxForm } : prev);

    // 同步到 scheduleState（input 字段 + schedule.header + jsonText）
    setScheduleState((prev) => {
      const newState = {
        ...prev,
        school: editCtxForm.school || prev.school,
        totalHours: editCtxForm.totalHours || prev.totalHours,
        textbook: editCtxForm.textbook || prev.textbook,
      };
      // 如果有 schedule，把表头字段补到 header 上 + 重建 jsonText
      if (prev.schedule) {
        const newSchedule = {
          ...prev.schedule,
          header: {
            ...(prev.schedule.header || {}),
            teacher: editCtxForm.teacher || prev.schedule.header?.teacher || '',
            className: editCtxForm.className || prev.schedule.header?.className || '',
            department: editCtxForm.department || prev.schedule.header?.department || '',
            semester: editCtxForm.semester || prev.schedule.header?.semester || '',
            school: editCtxForm.school || prev.schedule.header?.school || '',
            totalHours: editCtxForm.totalHours || prev.schedule.header?.totalHours || 0,    // P2
            textbook: editCtxForm.textbook || prev.schedule.header?.textbook || '',
          },
        };
        newState.schedule = newSchedule;
        newState.jsonText = JSON.stringify(newSchedule, null, 2);
      }
      return newState;
    });

    setShowEditCtx(false);
    setAssistantStatus('课程上下文已更新（表头信息已同步到当前进度表，下次生成将使用新信息）。');
  };

  const createNotebook = async () => {
    const payload = {
      ...createForm,
      name: String(createForm.name || '').trim(),
      teacher: String(createForm.teacher || '').trim(),
      className: String(createForm.className || '').trim(),
      hoursPerSession: Number(createForm.hoursPerSession) || 0,
      minutesPerHour: Number(createForm.minutesPerHour) || 0,   // P2（2026-05-17）：透传
    };
    // 2026-05-15 P2-1 + v4.1.4：必填校验
    if (!payload.name) {
      window.alert('请填写【课程名称】。');
      return;
    }
    if (!payload.teacher) {
      window.alert('⚠ 请填写【任课教师】。\n\n如果不填，AI 生成进度表时可能编造虚构姓名（如"张静"）。');
      return;
    }
    if (!payload.className) {
      window.alert('⚠ 请填写【授课班级】。\n\n如果不填，AI 生成进度表时可能编造虚构班级（如"23 服装陈列 1 班"）。');
      return;
    }
    if (!payload.hoursPerSession || payload.hoursPerSession <= 0) {
      window.alert(
        '⚠ 请填写【每次课学时数】。\n\n' +
        '例：1 学时/次（单节排课）\n' +
        '    2 学时/次（双节连排，最常见）\n' +
        '    4 学时/次（大段连排）\n\n' +
        '这个值决定进度表共生成几次课。不填则无法生成进度表。'
      );
      return;
    }
    // P2（2026-05-17）：minutesPerHour 必填校验
    if (!payload.minutesPerHour || payload.minutesPerHour <= 0) {
      window.alert(
        '⚠ 请填写【每学时分钟数】（按你所在学校的实际标准）。\n\n' +
        '常见：\n' +
        '    40 分钟/学时（部分中职/中小学）\n' +
        '    45 分钟/学时（多数中职/高中/大学）\n' +
        '    50 分钟/学时（部分高校）\n\n' +
        '所有教学设计/讲稿/视频时长都按此换算，不填则无法生成。'
      );
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
      // B6：正式稿专用 endpoint（可选；空字符串也保存以便清空）
      api.saveApiKey('ark_endpoint_lecture_formal', (apiForm.arkLectureFormalEndpoint || '').trim()),
      api.saveApiKey('ark_endpoint_image', apiForm.arkImageEndpoint.trim()),
      api.saveApiKey('ark_endpoint', apiForm.arkImageEndpoint.trim()),
      api.saveApiKey('ark_endpoint_video_t2v', apiForm.arkVideoEndpoint.trim()),
      // v4.3.3 功能5+：声音复刻凭证（周老师真声朗读）
      api.saveApiKey('voice_clone_api_key', (apiForm.voiceCloneApiKey || '').trim()),
      api.saveApiKey('voice_clone_speaker_id', (apiForm.voiceCloneSpeakerId || '').trim()),
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

  // v4.3.3 D14（2026-05-18）：handleSaveRawJson 已删除（v3 framework raw JSON 编辑器入口，UI 早已下线，无 JSX 引用此函数）

  if (!isDesktop) {
    return <div className="v2-shell"><main className="v2-home"><div className="v2-placeholder">请在 Electron 桌面环境中运行。</div></main></div>;
  }

  return (
   <SessionProvider api={api} notebookId={selectedNotebookId}>
    <div className="v2-shell">
      <header className="v2-topbar">
        {/* v4.3.3 新版 · logo（绿底金马·驭字）替换文字 title */}
        <div className="v2-brand">
          <img src={logoSrc} alt="驭课 Agent" className="v2-brand-logo" draggable={false} />
          <h1>驭课 <span className="v2-title-agent">Agent</span> <span className="v2-title-version">v4.3.3</span></h1>
        </div>
        <div className="v2-topbar-actions">
          {/* Phase-7.7 A3：「教师日志」入口 */}
          <button className="v2-btn v2-btn-secondary" onClick={() => setShowWorkbench(true)} title="跨课程统计：你已开发的所有课程进度概览 + 经验沉淀">📊 教师日志</button>
          <button className="v2-btn v2-btn-secondary" onClick={() => { loadApiForm(); setShowApi(true); }} title="配置 AI 模型 API Key（豆包 / Ark）">API 配置</button>
          <button className="v2-btn v2-btn-primary" onClick={() => setShowCreate(true)}>新建教学进度表</button>
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
            {/* 2026-05-16 v4.2.0 Phase A：会话上下文面包屑 —— 全 stage 共享 */}
            {selectedNotebook && (currentStage === 'design' || currentStage === 'lecture' || currentStage === 'ppt' || currentStage === 'video' || currentStage === 'report') ? (
              <SessionBreadcrumb
                notebook={selectedNotebook}
                currentStage={currentStage}
                lessons={designLessons}
                onSwitchLesson={async (lessonNumber) => {
                  // 切节课后刷新所有 stage 数据
                  const res = await api.switchActiveLessonV2({ notebookId: selectedNotebookId, lessonNumber });
                  if (res?.success) {
                    await loadNotebookContext(selectedNotebookId);
                  }
                }}
              />
            ) : null}
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
                          {/* v4.3.3 功能4（老师反馈）：阶段卡老师卡通头像，点击弹该阶段功能介绍助手 */}
                          {stageAssistantAvatar(card.key) ? (
                            <img
                              src={stageAssistantAvatar(card.key)}
                              className="v2-stage-assistant-btn"
                              alt={stageAssistantTeacher(card.key)}
                              title={`${stageAssistantTeacher(card.key)}·点我看本阶段功能介绍`}
                              draggable={false}
                              onClick={(e) => { e.stopPropagation(); setAssistantStage(card.key); }}
                            />
                          ) : null}
                          {isGenerating
                            ? <span className="v2-step-badge v2-badge-generating">AI 生成中…</span>
                            : <span className={`v2-step-badge v2-badge-tone-${tone}`}>{card.state?.label || '未解锁'}</span>
                          }
                        </div>
                        <div className="v2-step-desc">
                          {isGenerating ? '正在调用 AI 生成，请稍候…' : (card.state?.detail || card.hint)}
                        </div>
                        {/* D9.3（2026-05-18）：质检卡住时显示「⚙ 强制解锁下游」按钮
                            条件：非 locked 且 ≤ video（report 没下游）且不是 completed-already-unlocked 的最末状态 */}
                        {!isLocked && card.key !== 'report' && card.key !== 'schedule'
                          && (stateKey === 'review_needed' || stateKey === 'completed' || stateKey === 'available') ? (
                          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleForceUnlockNext(card.key); }}
                              title="跳过质量门槛，强制让下游 stage 可点（适合质检误报或老师已确认通过的情况）"
                              style={{
                                fontSize: 10, padding: '2px 8px',
                                background: 'transparent',
                                border: '1px dashed #94a3b8',
                                color: '#64748b',
                                borderRadius: 3,
                                cursor: 'pointer',
                              }}
                            >⚙ 强制解锁下游</button>
                          </div>
                        ) : null}
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
                    {ENABLE_AGENT_UI && (
                      <div className="v2-block-alert-actions">
                        <button className="v2-btn-agent-danger" onClick={handleAgentRun} disabled={agentBusy || busy}>
                          {agentBusy ? '⏳ 运行中…' : '🤖 Agent 一键生成'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* ── 工作区双栏：运行时 + Agent 面板 ── */}
            {/*
             * Phase-9.5 决策（2026-05-11）：
             * lecture 阶段也隐藏老 runtime 面板——v4.0.0 多节课模式下旧 validateLectureStage 用
             * notebook.totalHours = 72 校验，会错误提示"72 学时建议 158400-216000 字"。
             * 多节课的质量校验已由 reviewAndRevise（9 维度审核）+ retry-loop 各节独立处理。
             * 仅 PPT 阶段保留旧 runtime（仍是整门课级别）。
             */}
            {(currentStage === 'ppt') ? (
            <div className="v2-workspace-grid">
              {/* P6（2026-05-18）：「阶段运行时」面板默认折叠 → 让主操作区直接在顶部
                  原本它在顶部占大块空间，老师反馈"占位这么大"+"建议放下方"。
                  改用 <details> 默认 closed，老师按需展开查看运行时诊断。 */}
              <section className="v2-runtime-summary">
                <details>
                <summary style={{ cursor: 'pointer', padding: '8px 12px', listStyle: 'revert', fontSize: 13, color: '#475569' }}>
                  📊 阶段运行时诊断（{arr(currentRuntimeMeta.quality?.errors).length} 阻塞 · {arr(currentRuntimeMeta.quality?.warnings).length} 提示 · 默认折叠，点开查看详情）
                </summary>
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
                        : (currentRuntimeMeta.quality?.reviewNeeded ? '可继续·有改进建议' : '可继续')}
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
                </details>
              </section>

              {/* 右栏：Agent 智能生成面板（A3：用 ENABLE_AGENT_UI 总开关包住，false 时隐藏整个面板）*/}
              {ENABLE_AGENT_UI && (
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

                  {/* 运行按钮：根据已 confirmed 阶段动态调整文案，让老师明白支持"续跑" */}
                  <button
                    className="v2-btn-agent v2-btn-agent-full"
                    onClick={handleAgentRun}
                    disabled={agentBusy || busy}
                  >
                    {agentBusy
                      ? '⏳ 运行中，请稍候…'
                      : (unlockedStages.length > 1
                          ? `🔄 续跑剩余阶段（已完成 ${unlockedStages.length - 1}/3）`
                          : '🚀 一键生成全部阶段')}
                  </button>

                  {/* B15：加说明文字，让老师明白 Agent 会自动跳过已确认的阶段 */}
                  <p className="v2-field-note" style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
                    💡 Agent 会自动跳过已确认的阶段，从中断处继续。手工编辑后点【确认】即可加入"已完成"队列。
                  </p>

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
              )}
            </div>
            ) : null}

            {/* P1.1d 删除（2026-05-17）：currentStage === 'framework' 渲染段 → v3 framework 已下线
                老 notebook 的 currentStage='framework' 已在前面行 1131 矫正为 'schedule'，本段为死代码 */}

            {currentStage === 'lecture' ? (
              <LectureStage
                selectedNotebookId={selectedNotebookId}
                api={api}
                assistantStatus={assistantStatus}
                setAssistantStatus={setAssistantStatus}
                busy={busy}
                courseName={selectedNotebook?.name || ''}
                totalCourseHours={Number(selectedNotebook?.totalHours) || 0}
                scheduleData={scheduleState?.schedule || null}
                designData={designState?.design || null}
                artifacts={lectureArtifacts}
                dt={dt}
                shorten={shorten}
              />
            ) : null}

            {currentStage === 'ppt' ? (
              <PptStage
                pptState={pptState}
                setPptState={setPptState}
                assistantStatus={assistantStatus}
                setAssistantStatus={setAssistantStatus}
                busy={busy}
                // D5.2：取消生成时通过 setBusyKey('') 间接重置 busy
                setBusy={(v) => { if (!v) setBusyKey(''); }}
                selectedNotebookId={selectedNotebookId}
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

            {/* v4.3.3 阶段 quiz：在线测验 */}
            {currentStage === 'quiz' ? (
              <QuizStage
                selectedNotebookId={selectedNotebookId}
                api={api}
                assistantStatus={assistantStatus}
                setAssistantStatus={setAssistantStatus}
                busy={busy}
                onStageDataChanged={() => loadNotebookContext(selectedNotebookId)}
              />
            ) : null}

            {/* v4.3.3 阶段 homework：课后作业 */}
            {currentStage === 'homework' ? (
              <HomeworkStage
                selectedNotebookId={selectedNotebookId}
                api={api}
                assistantStatus={assistantStatus}
                setAssistantStatus={setAssistantStatus}
                busy={busy}
                onStageDataChanged={() => loadNotebookContext(selectedNotebookId)}
              />
            ) : null}

            {/* Phase-9 阶段 video：替换为 MicroVideoStage（整套方案） */}
            {currentStage === 'video' ? (
              <MicroVideoStage
                microVideoState={microVideoState}
                setMicroVideoState={setMicroVideoState}
                assistantStatus={assistantStatus}
                busy={busy}
                handleGenerateMicroVideo={handleGenerateMicroVideo}
                handleSaveMicroVideo={handleSaveMicroVideo}
                handleConfirmMicroVideo={handleConfirmMicroVideo}
                handleOpenJimeng={handleOpenJimeng}
                handleCopyJimengPrompts={handleCopyJimengPrompts}
                artifacts={videoArtifacts}
                dt={dt}
                api={api}
                courseName={selectedNotebook?.name}
                notebookId={selectedNotebookId}
              />
            ) : null}

            {/* Phase-9：起点阶段 schedule */}
            {currentStage === 'schedule' ? (
              <ScheduleStage
                scheduleState={scheduleState}
                setScheduleState={setScheduleState}
                assistantStatus={assistantStatus}
                busy={busy}
                handleGenerateSchedule={handleGenerateSchedule}
                handleSaveSchedule={handleSaveSchedule}
                handleConfirmSchedule={handleConfirmSchedule}
                handleExportScheduleWord={handleExportScheduleWord}
                artifacts={scheduleArtifacts}
                dt={dt}
                api={api}
                courseName={selectedNotebook?.name}
              />
            ) : null}

            {/* Phase-9：design */}
            {currentStage === 'design' ? (
              <DesignStage
                designState={designState}
                setDesignState={setDesignState}
                assistantStatus={assistantStatus}
                busy={busy}
                handleGenerateDesign={handleGenerateDesign}
                handleSaveDesign={handleSaveDesign}
                handleConfirmDesign={handleConfirmDesign}
                handleExportDesignWord={handleExportDesignWord}
                handleGenerateDesignInfographic={handleGenerateDesignInfographic}
                scheduleData={scheduleState?.schedule}
                lessons={designLessons}
                currentLessonId={designState.artifactId}
                onSwitchLesson={switchDesignLesson}
                onNewLesson={newDesignLesson}
                onDeleteLesson={deleteDesignLesson}
                onRestoreLesson={restoreDesignLesson}
                selectedNotebookId={selectedNotebookId}
                courseTotalHours={selectedNotebook?.totalHours || 0}
                totalAccumulatedHours={designAccumulatedHours}
                totalDesignedHours={designDesignedHours}
                handleConfirmInfographic={async (artifactId) => {
                  const r = await api.confirmStageInfographicV2({ notebookId: selectedNotebookId, artifactId });
                  if (r?.success) {
                    setAssistantStatus('✅ 已标记为最终版（导出 Word 将用这张）');
                    await loadNotebookContext(selectedNotebookId);
                  } else {
                    window.alert(`标记失败：${r?.error || '未知'}`);
                  }
                }}
                toLocalImgSrc={toLocalImgSrc}
                artifacts={designArtifacts}
                dt={dt}
                api={api}
                courseName={selectedNotebook?.name}
              />
            ) : null}

            {/* Phase-9：最终阶段 report */}
            {currentStage === 'report' ? (
              <ReportStage
                reportState={reportState}
                setReportState={setReportState}
                assistantStatus={assistantStatus}
                busy={busy}
                handleGenerateReport={handleGenerateReport}
                handleSaveReport={handleSaveReport}
                handleConfirmReport={handleConfirmReport}
                handleExportReport={handleExportReport}
                artifacts={reportArtifacts}
                dt={dt}
                api={api}
                courseName={selectedNotebook?.name}
              />
            ) : null}
          </main>
        </div>
      )}

      {/* v4.3.3 功能4：阶段卡卡通老师助手对话框 */}
      {assistantStage ? (
        <StageAssistant stage={assistantStage} onClose={() => setAssistantStage(null)} />
      ) : null}

      {showCreate ? (
        <div className="v2-modal-mask">
          <div className="v2-modal">
            <div className="v2-panel-head">
              <h3>新建教学进度表</h3>
              <button className="v2-btn v2-btn-xs" onClick={() => setShowCreate(false)}>关闭</button>
            </div>
            <div className="v2-status-box">
              <span>说明</span>
              <strong>
                填完表头，AI 会从你上传的课程标准素材中**实时识别**章节结构 / 教学方法 / 重难点 / 实训类目，
                按【总学时 ÷ 每次课学时】算出实际次课数（如 72÷4=18 次、48÷2=24 次、144÷4=36 次），
                作为后续 6 个阶段（教学设计 / 课件 / 讲稿 / 互动+作业 / 视频 / 报告）的统一骨架。
                <br/><span style={{ color: '#dc2626' }}>⚠ 字段全部按你的真实情况填，AI 严格使用你的输入，不再用任何固定模板（H14 反编造铁律）。</span>
              </strong>
            </div>

            <div className="v2-section-divider"><span>① 进度表表头（必填）</span></div>
            <div className="v2-grid-two">
              <div>
                <label className="v2-label">
                  课程名称 <span style={{ color: '#dc2626', fontWeight: 600 }}>*</span>
                  <span className="v2-label-hint">如：服装产品传播</span>
                </label>
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  style={!createForm.name?.trim() ? { borderColor: '#fca5a5', background: '#fef2f2' } : {}}
                />
              </div>
              <div>
                {/* 2026-05-15 P2-1：标红必填，避免后续 AI 编"张静"等假名 */}
                <label className="v2-label">
                  任课教师 <span style={{ color: '#dc2626', fontWeight: 600 }}>*</span>
                  <span className="v2-label-hint" style={{ color: '#9a3412' }}>不填则 AI 可能编造姓名</span>
                </label>
                <input
                  value={createForm.teacher}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, teacher: e.target.value }))}
                  placeholder="如：王老师 / 李教授（必填，按你的真实姓名）"
                  style={!createForm.teacher?.trim() ? { borderColor: '#fca5a5', background: '#fef2f2' } : {}}
                />
              </div>
              <div>
                <label className="v2-label">学校简称</label>
                <input value={createForm.school} onChange={(e) => setCreateForm((prev) => ({ ...prev, school: e.target.value }))} placeholder="按你的真实学校简称填，如：广州纺校 / 中山火炬 / 深圳信息职院" />
              </div>
              <div>
                <label className="v2-label">教学部</label>
                <input value={createForm.department} onChange={(e) => setCreateForm((prev) => ({ ...prev, department: e.target.value }))} placeholder="按你的真实部门填，如：服装科 / 信息工程系 / 经济管理学院" />
              </div>
              <div>
                <label className="v2-label">学期</label>
                <input value={createForm.semester} onChange={(e) => setCreateForm((prev) => ({ ...prev, semester: e.target.value }))} placeholder="如：2024-2025学年 第二学期" />
              </div>
              <div>
                {/* 2026-05-15 P2-1：标红必填 */}
                <label className="v2-label">
                  授课班级 <span style={{ color: '#dc2626', fontWeight: 600 }}>*</span>
                  <span className="v2-label-hint" style={{ color: '#9a3412' }}>不填则 AI 可能编造班级</span>
                </label>
                <input
                  value={createForm.className}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, className: e.target.value }))}
                  placeholder="按你的真实班级填，如：23级流行资讯班 / 22级电商运营 / 24级数字媒体"
                  style={!createForm.className?.trim() ? { borderColor: '#fca5a5', background: '#fef2f2' } : {}}
                />
              </div>
              <div>
                <label className="v2-label">教材<span className="v2-label-hint">填写后 AI 会按教材体系编排</span></label>
                <input value={createForm.textbook} onChange={(e) => setCreateForm((prev) => ({ ...prev, textbook: e.target.value }))} placeholder="如：《时尚传播学》" />
              </div>
              <div>
                <label className="v2-label">
                  总学时 <span style={{ color: '#dc2626', fontWeight: 600 }}>*</span>
                  <span className="v2-label-hint">由 AI 从你上传的课标素材识别 / 也可手填校对，禁止编造</span>
                </label>
                <input
                  type="number"
                  value={createForm.totalHours ?? ''}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, totalHours: e.target.value }))}
                  placeholder="如：72（按课程标准实填，不要写默认数）"
                  style={!createForm.totalHours ? { borderColor: '#fca5a5', background: '#fef2f2' } : {}}
                />
              </div>
              <div>
                {/* 2026-05-15 v4.1.4：每次课学时数 — 自定义输入，必填，无默认 */}
                <label className="v2-label">
                  每次课学时 <span style={{ color: '#dc2626', fontWeight: 600 }}>*</span>
                  <span className="v2-label-hint">如 1 / 2 / 3 / 4，决定进度表生成几次课</span>
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={createForm.hoursPerSession ?? ''}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, hoursPerSession: e.target.value }))}
                  placeholder="如：2"
                  style={!createForm.hoursPerSession ? { borderColor: '#fca5a5', background: '#fef2f2' } : {}}
                />
                {createForm.totalHours && Number(createForm.hoursPerSession) > 0 ? (
                  <div style={{ marginTop: 4, padding: '4px 8px', background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 4, fontSize: 12, color: '#1e40af' }}>
                    📊 将生成 <strong>{Math.floor(Number(createForm.totalHours) / Number(createForm.hoursPerSession))}</strong> 次课
                    （{createForm.totalHours} 学时 ÷ {createForm.hoursPerSession} 学时/次）
                  </div>
                ) : null}
              </div>
              {/* P2（2026-05-17）：每学时分钟数 - 按学校标准 */}
              <div>
                <label className="v2-label">
                  每学时分钟数 <span style={{ color: '#dc2626', fontWeight: 600 }}>*</span>
                  <span className="v2-label-hint">按你所在学校标准（40/45/50 常见）</span>
                </label>
                <input
                  type="number"
                  step="5"
                  min="20"
                  max="120"
                  value={createForm.minutesPerHour ?? ''}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, minutesPerHour: e.target.value }))}
                  placeholder="如：40（部分中职）/ 45（多数中职/高中/大学）/ 50（部分高校）"
                  style={!createForm.minutesPerHour ? { borderColor: '#fca5a5', background: '#fef2f2' } : {}}
                />
                {createForm.hoursPerSession && createForm.minutesPerHour ? (
                  <div style={{ marginTop: 4, padding: '4px 8px', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 4, fontSize: 12, color: '#065f46' }}>
                    ⏱ 单次课时长：<strong>{Number(createForm.hoursPerSession) * Number(createForm.minutesPerHour)} 分钟</strong>
                  </div>
                ) : null}
              </div>
            </div>

            <label className="v2-label">课程描述<span className="v2-label-hint">本课程定位、内容范围、能力培养目标</span></label>
            <textarea rows={3} value={createForm.description} onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="简要描述本课程的定位、内容范围和能力培养目标（也可写先修课程要求）" />

            <div className="v2-section-divider">
              <span>② 课程特征（填写越详细，8 阶段 AI 生成质量越高）</span>
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
                  课程标准（可选）
                  <span className="v2-label-hint">AI 生成 8 阶段产物时优先对齐该标准（教材已在上方填）</span>
                </label>
                <input
                  value={createForm.teachingMaterials}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, teachingMaterials: e.target.value }))}
                  placeholder="如：中职服装设计课程标准 2022"
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
              {/* 2026-05-15 P2-1 + v4.1.4：必填字段未填齐时按钮禁用 */}
              {(() => {
                const missing = [];
                if (!createForm.name?.trim()) missing.push('课程名称');
                if (!createForm.teacher?.trim()) missing.push('任课教师');
                if (!createForm.className?.trim()) missing.push('授课班级');
                if (!Number(createForm.hoursPerSession) || Number(createForm.hoursPerSession) <= 0) missing.push('每次课学时');
                const disabled = missing.length > 0;
                return (
                  <button
                    className="v2-btn v2-btn-primary"
                    onClick={createNotebook}
                    disabled={disabled}
                    title={disabled ? `还缺：${missing.join(' / ')}` : '创建并进入教学进度表'}
                  >
                    {disabled
                      ? `⚠ 请先填写：${missing.join(' / ')}`
                      : '创建并进入教学进度表阶段'}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      ) : null}

      {showEditCtx ? (
        <div className="v2-modal-mask">
          <div className="v2-modal">
            <div className="v2-panel-head">
              <h3>编辑课程上下文 + 表头信息</h3>
              <button className="v2-btn v2-btn-xs" onClick={() => setShowEditCtx(false)}>关闭</button>
            </div>
            <div className="v2-status-box">
              <span>说明</span>
              <strong>① 表头信息（教师/班级等）保存后立刻同步到右侧表头；<br/>② 课程上下文（软件/岗位等）让 AI 生成时使用真实信息。</strong>
            </div>

            {/* 2026-05-15 v4.1.4：新增"表头基本信息"块——解决创建时漏填后无法补的痛点 */}
            <div className="v2-section-divider"><span>① 表头基本信息（出现在右侧表头 + 进度表 Word 导出）</span></div>
            <div className="v2-grid-two">
              <div>
                <label className="v2-label">任课教师 <span style={{color:'#dc2626'}}>*</span></label>
                <input
                  value={editCtxForm.teacher || ''}
                  onChange={(e) => setEditCtxForm((prev) => ({ ...prev, teacher: e.target.value }))}
                  placeholder="如：王老师 / 李教授（必填，按你的真实姓名）"
                />
              </div>
              <div>
                <label className="v2-label">授课班级 <span style={{color:'#dc2626'}}>*</span></label>
                <input
                  value={editCtxForm.className || ''}
                  onChange={(e) => setEditCtxForm((prev) => ({ ...prev, className: e.target.value }))}
                  placeholder="按你的真实班级填，如：23级流行资讯班 / 22级电商运营 / 24级数字媒体"
                />
              </div>
              <div>
                <label className="v2-label">教学部</label>
                <input
                  value={editCtxForm.department || ''}
                  onChange={(e) => setEditCtxForm((prev) => ({ ...prev, department: e.target.value }))}
                  placeholder="按你的真实部门填，如：服装科 / 信息工程系 / 经济管理学院"
                />
              </div>
              <div>
                <label className="v2-label">学期</label>
                <input
                  value={editCtxForm.semester || ''}
                  onChange={(e) => setEditCtxForm((prev) => ({ ...prev, semester: e.target.value }))}
                  placeholder="如：2025-2026 学年 第一学期"
                />
              </div>
              <div>
                <label className="v2-label">学校简称</label>
                <input
                  value={editCtxForm.school || ''}
                  onChange={(e) => setEditCtxForm((prev) => ({ ...prev, school: e.target.value }))}
                  placeholder="如：广州纺校 / 中山火炬"
                />
              </div>
              <div>
                <label className="v2-label">总学时 <span style={{ color: '#dc2626', fontWeight: 600 }}>*</span></label>
                <input
                  type="number"
                  min="1"
                  value={editCtxForm.totalHours ?? ''}
                  onChange={(e) => setEditCtxForm((prev) => ({ ...prev, totalHours: e.target.value }))}
                  placeholder="如：72（按课程标准实填，禁止编造）"
                />
              </div>
              <div>
                {/* 2026-05-15 v4.1.4：每次课学时数 */}
                <label className="v2-label">
                  每次课学时 <span style={{ color: '#dc2626', fontWeight: 600 }}>*</span>
                  <span className="v2-label-hint">改后下次重新生成才生效</span>
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={editCtxForm.hoursPerSession ?? ''}
                  onChange={(e) => setEditCtxForm((prev) => ({ ...prev, hoursPerSession: e.target.value }))}
                  placeholder="如：2"
                />
                {editCtxForm.totalHours && Number(editCtxForm.hoursPerSession) > 0 ? (
                  <div style={{ marginTop: 4, padding: '4px 8px', background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 4, fontSize: 12, color: '#1e40af' }}>
                    📊 重新生成时将产生 <strong>{Math.floor(Number(editCtxForm.totalHours) / Number(editCtxForm.hoursPerSession))}</strong> 次课
                  </div>
                ) : null}
              </div>
              {/* P2（2026-05-17）：每学时分钟数 */}
              <div>
                <label className="v2-label">
                  每学时分钟数 <span style={{ color: '#dc2626', fontWeight: 600 }}>*</span>
                  <span className="v2-label-hint">学校标准（40/45/50）</span>
                </label>
                <input
                  type="number"
                  step="5"
                  min="20"
                  max="120"
                  value={editCtxForm.minutesPerHour ?? ''}
                  onChange={(e) => setEditCtxForm((prev) => ({ ...prev, minutesPerHour: e.target.value }))}
                  placeholder="40 / 45 / 50"
                />
              </div>
            </div>
            <label className="v2-label">教材（可选）</label>
            <input
              value={editCtxForm.textbook || ''}
              onChange={(e) => setEditCtxForm((prev) => ({ ...prev, textbook: e.target.value }))}
              placeholder="如：《时尚传播学》"
            />

            <div className="v2-section-divider"><span>② 课程上下文（影响 AI 生成内容的真实度）</span></div>

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
              <button className="v2-btn v2-btn-primary" onClick={saveEditCtx}>💾 保存表头 + 上下文</button>
              <button className="v2-btn v2-btn-secondary" onClick={() => setShowEditCtx(false)}>取消</button>
            </div>
            <p className="v2-hint" style={{ marginTop: 6, fontSize: 11 }}>
              💡 保存后：表头字段（教师/班级等）立刻同步到当前进度表 + 右侧表头；上下文字段（软件/岗位等）在下次重新生成时生效。
            </p>
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
            <p className="v2-field-note">用于教学框架、讲稿草稿、PPT 文案、信息图文案、Vision 审核等文本生成任务。一般填写 `ep-...` 形式的多模态文本模型端点（如 doubao-seed-2.0-pro）。</p>
            <input
              value={apiForm.arkTextEndpoint}
              placeholder="例如：ep-xxxxxxxx-text"
              onChange={(e) => setApiForm((prev) => ({ ...prev, arkTextEndpoint: e.target.value }))}
            />
            <label className="v2-label">2.1 正式稿专用 Endpoint <span style={{ fontWeight: 'normal', color: '#888' }}>(可选)</span></label>
            <p className="v2-field-note">
              专门用于<strong>正式讲演稿生成</strong>这一项任务。建议填写更快/更便宜的非 reasoning 文本模型（如 <code>doubao-1.5-pro-32k</code>），避免 reasoning model 推理过慢或触发 burst 限流。
              <br/>
              <strong>留空时</strong>：所有文本任务（含正式稿）共用上方「2. 文本类 Endpoint」。
            </p>
            <input
              value={apiForm.arkLectureFormalEndpoint || ''}
              placeholder="可选，例如：ep-xxxxxxxx（doubao-1.5-pro 等）"
              onChange={(e) => setApiForm((prev) => ({ ...prev, arkLectureFormalEndpoint: e.target.value }))}
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

            {/* v4.3.3 功能5+：声音复刻（周老师真声朗读讲稿选段）*/}
            <label className="v2-label" style={{ marginTop: 16 }}>5. 声音复刻 · API Key（讲稿"真声朗读"用，可选）</label>
            <p className="v2-field-note">火山引擎「语音技术 → 声音复刻」控制台 →「API 调用」里的 x-api-key（UUID）。不填则讲稿朗读只用系统音色。</p>
            <input
              value={apiForm.voiceCloneApiKey}
              placeholder="例如：1c85da94-96d8-43e2-aedf-..."
              onChange={(e) => setApiForm((prev) => ({ ...prev, voiceCloneApiKey: e.target.value }))}
            />
            <label className="v2-label" style={{ marginTop: 12 }}>6. 声音复刻 · 音色 ID（Speaker ID）</label>
            <p className="v2-field-note">声音复刻控制台训练后得到的音色 ID（S_ 开头）。例如周老师音色 S_xxxxxxx。</p>
            <input
              value={apiForm.voiceCloneSpeakerId}
              placeholder="例如：S_zxFSBjj42"
              onChange={(e) => setApiForm((prev) => ({ ...prev, voiceCloneSpeakerId: e.target.value }))}
            />

            <div className="v2-inline-actions">
              <button className="v2-btn v2-btn-primary" onClick={saveApiFormAction}>保存设置</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* P1.1d 删除（2026-05-17）：WorkflowPauseModal 已删（Agent 自动模式下线）*/}

      {/* Phase-7.7 A3：教师日志 */}
      {showWorkbench && (
        <MyWorkbench
          api={api}
          onClose={() => setShowWorkbench(false)}
          onOpenNotebook={(notebookId, targetStage) => {
            // 2026-05-16 v4.2.0 Phase A：工作台跳转支持指定 stage
            setSelectedNotebookId(notebookId);
            setShowWorkbench(false);
            // 如果指定了 stage（来自历史 artifact 跳转）→ 切到该 stage
            if (targetStage) {
              setTimeout(() => {
                if (typeof selectStage === 'function') {
                  selectStage(targetStage).catch(() => { /* ignore */ });
                }
              }, 200);  // 等 notebook 加载完
            }
          }}
        />
      )}

      {/* Phase-8 M0+：URL 抓取失败列表（替代原 alert）*/}
      {refFetchErrors.length > 0 && (
        <div className="v2-modal" onClick={() => setRefFetchErrors([])}>
          <div className="v2-modal-content" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', color: '#b45309' }}>
              ⚠️ {refFetchErrors.length} 个 URL 读取失败
            </h3>
            <p style={{ margin: '0 0 16px', color: '#475569', fontSize: 14 }}>
              下方每个 URL 都给出了具体应对建议。点「🌐 在浏览器打开」可直接打开页面手动复制内容。
            </p>
            <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 8 }}>
              {refFetchErrors.map((err, idx) => {
                const kindBadge = {
                  timeout: { label: '⏱ 加载超时', color: '#b45309', bg: '#fef3c7' },
                  login_wall: { label: '🔒 需登录', color: '#b91c1c', bg: '#fee2e2' },
                  render_error: { label: '🚫 渲染失败', color: '#b91c1c', bg: '#fee2e2' },
                  content_too_short: { label: '📭 内容过少', color: '#1e40af', bg: '#dbeafe' },
                  unknown: { label: '❓ 未知', color: '#475569', bg: '#f1f5f9' },
                }[err.kind || 'unknown'] || { label: '❓ 未知', color: '#475569', bg: '#f1f5f9' };

                return (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: 14,
                      marginBottom: 10,
                      background: '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span
                        style={{
                          background: kindBadge.bg,
                          color: kindBadge.color,
                          padding: '2px 10px',
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {kindBadge.label}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          color: '#1e293b',
                          fontFamily: 'Consolas, monospace',
                          wordBreak: 'break-all',
                          flex: 1,
                        }}
                      >
                        {err.url}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: '#475569',
                        lineHeight: 1.7,
                        whiteSpace: 'pre-wrap',
                        marginBottom: 10,
                        paddingLeft: 4,
                      }}
                    >
                      {err.message}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="v2-btn v2-btn-xs"
                        onClick={() => api.openExternalUrl(err.url)}
                        title="在系统默认浏览器中打开此页面"
                      >
                        🌐 在浏览器打开
                      </button>
                      <button
                        className="v2-btn v2-btn-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(err.url).then(
                            () => setAssistantStatus('URL 已复制到剪贴板'),
                            () => window.alert('复制失败，请手动选中复制')
                          );
                        }}
                      >
                        📋 复制 URL
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="v2-inline-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                className="v2-btn v2-btn-xs"
                onClick={() => {
                  // 一键把所有错误 URL 复制成纯文本
                  const text = refFetchErrors.map((e) => `${e.url}：${e.message}`).join('\n\n');
                  navigator.clipboard.writeText(text).then(
                    () => setAssistantStatus('错误信息已复制（可发回项目组反馈）'),
                    () => window.alert('复制失败')
                  );
                }}
              >
                📋 复制全部错误信息
              </button>
              <button className="v2-btn v2-btn-primary" onClick={() => setRefFetchErrors([])}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
   </SessionProvider>
  );
}
