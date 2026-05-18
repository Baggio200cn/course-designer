/**
 * review.service.js — AI 讲稿质量审核 + 自动修订服务（Phase-5B Layer 2）
 *
 * 功能：对已生成的正式讲稿做 AI 质量审核，发现问题后自动修订一次。
 * 解决的核心问题：
 *   1. 讲稿中仍然存在通用占位语言（"三维设计软件"、"相关案例"等）
 *   2. 内容与课程主题不匹配（错误的上下文残留）
 *   3. 开场/收束是模板套话，与本课内容无关
 *   4. 操作步骤太笼统，缺乏具体细节
 *
 * 使用方式：
 *   const { reviewAndRevise } = require('./review.service');
 *   const result = await reviewAndRevise({ script, notebookContext, aiClient });
 *   // result.revised 是修订后的讲稿（若 shouldRevise=true）
 *
 * 约束：
 *   - 本服务是独立于 quality.js 的 AI 审核层，quality.js 保持纯函数不变（H3 约束）
 *   - 只做一轮修订（避免无限循环）
 *   - 修订失败时静默返回原稿，不抛错到外层
 */

// ── 审核 Prompt ──────────────────────────────────────────────────────────────

const REVIEW_SYSTEM_PROMPT = `你是中职课程讲稿质量审核专家。对提供的讲稿做结构化质量审核，找出具体问题并给出修订建议。

审核维度：
1. 具体性：讲稿中是否有"相关软件"、"某工具"、"具体软件名"、"【此处填入】"等泛指占位，而非真实软件/工具名称
2. 一致性：讲稿内容是否与课程主题匹配（如课程是三维建模，讲稿中不应出现大量服饰搭配内容）
3. 开场质量：开场导入是否与本课主题直接相关（通用套话不算）
4. 操作可执行性：凡涉及软件操作，是否有具体步骤/菜单路径/快捷键（不能只说"打开软件""点击工具"）
5. 垃圾句：是否含有"这一段先把XX讲透"、"第X段必须"等写作指令残留
6. **【素材融合深度】**：如果给了 reference_excerpt（老师贴的真实素材片段），讲稿是否真正吸收并转化了素材：
   - **不及格**：只在讲稿里提到素材里出现的软件名（如"Photoshop"），但没用素材里的具体功能名（如 Select Subject / 段落样式 / Brand Kit）、参数（如图层透明度 60%）、操作步骤（如"点击 编辑→选择→主体"）、数据（如年报里的具体数字）
   - **及格**：讲稿里出现素材里至少 3 个具体专业名词或参数，且每个名词都嵌入到了"教师讲解什么 / 学生操作什么"这种可执行的教学动作中（不是仅当背景知识扫读）
7. **【五段式教学转化】**：如果讲稿要做到"基于真实素材的专业推理"，每个核心知识点应有 5 段结构：
   - 📺 投影展示什么真实资料（含来源）
   - 👀 学生观察什么细节
   - 🎤 教师讲解什么（基于素材的具体名词/参数/步骤）
   - ✋ 学生操作什么（含具体参数：选择什么工具 / 填什么数值 / 输出什么结果）
   - ✓ 评价标准是什么（4-6 个可观察、可量化的指标，不能是"符合 XX 原则"这种笼统话术）
   - **不及格**：讲稿出现"大家要认真学习""有任何问题随时问我""保持整体协调性"等通用话术超过 3 处
   - **不及格**：评分标准只说"符合四大排版原则"等笼统说法
8. **【课时连贯性】**：如果给了 totalHours（总学时），检查讲稿是否符合时间逻辑：
   - 总学时 ≤ 1.5（一节 90 分钟课）→ 讲稿不应出现"上节课我们学了"、"下节课"等跨课节表述
   - 总学时 ≥ 2 → 允许"上节课"，但必须用"任务 1 / 任务 2"或"模块 1 / 模块 2"的清晰过渡
9. **【版权安全】**：讲稿涉及真实品牌名或具体商品（如"波司登 2024 冬季企划""LOGO 放右上角"）时：
   - 如该品牌不在 jobTargets 字段或老师素材里出现，**必须标"模拟品牌：以 XX 风格为参考"**
   - 否则视为版权风险
10. **【主题相关度 / topicCoherence】**（2026-05-15 加固，问题一 D 层）：
   - 讲稿的"案例 / 数据 / 操作 / 引用"是否围绕课程主题（courseName）展开
   - **不及格**：讲稿出现与课程主题无关的内容（如课程是"时尚传播"但讲稿大段讲电商运营 / Adobe 软件操作 / 版权协议条款）
   - **及格**：讲稿所有主要案例、数据、术语都直接服务于课程主题
   - 这是为了防止"参考素材里混入离题内容时 AI 被迫引用"产生的偏题问题

输出格式：JSON，严格遵循 schema，不要 Markdown 代码块，不要解释文字。`;

