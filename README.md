# 刘老师课程助手 v2版

> **职业教育课程开发 Workflow Agent** — Electron + React + SQLite + Ark/DeepSeek API
>
> 当前版本：**v1.5.0**（Phase-5D 完成） | 最后更新：2026-04-25

---

## 项目概览

面向职业院校教师的 AI 驱动课程开发工具。核心理念来自 **Harness Engineering**：
> 模型是不稳定组件，框架约束它——不依赖模型自律，用工程化手段保证输出质量。

### 战略目标

```
广纺织学校验收测试通过 → 商业化推广
```

### 当前状态

| 项目 | 详情 |
|------|------|
| 版本 | v1.5.0 |
| 阶段 | Phase-5D 完成（Agent 四阶段全自动流水线） |
| 代码规模 | ~19,000 行 JS |
| 下一阶段 | Phase-6：Agent 状态面板增强 + 广纺织验收准备 |

---

## 核心功能

### 🚀 Agent 一键全流程生成（v1.5.0 新功能）

在软件右侧「🤖 Agent 智能生成」面板，点击「一键生成全部阶段」，系统自动完成：

```
教学框架生成 → 讲稿 A/B/C 三稿 → 合成正式讲稿 → PPT 页面规划
```

- 全程约 **3-8 分钟**，无需手动操作
- 实时进度显示：`框架✓ | 正在生成讲稿…`
- 遇到质量问题自动重试（最多 3 次）
- 失败可自动回溯重生成上游阶段

### 📋 完整工作流（手动逐步模式）

```
新建笔记本（填写课程信息 + 软件工具 + 职业岗位）
    ↓
01 教学框架  → 生成框架 → 确认
    ↓
02 讲稿      → 生成 A/B/C 三稿 → 选方向 → 生成正式稿（含 AI 审核）→ 确认
    ↓
03 PPT       → 生成页级框架 → 逐页生成插图 → 导出 .pptx
    ↓
04 视频提示词 → 生成即梦分段脚本（4 段 × 15 秒）→ 到即梦平台生成视频
```

### 📁 导出文件

| 导出内容 | 格式 | 用途 |
|---------|------|------|
| 教学框架 | .docx | 提交教务、备课存档 |
| 正式讲稿 | .docx | 打印讲课稿、教研材料 |
| 知识点卡片 | .html | 浏览器打印/截图发给学生 |
| PPT 课件 | .pptx | 直接在教室投影使用 |

> 所有文件只输出到用户选择的目录，**不产生任何额外文件夹**。

---

## 技术架构

### 技术栈

| 层 | 技术 |
|----|------|
| 桌面容器 | Electron 28 |
| 前端框架 | React 18 + Vite |
| 数据库 | SQLite（better-sqlite3，本地存储） |
| AI 接口 | 火山引擎 Ark API（DeepSeek-V3 + doubao-seedream-5.0） |
| PPT 生成 | pptxgenjs |
| Word 导出 | docx |
| 打包 | electron-builder（NSIS Windows 安装包） |

### Agent 三层架构（Phase-5C/5D）

```
Agent Orchestrator（src/main/agent/orchestrator.js）
    ├── 规则引擎 decideNextAction()  — 决定下一步动作
    ├── assessNotebookState()        — 读 DB artifacts 评估各阶段状态
    └── exec* 系列函数               — 实际调用 IPC handler 执行生成

Agent Memory（src/main/agent/memory.js）
    └── SQLite agent_memories 表     — 跨会话记忆历史成功课程

Context Builder（src/main/agent/context-builder.js）
    ├── buildLectureContext()        — 框架→讲稿 上下文注入
    └── buildPptContext()            — 讲稿→PPT 上下文注入
```

### Stage 依赖链（contracts.js 定义，⛔ 只读）

```
framework（已确认）→ lecture（已确认）→ ppt（已确认）→ video
```

每个阶段的 `confirmed=true` 才会解锁下一阶段的 UI 入口。

### IPC 架构（Phase-5A，87 个 handler 全部迁移完成）

```
src/main/
├── index.js                    ← 只做启动 + handler 注册
└── ipc/
    ├── _registry.js            ← 统一注册入口
    ├── agent.handlers.js       ← Agent 运行 + 状态查询
    ├── notebook.handlers.js
    ├── framework.handlers.js
    ├── lecture.handlers.js
    ├── export.handlers.js
    ├── media.handlers.js
    ├── resource.handlers.js
    ├── system.handlers.js
    └── v2/
        ├── framework.handlers.js
        ├── lecture.handlers.js
        ├── ppt.handlers.js
        └── video.handlers.js
```

---

## 目录结构

