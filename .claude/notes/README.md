# .claude/notes/ — 临时笔记目录

> **存什么**：出现 1 次的现象、问题、调试线索、临时观察。
> **不存什么**：已升级为正式 H 约束的内容（在 `.claude/hard-constraints.md`）；重复出现的（在 `.claude/candidates/`）。

## 文件命名约定

```
YYYY-MM-DD-简短主题.md
```

例子：
- `2026-05-02-firecrawl-404.md`
- `2026-05-02-zhihu-curl-blocked.md`
- `2026-05-02-defuddle-debug.md`
- `2026-05-03-feedback-from-teacher-wang.md`

## 模板

每条笔记建议包含：

```markdown
# 主题

> **日期**：2026-05-02
> **触发场景**：xxx
> **状态**：临时（出现第 1 次）

## 现象
（具体观察到什么）

## 当时怎么处理
（临时应对方案）

## 后续要不要追踪
- [ ] 出现第 2 次时升级到 candidates
- [ ] 出现第 3 次时升级到 hard-constraints
- [ ] 已被自动化/架构变化取代 → 删除此笔记
```

## 升级路径

| 现象重复次数 | 行动 |
|------------|------|
| 1 次 | 留在 notes/，下次扫笔记时核对 |
| 2 次 | 移到 `.claude/candidates/`，写候选规则 |
| 3 次或必须强制 | 升到 `.claude/hard-constraints.md` 作为新 H 约束 |

## 维护节奏

- **每周末**（5 分钟）：扫 notes/，把重复的移到 candidates/，过时的删除
- **每月底**：扫 candidates/，把高频的升到 hard-constraints.md

## 反例

- ❌ 把"今天发现的 bug 修复细节"写到 notes/——这应该是 git commit message
- ❌ 把"项目长期价值观"写到 notes/——这应该在 CLAUDE.md 或 hard-constraints.md
- ❌ 把"商业化决策"写到 notes/——这应该在 `.claude-memory/MEMORY.md`
- ❌ 把"老师面向的使用说明"写到 notes/——这应该在 `dist/`

## Git 策略

- notes/ **进 git**——便于团队/未来的自己追溯思考链路
- 但单条笔记如果是临时调试输出（如 console.log dump），写完后审视一下要不要删
