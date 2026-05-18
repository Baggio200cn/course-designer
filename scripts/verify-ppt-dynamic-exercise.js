/**
 * verify-ppt-dynamic-exercise.js
 *
 * 验证：PPT 动态练习页生成（2026-05-15 问题三 F 层）
 *
 * 测试用例（6 项）：
 *   ① HTML 渲染含 4 种题型组件
 *   ② HTML 含交互 JS（checkSingle / checkTF / checkFill / showRef）
 *   ③ 主入口生成包含 5-8 道题的练习页
 *   ④ 练习页 pageType='动态练习'
 *   ⑤ 在主 pipeline 中自动插入在"谢谢"页前
 *   ⑥ skipDynamicExercise=true 时跳过插入
 */
const path = require('path');
const dynEx = require(path.resolve(__dirname, '..', 'src/main/services/ppt-dynamic-exercise.service.js'));
const pipe = require(path.resolve(__dirname, '..', 'src/main/script/ppt-pipeline-v2.js'));

async function runCases() {
  const cases = [];
  const pass = (n) => { cases.push({ n, ok: true }); console.log(`  ✓ ${n}`); };
  const fail = (n, msg) => { cases.push({ n, ok: false, msg }); console.log(`  ✗ ${n} — ${msg}`); };

  // ① ② HTML 结构
  {
    const html = dynEx.buildExerciseHtml({
      title: '测试练习',
      subtitle: '副标题',
      exercises: [
        { type: 'single_choice', question: '1+1=?', options: ['A.1', 'B.2', 'C.3'], correctIndex: 1, explanation: '基础数学' },
        { type: 'true_false', question: '太阳是恒星', answer: true, explanation: '是的' },
        { type: 'fill_blank', question: '__ 是 __ 的核心', blanks: ['传播主体', '5W'], explanation: '5W 框架' },
        { type: 'short_answer', question: '说说 5W', referenceAnswer: 'Who/Says/Channel/To Whom/Effect', explanation: '5 个维度' },
      ],
      courseName: '时尚传播',
    });
    if (html.includes('单选') && html.includes('判断') && html.includes('填空') && html.includes('简答')) {
      pass('① HTML 含 4 种题型标题');
    } else fail('①', '题型标题缺失');

    if (html.includes('checkSingle') && html.includes('checkTF') && html.includes('checkFill') && html.includes('showRef')) {
      pass('② HTML 含 4 个交互 JS 函数');
    } else fail('②', 'JS 函数缺失');
  }

  // ③ ④ 主入口
  {
    const aiClient = {
      async chatJson() {
        return JSON.stringify({
          title: '5W 课堂检验',
          subtitle: '看你掌握得如何',
          exercises: [
            { type: 'single_choice', question: '5W 中 Who 指什么？', options: ['A.传播者', 'B.内容', 'C.渠道', 'D.效果'], correctIndex: 0, explanation: 'Who=传播主体' },
            { type: 'single_choice', question: 'In Which Channel 指？', options: ['A.讲什么', 'B.通过什么渠道', 'C.对谁', 'D.效果'], correctIndex: 1, explanation: '渠道' },
            { type: 'fill_blank', question: '5W 包含 ____ 个维度', blanks: ['5'], explanation: '5W' },
            { type: 'true_false', question: '5W 是拉斯韦尔 1948 年提出的', answer: true, explanation: '正确' },
            { type: 'short_answer', question: '说说 5W 框架在服装品牌传播中的应用', referenceAnswer: '可从 5 个维度分析品牌传播', explanation: '答出 3 个维度即可' },
          ],
        });
      },
    };
    const r = await dynEx.generateDynamicExercise({
      aiClient,
      pages: [
        { pageType: '知识讲解', title: '认识 5W', keyContent: ['Who', 'Says What'], dataPoint: '1948 年', caseExample: '李宁国潮' },
        { pageType: '案例', title: '李宁拆解', keyContent: ['品牌传播'], dataPoint: '', caseExample: '李宁' },
      ],
      courseName: '时尚传播',
      totalHours: 2,
    });
    if (r.exercises.length === 5 && r.exercisePage.title === '5W 课堂检验') {
      pass('③ 主入口生成 5 道题');
    } else fail('③', `exercises=${r.exercises.length} title=${r.exercisePage.title}`);

    if (r.exercisePage.pageType === '动态练习' && r.exercisePage.exerciseHtml.length > 1000) {
      pass('④ exercisePage.pageType=动态练习 + HTML 已附');
    } else fail('④', `pageType=${r.exercisePage.pageType} htmlLen=${r.exercisePage.exerciseHtml?.length}`);
  }

  // ⑤ ⑥ 主 pipeline 插入逻辑
  {
    const aiClient = {
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
            title: '练习', subtitle: '副', exercises: [
              { type: 'single_choice', question: 'Q', options: ['A','B'], correctIndex: 0, explanation: 'X' },
              { type: 'true_false', question: 'Q2', answer: true, explanation: 'X' },
              { type: 'fill_blank', question: 'Q3 __ ', blanks: ['a'], explanation: 'X' },
              { type: 'short_answer', question: 'Q4', referenceAnswer: 'a', explanation: 'X' },
              { type: 'single_choice', question: 'Q5', options: ['A','B'], correctIndex: 0, explanation: 'X' },
            ],
          });
        }
        return JSON.stringify({
          pageType: 'X', title: 'X', keyContent: [], speakerNotes: '',
          dataPoint: '', caseExample: '', interactionPrompt: '',
          imagePrompt: '默认配图描述足够长', needImage: true,
        });
      },
    };
    // ⑤ 默认插入
    {
      const r = await pipe.generatePptPlanV2({
        aiClient, lectureScript: '【开场】x【模块 1】y【谢谢】',
        courseName: '测试', totalHours: 1, modules: [],
        lectureSections: [{ heading: '开场' }, { heading: '模块 1' }],
      });
      // 原 3 页 + 1 练习页 = 4 页；练习页应在"谢谢"之前
      const ex = r.pages.find((p) => p.pageType === '动态练习');
      const thanksIdx = r.pages.findIndex((p) => p.pageType === '谢谢');
      const exIdx = r.pages.findIndex((p) => p.pageType === '动态练习');
      if (r.pages.length === 4 && r.exerciseInserted && ex && exIdx < thanksIdx) {
        pass('⑤ 主 pipeline 自动在"谢谢"页前插入动态练习页');
      } else fail('⑤', `len=${r.pages.length} inserted=${r.exerciseInserted} exIdx=${exIdx} thanksIdx=${thanksIdx}`);
    }
    // ⑥ skipDynamicExercise=true
    {
      const r = await pipe.generatePptPlanV2({
        aiClient, lectureScript: '【开场】x【模块 1】y【谢谢】',
        courseName: '测试', totalHours: 1, modules: [],
        lectureSections: [{ heading: '开场' }, { heading: '模块 1' }],
        skipDynamicExercise: true,
      });
      const hasEx = r.pages.some((p) => p.pageType === '动态练习');
      if (r.pages.length === 3 && !r.exerciseInserted && !hasEx) {
        pass('⑥ skipDynamicExercise=true 时不插入');
      } else fail('⑥', `len=${r.pages.length} inserted=${r.exerciseInserted} hasEx=${hasEx}`);
    }
  }

  // 汇总
  const passed = cases.filter((c) => c.ok).length;
  console.log(`\n[verify-ppt-dynamic-exercise] ${passed}/${cases.length} 通过`);
  if (passed < cases.length) {
    console.log('失败：', cases.filter((c) => !c.ok).map((c) => c.n).join(' / '));
    process.exit(1);
  }
}

runCases().catch((e) => {
  console.error('[verify] 异常：', e);
  process.exit(1);
});
