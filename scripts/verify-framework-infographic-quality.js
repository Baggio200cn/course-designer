/**
 * verify-framework-infographic-quality.js — Phase-7.5 M7.5.4 验证
 *
 * 验证 buildAgentFrameworkInfographicHelper 的"质量优先"行为：
 *   1. 启发式审核：HTML 太短 / 缺 <style> / 缺 <div> / 含讲稿元词均触发重试
 *   2. Vision 审核：score≥7 通过 / score<7 触发重试 / 缺 service 退化为仅启发式
 *   3. 重试机制：最多 3 次尝试，第二次起 prompt 含审核反馈
 *   4. 失败兜底：3 次都失败返回 { skipped: true, reason }，不写 artifact
 *   5. 成功路径：写 framework_infographic artifact + qualityScore + attempts
 *   6. 增强 prompt：包含 <level1>/<level2>/<level3> 三层 XML 标签
 *   7. 兼容性：deps 缺 qualityVisionService 时仍能工作（仅启发式审核通过即放行）
 *
 * 用法：node scripts/verify-framework-infographic-quality.js
 *
 * 退出码：0=全部通过，1=任意失败
 */

const path = require('path');

// 直接 require helper 模块（无副作用，不会注册 IPC）
// 该模块导出 register；我们需要 buildAgentFrameworkInfographicHelper 函数本身。
// 为了拿到内部函数，从 module 加载后通过 require.cache 抽取，或用 rewire 风格的 wrapper。
// 这里用最朴素的：把模块源码读出来，注入捕获代码。

const fs = require('fs');
const Module = require('module');

const SRC_PATH = path.join(__dirname, '..', 'src', 'main', 'ipc', 'agent.handlers.js');
let buildAgentFrameworkInfographicHelper;

try {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const wrapperSrc = `${src}\nmodule.exports._buildAgentFrameworkInfographicHelper = buildAgentFrameworkInfographicHelper;\n`;
  const tmpPath = path.join(__dirname, '__tmp_framework_infographic_quality__.js');
  fs.writeFileSync(tmpPath, wrapperSrc);

  const origLoad = Module._load;
  // 屏蔽与 IPC 强相关但无关测试的依赖
  Module._load = function (req) {
    if (req.includes('agent/orchestrator')) return {
      createAgentOrchestrator: () => ({}), assessNotebookState: () => ({}),
    };
    if (req.includes('api/provider-config')) return {
      resolveProviderConfig: () => ({}), createAiClientByConfig: () => ({}),
    };
    if (req.includes('export/knowledge-cards-interactive')) return {
      exportInteractiveKnowledgeCards: () => {},
    };
    return origLoad.apply(this, arguments);
  };
  const mod = require(tmpPath);
  buildAgentFrameworkInfographicHelper = mod._buildAgentFrameworkInfographicHelper;
  Module._load = origLoad;
  fs.unlinkSync(tmpPath);
} catch (e) {
  console.error('加载 agent.handlers.js 失败:', e.message);
  process.exit(1);
}

if (typeof buildAgentFrameworkInfographicHelper !== 'function') {
  console.error('未能抽取 buildAgentFrameworkInfographicHelper');
  process.exit(1);
}

// ─── Mock 工厂 ───────────────────────────────────────────
function makeNotebook(over = {}) {
  return {
    id: 1, name: '店铺三维表现', totalHours: 48,
    softwareTools: 'Blender 4.x', jobTargets: '三维建模师', ...over,
  };
}

function makeFramework() {
  return {
    content: {
      objectives: {
        knowledge: ['三维空间建模原理', '材质与贴图基础', '灯光与渲染'],
        skill: ['独立完成单店建模', '使用真实渲染器出图'],
      },
    },
  };
}

function makeModules() {
  return [
    { name: '导入与单位设置', knowledgePoints: ['坐标系', '场景单位'], hours: 6 },
    { name: '基础建模', knowledgePoints: ['编辑模式', '修改器'], hours: 12 },
    { name: '材质贴图', knowledgePoints: ['节点编辑器', 'PBR'], hours: 10 },
    { name: '灯光渲染', knowledgePoints: ['HDRI', 'Cycles'], hours: 12 },
    { name: '后期合成', knowledgePoints: ['节点合成', '色彩管理'], hours: 8 },
  ];
}

function makeDb({ artifactSpy } = {}) {
  return {
    getNotebookById: () => makeNotebook(),
    createArtifact: (a) => { if (artifactSpy) artifactSpy.push(a); return { id: 1 }; },
  };
}

