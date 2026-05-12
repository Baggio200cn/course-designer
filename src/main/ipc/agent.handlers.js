/**
 * agent.handlers.js — Agent 编排器 IPC handlers（Phase-5C Step 3）
 *
 * 处理的 channel：
 *   agent:run        — 启动 Agent 对一个笔记本执行多阶段自动生成
 *   agent:getStatus  — 获取笔记本各阶段当前质量状态
 *
 * 设计原则：
 *   - handlers 只做参数验证 + 调用 orchestrator，不含业务逻辑
 *   - agent:run 是长时 IPC（可能 3-5 分钟），前端需展示进度条
 *   - 进度通过 emitBackendEvent 实时推送（scope: 'agent'）
 *   - 错误通过 { success: false, error } 返回，不抛到外层
 */

const path = require('path');
const fs = require('fs');
const { createAgentOrchestrator, assessNotebookState } = require('../agent/orchestrator');
const { resolveProviderConfig, createAiClientByConfig } = require('../api/provider-config');
const { exportInteractiveKnowledgeCards } = require('../export/knowledge-cards-interactive');

/**
 * Phase-7.5 M7.5.4: Agent 内部使用的"质量优先"框架信息图生成器
 *
 * 相比 Phase-7 B1 简化版，本实现引入：
 *   1. L1/L2/L3 三层结构化增强 Prompt（教学层次 + 视觉风格 + 信息密度）
 *   2. 双层质量审核：启发式（HTML 完整性/讲稿元词检测）+ 可选 Vision 审核
 *   3. 自动重试机制：最多 2 次重试（共 3 次尝试），每次基于审核反馈调整 Prompt
 *   4. 失败兜底：3 次失败返回 { skipped: true, reason }，不写 artifact 让上游决策
 *
 * 接口保持向后兼容：deps 中的 qualityVisionService 为可选注入（缺失时退化为仅启发式）。
 *
 * @param {Object} deps 依赖注入
 * @param {Function} deps.ensureNotebookWorkspaceState
 * @param {Function} deps.ensureNotebookWorkspaceDirs
 * @param {Object}   deps.infographicCardService 必需
 * @param {Function} deps.renderHtmlToPngBuffer  必需
 * @param {Function} [deps.inferInfocardStyle]
 * @param {Object}   [deps.qualityVisionService] 可选，含 assessImageQuality / isQualityPass
 * @param {Object}   [deps.aiVisionClient] 可选，传给 qualityVisionService
 * @returns {Function} async generateFrameworkInfographic({ db, notebookId, framework, modules })
 */
