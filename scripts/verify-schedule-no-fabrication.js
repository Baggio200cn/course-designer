/**
 * verify-schedule-no-fabrication.js
 *
 * 验证：schedule.service.js 反编造断言生效（修复 2026-05-15 老师反馈 4.3）
 *
 * 现象：老师在 notebook 创建表单填了"刘勤老师 / 23 流行资讯班"，但 AI 生成的进度表
 *       却显示"张静 / 23 服装陈列 1 班"——老师输入被 AI 编造值覆盖。
 *
 * 修复思路：
 *   1. prompts/schedule.md 加反编造铁律
 *   2. schedule.service.js normalizeSchedule 中加 assertion guard：
 *      "输入非空 → 强制使用输入；AI 输出仅在输入为空时使用"
 *
 * 测试用例（6 项）：
 *   ① 老师输入 teacher → AI 编造另一个名字 → 必须以老师输入为准
 *   ② 老师输入 className → AI 编造另一个班级 → 必须以老师输入为准
 *   ③ 老师输入为空 → AI 输出非空 → 用 AI 输出兜底
 *   ④ 老师输入为空 + AI 也为空 → 留空字符串
 *   ⑤ semester 字段同样规则
 *   ⑥ textbook 字段同样规则
 */
const path = require('path');

// 直接 require 私有 normalizeSchedule（service 暴露了 selfCheck，没暴露 normalize）
// 通过 generate 间接测试 + 检查返回的 data.schedule.header
const scheduleSvc = require(path.resolve(__dirname, '..', 'src/main/services/schedule.service.js'));

function makeMockClientReturnHeader(fabricated) {
  // mock AI 返回一个完整的 schedule，但 header 含编造的 teacher/className
  return {
    async chatJson() {
      return JSON.stringify({
        header: {
          courseName: '时尚传播',
          teacher: fabricated.teacher,
          school: '广州纺校',
          department: '服装科',
          semester: fabricated.semester,
          className: fabricated.className,
          textbook: fabricated.textbook,
          totalHours: 72,
          theoryHours: 32,
          practiceHours: 36,
          examHours: 4,
        },
        objective: '培养时尚传播能力',
        keyPoints: ['传播主体'],
        difficulties: [],
        methods: ['讲授'],
        experimentTopics: [],
        evaluation: { approach: '', components: ['考勤'], weights: {} },
        schedule: [{ week: 1, session: 1, chapter: '', content: '开学安全教育', method: '讲授', homework: 0 }],
      });
    },
  };
}

