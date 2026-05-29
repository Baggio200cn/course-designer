/**
 * LectureReader.jsx — v4.3.3 功能5（老师反馈 2026-05-29）
 *
 * 讲稿正式稿确认后，点"周老师朗读"试听讲稿节奏。
 *
 * 技术：浏览器原生 Web Speech API（SpeechSynthesis），Electron 内置 Chromium 支持，
 *       离线、免费、零依赖。rate 参数控语速。
 * 语速基准：参考周老师真人录音（中职讲课偏清晰，约 220-240 字/分），默认档 0.9×。
 *
 * ⚠ 合规：此为软件内"试听"功能，帮老师打磨课堂语速；参赛演示视频的解说请用真人录音，
 *   不要用本朗读做配音（指南"原则上不能使用软件生成逐字稿配音"）。
 */
'use strict';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import zhouAvatar from '../assets/avatars/zhou.png';
// v4.3.3 Codex 审计R2：分段算法抽到纯工具（可真实单测），含超长句硬切保证 ≤ maxLen
import { cleanScriptForSpeech, splitScriptIntoChunks } from './lecture-speech-utils.mjs';

// 中文讲课语速档位（参考周老师真人录音节奏）
const SPEED_PRESETS = [
  { label: '慢速·细讲', rate: 0.75 },
  { label: '标准·周老师', rate: 0.9 },
  { label: '稍快', rate: 1.1 },
];

// 兼容旧导出（其它处若有引用）
export { cleanScriptForSpeech, splitScriptIntoChunks };

