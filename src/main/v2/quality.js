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

// Phase-7.7 B9（2026-04-29）：行首"教师讲述/课堂动作"标记识别 helper
// 修复 AI 用 markdown 标题（### 教师讲述：）输出时 narrationCharCount=0 的根因。
// 兼容 4 种格式：
//   "教师讲述："              ← 老格式 / fallback 文本
//   "教师讲述:"                ← 半角冒号
//   "### 教师讲述"             ← AI 实际输出（H3 标题，无冒号）
//   "### 教师讲述："           ← AI 实际输出（H3 标题 + 全角冒号）
//   "## 教师讲述："            ← 也兼容 H2
function isSpokenLineMarker(line) {
  const t = String(line || '').trim();
  // 老格式：行首直接 + 必有冒号
  if (/^教师讲述[:：]/.test(t)) return true;
  // 新格式：markdown 标题（1-4 个 #）+ 教师讲述 + 冒号可选 + 独占一行
  if (/^#{1,4}\s+教师讲述\s*[:：]?\s*$/.test(t)) return true;
  return false;
}
function isActionLineMarker(line) {
  const t = String(line || '').trim();
  if (/^课堂动作/.test(t)) return true;
  if (/^#{1,4}\s+课堂动作/.test(t)) return true;
  return false;
}
// 章节标题判断（H1/H2，不含 H3——H3 留给"教师讲述/课堂动作"标记）
function isSectionLineMarker(line) {
  const t = String(line || '').trim();
  return /^#{1,2}\s+/.test(t) || /^【.+】$/.test(t);
}

function teacherNarrationCharCount(text) {
  const lines = String(text || '').split(/\r?\n/);
  const parts = [];
  let mode = '';
  lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    if (isSectionLineMarker(trimmed)) {
      mode = '';
      return;
    }
    if (isSpokenLineMarker(trimmed)) {
      mode = 'spoken';
      return;
    }
    if (isActionLineMarker(trimmed)) {
      mode = 'actions';
      return;
    }
    if (mode === 'spoken') parts.push(trimmed.replace(/^[-*•]\s*/, ''));
  });
  return parts.join('').replace(/\s+/g, '').length;
}

