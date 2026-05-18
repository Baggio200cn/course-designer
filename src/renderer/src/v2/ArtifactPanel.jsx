import React from 'react';

function getArtifactTone(status) {
  const value = String(status || '').trim();
  if (value === 'confirmed' || value === 'exported') return 'success';
  if (value === 'review_needed') return 'warning';
  if (value === 'generated' || value === 'edited') return 'brand';
  if (value === 'failed') return 'danger';
  return 'neutral';
}

export default function ArtifactPanel({ artifacts, title, hint, onOpenFile, dt, onViewArtifact, onUnlockArtifact }) {
  // 2026-05-16 v4.1.4 第二轮拆分：把模糊的"载入编辑器"拆成两个明确意图按钮
  //   👁 查看：弹只读 modal，仅展示内容（不动 confirmed 状态）
  //   ✏ 解锁重编辑：明确告诉老师"会失去确认状态，需要重新确认"，老师同意后载入表单
  return (
    <div className="v2-panel">
      <div className="v2-panel-head">
        <h3>{title}</h3>
        <span className="v2-hint">{hint}</span>
      </div>
      <div className="v2-artifact-list">
        {artifacts.length ? artifacts.map((item) => (
          <div key={item.id} className="v2-artifact-item">
            <div className="v2-artifact-head">
              <strong>{item.title}</strong>
              <span className={`v2-status-pill tone-${getArtifactTone(item.status)}`}>{item.status || 'unknown'}</span>
            </div>
            <span>{item.type || '-'}</span>
            <span>{dt(item.updatedAt || item.createdAt)}</span>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {item.storagePath ? (
                <button className="v2-btn v2-btn-xs" onClick={() => onOpenFile(item.storagePath)}>
                  📂 打开文件
                </button>
              ) : null}
              {typeof onViewArtifact === 'function' ? (
                <button
                  className="v2-btn v2-btn-xs"
                  onClick={() => onViewArtifact(item)}
                  title="只读查看这份产物的内容（不会改变确认状态）"
                >
                  👁 查看
                </button>
              ) : null}
              {typeof onUnlockArtifact === 'function' && item.confirmed ? (
                <button
                  className="v2-btn v2-btn-xs"
                  onClick={() => onUnlockArtifact(item)}
                  title="解锁这份已确认产物以重新编辑（会清除确认状态，需重新确认）"
                  style={{ borderColor: '#f59e0b', color: '#b45309' }}
                >
                  ✏ 解锁重编辑
                </button>
              ) : null}
            </div>
          </div>
        )) : <p className="v2-hint">当前阶段还没有产物。</p>}
      </div>
    </div>
  );
}
