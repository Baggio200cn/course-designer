# 项目上下文（2026-04-25 Phase-5D 完成 · v2.1.0 发布）

## 🎯 当前阶段：刘老师Agent2.1 v2.1.0 — Agent 四阶段全流水线已完成

**战略目标：广纺织学校验收测试 → 商业推广**

---

## ✅ Phase-5A：IPC 拆分（已完成）

全部 87 个 handler 从 index.js 迁移到 `src/main/ipc/` 下 14 个文件，
通过 `_registry.js` 统一注册。index.js 只做启动 + 注册。

---

## ✅ Phase-5B：上下文富化 + AI 审核（2026-04-21 完成）

### 新增内容

| 功能 | 状态 | 关键文件 |
|------|------|---------|
| 5 个课程上下文字段（软件/岗位/场景/学情/教材）| ✅ 完成 | db-simple.js + V2App.jsx |
| AI 研究建议（chatJson 守卫 bug 已修）| ✅ 完成 | services/research.service.js |
| 讲稿 AI 审核 + 自动修订（hasRichContext 触发）| ✅ 完成 | ipc/lecture.handlers.js + LectureStage.jsx |
| Word 导出讲稿信息表 + 样式区分 | ✅ 完成 | export/word.js |
| PPT 封面含软件/年级信息 | ✅ 完成 | export/ppt.js |
| 信息图模板注入软件/岗位上下文 | ✅ 完成 | services/infographic-card.service.js |
| 切换笔记本状态污染修复 | ✅ 完成 | V2App.jsx |
| 编辑课程上下文弹窗 | ✅ 完成 | V2App.jsx |
| framework-schema.js 用户友好错误消息 | ✅ 完成 | api/framework-schema.js |
| 质量卡片红/黄样式 + 审核面板样式 | ✅ 完成 | v2.css |

### 验证结果

```
11 个 verify 脚本：全部 ✅ OK
```

---

## ✅ Phase-5C：Agent 架构（已完成，2026-04-21）

**用户明确指示：连续工作直到完成，目标：广纺织学校验收测试 → 商业推广。**

### 5 个实施步骤（全部完成 ✅）

```
✅ Step 1 — Auto-Retry Loop
  文件：src/main/ipc/lecture.handlers.js + src/main/agent/retry-loop.js
  目标：generateFormalLecture 质量不达标时自动重试 ≤3 次
  验证：node scripts/verify-lecture-generation.js ✅

✅ Step 2 — Cross-Stage Context Injection
  文件：src/main/agent/context-builder.js
  目标：讲稿生成时自动注入框架的 objectives + teachingMethods
  验证：node scripts/verify-lecture-generation.js ✅

✅ Step 3 — Agent Orchestrator
  新文件：src/main/agent/orchestrator.js
  新文件：src/main/ipc/agent.handlers.js
  前端入口：V2App.jsx 新增「一键生成」按钮
  验证：node scripts/verify-agent-orchestrator.js ✅

✅ Step 4 — Cross-Session Memory
  新文件：src/main/agent/memory.js
  数据库：db-simple.js 新增 agent_memories 集合（saveAgentMemory / getAgentMemories）
  集成：orchestrator.js 在每次 run() 时读取历史相似课程，成功后保存记忆
  验证：node scripts/verify-agent-memory.js ✅ (18/18)

✅ Step 5 — Backtracking
  文件：src/main/agent/orchestrator.js（decideNextAction + execBacktrackFramework）
  机制：讲稿正式稿经 2 次编排器级尝试仍不达标 → 清空讲稿 artifacts → 重生成框架 → 重走讲稿链
  回溯后讲稿计数重置（只统计回溯后步骤），每轮最多回溯 1 次防死循环
  UI：回溯步骤在 Agent 日志中以琥珀色左边框高亮（⤴ backtrack_framework）
  验证：node scripts/verify-agent-orchestrator.js ✅ (12/12)
```

### Agent 架构的核心约束

- Agent 决策循环有 10 分钟超时
- 每次决策和执行记录到 task_runtime 操作日志
- 不修改已 confirmed 的 artifact
- 不绕过 contracts.js Stage 依赖顺序
- LLM 调用通过 resolveProviderConfig + createAiClientByConfig 创建

---

## ✅ Phase-5D：baoyu-skills 集成 + PPT 配图升级（2026-04-24）

### Phase A — SVG 教学结构图生成（v2:generateDiagram）

| 功能 | 状态 | 关键文件 |
|------|------|---------|
| SVG 结构图生成服务 | ✅ 完成 | src/main/services/diagram.service.js |
| 图形生成 System Prompt | ✅ 完成 | prompts/diagram.md |
| IPC handler 注册 | ✅ 完成 | src/main/ipc/media.handlers.js（v2:generateDiagram）|
| 前端按钮 + 预览 | ✅ 完成 | FrameworkStage.jsx（4种图类型 + SVG内联预览）|
| Preload API | ✅ 完成 | src/preload/index.js（generateDiagramV2）|

