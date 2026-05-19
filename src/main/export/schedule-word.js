/**
 * schedule-word.js — 教学进度表 Word 导出（驭课 Agent v4.0.0 / Phase-9 C-1）
 *
 * 输出结构（对齐广州纺校真实样例）：
 *   ① 表头：课程名/教师/学校/教学部/学期/班级/教材/学时
 *   ② 教学目的
 *   ③ 教学重点 / 难点
 *   ④ 教学方法
 *   ⑤ 实训类目（若有）
 *   ⑥ 主体表格：6 列（周次 / 课时 / 授课章节 / 教学内容 / 授课方式 / 作业次数）
 *     （注：列名"课时"由 2026-05-15 老师反馈引入，替代旧名"课次"；
 *      内部字段 schedule[].session 保持不变以兼容下游）
 *   ⑦ 考核评价
 *   ⑧ 补充意见（如有）
 */

const fs = require('fs');
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
  bodySmall: { font: FONT_NAME, size: 20 },
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
    columnSpan: opts.columnSpan,   // 2026-05-15 P2-7：支持合并单元格
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
 * @param {Object} params.schedule  — 来自 schedule.service 的 normalize 数据
 * @param {string} params.outputPath
 */
/**
 * Schema 守卫（v4.3.3 测试报告修复 C · 2026-05-20）：
 *   测试报告 Bug #1 暴露：caller 把数据写到 schedule.rows + lessonNumber/theoryHours/homeworkCount
 *   字段名，但导出器读 schedule.schedule[].{session,hours,homework}，结果表格主体空白。
 *   这里硬拒绝：若 schedule.schedule 不存在但 schedule.rows 存在，明确提示字段名不对，
 *   不再静默生成只有表头的空 docx。
 */
function assertScheduleSchema(schedule) {
  if (!schedule || typeof schedule !== 'object') {
    throw new Error('[exportScheduleWord] schedule 参数必须是对象（不能为空）');
  }
  // 老/错字段名识别：若 schedule.rows 存在但 schedule.schedule 不存在，明显是 caller 写错
  if (Array.isArray(schedule.rows) && !Array.isArray(schedule.schedule)) {
    throw new Error(
      '[exportScheduleWord] 检测到老字段名 schedule.rows · 正确字段应为 schedule.schedule[]。' +
      ' 同时把行内字段 lessonNumber/theoryHours/homeworkCount 改为 session/hours/homework。' +
      ' 详见 v4.3.3 测试报告 Bug #1。'
    );
  }
  if (!Array.isArray(schedule.schedule)) {
    throw new Error('[exportScheduleWord] 缺 schedule.schedule[] 数组（教学进度表主体）');
  }
  if (schedule.schedule.length === 0) {
    throw new Error('[exportScheduleWord] schedule.schedule[] 为空，无法导出进度表');
  }
  // 行级字段名守卫：抽样首行，发现老字段名同样抛
  const r0 = schedule.schedule[0] || {};
  if (('lessonNumber' in r0 || 'theoryHours' in r0 || 'homeworkCount' in r0) &&
      !('session' in r0) && !('hours' in r0) && !('homework' in r0)) {
    throw new Error(
      '[exportScheduleWord] schedule.schedule[0] 仍是老字段名 lessonNumber/theoryHours/homeworkCount，' +
      ' 应改为 session/hours/homework（v4.3.3 测试报告 Bug #1）'
    );
  }
}

