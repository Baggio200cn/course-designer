const JIMENG_URL = 'https://jimeng.jianying.com/ai-tool/generate';
const PEXO_URL = 'https://pexo.ai/home';
const PEXO_CODE = '2ANM9M';
const PPT_FIXED_IMAGE_MODEL = 'seedream';

// ─────────────────────────────────────────────────────────────────────────────
// PPT_TEMPLATE_PRESETS — 所有模板均已升级为 guizang 三层排版体系（Phase A）
//
// 新增 token 说明：
//   variant       : 'guizang' — 触发 Canvas 合成器走 guizang 分支逻辑
//   heroBackground: Hero 页（封面/模块页/路线图/课程导入）的深色背景
//   paperPanel    : 内容页左侧文字面板颜色（接近 background，用于 Canvas 面板绘制）
//   ruleColor     : Kicker 横线 + Kicker 文字强调色（各模板个性化）
//   metaFont      : 等宽字体 —— 用于 Kicker/页码/元数据（三层字体底层）
//   titleFont     : 衬线字体 —— Canvas 合成标题层（三层字体顶层）
//   bodyFont      : 无衬线字体 —— Canvas 合成正文/要点层（三层字体中层）
//
// ⚠️ imageStyle 只描述视觉渲染风格，不含内容域关键词，不含中文文字触发词
// ─────────────────────────────────────────────────────────────────────────────
const PPT_TEMPLATE_PRESETS = {
  fashion_magazine: {
    name: '时尚杂志风',
    variant: 'guizang',
    aesthetic: '高对比度摄影质感，戏剧性光影，强调视觉冲击力，适合展示设计、空间设计、服装陈列等视觉类课程。',
    // ── 色彩 token ──────────────────────────────────────────────────────────
    background:      '#FAFAF8',    // 内容页底色：冷纸白
    heroBackground:  '#0D0D0D',    // Hero 页：纯黑高反差（时尚杂志风封面）
    paperPanel:      '#FAFAF8',    // 内容页左侧文字面板色
    ruleColor:       '#E91E8C',    // Kicker 横线 + 等宽文字：品红强调
    textColor:       '#1A1A1A',    // 深黑墨色正文
    accentColor:     '#E91E8C',    // 主强调色：品红
    // ── 字体 token（三层）──────────────────────────────────────────────────
    titleFont: '"SimSun","FangSong","STSong","Songti SC",serif',
    bodyFont:  '"PingFang SC","Microsoft YaHei",sans-serif',
    metaFont:  '"Consolas","Courier New","IBM Plex Mono",monospace',
    // ── 图像 prompt 风格描述 ────────────────────────────────────────────────
    // "editorial/戏剧性侧向打光" 会触发人物头像特写，已全部移除
    imageStyle: '高对比度商业摄影质感，精致专业工作台与材料局部细节，冷峻洁白或极浅灰背景，' +
      '以物品/空间/陈列环境为画面主体，视觉重心偏向右侧，干净利落的构图，无任何装饰文字，无人物正面头像特写',
    visual: '适合全版照片+衬线大标题叠加、不对称排版、品红强调色块。'
  },

  display_window: {
    name: '橱窗展示风',
    variant: 'guizang',
    aesthetic: '深色背景+金色点缀，奢华质感，强调精致陈列美学，适合高端设计类课程。',
    // ── 色彩 token ──────────────────────────────────────────────────────────
    background:      '#1C1C2E',    // 深夜蓝黑底色
    heroBackground:  '#0A0A1A',    // Hero 页：更深午夜蓝（加强戏剧感）
    paperPanel:      '#161625',    // 内容页左侧面板：比背景略亮的深色，保持深色调
    ruleColor:       '#D4AF37',    // Kicker 横线 + 等宽文字：正金色（最契合主题）
    textColor:       '#F5F5F0',    // 明亮米白正文（深色背景上可读）
    accentColor:     '#D4AF37',    // 主强调色：金色
    // ── 字体 token（三层）──────────────────────────────────────────────────
    titleFont: '"SimSun","FangSong","STSong","Songti SC",serif',
    bodyFont:  '"Alibaba PuHuiTi 2.0","Microsoft YaHei",sans-serif',
    metaFont:  '"Consolas","Courier New","IBM Plex Mono",monospace',
    // ── 图像 prompt 风格描述 ────────────────────────────────────────────────
    // 移除"服装陈列/戏剧性明暗对比"等触发人物头像的词汇
    imageStyle: '深夜蓝黑背景，金色或暖白聚光灯打亮陈列物品或场景主体，精致奢华光影层次，' +
      '静物摄影级别的精细质感，视觉主体偏向画面右侧，以展示物品或环境空间为主体，无人物正面头像',
    visual: '适合暗色背景+金色 Kicker 横线、衬线大标题、剧场感左文右图布局。'
  },

  pastel_energy: {
    name: '粉彩活力风',
    variant: 'guizang',
    aesthetic: '马卡龙粉彩配色，Y2K 活力美学，亲和可爱，强调互动感和年轻化表达。',
    // ── 色彩 token ──────────────────────────────────────────────────────────
    background:      '#FEF0F7',    // 粉白纸色
    heroBackground:  '#2D1B4E',    // Hero 页：深紫莓果色（Y2K 夜间感）
    paperPanel:      '#FEF0F7',    // 内容页左侧面板：同背景粉白
    ruleColor:       '#FF85A2',    // Kicker 横线 + 等宽文字：珊瑚粉强调
    textColor:       '#2D1B4E',    // 深紫正文
    accentColor:     '#FF85A2',    // 主强调色：珊瑚粉
    // ── 字体 token（三层）──────────────────────────────────────────────────
    titleFont: '"SimSun","FangSong","STSong","Songti SC",serif',
    bodyFont:  '"OPPOSans","PingFang SC","Microsoft YaHei",sans-serif',
    metaFont:  '"Consolas","Courier New","IBM Plex Mono",monospace',
    // ── 图像 prompt 风格描述 ────────────────────────────────────────────────
    // 保留扁平插图风格，移除具体装饰物列举（避免被渲染成文字）
    imageStyle: '粉彩扁平矢量插图风格，Y2K 美学，马卡龙配色方案，活泼饱和度高，' +
      '圆润柔和的几何场景构图，视觉主体偏向画面右侧，无文字标注，人物如出现须为卡通化小比例远景配角',
    visual: '适合深紫 Hero 封面+衬线大标题、粉白内容页左文右图、圆角 Chip 要点。'
  },

  guochao_modern: {
    name: '国潮现代风',
    variant: 'guizang',
    aesthetic: '传统中式纹样现代简化，红色强调+米白底，书法留白美学，兼顾课堂可读性与国风文化感。',
    // ── 色彩 token ──────────────────────────────────────────────────────────
    background:      '#FFFCF7',    // 暖调米白纸色（宣纸感）
    heroBackground:  '#1A0A00',    // Hero 页：深墨棕黑（水墨沉稳感）
    paperPanel:      '#FFFCF7',    // 内容页左侧面板：同背景米白
    ruleColor:       '#C8102E',    // Kicker 横线 + 等宽文字：中国红强调
    textColor:       '#1A0A00',    // 深墨棕黑正文
    accentColor:     '#C8102E',    // 主强调色：中国红
    // ── 字体 token（三层）──────────────────────────────────────────────────
    titleFont: '"SimSun","FangSong","STSong","Songti SC",serif',
    bodyFont:  '"Alibaba PuHuiTi 2.0","Microsoft YaHei",sans-serif',
    metaFont:  '"Consolas","Courier New","IBM Plex Mono",monospace',
    // ── 图像 prompt 风格描述 ────────────────────────────────────────────────
    // 移除"书法笔意"（会触发文字渲染），保留东方极简构图
    imageStyle: '东方极简美学，大面积留白构图，传统纹样几何化简化，中国红与金色点缀，' +
      '整洁温润的米白色调，视觉主体偏向画面右侧，以抽象纹样或环境场景为主体，无任何文字、书法或人物正面头像',
    visual: '适合深墨 Hero 封面+衬线大标题、米白内容页左文右图、红色 Kicker 横线。'
  },

  pro_minimalist: {
    name: '通用简约型',
    variant: 'guizang',
    aesthetic: '深海藏青蓝 × 冷瓷白，Indigo Porcelain 配色，三层字体层级，适合所有学科通用教学。',
    // ── 色彩 token（升级为 Indigo Porcelain 调色板）──────────────────────
    background:      '#F1F3F5',    // 内容页：冷瓷白（升级自 EAF4FB）
    heroBackground:  '#0A1F3D',    // Hero 页：深海藏青蓝（Indigo Porcelain）
    paperPanel:      '#F1F3F5',    // 内容页左侧文字面板色
    ruleColor:       '#F0A500',    // Kicker 横线 + 等宽文字：金色强调
    textColor:       '#0A1F3D',    // 深藏青墨色正文（升级自 1B3A6B）
    accentColor:     '#2E86DE',    // 主强调色：深天蓝（左侧竖条/分割线）
    secondaryAccent: '#F0A500',    // 保留向后兼容
    // ── 字体 token（三层）──────────────────────────────────────────────────
    titleFont: '"SimSun","FangSong","STSong","Songti SC",serif',
    bodyFont:  '"Microsoft YaHei","PingFang SC",sans-serif',
    metaFont:  '"Consolas","Courier New","IBM Plex Mono",monospace',
    // ── 图像 prompt 风格描述 ────────────────────────────────────────────────
    imageStyle: '极简克制的专业场景摄影风格，深蓝白冷灰低饱和配色，干净几何构图，' +
      '视觉主体偏向画面右侧三分之二（左侧留白供文字面板覆盖），商务教育氛围，无多余装饰，无文字标注，无人物正面头像',
    visual: '适合深海蓝 Hero 封面+衬线大标题、冷瓷白内容页左文右图、金色 Kicker 横线。'
  }
};

