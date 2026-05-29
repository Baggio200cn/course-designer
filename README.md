# 驭课 Agent

> **职业教育 8 阶段课程开发 Workflow Agent** — Electron + React + JSON DB + 火山引擎（豆包）API
>
> 当前版本：**v4.3.3**（Codex 审计第 1 轮收口 · 200/200 自动验证通过）
> 最后更新：2026-05-30

---

## 项目概览

面向中职 / 职业院校教师的 AI 驱动课程开发工具。核心理念来自 **Harness Engineering**：

> 模型是不稳定组件，框架约束它——不依赖模型自律，用工程化手段保证输出质量。

### 当前状态（2026-05-30）

| 项 | 详情 |
|---|---|
| 版本 | **v4.3.3** · Codex 审计第 1 轮收口 |
| 工作流 | **8 阶段**（schedule → design → ppt → lecture → quiz → homework → video → report）|
| 质量门禁 | **4 套 200 条断言全过**：合约 35 + 工作流集成 142 + 数据迁移 17 + 导出物语义 6 |
| Codex 审计 | 19 轮治理收口（含真实交付物语义验收）|
| 当前安装包 | `dist/驭课Agent-v4.3.3-setup.exe`（含 Round 18/19 全部修复）|

---

## v4.3.3 累积里程碑（Round 1-19）

### 新增功能
- 🎬 **微课视频方案 Word 导出**（Round 18）：MicroVideoStage 加"📄 导出 Word"按钮，按真实 schema 渲染 6 大段
- 🖼 **新版 icon**（v4.3.3 新版 · 2026-05-20）：绿底金马·驭字 logo，多尺寸 ICO（16/24/32/48/64/128/256）
- 🔍 **4 个预览页面最大化**：教学设计 / PPT 大纲 / 讲稿 / 实施报告 都支持全屏阅读，Esc 退出
- 📋 **报告 5 段法完整渲染**（Round 19）：含 duration + teacherActions + studentActions

### 关键 Bug 修复
- ✅ web-extractor 非 Electron 环境平静降级（不再 `BrowserWindow is not a constructor`）
- ✅ schedule/report/micro-video 三个 export 入口加 schema 守卫，错字段名立刻报错
- ✅ micro-video Word 导出 5 字段对齐 service 真实输出（targetAudience/rhythm/transitions/subtitles/platforms）
- ✅ report.service.normalizeReport 不再压扁 5 段法到只剩 highlight
- ✅ 课中 5 段法"评价"→"设计意图"前端预览修齐

### 治理层升级
- ⭐ **导出物级质量门禁**（Round 19）：真实生成 .docx → 解包 → 断言关键字段出现在正文
- ⭐ **schema 守卫 + 测试两层防御**：caller 写错字段名立刻 throw，docx 不再静默生成空文档
- ⭐ **mock E2E 8 阶段闭环**：schedule → ... → report 全跑通 + artifact validator 后置 strict

---

## 8 阶段工作流

```
教学进度表 → 教学设计 → 教学课件 → 课堂讲稿 → 在线测验 → 课后作业 → 微课视频 → 教学实施报告
  schedule    design      ppt        lecture     quiz       homework     video        report
    ①           ②           ③           ④           ⑤          ⑥           ⑦           ⑧
```

| 阶段 | 关键产物（artifact_type）| AI 输入依据 | 输出格式 |
|---|---|---|---|
| ① 教学进度表 | `schedule_table` | 老师上传 Word 进度表 + 课程基本信息 | JSON + Word |
| ② 教学设计 | `design_doc` | 进度表 + 教学要求 | 5 段法 + 信息图嵌入 + 思政 + Word |
| ③ 教学课件 | `ppt_outline` + 配图 | 教学设计 + 老师选目标 | 页级框架 + AI 配图 + .pptx |
| ④ 课堂讲稿 | `lecture_final` | PPT 骨架 + 素材 80% 深度 | 逐页教师口播稿 |
| ⑤ 在线测验 | `quiz_set` | PPT 每页 + 讲稿 | 5 题型（单/多/判/填/简）+ HTML 翻卡 |
| ⑥ 课后作业 | `homework_set` | 讲稿 + PPT | 4-6 道作业 + 评分标准 + Word |
| ⑦ 微课视频 | `video_prompt` | 讲稿 + PPT | 旁白 + 分镜 + 即梦提示词 + Word ⭐NEW |
| ⑧ 实施报告 | `implementation_report` | 上游 7 阶段产物 | AI 汇总 + 老师手填 + Word/MD/HTML/PDF |

