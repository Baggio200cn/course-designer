const { SCENE_TYPES, validateSceneOutlineList } = require('./scene-schema');

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCourseModules(courseInfo = {}) {
  return toArray(courseInfo.modules).map((item, index) => ({
    id: item.id || `module_${index + 1}`,
    name: String(item.name || `模块${index + 1}`).trim(),
    hours: Number(item.hours) > 0 ? Number(item.hours) : 2,
    description: String(item.description || '').trim()
  }));
}

function buildFallbackOutlines(requirementsText, courseInfo = {}) {
  const modules = normalizeCourseModules(courseInfo);
  const language = String(courseInfo.language || 'zh-CN');

  if (modules.length === 0) {
    return [
      {
        id: 'scene_1',
        type: SCENE_TYPES.SLIDE,
        title: String(courseInfo.name || '课程导入'),
        description: requirementsText || '课程导入与学习目标说明',
        durationMin: 5,
        moduleRef: '',
        language
      },
      {
        id: 'scene_2',
        type: SCENE_TYPES.QUIZ,
        title: '课堂测验',
        description: '对核心知识点进行检查',
        durationMin: 5,
        moduleRef: '',
        language,
        quizConfig: {
          questionCount: 5,
          difficulty: 'medium',
          questionTypes: ['single-choice', 'short-answer']
        }
      }
    ];
  }

  const outlines = [];
  let sceneIndex = 1;

  modules.forEach((module) => {
    outlines.push({
      id: `scene_${sceneIndex++}`,
      type: SCENE_TYPES.SLIDE,
      title: `${module.name} - 讲解`,
      description: module.description || '模块核心讲解',
      durationMin: Math.max(3, Math.round(module.hours * 0.6)),
      moduleRef: module.id,
      language
    });

    outlines.push({
      id: `scene_${sceneIndex++}`,
      type: SCENE_TYPES.QUIZ,
      title: `${module.name} - 检查`,
      description: '模块知识点理解检查',
      durationMin: Math.max(2, Math.round(module.hours * 0.2)),
      moduleRef: module.id,
      language,
      quizConfig: {
        questionCount: 3,
        difficulty: 'medium',
        questionTypes: ['single-choice', 'true-false']
      }
    });
  });

  outlines.push({
    id: `scene_${sceneIndex++}`,
    type: SCENE_TYPES.INTERACTIVE,
    title: '互动模拟',
    description: '以可视化方式演示关键机制',
    durationMin: 8,
    moduleRef: modules[0].id,
    language,
    interactiveConfig: {
      conceptName: modules[0].name,
      conceptOverview: '通过交互操作理解核心概念',
      designIdea: '使用可调参数与即时反馈图示',
      subject: String(courseInfo.subject || '通用课程')
    }
  });

  outlines.push({
    id: `scene_${sceneIndex}`,
    type: SCENE_TYPES.PBL,
    title: '项目制任务',
    description: '围绕真实问题完成项目产出',
    durationMin: 20,
    moduleRef: modules[modules.length - 1].id,
    language,
    pblConfig: {
      projectTopic: String(courseInfo.name || '课程综合项目'),
      projectDescription: '基于课堂内容完成可验收项目成果',
      targetSkills: ['方案设计', '协作执行', '结果汇报'],
      issueCount: 3,
      language
    }
  });

  return outlines;
}

async function generateSceneOutlinesFromRequirements(params = {}) {
  const {
    requirementsText = '',
    courseInfo = {},
    styleCard = null,
    aiClient = null,
    logger = console
  } = params;

  let rawOutlines = null;

  if (aiClient && typeof aiClient.generateSceneOutlines === 'function') {
    try {
      rawOutlines = await aiClient.generateSceneOutlines({
        requirementsText,
        courseInfo,
        styleCard
      });
    } catch (error) {
      logger.warn?.('[outline-generator] ai outlines failed, fallback enabled:', error.message);
    }
  }

  if (!Array.isArray(rawOutlines) || rawOutlines.length === 0) {
    rawOutlines = buildFallbackOutlines(requirementsText, courseInfo);
  }

  const checked = validateSceneOutlineList(rawOutlines);
  return {
    success: checked.valid,
    data: checked.value,
    errors: checked.errors,
    warnings: checked.warnings
  };
}

module.exports = {
  generateSceneOutlinesFromRequirements,
  buildFallbackOutlines
};