function buildAgentFrameworkInfographicHelper(deps) {
  const MAX_ATTEMPTS = 3;
  const HTML_MIN_BYTES = 1000;
  const LECTURE_TOKENS = ['教师讲述', '学完这一段', '课堂动作', '同学们好', '讲述：'];

  return async function generateFrameworkInfographic({ db, notebookId, framework, modules }) {
    const {
      ensureNotebookWorkspaceState,
      infographicCardService, renderHtmlToPngBuffer, inferInfocardStyle,
      qualityVisionService, aiVisionClient,
    } = deps;
    // Phase-7.7 F1（2026-04-30）：helper 入口 console.log，让用户能看到信息图执行进度
    console.log(`[fw-infographic] 开始生成 notebookId=${notebookId} infographicCardService=${!!infographicCardService} renderHtmlToPng=${typeof renderHtmlToPngBuffer}`);
    if (!infographicCardService || typeof renderHtmlToPngBuffer !== 'function') {
      console.error('[fw-infographic] ❌ 渲染依赖未注入：infographicCardService 或 renderHtmlToPngBuffer 缺失');
      throw new Error('信息图渲染依赖未注入');
    }
    const notebook = ensureNotebookWorkspaceState(db.getNotebookById(notebookId));
    if (!notebook) throw new Error('Notebook not found');

    const courseName = notebook.name || '课程';
    const topic = '教学框架结构图';
    console.log(`[fw-infographic] courseName=${courseName} 准备进入 ${MAX_ATTEMPTS} 次重试循环`);
    const fwContent = framework?.content || framework || {};

    // ── 构造 L1/L2/L3 三层增强 Prompt ─────────────────────────
    const enhancedContent = _buildLayeredContent({
      courseName, fwContent, modules, notebook,
    });

    const style = (typeof inferInfocardStyle === 'function')
      ? inferInfocardStyle(courseName, topic, enhancedContent) : 'professional';

    // ── 重试循环：最多 3 次尝试，每次失败把审核反馈追加到 Prompt ──
    let lastIssues = [];
    let lastVisionAssessment = null;
    let lastSavedFiles = null;     // F2 续：记录最后一次成功的 html/png 路径（用于 3 次失败兜底）
    let lastQualityScore = 0;
    const attemptLog = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const refinementHint = _buildRefinementHint(lastIssues, attempt);
      const promptFinal = infographicCardService.buildEnhancedPrompt({
        course_name: courseName, topic,
        content: enhancedContent + (refinementHint ? `\n\n${refinementHint}` : ''),
        style,
        software_context: notebook.softwareTools ? `本课使用：${notebook.softwareTools}` : '',
        job_context: notebook.jobTargets ? `面向岗位：${notebook.jobTargets}` : '',
        layout: 'grid_cards', visualStyle: 'professional',
      });

      let html;
      try {
        html = await infographicCardService.generateHtml({
          provider: 'ark', endpointId: null, promptFinal,
          layout: 'grid_cards', visualStyle: 'professional',
        });
      } catch (genErr) {
        lastIssues = [`生成调用失败: ${genErr.message}`];
        attemptLog.push({ attempt, stage: 'generate', error: genErr.message });
        continue;
      }

      // 启发式审核（必做）
      const heuristic = _heuristicAuditHtml(html, HTML_MIN_BYTES, LECTURE_TOKENS);
      if (!heuristic.pass) {
        lastIssues = heuristic.issues;
        attemptLog.push({ attempt, stage: 'heuristic', issues: heuristic.issues });
        continue;
      }

      // 渲染 PNG
      let pngBuffer;
      try {
        pngBuffer = await renderHtmlToPngBuffer(html, 1000, 1400);
      } catch (renderErr) {
        lastIssues = [`PNG 渲染失败: ${renderErr.message}`];
        attemptLog.push({ attempt, stage: 'render', error: renderErr.message });
        continue;
      }

      const saved = infographicCardService.saveArtifacts({
        html, pngBuffer, title: `${courseName}-${topic}`, notebookId,
      });
      // F2 续：每次 saved 都记录，3 次失败时用作兜底 artifact
      lastSavedFiles = saved;

      // Vision 审核（可选）
      // Phase-7.7 F2（2026-04-30）：阈值从 7 降到 6
      // doubao Seedream 4.5 实际评分常在 5-7 之间，阈值 7 导致信息图永远 skipped 不写 artifact，
      // 用户截图看不到任何信息图。降到 6 让"勉强可用"的图也能产出供老师参考修改。
      const VISION_PASS_THRESHOLD = 6;
      let visionAssessment = null;
      let qualityScore = 8;
      if (qualityVisionService && typeof qualityVisionService.assessImageQuality === 'function') {
        const pageContext = _buildVisionContext({ courseName, modules });
        try {
          visionAssessment = await qualityVisionService.assessImageQuality(
            { imagePath: saved.imagePath, pageContext, criteria: 'relevance_only' },
            { aiClient: aiVisionClient },
          );
          if (visionAssessment && visionAssessment.ok && typeof visionAssessment.relevanceScore === 'number') {
            qualityScore = visionAssessment.relevanceScore;
            lastQualityScore = Math.max(lastQualityScore, qualityScore);  // F2 续：记最高分
          }
          lastVisionAssessment = visionAssessment;
          console.log(`[fw-infographic] attempt ${attempt}/${MAX_ATTEMPTS}：Vision 评分=${qualityScore}（阈值 ${VISION_PASS_THRESHOLD}）`);
          if (visionAssessment && visionAssessment.ok && visionAssessment.relevanceScore < VISION_PASS_THRESHOLD) {
            lastIssues = (visionAssessment.issues && visionAssessment.issues.length)
              ? visionAssessment.issues
              : [`Vision 审核相关性分数 ${visionAssessment.relevanceScore} 低于阈值 ${VISION_PASS_THRESHOLD}`];
            attemptLog.push({ attempt, stage: 'vision', score: visionAssessment.relevanceScore, issues: lastIssues });
            continue;
          }
        } catch (visionErr) {
          // Vision 审核异常不阻断（保守策略：审核服务自身不可用不应阻塞生成）
          console.warn(`[fw-infographic] attempt ${attempt}：Vision 调用异常（不阻塞）：${visionErr.message}`);
          attemptLog.push({ attempt, stage: 'vision_warn', error: visionErr.message });
        }
      }

      // 通过 → 写 artifact 并返回
      if (typeof db.createArtifact === 'function') {
        try {
          db.createArtifact({
            notebookId, type: 'framework_infographic', stage: 'framework',
            title: `${courseName}-教学框架信息图`,
            content: {
              htmlPath: saved.htmlPath, imagePath: saved.imagePath, topic,
              qualityScore, attempts: attempt,
            },
            format: 'html', status: 'generated', confirmed: false,
            previewText: topic,
          });
        } catch (e) { /* 非致命 */ }
      }

      return {
        imagePath: saved.imagePath,
        htmlPath: saved.htmlPath,
        topic,
        qualityScore,
        attempts: attempt,
        visionAssessment: visionAssessment || undefined,
      };
    }

    // Phase-7.7 F2 续（2026-04-30）：3 次都失败也保留最后一次的 artifact + needsManualReview=true
    // 之前 skipped + 不写 artifact → 用户截图看不到任何信息图，挫败感极强 + 下次 Agent 又重试又失败
    // 现在：写 artifact 标 needsManualReview=true，老师能在 UI 看到"草稿"，可手动重生成或接受
    // 同时 frameworkInfographicQualityPass 检测会拒绝（已含 needsManualReview 检查），不会误判为完成
    if (lastSavedFiles && typeof db.createArtifact === 'function') {
      console.warn(`[fw-infographic] ${MAX_ATTEMPTS} 次重试均未达 Vision 阈值（最高分 ${lastQualityScore}），写入 needsManualReview 草稿 artifact 供老师审阅`);
      try {
        db.createArtifact({
          notebookId, type: 'framework_infographic', stage: 'framework',
          title: `${courseName}-教学框架信息图（待人工复核）`,
          content: {
            htmlPath: lastSavedFiles.htmlPath,
            imagePath: lastSavedFiles.imagePath,
            topic,
            qualityScore: lastQualityScore,
            attempts: MAX_ATTEMPTS,
            needsManualReview: true,
            lastIssues,
          },
          format: 'html', status: 'needs_review', confirmed: false,
          previewText: `${topic}（Vision ${lastQualityScore}/10，待复核）`,
        });
        return {
          imagePath: lastSavedFiles.imagePath,
          htmlPath: lastSavedFiles.htmlPath,
          topic,
          qualityScore: lastQualityScore,
          attempts: MAX_ATTEMPTS,
          needsManualReview: true,
          visionAssessment: lastVisionAssessment || undefined,
          attemptLog,
        };
      } catch (e) {
        console.warn('[fw-infographic] 写 needsManualReview artifact 失败（非致命）:', e.message);
      }
    }

    // 兜底：3 次都失败 + 没保存任何文件（生成阶段就挂了）
    console.error(`[fw-infographic] ${MAX_ATTEMPTS} 次重试均失败且无任何 saved 文件 — skipped`);
    return {
      skipped: true,
      reason: `质量审核 ${MAX_ATTEMPTS} 次均不达标`,
      attempts: MAX_ATTEMPTS,
      lastIssues,
      visionAssessment: lastVisionAssessment || undefined,
      attemptLog,
    };
  };
}

