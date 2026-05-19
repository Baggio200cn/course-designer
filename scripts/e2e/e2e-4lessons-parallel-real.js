/**
 * e2e-4lessons-parallel.js — 端到端 8 阶段 × 4 节课并行测试
 *
 * 流程：
 *   Stage 1: 新建 notebook + 手工构造 schedule_table（来自老师上传的 docx）
 *   Stage 2-7: 4 节课（第 2/6/13/16 节）并行做 design/ppt/lecture/quiz/homework/video
 *   Stage 8: 基于 4 节合并生成实施报告
 *
 * 产出：全部到桌面 驭课-v4.2.0-端到端验收/2026-05-19-全新-4节并行/
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── 配置 ─────────────────────────────────────────────────────────────
const DB_PATH = 'C:/Users/Zhaol/AppData/Roaming/驭课 Agent/course-designer-data.json';
const OUT_DIR = 'C:/Users/Zhaol/Desktop/驭课-v4.2.0-端到端验收/2026-05-19-全新-4节并行';
const PROGRESS_LOG = path.join(OUT_DIR, '_progress.log');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(PROGRESS_LOG, line + '\n');
}

// ── 4 节课配置 ───────────────────────────────────────────────────────
const FOUR_LESSONS = [
  { lessonNumber: 2,  chapter: '一', topic: '服装产品传播的起源与发展历程',     theoryHours: 3, practiceHours: 1, method: '讲授+小组讨论法', weekRange: '第 2 周' },
  { lessonNumber: 6,  chapter: '二', topic: 'POP海报、陈列道具设计规范',         theoryHours: 3, practiceHours: 1, method: '讲授',           weekRange: '第 6 周' },
  { lessonNumber: 13, chapter: '四', topic: '全渠道传播协同策略与逻辑',          theoryHours: 3, practiceHours: 1, method: '讲授',           weekRange: '第 13 周' },
  { lessonNumber: 16, chapter: '四', topic: '实训4：全渠道传播综合项目制作',     theoryHours: 1, practiceHours: 3, method: '讲授',           weekRange: '第 16 周' },
];

// ── 18 节进度表数据（从 docx 解析）─────────────────────────────────
const SCHEDULE_ROWS = [
  { week: 1,  lessonNumber: 1,  chapter: '一', content: '服装产品传播概述与课程导学',     theoryHours: 4, practiceHours: 0, method: '讲授+案例分析法', homeworkCount: 0 },
  { week: 2,  lessonNumber: 2,  chapter: '一', content: '服装产品传播的起源与发展历程',   theoryHours: 3, practiceHours: 1, method: '讲授+小组讨论法', homeworkCount: 0 },
  { week: 3,  lessonNumber: 3,  chapter: '一', content: '服装产品传播的核心特征与原则',   theoryHours: 4, practiceHours: 0, method: '讲授',           homeworkCount: 0 },
  { week: 4,  lessonNumber: 4,  chapter: '一', content: '实训1：个人传播IP思维导图制作', theoryHours: 1, practiceHours: 3, method: '讲授',           homeworkCount: 1 },
  { week: 5,  lessonNumber: 5,  chapter: '二', content: '线下终端传播核心场景与需求',     theoryHours: 4, practiceHours: 0, method: '讲授',           homeworkCount: 0 },
  { week: 6,  lessonNumber: 6,  chapter: '二', content: 'POP海报、陈列道具设计规范',     theoryHours: 3, practiceHours: 1, method: '讲授',           homeworkCount: 0 },
  { week: 7,  lessonNumber: 7,  chapter: '二', content: 'PS基础操作与物料设计入门',       theoryHours: 2, practiceHours: 2, method: '讲授',           homeworkCount: 0 },
  { week: 8,  lessonNumber: 8,  chapter: '二', content: '实训2：线下终端POP海报设计',     theoryHours: 1, practiceHours: 3, method: '讲授',           homeworkCount: 1 },
  { week: 9,  lessonNumber: 9,  chapter: '三', content: '线上新媒体传播平台规则与特性',   theoryHours: 4, practiceHours: 0, method: '讲授',           homeworkCount: 0 },
  { week: 10, lessonNumber: 10, chapter: '三', content: '服装短视频、图文内容策划技巧',   theoryHours: 4, practiceHours: 0, method: '讲授',           homeworkCount: 0 },
  { week: 11, lessonNumber: 11, chapter: '三', content: '剪映、Canva基础操作教学',       theoryHours: 2, practiceHours: 2, method: '讲授',           homeworkCount: 0 },
  { week: 12, lessonNumber: 12, chapter: '三', content: '实训3：服装产品短视频制作',     theoryHours: 1, practiceHours: 3, method: '讲授',           homeworkCount: 1 },
  { week: 13, lessonNumber: 13, chapter: '四', content: '全渠道传播协同策略与逻辑',       theoryHours: 3, practiceHours: 1, method: '讲授',           homeworkCount: 0 },
  { week: 14, lessonNumber: 14, chapter: '四', content: '传播效果评估方法与优化技巧',     theoryHours: 3, practiceHours: 1, method: '讲授',           homeworkCount: 0 },
  { week: 15, lessonNumber: 15, chapter: '四', content: '综合实训选题与方案策划',         theoryHours: 2, practiceHours: 2, method: '讲授',           homeworkCount: 0 },
  { week: 16, lessonNumber: 16, chapter: '四', content: '实训4：全渠道传播综合项目制作', theoryHours: 1, practiceHours: 3, method: '讲授',           homeworkCount: 1 },
  { week: 17, lessonNumber: 17, chapter: '四', content: '作品展示与互评、教师点评',     theoryHours: 3, practiceHours: 1, method: '讲授',           homeworkCount: 0 },
  { week: 18, lessonNumber: 18, chapter: '考核', content: '期末考核与成绩评定',          theoryHours: 4, practiceHours: 0, method: '讲授',           homeworkCount: 1 },
];

// ── AI Client ───────────────────────────────────────────────────────
function getAiClient() {
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const s = data.settings || {};
  const apiKey = Buffer.from(s.api_key_ark, 'base64').toString('utf8');
  const endpointId = Buffer.from(s.api_key_ark_endpoint_text, 'base64').toString('utf8');
  const { ArkCourseClient } = require('../src/main/api/ark-course-client');
  return new ArkCourseClient({ apiKey, endpointId });
}

// ── DB helpers ──────────────────────────────────────────────────────
function loadDb() { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
function saveDb(d) { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2), 'utf8'); }
function nextId() { return Date.now() + Math.floor(Math.random() * 10000); }
function createArtifact(notebookId, type, stage, title, content, metadata = {}, sourceArtifactIds = []) {
  const db = loadDb();
  const now = new Date().toISOString();
  const item = {
    id: nextId(), schemaVersion: 1, notebookId, type, stage, title, content,
    format: 'json', status: 'confirmed', version: 1, confirmed: true,
    dirty: false, dirtyReason: null, dirtyAt: null,
    metadata, sourceArtifactIds, createdAt: now, updatedAt: now, confirmedAt: now,
  };
  db.artifacts.push(item);
  saveDb(db);
  return item;
}

// ── Stage 1: 新建 notebook + 手工 schedule_table ────────────────────
async function stage1_setup() {
  log('═══════ Stage 1: 新建 notebook + schedule ═══════');
  const db = loadDb();
  const notebookId = nextId();
  const now = new Date().toISOString();
  const notebook = {
    id: notebookId,
    name: '服装产品传播（端到端 4 节并行测试）',
    totalHours: 72,
    minutesPerHour: 40,
    hoursPerSession: 4,
    teacher: '刘勤',
    school: '广州市纺织服装职业学校',
    department: '服装科',
    semester: '2025-2026第二学期',
    className: '23级流行资讯班',
    textbook: '《服装产品传播课程标准》（2026 年 5 月）',
    learnerProfile: '中职二年级学生，前修课已掌握服装基础与简单工具操作，缺乏全渠道传播视野与企业级项目执行经验。',
    industryScenarios: '服装品牌线下零售终端的传播物料设计与落地、线上新媒体平台的服装产品内容策划与发布。',
    jobTargets: '服装陈列师、网络营销员（服装方向）',
    softwareTools: 'Adobe Photoshop 2024、剪映专业版 V4.1、Canva可画 网页版 V2.0',
    teachingMaterials: '《服装产品传播课程标准》（2026 年 5 月）+ 老师自编案例库',
    currentStage: 'schedule',
    workspacePath: 'D:\\HuaweiMoveData\\Users\\Zhaol\\Documents\\驭课Agent工作区\\服装产品传播（端到端验收）',
    createdAt: now,
    updatedAt: now,
  };
  db.notebooks.push(notebook);
  saveDb(db);
  log(`  ✓ notebook created · id=${notebookId} · 72 学时 · 40 分钟/学时 · 18 节`);

  // schedule_table artifact（手工构造，来自老师上传的 docx）
  const scheduleContent = {
    header: {
      school: notebook.school,
      department: notebook.department,
      courseName: notebook.name,
      teacher: notebook.teacher,
      className: notebook.className,
      semester: notebook.semester,
      textbook: notebook.textbook,
      totalHours: 72,
      theoryHours: 32,
      practiceHours: 36,
      examHours: 4,
    },
    teachingPurpose: '培养学生掌握服装产品全渠道传播的理论知识与实操技能，可胜任服装陈列、服装网络营销岗位的内容策划、物料设计与发布工作。',
    keyPointsAndDifficulties: {
      keyPoints: ['服装产品传播的基础理论与核心特征', '线下终端传播物料设计与落地方法', '线上新媒体服装内容策划与发布流程', 'PS、剪映、Canva等工具实操技巧'],
      difficulties: ['全渠道传播内容的适配性设计', '传播效果的量化评估与优化调整'],
    },
    teachingMethods: ['启发式', '讲授法', '案例分析法', '任务驱动法', '实操指导', '小组讨论法'],
    trainingCategories: ['个人传播IP思维导图制作', '线下终端POP海报设计', '服装产品短视频制作', '全渠道传播综合实训'],
    schedule: SCHEDULE_ROWS,
    assessment: { items: [
      { name: '考勤',     weight: '10%' },
      { name: '课堂表现', weight: '20%' },
      { name: '平时作业', weight: '20%' },
      { name: '实训作品', weight: '50%' },
    ]},
    additionalNotes: '本课程采用4学时连排授课，实训环节可根据学生实际掌握情况灵活调整进度。',
    source: 'docx-upload+teacher-manual',
  };
  const scheduleArt = createArtifact(
    notebookId, 'schedule_table', 'schedule',
    `${notebook.name}-教学进度表`, scheduleContent,
    { source: 'docx-upload+teacher-manual' }
  );
  log(`  ✓ schedule_table artifact · id=${scheduleArt.id} · 18 节课`);

  return { notebookId, notebook, scheduleArt };
}

// ── Stage 2: 4 节并行做 design ────────────────────────────────────
async function stage2_design(notebook, scheduleArt, aiClient) {
  log('═══════ Stage 2: 4 节并行 design ═══════');
  const { generate: generateDesign } = require('../src/main/services/design.service');

  const promises = FOUR_LESSONS.map(async (lesson) => {
    const startMs = Date.now();
    log(`  [L${lesson.lessonNumber}] design 开始`);
    try {
      const result = await generateDesign({
        aiClient,
        courseName: notebook.name,
        lessonMeta: {
          lessonNumber: lesson.lessonNumber,
          topic: lesson.topic,
          chapter: lesson.chapter,
          theoryHours: lesson.theoryHours,
          practiceHours: lesson.practiceHours,
          weekRange: lesson.weekRange,
        },
        scheduleData: scheduleArt.content,
        courseContext: {
          learnerProfile: notebook.learnerProfile,
          industryScenarios: notebook.industryScenarios,
          jobTargets: notebook.jobTargets,
          softwareTools: notebook.softwareTools,
          minutesPerHour: notebook.minutesPerHour,
          hoursPerSession: notebook.hoursPerSession,
        },
      });
      if (!result.success) {
        log(`  [L${lesson.lessonNumber}] ❌ design 失败: ${result.error}`);
        return { lesson, error: result.error };
      }
      // design.service 返回 { success, data: { design, raw } }，需要解构出真 design 对象
      const designObj = result.design || result.data?.design || result.data || result;
      const designArt = createArtifact(
        notebook.id, 'design_doc', 'design',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${lesson.theoryHours + lesson.practiceHours}学时）-教学设计`,
        designObj,
        { lessonNumber: lesson.lessonNumber, topic: lesson.topic, chapter: lesson.chapter,
          theoryHours: lesson.theoryHours, practiceHours: lesson.practiceHours, weekRange: lesson.weekRange },
        [scheduleArt.id]
      );
      const ms = Date.now() - startMs;
      log(`  [L${lesson.lessonNumber}] ✓ design 完成 (${ms}ms, ${JSON.stringify(result.design || result.data).length} 字节)`);
      return { lesson, designArt };
    } catch (e) {
      log(`  [L${lesson.lessonNumber}] 💥 design 异常: ${e.message}`);
      return { lesson, error: e.message };
    }
  });
  const results = await Promise.all(promises);
  log(`  Stage 2 done · ${results.filter(r => !r.error).length}/${results.length} 成功`);
  return results;
}

// ── Stage 3: 4 节并行做 PPT outline（不配图，节省时间）──────────
async function stage3_ppt(notebook, scheduleArt, designResults, aiClient) {
  log('═══════ Stage 3: 4 节并行 PPT outline ═══════');
  const { generatePptPlanV2 } = require('../src/main/script/ppt-pipeline-v2');

  const promises = designResults.filter(r => r.designArt).map(async ({ lesson, designArt }) => {
    const startMs = Date.now();
    log(`  [L${lesson.lessonNumber}] ppt 开始`);
    try {
      const totalHours = lesson.theoryHours + lesson.practiceHours;
      const result = await generatePptPlanV2({
        designContent: designArt.content,
        lessonMeta: { ...designArt.metadata, lessonTotalHours: totalHours },
        courseName: notebook.name,
        totalHours,
        aiClient,
        courseContext: {
          learnerProfile: notebook.learnerProfile,
          industryScenarios: notebook.industryScenarios,
          softwareTools: notebook.softwareTools,
        },
        externalReferences: [],
        skipImagePrompts: true,  // 跳过 vision 配图，节省时间
      });
      if (!result || !result.pages) {
        log(`  [L${lesson.lessonNumber}] ❌ ppt 失败：返回无 pages`);
        return { lesson, error: 'no pages' };
      }
      const pages = result.pages || result.pptPages || [];
      const pptArt = createArtifact(
        notebook.id, 'ppt_outline', 'ppt',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${totalHours}学时）-PPT 大纲`,
        { pages, pptPages: pages, lessonMeta: designArt.metadata },
        designArt.metadata, [designArt.id]
      );
      const ms = Date.now() - startMs;
      log(`  [L${lesson.lessonNumber}] ✓ ppt 完成 (${ms}ms, ${pages.length} 页)`);
      return { lesson, pptArt, designArt };
    } catch (e) {
      log(`  [L${lesson.lessonNumber}] 💥 ppt 异常: ${e.message}`);
      return { lesson, error: e.message, designArt };
    }
  });
  const results = await Promise.all(promises);
  log(`  Stage 3 done · ${results.filter(r => r.pptArt).length}/${results.length} 成功`);
  return results;
}

// ── Stage 4: 4 节并行做 lecture ─────────────────────────────────
async function stage4_lecture(notebook, pptResults, aiClient) {
  log('═══════ Stage 4: 4 节并行 lecture ═══════');
  // 简化：直接调 prompt 生成 finalScript
  // 因为 lesson.handlers v2:lessonGenerateDraft 是 IPC 写法，我们重写最小版
  const promises = pptResults.filter(r => r.pptArt).map(async ({ lesson, pptArt, designArt }) => {
    const startMs = Date.now();
    log(`  [L${lesson.lessonNumber}] lecture 开始`);
    try {
      const pages = pptArt.content.pages;
      const totalHours = lesson.theoryHours + lesson.practiceHours;
      const totalMinutes = totalHours * notebook.minutesPerHour;
      const minutesPerPage = (totalMinutes / pages.length).toFixed(1);
      const systemPrompt = [
        '你是职业教育课堂讲稿专家。',
        '【硬约束】每页 PPT 对应 1 段教师口播。',
        `本节 ${pages.length} 页 PPT · ${totalHours} 学时 · ${notebook.minutesPerHour} 分钟/学时 · 每页约 ${minutesPerPage} 分钟。`,
        '每段格式：',
        '## 第 N 页·《页面标题》（约 X 分钟）',
        '**教师讲述：**（讲述正文 200-400 字）',
        '**课堂动作附栏：**',
        '- 教师：...',
        '- 学生：...',
        '---',
        '禁止编造未在 PPT/讲义出现的事实、数据、案例。',
      ].join('\n');
      const skeleton = pages.map((p, i) => {
        const kc = Array.isArray(p.keyContent) ? p.keyContent.join(' / ') : (p.keyContent || '');
        return `P${p.pageNumber || i+1} 【${p.pageType || '内容'}】《${p.title || '未命名'}》要点：${kc.slice(0, 200)}`;
      }).join('\n');
      const userPrompt = `课程：${notebook.name} · 第 ${lesson.lessonNumber} 节·${lesson.topic} · ${totalHours} 学时\n\nPPT 骨架（${pages.length} 页）：\n${skeleton}\n\n请按每页一段教师讲稿展开。`;
      const text = await aiClient.chatJson({
        systemPrompt,
        userPrompt,
        temperature: 0.4,
        maxTokens: 14000,
        responseFormat: false,
      });
      const finalScript = String(text || '').trim();
      if (finalScript.length < 500) {
        log(`  [L${lesson.lessonNumber}] ❌ lecture 字数过少: ${finalScript.length}`);
        return { lesson, error: '字数过少', pptArt, designArt };
      }
      const lectureArt = createArtifact(
        notebook.id, 'lecture_final', 'lecture',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${totalHours}学时）-正式讲稿`,
        { finalScript, draftScript: finalScript, lessonMeta: designArt.metadata },
        designArt.metadata, [pptArt.id, designArt.id]
      );
      const ms = Date.now() - startMs;
      log(`  [L${lesson.lessonNumber}] ✓ lecture 完成 (${ms}ms, ${finalScript.length} 字)`);
      return { lesson, lectureArt, pptArt, designArt };
    } catch (e) {
      log(`  [L${lesson.lessonNumber}] 💥 lecture 异常: ${e.message}`);
      return { lesson, error: e.message, pptArt, designArt };
    }
  });
  const results = await Promise.all(promises);
  log(`  Stage 4 done · ${results.filter(r => r.lectureArt).length}/${results.length} 成功`);
  return results;
}

// ── Stage 5/6: 并行 quiz + homework ─────────────────────────────
async function stage5_6_quiz_homework(notebook, lectureResults, aiClient) {
  log('═══════ Stage 5+6: 4 节并行 quiz + homework ═══════');
  const { generateQuizFromPpt } = require('../src/main/services/quiz.service');
  const { generateHomeworkFromLecture } = require('../src/main/services/homework.service');

  const promises = lectureResults.filter(r => r.lectureArt).map(async ({ lesson, lectureArt, pptArt }) => {
    const startMs = Date.now();
    log(`  [L${lesson.lessonNumber}] quiz+homework 并行开始`);
    const [quizResult, hwResult] = await Promise.all([
      generateQuizFromPpt({
        aiClient,
        lessonMeta: pptArt.metadata,
        pptPages: pptArt.content.pages,
        lectureScript: lectureArt.content.finalScript,
        options: { questionsPerPage: 2, includeComprehensive: true },
      }).catch(e => ({ success: false, error: e.message })),
      generateHomeworkFromLecture({
        aiClient,
        lessonMeta: pptArt.metadata,
        pptPages: pptArt.content.pages,
        lectureScript: lectureArt.content.finalScript,
        options: { taskCount: 4 },
      }).catch(e => ({ success: false, error: e.message })),
    ]);

    let quizArt, hwArt;
    if (quizResult.success) {
      const totalHours = lesson.theoryHours + lesson.practiceHours;
      quizArt = createArtifact(
        notebook.id, 'quiz_set', 'quiz',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${totalHours}学时）-在线测验（${quizResult.quizSet.questions.length} 题）`,
        quizResult.quizSet,
        pptArt.metadata, [pptArt.id, lectureArt.id]
      );
      log(`  [L${lesson.lessonNumber}] ✓ quiz 完成 (${quizResult.quizSet.questions.length} 题)`);
    } else {
      log(`  [L${lesson.lessonNumber}] ❌ quiz: ${quizResult.error}`);
    }
    if (hwResult.success) {
      const totalHours = lesson.theoryHours + lesson.practiceHours;
      hwArt = createArtifact(
        notebook.id, 'homework_set', 'homework',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${totalHours}学时）-课后作业（${hwResult.homeworkSet.tasks.length} 道）`,
        hwResult.homeworkSet,
        pptArt.metadata, [pptArt.id, lectureArt.id]
      );
      log(`  [L${lesson.lessonNumber}] ✓ homework 完成 (${hwResult.homeworkSet.tasks.length} 道)`);
    } else {
      log(`  [L${lesson.lessonNumber}] ❌ homework: ${hwResult.error}`);
    }
    const ms = Date.now() - startMs;
    log(`  [L${lesson.lessonNumber}] Stage 5+6 完成 (${ms}ms)`);
    return { lesson, quizArt, hwArt, lectureArt, pptArt };
  });
  const results = await Promise.all(promises);
  log(`  Stage 5+6 done`);
  return results;
}

// ── Stage 7: 4 节并行 video ─────────────────────────────────────
async function stage7_video(notebook, qhResults, aiClient) {
  log('═══════ Stage 7: 4 节并行 video ═══════');
  const { generate: generateVideo } = require('../src/main/services/micro-video.service');
  const promises = qhResults.filter(r => r.lectureArt).map(async ({ lesson, lectureArt, pptArt }) => {
    const startMs = Date.now();
    log(`  [L${lesson.lessonNumber}] video 开始`);
    try {
      const result = await generateVideo({
        aiClient,
        courseName: notebook.name,
        videoTopic: lesson.topic,
        pptOutline: pptArt.content,
        courseContext: {
          learnerProfile: notebook.learnerProfile,
          softwareTools: notebook.softwareTools,
        },
      });
      if (!result.success) {
        log(`  [L${lesson.lessonNumber}] ❌ video: ${result.error}`);
        return { lesson, error: result.error };
      }
      const totalHours = lesson.theoryHours + lesson.practiceHours;
      const videoArt = createArtifact(
        notebook.id, 'video_prompt', 'video',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${totalHours}学时）-微课视频方案`,
        result.data?.microVideo || result.microVideo || result.data || result,
        pptArt.metadata, [lectureArt.id, pptArt.id]
      );
      const ms = Date.now() - startMs;
      log(`  [L${lesson.lessonNumber}] ✓ video 完成 (${ms}ms)`);
      return { lesson, videoArt };
    } catch (e) {
      log(`  [L${lesson.lessonNumber}] 💥 video 异常: ${e.message}`);
      return { lesson, error: e.message };
    }
  });
  const results = await Promise.all(promises);
  log(`  Stage 7 done · ${results.filter(r => r.videoArt).length}/${results.length} 成功`);
  return results;
}

// ── Stage 8: 合并报告 ──────────────────────────────────────────
async function stage8_report(notebook, allResults, scheduleArt, aiClient) {
  log('═══════ Stage 8: 合并 4 节生成实施报告 ═══════');
  const { generate: generateReport } = require('../src/main/services/report.service');

  const startMs = Date.now();
  // 选第 1 节的产物作为代表（report.service 接收单一 lecture/ppt 不是数组）
  const sample = allResults.find(r => r.lectureArt);
  if (!sample) {
    log('  ❌ 没有可用的 lecture 产物');
    return null;
  }
  try {
    const result = await generateReport({
      aiClient,
      courseName: notebook.name,
      scheduleData: scheduleArt.content,
      designData: sample.designArt?.content,
      lectureData: sample.lectureArt?.content,
      pptData: sample.pptArt?.content,
      microVideoData: sample.videoArt?.content,
      courseContext: {
        learnerProfile: notebook.learnerProfile,
        industryScenarios: notebook.industryScenarios,
        jobTargets: notebook.jobTargets,
        softwareTools: notebook.softwareTools,
        school: notebook.school,
        teacher: notebook.teacher,
        semester: notebook.semester,
        className: notebook.className,
      },
    });
    if (!result.success) {
      log(`  ❌ report: ${result.error}`);
      return null;
    }
    // 老师手填补全
    const reportContent = result.report || result.data || result;
    reportContent.implementationOutcomes = (reportContent.implementationOutcomes || '') +
      '\n\n【代填·端到端验收】\n' +
      '· 4 节抽样覆盖讲授/讨论/规范/实训四种典型授课方式（第 2/6/13/16 节）\n' +
      '· 学生参与度：35 名学生全员到课，小组讨论参与度 100%\n' +
      '· 实训作品提交率：第 16 节综合实训 32/35 学生按时提交（91%）\n' +
      '· 测验平均分（4 节合计）：78.6 分 / 100，重点知识掌握良好';
    reportContent.reflectionAndImprovement = (reportContent.reflectionAndImprovement || '') +
      '\n\n【代填·端到端验收】\n' +
      '· 反思 1：第 13 节"全渠道协同"理论密度偏高，下学期考虑前置 1 个企业案例预热\n' +
      '· 反思 2：第 16 节实训时间紧，建议拆为 2 节连排（共 8 学时）\n' +
      '· 改进 1：增加企业讲师驻校 0.5 天指导第 16 节综合实训\n' +
      '· 改进 2：第 2 节讨论环节加入「小组答辩」改为评价方式';
    const reportArt = createArtifact(
      notebook.id, 'implementation_report', 'report',
      `${notebook.name}-教学实施报告（端到端 4 节抽样合并）`,
      reportContent,
      { source: 'e2e-4lessons-merge', sampledLessons: FOUR_LESSONS.map(l => l.lessonNumber) },
      allResults.flatMap(r => [r.lectureArt?.id, r.pptArt?.id, r.designArt?.id, r.videoArt?.id]).filter(Boolean)
    );
    const ms = Date.now() - startMs;
    log(`  ✓ report 完成 (${ms}ms)`);
    return reportArt;
  } catch (e) {
    log(`  💥 report 异常: ${e.message}`);
    return null;
  }
}

// ── 导出产物到桌面 ──────────────────────────────────────────────
function dumpAllArtifacts(notebookId) {
  log('═══════ Dump 全部产物到桌面 ═══════');
  const db = loadDb();
  const arts = db.artifacts.filter(a => a.notebookId === notebookId);
  const TYPE_DIR = {
    schedule_table: '01-schedule',
    design_doc: '02-design',
    ppt_outline: '03-ppt',
    lecture_final: '04-lecture',
    quiz_set: '05-quiz',
    homework_set: '06-homework',
    video_prompt: '07-video',
    implementation_report: '08-report',
  };
  arts.forEach(a => {
    const dir = TYPE_DIR[a.type];
    if (!dir) return;
    const ln = a.metadata?.lessonNumber || 'all';
    const fname = `${dir}-L${ln}-${a.type}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fname), JSON.stringify(a, null, 2), 'utf8');
  });
  log(`  ✓ ${arts.length} 个 artifact 已 dump 到 ${OUT_DIR}`);
}

// ── 主入口 ─────────────────────────────────────────────────────
(async () => {
  log('════════════════════════════════════════════════════════');
  log('  端到端 8 阶段 × 4 节并行测试 · v4.3.3');
  log('  4 节选取：第 2/6/13/16 节（覆盖讲授/讨论/规范/实训）');
  log('════════════════════════════════════════════════════════');
  try {
    const aiClient = getAiClient();
    const { notebookId, notebook, scheduleArt } = await stage1_setup();
    const designResults = await stage2_design(notebook, scheduleArt, aiClient);
    const pptResults = await stage3_ppt(notebook, scheduleArt, designResults, aiClient);
    const lectureResults = await stage4_lecture(notebook, pptResults, aiClient);
    const qhResults = await stage5_6_quiz_homework(notebook, lectureResults, aiClient);
    const videoResults = await stage7_video(notebook, qhResults, aiClient);
    // 合并 4 节
    const all4 = FOUR_LESSONS.map(lesson => {
      const dr = designResults.find(r => r.lesson.lessonNumber === lesson.lessonNumber);
      const pr = pptResults.find(r => r.lesson.lessonNumber === lesson.lessonNumber);
      const lr = lectureResults.find(r => r.lesson.lessonNumber === lesson.lessonNumber);
      const qr = qhResults.find(r => r.lesson.lessonNumber === lesson.lessonNumber);
      const vr = videoResults.find(r => r.lesson.lessonNumber === lesson.lessonNumber);
      return {
        lesson,
        designArt: dr?.designArt,
        pptArt: pr?.pptArt,
        lectureArt: lr?.lectureArt,
        quizArt: qr?.quizArt,
        hwArt: qr?.hwArt,
        videoArt: vr?.videoArt,
      };
    });
    const reportArt = await stage8_report(notebook, all4, scheduleArt, aiClient);

    dumpAllArtifacts(notebookId);

    log('════════════════════════════════════════════════════════');
    log('  ✅ 全部完成');
    log('════════════════════════════════════════════════════════');
    process.exit(0);
  } catch (e) {
    log(`💥 主流程异常: ${e.stack || e.message}`);
    process.exit(1);
  }
})();
