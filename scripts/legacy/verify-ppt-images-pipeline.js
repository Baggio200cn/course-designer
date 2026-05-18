/**
 * verify-ppt-images-pipeline.js — Phase-7.5 M7.5.5 PPT 配图深度流水线验证
 *
 * 验证 5 个层面：
 *   1) selfCheck       — pipeline service 内置 10 个用例
 *   2) integration     — buildAgentPptImagesHelper 与 service 串联
 *   3) pauseFlow       — 流水线 paused → helper 抛 pausePayload
 *   4) styleAnchorPass — 封面通过后 styleAnchor 拼到内容页 imagePrompt
 *   5) loadingCheck    — agent.handlers + ppt-images-pipeline.service 加载无错
 */

const fs = require('fs');
const path = require('path');

const cases = [];

// ── 1) selfCheck ───────────────────────────────────
cases.push({
  name: '[selfCheck] ppt-images-pipeline 内置 10 个用例全过',
  fn: async () => {
    const { selfCheck } = require('../src/main/services/ppt-images-pipeline.service');
    const r = await selfCheck();
    if (!r.success) throw new Error(`selfCheck 未全过：${JSON.stringify(r.failures)}`);
    if (r.passed !== 10 || r.total !== 10) throw new Error(`期望 10/10，实际 ${r.passed}/${r.total}`);
  },
});

// ── 2) integration: helper 调 service 完整流程 ────
cases.push({
  name: '[integration] buildAgentPptImagesHelper 调 service 返回成功',
  fn: async () => {
    const { runPptImagesPipeline } = require('../src/main/services/ppt-images-pipeline.service');
    let pipelineCalled = false;
    const fakeRuntime = {
      generatePptPageCandidates: async () => ({ candidates: [{ imagePath: '/x.png' }] }),
    };
    const result = await runPptImagesPipeline({
      db: {
        getLatestArtifact: () => ({ content: { pptPages: [
          { id: 1, pageType: 'cover', imagePrompt: '封面' },
          { id: 2, imagePrompt: 'p2' },
        ]}}),
        getNotebookById: () => ({ name: 'X' }),
      },
      notebookId: 1,
      pptArtifact: { content: { pptPages: [
        { id: 1, pageType: 'cover', imagePrompt: '封面' },
        { id: 2, imagePrompt: 'p2' },
      ]}},
      notebook: { name: 'X' },
    }, { v2Runtime: fakeRuntime, rateLimitMs: 0 });
    if (!result.success) throw new Error(`期望成功，实际：${result.pauseReason}`);
    if (!result.styleAnchor) throw new Error('应有 styleAnchor');
  },
});

// ── 3) pauseFlow: 封面 vision 失败 → paused ──
cases.push({
  name: '[pauseFlow] 封面 vision 失败 → result.paused=true',
  fn: async () => {
    const { runPptImagesPipeline } = require('../src/main/services/ppt-images-pipeline.service');
    const fakeVision = {
      assessImageQuality: async () => ({ ok: true, relevanceScore: 3, raw: {} }),
      isQualityPass: () => false,
    };
    const result = await runPptImagesPipeline({
      db: {}, notebookId: 1,
      pptArtifact: { content: { pptPages: [{ id: 1, pageType: 'cover', imagePrompt: '封面' }] } },
      notebook: { name: 'X' },
    }, {
      v2Runtime: { generatePptPageCandidates: async () => ({ candidates: [{ imagePath: '/c.png' }] }) },
      qualityVisionService: fakeVision,
      rateLimitMs: 0,
    });
    if (!result.paused) throw new Error('封面失败应 paused');
    if (result.phase !== 'cover') throw new Error(`期望 cover phase，实际 ${result.phase}`);
    if (!Array.isArray(result.suggestions) || result.suggestions.length === 0) {
      throw new Error('应有 suggestions');
    }
  },
});

// ── 4) styleAnchorPass: 内容页 imagePrompt 含风格锚点 ──
cases.push({
  name: '[styleAnchor] 内容页生成时 imagePrompt 拼接 styleAnchor',
  fn: async () => {
    const { runPptImagesPipeline } = require('../src/main/services/ppt-images-pipeline.service');
    const promptsSeen = [];
    const result = await runPptImagesPipeline({
      db: {}, notebookId: 1,
      pptArtifact: { content: { pptPages: [
        { id: 1, pageType: 'cover', imagePrompt: '封面提示' },
        { id: 2, imagePrompt: '原始内容提示' },
      ]}},
      notebook: { name: 'X' },
    }, {
      v2Runtime: {
        generatePptPageCandidates: async (payload) => {
          promptsSeen.push(payload.page?.imagePrompt || '');
          return { candidates: [{ imagePath: '/p.png' }] };
        },
      },
      rateLimitMs: 0,
    });
    if (!result.success) throw new Error('应成功');
    // 第一次是封面，第二次是内容页（应含 [风格保持]）
    const contentCallPrompt = promptsSeen.find(p => p.includes('原始内容提示'));
    if (!contentCallPrompt) throw new Error('找不到内容页调用');
    if (!contentCallPrompt.includes('[风格保持]')) {
      throw new Error('内容页 imagePrompt 应含 [风格保持] 锚点');
    }
  },
});

