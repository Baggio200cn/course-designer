import React, { useState } from 'react';
import ArtifactPanel from './ArtifactPanel';

export default function LectureStage({
  lectureState,
  setLectureState,
  assistantStatus,
  busy,
  selectedDraftText,
  handleGenerateLectureDrafts,
  saveLectureStage,
  handleGenerateFormalLecture,
  handleConfirmLecture,
  handleExportLecture,
  artifacts,
  dt,
  api,
  shorten,
  lectureReview,
  // Phase-5C 参考资料注入
  referenceContext = '',
  onReferenceContextChange,
  onFetchRefUrl,
  onDocxUpload,
  refFetchBusy = false,
  courseName = ''
}) {
  // URL 输入框本地状态（仅在本组件内使用）
  const [urlInput, setUrlInput] = useState('');
  const draftMeta = {
    a: {
      title: 'A 稿',
      emphasis: '知识逻辑型',
      hint: '更侧重知识主线、判断依据和模块逻辑。'
    },
    b: {
      title: 'B 稿',
      emphasis: '教师口播型',
      hint: '更侧重老师现场讲述、追问和回收表达。'
    },
    c: {
      title: 'C 稿',
      emphasis: '课堂执行型',
      hint: '更侧重任务推进、巡视互查和结果检查。'
    }
  };
  const draftCount = ['a', 'b', 'c'].filter((key) => String(lectureState.drafts?.[key] || '').trim()).length;
  const finalLength = String(lectureState.finalScript || '').trim().length;
  const structureHits = ['教师讲述', '课堂动作'].filter((token) => lectureState.finalScript.includes(token)).length;

  return (
    <section className="v2-stage-layout">
      <div className="v2-stage-center">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>讲稿阶段</h3>
            <span className="v2-hint">先看 A/B/C 候选讲稿方向，再补充要求生成正式讲稿。补充要求会同时影响草稿和正式稿。</span>
          </div>
          <div className="v2-status-box">
            <span>助手状态</span>
            <strong>{assistantStatus}</strong>
          </div>
          <label className="v2-label">讲稿补充要求</label>
          <textarea
            rows={5}
            value={lectureState.instruction}
            onChange={(e) => setLectureState((prev) => ({ ...prev, instruction: e.target.value }))}
            placeholder="例如：更强调课堂任务驱动，减少口号化表述。这里填写的新要求会同时驱动 A/B/C 候选稿和正式稿。"
          />

          {/* ── Phase-5C 参考资料注入区块 ─────────────────────────────────── */}
          <div className="v2-ref-section">
            <div className="v2-ref-header">
              <label className="v2-label v2-ref-label">
                📎 参考资料
                <span className="v2-ref-badge">提升质量</span>
              </label>
              <span className="v2-hint">粘贴教案/课标/教材摘录，或上传 .docx 文件，AI 生成正式稿时会直接参考</span>
            </div>

            {/* URL 读取行 */}
            <div className="v2-ref-url-row">
              <input
                type="text"
                className="v2-ref-url-input"
                placeholder="输入公开页面 URL（学科网/职教云/职教平台等）→ 自动提取文本"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && urlInput && !refFetchBusy) {
                    onFetchRefUrl?.(urlInput);
                    setUrlInput('');
                  }
                }}
                disabled={refFetchBusy}
              />
              <button
                className="v2-btn v2-btn-secondary v2-ref-fetch-btn"
                onClick={() => { if (urlInput) { onFetchRefUrl?.(urlInput); setUrlInput(''); } }}
                disabled={refFetchBusy || !urlInput}
              >
                {refFetchBusy ? '读取中…' : '读取'}
              </button>
              <label className={`v2-btn v2-btn-secondary v2-ref-upload-btn${refFetchBusy ? ' disabled' : ''}`}>
                📄 上传教案
                <input
                  type="file"
                  accept=".docx"
                  style={{ display: 'none' }}
                  disabled={refFetchBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) { onDocxUpload?.(file); e.target.value = ''; }
                  }}
                />
              </label>
            </div>

            {/* 参考资料文本框 */}
            <textarea
              className="v2-ref-textarea"
              rows={4}
              value={referenceContext}
              onChange={(e) => onReferenceContextChange?.(e.target.value)}
              placeholder="在此粘贴参考教案、课标段落、教材操作步骤…（最多 5000 字，内容越具体讲稿质量越高）"
            />

            {/* 加载状态 / 字数提示 */}
            {referenceContext ? (
              <div className="v2-ref-status ok">
                ✅ 已加载 <strong>{referenceContext.length}</strong> 字参考资料，生成 A/B/C 和正式稿时将自动注入
                <button
                  className="v2-ref-clear-btn"
                  onClick={() => onReferenceContextChange?.('')}
                  title="清除参考资料"
                >✕ 清除</button>
              </div>
            ) : (
              <div className="v2-ref-status empty">
                💡 无参考资料时 AI 凭通用知识生成；有了具体教案后，专业术语、操作步骤更准确
              </div>
            )}
          </div>
          {/* ── End 参考资料区块 ─────────────────────────────────────────────── */}

          <div className="v2-inline-actions">
            <button className="v2-btn v2-btn-primary" onClick={handleGenerateLectureDrafts} disabled={busy}>
              生成 A/B/C 候选稿
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={() => saveLectureStage(lectureState)} disabled={busy}>
              保存讲稿阶段
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleGenerateFormalLecture} disabled={busy}>
              生成正式稿
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleConfirmLecture} disabled={busy}>
              确认正式稿
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleExportLecture} disabled={busy}>
              导出 Word
            </button>
          </div>
        </div>

        <div className="v2-stage-banner stage-lecture">
          <div className="v2-stage-banner-copy">
            <span>讲稿链路</span>
            <strong>先选方向，再补要求，正式成稿后继续迭代。</strong>
            <p>A/B/C 现在是三种高质量候选讲稿，不是中间提纲。老师先选更认可的方向，再生成正式稿并反复修到确认版。</p>
          </div>
          <div className="v2-metric-grid">
            <div className="v2-metric-card">
              <span>草稿数量</span>
              <strong>{`${draftCount}/3`}</strong>
            </div>
            <div className="v2-metric-card">
              <span>正式稿字数</span>
              <strong>{finalLength}</strong>
            </div>
            <div className="v2-metric-card">
              <span>结构命中</span>
              <strong>{`${structureHits}/2`}</strong>
            </div>
          </div>
        </div>

        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>A / B / C 候选讲稿</h3>
            <span className="v2-hint">每一稿都接近正式稿水平。先选一个更认可的方向，再用补充要求生成正式稿。</span>
          </div>
          <div className="v2-draft-grid">
            {['a', 'b', 'c'].map((key) => (
              <button
                key={key}
                className={`v2-draft-card ${lectureState.selectedDraft === key ? 'active' : ''}`}
                onClick={() => setLectureState((prev) => ({ ...prev, selectedDraft: key }))}
              >
                <strong>{`${draftMeta[key].title} · ${draftMeta[key].emphasis}`}</strong>
                <span>{draftMeta[key].hint}</span>
                <span>{shorten(lectureState.drafts[key] || '当前为空', 140)}</span>
              </button>
            ))}
          </div>
          <label className="v2-label">{`当前已选方向：${draftMeta[lectureState.selectedDraft]?.emphasis || '未选择'}`}</label>
          <textarea className="v2-code" rows={12} value={selectedDraftText} readOnly placeholder="这里显示当前选中的候选讲稿。" />
        </div>

        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>正式讲稿</h3>
            <span className="v2-hint">这里保留最终可编辑正文。</span>
          </div>
          <textarea
            className="v2-code"
            rows={24}
            value={lectureState.finalScript}
            onChange={(e) => setLectureState((prev) => ({ ...prev, finalScript: e.target.value }))}
            placeholder="这里显示正式讲稿。"
          />
        </div>

        {/* 质量未通过时，自动推荐教学资源链接 */}
        {lectureReview && (Number(lectureReview.score) < 7 || (lectureReview.issues?.length > 0)) && (
          <div className="v2-panel v2-resource-panel">
            <div className="v2-panel-head">
              <h3>📚 参考资源建议</h3>
              <span className="v2-hint">根据课程名称自动生成，点击打开后复制相关内容粘贴到上方参考资料框，再重新生成</span>
            </div>
            <div className="v2-resource-links">
              {[
                {
                  label: '学科网',
                  hint: '教案/课件搜索',
                  url: `https://www.xkw.com/search.html?q=${encodeURIComponent((courseName || '职业院校') + ' 职业院校 教案')}`
                },
                {
                  label: '智慧职教',
                  hint: '职业教育课程资源',
                  url: `https://www.icve.com.cn/portal/courseinfo/resourcequery?keyWord=${encodeURIComponent(courseName || '')}`
                },
                {
                  label: '国家职教平台',
                  hint: '国家级职业教育资源库',
                  url: `https://zjy2.icve.com.cn/student/courseInfo/courseInfo.html?keyword=${encodeURIComponent(courseName || '')}`
                }
              ].map((item) => (
                <a
                  key={item.label}
                  className="v2-resource-link"
                  href="#"
                  onClick={(e) => { e.preventDefault(); api.openExternalUrl(item.url); }}
                >
                  <span className="v2-resource-link-label">{item.label}</span>
                  <span className="v2-resource-link-hint">{item.hint}</span>
                  <span className="v2-resource-link-arrow">↗</span>
                </a>
              ))}
            </div>
            <p className="v2-hint" style={{ marginTop: 8 }}>
              打开链接 → 复制教案/课标内容 → 粘贴到上方「参考资料」框 → 重新点「生成正式稿」
            </p>
          </div>
        )}

        {lectureReview && (
          <div className="v2-panel v2-review-panel">
            <div className="v2-panel-head">
              <h3>AI 质量审核报告</h3>
              <span className="v2-hint">本次生成后自动审核，发现问题会尝试自动修订一次。</span>
            </div>
            <div className="v2-review-summary">
              <div className={`v2-review-score ${Number(lectureReview.score) >= 8 ? 'good' : Number(lectureReview.score) >= 6 ? 'warn' : 'bad'}`}>
                <span>AI 评分</span>
                <strong>{Number(lectureReview.score) || '—'}/10</strong>
              </div>
              <div className="v2-review-verdict">
                {lectureReview.revised
                  ? <span className="v2-review-tag revised">✅ 已自动修订</span>
                  : lectureReview.score >= 7
                    ? <span className="v2-review-tag pass">✓ 质量达标，无需修订</span>
                    : <span className="v2-review-tag warn">⚠ 存在质量问题（未自动修订）</span>
                }
                {lectureReview.summary && (
                  <p className="v2-review-comment">{lectureReview.summary}</p>
                )}
              </div>
            </div>
            {Array.isArray(lectureReview.issues) && lectureReview.issues.length > 0 && (
              <div className="v2-review-issues">
                <label className="v2-label">发现的具体问题（{lectureReview.issues.length} 条）</label>
                <ul className="v2-review-issue-list">
                  {lectureReview.issues.map((issue, i) => (
                    <li key={i} className="v2-review-issue-item">
                      <span className={`v2-review-issue-type ${issue.type}`}>{issue.type}</span>
                      <span className="v2-review-issue-loc">{issue.location}</span>
                      {issue.text && <span className="v2-review-issue-text">「{issue.text}」</span>}
                      {issue.fix && <span className="v2-review-issue-fix">→ {issue.fix}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="v2-stage-right">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>讲稿摘要</h3>
            <span className="v2-hint">当前正式稿和基础稿概览。</span>
          </div>
          <div className="v2-kv-grid">
            <div className="v2-kv-card">
              <span>已选方向</span>
              <strong>{draftMeta[lectureState.selectedDraft]?.emphasis || lectureState.selectedDraft.toUpperCase()}</strong>
            </div>
            <div className="v2-kv-card">
              <span>正式稿字数</span>
              <strong>{lectureState.finalScript.length}</strong>
            </div>
          </div>
          <div className="v2-preview-section">
            <h4>正式稿预览</h4>
            <p className="v2-hint">{shorten(lectureState.finalScript || '当前还没有正式讲稿。', 400)}</p>
          </div>
        </div>

        <ArtifactPanel
          artifacts={artifacts}
          title="讲稿产物"
          hint="当前阶段写库后的讲稿草稿、正式稿和导出文件都会在这里出现。"
          onOpenFile={(storagePath) => api.openResource(storagePath)}
          dt={dt}
        />
      </div>
    </section>
  );
}
