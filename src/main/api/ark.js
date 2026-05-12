const fs = require('fs');
const path = require('path');
const { postJsonWithRetry } = require('./request-utils');

async function postJson(url, apiKey, body) {
  return postJsonWithRetry(url, apiKey, body, { retries: 2 });
}

function parseFrameworkText(generatedText) {
  let framework;
  try {
    const jsonMatch =
      generatedText.match(/```json\n([\s\S]*?)\n```/) ||
      generatedText.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      framework = JSON.parse(jsonMatch[1]);
    } else {
      framework = JSON.parse(generatedText);
    }
  } catch {
    framework = { rawText: generatedText, parsed: false };
  }
  return framework;
}

function fillPromptTemplate(template, data) {
  let filled = template;
  // 基础字段
  filled = filled.replace(/\{courseName\}/g, data.name || '');
  filled = filled.replace(/\{courseCode\}/g, data.courseCode || '750105');
  filled = filled.replace(/\{totalHours\}/g, data.totalHours || '72');
  filled = filled.replace(/\{theoryHours\}/g, data.theoryHours || '20');
  filled = filled.replace(/\{practiceHours\}/g, data.practiceHours || '52');
  filled = filled.replace(/\{grade\}/g, data.grade || 'Grade 2');
  filled = filled.replace(/\{prerequisite\}/g, data.prerequisite || 'Prerequisite');
  filled = filled.replace(/\{description\}/g, data.description || '');
  filled = filled.replace(
    /\{teachingSchedule\}/g,
    data.teachingSchedule ? JSON.stringify(data.teachingSchedule) : ''
  );
  // 富上下文字段（Phase-5B）
  filled = filled.replace(/\{softwareTools\}/g, data.softwareTools || '');
  filled = filled.replace(/\{jobTargets\}/g, data.jobTargets || '');
  filled = filled.replace(/\{industryScenarios\}/g, data.industryScenarios || '');
  filled = filled.replace(/\{learnerProfile\}/g, data.learnerProfile || '');
  filled = filled.replace(/\{teachingMaterials\}/g, data.teachingMaterials || '');
  return filled;
}

function getDefaultFrameworkPrompt() {
  // Phase-7.7 B12-C（2026-04-29）：强化 framework prompt，命令性约束 totalHours。
  // 之前的英文极简版让 AI 自由编 totalHours / module.hours，导致用户填 2 学时却得到 6.5 学时。
  // 加：① 中文规则（更强的语境约束）② 命令式语言（CRITICAL/必须/禁止）③ 模块加总=总学时的硬约束
  //     ④ 模块数量与学时的合理对应规则。
  return `你是一名职业教育课程设计专家，为以下课程生成教学框架（输出为 JSON）：

【课程基本信息（必须严格遵守）】
- 课程名称：{courseName}
- 课程代码：{courseCode}
- **总学时：{totalHours}（理论 {theoryHours}，实践 {practiceHours}）**
- 授课对象：{grade}
- 先修课程：{prerequisite}

⚠️ **关键硬约束（违反则输出无效）：**
1. **modules 数组里所有 module.hours 加总必须严格等于 {totalHours}**，不得多出半学时也不得少。
2. **每个 module.hours 最少 0.5 学时**（允许半学时模块）。
3. **module 数量必须与 {totalHours} 合理对应**：
   - {totalHours} ≤ 2 学时：1-2 个模块
   - 2 < {totalHours} ≤ 8：2-4 个模块
   - 8 < {totalHours} ≤ 32：4-6 个模块
   - {totalHours} > 32：6-8 个模块
4. courseInfo.totalHours **必须等于 {totalHours}**，不得自由编造（如 6.5 等不在用户输入里的值）。
5. 禁止把模块加总当 totalHours 写回（旧 bug）；总学时永远以用户输入为准。

【输出 JSON 结构】
{
  "courseInfo": { "courseName", "courseCode", "totalHours", "theoryHours", "practiceHours", "targetGrade", "prerequisite" },
  "objectives": { "knowledge": [...], "skills": [...], "attitude": [...] },
  "modules": [{ "number", "name", "hours", "description", "keyPoints": [...], "isCore": true }],
  "ideologicalElements": [...],
  "teachingMethods": { "primary", "secondary": [...] }
}

只返回纯 JSON 对象，不要 markdown 代码块包裹，不要解释文字。`;
}

class ArkAPI {
  constructor(apiKey, endpointId) {
    this.apiKey = apiKey;
    this.endpointId = endpointId;
    this.baseURL = 'https://ark.cn-beijing.volces.com/api/v3';
  }

  async generateFramework(courseInfo) {
    if (!this.endpointId) {
      throw new Error('Endpoint ID is required for Ark standard inference');
    }

    const promptPath = path.join(__dirname, '../../prompts/framework-generation.txt');
    let promptTemplate = '';
    try {
      promptTemplate = fs.readFileSync(promptPath, 'utf8');
    } catch {
      promptTemplate = getDefaultFrameworkPrompt();
    }

    const prompt = fillPromptTemplate(promptTemplate, courseInfo);

    const response = await postJson(`${this.baseURL}/chat/completions`, this.apiKey, {
      model: this.endpointId,
      messages: [
        { role: 'system', content: 'You are a course design expert.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 2500
    });

    const generatedText = response.choices?.[0]?.message?.content || '';
    return parseFrameworkText(generatedText);
  }
}

const generateFramework = async (courseInfo, apiKey, endpointId) => {
  const client = new ArkAPI(apiKey, endpointId);
  return client.generateFramework(courseInfo);
};

module.exports = {
  ArkAPI,
  generateFramework
};
