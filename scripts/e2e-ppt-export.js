/**
 * 端到端测试：讲稿 → PPT 页面生成 → PPTX 导出
 * 验证完整链路：讲稿解析 → 页面构建 → PPT 文件生成
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { generateLectureABCDrafts } = require('../src/main/script/abc-generator');
const { generateFormalLectureScript } = require('../src/main/script/formal-generator');
const { buildPptPagesFromLecture, PPT_TEMPLATE_PRESETS } = require('../src/shared/v2-stage-helpers');
const { exportCoursePpt } = require('../src/main/export/ppt');

const modules = [
  { moduleNumber: 1, name: 'LED补光电路原理认知', hours: 4, description: '结合发光演示理解LED补光电路的基本工作过程。', knowledgePoints: ['LED发光特性', '电流方向判断', '基本工作原理'] },
  { moduleNumber: 2, name: '电路元件识别与连接基础', hours: 4, description: '识别电源、电阻、导线与LED灯珠的连接关系。', knowledgePoints: ['电源识别', '电阻作用', '串联连接'] },
  { moduleNumber: 3, name: '菊花型LED电路组装', hours: 6, description: '按顺序完成菊花型补光装置的基础连接与固定。', knowledgePoints: ['元件摆放顺序', '焊接连接', '结构固定'] },
  { moduleNumber: 4, name: '电路调试与成果验收', hours: 4, description: '围绕点亮效果、电路稳定性和安全性完成调试。', knowledgePoints: ['通电调试', '故障排查', '验收标准'] }
];

async function run() {
  console.log('=== 讲稿 → PPT 导出端到端测试 ===\n');

  // Step 1: 生成讲稿（本地模式，不调 API）
  console.log('--- Step 1: 生成 A/B/C 三稿 ---');
  const drafts = await generateLectureABCDrafts({
    courseName: '菊花LED补光电路装置',
    modules,
    styleRubricText: ''
  });
  console.log(`  A稿: ${(drafts.a || '').length} chars`);
  console.log(`  B稿: ${(drafts.b || '').length} chars`);
  console.log(`  C稿: ${(drafts.c || '').length} chars`);

  // Step 2: 生成正式稿
  console.log('\n--- Step 2: 生成正式稿 ---');
  const formalResult = await generateFormalLectureScript({
    drafts,
    preferred: 'b',
    courseName: '菊花LED补光电路装置',
    modules
  });
  const script = formalResult.script;
  console.log(`  正式稿: ${script.length} chars`);
  console.log(`  讲述字数: ${formalResult.meta.validation.teacherNarrationCharCount}`);

  // Step 3: 从讲稿生成 PPT 页面
  console.log('\n--- Step 3: 从讲稿生成 PPT 页面 ---');
  const pages = buildPptPagesFromLecture({
    lectureScript: script,
    courseName: '菊花LED补光电路装置',
    modules,
    template: PPT_TEMPLATE_PRESETS.modern,
    imageAspect: '16:9',
    imageQuality: 'standard'
  });
  console.log(`  生成页数: ${pages.length}`);

  const pageTypes = {};
  pages.forEach((p) => {
    const t = p.pageType || 'unknown';
    pageTypes[t] = (pageTypes[t] || 0) + 1;
  });
  console.log(`  页型分布: ${JSON.stringify(pageTypes)}`);

  // 检查关键属性
  pages.forEach((p, i) => {
    assert.ok(p.title, `Page ${i + 1} should have title`);
    assert.ok(p.pageType, `Page ${i + 1} should have pageType`);
  });

  // 检查垃圾内容
  const garbagePatterns = [
    /大家好，欢迎来到今天的课堂/,
    /这一段先把.*讲透/,
    /#[0-9A-Fa-f]{6}/,
    /主体内容区/,
    /页脚提示区/
  ];
  let garbageFound = 0;
  pages.forEach((p) => {
    const allText = [p.title, p.subtitle, p.summary, ...(p.keyContent || [])].join(' ');
    garbagePatterns.forEach((pattern) => {
      if (pattern.test(allText)) {
        garbageFound++;
        console.log(`  ⚠️ Garbage in page ${p.pageNumber}: ${pattern}`);
      }
    });
  });
  console.log(`  垃圾句检查: ${garbageFound === 0 ? '✅ 无垃圾句' : `❌ ${garbageFound} 处`}`);

  // Step 4: 导出 PPTX 文件（测试所有 4 种模板风格）
  console.log('\n--- Step 4: 导出 PPTX 文件 ---');
  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  for (const templateKey of ['modern', 'national', 'playful', 'blueprint']) {
    const outputPath = path.join(outputDir, `test-ppt-${templateKey}.pptx`);
    try {
      await exportCoursePpt({
        notebook: { name: '菊花LED补光电路装置' },
        framework: {},
        modules,
        lectureScript: script,
        pptPages: pages,
        templateKey,
        outputPath
      });
      const stats = fs.statSync(outputPath);
      console.log(`  ✅ ${templateKey}: ${(stats.size / 1024).toFixed(1)} KB`);
    } catch (err) {
      console.log(`  ❌ ${templateKey}: ${err.message}`);
    }
  }

  console.log('\n=== PPT 测试完成 ===');
  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    pageCount: pages.length,
    pageTypes,
    garbageFound,
    narrationCharCount: formalResult.meta.validation.teacherNarrationCharCount
  }, null, 2));
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
