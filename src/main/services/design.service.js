/**
 * design.service.js — 教学设计生成服务（驭课 Agent v4.0.0 / Phase-9 C-2）
 *
 * 职责：
 *   接收课程进度表 + 课程上下文，调 AI 生成符合中职规范的教学设计文档（整门课级别）。
 *   含：教学目标 / 重点难点 / 教学方法 / 课前课中课后 / 信息化 / 考核权重 / 思政元素
 *
 * 约束：
 *   - 使用 prompts/design.md 作为 system prompt（H5）
 *   - 不修改 quality.js / contracts.js（H1 / H3）
 *   - assessment.components 的 weight 总和必须 = 100，否则视为生成失败
 *   - inClass.phases 必须严格 5 段
 *
 * 数据流：
 *   IPC handler (v2:generateDesign) → 本 service.generate(...) → AI chatJson →
 *     parseDesignJson → normalizeDesign → db.createArtifact (type='design_doc', stage='design')
 */

const fs = require('fs');
const path = require('path');

const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

// ── JSON 解析（同 schedule.service 模式） ──────────────────────────────────────

function parseDesignJson(rawText) {
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

// ── 数据规整 + 兜底 ─────────────────────────────────────────────────────────

const REQUIRED_PHASES = ['导入新课', '知识讲授', '实操练习', '互查反馈', '总结升华'];

/**
 * Phase-9.5（2026-05-10）：lessonMeta 学时校验
 * 规则：
 *   - 总学时 (totalHours) ∈ [1, 4]，支持 0.5 步进
 *   - theoryHours + practiceHours = totalHours（允许小数：0.5/1/1.5/2/2.5/3/3.5/4）
 *   - 不符合 → 返回 warnings 数组（但不阻断生成）
 */
function validateLessonHours(theoryHours, practiceHours) {
  const warnings = [];
  const theory = Number(theoryHours) || 0;
  const practice = Number(practiceHours) || 0;
  const total = +(theory + practice).toFixed(2);

  // 检查总学时范围
  if (total < 1) warnings.push(`总学时 ${total} < 1，建议至少 1 学时`);
  if (total > 4) warnings.push(`总学时 ${total} > 4，超过单节课上限（大模型 token 限制）`);
  // 检查 0.5 步进（即必须是 0.5 的倍数）
  const isHalfStep = (v) => Math.abs(v * 2 - Math.round(v * 2)) < 0.001;
  if (!isHalfStep(theory)) warnings.push(`理论学时 ${theory} 不是 0.5 的倍数（仅支持 0.5/1/1.5/2/...）`);
  if (!isHalfStep(practice)) warnings.push(`实践学时 ${practice} 不是 0.5 的倍数`);

  return { theory, practice, total, warnings, valid: warnings.length === 0 };
}

function normalizeLessonMeta(meta, ctx = {}) {
  const m = meta || {};
  const hourCheck = validateLessonHours(m.theoryHours, m.practiceHours);
  return {
    lessonNumber: Number(m.lessonNumber) || ctx.lessonNumber || 1,
    topic: String(m.topic || ctx.topic || '').trim(),
    chapter: String(m.chapter || ctx.chapter || '').trim(),
    weekRange: String(m.weekRange || ctx.weekRange || '').trim(),
    theoryHours: hourCheck.theory,
    practiceHours: hourCheck.practice,
    totalHours: hourCheck.total,
    hoursWarnings: hourCheck.warnings,
    hoursValid: hourCheck.valid,
  };
}

function normalizeDesign(parsed, ctx = {}) {
  const safe = parsed || {};

  // 节课元信息（Phase-9.5：本节教学设计的"哪一节"）
  const lessonMeta = normalizeLessonMeta(safe.lessonMeta || ctx.lessonMeta, ctx);

  // 教学目标三类
  const objectives = safe.teachingObjectives || {};
  const teachingObjectives = {
    knowledge: arr(objectives.knowledge, 4),
    skill: arr(objectives.skill, 4),
    emotion: arr(objectives.emotion, 4),
  };

  // 重点难点
  const keyPoints = arr(safe.keyPoints, 5);
  const difficulties = arr(safe.difficulties, 5);

  // 教学方法
  let teachingMethods = Array.isArray(safe.teachingMethods) ? safe.teachingMethods : [];
  teachingMethods = teachingMethods
    .filter((m) => m && (typeof m === 'object' || typeof m === 'string'))
    .map((m) => typeof m === 'string'
      ? { name: m, desc: '', applicable: '' }
      : {
          name: String(m.name || '').trim(),
          desc: String(m.desc || '').trim(),
          applicable: String(m.applicable || '').trim(),
        })
    .filter((m) => m.name)
    .slice(0, 8);
  if (teachingMethods.length === 0) {
    teachingMethods = [{ name: '讲授法', desc: '系统讲解知识点', applicable: '理论部分' }];
  }

  // 教学资源
  const res = safe.teachingResources || {};
  const teachingResources = {
    textbook: String(res.textbook || ctx.textbook || '').trim(),
    supplementary: arr(res.supplementary, 5),
    platform: String(res.platform || '学习通').trim(),
    softwareTools: arr(res.softwareTools, 8),
    venues: arr(res.venues, 5),
  };

  // 课前/课中/课后
  const pre = safe.preClass || {};
  const preClass = {
    tasks: arr(pre.tasks, 8),
    expectedOutcome: String(pre.expectedOutcome || '').trim(),
  };

  // inClass.phases —— 严格 5 段，按 REQUIRED_PHASES 顺序兜底
  const inClassPhases = Array.isArray(safe.inClass?.phases) ? safe.inClass.phases : [];
  const phasesByName = {};
  inClassPhases.forEach((p) => {
    if (p && p.phase) phasesByName[String(p.phase).trim()] = p;
  });
  // 2026-05-15 v4.1.4：phase 名称带前缀（启/授/创/展/拓）也认作合法（向后兼容老数据）
  const phasesByPrefix = {};
  inClassPhases.forEach((p) => {
    if (!p?.phase) return;
    const trimmed = String(p.phase).trim();
    // 去掉前缀 "启·" "授·" "创·" "展·" "拓·" 取核心名
    const core = trimmed.replace(/^[启授创展拓]\s*[·．\.]\s*/, '');
    phasesByPrefix[core] = p;
    phasesByPrefix[trimmed] = p;     // 也按原名映射
  });
  const phases = REQUIRED_PHASES.map((requiredName, idx) => {
    const p = phasesByPrefix[requiredName] || phasesByName[requiredName] || {};
    // 2026-05-15 v4.1.4：evaluation → designIntent 重命名，含向后兼容
    //   优先用新字段 designIntent；老数据还在 evaluation 里 → 自动迁移
    const designIntent = String(p.designIntent || p.evaluation || '').trim();
    // 推荐 phase 名（带动作前缀，与 prompt 对齐）
    const RECOMMENDED_PREFIXES = ['启', '授', '创', '展', '拓'];
    const displayPhase = String(p.phase || '').trim() || `${RECOMMENDED_PREFIXES[idx] || ''}·${requiredName}`;
    return {
      phase: displayPhase,
      duration: String(p.duration || '—').trim(),
      teacherActions: String(p.teacherActions || '').trim(),
      studentActions: String(p.studentActions || '').trim(),
      designIntent,                                 // 2026-05-15 v4.1.4：新字段
      evaluation: designIntent,                     // 2026-05-15 v4.1.4：保留 evaluation 别名供下游兼容
    };
  });

  const post = safe.postClass || {};
  const postClass = {
    homework: arr(post.homework, 6),
    feedback: String(post.feedback || '').trim(),
    platforms: arr(post.platforms, 5),
  };

  // 信息化
  const info = safe.informatization || {};
  const informatization = {
    platform: String(info.platform || '学习通').trim(),
    tools: arr(info.tools, 6),
    purpose: String(info.purpose || '').trim(),
    industryPlatforms: arr(info.industryPlatforms, 5),
  };

  // 考核权重 —— 强校验：总和必须 = 100
  const assessment = safe.assessment || {};
  let components = Array.isArray(assessment.components) ? assessment.components : [];
  components = components
    .filter((c) => c && c.name)
    .map((c) => ({
      name: String(c.name).trim(),
      weight: Number(c.weight) || 0,
      criteria: String(c.criteria || '').trim(),
    }))
    .filter((c) => c.weight > 0)
    .slice(0, 5);

  // 权重和必须 = 100；若不是，按比例归一化
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  if (totalWeight > 0 && totalWeight !== 100) {
    components = components.map((c) => ({
      ...c,
      weight: Math.round((c.weight / totalWeight) * 100),
    }));
    // 再次校正凑足 100（解决四舍五入误差）
    const newSum = components.reduce((s, c) => s + c.weight, 0);
    if (newSum !== 100 && components.length > 0) {
      components[0].weight += (100 - newSum);
    }
  }

  // 兜底：components 为空 → 默认配置
  if (components.length === 0) {
    components = [
      { name: '日常表现', weight: 30, criteria: '考勤 + 课堂参与' },
      { name: '项目作品', weight: 40, criteria: '实训作品质量' },
      { name: '考试评价', weight: 30, criteria: '期末考试' },
    ];
  }

  const finalAssessment = {
    approach: String(assessment.approach || '').trim() || '过程考核为主，终结性评价为辅',
    components,
  };

  // 思政元素
  const ideologicalElements = arr(safe.ideologicalElements, 6);

  return {
    // Phase-9.5：节课元信息（本份设计对应"哪一节课"）
    lessonMeta,
    teachingObjectives,
    keyPoints,
    difficulties,
    teachingMethods,
    teachingResources,
    preClass,
    inClass: { phases },
    postClass,
    informatization,
    assessment: finalAssessment,
    ideologicalElements,
    _stats: {
      objectivesCount:
        teachingObjectives.knowledge.length +
        teachingObjectives.skill.length +
        teachingObjectives.emotion.length,
      methodsCount: teachingMethods.length,
      assessmentTotalWeight: components.reduce((s, c) => s + c.weight, 0),
      ideologicalCount: ideologicalElements.length,
      lessonTotalHours: lessonMeta.totalHours,
      lessonHoursWarnings: lessonMeta.hoursWarnings,
      generatedAt: new Date().toISOString(),
    },
  };
}

// 数组工具
function arr(value, maxLen) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v != null && String(v).trim().length > 0)
    .map((v) => String(v).trim())
    .slice(0, maxLen);
}

