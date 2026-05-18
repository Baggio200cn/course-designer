# 驭课 Agent

> **职业教育 8 阶段课程开发 Workflow Agent** — Electron + React + JSON DB + 火山引擎（豆包）API
>
> 当前版本：**v4.3.3**（Sprint A 止血 · Sprint B 结构重构中） · 最后更新：2026-05-18

---

## 项目概览

面向中职/职业院校教师的 AI 驱动课程开发工具。核心理念来自 **Harness Engineering**：

> 模型是不稳定组件，框架约束它——不依赖模型自律，用工程化手段保证输出质量。

### 当前阶段

| 项 | 详情 |
|---|---|
| 版本 | **v4.3.3**（D6-D9 + Sprint A 止血 · Sprint B 结构重构中） |
| 工作流 | **8 阶段**（v4.3.3 新增 Step 5 在线测验 + Step 6 课后作业）|
| 上一里程碑 | v4.3.0 D6-D9 一步出稿 + AI 对话改稿 + 三路径自动保存 + stage 聚合校验 + 强制解锁 |
| 当前里程碑 | **Sprint A**（止血：文档/默认值/迁移规范统一）+ **Sprint B**（D14-D15 + D11-D13 结构重构）|
| 下一里程碑 | 老师试用反馈 → v4.4.0 体验打磨 |

---

## 8 阶段工作流（v4.3.3 核心）

```
教学进度表 → 教学设计 → 教学课件 → 课堂讲稿 → 在线测验 → 课后作业 → 微课视频 → 教学实施报告
  schedule    design      ppt        lecture     quiz       homework     video        report
    ①          ②           ③           ④           ⑤          ⑥           ⑦           ⑧
```

| 阶段 | 关键产物 | AI 输入依据 | 输出格式 |
|---|---|---|---|
| ① 教学进度表 | `schedule_table` | 老师上传素材 + 课程基本信息 | JSON + Word |
| ② 教学设计 | `design_doc` | 进度表 + 教学要求 | 5 段教学法 + 考核权重 + Word |
| ③ 教学课件 | `ppt_outline` + `ppt_page_image` | 教学设计 + 老师选目标 | 页级框架 + AI 配图 + 导出 |
| ④ 课堂讲稿 | `lecture_final` | **PPT 骨架 100% 主权重** + 素材 80% 深度 | 逐页教师口播稿 |
| ⑤ 在线测验 ⭐NEW | `quiz_set` | PPT 每页 + 讲稿 | 每页 1-2 题 + 综合题（5 种题型）|
| ⑥ 课后作业 ⭐NEW | `homework_set` | 讲稿 + PPT | 3-5 道作业，含 deliverables + 评分标准 |
| ⑦ 微课视频 | `video_prompt`（旧 `micro_video_plan` 已废，但 workbench 仍兼容读老数据） | 讲稿 | 脚本+分镜+即梦提示词+拍摄+剪辑 |
| ⑧ 教学实施报告 | `implementation_report` | 前 7 阶段全部产物 | AI 汇总 + 老师手填实施成效 |

---

## v4.3.3 关键能力（vs v4.2.0）

### 🎯 讲稿阶段（D6-D8）
- **一步出稿**：删 ABC 三稿流程，AI 直接出正式稿（PPT 骨架 100% 决定节奏）
- **右侧 380px AI 对话框**：老师可输入「把第 3 页改口语化」「整体减 30% 字数」「整合刚上传的素材」做局部 patch
- **三路径自动保存**：AI 生成 / AI 对话改稿 / 老师手贴正式稿 — 三处都立即落库 draft，刷新不丢
- **正式稿大窗预览**：四方向拖拽、字号 14px、行高 1.75，老师阅读体验大改
- **PDF/PPTX/图片 OCR**：扩展支持的素材格式（图片 OCR 走多模态文本 endpoint，无需新模型）

### 📑 PPT 阶段（D1-D5）
- **AI 主色推荐**：3-5 hex 候选 + 老师自定义
- **图片风格 preset**：扁平 / 插画 / 写实 / 国潮 / 极简 5 种
- **3 层防误操作**：确认 modal + 取消按钮 + 清空重做
- **PPT 骨架下拉**：lecture 阶段可切换骨架来源 PPT（多份时可选）+ 自动预填本节信息

### 🎓 在线测验 + 课后作业（v4.3.3 Step 5/6）
- AI 基于 PPT 每页骨架出 1-2 道题（单选 / 多选 / 判断 / 填空 / 简答）+ 综合题
- 课后作业按学时算量（每学时 30-60 分钟练习）
- 题型多样化，含 deliverables 和 evaluationCriteria

