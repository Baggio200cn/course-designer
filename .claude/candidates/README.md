# .claude/candidates/ — 候选规则池

> **存什么**：重复出现 2-3 次的问题、即将升级为正式 H 约束的草稿。
> **不存什么**：一次性问题（在 `.claude/notes/`）；已正式约束（在 `.claude/hard-constraints.md`）。

## 文件命名约定

```
xxx-pattern.md   或   xxx-rule.md
```

例子：
- `anti-bot-cloudflare.md`
- `lazy-load-pattern.md`
- `chinese-site-class-hash.md`

## 模板

```markdown
# 候选规则：xxx

> **从 notes/ 升级日期**：2026-05-02
> **重复次数**：2 次（链接到原 notes：xxx, yyy）
> **状态**：候选（出现第 3 次或重大事件触发后升级到 hard-constraints）

## 问题描述
（一句话总结）

## 已观察到的实例
1. 2026-05-02：在 zhihu 抓取时 CSS class 哈希化导致正则失效
2. 2026-05-XX：在 jianshu 抓取时遇到同样问题
3. （等待第 3 次）

## 草拟的约束
（如果升级会写成什么样的 H 约束）

```
HXX：xxx
- 适用范围：...
- 触发原因：...
```

## 升级触发条件
- [ ] 出现第 3 次
- [ ] 重大故障（一次性烧掉超过 N 元 / 阻塞 M 个老师）
- [ ] 用户主动要求升级

## 替代方案（如果不升级 H）
（是否有架构改动、自动化、技术升级能消除这个问题，避免升级 H）
```

## 升级到 hard-constraints.md 的步骤

1. 决定升级（出现第 3 次 或 用户拍板）
2. 在 `.claude/hard-constraints.md` 末尾追加新 H 约束（如 H14）
3. 加完整身份证元数据：适用范围 / 引入日期 / 触发原因 / 负责人 / 过期条件
4. 在原 candidates 文件顶部加一行 `> ✅ 已升级到 hard-constraints.md H14`，归档（不删，留 git history）
5. 更新 `.claude/notes/` 中相关原始笔记，标记 `> 已升级到 H14`
6. 在 `CLAUDE.md` 入口页加一行新 H 约束的标题摘要

## 降级 / 删除

- **过时降级**：候选规则因架构变化失效 → 移到 notes 归档目录或直接删除
- **永不升级**：候选规则有更好的自动化方案（pre-commit hook / linter） → 移到 `.claude/code-style.md` 备注

## 维护节奏

- **每月底**（10 分钟）：扫 candidates/，决定升级 / 维持 / 删除
- **每版本发布**：必扫一遍

## Git 策略

- candidates/ **进 git**——便于审视"为什么有这条候选规则"
- 升级或删除后，原文件可以保留（带状态标记），方便追溯
