function nonEmpty(value) {
  return String(value || '').trim();
}

function headingCount(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => /^##?\s+|^【.+】$/.test(String(line || '').trim()))
    .length;
}

function effectiveCharCount(text) {
  return String(text || '').replace(/\s+/g, '').length;
}

function repeatedGreetingCount(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => /大家好|同学们好|欢迎来到今天的课堂/.test(line))
    .length;
}

function teacherNarrationCharCount(text) {
  const lines = String(text || '').split(/\r?\n/);
  const parts = [];
  let mode = '';
  lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    if (/^##?\s+/.test(trimmed) || /^【.+】$/.test(trimmed)) {
      mode = '';
      return;
    }
    if (/^教师讲述[:：]/.test(trimmed)) {
      mode = 'spoken';
      return;
    }
    if (/^课堂动作/.test(trimmed)) {
      mode = 'actions';
      return;
    }
    if (mode === 'spoken') parts.push(trimmed.replace(/^[-*•]\s*/, ''));
  });
  return parts.join('').replace(/\s+/g, '').length;
}

function hasLectureStructure(text) {
  const normalized = String(text || '');
  return /^#\s+.+/m.test(normalized)
    && /教师讲述[:：]/.test(normalized)
    && /课堂动作/.test(normalized)
    && /课堂练习/.test(normalized)
    && /总结收束/.test(normalized);
}

function duplicateActionCount(text) {
  const lines = String(text || '').split(/\r?\n/);
  const actions = [];
  let mode = '';
  lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (/^教师讲述[:：]/.test(trimmed)) { mode = 'spoken'; return; }
    if (/^课堂动作/.test(trimmed)) { mode = 'action'; return; }
    if (/^##?\s+/.test(trimmed)) { mode = ''; return; }
    if (mode === 'action' && trimmed) {
      actions.push(trimmed.replace(/^[-*•]\s*/, '').trim());
    }
  });
  const seen = new Map();
  let dupes = 0;
  actions.forEach((a) => {
    const key = a.replace(/\s+/g, '');
    if (seen.has(key)) dupes++;
    else seen.set(key, true);
  });
  return dupes;
}

function duplicateKnowledgePointCount(text) {
  const lines = String(text || '').split(/\r?\n/);
  const narrations = [];
  let mode = '';
  lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (/^教师讲述[:：]/.test(trimmed)) { mode = 'spoken'; return; }
    if (/^课堂动作/.test(trimmed)) { mode = 'action'; return; }
    if (/^##?\s+/.test(trimmed)) { mode = ''; return; }
    if (mode === 'spoken' && trimmed) narrations.push(trimmed);
  });
  const fullText = narrations.join(' ');
  const sentences = fullText.split(/[。！？]/).filter(Boolean);
  const seen = new Map();
  let dupes = 0;
  sentences.forEach((s) => {
    const key = s.replace(/\s+/g, '').substring(0, 20);
    if (key.length < 8) return;
    if (seen.has(key)) dupes++;
    else seen.set(key, true);
  });
  return dupes;
}

function transitionWordCoverage(text) {
  const required = ['首先', '接着', '因此', '最后'];
  const found = required.filter((w) => String(text || '').includes(w));
  return { total: required.length, found: found.length, missing: required.filter((w) => !found.includes(w)) };
}

function questionDensity(text) {
  const questions = String(text || '').match(/[？?]/g) || [];
  return questions.length;
}

function garbageSentenceCount(text) {
  const patterns = [
    /大家好，欢迎来到今天的课堂/g,
    /这一段先把.*讲透/g,
    /第\s*\d+\s*段必须/g,
  ];
  let count = 0;
  patterns.forEach((p) => { count += (String(text || '').match(p) || []).length; });
  return count;
}

/**
 * 返回触发垃圾模板句检测的详细信息，用于向用户展示具体问题和修改建议
 * @returns {{ text: string, fix: string }[]}
 */
