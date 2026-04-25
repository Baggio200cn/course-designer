const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { exportNotebookWord } = require('../src/main/export/word');

async function run() {
  const outputPath = path.join(__dirname, '..', 'output', 'test-teaching-design.docx');
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const notebook = {
    name: '菊花LED补光电路装置',
    courseCode: '080501',
    totalHours: 64,
    theoryHours: 32,
    practiceHours: 32,
    grade: '中职二年级',
    prerequisite: '电工基础',
    description: '本课程围绕菊花LED补光电路装置的设计、制作与调试展开，培养学生的电路分析能力和实操动手能力。'
  };

  const modules = [
    {
      moduleNumber: 1,
      name: 'LED补光电路原理认知',
      hours: 4,
      description: '结合发光演示理解LED补光电路的基本工作过程。',
      knowledgePoints: ['LED发光特性', '电流方向判断', '基本工作原理'],
      teachingMethods: '演示教学法、任务驱动法'
    },
    {
      moduleNumber: 2,
      name: '电路元件识别与连接基础',
      hours: 4,
      description: '识别电源、电阻、导线与LED灯珠的连接关系。',
      knowledgePoints: ['电源识别', '电阻作用', '串联连接'],
      teachingMethods: '实物教学法、分组操作法'
    },
    {
      moduleNumber: 3,
      name: '菊花型LED电路组装',
      hours: 6,
      description: '按顺序完成菊花型补光装置的基础连接与固定。',
      knowledgePoints: ['元件摆放顺序', '焊接连接', '结构固定'],
      teachingMethods: '示范教学法、工序训练法'
    },
    {
      moduleNumber: 4,
      name: '电路调试与成果验收',
      hours: 4,
      description: '围绕点亮效果、电路稳定性和安全性完成调试。',
      knowledgePoints: ['通电调试', '故障排查', '验收标准'],
      teachingMethods: '项目验收法、互评法'
    }
  ];

  const framework = {
    objectives: {
      knowledge: ['理解LED补光电路的基本工作原理', '掌握电路元件的识别方法', '了解电路安全规范'],
      skills: ['能够独立完成菊花型LED电路组装', '能够使用万用表进行电路调试', '能够按照验收标准检查成品'],
      attitude: ['养成安全操作习惯', '培养精益求精的工匠精神', '建立团队协作意识']
    },
    keyPoints: {
      highlights: ['LED正负极判断与电流方向', '焊接操作规范与安全要求'],
      difficulties: ['电路故障排查逻辑', '焊接质量控制']
    }
  };

  const result = await exportNotebookWord({
    notebook,
    modules,
    schedule: [],
    framework,
    outputPath
  });

  assert.ok(fs.existsSync(result), 'Word file should exist');
  const stats = fs.statSync(result);
  assert.ok(stats.size > 1000, `Word file should be > 1KB, got ${stats.size}`);

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    outputPath: result,
    fileSizeKB: (stats.size / 1024).toFixed(1)
  }, null, 2));
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
