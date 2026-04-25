/**
 * verify-agent-orchestrator.js — Phase-5C Step 3/5 验证脚本
 *
 * 测试内容：
 *  1. 初始空状态 → generate_framework
 *  2. 框架已存在有效 → generate_lecture_abc
 *  3. 草稿 3 份但无正式稿 → generate_lecture_formal
 *  4. 草稿 3 份 + 有效正式稿 → done/success
 *  5. 框架无效 → done/blocked
 *  6. 正式稿质量不达标 + 已尝试 1 次 → 再次 generate_lecture_formal
 *  7. Step 5：正式稿质量不达标 + 已尝试 2 次 + 无回溯 → backtrack_framework
 *  8. Step 5：正式稿质量不达标 + 已尝试 2 次 + 已回溯 1 次 → done（不再回溯）
 *  9. 回溯后讲稿计数重置 → 回溯后的讲稿生成次数从 0 开始
 *
 * 运行：node scripts/verify-agent-orchestrator.js
 */

'use strict';

// 直接引入内部函数（通过 module.exports 或直接 require）
// 由于 decideNextAction 不是 export，我们通过 require 时 hack module.exports 来测试
// 实际测试方法：读取文件并 eval 内部函数（仅用于测试，不影响生产代码）
const fs = require('fs');
const path = require('path');

// ── 加载 decideNextAction 函数 ─────────────────────────────────────────────────

let decideNextAction;

try {
  // 通过一个 isolated 方式加载（不触发 require 的模块依赖）
  const src = fs.readFileSync(
    path.join(__dirname, '../src/main/agent/orchestrator.js'), 'utf8'
  );

  // 提取 decideNextAction 函数（从 function 声明到下一个顶级函数声明之前）
  // 使用一个沙盒执行环境
  const wrapperSrc = `
    ${src}
    module.exports._decideNextAction = decideNextAction;
    module.exports._assessNotebookState = assessNotebookState;
  `;
  const tmpPath = path.join(__dirname, '__tmp_orchestrator_test__.js');
  fs.writeFileSync(tmpPath, wrapperSrc);

  // Mock 外部依赖
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function(req, parent, isMain) {
    // Mock all requires from orchestrator
    if (req.includes('abc-generator')) return { generateLectureABCDrafts: async () => ({}) };
    if (req.includes('framework-schema')) return {
      normalizeFrameworkContent: (x) => x,
      validateFrameworkContent: (content) => ({
        valid: content && content._mockValid !== false,
        errors: content && content._mockValid === false ? ['mock error'] : [],
        warnings: []
      })
    };
    if (req.includes('quality')) return {
      validateLectureStage: (data) => ({
        valid: data && data._mockQualityValid !== false,
        errors: data && data._mockQualityValid === false ? ['字数不足'] : [],
        checks: { finalNarrationCharCount: data._mockCharCount || 0 }
      })
    };
    if (req.includes('context-builder')) return {
      buildLectureContext: () => ({ frameworkObjectives: '', frameworkTeachingMethods: '' }),
      buildPptContext: () => ({ lectureSections: [], lectureSectionSummary: '' })
    };
    if (req.includes('retry-loop')) return { generateWithRetry: async () => ({ result: {}, quality: { valid: true }, attempts: 1, exhausted: false, attemptLog: [] }) };
    if (req.includes('ark')) return { generateFramework: async () => ({}) };
    if (req.includes('memory')) return { saveMemory: () => {}, buildMemoryContext: () => '' };
    if (req.includes('ppt-plan-generator')) return { generatePptPlan: async () => ({ pages: [], pageCount: 0, rawPlan: {} }) };
    if (req.includes('v2-stage-helpers')) return { videoPrompt: () => '<video_brief></video_brief>' };
    return origLoad.apply(this, arguments);
  };

  const mod = require(tmpPath);
  decideNextAction = mod._decideNextAction;

  Module._load = origLoad;  // restore
  fs.unlinkSync(tmpPath);
} catch (err) {
  console.error('加载 orchestrator.js 失败:', err.message);
  process.exit(1);
}

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

