/**
 * knowledge-cards-interactive.js — 互动式知识点卡片 HTML 导出（Phase-7 B4）
 *
 * 与 knowledge-cards.js 静态版的区别：
 *   - 翻卡（Flip Card）：点击卡片正面 → 翻转显示背面详情
 *   - 学习标记：每卡"我学会了"按钮 → LocalStorage 持久化
 *   - 进度追踪：顶部实时进度条 + 模块小指示
 *   - 自检小测：每模块结尾 3 道题（多选 + 自评 + 反思）
 *   - 全部学完触发庆祝动画
 *   - 重置进度按钮
 *
 * 技术约束：
 *   - 纯单 HTML 文件输出，无外部依赖
 *   - 仅 HTML5 + 内联 CSS + 内联 JS
 *   - LocalStorage key 形式：`kc-{notebookId}-{kpId}` / `kc-{notebookId}-{moduleId}-quiz`
 *   - 兼容 Chrome/Edge/Firefox 现代浏览器
 *
 * 单文件不超过 600 行（CLAUDE.md 第七节）
 */

const fs = require('fs');
const path = require('path');

/** HTML 转义 */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** JS 字符串字面量转义（用于内联 JS 数据） */
function jsStr(str) {
  return JSON.stringify(String(str || ''));
}

/** 模块色调（每模块独立渐变） */
const MODULE_GRADIENTS = [
  { from: '#667EEA', to: '#764BA2' },     // 紫蓝
  { from: '#F093FB', to: '#F5576C' },     // 粉红
  { from: '#4FACFE', to: '#00F2FE' },     // 青蓝
  { from: '#43E97B', to: '#38F9D7' },     // 翠绿
  { from: '#FA709A', to: '#FEE140' },     // 橙粉
  { from: '#A8EDEA', to: '#FED6E3' },     // 薄荷
  { from: '#FF9A9E', to: '#FAD0C4' },     // 桃粉
];

/** 清理知识点文字（去序号/前缀） */
function cleanKpText(text) {
  return String(text || '')
    .replace(/^[\d①②③④⑤⑥⑦⑧⑨⑩]+[\.、）)]?\s*/, '')
    .replace(/^[一二三四五六七八九十]+[\.、）)]?\s*/, '')
    .trim();
}

/** 把知识点拆为"标题 + 详解"两部分（启发式） */
function splitKpForFlip(text) {
  const cleaned = cleanKpText(text);
  // 形如"标题：详解"或"标题，详解"
  const match = cleaned.match(/^(.+?)[：:，,。](.+)$/);
  if (match && match[1].length <= 20 && match[2].length > 5) {
    return { title: match[1].trim(), detail: match[2].trim() };
  }
  // 形如较长一句话——切前 14 字作标题，全文作详解
  if (cleaned.length > 18) {
    return { title: cleaned.slice(0, 14) + '…', detail: cleaned };
  }
  return { title: cleaned, detail: '点击卡片查看更多教学说明（建议教师在课堂上展开讲解）' };
}

/** 构造模块自检测验题（启发式生成 3 题） */
function buildQuizQuestions(moduleData, allModules) {
  const kps = (moduleData.knowledgePoints || []).map(cleanKpText).filter(Boolean);
  if (kps.length === 0) return [];

  const correctKps = kps.slice(0, 3);
  // 干扰项：从其他模块取 2-3 个知识点
  const distractors = [];
  for (const m of allModules) {
    if (m === moduleData) continue;
    for (const kp of (m.knowledgePoints || []).map(cleanKpText)) {
      if (kp && !correctKps.includes(kp)) distractors.push(kp);
      if (distractors.length >= 3) break;
    }
    if (distractors.length >= 3) break;
  }

  return [
    {
      type: 'multi_select',
      stem: `本模块「${moduleData.name || '当前模块'}」包含以下哪些知识点？（多选）`,
      options: [...correctKps, ...distractors.slice(0, 2)]
        .map((kp, idx) => ({ text: kp, correct: correctKps.includes(kp), id: `q1-opt-${idx}` })),
    },
    {
      type: 'self_rating',
      stem: '完成本模块的学习后，你对核心知识点的掌握程度？',
      scale: [1, 2, 3, 4, 5],
      labels: ['完全不会', '听过但不懂', '能复述', '能操作', '能教别人'],
    },
    {
      type: 'reflection',
      stem: '用一句话描述：本模块对你日后岗位工作最有用的一点是什么？',
      placeholder: '例如：学会了使用钢笔工具精确抠出复杂边缘…',
    },
  ];
}

