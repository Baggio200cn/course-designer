const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  VerticalAlign,
  BorderStyle,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  NumberFormat
} = require('docx');

// ============================================================
// 1. 字体字号标准体系
// ============================================================
const FONT = {
  title: { font: 'Microsoft YaHei', size: 36, bold: true },       // 18pt 标题
  sectionTitle: { font: 'Microsoft YaHei', size: 28, bold: true }, // 14pt 节标题
  subTitle: { font: 'Microsoft YaHei', size: 24, bold: true },     // 12pt 子标题
  body: { font: 'Microsoft YaHei', size: 22 },                      // 11pt 正文
  bodySmall: { font: 'Microsoft YaHei', size: 20 },                 // 10pt 表格/注释
  caption: { font: 'Microsoft YaHei', size: 18, color: '666666' },  // 9pt 图注
  header: { font: 'Microsoft YaHei', size: 16, color: '888888' },   // 8pt 页眉
};

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const toList = (arr) => (Array.isArray(arr) ? arr : []);

// ============================================================
// 2. 基础段落构造器（带字号）
// ============================================================
function styledRun(text, styleOverride = {}) {
  return new TextRun({
    text: String(text || ''),
    font: styleOverride.font || FONT.body.font,
    size: styleOverride.size || FONT.body.size,
    bold: styleOverride.bold || false,
    color: styleOverride.color || '000000'
  });
}

const line = (text = '', style = FONT.body) =>
  new Paragraph({
    children: [styledRun(text, style)],
    spacing: { after: 80 }
  });

const boldLine = (text = '', style = FONT.body) =>
  new Paragraph({
    children: [styledRun(text, { ...style, bold: true })],
    spacing: { after: 80 }
  });

const title = (text) =>
  new Paragraph({
    children: [styledRun(text, FONT.title)],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 200 }
  });

const sectionTitle = (text) =>
  new Paragraph({
    children: [styledRun(text, FONT.sectionTitle)],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 }
  });

// ============================================================
// 3. 图片嵌入（带裁剪+图注）
// ============================================================
function detectImageType(buffer) {
  if (!buffer || buffer.length < 8) return 'png';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  return 'png';
}

function getImageDimensions(buffer) {
  if (!buffer || buffer.length < 24) return { width: 460, height: 640 };
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
  }
  return { width: 460, height: 640 };
}

function appendImageWithCaption(paragraphs, imagePath, captionText) {
  const trimmed = String(imagePath || '').trim();
  if (!trimmed || !fs.existsSync(trimmed)) return false;

  try {
    const imageBuffer = fs.readFileSync(trimmed);
    const imgType = detectImageType(imageBuffer);
    const dims = getImageDimensions(imageBuffer);

    // 等比缩放：最大宽度 380px，最大高度 480px（比之前更紧凑）
    const maxWidth = 380;
    const maxHeight = 480;
    let renderWidth = dims.width;
    let renderHeight = dims.height;
    if (renderWidth > maxWidth) {
      renderHeight = Math.round(renderHeight * (maxWidth / renderWidth));
      renderWidth = maxWidth;
    }
    if (renderHeight > maxHeight) {
      renderWidth = Math.round(renderWidth * (maxHeight / renderHeight));
      renderHeight = maxHeight;
    }

    paragraphs.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: imgType,
            data: imageBuffer,
            transformation: { width: renderWidth, height: renderHeight },
            altText: { title: captionText || '信息图', description: '教学信息图', name: path.basename(trimmed) }
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 40 }
      })
    );

    // 图注
    if (captionText) {
      paragraphs.push(
        new Paragraph({
          children: [styledRun(`图：${captionText}`, FONT.caption)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 160 }
        })
      );
    }
    return true;
  } catch {
    paragraphs.push(line(`[信息图加载失败：${path.basename(trimmed)}]`, FONT.caption));
    return false;
  }
}

// ============================================================
// 4. 表格工具函数
// ============================================================
function cellText(text, options = {}) {
  return new TableCell({
    borders: BORDERS,
    children: [
      new Paragraph({
        children: [styledRun(text, { size: options.size || FONT.bodySmall.size, bold: options.bold || false, color: options.color || '000000' })],
        alignment: options.alignment || AlignmentType.LEFT,
        spacing: { after: 20 }
      })
    ],
    verticalAlign: VerticalAlign.CENTER,
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.shading ? { type: ShadingType.CLEAR, fill: options.shading, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 }
  });
}

