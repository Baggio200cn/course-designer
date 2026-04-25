function countHits(text, patterns) {
  const raw = String(text || '');
  return patterns.reduce((acc, pattern) => {
    const reg = new RegExp(pattern, 'gi');
    const matched = raw.match(reg);
    return acc + (matched ? matched.length : 0);
  }, 0);
}

function auditLectureStyle({ text = '', styleRubric = {} }) {
  const content = String(text || '').trim();
  const total = content.length || 1;
  const aiPatterns = [
    '总的来说',
    '综上所述',
    '首先其次最后',
    '赋能',
    '闭环',
    '高质量发展'
  ];
  const oralPatterns = ['同学们', '我们来', '你们先', '现在请', '做一做', '想一想'];
  const forbidden = Array.isArray(styleRubric?.forbidden) ? styleRubric.forbidden : [];

  const aiHits = countHits(content, aiPatterns);
  const oralHits = countHits(content, oralPatterns);
  const forbiddenHits = forbidden.reduce((acc, item) => {
    if (!item) return acc;
    const reg = new RegExp(String(item).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const hit = content.match(reg);
    return acc + (hit ? hit.length : 0);
  }, 0);

  let score = 100;
  score -= Math.min(30, aiHits * 4);
  score -= Math.min(20, forbiddenHits * 6);
  score += Math.min(15, oralHits * 2);
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    aiHits,
    oralHits,
    forbiddenHits,
    density: Number((total / Math.max(1, content.split(/\n+/).length)).toFixed(1)),
    passed: score >= 70
  };
}

module.exports = {
  auditLectureStyle
};

