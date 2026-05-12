/**
 * verify-prompt-assembly.js — Phase-6 M1.5 装配体系总验证脚本
 *
 * 用途：作为 M1（来源治理底座）的回归防护网，每次改动 source-registry /
 *      fragment-wrapper / prompt-assembler / *.builder 文件时必须跑通。
 *
 * 验证 5 大维度：
 *   1) selfCheck       — 跑所有模块的内置自检（源、包装、装配、abc/formal builder）
 *   2) snapshot        — 装配输出 SHA-256 哈希比对（防止 builder 内容被无意修改）
 *   3) byteEquivalence — legacy 路径输出与原硬编码 systemPrompt 字节级一致（回滚保证）
 *   4) integration     — 实际加载 abc-generator / formal-generator 无语法/路径错误
 *   5) coverage        — 治理覆盖统计（fragment 数、字符量、type 分布）
 *
 * 用法：
 *   node scripts/verify-prompt-assembly.js              # 跑全部检查
 *   node scripts/verify-prompt-assembly.js --update     # 更新快照基线（仅在故意调整 prompt 时使用）
 *
 * 退出码：0=全部通过，1=任意检查失败
 *
 * 依赖：仅 Node.js 内置模块（crypto / fs / path），无第三方包。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── 被测模块 ──────────────────────────────────────────────
const sourceRegistry = require('../src/main/agent/source-registry');
const fragmentWrapper = require('../src/main/agent/fragment-wrapper');
const promptAssembler = require('../src/main/agent/prompt-assembler');
const abcBuilder = require('../src/main/agent/builders/abc.builder');
const formalBuilder = require('../src/main/agent/builders/formal.builder');

const { assemble } = promptAssembler;

const SNAPSHOT_FILE = path.join(__dirname, '__snapshots__', 'prompt-assembly.snap.json');
const UPDATE_MODE = process.argv.includes('--update');

// ─── 工具函数 ─────────────────────────────────────────────
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

// ─── 1) selfCheck ────────────────────────────────────────
function runSelfChecks() {
  const modules = [
    { name: 'source-registry', selfCheck: sourceRegistry.selfCheck },
    { name: 'fragment-wrapper', selfCheck: fragmentWrapper.selfCheck },
    { name: 'prompt-assembler', selfCheck: promptAssembler.selfCheck },
    { name: 'abc.builder', selfCheck: abcBuilder.selfCheck },
    { name: 'formal.builder', selfCheck: formalBuilder.selfCheck },
  ];
  const result = { passed: 0, total: 0, failures: [], byModule: {} };
  for (const m of modules) {
    let res;
    try {
      res = m.selfCheck();
    } catch (e) {
      res = { passed: 0, total: 1, failures: [{ caseIndex: 0, message: 'selfCheck 抛错: ' + e.message }] };
    }
    result.total += res.total;
    result.passed += res.passed;
    result.byModule[m.name] = `${res.passed}/${res.total}`;
    for (const f of (res.failures || [])) {
      result.failures.push({ module: m.name, ...f });
    }
  }
  return result;
}

// ─── 2) snapshot ────────────────────────────────────────
/**
 * 5 个固定上下文：覆盖 abc 默认 + formal 单段 + formal 多段（首/中/末）
 *
 * 每个 snapshot 存：
 *  - hash:  装配输出 SHA-256（变化即触发 snapshot 失败）
 *  - chars: 字符长度（人眼快速判断变化幅度）
 *  - fragmentCount: fragment 数量
 */