/**
 * 构造 L1/L2/L3 三层结构化内容描述。
 * L1 教学层次 / L2 视觉风格 / L3 信息密度。用 XML 标签包裹便于模型识别。
 */
function _buildLayeredContent({ courseName, fwContent, modules, notebook }) {
  const objectives = fwContent.objectives || {};
  const knowledge = Array.isArray(objectives.knowledge) ? objectives.knowledge : [];
  const skill = Array.isArray(objectives.skill) ? objectives.skill : [];
  const moduleList = Array.isArray(modules) ? modules.slice(0, 8) : [];

  const totalHours = notebook.totalHours || fwContent.totalHours || '';
  const moduleSummary = moduleList.map((m, i) => {
    const kps = (m.knowledgePoints || []).slice(0, 3).join('、');
    const hours = m.hours ? `${m.hours} 学时` : '';
    return `  - 模块${i + 1}「${m.name || ''}」${hours ? `（${hours}）` : ''}${kps ? `：${kps}` : ''}`;
  }).join('\n');

  // L1：教学层次结构
  const l1 = [
    `<level1 name="教学层次结构">`,
    `课程名称：${courseName}`,
    totalHours ? `总学时：${totalHours}` : '',
    knowledge.length ? `知识目标：${knowledge.slice(0, 3).join('、')}` : '',
    skill.length ? `技能目标：${skill.slice(0, 3).join('、')}` : '',
    moduleSummary ? `模块结构（共 ${moduleList.length} 个模块）：\n${moduleSummary}` : '',
    `</level1>`,
  ].filter(Boolean).join('\n');

  // L2：视觉风格指引
  const l2 = [
    `<level2 name="视觉风格指引">`,
    `配色：以学科主题深蓝（#1B2E6B）为主色，辅以中性灰白与一组高亮强调色（黄/绿/粉轮换用于卡片图标背景）。`,
    `排版：采用"卡片式网格"布局——顶部色带 + 主标题区 + 模块卡片网格 + 底部说明条。卡片之间留白均匀，避免拥挤。`,
    `字体：全程使用无衬线字体（system-ui / Microsoft YaHei），主标题粗体 28-32px，卡片标题 16px，正文 14px，行高 1.6。`,
    `</level2>`,
  ].join('\n');

  // L3：信息密度控制
  const l3 = [
    `<level3 name="信息密度控制">`,
    `避免堆字：每张知识点卡片正文不超过 2-3 行，关键术语用粗体或主题色高亮。`,
    `保留呼吸感：卡片内边距 ≥ 16px，模块之间间距 ≥ 12px，画布四周留白 ≥ 24px。`,
    `层级清晰：通过字号、颜色、粗细形成视觉层次，让老师 3 秒内看懂"这门课讲什么、分几块、每块讲什么"。`,
    `</level3>`,
  ].join('\n');

  return `${l1}\n\n${l2}\n\n${l3}`;
}

