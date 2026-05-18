/**
 * homework.service.js — Step 6 课后作业生成（v4.3.3）
 *
 * 与 quiz.service 的差异：
 *   - quiz 是课中即时检测（每页 PPT 1-2 道，多选/判断为主）
 *   - homework 是课后练习（综合应用，少量但深度，简答/实操/调研为主）
 *
 * 输出：HomeworkSet
 *   {
 *     metadata: { lessonNumber, topic, totalTasks, estimatedHours, generatedAt },
 *     tasks: [
 *       {
 *         id, type,                   // 'reading' | 'short_answer' | 'practice' | 'project' | 'research'
 *         title,                      // 作业标题
 *         description,                // 详细说明
 *         deliverables,               // 老师要收什么（PDF/Word/演示等）
 *         estimatedMinutes,           // 预计耗时
 *         knowledgePoints,            // 检验哪些知识点（数组）
 *         evaluationCriteria,         // 评分要点
 *         referenceMaterials,         // 推荐参考资料（不强制）
 *       }
 *     ]
 *   }
 */

'use strict';

function buildHomeworkContext(pptPages = [], lectureScript = '') {
  const lines = ['═══ PPT 骨架 + 讲稿要点（作业基于此设计）═══', ''];
  pptPages.forEach((p) => {
    const keyContent = Array.isArray(p.keyContent)
      ? p.keyContent.filter(Boolean).join(' · ')
      : String(p.keyContent || '').split('\n').filter(Boolean).join(' · ');
    lines.push(`▶ P${p.pageNumber} 《${p.title || '未命名'}》`);
    if (keyContent) lines.push(`  要点：${keyContent.slice(0, 200)}`);
    lines.push('');
  });
  if (lectureScript) {
    lines.push('═══ 讲稿正文 ═══');
    lines.push(String(lectureScript).slice(0, 5000));
  }
  return lines.join('\n');
}

async function generateHomeworkFromLecture({ aiClient, lessonMeta = {}, pptPages = [], lectureScript = '', options = {} }) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    return { success: false, error: 'aiClient 未配置或缺 chatJson 方法' };
  }
  if ((!Array.isArray(pptPages) || pptPages.length === 0) && !lectureScript) {
    return { success: false, error: 'pptPages 和 lectureScript 都为空，无素材出作业' };
  }

  const taskCount = Math.max(2, Math.min(6, options.taskCount || 4));
  const lessonHours = (Number(lessonMeta.theoryHours) || 0) + (Number(lessonMeta.practiceHours) || 0);
  // 作业总耗时建议 = 课堂学时 × 30-60 分钟（每学时课后 30-60 分钟练习是合理量）
  const targetMinutesMin = Math.round(lessonHours * 30);
  const targetMinutesMax = Math.round(lessonHours * 60);

  const systemPrompt = [
    '你是职业教育课后作业设计专家。',
    '设计原则（必须严格遵守）：',
    `1. 共出 ${taskCount} 道作业，覆盖本节核心知识点。`,
    `2. 总耗时建议 ${targetMinutesMin}-${targetMinutesMax} 分钟（本节 ${lessonHours} 学时，每学时课后 30-60 分钟练习）。`,
    '3. 题型组合（必须包含 ≥ 3 种）：',
    '   - reading（阅读延伸）',
    '   - short_answer（简答 / 思考题）',
    '   - practice（实操 · 软件操作 / 案例分析）',
    '   - project（小组项目 / 实地调研）',
    '   - research（资料搜集 / 行业研究）',
    '4. 必须给出 deliverables（要求老师收到的产物形式）。',
    '5. 必须给出 evaluationCriteria（评分要点 ≥ 3 条）。',
    '6. ❌ 严禁编造 PPT 和讲稿没出现的事实。',
    '7. ❌ 严禁出"广州纺校 / 周老师"等专属信息（除非 PPT 出现）。',
    '',
    '输出格式（严格 JSON）：',
    '{',
    '  "tasks": [',
    '    {',
    '      "id": "hw1",',
    '      "type": "reading",',
    '      "title": "阅读最新行业报告并撰写要点摘要",',
    '      "description": "详细说明",',
    '      "deliverables": "Word 文档 · 300-500 字摘要 + 3 条个人启发",',
    '      "estimatedMinutes": 60,',
    '      "knowledgePoints": ["服装产品传播的传播媒介演变"],',
    '      "evaluationCriteria": ["要点是否完整", "个人见解深度", "格式规范"],',
    '      "referenceMaterials": ["《服装产业蓝皮书 2026》", "巨量算数行业报告"]',
    '    }',
    '  ]',
    '}',
  ].filter(Boolean).join('\n');

  const userPrompt = [
    `【课程信息】`,
    `课程：${lessonMeta.topic || '未命名'} · 第 ${lessonMeta.lessonNumber || '?'} 节 · ${lessonHours} 学时`,
    lessonMeta.chapter ? `章节：${lessonMeta.chapter}` : '',
    '',
    buildHomeworkContext(pptPages, lectureScript),
  ].filter(Boolean).join('\n');

  try {
    const raw = await aiClient.chatJson({
      systemPrompt,
      userPrompt,
      temperature: 0.5,
      maxTokens: 8000,
      responseFormat: true,
    });
    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      const match = String(raw).match(/\{[\s\S]*\}/);
      if (!match) throw new Error('AI 返回不是有效 JSON');
      parsed = JSON.parse(match[0]);
    }
    const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    if (tasks.length === 0) {
      return { success: false, error: 'AI 返回 0 道作业' };
    }
    const normalized = tasks.map((t, idx) => ({
      id: String(t.id || `hw${idx + 1}`),
      type: ['reading', 'short_answer', 'practice', 'project', 'research'].includes(t.type) ? t.type : 'short_answer',
      title: String(t.title || '').trim(),
      description: String(t.description || '').trim(),
      deliverables: String(t.deliverables || '').trim(),
      estimatedMinutes: Math.max(5, Math.min(240, Number(t.estimatedMinutes) || 30)),
      knowledgePoints: Array.isArray(t.knowledgePoints) ? t.knowledgePoints.filter(Boolean).map(String) : [],
      evaluationCriteria: Array.isArray(t.evaluationCriteria) ? t.evaluationCriteria.filter(Boolean).map(String) : [],
      referenceMaterials: Array.isArray(t.referenceMaterials) ? t.referenceMaterials.filter(Boolean).map(String) : [],
    })).filter((t) => t.title.length > 0);

    const totalMinutes = normalized.reduce((s, t) => s + t.estimatedMinutes, 0);
    return {
      success: true,
      homeworkSet: {
        metadata: {
          lessonNumber: lessonMeta.lessonNumber,
          topic: lessonMeta.topic,
          chapter: lessonMeta.chapter,
          totalTasks: normalized.length,
          totalEstimatedMinutes: totalMinutes,
          estimatedHours: Math.round(totalMinutes / 60 * 10) / 10,
          generatedAt: new Date().toISOString(),
        },
        tasks: normalized,
      },
    };
  } catch (err) {
    return { success: false, error: `AI 出作业失败：${err.message}` };
  }
}

module.exports = {
  generateHomeworkFromLecture,
  buildHomeworkContext,
};
