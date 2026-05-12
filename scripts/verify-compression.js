/**
 * verify-compression.js — Phase-6 M2.6 上下文压缩器总验证
 *
 * 验证 4 个层面：
 *   1) selfCheck    — context-compressor 模块内置 12 个用例
 *   2) ratio        — 典型讲稿场景下的压缩比基线（防止算法回退）
 *   3) snapshot     — 固定输入下的压缩输出哈希稳定性
 *   4) typology     — 不同讲稿形态（短/中/长）的压缩行为
 *
 * 用法：node scripts/verify-compression.js
 *      node scripts/verify-compression.js --update    更新 snapshot 基线
 *
 * 退出码：0=全部通过，1=任意检查失败
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const compressor = require('../src/main/agent/context-compressor');
const { compressLectureForPpt, formatCompressedAsPrompt, selfCheck } = compressor;

const SNAPSHOT_FILE = path.join(__dirname, '__snapshots__', 'compression.snap.json');
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

// ─── 测试用讲稿样本 ──────────────────────────────────────
const SHORT_SAMPLE = `## 模块1：基础
教师讲述：今天学习基础内容。
1. 点击创建按钮
2. 选择基本几何体`;

const MEDIUM_SAMPLE = `# 课程讲稿

## 开场导入（0-9分钟）
教师讲述：同学们好！今天学习三维建模。
我去年带的学生张伟做的项目就很有代表性。

## 模块1：项目认知（9-38分钟）
教师讲述：店铺空间布局非常关键。店铺空间布局影响顾客动线。店铺空间布局是设计的核心。
1. 点击创建面板
2. 选择长方体工具
3. 输入店铺尺寸12米×8米
案例：天河城的服装店设计就是这样做的。

## 模块2：建模技巧（38-67分钟）
教师讲述：使用 Editable Poly 工具进行建模。
1. 选中墙面右键转换为可编辑多边形
2. 进入边级别连接工具
案例：上次的项目就是用这种方法。`;

// 通过重复构造一个 5000+ 字的长讲稿
const LONG_SAMPLE = (() => {
  const block = `## 模块X：综合应用
教师讲述：在实际工作中，我们使用 Photoshop 进行后期处理。Photoshop 图层功能很重要。Photoshop 后期处理是关键步骤。
1. 打开 Photoshop 软件
2. 点击文件菜单新建项目
3. 选择标准模板
案例：上次的项目就是这样完成的。
`;
  return block.repeat(50);
})();

// ─── 1) selfCheck ───────────────────────────────────────
function runSelfCheck() {
  return selfCheck();
}

// ─── 2) ratio: 压缩比基线 ───────────────────────────────
function runRatioBaselines() {
  const result = { passed: 0, total: 0, failures: [] };
  const expectations = [
    {
      name: 'medium 讲稿压缩比 ≤ 0.75',
      sample: MEDIUM_SAMPLE,
      maxRatio: 0.75,
    },
    {
      name: 'long 讲稿压缩比 ≤ 0.5（更长 → 更容易压缩）',
      sample: LONG_SAMPLE,
      maxRatio: 0.5,
    },
  ];
  for (const exp of expectations) {
    result.total++;
    const r = compressLectureForPpt(exp.sample);
    if (r.compressionRatio <= exp.maxRatio) {
      result.passed++;
    } else {
      result.failures.push({
        name: exp.name,
        actualRatio: r.compressionRatio,
        maxRatio: exp.maxRatio,
        rawLength: r.rawLength,
        compressedLength: r.compressedLength,
      });
    }
  }
  return result;
}

// ─── 3) snapshot: 压缩输出稳定性 ────────────────────────
function captureSnapshots() {
  const samples = {
    short: SHORT_SAMPLE,
    medium: MEDIUM_SAMPLE,
    long: LONG_SAMPLE,
  };
  const snaps = {};
  for (const [name, sample] of Object.entries(samples)) {
    const r = compressLectureForPpt(sample);
    // 哈希结构化输出（仅取稳定字段，时间无关）
    const stable = JSON.stringify({
      moduleTitles: r.moduleTitles,
      keyTerms: r.keyTerms,
      operationStepsCount: r.operationSteps.length,
      examplesCount: r.examples.length,
      compressedLength: r.compressedLength,
    });
    snaps[name] = {
      hash: sha256(stable),
      moduleTitleCount: r.moduleTitles.length,
      keyTermCount: r.keyTerms.length,
      compressionRatio: r.compressionRatio,
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
      result.passed++;
      continue;
    }
    if (stored[key].hash === current[key].hash) {
      result.passed++;
    } else if (UPDATE_MODE) {
      result.passed++;
    } else {
      result.failures.push({
        snapshot: key,
        storedHash: stored[key].hash.slice(0, 16) + '…',
        currentHash: current[key].hash.slice(0, 16) + '…',
        storedRatio: stored[key].compressionRatio,
        currentRatio: current[key].compressionRatio,
        message: '压缩输出哈希不一致——若是有意调整算法，跑 --update 更新基线',
      });
    }
  }
  if (UPDATE_MODE || !stored) {
    saveSnapshots(current);
    result.updated = true;
  }
  return result;
}

// ─── 4) typology: 不同形态讲稿的压缩行为 ─────────────────
function runTypologyTests() {
  const result = { passed: 0, total: 0, failures: [] };
  const cases = [];

  // 短讲稿：moduleTitles ≥ 1
  cases.push({
    name: '短讲稿至少提取 1 个模块标题',
    fn: () => {
      const r = compressLectureForPpt(SHORT_SAMPLE);
      if (r.moduleTitles.length < 1) throw new Error(`期望 ≥1，实际 ${r.moduleTitles.length}`);
    },
  });

  // 中讲稿：keyTerms ≥ 1（某个术语出现 ≥2 次）
  cases.push({
    name: '中讲稿提取至少 1 个高频术语',
    fn: () => {
      const r = compressLectureForPpt(MEDIUM_SAMPLE);
      if (r.keyTerms.length < 1) throw new Error(`期望 ≥1，实际 ${r.keyTerms.length}`);
    },
  });

  // 中讲稿：operationSteps ≥ 3
  cases.push({
    name: '中讲稿提取 ≥ 3 个操作步骤',
    fn: () => {
      const r = compressLectureForPpt(MEDIUM_SAMPLE);
      if (r.operationSteps.length < 3) {
        throw new Error(`期望 ≥3，实际 ${r.operationSteps.length}`);
      }
    },
  });

  // 中讲稿：examples ≥ 2（"案例：" 标记开头的句子）
  cases.push({
    name: '中讲稿提取 ≥ 2 个案例',
    fn: () => {
      const r = compressLectureForPpt(MEDIUM_SAMPLE);
      if (r.examples.length < 2) throw new Error(`期望 ≥2，实际 ${r.examples.length}`);
    },
  });

  // formatCompressedAsPrompt 输出非空且 < 原讲稿
  cases.push({
    name: 'formatCompressedAsPrompt 输出短于原文',
    fn: () => {
      const compressed = compressLectureForPpt(MEDIUM_SAMPLE);
      const prompt = formatCompressedAsPrompt(compressed);
      if (!prompt || prompt.length === 0) throw new Error('formatted 不应为空');
      if (prompt.length >= MEDIUM_SAMPLE.length) {
        throw new Error(`formatted (${prompt.length}) 应短于原文 (${MEDIUM_SAMPLE.length})`);
      }
    },
  });

  // 长讲稿：moduleTitles 不会爆炸（应有上限保护）
  cases.push({
    name: '长讲稿 moduleTitles 不超过上限',
    fn: () => {
      const r = compressLectureForPpt(LONG_SAMPLE);
      if (r.moduleTitles.length > 12) {
        throw new Error(`moduleTitles 上限保护失效，实际 ${r.moduleTitles.length}`);
      }
    },
  });

  for (const c of cases) {
    result.total++;
    try {
      c.fn();
      result.passed++;
    } catch (e) {
      result.failures.push({ name: c.name, message: e.message });
    }
  }
  return result;
}

// ─── 主流程 ────────────────────────────────────────────
function main() {
  const checkedAt = new Date().toISOString();
  const selfCheckRes = runSelfCheck();
  const ratio = runRatioBaselines();
  const snapshot = runSnapshotTests();
  const typology = runTypologyTests();

  const ok =
    selfCheckRes.failures.length === 0 &&
    ratio.failures.length === 0 &&
    snapshot.failures.length === 0 &&
    typology.failures.length === 0;

  const report = {
    ok,
    checkedAt,
    updateMode: UPDATE_MODE,
    selfCheck: {
      passed: selfCheckRes.passed,
      total: selfCheckRes.total,
      failures: selfCheckRes.failures,
    },
    ratio: {
      passed: ratio.passed,
      total: ratio.total,
      failures: ratio.failures,
    },
    snapshot: {
      passed: snapshot.passed,
      total: snapshot.total,
      updated: snapshot.updated,
      failures: snapshot.failures,
    },
    typology: {
      passed: typology.passed,
      total: typology.total,
      failures: typology.failures,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