function cellMultiLine(lines, options = {}) {
  const children = toList(lines).filter(Boolean).map((text) =>
    new Paragraph({
      children: [styledRun(text, { size: options.size || FONT.bodySmall.size, color: options.color || '000000' })],
      spacing: { after: 30 }
    })
  );
  if (!children.length) children.push(new Paragraph({ children: [styledRun('', { size: FONT.bodySmall.size })] }));
  return new TableCell({
    borders: BORDERS,
    children,
    verticalAlign: VerticalAlign.CENTER,
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.shading ? { type: ShadingType.CLEAR, fill: options.shading, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 }
  });
}

function headerCell(text, width) {
  return cellText(text, { bold: true, size: FONT.bodySmall.size, alignment: AlignmentType.CENTER, width, shading: 'D5E8F0' });
}

// ============================================================
// 5. 教学过程表（动态时间 + 差异化内容）
// ============================================================
function buildTeachingProcessTable(modules = [], totalHours = 2) {
  const totalMinutes = Math.max(45, Math.round((Number(totalHours) || 2) * 45));
  const moduleCount = Math.max(1, modules.length);

  // 时间分配：导入占 5-8 分钟，练习占 15-20%，总结占 8-10%，剩余给模块
  const introMinutes = Math.min(8, Math.max(5, Math.round(totalMinutes * 0.06)));
  const practiceMinutes = Math.max(5, Math.round(totalMinutes * 0.18));
  const closingMinutes = Math.max(3, Math.round(totalMinutes * 0.08));
  const moduleTotal = totalMinutes - introMinutes - practiceMinutes - closingMinutes;

  // 按模块学时比例分配
  const totalModuleHours = modules.reduce((s, m) => s + (Number(m.hours) || 1), 0);
  const moduleMinutes = modules.map((m) => {
    const ratio = (Number(m.hours) || 1) / totalModuleHours;
    return Math.max(3, Math.round(moduleTotal * ratio));
  });
  // 修正四舍五入误差
  const sumModule = moduleMinutes.reduce((s, v) => s + v, 0);
  if (sumModule !== moduleTotal && moduleMinutes.length) {
    moduleMinutes[moduleMinutes.length - 1] += (moduleTotal - sumModule);
  }

  const headerRow = new TableRow({
    children: [
      headerCell('教学环节', 11),
      headerCell('教学内容', 15),
      headerCell('教师活动', 20),
      headerCell('学生活动', 17),
      headerCell('评价活动', 17),
      headerCell('设计意图', 20)
    ]
  });

  const rows = [headerRow];

  // 导入环节
  rows.push(new TableRow({
    children: [
      cellText(`导入\n（${introMinutes}分钟）`, { width: 11, alignment: AlignmentType.CENTER, bold: true }),
      cellMultiLine(['回顾旧知', '引出本课主题与任务'], { width: 15 }),
      cellMultiLine(['展示课题与案例', '引导学生观察并表达初步认知', '明确本课学习目标和评价标准'], { width: 20 }),
      cellMultiLine(['回顾已学内容', '观察案例', '初步表达判断'], { width: 17 }),
      cellMultiLine(['关注学生对旧知的掌握程度', '评价初步表达的准确性'], { width: 17 }),
      cellMultiLine(['温故知新，建立衔接', '明确学习目标与评价标准'], { width: 20 })
    ]
  }));

  // 每个模块（差异化内容）
  let timeCursor = introMinutes;
  modules.forEach((m, idx) => {
    const dur = moduleMinutes[idx];
    const points = toList(m.knowledgePoints);
    const name = m.name || `模块${idx + 1}`;
    const methods = String(m.teachingMethods || '').trim();
    const desc = String(m.description || '').trim();

    // 根据模块特征生成差异化的教师/学生/评价/意图内容
    const isTheory = /认知|原理|概念|定义|分析|分类|标准|评价/.test(name + desc);
    const isPractice = /实践|操作|组装|制作|设计|创|拼|摆场|动手/.test(name + desc);
    const isReview = /互评|互鉴|评选|复盘|讲评|回顾|测验/.test(name + desc);

    let teacherActs, studentActs, evalActs, designIntent;

    if (isPractice) {
      teacherActs = [`发布${name}任务书，讲解操作要求和工具使用`, `示范关键操作步骤`, `巡视指导，重点纠正${points[0] || '操作'}中的常见错误`];
      studentActs = [`解读任务要求`, `动手完成${name}任务`, `遇到问题及时向老师或同伴求助`];
      evalActs = [`巡视时逐组检查操作规范性`, `关注${points[0] || '核心要求'}的完成质量`];
      designIntent = [`将${points.join('、') || '知识点'}落实到真实操作中`, `培养动手能力和问题解决能力`, `体现"做中学"的职教理念`];
    } else if (isReview) {
      teacherActs = [`组织${/画廊/.test(desc) ? '画廊漫步' : '互评'}活动`, `指导学生运用评价标准进行点评`, `汇总典型作品进行集中讲评`];
      studentActs = [`按评价标准审视同伴作品`, `写出具体的修改建议`, `选代表汇报本组评价结论`];
      evalActs = [`检查学生能否准确运用评价标准`, `关注评价意见的专业性和建设性`];
      designIntent = [`培养审美鉴赏与批判性思维`, `通过互评深化对标准的理解`, `锻炼口头表达和团队协作能力`];
    } else {
      teacherActs = [`围绕"${name}"进行讲解`, `结合${desc ? '案例' : '实例'}分析${points[0] || '核心概念'}`, `通过提问引导学生思考${points[1] || '关键问题'}`];
      studentActs = [`跟随教师讲解理解${points[0] || '核心概念'}`, `参与课堂讨论`, `记录关键知识点`];
      evalActs = [`通过提问检查理解程度`, `关注学生能否用自己的话解释${points[0] || '概念'}`];
      designIntent = [`帮助学生理解${points.join('、') || '核心知识'}`, `建立知识之间的逻辑关系`, `为后续实践环节打下理论基础`];
    }

    rows.push(new TableRow({
      children: [
        cellText(`${name}\n（${dur}分钟）`, { width: 11, alignment: AlignmentType.CENTER, bold: true }),
        cellMultiLine(points.length ? points : [desc || '模块核心内容'], { width: 15 }),
        cellMultiLine(teacherActs, { width: 20 }),
        cellMultiLine(studentActs, { width: 17 }),
        cellMultiLine(evalActs, { width: 17 }),
        cellMultiLine(designIntent, { width: 20 })
      ]
    }));
    timeCursor += dur;
  });

  // 课堂练习
  rows.push(new TableRow({
    children: [
      cellText(`综合练习\n（${practiceMinutes}分钟）`, { width: 11, alignment: AlignmentType.CENTER, bold: true }),
      cellMultiLine(['综合运用练习', '互查与修改'], { width: 15 }),
      cellMultiLine(['布置综合练习任务', '巡视指导并抓取典型问题', '组织互查讲评'], { width: 20 }),
      cellMultiLine(['按标准完成综合练习', '互查同伴作品并提出修改建议', '汇报修改结果'], { width: 17 }),
      cellMultiLine(['按评价标准逐项核查', '关注学生修改的针对性'], { width: 17 }),
      cellMultiLine(['巩固本课学习成果', '培养互评与反思能力'], { width: 20 })
    ]
  }));

  // 总结
  rows.push(new TableRow({
    children: [
      cellText(`总结\n（${closingMinutes}分钟）`, { width: 11, alignment: AlignmentType.CENTER, bold: true }),
      cellMultiLine(['知识回顾', '课后任务布置'], { width: 15 }),
      cellMultiLine(['梳理本课知识主线', '指出共性问题', '布置课后作业'], { width: 20 }),
      cellMultiLine(['回顾关键知识点', '记录课后任务要求'], { width: 17 }),
      cellMultiLine(['总结性评价学习目标达成度'], { width: 17 }),
      cellMultiLine(['帮助学生建立完整知识脉络', '明确课后延伸方向'], { width: 20 })
    ]
  }));

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

// ============================================================
// 6. 模块与框架归一化
// ============================================================
function normalizeFrameworkModules(frameworkContent) {
  return toList(frameworkContent.modules).map((m, idx) => ({
    moduleNumber: m.number || idx + 1,
    name: m.name || `模块${idx + 1}`,
    hours: Number(m.hours) || 0,
    description: m.description || '',
    knowledgePoints: toList(m.keyPoints || m.knowledgePoints),
    teachingMethods: m.teachingMethods || '',
    structureImagePath: m.structureImagePath || '',
    structureImageUrl: m.structureImageUrl || ''
  }));
}

function normalizeLocalModules(modules) {
  return toList(modules).map((m) => ({
    ...m,
    structureImagePath: m?.content?.structureImagePath || m?.structureImagePath || '',
    structureImageUrl: m?.content?.structureImageUrl || m?.structureImageUrl || ''
  }));
}

// ============================================================
// 7. Markdown 段落解析
// ============================================================
function appendMarkdownParagraphs(paragraphs, markdownText, structureSlotsById = new Map()) {
  const rows = String(markdownText || '').split(/\r?\n/);
  rows.forEach((row) => {
    const text = String(row || '');
    const trimmed = text.trim();
    if (!trimmed) { paragraphs.push(line()); return; }
    const h1 = trimmed.match(/^#\s+(.+)$/);
    if (h1) { paragraphs.push(title(h1[1])); return; }
    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2) { paragraphs.push(sectionTitle(h2[1])); return; }
    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      paragraphs.push(new Paragraph({ children: [styledRun(h3[1], FONT.subTitle)], heading: HeadingLevel.HEADING_3, spacing: { before: 120, after: 80 } }));
      return;
    }
    const imageMatch = trimmed.match(/^!\[(.*)\]\((.+)\)$/);
    if (imageMatch) {
      const caption = imageMatch[1] || '';
      const src = String(imageMatch[2] || '').trim();
      const slotMatch = src.match(/^slot:\/\/(.+)$/);
      if (slotMatch) {
        const slot = structureSlotsById.get(slotMatch[1]);
        const imagePath = String(slot?.imagePath || '').trim();
        if (!appendImageWithCaption(paragraphs, imagePath, caption) && slot?.imageUrl) {
          paragraphs.push(line(`[信息图链接：${slot.imageUrl}]`, FONT.caption));
        }
        return;
      }
      if (!appendImageWithCaption(paragraphs, src, caption)) {
        paragraphs.push(line(`[信息图链接：${src}]`, FONT.caption));
      }
      return;
    }
    if (trimmed.startsWith('- ')) {
      paragraphs.push(line(trimmed));
      return;
    }
    paragraphs.push(line(text));
  });
}

