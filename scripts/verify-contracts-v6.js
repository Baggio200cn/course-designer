/**
 * verify-contracts-v6.js — Phase-9 6 阶段架构自检
 *
 * 验证范围：
 *   - STAGE_ORDER 是 ['schedule', 'design', 'lecture', 'ppt', 'video', 'report']
 *   - STAGE_REQUIREMENTS 各阶段依赖正确
 *   - computeUnlockedStages 在不同 artifact 状态下返回正确解锁列表
 *   - validateStageTransition 拒绝未解锁阶段、接受已解锁
 *   - 边界：空数组 / 错阶段 / 未确认 artifact / 多版本 artifact 取最新
 */

const path = require('path');
const contracts = require(path.resolve(__dirname, '..', 'src', 'main', 'v2', 'contracts.js'));
const {
  STAGE_ORDER,
  STAGE_ORDER_LEGACY_V3,
  STAGE_REQUIREMENTS,
  computeUnlockedStages,
  validateStageTransition,
  isArtifactConfirmed,
  findLatestConfirmedArtifact
} = contracts;

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ❌ ${name} — ${err.message}`);
    failures.push({ name, error: err.message });
    fail++;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertEqual(actual, expected, label) {
  if (!deepEqual(actual, expected)) {
    throw new Error(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Phase-9 contracts.js 6 阶段架构自检');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ── 契约组 1：STAGE_ORDER 配置正确 ────────────────────────────────────────
console.log('▸ 契约组 1：STAGE_ORDER 配置');

test('STAGE_ORDER 是 6 阶段', () => {
  assertEqual(STAGE_ORDER, ['schedule', 'design', 'lecture', 'ppt', 'video', 'report'], 'STAGE_ORDER');
});

test('STAGE_ORDER_LEGACY_V3 仍可读（向后兼容）', () => {
  assertEqual(STAGE_ORDER_LEGACY_V3, ['framework', 'lecture', 'ppt', 'video'], 'LEGACY_V3');
});

test('STAGE_REQUIREMENTS 不含 schedule（起点无前置）', () => {
  if (STAGE_REQUIREMENTS.schedule !== undefined) {
    throw new Error('schedule 不应有前置依赖');
  }
});

test('design 依赖 schedule_table', () => {
  assertEqual(STAGE_REQUIREMENTS.design, [{ type: 'schedule_table', stage: 'schedule' }], 'design 依赖');
});

test('lecture 依赖 design_doc（不再依赖 framework_json）', () => {
  assertEqual(STAGE_REQUIREMENTS.lecture, [{ type: 'design_doc', stage: 'design' }], 'lecture 依赖');
});

test('ppt 依赖 lecture_final（保持不变）', () => {
  assertEqual(STAGE_REQUIREMENTS.ppt, [{ type: 'lecture_final', stage: 'lecture' }], 'ppt 依赖');
});

test('video 依赖 ppt_outline（保持不变）', () => {
  assertEqual(STAGE_REQUIREMENTS.video, [{ type: 'ppt_outline', stage: 'ppt' }], 'video 依赖');
});

test('report 依赖前 5 阶段全部 artifact', () => {
  const reqs = STAGE_REQUIREMENTS.report;
  if (!Array.isArray(reqs) || reqs.length !== 5) {
    throw new Error(`report 应有 5 个前置依赖，实际 ${reqs?.length}`);
  }
  const types = reqs.map((r) => r.type).sort();
  assertEqual(types, ['design_doc', 'lecture_final', 'ppt_outline', 'schedule_table', 'video_prompt'], 'report 依赖类型集');
});

// ── 契约组 2：computeUnlockedStages 解锁逻辑 ────────────────────────────────
console.log('\n▸ 契约组 2：解锁逻辑');

test('空数组只解锁 schedule', () => {
  assertEqual(computeUnlockedStages([]), ['schedule'], '空 artifact');
});

test('schedule 已确认 → 解锁 design', () => {
  const artifacts = [{ type: 'schedule_table', stage: 'schedule', confirmed: true, status: 'confirmed' }];
  assertEqual(computeUnlockedStages(artifacts), ['schedule', 'design'], 'schedule 确认后');
});

test('schedule + design 已确认 → 解锁 lecture', () => {
  const artifacts = [
    { type: 'schedule_table', stage: 'schedule', confirmed: true, status: 'confirmed' },
    { type: 'design_doc', stage: 'design', confirmed: true, status: 'confirmed' }
  ];
  assertEqual(computeUnlockedStages(artifacts), ['schedule', 'design', 'lecture'], 'design 确认后');
});

test('完整链路：5 阶段 confirmed → 解锁 report', () => {
  const now = new Date().toISOString();
  const artifacts = [
    { type: 'schedule_table', stage: 'schedule', confirmed: true, status: 'confirmed', createdAt: now },
    { type: 'design_doc', stage: 'design', confirmed: true, status: 'confirmed', createdAt: now },
    { type: 'lecture_final', stage: 'lecture', confirmed: true, status: 'confirmed', createdAt: now },
    { type: 'ppt_outline', stage: 'ppt', confirmed: true, status: 'confirmed', createdAt: now },
    { type: 'video_prompt', stage: 'video', confirmed: true, status: 'confirmed', createdAt: now }
  ];
  assertEqual(computeUnlockedStages(artifacts), STAGE_ORDER, '全链路 confirmed');
});

test('schedule 已生成但未 confirmed → design 仍锁定', () => {
  const artifacts = [{ type: 'schedule_table', stage: 'schedule', confirmed: false, status: 'draft' }];
  assertEqual(computeUnlockedStages(artifacts), ['schedule'], 'schedule 未 confirm 时');
});

test('lecture confirmed 但 design 缺失 → lecture 不解锁（链路断点）', () => {
  const artifacts = [
    { type: 'schedule_table', stage: 'schedule', confirmed: true, status: 'confirmed' },
    // 缺 design_doc
    { type: 'lecture_final', stage: 'lecture', confirmed: true, status: 'confirmed' }
  ];
  // lecture 依赖 design_doc，design 缺 → lecture 不该解锁
  // 但 schedule confirmed 后 design 解锁
  const unlocked = computeUnlockedStages(artifacts);
  if (!unlocked.includes('schedule')) throw new Error('schedule 应解锁');
  if (!unlocked.includes('design')) throw new Error('design 应解锁（schedule confirmed）');
  if (unlocked.includes('lecture')) throw new Error('lecture 不应解锁（design_doc 缺失）');
});

// ── 契约组 3：validateStageTransition 校验 ──────────────────────────────────
console.log('\n▸ 契约组 3：阶段转换校验');

test('schedule 永远 allowed', () => {
  const r = validateStageTransition({ targetStage: 'schedule', artifacts: [] });
  if (!r.allowed) throw new Error('schedule 应该允许');
});

test('未知阶段返回 not allowed + 提示 v4.0.0 接受范围', () => {
  const r = validateStageTransition({ targetStage: 'framework', artifacts: [] });
  if (r.allowed) throw new Error('framework 不应该允许（v4.0.0 已废弃）');
  if (!r.blockingIssues.some((m) => m.includes('未知阶段'))) {
    throw new Error('应包含"未知阶段"');
  }
  if (!r.blockingIssues.some((m) => m.includes('schedule'))) {
    throw new Error('应包含 v4.0.0 接受范围提示');
  }
});

test('无前置 artifact 时 design 拒绝 + 列出缺失', () => {
  const r = validateStageTransition({ targetStage: 'design', artifacts: [] });
  if (r.allowed) throw new Error('design 在 schedule 未 confirm 时不应允许');
  if (!r.blockingIssues.some((m) => m.includes('schedule/schedule_table'))) {
    throw new Error('应说明缺哪个 artifact');
  }
});

test('schedule confirmed 后 design 允许', () => {
  const artifacts = [{ type: 'schedule_table', stage: 'schedule', confirmed: true, status: 'confirmed' }];
  const r = validateStageTransition({ targetStage: 'design', artifacts });
  if (!r.allowed) throw new Error(`design 应允许，实际：${r.blockingIssues.join('；')}`);
});

test('targetStage 为空返回明确错误', () => {
  const r = validateStageTransition({ targetStage: '', artifacts: [] });
  if (r.allowed) throw new Error('空 targetStage 不应允许');
  if (!r.blockingIssues.includes('目标阶段不能为空')) {
    throw new Error('应有"目标阶段不能为空"');
  }
});

// ── 契约组 4：findLatestConfirmedArtifact 取最新 ────────────────────────────
console.log('\n▸ 契约组 4：取最新 confirmed artifact');

test('多版本 schedule_table 取最新一份', () => {
  const artifacts = [
    { type: 'schedule_table', stage: 'schedule', confirmed: true, status: 'confirmed', createdAt: '2026-05-01', version: 1 },
    { type: 'schedule_table', stage: 'schedule', confirmed: true, status: 'confirmed', createdAt: '2026-05-09', version: 2 }
  ];
  const latest = findLatestConfirmedArtifact(artifacts, { type: 'schedule_table', stage: 'schedule' });
  if (!latest || latest.version !== 2) throw new Error(`应取 version=2，实际 ${latest?.version}`);
});

test('未 confirmed 的不算（即使最新）', () => {
  const artifacts = [
    { type: 'schedule_table', stage: 'schedule', confirmed: true, status: 'confirmed', createdAt: '2026-05-01', version: 1 },
    { type: 'schedule_table', stage: 'schedule', confirmed: false, status: 'draft', createdAt: '2026-05-09', version: 2 }
  ];
  const latest = findLatestConfirmedArtifact(artifacts, { type: 'schedule_table', stage: 'schedule' });
  if (!latest || latest.version !== 1) throw new Error('应取已 confirm 的 version=1');
});

// ── 契约组 5：isArtifactConfirmed ──────────────────────────────────────────
console.log('\n▸ 契约组 5：confirmed 判断');

test('confirmed=true + status=confirmed → 通过', () => {
  if (!isArtifactConfirmed({ confirmed: true, status: 'confirmed' })) {
    throw new Error('应判定 confirmed');
  }
});

test('confirmed=true + status=exported → 通过（已导出视为 confirmed）', () => {
  if (!isArtifactConfirmed({ confirmed: true, status: 'exported' })) {
    throw new Error('exported 应判定 confirmed');
  }
});

test('confirmed=true + status=review_needed → 通过', () => {
  if (!isArtifactConfirmed({ confirmed: true, status: 'review_needed' })) {
    throw new Error('review_needed 应判定 confirmed');
  }
});

test('confirmed=true + status=draft → 不通过', () => {
  if (isArtifactConfirmed({ confirmed: true, status: 'draft' })) {
    throw new Error('draft 不应判定 confirmed');
  }
});

test('confirmed=false → 不通过', () => {
  if (isArtifactConfirmed({ confirmed: false, status: 'confirmed' })) {
    throw new Error('confirmed=false 不应判定 confirmed');
  }
});

test('null/undefined 不崩溃', () => {
  if (isArtifactConfirmed(null) || isArtifactConfirmed(undefined)) {
    throw new Error('null/undefined 应返回 false');
  }
});

// ── 总结 ──────────────────────────────────────────────────────────────────
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`总计：${pass + fail}    通过：${pass}    失败：${fail}`);

if (fail === 0) {
  console.log('✅ 全部通过');
  console.log('\n⚠️  H9 提醒：契约通过 ≠ 端到端就绪。');
  console.log('   还需阶段 B 后续：runtime.js 的 saveXxx/confirmXxx 适配新 stage');
  console.log('   还需阶段 C 完成：4 个生成器（schedule/design/video/report）');
  console.log('   还需阶段 D 完成：前端 6 阶段标签 + 4 Stage 组件');
  process.exit(0);
} else {
  console.log('❌ 有失败项：');
  failures.forEach((f) => console.log(`   - ${f.name}：${f.error}`));
  process.exit(1);
}
