/**
 * verify-schedule-hours-per-session.js
 *
 * 验证：每次课学时数（hoursPerSession）— 解决老师反馈的"36 学时课只生成 18 行（应是 18 行 × 2学时 OR 9 行 × 4学时 看老师指定）"问题
 *
 * 测试用例（11 项）：
 *   ① ctx.hoursPerSession 传入 → header.hoursPerSession 写入
 *   ② 没传 hoursPerSession + 老数据有 schedule → 自动回塑 = totalHours / rows
 *   ③ 没传 + 没老数据 → header.hoursPerSession 为 0/falsy
 *   ④ generate 缺 hoursPerSession → 返回 success:false
 *   ⑤ generate 总学时 < 每次课学时 → 返回 error
 *   ⑥ generate 注入 prompt 含 "应生成行数：N"
 *   ⑦ generate 注入 prompt 含 "每行 hours 必须严格等于 X"
 *   ⑧ alias resolver: hoursPerClass → hoursPerSession
 *   ⑨ alias resolver: lessonHours → hoursPerSession
 *   ⑩ 36 学时 + 2 学时/次 → 生成 18 行 × 2（合计 36）
 *   ⑪ 72 学时 + 2 学时/次 → 生成 36 行 × 2（合计 72）
 */
const path = require('path');
const scheduleSvc = require(path.resolve(__dirname, '..', 'src/main/services/schedule.service.js'));
const { normalizeSchedule } = scheduleSvc._internal;
const { importWithAliases } = require(path.resolve(__dirname, '..', 'src/main/services/schedule-alias-resolver.js'));