```
course-designer/
├── src/
│   ├── main/                   # Electron 主进程
│   │   ├── agent/              # Agent 编排器 + 记忆 + 上下文构建
│   │   ├── api/                # AI 客户端 + 框架 Schema
│   │   ├── database/           # SQLite 数据库操作
│   │   ├── export/             # Word / PPT / HTML / ZIP 导出
│   │   ├── ipc/                # 所有 IPC handler（按功能拆分）
│   │   ├── script/             # ABC 生成器 / 正式稿合成 / PPT 规划
│   │   ├── services/           # 信息图 / 研究建议 / AI 审核
│   │   ├── v2/                 # Stage 状态机 / 质量校验 / 合约
│   │   └── index.js            # 主进程入口
│   ├── renderer/               # React 前端
│   │   └── src/v2/             # V2App + 各 Stage 组件 + CSS
│   ├── preload/                # Electron 预加载脚本
│   └── shared/                 # 主进程+渲染进程共用工具
├── prompts/                    # AI Prompt 文件（.md 格式）
├── scripts/                    # 验证脚本（e2e + verify，共 21 个）
├── resources/                  # 图标 + 课程素材库
├── skills/                     # 知识卡片 HTML 模板
├── .claude-memory/             # Claude Code 长期记忆
├── CLAUDE.md                   # 开发约束文件（必读）
├── CONTEXT.md                  # 当前阶段状态快照
└── package.json
```

---

## 安装与运行

### 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0
- Windows 10/11（仅支持 Windows）

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 运行验证脚本（不需要 API Key）

```bash
# Agent 编排器（21 个测试用例）
node scripts/verify-agent-orchestrator.js

# 讲稿生成质量
node scripts/verify-lecture-generation.js

# PPT 导出
node scripts/e2e-ppt-export.js

# Word 导出
node scripts/e2e-framework-word.js
```

### 打包 Windows 安装包

```bash
npm run dist
# 输出：dist/刘老师课程助手v2版-setup.exe
```

---

## AI 配置（使用前必须）

软件需要连接火山引擎 Ark API。打开软件后点击右上角「API 配置」，填入：

| 配置项 | 说明 |
|--------|------|
| Ark API Key | 火山引擎控制台创建的 API Key |
| 文本模型 Endpoint | DeepSeek-V3 或 doubao-pro-32k 的推理接入点 ID |
| 图片模型 Endpoint | doubao-seedream-5.0 的推理接入点 ID |

> 详细注册步骤见 `dist/老师桌面安装指南.md`

### 费用参考

- 文本生成：约 0.01–0.05 元/次
- 图片生成：约 0.05–0.1 元/张
- 一门完整课程（框架 + 讲稿 + PPT + 插图）：约 **2–5 元**

---

## 开发规范

详见 [`CLAUDE.md`](./CLAUDE.md)，核心约束摘要：

| 约束 | 说明 |
|------|------|
| H1 | `contracts.js` 只读，不改 |
| H2 | 新 handler 必须写入 `ipc/` 对应文件，不加在 `index.js` |
| H3 | `quality.js` 是纯函数层，禁止调用 AI |
| H4 | `scripts/verify-*` 和 `scripts/e2e-*` 只增不删 |
| H5 | 新 Prompt 必须写 `.md` 文件放 `prompts/`，不内联 |
| H6 | 单次任务只改一个文件，不"顺手"跨文件重构 |
| H7 | 每次改代码必须告知验证脚本，不自称"应该没问题" |
| H8 | 新增 npm 包前必须先问用户 |

### 代码风格

- 全项目 **JavaScript（CommonJS）**，不引入 TypeScript
- 异步统一用 `async/await`，不用 `.then()` 链
- 所有 IPC handler 必须有 `try/catch`，错误统一返回 `{ success: false, error: e.message }`

---

## 版本历史

| 版本 | 阶段 | 核心内容 |
|------|------|---------|
| v1.5.0 | Phase-5D | Agent 四阶段全流水线；DB 持久化修复；实时进度轮询；PPT 双标题/路线图修复 |
| v1.4.x | Phase-5C | Agent Orchestrator + Memory + Context-Builder 基础架构；framework + lecture 两阶段 |
| v1.3.x | Phase-5B | 5 个课程上下文字段（softwareTools/jobTargets 等）；AI 研究建议；讲稿 AI 审核 Review Loop |
| v1.2.x | Phase-5A | IPC 拆分完成（87 个 handler 迁移至 ipc/ 目录） |
| v1.1.x | Phase-4 | PPT 11 种页型；Word 六列教学过程表；knowledge-cards HTML 导出 |
| v1.0.x | Phase-1~3 | 基础框架生成、讲稿 ABC 生成、SQLite 数据库 |

---

## 团队

| 角色 | 成员 |
|------|------|
| 产品设计 & 需求 | Baggio |
| 工程开发 | Baggio + Claude |
| 目标用户 | 职业院校教师 |

## 许可证

Private — 仅供内部使用，未经授权不得分发。
