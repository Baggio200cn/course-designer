/**
 * LectureStage — 课堂讲稿阶段（驭课 Agent v4.0.0 / Phase-9 多节课模式）
 *
 * 与老 v3.x 区别：
 *   - 老：1 份讲稿覆盖整门课
 *   - 新：N 份讲稿，每份对应 1 节课（≤ 4 学时，理论+实践拼配）
 *
 * UI 结构：
 *   ① 顶部 tab 条：第 1 节 | 第 2 节 | + 新建节课  + 学时进度
 *   ② 本节基础信息：主题（可拉进度表）、理论/实践学时、关联章节
 *   ③ 教学素材辅助生成（保留）：URL / 上传 / 粘贴
 *   ④ A/B/C 候选 → 正式稿 → 确认 → 导出
 */
import React, { useState, useEffect, useMemo } from 'react';
import ArtifactPanel from './ArtifactPanel';

const DEFAULT_LESSON = {
  lessonNumber: 1,
  topic: '',
  chapter: '',
  theoryHours: 2,
  practiceHours: 2,
  weekRange: '',
  referenceMaterials: [],   // [{kind:'url'|'file'|'text', url?, filename?, content}]
  drafts: { a: '', b: '', c: '' },
  selectedDraft: 'a',
  finalScript: '',
  audit: null,
};

const DRAFT_META = {
  a: { title: 'A 稿', emphasis: '知识逻辑型', hint: '侧重知识主线与判断依据' },
  b: { title: 'B 稿', emphasis: '互动场景型', hint: '侧重案例 / 提问 / 学生参与' },
  c: { title: 'C 稿', emphasis: '实操精简型', hint: '侧重操作步骤与实训要点' },
};

