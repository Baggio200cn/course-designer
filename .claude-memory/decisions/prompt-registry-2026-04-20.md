# Prompt Registry 选型决策记录

**日期**：2026-04-20  
**决策者**：Baggio  
**背景**：Prompt 散落在 7 处代码文件中，修改时需要找代码行

## 当前 Prompt 散落位置（需迁移的 6 个）

| 文件 | 变量 | 说明 |
|------|------|------|
| `src/main/script/abc-generator.js` ~808行 | `systemPrompt` | 讲稿三稿生成 |
| `src/main/script/formal-generator.js` ~913行 | `segSystemPrompt` | 正式稿合成 |
| `src/main/api/ark-course-client.js` | framework prompt | 框架生成 |
| `src/main/export/ppt.js` | image prompt | PPT 图片生成 |
| `src/main/services/infographic-card.service.js` | infographic prompt | 信息图生成 |
| `src/main/services/video-generator.service.js` | shot prompt | 视频分镜 |

## 不需要迁移的（它们是规则数据，不是 Prompt）

- `src/main/script/style-rubric.js` — 教师风格控制指令（控制数据，不是 Prompt）
- `src/main/script/course-profile.js` — 专业领域分类（分类数据）
- `src/main/script/framework-directives.js` — 领域关键词（规则数据）

## 确认的最小版本方案

```javascript
// src/main/ipc/prompt-registry.js
const fs = require('fs');
const path = require('path');
const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

module.exports = { loadPrompt };
```

目标文件：
```
prompts/
├── abc-system.md
├── formal-system.md
├── framework-gen.md
├── ppt-image.md
├── infographic.md
└── video-shot.md
```

## 为什么不做全版本（frontmatter + includes + 输出校验）

备选的完整版本需要约 7 天，包含：
- frontmatter 版本号（version, author, updated）
- includes chain（prompt 引用其他 prompt 片段）
- 输出 schema 校验（JSON Schema 验证 AI 返回）

**放弃理由**：
1. 单用户桌面应用，没有多人协作 Prompt 版本冲突的场景
2. Phase-4 端到端已稳定，输出 schema 已通过 verify-v2-response-shape.js 隐式覆盖
3. includes chain 会让 loadPrompt 变成递归解析器，增加不必要的复杂度
4. 最小版本先做，Phase-5 P2 阶段如果真的需要再升级

## P2 阶段升级路径（不是现在做）

如果未来需要升级，在 loadPrompt 里扩展：
1. 解析 frontmatter（`---` 分隔符）提取 version/author
2. 支持 `{{include: xxx.md}}` 语法实现 includes
3. 输出校验结合 quality.js 的 schema 定义
