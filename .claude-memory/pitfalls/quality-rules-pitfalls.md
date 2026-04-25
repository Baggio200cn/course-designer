# quality.js 规则踩坑记录

**文件**：`src/main/v2/quality.js`（371 行）  
**核心职责**：对生成的讲稿做纯函数验证，返回 pass/fail + 具体指标

---

## 当前检查项一览（Phase-4 完成状态）

| 检查函数 | 检查内容 | 失败阈值 |
|---------|---------|---------|
| `headingCount` | Markdown 标题数量 | < 3 |
| `effectiveCharCount` | 有效字符数（去空白） | < 1800 |
| `repeatedGreetingCount` | 寒暄重复次数 | > 1 |
| `teacherNarrationCharCount` | 教师讲述部分字数 | < 2204 |
| `hasLectureStructure` | 是否有开场+模块+总结结构 | false |
| `duplicateActionCount` | 课堂动作重复次数 | > 3 |

---

## Pitfall-1：quality.js 被生成模块直接 require

**当前状态**：`abc-generator.js` 和 `formal-generator.js` 都直接 `require('../v2/quality')`  
**违反原则**：验证层应该独立，不能被生成层依赖（否则生成层可以篡改验证标准）  
**暂不修复**：Phase-4 已稳定，贸然解耦会影响现有调用链  
**Phase-5 P1 目标**：quality.js 只通过 IPC handler 被调用，生成模块不直接 require 它

---

## Pitfall-2：repeatedGreetingCount 的正则覆盖不全

**当前正则**：`/大家好|同学们好|欢迎来到今天的课堂/`  
**已知未覆盖**：
- "亲爱的同学们" （部分教师风格会用）
- "Hello 大家好" （英语专业课可能出现）
**暂不扩展**：目前用户群体（广纺织职业院校）不太使用英文寒暄  
**如需扩展**：直接修改 quality.js 里的正则，不需要其他改动，但要运行 verify-lecture-generation.js

---

## Pitfall-3：effectiveCharCount 和 teacherNarrationCharCount 的关系

`effectiveCharCount` 计算全文字符，`teacherNarrationCharCount` 只计算 `教师讲述` 部分。  
两者不是包含关系：全文可能字数够（因为 PPT 文本/标题太多），但教师讲述字数不够。  
**修改建议**：如果要提升讲稿质量，应该看 `teacherNarrationCharCount`，不是 `effectiveCharCount`。

---

## 不要修改的注意事项

1. **不要给 quality.js 添加 API 调用** — 它必须是纯函数（H3 硬约束）
2. **不要删除已有检查项** — 即使觉得某个检查太严格，先问用户
3. **如果要降低某个阈值** — 说明理由，阈值是从 Phase-4 实测数据来的，不能随意调
