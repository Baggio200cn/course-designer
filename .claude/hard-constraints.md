# 硬约束 H1-H13（含元数据）

> **每条 H 约束都有"身份证"**——避免几个月后忘了为什么有这条。
> **违反任何一条必须停下来问用户，不能自行处理。**

> **元数据字段说明**：
> - 适用范围：什么情况下这条约束生效
> - 引入日期：何时加进来的
> - 最后审查：上次维护人确认仍有效的日期
> - 触发原因：为什么有这条（避免后人不知所以然就删除）
> - 负责人：维护这条约束的人
> - 过期条件：什么情况下这条约束应该被下线

---

## H1：不要修改 contracts.js

| 字段 | 内容 |
|------|------|
| 适用范围 | `src/main/v2/contracts.js` 文件 |
| 引入日期 | 2026-04-15（Phase-4） |
| 最后审查 | 2026-05-09 |
| 触发原因 | Stage 依赖链是整个系统命脉，任何 stage 顺序、依赖关系的改动都会破坏端到端链路 |
| 负责人 | Baggio |
| 过期条件 | 当 contracts.js 重构为模块化定义且有完整迁移工具时 |
| **已知例外** | **Phase-9 工作流重构（2026-05-09，Baggio 显式批准）：6 阶段架构升级**——详见 `.claude/notes/2026-05-09-phase9-h1-exception.md`。该例外不构成对 H1 的删除，未来再次修改仍需重新批准 |

`src/main/v2/contracts.js` 定义了 Stage 依赖链：

**v3.x（旧）**：
```
framework → lecture → ppt → video
```

**v4.0.0（Phase-9 起，2026-05-09）**：
```
schedule → design → lecture → ppt → video → report
```

**⛔ 只读，不改。有需要就问（Phase-9 例外已批准）。**

---

## H2：不要在 index.js 添加新 IPC handler

| 字段 | 内容 |
|------|------|
| 适用范围 | `src/main/index.js` |
| 引入日期 | 2026-04-15（Phase-5A 完成时） |
| 最后审查 | 2026-05-02 |
| 触发原因 | IPC 拆分已完成，index.js 必须保持精简（仅启动+注册） |
| 负责人 | Baggio |
| 过期条件 | 永不过期（架构纪律） |

IPC 拆分已完成（Phase-5A），所有 handler 在 `src/main/ipc/` 文件里。
新 handler 必须写进对应的 handler 文件，通过 `_registry.js` 注册。

**⛔ 拒绝向 index.js 追加任何 ipcMain.handle / ipcMain.on。**

---

## H3：不要让 quality.js 依赖生成模型

| 字段 | 内容 |
|------|------|
| 适用范围 | `src/main/v2/quality.js` |
| 引入日期 | 2026-04-18 |
| 最后审查 | 2026-05-02 |
| 触发原因 | quality.js 是独立验证层，调用 AI 会变成"AI 自评 AI"自我循环验证 |
| 负责人 | Baggio |
| 过期条件 | 永不过期（验证层独立性原则） |

`src/main/v2/quality.js` 是独立验证层，只能做纯函数计算（字数、正则匹配、结构检查）。
它不能 require/import 任何 API 客户端，不能发出网络请求。

**⛔ 验证层独立，不允许 quality.js 调用 AI。**

---

## H4：不要删除或重命名 Phase-4 验证脚本

| 字段 | 内容 |
|------|------|
| 适用范围 | `tests/verify-*.js` 和 `tests/e2e-*.js` |
| 引入日期 | 2026-04-15（Phase-4 完成） |
| 最后审查 | 2026-05-02 |
| 触发原因 | 这些脚本是回归防护网，删除/重命名会让 CI 跑不通且无人发现 |
| 负责人 | Baggio |
| 过期条件 | 当对应功能彻底移除时（需 Baggio 显式批准） |

**⛔ 只能增加脚本，不能删除或重命名已有脚本。**

---

## H5：不要直接写 Prompt 到代码里

| 字段 | 内容 |
|------|------|
| 适用范围 | `src/main/**/*.js` 中的 AI 调用 |
| 引入日期 | 2026-04-22（Phase-5） |
| 最后审查 | 2026-05-02 |
| 触发原因 | Prompt 散落代码各处导致难以版本管理、难以审计、难以替换 |
| 负责人 | Baggio |
| 过期条件 | 当所有 prompt 全部迁移到 prompts/ 后，规则升级为"删除内联 prompt" |

