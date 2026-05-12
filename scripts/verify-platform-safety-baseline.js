/**
 * verify-platform-safety-baseline.js — Phase-6 M4.2 业务级全局基线验证
 *
 * 验证 6 个层面：
 *   1) selfCheck         — platform-safety.builder 内置 13 个用例
 *   2) integration       — 与 prompt-assembler.assembleWithBaseline 协同
 *   3) stageSpecificity  — 4 种 stage 的差异化注入正确
 *   4) deduplication     — 调用方已有同 id 时跳过基线注入
 *   5) developerSafe     — 内容不含 H1-H8 / contracts.js / npm 等开发者关键词
 *   6) snapshot          — 4 个固定 stage 的装配输出哈希稳定
 *
 * 用法：node scripts/verify-platform-safety-baseline.js
 *      node scripts/verify-platform-safety-baseline.js --update
 *
 * 退出码：0=全部通过，1=任意检查失败
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const builder = require('../src/main/agent/builders/platform-safety.builder');
const { selfCheck, buildPlatformSafetyBaselineFragments, getBaselineIdsForStage, isBaselineFragmentId, KNOWN_STAGES } = builder;

const { FRAGMENT_TYPE, LIFETIME } = require('../src/main/agent/source-registry');
const { assembleWithBaseline, assemble } = require('../src/main/agent/prompt-assembler');

const SNAPSHOT_FILE = path.join(__dirname, '__snapshots__', 'platform-safety-baseline.snap.json');
const UPDATE_MODE = process.argv.includes('--update');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function loadSnapshots() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveSnapshots(snaps) {
  const dir = path.dirname(SNAPSHOT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snaps, null, 2) + '\n', 'utf8');
}

const cases = [];

// ─── 1) selfCheck ─────────────────────────────────────
cases.push({
  name: '[selfCheck] platform-safety.builder 内置自检 13/13',
  fn: () => {
    const r = selfCheck();
    if (!r.success) throw new Error(`selfCheck 未全过：${JSON.stringify(r.failures)}`);
    if (r.passed !== 13 || r.total !== 13) throw new Error(`期望 13/13，实际 ${r.passed}/${r.total}`);
  },
});

// ─── 2) integration ─────────────────────────────────────
cases.push({
  name: '[integration] assembleWithBaseline 自动注入 4 条基线',
  fn: () => {
    const businessFragments = [{
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT, id: 'biz_role', priority: 50,
        source: 'test', lifetime: LIFETIME.PERSISTENT, scope: 'lecture_stage',
      },
      content: '业务角色定义',
    }];
    const out = assembleWithBaseline(businessFragments, { stage: 'lecture' });
    const fragmentCount = (out.match(/<FRAGMENT/g) || []).length;
    if (fragmentCount !== 5) throw new Error(`应有 5 个 FRAGMENT（4 基线+1 业务），实际 ${fragmentCount}`);
    if (!out.includes('baseline_no_meta_descriptions')) throw new Error('应含 no_meta_descriptions');
    if (!out.includes('biz_role')) throw new Error('应含业务 fragment');
  },
});

cases.push({
  name: '[integration] withBaseline=false 退化为普通 assemble',
  fn: () => {
    const businessFragments = [{
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT, id: 'biz_role', priority: 50,
        source: 'test', lifetime: LIFETIME.PERSISTENT, scope: 'lecture_stage',
      },
      content: '业务角色定义',
    }];
    const out = assembleWithBaseline(businessFragments, { stage: 'lecture', withBaseline: false });
    const fragmentCount = (out.match(/<FRAGMENT/g) || []).length;
    if (fragmentCount !== 1) throw new Error(`withBaseline=false 应只有业务 fragment，实际 ${fragmentCount}`);
    if (out.includes('baseline_')) throw new Error('禁用基线时不应注入');
  },
});

cases.push({
  name: '[integration] 基线在装配输出最前（slot=0 PLATFORM_SAFETY）',
  fn: () => {
    const businessFragments = [{
      meta: {
        type: FRAGMENT_TYPE.PRODUCT_DEFAULT, id: 'biz_x', priority: 50,
        source: 'test', lifetime: LIFETIME.PERSISTENT, scope: 'lecture_stage',
      },
      content: '业务',
    }];
    const out = assembleWithBaseline(businessFragments, { stage: 'lecture' });
    const baselineIdx = out.indexOf('baseline_no_meta_descriptions');
    const businessIdx = out.indexOf('biz_x');
    if (baselineIdx === -1 || businessIdx === -1) throw new Error('装配输出缺关键 fragment');
    if (baselineIdx > businessIdx) throw new Error('基线应在业务前');
  },
});

// ─── 3) stageSpecificity ───────────────────────────────
cases.push({
  name: '[stage] framework 注入 2 条（vocational + factual，跳过 meta/AI 腔）',
  fn: () => {
    const fragments = buildPlatformSafetyBaselineFragments('framework');
    if (fragments.length !== 2) throw new Error(`framework 应注入 2 条，实际 ${fragments.length}`);
  },
});

cases.push({
  name: '[stage] lecture 注入 4 条全部',
  fn: () => {
    const fragments = buildPlatformSafetyBaselineFragments('lecture');
    if (fragments.length !== 4) throw new Error(`lecture 应注入 4 条，实际 ${fragments.length}`);
  },
});

cases.push({
  name: '[stage] ppt 注入 4 条全部',
  fn: () => {
    const fragments = buildPlatformSafetyBaselineFragments('ppt');
    if (fragments.length !== 4) throw new Error(`ppt 应注入 4 条，实际 ${fragments.length}`);
  },
});

cases.push({
  name: '[stage] video 注入 2 条（仅 no_ai_tone + factual_grounding）',
  fn: () => {
    const fragments = buildPlatformSafetyBaselineFragments('video');
    if (fragments.length !== 2) throw new Error(`video 应注入 2 条，实际 ${fragments.length}`);
    if (fragments.some((f) => f.meta.id === 'baseline_vocational_redlines')) {
      throw new Error('video 不应含 vocational_redlines');
    }
    if (fragments.some((f) => f.meta.id === 'baseline_no_meta_descriptions')) {
      throw new Error('video 不应含 no_meta_descriptions（视频提示词非讲稿）');
    }
  },
});

// ─── 4) deduplication ───────────────────────────────
cases.push({
  name: '[dedup] 调用方传入同 id 基线时跳过自动注入',
  fn: () => {
    // 调用方手工传入一个 id='baseline_no_ai_tone' 的自定义版本
    const customBaseline = {
      meta: {
        type: FRAGMENT_TYPE.PLATFORM_SAFETY, id: 'baseline_no_ai_tone', priority: 100,
        source: 'custom_override', lifetime: LIFETIME.PERSISTENT, scope: 'global_baseline',
      },
      content: '自定义版本的 AI 腔禁忌',
    };
    const out = assembleWithBaseline([customBaseline], { stage: 'lecture' });
    // 应只出现一次 baseline_no_ai_tone（调用方版本）
    const occurrences = (out.match(/id="baseline_no_ai_tone"/g) || []).length;
    if (occurrences !== 1) throw new Error(`baseline_no_ai_tone 应仅出现 1 次，实际 ${occurrences}`);
    // 自定义内容应被保留
    if (!out.includes('自定义版本的 AI 腔禁忌')) throw new Error('应使用调用方版本');
  },
});

// ─── 5) developerSafe ─────────────────────────────
cases.push({
  name: '[safety] 基线内容不泄漏 H1-H8 / contracts.js / index.js 等开发者关键词',
  fn: () => {
    const fragments = buildPlatformSafetyBaselineFragments('global');
    const allContent = fragments.map((f) => f.content).join('\n');
    const forbidden = [
      /\bH[1-8]\b/,
      /contracts\.js/,
      /index\.js/,
      /quality\.js/,
      /npm install/,
      /node_modules/,
    ];
    for (const re of forbidden) {
      if (re.test(allContent)) {
        throw new Error(`基线内容含开发者关键词 ${re}，违反 M4.2 设计边界`);
      }
    }
  },
});

cases.push({
  name: '[safety] 基线 priority=100，scope=global_baseline，lifetime=persistent',
  fn: () => {
    const fragments = buildPlatformSafetyBaselineFragments('global');
    for (const f of fragments) {
      if (f.meta.priority !== 100) throw new Error(`${f.meta.id} priority 应为 100`);
      if (f.meta.scope !== 'global_baseline') throw new Error(`${f.meta.id} scope 错`);
      if (f.meta.lifetime !== 'persistent') throw new Error(`${f.meta.id} lifetime 错`);
    }
  },
});

// ─── 6) snapshot ──────────────────────────────────────
function captureSnapshots() {
  const snaps = {};
  for (const stage of ['framework', 'lecture', 'ppt', 'video', 'global']) {
    const out = assembleWithBaseline([], { stage });
    snaps[`baseline.${stage}`] = {
      hash: sha256(out),
      chars: out.length,
      fragmentCount: (out.match(/<FRAGMENT/g) || []).length,
    };
  }
  return snaps;
}

cases.push({
  name: '[snapshot] 5 个 stage 的基线装配 hash 稳定',
  fn: () => {
    const current = captureSnapshots();
    const stored = loadSnapshots();
    const failures = [];
    for (const key of Object.keys(current)) {
      if (!stored || !stored[key]) continue;  // 首次运行跳过
      if (stored[key].hash !== current[key].hash && !UPDATE_MODE) {
        failures.push({ key, stored: stored[key].hash.slice(0, 12), current: current[key].hash.slice(0, 12) });
      }
    }
    if (UPDATE_MODE || !stored) {
      saveSnapshots(current);
    }
    if (failures.length) {
      throw new Error(`snapshot 不一致：${JSON.stringify(failures)}\n若有意修改基线，跑 --update`);
    }
  },
});

cases.push({
  name: '[utils] getBaselineIdsForStage / isBaselineFragmentId',
  fn: () => {
    const ids = getBaselineIdsForStage('lecture');
    if (ids.length !== 4) throw new Error(`lecture 应有 4 个基线 id`);
    if (!isBaselineFragmentId('baseline_no_meta_descriptions')) throw new Error('应识别基线 id');
    if (isBaselineFragmentId('not_a_baseline')) throw new Error('非基线 id 不应识别');
  },
});

cases.push({
  name: '[const] KNOWN_STAGES 含 framework/lecture/ppt/video/global',
  fn: () => {
    for (const s of ['framework', 'lecture', 'ppt', 'video', 'global']) {
      if (!KNOWN_STAGES.includes(s)) throw new Error(`KNOWN_STAGES 缺 ${s}`);
    }
  },
});

// ─── 主流程 ────────────────────────────────────────
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
    ok, checkedAt: new Date().toISOString(), updateMode: UPDATE_MODE,
    passed, total: cases.length, failures,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
