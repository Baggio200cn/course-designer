/**
 * e2e-continue-stage3to8.js — 接续运行 stage 3-8（复用已生成的 design）
 */

'use strict';
const fs = require('fs');
const path = require('path');

const DB_PATH = 'C:/Users/Zhaol/AppData/Roaming/驭课 Agent/course-designer-data.json';
const OUT_DIR = 'C:/Users/Zhaol/Desktop/驭课-v4.2.0-端到端验收/2026-05-19-全新-4节并行';
const PROGRESS_LOG = path.join(OUT_DIR, '_progress.log');
const TARGET_NB = 1779151074992;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(PROGRESS_LOG, line + '\n');
}
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

function getAiClient() {
  const data = loadDb();
  const s = data.settings || {};
  const apiKey = Buffer.from(s.api_key_ark, 'base64').toString('utf8');
  const endpointId = Buffer.from(s.api_key_ark_endpoint_text, 'base64').toString('utf8');
  const { ArkCourseClient } = require('../src/main/api/ark-course-client');
  return new ArkCourseClient({ apiKey, endpointId });
}

const FOUR_LESSONS = [
  { lessonNumber: 2,  chapter: '一', topic: '服装产品传播的起源与发展历程',     theoryHours: 3, practiceHours: 1, method: '讲授+小组讨论法', weekRange: '第 2 周' },
  { lessonNumber: 6,  chapter: '二', topic: 'POP海报、陈列道具设计规范',         theoryHours: 3, practiceHours: 1, method: '讲授',           weekRange: '第 6 周' },
  { lessonNumber: 13, chapter: '四', topic: '全渠道传播协同策略与逻辑',          theoryHours: 3, practiceHours: 1, method: '讲授',           weekRange: '第 13 周' },
  { lessonNumber: 16, chapter: '四', topic: '实训4：全渠道传播综合项目制作',     theoryHours: 1, practiceHours: 3, method: '讲授',           weekRange: '第 16 周' },
];

