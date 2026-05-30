/**
 * AssistantStatusAvatar.jsx — v4.3.3（老师反馈 2026-05-30）
 *
 * "助手状态"行：把固定的 🤖 换成「本阶段负责老师」的卡通头像（刘/吕/周），
 * 并按运行状态改变头像的视觉反馈，让老师一眼看出助手在干嘛：
 *   - idle  待命：  低饱和静态头像 + 灰角标
 *   - busy  处理中：蓝色呼吸 + 旋转光环（等待 30-90 秒时有"在工作"的反馈）
 *   - done  完成：  绿色对勾角标
 *   - error 出错：  红色叹号角标 + 灰度
 *
 * 阶段 → 老师映射复用 StageAssistant.jsx（刘=前4阶段 / 吕=中3阶段 / 周=报告）。
 * 状态从 assistantStatus 文案推断（不改各阶段 setAssistantStatus 调用点，零侵入）。
 */
'use strict';
import React from 'react';
import { stageAssistantAvatar, stageAssistantTeacher } from './StageAssistant';

// 从状态文案推断助手"表情/状态"
export function deriveAssistantState(status) {
  const s = String(status || '');
  if (!s.trim()) return 'idle';
  if (/❌|失败|出错|错误|无法|未能|⚠/.test(s)) return 'error';
  if (/✅|已完成|完成|已生成|已保存|成功|就绪/.test(s)) return 'done';
  if (/\.{2,}|…|正在|生成中|审核中|处理中|请稍候|请耐心等待|⏳|🤖/.test(s)) return 'busy';
  return 'done'; // 有内容但无明显标志 → 视作"已就绪"
}

// 去掉文案开头的状态 emoji（头像已表达状态，避免重复）
export function stripLeadingStatusEmoji(status) {
  return String(status || '').replace(/^[\s🤖⏳✅❌⚠️📝✨🎙]+/u, '').trim();
}

const STATE_LABEL = { idle: '待命中', busy: '处理中', done: '已完成', error: '出错了' };

export default function AssistantStatusAvatar({ stage, status }) {
  const avatar = stageAssistantAvatar(stage);
  const teacher = stageAssistantTeacher(stage) || '助手';
  const state = deriveAssistantState(status);
  const text = stripLeadingStatusEmoji(status) || `${teacher} ${STATE_LABEL[state]}`;
  return (
    <span className={`v2-assist-status v2-assist-${state}`}>
      <span className="v2-assist-ava-wrap" title={`${teacher} · ${STATE_LABEL[state]}`}>
        {avatar
          ? <img src={avatar} alt={teacher} className="v2-assist-ava" draggable={false} />
          : <span className="v2-assist-ava v2-assist-ava-fallback" aria-hidden="true">🤖</span>}
        <span className="v2-assist-badge" aria-hidden="true" />
      </span>
      <strong className="v2-assist-text">{text}</strong>
    </span>
  );
}
