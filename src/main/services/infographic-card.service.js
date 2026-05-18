const fs = require('fs');
const path = require('path');
const { postJsonWithRetry } = require('../api/request-utils');

async function postJson(url, apiKey, body) {
  return postJsonWithRetry(url, apiKey, body, { retries: 2 });
}

// ── 信息图布局规格（baoyu-infographic 思路） ────────────────────────────────

const LAYOUT_SPECS = {
  // 2026-05-16 v4.1.4 方案 B：精选 4 layout，强化骨架辨识度
  //   grid_cards / mindmap（新）/ magazine_module / design_overview
  //   旧 layouts（linear_flow/hub_spoke/comparison/timeline）保留 spec 兼容老 artifact，
  //   但 getLayouts() 不再返回它们 → UI 下拉看不到，新生成不会用
  grid_cards: {
    label: '网格卡片',
    spec: `**网格卡片骨架**——参考"品牌溯源 Agent 架构路线图"的深色技术卡片密度感

画布固定宽度 1000px，高度自适应（1200-1700px）。**结构骨架（必须严格）**：

1. **HERO 横条**（h=120）—— 左侧大字（28-32px）课程/模块名 + 副标题（14px），右侧右上角徽标（14px 大写英文 + 版本号 v1.0 风格）
2. **TODAY'S RECOMMENDATIONS 章节标题**（h=36）—— 14px 灰色 / 全大写英文 + 中文小字
3. **主体 2×N 网格**（card grid，每行 2-3 张卡）：
   - 每张卡左上角彩色大字字母编号（A/B/C/D/E，48px 单色，每张不同色）
   - 卡片标题（18px 加粗）紧跟字母右侧
   - 卡片内容：3-5 条彩色圆点 bullet，每条 \`code-style\` 单词 + 中文一句说明（13px）
   - **不同卡片使用不同主题色**（蓝/绿/橙/紫/红/青）—— 字母颜色 + bullet 点颜色一致
4. **TODAY'S EXECUTION PRIORITIES 横条**（h=24）—— 灰色全大写英文
5. **底部 3 张数字优先级卡**（h=120） —— 左侧 01/02/03 极大数字（48px 浅色描边），右侧标题 + 摘要

**视觉签名（缺一不可）**：
- 字母 A-E 大写编号是这个骨架的灵魂，不允许用数字 1/2/3 代替
- 每张卡必须有独立主题色（不允许统一灰色）
- bullet 点用彩色实心圆（直径 6px）+ \`等宽字体片段\`（如 \`agent-config.yaml\`）

**fewshot 结构骨架（请严格遵循这套 HTML 框架）**：
\`\`\`html
<div class="hero">
  <h1 style="font-size:30px">课程名 Agent</h1>
  <p style="color:#94A3B8">— 副标题</p>
  <span style="position:absolute;top:24px;right:24px;color:#94A3B8;font-size:11px">HARNESS ENGINEERING / v1.0</span>
</div>
<div class="section-label">ARCHITECTURE RECOMMENDATIONS</div>
<div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:16px">
  <div class="card" style="border-left:4px solid #3B82F6">
    <span class="letter" style="font-size:48px;color:#3B82F6;font-weight:700">A</span>
    <h3 style="font-size:18px;display:inline-block;margin-left:12px">统一控制平面配置</h3>
    <ul>
      <li><span class="dot" style="background:#3B82F6"></span><code>agent-config.yaml</code> 集中管理所有约束参数</li>
      <li>...</li>
    </ul>
  </div>
  <!-- 重复 B/C/D/E 卡片，每个换不同主题色 -->
</div>
\`\`\``
  },
  linear_flow: {
    label: '线性流程',
    spec: '知识点按教学步骤竖向流程排列，每步之间用箭头连接，左侧为步骤编号圆形徽标，右侧为标题和说明。强调操作顺序和先后关系，适合操作步骤、工艺流程类内容。'
  },
  hub_spoke: {
    label: '中心辐射',
    spec: '中央大圆显示模块主题，周围辐射出各知识点子卡片，用连线相连。视觉上强调"从核心到细节"的展开关系。适合概念解释、技能拆解类内容。'
  },
  comparison: {
    label: '对比分析',
    spec: '两列对比布局，左列和右列各一组内容（如传统vs现代、优点vs注意事项）。顶部跨列大标题，中间竖线分隔两列，适合比较、辩证分析类内容。'
  },
  timeline: {
    label: '时间轴',
    spec: '中央竖线时间轴，知识点节点交替显示在左右两侧，圆点标记节点位置。适合历史演变、发展阶段、学习路径类内容。'
  },
  // 2026-05-16 v4.1.4 方案 B 新增：真正的多层放射树（中心 → 一级分支 → 二级子节点）
  // 2026-05-16 第二轮加固：要求绝对定位坐标系 + 精确锚点对齐 + 中心节点 auto-height
  mindmap: {
    label: '思维导图',
    selfContained: true,
    spec: `**思维导图骨架**——多层放射树结构（中心 → 一级分支 → 二级子节点）

⚠️ **必须用「绝对定位坐标系 + SVG 同坐标系」**，不允许用 flex/grid 让浏览器自己决定位置，否则连线必定漂浮。

---

## 画布与坐标系（必须严格）

\`\`\`
画布：1400px × 1220px（一级间距加大，避免子节点串列）
container: position:relative; width:1400; height:1220; background:#FFFFFF

所有盒子用 absolute 定位，左上角 (x, y) 已知
SVG 用同一个 1400×1220 viewBox 叠在最底层（z-index:0），盒子叠在上面（z-index:2）
\`\`\`

---

## 中心节点（必须严格）

\`\`\`html
<div style="position:absolute; left:60px; top:490px;
            min-width:280px; max-width:320px;
            min-height:160px; height:auto;
            padding:20px 24px;
            border-radius:18px;
            background:linear-gradient(135deg,#1E3A8A 0%,#3B82F6 100%);
            color:#fff;
            z-index:2;
            overflow:visible;">      <!-- ⚠ 不允许 overflow:hidden -->
  <div style="font-size:14px; opacity:.85">🎯 第 N 节</div>
  <div style="font-size:22px; font-weight:800; line-height:1.3; margin-top:6px">本节主标题</div>
  <div style="font-size:12px; opacity:.8; margin-top:8px; line-height:1.5">章节信息 · 学时信息（允许 2 行）</div>
</div>
\`\`\`

**右侧出线锚点**：中心节点右边缘中点 = (60 + 280, 490 + 80) = **(340, 570)** ← 后面 SVG 起点必须用这个坐标

---

## 一级分支（6 条，垂直排开）

固定 y 坐标分布在 1220px 画布上，**每条间距 180px**（加大间距，避免子节点串列）：

| # | 颜色（实色 + hex） | y 中心点 | 一级盒子位置（盒 160×56） |
|---|---|---|---|
| 1 | 蓝 #3B82F6 | 120 | left:780, top:92  |
| 2 | 绿 #10B981 | 300 | left:780, top:272 |
| 3 | 橙 #F59E0B | 480 | left:780, top:452 |
| 4 | 紫 #8B5CF6 | 660 | left:780, top:632 |
| 5 | 红 #EF4444 | 840 | left:780, top:812 |
| 6 | 青 #06B6D4 | 1020| left:780, top:992 |

一级盒子模板：
\`\`\`html
<div style="position:absolute; left:780px; top:{Y-28}px;
            width:160px; height:56px;
            display:flex; align-items:center; justify-content:center;
            border-radius:14px;
            background:{COLOR}; color:#fff;
            font-size:16px; font-weight:700;
            box-shadow:0 4px 12px rgba(0,0,0,.12);
            z-index:2;">分支名</div>
\`\`\`

**左边缘锚点**（SVG 终点）：(780, Y) ← 即盒子左边中点

---

## 二级子节点（每个一级带 2-3 个，**严格上限 3，不允许 4**）

固定 x 坐标 = 990，y 坐标按一级 y ± 偏移，**幅度收紧到 ±50，确保相邻一级的子节点不串列**：

\`\`\`
若一级 y = Y，子节点数 n = 3 → y_child = Y - 50, Y, Y + 50
若 n = 2 → y_child = Y - 28, Y + 28
若 n = 1 → y_child = Y
\`\`\`

**相邻一级子节点的空间隔离验证**：
- 一级 K 的 Y, 子节点最低 = Y + 50 + 22 = Y + 72（盒底）
- 一级 K+1 的 Y+180, 子节点最高 = Y+180 - 50 - 22 = Y + 108（盒顶）
- 间隔 = 108 - 72 = **36px**（绝不允许子节点跨过中间这条无人区）

---

## 🔒 每一级分支的「内容范围」铁律（v4.1.4 第三轮加固）

**绝对禁止「内容串列」**——每个一级分支只能放属于自己语义范围的子节点。

按 6 条一级分支的 fixed 主题映射，每条只能取以下内容：

| 一级 | 子节点必须来自 | 反例（绝对禁止串过来） |
|---|---|---|
| ① 教学目标（蓝 Y=120） | teachingObjectives.knowledge / skill / emotion 三类目标各 1 条 | ❌ 出现"案例教学法""5 段法""作业 15%"等 |
| ② 教学重难点（绿 Y=300） | keyPoints[0] 当"重点"，difficulties[0] 当"难点" | ❌ 出现"小组讨论""课前预习""思政元素" |
| ③ 教学方法（橙 Y=480） | teachingMethods[].name + 一句话适用 | ❌ 出现"启·导入""课前预习""职业认同感" |
| ④ 教学流程（紫 Y=660） | inClass.phases[] 5 段法（导/讲/实/查/总）合并成 2-3 段汇总（如"启·导入"+"授·讲授"合一节，时长求和） | ❌ 出现"案例教学法""课后作业 15%" |
| ⑤ 考核方式（红 Y=840） | assessment.components[] 每项 name + weight% | ❌ 出现"启·导入""职业认同感""树立工匠精神" |
| ⑥ 思政元素（青 Y=1020） | ideologicalElements[] 每条，前缀加 "职业认同/技能成才/职业规划" 等分类前缀 | ❌ 出现"案例""5 段法""课后作业" |

**视觉串列的另一面是语义串列**——如果不严格按上面表分配内容，无论坐标多精确都会让老师误以为"教学方法里怎么出现了流程？"

子节点盒子（盒 200×44）：
\`\`\`html
<div style="position:absolute; left:990px; top:{Y_child-22}px;
            width:200px; height:auto; min-height:44px;
            padding:8px 12px;
            display:flex; align-items:center;
            border-radius:10px;
            background:{COLOR_10ALPHA}; color:#1E293B;
            border:1px solid {COLOR};
            font-size:12px; line-height:1.4;
            z-index:2; overflow:visible;">子节点文本（≤ 18 字）</div>
\`\`\`

其中 \`{COLOR_10ALPHA}\` = 主色 10% 透明（如 \`rgba(59,130,246,.12)\`）

**左边缘锚点**（SVG 二级终点）：(990, Y_child + 22) ← 即盒子左边中点（top + height/2）

---

## SVG 连线（z-index:0，最底层）

\`\`\`html
<svg viewBox="0 0 1400 1220" width="1400" height="1220"
     style="position:absolute; left:0; top:0; z-index:0">
  <!-- 一级主干：从中心节点右边中点 (340, 570) 出发，到对应一级盒子左边中点 -->
  <!-- 三次贝塞尔曲线，控制点 cp1=(560, 570)，cp2=(640, Y)，让曲线从水平慢慢拐到一级 y -->
  <path d="M 340 570 C 560 570, 640 120, 780 120"
        stroke="#3B82F6" stroke-width="3" fill="none" />
  <path d="M 340 570 C 560 570, 640 300, 780 300"
        stroke="#10B981" stroke-width="3" fill="none" />
  <path d="M 340 570 C 560 570, 640 480, 780 480"
        stroke="#F59E0B" stroke-width="3" fill="none" />
  <path d="M 340 570 C 560 570, 640 660, 780 660"
        stroke="#8B5CF6" stroke-width="3" fill="none" />
  <path d="M 340 570 C 560 570, 640 840, 780 840"
        stroke="#EF4444" stroke-width="3" fill="none" />
  <path d="M 340 570 C 560 570, 640 1020, 780 1020"
        stroke="#06B6D4" stroke-width="3" fill="none" />

  <!-- 二级子干：从一级右边中点 (940, Y) 出发，到二级盒子左边中点 (990, Y_child) -->
  <!-- 短曲线，cp=(965, (Y+Y_child)/2) -->
  <!-- 示例：教学目标 Y=120，n=3 子节点 y=70/120/170 -->
  <path d="M 940 120 C 965 95, 980 70, 990 70"
        stroke="#3B82F6" stroke-width="1.6" fill="none" opacity=".7" />
  <path d="M 940 120 L 990 120"
        stroke="#3B82F6" stroke-width="1.6" fill="none" opacity=".7" />
  <path d="M 940 120 C 965 145, 980 170, 990 170"
        stroke="#3B82F6" stroke-width="1.6" fill="none" opacity=".7" />
  <!-- ... 每个一级带 2-3 条，颜色与一级主色一致 -->
</svg>
\`\`\`

---

## 视觉签名（缺一不可）

- ✅ 所有曲线起点、终点必须落在盒子边缘中点（坐标算清楚，不能漂浮）
- ✅ 6 条主干 6 种不同色，二级用主色淡化（不允许同色调）
- ✅ 中心节点 \`overflow:visible\` + \`height:auto\`，副标题允许 2 行不被裁
- ✅ 一级盒子和二级盒子的 x 坐标固定（左对齐 col1=780 / col2=990），不允许参差不齐
- ✅ 整体呈"中心向右展开 6 条主干"的视觉动势
- ✅ 每个一级最多 3 个二级子节点（hard cap），子节点必须严格属于该一级的内容范围
- ✅ 一级 Y 间距 180px，子节点 ±50 内分布，相邻一级子节点间至少 36px 空白带

---

## 反例（绝对禁止）

- ❌ 中心节点用 \`width: 240px; overflow: hidden\` → 副标题被裁
- ❌ SVG path 起点 \`M 320 480\` 但中心节点实际边缘在 (340, 570) → 线条漂浮
- ❌ 用 \`<line>\` 直线连接 → 失去思维导图的曲线美感
- ❌ 一级 / 二级 x 坐标各不相同（780 / 800 / 810 混用） → 视觉杂乱
- ❌ 二级子节点和一级盒子高度重叠 → 排版炸裂
- ❌ 做成 flex / grid 让浏览器决定位置 → 线条永远漂浮，本骨架的灵魂在"坐标精确一致"
- ❌ **教学方法 列出现「启·导入」「课前预习」**（这是教学流程/考核方式的内容）→ 内容串列
- ❌ **教学流程 列出现「课前预习」「作业 15%」**（这是考核方式的内容）→ 内容串列
- ❌ **考核方式 列出现「职业认同感」「工匠精神」**（这是思政元素的内容）→ 内容串列
- ❌ **某一级分支带 4 个或以上子节点** → 必定挤压相邻分支的视觉空间，hard cap 是 3
- ❌ 一级子节点最低 y 超过 (Y + 72) 或一级子节点最高 y 低于 (Y - 72) → 跨界进无人区`
  },
  // Phase-8.5：单模块杂志风格——参考用户提供的"如何避免现场补丁"信息图
  // 2026-05-16 v4.1.4 第三轮重写：彻底拉开与 design_overview 的差异，向真实杂志/插画感靠拢
  //   关键差别：插画吉祥物 + 编号叙事卡（1-6）+ 落地清单 + 目标横幅，去掉"banner 区块"的学术感
  magazine_module: {
    label: '杂志信息图（模块版）',
    selfContained: true,
    spec: `**杂志信息图风格——单节课杂志页**（严格对标"如何避免 Claude Code 的'现场补丁'越堆越乱"那张图的视觉气质）

⚠️ 关键差异：这张图必须看起来像「真实杂志页 / 插画式信息图」，**不能像 PPT 学术 banner**。
⚠️ 如果做出来跟 \`design_overview\`（整门课逻辑闭环）的"彩色头部 + 内容区块"风格一样，就是失败。

---

## 灵魂特征（缺一不可）

1. **HERO 区必须有人格化插画 / 吉祥物**：左上角 SVG 圆形头像或机器人 emoji（🤖 / 👨‍🏫 / 🎓 等），不能只有纯文字 HERO
2. **6 段 narrative 卡片，每张都有大号编号 1./2./3./4./5./6.**：编号在卡片左上角，深蓝色，48-56px 加粗，不是放在彩色 banner 里
3. **卡片内每条 bullet 必须有色彩图标块**：图标在 24×24 圆角矩形里，每条 bullet 一个不同颜色的图标，不允许纯文本 bullet
4. **核心原则横幅**（介于 HERO 和卡片之间）：深蓝色横幅 + 🛡 徽章图标 + 一句话本节灵魂（不是淡黄底）
5. **落地执行清单（CTA 行）**：靠近底部，1 行 5 个有色圆形数字 + 短行动短语
6. **底部最终目标横幅**：深蓝（不是红色）+ 🎯 + 大字"学完后能..."，必须能被一眼读完

---

## 画布与坐标系

\`\`\`
固定宽度 1200px，高度自适应 1900-2400px
背景：白 #FFFFFF
卡片间距 20px
卡片圆角 16px（杂志柔和感，比 design_overview 的 14px 略大）
\`\`\`

---

## 结构（从上到下严格）

### ① HERO（h=240）—— 必须有"人格化"
- 渐变深蓝背景 \`linear-gradient(135deg,#1E3A8A 0%,#3B82F6 100%)\` + 白色文字
- 左侧 80×80 圆形（白底浅蓝）+ 🤖 或 👨‍🏫 emoji 60px
- 主标题：本节主题（36-42px / 800）
- 副标题：14px 半透明白
- 右上角小卡片夹堆装饰（4-5 个倾斜小方块，opacity 0.3-0.6，模拟"文件夹堆"或"卡片堆"的感觉，参考"现场补丁"图右上角的文件夹群）
- **禁止**右侧放 3 个数字徽章（那是 design_overview 的设计）

### ② 核心原则横幅（h=64）—— 深蓝 + 徽章
- 背景：深蓝 #1E3A8A
- 左侧白圆 36×36 + 🛡 emoji
- 文字：「核心原则：本节的【关键定位】」一句话，18px / 700 / 白色
- **禁止**淡黄底（那是旧 magazine_module 的 CORE 横条）

### ③ 主体 6 张 narrative 卡（2×3 网格）

每张卡片宽度 580px，高度 auto（最小 220），白底 + #E5E7EB 1px 边框 + 16px 圆角 + 浅阴影。

\`\`\`html
<div class="narrative-card">
  <div class="card-head" style="display:flex; align-items:baseline; gap:12px; margin-bottom:14px">
    <span class="big-num" style="font-size:32px; font-weight:800; color:#1E3A8A">1.</span>
    <h3 style="font-size:20px; font-weight:700; color:#0F172A">本节学习目标</h3>
  </div>
  <ul class="bullets" style="list-style:none; padding:0; display:flex; flex-direction:column; gap:10px">
    <li style="display:flex; gap:10px; align-items:flex-start">
      <span class="icon-tile" style="flex-shrink:0; width:26px; height:26px; border-radius:6px; background:#3B82F6; color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px">📘</span>
      <span style="font-size:13px; line-height:1.55; color:#334155">知识目标 1（≤ 40 字）</span>
    </li>
    <!-- 重复 3-5 条 bullet，每条 icon-tile 用不同颜色（蓝/绿/橙/紫/红/青） -->
  </ul>
</div>
\`\`\`

**6 张卡的固定主题**（按数据映射）：
1. **本节学习目标**（知识 / 技能 / 素养 各一条，3-5 条 bullet，icon 用 📘 🛠 💡）
2. **本节重难点**（重点 + 难点，3-5 条 bullet，icon 用 ⭐ ⚠ 🎯）
3. **教学方法卡**（3-4 个方法 + 一句说明，icon 用 🗣 📊 🔬 👥）
4. **5 段法节奏**（导入 / 讲授 / 实操 / 互查 / 总结 + 时长，icon 用数字徽章 1-5）
5. **考核维度 + 权重**（3-4 条，每条带百分比 chip 在右侧，icon 用 🎓 📊 🏆）
6. **思政元素**（2-4 条，icon 用 🇨🇳 💎 ✨）

**强制规范**：
- 每张卡左上角必须有 \`32px 加粗 #1E3A8A\` 的大号 \`1./2./3./4./5./6.\` 编号
- 标题不允许写在彩色 banner 里——必须是黑字直接接编号右侧（这是叙事卡视觉的灵魂）
- 每条 bullet 的 \`icon-tile\` 必须 26×26 圆角矩形 + 实色填充 + emoji，**禁止用纯圆点或 SVG line icon**
- 同卡片内 6 个 icon 颜色全部用不同色调（蓝/绿/橙/紫/红/青轮换）

### ④ 落地执行清单（h=180，CTA 行）—— 整张图的"行动召唤"
\`\`\`html
<div style="background:linear-gradient(135deg,#3B82F6 0%,#1E3A8A 100%); color:#fff; padding:32px 40px; border-radius:16px; display:flex; align-items:center; gap:32px">
  <div style="flex-shrink:0; width:110px; height:110px; background:rgba(255,255,255,.18); border-radius:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:800; line-height:1.2; text-align:center">
    <div style="font-size:13px; opacity:.9">落地</div>
    <div style="font-size:22px">执行清单</div>
  </div>
  <div style="flex:1; display:flex; gap:24px">
    <!-- 5 个圆形数字 + 短句 -->
    <div style="text-align:center"><div style="width:44px;height:44px;border-radius:50%;background:#FBBF24;color:#0F172A;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;margin:0 auto 6px">1</div><div style="font-size:13px">导入新课<br/>10 分钟</div></div>
    <div style="text-align:center"><div style="background:#FB923C">2</div><div>知识讲授<br/>30 分钟</div></div>
    <div style="text-align:center"><div style="background:#22C55E">3</div><div>实操练习<br/>25 分钟</div></div>
    <div style="text-align:center"><div style="background:#3B82F6">4</div><div>互查反馈<br/>15 分钟</div></div>
    <div style="text-align:center"><div style="background:#A855F7">5</div><div>总结升华<br/>5 分钟</div></div>
  </div>
</div>
\`\`\`

### ⑤ 最终目标横幅（h=140）—— 必须是深蓝 + 大字
- 深蓝渐变 \`#1E3A8A → #2563EB\` 背景
- 🎯 emoji（60px）+ 「学完后能…」一句话（28-32px / 800 / 白色）
- 副行：12px 浅白色"对接岗位：XXX"
- **禁止**红色背景（那是旧的 GOAL 红横幅，对标错风格）

---

## 视觉签名（缺一不可）

- ✅ HERO 必须含人格化插画 / emoji 头像（🤖 / 👨‍🏫 等）
- ✅ 6 张卡必须用「左上大号编号 + 黑字标题」叙事范式
- ✅ 每条 bullet 必须有 26×26 实色圆角图标块
- ✅ 落地清单是渐变蓝横幅（不是淡灰底 5 圆环）
- ✅ 最终目标横幅是深蓝（不是红）

---

## 反例（绝对禁止——出现一项视为失败）

- ❌ 卡片标题写在彩色 banner 内（如蓝头/绿头/橙头）—— 那是 design_overview 的事，这里要直接黑字
- ❌ 用 2×2 主体网格 + 4 大区块（旧 magazine_module 的设计已废弃）
- ❌ GOAL 横幅用红色 #DC2626 —— 必须深蓝
- ❌ CORE 横条用淡黄 #FEF3C7 —— 必须深蓝 + 🛡 徽章
- ❌ 卡片 bullet 用 \`•\` 实心点或 \`<li>\` 默认样式 —— 必须 26×26 emoji 图标块
- ❌ HERO 只有纯文字没有人格化元素
- ❌ 整图低于 1900px（杂志感来自高密度信息，太短=没料）`
  },
  // Phase-9 C-2（v2 重写）：整门课教学设计的「内在逻辑闭环」版面
  // 灵感来源：参考"如何避免现场补丁"信息图——每块承担一个【逻辑角色】，块之间有箭头/递进/呼应
  // 不是简单的内容罗列，而是表达教学设计的内在逻辑链
  design_overview: {
    label: '教学设计逻辑闭环（整门课版）',
    selfContained: true,
    spec: `**整门课教学设计「逻辑闭环」信息图**

⚠️ 绝对禁止：
- 出现"模块 N""模块 M01"等模块编号字样
- 把这张图做成"教学设计文档各章节的图形目录"——那毫无附加价值
- 6 个区块做成 2×3 网格（这是简单罗列，没体现逻辑）

✅ 必须做的：
- 6 个区块呈现【教学设计的内在逻辑链】，每块承担一个【逻辑角色】
- 区块之间必须有视觉性的逻辑流动（箭头 / 递进色阶 / 上下呼应）
- 起点（学情诊断）和出口（能力达成）形成首尾呼应
- 看完这张图，老师/听众能秒懂"这门课的内在教学逻辑"

---

## 画布与整体结构

画布固定宽度 1200px，**高度严格 ≤ 1900px**（含 padding，超过会被截断）。
顶部 HERO 标题区，下方按"自上而下逻辑流"6 段排列，最后 GOAL 价值主张横幅收尾。

---

## 6 段逻辑闭环（每段是一个「逻辑功能」，不是「内容章节」）

### ① HERO 价值主张（h=200）—— 抛出价值钩子
深蓝渐变 #1B2E6B → #3B82F6
- 左侧：48px 加粗课程名（白色 800）+ 14px 副标题"整门课教学设计 · 逻辑闭环图"
- 右侧 4 个数字徽章（直径 86px 白圆 + 深蓝数字）：
  - 总学时 / 教学目标条数 / 教学方法数 / 考核项数
- 顶部右上角 12px 小字："学完后能…"（钩子，呼应底部 GOAL）

### ② 学情起点 · 问题诊断（h=180，灰底 #F1F5F9）—— 入口
左侧大字"⚠ 学情起点"+ 右侧两栏：
- 左栏"学生现在的水平"：从课程上下文/学情说明提炼 2-3 句
- 右栏"教学难点"：每条 ⚠ 前缀
**视觉语言**：底部一根灰→深蓝的箭头/导引线，明示"从这里开始"，指向下方 ③

### ③ 教学目标 · 三阶递进（h=300）—— **递进！不是并列**
**关键差异：必须用箭头连接的「知识 → 技能 → 素养」三段，体现认知发展递进**
- 整体一条横向流程，3 段卡片之间用粗箭头 → 连接（不是 3 张并列卡片）
- 左 📚 知识目标（蓝 #1E40AF 头）："学到什么"
- 中 🛠 技能目标（绿 #15803D 头）："能做什么"  ← 注意是从知识到能做
- 右 💡 素养目标（橙 #B45309 头）："养成什么品格"  ← 从能做到品格
- 三段背景色阶递进：浅蓝 → 浅绿 → 浅橙
- 顶部一句导语："认知-能力-品格 三阶递进"

### ④ 学习路径 · 时间流程（h=320）—— **横向流程图，不是表格**
"课前 → 课中（5 段法横向流程）→ 课后"完整学习路径
- 左侧"课前"圆环（黄 #FBBF24，r=44）：列 2-3 项预习任务
- 中间 5 圆环连成横向链条（带 → 箭头）：
  - 导入新课（黄 #FBBF24）→ 知识讲授（橙 #FB923C）→ 实操练习（绿 #22C55E）→ 互查反馈（蓝 #3B82F6）→ 总结升华（紫 #A855F7）
  - 每圆 r=36，圆内白色数字 1-5
  - 圆下方：环节名 + 时长（如"导入 10min"）
- 右侧"课后"圆环（深紫 #6B21A8）：列作业 / 反馈机制
- 流程下方一行教学方法标签 chip（彩色椭圆 + 方法名）—— 不是单独区块，是悬挂在流程上的工具集

### ⑤ 评价闭环 · 100% 全维度（h=240）—— 强调闭环
- 左侧 4 项考核权重彩色饼图（直径 200，4 色 #0EA5E9 / #22C55E / #F97316 / #A855F7）
- 中央大字"= 100%"（48px 加粗）
- 右侧 4 行权重列表 + 一句话："4 项权重 = 100% 全维度评估"
- 区块底部一句小字："过程性评价为主，终结性评价为辅"

### ⑥ 思政升华 · 价值附加（h=140）—— **附加而非并列**
红底 #DC2626 横幅
- 左大字"🌟 思政元素 +"（强调"+"附加值的语义）
- 右侧横排思政元素徽章（每个椭圆白边 + 白色字）

### 底部 GOAL 横幅（h=120）—— **能力达成出口，呼应起点**
深蓝底 #1B2E6B
- 大字 🎯"学完后能 …"
- 一行字："对接岗位：[jobTargets]，能完成：[课程描述凝练 1 句]"
- **与 ② 学情起点上下呼应**——起点是"学生现在不会 X"，出口是"学完能做 X"

---

## 8 条强制视觉约束（违反任意一条都算未完成）

1. **必须出现 4 处箭头**：② 起点 ↓ ③ 目标 / ③ 目标内部 → / ④ 路径内部 → / ⑤→⑥→ GOAL
2. **目标三阶必须用箭头连接**：知识 → 技能 → 素养（不允许做成 3 张并列卡片）
3. **5 段法必须横向流程链**（不允许表格、不允许 2×3 网格）
4. **首尾呼应**：HERO 抛出"学完后能…"+ 底部 GOAL 回答完整能力出口（用相同/相似句式）
5. **思政元素用"+"号视觉**（强调附加价值，不是另一类内容）
6. **总高度 ≤ 1900px**——AI 必须算好每段高度，不允许超
7. **背景统一**：白底 #FFFFFF / 浅灰底 #F8FAFC，区块边框 1px #E2E8F0，圆角 14px
8. **配色限定**：仅使用 spec 指定的 8-10 种颜色，不允许引入额外色彩

`
  },
};

