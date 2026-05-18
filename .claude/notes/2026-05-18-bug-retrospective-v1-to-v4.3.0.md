# 驭课 Agent · 从 v1.x 到 v4.3.0 的 Bug 全量回顾

> 📅 **整理日期**：2026-05-18
> 🎯 **整理目的**：从老师对话历史 + 代码 fix 注释 + 真实试用反馈中，按**重复频率 + 影响范围**总结 bug 模式，给 v4.3.3+ 设计「不再犯」的护栏
> 📊 **数据来源**：60+ 次会话历史 / 代码 200+ 处 `// 修复 / fix / 误报 / hotfix` 注释 / 试用老师微信反馈
>
> **整理原则**：bug 不是孤立事件，是**架构缺陷**的症状。本文档按"症状 → 根因 → 是否已修"3 层组织，帮 v4.3.3+ 避免重复挖坑。

---

## 一、按重复出现频率排序的 Bug 类目（Top 10）

### 🔥 P0-1 · 跨版本/跨阶段数据丢失（影响最大 · 老师怒火 #1）

**症状**：
- 老师反馈：「**我昨天用 4.1.4 生成了 36 个教学设计，现在没了，因为他的教学进度变了😅**」
- 同类报告：升级版本后所有讲稿消失、PPT 配图丢、笔记本看不见
- 本人调试时也遇到：「生成讲稿没保存就刷新 → 找不回」（D8 修复前）

**根因**：
| 子类 | 触发条件 |
|---|---|
| 1.1 schedule 结构升级未做数据迁移 | v4.1.4 → v4.2.0 时 schedule 列字段改了，design artifact 的 `metadata.weekRange` 引用失效 → 全部 design 看不见 |
| 1.2 generate 不写库 | AI 出稿在 React state，老师没点保存就刷新 = 永远丢 |
| 1.3 metadata 被空表单冲掉 | 早期 bug 导致 metadata.lessonNumber/topic 被空值覆盖 |
| 1.4 多客户端切换不同 DB | dev 模式 `驭课 Agent/` vs 安装版 `Electron/` 用不同 AppData 路径 → 老师以为丢了 |

**已修**：
- ✅ D8（v4.3.0）：lecture 生成/AI patch/手贴 3 路径**生成完立即自动落库 draft**
- ✅ Phase-9.5（v4.2.0）：`v2:lessonRepairMetaFromTitle` 反推修 metadata
- ✅ D5 治本：design.handlers 保存时**同时写 metadata + content.lessonMeta** 双轨

**仍未修**：
- ❌ 跨版本 schema 迁移没自动化——升级后老 design artifact 可能因 schedule 字段变化失效
- ❌ PPT / 讲稿 / 测验 / 作业之间没有「**血缘追踪**」，上游改了下游不会报警

**建议护栏**：
1. 每次架构升级（Phase 数字+1）写 `migrations/YYYY-MM-DD-migration.js` 显式迁移老 artifact
2. 关键路径全部加 **autoSave 兜底**（不让用户依靠记忆点保存）

---

### 🔥 P0-2 · stage 质量误报阻塞老师（影响最大 · 老师怒火 #2）

**症状**：
- 「我已经确认完，为什么还是显示『可继续·有改进建议』？」
- 「正式讲稿教师口播量偏少（72 学时建议 158400-216000 字）」—— 实际只是单节 4 学时
- 「PPT 页数偏少（按 72 学时建议 30-40 页）」—— 实际是单节 16 页
- 「`method 缺失` 黄色警告」—— 实际 method 字段填了「讲授+案例分析法」

**根因**：
| 子类 | 触发条件 |
|---|---|
| 2.1 多节课模式校验器没改 | 校验器用 `notebook.totalHours=72` 当分母，但实际 artifact 是单节 4 学时 |
| 2.2 normalize 前后判断不一致 | warning 检查跑在 normalize 之前，看到的是 raw 数据，normalize 后字段已经填好 |
| 2.3 source='external-json' 漏判 | AI 生成的数据被同一逻辑当成外部导入数据查缺失 |
| 2.4 字段别名 mapping 太激进 | schedule alias-resolver 把 `method → approach`，老师改的「讲授+案例」被覆盖 |

