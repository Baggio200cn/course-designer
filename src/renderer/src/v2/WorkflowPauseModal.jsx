/**
 * WorkflowPauseModal.jsx — Agent 暂停时的老师介入面板（Phase-7.5 M7.5.6）
 *
 * 触发场景：
 *   - 讲稿质量重试 3 次仍未达标（M7.5.3）
 *   - PPT 封面 Vision 审核失败（M7.5.5 Phase 1）
 *   - PPT 一致性复核 > 25% 不一致（M7.5.5 Phase 3）
 *   - 框架信息图重试 3 次失败（M7.5.4，回退路径）
 *
 * 老师可选择：
 *   1. 提供提示词微调 → Agent 用新提示词重新生成
 *   2. 直接重新生成（不微调）
 *   3. 跳过，手动接管
 *
 * 设计要点：
 *   - 无外部 CSS 文件（用 inline 样式 + v2.css 通用类）
 *   - 暂停状态对象由 V2App 通过 props 注入
 *   - 三个回调：onResume(hint) / onDismiss() / busy 标志
 */

import React, { useState, useEffect } from 'react';

const STAGE_LABELS = {
  framework: '教学框架',
  framework_infographic: '框架信息图',
  lecture: '正式讲稿',
  ppt: 'PPT 规划',
  ppt_images: 'PPT 配图',
  knowledge_cards: '知识点卡片',
};

const HINT_EXAMPLES = {
  lecture: '例：增加 2-3 个真实职业案例；提高互动密度，每章节至少 1 个问答',
  ppt_images: '例：颜色更暖一些；添加学生使用电脑的场景；版式更现代',
  framework: '例：模块 3 与模块 4 合并；增加"过程性评价"环节',
  framework_infographic: '例：用扁平化卡片风格；配色用蓝绿色系；信息密度降低',
};

// Phase-7.7 B4：限制老师输入的微调提示词长度
//   - hint 上限 500 字（追加到 systemPrompt，过长会挤占 prompt 预算 / 触发 token 上限）
//   - imagePrompt 上限 1000 字（图像生成 prompt 通常 200-500 字够用，1000 留余量）
const HINT_MAX_LEN = 500;
const IMAGE_PROMPT_MAX_LEN = 1000;