新增的 AI Prompt 必须写入 `prompts/` 目录的 .md 文件，通过 `src/main/ipc/prompt-registry.js` 加载。

**⛔ 不允许在业务代码里新增内联字符串 Prompt（已有的暂不动，等待迁移）。**

---

## H6：不要在单次任务中同时重构多个模块

| 字段 | 内容 |
|------|------|
| 适用范围 | 所有代码改动 |
| 引入日期 | 2026-04-25 |
| 最后审查 | 2026-05-02 |
| 触发原因 | 跨模块改动难以审查、难以回滚、容易引入意外 bug |
| 负责人 | Baggio |
| 过期条件 | 永不过期（开发纪律） |
| ⚠️ 已知违反 | 2026-05-02 Phase-8 M0+ web-extractor 改动涉及 4 个文件——已在 `notes/2026-05-02-web-extractor-cross-file.md` 记录，此次属用户明确批准的例外 |

每次任务范围：一个 handler 文件 **或** 一个 service 文件 **或** 一个 prompt 文件。

**⛔ 不允许"顺手"修改任务范围之外的文件，除非明确指示。**

---

## H7：不要跳过验证直接交付

| 字段 | 内容 |
|------|------|
| 适用范围 | 所有代码改动 |
| 引入日期 | 2026-04-22 |
| 最后审查 | 2026-05-02 |
| 触发原因 | 没有验证的改动很容易引入回归 bug |
| 负责人 | Baggio |
| 过期条件 | 当 git pre-commit hook 自动跑 verify 后，规则降级（不再需要人工提示）|

每次修改代码后，必须告诉用户应该运行哪个验证脚本，不能自己声称"应该没问题"。

**⛔ 没有验证结果的修改不算完成。**

---

## H8：不要修改 package.json 依赖项（未经允许）

| 字段 | 内容 |
|------|------|
| 适用范围 | `package.json` 的 `dependencies` / `devDependencies` |
| 引入日期 | 2026-04-22 |
| 最后审查 | 2026-05-02 |
| 触发原因 | 新增依赖会扩大攻击面、增大体积、可能与现有依赖冲突 |
| 负责人 | Baggio |
| 过期条件 | 永不过期（依赖治理原则） |

新增依赖前必须先问用户，说明：用途、包大小、是否有同类已有依赖可替代。

**⛔ 不允许自行 npm install 新包。**

---

## H9：不允许"selfCheck mock 通过 = 功能就绪"的认知

| 字段 | 内容 |
|------|------|
| 适用范围 | 所有 selfCheck / verify-*.js 脚本 |
| 引入日期 | 2026-04-28（codex 审计教训） |
| 最后审查 | 2026-05-02 |
| 触发原因 | Phase-7.5 的 17 个 verify 全过、但 Vision 审核生产环境实际永远 mock 通过 |
| 负责人 | Baggio |
| 过期条件 | 当所有 verify 都接入真实 fixture 回放后 |

每个 service 自检（selfCheck / verify-*.js）必须**至少包含 2 类用例**：

1. **契约组（mock 路径）**：验证模块在 mock 模式下的行为正确性
2. **集成组（真实路径）**：验证生产环境真实接通后能正确拦截低质量
   - 用录制的 API 响应做注入回放
   - 或用显式标记的"真实路径"测试（如 `mockMode: false` 显式断言走真实分支）

**⛔ 不允许只有 mock 用例就声明"功能就绪"。** 必须验证"真实环境下能否拦截低质量"，否则就是伪保护。

---

## H10：不允许"force accept"作为质量门槛的兜底

| 字段 | 内容 |
|------|------|
| 适用范围 | `confirmXxxStage` 函数（v2/runtime.js）|
| 引入日期 | 2026-04-28（codex 审计教训） |
| 最后审查 | 2026-05-02 |
| 触发原因 | Phase-7.5 的 framework / ppt confirm 仍 force accept，违反"质量优先"原则 |
| 负责人 | Baggio |
| 过期条件 | 永不过期（质量门槛原则） |

`confirmXxxStage` 中的 `userForceAccept: true` **不能由 Agent 内部传入**，只能由用户在 UI 上主动选择。Agent 路径下：

- 质量未达标 + 重试耗尽 → **必须调 `pauseAgent`**，不允许静默 force accept
- 配图缺失、风格不一致、内容不对应、字数不达标——一律走 `pauseAgent` 路径
- "继续完成流水线"不是 Agent 的目标；"老师拿到的输出可用"才是