function buildReviewPrompt(script, notebookContext = {}) {
  const contextLines = [
    notebookContext.softwareTools ? `- 课程使用的具体软件：${notebookContext.softwareTools}` : '',
    notebookContext.jobTargets ? `- 目标职业岗位：${notebookContext.jobTargets}` : '',
    notebookContext.industryScenarios ? `- 行业场景：${notebookContext.industryScenarios}` : '',
    notebookContext.totalHours ? `- 总学时：${notebookContext.totalHours}（${Number(notebookContext.totalHours) <= 1.5 ? '一节 90 分钟课，禁止"上节课"' : '多节课，允许"上节课"'}）` : ''
  ].filter(Boolean);

  // Phase-8.5：注入老师贴的素材片段，用于审核维度 6（素材融合深度）和 7（五段式教学转化）
  const referenceExcerpt = notebookContext.referenceContext
    ? String(notebookContext.referenceContext).slice(0, 4000)
    : '';

  // 课程主题：用于 topicCoherence 第 10 维
  const courseName = String(notebookContext.courseName || '').trim();

  return [
    '<task>审核下面的讲稿，输出结构化评分和问题清单。审核 10 个维度（含素材融合深度、五段式教学转化、课时连贯性、版权安全、主题相关度）。</task>',
    '',
    courseName ? `<course_topic>本课程核心主题：「${courseName}」（用于第 10 维 topicCoherence 审核）</course_topic>` : '',
    '',
    contextLines.length > 0 ? `<course_context>\n${contextLines.join('\n')}\n</course_context>` : '',
    '',
    referenceExcerpt
      ? [
          '<reference_excerpt>',
          '【老师贴的真实素材片段——审核维度 6/7 的对照原料】',
          '审核时必须检查：讲稿是否真正吸收了下方素材里的具体专业名词、参数、操作步骤？',
          '若仅在讲稿里提到素材里的软件名而没引用具体功能/参数/步骤——属于"浅引用"，不及格。',
          '',
          referenceExcerpt,
          '</reference_excerpt>'
        ].join('\n')
      : '<reference_excerpt>（老师未贴素材，跳过维度 6+7 审核）</reference_excerpt>',
    '',
    '<script_to_review>',
    script.slice(0, 6000),  // 限制 token
    '</script_to_review>',
    '',
    '<output_schema>',
    '{',
    '  "score": number,  // 1-10，7分以上可直接使用',
    '  "shouldRevise": boolean,  // score < 7 或 referenceFusionDepth < 6 或 topicCoherence < 6 时为 true',
    '  "referenceFusionDepth": number,  // 维度 6（素材融合深度）单项分 1-10。若无素材给 -1',
    '  "fiveStepTransform": number,     // 维度 7（五段式教学转化）单项分 1-10',
    '  "timelineConsistency": number,   // 维度 8（课时连贯性）单项分 1-10',
    '  "copyrightSafety": number,       // 维度 9（版权安全）单项分 1-10',
    '  "topicCoherence": number,        // 维度 10（主题相关度）单项分 1-10——讲稿主要案例/数据/术语是否围绕 course_topic',
    '  "issues": [',
    '    {',
    '      "type": "placeholder|topic_mismatch|generic_opening|missing_steps|garbage_sentence|shallow_reference|missing_five_step|timeline_break|copyright_risk|topic_drift",',
    '      "location": "问题所在位置（模块名或开头几个字）",',
    '      "text": "有问题的原文（≤30字）",',
    '      "fix": "具体修改建议（≤80字，对 shallow_reference 类，必须给出"应引用素材里的什么具体内容"）"',
    '    }',
    '  ],',
    '  "summary": "一句话总结主要问题"',
    '}',
    '</output_schema>'
  ].filter(s => s !== null).join('\n');
}

