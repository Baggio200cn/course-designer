/**
 * verify-ppt-pipeline-v2.js
 *
 * 验证：PPT 双阶段 pipeline（修复 2026-05-15 问题二）
 *
 * 测试用例（7 项）：
 *   ① 章节切片：按章节标题切讲稿
 *   ② 并发限制：5 个任务 concurrency=2 仍正确返回所有结果
 *   ③ 阶段 1 大纲生成：调用 aiClient 1 次，返回 pageType+title+sourceSection
 *   ④ 阶段 2 单页详情：从 sectionExcerpt 生成完整 schema
 *   ⑤ 主入口 generatePptPlanV2：1 次大纲 + N 次详情，最终 pages 数 = 大纲页数
 *   ⑥ 单页失败时走兜底（不影响其他页）
 *   ⑦ prevPages 配图保留
 */
const path = require('path');
const pipe = require(path.resolve(__dirname, '..', 'src/main/script/ppt-pipeline-v2.js'));
const { generatePptPlanV2, generateOutline, generateOnePageDetail, _internal } = pipe;
const { _sliceLectureBySection, withConcurrency } = _internal;

const SAMPLE_LECTURE = `
【开场导入】
今天我们一起学习时尚传播的核心理论——拉斯韦尔 5W 框架。这是 1948 年由传播学家拉斯韦尔提出的经典模型。

【模块 1：5W 框架认识】
5W 包括：Who（谁）、Says What（说什么）、In Which Channel（通过什么渠道）、To Whom（对谁）、With What Effect（效果如何）。
课堂活动：让学生用 5W 分析某品牌秋冬上新案例，5 分钟独立填空。

【模块 2：服装传播应用】
以李宁国潮系列为例，分析其 5W 要素：
- Who：李宁品牌 + 设计师 + 营销团队
- Says What：东方美学 + 街头潮流
- Channel：小红书 + 抖音 + 实体店
学生小组讨论：每组找一个本土品牌做类似拆解。

【总结收束】
本节学习了 5W 框架的 5 个维度，以及如何用它分析真实服装品牌案例。下节课我们将进入消费者画像分析。
`.trim();

