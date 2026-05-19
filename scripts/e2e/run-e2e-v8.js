#!/usr/bin/env node
/**
 * run-e2e-v8.js — v4.3.3 Codex Round 10 P2.2 正式 E2E 测试驱动器
 *
 * 替代 临时的 scripts/e2e-4lessons-parallel.js + scripts/e2e-continue-stage3to8.js
 *
 * 参数化 / 可重入 / mock 模式：
 *   --db-path=<path>           DB 文件路径（默认 AppData/驭课 Agent/course-designer-data.json）
 *   --out-dir=<path>           输出目录（默认桌面 驭课-v4.2.0-端到端验收/最新时间戳）
 *   --lessons=2,6,13,16        要测的 lessonNumber（默认 2,6,13,16）
 *   --notebook-name=<name>     新建 notebook 名（默认"端到端 e2e 测试-时间戳"）
 *   --dry-run / --mock         mock 模式（不调真实 AI · 用预设响应）
 *   --skip-stage=ppt,video     跳过某些阶段（CI 用）
 *
 * 输出：
 *   <out-dir>/_e2e-summary.json   机器可读总结（每阶段耗时 + 通过/失败）
 *   <out-dir>/_progress.log        实时日志
 *   <out-dir>/<NN>-<stage>-L<N>-*.json   各 stage artifact
 *
 * 配合 P3 artifact validator 自动跑后置检查。
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── 参数解析 ───────────────────────────────────────────────────────────
function parseArgs() {
  const args = {
    dbPath: 'C:/Users/Zhaol/AppData/Roaming/驭课 Agent/course-designer-data.json',
    outDir: '',
    lessons: [2, 6, 13, 16],
    notebookName: '',
    dryRun: false,
    skipStages: [],
    // v4.3.3 Codex Round 13 P1.2：validator 失败默认计入 errors（让退出码 ≠ 0），
    // 可用 --allow-validator-warnings 退回旧行为（只记录不阻断）
    allowValidatorWarnings: false,
  };
  process.argv.slice(2).forEach((arg) => {
    if (arg === '--dry-run' || arg === '--mock') args.dryRun = true;
    else if (arg === '--allow-validator-warnings') args.allowValidatorWarnings = true;
    else if (arg.startsWith('--db-path=')) args.dbPath = arg.split('=')[1];
    else if (arg.startsWith('--out-dir=')) args.outDir = arg.split('=')[1];
    else if (arg.startsWith('--lessons=')) args.lessons = arg.split('=')[1].split(',').map((s) => Number(s.trim())).filter(Boolean);
    else if (arg.startsWith('--notebook-name=')) args.notebookName = arg.split('=')[1];
    else if (arg.startsWith('--skip-stage=')) args.skipStages = arg.split('=')[1].split(',');
  });
  if (!args.outDir) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    args.outDir = `C:/Users/Zhaol/Desktop/驭课-v4.2.0-端到端验收/e2e-${ts}`;
  }
  if (!args.notebookName) {
    args.notebookName = `端到端 e2e 测试-${new Date().toISOString().slice(0, 10)}`;
  }
  return args;
}

const ARGS = parseArgs();

// ── 日志 ────────────────────────────────────────────────────────────────
fs.mkdirSync(ARGS.outDir, { recursive: true });
const logPath = path.join(ARGS.outDir, '_progress.log');
fs.writeFileSync(logPath, '', 'utf8');
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
  fs.appendFileSync(logPath, line);
  process.stdout.write(line);
}

log('═══════ e2e-v8 启动 ═══════');
log('DB:', ARGS.dbPath);
log('OUT:', ARGS.outDir);
log('LESSONS:', ARGS.lessons.join(','));
log('MOCK:', ARGS.dryRun ? 'YES' : 'NO');
log('SKIP:', ARGS.skipStages.join(',') || '(none)');
log('VALIDATOR-FAIL-MODE:', ARGS.allowValidatorWarnings ? 'warnings-only' : 'strict（默认 · 校验失败计入 errors）');

// ── mock AI 客户端（dry-run 时使用）────────────────────────────────────
function makeMockAiClient() {
  return {
    async chatJson({ systemPrompt, userPrompt, responseFormat }) {
      // v4.3.3 Codex Round 13：detection 顺序按"独特关键字"先行，避免 video/report 提示词
      // 含"PPT 大纲""教师讲述"等被 isPpt/isLecture 误捕。微课视频 prompt 必含"微课视频策划专家"。
      const isVideo = /微课视频策划专家|jimengPrompts|分镜表|即梦提示词/.test(systemPrompt);
      const isReport = /教学实施报告/.test(systemPrompt);
      const isQuiz = /出题专家|sourcePageNumber/.test(systemPrompt);
      const isHomework = /作业设计专家|deliverables/.test(systemPrompt);
      const isDesign = /教学设计专家|fivePhase|preInClass/.test(systemPrompt);
      const isPpt = /PPT 大纲生成|pptOutline|页型/.test(systemPrompt);
      // isLecture 放最后兜底（避免抢走 video / report 中含"教师讲述"的提示词）
      const isLecture = /讲稿|教师讲述/.test(systemPrompt);

      if (isVideo) return JSON.stringify({
        courseTitle: 'mock', videoTopic: 'mock', duration: 60,
        narrationScript: { intro: { text: 'mock intro', duration: 10 }, body: [{ section: '核心', narration: 'mock body', duration: 40 }], outro: { text: 'mock outro', duration: 10 } },
        storyboard: [
          { shotNumber: 1, duration: 10, type: 'intro', visualDescription: '开场主讲教师镜头', cameraAngle: '中景' },
          { shotNumber: 2, duration: 40, type: 'content', visualDescription: '主体讲解配合 PPT 切镜', cameraAngle: '近景' },
          { shotNumber: 3, duration: 10, type: 'outro', visualDescription: '收尾画面与配音', cameraAngle: '中景' },
        ],
        jimengPrompts: [
          { shotNumber: 1, prompt: 'mock 即梦提示词 1' },
          { shotNumber: 2, prompt: 'mock 即梦提示词 2' },
          { shotNumber: 3, prompt: 'mock 即梦提示词 3' },
        ],
        shootingGuide: { setup: 'mock' }, editingGuide: { tools: 'mock' },
      });
      if (isReport) return JSON.stringify({ courseName: 'mock', school: 'mock', teachingObjectives: 'mock objectives' });
      if (isQuiz) return JSON.stringify({ questions: [{ id: 'q1', sourcePageNumber: 1, type: 'single', stem: 'mock 题干', options: [{ key: 'A', text: '选项A' }, { key: 'B', text: '选项B' }], correctAnswer: 'A', explanation: 'mock 解析', difficulty: 2, knowledgePoint: 'mock' }] });
      if (isHomework) return JSON.stringify({ tasks: [{ id: 'hw1', type: 'reading', title: 'mock 作业1', description: '阅读 mock 资料', deliverables: 'mock 提交', estimatedMinutes: 90, knowledgePoints: ['mock'], evaluationCriteria: ['mock criterion 1', 'mock criterion 2', 'mock criterion 3'] }, { id: 'hw2', type: 'practice', title: 'mock 作业2', description: '练习 mock', deliverables: 'mock 报告', estimatedMinutes: 60, knowledgePoints: ['mock'], evaluationCriteria: ['mock criterion 1', 'mock criterion 2', 'mock criterion 3'] }] });
      if (isDesign) return JSON.stringify({ lessonMeta: { topic: 'mock', lessonNumber: 1 }, courseInfo: { courseName: 'mock' }, fivePhases: { preInClass: 'mock', inClassOpening: 'mock', inClassExploration: 'mock', inClassApplication: 'mock', postClass: 'mock' }, evaluation: { rules: [] } });
      if (isPpt) return JSON.stringify({ pages: [{ pageNumber: 1, pageType: '封面', title: 'mock' }] });
      if (isLecture) return '## 第 1 页·《Mock》\n**教师讲述：** mock 讲稿内容\n**课堂动作附栏：**\n- 教师：mock';
      return '{}';
    },
    async chatVision() { return 'mock vision'; },
  };
}

// ── 主流程 ────────────────────────────────────────────────────────────
const SUMMARY = {
  startedAt: new Date().toISOString(),
  args: ARGS,
  stages: {},
  errors: [],
};

function recordStage(name, status, durationMs, extra = {}) {
  SUMMARY.stages[name] = { status, durationMs, ...extra };
}

(async () => {
  // 这是个最小可行版 driver。完整 stage 1-8 实现保留在 临时脚本里。
  // 本文件主要提供：
  //   - 标准化参数解析
  //   - 标准化输出结构 + machine-readable summary
  //   - mock AI 客户端（CI 跑得通）
  //   - 配合 P3 validator 做后置检查

  // v4.3.3 Codex Round 13 P1.1：mock E2E 扩展到完整 8 stage 闭环
  //   schedule → design → ppt → lecture → quiz → homework → video → report
  //   每 stage 跑 artifact-validator 后置检查；validator 失败默认计入 errors（strict）
  if (ARGS.dryRun) {
    log('═══ mock 模式 · 1 节完整 8 stage 闭环（schedule→design→ppt→lecture→quiz→homework→video→report）═══');
    const aiClient = makeMockAiClient();
    const { validateArtifact } = require('../../src/main/services/artifact-validator.service');

    const ctx = {
      courseName: 'mock 课程',
      notebook: { minutesPerHour: 40, school: 'mock 学校', teacher: 'mock 老师', industryScenarios: 'mock 行业' },
      lessonMeta: { topic: 'mock 节', theoryHours: 2, practiceHours: 2, lessonNumber: 1, chapter: '一', weekRange: '第 1 周' },
    };

    // 通用 wrapper：跑一个 stage + 计时 + 提取 product + validator 后置
    async function runStage(name, fn, validatorType) {
      if (ARGS.skipStages.includes(name)) {
        log(`⏭ ${name} 跳过`);
        recordStage(name, 'skipped', 0);
        return null;
      }
      const start = Date.now();
      try {
        const result = await fn();
        const dur = Date.now() - start;
        if (!result?.success) {
          log(`❌ ${name} 失败 (${dur}ms):`, result?.error);
          SUMMARY.errors.push({ stage: name, error: result?.error || 'unknown' });
          recordStage(name, 'failed', dur, { error: result?.error });
          return null;
        }
        // 取主路径 data.product；回退 legacy alias
        const product = result.data?.product || result.data?.design || result.data?.report
                     || result.data?.microVideo || result.quizSet || result.homeworkSet;
        log(`✓ ${name} 成功 (${dur}ms)`);
        // 构造 fake artifact 跑 validator（mock 模式不写库）
        let validatorResult = null;
        if (validatorType) {
          const fakeArtifact = {
            type: validatorType,
            schemaVersion: 1,
            dirty: false,
            metadata: { lessonNumber: 1, theoryHours: 2, practiceHours: 2 },
            content: product,
            sourceArtifactIds: validatorType === 'implementation_report' ? [101, 102] : [101],
          };
          validatorResult = validateArtifact(fakeArtifact);
          if (validatorResult.valid) {
            log(`  ✓ validator pass (${name})`);
          } else {
            log(`  ⚠ validator issues: ${validatorResult.issues.slice(0, 3).join(' | ')}`);
            // v4.3.3 Codex Round 13 P1.2：默认 strict 模式·validator 失败计入 SUMMARY.errors
            // 允许 --allow-validator-warnings 退回旧行为（只记录不阻断）
            if (!ARGS.allowValidatorWarnings) {
              SUMMARY.errors.push({
                stage: name,
                kind: 'validator',
                error: `artifact validator 失败（${validatorResult.issues.length} 条）: ${validatorResult.issues.join(' | ')}`,
              });
            }
          }
        }
        recordStage(name, 'ok', dur, { validatorValid: validatorResult?.valid, validatorIssues: validatorResult?.issues || [] });
        return product;
      } catch (e) {
        const dur = Date.now() - start;
        log(`💥 ${name} 异常 (${dur}ms):`, e.message);
        SUMMARY.errors.push({ stage: name, error: e.message });
        recordStage(name, 'exception', dur, { error: e.message });
        return null;
      }
    }

    // v4.3.3 Codex Round 14 P1.3：手工构造 stage（schedule/ppt/lecture）也走 strict 失败路径
    //   validator 失败时计入 SUMMARY.errors（除非 --allow-validator-warnings），让进程退出码 ≠ 0
    function runMockStage(name, artifactType, artifact, metaExtra = {}) {
      let validatorResult = null;
      if (artifactType) {
        validatorResult = validateArtifact(artifact);
        if (validatorResult.valid) {
          log(`✓ ${name} 构造 (mock) · validator pass`);
        } else {
          log(`✓ ${name} 构造 (mock) · ⚠ validator issues: ${validatorResult.issues.slice(0, 3).join(' | ')}`);
          if (!ARGS.allowValidatorWarnings) {
            SUMMARY.errors.push({
              stage: name,
              kind: 'validator',
              error: `artifact validator 失败（${validatorResult.issues.length} 条）: ${validatorResult.issues.join(' | ')}`,
            });
          }
        }
      } else {
        log(`✓ ${name} 构造 (mock)`);
      }
      recordStage(name, 'ok', 0, {
        ...metaExtra,
        validatorValid: validatorResult?.valid,
        validatorIssues: validatorResult?.issues || [],
      });
    }

    // Stage 1 schedule（教学进度表）：老师上传 Word 解析后的产物，mock 模式直接构造
    //   v4.3.3 Codex Round 14 P2.1：schedule_table validator 已注册，本步走 strict 路径
    const mockSchedule = {
      header: { totalHours: 4, theoryHours: 2, practiceHours: 2, school: 'mock 学校' },
      schedule: [
        { week: 1, session: 1, content: '第 1 节内容', hours: 2, chapter: '一' },
        { week: 2, session: 2, content: '第 2 节内容', hours: 2, chapter: '一' },
      ],
    };
    fs.writeFileSync(path.join(ARGS.outDir, '01-schedule-mock.json'), JSON.stringify(mockSchedule, null, 2));
    const scheduleArt = { type: 'schedule_table', schemaVersion: 1, dirty: false, metadata: { lessonNumber: 1 }, content: mockSchedule };
    runMockStage('schedule', 'schedule_table', scheduleArt, { weeks: 2, lessonsLoaded: 2 });

    // Stage 2 design
    const { generate: generateDesign } = require('../../src/main/services/design.service');
    const design = await runStage('design', () => generateDesign({
      aiClient,
      courseName: ctx.courseName,
      lessonMeta: ctx.lessonMeta,
      notebook: ctx.notebook,
    }), null);  // design_doc validator 暂未定义，跳过

    // Stage 3 ppt：mock 模式直接构造（pipeline-v2 是个复杂 orchestrator，单元测不跑全套）
    // v4.3.3 Codex Round 14 P1.3：走 strict 失败路径（validator 失败计入 errors）
    const mockPpt = {
      pages: [
        { pageNumber: 1, pageType: '封面', title: 'Mock 封面', subtitle: 'mock', keyContent: ['核心1', '核心2'], speakerNotes: 'mock' },
        { pageNumber: 2, pageType: '知识讲解', title: 'Mock 讲解', keyContent: ['知识点'], speakerNotes: 'mock' },
      ],
    };
    fs.writeFileSync(path.join(ARGS.outDir, '03-ppt-mock.json'), JSON.stringify(mockPpt, null, 2));
    const pptArt = { type: 'ppt_outline', schemaVersion: 1, dirty: false, metadata: { lessonNumber: 1 }, content: mockPpt, sourceArtifactIds: [101] };
    runMockStage('ppt', 'ppt_outline', pptArt);

    // Stage 4 lecture：mock 模式构造合规讲稿
    // v4.3.3 Codex Round 14 P1.3：走 strict 失败路径
    const mockLecture = {
      finalScript: '## 第 1 页·《Mock》\n**教师讲述：** mock 讲稿内容超过 200 字。' + '好啊好啊。'.repeat(50) + '\n## 第 2 页·《Mock 2》\n**教师讲述：** 第二页。' + '好啊。'.repeat(30),
    };
    fs.writeFileSync(path.join(ARGS.outDir, '04-lecture-mock.json'), JSON.stringify(mockLecture, null, 2));
    const lectureArt = { type: 'lecture_final', schemaVersion: 1, dirty: false, metadata: { lessonNumber: 1, pptPageCount: 2 }, content: mockLecture, sourceArtifactIds: [pptArt.id || 102] };
    runMockStage('lecture', 'lecture_final', lectureArt);

    // Stage 5 quiz
    const { generateQuizFromPpt } = require('../../src/main/services/quiz.service');
    const quizSet = await runStage('quiz', () => generateQuizFromPpt({
      aiClient,
      lessonMeta: ctx.lessonMeta,
      pptPages: mockPpt.pages,
      lectureScript: mockLecture.finalScript,
    }), 'quiz_set');

    // Stage 6 homework
    const { generateHomeworkFromLecture } = require('../../src/main/services/homework.service');
    const homeworkSet = await runStage('homework', () => generateHomeworkFromLecture({
      aiClient,
      lessonMeta: ctx.lessonMeta,
      pptPages: mockPpt.pages,
      lectureScript: mockLecture.finalScript,
    }), 'homework_set');

    // Stage 7 video（v4.3.3 Codex Round 13 P1.3：接入 video_prompt validator）
    const { generate: generateVideo } = require('../../src/main/services/micro-video.service');
    const microVideo = await runStage('video', () => generateVideo({
      aiClient,
      courseName: ctx.courseName,
      videoTopic: ctx.lessonMeta.topic,
      pptOutline: mockPpt,
      courseContext: { ...ctx.notebook, lessonNumber: 1 },
    }), 'video_prompt');

    // Stage 8 report
    const { generate: generateReport } = require('../../src/main/services/report.service');
    await runStage('report', () => generateReport({
      aiClient,
      courseName: ctx.courseName,
      designData: design,
      pptData: mockPpt,
      lectureData: mockLecture,
      microVideoData: microVideo,
      courseContext: ctx.notebook,
    }), 'implementation_report');

    log('═══ mock 8 stage 闭环完成（schedule→design→ppt→lecture→quiz→homework→video→report）═══');
  } else {
    log('⚠ 真实 AI 模式：本 driver 暂只实现 mock 验证脚手架');
    log('   完整真实跑请用 scripts/e2e/e2e-4lessons-parallel-real.js（v4.3.3 Round 10 归档）');
    recordStage('e2e', 'real-ai-pending', 0, { note: '完整真实 e2e 见 scripts/e2e/e2e-4lessons-parallel-real.js' });
  }

  SUMMARY.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(ARGS.outDir, '_e2e-summary.json'), JSON.stringify(SUMMARY, null, 2));
  log('═══════ 完成 · summary 见 _e2e-summary.json ═══════');
  process.exit(SUMMARY.errors.length > 0 ? 1 : 0);
})().catch((e) => {
  log('💥 异常:', e.message);
  log(e.stack);
  process.exit(2);
});
