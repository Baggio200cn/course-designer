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
import React, { useState, useEffect, useRef } from 'react';
import zhouAvatar from '../assets/avatars/zhou.png';

// 中文讲课语速档位（参考周老师真人录音节奏）
const SPEED_PRESETS = [
  { label: '慢速·细讲', rate: 0.75 },
  { label: '标准·周老师', rate: 0.9 },
  { label: '稍快', rate: 1.1 },
];

// 去 markdown 标记，保留可朗读正文
export function cleanScriptForSpeech(text) {
  return String(text || '')
    .replace(/^#+\s*/gm, '')             // 标题井号
    .replace(/\*\*(.*?)\*\*/g, '$1')      // 加粗
    .replace(/^\s*[-•*]\s+/gm, '')        // 列表符号
    .replace(/[#*`>_~|]/g, '')            // 残余 markdown 符号
    .replace(/\n{2,}/g, '\n')             // 多空行
    .trim();
}

// v4.3.3 Codex 审计R1（问题6）：长讲稿分段
//   一次性塞整篇进 SpeechSynthesisUtterance，Chromium/Web Speech 容易卡住/截断/不触发 onend。
//   按句子/段落切成 ≤ 180 字的小块，排队朗读，稳定且可中途停止。
export function splitScriptIntoChunks(text, maxLen = 180) {
  const clean = cleanScriptForSpeech(text);
  if (!clean) return [];
  // 先按换行/句末标点切句，再按 maxLen 合并成块
  const sentences = clean.split(/(?<=[。！？!?；;\n])/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > maxLen && buf) {
      chunks.push(buf);
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export function LectureReader({ open, script, onClose }) {
  const [rate, setRate] = useState(0.9);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [supported, setSupported] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const voicesRef = useRef([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') {
      setSupported(false);
      return undefined;
    }
    // v4.3.3 Codex 审计R1（问题6）：voiceschanged —— 部分环境首次 getVoices() 为空，
    //   需监听 voiceschanged 才能拿到中文音色
    const loadVoices = () => { voicesRef.current = window.speechSynthesis.getVoices() || []; };
    loadVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', loadVoices);
      try { window.speechSynthesis.cancel(); } catch (_) { /* noop */ }
    };
  }, []);

  if (!open) return null;
  const chunks = splitScriptIntoChunks(script);

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
    u.onerror = () => { if (!cancelledRef.current) speakChunk(idx + 1, zhVoice); };
    window.speechSynthesis.speak(u);
  };

  const start = () => {
    if (!supported) { window.alert('当前环境不支持语音朗读（需要 Electron / Chrome）。'); return; }
    if (chunks.length === 0) { window.alert('正式稿为空，无法朗读。'); return; }
    try {
      window.speechSynthesis.cancel();
      cancelledRef.current = false;
      setSpeaking(true); setPaused(false);
      speakChunk(0, pickZhVoice());
    } catch (e) {
      window.alert(`朗读失败：${e.message}`);
    }
  };
  const pause = () => { try { window.speechSynthesis.pause(); setPaused(true); } catch (_) { /* noop */ } };
  const resume = () => { try { window.speechSynthesis.resume(); setPaused(false); } catch (_) { /* noop */ } };
  const stop = () => {
    cancelledRef.current = true;
    try { window.speechSynthesis.cancel(); } catch (_) { /* noop */ }
    setSpeaking(false); setPaused(false);
  };
  const closeAll = () => { stop(); onClose(); };

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
