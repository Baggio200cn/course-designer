/**
 * verify-reference-filter.js
 *
 * 验证：参考资料相关性预过滤服务（2026-05-15 加固问题一 B 层）
 *
 * 现象重现：老师提供 4 个 URL 中混入 1 个 Adobe 课程目录 + 1 个 Unsplash CC0 协议，
 *         AI 强制引用 → 讲稿偏题
 * 修法验证：剔除评分 < 5 的素材
 *
 * 测试用例（8 项）：
 *   ① 单条素材跳过过滤
 *   ② 无 AI 客户端时全保留 + 警告
 *   ③ AI 返回非法 JSON 时全保留 + 警告
 *   ④ 混合相关 + 离题素材 → 离题被剔除
 *   ⑤ 全部素材都被打低分 → 保留最高分那条作为兜底（防全空）
 *   ⑥ 全部高分 → 全保留
 *   ⑦ AI 漏评某条素材 → 兜底保留
 *   ⑧ 阈值可调（threshold=7 时只保留高分）
 */
const path = require('path');
const { filterByRelevance } = require(path.resolve(__dirname, '..', 'src/main/services/reference-filter.service.js'));

function makeMock(scores) {
  // scores: { 1: 8, 2: 2, ... }
  return {
    async chatJson() {
      const filters = Object.entries(scores).map(([idx, rel]) => ({
        idx: Number(idx),
        relevance: rel,
        reason: rel >= 7 ? '相关' : rel >= 5 ? '边界' : '不相关',
      }));
      return JSON.stringify({ courseName: '测试', filters });
    },
  };
}

function makeFailMock() {
  return {
    async chatJson() {
      throw new Error('mock API failure');
    },
  };
}

function makeMalformedMock() {
  return {
    async chatJson() {
      return '不是 JSON 的内容';
    },
  };
}

const REFS = (n) => Array.from({ length: n }, (_, i) => ({
  kind: 'url',
  url: `http://test.com/ref-${i + 1}`,
  content: `素材 ${i + 1} 的内容片段`,
}));

async function runCases() {
  const cases = [];
  const pass = (n) => { cases.push({ n, ok: true }); console.log(`  ✓ ${n}`); };
  const fail = (n, msg) => { cases.push({ n, ok: false, msg }); console.log(`  ✗ ${n} — ${msg}`); };

  // ① 单条素材
  {
    const r = await filterByRelevance({
      aiClient: makeMock({ 1: 0 }),  // 即使 AI 打 0 分
      courseName: '时尚传播',
      references: REFS(1),
    });
    if (r.filtered.length === 1 && r.dropped.length === 0) pass('① 单条素材跳过过滤');
    else fail('①', JSON.stringify({ filtered: r.filtered.length, dropped: r.dropped.length }));
  }

  // ② 无 AI 客户端
  {
    const r = await filterByRelevance({
      aiClient: null,
      courseName: '时尚传播',
      references: REFS(3),
    });
    if (r.filtered.length === 3 && r.warning) pass('② 无 AI 客户端时全保留 + 警告');
    else fail('②', `filtered=${r.filtered.length} warning=${r.warning}`);
  }

  // ③ AI 返回非法 JSON
  {
    const r = await filterByRelevance({
      aiClient: makeMalformedMock(),
      courseName: '时尚传播',
      references: REFS(3),
    });
    if (r.filtered.length === 3 && r.warning && r.warning.includes('AI 评分失败')) pass('③ AI 返回非法 JSON 时全保留 + 警告');
    else fail('③', `filtered=${r.filtered.length} warning=${r.warning}`);
  }

  // ④ 混合相关 + 离题
  {
    const r = await filterByRelevance({
      aiClient: makeMock({ 1: 8, 2: 2, 3: 9, 4: 0 }),
      courseName: '时尚传播',
      references: REFS(4),
    });
    if (r.filtered.length === 2 && r.dropped.length === 2) {
      pass('④ 混合素材剔除离题（保留 idx 1+3，剔除 idx 2+4）');
    } else fail('④', `filtered=${r.filtered.length} dropped=${r.dropped.length}`);
  }

  // ⑤ 全部低分 → 保留最高分作为兜底
  {
    const r = await filterByRelevance({
      aiClient: makeMock({ 1: 2, 2: 3, 3: 1, 4: 2 }),
      courseName: '时尚传播',
      references: REFS(4),
    });
    if (r.filtered.length === 1 && r.warning && r.warning.includes('得分最高')) {
      pass('⑤ 全部低分时保留最高分（idx 2, 3 分）作为兜底');
    } else fail('⑤', `filtered=${r.filtered.length} warning=${r.warning}`);
  }

  // ⑥ 全部高分
  {
    const r = await filterByRelevance({
      aiClient: makeMock({ 1: 8, 2: 9, 3: 7 }),
      courseName: '时尚传播',
      references: REFS(3),
    });
    if (r.filtered.length === 3 && r.dropped.length === 0) pass('⑥ 全部高分 → 全保留');
    else fail('⑥', `filtered=${r.filtered.length} dropped=${r.dropped.length}`);
  }

  // ⑦ AI 漏评某条素材（只给 idx 1+2，没给 idx 3）
  {
    const r = await filterByRelevance({
      aiClient: makeMock({ 1: 8, 2: 9 }),  // idx 3 没评
      courseName: '时尚传播',
      references: REFS(3),
    });
    // idx 3 应被兜底保留
    const idx3Audit = r.audit.find((a) => a.idx === 3);
    if (r.filtered.length === 3 && idx3Audit?.reason?.includes('兜底')) {
      pass('⑦ AI 漏评素材时兜底保留');
    } else fail('⑦', `filtered=${r.filtered.length} idx3=${JSON.stringify(idx3Audit)}`);
  }

  // ⑧ 阈值可调
  {
    const r = await filterByRelevance({
      aiClient: makeMock({ 1: 8, 2: 6, 3: 5 }),
      courseName: '时尚传播',
      references: REFS(3),
      threshold: 7,   // 只保留 ≥7 分
    });
    if (r.filtered.length === 1 && r.dropped.length === 2) {
      pass('⑧ 阈值 7 → 只保留 8 分素材');
    } else fail('⑧', `filtered=${r.filtered.length} dropped=${r.dropped.length}`);
  }

  // 汇总
  const passed = cases.filter((c) => c.ok).length;
  console.log(`\n[verify-reference-filter] ${passed}/${cases.length} 通过`);
  if (passed < cases.length) {
    console.log('失败：', cases.filter((c) => !c.ok).map((c) => c.n).join(' / '));
    process.exit(1);
  }
}

runCases().catch((e) => {
  console.error('[verify] 异常：', e);
  process.exit(1);
});
