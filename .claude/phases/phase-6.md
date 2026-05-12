# Phase-6 历史（2026-04-26 ~ 2026-04-27）

> **战略目标**：将"v2.1 Pipeline + 部分 Agent"升级为商业级 Harness 治理体系。
> **理论依据**：《Claude Code 与 Codex 控制面设计》读书笔记。
> **路线图**：M1 → M4 共四个里程碑；当前 M1+M2+M3 完成，M4 待启动。

---

## 整体路线图

| 里程碑 | 状态 | 工作量 | 主要交付 |
|-------|------|-------|---------|
| **M1 来源治理底座** | ✅ 完成 | 3 天 | source-registry / fragment-wrapper / prompt-assembler / 2 builder / verify-prompt-assembly |
| **M2 冲突治理与用户保护** | ✅ 完成 | 4 天 | lockedByUser / conflict-policy / context-compressor / 3 个 verify |
| **M3 长会话压缩** | ✅ 完成 | 1.5 天 | operation 压缩（实测 78%）/ force-accept / 2 个 verify |
| **M4 商业化收尾** | ⏭️ 待启动（Phase-8 M1 即此）| 1 天 | 导入现有讲稿入口 + H1-H8 与 source-registry 联动 |

---

## M1 来源治理底座（v2.2.0）

把所有 Prompt 拆为带元数据的 fragment，按 SLOT_ORDER 装配，保证字节级稳定。

### 6 种 Fragment 类型

```
PLATFORM_SAFETY  100   平台硬约束（H1-H8 摘要）
TASK_GOAL         80   当前任务目标
RETRY_FEEDBACK    75   重试反馈
PRODUCT_DEFAULT   50   产品级默认（abc-system.md 等）
PROJECT_RULE      40   课程级数据
MEMORY            30   历史课程参考
```

### SLOT_ORDER（注意力位置，与优先级解耦）

```
0  PLATFORM_SAFETY              建立行为边界
1  PRODUCT_DEFAULT (主)
2  PROJECT_RULE
3  MEMORY                       仅风格参考
4  TASK_GOAL                    强注意力靠后
5  RETRY_FEEDBACK               倒数第二，强提醒
6  PRODUCT_DEFAULT(output_style) 最末，最后一锤
```

### 关键设计

- 装配输出格式 `<FRAGMENT type="..." id="..." priority="..." source="..." lifetime="..." scope="...">...</FRAGMENT>`
- `USE_ASSEMBLER` 开关（默认 true）放在 abc-generator.js / formal-generator.js，一键回滚
- `buildAbcSystemPromptLegacy()` / `buildFormalSystemPromptLegacy()` 与原硬编码字节级一致
- snapshot 测试基线：`scripts/__snapshots__/prompt-assembly.snap.json`

---

## M2 冲突治理与用户保护（v2.3.0）

### M2.1 db.lockedByUser 字段

- Q4 决策：已 confirmed 的历史数据默认 lockedByUser=true
- 迁移逻辑 + createArtifact / updateArtifact 自动联动 + setArtifactLock helper
- `verify-user-lock-migration.js` 10/10 通过

### M2.2 用户操作锁定（六文件透传）

- IPC handler 注入 `_userInitiated: true`（4 个文件：framework/lecture/ppt/video.handlers.js）
- runtime.js 6 个 saveXxx/confirmXxx 透传
- index.js 的 upsertStageArtifact / syncFrameworkArtifacts 加 userInitiated 选项
- **Agent 路径**：不传 `_userInitiated` → 默认 false → 不锁
- **用户路径**：IPC 自动注入 → lockedByUser=true

### M2.3 conflict-policy.js 7 种冲突显式裁决