**已修**：
- ✅ D9.1 / D9.2（v4.3.0）：`buildLectureStageBundle` / `buildPptStageBundle` 改 per-lesson 聚合模式
- ✅ ScheduleStage：黄色警告只在 `source='external-json'` 时显示
- ✅ schedule-alias-resolver：加 `'schedule[]'` 到 PROTECTED_KEYS_BY_CONTEXT

**仍未修**：
- ❌ 9 维度质检的某些规则仍是「全门课」口径，per-lesson 模式下可能误判
- ❌ 「PPT 页面摘要缺失」等子项警告还没区分 per-lesson 模式

**建议护栏**：
1. 所有校验函数显式声明「单节 / 全门课」模式
2. 误报警告只用 `info` 级，**绝不阻塞**老师确认

---

### 🔥 P0-3 · 模板化硬编码（H14 反复违反）

**症状**：
- AI 莫名其妙生成「广州纺校 / 周成锦老师 / 23 级流行资讯班」 ← 不是当前老师的学校
- 老师反馈：「**我不是这个学校的老师，为什么自动填进去？**」
- 「为什么必须 72 学时？我们是 36 学时课程」
- 「为什么必须 18 周？」「为什么首周自动加安全教育？」

**根因**：
- 早期 prompt 把样例数据当 default 兜底
- IPC handler 用 `|| 72` / `|| 4` / `|| '广州纺校'` 等硬兜底
- 代码注释里偷写「首周加安全教育」业务规则

**已修**：
- ✅ v4.3.0 引入 **H14 硬约束**：禁任何教学参数硬编码 default
- ✅ `prompts/schedule.md` 删 example 中的「广州纺校/23级」
- ✅ `prompts/lecture-full-script.md` 删「周成锦/23级」字数硬指标
- ✅ ScheduleStage：minutesPerHour 必填，从 notebook 读不再用 45 兜底
- ✅ V2App.jsx：NOTEBOOK_FORM 移除「广州纺校 / 服装科 / 2024-2025」default

**仍未修**：
- ❌ 部分 prompt 模板里残留少量学校/课程名样例（仅作为示意）
- ❌ 没有自动化检查「代码新增 `|| 72` 这种硬兜底」的 lint 规则

**建议护栏**：
1. ESLint 自定义规则检查 `|| 72` / `|| 4` / `|| 45` 等魔数 fallback
2. `.claude/hard-constraints.md` 的 H14 持续审计

---

### 🔥 P1-1 · UI 不同步 / state 漂移（高频）

**症状**：
- 「下拉选了节课，但下拉框显示空白」
- 「PPT 阶段切到第 17 节，但讲稿阶段还停在第 1 节」
- 「`pptState.notebookId` 是 null，列表加载不出来」
- 「textarea 拖大后释放就弹回」

**根因**：
| 子类 | 触发条件 |
|---|---|
| 1.1 dropdown `value=""` 硬写 | DesignStage 下拉永远值 = `""` ，不反向同步 |
| 1.2 setPptState 重置不带 notebookId | reset 时把 notebookId 也清空了 |
| 1.3 cross-stage SessionContext 不联动 | 用户在面包屑切到第 17 节，但 lecture 阶段不响应 |
| 1.4 inline width:100% 覆盖用户拖拽 | React re-render 把用户 resize 后的 width 改回 100% |

**已修**：
- ✅ DesignStage：下拉 value 从 lessonForm.weekRange + lessonNumber 反向推
- ✅ V2App：setPptState 包含 `notebookId: selectedNotebookId`
- ✅ SessionBreadcrumb：auto-switch useEffect
- ✅ D8 大文本框：用 wrapper div + CSS class 而不是 inline style

**仍未修**：
- ❌ 没有统一的「state 漂移」检测机制（如 React DevTools 监控）

