/**
 * verify-design-service.js — Phase-9 C-2 教学设计生成器自检
 */

const path = require('path');
const SVC = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'design.service.js'));
const { parseDesignJson, normalizeDesign, loadPrompt } = SVC._internal;
const { REQUIRED_PHASES } = SVC;

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✅ ${name}`); pass++; })
    .catch((err) => { console.log(`  ❌ ${name} — ${err.message}`); failures.push({ name, error: err.message }); fail++; });
}

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Phase-9 C-2 design.service 自检');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── 契约组 1：模块加载 ─────────────────────────────────────────
  console.log('▸ 契约组 1：模块加载');
  await test('模块导出完整', () => {
    if (typeof SVC.generate !== 'function') throw new Error('generate 不是函数');
    if (typeof SVC.selfCheck !== 'function') throw new Error('selfCheck 不是函数');
    if (!Array.isArray(SVC.REQUIRED_PHASES) || SVC.REQUIRED_PHASES.length !== 5) {
      throw new Error(`REQUIRED_PHASES 应为 5 段数组`);
    }
  });

  await test('selfCheck 11/11 全过', () => {
    const r = SVC.selfCheck();
    if (r.passed !== r.total) {
      const fails = r.checks.filter((c) => !c.pass).map((c) => c.name);
      throw new Error(`仅 ${r.passed}/${r.total}：${fails.join(', ')}`);
    }
  });

  // ── 契约组 2：JSON 解析 ─────────────────────────────────────────
  console.log('\n▸ 契约组 2：JSON 解析');

  await test('纯 JSON', () => {
    const r = parseDesignJson('{"keyPoints":["A"]}');
    if (!Array.isArray(r.keyPoints)) throw new Error('解析失败');
  });

  await test('markdown ```json``` 包裹', () => {
    const r = parseDesignJson('```json\n{"keyPoints":["A"]}\n```');
    if (!Array.isArray(r.keyPoints)) throw new Error('未去包裹');
  });

  await test('混合解释文字', () => {
    const r = parseDesignJson('解释：以下是设计 JSON\n{"foo":"bar"}\n（解释完）');
    if (r.foo !== 'bar') throw new Error('未取到');
  });

  await test('空字符串抛错', () => {
    let threw = false;
    try { parseDesignJson(''); } catch { threw = true; }
    if (!threw) throw new Error('空字符串应抛错');
  });

  // ── 契约组 3：数据规整 ─────────────────────────────────────────
  console.log('\n▸ 契约组 3：数据规整');

  await test('inClass.phases 严格 5 段', () => {
    const r = normalizeDesign({ inClass: { phases: [{ phase: '导入新课' }] } });
    if (r.inClass.phases.length !== 5) {
      throw new Error(`应 5 段，实际 ${r.inClass.phases.length}`);
    }
  });

  await test('inClass.phases 顺序固定（即使 AI 乱序）', () => {
    const r = normalizeDesign({
      inClass: {
        phases: [
          { phase: '总结升华' },
          { phase: '导入新课' },
          { phase: '实操练习' },
        ],
      },
    });
    const names = r.inClass.phases.map((p) => p.phase);
    if (JSON.stringify(names) !== JSON.stringify(REQUIRED_PHASES)) {
      throw new Error(`顺序错：${JSON.stringify(names)}`);
    }
  });

  await test('完全无 phases → 5 段空内容兜底', () => {
    const r = normalizeDesign({});
    if (r.inClass.phases.length !== 5) throw new Error('空时应返回 5 段空内容');
    if (r.inClass.phases[0].phase !== '导入新课') throw new Error('第一段应是导入新课');
  });

  // ── 契约组 4：考核权重归一化 ────────────────────────────────────
  console.log('\n▸ 契约组 4：考核权重');

  await test('权重总和 = 100 时不动', () => {
    const r = normalizeDesign({
      assessment: {
        components: [
          { name: 'A', weight: 30 },
          { name: 'B', weight: 40 },
          { name: 'C', weight: 30 },
        ],
      },
    });
    const sum = r.assessment.components.reduce((s, c) => s + c.weight, 0);
    if (sum !== 100) throw new Error(`总和应 = 100，实际 ${sum}`);
    if (r.assessment.components[0].weight !== 30) throw new Error('原权重应保留');
  });

  await test('权重总和 > 100 → 按比例归一化', () => {
    const r = normalizeDesign({
      assessment: {
        components: [
          { name: 'A', weight: 60 },
          { name: 'B', weight: 60 },  // 总 120
        ],
      },
    });
    const sum = r.assessment.components.reduce((s, c) => s + c.weight, 0);
    if (sum !== 100) throw new Error(`归一化后应 = 100，实际 ${sum}`);
  });

  await test('权重总和 < 100 → 按比例归一化', () => {
    const r = normalizeDesign({
      assessment: {
        components: [
          { name: 'A', weight: 30 },
          { name: 'B', weight: 30 },  // 总 60
        ],
      },
    });
    const sum = r.assessment.components.reduce((s, c) => s + c.weight, 0);
    if (sum !== 100) throw new Error(`归一化后应 = 100，实际 ${sum}`);
  });

  await test('components 缺失 → 默认 3 项总和 100', () => {
    const r = normalizeDesign({});
    if (r.assessment.components.length < 3) throw new Error('应有默认 3 项');
    const sum = r.assessment.components.reduce((s, c) => s + c.weight, 0);
    if (sum !== 100) throw new Error(`默认值总和 ${sum} ≠ 100`);
  });

  await test('weight=0 项被过滤', () => {
    const r = normalizeDesign({
      assessment: {
        components: [
          { name: 'A', weight: 50 },
          { name: 'B', weight: 0 },     // 被过滤
          { name: 'C', weight: 50 },
        ],
      },
    });
    if (r.assessment.components.length !== 2) {
      throw new Error(`应过滤 weight=0，剩 2 项，实际 ${r.assessment.components.length}`);
    }
  });

  // ── 契约组 5：教学方法兼容 ─────────────────────────────────────
  console.log('\n▸ 契约组 5：教学方法兼容');

  await test('字符串数组也能解析', () => {
    const r = normalizeDesign({ teachingMethods: ['案例法', '任务驱动'] });
    if (r.teachingMethods.length !== 2) throw new Error('字符串数组应被接受');
    if (r.teachingMethods[0].name !== '案例法') throw new Error('字符串应被转 name');
  });

  await test('对象数组保留 desc/applicable', () => {
    const r = normalizeDesign({
      teachingMethods: [
        { name: '案例法', desc: '通过真实案例', applicable: '理论部分' },
      ],
    });
    if (r.teachingMethods[0].desc !== '通过真实案例') throw new Error('desc 丢失');
    if (r.teachingMethods[0].applicable !== '理论部分') throw new Error('applicable 丢失');
  });

  await test('空数组 → 默认讲授法', () => {
    const r = normalizeDesign({ teachingMethods: [] });
    if (r.teachingMethods.length !== 1) throw new Error('应有 1 项默认');
    if (r.teachingMethods[0].name !== '讲授法') throw new Error('默认应是讲授法');
  });

  // ── 契约组 6：generate 守卫 ───────────────────────────────────
  console.log('\n▸ 契约组 6：generate 守卫');

  await test('aiClient 缺失 → success:false', async () => {
    const r = await SVC.generate({});
    if (r.success !== false) throw new Error('应 success:false');
  });

  await test('courseName 缺失 → success:false', async () => {
    const r = await SVC.generate({ aiClient: { chatJson: async () => '{}' }, courseName: '' });
    if (r.success !== false) throw new Error('应 success:false');
  });

  await test('AI 抛错 → success:false', async () => {
    const r = await SVC.generate({
      aiClient: { chatJson: async () => { throw new Error('mock 网络错'); } },
      courseName: '测试课',
    });
    if (r.success !== false) throw new Error('应 success:false');
  });

  await test('合法 JSON → success:true 含完整 design', async () => {
    const mockJson = JSON.stringify({
      teachingObjectives: { knowledge: ['K1'], skill: ['S1'], emotion: ['E1'] },
      keyPoints: ['重点 1'],
      difficulties: ['难点 1'],
      teachingMethods: [{ name: '案例法', desc: '...', applicable: '理论' }],
      teachingResources: { textbook: '《时尚传播学》', supplementary: [], platform: '学习通', softwareTools: [], venues: [] },
      preClass: { tasks: ['上传课件'], expectedOutcome: '完成预习' },
      inClass: {
        phases: [
          { phase: '导入新课', duration: '10' },
          { phase: '知识讲授', duration: '20' },
          { phase: '实操练习', duration: '30' },
          { phase: '互查反馈', duration: '15' },
          { phase: '总结升华', duration: '5' },
        ],
      },
      postClass: { homework: ['作业 1'], feedback: '及时反馈', platforms: [] },
      informatization: { platform: '学习通', tools: [], purpose: '...', industryPlatforms: [] },
      assessment: {
        approach: '过程考核为主',
        components: [
          { name: '日常表现', weight: 30, criteria: '考勤+参与' },
          { name: '项目作品', weight: 40, criteria: '作品质量' },
          { name: '考试评价', weight: 30, criteria: '期末考' },
        ],
      },
      ideologicalElements: ['工匠精神', '团队合作'],
    });
    const r = await SVC.generate({
      aiClient: { chatJson: async () => mockJson },
      courseName: '测试课',
    });
    if (r.success !== true) throw new Error(`应 success:true：${r.error}`);
    if (!r.data?.design) throw new Error('缺 design');
    if (r.data.design.inClass.phases.length !== 5) throw new Error('phases 应 5 段');
    const sum = r.data.design.assessment.components.reduce((s, c) => s + c.weight, 0);
    if (sum !== 100) throw new Error(`weight 总和 ${sum} ≠ 100`);
  });

  // ── 总结 ─────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`总计：${pass + fail}    通过：${pass}    失败：${fail}`);

  if (fail === 0) {
    console.log('✅ 全部通过');
    console.log('\n⚠️  H9 提醒：契约组通过 ≠ 端到端就绪');
    console.log('   集成测试需 npm run dev：');
    console.log('     1. 创建笔记本 → 完成 schedule 阶段并确认');
    console.log('     2. 进入 design 阶段，点"生成教学设计"');
    console.log('     3. 检查 inClass.phases 是否 5 段 + weight 总和是否 = 100');
    console.log('     4. 点确认 → lecture 阶段是否解锁');
    process.exit(0);
  } else {
    console.log('❌ 有失败项：');
    failures.forEach((f) => console.log(`   - ${f.name}：${f.error}`));
    process.exit(1);
  }
})().catch((err) => {
  console.error('💥 自检过程异常：', err);
  process.exit(2);
});
