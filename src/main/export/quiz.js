const fs = require('fs');

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function collectQuizScenes(coursePipeline = {}) {
  const scenes = toList(coursePipeline.scenes);
  return scenes.filter((scene) => String(scene?.type || '').toLowerCase() === 'quiz');
}

function buildQuizJson({ notebook, coursePipeline }) {
  const quizScenes = collectQuizScenes(coursePipeline);
  return {
    courseName: notebook?.name || '未命名课程',
    generatedAt: new Date().toISOString(),
    totalQuizScenes: quizScenes.length,
    quizzes: quizScenes.map((scene, index) => ({
      id: scene.id || `quiz_${index + 1}`,
      title: scene.title || `测验${index + 1}`,
      moduleRef: scene.moduleRef || '',
      config: scene?.content?.config || {},
      questions: toList(scene?.content?.questions)
    }))
  };
}

function buildQuizMarkdown({ notebook, coursePipeline }) {
  const json = buildQuizJson({ notebook, coursePipeline });
  const lines = [];
  lines.push(`# 课堂测验包：${json.courseName}`);
  lines.push('');
  lines.push(`- 生成时间：${json.generatedAt}`);
  lines.push(`- 测验场景数：${json.totalQuizScenes}`);
  lines.push('');

  if (!json.quizzes.length) {
    lines.push('> 暂无测验场景，请先在“课程场景编排”中生成 quiz 场景。');
    return lines.join('\n');
  }

  json.quizzes.forEach((quiz, idx) => {
    lines.push(`## 测验 ${idx + 1}：${quiz.title}`);
    lines.push(`- 场景ID：${quiz.id}`);
    lines.push(`- 模块：${quiz.moduleRef || '-'}`);
    lines.push(`- 题目数：${toList(quiz.questions).length}`);
    lines.push('');
    if (!toList(quiz.questions).length) {
      lines.push('- （当前无题目，建议在场景编辑中补充）');
      lines.push('');
      return;
    }
    toList(quiz.questions).forEach((q, qIdx) => {
      lines.push(`${qIdx + 1}. ${q.question || q.stem || '未命名题目'}`);
      toList(q.options).forEach((opt, optIdx) => {
        lines.push(`   - ${String.fromCharCode(65 + optIdx)}. ${opt}`);
      });
      if (q.answer) lines.push(`   - 参考答案：${q.answer}`);
      lines.push('');
    });
  });
  return lines.join('\n');
}

function buildQuizPrintableHtml({ notebook, coursePipeline }) {
  const json = buildQuizJson({ notebook, coursePipeline });
  const quizBlocks = json.quizzes.map((quiz, idx) => {
    const questions = toList(quiz.questions).map((q, qIdx) => {
      const options = toList(q.options)
        .map((opt, optIdx) => `<li>${String.fromCharCode(65 + optIdx)}. ${opt}</li>`)
        .join('');
      return `
        <div class="question">
          <p><strong>${qIdx + 1}. ${q.question || q.stem || '未命名题目'}</strong></p>
          ${options ? `<ul>${options}</ul>` : '<p>（无选项）</p>'}
        </div>
      `;
    }).join('');
    return `
      <section class="quiz">
        <h2>测验 ${idx + 1}：${quiz.title}</h2>
        <p class="meta">场景ID：${quiz.id} ｜ 模块：${quiz.moduleRef || '-'}</p>
        ${questions || '<p>暂无题目</p>'}
      </section>
    `;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${json.courseName} 课堂测验</title>
  <style>
    body { font-family: "Microsoft YaHei", sans-serif; margin: 24px; color: #1f2937; }
    h1,h2 { margin: 0 0 12px; }
    .meta { color: #6b7280; font-size: 13px; }
    .quiz { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .question { margin-bottom: 12px; }
    @media print { .quiz { break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>课堂测验：${json.courseName}</h1>
  <p class="meta">生成时间：${json.generatedAt}</p>
  ${quizBlocks || '<p>暂无测验内容</p>'}
</body>
</html>`;
}

function exportQuiz({ notebook, coursePipeline, outputPath, format = 'md' }) {
  const lower = String(format || 'md').toLowerCase();
  if (lower === 'json') {
    const content = buildQuizJson({ notebook, coursePipeline });
    fs.writeFileSync(outputPath, JSON.stringify(content, null, 2), 'utf8');
    return outputPath;
  }
  if (lower === 'html') {
    const content = buildQuizPrintableHtml({ notebook, coursePipeline });
    fs.writeFileSync(outputPath, content, 'utf8');
    return outputPath;
  }
  const content = buildQuizMarkdown({ notebook, coursePipeline });
  fs.writeFileSync(outputPath, content, 'utf8');
  return outputPath;
}

module.exports = {
  exportQuiz,
  buildQuizJson,
  buildQuizMarkdown,
  buildQuizPrintableHtml
};