// 向后兼容别名（旧版 key → 新版 key 映射）
PPT_TEMPLATE_PRESETS.modern    = PPT_TEMPLATE_PRESETS.pro_minimalist;
PPT_TEMPLATE_PRESETS.national  = PPT_TEMPLATE_PRESETS.guochao_modern;
PPT_TEMPLATE_PRESETS.playful   = PPT_TEMPLATE_PRESETS.pastel_energy;
PPT_TEMPLATE_PRESETS.blueprint = PPT_TEMPLATE_PRESETS.pro_minimalist;

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

function getSectionSummary(section) {
  // 从教师讲述段落中提取最有价值的摘要句
  const lines = toList(section?.lines);
  let inSpoken = false;
  const candidates = [];
  const genericPatterns = [
    /^这一段要把/, /^教师还要明确/, /^这一部分围绕/,
    /^重点要把/, /^学完这一段/, /^这里有一个常见误区/,
    /^在正式进入/, /^开场先把/, /^为什么要学/,
    /^这一段先不急/, /^用一个贴近/, /^你们先看现象/,
    /^第一点.*先来看/, /^接着.*进入/, /^首先.*来看/,
    /^这一节课不是/, /^现在咱们/, /^好了.*开始/,
    /^这一部分要把/, /^先不急着把名词/,
    /^练习阶段最关键/, /^总结时要把/
  ];
  for (const line of lines) {
    if (/^教师讲述[:：]/.test(line)) { inSpoken = true; continue; }
    if (/^课堂动作/.test(line)) break;
    if (inSpoken && line.trim().length >= 10) {
      const text = line.replace(/^[-*•]\s*/, '').trim();
      const sentences = text.split(/[。！？]/).filter(s => s.trim().length >= 8);
      for (const s of sentences) {
        const t = s.trim();
        if (!genericPatterns.some(p => p.test(t))) {
          candidates.push(t);
        }
      }
    }
  }
  if (candidates.length) return shorten(candidates[0], 88);

  const teacherBullets = getLabeledBullets(section, '教师讲述');
  if (teacherBullets.length) return shorten(teacherBullets[0], 88);
  const genericBullet = lines.find((line) => /^-\s+/.test(line));
  if (genericBullet) return shorten(genericBullet.replace(/^-\s+/, ''), 88);
  return shorten(section?.body || '', 88);
}