function runCases() {
  const cases = [];
  const pass = (n) => { cases.push({ n, ok: true }); console.log(`  ✓ ${n}`); };
  const fail = (n, msg) => { cases.push({ n, ok: false, msg }); console.log(`  ✗ ${n} — ${msg}`); };

  // ① 章节切片
  (() => {
    const slices = _sliceLectureBySection(SAMPLE_LECTURE, ['开场导入', '模块 1：5W 框架认识', '模块 2：服装传播应用', '总结收束']);
    const ok = Object.keys(slices).length === 4
      && slices['开场导入'].includes('拉斯韦尔')
      && slices['模块 1：5W 框架认识'].includes('Says What')
      && slices['模块 2：服装传播应用'].includes('李宁');
    if (ok) pass('① 章节切片按锚点正确切分');
    else fail('①', `切片数=${Object.keys(slices).length} 切片名=${Object.keys(slices).join('/')}`);
  })();

  // ② 并发限制
  (async () => {
    const results = await withConcurrency([1,2,3,4,5], 2, async (n) => {
      await new Promise((r) => setTimeout(r, 20));
      return n * 10;
    });
    const values = results.map((r) => r.value);
    if (values.join(',') === '10,20,30,40,50') pass('② 并发限制下顺序+结果正确');
    else fail('②', JSON.stringify(values));
  })().then(() => verifyAsync());

  let asyncDone = false;
  async function verifyAsync() {
    // ③ 阶段 1 大纲
    {
      const calls = [];
      const aiClient = {
        async chatJson({ systemPrompt, userPrompt }) {
          calls.push({ systemPrompt: systemPrompt.slice(0, 60), userPrompt: userPrompt.slice(0, 100) });
          return JSON.stringify({
            pages: [
              { pageType: '封面', title: '5W 看时尚传播', sourceSection: '开场导入' },
              { pageType: '知识讲解', title: '认识 5W', sourceSection: '模块 1：5W 框架认识' },
              { pageType: '案例', title: '李宁案例拆解', sourceSection: '模块 2：服装传播应用' },
              { pageType: '总结收束', title: '本节小结', sourceSection: '总结收束' },
            ],
          });
        },
      };
      const r = await generateOutline({
        aiClient, lectureScript: SAMPLE_LECTURE, courseName: '时尚传播', totalHours: 2, modules: [],
        lectureSections: [{ heading: '开场导入' }, { heading: '模块 1：5W 框架认识' }],
      });
      if (r.pages.length === 4 && r.pages[0].pageType === '封面' && r.pages[2].sourceSection.includes('模块 2')) {
        pass('③ 阶段 1 大纲：4 页正确生成 + sourceSection 完整');
      } else fail('③', JSON.stringify(r.pages));
    }

    // ④ 阶段 2 单页详情
    {
      const aiClient = {
        async chatJson({ userPrompt }) {
          // 验证 userPrompt 含本页元信息 + sectionExcerpt
          const okPrompt = userPrompt.includes('5W 框架') && userPrompt.includes('Says What');
          return JSON.stringify({
            pageType: '知识讲解',
            title: '认识 5W',
            subtitle: '拉斯韦尔 1948',
            keyContent: ['Who 谁说', 'Says What', 'Channel', 'To Whom', 'With Effect'],
            speakerNotes: '今天我们认识拉斯韦尔的 5W 框架...',
            dataPoint: '1948 年提出',
            caseExample: '李宁国潮系列',
            interactionPrompt: '想一想：你最近看到的服装广告里 Who 是谁？',
            imagePrompt: '服装秀场背景下 5 个 W 字母浮现的概念图',
            needImage: true,
          });
        },
      };
      const detail = await generateOnePageDetail({
        aiClient,
        page: { pageType: '知识讲解', title: '认识 5W', sourceSection: '模块 1：5W 框架认识' },
        sectionExcerpt: SAMPLE_LECTURE.split('【模块 1')[1].split('【模块 2')[0],
        courseName: '时尚传播', totalHours: 2,
      });
      if (detail.keyContent.length === 5
        && detail.dataPoint === '1948 年提出'
        && detail.caseExample === '李宁国潮系列'
        && detail.interactionPrompt.length > 5
        && detail.imagePrompt.length >= 20) {
        pass('④ 阶段 2 单页详情：完整 8 字段 schema 解析');
      } else fail('④', JSON.stringify(detail));
    }

    // ⑤ 主入口（大纲 + 详情联动）
    {
      let outlineCalls = 0;
      let detailCalls = 0;
      const aiClient = {
        async chatJson({ systemPrompt }) {
          if (systemPrompt.includes('大纲规划专家')) {
            outlineCalls++;
            return JSON.stringify({
              pages: [
                { pageType: '封面', title: '5W 时尚传播', sourceSection: '开场导入' },
                { pageType: '知识讲解', title: '认识 5W', sourceSection: '模块 1：5W 框架认识' },
                { pageType: '案例', title: '李宁拆解', sourceSection: '模块 2：服装传播应用' },
              ],
            });
          } else {
            detailCalls++;
            return JSON.stringify({
              pageType: '知识讲解', title: 'X', keyContent: ['a'], speakerNotes: '...',
              dataPoint: '', caseExample: '', interactionPrompt: '',
              imagePrompt: '专业教学场景示意图，内容主体清晰，构图饱满',
              needImage: true,
            });
          }
        },
      };
      const r = await generatePptPlanV2({
        aiClient, lectureScript: SAMPLE_LECTURE, courseName: '时尚传播', totalHours: 2,
        modules: [], lectureSections: [{ heading: '开场导入' }, { heading: '模块 1：5W 框架认识' }],
        concurrency: 3,
        skipDynamicExercise: true,   // 此测试只验证大纲+详情链路，不验证练习页
      });
      if (r.pages.length === 3 && outlineCalls === 1 && detailCalls === 3 && r.pipeline === 'v2-two-stage') {
        pass(`⑤ 主入口：1 次大纲 + 3 次详情 = 3 页（${r.pipeline}）`);
      } else fail('⑤', `pages=${r.pages.length} outline=${outlineCalls} detail=${detailCalls}`);
    }

    // ⑥ 单页失败兜底
    {
      let detailCallCount = 0;
      const aiClient = {
        async chatJson({ systemPrompt }) {
          if (systemPrompt.includes('大纲规划专家')) {
            return JSON.stringify({
              pages: [
                { pageType: '封面', title: 'A', sourceSection: '开场导入' },
                { pageType: '案例', title: 'B', sourceSection: '模块 2：服装传播应用' },
              ],
            });
          }
          detailCallCount++;
          if (detailCallCount === 1) throw new Error('mock：第一页详情失败');
          return JSON.stringify({
            pageType: '案例', title: 'B', keyContent: ['x'], speakerNotes: '...',
            dataPoint: '', caseExample: '', interactionPrompt: '',
            imagePrompt: '案例教学场景图', needImage: true,
          });
        },
      };
      const r = await generatePptPlanV2({
        aiClient, lectureScript: SAMPLE_LECTURE, courseName: '时尚传播', totalHours: 2,
        modules: [], concurrency: 2,
        skipDynamicExercise: true,
      });
      if (r.pages.length === 2 && r.failedCount === 1 && r.pages[0]._generateError) {
        pass('⑥ 单页失败时走兜底（不影响其他页）');
      } else fail('⑥', `pages=${r.pages.length} failedCount=${r.failedCount}`);
    }

    // ⑦ prevPages 配图保留
    {
      const aiClient = {
        async chatJson({ systemPrompt }) {
          if (systemPrompt.includes('大纲规划专家')) {
            return JSON.stringify({ pages: [{ pageType: '知识讲解', title: 'X', sourceSection: '开场导入' }] });
          }
          return JSON.stringify({
            pageType: '知识讲解', title: 'X', keyContent: [], speakerNotes: '',
            dataPoint: '', caseExample: '', interactionPrompt: '',
            imagePrompt: '新提示词内容长度足够', needImage: true,
          });
        },
      };
      const r = await generatePptPlanV2({
        aiClient, lectureScript: SAMPLE_LECTURE, courseName: '时尚传播', totalHours: 1,
        modules: [],
        prevPages: [{ imageDataUri: 'data:image/png;base64,xxx', imagePrompt: '老师手工选的图' }],
        skipDynamicExercise: true,
      });
      if (r.pages[0].imageDataUri === 'data:image/png;base64,xxx' && r.pages[0].imagePrompt === '老师手工选的图') {
        pass('⑦ prevPages 配图与提示词保留（老师手工调整不丢失）');
      } else fail('⑦', JSON.stringify({ imageDataUri: r.pages[0].imageDataUri, imagePrompt: r.pages[0].imagePrompt }));
    }

    // 汇总
    asyncDone = true;
    const passed = cases.filter((c) => c.ok).length;
    console.log(`\n[verify-ppt-pipeline-v2] ${passed}/${cases.length} 通过`);
    if (passed < cases.length) {
      console.log('失败：', cases.filter((c) => !c.ok).map((c) => c.n).join(' / '));
      process.exit(1);
    }
  }

  // 等待异步完成（最多 30s）
  setTimeout(() => { if (!asyncDone) { console.error('verify timeout'); process.exit(1); } }, 30000);
}

runCases();
