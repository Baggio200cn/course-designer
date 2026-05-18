/**
 * diagram.service.js — SVG 教学结构图生成服务（baoyu-diagram 思路移植）
 *
 * 职责：
 *   接收课程模块结构，调用 AI 生成精准 SVG 矢量教学结构图
 *   支持 hierarchy / flowchart / mindmap / timeline 四种图表类型
 *
 * 约束：
 *   - 使用 prompts/diagram.md 作为 system prompt（符合 H5）
 *   - 不修改 quality.js / contracts.js（符合 H1/H3）
 *   - 单文件服务，无副作用，可独立测试
 */

const fs = require('fs');
const path = require('path');
// P1.4 删除（2026-05-17）：magazine-svg-builder.js 已下线（完全放权 AI 自决 SVG）
// 同时 generateMagazineDiagram 函数（半模板半 AI 路径）也整段删除

const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

/**
 * 从 AI 输出中提取 SVG 代码
 */
function extractSvgCode(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI 返回内容为空');

  // 去除 markdown 代码块包裹
  const fenced = raw.match(/```(?:svg|xml|html)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  const svgStart = candidate.indexOf('<svg');
  const svgEnd = candidate.lastIndexOf('</svg>');
  if (svgStart < 0 || svgEnd < 0) {
    throw new Error('AI 未返回有效的 SVG 代码（缺少 <svg>…</svg> 结构）');
  }
  return sanitizeSvg(candidate.slice(svgStart, svgEnd + 6));
}

/**
 * 2026-05-17 v4.2.0：sanitize AI 输出的 SVG，修复常见 XML 实体错误
 * AI 在 <text> 中常写 "A & B" / "<5%" / ">10" 等没转义的 &/</>，导致 sharp/浏览器无法解析。
 */
function sanitizeSvg(svg) {
  let s = String(svg || '');

  // 把 <text>...</text> / <tspan>...</tspan> 里的 & 转义（不影响 entity 已转义的 &amp; / &#x2026; 等）
  s = s.replace(/(<(?:text|tspan|title|desc)[^>]*>)([\s\S]*?)(<\/(?:text|tspan|title|desc)>)/g, (m, open, body, close) => {
    const fixed = body
      .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')   // 裸 & → &amp;
      .replace(/<(?!\/?[a-z])/gi, '&lt;')                                          // 裸 < → &lt;（不影响 tag 起始）
      .replace(/>(?=[^<]*<\/(?:text|tspan|title|desc)>)/g, '');                    // 处理后再 trim
    return open + fixed + close;
  });

  // 兜底：整个 SVG 中所有"裸 &"（非 entity）转义
  s = s.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

  return s;
}

/**
 * 将模块结构格式化为提示词文本
 */
function buildModulesSummary(modules) {
  if (!Array.isArray(modules) || modules.length === 0) {
    return '（暂无模块信息）';
  }
  return modules.map((m, i) => {
    const name = m.name || `模块${i + 1}`;
    const kps = Array.isArray(m.knowledgePoints) && m.knowledgePoints.length
      ? m.knowledgePoints.slice(0, 8).map((kp) => {
          const kpName = typeof kp === 'string' ? kp : (kp.title || kp.name || '');
          return `  - ${kpName}`;
        }).join('\n')
      : '';
    const isCore = m.isCore ? '（核心模块）' : '';
    return `模块${i + 1}${isCore}：${name}${kps ? '\n' + kps : ''}`;
  }).join('\n\n');
}

/**
 * 生成 SVG 教学结构图
 *
 * @param {Object} params
 * @param {Object}   params.aiClient      - AI 客户端（需有 chatJson 方法）
 * @param {Array}    params.modules       - 教学模块数组（含 knowledgePoints）
 * @param {string}   params.courseName    - 课程名称
 * @param {string}   [params.diagramType] - 图表类型：hierarchy | flowchart | mindmap | timeline | magazine
 * @param {string}   [params.outputDir]   - SVG 文件保存目录（不传则不保存文件）
 *
 * @returns {Promise<{ svg: string, svgPath: string, diagramType: string }>}
 */
async function generateDiagram({ aiClient, modules, courseName, diagramType = 'hierarchy', outputDir, courseContext = {}, design = null }) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    throw new Error('未提供有效的 AI 客户端');
  }

  // 2026-05-17 v4.2.0：magazine 不再走 JS 模板拼装，与其它类型统一由 AI 自主生成 SVG
  // 老的 generateMagazineDiagram 路径已废弃（保留函数体作 deprecated 备份，但不再被调用）

  const systemPrompt = loadPrompt('diagram');
  const modulesSummary = buildModulesSummary(modules);

  const typeDescriptions = {
    hierarchy: '层次结构图（根节点→模块→知识点，树形向下展开，各层水平居中对齐）',
    flowchart: '教学流程图（各模块按教学顺序从上到下排列，步骤间用箭头连接）',
    mindmap: '思维导图（以课程名称为中心圆，各模块均匀辐射分布，知识点在模块外侧）',
    timeline: '学习时间轴（中央横轴，各模块按顺序交替显示在轴线上下两侧）'
  };

  // 2026-05-15 老师反馈 4.4：信息图总时长随机变化——根因是 userPrompt 完全没传学时数据。
  // 注入 courseContext 里的 totalHours / theoryHours / practiceHours，并在 prompt 加铁律
  // "禁止编造任何学时/时长数字，必须从上下文取"。
  const hoursLines = [];
  const totalH = Number(courseContext.totalHours) || 0;
  const theoryH = Number(courseContext.theoryHours) || 0;
  const practiceH = Number(courseContext.practiceHours) || 0;
  const examH = Number(courseContext.examHours) || 0;
  if (totalH > 0) hoursLines.push(`总学时：${totalH}`);
  if (theoryH > 0) hoursLines.push(`理论学时：${theoryH}`);
  if (practiceH > 0) hoursLines.push(`实践学时：${practiceH}`);
  if (examH > 0) hoursLines.push(`考核学时：${examH}`);

  // 2026-05-17 v4.2.0：注入完整 design 数据让 AI 用真实内容（禁止默认模板）
  const designBlock = (() => {
    if (!design || typeof design !== 'object') return '';
    const lines = ['## 本节课教学设计完整内容（必须使用这些真实数据，禁止编造）', ''];
    if (design.lessonMeta) {
      const lm = design.lessonMeta;
      lines.push(`### 节课元信息`);
      lines.push(`- 节课编号：第 ${lm.lessonNumber || '?'} 节`);
      lines.push(`- 节课主题：${lm.topic || '?'}`);
      lines.push(`- 学时：理论 ${lm.theoryHours || 0} + 实践 ${lm.practiceHours || 0} = ${(Number(lm.theoryHours) || 0) + (Number(lm.practiceHours) || 0)} 节`);
      if (lm.chapter) lines.push(`- 章节：${lm.chapter}`);
    }
    const obj = design.teachingObjectives || {};
    if ((obj.knowledge || []).length || (obj.skill || []).length || (obj.emotion || []).length) {
      lines.push('', '### 教学目标三维');
      if ((obj.knowledge || []).length) lines.push(`- 知识：${obj.knowledge.join(' / ')}`);
      if ((obj.skill || []).length) lines.push(`- 技能：${obj.skill.join(' / ')}`);
      if ((obj.emotion || []).length) lines.push(`- 素养：${obj.emotion.join(' / ')}`);
    }
    if ((design.keyPoints || []).length) {
      lines.push('', '### 教学重点');
      design.keyPoints.forEach((kp, i) => lines.push(`- ${i + 1}. ${kp}`));
    }
    if ((design.difficulties || []).length) {
      lines.push('', '### 教学难点');
      design.difficulties.forEach((d, i) => lines.push(`- ${i + 1}. ${d}`));
    }
    if (Array.isArray(design.teachingMethods) && design.teachingMethods.length) {
      lines.push('', '### 教学方法（必须用这些真实名字）');
      design.teachingMethods.forEach((m, i) => {
        const desc = m.desc || m.applicable || '';
        lines.push(`- ${i + 1}. ${m.name || ''}${desc ? '：' + desc : ''}`);
      });
    }
    const phases = design.inClass?.phases || [];
    if (phases.length) {
      lines.push('', '### 5 段法节奏（必须用真实 phase 名 + duration）');
      phases.forEach((p, i) => {
        lines.push(`- 第 ${i + 1} 段：${p.phase || '?'}（${p.duration || '?'}）`);
      });
    }
    const assessComps = design.assessment?.components || [];
    if (assessComps.length) {
      lines.push('', '### 考核组成（占比必须用真实 weight）');
      const totalW = assessComps.reduce((s, c) => s + (Number(c.weight) || 0), 0);
      assessComps.forEach((c, i) => {
        lines.push(`- ${c.name || '?'}：**${c.weight || 0}%**${c.criteria || c.desc ? '（' + (c.criteria || c.desc).slice(0, 40) + '）' : ''}`);
      });
      lines.push(`- 合计：${totalW}%`);
    }
    if ((design.ideologicalElements || []).length) {
      lines.push('', '### 思政元素');
      design.ideologicalElements.forEach((e, i) => lines.push(`- ${i + 1}. ${e}`));
    }
    return lines.join('\n');
  })();

  const userPrompt = [
    `## 课程名称`,
    courseName || '课程',
    '',
    `## 图表类型`,
    typeDescriptions[diagramType] || typeDescriptions.hierarchy,
    '',
    hoursLines.length ? `## 课程学时（必须以此为准，禁止编造）` : '',
    hoursLines.length ? hoursLines.join('\n') : '',
    '',
    designBlock,    // 2026-05-17 v4.2.0：完整 design 注入（含 7 维度真实数据）
    '',
    designBlock ? '' : `## 课程模块结构（共 ${(modules || []).length} 个模块）`,
    designBlock ? '' : modulesSummary,
    '',
    '## 🚨 数据真实性铁律（违反视为生成失败）',
    '- 凡数字（学时/时长/周数/考核占比）→ 严格用上文真实数字',
    '- 教学方法名/教学目标内容/重难点 → 严格用上文 design 字段',
    '- design 没提供的字段 → 在 SVG 中省略对应区块，禁止凭空补占位（如默认"60% 过程性""ABC 三柱"）',
  ].filter(Boolean).join('\n');

  const rawText = await aiClient.chatJson({
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxTokens: 12000   // 2026-05-17：magazine 高密度信息图 SVG 可能 5-10KB，token 需提高
  });

  const svg = extractSvgCode(rawText);

  // 保存 SVG 文件
  let svgPath = '';
  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    const stamp = Date.now();
    svgPath = path.join(outputDir, `diagram-${diagramType}-${stamp}.svg`);
    fs.writeFileSync(svgPath, svg, 'utf8');
    console.log(`[diagram.service] SVG 已保存：${svgPath}`);
  }

  console.log(`[diagram.service] 生成 ${diagramType} 图完成，SVG ${svg.length} 字符`);
  return { svg, svgPath, diagramType };
}

