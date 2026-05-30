/**
 * HomeworkStage.jsx — Step 6 课后作业阶段（v4.3.3）
 *
 * 流程：
 *   1. 选节课
 *   2. AI 基于讲稿 + PPT 出 3-5 道课后作业（深度，含 deliverables / evaluationCriteria）
 *   3. 老师可改作业标题/描述/评分标准
 *   4. 保存 + 确认 + 导出 Word
 */

import React, { useState, useEffect, useMemo } from 'react';
import AssistantStatusAvatar from './AssistantStatusAvatar';

const TYPE_LABEL = {
  reading: '📖 阅读延伸',
  short_answer: '✍ 简答题',
  practice: '🛠 实操练习',
  project: '🎯 小组项目',
  research: '🔍 资料搜集',
};

const TYPE_COLOR = {
  reading: '#3B82F6',
  short_answer: '#8B5CF6',
  practice: '#F59E0B',
  project: '#10B981',
  research: '#06B6D4',
};

export default function HomeworkStage({ selectedNotebookId, api, assistantStatus, setAssistantStatus, busy, onStageDataChanged }) {
  const [lessons, setLessons] = useState([]);
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [homeworkSet, setHomeworkSet] = useState(null);
  const [homeworkId, setHomeworkId] = useState(null);
  const [savedHomeworks, setSavedHomeworks] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedNotebookId) return;
    (async () => {
      const lectureRes = await api.lessonListV2(selectedNotebookId);
      let firstLesson = null;
      if (lectureRes?.success) {
        const allLessons = (lectureRes.data?.lessons || []).filter((l) => l.confirmed);
        setLessons(allLessons);
        firstLesson = allLessons[0] || null;
        if (!selectedLesson && firstLesson) {
          setSelectedLesson(firstLesson);
        }
      }
      const hwRes = await api.homeworkListV2(selectedNotebookId);
      const homeworks = hwRes?.success ? (hwRes.data?.homeworks || []) : [];
      setSavedHomeworks(homeworks);
      // v4.3.3 修复（老师测试 2026-05-30）：进入阶段自动加载已存作业内容，
      //   否则 homeworkSet 一直为 null → 面板误显示"该节尚未生成课后作业"（其实已保存/已确认）。
      const targetNo = selectedLesson?.lessonNumber ?? firstLesson?.lessonNumber;
      if (targetNo != null) {
        const matches = homeworks.filter((h) => h.lessonNumber === targetNo);
        const existing = matches.find((h) => h.confirmed) || matches[0];
        if (existing) await loadHomework(existing.id);
      }
    })();
  }, [selectedNotebookId]);

  const loadHomework = async (hwArtifactId) => {
    const res = await api.homeworkGetV2({ homeworkId: hwArtifactId });
    if (!res?.success) {
      window.alert(`加载失败：${res?.error || '未知'}`);
      return;
    }
    const hw = res.data?.homework;
    setHomeworkId(hwArtifactId);
    setHomeworkSet(hw?.content || null);
    setSelectedLesson({
      id: hw?.id,
      lessonNumber: hw?.metadata?.lessonNumber,
      topic: hw?.metadata?.topic,
    });
  };

  const handleGenerate = async () => {
    if (!selectedLesson?.lessonNumber) {
      window.alert('请先选择一节课');
      return;
    }
    setGenerating(true);
    setAssistantStatus(`🤖 AI 正在为第 ${selectedLesson.lessonNumber} 节出作业...`);
    try {
      const res = await api.homeworkGenerateV2({
        notebookId: selectedNotebookId,
        lessonNumber: selectedLesson.lessonNumber,
        options: { taskCount: 4 },
      });
      if (!res?.success) {
        window.alert(`生成失败：${res?.error || '未知'}`);
        setAssistantStatus(`❌ 生成失败：${res?.error || '未知'}`);
        return;
      }
      setHomeworkSet(res.data?.homeworkSet || null);
      setHomeworkId(null);
      setAssistantStatus(`✅ 已生成 ${res.data?.homeworkSet?.tasks?.length || 0} 道作业`);
      await autoSave(res.data?.homeworkSet);
    } catch (e) {
      window.alert(`异常：${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const autoSave = async (hs) => {
    if (!hs) return;
    try {
      const saveRes = await api.homeworkSaveV2({
        notebookId: selectedNotebookId,
        homeworkId: homeworkId || undefined,
        metadata: {
          lessonNumber: selectedLesson.lessonNumber,
          topic: selectedLesson.topic,
          chapter: hs.metadata?.chapter || '',
        },
        content: hs,
      });
      if (saveRes?.success) {
        setHomeworkId(saveRes.data?.homeworkId);
        const list = await api.homeworkListV2(selectedNotebookId);
        if (list?.success) setSavedHomeworks(list.data?.homeworks || []);
        setAssistantStatus(`✅ 已自动保存（homework #${saveRes.data?.homeworkId}）`);
      }
    } catch (e) {
      console.warn('[autoSave]', e);
    }
  };

  const handleSave = async () => {
    if (!homeworkSet) return;
    setSaving(true);
    try { await autoSave(homeworkSet); } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!homeworkId) { window.alert('请先保存'); return; }
    const res = await api.homeworkConfirmV2({ homeworkId, notebookId: selectedNotebookId });
    if (!res?.success) { window.alert(`确认失败：${res?.error || '未知'}`); return; }
    setAssistantStatus('✅ 已确认本节作业');
    const list = await api.homeworkListV2(selectedNotebookId);
    if (list?.success) setSavedHomeworks(list.data?.homeworks || []);
    // v4.3.3 修复（老师测试 2026-05-30）：确认后通知父级刷新阶段卡 + 报告解锁状态（Bug2/Bug3）。
    onStageDataChanged?.();
  };

  const updateTask = (idx, patch) => {
    if (!homeworkSet) return;
    setHomeworkSet({ ...homeworkSet, tasks: homeworkSet.tasks.map((t, i) => i === idx ? { ...t, ...patch } : t) });
  };

  const deleteTask = (idx) => {
    if (!homeworkSet) return;
    if (!window.confirm('删除该作业？')) return;
    setHomeworkSet({ ...homeworkSet, tasks: homeworkSet.tasks.filter((_, i) => i !== idx) });
  };

  const totalMinutes = useMemo(
    () => (homeworkSet?.tasks || []).reduce((s, t) => s + (Number(t.estimatedMinutes) || 0), 0),
    [homeworkSet]
  );

  return (
    <section className="v2-stage-layout" style={{ display: 'block', minHeight: 'calc(100vh - 200px)' }}>
      <div className="v2-stage-center" style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>⑥ 课后作业</h3>
            <span className="v2-hint">AI 基于讲稿 + PPT 出 3-5 道课后作业，每学时 30-60 分钟练习量</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <label style={{ fontSize: 13, color: '#475569' }}>选择节课：</label>
            <select
              value={selectedLesson?.lessonNumber || ''}
              onChange={(e) => {
                const ln = Number(e.target.value);
                const found = lessons.find((l) => l.lessonNumber === ln);
                setSelectedLesson(found || null);
                const existing = savedHomeworks.find((h) => h.lessonNumber === ln);
                if (existing) {
                  loadHomework(existing.id);
                } else {
                  setHomeworkSet(null);
                  setHomeworkId(null);
                }
              }}
              style={{ minWidth: 320, padding: '6px 10px', fontSize: 13 }}
            >
              {lessons.length === 0
                ? <option value="">⚠ 上游讲稿阶段没有已确认节课</option>
                : lessons.map((l) => {
                    const hasHw = savedHomeworks.find((h) => h.lessonNumber === l.lessonNumber);
                    return (
                      <option key={l.id} value={l.lessonNumber}>
                        {hasHw ? `✓ ` : ''}第 {l.lessonNumber} 节·{l.topic || '未命名'}
                        {hasHw ? ` （${hasHw.totalTasks} 道${hasHw.confirmed ? '·已确认' : ''}）` : ''}
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
              {generating ? '⏳ 生成中…' : '🤖 生成课后作业'}
            </button>
            {homeworkSet ? (
              <>
                <button className="v2-btn v2-btn-secondary" onClick={handleSave} disabled={saving}>
                  {saving ? '⏳ 保存中…' : '💾 保存'}
                </button>
                <button className="v2-btn v2-btn-secondary" onClick={handleConfirm} disabled={!homeworkId}>
                  ✓ 确认本节作业
                </button>
              </>
            ) : null}
          </div>
          {assistantStatus ? (
            <div className="v2-status-box v2-field-top-gap">
              <span>助手状态</span>
              <AssistantStatusAvatar stage="homework" status={assistantStatus} />
            </div>
          ) : null}
        </div>

        {homeworkSet?.tasks?.length > 0 ? (
          <div className="v2-panel">
            <div className="v2-panel-head">
              <h3>📋 作业题集（共 {homeworkSet.tasks.length} 道 · 总耗时约 {Math.round(totalMinutes / 60 * 10) / 10} 小时）</h3>
              <span className="v2-hint">老师可改标题 / 描述 / 评分要点；学生看到的版本通过「📄 导出 Word」生成</span>
            </div>
            <div style={{ marginTop: 12 }}>
              {homeworkSet.tasks.map((t, idx) => (
                <div key={t.id || idx} style={{
                  marginBottom: 14, padding: 14,
                  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{
                      padding: '3px 10px', fontSize: 12, fontWeight: 600,
                      background: TYPE_COLOR[t.type] || '#94A3B8', color: 'white', borderRadius: 3,
                    }}>{TYPE_LABEL[t.type] || t.type}</span>
                    <input
                      value={t.title}
                      onChange={(e) => updateTask(idx, { title: e.target.value })}
                      style={{ flex: 1, padding: '4px 8px', fontSize: 14, fontWeight: 600, border: '1px solid #CBD5E1', borderRadius: 3 }}
                    />
                    <span style={{ fontSize: 11, color: '#64748B', whiteSpace: 'nowrap' }}>
                      预计 {t.estimatedMinutes} 分钟
                    </span>
                    <button
                      onClick={() => deleteTask(idx)}
                      style={{ background: 'transparent', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 11 }}
                    >🗑 删除</button>
                  </div>
                  <label style={{ fontSize: 12, color: '#475569' }}>详细说明：</label>
                  <textarea
                    value={t.description}
                    onChange={(e) => updateTask(idx, { description: e.target.value })}
                    rows={3}
                    style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid #E2E8F0', borderRadius: 3, marginBottom: 8, boxSizing: 'border-box' }}
                  />
                  <label style={{ fontSize: 12, color: '#475569' }}>需要提交：</label>
                  <input
                    value={t.deliverables}
                    onChange={(e) => updateTask(idx, { deliverables: e.target.value })}
                    style={{ width: '100%', padding: 6, fontSize: 12, border: '1px solid #E2E8F0', borderRadius: 3, marginBottom: 8, boxSizing: 'border-box' }}
                  />
                  <label style={{ fontSize: 12, color: '#475569' }}>评分要点：</label>
                  <textarea
                    value={(t.evaluationCriteria || []).join('\n')}
                    onChange={(e) => updateTask(idx, { evaluationCriteria: e.target.value.split('\n').filter(Boolean) })}
                    rows={2}
                    placeholder="一行一条"
                    style={{ width: '100%', padding: 6, fontSize: 12, border: '1px solid #E2E8F0', borderRadius: 3, background: '#F8FAFC', boxSizing: 'border-box' }}
                  />
                  {t.referenceMaterials?.length > 0 ? (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#64748B' }}>
                      📚 推荐参考：{t.referenceMaterials.join(' · ')}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="v2-panel" style={{ textAlign: 'center', color: '#94A3B8', padding: 40 }}>
            📝 该节尚未生成课后作业。点上方「🤖 生成课后作业」开始。
          </div>
        )}
      </div>
    </section>
  );
}
