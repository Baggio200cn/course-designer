# 驭课 Agent

> **职业教育 6 阶段课程开发 Workflow Agent** — Electron + React + JSON DB + Ark/DeepSeek/Doubao API
>
> 当前版本：**v4.0.0**（Phase-9 完成）  ·  最后更新：2026-05-10

---

## 项目概览

面向中职/职业院校教师的 AI 驱动课程开发工具。核心理念来自 **Harness Engineering**：

> 模型是不稳定组件，框架约束它——不依赖模型自律，用工程化手段保证输出质量。

### 当前阶段

| 项 | 详情 |
|---|---|
| 版本 | **v4.0.0**（"驭课 Agent"——前身"刘老师 Agent 2.x" 已废弃）|
| 当前阶段 | Phase-9 完成（6 阶段工作流重构 + 多节课讲稿 + AI 信息图 + 4 格式报告导出） |
| 上一阶段 | Phase-8.5 治理升级（CLAUDE.md 拆分 + 杂志风信息图 + 9 维度审核 B 方案阶段 1） |
| 下一阶段 | 老师试用反馈 → Phase-10 体验打磨 |

---

## 6 阶段工作流（v4.0.0 核心）

```
教学进度表 → 教学设计 → 课堂讲稿 → 教学课件 → 微课视频 → 教学实施报告
   schedule    design     lecture     ppt        video      report
```

### 各阶段产物

| 阶段 | artifact_type | 老师交付物 | AI 信息图 | 导出格式 |
|---|---|---|---|---|
| 教学进度表 | schedule_table | 18 周 6 列排课表 | — | Word |
| 教学设计 | design_doc | 5 段法 + 考核 100% | ✅ AI 生成（30 种组合）| Word |
| 课堂讲稿 | lecture_final（多份）| 每节 ≤ 4 学时 | — | Word（每节一份）|
| 教学课件 | ppt_outline | 22 页 PPT | ✅ 每页主题化插图 | PPTX |
| 微课视频 | video_prompt | 脚本 + 分镜 + 即梦提示词 | — | JSON 复制粘贴 |
| 教学实施报告 | implementation_report | 9 大节 + 老师手填 9 项 | — | **Word / Markdown / HTML / PDF** |

---

## v4.0.0 关键能力（vs v3.x）

| 能力 | v3.1.0 | v4.0.0 |
|---|---|---|
| 工作流粒度 | 4 阶段（framework→lecture→ppt→video）| **6 阶段**（schedule→design→lecture→ppt→video→report）|
| 教学框架 | 单一 framework 阶段 | **进度表 + 教学设计** 两阶段（更专业）|
| 课堂讲稿 | 1 份覆盖整门课 | **N 份多节课**（每节 ≤4 学时，理论+实践拼配）|
| 讲稿质量 | 5 维度审核 | **9 维度审核**（+ referenceFusionDepth + fiveStepTransform + timelineConsistency + copyrightSafety）|
| 讲稿素材 | 富上下文 | **URL 抓取 + 文件上传 + 粘贴文本**（支持多素材累加）|
| 老师手搓正式稿 | ❌ | **✅ 粘贴模态 + 上传 .docx 替换 AI 版本** |
| AI 信息图 | 仅 framework 阶段 | **教学设计专用 design_overview 版面**（6 段逻辑闭环）|
| 微课视频 | 仅生成提示词 | **完整方案**（脚本+分镜+即梦提示词+拍摄+剪辑）|
| 实施报告 | ❌ | **✅ 9 大节 + 5 项实施成效 + 4 项反思改进 + 4 格式导出** |
| 教学实施报告导出 | — | **Word / Markdown / HTML / PDF**（4 选 1）|

---

## 安装与使用

### 给老师（最终用户）

1. 双击安装包 `驭课Agent-v4.0.0-setup.exe`
2. 选安装位置 → 完成
3. 桌面 / 开始菜单出现 **"驭课 Agent v4.0.0"** 图标，双击启动
4. 首次启动 → 右上角"API 配置"填火山引擎 Ark API Key + 文本模型 endpoint
5. 点 **"新建教学进度表"** 开始 6 阶段工作流

### 给开发者

```powershell
# 克隆 + 安装依赖
git clone <repo>
cd course-designer
npm install

# 开发模式（vite dev + Electron）
npm run dev

# 打包
npm run build              # 完整构建（vite + electron-builder）
npm run pack               # 仅打包不签名（开发自测用）
```

