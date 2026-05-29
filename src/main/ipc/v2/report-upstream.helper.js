/**
 * report-upstream.helper.js — v4.3.3 Codex Round 17 · 抽离为独立纯模块
 *
 * 职责（纯函数 · 无 electron / fs / ipc 依赖）：
 *   - 从 db.listArtifacts() 结果里收集 report 阶段需要的 7 个上游 artifact 血缘
 *   - 给 v2:saveReport 新建分支兜底推断 sourceArtifactIds（继承上份 / 重建）
 *
 * 为什么独立成文件：
 *   原本内嵌在 report.handlers.js 里，行为验证只能靠源码字符串扫描；
 *   Codex Round 17 要求"提升到行为可验证"，故抽出 + scripts/ 直接 require 跑 mock db。
 *
 * 上游 7 阶段映射（v4.3.3 8 阶段架构中除 report 自己外的前 7 个）：
 *   { schedule_table, design_doc, ppt_outline, lecture_final, quiz_set, homework_set, video_prompt }
 *
 * 设计原则：
 *   - 纯函数：同一个 db 同一时刻调多次结果一致
 *   - 容错：db 缺 listArtifacts / 上游 artifact 不存在 / 重复存在 都不抛
 *   - 显式：返回结构里包含 source 标记，便于上层 metadata 留诊断
 */

'use strict';

// ── 7 阶段上游 artifact 类型表（按 STAGE_ORDER 顺序）─────────────────────
//   注意：与 STAGE_ORDER 解耦——本表只描述"report 阶段消费的上游 artifact 类型"，
//   未来如果 STAGE_ORDER 增删阶段，本表需要同步调整（断言层会检查 contract 一致）
const UPSTREAM_TYPES = [
  { key: 'schedule', type: 'schedule_table',  stage: 'schedule' },
  { key: 'design',   type: 'design_doc',      stage: 'design'   },
  { key: 'ppt',      type: 'ppt_outline',     stage: 'ppt'      },
  { key: 'lecture',  type: 'lecture_final',   stage: 'lecture'  },
  { key: 'quiz',     type: 'quiz_set',        stage: 'quiz'     },
  { key: 'homework', type: 'homework_set',    stage: 'homework' },
  { key: 'video',    type: 'video_prompt',    stage: 'video'    },
];

// v4.3.3 Codex 审计第1轮（问题5 · 2026-05-29）：报告按节过滤，避免"串课"
//   （第2节设计 + 第5节PPT + 第1节测验拼一起）。
//   lessonNumber 传入时只取该节产物；不传（整门课汇总模式）维持取最新 confirmed。
const { getArtifactLessonNumber } = require('../../v2/artifact-lesson');

function pickLatestConfirmed(artifacts, type, stage, lessonNumber) {
  let pool = artifacts.filter((a) => a && a.type === type && a.stage === stage && a.confirmed);
  // 单节模式：只保留该节产物（解析不到节次的产物视为"通用"，仅在无精确匹配时兜底）
  if (Number.isFinite(Number(lessonNumber)) && Number(lessonNumber) > 0) {
    const ln = Number(lessonNumber);
    const exact = pool.filter((a) => getArtifactLessonNumber(a) === ln);
    if (exact.length > 0) pool = exact;
    else pool = pool.filter((a) => getArtifactLessonNumber(a) === null); // 无节次标注的通用产物兜底
  }
  return pool.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
}

function pickLatest(artifacts, type, stage) {
  return artifacts
    .filter((a) => a && a.type === type && a.stage === stage)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
}

/**
 * 收集 7 个上游 artifact（要求 confirmed=true）。
 * 用于 v2:generateReport 主路径——只挑老师已确认的产物作 hint。
 *
 * @param {Object} db - 必须有 listArtifacts({ notebookId }) 方法
 * @param {number} notebookId
 * @returns {{
 *   ids: number[],
 *   map: { schedule, design, ppt, lecture, quiz, homework, video },
 *   objs: { schedule, design, ppt, lecture, quiz, homework, video },
 *   allArtifacts: Array
 * }}
 */
function collectReportUpstream(db, notebookId, options = {}) {
  // v4.3.3 Codex 审计第1轮（问题5）：options.lessonNumber 传入 → 单节报告（按节过滤）；
  //   不传 → 整门课汇总（取最新 confirmed，原行为）。
  const lessonNumber = options.lessonNumber;
  const allArtifacts = (db && typeof db.listArtifacts === 'function')
    ? (db.listArtifacts({ notebookId }) || [])
    : [];
  const objs = {};
  const map = {};
  UPSTREAM_TYPES.forEach(({ key, type, stage }) => {
    // schedule_table 是整门课产物，不按节过滤
    const ln = (stage === 'schedule') ? undefined : lessonNumber;
    const a = pickLatestConfirmed(allArtifacts, type, stage, ln) || null;
    objs[key] = a;
    map[key] = a?.id || null;
  });
  const ids = Object.values(map).filter((id) => Number.isFinite(id) && id > 0);
  return { ids, map, objs, allArtifacts, lessonNumber: lessonNumber || null };
}

/**
 * 推断 saveReport 新建分支的 sourceArtifactIds（避免 implementation_report
 * validator 标 invalid 的边界 bug）。
 *
 * 推断顺序：
 *   1) 复用最近一份 implementation_report 的 sourceArtifactIds（继承生成时血缘）
 *   2) 从当前 7 个上游 artifact 重建（不强制 confirmed，因老师可能还在改）
 *   3) 都拿不到 → ids=[]，上层据 source='no-upstream-found' + warning 处理
 *
 * @param {Object} db - 必须有 listArtifacts({ notebookId }) 方法
 * @param {number} notebookId
 * @returns {{ ids: number[], source: 'inherit-previous-report'|'rebuild-from-upstream'|'no-upstream-found' }}
 */
function inferReportSourceArtifactIds(db, notebookId) {
  const allArtifacts = (db && typeof db.listArtifacts === 'function')
    ? (db.listArtifacts({ notebookId }) || [])
    : [];

  // 1) 优先复用最近一份 implementation_report 的血缘
  const prevReport = allArtifacts
    .filter((a) => a && a.type === 'implementation_report' && a.stage === 'report')
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
  if (prevReport && Array.isArray(prevReport.sourceArtifactIds) && prevReport.sourceArtifactIds.length > 0) {
    return { ids: prevReport.sourceArtifactIds.slice(), source: 'inherit-previous-report' };
  }

  // 2) 重建：从 7 个上游 artifact 取最新（不要求 confirmed）
  const rebuildIds = UPSTREAM_TYPES
    .map(({ type, stage }) => pickLatest(allArtifacts, type, stage)?.id || null)
    .filter((id) => Number.isFinite(id) && id > 0);
  if (rebuildIds.length > 0) {
    return { ids: rebuildIds, source: 'rebuild-from-upstream' };
  }

  // 3) 完全无上游
  return { ids: [], source: 'no-upstream-found' };
}

module.exports = {
  UPSTREAM_TYPES,
  pickLatestConfirmed,
  pickLatest,
  collectReportUpstream,
  inferReportSourceArtifactIds,
};
