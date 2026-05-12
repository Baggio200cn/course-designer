/**
 * ScheduleStage — 教学进度表阶段（驭课 Agent v4.0.0 / Phase-9 C-1）
 *
 * 核心职责：
 *   - 起点阶段（无上游依赖）
 *   - AI 生成 6 列表格（周次/课次/章节/内容/方式/作业次数）
 *   - 老师可视化预览 + 编辑 + 保存 + 确认（解锁 design）+ 导出 Word
 */
import React, { useState } from 'react';
import ArtifactPanel from './ArtifactPanel';

export default function ScheduleStage({
  scheduleState,
  setScheduleState,
  assistantStatus,
  busy,
  handleGenerateSchedule,
  handleSaveSchedule,
  handleConfirmSchedule,
  handleExportScheduleWord,
  artifacts,
  dt,
  api,
  courseName,
}) {
  const schedule = scheduleState.schedule || null;
  const rows = (schedule?.schedule || []);
  const header = schedule?.header || {};
  const evaluation = schedule?.evaluation || {};

  const chapters = Array.from(new Set(rows.map((r) => r.chapter).filter(Boolean)));
  const expCount = (schedule?.experimentTopics || []).length;

  // 显示模式：表格预览 / JSON 编辑（默认表格预览，老师可切换）
  const [viewMode, setViewMode] = useState('table');

  return (
    <section className="v2-stage-layout">
      <div className="v2-stage-center">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>教学进度表</h3>
            <span className="v2-hint">按周排课，覆盖整学期 18 周（默认 72 学时）。这是 6 阶段工作流的起点。</span>
          </div>
          <div className="v2-status-box">
            <span>助手状态</span>
            <strong>{assistantStatus}</strong>
          </div>
          <div className="v2-grid-two">
            <div>
              <label className="v2-label">课程名称</label>
              <input value={courseName || ''} disabled placeholder="（来自笔记本）" />
            </div>
            <div>
              <label className="v2-label">学校简称</label>
              <input
                value={scheduleState.school || '广州纺校'}
                onChange={(e) => setScheduleState((prev) => ({ ...prev, school: e.target.value }))}
              />
            </div>
            <div>
              <label className="v2-label">总学时</label>
              <input
                type="number"
                value={scheduleState.totalHours || 72}
                onChange={(e) => setScheduleState((prev) => ({ ...prev, totalHours: Number(e.target.value) || 72 }))}
              />
            </div>
            <div>
              <label className="v2-label">教材（可选）</label>
              <input
                value={scheduleState.textbook || ''}
                onChange={(e) => setScheduleState((prev) => ({ ...prev, textbook: e.target.value }))}
                placeholder="例如：《时尚传播学》"
              />
            </div>
          </div>
          <div className="v2-inline-actions v2-field-top-gap">
            <button className="v2-btn v2-btn-primary" onClick={handleGenerateSchedule} disabled={busy}>
              {schedule ? '重新生成进度表' : '生成进度表'}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={() => handleSaveSchedule(scheduleState)} disabled={!schedule}>
              保存
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleConfirmSchedule} disabled={!scheduleState.artifactId}>
              {scheduleState.confirmed ? '✓ 已确认' : '确认（解锁教学设计）'}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleExportScheduleWord} disabled={!scheduleState.artifactId}>
              📄 导出 Word
            </button>
          </div>
        </div>

        {/* ── 表格预览 / JSON 编辑切换 ── */}
        {schedule ? (
          <>
            <div className="v2-panel">
              <div className="v2-panel-head">
                <h3>{viewMode === 'table' ? '进度表预览（点表格内单元格可在 JSON 模式下编辑）' : '进度表 JSON（编辑后点保存）'}</h3>
                <div className="v2-inline-actions">
                  <button
                    className={`v2-btn v2-btn-xs ${viewMode === 'table' ? 'v2-btn-primary' : 'v2-btn-secondary'}`}
                    onClick={() => setViewMode('table')}
                  >表格预览</button>
                  <button
                    className={`v2-btn v2-btn-xs ${viewMode === 'json' ? 'v2-btn-primary' : 'v2-btn-secondary'}`}
                    onClick={() => setViewMode('json')}
                  >JSON 编辑</button>
                </div>
              </div>

              {viewMode === 'table' ? (
                <SchedulePreviewTable schedule={schedule} />
              ) : (
                <textarea
                  className="v2-code"
                  rows={22}
                  value={scheduleState.jsonText || ''}
                  onChange={(e) => setScheduleState((prev) => ({ ...prev, jsonText: e.target.value }))}
                  placeholder="生成后这里会显示进度表 JSON。"
                />
              )}
            </div>
          </>
        ) : (
          <div className="v2-panel">
            <p className="v2-hint">尚未生成。点上方"生成进度表"开始（需先在右上角"API 配置"里填好 Ark API Key）。</p>
          </div>
        )}
      </div>

      <div className="v2-stage-right">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>表头信息</h3>
            <span className="v2-hint">来自上方表单，AI 也可能补充</span>
          </div>
          {schedule ? (
            <div className="v2-summary-box">
              <p><strong>课程：</strong>{header.courseName || courseName || '—'}</p>
              <p><strong>学校：</strong>{header.school || '—'}</p>
              <p><strong>教学部：</strong>{header.department || '—'}</p>
              <p><strong>教师：</strong>{header.teacher || '—'}</p>
              <p><strong>班级：</strong>{header.className || '—'}</p>
              <p><strong>学期：</strong>{header.semester || '—'}</p>
              <p><strong>教材：</strong>{header.textbook || '—'}</p>
              <p><strong>学时：</strong>{header.totalHours || 72}（理论 {header.theoryHours || 32} + 实训 {header.practiceHours || 36} + 考核 {header.examHours || 4}）</p>
            </div>
          ) : <p className="v2-hint">尚未生成。</p>}
        </div>

        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>章节速览</h3>
            <span className="v2-hint">章节数 {chapters.length} · 实训类目 {expCount} · 周数 {rows.length}</span>
          </div>
          {chapters.length === 0 ? (
            <p className="v2-hint">尚未生成或无章节信息。</p>
          ) : (
            <ul className="v2-bullet-list">
              {chapters.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
        </div>

        {schedule?.objective ? (
          <div className="v2-panel">
            <div className="v2-panel-head">
              <h3>教学目的</h3>
            </div>
            <p>{schedule.objective}</p>
          </div>
        ) : null}

        <ArtifactPanel
          artifacts={artifacts}
          title="进度表产物"
          hint="artifact_type='schedule_table' / 'schedule_export_word'"
          onOpenFile={(storagePath) => api.openResource(storagePath)}
          dt={dt}
        />
      </div>
    </section>
  );
}

/**
 * SchedulePreviewTable — 6 列教学进度表预览
 */
function SchedulePreviewTable({ schedule }) {
  const rows = schedule?.schedule || [];
  if (rows.length === 0) {
    return <p className="v2-hint">进度表为空。</p>;
  }
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>周次</th>
            <th style={thStyle}>课次</th>
            <th style={thStyle}>授课章节</th>
            <th style={{ ...thStyle, minWidth: 220 }}>教学内容</th>
            <th style={thStyle}>授课方式</th>
            <th style={thStyle}>作业次数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={i % 2 === 0 ? trEvenStyle : trOddStyle}>
              <td style={tdCenterStyle}>{r.week ?? '—'}</td>
              <td style={tdCenterStyle}>{r.session ?? '—'}</td>
              <td style={tdCenterStyle}>{r.chapter || '—'}</td>
              <td style={tdStyle}>{r.content || '—'}</td>
              <td style={tdCenterStyle}>{r.method || '—'}</td>
              <td style={tdCenterStyle}>{r.homework === 0 || r.homework == null ? '/' : r.homework}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {schedule?.evaluation?.components && schedule?.evaluation?.weights ? (
        <>
          <h4 style={{ marginTop: 20, marginBottom: 8, color: '#374151' }}>考核评价</h4>
          <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 8 }}>{schedule.evaluation.approach || ''}</p>
          <table style={{ ...tableStyle, maxWidth: 480 }}>
            <thead>
              <tr>
                <th style={thStyle}>考核项</th>
                <th style={thStyle}>权重</th>
              </tr>
            </thead>
            <tbody>
              {schedule.evaluation.components.map((name, i) => (
                <tr key={i} style={i % 2 === 0 ? trEvenStyle : trOddStyle}>
                  <td style={tdStyle}>{name}</td>
                  <td style={tdCenterStyle}>{schedule.evaluation.weights[name] || 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  fontFamily: 'Microsoft YaHei, sans-serif',
};
const thStyle = {
  background: '#D5E8F0',
  padding: '8px 10px',
  border: '1px solid #BBBBBB',
  fontWeight: 600,
  textAlign: 'center',
  whiteSpace: 'nowrap',
};
const tdStyle = {
  padding: '6px 10px',
  border: '1px solid #BBBBBB',
  verticalAlign: 'middle',
};
const tdCenterStyle = { ...tdStyle, textAlign: 'center', whiteSpace: 'nowrap' };
const trEvenStyle = { background: '#FFFFFF' };
const trOddStyle = { background: '#FAFBFC' };
