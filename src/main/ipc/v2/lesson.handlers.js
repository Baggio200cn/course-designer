/**
 * v2 课堂讲稿（多节课）handlers — 驭课 Agent v4.0.0 / Phase-9 C-X
 *
 * 与老的 script:generateABC / script:generateFormal 区别：
 *   - 老：1 份讲稿覆盖整门课（totalHours=72）
 *   - 新：每次生成 1 节课（≤4 学时，理论+实践拼配，带主题/章节）
 *
 * 处理的 channel：
 *   v2:lessonGenerateABC      生成本节课 A/B/C 三稿
 *   v2:lessonGenerateFormal   生成本节课正式稿
 *   v2:lessonList             列出该笔记本所有节课讲稿（按 lessonNumber 升序）
 *   v2:lessonSave             保存本节讲稿（手改后）
 *   v2:lessonConfirm          确认本节讲稿
 *   v2:lessonGet              读取单节课
 *   v2:lessonExportWord       导出本节讲稿 Word
 *
 * Artifact 设计：
 *   type='lecture_final', stage='lecture'
 *   metadata: { lessonNumber, topic, chapter, theoryHours, practiceHours, weekRange }
 *   content: { drafts:{a,b,c}, selectedDraft, finalScript, referenceMaterials, audit }
 */

const path = require('path');
const { dialog } = require('electron');
const { generateLectureABCDrafts } = require('../../script/abc-generator');
const { exportLectureWord } = require('../../export/word');
const { resolveProviderConfig, createAiClientByConfig } = require('../../api/provider-config');
// Phase-9（2026-05-10）：接入 B 方案阶段 1 的完整质量链路
//   - generateWithRetry：3 次自动重试 + 质量反馈注入（formal.builder fragment 9/10：五段式 + 课时连贯）
//   - reviewAndRevise：9 维度审核（含 referenceFusionDepth / fiveStepTransform / timelineConsistency）+ 自动修订
const { generateWithRetry } = require('../../agent/retry-loop');
const { reviewAndRevise } = require('../../services/review.service');

function pickAiClient(payload, db) {
  const config = resolveProviderConfig({ payload, db });
  return createAiClientByConfig(config);
}

function arr(v) { return Array.isArray(v) ? v : []; }

/**
 * 把节课元信息（主题/学时/章节/上游教学设计/进度表/素材）拼成 referenceContext 文本
 *
 * Phase-9（2026-05-10）质量升级（基于 codex 58/100 review 反馈）：
 *   ① 反虚构数据硬约束：禁止编造销量/点赞/产品性能/达人数等具体数字
 *   ② 素材落地结构化：每个素材包装为「教师动作 + 学生提取项」
 *   ③ 5 段法时长约束：单段 ≤ 30 分钟（防止"144分钟堆一个模块"）
 *   ④ 评价标准 10 分制（与素材一致，不要 100 分）
 *   ⑤ 减少 AI 套话约束（不要"评价你们学得好不好不是 X 而是 Y"格式）
 */
