/**
 * report.service.js — 教学实施报告生成服务（驭课 Agent v4.0.0 / Phase-9 C-4）
 *
 * 职责（v4.3.3 Codex Round 14 P2.2：8 阶段对齐）：
 *   AI 自动汇总上游 7 个阶段产物（schedule/design/ppt/lecture/quiz/homework/video）的核心要点；
 *   老师后续手填"实施成效"和"反思改进"两节。
 *
 * 设计要点：
 *   - implementationOutcomes 5 项 + reflectionAndImprovement 4 项是老师手填区
 *     normalize 时**必须**清空成占位（不让 AI 杜撰）
 *   - 上游 7 个阶段 artifact 通过 ctx 注入（按本节实际生成情况，缺哪个就把对应字段留空，
 *     **但 AI 不得编造缺失阶段的内容**）
 *
 * 数据流：
 *   IPC handler (v2:generateReport) → 本 service.generate(...) → AI chatJson →
 *     parseReportJson → normalizeReport →
 *     db.createArtifact(type='implementation_report', stage='report')
 */

const fs = require('fs');
const path = require('path');

const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

// ── JSON 解析（同 design / micro-video 模式） ─────────────────────────────

function parseReportJson(rawText) {
  if (!rawText) throw new Error('AI 返回内容为空');
  const trimmed = String(rawText).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('AI 未返回合法 JSON 对象');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    throw new Error(`JSON 解析失败：${e.message}`);
  }
}

// ── 规整与守卫 ──────────────────────────────────────────────────────────

const REQUIRED_PHASES = ['导入新课', '知识讲授', '实操练习', '互查反馈', '总结升华'];

const TEACHER_FILL_OUTCOME_KEYS = [
  'studentEngagement',
  'workCompletion',
  'skillTransfer',
  'industryAlignment',
  'ideologicalImpact',
];

const TEACHER_FILL_REFLECTION_KEYS = [
  'achievements',
  'issues',
  'improvements',
  'futurePlans',
];

function arr(value, maxLen) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v != null && String(v).trim().length > 0)
    .map((v) => String(v).trim())
    .slice(0, maxLen);
}