**建议护栏**：
1. 跨 stage 状态用单一来源（SessionContext）+ subscribe 模式
2. 关键 UI 字段用 useDeferredValue / useReducer 而不是裸 useState

---

### 🔥 P1-2 · 用户的真实路径未被覆盖（H9 视角）

**症状**：
- 「verify 134/134 全过 → 应用启动炸」
- 「selfCheck mock 通过，但真 ARK endpoint 接通后报 400 json_object not supported」
- 「PPT 配图终端报 ✓ 成功，但前端图全 broken」

**根因**：
- 测试用 mock client 永远默认通过
- 真实 ARK doubao `ep-m-...` 多模态端点不支持 `response_format: { type: 'json_object' }`
- preload 改了 HMR 不会重载，老 preload 还在跑

**已修**：
- ✅ chatJson 自动检测 400 「json_object is not supported」→ 重试去掉 response_format
- ✅ CLAUDE.md 加 H9：「selfCheck mock 通过 ≠ 功能就绪」
- ✅ CLAUDE.md 加 0.2 节「对手审计 5 问」

**仍未修**：
- ❌ verify 脚本仍主要测 mock 路径
- ❌ 没有「真实 ARK endpoint smoke 测试」CI 流程

**建议护栏**：
1. 关键 IPC 必须有「真 endpoint smoke test」（可手动触发）
2. 修完代码先**在真 Electron 跑一遍**再说「完成」

---

### 🔥 P1-3 · 跨文件同名函数副本（隐蔽 bug）

**症状**：
- 「我改了 `renderHtmlToPngBuffer`，但前端调的还是老版本」
- 「明明加了日志没看到打印」
- 「改了 main 不重启所以新代码没生效」

**根因**：
- `renderHtmlToPngBuffer` 在 `index.js` / `media.handlers.js` / `prompt.handlers.js` 3 处独立定义
- 改 1 处不影响另外 2 处的调用方
- HMR 只重 renderer，main / preload 改了必须完整重启

**已修**：
- ✅ CLAUDE.md 五·二节经验 1：函数同名多处副本必查全局
- ✅ CLAUDE.md 五·二节经验 2：preload 改了必须完整重启 Electron

**仍未修**：
- ❌ 没有自动化检查「重复函数定义」的 lint
- ❌ 代码注释里没标「本函数在 X / Y / Z 各有副本」

**建议护栏**：
1. 同名函数前加 `// @duplicated-in: media.handlers.js · prompt.handlers.js` 注释
2. ESLint no-duplicate-function-name 自定义规则

---

### 🔥 P1-4 · 网络/URL 抓取脆弱（老师高频抱怨）

**症状**：
- 「我给的 vogue 链接抓不到内容」
- 「digitaling 网站封 bot」
- 「SPA 站点（britannica/medium）抓回来是空字符串」
- 「抓取列表只显示 URL 不显示字数 → 不知道有没有抓到内容」

**根因**：
- 简单 HTTP fetch 抓不了 SPA
- 没显示抓取结果的字数 → 老师误以为抓到了
- 抓失败后没有清晰 fallback 引导

**已修**：
- ✅ Phase-8 M0+：web-extractor 4 层策略（站点专属 → httpGet+Defuddle → BrowserWindow+Defuddle → 兜底）
- ✅ D8（v4.3.0）：素材列表每条加状态条（🟢字数 / 🟡过短 / 🔴 0 字）+ 60 字预览
- ✅ 抓失败后弹出引导「改用粘贴文本 / 上传文件」

**仍未修**：
- ❌ Cloudflare 等保护机制无解
- ❌ 国外站点（vogue.com 等）BrowserWindow 也抓不到

**建议护栏**：
1. UI 明确告诉老师「以下站点必失败」黑名单
2. 加 URL 类型识别（SPA → 直接走 BrowserWindow）

---

### 🔥 P1-5 · AI 生成的内容不可控（老师高频抱怨）

