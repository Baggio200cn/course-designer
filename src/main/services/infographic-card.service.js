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
  }
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

    return [
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
      '',
      '===== 通用强制规范 =====',
      '- 画布固定宽度 1000px，高度自适应但绝对不超过 1600px',
      '- 字体：system-ui, "Microsoft YaHei", sans-serif，禁止引用外部字体',
      '- 禁止引用外部图片链接，图标使用 Unicode 符号或内联 SVG',
      '- 顶部色带（60px）：左侧课程名，右侧模块编号',
      '- 主标题区（100-120px）：模块大标题 + 一句话摘要',
      '- 底部提示条（50px）：软件工具提示或补充说明',
      '- 内容布局严格按上方指定的布局方式渲染，不得使用其他布局'
    ].join('\n');
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
        max_tokens: 4000
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
      max_tokens: 4000
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