function captureSnapshots() {
  const snaps = {};

  // abc default
  {
    const fragments = abcBuilder.buildAbcSystemFragments();
    const out = assemble(fragments);
    snaps['abc.system.default'] = {
      hash: sha256(out), chars: out.length, fragmentCount: fragments.length,
    };
  }

  const formalCases = [
    {
      name: 'formal.system.single',
      ctx: { segmentCount: 1, segIndex: 0, segLabel: '', localSegModuleCount: 4, isFirst: true, isLast: true },
    },
    {
      name: 'formal.system.multi.first',
      ctx: { segmentCount: 4, segIndex: 0, segLabel: '（第1课时）', localSegModuleCount: 3, isFirst: true, isLast: false },
    },
    {
      name: 'formal.system.multi.middle',
      ctx: { segmentCount: 4, segIndex: 1, segLabel: '（第2课时）', localSegModuleCount: 2, isFirst: false, isLast: false },
    },
    {
      name: 'formal.system.multi.last',
      ctx: { segmentCount: 4, segIndex: 3, segLabel: '（第4课时）', localSegModuleCount: 2, isFirst: false, isLast: true },
    },
  ];
  for (const t of formalCases) {
    const fragments = formalBuilder.buildFormalSystemFragments(t.ctx);
    const out = assemble(fragments);
    snaps[t.name] = {
      hash: sha256(out), chars: out.length, fragmentCount: fragments.length,
    };
  }

  return snaps;
}

function runSnapshotTests() {
  const current = captureSnapshots();
  const stored = loadSnapshots();
  const result = { passed: 0, total: 0, failures: [], updated: false };

  for (const key of Object.keys(current)) {
    result.total++;
    if (!stored || !stored[key]) {
      // 首次运行：自动写入基线，记为通过
      result.passed++;
      continue;
    }
    if (stored[key].hash === current[key].hash) {
      result.passed++;
    } else if (UPDATE_MODE) {
      // --update 模式：允许变更，更新基线
      result.passed++;
    } else {
      result.failures.push({
        snapshot: key,
        storedHash: stored[key].hash.slice(0, 16) + '...',
        currentHash: current[key].hash.slice(0, 16) + '...',
        storedChars: stored[key].chars,
        currentChars: current[key].chars,
        message: '装配输出 hash 不一致——若是有意修改 builder，跑 `node scripts/verify-prompt-assembly.js --update` 更新基线',
      });
    }
  }

  if (UPDATE_MODE || !stored) {
    saveSnapshots(current);
    result.updated = true;
  }

  return result;
}

// ─── 3) byteEquivalence ─────────────────────────────────
/**
 * 验证 legacy 路径（USE_ASSEMBLER=false 时的回滚目标）输出与原硬编码 systemPrompt 字节级一致。
 * 这是商业化产品的"回滚保证"——任何时候出问题都能立即切回旧路径。
 */
