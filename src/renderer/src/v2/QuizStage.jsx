/**
 * QuizStage.jsx — Step 5 在线测验阶段（v4.3.3）
 *
 * 流程：
 *   1. 老师选某节课（下拉，列出本笔记本所有 lecture_final 节课）
 *   2. 点「🤖 生成测验题」→ AI 基于该节 PPT + 讲稿出题
 *   3. 编辑器里可改题（题干/选项/答案/解析）
 *   4. 「💾 保存」「✓ 确认」「📄 导出 Word（学生版 / 答案版）」
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import AssistantStatusAvatar from './AssistantStatusAvatar';

const TYPE_LABEL = {
  single: '单选',
  multiple: '多选',
  judge: '判断',
  fill: '填空',
  short_answer: '简答',
};

const TYPE_COLOR = {
  single: '#3B82F6',
  multiple: '#8B5CF6',
  judge: '#10B981',
  fill: '#F59E0B',
  short_answer: '#EF4444',
};

export default function QuizStage({ selectedNotebookId, api, assistantStatus, setAssistantStatus, busy, onStageDataChanged }) {
  const [lessons, setLessons] = useState([]);                  // 本笔记本所有节课
  const [selectedLesson, setSelectedLesson] = useState(null);  // {lessonNumber, topic, ...}
  const [quizSet, setQuizSet] = useState(null);                // 当前编辑中的测验题集
  const [quizId, setQuizId] = useState(null);                  // 已保存的 quiz artifact id
  const [savedQuizzes, setSavedQuizzes] = useState([]);        // 列表
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  // v4.3.3 codex 复审（2026-05-30）：异步序号防护，快速切换笔记本时丢弃旧请求的迟到响应（对照 V2App loadSeq）。
  const loadSeqRef = useRef(0);

  // v4.3.3 codex 审计修复 #4（2026-05-30）：进入阶段与手动切换节课共用同一"优先 confirmed"选取规则，
  //   避免两条路径加载到不同版本（同节有 confirmed 版 + draft 版时）。
  const pickPreferredQuizByLesson = (list, lessonNo) => {
    const matches = (list || []).filter((q) => q.lessonNumber === lessonNo);
    return matches.find((q) => q.confirmed) || matches[0] || null;
  };

  // ── 加载本节本的所有 lecture artifacts 和已存 quiz 列表 ──
  useEffect(() => {
    if (!selectedNotebookId) return;
    const seq = ++loadSeqRef.current;
    // v4.3.3 codex 审计修复 #3（2026-05-30）：切换笔记本先清空旧状态，避免跨笔记本残留旧节次/旧题集。
    setSelectedLesson(null);
    setQuizSet(null);
    setQuizId(null);
    setSavedQuizzes([]);
    (async () => {
      const lectureRes = await api.lessonListV2(selectedNotebookId);
      if (seq !== loadSeqRef.current) return;  // 已切到别的笔记本，丢弃迟到响应
      let firstLesson = null;
      if (lectureRes?.success) {
        const allLessons = (lectureRes.data?.lessons || []).filter((l) => l.confirmed);
        setLessons(allLessons);
        firstLesson = allLessons[0] || null;
        if (firstLesson) setSelectedLesson(firstLesson);
      } else {
        setLessons([]);
      }
      const quizRes = await api.quizListV2(selectedNotebookId);
      if (seq !== loadSeqRef.current) return;
      const quizzes = quizRes?.success ? (quizRes.data?.quizzes || []) : [];
      setSavedQuizzes(quizzes);
      // v4.3.3 修复（老师测试 2026-05-30）：进入阶段自动加载已存题集内容（优先 confirmed），
      //   否则 quizSet 一直为 null → 面板误显示"该节尚未生成测验题"（其实已保存/已确认）。
      //   没有匹配 artifact 时必须清空编辑区，不残留旧内容（codex #3）。
      const targetNo = firstLesson?.lessonNumber;
      const existing = targetNo != null ? pickPreferredQuizByLesson(quizzes, targetNo) : null;
      if (existing) await loadQuiz(existing.id);
      else { setQuizSet(null); setQuizId(null); }
    })();
  }, [selectedNotebookId]);

  // ── 切换到已存的 quiz ──
  const loadQuiz = async (quizArtifactId) => {
    const res = await api.quizGetV2({ quizId: quizArtifactId });
    if (!res?.success) {
      window.alert(`加载失败：${res?.error || '未知'}`);
      return;
    }
    const quiz = res.data?.quiz;
    setQuizId(quizArtifactId);
    setQuizSet(quiz?.content || null);
    setSelectedLesson({
      id: quiz?.id,
      lessonNumber: quiz?.metadata?.lessonNumber,
      topic: quiz?.metadata?.topic,
    });
  };

  // ── 生成 ──
  const handleGenerate = async () => {
    if (!selectedLesson?.lessonNumber) {
      window.alert('请先选择一节课');
      return;
    }
    setGenerating(true);
    setAssistantStatus(`🤖 AI 正在为第 ${selectedLesson.lessonNumber} 节出题，约 30-60 秒...`);
    try {
      const res = await api.quizGenerateV2({
        notebookId: selectedNotebookId,
        lessonNumber: selectedLesson.lessonNumber,
        options: { questionsPerPage: 2, includeComprehensive: true },
      });
      if (!res?.success) {
        window.alert(`生成失败：${res?.error || '未知'}`);
        setAssistantStatus(`❌ 生成失败：${res?.error || '未知'}`);
        return;
      }
      setQuizSet(res.data?.quizSet || null);
      setQuizId(null);  // 还没保存
      setAssistantStatus(`✅ 已生成 ${res.data?.quizSet?.questions?.length || 0} 道题，请审核 + 保存`);

      // 立即自动保存（D8 思路：生成完就落库）
      await autoSave(res.data?.quizSet);
    } catch (e) {
      window.alert(`异常：${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  // 自动保存
  const autoSave = async (qs) => {
    if (!qs) return;
    try {
      const saveRes = await api.quizSaveV2({
        notebookId: selectedNotebookId,
        quizId: quizId || undefined,
        metadata: {
          lessonNumber: selectedLesson.lessonNumber,
          topic: selectedLesson.topic,
          chapter: qs.metadata?.chapter || '',
        },
        content: qs,
      });
      if (saveRes?.success) {
        setQuizId(saveRes.data?.quizId);
        const list = await api.quizListV2(selectedNotebookId);
        if (list?.success) setSavedQuizzes(list.data?.quizzes || []);
        setAssistantStatus(`✅ 已自动保存（quiz #${saveRes.data?.quizId}）`);
        // v4.3.3 codex 复审（2026-05-30）：保存=撤销确认，通知父级刷新阶段卡/报告解锁/下游 dirty，
        //   避免编辑已确认测验后卡片状态滞后。
        onStageDataChanged?.();
      }
    } catch (e) {
      console.warn('[autoSave]', e);
    }
  };

  const handleSave = async () => {
    if (!quizSet) return;
    setSaving(true);
    try {
      await autoSave(quizSet);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!quizId) { window.alert('请先保存'); return; }
    const res = await api.quizConfirmV2({ quizId, notebookId: selectedNotebookId });
    if (!res?.success) { window.alert(`确认失败：${res?.error || '未知'}`); return; }
    setAssistantStatus('✅ 已确认本节测验');
    const list = await api.quizListV2(selectedNotebookId);
    if (list?.success) setSavedQuizzes(list.data?.quizzes || []);
    // v4.3.3 修复（老师测试 2026-05-30）：确认后通知父级刷新阶段卡 + 报告解锁状态，
    //   否则卡片/报告"还需确认"列表滞后（Bug2/Bug3）。
    onStageDataChanged?.();
  };

  // 编辑单题
  const updateQuestion = (idx, patch) => {
    if (!quizSet) return;
    const next = {
      ...quizSet,
      questions: quizSet.questions.map((q, i) => i === idx ? { ...q, ...patch } : q),
    };
    setQuizSet(next);
  };

  const deleteQuestion = (idx) => {
    if (!quizSet) return;
    if (!window.confirm('删除该题？')) return;
    setQuizSet({ ...quizSet, questions: quizSet.questions.filter((_, i) => i !== idx) });
  };

  // 统计
  const typeStats = useMemo(() => {
    if (!quizSet?.questions) return {};
    const stats = {};
    quizSet.questions.forEach((q) => {
      stats[q.type] = (stats[q.type] || 0) + 1;
    });
    return stats;
  }, [quizSet]);

  return (
    <section className="v2-stage-layout" style={{ display: 'block', minHeight: 'calc(100vh - 200px)' }}>
      <div className="v2-stage-center" style={{ flex: '1 1 auto', minWidth: 0 }}>
        {/* ① 顶部：节课选择 */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>⑤ 在线测验</h3>
            <span className="v2-hint">AI 基于该节 PPT 每页骨架 + 讲稿，每页出 1-2 题 + 综合题</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <label style={{ fontSize: 13, color: '#475569' }}>选择节课：</label>
            <select
              value={selectedLesson?.lessonNumber || ''}
              onChange={(e) => {
                const ln = Number(e.target.value);
                const found = lessons.find((l) => l.lessonNumber === ln);
                setSelectedLesson(found || null);
                // v4.3.3 codex #4：手动切换也用"优先 confirmed"规则，和自动加载一致
                const existing = pickPreferredQuizByLesson(savedQuizzes, ln);
                if (existing) {
                  loadQuiz(existing.id);
                } else {
                  setQuizSet(null);
                  setQuizId(null);
                }
              }}
              style={{ minWidth: 320, padding: '6px 10px', fontSize: 13 }}
            >
              {lessons.length === 0
                ? <option value="">⚠ 上游讲稿阶段没有已确认节课</option>
                : lessons.map((l) => {
                    // v4.3.3 codex 复审：下拉文案与实际加载一致，用"优先 confirmed"那一份（不是第一份 draft）
                    const hasQuiz = pickPreferredQuizByLesson(savedQuizzes, l.lessonNumber);
                    return (
                      <option key={l.id} value={l.lessonNumber}>
                        {hasQuiz ? `✓ ` : ''}第 {l.lessonNumber} 节·{l.topic || '未命名'}
                        {hasQuiz ? ` （${hasQuiz.totalQuestions} 题${hasQuiz.confirmed ? '·已确认' : ''}）` : ''}
                      </option>
                    );
                  })
              }
            </select>
            <button
              className="v2-btn v2-btn-primary"
              onClick={handleGenerate}
              disabled={generating || !selectedLesson || busy}
              style={{ fontSize: 14, padding: '8px 18px' }}
            >
              {generating ? '⏳ 生成中…' : '🤖 生成测验题'}
            </button>
            {quizSet ? (
              <>
                <button className="v2-btn v2-btn-secondary" onClick={handleSave} disabled={saving}>
                  {saving ? '⏳ 保存中…' : '💾 保存'}
                </button>
                <button className="v2-btn v2-btn-secondary" onClick={handleConfirm} disabled={!quizId}>
                  ✓ 确认本节测验
                </button>
              </>
            ) : null}
          </div>

          {assistantStatus ? (
            <div className="v2-status-box v2-field-top-gap">
              <span>助手状态</span>
              <AssistantStatusAvatar stage="quiz" status={assistantStatus} />
            </div>
          ) : null}
        </div>

        {/* ② 题集预览 */}
        {quizSet?.questions?.length > 0 ? (
          <div className="v2-panel">
            <div className="v2-panel-head">
              <h3>📋 题集预览（共 {quizSet.questions.length} 题）</h3>
              <span className="v2-hint">
                {Object.entries(typeStats).map(([t, n]) => `${TYPE_LABEL[t] || t}×${n}`).join(' · ')}
              </span>
            </div>
            <div style={{ marginTop: 12 }}>
              {quizSet.questions.map((q, idx) => (
                <div key={q.id || idx} style={{
                  marginBottom: 14, padding: 12,
                  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{
                      padding: '2px 8px', fontSize: 11, fontWeight: 600,
                      background: TYPE_COLOR[q.type] || '#94A3B8', color: 'white', borderRadius: 3,
                    }}>{TYPE_LABEL[q.type] || q.type}</span>
                    <span style={{ fontSize: 12, color: '#64748B' }}>
                      第 {idx + 1} 题 · 来源 P{q.sourcePageNumber || '综合'} · 难度 {q.difficulty}/5
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8' }}>
                      {q.knowledgePoint}
                    </span>
                    <button
                      onClick={() => deleteQuestion(idx)}
                      style={{ background: 'transparent', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 11 }}
                    >🗑 删除</button>
                  </div>
                  <textarea
                    value={q.stem}
                    onChange={(e) => updateQuestion(idx, { stem: e.target.value })}
                    rows={2}
                    style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid #CBD5E1', borderRadius: 4, marginBottom: 6, boxSizing: 'border-box' }}
                  />
                  {(q.type === 'single' || q.type === 'multiple') && Array.isArray(q.options) ? (
                    <div style={{ marginBottom: 6 }}>
                      {q.options.map((o, oi) => (
                        <div key={oi} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ width: 24, fontWeight: 600, color: '#475569' }}>{o.key}.</span>
                          <input
                            value={o.text}
                            onChange={(e) => {
                              const newOpts = q.options.map((oo, i) => i === oi ? { ...oo, text: e.target.value } : oo);
                              updateQuestion(idx, { options: newOpts });
                            }}
                            style={{ flex: 1, padding: '4px 8px', fontSize: 12, border: '1px solid #E2E8F0', borderRadius: 3 }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                    <label style={{ fontSize: 12, color: '#475569' }}>答案：</label>
                    <input
                      value={q.correctAnswer}
                      onChange={(e) => updateQuestion(idx, { correctAnswer: e.target.value })}
                      style={{ width: 140, padding: '4px 8px', fontSize: 12, border: '1px solid #16A34A', borderRadius: 3, fontWeight: 600, color: '#16A34A' }}
                    />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>解析：</div>
                  <textarea
                    value={q.explanation}
                    onChange={(e) => updateQuestion(idx, { explanation: e.target.value })}
                    rows={2}
                    style={{ width: '100%', padding: 6, fontSize: 12, border: '1px solid #E2E8F0', borderRadius: 3, background: '#F8FAFC', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="v2-panel" style={{ textAlign: 'center', color: '#94A3B8', padding: 40 }}>
            📝 该节尚未生成测验题。点上方「🤖 生成测验题」开始。
          </div>
        )}
      </div>
    </section>
  );
}