**⛔ 在 Agent 代码里看到 `userForceAccept: true` 必须立即审视——它绕过了质量门槛。**

---

## H11：不允许"流程完成 = 任务完成"的判断

| 字段 | 内容 |
|------|------|
| 适用范围 | `assessNotebookState` / `decideNextAction`（agent/orchestrator.js） |
| 引入日期 | 2026-04-28（codex 审计教训） |
| 最后审查 | 2026-05-02 |
| 触发原因 | Agent 之前更擅长判断"框架/讲稿/PPT 有没有"，对"内容是否真的可用"判断不够硬 |
| 负责人 | Baggio |
| 过期条件 | 永不过期（结果导向原则） |

`assessNotebookState` / `decideNextAction` 的"完成"判断必须基于**结果达标**而非**流程跑过**：

- ❌ "framework artifact 存在" = framework 完成
- ✅ "framework artifact 存在 + quality.valid + 必填字段齐全 + 用户未标 manual_review" = framework 完成
- 类似规则适用于 lecture / ppt / framework_infographic / knowledge_cards / ppt_images

**⛔ 不允许在 decideNextAction 中只检查 "exists / count > 0"，必须检查 "quality 通过 + 无 needsManualReview 标志"。**

---

## H12：不允许业务关键路径绕过 prompt-assembler

| 字段 | 内容 |
|------|------|
| 适用范围 | 所有 LLM 调用的 systemPrompt 构造 |
| 引入日期 | 2026-04-28（codex 审计教训） |
| 最后审查 | 2026-05-02 |
| 触发原因 | ppt-plan-generator.js 直接读 prompts/ppt-plan.md，绕过了 source-registry 治理体系 |
| 负责人 | Baggio |
| 过期条件 | 永不过期（治理体系完整性） |

所有 LLM 调用的 systemPrompt 装配**必须**走以下路径之一：

1. `prompt-assembler.assemble(items)` — Fragment 装配主路径
2. `prompt-assembler.assembleWithBaseline(items, { stage })` — 含全局基线注入
3. 现有的 `buildXxxSystemFragments()` builder + assembler

**绕过装配器**会导致：
- 平台基线（H1-H8 提示）丢失
- 装配顺序不可控（slot 0-6 失效）
- snapshot 测试无法覆盖
- prompt 治理审计断链

**⛔ 在业务代码里看到直接 `loadPrompt('xxx')` 拼接成 systemPrompt 的代码必须重构走 builder + assembler。**

---

## H13：URL 抓取必须走 web-extractor.service.js

| 字段 | 内容 |
|------|------|
| 适用范围 | 所有"从 URL 抓取网页内容"的需求 |
| 引入日期 | 2026-05-02（Phase-8 M0+ 决策） |
| 最后审查 | 2026-05-02 |
| 触发原因 | 废弃 system.handlers.js 内嵌的双层抓取逻辑，统一 4 层策略 |
| 负责人 | Baggio |
| 过期条件 | 当 web-extractor 被替换为 ML 模型方案时下线 |

所有"从 URL 抓取网页内容"的需求**必须**调 `src/main/services/web-extractor.service.js` 的 `extractFromUrl(url, options)`。

**4 层策略**（service 内部实现）：
1. 站点专属规则（知乎/CSDN/简书/微信公众号）—— 命中精度最高
2. httpGet + Defuddle —— 服务端渲染网站
3. BrowserWindow + 自动滚动 + Defuddle —— SPA 网站
4. 兜底 raw text

**绕过 service 直接 fetch / BrowserWindow** 会导致：
- Defuddle 主文提取丢失（回到原始 innerText 的噪声）
- 中国常用站点的精准规则失效
- 自动滚动 / 「展开全文」点击失效
- 输出格式不统一（有的是纯文本、有的是 HTML 残留）

**⛔ 业务代码新增网页抓取需求必须 require web-extractor.service.js，禁止内嵌 net.request / BrowserWindow。**

加新中国站点的方法（不破坏现有规则）：
- 在 `web-extractor.service.js` 的 `SITE_EXTRACTORS` 数组追加一项 `{ name, match, extract }`
- 跑 `node scripts/verify-web-extractor.js` 确保 22/22 仍通过
- 加一个 mock HTML 测试用例验证新规则命中
