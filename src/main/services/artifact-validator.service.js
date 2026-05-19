/**
 * artifact-validator.service.js — v4.3.3 Codex Round 10 P3（2026-05-19）
 *
 * artifact 级字段断言，防 AI 退化 / 防上游漂移。
 * 用法：
 *   const { validateArtifact } = require('./services/artifact-validator.service');
 *   const result = validateArtifact(artifact);
 *   // result = { valid, issues: [...], type, lessonNumber }
 *
 * 设计：
 *   - 只校验"必有"字段（不强 AI 输出风格）
 *   - 配合 e2e mock 后置检查使用，防止 quiz 没有 sourcePageNumber 等回归
 *   - 校验失败不阻断 createArtifact，但建议 caller 把 issues 写进 reviewFlags
 */

'use strict';

const VALIDATORS = {
  // ppt_outline：每页必须有 pageNumber / title / pageType / keyContent
  ppt_outline(artifact) {
    const issues = [];
    const pages = artifact.content?.pages || artifact.content?.pptPages || [];
    if (pages.length === 0) {
      issues.push('pages 数组为空');
      return issues;
    }
    pages.forEach((p, i) => {
      if (typeof p.pageNumber !== 'number' || p.pageNumber <= 0) {
        issues.push(`P${i + 1}: pageNumber 缺失或非正整数（实际: ${p.pageNumber}）`);
      }
      if (!p.title || String(p.title).length < 1) {
        issues.push(`P${i + 1}: title 缺失`);
      }
      if (!p.pageType) {
        issues.push(`P${i + 1}: pageType 缺失`);
      }
      const kc = p.keyContent;
      if (kc === undefined || kc === null || (Array.isArray(kc) && kc.length === 0) || (typeof kc === 'string' && kc.trim() === '')) {
        issues.push(`P${i + 1}: keyContent 缺失或空`);
      }
    });
    return issues;
  },

  // lecture_final：finalScript 段落数应接近 PPT 页数（如有 pptPageCount metadata）
  lecture_final(artifact) {
    const issues = [];
    const text = artifact.content?.finalScript || '';
    if (text.length < 200) {
      issues.push(`finalScript 过短（${text.length} 字，至少 200 字）`);
      return issues;
    }
    // 计算"## 第 N 页"段落数
    const pageBlocks = (text.match(/##\s*第\s*\d+\s*页/g) || []).length;
    const expectedPages = artifact.metadata?.pptPageCount;
    if (expectedPages && Math.abs(pageBlocks - expectedPages) > Math.max(2, expectedPages * 0.3)) {
      issues.push(`段落数 ${pageBlocks} 与 PPT 页数 ${expectedPages} 偏差超 30%（讲稿可能漏页）`);
    }
    if (!/教师讲述/.test(text)) {
      issues.push('finalScript 缺"教师讲述"标记');
    }
    return issues;
  },

  // quiz_set：每题必须有 sourcePageNumber / stem / correctAnswer
  quiz_set(artifact) {
    const issues = [];
    const qs = artifact.content?.questions || [];
    if (qs.length === 0) {
      issues.push('questions 数组为空');
      return issues;
    }
    qs.forEach((q, i) => {
      if (typeof q.sourcePageNumber !== 'number') {
        issues.push(`Q${i + 1}: sourcePageNumber 缺失或非数字`);
      }
      if (!q.stem || String(q.stem).length < 3) {
        issues.push(`Q${i + 1}: stem 缺失或过短`);
      }
      if (!q.correctAnswer && q.correctAnswer !== 0) {
        issues.push(`Q${i + 1}: correctAnswer 缺失`);
      }
      if (!['single', 'multiple', 'judge', 'fill', 'short_answer'].includes(q.type)) {
        issues.push(`Q${i + 1}: type 非法（实际: ${q.type}）`);
      }
    });
    return issues;
  },

  // homework_set：总耗时应在学时规则内 + 评分要点 ≥ 3
  homework_set(artifact) {
    const issues = [];
    const tasks = artifact.content?.tasks || [];
    if (tasks.length === 0) {
      issues.push('tasks 数组为空');
      return issues;
    }
    const totalMin = tasks.reduce((s, t) => s + (Number(t.estimatedMinutes) || 0), 0);
    const lessonHours = (Number(artifact.metadata?.theoryHours) || 0) + (Number(artifact.metadata?.practiceHours) || 0);
    if (lessonHours > 0) {
      const minExpected = lessonHours * 30;  // 30 分钟/学时
      const maxExpected = lessonHours * 60;
      if (totalMin < minExpected * 0.5 || totalMin > maxExpected * 2) {
        issues.push(`总耗时 ${totalMin} 分钟严重偏离 ${lessonHours} 学时建议（${minExpected}-${maxExpected} 分钟）`);
      }
    }
    tasks.forEach((t, i) => {
      if (!t.title || String(t.title).length < 3) issues.push(`T${i + 1}: title 缺失或过短`);
      if (!t.deliverables) issues.push(`T${i + 1}: deliverables 缺失`);
      if (!Array.isArray(t.evaluationCriteria) || t.evaluationCriteria.length < 3) {
        issues.push(`T${i + 1}: evaluationCriteria 少于 3 条`);
      }
    });
    return issues;
  },

  // video_prompt（v4.3.3 Codex Round 13 P1.3）：durationSec / storyboard / jimengPrompts 必有 + 数量匹配 + 时长范围
  video_prompt(artifact) {
    const issues = [];
    const c = artifact.content || {};
    // 1. durationSec 必须是正数（30-180 秒合理区间）
    if (typeof c.durationSec !== 'number' || c.durationSec <= 0) {
      issues.push(`durationSec 缺失或非正数（实际: ${c.durationSec}）`);
    } else if (c.durationSec < 30 || c.durationSec > 300) {
      issues.push(`durationSec ${c.durationSec} 秒偏离合理区间 30-300 秒`);
    }
    // 2. storyboard 必须是非空数组
    const sb = Array.isArray(c.storyboard) ? c.storyboard : [];
    if (sb.length === 0) {
      issues.push('storyboard 数组为空');
    } else {
      if (sb.length < 3 || sb.length > 12) {
        issues.push(`storyboard 镜头数 ${sb.length} 偏离合理区间 3-12 个`);
      }
      sb.forEach((s, i) => {
        if (typeof s.shotNumber !== 'number') issues.push(`镜头${i + 1}: shotNumber 缺失`);
        if (typeof s.duration !== 'number' || s.duration <= 0) issues.push(`镜头${i + 1}: duration 缺失或非正数`);
        if (!s.visualDescription || String(s.visualDescription).length < 3) issues.push(`镜头${i + 1}: visualDescription 缺失或过短`);
        if (!s.cameraAngle) issues.push(`镜头${i + 1}: cameraAngle 缺失`);
      });
    }
    // 3. jimengPrompts 必须是数组 + 数量与 storyboard 一致
    const jp = Array.isArray(c.jimengPrompts) ? c.jimengPrompts : [];
    if (jp.length === 0) {
      issues.push('jimengPrompts 数组为空');
    } else {
      if (jp.length !== sb.length) {
        issues.push(`jimengPrompts 数量 ${jp.length} 与 storyboard ${sb.length} 不一致`);
      }
      jp.forEach((p, i) => {
        if (!p.prompt || String(p.prompt).length < 3) issues.push(`即梦提示词${i + 1}: prompt 缺失或过短`);
      });
    }
    // 4. 总时长与 durationSec 误差范围（±10 秒或 ±20%）
    const totalShot = sb.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
    if (totalShot > 0 && typeof c.durationSec === 'number' && c.durationSec > 0) {
      const tol = Math.max(10, c.durationSec * 0.2);
      if (Math.abs(totalShot - c.durationSec) > tol) {
        issues.push(`storyboard 总时长 ${totalShot} 秒与 durationSec ${c.durationSec} 偏离超 ${tol.toFixed(0)} 秒`);
      }
    }
    return issues;
  },

  // implementation_report：必须含上游 sourceArtifactIds
  implementation_report(artifact) {
    const issues = [];
    if (!Array.isArray(artifact.sourceArtifactIds) || artifact.sourceArtifactIds.length === 0) {
      issues.push('sourceArtifactIds 缺失或为空（报告应有上游血缘）');
    }
    const c = artifact.content || {};
    ['teachingObjectives', 'teachingMethods', 'preInClassPostFlow'].forEach((k) => {
      if (!c[k]) issues.push(`content.${k} 缺失`);
    });
    return issues;
  },
};

function validateArtifact(artifact) {
  const result = {
    type: artifact?.type || 'unknown',
    lessonNumber: artifact?.metadata?.lessonNumber || null,
    valid: true,
    issues: [],
  };
  if (!artifact || typeof artifact !== 'object') {
    result.valid = false;
    result.issues.push('artifact 不是对象');
    return result;
  }
  // schemaVersion 是 v4.3.3 D13 必有
  if (typeof artifact.schemaVersion !== 'number') {
    result.issues.push('缺 schemaVersion（v4.3.3 D13 必有）');
  }
  if (typeof artifact.dirty !== 'boolean') {
    result.issues.push('缺 dirty 字段（v4.3.3 D13 必有）');
  }
  const validator = VALIDATORS[artifact.type];
  if (validator) {
    const typeIssues = validator(artifact);
    result.issues.push(...typeIssues);
  }
  result.valid = result.issues.length === 0;
  return result;
}

function validateArtifacts(artifacts) {
  const summary = { total: artifacts.length, valid: 0, invalid: 0, results: [] };
  artifacts.forEach((a) => {
    const r = validateArtifact(a);
    summary.results.push(r);
    if (r.valid) summary.valid += 1;
    else summary.invalid += 1;
  });
  return summary;
}

module.exports = {
  validateArtifact,
  validateArtifacts,
  VALIDATORS,
};
