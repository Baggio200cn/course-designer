/**
 * StageAssistant.jsx — v4.3.3 功能4（老师反馈 2026-05-29）
 *
 * 点阶段卡上的老师头像 → 弹出该阶段的"卡通老师助手"对话框，介绍本阶段教学功能。
 *
 * 三位老师角色分工（老师群确认）：
 *   刘老师（教学设计指导员）→ 教学进度表 / 教学设计 / 教学课件 / 课堂讲稿（前 4 阶段）
 *   吕老师（教学实施顾问）  → 在线测验 / 课后作业 / 微课视频（中 3 阶段）
 *   周老师（质量复盘官）    → 教学实施报告（末阶段）
 *
 * 卡通图来源：省赛补充素材的 jpg → 圆形头像 PNG（scripts 处理）。
 */
'use strict';
import React from 'react';
import liuAvatar from '../assets/avatars/liu.png';
import lyuAvatar from '../assets/avatars/lyu.png';
import zhouAvatar from '../assets/avatars/zhou.png';

// 阶段 → { 老师 / 角色 / 头像 / 功能介绍 }
export const STAGE_ASSISTANT = {
  schedule: {
    teacher: '刘老师', role: '教学设计指导员', avatar: liuAvatar,
    intro: '我是负责教学设计的刘老师。这一步是「教学进度表」——8 阶段的起点。按你填的「总学时 ÷ 每次课学时」自动算出实际课次，生成含章节 / 授课方式 / 重难点 / 实训类目的整学期进度表。表格里每一格都能直接改，改完点「保存」。',
  },
  design: {
    teacher: '刘老师', role: '教学设计指导员', avatar: liuAvatar,
    intro: '「教学设计」阶段。我会按课中 5 段法（导入 / 讲授 / 实操 / 互查 / 总结）帮你生成整门课级的教学设计，含三维目标、考核权重、思政元素，还能一键生成国风教育信息图嵌入 Word。',
  },
  ppt: {
    teacher: '刘老师', role: '教学设计指导员', avatar: liuAvatar,
    intro: '「教学课件」阶段。基于教学设计做页级 PPT 规划，每页含标题 / 要点 / 讲者备注，并能一键调 AI 批量配图（豆包 seedream），最终导出 .pptx。',
  },
  lecture: {
    teacher: '刘老师', role: '教学设计指导员', avatar: liuAvatar,
    intro: '「课堂讲稿」阶段。以 PPT 骨架为主线，逐页生成「教师讲述 + 课堂动作」逐字稿。正式稿确认后，可以点「朗读」按周老师的语速试听节奏，方便你打磨课堂语言。',
  },
  quiz: {
    teacher: '吕老师', role: '教学实施顾问', avatar: lyuAvatar,
    intro: '我是负责教学实施的吕老师。「在线测验」阶段会基于 PPT 每页骨架 + 讲稿，每页出 1-2 道题 + 章节综合题，覆盖单选 / 多选 / 判断 / 填空 / 简答 5 种题型，导出可交互的 HTML 翻卡练习。',
  },
  homework: {
    teacher: '吕老师', role: '教学实施顾问', avatar: lyuAvatar,
    intro: '「课后作业」阶段。基于讲稿要点和 PPT 骨架，按学时算量生成分层作业，每道含交付物要求 + 评分要点 + 参考答案，导出 Word。',
  },
  video: {
    teacher: '吕老师', role: '教学实施顾问', avatar: lyuAvatar,
    intro: '「微课视频」阶段。生成 60-90 秒微课整套方案：旁白脚本（开场 / 主体 / 收尾）+ 分镜表 + 即梦提示词 + 拍摄指南 + 剪辑指南，可一键复制即梦提示词去出图，也能导出 Word。',
  },
  report: {
    teacher: '周老师', role: '质量复盘官', avatar: zhouAvatar,
    intro: '我是负责质量复盘的周老师。「教学实施报告」是最后一步，需要前面 7 个阶段全部「确认」后才解锁。我会自动汇总上游 7 阶段产物，你再手填实施成效与教学反思，最后导出 Word / Markdown / HTML / PDF 四种格式。',
  },
};

export function stageAssistantAvatar(stage) {
  return STAGE_ASSISTANT[stage]?.avatar || null;
}

export function stageAssistantTeacher(stage) {
  return STAGE_ASSISTANT[stage]?.teacher || '';
}

export function StageAssistant({ stage, onClose }) {
  const info = STAGE_ASSISTANT[stage];
  if (!info) return null;
  return (
    <div className="v2-assistant-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="v2-assistant-card" onClick={(e) => e.stopPropagation()}>
        <button className="v2-assistant-close" onClick={onClose} aria-label="关闭">✕</button>
        <div className="v2-assistant-head">
          <img src={info.avatar} alt={info.teacher} className="v2-assistant-avatar" draggable={false} />
          <div>
            <div className="v2-assistant-name">{info.teacher}</div>
            <div className="v2-assistant-role">{info.role}</div>
          </div>
        </div>
        <div className="v2-assistant-bubble">{info.intro}</div>
        <button className="v2-assistant-ok" onClick={onClose}>知道了</button>
      </div>
    </div>
  );
}

export default StageAssistant;
