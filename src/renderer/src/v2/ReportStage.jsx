/**
 * ReportStage — 教学实施报告阶段（驭课 Agent v4.3.3 8 阶段流程）
 *
 * 8 阶段的最终阶段，无下游解锁。
 *
 * UI 三视图：📝 文字预览 / ✏️ 编辑（含老师手填）/ { } JSON
 * 导出 4 格式：📄 Word / 📋 Markdown / 🌐 HTML / 📕 PDF
 *
 * 老师手填的关键区块：
 *   - implementationOutcomes（5 项实施成效）
 *   - reflectionAndImprovement（4 项反思改进）
 */
import React, { useState, useEffect } from 'react';
import AssistantStatusAvatar from './AssistantStatusAvatar';
import ArtifactPanel from './ArtifactPanel';
// v4.3.3 新版 · 报告最大化预览
import { PreviewFullscreen, PreviewFullscreenToggle } from './PreviewFullscreen';

const OUTCOME_LABELS = {
  studentEngagement: '学生参与度',
  workCompletion: '作品完成度',
  skillTransfer: '技能迁移',
  industryAlignment: '行业对接',
  ideologicalImpact: '思政育人',
};

const REFLECTION_LABELS = {
  achievements: '主要成效',
  issues: '存在问题',
  improvements: '改进措施',
  futurePlans: '未来规划',
};

function arr(v) { return Array.isArray(v) ? v : []; }
function arrToText(v) { return Array.isArray(v) ? v.join('\n') : ''; }
function textToArr(t) { return String(t || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean); }

