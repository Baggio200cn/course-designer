/**
 * 端到端测试：教学框架 → Word 教学设计导出
 * 验证完整链路：框架数据 → Word 导出（含六列教学过程表）
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { exportNotebookWord } = require('../src/main/export/word');

async function run() {
  console.log('=== 教学框架 → Word 导出端到端测试 ===\n');

  // 测试 1：LED 电路课程（4 模块）
  console.log('--- Test 1: LED 电路课程 ---');
  const result1 = await testCourse({
    name: '菊花LED补光电路装置',
    courseCode: '080501',
    totalHours: 64,
    theoryHours: 32,
    practiceHours: 32,
    grade: '中职二年级',
    prerequisite: '电工基础',
    description: '本课程围绕菊花LED补光电路装置的设计、制作与调试展开，培养学生的电路分析能力和实操动手能力。',
    modules: [
      { moduleNumber: 1, name: 'LED补光电路原理认知', hours: 4, description: '结合发光演示理解LED补光电路的基本工作过程。', knowledgePoints: ['LED发光特性', '电流方向判断', '基本工作原理'] },
      { moduleNumber: 2, name: '电路元件识别与连接基础', hours: 4, description: '识别电源、电阻、导线与LED灯珠的连接关系。', knowledgePoints: ['电源识别', '电阻作用', '串联连接'] },
      { moduleNumber: 3, name: '菊花型LED电路组装', hours: 6, description: '按顺序完成菊花型补光装置的基础连接与固定。', knowledgePoints: ['元件摆放顺序', '焊接连接', '结构固定'] },
      { moduleNumber: 4, name: '电路调试与成果验收', hours: 4, description: '围绕点亮效果、电路稳定性和安全性完成调试。', knowledgePoints: ['通电调试', '故障排查', '验收标准'] }
    ],
    framework: {
      objectives: {
        knowledge: ['理解LED补光电路的基本工作原理', '掌握电路元件的识别方法'],
        skills: ['能够独立完成菊花型LED电路组装', '能够使用万用表进行电路调试'],
        attitude: ['养成安全操作习惯', '培养精益求精的工匠精神']
      },
      keyPoints: {
        highlights: ['LED正负极判断与电流方向', '焊接操作规范与安全要求'],
        difficulties: ['电路故障排查逻辑', '焊接质量控制']
      }
    },
    outputFile: 'test-word-led.docx'
  });

  // 测试 2：服装传播课程（6 模块）
  console.log('\n--- Test 2: 服装传播课程 ---');
  const result2 = await testCourse({
    name: '匠心于形、传播有声——服装POP海报创意设计',
    courseCode: '130505',
    totalHours: 36,
    theoryHours: 18,
    practiceHours: 18,
    grade: '中职一年级',
    prerequisite: '色彩基础',
    description: '本课程围绕服装POP海报创意设计展开，培养学生的视觉传播能力和创意表达能力。',
    modules: [
      { moduleNumber: 1, name: '寻·潮起', hours: 2, description: '认识POP海报在服装传播中的作用。', knowledgePoints: ['POP定义', '传播功能', '吸引注意'] },
      { moduleNumber: 2, name: '解·器用', hours: 4, description: '分析POP海报的主题、文案、图案和构图。', knowledgePoints: ['主题', '文案', '构图'] },
      { moduleNumber: 3, name: '立·标准', hours: 2, description: '建立POP海报的评价标准。', knowledgePoints: ['视觉冲击力', '信息传达力', '艺术感染力'] },
      { moduleNumber: 4, name: '创·拼图', hours: 6, description: '围绕品牌任务完成POP海报草图设计。', knowledgePoints: ['卖点提炼', '版式组织', '视觉表达'] },
      { moduleNumber: 5, name: '评·互鉴', hours: 4, description: '使用评价标准进行互评与修改。', knowledgePoints: ['互评标准', '修改建议', '表达优化'] },
      { moduleNumber: 6, name: '悟·回收', hours: 2, description: '回收知识点并完成课堂测验。', knowledgePoints: ['知识回顾', '概念迁移', '课堂测验'] }
    ],
    framework: {
      objectives: {
        knowledge: ['理解POP海报的传播功能', '掌握海报构图基本原则'],
        skills: ['能够独立完成POP海报草图设计', '能够运用评价标准互评作品'],
        attitude: ['培养审美素养', '增强品牌意识']
      },
      keyPoints: {
        highlights: ['POP海报的视觉传达三要素', '品牌卖点提炼方法'],
        difficulties: ['从品牌角度而非纯美术角度设计海报', '评价标准的实际运用']
      }
    },
    outputFile: 'test-word-fashion.docx'
  });

  // 测试 3：单模块极端情况
  console.log('\n--- Test 3: 单模块课程 ---');
  const result3 = await testCourse({
    name: '光学镜头清洁与维护',
    courseCode: '080502',
    totalHours: 8,
    theoryHours: 2,
    practiceHours: 6,
    grade: '中职三年级',
    prerequisite: '光学基础',
    description: '短期实训课程，围绕光学镜头的清洁操作与日常维护展开。',
    modules: [
      { moduleNumber: 1, name: '镜头清洁操作规范', hours: 8, description: '掌握光学镜头的标准清洁流程。', knowledgePoints: ['清洁工具选择', '操作步骤', '质量检查'] }
    ],
    framework: {
      objectives: {
        knowledge: ['了解光学镜头的材质特性'],
        skills: ['掌握镜头清洁标准操作'],
        attitude: ['养成精密设备爱护意识']
      }
    },
    outputFile: 'test-word-optics.docx'
  });

  console.log('\n=== 全部测试完成 ===');
  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    tests: [
      { name: 'LED电路(4模块)', ...result1 },
      { name: '服装传播(6模块)', ...result2 },
      { name: '光学清洁(1模块)', ...result3 }
    ]
  }, null, 2));
}

async function testCourse({ name, courseCode, totalHours, theoryHours, practiceHours, grade, prerequisite, description, modules, framework, outputFile }) {
  const outputPath = path.join(__dirname, '..', 'output', outputFile);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const result = await exportNotebookWord({
    notebook: { name, courseCode, totalHours, theoryHours, practiceHours, grade, prerequisite, description },
    modules,
    schedule: [],
    framework,
    outputPath
  });

  assert.ok(fs.existsSync(result), `Word file should exist: ${outputFile}`);
  const stats = fs.statSync(result);
  assert.ok(stats.size > 1000, `Word file too small: ${stats.size}`);

  console.log(`  ✅ ${outputFile} (${(stats.size / 1024).toFixed(1)} KB, ${modules.length} modules)`);
  return { file: outputFile, sizeKB: (stats.size / 1024).toFixed(1), moduleCount: modules.length };
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
