const fs = require('fs');
const path = require('path');
const { postJsonWithRetry } = require('../api/request-utils');

async function postJson(url, apiKey, body) {
  return postJsonWithRetry(url, apiKey, body, { retries: 2 });
}

// ── 信息图布局规格（baoyu-infographic 思路） ────────────────────────────────

const LAYOUT_SPECS = {
  grid_cards: {
    label: '网格卡片',
    spec: '每个知识点一张独立卡片，自动适配列数（≤3点单列，≤6点两列，>6点三列）。每张卡片含图标、标题、说明文字，高度均匀。这是默认通用布局。'
  },
  linear_flow: {
    label: '线性流程',
    spec: '知识点按教学步骤竖向流程排列，每步之间用箭头连接，左侧为步骤编号圆形徽标，右侧为标题和说明。强调操作顺序和先后关系，适合操作步骤、工艺流程类内容。'
  },
  hub_spoke: {
    label: '中心辐射',
    spec: '中央大圆显示模块主题，周围辐射出各知识点子卡片，用连线相连。视觉上强调"从核心到细节"的展开关系。适合概念解释、技能拆解类内容。'
  },
  comparison: {
    label: '对比分析',
    spec: '两列对比布局，左列和右列各一组内容（如传统vs现代、优点vs注意事项）。顶部跨列大标题，中间竖线分隔两列，适合比较、辩证分析类内容。'
  },
  timeline: {
    label: '时间轴',
    spec: '中央竖线时间轴，知识点节点交替显示在左右两侧，圆点标记节点位置。适合历史演变、发展阶段、学习路径类内容。'
  },
  // Phase-8.5：单模块杂志风格——参考用户提供的"如何避免现场补丁"信息图视觉密度
  magazine_module: {
    label: '杂志信息图（模块版）',
    selfContained: true,  // ⚠ 跳过通用强制规范（自己有完整 spec）
    spec: `**杂志信息图风格——单模块版**（参考"现场补丁"信息图视觉密度）

固定 5 层结构，画布宽度 1200px，高度自适应（约 1500-1800px）：

1. **HERO 顶部 banner**（h=180）—— 深蓝渐变（#1E3A8A → #3B82F6），左侧大字"模块 N"+ 模块名，右侧 3 数字徽章（学时 / 知识点数 / 教学方法数）

2. **CORE 核心横条**（h=70）—— 淡黄底（#FEF3C7）+ ⭐ + 一句话模块定位（25 字内）

3. **主体 4 大维度区块**（2×2 网格，每块 540×340，间距 20）：
   - ① 知识点卡片（左上，蓝头 #1E40AF）—— 列出本模块全部知识点，每点带图标 + 简短说明
   - ② 教学方法（右上，绿头 #15803D）—— 流程图样式，列出本模块用到的方法（案例/任务/示范/演练）
   - ③ 学情对接（左下，橙头 #B45309）—— 学生当前水平 + 学完后能力 + 与岗位对应
   - ④ 评价标准（右下，紫头 #6B21A8）—— 课堂表现 / 实操作品 / 互查反馈 三柱图

4. **CHECKLIST 5 步教学进度**（h=140，淡灰底）—— 圆形数字 + 标题：1.导入 → 2.讲授 → 3.实操 → 4.互查 → 5.总结。每步圆色不同（黄/橙/绿/蓝/紫）

5. **GOAL 红色目标横幅**（h=110）—— 红底 #DC2626 + 🎯 + 一句话本模块能力达成（"学完后能..."）

**核心约束**：
- 不允许"模块知识点少 → 区块缩小"，要用更详细的说明填满
- 主体 4 大区块严格 2×2 布局，不允许变 3×1 或单列
- HERO + CORE + GOAL 文字必须基于真实模块数据生成
- 整体视觉密度参照杂志页（不留大空白）`
  },
  // Phase-9 C-2（v2 重写）：整门课教学设计的「内在逻辑闭环」版面
  // 灵感来源：参考"如何避免现场补丁"信息图——每块承担一个【逻辑角色】，块之间有箭头/递进/呼应
  // 不是简单的内容罗列，而是表达教学设计的内在逻辑链
  design_overview: {
    label: '教学设计逻辑闭环（整门课版）',
    selfContained: true,
    spec: `**整门课教学设计「逻辑闭环」信息图**

⚠️ 绝对禁止：
- 出现"模块 N""模块 M01"等模块编号字样
- 把这张图做成"教学设计文档各章节的图形目录"——那毫无附加价值
- 6 个区块做成 2×3 网格（这是简单罗列，没体现逻辑）

✅ 必须做的：
- 6 个区块呈现【教学设计的内在逻辑链】，每块承担一个【逻辑角色】
- 区块之间必须有视觉性的逻辑流动（箭头 / 递进色阶 / 上下呼应）
- 起点（学情诊断）和出口（能力达成）形成首尾呼应
- 看完这张图，老师/听众能秒懂"这门课的内在教学逻辑"

---

## 画布与整体结构

画布固定宽度 1200px，**高度严格 ≤ 1900px**（含 padding，超过会被截断）。
顶部 HERO 标题区，下方按"自上而下逻辑流"6 段排列，最后 GOAL 价值主张横幅收尾。

---

## 6 段逻辑闭环（每段是一个「逻辑功能」，不是「内容章节」）

### ① HERO 价值主张（h=200）—— 抛出价值钩子
深蓝渐变 #1B2E6B → #3B82F6
- 左侧：48px 加粗课程名（白色 800）+ 14px 副标题"整门课教学设计 · 逻辑闭环图"
- 右侧 4 个数字徽章（直径 86px 白圆 + 深蓝数字）：
  - 总学时 / 教学目标条数 / 教学方法数 / 考核项数
- 顶部右上角 12px 小字："学完后能…"（钩子，呼应底部 GOAL）

### ② 学情起点 · 问题诊断（h=180，灰底 #F1F5F9）—— 入口
左侧大字"⚠ 学情起点"+ 右侧两栏：
- 左栏"学生现在的水平"：从课程上下文/学情说明提炼 2-3 句
- 右栏"教学难点"：每条 ⚠ 前缀
**视觉语言**：底部一根灰→深蓝的箭头/导引线，明示"从这里开始"，指向下方 ③

### ③ 教学目标 · 三阶递进（h=300）—— **递进！不是并列**
**关键差异：必须用箭头连接的「知识 → 技能 → 素养」三段，体现认知发展递进**
- 整体一条横向流程，3 段卡片之间用粗箭头 → 连接（不是 3 张并列卡片）
- 左 📚 知识目标（蓝 #1E40AF 头）："学到什么"
- 中 🛠 技能目标（绿 #15803D 头）："能做什么"  ← 注意是从知识到能做
- 右 💡 素养目标（橙 #B45309 头）："养成什么品格"  ← 从能做到品格
- 三段背景色阶递进：浅蓝 → 浅绿 → 浅橙
- 顶部一句导语："认知-能力-品格 三阶递进"

### ④ 学习路径 · 时间流程（h=320）—— **横向流程图，不是表格**
"课前 → 课中（5 段法横向流程）→ 课后"完整学习路径
- 左侧"课前"圆环（黄 #FBBF24，r=44）：列 2-3 项预习任务
- 中间 5 圆环连成横向链条（带 → 箭头）：
  - 导入新课（黄 #FBBF24）→ 知识讲授（橙 #FB923C）→ 实操练习（绿 #22C55E）→ 互查反馈（蓝 #3B82F6）→ 总结升华（紫 #A855F7）
  - 每圆 r=36，圆内白色数字 1-5
  - 圆下方：环节名 + 时长（如"导入 10min"）
- 右侧"课后"圆环（深紫 #6B21A8）：列作业 / 反馈机制
- 流程下方一行教学方法标签 chip（彩色椭圆 + 方法名）—— 不是单独区块，是悬挂在流程上的工具集

### ⑤ 评价闭环 · 100% 全维度（h=240）—— 强调闭环
- 左侧 4 项考核权重彩色饼图（直径 200，4 色 #0EA5E9 / #22C55E / #F97316 / #A855F7）
- 中央大字"= 100%"（48px 加粗）
- 右侧 4 行权重列表 + 一句话："4 项权重 = 100% 全维度评估"
- 区块底部一句小字："过程性评价为主，终结性评价为辅"

### ⑥ 思政升华 · 价值附加（h=140）—— **附加而非并列**
红底 #DC2626 横幅
- 左大字"🌟 思政元素 +"（强调"+"附加值的语义）
- 右侧横排思政元素徽章（每个椭圆白边 + 白色字）

### 底部 GOAL 横幅（h=120）—— **能力达成出口，呼应起点**
深蓝底 #1B2E6B
- 大字 🎯"学完后能 …"
- 一行字："对接岗位：[jobTargets]，能完成：[课程描述凝练 1 句]"
- **与 ② 学情起点上下呼应**——起点是"学生现在不会 X"，出口是"学完能做 X"

---

## 8 条强制视觉约束（违反任意一条都算未完成）

1. **必须出现 4 处箭头**：② 起点 ↓ ③ 目标 / ③ 目标内部 → / ④ 路径内部 → / ⑤→⑥→ GOAL
2. **目标三阶必须用箭头连接**：知识 → 技能 → 素养（不允许做成 3 张并列卡片）
3. **5 段法必须横向流程链**（不允许表格、不允许 2×3 网格）
4. **首尾呼应**：HERO 抛出"学完后能…"+ 底部 GOAL 回答完整能力出口（用相同/相似句式）
5. **思政元素用"+"号视觉**（强调附加价值，不是另一类内容）
6. **总高度 ≤ 1900px**——AI 必须算好每段高度，不允许超
7. **背景统一**：白底 #FFFFFF / 浅灰底 #F8FAFC，区块边框 1px #E2E8F0，圆角 14px
8. **配色限定**：仅使用 spec 指定的 8-10 种颜色，不允许引入额外色彩

`
  },
};