export default function ReportStage({
  reportState,
  setReportState,
  assistantStatus,
  busy,
  handleGenerateReport,
  handleSaveReport,
  handleConfirmReport,
  handleExportReport,    // 新：(format: 'word'|'markdown'|'html'|'pdf') => void
  artifacts,
  dt,
  api,
  courseName,
}) {
  const report = reportState.report || null;
  const [viewMode, setViewMode] = useState('preview');  // preview | edit | json
  // v4.3.3 新版：报告最大化预览
  const [previewFs, setPreviewFs] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingFormat, setExportingFormat] = useState(null);

  useEffect(() => { setDirty(false); }, [reportState.artifactId]);

  const upstreamCount = report?._stats?.upstreamCount ?? 0;
  const fillProgress = report?._stats?.teacherFillProgress || { filled: 0, totalSlots: 9, ratio: 0 };
  const outcomes = report?.implementationOutcomes || {};
  const reflection = report?.reflectionAndImprovement || {};

  // 编辑通用函数（路径式更新）
  const updatePath = (path, value) => {
    setDirty(true);
    setReportState((prev) => {
      const r = JSON.parse(JSON.stringify(prev.report || {}));
      const segs = path.split('.');
      let cursor = r;
      for (let i = 0; i < segs.length - 1; i++) {
        if (!cursor[segs[i]]) cursor[segs[i]] = {};
        cursor = cursor[segs[i]];
      }
      cursor[segs[segs.length - 1]] = value;
      return { ...prev, report: r };
    });
  };

  const updateOutcome = (key, field, value) => updatePath(`implementationOutcomes.${key}.${field}`, value);
  const updateReflection = (key, value) => updatePath(`reflectionAndImprovement.${key}`, textToArr(value));

  const onSave = async () => {
    if (!report) return;
    setSaving(true);
    try {
      await handleSaveReport(reportState);
      setDirty(false);
    } finally { setSaving(false); }
  };

  const onExport = async (format) => {
    // v4.3.3 导出守卫（老师测试 2026-05-30）：有未保存改动时先提示保存，
    //   避免导出"上次保存版"（不含新改动）——这是老师误以为"内容丢了"的根源。
    //   导出读的是 DB 里最新已保存的报告，先 onSave 落库再导出，保证导出=当前编辑内容。
    if (dirty) {
      const ok = window.confirm(
        '当前有未保存修改。导出读取的是"上次保存版"，不含这些新改动。\n\n' +
        '点"确定"先保存再导出（推荐）；点"取消"放弃本次导出。'
      );
      if (!ok) return;
      await onSave();
    }
    setExportingFormat(format);
    try {
      await handleExportReport(format);
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <section className="v2-stage-layout">
      <div className="v2-stage-center">
        {/* 顶部操作面板 */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>教学实施报告（最终阶段）</h3>
            <span className="v2-hint">AI 自动汇总前 5 阶段 + 老师手填 9 项 + 4 格式导出</span>
          </div>
          <div className="v2-status-box">
            <span>助手状态</span>
            <AssistantStatusAvatar stage="report" status={assistantStatus} />
          </div>
          <div className="v2-inline-actions v2-field-top-gap">
            <button className="v2-btn v2-btn-primary" onClick={handleGenerateReport} disabled={busy}>
              {report ? '重新生成（汇总区）' : '基于前 5 阶段生成报告'}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={onSave} disabled={saving || !report}>
              {saving ? '⏳ 保存中…' : (dirty ? '💾 保存修改' : '✓ 已保存')}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleConfirmReport} disabled={!reportState.artifactId}>
              {reportState.confirmed ? '✓ 已归档' : '确认（归档）'}
            </button>
          </div>

          {/* 4 格式导出按钮组 */}
          {report ? (
            <div style={{
              marginTop: 12, padding: 10,
              background: '#f0f9ff', border: '1px solid #93c5fd', borderRadius: 6,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e3a8a', marginBottom: 8 }}>
                📤 导出报告（4 种格式可选）
              </div>
              <div className="v2-inline-actions">
                <button
                  className="v2-btn v2-btn-secondary"
                  onClick={() => onExport('word')}
                  disabled={exportingFormat !== null || !reportState.artifactId}
                >{exportingFormat === 'word' ? '⏳ 生成中…' : '📄 Word (.docx)'}</button>
                <button
                  className="v2-btn v2-btn-secondary"
                  onClick={() => onExport('markdown')}
                  disabled={exportingFormat !== null || !reportState.artifactId}
                >{exportingFormat === 'markdown' ? '⏳ 生成中…' : '📋 Markdown (.md)'}</button>
                <button
                  className="v2-btn v2-btn-secondary"
                  onClick={() => onExport('html')}
                  disabled={exportingFormat !== null || !reportState.artifactId}
                >{exportingFormat === 'html' ? '⏳ 生成中…' : '🌐 HTML (.html)'}</button>
                <button
                  className="v2-btn v2-btn-secondary"
                  onClick={() => onExport('pdf')}
                  disabled={exportingFormat !== null || !reportState.artifactId}
                >{exportingFormat === 'pdf' ? '⏳ 生成中…' : '📕 PDF (.pdf)'}</button>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                * 导出前请先点"💾 保存修改"，避免老师手填内容丢失
              </div>
            </div>
          ) : null}
        </div>

        {/* 概览统计 */}
        <div className="v2-stage-banner stage-report">
          <div className="v2-stage-banner-copy">
            <span>报告概览</span>
            <strong>{report?.courseName || courseName || '本课程'}</strong>
            <p>上游 artifact {upstreamCount}/5 · 老师手填 {fillProgress.filled}/{fillProgress.totalSlots}</p>
          </div>
          <div className="v2-metric-grid">
            <div className="v2-metric-card"><span>已生成</span><strong>{report ? '是' : '否'}</strong></div>
            <div className="v2-metric-card"><span>填写进度</span><strong>{Math.round((fillProgress.ratio || 0) * 100)}%</strong></div>
            <div className="v2-metric-card"><span>已确认</span><strong>{reportState.confirmed ? '是' : '否'}</strong></div>
          </div>
        </div>

        {/* 三视图切换 */}
        {report ? (
          <div className="v2-panel">
            <div className="v2-panel-head">
              <h3>报告内容</h3>
              <div className="v2-inline-actions">
                <button
                  className={`v2-btn v2-btn-xs ${viewMode === 'preview' ? 'v2-btn-primary' : 'v2-btn-secondary'}`}
                  onClick={() => setViewMode('preview')}
                >📝 文字预览</button>
                <button
                  className={`v2-btn v2-btn-xs ${viewMode === 'edit' ? 'v2-btn-primary' : 'v2-btn-secondary'}`}
                  onClick={() => setViewMode('edit')}
                >✏️ 编辑（含手填）</button>
                <button
                  className={`v2-btn v2-btn-xs ${viewMode === 'json' ? 'v2-btn-primary' : 'v2-btn-secondary'}`}
                  onClick={() => setViewMode('json')}
                >{ } JSON</button>
                {/* v4.3.3 新版 · 报告最大化预览 */}
                {viewMode === 'preview' && (
                  <PreviewFullscreenToggle isFullscreen={previewFs} onToggle={setPreviewFs} />
                )}
              </div>
            </div>

            {viewMode === 'preview' && (
              <div className="v2-preview-enhanced">
                <ReportPreview report={report} />
              </div>
            )}
            {viewMode === 'edit'    && (
              <ReportEditor
                report={report}
                outcomes={outcomes}
                reflection={reflection}
                updatePath={updatePath}
                updateOutcome={updateOutcome}
                updateReflection={updateReflection}
              />
            )}
            {viewMode === 'json' && (
              <textarea
                className="v2-code"
                rows={22}
                value={JSON.stringify(report, null, 2)}
                onChange={(e) => {
                  setDirty(true);
                  try {
                    const parsed = JSON.parse(e.target.value);
                    setReportState((p) => ({ ...p, report: parsed }));
                  } catch {/* 忽略到下次粘贴/纠正 */}
                }}
              />
            )}

            {/* 底部状态条 */}
            <div style={{
              marginTop: 12, padding: 10,
              background: dirty ? '#fef3c7' : '#f0fdf4',
              border: `1px solid ${dirty ? '#f59e0b' : '#86efac'}`,
              borderRadius: 6,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: dirty ? '#92400e' : '#166534' }}>
                {dirty ? '⚠ 有未保存修改' : '✓ 当前内容已保存'}
              </span>
              <button
                className="v2-btn v2-btn-primary"
                onClick={onSave}
                disabled={!dirty || saving}
              >{saving ? '⏳ 保存中…' : (dirty ? '💾 保存修改' : '✓ 已保存')}</button>
            </div>
          </div>
        ) : (
          <div className="v2-panel">
            <p className="v2-hint">尚未生成。点上方"基于前 5 阶段生成报告"开始。</p>
          </div>
        )}
      </div>

      <div className="v2-stage-right">
        <div className="v2-panel">
          <div className="v2-panel-head"><h3>关键指标</h3></div>
          {report ? (
            <div className="v2-summary-box">
              <p><strong>课程：</strong>{report.courseName || '—'}</p>
              <p><strong>学校：</strong>{report.school || '—'}</p>
              <p><strong>学年/学期：</strong>{report.academicYear || '—'} / {report.term || '—'}</p>
              <p><strong>教师：</strong>{report.teacher || '—'}</p>
              <p><strong>上游 artifact：</strong>{upstreamCount}/5</p>
              <p><strong>老师手填：</strong>{fillProgress.filled}/{fillProgress.totalSlots}（{Math.round((fillProgress.ratio || 0) * 100)}%）</p>
              <p><strong>已归档：</strong>{reportState.confirmed ? '是 ⭐' : '否'}</p>
            </div>
          ) : <p className="v2-hint">尚未生成</p>}
        </div>

        <ArtifactPanel
          artifacts={artifacts}
          title="实施报告产物"
          hint="implementation_report / report_export_*"
          onOpenFile={(storagePath) => api.openResource?.(storagePath)}
          dt={dt}
        />
      </div>

      {/* v4.3.3 新版 · 报告最大化预览（撑满窗口 + 大字号 + 1.75 行距） */}
      {previewFs && report ? (
        <PreviewFullscreen
          title={`教学实施报告预览 · ${report.courseName || '本课程'}`}
          onClose={() => setPreviewFs(false)}
        >
          <ReportPreview report={report} />
        </PreviewFullscreen>
      ) : null}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
 * 文字预览（只读，给老师快速浏览整体）
 * ───────────────────────────────────────────────────────── */
function ReportPreview({ report }) {
  const obj = report.teachingObjectives || {};
  const kd = report.keyPointsAndDifficulties || {};
  const flow = report.preInClassPostFlow || {};
  const info = report.informatization || {};
  const outcomes = report.implementationOutcomes || {};
  const refl = report.reflectionAndImprovement || {};

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 18 }}>
      <h4 style={{ fontSize: 14, color: '#374151', borderLeft: '3px solid #3b82f6', paddingLeft: 10, marginBottom: 8 }}>{title}</h4>
      <div style={{ paddingLeft: 13, fontSize: 13, lineHeight: 1.7, color: '#475569' }}>{children}</div>
    </div>
  );
  const List = ({ items, ordered }) => arr(items).length === 0
    ? <p style={{ color: '#9ca3af', fontStyle: 'italic' }}>（未填）</p>
    : ordered ? <ol style={{ paddingLeft: 18 }}>{arr(items).map((x, i) => <li key={i}>{x}</li>)}</ol>
              : <ul style={{ paddingLeft: 18 }}>{arr(items).map((x, i) => <li key={i}>{x}</li>)}</ul>;

  return (
    <div style={{ padding: 8 }}>
      <Section title="一、教学目标">
        {arr(obj.knowledge).length ? <><strong>知识目标</strong><List items={obj.knowledge} /></> : null}
        {arr(obj.skill).length     ? <><strong>技能目标</strong><List items={obj.skill} /></>     : null}
        {arr(obj.emotion).length   ? <><strong>素养目标</strong><List items={obj.emotion} /></>   : null}
      </Section>

      <Section title="二、教学重点与难点">
        {arr(kd.keyPoints).length ?    <><strong>教学重点</strong><List items={kd.keyPoints} /></> : null}
        {arr(kd.difficulties).length ? <><strong>教学难点</strong><List items={kd.difficulties} /></> : null}
      </Section>

      <Section title="三、教学方法">
        <ul style={{ paddingLeft: 18 }}>
          {arr(report.teachingMethods).map((m, i) => <li key={i}>{m.name}（{m.applicable || '通用'}）</li>)}
        </ul>
      </Section>

      {report.overallArrangement ? (
        <Section title="四、教学过程总体安排">
          <p>{report.overallArrangement}</p>
        </Section>
      ) : null}

      <Section title="五、课前-课中-课后实施流程">
        {flow.preClass?.tasks?.length ? <><strong>课前任务</strong><List items={flow.preClass.tasks} ordered /></> : null}
        {flow.preClass?.outcome ? <p>预期成果：{flow.preClass.outcome}</p> : null}
        {flow.inClassPhases?.length ? (
          <><strong>课中（5 段法）</strong>
          <ul style={{ paddingLeft: 18 }}>
            {flow.inClassPhases.map((ph, i) => <li key={i}><strong>{ph.phase}</strong>：{ph.highlight || '—'}</li>)}
          </ul></>
        ) : null}
        {flow.postClass?.homework?.length ? <><strong>课后任务</strong><List items={flow.postClass.homework} ordered /></> : null}
      </Section>

      <Section title="六、信息化手段">
        {info.platform ? <p>平台：{info.platform}</p> : null}
        {arr(info.tools).length ? <p>工具：{arr(info.tools).join('、')}</p> : null}
        {info.purpose ? <p>目的：{info.purpose}</p> : null}
      </Section>

      {report.microVideoUsage ? (
        <Section title="七、微课视频应用">
          <p>{report.microVideoUsage}</p>
        </Section>
      ) : null}

      <Section title="八、课堂教学实施成效（老师手填）">
        {Object.keys(OUTCOME_LABELS).map((k) => (
          <div key={k} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 600, color: '#0ea5e9', marginBottom: 4 }}>{OUTCOME_LABELS[k]}</div>
            <div style={{ background: '#f0f9ff', padding: 6, borderRadius: 4, marginBottom: 4 }}>
              <strong>达成情况：</strong>{outcomes[k]?.achieved || <span style={{ color: '#9ca3af' }}>（未填）</span>}
            </div>
            <div style={{ background: '#fffbeb', padding: 6, borderRadius: 4 }}>
              <strong>支持证据：</strong>{outcomes[k]?.evidence || <span style={{ color: '#9ca3af' }}>（未填）</span>}
            </div>
          </div>
        ))}
      </Section>

      <Section title="九、反思与改进（老师手填）">
        {Object.keys(REFLECTION_LABELS).map((k) => (
          <div key={k} style={{ marginBottom: 8 }}>
            <strong>{REFLECTION_LABELS[k]}</strong>
            <List items={refl[k]} ordered />
          </div>
        ))}
      </Section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * 编辑视图（含 AI 区编辑 + 老师手填）
 * ───────────────────────────────────────────────────────── */
function ReportEditor({ report, outcomes, reflection, updatePath, updateOutcome, updateReflection }) {
  const obj = report.teachingObjectives || {};
  const kd = report.keyPointsAndDifficulties || {};

  const SectionTitle = ({ children }) => (
    <h4 style={{ marginTop: 18, marginBottom: 10, fontSize: 14, color: '#374151', borderLeft: '3px solid #3b82f6', paddingLeft: 10 }}>{children}</h4>
  );
  const Field = ({ label, children, hint }) => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#475569', fontWeight: 600, marginBottom: 4 }}>{label}{hint ? <span style={{ color: '#9ca3af', fontWeight: 'normal', marginLeft: 6 }}>{hint}</span> : null}</label>
      {children}
    </div>
  );

  return (
    <div style={{ padding: 8 }}>
      <SectionTitle>① 基础信息（AI 提炼，可手改）</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="课程名称"><input value={report.courseName || ''} onChange={(e) => updatePath('courseName', e.target.value)} /></Field>
        <Field label="学校"><input value={report.school || ''} onChange={(e) => updatePath('school', e.target.value)} /></Field>
        <Field label="学年"><input value={report.academicYear || ''} onChange={(e) => updatePath('academicYear', e.target.value)} /></Field>
        <Field label="学期"><input value={report.term || ''} onChange={(e) => updatePath('term', e.target.value)} /></Field>
        <Field label="教师"><input value={report.teacher || ''} onChange={(e) => updatePath('teacher', e.target.value)} /></Field>
      </div>

      <SectionTitle>② 教学目标（每行一条）</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="知识目标"><textarea rows={4} value={arrToText(obj.knowledge)} onChange={(e) => updatePath('teachingObjectives.knowledge', textToArr(e.target.value))} /></Field>
        <Field label="技能目标"><textarea rows={4} value={arrToText(obj.skill)}     onChange={(e) => updatePath('teachingObjectives.skill', textToArr(e.target.value))} /></Field>
        <Field label="素养目标"><textarea rows={4} value={arrToText(obj.emotion)}   onChange={(e) => updatePath('teachingObjectives.emotion', textToArr(e.target.value))} /></Field>
      </div>

      <SectionTitle>③ 教学重点与难点（每行一条）</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="教学重点"><textarea rows={4} value={arrToText(kd.keyPoints)}    onChange={(e) => updatePath('keyPointsAndDifficulties.keyPoints', textToArr(e.target.value))} /></Field>
        <Field label="教学难点"><textarea rows={4} value={arrToText(kd.difficulties)} onChange={(e) => updatePath('keyPointsAndDifficulties.difficulties', textToArr(e.target.value))} /></Field>
      </div>

      <SectionTitle>④ 总体安排 / 信息化 / 微课视频应用</SectionTitle>
      <Field label="教学过程总体安排">
        <textarea rows={3} value={report.overallArrangement || ''} onChange={(e) => updatePath('overallArrangement', e.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="信息化平台"><input value={report.informatization?.platform || ''} onChange={(e) => updatePath('informatization.platform', e.target.value)} /></Field>
        <Field label="信息化工具（顿号分隔）"><input value={arr(report.informatization?.tools).join('、')} onChange={(e) => updatePath('informatization.tools', e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean))} /></Field>
        <Field label="信息化目的"><input value={report.informatization?.purpose || ''} onChange={(e) => updatePath('informatization.purpose', e.target.value)} /></Field>
      </div>
      <Field label="微课视频应用说明">
        <textarea rows={2} value={report.microVideoUsage || ''} onChange={(e) => updatePath('microVideoUsage', e.target.value)} />
      </Field>

      {/* 老师手填区（关键） */}
      <div style={{ marginTop: 24, padding: 14, background: '#fff7ed', border: '2px solid #fdba74', borderRadius: 8 }}>
        <h4 style={{ marginTop: 0, fontSize: 14, color: '#9a3412' }}>📝 老师手填区（AI 不会替你写，必须课程结束后亲填）</h4>

        <h5 style={{ fontSize: 13, color: '#7c2d12', marginTop: 16, marginBottom: 8 }}>八、课堂教学实施成效（5 项）</h5>
        {Object.keys(OUTCOME_LABELS).map((key) => {
          const o = outcomes[key] || { achieved: '', evidence: '' };
          return (
            <div key={key} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 8 }}>
              <strong style={{ color: '#0ea5e9', fontSize: 13 }}>{OUTCOME_LABELS[key]}</strong>
              <input
                placeholder="达成情况（例：95% 学生达标）"
                value={o.achieved || ''}
                onChange={(e) => updateOutcome(key, 'achieved', e.target.value)}
                style={{ marginTop: 6 }}
              />
              <textarea
                rows={2}
                placeholder="支持证据（例：出勤率 95%、作品评分均 80+）"
                value={o.evidence || ''}
                onChange={(e) => updateOutcome(key, 'evidence', e.target.value)}
                style={{ marginTop: 6 }}
              />
            </div>
          );
        })}

        <h5 style={{ fontSize: 13, color: '#7c2d12', marginTop: 16, marginBottom: 8 }}>九、反思与改进（4 项，每行一条）</h5>
        {Object.keys(REFLECTION_LABELS).map((key) => (
          <Field key={key} label={REFLECTION_LABELS[key]}>
            <textarea
              rows={3}
              placeholder={`${REFLECTION_LABELS[key]}（每行一条）`}
              value={arrToText(reflection[key])}
              onChange={(e) => updateReflection(key, e.target.value)}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}
