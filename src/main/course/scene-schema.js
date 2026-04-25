const SCENE_TYPES = Object.freeze({
  SLIDE: 'slide',
  QUIZ: 'quiz',
  INTERACTIVE: 'interactive',
  PBL: 'pbl'
});

const VALID_SCENE_TYPES = new Set(Object.values(SCENE_TYPES));

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str || fallback;
}

function validateSceneOutline(outline, index = 0) {
  const errors = [];
  const warnings = [];
  const item = isPlainObject(outline) ? outline : {};

  const id = normalizeString(item.id, `scene_${index + 1}`);
  const type = normalizeString(item.type, SCENE_TYPES.SLIDE).toLowerCase();
  const title = normalizeString(item.title, `场景 ${index + 1}`);
  const description = normalizeString(item.description, '');
  const durationMin = Math.max(1, toNumber(item.durationMin, 3));

  if (!VALID_SCENE_TYPES.has(type)) {
    errors.push(`scene type invalid: ${type}`);
  }
  if (!title) {
    errors.push('scene title is required');
  }

  if (type === SCENE_TYPES.QUIZ && !isPlainObject(item.quizConfig)) {
    warnings.push(`scene ${id} missing quizConfig`);
  }
  if (type === SCENE_TYPES.INTERACTIVE && !isPlainObject(item.interactiveConfig)) {
    warnings.push(`scene ${id} missing interactiveConfig`);
  }
  if (type === SCENE_TYPES.PBL && !isPlainObject(item.pblConfig)) {
    warnings.push(`scene ${id} missing pblConfig`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    value: {
      id,
      type,
      title,
      description,
      durationMin,
      moduleRef: normalizeString(item.moduleRef, ''),
      language: normalizeString(item.language, 'zh-CN'),
      quizConfig: isPlainObject(item.quizConfig) ? item.quizConfig : undefined,
      interactiveConfig: isPlainObject(item.interactiveConfig) ? item.interactiveConfig : undefined,
      pblConfig: isPlainObject(item.pblConfig) ? item.pblConfig : undefined
    }
  };
}

function validateScene(scene, index = 0) {
  const errors = [];
  const warnings = [];
  const item = isPlainObject(scene) ? scene : {};

  const id = normalizeString(item.id, `scene_${index + 1}`);
  const type = normalizeString(item.type, SCENE_TYPES.SLIDE).toLowerCase();
  const title = normalizeString(item.title, `场景 ${index + 1}`);
  const content = isPlainObject(item.content) ? item.content : {};
  const actions = Array.isArray(item.actions) ? item.actions : [];

  if (!VALID_SCENE_TYPES.has(type)) {
    errors.push(`scene type invalid: ${type}`);
  }
  if (!title) {
    errors.push('scene title is required');
  }
  if (!isPlainObject(content) || Object.keys(content).length === 0) {
    warnings.push(`scene ${id} content is empty`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    value: {
      id,
      type,
      title,
      moduleRef: normalizeString(item.moduleRef, ''),
      content,
      actions,
      notes: normalizeString(item.notes, ''),
      assets: Array.isArray(item.assets) ? item.assets : []
    }
  };
}

function validateSceneOutlineList(outlines) {
  const list = Array.isArray(outlines) ? outlines : [];
  const normalized = [];
  const errors = [];
  const warnings = [];

  list.forEach((item, index) => {
    const result = validateSceneOutline(item, index);
    normalized.push(result.value);
    errors.push(...result.errors.map((message) => `[outline:${index + 1}] ${message}`));
    warnings.push(...result.warnings.map((message) => `[outline:${index + 1}] ${message}`));
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    value: normalized
  };
}

function validateSceneList(scenes) {
  const list = Array.isArray(scenes) ? scenes : [];
  const normalized = [];
  const errors = [];
  const warnings = [];

  list.forEach((item, index) => {
    const result = validateScene(item, index);
    normalized.push(result.value);
    errors.push(...result.errors.map((message) => `[scene:${index + 1}] ${message}`));
    warnings.push(...result.warnings.map((message) => `[scene:${index + 1}] ${message}`));
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    value: normalized
  };
}

module.exports = {
  SCENE_TYPES,
  VALID_SCENE_TYPES,
  validateSceneOutline,
  validateScene,
  validateSceneOutlineList,
  validateSceneList
};

