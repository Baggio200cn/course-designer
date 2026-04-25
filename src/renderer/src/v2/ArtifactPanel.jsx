import React from 'react';

function getArtifactTone(status) {
  const value = String(status || '').trim();
  if (value === 'confirmed' || value === 'exported') return 'success';
  if (value === 'review_needed') return 'warning';
  if (value === 'generated' || value === 'edited') return 'brand';
  if (value === 'failed') return 'danger';
  return 'neutral';
}

export default function ArtifactPanel({ artifacts, title, hint, onOpenFile, dt }) {
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
            {item.storagePath ? (
              <button className="v2-btn v2-btn-xs" onClick={() => onOpenFile(item.storagePath)}>
                打开文件
              </button>
            ) : null}
          </div>
        )) : <p className="v2-hint">当前阶段还没有产物。</p>}
      </div>
    </div>
  );
}
