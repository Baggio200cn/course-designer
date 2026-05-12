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
const { buildMagazineSvg } = require('./magazine-svg-builder');

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
  return candidate.slice(svgStart, svgEnd + 6);
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
async function generateDiagram({ aiClient, modules, courseName, diagramType = 'hierarchy', outputDir, courseContext = {} }) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    throw new Error('未提供有效的 AI 客户端');
  }

  // ── 杂志风格走单独路径：AI 只生成 JSON，JS 拼装 SVG ─────────────────────
  // Phase-8.5：替代"AI 直接生成 SVG"（成功率 ~30%）
  if (diagramType === 'magazine') {
    return generateMagazineDiagram({ aiClient, modules, courseName, courseContext, outputDir });
  }

  // ── 其他类型走原 AI 生成 SVG 路径 ─────────────────────────────────────
  const systemPrompt = loadPrompt('diagram');
  const modulesSummary = buildModulesSummary(modules);

  const typeDescriptions = {
    hierarchy: '层次结构图（根节点→模块→知识点，树形向下展开，各层水平居中对齐）',
    flowchart: '教学流程图（各模块按教学顺序从上到下排列，步骤间用箭头连接）',
    mindmap: '思维导图（以课程名称为中心圆，各模块均匀辐射分布，知识点在模块外侧）',
    timeline: '学习时间轴（中央横轴，各模块按顺序交替显示在轴线上下两侧）'
  };

  const userPrompt = [
    `## 课程名称`,
    courseName || '课程',
    '',
    `## 图表类型`,
    typeDescriptions[diagramType] || typeDescriptions.hierarchy,
    '',
    `## 课程模块结构（共 ${(modules || []).length} 个模块）`,
    modulesSummary
  ].join('\n');

  const rawText = await aiClient.chatJson({
    systemPrompt,
    userPrompt,
    temperature: 0.1,
    maxTokens: 6000
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

// ── Magazine 专用路径：AI 生成 JSON → JS 拼装 SVG ───────────────────────
async function generateMagazineDiagram({ aiClient, modules, courseName, courseContext, outputDir }) {
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
    '只返回 JSON 对象，以 { 开头，以 } 结尾，必须能被 JSON.parse() 正确解析。'
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

  // 用 JS 模板拼装 SVG（100% 成功）
  const svg = buildMagazineSvg({
    courseName: courseName || '课程',
    modules: modules || [],
    grade: courseContext.grade || courseContext.audience || '',
    aiData
  });

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
