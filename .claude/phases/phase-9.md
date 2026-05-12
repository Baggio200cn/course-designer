# Phase-9 完成总结（2026-05-09 至 05-10）

> v3.x → v4.0.0 工作流大重构

---

## 主要成果

Phase-9 把驭课 Agent 从"v3.x 4 阶段单门课模型"升级为"v4.0.0 6 阶段多节课模型"，对齐中职真实教学开发流程（教学进度表 → 教学设计 → 多节课讲稿 → 教学课件 → 微课视频 → 教学实施报告）。

---

## 阶段切片

| 阶段 | 范围 | 关键成果 |
|---|---|---|
| **A 阶段**（品牌升级）| package.json/main/preload/renderer 全局 | "刘老师 Agent 2.x" → "驭课 Agent v4.0.0" |
| **B 阶段**（契约升级）| `src/main/v2/contracts.js` H1 例外 | 4 阶段 → 6 阶段 STAGE_ORDER + STAGE_REQUIREMENTS |
| **C-1**（进度表）| `services/schedule.service` + `prompts/schedule.md` + `verify-schedule-service.js` 27/27 | 18 周 6 列表（按广州纺校样例）|
| **C-2**（教学设计 + AI 信息图）| `services/design.service` + `infographic-card.service.design_overview` + verify 21/21 | 5 段法 100% 权重 + 6 段逻辑闭环信息图 |
| **C-3**（微课视频）| `services/micro-video.service` + verify 25/25 | 完整方案：脚本+分镜+即梦提示词+拍摄+剪辑 |
| **C-4**（实施报告）| `services/report.service` + 4 格式导出 + verify 34/34 | 9 大节 AI 汇总 + 5 项手填成效 + 4 项反思改进 |
| **C-5**（多节课讲稿）| `ipc/v2/lesson.handlers` + LectureStage 重写 | 1 份整门课 → N 份多节课（每节 ≤ 4 学时）|
| **D 阶段**（前端 6 阶段重构）| V2App.jsx + 4 个新 Stage 组件 | 顶部 6 个 stage tab + 学时进度条 |
| **E 阶段**（兼容性 + UX 修复）| 8+ 处隐藏陷阱 | 详见下方"踩过的坑"|

---

## 核心数字

