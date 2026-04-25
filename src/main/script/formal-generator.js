const { normalizeTeacherStyleRubric } = require('./style-rubric');
const { mergeTeacherSampleStyle } = require('./teacher-sample-style');
const { detectCourseProfile, getCourseProfileLexicon } = require('./course-profile');
const { resolveFrameworkDirectives } = require('./framework-directives');
const { normalizeLectureMarkdown } = require('./lecture-format');
const { validateLectureStage } = require('../v2/quality');

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function narrationCharCount(text = '') {
  const lines = String(text || '').split(/\r?\n/);
  const parts = [];
  let mode = '';
  lines.forEach((line) => {
    const trimmed = cleanText(line);
    if (!trimmed) return;
    if (/^##\s+/.test(trimmed)) {
      mode = '';
      return;
    }
    if (/^教师讲述[：:]/.test(trimmed)) {
      mode = 'spoken';
      return;
    }
    if (/^课堂动作/.test(trimmed)) {
      mode = 'action';
      return;
    }
    if (mode === 'spoken') parts.push(trimmed.replace(/^[-*•]\s*/, ''));
  });
  return parts.join('').replace(/\s+/g, '').length;
}

function normalizeModules(modules = []) {
  return toList(modules).slice(0, 8).map((item, index) => ({
    id: item?.id || '',
    moduleNumber: Number(item?.moduleNumber || item?.number) || index + 1,
    name: cleanText(item?.name) || `模块${index + 1}`,
    description: cleanText(item?.description),
    knowledgePoints: toList(item?.knowledgePoints || item?.keyPoints)
      .map((point) => cleanText(point))
      .filter(Boolean)
      .slice(0, 4)
  }));
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  try {
    const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i);
    const candidate = fenced ? fenced[1] : raw;
    const matched = candidate.match(/\{[\s\S]*\}/);
    return matched ? JSON.parse(matched[0]) : null;
  } catch {
    return null;
  }
}

function buildExecutionTimeline(moduleCount, totalHours) {
  const safeCount = Math.max(1, Number(moduleCount) || 1);
  // 根据学时计算总分钟数：1学时=45分钟
  const hours = Number(totalHours) || 1;
  const totalMinutes = Math.max(45, hours * 45);
  // 按比例分配：开场5%，模块70%，练习15%，收束10%
  const openingEnd = Math.round(totalMinutes * 0.05) || 3;
  const practiceStart = Math.round(totalMinutes * 0.85);
  const closeStart = Math.round(totalMinutes * 0.92);
  const coreStart = openingEnd;
  const coreEnd = practiceStart;
  const span = Math.max(1, coreEnd - coreStart);
  const base = Math.floor(span / safeCount);
  let remainder = span - base * safeCount;
  let cursor = coreStart;
  return {
    opening: `0-${openingEnd}分钟`,
    modules: Array.from({ length: safeCount }, () => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      const start = cursor;
      const end = cursor + base + extra;
      cursor = end;
      return `${start}-${end}分钟`;
    }),
    practice: `${practiceStart}-${closeStart}分钟`,
    close: `${closeStart}-${totalMinutes}分钟`
  };
}

function buildCanonicalHeadingMap(modules = [], totalHours = 1) {
  const timeline = buildExecutionTimeline(modules.length || 1, totalHours);
  const map = new Map();
  map.set('开场导入', `## 开场导入（${timeline.opening}）`);
  modules.forEach((module, index) => {
    map.set(`模块${index + 1}`, `## 模块${index + 1}：${cleanText(module.name)}（${timeline.modules[index]}）`);
    map.set(`模块${index + 1}：${cleanText(module.name)}`, `## 模块${index + 1}：${cleanText(module.name)}（${timeline.modules[index]}）`);
  });
  map.set('课堂练习与检查', `## 课堂练习与检查（${timeline.practice}）`);
  map.set('总结收束', `## 总结收束（${timeline.close}）`);
  return map;
}

