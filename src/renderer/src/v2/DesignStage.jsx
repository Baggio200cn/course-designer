/**
 * DesignStage — 教学设计阶段（驭课 Agent v4.0.0 / Phase-9 C-2）
 *
 * 上游：schedule_table（已 confirmed）
 * 下游：lecture
 *
 * 信息图策略（按 Baggio 决策）：
 *   - 不在前端做 SVG 可视化（Q1：前端 SVG 全删）
 *   - 信息图统一调 v2:generateStageInfographic（AI 生成 PNG）
 *   - 默认布局/风格：magazine_module + magazine_module
 *   - 老师可在 30 种组合（6 layout × 5 style）里选
 *
 * UI 三视图：
 *   📝 文字预览 / ✏️ 编辑 / { } JSON
 */
import React, { useState, useEffect } from 'react';
import ArtifactPanel from './ArtifactPanel';

const REQUIRED_PHASES = ['导入新课', '知识讲授', '实操练习', '互查反馈', '总结升华'];

function arr(v) { return Array.isArray(v) ? v : []; }
function arrToText(v) { return Array.isArray(v) ? v.join('\n') : ''; }
function textToArr(t) { return String(t || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean); }

export default function DesignStage({
  designState,
  setDesignState,
  assistantStatus,
  busy,
  handleGenerateDesign,
  handleSaveDesign,
  handleConfirmDesign,
  handleExportDesignWord,
  handleGenerateDesignInfographic,
  handleConfirmInfographic,
  toLocalImgSrc,
  artifacts,
  dt,
  api,
  courseName,
  // Phase-9.5：节课导航 props
  scheduleData,            // 上游进度表（用于"从进度表拉取主题"）
  lessons,                 // 当前所有 design_doc 列表 [{ artifactId, lessonNumber, topic, totalHours, confirmed, ... }]
  currentLessonId,         // 当前选中的 design artifact id
  onSwitchLesson,          // (artifactId) => void
  onNewLesson,             // () => void
  onDeleteLesson,          // 2026-05-15 老师反馈 4.7：(artifactId, lessonLabel) => void
  onRestoreLesson,         // 2026-05-15 P2-4：(artifactId) => void
  selectedNotebookId,      // 2026-05-15 P2-4：用于加载回收站
  courseTotalHours,        // 整门课总学时
  totalAccumulatedHours,   // 已确认节课累计学时
  totalDesignedHours,      // 2026-05-15 v4.1.4：已设计（含未确认）累计学时
}) {
  const design = designState.design || null;
  const [viewMode, setViewMode] = useState('text');  // text | edit | json
  // 2026-05-15 P2-4：回收站状态
  const [recycleBin, setRecycleBin] = useState([]);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const loadRecycleBin = async () => {
    if (!selectedNotebookId || typeof api?.listDeletedDesignLessonsV2 !== 'function') return;
    try {
      const r = await api.listDeletedDesignLessonsV2(selectedNotebookId);
      if (r?.success) setRecycleBin(arr(r.data?.deleted));
    } catch (_) { /* ignore */ }
  };
  useEffect(() => {
    if (showRecycleBin) loadRecycleBin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecycleBin, selectedNotebookId]);

  // 信息图选项（从后端 v2:getInfographicOptions 拉）
  const [infoOptions, setInfoOptions] = useState({ layouts: [], styles: [] });
  // Phase-9 C-2 修正：默认从 magazine_module 换成 design_overview（专为整门课设计）
  // 2026-05-16 v4.1.4 方案 B：默认风格从 design_overview 改成 magazine（统一杂志感皮肤）
  const [selectedLayout, setSelectedLayout] = useState('design_overview');
  const [selectedStyle, setSelectedStyle]   = useState('magazine');
  const [infographicBusy, setInfographicBusy] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);  // 全屏放大查看的 artifact
  const [dirty, setDirty] = useState(false);             // 是否有未保存的修改
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState('');        // "已保存"提示

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getInfographicOptionsV2?.();
        if (res?.success) setInfoOptions(res.data);
      } catch (_) {/* ignore */}
    })();
  }, [api]);

  // 当 artifactId 变化（重新生成、切换笔记本、加载完成）时，清掉 dirty 标记
  useEffect(() => {
    setDirty(false);
    setSavedHint('');
  }, [designState.artifactId]);

  // Esc 关闭全屏放大模态
  useEffect(() => {
    if (!zoomedImage) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setZoomedImage(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomedImage]);

  const phases = design?.inClass?.phases || [];
  const components = design?.assessment?.components || [];
  const totalWeight = components.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const objectivesCount = (() => {
    const o = design?.teachingObjectives || {};
    return (o.knowledge?.length || 0) + (o.skill?.length || 0) + (o.emotion?.length || 0);
  })();

  // 该阶段已生成的信息图（artifact_type='design_infographic'）
  // Phase-9.5：按视角 + 节课关联筛选
  //   - 整门课视角（design_overview）：显示 content.viewLevel === 'course' 的
  //   - 本节视角：显示 content.viewLevel === 'lesson' 且 sourceDesignArtifactId === currentDesignArtifactId
  const allInfoArtifacts = arr(artifacts).filter((a) => a.type === 'design_infographic');
  const isViewCourseLevel = selectedLayout === 'design_overview';
  // 2026-05-15 v4.1.4 T2：信息图丢失修复
  //   原过滤器要求 sourceDesignArtifactId 严格匹配 designState.artifactId；
  //   若 artifactId 缺失或不一致（譬如刚生成、未保存、design 被重生），就把图全过滤掉。
  //   现改为多层兜底：① artifactId 精确匹配 ② lessonNumber 兜底 ③ topic 兜底
  const currentLessonNumber = Number(designState?.design?.lessonMeta?.lessonNumber) || null;
  const currentLessonTopic = String(designState?.design?.lessonMeta?.topic || '').trim();
  const infoArtifacts = allInfoArtifacts.filter((a) => {
    const c = a.content || {};
    const vl = c.viewLevel || (c.layout === 'design_overview' ? 'course' : 'lesson');
    if (isViewCourseLevel) return vl === 'course';
    if (vl !== 'lesson') return false;
    // ① 精确匹配
    if (c.sourceDesignArtifactId && designState.artifactId) {
      if (Number(c.sourceDesignArtifactId) === Number(designState.artifactId)) return true;
    }
    // ② lessonNumber 兜底
    if (currentLessonNumber && c.sourceLessonNumber) {
      if (Number(c.sourceLessonNumber) === currentLessonNumber) return true;
    }
    // ③ topic 兜底
    if (currentLessonTopic && c.sourceLessonTopic) {
      if (String(c.sourceLessonTopic).trim() === currentLessonTopic) return true;
    }
    return false;
  });
  // 优先用 confirmed 的（老师标记过最终版）；没有则用最新的
  const finalInfo = infoArtifacts.find((a) => a.confirmed) || null;
  const latestInfo = finalInfo || infoArtifacts[0] || null;
  const safeImgSrc = (p) => (toLocalImgSrc ? toLocalImgSrc(p) : `local-img:///${encodeURIComponent(p || '')}`);

  // 内联编辑用：双向更新 design 字段（标记 dirty）
  const updateField = (path, value) => {
    setDirty(true);
    setSavedHint('');
    setDesignState((prev) => {
      const next = { ...prev };
      const d = JSON.parse(JSON.stringify(prev.design || {}));
      const segs = path.split('.');
      let cursor = d;
      for (let i = 0; i < segs.length - 1; i++) {
        if (!cursor[segs[i]]) cursor[segs[i]] = {};
        cursor = cursor[segs[i]];
      }
      cursor[segs[segs.length - 1]] = value;
      next.design = d;
      next.jsonText = JSON.stringify(d, null, 2);
      return next;
    });
  };

  // 保存（带反馈）
  const onSave = async () => {
    if (!design) return;
    setSaving(true);
    try {
      await handleSaveDesign(designState);
      setDirty(false);
      setSavedHint('💾 已保存。如需让信息图反映新内容，可重新生成');
      setTimeout(() => setSavedHint(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  // 保存 + 立即重新生成信息图（连续操作）
  const onSaveAndRegenerate = async () => {
    if (!design) return;
    setSaving(true);
    try {
      await handleSaveDesign(designState);
      setDirty(false);
      setSavedHint('💾 已保存，正在重新生成信息图...');
      await handleGenerateDesignInfographic({ layout: selectedLayout, visualStyle: selectedStyle });
      setTimeout(() => setSavedHint(''), 3000);
    } finally {
      setSaving(false);
    }
  };

  const onClickGenerateInfographic = async () => {
    if (!design) { window.alert('请先生成教学设计'); return; }
    setInfographicBusy(true);
    try {
      await handleGenerateDesignInfographic({ layout: selectedLayout, visualStyle: selectedStyle });
    } finally {
      setInfographicBusy(false);
    }
  };

  // Phase-9.5：从进度表拉取本节主题的下拉选项
  const scheduleRows = arr(scheduleData?.schedule);

  // 本节信息（直接绑定 designState.lessonForm 持有；从 design.lessonMeta 反向同步）
  const lessonForm = designState.lessonForm || {
    lessonNumber: 1,
    topic: '',
    chapter: '',
    weekRange: '',
    theoryHours: 2,
    practiceHours: 2,
  };

  // 学时校验（前端实时）
  const totalLessonHours = +((Number(lessonForm.theoryHours) || 0) + (Number(lessonForm.practiceHours) || 0)).toFixed(2);
  const hoursWarning = (() => {
    const t = Number(lessonForm.theoryHours) || 0;
    const p = Number(lessonForm.practiceHours) || 0;
    const tot = +(t + p).toFixed(2);
    const isHalf = (v) => Math.abs(v * 2 - Math.round(v * 2)) < 0.001;
    if (tot < 1) return `⚠ 总学时 ${tot} < 1，建议至少 1 学时`;
    if (tot > 4) return `⚠ 总学时 ${tot} > 4，超过单节上限（AI token 限制），仍可生成但质量可能下降`;
    if (!isHalf(t) || !isHalf(p)) return `⚠ 理论/实践学时仅支持 0.5/1/1.5/2/... 等 0.5 步进`;
    return '';
  })();

  const updateLessonForm = (field, value) => {
    setDesignState((prev) => ({
      ...prev,
      lessonForm: { ...lessonForm, [field]: value },
    }));
  };

  // 选进度表某一行 → 自动填入 topic/chapter/weekRange
  const onPickFromSchedule = (rowKey) => {
    if (!rowKey) return;
    const row = scheduleRows.find((r) => `w${r.week}-s${r.session}` === rowKey);
    if (!row) return;
    setDesignState((prev) => ({
      ...prev,
      lessonForm: {
        ...lessonForm,
        lessonNumber: row.session || lessonForm.lessonNumber,
        topic: row.content || lessonForm.topic,
        chapter: row.chapter || lessonForm.chapter,
        weekRange: `第 ${row.week} 周`,
      },
    }));
  };

  return (
    <section className="v2-stage-layout">
      <div className="v2-stage-center">

        {/* ═══ Phase-9.5：节课导航 + 学时进度 ═══ */}
        <div className="v2-panel" style={{ background: '#f0f9ff', border: '1px solid #93c5fd' }}>
          <div className="v2-panel-head">
            <h3>教学设计 · 按节课</h3>
            <span className="v2-hint">
              {/* 2026-05-15 v4.1.4：双数字（已设计 + 已确认 + 目标）让老师立刻看到进展 */}
              已设计 <strong style={{ color: '#16a34a' }}>{totalDesignedHours || 0}</strong>
              {' · '}
              已确认 <strong style={{ color: '#1e40af' }}>{totalAccumulatedHours || 0}</strong>
              {' / '}目标 {courseTotalHours || 72} 学时
            </span>
          </div>
          {/* 节课 tab 条 */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {arr(lessons).map((l) => (
              <button
                key={l.artifactId}
                onClick={() => onSwitchLesson?.(l.artifactId)}
                style={{
                  padding: '6px 12px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                  border: '1px solid ' + (l.artifactId === currentLessonId ? '#1e40af' : '#cbd5e1'),
                  background: l.artifactId === currentLessonId ? '#1e40af' : 'white',
                  color: l.artifactId === currentLessonId ? 'white' : '#475569',
                  fontWeight: l.artifactId === currentLessonId ? 600 : 'normal',
                }}
                title={`${l.totalHours} 学时 · ${l.confirmed ? '已确认' : '未确认'}`}
              >
                {l.confirmed ? '✓ ' : ''}第 {l.lessonNumber} 节
                <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>· {l.totalHours}h</span>
              </button>
            ))}
            <button
              onClick={onNewLesson}
              style={{
                padding: '6px 12px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                border: '1px dashed #1e40af', background: 'transparent', color: '#1e40af', fontWeight: 600,
              }}
            >+ 新建一节</button>
            {/* 2026-05-15 老师反馈 4.7：删除当前选中节（仅在有当前节时显示） */}
            {currentLessonId && onDeleteLesson ? (
              <button
                onClick={() => {
                  const current = arr(lessons).find((l) => l.artifactId === currentLessonId);
                  const label = current ? `第 ${current.lessonNumber} 节「${current.topic || '未命名'}」` : '本节';
                  onDeleteLesson(currentLessonId, label);
                }}
                style={{
                  padding: '6px 12px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                  border: '1px solid #dc2626', background: '#fff', color: '#dc2626', fontWeight: 500,
                  marginLeft: 'auto',
                }}
                title="删除当前选中节课的教学设计（软删除，可恢复）"
              >🗑 删除本节</button>
            ) : null}
            {/* 2026-05-15 P2-4：回收站入口 */}
            <button
              onClick={() => setShowRecycleBin((v) => !v)}
              style={{
                padding: '6px 12px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                border: '1px dashed #6b7280', background: showRecycleBin ? '#fef9c3' : 'white',
                color: '#6b7280', marginLeft: currentLessonId && onDeleteLesson ? 4 : 'auto',
              }}
              title="查看已删除的节课设计（可恢复）"
            >♻ 回收站{recycleBin.length > 0 ? ` (${recycleBin.length})` : ''}</button>
          </div>

          {/* 2026-05-15 P2-4：回收站面板（展开） */}
          {showRecycleBin ? (
            <div style={{
              marginTop: 12, padding: 12,
              background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ color: '#78350f' }}>♻ 已删除的节课设计</strong>
                <button onClick={loadRecycleBin} className="v2-btn v2-btn-xs">🔄 刷新</button>
              </div>
              {recycleBin.length === 0 ? (
                <p style={{ fontSize: 12, color: '#92400e', margin: 0 }}>回收站为空。删除后的节课会出现在这里，可以恢复。</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#fde68a', color: '#78350f' }}>
                      <th style={{ padding: 6, border: '1px solid #fcd34d', width: 50 }}>节次</th>
                      <th style={{ padding: 6, border: '1px solid #fcd34d' }}>主题</th>
                      <th style={{ padding: 6, border: '1px solid #fcd34d', width: 60 }}>学时</th>
                      <th style={{ padding: 6, border: '1px solid #fcd34d', width: 150 }}>删除时间</th>
                      <th style={{ padding: 6, border: '1px solid #fcd34d', width: 80 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recycleBin.map((l) => (
                      <tr key={l.artifactId} style={{ background: 'white' }}>
                        <td style={{ padding: 6, border: '1px solid #fde68a', textAlign: 'center' }}>{l.lessonNumber}</td>
                        <td style={{ padding: 6, border: '1px solid #fde68a' }}>{l.topic || '（未命名）'}</td>
                        <td style={{ padding: 6, border: '1px solid #fde68a', textAlign: 'center' }}>{l.totalHours}h</td>
                        <td style={{ padding: 6, border: '1px solid #fde68a', color: '#6b7280', fontSize: 11 }}>
                          {l.deletedAt ? new Date(l.deletedAt).toLocaleString('zh-CN', { hour12: false }).slice(0, 16) : '-'}
                        </td>
                        <td style={{ padding: 6, border: '1px solid #fde68a', textAlign: 'center' }}>
                          <button
                            onClick={async () => {
                              if (typeof onRestoreLesson === 'function') {
                                await onRestoreLesson(l.artifactId);
                                await loadRecycleBin();
                              }
                            }}
                            className="v2-btn v2-btn-xs v2-btn-primary"
                          >🔄 恢复</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </div>

        {/* ═══ 本节基础信息（必填） ═══ */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>本节基础信息（必填）</h3>
            <span className="v2-hint">主题决定 AI 生成范围 · 总学时按钮选择（1/2/3/4）· 理论/实践分配自动联动 0.5 步进</span>
          </div>
          <div className="v2-grid-two">
            <div>
              <label className="v2-label">本节主题 <span style={{ color: '#dc2626' }}>*</span></label>
              <input
                value={lessonForm.topic || ''}
                onChange={(e) => updateLessonForm('topic', e.target.value)}
                placeholder="例：思维导图制作 · 服装品牌传播逻辑梳理"
              />
            </div>
            <div>
              <label className="v2-label">从进度表拉取（可选）</label>
              {/* P6 修复（2026-05-18）：下拉值绑定到当前 lessonForm 反推的 rowKey
                  老师反馈："选了第 17 周后，下拉又显回'选某一周次'，不知道选中了哪个" */}
              {(() => {
                // 反推 rowKey：用 lessonForm.weekRange ("第 17 周") + lessonNumber 找匹配的进度表行
                const weekMatch = String(lessonForm.weekRange || '').match(/\d+/);
                const weekNum = weekMatch ? Number(weekMatch[0]) : null;
                const sessionNum = Number(lessonForm.lessonNumber) || null;
                const currentRowKey = (weekNum && sessionNum)
                  ? `w${weekNum}-s${sessionNum}`
                  : '';
                // 确保 rowKey 真在 scheduleRows 里（否则 select 报警告）
                const validRowKey = scheduleRows.some(r => `w${r.week}-s${r.session}` === currentRowKey)
                  ? currentRowKey
                  : '';
                return (
                  <select onChange={(e) => onPickFromSchedule(e.target.value)} value={validRowKey} disabled={scheduleRows.length === 0}>
                    <option value="">{scheduleRows.length === 0 ? '（进度表未生成）' : '-- 选某一周次 --'}</option>
                    {scheduleRows.map((r) => (
                      <option key={`w${r.week}-s${r.session}`} value={`w${r.week}-s${r.session}`}>
                        第 {r.week} 周 · 第 {r.session} 课次：{r.content || '（无内容）'}
                      </option>
                    ))}
                  </select>
                );
              })()}
            </div>
            <div>
              <label className="v2-label">关联章节</label>
              <input
                value={lessonForm.chapter || ''}
                onChange={(e) => updateLessonForm('chapter', e.target.value)}
                placeholder="如：一 / 实训一"
              />
            </div>
            <div>
              <label className="v2-label">周次范围</label>
              <input
                value={lessonForm.weekRange || ''}
                onChange={(e) => updateLessonForm('weekRange', e.target.value)}
                placeholder="如：第 3 周"
              />
            </div>
            {/* 2026-05-15 老师反馈 4.2：把"理论/实践学时自由输入"改为"先选总学时按钮 → 再分配理论/实践"。
                上限 4 学时（>4 软提示"后续开发支持中"）。原 max=4 number input 改为按钮组 + 受控分配。 */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="v2-label">本节总学时（点击选择）</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {[1, 2, 3, 4].map((h) => {
                  const active = totalLessonHours === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      className={`v2-btn v2-btn-xs ${active ? 'v2-btn-primary' : 'v2-btn-secondary'}`}
                      style={{ minWidth: 64 }}
                      onClick={() => {
                        // 选定总学时时，按当前比例缩放 theory/practice；首次默认对半分（实践向上取整）
                        const prevT = Number(lessonForm.theoryHours) || 0;
                        const prevP = Number(lessonForm.practiceHours) || 0;
                        const prevTotal = prevT + prevP;
                        let newT, newP;
                        if (prevTotal > 0) {
                          newT = +((prevT / prevTotal) * h).toFixed(1);
                          // 0.5 步进取整
                          newT = Math.round(newT * 2) / 2;
                          newP = h - newT;
                        } else {
                          newT = Math.floor(h / 2 * 2) / 2;  // 偶数取一半
                          newP = h - newT;
                        }
                        setDesignState((prev) => ({
                          ...prev,
                          lessonForm: { ...lessonForm, theoryHours: newT, practiceHours: newP },
                        }));
                      }}
                    >{h} 学时</button>
                  );
                })}
                <button
                  type="button"
                  className="v2-btn v2-btn-xs"
                  style={{ minWidth: 96, opacity: 0.55, cursor: 'not-allowed' }}
                  title="单节 >4 学时支持开发中——目前请拆为多节"
                  onClick={() => window.alert('单节 > 4 学时支持开发中。\n\n建议：拆为多节（如 6 学时 = 4 学时 + 2 学时 两节），分别生成设计。')}
                >&gt; 4 学时（开发中）</button>
              </div>
              <p className="v2-hint" style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                💡 单节建议 ≤ 4 学时（AI token 限制 + 中职单节课时长惯例）；理论/实践可在下方自由分配
              </p>
            </div>
            <div>
              <label className="v2-label">理论学时（0.5 步进）</label>
              <input
                type="number" step="0.5" min="0" max={totalLessonHours || 4}
                value={lessonForm.theoryHours ?? 2}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  // 自动让 practice = total - theory，保持总学时不变
                  const newP = Math.max(0, totalLessonHours - v);
                  setDesignState((prev) => ({
                    ...prev,
                    lessonForm: { ...lessonForm, theoryHours: v, practiceHours: newP },
                  }));
                }}
              />
            </div>
            <div>
              <label className="v2-label">实践学时（自动联动）</label>
              <input
                type="number" step="0.5" min="0" max={totalLessonHours || 4}
                value={lessonForm.practiceHours ?? 2}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  const newT = Math.max(0, totalLessonHours - v);
                  setDesignState((prev) => ({
                    ...prev,
                    lessonForm: { ...lessonForm, practiceHours: v, theoryHours: newT },
                  }));
                }}
              />
            </div>
            <div>
              <label className="v2-label">本节总学时（自动汇总）</label>
              <input value={`${totalLessonHours} 学时`} disabled style={{ fontWeight: 600 }} />
            </div>
            <div>
              <label className="v2-label">第几节（自动从进度表带）</label>
              <input
                type="number" min="1"
                value={lessonForm.lessonNumber ?? 1}
                onChange={(e) => updateLessonForm('lessonNumber', Number(e.target.value))}
              />
            </div>
          </div>
          {hoursWarning ? (
            <div style={{ marginTop: 8, padding: 8, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
              {hoursWarning}（仍可继续生成）
            </div>
          ) : null}
        </div>

        {/* ── 顶部操作面板 ── */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>AI 生成本节教学设计</h3>
            <span className="v2-hint">仅针对本节（≤ 4 学时） · 5 段法 · 考核权重 100% · 思政 2-4 条</span>
          </div>
          <div className="v2-status-box">
            <span>助手状态</span>
            <strong>{assistantStatus}</strong>
          </div>
          <div className="v2-inline-actions v2-field-top-gap">
            <button
              className="v2-btn v2-btn-primary"
              onClick={() => handleGenerateDesign(lessonForm)}
              disabled={busy || !lessonForm.topic}
              title={!lessonForm.topic ? '请先填本节主题' : ''}
            >
              {design ? '基于本节信息重新生成' : '基于本节信息生成教学设计'}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={() => handleSaveDesign(designState)} disabled={!design}>
              保存
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleConfirmDesign} disabled={!designState.artifactId}>
              {designState.confirmed ? '✓ 已确认' : '确认（解锁 PPT）'}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleExportDesignWord} disabled={!designState.artifactId}>
              📄 导出 Word
            </button>
          </div>
        </div>

        {/* ── 信息图生成面板（AI 调用，30 种组合可选）── */}
        {/* Phase-9.5 升级：布局分两组——「📚 整门课视角」(design_overview) 用聚合数据，「📖 本节视角」(其他 6 种) 用当前节课数据 */}
        {(() => {
          // 布局分组：design_overview 为整门课视角，其他为本节视角
          const courseLevelLayouts = arr(infoOptions.layouts).filter((l) => l.key === 'design_overview');
          const lessonLevelLayouts = arr(infoOptions.layouts).filter((l) => l.key !== 'design_overview');
          const isCourseLevel = selectedLayout === 'design_overview';
          const lessonsCount = arr(lessons).length;
          const hasCurrentLesson = !!design;
          // 0 节课时禁用本节视角；老师选了本节视角但没节课 → 提示
          const showNoLessonHint = !isCourseLevel && !hasCurrentLesson;

          return (
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>📊 教学设计信息图（AI 生成）</h3>
            <span className="v2-hint">
              {infoOptions.layouts.length} 种骨架 × {infoOptions.styles.length} 种皮肤
              <span style={{ marginLeft: 8, color: '#64748b' }}>
                💡 骨架决定结构（卡片 / 思维导图 / 杂志 / 逻辑闭环），皮肤决定视觉气质（专业正式 / 杂志感）
              </span>
            </span>
          </div>

          {/* 视角提示卡 */}
          <div style={{
            marginBottom: 10, padding: 10,
            background: isCourseLevel ? '#fef3c7' : '#dbeafe',
            border: `1px solid ${isCourseLevel ? '#f59e0b' : '#60a5fa'}`,
            borderRadius: 6, fontSize: 13,
          }}>
            {isCourseLevel ? (
              <>
                <strong>📚 整门课视角</strong>
                <span style={{ color: '#92400e' }}>
                  ：基于全部 <strong>{lessonsCount}</strong> 节已设计课程聚合，教学使用
                </span>
                {lessonsCount === 0 ? (
                  <div style={{ marginTop: 4, color: '#dc2626' }}>⚠ 还没有任何节课设计，请先在上方"按节课"区生成至少 1 节</div>
                ) : null}
              </>
            ) : (
              <>
                <strong>📖 本节视角</strong>
                <span style={{ color: '#1e40af' }}>
                  ：基于当前选中节课
                  {hasCurrentLesson ? (
                    <strong>「第 {design?.lessonMeta?.lessonNumber || '?'} 节 · {design?.lessonMeta?.topic || '未命名'}」</strong>
                  ) : <span style={{ color: '#dc2626', fontWeight: 600 }}> 请先在上方"按节课"区选/新建节课</span>}
                </span>
                {hasCurrentLesson ? (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#475569' }}>
                    💡 切换其他节课请在上方"按节课"导航条点击，信息图会自动按节课归档显示
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="v2-grid-two">
            <div>
              <label className="v2-label">
                骨架（结构）
                <span className="v2-label-hint">📚 整门课 / 📖 本节 两类</span>
              </label>
              <select value={selectedLayout} onChange={(e) => setSelectedLayout(e.target.value)}>
                {courseLevelLayouts.length ? (
                  <optgroup label="📚 整门课视角（基于全部节课聚合）">
                    {courseLevelLayouts.map((l) => (
                      <option key={l.key} value={l.key}>{l.label}</option>
                    ))}
                  </optgroup>
                ) : null}
                {lessonLevelLayouts.length ? (
                  <optgroup label="📖 本节视角（基于当前选中节课）">
                    {lessonLevelLayouts.map((l) => (
                      <option key={l.key} value={l.key}>{l.label}</option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
            <div>
              <label className="v2-label">
                皮肤（视觉气质）
                <span className="v2-label-hint">同一骨架可换不同皮肤</span>
              </label>
              <select value={selectedStyle} onChange={(e) => setSelectedStyle(e.target.value)}>
                {infoOptions.styles.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
                </select>
              </div>
            </div>
            <div className="v2-inline-actions v2-field-top-gap">
              <button
                className="v2-btn v2-btn-primary"
                onClick={onClickGenerateInfographic}
                disabled={
                  infographicBusy || busy ||
                  (isCourseLevel && lessonsCount === 0) ||
                  (!isCourseLevel && !hasCurrentLesson)
                }
                title={
                  isCourseLevel && lessonsCount === 0 ? '先生成至少 1 节课设计' :
                  !isCourseLevel && !hasCurrentLesson ? '请先选/新建节课' : ''
                }
              >
                {infographicBusy ? '⏳ AI 生成中（约 30-60 秒）...' :
                  isCourseLevel ? '🎨 生成整门课信息图' : '🎨 生成本节信息图'}
              </button>
              {latestInfo ? (
                <span className="v2-hint">最新：{latestInfo.title || latestInfo.previewText}</span>
              ) : null}
            </div>

            {/* 显示最新信息图 PNG（点击放大）*/}
            {latestInfo?.storagePath ? (
              <div style={{ marginTop: 16, background: '#fafafa', padding: 16, borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    {finalInfo ? '⭐ 最终版（导出 Word 用此张）' : '🆕 当前最新（未标记最终版）'}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!latestInfo.confirmed ? (
                      <button
                        className="v2-btn v2-btn-xs v2-btn-primary"
                        onClick={() => handleConfirmInfographic?.(latestInfo.id)}
                      >⭐ 标记为最终版</button>
                    ) : null}
                    <button
                      className="v2-btn v2-btn-xs v2-btn-secondary"
                      onClick={() => setZoomedImage(latestInfo)}
                    >🔍 全屏查看</button>
                    <button
                      className="v2-btn v2-btn-xs v2-btn-secondary"
                      onClick={() => api.openResource?.(latestInfo.storagePath)}
                    >📂 在外部打开</button>
                  </div>
                </div>
                <div style={{ textAlign: 'center', cursor: 'zoom-in' }} onClick={() => setZoomedImage(latestInfo)}>
                  <img
                    src={safeImgSrc(latestInfo.storagePath)}
                    alt={latestInfo.title || '教学设计信息图'}
                    style={{ maxWidth: '100%', maxHeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', borderRadius: 4 }}
                  />
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
                  {latestInfo.title} · {dt(latestInfo.createdAt)}
                </div>
              </div>
            ) : null}

            {/* 历史信息图缩略图列表 */}
            {infoArtifacts.length > 1 ? (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                  历史版本（{infoArtifacts.length}）<span style={{ color: '#6b7280', fontWeight: 'normal', fontSize: 12 }}> · 点缩略图放大</span>
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {infoArtifacts.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        width: 140, fontSize: 11, color: '#6b7280',
                        cursor: 'pointer',
                        border: a.confirmed ? '2px solid #f59e0b' : '1px solid #e5e7eb',
                        borderRadius: 4, padding: 4,
                      }}
                      title={a.title}
                      onClick={() => setZoomedImage(a)}
                    >
                      <img
                        src={safeImgSrc(a.storagePath)}
                        alt={a.title}
                        style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 2 }}
                      />
                      <div style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.confirmed ? '⭐ ' : ''}{a.content?.layout || '—'}/{a.content?.visualStyle || '—'}
                      </div>
                      {!a.confirmed && a.id !== latestInfo?.id ? (
                        <button
                          style={{ width: '100%', marginTop: 4, fontSize: 10, padding: '2px 4px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 3, cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); handleConfirmInfographic?.(a.id); }}
                        >设为最终版</button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          );
        })()}

        {/* 全屏放大查看模态框（含滚动 + 工具栏 + 标记最终版） */}
        {zoomedImage ? (
          <div
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.92)', zIndex: 9999,
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* 顶部固定工具栏 */}
            <div style={{
              flexShrink: 0,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 20px',
              background: 'rgba(15, 23, 42, 0.95)',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
            }}>
              <div style={{ color: 'white', fontSize: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                {zoomedImage.confirmed ? (
                  <span style={{ background: '#f59e0b', color: 'white', padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>⭐ 当前最终版</span>
                ) : null}
                <strong>{zoomedImage.title}</strong>
                <span style={{ color: '#9ca3af', fontSize: 12 }}>
                  · {zoomedImage.content?.layout || '—'} / {zoomedImage.content?.visualStyle || '—'}
                  · {dt(zoomedImage.createdAt)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!zoomedImage.confirmed ? (
                  <button
                    style={{ padding: '6px 14px', fontSize: 13, background: '#f59e0b', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                    onClick={async () => {
                      await handleConfirmInfographic?.(zoomedImage.id);
                      setZoomedImage({ ...zoomedImage, confirmed: true });
                    }}
                  >⭐ 标记为最终版</button>
                ) : null}
                <button
                  style={{ padding: '6px 14px', fontSize: 13, background: '#475569', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                  onClick={() => api.openResource?.(zoomedImage.storagePath)}
                >📂 在外部打开</button>
                <button
                  style={{ padding: '6px 14px', fontSize: 13, background: 'white', color: '#1e293b', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setZoomedImage(null)}
                >✕ 关闭（Esc）</button>
              </div>
            </div>

            {/* 中央可滚动图像区 */}
            <div
              style={{
                flex: 1, overflow: 'auto', padding: 20,
                display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
              }}
              onClick={(e) => { if (e.target === e.currentTarget) setZoomedImage(null); }}
            >
              <img
                src={safeImgSrc(zoomedImage.storagePath)}
                alt={zoomedImage.title}
                style={{
                  maxWidth: '100%',
                  // 不限制 maxHeight：让图像保持原始高度，由父容器滚动
                  borderRadius: 4, background: 'white',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* 底部提示 */}
            <div style={{
              flexShrink: 0,
              padding: '8px 20px',
              background: 'rgba(15, 23, 42, 0.95)',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              color: '#9ca3af', fontSize: 12, textAlign: 'center',
            }}>
              💡 图像超出窗口高度时可向下滚动查看；点击图像外的黑色区域可关闭
            </div>
          </div>
        ) : null}

        {/* ── 三视图切换 + 主内容 ── */}
        {design ? (
          <div className="v2-panel">
            <div className="v2-panel-head">
              <h3>教学设计内容</h3>
              <div className="v2-inline-actions">
                <button
                  className={`v2-btn v2-btn-xs ${viewMode === 'text' ? 'v2-btn-primary' : 'v2-btn-secondary'}`}
                  onClick={() => setViewMode('text')}
                >📝 文字预览</button>
                <button
                  className={`v2-btn v2-btn-xs ${viewMode === 'edit' ? 'v2-btn-primary' : 'v2-btn-secondary'}`}
                  onClick={() => setViewMode('edit')}
                >✏️ 编辑</button>
                <button
                  className={`v2-btn v2-btn-xs ${viewMode === 'json' ? 'v2-btn-primary' : 'v2-btn-secondary'}`}
                  onClick={() => setViewMode('json')}
                >{ } JSON</button>
              </div>
            </div>

            {viewMode === 'text' && <DesignTextView design={design} />}
            {viewMode === 'edit' && <DesignEditor design={design} updateField={updateField} />}
            {viewMode === 'json' && (
              <textarea
                className="v2-code"
                rows={22}
                value={designState.jsonText || ''}
                onChange={(e) => {
                  setDirty(true);
                  setSavedHint('');
                  setDesignState((prev) => ({ ...prev, jsonText: e.target.value }));
                }}
              />
            )}

            {/* 编辑/JSON 视图下：底部固定保存条（对应老师"看不到顶部保存按钮"问题）*/}
            {(viewMode === 'edit' || viewMode === 'json') ? (
              <div style={{
                marginTop: 16, padding: 12,
                background: dirty ? '#fef3c7' : '#f0fdf4',
                border: `1px solid ${dirty ? '#f59e0b' : '#86efac'}`,
                borderRadius: 6,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: dirty ? '#92400e' : '#166534' }}>
                  {savedHint || (dirty ? '⚠ 你有未保存的修改' : '✓ 当前内容已保存')}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="v2-btn v2-btn-primary"
                    onClick={onSave}
                    disabled={!dirty || saving}
                  >
                    {saving ? '⏳ 保存中…' : '💾 保存'}
                  </button>
                  <button
                    className="v2-btn v2-btn-secondary"
                    onClick={onSaveAndRegenerate}
                    disabled={saving || infographicBusy}
                    title="保存当前编辑内容，并基于新内容立即重新生成信息图"
                  >
                    💾 + 🎨 保存并重新生成信息图
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="v2-panel">
            <p className="v2-hint">
              尚未生成。点上方"基于进度表生成教学设计"开始（需先确认教学进度表 + 已配置 API Key）。
            </p>
          </div>
        )}
      </div>

      {/* ── 右侧栏：概览数据 ── */}
      <div className="v2-stage-right">
        <div className="v2-panel">
          <div className="v2-panel-head"><h3>关键指标</h3></div>
          <div className="v2-summary-box">
            <p><strong>课程：</strong>{courseName || '—'}</p>
            <p><strong>教学目标：</strong>{objectivesCount} 条</p>
            <p><strong>5 段法：</strong>{phases.length}/5 {phases.length === 5 ? '✓' : '⚠'}</p>
            <p><strong>考核权重：</strong>{totalWeight}/100 {totalWeight === 100 ? '✓' : '⚠'}</p>
            <p><strong>思政元素：</strong>{(design?.ideologicalElements || []).length} 条</p>
            <p><strong>已确认：</strong>{designState.confirmed ? '是' : '否'}</p>
            <p><strong>信息图版本：</strong>{infoArtifacts.length}</p>
          </div>
        </div>

        <ArtifactPanel
          artifacts={artifacts}
          title="教学设计产物"
          hint="design_doc / design_infographic / design_export_word"
          onOpenFile={(storagePath) => api.openResource(storagePath)}
          onViewArtifact={(item) => {
            // 教学设计 design_doc：直接载入编辑器查看（教学设计本来就是表单视图，无需独立 modal）
            if (item.type === 'design_doc' && item.id && typeof onSwitchLesson === 'function') {
              onSwitchLesson(item.id);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (item.storagePath) {
              api.openResource(item.storagePath);
            }
          }}
          dt={dt}
        />
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * 文字预览 —— 纯结构化文本 + 表格（无前端 SVG）
 * ────────────────────────────────────────────────────────────────────── */
function DesignTextView({ design }) {
  const obj = design.teachingObjectives || {};
  const phases = arr(design.inClass?.phases);
  const components = arr(design.assessment?.components);
  const methods = arr(design.teachingMethods);
  const ideologies = arr(design.ideologicalElements);

  return (
    <div style={{ padding: 8, fontSize: 13, lineHeight: 1.7, color: '#374151' }}>
      <Section title="① 教学目标">
        {arr(obj.knowledge).length ? (
          <div><strong>知识目标：</strong>
            <ul>{arr(obj.knowledge).map((k, i) => <li key={i}>{k}</li>)}</ul>
          </div>
        ) : null}
        {arr(obj.skill).length ? (
          <div><strong>技能目标：</strong>
            <ul>{arr(obj.skill).map((k, i) => <li key={i}>{k}</li>)}</ul>
          </div>
        ) : null}
        {arr(obj.emotion).length ? (
          <div><strong>素养目标：</strong>
            <ul>{arr(obj.emotion).map((k, i) => <li key={i}>{k}</li>)}</ul>
          </div>
        ) : null}
      </Section>

      <Section title="② 教学重点与难点">
        {arr(design.keyPoints).length ? (
          <div><strong>教学重点：</strong>
            <ul>{arr(design.keyPoints).map((k, i) => <li key={i}>{k}</li>)}</ul>
          </div>
        ) : null}
        {arr(design.difficulties).length ? (
          <div><strong>教学难点：</strong>
            <ul>{arr(design.difficulties).map((k, i) => <li key={i}>{k}</li>)}</ul>
          </div>
        ) : null}
      </Section>

      <Section title="③ 教学方法">
        {methods.length === 0 ? <p style={hintStyle}>未填写</p> : (
          <table style={tableStyle}>
            <thead><tr><th style={thStyle}>方法</th><th style={thStyle}>简介</th><th style={thStyle}>适用环节</th></tr></thead>
            <tbody>
              {methods.map((m, i) => (
                <tr key={i} style={i % 2 === 0 ? trEvenStyle : trOddStyle}>
                  <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{m.name}</td>
                  <td style={tdStyle}>{m.desc || '—'}</td>
                  <td style={tdStyle}>{m.applicable || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="④ 课中 5 段法（教学过程）">
        {phases.length === 0 ? <p style={hintStyle}>未生成</p> : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>环节</th><th style={thStyle}>时长</th>
                <th style={thStyle}>教师活动</th><th style={thStyle}>学生活动</th><th style={thStyle}>评价</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((p, i) => (
                <tr key={i} style={i % 2 === 0 ? trEvenStyle : trOddStyle}>
                  <td style={{ ...tdCenterStyle, fontWeight: 600 }}>{p.phase}</td>
                  <td style={tdCenterStyle}>{p.duration || '—'}</td>
                  <td style={tdStyle}>{p.teacherActions || '—'}</td>
                  <td style={tdStyle}>{p.studentActions || '—'}</td>
                  <td style={tdStyle}>{p.evaluation || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="⑤ 考核评价">
        {design.assessment?.approach ? <p>{design.assessment.approach}</p> : null}
        {components.length === 0 ? <p style={hintStyle}>未填写</p> : (
          <table style={tableStyle}>
            <thead><tr><th style={thStyle}>考核项</th><th style={thStyle}>权重</th><th style={thStyle}>评分标准</th></tr></thead>
            <tbody>
              {components.map((c, i) => (
                <tr key={i} style={i % 2 === 0 ? trEvenStyle : trOddStyle}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{c.name}</td>
                  <td style={tdCenterStyle}>{c.weight}%</td>
                  <td style={tdStyle}>{c.criteria || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="⑥ 思政元素">
        {ideologies.length === 0 ? <p style={hintStyle}>未填写</p> : (
          <ul>{ideologies.map((ie, i) => <li key={i}>🌟 {ie}</li>)}</ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h4 style={{ marginTop: 0, marginBottom: 10, color: '#374151', fontSize: 15, borderLeft: '3px solid #3b82f6', paddingLeft: 10 }}>{title}</h4>
      {children}
    </div>
  );
}

/* 编辑视图 —— 关键字段直接表单编辑 */
function DesignEditor({ design, updateField }) {
  const obj = design.teachingObjectives || {};
  return (
    <div style={{ padding: 8 }}>
      <Section title="教学目标（每行一条）">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <EditTextarea label="知识目标" value={arrToText(obj.knowledge)} onChange={(v) => updateField('teachingObjectives.knowledge', textToArr(v))} />
          <EditTextarea label="技能目标" value={arrToText(obj.skill)}     onChange={(v) => updateField('teachingObjectives.skill', textToArr(v))} />
          <EditTextarea label="素养目标" value={arrToText(obj.emotion)}   onChange={(v) => updateField('teachingObjectives.emotion', textToArr(v))} />
        </div>
      </Section>

      <Section title="教学重点 / 难点（每行一条）">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <EditTextarea label="教学重点" value={arrToText(design.keyPoints)} onChange={(v) => updateField('keyPoints', textToArr(v))} />
          <EditTextarea label="教学难点" value={arrToText(design.difficulties)} onChange={(v) => updateField('difficulties', textToArr(v))} />
        </div>
      </Section>

      <Section title="课中 5 段法 · 老师可改各段时长 / 教师活动 / 学生活动 / 评价">
        {/* 2026-05-15 老师反馈 4.5：原 1×4 横排太挤（每列只有 ~150px），改为 卡片标题 + 段时长一行 + 三列大块 textarea */}
        {arr(design.inClass?.phases).map((ph, i) => (
          <div key={i} style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
            padding: 14, marginBottom: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}>
            {/* 第一行：段名 + 时长 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, paddingBottom: 10, borderBottom: '1px dashed #e5e7eb' }}>
              <div style={{
                background: '#2563eb', color: '#fff', borderRadius: 4,
                padding: '4px 10px', fontWeight: 600, fontSize: 13, minWidth: 32, textAlign: 'center',
              }}>{i + 1}</div>
              <div style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{ph.phase}</div>
              <label style={{ fontSize: 12, color: '#6b7280' }}>段时长：</label>
              <input
                placeholder="如 10 分钟"
                value={ph.duration || ''}
                onChange={(e) => updateField(`inClass.phases.${i}.duration`, e.target.value)}
                style={{ width: 130, padding: '4px 8px', fontSize: 13 }}
              />
            </div>
            {/* 第二行：三列 textarea（教师活动 / 学生活动 / 设计意图）—— 2026-05-15 v4.1.4 高度加大、占位提示对齐周成锦样例 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label className="v2-label" style={{ fontSize: 12, marginBottom: 4 }}>👨‍🏫 教师活动</label>
                <textarea
                  placeholder="3-4 条编号要点，每条 60-180 字，含教师动作 + 引导话术 + 配合素材。例：1. 设疑激趣：'走进一家店铺...' 2. 概念初识：展示 POP 海报案例..."
                  value={ph.teacherActions || ''}
                  onChange={(e) => updateField(`inClass.phases.${i}.teacherActions`, e.target.value)}
                  rows={5}
                  style={{ width: '100%', minHeight: 100, fontSize: 13 }}
                />
              </div>
              <div>
                <label className="v2-label" style={{ fontSize: 12, marginBottom: 4 }}>🧑‍🎓 学生活动</label>
                <textarea
                  placeholder="3-4 条编号要点，每条 50-150 字。学生具体行为（看/想/答/做/写），与教师活动一一对应"
                  value={ph.studentActions || ''}
                  onChange={(e) => updateField(`inClass.phases.${i}.studentActions`, e.target.value)}
                  rows={5}
                  style={{ width: '100%', minHeight: 100, fontSize: 13 }}
                />
              </div>
              <div>
                {/* 2026-05-15 v4.1.4：原"评价方式"改为"设计意图"（按周成锦老师 POP 设计样例对齐） */}
                <label className="v2-label" style={{ fontSize: 12, marginBottom: 4 }}>💡 设计意图</label>
                <textarea
                  placeholder="为什么这段要这样设计——含教育学原理 / 学习心理 / 职业能力培养逻辑（3-4 条编号要点，每条 80-200 字）"
                  value={ph.designIntent ?? ph.evaluation ?? ''}
                  onChange={(e) => updateField(`inClass.phases.${i}.designIntent`, e.target.value)}
                  rows={5}
                  style={{ width: '100%', minHeight: 100, fontSize: 13 }}
                />
              </div>
            </div>
          </div>
        ))}
      </Section>

      <Section title="思政元素（每行一条）">
        <EditTextarea label="" value={arrToText(design.ideologicalElements)}
          onChange={(v) => updateField('ideologicalElements', textToArr(v))} rows={3} />
      </Section>

      <p style={{ marginTop: 16, color: '#6b7280', fontSize: 13 }}>
        ⚠ 编辑完成后请点上方"<strong>保存</strong>"按钮把改动写回 artifact。复杂修改（教学方法表 / 考核权重）请用 JSON 编辑模式。
      </p>
    </div>
  );
}

function EditTextarea({ label, value, onChange, rows = 4 }) {
  return (
    <div>
      {label ? <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4, fontWeight: 600 }}>{label}</label> : null}
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', fontSize: 13, padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'inherit' }} />
    </div>
  );
}

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thStyle = { background: '#D5E8F0', padding: '8px 10px', border: '1px solid #BBBBBB', fontWeight: 600, textAlign: 'center' };
const tdStyle = { padding: '6px 10px', border: '1px solid #BBBBBB', verticalAlign: 'middle' };
const tdCenterStyle = { ...tdStyle, textAlign: 'center', whiteSpace: 'nowrap' };
const trEvenStyle = { background: '#FFFFFF' };
const trOddStyle = { background: '#FAFBFC' };
const hintStyle = { color: '#9ca3af', fontSize: 13 };