function getSectionKeyContent(section) {
  // 优先从教师讲述中提取核心知识句（不限于 bullet 格式）
  const lines = toList(section?.lines);
  let inSpoken = false;
  const spokenSentences = [];
  lines.forEach((line) => {
    if (/^教师讲述[:：]/.test(line)) { inSpoken = true; return; }
    if (/^课堂动作/.test(line)) { inSpoken = false; return; }
    if (inSpoken && line.trim()) {
      const text = line.replace(/^[-*•]\s*/, '').trim();
      // 按句号拆分，提取 8-60 字的有意义短句
      const sentences = text.split(/[。！？]/).filter(s => {
        const t = s.trim();
        return t.length >= 8 && t.length <= 60;
      });
      sentences.forEach(s => spokenSentences.push(s.trim()));
    }
  });

  // 过滤掉引导语和模板句，优先保留含具体知识内容的句子
  const genericPatterns = [
    /^这一段要把/, /^教师还要明确/, /^这一部分围绕/,
    /^重点要把/, /^学完这一段/, /^这里有一个常见误区/,
    /^这一段先不急/, /^用一个贴近/, /^你们先看现象/,
    /^第一点.*先来看/, /^接着.*进入/, /^首先.*来看/,
    /^这一节课不是/, /^开场先把/, /^为什么要学/,
    /^在正式进入/, /^现在咱们/, /^好了.*开始/,
    /围绕本页/, /核心提炼/, /真正串起来/,
    /^这一部分要把/, /^先不急着把名词/,
    /^练习阶段最关键/, /^总结时要把/
  ];
  const meaningful = spokenSentences.filter(s =>
    !genericPatterns.some(p => p.test(s)) && s.length >= 10
  );

  if (meaningful.length >= 2) {
    return uniqueTexts(meaningful.slice(0, 6), 4);
  }

  // 如果教师讲述中没有足够内容，才用 bullet 和课堂动作补充
  const teacherBullets = getLabeledBullets(section, '教师讲述');
  if (teacherBullets.length) return uniqueTexts(teacherBullets, 4);

  // 最后才用所有 spoken 句子（包括泛化的）
  if (spokenSentences.length) return uniqueTexts(spokenSentences.slice(0, 6), 4);

  const actionBullets = getLabeledBullets(section, '课堂动作');
  return uniqueTexts(actionBullets, 4);
}

