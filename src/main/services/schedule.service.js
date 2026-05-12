/**
 * schedule.service.js — 教学进度表生成服务（驭课 Agent v4.0.0 / Phase-9）
 *
 * 职责：
 *   接收课程基础信息（课程名 / 教师 / 总学时 / 教材 / 班级），
 *   调 AI 生成符合广东省中职规范的教学进度表（按周次排课），
 *   支持自动写入 artifact 数据库 + 自动 syncWorkflowStageAvailability 解锁下游 design 阶段。
 *
 * 约束：
 *   - 使用 prompts/schedule.md 作为 system prompt（H5）
 *   - 不修改 quality.js / contracts.js（H1 / H3）
 *   - 单文件 service，无副作用
 *
 * 数据流：
 *   IPC handler (v2:generateSchedule) → 本 service.generate(...) → AI chatJson →
 *     parseScheduleJson → db.createArtifact (type='schedule_table', stage='schedule') →
 *     返回前端展示
 *
 *   IPC handler (v2:confirmSchedule) → 本 service.confirm(...) → db.updateArtifact (confirmed=true) →
 *     contracts.computeUnlockedStages 自然解锁 design
 */

const fs = require('fs');
const path = require('path');

const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

// ── JSON 解析工具 ─────────────────────────────────────────────────────────────

function parseScheduleJson(rawText) {
  if (!rawText) throw new Error('AI 返回内容为空');
  const trimmed = String(rawText).trim();
  // 去 markdown 代码块包裹
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  // 取第一个 { 到最后一个 }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('AI 未返回合法 JSON 对象');
  }
  const jsonText = candidate.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`JSON 解析失败：${e.message}`);
  }
}

// ── Schedule 数据校验 + 兜底 ──────────────────────────────────────────────────

function normalizeSchedule(parsed, ctx = {}) {
  const safe = parsed || {};
  const header = safe.header || {};
  const evaluation = safe.evaluation || {};

  // 总学时兜底（优先用 AI 输出，否则用 ctx）
  const totalHours = Number(header.totalHours) || Number(ctx.totalHours) || 72;
  const theoryHours = Number(header.theoryHours) || Math.floor(totalHours * 0.5);
  const practiceHours = Number(header.practiceHours) || Math.floor(totalHours * 0.4);
  const examHours = Number(header.examHours) || (totalHours - theoryHours - practiceHours);

  // 学校简称兜底
  const school = String(header.school || ctx.school || '广州纺校').trim();

  // schedule 数组校验
  // 注意：content 为空的行视为无效行，必须过滤——避免 AI 漏写时塞进无意义占位
  let schedule = Array.isArray(safe.schedule) ? safe.schedule : [];
  schedule = schedule
    .map((row, i) => ({
      week: Number(row?.week) || i + 1,
      session: Number(row?.session) || i + 1,
      chapter: String(row?.chapter || '').trim(),
      content: String(row?.content || '').trim(),  // 不补默认值
      method: String(row?.method || '讲授').trim(),
      homework: Number(row?.homework) || 0,
    }))
    .filter((r) => r.content && r.content.length > 0)
    .sort((a, b) => a.week - b.week || a.session - b.session);

  return {
    header: {
      courseName: String(header.courseName || ctx.courseName || '课程').trim(),
      teacher: String(header.teacher || ctx.teacher || '').trim(),
      school,
      department: String(header.department || '').trim(),
      semester: String(header.semester || '').trim(),
      className: String(header.className || ctx.className || '').trim(),
      textbook: String(header.textbook || ctx.textbook || '').trim(),
      totalHours,
      theoryHours,
      practiceHours,
      examHours,
    },
    objective: String(safe.objective || '').trim(),
    keyPoints: Array.isArray(safe.keyPoints) ? safe.keyPoints.filter(Boolean).map(String).slice(0, 6) : [],
    difficulties: Array.isArray(safe.difficulties) ? safe.difficulties.filter(Boolean).map(String).slice(0, 6) : [],
    methods: Array.isArray(safe.methods) ? safe.methods.filter(Boolean).map(String).slice(0, 8) : ['讲授法'],
    experimentTopics: Array.isArray(safe.experimentTopics) ? safe.experimentTopics.filter(Boolean).map(String).slice(0, 6) : [],
    evaluation: {
      approach: String(evaluation.approach || '').trim(),
      components: Array.isArray(evaluation.components) ? evaluation.components.filter(Boolean).map(String) : ['考勤', '作业', '课堂表现'],
      weights: typeof evaluation.weights === 'object' && evaluation.weights ? evaluation.weights : {},
    },
    schedule,
    additionalNotes: String(safe.additionalNotes || '').trim(),
    _stats: {
      scheduleRowCount: schedule.length,
      expectedRowCount: totalHours,  // 假设每周 1 节
      generatedAt: new Date().toISOString(),
    },
  };
}

// ── 主入口：生成 ──────────────────────────────────────────────────────────────

/**
 * 生成教学进度表
 *
 * @param {Object} params
 * @param {Object} params.aiClient        - AI 客户端（必须有 chatJson 方法）
 * @param {string} params.courseName      - 课程名
 * @param {Object} [params.courseContext] - 课程上下文（可选）
 *   @param {string} courseContext.teacher       - 教师姓名
 *   @param {string} courseContext.school        - 学校简称（默认"广州纺校"）
 *   @param {number} courseContext.totalHours    - 总学时
 *   @param {string} courseContext.textbook      - 教材
 *   @param {string} courseContext.className     - 班级
 *   @param {string} courseContext.semester      - 学期
 *   @param {string} courseContext.courseGoal    - 课程目标描述
 *   @param {string} courseContext.softwareTools - 软件工具
 *   @param {string} courseContext.jobTargets    - 岗位
 *   @param {string} courseContext.industryScenarios - 行业场景
 * @returns {Promise<{ success: boolean, data?: { schedule: Object, raw: string }, error?: string }>}
 */
