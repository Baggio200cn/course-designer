/**
 * LectureStage — 课堂讲稿阶段（驭课 Agent v4.0.0 / Phase-9 多节课模式）
 *
 * 与老 v3.x 区别：
 *   - 老：1 份讲稿覆盖整门课
 *   - 新：N 份讲稿，每份对应 1 节课（≤ 4 学时，理论+实践拼配）
 *
 * UI 结构：
 *   ① 顶部 tab 条：第 1 节 | 第 2 节 | + 新建节课  + 学时进度
 *   ② 本节基础信息：主题（可拉进度表）、理论/实践学时、关联章节
 *   ③ 教学素材辅助生成（保留）：URL / 上传 / 粘贴
 *   ④ A/B/C 候选 → 正式稿 → 确认 → 导出
 */
import React, { useState, useEffect, useMemo } from 'react';
import ArtifactPanel from './ArtifactPanel';
import LectureChatPanel from './LectureChatPanel';   // v4.3.0 D6.3
// v4.3.3 新版 · 预览全屏（讲稿正式稿大屏阅读模式）
import { PreviewFullscreen, PreviewFullscreenToggle } from './PreviewFullscreen';
// v4.3.3 功能5（老师反馈）· 讲稿朗读（周老师卡通 + 语速）
import { LectureReader } from './LectureReader';

const DEFAULT_LESSON = {
  lessonNumber: 1,
  topic: '',
  chapter: '',
  theoryHours: 2,
  practiceHours: 2,
  weekRange: '',
  referenceMaterials: [],   // [{kind:'url'|'file'|'text', url?, filename?, content}]
  // P1.1e（2026-05-17）：新流程模型
  draftScript: '',         // ① AI 直接生成的 1 稿（无 ABC）
  finalScript: '',         // ② 走 9 维度质量审核后的正式稿
  // 兼容老 artifact 数据格式（v4.2 及之前）
  drafts: { a: '', b: '', c: '' },
  selectedDraft: 'a',
  audit: null,
};

const DRAFT_META = {
  a: { title: 'A 稿', emphasis: '知识逻辑型', hint: '侧重知识主线与判断依据' },
  b: { title: 'B 稿', emphasis: '互动场景型', hint: '侧重案例 / 提问 / 学生参与' },
  c: { title: 'C 稿', emphasis: '实操精简型', hint: '侧重操作步骤与实训要点' },
};