// ── 修订 Prompt ──────────────────────────────────────────────────────────────

const REVISE_SYSTEM_PROMPT = `你是中职课程讲稿修订专家。根据审核意见对讲稿做精准修订，只改有问题的部分，保留好的内容。

修订原则：
1. 把"三维设计软件"类的泛指替换为审核意见中指定的真实软件名
2. 删除开场中与本课无关的套话，替换为与本课主题直接相关的导入
3. 补充缺失的操作步骤（具体菜单/快捷键）
4. 删除所有写作指令残留（"这一段先把XX讲透"等）
5. **【shallow_reference 类问题专用】**：根据审核意见里给出的"应引用素材里的什么具体内容"，把素材原文里的**具体功能名 / 参数 / 操作步骤 / 数据**直接嵌入讲稿，并将其包装成"教师讲解 + 学生操作 + 评价标准"三段式
6. **【missing_five_step 类问题专用】**：把笼统的"对齐对象 / 替换素材"扩展为五段式：📺 投影展示什么真实资料（含来源）/ 👀 学生观察什么细节 / 🎤 教师讲解什么具体名词参数 / ✋ 学生操作什么具体动作（含参数）/ ✓ 评价标准 4-6 项可观察可量化指标
7. **【timeline_break 类问题专用】**：如总学时 ≤ 1.5（一节 90 分钟课），删除"上节课/下节课"等跨节课表述，改用"任务 1 / 任务 2"的过渡
8. **【copyright_risk 类问题专用】**：把未授权的真实品牌名（如"波司登 2024 冬季企划"）改为"模拟品牌：以国产保暖服装风格为参考"
9. 不改动已经合格的内容，不增加字数超过原稿的 25%

输出：只输出修订后的完整讲稿文本，不要任何解释。`;

function buildRevisePrompt(script, issues, notebookContext = {}) {
  const issueLines = issues
    .slice(0, 6)  // 最多处理6个问题，避免 prompt 过长
    .map((iss, i) => `${i + 1}. [${iss.type}] 位置：${iss.location}；原文：「${iss.text}」；修改建议：${iss.fix}`)
    .join('\n');

  const contextLines = [
    notebookContext.softwareTools ? `使用软件：${notebookContext.softwareTools}` : '',
    notebookContext.jobTargets ? `目标岗位：${notebookContext.jobTargets}` : ''
  ].filter(Boolean).join('；');

  return [
    contextLines ? `<course_context>${contextLines}</course_context>` : '',
    '',
    '<issues_to_fix>',
    issueLines,
    '</issues_to_fix>',
    '',
    '<original_script>',
    script,
    '</original_script>'
  ].filter(Boolean).join('\n');
}

// ── JSON 解析 ────────────────────────────────────────────────────────────────

