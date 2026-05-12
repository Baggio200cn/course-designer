const { normalizeTeacherStyleRubric } = require('./style-rubric');
const { mergeTeacherSampleStyle } = require('./teacher-sample-style');
const { detectCourseProfile, getCourseProfileLexicon } = require('./course-profile');
const { resolveFrameworkDirectives } = require('./framework-directives');
const { normalizeLectureMarkdown } = require('./lecture-format');

// Phase-6 M1.4 — Prompt 装配器（来源治理 + 顺序治理）
// 把原硬编码的 systemPrompt 4 行散文拆为 4 个 fragment，按 SLOT_ORDER 装配
const { buildAbcSystemFragments, buildAbcSystemPromptLegacy } = require('../agent/builders/abc.builder');
const { assemble } = require('../agent/prompt-assembler');

// Prompt 装配器开关：true 走 fragment 装配（默认）；false 回退到原 4 行硬编码 systemPrompt
// 应急回滚：把这个常量改为 false 即可恢复改造前行为（buildAbcSystemPromptLegacy 输出与原始字节一致）
const USE_ASSEMBLER = true;

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shorten(value, max = 36) {
  const text = cleanText(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function firstNonEmpty(values, fallback = '') {
  const hit = toList(values).map((item) => cleanText(item)).find(Boolean);
  return hit || fallback;
}

function firstActionableInteraction(values, fallback = '') {
  const hit = toList(values)
    .map((item) => cleanText(item))
    .find((item) => item && !/常用.+带课堂|经常用.+带课堂|适合在.+前加|先给案例或图片|口吻要像|每句话只表达|提问句尽量|更强调.+互动|课堂的互动环节|要求栏|提示词|正式稿|草稿/.test(item));
  return hit || fallback;
}

function normalizeModules(modules = []) {
  return toList(modules).slice(0, 8).map((item, index) => {
    const knowledgePoints = toList(item?.knowledgePoints || item?.keyPoints)
      .map((point) => cleanText(point))
      .filter(Boolean)
      .slice(0, 4);
    return {
      id: item?.id || '',
      moduleNumber: Number(item?.moduleNumber || item?.number) || index + 1,
      name: cleanText(item?.name) || `模块${index + 1}`,
      description: cleanText(item?.description),
      hours: Number(item?.hours) || 0,
      knowledgePoints
    };
  });
}

function buildKnowledgeLine(module) {
  if (module.knowledgePoints.length) return module.knowledgePoints.join('、');
  if (module.description) return shorten(module.description, 42);
  return '核心概念、操作步骤、判断标准';
}

function buildDeepDiveLine(module) {
  if (module.knowledgePoints.length >= 2) {
    return `重点讲透“${module.knowledgePoints[0]}”与“${module.knowledgePoints[1]}”之间的关系。`;
  }
  if (module.knowledgePoints[0]) {
    return `重点讲透“${module.knowledgePoints[0]}”在真实操作中的判断依据。`;
  }
  return '重点讲透岗位操作中为什么这样做、错在哪里、如何纠正。';
}

function buildExampleLine(module) {
  if (module.description) return `结合“${shorten(module.description, 26)}”做课堂例子。`;
  return '用一个贴近岗位任务的课堂例子把概念落到操作。';
}

function buildTaskLine(module) {
  if (module.knowledgePoints[0]) return `让学生当堂完成与“${module.knowledgePoints[0]}”对应的小任务。`;
  return '让学生当堂完成一个可检查的小任务。';
}

function buildMisconceptionLine(module) {
  if (module.knowledgePoints[1]) return `不要把“${module.knowledgePoints[1]}”只讲定义，要补上判断依据。`;
  return '不要只停留在概念解释，要补上操作标准和易错点。';
}

function classifyModuleType(module) {
  const name = cleanText(module?.name);
  if (/原理|认知|概念|基础理论/.test(name)) return 'theory';
  if (/元件|识别|连接|基础|工具/.test(name)) return 'component';
  if (/组装|装配|安装|布线|焊接/.test(name)) return 'assembly';
  if (/调试|验收|检测|排查|故障/.test(name)) return 'debug';
  return 'general';
}

function classifyTeachingPhase(module) {
  const name = cleanText(module?.name);
  if (/评价标准|标准|评价|评估/.test(name)) return 'standard';
  if (/互鉴|互评|画廊|赏|讲评/.test(name)) return 'critique';
  if (/回收|测验|总结|收束|悟/.test(name)) return 'recall';
  if (/拼图|项目|实战|创|设计/.test(name)) return 'project';
  return 'general';
}

function buildProfileLeadSentence(lexicon, courseName = '') {
  return `这节课围绕《${courseName || '未命名课程'}》的${lexicon.realTask}展开。`;
}

function buildProfileModuleObservation(lexicon, type) {
  if (type === 'theory') return `先从${lexicon.sceneObject}入手，再倒推它背后的判断依据。`;
  if (type === 'component') return `这一部分先把${lexicon.objectUnit}认清楚，再谈后面的实际操作。`;
  if (type === 'assembly') return `这一部分要把${lexicon.processObject}按顺序真正做出来。`;
  if (type === 'debug') return `这一部分要围绕${lexicon.outputObject}判断问题出在哪里。`;
  return `这一部分要把${lexicon.keyChain}真正串起来。`;
}

function buildProfilePracticeLine(lexicon) {
  return `练习聚焦：围绕${lexicon.practiceAction}，检查学生是否能把判断依据真正落到结果上。`;
}

function buildProfileClosingLine(lexicon) {
  return `回到开场任务，对照评价标准快速复盘，并把今天的方法带回${lexicon.closingFocus}。`;
}

function buildExecutionTimeline(moduleCount) {
  const safeCount = Math.max(1, Number(moduleCount) || 1);
  const opening = { title: '【0-3分钟 开场组织】', start: 0, end: 3 };
  const close = { title: '【41-45分钟 总结收束】', start: 41, end: 45 };
  const practiceStart = Math.max(33, 41 - Math.max(7, safeCount * 2));
  const practice = { title: `【${practiceStart}-41分钟 课堂练习与检查】`, start: practiceStart, end: 41 };
  const coreStart = 3;
  const coreEnd = practiceStart;
  const span = Math.max(1, coreEnd - coreStart);
  const base = Math.floor(span / safeCount);
  let remainder = span - base * safeCount;
  let cursor = coreStart;
  const modules = Array.from({ length: safeCount }, (_, index) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    const start = cursor;
    const end = index === safeCount - 1 ? coreEnd : cursor + base + extra;
    cursor = end;
    return {
      start,
      end,
      title: `【${start}-${end}分钟 模块${index + 1}】`
    };
  });
  return { opening, modules, practice, close };
}

const DRAFT_VARIANT_CONFIG = {
  a: {
    label: 'A类候选讲稿',
    shortLabel: '知识逻辑型',
    summary: '更强调知识主线、判断依据和前后逻辑，适合先看课程结构是否讲得透。',
    openingFocus: '开场先把本节课的任务主线、判断标准和知识链讲清楚。',
    moduleFocus: '这一段重点把为什么这样判断、前后知识怎样串起来讲透。',
    practiceFocus: '练习要能看出学生是否真的建立了判断链，不只是把结果做出来。',
    closingFocus: '结尾优先回收知识主线、判断标准和迁移方法。'
  },
  b: {
    label: 'B类候选讲稿',
    shortLabel: '教师口播型',
    summary: '更强调老师现场怎么讲、怎么追问、怎么回收表达，适合先看口播自然度。',
    openingFocus: '开场先把课堂气口带起来，让学生知道为什么学、学完能做什么。',
    moduleFocus: '这一段重点做课堂提问、口头示范和当场回收表达。',
    practiceFocus: '练习要突出先判断、再说理由、再回到标准。',
    closingFocus: '结尾优先回收到老师可直接讲的总结和作业布置。'
  },
  c: {
    label: 'C类候选讲稿',
    shortLabel: '课堂执行型',
    summary: '更强调课堂动作、任务推进和结果检查，适合先看落地执行是否顺手。',
    openingFocus: '开场先把任务单、评价点和课堂节奏交代清楚。',
    moduleFocus: '这一段重点讲怎么组织学生做、怎么巡视、怎么检查结果。',
    practiceFocus: '练习要突出互查、修改和结果汇报。',
    closingFocus: '结尾优先回收到提交物、检查要求和下一步衔接。'
  }
};

function charCount(lines = []) {
  return toList(lines).join('').replace(/\s+/g, '').length;
}

function appendUntilMin(lines = [], minChars = 0, fillers = []) {
  const result = [...toList(lines).filter(Boolean)];
  const pool = toList(fillers).map((item) => cleanText(item)).filter(Boolean);
  if (!pool.length) return result;
  let cursor = 0;
  while (charCount(result) < minChars && cursor < pool.length * 4) {
    const next = pool[cursor % pool.length];
    if (!next) break;
    if (!result.includes(next) || cursor >= pool.length) {
      result.push(next);
    }
    cursor += 1;
  }
  return result;
}

function buildDraftTitle(courseName = '', variant = 'a') {
  const config = DRAFT_VARIANT_CONFIG[variant] || DRAFT_VARIANT_CONFIG.a;
  return `# ${courseName || '课程'} ${config.label}（${config.shortLabel}）`;
}

function buildDraftTiming(moduleCount = 1) {
  const timeline = buildExecutionTimeline(moduleCount);
  return {
    opening: `${timeline.opening.start}-${timeline.opening.end}分钟`,
    modules: timeline.modules.map((item) => `${item.start}-${item.end}分钟`),
    practice: `${timeline.practice.start}-${timeline.practice.end}分钟`,
    close: `${timeline.close.start}-${timeline.close.end}分钟`
  };
}

function sectionHeading(title, minutes) {
  return `## ${title}（${minutes}）`;
}

function renderFormalLikeSection(title, minutes, spokenLines = [], actionLines = []) {
  return [
    sectionHeading(title, minutes),
    '',
    '教师讲述：',
    ...toList(spokenLines).filter(Boolean),
    '',
    '课堂动作附栏：',
    ...toList(actionLines).filter(Boolean).map((line) => `- ${cleanText(line).replace(/^[-*]\s*/, '')}`)
  ].join('\n');
}

function buildOpeningDraftSpoken({ variant, courseName, style, lexicon, config, minChars }) {
  const signature = firstNonEmpty(style.signaturePhrases, '大家好，欢迎来到今天的课堂。');
  const courseLine = `这节课我们围绕《${courseName || '未命名课程'}》展开，核心任务不是只把内容看懂，而是要把${lexicon.realTask}真正讲清楚、做出来、解释得明白。`;
  const lines = [
    `${signature}${courseLine}`,
    `${config.openingFocus} 你们从现在开始就要带着“为什么这样做、怎样判断做到位、最后拿什么结果来证明学会了”这三个问题听课。`,
    `先不急着记结论，我们先把任务摆在前面：今天这节课要围绕${lexicon.keyChain}展开，既要看结果，更要看判断过程和表达依据。`,
    variant === 'a'
      ? '开场我会先帮大家把理解框架搭起来，后面每个模块都回到这条主线上，不让知识点散开。'
      : (variant === 'b'
        ? '开场我会边讲边追问，让大家先判断、先表达，再把答案真正收回来，不让课堂只停在听我讲。'
        : '从开场开始我就会把任务单、评价点和检查动作一起交代清楚，保证后面每一步都能真正落地。')
  ];
  const fillers = [
    `等会儿进入模块以后，你们不只是听我讲，还要不断回到${lexicon.sceneObject}和${lexicon.outputObject}去判断：这一段到底服务于哪个课堂结果。`,
    style?.controlHints?.interactionEmphasis
      ? '我会刻意多停一停，先请你们说判断，再请你们讲理由，最后我再把课堂标准收回来。'
      : '我会在关键地方停下来，带着大家把判断依据说完整，而不是只给一个答案就往下走。',
    `如果今天这节课结束以后，你能说清楚为什么这样判断、错了会有什么后果、怎样把标准落到结果上，这节课才算真正学到了。`
  ];
  return appendUntilMin(lines, minChars, fillers);
}

function buildOpeningDraftActions({ variant, lexicon }) {
  const base = [
    `展示与${lexicon.realTask}相关的真实案例、任务单或课堂目标页。`,
    '请学生先说出自己最先注意到的信息点，再追问理由。'
  ];
  if (variant === 'a') {
    base.push('板书本节课的知识主线、判断标准和课堂结果。');
  } else if (variant === 'b') {
    base.push('教师即时回收两到三个学生表达，现场示范怎样把理由说完整。');
  } else {
    base.push('同步说明本节课的检查节点、练习产出和课堂节奏安排。');
  }
  return base;
}

function buildModuleDraftSpoken({ variant, module, index, lexicon, config, style, minChars }) {
  const type = classifyModuleType(module);
  const phase = classifyTeachingPhase(module);
  const knowledgeLine = buildKnowledgeLine(module);
  const questionLead = firstActionableInteraction(style.interaction, '大家先想一想');
  if (phase === 'standard') {
    const lines = [
      index === 0 ? `第一点，我们先来看${module.name}。` : `接着，我们进入${module.name}。`,
      '这一段不是先讲结论，而是先把标准拆开。只有把标准说清楚，后面的设计、展示和互评才不会各说各话。',
      `我先带大家一起看${knowledgeLine}这几个判断点，再问一句：如果只凭个人感觉，不按标准看，最后会出什么问题？`,
      variant === 'a'
        ? '这一段重点不在于记住几个名词，而在于把标准之间的关系讲清楚，知道它们为什么要放在一起判断。'
        : (variant === 'b'
          ? '这一段我会一边讲一边追问，让你们把“为什么这一项也算标准”说出来，而不是只会点头。'
          : '这一段我会把评分口径、巡视重点和检查顺序一起交代出来，方便后面直接拿来打分和复核。'),
      '等会儿进入练习时，你们要真的拿这套标准去看作品、看结果、看表达，不能讲的时候一套，评的时候又换一套。'
    ];
    return appendUntilMin(lines, minChars, [
      '最容易出现的问题，是把标准讲成标签，却没有把每一条标准背后的判断依据讲明白。',
      '只要这一段标准立住了，后面无论是做方案、互评还是总结，课堂就会稳很多。'
    ]);
  }

  if (phase === 'critique') {
    const lines = [
      index === 0 ? `第一点，我们先来看${module.name}。` : `接着，我们进入${module.name}。`,
      '这一段重点不是我来单向点评，而是让大家带着统一标准去看别人的结果，再把修改建议说具体。',
      '等会儿我们做一轮画廊漫步，先看作品的亮点，再写一条真正能落地的修改意见，不能只停在“好看”或者“不好看”这两个字上。',
      variant === 'a'
        ? '这里要把互评和前面的标准链连起来，让学生知道为什么这条建议成立，而不是凭感觉给评价。'
        : (variant === 'b'
          ? '这一段我会多让你们开口，把判断依据和修改理由说出来，再由我回收成更专业的表达。'
          : '这一段我会把互评顺序、记录方式和结果回收一起带出来，保证每条建议都能真正落到修改上。'),
      '互评真正有价值的地方，不是打个分就结束，而是让对方知道下一步到底该改哪里、为什么这么改。'
    ];
    return appendUntilMin(lines, minChars, [
      '如果评价永远停留在感觉层面，那前面学过的标准就没有真正进入课堂结果。',
      '这一段结束时，每组至少要带走两条具体修改建议，后面修改才有依据。'
    ]);
  }

  if (phase === 'recall') {
    const lines = [
      index === 0 ? `第一点，我们先来看${module.name}。` : `接着，我们进入${module.name}。`,
      '这一段不是简单收尾，而是把前面分散的知识、判断和任务结果重新收回来，看看大家是不是真的会了。',
      '我会用快问快答或者抢答的方式回收几个关键点，但我不要你们只背定义，我更想听你把判断依据讲出来。',
      variant === 'a'
        ? '这里重点是把知识链重新串起来，看看前面每一段到底怎么连回最终任务。'
        : (variant === 'b'
          ? '这里我会追问得更口语一些，让你们用自己的话把关键判断说出来，而不是机械复述。'
          : '这里我会把回收问题、检查动作和结果记录压得更紧，确保这一段真的是课堂回收，不是随便收尾。'),
      '如果这一段只能背出名词，却说不清前后关系和判断理由，那就说明前面学的东西还没有真正稳住。'
    ];
    return appendUntilMin(lines, minChars, [
      '回收这一步的价值，在于把零散知识重新变回完整链条，再带到后面的总结和课后任务里。',
      '这一段结束以后，学生应该能用更短的话说得更清楚，而不是越说越散。'
    ]);
  }

  const lines = [
    index === 0 ? `第一点，我们先来看${module.name}。` : `接着，我们进入${module.name}。`,
    `${buildProfileModuleObservation(lexicon, type)} 这一段先不急着把名词背下来，而是先从“眼前这个现象说明了什么”开始往后推。`,
    `${buildExampleLine(module).replace(/。$/, '')} 你们先看现象，再判断它和今天的课堂任务到底有什么关系。`,
    `${questionLead}，如果这里判断错了，后面的${lexicon.processObject}或${lexicon.outputObject}会在哪一步开始出问题？`,
    `这一段真正要抓住的不是零散知识点，而是${knowledgeLine}这一条判断链。只要判断链断了，后面的讲解、操作和表达都会跟着散掉。`,
    `${buildDeepDiveLine(module)} 我会把“是什么、为什么、怎么判断、怎么避免出错”放在同一段里讲，而不是拆成互不相干的几句。`,
    `${buildMisconceptionLine(module)} 你们听的时候要特别留意：哪些地方只是表面现象，哪些地方才是真正的判断依据。`,
    `${buildTaskLine(module)} 到这一步，学生不仅要有结果，还要能把理由说出来。`
  ];

  const variantFillers = variant === 'a'
    ? [
      `${config.moduleFocus} 所以这一段我会反复把前一个知识点和后一个知识点串起来，让学生知道不是记了就行，而是要知道它们为什么会连在一起。`,
      `如果你只会背${knowledgeLine}里的关键词，却说不出它们之间的关系，那这一段在课堂上仍然算没学透。`,
      '这一段会先讲核心概念，再讲判断依据，再讲易错点，最后再回到任务结果上，让逻辑顺序保持稳定。'
    ]
    : (variant === 'b'
      ? [
        `${config.moduleFocus} 我会先让你们说出直觉判断，再追问一句“你为什么这么想”，最后再把老师的标准收回来。`,
        `如果学生只会说“我觉得”，我会继续追问到他能把${knowledgeLine}里的依据说清楚为止，这样课堂口头表达才算站得住。`,
        '这一段会保持老师真实授课的语气：边讲边问、边问边收，不让学生只做听众。'
      ]
      : [
        `${config.moduleFocus} 这一段我会把任务步骤、巡视重点和检查口径一起带出来，让学生知道现在该做什么、做到哪一步算合格。`,
        '如果课堂进入实操或练习，这里会优先强调顺序、动作和结果检查，避免学生只顾着往前做，忘了回头核对标准。',
        '这一段结束前，会明确留下一个可检查的小结果，便于后面做互查、讲评和修改。'
      ]);

  const interactionFiller = style?.controlHints?.interactionEmphasis
    ? '这里我会多让学生先判断、先表达，再请同伴补充理由，最后由老师把课堂标准落回来。'
    : '这里我会安排一次简短的当堂判断，让学生先说结果，再说依据。';

  return appendUntilMin(lines, minChars, [...variantFillers, interactionFiller]);
}

function buildModuleDraftActions({ variant, module, lexicon }) {
  const phase = classifyTeachingPhase(module);
  if (phase === 'standard') {
    return [
      '教师先把评价标准逐项拆开，再示范怎样按标准判断。',
      '学生围绕同一套标准给案例或作品打分，并说出理由。',
      variant === 'c'
        ? '同步记录评分口径和检查结果，便于后面直接用于复核。'
        : '教师重点纠正只凭个人喜好、不按标准判断的问题。'
    ];
  }

  if (phase === 'critique') {
    return [
      '教师组织画廊漫步或作品互评，提醒学生必须围绕标准写具体建议。',
      '学生轮流查看其他组作品，先写优点，再写一条可执行的修改意见。',
      variant === 'c'
        ? '现场回收修改建议并安排回组修改，保证意见真正进入结果。'
        : '教师回收典型评价，示范怎样把“好看”说成有依据的专业表达。'
    ];
  }

  if (phase === 'recall') {
    return [
      '教师用快问快答或抢答方式回收今天的关键概念和判断标准。',
      '学生先独立回答，再用一句话说明自己为什么这样判断。',
      variant === 'c'
        ? '同步记录回收结果，标出仍需补讲或补练的点。'
        : '教师只保留最关键的知识回收，不再展开新内容。'
    ];
  }

  const base = [
    `围绕“${module.name}”展示案例、图示或课堂材料。`,
    '要求学生先做判断，再说出依据。'
  ];
  if (variant === 'a') {
    base.push(`板书并串联“${buildKnowledgeLine(module)}”的知识关系。`);
    base.push('教师重点回收到“为什么这样判断”，不急着推进下一步。');
  } else if (variant === 'b') {
    base.push('教师追问两到三个学生回答，示范怎样把口头表达说完整。');
    base.push('回收典型表达，及时纠正只给结论不给理由的问题。');
  } else {
    base.push(`结合${lexicon.processObject}说明本段任务顺序、巡视重点和检查口径。`);
    base.push('安排同伴互查或阶段性小检查，确保每一步都有结果留痕。');
  }
  return base;
}

function buildPracticeDraftSpoken({ variant, style, lexicon, config, frameworkDirectives, minChars }) {
  const lines = [
    '现在不再继续加新知识，直接把前面讲过的判断方法、表达方式和任务标准收成一轮课堂练习。',
    `${config.practiceFocus} 这一段重点不是看谁做得快，而是看谁能把${lexicon.practiceAction}真正落到结果上，并且能说出自己这样处理的依据。`,
    '我会先给出统一标准，再让你们按标准互相检查，最后回到自己的结果上做一次修正。只有经历这一轮“完成、互查、修改、汇报”，这节课才算真正进入会用的状态。',
    style?.controlHints?.studentOutputEmphasis
      ? '每组都要留下一份可检查的结果，并安排一名同学负责把本组的判断依据、修改方向和最后结论说出来。'
      : '每组至少要把一个关键结果说清楚，不只是把东西做完，而是要能解释为什么这样处理。'
  ];
  const directiveTexts = toList(frameworkDirectives?.applied?.practice).map((item) => item.text);
  const fillers = [
    `我不会在这一段重新讲一遍全部知识，而是重点看你们能不能把${lexicon.keyChain}压缩成自己的判断动作。`,
    `如果练习中出现偏差，我会优先抓判断依据是不是站得住，再看表达是否完整，最后才看结果是否美观或成熟。`,
    ...directiveTexts
  ];
  return appendUntilMin(lines, minChars, fillers);
}

function buildPracticeDraftActions({ variant, frameworkDirectives }) {
  const base = [
    '教师巡视时只抓标准是否落地，不直接替学生完成结果。',
    '学生先独立完成练习，再按标准互查。'
  ];
  if (variant === 'a') {
    base.push('要求学生在结果旁边写出或说出关键判断依据。');
  } else if (variant === 'b') {
    base.push('每组选一人汇报本组判断理由，教师现场回收表达。');
  } else {
    base.push('每组提交一个可检查的课堂结果，并写出修改方向。');
  }
  toList(frameworkDirectives?.applied?.practice).forEach((item) => {
    base.push(item.text);
  });
  return base.slice(0, 5);
}

function buildClosingDraftSpoken({ variant, lexicon, config, frameworkDirectives, minChars }) {
  const lines = [
    `今天我们围绕${lexicon.realTask}把整节课从开场任务、模块推进、课堂练习到总结收束走了一遍。`,
    `${config.closingFocus} 现在请大家回头看：今天最容易错的判断点在哪里，一旦判断错了，会把后面哪一步一起带偏。`,
    `回到开场任务，如果现在让你重新说一遍这节课的关键标准，你至少要能把${lexicon.keyChain}和最终${lexicon.outputObject}之间的关系说清楚。`,
    '课后不是把课堂步骤抄一遍就结束，而是要把今天的方法迁移到新的任务情境里，看看你能不能独立做出同样的判断。'
  ];
  const directiveTexts = toList(frameworkDirectives?.applied?.closing).map((item) => item.text);
  const fillers = [
    variant === 'c'
      ? '结尾会收得更实一些，重点回收到提交物、检查要求和下一次课堂衔接，确保学生知道课后要交什么、怎么交、按什么标准交。'
      : '结尾会把方法、标准和迁移任务收拢起来，不让课堂停在“听过了”这个层面。',
    ...directiveTexts,
    `下一节课，我会继续把今天这套方法放回${lexicon.closingFocus}里，让大家看到它在后续课堂任务中的持续作用。`
  ];
  return appendUntilMin(lines, minChars, fillers);
}

function buildClosingDraftActions({ variant, frameworkDirectives }) {
  const base = [
    '对照评价标准回收课堂结果，点名说明一条做得好和一条需要修改的地方。'
  ];
  if (variant === 'a') {
    base.push('回收本节课的关键知识链和判断标准。');
  } else if (variant === 'b') {
    base.push('请学生用一句话复述今天最关键的判断依据。');
  } else {
    base.push('明确课后提交物、截止时间和下一节课衔接任务。');
  }
  toList(frameworkDirectives?.applied?.closing).forEach((item) => {
    base.push(item.text);
  });
  return base.slice(0, 5);
}

function buildCandidateDraft({ variant = 'a', courseName = '', modules = [], style = {}, lexicon, frameworkDirectives }) {
  const config = DRAFT_VARIANT_CONFIG[variant] || DRAFT_VARIANT_CONFIG.a;
  const moduleCount = Math.max(1, modules.length);
  const timing = buildDraftTiming(moduleCount);
  const moduleMinChars = Math.max(300, Math.floor((2500 - 760) / moduleCount));
  const openingMinChars = 250;
  const practiceMinChars = 260;
  const closingMinChars = 240;

  const sections = [
    buildDraftTitle(courseName, variant),
    '',
    renderFormalLikeSection(
      '开场导入',
      timing.opening,
      buildOpeningDraftSpoken({ variant, courseName, style, lexicon, config, minChars: openingMinChars }),
      buildOpeningDraftActions({ variant, lexicon })
    ),
    ''
  ];

  modules.forEach((module, index) => {
    sections.push(
      renderFormalLikeSection(
        `模块${index + 1}：${module.name}`,
        timing.modules[index] || `${3 + index * 6}-${9 + index * 6}分钟`,
        buildModuleDraftSpoken({
          variant,
          module,
          index,
          lexicon,
          config,
          style,
          minChars: moduleMinChars
        }),
        buildModuleDraftActions({ variant, module, lexicon })
      ),
      ''
    );
  });

  sections.push(
    renderFormalLikeSection(
      '课堂练习与检查',
      timing.practice,
      buildPracticeDraftSpoken({ variant, style, lexicon, config, frameworkDirectives, minChars: practiceMinChars }),
      buildPracticeDraftActions({ variant, frameworkDirectives })
    ),
    '',
    renderFormalLikeSection(
      '总结收束',
      timing.close,
      buildClosingDraftSpoken({ variant, lexicon, config, frameworkDirectives, minChars: closingMinChars }),
      buildClosingDraftActions({ variant, frameworkDirectives })
    )
  );

  return sections.join('\n').trim();
}

function buildLocalDraftA({ courseName, modules, style, lexicon }) {
  const lines = [
    '【开场】',
    buildProfileLeadSentence(lexicon, courseName),
    '先讲清本节课完成什么任务，再说明按什么标准判断学会。',
    firstNonEmpty(style.openingRules, '')
  ].filter(Boolean);

  modules.forEach((module, index) => {
    lines.push(
      '',
      `【模块${index + 1}：${module.name}】`,
      `知识主线：${buildKnowledgeLine(module)}`,
      `关键讲透：${buildDeepDiveLine(module)}`,
      `典型误区：${buildMisconceptionLine(module)}`,
      `课堂例子：${buildExampleLine(module)}`,
      `落点任务：${buildTaskLine(module)}`
    );
  });

  lines.push(
    '',
    '【课堂练习】',
    buildProfilePracticeLine(lexicon),
    '评价标准：至少有一项课堂产出能对照标准完成自检。',
    '',
    '【收束】',
    buildProfileClosingLine(lexicon),
    '明确课后提交物、检查要点和下一节课衔接。'
  );
  return lines.join('\n');
}

function buildModuleBLines(module, index, style, lexicon) {
  const type = classifyModuleType(module);
  const lead = index === 0 ? '第一点，我们先来看' : '接着，我们说一说';
  const questionLead = firstActionableInteraction(style.interaction, '我向大家提个小问题');
  const interactiveWrap = style?.controlHints?.interactionEmphasis
    ? '大家先判断一下，再把你的理由说出来。'
    : '';
  const summaryLead = /因此|所以/.test(firstNonEmpty(style.structure)) ? firstNonEmpty(style.structure) : '因此，我们发现';

  if (type === 'theory') {
    return [
      `${lead}${module.name}。`,
      `我这里先给大家看一个现象：${buildExampleLine(module).replace(/。$/, '')}。`,
      buildProfileModuleObservation(lexicon, type),
      `${questionLead}，如果把条件换一换，结果会不会跟现在一样？`,
      interactiveWrap,
      `所以这里要记住，${buildKnowledgeLine(module)}。`,
      `${summaryLead}，${buildMisconceptionLine(module).replace(/。$/, '')}。`
    ];
  }

  if (type === 'component') {
    return [
      `${lead}${module.name}。`,
      buildProfileModuleObservation(lexicon, type),
      `大家看一看，${buildExampleLine(module).replace(/。$/, '')}。`,
      `如果前面识别错了，后面每一步都会跟着错，所以要盯住${buildKnowledgeLine(module)}。`,
      interactiveWrap,
      `因此要特别提醒，${buildMisconceptionLine(module).replace(/。$/, '')}。`
    ];
  }

  if (type === 'assembly') {
    return [
      `${lead}${module.name}。`,
      buildProfileModuleObservation(lexicon, type),
      `先看一看成品或布局，再想一想自己第一步应该从哪里下手。`,
      `真正决定成败的，是顺序和细节，所以要盯住${buildKnowledgeLine(module)}。`,
      interactiveWrap,
      `等会儿你们动手的时候，要把这一步落到结果上：${buildTaskLine(module).replace(/。$/, '')}。`
    ];
  }

  if (type === 'debug') {
    return [
      `${lead}${module.name}。`,
      `做到这里，不是只求${lexicon.outputObject}看起来没问题，而是要会判断、会排查、会说明原因。`,
      `大家想一想，出现异常的时候，你第一步先查哪里，为什么？`,
      `先看现象，再倒推原因，这里真正要记住的是${buildKnowledgeLine(module)}。`,
      interactiveWrap,
      `所以要特别提醒，${buildMisconceptionLine(module).replace(/。$/, '')}。`
    ];
  }

  return [
    `${lead}${module.name}。`,
    buildProfileModuleObservation(lexicon, type),
    `大家先看一看，${buildExampleLine(module).replace(/。$/, '')}。`,
    `我向大家提个小问题，这一步最容易忽略什么？`,
    interactiveWrap,
    `所以这里要记住，${buildKnowledgeLine(module)}。`,
    `${buildMisconceptionLine(module)}`
  ];
}

function buildLocalDraftB({ courseName, modules, style, lexicon }) {
  const signature = firstNonEmpty(style.signaturePhrases, '大家好，欢迎来到今天的课堂。');
  const closingLead = firstNonEmpty(style.closingRules, '结尾必须回收本节内容，并预告下一节课。');
  const lines = [
    '【开场】',
    `${signature}这节课，我会带着大家围绕《${courseName || '未命名课程'}》解决一个真实课堂问题。`,
    '先不急着记结论，我们先搞清楚：这节课为什么学，学完以后你能做什么。',
    `所以从开头开始，你就要带着任务去听，带着${lexicon.keyChain}去看。`
  ];

  modules.forEach((module, index) => {
    lines.push('', `【模块${index + 1}：${module.name}】`, ...buildModuleBLines(module, index, style, lexicon));
  });

  lines.push(
    '',
    '【课堂练习】',
    '现在不再继续加新知识，直接把前面讲的动作收成一轮课堂练习。',
    '我先给标准，你们再按标准互相检查，这样才知道自己到底会不会，不是听懂了就算会。',
    '每组派一人，用一句话说清自己的判断依据。',
    '',
    '【收束】',
    '最后，我们总结一下今天最关键的判断标准和操作顺序。',
    '作业不求多，但一定要看得出你有没有把今天的方法真正迁移到任务里。',
    closingLead.includes('下一节课')
      ? closingLead
      : '下一节课，我会带大家把今天这套判断方法放到更完整的课堂任务里。'
  );
  return lines.join('\n');
}

function buildLocalDraftC({ courseName, modules, style, lexicon }) {
  const interaction = firstActionableInteraction(style.interaction, '每讲完一个点，立刻让学生用一句话复述判断依据。');
  const timeline = buildExecutionTimeline(modules.length);
  const lines = [
    timeline.opening.title,
    `教师动作：投屏《${courseName || '未命名课程'}》任务目标与评价标准，说明最后要交付的课堂结果。`,
    '学生活动：先判断本节课最难的环节是什么，再带着问题进入课堂。',
    '板书提示：任务目标 / 评价标准 / 最终产出',
    `检查点：${interaction}`
  ];

  modules.forEach((module, index) => {
    const slot = timeline.modules[index];
    lines.push(
      '',
      `【${slot.start}-${slot.end}分钟 模块${index + 1}：${module.name}】`,
      `教师动作：围绕“${buildKnowledgeLine(module)}”做示范，讲清判断依据和操作要点，并结合${lexicon.actionDemo}。`,
      `学生活动：先观察示范，再按要求完成“${buildTaskLine(module).replace(/。$/, '')}”。`,
      `板书提示：${buildKnowledgeLine(module)}`,
      `检查点：${buildMisconceptionLine(module)}`,
      '产出要求：每个小组至少提交一个可检查的课堂结果。'
    );
  });

  lines.push(
    '',
    timeline.practice.title,
    `教师动作：不再补充新知识，直接布置一轮整合练习，并按标准巡视。`,
    `学生活动：围绕本节课核心任务完成练习，按“${lexicon.reviewAction}”互相复核。`,
    '板书提示：操作顺序 / 自检标准 / 结果记录',
    '检查点：教师只抓是否符合标准，不直接替学生完成答案。',
    '',
    timeline.close.title,
    '教师动作：对照评价标准逐项回收成果，指出共性问题和下节课衔接。',
    '学生活动：口头复盘今天最关键的一条判断标准，明确课后提交物。',
    '板书提示：本节重点 / 课后任务 / 下节衔接'
  );
  return lines.join('\n');
}

function buildLocalDraft({ variant, courseName, modules, style }) {
  const profile = detectCourseProfile({ courseName, modules });
  const lexicon = getCourseProfileLexicon(profile);
  const frameworkDirectives = resolveFrameworkDirectives({ style, modules, courseProfile: profile });
  return buildCandidateDraft({
    variant,
    courseName,
    modules,
    style,
    lexicon,
    frameworkDirectives
  });
}

function parseDraftJson(text) {
  const raw = String(text || '');
  try {
    return JSON.parse(raw);
  } catch {}
  try {
    const matched = raw.match(/\{[\s\S]*\}/);
    return matched ? JSON.parse(matched[0]) : null;
  } catch {
    return null;
  }
}

function normalizeAiDraftVariant(text = '', courseName = '', variant = 'a') {
  const config = DRAFT_VARIANT_CONFIG[variant] || DRAFT_VARIANT_CONFIG.a;
  return normalizeLectureMarkdown(text, {
    titleOverride: `${courseName || '课程'} ${config.label}（${config.shortLabel}）`
  });
}

async function generateLectureABCDrafts({
  courseName = '',
  modules = [],
  styleRubricText = '',
  aiClient = null,
  totalHours = 1,
  notebookContext = {}   // Phase-5B：富上下文，含软件工具/岗位/学情等
}) {
  const style = mergeTeacherSampleStyle(normalizeTeacherStyleRubric(styleRubricText));
  const normalizedModules = normalizeModules(modules);
  const variants = ['a', 'b', 'c'];
  const courseProfile = detectCourseProfile({ courseName, modules: normalizedModules });
  const profileLexicon = getCourseProfileLexicon(courseProfile);
  const frameworkDirectives = resolveFrameworkDirectives({ style, modules: normalizedModules, courseProfile });

  if (aiClient && typeof aiClient.chatJson === 'function') {
    const appliedTexts = frameworkDirectives.applied.closing.concat(frameworkDirectives.applied.practice, frameworkDirectives.applied.general).map((item) => item.text).filter(Boolean);
    const basePrompt = [
      '<task>',
      '生成中职课程讲稿，输出 A/B/C 三个完整候选版本。',
      '输出格式：JSON 对象 {“a”:”讲稿A全文”,”b”:”讲稿B全文”,”c”:”讲稿C全文”}',
      '</task>',
      '',
      '<requirements>',
      '<structure>每稿必须包含：标题、开场导入、模块1到模块N、课堂练习与检查、总结收束。每个部分写出”教师讲述：”和”课堂动作附栏：”。</structure>',
      `<duration>本课程共${Number(totalHours) || 1}学时，每学时45分钟，总时长${(Number(totalHours) || 1) * 45}分钟。</duration>`,
      `<length>每稿教师讲述≥${Math.round(1800 * (Number(totalHours) || 1))}汉字，目标${Math.round(2200 * (Number(totalHours) || 1))}-${Math.round(3000 * (Number(totalHours) || 1))}字。</length>`,
      '<variants>',
      '  A稿=知识逻辑型：强调知识主线、判断依据和模块前后逻辑。',
      '  B稿=教师口播型：像老师站在课堂上直接开讲，强调追问和回收表达。',
      '  C稿=课堂执行型：强调任务推进、巡视、互查和结果检查，但保留完整教师讲述。',
      '</variants>',
      '<tone>口语化、任务导向、像真实老师说话。禁止AI腔、空话套话。</tone>',
      '<content_rules>',
      '  - 每个模块的"教师讲述"必须是可直接上课的口播正文，包含具体案例、数据、提问、互动。',
      '  - 禁止使用引导性元描述代替正文。以下句式绝对禁止出现在讲稿中：',
      '    "学完这一段，学生应该能够..."',
      '    "这里有一个常见误区..."',
      '    "这一段要把XX讲成一条连续判断链..."',
      '    "这一部分围绕XX展开，先把当前环节要解决的课堂问题交代清楚"',
      '    "重点要把XX之间的关系讲清楚"',
      '    "教师还要明确指出这一环节最容易出错的地方"',
      '  - 这些是"教学设计备注"，不是"教师口播正文"。讲稿中只写老师真正会说出口的话。',
      '  - 正确示范："同学们看这个案例，左边是A方案，右边是B方案，你们觉得哪个更好？为什么？"',
      '  - 错误示范："这一段要把A和B讲成一条连续判断链，避免学生只记住名词"',
      '</content_rules>',
      '<forbidden>提示词、要求栏、写作要求、风格提醒、结构说明、系统元指令、教学设计备注。</forbidden>',
      '</requirements>',
      '',
      '<course>',
      `<name>${courseName}</name>`,
      `<profile>${profileLexicon.label}</profile>`,
      `<focus>围绕${profileLexicon.realTask}展开，突出${profileLexicon.qualityFocus}</focus>`,
      // 富上下文注入（Phase-5B）：有值时强制要求 AI 使用具体信息
      notebookContext.softwareTools
        ? `<software>【必须使用】本课程使用的具体软件工具：${notebookContext.softwareTools}。讲稿中凡涉及软件操作，必须写该软件的真实名称和操作路径，禁止写"三维设计软件"等泛指。</software>`
        : '',
      notebookContext.jobTargets
        ? `<jobs>【必须关联】目标职业岗位：${notebookContext.jobTargets}。讲稿中的案例、情境、评价标准必须与这些岗位的真实工作任务挂钩。</jobs>`
        : '',
      notebookContext.industryScenarios
        ? `<industry>行业应用场景：${notebookContext.industryScenarios}。开场导入和课堂案例优先从此场景取材。</industry>`
        : '',
      notebookContext.learnerProfile
        ? `<learners>学情说明：${notebookContext.learnerProfile}。讲稿难度、举例方式和互动设计需匹配该学情。</learners>`
        : '',
      // Phase-5C Cross-Stage：注入上游框架阶段的教学目标（由 context-builder 构建）
      notebookContext.frameworkObjectives
        ? `<framework_objectives>本课既定教学目标：${notebookContext.frameworkObjectives}。讲稿各模块的教师讲述需覆盖并落实上述目标。</framework_objectives>`
        : '',
      notebookContext.frameworkTeachingMethods
        ? `<teaching_methods>本课主要教学方法：${notebookContext.frameworkTeachingMethods}。讲稿中的互动设计和课堂活动需与此方法匹配。</teaching_methods>`
        : '',
      `<modules>${JSON.stringify(normalizedModules, null, 2)}</modules>`,
      '</course>',
      // ── 参考资料权重注入（显式权重控制）───────────────────────────────────────
      // 权重层级：参考资料中的专业细节 > 框架目标中的教学设计 > AI 通用知识
      // 参考资料用于"用什么内容讲"，框架用于"按什么目标讲"，风格规则用于"用什么方式讲"
      notebookContext.referenceContext
        ? [
            '',
            '<reference_material priority="highest">',
            '【权重说明——参考资料优先级最高，必须用于以下方面：】',
            '① 专业术语：用参考资料中出现的真实名称替换 AI 的泛化说法（如用"3ds Max 视图导航"替换"三维软件界面操作"）',
            '② 操作步骤：直接提取参考资料中的具体操作流程，逐步骤说明，禁止用通用描述代替',
            '③ 行业案例：优先使用参考资料中提到的真实项目、品牌或案例，不要凭空编造',
            '④ 课标要求：如参考资料含课程标准/教学大纲，其学习目标和考核要点必须体现在讲稿中',
            '【参考资料不覆盖以下方面——仍遵守框架和风格规则：】',
            '⑤ 整体教学结构（由 framework_objectives 决定）',
            '⑥ 开场/结束/互动的口播方式（由 style_rules 决定）',
            '⑦ 字数和格式要求（由系统质量标准决定）',
            '',
            String(notebookContext.referenceContext),
            '</reference_material>'
          ].join('\n')
        : '',
      '',
      '<style_rules>',
      `<opening>${style.openingRules.join('；')}</opening>`,
      `<module_flow>${style.moduleFlow.join('；')}</module_flow>`,
      `<sentence>${style.sentenceRules.join('；')}</sentence>`,
      `<closing>${style.closingRules.join('；')}</closing>`,
      `<signature>${style.signaturePhrases.join('；')}</signature>`,
      '</style_rules>',
      appliedTexts.length ? `\n<teacher_requirements>${appliedTexts.join('；')}</teacher_requirements>` : ''
    ].filter(Boolean).join('\n');
    try {
      const text = await aiClient.chatJson({
        // Phase-6 M1.4：systemPrompt 改由 prompt-assembler 装配（4 个 fragment）
        // 关闭开关 USE_ASSEMBLER=false 可一键回退到原硬编码字符串（buildAbcSystemPromptLegacy）
        systemPrompt: USE_ASSEMBLER
          ? assemble(buildAbcSystemFragments())
          : buildAbcSystemPromptLegacy(),
        userPrompt: basePrompt,
        temperature: 0.28,
        maxTokens: Math.max(8000, Math.round(8000 * (Number(totalHours) || 1)))
      });
      const parsed = parseDraftJson(text) || {};
      if (parsed.a || parsed.b || parsed.c) {
        return {
          a: normalizeAiDraftVariant(String(parsed.a || ''), courseName, 'a'),
          b: normalizeAiDraftVariant(String(parsed.b || ''), courseName, 'b'),
          c: normalizeAiDraftVariant(String(parsed.c || ''), courseName, 'c'),
          style,
          courseProfile,
          frameworkDirectives
        };
      }
    } catch {}
  }

  const drafts = variants.reduce((acc, key) => {
    acc[key] = buildLocalDraft({ variant: key, courseName, modules: normalizedModules, style });
    return acc;
  }, {});
  return { ...drafts, style, courseProfile, frameworkDirectives };
}

module.exports = {
  generateLectureABCDrafts
};