(async () => {
  const aiClient = getAiClient();
  const db = loadDb();
  const notebook = db.notebooks.find(n => n.id === TARGET_NB);
  const scheduleArt = db.artifacts.find(a => a.notebookId === TARGET_NB && a.type === 'schedule_table');

  // 加载已有 designs
  const designResults = FOUR_LESSONS.map(lesson => {
    const designArt = db.artifacts.find(a =>
      a.notebookId === TARGET_NB && a.type === 'design_doc' &&
      Number(a.metadata?.lessonNumber) === lesson.lessonNumber
    );
    return { lesson, designArt };
  });
  log(`复用已有 design: ${designResults.filter(r => r.designArt).length}/4`);

  // Stage 3: PPT 4 节并行
  log('═══════ Stage 3: 4 节并行 PPT outline ═══════');
  const { generatePptPlanV2 } = require('../src/main/script/ppt-pipeline-v2');
  const pptResults = await Promise.all(designResults.filter(r => r.designArt).map(async ({ lesson, designArt }) => {
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
          minutesPerHour: notebook.minutesPerHour,
        },
        externalReferences: [],
        skipImagePrompts: true,
      });
      const pages = result.pages || result.pptPages || [];
      if (pages.length === 0) {
        log(`  [L${lesson.lessonNumber}] ❌ ppt 无 pages`);
        return { lesson, error: 'no pages', designArt };
      }
      const pptArt = createArtifact(
        notebook.id, 'ppt_outline', 'ppt',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${totalHours}学时）-PPT 大纲`,
        { pages, pptPages: pages, lessonMeta: designArt.metadata },
        designArt.metadata, [designArt.id]
      );
      log(`  [L${lesson.lessonNumber}] ✓ ppt 完成 (${Date.now()-startMs}ms, ${pages.length} 页)`);
      return { lesson, pptArt, designArt };
    } catch (e) {
      log(`  [L${lesson.lessonNumber}] 💥 ppt: ${e.message}`);
      return { lesson, error: e.message, designArt };
    }
  }));
  log(`Stage 3 done · ${pptResults.filter(r => r.pptArt).length}/4`);

  // Stage 4: lecture 4 节并行
  log('═══════ Stage 4: 4 节并行 lecture ═══════');
  const lectureResults = await Promise.all(pptResults.filter(r => r.pptArt).map(async ({ lesson, pptArt, designArt }) => {
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
        systemPrompt, userPrompt, temperature: 0.4, maxTokens: 14000, responseFormat: false,
      });
      const finalScript = String(text || '').trim();
      if (finalScript.length < 500) {
        log(`  [L${lesson.lessonNumber}] ❌ lecture 字数: ${finalScript.length}`);
        return { lesson, error: 'short', pptArt, designArt };
      }
      const lectureArt = createArtifact(
        notebook.id, 'lecture_final', 'lecture',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${totalHours}学时）-正式讲稿`,
        { finalScript, draftScript: finalScript, lessonMeta: designArt.metadata },
        designArt.metadata, [pptArt.id, designArt.id]
      );
      log(`  [L${lesson.lessonNumber}] ✓ lecture 完成 (${Date.now()-startMs}ms, ${finalScript.length} 字)`);
      return { lesson, lectureArt, pptArt, designArt };
    } catch (e) {
      log(`  [L${lesson.lessonNumber}] 💥 lecture: ${e.message}`);
      return { lesson, error: e.message, pptArt, designArt };
    }
  }));
  log(`Stage 4 done · ${lectureResults.filter(r => r.lectureArt).length}/4`);

  // Stage 5+6: quiz + homework 并行
  log('═══════ Stage 5+6: 4 节并行 quiz + homework ═══════');
  const { generateQuizFromPpt } = require('../src/main/services/quiz.service');
  const { generateHomeworkFromLecture } = require('../src/main/services/homework.service');
  const qhResults = await Promise.all(lectureResults.filter(r => r.lectureArt).map(async ({ lesson, lectureArt, pptArt, designArt }) => {
    const startMs = Date.now();
    log(`  [L${lesson.lessonNumber}] quiz+homework 并行开始`);
    const [quizRes, hwRes] = await Promise.all([
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
    const totalHours = lesson.theoryHours + lesson.practiceHours;
    if (quizRes.success) {
      quizArt = createArtifact(
        notebook.id, 'quiz_set', 'quiz',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${totalHours}学时）-在线测验（${quizRes.quizSet.questions.length} 题）`,
        quizRes.quizSet, pptArt.metadata, [pptArt.id, lectureArt.id]
      );
      log(`  [L${lesson.lessonNumber}] ✓ quiz ${quizRes.quizSet.questions.length} 题`);
    } else log(`  [L${lesson.lessonNumber}] ❌ quiz: ${quizRes.error}`);
    if (hwRes.success) {
      hwArt = createArtifact(
        notebook.id, 'homework_set', 'homework',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${totalHours}学时）-课后作业（${hwRes.homeworkSet.tasks.length} 道）`,
        hwRes.homeworkSet, pptArt.metadata, [pptArt.id, lectureArt.id]
      );
      log(`  [L${lesson.lessonNumber}] ✓ homework ${hwRes.homeworkSet.tasks.length} 道`);
    } else log(`  [L${lesson.lessonNumber}] ❌ homework: ${hwRes.error}`);
    log(`  [L${lesson.lessonNumber}] Stage 5+6 完成 (${Date.now()-startMs}ms)`);
    return { lesson, quizArt, hwArt, lectureArt, pptArt, designArt };
  }));

  // Stage 7: video 4 节并行
  log('═══════ Stage 7: 4 节并行 video ═══════');
  const { generate: generateVideo } = require('../src/main/services/micro-video.service');
  const videoResults = await Promise.all(qhResults.filter(r => r.lectureArt).map(async ({ lesson, lectureArt, pptArt, designArt }) => {
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
          minutesPerHour: notebook.minutesPerHour,
        },
      });
      if (!result.success) { log(`  [L${lesson.lessonNumber}] ❌ video: ${result.error}`); return { lesson, error: result.error }; }
      const totalHours = lesson.theoryHours + lesson.practiceHours;
      const videoObj = result.microVideo || result.data?.microVideo || result.data || result;
      const videoArt = createArtifact(
        notebook.id, 'video_prompt', 'video',
        `第 ${lesson.lessonNumber} 节·${lesson.topic}（${totalHours}学时）-微课视频方案`,
        videoObj, pptArt.metadata, [lectureArt.id, pptArt.id]
      );
      log(`  [L${lesson.lessonNumber}] ✓ video (${Date.now()-startMs}ms)`);
      return { lesson, videoArt };
    } catch (e) {
      log(`  [L${lesson.lessonNumber}] 💥 video: ${e.message}`);
      return { lesson, error: e.message };
    }
  }));
  log(`Stage 7 done · ${videoResults.filter(r => r.videoArt).length}/4`);

  // Stage 8: 合并报告
  log('═══════ Stage 8: 合并 4 节生成实施报告 ═══════');
  const { generate: generateReport } = require('../src/main/services/report.service');
  const allByLesson = FOUR_LESSONS.map(l => {
    const r = qhResults.find(x => x.lesson.lessonNumber === l.lessonNumber) || {};
    const vr = videoResults.find(x => x.lesson.lessonNumber === l.lessonNumber) || {};
    return { lesson: l, ...r, videoArt: vr.videoArt };
  });
  const sample = allByLesson.find(r => r.lectureArt) || {};
  try {
    const startMs = Date.now();
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
        school: notebook.school, teacher: notebook.teacher,
        semester: notebook.semester, className: notebook.className,
        minutesPerHour: notebook.minutesPerHour,
      },
    });
    if (!result.success) { log(`❌ report: ${result.error}`); }
    else {
      const reportContent = result.report || result.data?.report || result.data || result;
      reportContent.implementationOutcomes = (reportContent.implementationOutcomes || '') +
        '\n\n【代填·端到端验收】\n' +
        '· 4 节抽样覆盖讲授/讨论/规范/实训四种典型授课方式（第 2/6/13/16 节）\n' +
        '· 学生参与度：35 名学生全员到课，小组讨论参与度 100%\n' +
        '· 实训作品提交率：第 16 节综合实训 32/35 学生按时提交（91%）\n' +
        '· 测验平均分（4 节合计）：78.6 分 / 100';
      reportContent.reflectionAndImprovement = (reportContent.reflectionAndImprovement || '') +
        '\n\n【代填·端到端验收】\n' +
        '· 反思 1：第 13 节"全渠道协同"理论密度偏高，下学期前置 1 个企业案例预热\n' +
        '· 反思 2：第 16 节实训时间紧，建议拆为 2 节连排（共 8 学时）\n' +
        '· 改进 1：增加企业讲师驻校 0.5 天指导第 16 节综合实训\n' +
        '· 改进 2：第 2 节讨论环节加入「小组答辩」改为评价方式';
      const reportArt = createArtifact(
        notebook.id, 'implementation_report', 'report',
        `${notebook.name}-教学实施报告（端到端 4 节抽样合并）`,
        reportContent,
        { source: 'e2e-4lessons-merge', sampledLessons: FOUR_LESSONS.map(l => l.lessonNumber) },
        allByLesson.flatMap(r => [r.lectureArt?.id, r.pptArt?.id, r.designArt?.id, r.videoArt?.id, r.quizArt?.id, r.hwArt?.id]).filter(Boolean)
      );
      log(`✓ report (${Date.now()-startMs}ms · id=${reportArt.id})`);
    }
  } catch (e) { log(`💥 report: ${e.message}`); }

  // Dump 全部
  log('═══════ Dump 全部产物到桌面 ═══════');
  const fdb = loadDb();
  const arts = fdb.artifacts.filter(a => a.notebookId === TARGET_NB);
  const TYPE_DIR = {
    schedule_table: '01-schedule', design_doc: '02-design', ppt_outline: '03-ppt',
    lecture_final: '04-lecture', quiz_set: '05-quiz', homework_set: '06-homework',
    video_prompt: '07-video', implementation_report: '08-report',
  };
  arts.forEach(a => {
    const dir = TYPE_DIR[a.type];
    if (!dir) return;
    const ln = a.metadata?.lessonNumber || 'all';
    const fname = `${dir}-L${ln}-${a.type}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fname), JSON.stringify(a, null, 2), 'utf8');
  });
  log(`✓ ${arts.length} 个 artifact 已 dump`);
  log('════════════════════════════════════════');
  log('  ✅ 全部完成');
  log('════════════════════════════════════════');
  process.exit(0);
})().catch(e => { log(`💥 主流程: ${e.stack || e.message}`); process.exit(1); });
