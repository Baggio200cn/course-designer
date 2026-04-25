/**
 * retry-loop.js — Agent 自动重试层（Phase-5C Step 1）
 *
 * 职责：对 generateFormalLectureScript 的输出做质量检验，
 * 若不达标则自动调整 prompt 参数重试，最多 MAX_ATTEMPTS 次。
 *
 * 重试策略：
 *  1. 正常调用 generateFormalLectureScript
 *  2. validateLectureStage 检验是否达标
 *  3. 不达标 → 把质量问题转为 retryHint 追加到 styleRubricText 重试
 *  4. 选择历次候选中讲述字数最高的作为最终结果
 *
 * 约束：
 *  - 不修改 formal-generator.js（H6）
 *  - quality.js 保持纯函数（H3）
 *  - 超出重试次数不抛异常，返回最佳候选 + exhausted 标记
 *  - 单函数文件，无副作用，可独立测试
 */

const { generateFormalLectureScript } = require('../script/formal-generator');
const { validateLectureStage } = require('../v2/quality');

const MAX_ATTEMPTS = 3;

/**
 * 把 validateLectureStage 结果转为给 AI 的重试提示字符串。
 * 优先列出最影响质量的问题，限制在 5 条以内避免 prompt 过长。
 *
 * @param {Object} quality - validateLectureStage 返回值
 * @param {number} attempt - 当前是第几次重试（从 1 开始）
 * @param {number} totalHours - 课时数
 * @returns {string|null} - 追加到 styleRubricText 的提示文本，无问题时返回 null
 */
function buildRetryHint(quality, attempt, totalHours) {
  const minNarration = Math.round(2200 * totalHours);
  const issues = [];

  // 优先级 1：结构缺失（最严重，直接影响能否使用）
  const structureError = quality.errors.find((e) => /教师讲述|课堂动作/.test(e));
  if (structureError) {
    issues.push('每个章节必须同时包含"教师讲述："段落（3-5句连续口播）和"课堂动作附栏："段落，缺一不可');
  }

  // 优先级 2：章节数不足
  const sectionError = [...quality.errors, ...quality.warnings].find((m) => /章节偏少|章节/.test(m));
  if (sectionError) {
    issues.push('必须包含：开场导入、各教学模块章节、课堂练习与检查、总结收束 四大部分');
  }

  // 优先级 3：字数不足（最常见问题）
  const narrationCount = quality.checks?.finalNarrationCharCount || 0;
  if (narrationCount > 0 && narrationCount < minNarration) {
    const gap = minNarration - narrationCount;
    issues.push(
      `教师讲述字数不足（当前约 ${narrationCount} 字，本次必须≥${minNarration} 字）——` +
      `还需补充约 ${gap} 字，请在每个模块的"教师讲述"段落写 4-6 句连续口播内容`
    );
  }

  // 优先级 4：逐条短句（格式错误）
  const bulletError = [...quality.errors, ...quality.warnings].find((m) => /逐条短句/.test(m));
  if (bulletError) {
    issues.push('教师讲述禁止写成"- 条目"格式，必须是3-5句连续段落，像老师真正说话的样子');
  }

  // 优先级 5：垃圾句或元提示泄露
  const garbageError = [...quality.errors, ...quality.warnings].find((m) => /垃圾模板句|元提示/.test(m));
  if (garbageError) {
    issues.push('删除所有写作指令残留（如"这一段先把XX讲透"、"第X段必须"），直接写老师口播正文');
  }

  // 兜底：errors 里还有其他未覆盖的问题
  if (issues.length === 0 && quality.errors.length > 0) {
    issues.push(...quality.errors.slice(0, 3));
  }

  if (issues.length === 0) return null;

  return [
    '',
    `===自动重试补充要求（第 ${attempt} 次重试，共最多 ${MAX_ATTEMPTS} 次）===`,
    `上次生成不符合标准，本次必须修复以下问题（按重要性排序）：`,
    ...issues.map((item, i) => `${i + 1}. ${item}`),
    '请重新生成完整讲稿，不要只修改局部。'
  ].join('\n');
}

/**
 * 判断本次生成结果是否达到"可接受"的最低标准。
 * 不要求完美，只要没有阻塞性错误且字数不严重偏低即可。
 *
 * @param {Object} quality - validateLectureStage 返回值
 * @param {number} totalHours
 * @returns {boolean}
 */
