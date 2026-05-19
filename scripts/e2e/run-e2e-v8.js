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
  };
  process.argv.slice(2).forEach((arg) => {
    if (arg === '--dry-run' || arg === '--mock') args.dryRun = true;
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

// ── mock AI 客户端（dry-run 时使用）────────────────────────────────────
function makeMockAiClient() {
  return {
    async chatJson({ systemPrompt, userPrompt, responseFormat }) {
      // 根据 systemPrompt 关键字猜返回类型
      const isDesign = /教学设计专家|fivePhase|preInClass/.test(systemPrompt);
      const isPpt = /PPT 大纲|pptOutline|页型/.test(systemPrompt);
      const isLecture = /讲稿|教师讲述/.test(systemPrompt);
      const isQuiz = /出题专家|sourcePageNumber/.test(systemPrompt);
      const isHomework = /作业设计专家|deliverables/.test(systemPrompt);
      const isVideo = /微课视频|jimengPrompts/.test(systemPrompt);
      const isReport = /教学实施报告/.test(systemPrompt);

      if (isQuiz) return JSON.stringify({ questions: [{ id: 'q1', sourcePageNumber: 1, type: 'single', stem: 'mock 题干', options: [{ key: 'A', text: '选项A' }, { key: 'B', text: '选项B' }], correctAnswer: 'A', explanation: 'mock 解析', difficulty: 2, knowledgePoint: 'mock' }] });
      if (isHomework) return JSON.stringify({ tasks: [{ id: 'hw1', type: 'reading', title: 'mock 作业1', description: '阅读 mock 资料', deliverables: 'mock 提交', estimatedMinutes: 90, knowledgePoints: ['mock'], evaluationCriteria: ['mock criterion 1', 'mock criterion 2', 'mock criterion 3'] }, { id: 'hw2', type: 'practice', title: 'mock 作业2', description: '练习 mock', deliverables: 'mock 报告', estimatedMinutes: 60, knowledgePoints: ['mock'], evaluationCriteria: ['mock criterion 1', 'mock criterion 2', 'mock criterion 3'] }] });
      if (isDesign) return JSON.stringify({ lessonMeta: { topic: 'mock', lessonNumber: 1 }, courseInfo: { courseName: 'mock' }, fivePhases: { preInClass: 'mock', inClassOpening: 'mock', inClassExploration: 'mock', inClassApplication: 'mock', postClass: 'mock' }, evaluation: { rules: [] } });
      if (isPpt) return JSON.stringify({ pages: [{ pageNumber: 1, pageType: '封面', title: 'mock' }] });
      if (isLecture) return '## 第 1 页·《Mock》\n**教师讲述：** mock 讲稿内容\n**课堂动作附栏：**\n- 教师：mock';
      if (isVideo) return JSON.stringify({ courseTitle: 'mock', videoTopic: 'mock', duration: 60, narrationScript: { intro: { text: 'mock', duration: 10 }, body: [{ text: 'mock', duration: 30 }], outro: { text: 'mock', duration: 10 } }, storyboard: [{ shotNumber: 1, duration: 60, type: 'content', visualDescription: 'mock', cameraAngle: '中景' }], jimengPrompts: [{ shotNumber: 1, prompt: 'mock' }], shootingGuide: { setup: 'mock' }, editingGuide: { tools: 'mock' } });
      if (isReport) return JSON.stringify({ courseName: 'mock', school: 'mock', teachingObjectives: 'mock objectives' });
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

  // v4.3.3 Codex Round 11 #1：mock E2E 扩展到 1 节完整 7 stage 闭环
  //   design → ppt → lecture → quiz → homework → video → report
  //   每 stage 跑 artifact-validator 后置检查，summary 包含 validator pass/fail
  if (ARGS.dryRun) {
    log('═══ mock 模式 · 1 节完整 7 stage 闭环 ═══');
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
            // mock 模式下 validator issue 不阻断流程，但要记录
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

    // Stage 2 design
    const { generate: generateDesign } = require('../../src/main/services/design.service');
    const design = await runStage('design', () => generateDesign({
      aiClient,
      courseName: ctx.courseName,
      lessonMeta: ctx.lessonMeta,
      notebook: ctx.notebook,
    }), null);  // design_doc validator 暂未定义，跳过

    // Stage 3 ppt：mock 模式直接构造（pipeline-v2 是个复杂 orchestrator，单元测不跑全套）
    const mockPpt = {
      pages: [
        { pageNumber: 1, pageType: '封面', title: 'Mock 封面', subtitle: 'mock', keyContent: ['核心1', '核心2'], speakerNotes: 'mock' },
        { pageNumber: 2, pageType: '知识讲解', title: 'Mock 讲解', keyContent: ['知识点'], speakerNotes: 'mock' },
      ],
    };
    fs.writeFileSync(path.join(ARGS.outDir, '03-ppt-mock.json'), JSON.stringify(mockPpt, null, 2));
    const pptArt = { type: 'ppt_outline', schemaVersion: 1, dirty: false, metadata: { lessonNumber: 1 }, content: mockPpt, sourceArtifactIds: [101] };
    const pptValid = validateArtifact(pptArt);
    log(`✓ ppt 构造 (mock) · validator ${pptValid.valid ? 'pass' : '⚠ ' + pptValid.issues.length}`);
    recordStage('ppt', 'ok', 0, { validatorValid: pptValid.valid, validatorIssues: pptValid.issues });

    // Stage 4 lecture：mock 模式构造合规讲稿
    const mockLecture = {
      finalScript: '## 第 1 页·《Mock》\n**教师讲述：** mock 讲稿内容超过 200 字。' + '好啊好啊。'.repeat(50) + '\n## 第 2 页·《Mock 2》\n**教师讲述：** 第二页。' + '好啊。'.repeat(30),
    };
    fs.writeFileSync(path.join(ARGS.outDir, '04-lecture-mock.json'), JSON.stringify(mockLecture, null, 2));
    const lectureArt = { type: 'lecture_final', schemaVersion: 1, dirty: false, metadata: { lessonNumber: 1, pptPageCount: 2 }, content: mockLecture, sourceArtifactIds: [pptArt.id || 102] };
    const lectureValid = validateArtifact(lectureArt);
    log(`✓ lecture 构造 (mock) · validator ${lectureValid.valid ? 'pass' : '⚠ ' + lectureValid.issues.length}`);
    recordStage('lecture', 'ok', 0, { validatorValid: lectureValid.valid, validatorIssues: lectureValid.issues });

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

    // Stage 7 video
    const { generate: generateVideo } = require('../../src/main/services/micro-video.service');
    const microVideo = await runStage('video', () => generateVideo({
      aiClient,
      courseName: ctx.courseName,
      videoTopic: ctx.lessonMeta.topic,
      pptOutline: mockPpt,
      courseContext: { ...ctx.notebook, lessonNumber: 1 },
    }), null);  // micro_video_plan validator 未定义（v4.3.3 type 是 video_prompt 但 validator 未覆盖）

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

    log('═══ mock 7 stage 闭环完成 ═══');
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