// ============================================================
// 8. 从模块数据生成教学重点难点（非硬编码）
// ============================================================
function inferKeyDifficulties(modules = [], frameworkContent = {}) {
  const kp = frameworkContent?.keyPoints || frameworkContent?.highlights || {};
  const highlights = toList(kp.highlights || kp.key);
  const difficulties = toList(kp.difficulties || kp.difficulty);

  // 如果框架提供了，直接用
  if (highlights.length || difficulties.length) {
    return {
      highlights: highlights.length ? highlights.join('；') : inferFromModules(modules, 'highlight'),
      difficulties: difficulties.length ? difficulties.join('；') : inferFromModules(modules, 'difficulty')
    };
  }

  // 否则从模块数据自动推断
  return {
    highlights: inferFromModules(modules, 'highlight'),
    difficulties: inferFromModules(modules, 'difficulty')
  };
}

function inferFromModules(modules, type) {
  if (type === 'highlight') {
    const points = modules.flatMap(m => toList(m.knowledgePoints).slice(0, 1));
    return points.length ? points.join('；') : '本课核心知识点的理解与应用';
  }
  // difficulty
  const names = modules.filter(m => /操作|实践|设计|制作|评价|互评/.test(m.name || m.description || '')).map(m => m.name);
  return names.length ? `${names.join('、')}环节中的操作规范性与判断准确性` : '将理论知识转化为实际操作能力';
}