function isAcceptable(quality, totalHours) {
  // 有任何 error，不可接受
  if (quality.errors && quality.errors.length > 0) return false;

  const minNarration = Math.round(2200 * totalHours);
  const narrationCount = quality.checks?.finalNarrationCharCount || 0;

  // 字数低于目标 70% 以下，不可接受（给 30% 宽容度）
  // 多段生成时每段只含 1-2 模块，单段峰值约 1300 字；4 段合并后约 6500-7000 字，
  // 约为 8800 目标的 74-80%，80% 门槛会导致所有结果都被拒绝。
  if (narrationCount > 0 && narrationCount < minNarration * 0.7) return false;

  return true;
}

/**
 * 带自动重试的正式讲稿生成（Agent Step 1 入口）
 *
 * @param {Object} params - generateFormalLectureScript 接受的全部参数
 * @param {Object} [agentOptions]
 * @param {number} [agentOptions.maxAttempts=3] - 最大尝试次数（含第一次）
 * @param {Function} [agentOptions.onAttempt] - 每次尝试后的回调 ({ attempt, narrationCount, errors, accepted })
 *
 * @returns {Promise<{
 *   result: Object,        // generateFormalLectureScript 返回值（script / meta / style 等）
 *   quality: Object,       // 最终质量报告（validateLectureStage 返回）
 *   attempts: number,      // 实际尝试次数
 *   exhausted: boolean,    // true = 重试次数耗尽仍未达标
 *   attemptLog: Array      // 每次尝试的质量快照，用于日志/调试
 * }>}
 */
async function generateWithRetry(params, agentOptions = {}) {
  const maxAttempts = Math.min(
    Math.max(1, Number(agentOptions.maxAttempts) || MAX_ATTEMPTS),
    5 // 硬上限，防止失控
  );
  const onAttempt = typeof agentOptions.onAttempt === 'function' ? agentOptions.onAttempt : null;
  const totalHours = Number(params.totalHours) || 1;

  let currentParams = { ...params };
  const attemptLog = [];
  const candidates = []; // 所有成功生成的候选，用于最终选优

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let result;
    let quality;

    try {
      result = await generateFormalLectureScript(currentParams);
    } catch (err) {
      // 生成本身报错，记录后立即停止（不再重试，把错误上抛）
      attemptLog.push({ attempt, error: err.message, accepted: false });
      throw err;
    }

    // 质量验证（纯函数，不调 AI）
    quality = validateLectureStage(
      {
        drafts: params.drafts || {},
        selectedDraft: params.preferred || 'a',
        finalScript: result.script || ''
      },
      { requireFinal: true, totalHours }
    );

    const narrationCount = quality.checks?.finalNarrationCharCount || 0;
    const errorCount = quality.errors.length;
    const accepted = isAcceptable(quality, totalHours);

    const snapshot = { attempt, narrationCount, errorCount, warningCount: quality.warnings.length, accepted };
    attemptLog.push(snapshot);
    candidates.push({ result, quality, attempt });

    if (onAttempt) {
      try { onAttempt(snapshot); } catch (_) {}
    }

    console.log(
      `[retry-loop] 第 ${attempt}/${maxAttempts} 次生成：` +
      `讲述 ${narrationCount} 字，errors=${errorCount}，accepted=${accepted}`
    );

    // 达标，立即返回
    if (accepted) {
      return { result, quality, attempts: attempt, exhausted: false, attemptLog };
    }

    // 还有机会重试，注入质量反馈
    if (attempt < maxAttempts) {
      const retryHint = buildRetryHint(quality, attempt, totalHours);
      if (retryHint) {
        currentParams = {
          ...currentParams,
          styleRubricText: (String(currentParams.styleRubricText || '')) + retryHint
        };
      }
    }
  }

  // 重试耗尽：从候选中选讲述字数最高的
  const best = candidates.reduce((a, b) => {
    const aCount = a.quality.checks?.finalNarrationCharCount || 0;
    const bCount = b.quality.checks?.finalNarrationCharCount || 0;
    return bCount > aCount ? b : a;
  });

  console.log(
    `[retry-loop] 重试耗尽，选用第 ${best.attempt} 次结果` +
    `（讲述 ${best.quality.checks?.finalNarrationCharCount || 0} 字）`
  );

  return {
    result: best.result,
    quality: best.quality,
    attempts: maxAttempts,
    exhausted: true,
    attemptLog
  };
}

module.exports = { generateWithRetry };
