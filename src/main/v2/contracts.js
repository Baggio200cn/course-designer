/**
 * contracts.js — Stage 依赖链定义（驭课 Agent v4.0.0 / Phase-9）
 *
 * 【H1 例外审计】
 * 本文件在 v3.x 期间是"只读"的（H1 硬约束）。
 * 2026-05-09 Baggio 显式批准例外：4 阶段 → 6 阶段架构升级。
 * 详见 .claude/notes/2026-05-09-phase9-h1-exception.md
 *
 * 【6 阶段依赖链（驭课 Agent v4.0.0）】
 *   schedule → design → ppt → lecture → quiz → homework → video → report
 *   （v4.3.3 H1 例外 · 8 阶段架构 · 2026-05-18 落地）
 *
 *   - schedule（教学进度表）：18 周排课表（按周次 × 6 列）
 *   - design（教学设计）：课前/课中/课后 + 信息化 + 考核权重
 *   - ppt（教学课件）：页级规划 + 一键批量配图
 *   - lecture（课堂讲稿）：A/B/C → 正式稿（含 Phase-8.5 五段式 / 9 维审核）
 *   - quiz（在线测验）：每页 PPT 末尾 1-2 道题 + 章节末综合题
 *   - homework（课后作业）：基于讲稿要点 + PPT 骨架的作业题
 *   - video（微课视频）：脚本 + 分镜 + 即梦提示词 + 拍摄说明 + 剪辑思路
 *   - report（教学实施报告）：AI 汇总上游 7 阶段产物 + 老师手填反思
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
 *   - report 需要上游 7 阶段（schedule/design/ppt/lecture/quiz/homework/video）按本节实际生成情况汇总
 */

// ── 8 阶段链（v4.3.3 H1 例外 · 2026-05-18） ──────────────────────────────────
//   旧顺序：schedule → design → PPT → 讲稿 → video → report（6 阶段）
//   新顺序：schedule → design → PPT → 讲稿 → quiz → homework → video → report（8 阶段）
//
//   新增：
//     - quiz（在线测验）：每页 PPT 末尾 1-2 道题 + 章节末综合题
//     - homework（课后作业）：基于讲稿要点 + PPT 骨架的作业题
//
//   pedagogical 因果：先讲完再练再考再总结，符合教学闭环
const STAGE_ORDER = ['schedule', 'design', 'ppt', 'lecture', 'quiz', 'homework', 'video', 'report'];

