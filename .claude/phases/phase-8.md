# Phase-8 历史

> **战略目标**：从"v3.0.0 完整 Workflow Agent"推进到 B 档商业化（5 所学校试点）。
> **当前状态**：M0+ 完成（网页深度抓取 + UX 优化）；M1（Phase-6 M4 收尾）待启动。

---

## M0+ 网页深度抓取（2026-05-02）

### 背景

老师反馈"URL 抓取深层内容拿不到"，原 Phase-7.7 D4 双层策略（httpGet → BrowserWindow innerText）对中国常用站点（知乎/CSDN/微信）和复杂 SPA 命中率不足。

### 决策路径

| 方案 | 状态 | 决策原因 |
|------|------|--------|
| A. 集成 Firecrawl 付费 API | ❌ 否决 | API Key 硬编码风险 + 老师 BYO 增门槛 |
| B. 集成 ML 模型（Dripper-0.6B / ReaderLM-v2 1.5B）| ❌ 否决 | 老师下载 1.2GB / 部署复杂 / B 档规模没必要 |
| **C. 借鉴 GitHub 开源项目** | ✅ **采用** | 零云依赖、零付费 API、老师零等待 |

### 实现：4 层抓取策略

借鉴 [Defuddle](https://github.com/kepano/defuddle) (TypeScript Mozilla Readability 升级版) + [Crawl4AI](https://github.com/unclecode/crawl4ai) 思路 + [puppeteer-autoscroll-down](https://github.com/mbalabash/puppeteer-autoscroll-down) 算法：

```
Layer 1: 站点专属规则（知乎/CSDN/简书/微信公众号）  ~30% 命中
   ↓ fallback
Layer 2: httpGet + Defuddle                       ~50% 命中
   ↓ fallback
Layer 3: BrowserWindow + 自动滚动 4 轮 + 启发式点击「展开全文」+ Defuddle  ~80% 命中
   ↓ fallback
Layer 4: 兜底 raw text                             ~95% 命中
```

### 文件清单

| 文件 | 性质 |
|------|------|
| `src/main/services/web-extractor.service.js` | 🆕 新建（~340 行）|
| `src/main/ipc/system.handlers.js` | 🔧 改：废弃旧双层、调新 service |
| `scripts/verify-web-extractor.js` | 🆕 新建（22 个用例）|
| `package.json` | +2 deps（defuddle 0.18.1 / turndown 7.2.4）|

### Phase 1.5 + Phase 2 升级

**Phase 1.5（UX 优化）**：
- 超时从 35s → 20s
- 错误分类（timeout / login_wall / render_error / content_too_short）
- 友好提示（"浏览器打开 → Ctrl+A → 复制 → 粘贴"）
- **前端列表化失败 modal**（替代原 `window.alert`）
- 每个失败 URL 加 [🌐 在浏览器打开] [📋 复制 URL] 按钮

**Phase 2（站点规则升级）**：
- CSDN 用 curl 真实抓的 HTML 重写正则（id="content_views" 是关键容器）
- 知乎/简书/微信用多模式宽松匹配（4 个候选正则按精度顺序尝试）
- URL 收紧匹配（CSDN 必须 `/article/details/`、微信必须有 hash）

### 真实测试结果（2026-05-02）

**Phase 1 测试**：16 URL 中 12 成功（75%）
**Phase 1.5 + 2 重测**：上次失败的 4 个 URL 这次全部成功（4/4 翻盘，含网络运气成分）

### Verify 状态

```
契约组 1：模块加载                    2/2 ✅
契约组 2：站点专属 URL 匹配规则        6/6 ✅
契约组 3：Defuddle 主文提取            3/3 ✅
契约组 4：站点专属规则提取（含真实样本）6/6 ✅
契约组 5：登录墙嗅探                    5/5 ✅
─────────────────────────────────────
总计：22/22 ✅
```

### 引入的硬约束

- **H13：URL 抓取必须走 web-extractor.service.js**（详见 `.claude/hard-constraints.md`）

---

## M0.5 治理升级（2026-05-02）

### 背景

参考"如何避免 Claude Code 的'现场补丁'越堆越乱"信息图，CLAUDE.md 已 772 行接近"垃圾桶化"，需要拆分。

### 完成

- 拆分 CLAUDE.md → `.claude/` 多文件知识库
- H1-H13 加身份证元数据（适用范围 / 引入日期 / 触发原因 / 过期条件）
- 建立 `.claude/notes/` + `.claude/candidates/` + `.claude/phases/`
- 写 `.claude/file-placement-guide.md`（文件归属决策指南）
- 写 git pre-commit hook 自动检查（计划中）

### 引入的新文件归属铁律

详见 `.claude/file-placement-guide.md`：
- 项目根目录只放入口文件
- 临时笔记进 notes/，候选规则进 candidates/
- 阶段总结进 phases/，开发期报告进 reports/
- 老师面向文档进 dist/

---

## M1 待启动（即原 Phase-6 M4 收尾）

详见 `.claude/phases/roadmap.md` 的 M1 节。

主要交付：
- M1.1：「导入现有讲稿」合法入口（CONTRACTS_VS_SKIP 冲突裁决落地）
- M1.2：H1-H8 与 source-registry 联动（platform-safety baseline）
