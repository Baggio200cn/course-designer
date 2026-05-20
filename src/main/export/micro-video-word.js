/**
 * micro-video-word.js — 微课视频方案 Word 导出（v4.3.3 测试报告 #4 修复 · 2026-05-20）
 *
 * 测试报告暴露：之前没有微课视频方案 → Word 的真实下载入口（老师只能从 UI 看 JSON）。
 * 这个模块按 video_prompt artifact 的真实 schema 渲染 5 大段：
 *   ① 元信息（课程/主题/时长/受众）
 *   ② 旁白脚本（intro · body[] · outro，含时长/语气）
 *   ③ 分镜表（storyboard[]：镜头号 / 时长 / 类型 / 视觉描述 / 镜头角度 / 道具 / 光线 / 关联旁白）
 *   ④ 即梦提示词（jimengPrompts[]：镜头号 / prompt / 时长 / 比例 / 风格 / 负面词）
 *   ⑤ 拍摄指南 + 剪辑指南（shootingGuide / editingGuide）
 *
 * 字段映射严格对应 src/main/services/micro-video.service.js 的 normalizeMicroVideo 输出。
 *
 * Schema 守卫（H1 修复 C）：调用方传入 artifact 时缺关键字段 → throw，不静默生成空 docx。
 */

'use strict';

const fs = require('fs');
const {
  Document, Packer, Paragraph, HeadingLevel, TextRun,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  VerticalAlign, BorderStyle, ShadingType, PageOrientation,
} = require('docx');

const FONT_NAME = 'Microsoft YaHei';
const FONT = {
  title:        { font: FONT_NAME, size: 36, bold: true },
  sectionTitle: { font: FONT_NAME, size: 28, bold: true },
  subTitle:     { font: FONT_NAME, size: 24, bold: true },
  body:         { font: FONT_NAME, size: 22 },
  bodySmall:    { font: FONT_NAME, size: 20 },
  tableHead:    { font: FONT_NAME, size: 22, bold: true },
  caption:      { font: FONT_NAME, size: 18, color: '666666' },
};

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function run(text, override = {}) {
  return new TextRun({
    text: String(text == null ? '' : text),
    font: override.font || FONT.body.font,
    size: override.size || FONT.body.size,
    bold: !!override.bold,
    color: override.color,
  });
}

function p(text, fontOverride = FONT.body, align = AlignmentType.LEFT) {
  return new Paragraph({
    children: [run(text, fontOverride)],
    alignment: align,
    spacing: { after: 80 },
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [run(text, FONT.title)],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 160 },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [run(text, FONT.sectionTitle)],
    spacing: { before: 200, after: 100 },
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [run(text, FONT.subTitle)],
    spacing: { before: 140, after: 80 },
  });
}

function cell(text, font = FONT.body, opts = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    borders: BORDERS,
    children: [new Paragraph({
      children: [run(text, font)],
      alignment: opts.align || AlignmentType.LEFT,
    })],
  });
}

// ── Schema 守卫 ────────────────────────────────────────────────────────
//   测试报告 #4 根因：generic exporter 期望 script/shotList/editingNotes 老字段，
//   真实 video_prompt 是 narrationScript/storyboard/jimengPrompts。
//   这里硬拒绝缺字段的输入，明确报错而不是静默出空 docx。
function assertVideoSchema(microVideo) {
  if (!microVideo || typeof microVideo !== 'object') {
    throw new Error('[exportMicroVideoWord] microVideo 参数必须是对象');
  }
  const ns = microVideo.narrationScript;
  if (!ns || typeof ns !== 'object') {
    throw new Error('[exportMicroVideoWord] 缺 narrationScript（旁白脚本）· video_prompt 真实 schema');
  }
  if (!Array.isArray(microVideo.storyboard)) {
    throw new Error('[exportMicroVideoWord] 缺 storyboard 数组（分镜表）');
  }
  if (!Array.isArray(microVideo.jimengPrompts)) {
    throw new Error('[exportMicroVideoWord] 缺 jimengPrompts 数组（即梦提示词）');
  }
}

