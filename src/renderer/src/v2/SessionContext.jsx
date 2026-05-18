/**
 * SessionContext.jsx — 2026-05-16 v4.2.0 Phase A
 *
 * React Context 包装会话上下文，提供 useSession() hook 给所有 stage 用。
 *
 * 核心承诺：
 *   - 老师在任何 stage 切节课 → 所有 stage 共享同一个 activeLessonNumber
 *   - 不再用 db.getLatestArtifact()，全用 session.activeXxxArtifactId
 *   - sessionContext 持久化到 notebook.sessionContext，重启 Electron 不丢
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const SessionCtx = createContext(null);

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) {
    throw new Error('useSession 必须在 <SessionProvider> 内调用');
  }
  return ctx;
}

export function SessionProvider({ api, notebookId, children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // 笔记本切换时重新加载 session
  useEffect(() => {
    let mounted = true;
    if (!notebookId) {
      setSession(null);
      setLoading(false);
      return () => { mounted = false; };
    }
    setLoading(true);
    api.getSessionContextV2(notebookId)
      .then((res) => {
        if (!mounted) return;
        if (res?.success) {
          setSession(res.data || null);
        } else {
          console.warn('[SessionProvider] 读取会话上下文失败:', res?.error);
          setSession(null);
        }
      })
      .catch((e) => {
        console.warn('[SessionProvider] 异常:', e);
        if (mounted) setSession(null);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [api, notebookId]);

  // 切节课（同步设计/讲稿/PPT active id）
  const switchLesson = useCallback(async (lessonNumber) => {
    if (!notebookId || !Number.isFinite(Number(lessonNumber))) return null;
    const res = await api.switchActiveLessonV2({ notebookId, lessonNumber: Number(lessonNumber) });
    if (res?.success) {
      setSession(res.data || null);
      return res.data;
    }
    console.warn('[SessionProvider] switchLesson 失败:', res?.error);
    return null;
  }, [api, notebookId]);

  // 切某个 artifact 当前版本
  const setActiveArtifact = useCallback(async (kind, artifactId) => {
    if (!notebookId) return null;
    const res = await api.setActiveArtifactV2({ notebookId, kind, artifactId: artifactId ? Number(artifactId) : null });
    if (res?.success) {
      setSession(res.data || null);
      return res.data;
    }
    return null;
  }, [api, notebookId]);

  // 部分字段更新
  const updateSession = useCallback(async (patch) => {
    if (!notebookId) return null;
    const res = await api.updateSessionContextV2({ notebookId, ...patch });
    if (res?.success) {
      setSession(res.data || null);
      return res.data;
    }
    return null;
  }, [api, notebookId]);

  // 强制重读（外部触发，比如保存后）
  const refreshSession = useCallback(async () => {
    if (!notebookId) return null;
    const res = await api.getSessionContextV2(notebookId);
    if (res?.success) {
      setSession(res.data || null);
      return res.data;
    }
    return null;
  }, [api, notebookId]);

  const value = {
    session,
    loading,
    notebookId,
    activeLessonNumber: session?.activeLessonNumber || 1,
    activeDesignArtifactId: session?.activeDesignArtifactId || null,
    activeLectureArtifactId: session?.activeLectureArtifactId || null,
    activePptOutlineId: session?.activePptOutlineId || null,
    activeMicroVideoId: session?.activeMicroVideoId || null,
    activeReportId: session?.activeReportId || null,
    switchLesson,
    setActiveArtifact,
    updateSession,
    refreshSession,
  };

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
