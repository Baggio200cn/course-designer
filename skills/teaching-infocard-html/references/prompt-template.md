# 教学信息卡 HTML 生成模板 · v4.1.4 重写（lean）

把下面的课程数据，按 **system 消息**里指定的 layout + visualStyle 渲染成一张 HTML 信息卡。

## ⚠ 关键规则（违反即失败）

1. **结构（区块布局 / 编号样式 / 色带位置 / 整图分段）完全以 system 消息里的 layout spec 为准**
2. **配色、字号、装饰元素以 system 消息里的 visualStyle spec 为准**
3. 下面"课程内容数据"中如果出现 `## ① ② ③` 等小节编号或 `(顶部，h=160)` 等位置标注，**只把它当作内容的语义分组**，不要把它当作"必须做成这样的版面结构"
4. 不允许在你的 HTML 中混入 system spec 之外的"顶部色带" "主标题区" "底部提示条" "圆形图标 40×40" "底色暖白 #FAFAF8" "主色深紫 #4338CA" 等旧设计元素
5. 不允许把整图限死在 1000×1400 —— 各 layout 在 system spec 里有自己的画布要求（杂志模块版可达 1900-2400px 高度）

## 数据

- 课程：{course_name}
- 主题：{topic}
- 软件/工具上下文：{software_context}
- 岗位上下文：{job_context}

## 补充风格提示（弱约束，与 system spec 冲突时以 system 为准）

{style}

## 课程内容数据

{content}

## 输出硬约束

- 只输出完整 HTML（含内联 CSS），不要输出 Markdown 围栏，不要输出解释文字
- 必须是可直接渲染的单文件 HTML
- 不依赖外部字体、外部图片、外部脚本、CDN
- 所有样式写在 \<style\> 或 inline style 中
- 图标用 Unicode emoji 或内联 SVG，不依赖字体图标库
