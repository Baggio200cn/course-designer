# Phase-9 技术经验沉淀（2026-05-10）

> 跨 1.5 天的高强度迭代后留下的"再次出现就要被 grep 到"的经验

---

## 1. 函数同名多副本的全局搜索习惯

### 现象
`renderHtmlToPngBuffer` 这个函数在以下 3 处独立定义：
- `src/main/index.js:1056`（给老 framework 流程用）
- `src/main/ipc/media.handlers.js:69`（给 v2:generateFrameworkInfographic / v2:generateStageInfographic 用）
- `src/main/ipc/prompt.handlers.js:43`（给 prompt 模板预览用）

### 教训
改其中一份不影响其他副本——生产路径用的常常不是你以为的那份。

### 防御做法
```bash
# 改 fnName 之前先确认有几份
grep -rn "function renderHtmlToPngBuffer\|renderHtmlToPngBuffer = async" src/
```
如果有多份，改一处时**也要把同步策略写进注释**：
```js
/**
 * ⚠ 注意：src/main/index.js 也有同名函数。
 * 修一处必须同步另一处！
 */
```

---

## 2. preload 不会 HMR 重载

### 现象
反复出现"为什么改了代码没生效"——4 次，老师终于开始怀疑我没真改。

### 真相
- **renderer 改动**：vite HMR 自动热更（毫秒级）
- **preload 改动**：必须**完整重启 Electron 窗口 + 终止 dev server + npm run dev**
- **main 进程改动**：同 preload

### 触发判断
看你改的文件：
- `src/renderer/**/*.jsx` → HMR 即可（Ctrl+S 自动）
- `src/preload/index.js` → 完整重启
- `src/main/**/*.js` → 完整重启

### 避免误判
代码里加版本检测打印：
```js
console.log('[preload] loaded version 2026-05-10-1');
```
重启后看到这一行 = preload 真的重载了。

---

## 3. AI endpoint 兼容性 fallback 是必需的

### 现象
doubao `ep-m-20260327105914-k629s`（多模态文本端点）不支持 `response_format: { type: 'json_object' }`，5 次连续 400 错误。

### 修复模式（已写到 ark-course-client.js）
```js
try {
  return await postJson(...);  // 带 response_format
} catch (err) {
  if (err.message.includes('json_object') && err.message.includes('not supported')) {
    delete fallbackBody.response_format;  // 降级
    return await postJson(...);
  }
  throw err;
}
```

### 教训
凡是用 LLM 高级特性（response_format / tool_use / vision）都要带 fallback——不同 endpoint 兼容性不一致。

---

## 4. capturePage 截断 + DPI 缩放陷阱

### 现象
- HTML 真实 1790px 高
- PNG 只输出 1069px

### 根因
- BrowserWindow 默认 height 包含 chrome（标题栏 +30px）
- capturePage() 默认截当前 viewport
- DPI 缩放 1.25x 在 Windows 影响

### 修复（写到 renderHtmlToPngBuffer）
```js
const win = new BrowserWindow({
  useContentSize: true,    // 关键 1：width/height 指内容区
});
// ...
win.setContentSize(realW, realH);  // 关键 2：强制设到真实尺寸
await new Promise(r => setTimeout(r, 500));  // 关键 3：等 reflow
const image = await win.webContents.capturePage({
  x: 0, y: 0, width: realW, height: realH  // 关键 4：显式 rect
});
```

---

## 5. AI prompt 设计——反例清单 > 正面约束

### 失败做法
```
prompt: "请基于真实数据，不要编造销量、点赞数、KOL 数量"
```
AI 仍然编："小红书 12W 赞""GMV 620 万""50 个腰部达人"

### 成功做法（codex review 启发）
```
prompt: "禁止编造以下任何'具体数字'——除非素材里有出处可核验：
  ❌ 销量数据（如'销量 18 万件''GMV 620 万'）
  ❌ 社交平台互动数据（如'小红书 12W 赞''抖音播放量 50 万'）
  ❌ 产品性能数据（如'保暖性提高 40%''重量减轻 1/3'）
  ❌ KOL/达人数量（如'对接 50 个腰部达人''官方发 10 条笔记'）
"
```

