# 关键文件速查

## 核心架构

| 功能 | 文件 | 备注 |
|------|------|------|
| Stage 依赖定义 | `src/main/v2/contracts.js` | ⛔ 只读（H1） |
| v2 运行时 | `src/main/v2/runtime.js` | Stage 状态机 |
| 框架 Schema | `src/main/api/framework-schema.js` | 含用户友好错误消息 |
| 数据库 | `src/main/database/db-simple.js` | SQLite |
| AI 客户端创建 | `resolveProviderConfig + createAiClientByConfig` | 在各 handler 内使用，详见 ark-client-spec.md |

## AI 生成核心

| 功能 | 文件 | 备注 |
|------|------|------|
| 讲稿 A/B/C 生成 | `src/main/script/abc-generator.js` | 核心 AI 逻辑 |
| 正式稿合成 | `src/main/script/formal-generator.js` | 分段合成复杂逻辑 |
| 质量校验 | `src/main/v2/quality.js` | 纯函数，禁 AI 调用（H3） |
| PPT 规划生成器 | `src/main/script/ppt-plan-generator.js` | AI 驱动，从 DB 自动读讲稿 |
| 视频提示词模板 | `src/shared/v2-stage-helpers.js` — `videoPrompt()` | 主进程 + 渲染进程共用 |

## 导出与产物

| 功能 | 文件 | 备注 |
|------|------|------|
| Word 导出 | `src/main/export/word.js` | 含六列教学过程表 + 讲稿样式块 |
| PPT 导出 | `src/main/export/ppt.js` | 11 种页型，封面含软件/年级信息 |
| 信息图生成 | `src/main/services/infographic-card.service.js` | HTML→PNG，含软件/岗位上下文 |
| 课程研究建议 | `src/main/services/research.service.js` | AI 知识库建议，调用 chatJson() |
| **网页深度抓取** | `src/main/services/web-extractor.service.js` | **Phase-8 M0+：4 层策略**（站点专属 → httpGet+Defuddle → BrowserWindow+滚动+点展开+Defuddle → 兜底）。零云依赖、零付费 API。加新站点只在 SITE_EXTRACTORS 数组追加 |

## Agent 系统（Phase-5C/5D + Phase-6）

| 功能 | 文件 | 备注 |
|------|------|------|
| Agent 编排器 | `src/main/agent/orchestrator.js` | Phase-5D 完成 + M2.4 接入 conflict-policy 用户锁保护 |
| Agent 记忆层 | `src/main/agent/memory.js` | Phase-5C 已完成 |
| 跨阶段上下文 | `src/main/agent/context-builder.js` | buildLectureContext + buildPptContext 均已接入 |

## Phase-6 Harness 治理（v2.2.0 - v2.4.0）

| 功能 | 文件 | 备注 |
|------|------|------|
| 🆕 Prompt 来源注册表 | `src/main/agent/source-registry.js` | M1：6 种 fragment 类型 + 优先级矩阵 + 8 个自检 |
| 🆕 Fragment 边界包装器 | `src/main/agent/fragment-wrapper.js` | M1：wrap/unwrap + 转义保护，11 个自检 |
| 🆕 Prompt 装配器 | `src/main/agent/prompt-assembler.js` | M1：SLOT_ORDER 0-6 装配 + 16 个自检 |
| 🆕 ABC builder | `src/main/agent/builders/abc.builder.js` | M1.4：abc-generator systemPrompt 装配化 |
| 🆕 Formal builder | `src/main/agent/builders/formal.builder.js` | M1.4：formal-generator segSystemPrompt 装配化（动态上下文）|
| 🆕 冲突优先级矩阵 | `src/main/agent/conflict-policy.js` | M2.3：7 种冲突类型 + 显式裁决，含 USER_EDIT_VS_AGENT 用户保护 |
| 🆕 上下文压缩器 | `src/main/agent/context-compressor.js` | M2.5：讲稿→PPT n-gram 压缩，真实压缩率 ~50% |
| 🔄 数据库（lockedByUser）| `src/main/database/db-simple.js` | M2.1：用户保护锁字段 + setArtifactLock/isArtifactLocked helper |
| 🔄 数据库（操作压缩）| `src/main/database/db-simple.js` | M3.1：compressOperationDetail + compactOperationsByNotebook（30 op 实测压缩 78%）|

## 知识库索引（每次会话开始读）

| 功能 | 文件 | 备注 |
|------|------|------|
| 入口（精简）| `CLAUDE.md` | ~150 行：核心原则 + 跳转链接 |
| 长期记忆 | `.claude-memory/MEMORY.md` | 跨会话记忆 |
| 阶段上下文 | `CONTEXT.md` | 当前阶段快照 |
| 治理知识库 | `.claude/` | 详见 .claude/README.md |
