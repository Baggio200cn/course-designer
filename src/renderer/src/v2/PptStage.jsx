import React from 'react';
import AssistantStatusAvatar from './AssistantStatusAvatar';
import { buildPptTextFramework, PPT_TEMPLATE_PRESETS } from './stage-helpers';
// v4.3.3 新版 · PPT 网格最大化预览（老师反馈：视觉预览不能撑满）
import { PreviewFullscreen, PreviewFullscreenToggle } from './PreviewFullscreen';

/* ─────────────────────────────────────────────
   PerPageRegenerate — 2026-05-16 v4.1.4 Phase 2
   自然语言提示词重生 + 参考图上传
───────────────────────────────────────────── */
function PerPageRegenerate({ api, currentPage, updateCurrentPage, mainAccentColor, notebookId }) {
  const [instruction, setInstruction] = React.useState('');
  const [referenceImage, setReferenceImage] = React.useState(null);  // { name, base64, desc }
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');

  // 推荐提示词模板（chip）—— 老师一键填入
  const PROMPT_HINTS = [
    { label: '换成左文右图', text: '把这页改成 two-column 排版：左侧 3 条要点，右侧放数据卡或配图。' },
    { label: '换成流程图', text: '把要点改成 4 步操作流程，layoutType 用 diagram-center。' },
    { label: '强化金句感', text: '把这页改成 quote 金句版：去掉 bullet，留一句最有力的话居中放大。' },
    { label: '加表格', text: '把要点改成 table 表格：维度 / 标准 / 占比 三列。' },
    { label: '配图更具体', text: '配图换成本课软件 / 行业的真实场景特写，避免抽象示意。' },
    { label: '更口语化', text: '把演讲备注改成更口语化的版本，老师上课能直接念。' },
    { label: '加互动提问', text: '加一句课堂提问句，引导学生思考。' },
    { label: '更暗的视觉', text: 'themeMode 改为 dark，整页改沉浸式深色调。' },
  ];

  const onUploadRefImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      window.alert('只支持图片文件');
      return;
    }
    const buffer = await file.arrayBuffer();
    const base64 = btoa(new Uint8Array(buffer).reduce((d, b) => d + String.fromCharCode(b), ''));
    setReferenceImage({
      name: file.name,
      base64: `data:${file.type};base64,${base64}`,
      desc: `（参考图：${file.name}，老师希望以此图为视觉/构图风格参考）`,
    });
  };

  const onRegenerate = async () => {
    if (!instruction.trim() && !referenceImage) {
      window.alert('请输入修改指令，或上传参考图');
      return;
    }
    if (typeof api?.regeneratePptPageV2 !== 'function') {
      window.alert('preload 未暴露 regeneratePptPageV2，请重启 Electron');
      return;
    }
    setBusy(true);
    setStatus('AI 重生中…');
    try {
      const res = await api.regeneratePptPageV2({
        notebookId,
        page: currentPage,
        instruction: instruction.trim(),
        referenceImageDesc: referenceImage?.desc || '',
        mainAccentColor,
      });
      if (!res?.success) {
        setStatus(`❌ ${res?.error || '重生失败'}`);
        return;
      }
      const newPage = res.data?.page;
      if (!newPage) {
        setStatus('❌ AI 返回内容为空');
        return;
      }
      // 用新页字段覆盖当前页
      updateCurrentPage(newPage);
      setStatus('✅ 已重生，预览已更新');
      setInstruction('');
      setReferenceImage(null);
      setTimeout(() => setStatus(''), 4000);
    } catch (err) {
      setStatus(`❌ ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8, padding: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#475569', marginBottom: 6 }}>
        💡 提示词样例（点击填入，可继续修改）
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {PROMPT_HINTS.map((h) => (
          <button
            key={h.label}
            type="button"
            className="v2-btn v2-btn-xs"
            onClick={() => setInstruction((cur) => cur ? `${cur}\n${h.text}` : h.text)}
            title={h.text}
          >
            {h.label}
          </button>
        ))}
      </div>

      <textarea
        rows={4}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="自然语言告诉 AI 怎么改这一页。可以包含：文字怎么改、配图怎么改、排版换成什么样、配色调整……"
        style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
        <label
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', background: '#fff', border: '1px solid #cbd5e1',
            borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}
        >
          📎 上传参考图
          <input type="file" accept="image/*" onChange={onUploadRefImage} style={{ display: 'none' }} />
        </label>
        {referenceImage ? (
          <span style={{ fontSize: 12, color: '#475569' }}>
            已选：{referenceImage.name}
            <button
              type="button"
              className="v2-btn v2-btn-xs"
              onClick={() => setReferenceImage(null)}
              style={{ marginLeft: 6 }}
            >移除</button>
          </span>
        ) : (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>（可选，AI 会按参考图调整 imagePrompt）</span>
        )}
      </div>

      <button
        type="button"
        className="v2-btn v2-btn-primary"
        onClick={onRegenerate}
        disabled={busy || (!instruction.trim() && !referenceImage)}
        style={{ marginTop: 10, width: '100%' }}
      >
        {busy ? '🤖 AI 重生中…' : '🤖 用提示词重生此页'}
      </button>
      {status ? (
        <div style={{ marginTop: 6, fontSize: 12, color: status.includes('✅') ? '#16a34a' : (status.includes('❌') ? '#dc2626' : '#475569') }}>
          {status}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────
   SlidePreview — 单张 slide 视觉预览（只读）
   支持：封面 / 路线图 / 内容页有图 / 内容页无图
───────────────────────────────────────────── */
function SlidePreview({ page, template, toLocalImgSrc, mainAccentColor }) {
  if (!page) return <p className="v2-hint">选择一个页面查看预览效果。</p>;
  const style   = template || PPT_TEMPLATE_PRESETS.pro_minimalist;
  // 2026-05-16 v4.1.4：accent 优先用 page.accentColor → mainAccentColor → template
  const pageAccent = String(page.accentColor || '').trim();
  const accent  = pageAccent || mainAccentColor || style.accentColor || '#2563EB';
  const compositeImgSrc = page.compositeImagePath;
  const imgSrc  = page.imagePath || page.imageUrl;
  // 🔥 2026-05-16 v4.1.4 关键 bug 修复：兼容 keyContent 数组 + 字符串两种类型
  const keyPoints = Array.isArray(page.keyContent)
    ? page.keyContent.filter(Boolean).map(String).slice(0, 5)
    : String(page.keyContent || '').split('\n').filter(Boolean).slice(0, 5);
  const layoutType = String(page.layoutType || '').trim();
  const themeMode = String(page.themeMode || '').trim() || 'light';
  const isDark = themeMode === 'dark';
  const bg = isDark ? '#0F172A' : (style.background || '#FFFFFF');
  const fg = isDark ? '#F8FAFC' : '#0F172A';
  const sub = isDark ? '#CBD5E1' : '#475569';

  // 通用样式块
  // P6 修复（2026-05-18）：line bug 根因——
  //   baseCard 用 aspectRatio:16/9 + 内部子元素全 position:absolute
  //   父容器 .ppt-thumb-preview 提供高度，baseCard 必须显式 width/height:100% 才能撑满
  //   否则 baseCard width=auto=0 → aspectRatio 算高度=0 → 只剩 border + 5px accent 横条 → 看着是几条线
  const baseCard = {
    width: '100%', height: '100%',
    aspectRatio: '16/9', borderRadius: 10, border: '1px solid #d1d5db',
    overflow: 'hidden', position: 'relative', background: bg, color: fg, fontSize: 11,
  };

  // 合成图：优先（已 WYSIWYG，直接铺）
  if (compositeImgSrc) {
    return (
      <div style={{ ...baseCard, fontSize: 12 }}>
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

  // 角标：layoutType + pageType + page number
  const renderCornerBadges = () => (
    <>
      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 3, flexDirection: 'column', alignItems: 'flex-end' }}>
        {layoutType ? <span style={{ background: accent, color: '#fff', fontSize: 8, padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>{layoutType}</span> : null}
        {page.pageType ? <span style={{ background: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.06)', color: sub, fontSize: 8, padding: '1px 5px', borderRadius: 3 }}>{page.pageType}</span> : null}
      </div>
      <div style={{ position: 'absolute', bottom: 4, right: 6, color: isDark ? 'rgba(255,255,255,0.5)' : '#94A3B8', fontSize: 8 }}>P{page.pageNumber}</div>
    </>
  );

  // ═══ Layout 1: hero —— 封面 / 谢谢 / 总结金句 ═══
  //   2026-05-16 v4.1.4：右侧"装饰色块"改成真实配图（如果有），实现 WYSIWYG
  if (layoutType === 'hero' || page.pageType === '封面' || page.pageType === '谢谢') {
    return (
      <div style={baseCard}>
        {/* 右下角：配图 OR 装饰色块 */}
        {imgSrc ? (
          <div style={{ position: 'absolute', right: 0, bottom: 0, width: '50%', height: '100%', overflow: 'hidden' }}>
            <img src={toLocalImgSrc(imgSrc)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {/* 左侧渐变让标题区可读 */}
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '30%', background: `linear-gradient(to right, ${bg}, transparent)` }} />
          </div>
        ) : (
          <>
            <div style={{ position: 'absolute', right: 0, bottom: 0, width: '45%', height: '60%', background: accent, opacity: 0.92 }} />
            <div style={{ position: 'absolute', right: 12, bottom: 12, width: 22, height: 22, borderRadius: '50%', background: bg, opacity: 0.3 }} />
          </>
        )}
        {/* 标题区 */}
        <div style={{ position: 'absolute', left: 14, top: '28%', right: '52%', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: fg, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', textShadow: imgSrc && !isDark ? '0 1px 3px rgba(255,255,255,0.8)' : 'none' }}>{page.title || '封面标题'}</div>
          <div style={{ width: 28, height: 2, background: accent }} />
          {page.subtitle ? <div style={{ fontSize: 10, color: sub, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{page.subtitle}</div> : null}
        </div>
        {renderCornerBadges()}
      </div>
    );
  }

  // ═══ Layout 2: two-column —— 标题 + 左文 + 右图/数据 ═══
  if (layoutType === 'two-column' || (!layoutType && page.pageType === '知识讲解')) {
    return (
      <div style={baseCard}>
        {/* 顶部 accent 色条 */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 3, height: '100%', background: accent }} />
        {/* 标题区 */}
        <div style={{ position: 'absolute', left: 10, right: 10, top: 6, paddingBottom: 4, borderBottom: `1.5px solid ${accent}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: fg, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.title || '本页标题'}</div>
          {page.subtitle ? <div style={{ fontSize: 9, color: sub, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.subtitle}</div> : null}
        </div>
        {/* 主体：左列文字 + 右列图/数据 */}
        <div style={{ position: 'absolute', left: 10, right: 10, top: 38, bottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {/* 左：bullet */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
            {keyPoints.slice(0, 4).map((pt, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 9, color: fg, lineHeight: 1.35 }}>
                <span style={{ background: accent, width: 5, height: 5, borderRadius: '50%', flexShrink: 0, marginTop: 4 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{String(pt).replace(/^[-\d.]+\s*/, '')}</span>
              </div>
            ))}
          </div>
          {/* 右：图 或 数据卡 */}
          <div style={{ position: 'relative', borderRadius: 4, overflow: 'hidden', background: isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9' }}>
            {imgSrc ? (
              <img src={toLocalImgSrc(imgSrc)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 6, gap: 4 }}>
                {page.dataPoint ? <div style={{ fontSize: 10, fontWeight: 700, color: accent, textAlign: 'center' }}>📊 {String(page.dataPoint).slice(0, 18)}</div> : null}
                {page.caseExample ? <div style={{ fontSize: 8, color: sub, textAlign: 'center', lineHeight: 1.3 }}>💡 {String(page.caseExample).slice(0, 30)}</div> : null}
                {!page.dataPoint && !page.caseExample ? <span style={{ color: isDark ? '#64748B' : '#94A3B8', fontSize: 9 }}>待配图</span> : null}
              </div>
            )}
          </div>
        </div>
        {renderCornerBadges()}
      </div>
    );
  }

  // ═══ Layout 3: image-bleed —— 全图 + 文字浮层 ═══
  if (layoutType === 'image-bleed' || (!layoutType && page.pageType === '课程导入')) {
    return (
      <div style={baseCard}>
        {imgSrc ? (
          <img src={toLocalImgSrc(imgSrc)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${accent}, ${accent}80)` }} />
        )}
        {/* 底部深色浮层 */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }} />
        <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14, color: '#fff' }}>
          <div style={{ width: 3, height: 14, background: accent, display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
          <span style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.2, verticalAlign: 'middle' }}>{page.title || '导入标题'}</span>
          {page.subtitle ? <div style={{ fontSize: 9, color: '#E2E8F0', marginTop: 4, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{page.subtitle}</div> : null}
        </div>
        {renderCornerBadges()}
      </div>
    );
  }

  // ═══ Layout 4: diagram-center —— 横向流程链 ═══
  if (layoutType === 'diagram-center' || (!layoutType && (page.pageType === '操作步骤' || page.pageType === '路线图'))) {
    const stepColors = ['#FBBF24', '#FB923C', '#22C55E', '#3B82F6', '#A855F7', '#EC4899'];
    const steps = keyPoints.slice(0, 5);
    return (
      <div style={baseCard}>
        {/* 半透明配图作为底层水印（2026-05-16 v4.1.4 加） */}
        {imgSrc ? (
          <>
            <img src={toLocalImgSrc(imgSrc)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.18 }} />
            <div style={{ position: 'absolute', inset: 0, background: isDark ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.65)' }} />
          </>
        ) : null}
        {/* 标题 */}
        <div style={{ position: 'absolute', left: 10, top: 8, right: 10, paddingBottom: 3, borderBottom: `1.5px solid ${accent}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: fg, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.title || '流程标题'}</div>
        </div>
        {/* 横向圆环步骤 */}
        <div style={{ position: 'absolute', left: 6, right: 6, top: '45%', transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
          {steps.length > 0 ? steps.map((pt, i) => (
            <React.Fragment key={i}>
              <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: stepColors[i % stepColors.length], color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11 }}>{i + 1}</div>
                <div style={{ fontSize: 7.5, color: fg, marginTop: 2, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', padding: '0 1px' }}>{String(pt).replace(/^[-\d.]+\s*/, '').slice(0, 8)}</div>
              </div>
              {i < steps.length - 1 ? <span style={{ color: sub, fontSize: 12, flexShrink: 0 }}>→</span> : null}
            </React.Fragment>
          )) : (
            <div style={{ width: '100%', textAlign: 'center', color: sub, fontSize: 9 }}>（未填要点）</div>
          )}
        </div>
        {renderCornerBadges()}
      </div>
    );
  }

  // ═══ Layout 5: quote —— 大字单句 ═══
  if (layoutType === 'quote' || (!layoutType && page.pageType === '课堂练习')) {
    const quote = String(page.interactionPrompt || keyPoints[0] || page.title || '').slice(0, 60);
    return (
      <div style={{ ...baseCard, background: `${accent}15` }}>
        {/* 半透明配图水印 */}
        {imgSrc ? (
          <>
            <img src={toLocalImgSrc(imgSrc)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.15 }} />
            <div style={{ position: 'absolute', inset: 0, background: `${accent}25` }} />
          </>
        ) : null}
        <div style={{ position: 'absolute', left: 12, top: 4, fontSize: 48, color: accent, fontFamily: 'serif', lineHeight: 1, opacity: 0.6 }}>"</div>
        <div style={{ position: 'absolute', left: 24, right: 18, top: '38%', transform: 'translateY(-50%)', textAlign: 'center', fontSize: 13, fontWeight: 800, color: fg, lineHeight: 1.4 }}>
          {quote}
        </div>
        <div style={{ position: 'absolute', left: '50%', bottom: '24%', transform: 'translateX(-50%)', width: 24, height: 2, background: accent }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: '12%', textAlign: 'center', fontSize: 9, color: accent, fontStyle: 'italic' }}>{page.title || ''}</div>
        {renderCornerBadges()}
      </div>
    );
  }

  // ═══ Layout 6: table —— 验收标准 / 评分维度 ═══
  if (layoutType === 'table' || (!layoutType && page.pageType === '验收标准')) {
    return (
      <div style={baseCard}>
        {/* 标题 */}
        <div style={{ position: 'absolute', left: 10, top: 8, right: 10, paddingBottom: 3, borderBottom: `1.5px solid ${accent}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.title || '验收标准'}</div>
        </div>
        {/* 表格 */}
        <div style={{ position: 'absolute', left: 10, right: 10, top: 38, bottom: 14 }}>
          {/* 表头 */}
          <div style={{ background: accent, color: '#fff', display: 'grid', gridTemplateColumns: '1fr 2.5fr 0.6fr', fontSize: 9, fontWeight: 700, padding: '3px 6px' }}>
            <span>维度</span>
            <span>标准</span>
            <span style={{ textAlign: 'right' }}>权重</span>
          </div>
          {/* 表体（解析 bullet 为表格行） */}
          {keyPoints.slice(0, 4).map((pt, i) => {
            const text = String(pt).replace(/^[-\d.]+\s*/, '');
            const m = text.match(/^(.+?)[:：](.+)$/);
            const dim = m ? m[1] : `${i + 1}`;
            const criterion = m ? m[2] : text;
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr 2.5fr 0.6fr',
                fontSize: 9, padding: '3px 6px',
                background: i % 2 === 0 ? (isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC') : 'transparent',
                borderBottom: '1px solid ' + (isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0'),
                color: fg,
              }}>
                <span style={{ color: accent, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dim}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{criterion}</span>
                <span style={{ color: sub, textAlign: 'right' }}>—</span>
              </div>
            );
          })}
        </div>
        {renderCornerBadges()}
      </div>
    );
  }

  // ═══ Layout 7: bullet-list —— 标题 + 纵向列表（兜底）═══
  //   2026-05-16 v4.1.4：右侧 1/3 给配图（如果有），让无图/有图都看得到内容
  return (
    <div style={baseCard}>
      <div style={{ position: 'absolute', left: 0, top: 0, height: 5, width: '100%', background: accent }} />
      <div style={{ position: 'absolute', left: 10, top: 11, right: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: fg, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.title || '本页标题'}</div>
        {page.subtitle ? <div style={{ fontSize: 9, color: sub, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.subtitle}</div> : null}
      </div>
      {/* 主体：有图时左 2/3 文 + 右 1/3 图；无图时全宽文 */}
      <div style={{ position: 'absolute', left: 10, right: imgSrc ? '38%' : 10, top: 44, bottom: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {keyPoints.slice(0, 5).map((pt, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 10, color: fg, lineHeight: 1.35 }}>
            <span style={{ background: accent, color: '#fff', borderRadius: '50%', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 8, fontWeight: 700, marginTop: 1 }}>{i + 1}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{String(pt).replace(/^[-\d.]+\s*/, '')}</span>
          </div>
        ))}
        {keyPoints.length === 0 ? <span style={{ color: sub, fontSize: 9, fontStyle: 'italic' }}>（未填要点）</span> : null}
      </div>
      {imgSrc ? (
        <div style={{ position: 'absolute', right: 0, top: 44, bottom: 14, width: '36%', overflow: 'hidden', borderRadius: '4px 0 0 4px' }}>
          <img src={toLocalImgSrc(imgSrc)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      ) : null}
      {renderCornerBadges()}
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
  setAssistantStatus,           // D5.2：取消时设置状态
  busy,
  setBusy,                       // D5.2：取消时重置 busy
  selectedNotebookId,           // P6（2026-05-18）：notebookId fallback，避免 pptState.notebookId null
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

  // 2026-05-15 P2-5：监听 PPT 双阶段 pipeline 进度
  const [pipelineProgress, setPipelineProgress] = React.useState(null);
  React.useEffect(() => {
    if (typeof api?.onPptProgress !== 'function') return;
    const unsub = api.onPptProgress((evt) => {
      if (evt.phase === 'all-done') {
        // 1.5 秒后自动清理（不立即清，让老师看到"完成"）
        setPipelineProgress({ ...evt, _doneTime: Date.now() });
        setTimeout(() => setPipelineProgress(null), 1500);
      } else {
        setPipelineProgress(evt);
      }
    });
    return unsub;
  }, [api]);

  // v4.3.0 D1+D2（2026-05-18）：进 PPT 阶段时自动调 AI 推主色 + 配图风格候选
  //   仅当还没拿到 candidates 时调一次（避免每次切到 PPT 都重调，浪费 AI quota）
  React.useEffect(() => {
    if (!pptState?.notebookId) return;
    if (Array.isArray(pptState.accentCandidates) && pptState.accentCandidates.length > 0) return;
    if (typeof api?.suggestPptDesignTokensV2 !== 'function') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.suggestPptDesignTokensV2({ notebookId: pptState.notebookId });
        if (cancelled) return;
        if (res?.success && setPptState) {
          setPptState(prev => ({
            ...prev,
            accentCandidates: res.data.accentCandidates,
            mainAccentColor: prev.mainAccentColor || res.data.recommendedAccent,
            imageStylePreset: prev.imageStylePreset || res.data.imageStylePreset,
            imageStyleReason: res.data.imageStyleReason,
            allImageStylePresets: res.data.allImageStylePresets,
          }));
        }
      } catch (e) { console.warn('[PptStage] suggestPptDesignTokens failed:', e.message); }
    })();
    return () => { cancelled = true; };
  }, [pptState?.notebookId]);

  // 2026-05-15 P2-3：动态练习预览/编辑
  const exercisePage = pages.find((p) => p.pageType === '动态练习');
  const [showExerciseModal, setShowExerciseModal] = React.useState(false);
  const [editingExercises, setEditingExercises] = React.useState([]);
  // 2026-05-16 v4.1.4：单独重生动态练习题（不重生整个 PPT）
  const [exerciseRetryBusy, setExerciseRetryBusy] = React.useState(false);
  const [exerciseRetryMsg, setExerciseRetryMsg] = React.useState('');
  const openExerciseModal = () => {
    if (!exercisePage) return;
    setEditingExercises(Array.isArray(exercisePage.exercises) ? JSON.parse(JSON.stringify(exercisePage.exercises)) : []);
    setShowExerciseModal(true);
  };
  // 2026-05-16 v4.1.4：课堂演示 —— 弹独立全屏窗口播放交互题
  const handleOpenExercisePresentation = async () => {
    if (!exercisePage) {
      window.alert('未找到动态练习页');
      return;
    }
    const exerciseHtml = exercisePage.exerciseHtml || '';
    if (!exerciseHtml || exerciseHtml.length < 100) {
      const ok = window.confirm(
        'exerciseHtml 为空或损坏，无法演示。\n\n是否点【🔄 重试 AI 出题】先生成？'
      );
      if (ok) {
        openExerciseModal();
        // 自动触发 retry
        setTimeout(() => handleRetryDynamicExercise(), 300);
      }
      return;
    }
    if (typeof api?.openExercisePresentationV2 !== 'function') {
      window.alert('preload 未暴露 openExercisePresentationV2，请重启 Electron');
      return;
    }
    const res = await api.openExercisePresentationV2({
      exerciseHtml,
      title: exercisePage.title || '课堂动态练习',
    });
    if (!res?.success) {
      window.alert(`打开演示窗口失败：${res?.error || '未知错误'}`);
    }
  };

  const handleRetryDynamicExercise = async () => {
    if (typeof api?.regenerateDynamicExerciseV2 !== 'function') {
      window.alert('preload 未暴露 regenerateDynamicExerciseV2，请重启 Electron');
      return;
    }
    setExerciseRetryBusy(true);
    setExerciseRetryMsg('AI 出题中（最多 3 次重试）…');
    try {
      const res = await api.regenerateDynamicExerciseV2({
        notebookId: pptState.notebookId,
        pages: pages,
        courseName: pptState.lessonContext?.topic || '课程',
        totalHours: pptState.lessonContext?.totalHours || 1,
      });
      if (!res?.success) {
        setExerciseRetryMsg(`❌ ${res?.error || '重试失败'}`);
        return;
      }
      const { exercises, exerciseHtml, title, subtitle, keyContent } = res.data || {};
      if (!Array.isArray(exercises) || exercises.length === 0) {
        setExerciseRetryMsg('❌ AI 仍返回 0 题');
        return;
      }
      // 把新 exercises 写回当前 exercisePage
      const newPages = (pptState.pptPages || []).map((p) =>
        p.pageType === '动态练习'
          ? { ...p, exercises, exerciseHtml: exerciseHtml || p.exerciseHtml,
              title: title || p.title, subtitle: subtitle || p.subtitle,
              keyContent: keyContent || p.keyContent,
              _generationFailed: false, _failureReason: '' }
          : p
      );
      setPptState((prev) => ({ ...prev, pptPages: newPages }));
      // 同步弹窗里的编辑列表
      setEditingExercises(JSON.parse(JSON.stringify(exercises)));
      setExerciseRetryMsg(`✅ 重新生成 ${exercises.length} 道题，请点保存修改持久化`);
      // 自动保存到 DB
      if (typeof savePptStage === 'function') {
        savePptStage({ ...pptState, pptPages: newPages });
      }
    } catch (err) {
      setExerciseRetryMsg(`❌ ${err.message}`);
    } finally {
      setExerciseRetryBusy(false);
      setTimeout(() => setExerciseRetryMsg(''), 6000);
    }
  };
  const saveExerciseChanges = async () => {
    if (!exercisePage) return;
    if (editingExercises.length === 0) {
      window.alert('至少保留 1 道题。');
      return;
    }
    // 调主进程重建 HTML
    let newHtml = exercisePage.exerciseHtml;
    try {
      if (typeof api?.rebuildExerciseHtmlV2 === 'function') {
        const r = await api.rebuildExerciseHtmlV2({
          exercises: editingExercises,
          title: exercisePage.title,
          subtitle: exercisePage.subtitle,
          courseName: pptState.courseName || '',
        });
        if (r?.success) newHtml = r.data.html;
      }
    } catch (e) {
      console.warn('[PptStage] rebuildExerciseHtml 失败，沿用旧 HTML', e);
    }
    const newPages = (pptState.pptPages || []).map((p) =>
      p.pageType === '动态练习'
        ? { ...p, exercises: editingExercises, exerciseHtml: newHtml }
        : p
    );
    setPptState((prev) => ({ ...prev, pptPages: newPages }));
    setShowExerciseModal(false);
    if (typeof savePptStage === 'function') {
      savePptStage({ ...pptState, pptPages: newPages });
    }
  };
  const updateExerciseField = (idx, field, value) => {
    setEditingExercises((prev) => prev.map((ex, i) => i === idx ? { ...ex, [field]: value } : ex));
  };
  const deleteExercise = (idx) => {
    if (!window.confirm(`删除第 ${idx + 1} 题？`)) return;
    setEditingExercises((prev) => prev.filter((_, i) => i !== idx));
  };
  const moveExercise = (idx, dir) => {
    setEditingExercises((prev) => {
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };
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
  // 2026-05-16 v4.1.4 Phase 2：去掉模板下拉，改为"AI 自主决定主题色"徽章
  const renderTopBar = () => (
    <div className="ppt-topbar">
      {/* 左区 */}
      <div className="ppt-topbar-left">
        {editMode && (
          <button className="v2-btn v2-btn-xs ppt-back-btn" onClick={() => setEditMode(false)}>
            ← 返回总览
          </button>
        )}
        {/* v4.3.0 D1 重设计（2026-05-18）：主色 AI 候选 chip
            原"AI 主色徽章"只显示单一色，老师无法挑/换色 → 改为多候选 chip + 自定义 input */}
        <div
          title="整门课主色：AI 根据课程性质推荐 3-5 个候选，老师可点 chip 切换 / 输入自定义 hex（H14 反编造：AI 推但不锁）"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
        >
          <span style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>🎨 整门课主色</span>
          {/* AI 候选 chips（最多 5 个）*/}
          {Array.isArray(pptState.accentCandidates) && pptState.accentCandidates.length > 0 ? (
            pptState.accentCandidates.map((c) => {
              const isActive = (pptState.mainAccentColor || '').toUpperCase() === c.hex.toUpperCase();
              return (
                <button
                  key={c.hex}
                  onClick={() => setPptState(prev => ({ ...prev, mainAccentColor: c.hex }))}
                  title={`${c.name}：${c.reason}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px',
                    background: isActive ? c.hex : '#fff',
                    color: isActive ? '#fff' : c.hex,
                    border: `1px solid ${c.hex}`,
                    borderRadius: 4, fontSize: 11, cursor: 'pointer',
                    fontWeight: isActive ? 700 : 400,
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.hex, border: isActive ? '1px solid #fff' : 'none' }} />
                  {c.name}
                </button>
              );
            })
          ) : (
            <button
              onClick={async () => {
                if (typeof api.suggestPptDesignTokensV2 !== 'function') return;
                const res = await api.suggestPptDesignTokensV2({ notebookId: pptState.notebookId });
                if (res?.success) {
                  setPptState(prev => ({
                    ...prev,
                    accentCandidates: res.data.accentCandidates,
                    mainAccentColor: prev.mainAccentColor || res.data.recommendedAccent,
                    imageStylePreset: prev.imageStylePreset || res.data.imageStylePreset,
                    imageStyleReason: res.data.imageStyleReason,
                    allImageStylePresets: res.data.allImageStylePresets,
                  }));
                }
              }}
              style={{ padding: '3px 8px', fontSize: 11, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #93C5FD', borderRadius: 4, cursor: 'pointer' }}
            >
              ✨ AI 推荐主色
            </button>
          )}
          {/* 自定义 hex 输入 */}
          <input
            type="color"
            value={pptState.mainAccentColor || '#2E86DE'}
            onChange={(e) => setPptState(prev => ({ ...prev, mainAccentColor: e.target.value.toUpperCase() }))}
            style={{ width: 28, height: 22, padding: 0, border: '1px solid #CBD5E1', borderRadius: 3, cursor: 'pointer' }}
            title="自定义主色（不在 AI 候选里时用）"
          />
        </div>

        {/* v4.3.0 D2（2026-05-18）：整门课配图风格 preset */}
        {Array.isArray(pptState.allImageStylePresets) && pptState.allImageStylePresets.length > 0 ? (
          <div
            title={pptState.imageStyleReason ? `AI 推荐：${pptState.imageStyleReason}` : '整门课配图统一风格（影响下次「一键生成全部配图」）'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <span style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>🖼 配图风格</span>
            <select
              value={pptState.imageStylePreset || 'flat'}
              onChange={(e) => setPptState(prev => ({ ...prev, imageStylePreset: e.target.value }))}
              style={{ fontSize: 11, padding: '2px 4px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#fff' }}
            >
              {pptState.allImageStylePresets.map(p => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        {/* P6 增强（2026-05-18）：目标设计选择器
            老师反馈："如果在教学设计阶段做了多个，PPT 阶段是否能下拉选哪节生成"
            答：能。下面下拉显示所有已确认设计，老师挑哪节就生成哪节的 PPT */}
        {Array.isArray(pptState.confirmedDesigns) && pptState.confirmedDesigns.length > 0 ? (
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 8px', background: '#DBEAFE', border: '1px solid #2563EB',
              borderRadius: 6, fontSize: 12,
            }}
            title={`目前有 ${pptState.confirmedDesigns.length} 个已确认教学设计，可下拉切换选哪节生成 PPT。回教学设计阶段创建并确认更多节课，这里就能切换。`}
          >
            <span style={{ color: '#1E40AF', fontWeight: 600 }}>🎯 选目标设计</span>
            <select
              value={pptState.targetDesignId || ''}
              onChange={(e) => setPptState((prev) => ({ ...prev, targetDesignId: Number(e.target.value) || null }))}
              style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid #2563EB', background: '#EFF6FF' }}
            >
              {pptState.confirmedDesigns.map((d) => (
                <option key={d.designId} value={d.designId}>
                  第 {d.lessonNumber} 节·{d.topic || '未命名'}（{d.totalHours} 学时）
                </option>
              ))}
            </select>
            <span style={{ fontSize: 10, color: '#64748B' }}>
              （共 {pptState.confirmedDesigns.length} 个
              {pptState.confirmedDesigns.length === 1
                ? '；如需多节课 PPT，回教学设计阶段多确认几节'
                : '，可下拉切换'}）
            </span>
            {pptState.confirmedDesigns.length === 1 && typeof pptState.onJumpToDesign === 'function' ? (
              <button
                onClick={() => pptState.onJumpToDesign()}
                style={{
                  marginLeft: 4, padding: '2px 6px', fontSize: 10,
                  background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B',
                  borderRadius: 3, cursor: 'pointer',
                }}
              >↩ 去教学设计创建更多节课</button>
            ) : null}
          </div>
        ) : Array.isArray(pptState.confirmedLessons) && pptState.confirmedLessons.length > 0 ? (
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 8px', background: '#FEF3C7', border: '1px solid #F59E0B',
              borderRadius: 6, fontSize: 12,
            }}
            title="v4.1.x 兼容模式：基于已确认讲稿生成 PPT（推荐升级到 design-first：先在教学设计阶段确认节课）"
          >
            <span style={{ color: '#92400E', fontWeight: 600 }}>🪦 目标讲稿（兼容模式）</span>
            <select
              value={pptState.targetLessonId || ''}
              onChange={(e) => setPptState((prev) => ({ ...prev, targetLessonId: Number(e.target.value) || null }))}
              style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid #F59E0B', background: '#FFFBEB' }}
            >
              {pptState.confirmedLessons.map((l) => (
                <option key={l.lessonId} value={l.lessonId}>
                  第 {l.lessonNumber} 节·{l.topic || '未命名'}（{l.totalHours} 学时）
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 8px', background: '#FEE2E2', border: '1px solid #DC2626',
              borderRadius: 6, fontSize: 12, color: '#991B1B',
            }}
            title="还没有任何已确认的教学设计。可能是 UI 缓存，先点「🔄 重新加载」试试"
          >
            ⚠ 未拉到已确认设计
            {/* P6（2026-05-18）：手动 reload，处理 HMR 后 React state 没自动 reset 导致 useEffect 没重跑 */}
            <button
              onClick={async () => {
                if (typeof api.listConfirmedDesignsV2 !== 'function') return;
                // P6 修复（2026-05-18）：pptState.notebookId 可能为 null，fallback 用 selectedNotebookId props
                const nbId = pptState.notebookId || selectedNotebookId;
                if (!nbId) {
                  window.alert('内部错误：notebookId 未取到。请关闭 Electron 重启 npm run dev');
                  return;
                }
                const res = await api.listConfirmedDesignsV2(nbId);
                const designs = res?.success ? (res.data?.designs || []) : [];
                setPptState(prev => ({
                  ...prev,
                  notebookId: nbId,                              // 顺手 sync
                  confirmedDesigns: designs,
                  targetDesignId: prev.targetDesignId || designs[0]?.designId || null,
                }));
                if (designs.length === 0) {
                  window.alert(`后端确实没有已确认的教学设计（notebookId=${nbId}）。\n\n请回「教学设计」阶段：\n1. 选一节课 → 2. AI 生成 → 3. 老师审核 → 4. 点「确认完成」`);
                } else {
                  window.alert(`✅ 已拉到 ${designs.length} 个已确认设计：\n${designs.map(d => `• 第 ${d.lessonNumber} 节·${d.topic||'?'}（${d.totalHours} 学时）`).join('\n')}`);
                }
              }}
              style={{ marginLeft: 6, padding: '2px 6px', fontSize: 10, background: '#fff', color: '#991B1B', border: '1px solid #DC2626', borderRadius: 3, cursor: 'pointer' }}
              title="如果你已在教学设计阶段确认过节课，点这个重新拉取"
            >🔄 重新加载</button>
          </div>
        )}
        {/* D5.1+D5.2（2026-05-18）：生成前 Confirm Modal + 生成中可取消 */}
        {busy ? (
          <button
            className="v2-btn"
            style={{ background: '#FEE2E2', color: '#991B1B', border: '1px solid #DC2626' }}
            onClick={() => {
              if (!window.confirm('AI 已经在后台跑（token 可能已扣）。\n确认取消显示？前端会重置 UI 状态，但后端 token 已花。')) return;
              if (typeof setBusy === 'function') setBusy(false);
              setPptState(prev => ({ ...prev, _generating: false }));
              if (setAssistantStatus) setAssistantStatus('⏸ 已前端取消（后端 token 可能已扣）。可重新选择目标设计 + 再次生成。');
            }}
            title="前端 abort：UI 重置可重选；但后端 AI 调用已 fire，token 可能已消耗"
          >⏸ 取消生成</button>
        ) : (
          <button
            className="v2-btn v2-btn-primary"
            onClick={() => {
              // D5.1 防误触：弹 confirm
              const td = pptState.confirmedDesigns?.find(d => d.designId === pptState.targetDesignId);
              const tl = pptState.confirmedLessons?.find(l => l.lessonId === pptState.targetLessonId);
              const targetLabel = td
                ? `第 ${td.lessonNumber} 节·${td.topic || '?'}（${td.totalHours} 学时）`
                : tl ? `第 ${tl.lessonNumber} 节·${tl.topic || '?'}（${tl.totalHours} 学时）` : '⚠ 未选目标';
              const styleRefs = (pptState.externalReferences || []).filter(r => (r.purpose||'content')==='style').length;
              const contentRefs = (pptState.externalReferences || []).filter(r => (r.purpose||'content')==='content').length;
              const accentName = (pptState.accentCandidates || []).find(c => c.hex === pptState.mainAccentColor)?.name || '自定义';
              const styleLabel = (pptState.allImageStylePresets || []).find(p => p.key === pptState.imageStylePreset)?.name || pptState.imageStylePreset || 'flat';
              const hasExisting = Array.isArray(pages) && pages.length > 0;
              const confirmMsg = [
                '即将 AI 规划 PPT，请确认参数：',
                '',
                `🎯 目标设计：${targetLabel}`,
                `🎨 整门课主色：${pptState.mainAccentColor || '?'}（${accentName}）`,
                `🖼 配图风格：${styleLabel}`,
                `📚 外部参考：风格 ${styleRefs} 份 / 内容 ${contentRefs} 份`,
                `📷 配图质量：${pptState.imageQuality === 'high' ? '高（慢但精）' : pptState.imageQuality === 'low' ? '低（快但糙）' : '中（推荐）'}`,
                '',
                hasExisting ? `⚠ 当前已有 ${pages.length} 页 PPT，生成将覆盖！` : '',
                '⏱ 预计 60-120 秒，约消耗 8000-15000 tokens',
                '',
                '确认开始生成？',
              ].filter(Boolean).join('\n');
              if (!window.confirm(confirmMsg)) return;
              handleGeneratePptPlan();
            }}
            disabled={busy || (!pptState.targetDesignId && !pptState.targetLessonId)}
            title={(!pptState.targetDesignId && !pptState.targetLessonId) ? '请先选目标设计' : '生成前会弹窗确认参数'}
          >
            ✨ AI 规划页面
          </button>
        )}
        {/* D5.3：已有 pages 时显示「清空重做」按钮 */}
        {Array.isArray(pages) && pages.length > 0 && !busy ? (
          <button
            className="v2-btn"
            style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B' }}
            onClick={async () => {
              if (!window.confirm(`确定清空当前 ${pages.length} 页 PPT？\n\n清空后可重新「✨ AI 规划页面」生成新版本。\n（不会影响已确认的教学设计）`)) return;
              try {
                if (typeof api.savePptStageV2 !== 'function') return;
                const res = await api.savePptStageV2({
                  notebookId: pptState.notebookId,
                  pptOutline: { pages: [] },
                });
                if (res?.success) {
                  setPptState(prev => ({ ...prev, pptPages: [], pptOutline: { pages: [] } }));
                  if (setAssistantStatus) setAssistantStatus('🗑 已清空 PPT 页面，可重新点「✨ AI 规划页面」生成');
                } else {
                  window.alert(`清空失败：${res?.error || '未知'}`);
                }
              } catch (e) {
                window.alert(`清空异常：${e.message}`);
              }
            }}
            title="清空已生成的所有 PPT 页面（教学设计不受影响），方便重新规划"
          >🗑 清空 {pages.length} 页重做</button>
        ) : null}
        {/* 2026-05-16 v4.1.4 Q2-②：配图质量切换 */}
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 6px', background: '#F1F5F9', border: '1px solid #CBD5E1',
            borderRadius: 6, fontSize: 11, color: '#475569',
          }}
          title="配图质量：低=快但糙 / 中=平衡（推荐）/ 高=慢但精致"
        >
          <span>画质</span>
          <select
            value={pptState.imageQuality || 'medium'}
            onChange={(e) => setPptState(prev => ({ ...prev, imageQuality: e.target.value }))}
            style={{ fontSize: 11, padding: '1px 4px', borderRadius: 3, border: '1px solid #CBD5E1', background: '#fff' }}
          >
            <option value="low">低（快）</option>
            <option value="medium">中（推荐）</option>
            <option value="high">高（精致）</option>
          </select>
        </div>
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
        {/* 2026-05-16 v4.1.4 真 P2：展示这套 PPT 对应的节课，老师一眼看到"为哪节课生成" */}
        {pptState.lessonContext ? (
          <span className="ppt-stat" style={{ background: '#DCFCE7', color: '#166534', padding: '2px 8px', borderRadius: 4, border: '1px solid #16A34A' }}>
            ✓ 第 {pptState.lessonContext.lessonNumber} 节·{pptState.lessonContext.totalHours}学时
          </span>
        ) : null}
        {totalCount > 0 && (
          <span className="ppt-stat">
            {totalCount} 页
            <span style={{ color: '#16a34a', marginLeft: 8 }}>{doneCount} 已配图</span>
            {missingCount > 0 && <span style={{ color: '#f59e0b', marginLeft: 8 }}>{missingCount} 待配图</span>}
          </span>
        )}
        {assistantStatus && <span className="ppt-stat ppt-stat-muted"><AssistantStatusAvatar stage="ppt" status={assistantStatus} /></span>}
        {/* P6 修复（2026-05-18）：动态练习题入口从 PPT 阶段删除
            原 v4.2 时代把"动态练习"页混入 PPT pipeline，违反 v4.3 七阶段工作流
            正确归属：「⑤ 课堂互动测验 + 作业」独立 stage（PPT 后） */}
        <button className="v2-btn v2-btn-secondary" onClick={handleConfirmPpt}>确认 PPT</button>
        <button className="v2-btn v2-btn-primary" onClick={handleExportPpt}>📥 导出 PPT</button>
      </div>
    </div>
  );

  // 2026-05-15 P2-3：练习编辑 modal
  const renderExerciseModal = () => {
    if (!showExerciseModal) return null;
    return (
      <div className="v2-modal-mask" onClick={() => setShowExerciseModal(false)}>
        <div className="v2-modal v2-modal--lg" onClick={(e) => e.stopPropagation()}>
          <div className="v2-panel-head">
            <h3>📝 课堂动态练习题（{editingExercises.length} 题）</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* 2026-05-16 v4.1.4：课堂演示 —— 全屏播放交互题 */}
              <button
                className="v2-btn"
                onClick={handleOpenExercisePresentation}
                disabled={editingExercises.length === 0}
                title="弹出全屏交互窗口（学生看大屏，老师 / 学生点选答题，即时反馈）"
                style={{ background: '#16A34A', color: '#fff', border: '1px solid #15803D', fontWeight: 700 }}
              >🎯 课堂演示</button>
              {/* 导出 HTML 给老师拷到课堂电脑 */}
              <button
                className="v2-btn v2-btn-secondary"
                onClick={async () => {
                  if (typeof api?.exportExerciseHtmlV2 !== 'function') {
                    window.alert('preload 未暴露 exportExerciseHtmlV2，请重启 Electron');
                    return;
                  }
                  const res = await api.exportExerciseHtmlV2({
                    exerciseHtml: exercisePage?.exerciseHtml || '',
                    title: exercisePage?.title || '课堂动态练习',
                  });
                  if (res?.success) {
                    window.alert(`✅ 已导出到：\n${res.data.filePath}\n\n可在任意浏览器双击打开`);
                  } else if (res?.error && res.error !== '已取消') {
                    window.alert(`导出失败：${res.error}`);
                  }
                }}
                disabled={editingExercises.length === 0}
                title="导出为独立 HTML 文件，可拷到课堂电脑/U盘，不依赖驭课 Agent 也能打开"
              >📥 导出 HTML</button>
              {/* 重试按钮 —— 单独重生练习题，不重生整个 PPT */}
              <button
                className="v2-btn v2-btn-secondary"
                onClick={handleRetryDynamicExercise}
                disabled={exerciseRetryBusy}
                title="只重新调 AI 出题，不影响其它 PPT 页面（自动 3 次重试）"
                style={{ background: '#FEF3C7', borderColor: '#F59E0B', color: '#92400E' }}
              >{exerciseRetryBusy ? '🔄 AI 出题中…' : '🔄 重试 AI 出题'}</button>
              <button className="v2-btn v2-btn-primary" onClick={saveExerciseChanges}>💾 保存修改</button>
              <button className="v2-btn v2-btn-xs" onClick={() => setShowExerciseModal(false)}>关闭</button>
            </div>
          </div>
          {exerciseRetryMsg ? (
            <div style={{
              marginTop: 8, padding: 8, fontSize: 13,
              background: exerciseRetryMsg.includes('✅') ? '#dcfce7' : (exerciseRetryMsg.includes('❌') ? '#fee2e2' : '#dbeafe'),
              border: '1px solid ' + (exerciseRetryMsg.includes('✅') ? '#86efac' : (exerciseRetryMsg.includes('❌') ? '#fca5a5' : '#93c5fd')),
              borderRadius: 4,
              color: exerciseRetryMsg.includes('✅') ? '#166534' : (exerciseRetryMsg.includes('❌') ? '#991B1B' : '#1e40af'),
            }}>
              {exerciseRetryMsg}
            </div>
          ) : null}
          <div style={{ marginTop: 8, padding: 8, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, fontSize: 12, color: '#78350f' }}>
            💡 可以删题 / 改题 / 调整顺序。保存后导出 PPT 时会以新内容渲染练习页。当前 0 题 → 请先点【🔄 重试 AI 出题】。
          </div>
          <div style={{ marginTop: 12, maxHeight: '60vh', overflowY: 'auto' }}>
            {editingExercises.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#9ca3af', padding: 20 }}>无题目</p>
            ) : editingExercises.map((ex, idx) => (
              <div key={idx} style={{
                marginBottom: 12, padding: 12, background: '#f9fafb',
                border: '1px solid #e5e7eb', borderRadius: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <strong style={{ color: '#1f2937' }}>第 {idx + 1} 题</strong>
                  <span style={{ fontSize: 11, padding: '2px 8px', background: '#dbeafe', color: '#1e40af', borderRadius: 3 }}>
                    {ex.type === 'single_choice' ? '单选' :
                     ex.type === 'true_false' ? '判断' :
                     ex.type === 'fill_blank' ? '填空' :
                     ex.type === 'short_answer' ? '简答' : ex.type}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button className="v2-btn v2-btn-xs" onClick={() => moveExercise(idx, -1)} disabled={idx === 0} title="上移">↑</button>
                    <button className="v2-btn v2-btn-xs" onClick={() => moveExercise(idx, 1)} disabled={idx === editingExercises.length - 1} title="下移">↓</button>
                    <button className="v2-btn v2-btn-xs" onClick={() => deleteExercise(idx)} style={{ color: '#dc2626' }} title="删除此题">🗑</button>
                  </div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>题目</label>
                  <textarea
                    value={ex.question || ''}
                    onChange={(e) => updateExerciseField(idx, 'question', e.target.value)}
                    rows={2}
                    style={{ width: '100%', fontSize: 13, padding: 6 }}
                  />
                </div>
                {ex.type === 'single_choice' ? (
                  <>
                    <label style={{ fontSize: 12, color: '#6b7280' }}>选项（每行一个，正确答案打 ✓）</label>
                    {(ex.options || []).map((opt, oi) => (
                      <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <input
                          type="radio"
                          checked={Number(ex.correctIndex) === oi}
                          onChange={() => updateExerciseField(idx, 'correctIndex', oi)}
                        />
                        <input
                          value={opt}
                          onChange={(e) => {
                            const newOpts = [...(ex.options || [])];
                            newOpts[oi] = e.target.value;
                            updateExerciseField(idx, 'options', newOpts);
                          }}
                          style={{ flex: 1, fontSize: 13, padding: 4 }}
                        />
                      </div>
                    ))}
                  </>
                ) : ex.type === 'true_false' ? (
                  <div>
                    <label style={{ fontSize: 12, color: '#6b7280' }}>正确答案</label>
                    <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="radio" checked={ex.answer === true} onChange={() => updateExerciseField(idx, 'answer', true)} /> ✅ 正确
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="radio" checked={ex.answer === false} onChange={() => updateExerciseField(idx, 'answer', false)} /> ❌ 错误
                      </label>
                    </div>
                  </div>
                ) : ex.type === 'fill_blank' ? (
                  <div>
                    <label style={{ fontSize: 12, color: '#6b7280' }}>填空答案（每行一个）</label>
                    <textarea
                      value={(ex.blanks || []).join('\n')}
                      onChange={(e) => updateExerciseField(idx, 'blanks', e.target.value.split('\n').filter(Boolean))}
                      rows={2}
                      style={{ width: '100%', fontSize: 13, padding: 6 }}
                    />
                  </div>
                ) : ex.type === 'short_answer' ? (
                  <div>
                    <label style={{ fontSize: 12, color: '#6b7280' }}>参考答案</label>
                    <textarea
                      value={ex.referenceAnswer || ''}
                      onChange={(e) => updateExerciseField(idx, 'referenceAnswer', e.target.value)}
                      rows={2}
                      style={{ width: '100%', fontSize: 13, padding: 6 }}
                    />
                  </div>
                ) : null}
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>解析</label>
                  <textarea
                    value={ex.explanation || ''}
                    onChange={(e) => updateExerciseField(idx, 'explanation', e.target.value)}
                    rows={2}
                    style={{ width: '100%', fontSize: 13, padding: 6 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

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

  // ── 网格总览（v4.3.0 重设计：3 种视图老师可切换）──
  // P6 重设计（2026-05-18）：老师反馈"小卡片模拟 PPT 视觉，不可接受"
  //   ❌ 旧：16:9 小缩略图模拟真实 PPT 视觉（信息密度太高，看不清）
  //   ✅ 新 3 种视图：
  //     ① 📋 信息卡片：标题大字 + 要点列表 + 标签（默认推荐）
  //     ② 📊 列表表格：紧凑表格一行一页，扫完 N 页快
  //     ③ 🖼 视觉预览：原 16:9 缩略图（看真实 PPT 视觉效果）
  const [gridViewMode, setGridViewMode] = React.useState('cards');   // 'cards' | 'list' | 'preview'
  // v4.3.3 新版：PPT 网格最大化预览（老师反馈撑满窗口）
  const [pptPreviewFs, setPptPreviewFs] = React.useState(false);
  const renderGrid = () => {
    if (pages.length === 0) {
      return (
        <div className="ppt-empty">
          <div className="ppt-empty-icon">📋</div>
          <p>还没有页面规划，点击「✨ AI 规划页面」开始生成。</p>
        </div>
      );
    }
    // 视图切换器
    const viewSwitch = (
      <div style={{ display: 'flex', gap: 4, padding: '10px 20px 0', alignItems: 'center', borderBottom: '1px solid #E5E7EB' }}>
        <span style={{ fontSize: 12, color: '#64748B', marginRight: 8 }}>视图：</span>
        {[
          { key: 'cards',   label: '📋 信息卡片（推荐）', desc: '每页：标题 + 要点 + 标签，最清晰' },
          { key: 'list',    label: '📊 列表表格',         desc: '一行一页，扫 21 页只需 3 秒' },
          { key: 'preview', label: '🖼 视觉预览',         desc: '16:9 缩略图模拟真实 PPT 视觉' },
        ].map(v => (
          <button
            key={v.key}
            onClick={() => setGridViewMode(v.key)}
            title={v.desc}
            style={{
              padding: '4px 12px', fontSize: 12,
              background: gridViewMode === v.key ? accent : 'transparent',
              color: gridViewMode === v.key ? '#fff' : '#475569',
              border: `1px solid ${gridViewMode === v.key ? accent : '#CBD5E1'}`,
              borderBottom: 'none', borderRadius: '6px 6px 0 0',
              cursor: 'pointer', fontWeight: gridViewMode === v.key ? 700 : 400,
            }}
          >{v.label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8' }}>共 {pages.length} 页 · 点击任一页进入精修</span>
        {/* v4.3.3 新版 · 最大化预览（视觉预览 / 信息卡片视图下都可触发） */}
        <span style={{ marginLeft: 8 }}>
          <PreviewFullscreenToggle isFullscreen={pptPreviewFs} onToggle={setPptPreviewFs} />
        </span>
      </div>
    );

    // ───── 视图 ① 信息卡片（默认）─────
    if (gridViewMode === 'cards') {
      return (
        <>
          {viewSwitch}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, alignContent: 'start' }}>
            {pages.map(page => {
              const hasImg = Boolean(page.imagePath || page.imageUrl);
              const keyPoints = Array.isArray(page.keyContent)
                ? page.keyContent.filter(Boolean).slice(0, 5)
                : String(page.keyContent || '').split('\n').filter(Boolean).slice(0, 5);
              return (
                <button
                  key={page.id}
                  onClick={() => enterEdit(page.id)}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 8,
                    background: '#fff', border: '1.5px solid #E5E7EB',
                    borderRadius: 10, padding: 14, cursor: 'pointer',
                    textAlign: 'left', minHeight: 200,
                    borderLeft: `4px solid ${page.accentColor || accent}`,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = `0 4px 12px ${accent}33`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderLeft = `4px solid ${page.accentColor || accent}`; }}
                >
                  {/* 顶部：页码 + 类型标签 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span style={{ background: accent, color: '#fff', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>P{page.pageNumber}</span>
                    <span style={{ color: '#64748B' }}>{page.pageType || '内容页'}</span>
                    {page.layoutType ? <span style={{ background: '#F1F5F9', color: '#475569', padding: '2px 6px', borderRadius: 3, fontSize: 10 }}>{page.layoutType}</span> : null}
                    <span style={{ marginLeft: 'auto' }}>
                      {hasImg ? <span style={{ color: '#16A34A', fontSize: 11 }}>✓ 已配图</span>
                              : page.needImage ? <span style={{ color: '#F59E0B', fontSize: 11 }}>⏳ 待配图</span>
                              : <span style={{ color: '#94A3B8', fontSize: 11 }}>无需配图</span>}
                    </span>
                  </div>
                  {/* 标题 */}
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', lineHeight: 1.3 }}>{page.title || '（未命名）'}</div>
                  {page.subtitle ? <div style={{ fontSize: 12, color: '#64748B', marginTop: -4 }}>{page.subtitle}</div> : null}
                  {/* 要点列表 */}
                  {keyPoints.length > 0 ? (
                    <ul style={{ margin: 0, padding: '4px 0 0 18px', fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
                      {keyPoints.map((pt, i) => (
                        <li key={i} style={{ marginBottom: 2 }}>{String(pt).replace(/^[-\d.]+\s*/, '').slice(0, 60)}{String(pt).length > 60 ? '…' : ''}</li>
                      ))}
                    </ul>
                  ) : <p style={{ margin: 0, fontSize: 11, color: '#94A3B8', fontStyle: 'italic' }}>（无要点内容）</p>}
                </button>
              );
            })}
          </div>
        </>
      );
    }

    // ───── 视图 ② 列表表格 ─────
    if (gridViewMode === 'list') {
      return (
        <>
          {viewSwitch}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F8FAFC', color: '#475569', fontSize: 11, fontWeight: 700 }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>P#</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>类型</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>标题</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>要点数</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>排版</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>配图</th>
                </tr>
              </thead>
              <tbody>
                {pages.map(page => {
                  const hasImg = Boolean(page.imagePath || page.imageUrl);
                  const ptCount = Array.isArray(page.keyContent) ? page.keyContent.filter(Boolean).length : (page.keyContent || '').split('\n').filter(Boolean).length;
                  return (
                    <tr
                      key={page.id}
                      onClick={() => enterEdit(page.id)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid #F1F5F9' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#F9FAFB'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: accent }}>P{page.pageNumber}</td>
                      <td style={{ padding: '8px 10px', color: '#64748B', fontSize: 12 }}>{page.pageType || '-'}</td>
                      <td style={{ padding: '8px 10px', color: '#0F172A' }}>
                        <strong>{page.title || '（未命名）'}</strong>
                        {page.subtitle ? <span style={{ color: '#64748B', fontSize: 11, marginLeft: 6 }}>{page.subtitle}</span> : null}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#475569', fontSize: 12 }}>{ptCount} 条</td>
                      <td style={{ padding: '8px 10px' }}>{page.layoutType ? <span style={{ background: '#F1F5F9', color: '#475569', padding: '2px 6px', borderRadius: 3, fontSize: 10 }}>{page.layoutType}</span> : <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                      <td style={{ padding: '8px 10px', fontSize: 12 }}>
                        {hasImg ? <span style={{ color: '#16A34A' }}>✓</span>
                                : page.needImage ? <span style={{ color: '#F59E0B' }}>⏳</span>
                                : <span style={{ color: '#94A3B8' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    // ───── 视图 ③ 视觉预览（原 16:9 缩略图）─────
    return (
      <>
        {viewSwitch}
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
                <div className="ppt-thumb-preview">
                  <SlidePreview page={page} template={template} toLocalImgSrc={toLocalImgSrc} mainAccentColor={pptState.mainAccentColor} />
                </div>
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
      </>
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
            {/* 2026-05-16 v4.1.4：配图已合到上方 SlidePreview，这里只放"打开原图"按钮，不再显示重复图 */}
            {(currentPage.imagePath || currentPage.imageUrl) && (
              <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  className="v2-btn v2-btn-xs"
                  onClick={() => api.openResource(currentPage.imagePath || currentPage.imageUrl)}
                  title="在系统图片查看器打开原始 AI 生成图"
                >🖼 查看原图</button>
                <span style={{ fontSize: 11, color: '#64748B' }}>（配图已合到上方预览）</span>
              </div>
            )}
          </div>

          {/* 右侧：编辑表单 */}
          <div className="ppt-editor-form">
            {/* C4 修复（2026-05-17）：右栏顶部加操作说明，让老师知道完整流程 */}
            <div style={{
              background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6,
              padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#9A3412', lineHeight: 1.7,
            }}>
              <strong>📌 本页编辑流程：</strong><br/>
              ① 改下面任一字段（标题 / 要点 / 备注 / 配色 / 提示词） →
              ② 左侧预览实时刷新（文字类）或点「🖼 生成此页配图」（图片类） →
              ③ 满意后点「💾 保存」写入草稿 →
              ④ 全部 PPT 页都满意后回总览点「✅ 确认 PPT（解锁讲稿）」<br/>
              <span style={{ color: '#7C2D12' }}>※ 不点保存的修改在切到其他页时会丢失。</span>
            </div>
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
                rows={10}
                className="v2-code"
                value={currentPage.keyContent || ''}
                onChange={e => updateCurrentPage({ keyContent: e.target.value })}
                placeholder="每行一个要点，修改后左侧预览实时更新。"
                style={{ minHeight: 220, lineHeight: 1.7, fontSize: 14 }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="v2-label">演讲备注</label>
              <textarea
                rows={6}
                value={currentPage.speakerNotes || ''}
                onChange={e => updateCurrentPage({ speakerNotes: e.target.value })}
                placeholder="导出 PPTX 时写入演讲者备注。"
                style={{ minHeight: 130, lineHeight: 1.7, fontSize: 14 }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="v2-label">图片提示词（留空则自动生成）</label>
              <textarea
                rows={8}
                className="v2-code"
                value={currentPage.imagePrompt || ''}
                onChange={e => updateCurrentPage({ imagePrompt: e.target.value })}
                placeholder="改提示词 → 点下方「🖼 生成此页配图」→ 左侧预览出图 → 满意点「💾 保存」"
                style={{ minHeight: 180, lineHeight: 1.7, fontSize: 14 }}
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

            {/* 2026-05-16 v4.1.4 Phase 2：layoutType + accentColor + themeMode 覆盖 */}
            <div className="v2-section-divider" style={{ marginTop: 18 }}>
              <span>🎨 本页排版 / 配色（默认 AI 决定，可手动覆盖）</span>
            </div>
            <div className="v2-grid-two" style={{ marginTop: 8 }}>
              <div>
                <label className="v2-label">排版骨架（layoutType）</label>
                <select
                  value={currentPage.layoutType || 'bullet-list'}
                  onChange={(e) => updateCurrentPage({ layoutType: e.target.value })}
                  style={{ width: '100%' }}
                >
                  <option value="hero">hero · 封面 / 谢谢 / 大字</option>
                  <option value="two-column">two-column · 左文右图 / 左文右数据</option>
                  <option value="image-bleed">image-bleed · 全屏图 + 文字浮层</option>
                  <option value="diagram-center">diagram-center · 中心流程链</option>
                  <option value="quote">quote · 大字单句 / 思考题</option>
                  <option value="table">table · 表格 / 验收标准</option>
                  <option value="bullet-list">bullet-list · 纵向 bullet（兜底）</option>
                </select>
              </div>
              <div>
                <label className="v2-label">主题模式（themeMode）</label>
                <select
                  value={currentPage.themeMode || 'light'}
                  onChange={(e) => updateCurrentPage({ themeMode: e.target.value })}
                  style={{ width: '100%' }}
                >
                  <option value="light">light · 浅底深字（教学内容页）</option>
                  <option value="dark">dark · 深底浅字（封面/收束/沉浸式）</option>
                </select>
              </div>
            </div>
            <div className="v2-grid-two" style={{ marginTop: 8 }}>
              <div>
                <label className="v2-label">本页强调色（accentColor，留空 = 走整门课主色）</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={currentPage.accentColor || pptState.mainAccentColor || '#2E86DE'}
                    onChange={(e) => updateCurrentPage({ accentColor: e.target.value })}
                    style={{ width: 44, height: 32, padding: 0, border: '1px solid #cbd5e1' }}
                  />
                  <input
                    type="text"
                    value={currentPage.accentColor || ''}
                    placeholder={pptState.mainAccentColor || '#2E86DE'}
                    onChange={(e) => updateCurrentPage({ accentColor: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  {currentPage.accentColor ? (
                    <button
                      className="v2-btn v2-btn-xs"
                      onClick={() => updateCurrentPage({ accentColor: '' })}
                      title="清空 → 回到整门课主色"
                    >清空</button>
                  ) : null}
                </div>
              </div>
              <div>
                <label className="v2-label">推荐强调色（一键应用）</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {[
                    { name: '主色', value: '' },
                    { name: '橙', value: '#F59E0B' },
                    { name: '红', value: '#DC2626' },
                    { name: '绿', value: '#10B981' },
                    { name: '紫', value: '#6B21A8' },
                  ].map((c) => (
                    <button
                      key={c.name}
                      className="v2-btn v2-btn-xs"
                      onClick={() => updateCurrentPage({ accentColor: c.value })}
                      style={c.value ? { background: c.value, color: '#fff', border: 'none' } : {}}
                      title={c.value || '回到整门课主色'}
                    >{c.name}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* 2026-05-16 v4.1.4 Phase 2：自然语言提示词重生 */}
            <div className="v2-section-divider" style={{ marginTop: 18 }}>
              <span>✏️ 用提示词重生此页（自然语言指令）</span>
            </div>
            <PerPageRegenerate
              api={api}
              currentPage={currentPage}
              updateCurrentPage={updateCurrentPage}
              mainAccentColor={pptState.mainAccentColor || '#2E86DE'}
              notebookId={pptState.notebookId}
            />

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

  // 2026-05-15 P2-5：双阶段 pipeline 进度条
  const renderPipelineProgress = () => {
    if (!pipelineProgress) return null;
    const phaseLabels = {
      'outline-start': { text: `📋 正在规划 ${pipelineProgress.totalHours} 学时课程的 PPT 大纲…`, pct: 5 },
      'outline-done': { text: `📋 大纲完成：${pipelineProgress.totalPages} 页`, pct: 15 },
      'detail-start': { text: `📝 开始生成每页详情（并发 ${pipelineProgress.concurrency} 路）…`, pct: 20 },
      'detail-page-done': { text: `📝 详情进度：${pipelineProgress.current}/${pipelineProgress.total} 页${pipelineProgress.pageTitle ? `（${pipelineProgress.pageTitle}）` : ''}`, pct: 20 + Math.round((pipelineProgress.current / pipelineProgress.total) * 60) },
      'detail-all-done': { text: `✅ 所有 ${pipelineProgress.totalPages} 页详情完成${pipelineProgress.failedCount > 0 ? `（${pipelineProgress.failedCount} 页走兜底）` : ''}`, pct: 80 },
      'exercise-start': { text: '📝 正在生成课堂动态练习题…', pct: 85 },
      'exercise-done': { text: `✅ 动态练习页已生成（${pipelineProgress.exerciseCount} 题）`, pct: 95 },
      'exercise-failed': { text: `⚠ 动态练习页生成失败（不阻断主流程）`, pct: 95 },
      'all-done': { text: `🎉 全部完成：${pipelineProgress.totalPages} 页${pipelineProgress.exerciseInserted ? '（含动态练习）' : ''}`, pct: 100 },
    };
    const cur = phaseLabels[pipelineProgress.phase] || { text: pipelineProgress.phase, pct: 50 };
    const isDone = pipelineProgress.phase === 'all-done';
    return (
      <div style={{
        margin: '8px 0', padding: '10px 14px',
        background: isDone ? '#dcfce7' : '#eff6ff',
        border: `1px solid ${isDone ? '#86efac' : '#93c5fd'}`,
        borderRadius: 6,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: isDone ? '#166534' : '#1e40af' }}>
          <strong>{cur.text}</strong>
          <span>{cur.pct}%</span>
        </div>
        <div style={{ marginTop: 6, height: 6, background: '#e0e7ff', borderRadius: 3 }}>
          <div style={{
            height: '100%', width: `${cur.pct}%`,
            background: isDone ? '#16a34a' : 'linear-gradient(90deg, #3b82f6, #6366f1)',
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>
    );
  };

  // ── 渲染 ──
  // 2026-05-15 v4.1.4：外部参考素材上传区
  const renderExternalReferences = () => {
    if (editMode) return null;   // 编辑单页时不显示
    const refs = pptState.externalReferences || [];
    // D3 修复（2026-05-18）：purpose 直接参数传递，不走 state 中转
    //   原 bug：setState 异步 + handler 闭包读旧 _addPurpose → 风格参考上传的 PPT 被归到内容素材
    const onPasteAdd = (purposeArg) => {
      const text = (pptState._pasteRef || '').trim();
      if (!text) { window.alert('请先粘贴参考内容'); return; }
      const purpose = purposeArg || 'content';
      setPptState((prev) => ({
        ...prev,
        externalReferences: [...(prev.externalReferences || []), { kind: 'text', content: text, purpose }],
        _pasteRef: '',
      }));
    };
    const onUploadRef = async (e, purposeArg) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const lowerName = file.name.toLowerCase();
      const ext = lowerName.substring(lowerName.lastIndexOf('.') + 1);
      try {
        let content = '';
        if (ext === 'docx') {
          const buffer = await file.arrayBuffer();
          const base64 = btoa(new Uint8Array(buffer).reduce((d, b) => d + String.fromCharCode(b), ''));
          const res = await api.readDocxContent({ base64, filename: file.name });
          if (!res?.success) { window.alert(`解析失败：${res?.error || '未知'}`); e.target.value = ''; return; }
          content = res.data?.text || '';
        } else if (ext === 'pptx') {
          // v4.3.0 D3（2026-05-18）：放行 .pptx，提取每页文字结构供 AI 学风格
          if (typeof api.readPptxContent !== 'function') {
            window.alert('请重启 Electron 让 .pptx 解析功能生效'); e.target.value = ''; return;
          }
          const buffer = await file.arrayBuffer();
          const base64 = btoa(new Uint8Array(buffer).reduce((d, b) => d + String.fromCharCode(b), ''));
          const res = await api.readPptxContent({ base64, filename: file.name });
          if (!res?.success) { window.alert(`PPT 解析失败：${res?.error || '未知'}`); e.target.value = ''; return; }
          content = res.data?.text || '';
        } else if (['txt', 'md', 'csv', 'json'].includes(ext)) {
          content = await file.text();
        } else {
          window.alert('外部参考支持的格式：.pptx / .docx / .txt / .md / .csv / .json\n\n如有 .pdf，请先转 docx 或截图后粘贴。');
          e.target.value = '';
          return;
        }
        if (content.length > 8000) content = content.slice(0, 8000) + '…（已截断 8000 字）';
        const purpose = purposeArg || 'content';   // D3：风格 / 内容（直接参数传，不走 state 中转）
        setPptState((prev) => ({
          ...prev,
          externalReferences: [...(prev.externalReferences || []), { kind: 'file', filename: file.name, content, purpose }],
        }));
      } catch (err) {
        window.alert(`解析失败：${err.message}`);
      }
      e.target.value = '';
    };
    const removeRef = (idx) => {
      setPptState((prev) => ({
        ...prev,
        externalReferences: (prev.externalReferences || []).filter((_, i) => i !== idx),
      }));
    };
    // v4.3.0 D3（2026-05-18）：拆"风格参考"vs"内容素材"两栏
    //   refs[i].purpose = 'style' | 'content'
    //   - style：仅参考排版/详略/视觉，AI 不引用具体内容
    //   - content：可被 AI 引用为案例/数据
    const styleRefs = refs.filter(r => (r.purpose || 'content') === 'style');
    const contentRefs = refs.filter(r => (r.purpose || 'content') === 'content');
    const refTab = pptState._refTab || 'style';   // 默认显示风格栏
    const currentPurpose = refTab === 'style' ? 'style' : 'content';

    return (
      <div className="v2-panel" style={{ marginTop: 12 }}>
        <div className="v2-panel-head">
          <h3>📚 外部参考素材（可选）</h3>
          <span className="v2-hint">
            <strong style={{ color: '#1E40AF' }}>风格参考</strong>：AI 学排版/详略/配色（不抄内容）  ·
            <strong style={{ color: '#15803D' }}> 内容素材</strong>：AI 可引用其中数据/案例（会出现在 PPT）
          </span>
        </div>
        {/* tab 切换 */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, borderBottom: '1px solid #E2E8F0' }}>
          <button
            onClick={() => setPptState(prev => ({ ...prev, _refTab: 'style' }))}
            style={{
              padding: '6px 14px',
              background: refTab === 'style' ? '#DBEAFE' : 'transparent',
              border: 'none', borderBottom: refTab === 'style' ? '2px solid #2563EB' : '2px solid transparent',
              color: refTab === 'style' ? '#1E40AF' : '#64748B',
              fontSize: 13, cursor: 'pointer', fontWeight: refTab === 'style' ? 600 : 400,
            }}
          >🎨 风格参考（{styleRefs.length}）</button>
          <button
            onClick={() => setPptState(prev => ({ ...prev, _refTab: 'content' }))}
            style={{
              padding: '6px 14px',
              background: refTab === 'content' ? '#DCFCE7' : 'transparent',
              border: 'none', borderBottom: refTab === 'content' ? '2px solid #15803D' : '2px solid transparent',
              color: refTab === 'content' ? '#166534' : '#64748B',
              fontSize: 13, cursor: 'pointer', fontWeight: refTab === 'content' ? 600 : 400,
            }}
          >📊 内容素材（{contentRefs.length}）</button>
        </div>

        {/* 当前 tab 的提示 */}
        <div style={{
          padding: '6px 10px', marginBottom: 8, fontSize: 11,
          background: refTab === 'style' ? '#EFF6FF' : '#F0FDF4',
          color: refTab === 'style' ? '#1E40AF' : '#166534',
          borderRadius: 4,
        }}>
          {refTab === 'style'
            ? '💡 风格参考：传一份你喜欢的示例 PPT / 设计案例，AI 学习其版面布局、文字详略、配色搭配，但绝不抄文字内容到你的 PPT 里'
            : '💡 内容素材：传课程相关数据 / 真实案例 / 行业报告 / 学情资料，AI 可在你的 PPT 里直接引用其中数字、品牌、事实'}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
            <textarea
              rows={3}
              value={pptState._pasteRef || ''}
              onChange={(e) => setPptState((prev) => ({ ...prev, _pasteRef: e.target.value }))}
              placeholder={refTab === 'style'
                ? '粘贴你欣赏的示例 PPT 大纲 / 教材排版样例...（仅做风格参考）'
                : '粘贴行业数据 / 真实品牌案例 / 学情报告...（AI 可引用）'}
              style={{ width: '100%', fontSize: 13 }}
            />
            <button className="v2-btn v2-btn-secondary v2-btn-xs" style={{ marginTop: 6 }} onClick={() => onPasteAdd(currentPurpose)}>
              + 添加到{refTab === 'style' ? '风格参考' : '内容素材'}
            </button>
          </div>
          <label className="v2-btn v2-btn-secondary" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
            📎 上传到{refTab === 'style' ? '风格' : '内容'}
            <input
              type="file"
              accept=".docx,.pptx,.txt,.md,.csv,.json"
              style={{ display: 'none' }}
              onChange={(e) => onUploadRef(e, currentPurpose)}
              title="支持 .pptx / .docx / .txt / .md / .csv / .json"
            />
          </label>
        </div>

        {/* 列表 */}
        {(refTab === 'style' ? styleRefs : contentRefs).length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 12, color: '#374151' }}>
              已加入{refTab === 'style' ? '风格参考' : '内容素材'}（{(refTab === 'style' ? styleRefs : contentRefs).length}）：
            </strong>
            <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12 }}>
              {refs.map((r, i) => {
                if ((r.purpose || 'content') !== refTab) return null;
                return (
                  <li key={i} style={{ marginBottom: 2 }}>
                    {r.kind === 'file' ? `📎 ${r.filename || '文件'}` : '📝 老师粘贴文本'}
                    （{(r.content || '').length} 字）
                    <button
                      onClick={() => removeRef(i)}
                      style={{ marginLeft: 8, background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11 }}
                    >× 删除</button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="ppt-stage-root">
      {renderTopBar()}
      {renderPipelineProgress()}
      {renderProgressBar()}
      {renderExternalReferences()}
      {editMode ? renderEditor() : renderGrid()}
      {/* P6 删除（2026-05-18）：renderExerciseModal 整段下线，动态练习移到 Step 5 独立 stage */}

      {/* v4.3.3 新版 · PPT 大纲最大化预览（撑满窗口 · 信息卡片视图下大字号阅读） */}
      {pptPreviewFs ? (
        <PreviewFullscreen
          title={`PPT 大纲预览 · 共 ${pages.length} 页`}
          onClose={() => setPptPreviewFs(false)}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {pages.map((page) => {
              const keyPoints = Array.isArray(page.keyContent)
                ? page.keyContent.filter(Boolean)
                : String(page.keyContent || '').split('\n').filter(Boolean);
              return (
                <div key={page.id} style={{
                  background: '#fff', border: '1px solid #e5e7eb', borderLeft: `4px solid ${page.accentColor || '#2563eb'}`,
                  borderRadius: 8, padding: 16, minHeight: 220,
                }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                    P{page.pageNumber} · {page.pageType || '—'}
                  </div>
                  <h4 style={{ margin: '4px 0 10px', fontSize: 17, fontWeight: 700, color: '#1f2937', lineHeight: 1.4 }}>
                    {page.title || '（未命名）'}
                  </h4>
                  {page.subtitle ? (
                    <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 8 }}>{page.subtitle}</div>
                  ) : null}
                  {keyPoints.length > 0 ? (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 14, lineHeight: 1.7, color: '#374151' }}>
                      {keyPoints.map((kp, i) => <li key={i}>{kp}</li>)}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        </PreviewFullscreen>
      ) : null}
    </div>
  );
}
