/**
 * quiz.service.js — Step 5 在线测验生成（v4.3.3）
 *
 * 设计原则（H14 反模板化）：
 *   - 题目数量来自 PPT 页数（每页 1-2 道题，章节末综合题 1-3 道）
 *   - 不硬编码"7 道题"等魔数
 *   - AI prompt 显式说"基于 PPT 每页讲述要点出题，不允许编造没在 PPT/讲稿出现的事实"
 *
 * 输入：
 *   - pptOutline.pages: PPT 每页内容（title / keyContent / speakerNotes）
 *   - lectureScript: 对应节的正式讲稿（提供更丰富上下文）
 *   - lessonMeta: { lessonNumber, topic, chapter, theoryHours, practiceHours }
 *
 * 输出：QuizSet
 *   {
 *     metadata: { lessonNumber, topic, totalQuestions, generatedAt },
 *     questions: [
 *       {
 *         id, sourcePageNumber, type, // 'single' | 'multiple' | 'judge' | 'fill' | 'short_answer'
 *         stem,                       // 题干
 *         options?: [{ key, text }], // 单选/多选
 *         correctAnswer,              // 答案
 *         explanation,                // 解析
 *         difficulty,                 // 1-5
 *         knowledgePoint,             // 对应 PPT 页 title
 *       }
 *     ]
 *   }
 */

'use strict';

/**
 * 把 PPT pages 转成 AI 看的"出题素材"
 */
function buildQuizSourceContext(pptPages = [], lectureScript = '') {
  const lines = ['═══ PPT 每页内容（用作出题依据，禁止编造未出现的事实）═══', ''];
  pptPages.forEach((p) => {
    const keyContent = Array.isArray(p.keyContent)
      ? p.keyContent.filter(Boolean).join(' · ')
      : String(p.keyContent || '').split('\n').filter(Boolean).join(' · ');
    lines.push(`▶ P${p.pageNumber} 《${p.title || '未命名'}》`);
    if (keyContent) lines.push(`  要点：${keyContent.slice(0, 200)}`);
    if (p.speakerNotes) lines.push(`  讲述：${String(p.speakerNotes).slice(0, 150)}`);
    if (p.dataPoint) lines.push(`  数据：${String(p.dataPoint).slice(0, 100)}`);
    lines.push('');
  });
  if (lectureScript) {
    const excerpt = String(lectureScript).slice(0, 6000);
    lines.push('═══ 讲稿正文（用作出题上下文）═══');
    lines.push(excerpt);
  }
  return lines.join('\n');
}

/**
 * AI 生成测验题
 *
 * @param {Object} params
 * @param {Object} params.aiClient                  - 必填，已配置好的 ARK 客户端
 * @param {Object} params.lessonMeta                - { lessonNumber, topic, chapter, theoryHours, practiceHours }
 * @param {Array<Object>} params.pptPages           - PPT 每页内容数组
 * @param {string} params.lectureScript             - 对应节正式讲稿
 * @param {Object} [params.options]                 - { questionsPerPage, includeComprehensive }
 * @returns {Promise<{success, quizSet, error}>}
 */