export default function LectureStage({
  selectedNotebookId,
  api,
  assistantStatus,
  setAssistantStatus,
  busy,
  courseName = '',
  totalCourseHours = 72,
  scheduleData = null,         // 进度表 artifact 内容（用于"主题从进度表拉"）
  designData = null,
  artifacts = [],
  dt,
  shorten,
}) {
  // ── 节课列表 + 当前编辑节课 ─────────────────────────────────────
  const [lessons, setLessons] = useState([]);     // [{id, lessonNumber, topic, theoryHours, ...}]
  const [usedHours, setUsedHours] = useState(0);
  const [currentLessonId, setCurrentLessonId] = useState(null);   // 编辑中的节课 artifact id；null=新建
  const [lessonForm, setLessonForm] = useState({ ...DEFAULT_LESSON });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refUrlInput, setRefUrlInput] = useState('');
  const [refTextInput, setRefTextInput] = useState('');
  // 老师手搓正式稿专用 state
  const [showManualPaste, setShowManualPaste] = useState(false);
  const [manualPasteText, setManualPasteText] = useState('');

  // ── 拉节课列表 ─────────────────────────────────────────────────
  const refreshLessons = async () => {
    if (!selectedNotebookId) return;
    const res = await api.lessonListV2(selectedNotebookId);
    if (res?.success) {
      setLessons(res.data.lessons || []);
      setUsedHours(res.data.usedHours || 0);
    }
  };
  useEffect(() => { refreshLessons(); }, [selectedNotebookId]);

  // ── 切换 / 加载节课 ─────────────────────────────────────────────
  const loadLesson = async (lessonId) => {
    if (!lessonId) {
      // "新建一节" → 重置为默认，lessonNumber = 已有数 + 1
      setCurrentLessonId(null);
      const nextNo = (lessons[lessons.length - 1]?.lessonNumber || 0) + 1;
      setLessonForm({ ...DEFAULT_LESSON, lessonNumber: nextNo });
      return;
    }
    setLoading(true);
    try {
      const res = await api.lessonGetV2({ lessonId });
      if (res?.success) {
        const l = res.data.lesson;
        setCurrentLessonId(l.id);
        setLessonForm({
          lessonNumber: l.metadata?.lessonNumber || 1,
          topic: l.metadata?.topic || '',
          chapter: l.metadata?.chapter || '',
          theoryHours: l.metadata?.theoryHours || 2,
          practiceHours: l.metadata?.practiceHours || 2,
          weekRange: l.metadata?.weekRange || '',
          referenceMaterials: l.content?.referenceMaterials || [],
          drafts: l.content?.drafts || { a: '', b: '', c: '' },
          selectedDraft: l.content?.selectedDraft || 'a',
          finalScript: l.content?.finalScript || '',
          audit: l.content?.audit || null,
          confirmed: l.confirmed,
        });
      }
    } finally { setLoading(false); }
  };

  // ── 学时校验（只警告，不拦截）─────────────────────────────────
  const lessonHours = (Number(lessonForm.theoryHours) || 0) + (Number(lessonForm.practiceHours) || 0);
  const willExceed = useMemo(() => {
    // 已确认节课累计学时 + 当前节课学时（如果当前是新建则直接加；如果是已存在则扣旧值）
    const existingHours = currentLessonId
      ? (lessons.find((l) => l.id === currentLessonId)
          ? (lessons.find((l) => l.id === currentLessonId).theoryHours + lessons.find((l) => l.id === currentLessonId).practiceHours)
          : 0)
      : 0;
    return (usedHours - existingHours + lessonHours) > totalCourseHours;
  }, [usedHours, lessonHours, currentLessonId, lessons, totalCourseHours]);

  // ── 进度表"拉取主题"下拉 ───────────────────────────────────────
  const scheduleRows = scheduleData?.schedule || [];
  const chaptersFromSchedule = useMemo(() => {
    const set = new Set();
    scheduleRows.forEach((r) => { if (r.chapter) set.add(r.chapter); });
    return Array.from(set);
  }, [scheduleRows]);
  const onPickFromSchedule = (chapter) => {
    if (!chapter) return;
    // 找该章节下第一行的 content / week 作为主题/周次
    const firstRow = scheduleRows.find((r) => r.chapter === chapter);
    if (firstRow) {
      setLessonForm((prev) => ({
        ...prev,
        chapter,
        topic: firstRow.content || prev.topic,
        weekRange: `第 ${firstRow.week} 周`,
      }));
    }
  };

  // ── 素材抓取 ──────────────────────────────────────────────────
  // URL 清洗：剥离第一个分隔符（空格/分号/逗号/换行）后的内容，避免老师粘贴多个 URL
  const sanitizeUrl = (raw) => {
    const trimmed = String(raw || '').trim();
    // 取第一个 http(s):// 开头到第一个非法字符前的子串
    const match = trimmed.match(/^https?:\/\/[^\s;,\n]+/);
    return match ? match[0] : trimmed.split(/[\s;,\n]/)[0];
  };

  const fetchUrl = async () => {
    const cleanUrl = sanitizeUrl(refUrlInput);
    if (!cleanUrl) return;
    if (!/^https?:\/\//i.test(cleanUrl)) {
      window.alert('URL 必须以 http:// 或 https:// 开头');
      return;
    }
    if (cleanUrl !== refUrlInput.trim()) {
      // 老师粘贴了带分号/空格/多 URL 的内容，告知已自动处理
      const ok = window.confirm(
        `检测到输入包含多个 URL 或额外字符。\n\n实际抓取：${cleanUrl}\n\n是否继续？（多个 URL 请分次添加）`
      );
      if (!ok) return;
    }
    setAssistantStatus('正在抓取 URL...');
    const res = await api.fetchUrlContent(cleanUrl);
    if (!res?.success) {
      const errMsg = res?.error || '未知';
      const fallback = window.confirm(
        `抓取失败：${errMsg}\n\n` +
        `常见原因：\n` +
        `  · 该网站需要 JS 渲染（SPA 站如 britannica/medium）\n` +
        `  · 网站封锁了非浏览器请求\n` +
        `  · 网络超时或代理问题\n\n` +
        `建议改用以下方式：\n` +
        `  1. 浏览器手动打开 → 复制正文 → 粘贴到下方"粘贴参考文本"框\n` +
        `  2. 下载为 PDF/DOCX → 用"📎 上传文件"按钮\n\n` +
        `点确定关闭此提示，去试备选方式；点取消保留本 URL 输入。`
      );
      if (fallback) {
        setRefUrlInput('');
        setAssistantStatus('💡 已切换到手动粘贴模式');
      } else {
        setAssistantStatus(`抓取失败：${errMsg}`);
      }
      return;
    }
    setLessonForm((prev) => ({
      ...prev,
      referenceMaterials: [...prev.referenceMaterials, { kind: 'url', url: cleanUrl, content: res.data?.text || '' }],
    }));
    setRefUrlInput('');
    setAssistantStatus(`✅ URL 抓取成功，${(res.data?.text || '').length} 字`);
  };
  const addPastedText = () => {
    if (!refTextInput.trim()) return;
    setLessonForm((prev) => ({
      ...prev,
      referenceMaterials: [...prev.referenceMaterials, { kind: 'text', content: refTextInput.trim() }],
    }));
    setRefTextInput('');
  };
  const onUploadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAssistantStatus('正在解析文件...');
    // 通过现有 readDocxContent IPC 读 .docx；其他类型暂用 FileReader 读文本
    if (file.name.toLowerCase().endsWith('.docx')) {
      const buffer = await file.arrayBuffer();
      const res = await api.readDocxContent({ buffer: Array.from(new Uint8Array(buffer)) });
      if (!res?.success) { window.alert(`解析失败：${res?.error || '未知'}`); return; }
      setLessonForm((prev) => ({
        ...prev,
        referenceMaterials: [...prev.referenceMaterials, { kind: 'file', filename: file.name, content: res.data?.text || '' }],
      }));
      setAssistantStatus(`✅ 文件解析成功，${(res.data?.text || '').length} 字`);
    } else {
      const text = await file.text();
      setLessonForm((prev) => ({
        ...prev,
        referenceMaterials: [...prev.referenceMaterials, { kind: 'file', filename: file.name, content: text }],
      }));
      setAssistantStatus(`✅ 文本文件读取成功，${text.length} 字`);
    }
    e.target.value = '';
  };
  const removeMaterial = (idx) => {
    setLessonForm((prev) => ({
      ...prev,
      referenceMaterials: prev.referenceMaterials.filter((_, i) => i !== idx),
    }));
  };

  // ── 保存（自动给 lessonId 或新建） ─────────────────────────────
  const onSave = async () => {
    if (!selectedNotebookId) return;
    if (!lessonForm.topic.trim()) { window.alert('请填写本节主题'); return; }
    if (willExceed) {
      const ok = window.confirm(`⚠ 本节学时 ${lessonHours} 加上已确认 ${usedHours} 超过总学时 ${totalCourseHours}，是否仍要保存？`);
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await api.lessonSaveV2({
        notebookId: selectedNotebookId,
        lessonId: currentLessonId,
        lessonMeta: {
          lessonNumber: lessonForm.lessonNumber,
          topic: lessonForm.topic,
          chapter: lessonForm.chapter,
          theoryHours: lessonForm.theoryHours,
          practiceHours: lessonForm.practiceHours,
          weekRange: lessonForm.weekRange,
        },
        content: {
          drafts: lessonForm.drafts,
          selectedDraft: lessonForm.selectedDraft,
          finalScript: lessonForm.finalScript,
          referenceMaterials: lessonForm.referenceMaterials,
          audit: lessonForm.audit,
        },
      });
      if (!res?.success) { window.alert(`保存失败：${res?.error || '未知'}`); return; }
      setCurrentLessonId(res.data.lessonId);
      await refreshLessons();
      setAssistantStatus('✅ 本节已保存');
    } finally { setSaving(false); }
  };

  // ── 生成 ABC ─────────────────────────────────────────────────
  const onGenerateABC = async () => {
    if (!selectedNotebookId) return;
    if (!lessonForm.topic.trim()) { window.alert('请先填写本节主题'); return; }
    if (typeof api.lessonGenerateABCV2 !== 'function') {
      window.alert(
        '❌ api.lessonGenerateABCV2 不存在\n\n' +
        '原因：preload 脚本需要重新加载。\n' +
        '解决：完整关闭 Electron 窗口 → 终端 Ctrl+C → 重新 npm run dev'
      );
      return;
    }
    setAssistantStatus('🤖 正在生成 A/B/C 候选稿（约 30-90 秒，请耐心等待）...');
    try {
      const res = await api.lessonGenerateABCV2({
        notebookId: selectedNotebookId,
        lessonMeta: {
          lessonNumber: lessonForm.lessonNumber,
          topic: lessonForm.topic,
          chapter: lessonForm.chapter,
          theoryHours: lessonForm.theoryHours,
          practiceHours: lessonForm.practiceHours,
          weekRange: lessonForm.weekRange,
        },
        referenceMaterials: lessonForm.referenceMaterials,
      });
      if (!res?.success) {
        window.alert(`生成失败：${res?.error || '未知'}\n\n常见原因：\n  · API Key 未配置\n  · AI 模型超时\n  · 上下文超长（素材太多）`);
        setAssistantStatus(`❌ 生成失败：${res?.error || '未知'}`);
        return;
      }
      const drafts = res.data?.drafts || {};
      const has = (drafts.a || '').length + (drafts.b || '').length + (drafts.c || '').length;
      if (has === 0) {
        window.alert('AI 返回了空内容。可能 token 不足或上下文超长，请减少素材后重试');
        setAssistantStatus('❌ AI 返回空内容');
        return;
      }
      setLessonForm((prev) => ({
        ...prev,
        drafts: { a: drafts.a || '', b: drafts.b || '', c: drafts.c || '' },
        audit: drafts.audit || null,
        selectedDraft: 'a',
      }));
      setAssistantStatus(`✅ A/B/C 候选稿已生成（A=${(drafts.a || '').length}字 / B=${(drafts.b || '').length}字 / C=${(drafts.c || '').length}字），请选稿后生成正式稿`);
    } catch (e) {
      console.error('[onGenerateABC] 异常:', e);
      window.alert(`💥 生成异常：${e.message}\n\n查看 DevTools 控制台（F12）获取完整堆栈`);
      setAssistantStatus(`💥 异常：${e.message}`);
    }
  };

  // ── 生成正式稿 ───────────────────────────────────────────────
  const onGenerateFormal = async () => {
    if (!selectedNotebookId) return;
    if (typeof api.lessonGenerateFormalV2 !== 'function') {
      window.alert('❌ api.lessonGenerateFormalV2 不存在 — 需要完整重启 Electron');
      return;
    }
    if (!lessonForm.drafts?.[lessonForm.selectedDraft]) {
      window.alert('请先生成并选择一份候选稿');
      return;
    }
    setAssistantStatus('🤖 正在生成正式稿（约 30-90 秒）...');
    try {
      const res = await api.lessonGenerateFormalV2({
        notebookId: selectedNotebookId,
        lessonMeta: {
          lessonNumber: lessonForm.lessonNumber,
          topic: lessonForm.topic,
          chapter: lessonForm.chapter,
          theoryHours: lessonForm.theoryHours,
          practiceHours: lessonForm.practiceHours,
          weekRange: lessonForm.weekRange,
        },
        drafts: lessonForm.drafts,
        preferred: lessonForm.selectedDraft,
        referenceMaterials: lessonForm.referenceMaterials,
      });
      if (!res?.success) {
        window.alert(`生成失败：${res?.error || '未知'}`);
        setAssistantStatus(`❌ 生成失败：${res?.error || '未知'}`);
        return;
      }
      setLessonForm((prev) => ({
        ...prev,
        finalScript: res.data?.finalScript || '',
        audit: res.data?.audit || prev.audit,
        qualityMeta: res.data?.qualityMeta || null,
      }));
      const q = res.data?.qualityMeta || {};
      const reviewScore = q.reviewScore || 0;
      const subs = q.reviewSubscores || {};
      const subsLine = Object.entries(subs).filter(([k]) => !['score'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' / ');
      setAssistantStatus(
        `✅ 正式稿已生成（${(res.data?.finalScript || '').length}字）｜` +
        `质量分 ${reviewScore || 'N/A'}/10` +
        (q.revisedByReview ? '（AI 已自动修订）' : '') +
        (q.attempts > 1 ? `｜重试 ${q.attempts} 次` : '') +
        (subsLine ? `｜${subsLine}` : '')
      );
    } catch (e) {
      console.error('[onGenerateFormal] 异常:', e);
      window.alert(`💥 异常：${e.message}\n\n查看 DevTools 控制台`);
      setAssistantStatus(`💥 异常：${e.message}`);
    }
  };

  // ── 老师手搓正式稿：粘贴文本 ──────────────────────────────────
  const onApplyManualPaste = () => {
    if (!manualPasteText.trim()) {
      window.alert('请先粘贴正式稿内容');
      return;
    }
    if (lessonForm.finalScript && !window.confirm(`将覆盖现有正式稿（${lessonForm.finalScript.length} 字），确定继续？`)) {
      return;
    }
    setLessonForm((p) => ({
      ...p,
      finalScript: manualPasteText.trim(),
      // 标记这是老师手写版本，清掉 AI 评分（避免误导）
      qualityMeta: { ...p.qualityMeta, manualOverride: true, manualLength: manualPasteText.trim().length },
    }));
    setShowManualPaste(false);
    setManualPasteText('');
    setAssistantStatus(`✅ 已用老师手写稿替换正式稿（${manualPasteText.trim().length} 字），请记得点"💾 保存本节"`);
  };

  // ── 老师手搓正式稿：上传 .docx 文件 ──────────────────────────
  const onUploadFinalScript = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (lessonForm.finalScript && !window.confirm(`将覆盖现有正式稿（${lessonForm.finalScript.length} 字），确定继续？`)) {
      e.target.value = '';
      return;
    }
    setAssistantStatus(`正在解析 ${file.name}...`);
    try {
      let text = '';
      if (file.name.toLowerCase().endsWith('.docx')) {
        const buffer = await file.arrayBuffer();
        const res = await api.readDocxContent({ buffer: Array.from(new Uint8Array(buffer)) });
        if (!res?.success) { window.alert(`解析失败：${res?.error || '未知'}`); return; }
        text = res.data?.text || '';
      } else {
        // .txt / .md 直接读
        text = await file.text();
      }
      if (!text.trim()) { window.alert('文件内容为空'); return; }
      setLessonForm((p) => ({
        ...p,
        finalScript: text.trim(),
        qualityMeta: { ...p.qualityMeta, manualOverride: true, manualSource: file.name, manualLength: text.trim().length },
      }));
      setAssistantStatus(`✅ 已用 ${file.name} 替换正式稿（${text.trim().length} 字），请记得点"💾 保存本节"`);
    } finally {
      e.target.value = '';
    }
  };

  // ── 确认 / 导出 ─────────────────────────────────────────────
  const onConfirm = async () => {
    if (!currentLessonId) { window.alert('请先保存节课，然后再确认'); return; }
    const res = await api.lessonConfirmV2({ lessonId: currentLessonId });
    if (!res?.success) { window.alert(`确认失败：${res?.error || '未知'}`); return; }
    await refreshLessons();
    setAssistantStatus('✅ 本节讲稿已确认');
  };
  const onExportWord = async () => {
    if (!currentLessonId) { window.alert('请先保存节课，然后再导出'); return; }
    setAssistantStatus('正在导出本节讲稿 Word...');
    const res = await api.lessonExportWordV2({ lessonId: currentLessonId });
    if (res?.cancelled) { setAssistantStatus('已取消导出'); return; }
    if (!res?.success) { window.alert(`导出失败：${res?.error || '未知'}`); return; }
    setAssistantStatus(`✅ 已导出：${res.data?.filePath || ''}`);
  };

  // ── 渲染 ─────────────────────────────────────────────────────
  return (
    <section className="v2-stage-layout">
      <div className="v2-stage-center">
        {/* ① 顶部 tab 条 */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>课堂讲稿（多节课模式）</h3>
            <span className="v2-hint">每节课 ≤ 4 学时，可分理论+实践</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {lessons.map((l) => (
              <button
                key={l.id}
                onClick={() => loadLesson(l.id)}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                  background: currentLessonId === l.id ? '#3b82f6' : (l.confirmed ? '#dcfce7' : '#f3f4f6'),
                  color: currentLessonId === l.id ? 'white' : (l.confirmed ? '#166534' : '#374151'),
                  border: currentLessonId === l.id ? 'none' : '1px solid #e5e7eb',
                  fontWeight: currentLessonId === l.id ? 600 : 400,
                }}
                title={`${l.topic || '未命名'} · ${l.theoryHours + l.practiceHours} 学时`}
              >
                {l.confirmed ? '✓ ' : ''}第 {l.lessonNumber} 节
              </button>
            ))}
            <button
              onClick={() => loadLesson(null)}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                background: currentLessonId === null ? '#3b82f6' : 'white',
                color: currentLessonId === null ? 'white' : '#3b82f6',
                border: '1px dashed #3b82f6',
                fontWeight: 600,
              }}
            >+ 新建节课</button>
            <div style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>
              学时进度：<strong style={{ color: usedHours > totalCourseHours ? '#dc2626' : '#16a34a' }}>{usedHours}</strong> / {totalCourseHours}
            </div>
          </div>
          <div className="v2-status-box v2-field-top-gap">
            <span>助手状态</span>
            <strong>{assistantStatus}</strong>
          </div>
        </div>

        {/* Phase-9.5：本节信息来自教学设计阶段（继承） */}
        <div style={{
          marginTop: 8, padding: 10,
          background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 6,
          fontSize: 13, color: '#065f46',
        }}>
          💡 <strong>本节信息建议来自上游"教学设计"阶段</strong>——在教学设计页面已经选了节课主题/学时/章节后，可以直接拷过来或用类似数据生成讲稿；当前界面如有需要也可手改。
        </div>

        {/* ② 本节基础信息 */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>本节基础信息（必填）</h3>
            <span className="v2-hint">主题决定 AI 生成范围；学时影响讲稿详略</span>
          </div>
          <div className="v2-grid-two">
            <div>
              <label className="v2-label">本节主题 <span style={{ color: '#dc2626' }}>*</span></label>
              <input
                value={lessonForm.topic}
                onChange={(e) => setLessonForm((p) => ({ ...p, topic: e.target.value }))}
                placeholder="如：服装产品传播起源与发展历程"
              />
            </div>
            <div>
              <label className="v2-label">关联章节（可从进度表选）</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={lessonForm.chapter}
                  onChange={(e) => setLessonForm((p) => ({ ...p, chapter: e.target.value }))}
                  placeholder="如：一"
                  style={{ flex: 1 }}
                />
                <select
                  onChange={(e) => onPickFromSchedule(e.target.value)}
                  value=""
                  style={{ width: 130 }}
                >
                  <option value="">从进度表拉取...</option>
                  {chaptersFromSchedule.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="v2-label">理论学时</label>
              <input
                type="number" min={0} max={4} step={0.5}
                value={lessonForm.theoryHours}
                onChange={(e) => setLessonForm((p) => ({ ...p, theoryHours: Number(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <label className="v2-label">实践学时</label>
              <input
                type="number" min={0} max={4} step={0.5}
                value={lessonForm.practiceHours}
                onChange={(e) => setLessonForm((p) => ({ ...p, practiceHours: Number(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <label className="v2-label">周次范围（可选）</label>
              <input
                value={lessonForm.weekRange}
                onChange={(e) => setLessonForm((p) => ({ ...p, weekRange: e.target.value }))}
                placeholder="如：第 3-4 周"
              />
            </div>
            <div>
              <label className="v2-label">本节合计</label>
              <input
                value={`${lessonHours} 学时${lessonHours > 4 ? '（⚠ 超 4 学时）' : ''}`}
                disabled
                style={{ color: lessonHours > 4 ? '#dc2626' : '#374151' }}
              />
            </div>
          </div>
          {willExceed ? (
            <div style={{ marginTop: 8, padding: 10, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, fontSize: 13, color: '#92400e' }}>
              ⚠ 本节加上已用 {usedHours} 学时将超总学时 {totalCourseHours}（仅警告，老师可自行调度）
            </div>
          ) : null}
        </div>

        {/* ③ 教学素材 */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>教学素材辅助生成（可选）</h3>
            <span className="v2-hint">URL 抓取 / 文件上传 / 粘贴文本，AI 会与本节主题深度融合</span>
          </div>

          <label className="v2-label">
            输入页面 URL
            <span className="v2-label-hint">一次只能抓 1 个 URL · SPA 站点（britannica/medium 等）建议改用粘贴文本</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={refUrlInput}
              onChange={(e) => setRefUrlInput(e.target.value)}
              placeholder="例：https://www.iyiou.com/news/xxx（一次一个，多个请分次添加）"
              style={{ flex: 1 }}
            />
            <button className="v2-btn v2-btn-secondary" onClick={fetchUrl}>抓取</button>
            <label className="v2-btn v2-btn-secondary" style={{ cursor: 'pointer' }}>
              📎 上传文件
              <input type="file" accept=".docx,.txt,.md" style={{ display: 'none' }} onChange={onUploadFile} />
            </label>
          </div>

          <label className="v2-label v2-field-top-gap">粘贴参考文本</label>
          <textarea
            rows={3}
            value={refTextInput}
            onChange={(e) => setRefTextInput(e.target.value)}
            placeholder="粘贴教案/教材/课标段落，最多 10000 字。点击下方按钮添加到素材列表。"
          />
          <div className="v2-inline-actions v2-field-top-gap">
            <button className="v2-btn v2-btn-secondary" onClick={addPastedText} disabled={!refTextInput.trim()}>
              + 添加到素材列表
            </button>
          </div>

          {lessonForm.referenceMaterials.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>本节素材列表（{lessonForm.referenceMaterials.length}）</h4>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {lessonForm.referenceMaterials.map((m, i) => (
                  <li key={i} style={{ padding: 6, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, marginBottom: 4, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      [{m.kind === 'url' ? '🔗 URL' : m.kind === 'file' ? '📎 文件' : '📝 文本'}]
                      &nbsp;{m.url || m.filename || `（${(m.content || '').length} 字）`}
                    </span>
                    <button onClick={() => removeMaterial(i)} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>✕ 删除</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* ④ 操作按钮 + A/B/C 草稿 + 正式稿 */}
        <div className="v2-panel">
          <div className="v2-inline-actions">
            <button className="v2-btn v2-btn-primary" onClick={onGenerateABC} disabled={busy}>
              生成 A/B/C 候选稿
            </button>
            <button className="v2-btn v2-btn-primary" onClick={onGenerateFormal} disabled={busy || !lessonForm.drafts?.a}>
              生成正式稿（基于选稿）
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={onSave} disabled={saving}>
              {saving ? '⏳ 保存中…' : '💾 保存本节'}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={onConfirm} disabled={!currentLessonId}>
              {lessonForm.confirmed ? '✓ 已确认' : '确认本节讲稿'}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={onExportWord} disabled={!currentLessonId}>
              📄 导出 Word
            </button>
          </div>

          {/* 老师手搓正式稿入口（独立分组，提示更明显） */}
          <div style={{
            marginTop: 12, padding: 10,
            background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#9a3412', marginBottom: 6 }}>
              ✍ 老师手搓正式稿（绕过 AI，直接用自己写的版本）
            </div>
            <div style={{ fontSize: 12, color: '#7c2d12', marginBottom: 8 }}>
              如 AI 生成的正式稿不达标，可以在 Word 里手写一版，然后通过下方两种方式导入到正式稿区。导入后点"保存本节"+"确认本节讲稿"即可作为最终版导出。
            </div>
            <div className="v2-inline-actions">
              <button
                className="v2-btn v2-btn-secondary"
                onClick={() => { setShowManualPaste(true); setManualPasteText(lessonForm.finalScript || ''); }}
              >📋 粘贴正式稿（替换当前版本）</button>
              <label className="v2-btn v2-btn-secondary" style={{ cursor: 'pointer' }}>
                📎 上传 .docx 作为正式稿
                <input type="file" accept=".docx,.txt,.md" style={{ display: 'none' }} onChange={onUploadFinalScript} />
              </label>
              {lessonForm.qualityMeta?.manualOverride ? (
                <span style={{ fontSize: 12, color: '#16a34a', alignSelf: 'center' }}>
                  ⭐ 当前为老师手写版（{lessonForm.qualityMeta.manualSource ? `来源：${lessonForm.qualityMeta.manualSource}` : '已替换 AI 版'}）
                </span>
              ) : null}
            </div>
          </div>

          {/* A/B/C 草稿选稿 */}
          {(lessonForm.drafts?.a || lessonForm.drafts?.b || lessonForm.drafts?.c) ? (
            <div className="v2-field-top-gap">
              <h4 style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>选择候选稿（点 radio 选取）</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                {['a', 'b', 'c'].map((k) => (
                  <label
                    key={k}
                    style={{
                      padding: 10, border: lessonForm.selectedDraft === k ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                      borderRadius: 6, cursor: 'pointer',
                      background: lessonForm.selectedDraft === k ? '#eff6ff' : 'white',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <input
                        type="radio"
                        checked={lessonForm.selectedDraft === k}
                        onChange={() => setLessonForm((p) => ({ ...p, selectedDraft: k }))}
                      />
                      <strong>{DRAFT_META[k].title}</strong>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{DRAFT_META[k].emphasis}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{DRAFT_META[k].hint}</div>
                    <pre style={{ fontSize: 11, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', margin: 0, color: '#374151' }}>
                      {(lessonForm.drafts?.[k] || '').slice(0, 400)}
                      {(lessonForm.drafts?.[k] || '').length > 400 ? '...' : ''}
                    </pre>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {/* 正式稿编辑 */}
          {lessonForm.finalScript ? (
            <div className="v2-field-top-gap">
              <h4 style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                正式稿（{lessonForm.finalScript.length} 字，可手改后保存）
              </h4>

              {/* 老师手写覆盖时显示提示，不显示 AI 评分（避免误导） */}
              {lessonForm.qualityMeta?.manualOverride ? (
                <div style={{
                  marginBottom: 8, padding: 10,
                  background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, fontSize: 12,
                  color: '#166534',
                }}>
                  ⭐ 当前正式稿为老师手写版（{lessonForm.qualityMeta.manualLength || lessonForm.finalScript.length} 字
                  {lessonForm.qualityMeta.manualSource ? `，来源：${lessonForm.qualityMeta.manualSource}` : ''}）
                  ——AI 质量评分不适用，请确认无误后点"💾 保存本节" + "确认本节讲稿"
                </div>
              ) : null}

              {/* AI 质量评分卡（仅 AI 生成版本显示）*/}
              {lessonForm.qualityMeta && !lessonForm.qualityMeta.manualOverride ? (
                <div style={{
                  marginBottom: 8, padding: 10,
                  background: (lessonForm.qualityMeta.reviewScore || 0) >= 8 ? '#f0fdf4' : (lessonForm.qualityMeta.reviewScore || 0) >= 7 ? '#fefce8' : '#fef2f2',
                  border: '1px solid ' + ((lessonForm.qualityMeta.reviewScore || 0) >= 8 ? '#86efac' : (lessonForm.qualityMeta.reviewScore || 0) >= 7 ? '#fde68a' : '#fca5a5'),
                  borderRadius: 6, fontSize: 12,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <strong style={{ color: '#1f2937' }}>📊 AI 质量评分（9 维度，B 方案阶段 1）</strong>
                    <span style={{ fontWeight: 700, color: (lessonForm.qualityMeta.reviewScore || 0) >= 8 ? '#16a34a' : '#dc2626' }}>
                      综合 {lessonForm.qualityMeta.reviewScore || 'N/A'}/10
                      {(lessonForm.qualityMeta.reviewScore || 0) >= 8 ? ' ✅ 优秀' : (lessonForm.qualityMeta.reviewScore || 0) >= 7 ? ' ⚠ 合格' : ' ❌ 待改进'}
                    </span>
                  </div>
                  {lessonForm.qualityMeta.reviewSubscores ? (
                    <div style={{ color: '#475569', fontSize: 11 }}>
                      子项：{Object.entries(lessonForm.qualityMeta.reviewSubscores).map(([k, v]) => `${k}=${v}`).join(' · ')}
                    </div>
                  ) : null}
                  {lessonForm.qualityMeta.revisedByReview ? (
                    <div style={{ marginTop: 4, color: '#7c2d12', fontSize: 11 }}>
                      ⚙ AI 已自动修订（基于审核反馈）
                    </div>
                  ) : null}
                  {lessonForm.qualityMeta.attempts > 1 ? (
                    <div style={{ marginTop: 4, color: '#7c2d12', fontSize: 11 }}>
                      🔄 经过 {lessonForm.qualityMeta.attempts} 次自动重试
                    </div>
                  ) : null}
                  {(lessonForm.qualityMeta.reviewSuggestions || []).length > 0 ? (
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ cursor: 'pointer', color: '#475569' }}>📝 改进建议（{lessonForm.qualityMeta.reviewSuggestions.length} 条）</summary>
                      <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 11 }}>
                        {lessonForm.qualityMeta.reviewSuggestions.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}

              <textarea
                className="v2-code"
                rows={20}
                value={lessonForm.finalScript}
                onChange={(e) => setLessonForm((p) => ({ ...p, finalScript: e.target.value }))}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* 粘贴正式稿模态框 */}
      {showManualPaste ? (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowManualPaste(false); }}
        >
          <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '85%', maxWidth: 900, maxHeight: '85%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: '#1f2937' }}>📋 粘贴正式稿到下方文本框</h3>
              <button
                style={{ padding: '4px 10px', fontSize: 13, background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
                onClick={() => setShowManualPaste(false)}
              >✕ 取消</button>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              支持从 Word/记事本/任何编辑器复制粘贴。粘贴后点底部"应用为正式稿"即可替换当前版本。
            </div>
            <textarea
              autoFocus
              rows={20}
              value={manualPasteText}
              onChange={(e) => setManualPasteText(e.target.value)}
              placeholder="把老师手写的完整正式讲稿粘贴到这里...（支持 Markdown 标题、列表等）"
              style={{
                flex: 1, padding: 12, fontSize: 13, fontFamily: 'Microsoft YaHei, sans-serif',
                border: '1px solid #d1d5db', borderRadius: 6, resize: 'none',
              }}
            />
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                字数：{manualPasteText.length}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={{ padding: '6px 14px', fontSize: 13, background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
                  onClick={() => setShowManualPaste(false)}
                >取消</button>
                <button
                  style={{ padding: '6px 14px', fontSize: 13, background: '#16a34a', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                  onClick={onApplyManualPaste}
                  disabled={!manualPasteText.trim()}
                >✓ 应用为正式稿</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 右侧栏 */}
      <div className="v2-stage-right">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>所有节课概览</h3>
          </div>
          {lessons.length === 0 ? <p className="v2-hint">尚未生成任何节课讲稿</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {lessons.map((l) => (
                <li
                  key={l.id}
                  style={{
                    padding: 8, marginBottom: 4, fontSize: 12, cursor: 'pointer',
                    background: currentLessonId === l.id ? '#eff6ff' : 'transparent',
                    borderLeft: l.confirmed ? '3px solid #16a34a' : '3px solid #d1d5db',
                  }}
                  onClick={() => loadLesson(l.id)}
                >
                  <div style={{ fontWeight: 600 }}>{l.confirmed ? '✓ ' : ''}第 {l.lessonNumber} 节 · {l.topic || '未命名'}</div>
                  <div style={{ color: '#6b7280', fontSize: 11 }}>
                    {l.chapter ? `章节 ${l.chapter} · ` : ''}{l.theoryHours + l.practiceHours} 学时
                    {l.weekRange ? ` · ${l.weekRange}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ArtifactPanel
          artifacts={artifacts}
          title="讲稿产物"
          hint="lecture_final / lecture_export_word"
          onOpenFile={(storagePath) => api.openResource(storagePath)}
          dt={dt}
        />
      </div>
    </section>
  );
}
