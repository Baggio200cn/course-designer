/**
 * stress-test-design-first-workflow.js — v4.2.0 Phase A'-9 综合压测
 *
 * 覆盖完整 design-first 工作流：
 *   1. design 切片 → 14 个 sourceDesignSection 字段
 *   2. PPT 大纲 → 各字段映射正确
 *   3. PPT 单页详情 → 兜底字段正确
 *   4. lecture-from-ppt → 解析 SLIDE 段落
 *   5. PPT 页覆盖检查 → 各种异常场景
 *   6. quality.js → pptCoverage 维度
 *   7. 工作流连贯性 → design ID 流转到 PPT artifact metadata
 *   8. session 上下文 → activeDesignArtifactId / activePptOutlineId 同步
 *
 * 10 个测试组，约 40+ 断言
 */

const { _internal: pptInternal, generatePptPlanV2 } = require('../src/main/script/ppt-pipeline-v2');
const {
  generateLectureFromPpt,
  parseSlideSegments,
  checkPptCoverage,
  _internal: lectureInternal,
} = require('../src/main/script/lecture-from-ppt-generator');
const { validateLectureStage } = require('../src/main/v2/quality');
const {
  STAGE_ORDER,
  STAGE_REQUIREMENTS,
  computeUnlockedStages,
} = require('../src/main/v2/contracts');

// ── 测试统计 ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`);
    failures.push(name);
    failed++;
  }
}

function group(name) {
  console.log(`\n${'─'.repeat(60)}\n[组] ${name}\n${'─'.repeat(60)}`);
}

// ── Mock AI Client ──────────────────────────────────────────────────────
class MockAiClient {
  constructor({ outlinePages = null, pageDetail = null, lectureScript = null } = {}) {
    this.outlinePages = outlinePages;
    this.pageDetail = pageDetail;
    this.lectureScript = lectureScript;
    this.callLog = [];
  }
  async chatJson({ systemPrompt, userPrompt, ...rest }) {
    this.callLog.push({ kind: 'chatJson', userPromptLen: userPrompt.length });
    if (this.outlinePages && systemPrompt.includes('PPT 页面大纲')) {
      return JSON.stringify({ pages: this.outlinePages });
    }
    if (this.pageDetail && systemPrompt.includes('PPT 单页详情')) {
      return JSON.stringify(this.pageDetail);
    }
    return '{}';
  }
  async chat({ systemPrompt, userPrompt, ...rest }) {
    this.callLog.push({ kind: 'chat', userPromptLen: userPrompt.length });
    if (this.lectureScript) return this.lectureScript;
    return '';
  }
}

// ── 共用 fixture：完整 design content ───────────────────────────────────
const SAMPLE_DESIGN = {
  lessonMeta: { lessonNumber: 2, topic: '色彩搭配', theoryHours: 1, practiceHours: 1 },
  teachingObjectives: {
    knowledge: ['色相/明度/饱和度三要素', '互补色规律'],
    skill: ['能搭出和谐配色'],
    emotion: ['色彩审美意识'],
  },
  keyPoints: ['色彩三要素', '邻近色应用'],
  difficulties: ['色温调节'],
  teachingMethods: [
    { name: '案例对比法', desc: '看 10 张橱窗对比挑出 3 个错配色', applicable: '导入环节' },
  ],
  inClass: {
    phases: [
      { phase: '启-导入', duration: '5min', teacherActions: '展示 5 张橱窗', studentActions: '观察' },
      { phase: '授-讲授', duration: '20min', teacherActions: '讲三要素', studentActions: '记笔记' },
      { phase: '创-实操', duration: '30min', teacherActions: '巡场指导', studentActions: '独立配色' },
      { phase: '展-反馈', duration: '15min', teacherActions: '组织互评', studentActions: '展示作品' },
      { phase: '拓-总结', duration: '10min', teacherActions: '升华点评', studentActions: '反思' },
    ],
  },
  assessment: {
    components: [
      { name: '搭配方案', weight: 60 },
      { name: '答辩', weight: 40 },
    ],
  },
  ideologicalElements: ['美育', '文化自信'],
};