function findGarbageSentenceDetails(text) {
  const PATTERNS = [
    {
      re: /大家好，欢迎来到今天的课堂/g,
      fix: '在"讲稿补充要求"中写：开场不要使用"大家好，欢迎来到今天的课堂"，请用具体情境或问题切入代替。'
    },
    {
      re: /这一段先把.*讲透/g,
      fix: '在"讲稿补充要求"中写：删除"这一段先把……讲透"类写作指令，直接呈现讲述内容。'
    },
    {
      re: /第\s*\d+\s*段必须/g,
      fix: '在"讲稿补充要求"中写：删除"第X段必须……"类段落编写指令，直接生成对应段落内容。'
    }
  ];
  const details = [];
  PATTERNS.forEach(({ re, fix }) => {
    const matches = String(text || '').match(re) || [];
    matches.forEach((m) => details.push({ text: m, fix }));
  });
  return details;
}

function validateLectureStage(lectureData = {}, options = {}) {
  const requireFinal = Boolean(options.requireFinal);
  const totalHours = Number(options.totalHours) || 1;
  const minNarration = Math.round(2200 * totalHours);
  const maxNarration = Math.round(3000 * totalHours);
  const errors = [];
  const warnings = [];
  const reviewReasons = [];
  const drafts = lectureData && typeof lectureData.drafts === 'object' ? lectureData.drafts : {};
  const draftChecks = ['a', 'b', 'c'].reduce((acc, key) => {
    const text = nonEmpty(drafts[key]);
    acc[key] = {
      hasContent: Boolean(text),
      hasStructure: hasLectureStructure(text),
      narrationChars: teacherNarrationCharCount(text)
    };
    return acc;
  }, {});
  const draftCount = ['a', 'b', 'c'].filter((key) => nonEmpty(drafts[key])).length;
  const finalScript = nonEmpty(lectureData.finalScript);
  const finalCharCount = effectiveCharCount(finalScript);
  const finalNarrationCharCount = teacherNarrationCharCount(finalScript);
  const greetingCount = repeatedGreetingCount(finalScript);
  const dupActions = duplicateActionCount(finalScript);
  const dupKnowledge = duplicateKnowledgePointCount(finalScript);
  const transitions = transitionWordCoverage(finalScript);
  const questions = questionDensity(finalScript);
  const garbageCount = garbageSentenceCount(finalScript);
  const garbageDetails = garbageCount > 0 ? findGarbageSentenceDetails(finalScript) : [];
  const leakedMetaPatterns = [
    /这一段先把/,
    /第\s*\d+\s*段必须/,
    /写作要求/,
    /风格提醒/,
    /目标聚焦/,
    /任务起点/,
    /时间[:：]/,
    /教师示范/,
    /板书关键词/,
    /课堂检查重点/,
    /常用.+带课堂/,
    /经常用.+带课堂/,
    /开场必须包含/,
    /结尾必须/
  ].filter((pattern) => pattern.test(finalScript));

  if (draftCount === 0) warnings.push('讲稿 A/B/C 草稿尚未生成');
  else if (draftCount < 3) {
    warnings.push('讲稿 A/B/C 草稿未全部生成');
    reviewReasons.push('讲稿草稿未完整生成，建议补齐后再确认正式稿。');
  }
  ['a', 'b', 'c'].forEach((key) => {
    if (!draftChecks[key].hasContent) return;
    if (!draftChecks[key].hasStructure) {
      warnings.push(`${key.toUpperCase()} 稿缺少完整讲稿结构`);
      reviewReasons.push(`当前 ${key.toUpperCase()} 稿仍不像完整候选讲稿，建议重新生成后再选稿。`);
    }
    if (draftChecks[key].narrationChars > 0 && draftChecks[key].narrationChars < 1000) {
      warnings.push(`${key.toUpperCase()} 稿教师讲述字数偏少（当前约 ${draftChecks[key].narrationChars} 字）`);
      reviewReasons.push(`当前 ${key.toUpperCase()} 稿内容过少（不足1000字），建议重新生成。`);
    }
    if (draftChecks[key].narrationChars > 4000) {
      warnings.push(`${key.toUpperCase()} 稿教师讲述字数偏多（当前约 ${draftChecks[key].narrationChars} 字）`);
      reviewReasons.push(`当前 ${key.toUpperCase()} 稿字数较多，正式稿合成时会自动压缩到目标区间。`);
    }
  });
  if (!nonEmpty(lectureData.selectedDraft)) warnings.push('尚未选择基础稿');

  if (requireFinal && !finalScript) {
    errors.push('正式讲稿不能为空');
  } else if (!finalScript) {
    warnings.push('正式讲稿尚未生成');
  } else {
    if (!/教师讲述[:：]/.test(finalScript) || !/课堂动作/.test(finalScript)) {
      const message = '正式讲稿缺少”教师讲述 / 课堂动作”结构';
      if (requireFinal) errors.push(message);
      else warnings.push(message);
      reviewReasons.push('正式讲稿结构不完整，建议人工检查课堂执行表达。');
    }
    if (headingCount(finalScript) < 6) {
      const message = '正式讲稿章节偏少，可能没有形成完整课堂流程';
      if (requireFinal) errors.push(message);
      else warnings.push(message);
      reviewReasons.push('正式讲稿章节结构偏弱，建议人工确认开场、模块、练习、总结是否齐全。');
    }
    if (finalNarrationCharCount < minNarration) {
      const message = `正式讲稿教师讲述字数偏少（当前约 ${finalNarrationCharCount} 字，${totalHours}学时建议≥${minNarration}字）`;
      // 字数不足改为警告而非阻塞，允许老师确认后继续
      warnings.push(message);
      reviewReasons.push(`正式讲稿教师口播量偏少（${totalHours}学时建议${minNarration}-${maxNarration}字），建议人工补充或重新生成。`);
    }
    if (finalNarrationCharCount > maxNarration) {
      const message = `正式讲稿教师讲述字数偏多（当前约 ${finalNarrationCharCount} 字，${totalHours}学时建议≤${maxNarration}字）`;
      // 字数超标也改为警告
      warnings.push(message);
      reviewReasons.push(`正式讲稿教师口播量超出建议范围，可适当精简。`);
    }
    if (/教师讲述[:：]\s*\n\s*-\s*/.test(finalScript)) {
      const message = '正式讲稿教师讲述仍是逐条短句，尚未整理为正文段落';
      if (requireFinal) errors.push(message);
      else warnings.push(message);
      reviewReasons.push('正式讲稿讲述区仍偏提词卡，建议整理为连续段落。');
    }
    if (leakedMetaPatterns.length) {
      const message = '正式讲稿仍包含元提示或执行说明，未完全清洗成教师口播';
      if (requireFinal) errors.push(message);
      else warnings.push(message);
      reviewReasons.push('正式讲稿混入了写作提示或执行元语句，建议人工复核。');
    }
    if (greetingCount > 1) {
      const message = `正式讲稿开场寒暄重复（检测到 ${greetingCount} 处问候语）`;
      if (requireFinal) errors.push(message);
      else warnings.push(message);
      reviewReasons.push('正式讲稿开场存在重复署名或寒暄，建议人工复核。');
    }
    if (dupActions > 2) {
      warnings.push(`正式讲稿课堂动作重复（${dupActions} 处重复动作）`);
      reviewReasons.push('正式讲稿课堂动作存在重复，建议人工精简。');
    }
    if (dupKnowledge > 3) {
      warnings.push(`正式讲稿知识点表述重复（${dupKnowledge} 处相似句子）`);
      reviewReasons.push('正式讲稿教师讲述中存在重复表述，建议人工精简。');
    }
    if (garbageCount > 0) {
      const firstDetail = garbageDetails[0];
      const sampleText = firstDetail ? `「${firstDetail.text.slice(0, 20)}」` : '';
      const message = `正式讲稿包含 ${garbageCount} 处垃圾模板句${sampleText ? '，检测到：' + sampleText : ''}`;
      if (requireFinal) errors.push(message);
      else warnings.push(message);
      const fixHint = firstDetail ? firstDetail.fix : '建议在补充要求中说明开场方式，避免通用模板句。';
      reviewReasons.push(`正式讲稿混入了垃圾模板句。修改建议：${fixHint}`);
    }
    if (transitions.found < 2) {
      warnings.push(`推进词覆盖不足（仅覆盖 ${transitions.found}/${transitions.total}：缺少${transitions.missing.join('、')}）`);
      reviewReasons.push('正式讲稿推进词密度偏低，课堂推进节奏可能不清晰。');
    }
    if (questions < 3) {
      warnings.push(`提问句偏少（当前 ${questions} 个提问，建议至少 5 个）`);
      reviewReasons.push('正式讲稿提问密度偏低，建议增加课堂互动环节。');
    }
  }

  return {
    stage: 'lecture',
    valid: errors.length === 0,
    errors,
    warnings,
    reviewNeeded: reviewReasons.length > 0,
    reviewReasons,
    checks: {
      draftCount,
      draftChecks,
      hasFinalScript: Boolean(finalScript),
      finalCharCount,
      finalNarrationCharCount,
      leakedMetaCount: leakedMetaPatterns.length,
      greetingCount,
      duplicateActions: dupActions,
      duplicateKnowledge: dupKnowledge,
      garbageSentences: garbageCount,
      transitionCoverage: transitions,
      questionCount: questions
    }
  };
}