// 每个阶段需要的前置 artifact（按 stage + type 联合查找）
const STAGE_REQUIREMENTS = {
  // schedule 是起点，无前置
  design: [
    { type: 'schedule_table', stage: 'schedule' }
  ],
  ppt: [
    { type: 'design_doc', stage: 'design' }
  ],
  lecture: [
    { type: 'design_doc', stage: 'design' },
    { type: 'ppt_outline', stage: 'ppt' }
  ],
  // v4.3.3：在线测验依赖讲稿 + PPT
  quiz: [
    { type: 'lecture_final', stage: 'lecture' },
    { type: 'ppt_outline', stage: 'ppt' }
  ],
  // v4.3.3：课后作业依赖讲稿（与 quiz 平行）
  homework: [
    { type: 'lecture_final', stage: 'lecture' }
  ],
  // 微课视频保留旧依赖：只需讲稿（quiz/homework 可跳过）
  video: [
    { type: 'lecture_final', stage: 'lecture' }
  ],
  // 实施报告需要前 7 阶段全部完成
  report: [
    { type: 'schedule_table', stage: 'schedule' },
    { type: 'design_doc', stage: 'design' },
    { type: 'ppt_outline', stage: 'ppt' },
    { type: 'lecture_final', stage: 'lecture' },
    { type: 'quiz_set', stage: 'quiz' },
    { type: 'homework_set', stage: 'homework' },
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
  // 2026-05-16 v4.2.0 Phase A'：用 STAGE_ORDER 而不是硬编码顺序，跟随顺序调整
  STAGE_ORDER.slice(1).forEach((stage) => {
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

// ── 单一来源 · stage → 主要 artifact type（v4.3.3 Codex #1+#3 收口） ───────────
//   force-unlock / workbench / sessionContext 都必须从这取，不再各自硬编码
const STAGE_PRIMARY_TYPE = {
  schedule: 'schedule_table',
  design:   'design_doc',
  ppt:      'ppt_outline',
  lecture:  'lecture_final',
  quiz:     'quiz_set',
  homework: 'homework_set',
  video:    'video_prompt',          // 注意：真实是 video_prompt，旧 micro_video_plan 已废
  report:   'implementation_report',
};

// 中文标题（多处用，统一）
const STAGE_TITLE = {
  schedule: '教学进度表',
  design:   '教学设计',
  ppt:      '教学课件',
  lecture:  '课堂讲稿',
  quiz:     '在线测验',
  homework: '课后作业',
  video:    '微课视频',
  report:   '教学实施报告',
};

// v4.3.3 Codex Round 5 #5（2026-05-18）：单一来源 · artifact type → 显示标签
//   workbench / 教师日志 / 历史 modal 等多处用，全部 require 这个常量
const ARTIFACT_TYPE_LABEL = {
  // schedule
  schedule_table:        '📅 教学进度表',
  schedule_export_word:  '📅 进度表 Word',
  // design
  design_doc:            '🎯 教学设计',
  design_infographic:    '🎯 设计信息图',
  design_export_word:    '🎯 设计 Word',
  // ppt
  ppt_outline:           '📊 PPT 大纲',
  ppt_page_image:        '📊 PPT 页图',
  ppt_export_file:       '📊 PPT 文件',
  // lecture
  lecture_drafts:        '🎤 讲稿草稿',
  lecture_final:         '🎤 正式讲稿',
  lecture_export_word:   '🎤 讲稿 Word',
  // quiz (v4.3.3 新)
  quiz_set:              '📝 在线测验',
  // homework (v4.3.3 新)
  homework_set:          '📚 课后作业',
  // video（v4.3.3 主类型是 video_prompt，micro_video_plan 是 legacy alias）
  video_prompt:          '🎬 微课视频方案',
  micro_video_plan:      '🎬 微课视频方案（老）',  // legacy 兼容
  // report
  implementation_report: '📝 实施报告',
};

// v4.3.3 Codex Round 5 #5：stage → 所有相关 artifact types（含 legacy alias）
//   workbench 用于 stage 分组展示
const ARTIFACT_TYPES_BY_STAGE = {
  schedule: ['schedule_table', 'schedule_export_word'],
  design:   ['design_doc', 'design_infographic', 'design_export_word'],
  ppt:      ['ppt_outline', 'ppt_page_image', 'ppt_export_file'],
  lecture:  ['lecture_final', 'lecture_drafts', 'lecture_export_word'],
  quiz:     ['quiz_set'],
  homework: ['homework_set'],
  // video: 新主类型 video_prompt，老 micro_video_plan 作为 legacy alias
  video:    ['video_prompt', 'micro_video_plan'],
  report:   ['implementation_report'],
};

module.exports = {
  STAGE_ORDER,
  STAGE_ORDER_LEGACY_V3,    // 暴露旧 4 阶段供需要的代码读（不要写入）
  STAGE_REQUIREMENTS,
  STAGE_PRIMARY_TYPE,       // v4.3.3 新增 · 单一来源
  STAGE_TITLE,              // v4.3.3 新增 · 单一来源
  ARTIFACT_TYPE_LABEL,      // v4.3.3 Codex Round 5 #5 新增 · 单一来源
  ARTIFACT_TYPES_BY_STAGE,  // v4.3.3 Codex Round 5 #5 新增 · 单一来源
  computeUnlockedStages,
  validateStageTransition,
  isArtifactConfirmed,
  findLatestConfirmedArtifact
};