export default function WorkflowPauseModal({ pauseState, onResume, onDismiss, busy }) {
  const [hint, setHint] = useState('');
  // Phase-7.7 P0-反馈3：PPT 配图暂停时允许编辑特定页面的 imagePrompt
  const [editedImagePrompt, setEditedImagePrompt] = useState('');

  // 暂停状态变化时清空 hint
  useEffect(() => {
    setHint('');
    // 提取暂停时的 imagePrompt 作为初始值（如有）
    const failedPagePrompt = pauseState?.details?.failedPage?.imagePrompt
      || pauseState?.details?.coverPage?.imagePrompt
      || '';
    setEditedImagePrompt(failedPagePrompt);
  }, [pauseState?.pausedAt]);

  if (!pauseState) return null;

  const stage = pauseState.stage || 'unknown';
  const stageLabel = STAGE_LABELS[stage] || stage;
  const placeholder = HINT_EXAMPLES[stage] || '例：调整生成内容的具体修改方向';

  // Phase-7.7 P0-反馈3：PPT 配图阶段特化 — 显示当前页 / 失败页的 imagePrompt + 预览
  const isPptImagesStage = stage === 'ppt_images';
  const failedPage = pauseState?.details?.failedPage || pauseState?.details?.coverPage || null;
  const lastImagePath = pauseState?.details?.lastImagePath || failedPage?.imagePath || null;
  const visionAssessment = pauseState?.details?.lastVisionAssessment || null;

  // 防止点 modal 内部触发外层 onDismiss
  const handleCardClick = (e) => e.stopPropagation();

  return (
    <div style={overlayStyle} onClick={onDismiss}>
      <div style={cardStyle} onClick={handleCardClick}>

        {/* 头部 */}
        <header style={headerStyle}>
          <div>
            <span style={iconStyle}>⏸️</span>
            <strong style={titleStyle}>Agent 暂停 — 需老师介入</strong>
          </div>
          <span style={stageBadgeStyle}>{stageLabel}</span>
        </header>

        {/* 暂停原因 */}
        <section style={sectionStyle}>
          <div style={labelStyle}>暂停原因</div>
          <div style={reasonStyle}>{pauseState.reason || '原因未指明'}</div>
        </section>

        {/* Phase-7.7 P0-反馈3：PPT 配图阶段 — 失败页预览 + 编辑 */}
        {isPptImagesStage && (
          <section style={sectionStyle}>
            <div style={labelStyle}>📷 失败页面信息</div>
            <div style={pptPreviewStyle}>
              {/* 图片预览（如有） */}
              {lastImagePath ? (
                <div style={imagePreviewBoxStyle}>
                  <img src={`file://${lastImagePath.replace(/\\/g, '/')}`}
                       alt="失败的配图" style={imagePreviewStyle}
                       onError={(e) => { e.target.style.display = 'none'; }} />
                </div>
              ) : (
                <div style={noImageStyle}>📭 此页尚未生成任何配图（或图片路径无效）</div>
              )}

              {/* 失败页元数据 */}
              {failedPage && (
                <div style={pageMetaStyle}>
                  <div><strong>页码</strong>：{failedPage.pageNumber || failedPage.id}</div>
                  <div><strong>标题</strong>：{failedPage.title || '（无）'}</div>
                  <div><strong>对应章节</strong>：{failedPage.sourceSection || '（无）'}</div>
                </div>
              )}

              {/* Vision 评分（如有） */}
              {visionAssessment && (
                <div style={visionScoreStyle}>
                  <span style={scoreBadge(visionAssessment.relevanceScore)}>
                    内容相关性 {visionAssessment.relevanceScore ?? '?'}/10
                  </span>
                  <span style={scoreBadge(visionAssessment.styleScore)}>
                    风格一致性 {visionAssessment.styleScore ?? '?'}/10
                  </span>
                </div>
              )}

              {/* 当前 imagePrompt 可编辑 */}
              <div style={{ marginTop: 14 }}>
                <div style={{ ...labelStyle, marginBottom: 6 }}>🎨 当前配图提示词（可直接修改，建议 ≤ {IMAGE_PROMPT_MAX_LEN} 字）：</div>
                <textarea
                  value={editedImagePrompt}
                  onChange={(e) => setEditedImagePrompt(e.target.value.slice(0, IMAGE_PROMPT_MAX_LEN))}
                  placeholder="例：电商详情页风格，浅色背景，主体居中，无文字烧图..."
                  rows={4}
                  disabled={busy}
                  maxLength={IMAGE_PROMPT_MAX_LEN}
                  style={textareaStyle}
                />
                <div style={hintCounterStyle}>
                  {editedImagePrompt.length} / {IMAGE_PROMPT_MAX_LEN} 字符
                  {editedImagePrompt.length >= IMAGE_PROMPT_MAX_LEN && '（已达上限）'}
                  {editedImagePrompt.length > 0 && editedImagePrompt.length < IMAGE_PROMPT_MAX_LEN
                    && '（修改后会作为新的 imagePrompt 重新生成此页）'}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 详细信息（折叠） */}
        {pauseState.details && Object.keys(pauseState.details).length > 0 && (
          <details style={{ marginBottom: 14 }}>
            <summary style={{ cursor: 'pointer', color: '#64748B', fontSize: 13 }}>
              查看详细信息
            </summary>
            <pre style={prePauseStyle}>
              {JSON.stringify(pauseState.details, null, 2)}
            </pre>
          </details>
        )}

        {/* 建议操作 */}
        {Array.isArray(pauseState.suggestions) && pauseState.suggestions.length > 0 && (
          <section style={sectionStyle}>
            <div style={labelStyle}>建议操作</div>
            <ul style={suggestionsListStyle}>
              {pauseState.suggestions.map((s, i) => (
                <li key={i} style={suggestionItemStyle}>{s}</li>
              ))}
            </ul>
          </section>
        )}

        {/* 提示词微调输入 */}
        <section style={sectionStyle}>
          <div style={labelStyle}>📝 提示词微调（可选，建议 ≤ 500 字）</div>
          <textarea
            value={hint}
            onChange={(e) => setHint(e.target.value.slice(0, HINT_MAX_LEN))}
            placeholder={placeholder}
            rows={3}
            disabled={busy}
            maxLength={HINT_MAX_LEN}
            style={textareaStyle}
          />
          <div style={hintCounterStyle}>
            {hint.length} / {HINT_MAX_LEN} 字符
            {hint.length >= HINT_MAX_LEN && '（已达上限——继续输入将被截断）'}
            {hint.length > 0 && hint.length < HINT_MAX_LEN
              && '（Agent 会把此内容追加到原 Prompt 重新生成）'}
          </div>
        </section>

        {/* 操作按钮 */}
        <footer style={footerStyle}>
          <button
            onClick={() => onResume(hint, isPptImagesStage ? { imagePrompt: editedImagePrompt, pageId: failedPage?.id } : null)}
            disabled={busy}
            style={{ ...btnStyle, ...btnPrimaryStyle, opacity: busy ? 0.5 : 1 }}
          >
            {isPptImagesStage && editedImagePrompt !== (failedPage?.imagePrompt || '')
              ? '🎨 用新 imagePrompt 重生成此页'
              : (hint.trim() ? '🔄 用此提示词重新生成' : '🔄 重新生成')}
          </button>
          <button
            onClick={onDismiss}
            disabled={busy}
            style={{ ...btnStyle, ...btnSecondaryStyle, opacity: busy ? 0.5 : 1 }}
          >
            ⏭️ 跳过此步，手动接管
          </button>
        </footer>

        {busy && (
          <div style={busyStyle}>⏳ Agent 正在恢复执行...</div>
        )}
      </div>
    </div>
  );
}

// ─── 样式 ────────────────────────────────────────
const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 9999,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 20, animation: 'fadeIn 0.2s',
};
const cardStyle = {
  background: '#fff', borderRadius: 16,
  width: '100%', maxWidth: 640, maxHeight: '90vh',
  overflowY: 'auto', padding: '24px 28px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  paddingBottom: 14, borderBottom: '1px solid #E5E7EB', marginBottom: 16,
};
const iconStyle = { fontSize: 22, marginRight: 8 };
const titleStyle = { fontSize: 17, color: '#1F3864' };
const stageBadgeStyle = {
  background: '#FEF3C7', color: '#92400E',
  padding: '4px 12px', borderRadius: 12,
  fontSize: 12, fontWeight: 600,
};
const sectionStyle = { marginBottom: 14 };
const labelStyle = {
  fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6,
};
const reasonStyle = {
  background: '#FEF2F2', borderLeft: '3px solid #EF4444',
  padding: '10px 14px', borderRadius: 6,
  fontSize: 14, color: '#7F1D1D', lineHeight: 1.6,
};
const prePauseStyle = {
  background: '#F3F4F6', padding: 10, borderRadius: 6,
  fontSize: 11, fontFamily: 'Consolas, monospace',
  color: '#374151', overflow: 'auto', maxHeight: 180,
  marginTop: 6,
};
const suggestionsListStyle = {
  margin: 0, padding: '0 0 0 20px',
  background: '#F0F9FF', borderRadius: 6,
  paddingTop: 10, paddingBottom: 10, paddingRight: 14,
};
const suggestionItemStyle = {
  fontSize: 13, color: '#075985', lineHeight: 1.7, marginBottom: 4,
};
const textareaStyle = {
  width: '100%', padding: '10px 12px',
  border: '1px solid #D1D5DB', borderRadius: 8,
  fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
  minHeight: 70, boxSizing: 'border-box',
};
const hintCounterStyle = {
  fontSize: 11, color: '#9CA3AF', marginTop: 4,
};
const footerStyle = {
  display: 'flex', gap: 12, marginTop: 18,
  paddingTop: 14, borderTop: '1px solid #E5E7EB',
};
const btnStyle = {
  flex: 1, padding: '10px 16px', border: 'none', borderRadius: 8,
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
  transition: 'all 0.2s',
};
const btnPrimaryStyle = {
  background: 'linear-gradient(135deg, #2E5FA3, #1F3864)', color: '#fff',
};
const btnSecondaryStyle = {
  background: '#F3F4F6', color: '#4B5563',
  border: '1px solid #D1D5DB',
};
const busyStyle = {
  marginTop: 14, padding: 12,
  background: '#FEF3C7', borderRadius: 8,
  textAlign: 'center', fontSize: 13, color: '#92400E',
};