// ============================================================
// 9. 从模块数据生成具体作业（非硬编码）
// ============================================================
function inferHomework(modules = [], courseName = '') {
  const practiceModules = modules.filter(m => /实践|操作|设计|创|做/.test(m.name || m.description || ''));
  if (practiceModules.length) {
    return `结合"${practiceModules[0].name}"的课堂成果，对照评价标准完成作品修改与优化，提交修改后的最终版本及修改说明。`;
  }
  return `回顾本节课"${courseName}"的核心知识点，完成课后练习并对照课堂标准进行自我检查。`;
}

function inferExtension(modules = [], courseName = '') {
  const lastModule = modules[modules.length - 1];
  if (lastModule && /回顾|回收|延伸|测验/.test(lastModule.name || lastModule.description || '')) {
    return `围绕${lastModule.name}中的拓展方向，查阅 1-2 个相关案例进行对比分析，为下节课做准备。`;
  }
  return `查阅 1-2 个与"${courseName}"相关的实际案例，思考如何将课堂所学应用到真实场景中。`;
}

// ============================================================
// 9.3 教法学法智能归纳
// ============================================================
function inferTeachingMethods(modules = []) {
  const allText = modules.map(m => `${m.name || ''} ${m.description || ''} ${m.teachingMethods || ''}`).join(' ');
  const teachingSet = new Set();
  const learningSet = new Set();

  // 教法识别
  if (/案例|分析|对比|A\/B/.test(allText)) teachingSet.add('案例教学法');
  if (/任务|项目|PBL|实战/.test(allText)) teachingSet.add('任务驱动法');
  if (/示范|演示|操作|讲解/.test(allText)) teachingSet.add('示范讲解法');
  if (/讨论|探究|提问/.test(allText)) teachingSet.add('启发引导法');
  if (/标准|评价|共构/.test(allText)) teachingSet.add('标准引领法');
  if (/情境|导入|潮起|场景/.test(allText)) teachingSet.add('情境教学法');

  // 学法识别
  if (/互评|互查|画廊|漫步/.test(allText)) learningSet.add('互评互鉴法');
  if (/小组|协作|合作|团队/.test(allText)) learningSet.add('小组合作法');
  if (/动手|操作|实践|制作|设计/.test(allText)) learningSet.add('动手实践法');
  if (/自主|探究|思考/.test(allText)) learningSet.add('自主探究法');
  if (/回顾|测验|复盘/.test(allText)) learningSet.add('总结反思法');

  // 补充从模块 teachingMethods 字段提取的具体方法
  modules.forEach(m => {
    const methods = String(m.teachingMethods || '');
    if (methods && !teachingSet.size) teachingSet.add(methods);
  });

  // 确保至少有默认值
  if (!teachingSet.size) { teachingSet.add('任务驱动法'); teachingSet.add('案例教学法'); teachingSet.add('示范讲解法'); }
  if (!learningSet.size) { learningSet.add('自主探究法'); learningSet.add('小组合作法'); }

  return {
    teaching: [...teachingSet].join('、'),
    learning: [...learningSet].join('、')
  };
}

