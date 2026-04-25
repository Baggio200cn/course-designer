const gztextileCourseMap = require('./gztextile-course-map.json');

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCourseKey(value) {
  return cleanText(value)
    .replace(/[（）()《》〈〉【】\[\]\s·•,，。!！?？:：;；"'“”‘’`~\-+＋/\\|]/g, '')
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKeywordPattern(values = []) {
  const terms = toList(values)
    .map((item) => cleanText(item))
    .filter(Boolean)
    .map((item) => escapeRegExp(item));
  if (!terms.length) return null;
  return new RegExp(terms.join('|'));
}

const GZTEXTILE_PROFILE_DATA = gztextileCourseMap.profiles || {};
const GZTEXTILE_EXACT_LOOKUP = new Map();

Object.entries(GZTEXTILE_PROFILE_DATA).forEach(([profile, config]) => {
  toList(config?.courseNames).forEach((courseName) => {
    const key = normalizeCourseKey(courseName);
    if (key && !GZTEXTILE_EXACT_LOOKUP.has(key)) GZTEXTILE_EXACT_LOOKUP.set(key, profile);
  });
});

const GZTEXTILE_PROFILE_MATCHERS = Object.entries(GZTEXTILE_PROFILE_DATA).map(([key, config]) => ({
  key,
  pattern: buildKeywordPattern([...(config?.keywords || []), ...(config?.courseNames || [])]),
  keywords: toList(config?.keywords).map((item) => cleanText(item)).filter(Boolean),
  courseNames: toList(config?.courseNames).map((item) => cleanText(item)).filter(Boolean)
})).filter((item) => item.pattern);

const PROFILE_MATCHERS = [
  {
    key: 'gztextile_fashion_display',
    pattern: /广州市纺织服装职业学校|广纺织|服装陈列与展示设计|服装传播|时尚传播|店铺（含新媒体）运营与管理/
  },
  {
    key: 'fashion_display',
    pattern: /服装陈列|展示设计|橱窗|陈列|服饰搭配|服装传播|时尚传播|品牌项目|跨媒体陈列|舞台布景|时尚品牌|文案创作|服装摄影|视觉营销|店铺规划|商品陈设|卖场|橱窗创意|品牌鉴赏/
  },
  {
    key: 'electronics',
    pattern: /LED|电路|电子|电工|焊接|万用表|电源|传感器|单片机|导线|元器件|PCB|电压|电流/
  },
  {
    key: 'mechanical',
    pattern: /机械|机床|零件|装配|加工|车削|铣削|钳工|工件|尺寸|配合|测量|刀具|模具/
  },
  {
    key: 'software',
    pattern: /软件|编程|代码|Python|Java|网页|前端|数据库|Excel|Office|信息技术|剪辑|建模|PS|算法|函数/
  },
  {
    key: 'service',
    pattern: /服务|接待|礼仪|沟通|客服|酒店|餐饮|护理|导游|营销|直播|销售|话术|电商|门店/
  },
  {
    key: 'theory',
    pattern: /语文|数学|英语|历史|政治|地理|生物|化学|物理|概论|认知|理论|基础知识|阅读|写作/
  }
];

const PROFILE_LEXICONS = {
  gztextile_merchandising: {
    domain: 'gztextile_fashion',
    specialty: 'merchandising',
    label: '广纺织服装陈列与展示',
    realTask: '真实店铺陈列、橱窗展示与视觉营销任务',
    keyChain: '品牌调性、陈列逻辑、视觉层次和顾客动线',
    sceneObject: '店铺、橱窗与卖场陈列情境',
    objectUnit: '服装货品、模特、道具、灯光与陈列分区',
    processObject: '陈列规划、搭配摆场和展示调整动作',
    outputObject: '陈列成品、橱窗效果和展示结果',
    qualityFocus: '主题表达、视觉重心、层次节奏、搭配关系和动线组织',
    actionDemo: '示范橱窗主位、VP/PP/IP分区和货品搭配方法',
    practiceAction: '按品牌主题完成陈列摆场、动线优化和展示讲评',
    reviewAction: '按品牌调性、视觉层次、陈列逻辑和顾客动线核对展示结果',
    closingFocus: '广纺织老师常用的店铺陈列、橱窗展示和门店视觉任务'
  },
  gztextile_fashion_communication: {
    domain: 'gztextile_fashion',
    specialty: 'communication',
    label: '广纺织服装传播与品牌表达',
    realTask: '真实服装产品传播、品牌内容策划与新媒体表达任务',
    keyChain: '目标顾客、品牌信息、视觉表达和传播转化',
    sceneObject: '品牌传播、新媒体内容与产品发布情境',
    objectUnit: '产品卖点、画面素材、文案脚本和传播渠道',
    processObject: '传播策划、内容组织和表达优化动作',
    outputObject: '传播方案、文案内容和视觉表达结果',
    qualityFocus: '品牌信息准确度、内容逻辑、视觉统一性和传播说服力',
    actionDemo: '示范卖点提炼、内容结构和品牌表达方法',
    practiceAction: '按传播任务完成内容策划、文案表达和展示讲解',
    reviewAction: '按目标顾客、品牌信息、视觉统一性和传播目标核对结果',
    closingFocus: '广纺织老师常用的品牌传播、服装文案和新媒体课堂任务'
  },
  gztextile_styling: {
    domain: 'gztextile_fashion',
    specialty: 'styling',
    label: '广纺织服装搭配与造型展示',
    realTask: '真实服饰搭配、人物造型与展示表现任务',
    keyChain: '人物定位、风格搭配、色彩关系和整体造型表达',
    sceneObject: '人物造型、服饰搭配与展示拍摄情境',
    objectUnit: '服装单品、配饰、妆造元素与色彩关系',
    processObject: '搭配组合、造型调整和展示表达动作',
    outputObject: '整体造型、搭配效果和展示呈现结果',
    qualityFocus: '风格统一、色彩协调、人物匹配和展示完成度',
    actionDemo: '示范人物定位分析、单品组合和造型优化方法',
    practiceAction: '按造型任务完成搭配调整、展示说明和同伴互评',
    reviewAction: '按人物定位、色彩关系、搭配逻辑和整体效果核对结果',
    closingFocus: '广纺织老师常用的搭配展示、造型表达和人物形象任务'
  },
  gztextile_design_project: {
    domain: 'gztextile_fashion',
    specialty: 'design_project',
    label: '广纺织服装项目设计',
    realTask: '真实服装项目设计、产品开发与方案呈现任务',
    keyChain: '任务主题、目标用户、设计逻辑和项目呈现结果',
    sceneObject: '项目开发、主题企划与方案评审情境',
    objectUnit: '主题资料、设计元素、系列款式与项目版面',
    processObject: '项目分析、方案推进和成果整合动作',
    outputObject: '项目方案、系列设计和汇报结果',
    qualityFocus: '主题聚焦、用户对应、系列统一性和项目表达完整度',
    actionDemo: '示范主题拆解、系列整合和项目汇报方法',
    practiceAction: '按项目任务完成方案推进、结果展示和阶段复盘',
    reviewAction: '按主题、用户、系列逻辑和项目完成度核对结果',
    closingFocus: '广纺织老师常用的服装项目开发、专题设计和综合展示任务'
  },
  gztextile_fashion_display: {
    domain: 'gztextile_fashion',
    specialty: 'integrated',
    label: '广纺织服装传播与陈列展示',
    realTask: '真实品牌陈列、展示传播与店铺视觉任务',
    keyChain: '品牌定位、陈列逻辑、视觉层次和传播表达',
    sceneObject: '品牌店铺、橱窗与新媒体展示情境',
    objectUnit: '服装货品、搭配单元、道具、橱窗与传播素材',
    processObject: '陈列策划、搭配调整和展示服务动作',
    outputObject: '展示成品、陈列效果和品牌传播结果',
    qualityFocus: '品牌调性、主题表达、搭配关系、视觉节奏和顾客动线',
    actionDemo: '示范品牌调性分析、陈列分区、橱窗叙事和展示表达方法',
    practiceAction: '按品牌任务完成陈列演练、展示讲解和同伴互评',
    reviewAction: '按品牌调性、视觉层次、陈列逻辑和传播目标核对展示结果',
    closingFocus: '把今天的陈列判断带回广纺织老师常用的店铺陈列、橱窗展示和服装传播课堂任务'
  },
  fashion_display: {
    label: '服装陈列与展示服务',
    realTask: '真实品牌陈列与展示传播任务',
    keyChain: '品牌定位、视觉陈列和展示表达结果',
    sceneObject: '陈列情境',
    objectUnit: '货品、道具、橱窗与传播素材',
    processObject: '陈列设计与展示服务动作',
    outputObject: '展示效果与品牌表达结果',
    qualityFocus: '陈列逻辑、视觉层次、搭配关系和品牌调性',
    actionDemo: '示范陈列动线、搭配逻辑和展示表达方法',
    practiceAction: '按品牌任务完成陈列演练并互评展示效果',
    reviewAction: '按品牌调性、视觉层次和传播目标核对展示结果',
    closingFocus: '把今天的陈列判断带回真实店铺、橱窗和新媒体展示任务'
  },
  electronics: {
    label: '电子电路实训',
    realTask: '真实补光或通电任务',
    keyChain: '极性判断、接线顺序和通电结果',
    sceneObject: '电路现象',
    objectUnit: '元件和线路',
    processObject: '接线和组装',
    outputObject: '点亮结果',
    qualityFocus: '焊点、走线和通电状态',
    actionDemo: '示范接线、测量和排查顺序',
    practiceAction: '按电路标准完成练习并互查',
    reviewAction: '按验收单核对点亮效果和接线稳定性',
    closingFocus: '把今天的判断依据带回真实电路任务'
  },
  mechanical: {
    label: '机械装配加工',
    realTask: '真实装配或加工任务',
    keyChain: '尺寸判断、工序顺序和装配结果',
    sceneObject: '工位现象',
    objectUnit: '零件和工装',
    processObject: '装配和加工动作',
    outputObject: '装配结果',
    qualityFocus: '尺寸、配合和工艺顺序',
    actionDemo: '示范装配、测量和复核顺序',
    practiceAction: '按工艺要求完成装配练习并互查',
    reviewAction: '按工艺单核对尺寸、配合和完成质量',
    closingFocus: '把今天的工艺判断带回真实工位任务'
  },
  software: {
    label: '软件操作与数字技能',
    realTask: '真实软件操作任务',
    keyChain: '操作顺序、参数设置和输出结果',
    sceneObject: '界面结果',
    objectUnit: '界面、菜单和数据',
    processObject: '操作步骤',
    outputObject: '运行或输出结果',
    qualityFocus: '步骤、参数和结果正确性',
    actionDemo: '投屏演示操作路径、参数设置和结果检查',
    practiceAction: '按任务单完成软件操作并互查结果',
    reviewAction: '按任务单核对参数设置、输出结果和保存规范',
    closingFocus: '把今天的操作判断带回完整数字任务'
  },
  service: {
    label: '服务接待与流程演练',
    realTask: '真实服务情境任务',
    keyChain: '服务流程、话术表达和现场应对',
    sceneObject: '服务情境',
    objectUnit: '流程、岗位动作和话术',
    processObject: '接待和服务动作',
    outputObject: '服务表现',
    qualityFocus: '礼仪、流程和应对质量',
    actionDemo: '示范服务流程、关键话术和现场应对',
    practiceAction: '按情境完成服务演练并互评表现',
    reviewAction: '按服务标准核对流程、礼仪和应对结果',
    closingFocus: '把今天的服务判断带回真实岗位情境'
  },
  theory: {
    label: '理论认知与案例分析',
    realTask: '真实案例分析任务',
    keyChain: '概念理解、依据判断和迁移表达',
    sceneObject: '案例现象',
    objectUnit: '概念、材料和例题',
    processObject: '分析步骤',
    outputObject: '表达结果',
    qualityFocus: '概念、依据和论证逻辑',
    actionDemo: '用案例和板书梳理概念关系与判断依据',
    practiceAction: '按案例或题目完成分析并互查依据',
    reviewAction: '按评价标准核对概念理解、推理过程和表达结果',
    closingFocus: '把今天的判断方法带回新的案例情境'
  },
  generic: {
    label: '任务导向课堂',
    realTask: '真实课堂任务',
    keyChain: '判断依据、操作顺序和课堂结果',
    sceneObject: '任务现象',
    objectUnit: '关键对象和核心要点',
    processObject: '任务步骤',
    outputObject: '课堂结果',
    qualityFocus: '顺序、标准和结果质量',
    actionDemo: '示范关键步骤并说明判断依据',
    practiceAction: '按任务要求完成练习并互查结果',
    reviewAction: '按评价标准核对步骤、依据和结果',
    closingFocus: '把今天的判断方法带回更完整的课堂任务'
  }
};

function buildDetectionCorpus(courseName = '', modules = []) {
  return [cleanText(courseName), ...toList(modules).flatMap((module) => [
    cleanText(module?.name),
    cleanText(module?.description),
    ...toList(module?.knowledgePoints || module?.keyPoints).map((item) => cleanText(item))
  ])].join(' ');
}

function buildDetectionTokens(courseName = '', modules = []) {
  return [
    cleanText(courseName),
    ...toList(modules).flatMap((module) => [cleanText(module?.name)])
  ].filter(Boolean);
}

function detectMappedGztextileProfile(courseName = '', modules = []) {
  const tokens = buildDetectionTokens(courseName, modules);
  for (const token of tokens) {
    const normalized = normalizeCourseKey(token);
    if (normalized && GZTEXTILE_EXACT_LOOKUP.has(normalized)) {
      return GZTEXTILE_EXACT_LOOKUP.get(normalized);
    }
  }

  const corpus = buildDetectionCorpus(courseName, modules);
  const scored = GZTEXTILE_PROFILE_MATCHERS
    .map((item) => {
      let score = 0;
      item.courseNames.forEach((name) => {
        if (name && corpus.includes(name)) score += 6;
      });
      item.keywords.forEach((keyword) => {
        if (keyword && corpus.includes(keyword)) score += keyword.length >= 4 ? 3 : 2;
      });
      return { key: item.key, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.key || '';
}

function detectCourseProfile({ courseName = '', modules = [] } = {}) {
  const mappedProfile = detectMappedGztextileProfile(courseName, modules);
  if (mappedProfile) return mappedProfile;

  const corpus = buildDetectionCorpus(courseName, modules);
  const matched = PROFILE_MATCHERS.find((item) => item.pattern.test(corpus));
  return matched ? matched.key : 'generic';
}

function getCourseProfileLexicon(profile = 'generic') {
  return PROFILE_LEXICONS[profile] || PROFILE_LEXICONS.generic;
}

module.exports = {
  detectCourseProfile,
  getCourseProfileLexicon
};
