/**
 * schedule-alias-resolver.js
 *
 * 进度表 JSON 字段名智能兼容（2026-05-15 v4.1.3 加固）
 *
 * 背景：
 *   老师常用工作流——把 Word 上传到 DeepSeek/ChatGPT/文心 → 让 AI 转 JSON → 粘到驭课。
 *   但外部 AI 用自己的字段命名（如 teachingMethod / homeworkCount / metadata），
 *   与驭课 schema 不一致，导致静默"走默认值"——老师看到"方式全是讲授""作业全是 /"以为 bug。
 *
 * 修复策略：
 *   - 在 normalize 之前做一层"别名归一化"，把已知外部 AI 命名映射到我们的 canonical 字段
 *   - 同时收集"哪些字段是用别名传入的""哪些行缺关键字段"——返回 warnings 供 UI 显示
 *
 * 覆盖的外部工具：
 *   - DeepSeek（teachingMethod/homeworkCount/practicalTrainingCategories）
 *   - ChatGPT（goals/instructionMethod/lessons）
 *   - 文心一言（类似 ChatGPT 命名）
 */

// ── 别名表（外部命名 → 我们的 canonical 命名）─────────────────────────────
// 顺序：先匹配最长/最具体的，再短的。Object 字面量按定义顺序遍历。
const FIELD_ALIASES = {
  // ─── Top-level 字段 ───────────────────────────────────────────────
  'metadata': 'header',                    // DeepSeek 常用 metadata 包装 header
  'meta': 'header',
  'info': 'header',
  'teachingObjectives': 'objective',       // DeepSeek
  'objectives': 'objective',               // ChatGPT
  'goals': 'objective',
  'learningObjectives': 'objective',
  'practicalTrainingCategories': 'experimentTopics',  // DeepSeek
  'practicalTopics': 'experimentTopics',
  'trainingTopics': 'experimentTopics',
  'experimentalTopics': 'experimentTopics',
  'labTopics': 'experimentTopics',
  'lessons': 'schedule',                   // ChatGPT 有时用 lessons
  'classes': 'schedule',
  'sessions': 'schedule',
  'syllabus': 'schedule',
  'notes': 'additionalNotes',
  'remarks': 'additionalNotes',
  'memo': 'additionalNotes',

  // ─── Header 内部字段 ─────────────────────────────────────────────
  'course': 'courseName',                  // DeepSeek
  'courseTitle': 'courseName',
  'subject': 'courseName',
  'instructor': 'teacher',                 // ChatGPT
  'professor': 'teacher',
  'teacherName': 'teacher',
  'class': 'className',                    // DeepSeek
  'classGroup': 'className',
  'studentGroup': 'className',
  'assessmentHours': 'examHours',          // DeepSeek
  'examinationHours': 'examHours',
  'evaluationHours': 'examHours',
  'theoryHrs': 'theoryHours',
  'practiceHrs': 'practiceHours',
  'totalHrs': 'totalHours',
  'departmentName': 'department',
  'major': 'department',
  // 2026-05-15 v4.1.4：每次课学时数
  'hoursPerClass': 'hoursPerSession',
  'lessonHours': 'hoursPerSession',
  'sessionDuration': 'hoursPerSession',
  'classDuration': 'hoursPerSession',
  'periodHours': 'hoursPerSession',

  // ─── Schedule 行内字段 ───────────────────────────────────────────
  'teachingMethod': 'method',              // DeepSeek
  'instructionMethod': 'method',           // ChatGPT
  'pedagogyMethod': 'method',
  'methodName': 'method',
  'homeworkCount': 'homework',             // DeepSeek
  'assignmentCount': 'homework',
  'assignments': 'homework',
  'sessionNumber': 'session',
  'sessionIndex': 'session',
  'classOrder': 'session',
  'lessonNumber': 'session',                // 注意：lesson 是节课，与 session 在我们 schema 是同义
  'weekNumber': 'week',
  'weekIndex': 'week',
  'weekNo': 'week',
  'classHours': 'hours',                   // 备选学时字段名
  'hoursCount': 'hours',
  'duration': 'hours',
  'sectionTitle': 'chapter',
  'chapterName': 'chapter',
  'unitName': 'chapter',
  'topic': 'content',
  'lessonContent': 'content',
  'description': 'content',                // ⚠ 这个比较危险，header 也可能有 description——下面单独保护

  // ─── Evaluation 内部字段 ─────────────────────────────────────────
  'method': 'approach',     // ⚠ 同名冲突！evaluation.method（DeepSeek）→ approach
  // 注意：上面 schedule[].method 不变（schedule 内 method 是我们的目标字段）
  // 这种冲突需要在 mapAliases 函数里按"父字段路径"区分处理
};