const SAMPLE_PPT_PAGES = [
  { pageType: '封面', title: '色彩搭配', keyContent: [], sourceDesignSection: 'lessonMeta' },
  { pageType: '课程导入', title: '看图找错', keyContent: ['橱窗 5 张', '挑错配色'], dataPoint: '5 张橱窗', sourceDesignSection: 'phases.启-导入' },
  { pageType: '知识讲解', title: '三要素', keyContent: ['色相', '明度', '饱和度'], speakerNotes: '色相是基础', sourceDesignSection: 'teachingObjectives.knowledge' },
  { pageType: '操作步骤', title: '配色五步法', keyContent: ['1. 选基础色', '2. 加邻近色'], sourceDesignSection: 'phases.创-实操' },
  { pageType: '课堂练习', title: '小组配色', keyContent: ['3 人小组'], interactionPrompt: '3 人小组 10 分钟搭一套', sourceDesignSection: 'phases.展-反馈' },
  { pageType: '总结收束', title: '色彩三要', keyContent: ['美育', '审美'], sourceDesignSection: 'phases.拓-总结' },
  { pageType: '谢谢', title: '谢谢', keyContent: [], sourceDesignSection: 'lessonMeta' },
];

// ═══════════════════════════════════════════════════════════════════════
// Group 1: design slicing 14 字段映射
// ═══════════════════════════════════════════════════════════════════════
group('1. design slicing — 14 sourceDesignSection 字段映射');
{
  const slices = pptInternal._sliceDesignBySection(SAMPLE_DESIGN);
  check('包含 lessonMeta 切片', !!slices['lessonMeta'], 'missing');
  check('lessonMeta 含主题', slices['lessonMeta']?.includes('色彩搭配'));
  check('teachingObjectives.knowledge 切片', slices['teachingObjectives.knowledge']?.includes('三要素'));
  check('teachingObjectives.skill 切片', slices['teachingObjectives.skill']?.includes('和谐配色'));
  check('teachingObjectives.emotion 切片', slices['teachingObjectives.emotion']?.includes('审美意识'));
  check('keyPoints 切片', slices['keyPoints']?.includes('色彩三要素'));
  check('difficulties 切片', slices['difficulties']?.includes('色温'));
  check('teachingMethods 切片', slices['teachingMethods']?.includes('案例对比法'));
  check('phases.启-导入 切片', slices['phases.启-导入']?.includes('橱窗'));
  check('phases.授-讲授 切片', slices['phases.授-讲授']?.includes('讲三要素'));
  check('phases.创-实操 切片', slices['phases.创-实操']?.includes('巡场'));
  check('phases.展-反馈 切片', slices['phases.展-反馈']?.includes('互评'));
  check('phases.拓-总结 切片', slices['phases.拓-总结']?.includes('升华'));
  check('assessment 切片', slices['assessment']?.includes('搭配方案'));
  check('ideologicalElements 切片', slices['ideologicalElements']?.includes('美育'));
}

// ═══════════════════════════════════════════════════════════════════════
// Group 2: design slicing 边界 case
// ═══════════════════════════════════════════════════════════════════════
group('2. design slicing — 边界 case');
{
  // 空 design 仍会产生 lessonMeta 默认行（设计意图：始终给 AI 一个可定位的元信息锚点）
  const emptySlices = pptInternal._sliceDesignBySection({});
  check('空 design 至少含 lessonMeta 默认行', Object.keys(emptySlices).length >= 1 && emptySlices['lessonMeta']);
  check('null 不抛错', Object.keys(pptInternal._sliceDesignBySection(null)).length === 0);

  const minimal = { lessonMeta: { lessonNumber: 1, topic: 'X' } };
  const s = pptInternal._sliceDesignBySection(minimal);
  check('最小 design 只有 lessonMeta', Object.keys(s).length === 1 && s['lessonMeta']);

  // phases 多段命中同一 key
  const multiPhase = {
    inClass: {
      phases: [
        { phase: '导入开场', duration: '3min', teacherActions: '动作 1' },
        { phase: '启动', duration: '4min', teacherActions: '动作 2' },
      ],
    },
  };
  const ms = pptInternal._sliceDesignBySection(multiPhase);
  check('多段都识别为 启-导入 并合并', ms['phases.启-导入']?.includes('动作 1') && ms['phases.启-导入']?.includes('动作 2'));
}

