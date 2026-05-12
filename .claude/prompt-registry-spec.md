# Prompt Registry 规范

## 文件命名规则

所有 Prompt 文件放在 `prompts/` 目录：

```
prompts/
├── abc-system.md          ← abc-generator.js 的 systemPrompt
├── formal-system.md       ← formal-generator.js 的 segSystemPrompt
├── framework-gen.md       ← 框架生成 prompt
├── ppt-image.md           ← PPT 图片生成 prompt
├── infographic.md         ← 信息图 prompt
├── video-shot.md          ← 视频分镜 prompt
└── agent/                 ← Phase-5C 新增（Agent 相关 prompt）
    ├── orchestrator.md    ← Agent 决策循环的 system prompt
    ├── review.md          ← AI 审核 prompt（已在 lecture.handlers 里内联，待迁移）
    └── research.md        ← 课程研究建议 prompt（已在 research.service 里内联，待迁移）
```

## 加载方式（最小版本）

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

## 规则

- **不允许** 在 `loadPrompt` 外引入版本控制、include chain、frontmatter 解析（Phase-5 P2 再做）
- **关联 H5**：不允许在业务代码里写内联字符串 prompt
- **关联 H12**：所有 systemPrompt 必须走 `prompt-assembler.assemble()`，loadPrompt 只是装载，不是直接 systemPrompt

## 正确用法

```javascript
// ✅ 正确：loadPrompt 装载 → 包成 fragment → 走 assembler
const { loadPrompt } = require('../ipc/prompt-registry');
const { assemble } = require('../agent/prompt-assembler');

const productDefault = loadPrompt('abc-system');
const fragments = [
  { type: 'PRODUCT_DEFAULT', content: productDefault, ... },
  { type: 'PROJECT_RULE', content: courseContext, ... },
];
const systemPrompt = assemble(fragments);
```

## 错误用法

```javascript
// ❌ 错误：直接拼字符串
const systemPrompt = loadPrompt('abc-system') + '\n' + courseContext;

// ❌ 错误：在 .js 里写 prompt
const systemPrompt = `你是一名教学专家...`;
```

## 已知待迁移内联 prompt

| 位置 | 内联 prompt 内容 | 迁移目标 |
|-----|----------------|--------|
| `lecture.handlers.js`（review 路径）| AI 审核 prompt | `prompts/agent/review.md` |
| `research.service.js`（building research） | 课程研究建议 prompt | `prompts/agent/research.md` |
