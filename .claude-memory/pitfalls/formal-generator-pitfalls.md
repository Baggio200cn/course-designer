# formal-generator.js 历次踩坑记录

**文件**：`src/main/script/formal-generator.js`（980 行）  
**核心职责**：把 abc-generator 输出的 A/B/C 三稿，合成为最终的"正式讲稿"

---

## Pitfall-1：扩展池浅导致字数不足

**触发条件**：`buildSectionExpansion` 返回的扩展内容不足，`expandLectureNarration` 循环轮数不够  
**症状**：正式稿 teacherNarrationCharCount 在 1421~1711，不达 2204 下限  
**修复**：  
- `buildSectionExpansion` 每 section 扩展句从 2 句改为 4-5 句
- `expandLectureNarration` 循环从 3 轮改为 5 轮  
**验证方法**：`node tests/verify-lecture-generation.js`，看 `teacherNarrationCharCount` ≥ 2204

---

## Pitfall-2：openingRule 泄露进输出

**触发条件**：`openingRule` 变量被拼接进了正文，而不是只用作 system prompt  
**症状**：输出文本开头出现"开场规则："、"讲授规则："等元提示字样  
**修复**：openingRule 只能出现在 `segSystemPrompt` 构建里，不能出现在输出拼接里  
**验证方法**：运行 `e2e-lecture-with-api.js`，检查 `元提示泄露` 项 = 0

---

## Pitfall-3：分段合成的超时风险

**触发条件**：课时 ≥ 2，segmentCount > 1，每段单独调用 API  
**症状**：总生成时间超过 60 秒，前端超时，但 API 实际完成了  
**状态**：未完全解决，Phase-5 需要做超时/重试机制  
**临时缓解**：在 Electron 的 IPC handler 里设置了 120 秒超时，前端有 loading 状态

---

## 关键参数

| 参数 | 当前值 | 说明 |
|------|--------|------|
| temperature | 0.25 | 合成阶段低温保持一致性 |
| maxTokens | 7800 | 合成完整讲稿够用 |
| 字数下限（单课时） | 2204 字 | teacherNarrationCharCount |
| 字数目标（单课时） | 2500+ 字 | 端到端测试实测值 |