// ============================================================
// 10. 教学进度表（按阶段而非按周）
// ============================================================
function buildScheduleTable(modules = [], totalHours = 2) {
  const headerRow = new TableRow({
    children: [
      headerCell('阶段', 10),
      headerCell('教学内容', 25),
      headerCell('学时', 10),
      headerCell('教学方法', 30),
      headerCell('作业/活动', 25)
    ]
  });

  const rows = [headerRow];
  modules.forEach((m, idx) => {
    rows.push(new TableRow({
      children: [
        cellText(`阶段${idx + 1}`, { width: 10, alignment: AlignmentType.CENTER }),
        cellText(m.name || `模块${idx + 1}`, { width: 25 }),
        cellText(`${m.hours || 0}`, { width: 10, alignment: AlignmentType.CENTER }),
        cellText(m.teachingMethods || '讲授+实践', { width: 30 }),
        cellText(m.assignment || '', { width: 25 })
      ]
    }));
  });

  // 合计行
  const totalH = modules.reduce((s, m) => s + (Number(m.hours) || 0), 0);
  rows.push(new TableRow({
    children: [
      cellText('合计', { width: 10, alignment: AlignmentType.CENTER, bold: true, shading: 'F0F0F0' }),
      cellText('', { width: 25, shading: 'F0F0F0' }),
      cellText(`${totalH}`, { width: 10, alignment: AlignmentType.CENTER, bold: true, shading: 'F0F0F0' }),
      cellText('', { width: 30, shading: 'F0F0F0' }),
      cellText('', { width: 25, shading: 'F0F0F0' })
    ]
  }));

  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

// ============================================================
// 11. 主导出函数
// ============================================================
async function exportNotebookWord({
  notebook,
  modules,
  schedule,
  framework,
  outputPath
}) {
  const frameworkContent = framework?.content || framework || {};
  const frameworkModules = normalizeFrameworkModules(frameworkContent);
  const courseName = notebook?.name || '未命名课程';
  const totalHours = Number(notebook?.totalHours) || 0;

  const effectiveModules = toList(modules).length
    ? normalizeLocalModules(modules)
    : frameworkModules;

  const paragraphs = [];

  // 封面信息
  paragraphs.push(title(`课程教学设计：${courseName}`));
  paragraphs.push(line());
  paragraphs.push(line(`专业代码：${notebook?.courseCode || '未设置'}`, FONT.body));
  paragraphs.push(line(`总学时：${totalHours}`, FONT.body));
  paragraphs.push(line(`理论学时：${notebook?.theoryHours || 0}    实践学时：${notebook?.practiceHours || 0}`, FONT.body));
  paragraphs.push(line(`授课对象：${notebook?.grade || '未设置'}`, FONT.body));
  paragraphs.push(line(`先修课程：${notebook?.prerequisite || '无'}`, FONT.body));
  paragraphs.push(line());

  // 一、课程描述
  paragraphs.push(sectionTitle('一、课程描述'));
  paragraphs.push(line(notebook?.description || '', FONT.body));
  paragraphs.push(line());

  // 二、教学目标
  paragraphs.push(sectionTitle('二、教学目标'));
  const objectives = frameworkContent?.objectives || {};
  if (toList(objectives.knowledge).length) {
    paragraphs.push(boldLine('知识目标：'));
    toList(objectives.knowledge).forEach((item, i) => paragraphs.push(line(`${i + 1}. ${item}`)));
  }
  if (toList(objectives.skills).length) {
    paragraphs.push(boldLine('技能目标：'));
    toList(objectives.skills).forEach((item, i) => paragraphs.push(line(`${i + 1}. ${item}`)));
  }
  if (toList(objectives.attitude).length) {
    paragraphs.push(boldLine('情感目标：'));
    toList(objectives.attitude).forEach((item, i) => paragraphs.push(line(`${i + 1}. ${item}`)));
  }
  paragraphs.push(line());

  // 三、教学模块
  paragraphs.push(sectionTitle('三、教学模块'));
  effectiveModules.forEach((m, idx) => {
    paragraphs.push(boldLine(`模块${m.moduleNumber || idx + 1}：${m.name || '未命名模块'}（${m.hours || 0}学时）`, FONT.subTitle));
    if (m.description) paragraphs.push(line(`模块说明：${m.description}`));
    toList(m.knowledgePoints).forEach((kp, i) => paragraphs.push(line(`  知识点${i + 1}：${kp}`)));
    if (m.teachingMethods) paragraphs.push(line(`教学方法：${m.teachingMethods}`));

    // 信息图嵌入（带图注）
    const imagePath = String(m.structureImagePath || '').trim();
    if (imagePath && fs.existsSync(imagePath)) {
      appendImageWithCaption(paragraphs, imagePath, `${m.name || `模块${idx + 1}`} 教学信息图`);
    } else if (m.structureImageUrl) {
      paragraphs.push(line(`[信息图链接：${m.structureImageUrl}]`, FONT.caption));
    }
    paragraphs.push(line());
  });

  // 四、教学进度
  paragraphs.push(sectionTitle('四、教学进度'));
  paragraphs.push(buildScheduleTable(effectiveModules, totalHours));
  paragraphs.push(line());

  // 五、教学重点与难点（从模块推断）
  paragraphs.push(sectionTitle('五、教学重点与难点'));
  const inferred = inferKeyDifficulties(effectiveModules, frameworkContent);
  paragraphs.push(boldLine('教学重点：'));
  paragraphs.push(line(inferred.highlights));
  paragraphs.push(boldLine('教学难点：'));
  paragraphs.push(line(inferred.difficulties));
  paragraphs.push(line());

  // 六、教法与学法（从模块智能归纳）
  paragraphs.push(sectionTitle('六、教法与学法'));
  const inferredMethods = inferTeachingMethods(effectiveModules);
  paragraphs.push(boldLine('教法：'));
  paragraphs.push(line(inferredMethods.teaching));
  paragraphs.push(boldLine('学法：'));
  paragraphs.push(line(inferredMethods.learning));
  paragraphs.push(line());

  // 七、教学准备
  paragraphs.push(sectionTitle('七、教学准备'));
  paragraphs.push(line('微课、课件、智慧教室、学习通教学平台等。'));
  paragraphs.push(line());

  // 八、教学过程（动态时间）
  paragraphs.push(sectionTitle('八、教学过程'));
  paragraphs.push(buildTeachingProcessTable(effectiveModules, totalHours));
  paragraphs.push(line());

  // 九、评价设计
  paragraphs.push(sectionTitle('九、评价设计'));
  paragraphs.push(boldLine('过程性评价（60%）：'));
  paragraphs.push(line('课堂提问、小组讨论表现、互查反馈质量、课堂参与度'));
  paragraphs.push(boldLine('终结性评价（40%）：'));
  paragraphs.push(line('课堂练习成果质量、课后作业完成情况'));
  paragraphs.push(line());

  // 十、作业与拓展（从模块推断）
  paragraphs.push(sectionTitle('十、作业与拓展'));
  paragraphs.push(boldLine('课后作业：'));
  paragraphs.push(line(inferHomework(effectiveModules, courseName)));
  paragraphs.push(boldLine('拓展要求：'));
  paragraphs.push(line(inferExtension(effectiveModules, courseName)));
  paragraphs.push(line());

  // 十一、教学框架摘要
  paragraphs.push(sectionTitle('十一、教学框架摘要'));
  if (frameworkModules.length) {
    frameworkModules.forEach((m, i) => {
      paragraphs.push(line(`框架模块${m.moduleNumber || i + 1}：${m.name || '未命名'}（${m.hours || 0}学时）`));
    });
  } else {
    paragraphs.push(line('暂无框架数据'));
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Microsoft YaHei', size: 22 }
        }
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: 'Microsoft YaHei' },
          paragraph: { spacing: { before: 200, after: 200 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Microsoft YaHei' },
          paragraph: { spacing: { before: 240, after: 120 } } }
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1200, bottom: 1440, left: 1200 }
        }
      },
      children: paragraphs,
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [styledRun(courseName, FONT.header)],
            alignment: AlignmentType.RIGHT
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              styledRun('— ', FONT.header),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Microsoft YaHei' }),
              styledRun(' —', FONT.header)
            ],
            alignment: AlignmentType.CENTER
          })]
        })
      }
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ============================================================
// 12. 其他导出函数（保持不变）
// ============================================================
async function exportDiscussionWord({ notebook, discussionDraft, comments, outputPath }) {
  const paragraphs = [];
  paragraphs.push(title(`讨论稿：${notebook?.name || '未命名课程'}`));
  paragraphs.push(line(`导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`));
  paragraphs.push(line());
  paragraphs.push(sectionTitle('一、讨论稿正文'));
  String(discussionDraft || '').split(/\r?\n/).forEach((row) => paragraphs.push(line(row)));
  paragraphs.push(line());
  paragraphs.push(sectionTitle('二、批注建议'));
  const list = toList(comments);
  if (!list.length) { paragraphs.push(line('暂无批注')); }
  else {
    list.forEach((item, idx) => {
      paragraphs.push(line(`${idx + 1}. [${item.scope || 'framework'}] ${item.section || '未分类'}`));
      paragraphs.push(line(`   建议：${item.text || ''}`));
      paragraphs.push(line(`   状态：${item.applied ? '已应用' : '待处理'}`));
    });
  }
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

async function exportMergedDiscussionWord({ notebook, discussionDraft, structureSlots, outputPath }) {
  const paragraphs = [];
  paragraphs.push(title(`确认稿：${notebook?.name || '未命名课程'}`));
  paragraphs.push(line(`导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`));
  paragraphs.push(line());
  const draft = String(discussionDraft || '');
  const slots = toList(structureSlots);
  const slotsById = new Map(slots.map((item) => [String(item.id), item]));
  appendMarkdownParagraphs(paragraphs, draft, slotsById);
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ============================================================
// 12.1 讲稿信息表（封面元数据）
// ============================================================
function buildLectureInfoTable(notebook) {
  const nb = notebook || {};
  const rows = [];
  // 构建两列键值表：左列字段名，右列值
  const fields = [
    ['课程名称', nb.name || ''],
    ['课程代码', nb.courseCode || ''],
    ['授课对象', nb.grade || ''],
    ['总学时', `${nb.totalHours || 0}（理论 ${nb.theoryHours || 0} / 实践 ${nb.practiceHours || 0}）`],
    nb.softwareTools ? ['教学软件', nb.softwareTools] : null,
    nb.jobTargets   ? ['目标岗位', nb.jobTargets] : null,
    ['先修课程', nb.prerequisite || '无'],
    ['导出时间', new Date().toLocaleString('zh-CN', { hour12: false })]
  ].filter(Boolean);

  fields.forEach(([key, value]) => {
    rows.push(new TableRow({
      children: [
        cellText(key, { width: 20, bold: true, shading: 'EEF2FF' }),
        cellText(String(value || ''), { width: 80 })
      ]
    }));
  });

  return new Table({
    rows,
    width: { size: 9026, type: WidthType.DXA },
    columnWidths: [1805, 7221]
  });
}

// ============================================================
// 12.2 讲稿专用段落解析（区分讲述/动作/标题块）
// ============================================================
function appendLectureScriptParagraphs(paragraphs, scriptText) {
  const rows = String(scriptText || '').split(/\r?\n/);
  let mode = 'normal';  // 'normal' | 'narration' | 'action'

  const COLOR = {
    sectionBg: 'D8E4F0',    // 阶段标题背景（蓝灰）
    narrationBg: 'F0F9F0',  // 讲述背景（浅绿）
    actionBg: 'FFF8E7',     // 动作背景（浅黄）
    narrationAccent: '2E7D32',
    actionAccent: 'E65100'
  };

  rows.forEach((rawLine) => {
    const text = String(rawLine || '');
    const trimmed = text.trim();

    // 空行
    if (!trimmed) {
      mode = 'normal';
      paragraphs.push(line());
      return;
    }

    // H2 阶段标题（## 一、开场导入（0-3分钟）之类）
    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2) {
      mode = 'normal';
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: h2[1], font: 'Microsoft YaHei', size: 26, bold: true, color: '1A3F6F' })],
        heading: HeadingLevel.HEADING_2,
        shading: { type: ShadingType.CLEAR, fill: COLOR.sectionBg, color: 'auto' },
        spacing: { before: 240, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '4472C4', space: 2 } }
      }));
      return;
    }

    // H3 子标题
    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      mode = 'normal';
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: h3[1], font: 'Microsoft YaHei', size: 24, bold: true, color: '1A3F6F' })],
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 160, after: 60 }
      }));
      return;
    }

    // 教师讲述：段落开始
    if (/^教师讲述[：:]/.test(trimmed)) {
      mode = 'narration';
      const content = trimmed.replace(/^教师讲述[：:]\s*/, '').trim();
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({ text: '【教师讲述】', font: 'Microsoft YaHei', size: 20, bold: true, color: COLOR.narrationAccent }),
          new TextRun({ text: content ? `  ${content}` : '', font: 'Microsoft YaHei', size: 22, color: '1B1B1B' })
        ],
        shading: { type: ShadingType.CLEAR, fill: COLOR.narrationBg, color: 'auto' },
        indent: { left: 280 },
        spacing: { before: 60, after: 40 }
      }));
      return;
    }

    // 课堂动作：段落开始
    if (/^课堂动作[：:]/.test(trimmed)) {
      mode = 'action';
      const content = trimmed.replace(/^课堂动作[：:]\s*/, '').trim();
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({ text: '【课堂动作】', font: 'Microsoft YaHei', size: 20, bold: true, color: COLOR.actionAccent }),
          new TextRun({ text: content ? `  ${content}` : '', font: 'Microsoft YaHei', size: 22, color: '1B1B1B' })
        ],
        shading: { type: ShadingType.CLEAR, fill: COLOR.actionBg, color: 'auto' },
        indent: { left: 280 },
        spacing: { before: 60, after: 40 }
      }));
      return;
    }

    // 在教师讲述/课堂动作 block 内的连续行（缩进同色背景）
    if (mode === 'narration') {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: trimmed.replace(/^[-*•]\s*/, ''), font: 'Microsoft YaHei', size: 22, color: '1B1B1B' })],
        shading: { type: ShadingType.CLEAR, fill: COLOR.narrationBg, color: 'auto' },
        indent: { left: 560 },
        spacing: { before: 20, after: 20 }
      }));
      return;
    }
    if (mode === 'action') {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: trimmed.replace(/^[-*•]\s*/, ''), font: 'Microsoft YaHei', size: 22, color: '1B1B1B' })],
        shading: { type: ShadingType.CLEAR, fill: COLOR.actionBg, color: 'auto' },
        indent: { left: 560 },
        spacing: { before: 20, after: 20 }
      }));
      return;
    }

    // 普通正文
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text, font: 'Microsoft YaHei', size: 22 })],
      spacing: { before: 40, after: 40 }
    }));
  });
}

