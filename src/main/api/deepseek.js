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
  return `You are a course design expert. Generate a teaching framework for the course:
- Course name: {courseName}
- Course code: {courseCode}
- Total hours: {totalHours} (theory {theoryHours}, practice {practiceHours})
- Target grade: {grade}
- Prerequisite: {prerequisite}

Return JSON only with:
1) courseInfo
2) objectives (knowledge/skills/attitude)
3) modules (name, hours, key points, core)
4) ideologicalElements
5) teachingMethods`;
}

class DeepseekAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.deepseek.com/v1';
    this.model = 'deepseek-chat';
  }

  async generateFramework(courseInfo) {
    const promptPath = path.join(__dirname, '../../prompts/framework-generation.txt');
    let promptTemplate = '';
    try {
      promptTemplate = fs.readFileSync(promptPath, 'utf8');
    } catch {
      promptTemplate = getDefaultFrameworkPrompt();
    }

    const prompt = fillPromptTemplate(promptTemplate, courseInfo);

    const response = await postJson(`${this.baseURL}/chat/completions`, this.apiKey, {
      model: this.model,
      messages: [
        { role: 'system', content: 'You are a course design expert.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    const generatedText = response.choices?.[0]?.message?.content || '';
    return parseFrameworkText(generatedText);
  }
}

const generateFramework = async (courseInfo, apiKey) => {
  const client = new DeepseekAPI(apiKey);
  return client.generateFramework(courseInfo);
};

module.exports = {
  DeepseekAPI,
  generateFramework
};