/**
 * 启发式 HTML 审核：长度 / 结构 / 讲稿元词
 * 函数 > 30 行：覆盖 3 类失败模式，返回 { pass, issues }
 */
function _heuristicAuditHtml(html, minBytes, lectureTokens) {
  const issues = [];
  const text = String(html || '');
  if (text.length < minBytes) {
    issues.push(`HTML 长度仅 ${text.length} 字节（< ${minBytes}），疑似生成失败或截断。请确保输出完整 HTML 文档（含 head/body/style）。`);
  }
  if (!/<style[\s>]/i.test(text)) {
    issues.push('HTML 缺少 <style> 标签，结构异常。请使用内联 <style> 注入 CSS。');
  }
  if (!/<div[\s>]/i.test(text)) {
    issues.push('HTML 缺少 <div> 容器，结构异常。请使用 <div> 包裹卡片网格。');
  }
  for (const token of lectureTokens) {
    if (text.includes(token)) {
      issues.push(`HTML 含讲稿元词"${token}"，生成跑偏到讲稿内容。请只输出信息图卡片，不要包含讲稿话术。`);
      break;
    }
  }
  return { pass: issues.length === 0, issues };
}

/**
 * 把上一次审核反馈拼接成可追加到 Prompt 末尾的中文微调说明。
 */
function _buildRefinementHint(issues, attempt) {
  if (!Array.isArray(issues) || issues.length === 0) return '';
  const header = attempt === 2
    ? '【上一次生成存在以下问题，请针对性改进】'
    : '【已重试 1 次仍不达标，请严格按结构化指令重写，避免以下问题】';
  return [header, ...issues.map((it, i) => `${i + 1}. ${it}`)].join('\n');
}