function normalizeReport(parsed, ctx = {}) {
  const safe = parsed || {};

  // ── 基本元信息 ──
  // v4.3.3 Codex Round 11 P1.2：H14 反模板化 · 学校名不再硬编码"广州纺校"
  //   缺失时留空字符串，让 caller 显式处理而不是 AI 自己编一个
  const courseName = String(safe.courseName || ctx.courseName || '').trim();
  const school = String(safe.school || ctx.school || '').trim();
  const academicYear = String(safe.academicYear || ctx.academicYear || '').trim();
  const term = String(safe.term || ctx.term || '').trim();
  const teacher = String(safe.teacher || ctx.teacher || '').trim();

  // ── 教学目标三类 ──
  const obj = safe.teachingObjectives || {};
  const teachingObjectives = {
    knowledge: arr(obj.knowledge, 5),
    skill: arr(obj.skill, 5),
    emotion: arr(obj.emotion, 5),
  };

  // ── 重点难点 ──
  const kd = safe.keyPointsAndDifficulties || {};
  const keyPointsAndDifficulties = {
    keyPoints: arr(kd.keyPoints, 6),
    difficulties: arr(kd.difficulties, 6),
  };

  // ── 教学方法（接受字符串或对象数组） ──
  let teachingMethods = Array.isArray(safe.teachingMethods) ? safe.teachingMethods : [];
  teachingMethods = teachingMethods
    .filter((m) => m && (typeof m === 'object' || typeof m === 'string'))
    .map((m) => typeof m === 'string'
      ? { name: m, applicable: '' }
      : {
          name: String(m.name || '').trim(),
          applicable: String(m.applicable || '').trim(),
        })
    .filter((m) => m.name)
    .slice(0, 8);

  // ── 总体安排 ──
  const overallArrangement = String(safe.overallArrangement || '').trim();

  // ── 课前/课中 5 段/课后 ──
  const flow = safe.preInClassPostFlow || {};
  const pre = flow.preClass || {};
  const post = flow.postClass || {};

  // inClassPhases 严格 5 段
  const inPhases = Array.isArray(flow.inClassPhases) ? flow.inClassPhases : [];
  const phasesByName = {};
  inPhases.forEach((p) => {
    if (p && p.phase) phasesByName[String(p.phase).trim()] = p;
  });
  // v4.3.3 Round 19 修复（codex 反馈 · 2026-05-20）：
  //   旧 normalize 只保留 phase+highlight，老师从教学设计阶段填的
  //   duration/teacherActions/studentActions 全部被砍掉，最终报告 docx 5 段法只显示一句话。
  //   现在 normalize 完整保留这些字段，让 export 能渲染含教师活动+学生活动+段时长的完整 5 段法。
  const inClassPhases = REQUIRED_PHASES.map((name) => {
    const p = phasesByName[name] || {};
    return {
      phase: name,
      highlight: String(p.highlight || '').trim(),
      duration: String(p.duration || '').trim(),
      teacherActions: String(p.teacherActions || '').trim(),
      studentActions: String(p.studentActions || '').trim(),
    };
  });

  const preInClassPostFlow = {
    preClass: {
      tasks: arr(pre.tasks, 8),
      outcome: String(pre.outcome || '').trim(),
    },
    inClassPhases,
    postClass: {
      homework: arr(post.homework, 8),
      feedback: String(post.feedback || '').trim(),
    },
  };

  // ── 信息化 ──
  const info = safe.informatization || {};
  const informatization = {
    platform: String(info.platform || '学习通').trim(),
    tools: arr(info.tools, 8),
    purpose: String(info.purpose || '').trim(),
  };

  // ── 微课视频应用 ──
  const microVideoUsage = String(safe.microVideoUsage || '').trim();

  // ── 实施成效（老师手填，AI 永远清空） ──
  const implementationOutcomes = {};
  TEACHER_FILL_OUTCOME_KEYS.forEach((key) => {
    // 强制清空：即使 AI 返回内容，也不采纳——避免杜撰
    implementationOutcomes[key] = { achieved: '', evidence: '' };
  });

  // ── 反思改进（老师手填，AI 永远清空） ──
  const reflectionAndImprovement = {};
  TEACHER_FILL_REFLECTION_KEYS.forEach((key) => {
    reflectionAndImprovement[key] = [];
  });

  // ── 统计（v4.3.3 Codex Round 14 P1.2：补 quiz / homework）──
  const upstreamSummary = {
    hasSchedule: Boolean(ctx.hasSchedule),
    hasDesign: Boolean(ctx.hasDesign),
    hasPpt: Boolean(ctx.hasPpt),
    hasLecture: Boolean(ctx.hasLecture),
    hasQuiz: Boolean(ctx.hasQuiz),
    hasHomework: Boolean(ctx.hasHomework),
    hasMicroVideo: Boolean(ctx.hasMicroVideo),
  };
  const upstreamCount = Object.values(upstreamSummary).filter(Boolean).length;

  // 老师填写进度：每个非空字段计 1 分
  const teacherFillProgress = (() => {
    let filled = 0;
    const totalSlots = TEACHER_FILL_OUTCOME_KEYS.length + TEACHER_FILL_REFLECTION_KEYS.length;
    TEACHER_FILL_OUTCOME_KEYS.forEach((key) => {
      const o = implementationOutcomes[key];
      if (o && (o.achieved || o.evidence)) filled++;
    });
    TEACHER_FILL_REFLECTION_KEYS.forEach((key) => {
      if (Array.isArray(reflectionAndImprovement[key]) && reflectionAndImprovement[key].length > 0) {
        filled++;
      }
    });
    return { filled, totalSlots, ratio: totalSlots > 0 ? filled / totalSlots : 0 };
  })();

  return {
    courseName,
    school,
    academicYear,
    term,
    teacher,
    teachingObjectives,
    keyPointsAndDifficulties,
    teachingMethods,
    overallArrangement,
    preInClassPostFlow,
    informatization,
    microVideoUsage,
    implementationOutcomes,
    reflectionAndImprovement,
    _stats: {
      upstreamSummary,
      upstreamCount,
      teacherFillProgress,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ── 主入口：生成 ────────────────────────────────────────────────────────

/**
 * 生成教学实施报告（v4.3.3 Codex Round 14：AI 汇总上游 7 阶段产物 + 留出老师手填区）
 *
 * @param {Object} params
 * @param {Object} params.aiClient        - AI 客户端（必须有 chatJson 方法）
 * @param {string} params.courseName      - 课程名
 * @param {Object} [params.scheduleData]  - schedule artifact（教学进度表）
 * @param {Object} [params.designData]    - design artifact（教学设计）
 * @param {Object} [params.pptData]       - ppt artifact（PPT 大纲）
 * @param {Object} [params.lectureData]   - lecture artifact（讲稿）
 * @param {Object} [params.quizData]      - quiz_set artifact（测验题）· v4.3.3 Codex Round 14 新增
 * @param {Object} [params.homeworkData]  - homework_set artifact（作业）· v4.3.3 Codex Round 14 新增
 * @param {Object} [params.microVideoData]- video_prompt artifact（微课视频方案）
 * @param {Array}  [params.lessonArtifacts] - 多节聚合模式：每项含 quizData/homeworkData/videoData 等
 * @param {Object} [params.courseContext]
 */
/**
 * v4.3.3 Codex Round 10 P2.3：把 lessonArtifacts[] 数组聚合成 single-lesson 形状
 *   每项格式：{ lessonNumber, designData, pptData, lectureData, quizData, homeworkData, videoData }
 *   策略：以最后一节作为代表（兜底字段），但 hint blocks 拼接所有节摘要
 */
function aggregateLessonArtifacts(lessonArtifacts) {
  if (!Array.isArray(lessonArtifacts) || lessonArtifacts.length === 0) {
    return { aggregated: null, summaries: [] };
  }
  const last = lessonArtifacts[lessonArtifacts.length - 1] || {};
  const summaries = lessonArtifacts.map((la) => ({
    lessonNumber: la.lessonNumber,
    topic: la.designData?.lessonMeta?.topic
         || la.pptData?.lessonMeta?.topic
         || la.lectureData?.lessonMeta?.topic
         || `第 ${la.lessonNumber} 节`,
    pptPageCount: la.pptData?.pages?.length || la.pptData?.pptPages?.length || 0,
    lectureChars: (la.lectureData?.finalScript || '').length,
    quizQuestions: la.quizData?.questions?.length || 0,
    homeworkTasks: la.homeworkData?.tasks?.length || 0,
    videoDurationSec: la.videoData?.durationSec || la.videoData?.duration || 0,
  }));
  return {
    aggregated: {
      designData: last.designData || null,
      pptData: last.pptData || null,
      lectureData: last.lectureData || null,
      // v4.3.3 Codex Round 14 P1.2：聚合也补 quiz / homework
      quizData: last.quizData || null,
      homeworkData: last.homeworkData || null,
      microVideoData: last.videoData || null,
    },
    summaries,
  };
}

async function generate({
  aiClient,
  courseName,
  scheduleData = null,
  designData = null,
  lectureData = null,
  pptData = null,
  // v4.3.3 Codex Round 14 P1.2：新增 quizData / homeworkData 参数（8 阶段对齐）
  quizData = null,
  homeworkData = null,
  microVideoData = null,
  // v4.3.3 Codex Round 10 P2.3：新增 lessonArtifacts 数组（多节合并模式）
  //   传入后会聚合每节产物 + 把每节摘要拼进 prompt hint
  lessonArtifacts = null,
  courseContext = {},
}) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    return { success: false, error: '未提供有效的 AI 客户端（缺少 chatJson 方法）' };
  }
  if (!courseName) {
    return { success: false, error: '课程名（courseName）不能为空' };
  }

  // v4.3.3 Codex Round 10 P2.3：合并 lessonArtifacts 兜底单节字段
  let lessonSummaries = [];
  if (Array.isArray(lessonArtifacts) && lessonArtifacts.length > 0) {
    const aggResult = aggregateLessonArtifacts(lessonArtifacts);
    lessonSummaries = aggResult.summaries;
    if (aggResult.aggregated) {
      if (!designData) designData = aggResult.aggregated.designData;
      if (!pptData) pptData = aggResult.aggregated.pptData;
      if (!lectureData) lectureData = aggResult.aggregated.lectureData;
      // v4.3.3 Codex Round 14 P1.2：聚合也兜底 quiz/homework
      if (!quizData) quizData = aggResult.aggregated.quizData;
      if (!homeworkData) homeworkData = aggResult.aggregated.homeworkData;
      if (!microVideoData) microVideoData = aggResult.aggregated.microVideoData;
    }
  }

  const systemPrompt = loadPrompt('report');

  // ── 把上游 artifact 拼成 hint 块 ──
  const hintBlocks = [];

  // v4.3.3 Codex Round 10 P2.3：多节抽样总览（如果传了 lessonArtifacts）
  if (lessonSummaries.length > 0) {
    const lines = ['## 多节抽样总览（每节核心产出量）', '本报告基于 ' + lessonSummaries.length + ' 节抽样数据生成：'];
    lessonSummaries.forEach((s) => {
      lines.push(
        `· 第 ${s.lessonNumber} 节《${s.topic}》：` +
        `PPT ${s.pptPageCount} 页 · 讲稿 ${s.lectureChars} 字 · ` +
        `测验 ${s.quizQuestions} 题 · 作业 ${s.homeworkTasks} 道 · ` +
        `微课 ${s.videoDurationSec} 秒`
      );
    });
    hintBlocks.push(lines.join('\n'));
  }

  if (designData) {
    const objs = designData.teachingObjectives || {};
    const tmCount = Array.isArray(designData.teachingMethods) ? designData.teachingMethods.length : 0;
    hintBlocks.push([
      '## 上游教学设计 hint',
      `知识目标：${(objs.knowledge || []).join(' / ') || '（无）'}`,
      `技能目标：${(objs.skill || []).join(' / ') || '（无）'}`,
      `素养目标：${(objs.emotion || []).join(' / ') || '（无）'}`,
      `教学重点：${(designData.keyPoints || []).join(' / ') || '（无）'}`,
      `教学难点：${(designData.difficulties || []).join(' / ') || '（无）'}`,
      `教学方法数量：${tmCount}`,
    ].join('\n'));
  }

  if (scheduleData) {
    const chapters = [];
    const seen = new Set();
    (scheduleData.schedule || []).forEach((row) => {
      if (row.chapter && !seen.has(row.chapter)) {
        chapters.push(row.chapter);
        seen.add(row.chapter);
      }
    });
    hintBlocks.push([
      '## 上游进度表 hint',
      `章节：${chapters.join(' / ') || '（未分章节）'}`,
      scheduleData.experimentTopics?.length ? `实训类目：${scheduleData.experimentTopics.join(' / ')}` : '',
    ].filter(Boolean).join('\n'));
  }

  if (lectureData) {
    const lectureSummary = lectureData.summary || lectureData.title || '';
    hintBlocks.push([
      '## 上游课堂讲稿 hint',
      lectureSummary ? `讲稿摘要：${String(lectureSummary).slice(0, 200)}` : '（讲稿已生成，但未提供摘要字段）',
    ].join('\n'));
  }

  if (pptData) {
    // v4.3.3 Codex Round 14 P1.2：pptData 真实字段是 pages（不是 slides），slides 是早期别名
    const pageCount = Array.isArray(pptData.pages) ? pptData.pages.length
                    : Array.isArray(pptData.pptPages) ? pptData.pptPages.length
                    : Array.isArray(pptData.slides) ? pptData.slides.length : 0;
    hintBlocks.push([
      '## 上游 PPT hint',
      `幻灯片数量：${pageCount}`,
    ].join('\n'));
  }

  // v4.3.3 Codex Round 14 P1.2：上游测验 hint
  if (quizData) {
    const qs = Array.isArray(quizData.questions) ? quizData.questions : [];
    const typeCount = qs.reduce((acc, q) => {
      const t = q?.type || 'unknown';
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});
    const typeStr = Object.entries(typeCount).map(([k, v]) => `${k}=${v}`).join(' / ') || '（无）';
    hintBlocks.push([
      '## 上游测验 hint',
      `题目数量：${qs.length}`,
      `题型分布：${typeStr}`,
    ].join('\n'));
  }

  // v4.3.3 Codex Round 14 P1.2：上游作业 hint
  if (homeworkData) {
    const ts = Array.isArray(homeworkData.tasks) ? homeworkData.tasks : [];
    const totalMin = ts.reduce((s, t) => s + (Number(t?.estimatedMinutes) || 0), 0);
    hintBlocks.push([
      '## 上游作业 hint',
      `作业任务数：${ts.length}`,
      `预计总耗时：${totalMin} 分钟`,
    ].join('\n'));
  }

  if (microVideoData) {
    const videoTopic = microVideoData.videoTopic || '';
    const shotCount = Array.isArray(microVideoData.storyboard) ? microVideoData.storyboard.length : 0;
    hintBlocks.push([
      '## 上游微课视频 hint',
      videoTopic ? `视频主题：${videoTopic}` : '',
      `分镜数量：${shotCount}`,
    ].filter(Boolean).join('\n'));
  }

  // v4.3.3 Codex Round 11 P1.2：H14 反模板化 · 学校名缺失时不再填"广州纺校"
  //   AI 看到 "学校：（未填）" 时不会编学校名，会主动从 lessonMeta / lecture / ppt 找
  const ctxLines = [
    `课程名称：${courseName}`,
    `学校：${courseContext.school || '（未填，AI 请勿编造，从产物中查找）'}`,
    courseContext.academicYear ? `学年：${courseContext.academicYear}` : '',
    courseContext.term ? `学期：${courseContext.term}` : '',
    courseContext.teacher ? `授课教师：${courseContext.teacher}` : '',
    courseContext.softwareTools ? `软件工具：${courseContext.softwareTools}` : '',
    courseContext.jobTargets ? `面向岗位：${courseContext.jobTargets}` : '',
    courseContext.industryScenarios ? `行业场景：${courseContext.industryScenarios}` : '',
  ].filter(Boolean);

  const userPrompt = [
    '## 课程基础信息',
    ctxLines.join('\n'),
    '',
    hintBlocks.join('\n\n'),
    '',
    '## 任务',
    // v4.3.3 Codex Round 15 P2：升级注释 · 直接说"上游 7 阶段"（不再保留老说法），
    // 8 阶段工作流：schedule → design → ppt → lecture → quiz → homework → video → report
    // report 阶段消费上游 7 阶段（前 7 个）产物，按本节实际生成情况汇总；缺失字段允许留空但不得编造。
    '基于上游 7 阶段产物 hint（可纳入：教学进度表 / 教学设计 / PPT 大纲 / 讲稿 / 测验 / 作业 / 微课视频方案，按本节实际生成情况），生成教学实施报告 JSON。',
    '严格遵守：',
    '- AI 自动汇总区基于上游 hint 提炼，**禁止超出已有数据**',
    '- 缺失的上游阶段（如本节未生成 quiz/homework）允许相关汇总字段留空，**不得编造**',
    '- implementationOutcomes 5 项的 achieved/evidence **保持空字符串**（老师手填）',
    '- reflectionAndImprovement 4 项保持**空数组**（老师手填）',
    '- inClassPhases 严格 5 段（导入新课/知识讲授/实操练习/互查反馈/总结升华）',
    '',
    '## 严格输出要求',
    '只返回 JSON 对象，以 { 开头，以 } 结尾。',
  ].filter(Boolean).join('\n');

  let rawText;
  try {
    rawText = await aiClient.chatJson({
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxTokens: 4500,
    });
  } catch (e) {
    return { success: false, error: `AI 调用失败：${e.message}` };
  }

  let parsed;
  try {
    parsed = parseReportJson(rawText);
  } catch (e) {
    return { success: false, error: e.message, raw: String(rawText || '').slice(0, 500) };
  }

  const report = normalizeReport(parsed, {
    courseName,
    school: courseContext.school,
    academicYear: courseContext.academicYear,
    term: courseContext.term,
    teacher: courseContext.teacher,
    hasSchedule: !!scheduleData,
    hasDesign: !!designData,
    hasLecture: !!lectureData,
    hasPpt: !!pptData,
    // v4.3.3 Codex Round 14 P1.2：暴露 quiz/homework 上游存在性
    hasQuiz: !!quizData,
    hasHomework: !!homeworkData,
    hasMicroVideo: !!microVideoData,
  });

  // v4.3.3 Codex Round 10 P1.2：data.product 主路径 · report 作 legacy alias
  return { success: true, data: { product: report, report, raw: rawText } };
}

// ── 自检 ────────────────────────────────────────────────────────────────

function selfCheck() {
  const checks = [];

  checks.push({
    name: 'prompts/report.md 可加载',
    pass: (() => {
      try {
        const p = loadPrompt('report');
        return typeof p === 'string' && p.length > 500;
      } catch {
        return false;
      }
    })(),
  });

  checks.push({
    name: 'parseReportJson 处理纯 JSON',
    pass: (() => {
      try {
        return parseReportJson('{"foo":"bar"}').foo === 'bar';
      } catch {
        return false;
      }
    })(),
  });

  checks.push({
    name: 'parseReportJson 处理 markdown 包裹',
    pass: (() => {
      try {
        return parseReportJson('```json\n{"foo":"bar"}\n```').foo === 'bar';
      } catch {
        return false;
      }
    })(),
  });

  checks.push({
    name: 'parseReportJson 空字符串抛错',
    pass: (() => {
      try { parseReportJson(''); return false; } catch { return true; }
    })(),
  });

  checks.push({
    name: 'normalizeReport inClassPhases 严格 5 段',
    pass: (() => {
      const r = normalizeReport({ preInClassPostFlow: { inClassPhases: [{ phase: '导入新课' }] } });
      return r.preInClassPostFlow.inClassPhases.length === 5;
    })(),
  });

  checks.push({
    name: 'normalizeReport implementationOutcomes 5 项必有',
    pass: (() => {
      const r = normalizeReport({});
      return Object.keys(r.implementationOutcomes).length === 5;
    })(),
  });

  checks.push({
    name: 'normalizeReport AI 试图填实施成效 → 强制清空',
    pass: (() => {
      const r = normalizeReport({
        implementationOutcomes: {
          studentEngagement: { achieved: '95%', evidence: '出勤率高' },  // AI 杜撰
        },
      });
      return r.implementationOutcomes.studentEngagement.achieved === '' &&
             r.implementationOutcomes.studentEngagement.evidence === '';
    })(),
  });

  checks.push({
    name: 'normalizeReport AI 试图填反思改进 → 强制清空',
    pass: (() => {
      const r = normalizeReport({
        reflectionAndImprovement: {
          achievements: ['AI 杜撰的成效'],
          issues: ['AI 杜撰的问题'],
        },
      });
      return r.reflectionAndImprovement.achievements.length === 0 &&
             r.reflectionAndImprovement.issues.length === 0;
    })(),
  });

  checks.push({
    name: 'normalizeReport reflectionAndImprovement 4 项必有',
    pass: (() => {
      const r = normalizeReport({});
      return Object.keys(r.reflectionAndImprovement).length === 4;
    })(),
  });

  checks.push({
    name: 'normalizeReport teachingMethods 字符串数组兼容',
    pass: (() => {
      const r = normalizeReport({ teachingMethods: ['案例法', '任务驱动'] });
      return r.teachingMethods.length === 2 && r.teachingMethods[0].name === '案例法';
    })(),
  });

  checks.push({
    // v4.3.3 Codex Round 11 P1.2：H14 反模板化 · school 不再硬编码默认值
    //   selfCheck 期望也改为空字符串，与 normalize 实际行为一致
    name: 'normalizeReport school 缺失时为空（H14 反模板化）',
    pass: (() => {
      const r = normalizeReport({});
      return r.school === '';
    })(),
  });

  checks.push({
    name: 'normalizeReport _stats.teacherFillProgress 初始为 0',
    pass: (() => {
      const r = normalizeReport({});
      return r._stats?.teacherFillProgress?.filled === 0 &&
             r._stats?.teacherFillProgress?.totalSlots === 9;
    })(),
  });

  checks.push({
    name: 'normalizeReport _stats.upstreamCount 反映 ctx',
    pass: (() => {
      const r = normalizeReport({}, { hasSchedule: true, hasDesign: true, hasLecture: false, hasPpt: true, hasMicroVideo: false });
      return r._stats?.upstreamCount === 3;
    })(),
  });

  const passed = checks.filter((c) => c.pass).length;
  return { total: checks.length, passed, checks };
}

module.exports = {
  generate,
  selfCheck,
  REQUIRED_PHASES,
  TEACHER_FILL_OUTCOME_KEYS,
  TEACHER_FILL_REFLECTION_KEYS,
  _internal: { parseReportJson, normalizeReport, loadPrompt },
};
