/**
 * useSession.js — v4.3.3 D11 + D12 联动（2026-05-18）
 *
 * 把分散在 V2App.jsx 4500 LOC 里的 selectedXxxArtifactId / activeLessonNumber 等
 * 局部 useState 收敛到**单一 DB 持久化**的 session hook。
 *
 * 提供 4 个方法：
 *   - useSession(api, notebookId)             → { session, refresh, isLoading }
 *   - switchActiveLesson(api, notebookId, lessonNumber) → 切节课（写 DB）
 *   - setActiveArtifact(api, notebookId, kind, artifactId) → 切某类 artifact
 *   - updateSession(api, notebookId, patch)   → 通用 patch
 *
 * D11 完整拆 V2App 需要把 selectedXxxArtifactId useState 全部替换成 session.xxx，
 * 留下个 sprint 做。本文件是 hook 基础设施，让后续替换工作量减少 60%。
 */

import { useState, useEffect, useCallback } from 'react';

export function useSession(api, notebookId) {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!notebookId) {
      setSession(null);
      return null;
    }
    if (typeof api?.getSessionContextV2 !== 'function') {
      console.warn('[useSession] api.getSessionContextV2 不存在，请检查 preload');
      return null;
    }
    setIsLoading(true);
    try {
      const res = await api.getSessionContextV2(notebookId);
      const next = res?.success ? res.data : null;
      setSession(next);
      return next;
    } finally {
      setIsLoading(false);
    }
  }, [api, notebookId]);

  // notebookId 变化 → 自动 refresh
  useEffect(() => { refresh(); }, [refresh]);

  return { session, refresh, isLoading };
}

/**
 * 切节课（写 DB + 返回 fresh session）
 */
export async function switchActiveLesson(api, notebookId, lessonNumber) {
  if (typeof api?.switchActiveLessonV2 !== 'function') {
    console.warn('[switchActiveLesson] preload 未注入 switchActiveLessonV2');
    return null;
  }
  const res = await api.switchActiveLessonV2({ notebookId, lessonNumber });
  if (!res?.success) {
    console.error('[switchActiveLesson] 失败:', res?.error);
    return null;
  }
  return res.data;
}

/**
 * 切某类 artifact 当前版本
 * @param {string} kind - 'design' | 'lecture' | 'ppt' | 'quiz' | 'homework' | 'microVideo' | 'report'
 */
export async function setActiveArtifact(api, notebookId, kind, artifactId) {
  if (typeof api?.setActiveArtifactV2 !== 'function') return null;
  const res = await api.setActiveArtifactV2({ notebookId, kind, artifactId });
  return res?.success ? res.data : null;
}

/**
 * 通用 patch
 */
export async function updateSession(api, notebookId, patch = {}) {
  if (typeof api?.updateSessionContextV2 !== 'function') return null;
  const res = await api.updateSessionContextV2({ notebookId, ...patch });
  return res?.success ? res.data : null;
}