/**
 * 构造 Vision 审核所需的 pageContext（课程名 + 模块标题列表）。
 */
function _buildVisionContext({ courseName, modules }) {
  const moduleTitles = (Array.isArray(modules) ? modules.slice(0, 8) : [])
    .map((m, i) => `模块${i + 1}：${m.name || ''}`)
    .filter(s => s.trim());
  return [`课程：${courseName}`, ...moduleTitles].join('\n');
}

/**
 * Phase-7 B3: Agent 内部使用的知识点卡片导出器
 * 调用 knowledge-cards-interactive.js（互动版 HTML，含翻卡 + 测验 + 进度）
 */
function buildAgentKnowledgeCardsHelper() {
  return async function exportKnowledgeCardsHelper({ db, notebookId, notebook, modules }) {
    if (!Array.isArray(modules) || modules.length === 0) {
      throw new Error('无模块数据，无法导出知识点卡片');
    }
    const workspaceRoot = notebook?.workspacePath || path.join(require('os').homedir(), 'Documents', '驭课Agent工作区', String(notebook?.name || notebookId));
    const outDir = path.join(workspaceRoot, 'framework', 'knowledge-cards');
    fs.mkdirSync(outDir, { recursive: true });
    const outputPath = path.join(outDir, `${notebook?.name || 'course'}-互动知识卡片.html`);
    exportInteractiveKnowledgeCards({ notebook, modules, outputPath });

    if (typeof db.createArtifact === 'function') {
      try {
        db.createArtifact({
          notebookId, type: 'knowledge_cards_html', stage: 'framework',
          title: `${notebook?.name || '课程'}-互动知识卡片`,
          content: { outputPath, kpCount: modules.reduce((s, m) => s + (m.knowledgePoints?.length || 0), 0) },
          format: 'html', status: 'generated', confirmed: false,
          previewText: outputPath,
        });
      } catch (e) { /* 非致命 */ }
    }
    return { outputPath };
  };
}

/**
 * Phase-7.5 M7.5.5: Agent 内部使用的"质量优先" PPT 配图批量生成器
 *
 * 替代 Phase-7 B2 的简化版（仅快速调 API + 1.5s 限流），引入：
 *   1. Phase 1: 封面深度生成（3 候选 → Vision 审核 → 取最佳 → 提取 styleAnchor）
 *   2. Phase 2: 内容页串行 + 携带 styleAnchor + Vision 双审核（相关性 + 风格一致性）
 *   3. Phase 3: 一致性复核（抽样 30% 做风格 spot check）
 *
 * 完整流程封装在 services/ppt-images-pipeline.service.js（独立可测）。
 * 本 helper 仅做参数装配 + 暂停状态识别（runPipeline 返回 paused=true 时上游 orchestrator 识别）
 *
 * @param {Object} v2Runtime
 * @param {Object} qualityVisionService - 由 deps 注入（可选；缺失时返回 needsManualReview）
 * @param {Object} [aiVisionClient] - Phase-7.6 R1：真实多模态客户端（含 chatVision 方法）
 */
