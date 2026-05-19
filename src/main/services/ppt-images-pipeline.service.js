/**
 * ppt-images-pipeline.service.js — PPT 配图深度生成流水线（Phase-7.5 M7.5.5）
 *
 * 职责：把 Agent 的"PPT 配图批量生成"从粗糙的"快速调 API + 限流防 429"，
 *      升级为"封面深度 + 风格锁定 + 内容页 Vision 双审核 + 一致性复核"流水线。
 *
 * 三阶段流程：
 *   Phase 1: 封面深度生成 + styleAnchor 提取
 *     - 找到 pageType='cover' 或 index=0 的页
 *     - 调用 v2Runtime.generatePptPageCandidates 生成 3 候选
 *     - 对每个候选做 Vision 审核（criteria='relevance_only'，与课程主题对应）
 *     - 选评分最高的候选作为正式封面
 *     - 用 Vision 描述该封面的风格特征字符串作为 styleAnchor（颜色 / 布局 / 字体感觉）
 *     - 全部 3 候选都不达标 → 重试 1 次（用更严格 prompt）→ 仍失败则 emit 'pause-needed'
 *
 *   Phase 2: 内容页串行 + 携带 styleAnchor + Vision 双审核
 *     - 按页面 index 顺序串行处理
 *     - imagePrompt = 原 imagePrompt + "\n\n[风格保持]：" + styleAnchor
 *     - 生成后做 Vision 双重审核：内容相关性 + 风格一致性
 *     - 任一不达标 → 用 formatIssuesAsRefinementHint 拼接提示词重试 1 次
 *     - 仍不达标 → 标记 page.status='manual_review'（不阻断，继续下一页）
 *
 *   Phase 3: 一致性复核 + 质量报告
 *     - 抽样 30%（最多 4 张）做风格一致性 spot check（vs 封面 styleAnchor）
 *     - 不一致比例 > 25% → emit 'pause-needed'
 *     - 输出汇总：{ totalGenerated, needsReviewCount, failedCount, consistencyScore }
 *
 * Mock 模式（默认）：
 *   - deps.qualityVisionService 缺失 / 其 mock 模式启用 时
 *   - 跳过 Vision 审核，仅靠生成成功标记
 *   - 单元测试不依赖真实 API
 *
 * 单文件不超过 600 行
 */

// ─── 常量 ────────────────────────────────────────
const PHASE = Object.freeze({
  COVER: 'cover',
  CONTENT: 'content',
  CONSISTENCY: 'consistency_check',
});