**症状**：
- 「AI 生成的讲稿一直是 ABC 三稿，老师只想要 1 稿」
- 「AI 一直在编造销量数据（GMV 620 万 / 小红书 12W 赞）」
- 「AI 生成的字数严重不足」
- 「AI 拒绝按我说的改，每次重生成都不一样」

**根因**：
- prompt 没明确禁止编造
- prompt 没强制 PPT 骨架对应口播
- 一步出稿 vs 多稿选稿设计漂移

**已修**：
- ✅ D6.1（v4.3.0）：rewrite lecture prompt — PPT 骨架 100% 权重 + 素材 80% 深度 + 5 段法 30%
- ✅ D6.2：删两步流程，一步出稿
- ✅ D6.5 / D7 / D8：右侧 AI 对话框做**局部 patch**，老师可以「把第 3 页改口语化」
- ✅ prompt 加反例清单：`❌ 反例：'GMV 620 万' / '小红书 12W 赞'`

**仍未修**：
- ❌ 字数严重偏少时没有自动 retry-with-instruction
- ❌ AI 偶尔仍漏掉「教师讲述」结构

---

### 🔥 P1-6 · 阶段解锁逻辑错（高频）

**症状**：
- 「已经点了确认本节讲稿，为什么下游 PPT 还是锁着？」
- 「明明 design 阶段已确认，但 PPT 阶段说『前置缺失』」

**根因**：
- per-lesson confirm 没调用 `syncWorkflowStageAvailability()`
- 老的 stage 转换契约不认识新的 per-lesson artifacts

**已修**：
- ✅ D9.1（v4.3.0）：lessonConfirm 自动调 syncWorkflowStageAvailability
- ✅ D9.3：手动「⚙ 强制解锁下游」按钮兜底

**仍未修**：
- ❌ 上游 design / schedule 阶段也可能有类似遗漏

---

### 🔥 P1-7 · 上传文件格式判定混乱（高频）

**症状**：
- 「上传 .pdf 提示『暂不支持』，但你们说支持？」
- 「上传 .pptx 报错『请转 .docx』」
- 「图片上传后显示 OCR 失败」
- 「.docx 上传一直说『文件内容为空』」

**根因**：
- D6.4 加 PDF/PPTX/OCR 支持后，前端 UNSUPPORTED 列表和 file accept 没同步更新
- docx mammoth 早期 buffer/base64 参数传错

**已修**：
- ✅ D6.4：加 pdf-parse 依赖 + 图片 OCR（复用 ep-m- 多模态文本端点）
- ✅ D8：LectureStage 素材上传 accept 加 .pdf / .pptx
- ✅ D8：移除老的 PDF/PPTX「暂不支持」提示

**仍未修**：
- ❌ 扫描版 PDF（图片版）抽不到文本，需要老师手动截图走 OCR
- ❌ 多语言 PDF（含特殊字符 LaTeX 等）解析不稳

---

### 🔥 P1-8 · 学时/字数动态对齐不准（高频）

**症状**：
- 「45 分钟一学时」是学校默认，但老师学校是 50 分钟
- AI 生成的讲稿不按学时算字数
- 「4 学时 16 页 PPT」校验失败说要 30 页

**根因**：
- 早期 prompt 写死 `45 分钟 × 总学时`
- 字数计算硬编码 2200-3000 字/学时

**已修**：
- ✅ V2App：minutesPerHour 必填字段
- ✅ prompts/lecture-full-script.md：动态从 minutesPerHour 算字数
- ✅ D9.1：per-lesson 模式按 confirmedHours 算分母

**仍未修**：
- ❌ 部分老 prompt 仍隐含 45 分钟假设

---

## 二、按"是否已修"分类