```
PLATFORM_VS_USER       平台硬约束 vs 用户操作 → platform_wins
PROJECT_VS_USER        课程级规则 vs 用户输入 → user_wins
MEMORY_VS_CURRENT      历史课程 vs 当前任务 → current_user_wins
USER_EDIT_VS_AGENT     用户编辑 vs Agent 重生成 → 看 lockedByUser（M2.4 关键）
QUALITY_VS_USER_ACCEPT 质量失败 vs 用户接受 → 看 userForceAccept（M3.2 关键）
CONTRACTS_VS_SKIP      Stage 依赖 vs 跳过阶段 → contracts_wins（除非 hasImportPath，M4 关键）
RETRY_VS_STOP          自动重试 vs 用户停止 → 看 userStopRequested
```

- 18 个自检 + `verify-conflict-priority.js` selfCheck 18 + 集成 4 + snapshot 12 + coverage 7/7

### M2.4 orchestrator backtracking 用户保护

- `execBacktrackFramework` 调 `resolveConflict(USER_EDIT_VS_AGENT)`
- 上游被锁时返回 `{ blocked: true }` → run() 终止 + 发 `agent.blocked_by_user_lock` 事件
- 状态返回 `{ status: 'blocked', blockReason, conflictType }`
- `verify-agent-orchestrator.js` 21/21 仍通过

### M2.5 context-compressor.js 讲稿→PPT 压缩

- n-gram 滑动窗口（4-8 字）+ 频次统计 + 子串去重 + 停用词过滤
- 真实样本压缩率 ~50%（讲稿 575 字 → 352 字）

---

## M3 长会话压缩（v2.4.0）

### M3.1 task_runtime 操作日志压缩

- `db.compressOperationDetail(operationId, options)` — 单操作压缩（auto / success_summary / archive）
- `db.compactOperationsByNotebook(notebookId, options)` — 批量压缩 + 字节节省统计
- task-runtime.js `runStageAction` 在 success 路径自动调 `compressOperationDetail({ level: 'auto' })`
- **保留字段**：id / status / summary / timestamps / outputArtifactIds / error
- **压缩字段**：input → byteSize 摘要；output → 仅 boolean/number；metadata.quality → valid + 数字 checks
- **失败 operation 不压缩**（错误堆栈对调试至关重要）
- 真实测试：30 个 operation 从 114KB 压缩到 25KB（节省 78%）
- `verify-operation-compression.js` 14/14 通过

### M3.2 用户强制接受质量失败

- 三个 confirm 函数支持 `payload.userForceAccept`
- 内部走 `resolveConflict(QUALITY_VS_USER_ACCEPT)` 裁决
- 强制接受路径：`finalWarnings` 加 `[force-accepted]` 标记 + `metadata.forceAccepted=true`
- 默认行为不变（向后兼容）
- `verify-force-accept.js` 8/8 通过

---

## Phase-6 商业化纪律

| 纪律 | 内容 |
|------|------|
| **每模块独立可测** | 必须用 `node scripts/verify-xxx.js` 直接跑通，不依赖 `npm run dev` |
| **版本号语义化升级** | M1=v2.2.0 / M2=v2.3.0 / M3=v2.4.0 / M4=v3.0.0 |
| **每里程碑同步文档** | CONTEXT.md + CLAUDE.md（现 .claude/phases/）必须更新 |
| **Deprecation 路径保留** | 新引入的 USE_ASSEMBLER / userForceAccept / lockedByUser 都有"不传/不启用"的回退路径 |

---

## Phase-6 设计原则速查

| 场景 | 必守规则 |
|------|---------|
| 改 systemPrompt | 走 builder + assembler，不直接写硬编码字符串；保留 `buildXxxLegacy()` 回滚 |
| 加新 IPC handler 涉及 artifact 写入 | 业务 IPC 必须传 `_userInitiated: true`；Agent 内部调用不传 |
| 加新冲突场景 | 在 conflict-policy 加新 CONFLICT_TYPE 常量 + selfCheck 用例 |
| 加新 confirm 函数 | 必须支持 `userForceAccept` + 调 `resolveConflict(QUALITY_VS_USER_ACCEPT)` |
| 处理大体积 operation 输出 | success 路径自动压缩；如需保留全量调试字段，调用方显式 `force: true` |
