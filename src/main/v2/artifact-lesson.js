/**
 * artifact-lesson.js — v4.3.3 Bug1 真根因修复（codex 审计 2026-05-29）
 *
 * 统一的"从 artifact 解析节次（lessonNumber）"工具，供 quiz / homework / ppt /
 * lecture / report 等所有需要按节匹配的地方共用，避免各处只读 metadata.lessonNumber
 * 而漏掉 content.lessonContext / content.lessonMeta 等历史写法，导致"串课"或"找不到本节"。
 *
 * 根因背景：
 *   - createArtifact 此前未保存 metadata（已修），老 artifact 的节次信息散落在
 *     content.lessonMeta.lessonNumber / content.lessonContext.lessonNumber 等处；
 *   - PPT savePptStage 把节次写进 content.lessonContext，也写 metadata.lessonContext。
 *
 * 解析优先级（命中第一个正整数即返回）：
 *   1. metadata.lessonNumber
 *   2. metadata.lessonContext.lessonNumber
 *   3. content.lessonMeta.lessonNumber
 *   4. content.lessonContext.lessonNumber
 *   5. content.metadata.lessonNumber
 */
'use strict';

function toPositiveInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 从 artifact 多来源解析 lessonNumber。
 * @param {Object} a - artifact
 * @returns {number|null} 正整数节次，解析不到返回 null
 */
function getArtifactLessonNumber(a) {
  if (!a || typeof a !== 'object') return null;
  const md = a.metadata || {};
  const content = a.content || {};
  const candidates = [
    md.lessonNumber,
    md.lessonContext && md.lessonContext.lessonNumber,
    content.lessonMeta && content.lessonMeta.lessonNumber,
    content.lessonContext && content.lessonContext.lessonNumber,
    content.metadata && content.metadata.lessonNumber,
  ];
  for (const c of candidates) {
    const n = toPositiveInt(c);
    if (n !== null) return n;
  }
  return null;
}

/**
 * 通用"按节次挑最新 artifact"选择器（带鲁棒回退）。
 * 供 quiz/homework 等替换原先只读 metadata.lessonNumber 的严格匹配。
 *
 * 策略：
 *   ① 精确匹配 lessonNumber（多来源解析）
 *   ② 没有任何同类 artifact 标注过节次（单节/老数据）→ 回退用最新
 *   ③ 有节次标注但都不匹配选中节 → 返回 null（caller 友好报错）
 *
 * @param {Array} items - 全部 artifacts
 * @param {string} type
 * @param {string} stage
 * @param {number} lessonNumber
 * @returns {Object|null}
 */
function pickLatestArtifactByLesson(items, type, stage, lessonNumber) {
  const all = (Array.isArray(items) ? items : [])
    .filter((a) => a && a.type === type && a.stage === stage)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  if (all.length === 0) return null;
  const target = Number(lessonNumber);
  // ① 精确匹配
  const exact = all.find((a) => getArtifactLessonNumber(a) === target);
  if (exact) return exact;
  // ② 没有任何同类 artifact 标注过节次 → 回退最新
  const anyLabeled = all.some((a) => getArtifactLessonNumber(a) !== null);
  if (!anyLabeled) return all[0];
  // ③ 有节次标注但都不匹配 → null
  return null;
}

module.exports = { getArtifactLessonNumber, pickLatestArtifactByLesson, toPositiveInt };
