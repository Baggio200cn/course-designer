/**
 * MyWorkbench.jsx — 教师日志（2026-05-16 v4.2.0 重写）
 *
 * 老师需求（明确）：
 *   1. 建立新进度表 → 实时记录在这里
 *   2. 找历史资料 → 在工作台找
 *   3. 随时打开 / 调取 / 重新进入驭课工作界面
 *   4. 每个历史文件可一键打开
 *
 * UI 结构（新）：
 *   - 顶部：全局统计（课程数 / 6 stage 完成度 / 经验沉淀）
 *   - 中部：课程列表（每张卡片可展开）
 *     - 卡片头：名称 + 学时 + 6 个 stage 状态点 + "打开"按钮
 *     - 展开：最近 N 条 artifact 列表（每条可"📂 打开文件"或"🎯 跳回 stage"）
 *   - 底部：经验沉淀
 *
 * 关键交互：
 *   - 点 "🎯 跳回 stage" → 调 workbench:openHistoryArtifact → 更新 session → onOpenNotebook(notebookId, stage)
 */

import React, { useEffect, useState, useMemo } from 'react';

const STAGE_LABELS = {
  schedule: { label: '进度表', icon: '📅', color: '#3B82F6' },
  design:   { label: '教学设计', icon: '🎯', color: '#10B981' },
  ppt:      { label: '课件',    icon: '📊', color: '#8B5CF6' },
  lecture:  { label: '讲稿',    icon: '🎤', color: '#F59E0B' },
  quiz:     { label: '测验',    icon: '📝', color: '#EF4444' },  // v4.3.3
  homework: { label: '作业',    icon: '📚', color: '#14B8A6' },  // v4.3.3
  video:    { label: '微课',    icon: '🎬', color: '#EC4899' },
  report:   { label: '报告',    icon: '📝', color: '#06B6D4' },
};

