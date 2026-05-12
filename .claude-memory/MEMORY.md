# MEMORY.md — 驭课 Agent 长期记忆索引

> **使用规则**：每次新会话开始时，先读本文件，了解项目历史坑点和关键决策，再开始工作。
> **更新规则**：每完成一个阶段，在本文件记录新的学到的内容和决策。
> **最后更新**：2026-05-10（v4.0.0 Phase-9 完成，6 阶段工作流落地，134/134 verify ✅）

---

## 〇、当前阶段速览（2026-05-10）

| 项 | 详情 |
|---|---|
| 当前版本 | **v4.0.0**（驭课 Agent，前身"刘老师 Agent 2.x" 已废弃）|
| 当前阶段 | **Phase-9 完成**（6 阶段工作流重构 + 多节课讲稿 + AI 信息图 + 4 格式报告导出）|
| 累计 verify | 134/134（5 个 Phase-9 新脚本，含 contracts-v6 / schedule / design / micro-video / report）|
| 下一阶段 | 等老师试用反馈 → Phase-10 体验打磨 |

---

## 〇·二、Phase-9 必看陷阱清单（2026-05-10 新增）

详细见 `.claude/notes/2026-05-10-phase9-technical-lessons.md` + `.claude/phases/phase-9.md`

10 条核心经验：

1. **函数同名多副本要 grep 全局** — `renderHtmlToPngBuffer` 在 3 处独立定义
2. **preload + main 改动必须完整重启 Electron** — HMR 不重载这两层
3. **AI endpoint 调用必带 fallback** — doubao `ep-m-...` 不支持 json_object
4. **capturePage 截断 bug** — 必须 useContentSize + setContentSize + 显式 rect
5. **prompt 反例清单 > 正面约束** — 给 AI 5 条"❌ 反例"比说"不要做 X"有效 10 倍
6. **真实日志诊断 1 分钟 vs 截图猜 30 分钟** — 第一次失败立刻加 console.log
7. **看到"故意不做 X"注释要怀疑** — 可能是矫枉过正
8. **H1 例外必须有 verify 兜底** — Phase-9 改 contracts.js 写 verify-contracts-v6.js
9. **db 方法名先 grep 确认** — 防御性 if 容易掩盖拼写错误
10. **每个长操作给 UI 反馈** — 老师不会原谅"60 秒静默"

---

## 一、Phase-4 三个关键 Bug（已修复，但要记住坑）

### Bug-1：讲稿字数不足

**现象**：正式稿生成只有 1421~1711 字，严重不达标。  
**根因**：`formal-generator.js` 的 `buildSectionExpansion` 扩展池太浅（每 section 只有 2 句），`expandLectureNarration` 循环只跑 3 轮。  
**修复**：扩展池改为 4-5 句，循环增强到 5 轮。  
**教训**：修改扩展逻辑时，一定要先跑 `verify-lecture-generation.js` 确认 teacherNarrationCharCount ≥ 2204。

### Bug-2：规则文本泄露（openingRule 出现在输出里）

**现象**：生成的讲稿开头出现元提示内容（如 "开场规则：...开始讲话"）。  
**根因**：`formal-generator.js` 把 `openingRule` 字符串直接拼接进了输出文本，而不是只用作 Prompt 约束。  
**修复**：openingRule 只能出现在 systemPrompt 中，不能出现在正文拼接里。  
**教训**：每次修改 formal-generator 后，检查输出里是否有"开场规则"、"讲授规则"等元字符串。验证脚本里的 `元提示泄露` 检查项就是为此设计的。

### Bug-3：寒暄重复（"大家好"出现 2 次）

**现象**：正式稿开头和某个模块开头都有"大家好，同学们好"。  
**根因**：abc-generator 的 A 稿已经含寒暄，formal-generator 合并时又添加了一次。  
**修复**：`quality.js` 新增 `repeatedGreetingCount` 检查（正则 `/大家好|同学们好|欢迎来到今天的课堂/`），生成后自动检测。  
**教训**：修改 abc-generator 的 systemPrompt 或 formal-generator 的合并逻辑时，必须验证寒暄次数 ≤ 1。

---

## 二、关键架构决策记录

### Decision-1：Stage 顺序不可改（2026-01 确定）

`framework → lecture → ppt → video` 是产品设计的核心流程，不是技术约束。  
用户（Baggio）明确：这四个阶段有严格的内容依赖——lecture 的质量依赖 framework 的完整性，不能并行。  
`contracts.js` 里的 `STAGE_REQUIREMENTS` 就是这个决策的代码化。

