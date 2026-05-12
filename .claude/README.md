# .claude/ — 项目治理知识库

> **目的**：把"散落在 CLAUDE.md 一个大文件里"的项目知识，按"知识分层 + 身份证 + 三种状态"重新组织。
> **理论依据**：参考"如何避免 Claude Code 的'现场补丁'越堆越乱"信息图（2026-05-02 引入）。

## 知识地图

```
项目根/
├── CLAUDE.md                       ← 入口页（仅 ~150 行：核心原则 + 跳转链接）
├── CONTEXT.md                      ← 当前阶段快照（每次切阶段更新）
├── .claude-memory/MEMORY.md        ← 长期跨会话记忆
└── .claude/                        ← 治理知识库（本目录）
    ├── README.md                   ← 你正在看
    ├── hard-constraints.md         ← H1-H13 硬约束 + 元数据
    ├── ipc-map.md                  ← IPC handler 文件地图
    ├── verify-matrix.md            ← 验证矩阵（修改了什么 → 跑什么）
    ├── key-files.md                ← 关键文件速查
    ├── ark-client-spec.md          ← ArkCourseClient 规范
    ├── code-style.md               ← 代码风格
    ├── trigger-stop.md             ← 必须停下来问用户的触发条件
    ├── prompt-registry-spec.md     ← Prompt Registry 规范
    ├── phases/
    │   ├── phase-5.md              ← Phase-5B/5C/5D 已完成
    │   ├── phase-6.md              ← Phase-6 M1/M2/M3 已完成
    │   ├── phase-8.md              ← Phase-8 M0+ 当前
    │   └── roadmap.md              ← 未来 M1-M5 规划
    ├── notes/                      ← 临时笔记（出现 1 次的问题）
    │   └── README.md               ← 怎么用 notes
    └── candidates/                 ← 候选规则（重复出现 2-3 次）
        └── README.md               ← 怎么用 candidates
```

## 如何使用这个目录（给 Claude 自己看）

### 每次会话开始
1. 读 `CLAUDE.md`（精简入口页）
2. 读 `CONTEXT.md`（当前阶段）
3. 任务范围内对照 `.claude/hard-constraints.md` 列出"可能违反的硬约束"

### 写代码 / 改约束时
- 改了 IPC handler → 查 `.claude/ipc-map.md` + `.claude/verify-matrix.md`
- 改了 prompt → 查 `.claude/prompt-registry-spec.md`
- 改了 AI 调用 → 查 `.claude/ark-client-spec.md`
- 想加新硬约束 → 先写到 `.claude/candidates/`，重复出现 3 次再升到 `.claude/hard-constraints.md`

### 发现一次性问题（出现 1 次）
- 写到 `.claude/notes/YYYY-MM-DD-xxx.md`
- 不要塞进 CLAUDE.md 或 hard-constraints.md
- 每周扫一次 notes，重复出现的升到 candidates

### 发现多次出现的问题（出现 2 次）
- 从 notes 抽出来，写到 `.claude/candidates/`
- 每周末评审一次 candidates
- 第 3 次出现 → 升到 `.claude/hard-constraints.md` 作为正式 H 约束

## 三种状态升级路径

```
notes/         ← 出现 1 次，记录现象 + 临时应对
   ↓ 出现 2 次
candidates/    ← 候选规则，加结构化描述但还不强制
   ↓ 出现 3 次或必须强制
hard-constraints.md ← 正式 H 约束，必须遵守
```

## 删除机制（防止知识库变垃圾桶）

- **过时就删**：旧 H 约束被新架构取代 → 直接删除（保留 git history 即可）
- **重复就合并**：两条规则讲同一件事 → 合并成一条
- **被自动化替代就下线**：H 约束已被 git pre-commit hook 自动检查 → 从 hard-constraints.md 删，移到 `.claude/code-style.md` 备注
- **每月体检**：维护人扫一遍 hard-constraints.md，删过时 / 合重复 / 下线已自动化的

## 维护责任

- **维护人**：Baggio（项目方）
- **审查频率**：每版本发布前
- **协作约定**：Claude 修改任何 .claude/ 文件需在响应中明确说明改动 + 提示用户审阅
