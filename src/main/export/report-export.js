/**
 * report-export.js — 教学实施报告 4 格式导出（驭课 Agent v4.0.0 / Phase-9 C-4）
 *
 * 支持：
 *   exportReportWord     → .docx（用 docx 库）
 *   exportReportMarkdown → .md（纯文本拼接）
 *   exportReportHtml     → .html（自包含含 CSS）
 *   exportReportPdf      → .pdf（用 Electron BrowserWindow.printToPDF）
 *
 * 输入数据：normalizeReport 后的 report 对象
 */

const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const {
  Document, Packer, Paragraph, HeadingLevel, TextRun,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  VerticalAlign, BorderStyle, ShadingType, PageOrientation,
} = require('docx');

const FONT_NAME = 'Microsoft YaHei';
const FONT = {
  title: { font: FONT_NAME, size: 36, bold: true },
  sectionTitle: { font: FONT_NAME, size: 28, bold: true },
  subTitle: { font: FONT_NAME, size: 24, bold: true },
  body: { font: FONT_NAME, size: 22 },
  tableHead: { font: FONT_NAME, size: 22, bold: true },
};

const OUTCOME_LABELS = {
  studentEngagement: '学生参与度',
  workCompletion: '作品完成度',
  skillTransfer: '技能迁移',
  industryAlignment: '行业对接',
  ideologicalImpact: '思政育人',
};
const REFLECTION_LABELS = {
  achievements: '主要成效',
  issues: '存在问题',
  improvements: '改进措施',
  futurePlans: '未来规划',
};

function arr(v) { return Array.isArray(v) ? v : []; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ═══════════════════════════════════════════════════════════════
// 1. WORD (.docx)
// ═══════════════════════════════════════════════════════════════

function styledRun(text, override = {}) {
  return new TextRun({
    text: String(text == null ? '' : text),
    font: override.font || FONT.body.font,
    size: override.size || FONT.body.size,
    bold: override.bold || false,
  });
}
function p(text, override = {}, alignment = AlignmentType.LEFT) {
  return new Paragraph({
    alignment,
    children: [styledRun(text, override)],
    spacing: { before: 60, after: 60 },
  });
}
function cell(text, override = {}, opts = {}) {
  const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
  return new TableCell({
    borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER },
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [styledRun(text, override)],
    })],
  });
}

/**
 * Schema 守卫（v4.3.3 测试报告修复 C · 2026-05-20）：
 *   测试报告交付问题 #5 暴露：caller 写老字段名 lessonOverview/objectivesAchievement/
 *   teachingHighlights 等，但 exportReportWord 读 implementationOutcomes.{studentEngagement,
 *   workCompletion,skillTransfer,industryAlignment,ideologicalImpact} +
 *   reflectionAndImprovement.{achievements,issues,improvements,futurePlans} +
 *   preInClassPostFlow.{preInClass,inClassPhases,postClass}。
 *   结果所有字段被认为"未填"，生成几乎空白的 docx。
 *   这里硬拒绝：检测老字段名 → throw；缺关键字段（implementationOutcomes/
 *   reflectionAndImprovement/preInClassPostFlow 三选一存在）→ throw。
 */
function assertReportSchema(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('[exportReportWord] report 参数必须是对象（不能为空）');
  }
  // 老/错字段名识别
  const LEGACY = ['lessonOverview', 'objectivesAchievement', 'teachingHighlights'];
  const legacyHit = LEGACY.filter((k) => k in report);
  if (legacyHit.length >= 2) {
    throw new Error(
      `[exportReportWord] 检测到老字段名（${legacyHit.join(' / ')}）· 正确 schema 应使用 ` +
      'implementationOutcomes（5 项）+ reflectionAndImprovement（4 项）+ preInClassPostFlow。' +
      ' 详见 v4.3.3 测试报告交付问题 #5。'
    );
  }
  // 关键字段三选一必有
  const hasOutcomes = !!report.implementationOutcomes;
  const hasReflection = !!report.reflectionAndImprovement;
  const hasFlow = !!report.preInClassPostFlow;
  if (!hasOutcomes && !hasReflection && !hasFlow) {
    throw new Error(
      '[exportReportWord] report 缺关键字段：implementationOutcomes / reflectionAndImprovement / preInClassPostFlow 至少需要一个'
    );
  }
}

