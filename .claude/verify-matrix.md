# 验证矩阵

> **修改了什么 → 必须运行什么 verify**
> 不确定运行哪个？告诉用户修改了什么，让用户决定。

## 核心矩阵

| 修改范围 | 必须运行的验证 |
|---------|--------------|
| abc-generator.js / abc-system.md | `node scripts/verify-lecture-generation.js` |
| formal-generator.js / formal-system.md | `node scripts/verify-lecture-generation.js` |
| v2/quality.js | `node scripts/verify-lecture-generation.js` + `node scripts/verify-v2-response-shape.js` |
| export/word.js | `node scripts/verify-word-export.js` + `node scripts/e2e-framework-word.js` |
| export/ppt.js | `node scripts/e2e-ppt-export.js` |
| v2/contracts.js（H1 禁止改，仅参考） | 全套 11 个 verify 脚本 |
| ipc/*.handlers.js（新迁移/新增） | `npm run dev` 启动验证 + 对应功能的手动点测 |
| v2/runtime.js | `node scripts/verify-artifact-tracker.js` + `node scripts/verify-task-runtime-events.js` |
| services/infographic-card.service.js | `node scripts/verify-export-runtime.js` |
| services/research.service.js | 手动测试「AI 研究建议」按钮（需 API Key） |
| database/db-simple.js | 全套 11 个 verify 脚本 |

## Phase-5 系列

| 修改范围 | 必须运行的验证 |
|---------|--------------|
| agent/orchestrator.js（Phase-5C/5D 改动） | `node scripts/verify-agent-orchestrator.js` + `npm run dev` 手动点测「一键生成全部阶段」 |
| ipc/agent.handlers.js（Phase-5D 改动） | `npm run dev` 启动验证 + 手动点测 agent:run + agent:getStatus |
| ipc/v2/ppt.handlers.js（Phase-5D 改动） | `node scripts/e2e-ppt-export.js` + 手动点测 v2:generatePptPlan |
| agent/context-builder.js | `npm run dev` 验证讲稿→PPT 上下文注入正常 |

## Phase-6 系列（Harness 治理体系）

| 修改范围 | 必须运行的验证 |
|---------|--------------|
| agent/source-registry.js / fragment-wrapper.js / prompt-assembler.js（M1） | `node scripts/verify-prompt-assembly.js` |
| agent/builders/abc.builder.js / formal.builder.js（M1） | `node scripts/verify-prompt-assembly.js` + `node scripts/verify-lecture-generation.js` |
| agent/conflict-policy.js（M2.3/M2.4） | `node scripts/verify-conflict-priority.js` |
| agent/context-compressor.js（M2.5） | `node scripts/verify-compression.js` |
| database/db-simple.js 涉及 lockedByUser 字段（M2.1） | `node scripts/verify-user-lock-migration.js` |
| database/db-simple.js 涉及 compressOperationDetail（M3.1） | `node scripts/verify-operation-compression.js` |
| v2/runtime.js 涉及 confirmXxx + userForceAccept（M3.2） | `node scripts/verify-force-accept.js` + `node scripts/verify-user-lock-migration.js` |

## Phase-8 系列（M0+ 网页深度抓取）

| 修改范围 | 必须运行的验证 |
|---------|--------------|
| services/web-extractor.service.js（M0+） | `node scripts/verify-web-extractor.js`（22 个契约用例，集成测试需 `npm run dev` 真实点测 5 个网站） |
| system.handlers.js 的 fetchUrlContent（M0+） | `node scripts/verify-web-extractor.js` + `npm run dev` 测试「参考资料 URL 抓取」入口 |

## Phase-9 系列（v4.0.0 / 6 阶段工作流重构）

| 修改范围 | 必须运行的验证 |
|---------|--------------|
| **v2/contracts.js**（H1 例外，6 阶段架构升级）| `node scripts/verify-contracts-v6.js`（27/27，覆盖 STAGE_ORDER / 解锁逻辑 / 阶段转换 / artifact 取最新）|
| **services/schedule.service.js + ipc/v2/schedule.handlers.js**（C-1 教学进度表）| `node scripts/verify-schedule-service.js`（27/27 + 集成测试需 `npm run dev` 端到端）|
| **services/design.service.js + ipc/v2/design.handlers.js**（C-2 教学设计）| `node scripts/verify-design-service.js`（21/21 含 phases 5 段强制 + weight 归一化校验）|
| **services/micro-video.service.js + ipc/v2/micro-video.handlers.js**（C-3 微课视频）| `node scripts/verify-micro-video-service.js`（25/25 含 storyboard/jimengPrompts 数量一致 + 60-90s 时长校验）|
| **services/report.service.js + ipc/v2/report.handlers.js**（C-4 教学实施报告）| `node scripts/verify-report-service.js`（34/34 含 AI 自动汇总区 + 老师手填区 9 项强制清空契约 + 5 段 inClassPhases 校验）|
| **ipc/v2/lesson.handlers.js**（多节课讲稿，Phase-9 后期）| 暂无单测，需 `npm run dev` 端到端：① 多节课 tab 切换 ② 节课 metadata 持久化 ③ 9 维度审核分数 ≥7 ④ 学时累加上限警告 |
| **export/report-export.js**（4 格式导出）| 暂无单测，需 `npm run dev` 端到端：① Word 9 节齐 ② Markdown 标题层级 ③ HTML 自包含可浏览 ④ PDF 用 printToPDF 生成 |
| **services/infographic-card.service.js + GUIZANG_HERO_TYPES**（PPT 配图修复）| 需 `npm run dev` 端到端 + 控制台诊断 `[batch-image]` 日志：① 22 页 prompt 各不相同 ② 含"视觉概念引导"字样 ③ 实际生成图视觉差异明显 |
| **api/ark-course-client.chatJson**（json_object 兼容降级）| 自动测试不易，需 `npm run dev` 真实 AI 调用：① 终端日志含"自动降级为纯文本 JSON 模式重试" ② 重试后讲稿成功生成 |
| **renderHtmlToPngBuffer**（PNG 截断修复）| 需 `npm run dev` + 控制台日志 `[media-handlers renderHtmlToPngBuffer]`：① content/captured 尺寸都达 1700+px ② 信息图 6 段全显示 |

## 全部 verify 脚本清单

```bash
# Phase-5 历史回归
node scripts/verify-lecture-generation.js
node scripts/verify-agent-orchestrator.js     # 21/21
node scripts/verify-task-runtime-events.js
node scripts/verify-artifact-tracker.js
node scripts/verify-v2-response-shape.js
node scripts/verify-export-runtime.js
node scripts/verify-word-export.js

# Phase-6 Harness 治理
node scripts/verify-prompt-assembly.js         # M1 装配体系
node scripts/verify-user-lock-migration.js     # M2.1 lockedByUser  10/10
node scripts/verify-conflict-priority.js       # M2.3 + M2.4 冲突裁决
node scripts/verify-compression.js             # M2.5 上下文压缩
node scripts/verify-operation-compression.js   # M3.1 操作日志压缩  14/14
node scripts/verify-force-accept.js            # M3.2 用户强制接受  8/8

# Phase-8 网页深度抓取
node scripts/verify-web-extractor.js           # M0+ 4 层抓取策略  22/22
node scripts/verify-magazine-svg.js            # M0+ 杂志信息图模板  7/7

# Phase-9 v4.0.0 / 6 阶段工作流重构
node scripts/verify-contracts-v6.js            # 6 阶段架构 27/27
node scripts/verify-schedule-service.js        # 教学进度表生成器 27/27
node scripts/verify-design-service.js          # 教学设计生成器 21/21
node scripts/verify-micro-video-service.js     # 微课视频整套方案 25/25
node scripts/verify-report-service.js          # 教学实施报告（最终阶段）34/34

# E2E 端到端
node scripts/e2e-ppt-export.js
node scripts/e2e-framework-word.js
```
