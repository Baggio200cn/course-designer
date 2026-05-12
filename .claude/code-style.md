# 代码风格约束

## 语言与模块

- **语言**：全项目 JavaScript（CommonJS），不引入 TypeScript
- **模块系统**：`require` / `module.exports`，不混用 ESM
  - **例外**：第三方库是 ESM-only 时（如 `defuddle/node`），用动态 `await import()` 懒加载 + 缓存

## 异步与错误处理

- **异步**：`async/await`，不使用 `.then()` 链，不使用回调嵌套
- **错误处理**：所有 IPC handler 必须有 `try/catch`
  - 错误必须 `return { success: false, error: e.message }`
  - 不 throw 到外层
- **日志**：
  - `console.log` 用于调试可以保留
  - 生产代码不加 `console.error` 静默吞异常
  - 关键路径加结构化前缀如 `[web-extractor]`

## 注释与文档

- **函数注释**：超过 30 行必须有说明注释，说明"做什么" not "怎么做"
- **复杂正则**：必须有示例注释说明匹配什么
- **TODO 注释**：避免 `// TODO`，改在 `.claude/notes/` 写下

## 文件大小

- 单个文件 **不超过 600 行**，超过则拆分
- handler 文件 **不超过 300 行**
- service 文件 **不超过 500 行**

## 命名约定

| 类型 | 约定 | 示例 |
|------|-----|-----|
| 文件名 | kebab-case | `web-extractor.service.js` |
| 函数名 | camelCase | `extractFromUrl()` |
| 常量 | UPPER_SNAKE | `BROWSER_TIMEOUT_MS` |
| 类 / 构造函数 | PascalCase | `BrowserWindow` |
| IPC channel | kebab:colon | `system:fetchUrlContent` |
| Service 文件 | xxx.service.js | `infographic-card.service.js` |
| Handler 文件 | xxx.handlers.js | `lecture.handlers.js` |
| Verify 脚本 | verify-xxx.js | `verify-web-extractor.js` |
| E2E 脚本 | e2e-xxx.js | `e2e-ppt-export.js` |

## 字符串与编码

- **中文标点**：用户面向文本（错误提示、日志中文部分）用中文标点 「」 ：
- **代码字符串**：用单引号 `'...'`，模板字符串用反引号
- **避免**：`String.fromCharCode(0x201C)` 这种隐藏字符（除非验证 snapshot 字节级稳定）
