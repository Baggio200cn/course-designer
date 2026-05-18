export const JIMENG_URL = 'https://jimeng.jianying.com/ai-tool/generate';
export const PEXO_URL = 'https://pexo.ai/home';
export const PEXO_CODE = '2ANM9M';
export const PPT_FIXED_IMAGE_MODEL = 'seedream';

// ─────────────────────────────────────────────────────────────────────────────
// PPT_TEMPLATE_PRESETS — 所有模板均已升级为 guizang 三层排版体系（Phase A）
// ─────────────────────────────────────────────────────────────────────────────
export const PPT_TEMPLATE_PRESETS = {
  fashion_magazine: {
    name: '时尚杂志风',
    variant: 'guizang',
    aesthetic: '高对比度摄影质感，戏剧性光影，强调视觉冲击力，适合展示设计、空间设计、服装陈列等视觉类课程。',
    background:      '#FAFAF8',
    heroBackground:  '#0D0D0D',
    paperPanel:      '#FAFAF8',
    ruleColor:       '#E91E8C',
    textColor:       '#1A1A1A',
    accentColor:     '#E91E8C',
    titleFont: '"SimSun","FangSong","STSong","Songti SC",serif',
    bodyFont:  '"PingFang SC","Microsoft YaHei",sans-serif',
    metaFont:  '"Consolas","Courier New","IBM Plex Mono",monospace',
    imageStyle: '高对比度商业摄影质感，精致专业工作台与材料局部细节，冷峻洁白或极浅灰背景，' +
      '以物品/空间/陈列环境为画面主体，视觉重心偏向右侧，干净利落的构图，无任何装饰文字，无人物正面头像特写',
    visual: '适合全版照片+衬线大标题叠加、不对称排版、品红强调色块。'
  },

  display_window: {
    name: '橱窗展示风',
    variant: 'guizang',
    aesthetic: '深色背景+金色点缀，奢华质感，强调精致陈列美学，适合高端设计类课程。',
    background:      '#1C1C2E',
    heroBackground:  '#0A0A1A',
    paperPanel:      '#161625',
    ruleColor:       '#D4AF37',
    textColor:       '#F5F5F0',
    accentColor:     '#D4AF37',
    titleFont: '"SimSun","FangSong","STSong","Songti SC",serif',
    bodyFont:  '"Alibaba PuHuiTi 2.0","Microsoft YaHei",sans-serif',
    metaFont:  '"Consolas","Courier New","IBM Plex Mono",monospace',
    imageStyle: '深夜蓝黑背景，金色或暖白聚光灯打亮陈列物品或场景主体，精致奢华光影层次，' +
      '静物摄影级别的精细质感，视觉主体偏向画面右侧，以展示物品或环境空间为主体，无人物正面头像',
    visual: '适合暗色背景+金色 Kicker 横线、衬线大标题、剧场感左文右图布局。'
  },

  pastel_energy: {
    name: '粉彩活力风',
    variant: 'guizang',
    aesthetic: '马卡龙粉彩配色，Y2K 活力美学，亲和可爱，强调互动感和年轻化表达。',
    background:      '#FEF0F7',
    heroBackground:  '#2D1B4E',
    paperPanel:      '#FEF0F7',
    ruleColor:       '#FF85A2',
    textColor:       '#2D1B4E',
    accentColor:     '#FF85A2',
    titleFont: '"SimSun","FangSong","STSong","Songti SC",serif',
    bodyFont:  '"OPPOSans","PingFang SC","Microsoft YaHei",sans-serif',
    metaFont:  '"Consolas","Courier New","IBM Plex Mono",monospace',
    imageStyle: '粉彩扁平矢量插图风格，Y2K 美学，马卡龙配色方案，活泼饱和度高，' +
      '圆润柔和的几何场景构图，视觉主体偏向画面右侧，无文字标注，人物如出现须为卡通化小比例远景配角',
    visual: '适合深紫 Hero 封面+衬线大标题、粉白内容页左文右图、圆角 Chip 要点。'
  },

  guochao_modern: {
    name: '国潮现代风',
    variant: 'guizang',
    aesthetic: '传统中式纹样现代简化，红色强调+米白底，书法留白美学，兼顾课堂可读性与国风文化感。',
    background:      '#FFFCF7',
    heroBackground:  '#1A0A00',
    paperPanel:      '#FFFCF7',
    ruleColor:       '#C8102E',
    textColor:       '#1A0A00',
    accentColor:     '#C8102E',
    titleFont: '"SimSun","FangSong","STSong","Songti SC",serif',
    bodyFont:  '"Alibaba PuHuiTi 2.0","Microsoft YaHei",sans-serif',
    metaFont:  '"Consolas","Courier New","IBM Plex Mono",monospace',
    imageStyle: '东方极简美学，大面积留白构图，传统纹样几何化简化，中国红与金色点缀，' +
      '整洁温润的米白色调，视觉主体偏向画面右侧，以抽象纹样或环境场景为主体，无任何文字、书法或人物正面头像',
    visual: '适合深墨 Hero 封面+衬线大标题、米白内容页左文右图、红色 Kicker 横线。'
  },

  pro_minimalist: {
    name: '通用简约型',
    variant: 'guizang',
    aesthetic: '深海藏青蓝 × 冷瓷白，Indigo Porcelain 配色，三层字体层级，适合所有学科通用教学。',
    background:      '#F1F3F5',
    heroBackground:  '#0A1F3D',
    paperPanel:      '#F1F3F5',
    ruleColor:       '#F0A500',
    textColor:       '#0A1F3D',
    accentColor:     '#2E86DE',
    secondaryAccent: '#F0A500',
    titleFont: '"SimSun","FangSong","STSong","Songti SC",serif',
    bodyFont:  '"Microsoft YaHei","PingFang SC",sans-serif',
    metaFont:  '"Consolas","Courier New","IBM Plex Mono",monospace',
    imageStyle: '极简克制的专业场景摄影风格，深蓝白冷灰低饱和配色，干净几何构图，' +
      '视觉主体偏向画面右侧三分之二（左侧留白供文字面板覆盖），商务教育氛围，无多余装饰，无文字标注，无人物正面头像',
    visual: '适合深海蓝 Hero 封面+衬线大标题、冷瓷白内容页左文右图、金色 Kicker 横线。'
  }
};

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shorten(value, max = 72) {
  const text = cleanText(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function uniqueTexts(items, max = 4) {
  const seen = new Set();
  const result = [];
  toList(items).forEach((item) => {
    const text = cleanText(item);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result.slice(0, max);
}

function splitLectureSections(lectureScript) {
  const sections = [];
  const lines = String(lectureScript || '').split(/\r?\n/);
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const bodyLines = current.lines.map((line) => String(line || '')).filter((line) => line.trim().length > 0);
    const body = bodyLines.join('\n').trim();
    if (!current.title && !body) return;
    sections.push({
      title: cleanText(current.title),
      lines: bodyLines.map((line) => cleanText(line)),
      body
    });
  };

  lines.forEach((line) => {
    const trimmed = cleanText(line);
    if (!trimmed) {
      if (current) current.lines.push('');
      return;
    }
    const matched = trimmed.match(/^#{1,6}\s*(.+)$/) || trimmed.match(/^【(.+)】$/);
    if (matched) {
      pushCurrent();
      current = { title: matched[1], lines: [] };
      return;
    }
    if (!current) current = { title: '', lines: [] };
    current.lines.push(trimmed);
  });
  pushCurrent();
  return sections;
}

function isIgnorableLectureSection(section) {
  const title = stripTimeLabel(section?.title || '');
  return /正式讲稿$/.test(title);
}

function extractTimeLabel(title = '') {
  const matched = String(title || '').match(/(\d+\s*-\s*\d+\s*分钟)/);
  return matched ? matched[1].replace(/\s+/g, '') : '';
}

function stripTimeLabel(title = '') {
  return cleanText(String(title || '').replace(/\d+\s*-\s*\d+\s*分钟/g, '').replace(/[()（）]/g, ''));
}

function sectionKeyFromTitle(title = '', index = 0) {
  const base = stripTimeLabel(title).toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || `lecture-section-${index + 1}`;
}

function getLabeledBullets(section, label) {
  const lines = toList(section?.lines);
  const result = [];
  let active = false;
  lines.forEach((line) => {
    if (line === `${label}：` || line === `${label}:`) {
      active = true;
      return;
    }
    if (/^[^\s-]+[:：]$/.test(line) && line !== `${label}：` && line !== `${label}:`) {
      active = false;
      return;
    }
    if (active && /^-\s+/.test(line)) {
      result.push(cleanText(line.replace(/^-\s+/, '')));
    }
  });
  return uniqueTexts(result, 6);
}

// 模板句/引导语过滤模式（这些不是讲稿核心内容，是系统生成的引导语）
const GENERIC_PATTERNS = [
  /^这一段要把/, /^教师还要明确/, /^这一部分围绕/,
  /^重点要把/, /^学完这一段/, /^这里有一个常见误区/,
  /^在正式进入/, /^开场先把/, /^为什么要学/,
  /^这一段先不急/, /^用一个贴近/, /^你们先看现象/,
  /^这一节课不是/, /^现在咱们/, /^好了.*开始/,
  /^这一部分要把/, /^先不急着把名词/,
  /^练习阶段最关键/, /^总结时要把/,
  /围绕本页/, /核心提炼/, /真正串起来/,
  // 新增：buildSectionExpansion 的 fallback 句式
  /^我再问一个问题：如果/, /^关于.*最容易出错/,
  /^来，我们看一个和/, /^好，通过这个案例/,
  /^今天这节课结束以后/, /^评价你们学得好不好/,
  /^互查时不是随便看/, /^练习结束前留两分钟/,
  /^最后问大家一个问题/, /^下一节课开场我会随机/,
  /^如果.*理解错了.*操作会受/
];

function getSectionSummary(section) {
  // 优先从教师讲述段落中提取最有价值的摘要句
  const lines = toList(section?.lines);
  let inSpoken = false;
  const candidates = [];
  for (const line of lines) {
    if (/^教师讲述[:：]/.test(line)) { inSpoken = true; continue; }
    if (/^课堂动作/.test(line)) break;
    if (inSpoken && line.trim().length >= 10) {
      const text = line.replace(/^[-*•]\s*/, '').trim();
      const sentences = text.split(/[。！？]/).filter(s => s.trim().length >= 8);
      for (const s of sentences) {
        const t = s.trim();
        if (!GENERIC_PATTERNS.some(p => p.test(t))) {
          candidates.push(t);
        }
      }
    }
  }
  if (candidates.length) return shorten(candidates[0], 88);

  // fallback: bullet 格式的教师讲述
  const teacherBullets = getLabeledBullets(section, '教师讲述');
  if (teacherBullets.length) return shorten(teacherBullets[0], 88);
  const genericBullet = lines.find((line) => /^-\s+/.test(line));
  if (genericBullet) return shorten(genericBullet.replace(/^-\s+/, ''), 88);
  return shorten(section?.body || '', 88);
}

function getSectionKeyContent(section) {
  // 优先从教师讲述段落中提取核心知识句（不限 bullet 格式）
  const lines = toList(section?.lines);
  let inSpoken = false;
  const spokenSentences = [];
  lines.forEach((line) => {
    if (/^教师讲述[:：]/.test(line)) { inSpoken = true; return; }
    if (/^课堂动作/.test(line)) { inSpoken = false; return; }
    if (inSpoken && line.trim()) {
      const text = line.replace(/^[-*•]\s*/, '').trim();
      const sentences = text.split(/[。！？]/).filter(s => {
        const t = s.trim();
        return t.length >= 8 && t.length <= 60;
      });
      sentences.forEach(s => spokenSentences.push(s.trim()));
    }
  });

  // 过滤模板句，保留有具体知识内容的句子
  const meaningful = spokenSentences.filter(s =>
    !GENERIC_PATTERNS.some(p => p.test(s)) && s.length >= 10
  );

  if (meaningful.length >= 1) {
    return uniqueTexts(meaningful.slice(0, 6), 4);
  }

  // fallback: bullet 格式的教师讲述
  const teacherBullets = getLabeledBullets(section, '教师讲述');
  if (teacherBullets.length) return uniqueTexts(teacherBullets, 4);

  // 再 fallback: 所有 spoken 句子
  if (spokenSentences.length) return uniqueTexts(spokenSentences.slice(0, 6), 4);

  // 最后才用课堂动作
  const actionBullets = getLabeledBullets(section, '课堂动作');
  return uniqueTexts(actionBullets, 4);
}

function classifySection(section) {
  const title = stripTimeLabel(section?.title || '');
  if (/封面/.test(title)) return '封面';
  if (/开场|导入|课程定位/.test(title)) return '课程导入';
  if (/路线|路标|目录|阶段总览/.test(title)) return '路线图';
  if (/模块.*导入|引入|情境/.test(title)) return '模块导入';
  if (/原理|概念|知识|理论|认知/.test(title)) return '原理讲解';
  if (/操作|步骤|实操|流程|组装|制作/.test(title)) return '操作步骤';
  if (/验收|检查|调试|测试|考核/.test(title)) return '验收检查';
  if (/练习|任务|演练/.test(title)) return '课堂练习';
  if (/总结|收束|作业|结尾/.test(title)) return '总结收束';
  if (/模块/.test(title)) return '模块页';
  return '内容页';
}

function normalizeLectureModules(modules, frameworkModules) {
  const source = Array.isArray(modules) && modules.length ? modules : frameworkModules || [];
  return source.map((item, index) => ({
    id: item.id || '',
    moduleNumber: Number(item.moduleNumber || item.number) || index + 1,
    name: String(item.name || `模块${index + 1}`),
    hours: Number(item.hours) || 0,
    description: String(item.description || ''),
    knowledgePoints: Array.isArray(item.knowledgePoints || item.keyPoints) ? (item.knowledgePoints || item.keyPoints) : []
  }));
}

function findLinkedModule(section, modules = []) {
  const title = stripTimeLabel(section?.title || '');
  const numberMatch = title.match(/模块\s*(\d+)/);
  if (numberMatch) {
    const byNumber = toList(modules).find((item, index) => (
      Number(item.moduleNumber || item.number) === Number(numberMatch[1]) || index + 1 === Number(numberMatch[1])
    ));
    if (byNumber) return byNumber;
  }
  return toList(modules).find((item) => title.includes(String(item.name || '').trim())) || null;
}

function stripTimingFromText(text) {
  return String(text || '').replace(/\d+-\d+\s*分钟/g, '').replace(/[（()）]/g, '').trim();
}

function colorCodeToNatural(hex) {
  const map = {
    // 旧模板色码（向后兼容）
    '#F8FAFC': '极浅灰白色', '#F5F1E8': '暖米色', '#FFFDF7': '奶白色', '#F8F7F5': '浅暖灰色',
    '#2563EB': '明亮蓝色', '#B91C1C': '中国红', '#F97316': '活力橙色', '#007AFF': '科技蓝色',
    '#1F2937': '深灰黑色', '#2C1F1A': '深棕色', '#1E293B': '深蓝灰色', '#2F3542': '深石墨色',
    // 新五套模板色码
    '#FAFAF8': '近白暖白色', '#1C1C2E': '深夜蓝色', '#FEF0F7': '浅粉白色',
    '#FFFCF7': '温润米白色', '#EAF4FB': '浅天蓝色',
    '#E91E8C': '时尚玫红色', '#D4AF37': '典雅金色', '#FF85A2': '柔粉色',
    '#C8102E': '国潮红色', '#2E86DE': '天蓝色',
    '#1A1A1A': '近黑深色', '#F5F5F0': '暖白色', '#2D1B4E': '深紫色',
    '#1A0A00': '墨棕色', '#1B3A6B': '深海蓝色'
  };
  const key = String(hex || '').toUpperCase();
  return map[key] || map[String(hex || '')] || '中性色调';
}

// Hero 页类型集合（与 shared 文件保持一致）
// Phase-9 修正（2026-05-10）：
//   旧定义把 '模块页' 和 '课程导入' 也归为 Hero 分支 → 这两类页面占 PPT 的 60%+
//   全部 return 一份"极黑磨砂纹理"的统一 prompt → 22 页千篇一律的暗黑背景图。
//   修法：Hero 分支只保留真正适合"纯纹理过渡感"的「封面 + 路线图」2 类
//   其他类型（含模块页、课程导入、各种内容页）走差异化的 pageConceptHints 路径
const GUIZANG_HERO_TYPES = new Set(['封面', '路线图']);

const GUIZANG_HERO_TEXTURE_MAP = {
  '#0D0D0D': '极黑磨砂材质纹理，细腻炭灰质感，接近全黑，仅有极微弱的漫反射光影层次，适合时尚杂志风夜间感',
  '#0A0A1A': '深宇宙蓝黑纹理，微弱的蓝色星云光晕散射，极低饱和度，深邃无垠，适合橱窗展示风奢华感',
  '#2D1B4E': '深紫暮色渐变纹理，极低亮度，微弱的电子光效散射，接近全黑的紫色调，Y2K 静谧夜晚感',
  '#1A0A00': '深墨棕色宣纸微纹，接近全黑的暖棕色调，极低亮度，沉稳内敛，中式书房昏暗质感',
  '#0A1F3D': '深海藏青蓝渐变纹理，极低饱和度，接近全黑的冷蓝色调，微弱极光冷光层次，冷峻深邃'
};

export function buildPptPageImagePrompt({
  pageType,
  template,
  aspect,
  quality,
  courseSubject,        // 课程主题（视觉元素引导，不是写文字）
  pageTitleSemantic,    // Phase-9：页面标题作为视觉概念（不渲染为文字字符）
  pageSummarySemantic,  // Phase-9：页面摘要作为视觉概念
  pageKeyContent        // Phase-9：页面关键要点作为视觉提示
}) {
  // ⚠️ 重要：本函数故意不接受 pageTitle / pageSubtitle / contentPreview 等文字参数。
  // 将中文标题/内容送入图像 prompt 会导致 AI 把这些文字"烧"进背景图。
  // 文字内容（标题、要点）由 Canvas 合成层 100% 负责，图片只负责纯视觉氛围。
  // C8-2：courseSubject 不会被烧进图——它只是提示 AI 选择对应行业的视觉元素
  //        （如"服装设计课程"→选服装/面料；"3D建模"→选软件界面/几何体）

  const safeTemplate = template || {};

  // ── 2026-05-16 v4.1.4 Q1：guizang Hero 改造 —— 按主题出图 + 深色质感后处理 ──
  //   旧版让封面/路线图全部走"纯纹理几乎全黑"→ 老师反馈"所有封面看起来一个样"
  //   新版：让封面也按本课程主题出真实视觉主体，仅保留"深色调 + 戏剧光影"的统一气质
  if (safeTemplate.variant === 'guizang' && GUIZANG_HERO_TYPES.has(pageType)) {
    const titleHint = String(pageTitleSemantic || '').trim().slice(0, 30);
    const summaryHint = String(pageSummarySemantic || '').trim().slice(0, 100);
    const subjectTag = courseSubject ? `「${String(courseSubject).slice(0, 50)}」` : '本课';

    if (pageType === '封面') {
      // 封面：主题对应的高端摄影主视觉 + 深色质感
      return [
        `${subjectTag}课程封面主视觉，对应专业的高端摄影质感画面：`,
        titleHint ? `本节核心概念为「${titleHint}」` : '',
        summaryHint ? `主题进一步说明：${summaryHint}` : '',
        '',
        `画面以与课程主题契合的工具 / 材料 / 设备 / 空间为视觉主体，构图大气专业，戏剧性光影`,
        `【色调氛围】深色背景为主（如深海军蓝 / 深炭灰 / 深棕等暗色系），保留课程主体细节，整体克制有质感`,
        `【构图】视觉主体偏画面右侧 2/3，左侧适度留白供后续 Canvas 叠加标题文字`,
        `【风格】商业摄影级精致质感，专业教育氛围，可有戏剧性聚光灯效果`,
        `横版全幅（${aspect || '16:9'}）`,
        '',
        `【人物规则】以环境/物品/空间为主体，禁止人物正面头像特写`,
        `【零文字铁律】画面内禁止任何文字、汉字、字母、数字、LOGO、水印，零文字痕迹`,
        `【风格禁区】禁止水墨画/水彩/油画/铅笔素描/拼贴风/UI 截图`,
      ].filter(Boolean).join('\n');
    }

    if (pageType === '路线图') {
      // 路线图：抽象路径可视化，深色调
      return [
        `${subjectTag}课程的抽象学习路径可视化：`,
        titleHint ? `主题概念「${titleHint}」` : '',
        '',
        `画面表现：几何节点 / 圆环 / 流线串联，呈现"流动的阶段感 + 方向感"`,
        `【色调氛围】深色背景（深海军蓝 / 深炭灰），节点用主色调突出，整体克制专业`,
        `【构图】横向路径或环形闭环，留出叠加标题的空白区`,
        `横版全幅（${aspect || '16:9'}）`,
        '',
        `【零文字铁律】纯几何抽象，画面内禁止任何文字、汉字、字母、数字、LOGO`,
        `【风格禁区】禁止水墨画/UI 截图/线框图/拓扑图`,
      ].filter(Boolean).join('\n');
    }
  }

  // ── 普通内容页场景描述（Phase-7.7 F3：主题驱动改造）─────────────────────
  // 之前 sceneMap 是"通用职教模板"（如"工具与材料 / 手部操作"），doubao 看到这种描述
  // + 笔记本所在专业（如"服装相关"）→ 自动联想到服装手工/缝纫，跟课程主题脱节
  // F3 修法：每个 sceneMap 模板嵌入 ${courseSubject} 占位，让 AI 知道"工具/材料/操作"
  //         应该是"该课程对应的"工具/材料/操作，不是泛泛的工具
  const subjectTag = courseSubject ? `「${String(courseSubject).slice(0, 50)}」` : '本课';
  const sceneMap = {
    '封面':    `课程封面主视觉：${subjectTag}对应的专业工作环境精美俯拍，与课程主题直接相关的工具/界面/材料的精致陈列特写，构图大气，光影层次丰富，以与主题契合的物品和环境为主体`,
    '课程导入': `课堂开场氛围：宽敞明亮的实训空间全景，与${subjectTag}主题相关的学习设备整齐排列，探索感与好奇心，暖光，人物如出现须为远景小比例配角`,
    '路线图':  '抽象路径进程可视化：几何节点依次串联，流动的阶段感，简洁的方向感构图，无任何文字标注，纯抽象图形',
    '模块页':  `章节开幕主视觉：与${subjectTag}主题相关的单一主体强构图，视觉张力十足，画面上下留白充足，色彩饱满，以契合主题的物品或抽象图形为主体`,
    '模块导入': `真实职业现场环境全景：${subjectTag}对应的真实行业工作台与专业器材，自然光线，代入感强，无人物正面特写`,
    '原理讲解': `${subjectTag}相关的抽象概念知识图解：与主题概念相关的几何体结构与空间关系，对称或放射构图，纯视觉场景，无任何文字标签，无人物`,
    '操作步骤': `${subjectTag}的实操工艺俯拍特写：与课程主题对应的专业工具与材料在操作台面上的精确摆放，仅展示手部操作细节（手腕以下），材料纹理细节，禁止出现人物面部`,
    '验收检查': `${subjectTag}的精致成品陈列特写：光线打亮成品细节，干净的展示台背景，以与主题对应的成品为绝对视觉主体，无人物面部`,
    '课堂练习': `${subjectTag}的协作实训工作坊全景：多人远景活动场景，与主题相关的工具材料散落有序，活跃课堂气氛，人物为远景背景配角，禁止正面人物头像`,
    '总结收束': `${subjectTag}的完成收束画面：整洁陈列的与主题对应的成品序列，成就感与收获感，柔和结束氛围，以成品为主体`
  };

  // 2026-05-16 v4.1.4 Q2-③：sceneMap 多样化 —— 按 title 关键词进一步分支
  //   旧版只有 pageType 维度，同 pageType 多页全用同一段描述 → AI 出图同质化
  //   新版：在 pageType 基础上，按 title 关键词追加"语义差异化提示"
  const titleSemantic = String(pageTitleSemantic || '').trim();
  let titleDifferentiator = '';
  if (titleSemantic) {
    // 按 title 关键词推断画面差异
    if (/概念|定义|认识|理论|原理/.test(titleSemantic)) {
      titleDifferentiator = `画面侧重"抽象概念可视化"——用几何造型、放射结构或图层叠加表现概念`;
    } else if (/对比|比较|差异|优劣|VS/.test(titleSemantic)) {
      titleDifferentiator = `画面侧重"对比并列"——左右双主体构图，材质/形态/亮度对照`;
    } else if (/步骤|流程|顺序|阶段|路径/.test(titleSemantic)) {
      titleDifferentiator = `画面侧重"流程串联"——多个节点 / 工具按顺序排列，箭头或光带连接`;
    } else if (/案例|实例|品牌|项目|实战/.test(titleSemantic)) {
      titleDifferentiator = `画面侧重"实际案例 / 成品陈列"——具体产品 / 现场实物特写`;
    } else if (/数据|分析|趋势|结构|占比|薪资|需求/.test(titleSemantic)) {
      titleDifferentiator = `画面侧重"数据可视化"——抽象柱状 / 饼状 / 层级结构图形`;
    } else if (/工具|设备|材料|器材/.test(titleSemantic)) {
      titleDifferentiator = `画面侧重"工具器材陈列"——专业工具材料的精致俯拍`;
    } else if (/讨论|互查|协作|小组|分享/.test(titleSemantic)) {
      titleDifferentiator = `画面侧重"协作场景"——远景多人协作工作坊，桌面工具散落有序`;
    } else if (/检查|验收|评分|标准|规则/.test(titleSemantic)) {
      titleDifferentiator = `画面侧重"检验 / 评估"——成品验收台 + 检测器具 + 评分维度抽象图形`;
    } else if (/总结|收束|回顾|复盘/.test(titleSemantic)) {
      titleDifferentiator = `画面侧重"成果收束"——成品整齐陈列序列，收获与归档感`;
    } else if (/导入|引入|开篇|启动/.test(titleSemantic)) {
      titleDifferentiator = `画面侧重"开场氛围"——明亮宽敞空间 + 暖光 + 学习设备整齐就绪`;
    } else {
      // 没匹配到关键词时，强制要求 AI 用 title 字面意思推断视觉
      titleDifferentiator = `画面侧重"${titleSemantic}"字面对应的真实视觉元素，与其他页有可辨识的视觉差异`;
    }
  }

  const baseScene = sceneMap[pageType] || `${subjectTag}相关的现代化职业实训工作空间：与课程主题对应的专业工具与材料精致陈列，干净整洁的构图，以环境与器材为主体，无人物正面头像`;
  const scene = titleDifferentiator
    ? `${baseScene}\n【本页视觉差异化】${titleDifferentiator}`
    : baseScene;
  const styleDesc = safeTemplate.imageStyle || '现代扁平化插图风格，色块分明，线条清晰，专业教育氛围';
  const accent = colorCodeToNatural(safeTemplate.accentColor || '#2E86DE');
  const bg = colorCodeToNatural(safeTemplate.background || '#F1F3F5');

  // Phase-7.7 F1+F2（2026-04-30）：修复"配图不搭主题"——
  // 之前的 example "如服装专业→面料/缝纫机" 让 doubao Seedream 直接照抄 example，
  // 把"图文排版"课画成了"服装手工/缝纫"场景。
  // 修法：① 移除具体行业 example（避免 AI 模仿 example）
  //       ② 强约束"主题第一，专业第二"——课程名是唯一视觉主体来源
  //       ③ 列出"误用情境"反例，明确告知什么禁止
  const subjectGuide = courseSubject
    ? [
        `【课程主题视觉引导（关键约束，绝对不可在画面写出任何文字）】`,
        `本图为「${String(courseSubject).slice(0, 80)}」课程的配图。`,
        ``,
        `⚠️ 主题第一，专业第二：以课程名称「${String(courseSubject).slice(0, 80)}」为视觉主体的唯一参考`,
        `⚠️ 禁止误用：即使本课程属于某个大专业（如"服装相关"或"机械相关"），也不得因此让画面跑偏`,
        `   错误示例：课程名是"图文排版"但画了服装制作/缝纫场景 → 错误`,
        `   错误示例：课程名是"3D 建模"但画了机械加工车床 → 错误`,
        `   正确做法：精确解读课程名的字面含义，选择最契合的视觉主体`,
        `   - "图文排版/平面设计/版式" → 显示器+键盘+设计稿+排版软件界面`,
        `   - "服装陈列/橱窗设计" → 陈列架+模特+橱窗布景`,
        `   - "3D 建模/三维设计" → 软件操作界面+几何体+模型展示`,
        `   - "数据分析/统计" → 数据可视化图表+表格+计算机屏幕`,
        `   - 其他课程 → 自行精准判断对应的真实视觉元素`,
        `⚠️ 严禁把课程名/标题/任何文字"烧"到图里——文字由 Canvas 程序化叠加层负责`
      ].join('\n')
    : '';

  // Phase-9 关键修复（2026-05-10）：
  //   把页面主题作为「视觉概念语义」注入，让每页 AI 拿到独特视觉提示。
  //   严格区分两件事：
  //     ① 主题作为画面概念（要 AI 理解 + 用对应视觉元素表达） ✅
  //     ② 主题作为字符渲染到图里（绝对禁止） ❌
  //   两者用大量"零文字铁律"约束分隔，AI 能稳定区分。
  const pageConceptHints = [];
  const titleClean = String(pageTitleSemantic || '').trim().slice(0, 40);
  const summaryClean = String(pageSummarySemantic || '').trim().slice(0, 120);
  const keyContentClean = String(pageKeyContent || '').trim().slice(0, 200);
  if (titleClean || summaryClean || keyContentClean) {
    pageConceptHints.push('');
    pageConceptHints.push('【本页视觉概念引导（关键，决定本页与其他页的差异）】');
    pageConceptHints.push('⚠ 以下文字仅作为"画面应该体现什么概念"的语义提示，绝对不要把这些文字字符渲染到图里：');
    if (titleClean)      pageConceptHints.push(`  · 概念主题：${titleClean}`);
    if (summaryClean)    pageConceptHints.push(`  · 主题展开：${summaryClean}`);
    if (keyContentClean) pageConceptHints.push(`  · 视觉提示：${keyContentClean}`);
    pageConceptHints.push('');
    pageConceptHints.push('视觉转译规则（举例帮助 AI 理解，按本页概念灵活套用）：');
    pageConceptHints.push('  - 抽象模型/原理（如"5W 模型""传播过程"）→ 用 5 个并列几何元素的概念图、连接线、放射结构');
    pageConceptHints.push('  - 评价/标准（如"评分标准""检查清单"）→ 用打勾框、刻度尺、维度对比等抽象图形');
    pageConceptHints.push('  - 操作/流程（如"工具演示""实操练习"）→ 用工具特写、操作台、过程序列感');
    pageConceptHints.push('  - 案例/实例（如"参考案例""品牌分析"）→ 用展示陈列、样品对比、聚光灯特写');
    pageConceptHints.push('  - 互动/反馈（如"互查反馈""课间过渡""场景提问"）→ 用对话气泡形抽象图、双向箭头、过渡光晕');
    pageConceptHints.push('  - 总结/导出（如"作品提交""课后任务"）→ 用归档、整齐陈列、收束感构图');
    pageConceptHints.push('  ⚠ 同一 pageType 但 title 不同的页面，必须给出明显不同的视觉构图，不能千篇一律');
  }

  return [
    `${scene}。`,
    subjectGuide,
    pageConceptHints.join('\n'),
    `横版全幅构图（${aspect || '16:9'}），视觉主体集中于画面中央主要区域，四周边缘保持简洁通透。`,
    `视觉风格：${styleDesc}。`,
    `色彩方向：主色调以${accent}为强调色，整体色调与${bg}色调协调统一。`,
    `【人物构图规则】①画面以环境/物品/场景为主体，人物面积不超过画面总面积的20%；②人物如出现，必须是东亚面孔（中国学生/教师/职业人员），严禁欧美白人；③严禁正面人物头像特写、半身证件照式构图；④人物须以远景或侧身背景配角形式出现。`,
    `【零文字铁律——绝对执行】画面内禁止出现任何形式的文字符号：禁止中文汉字、禁止拼音字母、禁止英文字母、禁止阿拉伯数字、禁止任何标签标注、禁止品牌LOGO、禁止水印、禁止技术参数标注。任何文字痕迹均不可接受。上方"视觉概念引导"中的文字仅供 AI 理解概念，画面里不能出现这些字。`,
    `【风格禁区】禁止水墨画、水彩画、油画、铅笔素描、拼贴风；禁止UI界面截图、拓扑图、流程图线框；禁止模仿杂志封面版式。`
  ].filter(Boolean).join('\n');
}

/**
 * 从讲稿章节提取演讲者备注（150-200字口播风格）
 * 优先使用"教师讲述："段落的原始文本，保留口播语气
 *
 * @param {Object} section - splitLectureSections 返回的单个 section 对象
 * @returns {string} 演讲者备注文本
 */
export function buildSpeakerNotesFromSection(section) {
  if (!section) return '';
  const lines = toList(section.lines);
  let inSpoken = false;
  const narrationParts = [];

  for (const line of lines) {
    if (/^教师讲述[:：]/.test(line)) { inSpoken = true; continue; }
    if (/^课堂动作/.test(line)) break;
    if (inSpoken && line.trim().length >= 5) {
      narrationParts.push(line.replace(/^[-*•]\s*/, '').trim());
    }
  }

  if (!narrationParts.length) {
    return shorten(section.body || '', 180);
  }

  const full = narrationParts.join('');
  if (full.length <= 220) return full;

  let cutAt = full.lastIndexOf('。', 200);
  if (cutAt < 80) cutAt = full.lastIndexOf('，', 200);
  if (cutAt < 80) cutAt = 180;
  return full.slice(0, cutAt + 1);
}

export function buildPptTextFramework({ courseName, template, pages }) {
  return [
    `# ${courseName} PPT 文本框架`,
    '',
    '## 风格设定',
    `- 模板：${template.name}`,
    `- 设计气质：${template.aesthetic}`,
    `- 背景色：${template.background}`,
    `- 标题字体：${template.titleFont}`,
    `- 正文字体：${template.bodyFont}`,
    `- 强调色：${template.accentColor}`,
    '',
    '## 页面结构',
    ...pages.map((page) => [
      `### 第 ${page.pageNumber} 页 · ${page.pageType}`,
      `- 标题：${page.title}`,
      `- 副标题：${page.subtitle || '无'}`,
      `- 摘要：${page.summary || '无'}`,
      `- 是否配图：${page.needImage ? '是' : '否'}`
    ].join('\n'))
  ].join('\n');
}

/**
 * 2026-05-16 v4.1.4：把 AI stage 2 输出的 imagePrompt 叠加"安全 + 风格 + 零文字"约束
 *   场景：V2 pipeline 已让 AI 写了与本页讲稿章节对应的 imagePrompt（如"光电产业人才需求层级俯拍"），
 *   但前端原 ensurePptImagePromptForPage 用 early-return 跳过空 prompt 才生成 → AI prompt 拿不到约束。
 *   这里：当 AI prompt 已存在时，保留 AI 的"主体场景描述"，叠加固定的安全约束。
 */
// v4.3.0 D2（2026-05-18）：5 种配图风格 preset 对应的 styleDesc
const IMAGE_STYLE_DESC = {
  flat:         '现代扁平化插图风格，色块分明，线条清晰，专业教育氛围',
  illustration: '柔和插画风格，手绘质感，亲和力强，温暖明亮色调',
  realistic:    '写实摄影质感，真实场景，自然光影，细节丰富的实物特写',
  guochao:      '国潮中式风格，传统纹样配现代色彩，留白克制，文化韵味',
  minimal:      '极简留白风格，大面积空白，单色或两色搭配，几何构图',
};

export function enhanceAiImagePromptWithSafety(aiPrompt, { courseSubject, aspect = '16:9', template = {}, imageStylePreset } = {}) {
  let cleanedAi = String(aiPrompt || '').trim();
  if (!cleanedAi) return '';
  // C3 修复（2026-05-17）：检测并剥离已有的"【本页主体场景】..."以及后续约束段，避免重复包装
  if (cleanedAi.includes('【本页主体场景】')) {
    const m = cleanedAi.match(/【本页主体场景】([\s\S]*?)(?:\n\s*\n|\n【|$)/);
    if (m && m[1]) {
      cleanedAi = m[1].trim();
    }
  }
  if (!cleanedAi) return '';
  const safeTemplate = template || {};
  // v4.3.0 D2 优先级：imageStylePreset > template.imageStyle > 默认 flat
  const presetDesc = imageStylePreset && IMAGE_STYLE_DESC[imageStylePreset];
  const styleDesc = presetDesc || safeTemplate.imageStyle || IMAGE_STYLE_DESC.flat;
  const accent = colorCodeToNatural(safeTemplate.accentColor || '#2E86DE');
  const bg = colorCodeToNatural(safeTemplate.background || '#F1F3F5');
  const subjectTag = courseSubject ? `「${String(courseSubject).slice(0, 50)}」` : '本课';

  return [
    // ── ① 主体：AI 写的页面具体场景描述（这是 V2 pipeline 的核心价值） ──
    `【本页主体场景】${cleanedAi}`,
    '',
    // ② 课程主题统一约束
    `【课程主题】图属于${subjectTag}课程的配图，画面元素必须服务于此主题`,
    '',
    // ③ 构图 / 视觉风格 / 色彩
    `【构图】横版全幅（${aspect}），视觉主体集中于画面中央主要区域，四周边缘保持简洁通透`,
    `【视觉风格】${styleDesc}`,
    `【色彩方向】主色调以${accent}为强调色，整体与${bg}色调协调统一`,
    '',
    // ④ 人物 / 文字 / 风格禁区 三条铁律
    `【人物构图规则】①画面以环境/物品/场景为主体，人物面积不超过画面总面积的 20%；②人物如出现须为东亚面孔（中国学生/教师/职业人员），严禁欧美白人；③严禁正面人物头像特写、半身证件照式构图；④人物须以远景或侧身背景配角形式出现`,
    `【零文字铁律——绝对执行】画面内禁止任何文字符号：禁止中文汉字、拼音、英文字母、数字、标签、品牌 LOGO、水印、技术参数标注。上方"本页主体场景"中的中文描述只是给 AI 理解概念，画面里绝不能出现这些字`,
    `【风格禁区】禁止水墨画、水彩画、油画、铅笔素描、拼贴风；禁止 UI 界面截图、拓扑图、流程图线框；禁止模仿杂志封面版式`,
  ].join('\n');
}

export function ensurePptImagePromptForPage(page, { courseName, template, imageAspect, imageQuality }) {
  if (!page || !page.needImage) return page;
  // 2026-05-16 v4.1.4 Q2-①：AI stage 2 输出的 imagePrompt 不再被丢弃
  //   只要 imagePrompt 长度 ≥ 15 字（说明是真实的 AI 输出，不是空 / 占位），
  //   就走"叠加安全约束"路径，保留 AI 的页面级具体场景描述
  const aiPrompt = String(page.imagePrompt || '').trim();
  if (aiPrompt.length >= 15) {
    return {
      ...page,
      imagePrompt: enhanceAiImagePromptWithSafety(aiPrompt, {
        courseSubject: courseName,
        aspect: page.imageAspect || imageAspect,
        template,
      }),
    };
  }
  // imagePrompt 为空或过短，走原有 buildPptPageImagePrompt fallback
  return {
    ...page,
    imagePrompt: buildPptPageImagePrompt({
      // Phase-9 修正（2026-05-10）：不传文字 ≠ 不传主题。
      //   旧实现"故意不传 pageTitle / contentPreview"导致同一 pageType 的所有页面拿到完全相同的输入，
      //   AI 自然给出毫无差别的"通用风格背景图"。
      //   新做法：pageTitleSemantic / pageSummarySemantic 作为「视觉概念语义」喂给 AI，
      //   配合强约束"理解为画面概念，绝不渲染为文字字符"，让 AI 给每页不同的视觉概念。
      pageType: page.pageType,
      pageTitleSemantic: page.title || '',
      pageSummarySemantic: page.summary || '',
      pageKeyContent: page.keyContent || '',
      template,
      aspect: page.imageAspect || imageAspect,
      quality: page.imageQuality || imageQuality,
      courseSubject: courseName,
    })
  };
}

function buildSectionPage(section, index, modules, prevPages, courseName, template, imageAspect, imageQuality) {
  const pageType = classifySection(section);
  const pageKey = sectionKeyFromTitle(section.title, index);
  const previous = toList(prevPages).find((item) => String(item.pageKey || '') === pageKey) || {};
  const linkedModule = findLinkedModule(section, modules);
  const title = stripTimeLabel(section.title) || `内容页 ${index + 1}`;
  const subtitle = extractTimeLabel(section.title) || '';
  const summary = getSectionSummary(section) || '围绕本页核心内容进行讲解。';
  const keyContent = getSectionKeyContent(section);
  const needImage = pageType !== '路线图' && (typeof previous.needImage === 'boolean' ? previous.needImage : true);
  // 演讲者备注：从讲稿教师讲述段落提取
  const speakerNotes = buildSpeakerNotesFromSection(section);
  const page = {
    id: previous.id || `ppt-section-${index + 1}`,
    pageKey,
    pageNumber: index + 3,
    pageType,
    // 内容字段：总是用从讲稿新提取的内容
    title,
    subtitle,
    summary,
    speakerNotes,
    narrativeGoal: pageType === '课程导入'
      ? '快速建立课堂任务和学习目标。'
      : (pageType === '总结收束' ? '完成课堂收束并明确课后衔接。' : '帮助学生完成这一页的核心理解与动作。'),
    keyContent: keyContent.join('\n'),
    visual: pageType === '模块页' ? '与模块知识点一致的教学插图' : '辅助理解的课堂视觉图',
    layout: pageType === '模块页' ? '标题 + 左文右图' : '标题 + 信息块',
    moduleId: previous.moduleId || linkedModule?.id || '',
    needImage,
    // 图片字段：保留旧数据（用户已选的图不丢失）
    imageModel: previous.imageModel || PPT_FIXED_IMAGE_MODEL,
    imageAspect: previous.imageAspect || imageAspect,
    imageQuality: previous.imageQuality || imageQuality,
    imagePrompt: '',
    imagePath: previous.imagePath || '',
    imageUrl: previous.imageUrl || ''
  };
  return ensurePptImagePromptForPage(page, { courseName, template, imageAspect, imageQuality });
}

function buildFallbackPages({ lectureScript, modules, courseName, template, imageAspect, imageQuality, prevPages }) {
  const paragraphs = String(lectureScript || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#/.test(line));
  const sourceLines = paragraphs.length
    ? paragraphs
    : modules.map((item) => `${item.name || '未命名模块'}：${item.description || ''}`.trim()).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < sourceLines.length; i += 2) {
    chunks.push(sourceLines.slice(i, i + 2));
  }
  return chunks.map((chunk, index) => {
    const previous = toList(prevPages)[index + 2] || {};
    return ensurePptImagePromptForPage({
      id: previous.id || `ppt-page-${index + 1}`,
      pageKey: `content-${index + 1}`,
      pageNumber: index + 3,
      pageType: '内容页',
      title: `核心内容 ${index + 1}`,
      subtitle: '',
      summary: chunk.join(' '),
      narrativeGoal: '讲清这一页的核心内容。',
      keyContent: chunk.map((item) => `- ${item}`).join('\n'),
      visual: '与页面内容一致的教学插图',
      layout: '标题 + 左文右图',
      moduleId: previous.moduleId || '',
      needImage: typeof previous.needImage === 'boolean' ? previous.needImage : true,
      imageModel: previous.imageModel || PPT_FIXED_IMAGE_MODEL,
      imageAspect: previous.imageAspect || imageAspect,
      imageQuality: previous.imageQuality || imageQuality,
      imagePrompt: '',
      imagePath: previous.imagePath || '',
      imageUrl: previous.imageUrl || ''
    }, { courseName, template, imageAspect, imageQuality });
  });
}

export function buildPptPagesFromLecture({
  lectureScript,
  modules = [],
  courseName,
  template,
  imageAspect,
  imageQuality,
  prevPages = []
}) {
  const normalizedModules = normalizeLectureModules(modules, []);
  const sections = splitLectureSections(lectureScript).filter((section) => section.title && !isIgnorableLectureSection(section));
  const contentPages = sections.length
    ? sections.map((section, index) => buildSectionPage(section, index, normalizedModules, prevPages, courseName, template, imageAspect, imageQuality))
    : buildFallbackPages({ lectureScript, modules: normalizedModules, courseName, template, imageAspect, imageQuality, prevPages });

  const coverPrevious = toList(prevPages).find((item) => String(item.pageKey || '') === '__cover__') || {};
  const roadmapPrevious = toList(prevPages).find((item) => String(item.pageKey || '') === '__roadmap__') || {};
  const pages = [
    ensurePptImagePromptForPage({
      id: coverPrevious.id || 'ppt-cover',
      pageKey: '__cover__',
      pageNumber: 1,
      pageType: '封面',
      title: courseName || '课程',
      subtitle: '课程展示课件',
      summary: '建立课程主题、课堂任务和展示基调。',
      narrativeGoal: '快速说明课程主题和课堂价值。',
      keyContent: '1. 课程主题\n2. 课堂任务\n3. 学习价值',
      visual: '课程封面主视觉',
      layout: '封面大标题 + 底部信息条',
      moduleId: '',
      needImage: true,
      imageModel: coverPrevious.imageModel || PPT_FIXED_IMAGE_MODEL,
      imageAspect: coverPrevious.imageAspect || imageAspect,
      imageQuality: coverPrevious.imageQuality || imageQuality,
      imagePrompt: '',
      imagePath: coverPrevious.imagePath || '',
      imageUrl: coverPrevious.imageUrl || ''
    }, { courseName, template, imageAspect, imageQuality }),
    {
      id: roadmapPrevious.id || 'ppt-roadmap',
      pageKey: '__roadmap__',
      pageNumber: 2,
      pageType: '路线图',
      title: '课程路线图',
      subtitle: '从导入到成果交付的推进顺序',
      summary: '概览本节课的模块安排和推进逻辑。',
      narrativeGoal: '让学生先看到全局。',
      keyContent: toList(modules).length
        ? toList(modules).map((item, index) => `${index + 1}. ${item.name || `模块${index + 1}`}`).join('\n')
        : contentPages.slice(0, 6).map((item, index) => `${index + 1}. ${item.title}`).join('\n'),
      visual: '流程卡片或路线图',
      layout: '横向路线图',
      moduleId: '',
      needImage: false,
      imageModel: roadmapPrevious.imageModel || PPT_FIXED_IMAGE_MODEL,
      imageAspect: roadmapPrevious.imageAspect || imageAspect,
      imageQuality: roadmapPrevious.imageQuality || imageQuality,
      imagePrompt: '',
      imagePath: roadmapPrevious.imagePath || '',
      imageUrl: roadmapPrevious.imageUrl || ''
    }
  ];

  const allPages = [...pages, ...contentPages].map((page, index) => ({
    ...page,
    pageNumber: index + 1
  }));

  const hasEnding = allPages.some((page) => ['总结', '总结收束'].includes(page.pageType));
  if (!hasEnding) {
    allPages.push(ensurePptImagePromptForPage({
      id: 'ppt-ending',
      pageKey: '__ending__',
      pageNumber: allPages.length + 1,
      pageType: '总结',
      title: '总结与作业',
      subtitle: '课堂收束与课后衔接',
      summary: '回收本节重点，明确作业和下一步任务。',
      narrativeGoal: '让课堂闭环清楚。',
      keyContent: '1. 回顾重点\n2. 布置作业\n3. 提示下节衔接',
      visual: '收束型教学画面',
      layout: '总结页',
      moduleId: '',
      needImage: true,
      imageModel: PPT_FIXED_IMAGE_MODEL,
      imageAspect,
      imageQuality,
      imagePrompt: '',
      imagePath: '',
      imageUrl: ''
    }, { courseName, template, imageAspect, imageQuality }));
  }

  return allPages.map((page, index) => ({ ...page, pageNumber: index + 1 }));
}

export function normalizePptPagesWithPrompts(pages, { template, courseName }) {
  return toList(pages).map((page) => ensurePptImagePromptForPage(page, {
    courseName,
    template,
    imageAspect: page.imageAspect || '16:9',
    imageQuality: page.imageQuality || 'standard'
  }));
}

export { normalizeLectureModules };

export function getPptPageTaskId(notebookId, pageId) {
  return `${notebookId}-ppt-${pageId}`;
}

export function videoPrompt(courseName, style, script, pptPages = []) {
  const sections = splitLectureSections(script).filter((s) => !isIgnorableLectureSection(s));
  const opening = sections.find((s) => /开场|导入/.test(stripTimeLabel(s.title))) || sections[0] || null;
  const allModules = sections.filter((s) => /模块/.test(stripTimeLabel(s.title)));
  const closing = sections.find((s) => /总结|收束/.test(stripTimeLabel(s.title))) || sections[sections.length - 1] || null;
  const practice = sections.find((s) => /练习|检查/.test(stripTimeLabel(s.title)));

  // ===== 1. 目标锚定 =====
  const coreTheme = opening ? getSectionSummary(opening) : '本课程的核心教学目标';
  const moduleHighlights = allModules.slice(0, 4).map((s) => `${stripTimeLabel(s.title)}：${getSectionSummary(s)}`);
  const closingSummary = closing ? getSectionSummary(closing) : '回顾重点，课后延伸';

  // ===== 2. 钩子设计 =====
  // 从讲稿中提取最能引发好奇心的一句话（通常是开场的提问或反差）
  const hookCandidates = [];
  if (opening) {
    const lines = toList(opening.lines);
    let inSpoken = false;
    lines.forEach((line) => {
      if (/^教师讲述/.test(line)) { inSpoken = true; return; }
      if (/^课堂动作/.test(line)) { inSpoken = false; return; }
      if (inSpoken && line.trim().length >= 10) {
        // 优先选提问句和反差句
        if (/[？?]/.test(line)) hookCandidates.push(line.trim());
        else if (/但是|然而|可是|结果|没想到|竟然/.test(line)) hookCandidates.push(line.trim());
      }
    });
  }
  const hook = hookCandidates[0]
    ? hookCandidates[0].split(/[。！？]/)[0].substring(0, 40)
    : `学完这节课，你的设计能力会完全不一样`;

  // ===== 3. PPT 插图帧参考 =====
  const getPageImage = (type) => {
    const page = toList(pptPages).find((p) => p.pageType === type && (p.imagePath || p.imageUrl));
    return page ? (page.imagePath || page.imageUrl) : '';
  };
  const coverImg = getPageImage('封面');
  const closingImg = getPageImage('总结收束') || getPageImage('总结');
  const moduleImgs = allModules.slice(0, 4).map((s) => {
    const m = toList(pptPages).find((p) => p.title && stripTimeLabel(s.title).substring(0, 4) && p.title.includes(stripTimeLabel(s.title).substring(0, 4)));
    return m ? (m.imagePath || m.imageUrl || '') : '';
  });
  const frameRef = (img) => img ? `参考插图：${img}` : '无参考图，使用纯色/渐变过渡';

  // ===== 4. 风格推断 =====
  const styleMap = {
    '服装': { music: '轻快时尚电子乐 + Lo-fi节拍，有品牌质感', visual: '时尚杂志风，快切+慢放交替' },
    '电路': { music: '科技氛围电子乐，脉冲节拍', visual: '工程蓝图+微距实拍' },
    '光电': { music: '空灵科幻配乐，渐进式节奏', visual: '光效+精密仪器特写' },
    '机械': { music: '工业节拍，金属碰撞音效', visual: '车间实景+零件加工' },
    '陈列': { music: '舒缓品牌感配乐，空间感强', visual: '空间展示+搭配特写' }
  };
  const courseKey = Object.keys(styleMap).find((k) => (courseName || '').includes(k)) || '';
  const styleHint = styleMap[courseKey] || { music: '轻快专业教学配乐，节奏清晰', visual: '教学场景+信息图切换' };

  // ===== 5. 即梦四段式提示词（直接可投喂，每段 ≤2000字，覆盖 15 秒）=====
  const safeStyle = style || {};
  const accentName = colorCodeToNatural(safeStyle.accentColor || '#2E86DE');
  const bgName = colorCodeToNatural(safeStyle.background || '#F1F3F5');
  const imgStyleDesc = safeStyle.imageStyle
    || '高对比度摄影质感，专业工作台与材料局部细节，干净背景，无文字';
  const name = courseName || '课程';

  // 模块链路：取前 5 个模块名，用于第 4 段技能链展示
  const moduleChain = allModules.slice(0, 5)
    .map((s) => stripTimeLabel(s.title))
    .filter(Boolean)
    .join('→') || '导入→原理→实操→验收→总结';

  // 段落 2：取前两个模块亮点（去掉冗余引导语，保留知识句）
  const mod1 = moduleHighlights[0] || '专业知识体系构建，理论与实践结合';
  const mod2 = moduleHighlights[1] || '核心技能点讲解，系统化学习路径';
  // 段落 3：取后两个模块亮点，或练习阶段摘要
  const mod3 = moduleHighlights[2] || (practice ? getSectionSummary(practice) : '实操练习，动手验证');
  const mod4 = moduleHighlights[3] || '成果展示，互评验收';

  // 参考图路径（有则附上，供视频平台参考构图）
  const coverRef   = coverImg   ? `\n> 参考构图图片：${coverImg}` : '';
  const closingRef = closingImg ? `\n> 参考构图图片：${closingImg}` : '';

  // ── 第 1 段：钩子开场（0–15s）──────────────────────────────────────────
  const seg1 = [
    `画面风格：${imgStyleDesc}，${styleHint.visual}，16:9横版，1080p高清，无口播，纯音乐叙事。`,
    ``,
    `【0–3秒】极黑背景，画面正中冲击式快闪大字——「${hook}」，粗体白色衬线字，逐字出现，`,
    `镜头快速推进定格，配合一声低沉冲击音效。背景同步出现一张模糊粗糙的行业前状态画面（劣质效果图/手绘草图），`,
    `象征学习前的困境，色调灰暗低沉。`,
    ``,
    `【3–8秒】左右分屏对比：左侧——粗糙的行业草图或低质成果，线条杂乱，灰白冷淡；`,
    `右侧——同类项目的专业成果效果图，精准光影，商业质感高级。`,
    `分屏边缘用${accentName}竖线分隔，镜头从左缓慢横移至右侧，右侧画面越来越清晰明亮。`,
    ``,
    `【8–15秒】镜头切入现代化专业实训室，高配工作台，屏幕上显示专业软件操作界面，`,
    `工具整齐，暖光打亮桌面，强烈代入感。画面右下角淡入白色衬线大字：「${name}」，`,
    `${accentName}细横线从左向右划出作为标题装饰，停留至段尾。`,
    ``,
    `镜头：0–3秒快速推进+定格；3–8秒平稳横移；8–15秒由宽景缓推至中景。`,
    `音乐：0–3秒静默+冲击音效；3–15秒轻柔低频电子乐缓缓引入。`,
    `字幕：「${hook}」（0–3秒）、「${name}」（10–15秒）。`,
    coverRef
  ].filter((l) => l !== undefined).join('\n').trim();

  // ── 第 2 段：核心亮点（15–30s）────────────────────────────────────────
  const seg2 = [
    `画面风格：${imgStyleDesc}，专业技术细节特写，冷峻精密质感，16:9横版，1080p，无口播。`,
    ``,
    `【15–22秒】镜头推进至专业软件操作界面，屏幕上展示${mod1}。`,
    `操作者仅露手腕以下，熟练操作键盘鼠标，工作台干净整洁，光线均匀。`,
    `镜头从屏幕全景缓慢局部放大至核心操作细节，专业代入感强烈。`,
    ``,
    `【22–30秒】切换至关键知识点的视觉化呈现：${mod2}。`,
    `画面以快切方式依次展示2–3个知识细节，每个镜头约2秒，`,
    `主色调以${accentName}为强调色，整体与${bgName}协调，技术感十足，无任何文字出现在画面内容中。`,
    ``,
    `镜头：平稳横移+局部放大，流畅不急促。`,
    `音乐：节奏渐强，低频电子乐配合知识点节拍推进。`,
    `字幕：无。`,
  ].join('\n').trim();

  // ── 第 3 段：实战预告（30–45s）────────────────────────────────────────
  const seg3 = [
    `画面风格：${imgStyleDesc}，活力实训场景与精美成果交替，快节奏剪辑，16:9横版，1080p，无口播。`,
    ``,
    `【30–38秒】实训室全景：多名学生在专业设备前专注操作，每台屏幕呈现不同阶段成果。`,
    `画面聚焦在：${mod3}。`,
    `人物以远景为主，以学习场景和屏幕为主体，不出现人物正面特写。`,
    `镜头从入口缓慢推进，充满代入感与期待感。`,
    ``,
    `【38–45秒】进入快切模式，每张1–2秒，依次展示学生阶段成果：`,
    `① 过程阶段图（建模线框/草稿）；`,
    `② ${mod4}；`,
    `③ 前后对比：初稿 vs 完成品，成就感爆发。`,
    `每次切换时${accentName}光线扫过画面边缘作为转场，节奏强劲。`,
    ``,
    `镜头：30–38秒缓慢推进；38–45秒快切，1–2秒/张。`,
    `音乐：节奏高点，动感强劲，与快切节奏对齐。`,
    `字幕：无。`,
  ].join('\n').trim();

  // ── 第 4 段：行动号召（45–60s）────────────────────────────────────────
  const seg4 = [
    `画面风格：${imgStyleDesc}，深色背景，白色衬线大字，${accentName}收束，品牌仪式感，16:9，1080p，无口播。`,
    ``,
    `【45–52秒】展示本课程最终完整成果的大全景特写：`,
    `${closingSummary}。`,
    `画面质感精致，光影层次丰富，以成果为绝对主体，无人物正面出现。`,
    `镜头极缓慢向内推进，沉浸式视角，停留在最美构图处定格。`,
    ``,
    `【52–57秒】画面渐变至深色渐变背景，以流线型动画方式从左到右依次出现技能节点：`,
    `「${moduleChain}」`,
    `每个节点用${accentName}圆圈标注，节点间用${accentName}细线串联，展示完整技能链条。`,
    `画面右侧同步出现白色大字：「现在，你知道答案了」，衬线字体，末尾加${accentName}句点。`,
    ``,
    `【57–60秒】纯黑背景，画面正中白色衬线大字：「${name}」，字从模糊渐清晰，`,
    `下方${accentName}横线从中央向两侧延伸，最后一帧停留1秒，品牌记忆感强烈。`,
    ``,
    `镜头：45–52秒极缓慢推进定格；52–57秒信息图动效（无镜头运动）；57–60秒静帧。`,
    `音乐：${styleHint.music}，渐弱收束，最后2秒完全静音。`,
    `字幕：「现在，你知道答案了」（52–57秒）、「${name}」（57–60秒）。`,
    closingRef
  ].filter((l) => l !== undefined).join('\n').trim();

  return [
    `# 《${name}》微课宣传视频 — 即梦分段提示词`,
    ``,
    `> **使用说明**：共 4 段，每段 15 秒，依次投喂即梦平台，生成后剪辑拼接。`,
    `> 段间转场：第1→2段用${accentName}光线横扫（0.4秒）；第2→3段硬切（配音乐节拍）；第3→4段渐暗淡入（0.5秒）。`,
    ``,
    `---`,
    ``,
    `## 第 1 段｜0–15 秒｜钩子开场`,
    `**情绪**：好奇 → 悬念 → 期待`,
    ``,
    seg1,
    ``,
    `---`,
    ``,
    `## 第 2 段｜15–30 秒｜核心亮点`,
    `**情绪**：认同 → 发现 → "原来如此"`,
    ``,
    seg2,
    ``,
    `---`,
    ``,
    `## 第 3 段｜30–45 秒｜实战预告`,
    `**情绪**：兴奋 → 跃跃欲试 → "我也想做"`,
    ``,
    seg3,
    ``,
    `---`,
    ``,
    `## 第 4 段｜45–60 秒｜行动号召`,
    `**情绪**：期待 → 行动 → 收获感`,
    ``,
    seg4,
  ].join('\n');
}