function runByteEquivalenceTests() {
  const result = { passed: 0, total: 0, failures: [] };

  // ── abc.legacy ──
  {
    result.total++;
    const expected = [
      '你是中职课程讲稿编写专家，擅长把教学框架转化为老师可直接授课的课堂口播讲稿。',
      '输出规范：JSON 格式 {“a”:””,”b”:””,”c”:””}。',
      '核心要求：每个模块的”教师讲述”必须是老师真正会说出口的话——包含具体案例、数据、提问、互动，像站在讲台上对着学生说话。',
      '绝对禁止：不要写教学设计备注（如”学完这一段学生应该能够...”、”这一段要把XX讲成判断链...”），这些是备课笔记不是讲课稿。',
    ].join('\n');
    const actual = abcBuilder.buildAbcSystemPromptLegacy();
    if (actual === expected) {
      result.passed++;
    } else {
      result.failures.push({
        test: 'abc.legacy',
        message: 'abc legacy 输出与原硬编码字节不一致',
        expectedLength: expected.length,
        actualLength: actual.length,
      });
    }
  }

  // ── formal.legacy.single ──
  {
    result.total++;
    const expected = [
      '你是中职课程正式讲稿写作专家。',
      '核心任务：基于已选候选讲稿，深度生成一版可直接上课使用的正式讲稿。',
      '输出规范：JSON 对象 {"script":"Markdown格式的正式讲稿"}。',
      '质量标准：教师讲述2200-3000字,推进词覆盖,提问≥10个。'.replace(',', '，').replace(',', '，'),
      '必须包含开场导入章节。',
      '必须包含课堂练习与检查和总结收束章节。到总结收束的课堂动作后立即结束。',
      '【最重要的规则】每个模块的"教师讲述"必须是老师真正会说出口的课堂口播正文。',
      '绝对禁止以下"教学设计备注"出现在讲稿中：',
      '  × "学完这一段，学生应该能够针对..."',
      '  × "这里有一个常见误区..."',
      '  × "这一段要把XX讲成一条连续判断链..."',
      '  × "这一部分围绕XX展开，先把当前环节要解决的课堂问题交代清楚"',
      '  × "重点要把XX之间的关系讲清楚"',
      '这些是备课笔记，不是讲课稿。讲稿中只写老师对学生说的话。',
      '正确的写法：用案例引入→提问互动→讲解知识→回收总结。像真人老师一样讲课。',
    ].join('\n');
    const actual = formalBuilder.buildFormalSystemPromptLegacy({
      segmentCount: 1, segIndex: 0, segLabel: '',
      localSegModuleCount: 4, isFirst: true, isLast: true,
    });
    if (actual === expected) {
      result.passed++;
    } else {
      // 找首个差异位置便于定位
      let diffAt = -1;
      for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
        if (actual[i] !== expected[i]) { diffAt = i; break; }
      }
      result.failures.push({
        test: 'formal.legacy.single',
        message: `formal legacy 单段输出与原硬编码字节不一致（首个差异位置 ${diffAt}）`,
        expectedSnippet: expected.slice(Math.max(0, diffAt - 5), diffAt + 20),
        actualSnippet: actual.slice(Math.max(0, diffAt - 5), diffAt + 20),
      });
    }
  }

  // ── formal.legacy.multi.middle（多段中段）──
  {
    result.total++;
    const actual = formalBuilder.buildFormalSystemPromptLegacy({
      segmentCount: 4, segIndex: 1, segLabel: '（第2课时）',
      localSegModuleCount: 2, isFirst: false, isLast: false,
    });
    // 关键内容验证（不全文比对——多段动态拼接太长，关键字段命中即可）
    const checks = [
      { name: '段号', ok: actual.includes('当前任务：生成4课时课程的第2课时正式讲稿（第2课时）。') },
      { name: '动态字数', ok: actual.includes('每个模块"教师讲述"不少于900字') },
      { name: '动态提问数', ok: actual.includes('提问≥3个') },
      { name: '不需要开场', ok: actual.includes('不需要开场导入，直接从模块内容开始。') },
      { name: '不需要总结', ok: actual.includes('不需要总结收束，在最后一个模块结束后停止。') },
      { name: '禁忌段', ok: actual.includes('绝对禁止以下"教学设计备注"出现在讲稿中：') },
    ];
    const failed = checks.filter((c) => !c.ok);
    if (failed.length === 0) {
      result.passed++;
    } else {
      result.failures.push({
        test: 'formal.legacy.multi.middle',
        message: `多段中段缺少关键内容: ${failed.map((c) => c.name).join('、')}`,
      });
    }
  }

  return result;
}

// ─── 4) integration ─────────────────────────────────────
/**
 * 加载 abc-generator.js 与 formal-generator.js，确认改造未引入加载期错误。
 * 不调用 AI（无 API Key 也能跑）。
 */
