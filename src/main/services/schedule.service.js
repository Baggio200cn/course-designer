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

// 2026-05-15 v4.1.3：引入字段别名归一化（兼容 DeepSeek/ChatGPT/文心 等外部 AI 的命名）
const aliasResolver = require('./schedule-alias-resolver');

/**
 * 2026-05-15 老师反馈 4.1 加固：宽容 JSON 解析
 *
 * 老师在 UI"JSON 编辑模式"手改进度表后，常见错误：
 *   - 中文引号 "" '' 误当成 JSON 字符串引号
 *   - 行尾遗留逗号（如 "key": "value",})
 *   - 注释行（双斜杠 或 块注释）残留
 *   - 误删字段大括号
 *   - 字段名用了外部 AI 的命名（如 metadata / teachingMethod / homeworkCount）
 *
 * 策略：宽容修正 + 字段别名归一化 + 失败时返回精确行列定位
 *
 * @returns {{
 *   data?: Object, error?: string, line?: number, column?: number,
 *   repaired?: boolean, aliasesUsed?: string[], importWarnings?: string[]
 * }}
 */
function tolerantParseSchedule(rawText) {
  if (!rawText || !String(rawText).trim()) {
    return { error: '内容为空' };
  }

  const original = String(rawText);

  // 先尝试严格 parse（如果用户没改坏，最快路径）
  try {
    const obj = parseScheduleJson(original);
    // 2026-05-15 v4.1.3：parse 成功后做别名归一化（兼容外部 AI 命名）
    const aliasResult = aliasResolver.importWithAliases(obj);
    return {
      data: aliasResult.data,
      repaired: false,
      aliasesUsed: aliasResult.aliasesUsed,
      importWarnings: aliasResult.warnings,
    };
  } catch (strictErr) {
    // 失败 → 进入宽容修正流程
    let candidate = original;

    // 1) 去 markdown 代码块
    const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) candidate = fenced[1];

    // 2) 取第一个 { 到最后一个 }
    const s = candidate.indexOf('{');
    const e = candidate.lastIndexOf('}');
    if (s < 0 || e < s) {
      return { error: '未找到 JSON 对象结构（缺少 { 或 }）' };
    }
    candidate = candidate.slice(s, e + 1);

    // 3) 中文引号 → 英文双引号（"" '' → ""）
    candidate = candidate
      .replace(/[“”]/g, '"')   // " " → "
      .replace(/[‘’]/g, '"');  // ' ' → "  （JSON 不支持单引号，统一转双引号）

    // 4) 去单行注释（// xxx）和块注释（/* xxx */）
    candidate = candidate
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    // 5) 去尾逗号（,} 或 ,])
    candidate = candidate.replace(/,(\s*[}\]])/g, '$1');

    // 6) 重试 parse + alias 归一化
    try {
      const parsed = JSON.parse(candidate);
      const aliasResult = aliasResolver.importWithAliases(parsed);
      return {
        data: aliasResult.data,
        repaired: true,
        aliasesUsed: aliasResult.aliasesUsed,
        importWarnings: aliasResult.warnings,
      };
    } catch (repairErr) {
      // 解析位置信息（如果是 SyntaxError，msg 通常含 position N）
      const posMatch = String(repairErr.message).match(/position\s+(\d+)/i);
      let line = 1, column = 1;
      if (posMatch) {
        const pos = Number(posMatch[1]);
        const before = candidate.slice(0, pos);
        line = (before.match(/\n/g) || []).length + 1;
        column = before.length - Math.max(0, before.lastIndexOf('\n')) - 1;
        column = column < 1 ? 1 : column;
      }
      return {
        error: `JSON 仍无法解析（已尝试自动修复）：${repairErr.message}`,
        line, column,
      };
    }
  }
}

