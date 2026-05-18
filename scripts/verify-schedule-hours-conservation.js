/**
 * verify-schedule-hours-conservation.js
 *
 * 验证：schedule 学时守恒（修复 2026-05-15 老师反馈"36 学时 → 18 行"语义混淆）
 *
 * 测试用例（6 项）：
 *   ① AI 输出每行带 hours 字段 → normalize 保留
 *   ② AI 输出 hours 合计 = totalHours → 不缩放
 *   ③ AI 输出 hours 合计 ≠ totalHours → 自动按比例缩放
 *   ④ 缩放后小数误差 → 最后一行兜底校正
 *   ⑤ AI 输出无 hours 字段 → 默认 4 学时/行
 *   ⑥ 36 学时课程：合理输出 9-18 行（每行 2-4 学时）
 */
const path = require('path');
const scheduleSvc = require(path.resolve(__dirname, '..', 'src/main/services/schedule.service.js'));
const { normalizeSchedule } = scheduleSvc._internal;

function runCases() {
  const cases = [];
  const pass = (n) => { cases.push({ n, ok: true }); console.log(`  ✓ ${n}`); };
  const fail = (n, msg) => { cases.push({ n, ok: false, msg }); console.log(`  ✗ ${n} — ${msg}`); };

  // ① hours 字段保留（header.totalHours = 合计 → 不触发缩放）
  {
    const r = normalizeSchedule({
      header: { totalHours: 6 },
      schedule: [
        { week: 1, session: 1, content: '安全', hours: 2, method: '讲授' },
        { week: 2, session: 2, content: '内容', hours: 4, method: '讲授' },
      ],
    }, {});
    if (r.schedule.length === 2 && r.schedule[0].hours === 2 && r.schedule[1].hours === 4) {
      pass('① hours 字段被 normalize 保留');
    } else fail('①', JSON.stringify(r.schedule));
  }

  // ② 合计正好 = totalHours → 不缩放
  {
    const r = normalizeSchedule({
      header: { totalHours: 6 },
      schedule: [
        { week: 1, content: 'A', hours: 2, method: '讲授' },
        { week: 2, content: 'B', hours: 4, method: '讲授' },
      ],
    }, {});
    const sum = r.schedule.reduce((s, x) => s + x.hours, 0);
    if (sum === 6) pass('② 学时合计 = 目标 → 不缩放');
    else fail('②', `sum=${sum}`);
  }

  // ③ AI 给的合计偏少 → 缩放
  {
    const r = normalizeSchedule({
      header: { totalHours: 72 },
      // AI 给 18 行 × 2 学时 = 36，但 target=72 → 应缩放到 72
      schedule: Array.from({ length: 18 }, (_, i) => ({
        week: Math.floor(i / 1) + 1, session: i + 1,
        content: `教学内容 ${i + 1}`, hours: 2, method: '讲授',
      })),
    }, { totalHours: 72 });
    const sum = r.schedule.reduce((s, x) => s + x.hours, 0);
    if (Math.abs(sum - 72) < 0.5) pass(`③ 合计 36 → 自动缩放到 72（实际 ${sum}）`);
    else fail('③', `sum=${sum}`);
  }

  // ④ 小数误差兜底
  {
    // 7 行 × 5 = 35，target=36，比例 36/35=1.0286，缩放后每行≈5.143→四舍 5
    // 最后一行兜底补差
    const r = normalizeSchedule({
      header: { totalHours: 36 },
      schedule: Array.from({ length: 7 }, (_, i) => ({
        week: i + 1, content: `内容 ${i + 1}`, hours: 5, method: '讲授',
      })),
    }, { totalHours: 36 });
    const sum = r.schedule.reduce((s, x) => s + x.hours, 0);
    if (Math.abs(sum - 36) < 0.01) pass(`④ 小数误差兜底（合计精准 36，实际 ${sum}）`);
    else fail('④', `sum=${sum}`);
  }

  // ⑤ AI 无 hours 字段 → 默认 4
  {
    const r = normalizeSchedule({
      header: { totalHours: 8 },
      schedule: [
        { week: 1, content: 'A', method: '讲授' },
        { week: 2, content: 'B', method: '讲授' },
      ],
    }, { totalHours: 8 });
    // 默认 4 → 合计 8 → 正好 → 不需要缩放
    if (r.schedule[0].hours === 4 && r.schedule[1].hours === 4) {
      pass('⑤ AI 无 hours 字段 → 默认 4 学时/行');
    } else fail('⑤', JSON.stringify(r.schedule));
  }

  // ⑥ 36 学时课程：合理行数
  {
    // 模拟 AI 输出 18 行 2 学时
    const r = normalizeSchedule({
      header: { totalHours: 36 },
      schedule: Array.from({ length: 18 }, (_, i) => ({
        week: Math.ceil((i + 1) / 1), session: i + 1,
        content: `课次 ${i + 1}`, hours: 2, method: '讲授',
      })),
    }, { totalHours: 36 });
    const sum = r.schedule.reduce((s, x) => s + x.hours, 0);
    if (r.schedule.length === 18 && sum === 36) {
      pass('⑥ 36 学时 → 18 行 × 2 学时 = 36（精准守恒）');
    } else fail('⑥', `rows=${r.schedule.length} sum=${sum}`);
  }

  const passed = cases.filter((c) => c.ok).length;
  console.log(`\n[verify-schedule-hours-conservation] ${passed}/${cases.length} 通过`);
  if (passed < cases.length) {
    console.log('失败：', cases.filter((c) => !c.ok).map((c) => c.n).join(' / '));
    process.exit(1);
  }
}

runCases();