// ── 渲染主流程 ─────────────────────────────────────────────────────────
async function exportMicroVideoWord({ microVideo, outputPath, courseName, lessonNumber, videoTopic }) {
  assertVideoSchema(microVideo);
  if (!outputPath) throw new Error('[exportMicroVideoWord] outputPath 必填');

  const children = [];
  const docTitle = courseName
    ? `${courseName}·微课视频方案${lessonNumber ? `（L${lessonNumber}）` : ''}`
    : '微课视频方案';
  children.push(h1(docTitle));

  // ① 元信息
  children.push(h2('① 视频元信息'));
  // v4.3.3 Round 19 修复（codex 反馈 · 2026-05-20）：
  //   服务 normalizeMicroVideo 输出 targetAudience（line 197），不是 audience/target。
  //   之前会落空到 fallback"中职二年级学生"，老师填的受众完全消失。
  const metaRows = [
    ['课程名', courseName || microVideo.courseTitle || '（未填）'],
    ['视频主题', videoTopic || microVideo.videoTopic || '（未填）'],
    ['总时长', `${microVideo.durationSec || microVideo.duration || 60} 秒`],
    ['受众', microVideo.targetAudience || microVideo.audience || microVideo.target || '中职二年级学生'],
    ['镜头数', String(microVideo.storyboard.length)],
    ['即梦提示词数', String(microVideo.jimengPrompts.length)],
  ];
  const metaTableRows = metaRows.map(([k, v]) => new TableRow({
    children: [
      cell(k, FONT.tableHead, { width: 2400, shading: 'F3F4F6' }),
      cell(v, FONT.body, { width: 6960 }),
    ],
  }));
  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2400, 6960],
    rows: metaTableRows,
  }));
  children.push(p(''));

  // ② 旁白脚本
  children.push(h2('② 旁白脚本（intro · body · outro）'));
  const ns = microVideo.narrationScript;
  if (ns.intro) {
    children.push(h3('🎬 intro · 开场'));
    children.push(p(`时长：${ns.intro.duration || 10} 秒　|　语气：${ns.intro.tone || '提问式'}`, FONT.caption));
    children.push(p(ns.intro.text || '（未填）'));
  }
  if (Array.isArray(ns.body) && ns.body.length > 0) {
    children.push(h3(`🎬 body · 主体（${ns.body.length} 段）`));
    ns.body.forEach((b, i) => {
      children.push(p(`第 ${i + 1} 段 · ${b.section || '知识点'} · 时长 ${b.duration || 15} 秒`, { ...FONT.body, bold: true }));
      children.push(p(b.narration || '（未填）'));
    });
  }
  if (ns.outro) {
    children.push(h3('🎬 outro · 收尾'));
    children.push(p(`时长：${ns.outro.duration || 10} 秒　|　call to action：${ns.outro.callToAction || ''}`, FONT.caption));
    children.push(p(ns.outro.text || '（未填）'));
  }
  children.push(p(''));

  // ③ 分镜表
  children.push(h2(`③ 分镜表（${microVideo.storyboard.length} 个镜头）`));
  const sbHead = new TableRow({
    children: [
      cell('镜头', FONT.tableHead, { width: 700, shading: 'E0E7FF', align: AlignmentType.CENTER }),
      cell('时长(秒)', FONT.tableHead, { width: 900, shading: 'E0E7FF', align: AlignmentType.CENTER }),
      cell('类型', FONT.tableHead, { width: 900, shading: 'E0E7FF', align: AlignmentType.CENTER }),
      cell('视觉描述', FONT.tableHead, { width: 3200, shading: 'E0E7FF' }),
      cell('镜头角度', FONT.tableHead, { width: 1100, shading: 'E0E7FF' }),
      cell('光线/道具', FONT.tableHead, { width: 1500, shading: 'E0E7FF' }),
      cell('关联旁白', FONT.tableHead, { width: 1060, shading: 'E0E7FF' }),
    ],
  });
  const sbRows = microVideo.storyboard.map((s) => new TableRow({
    children: [
      cell(`#${s.shotNumber}`, FONT.bodySmall, { width: 700, align: AlignmentType.CENTER }),
      cell(String(s.duration || ''), FONT.bodySmall, { width: 900, align: AlignmentType.CENTER }),
      cell(s.type || '—', FONT.bodySmall, { width: 900, align: AlignmentType.CENTER }),
      cell(s.visualDescription || '', FONT.bodySmall, { width: 3200 }),
      cell(s.cameraAngle || '中景', FONT.bodySmall, { width: 1100 }),
      cell(`${s.lighting || ''}${Array.isArray(s.props) && s.props.length ? ` / ${s.props.join('·')}` : ''}`, FONT.bodySmall, { width: 1500 }),
      cell(s.linkedNarration || '', FONT.bodySmall, { width: 1060 }),
    ],
  }));
  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [700, 900, 900, 3200, 1100, 1500, 1060],
    rows: [sbHead, ...sbRows],
  }));
  children.push(p(''));

  // ④ 即梦提示词
  children.push(h2(`④ 即梦（Jimeng）提示词（${microVideo.jimengPrompts.length} 条）`));
  const jpHead = new TableRow({
    children: [
      cell('镜头', FONT.tableHead, { width: 700, shading: 'FEF3C7', align: AlignmentType.CENTER }),
      cell('提示词（prompt）', FONT.tableHead, { width: 5400, shading: 'FEF3C7' }),
      cell('比例', FONT.tableHead, { width: 800, shading: 'FEF3C7', align: AlignmentType.CENTER }),
      cell('风格', FONT.tableHead, { width: 1300, shading: 'FEF3C7' }),
      cell('时长(秒)', FONT.tableHead, { width: 1160, shading: 'FEF3C7', align: AlignmentType.CENTER }),
    ],
  });
  const jpRows = microVideo.jimengPrompts.map((j) => new TableRow({
    children: [
      cell(`#${j.shotNumber}`, FONT.bodySmall, { width: 700, align: AlignmentType.CENTER }),
      cell(j.prompt || '', FONT.bodySmall, { width: 5400 }),
      cell(j.aspectRatio || '9:16', FONT.bodySmall, { width: 800, align: AlignmentType.CENTER }),
      cell(j.style || '写实教学风', FONT.bodySmall, { width: 1300 }),
      cell(String(j.duration || ''), FONT.bodySmall, { width: 1160, align: AlignmentType.CENTER }),
    ],
  }));
  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [700, 5400, 800, 1300, 1160],
    rows: [jpHead, ...jpRows],
  }));
  // 负面提示词集中提示
  const negs = microVideo.jimengPrompts.map((j) => j.negativePrompt).filter(Boolean);
  if (negs.length > 0) {
    children.push(p(`📌 负面词参考：${negs[0]}`, FONT.caption));
  }
  children.push(p(''));

  // ⑤ 拍摄指南 + 剪辑指南
  if (microVideo.shootingGuide) {
    children.push(h2('⑤ 拍摄指南'));
    const sg = microVideo.shootingGuide;
    if (Array.isArray(sg.equipmentRecommendation) && sg.equipmentRecommendation.length > 0) {
      children.push(p(`📷 设备建议：${sg.equipmentRecommendation.join(' / ')}`));
    }
    if (sg.location) children.push(p(`🏠 场地：${sg.location}`));
    if (sg.lightingTips) children.push(p(`💡 光线：${sg.lightingTips}`));
    if (sg.soundTips) children.push(p(`🎤 录音：${sg.soundTips}`));
    if (sg.presenterTips) children.push(p(`👨‍🏫 出镜：${sg.presenterTips}`));
  }
  if (microVideo.editingGuide) {
    children.push(h2('⑥ 剪辑指南'));
    const eg = microVideo.editingGuide;
    // v4.3.3 Round 19 修复（codex 反馈 · 2026-05-20）·剪辑指南字段全部对齐 service 真实输出：
    //   service.normalizeMicroVideo 输出 { rhythm, transitions[], music{type,volume},
    //                                       subtitles{style,keyPoints}, platforms[] }
    //   之前导出器读 pace/eg.transitions(直接拼)/eg.subtitles(直接对象→[object Object])/eg.tools(根本不存在)
    if (eg.rhythm || eg.pace) {
      children.push(p(`⏩ 节奏：${eg.rhythm || eg.pace}`));
    }
    if (eg.transitions) {
      const tx = Array.isArray(eg.transitions) ? eg.transitions.join(' / ') : String(eg.transitions);
      if (tx) children.push(p(`🔀 转场：${tx}`));
    }
    if (eg.music) {
      const m = eg.music;
      children.push(p(`🎵 音乐：${typeof m === 'string' ? m : `${m.type || ''}${m.volume ? ` · ${m.volume}` : ''}`}`));
    }
    if (eg.subtitles) {
      const s = eg.subtitles;
      if (typeof s === 'string') {
        children.push(p(`💬 字幕：${s}`));
      } else if (s.style || s.keyPoints) {
        children.push(p(`💬 字幕：${s.style || ''}${s.keyPoints ? ` · ${s.keyPoints}` : ''}`));
      }
    }
    // 服务真实字段 platforms[]（投放平台），老 tools 仅作向后兼容
    const platforms = Array.isArray(eg.platforms) ? eg.platforms : (Array.isArray(eg.tools) ? eg.tools : null);
    if (platforms && platforms.length) {
      children.push(p(`📺 投放平台：${platforms.join(' / ')}`));
    } else if (typeof eg.tools === 'string') {
      children.push(p(`🛠 推荐工具：${eg.tools}`));
    }
  }

  // 页脚水印
  children.push(p('—— 驭课 Agent v4.3.3 生成 ——', { ...FONT.caption, color: '999999' }, AlignmentType.CENTER));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT_NAME, size: FONT.body.size } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4 portrait
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // 2cm
        },
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

module.exports = { exportMicroVideoWord, assertVideoSchema };