function makeGoodHtml() {
  // > 1000 字节 + 含 <style> + <div>
  const filler = '<div class="card">知识点说明文字</div>'.repeat(40);
  return `<!doctype html><html><head><style>.card{padding:16px}</style></head><body><div>${filler}</div></body></html>`;
}

const PROMPT_LOG = []; // 收集每次 generateHtml 的 prompt 供断言

function makeService({ htmlSequence } = {}) {
  let i = 0;
  return {
    buildEnhancedPrompt: (params) => {
      const composed = [
        `course=${params.course_name}`,
        `topic=${params.topic}`,
        params.content || '',
        `style=${params.style || ''}`,
      ].join('\n');
      return composed;
    },
    generateHtml: async ({ promptFinal }) => {
      PROMPT_LOG.push(promptFinal);
      if (Array.isArray(htmlSequence)) {
        const next = htmlSequence[Math.min(i, htmlSequence.length - 1)];
        i++;
        if (typeof next === 'function') return next();
        return next;
      }
      return makeGoodHtml();
    },
    saveArtifacts: ({ html, pngBuffer, title, notebookId }) => ({
      htmlPath: `/tmp/${title}.html`,
      imagePath: `/tmp/${title}.png`,
      resourceId: 100,
    }),
  };
}

function makeRenderer() {
  return async () => Buffer.from('PNGFAKE');
}

// ─── 测试用例 ────────────────────────────────────────────
const cases = [];

cases.push({
  name: '兼容性：deps 缺 qualityVisionService 时仅启发式审核通过即放行',
  fn: async () => {
    PROMPT_LOG.length = 0;
    const artifactSpy = [];
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService(),
      renderHtmlToPngBuffer: makeRenderer(),
      inferInfocardStyle: () => 'professional',
      // 故意不传 qualityVisionService
    });
    const r = await helper({ db: makeDb({ artifactSpy }), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    if (r.skipped) throw new Error(`不应 skipped, got ${JSON.stringify(r)}`);
    if (r.attempts !== 1) throw new Error(`应 1 次成功, attempts=${r.attempts}`);
    if (artifactSpy.length !== 1) throw new Error(`应写 1 个 artifact, got ${artifactSpy.length}`);
  },
});

cases.push({
  name: '增强 prompt 包含 L1/L2/L3 三层 XML 标签',
  fn: async () => {
    PROMPT_LOG.length = 0;
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService(),
      renderHtmlToPngBuffer: makeRenderer(),
    });
    await helper({ db: makeDb(), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    const prompt = PROMPT_LOG[0] || '';
    if (!prompt.includes('<level1')) throw new Error('prompt 应含 <level1>');
    if (!prompt.includes('<level2')) throw new Error('prompt 应含 <level2>');
    if (!prompt.includes('<level3')) throw new Error('prompt 应含 <level3>');
    if (!prompt.includes('教学层次结构')) throw new Error('L1 应有教学层次结构标签内容');
    if (!prompt.includes('视觉风格指引')) throw new Error('L2 应有视觉风格指引内容');
    if (!prompt.includes('信息密度控制')) throw new Error('L3 应有信息密度控制内容');
  },
});

cases.push({
  name: '启发式审核：HTML 太短触发重试',
  fn: async () => {
    PROMPT_LOG.length = 0;
    const tooShort = '<html><body>oops</body></html>'; // < 1000 字节
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService({ htmlSequence: [tooShort, tooShort, makeGoodHtml()] }),
      renderHtmlToPngBuffer: makeRenderer(),
    });
    const r = await helper({ db: makeDb(), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    if (r.skipped) throw new Error('第三次应成功, 不应 skipped');
    if (r.attempts !== 3) throw new Error(`attempts 应=3, got ${r.attempts}`);
  },
});

cases.push({
  name: '启发式审核：含讲稿元词触发重试',
  fn: async () => {
    PROMPT_LOG.length = 0;
    const filler = '<div>x</div>'.repeat(200);
    const lectureHtml = `<!doctype html><html><head><style>.x{}</style></head><body><div>${filler}教师讲述：同学们好</div></body></html>`;
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService({ htmlSequence: [lectureHtml, makeGoodHtml(), makeGoodHtml()] }),
      renderHtmlToPngBuffer: makeRenderer(),
    });
    const r = await helper({ db: makeDb(), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    if (r.skipped) throw new Error('第二次应成功, 不应 skipped');
    if (r.attempts !== 2) throw new Error(`attempts 应=2, got ${r.attempts}`);
    // 第二次的 prompt 应含审核反馈
    if (!PROMPT_LOG[1].includes('讲稿元词')) {
      throw new Error('第二次 prompt 应含审核反馈"讲稿元词"');
    }
  },
});

