/**
 * ppt-layouts.js — 7 个 AI 自主排版 layout 函数
 *
 * 2026-05-16 v4.1.4 Phase 2 新增。
 *
 * 设计目标：
 *   - AI 在 stage 2 输出 layoutType，每页一个；
 *   - 本文件按 layoutType 提供 6+1 个独立渲染函数，可被 ppt.js 的 addLectureSlides 分发调用；
 *   - 渲染函数读 page.accentColor / themeMode / 整门课主色，自动生成视觉一致的 slide；
 *   - 老师可在前端覆盖 layoutType / accentColor，重新导出。
 *
 * 设计约束（不要违反）：
 *   - 不调用 AI（H3：导出层独立）；
 *   - 不写 fs/path（除非取本地配图文件 path）；
 *   - 所有数值（坐标 / 字号 / 颜色）写成模块常量，方便后续微调；
 *   - 每个函数纯函数式：输入 slide / page / context，输出无（直接给 slide 添加元素）。
 *
 * 输入约定：
 *   slide      —— PptxGenJS slide 对象（已 addSlide）
 *   page       —— { pageType, title, subtitle, keyContent[], speakerNotes, dataPoint, caseExample,
 *                   interactionPrompt, imagePrompt, needImage, sourceSection,
 *                   layoutType, accentColor, themeMode, imagePath?, compositeImagePath? }
 *   ctx        —— { mainAccent: 'XXXXXX' (无 #), style: TEMPLATE_STYLE 对象, pageNumber, totalPages }
 */

const SLIDE = { w: 13.333, h: 7.5 };

// ── 颜色工具 ───────────────────────────────────────────────────────────────

