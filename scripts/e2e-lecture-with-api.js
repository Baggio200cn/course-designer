/**
 * 端到端讲稿生成测试 - 带 API 调用
 * 从数据库读取 API key，创建 AI client，走完整生成链路
 */
const path = require('path');
const fs = require('fs');
const { ArkCourseClient } = require('../src/main/api/ark-course-client');
const { generateLectureABCDrafts } = require('../src/main/script/abc-generator');
const { generateFormalLectureScript } = require('../src/main/script/formal-generator');

// 从数据库 JSON 文件读取 API 配置
function loadApiConfig() {
  const candidates = [
    path.join(process.env.APPDATA || '', '课程设计AI助手@baggio', 'course-designer-data.json'),
    path.join(process.env.APPDATA || '', 'Electron', 'course-designer-data.json'),
  ];
  for (const p of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const settings = data.settings || {};
      const decode = (key) => {
        const val = settings[`api_key_${key}`];
        if (!val) return '';
        if (settings[`api_key_${key}_encrypted`]) {
          return Buffer.from(val, 'base64').toString('utf8');
        }
        return val;
      };
      const apiKey = decode('ark');
      const endpointId = decode('ark_endpoint_text_deepseek') || decode('ark_endpoint_text');
      if (apiKey && endpointId) {
        console.log(`[config] Loaded from: ${path.basename(path.dirname(p))}`);
        console.log(`[config] endpoint: ${endpointId.substring(0, 8)}...`);
        return { apiKey, endpointId };
      }
    } catch {}
  }
  return null;
}

const modules = [
  {
    moduleNumber: 1,
    name: 'LED补光电路原理认知',
    description: '结合发光演示理解LED补光电路的基本工作过程。',
    knowledgePoints: ['LED发光特性', '电流方向判断', '基本工作原理']
  },
  {
    moduleNumber: 2,
    name: '电路元件识别与连接基础',
    description: '识别电源、电阻、导线与LED灯珠的连接关系。',
    knowledgePoints: ['电源识别', '电阻作用', '串联连接']
  },
  {
    moduleNumber: 3,
    name: '菊花型LED电路组装',
    description: '按顺序完成菊花型补光装置的基础连接与固定。',
    knowledgePoints: ['元件摆放顺序', '焊接连接', '结构固定']
  },
  {
    moduleNumber: 4,
    name: '电路调试与成果验收',
    description: '围绕点亮效果、电路稳定性和安全性完成调试。',
    knowledgePoints: ['通电调试', '故障排查', '验收标准']
  }
];

