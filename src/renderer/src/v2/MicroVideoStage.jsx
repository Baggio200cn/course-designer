/**
 * MicroVideoStage — 微课视频整套方案阶段（驭课 Agent v4.0.0 / Phase-9 C-3）
 *
 * 替换旧 VideoStage（仅生成提示词）。新阶段产出完整方案：
 *   完整脚本 + 分镜 + 即梦提示词 + 拍摄要点 + 剪辑节奏
 * 关键契约：storyboard.length === jimengPrompts.length，时长 60-90s
 */
import React from 'react';
import AssistantStatusAvatar from './AssistantStatusAvatar';
import ArtifactPanel from './ArtifactPanel';

export default function MicroVideoStage({
  microVideoState,
  setMicroVideoState,
  assistantStatus,
  busy,
  handleGenerateMicroVideo,
  handleSaveMicroVideo,
  handleConfirmMicroVideo,
  handleOpenJimeng,
  handleCopyJimengPrompts,
  artifacts,
  dt,
  api,
  courseName,
  notebookId,
}) {
  const mv = microVideoState.microVideo || null;
  const storyboard = mv?.storyboard || [];
  const jimengPrompts = mv?.jimengPrompts || [];
  const totalDuration = mv?._stats?.totalDurationFromShots || 0;
  const durationOk = mv?._stats?.durationInRange === true;

  return (
    <section className="v2-stage-layout">
      <div className="v2-stage-center">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>微课视频整套方案</h3>
            <span className="v2-hint">脚本 + 分镜 + 即梦提示词 + 拍摄要点 + 剪辑节奏。时长 60-90s。</span>
          </div>
          <div className="v2-status-box">
            <span>助手状态</span>
            <AssistantStatusAvatar stage="video" status={assistantStatus} />
          </div>
          <div className="v2-grid-two">
            <div>
              <label className="v2-label">视频主题</label>
              <input
                value={microVideoState.videoTopic || ''}
                onChange={(e) => setMicroVideoState((prev) => ({ ...prev, videoTopic: e.target.value }))}
                placeholder="例如：色彩搭配的视觉传达原理"
              />
            </div>
            <div>
              <label className="v2-label">视频风格</label>
              <select
                value={microVideoState.style || '写实教学风'}
                onChange={(e) => setMicroVideoState((prev) => ({ ...prev, style: e.target.value }))}
              >
                <option value="写实教学风">写实教学风</option>
                <option value="扁平卡通风">扁平卡通风</option>
                <option value="国风简约">国风简约</option>
              </select>
            </div>
          </div>
          <div className="v2-inline-actions v2-field-top-gap">
            <button className="v2-btn v2-btn-primary" onClick={handleGenerateMicroVideo} disabled={busy}>
              生成完整方案
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={() => handleSaveMicroVideo(microVideoState)} disabled={!mv}>
              保存
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleConfirmMicroVideo} disabled={!microVideoState.artifactId}>
              确认（解锁实施报告）
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleCopyJimengPrompts} disabled={jimengPrompts.length === 0}>
              复制即梦提示词
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={handleOpenJimeng}>打开即梦</button>
            {/* v4.3.3 测试报告 #4 修复 · 2026-05-20：导出 Word（按 video_prompt 真实 schema 渲染 5 大段） */}
            <button
              className="v2-btn v2-btn-secondary"
              onClick={async () => {
                if (!mv) return;
                try {
                  const res = await api.exportMicroVideoWordV2?.({ notebookId });
                  if (res?.success) {
                    alert(`✅ 已导出：\n${res.data?.filePath}`);
                  } else if (res?.cancelled) {
                    // 用户取消保存对话框，不报警
                  } else {
                    alert(`❌ 导出失败：${res?.error || '未知错误'}`);
                  }
                } catch (e) {
                  alert(`❌ 导出失败：${e.message}`);
                }
              }}
              disabled={!mv || storyboard.length === 0}
              title="把当前方案按真实 schema 渲染成 Word（含旁白脚本/分镜表/即梦提示词/拍摄+剪辑指南）"
            >
              📄 导出 Word
            </button>
          </div>
        </div>

        <div className="v2-stage-banner stage-video">
          <div className="v2-stage-banner-copy">
            <span>方案概览</span>
            <strong>{mv?.videoTopic || courseName || '本节核心要点'}</strong>
            <p>分镜 {storyboard.length} · 提示词 {jimengPrompts.length} · 时长 {totalDuration}s</p>
          </div>
          <div className="v2-metric-grid">
            <div className="v2-metric-card">
              <span>分镜=提示词</span>
              <strong>{storyboard.length === jimengPrompts.length && storyboard.length > 0 ? '是' : '否'}</strong>
            </div>
            <div className="v2-metric-card">
              <span>时长 60-90s</span>
              <strong>{durationOk ? '是' : '否'}</strong>
            </div>
            <div className="v2-metric-card">
              <span>已确认</span>
              <strong>{microVideoState.confirmed ? '是' : '否'}</strong>
            </div>
          </div>
        </div>

        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>方案 JSON</h3>
            <span className="v2-hint">直接编辑后点"保存"。</span>
          </div>
          <textarea
            className="v2-code"
            rows={22}
            value={microVideoState.jsonText || ''}
            onChange={(e) => setMicroVideoState((prev) => ({ ...prev, jsonText: e.target.value }))}
            placeholder="生成后这里会显示完整方案 JSON。"
          />
        </div>
      </div>

      <div className="v2-stage-right">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>分镜清单</h3>
            <span className="v2-hint">每个分镜含拍摄要点 + 即梦提示词。</span>
          </div>
          {storyboard.length === 0 ? (
            <p className="v2-hint">尚未生成。</p>
          ) : (
            <ol className="v2-numbered-list">
              {storyboard.map((shot, i) => (
                <li key={i}>
                  <strong>{shot.type || `镜头 ${i + 1}`}</strong>
                  <span> · {shot.duration || '—'}s</span>
                  {shot.description ? <p className="v2-hint">{shot.description}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </div>

        <ArtifactPanel
          artifacts={artifacts}
          title="微课视频产物"
          hint="artifact_type='video_prompt'"
          onOpenFile={(storagePath) => api.openResource(storagePath)}
          dt={dt}
        />
      </div>
    </section>
  );
}