const STYLE_SPECS = {
  professional: {
    label: '专业正式',
    spec: '深海军蓝（#1B2E6B）主色系，白色卡片背景，精准对齐，线条清晰。适合院校领导汇报、正式教学文档。颜色规范严格按照学校视觉识别系统。'
  },
  minimalist: {
    label: '极简清爽',
    spec: '纯白背景，超细边框（#E5E7EB），大量留白，内容高度聚焦。主色 #18181B，强调色 #6366F1（靛紫），字体对比鲜明。去除一切装饰性元素。'
  },
  tech_blueprint: {
    label: '技术蓝图',
    spec: '深蓝背景（#0F172A），青色（#06B6D4）文字和边框线，模拟工程制图/电路图风格，角落有刻度标尺装饰。适合电子技术、机械制造、自动化等理工类课程。'
  },
  warm_education: {
    label: '温暖教育',
    spec: '米白背景（#FFFBF0），暖橙主色（#F59E0B），圆润大字体，插图感强。亲切活泼，降低视觉压力。适合低年级、素养教育、服务类专业课程。'
  },
  // Phase-8.5：杂志信息图风格（与 LAYOUT_SPECS.magazine_module 配套使用）
  magazine_module: {
    label: '杂志信息图',
    spec: `**杂志风格视觉规范**：

颜色体系（每区块不同主题色）：
- HERO banner：深蓝渐变 #1E3A8A → #3B82F6
- 区块 ① 蓝 #1E40AF（知识点）
- 区块 ② 绿 #15803D（教学方法）
- 区块 ③ 橙 #B45309（学情对接）
- 区块 ④ 紫 #6B21A8（评价标准）
- CORE 横条：淡黄 #FEF3C7 + 边 #F59E0B
- CHECKLIST 横条：淡灰 #F8FAFC + 5 步圆环 黄/橙/绿/蓝/紫
- GOAL 横幅：红 #DC2626

字体：
- HERO 主标题：38px / 800 / 白色
- HERO 数字徽章：48px / 800 / 白色
- 区块标题（彩色 banner 内）：17px / 700 / 白色
- 区块正文：12-13px / normal / #475569
- CORE 文字：14px / 700 / #92400E
- GOAL 主文：22px / 800 / 白色

视觉装饰：
- 每区块顶部 60px 高的彩色 banner + 一个白色圆形数字徽章（直径 40px）
- HERO 右侧 2-3 个浅白色装饰圆（opacity 0.06-0.08）
- 卡片用 cardShadow filter（dy=3, blur=6, 蓝阴影 opacity=0.10）
- 圆角统一 14px（区块）/ 10px（小卡）/ 22px（行动清单圆）

绝不允许：
- 单调灰白配色
- 所有区块同一个颜色
- 文字密集到看不清的"代码块"`
  },
  // Phase-9 C-2 增补：与 LAYOUT_SPECS.design_overview 配套
  design_overview: {
    label: '教学设计概览（专业杂志感）',
    spec: `**整门课教学设计专用视觉风格**：

颜色体系：
- HERO banner：深蓝渐变 #1B2E6B → #3B82F6
- 教学目标三类区块：蓝 #1E40AF（知识）/ 绿 #15803D（技能）/ 橙 #B45309（素养）
- 重难点：红头 #DC2626；教学方法：紫头 #6B21A8
- 5 段法圆环（按顺序）：导入 #FBBF24 / 讲授 #FB923C / 实操 #22C55E / 互查 #3B82F6 / 总结 #A855F7
- CORE 横条：淡黄 #FEF3C7 + 边 #F59E0B
- GOAL 思政横幅：红 #DC2626 底 + 白色字
- 考核饼图：4 色（#0EA5E9 / #22C55E / #F97316 / #A855F7）

字体：
- 课程名（HERO 主标题）：48px / 800 / 白色
- HERO 数字徽章：38px / 800 / 深蓝
- 区块标题（彩色 banner 内）：18px / 700 / 白色
- 区块正文：13-14px / normal / #475569
- CORE 文字：15px / 700 / #92400E
- 5 段法环节名：14px / 600
- 思政元素：14px / 600 / 白色

视觉装饰：
- 每区块顶部 56px 彩色 banner + 圆形 emoji 徽章（直径 38px）
- HERO 右侧 4 个数字徽章（直径 90px 白圆，深蓝数字）
- 卡片 cardShadow filter（dy=3, blur=6, 蓝阴影 opacity=0.10）
- 圆角 14px（区块）/ 10px（小卡）/ 圆形（5 段法圆环 r=32）
- 5 段法时长比例条 h=12 圆角 6px

绝不允许：
- 灰白配色
- HERO 写"模块 N"（这是整门课不是单模块）
- 文字密集到看不清`
  }
};