/**
 * 2026-05-15 老师反馈 4.1 加固：手编后的对象 normalize 兜底
 *
 * 老师在 UI JSON 模式下可能：
 *   - 删了下游需要的字段（如 evaluation / methods）
 *   - 粘贴了外部 AI 的命名（metadata / teachingMethod / homeworkCount）
 *
 * 调用此函数自动 alias 归一化 + 补齐合法结构，避免下游崩。
 *
 * @param {Object} rawObj   - 解析后的对象（来自 tolerantParseSchedule.data 或直接粘贴）
 * @param {Object} ctx      - 上下文（teacher/className/totalHours 等老师输入）
 * @returns {Object}        - 标准化后的 schedule，附带 _importAudit
 */
function normalizeFromUserEdit(rawObj, ctx = {}) {
  // 2026-05-15 v4.1.3：先做 alias 归一化（防止外部 AI 命名）
  const aliasResult = aliasResolver.importWithAliases(rawObj || {});
  const normalized = normalizeSchedule(aliasResult.data, ctx);
  // 把 import 审计也附在结果上
  if (aliasResult.aliasesUsed.length > 0 || aliasResult.warnings.length > 0) {
    normalized._importAudit = {
      aliasesUsed: aliasResult.aliasesUsed,
      warnings: aliasResult.warnings,
    };
  }
  return normalized;
}

// ── Schedule 数据校验 + 兜底 ──────────────────────────────────────────────────