// ═══════════════════════════════════════════════════════════════════════
// Group 3: outline digest 渲染顺序 + 完整性
// ═══════════════════════════════════════════════════════════════════════
group('3. outline digest — AI prompt 输入构造');
{
  const digest = pptInternal._buildDesignDigestForOutline(SAMPLE_DESIGN);
  check('含标题', digest.includes('教学设计'));
  check('含 sourceDesignSection 标签', digest.includes('sourceDesignSection: lessonMeta'));
  check('14 个字段都有锚点', [
    'lessonMeta',
    'teachingObjectives.knowledge',
    'teachingObjectives.skill',
    'teachingObjectives.emotion',
    'keyPoints',
    'difficulties',
    'teachingMethods',
    'phases.启-导入',
    'phases.授-讲授',
    'phases.创-实操',
    'phases.展-反馈',
    'phases.拓-总结',
    'assessment',
    'ideologicalElements',
  ].every((k) => digest.includes(`sourceDesignSection: ${k}`)));
}

// ═══════════════════════════════════════════════════════════════════════
// Group 4: generatePptPlanV2 design-first 模式（mock AI）
// ═══════════════════════════════════════════════════════════════════════
group('4. generatePptPlanV2 — design-first 路径');
(async () => {
  const outlinePages = [
    { pageType: '封面', title: '色彩搭配', sourceDesignSection: 'lessonMeta' },
    { pageType: '知识讲解', title: '三要素', sourceDesignSection: 'teachingObjectives.knowledge' },
    { pageType: '谢谢', title: '谢谢', sourceDesignSection: 'lessonMeta' },
  ];
  const pageDetail = {
    pageType: '知识讲解',
    title: '三要素',
    keyContent: ['色相', '明度', '饱和度'],
    speakerNotes: '本页讲三要素',
    layoutType: 'two-column',
    accentColor: '',
    themeMode: 'light',
  };
  const ai = new MockAiClient({ outlinePages, pageDetail });
  const res = await generatePptPlanV2({
    aiClient: ai,
    designContent: SAMPLE_DESIGN,
    lessonMeta: SAMPLE_DESIGN.lessonMeta,
    courseName: '色彩学',
    totalHours: 2,
    skipDynamicExercise: true,    // 跳过动态练习避免触发服务
  });
  check('mode 为 design-first', res.mode === 'design-first');
  check('生成 3 页', res.pages.length === 3);
  check('每页含 sourceDesignSection', res.pages.every((p) => 'sourceDesignSection' in p));
  check('生成主色', !!res.mainAccentColor && /^#[0-9A-F]{6}$/i.test(res.mainAccentColor));
  check('AI 被调用 4 次（1 outline + 3 details）', ai.callLog.length === 4);
})().then(runGroup5).catch((e) => { failed++; failures.push('Group 4 异常：' + e.message); console.error(e); runGroup5(); });

// ═══════════════════════════════════════════════════════════════════════
// Group 5: lecture-from-ppt 解析 + 覆盖检查
// ═══════════════════════════════════════════════════════════════════════
function runGroup5() {
  group('5. lecture-from-ppt — SLIDE 解析 + 覆盖检查');
  const md = `# 课程
## 整节开场
开场内容
## 【SLIDE-1】封面
${'x'.repeat(50)}
## 【SLIDE-2】知识讲解
${'y'.repeat(80)}
## 【SLIDE-3】谢谢
${'z'.repeat(30)}
## 整节收束
收尾`;
  const segs = parseSlideSegments(md);
  check('解析出 3 个 SLIDE 段落', segs.length === 3);
  check('SLIDE 编号递增 1,2,3', segs.map((s) => s.slideNumber).join() === '1,2,3');

  const pages = [{ title: '封面' }, { title: '知识讲解' }, { title: '谢谢' }];
  const cov = checkPptCoverage(md, pages);
  check('完整覆盖通过', cov.allCovered);
  check('coverage 比例 1.0', cov.coverage === 1);
  check('无缺失', cov.missingSlides.length === 0);

  const partial = '## 【SLIDE-1】a\nx\n## 【SLIDE-3】c\ny';
  const cov2 = checkPptCoverage(partial, pages);
  check('部分覆盖标记 allCovered=false', !cov2.allCovered);
  check('missingSlides 含 2', cov2.missingSlides.includes(2));
  check('coverage = 2/3', Math.abs(cov2.coverage - 2 / 3) < 0.01);

  const dup = '## 【SLIDE-1】a\nx\n## 【SLIDE-1】a\ny\n## 【SLIDE-2】b\nz';
  const cov3 = checkPptCoverage(dup, [{ title: 'a' }, { title: 'b' }]);
  check('duplicateSlides 检出 1', cov3.duplicateSlides.includes(1));

  const tooShort = '## 【SLIDE-1】a\n短\n## 【SLIDE-2】b\n' + 'x'.repeat(60);
  const cov4 = checkPptCoverage(tooShort, [{ title: 'a' }, { title: 'b' }]);
  check('tooShort 检出 1', cov4.tooShort.includes(1));

  runGroup6();
}

// ═══════════════════════════════════════════════════════════════════════
// Group 6: generateLectureFromPpt 全流程（mock AI）
// ═══════════════════════════════════════════════════════════════════════
async function runGroup6() {
  group('6. generateLectureFromPpt — 全流程 mock');
  const mockScript = `# 色彩搭配 · 第 2 节
## 整节开场
${'a'.repeat(40)}
${SAMPLE_PPT_PAGES.map((p, i) => `## 【SLIDE-${i + 1}】${p.title}\n${'x'.repeat(80)}`).join('\n')}
## 整节收束
${'b'.repeat(40)}`;
  const ai = new MockAiClient({ lectureScript: mockScript });
  try {
    const r = await generateLectureFromPpt({
      aiClient: ai,
      pptPages: SAMPLE_PPT_PAGES,
      designContent: SAMPLE_DESIGN,
      lessonMeta: SAMPLE_DESIGN.lessonMeta,
      courseName: '色彩学',
      totalHours: 2,
    });
    check('script 非空', !!r.script);
    check('coverage 全覆盖', r.coverage.allCovered);
    check('coverage 期望页数 = 7', r.coverage.expectedCount === 7);
    check('attemptLog 有 1 条记录', r.attemptLog.length === 1);
    check('attemptLog.coverage = 1', r.attemptLog[0].coverage === 1);
  } catch (e) {
    check('generateLectureFromPpt 不抛异常', false, e.message);
  }
  runGroup7();
}

// ═══════════════════════════════════════════════════════════════════════
// Group 7: quality.js pptCoverage 维度集成
// ═══════════════════════════════════════════════════════════════════════
function runGroup7() {
  group('7. quality.js — pptCoverage 维度集成');

  // 不传 pptPages → 向后兼容
  const r1 = validateLectureStage({ drafts: {}, finalScript: '## 教师讲述\nx\n## 课堂动作\ny' }, { totalHours: 1 });
  check('不传 pptPages → pptCoverage = null', r1.checks.pptCoverage === null);

  // 传 pptPages + 部分覆盖 → warning
  const r2 = validateLectureStage({
    drafts: {},
    finalScript: '## 整节开场\nx\n## 【SLIDE-1】a\n' + 'x'.repeat(60) + '\n## 整节收束',
  }, {
    totalHours: 1,
    pptPages: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
  });
  check('部分覆盖 → 产生 PPT 缺失 warning', r2.warnings.some((w) => w.includes('缺失') && w.includes('PPT')));
  check('pptCoverage 含 missingSlides', r2.checks.pptCoverage.missingSlides.length === 2);

  // 全覆盖 → 无 PPT 警告
  const md = ['## 【SLIDE-1】a', 'x'.repeat(80), '## 【SLIDE-2】b', 'y'.repeat(80), '## 【SLIDE-3】c', 'z'.repeat(80)].join('\n');
  const r3 = validateLectureStage({
    drafts: {},
    finalScript: md,
  }, {
    totalHours: 1,
    pptPages: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
  });
  check('全覆盖 → pptCoverage.allCovered=true', r3.checks.pptCoverage.allCovered);
  check('全覆盖 → 无 PPT 缺失 warning', !r3.warnings.some((w) => w.includes('缺失')));

  runGroup8();
}

// ═══════════════════════════════════════════════════════════════════════
// Group 8: contracts.js 新 6 阶段链
// ═══════════════════════════════════════════════════════════════════════
function runGroup8() {
  group('8. contracts.js — v4.2.0 6 阶段链');
  check('STAGE_ORDER 顺序正确', STAGE_ORDER.join() === 'schedule,design,ppt,lecture,video,report');
  check('ppt 依赖 design_doc', STAGE_REQUIREMENTS.ppt.some((r) => r.type === 'design_doc' && r.stage === 'design'));
  check('lecture 依赖 ppt_outline', STAGE_REQUIREMENTS.lecture.some((r) => r.type === 'ppt_outline' && r.stage === 'ppt'));
  check('lecture 同时依赖 design_doc', STAGE_REQUIREMENTS.lecture.some((r) => r.type === 'design_doc' && r.stage === 'design'));
  check('video 依赖 lecture_final', STAGE_REQUIREMENTS.video.some((r) => r.type === 'lecture_final'));

  // computeUnlockedStages 空 artifacts → 只 schedule 解锁
  check('空 artifacts → 仅 schedule 解锁', computeUnlockedStages([]).join() === 'schedule');

  // 仅 design 已 confirm → schedule + design + ppt 解锁
  const artifacts = [
    { type: 'schedule_table', stage: 'schedule', confirmed: true, status: 'confirmed', updatedAt: new Date().toISOString() },
    { type: 'design_doc', stage: 'design', confirmed: true, status: 'confirmed', updatedAt: new Date().toISOString() },
  ];
  const unlocked = computeUnlockedStages(artifacts);
  check('design 确认后 ppt 解锁', unlocked.includes('ppt'));
  check('design 确认后 lecture 仍未解锁（缺 ppt_outline）', !unlocked.includes('lecture'));

  runGroup9();
}

// ═══════════════════════════════════════════════════════════════════════
// Group 9: PPT 工作流 design ID 流转链路
// ═══════════════════════════════════════════════════════════════════════
function runGroup9() {
  group('9. 工作流 ID 流转 — design → ppt artifact');
  // 此组只验证字段约定（不跑真 DB）：
  //  - ppt-pipeline-v2 输入 designContent + lessonMeta
  //  - 输出每页有 sourceDesignSection
  //  - lecture-from-ppt 输入 pptPages，每页可从中读出 sourceDesignSection
  check('SAMPLE_PPT_PAGES 每页都含 sourceDesignSection', SAMPLE_PPT_PAGES.every((p) => p.sourceDesignSection));

  // PPT pages serialize 输出含 sourceDesignSection 描述
  const out = lectureInternal._serializePptPagesForPrompt(SAMPLE_PPT_PAGES);
  check('serialize 输出含 sourceDesignSection 行', out.includes('对应教学设计字段'));
  check('serialize 含每页 title', SAMPLE_PPT_PAGES.every((p) => out.includes(p.title)));

  runGroup10();
}

// ═══════════════════════════════════════════════════════════════════════
// Group 10: lecture-fallback 模式（v4.1.x 兼容路径）
// ═══════════════════════════════════════════════════════════════════════
async function runGroup10() {
  group('10. lecture-fallback — v4.1.x 兼容路径');
  const lectureText = '【开场】这是开场。\n【模块 1】内容一。\n【总结】结束。';
  const outlinePages = [{ pageType: '知识讲解', title: '模块 1', sourceSection: '模块 1' }];
  const ai = new MockAiClient({
    outlinePages,
    pageDetail: { pageType: '知识讲解', title: '模块 1', keyContent: ['内容一'] },
  });
  try {
    const r = await generatePptPlanV2({
      aiClient: ai,
      lectureScript: lectureText,
      courseName: '测试',
      totalHours: 1,
      skipDynamicExercise: true,
    });
    check('mode 为 lecture-fallback', r.mode === 'lecture-fallback');
    check('生成 1 页', r.pages.length === 1);
  } catch (e) {
    check('lecture-fallback 不抛异常', false, e.message);
  }

  finish();
}

function finish() {
  console.log('\n' + '═'.repeat(60));
  console.log(`总计：${passed} 通过 / ${failed} 失败 / ${passed + failed} 用例`);
  console.log('═'.repeat(60));
  if (failed > 0) {
    console.log('\n失败用例：');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\n✅ Phase A\'-9 全部通过');
    process.exit(0);
  }
}
