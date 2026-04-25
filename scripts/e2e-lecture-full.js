/**
 * 讲课稿正式稿端到端测试 - 多课程 × 多基准稿 × 完整质量检查
 */
const path = require('path');
const fs = require('fs');
const { ArkCourseClient } = require('../src/main/api/ark-course-client');
const { generateLectureABCDrafts } = require('../src/main/script/abc-generator');
const { generateFormalLectureScript } = require('../src/main/script/formal-generator');
const { validateLectureStage } = require('../src/main/v2/quality');

function loadApiConfig() {
  const p = path.join(process.env.APPDATA || '', '课程设计AI助手@baggio', 'course-designer-data.json');
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const s = data.settings || {};
    const dec = (k) => { const v = s[`api_key_${k}`]; return v && s[`api_key_${k}_encrypted`] ? Buffer.from(v, 'base64').toString('utf8') : (v || ''); };
    return { apiKey: dec('ark'), endpointId: dec('ark_endpoint_text_deepseek') || dec('ark_endpoint_text') };
  } catch { return null; }
}

const COURSES = [
  {
    name: 'LED电路',
    courseName: '菊花LED补光电路装置',
    modules: [
      { moduleNumber: 1, name: 'LED补光电路原理认知', knowledgePoints: ['LED发光特性', '电流方向判断', '基本工作原理'] },
      { moduleNumber: 2, name: '电路元件识别与连接基础', knowledgePoints: ['电源识别', '电阻作用', '串联连接'] },
      { moduleNumber: 3, name: '菊花型LED电路组装', knowledgePoints: ['元件摆放顺序', '焊接连接', '结构固定'] },
      { moduleNumber: 4, name: '电路调试与成果验收', knowledgePoints: ['通电调试', '故障排查', '验收标准'] }
    ]
  },
  {
    name: '服装POP',
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: [
      { moduleNumber: 1, name: '寻·潮起', knowledgePoints: ['POP定义', '传播功能', '吸引注意'] },
      { moduleNumber: 2, name: '解·器用', knowledgePoints: ['主题', '文案', '构图'] },
      { moduleNumber: 3, name: '立·标准', knowledgePoints: ['视觉冲击力', '信息传达力', '艺术感染力'] },
      { moduleNumber: 4, name: '创·拼图', knowledgePoints: ['卖点提炼', '版式组织', '视觉表达'] },
      { moduleNumber: 5, name: '评·互鉴', knowledgePoints: ['互评标准', '修改建议', '表达优化'] },
      { moduleNumber: 6, name: '悟·回收', knowledgePoints: ['知识回顾', '概念迁移', '课堂测验'] }
    ]
  }
];