// 这些是 schema 中既存的合法字段，**永远不要把它们当作别名映射的源**
// 比如不能让 'description' 在 header 上下文里被映射成 'content'
const PROTECTED_KEYS_BY_CONTEXT = {
  header: new Set(['description', 'department', 'class', 'method']),  // header 内的 description 是合法字段
  evaluation: new Set(['method']),  // evaluation.method 不要错映射到 schedule.method
  // P6 bug 修复（2026-05-18）：schedule[] 行级别的 method 是合法字段，禁止被映射成 approach
  //   原因：FIELD_ALIASES 表有 'method':'approach'（给 evaluation 上下文用），
  //   但 mapAliasesDeep 在 schedule[] 上下文也会查这个表 → 把老师改的"讲授+案例分析法"误映射成 approach 字段 → normalize 时找不到 method 兜底成"讲授" → 老师以为保存失败
  'schedule[]': new Set(['method', 'hours', 'homework', 'content', 'week', 'session', 'chapter', 'chapterSub', 'chapterDisplay']),
};

/**
 * 递归映射别名 + 收集 warnings
 *
 * @param {*} obj          - 输入对象
 * @param {string} context - 当前在哪个 context（'root' | 'header' | 'evaluation' | 'schedule[]'）
 * @param {Set<string>} aliasesUsed - 收集已用别名（外部）
 * @returns {*}
 */
function mapAliasesDeep(obj, context = 'root', aliasesUsed) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    // schedule[] 数组里每个元素 → 上下文是 'schedule[]'
    const itemContext = context === 'schedule' ? 'schedule[]' : context;
    return obj.map((item) => mapAliasesDeep(item, itemContext, aliasesUsed));
  }
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    // 如果当前 context 里这个 key 是受保护的，不映射
    const protectedKeys = PROTECTED_KEYS_BY_CONTEXT[context];
    if (protectedKeys && protectedKeys.has(key)) {
      out[key] = mapAliasesDeep(val, _childContext(context, key), aliasesUsed);
      continue;
    }
    // 特殊：evaluation 上下文里 'method' 映射到 'approach'（评价方式）
    if (context === 'evaluation' && key === 'method') {
      aliasesUsed.add(`evaluation.method → approach`);
      out['approach'] = mapAliasesDeep(val, 'evaluation.approach', aliasesUsed);
      continue;
    }
    // 通用别名查表
    if (FIELD_ALIASES[key] !== undefined) {
      const canonical = FIELD_ALIASES[key];
      aliasesUsed.add(`${key} → ${canonical}`);
      out[canonical] = mapAliasesDeep(val, _childContext(context, canonical), aliasesUsed);
    } else {
      out[key] = mapAliasesDeep(val, _childContext(context, key), aliasesUsed);
    }
  }
  return out;
}

function _childContext(parent, key) {
  if (parent === 'root') {
    if (key === 'header') return 'header';
    if (key === 'evaluation') return 'evaluation';
    if (key === 'schedule') return 'schedule';
  }
  return parent;
}

/**
 * 检测 schedule 行级别的字段缺失（用于 import warnings）
 *
 * 在 alias 映射后调用——此时 row.method/homework/hours 都应是 canonical 名。
 * 但需要回头看 RAW 对象，判断是否真的缺（vs 仅是用了别名）。
 *
 * @param {Object} mappedData  - 已 alias 映射的对象
 * @param {Object} rawData     - 映射前的对象
 * @returns {string[]} warnings
 */