// ── 主入口：生成 ────────────────────────────────────────────────────────

/**
 * 生成教学设计（Phase-9.5：单节课 ≤4 学时）
 *
 * @param {Object} params
 * @param {Object} params.aiClient        - AI 客户端
 * @param {string} params.courseName
 * @param {Object} params.lessonMeta      - 节课元信息（必填）：lessonNumber/topic/chapter/theoryHours/practiceHours/weekRange
 * @param {Object} [params.scheduleData]  - 上游进度表
 * @param {Object} [params.courseContext] - 课程上下文
 */
async function generate({ aiClient, courseName, lessonMeta = {}, scheduleData = null, courseContext = {} }) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    return { success: false, error: '未提供有效的 AI 客户端（缺少 chatJson 方法）' };
  }
  if (!courseName) {
    return { success: false, error: '课程名（courseName）不能为空' };
  }
  if (!lessonMeta.topic) {
    return { success: false, error: '本节主题（lessonMeta.topic）不能为空' };
  }

  // Phase-9.5：学时校验（警告但不阻断）
  const hourCheck = validateLessonHours(lessonMeta.theoryHours, lessonMeta.practiceHours);
  if (hourCheck.warnings.length > 0) {
    console.warn('[design.service] lesson hours warnings:', hourCheck.warnings.join(' / '));
  }

  const systemPrompt = loadPrompt('design');
  // T8 修复（2026-05-17）：1 学时 = N 分钟由老师按学校标准配置，无兜底
  const minutesPerHour = Number(courseContext.minutesPerHour) || 0;
  if (minutesPerHour <= 0) {
    return { success: false, error: '缺少"1 学时分钟数"（minutesPerHour）。请在创建笔记本时填写学校标准（如 40 / 45 / 50）。' };
  }
  const totalMin = hourCheck.total * minutesPerHour;

  const ctxLines = [
    `课程名称：${courseName}`,
    courseContext.school ? `学校：${courseContext.school}` : '',   // T7：删硬编码"广州纺校"
    '',
    '## 【本节定位 - 重要】',
    `本节序号：第 ${lessonMeta.lessonNumber || 1} 节`,
    `本节主题：${lessonMeta.topic}`,
    lessonMeta.chapter ? `对应章节：${lessonMeta.chapter}` : '',
    lessonMeta.weekRange ? `周次范围：${lessonMeta.weekRange}` : '',
    `本节学时：理论 ${hourCheck.theory} + 实践 ${hourCheck.practice} = ${hourCheck.total} 学时（按 1 学时 = ${minutesPerHour} 分钟换算 = ${totalMin} 分钟）`,
    `⚠ 重要：本课程 1 学时 = ${minutesPerHour} 分钟（学校标准，不要假设 45 或 90）`,
    '⚠ 本设计仅覆盖【这一节课】，不要写整门课的内容！教学目标 / 重难点 / 5 段法 / 考核都围绕本节展开。',
    '',
    courseContext.totalHours ? `（整门课总学时：${courseContext.totalHours}，仅供参考；本设计只针对上面这一节）` : '',
    courseContext.textbook ? `教材：${courseContext.textbook}` : '',
    courseContext.softwareTools ? `软件工具：${courseContext.softwareTools}` : '',
    courseContext.jobTargets ? `面向岗位：${courseContext.jobTargets}` : '',
    courseContext.industryScenarios ? `行业场景：${courseContext.industryScenarios}` : '',
    courseContext.learnerProfile ? `学情：${courseContext.learnerProfile}` : '',
  ].filter(Boolean);

  // 如有进度表，把章节结构 + 实训类目作为参考喂给 AI
  let scheduleHint = '';
  if (scheduleData) {
    const chapters = [];
    const seen = new Set();
    (scheduleData.schedule || []).forEach((row) => {
      if (row.chapter && !seen.has(row.chapter)) {
        chapters.push(row.chapter);
        seen.add(row.chapter);
      }
    });
    scheduleHint = [
      '## 上游进度表参考',
      `章节：${chapters.join(' / ') || '（未分章节）'}`,
      scheduleData.experimentTopics?.length ? `实训类目：${scheduleData.experimentTopics.join(' / ')}` : '',
      scheduleData.objective ? `进度表的整体目标：${scheduleData.objective}` : '',
    ].filter(Boolean).join('\n');
  }

  const userPrompt = [
    '## 课程基础信息',
    ctxLines.join('\n'),
    '',
    scheduleHint,
    '',
    '## 任务',
    `基于以上信息，生成【这一节课】（第 ${lessonMeta.lessonNumber || 1} 节「${lessonMeta.topic}」）的教学设计 JSON。`,
    `本节总时长 ${hourCheck.total} 学时 ≈ ${totalMin} 分钟（理论 ${hourCheck.theory} + 实践 ${hourCheck.practice}）。`,
    '',
    '严格遵守：',
    '- 本设计仅覆盖【本节课】，不要写整学期内容',
    '- inClass.phases 必须 5 段（导入新课/知识讲授/实操练习/互查反馈/总结升华）',
    `- 5 段法总时长约等于 ${totalMin} 分钟（教学过程加起来 = 本节时长）`,
    '- 单段时长 ≤ 30 分钟（学生注意力极限，超过必须拆分）',
    '- assessment.components 的 weight 总和必须 = 100',
    '- ideologicalElements 必须 2-4 条',
    `- preClass.tasks 是【本节】课前任务，不是整学期；postClass.homework 是【本节】课后`,
    '',
    '## 严格输出要求',
    '只返回 JSON 对象，以 { 开头，以 } 结尾。不需要 lessonMeta 字段（前端会注入）。',
  ].filter(Boolean).join('\n');

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
    parsed = parseDesignJson(rawText);
  } catch (e) {
    return { success: false, error: e.message, raw: String(rawText || '').slice(0, 500) };
  }

  const design = normalizeDesign(parsed, {
    textbook: courseContext.textbook,
    // Phase-9.5：把节课元信息传给 normalize（无论 AI 是否输出，都以前端传入为准）
    lessonMeta,
  });

  return { success: true, data: { design, raw: rawText } };
}