function makeState(overrides = {}) {
  return {
    notebook: { id: 1, name: '测试课程', totalHours: 36 },
    modules: [],
    framework: overrides.framework !== undefined ? overrides.framework : null,
    frameworkQuality: overrides.frameworkQuality !== undefined
      ? overrides.frameworkQuality
      : (overrides.framework ? { valid: true, errors: [], warnings: [] } : null),
    draftCount: overrides.draftCount !== undefined ? overrides.draftCount : 0,
    drafts: {},
    finalScript: overrides.finalScript !== undefined ? overrides.finalScript : '',
    lectureQuality: overrides.lectureQuality !== undefined ? overrides.lectureQuality : null,
    pptPageCount: overrides.pptPageCount !== undefined ? overrides.pptPageCount : 0,
    videoPromptExists: overrides.videoPromptExists !== undefined ? overrides.videoPromptExists : false,
    ...overrides
  };
}

function makeLog(actions) {
  return actions.map((action, i) => ({ step: i, action, result: 'ok', reason: 'mock' }));
}

const TARGET = ['framework', 'lecture'];

// ── 测试 ──────────────────────────────────────────────────────────────────────

console.log('\n[1] 初始状态（无框架）');
{
  const d = decideNextAction(makeState(), TARGET, []);
  ok('action = generate_framework', d.action === 'generate_framework');
}

console.log('\n[2] 框架有效，无草稿');
{
  const d = decideNextAction(makeState({ framework: { modules: [] } }), TARGET, []);
  ok('action = generate_lecture_abc', d.action === 'generate_lecture_abc');
}

console.log('\n[3] 草稿 3 份，无正式稿');
{
  const d = decideNextAction(makeState({ framework: { modules: [] }, draftCount: 3 }), TARGET, []);
  ok('action = generate_lecture_formal', d.action === 'generate_lecture_formal');
}

console.log('\n[4] 草稿 3 份 + 有效正式稿 → done/success');
{
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 3,
    finalScript: '很长的讲稿内容',
    lectureQuality: { valid: true, errors: [], checks: { finalNarrationCharCount: 9000 } }
  }), TARGET, []);
  ok('action = done', d.action === 'done');
  ok('status = success', d.status === 'success');
}

console.log('\n[5] 框架无效 → done/blocked');
{
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    frameworkQuality: { valid: false, errors: ['缺少目标'], warnings: [] }
  }), TARGET, makeLog(['generate_framework', 'generate_framework']));  // 2次失败
  ok('action = done', d.action === 'done');
  ok('status = blocked', d.status === 'blocked');
}

console.log('\n[6] 正式稿不达标（1 次已尝试）→ 重试 formal');
{
  const badQuality = { valid: false, errors: ['字数不足'], checks: { finalNarrationCharCount: 100 } };
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 3,
    finalScript: '太短',
    lectureQuality: badQuality
  }), TARGET, makeLog(['generate_lecture_abc', 'generate_lecture_formal']));
  ok('action = generate_lecture_formal（重试）', d.action === 'generate_lecture_formal');
}

console.log('\n[7] Step 5：正式稿不达标 + 已重试 2 次 + 无回溯 → backtrack_framework');
{
  const badQuality = { valid: false, errors: ['字数不足'], checks: { finalNarrationCharCount: 100 } };
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 3,
    finalScript: '太短',
    lectureQuality: badQuality
  }), TARGET, makeLog([
    'generate_lecture_abc',
    'generate_lecture_formal',
    'generate_lecture_formal'
  ]));
  ok('action = backtrack_framework', d.action === 'backtrack_framework');
  ok('reason 含"回溯"', d.reason.includes('回溯'));
}

console.log('\n[8] Step 5：已回溯 1 次 + 正式稿仍不达标 → done（不再回溯）');
{
  const badQuality = { valid: false, errors: ['字数不足'], checks: { finalNarrationCharCount: 100 } };
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 3,
    finalScript: '太短',
    lectureQuality: badQuality
  }), TARGET, makeLog([
    'generate_lecture_abc',
    'generate_lecture_formal',
    'generate_lecture_formal',
    'backtrack_framework',          // 已回溯过
    'generate_lecture_abc',
    'generate_lecture_formal',
    'generate_lecture_formal'
  ]));
  ok('action = done（不再触发第二次回溯）', d.action === 'done');
}