function detectScheduleFieldGaps(mappedData, rawData) {
  const warnings = [];
  const mappedSchedule = Array.isArray(mappedData.schedule) ? mappedData.schedule : [];
  const rawSchedule = Array.isArray(rawData.schedule) ? rawData.schedule
                    : Array.isArray(rawData.lessons) ? rawData.lessons
                    : Array.isArray(rawData.classes) ? rawData.classes
                    : Array.isArray(rawData.sessions) ? rawData.sessions
                    : Array.isArray(rawData.syllabus) ? rawData.syllabus
                    : [];

  if (mappedSchedule.length === 0) return warnings;

  let missMethod = 0, missHomework = 0, missHours = 0;
  for (let i = 0; i < rawSchedule.length; i++) {
    const raw = rawSchedule[i] || {};
    // 是否有任何已知 alias 提供了 method
    const hasMethod = ['method', 'teachingMethod', 'instructionMethod', 'pedagogyMethod', 'methodName'].some((k) => raw[k] != null);
    if (!hasMethod) missMethod++;
    const hasHomework = ['homework', 'homeworkCount', 'assignmentCount', 'assignments'].some((k) => raw[k] != null);
    if (!hasHomework) missHomework++;
    const hasHours = ['hours', 'classHours', 'hoursCount', 'duration'].some((k) => raw[k] != null);
    if (!hasHours) missHours++;
  }
  if (missMethod > 0) warnings.push(`${missMethod} / ${rawSchedule.length} 行缺 method 字段（默认填"讲授"）`);
  if (missHomework > 0) warnings.push(`${missHomework} / ${rawSchedule.length} 行缺 homework 字段（默认填 0）`);
  if (missHours > 0) warnings.push(`${missHours} / ${rawSchedule.length} 行缺 hours 字段（默认填 4 学时）`);
  return warnings;
}

/**
 * 检测 header / objective 等顶层字段缺失
 */
function detectTopLevelGaps(mappedData, rawData) {
  const warnings = [];
  // header 缺
  if (!mappedData.header || typeof mappedData.header !== 'object') {
    warnings.push('未识别 header 字段（也无 metadata / meta / info 别名）');
  } else {
    const h = mappedData.header;
    if (!h.courseName) warnings.push('header.courseName 缺失（也无 course / courseTitle / subject 别名）');
    if (!h.totalHours) warnings.push('header.totalHours 缺失（也无 totalHrs 别名，将默认 72）');
  }
  // objective 缺
  if (!mappedData.objective) {
    const rawHasObjective = ['objective', 'teachingObjectives', 'objectives', 'goals', 'learningObjectives']
      .some((k) => rawData[k] != null);
    if (!rawHasObjective) warnings.push('objective 字段缺失（也无 teachingObjectives / objectives / goals 别名）');
  }
  return warnings;
}

/**
 * 主入口：导入外部 JSON 时做别名归一化 + 字段缺失检测
 *
 * @param {Object} rawObj  - 老师粘进来或外部 AI 生成的对象（可能字段名混乱）
 * @returns {{
 *   data: Object,            // 经 alias 映射后符合驭课 schema 的对象
 *   aliasesUsed: string[],   // 实际命中的别名映射列表（"teachingMethod → method"）
 *   warnings: string[],      // 字段缺失警告
 * }}
 */
function importWithAliases(rawObj) {
  if (!rawObj || typeof rawObj !== 'object') {
    return { data: {}, aliasesUsed: [], warnings: ['输入为空或非对象'] };
  }
  const aliasesUsed = new Set();
  const data = mapAliasesDeep(rawObj, 'root', aliasesUsed);

  // 顶层 + schedule 行字段缺失检测（对照 raw）
  const warnings = [
    ...detectTopLevelGaps(data, rawObj),
    ...detectScheduleFieldGaps(data, rawObj),
  ];

  return {
    data,
    aliasesUsed: [...aliasesUsed],
    warnings,
  };
}

module.exports = {
  importWithAliases,
  FIELD_ALIASES,
  // 暴露给 verify
  _internal: { mapAliasesDeep, detectScheduleFieldGaps, detectTopLevelGaps },
};