// Phase-7.7 P0-反馈3：PPT 配图特化样式
const pptPreviewStyle = {
  background: '#F9FAFB', borderRadius: 10,
  padding: 14, border: '1px solid #E5E7EB',
};
const imagePreviewBoxStyle = {
  background: '#fff', borderRadius: 8,
  padding: 8, marginBottom: 12,
  textAlign: 'center', border: '1px solid #E5E7EB',
};
const imagePreviewStyle = {
  maxWidth: '100%', maxHeight: 240,
  borderRadius: 4, objectFit: 'contain',
};
const noImageStyle = {
  padding: 20, background: '#F3F4F6',
  borderRadius: 6, textAlign: 'center',
  color: '#6B7280', fontSize: 13, marginBottom: 12,
};
const pageMetaStyle = {
  fontSize: 13, color: '#374151',
  background: '#fff', padding: 10, borderRadius: 6,
  border: '1px solid #E5E7EB',
};
const visionScoreStyle = {
  display: 'flex', gap: 8, marginTop: 10,
};
function scoreBadge(score) {
  const s = Number(score) || 0;
  let bg = '#FEE2E2', color = '#991B1B'; // 红
  if (s >= 7) { bg = '#DCFCE7'; color = '#14532D'; }     // 绿
  else if (s >= 5) { bg = '#FEF3C7'; color = '#92400E'; } // 黄
  return {
    padding: '4px 10px', borderRadius: 12,
    fontSize: 12, fontWeight: 600,
    background: bg, color,
  };
}
