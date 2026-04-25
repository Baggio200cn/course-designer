const STAGE_ORDER = ['framework', 'lecture', 'ppt', 'video'];

const STAGE_REQUIREMENTS = {
  lecture: [
    { type: 'framework_json', stage: 'framework' },
    { type: 'framework_preview_md', stage: 'framework' }
  ],
  ppt: [
    { type: 'lecture_final', stage: 'lecture' }
  ],
  video: [
    { type: 'ppt_outline', stage: 'ppt' }
  ]
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isArtifactConfirmed(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.confirmed !== true) return false;
  return ['confirmed', 'exported', 'review_needed'].includes(String(item.status || ''));
}

function findLatestConfirmedArtifact(artifacts = [], requirement = {}) {
  return asArray(artifacts)
    .filter((item) => item.type === requirement.type && item.stage === requirement.stage && isArtifactConfirmed(item))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0] || null;
}

function computeUnlockedStages(artifacts = []) {
  const unlocked = ['framework'];
  ['lecture', 'ppt', 'video'].forEach((stage) => {
    const requirements = STAGE_REQUIREMENTS[stage] || [];
    const satisfied = requirements.every((requirement) => Boolean(findLatestConfirmedArtifact(artifacts, requirement)));
    if (satisfied) unlocked.push(stage);
  });
  return unlocked;
}

function validateStageTransition({ targetStage, artifacts = [] } = {}) {
  const safeStage = String(targetStage || '').trim();
  const unlockedStages = computeUnlockedStages(artifacts);
  if (!safeStage) {
    return {
      allowed: false,
      unlockedStages,
      blockingIssues: ['目标阶段不能为空'],
      sourceArtifacts: []
    };
  }
  if (!STAGE_ORDER.includes(safeStage)) {
    return {
      allowed: false,
      unlockedStages,
      blockingIssues: [`未知阶段：${safeStage}`],
      sourceArtifacts: []
    };
  }
  if (safeStage === 'framework') {
    return {
      allowed: true,
      unlockedStages,
      blockingIssues: [],
      sourceArtifacts: []
    };
  }
  if (!unlockedStages.includes(safeStage)) {
    const requirements = STAGE_REQUIREMENTS[safeStage] || [];
    const missing = requirements
      .filter((requirement) => !findLatestConfirmedArtifact(artifacts, requirement))
      .map((requirement) => `${requirement.stage}/${requirement.type}`);
    return {
      allowed: false,
      unlockedStages,
      blockingIssues: [`阶段 ${safeStage} 尚未满足前置产物：${missing.join('、')}`],
      sourceArtifacts: []
    };
  }
  const sourceArtifacts = (STAGE_REQUIREMENTS[safeStage] || [])
    .map((requirement) => findLatestConfirmedArtifact(artifacts, requirement))
    .filter(Boolean);
  const blockingIssues = sourceArtifacts
    .flatMap((item) => asArray(item.blockingIssues))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return {
    allowed: blockingIssues.length === 0,
    unlockedStages,
    blockingIssues,
    sourceArtifacts
  };
}

module.exports = {
  STAGE_ORDER,
  STAGE_REQUIREMENTS,
  computeUnlockedStages,
  validateStageTransition,
  isArtifactConfirmed,
  findLatestConfirmedArtifact
};
