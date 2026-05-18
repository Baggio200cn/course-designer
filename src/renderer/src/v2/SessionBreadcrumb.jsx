/**
 * SessionBreadcrumb.jsx — 2026-05-16 v4.2.0 Phase A
 *
 * 固定在每个 stage 顶部的"实体面包屑"：
 *   📚 服装产品传播 (72 学时)  >  第 3 节·POP 设计 (4 学时)  >  教学设计 [已确认]
 *
 * 老师任何时候都能看到"我现在在做哪节课的哪份产物"，不再因切 stage 迷路。
 * 点击节课名 → 弹切节课菜单（也可用各 stage 自带的切节课 UI）。
 */

import React, { useState, useEffect } from 'react';
import { useSession } from './SessionContext';

const STAGE_LABEL = {
  schedule: '📅 教学进度表',
  design: '🎯 教学设计',
  lecture: '🎤 课堂讲稿',
  ppt: '📊 教学课件',
  video: '🎬 微课视频',
  report: '📝 教学实施报告',
};

export default function SessionBreadcrumb({ notebook, currentStage, lessons = [], onSwitchLesson }) {
  const session = useSession();
  const [showLessonMenu, setShowLessonMenu] = useState(false);

  if (!notebook) return null;

  const activeLessonNumber = session.activeLessonNumber || 0;
  const activeLesson = lessons.find((l) => Number(l.lessonNumber) === Number(activeLessonNumber));

  // P6 修复（2026-05-18）：当 activeLessonNumber 在 lessons 里找不到（如默认锁死 1 但老师只确认了第 17 节）
  //   → 自动切到 lessons[0]，避免"第 1 节（未找到节课记录）"这种迷惑提示
  useEffect(() => {
    if (lessons.length > 0 && !activeLesson) {
      const firstLesson = lessons.slice().sort((a, b) => (a.lessonNumber || 0) - (b.lessonNumber || 0))[0];
      if (firstLesson && firstLesson.lessonNumber && typeof onSwitchLesson === 'function') {
        onSwitchLesson(firstLesson.lessonNumber);
      } else if (firstLesson && firstLesson.lessonNumber && session.switchLesson) {
        session.switchLesson(firstLesson.lessonNumber);
      }
    }
  }, [activeLesson, lessons.length, activeLessonNumber]);

  // fallback 显示：在 useEffect 触发 switch 之前的瞬间，给老师一个友好的过渡 label
  const fallbackLesson = !activeLesson && lessons.length > 0
    ? lessons.slice().sort((a, b) => (a.lessonNumber || 0) - (b.lessonNumber || 0))[0]
    : null;
  const lessonLabel = activeLesson
    ? `第 ${activeLesson.lessonNumber} 节·${activeLesson.topic || '未命名'} (${activeLesson.totalHours || 0} 学时)`
    : fallbackLesson
      ? `第 ${fallbackLesson.lessonNumber} 节·${fallbackLesson.topic || '未命名'} (${fallbackLesson.totalHours || 0} 学时)`
      : (lessons.length === 0 ? '⚠ 请先在「教学设计」阶段创建并确认至少一节课' : '加载中…');

  const stageLabel = STAGE_LABEL[currentStage] || currentStage;

  // 当前 stage 对应的 active artifact ID
  const activeArtifactId = {
    design: session.activeDesignArtifactId,
    lecture: session.activeLectureArtifactId,
    ppt: session.activePptOutlineId,
    video: session.activeMicroVideoId,
    report: session.activeReportId,
  }[currentStage] || null;

  const handlePickLesson = async (lessonNumber) => {
    setShowLessonMenu(false);
    if (typeof onSwitchLesson === 'function') {
      await onSwitchLesson(lessonNumber);
    } else {
      await session.switchLesson(lessonNumber);
    }
  };

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', marginBottom: 12,
        background: 'linear-gradient(90deg, #EFF6FF 0%, #F8FAFC 100%)',
        border: '1px solid #BFDBFE',
        borderRadius: 8,
        fontSize: 13,
        flexWrap: 'wrap',
      }}
    >
      {/* 📚 课程名 */}
      <span style={{ color: '#1E40AF', fontWeight: 700 }}>
        📚 {notebook.name || '未命名课程'}
      </span>
      <span style={{ color: '#94A3B8', fontSize: 11 }}>
        ({notebook.totalHours || 0} 学时)
      </span>

      <span style={{ color: '#CBD5E1' }}>›</span>

      {/* 节课名（可点切换） */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => lessons.length > 0 && setShowLessonMenu((v) => !v)}
          style={{
            background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B',
            padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 700,
            cursor: lessons.length > 0 ? 'pointer' : 'default',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
          title={lessons.length > 0 ? '点击切换节课（同步切设计/讲稿/PPT）' : ''}
        >
          🎯 {lessonLabel}
          {lessons.length > 0 ? <span style={{ fontSize: 10, marginLeft: 4 }}>▾</span> : null}
        </button>
        {showLessonMenu && lessons.length > 0 ? (
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
              background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              minWidth: 280, maxHeight: 320, overflowY: 'auto',
              padding: 4,
            }}
            onMouseLeave={() => setShowLessonMenu(false)}
          >
            {lessons
              .slice()
              .sort((a, b) => (a.lessonNumber || 0) - (b.lessonNumber || 0))
              .map((l) => {
                const isActive = Number(l.lessonNumber) === Number(activeLessonNumber);
                return (
                  <button
                    key={l.lessonNumber || l.id}
                    onClick={() => handlePickLesson(l.lessonNumber)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '6px 10px', border: 'none',
                      background: isActive ? '#FEF3C7' : 'transparent',
                      color: isActive ? '#92400E' : '#0F172A',
                      fontSize: 12, cursor: 'pointer', borderRadius: 3,
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#F1F5F9'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    {isActive ? '✓ ' : '  '}第 {l.lessonNumber} 节·{l.topic || '未命名'} ({l.totalHours || 0} 学时)
                    {l.confirmed ? <span style={{ color: '#16A34A', marginLeft: 6 }}>✓</span> : null}
                  </button>
                );
              })}
          </div>
        ) : null}
      </div>

      <span style={{ color: '#CBD5E1' }}>›</span>

      {/* 当前 stage */}
      <span style={{ color: '#0F172A', fontWeight: 600 }}>{stageLabel}</span>

      {/* artifact 状态徽章 */}
      {activeArtifactId ? (
        <span
          style={{
            background: '#DCFCE7', color: '#166534',
            padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600,
            border: '1px solid #16A34A',
          }}
          title={`artifact id = ${activeArtifactId}`}
        >
          ✓ 已绑定
        </span>
      ) : (
        <span
          style={{
            background: '#FEE2E2', color: '#991B1B',
            padding: '2px 8px', borderRadius: 3, fontSize: 11,
            border: '1px solid #DC2626',
          }}
        >
          ⚠ 本节尚未生成
        </span>
      )}

      {/* 右侧装饰 */}
      <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94A3B8' }}>
        v4.3.3 · 会话上下文
      </span>
    </div>
  );
}
