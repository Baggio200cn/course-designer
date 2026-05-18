# CLAUDE.md — 驭课 Agent v4.3.3 项目入口

> **这是 Claude Code 工作的入口页。**
> **本页只放高频核心原则**——具体规则、地图、阶段历史按知识层级拆到 `.claude/` 目录。
> **入口页规则**：本文件保持 ≤ 200 行，新内容默认归到 `.claude/` 对应文件而不是堆这里。
>
> **最后更新**：2026-05-18（v4.3.3 · 8 阶段架构 · Sprint A 止血 + Sprint B 结构重构中）

---

## 〇、工作模式约定（每次会话开始必读）

> **本节是为防止"verify 通过 = 功能就绪"的认知错误而新增。**

### 0.1 完成的真实定义

| 错误的"完成"标准 | 正确的"完成"标准 |
|----------------|---------------|
| ❌ "我写了代码" | ✅ "我写的代码在生产真实路径上跑通了" |
| ❌ "selfCheck 过了" | ✅ "mock 路径 + 真实路径都覆盖了，且证据可见" |
| ❌ "verify N/N 全过" | ✅ "verify 覆盖了关键路径（含真实 API 接通），且我能列出**还可能在哪里翻车**" |
| ❌ "符合 H 约束" | ✅ "对照 H1-H13 逐条检查过，找出本次改动可能违反的精神" |

### 0.2 每次改动后必做的"对手审计 5 问"

写完代码后，用 codex 视角主动质问自己：

1. **生产环境真的会调到这条路径吗？** —— 注入链路完整吗？
2. **Mock 是不是在骗我？** —— mock 默认通过的路径有多大概率覆盖真实失败？
3. **测试覆盖了"关键失败"吗？** —— 不是"功能正确"，而是"质量门槛能拦住低质量"
4. **用户填错时怎样？** —— 缺 endpoint / 网络挂 / API 限流 / 旧数据迁移
5. **H1-H13 哪一条最容易被本次改动悄悄违反？** —— 把硬约束当**质问清单**

### 0.3 报告时禁用的总结性大词

✅ **可以说**：「我做了 X / 用 verify A 测了 / 还可能在 B 翻车」
❌ **不要说**：「全部完成 / 全套通过 / 已就绪 / Phase 完成」（替用户判断 = 剥夺审视空间）

### 0.4 对照本入口页工作的方式

每次会话开始：
1. 读 `CLAUDE.md`（本文件）
2. 读 `CONTEXT.md`（当前阶段快照）
3. 读 `.claude/README.md`（治理知识库索引）
4. 任务范围内对照 `.claude/hard-constraints.md` 列出"可能违反的硬约束"
5. 工作过程中持续用 0.2 节的 5 问审视

---

## 一、硬约束 H1-H13（仅标题，详见 `.claude/hard-constraints.md`）

> **违反任何一条必须停下来问用户，不能自行处理。**

| # | 标题 | 一句话摘要 |
|---|------|---------|
| H1 | 不要修改 contracts.js | Stage 依赖链是命脉，只读 |
| H2 | 不要在 index.js 添加新 IPC handler | 必须写到 `ipc/` 子文件 |
| H3 | 不要让 quality.js 依赖生成模型 | 验证层独立，禁 AI 调用 |
| H4 | 不要删除或重命名 verify 脚本 | 回归防护网，只能加不能删 |
| H5 | 不要直接写 Prompt 到代码里 | Prompt 必须放 `prompts/*.md` |
| H6 | 不要在单次任务中同时重构多个模块 | 单任务限 1-2 个文件 |
| H7 | 不要跳过验证直接交付 | 每次改动必须告诉用户跑哪个 verify |
| H8 | 不要修改 package.json 依赖项（未经允许）| 加新依赖必须先问 |
| H9 | 不允许"selfCheck mock 通过 = 功能就绪"的认知 | 必须有真实路径用例 |
| H10 | 不允许"force accept"作为质量门槛兜底 | Agent 不能传 userForceAccept=true |
| H11 | 不允许"流程完成 = 任务完成"的判断 | 必须检查 quality.valid + 字段齐全 |
| H12 | 不允许业务关键路径绕过 prompt-assembler | systemPrompt 必须走装配器 |
| H13 | URL 抓取必须走 web-extractor.service.js | 不允许内嵌 fetch / BrowserWindow |
| H14 | 反模板化铁律（v4.3.0 新增 2026-05-17）| 任何教学参数（学时/周/章/班/学期/PPT 页数/讲稿字数/产出物数）禁止在代码/prompt example/IPC 兜底里硬编码默认值；AI 必须从老师上传素材实时读取，缺失则上层显式报错让老师补，不允许猜测；常被违反的兜底关键字：`\|\| 72` / `\|\| 4` / `\|\| 45` / `\|\| 60` / "广州纺校" / "周成锦" / "23级流行资讯" |

**完整说明 + 元数据**（适用范围 / 引入日期 / 触发原因 / 过期条件）→ `.claude/hard-constraints.md`

---

## 二、知识地图（按需深读）