async function run() {
  const config = loadApiConfig();
  if (!config) {
    console.error('[FAIL] No API config found. Cannot run e2e test.');
    process.exit(1);
  }

  const aiClient = new ArkCourseClient({
    apiKey: config.apiKey,
    endpointId: config.endpointId
  });

  console.log('\n=== Step 1: 生成 A/B/C 三稿 (with API) ===');
  const t0 = Date.now();
  const drafts = await generateLectureABCDrafts({
    courseName: '菊花LED补光电路装置',
    modules,
    styleRubricText: '',
    aiClient
  });
  const t1 = Date.now();
  console.log(`[TIME] ABC drafts: ${((t1 - t0) / 1000).toFixed(1)}s`);

  // 检查三稿
  const results = { abc: {}, formal: {} };
  for (const key of ['a', 'b', 'c']) {
    const text = drafts[key] || '';
    const charCount = text.replace(/\s/g, '').length;
    const hasOpening = /开场导入/.test(text);
    const hasTeacherNarration = /教师讲述/.test(text);
    const hasActions = /课堂动作/.test(text);
    const hasPractice = /课堂练习/.test(text);
    const hasSummary = /总结收束/.test(text);
    const greetingCount = (text.match(/大家好|同学们好/g) || []).length;
    const metaLeaks = (text.match(/这一段先把|第\s*\d+\s*段必须|写作要求|风格提醒/g) || []);

    results.abc[key] = {
      charCount,
      hasOpening,
      hasTeacherNarration,
      hasActions,
      hasPractice,
      hasSummary,
      greetingCount,
      metaLeaks: metaLeaks.length > 0 ? metaLeaks : 'none'
    };
    console.log(`\n[Draft ${key.toUpperCase()}] chars=${charCount}, opening=${hasOpening}, narration=${hasTeacherNarration}, practice=${hasPractice}, summary=${hasSummary}, greetings=${greetingCount}, metaLeaks=${metaLeaks.length}`);
  }

  console.log('\n=== Step 2: 生成正式稿 (with API) ===');
  const t2 = Date.now();
  const formalResult = await generateFormalLectureScript({
    drafts,
    preferred: 'b',
    courseName: '菊花LED补光电路装置',
    modules,
    aiClient
  });
  const t3 = Date.now();
  console.log(`[TIME] Formal: ${((t3 - t2) / 1000).toFixed(1)}s`);

  const script = formalResult.script || '';
  const meta = formalResult.meta || {};
  const narrationCharCount = meta.validation?.teacherNarrationCharCount || 0;
  const effectiveCharCount = meta.validation?.effectiveCharCount || 0;
  const genMode = meta.generationMode || 'unknown';
  const greetingLines = script.split(/\r?\n/).filter(line => /大家好|同学们好|欢迎来到今天的课堂/.test(line));
  const metaLeakMatches = script.match(/这一段先把|第\s*\d+\s*段必须|写作要求|风格提醒|目标聚焦|时间：|教师示范|板书关键词|课堂检查重点/g) || [];
  const hasOpening = /开场导入/.test(script);
  const hasModules = modules.every((_, i) => new RegExp(`模块\\s*${i + 1}`).test(script) || new RegExp(`## .*${modules[i].name}`).test(script));
  const hasPractice = /课堂练习/.test(script);
  const hasSummary = /总结收束/.test(script);
  const ruleLeaks = script.match(/常用'我向大家提个小问题'|开场规则|模块推进规则|结尾规则/g) || [];

  results.formal = {
    generationMode: genMode,
    usedBaseDraft: meta.usedBaseDraft,
    narrationCharCount,
    effectiveCharCount,
    charCountPass: narrationCharCount >= 2200 && narrationCharCount <= 3000,
    greetingCount: greetingLines.length,
    greetingPass: greetingLines.length <= 1,
    metaLeakCount: metaLeakMatches.length,
    metaLeakPass: metaLeakMatches.length === 0,
    ruleLeakCount: ruleLeaks.length,
    ruleLeakPass: ruleLeaks.length === 0,
    hasOpening,
    hasAllModules: hasModules,
    hasPractice,
    hasSummary,
    structurePass: hasOpening && hasModules && hasPractice && hasSummary
  };

  console.log('\n=== 正式稿检查结果 ===');
  console.log(`  生成模式: ${genMode}`);
  console.log(`  基准稿: ${meta.usedBaseDraft}`);
  console.log(`  讲述字数: ${narrationCharCount} (目标 2200-3000) ${results.formal.charCountPass ? '✅' : '❌'}`);
  console.log(`  寒暄次数: ${greetingLines.length} (目标 ≤1) ${results.formal.greetingPass ? '✅' : '❌'}`);
  console.log(`  元提示泄露: ${metaLeakMatches.length} ${results.formal.metaLeakPass ? '✅' : '❌'}`);
  console.log(`  规则文本泄露: ${ruleLeaks.length} ${results.formal.ruleLeakPass ? '✅' : '❌'}`);
  console.log(`  结构完整: ${results.formal.structurePass ? '✅' : '❌'} (开场=${hasOpening}, 模块=${hasModules}, 练习=${hasPractice}, 总结=${hasSummary})`);

  const allPass = results.formal.charCountPass && results.formal.greetingPass && results.formal.metaLeakPass && results.formal.ruleLeakPass && results.formal.structurePass;
  console.log(`\n=== 总评: ${allPass ? '✅ ALL PASS' : '❌ FAILED'} ===`);

  // 保存完整输出到文件
  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const outputFile = path.join(outputDir, `e2e-lecture-${timestamp}.json`);
  fs.writeFileSync(outputFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    results,
    formalScript: script,
    drafts: { a: drafts.a, b: drafts.b, c: drafts.c }
  }, null, 2), 'utf8');
  console.log(`\n[OUTPUT] Saved to: ${outputFile}`);
}

run().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