// ── 5) needsReview: vision 不通过的页面标记 manual_review ──
cases.push({
  name: '[needsReview] vision 不通过的内容页标记 manual_review',
  fn: async () => {
    const { runPptImagesPipeline } = require('../src/main/services/ppt-images-pipeline.service');
    let visionCount = 0;
    const fakeVision = {
      assessImageQuality: async () => {
        visionCount++;
        // 封面通过，内容页 1 不通过（重试也不通过），内容页 2 不通过
        if (visionCount === 1) return { ok: true, relevanceScore: 8, raw: {} };
        return { ok: true, relevanceScore: 5, styleScore: 5, raw: {} };
      },
      isQualityPass: (a) => (a.relevanceScore || 0) >= 7 && (a.styleScore || 0) >= 7,
      formatIssuesAsRefinementHint: () => '加强',
    };
    const result = await runPptImagesPipeline({
      db: {}, notebookId: 1,
      pptArtifact: { content: { pptPages: [
        { id: 1, pageType: 'cover', imagePrompt: '封面' },
        { id: 2, imagePrompt: 'p2' },
        { id: 3, imagePrompt: 'p3' },
      ]}},
      notebook: { name: 'X' },
    }, {
      v2Runtime: { generatePptPageCandidates: async () => ({ candidates: [{ imagePath: '/x.png' }] }) },
      qualityVisionService: fakeVision,
      rateLimitMs: 0,
    });
    if (result.paused) throw new Error('内容页失败不应暂停');
    if (result.needsReviewCount < 1) throw new Error(`应至少 1 张待复核，实际 ${result.needsReviewCount}`);
  },
});

// ── 6) loadingCheck ────────────────────────────────
// P1.1（2026-05-17）：agent.handlers 已删，仅校验 ppt-images-pipeline.service 加载
cases.push({
  name: '[loading] ppt-images-pipeline.service 加载无错',
  fn: () => {
    delete require.cache[require.resolve('../src/main/services/ppt-images-pipeline.service')];
    require('../src/main/services/ppt-images-pipeline.service');
  },
});

// ── 7) emit 事件流 ─────────────────────────────────
cases.push({
  name: '[emit] 流水线发出 phase / page_done / phase_done 事件',
  fn: async () => {
    const { runPptImagesPipeline } = require('../src/main/services/ppt-images-pipeline.service');
    const events = [];
    await runPptImagesPipeline({
      db: {}, notebookId: 1,
      pptArtifact: { content: { pptPages: [
        { id: 1, pageType: 'cover', imagePrompt: '封面' },
        { id: 2, imagePrompt: 'p2' },
      ]}},
      notebook: { name: 'X' },
    }, {
      v2Runtime: { generatePptPageCandidates: async () => ({ candidates: [{ imagePath: '/x.png' }] }) },
      emit: (type, payload) => events.push({ type, payload }),
      rateLimitMs: 0,
    });
    const types = events.map(e => e.type);
    if (!types.includes('phase')) throw new Error('应 emit phase 事件');
    if (!types.includes('page_done')) throw new Error('应 emit page_done 事件');
    if (!types.includes('phase_done')) throw new Error('应 emit phase_done 事件（封面）');
  },
});

// ── 8) consistencyScore ─────────────────────────────
cases.push({
  name: '[consistency] mock 模式 consistencyScore ≥ 8',
  fn: async () => {
    const { runPptImagesPipeline } = require('../src/main/services/ppt-images-pipeline.service');
    const result = await runPptImagesPipeline({
      db: {}, notebookId: 1,
      pptArtifact: { content: { pptPages: [
        { id: 1, pageType: 'cover', imagePrompt: '封面' },
        { id: 2, imagePrompt: 'p2' },
        { id: 3, imagePrompt: 'p3' },
        { id: 4, imagePrompt: 'p4' },
      ]}},
      notebook: { name: 'X' },
    }, {
      v2Runtime: { generatePptPageCandidates: async () => ({ candidates: [{ imagePath: '/x.png' }] }) },
      rateLimitMs: 0,
    });
    if (!result.success) throw new Error('应成功');
    if ((result.consistencyScore || 0) < 8) throw new Error(`期望 ≥8，实际 ${result.consistencyScore}`);
  },
});

// ── 主流程 ────────────────────────────────────────
async function main() {
  let passed = 0;
  const failures = [];
  for (const c of cases) {
    try {
      const r = c.fn();
      if (r && typeof r.then === 'function') await r;
      passed++;
    } catch (e) {
      failures.push({ name: c.name, message: e.message });
    }
  }
  const ok = failures.length === 0;
  console.log(JSON.stringify({
    ok, checkedAt: new Date().toISOString(),
    passed, total: cases.length, failures,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
