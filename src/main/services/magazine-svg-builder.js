/**
 * magazine-svg-builder.js — 杂志风格教学结构图 SVG 模板拼装
 *
 * Phase-8.5：替代 AI 直接生成 SVG（成功率 ~30%）的方案
 *   - AI 只负责生成结构化 JSON 数据
 *   - 本模块用 JS 拼装固定 SVG 模板
 *   - 100% 视觉一致 + 100% 输出稳定
 *
 * 设计参考："如何避免 Claude Code 的现场补丁越堆越乱"信息图（蓝色系 / 6 大区块 / 数字 / 流程 / 状态柱）
 *
 * 画布固定 1240×1880，5 层结构：
 *   1. HERO 区（深蓝渐变 banner，h=210）
 *   2. CORE 核心横条（淡黄底，h=80）
 *   3. 主体 6 大教学维度区块（3 列 × 2 行，h=920）
 *   4. CHECKLIST 5 步教学进度横条（h=170）
 *   5. GOAL 红色目标横幅（h=130）
 */

const W = 1240;
const H = 1880;

// ── XML 转义 ─────────────────────────────────────────────────────────────────
function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 截断超长文字
function truncate(text, maxLen) {
  const s = String(text || '');
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

// ── 1. defs ───────────────────────────────────────────────────────────────
function buildDefs() {
  return `<defs>
    <linearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1E3A8A"/>
      <stop offset="100%" stop-color="#3B82F6"/>
    </linearGradient>
    <filter id="cardShadow" x="-5%" y="-5%" width="115%" height="130%">
      <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#1E40AF" flood-opacity="0.10"/>
    </filter>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#94A3B8"/>
    </marker>
  </defs>`;
}

// ── 2. HERO 区（y=0~210） ────────────────────────────────────────────────
function buildHero({ courseName, subtitle, moduleCount, kpCount, totalHours, grade }) {
  const safeName = esc(truncate(courseName, 16));
  const safeSubtitle = esc(truncate(subtitle, 28));
  const safeGrade = esc(truncate(grade || '—', 4));

  return `<g id="hero">
    <rect x="0" y="0" width="${W}" height="210" fill="url(#heroGrad)"/>
    <circle cx="1100" cy="50" r="130" fill="#FFFFFF" opacity="0.08"/>
    <circle cx="1180" cy="190" r="80" fill="#FFFFFF" opacity="0.06"/>
    <text x="60" y="100" font-size="38" font-weight="800" fill="#FFFFFF">${safeName}</text>
    <text x="60" y="140" font-size="18" fill="#DBEAFE">${safeSubtitle}</text>
    <g transform="translate(720, 60)">
      <text x="0" y="50" font-size="52" font-weight="800" fill="#FFFFFF">${moduleCount}</text>
      <text x="0" y="78" font-size="13" fill="#DBEAFE">教学模块</text>
      <text x="120" y="50" font-size="52" font-weight="800" fill="#FFFFFF">${kpCount}</text>
      <text x="120" y="78" font-size="13" fill="#DBEAFE">知识点</text>
      <text x="240" y="50" font-size="52" font-weight="800" fill="#FFFFFF">${totalHours}</text>
      <text x="240" y="78" font-size="13" fill="#DBEAFE">总学时</text>
      <text x="360" y="50" font-size="36" font-weight="800" fill="#FFFFFF">${safeGrade}</text>
      <text x="360" y="78" font-size="13" fill="#DBEAFE">授课对象</text>
    </g>
  </g>`;
}

// ── 3. CORE 核心横条（y=230~310） ────────────────────────────────────────
function buildCore(coreText) {
  const safeCore = esc(truncate(coreText || '掌握专业核心技能，胜任行业岗位需求', 40));
  return `<g id="core">
    <rect x="40" y="230" width="${W - 80}" height="80" rx="12" fill="#FEF3C7" stroke="#F59E0B" stroke-width="2"/>
    <circle cx="80" cy="270" r="22" fill="#F59E0B"/>
    <text x="80" y="278" text-anchor="middle" font-size="22" fill="#FFFFFF">★</text>
    <text x="125" y="265" font-size="15" font-weight="700" fill="#92400E">课程核心定位</text>
    <text x="125" y="290" font-size="14" fill="#78350F">${safeCore}</text>
  </g>`;
}

// ── 4. 区块通用外壳 ──────────────────────────────────────────────────────
function buildSectionShell({ x, y, num, title, color }) {
  return `<rect x="${x}" y="${y}" width="360" height="440" rx="14" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" filter="url(#cardShadow)"/>
    <rect x="${x}" y="${y}" width="360" height="60" rx="14" fill="${color}"/>
    <rect x="${x}" y="${y + 40}" width="360" height="20" fill="${color}"/>
    <circle cx="${x + 40}" cy="${y + 30}" r="20" fill="#FFFFFF"/>
    <text x="${x + 40}" y="${y + 38}" text-anchor="middle" font-size="20" font-weight="800" fill="${color}">${num}</text>
    <text x="${x + 75}" y="${y + 38}" font-size="17" font-weight="700" fill="#FFFFFF">${esc(title)}</text>`;
}

// ── 5. 区块 ① 课程定位与岗位（左上） ─────────────────────────────────────
function buildSection1(data) {
  const x = 40, y = 340;
  const color = '#1E40AF';
  const desc = String((data && data.description) || '掌握课程核心技能，对接行业岗位真实需求');
  const jobs = (data && Array.isArray(data.jobs)) ? data.jobs.slice(0, 4) : [];
  const tools = (data && Array.isArray(data.tools)) ? data.tools.slice(0, 5) : [];

  // 描述按 28 字换行
  const descLines = [];
  let remaining = desc;
  while (remaining.length > 0 && descLines.length < 4) {
    descLines.push(remaining.slice(0, 28));
    remaining = remaining.slice(28);
  }

  let descSvg = '';
  descLines.forEach((line, i) => {
    descSvg += `<tspan x="60" dy="${i === 0 ? 0 : 20}">${esc(line)}</tspan>`;
  });

  // 岗位 chips（每个最多 6 字，自适应宽 = 12 + 字数 × 12 + 12）
  let jobsSvg = '';
  let jobX = 0;
  jobs.forEach((job, i) => {
    const text = truncate(job, 6);
    const chipW = 24 + text.length * 14;
    if (jobX + chipW > 320) return; // 超出区块就跳过
    jobsSvg += `<g transform="translate(${jobX}, 0)">
      <rect x="0" y="0" width="${chipW}" height="26" rx="13" fill="#DBEAFE"/>
      <text x="${chipW / 2}" y="18" text-anchor="middle" font-size="12" fill="${color}">${esc(text)}</text>
    </g>`;
    jobX += chipW + 8;
  });

  // 工具列表
  let toolsSvg = '';
  tools.forEach((tool, i) => {
    if (i >= 5) return;
    toolsSvg += `<tspan x="60" dy="${i === 0 ? 0 : 18}">• ${esc(truncate(tool, 22))}</tspan>`;
  });

  return `<g id="section1">
    ${buildSectionShell({ x, y, num: '1', title: '课程定位与岗位', color })}
    <text x="60" y="${y + 90}" font-size="13" font-weight="700" fill="${color}">[课程描述]</text>
    <text x="60" y="${y + 115}" font-size="12" fill="#475569">${descSvg}</text>
    <text x="60" y="${y + 215}" font-size="13" font-weight="700" fill="${color}">[面向岗位]</text>
    <g transform="translate(60, ${y + 240})">${jobsSvg}</g>
    <text x="60" y="${y + 320}" font-size="13" font-weight="700" fill="${color}">[软件工具]</text>
    <text x="60" y="${y + 345}" font-size="12" fill="#475569">${toolsSvg}</text>
  </g>`;
}

// ── 6. 区块 ② 教学目标三柱（中上） ─────────────────────────────────────
function buildSection2(data) {
  const x = 440, y = 340;
  const color = '#15803D';
  const knowledge = (data && Array.isArray(data.knowledge)) ? data.knowledge.slice(0, 3) : ['—', '—', '—'];
  const skill = (data && Array.isArray(data.skill)) ? data.skill.slice(0, 3) : ['—', '—', '—'];
  const emotion = (data && Array.isArray(data.emotion)) ? data.emotion.slice(0, 3) : ['—', '—', '—'];

  function buildPillar(label, items, fill, headerColor, letter, offsetX) {
    let itemsSvg = '';
    items.forEach((item, i) => {
      itemsSvg += `<tspan x="40" dy="${i === 0 ? 0 : 16}">${esc(truncate(item, 8))}</tspan>`;
    });
    return `<g transform="translate(${x + offsetX}, ${y + 100})">
      <rect x="0" y="0" width="80" height="280" rx="10" fill="${fill}"/>
      <rect x="0" y="0" width="80" height="40" rx="10" fill="${headerColor}"/>
      <rect x="0" y="20" width="80" height="20" fill="${headerColor}"/>
      <text x="40" y="27" text-anchor="middle" font-size="20" font-weight="800" fill="#FFFFFF">${letter}</text>
      <text x="40" y="65" text-anchor="middle" font-size="13" font-weight="700" fill="${headerColor}">${label}</text>
      <text x="40" y="95" text-anchor="middle" font-size="11" fill="#475569">${itemsSvg}</text>
    </g>`;
  }

  return `<g id="section2">
    ${buildSectionShell({ x, y, num: '2', title: '教学目标三柱', color })}
    ${buildPillar('知识', knowledge, '#DBEAFE', '#1E40AF', 'A', 40)}
    ${buildPillar('技能', skill, '#DCFCE7', '#15803D', 'B', 140)}
    ${buildPillar('情感', emotion, '#FED7AA', '#B45309', 'C', 240)}
  </g>`;
}

// ── 7. 区块 ③ 教学模块网格（右上） ─────────────────────────────────────
function buildSection3(modules) {
  const x = 840, y = 340;
  const color = '#B45309';
  const moduleList = Array.isArray(modules) ? modules.slice(0, 6) : [];
  const moreCount = Array.isArray(modules) && modules.length > 6 ? modules.length - 6 : 0;

  // 每个模块占垂直空间，根据数量自适应（最少 60，最多 100）
  const slotH = Math.min(100, Math.max(60, Math.floor(360 / Math.max(1, moduleList.length))));

  let modulesSvg = '';
  moduleList.forEach((m, i) => {
    const py = i * slotH;
    const name = truncate(m.name || `模块${i + 1}`, 12);
    const hours = m.hours || (m.duration && m.duration.replace(/[^\d.]/g, '')) || '—';
    const kps = Array.isArray(m.knowledgePoints) ? m.knowledgePoints.slice(0, 3) : [];
    const kpsLine1 = kps[0] ? `• ${truncate(typeof kps[0] === 'string' ? kps[0] : (kps[0].title || ''), 24)}` : '';
    const kpsLine2 = kps.slice(1).map(kp => {
      const txt = typeof kp === 'string' ? kp : (kp.title || '');
      return truncate(txt, 12);
    }).filter(Boolean).join(' / ');

    modulesSvg += `<g transform="translate(0, ${py})">
      <circle cx="0" cy="10" r="11" fill="${color}"/>
      <text x="0" y="14" text-anchor="middle" font-size="11" font-weight="800" fill="#FFFFFF">${i + 1}</text>
      <text x="22" y="15" font-size="13" font-weight="700" fill="#1E293B">${esc(name)}</text>
      <text x="320" y="15" text-anchor="end" font-size="10" fill="#94A3B8">${hours}h</text>
      <text x="22" y="34" font-size="10" fill="#64748B">${esc(kpsLine1)}</text>
      ${kpsLine2 ? `<text x="22" y="48" font-size="10" fill="#94A3B8">• ${esc(kpsLine2)}</text>` : ''}
    </g>`;
  });

  // 超出 6 模块时，加一行 "+N 更多"
  if (moreCount > 0) {
    const py = moduleList.length * slotH;
    modulesSvg += `<text x="0" y="${py + 15}" font-size="12" font-style="italic" fill="#94A3B8">… 还有 ${moreCount} 个模块（详见框架文档）</text>`;
  }

  return `<g id="section3">
    ${buildSectionShell({ x, y, num: '3', title: `教学模块（${Array.isArray(modules) ? modules.length : 0}）`, color })}
    <g transform="translate(${x + 30}, ${y + 90})">${modulesSvg}</g>
  </g>`;
}

// ── 8. 区块 ④ 教学方法流程图（左下） ─────────────────────────────────
function buildSection4(methods) {
  const x = 40, y = 820;
  const color = '#6B21A8';
  const methodList = Array.isArray(methods) ? methods.slice(0, 4) : [];

  // 4 个方法竖向排列，间距 75px
  let methodsSvg = '';
  methodList.forEach((m, i) => {
    const py = i * 75;
    const name = truncate(m.name || `方法${i + 1}`, 10);
    const desc = truncate(m.desc || '—', 14);
    const icon = m.icon || '•';
    methodsSvg += `<g transform="translate(0, ${py})">
      <circle cx="0" cy="0" r="22" fill="#F3E8FF" stroke="${color}" stroke-width="2"/>
      <text x="0" y="6" text-anchor="middle" font-size="16">${esc(icon)}</text>
      <text x="40" y="0" font-size="14" font-weight="700" fill="#1E293B">${esc(name)}</text>
      <text x="40" y="20" font-size="11" fill="#64748B">${esc(desc)}</text>
      ${i < methodList.length - 1 ? `<line x1="0" y1="22" x2="0" y2="53" stroke="#94A3B8" stroke-width="2" marker-end="url(#arrowhead)"/>` : ''}
    </g>`;
  });

  return `<g id="section4">
    ${buildSectionShell({ x, y, num: '4', title: '教学方法', color })}
    <g transform="translate(${x + 80}, ${y + 130})">${methodsSvg}</g>
  </g>`;
}

// ── 9. 区块 ⑤ 评价设计占比环（中下） ─────────────────────────────────
function buildSection5(data) {
  const x = 440, y = 820;
  const color = '#0E7490';
  const process = (data && data.process) || 60;
  const summative = (data && data.summative) || (100 - process);
  const processItems = (data && Array.isArray(data.processItems)) ? data.processItems.slice(0, 3) : [];
  const summativeItems = (data && Array.isArray(data.summativeItems)) ? data.summativeItems.slice(0, 2) : [];

  // 环形图：60% 弧 = 60 / 100 × 2π × r = 0.6 × 502.6 ≈ 301.6
  const r = 80;
  const circumference = 2 * Math.PI * r;
  const processArc = (process / 100) * circumference;

  return `<g id="section5">
    ${buildSectionShell({ x, y, num: '5', title: '评价设计', color })}
    <g transform="translate(${x + 180}, ${y + 200})">
      <circle cx="0" cy="0" r="${r}" fill="none" stroke="#E2E8F0" stroke-width="20"/>
      <circle cx="0" cy="0" r="${r}" fill="none" stroke="${color}" stroke-width="20"
              stroke-dasharray="${processArc.toFixed(1)} ${circumference.toFixed(1)}"
              transform="rotate(-90)"/>
      <text x="0" y="-5" text-anchor="middle" font-size="36" font-weight="800" fill="${color}">${process}%</text>
      <text x="0" y="20" text-anchor="middle" font-size="11" fill="#475569">过程性</text>
    </g>
    <g transform="translate(${x + 30}, ${y + 360})">
      <rect x="0" y="0" width="14" height="14" fill="${color}"/>
      <text x="22" y="12" font-size="11" fill="#1E293B">过程性 ${process}% — ${esc(truncate(processItems.join(' / '), 24))}</text>
      <rect x="0" y="22" width="14" height="14" fill="#E2E8F0"/>
      <text x="22" y="34" font-size="11" fill="#1E293B">终结性 ${summative}% — ${esc(truncate(summativeItems.join(' / '), 24))}</text>
    </g>
  </g>`;
}

// ── 10. 区块 ⑥ 教材与资源（右下） ────────────────────────────────────
function buildSection6(resources) {
  const x = 840, y = 820;
  const color = '#B91C1C';
  const list = Array.isArray(resources) ? resources.slice(0, 4) : [];

  // 2×2 网格，每张小卡 155×140
  let cardsSvg = '';
  list.forEach((r, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = col * 165;
    const cy = row * 150;
    const icon = r.icon || '◆';
    const type = truncate(r.type || '资源', 6);
    const name = truncate(r.name || '—', 10);
    cardsSvg += `<g transform="translate(${cx}, ${cy})">
      <rect x="0" y="0" width="155" height="140" rx="10" fill="#FEE2E2"/>
      <text x="77" y="55" text-anchor="middle" font-size="34">${esc(icon)}</text>
      <text x="77" y="92" text-anchor="middle" font-size="12" font-weight="700" fill="#991B1B">${esc(type)}</text>
      <text x="77" y="115" text-anchor="middle" font-size="10" fill="#7F1D1D">${esc(name)}</text>
    </g>`;
  });

  return `<g id="section6">
    ${buildSectionShell({ x, y, num: '6', title: '教材与资源', color })}
    <g transform="translate(${x + 20}, ${y + 90})">${cardsSvg}</g>
  </g>`;
}

// ── 11. CHECKLIST 5 步教学进度（y=1300~1470） ───────────────────────────
function buildChecklist() {
  const y = 1300;
  const steps = [
    { label: '导入新课', color: '#FBBF24' },
    { label: '知识讲授', color: '#F97316' },
    { label: '实操练习', color: '#10B981' },
    { label: '互查反馈', color: '#3B82F6' },
    { label: '总结升华', color: '#8B5CF6' },
  ];
  const stepGap = 200;
  const startX = 80;

  let stepsSvg = '';
  steps.forEach((s, i) => {
    const cx = startX + i * stepGap;
    stepsSvg += `<g transform="translate(${cx}, 50)">
      <circle cx="0" cy="0" r="28" fill="${s.color}"/>
      <text x="0" y="8" text-anchor="middle" font-size="20" font-weight="800" fill="#FFFFFF">${i + 1}</text>
      <text x="0" y="55" text-anchor="middle" font-size="13" font-weight="600" fill="#1E293B">${s.label}</text>
    </g>`;
  });

  return `<g id="checklist">
    <rect x="40" y="${y}" width="${W - 80}" height="170" rx="14" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>
    <text x="80" y="${y + 35}" font-size="18" font-weight="700" fill="#1E40AF">[标准教学进度（5 步落地）]</text>
    <g transform="translate(0, ${y + 50})">${stepsSvg}</g>
  </g>`;
}

// ── 12. GOAL 红色目标横幅（y=1490~1620） ────────────────────────────────
function buildGoal(goalText) {
  const y = 1490;
  const safeGoal = esc(truncate(goalText || '掌握专业核心技能，胜任行业岗位需求', 50));
  return `<g id="goal">
    <rect x="0" y="${y}" width="${W}" height="130" fill="#DC2626"/>
    <circle cx="80" cy="${y + 65}" r="40" fill="#FFFFFF" opacity="0.2"/>
    <text x="80" y="${y + 78}" text-anchor="middle" font-size="40" fill="#FFFFFF">★</text>
    <text x="160" y="${y + 50}" font-size="24" font-weight="800" fill="#FFFFFF">最终目标</text>
    <text x="160" y="${y + 92}" font-size="16" fill="#FECACA">${safeGoal}</text>
  </g>`;
}

// ── 主入口：拼装完整 SVG ─────────────────────────────────────────────
/**
 * @param {Object} params
 * @param {string} params.courseName        - 课程名（来自数据库）
 * @param {Array}  params.modules           - 教学模块数组（来自数据库，含 name/hours/knowledgePoints）
 * @param {string} params.grade             - 授课对象（如「二年级」）
 * @param {Object} params.aiData            - AI 返回的 JSON 数据
 *   @param {string} aiData.courseSubtitle
 *   @param {string} aiData.core
 *   @param {Object} aiData.definitionAndJob { description, jobs[], tools[] }
 *   @param {Object} aiData.objectives       { knowledge[], skill[], emotion[] }
 *   @param {Array}  aiData.methods          [{ icon, name, desc }]
 *   @param {Object} aiData.evaluation       { process, summative, processItems[], summativeItems[] }
 *   @param {Array}  aiData.resources        [{ icon, type, name }]
 *   @param {string} aiData.goal
 * @returns {string} 完整 SVG 字符串
 */
function buildMagazineSvg({ courseName, modules, grade, aiData }) {
  const moduleList = Array.isArray(modules) ? modules : [];
  const moduleCount = moduleList.length;
  const kpCount = moduleList.reduce((sum, m) => {
    return sum + (Array.isArray(m.knowledgePoints) ? m.knowledgePoints.length : 0);
  }, 0);
  const totalHours = moduleList.reduce((sum, m) => {
    const h = parseFloat(m.hours || (m.duration && String(m.duration).replace(/[^\d.]/g, ''))) || 0;
    return sum + h;
  }, 0);

  const data = aiData || {};

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Microsoft YaHei','PingFang SC',system-ui,sans-serif">
${buildDefs()}
<rect width="${W}" height="${H}" fill="#F0F4F8"/>
${buildHero({
  courseName: courseName || '课程',
  subtitle: data.courseSubtitle || '职业教育课程框架可视化总览',
  moduleCount,
  kpCount,
  totalHours: totalHours || '—',
  grade: grade || '—',
})}
${buildCore(data.core)}
${buildSection1(data.definitionAndJob)}
${buildSection2(data.objectives)}
${buildSection3(moduleList)}
${buildSection4(data.methods)}
${buildSection5(data.evaluation)}
${buildSection6(data.resources)}
${buildChecklist()}
${buildGoal(data.goal)}
</svg>`;
}

module.exports = { buildMagazineSvg };