function runIntegrationTests() {
  const result = { passed: 0, total: 0, failures: [] };

  const targets = [
    {
      name: 'abc-generator load',
      fn: () => {
        const m = require('../src/main/script/abc-generator');
        if (typeof m.generateLectureABCDrafts !== 'function') {
          throw new Error('abc-generator 未导出 generateLectureABCDrafts');
        }
      },
    },
    {
      name: 'formal-generator load',
      fn: () => {
        const m = require('../src/main/script/formal-generator');
        if (typeof m.generateFormalLectureScript !== 'function') {
          throw new Error('formal-generator 未导出 generateFormalLectureScript');
        }
      },
    },
    {
      name: 'abc systemPrompt 装配可调用',
      fn: () => {
        const out = assemble(abcBuilder.buildAbcSystemFragments());
        if (typeof out !== 'string' || out.length === 0) throw new Error('装配输出为空');
        if (!out.includes('platform_safety')) throw new Error('装配输出缺 platform_safety');
        if (!out.includes('output_style')) throw new Error('装配输出缺 output_style');
      },
    },
    {
      name: 'formal systemPrompt 装配可调用（单段）',
      fn: () => {
        const out = assemble(formalBuilder.buildFormalSystemFragments({}));
        if (typeof out !== 'string' || out.length === 0) throw new Error('装配输出为空');
        if (!out.includes('platform_safety')) throw new Error('装配输出缺 platform_safety');
      },
    },
    {
      name: 'formal systemPrompt 装配可调用（多段）',
      fn: () => {
        const out = assemble(formalBuilder.buildFormalSystemFragments({
          segmentCount: 2, segIndex: 0, segLabel: '（第1课时）',
          localSegModuleCount: 3, isFirst: true, isLast: false,
        }));
        if (!out.includes('当前任务：生成2课时课程的第1课时正式讲稿（第1课时）。')) {
          throw new Error('多段任务描述缺失');
        }
      },
    },
  ];

  for (const t of targets) {
    result.total++;
    try {
      t.fn();
      result.passed++;
    } catch (e) {
      result.failures.push({ test: t.name, message: e.message });
    }
  }

  return result;
}

// ─── 5) coverage ────────────────────────────────────────
function runCoverageStats() {
  const stats = {
    fragmentTypes: Object.keys(sourceRegistry.FRAGMENT_TYPE).length,
    builders: 2,
    abcFragmentCount: abcBuilder.buildAbcSystemFragments().length,
    formalFragmentCount: formalBuilder.buildFormalSystemFragments({}).length,
  };

  // 装配后字符量统计
  const abcOut = assemble(abcBuilder.buildAbcSystemFragments());
  const formalOut = assemble(formalBuilder.buildFormalSystemFragments({}));
  stats.abcAssembledChars = abcOut.length;
  stats.abcLegacyChars = abcBuilder.buildAbcSystemPromptLegacy().length;
  stats.formalAssembledChars = formalOut.length;
  stats.formalLegacyChars = formalBuilder.buildFormalSystemPromptLegacy({}).length;

  // type 分布（abc + formal 总和）
  const allFragments = [
    ...abcBuilder.buildAbcSystemFragments(),
    ...formalBuilder.buildFormalSystemFragments({}),
  ];
  const typeDistribution = {};
  for (const f of allFragments) {
    typeDistribution[f.meta.type] = (typeDistribution[f.meta.type] || 0) + 1;
  }
  stats.typeDistribution = typeDistribution;

  return stats;
}

// ─── 主流程 ────────────────────────────────────────────
function main() {
  const checkedAt = new Date().toISOString();

  const selfCheck = runSelfChecks();
  const snapshot = runSnapshotTests();
  const byteEquivalence = runByteEquivalenceTests();
  const integration = runIntegrationTests();
  const coverage = runCoverageStats();

  const ok =
    selfCheck.failures.length === 0 &&
    snapshot.failures.length === 0 &&
    byteEquivalence.failures.length === 0 &&
    integration.failures.length === 0;

  const report = {
    ok,
    checkedAt,
    updateMode: UPDATE_MODE,
    selfCheck: {
      passed: selfCheck.passed,
      total: selfCheck.total,
      byModule: selfCheck.byModule,
      failures: selfCheck.failures,
    },
    snapshot: {
      passed: snapshot.passed,
      total: snapshot.total,
      updated: snapshot.updated,
      failures: snapshot.failures,
    },
    byteEquivalence: {
      passed: byteEquivalence.passed,
      total: byteEquivalence.total,
      failures: byteEquivalence.failures,
    },
    integration: {
      passed: integration.passed,
      total: integration.total,
      failures: integration.failures,
    },
    coverage,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