---

## 项目结构

```
course-designer/
├── CLAUDE.md                  ← Claude Code 工作入口（≤ 200 行）
├── CONTEXT.md                 ← 当前阶段快照
├── README.md                  ← 你正在读
├── .claude/                   ← 治理知识库
│   ├── README.md              ← 索引
│   ├── hard-constraints.md    ← H1-H13 硬约束
│   ├── verify-matrix.md       ← 修改了什么 → 跑什么 verify
│   ├── ipc-map.md             ← IPC handler 文件地图
│   ├── notes/                 ← 时间线笔记（一次性问题/经验）
│   ├── candidates/            ← 候选规则（重复 2-3 次的）
│   └── phases/                ← Phase 完工总结
├── .claude-memory/MEMORY.md   ← 跨会话长期记忆
├── prompts/                   ← AI Prompt 模板（schedule/design/report/micro-video 等）
├── scripts/                   ← verify-*.js / e2e-*.js 验证脚本
├── src/
│   ├── main/                  ← Electron 主进程
│   │   ├── index.js           ← 启动 + IPC 注册中心
│   │   ├── ipc/               ← 87+ IPC handler（按业务拆分）
│   │   │   ├── _registry.js   ← 注册中心
│   │   │   └── v2/            ← v4.0.0 阶段 handler（schedule/design/lesson/lecture/ppt/video/report）
│   │   ├── services/          ← 业务服务（schedule/design/micro-video/report 等）
│   │   ├── script/            ← AI 生成器（abc-generator/formal-generator）
│   │   ├── agent/             ← Agent + Builder（formal.builder Phase-6/8.5）
│   │   ├── export/            ← 各格式导出（word/ppt/schedule-word/design-word/report-export）
│   │   └── database/          ← JSON DB（db-simple.js）
│   ├── preload/index.js       ← contextBridge API 桥接
│   └── renderer/src/v2/       ← V2 React UI
│       ├── V2App.jsx          ← 主入口（≈3500 行）
│       ├── ScheduleStage.jsx  ← 阶段 1
│       ├── DesignStage.jsx    ← 阶段 2 + AI 信息图
│       ├── LectureStage.jsx   ← 阶段 3（多节课）
│       ├── PptStage.jsx       ← 阶段 4
│       ├── MicroVideoStage.jsx← 阶段 5
│       └── ReportStage.jsx    ← 阶段 6（4 格式导出）
└── package.json
```

---

## 验证回归（CI）

完整 verify 脚本清单见 `.claude/verify-matrix.md`。Phase-9 关键回归：

```powershell
node scripts/verify-contracts-v6.js          # 6 阶段架构 27/27
node scripts/verify-schedule-service.js      # 进度表 27/27
node scripts/verify-design-service.js        # 教学设计 21/21
node scripts/verify-micro-video-service.js   # 微课视频 25/25
node scripts/verify-report-service.js        # 实施报告 34/34
```

**累计 134/134 全过**（不含 Phase-5/6/8 历史回归）。

---

## 硬约束（H1-H13）

| # | 约束 | 详细 |
|---|---|---|
| H1 | 不修改 contracts.js（**Phase-9 例外，已批准**）| `.claude/hard-constraints.md` |
| H2 | 不在 index.js 加新 IPC handler | 必须写到 `ipc/` 子文件 |
| H3 | quality.js 不依赖生成模型 | 验证层独立 |
| H4 | 不删除/重命名 verify 脚本 | 回归防护网 |
| H5 | Prompt 必须放 `prompts/*.md` | 不写死代码 |
| H6 | 单次任务限 1-2 个文件 | 防多模块同时改 |
| H7 | 每次改动告诉用户跑哪个 verify | 不跳过验证 |
| H8 | 加新依赖必须先问 | 不随意污染 package.json |
| H9 | "selfCheck mock 通过 ≠ 功能就绪" | 必须真实路径用例 |
| H10 | 不允许"force accept"作为质量门槛兜底 | Agent 不能传 userForceAccept=true |
| H11 | "流程完成 ≠ 任务完成" | 必须 quality.valid + 字段齐全 |
| H12 | 业务路径必须走 prompt-assembler | systemPrompt 不绕过 |
| H13 | URL 抓取走 web-extractor.service | 不内嵌 fetch |

---

## 维护人

- **项目方**：Baggio
- **代码协作**：Claude Code（Anthropic）
- **审查频率**：每版本发布前 + 每月体检
