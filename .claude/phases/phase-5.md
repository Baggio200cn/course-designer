# Phase-5 历史（2026-04-21 ~ 2026-04-25）

> 包含 Phase-5B（上下文字段）/ Phase-5C（Agent 架构）/ Phase-5D（四阶段流水线）三个子里程碑。
> 全部已通过 11+ verify 脚本验证。

---

## Phase-5B（2026-04-21）：上下文字段 + 研究服务 + 审核循环

### 5B.1 新增 Notebook 字段（5 个上下文字段）

数据库和 UI 均已支持以下字段，会自动注入到所有 AI 生成阶段的 Prompt：

| 字段名 | 含义 | 示例 |
|-------|------|------|
| `softwareTools` | 主要软件工具名+版本 | Blender 4.x, AutoCAD 2024 |
| `jobTargets` | 面向职业岗位 | 三维建模师, 机械制图员 |
| `industryScenarios` | 行业应用场景 | 影视特效制作, 建筑可视化 |
| `learnerProfile` | 学情说明 | 已学 PS 基础，零三维经验 |
| `teachingMaterials` | 教材/课标 | 《Blender三维设计》高教出版社 |

### 5B.2 AI 研究建议功能（Research Service）

- **入口**：笔记本创建/编辑时点「AI 建议」按钮
- **服务**：`src/main/services/research.service.js`
- **关键修复**：守卫条件从 `chat()` 改为 `chatJson()`（ArkCourseClient 只有 chatJson）
- **返回结构**：softwareTools / jobTargets / industryScenarios / courseStandards / learnerProfile / summary

### 5B.3 讲稿 AI 审核（Review Loop）

- **触发条件**：`hasRichContext`（softwareTools 或 jobTargets 非空时）
- **流程**：生成正式稿 → 调用 AI 审核 → 分数 < 8 时自动修订一次
- **UI 展示**：LectureStage.jsx 里的 `.v2-review-panel`
- **Handler**：`src/main/ipc/lecture.handlers.js`（`script:generateFormalLecture`）

### 5B.4 导出质量提升

| 文件 | 改动 |
|------|------|
| `export/word.js` | 讲稿 Word 含课程元数据表 + 教师讲述/课堂动作样式区分 |
| `export/ppt.js` | 封面含年级/学时/软件工具信息 |
| `services/infographic-card.service.js` | 信息图模板含软件工具和岗位上下文 |
| `services/media.handlers.js` | 信息图生成时注入 software_context + job_context |

### 5B.5 框架 Schema 用户友好错误消息

`src/main/api/framework-schema.js` — 所有 validate 错误改为「问题描述 → 如何修复」格式。

---

## Phase-5C（2026-04-22 ~ 2026-04-23）：Agent 架构

### 5C 战略目标

把"v2.1 Pipeline + 部分 Agent"升级为真正的 Agent。

### 五个核心维度

| 维度 | 目标 |
|-----|-----|
| 决策主体 | AI 自主决策下一步 |
| 自动重试 | 质量不达标自动重试 3 次 |
| 跨阶段感知 | 讲稿质量差自动回溯框架 |
| 工具编排 | 动态选择工具 |
| 跨会话记忆 | agent_memories 表 |

### 实施完成

- 新建 `src/main/agent/orchestrator.js`
- 新建 `src/main/agent/memory.js`
- 新建 `src/main/ipc/agent.handlers.js`
- 新建 `src/main/agent/context-builder.js`

### Agent 架构约束

- 单次任务最长 10 分钟
- 每次决策必须记录到 task_runtime
- 不允许修改 confirmed artifact
- 必须通过 resolveProviderConfig 创建客户端
- 不是完全自动——每阶段完成后推送通知，用户可中断

---

## Phase-5D（2026-04-25）：四阶段流水线 + PPT 质量修复

### 5D.1 PPT 质量修复

| 修复项 | 文件 |
|-------|------|
| PPT 双标题 bug（addHeaderBlock 重复调用） | `export/ppt.js` |
| AI 图片文字烘焙 | `src/renderer/src/v2/stage-helpers.js` + `src/shared/v2-stage-helpers.js` |
| 路线图只显示 4 个模块 | `export/ppt.js` — `buildRouteItemsFromPages` |
| 视频提示词格式升级为即梦 4 段 ×15 秒 Markdown | `videoPrompt()` |

### 5D.2 Agent 四阶段流水线

**新增动作**：

| 动作 | 触发条件 | 执行函数 |
|------|---------|---------|
| `generate_ppt_plan` | `needs('ppt')` + `pptPageCount === 0` + 重试 < 2 | `execGeneratePptPlan` |
| `generate_video_prompt` | `needs('video')` + `!videoPromptExists` + 重试 < 1 | `execGenerateVideoPrompt` |

**默认 targetStages**：`['framework', 'lecture', 'ppt']`（`maxSteps` 从 12 升到 15）

### 5D.3 buildPptContext 跨阶段上下文正式接入

- `v2:generatePptPlan` 优先使用前端传入的 `lectureScript`，为空则从 DB `lecture_final` 自动读取

### 5D.4 Step A/B/C 修复

**Step A — 前端 targetStages 修正**：`handleAgentRun` 中硬编码已修正。

**Step B — Agent 持久化 Bug 修复**：`execGenerateLectureXxx` 后必须调 `v2Runtime.saveLectureStage` + `confirmLectureStage` 写 DB，避免无限循环。

**Step C — 前端 UI 更新**：`step.status` → `step.result`，实时进度轮询每 3s，PPT chip 加入。