async function runCases() {
  const cases = [];
  const pass = (n) => { cases.push({ n, ok: true }); console.log(`  ✓ ${n}`); };
  const fail = (n, msg) => { cases.push({ n, ok: false, msg }); console.log(`  ✗ ${n} — ${msg}`); };

  // ① 传入 hoursPerSession
  {
    const r = normalizeSchedule({
      header: { totalHours: 36 },
      schedule: [{ week: 1, content: 'A', hours: 2 }],
    }, { totalHours: 36, hoursPerSession: 2 });
    if (r.header.hoursPerSession === 2) pass('① ctx.hoursPerSession=2 → header.hoursPerSession=2');
    else fail('①', JSON.stringify(r.header));
  }

  // ② 老数据回塑
  {
    const r = normalizeSchedule({
      header: { totalHours: 36 },  // 老数据无 hoursPerSession
      schedule: Array.from({ length: 18 }, (_, i) => ({ week: i+1, content: `课${i+1}`, hours: 2 })),
    }, { totalHours: 36 });  // ctx 也没传
    // 应该自动回塑：36 / 18 = 2
    if (r.header.hoursPerSession === 2) pass('② 老数据回塑：36/18 = 2 学时/次');
    else fail('②', `期望 2，实际 ${r.header.hoursPerSession}`);
  }

  // ③ 都没数据
  {
    const r = normalizeSchedule({ header: {}, schedule: [] }, {});
    // 无法回塑（schedule 空）→ hoursPerSession 应为 0/falsy
    if (!r.header.hoursPerSession || r.header.hoursPerSession === 0) {
      pass('③ 双方都没数据 → hoursPerSession=0');
    } else fail('③', `期望 0/falsy，实际 ${r.header.hoursPerSession}`);
  }

  // ④ generate 缺 hoursPerSession 拒绝
  {
    const mockAi = { async chatJson() { return '{}'; } };
    const r = await scheduleSvc.generate({
      aiClient: mockAi,
      courseName: '测试',
      courseContext: { totalHours: 72 },   // 没传 hoursPerSession
    });
    if (!r.success && /每次课学时/.test(r.error)) pass('④ 缺 hoursPerSession → success:false + 错误提示');
    else fail('④', JSON.stringify(r));
  }

  // ⑤ generate 总学时 < 每次课学时
  {
    const mockAi = { async chatJson() { return '{}'; } };
    const r = await scheduleSvc.generate({
      aiClient: mockAi,
      courseName: '测试',
      courseContext: { totalHours: 2, hoursPerSession: 4 },   // 总学时 < 每次课
    });
    if (!r.success && /必须大于/.test(r.error)) pass('⑤ totalHours < hoursPerSession → error');
    else fail('⑤', JSON.stringify(r));
  }

  // ⑥ + ⑦ generate 注入 prompt
  {
    const captured = [];
    const mockAi = {
      async chatJson({ userPrompt }) {
        captured.push(userPrompt);
        return JSON.stringify({
          header: { courseName: '测试', totalHours: 72 },
          schedule: Array.from({ length: 36 }, (_, i) => ({ week: Math.ceil((i+1)/2), session: i+1, content: `课${i+1}`, hours: 2, method: '讲授' })),
        });
      },
    };
    const r = await scheduleSvc.generate({
      aiClient: mockAi,
      courseName: '测试',
      courseContext: { totalHours: 72, hoursPerSession: 2 },
    });
    if (!r.success) {
      fail('⑥/⑦', r.error);
    } else if (!captured.length) {
      fail('⑥/⑦', 'AI 没被调用');
    } else {
      const up = captured[0];
      if (up.includes('应生成行数：36')) pass('⑥ prompt 含"应生成行数：36"');
      else fail('⑥', up.slice(0, 300));
      if (up.includes('每行 hours **必须严格等于 2**')) pass('⑦ prompt 含每行 hours 铁律');
      else fail('⑦', up.slice(0, 300));
    }
  }

  // ⑧ alias hoursPerClass
  {
    const r = importWithAliases({ header: { hoursPerClass: 2 } });
    if (r.data.header.hoursPerSession === 2) pass('⑧ alias: hoursPerClass → hoursPerSession');
    else fail('⑧', JSON.stringify(r.data));
  }

  // ⑨ alias lessonHours
  {
    const r = importWithAliases({ header: { lessonHours: 4 } });
    if (r.data.header.hoursPerSession === 4) pass('⑨ alias: lessonHours → hoursPerSession');
    else fail('⑨', JSON.stringify(r.data));
  }

  // ⑩ 36 学时 + 2 学时/次 → 18 行
  {
    const mockAi = {
      async chatJson() {
        return JSON.stringify({
          header: { courseName: 'X', totalHours: 36 },
          schedule: Array.from({ length: 18 }, (_, i) => ({ week: i+1, content: `c${i+1}`, hours: 2, method: '讲授' })),
        });
      },
    };
    const r = await scheduleSvc.generate({
      aiClient: mockAi, courseName: 'X',
      courseContext: { totalHours: 36, hoursPerSession: 2 },
    });
    if (r.success && r.data.schedule.schedule.length === 18 && r.data.schedule.schedule.every((row) => row.hours === 2)) {
      pass('⑩ 36 学时 + 2 学时/次 → 18 行 × 2');
    } else fail('⑩', `len=${r.data?.schedule?.schedule?.length}`);
  }

  // ⑪ 72 学时 + 2 学时/次 → 36 行
  {
    const mockAi = {
      async chatJson() {
        return JSON.stringify({
          header: { courseName: 'Y', totalHours: 72 },
          schedule: Array.from({ length: 36 }, (_, i) => ({ week: Math.ceil((i+1)/2), session: i+1, content: `c${i+1}`, hours: 2, method: '讲授' })),
        });
      },
    };
    const r = await scheduleSvc.generate({
      aiClient: mockAi, courseName: 'Y',
      courseContext: { totalHours: 72, hoursPerSession: 2 },
    });
    if (r.success && r.data.schedule.schedule.length === 36 && r.data.schedule.schedule.every((row) => row.hours === 2)) {
      pass('⑪ 72 学时 + 2 学时/次 → 36 行 × 2（解决老师反馈）');
    } else fail('⑪', `len=${r.data?.schedule?.schedule?.length}`);
  }

  const passed = cases.filter((c) => c.ok).length;
  console.log(`\n[verify-schedule-hours-per-session] ${passed}/${cases.length} 通过`);
  if (passed < cases.length) {
    console.log('失败：', cases.filter((c) => !c.ok).map((c) => c.n).join(' / '));
    process.exit(1);
  }
}

runCases().catch((e) => {
  console.error('[verify] 异常：', e);
  process.exit(1);
});