function classifySection(section) {
  const title = stripTimeLabel(section?.title || '');
  const body = String(section?.body || '');
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

function stripTimingFromText(text) {
  return String(text || '').replace(/\d+-\d+\s*分钟/g, '').replace(/[（()）]/g, '').trim();
}

// Hero 页类型集合——这些页型在 guizang 模式下使用深色满铺背景 + 纯排版方案
const GUIZANG_HERO_TYPES = new Set(['封面', '模块页', '路线图', '课程导入']);

// 各模板 heroBackground 对应的深色纹理描述（用于 Hero 页图像生成）
const GUIZANG_HERO_TEXTURE_MAP = {
  '#0D0D0D': '极黑磨砂材质纹理，细腻炭灰质感，接近全黑，仅有极微弱的漫反射光影层次，适合时尚杂志风夜间感',
  '#0A0A1A': '深宇宙蓝黑纹理，微弱的蓝色星云光晕散射，极低饱和度，深邃无垠，适合橱窗展示风奢华感',
  '#2D1B4E': '深紫暮色渐变纹理，极低亮度，微弱的电子光效散射，接近全黑的紫色调，Y2K 静谧夜晚感',
  '#1A0A00': '深墨棕色宣纸微纹，接近全黑的暖棕色调，极低亮度，沉稳内敛，中式书房昏暗质感',
  '#0A1F3D': '深海藏青蓝渐变纹理，极低饱和度，接近全黑的冷蓝色调，微弱极光冷光层次，冷峻深邃'
};

function buildPptPageImagePrompt({
  pageType,
  template,
  aspect,
  quality
}) {
  // ⚠️ 重要：本函数故意不接受 pageTitle / pageSubtitle / contentPreview 等文字参数。
  // 原因：将中文标题/内容送入图像 prompt 会导致 Seedream 把这些文字"烧"进背景图。
  // 文字内容（标题、要点）由 Canvas 合成层 100% 负责，图片只负责纯视觉氛围。

  const safeTemplate = template || PPT_TEMPLATE_PRESETS.pro_minimalist;

  // ── guizang Hero 页分路由 ────────────────────────────────────────────────
  // Hero 页在 Canvas 合成时会叠加 85% 的 heroBackground 深色遮罩，
  // AI 图像几乎不可见，只贡献一点微弱纹理感。
  // 因此用抽象深色纹理即可，不需要具体场景，也彻底避免具体物件/文字烧入。
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
  // 基于页面类型的纯视觉场景描述（无任何中文标题/内容文字）
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

  const scene = sceneMap[pageType] || '职业教育专业实训场景：现代化工作环境，专业工具与材料精致陈列，干净整洁的构图，无人物正面头像';

  return [
    `${scene}。`,
    `横版全幅构图（${aspect || '16:9'}），视觉主体集中于画面中央主要区域，四周边缘保持简洁通透。`,
    `视觉风格：${safeTemplate.imageStyle || '现代扁平化插图风格，色块分明，线条清晰，专业教育氛围'}。`,
    `色彩方向：主色调以${colorCodeToNatural(safeTemplate.accentColor)}为强调色，整体色调与${colorCodeToNatural(safeTemplate.background)}色调协调统一。`,
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
function buildSpeakerNotesFromSection(section) {
  if (!section) return '';
  const lines = toList(section.lines);
  let inSpoken = false;
  const narrationParts = [];

  for (const line of lines) {
    if (/^教师讲述[:：]/.test(line)) { inSpoken = true; continue; }
    // 遇到课堂动作段落时停止提取
    if (/^课堂动作/.test(line)) break;
    if (inSpoken && line.trim().length >= 5) {
      // 清除 bullet 前缀，保留原始句子
      narrationParts.push(line.replace(/^[-*•]\s*/, '').trim());
    }
  }

  if (!narrationParts.length) {
    // fallback：从 body 中取前 180 字
    return shorten(section.body || '', 180);
  }

  const full = narrationParts.join('');
  if (full.length <= 220) return full;

  // 在 150-200 字范围内找句号作切断点
  let cutAt = full.lastIndexOf('。', 200);
  if (cutAt < 80) cutAt = full.lastIndexOf('，', 200);
  if (cutAt < 80) cutAt = 180;
  return full.slice(0, cutAt + 1);
}

function buildPptLockedPrompt({
  courseName,
  page,
  template,
  aspect,
  quality,
  customRequirements
}) {
  // ⚠️ 重要：本函数故意不把 page.title / page.summary 送入图像 prompt。
  // 将中文文字内容注入图像提示词会导致 Seedream 把文字烧进背景图。
  // 文字由 Canvas 程序化叠加层负责，图片只生成纯视觉背景。

  const safeTemplate = template || PPT_TEMPLATE_PRESETS.pro_minimalist;

  // ── guizang Hero 页分路由（与 buildPptPageImagePrompt 逻辑保持一致）───────
  if (safeTemplate.variant === 'guizang' && GUIZANG_HERO_TYPES.has(page.pageType)) {
    const textureDesc = GUIZANG_HERO_TEXTURE_MAP[safeTemplate.heroBackground]
      || '深色极简纹理背景，接近全黑，微弱光影层次，沉稳克制';
    return [
      `极简主义抽象背景纹理：${textureDesc}。`,
      `横版全幅（${aspect || '16:9'}），整体画面需足够暗沉，极低亮度，深邃克制，纯粹质感。`,
      `【绝对禁止】无任何文字符号、无任何字母数字、无人物、无具体物品识别物、无品牌LOGO、无鲜艳颜色区块。`,
      `纯视觉背景纹理，零内容信息，零文字痕迹，零可识别元素。`
    ].join('\n');
  }

  // ── 普通内容页 ───────────────────────────────────────────────────────────
  const sceneMap = {
    '封面':    '课程封面主视觉：专业实训工作台或展示空间的精美俯拍，工具与材料的精致陈列特写，构图大气，光影层次丰富，以物品与空间环境为主体',
    '课程导入': '课堂开场氛围：宽敞明亮的实训室或教室全景，学习设备整齐排列，探索感与好奇心，暖光，人物如出现须为远景小比例配角',
    '路线图':  '抽象路径进程可视化：几何节点依次串联，流动的阶段感，简洁的方向感构图，无文字标注，纯抽象图形',
    '模块页':  '章节开幕主视觉：单一主体强构图，视觉张力十足，画面上下留白充足，色彩饱满，以物品或抽象图形为主体',
    '模块导入': '真实职业现场环境全景：行业工作台与专业器材，自然光线，代入感强，无人物正面特写',
    '原理讲解': '抽象概念图解：几何体结构与空间关系，对称或放射构图，纯视觉场景，无文字标签，无人物',
    '操作步骤': '实操工艺俯拍特写：专业工具与材料在操作台面上的精确摆放，仅展示手部操作细节（手腕以下），材料纹理细节，禁止出现人物面部',
    '验收检查': '精致成品陈列特写：光线打亮成品细节，干净的展示台背景，以成品为绝对视觉主体，无人物面部',
    '课堂练习': '协作实训工作坊全景：多人远景活动场景，工具材料散落有序，活跃课堂气氛，人物为远景背景配角，禁止正面人物头像',
    '总结收束': '完成收束画面：整洁陈列的成品序列，成就感与收获感，柔和结束氛围，以成品为主体',
    '内容页':  '现代化职业实训工作空间：专业工具与材料精致陈列，干净整洁的构图，以环境与器材为主体'
  };
  const scene = sceneMap[page.pageType] || sceneMap['内容页'];

  // 如果用户有自定义视觉方向提示，提取其中的视觉关键词（非内容文字）
  // 注意：customRequirements 可能包含旧版本的文字 prompt，我们只取最后一行作为方向提示
  const visualHint = customRequirements
    ? String(customRequirements).split('\n').pop().slice(0, 80).trim()
    : '';

  return [
    `场景：${scene}。`,
    `专业领域视觉氛围：仅作参考，严禁渲染任何文字、数字或标签。`,
    `横版全幅构图（${aspect || '16:9'}），视觉主体居中或三分法，四周边缘保持简洁通透。`,
    `视觉风格：${safeTemplate.imageStyle || '现代扁平化插图风格，色块分明，线条清晰'}。`,
    `色彩方向：主色调以${colorCodeToNatural(safeTemplate.accentColor)}为强调色，与${colorCodeToNatural(safeTemplate.background)}色调协调。`,
    '',
    '【人物构图规则】①画面以环境/物品/场景为主体，人物面积不超过画面总面积的20%；②人物如出现，必须是东亚面孔（中国学生/教师/职业人员），严禁欧美白人；③严禁正面人物头像特写、半身证件照式构图；④人物须以远景或侧身背景配角形式出现。',
    '【零文字铁律——绝对执行，无任何例外】',
    '- 画面内禁止出现任何文字符号：中文汉字、拼音字母、英文字母、数字、标签、说明文字、品牌LOGO、水印、技术参数——全部禁止。',
    '- 禁止水墨画、水彩画、油画、铅笔素描风格；禁止UI面板截图；禁止拓扑框线图；禁止模仿杂志封面版式。',
    '- 高清锐利，适合课堂大屏投影。',
    visualHint ? `视觉方向参考：${visualHint}` : ''
  ].filter(Boolean).join('\n');
}

function buildPptTextFramework({ courseName, template, pages }) {
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

function ensurePptImagePromptForPage(page, { courseName, template, imageAspect, imageQuality }) {
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
  const subtitle = extractTimeLabel(section.title) || previous.subtitle || '';
  const summary = getSectionSummary(section) || '围绕本页核心内容进行讲解。';
  const keyContent = getSectionKeyContent(section);
  const needImage = pageType !== '路线图' && (typeof previous.needImage === 'boolean' ? previous.needImage : true);
  // 演讲者备注：从讲稿教师讲述段落提取（每次重新提取，不继承旧缓存）
  const speakerNotes = buildSpeakerNotesFromSection(section);
  const page = {
    id: previous.id || `ppt-section-${index + 1}`,
    pageKey,
    pageNumber: index + 3,
    pageType,
    // 内容字段：总是用从讲稿新提取的内容，不继承旧缓存
    title,
    subtitle,
    summary,
    speakerNotes,
    narrativeGoal: pageType === '课程导入'
      ? '快速建立课堂任务和学习目标。'
      : (pageType === '总结' ? '完成课堂收束并明确课后衔接。' : '帮助学生完成这一页的核心理解与动作。'),
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

function buildPptPagesFromLecture({
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
      title: coverPrevious.title || courseName || '课程',
      subtitle: coverPrevious.subtitle || '课程展示课件',
      summary: coverPrevious.summary || '建立课程主题、课堂任务和展示基调。',
      narrativeGoal: coverPrevious.narrativeGoal || '快速说明课程主题和课堂价值。',
      keyContent: coverPrevious.keyContent || '1. 课程主题\n2. 课堂任务\n3. 学习价值',
      visual: coverPrevious.visual || '课程封面主视觉',
      layout: coverPrevious.layout || '封面大标题 + 底部信息条',
      moduleId: '',
      needImage: true,
      imageModel: coverPrevious.imageModel || PPT_FIXED_IMAGE_MODEL,
      imageAspect: coverPrevious.imageAspect || imageAspect,
      imageQuality: coverPrevious.imageQuality || imageQuality,
      imagePrompt: coverPrevious.imagePrompt || '',
      imagePath: coverPrevious.imagePath || '',
      imageUrl: coverPrevious.imageUrl || ''
    }, { courseName, template, imageAspect, imageQuality }),
    {
      id: roadmapPrevious.id || 'ppt-roadmap',
      pageKey: '__roadmap__',
      pageNumber: 2,
      pageType: '路线图',
      title: roadmapPrevious.title || '课程路线图',
      subtitle: roadmapPrevious.subtitle || '从导入到成果交付的推进顺序',
      summary: roadmapPrevious.summary || '概览本节课的模块安排和推进逻辑。',
      narrativeGoal: roadmapPrevious.narrativeGoal || '让学生先看到全局。',
      keyContent: roadmapPrevious.keyContent || (
        normalizedModules.length
          ? normalizedModules.map((item, index) => `${index + 1}. ${item.name || `模块${index + 1}`}`).join('\n')
          : contentPages.slice(0, 6).map((item, index) => `${index + 1}. ${item.title}`).join('\n')
      ),
      visual: roadmapPrevious.visual || '流程卡片或路线图',
      layout: roadmapPrevious.layout || '横向路线图',
      moduleId: '',
      needImage: false,
      imageModel: roadmapPrevious.imageModel || PPT_FIXED_IMAGE_MODEL,
      imageAspect: roadmapPrevious.imageAspect || imageAspect,
      imageQuality: roadmapPrevious.imageQuality || imageQuality,
      imagePrompt: roadmapPrevious.imagePrompt || '',
      imagePath: roadmapPrevious.imagePath || '',
      imageUrl: roadmapPrevious.imageUrl || ''
    }
  ];

  const allPages = [...pages, ...contentPages].map((page, index) => ({
    ...page,
    pageNumber: index + 1
  }));

  const hasEnding = allPages.some((page) => page.pageType === '总结');
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

function videoPrompt(courseName, style, script, pptPages) {
  const sections = splitLectureSections(script).filter((s) => !isIgnorableLectureSection(s));
  const opening = sections.find((s) => /开场|导入/.test(stripTimeLabel(s.title))) || sections[0] || null;
  const allModules = sections.filter((s) => /模块/.test(stripTimeLabel(s.title)));
  const closing = sections.find((s) => /总结|收束/.test(stripTimeLabel(s.title))) || sections[sections.length - 1] || null;
  const practice = sections.find((s) => /练习|检查/.test(stripTimeLabel(s.title)));

  const coreTheme = opening ? getSectionSummary(opening) : '本课程的核心教学任务与学习目标';
  const moduleHighlights = allModules.slice(0, 4).map((s) => `${stripTimeLabel(s.title)}：${getSectionSummary(s)}`);
  const closingSummary = closing ? getSectionSummary(closing) : '回顾重点，布置课后任务';

  const getPageImage = (pageType) => {
    const page = toList(pptPages).find((p) => p.pageType === pageType && (p.imagePath || p.imageUrl));
    return page ? (page.imagePath || page.imageUrl || '') : '';
  };
  const coverImage = getPageImage('封面');
  const closingImage = getPageImage('总结收束') || getPageImage('总结');

  const segments = [
    { id: 1, label: '开场引入', time: '0-15秒', content: `课程主题：《${courseName}》。${coreTheme}`, frame: coverImage },
    { id: 2, label: '核心内容A', time: '15-30秒', content: moduleHighlights.slice(0, 2).join('。') || '核心知识点展示', frame: '' },
    { id: 3, label: '核心内容B', time: '30-45秒', content: moduleHighlights.slice(2, 4).join('。') || (practice ? getSectionSummary(practice) : '实践与互动'), frame: '' },
    { id: 4, label: '总结收束', time: '45-60秒', content: closingSummary, frame: closingImage || coverImage }
  ];

  return [
    `<video_brief>`,
    `<title>《${courseName || '课程'}》微课宣传视频</title>`,
    `<core_theme>${coreTheme}</core_theme>`,
    `<duration>60秒</duration>`,
    `<format>16:9，1080p，MP4</format>`,
    `<style>${style || '专业稳重'}，课堂展示感</style>`,
    `</video_brief>`,
    '',
    ...segments.map((seg) => [
      `<segment id="${seg.id}" label="${seg.label}" time="${seg.time}">`,
      `  <content>${seg.content}</content>`,
      seg.frame ? `  <reference_frame>${seg.frame}</reference_frame>` : '  <reference_frame>空白过渡</reference_frame>',
      `  <prompt>[主体] ${seg.content}。[风格] 现代教学宣传片。[运镜] ${seg.id === 1 ? '缓慢推进' : seg.id === 4 ? '缓慢拉远' : '平稳横移'}。</prompt>`,
      `</segment>`
    ].join('\n')),
    '',
    `<music>轻快专业的教学背景音乐，节奏平稳，全程无口播。</music>`,
    `<notes>片段间0.5秒柔和过渡，仅片段1显示课程标题，片段4末尾显示结束画面。</notes>`
  ].join('\n');
}

function getPptPageTaskId(notebookId, pageId) {
  return `${notebookId}-ppt-${pageId}`;
}

module.exports = {
  JIMENG_URL,
  PEXO_URL,
  PEXO_CODE,
  PPT_FIXED_IMAGE_MODEL,
  PPT_TEMPLATE_PRESETS,
  buildSpeakerNotesFromSection,
  buildPptPageImagePrompt,
  buildPptLockedPrompt,
  buildPptTextFramework,
  ensurePptImagePromptForPage,
  buildPptPagesFromLecture,
  normalizeLectureModules,
  getPptPageTaskId,
  videoPrompt
};