async function exportScheduleWord({ schedule, outputPath }) {
  assertScheduleSchema(schedule);
  if (!outputPath) {
    throw new Error('[exportScheduleWord] outputPath 必填');
  }

  const header = schedule.header || {};
  const rows = arr(schedule.schedule);
  const evaluation = schedule.evaluation || {};

  const children = [];

  // ── ① 标题 ─────────────────────────────────────────
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [styledRun(`${header.courseName || '课程'}教学进度表`, FONT.title)],
    spacing: { before: 100, after: 200 },
  }));

  // ── ② 表头信息（2 列网格）──────────────────────────
  const headerInfo = [
    ['学校', header.school || '广州纺校'],
    ['教学部', header.department || '—'],
    ['课程', header.courseName || '—'],
    ['任课教师', header.teacher || '—'],
    ['授课班级', header.className || '—'],
    ['学期', header.semester || '—'],
    ['教材', header.textbook || '—'],
    ['总学时', `${header.totalHours || 72}（理论 ${header.theoryHours || 32} + 实训 ${header.practiceHours || 36} + 考核 ${header.examHours || 4}）`],
  ];
  const headerTable = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1500, 3180, 1500, 3180],
    rows: chunkPairs(headerInfo).map((pair) => new TableRow({
      children: [
        cell(pair[0]?.[0] || '', FONT.tableHead, { width: 1500, shading: 'F0F4F8' }),
        cell(pair[0]?.[1] || '', FONT.body, { width: 3180 }),
        cell(pair[1]?.[0] || '', FONT.tableHead, { width: 1500, shading: 'F0F4F8' }),
        cell(pair[1]?.[1] || '', FONT.body, { width: 3180 }),
      ],
    })),
  });
  children.push(headerTable);
  children.push(p('', FONT.body));

  // ── ③ 教学目的 ─────────────────────────────────────
  if (schedule.objective) {
    children.push(p('教学目的', FONT.sectionTitle));
    children.push(p(schedule.objective, FONT.body));
  }

  // ── ④ 教学重点 / 难点 ──────────────────────────────
  if (arr(schedule.keyPoints).length || arr(schedule.difficulties).length) {
    children.push(p('教学重点与难点', FONT.sectionTitle));
    if (arr(schedule.keyPoints).length) {
      children.push(p('教学重点：', FONT.subTitle));
      arr(schedule.keyPoints).forEach((kp) => children.push(p(`  • ${kp}`, FONT.body)));
    }
    if (arr(schedule.difficulties).length) {
      children.push(p('教学难点：', FONT.subTitle));
      arr(schedule.difficulties).forEach((d) => children.push(p(`  • ${d}`, FONT.body)));
    }
  }

  // ── ⑤ 教学方法 ─────────────────────────────────────
  if (arr(schedule.methods).length) {
    children.push(p('教学方法', FONT.sectionTitle));
    children.push(p(arr(schedule.methods).join(' / '), FONT.body));
  }

  // ── ⑥ 实训类目 ─────────────────────────────────────
  if (arr(schedule.experimentTopics).length) {
    children.push(p('实训类目', FONT.sectionTitle));
    arr(schedule.experimentTopics).forEach((t, i) => children.push(p(`  ${i + 1}. ${t}`, FONT.body)));
  }

  // ── ⑦ 主体进度表 7 列（2026-05-15 加"学时"列）─────────
  children.push(p('教学进度安排（按周）', FONT.sectionTitle));
  const COLS = [700, 700, 1400, 3400, 800, 1180, 1180]; // 总和 9360
  const headRow = new TableRow({
    tableHeader: true,
    children: [
      cell('周次', FONT.tableHead, { width: COLS[0], shading: 'D5E8F0', align: AlignmentType.CENTER }),
      cell('课次', FONT.tableHead, { width: COLS[1], shading: 'D5E8F0', align: AlignmentType.CENTER }),
      cell('授课章节', FONT.tableHead, { width: COLS[2], shading: 'D5E8F0', align: AlignmentType.CENTER }),
      cell('教学内容', FONT.tableHead, { width: COLS[3], shading: 'D5E8F0', align: AlignmentType.CENTER }),
      cell('学时', FONT.tableHead, { width: COLS[4], shading: 'D5E8F0', align: AlignmentType.CENTER }),
      cell('授课方式', FONT.tableHead, { width: COLS[5], shading: 'D5E8F0', align: AlignmentType.CENTER }),
      cell('作业次数', FONT.tableHead, { width: COLS[6], shading: 'D5E8F0', align: AlignmentType.CENTER }),
    ],
  });
  const bodyRows = rows.map((row) => new TableRow({
    children: [
      cell(String(row.week ?? ''), FONT.body, { width: COLS[0], align: AlignmentType.CENTER }),
      cell(String(row.session ?? ''), FONT.body, { width: COLS[1], align: AlignmentType.CENTER }),
      cell(String(row.chapter || ''), FONT.body, { width: COLS[2], align: AlignmentType.CENTER }),
      cell(String(row.content || ''), FONT.body, { width: COLS[3] }),
      cell(String(row.hours ?? ''), FONT.body, { width: COLS[4], align: AlignmentType.CENTER }),
      cell(String(row.method || ''), FONT.body, { width: COLS[5], align: AlignmentType.CENTER }),
      cell(row.homework === 0 || row.homework == null ? '/' : String(row.homework), FONT.body, { width: COLS[6], align: AlignmentType.CENTER }),
    ],
  }));
  // 学时合计行（前 4 列合并 + 学时合计 + 后 2 列合并）
  const totalH = rows.reduce((s, r) => s + (Number(r.hours) || 0), 0);
  const sumRow = new TableRow({
    children: [
      cell('合计', FONT.tableHead, { width: COLS[0], align: AlignmentType.CENTER, shading: 'EFF6FF', columnSpan: 4 }),
      cell(String(totalH), FONT.tableHead, { width: COLS[4], align: AlignmentType.CENTER, shading: 'EFF6FF' }),
      cell('—', FONT.body, { width: COLS[5], align: AlignmentType.CENTER, shading: 'EFF6FF', columnSpan: 2 }),
    ],
  });
  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: COLS,
    rows: [headRow, ...bodyRows, sumRow],
  }));
  children.push(p('', FONT.body));

  // ── ⑧ 考核评价 ────────────────────────────────────
  if (evaluation.approach || arr(evaluation.components).length) {
    children.push(p('考核评价', FONT.sectionTitle));
    if (evaluation.approach) children.push(p(evaluation.approach, FONT.body));
    if (evaluation.components && evaluation.weights) {
      const evalRows = [
        new TableRow({
          tableHeader: true,
          children: [
            cell('考核项', FONT.tableHead, { width: 4680, shading: 'F0F4F8', align: AlignmentType.CENTER }),
            cell('权重', FONT.tableHead, { width: 4680, shading: 'F0F4F8', align: AlignmentType.CENTER }),
          ],
        }),
        ...arr(evaluation.components).map((name) => new TableRow({
          children: [
            cell(name, FONT.body, { width: 4680 }),
            cell(`${evaluation.weights[name] || 0}%`, FONT.body, { width: 4680, align: AlignmentType.CENTER }),
          ],
        })),
      ];
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [4680, 4680],
        rows: evalRows,
      }));
    }
  }

  // ── ⑨ 补充意见 ────────────────────────────────────
  if (schedule.additionalNotes) {
    children.push(p('', FONT.body));
    children.push(p('补充意见', FONT.sectionTitle));
    children.push(p(schedule.additionalNotes, FONT.body));
  }

  // ── 落盘 ───────────────────────────────────────────
  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT_NAME, size: FONT.body.size } } },
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: 11906,        // A4 portrait
            height: 16838,
            orientation: PageOrientation.PORTRAIT,
          },
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

// ── 辅助：把 [a,b,c,d,e,f,g,h] 切成 [[a,b],[c,d],[e,f],[g,h]] 用于 2 列网格 ──
function chunkPairs(items) {
  const out = [];
  for (let i = 0; i < items.length; i += 2) {
    out.push([items[i], items[i + 1]].filter(Boolean));
  }
  return out;
}

module.exports = { exportScheduleWord, assertScheduleSchema };