### Decision-2：index.js 拆分方案（2026-04-20 确定）

87 个 IPC handler 拆成 12 组文件（见 CLAUDE.md 第三节），v2-stage 按阶段拆成 4 个子文件：
- `ipc/v2/framework.handlers.js`
- `ipc/v2/lecture.handlers.js`
- `ipc/v2/ppt.handlers.js`
- `ipc/v2/video.handlers.js`

**为什么这样拆**：v2 阶段的 handler 和业务逻辑深度耦合，按 stage 分文件和 `contracts.js` 的 stage 定义保持一致。

### Decision-3：Prompt Registry 最小版本（2026-04-20 确定）

不做前置 frontmatter 版本控制、不做 includes chain、不做输出校验——这些是 P2 的事。  
最小版本就是：Prompt 写 .md 文件，代码用 `fs.readFileSync` 读。  
**为什么**：Phase-4 已经端到端稳定。单用户桌面应用，没有多人协作 Prompt 版本冲突的场景。过度工程只会增加后续维护负担。

### Decision-4：quality.js 必须保持纯函数独立（2026-01 设计，2026-04-20 强调）

`quality.js` 目前被 `abc-generator.js` 和 `formal-generator.js` 直接 require，这是违反独立验证原则的。  
但考虑到 Phase-4 已通过，暂不拆解——Phase-5 P1 目标是让 quality.js 只被 IPC handler 调用，不被生成模块直接依赖。

### Decision-5：不引入 TypeScript（长期决策）

Electron 主进程全部 CommonJS，引入 TS 需要 ts-node 或 tsc，增加构建复杂度，与现有 Vite 构建链有配置冲突风险。在单开发者的项目里，JS + JSDoc 注释就够了。

---

## 三、不稳定区域警告

以下区域代码逻辑复杂，改动容易引入 bug：

### ⚠️ formal-generator.js 分段合成逻辑

`formal-generator.js` 有一段分段合成逻辑（`segmentCount > 1`），用于超长课时（>2课时）的拆段生成。  
这段逻辑里有多处魔法数字（8000 tokens、segmentCount 计算公式）。  
**改动前必须**：先理解 `buildSegmentedSystem` 和 `mergeSegmentedOutputs` 的完整流程，搞清楚 fallback 条件。

### ⚠️ Ark API 图片生成（image-generator.service.js）

火山引擎 Ark 的图片 API（豆包图片）有：
- 异步生成（需要轮询 task status）
- 有时会返回 content_filter 拒绝（不是服务错误，是内容拒绝）
- 超时不抛异常，只返回 null

修改图片生成逻辑前，检查 `verify-image-size-normalization.js`，这个脚本覆盖了主要边界情况。

### ⚠️ PPT 页型分类（v2-stage-helpers.js classifySection）

当前 11 种页型的分类逻辑是通过关键词匹配实现的（不是 AI）。  
关键词列表在 `classifySection` 函数内硬编码，如果课程大纲结构改变（特别是广纺织专业课），分类可能失准。  
暂不改动，Phase-5 如果要支持更多专业，需要在这里扩展。

---

## 四、Phase-5 路线规划（已更新至 2026-04-21）