// P1.4 删除（2026-05-17）：generateMagazineDiagram（半模板半 AI 路径）整段下线
// 所有 diagram 类型（含 magazine）统一走上方 generateDiagram 的 AI 自决 SVG 路径
// 老函数体保留供历史参考，但不再被任何入口调用
async function _legacyGenerateMagazineDiagramDeleted({ aiClient, modules, courseName, courseContext, outputDir }) {
  const systemPrompt = loadPrompt('diagram');
  const modulesSummary = buildModulesSummary(modules);

  // 把课程上下文信息提供给 AI（用于生成 description / jobs / tools / goal 等）
  const contextLines = [];
  if (courseContext.description) contextLines.push(`课程描述：${courseContext.description}`);
  if (courseContext.softwareTools) contextLines.push(`软件工具：${courseContext.softwareTools}`);
  if (courseContext.jobTargets) contextLines.push(`目标岗位：${courseContext.jobTargets}`);
  if (courseContext.industryScenarios) contextLines.push(`行业场景：${courseContext.industryScenarios}`);
  if (courseContext.learnerProfile) contextLines.push(`学情说明：${courseContext.learnerProfile}`);
  if (courseContext.teachingMaterials) contextLines.push(`教材课标：${courseContext.teachingMaterials}`);
  if (courseContext.objectives) contextLines.push(`教学目标：${courseContext.objectives}`);
  // 2026-05-15 老师反馈 4.4：学时数据必须 grounding，magazine 路径也加注入
  if (Number(courseContext.totalHours) > 0) contextLines.push(`总学时：${Number(courseContext.totalHours)}（必须以此为准，禁止编造）`);
  if (Number(courseContext.theoryHours) > 0) contextLines.push(`理论学时：${Number(courseContext.theoryHours)}`);
  if (Number(courseContext.practiceHours) > 0) contextLines.push(`实践学时：${Number(courseContext.practiceHours)}`);

  const userPrompt = [
    `## 课程名称`,
    courseName || '课程',
    '',
    `## 图表类型`,
    'magazine（杂志信息图风格——只输出 JSON，不输出 SVG）',
    '',
    `## 课程上下文`,
    contextLines.length > 0 ? contextLines.join('\n') : '（无具体上下文，请基于通用职业教育场景生成）',
    '',
    `## 课程模块结构（共 ${(modules || []).length} 个模块，仅供 AI 理解课程内容用，模块数据 JS 端会直接读，无需返回 modules 字段）`,
    modulesSummary,
    '',
    `## 严格遵守输出要求`,
    '只返回 JSON 对象，以 { 开头，以 } 结尾，必须能被 JSON.parse() 正确解析。',
    '',
    `## 数据真实性约束（2026-05-15 加固）`,
    '- 凡是要写"总学时""理论学时""实践学时""时长""周数"等数字',
    '  → 严格使用上文"课程上下文"提供的真实数字',
    '  → 上文未提供时，留空或省略，禁止编造（如"72 学时""18 周"这种凭空数据）',
  ].join('\n');

  console.log('[diagram.service] magazine 类型：调 AI 生成 JSON…');
  const rawText = await aiClient.chatJson({
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxTokens: 3000   // JSON 只需 ~1500 tokens 就够
  });

  // 解析 AI 返回的 JSON
  let aiData;
  try {
    // 容错：去掉可能的 markdown 代码块包裹
    const cleaned = String(rawText || '').trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    aiData = JSON.parse(cleaned);
  } catch (e) {
    console.error('[diagram.service] AI 返回非合法 JSON，原文前 200 字：', String(rawText || '').slice(0, 200));
    throw new Error(`AI 未返回有效 JSON：${e.message}`);
  }

  // P1.4 删除：buildMagazineSvg 已下线 → 函数永不到达此处（_legacyGenerateMagazineDiagramDeleted 不被调）
  const svg = '<!-- magazine svg deprecated -->';

  // 保存 SVG 文件
  let svgPath = '';
  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    const stamp = Date.now();
    svgPath = path.join(outputDir, `diagram-magazine-${stamp}.svg`);
    fs.writeFileSync(svgPath, svg, 'utf8');
    console.log(`[diagram.service] magazine SVG 已保存：${svgPath}`);
  }

  console.log(`[diagram.service] 生成 magazine 图完成，SVG ${svg.length} 字符（半模板半 AI 路径）`);
  return { svg, svgPath, diagramType: 'magazine', aiData };
}

module.exports = { generateDiagram };
