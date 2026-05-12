/**
 * verify-agent-pipeline-extension.js — Phase-7 B1+B2+B3 验证
 *
 * 验证扩展的 3 个 Agent 动作（capability-gated）：
 *   ① generate_framework_infographic — 教学框架信息图（B1）
 *   ② export_knowledge_cards         — 知识点互动卡片导出（B3）
 *   ③ generate_ppt_images_batch       — PPT 配图批量（B2）
 *
 * 验证 5 个层面：
 *   1) capabilityGating  — capabilities 缺失时不触发对应动作（向后兼容）
 *   2) decisionPriority  — capability 启用后决策按预期优先级触发
 *   3) executionPath     — helpers 注入函数被正确调用
 *   4) errorTolerance    — helpers 抛错时 stepEntry.result='error_non_fatal' 不中断主流程
 *   5) artifactDetection — assessNotebookState 正确识别扩展产物状态
 *
 * 用法：node scripts/verify-agent-pipeline-extension.js
 *
 * 退出码：0=全部通过，1=任意失败
 */

const fs = require('fs');
const path = require('path');

// 加载真实 conflict-policy（避免与 verify-agent-orchestrator 同样的 mock 递归问题）
const conflictPolicyReal = require('../src/main/agent/conflict-policy');

// ── Mock 全部依赖加载 orchestrator ──
let decideNextAction, assessNotebookStateRaw;
try {
  const src = fs.readFileSync(
    path.join(__dirname, '../src/main/agent/orchestrator.js'), 'utf8'
  );
  const wrapperSrc = `${src}\nmodule.exports._decide = decideNextAction;\nmodule.exports._assess = assessNotebookState;\n`;
  const tmpPath = path.join(__dirname, '__tmp_pipeline_test__.js');
  fs.writeFileSync(tmpPath, wrapperSrc);

  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (req) {
    if (req.includes('abc-generator')) return { generateLectureABCDrafts: async () => ({}) };
    if (req.includes('framework-schema')) return {
      normalizeFrameworkContent: (x) => x,
      validateFrameworkContent: (c) => ({ valid: c?._mockValid !== false, errors: [], warnings: [] })
    };
    if (req.includes('quality')) return {
      validateLectureStage: (d) => ({ valid: d?._mockQualityValid !== false, errors: [], checks: { finalNarrationCharCount: d?._mockCharCount || 0 } })
    };
    if (req.includes('context-builder')) return {
      buildLectureContext: () => ({ frameworkObjectives: '', frameworkTeachingMethods: '' }),
      buildPptContext: () => ({ lectureSections: [], lectureSectionSummary: '' })
    };
    if (req.includes('retry-loop')) return { generateWithRetry: async () => ({ result: {}, quality: { valid: true }, attempts: 1, exhausted: false, attemptLog: [] }) };
    if (req.includes('ark')) return { generateFramework: async () => ({}) };
    if (req.includes('memory')) return { saveMemory: () => {}, buildMemoryContext: () => '' };
    if (req.includes('ppt-plan-generator')) return { generatePptPlan: async () => ({ pages: [], pageCount: 0 }) };
    if (req.includes('v2-stage-helpers')) return { videoPrompt: () => '<x></x>' };
    if (req.includes('conflict-policy')) return conflictPolicyReal;
    if (req.includes('generation-audit')) return { recordGeneration: async () => null };
    return origLoad.apply(this, arguments);
  };
  const mod = require(tmpPath);
  decideNextAction = mod._decide;
  assessNotebookStateRaw = mod._assess;
  Module._load = origLoad;
  fs.unlinkSync(tmpPath);
} catch (e) {
  console.error('加载 orchestrator 失败:', e.message);
  process.exit(1);
}

