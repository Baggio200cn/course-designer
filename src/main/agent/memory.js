/**
 * memory.js — Agent 跨会话记忆模块（Phase-5C Step 4）
 *
 * 职责：
 *  1. 课程生成成功后，将关键信息存入 agent_memories
 *  2. 新课生成前，通过关键词匹配找到相似历史课程
 *  3. 将历史成功经验格式化为 Prompt 注入上下文（few-shot 参考）
 *
 * 设计原则：
 *  - 纯关键词匹配（无向量库，零新依赖）
 *  - 同一 notebookId 只保留最新一条（upsert 语义）
 *  - 全局最多 50 条（防止 JSON 文件膨胀）
 *  - Prompt 注入时最多引用 3 条相似历史课程
 *  - 提取函数纯函数，可独立测试
 */

const MAX_MEMORIES = 50;       // 全局上限
const MAX_CONTEXT_ITEMS = 3;   // 注入 Prompt 时最多 N 条

// ── 关键词提取 ────────────────────────────────────────────────────────────────

/**
 * 从课程信息中提取检索关键词
 * 取2字以上的词，去重。
 *
 * @param {Object} notebook
 * @returns {string[]}
 */
function extractKeywords(notebook) {
  const text = [
    notebook.name || '',
    notebook.description || '',
    notebook.jobTargets || '',
    notebook.industryScenarios || '',
    notebook.softwareTools || '',
    notebook.grade || ''
  ].join(' ');

  const words = text
    .replace(/[，。！？、；：""''【】「」（）()[\]{}<>《》\s]/g, ' ')
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);

  return [...new Set(words)];
}

// ── 相似度评分 ────────────────────────────────────────────────────────────────

/**
 * 计算记忆条目与当前课程的相似度分（0-100）
 * 综合关键词 Jaccard 重叠（60分）+ 学时接近度（40分）
 *
 * @param {Object} memory - agent_memories 中的一条记录
 * @param {Object} notebook - 当前课程对象
 * @returns {number}
 */
function scoreSimilarity(memory, notebook) {
  const currentKws = new Set(extractKeywords(notebook));
  const memKws = Array.isArray(memory.keywords) ? memory.keywords : [];

  const overlapCount = memKws.filter((k) => currentKws.has(k)).length;
  const unionCount = new Set([...currentKws, ...memKws]).size;
  const jaccardScore = unionCount > 0 ? (overlapCount / unionCount) * 60 : 0;

  // 学时接近度：差距 0 得40分，每差 1 学时扣 2 分，最低 0 分
  const hoursDiff = Math.abs((memory.totalHours || 0) - (notebook.totalHours || 0));
  const hoursScore = Math.max(0, 40 - hoursDiff * 2);

  return Math.round(jaccardScore + hoursScore);
}

// ── 持久化操作 ────────────────────────────────────────────────────────────────

/**
 * 保存一条成功生成记忆（upsert：同 notebookId 只保留最新）
 *
 * @param {Object} db - DatabaseManager 实例（需实现 saveAgentMemory）
 * @param {number} notebookId
 * @param {Object} successData
 * @param {string} successData.frameworkObjectives   - 框架教学目标摘要
 * @param {string} successData.frameworkTeachingMethods - 框架教学方法摘要
 * @param {number} successData.lectureCharCount       - 最终讲稿字数
 * @param {string} [successData.styleHints]           - 本次有效的风格提示（可选）
 */
function saveMemory(db, notebookId, successData) {
  if (typeof db.saveAgentMemory !== 'function') {
    console.log('[memory] db.saveAgentMemory 未实现，跳过记忆保存');
    return;
  }

  const notebook = db.getNotebookById(notebookId);
  if (!notebook) return;

  const entry = {
    notebookId,
    courseName: notebook.name || '',
    courseCode: notebook.courseCode || '',
    totalHours: Number(notebook.totalHours) || 0,
    keywords: extractKeywords(notebook),
    frameworkObjectives: successData.frameworkObjectives || '',
    frameworkTeachingMethods: successData.frameworkTeachingMethods || '',
    lectureCharCount: Number(successData.lectureCharCount) || 0,
    styleHints: successData.styleHints || '',
    savedAt: new Date().toISOString(),
    version: 1
  };

  db.saveAgentMemory(entry);
  console.log(`[memory] 已保存《${entry.courseName}》记忆，关键词 ${entry.keywords.length} 个`);
}

// ── 检索 ──────────────────────────────────────────────────────────────────────

/**
 * 查找与当前课程最相似的历史成功记忆
 * 排除自身、过滤低分、按相似度降序
 *
 * @param {Object} db
 * @param {Object} notebook - 当前课程对象（含 id, name, totalHours 等）
 * @param {number} [limit=MAX_CONTEXT_ITEMS]
 * @returns {Array} - 相似记忆列表（含 _score 字段）
 */
function findSimilarMemories(db, notebook, limit = MAX_CONTEXT_ITEMS) {
  if (typeof db.getAgentMemories !== 'function') return [];

  const memories = db.getAgentMemories();
  if (!memories || memories.length === 0) return [];

  const candidates = memories.filter((m) => m.notebookId !== notebook.id);

  return candidates
    .map((m) => ({ ...m, _score: scoreSimilarity(m, notebook) }))
    .filter((m) => m._score > 5)       // 过滤无关课程
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

// ── Prompt 上下文格式化 ───────────────────────────────────────────────────────

/**
 * 将相似历史记忆格式化为可直接注入 Prompt 的多行文本
 * 无相似记忆时返回空字符串（调用方自行判断是否附加）
 *
 * @param {Object} db
 * @param {Object} notebook - 当前课程对象
 * @returns {string}
 */
function buildMemoryContext(db, notebook) {
  const memories = findSimilarMemories(db, notebook);
  if (memories.length === 0) return '';

  const lines = memories.map((m, idx) => {
    const hoursInfo = m.totalHours > 0 ? `${m.totalHours}学时` : '';
    const charInfo = m.lectureCharCount > 0 ? `讲稿约${m.lectureCharCount}字` : '';
    const meta = [hoursInfo, charInfo].filter(Boolean).join('，');

    const objectives = m.frameworkObjectives
      ? `教学目标：${m.frameworkObjectives.slice(0, 80)}${m.frameworkObjectives.length > 80 ? '…' : ''}`
      : '';
    const methods = m.frameworkTeachingMethods
      ? `教学方法：${m.frameworkTeachingMethods.slice(0, 60)}${m.frameworkTeachingMethods.length > 60 ? '…' : ''}`
      : '';
    const hints = m.styleHints
      ? `生成经验：${m.styleHints.slice(0, 80)}${m.styleHints.length > 80 ? '…' : ''}`
      : '';

    const details = [objectives, methods, hints].filter(Boolean).join('；');
    return `  参考${idx + 1}：《${m.courseName}》（${meta}）\n    ${details}`;
  });

  return `[历史相似课程参考——仅供风格借鉴，不得直接复制内容]\n${lines.join('\n')}`;
}

module.exports = { saveMemory, findSimilarMemories, buildMemoryContext, extractKeywords };
