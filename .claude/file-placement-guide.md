# 文件归属决策指南

> **每次新建文件 / 写总结前，先查这份指南。**
> **核心铁律：项目根目录 `/` 只放 4 个入口文件**——CLAUDE.md / CONTEXT.md / README.md / package.json（+ LICENSE / .gitignore 等技术必需）。**其他任何 .md / 实验脚本 / 报告 / 笔记不允许直接放根目录。**

---

## 一、各位置的"职责定义"

| 位置 | 放什么 | 不放什么 |
|------|------|--------|
| **项目根 `/`** | 仅入口文件：CLAUDE.md / CONTEXT.md / README.md / package.json / .gitignore / LICENSE | ❌ 任何业务 .md（除上述）<br>❌ 临时脚本、实验输出、调研报告、TODO、NOTES |
| **`.claude/`**（治理知识库）| 静态规则：硬约束、文件地图、验证矩阵、关键文件速查、规范说明 | ❌ 运行时日志<br>❌ AI 生成的中间产物<br>❌ 老师面向的文档 |
| **`.claude/notes/`** | 临时笔记：出现 1 次的现象/问题，文件名 `YYYY-MM-DD-xxx.md` | ❌ 已升级为正式约束的内容<br>❌ 长期参考资料 |
| **`.claude/candidates/`** | 候选规则：重复出现 2-3 次、即将升级为正式 H 的草稿 | ❌ 一次性问题（应在 notes/） |
| **`.claude/phases/phase-X.md`** | 阶段完工总结：每个 Phase / Milestone 结束写一份 | ❌ Phase 进行中的临时记录（在 notes/）|
| **`.claude/phases/roadmap.md`** | 未来阶段规划：按里程碑列出 | ❌ 已完成的 Phase（在各自 phase-X.md）|
| **`.claude-memory/MEMORY.md`** | 跨会话长期记忆：用户偏好、项目背景、商业目标 | ❌ 单次会话信息 |
| **`reports/`** | 开发期产物：调研、技术选型、实验报告、一次性脚本 | ❌ 老师/用户面向的文档 |
| **`scripts/`** | 开发脚本：verify-*.js、e2e-*.js、build 工具 | ❌ 文档（除内联注释）|
| **`prompts/`** | AI Prompt 模板（.md 格式）| ❌ 通用文档 |
| **`src/`** | 生产代码 | ❌ 文档（除代码注释）|
| **`dist/`** | 构建产物 + 老师面向交付物（安装包、电子杂志、使用指南）| 📌 注意：构建+交付混合区 |
| **`docs/`**（如需要）| 正式用户文档：商业资料、长期手册 | ❌ 开发期临时文档（在 .claude/）|
| **`CONTEXT.md`**（项目根，唯一例外）| 当前阶段进行中状态快照 | ❌ 历史阶段（在 .claude/phases/）|

---

## 二、新文件归属决策树（贴上墙的版本）

```
我要新建一个文件 / 写一份总结
│
├── 它是代码？               → src/ 对应模块
├── 它是测试 / 验证脚本？     → scripts/verify-*.js 或 scripts/e2e-*.js
├── 它是 AI Prompt 模板？    → prompts/
│
├── 它是"项目规则 / 治理"？
│   ├── 出现 1 次现象/问题       → .claude/notes/YYYY-MM-DD-xxx.md
│   ├── 出现 2-3 次             → .claude/candidates/xxx.md
│   ├── 必须强制 + 出现 ≥3 次   → .claude/hard-constraints.md（升级为正式 H）
│   ├── 文件地图 / 速查 / 规范  → .claude/{ipc-map,key-files,xxx-spec}.md
│   ├── Phase 完工总结          → .claude/phases/phase-X.md
│   └── 未来路线 / 规划         → .claude/phases/roadmap.md
│
├── 它是开发期调研 / 实验 / 一次性脚本？  → reports/
├── 它是给老师 / 用户看的文档？           → dist/（贴近交付）或 docs/（长期手册）
├── 它是商业 / 法务文档？                → docs/legal/
│
└── 它是当前阶段进行中状态？      → CONTEXT.md（项目根，唯一例外）
```

---

## 三、必须警惕的"诱惑陷阱"（命名看起来"应该放根目录"，实际不行）

