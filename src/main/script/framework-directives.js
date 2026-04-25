function toList(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const PROFILE_DOMAINS = {
  gztextile_merchandising: 'fashion',
  gztextile_fashion_communication: 'fashion',
  gztextile_styling: 'fashion',
  gztextile_design_project: 'fashion',
  gztextile_fashion_display: 'fashion',
  fashion_display: 'fashion',
  electronics: 'electronics',
  mechanical: 'mechanical',
  software: 'software',
  service: 'service',
  theory: 'theory',
  generic: 'generic'
};

const DOMAIN_KEYWORDS = {
  fashion: /服装|品牌|顾客|卖点|文案|海报|POP|构图|传播|新媒体|陈列|橱窗|搭配|造型|视觉/,
  electronics: /电路|LED|焊接|万用表|通电|电压|电流|元器件/,
  mechanical: /机械|装配|零件|加工|尺寸|刀具|机床/,
  software: /软件|代码|参数|界面|数据库|网页|Excel|函数/,
  service: /服务|礼仪|接待|客户|话术|流程/,
  theory: /概念|理论|案例分析|阅读|写作|论证/
};

function detectDirectiveDomains(text = '') {
  const normalized = cleanText(text);
  return Object.entries(DOMAIN_KEYWORDS)
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([domain]) => domain);
}

function classifyDirective(text = '') {
  const normalized = cleanText(text);
  if (!normalized) return 'other';
  if (/^课后作业|^作业|^提交物|作业[:：]/.test(normalized)) return 'homework';
  if (/课堂练习|课堂活动|测验|抢答|练习/.test(normalized)) return 'practice';
  if (/补充案例|案例|品牌案例|示例/.test(normalized)) return 'example';
  if (/评价标准|评分|打分|评价细则/.test(normalized)) return 'assessment';
  return 'other';
}

function inferTargetSection(text = '', modules = []) {
  const normalized = cleanText(text);
  if (/^课后作业|^作业|^提交物|课后/.test(normalized)) return 'closing';
  if (/课堂练习|课堂活动|测验|抢答|练习/.test(normalized)) return 'practice';
  if (/开场|导入/.test(normalized)) return 'opening';
  const matchedModule = toList(modules).find((module, index) => {
    const name = cleanText(module?.name);
    if (!name) return false;
    return normalized.includes(name) || normalized.includes(`模块${index + 1}`) || normalized.includes(`第${index + 1}模块`);
  });
  if (matchedModule) return `module-${Number(matchedModule.moduleNumber || 0) || (toList(modules).indexOf(matchedModule) + 1)}`;
  return 'general';
}

function evaluateAlignment(text = '', courseProfile = 'generic') {
  const domains = detectDirectiveDomains(text);
  if (!domains.length) return { status: 'aligned', reason: '' };
  const currentDomain = PROFILE_DOMAINS[courseProfile] || 'generic';
  if (domains.includes(currentDomain) || currentDomain === 'generic') {
    return { status: 'aligned', reason: '' };
  }
  if (domains.includes('fashion') && currentDomain === 'service') {
    return { status: 'adaptable', reason: '内容更偏品牌展示，可改写后落到服务情境表达。' };
  }
  return { status: 'conflict', reason: '该要求的专业内容与当前教学框架主线不一致。' };
}

function resolveFrameworkDirectives({ style = {}, modules = [], courseProfile = 'generic' } = {}) {
  const directives = toList(style?.contentDirectives)
    .map((item) => cleanText(item))
    .filter(Boolean)
    .map((text) => {
      const type = classifyDirective(text);
      const target = inferTargetSection(text, modules);
      const alignment = evaluateAlignment(text, courseProfile);
      return { text, type, target, ...alignment };
    });

  const applied = {
    opening: [],
    practice: [],
    closing: [],
    general: [],
    modules: {}
  };
  const blocked = [];

  directives.forEach((directive) => {
    if (directive.status === 'conflict') {
      blocked.push(directive);
      return;
    }
    if (directive.target === 'opening') applied.opening.push(directive);
    else if (directive.target === 'practice') applied.practice.push(directive);
    else if (directive.target === 'closing') applied.closing.push(directive);
    else if (/^module-\d+$/.test(directive.target)) {
      applied.modules[directive.target] = applied.modules[directive.target] || [];
      applied.modules[directive.target].push(directive);
    } else {
      applied.general.push(directive);
    }
  });

  return {
    directives,
    applied,
    blocked
  };
}

module.exports = {
  resolveFrameworkDirectives
};