/** 把 "#XXXXXX" / "XXXXXX" 统一成 6 位 hex（无 #），pptxgenjs 需要 */
function normHex(input, fallback = '2E86DE') {
  if (!input) return fallback;
  const s = String(input).replace(/^#/, '').trim();
  return /^[0-9A-Fa-f]{6}$/.test(s) ? s.toUpperCase() : fallback;
}

/** 调亮：每个通道 + amount，封顶 255 */
function lighten(hex, amount = 40) {
  const h = normHex(hex);
  const r = Math.min(255, parseInt(h.slice(0, 2), 16) + amount);
  const g = Math.min(255, parseInt(h.slice(2, 4), 16) + amount);
  const b = Math.min(255, parseInt(h.slice(4, 6), 16) + amount);
  return [r, g, b].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** 调暗：每个通道 - amount，下限 0 */
function darken(hex, amount = 40) {
  const h = normHex(hex);
  const r = Math.max(0, parseInt(h.slice(0, 2), 16) - amount);
  const g = Math.max(0, parseInt(h.slice(2, 4), 16) - amount);
  const b = Math.max(0, parseInt(h.slice(4, 6), 16) - amount);
  return [r, g, b].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** 取本页有效的 accent —— 优先 page.accentColor，否则用整门课主色 */
function pickAccent(page, mainAccent) {
  const pa = String(page?.accentColor || '').trim();
  if (pa && /^#?[0-9A-Fa-f]{6}$/.test(pa)) return normHex(pa);
  return normHex(mainAccent, '2E86DE');
}

/** 取本页主题色（dark / light），返回 { bg, fg, sub, panel } */
function pickThemeColors(page, mainAccent) {
  const isDark = page?.themeMode === 'dark';
  const accent = pickAccent(page, mainAccent);
  if (isDark) {
    return {
      bg: '0F172A',       // 深海军蓝
      fg: 'F8FAFC',       // 近白
      sub: 'CBD5E1',      // 浅蓝灰副字
      panel: '1E293B',    // 卡片底色
      accent,
      accentDim: lighten(accent, -30),
    };
  }
  return {
    bg: 'F8FAFC',
    fg: '0F172A',
    sub: '475569',
    panel: 'FFFFFF',
    accent,
    accentDim: lighten(accent, 80),
  };
}

// ── 通用工具 ───────────────────────────────────────────────────────────────

const DEFAULT_TITLE_FONT = '"Microsoft YaHei","PingFang SC",sans-serif';
const DEFAULT_BODY_FONT  = '"Microsoft YaHei","PingFang SC",sans-serif';

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function shorten(text, max = 60) {
  const t = clean(text);
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}…` : t;
}

function safeBullets(page, max = 5) {
  const arr = Array.isArray(page?.keyContent) ? page.keyContent : [];
  return arr.map(clean).filter(Boolean).slice(0, max);
}

/**
 * 应用本页底色 —— 所有 layout 共用第一步
 *  确保整页底色一致，避免 pptx 默认白边
 */
function applyPageBackground(slide, theme) {
  slide.background = { color: theme.bg };
}

/**
 * 顶部 accent kicker —— 6 像素高的左侧色条 + 课程信息小字
 * 用于 light theme 教学页
 */
function addTopKicker(slide, theme, pageNumber, totalPages) {
  slide.addShape('rect', {
    x: 0, y: 0, w: 0.18, h: 0.6,
    fill: { color: theme.accent }, line: { color: theme.accent },
  });
  if (pageNumber && totalPages) {
    slide.addText(`${String(pageNumber).padStart(2, '0')} / ${totalPages}`, {
      x: SLIDE.w - 1.0, y: 0.18, w: 0.9, h: 0.35,
      fontSize: 10, color: theme.sub, fontFace: DEFAULT_BODY_FONT,
      align: 'right', valign: 'middle',
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// LAYOUT 1: hero —— 封面 / 谢谢 / 总结收束
//   ┌─────────────────────────┐
//   │                         │
//   │  [大字主标题]            │
//   │  ─── (accent 横线)       │
//   │  副标题                  │
//   │                         │
//   │              [装饰色块]   │
//   └─────────────────────────┘
// ──────────────────────────────────────────────────────────────────────────
function renderHeroLayout(slide, page, ctx) {
  const theme = pickThemeColors(page, ctx.mainAccent);
  applyPageBackground(slide, theme);

  // 右下角装饰大色块（占 1/3 画布）—— hero 的视觉签名
  slide.addShape('rect', {
    x: SLIDE.w - 4.5, y: SLIDE.h - 4.0, w: 4.5, h: 4.0,
    fill: { color: theme.accent }, line: { color: theme.accent },
  });
  // 装饰色块上的几何点缀
  slide.addShape('ellipse', {
    x: SLIDE.w - 1.2, y: SLIDE.h - 1.2, w: 0.9, h: 0.9,
    fill: { color: theme.bg, transparency: 30 }, line: { type: 'none' },
  });

  // 主标题 —— 左对齐，64px 加粗
  slide.addText(clean(page.title) || '本节课', {
    x: 0.7, y: SLIDE.h * 0.32, w: SLIDE.w - 5.5, h: 1.4,
    fontSize: 44, bold: true, color: theme.fg,
    fontFace: DEFAULT_TITLE_FONT, valign: 'bottom', align: 'left',
  });

  // accent 横线 —— 标题下方
  slide.addShape('line', {
    x: 0.7, y: SLIDE.h * 0.55, w: 1.6, h: 0.02,
    line: { color: theme.accent, width: 4 },
  });

  // 副标题
  const sub = clean(page.subtitle) || clean(page.interactionPrompt) || '';
  if (sub) {
    slide.addText(shorten(sub, 80), {
      x: 0.7, y: SLIDE.h * 0.58, w: SLIDE.w - 5.5, h: 0.6,
      fontSize: 16, color: theme.sub, fontFace: DEFAULT_BODY_FONT,
      valign: 'top', align: 'left',
    });
  }

  // 底部品牌条
  slide.addText(`第 ${ctx.pageNumber || 1} 页 · 共 ${ctx.totalPages || 1} 页`, {
    x: 0.7, y: SLIDE.h - 0.45, w: 4.0, h: 0.3,
    fontSize: 10, color: theme.sub, fontFace: DEFAULT_BODY_FONT, align: 'left',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// LAYOUT 2: two-column —— 知识讲解 / 案例展示（标准内容页）
//   ┌─────────────────────────┐
//   │ [Kicker]  [Title]        │
//   │ ─── (accent line) ────── │
//   │ ┌──────────┬──────────┐ │
//   │ │ Bullets  │ Image /  │ │
//   │ │ • 要点 1 │ DataCard │ │
//   │ │ • 要点 2 │          │ │
//   │ └──────────┴──────────┘ │
//   └─────────────────────────┘
// ──────────────────────────────────────────────────────────────────────────
function renderTwoColumnLayout(slide, page, ctx) {
  const theme = pickThemeColors(page, ctx.mainAccent);
  applyPageBackground(slide, theme);
  addTopKicker(slide, theme, ctx.pageNumber, ctx.totalPages);

  // 标题区 —— 顶部
  slide.addText(clean(page.title), {
    x: 0.6, y: 0.5, w: SLIDE.w - 1.2, h: 0.9,
    fontSize: 28, bold: true, color: theme.fg,
    fontFace: DEFAULT_TITLE_FONT, valign: 'middle', align: 'left',
  });
  // accent 分割线
  slide.addShape('line', {
    x: 0.6, y: 1.55, w: SLIDE.w - 1.2, h: 0.02,
    line: { color: theme.accent, width: 2 },
  });
  // 副标题
  if (page.subtitle) {
    slide.addText(clean(page.subtitle), {
      x: 0.6, y: 1.62, w: SLIDE.w - 1.2, h: 0.4,
      fontSize: 13, italic: true, color: theme.sub,
      fontFace: DEFAULT_BODY_FONT, align: 'left',
    });
  }

  // 左列 bullet 区
  const bullets = safeBullets(page, 5);
  const leftX = 0.6, leftW = 6.3, contentY = 2.2, contentH = 4.6;
  bullets.forEach((b, i) => {
    const itemY = contentY + i * (contentH / Math.max(bullets.length, 1));
    const itemH = (contentH / Math.max(bullets.length, 1)) - 0.1;
    // 圆点
    slide.addShape('ellipse', {
      x: leftX, y: itemY + (itemH / 2) - 0.07, w: 0.14, h: 0.14,
      fill: { color: theme.accent }, line: { type: 'none' },
    });
    slide.addText(shorten(b, 80), {
      x: leftX + 0.3, y: itemY, w: leftW - 0.3, h: itemH,
      fontSize: 15, color: theme.fg, fontFace: DEFAULT_BODY_FONT,
      valign: 'middle', align: 'left',
    });
  });

  // 右列 ── 优先放数据卡 / 案例卡 / 配图
  const rightX = 7.2, rightW = SLIDE.w - rightX - 0.6, rightY = 2.2, rightH = 4.6;
  const hasImage = page.imagePath || page.compositeImagePath;
  if (hasImage && require('fs').existsSync(String(hasImage))) {
    slide.addImage({
      path: String(hasImage),
      x: rightX, y: rightY, w: rightW, h: rightH,
      sizing: { type: 'cover', x: 0, y: 0, w: rightW, h: rightH },
    });
  } else if (page.dataPoint || page.caseExample) {
    // 数据卡 + 案例卡
    let cardY = rightY;
    if (page.dataPoint) {
      const cardH = page.caseExample ? rightH * 0.45 : rightH;
      slide.addShape('roundRect', {
        x: rightX, y: cardY, w: rightW, h: cardH,
        fill: { color: theme.panel }, line: { color: theme.accent, width: 1 },
        rectRadius: 0.1,
      });
      slide.addText('📊 数据', {
        x: rightX + 0.2, y: cardY + 0.15, w: 1.2, h: 0.3,
        fontSize: 11, color: theme.accent, fontFace: DEFAULT_BODY_FONT, bold: true,
      });
      slide.addText(shorten(page.dataPoint, 60), {
        x: rightX + 0.2, y: cardY + 0.5, w: rightW - 0.4, h: cardH - 0.6,
        fontSize: 18, color: theme.fg, fontFace: DEFAULT_TITLE_FONT, bold: true,
        valign: 'middle', align: 'left',
      });
      cardY += cardH + 0.15;
    }
    if (page.caseExample) {
      const cardH = rightY + rightH - cardY;
      slide.addShape('roundRect', {
        x: rightX, y: cardY, w: rightW, h: cardH,
        fill: { color: theme.accentDim }, line: { color: theme.accent, width: 1 },
        rectRadius: 0.1,
      });
      slide.addText('💡 案例', {
        x: rightX + 0.2, y: cardY + 0.15, w: 1.2, h: 0.3,
        fontSize: 11, color: theme.accent, fontFace: DEFAULT_BODY_FONT, bold: true,
      });
      slide.addText(shorten(page.caseExample, 100), {
        x: rightX + 0.2, y: cardY + 0.5, w: rightW - 0.4, h: cardH - 0.6,
        fontSize: 14, color: theme.fg, fontFace: DEFAULT_BODY_FONT,
        valign: 'top', align: 'left',
      });
    }
  } else {
    // 啥都没 → 大字 quote 浮在右侧（来自 interactionPrompt）
    if (page.interactionPrompt) {
      slide.addText(shorten(page.interactionPrompt, 120), {
        x: rightX, y: rightY + 0.5, w: rightW, h: rightH - 1.0,
        fontSize: 22, italic: true, color: theme.sub,
        fontFace: DEFAULT_BODY_FONT, valign: 'middle', align: 'center',
      });
    }
  }

  // 底部互动提示 chip
  if (page.interactionPrompt && (hasImage || page.dataPoint || page.caseExample)) {
    slide.addText(`💬 ${shorten(page.interactionPrompt, 60)}`, {
      x: 0.6, y: SLIDE.h - 0.55, w: SLIDE.w - 1.2, h: 0.4,
      fontSize: 11, color: theme.sub, italic: true,
      fontFace: DEFAULT_BODY_FONT, align: 'left',
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// LAYOUT 3: image-bleed —— 课程导入 / 模块导入（沉浸式入场）
//   ┌─────────────────────────┐
//   │                         │
//   │        [全屏图]          │
//   │   ┌──────────┐           │
//   │   │ Title    │           │
//   │   │ Subtitle │           │
//   │   └──────────┘           │
//   └─────────────────────────┘
// ──────────────────────────────────────────────────────────────────────────
function renderImageBleedLayout(slide, page, ctx) {
  const theme = pickThemeColors({ ...page, themeMode: 'dark' }, ctx.mainAccent);  // bleed 强制 dark
  applyPageBackground(slide, theme);

  const imgPath = page.compositeImagePath || page.imagePath;
  if (imgPath && require('fs').existsSync(String(imgPath))) {
    slide.addImage({
      path: String(imgPath),
      x: 0, y: 0, w: SLIDE.w, h: SLIDE.h,
      sizing: { type: 'cover', x: 0, y: 0, w: SLIDE.w, h: SLIDE.h },
    });
    // 渐变浮层（左下到右上半透明）
    slide.addShape('rect', {
      x: 0, y: SLIDE.h * 0.45, w: SLIDE.w, h: SLIDE.h * 0.55,
      fill: { color: '000000', transparency: 50 }, line: { type: 'none' },
    });
  } else {
    // 没图 → 大渐变背景
    slide.addShape('rect', {
      x: 0, y: 0, w: SLIDE.w, h: SLIDE.h,
      fill: { color: theme.accent }, line: { type: 'none' },
    });
    slide.addShape('rect', {
      x: 0, y: SLIDE.h * 0.5, w: SLIDE.w, h: SLIDE.h * 0.5,
      fill: { color: '000000', transparency: 40 }, line: { type: 'none' },
    });
  }

  // 文字浮层 —— 左下角
  // 左侧 accent 竖线
  slide.addShape('rect', {
    x: 0.6, y: SLIDE.h - 3.0, w: 0.08, h: 2.4,
    fill: { color: theme.accent }, line: { type: 'none' },
  });
  // 标题
  slide.addText(clean(page.title), {
    x: 0.9, y: SLIDE.h - 3.0, w: SLIDE.w - 1.5, h: 1.4,
    fontSize: 40, bold: true, color: 'FFFFFF',
    fontFace: DEFAULT_TITLE_FONT, valign: 'top', align: 'left',
  });
  // 副标题
  const sub = clean(page.subtitle) || clean(page.interactionPrompt) || '';
  if (sub) {
    slide.addText(shorten(sub, 100), {
      x: 0.9, y: SLIDE.h - 1.5, w: SLIDE.w - 1.5, h: 0.6,
      fontSize: 16, color: 'E2E8F0', fontFace: DEFAULT_BODY_FONT,
      valign: 'top', align: 'left',
    });
  }
  // 页码
  slide.addText(`${String(ctx.pageNumber || 1).padStart(2, '0')}`, {
    x: SLIDE.w - 1.2, y: 0.4, w: 0.8, h: 0.4,
    fontSize: 14, color: 'FFFFFF', fontFace: DEFAULT_BODY_FONT,
    align: 'right',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// LAYOUT 4: diagram-center —— 路线图 / 操作步骤
//   ┌─────────────────────────┐
//   │ [Title]                  │
//   │ ──────────────────────── │
//   │  ① ─→ ② ─→ ③ ─→ ④ ─→ ⑤ │
//   │  步骤  步骤  步骤  步骤  步骤 │
//   └─────────────────────────┘
// ──────────────────────────────────────────────────────────────────────────
function renderDiagramCenterLayout(slide, page, ctx) {
  const theme = pickThemeColors(page, ctx.mainAccent);
  applyPageBackground(slide, theme);
  addTopKicker(slide, theme, ctx.pageNumber, ctx.totalPages);

  // 标题
  slide.addText(clean(page.title), {
    x: 0.6, y: 0.5, w: SLIDE.w - 1.2, h: 0.9,
    fontSize: 28, bold: true, color: theme.fg,
    fontFace: DEFAULT_TITLE_FONT, valign: 'middle', align: 'left',
  });
  slide.addShape('line', {
    x: 0.6, y: 1.55, w: SLIDE.w - 1.2, h: 0.02,
    line: { color: theme.accent, width: 2 },
  });

  // 步骤圆环 —— 水平流程链
  const steps = safeBullets(page, 6);
  const count = steps.length;
  if (count === 0) return;
  const totalW = SLIDE.w - 1.2;
  const segW = totalW / count;
  const cy = 4.0;
  const stepColors = ['FBBF24', 'FB923C', '22C55E', '3B82F6', 'A855F7', 'EC4899'];

  steps.forEach((s, i) => {
    const cx = 0.6 + segW * i + segW / 2;
    const color = stepColors[i % stepColors.length];
    // 圆环
    slide.addShape('ellipse', {
      x: cx - 0.55, y: cy - 0.55, w: 1.1, h: 1.1,
      fill: { color }, line: { color: darken(color, 30), width: 2 },
    });
    // 圆内编号
    slide.addText(`${i + 1}`, {
      x: cx - 0.55, y: cy - 0.55, w: 1.1, h: 1.1,
      fontSize: 32, bold: true, color: 'FFFFFF',
      fontFace: DEFAULT_TITLE_FONT, valign: 'middle', align: 'center',
    });
    // 圆下方步骤名
    slide.addText(shorten(s, 30), {
      x: cx - segW / 2, y: cy + 0.75, w: segW, h: 1.0,
      fontSize: 13, color: theme.fg, fontFace: DEFAULT_BODY_FONT,
      valign: 'top', align: 'center', bold: true,
    });
    // 箭头（除最后一个）
    if (i < count - 1) {
      slide.addShape('rightArrow', {
        x: cx + 0.55 + 0.05, y: cy - 0.12, w: segW - 1.2, h: 0.24,
        fill: { color: theme.accent, transparency: 40 }, line: { type: 'none' },
      });
    }
  });

  // 底部互动提示
  if (page.interactionPrompt) {
    slide.addText(`💬 ${shorten(page.interactionPrompt, 80)}`, {
      x: 0.6, y: SLIDE.h - 0.55, w: SLIDE.w - 1.2, h: 0.4,
      fontSize: 11, color: theme.sub, italic: true,
      fontFace: DEFAULT_BODY_FONT, align: 'left',
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// LAYOUT 5: quote —— 课堂练习 / 金句 / 互动思考
//   ┌─────────────────────────┐
//   │                          │
//   │      "          (大引号)  │
//   │    大字单句                │
//   │      ─────                │
//   │      标签 / Author         │
//   │                          │
//   └─────────────────────────┘
// ──────────────────────────────────────────────────────────────────────────
function renderQuoteLayout(slide, page, ctx) {
  const theme = pickThemeColors({ ...page, themeMode: page.themeMode || 'light' }, ctx.mainAccent);
  applyPageBackground(slide, theme);

  // 整片淡色 accent 背景
  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE.w, h: SLIDE.h,
    fill: { color: theme.accent, transparency: 88 }, line: { type: 'none' },
  });

  // 左上角大引号装饰
  slide.addText('“', {
    x: 0.8, y: 0.6, w: 2.0, h: 2.0,
    fontSize: 180, color: theme.accent, fontFace: DEFAULT_TITLE_FONT, bold: true,
    valign: 'top', align: 'left',
  });

  // 引文（quote 主体）—— 来自 interactionPrompt 或 keyContent[0]
  const quote = clean(page.interactionPrompt) || clean(safeBullets(page, 1)[0]) || clean(page.title);
  slide.addText(shorten(quote, 120), {
    x: 1.8, y: SLIDE.h * 0.28, w: SLIDE.w - 3.6, h: 3.0,
    fontSize: 36, bold: true, color: theme.fg,
    fontFace: DEFAULT_TITLE_FONT, valign: 'middle', align: 'center',
  });

  // 横线
  slide.addShape('line', {
    x: SLIDE.w / 2 - 0.8, y: SLIDE.h - 2.0, w: 1.6, h: 0.02,
    line: { color: theme.accent, width: 3 },
  });

  // 标签
  slide.addText(clean(page.title), {
    x: 0, y: SLIDE.h - 1.7, w: SLIDE.w, h: 0.5,
    fontSize: 16, color: theme.accent, italic: true,
    fontFace: DEFAULT_BODY_FONT, align: 'center',
  });

  // 底部速记本提示
  if (page.speakerNotes) {
    slide.addText(`📝 ${shorten(page.speakerNotes, 80)}`, {
      x: 0.6, y: SLIDE.h - 0.6, w: SLIDE.w - 1.2, h: 0.4,
      fontSize: 10, color: theme.sub, fontFace: DEFAULT_BODY_FONT, align: 'left',
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// LAYOUT 6: table —— 验收标准 / 评分维度
//   ┌─────────────────────────┐
//   │ [Title]                  │
//   │ ──────────────────────── │
//   │ ┌────┬──────────┬──────┐│
//   │ │ 维度│ 标准      │ 占比 ││
//   │ ├────┼──────────┼──────┤│
//   │ │ ... │ ...      │ ...  ││
//   │ └────┴──────────┴──────┘│
//   └─────────────────────────┘
// ──────────────────────────────────────────────────────────────────────────
function renderTableLayout(slide, page, ctx) {
  const theme = pickThemeColors(page, ctx.mainAccent);
  applyPageBackground(slide, theme);
  addTopKicker(slide, theme, ctx.pageNumber, ctx.totalPages);

  // 标题
  slide.addText(clean(page.title), {
    x: 0.6, y: 0.5, w: SLIDE.w - 1.2, h: 0.9,
    fontSize: 28, bold: true, color: theme.fg,
    fontFace: DEFAULT_TITLE_FONT, valign: 'middle', align: 'left',
  });
  slide.addShape('line', {
    x: 0.6, y: 1.55, w: SLIDE.w - 1.2, h: 0.02,
    line: { color: theme.accent, width: 2 },
  });

  // 表头 + 表体
  const bullets = safeBullets(page, 6);
  if (bullets.length === 0) return;

  // 每条 bullet 按 "维度：标准" 拆分
  const rows = bullets.map((b, i) => {
    const m = b.match(/^(.+?)[:：](.+)$/);
    return m
      ? { dim: clean(m[1]), criterion: clean(m[2]), pct: '' }
      : { dim: `${i + 1}.`, criterion: clean(b), pct: '' };
  });

  const tx = 0.6, ty = 2.0, tw = SLIDE.w - 1.2;
  const headerH = 0.5;
  const rowH = Math.min(0.7, (SLIDE.h - ty - 1.0) / rows.length);
  const colWs = [tw * 0.25, tw * 0.65, tw * 0.1];

  // 表头
  slide.addShape('rect', {
    x: tx, y: ty, w: tw, h: headerH,
    fill: { color: theme.accent }, line: { type: 'none' },
  });
  ['评分维度', '验收标准 / 内容描述', '权重'].forEach((h, i) => {
    const cx = tx + colWs.slice(0, i).reduce((s, w) => s + w, 0);
    slide.addText(h, {
      x: cx, y: ty, w: colWs[i], h: headerH,
      fontSize: 13, bold: true, color: 'FFFFFF',
      fontFace: DEFAULT_TITLE_FONT, valign: 'middle', align: 'center',
    });
  });
  // 表体
  rows.forEach((r, i) => {
    const ry = ty + headerH + i * rowH;
    const isOdd = i % 2 === 1;
    slide.addShape('rect', {
      x: tx, y: ry, w: tw, h: rowH,
      fill: { color: isOdd ? theme.panel : (theme.themeMode === 'dark' ? '1E293B' : 'FFFFFF') },
      line: { color: theme.accentDim, width: 0.5 },
    });
    slide.addText(r.dim, {
      x: tx, y: ry, w: colWs[0], h: rowH,
      fontSize: 13, bold: true, color: theme.accent,
      fontFace: DEFAULT_TITLE_FONT, valign: 'middle', align: 'center',
    });
    slide.addText(r.criterion, {
      x: tx + colWs[0], y: ry, w: colWs[1], h: rowH,
      fontSize: 12, color: theme.fg, fontFace: DEFAULT_BODY_FONT,
      valign: 'middle', align: 'left',
    });
    slide.addText(r.pct || '—', {
      x: tx + colWs[0] + colWs[1], y: ry, w: colWs[2], h: rowH,
      fontSize: 12, color: theme.sub, fontFace: DEFAULT_BODY_FONT,
      valign: 'middle', align: 'center',
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// LAYOUT 7: bullet-list —— 兜底布局（标题 + 纵向 bullet）
//   ┌─────────────────────────┐
//   │ [Title]                  │
//   │ ──────────────────────── │
//   │ ● 要点 1                  │
//   │ ● 要点 2                  │
//   │ ● 要点 3                  │
//   │ ● 要点 4                  │
//   └─────────────────────────┘
// ──────────────────────────────────────────────────────────────────────────
function renderBulletListLayout(slide, page, ctx) {
  const theme = pickThemeColors(page, ctx.mainAccent);
  applyPageBackground(slide, theme);
  addTopKicker(slide, theme, ctx.pageNumber, ctx.totalPages);

  slide.addText(clean(page.title), {
    x: 0.6, y: 0.5, w: SLIDE.w - 1.2, h: 0.9,
    fontSize: 28, bold: true, color: theme.fg,
    fontFace: DEFAULT_TITLE_FONT, valign: 'middle', align: 'left',
  });
  slide.addShape('line', {
    x: 0.6, y: 1.55, w: SLIDE.w - 1.2, h: 0.02,
    line: { color: theme.accent, width: 2 },
  });

  const bullets = safeBullets(page, 6);
  const startY = 2.0, endY = SLIDE.h - 0.7;
  const itemH = (endY - startY) / Math.max(bullets.length, 1);

  bullets.forEach((b, i) => {
    const y = startY + i * itemH;
    // 编号圆
    slide.addShape('ellipse', {
      x: 0.6, y: y + (itemH / 2) - 0.22, w: 0.45, h: 0.45,
      fill: { color: theme.accent }, line: { type: 'none' },
    });
    slide.addText(`${i + 1}`, {
      x: 0.6, y: y + (itemH / 2) - 0.22, w: 0.45, h: 0.45,
      fontSize: 14, bold: true, color: 'FFFFFF',
      fontFace: DEFAULT_TITLE_FONT, valign: 'middle', align: 'center',
    });
    // 文本
    slide.addText(shorten(b, 100), {
      x: 1.2, y, w: SLIDE.w - 1.8, h: itemH - 0.1,
      fontSize: 16, color: theme.fg, fontFace: DEFAULT_BODY_FONT,
      valign: 'middle', align: 'left',
    });
  });

  // 底部互动提示
  if (page.interactionPrompt) {
    slide.addText(`💬 ${shorten(page.interactionPrompt, 80)}`, {
      x: 0.6, y: SLIDE.h - 0.55, w: SLIDE.w - 1.2, h: 0.4,
      fontSize: 11, color: theme.sub, italic: true,
      fontFace: DEFAULT_BODY_FONT, align: 'left',
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 总分发函数 —— 按 page.layoutType 选择对应渲染器
// ──────────────────────────────────────────────────────────────────────────
const LAYOUT_RENDERERS = {
  hero: renderHeroLayout,
  'two-column': renderTwoColumnLayout,
  'image-bleed': renderImageBleedLayout,
  'diagram-center': renderDiagramCenterLayout,
  quote: renderQuoteLayout,
  table: renderTableLayout,
  'bullet-list': renderBulletListLayout,
};

function dispatchLayout(slide, page, ctx) {
  const layout = String(page?.layoutType || '').toLowerCase().trim();
  const renderer = LAYOUT_RENDERERS[layout] || LAYOUT_RENDERERS['bullet-list'];
  try {
    renderer(slide, page, ctx);
    return { ok: true, used: renderer === LAYOUT_RENDERERS[layout] ? layout : 'bullet-list' };
  } catch (err) {
    console.warn(`[ppt-layouts] layout '${layout}' 渲染失败：${err.message}，回落到 bullet-list`);
    try {
      renderBulletListLayout(slide, page, ctx);
      return { ok: true, used: 'bullet-list', error: err.message };
    } catch (err2) {
      return { ok: false, error: err2.message };
    }
  }
}

module.exports = {
  LAYOUT_RENDERERS,
  dispatchLayout,
  // 暴露各 layout 函数，便于 verify 单独测试
  renderHeroLayout,
  renderTwoColumnLayout,
  renderImageBleedLayout,
  renderDiagramCenterLayout,
  renderQuoteLayout,
  renderTableLayout,
  renderBulletListLayout,
  // 工具
  pickThemeColors,
  pickAccent,
  normHex,
  SLIDE,
};
