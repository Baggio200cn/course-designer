const assert = require('assert');
const { generateLectureABCDrafts } = require('../src/main/script/abc-generator');
const { generateFormalLectureScript } = require('../src/main/script/formal-generator');
const { detectCourseProfile } = require('../src/main/script/course-profile');

function parseRanges(text) {
  return String(text || '')
    .match(/(\d+)-(\d+)分钟/g) || [];
}

async function run() {
  const badFormalPatterns = /先看这个情境|这一段先抓住三个字|落实成一个可检查的小任务|只背定义，要说出判断依据/;
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

  const drafts = await generateLectureABCDrafts({
    courseName: '菊花LED补光电路装置',
    modules,
    styleRubricText: ''
  });

  ['a', 'b', 'c'].forEach((key) => {
    assert.ok(drafts[key].includes('## 开场导入'));
    assert.ok(drafts[key].includes('教师讲述：'));
    assert.ok(drafts[key].includes('课堂动作附栏：'));
    assert.ok(drafts[key].includes('## 课堂练习与检查'));
    assert.ok(drafts[key].includes('## 总结收束'));
  });
  assert.ok(/知识主线|判断依据|逻辑/.test(drafts.a));
  assert.ok(/大家|你们|我会/.test(drafts.b));
  assert.ok(/巡视|互查|检查|任务/.test(drafts.c));
  assert.ok(!/46分钟|47分钟|48分钟|49分钟|50分钟/.test(drafts.c));

  const result = await generateFormalLectureScript({
    drafts,
    preferred: 'c',
    courseName: '菊花LED补光电路装置',
    modules
  });

  assert.ok(/## 开场导入（0-\d+分钟）/.test(result.script));
  assert.ok(result.script.includes('## 课堂练习与检查'));
  assert.ok(/## 总结收束（\d+-\d+分钟）/.test(result.script));
  assert.ok(!result.script.includes('> 合成策略：'));
  assert.ok(!/这一段先把|第\s*\d+\s*段必须|写作要求|风格提醒|目标聚焦|时间：|教师示范|板书关键词|课堂检查重点/.test(result.script));
  assert.ok(!badFormalPatterns.test(result.script));
  assert.strictEqual(result.meta.usedBaseDraft, 'c');
  assert.strictEqual(result.meta.validation.hasMetaInstructionLeak, false);
  assert.strictEqual(result.meta.validation.hasTeacherNarration, true);
  assert.strictEqual(result.meta.validation.hasClassroomActions, true);
  assert.strictEqual(result.meta.validation.hasBulletNarration, false);
  assert.strictEqual(result.meta.validation.missingSections.length, 0);
  assert.ok(
    result.script
      .split(/\r?\n/)
      .filter((line) => /大家好|同学们好|欢迎来到今天的课堂/.test(line))
      .length <= 1
  );
  assert.ok(result.meta.validation.teacherNarrationCharCount >= 2200);
  assert.ok(result.meta.validation.teacherNarrationCharCount <= 3000);

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    effectiveCharCount: result.meta.validation.effectiveCharCount,
    teacherNarrationCharCount: result.meta.validation.teacherNarrationCharCount
  }, null, 2));

  const fashionModules = [
    {
      moduleNumber: 1,
      name: '品牌调性与目标顾客分析',
      description: '围绕店铺陈列任务分析品牌风格、顾客定位与主题表达。',
      knowledgePoints: ['品牌调性', '目标顾客', '主题表达']
    },
    {
      moduleNumber: 2,
      name: '服装陈列要素识别',
      description: '识别货品、道具、色彩和层次之间的陈列关系。',
      knowledgePoints: ['货品组合', '道具运用', '视觉层次']
    },
    {
      moduleNumber: 3,
      name: '橱窗与店铺展示设计',
      description: '按主题完成橱窗和店铺展示方案的布局与调整。',
      knowledgePoints: ['展示布局', '陈列动线', '搭配关系']
    },
    {
      moduleNumber: 4,
      name: '陈列复盘与展示讲评',
      description: '围绕展示结果完成讲评、复盘和调整。',
      knowledgePoints: ['展示评估', '传播表达', '复盘优化']
    }
  ];

  const fashionProfile = detectCourseProfile({
    courseName: '服装产品传播',
    modules: fashionModules
  });
  assert.strictEqual(fashionProfile, 'gztextile_fashion_communication');

  const fashionDrafts = await generateLectureABCDrafts({
    courseName: '服装产品传播',
    modules: fashionModules,
    styleRubricText: ''
  });
  assert.strictEqual(fashionDrafts.courseProfile, 'gztextile_fashion_communication');
  assert.ok(/品牌|陈列|展示/.test(fashionDrafts.a));
  assert.ok(!/焊接|电压|通电/.test(fashionDrafts.b));

  const fashionResult = await generateFormalLectureScript({
    drafts: fashionDrafts,
    preferred: 'b',
    courseName: '服装产品传播',
    modules: fashionModules
  });

  assert.strictEqual(fashionResult.meta.courseProfile, 'gztextile_fashion_communication');
  assert.ok(/品牌|陈列|展示|橱窗/.test(fashionResult.script));
  assert.ok(!/焊接|电压|万用表|通电/.test(fashionResult.script));
  assert.ok(!badFormalPatterns.test(fashionResult.script));

  const merchandisingModules = [
    {
      moduleNumber: 1,
      name: '品牌橱窗主题分析',
      description: '围绕品牌主题分析橱窗主位、色彩和视觉重心。',
      knowledgePoints: ['主题表达', '视觉重心', '品牌调性']
    },
    {
      moduleNumber: 2,
      name: '陈列分区与货品组织',
      description: '识别主推区、辅助区与道具关系，完成货品组织。',
      knowledgePoints: ['陈列分区', '货品组合', '顾客动线']
    },
    {
      moduleNumber: 3,
      name: '店铺陈列摆场',
      description: '按任务主题完成卖场摆场与展示调整。',
      knowledgePoints: ['卖场布局', '搭配层次', '展示节奏']
    },
    {
      moduleNumber: 4,
      name: '展示讲评与复盘',
      description: '围绕展示结果完成讲评、复盘和优化。',
      knowledgePoints: ['展示评估', '讲评表达', '优化调整']
    }
  ];

  const merchandisingProfile = detectCourseProfile({
    courseName: '服装展示与陈列设计',
    modules: merchandisingModules
  });
  assert.strictEqual(merchandisingProfile, 'gztextile_merchandising');

  const merchandisingDrafts = await generateLectureABCDrafts({
    courseName: '服装展示与陈列设计',
    modules: merchandisingModules,
    styleRubricText: ''
  });
  assert.strictEqual(merchandisingDrafts.courseProfile, 'gztextile_merchandising');
  assert.ok(/陈列|展示|橱窗|动线/.test(merchandisingDrafts.b));

  const popModules = [
    { moduleNumber: 1, name: '寻·潮起', description: '认识POP海报在服装传播中的作用。', knowledgePoints: ['POP定义', '传播功能', '吸引注意'] },
    { moduleNumber: 2, name: '解·器用', description: '分析POP海报的主题、文案、图案和构图。', knowledgePoints: ['主题', '文案', '构图'] },
    { moduleNumber: 3, name: '立·标准', description: '建立POP海报的评价标准。', knowledgePoints: ['视觉冲击力', '信息传达力', '艺术感染力'] },
    { moduleNumber: 4, name: '创·拼图', description: '围绕品牌任务完成POP海报草图设计。', knowledgePoints: ['卖点提炼', '版式组织', '视觉表达'] },
    { moduleNumber: 5, name: '评·互鉴', description: '使用评价标准进行互评与修改。', knowledgePoints: ['互评标准', '修改建议', '表达优化'] },
    { moduleNumber: 6, name: '悟·回收', description: '回收知识点并完成课堂测验。', knowledgePoints: ['知识回顾', '概念迁移', '课堂测验'] }
  ];

  const popProfile = detectCourseProfile({
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules
  });
  assert.strictEqual(popProfile, 'gztextile_fashion_communication');

  const popDrafts = await generateLectureABCDrafts({
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules,
    styleRubricText: ''
  });
  assert.strictEqual(popDrafts.courseProfile, 'gztextile_fashion_communication');
  assert.ok(!/33-33分钟/.test(popDrafts.c));

  const popResult = await generateFormalLectureScript({
    drafts: popDrafts,
    preferred: 'b',
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules
  });
  assert.strictEqual(popResult.meta.courseProfile, 'gztextile_fashion_communication');
  assert.ok(!/33-33分钟/.test(popResult.script));
  assert.ok(/目标顾客|核心卖点|视觉表达|信息传达/.test(popResult.script));
  assert.ok(!/解决一个真实问题。而且每一步都要能解释为什么这样做。先把任务摆在前面：这节课/.test(popResult.script));
  assert.ok(/两条具体修改建议|画廊漫步|快问快答|抢答/.test(popResult.script));
  assert.ok(!badFormalPatterns.test(popResult.script));

  const popResultA = await generateFormalLectureScript({
    drafts: popDrafts,
    preferred: 'a',
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules
  });
  assert.strictEqual(popResultA.meta.usedBaseDraft, 'a');
  assert.ok(/知识主线|判断依据|逻辑|前后/.test(popResultA.script));
  assert.ok(!badFormalPatterns.test(popResultA.script));

  const popResultC = await generateFormalLectureScript({
    drafts: popDrafts,
    preferred: 'c',
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules
  });
  assert.strictEqual(popResultC.meta.usedBaseDraft, 'c');
  assert.ok(/巡视|互查|检查|任务/.test(popResultC.script));
  assert.ok(!badFormalPatterns.test(popResultC.script));

  const customStyleDrafts = await generateLectureABCDrafts({
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules.slice(0, 4),
    styleRubricText: '更强调课堂的互动环节\n多让学生先判断，再汇报理由'
  });
  const customStyleResult = await generateFormalLectureScript({
    drafts: customStyleDrafts,
    preferred: 'b',
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules.slice(0, 4),
    styleRubricText: '更强调课堂的互动环节\n多让学生先判断，再汇报理由'
  });
  assert.ok(!/更强调课堂的互动环节|多让学生先判断，再汇报理由/.test(customStyleResult.script));
  assert.ok(/先判断|把理由说出来|汇报判断依据/.test(customStyleResult.script));

  const homeworkStyle = '课后作业：选择一个你熟悉的服装品牌，设计一张双十二POP初稿，并注明目标顾客、主打卖点和构图方式。';
  const homeworkDrafts = await generateLectureABCDrafts({
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules.slice(0, 4),
    styleRubricText: homeworkStyle
  });
  const homeworkResult = await generateFormalLectureScript({
    drafts: homeworkDrafts,
    preferred: 'b',
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules.slice(0, 4),
    styleRubricText: homeworkStyle
  });
  assert.ok(/课后作业我给你们布置得具体一点/.test(homeworkResult.script));
  assert.ok(/目标顾客|主打卖点|构图方式/.test(homeworkResult.script));

  const conflictStyle = '课后作业：检查LED电路焊点并记录通电电压。';
  const conflictDrafts = await generateLectureABCDrafts({
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules.slice(0, 4),
    styleRubricText: conflictStyle
  });
  const conflictResult = await generateFormalLectureScript({
    drafts: conflictDrafts,
    preferred: 'b',
    courseName: '匠心于形、传播有声——服装POP海报创意设计',
    modules: popModules.slice(0, 4),
    styleRubricText: conflictStyle
  });
  assert.ok(!/LED电路|焊点|通电电压/.test(conflictResult.script));
  assert.ok((conflictResult.meta.frameworkDirectives?.blocked || []).length >= 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
