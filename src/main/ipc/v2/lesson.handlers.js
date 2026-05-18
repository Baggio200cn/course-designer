/**
 * v2 课堂讲稿（多节课）handlers — v4.3.0 重构版
 *
 * 工作流（P1.1 重构 2026-05-17，已删 A/B/C 三稿）：
 *   ① v2:lessonGenerateDraft   → AI 直接出 1 份完整草稿
 *   ② 老师在 LectureStage 右栏改 → 改成意中所想的版本
 *   ③ v2:lessonGenerateFormal  → 基于改后稿 + 9 维度质量审核 → 出正式稿
 *
 * 处理的 channel：
 *   v2:lessonGenerateDraft    生成本节课 1 份完整草稿（无 ABC）
 *   v2:lessonGenerateFormal   基于老师改后的 priorDraft 出正式稿（含 retry-loop + reviewAndRevise）
 *   v2:lessonList             列出该笔记本所有节课讲稿
 *   v2:lessonSave             保存本节讲稿（手改后）
 *   v2:lessonConfirm          确认本节讲稿
 *   v2:lessonGet              读取单节课
 *   v2:lessonExportWord       导出本节讲稿 Word
 *
 * Artifact 设计：
 *   type='lecture_final', stage='lecture'
 *   metadata: { lessonNumber, topic, chapter, theoryHours, practiceHours, weekRange }
 *   content: { draftScript, priorDraft, finalScript, referenceMaterials, audit, qualityMeta }
 */

const path = require('path');
const { dialog } = require('electron');
// P1.1（2026-05-17）：abc-generator 已删除，统一走新流程
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
// T8 修复（2026-05-17）：新增 minutesPerHour 参数，1 学时换算分钟数由老师配置传入，无兜底
function buildLessonContextText({ lessonMeta, scheduleData, designData, referenceMaterials, courseName, minutesPerHour }) {
  if (!minutesPerHour || minutesPerHour <= 0) {
    throw new Error('buildLessonContextText: 缺少 minutesPerHour（请先在创建笔记本时填学校的"1 学时分钟数"）');
  }
  const lines = [];

  // ═══ 本节范围 ═══
  lines.push('## 本节课范围（重要约束）');
  lines.push(`课程：${courseName}`);
  lines.push(`本节课次：第 ${lessonMeta.lessonNumber || 1} 节`);
  lines.push(`本节主题：${lessonMeta.topic || '（未指定）'}`);
  if (lessonMeta.chapter) lines.push(`对应章节：${lessonMeta.chapter}`);
  if (lessonMeta.weekRange) lines.push(`周次范围：${lessonMeta.weekRange}`);
  const totalLessonMinutes = ((lessonMeta.theoryHours || 0) + (lessonMeta.practiceHours || 0)) * minutesPerHour;  // T8
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
      // 2026-05-15：把进度表行的学时数也带入上下文（防讲稿用错时长）
      if (matchedRow.hours) lines.push(`本课次学时：${matchedRow.hours} 学时（约 ${matchedRow.hours * minutesPerHour} 分钟）`);  // T8
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

/** 取最新 confirmed 的 design / schedule / ppt 数据（v4.3.0 D6.1）*/
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
// D6.1 新增：取最新（可未 confirmed）的 ppt outline 作为讲稿的**主骨架**
function pickLatestPptOutline(items) {
  return items
    .filter((a) => a.type === 'ppt_outline' && a.stage === 'ppt')
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0]?.content || null;
}
// D6.1 新增：把 PPT pages 序列化成讲稿可用的"页级骨架文本"
function serializePptPagesForLecture(pptOutline, minutesPerHour, lessonHours) {
  if (!pptOutline) return null;
  const pages = Array.isArray(pptOutline.pages) ? pptOutline.pages : [];
  if (pages.length === 0) return null;
  const totalMinutes = lessonHours * minutesPerHour;
  const avgMinutesPerPage = (totalMinutes / pages.length).toFixed(1);
  const lines = [
    `═══ PPT 主骨架（${pages.length} 页 · 每页 ≈ ${avgMinutesPerPage} 分钟 · 是讲稿口播的**核心节奏**）═══`,
    '',
    '⚠ 铁律：讲稿必须以每页 PPT 为口播段落骨架，依次展开。',
    '   - 每页 PPT 对应一段教师口播（开场词 → 要点讲解 → 过渡到下一页）',
    '   - 口播必须扣住页面 title / keyContent / 配图 / 数据点',
    '',
  ];
  pages.forEach((p) => {
    const keyContent = Array.isArray(p.keyContent) ? p.keyContent.filter(Boolean).join('  /  ')
      : String(p.keyContent || '').split('\n').filter(Boolean).join('  /  ');
    lines.push(`▶ P${p.pageNumber} · 【${p.pageType || '内容'}】《${p.title || '未命名'}》${p.subtitle ? '（' + p.subtitle + '）' : ''}`);
    if (keyContent) lines.push(`  要点：${keyContent.slice(0, 200)}`);
    if (p.speakerNotes) lines.push(`  演讲备注：${String(p.speakerNotes).slice(0, 150)}`);
    if (p.dataPoint) lines.push(`  数据点：${String(p.dataPoint).slice(0, 100)}`);
    if (p.interactionPrompt) lines.push(`  互动提示：${String(p.interactionPrompt).slice(0, 100)}`);
    lines.push('');
  });
  return lines.join('\n');
}