// ── 自检 ────────────────────────────────────────────────────────────────────

function selfCheck() {
  const checks = [];

  checks.push({
    name: 'prompts/design.md 可加载',
    pass: (() => {
      try {
        const p = loadPrompt('design');
        return typeof p === 'string' && p.length > 500;
      } catch {
        return false;
      }
    })(),
  });

  checks.push({
    name: 'parseDesignJson 处理合法 JSON',
    pass: (() => {
      try {
        const r = parseDesignJson('{"foo":"bar"}');
        return r.foo === 'bar';
      } catch {
        return false;
      }
    })(),
  });

  checks.push({
    name: 'parseDesignJson 处理 markdown 包裹',
    pass: (() => {
      try {
        const r = parseDesignJson('```json\n{"foo":"bar"}\n```');
        return r.foo === 'bar';
      } catch {
        return false;
      }
    })(),
  });

  checks.push({
    name: 'normalizeDesign inClass.phases 严格 5 段',
    pass: (() => {
      const r = normalizeDesign({ inClass: { phases: [{ phase: '导入新课', duration: '10' }] } });
      return r.inClass.phases.length === 5;
    })(),
  });

  checks.push({
    name: 'normalizeDesign phases 顺序固定',
    pass: (() => {
      // AI 输出顺序乱了，应按 REQUIRED_PHASES 重排
      const r = normalizeDesign({
        inClass: {
          phases: [
            { phase: '总结升华', duration: '5' },
            { phase: '导入新课', duration: '10' },
          ],
        },
      });
      return r.inClass.phases[0].phase === '导入新课' && r.inClass.phases[4].phase === '总结升华';
    })(),
  });

  checks.push({
    name: 'normalizeDesign weight 总和归一化为 100',
    pass: (() => {
      const r = normalizeDesign({
        assessment: {
          components: [
            { name: 'A', weight: 30 },
            { name: 'B', weight: 40 },
            { name: 'C', weight: 50 },  // 总和 120
          ],
        },
      });
      const sum = r.assessment.components.reduce((s, c) => s + c.weight, 0);
      return sum === 100;
    })(),
  });

  checks.push({
    name: 'normalizeDesign 缺 components 时给默认',
    pass: (() => {
      const r = normalizeDesign({});
      return r.assessment.components.length >= 3 &&
        r.assessment.components.reduce((s, c) => s + c.weight, 0) === 100;
    })(),
  });

  checks.push({
    name: 'normalizeDesign 空数组字段不崩溃',
    pass: (() => {
      try {
        normalizeDesign({});
        return true;
      } catch {
        return false;
      }
    })(),
  });

  checks.push({
    name: 'normalizeDesign teachingMethods 兜底',
    pass: (() => {
      const r = normalizeDesign({ teachingMethods: [] });
      return r.teachingMethods.length >= 1;
    })(),
  });

  checks.push({
    name: 'normalizeDesign 教学方法字符串数组也接受',
    pass: (() => {
      const r = normalizeDesign({ teachingMethods: ['案例法', '任务驱动'] });
      return r.teachingMethods.length === 2 && r.teachingMethods[0].name === '案例法';
    })(),
  });

  checks.push({
    name: 'normalizeDesign _stats 含核心数字',
    pass: (() => {
      const r = normalizeDesign({});
      return typeof r._stats?.assessmentTotalWeight === 'number' &&
        r._stats.assessmentTotalWeight === 100;
    })(),
  });

  const passed = checks.filter((c) => c.pass).length;
  return { total: checks.length, passed, checks };
}

module.exports = {
  generate,
  selfCheck,
  REQUIRED_PHASES,
  validateLessonHours,    // Phase-9.5：供前端/handler 学时校验复用
  normalizeLessonMeta,
  _internal: { parseDesignJson, normalizeDesign, loadPrompt },
};