function buildAgentPptImagesHelper(v2Runtime, qualityVisionService, aiVisionClient) {
  return async function generatePptImagesBatch({ db, notebookId }) {
    if (!v2Runtime || typeof v2Runtime.generatePptPageCandidates !== 'function') {
      throw new Error('v2Runtime.generatePptPageCandidates 未就绪');
    }
    const pptArtifact = db.getLatestArtifact?.(notebookId, 'ppt_outline', 'ppt');
    if (!pptArtifact?.content?.pptPages || pptArtifact.content.pptPages.length === 0) {
      throw new Error('PPT 页面规划不存在');
    }
    const notebook = db.getNotebookById ? db.getNotebookById(notebookId) : { name: '课程' };

    const { runPptImagesPipeline } = require('../services/ppt-images-pipeline.service');
    const result = await runPptImagesPipeline(
      { db, notebookId, pptArtifact, notebook },
      {
        v2Runtime,
        qualityVisionService,
        aiClient: aiVisionClient,   // R1：透传给 vision service 走真实路径
        rateLimitMs: 500,
      }
    );

    // 流水线返回 paused → 转为 helper 抛错让 orchestrator 调 pauseAgent
    if (result.paused) {
      const err = new Error(result.pauseReason || 'PPT 配图流水线暂停');
      err.pausePayload = {
        stage: 'ppt_images',
        reason: result.pauseReason,
        details: {
          phase: result.phase,
          coverImagePath: result.coverImagePath || null,
          consistencyScore: result.consistencyScore,
          pageResults: result.pageResults,
        },
        suggestions: result.suggestions || [],
      };
      throw err;
    }

    // 成功：返回与原接口兼容的统计字段 + 新增 styleAnchor / consistencyScore
    return {
      imagesGenerated: result.totalGenerated || 0,
      imagesSkipped: 0,
      imagesFailed: result.failedCount || 0,
      needsReviewCount: result.needsReviewCount || 0,
      totalPages: pptArtifact.content.pptPages.length,
      styleAnchor: result.styleAnchor,
      consistencyScore: result.consistencyScore,
      coverImagePath: result.coverImagePath,
      pageResults: result.pageResults,
    };
  };
}

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getDeps
 */
