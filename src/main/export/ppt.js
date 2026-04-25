const fs = require('fs');
const PptxGenJS = require('pptxgenjs');

const toList = (arr) => (Array.isArray(arr) ? arr : []);

const TEMPLATE_STYLE = {
  // ── 5 套新模板（默认）──────────────────────────────────────────────────────
  fashion_magazine: { bg: 'FAFAF8', title: '1A1A1A', accent: 'E91E8C', accentLight: 'FCE4EC', gradientEnd: 'FFF0F5', decorColor: 'F48FB1', titleFont: 'PingFang SC', bodyFont: 'PingFang SC' },
  display_window:   { bg: '1C1C2E', title: 'F5F5F0', accent: 'D4AF37', accentLight: '4A3F1E', gradientEnd: '2A2A3E', decorColor: 'C9A227', titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei' },
  pastel_energy:    { bg: 'FEF0F7', title: '2D1B4E', accent: 'FF85A2', accentLight: 'FFD6E4', gradientEnd: 'FFF0FA', decorColor: 'FFB3C6', titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei' },
  guochao_modern:   { bg: 'FFFCF7', title: '1A0A00', accent: 'C8102E', accentLight: 'FDDDD8', gradientEnd: 'FFF5EE', decorColor: 'F4A261', titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei' },
  pro_minimalist:   { bg: 'EAF4FB', title: '1B3A6B', accent: '2E86DE', accentLight: 'C0D8EE', gradientEnd: 'F0F8FF', decorColor: '90CAF9', titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei' },
  // ── 旧模板（向后兼容，保留但不作为默认）──────────────────────────────────
  modern:    { bg: 'F8FAFC', title: '1F2937', accent: '2563EB', accentLight: 'DBEAFE', gradientEnd: 'EFF6FF', decorColor: 'BFDBFE', titleFont: 'Source Han Sans SC', bodyFont: 'Source Han Sans SC' },
  national:  { bg: 'F5F1E8', title: '2C1F1A', accent: 'B91C1C', accentLight: 'FEE2E2', gradientEnd: 'FEF3C7', decorColor: 'FBBF24', titleFont: 'Microsoft YaHei', bodyFont: 'Source Han Serif SC' },
  playful:   { bg: 'FFFDF7', title: '1E293B', accent: 'F97316', accentLight: 'FFEDD5', gradientEnd: 'FFF7ED', decorColor: 'FDBA74', titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei' },
  blueprint: { bg: 'F8F7F5', title: '2F3542', accent: '007AFF', accentLight: 'DBEAFE', gradientEnd: 'F0F9FF', decorColor: '93C5FD', titleFont: 'DIN Alternate', bodyFont: 'Source Han Sans SC' }
};

const SLIDE = { w: 13.333, h: 7.5 };

const PAGE_GLYPH = {
  封面: '封',
  路线图: '路',
  课程导入: '导',
  模块导入: '引',
  原理讲解: '理',
  操作步骤: '操',
  验收检查: '验',
  课堂练习: '练',
  总结收束: '结',
  模块页: '模',
  内容页: '页',
  总结: '结',
  封底: '结'
};

function withTextBoxDefaults(style, options = {}) {
  return {
    fontFace: options.fontFace || style.bodyFont || style.titleFont || 'Microsoft YaHei',
    margin: options.margin || 0,
    breakLine: false,
    fit: options.fit || 'shrink',
    valign: options.valign || 'mid',
    ...options
  };
}

function sanitizePptText(value) {
  const text = String(value || '')
    .replace(/#[0-9A-Fa-f]{6}/g, '')
    .replace(/主体内容区?|页脚\/?活动提示区?|页脚提示区?/g, '')
    .replace(/大家好，欢迎来到今天的课堂/g, '')
    .replace(/这一段先把[^。]*讲透/g, '')
    .replace(/第\s*\d+\s*段必须[^。]*/g, '')
    .replace(/^单字标签[:：].*$/gm, '')
    .replace(/^\s*[路导模页结]\s*$/gm, '')
    .replace(/拓扑框线|编号盒子|UI面板/g, '')
    // AI narrativeGoal 占位字符串误入 keyContent 时过滤掉
    .replace(/帮助学生完成这一页的核心理解与动作[。.]?/g, '')
    .replace(/帮助学生[^。]{0,20}理解[^。]{0,20}动作[。.]?/g, '')
    .replace(/^\s*[-*]\s*/gm, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return text;
}

function truncateText(value, maxLen = 34) {
  const text = sanitizePptText(value);
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(1, maxLen - 1))}…`;
}

function normalizePointText(value) {
  return truncateText(
    String(value || '')
      .replace(/^(关键点|课堂任务|成果提示|结论|重点)\s*[:：]\s*/i, '')
      .replace(/^[-*]\s*/, '')
      .trim(),
    38
  );
}

function titleSafe(value, maxLen = 30) {
  return truncateText(value, maxLen);
}

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ')
    .trim();
}

function extractKeywords(value, max = 8) {
  const tokens = normalizeForMatch(value)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return uniqueTexts(tokens, max);
}

function uniqueTexts(items, max = 4) {
  const seen = new Set();
  const out = [];
  toList(items).forEach((item) => {
    const text = normalizePointText(item);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out.slice(0, max);
}

function polishSummary(summary, fallback = '') {
  const text = truncateText(summary, 86);
  if (text) return text;
  return truncateText(fallback || '本页围绕课堂目标进行结构化讲解。', 86);
}

function analyzePageCrowding(page) {
  const points = uniqueTexts(page.keyContent, 6);
  const summaryLen = String(page.summary || '').length;
  const titleLen = String(page.title || '').length;
  const pointCount = points.length;
  const pointChars = points.join('').length;
  const longestPoint = points.reduce((max, item) => Math.max(max, String(item || '').length), 0);

  let score = 0;
  const reasons = [];
  if (summaryLen > 68) {
    score += 2;
    reasons.push('summary-long');
  }
  if (summaryLen > 82) {
    score += 2;
    reasons.push('summary-too-long');
  }
  if (pointCount > 4) {
    score += 3;
    reasons.push('too-many-points');
  }
  if (pointChars > 112) {
    score += 2;
    reasons.push('points-too-dense');
  }
  if (longestPoint > 30) {
    score += 1;
    reasons.push('point-too-long');
  }
  if (titleLen > 30) {
    score += 1;
    reasons.push('title-too-long');
  }
  return {
    score,
    reasons,
    pointCount,
    pointChars,
    crowded: score >= 4,
    severe: score >= 7
  };
}

function compactPageForSlide(page, options = {}) {
  const maxSummary = Number(options.maxSummary) || 72;
  const maxPoints = Number(options.maxPoints) || 4;
  const maxPointLen = Number(options.maxPointLen) || 30;
  const points = uniqueTexts(page.keyContent, 8)
    .map((item) => truncateText(item, maxPointLen))
    .slice(0, maxPoints);
  return {
    ...page,
    summary: truncateText(page.summary, maxSummary),
    keyContent: points.length ? points : [truncateText('围绕课堂目标组织内容讲解。', maxPointLen)]
  };
}

function resolveSemanticVariant(page, crowding) {
  const layoutHint = String(page.layout || '').toLowerCase();
  if (['cards', 'compare', 'text-left', 'text-right', 'text-only'].includes(layoutHint)) return layoutHint;

  const haystack = `${page.title || ''} ${page.subtitle || ''} ${page.summary || ''} ${(page.keyContent || []).join(' ')}`;
  const compareHint = /(对比|比较|差异|优劣|利弊|选择|方案)/.test(haystack);
  const processHint = /(步骤|流程|环节|先|再|然后|最后|路径|闭环|sop)/i.test(haystack);
  const hasImage = Boolean(pickFilePath(page.imagePath) || page.imageUrl);
  const firstChunk = /（1\/\d+）$/.test(page.title || '');

  if (firstChunk) return 'cards';
  if (compareHint && toList(page.keyContent).length >= 3) return 'compare';
  if (!hasImage || crowding.severe) return 'text-only';
  if (processHint && toList(page.keyContent).length >= 3) return 'cards';
  return page.pageNumber % 2 === 0 ? 'text-right' : 'text-left';
}

function splitLectureScriptSections(lectureScript) {
  const raw = String(lectureScript || '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const sections = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const body = current.body.join('\n').trim();
    const title = String(current.title || '').trim();
    if (!title && !body) return;
    const text = `${title}\n${body}`.trim();
    sections.push({
      title: title || truncateText(body, 20) || `讲稿片段${sections.length + 1}`,
      body,
      text: truncateText(text, 900),
      keywords: extractKeywords(text, 10)
    });
  };

  lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    const isHeading = /^(#{1,6}\s*)/.test(trimmed)
      || /^第.{0,10}[节课讲授设计]/.test(trimmed)
      || /^(模块|单元|课时|知识点|任务)\s*[:：]/.test(trimmed)
      || /^【.+】$/.test(trimmed);
    if (isHeading) {
      pushCurrent();
      const heading = trimmed.replace(/^#{1,6}\s*/, '').replace(/^【|】$/g, '');
      current = { title: heading, body: [] };
      return;
    }
    if (!current) {
      current = { title: '', body: [] };
    }
    current.body.push(trimmed);
  });
  pushCurrent();

  if (sections.length > 0) return sections;
  const chunks = raw.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  return chunks.map((chunk, idx) => ({
    title: `讲稿片段${idx + 1}`,
    body: chunk,
    text: truncateText(chunk, 900),
    keywords: extractKeywords(chunk, 10)
  }));
}

function mapPageNoteFromSections(page, sections) {
  if (!sections.length) return '';
  const pageText = `${page.title || ''} ${page.subtitle || ''} ${page.summary || ''} ${(page.keyContent || []).join(' ')}`;
  const pageTokens = extractKeywords(pageText, 12);
  const pageNorm = normalizeForMatch(pageText);
  let best = null;

  sections.forEach((section) => {
    let score = 0;
    const titleNorm = normalizeForMatch(section.title);
    const sectionNorm = normalizeForMatch(section.text);
    if (titleNorm && pageNorm.includes(titleNorm)) score += 8;
    if (pageNorm && sectionNorm.includes(normalizeForMatch(page.title))) score += 6;
    const overlap = pageTokens.filter((token) => section.keywords.includes(token)).length;
    score += Math.min(6, overlap * 2);
    if (page.pageType === '课程导入' && /(导入|开场|情境|暖场)/.test(section.text)) score += 3;
    if ((page.pageType === '总结' || page.pageType === '封底') && /(总结|复盘|作业|收尾)/.test(section.text)) score += 3;
    if (!best || score > best.score) {
      best = { score, section };
    }
  });

  if (!best || best.score < 4) return '';
  return truncateText(best.section.text, 1000);
}

function buildFallbackNote(page) {
  const bullets = uniqueTexts(page.keyContent, 4);
  const lines = [
    `【教学目标】${truncateText(page.narrativeGoal || page.summary || '围绕本页核心点展开讲解。', 72)}`,
    `【讲解重点】${truncateText(page.summary || page.subtitle || '突出概念与应用连接。', 72)}`
  ];
  if (bullets.length) lines.push(`【课堂提示】${bullets.join('；')}`);
  return lines.join('\n');
}

function attachSpeakerNotes(slide, noteText) {
  if (!noteText || typeof slide.addNotes !== 'function') return;
  const note = String(noteText || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, 12)
    .join('\n');
  if (!note) return;
  slide.addNotes(note);
}

function buildQualityStats(items) {
  const list = toList(items);
  const crowded = list.filter((item) => item.crowding?.crowded);
  const severe = list.filter((item) => item.crowding?.severe);
  const splitPages = list.filter((item) => /（续）$/.test(item.title || ''));
  const variantCount = list.reduce((acc, item) => {
    const key = item.variant || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    totalSlides: list.length,
    crowdedSlides: crowded.length,
    severeSlides: severe.length,
    splitSlides: splitPages.length,
    crowdedRatio: list.length ? Number((crowded.length / list.length).toFixed(4)) : 0,
    variants: variantCount
  };
}

function writePptQualityReport(outputPath, notebook, qualityItems) {
  if (!outputPath) return null;
  const reportPathJson = outputPath.replace(/\.pptx$/i, '.quality.json');
  const reportPathMd = outputPath.replace(/\.pptx$/i, '.quality.md');
  const stats = buildQualityStats(qualityItems);
  const report = {
    generatedAt: new Date().toISOString(),
    notebookName: notebook?.name || '',
    pptPath: outputPath,
    stats,
    slides: toList(qualityItems)
  };

  fs.writeFileSync(reportPathJson, JSON.stringify(report, null, 2), 'utf8');

  const mdLines = [
    '# PPT导出质检报告',
    '',
    `- 课程：${report.notebookName || '未命名课程'}`,
    `- PPT：${outputPath}`,
    `- 生成时间：${report.generatedAt}`,
    '',
    '## 汇总',
    '',
    `- 总页数：${stats.totalSlides}`,
    `- 拥挤页数：${stats.crowdedSlides}`,
    `- 严重拥挤页数：${stats.severeSlides}`,
    `- 自动拆分页数（续页）：${stats.splitSlides}`,
    `- 拥挤占比：${(stats.crowdedRatio * 100).toFixed(1)}%`,
    '',
    '## 逐页明细',
    '',
    '| 页码 | 类型 | 标题 | 布局 | 拥挤分 | 触发原因 |',
    '|---|---|---|---|---:|---|'
  ];

  toList(qualityItems).forEach((item) => {
    const reasons = toList(item.crowding?.reasons).join(', ') || '-';
    mdLines.push(`| ${item.pageNumber || '-'} | ${item.pageType || '-'} | ${item.title || '-'} | ${item.variant || '-'} | ${item.crowding?.score || 0} | ${reasons} |`);
  });

  fs.writeFileSync(reportPathMd, `${mdLines.join('\n')}\n`, 'utf8');
  return {
    jsonPath: reportPathJson,
    mdPath: reportPathMd,
    stats
  };
}

function normalizeModuleList(framework, modules) {
  if (toList(modules).length > 0) return toList(modules);
  const frameworkContent = framework?.content || framework || {};
  return toList(frameworkContent.modules).map((item, index) => ({
    id: item.id || `fw-${index + 1}`,
    moduleNumber: Number(item.number) || index + 1,
    name: item.name || `模块${index + 1}`,
    hours: Number(item.hours) || 0,
    description: item.description || '',
    knowledgePoints: toList(item.keyPoints || item.knowledgePoints),
    genericImagePath: item.genericImagePath || '',
    structureImagePath: item.structureImagePath || ''
  }));
}

function pickFilePath(...candidates) {
  for (const item of candidates) {
    const p = String(item || '').trim();
    if (!p) continue;
    // 直接检查
    if (fs.existsSync(p)) return p;
    // 尝试 decodeURI（处理编码过的路径）
    try { if (fs.existsSync(decodeURIComponent(p))) return decodeURIComponent(p); } catch {}
    // 尝试去掉 file:// 前缀
    if (p.startsWith('file://')) {
      const cleaned = p.replace(/^file:\/\/\/?/, '');
      if (fs.existsSync(cleaned)) return cleaned;
    }
  }
  return '';
}

function pickModuleImage(moduleItem) {
  return pickFilePath(
    moduleItem?.genericImagePath,
    moduleItem?.content?.genericImagePath,
    moduleItem?.structureImagePath,
    moduleItem?.content?.structureImagePath
  );
}

function compactPoints(value) {
  const rows = toList(String(value || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean));

  const exploded = rows.flatMap((line) => {
    const separators = /[,，；;]/;
    const isLikelyDenseList = /模块|步骤|阶段|路径|要点|维度|策略/.test(line);
    if (separators.test(line) && (line.length > 34 || isLikelyDenseList)) {
      return line.split(separators).map((item) => item.trim()).filter(Boolean);
    }
    return [line];
  });

  return exploded
    .map((line) => normalizePointText(line))
    .filter(Boolean)
    .slice(0, 4);
}

function parseRouteItemsFromText(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const chunks = text.split(/[,\n，；;]+/).map((item) => item.trim()).filter(Boolean);
  const phases = ['导入', '理解', '迁移', '交付', '复盘', '拓展'];
  return chunks.slice(0, 6).map((chunk, idx) => {
    const pair = chunk.split(/[:：]/);
    const title = pair[0] || chunk;
    const desc = pair.length > 1 ? pair.slice(1).join('：') : '形成阶段成果';
    return {
      step: idx + 1,
      phase: phases[idx] || `阶段${idx + 1}`,
      title: truncateText(title, 22),
      desc: truncateText(desc, 28)
    };
  });
}

function normalizePageList(pptPages) {
  return toList(pptPages)
    .filter((item) => item && item.title)
    .map((item, index) => ({
      id: item.id || `ppt-page-${index + 1}`,
      pageNumber: Number(item.pageNumber) || index + 1,
      pageType: item.pageType || '内容页',
      title: titleSafe(item.title || `第${index + 1}页`, 34),
      subtitle: truncateText(item.subtitle || '', 42),
      summary: truncateText(item.summary || '', 86),
      narrativeGoal: item.narrativeGoal || '',
      keyContent: compactPoints(item.keyContent),
      visual: item.visual || '',
      layout: item.layout || '',
      moduleId: item.moduleId || '',
      needImage: typeof item.needImage === 'boolean' ? item.needImage : true,
      imagePath: item.imagePath || '',
      imageUrl: item.imageUrl || ''
    }));
}

function polishPageList(pages) {
  return toList(pages).map((page) => {
    const fallbackPoints = compactPoints(`${page.subtitle || ''}\n${page.summary || ''}`);
    const points = uniqueTexts(page.keyContent?.length ? page.keyContent : fallbackPoints, 4);
    return {
      ...page,
      title: titleSafe(page.title, page.pageType === '封面' ? 22 : 34),
      subtitle: truncateText(page.subtitle, 42),
      summary: polishSummary(page.summary, page.narrativeGoal || page.subtitle),
      keyContent: points.length ? points : ['围绕课堂目标组织内容讲解。']
    };
  });
}

function splitDensePages(pages) {
  const expanded = [];
  toList(pages).forEach((page) => {
    const canSplit = ['模块页', '内容页', '课程导入'].includes(page.pageType);
    const points = uniqueTexts(page.keyContent, 8);
    const crowding = analyzePageCrowding({ ...page, keyContent: points });
    const mustSplit = canSplit && (points.length > 4 || crowding.severe || crowding.pointChars > 126);

    if (!mustSplit) {
      const compacted = compactPageForSlide({ ...page, keyContent: points }, crowding.crowded
        ? { maxSummary: 66, maxPoints: 4, maxPointLen: 28 }
        : { maxSummary: 74, maxPoints: 4, maxPointLen: 32 });
      expanded.push({
        ...compacted,
        crowding
      });
      return;
    }

    const splitAt = Math.ceil(points.length / 2);
    const firstPoints = points.slice(0, Math.max(3, splitAt));
    const secondPoints = points.slice(Math.max(3, splitAt), 8);
    expanded.push({
      ...page,
      keyContent: compactPageForSlide({
        ...page,
        keyContent: firstPoints.length ? firstPoints : points.slice(0, 3)
      }, { maxSummary: 62, maxPoints: 4, maxPointLen: 28 }).keyContent,
      summary: truncateText(page.summary, 62),
      crowding
    });
    if (secondPoints.length) {
      expanded.push({
        ...page,
        id: `${page.id}-cont`,
        pageType: '内容页',
        title: `${titleSafe(page.title.replace(/（\d+\/\d+）$/, ''), 26)}（续）`,
        subtitle: truncateText(page.subtitle || page.summary, 32),
        summary: polishSummary(page.narrativeGoal || page.summary, page.subtitle),
        keyContent: compactPageForSlide({
          ...page,
          keyContent: secondPoints
        }, { maxSummary: 56, maxPoints: 4, maxPointLen: 28 }).keyContent,
        crowding: analyzePageCrowding({
          ...page,
          summary: truncateText(page.summary, 56),
          keyContent: secondPoints
        })
      });
    }
  });

  return expanded.map((item, index) => ({ ...item, pageNumber: index + 1 }));
}

function buildRouteItemsFromPages(pages) {
  const phases = ['导入', '理解', '迁移', '交付', '复盘', '拓展'];
  // 同时匹配 '模块页' 和 '模块导入'——AI 分类可能返回后者
  return toList(pages)
    .filter((item) => item.pageType === '模块页' || item.pageType === '模块导入')
    .slice(0, 6)
    .map((item, index) => ({
      step: index + 1,
      phase: phases[index] || `阶段${index + 1}`,
      title: truncateText(sanitizePptText(item.title).replace(/（\d+\/\d+）$/, ''), 22),
      desc: truncateText(sanitizePptText(item.subtitle) || '形成阶段成果', 28)
    }));
}

function applySlideBackground(slide, style) {
  slide.background = { color: style.bg };
}

function addTopAccent(slide, style) {
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: SLIDE.w,
    h: 0.1,
    line: { color: style.accent, pt: 0 },
    fill: { color: style.accent }
  });
}

function addGradientFooter(slide, style) {
  // 底部渐变色带 — 从强调色浅色到背景色的柔和过渡
  const footerColor = style.accentLight || style.accent;
  slide.addShape('rect', {
    x: 0,
    y: 6.9,
    w: SLIDE.w,
    h: 0.6,
    line: { pt: 0 },
    fill: { color: footerColor, transparency: 60 }
  });
  // 底部细线
  slide.addShape('rect', {
    x: 0,
    y: 6.88,
    w: SLIDE.w,
    h: 0.025,
    line: { pt: 0 },
    fill: { color: style.accent, transparency: 50 }
  });
}

function addDecorCircles(slide, style) {
  // 只保留右上角一个装饰圆环
  const decorColor = style.decorColor || style.accent;
  slide.addShape('ellipse', {
    x: 12.0, y: 0.3, w: 0.9, h: 0.9,
    line: { color: decorColor, transparency: 75, pt: 1.2 },
    fill: { type: 'none' }
  });
}

function addSlideDecorations(slide, style, pageType) {
  addGradientFooter(slide, style);
  if (pageType !== '封面' && pageType !== '路线图') {
    addDecorCircles(slide, style);
  }
}

function addHeaderBlock(slide, style, { title, subtitle, pageType }) {
  const glyph = PAGE_GLYPH[pageType] || '•';
  const titleText = String(title || '未命名页面');
  const titleSize = titleText.length > 20 ? 20 : (titleText.length > 14 ? 22 : 24);
  slide.addText(titleText, withTextBoxDefaults(style, {
    x: 1.08,
    y: 0.5,
    w: 8.45,
    h: subtitle ? 0.42 : 0.56,
    fontSize: titleSize,
    fontFace: style.titleFont,
    bold: true,
    color: style.title,
    valign: 'mid'
  }));
  // 左侧装饰竖条（替代单字标签）
  slide.addShape('rect', {
    x: 0.72,
    y: 0.52,
    w: 0.06,
    h: subtitle ? 0.82 : 0.62,
    line: { pt: 0 },
    fill: { color: style.accent }
  });

  if (subtitle) {
    slide.addText(subtitle, withTextBoxDefaults(style, {
      x: 0.87,
      y: 0.92,
      w: 8.2,
      h: 0.24,
      fontSize: 12.5,
      fontFace: style.bodyFont,
      color: style.accent,
      bold: true,
      valign: 'mid'
    }));
  }

  // 右上角页型标签（纯文字，无框）
  if (pageType) {
    slide.addText(pageType, withTextBoxDefaults(style, {
      x: 10.5,
      y: 0.53,
      w: 2.0,
      h: 0.22,
      fontSize: 10,
      fontFace: style.bodyFont,
      color: style.accent,
      italic: true,
      align: 'right'
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 全幅背景图渲染系统（Full-Bleed Background + pptxgenjs Text Overlay）
//
// 架构：AI 图片作为全屏背景（cover 模式），pptxgenjs 在上方渲染
//   ① 顶部半透明覆层：标题 + 页型标签
//   ② 底部半透明覆层：要点列表（2列网格）
//   ③ 中间约40%区域：纯图片露出，视觉主体区
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 将图片以全幅 cover 模式铺满整张幻灯片
 * @returns {boolean} 是否成功添加图片
 */
function addFullBleedBackground(slide, imagePath) {
  const localPath = pickFilePath(imagePath);
  if (!localPath) return false;
  slide.addImage({
    path: localPath,
    x: 0, y: 0, w: SLIDE.w, h: SLIDE.h,
    sizing: { type: 'cover', x: 0, y: 0, w: SLIDE.w, h: SLIDE.h }
  });
  return true;
}

/**
 * 全幅模式：顶部标题覆层（高度 1.3"，半透明深色）
 * 包含：左侧强调竖条 + 标题 + 副标题 + 右侧页型标签
 */
function addFullBleedHeader(slide, style, title, pageType, subtitle) {
  const PANEL_H = 1.3;
  // 半透明背景面板
  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE.w, h: PANEL_H,
    line: { pt: 0 },
    fill: { color: '050505', transparency: 35 }
  });
  // 左侧强调色竖条
  slide.addShape('rect', {
    x: 0, y: 0, w: 0.1, h: PANEL_H,
    line: { pt: 0 },
    fill: { color: style.accent }
  });
  // 标题
  const titleText = String(title || '');
  const titleSize = titleText.length > 18 ? 22 : (titleText.length > 12 ? 24 : 26);
  slide.addText(titleText, withTextBoxDefaults(style, {
    x: 0.28, y: 0.18, w: 10.2, h: 0.68,
    fontSize: titleSize, fontFace: style.titleFont, bold: true,
    color: 'FFFFFF', valign: 'mid'
  }));
  // 副标题（如有）
  if (subtitle) {
    slide.addText(String(subtitle), withTextBoxDefaults(style, {
      x: 0.3, y: 0.88, w: 9.0, h: 0.26,
      fontSize: 10.5, fontFace: style.bodyFont,
      color: style.accent, bold: false, valign: 'mid'
    }));
  }
  // 右上角页型标签
  if (pageType) {
    slide.addText(String(pageType), withTextBoxDefaults(style, {
      x: 10.8, y: 0.4, w: 2.2, h: 0.26,
      fontSize: 10, fontFace: style.bodyFont,
      color: style.accent, italic: true, align: 'right'
    }));
  }
}

/**
 * 全幅模式：底部要点覆层（高度 2.2"，半透明深色）
 * 最多 4 个要点，2 列网格排列；操作步骤用数字角标，验收标准用 ✓ 角标
 */
function addFullBleedContent(slide, style, rawPoints, pageType) {
  const PANEL_H = 2.2;
  const PANEL_Y = SLIDE.h - PANEL_H;

  // 清洗要点
  const pts = Array.isArray(rawPoints)
    ? rawPoints
    : String(rawPoints || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const validPts = uniqueTexts(
    pts.map(p => sanitizePptText(p)).filter(Boolean),
    4
  );
  if (!validPts.length) return;

  // 底部半透明面板
  slide.addShape('rect', {
    x: 0, y: PANEL_Y, w: SLIDE.w, h: PANEL_H,
    line: { pt: 0 },
    fill: { color: '050505', transparency: 35 }
  });
  // 顶部强调分隔线
  slide.addShape('rect', {
    x: 0, y: PANEL_Y, w: SLIDE.w, h: 0.04,
    line: { pt: 0 },
    fill: { color: style.accent, transparency: 25 }
  });

  // 角标样式：操作步骤→数字，验收/检查→✓，其他→•
  const isSteps = /操作步骤|步骤/.test(pageType || '');
  const isCheck = /验收|检查/.test(pageType || '');

  const cols = validPts.length > 2 ? 2 : 1;
  const colW = (SLIDE.w - 1.0) / cols;

  validPts.forEach((point, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const px = 0.5 + col * colW;
    const py = PANEL_Y + 0.2 + row * 0.88;

    const badge = isCheck ? '✓' : (isSteps ? String(i + 1) : '•');
    const badgeBg = isCheck ? '2E7D32' : style.accent;

    // 角标圆形背景
    slide.addShape('ellipse', {
      x: px, y: py + 0.05, w: 0.36, h: 0.36,
      line: { pt: 0 },
      fill: { color: badgeBg, transparency: isCheck ? 5 : 10 }
    });
    // 角标文字
    slide.addText(badge, withTextBoxDefaults(style, {
      x: px, y: py + 0.05, w: 0.36, h: 0.36,
      fontSize: 12, fontFace: style.titleFont, bold: true,
      color: 'FFFFFF', align: 'center', valign: 'mid'
    }));
    // 要点文字
    slide.addText(truncateText(point, 34), withTextBoxDefaults(style, {
      x: px + 0.44, y: py, w: colW - 0.58, h: 0.48,
      fontSize: 15.5, fontFace: style.bodyFont,
      color: 'FFFFFF', valign: 'mid'
    }));
  });
}

/**
 * 全幅模式完整渲染：背景图 + 顶部标题覆层 + 底部要点覆层
 * @returns {boolean} 是否成功（图片存在时为 true）
 */
function renderFullBleedSlide(slide, style, page, imagePath) {
  const hasImg = addFullBleedBackground(slide, imagePath);
  if (!hasImg) return false;
  addFullBleedHeader(slide, style, page.title, page.pageType, page.subtitle);
  addFullBleedContent(slide, style, page.keyContent || [], page.pageType);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 原有局部图片布局（左文右图 / 全文本 fallback）
// ─────────────────────────────────────────────────────────────────────────────

function addImageOrPlaceholder(slide, style, imagePath, x, y, w, h, fitMode = 'contain') {
  const localPath = pickFilePath(imagePath);
  if (localPath) {
    slide.addImage({
      path: localPath,
      x,
      y,
      w,
      h,
      sizing: { type: fitMode, x, y, w, h }
    });
    return true;
  }
  // 无图时不添加任何占位框，返回 false 让调用方决定布局
  return false;
}

function addBulletSection(slide, style, summary, rawPoints, x, y, w, h) {
  // keyContent 可能是换行分隔的字符串，统一转为数组
  const points = Array.isArray(rawPoints)
    ? rawPoints
    : String(rawPoints || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: style.accent, transparency: 84, pt: 0.8 },
    fill: { color: 'FFFFFF', transparency: 18 }
  });
  slide.addText('核心提炼', withTextBoxDefaults(style, {
    x: x + 0.2,
    y: y + 0.16,
    w: 1.8,
    h: 0.18,
    fontSize: 12,
    fontFace: style.titleFont,
    bold: true,
    color: style.accent
  }));
  slide.addText(truncateText(summary || '本页展示核心内容提炼。', 62), withTextBoxDefaults(style, {
    x: x + 0.2,
    y: y + 0.46,
    w: w - 0.4,
    h: 0.62,
    fontSize: 16,
    fontFace: style.bodyFont,
    color: style.title,
    valign: 'top'
  }));

  // 去重：如果要点和摘要内容重复，移除重复项
  const summaryNorm = String(summary || '').replace(/\s+/g, '').substring(0, 30);
  const dedupedPoints = (points.length ? points : ['本页讲解课堂重点与任务要求。'])
    .filter(p => String(p || '').replace(/\s+/g, '').substring(0, 30) !== summaryNorm);
  const normalizedPoints = uniqueTexts(
    dedupedPoints.length ? dedupedPoints : points,
    4
  );
  const bulletRuns = normalizedPoints.map((text) => ({
    text,
    options: { bullet: { indent: 14 } }
  }));
  slide.addText(bulletRuns, withTextBoxDefaults(style, {
    x: x + 0.2,
    y: y + 1.28,
    w: w - 0.45,
    h: h - 1.48,
    fontSize: 14,
    fontFace: style.bodyFont,
    color: style.title,
    breakLine: true,
    valign: 'top'
  }));
}

function addModuleCardSection(slide, style, page, x, y, w, h) {
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: style.accent, transparency: 86, pt: 0.8 },
    fill: { color: 'FFFFFF', transparency: 8 }
  });
  slide.addText('模块核心提炼', withTextBoxDefaults(style, {
    x: x + 0.18,
    y: y + 0.14,
    w: 2.1,
    h: 0.24,
    fontSize: 12,
    fontFace: style.titleFont,
    color: style.accent,
    bold: true
  }));
  slide.addText(polishSummary(page.summary, page.subtitle), withTextBoxDefaults(style, {
    x: x + 0.18,
    y: y + 0.42,
    w: w - 0.35,
    h: 0.54,
    fontSize: 15.5,
    fontFace: style.bodyFont,
    color: style.title,
    valign: 'top'
  }));

  const cardPoints = uniqueTexts(page.keyContent, 4);
  cardPoints.forEach((point, idx) => {
    const cx = x + 0.18 + (idx % 2) * ((w - 0.5) / 2);
    const cy = y + 1.08 + Math.floor(idx / 2) * 1.04;
    const cw = (w - 0.62) / 2;
    slide.addShape('roundRect', {
      x: cx,
      y: cy,
      w: cw,
      h: 0.88,
      rectRadius: 0.05,
      line: { color: style.accent, transparency: 78, pt: 0.7 },
      fill: { color: 'FFFFFF', transparency: 2 }
    });
    slide.addShape('ellipse', {
      x: cx + 0.08,
      y: cy + 0.08,
      w: 0.18,
      h: 0.18,
      line: { color: style.accent, pt: 0.2 },
      fill: { color: style.accent, transparency: 2 }
    });
    slide.addText(`0${idx + 1}`, withTextBoxDefaults(style, {
      x: cx + 0.08,
      y: cy + 0.095,
      w: 0.18,
      h: 0.22,
      fontSize: 8,
      fontFace: style.titleFont,
      color: 'FFFFFF',
      align: 'center',
      bold: true
    }));
    slide.addText(point, withTextBoxDefaults(style, {
      x: cx + 0.31,
      y: cy + 0.26,
      w: cw - 0.36,
      h: 0.46,
      fontSize: 12.5,
      fontFace: style.bodyFont,
      color: style.title,
      valign: 'top'
    }));
  });
}

/**
 * 封面幻灯片 — 全屏英雄图设计（2026 重构）
 *
 * 布局逻辑：
 *  有合成图（compositeImagePath）→ 直接嵌入，一张图搞定全部
 *  有 AI 背景图（imagePath）     → 全屏平铺 + 底部渐变遮罩 + 文字叠加
 *  无图                          → 纯色背景 + 居中大标题（备用方案）
 *
 * 不再使用传统"左文右图"分栏排布。
 */
function addCoverSlide(pptx, notebook, style, coverPage) {
  const slide    = pptx.addSlide();
  const compPath = pickFilePath(coverPage?.compositeImagePath);
  const imgPath  = pickFilePath(coverPage?.imagePath);

  // ── 优先：Canvas 合成图，直接铺满即可 ──────────────────────────────────
  if (compPath) {
    slide.addImage({
      path: compPath, x: 0, y: 0, w: SLIDE.w, h: SLIDE.h,
      sizing: { type: 'cover', x: 0, y: 0, w: SLIDE.w, h: SLIDE.h }
    });
    return;
  }

  // ── 有 AI 背景图：全屏英雄图 + 底部文字层 ──────────────────────────────
  if (imgPath) {
    // 背景图全幅
    slide.addImage({
      path: imgPath, x: 0, y: 0, w: SLIDE.w, h: SLIDE.h,
      sizing: { type: 'cover', x: 0, y: 0, w: SLIDE.w, h: SLIDE.h }
    });

    // 整体微暗蒙层（让文字更易读，不破坏图片氛围）
    slide.addShape('rect', {
      x: 0, y: 0, w: SLIDE.w, h: SLIDE.h,
      line: { color: '000000', transparency: 100 },
      fill: { color: '000000', transparency: 72 }
    });

    // 底部渐变遮罩（从 60% 处开始渐深）
    slide.addShape('rect', {
      x: 0, y: 4.15, w: SLIDE.w, h: 3.35,
      line: { color: '000000', transparency: 100 },
      fill: { color: '000000', transparency: 28 }
    });

    // 强调色底部横条（高 0.12 寸，全宽）
    slide.addShape('rect', {
      x: 0, y: SLIDE.h - 0.12, w: SLIDE.w, h: 0.12,
      line: { color: style.accent, transparency: 0 },
      fill: { color: style.accent, transparency: 0 }
    });

    // 强调色左侧竖条（全高 0.06 寸）
    slide.addShape('rect', {
      x: 0, y: 0, w: 0.06, h: SLIDE.h,
      line: { color: style.accent, transparency: 0 },
      fill: { color: style.accent, transparency: 0 }
    });

    // 课程标题（底部居中，大号粗体，文字阴影增强可读性）
    const courseTitle = coverPage?.title || notebook?.name || '课程课件';
    slide.addText(courseTitle, withTextBoxDefaults(style, {
      x: 0.5, y: 4.7, w: 12.35, h: 1.4,
      fontSize: 48, fontFace: style.titleFont, bold: true,
      color: 'FFFFFF', align: 'center', valign: 'mid',
      shadow: { type: 'outer', color: '000000', opacity: 0.65, blur: 10, offset: 3, angle: 270 }
    }));

    // 副标题（学时信息）
    if (coverPage?.subtitle) {
      slide.addText(coverPage.subtitle, withTextBoxDefaults(style, {
        x: 0.5, y: 5.95, w: 12.35, h: 0.45,
        fontSize: 20, fontFace: style.bodyFont, bold: false,
        color: 'D0D0D0', align: 'center', valign: 'mid'
      }));
    }

    // 元信息行（年级 · 学时 · 软件工具）
    const metaParts = [];
    if (notebook?.grade)         metaParts.push(notebook.grade);
    if (notebook?.totalHours)    metaParts.push(`${notebook.totalHours}学时`);
    if (notebook?.softwareTools) metaParts.push(notebook.softwareTools);
    if (metaParts.length) {
      slide.addText(metaParts.join('  ·  '), withTextBoxDefaults(style, {
        x: 0.5, y: 6.65, w: 12.35, h: 0.32,
        fontSize: 13, fontFace: style.bodyFont,
        color: 'AAAAAA', align: 'center', valign: 'mid'
      }));
    }
    return;
  }

  // ── 无图备用方案：纯色背景 + 居中大标题 ────────────────────────────────
  slide.background = { color: style.bg };

  // 顶部强调色横条
  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE.w, h: 0.1,
    line: { color: style.accent, transparency: 0 },
    fill: { color: style.accent, transparency: 0 }
  });
  // 底部强调色横条
  slide.addShape('rect', {
    x: 0, y: SLIDE.h - 0.1, w: SLIDE.w, h: 0.1,
    line: { color: style.accent, transparency: 0 },
    fill: { color: style.accent, transparency: 0 }
  });
  // 主标题
  slide.addText(coverPage?.title || notebook?.name || '课程课件', withTextBoxDefaults(style, {
    x: 0.8, y: 1.8, w: 11.75, h: 2.0,
    fontSize: 54, fontFace: style.titleFont, bold: true,
    color: style.title, align: 'center', valign: 'mid'
  }));
  // 副标题
  if (coverPage?.subtitle) {
    slide.addText(coverPage.subtitle, withTextBoxDefaults(style, {
      x: 0.8, y: 3.9, w: 11.75, h: 0.55,
      fontSize: 22, fontFace: style.bodyFont, bold: true,
      color: style.accent, align: 'center'
    }));
  }
  // 元信息
  const metaNoImg = [];
  if (notebook?.grade)         metaNoImg.push(`授课对象：${notebook.grade}`);
  if (notebook?.totalHours)    metaNoImg.push(`总学时：${notebook.totalHours}`);
  if (notebook?.softwareTools) metaNoImg.push(`使用软件：${notebook.softwareTools}`);
  if (metaNoImg.length) {
    slide.addText(metaNoImg.join('   |   '), withTextBoxDefaults(style, {
      x: 0.8, y: 4.6, w: 11.75, h: 0.4,
      fontSize: 14, fontFace: style.bodyFont,
      color: 'A8C4E8', align: 'center', valign: 'mid'
    }));
  }
}

function addRouteSlide(slide, style, page, pages) {
  const fromKeyContent = parseRouteItemsFromText(page?.keyContent || '');
  const fromPages = buildRouteItemsFromPages(pages);
  // 优先使用模块页派生的路线（更完整，包含全部模块）
  // 只在没有模块页数据时，才降级使用 AI 返回的 keyContent
  const items = fromPages.length >= fromKeyContent.length
    ? fromPages
    : fromKeyContent;

  slide.addText(truncateText(page.summary || '按学习路径推进课堂任务，由浅入深完成阶段成果。', 72), withTextBoxDefaults(style, {
    x: 0.92,
    y: 1.5,
    w: 11.2,
    h: 0.6,
    fontSize: 17,
    fontFace: style.titleFont,
    color: style.title,
    bold: true,
    valign: 'top'
  }));

  items.forEach((item, index) => {
    const cols = items.length > 4 ? 2 : 2;
    const x = 1.0 + (index % cols) * 5.7;
    const rowH = items.length > 4 ? 0.85 : 1.12;
    const y = 2.16 + Math.floor(index / cols) * rowH;
    slide.addShape('roundRect', {
      x,
      y,
      w: 5.2,
      h: 0.92,
      rectRadius: 0.06,
      line: { color: style.accent, transparency: 82, pt: 0.8 },
      fill: { color: 'FFFFFF', transparency: 10 }
    });
    slide.addShape('ellipse', {
      x: x + 0.14,
      y: y + 0.18,
      w: 0.36,
      h: 0.36,
      line: { color: style.accent, pt: 0.2 },
      fill: { color: style.accent, transparency: 4 }
    });
    slide.addText(String(item.step || index + 1), withTextBoxDefaults(style, {
      x: x + 0.14,
      y: y + 0.2,
      w: 0.36,
      h: 0.26,
      fontSize: 11,
      color: 'FFFFFF',
      bold: true,
      align: 'center'
    }));
    slide.addText(item.title || `阶段${index + 1}`, withTextBoxDefaults(style, {
      x: x + 0.58,
      y: y + 0.15,
      w: 4.45,
      h: 0.28,
      fontSize: 13.5,
      fontFace: style.bodyFont,
      color: style.title,
      bold: true,
      valign: 'mid'
    }));
    slide.addText(item.phase || `阶段${index + 1}`, withTextBoxDefaults(style, {
      x: x + 3.72,
      y: y + 0.15,
      w: 1.3,
      h: 0.2,
      fontSize: 10.5,
      fontFace: style.bodyFont,
      color: style.accent,
      align: 'right'
    }));
    slide.addText(item.desc || '形成阶段成果', withTextBoxDefaults(style, {
      x: x + 0.58,
      y: y + 0.48,
      w: 4.45,
      h: 0.24,
      fontSize: 11.5,
      fontFace: style.bodyFont,
      color: style.accent,
      valign: 'mid'
    }));
  });
}

function addCompareSection(slide, style, page, x, y, w, h) {
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: style.accent, transparency: 84, pt: 0.8 },
    fill: { color: 'FFFFFF', transparency: 10 }
  });
  const points = uniqueTexts(page.keyContent, 4);
  const leftTitle = points[0] || '关键概念';
  const rightTitle = points[1] || '课堂任务';
  const leftDesc = truncateText(points[2] || page.summary || '围绕主题建立理解框架。', 44);
  const rightDesc = truncateText(points[3] || page.narrativeGoal || '将方法转化为可执行步骤。', 44);

  slide.addShape('line', {
    x: x + w / 2,
    y,
    w: 0,
    h,
    line: { color: style.accent, transparency: 76, pt: 0.8 }
  });

  slide.addText('对比讲解', withTextBoxDefaults(style, {
    x: x + 0.18,
    y: y + 0.12,
    w: 1.8,
    h: 0.22,
    fontSize: 12,
    fontFace: style.titleFont,
    color: style.accent,
    bold: true
  }));
  slide.addText(leftTitle, withTextBoxDefaults(style, {
    x: x + 0.25,
    y: y + 0.52,
    w: w / 2 - 0.35,
    h: 0.32,
    fontSize: 15.5,
    fontFace: style.titleFont,
    color: style.title,
    bold: true
  }));
  slide.addText(rightTitle, withTextBoxDefaults(style, {
    x: x + w / 2 + 0.1,
    y: y + 0.52,
    w: w / 2 - 0.35,
    h: 0.32,
    fontSize: 15.5,
    fontFace: style.titleFont,
    color: style.title,
    bold: true
  }));
  slide.addText(leftDesc, withTextBoxDefaults(style, {
    x: x + 0.25,
    y: y + 1.02,
    w: w / 2 - 0.35,
    h: h - 1.22,
    fontSize: 13,
    fontFace: style.bodyFont,
    color: style.title,
    valign: 'top'
  }));
  slide.addText(rightDesc, withTextBoxDefaults(style, {
    x: x + w / 2 + 0.1,
    y: y + 1.02,
    w: w / 2 - 0.35,
    h: h - 1.22,
    fontSize: 13,
    fontFace: style.bodyFont,
    color: style.title,
    valign: 'top'
  }));
}

function addOutlineSlide(pptx, style, pages) {
  const slide = pptx.addSlide();
  applySlideBackground(slide, style);
  addTopAccent(slide, style);
  addHeaderBlock(slide, style, {
    title: '课程路线图',
    subtitle: '从导入到成果交付的课堂推进路径',
    pageType: '路线图'
  });
  addRouteSlide(slide, style, {}, pages);
}

function addIntroSlide(slide, style, page, imagePath) {
  const hasImg = addImageOrPlaceholder(slide, style, imagePath, 7.18, 1.58, 5.02, 4.95, 'contain');
  // 有图：左文右图；无图：文本占全宽
  const textW = hasImg ? 5.95 : 11.45;
  addBulletSection(slide, style, page.summary, page.keyContent || [], 0.82, 1.58, textW, 4.95);
}

function addModuleSlide(slide, style, page, imagePath, variant = 'text-left') {
  const hasImg = Boolean(pickFilePath(imagePath));
  // 无图时一律用全宽文本布局
  if (!hasImg) {
    addBulletSection(slide, style, page.summary, page.keyContent || [], 0.82, 1.58, 11.45, 4.95);
    return;
  }
  if (variant === 'text-only') {
    addBulletSection(slide, style, page.summary, page.keyContent || [], 0.82, 1.58, 11.35, 4.95);
    return;
  }
  if (variant === 'cards') {
    addImageOrPlaceholder(slide, style, imagePath, 0.82, 1.58, 4.92, 4.95, 'contain');
    addModuleCardSection(slide, style, page, 5.98, 1.58, 6.2, 4.95);
    return;
  }
  if (variant === 'compare') {
    addCompareSection(slide, style, page, 0.82, 1.58, 7.18, 4.95);
    addImageOrPlaceholder(slide, style, imagePath, 8.18, 1.58, 4.0, 4.95, 'contain');
    return;
  }
  if (variant === 'text-right') {
    addImageOrPlaceholder(slide, style, imagePath, 0.82, 1.58, 5.0, 4.95, 'contain');
    addBulletSection(slide, style, page.summary, page.keyContent || [], 6.35, 1.58, 5.85, 4.95);
    return;
  }
  addBulletSection(slide, style, page.summary, page.keyContent || [], 0.82, 1.58, 5.98, 4.95);
  addImageOrPlaceholder(slide, style, imagePath, 7.18, 1.58, 5.0, 4.95, 'contain');
}

function addClosingSlide(slide, style, page) {
  slide.addShape('rect', {
    x: 0.78,
    y: 1.58,
    w: 12.0,
    h: 4.98,
    line: { color: style.accent, transparency: 84, pt: 0.8 },
    fill: { color: 'FFFFFF', transparency: 4 }
  });
  slide.addShape('rect', {
    x: 0.78,
    y: 1.58,
    w: 0.16,
    h: 4.98,
    line: { color: style.accent, pt: 0 },
    fill: { color: style.accent }
  });
  slide.addText(page.summary || '回顾重点、提示作业、衔接下次课。', withTextBoxDefaults(style, {
    x: 1.18,
    y: 1.96,
    w: 11.2,
    h: 0.68,
    fontSize: 21,
    fontFace: style.titleFont,
    bold: true,
    color: style.title,
    valign: 'top'
  }));
  const bulletRuns = (page.keyContent.length ? page.keyContent : ['课堂总结', '作业布置', '下节预告']).map((text) => ({
    text,
    options: { bullet: { indent: 16 } }
  }));
  slide.addText(bulletRuns, withTextBoxDefaults(style, {
    x: 1.28,
    y: 2.86,
    w: 10.9,
    h: 2.56,
    fontSize: 14.5,
    fontFace: style.bodyFont,
    color: style.title,
    breakLine: true,
    valign: 'top'
  }));
}

function addLectureSlides(pptx, pages, modules, style, lectureSections = [], qualityCollector = []) {
  pages.forEach((page) => {
    if (page.pageType === '封面') return;
    const slide = pptx.addSlide();

    // ── 优先：Canvas 合成图（WYSIWYG，直接嵌入整页）──
    const compositePath = pickFilePath(page.compositeImagePath);
    if (compositePath) {
      slide.addImage({
        path: compositePath,
        x: 0, y: 0, w: SLIDE.w, h: SLIDE.h,
        sizing: { type: 'cover', x: 0, y: 0, w: SLIDE.w, h: SLIDE.h }
      });
      // 演讲者备注仍然写入（文字备注不影响视觉）
      const noteText = (String(page.speakerNotes || '').trim())
        || mapPageNoteFromSections(page, [])
        || buildFallbackNote(page);
      attachSpeakerNotes(slide, noteText);
      qualityCollector.push({
        pageNumber: page.pageNumber, pageType: page.pageType,
        title: page.title, variant: 'composite',
        crowding: { score: 0, crowded: false }, noteMapped: Boolean(noteText)
      });
      return;
    }

    // 全屏插图模式：图片铺满 slide，不叠加任何元素
    const isFullscreen = (page.layout === '全屏插图' || page.layout === 'fullscreen');
    const fullImg = isFullscreen ? pickFilePath(page.imagePath) : '';
    if (fullImg) {
      slide.addImage({
        path: fullImg,
        x: 0, y: 0, w: SLIDE.w, h: SLIDE.h,
        sizing: { type: 'cover', x: 0, y: 0, w: SLIDE.w, h: SLIDE.h }
      });
      qualityCollector.push({
        pageNumber: page.pageNumber, pageType: page.pageType,
        title: page.title, variant: 'fullscreen',
        crowding: { score: 0, crowded: false }, noteMapped: false
      });
      return;
    }

    // 只使用页面自身选定的图片
    const imagePath = pickFilePath(page.imagePath);
    if (page.imagePath && !imagePath) {
      console.log(`[PPT] P${page.pageNumber} 图片路径无效: ${page.imagePath}`);
    }
    // 优先使用 page.speakerNotes，降级到 keyword 匹配，最后 fallback 到默认模板
    const mappedNote = (String(page.speakerNotes || '').trim())
      || mapPageNoteFromSections(page, lectureSections)
      || buildFallbackNote(page);
    attachSpeakerNotes(slide, mappedNote);

    // ── 路线图：纯文字布局，无背景图，使用标准 header
    if (page.pageType === '路线图') {
      applySlideBackground(slide, style);
      addTopAccent(slide, style);
      addSlideDecorations(slide, style, page.pageType);
      addHeaderBlock(slide, style, {
        title: page.title,
        subtitle: page.subtitle,
        pageType: page.pageType
      });
      addRouteSlide(slide, style, page, pages);
      qualityCollector.push({
        pageNumber: page.pageNumber,
        pageType: page.pageType,
        title: page.title,
        variant: 'route',
        crowding: page.crowding || analyzePageCrowding(page),
        noteMapped: Boolean(mappedNote)
      });
      return;
    }

    // ── 有背景图：全幅模式（renderFullBleedSlide 自带 header/content，不再另加 addHeaderBlock 避免文字重叠）
    const usedFullBleed = renderFullBleedSlide(slide, style, page, imagePath);
    if (usedFullBleed) {
      qualityCollector.push({
        pageNumber: page.pageNumber, pageType: page.pageType, title: page.title,
        variant: `fullbleed-${page.pageType || 'content'}`,
        crowding: page.crowding || analyzePageCrowding(page), noteMapped: Boolean(mappedNote)
      });
      return;
    }

    // ── 无图 fallback：标准布局（仅此路径调用 addHeaderBlock，避免与全幅 header 重叠）
    applySlideBackground(slide, style);
    addTopAccent(slide, style);
    addSlideDecorations(slide, style, page.pageType);
    addHeaderBlock(slide, style, {
      title: page.title,
      subtitle: page.subtitle,
      pageType: page.pageType
    });

    if (page.pageType === '课程导入') {
      addIntroSlide(slide, style, page, null);
      qualityCollector.push({
        pageNumber: page.pageNumber, pageType: page.pageType, title: page.title,
        variant: 'intro',
        crowding: page.crowding || analyzePageCrowding(page), noteMapped: Boolean(mappedNote)
      });
      return;
    }
    if (page.pageType === '总结' || page.pageType === '总结收束' || page.pageType === '封底') {
      addClosingSlide(slide, style, page);
      qualityCollector.push({
        pageNumber: page.pageNumber, pageType: page.pageType, title: page.title,
        variant: 'closing',
        crowding: page.crowding || analyzePageCrowding(page), noteMapped: Boolean(mappedNote)
      });
      return;
    }
    const variant = resolveSemanticVariant(page, page.crowding || analyzePageCrowding(page));
    addModuleSlide(slide, style, page, null, variant);
    qualityCollector.push({
      pageNumber: page.pageNumber, pageType: page.pageType, title: page.title,
      variant,
      crowding: page.crowding || analyzePageCrowding(page), noteMapped: Boolean(mappedNote)
    });
  });
}

async function exportCoursePpt({
  notebook,
  framework,
  modules,
  lectureScript,
  pptPages,
  templateBackground,
  templateKey,
  outputPath
}) {
  const style = TEMPLATE_STYLE[templateKey] || TEMPLATE_STYLE.pro_minimalist;
  const moduleList = normalizeModuleList(framework, modules);
  const pageList = splitDensePages(polishPageList(normalizePageList(pptPages)));

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.theme = {
    headFontFace: style.titleFont || style.bodyFont || 'Microsoft YaHei',
    bodyFontFace: style.bodyFont || style.titleFont || 'Microsoft YaHei',
    lang: 'zh-CN'
  };
  pptx.author = '广纺织课程助手@liu';
  pptx.company = '广纺织课程助手@liu';
  pptx.subject = notebook?.name || '课程设计';
  pptx.title = `${notebook?.name || '课程'}-课件`;
  pptx.lang = 'zh-CN';

  const coverPage = pageList.find((item) => item.pageType === '封面') || pageList[0] || null;
  const lectureSections = splitLectureScriptSections(lectureScript);
  const qualityCollector = [];
  addCoverSlide(pptx, notebook, style, coverPage);
  addLectureSlides(pptx, pageList, moduleList, style, lectureSections, qualityCollector);

  await pptx.writeFile({ fileName: outputPath });
  // 质量报告不写入磁盘：避免在老师的导出目录（如桌面）创建额外文件夹
  // 如需调试，可注释下方并配合 app.getPath('userData') 使用内部路径
  return outputPath;
}

module.exports = {
  exportCoursePpt
};
