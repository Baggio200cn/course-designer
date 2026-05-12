# 项目上下文（2026-05-10 · Phase-9 完成 · v4.0.0 发布）

## 🎯 当前阶段：驭课 Agent v4.0.0 — Phase-9 完成

---

## ✅ Phase-9（2026-05-09 至 05-10 完成）

### A. 6 阶段工作流重构

```
v3.x: framework → lecture → ppt → video                 （4 阶段）
v4.0: schedule → design → lecture → ppt → video → report （6 阶段）
```

**契约文件**：`src/main/v2/contracts.js` — H1 例外批准，从 `STAGE_ORDER_LEGACY_V3` 升级到 `STAGE_ORDER`（6 阶段）+ `STAGE_REQUIREMENTS` 新依赖链。

### B. 各阶段重大改造

| 阶段 | 改造点 |
|---|---|
| 教学进度表（C-1）| 全新 18 周 6 列表，按广州纺校样例（周次/课次/章节/内容/方式/作业次数）|
| 教学设计（C-2）| AI 信息图新增 `design_overview` layout（6 段逻辑闭环：HERO→学情起点→三阶递进→学习路径→评价闭环→思政升华→GOAL）|
| 课堂讲稿（C-X）| **整门课讲稿 → 多节课讲稿**（每节 ≤4 学时，理论+实践拼配，顶部 tab 管理）|
| 教学课件（PPT）| 修复"22 页配图全相同"bug：移除 `GUIZANG_HERO_TYPES` 里的 `'模块页'/'课程导入'`，让模块页拿到差异化 prompt |
| 微课视频（C-3）| 整套方案：脚本+分镜+即梦提示词+拍摄+剪辑（替代旧的"仅生成提示词"）|
| 教学实施报告（C-4）| 全新阶段：AI 自动汇总前 5 阶段 + 老师手填 9 项 + **4 格式导出（Word/Markdown/HTML/PDF）**|

### C. 质量链路升级（B 方案阶段 1 接入多节课）

`v2:lessonGenerateFormal` 完整链路：
1. **`generateWithRetry`**：3 次自动重试 + 质量反馈注入（formal.builder fragment 9/10：五段式 + 课时连贯）
2. **`reviewAndRevise`**：9 维度审核（含 `referenceFusionDepth` / `fiveStepTransform` / `timelineConsistency`）+ 自动修订
3. **反虚构数据 prompt 约束**：禁止编造销量/点赞/产品性能/达人数等数字（基于 codex 58/100 review 反馈）
4. **素材落地结构化约束**：每条素材必须给"教师动作 + 学生提取项 + 组织讨论方式"

### D. 兼容性 + UX 修复

- **json_object 不支持降级**：`ark-course-client.chatJson` 检测 400 错"json_object is not supported by this model" → 自动去掉 response_format 重试
- **PNG 渲染截断修复**：`renderHtmlToPngBuffer` 加 `useContentSize: true` + 强制 setContentSize + 显式 `capturePage(rect)` + max_tokens 4000→12000
- **老师手搓正式稿**：粘贴文本模态 + 上传 .docx 替换 AI 版本（在 LectureStage）
- **URL 抓取多 URL 检测**：自动剥离 `;`/`,`/空格 后内容 + SPA 站点失败给备选路径
- **窗口标题修复**：`src/renderer/index.html` 从"AI 课程设计助手" → "驭课 Agent v4.0.0"
- **新建笔记本 modal 重构**：按广州纺校进度表样例字段（教师/学校简称/教学部/学期/班级/教材）

### E. Verify 回归

| 脚本 | 通过率 |
|---|---|
| verify-contracts-v6.js | 27/27 |
| verify-schedule-service.js | 27/27 |
| verify-design-service.js | 21/21 |
| verify-micro-video-service.js | 25/25 |
| verify-report-service.js | 34/34 |
| **Phase-9 累计** | **134/134** |

---

## ✅ Phase-8.5（2026-05-08 完成 · 治理 + 信息图升级）

- CLAUDE.md 拆分（772 行 → 200 行入口 + .claude/ 子文件）
- 杂志风信息图（magazine_module）+ verify-magazine-svg.js（7/7）
- B 方案阶段 1：review.service 5→9 维度审核 + formal.builder fragment 8→10（五段式 + 课时连贯性）

---

## ✅ Phase-8（2026-05-02 至 05-09 完成 · M0+ 网页深度抓取）

- 4 层 URL 抓取策略：httpGet → Defuddle → BrowserWindow → fallback
- web-extractor.service.js + verify-web-extractor.js（22/22）
- 老师面向：用真实网页素材生成讲稿/PPT 配图

---

## ✅ Phase-7.7 / Phase-7.5（2026-04-29 完成）

- A3：我的工作台（跨课程统计 + 经验沉淀）
- M7.5.1：Agent 暂停-恢复机制
- F1+F2：PPT 配图主题修复（"图文排版"不再画成"服装手工"）

---

## ✅ Phase-6 Harness 治理（已完成）

- M1：prompt-assembler 装配体系（source-registry / fragment-wrapper）
- M2：lockedByUser + 冲突裁决 + 上下文压缩
- M3：操作日志压缩 + 用户强制接受路径

---

## ✅ Phase-5 Agent（已完成）

- 5A：IPC 拆分到 14 个文件
- 5B：上下文富化（5 字段：软件/岗位/场景/学情/教材）+ AI Review Loop
- 5C：Agent 架构（5 步：Auto-Retry / Cross-Stage / Orchestrator / Memory / Backtracking）
- 5D：baoyu-skills 集成（SVG 教学结构图 + 知识点卡片 + PPT 配图升级）

---

## 🔮 下一阶段：Phase-10（待规划）

待老师试用 v4.0.0 后反馈，预计聚焦：

- 教学课件（PPT）22 页主题图差异化的进一步打磨
- 多节课讲稿之间的关联性增强（如交叉引用、复习前节）
- 实施报告 PDF 导出的中文字体优化
- 集成测试自动化（端到端跑通 6 阶段 + 真实 AI）

---

## 关键决策清单（参考用）

| 决策 | 时间 | 文档 |
|---|---|---|
| H1 例外批准（Phase-9 改 contracts.js）| 2026-05-09 | `.claude/notes/2026-05-09-phase9-h1-exception.md` |
| 学校简称统一"广州纺校" | 2026-05-09 | `.claude/notes/2026-05-09-school-shortname-convention.md` |
| runtime.js 不动策略 | 2026-05-09 | `.claude/notes/2026-05-09-phase9-runtime-strategy.md` |
| Phase-9 阶段 D 前端最小可用 | 2026-05-09 | `.claude/notes/2026-05-09-phase9-stage-d-frontend.md` |
| 老师反馈：讲稿 55→62 分 | 2026-05-08 | `.claude/notes/2026-05-08-teacher-feedback-formal-script.md` |

---

## 审查 + 维护

- **维护人**：Baggio（项目方）
- **代码协作**：Claude Code
- **下次审查**：v4.0.0 老师试用反馈后（预计 1-2 周内）