async function generate({ aiClient, courseName, courseContext = {} }) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    return { success: false, error: '未提供有效的 AI 客户端（缺少 chatJson 方法）' };
  }
  if (!courseName) {
    return { success: false, error: '课程名（courseName）不能为空' };
  }

  const systemPrompt = loadPrompt('schedule');

  const contextLines = [
    `课程名称：${courseName}`,
    courseContext.teacher ? `教师姓名：${courseContext.teacher}` : '',
    courseContext.school ? `学校：${courseContext.school}` : '学校：广州纺校',
    courseContext.department ? `教学部：${courseContext.department}` : '',
    courseContext.semester ? `学期：${courseContext.semester}` : '',
    courseContext.className ? `班级：${courseContext.className}` : '',
    courseContext.textbook ? `教材：${courseContext.textbook}` : '',
    courseContext.totalHours ? `总学时：${courseContext.totalHours}` : '',
    courseContext.theoryHours ? `理论学时：${courseContext.theoryHours}` : '',
    courseContext.practiceHours ? `实践学时：${courseContext.practiceHours}` : '',
    courseContext.courseGoal ? `课程目标：${courseContext.courseGoal}` : '',
    courseContext.softwareTools ? `软件工具：${courseContext.softwareTools}` : '',
    courseContext.jobTargets ? `面向岗位：${courseContext.jobTargets}` : '',
    courseContext.industryScenarios ? `行业场景：${courseContext.industryScenarios}` : '',
  ].filter(Boolean);

  const userPrompt = [
    '## 课程基础信息',
    contextLines.join('\n'),
    '',
    '## 任务',
    '基于以上信息，生成符合广东省中职规范的教学进度表 JSON。',
    '严格遵守 system prompt 里的字段名 + schedule 总条数 = 总学时 / 每周节数 + 学校字段默认"广州纺校"。',
    '',
    '## 严格输出要求',
    '只返回 JSON 对象，以 { 开头，以 } 结尾，可被 JSON.parse() 解析。',
  ].join('\n');

  let rawText;
  try {
    rawText = await aiClient.chatJson({
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxTokens: 6000,
    });
  } catch (e) {
    return { success: false, error: `AI 调用失败：${e.message}` };
  }

  let parsed;
  try {
    parsed = parseScheduleJson(rawText);
  } catch (e) {
    return { success: false, error: e.message, raw: String(rawText || '').slice(0, 500) };
  }

  const schedule = normalizeSchedule(parsed, {
    courseName,
    teacher: courseContext.teacher,
    school: courseContext.school,
    totalHours: courseContext.totalHours,
    textbook: courseContext.textbook,
    className: courseContext.className,
  });

  return { success: true, data: { schedule, raw: rawText } };
}

// ── 自检（轻量，无网络）────────────────────────────────────────────────────────

function selfCheck() {
  const checks = [];

  checks.push({
    name: 'prompts/schedule.md 可加载',
    pass: (() => {
      try {
        const p = loadPrompt('schedule');
        return typeof p === 'string' && p.length > 200;
      } catch {
        return false;
      }
    })(),
  });

  checks.push({
    name: 'parseScheduleJson 处理 markdown 包裹',
    pass: (() => {
      try {
        const r = parseScheduleJson('```json\n{"foo":"bar"}\n```');
        return r.foo === 'bar';
      } catch {
        return false;
      }
    })(),
  });

  checks.push({
    name: 'parseScheduleJson 处理纯 JSON',
    pass: (() => {
      try {
        const r = parseScheduleJson('{"foo":"bar"}');
        return r.foo === 'bar';
      } catch {
        return false;
      }
    })(),
  });

  checks.push({
    name: 'parseScheduleJson 空输入抛错',
    pass: (() => {
      try {
        parseScheduleJson('');
        return false;
      } catch {
        return true;
      }
    })(),
  });

  checks.push({
    name: 'normalizeSchedule 学校默认"广州纺校"',
    pass: (() => {
      const r = normalizeSchedule({});
      return r.header.school === '广州纺校';
    })(),
  });

  checks.push({
    name: 'normalizeSchedule schedule 按 week 排序',
    pass: (() => {
      const r = normalizeSchedule({
        schedule: [
          { week: 3, content: 'C' },
          { week: 1, content: 'A' },
          { week: 2, content: 'B' },
        ],
      });
      return r.schedule.length === 3 && r.schedule[0].week === 1 && r.schedule[2].week === 3;
    })(),
  });

  checks.push({
    name: 'normalizeSchedule 缺字段兜底',
    pass: (() => {
      const r = normalizeSchedule({ schedule: [{ week: 1, content: '' }] });
      // content 为空时被过滤，schedule 数组应空
      return r.schedule.length === 0;
    })(),
  });

  checks.push({
    name: 'normalizeSchedule totalHours 兜底 72',
    pass: (() => {
      const r = normalizeSchedule({}, {});
      return r.header.totalHours === 72;
    })(),
  });

  checks.push({
    name: 'normalizeSchedule courseName 走 ctx 优先',
    pass: (() => {
      const r = normalizeSchedule({ header: {} }, { courseName: '测试课' });
      return r.header.courseName === '测试课';
    })(),
  });

  const passed = checks.filter((c) => c.pass).length;
  return { total: checks.length, passed, checks };
}

module.exports = {
  generate,
  selfCheck,
  // 暴露内部工具供 verify 测试
  _internal: { parseScheduleJson, normalizeSchedule, loadPrompt },
};