// ============================================================
// 12. 讲稿 Word 导出（升级版：信息表 + 分色讲述/动作块）
// ============================================================
async function exportLectureWord({ notebook, lectureTitle, lectureScript, mergeReport, outputPath }) {
  const courseName = notebook?.name || '未命名课程';
  const paragraphs = [];

  // ── 封面标题 ──────────────────────────────────────────────
  paragraphs.push(title(lectureTitle || `课堂讲稿：${courseName}`));
  paragraphs.push(line());

  // ── 课程基本信息表 ────────────────────────────────────────
  paragraphs.push(buildLectureInfoTable(notebook));
  paragraphs.push(line());

  // ── 讲稿正文（区分讲述/动作/标题块）─────────────────────
  paragraphs.push(sectionTitle('讲稿正文'));
  appendLectureScriptParagraphs(paragraphs, String(lectureScript || ''));

  // ── 附录 ──────────────────────────────────────────────────
  if (String(mergeReport || '').trim()) {
    paragraphs.push(line());
    paragraphs.push(sectionTitle('附录：合并报告'));
    appendMarkdownParagraphs(paragraphs, String(mergeReport || ''));
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Microsoft YaHei', size: 22 } }
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: 'Microsoft YaHei' },
          paragraph: { spacing: { before: 200, after: 200 }, alignment: AlignmentType.CENTER } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, font: 'Microsoft YaHei', color: '1A3F6F' },
          paragraph: { spacing: { before: 240, after: 80 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: 'Microsoft YaHei', color: '1A3F6F' },
          paragraph: { spacing: { before: 160, after: 60 } } }
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1200, bottom: 1440, left: 1200 }
        }
      },
      children: paragraphs,
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              styledRun(courseName, FONT.header),
              new TextRun({ text: '  |  正式讲稿', size: 16, color: 'AAAAAA', font: 'Microsoft YaHei' })
            ],
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC', space: 2 } }
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              styledRun('— ', FONT.header),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Microsoft YaHei' }),
              styledRun(' —', FONT.header)
            ],
            alignment: AlignmentType.CENTER
          })]
        })
      }
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

module.exports = {
  exportNotebookWord,
  exportDiscussionWord,
  exportMergedDiscussionWord,
  exportLectureWord
};