// ─── HTML 模板构造 ─────────────────────────────────────
function buildInteractiveHtml({ notebook, modules }) {
  const courseName = esc(notebook?.name || '未命名课程');
  const notebookId = esc(String(notebook?.id || 'unknown'));
  const totalKps = modules.reduce((sum, m) => sum + ((m.knowledgePoints || []).length), 0);
  const now = new Date().toISOString().slice(0, 10);

  const moduleBlocks = modules.map((mod, mIdx) => {
    const grad = MODULE_GRADIENTS[mIdx % MODULE_GRADIENTS.length];
    const kps = (mod.knowledgePoints || []).filter(Boolean);
    const moduleId = `m${mIdx}`;

    const cards = kps.map((kpRaw, kIdx) => {
      const kp = splitKpForFlip(kpRaw);
      const kpId = `${moduleId}-k${kIdx}`;
      return `
      <div class="flip-card" data-kp-id="${kpId}" tabindex="0" role="button" aria-pressed="false">
        <div class="flip-card-inner">
          <div class="flip-card-front" style="background: linear-gradient(135deg, ${grad.from}, ${grad.to});">
            <span class="kp-num">${String(kIdx + 1).padStart(2, '0')}</span>
            <h3 class="kp-title">${esc(kp.title)}</h3>
            <span class="flip-hint">点击翻转 →</span>
          </div>
          <div class="flip-card-back">
            <h4>📖 详解</h4>
            <p>${esc(kp.detail)}</p>
            <button class="mark-learned-btn" data-kp-id="${kpId}">✓ 我学会了</button>
            <span class="learned-badge" data-kp-id="${kpId}">已掌握</span>
          </div>
        </div>
      </div>`;
    }).join('\n');

    const quizQuestions = buildQuizQuestions(mod, modules);
    const quizBlock = quizQuestions.length === 0 ? '' : `
    <div class="quiz-section" data-module-id="${moduleId}">
      <h3 class="quiz-title">📝 模块自检小测</h3>
      ${quizQuestions.map((q, qIdx) => renderQuizQuestion(q, moduleId, qIdx)).join('\n')}
      <button class="submit-quiz-btn" data-module-id="${moduleId}">提交本模块测验</button>
      <div class="quiz-result" data-module-id="${moduleId}"></div>
    </div>`;

    return `
    <section class="module-section" id="${moduleId}">
      <header class="module-header" style="background: linear-gradient(135deg, ${grad.from}, ${grad.to});">
        <span class="module-num">模块 ${mIdx + 1}</span>
        <h2 class="module-name">${esc(mod.name || `模块${mIdx + 1}`)}</h2>
        <span class="module-progress" data-module-id="${moduleId}">0 / ${kps.length}</span>
      </header>
      <div class="cards-grid">
        ${cards}
      </div>
      ${quizBlock}
    </section>`;
  }).join('\n');

  // 嵌入数据供 JS 读取
  // 注意：notebook.name 等字段可能含 HTML 特殊字符。安全策略：
  //  ① 数据内容已传给 JSON.stringify 安全编码
  //  ② 但 </script> 字面量会终止外层 script 标签——必须转义
  //  ③ 同时转 <!-- 防止注释注入
  const embeddedDataRaw = {
    notebookId,
    courseName: notebook?.name || '',
    totalKps,
    modules: modules.map((m, mIdx) => ({
      id: `m${mIdx}`,
      name: m.name,
      kpCount: (m.knowledgePoints || []).length,
    })),
  };
  const embeddedDataJson = JSON.stringify(embeddedDataRaw)
    .replace(/<\/(script)/gi, '<\\/$1')   // 防止 </script> 终止外层 script
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\u2028')   // U+2028 行分隔符
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\u2029');  // U+2029 段分隔符

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${courseName} · 互动知识点卡片</title>
<style>
${INLINE_CSS}
</style>
</head>
<body>

<header class="page-header">
  <h1 class="page-title">📚 ${courseName}</h1>
  <div class="page-subtitle">互动知识点卡片 · 共 ${modules.length} 个模块、${totalKps} 个知识点</div>
  <div class="overall-progress-wrap">
    <div class="overall-progress-label">
      <span>学习进度</span>
      <span id="overall-progress-text">0 / ${totalKps}（0%）</span>
    </div>
    <div class="overall-progress-bar">
      <div class="overall-progress-fill" id="overall-progress-fill"></div>
    </div>
  </div>
  <button class="reset-btn" id="reset-btn">↺ 重置全部进度</button>
</header>

<nav class="module-nav">
  ${modules.map((m, i) => `<a href="#m${i}" class="nav-link">模块 ${i + 1}：${esc((m.name || '').slice(0, 12))}</a>`).join('')}
</nav>

<main class="page-content">
  ${moduleBlocks}
</main>

<div class="celebration" id="celebration" hidden>
  🎉 恭喜！全部知识点已掌握！
</div>

<footer class="page-footer">
  <p>优课创 Agent · 互动知识卡片 · 数据存于本机浏览器（关闭仍保留）</p>
  <p>生成日期：${now}</p>
</footer>

<script>
const KC_DATA = ${embeddedDataJson};
${INLINE_JS}
</script>

</body>
</html>`;
}

/** 单题渲染 */
function renderQuizQuestion(q, moduleId, qIdx) {
  const qId = `${moduleId}-q${qIdx}`;
  if (q.type === 'multi_select') {
    return `
    <div class="quiz-q" data-q-id="${qId}" data-q-type="multi_select">
      <p class="q-stem">${esc(q.stem)}</p>
      <div class="q-options">
        ${q.options.map((opt, i) => `
          <label class="q-option">
            <input type="checkbox" data-correct="${opt.correct ? '1' : '0'}" data-q-id="${qId}" />
            <span>${esc(opt.text)}</span>
          </label>`).join('')}
      </div>
    </div>`;
  }
  if (q.type === 'self_rating') {
    return `
    <div class="quiz-q" data-q-id="${qId}" data-q-type="self_rating">
      <p class="q-stem">${esc(q.stem)}</p>
      <div class="q-rating">
        ${q.scale.map((n, i) => `<button class="q-star" data-value="${n}" data-q-id="${qId}" title="${esc(q.labels[i] || '')}">${'★'.repeat(n)}</button>`).join('')}
      </div>
    </div>`;
  }
  if (q.type === 'reflection') {
    return `
    <div class="quiz-q" data-q-id="${qId}" data-q-type="reflection">
      <p class="q-stem">${esc(q.stem)}</p>
      <textarea class="q-reflection" data-q-id="${qId}" placeholder="${esc(q.placeholder || '')}" rows="3"></textarea>
    </div>`;
  }
  return '';
}

// ─── 内联 CSS ────────────────────────────────────────
const INLINE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  min-height: 100vh; color: #1F2937; line-height: 1.6;
}

/* ── 页眉 ── */
.page-header {
  background: linear-gradient(135deg, #1F3864 0%, #2E5FA3 100%);
  color: white; padding: 40px 32px 32px; text-align: center;
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
}
.page-title { font-size: 32px; margin-bottom: 8px; }
.page-subtitle { font-size: 14px; opacity: 0.85; margin-bottom: 24px; }
.overall-progress-wrap {
  max-width: 600px; margin: 0 auto;
  background: rgba(255,255,255,0.15);
  border-radius: 12px; padding: 16px;
}
.overall-progress-label {
  display: flex; justify-content: space-between;
  font-size: 14px; margin-bottom: 8px; font-weight: 600;
}
.overall-progress-bar {
  height: 12px; background: rgba(255,255,255,0.2);
  border-radius: 6px; overflow: hidden;
}
.overall-progress-fill {
  height: 100%; width: 0%;
  background: linear-gradient(90deg, #43E97B, #38F9D7);
  transition: width 0.6s cubic-bezier(0.4,0,0.2,1);
  border-radius: 6px;
}
.reset-btn {
  margin-top: 16px; padding: 8px 20px;
  background: rgba(255,255,255,0.1); color: white;
  border: 1px solid rgba(255,255,255,0.3); border-radius: 8px;
  font-size: 13px; cursor: pointer;
  transition: background 0.3s;
}
.reset-btn:hover { background: rgba(255,255,255,0.25); }

/* ── 模块导航 ── */
.module-nav {
  background: white; padding: 12px 32px;
  display: flex; gap: 12px; flex-wrap: wrap;
  border-bottom: 1px solid #E5E7EB;
  position: sticky; top: 0; z-index: 100;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.nav-link {
  font-size: 13px; color: #4B5563;
  text-decoration: none; padding: 6px 12px;
  border-radius: 16px; background: #F3F4F6;
  transition: all 0.2s;
}
.nav-link:hover { background: #2E5FA3; color: white; }

/* ── 内容区 ── */
.page-content {
  max-width: 1200px; margin: 0 auto;
  padding: 32px 24px;
}

/* ── 模块卡片 ── */
.module-section {
  background: white; border-radius: 16px;
  margin-bottom: 32px; overflow: hidden;
  box-shadow: 0 4px 16px rgba(0,0,0,0.06);
}
.module-header {
  padding: 24px 28px; color: white;
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
}
.module-num {
  background: rgba(255,255,255,0.25); padding: 4px 12px;
  border-radius: 12px; font-size: 13px; font-weight: 600;
}
.module-name { font-size: 20px; flex: 1; min-width: 200px; }
.module-progress {
  background: rgba(255,255,255,0.2); padding: 6px 14px;
  border-radius: 12px; font-size: 13px; font-weight: 600;
}

/* ── 翻卡 ── */
.cards-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px; padding: 24px 28px;
}
.flip-card {
  perspective: 1000px;
  height: 200px; cursor: pointer;
}
.flip-card:focus { outline: 2px solid #2E5FA3; outline-offset: 4px; }
.flip-card-inner {
  position: relative; width: 100%; height: 100%;
  transform-style: preserve-3d;
  transition: transform 0.6s cubic-bezier(0.4,0,0.2,1);
}
.flip-card.is-flipped .flip-card-inner { transform: rotateY(180deg); }
.flip-card-front, .flip-card-back {
  position: absolute; inset: 0;
  backface-visibility: hidden; -webkit-backface-visibility: hidden;
  border-radius: 12px; padding: 20px;
  display: flex; flex-direction: column;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.flip-card-front { color: white; justify-content: space-between; }
.flip-card-back {
  background: white; transform: rotateY(180deg);
  border: 1px solid #E5E7EB;
}
.kp-num {
  font-size: 12px; opacity: 0.85;
  background: rgba(255,255,255,0.25); align-self: flex-start;
  padding: 2px 10px; border-radius: 10px;
}
.kp-title { font-size: 18px; font-weight: 700; margin: 12px 0; line-height: 1.4; }
.flip-hint { font-size: 12px; opacity: 0.85; align-self: flex-end; }
.flip-card-back h4 { color: #2E5FA3; margin-bottom: 8px; font-size: 14px; }
.flip-card-back p {
  font-size: 13px; color: #4B5563; flex: 1;
  overflow-y: auto; line-height: 1.7;
}
.mark-learned-btn {
  margin-top: 12px; padding: 8px 16px;
  background: #43E97B; color: white;
  border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.2s;
}
.mark-learned-btn:hover { background: #38C868; transform: translateY(-1px); }
.learned-badge {
  display: none; margin-top: 12px;
  padding: 6px 12px; background: #DCFCE7; color: #166534;
  border-radius: 8px; font-size: 12px; font-weight: 600;
  text-align: center;
}
.flip-card.is-learned .mark-learned-btn { display: none; }
.flip-card.is-learned .learned-badge { display: block; }
.flip-card.is-learned .flip-card-front { opacity: 0.65; }
.flip-card.is-learned .flip-card-front::after {
  content: '✓'; position: absolute; top: 12px; right: 12px;
  background: rgba(255,255,255,0.95); color: #16A34A;
  width: 24px; height: 24px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700;
}

/* ── 测验区 ── */
.quiz-section {
  padding: 24px 28px; border-top: 1px solid #E5E7EB;
  background: #FAFBFC;
}
.quiz-title { font-size: 18px; color: #1F3864; margin-bottom: 16px; }
.quiz-q { margin-bottom: 20px; }
.q-stem {
  font-size: 14px; font-weight: 600; color: #374151;
  margin-bottom: 10px;
}
.q-options { display: flex; flex-direction: column; gap: 8px; }
.q-option {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; background: white;
  border: 1px solid #E5E7EB; border-radius: 8px;
  cursor: pointer; font-size: 13px;
  transition: all 0.2s;
}
.q-option:hover { background: #F3F4F6; border-color: #2E5FA3; }
.q-option input { cursor: pointer; }
.q-option.correct-answer { background: #DCFCE7; border-color: #43E97B; }
.q-option.wrong-answer { background: #FEE2E2; border-color: #EF4444; }
.q-rating { display: flex; gap: 8px; }
.q-star {
  background: white; border: 1px solid #E5E7EB;
  padding: 8px 12px; border-radius: 6px;
  cursor: pointer; color: #FBBF24;
  font-size: 13px; transition: all 0.2s;
}
.q-star:hover, .q-star.selected { background: #FBBF24; color: white; }
.q-reflection {
  width: 100%; padding: 10px 12px;
  border: 1px solid #E5E7EB; border-radius: 8px;
  font-size: 13px; font-family: inherit; resize: vertical;
}
.q-reflection:focus { border-color: #2E5FA3; outline: none; }
.submit-quiz-btn {
  margin-top: 8px; padding: 10px 20px;
  background: #2E5FA3; color: white;
  border: none; border-radius: 8px;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.submit-quiz-btn:hover { background: #1F3864; }
.quiz-result {
  margin-top: 12px; padding: 12px;
  background: white; border-radius: 8px;
  font-size: 13px; display: none;
}
.quiz-result.shown { display: block; }
.quiz-result.success { background: #DCFCE7; color: #166534; }
.quiz-result.partial { background: #FEF3C7; color: #92400E; }

/* ── 庆祝弹窗 ── */
.celebration {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: white; padding: 40px 60px;
  border-radius: 20px; font-size: 28px; font-weight: 700;
  color: #1F3864;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  animation: pop 0.5s ease-out;
  z-index: 1000;
}
@keyframes pop {
  0% { transform: translate(-50%,-50%) scale(0.5); opacity: 0; }
  100% { transform: translate(-50%,-50%) scale(1); opacity: 1; }
}

/* ── 页脚 ── */
.page-footer {
  text-align: center; padding: 32px;
  color: #6B7280; font-size: 13px;
  background: white; border-top: 1px solid #E5E7EB;
}

/* ── 响应式 ── */
@media (max-width: 640px) {
  .cards-grid { grid-template-columns: 1fr; }
  .page-title { font-size: 24px; }
  .module-nav { padding: 8px 16px; }
}
`;

// ─── 内联 JS ────────────────────────────────────────
const INLINE_JS = `
(function () {
  'use strict';
  const KEY_PREFIX = 'kc-' + KC_DATA.notebookId + '-';

  function lsGet(k) { try { return localStorage.getItem(KEY_PREFIX + k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(KEY_PREFIX + k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(KEY_PREFIX + k); } catch (e) {} }

  // ── 翻卡 ──
  document.querySelectorAll('.flip-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.mark-learned-btn')) return;
      card.classList.toggle('is-flipped');
      card.setAttribute('aria-pressed', card.classList.contains('is-flipped'));
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
    });
  });

  // ── 学习标记 ──
  document.querySelectorAll('.mark-learned-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const kpId = btn.dataset.kpId;
      lsSet('learned-' + kpId, '1');
      btn.closest('.flip-card').classList.add('is-learned');
      updateProgress();
    });
  });

  // ── 进度 ──
  function updateProgress() {
    let learnedTotal = 0;
    KC_DATA.modules.forEach(mod => {
      let learnedInMod = 0;
      for (let i = 0; i < mod.kpCount; i++) {
        const kpId = mod.id + '-k' + i;
        if (lsGet('learned-' + kpId) === '1') learnedInMod++;
      }
      learnedTotal += learnedInMod;
      const tag = document.querySelector('[data-module-id="' + mod.id + '"].module-progress');
      if (tag) tag.textContent = learnedInMod + ' / ' + mod.kpCount;
    });
    const pct = KC_DATA.totalKps > 0 ? Math.round(learnedTotal / KC_DATA.totalKps * 100) : 0;
    document.getElementById('overall-progress-text').textContent = learnedTotal + ' / ' + KC_DATA.totalKps + '（' + pct + '%）';
    document.getElementById('overall-progress-fill').style.width = pct + '%';
    if (learnedTotal === KC_DATA.totalKps && KC_DATA.totalKps > 0) {
      const cel = document.getElementById('celebration');
      cel.hidden = false;
      setTimeout(() => { cel.hidden = true; }, 4000);
    }
  }

  // 加载已有进度
  document.querySelectorAll('.flip-card').forEach(card => {
    if (lsGet('learned-' + card.dataset.kpId) === '1') card.classList.add('is-learned');
  });
  updateProgress();

  // ── 测验：自评星级 ──
  document.querySelectorAll('.q-star').forEach(btn => {
    btn.addEventListener('click', () => {
      const qId = btn.dataset.qId;
      const value = btn.dataset.value;
      lsSet('quiz-' + qId, value);
      btn.parentElement.querySelectorAll('.q-star').forEach(s => s.classList.remove('selected'));
      btn.classList.add('selected');
    });
    // 加载已有
    const saved = lsGet('quiz-' + btn.dataset.qId);
    if (saved && saved === btn.dataset.value) btn.classList.add('selected');
  });

  // ── 测验：反思保存（失焦自动保存）──
  document.querySelectorAll('.q-reflection').forEach(ta => {
    const qId = ta.dataset.qId;
    ta.value = lsGet('quiz-' + qId) || '';
    ta.addEventListener('blur', () => lsSet('quiz-' + qId, ta.value));
  });

  // ── 测验：提交多选题 ──
  document.querySelectorAll('.submit-quiz-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const moduleId = btn.dataset.moduleId;
      const section = document.querySelector('.quiz-section[data-module-id="' + moduleId + '"]');
      const multiSelectQs = section.querySelectorAll('[data-q-type="multi_select"]');
      let correct = 0, total = 0;
      multiSelectQs.forEach(q => {
        const inputs = q.querySelectorAll('input[type="checkbox"]');
        inputs.forEach(input => {
          const isCorrect = input.dataset.correct === '1';
          const isChecked = input.checked;
          total++;
          if (isCorrect === isChecked) correct++;
          const label = input.closest('.q-option');
          if (isCorrect) label.classList.add('correct-answer');
          else if (isChecked) label.classList.add('wrong-answer');
        });
      });
      const result = section.querySelector('.quiz-result');
      result.classList.add('shown');
      const pct = total > 0 ? Math.round(correct / total * 100) : 0;
      lsSet('quiz-' + moduleId + '-score', correct + '/' + total);
      if (pct === 100) {
        result.classList.add('success');
        result.textContent = '🎉 全对！本模块掌握良好。';
      } else if (pct >= 60) {
        result.classList.add('partial');
        result.textContent = '✓ 答对 ' + correct + '/' + total + '。建议复习未答对的知识点。';
      } else {
        result.classList.add('partial');
        result.textContent = '⚠ 答对 ' + correct + '/' + total + '。建议重新学习本模块。';
      }
    });
  });

  // ── 重置全部 ──
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('确定重置全部学习进度？此操作不可撤销。')) return;
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(KEY_PREFIX)) localStorage.removeItem(k);
    });
    location.reload();
  });
})();
`;

// ─── 公共 API ────────────────────────────────────────
/**
 * 导出互动知识点卡片 HTML 文件
 *
 * @param {Object} params
 * @param {Object}   params.notebook   - 笔记本对象（需含 id 与 name）
 * @param {Array}    params.modules    - 模块数组（含 knowledgePoints）
 * @param {string}   params.outputPath - 输出文件路径（.html）
 * @returns {string} 实际写入的文件路径
 */
function exportInteractiveKnowledgeCards({ notebook, modules, outputPath }) {
  if (!outputPath) throw new Error('输出路径不能为空');
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error('没有模块数据，无法生成互动知识点卡片');
  }
  if (!notebook) throw new Error('notebook 不能为空');

  const html = buildInteractiveHtml({ notebook, modules });
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');

  console.log(`[interactive-cards] 导出完成：${outputPath}（${modules.length} 模块，${(html.length / 1024).toFixed(1)} KB）`);
  return outputPath;
}