| 诱惑命名 | ❌ 错误位置 | ✅ 正确位置 |
|---------|----------|----------|
| `TODO.md` | 根目录 | `.claude/notes/todo-YYYY-MM-DD.md` 或 GitHub Issues |
| `NOTES.md` | 根目录 | `.claude/notes/` |
| `CHANGELOG.md` | 根目录（除非自动生成）| `.claude/phases/` 各阶段拼接 |
| `DESIGN.md` | 根目录 | `reports/` 或 `.claude/phases/phase-X.md` 内嵌 |
| `MEETING-NOTES.md` | 根目录 | `.claude/notes/` |
| `EXPERIMENT-RESULTS.md` | 根目录 | `reports/` |
| `ARCHITECTURE.md` | 根目录 | `.claude/key-files.md` + `.claude/ipc-map.md` |
| 任何 `*-DRAFT.md` | 任何位置 | `.claude/notes/`（写完后升级或删除）|
| `RESEARCH-FINDINGS.md` | 根目录 | `reports/` |
| `BUG-LOG.md` | 根目录 | `.claude/notes/` 单 bug 1 文件 |

---

## 四、具体场景示例（让你心里有数）

| 场景 | ❌ 旧做法 | ✅ 新做法 |
|------|--------|-------|
| Phase-8 M0+ 完成后写总结 | 塞进 CLAUDE.md 加一节 | `.claude/phases/phase-8.md` 加章节 |
| 今天遇到 firecrawl 404 错误 | 加 console.log 然后忘了 | `.claude/notes/2026-05-02-firecrawl-404.md` |
| 发现知乎反爬模式（已遇到 2 次） | 直接改代码 | `.claude/candidates/anti-bot-zhihu.md` |
| 调研 ML 模型选型 | 邮件发给项目方 | `reports/ml-model-selection-2026-05-02.md` + 邮件附件 |
| 写"老师如何用 URL 抓取"使用指南 | 塞进 CLAUDE.md | `dist/老师桌面安装指南.md` 加节 或独立 `dist/url-fetch-guide.md` |
| 记一个"今天测试发现的奇怪现象" | 群里发完就完事 | `.claude/notes/2026-05-02-test-finding.md` |
| 写"商业化推进 6 周路线图" | 私聊发同事 | `.claude/phases/roadmap.md` + 链接给同事 |
| 完成一项功能要写发布说明 | RELEASE-NOTES.md 进根目录 | `.claude/phases/phase-X.md` 含发布章节 |
| 老师反馈整理 | FEEDBACK.md 进根目录 | `.claude/notes/feedback-2026-05-02.md` |
| 临时调试输出 | 桌面 .txt 文件 | `.claude/notes/debug-YYYY-MM-DD.md`（git ignored 可选）|

---

## 五、AI 生成产物 / 数据库内容（不在文件系统）

| 产物 | 存哪里 | 不要做的事 |
|------|------|----------|
| 笔记本数据 | SQLite（`db.sqlite`）| ❌ 导出成 .json 进项目目录 |
| 框架 / 讲稿 / PPT artifact | SQLite + `artifacts/` | ❌ 拷贝到根目录 |
| 用户测试的 docx 输出 | `dist/` 或老师桌面（用户选择）| ❌ commit 到 repo |
| 调研得到的临时 HTML | 不持久化（一次性内存）| ❌ 写到根目录 |
| AI 调用的 token 统计 | 数据库 task_runtime 表 | ❌ 写到根目录 |

---

## 六、维护责任与检查节奏

| 频率 | 动作 | 谁做 |
|------|-----|-----|
| 每会话开始 | 看到任何想塞进根目录的文件，先查这份指南 | Claude + Baggio |
| 每周末 | 扫 `.claude/notes/` ，重复出现的升级到 candidates/ | Baggio |
| 每月底 | 扫 `.claude/candidates/`，频繁出现的升级到 hard-constraints.md | Baggio |
| 每版本发布 | 扫整个 `.claude/`，删过时的、合并重复的 | Baggio |
| 每年 | 检查根目录是否有"诱惑陷阱"文件偷偷出现 | Baggio |

---

## 七、给 Claude 的工作铁律

**当我（Claude）需要新建文件时**：

1. 先回答 5 个问题：
   - 这是代码、脚本、Prompt、文档、笔记、报告？
   - 它会被频繁读取，还是只读 1 次？
   - 它是规则约束，还是临时观察？
   - 它是开发期产物，还是用户面向？
   - 它是当前阶段，还是历史/未来？

2. 然后查上面"决策树"找到对应位置

3. **如果想放根目录** → 必须先停下来问用户："此文件为什么需要放根目录？"

4. **如果是 .md 文件** → 默认进 `.claude/notes/` 或 `.claude/phases/`，**不**默认进根目录

5. **如果是涉及商业、法务、用户协议** → 必须问用户先确认归属

---

## 八、引用此指南的位置

- `CLAUDE.md` 入口页第 X 节
- `.claude/README.md` 知识库索引
- 每次需要新建文件时，Claude 内心默念："先查 file-placement-guide"
