# 数据迁移目录（v4.3.3+）

## 目的

防止跨版本数据丢失。每次架构升级（schema 变化）必须放一个迁移脚本，让老版本数据在新版本里继续可见。

## 触发时机

App 启动时（`src/main/index.js` `app.whenReady()`）自动扫描本目录所有 `.js`，按文件名字母序执行。

## 规则

- **绝不删除老 artifact**——只修字段、加索引、写恢复标记
- 失败必须容错（不能阻塞 app 启动）
- 已执行过的 migration 在 `db._readData().migrations` 数组里登记（每条 `{ id, version, runAt, recoverableCount }`），下次启动跳过
- 写入 console 日志：`[migration:文件名] OK / SKIP / FAIL`

## 现有 migration

按文件名字母序执行：

| 文件 | 用途 | 引入版本 |
|---|---|---|
| `001-recover-orphan-artifacts.js` | P0-1 修复 · 通用孤儿 artifact 标识（status='deleted' 但 content 非空 / notebookId 不存在 / framework_json 老 type 仍有内容）→ 让老师在教师日志看到 | v4.3.3 Sprint A |
| `002-recover-orphan-designs.js` | P0-1 子任务 · 老 design_doc 因 schedule schema 变化"看似消失"（响应老师反馈「4.1.4 → 4.3.x 36 个 design 没了」）→ 标记进 `_recoverable` | v4.3.3 Sprint A.5 |
| `003-unify-v4.3.3-schema.js` | 全面 schema 规范化 · workflow framework→schedule + artifact micro_video_plan→video_prompt + 补 schemaVersion/dirty | v4.3.3 Codex Round 2 #8 |
| `004-migrate-notebook-currentStage.js` | notebooks.currentStage='framework' → 'schedule'（003 未覆盖到 notebooks 表）| v4.3.3 Codex Round 3 #4 |

## 命名规范（v4.3.3+）

- 文件名格式：`{序号3位}-{kebab-case 描述}.js`（按字母序自动执行，序号空开后扩展）
- 每个 migration 必须 export `{ MIGRATION_ID, MIGRATION_VERSION, run(db, log) }`
- `run` 检查 `data.migrations` 数组防重，幂等执行
- 失败必须 try/catch 不阻塞 app 启动
