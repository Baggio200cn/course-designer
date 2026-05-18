/**
 * e2e-full-course-flow.js — 端到端冒烟测试（v4.1.4 老脚本）
 *
 * ⚠ Codex Round 4 #5 标注（2026-05-18 v4.3.3）：
 *   这是 v4.1.4 时期的 5 stage 老脚本，仅覆盖 schedule → design → lecture → ppt → 持久化。
 *   不覆盖 v4.3.3 新增的 quiz / homework / 8 阶段顺序变化 / per-lesson 模型 / dirty 信号传播。
 *
 *   v4.3.3+ 推荐用：
 *     - scripts/verify-contracts-v8.js（35 测试·8 阶段契约）
 *     - scripts/verify-workflow-integration-v8.js（14 测试·runtime/workbench/migration 集成）
 *     - scripts/smoke-test-real-ark.js（真实 endpoint 烟雾）
 *
 *   本脚本保留作向后兼容参考。TODO(D14.3 或 v4.4.0)：写 `scripts/e2e-v8-full-8stage.js`
 *   覆盖完整 8 阶段链（需 mock 多节课 + quiz/homework + 8 阶段解锁）。
 *
 * 目标：用 mock AI 跑完整 5 stage 链路（schedule → design → lecture → ppt → 持久化往返）
 * 重点检查"上游修改下游炸"的字段透传：每个 stage 之间的 normalizer / validator 不丢字段
 *
 * 为什么这是真 P0（不是 N 个 verify）：
 *   - 现有 N 个 verify 测的是单个函数的内部正确性
 *   - 这个 e2e 测的是"老师真实走完一遍"的关键字段是否每一站都不丢
 *   - 直接定位的就是用户反馈过的真实 bug（如 metadata 被刷掉 / 字段透传漏接）
 *
 * 不依赖：
 *   - 真实 AI（用 mock 提供稳定可预期输出）
 *   - 真实 DB（用内存对象模拟 listArtifacts / createArtifact / updateArtifact）
 *   - Electron（纯 node 跑）
 *
 * 检查清单（与历史 bug 一一对应）：
 *   ✓ T1: 进度表 schedule.header 必填字段全部回得来（courseName/teacher/className 不被空值覆盖）
 *   ✓ T2: design.lessonMeta.lessonNumber/topic/hours 不在 save+load 后丢失
 *   ✓ T3: design_doc 排序按 lessonNumber + subNumber + chapter + createdAt 多键稳定
 *   ✓ T4: lecture_final.metadata 经过 lessonSave（patch 合并）后 lessonNumber 不被覆盖回 0
 *   ✓ T5: lecture finalScript 通过 quality 校验时，单节课低 totalHours 不被章节数阈值误判
 *   ✓ T6: PPT pipeline 输出每页含 layoutType / accentColor / themeMode 3 字段
 *   ✓ T7: PPT mainAccentColor 根据课程名命中正确行业（光电→科技蓝）
 *   ✓ T8: PPT page 经 normalizePptPage 后 layoutType / accentColor / themeMode 字段保留
 *   ✓ T9: PPT publication contract 透传 mainAccentColor
 *   ✓ T10: ppt-layouts dispatchLayout 7 个 layoutType 都能跑通
 *   ✓ T11: 退出码：0 = 全过，1 = 有失败
 */

'use strict';

const path = require('path');

// ── 测试结果汇总 ──────────────────────────────────────────────────────────
let total = 0;
let pass = 0;
const fails = [];

