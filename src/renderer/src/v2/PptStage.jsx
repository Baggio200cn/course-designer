import React from 'react';
import { buildPptTextFramework, PPT_TEMPLATE_PRESETS } from './stage-helpers';

/* ─────────────────────────────────────────────
   SlidePreview — 单张 slide 视觉预览（只读）
   支持：封面 / 路线图 / 内容页有图 / 内容页无图
───────────────────────────────────────────── */
function SlidePreview({ page, template, toLocalImgSrc }) {
  if (!page) return <p className="v2-hint">选择一个页面查看预览效果。</p>;
  const style   = template || PPT_TEMPLATE_PRESETS.pro_minimalist;
  const bg      = style.background  || '#F8FAFC';
  const accent  = style.accentColor || '#2563EB';
  const titleColor = style.textColor || '#1F2937';
  // compositeImagePath 优先（Canvas 合成的完整 Slide 图）
  const compositeImgSrc = page.compositeImagePath;
  const imgSrc  = page.imagePath || page.imageUrl;
  const keyPoints = String(page.keyContent || '').split('\n').filter(Boolean).slice(0, 5);
  const isCover   = page.pageType === '封面';
  const isRoadmap = page.pageType === '路线图';

  // ── 合成图模式：直接显示 Canvas 渲染的完整 Slide（WYSIWYG）──
  if (compositeImgSrc && !isCover && !isRoadmap) {
    return (
      <div style={{ aspectRatio: '16/9', borderRadius: 10, border: '1px solid #d1d5db', overflow: 'hidden', position: 'relative' }}>
        <img
          src={toLocalImgSrc(compositeImgSrc)}
          alt={page.title || '合成 Slide'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <div style={{ position: 'absolute', bottom: 3, right: 6, fontSize: 9, color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: 3 }}>
          P{page.pageNumber} · 已合成
        </div>
      </div>
    );
  }

  // 封面页：左侧标题 + 右侧大图
  if (isCover) {
    return (
      <div style={{ background: bg, aspectRatio: '16/9', borderRadius: 10, border: '1px solid #d1d5db', overflow: 'hidden', display: 'flex', fontSize: 12 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '16px 20px' }}>
          <div style={{ background: accent, color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 14, fontWeight: 700, marginBottom: 8, lineHeight: 1.3 }}>
            {page.title || '课程名称'}
          </div>
          {page.subtitle && <div style={{ color: '#6b7280', fontSize: 10, marginBottom: 4 }}>{page.subtitle}</div>}
          {page.summary  && <div style={{ color: '#9ca3af', fontSize: 9,  lineHeight: 1.3 }}>{page.summary}</div>}
          <div style={{ marginTop: 'auto', color: '#9ca3af', fontSize: 8 }}>P{page.pageNumber} · {page.pageType}</div>
        </div>
        <div style={{ width: '50%', flexShrink: 0 }}>
          {imgSrc
            ? <img src={toLocalImgSrc(imgSrc)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', background: accent + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, fontSize: 11 }}>待配图</div>}
        </div>
      </div>
    );
  }

  // 路线图：顶部色条 + 横向模块标签
  // Phase-7.7 G1（2026-04-30）：之前路线图分支完全忽略 imgSrc → 即使生成了配图也不显示
  // 修法：如有 imgSrc，作为半透明背景图层（保留色条 + chip 在前的设计）
  if (isRoadmap) {
    return (
      <div style={{ background: bg, aspectRatio: '16/9', borderRadius: 10, border: '1px solid #d1d5db', overflow: 'hidden', fontSize: 12, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {/* G1：路线图背景配图（半透明，保证 chip 文字可读）*/}
        {imgSrc && (
          <img
            src={toLocalImgSrc(imgSrc)}
            alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35, zIndex: 0 }}
          />
        )}
        {/* 半透明白色遮罩，保证文字对比度 */}
        {imgSrc && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.55)', zIndex: 1 }} />
        )}
        <div style={{ background: accent, height: 5, width: '100%', flexShrink: 0, position: 'relative', zIndex: 2 }} />
        <div style={{ padding: '8px 14px', flex: 1, overflow: 'hidden', position: 'relative', zIndex: 2 }}>
          <div style={{ color: titleColor, fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{page.title || '课程路线图'}</div>
          {keyPoints.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {keyPoints.map((point, i) => (
                <div key={i} style={{ background: i === 0 ? accent : accent + 'CC', color: '#fff', padding: '3px 8px', borderRadius: 10, fontSize: 8, border: `1px solid ${accent}` }}>
                  {String(point).replace(/^[-\d.]+\s*/, '').substring(0, 18)}
                </div>
              ))}
            </div>
          )}
          <div style={{ textAlign: 'right', color: titleColor, fontSize: 7, marginTop: 6 }}>P{page.pageNumber} · {page.pageType}</div>
        </div>
      </div>
    );
  }

  // 内容页有图：全幅背景 + 顶部覆层 + 底部覆层
  if (imgSrc) {
    const isCheck = /验收|检查/.test(page.pageType || '');
    const isSteps = /操作步骤|步骤/.test(page.pageType || '');
    const pts = keyPoints.slice(0, 4);
    return (
      <div style={{ aspectRatio: '16/9', borderRadius: 10, border: '1px solid #d1d5db', overflow: 'hidden', position: 'relative', fontSize: 12 }}>
        <img src={toLocalImgSrc(imgSrc)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        {/* 顶部标题覆层 */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '25%', background: 'rgba(5,5,5,0.58)', display: 'flex', alignItems: 'center', paddingLeft: 10, paddingRight: 10, gap: 6 }}>
          <div style={{ width: 3, height: '60%', background: accent, borderRadius: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{page.title || '未命名页面'}</div>
            {page.subtitle && <div style={{ color: accent, fontSize: 8, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{page.subtitle}</div>}
          </div>
          {page.pageType && <div style={{ color: accent, fontSize: 7, fontStyle: 'italic', flexShrink: 0 }}>{page.pageType}</div>}
        </div>
        {/* 底部要点覆层 */}
        {pts.length > 0 && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, minHeight: '33%', background: 'rgba(5,5,5,0.58)', padding: '5px 10px', display: 'grid', gridTemplateColumns: pts.length > 2 ? '1fr 1fr' : '1fr', gap: '3px 12px' }}>
            {pts.map((pt, i) => {
              const badge = isCheck ? '✓' : (isSteps ? String(i + 1) : '•');
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                  <span style={{ background: isCheck ? '#2E7D32' : accent, color: '#fff', borderRadius: '50%', width: 13, height: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 7, fontWeight: 700 }}>{badge}</span>
                  <span style={{ color: '#fff', fontSize: 8.5, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(pt).replace(/^[-\d.]+\s*/, '').substring(0, 34)}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 3, right: 6, color: 'rgba(255,255,255,0.45)', fontSize: 6 }}>P{page.pageNumber}</div>
      </div>
    );
  }

  // 内容页无图：纯文本 fallback
  return (
    <div style={{ background: bg, aspectRatio: '16/9', borderRadius: 10, border: '1px solid #d1d5db', overflow: 'hidden', fontSize: 12, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: accent, height: 5, width: '100%', flexShrink: 0 }} />
      <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ color: titleColor, fontWeight: 700, fontSize: 13, marginBottom: 2, lineHeight: 1.3 }}>{page.title || '未命名页面'}</div>
        {page.subtitle && <div style={{ color: '#6b7280', fontSize: 9, marginBottom: 4 }}>{page.subtitle}</div>}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {keyPoints.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {keyPoints.map((point, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 3, fontSize: 8, color: '#4b5563', lineHeight: 1.3 }}>
                  <span style={{ background: accent, color: '#fff', borderRadius: '50%', width: 12, height: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 7 }}>{i + 1}</span>
                  <span>{String(point).replace(/^[-\d.]+\s*/, '').substring(0, 40)}</span>
                </div>
              ))}
            </div>
          )}
          {page.needImage && <div style={{ marginTop: 6, borderRadius: 4, border: '1px dashed #d1d5db', height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 9 }}>待配图</div>}
        </div>
        <div style={{ textAlign: 'right', color: '#9ca3af', fontSize: 7, marginTop: 2 }}>P{page.pageNumber} · {page.pageType}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   主组件
───────────────────────────────────────────── */
export default function PptStage({
  pptState,
  setPptState,
  assistantStatus,
  busy,
  currentTemplate,
  currentPage,
  handleGeneratePptPlan,
  savePptStage,
  handleConfirmPpt,
  handleExportPpt,
  handleGenerateCurrentPageCandidates,
  handleBatchGenerateImages,
  batchProgress,
  dt,
  api,
  toLocalImgSrc,
  templates,
  // 以下 props 保留接口兼容，不再在 UI 中显示
  handleGeneratePptOutline,
  currentVersions,
  handleRollbackPptVersion,
  handleGenerateCoverImage,
  coverImageBusy,
  coverConfirmed,
  styleAnchor,
  handleConfirmCoverStyle,
  artifacts,
  shorten,
}) {
  const pages   = Array.isArray(pptState.pptPages) ? pptState.pptPages : [];
  const template = templates[pptState.templateKey] || currentTemplate || PPT_TEMPLATE_PRESETS.pro_minimalist;
  const accent   = template?.accentColor || '#2563EB';

  // editMode: false = 网格总览，true = 单页精修
  const [editMode, setEditMode] = React.useState(false);
  const [saveStatus, setSaveStatus] = React.useState('');
  const [genBusy, setGenBusy] = React.useState(false);

  // 统计
  const totalCount   = pages.length;
  const doneCount    = pages.filter(p => !p.needImage || Boolean(p.imagePath || p.imageUrl)).length;
  const missingCount = totalCount - doneCount;

  // 进入单页编辑
  const enterEdit = (pageId) => {
    setPptState(prev => ({ ...prev, selectedPageId: pageId }));
    setEditMode(true);
    setSaveStatus('');
  };

  // 更新当前编辑页的字段
  const updateCurrentPage = (patch) => {
    setPptState(prev => ({
      ...prev,
      pptPages: prev.pptPages.map(p => p.id === prev.selectedPageId ? { ...p, ...patch } : p)
    }));
  };

  // 保存当前页
  const handleSave = () => {
    setSaveStatus('保存中...');
    setPptState(prev => {
      const latestPages = Array.isArray(prev.pptPages) ? prev.pptPages : [];
      const coverPage   = latestPages.find(p => p.pageType === '封面');
      const finalState  = {
        ...prev,
        pptOutline: buildPptTextFramework({ courseName: coverPage?.title || '', template, pages: latestPages })
      };
      Promise.resolve().then(() => {
        savePptStage(finalState).then(ok => {
          setSaveStatus(ok ? '✅ 已保存' : '❌ 保存失败');
          setTimeout(() => setSaveStatus(''), 2500);
        }).catch(() => {
          setSaveStatus('❌ 保存失败');
          setTimeout(() => setSaveStatus(''), 2500);
        });
      });
      return finalState;
    });
  };

  // 单页生成配图（包裹一层以管理本地忙碌态）
  const handleGenSingle = async () => {
    setGenBusy(true);
    try {
      await handleGenerateCurrentPageCandidates();
    } finally {
      setGenBusy(false);
    }
  };

  // ── 顶部操作栏（网格/编辑两种模式通用）──
  const renderTopBar = () => (
    <div className="ppt-topbar">
      {/* 左区 */}
      <div className="ppt-topbar-left">
        {editMode && (
          <button className="v2-btn v2-btn-xs ppt-back-btn" onClick={() => setEditMode(false)}>
            ← 返回总览
          </button>
        )}
        <select
          value={pptState.templateKey}
          onChange={e => setPptState(prev => ({ ...prev, templateKey: e.target.value }))}
          className="ppt-template-select"
        >
          {Object.entries(templates).map(([key, item]) => (
            <option key={key} value={key}>{item.name}</option>
          ))}
        </select>
        <button
          className="v2-btn v2-btn-primary"
          onClick={handleGeneratePptPlan}
          disabled={busy}
        >
          ✨ AI 规划页面
        </button>
        <button
          className="v2-btn ppt-btn-green"
          onClick={handleBatchGenerateImages}
          disabled={batchProgress.running || busy || pages.length === 0}
        >
          {batchProgress.running
            ? `生成中 ${batchProgress.current}/${batchProgress.total}…`
            : `🖼 一键生成全部配图`}
        </button>
      </div>
      {/* 右区 */}
      <div className="ppt-topbar-right">
        {totalCount > 0 && (
          <span className="ppt-stat">
            {totalCount} 页
            <span style={{ color: '#16a34a', marginLeft: 8 }}>{doneCount} 已配图</span>
            {missingCount > 0 && <span style={{ color: '#f59e0b', marginLeft: 8 }}>{missingCount} 待配图</span>}
          </span>
        )}
        {assistantStatus && <span className="ppt-stat ppt-stat-muted">{assistantStatus}</span>}
        <button className="v2-btn v2-btn-secondary" onClick={handleConfirmPpt}>确认 PPT</button>
        <button className="v2-btn v2-btn-primary" onClick={handleExportPpt}>📥 导出 PPT</button>
      </div>
    </div>
  );

  // ── 进度条（批量生成时显示）──
  const renderProgressBar = () => {
    if (!batchProgress.running) return null;
    const pct = batchProgress.total > 0
      ? Math.round((batchProgress.current / batchProgress.total) * 100)
      : 0;
    return (
      <div className="ppt-progress-wrap">
        <div className="ppt-progress-track">
          <div className="ppt-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="ppt-progress-label">{batchProgress.current}/{batchProgress.total} 页完成</span>
      </div>
    );
  };

  // ── 网格总览 ──
  const renderGrid = () => {
    if (pages.length === 0) {
      return (
        <div className="ppt-empty">
          <div className="ppt-empty-icon">📋</div>
          <p>还没有页面规划，点击「✨ AI 规划页面」开始生成。</p>
        </div>
      );
    }
    return (
      <div className="ppt-grid">
        {pages.map(page => {
          const hasImg = Boolean(page.imagePath || page.imageUrl);
          return (
            <button
              key={page.id}
              className="ppt-thumb-card"
              onClick={() => enterEdit(page.id)}
              style={{ '--accent': accent }}
            >
              {/* 缩略图预览区 */}
              <div className="ppt-thumb-preview">
                <SlidePreview page={page} template={template} toLocalImgSrc={toLocalImgSrc} />
              </div>
              {/* 卡片标签 */}
              <div className="ppt-thumb-label">
                <span className="ppt-thumb-title">P{page.pageNumber} · {page.title || '未命名'}</span>
                <span className="ppt-thumb-meta">
                  {page.pageType || '内容页'}
                  {hasImg
                    ? <span className="ppt-badge ppt-badge-done">✓ 已配图</span>
                    : page.needImage
                      ? <span className="ppt-badge ppt-badge-pending">待配图</span>
                      : null}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  // ── 单页精修 ──
  const renderEditor = () => {
    if (!currentPage) {
      setEditMode(false);
      return null;
    }
    const pageIdx = pages.findIndex(p => p.id === currentPage.id);
    const prevPage = pageIdx > 0 ? pages[pageIdx - 1] : null;
    const nextPage = pageIdx < pages.length - 1 ? pages[pageIdx + 1] : null;

    return (
      <div className="ppt-editor">
        {/* 面包屑 */}
        <div className="ppt-breadcrumb">
          <span>PPT 总览</span>
          <span className="ppt-breadcrumb-sep">›</span>
          <strong>P{currentPage.pageNumber} · {currentPage.title || '未命名'}</strong>
          <span className="ppt-breadcrumb-type">{currentPage.pageType}</span>
        </div>

        <div className="ppt-editor-body">
          {/* 左侧：大预览 + 翻页 */}
          <div className="ppt-editor-preview">
            <SlidePreview page={currentPage} template={template} toLocalImgSrc={toLocalImgSrc} />
            <div className="ppt-editor-nav">
              <button
                className="v2-btn v2-btn-xs"
                disabled={!prevPage}
                onClick={() => enterEdit(prevPage.id)}
              >← 上一页</button>
              <span className="ppt-editor-nav-label">P{currentPage.pageNumber} / {pages.length}</span>
              <button
                className="v2-btn v2-btn-xs"
                disabled={!nextPage}
                onClick={() => enterEdit(nextPage.id)}
              >下一页 →</button>
            </div>
            {/* 当前配图（小图） */}
            {(currentPage.imagePath || currentPage.imageUrl) && (
              <div className="ppt-editor-curimg">
                <div className="ppt-editor-curimg-label">当前配图</div>
                <img
                  src={toLocalImgSrc(currentPage.imagePath || currentPage.imageUrl)}
                  alt=""
                  style={{ width: '100%', borderRadius: 6, border: '1px solid #e5e7eb', display: 'block' }}
                />
                <button
                  className="v2-btn v2-btn-xs"
                  style={{ marginTop: 6 }}
                  onClick={() => api.openResource(currentPage.imagePath || currentPage.imageUrl)}
                >打开原图</button>
              </div>
            )}
          </div>

          {/* 右侧：编辑表单 */}
          <div className="ppt-editor-form">
            <div className="v2-grid-two">
              <div>
                <label className="v2-label">页面标题</label>
                <input value={currentPage.title || ''} onChange={e => updateCurrentPage({ title: e.target.value })} />
              </div>
              <div>
                <label className="v2-label">副标题</label>
                <input value={currentPage.subtitle || ''} onChange={e => updateCurrentPage({ subtitle: e.target.value })} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="v2-label">要点内容（每行一条，最多 5 条）</label>
              <textarea
                rows={5}
                className="v2-code"
                value={currentPage.keyContent || ''}
                onChange={e => updateCurrentPage({ keyContent: e.target.value })}
                placeholder="每行一个要点，修改后左侧预览实时更新。"
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="v2-label">演讲备注</label>
              <textarea
                rows={3}
                value={currentPage.speakerNotes || ''}
                onChange={e => updateCurrentPage({ speakerNotes: e.target.value })}
                placeholder="导出 PPTX 时写入演讲者备注。"
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="v2-label">图片提示词（留空则自动生成）</label>
              <textarea
                rows={4}
                className="v2-code"
                value={currentPage.imagePrompt || ''}
                onChange={e => updateCurrentPage({ imagePrompt: e.target.value })}
                placeholder="修改提示词 → 点「生成配图」→ 预览满意 → 保存。"
              />
            </div>

            <label className="v2-checkbox-row" style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={Boolean(currentPage.needImage)}
                onChange={e => updateCurrentPage({ needImage: e.target.checked })}
              />
              <span>此页需要配图</span>
            </label>

            {/* 操作按钮组 */}
            <div className="ppt-editor-actions">
              <button
                className="v2-btn v2-btn-primary ppt-editor-gen-btn"
                onClick={handleGenSingle}
                disabled={genBusy || busy || !currentPage.needImage}
              >
                {genBusy ? '生成中…' : '🖼 生成此页配图'}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="v2-btn v2-btn-secondary" onClick={handleSave} style={{ flex: 1 }}>
                  💾 保存
                </button>
                <button className="v2-btn v2-btn-secondary" onClick={() => setEditMode(false)} style={{ flex: 1 }}>
                  返回总览
                </button>
              </div>
              {saveStatus && (
                <div style={{ fontSize: 12, textAlign: 'center', color: saveStatus.includes('✅') ? '#16a34a' : '#dc2626' }}>
                  {saveStatus}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── 渲染 ──
  return (
    <div className="ppt-stage-root">
      {renderTopBar()}
      {renderProgressBar()}
      {editMode ? renderEditor() : renderGrid()}
    </div>
  );
}
