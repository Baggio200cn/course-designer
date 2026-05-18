/**
 * verify-schedule-service.js — Phase-9 C-1 教学进度表生成器自检
 *
 * 测试范围：
 *   - 模块加载 + selfCheck 通过
 *   - parseScheduleJson 各种边界
 *   - normalizeSchedule 学校简称默认 / 字段兜底 / 排序
 *   - prompts/schedule.md 加载
 *   - generate(...) 守卫条件（无 aiClient / 无 courseName）
 *
 * 集成测试（需 Electron 运行时）：
 *   - 真实 AI 调用 + 解析 + 写入 artifact
 *   - 这部分需 npm run dev 手动测，本脚本不覆盖
 *
 * 用法：node scripts/verify-schedule-service.js
 */

const path = require('path');
const SVC = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'schedule.service.js'));
const { parseScheduleJson, normalizeSchedule, loadPrompt } = SVC._internal;

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✅ ${name}`);
      pass++;
    })
    .catch((err) => {
      console.log(`  ❌ ${name} — ${err.message}`);
      failures.push({ name, error: err.message });
      fail++;
    });
}

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Phase-9 C-1 schedule.service 自检');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── 契约组 1：模块加载 ───────────────────────────────────────────────
  console.log('▸ 契约组 1：模块加载');

  await test('require schedule.service.js', () => {
    if (typeof SVC.generate !== 'function') throw new Error('generate 不是函数');
    if (typeof SVC.selfCheck !== 'function') throw new Error('selfCheck 不是函数');
  });

  await test('selfCheck 9/9 全过', () => {
    const r = SVC.selfCheck();
    if (r.passed !== r.total) {
      const fails = r.checks.filter((c) => !c.pass).map((c) => c.name);
      throw new Error(`仅 ${r.passed}/${r.total}，失败：${fails.join(', ')}`);
    }
  });

  // ── 契约组 2：parseScheduleJson ───────────────────────────────────────
  console.log('\n▸ 契约组 2：JSON 解析');

  await test('纯 JSON 字符串', () => {
    const r = parseScheduleJson('{"foo":"bar","schedule":[]}');
    if (r.foo !== 'bar') throw new Error('解析失败');
  });

  await test('被 ```json``` 包裹', () => {
    const r = parseScheduleJson('```json\n{"foo":"bar"}\n```');
    if (r.foo !== 'bar') throw new Error('未去包裹');
  });

  await test('被 ``` 包裹（无 lang）', () => {
    const r = parseScheduleJson('```\n{"foo":"bar"}\n```');
    if (r.foo !== 'bar') throw new Error('未去包裹');
  });

  await test('混合解释文字 + JSON', () => {
    const r = parseScheduleJson('好的，下面是 JSON：\n{"foo":"bar"}\n（解析完毕）');
    if (r.foo !== 'bar') throw new Error('未取到 JSON');
  });

  await test('空字符串抛错', () => {
    let threw = false;
    try { parseScheduleJson(''); } catch { threw = true; }
    if (!threw) throw new Error('空字符串应抛错');
  });

  await test('非 JSON 文本抛错', () => {
    let threw = false;
    try { parseScheduleJson('this is not json'); } catch { threw = true; }
    if (!threw) throw new Error('非 JSON 应抛错');
  });

  // ── 契约组 3：normalizeSchedule ───────────────────────────────────────
  console.log('\n▸ 契约组 3：数据规整 + 兜底');

  await test('学校字段空 → 默认"广州纺校"', () => {
    const r = normalizeSchedule({});
    if (r.header.school !== '广州纺校') throw new Error(`实际：${r.header.school}`);
  });

  await test('学校字段已填 → 用 AI 输出', () => {
    const r = normalizeSchedule({ header: { school: '广州市纺织服装职业学校' } });
    if (r.header.school !== '广州市纺织服装职业学校') throw new Error(`实际：${r.header.school}`);
  });

  await test('AI 没填 + ctx 提供 → 用 ctx', () => {
    const r = normalizeSchedule({ header: {} }, { school: '广州纺校（ctx）' });
    if (r.header.school !== '广州纺校（ctx）') throw new Error(`实际：${r.header.school}`);
  });

  await test('totalHours AI 输出优先', () => {
    const r = normalizeSchedule({ header: { totalHours: 100 } }, { totalHours: 50 });
    if (r.header.totalHours !== 100) throw new Error(`实际：${r.header.totalHours}`);
  });

  await test('totalHours AI 未输出 → 用 ctx', () => {
    const r = normalizeSchedule({ header: {} }, { totalHours: 80 });
    if (r.header.totalHours !== 80) throw new Error(`实际：${r.header.totalHours}`);
  });

  await test('totalHours 都未提供 → 默认 72', () => {
    const r = normalizeSchedule({}, {});
    if (r.header.totalHours !== 72) throw new Error(`实际：${r.header.totalHours}`);
  });

  await test('schedule 数组按 week 升序', () => {
    const r = normalizeSchedule({
      schedule: [
        { week: 5, content: 'E' },
        { week: 1, content: 'A' },
        { week: 3, content: 'C' },
      ],
    });
    if (r.schedule.length !== 3) throw new Error(`长度错：${r.schedule.length}`);
    if (r.schedule[0].week !== 1 || r.schedule[2].week !== 5) {
      throw new Error('未按 week 升序');
    }
  });

  // 2026-05-15 v4.1.2 策略变更：content 为空不过滤，填占位文字（让老师看到"哪一行漏了"）
  await test('schedule content 为空 → 保留行 + 填占位（v4.1.2）', () => {
    const r = normalizeSchedule({
      schedule: [
        { week: 1, content: 'A' },
        { week: 2, content: '' },
        { week: 3, content: 'C' },
      ],
    });
    if (r.schedule.length !== 3) throw new Error(`长度应为 3（保留所有行），实际：${r.schedule.length}`);
    if (!r.schedule[1].content.includes('缺失')) throw new Error(`空 content 行应填"缺失"占位，实际："${r.schedule[1].content}"`);
  });

  await test('schedule 缺 method → 默认"讲授"', () => {
    const r = normalizeSchedule({ schedule: [{ week: 1, content: 'A' }] });
    if (r.schedule[0].method !== '讲授') throw new Error(`实际：${r.schedule[0].method}`);
  });

  await test('keyPoints/difficulties/methods 限制条数', () => {
    const r = normalizeSchedule({
      keyPoints: Array(20).fill('点'),
      difficulties: Array(20).fill('难'),
      methods: Array(20).fill('法'),
    });
    if (r.keyPoints.length > 6) throw new Error(`keyPoints 超 6：${r.keyPoints.length}`);
    if (r.difficulties.length > 6) throw new Error(`difficulties 超 6：${r.difficulties.length}`);
    if (r.methods.length > 8) throw new Error(`methods 超 8：${r.methods.length}`);
  });

  await test('evaluation 缺失 → 默认值', () => {
    const r = normalizeSchedule({});
    if (!Array.isArray(r.evaluation.components)) throw new Error('components 应为数组');
    if (r.evaluation.components.length === 0) throw new Error('components 应有默认项');
  });

  await test('_stats 字段含 scheduleRowCount + generatedAt', () => {
    const r = normalizeSchedule({
      schedule: [{ week: 1, content: 'A' }, { week: 2, content: 'B' }],
    });
    if (typeof r._stats?.scheduleRowCount !== 'number') throw new Error('缺 scheduleRowCount');
    if (r._stats.scheduleRowCount !== 2) throw new Error(`数量错：${r._stats.scheduleRowCount}`);
    if (!r._stats.generatedAt) throw new Error('缺 generatedAt');
  });

  // ── 契约组 4：prompt 加载 ────────────────────────────────────────────
  console.log('\n▸ 契约组 4：prompts/schedule.md');

  await test('prompts/schedule.md 可加载', () => {
    const p = loadPrompt('schedule');
    if (typeof p !== 'string' || p.length < 500) {
      throw new Error(`prompt 太短：${p?.length}`);
    }
  });

  await test('prompts/schedule.md 含关键约束词', () => {
    const p = loadPrompt('schedule');
    const requiredKeywords = [
      '广州纺校',     // 学校简称约定
      'JSON',         // 输出格式
      'schedule',     // 字段名
      'week',         // 字段名
      'session',      // 字段名
      'method',       // 字段名
      '总学时',       // 业务约束
    ];
    const missing = requiredKeywords.filter((kw) => !p.includes(kw));
    if (missing.length) throw new Error(`prompt 缺关键词：${missing.join(', ')}`);
  });

  // ── 契约组 5：generate 守卫 ────────────────────────────────────────
  console.log('\n▸ 契约组 5：generate 守卫');

  await test('aiClient 缺失 → 返回 success:false', async () => {
    const r = await SVC.generate({});
    if (r.success !== false) throw new Error('应返回 success:false');
    if (!r.error || !r.error.includes('AI 客户端')) throw new Error(`error 错：${r.error}`);
  });

  await test('courseName 缺失 → 返回 success:false', async () => {
    const r = await SVC.generate({
      aiClient: { chatJson: async () => '{}' },
      courseName: '',
    });
    if (r.success !== false) throw new Error('应返回 success:false');
    if (!r.error || !r.error.includes('课程名')) throw new Error(`error 错：${r.error}`);
  });

  await test('AI 返回非 JSON → 返回 success:false 含 raw', async () => {
    const r = await SVC.generate({
      aiClient: { chatJson: async () => 'not a valid json at all' },
      courseName: '测试',
      // 2026-05-15 v4.1.4：现在必传 hoursPerSession，否则 generate 早期就返回错误
      courseContext: { totalHours: 72, hoursPerSession: 2 },
    });
    if (r.success !== false) throw new Error('应返回 success:false');
    if (!r.raw) throw new Error('应包含 raw 用于调试');
  });

  await test('AI 调用抛错 → 返回 success:false', async () => {
    const r = await SVC.generate({
      aiClient: { chatJson: async () => { throw new Error('mock 网络错'); } },
      courseName: '测试',
      courseContext: { totalHours: 72, hoursPerSession: 2 },
    });
    if (r.success !== false) throw new Error('应返回 success:false');
    if (!r.error.includes('AI 调用失败')) throw new Error(`error 错：${r.error}`);
  });

  await test('AI 返回合法 JSON → 返回 success:true + 完整 schedule', async () => {
    const mockJson = JSON.stringify({
      header: { courseName: '测试课', totalHours: 36 },
      objective: '培养学生测试能力',
      keyPoints: ['重点 1', '重点 2'],
      difficulties: ['难点 1'],
      methods: ['讲授法'],
      experimentTopics: [],
      evaluation: { approach: '过程性评价', components: ['考勤'], weights: {} },
      schedule: [
        { week: 1, session: 1, chapter: '', content: '安全教育', method: '讲授', homework: 0 },
      ],
      additionalNotes: '',
    });
    const r = await SVC.generate({
      aiClient: { chatJson: async () => mockJson },
      courseName: '测试课',
      courseContext: { totalHours: 36, hoursPerSession: 4 },  // v4.1.4 必填
    });
    if (r.success !== true) throw new Error(`应返回 success:true：${r.error}`);
    if (!r.data?.schedule) throw new Error('缺 schedule');
    if (r.data.schedule.header.courseName !== '测试课') throw new Error('课程名错');
    if (r.data.schedule.schedule.length !== 1) throw new Error('排课条数错');
    if (r.data.schedule.header.school !== '广州纺校') {
      throw new Error(`学校默认错：${r.data.schedule.header.school}`);
    }
  });

  // ── 总结 ──────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`总计：${pass + fail}    通过：${pass}    失败：${fail}`);

  if (fail === 0) {
    console.log('✅ 全部通过');
    console.log('\n⚠️  H9 提醒：契约组通过 ≠ 端到端就绪。');
    console.log('   AI 实际调用 + IPC handler + 数据库写入需 npm run dev 手动测试。');
    console.log('   集成测试关键场景：');
    console.log('     1. 创建笔记本 → 填课程基础信息 → 点"生成进度表"按钮');
    console.log('     2. 检查 AI 返回的 JSON 是否正确解析');
    console.log('     3. 检查 artifact 是否正确写入 type=schedule_table stage=schedule');
    console.log('     4. 点"确认"后 design 阶段是否解锁');
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
