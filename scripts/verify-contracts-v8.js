/**
 * verify-contracts-v8.js — v4.3.3 8 阶段架构自检
 *
 * 验证范围：
 *   - STAGE_ORDER = ['schedule','design','ppt','lecture','quiz','homework','video','report']
 *   - STAGE_REQUIREMENTS 各阶段前置依赖（quiz/homework 依赖 lecture，report 依赖 7 阶段）
 *   - STAGE_PRIMARY_TYPE / STAGE_TITLE 完整且键集与 STAGE_ORDER 对齐
 *   - computeUnlockedStages 在不同 artifact 状态下返回正确解锁列表
 *   - validateStageTransition 拒绝未解锁、接受已解锁
 *   - video type 一致性：STAGE_PRIMARY_TYPE.video === 'video_prompt'
 *   - 边界：空数组 / 错阶段 / 未确认 artifact / 多版本取最新
 *
 * 替代 v6（v6 是旧 6 阶段，运行 25/28 失败 3）
 */

'use strict';

const path = require('path');
const contracts = require(path.resolve(__dirname, '..', 'src', 'main', 'v2', 'contracts.js'));

const {
  STAGE_ORDER,
  STAGE_ORDER_LEGACY_V3,
  STAGE_REQUIREMENTS,
  STAGE_PRIMARY_TYPE,
  STAGE_TITLE,
  computeUnlockedStages,
  validateStageTransition,
  isArtifactConfirmed,
  findLatestConfirmedArtifact,
} = contracts;

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failures.push({ name, error: err.message });
    fail += 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function arrayEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function setEq(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

const EXPECTED_ORDER = ['schedule', 'design', 'ppt', 'lecture', 'quiz', 'homework', 'video', 'report'];

console.log('\n═══ verify-contracts-v8 · 8 阶段契约自检 ═══\n');

// ── 1. STAGE_ORDER 正确性 ─────────────────────────────────────────────────
console.log('【1】STAGE_ORDER 8 阶段顺序');
test('STAGE_ORDER 等于 [schedule,design,ppt,lecture,quiz,homework,video,report]', () => {
  assert(arrayEq(STAGE_ORDER, EXPECTED_ORDER), `实际：${JSON.stringify(STAGE_ORDER)}`);
});
test('STAGE_ORDER 长度 = 8', () => {
  assert(STAGE_ORDER.length === 8, `实际长度 ${STAGE_ORDER.length}`);
});
test('STAGE_ORDER 不包含已退役 framework', () => {
  assert(!STAGE_ORDER.includes('framework'), 'STAGE_ORDER 仍含 framework');
});
test('STAGE_ORDER_LEGACY_V3 仍可读（向后兼容）', () => {
  assert(Array.isArray(STAGE_ORDER_LEGACY_V3), 'LEGACY_V3 缺失');
  assert(STAGE_ORDER_LEGACY_V3.includes('framework'), 'LEGACY_V3 应含 framework');
});

// ── 2. STAGE_REQUIREMENTS 依赖链 ──────────────────────────────────────────
console.log('\n【2】STAGE_REQUIREMENTS 依赖');
test('schedule 无前置依赖（起点）', () => {
  assert(STAGE_REQUIREMENTS.schedule === undefined, 'schedule 不应有前置');
});
test('design 依赖 schedule_table', () => {
  const r = STAGE_REQUIREMENTS.design || [];
  assert(r.some((x) => x.type === 'schedule_table' && x.stage === 'schedule'), `实际：${JSON.stringify(r)}`);
});
test('ppt 依赖 design_doc', () => {
  const r = STAGE_REQUIREMENTS.ppt || [];
  assert(r.some((x) => x.type === 'design_doc' && x.stage === 'design'), `实际：${JSON.stringify(r)}`);
});
test('lecture 依赖 design_doc + ppt_outline', () => {
  const r = STAGE_REQUIREMENTS.lecture || [];
  assert(r.some((x) => x.type === 'design_doc'), `缺 design_doc，实际：${JSON.stringify(r)}`);
  assert(r.some((x) => x.type === 'ppt_outline'), `缺 ppt_outline，实际：${JSON.stringify(r)}`);
});
test('quiz 依赖 lecture_final + ppt_outline', () => {
  const r = STAGE_REQUIREMENTS.quiz || [];
  assert(r.some((x) => x.type === 'lecture_final'), `缺 lecture_final，实际：${JSON.stringify(r)}`);
  assert(r.some((x) => x.type === 'ppt_outline'), `缺 ppt_outline，实际：${JSON.stringify(r)}`);
});
test('homework 依赖 lecture_final', () => {
  const r = STAGE_REQUIREMENTS.homework || [];
  assert(r.some((x) => x.type === 'lecture_final'), `实际：${JSON.stringify(r)}`);
});
test('video 依赖 lecture_final', () => {
  const r = STAGE_REQUIREMENTS.video || [];
  assert(r.some((x) => x.type === 'lecture_final'), `实际：${JSON.stringify(r)}`);
});
test('report 依赖前 7 阶段（含 quiz_set / homework_set / video_prompt）', () => {
  const r = STAGE_REQUIREMENTS.report || [];
  ['schedule_table', 'design_doc', 'ppt_outline', 'lecture_final', 'quiz_set', 'homework_set', 'video_prompt']
    .forEach((t) => {
      assert(r.some((x) => x.type === t), `report 依赖缺 ${t}`);
    });
});

// ── 3. STAGE_PRIMARY_TYPE / STAGE_TITLE 单一来源 ──────────────────────────
console.log('\n【3】STAGE_PRIMARY_TYPE / STAGE_TITLE 单一来源');
test('STAGE_PRIMARY_TYPE 存在且键集 = STAGE_ORDER', () => {
  assert(STAGE_PRIMARY_TYPE && typeof STAGE_PRIMARY_TYPE === 'object', 'STAGE_PRIMARY_TYPE 缺失');
  assert(setEq(Object.keys(STAGE_PRIMARY_TYPE), STAGE_ORDER), `键集不一致：${Object.keys(STAGE_PRIMARY_TYPE)}`);
});
test('STAGE_PRIMARY_TYPE.video === video_prompt（不是老 micro_video_plan）', () => {
  assert(STAGE_PRIMARY_TYPE.video === 'video_prompt', `实际：${STAGE_PRIMARY_TYPE.video}`);
});
test('STAGE_PRIMARY_TYPE.quiz === quiz_set', () => {
  assert(STAGE_PRIMARY_TYPE.quiz === 'quiz_set', `实际：${STAGE_PRIMARY_TYPE.quiz}`);
});
test('STAGE_PRIMARY_TYPE.homework === homework_set', () => {
  assert(STAGE_PRIMARY_TYPE.homework === 'homework_set', `实际：${STAGE_PRIMARY_TYPE.homework}`);
});
test('STAGE_TITLE 完整 8 阶段', () => {
  assert(STAGE_TITLE && typeof STAGE_TITLE === 'object', 'STAGE_TITLE 缺失');
  assert(setEq(Object.keys(STAGE_TITLE), STAGE_ORDER), `键集不一致：${Object.keys(STAGE_TITLE)}`);
});

// ── 4. computeUnlockedStages 各种 artifact 状态 ───────────────────────────
console.log('\n【4】computeUnlockedStages 解锁链');

const now = new Date().toISOString();
function mkArtifact(type, stage, confirmed = true) {
  return {
    id: Math.random(),
    type, stage,
    confirmed, status: confirmed ? 'confirmed' : 'draft',
    updatedAt: now, createdAt: now,
  };
}

test('空 artifact 数组 → 只解锁 schedule', () => {
  const u = computeUnlockedStages([]);
  assert(arrayEq(u, ['schedule']), `实际：${JSON.stringify(u)}`);
});
test('只有 schedule_table confirmed → 解锁 schedule + design', () => {
  const u = computeUnlockedStages([mkArtifact('schedule_table', 'schedule')]);
  assert(u.includes('schedule') && u.includes('design'), `实际：${JSON.stringify(u)}`);
});
test('schedule + design 都 confirmed → 解锁前 3', () => {
  const u = computeUnlockedStages([
    mkArtifact('schedule_table', 'schedule'),
    mkArtifact('design_doc', 'design'),
  ]);
  ['schedule', 'design', 'ppt'].forEach((s) => assert(u.includes(s), `缺 ${s}`));
});
test('schedule + design + ppt 都 confirmed → 解锁到 lecture', () => {
  const u = computeUnlockedStages([
    mkArtifact('schedule_table', 'schedule'),
    mkArtifact('design_doc', 'design'),
    mkArtifact('ppt_outline', 'ppt'),
  ]);
  assert(u.includes('lecture'), `缺 lecture，实际：${JSON.stringify(u)}`);
});
test('前 4 都 confirmed → 同时解锁 quiz + homework + video（并行）', () => {
  const u = computeUnlockedStages([
    mkArtifact('schedule_table', 'schedule'),
    mkArtifact('design_doc', 'design'),
    mkArtifact('ppt_outline', 'ppt'),
    mkArtifact('lecture_final', 'lecture'),
  ]);
  ['quiz', 'homework', 'video'].forEach((s) => assert(u.includes(s), `缺 ${s}`));
});
test('design_doc 未 confirmed → 不解锁 ppt', () => {
  const u = computeUnlockedStages([
    mkArtifact('schedule_table', 'schedule'),
    mkArtifact('design_doc', 'design', false),  // not confirmed
  ]);
  assert(!u.includes('ppt'), `不该解锁 ppt，实际：${JSON.stringify(u)}`);
});
test('全 7 阶段产物都 confirmed → report 解锁', () => {
  const u = computeUnlockedStages([
    mkArtifact('schedule_table', 'schedule'),
    mkArtifact('design_doc', 'design'),
    mkArtifact('ppt_outline', 'ppt'),
    mkArtifact('lecture_final', 'lecture'),
    mkArtifact('quiz_set', 'quiz'),
    mkArtifact('homework_set', 'homework'),
    mkArtifact('video_prompt', 'video'),
  ]);
  assert(u.includes('report'), `缺 report，实际：${JSON.stringify(u)}`);
});
test('quiz/homework 缺失 → report 不解锁', () => {
  const u = computeUnlockedStages([
    mkArtifact('schedule_table', 'schedule'),
    mkArtifact('design_doc', 'design'),
    mkArtifact('ppt_outline', 'ppt'),
    mkArtifact('lecture_final', 'lecture'),
    mkArtifact('video_prompt', 'video'),
    // 缺 quiz_set + homework_set
  ]);
  assert(!u.includes('report'), `report 不该解锁，实际：${JSON.stringify(u)}`);
});

// ── 5. validateStageTransition 拒绝/接受 ─────────────────────────────────
console.log('\n【5】validateStageTransition');
test('未解锁阶段 → allowed=false', () => {
  const r = validateStageTransition({ targetStage: 'lecture', artifacts: [] });
  assert(r.allowed === false, `应拒绝，实际：${JSON.stringify(r)}`);
});
test('已解锁 → allowed=true', () => {
  const r = validateStageTransition({
    targetStage: 'design',
    artifacts: [mkArtifact('schedule_table', 'schedule')],
  });
  assert(r.allowed === true, `应接受，实际：${JSON.stringify(r)}`);
});
test('未知 stage → allowed=false 且 blockingIssues 有提示', () => {
  const r = validateStageTransition({ targetStage: 'nonexistent', artifacts: [] });
  assert(r.allowed === false, '应拒绝未知 stage');
  assert(r.blockingIssues && r.blockingIssues.length > 0, '应有错误提示');
});
test('schedule（起点）总是 allowed', () => {
  const r = validateStageTransition({ targetStage: 'schedule', artifacts: [] });
  assert(r.allowed === true, `schedule 应永远允许，实际：${JSON.stringify(r)}`);
});
test('quiz 在 lecture 未 confirmed 时拒绝', () => {
  const r = validateStageTransition({
    targetStage: 'quiz',
    artifacts: [
      mkArtifact('schedule_table', 'schedule'),
      mkArtifact('design_doc', 'design'),
      mkArtifact('ppt_outline', 'ppt'),
      // 缺 lecture_final
    ],
  });
  assert(r.allowed === false, `quiz 应被拒绝，实际：${JSON.stringify(r)}`);
});

// ── 6. video type 一致性 ─────────────────────────────────────────────────
console.log('\n【6】video type 一致性（避免 micro_video_plan 老 alias 再当主类型）');
test('STAGE_PRIMARY_TYPE.video !== micro_video_plan', () => {
  assert(STAGE_PRIMARY_TYPE.video !== 'micro_video_plan', 'STAGE_PRIMARY_TYPE.video 不应该是 micro_video_plan');
});
test('report 依赖明确依赖 video_prompt（不是 micro_video_plan）', () => {
  const r = STAGE_REQUIREMENTS.report || [];
  assert(r.some((x) => x.type === 'video_prompt'), 'report 应依赖 video_prompt');
  assert(!r.some((x) => x.type === 'micro_video_plan'), 'report 不应依赖 micro_video_plan');
});

// ── 7. isArtifactConfirmed / findLatestConfirmedArtifact ─────────────────
console.log('\n【7】辅助函数边界');
test('isArtifactConfirmed: confirmed=true status=confirmed → true', () => {
  assert(isArtifactConfirmed(mkArtifact('x', 'y', true)) === true);
});
test('isArtifactConfirmed: confirmed=false → false', () => {
  assert(isArtifactConfirmed(mkArtifact('x', 'y', false)) === false);
});
test('findLatestConfirmedArtifact: 多个 confirmed 取最新 updatedAt', () => {
  const old = { ...mkArtifact('design_doc', 'design'), updatedAt: '2026-01-01T00:00:00Z' };
  const newer = { ...mkArtifact('design_doc', 'design'), updatedAt: '2026-05-18T00:00:00Z' };
  const r = findLatestConfirmedArtifact([old, newer], { type: 'design_doc', stage: 'design' });
  assert(r === newer, `应取 newer，实际 updatedAt: ${r?.updatedAt}`);
});

// ── 结果汇总 ─────────────────────────────────────────────────────────────
console.log(`\n═══ 结果：${pass}/${pass + fail} 通过 ═══`);
if (fail > 0) {
  console.log('\n失败列表：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}\n     ${f.error}`));
  process.exit(1);
}
process.exit(0);
