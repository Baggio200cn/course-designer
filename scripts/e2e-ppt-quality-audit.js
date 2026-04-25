/**
 * PPT 全链路质量审计
 * 从真实讲课稿 → PPT 页面生成 → PPTX 导出 → 逐项检查
 */
const path = require('path');
const fs = require('fs');
const { buildPptPagesFromLecture, PPT_TEMPLATE_PRESETS } = require('../src/shared/v2-stage-helpers');
const { exportCoursePpt } = require('../src/main/export/ppt');

// 从最新的 API 测试结果中读取真实讲课稿
const lectureFiles = fs.readdirSync(path.join(__dirname, '..', 'output'))
  .filter(f => f.startsWith('lecture-服装POP-') && f.endsWith('.json'))
  .sort().reverse();

if (!lectureFiles.length) {
  console.error('No lecture output found. Run e2e-lecture-full.js first.');
  process.exit(1);
}

const lectureData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'output', lectureFiles[0]), 'utf8'));
const script = lectureData.script;
const courseName = '匠心于形、传播有声——服装POP海报创意设计';

const modules = [
  { moduleNumber: 1, name: '寻·潮起', knowledgePoints: ['POP定义', '传播功能', '吸引注意'] },
  { moduleNumber: 2, name: '解·器用', knowledgePoints: ['主题', '文案', '构图'] },
  { moduleNumber: 3, name: '立·标准', knowledgePoints: ['视觉冲击力', '信息传达力', '艺术感染力'] },
  { moduleNumber: 4, name: '创·拼图', knowledgePoints: ['卖点提炼', '版式组织', '视觉表达'] },
  { moduleNumber: 5, name: '评·互鉴', knowledgePoints: ['互评标准', '修改建议', '表达优化'] },
  { moduleNumber: 6, name: '悟·回收', knowledgePoints: ['知识回顾', '概念迁移', '课堂测验'] }
];