function register(ipcMain, getDeps) {
  // 2026-05-16 v4.1.4 新增：从 title 反推修复 metadata
  //   场景：早期 bug 导致 metadata.lessonNumber/topic/theoryHours 被空表单冲掉，
  //   但 artifact.title 保留了拼接字符串"第 N 节·主题（X学时）"，可以反向解析重建 metadata。
  //   仅用于"已存在 title 但 metadata 异常"的情况。
  ipcMain.handle('v2:lessonRepairMetaFromTitle', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      const notebookId = Number(payload.notebookId);
      const lessonId = Number(payload.lessonId);
      if (!Number.isFinite(notebookId) || !Number.isFinite(lessonId)) {
        return { success: false, error: 'notebookId / lessonId 无效' };
      }
      const items = db.listArtifacts({ notebookId });
      const target = items.find((a) => Number(a.id) === lessonId);
      if (!target) return { success: false, error: '未找到该 artifact' };

      const title = String(target.title || '');
      // 匹配 "第 N 节·主题（X学时）" 或 "第 N 节·主题（X 学时）"
      const m = title.match(/第\s*(\d+)\s*节·(.+?)（(\d+(?:\.\d+)?)\s*学时）/);
      if (!m) {
        return { success: false, error: `title 无法解析：${title}` };
      }
      const lessonNumber = Number(m[1]) || 1;
      const topic = m[2].trim();
      const totalHrs = Number(m[3]) || 0;
      // 学时拆分：现有 metadata 优先；否则均分理论/实践（向下取整 + 余数给理论）
      const oldMeta = target.metadata || {};
      const theoryHours = Number(oldMeta.theoryHours) > 0
        ? Number(oldMeta.theoryHours)
        : Math.ceil(totalHrs / 2);
      const practiceHours = Number(oldMeta.practiceHours) > 0
        ? Number(oldMeta.practiceHours)
        : Math.max(0, totalHrs - theoryHours);

      const merged = {
        ...oldMeta,
        lessonNumber: Number(oldMeta.lessonNumber) > 0 ? Number(oldMeta.lessonNumber) : lessonNumber,
        topic: String(oldMeta.topic || '').trim() || topic,
        theoryHours,
        practiceHours,
        chapter: String(oldMeta.chapter || '').trim(),
        weekRange: String(oldMeta.weekRange || '').trim(),
        phase: 'phase-9',
        source: 'v2:lessonRepairMetaFromTitle',
      };
      db.updateArtifact(lessonId, { metadata: merged });
      return { success: true, data: { metadata: merged } };
    } catch (e) {
      console.error('[v2:lessonRepairMetaFromTitle] 异常：', e);
      return { success: false, error: e.message };
    }
  });

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
        // 2026-05-15 v4.1.4 T1：多键排序，与 v2:listDesignLessons 对齐
        //   1) lessonNumber  2) subNumber  3) chapter  4) createdAt
        .sort((a, b) => {
          const lnDiff = (Number(a.metadata?.lessonNumber) || 0) - (Number(b.metadata?.lessonNumber) || 0);
          if (lnDiff !== 0) return lnDiff;
          const snDiff = (Number(a.metadata?.subNumber) || 0) - (Number(b.metadata?.subNumber) || 0);
          if (snDiff !== 0) return snDiff;
          const chDiff = String(a.metadata?.chapter || '').localeCompare(String(b.metadata?.chapter || ''), 'zh');
          if (chDiff !== 0) return chDiff;
          const ta = new Date(a.createdAt || 0).getTime() || 0;
          const tb = new Date(b.createdAt || 0).getTime() || 0;
          return ta - tb;
        });
      // 累计学时（已使用）
      const usedHours = lessons.reduce(
        (s, l) => s + (Number(l.metadata?.theoryHours) || 0) + (Number(l.metadata?.practiceHours) || 0),
        0
      );
      const notebook = db.getNotebookById(id);
      const totalHours = Number(notebook?.totalHours) || 0;   // T7
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

  // ── v4.3.0 D7（2026-05-18）：lecture 阶段启动数据 ─────────────────────────
  //   返回该笔记本下所有 PPT outline artifact（不限本节，老师可下拉切骨架）
  //   + 默认 PPT 的 lessonMeta（自动预填本节基础信息）
  //   触发：进 lecture 阶段时 / 老师手动切 PPT 下拉时
  ipcMain.handle('v2:getLectureBootstrap', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      const items = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId }) : [];
      // 列出所有 ppt_outline（不论 confirmed）按 updatedAt 倒序
      const allPpts = items
        .filter((a) => a.type === 'ppt_outline' && a.stage === 'ppt')
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

      // 把每份 PPT 的 lessonMeta 提取出来供前端展示+预填
      const pptOptions = allPpts.map((a) => {
        // metadata 优先（D5 治本后保存的字段），fallback 到 content.lessonMeta
        const meta = (a.metadata && a.metadata.topic)
          ? a.metadata
          : (a.content?.lessonMeta || {});
        const pages = Array.isArray(a.content?.pages) ? a.content.pages : [];
        return {
          id: a.id,
          title: a.title || `PPT 课件 #${a.id}`,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          confirmed: !!a.confirmed,
          pageCount: pages.length,
          lessonMeta: {
            lessonNumber: meta.lessonNumber || 0,
            topic: meta.topic || '',
            chapter: meta.chapter || '',
            theoryHours: Number(meta.theoryHours) || 0,
            practiceHours: Number(meta.practiceHours) || 0,
            weekRange: meta.weekRange || '',
          },
        };
      });

      const defaultPpt = pptOptions[0] || null;
      return {
        success: true,
        data: {
          notebookId,
          pptOptions,                              // 给下拉用
          defaultPptId: defaultPpt?.id || null,    // 默认选中
          lessonMeta: defaultPpt?.lessonMeta || null,  // 默认预填的本节基础信息
        },
      };
    } catch (e) {
      console.error('[v2:getLectureBootstrap] 异常：', e);
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

  // ── 💬 v4.3.0 D6.5：辅助对话 patch 讲稿 ──────────────────────
  //   老师在右侧 ChatPanel 输入指令 + 上传素材 → AI 局部 patch 讲稿
  ipcMain.handle('v2:lessonChatPatch', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      const notebookId = Number(payload.notebookId);
      if (!notebookId) return { success: false, error: 'notebookId 无效' };
      const notebook = db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };
      const currentScript = String(payload.currentScript || '').trim();
      if (currentScript.length < 100) return { success: false, error: '当前讲稿过短，请先生成正式稿' };
      const instruction = String(payload.instruction || '').trim();
      const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
      if (!instruction && attachments.length === 0) return { success: false, error: '请输入指令或上传素材' };

      const aiClient = pickAiClient(payload, db);
      if (!aiClient) return { success: false, error: '未配置 AI 客户端' };

      const lessonMeta = payload.lessonMeta || {};

      const systemPrompt = [
        '你是讲稿协作助手。任务：按老师的指令 + 新素材，对当前讲稿做**局部 patch**，不要重写整篇。',
        '',
        '## 输入',
        '- 当前讲稿（完整文本）',
        '- 老师指令（明确改哪段、改成什么）',
        '- 新素材（老师上传的文件 / 图片 OCR 结果）',
        '',
        '## 输出',
        '- 返回**修改后的完整讲稿**（不是 diff）',
        '- 只改老师指令涉及的部分，**其他段落原样保留**',
        '- 保持原 Markdown 结构（## 标题 / 教师讲述 / 课堂动作附栏）',
        '',
        '## 铁律',
        '- 如老师指令含"删 X" → 把 X 段删了',
        '- 如老师指令含"加 X 案例" → 在合适位置插入新段落（优先用素材里的真实数据 / 品牌）',
        '- 如老师指令含"改更 X 风格" → 仅改语气，不改事实数据',
        '- 严禁编造素材里没有的数字',
      ].join('\n');

      const userPromptParts = [
        `## 老师指令\n${instruction || '（仅提供素材，无具体指令 → 请把素材里的真实数据 / 案例融入讲稿合适位置）'}`,
        '',
      ];
      if (attachments.length > 0) {
        userPromptParts.push('## 老师新上传的素材');
        attachments.forEach((a, i) => {
          userPromptParts.push(`### 素材 ${i + 1}：${a.name}（类型：${a.kind || 'text'}）`);
          userPromptParts.push(String(a.content || '').slice(0, 4000));
          userPromptParts.push('');
        });
      }
      userPromptParts.push('## 当前讲稿（按上面指令 patch）');
      userPromptParts.push(currentScript.slice(0, 18000));   // 留 4k 给 prompt 框架 + 素材
      const userPrompt = userPromptParts.join('\n');

      let newScript = '';
      try {
        newScript = await aiClient.chatJson({
          systemPrompt, userPrompt,
          temperature: 0.3,   // patch 时低 temp，避免发挥过度
          maxTokens: 14000,
          asText: true,
        });
      } catch (e) {
        return { success: false, error: `AI patch 失败：${e.message}` };
      }
      newScript = String(newScript || '').trim();
      if (newScript.length < 200) return { success: false, error: 'AI 返回的 patch 过短' };

      return {
        success: true,
        data: {
          newScript,
          beforeLength: currentScript.length,
          afterLength: newScript.length,
          deltaChars: newScript.length - currentScript.length,
          patchedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      console.error('[v2:lessonChatPatch]', e);
      return { success: false, error: e.message };
    }
  });

  // ── ① 生成讲稿草稿（1 稿，无 A/B/C）──────────────────────
  // P1.1（2026-05-17）：新流程入口，AI 直接出 1 份完整讲稿，老师在右栏改后走 generateFormal
  ipcMain.handle('v2:lessonGenerateDraft', async (event, payload = {}) => {
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
      let referenceMaterials = arr(payload.referenceMaterials);
      const aiClient = pickAiClient(payload, db);
      if (!aiClient) return { success: false, error: '未配置有效的 AI 客户端' };

      // 相关性过滤（同 generateFormal）
      let referenceFilterAudit = null;
      if (referenceMaterials.length >= 2) {
        try {
          const { filterByRelevance } = require('../../services/reference-filter.service');
          const filterResult = await filterByRelevance({
            aiClient,
            courseName: notebook.name || '课程',
            lessonTopic: lessonMeta.topic || '',
            references: referenceMaterials,
            threshold: 5,
          });
          referenceMaterials = filterResult.filtered;
          referenceFilterAudit = {
            kept: filterResult.filtered.length,
            dropped: filterResult.dropped.length,
            details: filterResult.audit,
            warning: filterResult.warning || null,
          };
        } catch (filterErr) {
          console.warn('[v2:lessonGenerateDraft] 相关性过滤异常，兜底全保留：', filterErr.message);
        }
      }

      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId }) : [];
      const designData = pickConfirmedDesign(allArtifacts);
      const scheduleData = pickConfirmedSchedule(allArtifacts);
      // D6.1（2026-05-18）：拉 PPT outline 作为讲稿主骨架（权重最高）
      const pptOutline = pickLatestPptOutline(allArtifacts);

      const lessonHours = (Number(lessonMeta.theoryHours) || 0) + (Number(lessonMeta.practiceHours) || 0);
      if (lessonHours <= 0) {
        return { success: false, error: 'lessonMeta 缺少 theoryHours + practiceHours（请确认本节课学时分配，不能为 0）' };
      }
      const lessonMinutesPerHour = Number(notebook?.minutesPerHour) || 0;
      if (lessonMinutesPerHour <= 0) {
        return { success: false, error: '笔记本未设置"1 学时分钟数"（minutesPerHour）。请在创建/编辑笔记本时填写学校标准（如 40 / 45 / 50）。' };
      }
      const lessonContextText = buildLessonContextText({
        lessonMeta, scheduleData, designData, referenceMaterials,
        courseName: notebook.name || '课程',
        minutesPerHour: lessonMinutesPerHour,
      });

      // D6.1（2026-05-18）：PPT 骨架文本（主权重）
      const pptSkeletonText = serializePptPagesForLecture(pptOutline, lessonMinutesPerHour, lessonHours);

      // D6.1 系统提示词：彻底重排权重
      //   ❌ 老版：教学设计是主、PPT 没参与
      //   ✅ 新版：PPT 21 页是骨架；老师上传素材是肌肉（直接引用数据 / 案例 / 真实品牌）；设计 5 段法只对齐节奏
      const totalMinutes = lessonHours * lessonMinutesPerHour;
      const systemPrompt = [
        '你是资深的职业教育课堂讲稿专家。',
        '任务：把【PPT 21 页骨架】扩写成老师可直接照念的完整课堂讲稿，并把【教学辅助素材】里的真实案例 / 数据 / 观点深度融入。',
        '',
        '## 🔴 输入权重（必须按此优先级使用）',
        '1. **PPT 大纲（最高权重 · 100% 决定骨架）**：每页 PPT 对应讲稿的一段口播。',
        '   - 按页号顺序写，不可跳页 / 不可合并 / 不可添加 PPT 没有的话题。',
        '   - 每页口播必须扣住该页的 title / keyContent / dataPoint / interactionPrompt。',
        '2. **教学辅助素材（高权重 · 80% 决定内容深度）**：老师上传的真实案例、行业数据、品牌观察、学情资料。',
        '   - 优先直接引用其中的具体数字 / 真实品牌名 / 学情数据 / 行业事实。',
        '   - **素材的质量和提炼深度直接决定讲稿是否打动人**。',
        '3. **教学设计 5 段法（中权重 · 30% 节奏对齐）**：仅用于确认讲稿不破坏 design.inClass.phases 的节奏。',
        '4. **lessonMeta（低权重 · 仅校验）**：确认本节学时 / 主题范围。',
        '',
        '## 📐 结构（按 PPT 页序展开）',
        '不再按 5 段法机械拆分，而是按 PPT 21 页的真实节奏：',
        '- 每页 PPT → 一段教师口播（含【教师讲述】 + 【课堂动作】）',
        '- 段首标注「## 第 N 页 · 《页标题》（约 X 分钟）」',
        '- 段内：教师讲述 ≥ 200 字（口语化、引用素材数据、有过渡到下一页的钩子）',
        '- 段内：课堂动作附栏（3-5 条具体动作：板书 / 展示 / 提问 / 演示 / 学生互动）',
        '',
        '## ⏱ 时长校准',
        `本节 ${lessonHours} 学时 × ${lessonMinutesPerHour} 分钟 = ${totalMinutes} 分钟。`,
        `PPT 共 ${pptOutline ? (pptOutline.pages?.length || '?') : '0'} 页 → 每页平均 ${pptOutline ? ((totalMinutes / Math.max(1, pptOutline.pages?.length || 1)).toFixed(1)) : '?'} 分钟。`,
        '',
        '## 🚫 反编造铁律（H14）',
        '- 严禁编造销量 / 点赞 / 达人数等具体数字（除非素材里有出处）',
        '- 软件版本号不写死（用"剪映/PR等任一视频剪辑工具"代替"剪映2024"）',
        '- 案例 / 品牌名优先用素材里给的真实名（无素材时用通用描述，不编造）',
        '',
        '## ✍ 表达自然度',
        '- 像老师真人讲课：可有停顿 / 反问 / 具体例子 / 师生互动设计',
        '- 避免 AI 套话（"评价你们学得好不好不是 X 而是 Y" 模板对仗）',
        '- 思政元素自然融入（不硬塞，找 1-2 个机会贴主题）',
        '',
        '## 📤 输出格式（严格 Markdown）',
        '# {课程名} · 第 N 节 · {主题} · 课堂讲稿',
        '## 第 1 页 · 《XXX》（约 X 分钟）',
        '**教师讲述：**',
        '[完整口语化文本 ≥ 200 字]',
        '**课堂动作附栏：**',
        '- 教师：...',
        '- 学生：...',
        '...（每页一段，按页号顺序）',
        '',
        `总字数 ≈ ${totalMinutes * 25}（按口语 25 字/分钟），不能短于 ${totalMinutes * 15} 字。`,
      ].join('\n');

      // 组装 user prompt：PPT 骨架（主） + lessonContextText（design + schedule + 素材）
      const userPromptParts = [];
      if (pptSkeletonText) {
        userPromptParts.push(pptSkeletonText);
        userPromptParts.push('');
      } else {
        userPromptParts.push('⚠ 当前没有已生成的 PPT 大纲。请回 PPT 阶段先生成 + 确认 PPT，再回来生成讲稿。');
        userPromptParts.push('（无 PPT 时本次按教学设计 5 段法兜底，但讲稿质量会打折）');
        userPromptParts.push('');
      }
      userPromptParts.push(lessonContextText);
      const userPrompt = userPromptParts.join('\n').slice(0, 14000);

      let draftScript = '';
      try {
        draftScript = await aiClient.chatJson({
          systemPrompt,
          userPrompt,
          temperature: 0.5,
          maxTokens: 12000,   // D6.1：扩 token，让 21 页讲稿一次出完
          asText: true,
        });
      } catch (e) {
        return { success: false, error: `AI 生成讲稿失败：${e.message}` };
      }
      if (!draftScript || String(draftScript).trim().length < 200) {
        return { success: false, error: 'AI 返回的讲稿过短，请检查 PPT 骨架 + 辅助素材是否完整' };
      }

      return {
        success: true,
        data: {
          draftScript: String(draftScript).trim(),
          lessonMeta,
          // D6.1：返回元数据供 UI 显示
          pptPageCount: pptOutline?.pages?.length || 0,
          referenceCount: referenceMaterials.length,
          designLoaded: Boolean(designData),
          referenceFilterAudit,
        },
      };
    } catch (e) {
      console.error('[v2:lessonGenerateDraft] 异常：', e);
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
      // P1.1（2026-05-17）：新流程入参从 drafts/preferred 改为 priorDraft（老师改后的 1 稿）
      const priorDraft = String(payload.priorDraft || '').trim();
      if (!priorDraft || priorDraft.length < 200) {
        return { success: false, error: '缺少 priorDraft（老师改后的讲稿草稿），请先点「生成讲稿草稿」并在右栏编辑后再生成正式稿' };
      }
      // 向后兼容：内部包装成 drafts/preferred 喂给现有 retry-loop / formal-generator
      const drafts = { a: priorDraft, b: '', c: '' };
      const preferred = 'a';
      let referenceMaterials = arr(payload.referenceMaterials);
      const aiClient = pickAiClient({ ...payload, _stage: 'lecture_formal' }, db);
      if (!aiClient) return { success: false, error: '未配置有效的 AI 客户端' };

      // 2026-05-15 问题一 B 层：正式稿生成前也做相关性过滤（与 ABC 草稿同策略）
      let referenceFilterAudit = null;
      if (referenceMaterials.length >= 2) {
        try {
          const { filterByRelevance } = require('../../services/reference-filter.service');
          const filterResult = await filterByRelevance({
            aiClient,
            courseName: notebook.name || '课程',
            lessonTopic: lessonMeta.topic || '',
            references: referenceMaterials,
            threshold: 5,
          });
          referenceMaterials = filterResult.filtered;
          referenceFilterAudit = {
            kept: filterResult.filtered.length,
            dropped: filterResult.dropped.length,
            details: filterResult.audit,
            warning: filterResult.warning || null,
          };
          if (filterResult.dropped.length > 0) {
            console.log(`[v2:lessonGenerateFormal] 相关性过滤剔除 ${filterResult.dropped.length} 条离题素材`);
          }
        } catch (filterErr) {
          console.warn('[v2:lessonGenerateFormal] 相关性过滤异常，兜底全保留：', filterErr.message);
        }
      }

      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId }) : [];
      const designData = pickConfirmedDesign(allArtifacts);
      const scheduleData = pickConfirmedSchedule(allArtifacts);

      const lessonHours = (Number(lessonMeta.theoryHours) || 0) + (Number(lessonMeta.practiceHours) || 0);
      // T7 修复（2026-05-17）：lessonHours 必须由 lessonMeta 提供，禁止兜底 4
      if (lessonHours <= 0) {
        return { success: false, error: 'lessonMeta 缺少 theoryHours + practiceHours（请确认本节课学时分配，不能为 0）' };
      }
      // T8 修复（2026-05-17）：从 notebook 读 minutesPerHour
      const lessonMinutesPerHour2 = Number(notebook?.minutesPerHour) || 0;
      if (lessonMinutesPerHour2 <= 0) {
        return { success: false, error: '笔记本未设置"1 学时分钟数"（minutesPerHour）。请在创建/编辑笔记本时填写学校标准（如 40 / 45 / 50）。' };
      }
      const lessonContextText = buildLessonContextText({
        lessonMeta, scheduleData, designData, referenceMaterials,
        courseName: notebook.name || '课程',
        minutesPerHour: lessonMinutesPerHour2,
      });

      const notebookContext = {
        // 2026-05-15 加固问题一 D：注入 courseName 给 review.service 用于"主题相关度"审核（维度 10）
        courseName: notebook.name || '课程',
        softwareTools: notebook.softwareTools || '',
        jobTargets: notebook.jobTargets || '',
        industryScenarios: notebook.industryScenarios || '',
        learnerProfile: notebook.learnerProfile || '',
        frameworkObjectives: '',
        frameworkTeachingMethods: '',
        referenceContext: lessonContextText.slice(0, 6000),
        // Phase-8.5：注入 totalHours 给 review.service 用于"课时连贯性"审核（维度 8）
        totalHours: lessonHours,                          // T7
        minutesPerHour: lessonMinutesPerHour2,            // T8
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
            hours: lessonHours,                           // T7
            description: lessonMeta.topic || '',
          }],
          aiClient,
          totalHours: lessonHours,                        // T7
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
          referenceFilterAudit,   // 2026-05-15 加固问题一 B：相关性过滤审计明细
          // 质量元数据（前端可显示给老师）
          qualityMeta: {
            attempts,                              // 重试次数
            exhausted,                             // 是否耗尽重试仍不达标
            retryQuality,                          // 最后一次质量评分
            reviewScore: reviewMeta?.score || null,
            reviewSubscores: reviewMeta?.subscores || null,
            reviewSuggestions: reviewMeta?.suggestions || [],
            // 2026-05-15 v4.1.4：把 review issues 也带给前端，否则老师看不到 AI 具体指出哪里有问题
            reviewIssues: Array.isArray(reviewMeta?.issues) ? reviewMeta.issues : [],
            reviewSummary: reviewMeta?.summary || '',
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

      // 2026-05-16 v4.1.4 老师反馈："已确认但进度 0/36"
      //   根因：原版用整体 metadata 替换，前端如果以"空表单"触发 save，
      //   metadata.lessonNumber/topic/theoryHours 全部归零，title 字段却保留旧值 → 数据不一致。
      //   修法：① 取出已存 metadata 做 base；② 用 payload 的字段做 patch；③ 空字符串 / 0 不覆盖非零原值。
      const existingArtifact = lessonId
        ? (typeof db.listArtifacts === 'function'
            ? db.listArtifacts({ notebookId }).find((a) => Number(a.id) === Number(lessonId))
            : null)
        : null;
      const existingMeta = existingArtifact?.metadata || {};

      const pickNum = (next, prev) => {
        const n = Number(next);
        if (Number.isFinite(n) && n > 0) return n;
        return Number(prev) || 0;
      };
      const pickStr = (next, prev) => {
        const s = String(next || '').trim();
        return s || String(prev || '').trim();
      };

      const metadata = {
        lessonNumber: pickNum(lessonMeta.lessonNumber, existingMeta.lessonNumber) || 1,
        topic: pickStr(lessonMeta.topic, existingMeta.topic),
        chapter: pickStr(lessonMeta.chapter, existingMeta.chapter),
        theoryHours: pickNum(lessonMeta.theoryHours, existingMeta.theoryHours),
        practiceHours: pickNum(lessonMeta.practiceHours, existingMeta.practiceHours),
        weekRange: pickStr(lessonMeta.weekRange, existingMeta.weekRange),
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
    const { db, syncWorkflowStageAvailability } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const lessonId = Number(payload.lessonId);
      if (!Number.isFinite(lessonId) || lessonId <= 0) return { success: false, error: 'lessonId 无效' };
      if (typeof db.updateArtifact !== 'function') return { success: false, error: 'db.updateArtifact 不存在' };
      const updated = db.updateArtifact(lessonId, {
        confirmed: true,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });
      // D9.1（2026-05-18）：per-lesson confirm 后必须触发 stage 解锁重新计算
      //   旧 BUG：只翻 artifact.confirmed，但 workflowState.unlockedStages 不更新 → 下游永远等不到信号
      const notebookId = Number(updated?.notebookId || payload.notebookId);
      if (Number.isFinite(notebookId) && notebookId > 0 && typeof syncWorkflowStageAvailability === 'function') {
        try {
          syncWorkflowStageAvailability(notebookId, { preferredStage: 'video' });
          console.log(`[v2:lessonConfirm] 已触发 stage unlock 重算（notebookId=${notebookId}）`);
        } catch (syncErr) {
          console.warn('[v2:lessonConfirm] syncWorkflowStageAvailability 失败:', syncErr.message);
        }
      }
      return { success: true, data: { lessonId, confirmed: true } };
    } catch (e) {
      console.error('[v2:lessonConfirm] 异常：', e);
      return { success: false, error: e.message };
    }
  });

  // ── D9.3（2026-05-18）：手动强制解锁下游 ─────────────────────────────────────
  //   场景：质量校验误报 / 老师确认通过但 unlockedStages 没刷新 / 老师明确想跳过门槛
  //   接受 reason 字段写日志，但不阻塞操作
  ipcMain.handle('v2:forceUnlockNextStage', async (event, payload = {}) => {
    const { db, syncWorkflowStageAvailability } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const fromStage = String(payload.fromStage || '').trim();
      const reason = String(payload.reason || '老师手动强制解锁').trim();
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      if (!fromStage) return { success: false, error: 'fromStage 必填（如 lecture / ppt）' };
      const STAGE_ORDER = ['schedule', 'design', 'ppt', 'lecture', 'video', 'report'];
      const idx = STAGE_ORDER.indexOf(fromStage);
      if (idx < 0 || idx >= STAGE_ORDER.length - 1) {
        return { success: false, error: `fromStage 无效或已是末尾阶段：${fromStage}` };
      }
      const nextStage = STAGE_ORDER[idx + 1];

      // 1. 找到 fromStage 对应的"被需要的产物 type"——伪造一个 confirmed=true 的"占位 artifact"
      //    用 force_unlock_marker 类型，不污染真实产物
      const STAGE_PRODUCT = {
        ppt: 'ppt_outline',
        lecture: 'lecture_final',
        design: 'design_doc',
        video: 'video_prompt',
        schedule: 'schedule_table',
      };
      const productType = STAGE_PRODUCT[fromStage];
      if (!productType) return { success: false, error: `不支持强制解锁 from ${fromStage}` };

      // 2. 检查是否已有 confirmed 产物——如果有，无需写占位
      const items = db.listArtifacts({ notebookId }) || [];
      const alreadyConfirmed = items.some((a) => a.type === productType && a.stage === fromStage && a.confirmed === true);

      if (!alreadyConfirmed) {
        // 写一个最小占位产物，明确标 forceUnlocked=true 以便审计
        db.createArtifact({
          notebookId,
          type: productType,
          stage: fromStage,
          title: `[强制解锁占位] ${fromStage} → ${nextStage}`,
          content: { _forceUnlocked: true, reason, createdAt: new Date().toISOString() },
          confirmed: true,
          status: 'confirmed',
          metadata: { forceUnlocked: true, reason, fromStage, nextStage },
        });
        console.warn(`[v2:forceUnlockNextStage] 写占位 confirmed artifact（${productType}）解锁 ${nextStage}（reason: ${reason}）`);
      }

      // 3. 触发 stage availability 重算
      if (typeof syncWorkflowStageAvailability === 'function') {
        syncWorkflowStageAvailability(notebookId, { preferredStage: nextStage });
      }

      return {
        success: true,
        data: {
          notebookId,
          fromStage,
          nextStage,
          alreadyConfirmed,
          message: alreadyConfirmed
            ? `${fromStage} 已有确认产物，已重新计算 stage unlock → ${nextStage} 应已解锁`
            : `已写占位产物 + 解锁 ${nextStage}（reason: ${reason}）`,
        },
      };
    } catch (e) {
      console.error('[v2:forceUnlockNextStage] 异常：', e);
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