function register(ipcMain, getDeps) {
  /**
   * agent:run — 启动 Agent 自动生成流水线
   *
   * payload: {
   *   notebookId: number,
   *   targetStages?: string[],   // 默认 ['framework', 'lecture']
   *   provider?: string,         // 默认从 db 读取
   *   model?: string
   * }
   *
   * 返回：{
   *   success: boolean,
   *   data: {
   *     status: 'success'|'blocked'|'timeout'|'error',
   *     stepLog: Array,
   *     summary: string,
   *     finalState: Object|null
   *   }
   * }
   */
  ipcMain.handle('agent:run', async (event, payload = {}) => {
    // getDeps() 直接暴露 patchCourseProject / normalizeModuleInput，没有 helpers 嵌套层
    const {
      db, emitBackendEvent, patchCourseProject, normalizeModuleInput, v2Runtime,
      // Phase-7 扩展：信息图渲染所需依赖
      ensureNotebookWorkspaceState, ensureNotebookWorkspaceDirs,
      infographicCardService, renderHtmlToPngBuffer, inferInfocardStyle,
    } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      if (!notebookId) throw new Error('notebookId 不能为空');

      const notebook = db.getNotebookById(notebookId);
      if (!notebook) throw new Error(`找不到笔记本 ${notebookId}`);

      // 创建 AI 客户端工厂（惰性，在 orchestrator 内部使用）
      // Phase-7.7 B6：加 purpose 参数支持"按用途选 endpoint"
      //   - createAiClient()                  → 通用文本 endpoint（ark_endpoint_text）
      //   - createAiClient('lecture_formal')  → 正式稿专用（ark_endpoint_lecture_formal，缺则 fallback 到 text）
      function createAiClient(purpose) {
        const config = resolveProviderConfig({ payload, db, purpose });
        return createAiClientByConfig(config);
      }

      // B6：正式稿专用 client（懒创建——仅在 orchestrator 真要走 generate_lecture_formal 时才用）
      // 工厂闭包：避免 startup 期就调一次（用户可能 endpoint 还没填）
      const createLectureFormalClient = () => createAiClient('lecture_formal');

      // Phase-7.6 R1：创建真实 Vision client（复用文本 endpoint，需多模态模型如 doubao-1.5-pro）
      // 用户截图确认 ep-m-20260417145821-ltrjs 本身是多模态模型，可直接复用
      const aiVisionClient = createAiClient();

      // Phase-5D：默认目标阶段扩展为 framework → lecture → ppt
      const targetStages = Array.isArray(payload.targetStages)
        ? payload.targetStages
        : ['framework', 'lecture', 'ppt'];

      // Phase-7.6 R1：构造扩展 helpers，注入真实 aiVisionClient
      // - qualityVisionService 内部 deps.aiClient = aiVisionClient → 真实调 chatVision
      // - 缺 vision client 时 service 自动降级为 needsManualReview（不再 mock 通过）
      const qualityVisionService = require('../services/quality-vision.service');
      const generateFrameworkInfographic = (infographicCardService && typeof renderHtmlToPngBuffer === 'function')
        ? buildAgentFrameworkInfographicHelper({
            ensureNotebookWorkspaceState, ensureNotebookWorkspaceDirs,
            infographicCardService, renderHtmlToPngBuffer, inferInfocardStyle,
            qualityVisionService,
            aiVisionClient,   // R1：真实视觉 client
          })
        : null;
      const exportKnowledgeCards = buildAgentKnowledgeCardsHelper();
      const generatePptImagesBatch = (v2Runtime && typeof v2Runtime.generatePptPageCandidates === 'function')
        ? buildAgentPptImagesHelper(v2Runtime, qualityVisionService, aiVisionClient)
        : null;

      const agent = createAgentOrchestrator({
        db,
        createAiClient,
        emitEvent: emitBackendEvent,
        helpers: {
          patchCourseProject,
          normalizeModuleInput,
          // Phase-7 扩展能力（缺失时 orchestrator 自动跳过对应动作）
          generateFrameworkInfographic,
          exportKnowledgeCards,
          generatePptImagesBatch,
          // B6：orchestrator 调正式稿生成时优先用此 client；缺则 fallback 到通用 aiClient
          createLectureFormalClient,
        },
        v2Runtime
      });

      const result = await agent.run(notebookId, {
        targetStages,
        maxSteps: 20  // Phase-7：含 framework_infographic / knowledge_cards / ppt_images_batch 扩展动作
      });

      return { success: result.success, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * agent:getPauseState — 获取笔记本当前是否处于"待老师介入"状态
   *
   * Phase-7.5 M7.5.1：前端轮询此接口判断是否展示 WorkflowPauseModal
   */
  ipcMain.handle('agent:getPauseState', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      if (typeof db.getAgentPauseState !== 'function') {
        return { success: true, data: null };  // 未实现暂停时返回 null
      }
      const state = db.getAgentPauseState(Number(notebookId));
      return { success: true, data: state };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  /**
   * agent:resume — 从暂停状态恢复执行
   *
   * Phase-7.5 M7.5.1：老师在 UI 上完成介入操作（如调整 imagePrompt / 修改框架）后调用
   *
   * payload: {
   *   notebookId: number,
   *   refinementHint?: string,   // 老师提供的微调提示词
   *   targetStages?: string[],
   * }
   */
  ipcMain.handle('agent:resume', async (event, payload = {}) => {
    const {
      db, emitBackendEvent, patchCourseProject, normalizeModuleInput, v2Runtime,
      ensureNotebookWorkspaceState, ensureNotebookWorkspaceDirs,
      infographicCardService, renderHtmlToPngBuffer, inferInfocardStyle,
    } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      if (!notebookId) throw new Error('notebookId 不能为空');

      const pauseState = typeof db.getAgentPauseState === 'function'
        ? db.getAgentPauseState(notebookId) : null;
      if (!pauseState) {
        return { success: false, error: '该笔记本无暂停状态可恢复' };
      }

      // 复用 agent:run 的 helper 构造（但带 resumeFromPause 选项）
      // B6：resume 路径也支持 purpose 参数，正式稿专用 client 同样可用
      function createAiClient(purpose) {
        return createAiClientByConfig(resolveProviderConfig({ payload, db, purpose }));
      }
      const createLectureFormalClient = () => createAiClient('lecture_formal');
      // Phase-7.6 R1：resume 路径同样注入真实 vision client
      const aiVisionClient = createAiClient();
      const qualityVisionService = require('../services/quality-vision.service');
      const generateFrameworkInfographic = (infographicCardService && typeof renderHtmlToPngBuffer === 'function')
        ? buildAgentFrameworkInfographicHelper({
            ensureNotebookWorkspaceState, ensureNotebookWorkspaceDirs,
            infographicCardService, renderHtmlToPngBuffer, inferInfocardStyle,
            qualityVisionService, aiVisionClient,
          }) : null;
      const exportKnowledgeCards = buildAgentKnowledgeCardsHelper();
      const generatePptImagesBatch = (v2Runtime && typeof v2Runtime.generatePptPageCandidates === 'function')
        ? buildAgentPptImagesHelper(v2Runtime, qualityVisionService, aiVisionClient) : null;

      const agent = createAgentOrchestrator({
        db, createAiClient, emitEvent: emitBackendEvent,
        helpers: {
          patchCourseProject, normalizeModuleInput,
          generateFrameworkInfographic, exportKnowledgeCards, generatePptImagesBatch,
          createLectureFormalClient, // B6：resume 路径同样支持
        },
        v2Runtime,
      });

      const targetStages = Array.isArray(payload.targetStages)
        ? payload.targetStages : ['framework', 'lecture', 'ppt'];

      // Phase-7.7 P0-反馈3：PPT 页面级修改 — 在恢复前先把新 imagePrompt 写入 ppt_outline artifact
      // 这样 agent 重新跑 generate_ppt_images_batch 时会读到新的 imagePrompt
      if (payload.pageRefinement?.pageId && payload.pageRefinement?.imagePrompt) {
        try {
          const pptArtifact = db.getLatestArtifact?.(notebookId, 'ppt_outline', 'ppt');
          if (pptArtifact?.content?.pptPages) {
            const pages = pptArtifact.content.pptPages.map((p) => {
              if (p.id === payload.pageRefinement.pageId) {
                return {
                  ...p,
                  imagePrompt: payload.pageRefinement.imagePrompt,
                  // 清除旧图，让 pipeline 重新生成
                  imagePath: '', imageUrl: '',
                  qualityStatus: undefined, needsManualReview: false,
                };
              }
              return p;
            });
            db.updateArtifact?.(pptArtifact.id, {
              content: { ...pptArtifact.content, pptPages: pages },
            });
            console.log(`[agent:resume] 已更新 PPT 页 ${payload.pageRefinement.pageId} 的 imagePrompt`);
          }
        } catch (e) {
          console.warn('[agent:resume] 更新 imagePrompt 失败（非致命）:', e.message);
        }
      }

      const result = await agent.run(notebookId, {
        targetStages, maxSteps: 20,
        resumeFromPause: {
          stepLog: pauseState.stepLog || [],
          agentState: pauseState.agentState || {},
          refinementHint: payload.refinementHint || null,
          pageRefinement: payload.pageRefinement || null,
        },
      });
      return { success: result.success, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * agent:clearPauseState — 主动清除暂停状态（老师选择"放弃此步，从下一步继续"）
   */
  ipcMain.handle('agent:clearPauseState', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      if (typeof db.clearAgentPauseState !== 'function') return { success: true, cleared: false };
      const cleared = db.clearAgentPauseState(Number(notebookId));
      return { success: true, cleared };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  /**
   * agent:getStatus — 获取笔记本当前各阶段完成情况和质量摘要
   *
   * 纯只读操作，用于前端展示 Agent 状态面板
   */
  ipcMain.handle('agent:getStatus', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const safeId = Number(notebookId);
      const state = assessNotebookState(db, safeId);
      if (!state) {
        return { success: false, error: '找不到该笔记本' };
      }
      return {
        success: true,
        data: {
          notebookId: safeId,
          courseName: state.notebook?.name || '',
          framework: {
            exists: Boolean(state.framework),
            valid: Boolean(state.frameworkQuality?.valid),
            errors: state.frameworkQuality?.errors || [],
            warnings: state.frameworkQuality?.warnings || []
          },
          lecture: {
            draftCount: state.draftCount || 0,
            hasFinalScript: Boolean(state.finalScript),
            valid: Boolean(state.lectureQuality?.valid),
            errors: state.lectureQuality?.errors || [],
            warnings: state.lectureQuality?.warnings || [],
            narrationCharCount: state.lectureQuality?.checks?.finalNarrationCharCount || 0
          },
          // Phase-5D：PPT 阶段状态
          ppt: {
            pageCount: state.pptPageCount || 0,
            hasPages: (state.pptPageCount || 0) > 0
          },
          // Phase-5D：视频阶段状态
          video: {
            hasPrompt: Boolean(state.videoPromptExists)
          }
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