const PAGE_STATUS = Object.freeze({
  SUCCESS: 'success',
  MANUAL_REVIEW: 'manual_review',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

const STYLE_ANCHOR_FALLBACK = '专业、简洁、教学风格、配色协调、字体清晰';

// 限流（默认配置，被 deps.rateLimitMs 覆盖）
const DEFAULT_RATE_LIMIT_MS = 500;          // 每张图后限流（doubao-seedream 付费配额下足够）
const RETRY_BACKOFF_MS = 2000;              // 失败重试延迟

// ─── 工具 ────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function pickCoverPage(pages) {
  // 优先找 pageType='cover' 或 number=1 的页
  return pages.find(p => p.pageType === 'cover')
      || pages.find(p => Number(p.number) === 1)
      || pages[0]
      || null;
}

function pickContentPages(pages, coverPage) {
  return pages.filter(p =>
    p && p.id && p.id !== coverPage?.id
    && p.imagePrompt && String(p.imagePrompt).trim()
  );
}

/**
 * 从 vision 评估结果提取风格描述字符串作为 styleAnchor。
 * 优先用 raw.styleDescription，其次用 issues 反向构造，最后回退默认。
 */
function extractStyleAnchor(visionAssessment) {
  if (!visionAssessment) return STYLE_ANCHOR_FALLBACK;
  if (typeof visionAssessment.raw?.styleDescription === 'string'
      && visionAssessment.raw.styleDescription.length > 5) {
    return visionAssessment.raw.styleDescription.slice(0, 200);
  }
  return STYLE_ANCHOR_FALLBACK;
}

/**
 * 把课程上下文构造为 pageContext，供 Vision 审核做内容相关性比对。
 */
function buildPageContext(page, courseName) {
  const parts = [`课程：${courseName}`];
  if (page.title) parts.push(`页面标题：${page.title}`);
  if (page.subtitle) parts.push(`副标题：${page.subtitle}`);
  if (page.imagePrompt) parts.push(`配图说明：${String(page.imagePrompt).slice(0, 200)}`);
  return parts.join('\n');
}

/**
 * 把 Vision 审核失败的 issues 转为给下次生成的微调提示词追加。
 * 用 quality-vision.service 提供的 formatIssuesAsRefinementHint，但加 PPT 配图特化的引导。
 */
function buildRefinementHint(visionAssessment, qualityVisionService) {
  if (!visionAssessment || !qualityVisionService?.formatIssuesAsRefinementHint) {
    return '';
  }
  const baseHint = qualityVisionService.formatIssuesAsRefinementHint(visionAssessment);
  if (!baseHint) return '';
  return `\n\n[微调建议]：\n${baseHint}\n请针对上述问题重新生成。`;
}

// ─── 阶段函数 ────────────────────────────────────
/**
 * Phase 1: 封面深度生成 + styleAnchor 提取
 * 返回：{ coverPage, coverImagePath, styleAnchor, attempts, success } 或 { success: false, reason }
 */
async function runCoverPhase(coverPage, courseName, deps, emit) {
  const { v2Runtime, qualityVisionService, notebookId, rateLimitMs = DEFAULT_RATE_LIMIT_MS } = deps;
  const pageContext = buildPageContext(coverPage, courseName);

  emit('phase', { phase: PHASE.COVER, attempt: 1, message: '生成封面（深度模式）...' });

  // Phase-7.7 E1+E2（2026-04-30）：
  // - 重试次数 2 → 3（多给 1 次机会）
  // - Vision 阈值 7 → 6（doubao seedream 4.5 实际评分常在 5-7 之间，阈值 7 导致绝大多数封面被拒）
  const COVER_MAX_ATTEMPTS = 3;
  const COVER_VISION_THRESHOLD = 6;
  console.log(`[ppt-pipeline] 封面阶段：最多 ${COVER_MAX_ATTEMPTS} 次重试，Vision 阈值 ${COVER_VISION_THRESHOLD}`);

  let attempts = 0;
  let bestCandidate = null;
  let bestAssessment = null;

  for (let attempt = 1; attempt <= COVER_MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    let candidatesResult;
    try {
      candidatesResult = await v2Runtime.generatePptPageCandidates({
        notebookId, page: coverPage, courseName,
      });
    } catch (e) {
      emit('phase_error', { phase: PHASE.COVER, attempt, error: e.message });
      await sleep(RETRY_BACKOFF_MS);
      continue;
    }
    await sleep(rateLimitMs);

    const candidates = candidatesResult?.value?.data?.candidates
      || candidatesResult?.data?.candidates
      || candidatesResult?.candidates
      || [];
    if (candidates.length === 0) {
      emit('phase_error', { phase: PHASE.COVER, attempt, error: '无候选生成' });
      continue;
    }

    // Vision 审核每个候选，挑评分最高
    for (const cand of candidates) {
      const imagePath = cand.imagePath || cand.path;
      if (!imagePath) continue;
      try {
        const assessment = qualityVisionService
          ? await qualityVisionService.assessImageQuality({
              imagePath, pageContext, criteria: 'relevance_only',
            }, deps)
          : { ok: true, relevanceScore: 8, raw: { _mock: true } };
        const score = (assessment.ok && typeof assessment.relevanceScore === 'number')
          ? assessment.relevanceScore : 0;
        if (!bestAssessment || score > (bestAssessment.relevanceScore || 0)) {
          bestCandidate = { imagePath, ...cand };
          bestAssessment = assessment;
        }
      } catch (e) {
        emit('vision_error', { phase: PHASE.COVER, error: e.message });
      }
    }

    // 评分通过阈值则结束重试
    if (bestAssessment && (bestAssessment.relevanceScore || 0) >= COVER_VISION_THRESHOLD) break;
    await sleep(RETRY_BACKOFF_MS);
  }

  // Phase-7.7 E3（2026-04-30）：封面 < 阈值时不再返回 success=false 阻塞整个 pipeline
  // 之前封面失败 → return paused → 后续 14 页全没尝试生成 → 用户截图全"待配图"
  // 现在：封面有候选就算"勉强可用"（标 needsManualReview=true），继续生成内容页，让老师至少拿到大部分页面
  if (!bestCandidate) {
    // 极端情况：连候选都没有（API 失败 N 次）→ 真的没法继续
    return {
      success: false,
      reason: `封面 ${attempts} 次重试均无候选生成（可能是图片 API 失败）`,
      attempts, bestScore: 0,
    };
  }

  // 封面 Vision 评分低于阈值但有候选 → 标记 needsManualReview，仍返回 success 让 pipeline 继续
  const coverScore = bestAssessment?.relevanceScore || 0;
  const coverNeedsReview = coverScore < COVER_VISION_THRESHOLD;
  if (coverNeedsReview) {
    console.warn(`[ppt-pipeline] 封面 Vision ${coverScore}/10 低于阈值 ${COVER_VISION_THRESHOLD}，标记 needsManualReview=true 但继续生成内容页`);
    emit('cover_needs_review', { score: coverScore, attempts });
  } else {
    console.log(`[ppt-pipeline] 封面 Vision ${coverScore}/10 通过阈值 ${COVER_VISION_THRESHOLD}`);
  }

  const styleAnchor = extractStyleAnchor(bestAssessment);
  emit('phase_done', {
    phase: PHASE.COVER, attempts,
    coverImagePath: bestCandidate.imagePath,
    styleAnchor: styleAnchor.slice(0, 80) + '...',
  });

  return {
    success: true, attempts,
    coverPage, coverImagePath: bestCandidate.imagePath, styleAnchor,
    coverAssessment: bestAssessment,
    coverNeedsReview,    // E3：把"需复核"标志透出给主流程，最终结果里包含
  };
}

/**
 * Phase 2: 内容页串行 + Vision 双审核 + 重试
 * 返回：{ pageResults: [{ pageId, status, imagePath, attempts, assessment }] }
 */
async function runContentPhase(contentPages, styleAnchor, courseName, deps, emit) {
  const { v2Runtime, qualityVisionService, notebookId, rateLimitMs = DEFAULT_RATE_LIMIT_MS } = deps;
  const pageResults = [];

  for (let idx = 0; idx < contentPages.length; idx++) {
    const page = contentPages[idx];
    emit('phase', { phase: PHASE.CONTENT, pageIndex: idx, totalPages: contentPages.length, pageId: page.id });

    // 携带 styleAnchor 的 imagePrompt
    const enhancedPrompt = `${page.imagePrompt}\n\n[风格保持]：${styleAnchor}`;

    let pageResult = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const promptForThisAttempt = attempt === 1
        ? enhancedPrompt
        : `${enhancedPrompt}${pageResult?.refinementHint || ''}`;

      let candidatesResult;
      try {
        candidatesResult = await v2Runtime.generatePptPageCandidates({
          notebookId,
          page: { ...page, imagePrompt: promptForThisAttempt },
          courseName,
        });
      } catch (e) {
        emit('phase_error', { phase: PHASE.CONTENT, pageId: page.id, attempt, error: e.message });
        if (attempt < 2) await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      await sleep(rateLimitMs);

      const candidates = candidatesResult?.value?.data?.candidates
        || candidatesResult?.data?.candidates
        || candidatesResult?.candidates || [];
      if (candidates.length === 0) {
        if (attempt < 2) await sleep(RETRY_BACKOFF_MS);
        continue;
      }

      // Vision 双审核第一个候选
      const cand = candidates[0];
      const imagePath = cand.imagePath || cand.path;
      if (!imagePath) continue;

      const pageContext = buildPageContext(page, courseName);
      let assessment;
      try {
        assessment = qualityVisionService
          ? await qualityVisionService.assessImageQuality({
              imagePath, pageContext, styleAnchor, criteria: 'both',
            }, deps)
          : { ok: true, relevanceScore: 8, styleScore: 8, raw: { _mock: true } };
      } catch (e) {
        assessment = { ok: false, error: e.message };
      }

      // Phase-7.7 E2 续：内容页阈值同步降到 6（双审核：相关性 + 风格一致性）
      const CONTENT_VISION_THRESHOLD = 6;
      const isPass = qualityVisionService
        ? (qualityVisionService.isQualityPass
            ? qualityVisionService.isQualityPass(assessment)
            : (assessment.relevanceScore || 0) >= CONTENT_VISION_THRESHOLD && (assessment.styleScore || 0) >= CONTENT_VISION_THRESHOLD)
        : true;  // mock 模式直接通过

      if (isPass) {
        pageResult = {
          pageId: page.id, status: PAGE_STATUS.SUCCESS,
          imagePath, attempts: attempt, assessment,
        };
        break;
      }

      // 不通过 → 准备重试的提示词
      pageResult = {
        pageId: page.id, status: PAGE_STATUS.MANUAL_REVIEW,
        imagePath, attempts: attempt, assessment,
        refinementHint: buildRefinementHint(assessment, qualityVisionService),
      };
      if (attempt < 2) await sleep(RETRY_BACKOFF_MS);
    }

    if (!pageResult) {
      pageResult = { pageId: page.id, status: PAGE_STATUS.FAILED, attempts: 2 };
    }
    pageResults.push(pageResult);
    emit('page_done', { pageId: page.id, status: pageResult.status, attempts: pageResult.attempts });
  }

  return { pageResults };
}

/**
 * Phase 3: 一致性复核（抽样 30% 最多 4 张）
 * 返回：{ consistencyScore: 0-10, sampleCount, lowConsistencyCount, needsPause }
 */
async function runConsistencyPhase(coverImagePath, styleAnchor, pageResults, deps, emit) {
  const { qualityVisionService } = deps;
  const successPages = pageResults.filter(r => r.status === PAGE_STATUS.SUCCESS && r.imagePath);

  // v4.3.3 测试报告未达标 #2 修复 · 2026-05-20：
  //   旧实现 silently 返回 consistencyScore=8 + skipped=true，让 caller 误以为"审核过了"。
  //   现在区分 3 类"未运行"原因 + 显式 consistencyEnabled 标志，便于 UI 与日志诊断。
  if (!qualityVisionService) {
    console.warn('[ppt-images-pipeline] ⚠ Phase 3 一致性审核未启用：deps.qualityVisionService 缺失（生产 IPC 未接入流水线 / 测试模式）');
    return {
      consistencyScore: null,             // null = 未评分（不再假装 8）
      sampleCount: 0,
      lowConsistencyCount: 0,
      needsPause: false,
      skipped: true,
      consistencyEnabled: false,
      skipReason: 'no-quality-vision-service',
    };
  }
  if (successPages.length < 3) {
    console.warn(`[ppt-images-pipeline] ⚠ Phase 3 一致性审核样本太少（${successPages.length} < 3），本次跳过`);
    return {
      consistencyScore: null,
      sampleCount: successPages.length,
      lowConsistencyCount: 0,
      needsPause: false,
      skipped: true,
      consistencyEnabled: true,           // 服务在位，仅因样本不足跳过——下次重跑可能能跑
      skipReason: 'samples-below-minimum',
    };
  }

  emit('phase', { phase: PHASE.CONSISTENCY, message: '一致性复核...' });

  // 抽样 30%（最多 4 张）
  const sampleSize = Math.min(4, Math.max(1, Math.ceil(successPages.length * 0.3)));
  const samples = [];
  const step = Math.floor(successPages.length / sampleSize);
  for (let i = 0; i < sampleSize; i++) {
    samples.push(successPages[i * step]);
  }

  let totalScore = 0;
  let lowCount = 0;
  for (const sample of samples) {
    try {
      const assessment = await qualityVisionService.assessImageQuality({
        imagePath: sample.imagePath,
        styleAnchor,
        criteria: 'style_only',
      }, deps);
      const score = assessment.styleScore || 0;
      totalScore += score;
      if (score < 6) lowCount++;  // E2 续：一致性复核阈值同步降到 6
    } catch (e) {
      lowCount++;  // 评估失败视为低分
    }
  }
  const avgScore = samples.length > 0 ? totalScore / samples.length : 0;
  const lowRatio = samples.length > 0 ? lowCount / samples.length : 0;

  return {
    consistencyScore: Math.round(avgScore * 10) / 10,
    sampleCount: samples.length,
    lowConsistencyCount: lowCount,
    needsPause: lowRatio > 0.25,
    consistencyEnabled: true,             // v4.3.3 修复 D：真实跑过审核才标 true
    skipped: false,
  };
}

// ─── 主流程 ────────────────────────────────────────
/**
 * 完整流水线入口。
 *
 * @param {Object} input
 * @param {Object} input.db - 数据库实例
 * @param {number} input.notebookId
 * @param {Object} input.pptArtifact - 含 content.pptPages 的 PPT artifact
 * @param {Object} input.notebook - 含 name 的笔记本对象
 *
 * @param {Object} deps
 * @param {Object} deps.v2Runtime - 必填，含 generatePptPageCandidates
 * @param {Object} [deps.qualityVisionService] - 可选，缺失时退化为仅成功标记
 * @param {Object} [deps.aiClient] - 透传给 vision service
 * @param {number} [deps.rateLimitMs=500]
 * @param {Function} [deps.emit] - 事件回调 (type, payload)
 *
 * @returns {Promise<Object>}
 */
async function runPptImagesPipeline(input, deps = {}) {
  const { db, notebookId, pptArtifact, notebook } = input || {};
  if (!db) throw new Error('runPptImagesPipeline: db 缺失');
  if (!notebookId) throw new Error('runPptImagesPipeline: notebookId 缺失');
  if (!pptArtifact?.content?.pptPages) throw new Error('runPptImagesPipeline: pptArtifact.content.pptPages 缺失');
  if (!deps.v2Runtime) throw new Error('runPptImagesPipeline: deps.v2Runtime 缺失');

  const courseName = notebook?.name || '课程';
  const allPages = pptArtifact.content.pptPages;
  const emit = typeof deps.emit === 'function' ? deps.emit : () => {};

  // 跳过：已有 imagePath 的页面 + 无 imagePrompt 的页面
  const pendingPages = allPages.filter(p =>
    p && !(p.imagePath || p.imageUrl)
    && p.imagePrompt && String(p.imagePrompt).trim()
  );

  if (pendingPages.length === 0) {
    return {
      success: true, allDone: true, message: '所有页面已配图，无需生成',
      totalPages: allPages.length, pendingCount: 0,
    };
  }

  // ── Phase 1: 封面 ──
  const coverPage = pickCoverPage(pendingPages);
  let coverResult;
  if (coverPage) {
    coverResult = await runCoverPhase(coverPage, courseName,
      { ...deps, notebookId }, emit);
    if (!coverResult.success) {
      return {
        success: false, paused: true, pauseReason: coverResult.reason,
        phase: PHASE.COVER, suggestions: [
          '在 UI 中手动调整封面 imagePrompt',
          '检查课程主题描述是否清晰',
          '尝试更换图片模型 endpoint',
        ],
      };
    }
  }
  const styleAnchor = coverResult?.styleAnchor || STYLE_ANCHOR_FALLBACK;
  const contentPages = coverPage ? pickContentPages(pendingPages, coverPage) : pendingPages;

  // ── Phase 2: 内容页 ──
  const phase2 = await runContentPhase(contentPages, styleAnchor, courseName,
    { ...deps, notebookId }, emit);

  // ── Phase 3: 一致性复核 ──
  const phase3 = await runConsistencyPhase(
    coverResult?.coverImagePath, styleAnchor, phase2.pageResults, deps, emit
  );

  const totalGenerated = phase2.pageResults.filter(r => r.status === PAGE_STATUS.SUCCESS).length;
  const needsReviewCount = phase2.pageResults.filter(r => r.status === PAGE_STATUS.MANUAL_REVIEW).length;
  const failedCount = phase2.pageResults.filter(r => r.status === PAGE_STATUS.FAILED).length;

  if (phase3.needsPause) {
    return {
      success: false, paused: true,
      pauseReason: `${phase3.lowConsistencyCount}/${phase3.sampleCount} 抽样图风格不一致（低于 7 分）`,
      phase: PHASE.CONSISTENCY,
      coverImagePath: coverResult?.coverImagePath,
      styleAnchor,
      pageResults: phase2.pageResults,
      consistencyScore: phase3.consistencyScore,
      suggestions: [
        '查看封面图风格描述是否清晰',
        '手动调整不一致页面的 imagePrompt',
        '考虑用同一图片模型重新生成所有页',
      ],
    };
  }

  return {
    success: true, paused: false,
    coverImagePath: coverResult?.coverImagePath,
    coverAttempts: coverResult?.attempts,
    coverNeedsReview: coverResult?.coverNeedsReview || false,  // E3：封面是否需要老师复核
    styleAnchor,
    pageResults: phase2.pageResults,
    totalGenerated, needsReviewCount, failedCount,
    consistencyScore: phase3.consistencyScore,
    consistencySampleCount: phase3.sampleCount,
    // v4.3.3 测试报告未达标 #2 修复 · 2026-05-20：
    //   暴露真实"是否做过审核"，UI 能准确显示，老师不再被 score=8 假数据误导
    consistencyEnabled: phase3.consistencyEnabled === true,
    consistencySkipped: phase3.skipped === true,
    consistencySkipReason: phase3.skipReason || null,
  };
}

// ─── 自检 ────────────────────────────────────────
function selfCheck() {
  const cases = [];

  // 用例 1：缺 db 抛错
  cases.push({
    name: 'runPptImagesPipeline 缺 db 抛错',
    fn: async () => {
      let threw = false;
      try { await runPptImagesPipeline({ notebookId: 1, pptArtifact: { content: { pptPages: [] } } }, { v2Runtime: {} }); }
      catch (e) { threw = true; }
      if (!threw) throw new Error('应抛错');
    },
  });

  // 用例 2：所有页面已有图片 → allDone
  cases.push({
    name: '所有页已配图返回 allDone',
    fn: async () => {
      const result = await runPptImagesPipeline({
        db: {}, notebookId: 1,
        pptArtifact: { content: { pptPages: [
          { id: 1, imagePath: '/x.png' },
          { id: 2, imageUrl: 'http://x' },
        ]}},
        notebook: { name: 'X' },
      }, { v2Runtime: { generatePptPageCandidates: async () => ({}) } });
      if (!result.allDone) throw new Error('应返回 allDone');
    },
  });

  // 用例 3：mock 模式（无 qualityVisionService）走通完整流程
  cases.push({
    name: 'mock 模式：无 qualityVisionService 时退化为成功标记',
    fn: async () => {
      let pptCallCount = 0;
      const result = await runPptImagesPipeline({
        db: {}, notebookId: 1,
        pptArtifact: { content: { pptPages: [
          { id: 1, pageType: 'cover', imagePrompt: '封面' },
          { id: 2, imagePrompt: '页 2' },
          { id: 3, imagePrompt: '页 3' },
        ]}},
        notebook: { name: '测试课程' },
      }, {
        v2Runtime: {
          generatePptPageCandidates: async () => {
            pptCallCount++;
            return { value: { data: { candidates: [{ imagePath: `/p${pptCallCount}.png` }] } } };
          },
        },
        rateLimitMs: 0,  // 测试加速
      });
      if (!result.success) throw new Error(`期望成功，实际：${result.pauseReason}`);
      if (result.totalGenerated !== 2) throw new Error(`期望 2 张内容页，实际 ${result.totalGenerated}`);
    },
  });

  // 用例 4：跳过无 imagePrompt 的页（如总结页）
  cases.push({
    name: '跳过无 imagePrompt 的页',
    fn: async () => {
      const result = await runPptImagesPipeline({
        db: {}, notebookId: 1,
        pptArtifact: { content: { pptPages: [
          { id: 1, pageType: 'cover', imagePrompt: '封面' },
          { id: 2, imagePrompt: '' },           // 应跳过
          { id: 3, imagePrompt: '页 3' },
        ]}},
        notebook: { name: 'X' },
      }, {
        v2Runtime: { generatePptPageCandidates: async () => ({ candidates: [{ imagePath: '/x.png' }] }) },
        rateLimitMs: 0,
      });
      if (!result.success) throw new Error('应成功');
      // 内容页只有 page 3
      if (result.pageResults.length !== 1) throw new Error(`内容页应为 1 个，实际 ${result.pageResults.length}`);
    },
  });

  // 用例 5（E3 改造，2026-04-30）：封面 Vision 评分低 → 标记 coverNeedsReview 但 pipeline 继续
  // 之前期望"封面失败必 paused 阻塞"——但这导致用户看到 14 页全"待配图"，体验极差。
  // 新行为：封面 Vision < 阈值时标记 coverNeedsReview=true，仍继续生成内容页，最终结果里包含此标记。
  // 老师在 UI 看到"封面待复核"标志，可手动重新生成或接受当前封面。
  cases.push({
    name: '封面 Vision 评分低 → coverNeedsReview 但继续生成（E3）',
    fn: async () => {
      const fakeVision = {
        assessImageQuality: async () => ({ ok: true, relevanceScore: 4, raw: {} }),  // 永远 4 分
        isQualityPass: () => false,
      };
      const result = await runPptImagesPipeline({
        db: {}, notebookId: 1,
        pptArtifact: { content: { pptPages: [
          { id: 1, pageType: 'cover', imagePrompt: '封面' },
          { id: 2, imagePrompt: '内容页 2' },  // E3：封面失败后内容页应仍尝试生成
        ]}},
        notebook: { name: 'X' },
      }, {
        v2Runtime: { generatePptPageCandidates: async () => ({ candidates: [{ imagePath: '/cover.png' }] }) },
        qualityVisionService: fakeVision,
        rateLimitMs: 0,
      });
      // E3 新期望：低评分封面不再 paused，而是 coverNeedsReview=true + pipeline 继续
      if (result.paused) throw new Error('E3 修复后封面低分不应暂停');
      if (!result.coverNeedsReview) throw new Error('应标记 coverNeedsReview=true');
      if (result.phase === PHASE.COVER) throw new Error('不应在 cover 阶段暂停');
    },
  });

  // 用例 6：内容页 vision 失败 → manual_review（不阻断）
  cases.push({
    name: '内容页 vision 失败标记 manual_review 不暂停',
    fn: async () => {
      let visionCallCount = 0;
      const fakeVision = {
        assessImageQuality: async () => {
          visionCallCount++;
          // 封面通过（criteria='relevance_only'，第 1 调）
          // 内容页第一页 relevance + style 都不通过
          if (visionCallCount === 1) return { ok: true, relevanceScore: 8, raw: {} };
          return { ok: true, relevanceScore: 5, styleScore: 5, raw: {} };
        },
        isQualityPass: (a) => (a.relevanceScore || 0) >= 7 && (a.styleScore || 0) >= 7,
        formatIssuesAsRefinementHint: () => '加强构图',
      };
      const result = await runPptImagesPipeline({
        db: {}, notebookId: 1,
        pptArtifact: { content: { pptPages: [
          { id: 1, pageType: 'cover', imagePrompt: '封面' },
          { id: 2, imagePrompt: '页 2' },
        ]}},
        notebook: { name: 'X' },
      }, {
        v2Runtime: { generatePptPageCandidates: async () => ({ candidates: [{ imagePath: '/x.png' }] }) },
        qualityVisionService: fakeVision,
        rateLimitMs: 0,
      });
      if (result.paused) throw new Error('内容页失败不应暂停');
      if (result.needsReviewCount !== 1) throw new Error(`期望 1 张待复核，实际 ${result.needsReviewCount}`);
    },
  });

  // 用例 7：emit 回调正确触发
  cases.push({
    name: 'emit 回调记录所有阶段事件',
    fn: async () => {
      const events = [];
      await runPptImagesPipeline({
        db: {}, notebookId: 1,
        pptArtifact: { content: { pptPages: [
          { id: 1, pageType: 'cover', imagePrompt: '封面' },
          { id: 2, imagePrompt: '页 2' },
        ]}},
        notebook: { name: 'X' },
      }, {
        v2Runtime: { generatePptPageCandidates: async () => ({ candidates: [{ imagePath: '/x.png' }] }) },
        emit: (type, payload) => events.push({ type, payload }),
        rateLimitMs: 0,
      });
      const phaseEvents = events.filter(e => e.type === 'phase');
      if (phaseEvents.length < 2) throw new Error(`期望至少 2 个 phase 事件，实际 ${phaseEvents.length}`);
    },
  });

  // 用例 8：styleAnchor 提取（fallback 路径）
  cases.push({
    name: 'styleAnchor 提取使用 fallback 当 vision 无 styleDescription',
    fn: async () => {
      const fakeVision = {
        assessImageQuality: async () => ({ ok: true, relevanceScore: 8, raw: {} }),
        isQualityPass: () => true,
      };
      const result = await runPptImagesPipeline({
        db: {}, notebookId: 1,
        pptArtifact: { content: { pptPages: [
          { id: 1, pageType: 'cover', imagePrompt: '封面' },
        ]}},
        notebook: { name: 'X' },
      }, {
        v2Runtime: { generatePptPageCandidates: async () => ({ candidates: [{ imagePath: '/c.png' }] }) },
        qualityVisionService: fakeVision,
        rateLimitMs: 0,
      });
      if (!result.styleAnchor || result.styleAnchor.length < 5) {
        throw new Error(`styleAnchor 应非空，实际 ${result.styleAnchor}`);
      }
    },
  });

  // 用例 9：consistencyScore 在 mock 模式下 ≥ 8
  cases.push({
    name: 'consistencyScore mock 模式 ≥ 8（默认通过）',
    fn: async () => {
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
      if ((result.consistencyScore || 0) < 8) throw new Error('mock 一致性应 ≥ 8');
    },
  });

  // 用例 10：generatePptPageCandidates 抛错时退化处理
  cases.push({
    name: '生成抛错时降级处理（不整体崩溃）',
    fn: async () => {
      let callCount = 0;
      const result = await runPptImagesPipeline({
        db: {}, notebookId: 1,
        pptArtifact: { content: { pptPages: [
          { id: 1, pageType: 'cover', imagePrompt: '封面' },
        ]}},
        notebook: { name: 'X' },
      }, {
        v2Runtime: {
          generatePptPageCandidates: async () => {
            callCount++;
            throw new Error('mock fail');
          },
        },
        rateLimitMs: 0,
      });
      // 应返回 paused（封面失败）
      if (!result.paused) throw new Error('封面失败应返回 paused');
    },
  });

  return (async () => {
    let passed = 0;
    const failures = [];
    for (let i = 0; i < cases.length; i++) {
      try {
        await cases[i].fn();
        passed++;
      } catch (e) {
        failures.push({ caseIndex: i + 1, name: cases[i].name, message: e.message });
      }
    }
    return { passed, total: cases.length, failures, success: failures.length === 0 };
  })();
}

module.exports = {
  runPptImagesPipeline,
  // 常量
  PHASE, PAGE_STATUS, STYLE_ANCHOR_FALLBACK, DEFAULT_RATE_LIMIT_MS,
  // 内部工具（导出供测试与高级场景）
  pickCoverPage, pickContentPages, extractStyleAnchor,
  buildPageContext, buildRefinementHint,
  // 阶段函数
  runCoverPhase, runContentPhase, runConsistencyPhase,
  // 测试
  selfCheck,
};
