# Phase-9 阶段 D：前端 6 阶段重构（最小可用版）

**日期**：2026-05-09
**作者**：Claude（Baggio 主导）
**对应任务**：驭课 Agent v4.0.0 / 6 阶段工作流前端落地

---

## 目标

把 V2App.jsx 从 4 阶段（framework / lecture / ppt / video）切换到 6 阶段：

```
schedule → design → lecture → ppt → video（micro-video）→ report
```

---

## 改动清单

### 新建 4 个 Stage 组件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/renderer/src/v2/ScheduleStage.jsx` | ~120 | 教学进度表（起点）|
| `src/renderer/src/v2/DesignStage.jsx` | ~135 | 教学设计（5 段法 + 权重 100）|
| `src/renderer/src/v2/MicroVideoStage.jsx` | ~140 | 微课视频整套方案（替代旧 VideoStage）|
| `src/renderer/src/v2/ReportStage.jsx` | ~190 | 教学实施报告（含老师手填 9 项）|

**设计要点**：4 个组件都遵循同一布局——左侧（生成/保存/确认 + JSON 编辑器）+ 右侧（数据预览 + ArtifactPanel）。Report 阶段额外提供老师手填实施成效（5 项）+ 反思改进（4 项）的表单。

### V2App.jsx 修改（surgical edits）

1. **STAGES 数组**：`framework/lecture/ppt/video` → `schedule/design/lecture/ppt/video/report`
2. **STAGE_PRIMARY_ARTIFACTS**：补全 `schedule_table / design_doc / implementation_report`
3. **默认 stage**：`'framework'` → `'schedule'`（3 处）
4. **新增 4 个 state hooks**：`scheduleState / designState / microVideoState / reportState`
5. **新增 12 个 handler**（4 阶段 × 3 操作：generate/save/confirm）+ `handleCopyJimengPrompts`
6. **loadNotebookContext**：补充 4 个 v2:get*Data 调用 + 状态回填
7. **Stage 切换**：替换旧 `VideoStage` → `MicroVideoStage`，新增 schedule/design/report 3 个 branch

### Legacy 保留

- `FrameworkStage.jsx` 仍 import，但 `currentStage === 'framework'` 不再可达（STAGES 数组已移除）
- 旧 VideoStage.jsx 保留但不再 import 渲染（仅以注释方式标记 legacy）
- runtime.js 完全不动，老 framework 的 saveXxx/confirmXxx 链路保留备用

---

## 验证

### 编译验证

```bash
npx vite build
# ✓ 45 modules transformed
# ✓ built in 799ms
```

✅ 编译通过，无报错。

### 后端契约验证（Phase-9 累计）

| 脚本 | 通过率 |
|------|------|
| verify-contracts-v6.js | 27/27 |
| verify-schedule-service.js | 27/27 |
| verify-design-service.js | 21/21 |
| verify-micro-video-service.js | 25/25 |
| verify-report-service.js | 34/34 |
| **合计** | **134/134** |

### H9 提醒：还需端到端测试

契约/编译通过 ≠ 功能就绪。集成测试需 `npm run dev` 跑通：

1. 创建笔记本 → 进度表 → 教学设计 → 讲稿 → PPT → 微课视频 → 实施报告
2. 每个阶段：生成 → 保存 → 确认（解锁下游）
3. 报告阶段：老师手填实施成效 5 项 + 反思改进 4 项 → 保存 → 确认归档
4. 验证锁定逻辑：未确认上游 stage 时，下游 generate 应返回 STAGE_REQUIREMENTS 错误

---

## 已知技术债

1. **Schedule/Design 两阶段未生成 artifact 列表分组**
   - `scheduleArtifacts` / `designArtifacts` 是空数组未通过 v2:get*Data 拿到独立 artifact list
   - 当前依赖 V2App 整体 list；后续需要在 v2:getScheduleData 返回 artifacts[] 字段

2. **runtime.js 不参与新 stage 的 quality 评估**
   - 4 个新 stage 的 stageRuntimeMeta.quality 始终为 null
   - 前端的 `resolveStageState` 走 "ready" 默认分支，不会触发 reviewNeeded
   - 这与 Phase-9 决策"runtime.js 不动"一致

3. **新建笔记本流程未更新**
   - "新建笔记本" modal 仍展示老的字段（学时/理论实践分布等）
   - 没有新增"学校"字段（虽然 Schedule 默认填广州纺校）
   - 后续 Stage E 之前可补一个最小 modal 字段更新

4. **导出未做适配**
   - 现有 exportLectureWord / exportPptCourse 还是按老阶段调用
   - 实施报告暂无 Word 导出（后续可加 reportExport）

---

## 阶段 D 完工判定

按 Phase-9 立项约定，阶段 D 的最小可交付物是：

- [x] 6 阶段 STAGES 数据结构正确
- [x] 4 个新 Stage 组件可编译可渲染
- [x] V2App.jsx state hooks + handlers 接入正确
- [x] vite build 无 error
- [x] 不破坏现有契约组测试（134/134 全过）

**结论**：阶段 D 完工，进入阶段 E（文档更新 + 打包交付）。
