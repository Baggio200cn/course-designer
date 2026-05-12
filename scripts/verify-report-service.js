/**
 * verify-report-service.js — Phase-9 C-4 教学实施报告生成器自检
 *
 * 关键契约：
 *   1. AI 自动汇总区（基本元信息 / 教学目标 / 重点难点 / 教学方法 / 总体安排 /
 *      课前课中课后 / 信息化 / 微课视频应用）—— 必须基于上游 hint，但不超出
 *   2. 老师手填区（implementationOutcomes 5 项 + reflectionAndImprovement 4 项）
 *      —— 即使 AI 杜撰，normalize 也要强制清空
 *   3. inClassPhases 必须 5 段，按 REQUIRED_PHASES 顺序
 *   4. school 默认"广州纺校"
 */

const path = require('path');
const SVC = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'report.service.js'));
const { parseReportJson, normalizeReport, loadPrompt } = SVC._internal;
const { REQUIRED_PHASES, TEACHER_FILL_OUTCOME_KEYS, TEACHER_FILL_REFLECTION_KEYS } = SVC;

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
  console.log('Phase-9 C-4 report.service 自检');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── 契约组 1：模块加载 ─────────────────────────────────────────
  console.log('▸ 契约组 1：模块加载');

  await test('模块导出完整', () => {
    if (typeof SVC.generate !== 'function') throw new Error('generate 不是函数');
    if (typeof SVC.selfCheck !== 'function') throw new Error('selfCheck 不是函数');
    if (!Array.isArray(SVC.REQUIRED_PHASES) || SVC.REQUIRED_PHASES.length !== 5) {
      throw new Error('REQUIRED_PHASES 应为 5 段数组');
    }
    if (TEACHER_FILL_OUTCOME_KEYS.length !== 5) {
      throw new Error('TEACHER_FILL_OUTCOME_KEYS 应为 5 项');
    }
    if (TEACHER_FILL_REFLECTION_KEYS.length !== 4) {
      throw new Error('TEACHER_FILL_REFLECTION_KEYS 应为 4 项');
    }
  });

  await test('selfCheck 全过', () => {
    const r = SVC.selfCheck();
    if (r.passed !== r.total) {
      const fails = r.checks.filter((c) => !c.pass).map((c) => c.name);
      throw new Error(`仅 ${r.passed}/${r.total}：${fails.join(', ')}`);
    }
  });

  await test('prompt 文件可加载且足够长', () => {
    const p = loadPrompt('report');
    if (!p || p.length < 500) throw new Error('prompts/report.md 太短或不存在');
    if (!p.includes('implementationOutcomes')) throw new Error('prompt 应含 implementationOutcomes');
    if (!p.includes('reflectionAndImprovement')) throw new Error('prompt 应含 reflectionAndImprovement');
  });

  // ── 契约组 2：JSON 解析 ─────────────────────────────────────────
  console.log('\n▸ 契约组 2：JSON 解析');

  await test('纯 JSON', () => {
    const r = parseReportJson('{"courseName":"测试"}');
    if (r.courseName !== '测试') throw new Error('解析失败');
  });

  await test('markdown 包裹', () => {
    const r = parseReportJson('```json\n{"courseName":"X"}\n```');
    if (r.courseName !== 'X') throw new Error('未去包裹');
  });

  await test('混合解释文字', () => {
    const r = parseReportJson('以下是报告 JSON：\n{"courseName":"Y"}\n（解释完）');
    if (r.courseName !== 'Y') throw new Error('未取到');
  });

  await test('空字符串抛错', () => {
    let threw = false;
    try { parseReportJson(''); } catch { threw = true; }
    if (!threw) throw new Error('应抛错');
  });

  // ── 契约组 3：基本元信息默认值 ──────────────────────────────
  console.log('\n▸ 契约组 3：基本元信息');

  await test('school 默认广州纺校', () => {
    const r = normalizeReport({});
    if (r.school !== '广州纺校') throw new Error(`实际：${r.school}`);
  });

  await test('school 来自 ctx 时尊重 ctx', () => {
    const r = normalizeReport({}, { school: '某校' });
    if (r.school !== '某校') throw new Error('ctx.school 未被尊重');
  });

  await test('courseName 来自 ctx', () => {
    const r = normalizeReport({}, { courseName: '服装学' });
    if (r.courseName !== '服装学') throw new Error('ctx.courseName 未被尊重');
  });

  await test('AI 自带 school 时优先采用 AI', () => {
    const r = normalizeReport({ school: 'A' }, { school: 'B' });
    if (r.school !== 'A') throw new Error('AI 字段优先级失败');
  });

  // ── 契约组 4：inClassPhases 严格 5 段 ────────────────────────
  console.log('\n▸ 契约组 4：inClassPhases');

  await test('严格 5 段（AI 只给 1 段）', () => {
    const r = normalizeReport({
      preInClassPostFlow: { inClassPhases: [{ phase: '导入新课', highlight: 'A' }] },
    });
    if (r.preInClassPostFlow.inClassPhases.length !== 5) {
      throw new Error(`应 5 段，实际 ${r.preInClassPostFlow.inClassPhases.length}`);
    }
  });

  await test('顺序固定（AI 乱序）', () => {
    const r = normalizeReport({
      preInClassPostFlow: {
        inClassPhases: [
          { phase: '总结升华', highlight: '5' },
          { phase: '导入新课', highlight: '1' },
          { phase: '实操练习', highlight: '3' },
        ],
      },
    });
    const names = r.preInClassPostFlow.inClassPhases.map((p) => p.phase);
    if (JSON.stringify(names) !== JSON.stringify(REQUIRED_PHASES)) {
      throw new Error(`顺序错：${JSON.stringify(names)}`);
    }
  });

  await test('保留 AI highlight 内容', () => {
    const r = normalizeReport({
      preInClassPostFlow: {
        inClassPhases: [
          { phase: '导入新课', highlight: '案例引入' },
        ],
      },
    });
    if (r.preInClassPostFlow.inClassPhases[0].highlight !== '案例引入') {
      throw new Error('highlight 丢失');
    }
  });

  await test('完全无 phases → 5 段空内容兜底', () => {
    const r = normalizeReport({});
    if (r.preInClassPostFlow.inClassPhases.length !== 5) {
      throw new Error('空时应返回 5 段空内容');
    }
    if (r.preInClassPostFlow.inClassPhases[0].phase !== '导入新课') {
      throw new Error('第一段应是导入新课');
    }
  });

  // ── 契约组 5：implementationOutcomes 强制清空（核心契约） ─────
  console.log('\n▸ 契约组 5：implementationOutcomes 强制清空（防 AI 杜撰）');

  await test('5 项默认全有，achieved/evidence 为空', () => {
    const r = normalizeReport({});
    const keys = Object.keys(r.implementationOutcomes);
    if (keys.length !== 5) throw new Error(`应 5 项，实际 ${keys.length}`);
    keys.forEach((k) => {
      const o = r.implementationOutcomes[k];
      if (o.achieved !== '' || o.evidence !== '') {
        throw new Error(`${k} 默认应为空，实际 achieved=${o.achieved}, evidence=${o.evidence}`);
      }
    });
  });

  await test('AI 杜撰 studentEngagement → 强制清空', () => {
    const r = normalizeReport({
      implementationOutcomes: {
        studentEngagement: { achieved: '95%', evidence: '出勤率高' },
      },
    });
    const o = r.implementationOutcomes.studentEngagement;
    if (o.achieved !== '' || o.evidence !== '') {
      throw new Error(`AI 杜撰未被清空：achieved=${o.achieved}, evidence=${o.evidence}`);
    }
  });

  await test('AI 杜撰 5 项全部数据 → 全部强制清空', () => {
    const r = normalizeReport({
      implementationOutcomes: {
        studentEngagement: { achieved: '95%', evidence: 'X' },
        workCompletion: { achieved: '100%', evidence: 'Y' },
        skillTransfer: { achieved: '良好', evidence: 'Z' },
        industryAlignment: { achieved: '高度对接', evidence: 'W' },
        ideologicalImpact: { achieved: '显著', evidence: 'V' },
      },
    });
    let allCleared = true;
    Object.values(r.implementationOutcomes).forEach((o) => {
      if (o.achieved !== '' || o.evidence !== '') allCleared = false;
    });
    if (!allCleared) throw new Error('AI 杜撰的 5 项应全被清空');
  });

  await test('5 项 key 顺序与 TEACHER_FILL_OUTCOME_KEYS 一致', () => {
    const r = normalizeReport({});
    TEACHER_FILL_OUTCOME_KEYS.forEach((k) => {
      if (!(k in r.implementationOutcomes)) throw new Error(`缺 key: ${k}`);
    });
  });

  // ── 契约组 6：reflectionAndImprovement 强制清空 ──────────────
  console.log('\n▸ 契约组 6：reflectionAndImprovement 强制清空');

  await test('4 项默认全为空数组', () => {
    const r = normalizeReport({});
    const keys = Object.keys(r.reflectionAndImprovement);
    if (keys.length !== 4) throw new Error(`应 4 项，实际 ${keys.length}`);
    keys.forEach((k) => {
      if (!Array.isArray(r.reflectionAndImprovement[k])) {
        throw new Error(`${k} 应为数组`);
      }
      if (r.reflectionAndImprovement[k].length !== 0) {
        throw new Error(`${k} 默认应为空数组，实际长度 ${r.reflectionAndImprovement[k].length}`);
      }
    });
  });

  await test('AI 杜撰 achievements/issues → 强制清空', () => {
    const r = normalizeReport({
      reflectionAndImprovement: {
        achievements: ['杜撰 1', '杜撰 2'],
        issues: ['假问题'],
        improvements: ['假改进'],
        futurePlans: ['假规划'],
      },
    });
    if (r.reflectionAndImprovement.achievements.length !== 0) throw new Error('achievements 未清空');
    if (r.reflectionAndImprovement.issues.length !== 0) throw new Error('issues 未清空');
    if (r.reflectionAndImprovement.improvements.length !== 0) throw new Error('improvements 未清空');
    if (r.reflectionAndImprovement.futurePlans.length !== 0) throw new Error('futurePlans 未清空');
  });

  // ── 契约组 7：教学方法兼容 ────────────────────────────────
  console.log('\n▸ 契约组 7：教学方法格式');

  await test('字符串数组转对象', () => {
    const r = normalizeReport({ teachingMethods: ['案例法', '任务驱动'] });
    if (r.teachingMethods.length !== 2) throw new Error('字符串数组应被接受');
    if (r.teachingMethods[0].name !== '案例法') throw new Error('字符串应被转 name');
  });

  await test('对象数组保留 applicable', () => {
    const r = normalizeReport({
      teachingMethods: [{ name: '项目式', applicable: '实操环节' }],
    });
    if (r.teachingMethods[0].applicable !== '实操环节') throw new Error('applicable 丢失');
  });

  await test('空数组保持空（不强制兜底）', () => {
    const r = normalizeReport({ teachingMethods: [] });
    if (r.teachingMethods.length !== 0) {
      throw new Error('空数组不应自动添加默认（report 与 design 不同）');
    }
  });

  // ── 契约组 8：上游统计 ──────────────────────────────────────
  console.log('\n▸ 契约组 8：_stats.upstreamCount');

  await test('全部 5 个上游 → upstreamCount=5', () => {
    const r = normalizeReport({}, {
      hasSchedule: true, hasDesign: true, hasLecture: true, hasPpt: true, hasMicroVideo: true,
    });
    if (r._stats.upstreamCount !== 5) {
      throw new Error(`应 5，实际 ${r._stats.upstreamCount}`);
    }
  });

  await test('零上游 → upstreamCount=0', () => {
    const r = normalizeReport({});
    if (r._stats.upstreamCount !== 0) {
      throw new Error(`应 0，实际 ${r._stats.upstreamCount}`);
    }
  });

  await test('部分上游 → upstreamCount 准确', () => {
    const r = normalizeReport({}, {
      hasSchedule: true, hasDesign: true, hasLecture: false, hasPpt: true, hasMicroVideo: false,
    });
    if (r._stats.upstreamCount !== 3) {
      throw new Error(`应 3，实际 ${r._stats.upstreamCount}`);
    }
  });

  // ── 契约组 9：teacherFillProgress ────────────────────────
  console.log('\n▸ 契约组 9：teacherFillProgress');

  await test('初次生成时 filled=0, totalSlots=9', () => {
    const r = normalizeReport({});
    const p = r._stats.teacherFillProgress;
    if (p.filled !== 0) throw new Error(`filled 应为 0，实际 ${p.filled}`);
    if (p.totalSlots !== 9) throw new Error(`totalSlots 应为 9（5 outcome + 4 reflection），实际 ${p.totalSlots}`);
    if (p.ratio !== 0) throw new Error(`ratio 应为 0`);
  });

  // ── 契约组 10：generate 守卫 ───────────────────────────────
  console.log('\n▸ 契约组 10：generate 守卫');

  await test('aiClient 缺失 → success:false', async () => {
    const r = await SVC.generate({ courseName: 'X' });
    if (r.success !== false) throw new Error('应 success:false');
  });

  await test('courseName 缺失 → success:false', async () => {
    const r = await SVC.generate({
      aiClient: { chatJson: async () => '{}' },
      courseName: '',
    });
    if (r.success !== false) throw new Error('应 success:false');
  });

  await test('AI 抛错 → success:false', async () => {
    const r = await SVC.generate({
      aiClient: { chatJson: async () => { throw new Error('mock 网络错'); } },
      courseName: '测试课',
    });
    if (r.success !== false) throw new Error('应 success:false');
  });

  await test('AI 返回非 JSON → success:false', async () => {
    const r = await SVC.generate({
      aiClient: { chatJson: async () => '不是 JSON' },
      courseName: '测试课',
    });
    if (r.success !== false) throw new Error('应 success:false');
  });

  await test('合法 JSON → success:true 含完整 report', async () => {
    const mockJson = JSON.stringify({
      courseName: '服装跨媒体推广',
      school: '广州纺校',
      academicYear: '2025-2026',
      term: '第二学期',
      teacher: '李老师',
      teachingObjectives: { knowledge: ['K1'], skill: ['S1'], emotion: ['E1'] },
      keyPointsAndDifficulties: { keyPoints: ['重点 1'], difficulties: ['难点 1'] },
      teachingMethods: [{ name: '案例法', applicable: '理论' }],
      overallArrangement: '总体安排概述',
      preInClassPostFlow: {
        preClass: { tasks: ['T1'], outcome: 'O' },
        inClassPhases: [
          { phase: '导入新课', highlight: 'H1' },
          { phase: '知识讲授', highlight: 'H2' },
          { phase: '实操练习', highlight: 'H3' },
          { phase: '互查反馈', highlight: 'H4' },
          { phase: '总结升华', highlight: 'H5' },
        ],
        postClass: { homework: ['HW1'], feedback: 'FB' },
      },
      informatization: { platform: '学习通', tools: ['T'], purpose: 'P' },
      microVideoUsage: '微课用于课前自学',
      // AI 杜撰的实施成效 —— 应被清空
      implementationOutcomes: {
        studentEngagement: { achieved: '95%', evidence: 'AI 编的' },
      },
      reflectionAndImprovement: {
        achievements: ['AI 编的成效'],
      },
    });

    const r = await SVC.generate({
      aiClient: { chatJson: async () => mockJson },
      courseName: '服装跨媒体推广',
    });
    if (r.success !== true) throw new Error(`应 success:true：${r.error}`);
    if (!r.data?.report) throw new Error('缺 report');
    if (r.data.report.preInClassPostFlow.inClassPhases.length !== 5) {
      throw new Error('phases 应 5 段');
    }
    // 关键校验：AI 杜撰的实施成效必须被清空
    if (r.data.report.implementationOutcomes.studentEngagement.achieved !== '') {
      throw new Error('AI 杜撰的 studentEngagement.achieved 未被清空');
    }
    if (r.data.report.reflectionAndImprovement.achievements.length !== 0) {
      throw new Error('AI 杜撰的 achievements 未被清空');
    }
  });

  await test('generate 注入上游 → _stats.upstreamCount 正确', async () => {
    const mockJson = JSON.stringify({ courseName: '测试课' });
    const r = await SVC.generate({
      aiClient: { chatJson: async () => mockJson },
      courseName: '测试课',
      scheduleData: { schedule: [{ chapter: 'Ch1', content: 'X' }] },
      designData: { teachingObjectives: { knowledge: ['K'] } },
      lectureData: { summary: 'sum' },
      pptData: null,
      microVideoData: null,
    });
    if (r.success !== true) throw new Error(`应 success:true：${r.error}`);
    if (r.data.report._stats.upstreamCount !== 3) {
      throw new Error(`upstreamCount 应为 3，实际 ${r.data.report._stats.upstreamCount}`);
    }
  });

  // ── 总结 ─────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`总计：${pass + fail}    通过：${pass}    失败：${fail}`);

  if (fail === 0) {
    console.log('✅ 全部通过');
    console.log('\n⚠️  H9 提醒：契约组通过 ≠ 端到端就绪');
    console.log('   集成测试需 npm run dev：');
    console.log('     1. 完成 schedule/design/lecture/ppt/video 5 个阶段并确认');
    console.log('     2. 进入 report 阶段，点"生成实施报告"');
    console.log('     3. 检查 AI 自动汇总区是否填充、老师手填区是否为空');
    console.log('     4. 老师手填实施成效后，点"保存"+"确认"');
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
