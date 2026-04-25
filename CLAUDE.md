# CLAUDE.md — 刘老师课程助手 v2 项目约束文件

> **这是 Claude Code 工作的框架文件。**
> 本文件规定的内容必须遵守，不得以"更优雅"、"更规范"为由自行推翻。
> 有疑问先问，不要自行判断后执行。
> **最后更新：2026-04-25（v2.1.0 发布 + Phase-5D 完成 + Step A/B/C 修复：DB 持久化 + UI 实时进度 + confirm 解锁）**

---

## 一、项目基本信息

| 项目 | 刘老师Agent2.1（ai-course-designer） |
|------|----------------------------------------|
| 版本 | **v2.1.0** |
| 技术栈 | Electron 28 + React 18 + SQLite + Deepseek/Ark API |
| 当前状态 | **Phase-5D 完成**（Agent 扩展至 PPT + 视频阶段，四阶段全自动流水线） |
| **战略目标** | **在广纺织学校验收测试通过 → 商业化推广** |
| **下一阶段** | **Phase-6：前端 Agent 状态面板增强 + 广纺织学校验收准备** |
| 代码规模 | ~19,000 行 JS |
| 核心约束 | Harness Engineering — 模型是不稳定组件，框架约束它 |

---

## 二、绝对禁区（8 条硬约束）

> **违反任何一条，必须停下来问用户，不能自行处理。**

### H1：不要修改 contracts.js
`src/main/v2/contracts.js` 定义了 Stage 依赖链，是整个系统的命脉：
```
framework → lecture → ppt → video
```
任何 stage 顺序、依赖关系的改动都会破坏已通过测试的端到端链路。
**⛔ 只读，不改。有需要就问。**

### H2：不要在 index.js 添加新 IPC handler
IPC 拆分已完成（Phase-5A），所有 handler 在 `src/main/ipc/` 文件里。
新 handler 必须写进对应的 handler 文件，通过 `_registry.js` 注册。
**⛔ 拒绝向 index.js 追加任何 ipcMain.handle / ipcMain.on。**

### H3：不要让 quality.js 依赖生成模型
`src/main/v2/quality.js` 是独立验证层，只能做纯函数计算（字数、正则匹配、结构检查）。
它不能 require/import 任何 API 客户端，不能发出网络请求。
**⛔ 验证层独立，不允许 quality.js 调用 AI。**

### H4：不要删除或重命名 Phase-4 验证脚本
`tests/verify-*.js` 和 `tests/e2e-*.js` 是回归防护网，Phase-4 全部通过。
**⛔ 只能增加脚本，不能删除或重命名已有脚本。**

### H5：不要直接写 Prompt 到代码里
新增的 AI Prompt 必须写入 `prompts/` 目录的 .md 文件，通过 `src/main/ipc/prompt-registry.js` 加载。
**⛔ 不允许在业务代码里新增内联字符串 Prompt（已有的暂不动，等待迁移）。**

### H6：不要在单次任务中同时重构多个模块
每次任务范围：一个 handler 文件 **或** 一个 service 文件 **或** 一个 prompt 文件。
**⛔ 不允许"顺手"修改任务范围之外的文件，除非明确指示。**

### H7：不要跳过验证直接交付
每次修改代码后，必须告诉用户应该运行哪个验证脚本，不能自己声称"应该没问题"。
**⛔ 没有验证结果的修改不算完成。**

### H8：不要修改 node_modules 之外的 package.json 依赖项
新增依赖前必须先问用户，说明：用途、包大小、是否有同类已有依赖可替代。
**⛔ 不允许自行 npm install 新包。**

---

## 三、IPC Handler 文件地图（Phase-5A 已完成）

> **状态：全部 87 个 handler 已迁移完毕，index.js 只做启动+注册。**

