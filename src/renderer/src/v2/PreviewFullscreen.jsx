/**
 * PreviewFullscreen.jsx — v4.3.3 新版 · 2026-05-20
 *
 * 通用预览全屏覆盖层 + 触发按钮。
 *
 * 用法：
 *   const [fs, setFs] = useState(false);
 *   <PreviewFullscreenToggle isFullscreen={fs} onToggle={setFs} />
 *   {fs
 *     ? <PreviewFullscreen title="..." onClose={() => setFs(false)}>{children}</PreviewFullscreen>
 *     : <div className="v2-preview-enhanced">{children}</div>
 *   }
 *
 * 解决老师反馈：
 *   - 预览区不能撑满窗口 → 全屏覆盖层
 *   - 字号过小 / 行高过紧 / 留白不足 → v2-preview-enhanced 通用排版升级
 */
'use strict';
import React, { useEffect } from 'react';

export function PreviewFullscreenToggle({ isFullscreen, onToggle, label }) {
  return (
    <button
      type="button"
      className="v2-preview-fs-toggle"
      onClick={() => onToggle(!isFullscreen)}
      title={isFullscreen ? '退出最大化（Esc）' : '最大化预览（撑满窗口 + 大号字体）'}
    >
      <span className="icon">{isFullscreen ? '🗗' : '🗖'}</span>
      <span>{isFullscreen ? '退出最大化' : (label || '最大化预览')}</span>
    </button>
  );
}

export function PreviewFullscreen({ title, onClose, children, extraHeader }) {
  // ESC 退出
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    // 锁定 body 滚动避免双滚动条
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="v2-preview-fullscreen" role="dialog" aria-modal="true" aria-label={title || '预览'}>
      <div className="v2-preview-fs-header">
        <h3>
          <span>🔍</span>
          <span>{title || '预览'}</span>
          <span className="v2-preview-fs-esc-hint">按 Esc 退出</span>
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {extraHeader}
          <button type="button" className="v2-preview-fs-toggle" onClick={onClose}>
            <span className="icon">✕</span>
            <span>退出最大化</span>
          </button>
        </div>
      </div>
      <div className="v2-preview-fs-body">
        {children}
      </div>
    </div>
  );
}

export default PreviewFullscreen;