### ✅ 已修复（v4.3.0 关闭）
- D6.1 lecture prompt PPT 骨架优先
- D6.2 删 ABC 三稿流程
- D6.3 右侧 AI 对话面板
- D6.4 PDF/PPTX/OCR 支持
- D6.5 AI patch 协议
- D7.1-D7.3 PPT 下拉骨架 + 自动预填 + 文案修正
- D8 三路径自动保存 + 大文本框四方向拖拽 + 素材列表状态条
- D9.1 lecture 聚合校验
- D9.2 PPT 聚合校验
- D9.3 「⚙ 强制解锁下游」按钮 + lessonConfirm 自动触发 syncWorkflowStageAvailability
- P5 治本 metadata（design.handlers 同时写双轨）
- H14 反模板化铁律

### ⚠ 部分修复（v4.3.0 仍有遗留）
- 上传格式（扫描版 PDF / .xlsx / 老 .doc 仍不支持）
- AI 字数控制（有时偏少，需要老师手动 retry）
- URL 抓取（部分海外站 + Cloudflare 保护站抓不到）

### ❌ 未修（v4.3.3+ 待处理）
1. **跨版本数据迁移**（最大坑 · 影响老师信任）
2. 9 维度质检的 per-lesson 模式适配
3. 真实 endpoint smoke test CI
4. 跨文件同名函数自动检测
5. AI 字数严重不足时自动 retry

---

## 三、给 v4.3.3+ 的建议护栏

### 1. 数据持久化
- [ ] 每次架构升级写 `migrations/YYYY-MM-DD-xxx.js` 显式迁移
- [ ] 关键操作必有 autoSave 兜底（不依赖用户记忆点保存）
- [ ] artifact 之间加「血缘追踪」（上游改 → 下游标记 dirty）

### 2. 测试覆盖
- [ ] selfCheck mock 路径 + 真实 endpoint smoke test **双轨**
- [ ] verify 脚本不能只测 mock
- [ ] 每个 stage 加 e2e 真实跑通的脚本

### 3. UI 体验
- [ ] 所有可能"以为成功了"的操作必显示**事实证据**（字数 / 数量 / 文件大小）
- [ ] 误报警告一律 info 级，不阻塞确认
- [ ] 高频跨 stage 数据用 SessionContext 单一源

### 4. AI 内容质量
- [ ] prompt 反例清单越具体越好（"GMV 620 万"比"禁止编造"有效）
- [ ] AI 生成失败时自动 retry-with-instruction（不是默默接受）

### 5. 工程纪律
- [ ] 改 preload / main 必完整重启 Electron 提示
- [ ] 同名函数副本注释 `@duplicated-in`
- [ ] ESLint 自定义规则查 `|| 72` 等魔数 fallback

---

## 四、最高频"老师怒火 Top 5"

| # | 老师原话 | 出现次数（估）| 已修否 |
|---|----|----|----|
| 1 | 「我昨天用 X.X.X 生成了 36 个 XXX，现在没了」 | 5+ | ⚠ 部分（autoSave 修了，但跨版本迁移没修）|
| 2 | 「为什么显示 72 学时 X 字 / N 页？我们是 4 学时」 | 4+ | ✅ D9 修了 |
| 3 | 「为什么自动填了广州纺校/周老师/23 级？」 | 4+ | ✅ H14 + v4.3.0 修了 |
| 4 | 「确认完了为什么下游还锁着 / 还在报警告？」 | 4+ | ✅ D9.3 修了 |
| 5 | 「为什么生成完刷新就丢了？」 | 3+ | ✅ D8 修了 |

---

## 五、维护建议

- **本文档每月体检**：新 bug 加入对应类目 + 更新 Top 5
- **每次发新版**：在 README 加入「老 bug 已修 / 新 bug 待修」对照表
- **老师反馈渠道**：建议加一个内置「报告 bug」按钮，自动收集屏幕截图 + 终端日志 + 版本号

---

**📚 总结**：从 v1.x 到 v4.3.0，最大的 3 个教训：
1. **不要为快而绕过持久化** —— 老师一次刷新丢数据 = 永久失去信任
2. **不要把 mock 通过当 OK** —— 真路径 + 真数据才算完成
3. **不要相信 AI 默认值** —— 教学参数必须老师确认，AI 是助手不是决策者