function parseReviewResult(text) {
  try {
    const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/```\s*([\s\S]*?)\s*```/i);
    const raw = fenced ? fenced[1] : text.trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 审核讲稿，若有问题则自动修订一次
 *
 * @param {Object} options
 * @param {string} options.script - 原始正式讲稿
 * @param {Object} [options.notebookContext] - 课程富上下文（软件/岗位等）
 * @param {Object} options.aiClient - AI 客户端（需实现 chatJson 方法）
 * @param {boolean} [options.autoRevise=true] - 是否在发现问题时自动修订
 * @returns {Promise<{
 *   reviewed: boolean,
 *   score: number,
 *   shouldRevise: boolean,
 *   issues: Array,
 *   summary: string,
 *   revised: string|null,
 *   revised_success: boolean
 * }>}
 */
async function reviewAndRevise({ script, notebookContext = {}, aiClient, autoRevise = true }) {
  const SKIP = {
    reviewed: false, score: 0, shouldRevise: false,
    issues: [], summary: '', revised: null, revised_success: false
  };

  if (!script || !aiClient || typeof aiClient.chatJson !== 'function') return SKIP;

  // ── Step 1: 审核 ──────────────────────────────────────────────────────────
  let reviewData = null;
  try {
    const reviewText = await aiClient.chatJson({
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      userPrompt: buildReviewPrompt(script, notebookContext),
      temperature: 0.1,  // 极低温度，保证审核稳定
      maxTokens: 1200
    });
    reviewData = parseReviewResult(String(reviewText || ''));
  } catch {
    return SKIP;  // 审核失败静默跳过，不影响主流程
  }

  if (!reviewData) return SKIP;

  const score = Number(reviewData.score) || 5;
  const issues = Array.isArray(reviewData.issues) ? reviewData.issues : [];
  const summary = String(reviewData.summary || '');

  // Phase-8.5 / 2026-05-15：扩展子分项（5 个新维度）
  const referenceFusionDepth = Number(reviewData.referenceFusionDepth);   // -1 表示无素材
  const fiveStepTransform = Number(reviewData.fiveStepTransform) || 0;
  const timelineConsistency = Number(reviewData.timelineConsistency) || 0;
  const copyrightSafety = Number(reviewData.copyrightSafety) || 0;
  const topicCoherence = Number(reviewData.topicCoherence) || 0;          // 维度 10（2026-05-15 新增）

  // 触发修订的扩展条件：
  //   - 原条件：总分 < 7 + AI 自报告 shouldRevise=true
  //   - 素材融合深度 < 6（且确实有素材）
  //   - 五段式教学转化 < 6
  //   - 课时连贯性 < 5（硬伤）
  //   - 版权安全 < 5（硬伤）
  //   - 主题相关度 < 6（硬伤，2026-05-15 加固问题一 D 层）
  const hasReference = referenceFusionDepth >= 0;
  const referenceFailing = hasReference && referenceFusionDepth < 6;
  const fiveStepFailing = fiveStepTransform > 0 && fiveStepTransform < 6;
  const timelineFailing = timelineConsistency > 0 && timelineConsistency < 5;
  const copyrightFailing = copyrightSafety > 0 && copyrightSafety < 5;
  const topicFailing = topicCoherence > 0 && topicCoherence < 6;

  const shouldRevise = (
    (Boolean(reviewData.shouldRevise) && score < 7) ||
    referenceFailing ||
    fiveStepFailing ||
    timelineFailing ||
    copyrightFailing ||
    topicFailing
  );

  const baseResult = {
    reviewed: true,
    score,
    shouldRevise,
    issues,
    summary,
    revised: null,
    revised_success: false,
    // 暴露子维度分数供前端展示 + 调试
    subscores: {
      referenceFusionDepth,
      fiveStepTransform,
      timelineConsistency,
      copyrightSafety,
      topicCoherence,   // 2026-05-15 加固
    }
  };

  // ── Step 2: 修订（仅当 shouldRevise=true 且 autoRevise=true）────────────
  if (!shouldRevise || !autoRevise || issues.length === 0) {
    return baseResult;
  }

  try {
    const revisedText = await aiClient.chatJson({
      systemPrompt: REVISE_SYSTEM_PROMPT,
      userPrompt: buildRevisePrompt(script, issues, notebookContext),
      temperature: 0.25,
      maxTokens: Math.max(4000, Math.ceil(script.length / 2))  // 修订稿约与原稿等长
    });

    const revised = String(revisedText || '').trim();
    if (revised.length > script.length * 0.5) {
      // 修订稿长度合理（至少是原稿一半），认为修订成功
      return { ...baseResult, revised, revised_success: true };
    }
  } catch {
    // 修订失败，静默返回审核结果
  }

  return baseResult;
}

module.exports = { reviewAndRevise };
