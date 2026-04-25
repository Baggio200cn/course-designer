const { SCENE_TYPES, validateSceneList } = require('./scene-schema');

function defaultSlideContent(outline) {
  return {
    title: outline.title,
    summary: outline.description || '本页进行知识点讲解。',
    keyPoints: ['概念定义', '关键方法', '课堂应用'],
    visualHint: '信息图 + 对比结构'
  };
}

function defaultQuizContent(outline) {
  const cfg = outline.quizConfig || {};
  return {
    title: outline.title,
    questions: [],
    config: {
      questionCount: Number(cfg.questionCount) || 3,
      difficulty: cfg.difficulty || 'medium',
      questionTypes: Array.isArray(cfg.questionTypes) ? cfg.questionTypes : ['single-choice']
    }
  };
}

function defaultInteractiveContent(outline) {
  const cfg = outline.interactiveConfig || {};
  return {
    title: outline.title,
    html: '',
    config: {
      conceptName: cfg.conceptName || outline.title,
      conceptOverview: cfg.conceptOverview || outline.description || '',
      designIdea: cfg.designIdea || '参数调节 + 图示反馈',
      subject: cfg.subject || '通用课程'
    }
  };
}

function defaultPBLContent(outline) {
  const cfg = outline.pblConfig || {};
  return {
    title: outline.title,
    projectConfig: {
      projectTopic: cfg.projectTopic || outline.title,
      projectDescription: cfg.projectDescription || outline.description || '',
      targetSkills: Array.isArray(cfg.targetSkills) ? cfg.targetSkills : ['方案设计', '执行协作'],
      issueCount: Number(cfg.issueCount) || 3,
      language: cfg.language || outline.language || 'zh-CN'
    }
  };
}

async function generateSingleScene(outline, aiClient = null, logger = console) {
  try {
    if (aiClient && typeof aiClient.generateScene === 'function') {
      const scene = await aiClient.generateScene(outline);
      if (scene && typeof scene === 'object') return scene;
    }
  } catch (error) {
    logger.warn?.(`[scene-generator] ai scene failed for ${outline.id}:`, error.message);
  }

  switch (outline.type) {
    case SCENE_TYPES.QUIZ:
      return {
        id: outline.id,
        type: outline.type,
        title: outline.title,
        moduleRef: outline.moduleRef,
        content: defaultQuizContent(outline),
        actions: [],
        notes: '教师引导学生先独立作答，再进行讲评。'
      };
    case SCENE_TYPES.INTERACTIVE:
      return {
        id: outline.id,
        type: outline.type,
        title: outline.title,
        moduleRef: outline.moduleRef,
        content: defaultInteractiveContent(outline),
        actions: [],
        notes: '先演示交互，再让学生自主探索参数变化。'
      };
    case SCENE_TYPES.PBL:
      return {
        id: outline.id,
        type: outline.type,
        title: outline.title,
        moduleRef: outline.moduleRef,
        content: defaultPBLContent(outline),
        actions: [],
        notes: '强调项目交付标准与分工机制。'
      };
    case SCENE_TYPES.SLIDE:
    default:
      return {
        id: outline.id,
        type: SCENE_TYPES.SLIDE,
        title: outline.title,
        moduleRef: outline.moduleRef,
        content: defaultSlideContent(outline),
        actions: [],
        notes: '本页围绕核心概念建立讲解节奏。'
      };
  }
}

async function generateFullScenes(outlines, options = {}) {
  const {
    aiClient = null,
    logger = console,
    callbacks = {}
  } = options;

  const list = Array.isArray(outlines) ? outlines : [];
  const scenes = [];

  for (let i = 0; i < list.length; i += 1) {
    const outline = list[i];
    const scene = await generateSingleScene(outline, aiClient, logger);
    scenes.push(scene);
    callbacks.onProgress?.({
      current: i + 1,
      total: list.length,
      sceneId: scene.id
    });
  }

  const checked = validateSceneList(scenes);
  return {
    success: checked.valid,
    data: checked.value,
    errors: checked.errors,
    warnings: checked.warnings
  };
}

module.exports = {
  generateSingleScene,
  generateFullScenes
};