AI 看到具体反例后主动避免。**反例越具体，AI 越听话**。

### 同样适用
- "素材必须落地"（说不通） vs "❌ 反例：'结合大英百科里的拉斯韦尔模型'（没说投影哪一页）"

---

## 6. 真实日志诊断 vs 截图猜

### 4 次错误尝试 vs 1 次定位
- PPT 配图重复 bug 我 3 次"看截图猜"走错
- 加 `console.log` 后老师贴出日志 → 1 分钟看到 `GUIZANG_HERO_TYPES.has('模块页') = true` → 立刻定位

### 模式
```js
console.log(`[batch-image] P${page.pageNumber} prompt 含视觉概念引导:`,
  /本页视觉概念引导/.test(normalizedPage.imagePrompt || ''));
```
这种带断言式输出比纯日志更有诊断价值——直接告诉你是 true/false。

---

## 7. 工程级"反潜规则"——读注释要怀疑

### 例子
`stage-helpers.js` 第 514 行注释：
```js
// ⚠️ 故意不传 pageTitle / contentPreview：文字内容不进入图像 prompt
```

注释看起来很合理（防文字烧入图）。但矫枉过正——把页面主题信息也排除了，AI 22 页全画一样的图。

### 教训
- 注释作者的**初衷**和**实际效果**经常不一致
- 看到"故意不做 X" 的注释时，要主动问"X 真的不该做吗？还是该做但要换种方式做？"

---

## 8. H1 例外的代价 + 收益评估框架

### Phase-9 改 contracts.js（H1 例外）
- 收益：6 阶段架构升级（必须做的商业升级）
- 代价：所有 stage 解锁逻辑要重新验证
- 防护：写 `verify-contracts-v6.js` 27/27 全覆盖
- 决策记录：`.claude/notes/2026-05-09-phase9-h1-exception.md`

### 模式
任何 H1-H13 例外申请前必须答 3 个问题：
1. 收益**必须**通过破坏硬约束才能获得吗？
2. 防护是什么？（具体 verify 脚本）
3. 决策记录在哪？（哪个 notes/decisions 文件）

---

## 9. 数据库方法名 fat-finger 检测

### 现象
`db.getArtifactsByNotebook(notebookId)` 这个方法**根本不存在**——我 4 个新 handler 都用了。
有个 `if (db.getArtifactsByNotebook)` 防御性判断，让 bug 静默通过。

### 教训
- 防御性判断（`if (typeof xxx === 'function')`）容易掩盖拼写错误
- 写新 handler 调 db 方法时，**先 grep 确认方法存在**：
```bash
grep -n "listArtifacts\|getArtifactsByNotebook" src/main/database/db-simple.js
```

---

## 10. UI 反馈循环 = 老师能感知到的"状态变化"

### 失败案例
点"生成 A/B/C 候选稿" → 60 秒静默 → 老师以为按钮没响应 → 反复点

### 修复模式
1. 按钮 disabled + 文字变 "⏳ 生成中…"
2. 助手状态条立刻变 "🤖 正在生成（约 30-90 秒）..."
3. 失败 → window.alert 详细原因 + 建议
4. 成功 → 助手状态显示具体结果（"✅ A=1234 字 / B=987 字 / C=654 字"）

老师每一步都能"看到"，不会怀疑系统死了。

---

## 给未来的我（自己）

1. **改 fnName 前 grep 全局** —— 确认副本数
2. **改 preload/main 后必须完整重启** —— 不要相信 HMR
3. **AI endpoint 调用必带 fallback** —— 兼容性不可信
4. **prompt 加反例清单** —— 比正面约束有效 10 倍
5. **第一次失败立刻加 console.log** —— 不要看截图猜
6. **看到"故意不做 X"的注释要怀疑** —— 可能是错的
7. **H1 例外必须有 verify 脚本兜底** —— 不能裸跑
8. **db 方法名先 grep 确认** —— 防止拼错
9. **每个长操作给 UI 反馈** —— 老师不会原谅"60 秒静默"