```
src/main/
├── index.js              ← 只做启动+路由注册（已精简）
└── ipc/
    ├── _registry.js           ← 统一注册入口 ✅
    ├── notebook.handlers.js   (6 handlers，含 notebook:update + notebook:generateResearch) ✅
    ├── module.handlers.js     (7 handlers) ✅
    ├── framework.handlers.js  (7 handlers，含 ai:generateFramework) ✅
    ├── course.handlers.js     (6 handlers) ✅
    ├── lecture.handlers.js    (4 handlers，含 script:generateABC/Formal + quality:audit) ✅
    ├── v2/
    │   ├── framework.handlers.js  (4 handlers) ✅
    │   ├── lecture.handlers.js    (3 handlers) ✅
    │   ├── ppt.handlers.js        (4 handlers) ✅
    │   └── video.handlers.js      (7 handlers) ✅
    ├── export.handlers.js     (8 handlers，word/ppt/quiz/html/pbl/zip) ✅
    ├── resource.handlers.js   (11 handlers) ✅
    ├── media.handlers.js      (7 handlers，含 v2:generateFrameworkInfographic) ✅
    ├── prompt.handlers.js     (8 handlers，LEGACY_DISABLED 模式) ✅
    └── system.handlers.js     (7 handlers，schedule/settings/util/workspace) ✅
```

**Agent 新 handler 规范**：Phase-5C 新增的 Agent IPC handler 放入 `src/main/ipc/agent.handlers.js`，
通过 `_registry.js` 注册，不允许写入其他已有文件。

---

## 四、Prompt Registry 规范

所有 Prompt 文件放在 `prompts/` 目录，文件命名规则：

```
prompts/
├── abc-system.md          ← abc-generator.js 的 systemPrompt
├── formal-system.md       ← formal-generator.js 的 segSystemPrompt
├── framework-gen.md       ← 框架生成 prompt
├── ppt-image.md           ← PPT 图片生成 prompt
├── infographic.md         ← 信息图 prompt
├── video-shot.md          ← 视频分镜 prompt
└── agent/                 ← Phase-5C 新增（Agent 相关 prompt）
    ├── orchestrator.md    ← Agent 决策循环的 system prompt
    ├── review.md          ← AI 审核 prompt（已在 lecture.handlers 里内联，待迁移）
    └── research.md        ← 课程研究建议 prompt（已在 research.service 里内联，待迁移）
```

加载方式（最小版本）：
```javascript
// src/main/ipc/prompt-registry.js
const fs = require('fs');
const path = require('path');
const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

module.exports = { loadPrompt };
```

**规则**：不允许在 loadPrompt 外引入版本控制、include chain、frontmatter 解析（Phase-5 P2 再做）。

---

## 五、验证矩阵

修改了什么 → 必须运行什么：