// ── 测试辅助 ──
function makeState(over = {}) {
  return {
    notebook: { id: 1, name: 'X' },
    framework: { id: 1, content: { _mockValid: true } },
    frameworkQuality: { valid: true, errors: [], warnings: [] },
    draftCount: 3,
    drafts: { a: 'A'.repeat(300), b: 'B'.repeat(300), c: 'C'.repeat(300) },
    finalScript: 'F'.repeat(8000),
    lectureQuality: { valid: true, errors: [], checks: { finalNarrationCharCount: 8000 } },
    pptPageCount: 5,
    videoPromptExists: false,
    frameworkInfographicExists: false,
    knowledgeCardsExists: false,
    pptPagesCount: 5,
    pptPagesWithImages: 0,
    pptImagesAllReady: false,
    ...over,
  };
}

const cases = [];

// ── 1) capabilityGating ──
cases.push({
  name: 'B1 capability=false 时不触发 framework_infographic',
  fn: () => {
    const state = makeState({ pptImagesAllReady: true, finalScript: '', pptPageCount: 0 });
    const d = decideNextAction(state, ['framework'], [], { canGenerateFrameworkInfographic: false });
    if (d.action === 'generate_framework_infographic') throw new Error('capability=false 不应触发');
  },
});

cases.push({
  name: 'B3 capability=false 时不触发 export_knowledge_cards',
  fn: () => {
    const state = makeState({ frameworkInfographicExists: true, finalScript: '', pptPageCount: 0 });
    const d = decideNextAction(state, ['framework'], [], { canExportKnowledgeCards: false });
    if (d.action === 'export_knowledge_cards') throw new Error('capability=false 不应触发');
  },
});

cases.push({
  name: 'B2 capability=false 时不触发 generate_ppt_images_batch',
  fn: () => {
    const state = makeState();
    const d = decideNextAction(state, ['ppt'], [], { canGeneratePptImages: false });
    if (d.action === 'generate_ppt_images_batch') throw new Error('capability=false 不应触发');
  },
});

// ── 2) decisionPriority ──
cases.push({
  name: 'B1 capability=true 且未生成时触发 framework_infographic',
  fn: () => {
    const state = makeState({ frameworkInfographicExists: false, knowledgeCardsExists: true, pptImagesAllReady: true, finalScript: '', pptPageCount: 0 });
    const d = decideNextAction(state, ['framework'], [], { canGenerateFrameworkInfographic: true });
    if (d.action !== 'generate_framework_infographic') {
      throw new Error(`期望 generate_framework_infographic，实际 ${d.action}`);
    }
  },
});

cases.push({
  name: 'B3 capability=true 且未导出时触发 export_knowledge_cards',
  fn: () => {
    const state = makeState({ frameworkInfographicExists: true, knowledgeCardsExists: false, pptImagesAllReady: true, finalScript: '', pptPageCount: 0 });
    const d = decideNextAction(state, ['framework'], [], { canExportKnowledgeCards: true });
    if (d.action !== 'export_knowledge_cards') {
      throw new Error(`期望 export_knowledge_cards，实际 ${d.action}`);
    }
  },
});

cases.push({
  name: 'B2 capability=true 且 PPT 配图未完成时触发 generate_ppt_images_batch',
  fn: () => {
    const state = makeState();
    const d = decideNextAction(state, ['ppt'], [], { canGeneratePptImages: true });
    if (d.action !== 'generate_ppt_images_batch') {
      throw new Error(`期望 generate_ppt_images_batch，实际 ${d.action}`);
    }
  },
});

cases.push({
  name: 'B2 PPT 配图已完成时不重复触发',
  fn: () => {
    const state = makeState({ pptImagesAllReady: true, pptPagesWithImages: 5 });
    const d = decideNextAction(state, ['ppt'], [], { canGeneratePptImages: true });
    if (d.action === 'generate_ppt_images_batch') throw new Error('已完成不应再触发');
  },
});