function checkScript(script, meta) {
  const lines = script.split(/\r?\n/);
  const greetings = lines.filter(l => /大家好|同学们好|欢迎来到今天的课堂/.test(l)).length;
  const metaLeaks = (script.match(/这一段先把|第\s*\d+\s*段必须|写作要求|风格提醒|目标聚焦|板书关键词|课堂检查重点/g) || []);
  const ruleLeaks = (script.match(/常用'我向大家|开场规则|模块推进规则|结尾规则/g) || []);
  const garbage = (script.match(/大家好，欢迎来到今天的课堂[，。]?这节课/g) || []);
  const hasOpening = /开场导入/.test(script);
  const hasPractice = /课堂练习/.test(script);
  const hasSummary = /总结收束/.test(script);
  const hasNarration = /教师讲述[:：]/.test(script);
  const hasActions = /课堂动作/.test(script);
  const questions = (script.match(/[？?]/g) || []).length;
  const transitions = ['首先', '接着', '因此', '最后'].filter(w => script.includes(w));

  return {
    genMode: meta?.generationMode || 'unknown',
    baseDraft: meta?.usedBaseDraft || '?',
    narrationChars: meta?.validation?.teacherNarrationCharCount || 0,
    charPass: (meta?.validation?.teacherNarrationCharCount || 0) >= 2200,
    greetings, greetingPass: greetings <= 1,
    metaLeaks: metaLeaks.length, metaPass: metaLeaks.length === 0,
    ruleLeaks: ruleLeaks.length, rulePass: ruleLeaks.length === 0,
    garbage: garbage.length,
    structure: hasOpening && hasPractice && hasSummary && hasNarration && hasActions,
    questions,
    transitions: transitions.length,
    transitionWords: transitions
  };
}

async function run() {
  const config = loadApiConfig();
  if (!config || !config.apiKey) { console.error('No API config'); process.exit(1); }
  const aiClient = new ArkCourseClient({ apiKey: config.apiKey, endpointId: config.endpointId });
  console.log('[config] API ready\n');

  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const allResults = [];

  for (const course of COURSES) {
    console.log(`${'='.repeat(60)}`);
    console.log(`课程: ${course.name} (${course.modules.length} 模块)`);
    console.log(`${'='.repeat(60)}`);

    // 生成 ABC 三稿
    console.log('\n--- 生成 A/B/C 三稿 ---');
    const t0 = Date.now();
    const drafts = await generateLectureABCDrafts({
      courseName: course.courseName,
      modules: course.modules,
      styleRubricText: '',
      aiClient
    });
    console.log(`[TIME] ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const k of ['a', 'b', 'c']) {
      const chars = (drafts[k] || '').replace(/\s/g, '').length;
      console.log(`  ${k.toUpperCase()}稿: ${chars} 字`);
    }

    // 用 B 稿作为主基准测试正式稿
    console.log('\n--- 生成正式稿 (preferred=b) ---');
    const t1 = Date.now();
    const result = await generateFormalLectureScript({
      drafts, preferred: 'b',
      courseName: course.courseName, modules: course.modules, aiClient
    });
    console.log(`[TIME] ${((Date.now() - t1) / 1000).toFixed(0)}s`);

    const check = checkScript(result.script, result.meta);
    const quality = validateLectureStage({
      drafts, selectedDraft: 'b', finalScript: result.script
    }, { requireFinal: true });

    console.log(`\n--- 正式稿质量检查 ---`);
    console.log(`  生成模式:   ${check.genMode}`);
    console.log(`  讲述字数:   ${check.narrationChars} ${check.charPass ? '✅' : '❌'}`);
    console.log(`  寒暄重复:   ${check.greetings} ${check.greetingPass ? '✅' : '❌'}`);
    console.log(`  元提示泄露: ${check.metaLeaks} ${check.metaPass ? '✅' : '❌'}`);
    console.log(`  规则泄露:   ${check.ruleLeaks} ${check.rulePass ? '✅' : '❌'}`);
    console.log(`  垃圾模板句: ${check.garbage}`);
    console.log(`  结构完整:   ${check.structure ? '✅' : '❌'}`);
    console.log(`  提问数:     ${check.questions}`);
    console.log(`  推进词:     ${check.transitions}/4 (${check.transitionWords.join('、')})`);

    if (quality.warnings.length) {
      console.log(`  ⚠️ 警告: ${quality.warnings.join('; ')}`);
    }
    if (quality.errors.length) {
      console.log(`  ❌ 错误: ${quality.errors.join('; ')}`);
    }

    const allPass = check.charPass && check.greetingPass && check.metaPass && check.rulePass && check.structure;
    console.log(`\n  总评: ${allPass ? '✅ PASS' : '❌ FAIL'}`);

    // 保存
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const outFile = path.join(outputDir, `lecture-${course.name}-${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify({
      course: course.name, timestamp: stamp, check, quality,
      script: result.script,
      drafts: { a: drafts.a, b: drafts.b, c: drafts.c }
    }, null, 2), 'utf8');
    console.log(`  [SAVED] ${path.basename(outFile)}`);

    allResults.push({ course: course.name, ...check, allPass });
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('总结');
  console.log(`${'='.repeat(60)}`);
  allResults.forEach(r => {
    console.log(`${r.course}: 字数=${r.narrationChars} 模式=${r.genMode} ${r.allPass ? '✅' : '❌'}`);
  });

  const allOk = allResults.every(r => r.allPass);
  console.log(`\n最终结果: ${allOk ? '✅ ALL PASS' : '❌ HAS FAILURES'}`);
  console.log(JSON.stringify({ ok: allOk, results: allResults }, null, 2));
}

run().catch(e => { console.error('[FATAL]', e); process.exit(1); });