function validatePptStage(pptData = {}, options = {}) {
  const requirePages = Boolean(options.requirePages);
  const errors = [];
  const warnings = [];
  const reviewReasons = [];
  const pptPages = Array.isArray(pptData.pptPages) ? pptData.pptPages : [];
  const pagesMissingTitle = [];
  const pagesMissingSummary = [];
  const pagesMissingImagePrompt = [];

  pptPages.forEach((page, index) => {
    const pageNumber = Number(page.pageNumber) || index + 1;
    if (!nonEmpty(page.title)) pagesMissingTitle.push(pageNumber);
    if (!nonEmpty(page.summary)) pagesMissingSummary.push(pageNumber);
    if (page.needImage && !nonEmpty(page.imagePrompt)) pagesMissingImagePrompt.push(pageNumber);
  });

  if (requirePages && pptPages.length === 0) errors.push('PPT 页级框架不能为空');
  else if (pptPages.length === 0) warnings.push('PPT 页级框架尚未生成');
  if (pagesMissingTitle.length) {
    warnings.push(`以下页面缺少标题：${pagesMissingTitle.join(', ')}`);
    reviewReasons.push('部分 PPT 页面标题缺失，建议人工复核页级结构。');
  }
  if (pagesMissingSummary.length) {
    warnings.push(`以下页面缺少摘要：${pagesMissingSummary.join(', ')}`);
    reviewReasons.push('部分 PPT 页面摘要缺失，建议人工补齐讲解目标。');
  }
  if (pagesMissingImagePrompt.length) {
    warnings.push(`以下需配图页面缺少插图提示词：${pagesMissingImagePrompt.join(', ')}`);
    reviewReasons.push('存在需配图页面未给出插图提示词，建议人工检查配图链路。');
  }

  return {
    stage: 'ppt',
    valid: errors.length === 0,
    errors,
    warnings,
    reviewNeeded: reviewReasons.length > 0,
    reviewReasons,
    checks: {
      pageCount: pptPages.length,
      pagesMissingTitle,
      pagesMissingSummary,
      pagesMissingImagePrompt
    }
  };
}

function validateVideoStage(videoData = {}, options = {}) {
  const requirePrompt = Boolean(options.requirePrompt);
  const errors = [];
  const warnings = [];
  const reviewReasons = [];
  const promptText = nonEmpty(videoData.promptText);
  const style = nonEmpty(videoData.style);
  const engine = String(videoData.engine || 'jimeng');

  if (requirePrompt && !promptText) errors.push('视频提示词不能为空');
  else if (!promptText) warnings.push('视频提示词尚未生成');
  if (!style) warnings.push('视频风格未设置，将使用默认风格');
  if (!['jimeng', 'pexo'].includes(engine)) {
    warnings.push('视频引擎配置异常，已偏离默认桥接方案');
    reviewReasons.push('视频引擎配置异常，建议人工确认外部平台桥接设置。');
  }

  return {
    stage: 'video',
    valid: errors.length === 0,
    errors,
    warnings,
    reviewNeeded: reviewReasons.length > 0,
    reviewReasons,
    checks: {
      hasPromptText: Boolean(promptText),
      engine
    }
  };
}

module.exports = {
  validateLectureStage,
  validatePptStage,
  validateVideoStage
};