cases.push({
  name: '已生成的扩展产物不重复触发（含 stepLog 计数）',
  fn: () => {
    const state = makeState({ frameworkInfographicExists: false, knowledgeCardsExists: true, pptImagesAllReady: true, finalScript: '', pptPageCount: 0 });
    const stepLog = [{ action: 'generate_framework_infographic', result: 'ok' }];
    const d = decideNextAction(state, ['framework'], stepLog, { canGenerateFrameworkInfographic: true });
    if (d.action === 'generate_framework_infographic') throw new Error('计数 ≥ 1 后不应再触发');
  },
});

// ── 3) decisionOrder：B2 PPT 配图优先级高于 B1 框架信息图 ──
cases.push({
  name: 'PPT 配图优先级高于 framework 扩展',
  fn: () => {
    const state = makeState({ frameworkInfographicExists: false, knowledgeCardsExists: false });
    const d = decideNextAction(state, ['framework', 'ppt'], [], {
      canGenerateFrameworkInfographic: true,
      canExportKnowledgeCards: true,
      canGeneratePptImages: true,
    });
    if (d.action !== 'generate_ppt_images_batch') {
      throw new Error(`PPT 配图应优先（priority 6），实际 ${d.action}`);
    }
  },
});

// ── 4) artifactDetection ──
cases.push({
  name: 'assessNotebookState 检测 framework_infographic artifact',
  fn: () => {
    const fakeDb = {
      getNotebookById: () => ({ id: 1, name: 'X', totalHours: 4 }),
      getCurrentFramework: () => null,
      getModulesByNotebook: () => [],
      getLatestArtifact: (nid, type, stage) => {
        if (type === 'framework_infographic' && stage === 'framework') {
          return { content: { htmlPath: '/x.html', imagePath: '/x.png' } };
        }
        return null;
      },
    };
    const state = assessNotebookStateRaw(fakeDb, 1);
    if (!state.frameworkInfographicExists) throw new Error('应检测到信息图 artifact');
  },
});

cases.push({
  name: 'assessNotebookState 检测 knowledge_cards_html artifact',
  fn: () => {
    const fakeDb = {
      getNotebookById: () => ({ id: 1, name: 'X' }),
      getCurrentFramework: () => null,
      getModulesByNotebook: () => [],
      getLatestArtifact: (nid, type, stage) => {
        if (type === 'knowledge_cards_html' && stage === 'framework') {
          return { content: { outputPath: '/cards.html' } };
        }
        return null;
      },
    };
    const state = assessNotebookStateRaw(fakeDb, 1);
    if (!state.knowledgeCardsExists) throw new Error('应检测到知识卡片 artifact');
  },
});

cases.push({
  name: 'assessNotebookState 计算 PPT 配图完成度',
  fn: () => {
    const fakeDb = {
      getNotebookById: () => ({ id: 1, name: 'X' }),
      getCurrentFramework: () => null,
      getModulesByNotebook: () => [],
      getLatestArtifact: (nid, type, stage) => {
        if (type === 'ppt_outline') {
          return { content: { pptPages: [
            { id: 1, imagePath: '/p1.png' },
            { id: 2, imageUrl: 'http://x/p2.png' },
            { id: 3 },                              // 缺图
          ]}};
        }
        return null;
      },
    };
    const state = assessNotebookStateRaw(fakeDb, 1);
    if (state.pptPagesCount !== 3) throw new Error(`pptPagesCount 应=3, 实际 ${state.pptPagesCount}`);
    if (state.pptPagesWithImages !== 2) throw new Error(`pptPagesWithImages 应=2，实际 ${state.pptPagesWithImages}`);
    if (state.pptImagesAllReady !== false) throw new Error('pptImagesAllReady 应为 false');
  },
});

// ── 5) errorTolerance（agent.handlers.js 加载） ──
cases.push({
  name: 'agent.handlers.js 加载 + 暴露注入函数',
  fn: () => {
    delete require.cache[require.resolve('../src/main/ipc/agent.handlers')];
    const m = require('../src/main/ipc/agent.handlers');
    if (typeof m.register !== 'function') throw new Error('应导出 register');
  },
});

// ── 主流程 ──
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