async function exportReportWord({ report, outputPath }) {
  assertReportSchema(report);
  if (!outputPath) throw new Error('[exportReportWord] outputPath 必填');

  const children = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [styledRun(`${report.courseName || '课程'}教学实施报告`, FONT.title)],
    spacing: { before: 100, after: 200 },
  }));

  // 表头信息
  children.push(p(`课程：${report.courseName || '—'}　·　学校：${report.school || '—'}　·　学年：${report.academicYear || '—'}　·　学期：${report.term || '—'}　·　教师：${report.teacher || '—'}`, FONT.body));
  children.push(p('', FONT.body));

  // ① 教学目标
  children.push(p('一、教学目标', FONT.sectionTitle));
  const obj = report.teachingObjectives || {};
  if (arr(obj.knowledge).length) { children.push(p('知识目标', FONT.subTitle)); arr(obj.knowledge).forEach((k) => children.push(p(`  • ${k}`, FONT.body))); }
  if (arr(obj.skill).length)     { children.push(p('技能目标', FONT.subTitle)); arr(obj.skill).forEach((k) => children.push(p(`  • ${k}`, FONT.body))); }
  if (arr(obj.emotion).length)   { children.push(p('素养目标', FONT.subTitle)); arr(obj.emotion).forEach((k) => children.push(p(`  • ${k}`, FONT.body))); }

  // ② 重点难点
  const kd = report.keyPointsAndDifficulties || {};
  children.push(p('二、教学重点与难点', FONT.sectionTitle));
  if (arr(kd.keyPoints).length) { children.push(p('教学重点', FONT.subTitle)); arr(kd.keyPoints).forEach((k) => children.push(p(`  • ${k}`, FONT.body))); }
  if (arr(kd.difficulties).length) { children.push(p('教学难点', FONT.subTitle)); arr(kd.difficulties).forEach((k) => children.push(p(`  • ${k}`, FONT.body))); }

  // ③ 教学方法
  children.push(p('三、教学方法', FONT.sectionTitle));
  arr(report.teachingMethods).forEach((m) => children.push(p(`  • ${m.name || ''}（${m.applicable || '通用'}）`, FONT.body)));

  // ④ 总体安排
  if (report.overallArrangement) {
    children.push(p('四、教学过程总体安排', FONT.sectionTitle));
    children.push(p(report.overallArrangement, FONT.body));
  }

  // ⑤ 课前-课中-课后
  const flow = report.preInClassPostFlow || {};
  children.push(p('五、课前-课中-课后实施流程', FONT.sectionTitle));
  if (flow.preClass?.tasks?.length) {
    children.push(p('课前任务', FONT.subTitle));
    flow.preClass.tasks.forEach((t, i) => children.push(p(`  ${i + 1}. ${t}`, FONT.body)));
    if (flow.preClass.outcome) children.push(p(`预期成果：${flow.preClass.outcome}`, FONT.body));
  }
  if (flow.inClassPhases?.length) {
    children.push(p('课中（5 段法）', FONT.subTitle));
    flow.inClassPhases.forEach((ph) => children.push(p(`  · ${ph.phase}：${ph.highlight || '—'}`, FONT.body)));
  }
  if (flow.postClass?.homework?.length) {
    children.push(p('课后任务', FONT.subTitle));
    flow.postClass.homework.forEach((h, i) => children.push(p(`  ${i + 1}. ${h}`, FONT.body)));
    if (flow.postClass.feedback) children.push(p(`反馈机制：${flow.postClass.feedback}`, FONT.body));
  }

  // ⑥ 信息化手段
  const info = report.informatization || {};
  children.push(p('六、信息化手段', FONT.sectionTitle));
  if (info.platform) children.push(p(`平台：${info.platform}`, FONT.body));
  if (arr(info.tools).length) children.push(p(`工具：${arr(info.tools).join('、')}`, FONT.body));
  if (info.purpose) children.push(p(`目的：${info.purpose}`, FONT.body));

  // ⑦ 微课视频应用
  if (report.microVideoUsage) {
    children.push(p('七、微课视频应用', FONT.sectionTitle));
    children.push(p(report.microVideoUsage, FONT.body));
  }

  // ⑧ 课堂教学实施成效（老师手填）
  children.push(p('八、课堂教学实施成效（老师课后填写）', FONT.sectionTitle));
  const outcomes = report.implementationOutcomes || {};
  Object.keys(OUTCOME_LABELS).forEach((k) => {
    const o = outcomes[k] || {};
    children.push(p(OUTCOME_LABELS[k], FONT.subTitle));
    children.push(p(`达成情况：${o.achieved || '（未填）'}`, FONT.body));
    children.push(p(`支持证据：${o.evidence || '（未填）'}`, FONT.body));
  });

  // ⑨ 反思与改进（老师手填）
  children.push(p('九、反思与改进（老师课后填写）', FONT.sectionTitle));
  const refl = report.reflectionAndImprovement || {};
  Object.keys(REFLECTION_LABELS).forEach((k) => {
    children.push(p(REFLECTION_LABELS[k], FONT.subTitle));
    const items = arr(refl[k]);
    if (items.length === 0) {
      children.push(p('（未填）', FONT.body));
    } else {
      items.forEach((item, i) => children.push(p(`  ${i + 1}. ${item}`, FONT.body)));
    }
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT_NAME, size: FONT.body.size } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════
// 2. MARKDOWN (.md)
// ═══════════════════════════════════════════════════════════════

function exportReportMarkdown({ report, outputPath }) {
  if (!report) throw new Error('report 内容为空');
  const lines = [];
  lines.push(`# ${report.courseName || '课程'}教学实施报告`);
  lines.push('');
  lines.push(`> 学校：${report.school || '—'} · 学年：${report.academicYear || '—'} · 学期：${report.term || '—'} · 教师：${report.teacher || '—'}`);
  lines.push('');

  lines.push('## 一、教学目标');
  const obj = report.teachingObjectives || {};
  if (arr(obj.knowledge).length) { lines.push('### 知识目标'); arr(obj.knowledge).forEach((k) => lines.push(`- ${k}`)); }
  if (arr(obj.skill).length)     { lines.push('### 技能目标'); arr(obj.skill).forEach((k) => lines.push(`- ${k}`)); }
  if (arr(obj.emotion).length)   { lines.push('### 素养目标'); arr(obj.emotion).forEach((k) => lines.push(`- ${k}`)); }
  lines.push('');

  const kd = report.keyPointsAndDifficulties || {};
  lines.push('## 二、教学重点与难点');
  if (arr(kd.keyPoints).length) { lines.push('### 教学重点'); arr(kd.keyPoints).forEach((k) => lines.push(`- ${k}`)); }
  if (arr(kd.difficulties).length) { lines.push('### 教学难点'); arr(kd.difficulties).forEach((k) => lines.push(`- ${k}`)); }
  lines.push('');

  lines.push('## 三、教学方法');
  arr(report.teachingMethods).forEach((m) => lines.push(`- **${m.name || ''}** — ${m.applicable || '通用'}`));
  lines.push('');

  if (report.overallArrangement) {
    lines.push('## 四、教学过程总体安排');
    lines.push(report.overallArrangement);
    lines.push('');
  }

  const flow = report.preInClassPostFlow || {};
  lines.push('## 五、课前-课中-课后实施流程');
  if (flow.preClass?.tasks?.length) {
    lines.push('### 课前任务');
    flow.preClass.tasks.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    if (flow.preClass.outcome) lines.push(`> 预期成果：${flow.preClass.outcome}`);
  }
  if (flow.inClassPhases?.length) {
    lines.push('### 课中（5 段法）');
    flow.inClassPhases.forEach((ph) => lines.push(`- **${ph.phase}**：${ph.highlight || '—'}`));
  }
  if (flow.postClass?.homework?.length) {
    lines.push('### 课后任务');
    flow.postClass.homework.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
    if (flow.postClass.feedback) lines.push(`> 反馈机制：${flow.postClass.feedback}`);
  }
  lines.push('');

  const info = report.informatization || {};
  lines.push('## 六、信息化手段');
  if (info.platform) lines.push(`- **平台**：${info.platform}`);
  if (arr(info.tools).length) lines.push(`- **工具**：${arr(info.tools).join('、')}`);
  if (info.purpose) lines.push(`- **目的**：${info.purpose}`);
  lines.push('');

  if (report.microVideoUsage) {
    lines.push('## 七、微课视频应用');
    lines.push(report.microVideoUsage);
    lines.push('');
  }

  lines.push('## 八、课堂教学实施成效（老师课后填写）');
  const outcomes = report.implementationOutcomes || {};
  Object.keys(OUTCOME_LABELS).forEach((k) => {
    const o = outcomes[k] || {};
    lines.push(`### ${OUTCOME_LABELS[k]}`);
    lines.push(`- 达成情况：${o.achieved || '（未填）'}`);
    lines.push(`- 支持证据：${o.evidence || '（未填）'}`);
  });
  lines.push('');

  lines.push('## 九、反思与改进（老师课后填写）');
  const refl = report.reflectionAndImprovement || {};
  Object.keys(REFLECTION_LABELS).forEach((k) => {
    lines.push(`### ${REFLECTION_LABELS[k]}`);
    const items = arr(refl[k]);
    if (items.length === 0) lines.push('（未填）');
    else items.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
  });
  lines.push('');

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════
// 3. HTML (.html) —— 自包含 + CSS + 用于 PDF 渲染
// ═══════════════════════════════════════════════════════════════

function buildReportHtml(report) {
  if (!report) return '';
  const obj = report.teachingObjectives || {};
  const kd = report.keyPointsAndDifficulties || {};
  const flow = report.preInClassPostFlow || {};
  const info = report.informatization || {};
  const outcomes = report.implementationOutcomes || {};
  const refl = report.reflectionAndImprovement || {};

  const ulList = (items) => arr(items).length === 0
    ? '<p class="hint">（未填）</p>'
    : `<ul>${arr(items).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

  const olList = (items) => arr(items).length === 0
    ? '<p class="hint">（未填）</p>'
    : `<ol>${arr(items).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${esc(report.courseName || '课程')}教学实施报告</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 30px; color: #1f2937; line-height: 1.7; background: white; }
  h1 { text-align: center; font-size: 28px; color: #1B2E6B; margin-bottom: 10px; padding-bottom: 12px; border-bottom: 3px solid #3b82f6; }
  .meta { text-align: center; color: #6b7280; font-size: 13px; margin-bottom: 32px; padding: 12px; background: #f3f4f6; border-radius: 6px; }
  h2 { font-size: 18px; color: #1f2937; border-left: 4px solid #3b82f6; padding-left: 10px; margin-top: 28px; }
  h3 { font-size: 15px; color: #374151; margin-top: 16px; }
  ul, ol { padding-left: 20px; }
  li { margin-bottom: 4px; }
  .hint { color: #9ca3af; font-style: italic; font-size: 13px; }
  .section { background: #fafafa; padding: 16px; border-radius: 6px; margin-bottom: 16px; }
  .outcome-card { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin-bottom: 10px; }
  .outcome-card h3 { margin-top: 0; color: #0ea5e9; }
  .achieved { background: #f0f9ff; padding: 8px 12px; border-radius: 4px; margin-bottom: 6px; }
  .evidence { background: #fffbeb; padding: 8px 12px; border-radius: 4px; }
  .label { font-weight: 600; color: #475569; margin-right: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
  th { background: #f1f5f9; font-weight: 600; }
  @media print { body { padding: 20px; } h2 { page-break-after: avoid; } .outcome-card { page-break-inside: avoid; } }
</style>
</head>
<body>
<h1>${esc(report.courseName || '课程')}教学实施报告</h1>
<div class="meta">
  学校：${esc(report.school || '—')}　·　学年：${esc(report.academicYear || '—')}　·　学期：${esc(report.term || '—')}　·　教师：${esc(report.teacher || '—')}
</div>

<h2>一、教学目标</h2>
${arr(obj.knowledge).length ? `<h3>知识目标</h3>${ulList(obj.knowledge)}` : ''}
${arr(obj.skill).length     ? `<h3>技能目标</h3>${ulList(obj.skill)}`     : ''}
${arr(obj.emotion).length   ? `<h3>素养目标</h3>${ulList(obj.emotion)}`   : ''}

<h2>二、教学重点与难点</h2>
${arr(kd.keyPoints).length    ? `<h3>教学重点</h3>${ulList(kd.keyPoints)}`    : ''}
${arr(kd.difficulties).length ? `<h3>教学难点</h3>${ulList(kd.difficulties)}` : ''}

<h2>三、教学方法</h2>
<table>
  <thead><tr><th>方法</th><th>适用环节</th></tr></thead>
  <tbody>
    ${arr(report.teachingMethods).map((m) => `<tr><td>${esc(m.name || '')}</td><td>${esc(m.applicable || '通用')}</td></tr>`).join('')}
  </tbody>
</table>

${report.overallArrangement ? `
<h2>四、教学过程总体安排</h2>
<p>${esc(report.overallArrangement)}</p>` : ''}

<h2>五、课前-课中-课后实施流程</h2>
${flow.preClass?.tasks?.length ? `
<h3>课前任务</h3>
${olList(flow.preClass.tasks)}
${flow.preClass.outcome ? `<p><span class="label">预期成果：</span>${esc(flow.preClass.outcome)}</p>` : ''}` : ''}
${flow.inClassPhases?.length ? `
<h3>课中（5 段法）</h3>
<ul>${flow.inClassPhases.map((ph) => `<li><strong>${esc(ph.phase)}</strong>：${esc(ph.highlight || '—')}</li>`).join('')}</ul>` : ''}
${flow.postClass?.homework?.length ? `
<h3>课后任务</h3>
${olList(flow.postClass.homework)}
${flow.postClass.feedback ? `<p><span class="label">反馈机制：</span>${esc(flow.postClass.feedback)}</p>` : ''}` : ''}

<h2>六、信息化手段</h2>
${info.platform           ? `<p><span class="label">平台：</span>${esc(info.platform)}</p>` : ''}
${arr(info.tools).length  ? `<p><span class="label">工具：</span>${arr(info.tools).map(esc).join('、')}</p>` : ''}
${info.purpose            ? `<p><span class="label">目的：</span>${esc(info.purpose)}</p>` : ''}

${report.microVideoUsage ? `
<h2>七、微课视频应用</h2>
<p>${esc(report.microVideoUsage)}</p>` : ''}

<h2>八、课堂教学实施成效（老师课后填写）</h2>
${Object.keys(OUTCOME_LABELS).map((k) => {
  const o = outcomes[k] || {};
  return `<div class="outcome-card">
    <h3>${esc(OUTCOME_LABELS[k])}</h3>
    <div class="achieved"><span class="label">达成情况：</span>${esc(o.achieved || '（未填）')}</div>
    <div class="evidence"><span class="label">支持证据：</span>${esc(o.evidence || '（未填）')}</div>
  </div>`;
}).join('')}

<h2>九、反思与改进（老师课后填写）</h2>
${Object.keys(REFLECTION_LABELS).map((k) => `
<h3>${esc(REFLECTION_LABELS[k])}</h3>
${olList(refl[k])}
`).join('')}

</body>
</html>`;
}

function exportReportHtml({ report, outputPath }) {
  if (!report) throw new Error('report 内容为空');
  const html = buildReportHtml(report);
  fs.writeFileSync(outputPath, html, 'utf-8');
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════
// 4. PDF (.pdf) —— Electron BrowserWindow.printToPDF
// ═══════════════════════════════════════════════════════════════

async function exportReportPdf({ report, outputPath }) {
  if (!report) throw new Error('report 内容为空');
  if (!outputPath) throw new Error('outputPath 必填');

  const html = buildReportHtml(report);
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1448,
    webPreferences: { sandbox: false, offscreen: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
    // 等字体/资源加载
    await win.webContents.executeJavaScript(`new Promise((resolve) => {
      const wait = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      wait.then(() => setTimeout(resolve, 500));
    });`);
    const pdfBuffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },  // 英寸
    });
    fs.writeFileSync(outputPath, pdfBuffer);
    return outputPath;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = {
  exportReportWord,
  exportReportMarkdown,
  exportReportHtml,
  exportReportPdf,
  buildReportHtml,
  assertReportSchema,   // v4.3.3 测试报告修复 C · 防字段错配
};
