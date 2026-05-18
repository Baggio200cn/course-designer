# Legacy 测试脚本目录（v4.3.3 Codex Round 5 #3）

## 为什么这里有这些脚本

这些是 v4.1.x / v4.2.x 时期的测试脚本，**断言基于旧的 6 阶段架构**，运行时会有部分失败（属于预期失败，不是 bug）。

v4.3.3 起项目用 **8 阶段架构**（schedule → design → ppt → lecture → quiz → homework → video → report）。本目录脚本**不再代表当前主流程**，团队不需要修复它们的失败断言——除非明确要回退老架构（不会发生）。

## 当前 legacy 脚本

| 文件 | 老断言基础 | 失败原因（v4.3.3 下） |
|---|---|---|
| `verify-contracts-v6.js` | 6 阶段 STAGE_ORDER | 8 阶段升级后断言失败 3 项（25/28） |
| `e2e-full-course-flow.js` | v4.1.4 单 lecture 模型 | 多节课模型 + quiz/homework 字段透传不覆盖（29/46） |
| `stress-test-design-first-workflow.js` | 6 阶段顺序 | STAGE_ORDER 断言失败 1 项（59/60） |
| `verify-design-service.js` | lessonMeta.topic 可选 | v4.3.3 加 topic 必填校验，断言失败 1 项（20/21） |
| `verify-schedule-service.js` | totalHours=72 默认 + minutesPerHour 可选 | H14 反模板化 + minutesPerHour 必填，断言失败 5 项（22/27） |
| `verify-ppt-images-pipeline.js` | 封面 vision 失败时 paused=true | v4.3.3 改为软警告，断言失败 1 项（7/8） |
| `smoke-boot.js` | 启动检查 v2:lessonGenerateABC 通道 | ABC 三稿流程已废（D6.2），通道不再注册 → 1 项失败 |

## v4.3.3+ 用哪些脚本

| 用途 | 当前正版脚本 |
|---|---|
| 契约内部验证（35 测试）| `scripts/verify-contracts-v8.js` ✅ 必跑 |
| 集成验证 · runtime + workbench + migration（14 测试）| `scripts/verify-workflow-integration-v8.js` ✅ 必跑 |
| 真实 ARK endpoint 烟雾 | `scripts/smoke-test-real-ark.js`（手动跑，需 API Key）|
| 设计 / PPT / 进度服务 | `scripts/verify-design-service.js` / `verify-ppt-images-pipeline.js` / `verify-schedule-service.js` |

## 何时该删

v4.4.0 写完 `e2e-v8-full-8stage.js`（覆盖完整 8 阶段链）后，本目录所有脚本可以删除。
保留期间仅作历史参考，不要把它们的失败计入 CI 阻断条件。
