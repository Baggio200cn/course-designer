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

  // ── ① 标题（2026-05-17 修复：加上节课具体内容）─────────────
  // 从 design.lessonMeta 读节课信息，组合为 "{课程名} · 第 N 节·{topic} · 教学设计"
  const lm = (design.lessonMeta && typeof design.lessonMeta === 'object') ? design.lessonMeta : {};
  const titleParts = [String(courseName || '课程')];
  if (lm.lessonNumber) titleParts.push(`第 ${lm.lessonNumber} 节`);
  if (lm.topic) titleParts.push(String(lm.topic));
  const titleText = `${titleParts.join(' · ')} · 教学设计`;
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [styledRun(titleText, FONT.title)],
    spacing: { before: 100, after: 100 },
  }));
  // 副标题：章节 / 周次范围 / 学时（让 docx 顶部一眼看出"哪节课"）
  const subParts = [];
  if (lm.chapter) subParts.push(`章节：${lm.chapter}`);
  if (lm.weekRange) subParts.push(`周次：${lm.weekRange}`);
  const theoryH = Number(lm.theoryHours) || 0;
  const practiceH = Number(lm.practiceHours) || 0;
  if (theoryH + practiceH > 0) subParts.push(`学时：理论 ${theoryH} + 实践 ${practiceH} = ${theoryH + practiceH} 节`);
  if (subParts.length > 0) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [styledRun(subParts.join('  ·  '), { ...FONT.body, size: 22 })],
      spacing: { before: 0, after: 200 },
    }));
  }

  // ── 信息图（2026-05-17 修复：读 PNG 实际宽高按比例缩放，不再硬编码 600×840 强制变形）──
  if (infographicPath && fs.existsSync(infographicPath)) {
    try {
      const ext = path.extname(infographicPath).toLowerCase().replace('.', '') || 'png';
      const imgBuffer = fs.readFileSync(infographicPath);
      const imgType = ext === 'jpg' ? 'jpeg' : ext;  // docx 库只接受 jpeg

      // 读 PNG 实际宽高（PNG 文件头：bytes 16-23 是 width/height，big-endian uint32）
      let naturalW = 1200, naturalH = 800;   // 默认兜底
      if (imgType === 'png' && imgBuffer.length > 24) {
        naturalW = imgBuffer.readUInt32BE(16);
        naturalH = imgBuffer.readUInt32BE(20);
      }
      // 按比例缩放：
      //   - 横长图（比例 >= 1）：宽 720 顶满 A4 内容区，高按比例
      //   - 纵长图（比例 < 1，magazine 常见 0.66:1）：宽 720，高按比例算（可能超过 A4 单页，Word 自动分页）
      // 720 px ≈ 7.5 inch ≈ 9360 DXA - 边距，A4 portrait 安全宽度
      const targetWidth = 720;
      const targetHeight = Math.round(targetWidth * naturalH / naturalW);

      // C1 修复（2026-05-17）：title + 图 用 keepNext / keepLines 绑定，避免标题孤悬在上页底部
      //   keepNext=true → 标题段必须和下一段（图）放同一页
      //   keepLines=true → 单段内不允许跨页（保险）
      children.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [styledRun('教学设计概览（AI 信息图）', FONT.sectionTitle)],
        spacing: { before: 60, after: 60 },
        keepNext: true,
        keepLines: true,
      }));
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({
          type: imgType,
          data: imgBuffer,
          transformation: { width: targetWidth, height: targetHeight },
          altText: { title: '教学设计信息图', description: `AI 生成（PNG 原图 ${naturalW}×${naturalH}）`, name: 'design-infographic' },
        })],
        keepLines: true,
      }));
      children.push(p('', FONT.body));
      console.log(`[design-word] 信息图嵌入：原图 ${naturalW}×${naturalH} → docx ${targetWidth}×${targetHeight}（比例 ${(naturalW / naturalH).toFixed(2)}:1 保持不变形）`);
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
          // 2026-05-15 v4.1.4：列宽重排——设计意图列更宽（内容密度大）；列名"评价"→"设计意图"
          cell('环节', FONT.tableHead, { width: 1100, shading: 'D5E8F0', align: AlignmentType.CENTER }),
          cell('时长', FONT.tableHead, { width: 700, shading: 'D5E8F0', align: AlignmentType.CENTER }),
          cell('教师活动', FONT.tableHead, { width: 2520, shading: 'D5E8F0', align: AlignmentType.CENTER }),
          cell('学生活动', FONT.tableHead, { width: 2520, shading: 'D5E8F0', align: AlignmentType.CENTER }),
          cell('设计意图', FONT.tableHead, { width: 2520, shading: 'D5E8F0', align: AlignmentType.CENTER }),
        ],
      }),
      ...phases.map((ph) => new TableRow({
        children: [
          cell(ph.phase || '', FONT.body, { width: 1100, align: AlignmentType.CENTER }),
          cell(ph.duration || '—', FONT.body, { width: 700, align: AlignmentType.CENTER }),
          cell(ph.teacherActions || '—', FONT.body, { width: 2520 }),
          cell(ph.studentActions || '—', FONT.body, { width: 2520 }),
          // 2026-05-15 v4.1.4：优先用 designIntent；老数据仍在 evaluation
          cell(ph.designIntent || ph.evaluation || '—', FONT.body, { width: 2520 }),
        ],
      })),
    ];
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [1100, 700, 2520, 2520, 2520],
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