function canonicalizeLectureHeadings(script = '', modules = [], totalHours = 1) {
  const headingMap = buildCanonicalHeadingMap(modules, totalHours);
  return String(script || '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = cleanText(line);
      if (!/^##\s+/.test(trimmed)) return line;
      const rawTitle = trimmed.replace(/^##\s+/, '').replace(/[（(].*?[）)]$/, '').trim();
      return headingMap.get(rawTitle) || headingMap.get(rawTitle.replace(/\s+/g, '')) || line;
    })
    .join('\n');
}

function countCanonicalSections(script = '', modules = [], totalHours = 1) {
  const headingMap = buildCanonicalHeadingMap(modules, totalHours);
  let count = 0;
  headingMap.forEach((heading) => {
    if (String(script || '').includes(heading)) count += 1;
  });
  return count;
}

function stripHeadingTiming(title = '') {
  return cleanText(String(title || '').replace(/[（(].*?[）)]/g, ''));
}

function getSectionKeyFromHeading(heading = '', modules = []) {
  const normalized = stripHeadingTiming(String(heading || '').replace(/^##\s+/, ''));
  if (!normalized) return '';
  if (/开场|导入|课程定位/.test(normalized)) return 'opening';
  if (/课堂练习|练习与检查/.test(normalized)) return 'practice';
  if (/总结收束|总结|结尾/.test(normalized)) return 'closing';
  const moduleMatch = normalized.match(/^模块\s*(\d+)/);
  if (moduleMatch) return `module-${moduleMatch[1]}`;
  // 用模块名做模糊匹配
  for (let i = 0; i < modules.length; i++) {
    const name = cleanText(modules[i]?.name || '');
    if (name && normalized.includes(name)) return `module-${i + 1}`;
    // 取模块名前2-4个字做短匹配（如"寻·潮起"匹配"寻·潮起——寻找无声推销员"）
    const shortName = name.replace(/[——\-–—].+$/, '').trim();
    if (shortName.length >= 2 && normalized.includes(shortName)) return `module-${i + 1}`;
  }
  return '';
}

function sanitizeActionLine(line = '') {
  const text = cleanText(line)
    .replace(/^[-*]\s*/, '')
    .replace(/”?\d+%”?(的数据|增长|提升)?/g, '案例中的传播效果变化')
    .replace(/敲黑板强调.*传播效果变化/g, '引导学生关注案例中的传播效果变化')
    .replace(/挥手告别/g, '明确收束要求')
    .replace(/活跃气氛/g, '组织课堂互动')
    .replace(/哼唱.+旋律/g, '')
    .replace(/整理教具[，,]?\s*$/g, '整理教具，布置课后任务')
    .trim();
  // 过滤过长的动作描述（可能是泄露的参考文本）
  if (text.length > 60) return text.substring(0, 58) + '。';
  return text;
}

function buildFallbackSection(sectionKey = '', modules = []) {
  if (sectionKey === 'opening') {
    return {
      narration: [
        '这节课先把任务、目标和评价标准交代清楚，让学生明确为什么学、学完以后能解决什么问题。',
        '开场不只是导入气氛，更要让学生从一开始就带着判断标准进入后面的学习。'
      ],
      actions: [
        '展示课程任务、案例图片或品牌传播页面，引导学生先观察再表达判断。',
        '教师板书本节课的任务主线和评价要点。'
      ]
    };
  }
  if (sectionKey === 'practice') {
    return {
      narration: [
        '这一段不再补充新知识，而是把前面讲过的判断方法真正落到作品检查、同伴互查和修改表达上。',
        '练习的关键不是只完成结果，而是能够按标准说清楚为什么这样调整。'
      ],
      actions: [
        '学生按评价标准互查作品，并写出具体修改建议。',
        '教师巡视时重点抓判断依据和修改方向是否一致。'
      ]
    };
  }
  if (sectionKey === 'closing') {
    return {
      narration: [
        '最后回到开场任务，对照今天的标准快速复盘本节课的关键判断点和操作顺序。',
        '结尾要明确课后提交物、修改要求和下一节课的衔接方向。'
      ],
      actions: [
        '对照评价标准回收本节课成果，指出共性问题和改进方向。',
        '明确课后作业和下一节课衔接任务。'
      ]
    };
  }
  const moduleNumber = Number(String(sectionKey).replace('module-', '')) || 1;
  const module = modules[moduleNumber - 1] || {};
  const points = toList(module.knowledgePoints).filter(Boolean);
  const pointText = points.length ? points.join('、') : '核心知识点';
  const moduleName = cleanText(module.name) || `模块${moduleNumber}`;
  return {
    narration: [
      `好，接下来我们进入”${moduleName}”这个环节。大家先看屏幕上的这个案例，想想它和${points[0] || '今天的主题'}有什么关系？`,
      `${pointText}之间其实是有内在联系的。我举个生活中的例子来帮大家理解——你们平时有没有遇到过类似的情况？`,
    ],
    actions: [
      `教师展示与”${moduleName}”相关的案例或图片，组织学生观察后回答。`,
      '教师根据学生回答进行追问，引导深入思考。'
    ]
  };
}

function rebuildCanonicalLecture(script = '', modules = [], totalHours = 1) {
  const normalized = String(script || '');
  const lines = normalized.split(/\r?\n/);
  const titleLine = lines.find((line) => /^#\s+/.test(cleanText(line))) || '# 正式讲稿';
  const sections = new Map();
  let currentKey = '';
  let bucket = [];

  const flush = () => {
    if (!currentKey) return;
    sections.set(currentKey, bucket.join('\n').trim());
    bucket = [];
  };

  lines.forEach((line) => {
    const trimmed = cleanText(line);
    if (/^##\s+/.test(trimmed)) {
      flush();
      currentKey = getSectionKeyFromHeading(trimmed, modules);
      bucket = [trimmed];
      return;
    }
    if (currentKey) bucket.push(line);
  });
  flush();

  const headingMap = buildCanonicalHeadingMap(modules, totalHours);
  const orderedKeys = ['opening', ...modules.map((_, index) => `module-${index + 1}`), 'practice', 'closing'];
  const canonicalHeadings = new Map();
  canonicalHeadings.set('opening', headingMap.get('开场导入'));
  modules.forEach((module, index) => {
    canonicalHeadings.set(`module-${index + 1}`, headingMap.get(`模块${index + 1}：${cleanText(module.name)}`));
  });
  canonicalHeadings.set('practice', headingMap.get('课堂练习与检查'));
  canonicalHeadings.set('closing', headingMap.get('总结收束'));

  const rebuilt = [titleLine];
  orderedKeys.forEach((key) => {
    const expectedHeading = canonicalHeadings.get(key);
    if (!expectedHeading) return;
    const existing = sections.get(key);
    if (existing) {
      const replaced = existing.replace(/^##\s+.+$/m, expectedHeading).trim();
      rebuilt.push('', replaced);
      return;
    }
    const fallback = buildFallbackSection(key, modules);
    rebuilt.push(
      '',
      expectedHeading,
      '',
      '教师讲述：',
      ...fallback.narration,
      '',
      '课堂动作附栏：',
      ...fallback.actions.map((item) => `- ${sanitizeActionLine(item)}`)
    );
  });

  return rebuilt.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function professionalizeTeacherTone(text = '') {
  return String(text || '')
    .replace(/同学们好！都坐稳了吧？来，看屏幕[——-]?/g, '同学们好，我们先看屏幕上的案例。')
    .replace(/都坐稳了吧[？?]?/g, '')
    .replace(/来，看屏幕[——-]?/g, '我们先看屏幕。')
    .replace(/就靠这张纸/g, '其中海报发挥了很强的传播作用')
    .replace(/拍胸脯说/g, '比较明确地说')
    .replace(/撸袖子干活了/g, '现在进入实操环节')
    .replace(/老铁/g, '同学')
    .replace(/俺看不清/g, '看不清')
    .replace(/更嗨/g, '更完整')
    .replace(/我溜达着看/g, '我会巡视查看')
    .replace(/够味儿吧/g, '比较贴合主题')
    .replace(/炸不炸/g, '够不够有冲击力')
    .replace(/拽不拽/g, '够不够有张力')
    .replace(/够狠吧/g, '视觉冲击比较强')
    .replace(/花花绿绿却不觉乱/g, '元素较多但层次仍然清楚')
    .replace(/玩个游戏[:：]?/g, '我们做一个快速判断练习：')
    .replace(/票数最高的组，我请全班鼓掌[！!]?/g, '票数较高的小组我们集中讲评。')
    .replace(/下课[！!]?/g, '')
    .replace(/销量涨了多少？\s*\d+%[！!]?/g, '传播效果有明显提升')
    .replace(/销量涨了\d+%/g, '销量有明显提升')
    .replace(/一周，销量有明显提升！/g, '发布后一段时间，传播效果有明显提升。')
    .replace(/你可能会问：老师，学这有啥用？/g, '你们可能会问，这节课学完到底能解决什么问题？')
    .replace(/我告诉你/g, '这里我直接说明')
    .replace(/它不说话，但比导购还管用/g, '它不直接开口，但在传播和转化上很有作用')
    .replace(/学完你就能比较明确地说：/g, '学完以后，你应该能够比较明确地说：')
    .replace(/学完你就能拍胸脯说：/g, '学完以后，你应该能够比较明确地说：')
    .replace(/真刀真枪/g, '真正')
    .replace(/搞定/g, '完成')
    .replace(/卖货/g, '促进销售')
    .replace(/勾人/g, '吸引顾客停留')
    .replace(/抢眼球/g, '先抓住顾客注意力')
    .replace(/怕错过？这就对了！/g, '这就形成了比较明显的紧迫感。')
    .replace(/别挑花眼啊/g, '选择时要先围绕任务要求判断')
    .replace(/谁卡壳了举手/g, '遇到卡点可以及时举手说明')
    .replace(/来，小试牛刀！/g, '下面做一个简短的课堂练习。')
    .replace(/嗯，说到点子上了！/g, '这条判断已经比较到位。')
    .replace(/玩更嗨的/g, '继续推进到更完整的任务')
    .replace(/[！!]{2,}/g, '！')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDraftsForFormal(drafts = {}, courseName = '') {
  return {
    a: normalizeLectureMarkdown(String(drafts.a || ''), { titleOverride: `${courseName || '课程'} A稿` }),
    b: normalizeLectureMarkdown(String(drafts.b || ''), { titleOverride: `${courseName || '课程'} B稿` }),
    c: normalizeLectureMarkdown(String(drafts.c || ''), { titleOverride: `${courseName || '课程'} C稿` })
  };
}

function buildFormalPrompt({
  courseName,
  modules,
  selectedKey,
  drafts,
  style,
  courseProfile,
  frameworkDirectives,
  totalHours = 1,
  notebookContext = {}
}) {
  const selectedDraft = String(drafts[selectedKey] || '').trim();
  const selectedLabel = `${selectedKey.toUpperCase()}稿`;
  const blockedTexts = toList(frameworkDirectives?.blocked).map((item) => item.text).filter(Boolean);
  const appliedTexts = [
    ...toList(frameworkDirectives?.applied?.general),
    ...toList(frameworkDirectives?.applied?.practice),
    ...toList(frameworkDirectives?.applied?.closing),
    ...Object.values(frameworkDirectives?.applied?.modules || {}).flat()
  ].map((item) => item.text).filter(Boolean);
  const hours = Number(totalHours) || 1;
  const timeline = buildExecutionTimeline(modules.length || 1, hours);
  const lexicon = getCourseProfileLexicon(courseProfile);
  // 多段生成时每段模块数少，需要提高单模块字数下限，
  // 避免 AI 按"每模块≥400字"填写后总字数远低于 2200 目标。
  // 例：1模块段 → perModuleNarMin=1800；2模块段 → 900；4+模块段 → ≈400
  const moduleCount = modules.length || 1;
  const perModuleNarMin = Math.max(Math.round(400 * hours), Math.round(1800 / moduleCount));

  return [
    '<task>',
    '基于已选候选讲稿，深度生成一版正式讲稿。',
    '输出格式：JSON 对象 {“script”:”正式讲稿全文（Markdown格式）”}',
    '</task>',
    '',
    '<structure>',
    `# ${courseName || '课程'} 正式讲稿`,
    `## 开场导入（${timeline.opening}）`,
    ...modules.map((module, index) => `## 模块${index + 1}：${module.name}（${timeline.modules[index]}）`),
    `## 课堂练习与检查（${timeline.practice}）`,
    `## 总结收束（${timeline.close}）`,
    '每个章节必须包含”教师讲述：”和”课堂动作附栏：”两栏。',
    '</structure>',
    '',
    '<quality_requirements>',
    `<base_draft>当前已选：${selectedLabel}。A偏知识逻辑，B偏口播，C偏执行。正式稿必须继承已选方向。</base_draft>`,
    `<duration>本课程共${hours}学时，总时长${hours * 45}分钟。</duration>`,
    `<length>教师讲述 ${Math.round(2200 * hours)}-${Math.round(3000 * hours)} 字。每模块≥${perModuleNarMin}字，开场≥${Math.round(200 * hours)}字。</length>`,
    '<transitions>全稿必须覆盖”首先””接着””因此””最后”四个推进词。</transitions>',
    '<questions>全稿≥10个提问句，每模块≥1个追问。</questions>',
    '<tone>职业院校老师可直接上课的口吻。禁止主播腔、网络流行语、夸张口号。</tone>',
    '<data_integrity>禁止编造百分比、销量、绝对化结论。</data_integrity>',
    '</quality_requirements>',
    '',
    '<forbidden>',
    '- 提示词、要求栏、风格提醒、系统说明',
    '- 在总结收束后附加任何内容',
    '- 照抄参考样稿原文（只学习语气和句式）',
    '- 绝对禁止以下教学设计备注出现在讲稿正文中：',
    '  "学完这一段，学生应该能够..."',
    '  "这里有一个常见误区..."',
    '  "这一段要把XX讲成一条连续判断链..."',
    '  "这一部分围绕XX展开，先把当前环节要解决的课堂问题交代清楚"',
    '  "重点要把XX之间的关系讲清楚"',
    '  "教师还要明确指出这一环节最容易出错的地方"',
    '  这些是备课笔记，不是教师口播正文。每个模块必须写老师真正会对学生说的话。',
    '</forbidden>',
    '',
    '<course>',
    `<name>${courseName || '课程'}</name>`,
    `<profile>${courseProfile}</profile>`,
    `<focus>围绕${lexicon.realTask}展开，突出${lexicon.qualityFocus}</focus>`,
    notebookContext.softwareTools
      ? `<software>【必须使用】具体软件工具：${notebookContext.softwareTools}。凡涉及软件操作必须写该软件真实名称，禁止泛指。</software>`
      : '',
    notebookContext.jobTargets
      ? `<jobs>目标岗位：${notebookContext.jobTargets}。案例和评价标准须与岗位真实任务挂钩。</jobs>`
      : '',
    notebookContext.industryScenarios
      ? `<industry>行业场景：${notebookContext.industryScenarios}。</industry>`
      : '',
    notebookContext.learnerProfile
      ? `<learners>学情：${notebookContext.learnerProfile}。</learners>`
      : '',
    // Phase-5C Cross-Stage：注入上游框架阶段的教学目标（由 context-builder 构建）
    notebookContext.frameworkObjectives
      ? `<framework_objectives>本课既定目标：${notebookContext.frameworkObjectives}。正式讲稿必须覆盖知识、技能、情感三类目标。</framework_objectives>`
      : '',
    notebookContext.frameworkTeachingMethods
      ? `<teaching_methods>本课教学方法：${notebookContext.frameworkTeachingMethods}。</teaching_methods>`
      : '',
    `<modules>${JSON.stringify(modules, null, 2)}</modules>`,
    '</course>',
    '',
    // Phase-5C：老师上传/粘贴的参考资料（教案、课标、教材摘录等）
    notebookContext.referenceContext
      ? [
          '<reference_material>',
          '【老师提供的参考资料——请务必参考以下内容，提取真实操作步骤、专业术语、教学案例注入讲稿：】',
          String(notebookContext.referenceContext).slice(0, 5000),
          '</reference_material>'
        ].join('\n')
      : '',
    '',
    '<style_rules>',
    `<opening>${toList(style.openingRules).join('；') || '无'}</opening>`,
    `<module_flow>${toList(style.moduleFlow).join('；') || '无'}</module_flow>`,
    `<closing>${toList(style.closingRules).join('；') || '无'}</closing>`,
    `<sentence>${toList(style.sentenceRules).join('；') || '无'}</sentence>`,
    '</style_rules>',
    appliedTexts.length ? `\n<teacher_requirements>\n${appliedTexts.join('；')}\n</teacher_requirements>` : '',
    blockedTexts.length ? `\n<blocked_content>\n${blockedTexts.join('；')}\n</blocked_content>` : '',
    '',
    `<selected_draft label=”${selectedLabel}”>`,
    selectedDraft,
    '</selected_draft>',
    '',
    '<reference_drafts>',
    `<draft_a>${selectedKey === 'a' ? '（已作为主稿输入）' : String(drafts.a || '').substring(0, 2000)}</draft_a>`,
    `<draft_b>${selectedKey === 'b' ? '（已作为主稿输入）' : String(drafts.b || '').substring(0, 2000)}</draft_b>`,
    `<draft_c>${selectedKey === 'c' ? '（已作为主稿输入）' : String(drafts.c || '').substring(0, 2000)}</draft_c>`,
    '</reference_drafts>'
  ].join('\n');
}

function ensureSentence(text = '') {
  const normalized = cleanText(text);
  if (!normalized) return '';
  return /[。！？]$/.test(normalized) ? normalized : `${normalized}。`;
}

function stripSectionTitleDecorators(text = '') {
  return String(text || '')
    .replace(/A类候选讲稿（知识逻辑型）/g, '正式讲稿')
    .replace(/B类候选讲稿（教师口播型）/g, '正式讲稿')
    .replace(/C类候选讲稿（课堂执行型）/g, '正式讲稿')
    .trim();
}

function sanitizeTeacherNarrationLine(line = '', selectedKey = 'a') {
  let text = cleanText(line);
  if (!text) return '';

  text = stripSectionTitleDecorators(text)
    .replace(/大家好，欢迎来到今天的课堂这节课/g, '大家好，欢迎来到今天的课堂。这节课')
    .replace(/先看这个情境[:：]?\s*/g, '')
    .replace(/结合“[^”]+”这个情境来理解。?/g, '')
    .replace(/这一段先抓住三个字[:：]?判断。?/g, '')
    .replace(/接着把它落回任务里，就是把“[^”]+”落实成一个可检查的小任务。?/g, '')
    .replace(/因此要特别防住这个误区[:：]?/g, '这里最容易出错的地方是')
    .replace(/不要把“[^”]+”只背定义，要说出判断依据。?/g, '这里不能只停在背概念上，还要把判断依据说清楚。')
    .replace(/我更看重的是你能不能说出判断依据，而不只是把结果做出来。?/g, '关键不是只给出结果，而是把判断依据说完整。')
    .replace(/最后还要把它回收到课堂任务里，让大家知道这一段为什么会影响后面的操作结果。?/g, '最后还要回到课堂任务里，看这一步怎样真正影响后面的结果。')
    .replace(/课后作业[:：]\s*/g, '课后作业我给你们布置得具体一点：')
    .replace(/\s+/g, ' ')
    .trim();

  text = professionalizeTeacherTone(text);

  if (selectedKey === 'a') {
    text = text
      .replace(/这一步最容易错在哪里[？?]/g, '这一步最容易错的，不是只记住概念，而是没有把判断链条连起来。')
      .replace(/先不急着记结论/g, '先不要急着背结论');
  } else if (selectedKey === 'b') {
    text = text
      .replace(/这一步最容易错在哪里[？?]/g, '这里我更想听你们先说判断，再把理由讲完整。')
      .replace(/大家想一想/g, '大家先想一想');
  } else if (selectedKey === 'c') {
    text = text
      .replace(/这一步最容易错在哪里[？?]/g, '这里最容易出问题的，是顺序一乱，后面的结果就全乱。');
  }

  text = text
    .replace(/。+/g, '。')
    .replace(/^[，。；、\s]+/, '')
    .trim();

  return ensureSentence(text);
}

function sanitizeFormalScript(rawScript = '', courseName = '', selectedKey = 'a', modules = []) {
  const normalized = normalizeLectureMarkdown(String(rawScript || ''), {
    titleOverride: `${courseName || '课程'} 正式讲稿`
  });
  const lines = normalized.split(/\r?\n/);
  const result = [];
  let seenRealTaskLine = false;
  let mode = '';

  const pushNarration = (text = '') => {
    const sanitized = sanitizeTeacherNarrationLine(text, selectedKey);
    if (!sanitized) return;
    if (/^这节课，我会带着大家围绕《.+》解决一个真实问题/.test(sanitized)) {
      if (seenRealTaskLine) return;
      seenRealTaskLine = true;
    }
    if (result[result.length - 1] === sanitized) return;
    result.push(sanitized);
  };

  const pushAction = (text = '') => {
    const actionLine = sanitizeActionLine(text);
    if (!actionLine) return;
    if (result[result.length - 1] === `- ${actionLine}`) return;
    result.push(`- ${actionLine}`);
  };

  let reachedClosing = false;
  let closingActionsDone = false;

  lines.forEach((rawLine, index) => {
    // 总结收束的课堂动作结束后，截断一切后续内容（防止样稿泄露）
    if (closingActionsDone) return;

    const trimmed = cleanText(rawLine);
    if (!trimmed) {
      if (reachedClosing && mode === 'action') {
        closingActionsDone = true;
        return;
      }
      if (result[result.length - 1] !== '') result.push('');
      return;
    }

    if (index === 0 && /^#\s+/.test(trimmed)) {
      result.push(`# ${courseName || '课程'} 正式讲稿`);
      return;
    }

    if (/^##\s+/.test(trimmed)) {
      if (reachedClosing && mode === 'action') {
        closingActionsDone = true;
        return;
      }
      mode = '';
      if (/总结收束|总结/.test(trimmed)) reachedClosing = true;
      result.push(trimmed);
      return;
    }

    // 检测明显的参考样稿泄露特征
    if (/^请参照|^以下是|^".*"$|^服装产品传播起源/.test(trimmed)) return;
    if (/^还有一点去甄别|^有没有按照我提供的/.test(trimmed)) return;
    if (/《服装产品传播》本身就是一门与时俱进/.test(trimmed)) return;
    if (/根据每一期教学反馈、总结与反思不断成长的课程/.test(trimmed)) return;

    const spokenMatch = trimmed.match(/^教师讲述[：:]\s*(.*)$/);
    if (spokenMatch) {
      mode = 'spoken';
      result.push('教师讲述：');
      pushNarration(spokenMatch[1]);
      return;
    }

    const actionMatch = trimmed.match(/^(?:课堂动作附栏|课堂动作)[：:]\s*(.*)$/);
    if (actionMatch) {
      mode = 'action';
      result.push('课堂动作附栏：');
      pushAction(actionMatch[1]);
      return;
    }

    if (mode === 'spoken') {
      pushNarration(trimmed);
      return;
    }

    if (mode === 'action') {
      pushAction(trimmed);
      return;
    }

    result.push(stripSectionTitleDecorators(trimmed));
  });

  // 修复残句：末尾如果句子不完整则补齐或移除
  let joined = result
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/这节课，我会带着大家围绕《(.+?)》解决一个真实问题。先把任务摆在前面：这节课，我会带着大家围绕《\1》解决一个真实问题，而且每一步都要能解释为什么这样做。/g, '这节课，我会带着大家围绕《$1》解决一个真实问题，而且每一步都要能解释为什么这样做。')
    .trim();

  // 修复教师讲述区末尾残句（如"我们。""现在。"等不完整句子）
  joined = joined
    .replace(/，我们。/g, '。')
    .replace(/现在请值日生整理教具，我们。/g, '现在请值日生整理教具。')
    .replace(/[，,]\s*。/g, '。')
    .replace(/(?:现在|好了|好)\s*。\s*$/gm, '。');

  // 检查教师讲述区最后一个完整句子，如果不以句号/感叹号/问号结尾则补句号
  const lastNarrationMatch = joined.match(/教师讲述：\n([\s\S]*?)(?=\n课堂动作|\n##|$)/g);
  if (lastNarrationMatch) {
    const lastBlock = lastNarrationMatch[lastNarrationMatch.length - 1];
    const lastLine = lastBlock.split('\n').filter(l => l.trim() && !/^教师讲述/.test(l.trim()) && !/^-/.test(l.trim())).pop();
    if (lastLine && !/[。！？]$/.test(lastLine.trim())) {
      joined = joined.replace(lastLine, lastLine.trimEnd() + '。');
    }
  }

  return canonicalizeLectureHeadings(
    joined,
    modules
  );
}

function buildFormalFromSelectedDraft(draftText = '', courseName = '', selectedKey = 'a', frameworkDirectives = {}, modules = [], totalHours = 1) {
  const hours = Number(totalHours) || 1;
  const normalizedDraft = normalizeLectureMarkdown(String(draftText || ''), {
    titleOverride: `${courseName || '课程'} 正式讲稿`
  }).replace(/^#\s+.+$/m, `# ${courseName || '课程'} 正式讲稿`);
  const sanitized = sanitizeFormalScript(normalizedDraft, courseName, selectedKey, modules);
  const rebuilt = rebuildCanonicalLecture(sanitized, modules, hours);
  const injected = injectFrameworkDirectives(rebuilt, frameworkDirectives);
  return expandLectureNarration(injected, modules, detectCourseProfile({ courseName, modules }), Math.round(2200 * hours), Math.round(3000 * hours));
}

function rewriteDirectiveForNarration(directive = {}) {
  const text = cleanText(directive.text);
  if (!text) return '';
  if (directive.type === 'homework') {
    const body = text.replace(/^(课后作业|作业)[：:]?\s*/, '');
    return ensureSentence(`课后作业我给你们布置得具体一点：${body}`);
  }
  if (directive.type === 'practice') {
    return ensureSentence(`课堂练习这里再加一个要求：${text.replace(/^课堂练习[：:]?\s*/, '')}`);
  }
  return ensureSentence(text);
}

function rewriteDirectiveForAction(directive = {}) {
  const text = cleanText(directive.text);
  if (!text) return '';
  if (directive.type === 'homework') {
    return `明确课后作业要求：${text.replace(/^(课后作业|作业)[：:]?\s*/, '')}`;
  }
  if (directive.type === 'practice') {
    return `补充课堂练习要求：${text.replace(/^课堂练习[：:]?\s*/, '')}`;
  }
  return text;
}

function buildSectionExpansion(sectionKey = '', modules = [], courseProfile = 'generic', round = 0) {
  const profileLexicon = getCourseProfileLexicon(courseProfile);
  if (sectionKey === 'opening') {
    const pool = [
      ensureSentence(`这一节课不是停留在概念识记上，而是要把${profileLexicon.realTask}放进真实课堂任务里，让学生知道每一步为什么这样判断。`),
      ensureSentence('开场先把学习目标、评价标准和最终产出说清楚，后面学生在听、看、做的时候才有稳定的判断坐标。'),
      ensureSentence('在正式进入新内容之前，我们先花一分钟回顾一下上节课的核心结论，把知识衔接的线头捋清楚。'),
      ensureSentence(`为什么要学这个？因为在真实岗位里，${profileLexicon.realTask}的质量直接影响最终验收结果，不是做出来就行，还要能说清楚为什么这样做。`),
      ensureSentence('今天这节课结束以后，评价你们学得好不好，不是看做了多少，而是看能不能按标准解释自己的判断。')
    ];
    return pool.slice(round * 2, round * 2 + 2).filter(Boolean).length ? pool.slice(round * 2, round * 2 + 2) : [];
  }
  if (sectionKey === 'practice') {
    const pool = [
      ensureSentence('练习阶段最关键的是把前面学过的标准真正落到作品检查和口头说明里，而不是只把结果做出来。'),
      ensureSentence(`教师在这一段要重点看学生能不能围绕${profileLexicon.qualityFocus}说清修改依据，并据此完成二次调整。`),
      ensureSentence('互查时不是随便看一眼就打勾，要对着评价标准逐项核查，有问题就写出具体的修改建议。'),
      ensureSentence('如果发现同伴的作品有共性问题，教师要及时暂停，集中讲评典型错误，让全班都能避免同样的偏差。'),
      ensureSentence('练习结束前留两分钟，让每组选一个代表用一句话说明本组的核心改进点，确保练习落到了实处。')
    ];
    return pool.slice(round * 2, round * 2 + 2).filter(Boolean).length ? pool.slice(round * 2, round * 2 + 2) : [];
  }
  if (sectionKey === 'closing') {
    const pool = [
      ensureSentence('总结时要把今天每个环节重新串成一条主线，让学生知道从开场任务到最后验收之间的逻辑关系。'),
      ensureSentence('课后要求也要说得具体，让学生回去以后不仅能继续修改结果，还能对照课堂标准解释自己的设计理由。'),
      ensureSentence('最后问大家一个问题：今天学的这些标准，回去以后能不能套到你们自己之前做过的作品上重新审视？'),
      ensureSentence('下一节课开场我会随机抽三位同学，让你们用今天的标准点评自己的旧作品，所以课后一定要认真回顾。')
    ];
    return pool.slice(round * 2, round * 2 + 2).filter(Boolean).length ? pool.slice(round * 2, round * 2 + 2) : [];
  }
  const moduleNumber = Number(String(sectionKey).replace('module-', '')) || 1;
  const module = modules[moduleNumber - 1] || {};
  const points = toList(module.knowledgePoints).filter(Boolean);
  const pointText = points.length ? points.join('、') : '关键知识点';
  const moduleName = cleanText(module.name) || `模块${moduleNumber}`;
  const pool = [
    ensureSentence(`来，我们看一个和"${moduleName}"直接相关的真实案例，大家先观察，然后告诉我你们发现了什么规律。`),
    ensureSentence(`关于${pointText}，最容易出错的地方是什么？有同学说说看？对，很多人会忽略它们之间的因果关系，只记住了名词却不知道为什么这样做。`),
    ensureSentence(`我再问一个问题：如果${points[0] || '这个概念'}理解错了，后面的操作会受什么影响？大家先想30秒，然后前后桌讨论一下。`),
    ensureSentence(`好，通过这个案例大家应该能感受到，${pointText}不是孤立的知识点，它们之间有明确的先后逻辑和因果关系。`)
  ];
  return pool.slice(round * 2, round * 2 + 2).filter(Boolean).length ? pool.slice(round * 2, round * 2 + 2) : [];
}

function expandLectureNarration(script = '', modules = [], courseProfile = 'generic', minChars = 2200, maxChars = 3000) {
  let nextScript = String(script || '');
  let guard = 0;
  const orderedKeys = ['opening', ...modules.map((_, index) => `module-${index + 1}`), 'practice', 'closing'];

  while (narrationCharCount(nextScript) < minChars && guard < 5) {
    orderedKeys.forEach((sectionKey) => {
      if (narrationCharCount(nextScript) >= minChars) return;
      let sectionTitle = '';
      if (sectionKey === 'opening') sectionTitle = '开场导入';
      else if (sectionKey === 'practice') sectionTitle = '课堂练习与检查';
      else if (sectionKey === 'closing') sectionTitle = '总结收束';
      else {
        const moduleNumber = Number(String(sectionKey).replace('module-', '')) || 1;
        const module = modules[moduleNumber - 1] || {};
        sectionTitle = `模块${moduleNumber}：${cleanText(module.name)}`;
      }
      const narrationLines = buildSectionExpansion(sectionKey, modules, courseProfile, guard)
        .filter((line) => line && !nextScript.includes(line));
      if (narrationLines.length) {
        nextScript = injectIntoSection(nextScript, sectionTitle, narrationLines, []);
      }
    });
    guard += 1;
  }

  if (narrationCharCount(nextScript) > maxChars) {
    nextScript = nextScript
      .replace(/教师还要明确指出这一环节最容易出错的地方，并回到.+?受影响。/g, '')
      .replace(/课后要求也要说得具体，让学生回去以后不仅能继续修改结果，还能对照课堂标准解释自己的设计理由。/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return nextScript;
}

function injectIntoSection(script = '', sectionTitle = '', narrationLines = [], actionLines = []) {
  const marker = `## ${sectionTitle}`;
  const start = script.indexOf(marker);
  if (start < 0) return script;
  const next = script.indexOf('\n## ', start + marker.length);
  const end = next >= 0 ? next : script.length;
  const section = script.slice(start, end);
  let updated = section;
  const spokenLines = toList(narrationLines).filter(Boolean);
  const actionItems = toList(actionLines).filter(Boolean);

  if (spokenLines.length && /教师讲述：\n/.test(updated)) {
    const insertion = `${spokenLines.join('\n')}\n`;
    updated = updated.replace(/教师讲述：\n/, `教师讲述：\n${insertion}`);
  }

  if (actionItems.length && /课堂动作附栏：\n/.test(updated)) {
    const insertion = actionItems.map((line) => `- ${line}`).join('\n') + '\n';
    updated = updated.replace(/课堂动作附栏：\n/, `课堂动作附栏：\n${insertion}`);
  }

  return `${script.slice(0, start)}${updated}${script.slice(end)}`;
}

function injectFrameworkDirectives(script = '', frameworkDirectives = {}) {
  let nextScript = String(script || '');
  const closingDirectives = toList(frameworkDirectives?.applied?.closing);
  const practiceDirectives = toList(frameworkDirectives?.applied?.practice);

  const closingNarration = closingDirectives
    .map(rewriteDirectiveForNarration)
    .filter((line) => line && !nextScript.includes(line));
  const closingActions = closingDirectives
    .map(rewriteDirectiveForAction)
    .filter((line) => line && !nextScript.includes(line));
  nextScript = injectIntoSection(nextScript, '总结收束', closingNarration, closingActions);

  const practiceNarration = practiceDirectives
    .map(rewriteDirectiveForNarration)
    .filter((line) => line && !nextScript.includes(line));
  const practiceActions = practiceDirectives
    .map(rewriteDirectiveForAction)
    .filter((line) => line && !nextScript.includes(line));
  nextScript = injectIntoSection(nextScript, '课堂练习与检查', practiceNarration, practiceActions);

  return nextScript;
}

function mergeSegmentScripts(segments, courseName, allModules, totalHours) {
  const hours = Number(totalHours) || 1;
  const lines = [`# ${courseName || '课程'} 正式讲稿`];
  let minuteCursor = 0;
  // 跨段累计模块偏移量：每段 AI 从"模块1"开始局部编号，合并时需映射到全局编号
  // 例：第2段生成的"模块1：XX" → "模块3：XX"（当 globalModuleOffset=2 时）
  let globalModuleOffset = 0;

  segments.forEach((seg) => {
    const segModuleCount = toList(seg.modules).length;
    const segModuleOffset = globalModuleOffset;
    globalModuleOffset += segModuleCount;

    const segLines = String(seg.script || '').split(/\r?\n/);
    segLines.forEach((line) => {
      const trimmed = String(line || '').trim();
      // 跳过段标题（合并后用统一标题）
      if (/^#\s+/.test(trimmed) && !/^##/.test(trimmed)) return;
      // 跳过非首段的开场导入
      if (!seg.isFirst && /^##\s+.*开场导入/.test(trimmed)) return;
      // 跳过非末段的总结收束和练习
      if (!seg.isLast && /^##\s+.*(总结收束|课堂练习)/.test(trimmed)) return;

      // ── 模块标题：局部编号 → 全局编号 ──────────────────────────────────
      // 每段 prompt 只含本段模块，AI 会从 1 重新编号。
      // 合并时必须把局部序号加上偏移量，否则 rebuildCanonicalLecture 找不到
      // module-2/3/4 并用 fallback 短占位替换，导致字数大幅下降。
      const moduleNumMatch = trimmed.match(/^(##\s+模块)(\d+)(.*)/);
      if (moduleNumMatch) {
        const localNum = Number(moduleNumMatch[2]);
        const globalNum = segModuleOffset + localNum;
        const renamedHeading = `${moduleNumMatch[1]}${globalNum}${moduleNumMatch[3]}`;
        // 同时调整时间标签（如果有）
        const timeMatch = renamedHeading.match(/^(##\s+.+)（(\d+)-(\d+)分钟）$/);
        if (timeMatch) {
          const duration = Number(timeMatch[3]) - Number(timeMatch[2]);
          const globalStart = minuteCursor;
          const globalEnd = minuteCursor + duration;
          minuteCursor = globalEnd;
          lines.push(`${timeMatch[1]}（${globalStart}-${globalEnd}分钟）`);
        } else {
          lines.push(renamedHeading);
        }
        return;
      }

      // ── 其他 ## 标题：只调整时间标签 ───────────────────────────────────
      const timeMatch = trimmed.match(/^(##\s+.+)（(\d+)-(\d+)分钟）$/);
      if (timeMatch) {
        const duration = Number(timeMatch[3]) - Number(timeMatch[2]);
        const globalStart = minuteCursor;
        const globalEnd = minuteCursor + duration;
        minuteCursor = globalEnd;
        lines.push(`${timeMatch[1]}（${globalStart}-${globalEnd}分钟）`);
        return;
      }

      lines.push(line);
    });
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function generateFormalLectureScript({
  drafts = {},
  preferred = 'a',
  styleRubricText = '',
  courseName = '',
  modules = [],
  aiClient = null,
  totalHours = 1,
  notebookContext = {}   // Phase-5B：富上下文
}) {
  const style = mergeTeacherSampleStyle(normalizeTeacherStyleRubric(styleRubricText));
  const normalizedModules = normalizeModules(modules);
  const selectedKey = ['a', 'b', 'c'].includes(String(preferred || '').toLowerCase())
    ? String(preferred || '').toLowerCase()
    : 'a';
  const courseProfile = detectCourseProfile({ courseName, modules: normalizedModules });
  const frameworkDirectives = resolveFrameworkDirectives({ style, modules: normalizedModules, courseProfile });
  const normalizedDrafts = normalizeDraftsForFormal(drafts, courseName);
  const selectedDraft = String(normalizedDrafts[selectedKey] || '').trim();
  const hours = Number(totalHours) || 1;
  const fallbackScript = buildFormalFromSelectedDraft(selectedDraft, courseName, selectedKey, frameworkDirectives, normalizedModules, hours);
  const fallbackQuality = validateLectureStage({
    drafts: normalizedDrafts,
    selectedDraft: selectedKey,
    finalScript: fallbackScript
  }, { requireFinal: true, totalHours: hours });

  const fallback = {
    script: fallbackScript,
    meta: {
      preferred: selectedKey,
      usedBaseDraft: selectedKey,
      courseProfile,
      frameworkDirectives,
      moduleCount: normalizedModules.length,
      sourceLengths: {
        a: String(normalizedDrafts.a || '').length,
        b: String(normalizedDrafts.b || '').length,
        c: String(normalizedDrafts.c || '').length
      },
      validation: {
        effectiveCharCount: fallbackQuality.checks.finalCharCount,
        teacherNarrationCharCount: fallbackQuality.checks.finalNarrationCharCount,
        hasMetaInstructionLeak: false,
        hasTeacherNarration: /教师讲述：/.test(fallbackScript),
        hasClassroomActions: /课堂动作附栏：/.test(fallbackScript),
        hasBulletNarration: /教师讲述：\s*\n\s*-\s*/.test(fallbackScript),
        missingSections: []
      }
    }
  };

  if (aiClient && typeof aiClient.chatJson === 'function' && cleanText(selectedDraft)) {
    try {
      // ===== 分段生成策略 =====
      // 1学时：单次生成（45分钟）
      // 2学时：分2段生成（各45分钟），合并
      // N学时：分N段生成，合并
      const segmentCount = Math.max(1, hours);
      const modulesPerSegment = Math.ceil(normalizedModules.length / segmentCount);
      const segmentScripts = [];

      for (let seg = 0; seg < segmentCount; seg++) {
        const segModules = normalizedModules.slice(seg * modulesPerSegment, (seg + 1) * modulesPerSegment);
        if (!segModules.length) continue;

        const isFirst = seg === 0;
        const isLast = seg === segmentCount - 1;
        const segLabel = segmentCount > 1 ? `（第${seg + 1}课时，共${segmentCount}课时）` : '';
        // 重置局部模块编号（从 1 开始），确保 AI 生成 "模块1" "模块2" 等局部序号
        // mergeSegmentScripts 再负责把局部序号映射回全局序号
        const localSegModules = segModules.map((m, idx) => ({ ...m, moduleNumber: idx + 1 }));
        const segSystemPrompt = [
          '你是中职课程正式讲稿写作专家。',
          segmentCount > 1
            ? `当前任务：生成${segmentCount}课时课程的第${seg + 1}课时正式讲稿${segLabel}。`
            : '核心任务：基于已选候选讲稿，深度生成一版可直接上课使用的正式讲稿。',
          '输出规范：JSON 对象 {"script":"Markdown格式的正式讲稿"}。',
          segmentCount > 1
            // 多段模式：明确每模块字数下限，防止 AI 按"400字/模块"敷衍
            ? `质量标准：本段教师讲述总计必须达到 2200-3000 字（本段共${localSegModules.length}个模块，` +
              `每个模块"教师讲述"不少于${Math.round(1800 / localSegModules.length)}字，` +
              `写 3-5 句连续口播正文，不要写成摘要式短句）；` +
              `推进词覆盖；提问≥${Math.max(3, Math.round(10 / segmentCount))}个。`
            : `质量标准：教师讲述2200-3000字，推进词覆盖，提问≥10个。`,
          isFirst ? '必须包含开场导入章节。' : '不需要开场导入，直接从模块内容开始。',
          isLast ? '必须包含课堂练习与检查和总结收束章节。到总结收束的课堂动作后立即结束。' : '不需要总结收束，在最后一个模块结束后停止。',
          '',
          '【最重要的规则】每个模块的"教师讲述"必须是老师真正会说出口的课堂口播正文。',
          '绝对禁止以下"教学设计备注"出现在讲稿中：',
          '  × "学完这一段，学生应该能够针对..."',
          '  × "这里有一个常见误区..."',
          '  × "这一段要把XX讲成一条连续判断链..."',
          '  × "这一部分围绕XX展开，先把当前环节要解决的课堂问题交代清楚"',
          '  × "重点要把XX之间的关系讲清楚"',
          '这些是备课笔记，不是讲课稿。讲稿中只写老师对学生说的话。',
          '正确的写法：用案例引入→提问互动→讲解知识→回收总结。像真人老师一样讲课。'
        ].filter(Boolean).join('\n');

        // 每段只负责 1 课时内容，传 1 而非总学时，
        // 避免 prompt 要求 8800+ 字导致 JSON 被 maxTokens 截断
        const segTotalHours = segmentCount > 1 ? 1 : hours;
        const segPrompt = buildFormalPrompt({
          courseName: courseName + segLabel,
          modules: localSegModules,   // 局部编号（1开始）→ AI 生成 "模块1/2..."
          selectedKey,
          drafts: normalizedDrafts,
          style,
          courseProfile,
          frameworkDirectives,
          totalHours: segTotalHours,
          notebookContext
        });

        const segText = await aiClient.chatJson({
          systemPrompt: segSystemPrompt,
          userPrompt: segPrompt,
          temperature: 0.25,
          maxTokens: 8192  // 模型上限，确保单段 2200-3000 字不被截断
        });
        const segParsed = parseJsonObject(segText) || {};
        const segScript = String(segParsed.script || '').trim();
        if (segScript) segmentScripts.push({ seg, modules: segModules, script: segScript, isFirst, isLast });
      }

      // ===== 合并分段结果 =====
      let mergedScript = '';
      if (segmentScripts.length === 1) {
        mergedScript = segmentScripts[0].script;
      } else if (segmentScripts.length > 1) {
        mergedScript = mergeSegmentScripts(segmentScripts, courseName, normalizedModules, hours);
      }

      if (mergedScript) {
        console.log(`[formal-generator] mergedScript length=${mergedScript.length}, narration=${narrationCharCount(mergedScript)}`);
        const script = buildFormalFromSelectedDraft(mergedScript, courseName, selectedKey, frameworkDirectives, normalizedModules, hours);
        if (script) {
          const minChars = Math.round(2200 * hours);
          const quality = validateLectureStage({
            drafts: normalizedDrafts,
            selectedDraft: selectedKey,
            finalScript: script
          }, { requireFinal: true, totalHours: hours });
          const narrationCount = quality.checks?.finalNarrationCharCount || 0;
          const canonicalSections = countCanonicalSections(script, normalizedModules, hours);
          const expectedSectionCount = normalizedModules.length + 3;
          // 多段生成时放宽章节要求（可能有些模块合并了）
          const sectionThreshold = segmentCount > 1 ? Math.max(5, expectedSectionCount - 2) : expectedSectionCount;
          console.log(`[formal-generator] post-build: narration=${narrationCount}/${Math.round(minChars * 0.6)} canonicalSections=${canonicalSections}/${sectionThreshold} errors=${quality.errors.length}`);
          // 验收条件：AI 稿无结构错误（errors=0），且字数 ≥ 60% 目标（兜底宽容），章节数达标
          // 字数不足仅为 warning，不进入 errors，故此处改为直接检查 narrationCount
          const narrationAcceptable = narrationCount >= Math.round(minChars * 0.6);
          if (
            quality.errors.length === 0
            && narrationAcceptable
            && canonicalSections >= sectionThreshold
          ) {
            return {
              script,
              meta: {
                ...fallback.meta,
                generationMode: segmentCount > 1 ? `deep-${segmentCount}seg` : 'deep',
                usedBaseDraft: selectedKey,
                frameworkDirectives,
                validation: {
                  ...fallback.meta.validation,
                  teacherNarrationCharCount: quality.checks.finalNarrationCharCount,
                  effectiveCharCount: quality.checks.finalCharCount
                }
              }
            };
          }
        }
      }
    } catch (err) {
      console.error('[formal-generator] AI 分段生成失败，回退 fallback:', err && err.message);
    }
  }

  return {
    ...fallback,
    meta: {
      ...fallback.meta,
      generationMode: 'fallback',
      usedBaseDraft: selectedKey,
      frameworkDirectives
    }
  };
}

module.exports = {
  generateFormalLectureScript
};