export function LectureReader({ open, script, onClose, api }) {
  const [rate, setRate] = useState(0.9);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [supported, setSupported] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');     // v4.3.3 Codex R2：TTS 错误显式暴露
  const voicesRef = useRef([]);
  const cancelledRef = useRef(false);
  // v4.3.3 功能5+：周老师真声（声音复刻）选段试听
  const [cloneText, setCloneText] = useState('');
  const [cloneLoading, setCloneLoading] = useState(false);
  const cloneAudioRef = useRef(null);

  // v4.3.3 Codex R2（问题4）：用 useMemo 固定 chunks，script 变化时重算并停止朗读，
  //   避免朗读中讲稿被重生成导致"进度与实际内容不一致"。
  const chunks = useMemo(() => splitScriptIntoChunks(script), [script]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') {
      setSupported(false);
      return undefined;
    }
    const loadVoices = () => { voicesRef.current = window.speechSynthesis.getVoices() || []; };
    loadVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', loadVoices);
      try { window.speechSynthesis.cancel(); } catch (_) { /* noop */ }
    };
  }, []);

  // script 变化（重生成讲稿）→ 停止当前朗读（系统 TTS + 周老师真声）+ 清进度/错误
  useEffect(() => {
    cancelledRef.current = true;
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) { /* noop */ }
    try { if (cloneAudioRef.current) { cloneAudioRef.current.pause(); cloneAudioRef.current = null; } } catch (_) { /* noop */ }
    setSpeaking(false); setPaused(false); setProgress({ done: 0, total: 0 }); setError(''); setCloneLoading(false);
  }, [script]);

  if (!open) return null;

  const pickZhVoice = () => {
    const voices = voicesRef.current.length ? voicesRef.current : (window.speechSynthesis.getVoices() || []);
    return voices.find((v) => /zh|chinese|中文|普通话/i.test(`${v.lang} ${v.name}`)) || null;
  };

  // 分段队列朗读：一段结束自动播下一段，稳定不卡
  const speakChunk = (idx, zhVoice) => {
    if (cancelledRef.current || idx >= chunks.length) {
      setSpeaking(false); setPaused(false);
      return;
    }
    setProgress({ done: idx, total: chunks.length });
    const u = new window.SpeechSynthesisUtterance(chunks[idx]);
    u.lang = 'zh-CN';
    u.rate = rate;
    if (zhVoice) u.voice = zhVoice;
    u.onend = () => { if (!cancelledRef.current) speakChunk(idx + 1, zhVoice); };
    // v4.3.3 Codex R2（问题2）：onerror 不再静默跳过。
    //   'interrupted'/'canceled' 是用户停止导致的正常事件，忽略；其它（synthesis-failed /
    //   audio-busy / 语音不可用等）首次就停止队列并显式提示，避免"一路跑完但没声音"。
    u.onerror = (e) => {
      if (cancelledRef.current) return;
      const kind = e && e.error;
      if (kind === 'interrupted' || kind === 'canceled') return;
      cancelledRef.current = true;
      setSpeaking(false); setPaused(false);
      setError(`朗读出错（${kind || '语音引擎不可用'}）。请检查系统是否安装中文语音，或改用真人录音。`);
    };
    window.speechSynthesis.speak(u);
  };

  const start = () => {
    if (!supported) { setError('当前环境不支持语音朗读（需要 Electron / Chrome）。'); return; }
    if (chunks.length === 0) { setError('正式稿为空，无法朗读。'); return; }
    try {
      window.speechSynthesis.cancel();
      cancelledRef.current = false;
      setError('');
      setSpeaking(true); setPaused(false);
      speakChunk(0, pickZhVoice());
    } catch (e) {
      setError(`朗读失败：${e.message}`);
      setSpeaking(false);
    }
  };
  const pause = () => { try { window.speechSynthesis.pause(); setPaused(true); } catch (_) { /* noop */ } };
  const resume = () => { try { window.speechSynthesis.resume(); setPaused(false); } catch (_) { /* noop */ } };
  const stop = () => {
    cancelledRef.current = true;
    try { window.speechSynthesis.cancel(); } catch (_) { /* noop */ }
    setSpeaking(false); setPaused(false);
  };

  // v4.3.3 功能5+：周老师真声（声音复刻）合成选段并播放
  const stopClone = () => {
    try { if (cloneAudioRef.current) { cloneAudioRef.current.pause(); cloneAudioRef.current = null; } } catch (_) { /* noop */ }
  };
  const playCloneVoice = async () => {
    const t = (cloneText || '').trim();
    if (!t) { setError('请把想用周老师真声朗读的段落粘贴到下方文本框'); return; }
    if (!api || typeof api.synthesizeLectureVoiceV2 !== 'function') {
      setError('当前环境不支持真声合成（需在 Electron 桌面端）'); return;
    }
    setError(''); setCloneLoading(true);
    stop(); stopClone();          // 先停系统 TTS + 上次真声
    try {
      const res = await api.synthesizeLectureVoiceV2({ text: t, speedRatio: rate });
      if (!res?.success) { setError(res?.error || '周老师真声合成失败'); setCloneLoading(false); return; }
      const audio = new Audio(`data:audio/mp3;base64,${res.audioBase64}`);
      cloneAudioRef.current = audio;
      audio.onended = () => { setCloneLoading(false); };
      audio.onerror = () => { setError('音频播放失败'); setCloneLoading(false); };
      await audio.play();
    } catch (e) {
      setError(`真声合成失败：${e.message}`); setCloneLoading(false);
    }
  };

  const closeAll = () => { stop(); stopClone(); onClose(); };

  return (
    <div className="v2-assistant-overlay" role="dialog" aria-modal="true" onClick={closeAll}>
      <div className="v2-reader-card" onClick={(e) => e.stopPropagation()}>
        <button className="v2-assistant-close" onClick={closeAll} aria-label="关闭">✕</button>
        <div className="v2-reader-head">
          <img src={zhouAvatar} alt="周老师" className="v2-assistant-avatar" draggable={false} />
          <div>
            <div className="v2-assistant-name">周老师为你朗读讲稿</div>
            <div className="v2-assistant-role">语速参考真人录音 · 可调档试听</div>
          </div>
        </div>

        {!supported ? (
          <div className="v2-reader-warn">当前环境不支持语音朗读（需在 Electron / Chrome 中运行）。</div>
        ) : (
          <>
            <div className="v2-reader-speed">
              <span>语速</span>
              <input type="range" min="0.6" max="1.4" step="0.05" value={rate}
                onChange={(e) => setRate(Number(e.target.value))} />
              <strong>{rate.toFixed(2)}×</strong>
            </div>
            <div className="v2-reader-presets">
              {SPEED_PRESETS.map((p) => (
                <button key={p.label}
                  className={Math.abs(rate - p.rate) < 0.03 ? 'active' : ''}
                  onClick={() => setRate(p.rate)}>{p.label}</button>
              ))}
            </div>
            <div className="v2-reader-controls">
              {!speaking
                ? <button className="v2-reader-play" onClick={start}>▶ 开始朗读</button>
                : (paused
                    ? <button className="v2-reader-play" onClick={resume}>▶ 继续</button>
                    : <button className="v2-reader-play" onClick={pause}>⏸ 暂停</button>)}
              <button className="v2-reader-stop" onClick={stop} disabled={!speaking}>⏹ 停止</button>
            </div>
            <div className="v2-reader-hint">
              共 {chunks.length} 段
              {speaking ? ` · 朗读中 ${progress.done + 1}/${chunks.length}` : ''}
              {' · 调整语速后请重新点"开始朗读"生效'}
            </div>

            {/* v4.3.3 功能5+：周老师真声（声音复刻）选段试听 */}
            <div className="v2-reader-clone">
              <div className="v2-reader-clone-title">🎙 周老师真声（选段试听 · 需在 API 配置填声音复刻）</div>
              <textarea
                className="v2-reader-clone-text"
                value={cloneText}
                onChange={(e) => setCloneText(e.target.value)}
                placeholder="从上方讲稿复制一段（≤1000 字）粘贴这里，用周老师真声朗读。按字符计费，建议选关键段落。"
                rows={3}
              />
              <button
                className="v2-reader-play"
                style={{ marginTop: 8 }}
                onClick={playCloneVoice}
                disabled={cloneLoading}
              >{cloneLoading ? '合成中…（约 1-3 秒）' : '▶ 用周老师真声朗读这段'}</button>
            </div>

            {/* v4.3.3 Codex R2（问题2）：TTS 错误显式提示，不再静默 */}
            {error ? <div className="v2-reader-warn" style={{ marginTop: 10 }}>{error}</div> : null}
            {/* v4.3.3 Codex 审计R1（问题6）：可见合规提醒，防误用于参赛视频配音 */}
            <div className="v2-reader-compliance">
              ⚠ 此为软件内试听功能，帮你打磨课堂语速。<strong>参赛演示视频的解说请用真人录音</strong>，
              切勿用本朗读做配音（评审指南"原则上不能使用软件生成逐字稿配音"）。
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default LectureReader;