// ─── 自检函数 ────────────────────────────────────────
function selfCheck() {
  const cases = [];
  const tmpDir = require('os').tmpdir();

  cases.push({
    name: 'cleanKpText 清理序号前缀',
    fn: () => {
      if (cleanKpText('1. 测试内容') !== '测试内容') throw new Error('未清理 1.');
      if (cleanKpText('① 选项A') !== '选项A') throw new Error('未清理 ①');
    },
  });

  cases.push({
    name: 'splitKpForFlip 分离标题与详解',
    fn: () => {
      const r = splitKpForFlip('标题：详细解释内容');
      if (r.title !== '标题') throw new Error('title 提取错');
      if (!r.detail.includes('详细解释')) throw new Error('detail 提取错');
    },
  });

  cases.push({
    name: 'buildQuizQuestions 生成 3 题',
    fn: () => {
      const moduleData = { name: '模块1', knowledgePoints: ['kp1', 'kp2'] };
      const qs = buildQuizQuestions(moduleData, [moduleData]);
      if (qs.length !== 3) throw new Error(`期望 3 题，实际 ${qs.length}`);
      if (qs[0].type !== 'multi_select') throw new Error('Q1 应为 multi_select');
      if (qs[1].type !== 'self_rating') throw new Error('Q2 应为 self_rating');
      if (qs[2].type !== 'reflection') throw new Error('Q3 应为 reflection');
    },
  });

  cases.push({
    name: 'exportInteractiveKnowledgeCards 完整流程',
    fn: () => {
      const outFile = path.join(tmpDir, `kc-test-${Date.now()}.html`);
      const notebook = { id: 99, name: '测试课程' };
      const modules = [
        { name: '模块1：基础', knowledgePoints: ['知识点A：第一个', '知识点B：第二个'] },
        { name: '模块2：进阶', knowledgePoints: ['进阶点C：详解'] },
      ];
      exportInteractiveKnowledgeCards({ notebook, modules, outputPath: outFile });
      const html = fs.readFileSync(outFile, 'utf8');
      if (!html.includes('<!DOCTYPE html>')) throw new Error('缺 DOCTYPE');
      if (!html.includes('flip-card')) throw new Error('缺翻卡');
      if (!html.includes('quiz-section')) throw new Error('缺测验区');
      if (!html.includes('overall-progress-fill')) throw new Error('缺进度条');
      if (!html.includes('localStorage')) throw new Error('缺 LocalStorage 逻辑');
      if (!html.includes('测试课程')) throw new Error('缺课程名');
      if (!html.includes('知识点A')) throw new Error('缺知识点');
      fs.unlinkSync(outFile);
    },
  });

  cases.push({
    name: 'XSS 转义：title/content 中的 <script>',
    fn: () => {
      const outFile = path.join(tmpDir, `kc-xss-${Date.now()}.html`);
      const notebook = { id: 1, name: '<script>alert(1)</script>' };
      const modules = [{ name: '模块', knowledgePoints: ['"><img src=x>'] }];
      exportInteractiveKnowledgeCards({ notebook, modules, outputPath: outFile });
      const html = fs.readFileSync(outFile, 'utf8');
      if (html.includes('<script>alert(1)</script>')) {
        throw new Error('未转义 <script> 标签！');
      }
      if (!html.includes('&lt;script&gt;')) throw new Error('应转义为 &lt;script&gt;');
      fs.unlinkSync(outFile);
    },
  });

  cases.push({
    name: '空模块抛错',
    fn: () => {
      let threw = false;
      try {
        exportInteractiveKnowledgeCards({ notebook: { id: 1, name: 'x' }, modules: [], outputPath: '/tmp/x.html' });
      } catch (e) { threw = true; }
      if (!threw) throw new Error('空模块应抛错');
    },
  });

  cases.push({
    name: '缺 outputPath 抛错',
    fn: () => {
      let threw = false;
      try {
        exportInteractiveKnowledgeCards({ notebook: { id: 1, name: 'x' }, modules: [{ name: 'a', knowledgePoints: ['x'] }] });
      } catch (e) { threw = true; }
      if (!threw) throw new Error('缺 outputPath 应抛错');
    },
  });

  let passed = 0;
  const failures = [];
  for (let i = 0; i < cases.length; i++) {
    try {
      cases[i].fn();
      passed++;
    } catch (e) {
      failures.push({ caseIndex: i + 1, name: cases[i].name, message: e.message });
    }
  }
  return { passed, total: cases.length, failures, success: failures.length === 0 };
}

module.exports = {
  exportInteractiveKnowledgeCards,
  // 内部工具（导出供测试）
  cleanKpText,
  splitKpForFlip,
  buildQuizQuestions,
  selfCheck,
};
