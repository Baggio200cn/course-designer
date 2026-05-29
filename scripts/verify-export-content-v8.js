/**
 * verify-export-content-v8.js — 导出物级验证（v4.3.3 Round 19 · 2026-05-20）
 *
 * 解决问题：schema 守卫只能挡"错字段名"，不能保证最终 docx 里**关键内容真的存在**。
 *   codex 反馈：「assertReportSchema 只要求三选一存在，不能保证报告内容完整」
 *               「micro-video-word.js 受众/剪辑节奏读错字段，老师填的内容落不到 Word 里」
 *
 * 本脚本做"真实导出 → 反解包 → 正文断言"端到端验证：
 *   ① 构造 minimum-viable 正确 schema 的 artifact
 *   ② 调用真实导出函数生成 .docx 到临时目录
 *   ③ 用 jszip 解包 word/document.xml，提取所有 <w:t> 文本
 *   ④ 断言"关键字段值"必须出现在正文里（而不是落空/[object Object]/默认 fallback）
 *
 * 覆盖：
 *   - schedule-word.js
 *   - report-export.js（exportReportWord）
 *   - micro-video-word.js
 *
 * 验证 verify:gate 串联：package.json 已加 `node scripts/verify-export-content-v8.js`
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { pass += 1; console.log(`  ✓ ${name}`); })
    .catch((err) => {
      fail += 1;
      failures.push({ name, error: err.message });
      console.log(`  ✗ ${name}\n    ${err.message}`);
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const TMP_DIR = path.join(os.tmpdir(), `yuke-export-verify-${Date.now()}`);
fs.mkdirSync(TMP_DIR, { recursive: true });

// ── 工具：解 docx 提取正文 ─────────────────────────────────────────────────
async function readDocxText(docxPath) {
  const buf = fs.readFileSync(docxPath);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file('word/document.xml').async('string');
  // 提取所有 <w:t ...>text</w:t> 内容，按文档顺序拼接
  const matches = docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
  return matches.map((m) => m.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, '')).join(' ');
}

function assertContains(text, needle, label) {
  assert(text.includes(needle), `导出 docx 正文缺关键字段 ${label || ''}："${needle}"（前 200 字：${text.slice(0, 200)}…）`);
}

function assertNotContains(text, needle, label) {
  assert(!text.includes(needle), `导出 docx 正文不应含 ${label || ''}："${needle}"`);
}

// ── 测试主体 ──────────────────────────────────────────────────────────────
async function main() {
  console.log('═══ verify-export-content-v8 · 导出物级正文断言 ═══');
  console.log('TMP_DIR:', TMP_DIR);

  // ───────── 1. schedule-word.js ─────────
  console.log('\n【1】schedule-word.js 导出正文断言');

  await test('schedule docx 正文含课程名/教师/进度表行内容', async () => {
    const { exportScheduleWord } = require('../src/main/export/schedule-word');
    const schedule = {
      header: {
        courseName: '服装产品传播', teacher: '巴老师', school: '广州纺校',
        semester: '2026 春', totalHours: 4, theoryHours: 2, practiceHours: 2,
      },
      schedule: [
        { week: 1, session: 1, content: '导入新课·POP 海报案例', hours: 2, homework: 0, method: '讲授+案例' },
        { week: 1, session: 2, content: '实操练习·POP 设计', hours: 2, homework: 1, method: '实训' },
      ],
      evaluation: { rules: ['过程性 30%', '终结性 70%'] },
    };
    const out = path.join(TMP_DIR, 'schedule.docx');
    await exportScheduleWord({ schedule, outputPath: out });
    assert(fs.existsSync(out), 'docx 未生成');
    const text = await readDocxText(out);
    assertContains(text, '服装产品传播', '课程名');
    assertContains(text, '导入新课', '进度表第 1 行内容');
    assertContains(text, '实操练习', '进度表第 2 行内容');
    assertContains(text, '讲授+案例', '授课方式');
    // 关键字段未落空
    assertNotContains(text, '[object Object]', '对象误 toString');
  });

  await test('schedule docx · 老字段 rows + lessonNumber 抛 schema 错（不生成空 docx）', async () => {
    const { exportScheduleWord } = require('../src/main/export/schedule-word');
    let threw = false;
    try {
      await exportScheduleWord({
        schedule: { rows: [{ lessonNumber: 1, theoryHours: 2, homeworkCount: 1 }] },
        outputPath: path.join(TMP_DIR, 'schedule-bad.docx'),
      });
    } catch (e) {
      threw = /schedule\.rows|lessonNumber|Bug #1/.test(e.message);
    }
    assert(threw, 'schedule schema 守卫未拦住老字段名（应抛错而不是静默生成）');
  });

  // ───────── 2. report-export.js ─────────
  console.log('\n【2】report-export.js exportReportWord 正文断言');

  await test('report docx 正文含 5 类实施成效 + 4 类反思 + 5 段课中流程', async () => {
    const { exportReportWord } = require('../src/main/export/report-export');
    const report = {
      courseName: '服装产品传播',
      school: '广州纺校', teacher: '巴老师',
      teachingObjectives: { knowledge: ['认识 POP 设计原理'], skill: ['掌握布局方法'], emotion: ['理解传播责任'] },
      implementationOutcomes: {
        studentEngagement: { achieved: '到课率 95%', evidence: '点名记录' },
        workCompletion: { achieved: '作品全交', evidence: '提交统计' },
        skillTransfer: { achieved: '能独立设计', evidence: '作品评分' },
        industryAlignment: { achieved: '对标行业标准', evidence: '企业反馈' },
        ideologicalImpact: { achieved: '文化自信增强', evidence: '课后访谈' },
      },
      reflectionAndImprovement: {
        achievements: ['案例驱动效果好'],
        issues: ['软件熟练度参差'],
        improvements: ['增加预热环节'],
        futurePlans: ['引入新案例'],
      },
      // service.normalizeReport 真实 schema：preClass.{tasks[],outcome} + inClassPhases[] + postClass.{homework[],feedback}
      preInClassPostFlow: {
        preClass: { tasks: ['推送预习视频', '阅读 POP 海报资料'], outcome: '初步认识 POP 概念' },
        inClassPhases: [
          { phase: '导入新课', duration: '15 min', highlight: '案例驱动入门', teacherActions: '展示案例', studentActions: '观察讨论' },
          { phase: '知识讲授', duration: '25 min', highlight: '原理梳理',     teacherActions: '讲解原理', studentActions: '听讲笔记' },
          { phase: '实操练习', duration: '60 min', highlight: '动手设计',     teacherActions: '巡视指导', studentActions: '动手设计' },
          { phase: '互查反馈', duration: '15 min', highlight: '互评互鉴',     teacherActions: '组织互评', studentActions: '互评打分' },
          { phase: '总结升华', duration: '10 min', highlight: '总结提升',     teacherActions: '总结要点', studentActions: '分享心得' },
        ],
        postClass: { homework: ['上传作品到学习通', '完成自评表'], feedback: '24h 内点评' },
      },
    };
    const out = path.join(TMP_DIR, 'report.docx');
    await exportReportWord({ report, outputPath: out });
    const text = await readDocxText(out);
    assertContains(text, '到课率 95%', '实施成效·学生参与度·achieved');
    assertContains(text, '案例驱动效果好', '反思·主要成效');
    // v4.3.3 Round 19 修复（codex 反馈）：5 段法必须含教师活动+学生活动（不再只 highlight）
    assertContains(text, '展示案例', '课中流程·导入新课·教师活动');
    assertContains(text, '互评打分', '课中流程·互查反馈·学生活动');
    assertContains(text, '15 min', '课中流程·段时长');
    assertContains(text, '推送预习视频', '课前任务[0]');
    assertContains(text, '上传作品到学习通', '课后任务[0]');
    assertContains(text, '24h 内点评', '课后反馈机制');
    assertNotContains(text, '[object Object]', '对象误 toString');
  });

  await test('report docx · 老字段 lessonOverview / objectivesAchievement 抛 schema 错', async () => {
    const { exportReportWord } = require('../src/main/export/report-export');
    let threw = false;
    try {
      await exportReportWord({
        report: { lessonOverview: 'x', objectivesAchievement: 'y', teachingHighlights: 'z' },
        outputPath: path.join(TMP_DIR, 'report-bad.docx'),
      });
    } catch (e) {
      threw = /lessonOverview|交付问题 #5|老字段名/.test(e.message);
    }
    assert(threw, 'report schema 守卫未拦住老字段名');
  });

  // ───────── 3. micro-video-word.js（codex 重点指出的字段遗漏）─────────
  console.log('\n【3】micro-video-word.js 正文断言（codex 反馈字段遗漏修复）');

  await test('micro-video docx 正文含老师填的 targetAudience / rhythm / platforms / subtitles', async () => {
    const { exportMicroVideoWord } = require('../src/main/export/micro-video-word');
    const microVideo = {
      courseTitle: '服装产品传播',
      videoTopic: 'POP 海报设计三步法',
      durationSec: 90,
      // 服务真实字段名：targetAudience（codex 反馈修复点 1）
      targetAudience: '中职服装专业二年级学生',
      narrationScript: {
        intro: { text: '导入提问·什么是 POP？', duration: 10, tone: '提问式' },
        body: [
          { section: '原理', narration: '色彩对比与视觉层次', duration: 30 },
          { section: '案例', narration: '快闪店海报真实案例', duration: 30 },
        ],
        outro: { text: '动手试试设计你的第一张 POP', duration: 20, callToAction: '上传到学习通' },
      },
      storyboard: [
        { shotNumber: 1, duration: 10, type: 'intro', visualDescription: '教师特写引入提问', cameraAngle: '近景' },
        { shotNumber: 2, duration: 60, type: 'content', visualDescription: '屏幕示范设计步骤', cameraAngle: '中景' },
        { shotNumber: 3, duration: 20, type: 'outro', visualDescription: '学生作品展示墙', cameraAngle: '远景' },
      ],
      jimengPrompts: [
        { shotNumber: 1, prompt: '中职教师面对镜头提问，POP 海报案例', aspectRatio: '9:16', style: '写实教学风', duration: 10 },
        { shotNumber: 2, prompt: '电脑屏幕演示 POP 设计流程', aspectRatio: '9:16', style: '写实教学风', duration: 60 },
        { shotNumber: 3, prompt: '教室墙面展示学生 POP 作品', aspectRatio: '9:16', style: '写实教学风', duration: 20 },
      ],
      shootingGuide: {
        equipmentRecommendation: ['手机 iPhone 13', '三脚架', '领夹麦'],
        location: '服装实训室白墙背景',
        lightingTips: '顺光为主',
        soundTips: '领夹麦距 15cm',
        presenterTips: '眼神看镜头',
      },
      // 服务真实字段：rhythm / transitions[] / music{} / subtitles{} / platforms[]
      editingGuide: {
        rhythm: '开头快·中间稳·结尾收',                            // codex 反馈修复点 2（之前读 eg.pace 落空）
        transitions: ['横向滑动', '渐隐切换'],                      // 之前直接拼接，应 join(' / ')
        music: { type: '轻快电子', volume: '人声前置，BGM -20dB' },
        subtitles: { style: '白底黑字方块字幕', keyPoints: '关键名词强调' },  // 之前 [object Object]
        platforms: ['抖音', '视频号', '学习通'],                    // 服务输出，导出器之前读 eg.tools 完全漏
      },
    };
    const out = path.join(TMP_DIR, 'video.docx');
    await exportMicroVideoWord({
      microVideo, outputPath: out,
      courseName: '服装产品传播', lessonNumber: 2, videoTopic: 'POP 海报设计三步法',
    });
    const text = await readDocxText(out);

    // ① 受众（codex 反馈点）—— 必须读到 targetAudience 而不是 fallback 默认值
    assertContains(text, '中职服装专业二年级学生', '受众·targetAudience');
    assertNotContains(text, '中职二年级学生', '受众 fallback 默认值（应被 targetAudience 覆盖）');

    // ② 剪辑节奏（codex 反馈点）—— eg.rhythm 必须显示
    assertContains(text, '开头快·中间稳·结尾收', '剪辑节奏·rhythm');

    // ③ 转场 join 后的字符串
    assertContains(text, '横向滑动 / 渐隐切换', '转场 transitions[] join');
    assertNotContains(text, '[object Object]', '对象误 toString');

    // ④ 字幕拆分（service 是对象 {style, keyPoints}）
    assertContains(text, '白底黑字方块字幕', '字幕·style');
    assertContains(text, '关键名词强调', '字幕·keyPoints');

    // ⑤ 投放平台（service 是 platforms[]，旧导出器读 eg.tools 完全漏）
    assertContains(text, '抖音 / 视频号 / 学习通', '投放平台·platforms[]');

    // ⑥ 旁白脚本主体内容
    assertContains(text, '色彩对比与视觉层次', 'body[0].narration');
    assertContains(text, '动手试试设计你的第一张 POP', 'outro.text');

    // ⑦ 分镜表（每镜头 visualDescription 都要进表格单元格）
    assertContains(text, '教师特写引入提问', 'storyboard[0].visualDescription');
    assertContains(text, '屏幕示范设计步骤', 'storyboard[1].visualDescription');
    assertContains(text, '学生作品展示墙', 'storyboard[2].visualDescription');

    // ⑧ 即梦提示词
    assertContains(text, '电脑屏幕演示 POP 设计流程', 'jimengPrompts[1].prompt');

    // ⑨ 拍摄指南字段
    assertContains(text, '服装实训室白墙背景', 'shootingGuide.location');
  });

  await test('micro-video docx · 缺 narrationScript 抛 schema 错', async () => {
    const { exportMicroVideoWord } = require('../src/main/export/micro-video-word');
    let threw = false;
    try {
      await exportMicroVideoWord({
        microVideo: { storyboard: [], jimengPrompts: [] },
        outputPath: path.join(TMP_DIR, 'video-bad.docx'),
        courseName: 'x',
      });
    } catch (e) {
      threw = /narrationScript/.test(e.message);
    }
    assert(threw, 'video schema 守卫未拦住缺 narrationScript');
  });

  // ───────── 4. 讲稿分段朗读（Codex R2 真实行为测试，await import ESM）─────────
  console.log('\n【4】lecture-speech-utils 分段算法行为测试（Codex 审计第2轮）');
  const { pathToFileURL } = require('url');
  const speechUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'renderer', 'src', 'v2', 'lecture-speech-utils.mjs')).href;
  const speech = await import(speechUrl);

  await test('R2 · 500 字无标点文本：所有 chunk 都 ≤ 180（超长句硬切）', async () => {
    const long = '啊'.repeat(500);
    const chunks = speech.splitScriptIntoChunks(long, 180);
    assert(chunks.length > 0, '应切出多个块');
    assert(chunks.every((c) => c.length <= 180), `存在超长块：${chunks.map((c) => c.length).join(',')}`);
    // 内容不丢（无标点纯字符）
    assert(chunks.join('').length === 500, `内容丢失：合计 ${chunks.join('').length} ≠ 500`);
  });

  await test('R2 · 超长逗号句在逗号断 + 每块 ≤ 180', async () => {
    const longComma = '词，'.repeat(150); // 450 字
    const chunks = speech.splitScriptIntoChunks(longComma, 180);
    assert(chunks.every((c) => c.length <= 180), '逗号句未保证 ≤ 180');
  });

  await test('R2 · 普通中文段落顺序与内容不丢', async () => {
    const normal = '第一句话。第二句话！第三句话？第四句话；';
    const chunks = speech.splitScriptIntoChunks(normal, 180);
    const joined = chunks.join('').replace(/\s/g, '');
    assert(joined === normal.replace(/\s/g, ''), `内容/顺序变了：${joined}`);
  });

  await test('R2 · cleanScriptForSpeech 去 markdown 标记', async () => {
    const md = '## 第 1 页\n**教师讲述：** 内容\n- 要点一';
    const clean = speech.cleanScriptForSpeech(md);
    assert(!/[#*\-]/.test(clean.replace(/[一-龥]/g, '')), `markdown 残留：${clean}`);
    assert(/教师讲述/.test(clean) && /内容/.test(clean), '正文被误删');
  });

  // ───────── 结果汇总 ─────────
  console.log(`\n═══ 结果：${pass}/${pass + fail} 通过 ═══`);

  // 清理临时目录
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (_) { /* ignore */ }

  if (fail > 0) {
    console.log('\n失败列表：');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}\n     ${f.error}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('💥 verify-export-content-v8 异常：', e);
  process.exit(2);
});
