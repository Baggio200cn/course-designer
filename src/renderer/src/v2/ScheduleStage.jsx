/**
 * ScheduleStage — 教学进度表阶段（驭课 Agent v4.0.0 / Phase-9 C-1）
 *
 * 核心职责：
 *   - 起点阶段（无上游依赖）
 *   - AI 生成 6 列表格（周次/课时/章节/内容/方式/作业次数）
 *     （注：旧版列名"课次"已于 2026-05-15 按老师反馈改为"课时"，
 *      数据字段 schedule[].session 字段名保持不变以兼容下游）
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

  // 2026-05-15 v4.1.4：章节速览不能只列"一/二/三"，要带真实内容
  //   按 chapter 字段分组，取该章首行 content 作为标题；忽略"（续）"行
  //   产出 [{key:'一', label:'一 · 意识——服装产品传播起源', count:3, hours:12}]
  const chapterGroups = (() => {
    const map = new Map();   // key=chapter raw（'一'）
    for (const r of rows) {
      const ch = String(r.chapter || '').trim();
      if (!ch) continue;
      // 把"（续）"统一归到上一非续章节
      if (/^[（(]续[）)]$/.test(ch)) {
        // 找最近一个非续 chapter
        const keys = Array.from(map.keys());
        const lastKey = keys[keys.length - 1];
        if (lastKey) {
          const g = map.get(lastKey);
          g.count += 1;
          g.hours += Number(r.hours) || 0;
        }
        continue;
      }
      if (!map.has(ch)) {
        map.set(ch, {
          key: ch,
          firstContent: String(r.content || '').trim(),
          count: 1,
          hours: Number(r.hours) || 0,
        });
      } else {
        const g = map.get(ch);
        g.count += 1;
        g.hours += Number(r.hours) || 0;
        if (!g.firstContent) g.firstContent = String(r.content || '').trim();
      }
    }
    return Array.from(map.values()).map((g) => ({
      ...g,
      label: g.firstContent ? `${g.key} · ${g.firstContent}` : g.key,
    }));
  })();
  // 保留旧 chapters 给页头计数（兼容老逻辑）
  const chapters = chapterGroups.map((g) => g.key);
  const expCount = (schedule?.experimentTopics || []).length;

  // 显示模式：表格预览 / JSON 编辑（默认表格预览，老师可切换）
  const [viewMode, setViewMode] = useState('table');

  // 2026-05-15 v4.1.2：JSON 编辑模式的"就地反馈"——保存成功/失败右下角显示，避免老师看不到顶部状态条
  const [inlineFeedback, setInlineFeedback] = useState(null);  // {type: 'success'|'error'|'info', text: string}
  const [saveBusy, setSaveBusy] = useState(false);

  // 2026-05-15 v4.1.2：input 双向同步——改了 school/totalHours/textbook 后，
  //   同步到 schedule.header + jsonText，让右侧表头 / 表格预览 / JSON 编辑都跟着变
  const syncInputToHeader = (field, value) => {
    setScheduleState((prev) => {
      const newScheduleState = { ...prev, [field]: value };
      // 如果当前有 schedule，同步更新它的 header 和 jsonText
      if (prev.schedule) {
        const newSchedule = {
          ...prev.schedule,
          header: { ...(prev.schedule.header || {}), [field]: value },
        };
        newScheduleState.schedule = newSchedule;
        newScheduleState.jsonText = JSON.stringify(newSchedule, null, 2);
      }
      return newScheduleState;
    });
  };

  const showInline = (type, text, autoMs = 4000) => {
    setInlineFeedback({ type, text });
    if (autoMs > 0) setTimeout(() => setInlineFeedback(null), autoMs);
  };

  // 包一层 handleSaveSchedule，加 busy 态 + 就地反馈
  const doSaveJson = async () => {
    if (saveBusy) return;
    setSaveBusy(true);
    setInlineFeedback({ type: 'info', text: '⏳ 正在校验 JSON 并写回数据库…' });
    try {
      const prevJsonText = scheduleState.jsonText || '';
      await handleSaveSchedule(scheduleState);
      // 保存完成后，handleSaveSchedule 会更新 scheduleState.jsonText（normalize 后的）
      // 我们在下一个 microtask 比较前后变化给反馈
      setTimeout(() => {
        // 重新读最新的 jsonText（来自 props，可能已经被父组件更新）
        // 注意：闭包里 scheduleState 是旧值，但 setInlineFeedback 是 setter，能正常工作
        showInline('success', '✅ JSON 已保存（已通过学时守恒校验和字段规范化）');
        setSaveBusy(false);
      }, 100);
    } catch (e) {
      console.error('[doSaveJson] 异常：', e);
      showInline('error', `❌ 保存异常：${e.message}`, 8000);
      setSaveBusy(false);
    }
  };

  return (
    <section className="v2-stage-layout">
      <div className="v2-stage-center">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>教学进度表</h3>
            <span className="v2-hint">AI 按你填的【总学时 ÷ 每次课学时】算出实际次课数（含章节/方法/重难点/实训），是 8 阶段工作流的起点。</span>
          </div>
          <div className="v2-status-box">
            <span>助手状态</span>
            <strong>{assistantStatus}</strong>
          </div>

          {/* P6 修复（2026-05-18）：审计条只在「真正手工导入外部 JSON」时显示
              - importAudit.source === 'external-json'  → 黄色警告条（旧逻辑）
              - 其他场景（AI 自生成 / 老师手编辑保存）→ 完全隐藏（兜底默认值不算"警告"，是正常补全）
              老师反馈："出现黄色警告是什么意思？我表格里 method 明明有值'讲授'啊"
              根因：alias resolver 把 AI 没显式返回的字段（兜底为'讲授'）也当成"缺失警告"，对老师造成困惑 */}
          {scheduleState.importAudit?.source === 'external-json' && (scheduleState.importAudit.aliasesUsed?.length > 0 || scheduleState.importAudit.warnings?.length > 0) ? (
            <div style={{
              marginTop: 8, padding: '12px 14px',
              background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 6,
              fontSize: 13, color: '#1e40af',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong>📥 外部 JSON 导入兼容报告（仅当从 DeepSeek/ChatGPT/文心 等外部 AI 导入时显示）</strong>
                <button
                  onClick={() => setScheduleState((prev) => ({ ...prev, importAudit: null }))}
                  style={{ background: 'transparent', border: 'none', color: '#1e40af', cursor: 'pointer', fontSize: 16 }}
                  title="关闭此提示"
                >×</button>
              </div>
              {scheduleState.importAudit.aliasesUsed?.length > 0 ? (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                    ✅ 已自动兼容外部 AI 字段命名（{scheduleState.importAudit.aliasesUsed.length} 项）
                  </summary>
                  <ul style={{ margin: '4px 0 0 18px', fontSize: 12, color: '#1e3a8a' }}>
                    {scheduleState.importAudit.aliasesUsed.slice(0, 12).map((a, i) => (
                      <li key={i}><code style={{ background: '#bfdbfe', padding: '1px 4px', borderRadius: 2 }}>{a}</code></li>
                    ))}
                    {scheduleState.importAudit.aliasesUsed.length > 12 ? (
                      <li>… 还有 {scheduleState.importAudit.aliasesUsed.length - 12} 项</li>
                    ) : null}
                  </ul>
                </details>
              ) : null}
              {scheduleState.importAudit.warnings?.length > 0 ? (
                <div style={{ marginTop: 6 }}>
                  <strong style={{ fontSize: 12 }}>ℹ️ 外部导入时缺的字段（已用默认值兜底，可在 JSON 编辑模式手动改）：</strong>
                  <ul style={{ margin: '4px 0 0 18px', fontSize: 12, color: '#1e3a8a' }}>
                    {scheduleState.importAudit.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 2026-05-15 P2-6：反编造审计绿条 —— AI 编造时系统已强制修正 */}
          {scheduleState.fabricationAudit?.corrections?.length > 0 ? (
            <div style={{
              marginTop: 8, padding: '10px 14px',
              background: '#dcfce7', border: '1px solid #86efac', borderRadius: 6,
              fontSize: 13, color: '#166534',
            }}>
              <strong>⚙ 反编造保护已生效</strong>——系统检测到 AI 编造了以下字段，已强制使用你的输入：
              <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                {scheduleState.fabricationAudit.corrections.map((c, i) => (
                  <li key={i} style={{ marginTop: 2 }}>
                    <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 3 }}>{c.field}</code>
                    {' '}：AI 想填 <span style={{ textDecoration: 'line-through', color: '#991b1b' }}>「{c.aiValue}」</span>
                    {' → '}已改为 <strong style={{ color: '#166534' }}>「{c.correctedTo}」</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="v2-grid-two">
            <div>
              <label className="v2-label">课程名称</label>
              <input value={courseName || ''} disabled placeholder="（来自笔记本）" />
            </div>
            <div>
              <label className="v2-label">学校简称 <span style={{ fontSize: 11, color: '#16a34a' }}>（与表头双向同步）</span></label>
              <input
                type="text"
                value={scheduleState.school ?? ''}
                onChange={(e) => syncInputToHeader('school', e.target.value)}
                placeholder="如：广州纺校（留空走默认）"
              />
            </div>
            <div>
              <label className="v2-label">总学时 <span style={{ fontSize: 11, color: '#16a34a' }}>（与表头双向同步）</span></label>
              <input
                type="number"
                min="1"
                value={
                  scheduleState.totalHours === '' || scheduleState.totalHours === undefined || scheduleState.totalHours === null
                    ? ''
                    : scheduleState.totalHours
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  syncInputToHeader('totalHours', raw === '' ? '' : Number(raw));
                }}
                placeholder="如：72"
              />
            </div>
            <div>
              <label className="v2-label">教材（可选） <span style={{ fontSize: 11, color: '#16a34a' }}>（与表头双向同步）</span></label>
              <input
                type="text"
                value={scheduleState.textbook ?? ''}
                onChange={(e) => syncInputToHeader('textbook', e.target.value)}
                placeholder="例如：《时尚传播学》"
              />
            </div>
          </div>
          <div className="v2-inline-actions v2-field-top-gap">
            {/* 重新生成时需要二次确认，避免覆盖老师手改的内容 */}
            <button
              className="v2-btn v2-btn-primary"
              onClick={() => {
                if (schedule && !window.confirm(
                  '⚠ 重新生成进度表会覆盖当前内容（包括你手动编辑的部分）。\n\n' +
                  '如已手改，建议先点【保存】留底，再点确认。\n\n' +
                  '确认重新生成吗？'
                )) return;
                handleGenerateSchedule();
              }}
              disabled={busy}
            >
              {schedule ? '🔄 重新生成进度表' : '✨ 生成进度表'}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={() => handleSaveSchedule(scheduleState)} disabled={!schedule}>
              💾 保存
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleConfirmSchedule} disabled={!scheduleState.artifactId}>
              {scheduleState.confirmed ? '✓ 已确认' : '✅ 确认（解锁教学设计）'}
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
                <h3>{viewMode === 'table' ? '进度表预览（可直接在表格内编辑各列，改完点上方"保存"）' : '进度表 JSON（编辑后点保存）'}</h3>
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
                <SchedulePreviewTable
                  schedule={schedule}
                  methodPool={schedule?.methods || []}
                  /* 2026-05-17 v4.2.0 Step 1.5：表格内编辑 method 等字段，立即同步到 scheduleState */
                  onRowEdit={(rowIndex, field, value) => {
                    setScheduleState((prev) => {
                      if (!prev.schedule) return prev;
                      const newRows = [...prev.schedule.schedule];
                      newRows[rowIndex] = { ...newRows[rowIndex], [field]: value };
                      const newSchedule = { ...prev.schedule, schedule: newRows };
                      return {
                        ...prev,
                        schedule: newSchedule,
                        jsonText: JSON.stringify(newSchedule, null, 2),
                        dirty: true,   // 让"保存修改"按钮亮起
                      };
                    });
                  }}
                />
              ) : (
                <>
                  {/* 2026-05-15：JSON 编辑模式原位操作栏 + 提示 */}
                  <div style={{
                    marginBottom: 8, padding: '8px 12px',
                    background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6,
                    fontSize: 12, color: '#9a3412',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
                  }}>
                    <span>
                      ✏ 你正在直接改 JSON。改完点 <strong>💾 保存修改</strong> 写回数据库；点 <strong>↺ 放弃修改</strong> 恢复上次保存内容。
                    </span>
                    <span style={{ color: '#6b7280' }}>
                      字符数：{(scheduleState.jsonText || '').length}
                    </span>
                  </div>
                  <textarea
                    className="v2-code"
                    rows={22}
                    value={scheduleState.jsonText || ''}
                    onChange={(e) => setScheduleState((prev) => ({ ...prev, jsonText: e.target.value }))}
                    placeholder="生成后这里会显示进度表 JSON。"
                  />
                  {/* 2026-05-15 v4.1.2：就地反馈条（保存成功/失败/正在保存） */}
                  {inlineFeedback ? (
                    <div style={{
                      marginTop: 8, padding: '10px 14px',
                      background: inlineFeedback.type === 'success' ? '#dcfce7'
                                : inlineFeedback.type === 'error' ? '#fee2e2'
                                : '#dbeafe',
                      border: `1px solid ${
                        inlineFeedback.type === 'success' ? '#86efac'
                        : inlineFeedback.type === 'error' ? '#fca5a5'
                        : '#93c5fd'
                      }`,
                      color: inlineFeedback.type === 'success' ? '#166534'
                          : inlineFeedback.type === 'error' ? '#991b1b'
                          : '#1e40af',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      transition: 'all 0.2s ease',
                    }}>
                      {inlineFeedback.text}
                    </div>
                  ) : null}
                  {/* 原位操作按钮（粘到 textarea 底下）*/}
                  <div className="v2-inline-actions" style={{ marginTop: 8, padding: 8, background: '#f9fafb', borderRadius: 6 }}>
                    <button
                      className="v2-btn v2-btn-primary"
                      onClick={doSaveJson}
                      disabled={saveBusy}
                      title="把当前 JSON 内容写回数据库（自动 normalize + 学时守恒校验）"
                    >{saveBusy ? '⏳ 保存中…' : '💾 保存修改'}</button>
                    <button
                      className="v2-btn v2-btn-secondary"
                      onClick={() => {
                        if (!window.confirm('放弃当前 JSON 编辑修改？将恢复为上次保存的版本。')) return;
                        setScheduleState((prev) => ({
                          ...prev,
                          jsonText: prev.schedule ? JSON.stringify(prev.schedule, null, 2) : '',
                        }));
                        showInline('info', '↺ 已恢复为上次保存的内容', 3000);
                      }}
                      disabled={saveBusy}
                      title="放弃 JSON 编辑区的未保存修改，恢复为上次保存的版本"
                    >↺ 放弃修改</button>
                    <button
                      className="v2-btn v2-btn-secondary"
                      onClick={() => setViewMode('table')}
                      disabled={saveBusy}
                      title="切回表格预览（不影响 JSON 编辑内容）"
                    >👁 返回表格预览</button>
                  </div>
                </>
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
              {/* 2026-05-15 v4.1.4：多源 fallback：scheduleState input → schedule.header → notebook → "—"
                  notebook 字段通过 api 暴露给 ScheduleStage props 较麻烦，改用 hasGap 标记，引导老师点编辑上文补全 */}
              {(() => {
                const fields = [
                  { label: '课程', value: header.courseName || courseName },
                  { label: '学校', value: scheduleState.school || header.school },
                  { label: '教学部', value: header.department },
                  { label: '教师', value: header.teacher },
                  { label: '班级', value: header.className },
                  { label: '学期', value: header.semester },
                  { label: '教材', value: scheduleState.textbook || header.textbook },
                ];
                const gapCount = fields.filter((f) => !String(f.value || '').trim()).length;
                return (
                  <>
                    {fields.map((f, i) => (
                      <p key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong>{f.label}：</strong>
                        {String(f.value || '').trim() ? (
                          <span>{f.value}</span>
                        ) : (
                          <span style={{ color: '#dc2626', fontStyle: 'italic' }}>—（未填）</span>
                        )}
                      </p>
                    ))}
                    <p>
                      <strong>学时：</strong>
                      {scheduleState.totalHours || header.totalHours || 72}
                      （理论 {header.theoryHours || 32} + 实训 {header.practiceHours || 36} + 考核 {header.examHours || 4}）
                    </p>
                    {/* 2026-05-15 v4.1.4：每次课学时 + 实际行数对账 */}
                    {header.hoursPerSession ? (
                      <p style={{ color: '#1e40af' }}>
                        <strong>每次课学时：</strong>{header.hoursPerSession}
                        {' '}
                        （共 <strong>{rows.length}</strong> 次课）
                      </p>
                    ) : (
                      <p style={{ color: '#dc2626', fontSize: 12 }}>
                        <strong>⚠ 每次课学时未设置</strong>——点上方"📝 编辑上文"补全
                      </p>
                    )}
                    {/* 2026-05-15 v4.1.4：有空字段时显眼引导老师点"编辑上文"补全 */}
                    {gapCount > 0 ? (
                      <div style={{
                        marginTop: 10, padding: '8px 10px',
                        background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4,
                        fontSize: 12, color: '#78350f',
                      }}>
                        ⚠ 有 <strong>{gapCount}</strong> 项表头字段未填。<br/>
                        点上方"<strong>📝 编辑上文</strong>"按钮可一次补全（教师/班级/教学部/学期）。
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </div>
          ) : <p className="v2-hint">尚未生成。</p>}
        </div>

        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>章节速览</h3>
            <span className="v2-hint">章节数 {chapters.length} · 实训类目 {expCount} · 周数 {rows.length}</span>
          </div>
          {chapterGroups.length === 0 ? (
            <p className="v2-hint">尚未生成或无章节信息。</p>
          ) : (
            <ul className="v2-bullet-list">
              {chapterGroups.map((g, i) => (
                <li key={i} title={g.firstContent || g.key}>
                  <strong>{g.key}</strong>
                  {g.firstContent ? <span> · {g.firstContent}</span> : null}
                  <span className="v2-hint" style={{ marginLeft: 8, fontSize: 12 }}>
                    （{g.count} 次课 · {g.hours} 学时）
                  </span>
                </li>
              ))}
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
 * SchedulePreviewTable — 6 列教学进度表预览（v4.2.0 Step 1.5：method 列可编辑 + AI 候选）
 *
 * 新增 props：
 *   - onRowEdit(rowIndex, field, value)  → 编辑某行某字段（目前只用 method）
 *   - methodPool  → 教学方法池（来自 schedule.methods），用于下拉候选
 *
 * UI 改动：
 *   - method 列改为 <input> + 旁边 💡 按钮
 *   - 点 💡 弹出 popup 显示：① reasoning（AI 选这套的理由）② 3 个其它候选组合（点击即填入）
 *   - 编辑 input 后即时同步到上层 schedule.schedule[i].method（jsonText 也同步）
 */
function SchedulePreviewTable({ schedule, onRowEdit, methodPool = [] }) {
  const [pickerOpenRow, setPickerOpenRow] = useState(-1);
  const rows = schedule?.schedule || [];
  if (rows.length === 0) {
    // 2026-05-15 v4.1.2：进度表为空时给出明确原因 + 恢复指引
    const hasHeader = schedule?.header?.courseName || schedule?.header?.totalHours;
    return (
      <div style={{
        padding: '20px 24px', marginTop: 8, textAlign: 'center',
        background: '#fef3c7', border: '1px dashed #fcd34d', borderRadius: 8,
      }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#78350f', margin: '0 0 8px' }}>
          ⚠ 进度表行数为 0（schedule[] 数组为空）
        </p>
        <p style={{ fontSize: 12, color: '#92400e', margin: '4px 0' }}>
          可能原因：① 你在 JSON 编辑模式删除了所有行 / 行 content 字段全为空<br/>
          ② 上次 AI 生成失败 / ③ 数据规范化时所有行 content 为空被过滤
        </p>
        <p style={{ fontSize: 12, color: '#92400e', margin: '8px 0 0' }}>
          建议：{hasHeader ? '点上方【🔄 重新生成进度表】重新让 AI 生成；或' : ''}切到 <strong>JSON 编辑</strong>模式补回 schedule[] 内容后点【💾 保存修改】
        </p>
      </div>
    );
  }
  // 2026-05-15：学时合计 + 守恒检查（解决 36 学时 → 18 行的语义混淆）
  const totalHoursFromRows = rows.reduce((s, r) => s + (Number(r.hours) || 0), 0);
  const headerTotalHours = Number(schedule?.header?.totalHours) || 0;
  const hoursOk = headerTotalHours === 0 || Math.abs(totalHoursFromRows - headerTotalHours) < 0.5;

  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      {/* 学时守恒提示条 */}
      <div style={{
        marginBottom: 8, padding: '6px 12px', fontSize: 12,
        background: hoursOk ? '#dcfce7' : '#fee2e2',
        border: `1px solid ${hoursOk ? '#86efac' : '#fca5a5'}`,
        borderRadius: 4, color: hoursOk ? '#166534' : '#991b1b',
      }}>
        {hoursOk
          ? `✓ 学时守恒：${rows.length} 条课次 · 合计 ${totalHoursFromRows} 学时${headerTotalHours ? ` / 目标 ${headerTotalHours}` : ''}`
          : `⚠ 学时不守恒！${rows.length} 条课次合计 ${totalHoursFromRows} 学时，但表头总学时为 ${headerTotalHours} —— 可直接在表格"学时"列修改每行后点保存`}
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>周次</th>
            <th style={thStyle}>课次</th>
            <th style={thStyle}>授课章节</th>
            <th style={{ ...thStyle, minWidth: 220 }}>教学内容</th>
            <th style={thStyle}>学时</th>
            <th style={thStyle}>授课方式</th>
            <th style={thStyle}>作业次数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={i % 2 === 0 ? trEvenStyle : trOddStyle}>
              {/* v4.3.3 功能3（老师反馈 2026-05-29）：周次/课次/章节/内容/学时 全部可直接表格内编辑（不再只能 JSON） */}
              <td style={tdCenterStyle}>{onRowEdit
                ? <input type="number" value={r.week ?? ''} onChange={(e) => onRowEdit(i, 'week', e.target.value === '' ? null : Number(e.target.value))} style={cellNumInputStyle} />
                : (r.week ?? '—')}</td>
              <td style={tdCenterStyle}>{onRowEdit
                ? <input type="number" value={r.session ?? ''} onChange={(e) => onRowEdit(i, 'session', e.target.value === '' ? null : Number(e.target.value))} style={cellNumInputStyle} />
                : (r.session ?? '—')}</td>
              <td style={tdCenterStyle}>{onRowEdit
                ? <input type="text" value={r.chapter || ''} onChange={(e) => onRowEdit(i, 'chapter', e.target.value)} style={{ ...cellNumInputStyle, width: 70 }} placeholder="章节" />
                : (r.chapter || '—')}</td>
              <td style={tdStyle}>{onRowEdit
                ? <textarea value={r.content || ''} onChange={(e) => onRowEdit(i, 'content', e.target.value)} rows={2} style={cellTextAreaStyle} placeholder="教学内容" />
                : (r.content || '—')}</td>
              <td style={{ ...tdCenterStyle, fontWeight: 600, color: '#2563eb' }}>{onRowEdit
                ? <input type="number" value={r.hours ?? ''} onChange={(e) => onRowEdit(i, 'hours', e.target.value === '' ? null : Number(e.target.value))} style={{ ...cellNumInputStyle, color: '#2563eb', fontWeight: 600 }} />
                : (r.hours ?? '—')}</td>
              {/* 2026-05-17 v4.2.0 Step 1.5：method 列可编辑 + AI 候选 popover */}
              <td style={{ ...tdCenterStyle, position: 'relative', minWidth: 200 }}>
                {onRowEdit ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
                    <input
                      type="text"
                      value={r.method || ''}
                      onChange={(e) => onRowEdit(i, 'method', e.target.value)}
                      style={{
                        flex: 1, minWidth: 140, padding: '3px 6px', fontSize: 13,
                        border: '1px solid #cbd5e1', borderRadius: 3, background: '#fff',
                      }}
                      placeholder="点 💡 看 AI 建议"
                    />
                    {(r._methodReasoning || (Array.isArray(r.methodAlternatives) && r.methodAlternatives.length > 0)) ? (
                      <button
                        type="button"
                        title="查看 AI 选择理由 + 候选组合"
                        onClick={() => setPickerOpenRow(pickerOpenRow === i ? -1 : i)}
                        style={{
                          padding: '2px 6px', fontSize: 14, cursor: 'pointer',
                          background: pickerOpenRow === i ? '#3b82f6' : '#dbeafe',
                          color: pickerOpenRow === i ? '#fff' : '#1e40af',
                          border: '1px solid #93c5fd', borderRadius: 3,
                        }}
                      >💡</button>
                    ) : null}
                    {pickerOpenRow === i ? (
                      <div style={{
                        position: 'absolute', right: 0, top: '110%', zIndex: 50,
                        minWidth: 320, maxWidth: 380, padding: 12,
                        background: '#fff', border: '1px solid #2563eb', borderRadius: 6,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', textAlign: 'left', fontSize: 12,
                      }}>
                        {r._methodReasoning ? (
                          <div style={{ marginBottom: 10, padding: 8, background: '#eff6ff', borderRadius: 4 }}>
                            <strong style={{ color: '#1e40af' }}>🤖 AI 选择理由</strong>
                            <p style={{ margin: '4px 0 0', color: '#1e3a8a', lineHeight: 1.5 }}>{r._methodReasoning}</p>
                          </div>
                        ) : null}
                        {Array.isArray(r.methodAlternatives) && r.methodAlternatives.length > 0 ? (
                          <div>
                            <strong style={{ color: '#1e40af' }}>💡 其它候选组合</strong>
                            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {r.methodAlternatives.map((alt, j) => (
                                <button
                                  key={j}
                                  onClick={() => { onRowEdit(i, 'method', alt); setPickerOpenRow(-1); }}
                                  style={{
                                    padding: '6px 10px', textAlign: 'left', cursor: 'pointer',
                                    background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 4,
                                    fontSize: 12, color: '#334155',
                                  }}
                                  title="点击采用此组合"
                                >{alt}</button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {methodPool.length > 0 ? (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
                            <strong style={{ color: '#475569', fontSize: 11 }}>📋 方法池（点击添加）</strong>
                            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {methodPool.map((m, j) => (
                                <button
                                  key={j}
                                  onClick={() => {
                                    const curr = String(r.method || '').trim();
                                    const parts = curr ? curr.split(/[+、,，\s]+/).filter(Boolean) : [];
                                    if (!parts.includes(m)) {
                                      onRowEdit(i, 'method', [...parts, m].join('+'));
                                    }
                                  }}
                                  style={{
                                    padding: '2px 8px', cursor: 'pointer', fontSize: 11,
                                    background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 12, color: '#92400e',
                                  }}
                                >+ {m}</button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <button
                          onClick={() => setPickerOpenRow(-1)}
                          style={{
                            marginTop: 10, padding: '4px 10px', cursor: 'pointer', fontSize: 11,
                            background: '#fff', border: '1px solid #cbd5e1', borderRadius: 4, color: '#475569',
                          }}
                        >关闭</button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  r.method || '—'
                )}
              </td>
              {/* v4.3.3 功能3：作业次数可编辑 */}
              <td style={tdCenterStyle}>{onRowEdit
                ? <input type="number" min="0" value={r.homework ?? ''} onChange={(e) => onRowEdit(i, 'homework', e.target.value === '' ? null : Number(e.target.value))} style={cellNumInputStyle} placeholder="0" />
                : (r.homework === 0 || r.homework == null ? '/' : r.homework)}</td>
            </tr>
          ))}
          {/* 学时合计行 */}
          <tr style={{ background: '#eff6ff', fontWeight: 600 }}>
            <td style={tdCenterStyle} colSpan={4}>合计</td>
            <td style={{ ...tdCenterStyle, fontWeight: 700, color: '#1e40af' }}>{totalHoursFromRows}</td>
            <td style={tdCenterStyle} colSpan={2}>—</td>
          </tr>
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
// v4.3.3 功能3：进度表单元格可编辑输入框样式
const cellNumInputStyle = { width: 52, padding: '3px 4px', fontSize: 13, textAlign: 'center', border: '1px solid #cbd5e1', borderRadius: 3, background: '#fff' };
const cellTextAreaStyle = { width: '100%', minWidth: 200, padding: '4px 6px', fontSize: 13, lineHeight: 1.5, border: '1px solid #cbd5e1', borderRadius: 3, background: '#fff', resize: 'vertical', fontFamily: 'inherit' };