### 🛡 数据安全（Sprint A）
- **`src/main/migrations/` 数据迁移目录**：跨版本 schema 变化时不再丢老师数据
- **教师日志**（前称「我的工作台」）：「🔍 找回历史数据」按钮，对老师反馈的「v4.1.4 → v4.3.x 36 个 design 丢失」做修复
- **「⚙ 强制解锁下游」按钮**：质检误报时老师能手动跳过门槛

---

## 项目结构

```
course-designer/
├── README.md                         ← 你正在读
├── CLAUDE.md                         ← Claude Code 工作约束（H1-H14 硬约束）
├── CONTEXT.md                        ← 当前阶段快照
├── package.json                      ← v4.3.3 · electron-builder 配置
├── dist/                             ← 打包产物（驭课Agent-v4.3.3-setup.exe）
├── prompts/                          ← AI Prompt 文件（H5 必须在这）
├── scripts/                          ← 验证脚本（H4 不可删）
├── src/
│   ├── main/                         ← Electron 主进程
│   │   ├── index.js
│   │   ├── migrations/               ← v4.3.3 新增 · 跨版本数据迁移
│   │   │   ├── README.md
│   │   │   └── 001-recover-orphan-artifacts.js
│   │   ├── v2/
│   │   │   ├── contracts.js          ← STAGE_ORDER 8 阶段 + STAGE_REQUIREMENTS（H1 例外）
│   │   │   ├── runtime.js
│   │   │   └── quality.js
│   │   ├── ipc/
│   │   │   ├── _registry.js          ← 集中注册（H2: 不在 index.js 加 handler）
│   │   │   └── v2/                   ← 8 个 stage 的 handlers
│   │   │       ├── schedule.handlers.js
│   │   │       ├── design.handlers.js
│   │   │       ├── ppt.handlers.js
│   │   │       ├── lesson.handlers.js     ← Phase-9 多节课模型
│   │   │       ├── quiz.handlers.js       ← v4.3.3 NEW
│   │   │       ├── homework.handlers.js   ← v4.3.3 NEW
│   │   │       ├── micro-video.handlers.js
│   │   │       └── report.handlers.js
│   │   ├── services/
│   │   │   ├── quiz.service.js       ← v4.3.3 NEW
│   │   │   ├── homework.service.js   ← v4.3.3 NEW
│   │   │   ├── pptx-parser.service.js
│   │   │   └── ...
│   │   └── database/
│   │       └── db-simple.js          ← JSON DB
│   ├── preload/index.js              ← IPC API 暴露（含 quizV2 / homeworkV2）
│   └── renderer/src/v2/
│       ├── V2App.jsx                 ← 主路由 + 全局 state（**4500 LOC，D11 待拆**）
│       ├── ScheduleStage.jsx
│       ├── DesignStage.jsx
│       ├── PptStage.jsx
│       ├── LectureStage.jsx          ← 含右侧 LectureChatPanel
│       ├── QuizStage.jsx             ← v4.3.3 NEW
│       ├── HomeworkStage.jsx         ← v4.3.3 NEW
│       ├── MicroVideoStage.jsx
│       ├── ReportStage.jsx
│       └── MyWorkbench.jsx           ← 教师日志（前称我的工作台）
└── .claude/
    ├── README.md                     ← 治理知识库索引
    ├── hard-constraints.md           ← H1-H14 详细
    ├── notes/
    │   ├── 2026-05-18-bug-retrospective-v1-to-v4.3.0.md  ← bug 历史回顾
    │   └── 2026-05-18-audit-v4.3.0-to-4.3.3.md           ← 审计报告
    └── phases/                       ← 阶段完工总结
```

---

## 开发指引

### 启动 dev

```bash
npm install
npm run dev    # vite + electron 一键启动
```

### 打包

```bash
npm run build  # vite build && electron-builder → dist/驭课Agent-v4.3.3-setup.exe
```

### 验证脚本（H4 必须保留）

```bash
# v4.3.3 8 阶段契约自检（35/35 测试覆盖 STAGE_ORDER / REQUIREMENTS / PRIMARY_TYPE / unlock 链 / video type 一致性）
node scripts/verify-contracts-v8.js

# v4.3.3 集成验证（14/14 测试覆盖 runtime / workbench / migration / IPC 暴露 / V2App stageContracts）
node scripts/verify-workflow-integration-v8.js

# 业务服务验证
node scripts/verify-design-service.js
node scripts/verify-ppt-images-pipeline.js
node scripts/verify-schedule-service.js

# v4.3.3 D15 真实 endpoint 烟雾测试（手动跑，需要 ARK API Key）
ARK_API_KEY=xxx ARK_TEXT_ENDPOINT=ep-m-xxx npm run smoke

# ⚠ scripts/legacy/ 是老脚本（v4.1.x / v4.2.x 6 阶段断言），仅历史参考，不要跑
# 见 scripts/legacy/README.md
```