async function generateQuizFromPpt({ aiClient, lessonMeta = {}, pptPages = [], lectureScript = '', options = {} }) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    return { success: false, error: 'aiClient 未配置或缺 chatJson 方法' };
  }
  if (!Array.isArray(pptPages) || pptPages.length === 0) {
    return { success: false, error: 'pptPages 为空，无法基于 PPT 骨架出题' };
  }

  const questionsPerPage = Math.max(1, Math.min(3, options.questionsPerPage || 2));
  const includeComprehensive = options.includeComprehensive !== false;
  const expectedQuestionCount = pptPages.length * questionsPerPage + (includeComprehensive ? 3 : 0);

  const systemPrompt = [
    '你是职业教育课堂在线测验出题专家。',
    '出题原则（必须严格遵守）：',
    `1. 基于提供的 ${pptPages.length} 页 PPT 内容，每页出 ${questionsPerPage} 道题（按 sourcePageNumber 标记来源页）。`,
    includeComprehensive ? '2. 末尾再出 2-3 道综合题（跨多页知识点），sourcePageNumber 填 0 表示综合。' : '',
    '3. 题型多样：单选 / 多选 / 判断 / 填空 / 简答（每种至少 1 道）。',
    '4. ❌ 严禁编造 PPT 和讲稿里没出现的事实、数据、案例。',
    '5. ❌ 严禁出"广州纺校 / 周老师 / 23 级"等专属信息（除非 PPT 明确出现）。',
    '6. 难度 1-5：1 容易记忆，3 理解应用，5 综合分析。',
    '7. 每题必须给出 explanation（解析），引用 PPT 第 X 页或讲稿哪段。',
    '',
    '输出格式（严格 JSON，不要任何 markdown 包装）：',
    '{',
    '  "questions": [',
    '    {',
    '      "id": "q1",',
    '      "sourcePageNumber": 1,',
    '      "type": "single",  // single | multiple | judge | fill | short_answer',
    '      "stem": "题干文本",',
    '      "options": [{"key":"A","text":"..."},{"key":"B","text":"..."}],  // 单选/多选必填，其他可省',
    '      "correctAnswer": "A",  // 多选用 "AC" 拼接 · 判断用 "对" / "错" · 填空写答案 · 简答给参考答案',
    '      "explanation": "本题答案来自 PPT 第 1 页的 XX 知识点",',
    '      "difficulty": 2,',
    '      "knowledgePoint": "服装产品传播的定义"',
    '    }',
    '  ]',
    '}',
  ].filter(Boolean).join('\n');

  const userPrompt = [
    `【课程信息】`,
    `课程：${lessonMeta.topic || '未命名'} · 第 ${lessonMeta.lessonNumber || '?'} 节 · ${(lessonMeta.theoryHours || 0) + (lessonMeta.practiceHours || 0)} 学时`,
    lessonMeta.chapter ? `章节：${lessonMeta.chapter}` : '',
    '',
    `【出题要求】`,
    `共 ${expectedQuestionCount} 道题（${pptPages.length} 页 × ${questionsPerPage} ${includeComprehensive ? '+ 3 综合' : ''}）`,
    '',
    buildQuizSourceContext(pptPages, lectureScript),
  ].filter(Boolean).join('\n');

  try {
    const raw = await aiClient.chatJson({
      systemPrompt,
      userPrompt,
      temperature: 0.4,
      maxTokens: 14000,
      responseFormat: true,
    });
    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      // fallback: try to extract { ... } block
      const match = String(raw).match(/\{[\s\S]*\}/);
      if (!match) throw new Error('AI 返回不是有效 JSON');
      parsed = JSON.parse(match[0]);
    }
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    if (questions.length === 0) {
      return { success: false, error: 'AI 返回 0 道题，请检查 PPT 是否有有效内容' };
    }
    // 规范化每道题
    const normalized = questions.map((q, idx) => ({
      id: String(q.id || `q${idx + 1}`),
      sourcePageNumber: Number(q.sourcePageNumber) || 0,
      type: ['single', 'multiple', 'judge', 'fill', 'short_answer'].includes(q.type) ? q.type : 'single',
      stem: String(q.stem || '').trim(),
      options: Array.isArray(q.options) ? q.options.map((o) => ({
        key: String(o.key || '').trim(),
        text: String(o.text || '').trim(),
      })) : [],
      correctAnswer: String(q.correctAnswer || '').trim(),
      explanation: String(q.explanation || '').trim(),
      difficulty: Math.max(1, Math.min(5, Number(q.difficulty) || 2)),
      knowledgePoint: String(q.knowledgePoint || '').trim(),
    })).filter((q) => q.stem.length > 0);

    return {
      success: true,
      quizSet: {
        metadata: {
          lessonNumber: lessonMeta.lessonNumber,
          topic: lessonMeta.topic,
          chapter: lessonMeta.chapter,
          totalQuestions: normalized.length,
          generatedAt: new Date().toISOString(),
        },
        questions: normalized,
      },
    };
  } catch (err) {
    return { success: false, error: `AI 出题失败：${err.message}` };
  }
}

module.exports = {
  generateQuizFromPpt,
  buildQuizSourceContext,
};