| 修改范围 | 必须运行的验证 |
|---------|--------------|
| abc-generator.js / abc-system.md | `node scripts/verify-lecture-generation.js` |
| formal-generator.js / formal-system.md | `node scripts/verify-lecture-generation.js` |
| v2/quality.js | `node scripts/verify-lecture-generation.js` + `node scripts/verify-v2-response-shape.js` |
| export/word.js | `node scripts/verify-word-export.js` + `node scripts/e2e-framework-word.js` |
| export/ppt.js | `node scripts/e2e-ppt-export.js` |
| v2/contracts.js（禁止改，仅参考） | 全套 11 个 verify 脚本 |
| ipc/*.handlers.js（新迁移/新增） | `npm run dev` 启动验证 + 对应功能的手动点测 |
| v2/runtime.js | `node scripts/verify-artifact-tracker.js` + `node scripts/verify-task-runtime-events.js` |
| services/infographic-card.service.js | `node scripts/verify-export-runtime.js` |
| services/research.service.js | 手动测试「AI 研究建议」按钮（需 API Key） |
| database/db-simple.js | 全套 11 个 verify 脚本 |
| agent/orchestrator.js（Phase-5C/5D 改动） | `node scripts/verify-agent-orchestrator.js` + `npm run dev` 手动点测「一键生成全部阶段」 |
| ipc/agent.handlers.js（Phase-5D 改动） | `npm run dev` 启动验证 + 手动点测 agent:run + agent:getStatus |
| ipc/v2/ppt.handlers.js（Phase-5D 改动） | `node scripts/e2e-ppt-export.js` + 手动点测 v2:generatePptPlan |
| agent/context-builder.js | `npm run dev` 验证讲稿→PPT 上下文注入正常 |

**不确定运行哪个？告诉用户修改了什么，让用户决定。**

---

## 六、停下来问用户的触发条件

遇到下列任何一种情况，**必须暂停并向用户说明，不能自行决定**：

1. **改动涉及 contracts.js / publication-contracts.js** — 停下来说明影响
2. **需要新增一个 AI API 调用** — 说明用途、token 估算、fallback 方案
3. **重构范围超过 2 个文件** — 说明为什么需要跨文件改动
4. **有现有测试脚本会 FAIL** — 不要修改脚本去适配，先告知用户
5. **要引入新的 npm 包** — 说明理由和替代方案
6. **发现 quality.js 或 abc-generator.js 的逻辑疑似有 bug** — 说明，不要自己改
7. **同一个 prompt 逻辑在多处地方存在** — 说明，等迁移到 Registry 再统一
8. **Stage 状态机有任何不确定的地方** — 说明，不要猜测
9. **Agent 决策逻辑修改可能影响已有 Stage 流程** — 说明影响范围，不要自行判断

---

## 七、代码风格约束

- **语言**：全项目 JavaScript（CommonJS），不引入 TypeScript
- **模块系统**：`require` / `module.exports`，不混用 ESM（Electron 主进程 CommonJS 约束）
- **异步**：`async/await`，不使用 `.then()` 链，不使用回调嵌套
- **错误处理**：所有 IPC handler 必须有 `try/catch`，错误必须 `return { success: false, error: e.message }`，不 throw 到外层
- **日志**：console.log 用于调试可以保留，生产代码不加 console.error 静默吞异常
- **注释**：函数超过 30 行必须有说明注释，说明"做什么" not "怎么做"
- **文件大小**：单个文件不超过 600 行，超过则拆分（handler 文件不超过 300 行）

---

## 八、关键文件速查

| 功能 | 文件 | 备注 |
|------|------|------|
| Stage 依赖定义 | `src/main/v2/contracts.js` | ⛔ 只读 |
| 讲稿 A/B/C 生成 | `src/main/script/abc-generator.js` | 核心 AI 逻辑 |
| 正式稿合成 | `src/main/script/formal-generator.js` | 分段合成复杂逻辑 |
| 质量校验 | `src/main/v2/quality.js` | 纯函数，禁 AI 调用 |
| Word 导出 | `src/main/export/word.js` | 含六列教学过程表 + 讲稿样式块 |
| PPT 导出 | `src/main/export/ppt.js` | 11 种页型，封面含软件/年级信息 |
| 信息图生成 | `src/main/services/infographic-card.service.js` | HTML→PNG，含软件/岗位上下文 |
| 课程研究建议 | `src/main/services/research.service.js` | AI 知识库建议，调用 chatJson() |
| v2 运行时 | `src/main/v2/runtime.js` | Stage 状态机 |
| 框架 Schema | `src/main/api/framework-schema.js` | 含用户友好错误消息 |
| 数据库 | `src/main/database/db-simple.js` | SQLite |
| AI 客户端创建 | `resolveProviderConfig + createAiClientByConfig` | 在各 handler 内使用 |
| 长期记忆 | `.claude-memory/MEMORY.md` | 每次开始前读一遍 |
| 阶段上下文 | `CONTEXT.md` | 当前阶段快照 |
| **Agent 编排器** | **`src/main/agent/orchestrator.js`** | **Phase-5D 已完成：支持 framework/lecture/ppt/video 四阶段** |
| **Agent 记忆层** | **`src/main/agent/memory.js`** | **Phase-5C 已完成** |
| **跨阶段上下文** | **`src/main/agent/context-builder.js`** | **buildLectureContext + buildPptContext 均已接入** |
| **PPT 规划生成器** | **`src/main/script/ppt-plan-generator.js`** | **AI 驱动，支持从 DB 自动读取讲稿** |
| **视频提示词模板** | **`src/shared/v2-stage-helpers.js`** — `videoPrompt()` | **主进程 + 渲染进程共用** |

---

## 九、开始工作前的检查清单

每次新会话开始，**Claude Code 必须先做**：

- [ ] 读 `CLAUDE.md`（本文件）
- [ ] 读 `.claude-memory/MEMORY.md`（长期记忆）
- [ ] 读 `CONTEXT.md`（当前阶段状态）
- [ ] 确认任务范围，如有疑问先问

**不允许跳过上述步骤直接开始写代码。**

---

## 十、Phase-5C 战略目标：真正的 Agent 架构

> **这是当前最高优先级任务。用户明确指示：不谈时间，连续工作直到完成。**
> **商业目标：广纺织学校验收测试通过 → 商业化推广。**

### 10.1 为什么要做 Agent 架构

当前是「Pipeline Orchestrator」（流水线编排器），不是真正的 Agent：

| 维度 | 当前状态（Pipeline）| 目标状态（Agent）|
|------|-------------------|----------------|
| 决策主体 | 用户点按钮驱动 | AI 自主决策下一步 |
| 错误响应 | 报错给用户，用户手动重试 | 自动检测 → 自动调整策略 → 自动重试 |
| 跨阶段感知 | 每阶段独立，不读其他阶段内容 | 讲稿质量差 → 自动回溯重生成框架 |
| 工具编排 | 固定顺序 framework→lecture→ppt→video | 动态选择工具调用顺序 |
| 记忆 | 当前课程内，会话结束即丢 | 跨会话记忆历史课程成功案例 |

### 10.2 五个核心实现维度

#### 维度 1：决策主体（Agent Orchestrator）
- 新建 `src/main/agent/orchestrator.js`
- 接收目标（如「为《XX课程》完成完整课件设计」）
- 读取当前 Stage 质量数据（通过 `v2/quality.js`）
- 调用 LLM 决策下一步动作（工具选择 + 参数）
- 执行 → 评估 → 循环
- **绝不绕过 contracts.js 的 Stage 依赖约束**

#### 维度 2：自动重试（Auto-Retry Loop）
- 每次生成后，自动调用 `quality.js` 验证
- 若验证不通过（errors 不为空），自动调整 prompt 参数重试
- 最多重试 N 次（默认 3 次），超出则报告给用户
- 重试时在 prompt 里追加「上次问题：{errors}，请针对性改进」

#### 维度 3：跨阶段感知（Cross-Stage Awareness）
- 讲稿审核分数 < 6 → Agent 自动回溯到框架阶段重生成
- PPT 图片质量差 → 自动调整图片 prompt 参数重试
- 每个 Stage 生成时，自动读取上游 Stage 的内容作为 context

#### 维度 4：工具编排（Dynamic Tool Selection）
- Agent 决策时，从可用工具列表中动态选择
- 工具列表 = 当前已有的 IPC handler + 质量验证函数
- Agent 可以选择跳过某个阶段（如用户已有现成框架）

#### 维度 5：跨会话记忆（Cross-Session Memory）
- 新建 `src/main/agent/memory.js`
- 成功完成的课程存入 SQLite `agent_memories` 表
- 新课程生成时，检索相似课程的成功 prompt 参数作为参考
- 使用关键词匹配（不引入向量数据库，保持零依赖）

### 10.3 实施顺序（按商业价值排序）

```
Step 1：Auto-Retry Loop（最快见效，当前最痛点）
  → 在 lecture.handlers.js 的 generateFormal 里加重试逻辑
  → 质量不达标自动重试最多 3 次
  → 预计影响文件：ipc/lecture.handlers.js（1 个文件）

Step 2：Cross-Stage Context Injection（提升内容相关性）
  → 每个 Stage 生成时，自动把上游 Stage 的关键内容塞进 prompt
  → 预计影响文件：ipc/framework.handlers.js, ipc/lecture.handlers.js（2 个文件）

Step 3：Agent Orchestrator（核心架构）
  → 新建 src/main/agent/orchestrator.js
  → 新建 src/main/ipc/agent.handlers.js（注册到 _registry.js）
  → 前端新增「一键完成全部阶段」按钮（V2App.jsx 增加入口）

Step 4：Cross-Session Memory（商业化差异化功能）
  → 新建 src/main/agent/memory.js
  → 数据库新增 agent_memories 表（db-simple.js 增加方法）
  → 生成时自动检索历史相似课程作为 few-shot 示例

Step 5：Backtracking（完整 Agent 闭环）
  → 讲稿质量分 < 6 时，Agent 自动回框架阶段重生成
  → 需要确保 Stage 回退不破坏 contracts.js 约束
```

### 10.4 Agent 架构约束（补充到硬约束之外）

- Agent 决策循环**必须有超时限制**（单次任务最长 10 分钟），超出自动停止并报告
- Agent 的每次决策和执行**必须记录到 task_runtime 操作日志**，用户可查看完整执行轨迹
- Agent **不允许修改已「confirmed」状态的 artifact**，只能生成新版本
- Agent 的 LLM 调用**必须通过 resolveProviderConfig + createAiClientByConfig** 创建客户端，不单独硬编码
- Agent **不是完全自动的**：每个 Stage 完成后推送进度通知，用户可随时中断

---

## 十一、Phase-5B 已完成内容（2026-04-21）

> **以下改动已通过 11 个 verify 脚本验证，可以作为基础继续开发。**

### 11.1 新增 Notebook 字段（5 个上下文字段）

数据库和 UI 均已支持以下字段，会自动注入到所有 AI 生成阶段的 Prompt：

| 字段名 | 含义 | 示例 |
|-------|------|------|
| `softwareTools` | 主要软件工具名+版本 | Blender 4.x, AutoCAD 2024 |
| `jobTargets` | 面向职业岗位 | 三维建模师, 机械制图员 |
| `industryScenarios` | 行业应用场景 | 影视特效制作, 建筑可视化 |
| `learnerProfile` | 学情说明 | 已学 PS 基础，零三维经验 |
| `teachingMaterials` | 教材/课标 | 《Blender三维设计》高教出版社 |

### 11.2 AI 研究建议功能（Research Service）

- **入口**：笔记本创建/编辑时点「AI 建议」按钮
- **服务**：`src/main/services/research.service.js`
- **关键修复**：守卫条件从 `chat()` 改为 `chatJson()`（ArkCourseClient 只有 chatJson）
- **返回结构**：softwareTools / jobTargets / industryScenarios / courseStandards / learnerProfile / summary

### 11.3 讲稿 AI 审核（Review Loop）

- **触发条件**：`hasRichContext`（softwareTools 或 jobTargets 非空时）
- **流程**：生成正式稿 → 调用 AI 审核 → 分数 < 8 时自动修订一次
- **UI 展示**：LectureStage.jsx 里的 `.v2-review-panel`，显示分数/issues/是否已修订
- **Handler 位置**：`src/main/ipc/lecture.handlers.js`（`script:generateFormalLecture`）

### 11.4 导出质量提升

| 文件 | 改动 |
|------|------|
| `export/word.js` | 讲稿 Word 含课程元数据表 + 教师讲述/课堂动作样式区分 |
| `export/ppt.js` | 封面含年级/学时/软件工具信息 |
| `services/infographic-card.service.js` | 信息图模板含软件工具和岗位上下文 |
| `services/media.handlers.js` | 信息图生成时注入 software_context + job_context |

### 11.5 UI 修复

| 修复项 | 文件 |
|-------|------|
| 切换笔记本时 assistantStatus 不再残留上一个课程的状态 | V2App.jsx |
| 切换笔记本时清空 lectureReview / researchResult / researchBusy | V2App.jsx |
| 新增「✏️ 编辑课程上下文」按钮和完整编辑弹窗 | V2App.jsx |
| 质量报告红色/黄色区块样式（`.v2-quality-block`） | v2.css |
| 讲稿 AI 审核面板样式（`.v2-review-panel`） | v2.css |

### 11.6 框架 Schema 用户友好错误消息

`src/main/api/framework-schema.js` — 所有 validate 错误改为「问题描述 → 如何修复」格式，
例如：`"缺少 objectives"` → `"教学目标尚未生成 → 请进入「教学框架」阶段，点击「生成框架」重新生成"`

---

## 十二、Phase-5D 已完成内容（2026-04-25）

> **Agent 架构从"仅 framework+lecture"扩展至完整四阶段流水线。**

### 12.1 本次会话完成的修复（PPT 质量）

| 修复项 | 文件 |
|-------|------|
| PPT 双标题 bug（addHeaderBlock 重复调用） | `export/ppt.js` |
| AI 图片文字烘焙（Hero 页提示词含"PPT章节页"等触发 Seedream 渲染文字） | `src/renderer/src/v2/stage-helpers.js` + `src/shared/v2-stage-helpers.js` |
| 路线图只显示 4 个模块（filter 未匹配"模块导入"pageType） | `export/ppt.js` — `buildRouteItemsFromPages` |
| 视频提示词格式升级为即梦分段 Markdown 格式（4 段×15秒） | `src/renderer/src/v2/stage-helpers.js` — `videoPrompt()` |
| 即梦视频提示词样例输出 | `店铺三维表现_即梦视频提示词.md`（桌面） |

### 12.2 Agent 四阶段流水线（Phase-5D 核心）

**新增动作（`decideNextAction` 规则引擎）：**

| 动作 | 触发条件 | 执行函数 |
|------|---------|---------|
| `generate_ppt_plan` | `needs('ppt')` + `pptPageCount === 0` + 重试 < 2 | `execGeneratePptPlan` |
| `generate_video_prompt` | `needs('video')` + `!videoPromptExists` + 重试 < 1 | `execGenerateVideoPrompt` |

**状态评估（`assessNotebookState` 新增字段）：**
- `pptPageCount` — 读 `ppt_outline` artifact 的 `pptPages.length`
- `videoPromptExists` — 读 `video_prompt` artifact 的 `promptText` 是否非空

**默认 targetStages 变更：**
```
旧：['framework', 'lecture']
新：['framework', 'lecture', 'ppt']   ← agent:run 默认值
```
`maxSteps` 也从 12 提升至 15，适应多阶段流水线。

### 12.3 buildPptContext 跨阶段上下文正式接入（ppt.handlers.js）

- `v2:generatePptPlan` handler 新增：优先使用前端传入的 `lectureScript`；若为空，从 DB 的 `lecture_final` artifact 自动读取
- `buildPptContext` 已 import，`pptCtx.lectureSections` 可供后续扩展使用

### 12.4 修改文件清单

| 文件 | 变更性质 |
|------|---------|
| `src/main/agent/orchestrator.js` | PPT + 视频阶段支持，新增 2 个 exec 函数，共 +110 行 |
| `src/main/ipc/agent.handlers.js` | 默认 targetStages 扩展，v2Runtime 传入，getStatus 增 ppt/video |
| `src/main/ipc/v2/ppt.handlers.js` | buildPptContext 接入，从 DB 自动读取讲稿 |
| `src/renderer/src/v2/stage-helpers.js` | Hero 图片提示词去烘焙，videoPrompt 即梦格式重写 |
| `src/shared/v2-stage-helpers.js` | Hero + 内容页图片提示词去烘焙（2 个函数） |
| `src/main/export/ppt.js` | 双标题修复 + 路线图 4→5 模块修复 |

### 12.5 验收测试建议

```bash
# 基础验证
node scripts/e2e-ppt-export.js
node scripts/verify-agent-orchestrator.js   # 21 个 test case 全通过

# Agent 四阶段流水线验证（需 API Key）
npm run dev
# → 打开任意有讲稿的课程
# → 点击 Agent「一键生成全部阶段」
# → 预期：framework → lecture → ppt 自动完成，stepLog 含 generate_ppt_plan 步骤

# Agent 状态查询验证
# → 调用 agent:getStatus(notebookId)
# → 预期返回包含 ppt: { pageCount, hasPages } 和 video: { hasPrompt }
```

### 12.6 Step A/B/C 修复（2026-04-25 本次会话完成）

**Step A — 前端 targetStages 修正（V2App.jsx）**

`handleAgentRun` 函数中硬编码 `targetStages: ['framework', 'lecture']`，覆盖了后端默认值。已修正为 `['framework', 'lecture', 'ppt']`。

**Step B — Agent 持久化 Bug 修复（orchestrator.js）**

根本问题：`execGenerateLectureABC` 和 `execGenerateLectureFormal` 只调用 `patchCourseProject`（内存修改），不写 DB artifacts。`assessNotebookState` 读 `db.getLatestArtifact(...)` 永远找不到内容，导致无限循环。

修复方案（在 `run()` 循环的执行块里，每步之后调用 v2Runtime 持久化）：

| 步骤 | 持久化操作 | 效果 |
|------|-----------|------|
| `generate_lecture_abc` 后 | `v2Runtime.saveLectureStage({ drafts, finalScript:'' })` | `lecture_drafts` 写入 DB，下次状态评估读到 draftCount=3 |
| `generate_lecture_formal` 后 | `v2Runtime.saveLectureStage({ finalScript })` + 若 quality.valid → `confirmLectureStage` | `lecture_final` 写入 DB；confirm 触发 `syncWorkflowStageAvailability` 解锁 PPT 阶段 |
| `generate_ppt_plan` 后 | `v2Runtime.confirmPptStage({ pptPages, templateKey })` | ppt_outline 设 confirmed=true，解锁 Video 阶段 UI 入口 |

所有持久化失败都 catch 为非致命警告，不中断主流程。

**Step C — 前端 UI 更新（V2App.jsx）**

| 修复项 | 说明 |
|-------|------|
| `step.status` → `step.result` | stepLog CSS 类名用错字段名，导致全部步骤显示为 `warn` 样式 |
| 实时进度轮询 | 每 3s 调用 `api.agentGetStatus` 显示"框架✓ \| 正在生成讲稿…"风格的进度文字 |
| PPT 阶段 chip | 新增「🖼️ PPT 规划」chip，scope 描述更新为"框架 + 讲稿 + PPT 的全流程生成" |
| 初始状态文字 | 改为"正在自动完成框架 + 讲稿 + PPT 生成…" |

---

## 十三、ArkCourseClient 关键规范

> **重要：新增任何 AI 调用都必须遵守这里的规范。**

```javascript
// ✅ 正确：创建 AI 客户端的方式
const { resolveProviderConfig } = require('../utils/provider-config');
const { createAiClientByConfig } = require('../api/ai-client-factory');

const providerConfig = resolveProviderConfig(settings);
const aiClient = createAiClientByConfig(providerConfig);

// ✅ 正确：调用方式（返回字符串，不是对象）
const text = await aiClient.chatJson({ systemPrompt, userPrompt, temperature, maxTokens });
const parsed = JSON.parse(text);  // 手动解析

// ❌ 错误：ArkCourseClient 没有 chat() 方法
await aiClient.chat(...)  // 会抛出 "未提供有效的 AI 客户端" 错误

// ✅ 正确：守卫条件
if (!aiClient || typeof aiClient.chatJson !== 'function') {
  return { success: false, error: '未提供有效的 AI 客户端' };
}
```