function hasLectureStructure(text) {
  const normalized = String(text || '');
  // B9 续：AI 用 `### 教师讲述`（无冒号）输出时，原 /教师讲述[:：]/ 要求冒号会误判为缺结构。
  // 改为：只要文本里出现"教师讲述"+"课堂动作"+"课堂练习"+"总结收束"四个关键词即可。
  return /^#\s+.+/m.test(normalized)
    && /教师讲述/.test(normalized)
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
    // B9：用统一的 helper（同时识别 markdown 标题前缀）
    if (isSpokenLineMarker(trimmed)) { mode = 'spoken'; return; }
    if (isActionLineMarker(trimmed)) { mode = 'action'; return; }
    if (isSectionLineMarker(trimmed)) { mode = ''; return; }
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
    // B9：统一的标记识别 helper
    if (isSpokenLineMarker(trimmed)) { mode = 'spoken'; return; }
    if (isActionLineMarker(trimmed)) { mode = 'action'; return; }
    if (isSectionLineMarker(trimmed)) { mode = ''; return; }
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
    // B9 续：AI 用 `### 教师讲述`（无冒号）输出时，原 /教师讲述[:：]/ 要求冒号会误判为缺结构。
    // 改为只检查关键词存在（"教师讲述" + "课堂动作"），冒号可选。
    if (!/教师讲述/.test(finalScript) || !/课堂动作/.test(finalScript)) {
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
      // Phase-7.7 P0-A 修复（H10 / R6 精神）：字数严重不足升 error 触发 pauseAgent；轻微不足保持 warning
      // 严重阈值：< 70% minNarration（与 retry-loop.isAcceptable 同口径，保证两层校验一致）
      const severelyShort = finalNarrationCharCount < minNarration * 0.7;
      const message = `正式讲稿教师讲述字数${severelyShort ? '严重' : ''}偏少（当前约 ${finalNarrationCharCount} 字，${totalHours}学时建议≥${minNarration}字）`;
      if (severelyShort && requireFinal) {
        errors.push(message);   // confirm 阶段严重不足直接阻塞，让 Agent 走 pauseAgent
      } else {
        warnings.push(message);
      }
      reviewReasons.push(`正式讲稿教师口播量偏少（${totalHours}学时建议${minNarration}-${maxNarration}字），建议人工补充或重新生成。`);
    }
    if (finalNarrationCharCount > maxNarration) {
      // 字数超标：超标 30% 以上升 error，否则 warning
      const severelyLong = finalNarrationCharCount > maxNarration * 1.3;
      const message = `正式讲稿教师讲述字数${severelyLong ? '严重' : ''}偏多（当前约 ${finalNarrationCharCount} 字，${totalHours}学时建议≤${maxNarration}字）`;
      if (severelyLong && requireFinal) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
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
  // Phase-7.6 R6：confirm 阶段（requirePages=true）严格校验，save 阶段宽松
  const strict = requirePages || options.strictMode === true;
  // Phase-7.7 P1-C：传入 totalHours 时启用页数门槛校验
  const totalHours = Number(options.totalHours) || 0;

  const errors = [];
  const warnings = [];
  const reviewReasons = [];
  const pptPages = Array.isArray(pptData.pptPages) ? pptData.pptPages : [];
  const pagesMissingTitle = [];
  const pagesMissingSummary = [];
  const pagesMissingImagePrompt = [];
  const pagesMissingSourceSection = [];     // R5+R6：PPT 必须能对应到讲稿章节
  const needsManualReviewPages = [];         // R6：被 Vision 标记为人工审核的页面

  pptPages.forEach((page, index) => {
    const pageNumber = Number(page.pageNumber) || index + 1;
    if (!nonEmpty(page.title)) pagesMissingTitle.push(pageNumber);
    if (!nonEmpty(page.summary)) pagesMissingSummary.push(pageNumber);
    if (page.needImage && !nonEmpty(page.imagePrompt)) pagesMissingImagePrompt.push(pageNumber);
    if (page.needImage && !nonEmpty(page.sourceSection)) pagesMissingSourceSection.push(pageNumber);
    // R6：识别 manual_review 标记（M7.5.5 PPT 配图 vision 审核失败时由 pipeline 标记）
    if (page.qualityStatus === 'manual_review' || page.needsManualReview === true) {
      needsManualReviewPages.push(pageNumber);
    }
  });

  if (requirePages && pptPages.length === 0) errors.push('PPT 页级框架不能为空');
  else if (pptPages.length === 0) warnings.push('PPT 页级框架尚未生成');

  // Phase-7.7 P1-C：页数门槛校验
  if (totalHours > 0 && pptPages.length > 0) {
    const expectedMin = totalHours <= 1 ? 8 : totalHours <= 2 ? 14 : totalHours <= 4 ? 22 : 30;
    const expectedMax = totalHours <= 1 ? 12 : totalHours <= 2 ? 18 : totalHours <= 4 ? 30 : 40;
    // 严重不足：< 60% 的最小期望页数
    if (pptPages.length < expectedMin * 0.6) {
      const msg = `PPT 页数严重不足（实际 ${pptPages.length} 页，${totalHours} 学时建议 ${expectedMin}-${expectedMax} 页）`;
      if (strict) errors.push(msg);
      else warnings.push(msg);
      reviewReasons.push(`PPT 页数远低于学时建议，可能讲稿过短或 AI 规划失误。`);
    } else if (pptPages.length < expectedMin) {
      // 轻微不足：< minimum 但 ≥ 60%
      warnings.push(`PPT 页数偏少（实际 ${pptPages.length} 页，${totalHours} 学时建议 ${expectedMin}-${expectedMax} 页）`);
    }
  }

  if (pagesMissingTitle.length) {
    // R6：confirm 阶段标题缺失升 error（PPT 没标题不能用）
    const msg = `以下页面缺少标题：${pagesMissingTitle.join(', ')}`;
    if (strict) errors.push(msg);
    else warnings.push(msg);
    reviewReasons.push('部分 PPT 页面标题缺失，建议人工复核页级结构。');
  }
  if (pagesMissingSummary.length) {
    warnings.push(`以下页面缺少摘要：${pagesMissingSummary.join(', ')}`);
    reviewReasons.push('部分 PPT 页面摘要缺失，建议人工补齐讲解目标。');
  }
  if (pagesMissingImagePrompt.length) {
    // R6 关键：confirm 阶段配图缺失升 error（不能让"应该有图但没图"的 PPT 通过）
    const msg = `以下需配图页面缺少插图提示词：${pagesMissingImagePrompt.join(', ')}`;
    if (strict) errors.push(msg);
    else warnings.push(msg);
    reviewReasons.push('存在需配图页面未给出插图提示词，建议人工检查配图链路。');
  }
  if (pagesMissingSourceSection.length) {
    // Phase-7.7 G2（2026-04-30）：sourceSection 缺失从 error 降为 warning
    //   原 R6 设计：sourceSection 缺失 → confirm 阶段升 error 阻塞
    //   实测发现：AI 生成 ppt-plan 时大概率漏填 sourceSection（即使 prompt 强约束）
    //              老师手动编辑 PPT 后该字段更不会重新关联
    //              结果：12 页配图全好的 PPT，老师无法点【确认】，被卡死
    //   现在：仅 warning，让老师能 confirm；提示老师后续手动核对章节关联
    //   保留 R6 原意：reviewReasons 仍记录该问题供 UI 显示"建议核对"
    const msg = `以下需配图页面缺少 sourceSection（与讲稿章节关联缺失，建议手动核对）：${pagesMissingSourceSection.join(', ')}`;
    warnings.push(msg);
    // 不再走 strict → errors 路径
    reviewReasons.push('部分 PPT 页面未对应到讲稿章节，可能内容偏题。');
  }
  if (needsManualReviewPages.length > 0) {
    // R6：Vision 审核标 manual_review 的页面阻塞 confirm
    errors.push(`以下页面 Vision 审核未通过、需人工审核：${needsManualReviewPages.join(', ')}`);
    reviewReasons.push(`${needsManualReviewPages.length} 个页面被 Vision 审核标为人工审核，必须先处理。`);
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
      pagesMissingImagePrompt,
      pagesMissingSourceSection,        // R5
      needsManualReviewCount: needsManualReviewPages.length,    // R6
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