cases.push({
  name: '启发式审核：缺 <style> 标签触发重试',
  fn: async () => {
    PROMPT_LOG.length = 0;
    const filler = '<div>x</div>'.repeat(200);
    const noStyle = `<!doctype html><html><head></head><body><div>${filler}</div></body></html>`;
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService({ htmlSequence: [noStyle, makeGoodHtml()] }),
      renderHtmlToPngBuffer: makeRenderer(),
    });
    const r = await helper({ db: makeDb(), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    if (r.skipped) throw new Error('第二次应成功');
    if (r.attempts !== 2) throw new Error(`attempts 应=2, got ${r.attempts}`);
    // 验证第二次 prompt 含 <style> 提示
    if (!PROMPT_LOG[1].includes('<style>')) {
      throw new Error('第二次 prompt 应含 <style> 反馈');
    }
  },
});

cases.push({
  name: 'Vision 审核：relevanceScore=8 通过',
  fn: async () => {
    PROMPT_LOG.length = 0;
    const artifactSpy = [];
    const visionCalls = [];
    const fakeVision = {
      assessImageQuality: async (input) => {
        visionCalls.push(input);
        return { ok: true, relevanceScore: 8, styleScore: null, issues: [], suggestions: [] };
      },
    };
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService(),
      renderHtmlToPngBuffer: makeRenderer(),
      qualityVisionService: fakeVision,
    });
    const r = await helper({ db: makeDb({ artifactSpy }), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    if (r.skipped) throw new Error(`不应 skipped, got ${JSON.stringify(r)}`);
    if (r.qualityScore !== 8) throw new Error(`qualityScore 应=8, got ${r.qualityScore}`);
    if (visionCalls.length !== 1) throw new Error(`Vision 应被调 1 次, got ${visionCalls.length}`);
    if (visionCalls[0].criteria !== 'relevance_only') throw new Error('criteria 应=relevance_only');
    if (artifactSpy[0]?.content?.qualityScore !== 8) throw new Error('artifact content 应含 qualityScore=8');
  },
});

cases.push({
  name: 'Vision 审核：relevanceScore=5 触发重试',
  fn: async () => {
    PROMPT_LOG.length = 0;
    let call = 0;
    const fakeVision = {
      assessImageQuality: async () => {
        call++;
        return call === 1
          ? { ok: true, relevanceScore: 5, issues: ['配色单一，缺少教学层次感'], suggestions: ['使用学科主题色 + 高亮强调色'] }
          : { ok: true, relevanceScore: 9, issues: [] };
      },
    };
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService(),
      renderHtmlToPngBuffer: makeRenderer(),
      qualityVisionService: fakeVision,
    });
    const r = await helper({ db: makeDb(), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    if (r.skipped) throw new Error(`不应 skipped, got ${JSON.stringify(r)}`);
    if (r.attempts !== 2) throw new Error(`attempts 应=2, got ${r.attempts}`);
    if (r.qualityScore !== 9) throw new Error(`qualityScore 应=9, got ${r.qualityScore}`);
    // 第二次的 prompt 应含审核反馈
    if (!PROMPT_LOG[1].includes('配色单一')) {
      throw new Error(`第二次 prompt 应含 Vision issues, 实=${PROMPT_LOG[1].slice(0, 200)}`);
    }
  },
});

cases.push({
  name: '失败兜底：3 次都失败返回 { skipped: true } 不写 artifact',
  fn: async () => {
    PROMPT_LOG.length = 0;
    const artifactSpy = [];
    const fakeVision = {
      assessImageQuality: async () => ({ ok: true, relevanceScore: 3, issues: ['内容不相关'], suggestions: [] }),
    };
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService(),
      renderHtmlToPngBuffer: makeRenderer(),
      qualityVisionService: fakeVision,
    });
    const r = await helper({ db: makeDb({ artifactSpy }), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    if (!r.skipped) throw new Error(`应 skipped, got ${JSON.stringify(r)}`);
    if (r.attempts !== 3) throw new Error(`attempts 应=3, got ${r.attempts}`);
    if (typeof r.reason !== 'string' || !r.reason) throw new Error('应含 reason 字符串');
    if (!Array.isArray(r.lastIssues) || r.lastIssues.length === 0) throw new Error('应含 lastIssues');
    if (artifactSpy.length !== 0) throw new Error(`不应写 artifact, got ${artifactSpy.length}`);
    if (!Array.isArray(r.attemptLog) || r.attemptLog.length < 3) {
      throw new Error(`attemptLog 应至少 3 条, got ${r.attemptLog?.length}`);
    }
  },
});