### Phase B — 信息图 5布局 × 4风格升级（v2:getInfographicOptions）

| 功能 | 状态 | 关键文件 |
|------|------|---------|
| 5种布局规格（LAYOUT_SPECS）| ✅ 完成 | infographic-card.service.js |
| 4种视觉风格（STYLE_SPECS）| ✅ 完成 | infographic-card.service.js |
| buildEnhancedPrompt() | ✅ 完成 | infographic-card.service.js |
| v2:getInfographicOptions handler | ✅ 完成 | media.handlers.js |
| 前端布局/风格选择器 | ✅ 完成 | FrameworkStage.jsx |

### Phase C — 知识点卡片 HTML 导出（v2:exportKnowledgeCards）

| 功能 | 状态 | 关键文件 |
|------|------|---------|
| 纯模板 HTML 生成 | ✅ 完成 | src/main/export/knowledge-cards.js |
| IPC handler 注册 | ✅ 完成 | export.handlers.js（v2:exportKnowledgeCards）|
| 前端导出按钮 | ✅ 完成 | FrameworkStage.jsx |

### 方向三 — 教师 PPT 配图控制层（三步走）

| 功能 | 状态 | 关键文件 |
|------|------|---------|
| Step ①：AI 规划完成标识 | ✅ 完成 | PptStage.jsx |
| Step ②：生成封面图 + 风格锁定 | ✅ 完成 | V2App.jsx（handleGenerateCoverImage + handleConfirmCoverStyle）|
| Step ③：批量生成 + 进度条 | ✅ 完成 | V2App.jsx（handleBatchGenerateImages）|
| styleAnchor 注入机制 | ✅ 完成 | 所有非封面页 imagePrompt 末尾追加风格锚点字符串 |

### 验证结果（2026-04-24）

```
全部 13 个 verify 脚本：均通过 ✅
系统完整性检查 20/20：全部通过 ✅
```

---

## 📊 关键代码位置速查

### 讲稿生成核心
| 功能 | 文件 | 说明 |
|------|------|------|
| 三稿生成 | src/main/script/abc-generator.js | A/B/C + API prompt |
| 正式稿合成 | src/main/script/formal-generator.js | 合成 + 扩展 + 清洗 |
| 字数/风格校验 | src/main/v2/quality.js | validateLectureStage（纯函数） |
| 讲稿 handler | src/main/ipc/lecture.handlers.js | 含 AI 审核逻辑 |

### 新增 Phase-5B 文件
| 功能 | 文件 | 说明 |
|------|------|------|
| 课程研究建议 | src/main/services/research.service.js | chatJson() 调用 |
| 框架 Schema | src/main/api/framework-schema.js | 用户友好错误消息 |

### 导出链
| 功能 | 文件 | 说明 |
|------|------|------|
| 框架 Word | export/word.js | 六列教学过程表 + 讲稿样式块 |
| PPT | export/ppt.js | 11 种页型，封面含上下文信息 |
| 信息图 | services/infographic-card.service.js | HTML→PNG，含软件/岗位 |

### 测试脚本
| 脚本 | 用途 |
|------|------|
| verify-lecture-generation.js | 讲稿质量（字数/规则泄露/寒暄） |
| e2e-lecture-with-api.js | 带 API 的讲稿端到端测试 |
| e2e-framework-word.js | Word 导出多课程测试 |
| e2e-ppt-export.js | PPT 导出全链路测试 |
| verify-word-export.js | Word 导出快速验证 |

---

## 🔀 整体路线图

```
✅ Phase-4A 讲稿链修复
✅ Phase-4B 框架 Word 升级
✅ Phase-4C PPT 链重构
✅ Phase-4D 信息图提示词升级
✅ Phase-5A IPC 拆分（14 组 handler 文件）
✅ Phase-5B 上下文富化 + AI 审核 + UI 修复
✅ Phase-5C Agent 架构（5 步全部完成 2026-04-21）
   ✅ Step1 Auto-Retry
   ✅ Step2 Cross-Stage Context
   ✅ Step3 Orchestrator
   ✅ Step4 Cross-Session Memory
   ✅ Step5 Backtracking
✅ Phase-5D baoyu-skills 集成 + PPT 配图升级（2026-04-24）
   ✅ Phase A SVG 教学结构图（diagram.service + prompts/diagram.md + FrameworkStage）
   ✅ Phase B 信息图 5布局×4风格（InfographicCardService + v2:getInfographicOptions）
   ✅ Phase C 知识点卡片 HTML 导出（knowledge-cards.js + v2:exportKnowledgeCards）
   ✅ 方向三 PPT 教师配图控制层（封面→锁定风格→批量生成，styleAnchor 注入）
→ 广纺织学校验收测试
→ 商业推广
```
