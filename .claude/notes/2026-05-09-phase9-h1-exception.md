# H1 例外审计：Phase-9 工作流重构修改 contracts.js

> **日期**：2026-05-09
> **批准人**：Baggio（项目方）
> **触发场景**：试点老师集体反馈，要求把开发工具流程从 4 阶段重新调整为 6 阶段
> **状态**：✅ 已批准例外，进入实施

---

## 一、为什么需要破 H1

H1 规定 `src/main/v2/contracts.js` 只读（Stage 依赖链是命脉）。

但老师们调整后的新工作流是 **6 个阶段**：

```
教学进度表 → 教学设计（补充）→ 课堂讲稿 → 教学课件 → 微课视频 → 教学实施报告
   (新)        (新)              旧 lecture   旧 ppt     升级版 video   (新)
```

当前 contracts.js 定义的是 **4 阶段**（framework → lecture → ppt → video）。

**6 阶段架构与 4 阶段在以下层面不兼容**：
- 阶段数量（4 vs 6）
- 阶段名称（framework 拆成 schedule + design）
- 阶段依赖（report 阶段需要前 5 个全部产物作为输入）
- artifact_type（schedule_table / design_doc / implementation_report 全是新的）

要做 Phase-9，**必须改 contracts.js**——否则只能做"假 6 阶段"（前端展示 6 个，后端仍是 4 个），那样下游的导出、Agent 编排、verify 全都会出问题。

## 二、用户的明示批准

2026-05-09 用户原话：

> "1，批准 H1 例外；
>  2，必须按照进度往前赶工，尽快完成老师交代的任务；
>  3，数据库里的笔记可以全部删除；
>  4，'驭课 Agent' 全部调整；
>  5，B 方案阶段 1 跟 Phase-9 一起放出去测"

## 三、改动的安全护栏

虽然破 H1，但以下护栏保留：

1. **改动范围明确**：仅修改 `src/main/v2/contracts.js` 的 STAGE_ORDER / STAGE_DEPENDENCIES / ARTIFACT_TYPES 三个常量，**不改 IPC handler 命名或调用方式**
2. **publication-contracts.js 同步改**：Stage 依赖在两处都要保持一致
3. **数据库迁移**：用户许可全部删除老课程数据，避免迁移兼容问题
4. **回滚预案**：保留 `contracts.legacy.js` 作为回滚基线
5. **每改一处必跑 verify**：phase-9 期间所有改动后立即跑 verify-prompt-assembly + verify-agent-orchestrator + 新增的 verify-contracts-v6
6. **品牌升级到 v4.0.0**（major bump）—— semver 表达"破坏性变更"
7. **本笔记** + `.claude/hard-constraints.md` H1 节会显式标注此次例外

## 四、本次例外不构成 H1 删除

H1 仍然是有效的硬约束。本次只是**一次显式批准的例外**。

未来再有"修改 contracts.js"的需求，**必须重新走批准流程**——不允许把"Phase-9 改过"作为先例。

## 五、实施后的更新动作

Phase-9 完成后必须做：
- [ ] 更新 `.claude/hard-constraints.md` H1，加"已知例外：Phase-9（2026-05-09，Baggio 批准）"标注
- [ ] 在 `.claude/phases/phase-9.md` 完整记录 contracts.js 改动 diff
- [ ] 把本笔记顶部状态从 "🔥 进行中" 改为 "✅ 已落地"
- [ ] 跑全套 verify 脚本（特别是 verify-agent-orchestrator + verify-prompt-assembly）确保不破坏老路径