```
✅ Phase-5A：IPC 拆分（index.js → 14 组 handler 文件，全部完成）

✅ Phase-5B：上下文富化 + AI 审核 + UI 修复（2026-04-21 完成）
  → 5 个新 notebook 字段（softwareTools/jobTargets/industryScenarios/learnerProfile/teachingMaterials）
  → AI Research 建议服务（research.service.js），修复 chatJson 守卫 bug
  → 讲稿生成后 AI 审核 + 自动修订一次（hasRichContext 触发）
  → 导出质量提升（Word/PPT/信息图 注入课程上下文）
  → UI：切换笔记本状态污染修复、编辑上下文弹窗、质量卡片样式
  → framework-schema.js 用户友好错误消息

✅ Phase-5C：真正的 Agent 架构（2026-04-21 全部完成）
  → Step1 ✅ Auto-Retry Loop — retry-loop.js，≤3 次内部重试 + 质量反馈注入
  → Step2 ✅ Cross-Stage Context — context-builder.js，框架目标/方法注入讲稿 Prompt
  → Step3 ✅ Agent Orchestrator — orchestrator.js + agent.handlers.js + V2App UI
  → Step4 ✅ Cross-Session Memory — memory.js，db agent_memories，关键词相似检索
  → Step5 ✅ Backtracking — 讲稿 2 次失败 → 清空讲稿 → 重生成框架 → 重走讲稿链

  新增文件：src/main/agent/{retry-loop,context-builder,orchestrator,memory}.js
  新增文件：src/main/ipc/agent.handlers.js
  验证脚本：scripts/verify-agent-memory.js (18/18 ✅) + verify-agent-orchestrator.js (12/12 ✅)

✅ Phase-5D：baoyu-skills 集成 + PPT 配图升级（2026-04-24 完成）

  Phase A — SVG 教学结构图生成
  → 新增：src/main/services/diagram.service.js（generateDiagram）
  → 新增：prompts/diagram.md（4 类型图：层次/流程/思维导图/时间轴）
  → 更新：media.handlers.js（v2:generateDiagram）
  → 更新：FrameworkStage.jsx（4 种图类型按钮 + SVG 内联预览 + 下载链接）
  → 更新：preload/index.js（generateDiagramV2）

  Phase B — 信息图 5 布局 × 4 风格升级
  → 更新：infographic-card.service.js（LAYOUT_SPECS/STYLE_SPECS + buildEnhancedPrompt）
  → 更新：media.handlers.js（v2:getInfographicOptions + layout/visualStyle 参数）
  → 更新：FrameworkStage.jsx（布局/风格下拉选择器）
  → 更新：preload/index.js（getInfographicOptionsV2）

  Phase C — 知识点卡片 HTML 导出
  → 新增：src/main/export/knowledge-cards.js（纯模板，无 AI 调用）
  → 更新：export.handlers.js（v2:exportKnowledgeCards）
  → 更新：FrameworkStage.jsx（导出按钮）
  → 更新：preload/index.js（exportKnowledgeCardsV2）

  方向三 — 教师 PPT 配图控制层（封面→锁定→批量）
  → 更新：V2App.jsx（handleGenerateCoverImage/handleConfirmCoverStyle/handleBatchGenerateImages + 风格锚点状态）
  → 更新：PptStage.jsx（三步走配图面板：封面生成→风格锁定→批量生成 + 进度条）
  → 机制：coverConfirmed + styleAnchor 字符串注入所有后续页面图片 Prompt

  下一步：广纺织学校验收测试
```

### ⚠️ 关键 Bug 记录（Phase-5B 修复，防止回退）

**Bug-4：research.service.js 守卫条件错误**
- 现象：点「AI 建议」报错「未提供有效的 AI 客户端」，即使 API Key 配置正确
- 根因：守卫条件检查 `typeof aiClient.chat !== 'function'`，但 ArkCourseClient 只有 `chatJson()`
- 修复：改为 `typeof aiClient.chatJson !== 'function'`
- 教训：**ArkCourseClient 没有 chat() 方法，只有 chatJson()。任何新 AI 服务的守卫都要用 chatJson**

**Bug-5：切换笔记本状态污染**
- 现象：从课程 A 切换到课程 B，B 的状态栏显示 A 的提示信息
- 根因：`setAssistantStatus` 用了条件保留逻辑 `|| prev`，切换时不强制覆盖
- 修复：`loadNotebookContext` 中直接 force overwrite，同时清空 lectureReview/researchResult/researchBusy
- 教训：切换笔记本时必须清空所有与「当前课程」相关的 React 状态

---

## 五、环境与部署要点

- **开发启动**：`npm run dev`（scripts/dev.js 同时启动 Vite + Electron）
- **打包**：`npm run build`（先 Vite build → 再 electron-builder）
- **打包输出**：`dist/刘老师课程助手v2版-setup.exe`
- **SQLite 数据库**：用户数据存在 Electron `userData` 目录，不在项目目录
- **API Key 存储**：存在 Electron store（不是 .env），通过 `settings:saveApiKey` 接口写入
- **Windows only**：项目只构建 Windows NSIS 安装包，不支持 Mac/Linux

---

## 六、详细决策记录（文件链接）

> 完整决策背景在以下文件：

- `decisions/ipc-split-2026-04-20.md` — IPC 拆分方案完整讨论
- `decisions/prompt-registry-2026-04-20.md` — Prompt Registry 选型讨论
- `pitfalls/formal-generator-pitfalls.md` — formal-generator 历次修复记录
- `pitfalls/quality-rules-pitfalls.md` — quality 规则的踩坑记录

（以上文件待填充）

---

## 七、联系上下文

| 文件 | 作用 |
|------|------|
| `CLAUDE.md` | Claude Code 工作约束（本次写入） |
| `CONTEXT.md` | 当前阶段快照（Phase-4 完成状态） |
| `docs/course-designer审查报告_HarnessEngineering视角.md` | 完整审查报告，含 8 大缺陷分析和代码取证 |