function buildLessonContextText({ lessonMeta, scheduleData, designData, referenceMaterials, courseName }) {
  const lines = [];

  // ═══ 本节范围 ═══
  lines.push('## 本节课范围（重要约束）');
  lines.push(`课程：${courseName}`);
  lines.push(`本节课次：第 ${lessonMeta.lessonNumber || 1} 节`);
  lines.push(`本节主题：${lessonMeta.topic || '（未指定）'}`);
  if (lessonMeta.chapter) lines.push(`对应章节：${lessonMeta.chapter}`);
  if (lessonMeta.weekRange) lines.push(`周次范围：${lessonMeta.weekRange}`);
  const totalLessonMinutes = ((lessonMeta.theoryHours || 0) + (lessonMeta.practiceHours || 0)) * 45;
  lines.push(`本节学时：理论 ${lessonMeta.theoryHours || 0} + 实践 ${lessonMeta.practiceHours || 0} = ${(lessonMeta.theoryHours || 0) + (lessonMeta.practiceHours || 0)} 学时（约 ${totalLessonMinutes} 分钟）`);
  lines.push('⚠ 本讲稿仅覆盖本节课内容（≤4 学时），不要写整门课。');
  if ((lessonMeta.theoryHours || 0) > 0 && (lessonMeta.practiceHours || 0) > 0) {
    lines.push('⚠ 本节分为「理论 + 实践」两段，讲稿要明确区分理论讲授和实操演练。');
  }
  lines.push('');

  // ═══ 反虚构硬约束（codex review 反馈点 ① 关键修复） ═══
  lines.push('## 🚫 数据真实性硬约束（违反任意一条都视为不合格）');
  lines.push('');
  lines.push('**禁止编造以下任何"具体数字"——除非素材里有出处可核验**：');
  lines.push('  ❌ 销量数据（如"销量 18 万件""GMV 620 万"）');
  lines.push('  ❌ 社交平台互动数据（如"小红书 12W 赞""抖音播放量 50 万"）');
  lines.push('  ❌ 产品性能数据（如"保暖性提高 40%""重量减轻 1/3"）');
  lines.push('  ❌ KOL/达人数量（如"对接 50 个腰部达人""官方发 10 条笔记"）');
  lines.push('  ❌ 调研问卷比例（如"85% 学生认为..."这种没有出处的统计）');
  lines.push('  ❌ 软件版本号（如"XMind 2024"——AI 不知道当下确切版本）');
  lines.push('  ❌ 模板/页面具体名称（如"Canva 搜「服装传播思维导图」"——可能搜不到）');
  lines.push('');
  lines.push('**正确做法**：');
  lines.push('  ✅ 模拟品牌示例 → 标注"以下为教学样例数据"，不写具体数字');
  lines.push('  ✅ 真实品牌引用 → 必须明确"投影 [素材名] 引导学生提取以下项目"，不替学生编结论');
  lines.push('  ✅ 工具操作 → 写"打开 XMind / ProcessOn 等任一思维导图工具"，不绑死版本');
  lines.push('');
  lines.push('**矛盾禁止**：模拟品牌（UR 风格）配真实战绩数据（GMV 620 万）= 严重错误');
  lines.push('');

  // ═══ 减少 AI 套话约束（codex review 反馈点 ④） ═══
  lines.push('## ✍ 表达自然度约束');
  lines.push('  ❌ 不要用"评价你们学得好不好，不是看 X 而是看 Y"这种 AI 模板对仗句式');
  lines.push('  ❌ 不要用"这一节课不是停留在概念识记上，而是要..."这种系统化套话');
  lines.push('  ✅ 开场用老师能直接说出口的口语：例如"今天我们做一件事——把脑子里关于服装传播的零散想法，画成一张能看懂的图"');
  lines.push('  ✅ 教师讲述要像现场真人讲课，可以有停顿/反问/具体例子');
  lines.push('');

  // ═══ 5 段法时长约束（codex review 反馈点 ③） ═══
  lines.push('## ⏱ 课中模块时长约束');
  lines.push(`本节总时长 ${totalLessonMinutes} 分钟，必须按 5 段法拆分（每段时长建议）：`);
  if (totalLessonMinutes >= 160) {
    lines.push('  - 导入新课：15-20 分钟');
    lines.push('  - 知识讲授：35-45 分钟（可拆 2 个子模块，每子模块 ≤ 25 分钟）');
    lines.push('  - 实操练习：60-80 分钟（可拆 2-3 轮，每轮 ≤ 30 分钟 + 中间穿插点评）');
    lines.push('  - 互查反馈：20-25 分钟');
    lines.push('  - 总结升华：10-15 分钟');
  } else {
    lines.push('  - 导入新课：10 分钟左右');
    lines.push('  - 知识讲授：20-25 分钟');
    lines.push('  - 实操练习：30-40 分钟');
    lines.push('  - 互查反馈：15 分钟');
    lines.push('  - 总结升华：5-10 分钟');
  }
  lines.push('  ⚠ 单段时长**绝对不能超过 30 分钟连续讲述**，超过必须拆分（学生注意力极限）');
  lines.push('');

  // ═══ 评价标准 10 分制约束（codex review 反馈点 ⑥） ═══
  lines.push('## 📊 评价标准格式约束');
  lines.push('  ✅ 互查/评分一律使用 **10 分制**（与教学设计的考核权重维度一致）');
  lines.push('  ❌ 不要写"满分 100""得 80 分"这种百分制');
  lines.push('  ✅ 评分维度建议 3-5 项，每项简短可观察（如"传播主体明确" "5W 完整性" "图层清晰" "评价依据具体"）');
  lines.push('');

  // ═══ 教学设计上下游 ═══
  if (designData) {
    lines.push('## 整门课教学设计要点（从教学设计阶段继承）');
    const obj = designData.teachingObjectives || {};
    if (arr(obj.knowledge).length) lines.push(`知识目标：${arr(obj.knowledge).join(' / ')}`);
    if (arr(obj.skill).length) lines.push(`技能目标：${arr(obj.skill).join(' / ')}`);
    if (arr(obj.emotion).length) lines.push(`素养目标：${arr(obj.emotion).join(' / ')}`);
    if (arr(designData.keyPoints).length) lines.push(`整门课重点：${arr(designData.keyPoints).join(' / ')}`);
    const phases = arr(designData.inClass?.phases);
    if (phases.length === 5) {
      lines.push(`5 段法参考：${phases.map((p) => `${p.phase}(${p.duration || '—'})`).join(' → ')}`);
    }
    lines.push('');
  }

  if (scheduleData?.schedule?.length) {
    const matchedRow = scheduleData.schedule.find(
      (r) => String(r.chapter || '').trim() === String(lessonMeta.chapter || '').trim()
    );
    if (matchedRow) {
      lines.push('## 教学进度表中本节内容定位');
      lines.push(`第 ${matchedRow.week} 周 / 第 ${matchedRow.session} 课次：${matchedRow.content || ''}`);
      if (matchedRow.method) lines.push(`授课方式：${matchedRow.method}`);
      lines.push('');
    }
  }

  // ═══ 素材结构化（codex review 反馈点 ② 关键修复） ═══
  if (arr(referenceMaterials).length) {
    lines.push('## 📂 老师提供的本节素材（必须每条都"落地"——给出教师动作 + 学生提取项）');
    lines.push('');
    lines.push('**落地标准**：素材不能只在文中"被提及名字"——必须明确告诉教师：');
    lines.push('  1. **投影哪个页面/段落**（不能写"打开 Canva 看看"，要写"投影 Canva 思维导图模板页面截图"）');
    lines.push('  2. **学生提取什么具体项目**（如"传播主体 / 内容 / 受众 / 渠道 / 效果" 5W 项）');
    lines.push('  3. **如何组织观察讨论**（如"两人一组对照填空 → 5 分钟"）');
    lines.push('');
    referenceMaterials.forEach((m, i) => {
      const head = m.kind === 'url' ? `🔗 URL：${m.url || ''}`
                : m.kind === 'file' ? `📎 文件：${m.filename || ''}`
                : '📝 老师粘贴文本';
      lines.push(`### 【素材 ${i + 1}】${head}`);
      const content = (m.content || '').slice(0, 2000);
      if (content) {
        lines.push('内容摘要：');
        lines.push(content);
      }
      // 给 AI 一个落地引导问句
      lines.push('');
      lines.push(`⚠ 在讲稿中必须明确：教师如何用这条素材？学生从中提取什么？`);
      lines.push('');
    });
    lines.push('**反例**（违反落地标准的写法，绝对禁止）：');
    lines.push('  ❌ "结合大英百科里的拉斯韦尔模型，我们来理解 5W 框架" ← 没说投影哪一页');
    lines.push('  ❌ "可以看一下 Canva 的模板" ← 没说看哪个模板/提取什么');
    lines.push('  ❌ "李宁年报里写得很详细" ← 没说翻到哪一页/提取哪些字段');
  }

  return lines.join('\n');
}