export default function MyWorkbench({ api, onClose, onOpenNotebook }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedNotebookId, setExpandedNotebookId] = useState(null);
  const [filterText, setFilterText] = useState('');
  const [filterStage, setFilterStage] = useState('all');  // all | schedule | design | ...
  const [jumpingArtifactId, setJumpingArtifactId] = useState(null);
  // v4.3.3 P0-1：跨版本数据找回
  const [recoverable, setRecoverable] = useState([]);
  const [showRecoverPanel, setShowRecoverPanel] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await api.workbenchGetStats();
      if (res?.success) setStats(res.data);
      else setError(res?.error || '加载失败');
      // P0-1：并发拉可恢复列表
      if (typeof api.workbenchListRecoverable === 'function') {
        const rec = await api.workbenchListRecoverable();
        if (rec?.success) setRecoverable(rec.data?.recoverable || []);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);  // eslint-disable-line

  // v4.3.3 P0-1：把某个 recoverable artifact 恢复到 draft
  const handleRestore = async (artifactId, title) => {
    if (!window.confirm(`确定恢复《${title || '未命名'}》？\n\n会把它的 status 从 'deleted' 改回 'draft'，下次刷新就能在对应阶段看到它。`)) return;
    if (typeof api.workbenchRestoreArtifact !== 'function') {
      window.alert('恢复 API 未注入，请完整重启 Electron');
      return;
    }
    const res = await api.workbenchRestoreArtifact({ artifactId });
    if (!res?.success) {
      window.alert(`恢复失败：${res?.error || '未知'}`);
      return;
    }
    // 从前端列表移除
    setRecoverable((prev) => prev.filter((r) => Number(r.id) !== Number(artifactId)));
    await reload();
  };

  // 过滤课程列表
  const filteredCourses = useMemo(() => {
    if (!stats?.courses) return [];
    let list = stats.courses;
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter((c) => String(c.name || '').toLowerCase().includes(q));
    }
    if (filterStage !== 'all') {
      list = list.filter((c) => c.stageStatus?.[filterStage]?.generated);
    }
    return list;
  }, [stats, filterText, filterStage]);

  // 一键跳回 stage（更新 session + 关闭工作台 + 跳到对应 stage）
  const handleJumpToArtifact = async (notebookId, artifact) => {
    setJumpingArtifactId(artifact.id);
    try {
      // 调后端写 session
      const res = await api.workbenchOpenHistoryArtifact({ notebookId, artifactId: artifact.id });
      if (!res?.success) {
        window.alert(`跳转失败：${res?.error || '未知错误'}`);
        return;
      }
      const stage = res.data?.stage || artifact.stage || 'design';
      // 关闭工作台，触发父组件打开对应 notebook + stage
      onClose?.();
      if (typeof onOpenNotebook === 'function') {
        onOpenNotebook(notebookId, stage);
      }
    } finally {
      setJumpingArtifactId(null);
    }
  };

  // 打开磁盘文件
  const handleOpenFile = async (storagePath) => {
    if (!storagePath) return;
    if (typeof api.openResource === 'function') {
      api.openResource(storagePath);
    }
  };

  if (loading) {
    return (
      <ModalShell title="📊 教师日志" onClose={onClose}>
        <div style={loadingStyle}>加载中…</div>
      </ModalShell>
    );
  }
  if (error) {
    return (
      <ModalShell title="📊 教师日志" onClose={onClose}>
        <div style={{ ...loadingStyle, color: '#dc2626' }}>❌ 加载失败：{error}</div>
        <button onClick={reload} className="v2-btn v2-btn-primary" style={{ margin: '12px auto', display: 'block' }}>重试</button>
      </ModalShell>
    );
  }
  if (!stats || stats.totalNotebooks === 0) {
    return (
      <ModalShell title="📊 教师日志" onClose={onClose}>
        <div style={emptyStyle}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌱</div>
          <h3 style={{ margin: '0 0 8px', fontSize: 18, color: '#374151' }}>还没有课程</h3>
          <p style={{ margin: 0, color: '#6b7280' }}>
            去右上角【新建教学进度表】创建你的第一门课，<br />
            这里会记录你的开发进度和经验沉淀。
          </p>
        </div>
      </ModalShell>
    );
  }

  // 主视图
  return (
    <ModalShell title="📊 教师日志" onClose={onClose}>
      {/* ① 顶部概览 */}
      <section style={{ padding: '16px 24px', background: 'linear-gradient(90deg, #EFF6FF 0%, #ECFDF5 100%)', borderBottom: '1px solid #E2E8F0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <StatCard label="📚 总课程数" value={stats.totalNotebooks} hint={`累计 ${stats.totalArtifacts} 个产物`} />
          <StatCard label="✅ 平均完成度" value={`${stats.overallCompletionRate}%`} hint="6 个阶段都确认 = 100%" />
          <StatCard label="🧠 经验沉淀" value={stats.totalMemories || 0} hint="可被下次相似课程参考" />
        </div>
        {/* 6 个 stage 完成数 mini-bar */}
        <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(STAGE_LABELS).map(([key, meta]) => {
            const count = stats.stageCompletion?.[key] || 0;
            const pct = stats.totalNotebooks > 0 ? Math.round((count / stats.totalNotebooks) * 100) : 0;
            return (
              <div key={key} style={{
                flex: '1 1 0', minWidth: 100,
                background: '#fff', border: `1px solid ${meta.color}33`, borderRadius: 6,
                padding: '6px 10px',
              }}>
                <div style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{meta.icon} {meta.label}</span>
                  <span style={{ color: meta.color, fontWeight: 700 }}>{count}/{stats.totalNotebooks}</span>
                </div>
                <div style={{ marginTop: 4, height: 4, background: '#F1F5F9', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: meta.color, transition: 'width 0.3s' }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* v4.3.3 P0-1：跨版本数据找回 banner */}
      {recoverable.length > 0 ? (
        <section style={{ padding: '12px 24px', background: '#FEF3C7', borderBottom: '1px solid #FCD34D' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ color: '#92400E', fontSize: 14 }}>🔍 找回历史数据</strong>
              <span style={{ marginLeft: 12, fontSize: 12, color: '#78350F' }}>
                扫描到 {recoverable.length} 个旧版本可能"丢失"的产物（如老师反馈的 4.1.4 → 4.3.x 教学设计消失）
              </span>
            </div>
            <button
              onClick={() => setShowRecoverPanel((v) => !v)}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                background: showRecoverPanel ? '#92400E' : '#FBBF24',
                color: showRecoverPanel ? 'white' : '#78350F',
                border: 'none', borderRadius: 4, cursor: 'pointer',
              }}
            >{showRecoverPanel ? '收起列表' : '展开查看'}</button>
          </div>
          {showRecoverPanel ? (
            <div style={{ marginTop: 12, maxHeight: 360, overflow: 'auto', background: '#fff', border: '1px solid #FCD34D', borderRadius: 6, padding: 10 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#FFFBEB', color: '#92400E' }}>
                    <th style={{ padding: 6, textAlign: 'left', borderBottom: '1px solid #FCD34D' }}>标题</th>
                    <th style={{ padding: 6, textAlign: 'left', borderBottom: '1px solid #FCD34D' }}>类型</th>
                    <th style={{ padding: 6, textAlign: 'left', borderBottom: '1px solid #FCD34D' }}>NotebookID</th>
                    <th style={{ padding: 6, textAlign: 'left', borderBottom: '1px solid #FCD34D' }}>内容字节</th>
                    <th style={{ padding: 6, textAlign: 'left', borderBottom: '1px solid #FCD34D' }}>原因</th>
                    <th style={{ padding: 6, textAlign: 'center', borderBottom: '1px solid #FCD34D' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {recoverable.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: 6 }}>{r.title}</td>
                      <td style={{ padding: 6, color: '#64748B' }}>{r.type}</td>
                      <td style={{ padding: 6, color: '#64748B' }}>{r.notebookId || '(无)'}</td>
                      <td style={{ padding: 6, color: '#16A34A', fontWeight: 600 }}>{r.contentSize}</td>
                      <td style={{ padding: 6, color: '#DC2626', fontSize: 11 }}>{(r.reasons || []).join(' · ')}</td>
                      <td style={{ padding: 6, textAlign: 'center' }}>
                        <button
                          onClick={() => handleRestore(r.id, r.title)}
                          style={{
                            padding: '3px 10px', fontSize: 11, fontWeight: 600,
                            background: '#16A34A', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer',
                          }}
                        >↩ 恢复</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ② 过滤条 */}
      <section style={{ padding: '12px 24px', borderBottom: '1px solid #E2E8F0', background: '#fff', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="🔍 课程名搜索…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{ flex: '1 1 200px', padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 13 }}
        />
        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 13 }}
        >
          <option value="all">全部 stage</option>
          {Object.entries(STAGE_LABELS).map(([key, meta]) => (
            <option key={key} value={key}>{meta.icon} {meta.label}已生成</option>
          ))}
        </select>
        <button onClick={reload} className="v2-btn v2-btn-xs" title="刷新数据">🔄</button>
        <span style={{ marginLeft: 'auto', color: '#94A3B8', fontSize: 12 }}>
          {filteredCourses.length} / {stats.totalNotebooks} 门课程
        </span>
      </section>

      {/* ③ 课程列表（可展开） */}
      <section style={{ flex: 1, overflowY: 'auto', padding: '12px 24px', background: '#F8FAFC' }}>
        {filteredCourses.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94A3B8', padding: 40 }}>没有匹配的课程</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredCourses.map((course) => (
              <CourseCard
                key={course.notebookId}
                course={course}
                expanded={expandedNotebookId === course.notebookId}
                onToggleExpand={() => setExpandedNotebookId((id) => id === course.notebookId ? null : course.notebookId)}
                onOpenNotebook={() => {
                  onClose?.();
                  onOpenNotebook?.(course.notebookId);
                }}
                onJumpToArtifact={(art) => handleJumpToArtifact(course.notebookId, art)}
                onOpenFile={handleOpenFile}
                jumpingArtifactId={jumpingArtifactId}
              />
            ))}
          </div>
        )}
      </section>

      {/* ④ 经验沉淀（折叠在底部） */}
      {stats.totalMemories > 0 ? (
        <section style={{ padding: '12px 24px', background: '#FFFBEB', borderTop: '1px solid #FCD34D', maxHeight: 140, overflowY: 'auto' }}>
          <div style={{ fontSize: 12, color: '#92400E', fontWeight: 700, marginBottom: 6 }}>
            🧠 经验沉淀（{stats.totalMemories} 条，最近 10）
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(stats.memories || []).slice(0, 10).map((m, i) => (
              <div key={i} style={{ fontSize: 11, color: '#475569', padding: '4px 8px', background: '#fff', borderRadius: 4, border: '1px solid #FDE68A' }}>
                <strong>{m.title || '经验'}：</strong>{String(m.content || '').slice(0, 100)}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </ModalShell>
  );
}

/* ─────────────────────────────────────────────
   课程卡片（可展开查看历史 artifact）
───────────────────────────────────────────── */
function CourseCard({ course, expanded, onToggleExpand, onOpenNotebook, onJumpToArtifact, onOpenFile, jumpingArtifactId }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
      overflow: 'hidden',
    }}>
      {/* 卡片头 */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 15, color: '#0F172A' }}>{course.name}</strong>
            <span style={{ fontSize: 11, color: '#94A3B8' }}>{course.totalHours} 学时</span>
            {course.memorySaved ? <span title="已沉淀经验" style={{ fontSize: 12 }}>🧠</span> : null}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
            {course.updatedAt ? `更新于 ${new Date(course.updatedAt).toLocaleString('zh-CN', { hour12: false }).slice(0, 16)}` : ''}
            {' · '}
            <span style={{ color: '#16A34A', fontWeight: 600 }}>{course.confirmedCount}/6 已确认</span>
            {' · '}
            <span style={{ color: '#475569' }}>{course.recentArtifacts?.length || 0} 个历史产物</span>
          </div>
          {/* 6 个 stage dots */}
          <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
            {Object.entries(STAGE_LABELS).map(([key, meta]) => {
              const st = course.stageStatus?.[key] || {};
              const tone = st.confirmed ? 'done' : (st.generated ? 'partial' : 'empty');
              const bg = tone === 'done' ? meta.color : (tone === 'partial' ? meta.color + '55' : '#E2E8F0');
              const fg = tone === 'empty' ? '#94A3B8' : '#fff';
              return (
                <span
                  key={key}
                  title={`${meta.label}: ${tone === 'done' ? '✓ 已确认' : (tone === 'partial' ? '已生成未确认' : '未开始')} (${st.count || 0} 个产物)`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    padding: '2px 7px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                    background: bg, color: fg,
                  }}
                >
                  {meta.icon} {meta.label}
                  {st.confirmed ? ' ✓' : (st.generated ? ' ·' : '')}
                </span>
              );
            })}
          </div>
        </div>
        {/* 右侧操作 */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            className="v2-btn v2-btn-primary"
            onClick={onOpenNotebook}
            title="打开该课程，回到驭课工作界面"
          >📂 打开课程</button>
          <button
            className="v2-btn v2-btn-secondary"
            onClick={onToggleExpand}
            title={expanded ? '收起历史产物' : '展开历史产物'}
          >
            {expanded ? '收起 ▴' : `历史 (${course.recentArtifacts?.length || 0}) ▾`}
          </button>
        </div>
      </div>

      {/* 展开：历史 artifact 列表 */}
      {expanded ? (
        <div style={{ borderTop: '1px dashed #CBD5E1', padding: '10px 16px', background: '#F8FAFC' }}>
          {(course.recentArtifacts || []).length === 0 ? (
            <p style={{ fontSize: 12, color: '#94A3B8', margin: 0, textAlign: 'center', padding: 12 }}>暂无历史产物</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {course.recentArtifacts.map((art) => (
                <ArtifactRow
                  key={art.id}
                  art={art}
                  onJump={() => onJumpToArtifact(art)}
                  onOpenFile={() => onOpenFile(art.storagePath)}
                  jumping={jumpingArtifactId === art.id}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────
   单条 artifact 行
───────────────────────────────────────────── */
function ArtifactRow({ art, onJump, onOpenFile, jumping }) {
  const stageMeta = STAGE_LABELS[art.stage] || { color: '#94A3B8', icon: '📄' };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px', background: '#fff',
      border: '1px solid #E2E8F0', borderRadius: 4,
      fontSize: 12,
    }}>
      <span style={{ fontSize: 14 }}>{stageMeta.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#0F172A', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {art.title || '未命名'}
          {art.lessonNumber ? <span style={{ color: stageMeta.color, fontWeight: 700, marginLeft: 6 }}>· 第 {art.lessonNumber} 节</span> : null}
          {art.confirmed ? <span style={{ color: '#16A34A', marginLeft: 6 }} title="已确认">✓</span> : null}
        </div>
        <div style={{ color: '#94A3B8', fontSize: 10, marginTop: 1 }}>
          {art.typeLabel || art.type} · {art.updatedAt ? new Date(art.updatedAt).toLocaleString('zh-CN', { hour12: false }).slice(0, 16) : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {art.storagePath ? (
          <button
            className="v2-btn v2-btn-xs"
            onClick={onOpenFile}
            title={`系统打开：${art.storagePath}`}
            style={{ fontSize: 11 }}
          >📂 文件</button>
        ) : null}
        <button
          className="v2-btn v2-btn-xs"
          onClick={onJump}
          disabled={jumping}
          title="跳回该 stage 并加载这个产物到编辑器"
          style={{ fontSize: 11, background: '#DBEAFE', borderColor: '#3B82F6', color: '#1E40AF' }}
        >{jumping ? '跳转中…' : '🎯 跳回'}</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   通用组件
───────────────────────────────────────────── */
function StatCard({ label, value, hint }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 11, color: '#64748B' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>{value}</div>
      {hint ? <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <header style={headerStyle}>
          <h2 style={titleStyle}>{title}</h2>
          <button onClick={onClose} style={closeBtnStyle}>✕ 关闭</button>
        </header>
        {children}
      </div>
    </div>
  );
}

// ── 样式常量 ─────────────────────────────────────────────────────────────
const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const panelStyle = {
  background: '#fff', borderRadius: 12, width: '92vw', maxWidth: 1100,
  height: '88vh', display: 'flex', flexDirection: 'column',
  boxShadow: '0 20px 50px rgba(15,23,42,0.3)', overflow: 'hidden',
};
const headerStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 24px', borderBottom: '1px solid #E2E8F0', background: '#fff',
};
const titleStyle = { margin: 0, fontSize: 18, color: '#0F172A', fontWeight: 700 };
const closeBtnStyle = {
  background: 'transparent', border: '1px solid #CBD5E1', padding: '4px 12px',
  borderRadius: 4, cursor: 'pointer', fontSize: 13, color: '#475569',
};
const loadingStyle = { padding: 40, textAlign: 'center', color: '#6B7280' };
const emptyStyle = { padding: 60, textAlign: 'center' };
