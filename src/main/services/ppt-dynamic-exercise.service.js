/**
 * ppt-dynamic-exercise.service.js
 *
 * PPT 课堂动态练习页生成服务（2026-05-15 老师反馈问题三）
 *
 * 功能：
 *   - 根据已生成的 PPT 全部页面（pageType/title/keyContent/dataPoint/caseExample），
 *     用 AI 生成 5-8 道互动题目（单选/填空/判断/简答混合）
 *   - 把题目包装为可交互的 HTML iframe（沙箱化，参考 interactive-html.js 既有模式）
 *   - 输出可直接插入 PPT pipeline 的 page 对象（pageType='动态练习'）
 *
 * 集成点：
 *   - 在 ppt-pipeline-v2 完成所有页详情后，在"谢谢"页前插入此页
 *   - 也可由 ppt.handlers.js 在 ppt 生成完成后单独调用
 *
 * H 约束遵守：
 *   - H5: prompt 在 prompts/ppt-dynamic-exercise.md
 *   - H8: 不新增依赖
 */

const fs = require('fs');
const path = require('path');

const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

function parseJsonFromText(text) {
  let cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('未找到 JSON 边界');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * 转义 HTML 特殊字符（防 XSS + 防 srcdoc 注入）
 */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 把题目 JSON 渲染成可交互的 HTML（嵌入 iframe srcdoc）
 *
 * 设计：
 *   - 客户端 JS 在 iframe 内运行，无外部请求
 *   - 点击选项 / 填空 / 提交 → 直接显示对错 + 解析
 *   - 沙箱化 iframe 防 XSS
 */
function buildExerciseHtml({ title, subtitle, exercises, courseName }) {
  const exerciseBlocks = exercises.map((ex, idx) => {
    const qNum = idx + 1;
    const explanation = escapeHtml(ex.explanation || '');
    if (ex.type === 'single_choice') {
      const opts = (ex.options || []).map((opt, i) => `
        <label class="opt">
          <input type="radio" name="q${qNum}" value="${i}">
          <span>${escapeHtml(opt)}</span>
        </label>
      `).join('');
      return `
        <div class="q" data-type="single" data-correct="${Number(ex.correctIndex) || 0}">
          <div class="q-head">第 ${qNum} 题 · 单选</div>
          <div class="q-body">${escapeHtml(ex.question || '')}</div>
          <div class="opts">${opts}</div>
          <button class="check-btn" onclick="checkSingle(${qNum})">提交答案</button>
          <div class="feedback" id="fb${qNum}"></div>
          <div class="explain" id="ex${qNum}" style="display:none">💡 ${explanation}</div>
        </div>
      `;
    }
    if (ex.type === 'true_false') {
      return `
        <div class="q" data-type="tf" data-correct="${ex.answer ? '1' : '0'}">
          <div class="q-head">第 ${qNum} 题 · 判断</div>
          <div class="q-body">${escapeHtml(ex.question || '')}</div>
          <div class="opts">
            <label class="opt"><input type="radio" name="q${qNum}" value="1"><span>✅ 正确</span></label>
            <label class="opt"><input type="radio" name="q${qNum}" value="0"><span>❌ 错误</span></label>
          </div>
          <button class="check-btn" onclick="checkTF(${qNum})">提交答案</button>
          <div class="feedback" id="fb${qNum}"></div>
          <div class="explain" id="ex${qNum}" style="display:none">💡 ${explanation}</div>
        </div>
      `;
    }
    if (ex.type === 'fill_blank') {
      const blanks = (ex.blanks || []).map((b, i) =>
        `<input type="text" class="blank-input" id="b${qNum}_${i}" placeholder="答案 ${i + 1}">`
      ).join(' ');
      const answers = (ex.blanks || []).map((b) => escapeHtml(b)).join('|||');
      return `
        <div class="q" data-type="fill" data-answers="${answers}">
          <div class="q-head">第 ${qNum} 题 · 填空（${(ex.blanks || []).length} 空）</div>
          <div class="q-body">${escapeHtml(ex.question || '')}</div>
          <div class="opts">${blanks}</div>
          <button class="check-btn" onclick="checkFill(${qNum}, ${(ex.blanks || []).length})">提交答案</button>
          <div class="feedback" id="fb${qNum}"></div>
          <div class="explain" id="ex${qNum}" style="display:none">💡 ${explanation}</div>
        </div>
      `;
    }
    // short_answer：参考答案展示
    const refAns = escapeHtml(ex.referenceAnswer || '');
    return `
      <div class="q" data-type="short">
        <div class="q-head">第 ${qNum} 题 · 简答</div>
        <div class="q-body">${escapeHtml(ex.question || '')}</div>
        <textarea class="short-input" id="s${qNum}" rows="3" placeholder="用 2-3 句话回答…"></textarea>
        <button class="check-btn" onclick="showRef(${qNum})">查看参考答案</button>
        <div class="feedback" id="fb${qNum}" style="display:none">
          <strong>📖 参考答案：</strong>${refAns}<br/>
          <span style="color:#6b7280">${explanation}</span>
        </div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title || '课堂动态练习')}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
    margin: 0; padding: 24px;
    background: linear-gradient(135deg, #f0f9ff 0%, #fef3c7 100%);
    color: #1f2937;
    line-height: 1.6;
  }
  .header {
    text-align: center; margin-bottom: 24px;
    padding: 18px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  }
  .header h1 { margin: 0 0 6px; font-size: 24px; color: #1e40af; }
  .header p { margin: 0; color: #6b7280; font-size: 14px; }
  .header .course { display: inline-block; margin-top: 8px; padding: 4px 12px; background: #dbeafe; color: #1e40af; border-radius: 4px; font-size: 12px; }
  .stats {
    display: flex; justify-content: space-around; margin: 16px 0;
    padding: 12px; background: white; border-radius: 8px;
  }
  .stats > div { text-align: center; }
  .stats strong { display: block; font-size: 24px; color: #2563eb; }
  .stats span { font-size: 12px; color: #6b7280; }
  .q {
    margin-bottom: 16px; padding: 18px;
    background: white; border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .q-head { font-size: 13px; color: #6b7280; margin-bottom: 8px; font-weight: 600; }
  .q-body { font-size: 15px; margin-bottom: 12px; color: #1f2937; }
  .opts { display: flex; flex-direction: column; gap: 8px; }
  .opt { display: flex; align-items: center; padding: 10px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; cursor: pointer; transition: all .15s; }
  .opt:hover { background: #eff6ff; border-color: #93c5fd; }
  .opt input { margin-right: 10px; }
  .blank-input { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 14px; width: 120px; }
  .short-input { width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; resize: vertical; }
  .check-btn {
    margin-top: 12px; padding: 8px 20px;
    background: #2563eb; color: white;
    border: none; border-radius: 6px;
    font-size: 14px; font-weight: 600;
    cursor: pointer;
  }
  .check-btn:hover { background: #1d4ed8; }
  .feedback { margin-top: 12px; padding: 10px 14px; border-radius: 6px; font-size: 13px; }
  .feedback.correct { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  .feedback.wrong { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
  .explain { margin-top: 8px; padding: 10px; background: #fef9c3; border-radius: 6px; font-size: 13px; color: #78350f; }
  .summary { margin-top: 24px; padding: 18px; background: white; border-radius: 12px; text-align: center; }
</style>
</head>
<body>

<div class="header">
  <h1>${escapeHtml(title || '课堂动态练习')}</h1>
  <p>${escapeHtml(subtitle || '互动检验本节学习成果')}</p>
  ${courseName ? `<span class="course">${escapeHtml(courseName)}</span>` : ''}
</div>

<div class="stats">
  <div><strong id="total">${exercises.length}</strong><span>题目总数</span></div>
  <div><strong id="answered">0</strong><span>已答题数</span></div>
  <div><strong id="correct">0</strong><span>答对题数</span></div>
</div>

${exerciseBlocks}

<div class="summary" id="finalSummary" style="display:none">
  <h3>🎉 答题完成</h3>
  <p>共 <strong id="finalCorrect">0</strong> / ${exercises.length} 题正确</p>
</div>

<script>
  let answered = 0;
  let correct = 0;
  function updateStats(isCorrect) {
    answered++;
    if (isCorrect) correct++;
    document.getElementById('answered').textContent = answered;
    document.getElementById('correct').textContent = correct;
    if (answered === ${exercises.length}) {
      document.getElementById('finalSummary').style.display = 'block';
      document.getElementById('finalCorrect').textContent = correct;
    }
  }
  function showFeedback(qNum, isCorrect, msg) {
    const fb = document.getElementById('fb' + qNum);
    fb.className = 'feedback ' + (isCorrect ? 'correct' : 'wrong');
    fb.textContent = (isCorrect ? '✅ 答对了！' : '❌ 答错了。') + (msg ? ' ' + msg : '');
    fb.style.display = 'block';
    document.getElementById('ex' + qNum).style.display = 'block';
  }
  function checkSingle(qNum) {
    const q = document.querySelectorAll('.q')[qNum - 1];
    if (!q || q.dataset.answered === 'true') return;
    const correctIdx = q.dataset.correct;
    const sel = q.querySelector('input[name="q' + qNum + '"]:checked');
    if (!sel) { alert('请先选一个选项'); return; }
    q.dataset.answered = 'true';
    const ok = sel.value === correctIdx;
    showFeedback(qNum, ok);
    updateStats(ok);
  }
  function checkTF(qNum) {
    const q = document.querySelectorAll('.q')[qNum - 1];
    if (!q || q.dataset.answered === 'true') return;
    const sel = q.querySelector('input[name="q' + qNum + '"]:checked');
    if (!sel) { alert('请先选一个选项'); return; }
    q.dataset.answered = 'true';
    const ok = sel.value === q.dataset.correct;
    showFeedback(qNum, ok);
    updateStats(ok);
  }
  function checkFill(qNum, n) {
    const q = document.querySelectorAll('.q')[qNum - 1];
    if (!q || q.dataset.answered === 'true') return;
    const answers = q.dataset.answers.split('|||');
    const userAns = [];
    for (let i = 0; i < n; i++) {
      userAns.push(document.getElementById('b' + qNum + '_' + i).value.trim());
    }
    if (userAns.some((a) => !a)) { alert('请填写所有空'); return; }
    q.dataset.answered = 'true';
    // 宽松匹配：trim + 不区分大小写 + 不区分中英文标点（基础版）
    const allOk = userAns.every((a, i) => a.toLowerCase() === answers[i].toLowerCase());
    showFeedback(qNum, allOk, allOk ? '' : '正确答案：' + answers.join(' / '));
    updateStats(allOk);
  }
  function showRef(qNum) {
    const fb = document.getElementById('fb' + qNum);
    fb.style.display = 'block';
    const q = document.querySelectorAll('.q')[qNum - 1];
    if (q.dataset.answered !== 'true') {
      q.dataset.answered = 'true';
      // 简答题不计入对错统计
      answered++;
      document.getElementById('answered').textContent = answered;
    }
  }
</script>
</body>
</html>`;
}

/**
 * 主入口：根据 PPT 页面生成动态练习页对象
 *
 * @returns {Promise<{ exercisePage, exercises }>}
 *   exercisePage: 可插入 ppt pages 数组的对象
 *   exercises: 原始题目 JSON
 */
async function generateDynamicExercise({
  aiClient,
  pages = [],
  courseName,
  totalHours,
}) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    throw new Error('未提供有效的 AI 客户端');
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('PPT 页面为空，无法生成练习');
  }

  // 整理 PPT 内容供 AI 出题
  const pagesSummary = pages
    .filter((p) => !['封面', '谢谢', '总结收束', '动态练习'].includes(p.pageType))
    .map((p, i) => {
      const kc = (p.keyContent || []).join(' / ');
      const extras = [
        p.dataPoint ? `数据：${p.dataPoint}` : '',
        p.caseExample ? `案例：${p.caseExample}` : '',
      ].filter(Boolean).join(' · ');
      return `[第${i + 1}页 · ${p.pageType}] ${p.title}\n  要点：${kc}\n  ${extras}`;
    })
    .join('\n\n');

  const systemPrompt = loadPrompt('ppt-dynamic-exercise');
  const userPrompt = [
    `## 课程`,
    `${courseName || '未命名课程'}（${totalHours || 1} 学时）`,
    '',
    `## PPT 全部内容（出题素材）`,
    pagesSummary,
    '',
    `请根据以上内容出 5-8 道题（单选 / 填空 / 判断 / 简答混合），严格 JSON 输出。`,
  ].join('\n');

  // 2026-05-16 v4.1.4 Q4 加固：详细日志 + 重试 + 兜底
  const sourcePageCount = pages.filter((p) => !['封面','谢谢','总结收束','动态练习'].includes(p.pageType)).length;
  console.log(`[ppt-dynamic-exercise] AI 调用：${sourcePageCount} 页作为出题素材`);

  // 2026-05-16 v4.1.4：重试 2 次 + 失败时尝试不同 temperature
  const ATTEMPTS = [
    { temperature: 0.4, maxTokens: 4500, note: '首次' },
    { temperature: 0.6, maxTokens: 4500, note: '重试 1（高 temperature 让 AI 不卡壳）' },
    { temperature: 0.3, maxTokens: 4500, note: '重试 2（低 temperature 严格遵守 schema）' },
  ];

  let exercises = [];
  let title = '课堂动态练习';
  let subtitle = '互动检验本节学习成果';
  let lastError = null;

  for (const attempt of ATTEMPTS) {
    console.log(`[ppt-dynamic-exercise] ${attempt.note}：temperature=${attempt.temperature}, maxTokens=${attempt.maxTokens}`);
    let rawText;
    try {
      rawText = await aiClient.chatJson({
        systemPrompt,
        userPrompt,
        temperature: attempt.temperature,
        maxTokens: attempt.maxTokens,
      });
      console.log(`[ppt-dynamic-exercise]   AI 返回 ${String(rawText || '').length} 字`);
    } catch (callErr) {
      lastError = callErr;
      console.error(`[ppt-dynamic-exercise]   AI 调用异常：${callErr.message}`);
      continue;
    }

    let parsed;
    try {
      parsed = parseJsonFromText(rawText);
    } catch (parseErr) {
      console.error(`[ppt-dynamic-exercise]   JSON 解析失败：${parseErr.message}`);
      console.error(`[ppt-dynamic-exercise]   AI 原文前 500 字：${String(rawText || '').slice(0, 500)}`);
      lastError = parseErr;
      continue;
    }

    title = String(parsed.title || parsed.exerciseTitle || '课堂动态练习').slice(0, 30);
    subtitle = String(parsed.subtitle || parsed.exerciseSubtitle || '互动检验本节学习成果').slice(0, 60);
    // 兼容 AI 可能用 questions / items 等其它字段名
    const raw = parsed.exercises || parsed.questions || parsed.items || [];
    exercises = Array.isArray(raw) ? raw.slice(0, 10) : [];

    console.log(`[ppt-dynamic-exercise]   解析出 ${exercises.length} 道题`);
    if (exercises.length > 0) {
      const typeCounts = exercises.reduce((acc, ex) => {
        acc[ex.type || 'unknown'] = (acc[ex.type || 'unknown'] || 0) + 1;
        return acc;
      }, {});
      console.log(`[ppt-dynamic-exercise]   题型分布：${JSON.stringify(typeCounts)}`);
      break;   // 成功，跳出重试
    }
    console.warn(`[ppt-dynamic-exercise]   ⚠ 0 题，parsed keys: ${Object.keys(parsed || {}).join(', ')}`);
    lastError = new Error('AI 返回 0 道题');
  }

  // 3 次都失败 → 抛错让上层落到 placeholder 路径
  if (exercises.length === 0) {
    console.error(`[ppt-dynamic-exercise] ❌ 3 次重试均失败，最后错误：${lastError?.message || 'unknown'}`);
    throw new Error(`AI 出题失败（3 次重试）：${lastError?.message || '未知原因'}`);
  }

  const html = buildExerciseHtml({ title, subtitle, exercises, courseName });

  // 包装为 ppt page 对象
  const exercisePage = {
    pageType: '动态练习',
    title,
    subtitle,
    keyContent: [`共 ${exercises.length} 题`, '单选 / 填空 / 判断 / 简答混合', '点选项即得反馈'],
    speakerNotes: `让学生扫码或在大屏上互动答题，${exercises.length} 题约用 5-8 分钟。教师巡视并对错题做即时点评。`,
    dataPoint: '',
    caseExample: '',
    interactionPrompt: '现在请大家拿出手机扫码答题（或在大屏上做），5 分钟后我们一起对答案。',
    imagePrompt: '',
    needImage: false,
    sourceSection: '动态练习',
    // 动态练习专用字段
    exerciseHtml: html,         // 完整 HTML（导出 PPT 时单独保存）
    exercises,                  // 原始题目 JSON（方便编辑）
  };

  return { exercisePage, exercises, html };
}

// ── 自检 ────────────────────────────────────────────────────────────────
function selfCheck() {
  const checks = [];

  checks.push({
    name: 'prompts/ppt-dynamic-exercise.md 可加载',
    pass: (() => {
      try { return loadPrompt('ppt-dynamic-exercise').length > 100; } catch { return false; }
    })(),
  });

  checks.push({
    name: 'buildExerciseHtml 输出含 HTML 结构',
    pass: (() => {
      const html = buildExerciseHtml({
        title: '测试',
        subtitle: '副标题',
        exercises: [
          { type: 'single_choice', question: 'Q1', options: ['A', 'B'], correctIndex: 0, explanation: 'X' },
          { type: 'true_false', question: 'Q2', answer: true, explanation: 'Y' },
          { type: 'fill_blank', question: 'Q3 __ 是', blanks: ['答案'], explanation: 'Z' },
          { type: 'short_answer', question: 'Q4', referenceAnswer: '参考', explanation: 'W' },
        ],
      });
      return html.includes('<!DOCTYPE html>') && html.includes('checkSingle') && html.includes('checkTF') && html.includes('checkFill') && html.includes('showRef');
    })(),
  });

  return checks;
}

module.exports = {
  generateDynamicExercise,
  buildExerciseHtml,
  selfCheck,
  _internal: { loadPrompt, parseJsonFromText, escapeHtml },
};
