/**
 * design-word.js — 教学设计 Word 导出（驭课 Agent v4.0.0 / Phase-9 C-2）
 *
 * 输出结构：
 *   ① 标题
 *   ② 教学目标（知识/技能/素养 三类）
 *   ③ 教学重点 / 难点
 *   ④ 教学方法表（方法 / 描述 / 适用环节）
 *   ⑤ 教学资源（教材 / 平台 / 软件工具 / 场地）
 *   ⑥ 课前任务
 *   ⑦ 课中 5 段法教学过程表（环节 / 时长 / 教师 / 学生 / 评价）
 *   ⑧ 课后作业 + 反馈
 *   ⑨ 信息化手段
 *   ⑩ 考核评价（4 项权重 = 100）
 *   ⑪ 思政元素
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, HeadingLevel, TextRun, ImageRun,
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
const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function styledRun(text, override = {}) {
  return new TextRun({
    text: String(text == null ? '' : text),
    font: override.font || FONT.body.font,
    size: override.size || FONT.body.size,
    bold: override.bold || false,
    color: override.color || undefined,
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
  return new TableCell({
    borders: BORDERS,
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
function arr(v) { return Array.isArray(v) ? v : []; }

/**
 * 主导出函数
 * @param {Object} params
 * @param {string} params.courseName
 * @param {Object} params.design
 * @param {string} params.outputPath
 * @param {string} [params.infographicPath]  AI 生成的 PNG 信息图绝对路径，可空
 */
