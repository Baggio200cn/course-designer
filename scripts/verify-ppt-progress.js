/**
 * verify-ppt-progress.js
 *
 * 验证：PPT 双阶段 pipeline 进度推送（P2-5）
 *
 * 测试用例（4 项）：
 *   ① pipeline 接受 onProgress 回调
 *   ② 顺序：outline-start → outline-done → detail-start → detail-page-done* → detail-all-done → exercise-start → exercise-done → all-done
 *   ③ detail-page-done 的 current 单调递增
 *   ④ skipDynamicExercise=true 时不发 exercise-* 事件
 */
const path = require('path');
const pipe = require(path.resolve(__dirname, '..', 'src/main/script/ppt-pipeline-v2.js'));

async function runCases() {
  const cases = [];
  const pass = (n) => { cases.push({ n, ok: true }); console.log(`  ✓ ${n}`); };
  const fail = (n, msg) => { cases.push({ n, ok: false, msg }); console.log(`  ✗ ${n} — ${msg}`); };

  const makeAi = () => ({
    async chatJson({ systemPrompt }) {
      if (systemPrompt.includes('大纲规划专家')) {
        return JSON.stringify({
          pages: [
            { pageType: '封面', title: 'A', sourceSection: '开场' },
            { pageType: '知识讲解', title: 'B', sourceSection: '模块 1' },
            { pageType: '谢谢', title: '谢谢', sourceSection: '' },
          ],
        });
      }
      if (systemPrompt.includes('动态练习页')) {
        return JSON.stringify({
          title: '练习', subtitle: '副',
          exercises: [
            { type: 'single_choice', question: 'Q', options: ['A','B'], correctIndex: 0, explanation: 'X' },
          ],
        });
      }
      return JSON.stringify({
        pageType: 'X', title: 'X', keyContent: [], speakerNotes: '',
        dataPoint: '', caseExample: '', interactionPrompt: '',
        imagePrompt: '默认配图描述足够长', needImage: true,
      });
    },
  });

  // ① ② ③
  {
    const events = [];
    const r = await pipe.generatePptPlanV2({
      aiClient: makeAi(),
      lectureScript: '【开场】x【模块 1】y【谢谢】',
      courseName: '测试', totalHours: 1, modules: [],
      lectureSections: [{ heading: '开场' }, { heading: '模块 1' }],
      onProgress: (e) => events.push(e),
    });
    const phases = events.map((e) => e.phase);
    // ① 至少有 outline-start 和 all-done
    if (phases.includes('outline-start') && phases.includes('all-done')) pass('① pipeline 接受 onProgress 回调（事件齐全）');
    else fail('①', JSON.stringify(phases));
    // ② 顺序
    const expectedOrder = ['outline-start', 'outline-done', 'detail-start', 'detail-all-done', 'exercise-start', 'exercise-done', 'all-done'];
    const actualOrder = phases.filter((p) => expectedOrder.includes(p));
    const orderOk = expectedOrder.every((p, i) => actualOrder[i] === p);
    if (orderOk) pass('② 事件顺序正确');
    else fail('②', `actual: ${actualOrder.join(' → ')}`);
    // ③ detail-page-done 的 current 单调递增
    const detailEvents = events.filter((e) => e.phase === 'detail-page-done');
    const currents = detailEvents.map((e) => e.current);
    const monotonic = currents.every((c, i) => i === 0 || c >= currents[i - 1]);
    if (monotonic && currents.length === 3) pass(`③ detail-page-done 单调递增（${currents.join(',')}）`);
    else fail('③', `currents=${currents.join(',')}`);
  }

  // ④ skipDynamicExercise
  {
    const events = [];
    await pipe.generatePptPlanV2({
      aiClient: makeAi(),
      lectureScript: '【开场】x【模块 1】y【谢谢】',
      courseName: '测试', totalHours: 1, modules: [],
      lectureSections: [{ heading: '开场' }, { heading: '模块 1' }],
      onProgress: (e) => events.push(e),
      skipDynamicExercise: true,
    });
    const phases = events.map((e) => e.phase);
    const hasExercise = phases.some((p) => p.startsWith('exercise-'));
    if (!hasExercise && phases.includes('all-done')) pass('④ skipDynamicExercise 时不发 exercise-* 事件');
    else fail('④', JSON.stringify(phases));
  }

  const passed = cases.filter((c) => c.ok).length;
  console.log(`\n[verify-ppt-progress] ${passed}/${cases.length} 通过`);
  if (passed < cases.length) {
    console.log('失败：', cases.filter((c) => !c.ok).map((c) => c.n).join(' / '));
    process.exit(1);
  }
}

runCases().catch((e) => {
  console.error('[verify] 异常：', e);
  process.exit(1);
});
