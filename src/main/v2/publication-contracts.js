function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return asArray(items).filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toBlockingIssues(validationResults = []) {
  return asArray(validationResults)
    .filter((item) => item && item.blocking && String(item.message || '').trim())
    .map((item) => String(item.message || '').trim());
}

function buildFrameworkPublicationContract(input = {}) {
  const {
    notebookId,
    notebook,
    framework,
    modules = [],
    schedule = [],
    structureSlots = [],
    discussionDraft = '',
    frameworkArtifactIds = [],
    infographicArtifacts = [],
    buildFrameworkMarkdown,
    mergeDiscussionWithInfographics,
    resolveDiscussionMarkdown
  } = input;

  const sourceArtifactIds = uniqueBy(
    [
      ...frameworkArtifactIds.map((id) => ({ id })),
      ...infographicArtifacts.map((item) => ({ id: item.id }))
    ],
    (item) => String(item.id || '')
  ).map((item) => item.id);

  const missingImageModules = asArray(modules)
    .filter((item) => !(item?.content?.structureImagePath || item?.content?.structureImageUrl))
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean);

  const validationResults = [];
  if (!frameworkArtifactIds.length) {
    validationResults.push({
      id: 'framework-publish-error-1',
      stage: 'framework',
      source: 'publisher',
      severity: 'error',
      blocking: true,
      message: '当前还没有可发布的教学框架产物。'
    });
  }
  if (!structureSlots.length) {
    validationResults.push({
      id: 'framework-publish-warning-1',
      stage: 'framework',
      source: 'publisher',
      severity: 'warning',
      blocking: false,
      message: '当前没有已确认的信息图，导出稿将不包含模块配图。'
    });
  }
  if (missingImageModules.length) {
    validationResults.push({
      id: 'framework-publish-warning-2',
      stage: 'framework',
      source: 'publisher',
      severity: 'warning',
      blocking: false,
      message: `以下模块还没有确认信息图：${missingImageModules.join('、')}`
    });
  }

  const mergedDraft = String(discussionDraft || '').trim()
    ? mergeDiscussionWithInfographics(String(discussionDraft || ''), structureSlots)
    : buildFrameworkMarkdown({ notebook, framework, modules, schedule });
  const resolvedMarkdown = String(discussionDraft || '').trim()
    ? resolveDiscussionMarkdown(mergedDraft, structureSlots)
    : mergedDraft;

  return {
    structureSlots,
    mergedDraft,
    resolvedMarkdown,
    sourceArtifactIds,
    validationResults,
    blockingIssues: toBlockingIssues(validationResults),
    reviewFlags: missingImageModules.length
      ? [{
          id: 'framework-publish-review-1',
          stage: 'framework',
          reason: '存在未确认信息图模块，导出稿完整性需人工复核。'
        }]
      : [],
    sourceRefs: [
      { kind: 'workflow', ref: String(notebookId || ''), label: 'framework-workflow' },
      ...sourceArtifactIds.map((id) => ({ kind: 'artifact', ref: String(id), label: 'framework-source' }))
    ]
  };
}

function buildLecturePublicationContract(input = {}) {
  const {
    notebookId,
    notebook,
    lectureFinalArtifact,
    lectureDraftsArtifact,
    lectureTitle,
    lectureScript = '',
    mergeReport = ''
  } = input;
  const finalScript = String(lectureScript || lectureFinalArtifact?.content?.finalScript || '').trim();
  const validationResults = [];
  if (!lectureFinalArtifact?.confirmed) {
    validationResults.push({
      id: 'lecture-export-error-1',
      stage: 'lecture',
      source: 'publisher',
      severity: 'error',
      blocking: true,
      message: '正式讲稿尚未确认，暂不能导出。'
    });
  }
  if (!finalScript) {
    validationResults.push({
      id: 'lecture-export-error-2',
      stage: 'lecture',
      source: 'publisher',
      severity: 'error',
      blocking: true,
      message: '正式讲稿内容为空，暂不能导出。'
    });
  }
  if (!/教师讲述[:：]/.test(finalScript) || !/课堂动作[:：]/.test(finalScript)) {
    validationResults.push({
      id: 'lecture-export-warning-1',
      stage: 'lecture',
      source: 'publisher',
      severity: 'warning',
      blocking: false,
      message: '正式讲稿缺少标准化“教师讲述 / 课堂动作”结构。'
    });
  }

  const sourceArtifactIds = [lectureDraftsArtifact?.id, lectureFinalArtifact?.id].filter(Boolean);
  return {
    lectureTitle: String(lectureTitle || `正式讲课稿：${notebook?.name || '课程'}`),
    finalScript,
    mergeReport: String(mergeReport || '').trim(),
    sourceArtifactIds,
    validationResults,
    blockingIssues: toBlockingIssues(validationResults),
    reviewFlags: (lectureFinalArtifact?.reviewFlags || []).length
      ? lectureFinalArtifact.reviewFlags
      : validationResults.filter((item) => !item.blocking).map((item, index) => ({
          id: `lecture-export-review-${index + 1}`,
          stage: 'lecture',
          reason: item.message
        })),
    sourceRefs: [
      { kind: 'workflow', ref: String(notebookId || ''), label: 'lecture-workflow' },
      ...sourceArtifactIds.map((id) => ({ kind: 'artifact', ref: String(id), label: 'lecture-source' }))
    ]
  };
}