/** 取最新 confirmed 的 design / schedule 数据 */
function pickConfirmedDesign(items) {
  return items
    .filter((a) => a.type === 'design_doc' && a.stage === 'design' && a.confirmed)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0]?.content || null;
}
function pickConfirmedSchedule(items) {
  return items
    .filter((a) => a.type === 'schedule_table' && a.stage === 'schedule' && a.confirmed)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0]?.content || null;
}

function register(ipcMain, getDeps) {
  // ── 列出该笔记本的所有节课（按 lessonNumber 升序）─────────────────
  ipcMain.handle('v2:lessonList', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };
      const items = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId: id }) : [];
      const lessons = items
        .filter((a) => a.type === 'lecture_final' && a.stage === 'lecture')
        .sort((a, b) => (a.metadata?.lessonNumber || 0) - (b.metadata?.lessonNumber || 0));
      // 累计学时（已使用）
      const usedHours = lessons.reduce(
        (s, l) => s + (Number(l.metadata?.theoryHours) || 0) + (Number(l.metadata?.practiceHours) || 0),
        0
      );
      const notebook = db.getNotebookById(id);
      const totalHours = Number(notebook?.totalHours) || 72;
      return {
        success: true,
        data: {
          notebookId: id,
          lessons: lessons.map((a) => ({
            id: a.id,
            lessonNumber: a.metadata?.lessonNumber || 0,
            topic: a.metadata?.topic || '',
            chapter: a.metadata?.chapter || '',
            theoryHours: a.metadata?.theoryHours || 0,
            practiceHours: a.metadata?.practiceHours || 0,
            weekRange: a.metadata?.weekRange || '',
            confirmed: a.confirmed,
            updatedAt: a.updatedAt,
            createdAt: a.createdAt,
            // 不返回完整 content（节流量），用 v2:lessonGet 单独取
          })),
          usedHours,
          totalHours,
          remainingHours: Math.max(0, totalHours - usedHours),
        },
      };
    } catch (e) {
      console.error('[v2:lessonList] 异常：', e);
      return { success: false, error: e.message };
    }
  });

  // ── 读取单节课 ──────────────────────────────────────────────
  ipcMain.handle('v2:lessonGet', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const lessonId = Number(payload.lessonId);
      if (!Number.isFinite(lessonId) || lessonId <= 0) return { success: false, error: 'lessonId 无效' };
      const items = typeof db.listArtifacts === 'function' ? db.listArtifacts({}) : [];
      const lesson = items.find((a) => a.id === lessonId);
      if (!lesson) return { success: false, error: '节课不存在' };
      return { success: true, data: { lesson } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── 生成 A/B/C 候选稿 ──────────────────────────────────────
  ipcMain.handle('v2:lessonGenerateABC', async (event, payload = {}) => {
    const { db, ensureNotebookWorkspaceState } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      const notebook = ensureNotebookWorkspaceState
        ? ensureNotebookWorkspaceState(db.getNotebookById(notebookId))
        : db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };

      const lessonMeta = payload.lessonMeta || {};
      const referenceMaterials = arr(payload.referenceMaterials);
      const aiClient = pickAiClient(payload, db);
      if (!aiClient) return { success: false, error: '未配置有效的 AI 客户端' };

      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId }) : [];
      const designData = pickConfirmedDesign(allArtifacts);
      const scheduleData = pickConfirmedSchedule(allArtifacts);

      const lessonHours = (Number(lessonMeta.theoryHours) || 0) + (Number(lessonMeta.practiceHours) || 0);
      const lessonContextText = buildLessonContextText({
        lessonMeta, scheduleData, designData, referenceMaterials,
        courseName: notebook.name || '课程',
      });

      const result = await generateLectureABCDrafts({
        courseName: notebook.name || '课程',
        modules: [{
          // 用一个"虚拟模块"包装本节课，让现有 generator 跑通
          moduleNumber: lessonMeta.lessonNumber || 1,
          name: lessonMeta.topic || '本节课',
          hours: lessonHours || 4,
          description: lessonMeta.topic || '',
          knowledgePoints: arr(lessonMeta.knowledgePoints),
          teachingMethods: '',
        }],
        styleRubricText: payload.styleRubricText || '',
        aiClient,
        totalHours: lessonHours || 4,        // ⚠ 关键：用本节学时，不是 notebook.totalHours
        notebookContext: {
          softwareTools: notebook.softwareTools || '',
          jobTargets: notebook.jobTargets || '',
          industryScenarios: notebook.industryScenarios || '',
          learnerProfile: notebook.learnerProfile || '',
          frameworkObjectives: '',
          frameworkTeachingMethods: '',
          // 把本节上下文 + 素材塞进 referenceContext（最多 6000 字）
          referenceContext: lessonContextText.slice(0, 6000),
        },
      });

      return { success: true, data: { drafts: result, lessonMeta } };
    } catch (e) {
      console.error('[v2:lessonGenerateABC] 异常：', e);
      return { success: false, error: e.message };
    }
  });

  // ── 生成正式稿 ──────────────────────────────────────────────
  ipcMain.handle('v2:lessonGenerateFormal', async (event, payload = {}) => {
    const { db, ensureNotebookWorkspaceState } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      const notebook = ensureNotebookWorkspaceState
        ? ensureNotebookWorkspaceState(db.getNotebookById(notebookId))
        : db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };

      const lessonMeta = payload.lessonMeta || {};
      const drafts = payload.drafts || {};
      const preferred = payload.preferred || 'a';
      const referenceMaterials = arr(payload.referenceMaterials);
      const aiClient = pickAiClient({ ...payload, _stage: 'lecture_formal' }, db);
      if (!aiClient) return { success: false, error: '未配置有效的 AI 客户端' };

      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId }) : [];
      const designData = pickConfirmedDesign(allArtifacts);
      const scheduleData = pickConfirmedSchedule(allArtifacts);

      const lessonHours = (Number(lessonMeta.theoryHours) || 0) + (Number(lessonMeta.practiceHours) || 0);
      const lessonContextText = buildLessonContextText({
        lessonMeta, scheduleData, designData, referenceMaterials,
        courseName: notebook.name || '课程',
      });

      const notebookContext = {
        softwareTools: notebook.softwareTools || '',
        jobTargets: notebook.jobTargets || '',
        industryScenarios: notebook.industryScenarios || '',
        learnerProfile: notebook.learnerProfile || '',
        frameworkObjectives: '',
        frameworkTeachingMethods: '',
        referenceContext: lessonContextText.slice(0, 6000),
        // Phase-8.5：注入 totalHours 给 review.service 用于"课时连贯性"审核（维度 8）
        totalHours: lessonHours || 4,
      };

      // ── ① generateWithRetry：3 次重试 + 质量反馈注入（formal.builder fragment 9/10）──
      console.log(`[v2:lessonGenerateFormal] 启动质量链路：generateWithRetry → reviewAndRevise（9 维度审核）`);
      const { result, quality: retryQuality, attempts, exhausted, attemptLog } = await generateWithRetry(
        {
          drafts,
          preferred,
          styleRubricText: payload.styleRubricText || '',
          courseName: notebook.name || '课程',
          modules: [{
            moduleNumber: lessonMeta.lessonNumber || 1,
            name: lessonMeta.topic || '本节课',
            hours: lessonHours || 4,
            description: lessonMeta.topic || '',
          }],
          aiClient,
          totalHours: lessonHours || 4,
          notebookContext,
        },
        {
          maxAttempts: 3,
          onAttempt: ({ attempt: n, narrationCount, accepted }) => {
            console.log(`[v2:lessonGenerateFormal] 重试 ${n}: narration=${narrationCount}, accepted=${accepted}`);
          },
        }
      );

      // ── ② reviewAndRevise：9 维度审核（referenceFusionDepth / fiveStepTransform / timelineConsistency）──
      let reviewMeta = null;
      let finalScript = result?.script || '';
      const hasRichContext = Boolean(notebookContext.softwareTools || notebookContext.jobTargets || notebookContext.referenceContext);
      const skipReview = payload.skipReview === true;

      if (hasRichContext && !skipReview && aiClient && finalScript) {
        try {
          reviewMeta = await reviewAndRevise({
            script: finalScript,
            notebookContext,
            aiClient,
            autoRevise: true,
          });
          if (reviewMeta?.revised_success && reviewMeta.revised) {
            console.log(`[v2:lessonGenerateFormal] AI 审核触发自动修订（原 ${finalScript.length} 字 → 修订后 ${reviewMeta.revised.length} 字）`);
            finalScript = reviewMeta.revised;
          } else {
            console.log(`[v2:lessonGenerateFormal] AI 审核通过：score=${reviewMeta?.score} subscores=${JSON.stringify(reviewMeta?.subscores || {})}`);
          }
        } catch (e) {
          console.warn(`[v2:lessonGenerateFormal] reviewAndRevise 失败（不阻断）：${e.message}`);
        }
      }

      return {
        success: true,
        data: {
          finalScript,
          audit: result?.audit || null,
          lessonMeta,
          // 质量元数据（前端可显示给老师）
          qualityMeta: {
            attempts,                              // 重试次数
            exhausted,                             // 是否耗尽重试仍不达标
            retryQuality,                          // 最后一次质量评分
            reviewScore: reviewMeta?.score || null,
            reviewSubscores: reviewMeta?.subscores || null,
            reviewSuggestions: reviewMeta?.suggestions || [],
            revisedByReview: !!reviewMeta?.revised_success,
          },
        },
      };
    } catch (e) {
      console.error('[v2:lessonGenerateFormal] 异常：', e);
      return { success: false, error: e.message };
    }
  });

  // ── 保存 ──────────────────────────────────────────────────
  ipcMain.handle('v2:lessonSave', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      const lessonId = payload.lessonId ? Number(payload.lessonId) : null;
      const lessonMeta = payload.lessonMeta || {};
      const content = payload.content || {};

      const metadata = {
        lessonNumber: Number(lessonMeta.lessonNumber) || 1,
        topic: String(lessonMeta.topic || '').trim(),
        chapter: String(lessonMeta.chapter || '').trim(),
        theoryHours: Number(lessonMeta.theoryHours) || 0,
        practiceHours: Number(lessonMeta.practiceHours) || 0,
        weekRange: String(lessonMeta.weekRange || '').trim(),
        phase: 'phase-9',
        source: 'v2:lessonSave',
      };

      let artifact;
      if (lessonId && typeof db.updateArtifact === 'function') {
        artifact = db.updateArtifact(lessonId, {
          content,
          metadata,
          status: 'draft',
          title: `第 ${metadata.lessonNumber} 节·${metadata.topic || '未命名'}（${metadata.theoryHours + metadata.practiceHours}学时）`,
        });
      } else {
        artifact = db.createArtifact({
          notebookId,
          type: 'lecture_final',
          stage: 'lecture',
          title: `第 ${metadata.lessonNumber} 节·${metadata.topic || '未命名'}（${metadata.theoryHours + metadata.practiceHours}学时）`,
          content,
          confirmed: false,
          status: 'draft',
          metadata,
        });
      }

      return { success: true, data: { lessonId: artifact?.id, metadata } };
    } catch (e) {
      console.error('[v2:lessonSave] 异常：', e);
      return { success: false, error: e.message };
    }
  });

  // ── 确认 ──────────────────────────────────────────────────
  ipcMain.handle('v2:lessonConfirm', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const lessonId = Number(payload.lessonId);
      if (!Number.isFinite(lessonId) || lessonId <= 0) return { success: false, error: 'lessonId 无效' };
      if (typeof db.updateArtifact !== 'function') return { success: false, error: 'db.updateArtifact 不存在' };
      db.updateArtifact(lessonId, {
        confirmed: true,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });
      return { success: true, data: { lessonId, confirmed: true } };
    } catch (e) {
      console.error('[v2:lessonConfirm] 异常：', e);
      return { success: false, error: e.message };
    }
  });

  // ── 导出本节 Word（沿用 export/word.js 的 exportLectureWord）──
  ipcMain.handle('v2:lessonExportWord', async (event, payload = {}) => {
    const { db, mainWindow } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const lessonId = Number(payload.lessonId);
      if (!Number.isFinite(lessonId) || lessonId <= 0) return { success: false, error: 'lessonId 无效' };
      const items = typeof db.listArtifacts === 'function' ? db.listArtifacts({}) : [];
      const lesson = items.find((a) => a.id === lessonId);
      if (!lesson) return { success: false, error: '节课不存在' };
      const notebook = db.getNotebookById(lesson.notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };

      const meta = lesson.metadata || {};
      const finalScript = lesson.content?.finalScript || '';
      const lectureTitle = `第 ${meta.lessonNumber || 1} 节·${meta.topic || '未命名'}`;

      const picked = await dialog.showSaveDialog(mainWindow || null, {
        title: '导出本节讲稿 Word',
        defaultPath: `${notebook.name || '课程'}-${lectureTitle}.docx`,
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };
      const outputPath = picked.filePath.endsWith('.docx') ? picked.filePath : `${picked.filePath}.docx`;

      const filePath = await exportLectureWord({
        notebook,
        lectureTitle,
        lectureScript: finalScript,
        mergeReport: null,
        outputPath,
      });

      return { success: true, data: { filePath } };
    } catch (e) {
      console.error('[v2:lessonExportWord] 异常：', e);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