export default function LectureStage({
  selectedNotebookId,
  api,
  assistantStatus,
  setAssistantStatus,
  busy,
  courseName = '',
  totalCourseHours = 72,
  scheduleData = null,         // 进度表 artifact 内容（用于"主题从进度表拉"）
  designData = null,
  artifacts = [],
  dt,
  shorten,
}) {
  // ── 节课列表 + 当前编辑节课 ─────────────────────────────────────
  // v4.3.3 新版：讲稿最大化预览
  const [lecturePreviewFs, setLecturePreviewFs] = useState(false);
  // v4.3.3 功能5：讲稿朗读面板开关
  const [readerOpen, setReaderOpen] = useState(false);
  const [lessons, setLessons] = useState([]);     // [{id, lessonNumber, topic, theoryHours, ...}]
  const [usedHours, setUsedHours] = useState(0);
  const [currentLessonId, setCurrentLessonId] = useState(null);   // 编辑中的节课 artifact id；null=新建
  const [lessonForm, setLessonForm] = useState({ ...DEFAULT_LESSON });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refUrlInput, setRefUrlInput] = useState('');
  const [refTextInput, setRefTextInput] = useState('');
  // 老师手搓正式稿专用 state
  const [showManualPaste, setShowManualPaste] = useState(false);
  const [manualPasteText, setManualPasteText] = useState('');
  // 2026-05-16 v4.1.4：讲稿产物只读查看 modal
  const [viewModal, setViewModal] = useState(null);   // { title, content, confirmed, createdAt }

  // ── v4.3.0 D7：lecture 阶段启动数据（PPT 列表 + 默认 lessonMeta 自动预填）─────
  const [pptOptions, setPptOptions] = useState([]);           // [{id, title, lessonMeta, pageCount, confirmed, ...}]
  const [selectedPptId, setSelectedPptId] = useState(null);   // 当前选作骨架的 PPT id
  const [autoPrefilled, setAutoPrefilled] = useState(false);  // 防止多次自动覆盖老师手改

  // ── 拉节课列表 ─────────────────────────────────────────────────
  const refreshLessons = async () => {
    if (!selectedNotebookId) return;
    const res = await api.lessonListV2(selectedNotebookId);
    if (res?.success) {
      setLessons(res.data.lessons || []);
      setUsedHours(res.data.usedHours || 0);
    }
  };
  useEffect(() => { refreshLessons(); }, [selectedNotebookId]);

  // ── D7：进 lecture 阶段时自动拉 PPT 列表 + 预填本节信息 ─────────────────────
  useEffect(() => {
    if (!selectedNotebookId) return;
    if (typeof api.getLectureBootstrapV2 !== 'function') {
      console.warn('[D7] api.getLectureBootstrapV2 未注入 — 需要完整重启 Electron');
      return;
    }
    (async () => {
      const res = await api.getLectureBootstrapV2({ notebookId: selectedNotebookId });
      if (!res?.success) {
        console.warn('[D7] getLectureBootstrap 失败:', res?.error);
        return;
      }
      const opts = res.data?.pptOptions || [];
      setPptOptions(opts);
      const defId = res.data?.defaultPptId || null;
      setSelectedPptId(defId);
      // 自动预填：仅当 lessonForm 是空白（没主题）且没自动填过时才填
      if (!autoPrefilled && !lessonForm.topic && !currentLessonId && res.data?.lessonMeta) {
        const m = res.data.lessonMeta;
        setLessonForm((prev) => ({
          ...prev,
          lessonNumber: m.lessonNumber || prev.lessonNumber,
          topic: m.topic || prev.topic,
          chapter: m.chapter || prev.chapter,
          theoryHours: m.theoryHours || prev.theoryHours,
          practiceHours: m.practiceHours || prev.practiceHours,
          weekRange: m.weekRange || prev.weekRange,
        }));
        setAutoPrefilled(true);
        setAssistantStatus(`✅ 已自动从最新 PPT 课件预填本节信息（${opts.length} 份 PPT 可选）`);
      }
    })();
  }, [selectedNotebookId]);

  // D7：老师手动切 PPT 下拉时，同步把该 PPT 的 lessonMeta 拉进 lessonForm
  const onPickPptSkeleton = (pptId) => {
    const id = Number(pptId);
    if (!Number.isFinite(id) || id <= 0) return;
    const target = pptOptions.find((p) => Number(p.id) === id);
    if (!target) return;
    setSelectedPptId(id);
    const m = target.lessonMeta || {};
    if (!window.confirm(
      `切换骨架到《${target.title}》（${target.pageCount} 页）？\n\n` +
      `将把本节基础信息覆盖为：\n` +
      `  第 ${m.lessonNumber || '?'} 节 · ${m.topic || '(无主题)'} · ${m.chapter || ''} · ` +
      `${(m.theoryHours || 0) + (m.practiceHours || 0)} 学时\n\n` +
      `（如果你已手改本节信息，会被覆盖。仍要切换？）`
    )) return;
    setLessonForm((prev) => ({
      ...prev,
      lessonNumber: m.lessonNumber || prev.lessonNumber,
      topic: m.topic || '',
      chapter: m.chapter || '',
      theoryHours: m.theoryHours || 0,
      practiceHours: m.practiceHours || 0,
      weekRange: m.weekRange || '',
    }));
    setAssistantStatus(`✅ 已切换骨架到《${target.title}》并同步本节信息`);
  };

  // ── 切换 / 加载节课 ─────────────────────────────────────────────
  const loadLesson = async (lessonId) => {
    if (!lessonId) {
      // "新建一节" → 重置为默认，lessonNumber = 已有数 + 1
      setCurrentLessonId(null);
      const nextNo = (lessons[lessons.length - 1]?.lessonNumber || 0) + 1;
      setLessonForm({ ...DEFAULT_LESSON, lessonNumber: nextNo });
      return;
    }
    setLoading(true);
    try {
      const res = await api.lessonGetV2({ lessonId });
      if (res?.success) {
        const l = res.data.lesson;
        setCurrentLessonId(l.id);
        setLessonForm({
          lessonNumber: l.metadata?.lessonNumber || 1,
          topic: l.metadata?.topic || '',
          chapter: l.metadata?.chapter || '',
          theoryHours: l.metadata?.theoryHours || 2,
          practiceHours: l.metadata?.practiceHours || 2,
          weekRange: l.metadata?.weekRange || '',
          referenceMaterials: l.content?.referenceMaterials || [],
          // P1.1e：新模型 draftScript 优先；老数据 drafts.a 兼容
          draftScript: l.content?.draftScript || l.content?.drafts?.a || '',
          finalScript: l.content?.finalScript || '',
          // 兼容老 artifact 字段
          drafts: l.content?.drafts || { a: '', b: '', c: '' },
          selectedDraft: l.content?.selectedDraft || 'a',
          audit: l.content?.audit || null,
          confirmed: l.confirmed,
        });
      }
    } finally { setLoading(false); }
  };

  // ── 学时校验（只警告，不拦截）─────────────────────────────────
  const lessonHours = (Number(lessonForm.theoryHours) || 0) + (Number(lessonForm.practiceHours) || 0);
  const willExceed = useMemo(() => {
    // 已确认节课累计学时 + 当前节课学时（如果当前是新建则直接加；如果是已存在则扣旧值）
    const existingHours = currentLessonId
      ? (lessons.find((l) => l.id === currentLessonId)
          ? (lessons.find((l) => l.id === currentLessonId).theoryHours + lessons.find((l) => l.id === currentLessonId).practiceHours)
          : 0)
      : 0;
    return (usedHours - existingHours + lessonHours) > totalCourseHours;
  }, [usedHours, lessonHours, currentLessonId, lessons, totalCourseHours]);

  // ── 进度表"拉取主题"下拉 ───────────────────────────────────────
  // 2026-05-16 v4.1.4：原版下拉只显示「一/一(续)/二/二(续)」空架子
  //   现在按 chapter 分组取首行 content 作为可读标题，展示成「一 · 意识——服装产品传播起源（3 次课）」
  const scheduleRows = scheduleData?.schedule || [];
  const chaptersFromSchedule = useMemo(() => {
    const map = new Map();   // key=chapter raw value
    for (const r of scheduleRows) {
      const ch = String(r.chapter || '').trim();
      if (!ch) continue;
      // "(续)" 行合并到上一非续章节
      if (/^[（(]续[）)]$/.test(ch)) {
        const lastKey = Array.from(map.keys()).pop();
        if (lastKey) {
          const g = map.get(lastKey);
          g.count += 1;
        }
        continue;
      }
      if (!map.has(ch)) {
        map.set(ch, {
          key: ch,
          firstContent: String(r.content || '').trim(),
          count: 1,
        });
      } else {
        const g = map.get(ch);
        g.count += 1;
        if (!g.firstContent) g.firstContent = String(r.content || '').trim();
      }
    }
    return Array.from(map.values()).map((g) => ({
      key: g.key,
      label: g.firstContent ? `${g.key} · ${g.firstContent}（${g.count} 次课）` : g.key,
    }));
  }, [scheduleRows]);
  const onPickFromSchedule = (chapter) => {
    if (!chapter) return;
    // 找该章节下第一行的 content / week 作为主题/周次
    const firstRow = scheduleRows.find((r) => r.chapter === chapter);
    if (firstRow) {
      setLessonForm((prev) => ({
        ...prev,
        chapter,
        topic: firstRow.content || prev.topic,
        weekRange: `第 ${firstRow.week} 周`,
      }));
    }
  };

  // ── 素材抓取 ──────────────────────────────────────────────────
  // URL 清洗：剥离第一个分隔符（空格/分号/逗号/换行）后的内容，避免老师粘贴多个 URL
  const sanitizeUrl = (raw) => {
    const trimmed = String(raw || '').trim();
    // 取第一个 http(s):// 开头到第一个非法字符前的子串
    const match = trimmed.match(/^https?:\/\/[^\s;,\n]+/);
    return match ? match[0] : trimmed.split(/[\s;,\n]/)[0];
  };

  const fetchUrl = async () => {
    const cleanUrl = sanitizeUrl(refUrlInput);
    if (!cleanUrl) return;
    if (!/^https?:\/\//i.test(cleanUrl)) {
      window.alert('URL 必须以 http:// 或 https:// 开头');
      return;
    }
    if (cleanUrl !== refUrlInput.trim()) {
      // 老师粘贴了带分号/空格/多 URL 的内容，告知已自动处理
      const ok = window.confirm(
        `检测到输入包含多个 URL 或额外字符。\n\n实际抓取：${cleanUrl}\n\n是否继续？（多个 URL 请分次添加）`
      );
      if (!ok) return;
    }
    setAssistantStatus('正在抓取 URL...');
    const res = await api.fetchUrlContent(cleanUrl);
    if (!res?.success) {
      const errMsg = res?.error || '未知';
      const fallback = window.confirm(
        `抓取失败：${errMsg}\n\n` +
        `常见原因：\n` +
        `  · 该网站需要 JS 渲染（SPA 站如 britannica/medium）\n` +
        `  · 网站封锁了非浏览器请求\n` +
        `  · 网络超时或代理问题\n\n` +
        `建议改用以下方式：\n` +
        `  1. 浏览器手动打开 → 复制正文 → 粘贴到下方"粘贴参考文本"框\n` +
        `  2. 下载为 PDF/DOCX → 用"📎 上传文件"按钮\n\n` +
        `点确定关闭此提示，去试备选方式；点取消保留本 URL 输入。`
      );
      if (fallback) {
        setRefUrlInput('');
        setAssistantStatus('💡 已切换到手动粘贴模式');
      } else {
        setAssistantStatus(`抓取失败：${errMsg}`);
      }
      return;
    }
    setLessonForm((prev) => ({
      ...prev,
      referenceMaterials: [...prev.referenceMaterials, { kind: 'url', url: cleanUrl, content: res.data?.text || '' }],
    }));
    setRefUrlInput('');
    setAssistantStatus(`✅ URL 抓取成功，${(res.data?.text || '').length} 字`);
  };
  const addPastedText = () => {
    if (!refTextInput.trim()) return;
    setLessonForm((prev) => ({
      ...prev,
      referenceMaterials: [...prev.referenceMaterials, { kind: 'text', content: refTextInput.trim() }],
    }));
    setRefTextInput('');
  };
  const onUploadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAssistantStatus('正在解析文件...');

    // 2026-05-15 v4.1.4 扩展：支持 8+ 种格式 + 友好错误提示
    const lowerName = file.name.toLowerCase();
    const ext = lowerName.substring(lowerName.lastIndexOf('.') + 1);

    // 文件大小限制（10MB）
    if (file.size > 10 * 1024 * 1024) {
      window.alert(`⚠ 文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大支持 10MB。`);
      e.target.value = '';
      setAssistantStatus('');
      return;
    }

    // 提示未支持的格式 — D6.4（2026-05-18）：pdf 和 pptx 已支持，移出 UNSUPPORTED
    const UNSUPPORTED = {
      doc:  '.doc（老 Word 格式）暂不支持。请用 WPS/Word 另存为 .docx 后上传。',
      xls:  '.xls 暂不支持。请另存为 .xlsx 后再用复制粘贴或转 .csv 上传。',
      xlsx: '.xlsx 暂不支持。建议把表格复制到 .docx 或另存为 .csv 后上传。',
      ppt:  '.ppt（老格式）暂不支持。请用 PowerPoint 另存为 .pptx 后上传。',
      jpg: '图片请用右侧 AI 对话框上传走 OCR（多模态 endpoint）。',
      jpeg: '图片请用右侧 AI 对话框上传走 OCR（多模态 endpoint）。',
      png: '图片请用右侧 AI 对话框上传走 OCR（多模态 endpoint）。',
    };
    if (UNSUPPORTED[ext]) {
      window.alert(`❌ 不支持 .${ext} 格式：\n\n${UNSUPPORTED[ext]}\n\n当前支持：.docx / .txt / .md / .csv / .json / .html / .htm / .rtf / .log`);
      e.target.value = '';
      setAssistantStatus('');
      return;
    }

    try {
      let text = '';
      let kind = 'file';

      if (ext === 'docx') {
        // mammoth 提取纯文本
        const buffer = await file.arrayBuffer();
        const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        const res = await api.readDocxContent({ base64, filename: file.name });
        if (!res?.success) { window.alert(`解析失败：${res?.error || '未知'}`); e.target.value = ''; setAssistantStatus(''); return; }
        text = res.data?.text || '';
      } else if (ext === 'pdf') {
        // D6.4：数字版 PDF 抽取（pdf-parse），扫描版会报错
        if (typeof api.readPdfContent !== 'function') {
          window.alert('❌ PDF 解析未启用 — 请完整重启 Electron（preload 改了）');
          e.target.value = ''; setAssistantStatus(''); return;
        }
        const buffer = await file.arrayBuffer();
        const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        const res = await api.readPdfContent({ base64, filename: file.name });
        if (!res?.success) {
          window.alert(`PDF 解析失败：${res?.error || '未知'}\n\n如果是扫描版 PDF，请用截图 + 右侧 AI 对话框上传走 OCR。`);
          e.target.value = ''; setAssistantStatus(''); return;
        }
        text = res.data?.text || '';
      } else if (ext === 'pptx') {
        // D3：.pptx 用 jszip 抽每页文字
        if (typeof api.readPptxContent !== 'function') {
          window.alert('❌ PPTX 解析未启用 — 请完整重启 Electron');
          e.target.value = ''; setAssistantStatus(''); return;
        }
        const buffer = await file.arrayBuffer();
        const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        const res = await api.readPptxContent({ base64, filename: file.name });
        if (!res?.success) { window.alert(`PPTX 解析失败：${res?.error || '未知'}`); e.target.value = ''; setAssistantStatus(''); return; }
        text = res.data?.text || '';
      } else if (['txt', 'md', 'csv', 'json', 'log'].includes(ext)) {
        // 纯文本直接读
        text = await file.text();
      } else if (['html', 'htm'].includes(ext)) {
        // HTML：去标签
        const raw = await file.text();
        text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&[a-z]+;/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
      } else if (ext === 'rtf') {
        // RTF：粗略去掉 control words 和 {}
        const raw = await file.text();
        text = raw
          .replace(/\\[a-z]+-?[0-9]*\s?/gi, '')   // \rtf1 \pard \fs20 等控制字
          .replace(/[{}]/g, '')
          .replace(/\\'..|\\\*|\\u-?\d+\??/g, '') // 转义字符
          .replace(/\s+/g, ' ')
          .trim();
      } else {
        // 未列入白名单但可能是纯文本——尝试当文本读，太短就当失败
        try {
          text = await file.text();
          if (text.length < 5) throw new Error('content empty');
          if (/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 500))) {
            // 含二进制控制字符 → 不是文本
            throw new Error('binary file');
          }
        } catch (e) {
          window.alert(`❌ 无法解析 .${ext} 格式。\n\n请把内容粘贴到上方"粘贴参考文本"框，或转为 .docx / .txt / .md 后再上传。`);
          e.target && (e.target.value = '');
          setAssistantStatus('');
          return;
        }
      }

      // 字符截断保护（10000 字）
      if (text.length > 10000) {
        text = text.slice(0, 10000) + '\n…（已截断至 10000 字）';
      }

      setLessonForm((prev) => ({
        ...prev,
        referenceMaterials: [...prev.referenceMaterials, { kind, filename: file.name, content: text }],
      }));
      setAssistantStatus(`✅ ${file.name} 解析成功（${text.length} 字）`);
    } catch (err) {
      console.error('[onUploadFile] 异常:', err);
      window.alert(`❌ 文件解析失败：${err.message}\n\n建议：把内容粘贴到上方"粘贴参考文本"框。`);
      setAssistantStatus(`❌ ${file.name} 解析失败`);
    }
    e.target.value = '';
  };
  const removeMaterial = (idx) => {
    setLessonForm((prev) => ({
      ...prev,
      referenceMaterials: prev.referenceMaterials.filter((_, i) => i !== idx),
    }));
  };

  // ── 保存（自动给 lessonId 或新建） ─────────────────────────────
  const onSave = async () => {
    if (!selectedNotebookId) return;
    if (!lessonForm.topic.trim()) { window.alert('请填写本节主题'); return; }
    if (willExceed) {
      const ok = window.confirm(`⚠ 本节学时 ${lessonHours} 加上已确认 ${usedHours} 超过总学时 ${totalCourseHours}，是否仍要保存？`);
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await api.lessonSaveV2({
        notebookId: selectedNotebookId,
        lessonId: currentLessonId,
        lessonMeta: {
          lessonNumber: lessonForm.lessonNumber,
          topic: lessonForm.topic,
          chapter: lessonForm.chapter,
          theoryHours: lessonForm.theoryHours,
          practiceHours: lessonForm.practiceHours,
          weekRange: lessonForm.weekRange,
        },
        content: {
          drafts: lessonForm.drafts,
          selectedDraft: lessonForm.selectedDraft,
          finalScript: lessonForm.finalScript,
          referenceMaterials: lessonForm.referenceMaterials,
          audit: lessonForm.audit,
        },
      });
      if (!res?.success) { window.alert(`保存失败：${res?.error || '未知'}`); return; }
      setCurrentLessonId(res.data.lessonId);
      await refreshLessons();
      setAssistantStatus('✅ 本节已保存');
    } finally { setSaving(false); }
  };

  // ── ① 生成讲稿草稿（1 稿，v4.3 新流程）─────────────────────
  // P1.1e 重构（2026-05-17）：用 lessonGenerateDraftV2 替代废弃的 lessonGenerateABCV2
  const onGenerateDraft = async () => {
    if (!selectedNotebookId) return;
    if (!lessonForm.topic.trim()) { window.alert('请先填写本节主题'); return; }
    if (typeof api.lessonGenerateDraftV2 !== 'function') {
      window.alert('❌ api.lessonGenerateDraftV2 不存在 — 需要完整重启 Electron（preload 已重写）');
      return;
    }
    setAssistantStatus('🤖 正在生成讲稿草稿（约 30-90 秒，请耐心等待）...');
    try {
      const res = await api.lessonGenerateDraftV2({
        notebookId: selectedNotebookId,
        lessonMeta: {
          lessonNumber: lessonForm.lessonNumber,
          topic: lessonForm.topic,
          chapter: lessonForm.chapter,
          theoryHours: lessonForm.theoryHours,
          practiceHours: lessonForm.practiceHours,
          weekRange: lessonForm.weekRange,
        },
        referenceMaterials: lessonForm.referenceMaterials,
      });
      if (!res?.success) {
        window.alert(`生成失败：${res?.error || '未知'}\n\n常见原因：\n  · API Key 未配置\n  · AI 模型超时\n  · lessonMeta 缺学时 / notebook 缺 minutesPerHour`);
        setAssistantStatus(`❌ 生成失败：${res?.error || '未知'}`);
        return;
      }
      const draftScript = String(res.data?.draftScript || '');
      if (!draftScript || draftScript.length < 200) {
        window.alert('AI 返回的草稿过短，请检查素材是否完整');
        setAssistantStatus('❌ AI 返回空内容');
        return;
      }
      const refFilterAudit = res.data?.referenceFilterAudit || null;
      // v4.3.0 D8（2026-05-18）：生成后立刻自动落库 draft，防止刷新丢失
      //   先更新 state，再用更新后的 form 调一次 save（draft 状态）
      const nextForm = {
        ...lessonForm,
        draftScript,
        finalScript: draftScript,
        drafts: { a: draftScript, b: '', c: '' },
        selectedDraft: 'a',
        referenceFilterAudit: refFilterAudit,
      };
      setLessonForm(nextForm);
      const filterMsg = refFilterAudit && refFilterAudit.dropped > 0
        ? `（剔除 ${refFilterAudit.dropped} 条离题素材）`
        : '';
      // D8：立即静默保存
      const saveRes = await autoSaveDraft(nextForm, 'AI 生成讲稿');
      if (saveRes?.success) {
        setAssistantStatus(`✅ 讲稿已生成${filterMsg}（${draftScript.length} 字）· 已自动保存为草稿（lesson #${saveRes.data?.lessonId || currentLessonId}）。可在右侧对话框 AI 改稿，或在 ⑧ 点「确认本节讲稿」定稿。`);
      } else {
        setAssistantStatus(`✅ 讲稿已生成${filterMsg}（${draftScript.length} 字）· ⚠ 自动保存失败：${saveRes?.error || '未知'}，请尽快点「💾 保存本节」`);
      }
    } catch (e) {
      console.error('[onGenerateDraft] 异常:', e);
      window.alert(`💥 生成异常：${e.message}\n\n查看 DevTools 控制台（F12）获取完整堆栈`);
      setAssistantStatus(`💥 异常：${e.message}`);
    }
  };

  // ── ② 生成正式稿（基于老师改后的 priorDraft）─────────────
  // P1.1e 重构（2026-05-17）：入参从 drafts/preferred 改为 priorDraft
  const onGenerateFormal = async () => {
    if (!selectedNotebookId) return;
    if (typeof api.lessonGenerateFormalV2 !== 'function') {
      window.alert('❌ api.lessonGenerateFormalV2 不存在 — 需要完整重启 Electron');
      return;
    }
    // v4.3.0 D6.2：质检入参优先取 finalScript（一步出稿后即写入），回退 draftScript / 老 drafts
    const priorDraft = String(
      lessonForm.finalScript || lessonForm.draftScript || lessonForm.drafts?.[lessonForm.selectedDraft || 'a'] || ''
    ).trim();
    if (!priorDraft || priorDraft.length < 200) {
      window.alert('请先点「🤖 生成讲稿」生成正式稿后，再走 9 维度质检');
      return;
    }
    setAssistantStatus('🤖 正在生成正式稿（含 9 维度质量审核，约 30-90 秒）...');
    try {
      const res = await api.lessonGenerateFormalV2({
        notebookId: selectedNotebookId,
        lessonMeta: {
          lessonNumber: lessonForm.lessonNumber,
          topic: lessonForm.topic,
          chapter: lessonForm.chapter,
          theoryHours: lessonForm.theoryHours,
          practiceHours: lessonForm.practiceHours,
          weekRange: lessonForm.weekRange,
        },
        priorDraft,
        referenceMaterials: lessonForm.referenceMaterials,
      });
      if (!res?.success) {
        window.alert(`生成失败：${res?.error || '未知'}`);
        setAssistantStatus(`❌ 生成失败：${res?.error || '未知'}`);
        return;
      }
      setLessonForm((prev) => ({
        ...prev,
        finalScript: res.data?.finalScript || '',
        audit: res.data?.audit || prev.audit,
        qualityMeta: res.data?.qualityMeta || null,
        referenceFilterAudit: res.data?.referenceFilterAudit || prev.referenceFilterAudit,
      }));
      const q = res.data?.qualityMeta || {};
      const reviewScore = q.reviewScore || 0;
      setAssistantStatus(
        `✅ 正式稿已生成（${(res.data?.finalScript || '').length} 字）` +
        (reviewScore ? `，质量分 ${reviewScore}/10` : '') +
        (q.revisedByReview ? '（AI 已自动修订）' : '') +
        (q.attempts > 1 ? `（重试 ${q.attempts} 次）` : '')
      );
    } catch (e) {
      console.error('[onGenerateFormal] 异常:', e);
      window.alert(`💥 异常：${e.message}\n\n查看 DevTools 控制台`);
      setAssistantStatus(`💥 异常：${e.message}`);
    }
  };

  // P1.1e（2026-05-17）：向后兼容老 UI 引用名 onGenerateABC
  const onGenerateABC = onGenerateDraft;

  // D8（2026-05-18）：共用的"静默自动保存"helper，避免 generate/patch/paste 三处重复
  const autoSaveDraft = async (formSnapshot, reasonLabel = '自动保存') => {
    if (!selectedNotebookId) return null;
    try {
      const saveRes = await api.lessonSaveV2({
        notebookId: selectedNotebookId,
        lessonId: currentLessonId || undefined,
        metadata: {
          lessonNumber: formSnapshot.lessonNumber,
          topic: formSnapshot.topic,
          chapter: formSnapshot.chapter,
          theoryHours: formSnapshot.theoryHours,
          practiceHours: formSnapshot.practiceHours,
          weekRange: formSnapshot.weekRange,
        },
        content: {
          draftScript: formSnapshot.draftScript,
          finalScript: formSnapshot.finalScript,
          drafts: formSnapshot.drafts,
          selectedDraft: formSnapshot.selectedDraft,
          referenceMaterials: formSnapshot.referenceMaterials,
          referenceFilterAudit: formSnapshot.referenceFilterAudit,
          qualityMeta: formSnapshot.qualityMeta,
        },
      });
      if (saveRes?.success && saveRes.data?.lessonId && !currentLessonId) {
        setCurrentLessonId(saveRes.data.lessonId);
        await refreshLessons();
      }
      return saveRes;
    } catch (e) {
      console.error(`[autoSaveDraft·${reasonLabel}] 失败:`, e);
      return { success: false, error: e.message };
    }
  };

  // ── 老师手搓正式稿：粘贴文本 ──────────────────────────────────
  const onApplyManualPaste = async () => {
    if (!manualPasteText.trim()) {
      window.alert('请先粘贴正式稿内容');
      return;
    }
    if (lessonForm.finalScript && !window.confirm(`将覆盖现有正式稿（${lessonForm.finalScript.length} 字），确定继续？`)) {
      return;
    }
    const text = manualPasteText.trim();
    const nextForm = {
      ...lessonForm,
      finalScript: text,
      qualityMeta: { ...lessonForm.qualityMeta, manualOverride: true, manualLength: text.length },
    };
    setLessonForm(nextForm);
    setShowManualPaste(false);
    setManualPasteText('');
    // D8 自动保存
    const saveRes = await autoSaveDraft(nextForm, '手贴正式稿');
    if (saveRes?.success) {
      setAssistantStatus(`✅ 已用老师手写稿替换正式稿（${text.length} 字）· 已自动保存为草稿`);
    } else {
      setAssistantStatus(`✅ 已替换正式稿（${text.length} 字），⚠ 自动保存失败：${saveRes?.error || '未知'}，请尽快点「💾 保存本节」`);
    }
  };

  // ── 老师手搓正式稿：上传 .docx 文件 ──────────────────────────
  const onUploadFinalScript = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (lessonForm.finalScript && !window.confirm(`将覆盖现有正式稿（${lessonForm.finalScript.length} 字），确定继续？`)) {
      e.target.value = '';
      return;
    }
    setAssistantStatus(`正在解析 ${file.name}...`);
    try {
      let text = '';
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.docx')) {
        // 2026-05-15 v4.1.4 bug fix：原代码传 {buffer: Array}，但 IPC handler 期望 {base64, filename}
        //   所以 docx 上传一直返回"文件内容为空"。修正为 base64。
        const buffer = await file.arrayBuffer();
        const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        const res = await api.readDocxContent({ base64, filename: file.name });
        if (!res?.success) { window.alert(`解析失败：${res?.error || '未知'}`); return; }
        text = res.data?.text || '';
      } else if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
        text = await file.text();
      } else {
        window.alert(`❌ 正式稿仅支持 .docx / .txt / .md，请转换后上传。`);
        return;
      }
      if (!text.trim()) { window.alert('文件内容为空'); return; }
      const finalText = text.trim();
      const nextForm = {
        ...lessonForm,
        finalScript: finalText,
        qualityMeta: { ...lessonForm.qualityMeta, manualOverride: true, manualSource: file.name, manualLength: finalText.length },
      };
      setLessonForm(nextForm);
      // D8 自动保存
      const saveRes = await autoSaveDraft(nextForm, '上传正式稿');
      if (saveRes?.success) {
        setAssistantStatus(`✅ 已用 ${file.name} 替换正式稿（${finalText.length} 字）· 已自动保存为草稿`);
      } else {
        setAssistantStatus(`✅ 已替换正式稿（${finalText.length} 字），⚠ 自动保存失败：${saveRes?.error || '未知'}，请尽快点「💾 保存本节」`);
      }
    } finally {
      e.target.value = '';
    }
  };

  // ── 确认 / 导出 ─────────────────────────────────────────────
  const onConfirm = async () => {
    if (!currentLessonId) { window.alert('请先保存节课，然后再确认'); return; }
    const res = await api.lessonConfirmV2({ lessonId: currentLessonId });
    if (!res?.success) { window.alert(`确认失败：${res?.error || '未知'}`); return; }
    await refreshLessons();
    setAssistantStatus('✅ 本节讲稿已确认');
  };
  const onExportWord = async () => {
    if (!currentLessonId) { window.alert('请先保存节课，然后再导出'); return; }
    setAssistantStatus('正在导出本节讲稿 Word...');
    const res = await api.lessonExportWordV2({ lessonId: currentLessonId });
    if (res?.cancelled) { setAssistantStatus('已取消导出'); return; }
    if (!res?.success) { window.alert(`导出失败：${res?.error || '未知'}`); return; }
    setAssistantStatus(`✅ 已导出：${res.data?.filePath || ''}`);
  };

  // ── 渲染 ─────────────────────────────────────────────────────
  return (
    <section className="v2-stage-layout" style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', minHeight: 'calc(100vh - 200px)' }}>
      <div className="v2-stage-center" style={{ flex: '1 1 auto', minWidth: 0, overflow: 'auto' }}>
        {/* ① 顶部 tab 条 */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>课堂讲稿（多节课模式）</h3>
            <span className="v2-hint">每节课 ≤ 4 学时，可分理论+实践</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {lessons.map((l) => (
              <button
                key={l.id}
                onClick={() => loadLesson(l.id)}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                  background: currentLessonId === l.id ? '#3b82f6' : (l.confirmed ? '#dcfce7' : '#f3f4f6'),
                  color: currentLessonId === l.id ? 'white' : (l.confirmed ? '#166534' : '#374151'),
                  border: currentLessonId === l.id ? 'none' : '1px solid #e5e7eb',
                  fontWeight: currentLessonId === l.id ? 600 : 400,
                }}
                title={`${l.topic || '未命名'} · ${l.theoryHours + l.practiceHours} 学时`}
              >
                {l.confirmed ? '✓ ' : ''}第 {l.lessonNumber} 节
              </button>
            ))}
            <button
              onClick={() => loadLesson(null)}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                background: currentLessonId === null ? '#3b82f6' : 'white',
                color: currentLessonId === null ? 'white' : '#3b82f6',
                border: '1px dashed #3b82f6',
                fontWeight: 600,
              }}
            >+ 新建节课</button>
            <div style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>
              学时进度：<strong style={{ color: usedHours > totalCourseHours ? '#dc2626' : '#16a34a' }}>{usedHours}</strong> / {totalCourseHours}
            </div>
          </div>
          <div className="v2-status-box v2-field-top-gap">
            <span>助手状态</span>
            <strong>{assistantStatus}</strong>
          </div>
        </div>

        {/* v4.3.0 D7（2026-05-18）：PPT 骨架选择 + 自动预填提示 */}
        <div style={{
          marginTop: 8, padding: 12,
          background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 6,
          fontSize: 13, color: '#065f46',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <strong>📑 PPT 骨架来源：</strong>
            <select
              value={selectedPptId || ''}
              onChange={(e) => onPickPptSkeleton(e.target.value)}
              style={{ flex: 1, minWidth: 320, padding: '6px 8px', fontSize: 13, border: '1px solid #34d399', borderRadius: 4 }}
              disabled={pptOptions.length === 0}
            >
              {pptOptions.length === 0
                ? <option value="">⚠ 上游 PPT 阶段还没确认课件 — 请先回到 PPT 阶段生成并确认</option>
                : pptOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.confirmed ? '✓ ' : ''}{p.title}（第 {p.lessonMeta.lessonNumber || '?'} 节 · {p.pageCount} 页 · {(p.lessonMeta.theoryHours || 0) + (p.lessonMeta.practiceHours || 0)} 学时）
                    </option>
                  ))
              }
            </select>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
            💡 <strong>本节信息已自动从所选 PPT 课件预填</strong>（主题 / 章节 / 学时 / 周次）。AI 生成讲稿时会以**每页 PPT 为口播段落骨架**展开。如果信息有误，可以在下方手改后保存。
          </div>
        </div>

        {/* 2026-05-15 老师反馈 4.6：在讲稿页面顶部固定显示"章节定位"横幅，方便老师对照进度表 */}
        {lessonForm.topic || lessonForm.chapter ? (
          <div style={{
            marginTop: 8, padding: '10px 14px',
            background: 'linear-gradient(90deg, #fef3c7 0%, #fef9c3 100%)',
            border: '1px solid #fcd34d', borderRadius: 6,
            fontSize: 13, color: '#78350f',
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            <strong style={{ fontSize: 14 }}>📍 当前节课定位</strong>
            {lessonForm.lessonNumber ? <span>第 <strong>{lessonForm.lessonNumber}</strong> 节</span> : null}
            {lessonForm.chapter ? <span>章节：<strong>{lessonForm.chapter}</strong></span> : null}
            {lessonForm.weekRange ? <span>周次：<strong>{lessonForm.weekRange}</strong></span> : null}
            {lessonForm.topic ? <span style={{ flex: 1, minWidth: 200 }}>主题：<strong>{lessonForm.topic}</strong></span> : null}
            <span style={{ color: '#92400e', fontSize: 12 }}>
              理论 {lessonForm.theoryHours || 0} + 实践 {lessonForm.practiceHours || 0} = {(Number(lessonForm.theoryHours) || 0) + (Number(lessonForm.practiceHours) || 0)} 学时
            </span>
          </div>
        ) : null}

        {/* ② 本节基础信息 */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>本节基础信息（必填）</h3>
            <span className="v2-hint">主题决定 AI 生成范围；学时影响讲稿详略</span>
          </div>
          <div className="v2-grid-two">
            <div>
              <label className="v2-label">本节主题 <span style={{ color: '#dc2626' }}>*</span></label>
              <input
                value={lessonForm.topic}
                onChange={(e) => setLessonForm((p) => ({ ...p, topic: e.target.value }))}
                placeholder="如：服装产品传播起源与发展历程"
              />
            </div>
            <div>
              <label className="v2-label">关联章节（可从进度表选）</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={lessonForm.chapter}
                  onChange={(e) => setLessonForm((p) => ({ ...p, chapter: e.target.value }))}
                  placeholder="如：一"
                  style={{ flex: 1 }}
                />
                <select
                  onChange={(e) => onPickFromSchedule(e.target.value)}
                  value=""
                  style={{ width: 260 }}
                  title="从进度表拉取章节 + 主题"
                >
                  <option value="">从进度表拉取...</option>
                  {chaptersFromSchedule.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="v2-label">理论学时</label>
              <input
                type="number" min={0} max={4} step={0.5}
                value={lessonForm.theoryHours}
                onChange={(e) => setLessonForm((p) => ({ ...p, theoryHours: Number(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <label className="v2-label">实践学时</label>
              <input
                type="number" min={0} max={4} step={0.5}
                value={lessonForm.practiceHours}
                onChange={(e) => setLessonForm((p) => ({ ...p, practiceHours: Number(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <label className="v2-label">周次范围（可选）</label>
              <input
                value={lessonForm.weekRange}
                onChange={(e) => setLessonForm((p) => ({ ...p, weekRange: e.target.value }))}
                placeholder="如：第 3-4 周"
              />
            </div>
            <div>
              <label className="v2-label">本节合计</label>
              <input
                value={`${lessonHours} 学时${lessonHours > 4 ? '（⚠ 超 4 学时）' : ''}`}
                disabled
                style={{ color: lessonHours > 4 ? '#dc2626' : '#374151' }}
              />
            </div>
          </div>
          {willExceed ? (
            <div style={{ marginTop: 8, padding: 10, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, fontSize: 13, color: '#92400e' }}>
              ⚠ 本节加上已用 {usedHours} 学时将超总学时 {totalCourseHours}（仅警告，老师可自行调度）
            </div>
          ) : null}
        </div>

        {/* ③ 教学素材 */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>③ 教学素材辅助生成（可选 · 来源 PPT 上游 + 老师补充）</h3>
            <span className="v2-hint">
              URL 抓取 / 文件上传 / 粘贴文本，AI 会与 PPT 骨架深度融合
              <br />
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                ✓ 支持：.docx / .pptx / .pdf（数字版）/ .txt / .md / .csv / .json / .html / .rtf · ❌ 暂不支持：老 .doc / .xlsx / 扫描版 PDF（请用截图走右侧 OCR）
              </span>
            </span>
          </div>

          <label className="v2-label">
            输入页面 URL
            <span className="v2-label-hint">一次只能抓 1 个 URL · SPA 站点（britannica/medium 等）建议改用粘贴文本</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={refUrlInput}
              onChange={(e) => setRefUrlInput(e.target.value)}
              placeholder="例：https://www.iyiou.com/news/xxx（一次一个，多个请分次添加）"
              style={{ flex: 1 }}
            />
            <button className="v2-btn v2-btn-secondary" onClick={fetchUrl}>抓取</button>
            <label className="v2-btn v2-btn-secondary" style={{ cursor: 'pointer' }}>
              📎 上传文件
              {/* D6.4（2026-05-18）：加 .pdf（数字版）和 .pptx 支持，扫描版 PDF 走右侧 OCR */}
              <input
                type="file"
                accept=".docx,.pptx,.pdf,.txt,.md,.csv,.json,.html,.htm,.rtf,.log"
                style={{ display: 'none' }}
                onChange={onUploadFile}
                title="支持 .docx / .pptx / .pdf（数字版）/ .txt / .md / .csv / .json / .html / .htm / .rtf / .log（扫描版 PDF 请用右侧 OCR）"
              />
            </label>
          </div>

          <label className="v2-label v2-field-top-gap">粘贴参考文本</label>
          <textarea
            rows={3}
            value={refTextInput}
            onChange={(e) => setRefTextInput(e.target.value)}
            placeholder="粘贴教案/教材/课标段落，最多 10000 字。点击下方按钮添加到素材列表。"
          />
          <div className="v2-inline-actions v2-field-top-gap">
            <button className="v2-btn v2-btn-secondary" onClick={addPastedText} disabled={!refTextInput.trim()}>
              + 添加到素材列表
            </button>
          </div>

          {lessonForm.referenceMaterials.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>
                本节素材列表（{lessonForm.referenceMaterials.length} 条 · 合计 {lessonForm.referenceMaterials.reduce((s, m) => s + (m.content || '').length, 0)} 字）
              </h4>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {lessonForm.referenceMaterials.map((m, i) => {
                  const chars = (m.content || '').length;
                  const empty = chars === 0;
                  const label = m.kind === 'url' ? '🔗 URL' : m.kind === 'file' ? '📎 文件' : '📝 文本';
                  const head = m.url || m.filename || '（手贴文本）';
                  const headShort = head.length > 70 ? head.slice(0, 70) + '...' : head;
                  // 抓到 0 字 → 红色警告条；< 100 字 → 黄色；正常 → 绿色 chip
                  const statusColor = empty ? '#dc2626' : chars < 100 ? '#ca8a04' : '#16a34a';
                  const statusBg = empty ? '#fef2f2' : chars < 100 ? '#fefce8' : '#f0fdf4';
                  const statusText = empty ? '❌ 0 字（抓取失败 / 无正文）' : chars < 100 ? `⚠ ${chars} 字（过短）` : `✓ ${chars} 字`;
                  return (
                    <li key={i} style={{
                      padding: 8, background: statusBg, border: `1px solid ${empty ? '#fca5a5' : chars < 100 ? '#fde68a' : '#bbf7d0'}`,
                      borderRadius: 4, marginBottom: 4, fontSize: 12,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={head}>
                          [{label}]&nbsp;{headShort}
                        </div>
                        <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{
                            padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                            background: 'white', color: statusColor, border: `1px solid ${statusColor}`,
                          }}>{statusText}</span>
                          {!empty ? (
                            <span style={{ fontSize: 10, color: '#64748b' }}>
                              预览：{(m.content || '').slice(0, 60).replace(/\s+/g, ' ')}{chars > 60 ? '…' : ''}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        onClick={() => removeMaterial(i)}
                        style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                      >✕ 删除</button>
                    </li>
                  );
                })}
              </ul>
              {lessonForm.referenceMaterials.some((m) => (m.content || '').length === 0) ? (
                <div style={{ marginTop: 6, padding: 6, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, fontSize: 11, color: '#991b1b' }}>
                  ⚠ 上述含 0 字素材：抓取/上传失败或网站封锁，AI 生成讲稿时无可用内容。建议删除或改用「📋 粘贴参考文本」手动补内容。
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ④ 生成讲稿（一步初稿）—— D6.2 单步出稿 */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>④ 生成讲稿（一步初稿）</h3>
            <span className="v2-hint">PPT 骨架 100% 决定段落节奏；素材 80% 决定内容深度</span>
          </div>
          <div className="v2-inline-actions" style={{ marginTop: 8 }}>
            <button className="v2-btn v2-btn-primary" onClick={onGenerateDraft} disabled={busy} style={{ fontSize: 15, padding: '10px 24px' }}>
              🤖 生成讲稿（一步出稿）
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={onSave} disabled={saving}>
              {saving ? '⏳ 保存中…' : '💾 保存本节'}
            </button>
          </div>

          {/* v4.3.0 D6.2：可选 9 维度质检（默认不调用） */}
          <details style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            <summary style={{ cursor: 'pointer' }}>⚙ 高级：可选 9 维度质量审核（耗时 30-90 秒）</summary>
            <div style={{ marginTop: 6, padding: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4 }}>
              <p style={{ margin: '0 0 8px 0' }}>
                如需对当前正式稿走 9 维度质量审核 + AI 自动修订，点下面按钮。<strong>不是必须</strong>——大部分情况用右侧 AI 对话框迭代修改更高效。
              </p>
              <button
                className="v2-btn v2-btn-xs v2-btn-secondary"
                onClick={onGenerateFormal}
                disabled={busy || !(lessonForm.finalScript || lessonForm.draftScript)}
              >
                走 9 维度质检（基于当前正式稿）
              </button>
            </div>
          </details>
        </div>

        {/* ⑤ + ⑥ 正式稿预览 + AI 对话占位（指向右侧 380px 面板） */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>⑤ 正式稿预览 · ⑥ AI 对话修改</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="v2-hint">下方文本框 = 正式稿；右侧 AI 对话框可对它做局部修改</span>
              {/* v4.3.3 新版 · 讲稿最大化阅读模式（带大字号 + 行距）*/}
              {lessonForm.finalScript ? (
                <PreviewFullscreenToggle
                  isFullscreen={lecturePreviewFs}
                  onToggle={setLecturePreviewFs}
                  label="最大化阅读"
                />
              ) : null}
              {/* v4.3.3 功能5（老师反馈）· 周老师朗读试听（Web Speech API，语速可调）*/}
              {lessonForm.finalScript ? (
                <button
                  type="button"
                  className="v2-btn v2-btn-xs v2-btn-secondary"
                  onClick={() => setReaderOpen(true)}
                  title="周老师按真人语速朗读正式稿，帮你打磨课堂节奏"
                >🔊 周老师朗读</button>
              ) : null}
            </div>
          </div>
          <div style={{
            marginTop: 8, padding: 12,
            background: 'linear-gradient(90deg, #eff6ff 0%, #f0fdf4 100%)',
            border: '1px dashed #93c5fd', borderRadius: 6,
            fontSize: 13, color: '#1e40af',
          }}>
            <strong>↗ 想改讲稿？</strong> 在<strong>右侧 AI 对话框</strong>输入指令（如「把第 3 页改得更口语化」「整体减少 30% 字数」「把刚上传的素材整合到第 5 段」），AI 会返回完整新稿。
            修改历史保留在右侧面板下方，老师随时可回看。
          </div>
          {/* 正式稿编辑器（实时同步 finalScript）— 大窗预览模式 */}
          {lessonForm.finalScript ? (
            <div className="v2-field-top-gap">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h4 style={{ fontSize: 13, color: '#374151', margin: 0 }}>
                  正式稿（{lessonForm.finalScript.length} 字 · 可直接手改后点上方「💾 保存本节」）
                </h4>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  💡 文本框右下角可拖拽放大（上下 + 左右）
                </span>
              </div>
              {lessonForm.qualityMeta?.manualOverride ? (
                <div style={{
                  marginBottom: 8, padding: 10,
                  background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, fontSize: 12,
                  color: '#166534',
                }}>
                  ⭐ 当前为老师手写版（{lessonForm.qualityMeta.manualLength || lessonForm.finalScript.length} 字
                  {lessonForm.qualityMeta.manualSource ? `，来源：${lessonForm.qualityMeta.manualSource}` : ''}）
                </div>
              ) : null}
              {/* wrapper 提供初始宽度；textarea 自身负责 resize，不被 React width:100% 覆盖 */}
              <div style={{ width: '100%' }}>
                <textarea
                  className="v2-final-script-editor"
                  value={lessonForm.finalScript}
                  onChange={(e) => setLessonForm((p) => ({ ...p, finalScript: e.target.value }))}
                  /* 注意：style 里 NEVER 设 width / height，由 CSS 给初始值 + 用户拖拽 */
                />
              </div>
            </div>
          ) : (
            <div style={{
              marginTop: 8, padding: 14, textAlign: 'center',
              background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 6,
              color: '#64748b', fontSize: 13,
            }}>
              📝 正式稿尚未生成。请先在上方点「🤖 生成讲稿（一步出稿）」或在 ⑦ 老师手搓正式稿区导入手写版。
            </div>
          )}
        </div>

        {/* ⑦ 老师手搓正式稿（绕过 AI） */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>⑦ 老师手搓正式稿（绕过 AI · 可选）</h3>
            <span className="v2-hint">如 AI 不达标，可粘贴或上传 .docx 直接替换</span>
          </div>
          <div style={{
            marginTop: 8, padding: 10,
            background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6,
          }}>
            <div style={{ fontSize: 12, color: '#7c2d12', marginBottom: 8 }}>
              在 Word 里手写一版，然后通过下方两种方式导入到正式稿区。导入后点「保存本节」+「⑧ 确认本节讲稿」即可作为最终版导出。
            </div>
            <div className="v2-inline-actions">
              <button
                className="v2-btn v2-btn-secondary"
                onClick={() => { setShowManualPaste(true); setManualPasteText(lessonForm.finalScript || ''); }}
              >📋 粘贴正式稿（替换当前版本）</button>
              <label className="v2-btn v2-btn-secondary" style={{ cursor: 'pointer' }}>
                📎 上传 .docx 作为正式稿
                <input type="file" accept=".docx,.txt,.md" style={{ display: 'none' }} onChange={onUploadFinalScript} />
              </label>
              {lessonForm.qualityMeta?.manualOverride ? (
                <span style={{ fontSize: 12, color: '#16a34a', alignSelf: 'center' }}>
                  ⭐ 当前为老师手写版（{lessonForm.qualityMeta.manualSource ? `来源：${lessonForm.qualityMeta.manualSource}` : '已替换 AI 版'}）
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* ⑧ 正式稿确认与输出 */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>⑧ 正式稿确认与输出</h3>
            <span className="v2-hint">确认后下游 PPT/视频/报告才能引用本节讲稿</span>
          </div>
          <div className="v2-inline-actions" style={{ marginTop: 8 }}>
            <button
              className="v2-btn v2-btn-primary"
              onClick={onConfirm}
              disabled={!currentLessonId}
              style={{ fontSize: 14, padding: '8px 18px' }}
            >
              {lessonForm.confirmed ? '✓ 已确认本节讲稿' : '✓ 确认本节讲稿'}
            </button>
            <button className="v2-btn v2-btn-secondary" onClick={onExportWord} disabled={!currentLessonId}>
              📄 导出 Word
            </button>
          </div>
        </div>

        {/* === 杂项面板：素材审计 / 历史草稿（保留但低权重） === */}
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>📊 进阶诊断（默认折叠）</h3>
            <span className="v2-hint">素材相关性审计 · 历史草稿对照</span>
          </div>

          {/* 2026-05-15 P2-2：素材相关性审计面板（折叠） */}
          {lessonForm.referenceFilterAudit && Array.isArray(lessonForm.referenceFilterAudit.details) && lessonForm.referenceFilterAudit.details.length > 0 ? (
            <details className="v2-field-top-gap" style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#1e3a8a' }}>
                📊 素材相关性审计（保留 {lessonForm.referenceFilterAudit.kept} 条 / 剔除 {lessonForm.referenceFilterAudit.dropped} 条 · 点击展开）
              </summary>
              <div style={{ marginTop: 10 }}>
                {lessonForm.referenceFilterAudit.warning ? (
                  <div style={{ padding: 8, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, fontSize: 12, color: '#78350f', marginBottom: 8 }}>
                    ⚠ {lessonForm.referenceFilterAudit.warning}
                  </div>
                ) : null}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#e0e7ff', color: '#1e3a8a' }}>
                      <th style={{ padding: '6px 8px', border: '1px solid #c7d2fe', width: 40 }}>#</th>
                      <th style={{ padding: '6px 8px', border: '1px solid #c7d2fe' }}>素材</th>
                      <th style={{ padding: '6px 8px', border: '1px solid #c7d2fe', width: 80 }}>相关分</th>
                      <th style={{ padding: '6px 8px', border: '1px solid #c7d2fe' }}>原因</th>
                      <th style={{ padding: '6px 8px', border: '1px solid #c7d2fe', width: 80 }}>处理</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lessonForm.referenceFilterAudit.details.map((d, i) => {
                      const label = d.ref?.url || d.ref?.filename || `素材 ${d.idx}`;
                      const scoreColor = d.relevance >= 7 ? '#16a34a' : d.relevance >= 5 ? '#ca8a04' : '#dc2626';
                      return (
                        <tr key={i} style={{ background: d.kept ? 'white' : '#fef2f2' }}>
                          <td style={{ padding: '6px 8px', border: '1px solid #e5e7eb', textAlign: 'center' }}>{d.idx}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #e5e7eb', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>
                            {label.length > 50 ? label.slice(0, 50) + '...' : label}
                          </td>
                          <td style={{ padding: '6px 8px', border: '1px solid #e5e7eb', textAlign: 'center', color: scoreColor, fontWeight: 700 }}>
                            {d.relevance} / 10
                          </td>
                          <td style={{ padding: '6px 8px', border: '1px solid #e5e7eb', color: '#475569' }}>{d.reason || '-'}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #e5e7eb', textAlign: 'center', fontWeight: 600, color: d.kept ? '#16a34a' : '#dc2626' }}>
                            {d.kept ? '✅ 保留' : '❌ 剔除'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>
                  💡 系统会自动剔除与本课主题不相关的素材（分数 &lt; 5）。如某素材你认为应保留，可在下方"参考素材"区重新添加并强调主题。
                </p>
              </div>
            </details>
          ) : null}

          {/* v4.3.0 D6.2/D7（2026-05-18）：A/B/C 候选稿 UI 已废弃，统一为一步出稿；
              此处不再渲染选稿三栏，避免老师误以为还有 ABC 流程 */}

          {/* AI 质量评分诊断（仅 AI 生成且未手写覆盖时显示，保留在 进阶诊断 panel 中作为可选诊断） */}
          {lessonForm.finalScript && lessonForm.qualityMeta && !lessonForm.qualityMeta.manualOverride ? (
            <div className="v2-field-top-gap">
              <h4 style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>AI 讲稿质量评分（9 维度审核结果）</h4>
              {true ? (
                <div style={{
                  marginBottom: 8, padding: 12,
                  background: (lessonForm.qualityMeta.reviewScore || 0) >= 8 ? '#f0fdf4' : (lessonForm.qualityMeta.reviewScore || 0) >= 7 ? '#fefce8' : '#fef2f2',
                  border: '1px solid ' + ((lessonForm.qualityMeta.reviewScore || 0) >= 8 ? '#86efac' : (lessonForm.qualityMeta.reviewScore || 0) >= 7 ? '#fde68a' : '#fca5a5'),
                  borderRadius: 6, fontSize: 12,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <strong style={{ color: '#1f2937', fontSize: 13 }}>📊 AI 讲稿质量评分</strong>
                    <span style={{ fontWeight: 700, color: (lessonForm.qualityMeta.reviewScore || 0) >= 8 ? '#16a34a' : (lessonForm.qualityMeta.reviewScore || 0) >= 7 ? '#ca8a04' : '#dc2626' }}>
                      综合 {lessonForm.qualityMeta.reviewScore || 'N/A'} / 10 分
                      {(lessonForm.qualityMeta.reviewScore || 0) >= 8 ? ' ✅ 优秀' : (lessonForm.qualityMeta.reviewScore || 0) >= 7 ? ' ⚠ 合格' : ' ❌ 待改进'}
                    </span>
                  </div>

                  {/* 子项分数中文化 */}
                  {lessonForm.qualityMeta.reviewSubscores ? (() => {
                    const NAMES = {
                      referenceFusionDepth: '素材融合深度',
                      fiveStepTransform: '五段教学转化',
                      timelineConsistency: '课时连贯性',
                      copyrightSafety: '版权安全',
                      topicCoherence: '主题相关度',
                    };
                    const subs = lessonForm.qualityMeta.reviewSubscores;
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                        {Object.entries(subs).map(([k, v]) => {
                          const label = NAMES[k] || k;
                          const score = Number(v);
                          if (score < 0) return null;  // -1 = 无素材，不展示
                          const color = score >= 7 ? '#16a34a' : score >= 5 ? '#ca8a04' : '#dc2626';
                          return (
                            <span key={k} style={{
                              padding: '2px 8px', borderRadius: 4,
                              background: '#fff', border: `1px solid ${color}`, color, fontSize: 11,
                            }}>
                              {label} <strong>{score}/10</strong>
                            </span>
                          );
                        })}
                      </div>
                    );
                  })() : null}

                  {/* AI 总结一句话（如有）*/}
                  {lessonForm.qualityMeta.reviewSummary ? (
                    <div style={{
                      marginTop: 6, padding: 8,
                      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4,
                      color: '#374151', fontSize: 11,
                    }}>
                      💬 <strong>AI 评语：</strong>{lessonForm.qualityMeta.reviewSummary}
                    </div>
                  ) : null}

                  {/* 自动修订 + 重试提示 */}
                  {lessonForm.qualityMeta.revisedByReview ? (
                    <div style={{ marginTop: 6, color: '#7c2d12', fontSize: 11 }}>
                      ⚙ AI 已根据审核意见自动修订一次
                    </div>
                  ) : null}
                  {lessonForm.qualityMeta.attempts > 1 ? (
                    <div style={{ marginTop: 4, color: '#7c2d12', fontSize: 11 }}>
                      🔄 经过 {lessonForm.qualityMeta.attempts} 次自动重试
                    </div>
                  ) : null}

                  {/* 优化建议 — 评分 < 8 时默认展开 */}
                  {(() => {
                    const issues = lessonForm.qualityMeta.reviewIssues || [];
                    const suggestions = lessonForm.qualityMeta.reviewSuggestions || [];
                    const score = lessonForm.qualityMeta.reviewScore || 0;
                    if (issues.length === 0 && suggestions.length === 0) return null;
                    const shouldOpen = score < 8;
                    return (
                      <details open={shouldOpen} style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer', color: '#475569', fontWeight: 600 }}>
                          💡 优化建议（{issues.length + suggestions.length} 条）{shouldOpen ? '' : '— 点击展开'}
                        </summary>
                        <div style={{ margin: '6px 0 0 8px', fontSize: 11, lineHeight: 1.7 }}>
                          {issues.map((iss, i) => (
                            <div key={`is-${i}`} style={{ marginBottom: 6, padding: 6, background: '#fff', borderLeft: '3px solid #f59e0b', borderRadius: 3 }}>
                              <strong style={{ color: '#92400e' }}>📍 位置：{iss.location || '—'}</strong>
                              {iss.text ? <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>原文："{iss.text}"</div> : null}
                              <div style={{ color: '#1f2937', marginTop: 2 }}>👉 建议：{iss.fix || '—'}</div>
                            </div>
                          ))}
                          {suggestions.map((s, i) => (
                            <div key={`sg-${i}`} style={{ marginBottom: 4 }}>
                              <strong style={{ color: '#1e40af' }}>{i + 1}.</strong> {s}
                            </div>
                          ))}
                        </div>
                      </details>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* 粘贴正式稿模态框 */}
      {showManualPaste ? (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowManualPaste(false); }}
        >
          <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '85%', maxWidth: 900, maxHeight: '85%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: '#1f2937' }}>📋 粘贴正式稿到下方文本框</h3>
              <button
                style={{ padding: '4px 10px', fontSize: 13, background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
                onClick={() => setShowManualPaste(false)}
              >✕ 取消</button>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              支持从 Word/记事本/任何编辑器复制粘贴。粘贴后点底部"应用为正式稿"即可替换当前版本。
            </div>
            <textarea
              autoFocus
              rows={20}
              value={manualPasteText}
              onChange={(e) => setManualPasteText(e.target.value)}
              placeholder="把老师手写的完整正式讲稿粘贴到这里...（支持 Markdown 标题、列表等）"
              style={{
                flex: 1, padding: 12, fontSize: 13, fontFamily: 'Microsoft YaHei, sans-serif',
                border: '1px solid #d1d5db', borderRadius: 6, resize: 'none',
              }}
            />
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                字数：{manualPasteText.length}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={{ padding: '6px 14px', fontSize: 13, background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
                  onClick={() => setShowManualPaste(false)}
                >取消</button>
                <button
                  style={{ padding: '6px 14px', fontSize: 13, background: '#16a34a', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                  onClick={onApplyManualPaste}
                  disabled={!manualPasteText.trim()}
                >✓ 应用为正式稿</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 右侧栏 */}
      <div className="v2-stage-right">
        <div className="v2-panel">
          <div className="v2-panel-head">
            <h3>所有节课概览</h3>
          </div>
          {lessons.length === 0 ? <p className="v2-hint">尚未生成任何节课讲稿</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {lessons.map((l) => (
                <li
                  key={l.id}
                  style={{
                    padding: 8, marginBottom: 4, fontSize: 12, cursor: 'pointer',
                    background: currentLessonId === l.id ? '#eff6ff' : 'transparent',
                    borderLeft: l.confirmed ? '3px solid #16a34a' : '3px solid #d1d5db',
                  }}
                  onClick={() => loadLesson(l.id)}
                >
                  <div style={{ fontWeight: 600 }}>{l.confirmed ? '✓ ' : ''}第 {l.lessonNumber} 节 · {l.topic || '未命名'}</div>
                  <div style={{ color: '#6b7280', fontSize: 11 }}>
                    {l.chapter ? `章节 ${l.chapter} · ` : ''}{l.theoryHours + l.practiceHours} 学时
                    {l.weekRange ? ` · ${l.weekRange}` : ''}
                  </div>
                  {/* 2026-05-16 v4.1.4：识别 metadata 异常（lessonNumber=0 或 学时=0），给出修复入口 */}
                  {(!l.lessonNumber || (l.theoryHours + l.practiceHours) === 0) ? (
                    <button
                      className="v2-btn v2-btn-xs"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!window.confirm('检测到本节 metadata 异常（节次/学时为 0）。\n要尝试从 title 反推修复吗？')) return;
                        try {
                          const res = await api.lessonRepairMetaFromTitleV2({
                            notebookId: selectedNotebookId,
                            lessonId: l.id,
                          });
                          if (res?.success) {
                            window.alert(`✅ 修复成功：第 ${res.data.metadata.lessonNumber} 节 · ${res.data.metadata.topic} · ${res.data.metadata.theoryHours + res.data.metadata.practiceHours} 学时`);
                            refreshLessons();
                          } else {
                            window.alert(`修复失败：${res?.error || '未知'}`);
                          }
                        } catch (err) {
                          window.alert(`修复异常：${err.message}`);
                        }
                      }}
                      style={{ marginTop: 4, background: '#fef3c7', borderColor: '#f59e0b', color: '#b45309' }}
                      title="从 title 字符串反推 lessonNumber / topic / 学时"
                    >🛠 修复 metadata</button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <ArtifactPanel
          artifacts={artifacts}
          title="讲稿产物"
          hint="lecture_final / lecture_export_word"
          onOpenFile={(storagePath) => api.openResource(storagePath)}
          onViewArtifact={async (item) => {
            // 👁 只读查看：从 DB 拉完整 content，弹 modal 展示
            if (item.type !== 'lecture_final') {
              if (item.storagePath) api.openResource(item.storagePath);
              return;
            }
            try {
              const res = await api.lessonGetV2({ lessonId: item.id });
              if (!res?.success) {
                window.alert(`读取失败：${res?.error || '未知错误'}`);
                return;
              }
              const l = res.data?.lesson;
              const meta = l?.metadata || {};
              const finalScript = l?.content?.finalScript || '（讲稿正文为空）';
              setViewModal({
                title: `第 ${meta.lessonNumber || '?'} 节·${meta.topic || '未命名'}（${(meta.theoryHours || 0) + (meta.practiceHours || 0)}学时）`,
                content: finalScript,
                confirmed: !!l?.confirmed,
                createdAt: l?.createdAt,
              });
            } catch (e) {
              window.alert(`读取异常：${e.message}`);
            }
          }}
          onUnlockArtifact={async (item) => {
            if (item.type !== 'lecture_final') return;
            const ok = window.confirm(
              `确定要"解锁重编辑"《${item.title}》吗？\n\n` +
              `⚠ 这会清除确认状态（confirmed=false），你需要修改完后再次点击"确认"按钮。\n` +
              `下游的 PPT / 视频 / 报告会同步失去与本节的关联。`
            );
            if (!ok) return;
            try {
              // 通过 lessonSave 重置 status (不调 confirm)；前端载入到编辑器
              await loadLesson(item.id);
              // 解锁状态：用 lessonSaveV2 把 status 改回 draft / confirmed 改 false
              //   方式：再调一次 save，因为 save 默认 status:'draft', confirmed 不改
              //   这里更直接：调用一个轻量"unlock"接口；暂时先依赖 loadLesson 给老师改的体验
              window.scrollTo({ top: 0, behavior: 'smooth' });
              setAssistantStatus('已载入到上方编辑器，请修改后重新点「确认」。');
            } catch (e) {
              window.alert(`解锁失败：${e.message}`);
            }
          }}
          dt={dt}
        />
      </div>

      {/* v4.3.0 D6.3: 右侧 30% 辅助对话框 —— 上传素材 / 给 AI 指令 / 局部修改讲稿 */}
      <LectureChatPanel
        notebookId={selectedNotebookId}
        lessonMeta={{
          lessonNumber: lessonForm.lessonNumber,
          topic: lessonForm.topic,
          chapter: lessonForm.chapter,
          theoryHours: lessonForm.theoryHours,
          practiceHours: lessonForm.practiceHours,
          weekRange: lessonForm.weekRange,
        }}
        currentScript={lessonForm.finalScript || lessonForm.draftScript || ''}
        onScriptPatch={async (newScript) => {
          // D8：AI patch 后立刻自动保存，避免刷新丢失
          const nextForm = { ...lessonForm, finalScript: newScript };
          setLessonForm(nextForm);
          const saveRes = await autoSaveDraft(nextForm, 'AI chat patch');
          if (saveRes?.success) {
            setAssistantStatus(`✅ AI 修改已应用 · 自动保存为草稿（${newScript.length} 字）`);
          } else {
            setAssistantStatus(`✅ AI 修改已应用，⚠ 自动保存失败：${saveRes?.error || '未知'}`);
          }
        }}
      />

      {/* 2026-05-16 v4.1.4：讲稿只读查看 modal */}
      {viewModal ? (
        <div className="v2-modal-mask" onClick={() => setViewModal(null)}>
          <div className="v2-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880, width: '90%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="v2-panel-head">
              <h3>👁 讲稿内容（只读）· {viewModal.title}</h3>
              <button className="v2-btn v2-btn-xs" onClick={() => setViewModal(null)}>关闭</button>
            </div>
            <div style={{ marginBottom: 8, fontSize: 12, color: '#475569' }}>
              {viewModal.confirmed ? '✓ 已确认' : '草稿'}
              {viewModal.createdAt ? ` · ${dt(viewModal.createdAt)}` : ''}
            </div>
            <pre style={{
              flex: 1, overflow: 'auto', whiteSpace: 'pre-wrap',
              padding: 16, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8,
              fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit',
              maxHeight: 'calc(85vh - 120px)',
            }}>
              {viewModal.content}
            </pre>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="v2-btn v2-btn-secondary"
                onClick={() => navigator.clipboard?.writeText(viewModal.content)}
              >📋 复制全文</button>
              <button className="v2-btn v2-btn-primary" onClick={() => setViewModal(null)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* v4.3.3 新版 · 讲稿最大化阅读模式（大字号 + 行距 1.75） */}
      {lecturePreviewFs && lessonForm.finalScript ? (
        <PreviewFullscreen
          title={`讲稿正式稿 · 第 ${lessonForm.lessonNumber || '?'} 节《${lessonForm.topic || ''}》 · ${lessonForm.finalScript.length} 字`}
          onClose={() => setLecturePreviewFs(false)}
        >
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
            fontSize: 16,
            lineHeight: 1.85,
            color: '#1f2937',
            margin: 0,
          }}>{lessonForm.finalScript}</pre>
        </PreviewFullscreen>
      ) : null}

      {/* v4.3.3 功能5：周老师朗读讲稿正式稿（Web Speech API + 语速可调） */}
      <LectureReader
        open={readerOpen}
        script={lessonForm.finalScript}
        onClose={() => setReaderOpen(false)}
      />
    </section>
  );
}
