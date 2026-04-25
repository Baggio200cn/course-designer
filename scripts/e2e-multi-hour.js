/**
 * 多学时分段生成测试
 * 验证 2学时课程是否正确分2段调用AI并合并
 */
const path = require('path');
const fs = require('fs');
const { ArkCourseClient } = require('../src/main/api/ark-course-client');
const { generateFormalLectureScript } = require('../src/main/script/formal-generator');
const { generateLectureABCDrafts } = require('../src/main/script/abc-generator');

function loadApiConfig() {
  const p = path.join(process.env.APPDATA || '', '课程设计AI助手@baggio', 'course-designer-data.json');
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const s = data.settings || {};
    const dec = (k) => { const v = s[`api_key_${k}`]; return v && s[`api_key_${k}_encrypted`] ? Buffer.from(v, 'base64').toString('utf8') : (v || ''); };
    return { apiKey: dec('ark'), endpointId: dec('ark_endpoint_text_deepseek') || dec('ark_endpoint_text') };
  } catch { return null; }
}

const modules = [
  { moduleNumber: 1, name: '导入与关系辨析', knowledgePoints: ['时尚产品的范畴', '服装的高频消费特性', '传播的重要性'] },
  { moduleNumber: 2, name: '产业与岗位分析', knowledgePoints: ['新媒体平台影响', '岗位核心能力', '产业调研'] },
  { moduleNumber: 3, name: '课程起源说明', knowledgePoints: ['需求背景', '教学改革', '课程迭代'] },
  { moduleNumber: 4, name: '专业建设支撑', knowledgePoints: ['时尚传播专业', '专业方向特色', '课程体系衔接'] },
  { moduleNumber: 5, name: '总结提升与课后思考', knowledgePoints: ['知识复盘', '传播影响力', '下节预告'] }
];

async function run() {
  const config = loadApiConfig();
  if (!config || !config.apiKey) { console.error('No API config'); process.exit(1); }
  const aiClient = new ArkCourseClient({ apiKey: config.apiKey, endpointId: config.endpointId });

  console.log('=== 2学时分段生成测试 ===\n');

  // 先生成 ABC 三稿
  console.log('--- 生成 ABC 三稿 ---');
  const t0 = Date.now();
  const drafts = await generateLectureABCDrafts({
    courseName: '第一节 服装产品传播起源',
    modules,
    styleRubricText: '',
    aiClient,
    totalHours: 2
  });
  console.log(`[TIME] ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  B稿: ${(drafts.b || '').replace(/\s/g, '').length} 字`);

  // 生成正式稿（2学时，应分2段）
  console.log('\n--- 生成正式稿（totalHours=2） ---');
  const t1 = Date.now();
  const result = await generateFormalLectureScript({
    drafts,
    preferred: 'b',
    courseName: '第一节 服装产品传播起源',
    modules,
    aiClient,
    totalHours: 2
  });
  console.log(`[TIME] ${((Date.now() - t1) / 1000).toFixed(0)}s`);
  console.log(`  生成模式: ${result.meta.generationMode}`);
  console.log(`  讲述字数: ${result.meta.validation.teacherNarrationCharCount}`);
  console.log(`  总字数: ${result.script.length}`);

  // 检查时间轴
  const timeLabels = result.script.match(/（\d+-\d+分钟）/g) || [];
  console.log(`  时间标签: ${timeLabels.join(', ')}`);
  const lastTime = timeLabels.length ? timeLabels[timeLabels.length - 1] : '';
  const maxMin = lastTime ? Number(lastTime.match(/(\d+)分钟/)?.[1] || 0) : 0;
  console.log(`  最大时间: ${maxMin}分钟 (目标90分钟) ${maxMin >= 80 ? '✅' : '⚠️'}`);

  // 检查章节
  const headings = result.script.match(/^##\s+.+$/gm) || [];
  console.log(`  章节数: ${headings.length}`);
  headings.forEach(h => console.log(`    ${h}`));

  // 保存
  const outFile = path.join(__dirname, '..', 'output', `multi-hour-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ script: result.script, meta: result.meta }, null, 2), 'utf8');
  console.log(`\n[SAVED] ${outFile}`);

  const isDeep = result.meta.generationMode.includes('deep');
  console.log(`\n=== ${isDeep ? '✅ PASS' : '⚠️ FALLBACK'} (${result.meta.generationMode}) ===`);
}

run().catch(e => { console.error('[FATAL]', e); process.exit(1); });