| 指标 | 数值 |
|---|---|
| 新增文件数 | ~25（services + handlers + Stage 组件 + export/* + prompts）|
| 修改 V2App.jsx 行数 | +600 行（≈ 17% 增长）|
| Verify 脚本通过 | 134/134（5 个 Phase-9 新脚本）|
| 4 格式报告导出 | Word ✅ Markdown ✅ HTML ✅ PDF ✅ |
| AI 信息图布局 | 7 种（含新增 design_overview）|
| 信息图风格 | 6 种（含新增 design_overview）|

---

## 踩过的坑（按发现顺序）

### 1. 函数同名多副本盲区
- `renderHtmlToPngBuffer` 在 `index.js` / `media.handlers.js` / `prompt.handlers.js` 各定义一份
- 修一处不影响另两处——生产路径用的是 handler 本地副本
- 教训：grep -rn "function fnName" 全局搜，确认调用方真用的哪份

### 2. preload 不会 HMR 重载
- 改了 `src/preload/index.js` 必须完整重启 Electron
- HMR 只重载 renderer，preload + main 必须重启
- 4 次"为什么没生效"都因这个

### 3. AI 模型 endpoint 兼容性
- doubao `ep-m-...` 多模态文本端点不支持 `response_format: { type: 'json_object' }`
- 走 chatJson 5 次连续 400 错误
- 修：自动检测错误信息 + 降级重试
- 教训：跨 endpoint API 必须带 fallback

### 4. capturePage 截断 bug
- HTML 真实 1790px 高 → PNG 只输出 1069px
- 根因：BrowserWindow chrome 高度 + DPI + capturePage 默认截 viewport
- 修：useContentSize:true + setContentSize 强制 + capturePage(rect) 显式

### 5. Hero 分支吞掉模块页
- `GUIZANG_HERO_TYPES = ['封面', '模块页', '路线图', '课程导入']`
- 22 页里 60% 是 '模块页' 全部走 Hero 纯纹理 prompt → 全部相同的暗黑背景图
- 修：Hero 仅保留 ['封面', '路线图']，模块页走 pageConceptHints

### 6. db.getArtifactsByNotebook 不存在
- 4 个新 handler 都用了这个不存在的方法
- 防御性 if(...) 判断让 bug 静默通过 → 数据"出现又消失"
- 修：改为 `db.listArtifacts({ notebookId })`

### 7. spec 上加约束 vs 把通用规范改干净
- 通用 system prompt 里硬编码"右侧模块编号"硬塞每张图
- 加 layout-specific spec 不够，必须 `selfContained` 标记跳过通用规范
- 教训：约束最强的位置在最低层级（system prompt 通用规范）

### 8. 老 framework runtime 残留 UI
- 老 framework 的"阶段运行时"在新 6 阶段下仍显示"教学目标尚未生成"等错误
- 修：仅 lecture/ppt 走老 runtime，其他 stage 隐藏老面板

### 9. PPT 配图主题不匹配（codex review 启发）
- "故意不传 pageTitle / contentPreview" 注释看起来对（防文字烧入）
- 但矫枉过正：22 页主题信息全没传 → AI 给统一通用图
- 修：分清"作为字符渲染" vs "作为画面概念" 两种信息形态

### 10. 讲稿质量不够 80 分（codex 58/100 review）
- 虚构数据 / 素材没落地 / AI 套话开场 / 课时堆模块 / 评价 100 分制不一致
- 修：把 5 类"反例清单"写进 prompt（"❌ '小红书 12W 赞'""❌ '可以看一下 Canva 模板'"）
- AI 看到具体反例后主动避免，比单纯说"要落地"有效 10 倍

---

## 最大收获

### 1. 把"selfCheck mock 全过 ≠ 功能就绪"作为铁律
Phase-9 多次"verify 134/134 全过 + 应用启动炸"——根因都是真实环境特性（preload 缓存、endpoint 兼容、db 方法、UI HMR）。这进一步验证了 CLAUDE.md 0.1 节的核心原则。

### 2. 用真实日志 1 分钟定位 vs 看截图 30 分钟瞎猜
PPT 配图重复问题——加 console.log 后老师贴日志 → 1 分钟看出 GUIZANG_HERO_TYPES 拦截。比之前 3 次"靠截图改 prompt"快太多。

### 3. 反例清单 > 正面约束
- 单纯告诉 AI "不要编造数据" → 仍然编
- 给 AI 5 条具体反例（"❌ 'GMV 620 万'"）→ 主动避免

### 4. 半模板视觉 = 100% 可控的"信息图"
- 前端 React/SVG 直接画 = 反复改 prompt 不如直接画 layout
- 但 Phase-9 后期老师还是想要"AI 生成的真实信息图"——所以 design_overview 用 prompt 生成 HTML+CSS（仍是 AI 生成），但 prompt spec 严控结构

---

## v4.0.0 就绪度

| 维度 | 状态 |
|---|---|
| 核心功能 6 阶段闭环 | ✅ 全跑通 |
| Verify 自动化 | ✅ 134/134 |
| 端到端真实 AI 测试 | 🟡 老师手动测试中 |
| Word/PDF 导出 | ✅ 已交付 |
| 中文字体（Microsoft YaHei）| ✅ 内嵌于 export/* |
| 文档治理（CLAUDE.md/notes/phases）| ✅ 已更新到 Phase-9 |
| 安装包 NSIS | ✅ v4.0.0 已生成 |
| 老师培训文档 | ✅ 老师安装指南已交付 |

---

## 下一阶段（Phase-10）规划

- 老师试用反馈收集
- PPT 22 页主题图差异化打磨（如果反馈说还是不够）
- 多节课之间的关联性（前节复习 / 后节预告）
- 实施报告 PDF 中文字体优化
- 集成测试自动化（puppeteer 端到端 6 阶段）

---

## 维护责任

- **维护人**：Baggio
- **代码协作**：Claude Code
- **下次审查**：Phase-10 启动前
