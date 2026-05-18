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

| 文件 | 用途 |
|---|---|
| `001-recover-orphan-artifacts.js` | P0-1 修复 · 标识老版本"丢失"的 artifact（status='deleted' 但 content 非空）→ 让老师在教师日志看到 |