async function runCases() {
  const cases = [];
  const pass = (n) => { cases.push({ n, ok: true }); console.log(`  ✓ ${n}`); };
  const fail = (n, msg) => { cases.push({ n, ok: false, msg }); console.log(`  ✗ ${n} — ${msg}`); };

  // ── 用例 ①：老师输入 teacher，AI 编造别名 → 必须用老师输入 ───────────────
  {
    const aiClient = makeMockClientReturnHeader({ teacher: '张静', className: '', semester: '', textbook: '' });
    const r = await scheduleSvc.generate({
      aiClient,
      courseName: '时尚传播',
      courseContext: { teacher: '刘勤', className: '', semester: '', textbook: '', totalHours: 72, hoursPerSession: 4 },
    });
    if (!r.success) {
      fail('① teacher 反编造', '生成失败：' + r.error);
    } else if (r.data.schedule.header.teacher === '刘勤') {
      // P2-6 新增：检查 _fabricationAudit 含 teacher 修正记录
      const audit = r.data.schedule._fabricationAudit;
      if (audit?.corrections?.some((c) => c.field === 'teacher' && c.aiValue === '张静' && c.correctedTo === '刘勤')) {
        pass('① 老师输入"刘勤" + AI 编"张静" → 输出"刘勤" + audit 留痕');
      } else {
        fail('① teacher audit', `结果对，但 audit 缺失：${JSON.stringify(audit)}`);
      }
    } else {
      fail('① teacher 反编造', `期望"刘勤"，实际"${r.data.schedule.header.teacher}"`);
    }
  }

  // ── 用例 ②：className 同 ─────────────────────────────────────────────
  {
    const aiClient = makeMockClientReturnHeader({ teacher: '', className: '23 服装陈列 1 班', semester: '', textbook: '' });
    const r = await scheduleSvc.generate({
      aiClient,
      courseName: '时尚传播',
      courseContext: { teacher: '', className: '23 流行资讯', semester: '', textbook: '', totalHours: 72, hoursPerSession: 4 },
    });
    if (r.data.schedule.header.className === '23 流行资讯') {
      pass('② 老师输入"23 流行资讯" + AI 编"23 服装陈列 1 班" → 输出"23 流行资讯"');
    } else {
      fail('② className 反编造', `期望"23 流行资讯"，实际"${r.data.schedule.header.className}"`);
    }
  }

  // ── 用例 ③：老师未填 teacher，AI 给了 → 用 AI 兜底 ────────────────────
  {
    const aiClient = makeMockClientReturnHeader({ teacher: 'AI补充值', className: '', semester: '', textbook: '' });
    const r = await scheduleSvc.generate({
      aiClient,
      courseName: '时尚传播',
      courseContext: { teacher: '', className: '', semester: '', textbook: '', totalHours: 72, hoursPerSession: 4 },
    });
    if (r.data.schedule.header.teacher === 'AI补充值') {
      pass('③ 老师未填 + AI 给值 → 用 AI 输出兜底');
    } else {
      fail('③ AI 兜底', `期望"AI补充值"，实际"${r.data.schedule.header.teacher}"`);
    }
  }

  // ── 用例 ④：老师未填 + AI 也未给 → 留空 ────────────────────────────────
  {
    const aiClient = makeMockClientReturnHeader({ teacher: '', className: '', semester: '', textbook: '' });
    const r = await scheduleSvc.generate({
      aiClient,
      courseName: '时尚传播',
      courseContext: { teacher: '', className: '', semester: '', textbook: '', totalHours: 72, hoursPerSession: 4 },
    });
    if (r.data.schedule.header.teacher === '') {
      pass('④ 双方都为空 → 留空字符串');
    } else {
      fail('④ 双方空', `期望空串，实际"${r.data.schedule.header.teacher}"`);
    }
  }

  // ── 用例 ⑤：semester 字段同规则 ───────────────────────────────────────
  {
    const aiClient = makeMockClientReturnHeader({ teacher: '', className: '', semester: '2030 学年虚构', textbook: '' });
    const r = await scheduleSvc.generate({
      aiClient,
      courseName: '时尚传播',
      courseContext: { teacher: '', className: '', semester: '2024-2025 第二学期', textbook: '', totalHours: 72, hoursPerSession: 4 },
    });
    if (r.data.schedule.header.semester === '2024-2025 第二学期') {
      pass('⑤ semester 反编造（老师输入优先）');
    } else {
      fail('⑤ semester', `期望"2024-2025 第二学期"，实际"${r.data.schedule.header.semester}"`);
    }
  }

  // ── 用例 ⑥：textbook 字段同规则 ───────────────────────────────────────
  {
    const aiClient = makeMockClientReturnHeader({ teacher: '', className: '', semester: '', textbook: 'AI编造教材' });
    const r = await scheduleSvc.generate({
      aiClient,
      courseName: '时尚传播',
      courseContext: { teacher: '', className: '', semester: '', textbook: '《服装产品传播》', totalHours: 72, hoursPerSession: 4 },
    });
    if (r.data.schedule.header.textbook === '《服装产品传播》') {
      pass('⑥ textbook 反编造');
    } else {
      fail('⑥ textbook', `期望"《服装产品传播》"，实际"${r.data.schedule.header.textbook}"`);
    }
  }

  // 汇总
  const passed = cases.filter((c) => c.ok).length;
  const total = cases.length;
  console.log(`\n[verify-schedule-no-fabrication] ${passed}/${total} 通过`);
  if (passed < total) {
    console.log('失败用例：', cases.filter((c) => !c.ok).map((c) => c.n).join(' / '));
    process.exit(1);
  }
}

runCases().catch((e) => {
  console.error('[verify] 异常：', e);
  process.exit(1);
});
