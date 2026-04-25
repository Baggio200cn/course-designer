const suggestionMap = [
  {
    key: '不清晰',
    patch: '画面主体清晰，减少背景杂讯，提升前景对比度。'
  },
  {
    key: '太乱',
    patch: '构图简洁，元素数量控制在3个以内，留白充足。'
  },
  {
    key: '不专业',
    patch: '采用职业教育课件风格，信息表达准确，避免夸张特效。'
  },
  {
    key: '风格不对',
    patch: '风格改为现代教学视觉风格，色彩克制，强调可读性。'
  },
  {
    key: '人物失真',
    patch: '人物比例自然，面部真实，避免卡通化处理。'
  }
];

class PromptAdvisorService {
  buildPromptAdvice(sceneType, model, currentPrompt, userFeedback) {
    const feedback = String(userFeedback || '').trim();
    const matched = suggestionMap.filter((item) => feedback.includes(item.key));
    const suggestions = matched.length
      ? matched.map((item) => item.patch)
      : [
          '明确主体、场景、风格和用途。',
          '补充构图要求（近景/中景/远景）与光照要求。',
          '增加禁用项（避免过度装饰、避免文字水印）。'
        ];

    return {
      sceneType,
      model,
      currentPrompt: String(currentPrompt || ''),
      userFeedback: feedback,
      suggestions,
      recommendedPromptSuffix: suggestions.join(' ')
    };
  }

  applyAdviceToPrompt(currentPrompt, advicePatch) {
    const base = String(currentPrompt || '').trim();
    const patch = String(advicePatch || '').trim();
    if (!patch) return base;
    if (!base) return patch;
    return `${base} ${patch}`.trim();
  }
}

module.exports = {
  PromptAdvisorService
};