function sanitizeFileName(value) {
  return String(value || 'infocard')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function extractHtmlCode(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const fenced = raw.match(/```html\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
  const html = fenced ? fenced[1].trim() : raw;
  if (!/<html[\s>]|<!doctype html/i.test(html)) {
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  }
  return html;
}

function replaceVars(input, params) {
  return String(input || '').replace(/\{(\w+)\}/g, (_, key) => {
    const value = params && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : '';
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  });
}

class InfographicCardService {
  constructor(db, appRef) {
    this.db = db;
    this.app = appRef;
    this.arkBaseURL = 'https://ark.cn-beijing.volces.com/api/v3';
    this.deepseekBaseURL = 'https://api.deepseek.com/v1';
  }

  getSkillRoot() {
    return path.join(process.cwd(), 'skills', 'teaching-infocard-html');
  }

  getTemplatePath() {
    return path.join(this.getSkillRoot(), 'references', 'prompt-template.md');
  }

  getDefaultTemplate() {
    return [
      '你是顶尖的教育信息可视化设计师，专为中职院校制作教学展示卡片。',
      '请把下面的教学内容转换为一张适合课堂投影、领导审阅、插入正式文档的 HTML 信息卡。',
      '',
      '===== 课程上下文 =====',
      '课程名称：{course_name}',
      '模块标题：{topic}',
      '{software_context}',
      '{job_context}',
      '视觉风格：{style}',
      '',
      '===== 内容要点 =====',
      '{content}',
      '',
      '===== 设计规范（必须严格遵守）=====',
      '',
      '【画布】',
      '- 固定宽度 1000px，高度 1400px（绝对不超过 1600px）',
      '- 知识点超过 4 条时改用两列网格布局，确保一屏读完',
      '',
      '【结构】按此顺序从上到下排列：',
      '① 顶部色带（60px）：左侧显示课程名称，右侧显示阶段/模块编号',
      '② 主标题区（120px）：模块大标题 + 一句话核心摘要',
      '③ 内容卡片区（填满剩余空间）：每个知识点 1 张卡片',
      '④ 底部提示条（50px）：补充说明或软件提示（若有软件上下文则显示）',
      '',
      '【知识点卡片】每张卡片包含：',
      '- 左侧：SVG 图标或 Unicode 符号（40×40px 圆形背景色块）',
      '- 右侧上：知识点标题（粗体 16px）',
      '- 右侧下：2-3 行简洁说明文字（14px 灰色）',
      '',
      '【配色（不得随意更改）】',
      '- 页面底色：#F8F9FF（极浅蓝白）',
      '- 顶部色带：#1B2E6B（深海蓝）',
      '- 主标题区背景：#EEF2FF，边框左侧 4px 实线 #4F6FE8',
      '- 卡片背景：白色 #FFFFFF，边框 1px #E2E8F0，圆角 12px',
      '- 卡片图标背景色轮换：#EEF2FF / #FEF3C7 / #DCFCE7 / #FCE7F3',
      '- 主色文字：#1B2E6B，正文：#334155，辅助：#64748B',
      '- 底部色带：#1B2E6B（同顶部）',
      '',
      '【字体】',
      '- 全部使用 system-ui, “Microsoft YaHei”, sans-serif',
      '- 顶部课程名：13px 白色',
      '- 主标题：28-32px 粗体 #1B2E6B',
      '- 摘要：15px #475569',
      '- 卡片标题：16px 粗体 #1B2E6B',
      '- 卡片正文：14px #475569，行高 1.6',
      '',
      '【禁止】荧光色、粗糙渐变、表格布局、外部字体/图片链接、高度超过 1600px',
      '',
      '===== 输出要求 =====',
      '只输出完整 HTML 文件（含内联 CSS），不要解释，不要 Markdown 代码块。'
    ].join('\n');
  }

  getPromptTemplate() {
    const templatePath = this.getTemplatePath();
    if (fs.existsSync(templatePath)) {
      return fs.readFileSync(templatePath, 'utf8');
    }
    return this.getDefaultTemplate();
  }

  savePromptTemplate(template) {
    const templatePath = this.getTemplatePath();
    fs.mkdirSync(path.dirname(templatePath), { recursive: true });
    fs.writeFileSync(templatePath, String(template || '').trim(), 'utf8');
    return {
      template: this.getPromptTemplate(),
      path: templatePath
    };
  }

  renderPrompt(params) {
    return replaceVars(this.getPromptTemplate(), params);
  }

  /**
   * 构建增强版 Prompt，支持 layout 和 style 参数注入（baoyu-infographic 思路）
   * @param {Object} params - 基础参数（course_name, topic, content, style 等）
   * @param {string} [params.layout]      - 布局类型 key（默认 grid_cards）
   * @param {string} [params.visualStyle] - 视觉风格 key（默认 professional）
   */
  buildEnhancedPrompt(params) {
    const layoutKey = params.layout || 'grid_cards';
    const styleKey = params.visualStyle || 'professional';
    const layoutSpec = LAYOUT_SPECS[layoutKey] || LAYOUT_SPECS.grid_cards;
    const styleSpec = STYLE_SPECS[styleKey] || STYLE_SPECS.professional;

    // 将布局和风格规格注入到 style 变量中，扩充原有 prompt
    const enhancedParams = {
      ...params,
      style: [
        params.style || '',
        `\n===== 布局规范 =====\n布局类型：${layoutSpec.label}\n${layoutSpec.spec}`,
        `\n===== 视觉风格 =====\n风格：${styleSpec.label}\n${styleSpec.spec}`
      ].filter(Boolean).join('\n')
    };

    return this.renderPrompt(enhancedParams);
  }

  /** 获取可用布局列表 */
  static getLayouts() {
    return Object.entries(LAYOUT_SPECS).map(([key, v]) => ({ key, label: v.label }));
  }

  /** 获取可用风格列表 */
  static getStyles() {
    return Object.entries(STYLE_SPECS).map(([key, v]) => ({ key, label: v.label }));
  }

  /**
   * 根据 layout 和 visualStyle 动态构建 system prompt
   * 替代旧的硬编码固定规则，确保布局/风格参数真正生效
   */
  buildSystemPrompt(layout = 'grid_cards', visualStyle = 'professional') {
    const layoutSpec = LAYOUT_SPECS[layout] || LAYOUT_SPECS.grid_cards;
    const styleSpec = STYLE_SPECS[visualStyle] || STYLE_SPECS.professional;
    // Phase-9 C-2：selfContained layout 自带完整 spec，跳过通用强制规范
    // 避免通用规范里的"右侧模块编号 / 主标题摘要"等硬编码污染整门课版面
    const isSelfContained = Boolean(layoutSpec.selfContained);

    const lines = [
      '你是专业的教育信息可视化设计师，专为中职院校制作教学展示卡片。',
      '产出可直接截图导出为 PNG 的单页 HTML 信息卡（含内联 CSS），只输出 HTML 代码，不加任何解释或 Markdown 代码块。',
      '',
      '===== 必须严格执行的布局方式 =====',
      `布局：${layoutSpec.label}`,
      layoutSpec.spec,
      '',
      '===== 必须严格执行的视觉风格 =====',
      `风格：${styleSpec.label}`,
      styleSpec.spec,
    ];

    if (!isSelfContained) {
      // 仅对没有自带完整 spec 的 layout（grid_cards / linear_flow / hub_spoke / comparison / timeline）施加通用规范
      lines.push('');
      lines.push('===== 通用强制规范 =====');
      lines.push('- 画布固定宽度 1000px，高度自适应但绝对不超过 1600px');
      lines.push('- 字体：system-ui, "Microsoft YaHei", sans-serif，禁止引用外部字体');
      lines.push('- 禁止引用外部图片链接，图标使用 Unicode 符号或内联 SVG');
      lines.push('- 顶部色带（60px）：左侧课程名，右侧模块编号');
      lines.push('- 主标题区（100-120px）：模块大标题 + 一句话摘要');
      lines.push('- 底部提示条（50px）：软件工具提示或补充说明');
      lines.push('- 内容布局严格按上方指定的布局方式渲染，不得使用其他布局');
    } else {
      // selfContained layout 只保留最少的全局约束
      lines.push('');
      lines.push('===== 全局约束（其余以上方布局/风格 spec 为准）=====');
      lines.push('- 字体：system-ui, "Microsoft YaHei", sans-serif，禁止引用外部字体');
      lines.push('- 禁止引用外部图片链接，图标用 Unicode 符号或内联 SVG');
      lines.push('- 不输出解释文字，只输出完整 HTML 代码');
      lines.push('- 严格按上方布局规范的层级结构渲染，不要插入额外的"色带 / 模块编号 / 摘要"层');
    }

    return lines.join('\n');
  }

  async generateHtml({ provider = 'ark', endpointId, promptFinal, layout = 'grid_cards', visualStyle = 'professional' }) {
    const prompt = String(promptFinal || '').trim();
    if (!prompt) {
      throw new Error('信息卡 Prompt 不能为空');
    }

    // 动态构建 system prompt，确保布局/风格优先级最高
    const systemContent = this.buildSystemPrompt(layout, visualStyle);

    if (provider === 'ark') {
      const apiKey = this.db.getApiKey('ark');
      const targetEndpoint =
        endpointId ||
        this.db.getApiKey('ark_endpoint_text') ||
        this.db.getApiKey('ark_endpoint') ||
        this.db.getApiKey('ark_endpoint_text_deepseek');
      if (!apiKey || !targetEndpoint) {
        throw new Error('请先配置 Ark 文本模型 Endpoint');
      }
      const response = await postJson(`${this.arkBaseURL}/chat/completions`, apiKey, {
        model: targetEndpoint,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: prompt }
        ],
        temperature: 0.4,
        // Phase-9 C-2 修正：4000 不够装一个完整的 6 段逻辑闭环 HTML
        // 实测 AI 生成到第 3 段被截断（PNG 只有 1069px 高）
        max_tokens: 12000
      });
      const content = response.choices?.[0]?.message?.content || '';
      return extractHtmlCode(content);
    }

    const apiKey = this.db.getApiKey('deepseek');
    if (!apiKey) {
      throw new Error('请先配置 Deepseek API Key');
    }
    const response = await postJson(`${this.deepseekBaseURL}/chat/completions`, apiKey, {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      max_tokens: 12000
    });
    const content = response.choices?.[0]?.message?.content || '';
    return extractHtmlCode(content);
  }

  saveArtifacts({ html, pngBuffer, title, notebookId }) {
    const outputDir = path.join(this.app.getPath('userData'), 'generated-infocards');
    fs.mkdirSync(outputDir, { recursive: true });
    const stamp = Date.now();
    const base = sanitizeFileName(`${title || 'infocard'}-${stamp}`);
    const htmlPath = path.join(outputDir, `${base}.html`);
    const imagePath = path.join(outputDir, `${base}.png`);
    fs.writeFileSync(htmlPath, html, 'utf8');
    fs.writeFileSync(imagePath, pngBuffer);

    const resource = this.db.createResource({
      notebookId: notebookId || null,
      originalName: path.basename(imagePath),
      name: path.basename(imagePath),
      sourcePath: htmlPath,
      storagePath: imagePath,
      type: 'image',
      size: pngBuffer.length,
      tags: ['AI生成', 'html-infocard', 'structured'],
      stage: 'framework',
      category: '信息图',
      usage: 'framework-infographic'
    });

    return {
      htmlPath,
      imagePath,
      resourceId: resource.id
    };
  }
}

module.exports = {
  InfographicCardService
};