function buildPptPublicationContract(input = {}) {
  const {
    notebookId,
    outlineArtifact,
    outlineContent = {},
    pptPages = [],
    templateKey,
    lectureScript = '',
    templateBackground = null,
    pageImageArtifacts = []
  } = input;
  const pages = asArray(pptPages).length ? asArray(pptPages) : asArray(outlineContent.pptPages);
  const pptOutline = String(input.pptOutline || outlineContent.pptOutline || '').trim();
  const validationResults = [];
  if (!outlineArtifact?.confirmed) {
    validationResults.push({
      id: 'ppt-export-error-1',
      stage: 'ppt',
      source: 'publisher',
      severity: 'error',
      blocking: true,
      message: 'PPT 页级框架尚未确认，暂不能导出。'
    });
  }
  if (!pages.length) {
    validationResults.push({
      id: 'ppt-export-error-2',
      stage: 'ppt',
      source: 'publisher',
      severity: 'error',
      blocking: true,
      message: 'PPT 页级数据为空，暂不能导出。'
    });
  }
  const missingImagePages = pages
    .filter((page) => page?.needImage && !String(page?.imagePath || page?.imageUrl || '').trim())
    .map((page) => Number(page?.pageNumber) || 0)
    .filter(Boolean);
  if (missingImagePages.length) {
    validationResults.push({
      id: 'ppt-export-warning-1',
      stage: 'ppt',
      source: 'publisher',
      severity: 'warning',
      blocking: false,
      message: `以下需配图页面还没有最终图片：${missingImagePages.join(', ')}`
    });
  }

  const sourceArtifactIds = uniqueBy(
    [outlineArtifact?.id, ...pageImageArtifacts.map((item) => item.id)]
      .filter(Boolean)
      .map((id) => ({ id })),
    (item) => String(item.id || '')
  ).map((item) => item.id);

  // 2026-05-16 v4.1.4 Phase 2：整门课主 accentColor，从 outlineContent.mainAccentColor 取
  const mainAccentColor = String(outlineContent.mainAccentColor || input.mainAccentColor || '').trim();

  return {
    templateKey: String(templateKey || outlineContent.templateKey || 'pro_minimalist'),
    mainAccentColor,
    lectureScript: String(lectureScript || '').trim(),
    pptOutline,
    pptPages: pages,
    templateBackground,
    sourceArtifactIds,
    validationResults,
    blockingIssues: toBlockingIssues(validationResults),
    reviewFlags: (outlineArtifact?.reviewFlags || []).length
      ? outlineArtifact.reviewFlags
      : validationResults.filter((item) => !item.blocking).map((item, index) => ({
          id: `ppt-export-review-${index + 1}`,
          stage: 'ppt',
          reason: item.message
        })),
    sourceRefs: [
      { kind: 'workflow', ref: String(notebookId || ''), label: 'ppt-workflow' },
      ...sourceArtifactIds.map((id) => ({ kind: 'artifact', ref: String(id), label: 'ppt-source' }))
    ]
  };
}

module.exports = {
  buildFrameworkPublicationContract,
  buildLecturePublicationContract,
  buildPptPublicationContract,
  toBlockingIssues
};