async function exportDesignWord({ courseName, design, outputPath, infographicPath = null }) {
  if (!design || typeof design !== 'object') throw new Error('design 内容为空');
  if (!outputPath) throw new Error('outputPath 必填');

  const children = [];

  // ── ① 标题 ─────────────────────────────────────────
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [styledRun(`${courseName || '课程'}教学设计`, FONT.title)],
    spacing: { before: 100, after: 200 },
  }));

  // ── 信息图（如有，置于教学目标之前作为整体概览） ──
  if (infographicPath && fs.existsSync(infographicPath)) {
    try {
      const ext = path.extname(infographicPath).toLowerCase().replace('.', '') || 'png';
      const imgBuffer = fs.readFileSync(infographicPath);
      const imgType = ext === 'jpg' ? 'jpeg' : ext;  // docx 库只接受 jpeg
      // 9 寸宽（A4 - 边距），按 PNG 默认比例缩放
      const targetWidth = 600;
      const targetHeight = 840;  // 视觉默认 1000 × 1400 → 缩放到 600 × 840
      children.push(p('教学设计概览（AI 信息图）', FONT.sectionTitle));
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({
          type: imgType,
          data: imgBuffer,
          transformation: { width: targetWidth, height: targetHeight },
          altText: { title: '教学设计信息图', description: 'AI 生成的整门课教学设计可视化', name: 'design-infographic' },
        })],
      }));
      children.push(p('', FONT.body));
    } catch (e) {
      console.error('[design-word] 嵌入信息图失败：', e.message);
    }
  }

  // ── ② 教学目标 ─────────────────────────────────────
  const obj = design.teachingObjectives || {};
  if (arr(obj.knowledge).length || arr(obj.skill).length || arr(obj.emotion).length) {
    children.push(p('一、教学目标', FONT.sectionTitle));
    if (arr(obj.knowledge).length) {
      children.push(p('知识目标', FONT.subTitle));
      arr(obj.knowledge).forEach((k) => children.push(p(`  • ${k}`, FONT.body)));
    }
    if (arr(obj.skill).length) {
      children.push(p('技能目标', FONT.subTitle));
      arr(obj.skill).forEach((k) => children.push(p(`  • ${k}`, FONT.body)));
    }
    if (arr(obj.emotion).length) {
      children.push(p('素养目标', FONT.subTitle));
      arr(obj.emotion).forEach((k) => children.push(p(`  • ${k}`, FONT.body)));
    }
  }

  // ── ③ 教学重点 / 难点 ──────────────────────────────
  if (arr(design.keyPoints).length || arr(design.difficulties).length) {
    children.push(p('二、教学重点与难点', FONT.sectionTitle));
    if (arr(design.keyPoints).length) {
      children.push(p('教学重点', FONT.subTitle));
      arr(design.keyPoints).forEach((k) => children.push(p(`  • ${k}`, FONT.body)));
    }
    if (arr(design.difficulties).length) {
      children.push(p('教学难点', FONT.subTitle));
      arr(design.difficulties).forEach((d) => children.push(p(`  • ${d}`, FONT.body)));
    }
  }

  // ── ④ 教学方法表 ─────────────────────────────────────
  if (arr(design.teachingMethods).length) {
    children.push(p('三、教学方法', FONT.sectionTitle));
    const methodRows = [
      new TableRow({
        tableHeader: true,
        children: [
          cell('方法', FONT.tableHead, { width: 1800, shading: 'D5E8F0', align: AlignmentType.CENTER }),
          cell('简介', FONT.tableHead, { width: 4760, shading: 'D5E8F0', align: AlignmentType.CENTER }),
          cell('适用环节', FONT.tableHead, { width: 2800, shading: 'D5E8F0', align: AlignmentType.CENTER }),
        ],
      }),
      ...arr(design.teachingMethods).map((m) => new TableRow({
        children: [
          cell(m.name || '', FONT.body, { width: 1800, align: AlignmentType.CENTER }),
          cell(m.desc || '—', FONT.body, { width: 4760 }),
          cell(m.applicable || '—', FONT.body, { width: 2800, align: AlignmentType.CENTER }),
        ],
      })),
    ];
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [1800, 4760, 2800],
      rows: methodRows,
    }));
    children.push(p('', FONT.body));
  }

  // ── ⑤ 教学资源 ─────────────────────────────────────
  const res = design.teachingResources || {};
  if (res.textbook || arr(res.softwareTools).length || arr(res.venues).length) {
    children.push(p('四、教学资源', FONT.sectionTitle));
    if (res.textbook) children.push(p(`教材：${res.textbook}`, FONT.body));
    if (res.platform) children.push(p(`教学平台：${res.platform}`, FONT.body));
    if (arr(res.softwareTools).length) children.push(p(`软件工具：${arr(res.softwareTools).join('、')}`, FONT.body));
    if (arr(res.venues).length) children.push(p(`教学场地：${arr(res.venues).join('、')}`, FONT.body));
    if (arr(res.supplementary).length) children.push(p(`参考资料：${arr(res.supplementary).join('、')}`, FONT.body));
  }

  // ── ⑥ 课前任务 ─────────────────────────────────────
  const pre = design.preClass || {};
  if (arr(pre.tasks).length || pre.expectedOutcome) {
    children.push(p('五、课前任务', FONT.sectionTitle));
    if (pre.expectedOutcome) children.push(p(`预期成果：${pre.expectedOutcome}`, FONT.body));
    if (arr(pre.tasks).length) {
      children.push(p('任务列表', FONT.subTitle));
      arr(pre.tasks).forEach((t, i) => children.push(p(`  ${i + 1}. ${t}`, FONT.body)));
    }
  }

  // ── ⑦ 课中 5 段法教学过程 ──────────────────────────
  const phases = arr(design.inClass?.phases);
  if (phases.length) {
    children.push(p('六、课中教学过程（5 段法）', FONT.sectionTitle));
    const phaseRows = [
      new TableRow({
        tableHeader: true,
        children: [
          cell('环节', FONT.tableHead, { width: 1300, shading: 'D5E8F0', align: AlignmentType.CENTER }),
          cell('时长', FONT.tableHead, { width: 800, shading: 'D5E8F0', align: AlignmentType.CENTER }),
          cell('教师活动', FONT.tableHead, { width: 2800, shading: 'D5E8F0', align: AlignmentType.CENTER }),
          cell('学生活动', FONT.tableHead, { width: 2660, shading: 'D5E8F0', align: AlignmentType.CENTER }),
          cell('评价', FONT.tableHead, { width: 1800, shading: 'D5E8F0', align: AlignmentType.CENTER }),
        ],
      }),
      ...phases.map((ph) => new TableRow({
        children: [
          cell(ph.phase || '', FONT.body, { width: 1300, align: AlignmentType.CENTER }),
          cell(ph.duration || '—', FONT.body, { width: 800, align: AlignmentType.CENTER }),
          cell(ph.teacherActions || '—', FONT.body, { width: 2800 }),
          cell(ph.studentActions || '—', FONT.body, { width: 2660 }),
          cell(ph.evaluation || '—', FONT.body, { width: 1800 }),
        ],
      })),
    ];
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [1300, 800, 2800, 2660, 1800],
      rows: phaseRows,
    }));
    children.push(p('', FONT.body));
  }

  // ── ⑧ 课后作业 + 反馈 ─────────────────────────────
  const post = design.postClass || {};
  if (arr(post.homework).length || post.feedback) {
    children.push(p('七、课后任务', FONT.sectionTitle));
    if (post.feedback) children.push(p(`反馈机制：${post.feedback}`, FONT.body));
    if (arr(post.homework).length) {
      children.push(p('作业', FONT.subTitle));
      arr(post.homework).forEach((h, i) => children.push(p(`  ${i + 1}. ${h}`, FONT.body)));
    }
    if (arr(post.platforms).length) children.push(p(`课后平台：${arr(post.platforms).join('、')}`, FONT.body));
  }

  // ── ⑨ 信息化手段 ─────────────────────────────────
  const info = design.informatization || {};
  if (info.platform || arr(info.tools).length || info.purpose) {
    children.push(p('八、信息化手段', FONT.sectionTitle));
    if (info.platform) children.push(p(`平台：${info.platform}`, FONT.body));
    if (arr(info.tools).length) children.push(p(`工具：${arr(info.tools).join('、')}`, FONT.body));
    if (info.purpose) children.push(p(`目的：${info.purpose}`, FONT.body));
    if (arr(info.industryPlatforms).length) children.push(p(`行业平台：${arr(info.industryPlatforms).join('、')}`, FONT.body));
  }

  // ── ⑩ 考核评价 ────────────────────────────────────
  const assess = design.assessment || {};
  if (arr(assess.components).length) {
    children.push(p('九、考核评价', FONT.sectionTitle));
    if (assess.approach) children.push(p(assess.approach, FONT.body));
    const assessRows = [
      new TableRow({
        tableHeader: true,
        children: [
          cell('考核项', FONT.tableHead, { width: 2200, shading: 'F0F4F8', align: AlignmentType.CENTER }),
          cell('权重', FONT.tableHead, { width: 1500, shading: 'F0F4F8', align: AlignmentType.CENTER }),
          cell('评分标准', FONT.tableHead, { width: 5660, shading: 'F0F4F8', align: AlignmentType.CENTER }),
        ],
      }),
      ...arr(assess.components).map((c) => new TableRow({
        children: [
          cell(c.name, FONT.body, { width: 2200 }),
          cell(`${c.weight}%`, FONT.body, { width: 1500, align: AlignmentType.CENTER }),
          cell(c.criteria || '—', FONT.body, { width: 5660 }),
        ],
      })),
    ];
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2200, 1500, 5660],
      rows: assessRows,
    }));
    children.push(p('', FONT.body));
  }

  // ── ⑪ 思政元素 ────────────────────────────────────
  if (arr(design.ideologicalElements).length) {
    children.push(p('十、思政元素', FONT.sectionTitle));
    arr(design.ideologicalElements).forEach((e, i) => children.push(p(`  ${i + 1}. ${e}`, FONT.body)));
  }

  // ── 落盘 ───────────────────────────────────────────
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

module.exports = { exportDesignWord };
