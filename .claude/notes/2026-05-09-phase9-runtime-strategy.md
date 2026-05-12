# Phase-9 阶段 B 决策：runtime.js 不动，新阶段持久化放各自 service

> **日期**：2026-05-09
> **决策人**：Claude（对手审计 5 问后自行决定，已告知用户）
> **状态**：临时（如阶段 D 前端重构时发现需要改 runtime，再升级到 candidates）

## 背景

Phase-9 阶段 B 计划：改 contracts.js + runtime.js + db-simple.js 三个核心文件适配 6 阶段。

实际进展：
- ✅ contracts.js：替换为 6 阶段（27/27 verify 通过）
- ❌ runtime.js：**决定不动**
- ❌ db-simple.js：不需要改（artifact_type 是自由字符串，不维护枚举）

## 为什么 runtime.js 不动

### 选项对比

| 方案 | 含义 | 风险 |
|------|-----|------|
| A. 加 6 个新 saveXxxStage 函数 | 复制 saveFrameworkStage 模式 6 次 | 文件膨胀到 1500+ 行 + 6 套类似代码冗余 |
| B. 新建 runtime-v6.js | 把新阶段 save/confirm 隔离到新文件 | 引入两套 runtime 系统，老代码继续用老 runtime，新代码用新 runtime——治理债务 |
| **C. 不动 runtime.js**（采纳）| 新阶段持久化逻辑放各自 service（schedule.service / design.service / report.service）| **runtime.js 0 风险**，新逻辑内聚到各 service |

### 选 C 的理由

1. **runtime.js 是 v3.x 的"Stage 状态机"**——它有 9 个 saveXxx/confirmXxx 函数，每个 ~100 行，深度耦合 normalizeFrameworkContent / validateFrameworkContent / syncFrameworkArtifacts 等。新阶段（schedule/design/report）的内容结构完全不同，强行复用反而绕弯子。

2. **新阶段的数据简单**：
   - schedule：18 周 × 6 列表格（约 200-500 字）
   - design：单文档（课前/课中/课后 + 信息化 + 考核权重，约 1000-2000 字）
   - report：聚合产物（前 5 阶段 artifact 摘要 + 老师手填，约 2000-4000 字）
   - **不需要 normalizeXxx 和 validateXxx 那种复杂校验链**——直接 db.createArtifact 即可

3. **service 内聚比 runtime 集中更符合 v4.0.0 治理理念**：
   - schedule.service.js 同时管"AI 生成进度表 + 写入 artifact + 触发解锁"
   - 比 runtime.js 集中调度更清晰，单个 service 文件即可全程跟踪逻辑

4. **保留 saveFrameworkStage 风险最低**：
   - 老代码（agent/orchestrator.js / framework.handlers.js）继续能调
   - 阶段 D 前端重构时移除 framework 入口，自然废弃这些调用
   - **不主动删 = 不引入回归风险**

## 阶段 C 各 service 的统一接口约定

```javascript
// scheduleSvc / designSvc / reportSvc 都遵循这个接口
async function generate({ aiClient, notebookId, ...stageInputs }) {
  // 1. 调 AI 生成
  const aiOutput = await aiClient.chatJson({...});
  // 2. 写入 artifact
  const artifact = db.createArtifact({
    notebook_id: notebookId,
    type: 'schedule_table',  // 或 design_doc / implementation_report
    stage: 'schedule',        // 或 design / report
    content: { ... },
    confirmed: false,
    status: 'draft'
  });
  return { success: true, data: { artifact } };
}

async function confirm({ notebookId, artifactId, userForceAccept }) {
  // 调 db.updateArtifact(artifactId, { confirmed: true, status: 'confirmed' })
  // 触发 syncWorkflowStageAvailability（如果需要）
}
```

## 升级条件

如果阶段 D 前端重构时发现：
- 老的 runtime.saveFrameworkStage 仍被前端意外调用 → 把这条升级为 candidates，决定是否抢救
- 新 service 接口出现统一抽象需求 → 考虑新建 lib `v2-stage-save-helpers.js`

否则保持现状。

## 关联文件

- contracts.js：已改为 6 阶段（v4.0.0）
- runtime.js：**不动**（保留 v3.x 的 saveFrameworkStage 等所有函数）
- db-simple.js：**不动**（artifact_type 是自由字符串）
- 阶段 C 将新建：scheduleSvc / designSvc / reportSvc + 各自 IPC handler
