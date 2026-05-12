# ArkCourseClient 关键规范

> **重要：新增任何 AI 调用都必须遵守这里的规范。**
> **触发条件：写到 `aiClient.xxx()` 时立即对照这一份。**

## 标准创建方式

```javascript
// ✅ 正确：创建 AI 客户端的方式
const { resolveProviderConfig } = require('../utils/provider-config');
const { createAiClientByConfig } = require('../api/ai-client-factory');

const providerConfig = resolveProviderConfig(settings);
const aiClient = createAiClientByConfig(providerConfig);
```

## 调用方式（返回字符串，不是对象）

```javascript
// ✅ 正确
const text = await aiClient.chatJson({
  systemPrompt,
  userPrompt,
  temperature,
  maxTokens
});
const parsed = JSON.parse(text);   // 必须手动解析

// ❌ 错误：ArkCourseClient 没有 chat() 方法
await aiClient.chat(...);   // 会抛出 "未提供有效的 AI 客户端" 错误
```

## 守卫条件

```javascript
// ✅ 必须在调用前检查
if (!aiClient || typeof aiClient.chatJson !== 'function') {
  return { success: false, error: '未提供有效的 AI 客户端' };
}
```

## 常见错误总结

| 错误 | 症状 | 修复 |
|-----|------|-----|
| 直接 `new OpenAI(...)` 硬编码 | 多用户配置失效 | 走 `resolveProviderConfig + createAiClientByConfig` |
| 调用 `aiClient.chat()` | 报"未提供有效的 AI 客户端" | 改成 `chatJson()` |
| 期望返回对象 | undefined 错误 | `chatJson()` 返回字符串，需手动 `JSON.parse()` |
| 不传 `systemPrompt` | 用默认 prompt 不可控 | 必须显式传 systemPrompt（H12：必须走 prompt-assembler） |

## 关联约束

- **H12**：所有 systemPrompt 必须走 `prompt-assembler.assemble()`，不允许直接拼字符串
- **H5**：systemPrompt 内容必须放 `prompts/*.md`，通过 `prompt-registry` 加载

## 配套配置文件

老师在 UI「API 配置」面板里填的 4 个端点，对应到代码：

| UI 字段 | 调用位置 | 用途 |
|--------|--------|------|
| API Key | `settings:saveApiKey('ark', xxx)` | 共用钥匙 |
| 文本模型 Endpoint | 默认走 chatJson | 框架 / 讲稿审核 / PPT 规划等 |
| 讲稿模型 Endpoint | formal-generator 显式选 | 正式稿合成（高质量长文）|
| 图片模型 Endpoint | image-generator.service.js | PPT 配图 / 信息图 |
| 视频模型 Endpoint | v2/video.handlers.js | 视频提示词扩写 |