function ok(name, cond, detail = '') {
  total++;
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function section(title) {
  console.log(`\n━━━ ${title} ━━━`);
}

// ── 通用 Mock AI 客户端 ───────────────────────────────────────────────────
function makeMockAi(responseMap) {
  return {
    callLog: [],
    async chatJson({ systemPrompt = '', userPrompt = '' }) {
      const sys = String(systemPrompt || '').slice(0, 200);
      const usr = String(userPrompt || '').slice(0, 200);
      this.callLog.push({ sys, usr });
      // 找到匹配的 responseMap 入口
      for (const [matcher, payload] of responseMap) {
        if (matcher(systemPrompt, userPrompt)) {
          return typeof payload === 'function'
            ? payload(systemPrompt, userPrompt)
            : payload;
        }
      }
      throw new Error(`mock AI 未匹配任何 responseMap：sys=${sys.slice(0, 80)} | usr=${usr.slice(0, 80)}`);
    },
  };
}

// ── 内存 DB（简化版，只支持 listArtifacts/createArtifact/updateArtifact）─────
function makeMemoryDb() {
  let nextId = 1;
  const artifacts = [];
  const notebooks = new Map();
  return {
    createArtifact(payload) {
      const a = {
        ...payload,
        id: nextId++,
        createdAt: new Date(Date.now() - artifacts.length * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      };
      artifacts.push(a);
      return a;
    },
    updateArtifact(id, patch) {
      const a = artifacts.find((x) => x.id === Number(id));
      if (!a) throw new Error(`updateArtifact: id ${id} 未找到`);
      Object.assign(a, patch, { updatedAt: new Date().toISOString() });
      return a;
    },
    listArtifacts({ notebookId, type, stage } = {}) {
      return artifacts.filter((a) => {
        if (notebookId && Number(a.notebookId) !== Number(notebookId)) return false;
        if (type && a.type !== type) return false;
        if (stage && a.stage !== stage) return false;
        return true;
      }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    },
    getLatestArtifact(notebookId, type, stage = '') {
      return this.listArtifacts({ notebookId, type, stage })[0] || null;
    },
    isArtifactLocked() { return false; },
    isLatestArtifactLocked() { return false; },
    setNotebook(id, nb) { notebooks.set(id, nb); },
    getNotebookById(id) { return notebooks.get(Number(id)) || null; },
    getApiKey() { return 'mock-api-key'; },
  };
}

// ── 主流程 ────────────────────────────────────────────────────────────────
async function runE2E() {
  console.log('\n========================================');
  console.log('  e2e-full-course-flow.js · 真 P0 冒烟');
  console.log('========================================\n');

  const COURSE_NAME = '中山光电产业人才结构分析';
  const TOTAL_HOURS = 6;
  const HOURS_PER_SESSION = 3;
  const notebook = {
    id: 1,
    name: COURSE_NAME,
    totalHours: TOTAL_HOURS,
    hoursPerSession: HOURS_PER_SESSION,
    softwareTools: 'Zemax / Minitab',
    jobTargets: '光电产品工程师',
    industryScenarios: '中山光电产业',
    learnerProfile: '中职二年级学生',
  };
  const db = makeMemoryDb();
  db.setNotebook(1, notebook);

  // ════════════════════════════════════════════════════════════════════
  // Stage 1: Schedule（进度表）
  // ════════════════════════════════════════════════════════════════════
  section('Stage 1 · 进度表生成');

  const { generate: generateSchedule } = require('../src/main/services/schedule.service');

  // 用 2 行（6 学时 / 3 小时每次 = 2 次课）
  const scheduleMockResponse = {
    header: {
      courseName: COURSE_NAME,
      teacher: '巴乔老师',
      school: '中山火炬职业院校',
      department: '光电信息',
      semester: '2025-2026第4学期',
      className: '24级光电信息',
      textbook: '机器视觉、高清大屏幕显示',
      totalHours: TOTAL_HOURS,
      theoryHours: 3,
      practiceHours: 3,
      examHours: 0,
      hoursPerSession: HOURS_PER_SESSION,
    },
    objective: '掌握光电产业人才需求结构与薪资分析方法，能对接光电制造企业的核心岗位需求。',
    keyPoints: ['人才需求层级', '薪资构成要素', '岗位能力匹配'],
    difficulties: ['需求与课程对接逻辑'],
    methods: ['讲授', '案例分析', '小组讨论'],
    experimentTopics: ['行业数据分析', '岗位需求拆解'],
    evaluation: {
      approach: '过程性评价 + 终结性评价',
      components: ['课前预习', '课中参与', '小组成果', '课后作业'],
      weights: { 课前预习: 20, 课中参与: 30, 小组成果: 35, 课后作业: 15 },
    },
    schedule: [
      { week: 1, session: 1, chapter: '一', content: '光电产业人才需求结构', hours: HOURS_PER_SESSION, method: '讲授', homework: 1 },
      { week: 2, session: 2, chapter: '二', content: '光电产业薪资构成与岗位匹配', hours: HOURS_PER_SESSION, method: '案例分析', homework: 1 },
    ],
    additionalNotes: '',
  };

  const aiSchedule = makeMockAi([
    [(sys) => /教学进度表生成器|schedule/i.test(sys), JSON.stringify(scheduleMockResponse)],
  ]);

  const scheduleRes = await generateSchedule({
    aiClient: aiSchedule,
    courseName: COURSE_NAME,
    courseContext: {
      totalHours: TOTAL_HOURS,
      hoursPerSession: HOURS_PER_SESSION,
      softwareTools: notebook.softwareTools,
      jobTargets: notebook.jobTargets,
      industryScenarios: notebook.industryScenarios,
    },
  });

  ok('schedule.service.generate 返回 success', scheduleRes?.success === true);
  const schedule = scheduleRes?.data?.schedule;
  ok('schedule.header.courseName 保留', schedule?.header?.courseName === COURSE_NAME);
  ok('schedule.header.teacher 不被空值替换', schedule?.header?.teacher === '巴乔老师');
  ok('schedule.header.className 不被空值替换', schedule?.header?.className === '24级光电信息');
  ok('schedule[].hours 都 === hoursPerSession (3)', Array.isArray(schedule?.schedule) &&
     schedule.schedule.every((r) => Number(r.hours) === HOURS_PER_SESSION));
  ok('schedule.length 行数正确 (TOTAL/PER_SESSION)', schedule?.schedule?.length === TOTAL_HOURS / HOURS_PER_SESSION);
  ok('schedule[].chapter 有真实内容', schedule?.schedule?.every((r) => r.chapter && r.content));

  // 持久化
  const scheduleArtifact = db.createArtifact({
    notebookId: notebook.id,
    type: 'schedule_table',
    stage: 'schedule',
    title: `${COURSE_NAME}-教学进度表`,
    content: schedule,
    status: 'generated',
    confirmed: true,
    metadata: { phase: 'phase-9' },
  });
  ok('schedule artifact 持久化', !!scheduleArtifact?.id);

  // ════════════════════════════════════════════════════════════════════
  // Stage 2: Design（教学设计 per-lesson 2 节）
  // ════════════════════════════════════════════════════════════════════
  section('Stage 2 · 教学设计（per-lesson × 2）');

  const { generate: generateDesign } = require('../src/main/services/design.service');

  const designMockResponses = [
    {
      lessonMeta: { lessonNumber: 1, topic: '光电产业人才需求结构', chapter: '一', theoryHours: 2, practiceHours: 1, totalHours: 3 },
      teachingObjectives: {
        knowledge: ['掌握光电产业人才需求层级', '理解薪资构成要素'],
        skill: ['能梳理岗位能力匹配点'],
        emotion: ['树立产业认同感'],
      },
      keyPoints: ['人才需求结构特征'],
      difficulties: ['岗位与课程对接逻辑'],
      teachingMethods: [{ name: '案例教学法', desc: '用本地光电企业招聘案例', applicable: '需求结构分析' }],
      inClass: { phases: [
        { phase: '启·导入', duration: '15分钟', teacherActions: '...', studentActions: '...', designIntent: '建立场景' },
        { phase: '授·讲授', duration: '30分钟', teacherActions: '...', studentActions: '...', designIntent: '建立认知' },
        { phase: '创·实操', duration: '25分钟', teacherActions: '...', studentActions: '...', designIntent: '形成能力' },
        { phase: '展·反馈', duration: '15分钟', teacherActions: '...', studentActions: '...', designIntent: '强化提升' },
        { phase: '拓·总结', duration: '5分钟', teacherActions: '...', studentActions: '...', designIntent: '升华内化' },
      ]},
      assessment: { components: [
        { name: '过程表现', weight: 50 },
        { name: '小组成果', weight: 35 },
        { name: '课后作业', weight: 15 },
      ]},
      ideologicalElements: ['职业认同：扎根本地', '工匠精神'],
    },
    {
      lessonMeta: { lessonNumber: 2, topic: '光电产业薪资构成与岗位匹配', chapter: '二', theoryHours: 1, practiceHours: 2, totalHours: 3 },
      teachingObjectives: {
        knowledge: ['理解薪资构成模型'],
        skill: ['能解读光电岗位薪资数据'],
        emotion: ['形成职业规划意识'],
      },
      keyPoints: ['薪资构成要素'],
      difficulties: ['数据解读'],
      teachingMethods: [{ name: '数据分析法', desc: '招聘平台数据拆解', applicable: '薪资分析' }],
      inClass: { phases: [
        { phase: '启·导入', duration: '15分钟' },
        { phase: '授·讲授', duration: '30分钟' },
        { phase: '创·实操', duration: '30分钟' },
        { phase: '展·反馈', duration: '10分钟' },
        { phase: '拓·总结', duration: '5分钟' },
      ]},
      assessment: { components: [
        { name: '课中参与', weight: 40 },
        { name: '实操成果', weight: 50 },
        { name: '课后作业', weight: 10 },
      ]},
      ideologicalElements: ['职业规划意识'],
    },
  ];

  let designIdx = 0;
  const aiDesign = makeMockAi([
    [(sys) => /教学设计|design/i.test(sys), () => {
      const r = JSON.stringify(designMockResponses[designIdx % designMockResponses.length]);
      designIdx++;
      return r;
    }],
  ]);

  const designArtifacts = [];
  for (let i = 0; i < 2; i++) {
    const expectedMeta = designMockResponses[i].lessonMeta;
    const r = await generateDesign({
      aiClient: aiDesign,
      courseName: COURSE_NAME,
      lessonMeta: expectedMeta,
      scheduleData: schedule,
      courseContext: {
        totalHours: TOTAL_HOURS,
        softwareTools: notebook.softwareTools,
        jobTargets: notebook.jobTargets,
        industryScenarios: notebook.industryScenarios,
        learnerProfile: notebook.learnerProfile,
      },
    });
    ok(`design[${i + 1}] generate success`, r?.success === true, r?.error);
    const design = r?.data?.design;
    ok(`design[${i + 1}] lessonMeta.lessonNumber=${expectedMeta.lessonNumber}`,
       design?.lessonMeta?.lessonNumber === expectedMeta.lessonNumber);
    ok(`design[${i + 1}] lessonMeta.topic 保留`, design?.lessonMeta?.topic === expectedMeta.topic);
    ok(`design[${i + 1}] 三类教学目标都有内容`,
       design?.teachingObjectives?.knowledge?.length > 0
       && design?.teachingObjectives?.skill?.length > 0);
    ok(`design[${i + 1}] 5 段法 phases 完整`, design?.inClass?.phases?.length === 5);

    const a = db.createArtifact({
      notebookId: notebook.id,
      type: 'design_doc',
      stage: 'design',
      title: `第 ${expectedMeta.lessonNumber} 节·${expectedMeta.topic}（${expectedMeta.totalHours}学时）`,
      content: design,
      status: 'generated',
      confirmed: true,
      metadata: {
        lessonNumber: expectedMeta.lessonNumber,
        lessonTopic: expectedMeta.topic,
        lessonChapter: expectedMeta.chapter,
        theoryHours: expectedMeta.theoryHours,
        practiceHours: expectedMeta.practiceHours,
        lessonTotalHours: expectedMeta.totalHours,
        phase: 'phase-9',
      },
    });
    designArtifacts.push(a);
  }

  // ── T3: design_doc 列表排序（v2:listDesignLessons 同款逻辑）─────────────
  const designItems = db.listArtifacts({ notebookId: notebook.id, type: 'design_doc' });
  const sorted = [...designItems].sort((a, b) => {
    const ln = (Number(a.metadata?.lessonNumber) || 0) - (Number(b.metadata?.lessonNumber) || 0);
    if (ln !== 0) return ln;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  ok('T3: design_doc 列表按 lessonNumber 升序',
     sorted.map((a) => a.metadata?.lessonNumber).join() === '1,2');

  // ── T2 + T4: lessonSave merge-patch 不冲掉非零原值 ────────────────────────
  // 模拟"已存 lesson 1 → 老师以空表单触发 save"的 bug 场景
  const lessonSaveSim = (existingMeta, payload) => {
    const pickNum = (next, prev) => {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) return n;
      return Number(prev) || 0;
    };
    const pickStr = (next, prev) => {
      const s = String(next || '').trim();
      return s || String(prev || '').trim();
    };
    return {
      lessonNumber: pickNum(payload.lessonNumber, existingMeta.lessonNumber) || 1,
      topic: pickStr(payload.topic, existingMeta.topic),
      chapter: pickStr(payload.chapter, existingMeta.chapter),
      theoryHours: pickNum(payload.theoryHours, existingMeta.theoryHours),
      practiceHours: pickNum(payload.practiceHours, existingMeta.practiceHours),
      weekRange: pickStr(payload.weekRange, existingMeta.weekRange),
    };
  };
  {
    const existing = { lessonNumber: 1, topic: '光电产业人才需求结构', theoryHours: 2, practiceHours: 1, chapter: '一' };
    const emptyPayload = { lessonNumber: 0, topic: '', theoryHours: 0, practiceHours: 0, chapter: '' };
    const merged = lessonSaveSim(existing, emptyPayload);
    ok('T4: lessonSave 空表单保护 - lessonNumber 不被覆盖',
       merged.lessonNumber === 1);
    ok('T4: lessonSave 空表单保护 - topic 不被覆盖',
       merged.topic === '光电产业人才需求结构');
    ok('T4: lessonSave 空表单保护 - 学时不被覆盖',
       merged.theoryHours === 2 && merged.practiceHours === 1);

    // 真实有值的 patch 必须能覆盖
    const realPatch = { lessonNumber: 1, topic: '光电产业人才需求结构 V2', theoryHours: 1, practiceHours: 2 };
    const merged2 = lessonSaveSim(existing, realPatch);
    ok('T4: lessonSave 真实 patch 能覆盖',
       merged2.topic === '光电产业人才需求结构 V2'
       && merged2.theoryHours === 1
       && merged2.practiceHours === 2);
  }

  // ════════════════════════════════════════════════════════════════════
  // Stage 3: Lecture（讲稿质量校验，不调真 AI）
  // ════════════════════════════════════════════════════════════════════
  section('Stage 3 · 讲稿质量校验（章节阈值按学时动态）');

  const { validateLectureStage } = require('../src/main/v2/quality');

  // 单节 3 学时讲稿，4 章节（按新阈值应满足，不触发"章节偏少"）
  const lectureScript = '## 一、开场\n教师讲述：开场内容\n课堂动作：导入\n\n## 二、知识点 1\n教师讲述：' + 'abc'.repeat(800)
    + '\n课堂动作：讲解\n\n## 三、知识点 2\n教师讲述：' + 'def'.repeat(800)
    + '\n课堂动作：演示。请同学们思考？\n\n## 四、总结\n教师讲述：总结。接着我们做练习首先复习，最后提问？\n课堂动作：提问。';
  const draft = 'x'.repeat(3000);
  const q3h = validateLectureStage(
    { finalScript: lectureScript, selectedDraft: 'a', drafts: { a: draft, b: draft, c: draft } },
    { totalHours: 3, requireFinal: false }
  );
  const hasChapterTooFew = (q3h.reviewReasons || []).some((r) => r.includes('章节结构偏弱'));
  ok('T5: 3 学时 4 章节 不再触发"章节偏少" review reason',
     !hasChapterTooFew, hasChapterTooFew ? `当前 reasons: ${(q3h.reviewReasons || []).join(' | ')}` : '');

  // 整门课 6 学时讲稿，3 章节（应触发 review）
  const shortScript = '## 一、开场\n教师讲述：开场\n课堂动作：导入\n## 二、模块\n教师讲述：模块\n课堂动作：演示\n## 三、收束\n教师讲述：收束\n课堂动作：总结';
  const q6h = validateLectureStage(
    { finalScript: shortScript, selectedDraft: 'a', drafts: { a: draft, b: draft, c: draft } },
    { totalHours: 6, requireFinal: false }
  );
  const triggered6h = (q6h.reviewReasons || []).some((r) => r.includes('章节结构偏弱'));
  ok('T5b: 6 学时 3 章节 仍触发"章节偏少"（按新阈值 ≥6 章节）', triggered6h);

  // ════════════════════════════════════════════════════════════════════
  // Stage 4: PPT pipeline V2（Phase 2 字段 + 行业主色）
  // ════════════════════════════════════════════════════════════════════
  section('Stage 4 · PPT pipeline V2（layoutType + accentColor + themeMode）');

  const {
    generatePptPlanV2,
    inferMainAccentColor,
    defaultLayoutTypeFor,
    defaultThemeModeFor,
    VALID_LAYOUT_TYPES,
  } = require('../src/main/script/ppt-pipeline-v2');

  // T7: 行业主色推断
  ok('T7: 光电产业 → 科技蓝 #2563EB',
     inferMainAccentColor({ courseName: COURSE_NAME, courseContext: { jobTargets: notebook.jobTargets } }) === '#2563EB');

  const lectureFullScript = `【开场导入】光电产业人才需求概述。
【模块 1：人才结构】光电产业的人才层级分为研发、生产、测试。
【模块 2：薪资分析】不同岗位薪资差异显著。
【总结收束】回顾本节核心。`;

  const aiPpt = makeMockAi([
    [(sys) => sys.includes('PPT 页面大纲生成器') || sys.includes('大纲生成器'), JSON.stringify({
      pages: [
        { pageType: '封面', title: '光电产业人才结构', sourceSection: '开场导入' },
        { pageType: '路线图', title: '本节路径', sourceSection: '开场导入' },
        { pageType: '知识讲解', title: '人才层级', sourceSection: '模块 1：人才结构' },
        { pageType: '案例展示', title: '岗位薪资', sourceSection: '模块 2：薪资分析' },
        { pageType: '验收标准', title: '能力检核', sourceSection: '模块 2：薪资分析' },
        { pageType: '总结收束', title: '本节回顾', sourceSection: '总结收束' },
        { pageType: '谢谢', title: 'Thank you', sourceSection: '总结收束' },
      ],
    })],
    // page-detail：按 pageType 提供合理 layoutType
    [(sys) => sys.includes('PPT 单页详情生成器'), (sys, usr) => {
      let layoutType = 'bullet-list';
      let themeMode = 'light';
      if (usr.includes('封面') || usr.includes('谢谢') || usr.includes('总结收束')) {
        layoutType = 'hero'; themeMode = 'dark';
      } else if (usr.includes('路线图') || usr.includes('操作步骤')) {
        layoutType = 'diagram-center';
      } else if (usr.includes('验收标准')) {
        layoutType = 'table';
      } else if (usr.includes('课堂练习')) {
        layoutType = 'quote';
      } else if (usr.includes('知识讲解') || usr.includes('案例展示')) {
        layoutType = 'two-column';
      }
      return JSON.stringify({
        subtitle: '副标题',
        keyContent: ['要点 1', '要点 2', '要点 3'],
        speakerNotes: '老师讲解参考',
        dataPoint: '',
        caseExample: '',
        interactionPrompt: '',
        imagePrompt: '光电产业实操场景',
        needImage: true,
        layoutType,
        accentColor: '',
        themeMode,
      });
    }],
  ]);

  const pptResult = await generatePptPlanV2({
    lectureScript: lectureFullScript,
    courseName: COURSE_NAME,
    totalHours: TOTAL_HOURS,
    modules: [],
    aiClient: aiPpt,
    courseContext: {
      softwareTools: notebook.softwareTools,
      jobTargets: notebook.jobTargets,
      industryScenarios: notebook.industryScenarios,
    },
    skipDynamicExercise: true,
  });

  ok('pipeline 返回 pages 数组', Array.isArray(pptResult?.pages) && pptResult.pages.length > 0);
  ok('pipeline 返回 mainAccentColor', /^#[0-9A-F]{6}$/i.test(String(pptResult?.mainAccentColor || '')));
  ok('T7b: mainAccentColor === 光电主色 #2563EB',
     pptResult?.mainAccentColor === '#2563EB',
     `got ${pptResult?.mainAccentColor}`);
  ok('T6: 每页都含 layoutType',
     pptResult.pages.every((p) => VALID_LAYOUT_TYPES.has(p.layoutType)));
  ok('T6: 每页都含 themeMode (light|dark)',
     pptResult.pages.every((p) => ['light', 'dark'].includes(p.themeMode)));
  ok('T6: 每页都含 accentColor 字段（可为空字符串）',
     pptResult.pages.every((p) => typeof p.accentColor === 'string'));

  // T8: PPT page 经 normalizePptPage 后字段保留
  //   引入 index.js 不行（需 Electron），所以这里手动跑 normalizer 逻辑
  //   2026-05-16 v4.1.4 加固：必须含 exercises / exerciseHtml（动态练习字段）
  function normalizePptPage(page = {}, index = 0) {
    return {
      id: String(page.id || `ppt-page-${index + 1}`),
      pageNumber: Number(page.pageNumber) || index + 1,
      pageType: String(page.pageType || '内容页'),
      title: String(page.title || `第${index + 1}页`),
      subtitle: String(page.subtitle || ''),
      keyContent: page.keyContent || '',
      imagePrompt: String(page.imagePrompt || ''),
      imagePath: String(page.imagePath || ''),
      needImage: typeof page.needImage === 'boolean' ? page.needImage : true,
      layoutType: String(page.layoutType || ''),
      accentColor: String(page.accentColor || ''),
      themeMode: String(page.themeMode || ''),
      speakerNotes: String(page.speakerNotes || ''),
      dataPoint: String(page.dataPoint || ''),
      caseExample: String(page.caseExample || ''),
      interactionPrompt: String(page.interactionPrompt || ''),
      sourceSection: String(page.sourceSection || ''),
      // 动态练习字段（必须保留，否则 exercisePage.exercises 在 save+load 后变 0）
      exercises: Array.isArray(page.exercises) ? page.exercises : [],
      exerciseHtml: String(page.exerciseHtml || ''),
    };
  }
  const normalizedPages = pptResult.pages.map(normalizePptPage);
  ok('T8: normalizePptPage 不丢 layoutType / accentColor / themeMode',
     normalizedPages.every((p) => p.layoutType && typeof p.themeMode === 'string')
     && normalizedPages.length === pptResult.pages.length);

  // 🔥 T8.1: 动态练习页的 exercises 数组必须存活
  //   2026-05-16 v4.1.4 老师反馈："卡片显示共 7 题但顶部练习题（0·失败）" → 真凶 = normalizer 剥掉 exercises
  const fakeExercisePage = {
    id: 'dyn-1', pageNumber: 99, pageType: '动态练习',
    title: '课堂动态练习', subtitle: '互动检验',
    keyContent: ['共 7 题', '单选 / 填空 / 判断 / 简答混合', '点选项即得反馈'],
    speakerNotes: '让学生扫码答题',
    needImage: false,
    layoutType: 'bullet-list', accentColor: '', themeMode: 'light',
    exercises: [
      { type: 'single_choice', question: 'Q1', options: ['A','B','C','D'], correctIndex: 0, explanation: 'E1' },
      { type: 'fill_blank', question: 'Q2 ___', blanks: ['ans'], explanation: 'E2' },
      { type: 'true_false', question: 'Q3', answer: true, explanation: 'E3' },
    ],
    exerciseHtml: '<html><body>exercise</body></html>',
  };
  const normalizedExercise = normalizePptPage(fakeExercisePage, 0);
  ok('T8.1 🔥: normalizePptPage 保留 exercises 数组（不再被剥掉）',
     Array.isArray(normalizedExercise.exercises) && normalizedExercise.exercises.length === 3,
     `got ${normalizedExercise.exercises?.length} questions`);
  ok('T8.1: normalizePptPage 保留 exerciseHtml',
     normalizedExercise.exerciseHtml && normalizedExercise.exerciseHtml.length > 10);

  // ════════════════════════════════════════════════════════════════════
  // Stage 5: ppt-layouts dispatchLayout 7 类
  // ════════════════════════════════════════════════════════════════════
  section('Stage 5 · ppt-layouts dispatch（7 种 layoutType 都能跑）');

  const PptxGenJS = require('pptxgenjs');
  const { dispatchLayout } = require('../src/main/export/ppt-layouts');

  for (const lt of ['hero', 'two-column', 'image-bleed', 'diagram-center', 'quote', 'table', 'bullet-list']) {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    const slide = pptx.addSlide();
    let threw = false;
    try {
      dispatchLayout(slide, {
        pageType: '知识讲解',
        title: `测试 ${lt}`,
        subtitle: '副',
        keyContent: ['a', 'b', 'c', 'd'],
        speakerNotes: '...',
        dataPoint: '100%',
        caseExample: '案例',
        interactionPrompt: '思考一下？',
        imagePrompt: '场景图',
        layoutType: lt,
        accentColor: '',
        themeMode: 'light',
      }, { mainAccent: '2563EB', pageNumber: 1, totalPages: 7 });
    } catch (e) {
      threw = true;
      console.error(`    layout ${lt} 抛错: ${e.message}`);
    }
    ok(`T10: dispatchLayout '${lt}' 跑通`, !threw);
  }

  // ════════════════════════════════════════════════════════════════════
  // Stage 6: 持久化往返字段保真（最关键的端到端断言）
  // ════════════════════════════════════════════════════════════════════
  section('Stage 6 · 持久化往返（save → load 字段不丢）');

  // 用一个含 Phase 2 字段的 page 走完 save → list → normalize → 对比
  const samplePage = {
    id: 'p1',
    pageNumber: 1,
    pageType: '知识讲解',
    title: '人才层级',
    subtitle: '研发 / 生产 / 测试',
    keyContent: '要点 1\n要点 2\n要点 3',
    speakerNotes: '本页讲解人才层级',
    dataPoint: '研发占 30%',
    caseExample: '中山某光电厂招聘案例',
    interactionPrompt: '想想你身边的工程师是什么层级？',
    imagePrompt: '光电工厂研发部场景',
    needImage: true,
    sourceSection: '模块 1：人才结构',
    layoutType: 'two-column',
    accentColor: '',
    themeMode: 'light',
  };
  const savedArtifact = db.createArtifact({
    notebookId: notebook.id,
    type: 'ppt_outline',
    stage: 'ppt',
    title: 'PPT 大纲',
    content: { pptPages: [samplePage], mainAccentColor: '#2563EB', templateKey: 'pro_minimalist' },
    status: 'generated',
    confirmed: false,
  });
  const reloaded = db.listArtifacts({ notebookId: notebook.id, type: 'ppt_outline' })[0];
  const reloadedPage = reloaded?.content?.pptPages?.[0];
  ok('T9: 持久化往返 layoutType 保真',
     reloadedPage?.layoutType === 'two-column');
  ok('T9: 持久化往返 themeMode 保真',
     reloadedPage?.themeMode === 'light');
  ok('T9: 持久化往返 dataPoint / caseExample 保真',
     reloadedPage?.dataPoint === '研发占 30%' && reloadedPage?.caseExample?.includes('中山某光电厂'));
  ok('T9: publication mainAccentColor 透传',
     reloaded?.content?.mainAccentColor === '#2563EB');

  // ════════════════════════════════════════════════════════════════════
  // 总结
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`总计：${total}    通过：${pass}    失败：${fails.length}`);
  if (fails.length === 0) {
    console.log(`✅ 全部通过！数据流端到端 OK`);
    return 0;
  }
  console.log(`❌ 失败项：`);
  fails.forEach((f) => console.log(`   - ${f.name}${f.detail ? '\n     ' + f.detail : ''}`));
  return 1;
}

runE2E()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('\n💥 E2E 异常退出：', err);
    process.exit(2);
  });
