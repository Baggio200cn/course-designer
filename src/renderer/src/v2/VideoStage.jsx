import React from 'react';
import ArtifactPanel from './ArtifactPanel';

export default function VideoStage({
  videoState,
  setVideoState,
  assistantStatus,
  busy,
  handleGenerateVideoPrompt,
  handleSaveVideoStage,
  handleCopyVideoPrompt,
  handleOpenJimeng,
  handleOpenPexo,
  handleCopyPexoInfo,
  artifacts,
  dt,
  api
}) {
  const promptLength = String(videoState.promptText || '').trim().length;
  const promptLines = String(videoState.promptText || '').split(/\r?\n/).filter((item) => item.trim()).length;

  return (
    <section className="v2-stage-layout">
      <div className="v2-stage-center">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>视频提示词阶段</h3>
            <span className="v2-hint">默认路径是提示词桥接，不把 Seedance 直连拉回主链。</span>
          </div>
          <div className="v2-status-box">
            <span>助手状态</span>
            <strong>{assistantStatus}</strong>
          </div>
          <div className="v2-grid-two">
            <div>
              <label className="v2-label">视频风格</label>
              <input
                value={videoState.style}
                onChange={(e) => setVideoState((prev) => ({ ...prev, style: e.target.value }))}
                placeholder="例如：专业稳重、现代实验感、课堂纪实感"
              />
            </div>
            <div>
              <label className="v2-label">默认跳转平台</label>
              <select value={videoState.engine} onChange={(e) => setVideoState((prev) => ({ ...prev, engine: e.target.value }))}>
                <option value="jimeng">即梦</option>
                <option value="pexo">PEXO</option>
              </select>
            </div>
          </div>
          <div className="v2-inline-actions v2-field-top-gap">
            <button className="v2-btn v2-btn-primary" onClick={handleGenerateVideoPrompt} disabled={busy}>生成提示词</button>
            <button className="v2-btn v2-btn-secondary" onClick={() => handleSaveVideoStage(videoState)}>保存视频阶段</button>
            <button className="v2-btn v2-btn-secondary" onClick={handleCopyVideoPrompt}>复制提示词</button>
            <button className="v2-btn v2-btn-secondary" onClick={handleOpenJimeng}>打开即梦</button>
            <button className="v2-btn v2-btn-secondary" onClick={handleOpenPexo}>打开 PEXO</button>
          </div>
        </div>

        <div className="v2-stage-banner stage-video">
          <div className="v2-stage-banner-copy">
            <span>视频桥接</span>
            <strong>这里负责把课程产物翻译成外部视频平台可执行的提示词。</strong>
            <p>工作台里保留的是桥接稿和平台元数据，不直接把外部生成过程回灌到主链里。</p>
          </div>
          <div className="v2-metric-grid">
            <div className="v2-metric-card">
              <span>默认平台</span>
              <strong>{videoState.engine === 'pexo' ? 'PEXO' : '即梦'}</strong>
            </div>
            <div className="v2-metric-card">
              <span>提示词字数</span>
              <strong>{promptLength}</strong>
            </div>
            <div className="v2-metric-card">
              <span>段落行数</span>
              <strong>{promptLines}</strong>
            </div>
          </div>
        </div>

        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>视频提示词</h3>
            <span className="v2-hint">这里允许手改，保存后会写入 `video_prompt` artifact。</span>
          </div>
          <textarea
            className="v2-code"
            rows={22}
            value={videoState.promptText}
            onChange={(e) => setVideoState((prev) => ({ ...prev, promptText: e.target.value }))}
            placeholder="这里显示生成的视频提示词。"
          />
        </div>
      </div>

      <div className="v2-stage-right">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>桥接说明</h3>
            <span className="v2-hint">即梦为主入口，PEXO 为备用入口。</span>
          </div>
          <div className="v2-note-box">
            <strong>当前默认平台</strong>
            <p>{videoState.engine === 'pexo' ? 'PEXO' : '即梦'}</p>
          </div>
          <div className="v2-note-box">
            <strong>建议操作</strong>
            <p>先复制提示词，再跳转目标平台继续生成。这样可以保持工具内产物和外部平台解耦。</p>
          </div>
          <div className="v2-inline-actions">
            <button className="v2-btn v2-btn-secondary" onClick={handleCopyPexoInfo}>复制 PEXO 邀请码</button>
          </div>
        </div>

        <ArtifactPanel
          artifacts={artifacts}
          title="视频产物"
          hint="当前只结构化保存提示词与桥接元数据。"
          onOpenFile={(storagePath) => api.openResource(storagePath)}
          dt={dt}
        />
      </div>
    </section>
  );
}