---

## Sprint B 状态（v4.3.3 已落地）

| ID | 内容 | 状态 |
|---|---|---|
| **D11** | useSession hook 抽出（`src/renderer/src/v2/useSession.js`）；V2App.jsx 全拆分留 D11.2 下个 sprint | ✅ 最小可行 |
| **D12** | sessionContext DB 真落地：`db-simple.js` 加 4 个方法 + `data.sessions` 表 + smoke 6/6 通过 | ✅ |
| **D13** | artifact schemaVersion + dirty 信号 + markDownstreamDirty + clearArtifactDirty + smoke 7/7 通过 + 接入所有 confirm 入口 | ✅ |
| **D14** | V2App.jsx framework stub + handleSaveRawJson 删除；framework fallback 全清；runtime.js 老方法删除留 D14.2 | ✅ 部分 |
| **D15** | `npm run smoke` 真实 ARK endpoint 烟雾测试脚本（scripts/smoke-test-real-ark.js） | ✅ |

## 待处理（v4.4.0 D11.2 / D14.2）

- D11.2: V2App.jsx 4500 LOC 完整拆分（router + StageRouter + per-stage component）
- D14.2: 删 `runtime.js` 老 framework 方法（仍被 lecture.handlers v3 老路径引用）
- ~~验证脚本升级：`verify-contracts-v6.js` → `verify-contracts-v8.js`~~ ✅ 已落地（v4.3.3 Codex Round 3 响应 · 35/35 测试通过）

详见 `.claude/notes/2026-05-18-audit-v4.3.0-to-4.3.3.md`

---

## 关键约束（CLAUDE.md H1-H14）

- **H1**：`contracts.js` 是核心契约，改它需要明确批准（v4.3.3 已批 1 次：6→8 阶段）
- **H2**：禁止在 `index.js` 加 IPC handler，必须写到 `ipc/v2/*.handlers.js`
- **H6**：单任务限 1-2 个文件改动（除非用户明确批准大重构）
- **H8**：加新 npm 依赖需要明确批准（v4.3.3 已批 pdf-parse）
- **H9**：selfCheck mock 通过 ≠ 功能就绪，必须真实路径覆盖
- **H14**（v4.3.0 新增）：禁止任何教学参数（学时 / 周次 / 学校 / 教师 / 课程名）硬编码 default

完整说明 → [`.claude/hard-constraints.md`](.claude/hard-constraints.md)

---

## 数据存储位置

| 类型 | 路径 |
|---|---|
| JSON DB | `C:\Users\<你>\AppData\Roaming\驭课 Agent\course-designer-data.json` |
| 工作区（图片 / 导出文件） | `C:\Users\<你>\Documents\驭课Agent工作区\<课程名>\` |
| 迁移日志（v4.3.3+）| `course-designer-data.json` 内 `migrations` 字段 |

---

## 版本历史

| 版本 | 日期 | 关键改动 |
|---|---|---|
| **v4.3.3** | 2026-05-18 | **Sprint A 止血 + Sprint B 结构重构** · 8 阶段（+ Step 5 测验 + Step 6 作业）· 跨版本数据找回 · 教师日志改名 |
| v4.3.0 | 2026-05-18 | D6-D9 · 讲稿一步出稿 + 右侧 AI 对话 + PPT 骨架自动预填 + 三路径自动保存 + stage 聚合校验 + 强制解锁 + PDF/OCR |
| v4.2.0 | 2026-05-17 | 6 阶段架构升级（PPT 在 lecture 前）+ 会话上下文 + 实体绑定 + 工作台修复 |
| v4.1.4 | 2026-05-16 | 多节课模式 + 9 维度质量审核 |
| v4.0.0 | 2026-05-10 | 6 阶段工作流首版（Phase-9 完成）|

---

## 致谢

- **设计 / 老师反馈**：Baggio（项目方）+ 试用老师群
- **技术实现**：Claude Code（Anthropic Claude Opus 4.7 / Sonnet 4.5）
- **AI 模型**：火山引擎（豆包）系列 endpoint
- **结构性诊断**：Codex AI 代理（Sprint A/B 治理建议）

---

> 📚 治理结构参考：[`CLAUDE.md`](CLAUDE.md) + [`.claude/README.md`](.claude/README.md)
