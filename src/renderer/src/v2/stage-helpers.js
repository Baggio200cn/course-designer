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
const GUIZANG_HERO_TYPES = new Set(['封面', '模块页', '路线图', '课程导入']);

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
  quality
}) {
  // ⚠️ 重要：本函数故意不接受 pageTitle / pageSubtitle / contentPreview 等文字参数。
  // 将中文标题/内容送入图像 prompt 会导致 AI 把这些文字"烧"进背景图。
  // 文字内容（标题、要点）由 Canvas 合成层 100% 负责，图片只负责纯视觉氛围。

  const safeTemplate = template || {};

  // ── guizang Hero 页分路由 ────────────────────────────────────────────────
  if (safeTemplate.variant === 'guizang' && GUIZANG_HERO_TYPES.has(pageType)) {
    const textureDesc = GUIZANG_HERO_TEXTURE_MAP[safeTemplate.heroBackground]
      || '深色极简纹理背景，接近全黑，微弱光影层次，沉稳克制';
    return [
      `极简主义抽象背景纹理：${textureDesc}。`,
      `横版全幅（${aspect || '16:9'}），整体画面需足够暗沉，极低亮度，深邃克制，纯粹质感。`,
      `【绝对禁止】无任何文字符号、无任何字母数字、无人物、无具体物品识别物、无品牌LOGO、无鲜艳颜色区块。`,
      `纯视觉背景纹理，零内容信息，零文字痕迹，零可识别元素。`
    ].join('\n');
  }

  // ── 普通内容页场景描述（所有模板通用）────────────────────────────────────
  const sceneMap = {
    '封面':    '课程封面主视觉：专业实训工作台或展示空间的精美俯拍，工具与材料的精致陈列特写，构图大气，光影层次丰富，以物品与空间环境为主体',
    '课程导入': '课堂开场氛围：宽敞明亮的实训室或教室全景，学习设备整齐排列，探索感与好奇心，暖光，人物如出现须为远景小比例配角',
    '路线图':  '抽象路径进程可视化：几何节点依次串联，流动的阶段感，简洁的方向感构图，无任何文字标注，纯抽象图形',
    '模块页':  '章节开幕主视觉：单一主体强构图，视觉张力十足，画面上下留白充足，色彩饱满，以物品或抽象图形为主体',
    '模块导入': '真实职业现场环境全景：行业工作台与专业器材，自然光线，代入感强，无人物正面特写',
    '原理讲解': '抽象概念知识图解：几何体结构与空间关系，对称或放射构图，纯视觉场景，无任何文字标签，无人物',
    '操作步骤': '实操工艺俯拍特写：专业工具与材料在操作台面上的精确摆放，仅展示手部操作细节（手腕以下），材料纹理细节，禁止出现人物面部',
    '验收检查': '精致成品陈列特写：光线打亮成品细节，干净的展示台背景，以成品为绝对视觉主体，无人物面部',
    '课堂练习': '协作实训工作坊全景：多人远景活动场景，工具材料散落有序，活跃课堂气氛，人物为远景背景配角，禁止正面人物头像',
    '总结收束': '完成收束画面：整洁陈列的成品序列，成就感与收获感，柔和结束氛围，以成品为主体'
  };

  const scene = sceneMap[pageType] || '现代化职业实训工作空间：专业工具与材料精致陈列，干净整洁的构图，以环境与器材为主体，无人物正面头像';
  const styleDesc = safeTemplate.imageStyle || '现代扁平化插图风格，色块分明，线条清晰，专业教育氛围';
  const accent = colorCodeToNatural(safeTemplate.accentColor || '#2E86DE');
  const bg = colorCodeToNatural(safeTemplate.background || '#F1F3F5');

  return [
    `${scene}。`,
    `横版全幅构图（${aspect || '16:9'}），视觉主体集中于画面中央主要区域，四周边缘保持简洁通透。`,
    `视觉风格：${styleDesc}。`,
    `色彩方向：主色调以${accent}为强调色，整体色调与${bg}色调协调统一。`,
    `【人物构图规则】①画面以环境/物品/场景为主体，人物面积不超过画面总面积的20%；②人物如出现，必须是东亚面孔（中国学生/教师/职业人员），严禁欧美白人；③严禁正面人物头像特写、半身证件照式构图；④人物须以远景或侧身背景配角形式出现。`,
    `【零文字铁律——绝对执行】画面内禁止出现任何形式的文字符号：禁止中文汉字、禁止拼音字母、禁止英文字母、禁止阿拉伯数字、禁止任何标签标注、禁止品牌LOGO、禁止水印、禁止技术参数标注。任何文字痕迹均不可接受。`,
    `【风格禁区】禁止水墨画、水彩画、油画、铅笔素描、拼贴风；禁止UI界面截图、拓扑图、流程图线框；禁止模仿杂志封面版式。`
  ].join('\n');
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

export function ensurePptImagePromptForPage(page, { courseName, template, imageAspect, imageQuality }) {
  if (!page || !page.needImage || String(page.imagePrompt || '').trim()) return page;
  return {
    ...page,
    imagePrompt: buildPptPageImagePrompt({
      // ⚠️ 故意不传 pageTitle / contentPreview：文字内容不进入图像 prompt
      pageType: page.pageType,
      template,
      aspect: page.imageAspect || imageAspect,
      quality: page.imageQuality || imageQuality
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