console.log('\n[9] 回溯后讲稿计数重置 → 回溯后第一次正式稿可生成');
{
  // 回溯之后：无草稿（已被清空）→ 应生成 ABC
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 0,   // 清空了
    finalScript: ''  // 清空了
  }), TARGET, makeLog([
    'generate_lecture_abc',
    'generate_lecture_formal',
    'generate_lecture_formal',
    'backtrack_framework'   // 已回溯，下一步从 lecture_abc 重新开始
  ]));
  ok('回溯后 draftCount=0 → generate_lecture_abc', d.action === 'generate_lecture_abc');
}

// ── Phase-5D：PPT + 视频阶段测试 ──────────────────────────────────────────────

const TARGET_FULL = ['framework', 'lecture', 'ppt'];
const GOOD_LECTURE = { valid: true, errors: [], checks: { finalNarrationCharCount: 9000 } };

console.log('\n[10] Phase-5D: 讲稿完成 + PPT 未生成 → generate_ppt_plan');
{
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 3,
    finalScript: '很长的讲稿内容',
    lectureQuality: GOOD_LECTURE,
    pptPageCount: 0
  }), TARGET_FULL, []);
  ok('action = generate_ppt_plan', d.action === 'generate_ppt_plan');
}

console.log('\n[11] Phase-5D: PPT 已有页面 → done/success');
{
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 3,
    finalScript: '很长的讲稿内容',
    lectureQuality: GOOD_LECTURE,
    pptPageCount: 12
  }), TARGET_FULL, []);
  ok('action = done', d.action === 'done');
  ok('status = success', d.status === 'success');
}

console.log('\n[12] Phase-5D: 无讲稿 + needs ppt → done/blocked');
{
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 3,
    finalScript: '',   // 无讲稿
    pptPageCount: 0
  }), ['ppt'], []);  // 只要 ppt，不要 lecture
  ok('action = done（blocked）', d.action === 'done');
  ok('status = blocked', d.status === 'blocked');
}

console.log('\n[13] Phase-5D: PPT 已生成 + 视频未生成 → generate_video_prompt');
{
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 3,
    finalScript: '很长的讲稿内容',
    lectureQuality: GOOD_LECTURE,
    pptPageCount: 12,
    videoPromptExists: false
  }), ['framework', 'lecture', 'ppt', 'video'], []);
  ok('action = generate_video_prompt', d.action === 'generate_video_prompt');
}

console.log('\n[14] Phase-5D: 视频也完成 → done/success');
{
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 3,
    finalScript: '很长的讲稿内容',
    lectureQuality: GOOD_LECTURE,
    pptPageCount: 12,
    videoPromptExists: true
  }), ['framework', 'lecture', 'ppt', 'video'], []);
  ok('action = done', d.action === 'done');
  ok('status = success', d.status === 'success');
}

console.log('\n[15] Phase-5D: video 需要 PPT 但 PPT 未完成 → done/blocked');
{
  const d = decideNextAction(makeState({
    framework: { modules: [] },
    draftCount: 3,
    finalScript: '很长的讲稿内容',
    lectureQuality: GOOD_LECTURE,
    pptPageCount: 0,
    videoPromptExists: false
  }), ['framework', 'lecture', 'ppt', 'video'], makeLog(['generate_ppt_plan', 'generate_ppt_plan'])); // ppt 重试耗尽
  ok('action = done（blocked）', d.action === 'done');
}

// ── 汇总 ──────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`结果：${passed} 通过 / ${failed} 失败`);
if (failed === 0) {
  console.log('✅ Phase-5C/5D Agent Orchestrator + Backtracking + PPT/Video 验证通过');
} else {
  console.log('❌ 有测试失败，请检查 src/main/agent/orchestrator.js');
  process.exit(1);
}