function normalizeSchedule(parsed, ctx = {}) {
  const safe = parsed || {};
  const header = safe.header || {};
  const evaluation = safe.evaluation || {};

  // T7 修复（2026-05-17）：反编造铁律——禁止用任何硬编码学时兜底
  //   旧逻辑 `|| 72` 在老师没填时静默把所有课变 72 学时（编造）。
  //   现在：优先用 AI 输出 → 老师 ctx 输入 → 缺失则保持 0 让上层显式报错。
  const totalHours = Number(header.totalHours) || Number(ctx.totalHours) || 0;
  const theoryHours = Number(header.theoryHours) || (totalHours > 0 ? Math.floor(totalHours * 0.5) : 0);
  const practiceHours = Number(header.practiceHours) || (totalHours > 0 ? Math.floor(totalHours * 0.4) : 0);
  const examHours = Number(header.examHours) || Math.max(0, totalHours - theoryHours - practiceHours);
  // T8 修复（2026-05-17）：1 学时 = N 分钟由老师按学校标准配置，无兜底
  const minutesPerHour = Number(header.minutesPerHour) || Number(ctx.minutesPerHour) || 0;

  // 学校简称兜底
  const school = String(header.school || ctx.school || '广州纺校').trim();

  // 2026-05-15 v4.1.4：每次课学时数（用户指定）
  //   - ctx.hoursPerSession：老师在 UI 选的
  //   - safe.header.hoursPerSession：已存进度表里带的（兼容老数据）
  //   - 若都没有，回算 totalHours / schedule.length（老数据修复）
  let hoursPerSession = Number(ctx.hoursPerSession) || Number(header.hoursPerSession) || 0;

  // schedule 数组校验
  // 2026-05-15 v4.1.2：调整过滤策略——
  //   旧：content 为空就丢弃整行，会让老师 JSON 编辑时 content 漏改一两个就被吃掉
  //   新：保留行结构，content 为空时填占位文字（让老师看到"哪一行漏了"）
  let schedule = Array.isArray(safe.schedule) ? safe.schedule : [];
  schedule = schedule
    .map((row, i) => {
      // T4 修复（2026-05-17）+ T6 修复（2026-05-17）：chapter 标准化 + idempotent
      //   ① AI 经常给 '一'/'一（续）'/'一（实训）'/'第一章'/'1' 等 5 种变体，
      //      下游按 chapter 聚合会把同章拆 N 份。这里拆成 chapter（主章号）+ chapterSub（副标签）。
      //   ② idempotent 保证：第二次 normalize 一份已标准化的数据时，
      //      不能把 chapterSub/chapterDisplay 清空（否则老数据走 saveSchedule 时副字段会丢）。
      //   规则：优先复用已有 chapterSub/chapterDisplay；只在缺失时从 rawChapter 解析。
      const rawChapter = String(row?.chapter || '').trim();
      const existingSub = String(row?.chapterSub || '').trim();
      const existingDisplay = String(row?.chapterDisplay || '').trim();
      const subMatch = rawChapter.match(/[（(]([^）)]+)[）)]\s*$/);
      const chapterMain = rawChapter.replace(/[（(]([^）)]+)[）)]\s*$/, '').replace(/^第|章$/g, '').trim();
      const chapterSub = existingSub || (subMatch ? subMatch[1].trim() : '');
      const chapterDisplay = existingDisplay
        || (chapterSub && !rawChapter.includes('（') && !rawChapter.includes('(')
            ? `${chapterMain}（${chapterSub}）`
            : rawChapter);
      return {
        week: Number(row?.week) || i + 1,
        session: Number(row?.session) || i + 1,
        chapter: chapterMain,         // T4：聚合字段（'一'/'二'/...）
        chapterSub,                   // T4：副标签（'续'/'实训'/...）
        chapterDisplay,               // T4 + T6：UI 原样显示（'一（实训）'）
        content: String(row?.content || '').trim() || `[第 ${i + 1} 行内容缺失，请补充]`,
        hours: Number(row?.hours) || hoursPerSession || 0,   // T7：禁止硬编码兜底 4，上层校验
        method: String(row?.method || '讲授').trim(),
        homework: Number(row?.homework) || 0,
        // 2026-05-17 v4.2.0 Step 1.6：保留 AI 输出的"为什么选这套"理由 + 其他候选组合，供 UI 💡 按钮显示
        _methodReasoning: row?._methodReasoning ? String(row._methodReasoning).trim().slice(0, 200) : '',
        methodAlternatives: Array.isArray(row?.methodAlternatives)
          ? row.methodAlternatives.filter(Boolean).map(String).slice(0, 4)
          : [],
      };
    })
    .sort((a, b) => a.week - b.week || a.session - b.session);

  // 2026-05-15 v4.1.4：若没有 hoursPerSession，从老数据回算 + 写回 header（选项 B：自动回塑）
  if (!hoursPerSession && schedule.length > 0 && Number(totalHours) > 0) {
    const computed = Number(totalHours) / schedule.length;
    // 只在能精确除（无小数尾巴）时回算，避免错误污染
    if (Number.isFinite(computed) && computed > 0) {
      hoursPerSession = +computed.toFixed(2);
      console.log(`[schedule.service] 老数据回塑：hoursPerSession = ${hoursPerSession}（${totalHours} / ${schedule.length}）`);
    }
  }

  // 2026-05-15：学时守恒检查 + 自动校正
  const computedTotalHours = schedule.reduce((s, r) => s + (Number(r.hours) || 0), 0);
  const targetTotalHours = Number(totalHours) || 0;
  const hoursMismatch = targetTotalHours > 0 && Math.abs(computedTotalHours - targetTotalHours) > 0.01;
  if (hoursMismatch && schedule.length > 0) {
    // 学时不守恒——按比例缩放（保住总学时一致），并打 warning
    const ratio = targetTotalHours / computedTotalHours;
    schedule = schedule.map((r) => ({
      ...r,
      // T7：禁止硬编码兜底；缩放只对已有学时的行做；hours=0 的行不参与缩放
      hours: r.hours > 0 ? Math.round(Number(r.hours) * ratio * 2) / 2 : 0,
    }));
    // 缩放后小数误差可能仍存在，最后一行兜底
    const afterScale = schedule.reduce((s, r) => s + r.hours, 0);
    const delta = targetTotalHours - afterScale;
    if (Math.abs(delta) > 0.01 && schedule.length > 0) {
      schedule[schedule.length - 1].hours = Math.max(0.5, schedule[schedule.length - 1].hours + delta);
    }
    console.warn(`[schedule.service] 学时不守恒：AI 输出合计 ${computedTotalHours} ≠ 目标 ${targetTotalHours}，已按比例缩放`);
  }

  // 2026-05-15 老师反馈 4.3 加固：反编造断言
  //   ↓ 问题：旧逻辑 `header.teacher || ctx.teacher` 在 AI 编造时（如返回"张静"）会优先 AI，
  //     掩盖老师真实输入。修法：**输入非空时强制覆盖 AI 输出**（assertion guard）。
  // 2026-05-15 P2-6 加固：把"AI 编了什么、被强制覆盖了什么"收集成 audit 数组返回，
  //   供前端绿色提示条显示"系统已修正 AI 编造的 X 字段"。
  const fabricationCorrections = [];
  const safeUserField = (fieldName, ctxVal, aiVal, fallback = '') => {
    const ctxClean = String(ctxVal || '').trim();
    const aiClean = String(aiVal || '').trim();
    if (ctxClean) {
      // 老师有输入：必须用输入。若 AI 输出非空且不同 → 记录被覆盖的编造值
      if (aiClean && aiClean !== ctxClean) {
        fabricationCorrections.push({
          field: fieldName,
          aiValue: aiClean,
          correctedTo: ctxClean,
        });
      }
      return ctxClean;
    }
    return aiClean || fallback;
  };
  const finalTeacher = safeUserField('teacher', ctx.teacher, header.teacher);
  const finalClassName = safeUserField('className', ctx.className, header.className);
  const finalSemester = safeUserField('semester', ctx.semester, header.semester);
  const finalTextbook = safeUserField('textbook', ctx.textbook, header.textbook);
  // 2026-05-15 v4.1.4：courseName 也走反编造断言（之前 AI 会偷偷改老师填的课程名）
  const finalCourseName = safeUserField('courseName', ctx.courseName, header.courseName) || '课程';
  // department 也加（虽然非必填，但老师填了就不应被 AI 改）
  const finalDepartment = safeUserField('department', ctx.department, header.department);
  // 审计日志（保留）+ 返回给上层（新增）
  fabricationCorrections.forEach((c) => {
    console.warn(`[schedule.service] AI 编造 ${c.field}="${c.aiValue}"，已强制覆盖回输入"${c.correctedTo}"`);
  });
  return {
    header: {
      courseName: finalCourseName,                    // 2026-05-15 v4.1.4：走反编造断言
      teacher: finalTeacher,
      school,
      department: finalDepartment,                    // 2026-05-15 v4.1.4：走反编造断言
      semester: finalSemester,
      className: finalClassName,
      textbook: finalTextbook,
      totalHours,
      theoryHours,
      practiceHours,
      examHours,
      hoursPerSession,                                // 2026-05-15 v4.1.4：每次课学时数
      minutesPerHour,                                 // T8 修复（2026-05-17）：1 学时 = N 分钟（老师按学校标准配）
    },
    // 2026-05-15 P2-6 + T2 修复（2026-05-17）：审计永不返 null（防止静默跳过被误读为"无编造"）
    _fabricationAudit: {
      status: fabricationCorrections.length > 0 ? 'corrected' : 'no_corrections_needed',
      corrections: fabricationCorrections,
      count: fabricationCorrections.length,
      checkedFields: ['courseName', 'teacher', 'school', 'department', 'semester', 'className', 'textbook'],
      auditedAt: new Date().toISOString(),
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
    // T3 修复（2026-05-17）：expectedRowCount 旧实现误把"总学时"当"应有行数"，
    //   会让下游"rowCount===expectedRowCount"断言永远 false。
    //   正确：expectedRowCount = sessionCount = totalHours / hoursPerSession（即"次课数"），
    //   并把"总学时"另存到 expectedTotalHours，命名清楚不再撞。
    _stats: (() => {
      const expectedRow = hoursPerSession > 0 ? Math.floor(totalHours / hoursPerSession) : null;
      const actualTotal = schedule.reduce((s, r) => s + (Number(r.hours) || 0), 0);
      return {
        scheduleRowCount: schedule.length,
        expectedRowCount: expectedRow,
        rowCountMatch: expectedRow == null ? null : (schedule.length === expectedRow),
        expectedTotalHours: totalHours,
        actualTotalHours: actualTotal,
        totalHoursMatch: Math.abs(actualTotal - totalHours) < 0.01,
        hoursPerSession,
        chapterUniqueCount: new Set(schedule.map(r => r.chapter).filter(Boolean)).size,  // T4 配套：标准化后的章数
        generatedAt: new Date().toISOString(),
      };
    })(),
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

  // 2026-05-15 v4.1.4：必须有 hoursPerSession（无默认值，强制老师提供）
  const hoursPerSession = Number(courseContext.hoursPerSession) || 0;
  if (!hoursPerSession || hoursPerSession <= 0) {
    return {
      success: false,
      error: '缺少"每次课学时数"。请在创建笔记本或"编辑上文"中填写（如 2 或 4 学时/次）。',
    };
  }
  const totalH = Number(courseContext.totalHours) || 0;
  if (!totalH || totalH <= 0) {
    return { success: false, error: '缺少总学时——AI 应从老师上传的课程标准 rawText 里识别，未识别到时由老师 UI 补填' };
  }
  // T8 修复（2026-05-17）：minutesPerHour 必填（无兜底）
  const minutesPerHour = Number(courseContext.minutesPerHour) || 0;
  if (!minutesPerHour || minutesPerHour <= 0) {
    return { success: false, error: '缺少"1 学时分钟数"。请在创建笔记本时填写学校标准（如 40 / 45 / 50）。' };
  }
  const sessionCount = Math.floor(totalH / hoursPerSession);
  if (sessionCount < 1) {
    return { success: false, error: `总学时(${totalH}) 必须大于每次课学时(${hoursPerSession})` };
  }

  // T7+T8：删除"学校：广州纺校"硬编码兜底；school 为空时 AI 应基于 rawText 识别
  const contextLines = [
    `课程名称：${courseName}`,
    courseContext.teacher ? `教师姓名：${courseContext.teacher}` : '',
    courseContext.school ? `学校：${courseContext.school}` : '',
    courseContext.department ? `教学部：${courseContext.department}` : '',
    courseContext.semester ? `学期：${courseContext.semester}` : '',
    courseContext.className ? `班级：${courseContext.className}` : '',
    courseContext.textbook ? `教材：${courseContext.textbook}` : '',
    `总学时：${totalH}`,
    courseContext.theoryHours ? `理论学时：${courseContext.theoryHours}` : '',
    courseContext.practiceHours ? `实践学时：${courseContext.practiceHours}` : '',
    `每次课学时：${hoursPerSession}（铁律：每行 hours 必须 === ${hoursPerSession}）`,
    `每学时分钟数：${minutesPerHour}（铁律：所有 duration 字段按此换算，不要假设 45 或 90）`,  // T8
    `应生成行数：${sessionCount}（= ${totalH} / ${hoursPerSession}）`,
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
    '【关键铁律】',
    `  schedule[] 必须有 **${sessionCount} 行**`,
    `  每行 hours **必须严格等于 ${hoursPerSession}**（无差错，禁止 AI 自行调整）`,
    `  合计学时必须 === ${totalH}`,
    '  header.hoursPerSession 字段必须填 ' + hoursPerSession,
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
    semester: courseContext.semester,
    department: courseContext.department,
    // 2026-05-15 v4.1.4：每次课学时（生成阶段必填，传给 normalize 做严格校验）
    hoursPerSession,
    minutesPerHour,    // T8：1 学时 = N 分钟（老师按学校标准配，service 严格校验）
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
    name: 'normalizeSchedule 缺 content 字段保留占位（2026-05-15 v4.1.2 策略变更）',
    pass: (() => {
      const r = normalizeSchedule({ schedule: [{ week: 1, content: '' }] });
      // 旧策略：过滤掉 → length=0
      // 新策略：保留行 + 填占位文字 → length=1 + content 含"缺失"
      return r.schedule.length === 1
        && typeof r.schedule[0].content === 'string'
        && r.schedule[0].content.includes('缺失');
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
  // 2026-05-15 加固 4.1：暴露宽容解析 + 用户编辑 normalize，供 saveSchedule handler 调用
  tolerantParseSchedule,
  normalizeFromUserEdit,
  // 暴露内部工具供 verify 测试
  _internal: { parseScheduleJson, normalizeSchedule, loadPrompt },
};