const STYLE_SPECS = {
  professional: {
    label: '专业正式',
    spec: `**专业正式皮肤**：

颜色体系：
- 主色 深海军蓝 #1B2E6B
- 强调色 蓝 #3B82F6 / 青 #06B6D4 / 绿 #10B981 / 橙 #F59E0B / 紫 #8B5CF6 / 红 #EF4444（每张卡用不同色，不允许统一灰）
- 卡片背景 #FFFFFF，区块底 #F8FAFC / #F1F5F9，文字 #0F172A / 副字 #475569

字体：
- 主标题 28-32px / 800
- 卡片标题 18px / 700
- 正文 13-14px / 400
- 装饰编号字母 / 数字 48-72px / 800 + 单色

视觉签名（缺一不可）：
- 每张卡有独立主题色描边或左侧色条（4px 实色）
- 卡片右上角 / 左上角有装饰性"标签 chip"（如 12px 大写英文 + 小圆点）
- 顶部右上角必须有"项目签名"小字（如 "PROJECT NAME / v1.0"）

反例（绝对禁止）：
- ❌ 全部灰色 / 全部蓝色（失去专业层级感）
- ❌ 所有文字同一字号（专业感来自字号对比）
- ❌ 圆角 ≥ 16px（太可爱，专业感会丢）—— 圆角统一 8-12px`
  },
  magazine: {
    label: '杂志感',
    spec: `**杂志感皮肤**：

颜色体系（高饱和、多色块）：
- 每区块独立主题色头部（实色 banner h=48-56）
- 蓝 #1E40AF / 绿 #15803D / 橙 #B45309 / 紫 #6B21A8 / 红 #DC2626
- 强调色横条 淡黄 #FEF3C7 / 红 #DC2626
- 卡片白 #FFFFFF + 阴影（dy=3, blur=6, opacity=0.1）

字体：
- 主标题 36-48px / 800
- 数字徽章 36-48px / 800
- 区块标题（彩色 banner 内）17-18px / 700 / 白色
- 正文 13-14px / 400

视觉签名（缺一不可）：
- HERO 必须深色渐变（不允许纯白 HERO）
- 至少 4 种不同主题色出现在不同区块（高饱和）
- 必须有"圆形数字徽章"或"emoji 圆环"
- 区块圆角 14px（杂志柔和感）

反例（绝对禁止）：
- ❌ 全白 / 极简（这是 professional 的事）
- ❌ 所有区块同一色头部
- ❌ 圆角 ≤ 6px（杂志感会丢）`
  },
  minimalist: {
    label: '极简清爽',
    spec: '纯白背景，超细边框（#E5E7EB），大量留白，内容高度聚焦。主色 #18181B，强调色 #6366F1（靛紫），字体对比鲜明。去除一切装饰性元素。'
  },
  tech_blueprint: {
    label: '技术蓝图',
    spec: '深蓝背景（#0F172A），青色（#06B6D4）文字和边框线，模拟工程制图/电路图风格，角落有刻度标尺装饰。适合电子技术、机械制造、自动化等理工类课程。'
  },
  warm_education: {
    label: '温暖教育',
    spec: '米白背景（#FFFBF0），暖橙主色（#F59E0B），圆润大字体，插图感强。亲切活泼，降低视觉压力。适合低年级、素养教育、服务类专业课程。'
  },
  // Phase-8.5：杂志信息图风格（与 LAYOUT_SPECS.magazine_module 配套使用）
  magazine_module: {
    label: '杂志信息图',
    spec: `**杂志风格视觉规范**：

颜色体系（每区块不同主题色）：
- HERO banner：深蓝渐变 #1E3A8A → #3B82F6
- 区块 ① 蓝 #1E40AF（知识点）
- 区块 ② 绿 #15803D（教学方法）
- 区块 ③ 橙 #B45309（学情对接）
- 区块 ④ 紫 #6B21A8（评价标准）
- CORE 横条：淡黄 #FEF3C7 + 边 #F59E0B
- CHECKLIST 横条：淡灰 #F8FAFC + 5 步圆环 黄/橙/绿/蓝/紫
- GOAL 横幅：红 #DC2626

字体：
- HERO 主标题：38px / 800 / 白色
- HERO 数字徽章：48px / 800 / 白色
- 区块标题（彩色 banner 内）：17px / 700 / 白色
- 区块正文：12-13px / normal / #475569
- CORE 文字：14px / 700 / #92400E
- GOAL 主文：22px / 800 / 白色

视觉装饰：
- 每区块顶部 60px 高的彩色 banner + 一个白色圆形数字徽章（直径 40px）
- HERO 右侧 2-3 个浅白色装饰圆（opacity 0.06-0.08）
- 卡片用 cardShadow filter（dy=3, blur=6, 蓝阴影 opacity=0.10）
- 圆角统一 14px（区块）/ 10px（小卡）/ 22px（行动清单圆）

绝不允许：
- 单调灰白配色
- 所有区块同一个颜色
- 文字密集到看不清的"代码块"`
  },
  // Phase-9 C-2 增补：与 LAYOUT_SPECS.design_overview 配套
  design_overview: {
    label: '教学设计概览（专业杂志感）',
    spec: `**整门课教学设计专用视觉风格**：

颜色体系：
- HERO banner：深蓝渐变 #1B2E6B → #3B82F6
- 教学目标三类区块：蓝 #1E40AF（知识）/ 绿 #15803D（技能）/ 橙 #B45309（素养）
- 重难点：红头 #DC2626；教学方法：紫头 #6B21A8
- 5 段法圆环（按顺序）：导入 #FBBF24 / 讲授 #FB923C / 实操 #22C55E / 互查 #3B82F6 / 总结 #A855F7
- CORE 横条：淡黄 #FEF3C7 + 边 #F59E0B
- GOAL 思政横幅：红 #DC2626 底 + 白色字
- 考核饼图：4 色（#0EA5E9 / #22C55E / #F97316 / #A855F7）

字体：
- 课程名（HERO 主标题）：48px / 800 / 白色
- HERO 数字徽章：38px / 800 / 深蓝
- 区块标题（彩色 banner 内）：18px / 700 / 白色
- 区块正文：13-14px / normal / #475569
- CORE 文字：15px / 700 / #92400E
- 5 段法环节名：14px / 600
- 思政元素：14px / 600 / 白色

视觉装饰：
- 每区块顶部 56px 彩色 banner + 圆形 emoji 徽章（直径 38px）
- HERO 右侧 4 个数字徽章（直径 90px 白圆，深蓝数字）
- 卡片 cardShadow filter（dy=3, blur=6, 蓝阴影 opacity=0.10）
- 圆角 14px（区块）/ 10px（小卡）/ 圆形（5 段法圆环 r=32）
- 5 段法时长比例条 h=12 圆角 6px

绝不允许：
- 灰白配色
- HERO 写"模块 N"（这是整门课不是单模块）
- 文字密集到看不清`
  }
};

