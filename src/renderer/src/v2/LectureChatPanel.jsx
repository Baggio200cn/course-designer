/**
 * LectureChatPanel.jsx — 讲稿辅助对话框（v4.3.0 D6.3）
 *
 * 右侧 30% 面板，老师与 AI 对话式打磨讲稿：
 *   - 上传文件（docx / pptx / pdf / md / txt / json / csv / 图片）
 *   - 输入指令（如"第 3 段加幽默"、"把 GMV 数据补到知识讲授"）
 *   - AI 返回 patch（不是重生整篇，只改局部段落）
 *   - 修改历史可回滚
 */
import React, { useState, useRef } from 'react';

const api = window.electronAPI;

export default function LectureChatPanel({
  notebookId,
  lessonMeta,
  currentScript,          // 当前讲稿全文
  onScriptPatch,          // (newScript) => void，patch 应用到讲稿
  width = 380,
}) {
  const [instruction, setInstruction] = useState('');
  const [attachments, setAttachments] = useState([]);  // [{name, kind, content, charCount}]
  const [history, setHistory] = useState([]);          // [{time, instruction, attachments, beforeLength, afterLength, success}]
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);      // { type:'success'|'error'|'info', text }
  const fileInputRef = useRef(null);

  const showFeedback = (type, text, ms = 4000) => {
    setFeedback({ type, text });
    if (ms > 0) setTimeout(() => setFeedback(null), ms);
  };

  // 文件上传（多格式解析 → 进 attachments）
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { window.alert('文件大于 10MB，请压缩后再传'); e.target.value = ''; return; }
    const lower = file.name.toLowerCase();
    const ext = lower.substring(lower.lastIndexOf('.') + 1);
    setBusy(true);
    showFeedback('info', `📎 解析 ${file.name}...`);
    try {
      let content = '';
      let kind = 'text';
      if (ext === 'docx') {
        const buf = await file.arrayBuffer();
        const base64 = btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ''));
        const res = await api.readDocxContent({ base64, filename: file.name });
        if (!res?.success) throw new Error(res?.error || 'docx 解析失败');
        content = res.data?.text || '';
        kind = 'docx';
      } else if (ext === 'pptx') {
        const buf = await file.arrayBuffer();
        const base64 = btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ''));
        const res = await api.readPptxContent({ base64, filename: file.name });
        if (!res?.success) throw new Error(res?.error || 'pptx 解析失败');
        content = res.data?.text || '';
        kind = 'pptx';
      } else if (ext === 'pdf') {
        if (typeof api.readPdfContent !== 'function') throw new Error('PDF 解析尚未启用（D6.4 待加）');
        const buf = await file.arrayBuffer();
        const base64 = btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ''));
        const res = await api.readPdfContent({ base64, filename: file.name });
        if (!res?.success) throw new Error(res?.error || 'pdf 解析失败');
        content = res.data?.text || '';
        kind = 'pdf';
      } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
        if (typeof api.readImageOcr !== 'function') throw new Error('图片 OCR 尚未启用（D6.4 待加 vision endpoint）');
        const buf = await file.arrayBuffer();
        const base64 = btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ''));
        const res = await api.readImageOcr({ base64, filename: file.name });
        if (!res?.success) throw new Error(res?.error || '图片 OCR 失败');
        content = res.data?.text || '';
        kind = 'image-ocr';
      } else if (['txt', 'md', 'csv', 'json'].includes(ext)) {
        content = await file.text();
        kind = ext;
      } else {
        throw new Error(`不支持的格式 .${ext}（支持：docx/pptx/pdf/png/jpg/txt/md/csv/json）`);
      }
      if (content.length > 8000) content = content.slice(0, 8000) + '\n…（截断）';
      setAttachments(prev => [...prev, { name: file.name, kind, content, charCount: content.length }]);
      showFeedback('success', `✅ 已加入 ${file.name}（${content.length} 字）`);
    } catch (err) {
      showFeedback('error', `❌ ${err.message}`, 8000);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const removeAttachment = (idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  // 发送指令 + attachments 给 AI，返回 patched script
  const handleSend = async () => {
    if (!instruction.trim() && attachments.length === 0) {
      window.alert('请输入指令或上传素材');
      return;
    }
    if (!currentScript || currentScript.length < 100) {
      window.alert('当前讲稿为空。请先点「✨ 生成正式稿」。');
      return;
    }
    if (typeof api.lessonChatPatchV2 !== 'function') {
      window.alert('preload 未加载新 API（lessonChatPatchV2）。请关闭 Electron 重启 npm run dev');
      return;
    }
    setBusy(true);
    const beforeLength = currentScript.length;
    showFeedback('info', '🤖 AI 正在按你的指令修改讲稿...');
    try {
      const res = await api.lessonChatPatchV2({
        notebookId,
        lessonMeta,
        currentScript,
        instruction: instruction.trim(),
        attachments,
      });
      if (!res?.success) throw new Error(res?.error || 'AI patch 失败');
      const newScript = res.data?.newScript || '';
      if (!newScript || newScript.length < 200) throw new Error('AI 返回的讲稿过短');
      // 应用到讲稿
      if (typeof onScriptPatch === 'function') onScriptPatch(newScript);
      // 加修改历史
      setHistory(prev => [
        { time: new Date(), instruction: instruction.trim(), attachments: attachments.map(a => a.name), beforeLength, afterLength: newScript.length, success: true },
        ...prev,
      ].slice(0, 20));
      setInstruction('');
      setAttachments([]);  // 用完清空（避免误重发）
      showFeedback('success', `✅ 修改完成（${beforeLength} → ${newScript.length} 字）`);
    } catch (e) {
      setHistory(prev => [
        { time: new Date(), instruction: instruction.trim(), attachments: attachments.map(a => a.name), beforeLength, afterLength: 0, success: false, error: e.message },
        ...prev,
      ].slice(0, 20));
      showFeedback('error', `❌ ${e.message}`, 8000);
    } finally {
      setBusy(false);
    }
  };

  const feedbackBg = feedback?.type === 'success' ? '#DCFCE7' : feedback?.type === 'error' ? '#FEE2E2' : '#DBEAFE';
  const feedbackColor = feedback?.type === 'success' ? '#166534' : feedback?.type === 'error' ? '#991B1B' : '#1E40AF';

  return (
    <aside style={{
      width, flexShrink: 0,
      borderLeft: '1px solid #E5E7EB',
      background: '#F9FAFB',
      display: 'flex', flexDirection: 'column',
      maxHeight: '100%',
      overflow: 'hidden',
    }}>
      {/* 头部 */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #E5E7EB', background: '#fff' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>💬 AI 辅助对话</div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>上传素材 + 输入指令 → AI 局部 patch 讲稿</div>
      </div>

      {/* 反馈条 */}
      {feedback ? (
        <div style={{ padding: '6px 14px', background: feedbackBg, color: feedbackColor, fontSize: 12 }}>
          {feedback.text}
        </div>
      ) : null}

      {/* 已上传素材列表 */}
      {attachments.length > 0 ? (
        <div style={{ padding: '8px 14px', borderBottom: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginBottom: 4 }}>📎 待发送素材（{attachments.length}）：</div>
          <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 11, color: '#475569' }}>
            {attachments.map((a, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                <span title={a.content.slice(0, 100)}>
                  {a.kind === 'image-ocr' ? '🖼' : a.kind === 'pdf' ? '📕' : a.kind === 'pptx' ? '📊' : a.kind === 'docx' ? '📄' : '📝'} {a.name}（{a.charCount} 字）
                </span>
                <button onClick={() => removeAttachment(i)} style={{ marginLeft: 6, background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 10 }}>× 删</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 上传按钮 */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #E5E7EB', display: 'flex', gap: 6 }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          style={{ flex: 1, padding: '6px 10px', fontSize: 12, background: '#fff', color: '#475569', border: '1px solid #CBD5E1', borderRadius: 5, cursor: 'pointer' }}
        >📎 上传素材文件</button>
        <input
          ref={fileInputRef} type="file"
          accept=".docx,.pptx,.pdf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.bmp"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
      </div>

      {/* 指令输入 */}
      <div style={{ padding: '8px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>💬 告诉 AI 怎么改：</label>
        <textarea
          rows={5}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={busy}
          placeholder={[
            '示例指令：',
            '• "把第 3 段开场口语化"',
            '• "把刚才上传的 GMV 数据补到知识讲授段"',
            '• "实操练习段加入图片里的具体案例"',
            '• "整个讲稿减少 30% 字数"',
            '• "把思政元素融入到第 5 段总结"',
          ].join('\n')}
          style={{ width: '100%', fontSize: 12, padding: 8, border: '1px solid #CBD5E1', borderRadius: 5, fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <button
          onClick={handleSend}
          disabled={busy || (!instruction.trim() && attachments.length === 0)}
          style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600,
            background: busy ? '#94A3B8' : '#2563EB', color: '#fff',
            border: 'none', borderRadius: 5, cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? '⏳ AI 改稿中…（30-90 秒）' : '→ 发送给 AI 改稿'}
        </button>
      </div>

      {/* 修改历史 */}
      {history.length > 0 ? (
        <div style={{ padding: '8px 14px', borderTop: '1px solid #E5E7EB', maxHeight: 200, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginBottom: 4 }}>📜 修改历史（{history.length}）</div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 11 }}>
            {history.map((h, i) => (
              <li key={i} style={{ padding: '4px 6px', marginBottom: 3, background: h.success ? '#F0FDF4' : '#FEF2F2', borderRadius: 3, color: h.success ? '#166534' : '#991B1B' }}>
                <div>{h.success ? '✓' : '✗'} {h.time.toLocaleTimeString()} · {h.beforeLength}→{h.afterLength}字</div>
                <div style={{ color: '#475569', fontSize: 10 }}>{h.instruction || '（无指令）'}{h.attachments.length > 0 ? `（含 ${h.attachments.length} 素材）` : ''}</div>
                {h.error ? <div style={{ color: '#991B1B', fontSize: 10 }}>{h.error}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