---

## 安装与使用

### 给老师（终端用户）

直接看 [`驭课Agent-v4.3.3-安装指南.md`](https://github.com/Baggio200cn/course-designer/blob/main/驭课Agent-v4.3.3-安装指南.md)（与 setup.exe 同发布）。

最关键 3 步：

1. **下载** `驭课Agent-v4.3.3-setup.exe` → 双击安装
2. **配置 API**：顶栏 "API 配置" → 填火山引擎 Key（需 doubao-pro / seedream / doubao-vision 三类端点）
3. **新建教学进度表** → 上传你的课程进度表 Word → 走 8 阶段

### 给开发者

```bash
git clone https://github.com/Baggio200cn/course-designer.git
cd course-designer
npm install

# 开发模式（vite + electron 一键启动）
npm run dev

# 生产构建（vite build → electron-builder → dist/驭课Agent-v4.3.3-setup.exe）
npm run build

# 完整发版门禁（gate + build，发版前跑这个）
npm run verify:release
```

---

## 质量门禁（v4.3.3 · Round 19）

### 验证脚本

4 套自动验证（共 200 条断言）：

```bash
# 快速门禁（开发期、PR、CI 普通分支必跑）—— 跑全部 4 套
npm run verify:gate         # 全绿才允许发版

# 发版门禁（发安装包前跑这个）—— gate + vite build + electron-builder
npm run verify:release      # 任一失败即 exit 1
```

**职责分工**：
- `verify:gate` = **快速门禁**（4 套验证全过）
- `verify:release` = **发版门禁**（gate + build，发安装包前跑）

拆开跑（CI 单步可见）：

```bash
npm run verify:contracts        # 35/35 · 8 阶段 STAGE_ORDER / REQUIREMENTS / unlock 链合约自检
npm run verify:integration      # 142/142 · 工作流集成 + 19 轮治理收口防回归
npm run verify:migrations       # 17/17 · 4 个数据迁移行为验证（runner + 003 + 004）
npm run verify:export-content   # 6/6  · 导出物级正文断言（Round 19 新增） ⭐
npm run verify:e2e:mock         # mock 8 阶段闭环 + artifact validator strict 模式
```

### 验证套件职责

| 套件 | 防什么 | 关键文件 |
|---|---|---|
| `verify:contracts` | 8 阶段链不被破坏 | `verify-contracts-v8.js` |
| `verify:integration` | IPC / runtime / V2App / handler 集成不回归 | `verify-workflow-integration-v8.js`（23 组断言）|
| `verify:migrations` | 跨版本升级数据不丢 | `verify-migrations-runner-v8.js` |
| `verify:export-content` ⭐ | docx 正文真实含老师填的字段 | `verify-export-content-v8.js` |
| `verify:e2e:mock` | 8 阶段端到端能跑通 | `scripts/e2e/run-e2e-v8.js` |

---

## 项目结构

```
course-designer/
├── README.md                              ← 你正在读
├── CLAUDE.md                              ← Claude Code 工作约束（H1-H14 硬约束）
├── 驭课Agent-v4.3.3-安装指南.md           ← 给老师的安装说明
├── package.json                           ← electron-builder 配置 + 5 个 verify 脚本
├── resources/
│   └── icons/
│       ├── icon.ico                       ← 多尺寸 ICO（含 16/24/32/48/64/128/256）
│       └── icon.png                       ← 1024×1024 PNG（窗口/任务栏）
├── dist/
│   └── 驭课Agent-v4.3.3-setup.exe         ← 一键安装程序（~240 MB）
├── prompts/                               ← AI Prompt 文件（H5 必须在这）
├── scripts/
│   ├── verify-contracts-v8.js
│   ├── verify-workflow-integration-v8.js
│   ├── verify-migrations-runner-v8.js
│   ├── verify-export-content-v8.js        ← Round 19 新增 · 导出物级
│   ├── e2e/
│   │   └── run-e2e-v8.js                  ← mock 8 阶段闭环
│   ├── icon/
│   │   └── rebuild-icons.js               ← 一次性生成多尺寸 ICO + PNG
│   └── legacy/                            ← v4.1.x / v4.2.x 老脚本（H4 不可删）
└── src/
    ├── main/                              ← Electron 主进程
    │   ├── index.js
    │   ├── migrations/                    ← 跨版本数据迁移
    │   │   ├── runner.js                  ← Round 10 抽离的扫描+执行器
    │   │   ├── 001-recover-orphan-artifacts.js
    │   │   ├── 002-add-schemaversion-dirty.js
    │   │   ├── 003-rename-artifact-types.js
    │   │   └── 004-notebooks-currentstage.js
    │   ├── v2/
    │   │   └── contracts.js               ← STAGE_ORDER 8 阶段 + REQUIREMENTS（H1 例外）
    │   ├── ipc/v2/                        ← 8 个 stage 的 handlers
    │   │   ├── schedule.handlers.js
    │   │   ├── design.handlers.js
    │   │   ├── ppt.handlers.js
    │   │   ├── lesson.handlers.js
    │   │   ├── quiz.handlers.js
    │   │   ├── homework.handlers.js
    │   │   ├── micro-video.handlers.js    ← + v2:exportMicroVideoWord ⭐
    │   │   ├── report.handlers.js
    │   │   └── report-upstream.helper.js  ← Round 17 抽离的纯模块（含 12 条单测）
    │   ├── services/
    │   │   ├── schedule.service.js
    │   │   ├── design.service.js
    │   │   ├── lecture-importer.service.js
    │   │   ├── quiz.service.js
    │   │   ├── homework.service.js
    │   │   ├── micro-video.service.js
    │   │   ├── report.service.js
    │   │   ├── web-extractor.service.js   ← Round 18 加 BrowserWindow 环境守卫
    │   │   ├── artifact-validator.service.js  ← 5 种 artifact 类型 validator
    │   │   ├── ppt-images-pipeline.service.js ← Round 18 consistencyEnabled 可观测
    │   │   └── ...
    │   └── export/
    │       ├── schedule-word.js           ← Round 18 加 assertScheduleSchema
    │       ├── report-export.js           ← Round 18 加 assertReportSchema + Round 19 渲染 5 段法
    │       ├── micro-video-word.js        ← Round 18 新建 + Round 19 字段对齐 ⭐
    │       ├── design-word.js
    │       ├── ppt.js
    │       ├── quiz.js
    │       └── word.js                    ← lecture 用通用 docx
    ├── preload/index.js                   ← IPC API 暴露（含 exportMicroVideoWordV2）
    └── renderer/src/
        ├── assets/
        │   ├── logo.png                   ← 256×256 启动屏/标题栏
        │   └── favicon.ico
        └── v2/
            ├── V2App.jsx                  ← 主路由 + 全局 state
            ├── PreviewFullscreen.jsx      ← 通用最大化预览组件 ⭐
            ├── ScheduleStage.jsx
            ├── DesignStage.jsx            ← 含最大化预览
            ├── PptStage.jsx               ← 含最大化预览
            ├── LectureStage.jsx           ← 含最大化阅读模式
            ├── QuizStage.jsx
            ├── HomeworkStage.jsx
            ├── MicroVideoStage.jsx        ← + 📄 导出 Word 按钮 ⭐
            ├── ReportStage.jsx            ← 含最大化预览
            └── MyWorkbench.jsx            ← 教师日志（前称"我的工作台"）
```

---

## 关键约束（CLAUDE.md H1-H14）

- **H1**：`contracts.js` 是核心契约，改它需要明确批准（v4.3.3 已批 1 次：6→8 阶段）
- **H2**：禁止在 `index.js` 加 IPC handler，必须写到 `ipc/v2/*.handlers.js`
- **H4**：`scripts/legacy/` 老脚本不可删，可作历史参考
- **H5**：AI Prompt 必须放 `prompts/*.md`，不可硬编码
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
| **v4.3.3 Codex审计R1** | 2026-05-30 | **Bug1 真根因** createArtifact 存 metadata + 统一多来源节次解析（quiz/homework/report 防串课）+ migration 005 回填 + 进度表输入边界 + 讲稿分段朗读 |
| v4.3.3 老师反馈 | 2026-05-29 | Bug1 测验找 PPT 回退 + Bug2 报告解锁提示 + 功能3 进度表可编辑 + 功能4 卡通老师助手 + 功能5 讲稿朗读 |
| v4.3.3 dcecca8 | 2026-05-20 | **Round 19 收口** · 导出物级语义验证 + report 5 段法字段保留 + micro-video 5 字段对齐 |
| v4.3.3 f61216b | 2026-05-20 | **Round 18 · 端到端测试报告 4 项修复** · A web-extractor / B 微课 Word 导出 / C 三入口 schema 守卫 / D Vision 可观测 |
| v4.3.3 238d8a6 | 2026-05-20 | **新 icon（绿底金马·驭字）** + 4 个预览页面最大化 + 排版升级 |
| v4.3.3 304ca17 | 2026-05-19 | Round 17 · report-upstream.helper 抽独立模块 + 10 条真行为单测 |
| v4.3.3 dc5ec0f | 2026-05-19 | Round 16 · saveReport 新建分支补血缘 + 抽 helper |
| v4.3.3 1b95456 | 2026-05-19 | Round 15 · 真实报告血缘 + mock 报告吃 8 阶段 + 全工程老注释扫描 |
| v4.3.3 b0b005c | 2026-05-19 | Round 14 · report 真正吃 8 阶段（quiz/homework 读取）+ schedule validator + 5 项修复 |
| v4.3.3 b57607d | 2026-05-19 | Round 13 · mock E2E 升级 8 阶段闭环 + validator strict + video_prompt validator |
| v4.3.3 43dc4c5 | 2026-05-19 | Round 11 · verify:e2e:mock 7 阶段闭环 + H14 反兜底 + runner failed 计入 |
| v4.3.3 8a0bc9a | 2026-05-19 | Round 10 · migration runner 抽离 + artifact validator + 真实使用路径工程化 |
| v4.3.0 | 2026-05-18 | D6-D9 · 讲稿一步出稿 + 右侧 AI 对话 + PPT 骨架自动预填 + 三路径自动保存 |
| v4.2.0 | 2026-05-17 | 6 阶段架构升级（PPT 在 lecture 前）+ 会话上下文 |
| v4.1.4 | 2026-05-16 | 多节课模式 + 9 维度质量审核 |
| v4.0.0 | 2026-05-10 | 6 阶段工作流首版（Phase-9 完成）|

---

## 致谢

- **设计 / 老师反馈**：Baggio（项目方）+ 试用老师群
- **技术实现**：Claude Code（Anthropic Claude Opus 4.7 / Sonnet 4.5）
- **AI 模型**：火山引擎（豆包）系列 endpoint
- **结构性诊断 + 19 轮代码审计**：Codex AI 代理

---

> 📚 治理结构：[`CLAUDE.md`](CLAUDE.md) + [`.claude/README.md`](.claude/README.md)
> 📦 当前安装包：[`dist/驭课Agent-v4.3.3-setup.exe`](dist/) · 240 MB · 2026-05-20