async function run() {
  console.log('='  .repeat(70));
  console.log('PPT 全链路质量审计');
  console.log('=' .repeat(70));
  console.log(`讲课稿来源: ${lectureFiles[0]}`);
  console.log(`讲课稿字数: ${script.length}`);

  // ===== 1. 讲稿章节解析 =====
  console.log('\n--- 1. 讲稿章节解析 ---');
  const headings = script.split(/\r?\n/).filter(l => /^##\s+/.test(l.trim()));
  console.log(`  解析出 ${headings.length} 个章节:`);
  headings.forEach((h, i) => {
    console.log(`  [${i + 1}] ${h.trim()}`);
  });

  // ===== 2. PPT 页面生成 =====
  console.log('\n--- 2. PPT 页面生成 ---');
  const template = PPT_TEMPLATE_PRESETS.modern;
  const pages = buildPptPagesFromLecture({
    lectureScript: script,
    courseName,
    modules,
    template,
    imageAspect: '16:9',
    imageQuality: 'standard'
  });
  console.log(`  生成 ${pages.length} 页`);

  // ===== 3. 逐页质量检查 =====
  console.log('\n--- 3. 逐页质量检查 ---');
  const issues = [];
  const pageTypes = {};

  pages.forEach((p, i) => {
    const num = p.pageNumber || i + 1;
    const type = p.pageType || 'unknown';
    pageTypes[type] = (pageTypes[type] || 0) + 1;

    const titleLen = (p.title || '').length;
    const summaryLen = (p.summary || '').length;
    const keyContentCount = (p.keyContent || []).length;
    const hasImage = p.needImage;
    const imagePromptLen = (p.imagePrompt || '').length;

    // 检查项
    const pageIssues = [];
    if (!p.title || titleLen < 2) pageIssues.push('标题缺失或过短');
    if (titleLen > 30) pageIssues.push(`标题过长(${titleLen}字)`);
    if (!p.summary && type !== '封面' && type !== '封底') pageIssues.push('摘要缺失');
    if (summaryLen > 100) pageIssues.push(`摘要过长(${summaryLen}字)`);
    if (keyContentCount === 0 && !['封面', '路线图', '封底', '总结', '总结收束'].includes(type)) pageIssues.push('关键内容缺失');

    // 垃圾内容检查
    const allText = [p.title, p.subtitle, p.summary, ...(p.keyContent || [])].join(' ');
    if (/#[0-9A-Fa-f]{6}/.test(allText)) pageIssues.push('含色码');
    if (/大家好，欢迎来到今天的课堂/.test(allText)) pageIssues.push('含垃圾问候句');
    if (/这一段先把|第\s*\d+\s*段必须/.test(allText)) pageIssues.push('含元提示');
    if (/主体内容区|页脚提示区/.test(allText)) pageIssues.push('含UI标签');
    if (/拓扑框线|编号盒子/.test(allText)) pageIssues.push('含拓扑元素');

    // 图片 prompt 检查
    if (hasImage && imagePromptLen < 20) pageIssues.push('图片prompt过短');
    if (hasImage && /色码|#[0-9A-Fa-f]{6}|拓扑框线/.test(p.imagePrompt || '')) pageIssues.push('图片prompt含禁止项');

    // 内容与讲稿的关联检查
    const isFromScript = script.includes(p.title?.replace(/[（(].*?[）)]/g, '').trim().substring(0, 6) || '____NOMATCH____');

    const status = pageIssues.length === 0 ? '✅' : '⚠️';
    console.log(`  P${num} [${type}] "${(p.title || '').substring(0, 25)}" ${status} ${hasImage ? '🖼️' : '  '} 摘要${summaryLen}字 要点${keyContentCount}个 ${isFromScript ? '📎讲稿关联' : ''}`);
    if (pageIssues.length) {
      pageIssues.forEach(issue => {
        console.log(`      ❗ ${issue}`);
        issues.push({ page: num, type, issue });
      });
    }
  });

  // ===== 4. 页型分布 =====
  console.log('\n--- 4. 页型分布 ---');
  Object.entries(pageTypes).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}页`);
  });

  // ===== 5. 排序逻辑检查 =====
  console.log('\n--- 5. 排序逻辑检查 ---');
  const expectedOrder = ['封面', '路线图', '课程导入', '模块导入', '原理讲解', '操作步骤', '验收检查', '课堂练习', '总结收束', '模块页', '内容页', '总结'];
  const pageTypeSequence = pages.map(p => p.pageType);

  // 封面必须在最前
  const coverFirst = pageTypeSequence[0] === '封面';
  console.log(`  封面在首位: ${coverFirst ? '✅' : '❌'}`);

  // 路线图在封面后
  const routeAfterCover = pageTypeSequence.indexOf('路线图') === 1;
  console.log(`  路线图在第2位: ${routeAfterCover ? '✅' : (pageTypeSequence.includes('路线图') ? '⚠️ 位置偏移' : '❌ 缺失')}`);

  // 总结在最后
  const lastTypes = pageTypeSequence.slice(-2);
  const endingOK = lastTypes.some(t => ['总结', '总结收束'].includes(t));
  console.log(`  总结在末尾: ${endingOK ? '✅' : '❌'}`);

  // 模块顺序
  const modulePages = pages.filter(p => p.moduleId || /模块/.test(p.pageType));
  const moduleNums = modulePages.map(p => {
    const m = (p.title || '').match(/模块\s*(\d+)/);
    return m ? parseInt(m[1]) : 0;
  }).filter(n => n > 0);
  const moduleOrderCorrect = moduleNums.every((n, i) => i === 0 || n >= moduleNums[i - 1]);
  console.log(`  模块顺序递增: ${moduleOrderCorrect ? '✅' : '❌'} (${moduleNums.join('→')})`);

  // ===== 6. 重点模块覆盖检查 =====
  console.log('\n--- 6. 重点模块覆盖检查 ---');
  modules.forEach(m => {
    const covered = pages.some(p => {
      const allText = [p.title, p.subtitle, p.summary, ...(p.keyContent || [])].join(' ');
      return allText.includes(m.name) || allText.includes(m.name.replace(/[·]/g, ''));
    });
    console.log(`  模块${m.moduleNumber} "${m.name}": ${covered ? '✅ 已覆盖' : '❌ 未覆盖'}`);
  });

  // ===== 7. PPTX 导出测试 =====
  console.log('\n--- 7. PPTX 导出 ---');
  const outputDir = path.join(__dirname, '..', 'output');
  const outputPath = path.join(outputDir, 'ppt-quality-audit.pptx');
  try {
    await exportCoursePpt({
      notebook: { name: courseName },
      framework: {},
      modules,
      lectureScript: script,
      pptPages: pages,
      templateKey: 'modern',
      outputPath
    });
    const stats = fs.statSync(outputPath);
    console.log(`  ✅ 导出成功: ${(stats.size / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.log(`  ❌ 导出失败: ${err.message}`);
  }

  // ===== 8. 综合评分 =====
  console.log('\n' + '=' .repeat(70));
  console.log('综合评分');
  console.log('=' .repeat(70));

  const scores = {
    pageCount: pages.length >= 8 && pages.length <= 15 ? '✅' : '⚠️',
    coverPresent: coverFirst ? '✅' : '❌',
    routePresent: pageTypeSequence.includes('路线图') ? '✅' : '❌',
    endingPresent: endingOK ? '✅' : '❌',
    moduleOrder: moduleOrderCorrect ? '✅' : '❌',
    noGarbage: issues.filter(i => i.issue.includes('垃圾') || i.issue.includes('元提示') || i.issue.includes('色码')).length === 0 ? '✅' : '❌',
    allModulesCovered: modules.every(m => pages.some(p => [p.title, p.subtitle, p.summary, ...(p.keyContent || [])].join(' ').includes(m.name))) ? '✅' : '⚠️',
    issueCount: issues.length
  };

  console.log(`  页数合理 (${pages.length}页):  ${scores.pageCount}`);
  console.log(`  封面存在:          ${scores.coverPresent}`);
  console.log(`  路线图存在:        ${scores.routePresent}`);
  console.log(`  总结在末尾:        ${scores.endingPresent}`);
  console.log(`  模块顺序正确:      ${scores.moduleOrder}`);
  console.log(`  无垃圾内容:        ${scores.noGarbage}`);
  console.log(`  全模块覆盖:        ${scores.allModulesCovered}`);
  console.log(`  问题总数:          ${scores.issueCount}`);

  console.log(JSON.stringify({ ok: true, scores, issueCount: issues.length, pageCount: pages.length, issues }, null, 2));
}

run().catch(e => { console.error('[FATAL]', e); process.exit(1); });