cases.push({
  name: '成功时 artifact content 含 qualityScore + attempts 字段',
  fn: async () => {
    PROMPT_LOG.length = 0;
    const artifactSpy = [];
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService(),
      renderHtmlToPngBuffer: makeRenderer(),
    });
    await helper({ db: makeDb({ artifactSpy }), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    const a = artifactSpy[0];
    if (!a) throw new Error('应写 1 个 artifact');
    if (a.type !== 'framework_infographic') throw new Error(`type 应=framework_infographic, got ${a.type}`);
    if (a.stage !== 'framework') throw new Error(`stage 应=framework`);
    if (typeof a.content.qualityScore !== 'number') throw new Error('content.qualityScore 应为 number');
    if (typeof a.content.attempts !== 'number') throw new Error('content.attempts 应为 number');
    if (!a.content.htmlPath || !a.content.imagePath) throw new Error('content 应含 htmlPath/imagePath');
  },
});

cases.push({
  name: 'Vision 服务异常时降级（非阻断）继续走启发式判定',
  fn: async () => {
    PROMPT_LOG.length = 0;
    const fakeVision = {
      assessImageQuality: async () => { throw new Error('Vision API 5xx'); },
    };
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService(),
      renderHtmlToPngBuffer: makeRenderer(),
      qualityVisionService: fakeVision,
    });
    const r = await helper({ db: makeDb(), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    if (r.skipped) throw new Error('Vision 服务异常不应阻断启发式通过');
    if (r.attempts !== 1) throw new Error(`attempts 应=1, got ${r.attempts}`);
  },
});

cases.push({
  name: '重试 prompt 在第二次起追加审核反馈',
  fn: async () => {
    PROMPT_LOG.length = 0;
    const filler = '<div>x</div>'.repeat(200);
    const noDiv = `<!doctype html><html><head><style>.x{}</style></head><body>${filler.replace(/<div>x<\/div>/g, 'x')}</body></html>`;
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService({ htmlSequence: [noDiv, makeGoodHtml()] }),
      renderHtmlToPngBuffer: makeRenderer(),
    });
    const r = await helper({ db: makeDb(), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    if (r.skipped) throw new Error('第二次应成功');
    if (PROMPT_LOG.length < 2) throw new Error('应至少调 2 次 generateHtml');
    if (PROMPT_LOG[0].includes('上一次生成存在以下问题')) {
      throw new Error('第一次 prompt 不应含审核反馈头');
    }
    if (!PROMPT_LOG[1].includes('上一次生成存在以下问题')) {
      throw new Error(`第二次 prompt 应含审核反馈头, 实=${PROMPT_LOG[1].slice(0, 200)}`);
    }
  },
});

cases.push({
  name: '依赖未注入时抛出明确错误',
  fn: async () => {
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      // 故意不传 infographicCardService / renderHtmlToPngBuffer
    });
    let caught = null;
    try {
      await helper({ db: makeDb(), notebookId: 1, framework: makeFramework(), modules: makeModules() });
    } catch (e) {
      caught = e;
    }
    if (!caught) throw new Error('应抛错');
    if (!String(caught.message).includes('信息图渲染依赖未注入')) {
      throw new Error(`错误信息应明确, got ${caught.message}`);
    }
  },
});

cases.push({
  name: 'notebookId 找不到时抛错',
  fn: async () => {
    const helper = buildAgentFrameworkInfographicHelper({
      ensureNotebookWorkspaceState: (x) => x,
      infographicCardService: makeService(),
      renderHtmlToPngBuffer: makeRenderer(),
    });
    const db = { getNotebookById: () => null, createArtifact: () => ({}) };
    let caught = null;
    try { await helper({ db, notebookId: 999, framework: {}, modules: [] }); }
    catch (e) { caught = e; }
    if (!caught) throw new Error('应抛错');
    if (!String(caught.message).includes('Notebook not found')) {
      throw new Error(`错误信息应包含 Notebook not found, got ${caught.message}`);
    }
  },
});

// ─── 主流程 ─────────────────────────────────────────────
async function main() {
  let passed = 0;
  const failures = [];
  for (const c of cases) {
    try {
      await c.fn();
      passed++;
    } catch (e) {
      failures.push({ name: c.name, message: e.message });
    }
  }
  const ok = failures.length === 0;
  console.log(JSON.stringify({
    ok,
    checkedAt: new Date().toISOString(),
    passed,
    total: cases.length,
    failures,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
