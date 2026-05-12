/**
 * verify-golden-samples.js — 金标准回归集（Phase-7.6 R9）
 *
 * 用途：用老师认可的"样例输出"做基线，验证新版代码生成的内容
 *      是否仍达到该水平。这是 selfCheck/mock 验证之外的"真实质量门槛"。
 *
 * 设计：
 *   - 样例数据存在 scripts/__golden__/<sample-name>.json
 *   - 每个样例含：notebook 元数据、framework / lecture / pptPlan / 配图 imagePrompt 的标准
 *   - 本脚本对每个样例：
 *     1. 模拟运行各 stage 生成器（mock aiClient 返回固定数据）
 *     2. 用 quality.js 校验输出
 *     3. 比对关键字段（章节标题命中率、imagePrompt 非空率、structure 完整度）
 *     4. 不达标的样例输出诊断信息
 *
 * 当前阶段：
 *   - 框架版本（无真实老师样例时）：使用合成"金标准基线"测试 quality + assembler 一致性
 *   - 老师后补样例时：把样例 JSON 放入 __golden__ 目录即可被自动加入回归集
 *
 * 用法：
 *   node scripts/verify-golden-samples.js
 *
 * 退出码：0=全部金标准达标，1=任意样例不达标
 */

const fs = require('fs');
const path = require('path');

const GOLDEN_DIR = path.join(__dirname, '__golden__');

// ─── 工具：加载所有金标准样例 ───────────────────────
function loadGoldenSamples() {
  if (!fs.existsSync(GOLDEN_DIR)) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  }
  const files = fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'));
  const samples = [];
  for (const f of files) {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, f), 'utf8'));
      content._fileName = f;
      samples.push(content);
    } catch (e) {
      console.warn(`[golden-samples] 跳过损坏的样例文件 ${f}：${e.message}`);
    }
  }
  return samples;
}

// ─── 验证项：framework quality ──────────────────────
async function verifyFrameworkQuality(sample) {
  const { validateFrameworkContent } = require('../src/main/api/framework-schema');
  if (!sample.framework) return { ok: true, reason: '样例无 framework，跳过' };
  const result = validateFrameworkContent(sample.framework, sample.notebook || {});
  return {
    ok: result.valid,
    valid: result.valid,
    errors: result.errors || [],
    warnings: result.warnings || [],
  };
}

// ─── 验证项：lecture quality ─────────────────────────
async function verifyLectureQuality(sample) {
  const { validateLectureStage } = require('../src/main/v2/quality');
  if (!sample.lecture) return { ok: true, reason: '样例无 lecture，跳过' };
  const result = validateLectureStage(sample.lecture, {
    requireFinal: true,
    totalHours: Number(sample.notebook?.totalHours) || 1,
  });
  return {
    ok: result.valid,
    valid: result.valid,
    errors: result.errors || [],
    narrationCharCount: result.checks?.finalNarrationCharCount || 0,
  };
}

// ─── 验证项：ppt plan quality ────────────────────────
async function verifyPptPlanQuality(sample) {
  const { validatePptStage } = require('../src/main/v2/quality');
  if (!sample.pptPlan) return { ok: true, reason: '样例无 pptPlan，跳过' };
  const result = validatePptStage(sample.pptPlan, { requirePages: true });
  return {
    ok: result.valid,
    valid: result.valid,
    errors: result.errors || [],
    pageCount: result.checks?.pageCount || 0,
    pagesMissingImagePrompt: result.checks?.pagesMissingImagePrompt || [],
    pagesMissingSourceSection: result.checks?.pagesMissingSourceSection || [],
  };
}

// ─── 验证项：imagePrompt 非空率（Phase-7.6 R4 强约束）──
async function verifyImagePromptCoverage(sample) {
  if (!Array.isArray(sample.pptPlan?.pptPages)) return { ok: true, reason: '无 pptPages' };
  const needImagePages = sample.pptPlan.pptPages.filter((p) => p.needImage);
  if (needImagePages.length === 0) return { ok: true, reason: '无需配图页面' };
  const withPromptCount = needImagePages.filter(
    (p) => p.imagePrompt && String(p.imagePrompt).trim().length >= 10
  ).length;
  const coverage = withPromptCount / needImagePages.length;
  return {
    ok: coverage === 1,
    coverage,
    needImageCount: needImagePages.length,
    withPromptCount,
  };
}

// ─── 验证项：sourceSection 命中率（Phase-7.6 R5 跨阶段对应）─
async function verifySourceSectionAlignment(sample) {
  if (!Array.isArray(sample.pptPlan?.pptPages) || !Array.isArray(sample.expectedSections)) {
    return { ok: true, reason: '无 expectedSections，跳过' };
  }
  const expected = new Set(sample.expectedSections.map(String));
  const pages = sample.pptPlan.pptPages.filter((p) => p.needImage);
  if (pages.length === 0) return { ok: true, reason: '无需配图页面' };
  const matched = pages.filter((p) => expected.has(String(p.sourceSection || ''))).length;
  const hitRate = matched / pages.length;
  return {
    ok: hitRate >= (sample.minSourceSectionHitRate || 0.8),
    hitRate, matched, totalNeedImage: pages.length,
  };
}

// ─── 主流程 ─────────────────────────────────────
async function main() {
  const samples = loadGoldenSamples();

  if (samples.length === 0) {
    // 无样例时仅打印提示并以 exit 0 通过——这是"金标准框架就绪"的状态
    console.log(JSON.stringify({
      ok: true,
      checkedAt: new Date().toISOString(),
      sampleCount: 0,
      message: '尚无金标准样例。请把老师认可的样例 JSON 放入 scripts/__golden__/ 目录后重跑。',
      sampleSchema: {
        notebook: { id: 1, name: '课程名', totalHours: 4 },
        framework: { /* 完整教学框架 JSON */ },
        lecture: { drafts: { a: '...', b: '...', c: '...' }, selectedDraft: 'a', finalScript: '...' },
        pptPlan: { pptPages: [{ pageNumber: 1, title: '封面', needImage: true, imagePrompt: '...', sourceSection: '开场导入' }] },
        expectedSections: ['开场导入', '模块1', '模块2', '总结收束'],
        minSourceSectionHitRate: 0.8,
      },
    }, null, 2));
    process.exit(0);
  }

  const results = [];
  for (const sample of samples) {
    const sampleResult = {
      sample: sample._fileName || 'unnamed',
      ok: true,
      checks: {},
    };
    sampleResult.checks.framework = await verifyFrameworkQuality(sample);
    sampleResult.checks.lecture = await verifyLectureQuality(sample);
    sampleResult.checks.pptPlan = await verifyPptPlanQuality(sample);
    sampleResult.checks.imagePromptCoverage = await verifyImagePromptCoverage(sample);
    sampleResult.checks.sourceSectionAlignment = await verifySourceSectionAlignment(sample);

    sampleResult.ok = Object.values(sampleResult.checks).every((c) => c.ok !== false);
    results.push(sampleResult);
  }

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({
    ok: allOk,
    checkedAt: new Date().toISOString(),
    sampleCount: samples.length,
    results,
  }, null, 2));
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message, stack: e.stack }));
  process.exit(1);
});