function sanitizeFileName(value) {
  return String(value || 'infocard')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function extractHtmlCode(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const fenced = raw.match(/```html\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
  const html = fenced ? fenced[1].trim() : raw;
  if (!/<html[\s>]|<!doctype html/i.test(html)) {
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  }
  return html;
}

function replaceVars(input, params) {
  return String(input || '').replace(/\{(\w+)\}/g, (_, key) => {
    const value = params && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : '';
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  });
}

class InfographicCardService {
  constructor(db, appRef) {
    this.db = db;
    this.app = appRef;
    this.arkBaseURL = 'https://ark.cn-beijing.volces.com/api/v3';
    this.deepseekBaseURL = 'https://api.deepseek.com/v1';
  }

  getSkillRoot() {
    return path.join(process.cwd(), 'skills', 'teaching-infocard-html');
  }

  getTemplatePath() {
    return path.join(this.getSkillRoot(), 'references', 'prompt-template.md');
  }

  getDefaultTemplate() {
    // 2026-05-16 v4.1.4 第四轮：彻底拆除 user prompt 里的"OLD 设计硬编码"
    //   原因：旧版 user prompt 写死了"顶部色带 60px / 主标题 120px / 配色 #F8F9FF / 卡片图标 40×40"
    //   这些"圣旨级"硬编码会覆盖 system prompt 里的 layout spec，AI 总是回到 OLD 范式。
    //   现在 user prompt 只供应「数据」，不供应「结构 / 配色 / 字号」——结构完全由 system prompt 的 layout spec 决定。
    return [
      '把下面的课程数据，按 system 消息里指定的 layout + visualStyle 渲染成一张 HTML 信息卡。',
      '',
      '⚠ 关键规则：',
      '1. 结构（区块布局 / 编号样式 / 色带位置 / 整图分段）**完全以 system 消息里的 layout spec 为准**',
      '2. 配色、字号、装饰元素以 system 消息里的 visualStyle spec 为准',
      '3. 下面"课程内容数据"中如果出现 `## ① ② ③` 等小节编号或 `(顶部，h=160)` 等位置标注，**只把它当作内容的语义分组**，不要把它当作"必须做成这样的版面结构"',
      '4. 不允许在你的 HTML 中混入 system spec 之外的 "顶部色带" "主标题区" "底部提示条" "圆形图标 40×40" 等旧设计元素',
      '5. 只输出完整 HTML（含内联 CSS），不输出解释，不输出 Markdown 代码块',
      '',
      '===== 课程上下文 =====',
      '课程名称：{course_name}',
      '主题：{topic}',
      '{software_context}',
      '{job_context}',
      '',
      '===== 补充风格提示（弱约束，与 system spec 冲突时以 system 为准）=====',
      '{style}',
      '',
      '===== 课程内容数据 =====',
      '{content}'
    ].join('\n');
  }

  getPromptTemplate() {
    const templatePath = this.getTemplatePath();
    if (fs.existsSync(templatePath)) {
      return fs.readFileSync(templatePath, 'utf8');
    }
    return this.getDefaultTemplate();
  }

  savePromptTemplate(template) {
    const templatePath = this.getTemplatePath();
    fs.mkdirSync(path.dirname(templatePath), { recursive: true });
    fs.writeFileSync(templatePath, String(template || '').trim(), 'utf8');
    return {
      template: this.getPromptTemplate(),
      path: templatePath
    };
  }

  renderPrompt(params) {
    return replaceVars(this.getPromptTemplate(), params);
  }

  /**
   * 构建增强版 Prompt，支持 layout 和 style 参数注入（baoyu-infographic 思路）
   * @param {Object} params - 基础参数（course_name, topic, content, style 等）
   * @param {string} [params.layout]      - 布局类型 key（默认 grid_cards）
   * @param {string} [params.visualStyle] - 视觉风格 key（默认 professional）
   */
  buildEnhancedPrompt(params) {
    const layoutKey = params.layout || 'grid_cards';
    const styleKey = params.visualStyle || 'professional';
    const layoutSpec = LAYOUT_SPECS[layoutKey] || LAYOUT_SPECS.grid_cards;
    const styleSpec = STYLE_SPECS[styleKey] || STYLE_SPECS.professional;

    // 将布局和风格规格注入到 style 变量中，扩充原有 prompt
    const enhancedParams = {
      ...params,
      style: [
        params.style || '',
        `\n===== 布局规范 =====\n布局类型：${layoutSpec.label}\n${layoutSpec.spec}`,
        `\n===== 视觉风格 =====\n风格：${styleSpec.label}\n${styleSpec.spec}`
      ].filter(Boolean).join('\n')
    };

    return this.renderPrompt(enhancedParams);
  }

  /** 获取可用布局列表
   *  2026-05-16 v4.1.4 方案 B：UI 只暴露 4 个 layout（精选 + 强辨识度）
   *  其它 LAYOUT_SPECS 条目（linear_flow/hub_spoke/comparison/timeline）保留供老 artifact 渲染兼容
   */
  static getLayouts() {
    const VISIBLE_LAYOUTS = ['grid_cards', 'mindmap', 'magazine_module', 'design_overview'];
    return VISIBLE_LAYOUTS
      .filter((key) => LAYOUT_SPECS[key])
      .map((key) => ({ key, label: LAYOUT_SPECS[key].label }));
  }

  /** 获取可用风格列表
   *  2026-05-16 v4.1.4 方案 B：UI 只暴露 2 个 style
   *  - professional 专业正式（适合 grid_cards / mindmap）
   *  - magazine     杂志感（适合 magazine_module / design_overview）
   */
  static getStyles() {
    const VISIBLE_STYLES = ['professional', 'magazine'];
    return VISIBLE_STYLES
      .filter((key) => STYLE_SPECS[key])
      .map((key) => ({ key, label: STYLE_SPECS[key].label }));
  }

  /**
   * 根据 layout 和 visualStyle 动态构建 system prompt
   * 替代旧的硬编码固定规则，确保布局/风格参数真正生效
   */
  buildSystemPrompt(layout = 'grid_cards', visualStyle = 'professional') {
    const layoutSpec = LAYOUT_SPECS[layout] || LAYOUT_SPECS.grid_cards;
    const styleSpec = STYLE_SPECS[visualStyle] || STYLE_SPECS.professional;
    // Phase-9 C-2：selfContained layout 自带完整 spec，跳过通用强制规范
    // 避免通用规范里的"右侧模块编号 / 主标题摘要"等硬编码污染整门课版面
    const isSelfContained = Boolean(layoutSpec.selfContained);

    const lines = [
      '你是专业的教育信息可视化设计师，专为中职院校制作教学展示卡片。',
      '产出可直接截图导出为 PNG 的单页 HTML 信息卡（含内联 CSS），只输出 HTML 代码，不加任何解释或 Markdown 代码块。',
      '',
      '===== 必须严格执行的布局方式 =====',
      `布局：${layoutSpec.label}`,
      layoutSpec.spec,
      '',
      '===== 必须严格执行的视觉风格 =====',
      `风格：${styleSpec.label}`,
      styleSpec.spec,
    ];

    // 2026-05-16 v4.1.4 方案 B：通用强制规范不再硬塞"顶部色带 + 主标题 + 底部提示条"骨架
    //   原因：那套骨架把 5 个 layout 压平成一个样，layout 选择失去意义。
    //   每个 layout 的 spec 已经独立定义自己的骨架（包含 fewshot HTML 框架），AI 严格遵循即可。
    lines.push('');
    lines.push('===== 全局约束（其余以上方布局/风格 spec 为准）=====');
    lines.push('- 字体：system-ui, "Microsoft YaHei", sans-serif，禁止引用外部字体');
    lines.push('- 禁止引用外部图片链接，图标用 Unicode 符号或内联 SVG');
    lines.push('- 不输出解释文字，不输出 Markdown 代码块，只输出完整 HTML 代码');
    lines.push('- 严格按上方布局规范的「fewshot 结构骨架」与「视觉签名」执行，不允许融合其它 layout 的骨架');
    lines.push('- 如果上方 spec 含 fewshot HTML 框架，请用真实数据填充该框架，不要重新设计一套结构');
    lines.push('- "视觉签名（缺一不可）"清单中的每一条都必须在最终输出里能看见，否则视为生成失败');
    lines.push('- "反例（绝对禁止）"清单中的项目，最终输出里一个都不能出现');
    lines.push('');
    lines.push('===== 🛡 用户消息中的"位置提示"必须忽略 =====');
    lines.push('user 消息里的「课程内容数据」段可能含有 `## ① ② ③` 小节编号或 `(顶部，h=160)` `(右上，蓝头 #1E40AF)` 等位置/配色标注——');
    lines.push('这些是历史遗留的内容分组标记，**不是版面指令**。');
    lines.push('请把它们仅当作数据的语义分组（哪些字段属于"教学目标"、哪些属于"考核"），位置/配色一律以本 system 消息里的 layout spec 为准。');
    lines.push('特别地：');
    lines.push('- ❌ 看到 `(顶部，h=160)` 不允许做"顶部色带 + 模块编号"那套旧设计');
    lines.push('- ❌ 看到 `(蓝头/绿头/橙头/紫头)` 不允许做"彩色 banner 头部 + 2×2 网格"那套旧设计');
    lines.push('- ❌ 看到 `(淡黄底 #FEF3C7)` 不允许做"CORE 淡黄横条"——按本 spec 的色彩用');
    lines.push('- ❌ 看到 `(红底 #DC2626)` 的 GOAL 不允许做红色横幅——按本 spec 决定颜色');

    return lines.join('\n');
  }

  async generateHtml({ provider = 'ark', endpointId, promptFinal, layout = 'grid_cards', visualStyle = 'professional' }) {
    const prompt = String(promptFinal || '').trim();
    if (!prompt) {
      throw new Error('信息卡 Prompt 不能为空');
    }

    // 动态构建 system prompt，确保布局/风格优先级最高
    const systemContent = this.buildSystemPrompt(layout, visualStyle);

    if (provider === 'ark') {
      const apiKey = this.db.getApiKey('ark');
      const targetEndpoint =
        endpointId ||
        this.db.getApiKey('ark_endpoint_text') ||
        this.db.getApiKey('ark_endpoint') ||
        this.db.getApiKey('ark_endpoint_text_deepseek');
      if (!apiKey || !targetEndpoint) {
        throw new Error('请先配置 Ark 文本模型 Endpoint');
      }
      const response = await postJson(`${this.arkBaseURL}/chat/completions`, apiKey, {
        model: targetEndpoint,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: prompt }
        ],
        // 2026-05-16 v4.1.4 方案 B：把 0.4 提到 0.65，让 AI 在 spec 约束下做风格化探索
        //   不同 layout × style 之间才会拉开差异；过低温度会让 AI 回退到"安全的专业正式"范式
        temperature: 0.65,
        // Phase-9 C-2 修正：4000 不够装一个完整的 6 段逻辑闭环 HTML
        // 实测 AI 生成到第 3 段被截断（PNG 只有 1069px 高）
        max_tokens: 12000
      });
      const content = response.choices?.[0]?.message?.content || '';
      return extractHtmlCode(content);
    }

    const apiKey = this.db.getApiKey('deepseek');
    if (!apiKey) {
      throw new Error('请先配置 Deepseek API Key');
    }
    const response = await postJson(`${this.deepseekBaseURL}/chat/completions`, apiKey, {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      max_tokens: 12000
    });
    const content = response.choices?.[0]?.message?.content || '';
    return extractHtmlCode(content);
  }

  saveArtifacts({ html, pngBuffer, title, notebookId }) {
    const outputDir = path.join(this.app.getPath('userData'), 'generated-infocards');
    fs.mkdirSync(outputDir, { recursive: true });
    const stamp = Date.now();
    const base = sanitizeFileName(`${title || 'infocard'}-${stamp}`);
    const htmlPath = path.join(outputDir, `${base}.html`);
    const imagePath = path.join(outputDir, `${base}.png`);
    fs.writeFileSync(htmlPath, html, 'utf8');
    fs.writeFileSync(imagePath, pngBuffer);

    const resource = this.db.createResource({
      notebookId: notebookId || null,
      originalName: path.basename(imagePath),
      name: path.basename(imagePath),
      sourcePath: htmlPath,
      storagePath: imagePath,
      type: 'image',
      size: pngBuffer.length,
      tags: ['AI生成', 'html-infocard', 'structured'],
      stage: 'framework',
      category: '信息图',
      usage: 'framework-infographic'
    });

    return {
      htmlPath,
      imagePath,
      resourceId: resource.id
    };
  }
}

module.exports = {
  InfographicCardService
};