```
项目根/
├── CLAUDE.md                       ← 你正在读（入口页 ≤ 200 行）
├── CONTEXT.md                      ← 当前阶段快照
├── .claude-memory/MEMORY.md        ← 跨会话长期记忆
└── .claude/                        ← 治理知识库（按需深读）
    ├── README.md                   ← 知识库索引
    ├── file-placement-guide.md     ← 📌 新建文件归属决策表（必读）
    ├── hard-constraints.md         ← H1-H13 详细 + 身份证元数据
    ├── ipc-map.md                  ← IPC handler 文件地图
    ├── verify-matrix.md            ← 修改了什么 → 跑什么 verify
    ├── key-files.md                ← 关键文件速查
    ├── ark-client-spec.md          ← AI 客户端调用规范
    ├── code-style.md               ← 代码风格约束
    ├── trigger-stop.md             ← 必须停下来问用户的触发条件
    ├── prompt-registry-spec.md     ← Prompt Registry 规范
    ├── phases/
    │   ├── phase-5.md              ← Phase-5B/5C/5D 已完成
    │   ├── phase-6.md              ← Phase-6 M1/M2/M3 已完成
    │   ├── phase-8.md              ← Phase-8 M0+ 当前 + M0.5 治理
    │   └── roadmap.md              ← 未来 M1-M5 规划
    ├── notes/                      ← 临时笔记（出现 1 次的问题）
    └── candidates/                 ← 候选规则（重复出现 2-3 次）
```

---

## 三、新建任何文件之前——查 file-placement-guide

**铁律**：项目根目录除了 4 个入口文件（CLAUDE.md / CONTEXT.md / README.md / package.json），**禁止放任何业务 .md / 临时脚本 / 报告 / 笔记**。

| 我要新建 | 应该放哪？ |
|---------|---------|
| 一次性问题/现象 | `.claude/notes/YYYY-MM-DD-xxx.md` |
| 重复 2-3 次的规则草稿 | `.claude/candidates/xxx.md` |
| Phase 完工总结 | `.claude/phases/phase-X.md` |
| 开发期调研报告 | `reports/` |
| 老师面向文档 | `dist/` |
| 测试脚本 | `scripts/` |
| AI Prompt | `prompts/` |
| 其他不确定 | **必查 `.claude/file-placement-guide.md`** |

---

## 四、开始工作前的检查清单

每次新会话开始，**Claude Code 必须先做**：

- [ ] 读 `CLAUDE.md`（本入口页）
- [ ] 读 `CONTEXT.md`（当前阶段状态）
- [ ] 读 `.claude/README.md`（治理知识库索引）
- [ ] 任务范围内对照 `.claude/hard-constraints.md` 预判风险
- [ ] 想新建文件先查 `.claude/file-placement-guide.md`
- [ ] 确认任务范围，如有疑问先问

**不允许跳过上述步骤直接开始写代码。**

---

## 五、版本快讯

| 项 | 状态 |
|---|------|
| 当前版本 | **v4.0.0**（2026-05-10 Phase-9 完成 · 6 阶段工作流落地）|
| 当前阶段 | Phase-9 完成 → 等老师试用反馈 → Phase-10 体验打磨 |
| 完整路线 | `.claude/phases/roadmap.md` |

---

## 五·二、Phase-9 关键经验（必读，高频陷阱）

### 经验 1：函数同名多处副本——必查全局
- `renderHtmlToPngBuffer` 在 3 处（index.js / media.handlers.js / prompt.handlers.js）独立定义
- 改一处不影响其他——生产路径常常用 handler 本地副本
- **诊断方法**：`grep -rn "function fnName"` 找全部，再确认调用方用哪份

### 经验 2：preload 改了必须完整重启 Electron
- preload 一次加载，HMR 不重载
- 改完 `src/preload/index.js` 必须：关 Electron 窗口 → Ctrl+C → npm run dev
- 主进程改动（`src/main/index.js`、`src/main/ipc/`）同样规则

### 经验 3：用真实日志诊断 ≠ 看截图猜
- Phase-9 多次"看截图猜"走错方向
- **`console.log` + 用户贴终端输出 = 1 分钟定位根因**（vs 30 分钟瞎猜）
- 日志加 namespace 前缀（`[v2:lessonGenerateFormal]` / `[batch-image]`）

### 经验 4：AI 模型 endpoint 兼容性
- doubao `ep-m-...` 多模态文本端点不支持 `response_format: { type: 'json_object' }`
- 已修复：`chatJson` 自动检测 400 + "json_object is not supported" → 重试去掉 response_format
- 教训：跨 endpoint 调用要带 fallback

### 经验 5：prompt 设计的"反例清单"比正面约束有效
- "禁止编造销量数据"——AI 容易忽略
- "❌ 反例：'GMV 620 万' / '小红书 12W 赞'"——AI 主动避免
- 反例越具体 AI 越听话

### 经验 6：H1 例外的代价 + 收益
- Phase-9 改 contracts.js 是 **批准的 H1 例外**（不是无规则破坏）
- 收益：6 阶段架构升级
- 代价：所有现存 stage 解锁逻辑要重新验证（verify-contracts-v6.js 27/27 验证）

### 经验 7：H9 视角的真实威力
- 5 个 verify 134/134 全过 → 应用启动炸（json_object 不支持 / preload 没重载 / handler 用了不存在的 db 方法）
- selfCheck mock 永远不会触发真实 API/IPC/DB 失败
- **必须真实端到端跑一次才能信**

---

## 六、维护责任

- **维护人**：Baggio（项目方）
- **审查频率**：每版本发布前 + 每月体检
- **本入口页超过 200 行时** → Claude 必须在响应中提示用户「需要拆分内容到 .claude/」

---

> 📚 **理论支撑**：本治理结构参考"如何避免 Claude Code 的'现场补丁'越堆越乱"信息图（2026-05-02 引入），核心原则是"知识分层 + 身份证 + 三种状态升级"。
