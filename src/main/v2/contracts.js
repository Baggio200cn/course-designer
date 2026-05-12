/**
 * contracts.js — Stage 依赖链定义（驭课 Agent v4.0.0 / Phase-9）
 *
 * 【H1 例外审计】
 * 本文件在 v3.x 期间是"只读"的（H1 硬约束）。
 * 2026-05-09 Baggio 显式批准例外：4 阶段 → 6 阶段架构升级。
 * 详见 .claude/notes/2026-05-09-phase9-h1-exception.md
 *
 * 【6 阶段依赖链（驭课 Agent v4.0.0）】
 *   schedule → design → lecture → ppt → video → report
 *
 *   - schedule（教学进度表）：18 周排课表（按周次 × 6 列）
 *   - design（教学设计）：课前/课中/课后 + 信息化 + 考核权重
 *   - lecture（课堂讲稿）：A/B/C → 正式稿（含 Phase-8.5 五段式 / 9 维审核）
 *   - ppt（教学课件）：页级规划 + 一键批量配图
 *   - video（微课视频）：脚本 + 分镜 + 即梦提示词 + 拍摄说明 + 剪辑思路
 *   - report（教学实施报告）：AI 汇总前 5 阶段 + 老师手填反思
 *
 * 【与旧 v3.x 的差异】
 *   - 旧：framework → lecture → ppt → video（4 阶段）
 *   - 旧的 framework 已拆分：原"教学框架文档"的"教学进度"小节升级为独立 schedule，
 *     其余教学目标/教学方法/课前课中课后等下沉到 design 阶段
 *   - 旧的 framework_json / framework_preview_md artifact_type 在新版数据库中不再使用
 *     （数据已按 Phase-9 用户许可全部清空）
 *
 * 【Stage 依赖原则】
 *   - 上一阶段必须 confirmed=true 才能解锁下一阶段
 *   - schedule 是起点（无前置）
 *   - report 需要前 5 阶段全部 confirmed 才能生成（汇总用）
 */

// ── 6 阶段链 ─────────────────────────────────────────────────────────────────
const STAGE_ORDER = ['schedule', 'design', 'lecture', 'ppt', 'video', 'report'];

// 每个阶段需要的前置 artifact（按 stage + type 联合查找）
const STAGE_REQUIREMENTS = {
  // schedule 是起点，无前置
  design: [
    { type: 'schedule_table', stage: 'schedule' }
  ],
  lecture: [
    { type: 'design_doc', stage: 'design' }
  ],
  ppt: [
    { type: 'lecture_final', stage: 'lecture' }
  ],
  video: [
    { type: 'ppt_outline', stage: 'ppt' }
  ],
  report: [
    // 实施报告需要前 5 阶段全部完成
    { type: 'schedule_table', stage: 'schedule' },
    { type: 'design_doc', stage: 'design' },
    { type: 'lecture_final', stage: 'lecture' },
    { type: 'ppt_outline', stage: 'ppt' },
    { type: 'video_prompt', stage: 'video' }
  ]
};

// 仅供向后兼容：旧 v3.x 4 阶段引用（已废弃，新代码不要依赖）
const STAGE_ORDER_LEGACY_V3 = ['framework', 'lecture', 'ppt', 'video'];

// ── 工具函数 ─────────────────────────────────────────────────────────────────

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

// ── 解锁状态计算 ──────────────────────────────────────────────────────────────

/**
 * 根据当前 artifacts 计算解锁的阶段列表
 *
 * v4.0.0：起点是 schedule（不再是 framework）
 *
 * @param {Array} artifacts - 笔记本的全部 artifacts
 * @returns {Array<string>} 已解锁的阶段名（如 ['schedule', 'design', 'lecture']）
 */
function computeUnlockedStages(artifacts = []) {
  const unlocked = ['schedule'];  // 起点永远解锁
  // 按依赖顺序逐个检查
  ['design', 'lecture', 'ppt', 'video', 'report'].forEach((stage) => {
    const requirements = STAGE_REQUIREMENTS[stage] || [];
    const satisfied = requirements.every((requirement) => Boolean(findLatestConfirmedArtifact(artifacts, requirement)));
    if (satisfied) unlocked.push(stage);
  });
  return unlocked;
}

// ── Stage 转换合法性校验 ──────────────────────────────────────────────────────

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
      blockingIssues: [`未知阶段：${safeStage}（v4.0.0 只接受：${STAGE_ORDER.join(' / ')}）`],
      sourceArtifacts: []
    };
  }

  // schedule 是起点，永远允许进入
  if (safeStage === 'schedule') {
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

  // 收集源 artifact 的 blockingIssues
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
  STAGE_ORDER_LEGACY_V3,    // 暴露旧 4 阶段供需要的代码读（不要写入）
  STAGE_REQUIREMENTS,
  computeUnlockedStages,
  validateStageTransition,
  isArtifactConfirmed,
  findLatestConfirmedArtifact
};
