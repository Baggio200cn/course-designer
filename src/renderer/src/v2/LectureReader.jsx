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

export function LectureReader({ open, script, onClose }) {
  const [rate, setRate] = useState(0.9);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [supported, setSupported] = useState(true);
  const utterRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') {
      setSupported(false);
    }
    return () => { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) { /* noop */ } };
  }, []);

  if (!open) return null;
  const text = cleanScriptForSpeech(script);

  const start = () => {
    if (!supported) { window.alert('当前环境不支持语音朗读（需要 Electron / Chrome）。'); return; }
    if (!text) { window.alert('正式稿为空，无法朗读。'); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = rate;
      const voices = window.speechSynthesis.getVoices() || [];
      const zh = voices.find((v) => /zh|chinese|中文|普通话/i.test(`${v.lang} ${v.name}`));
      if (zh) u.voice = zh;
      u.onend = () => { setSpeaking(false); setPaused(false); };
      u.onerror = () => { setSpeaking(false); setPaused(false); };
      utterRef.current = u;
      window.speechSynthesis.speak(u);
      setSpeaking(true); setPaused(false);
    } catch (e) {
      window.alert(`朗读失败：${e.message}`);
    }
  };
  const pause = () => { try { window.speechSynthesis.pause(); setPaused(true); } catch (_) { /* noop */ } };
  const resume = () => { try { window.speechSynthesis.resume(); setPaused(false); } catch (_) { /* noop */ } };
  const stop = () => { try { window.speechSynthesis.cancel(); } catch (_) { /* noop */ } setSpeaking(false); setPaused(false); };
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
              全文约 {text.length} 字 · 调整语速后请重新点"开始朗读"生效
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default LectureReader;
