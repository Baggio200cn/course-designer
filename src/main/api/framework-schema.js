function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === '是';
  }
  return Boolean(value);
}

function normalizeIdeologicalElements(value) {
  if (Array.isArray(value)) {
    return {
      craftsmanship: value[0] || '',
      culturalConfidence: value[1] || '',
      other: value.slice(2).join('；')
    };
  }
  if (value && typeof value === 'object') {
    return {
      craftsmanship: value.craftsmanship || value.craftsmanSpirit || '',
      culturalConfidence: value.culturalConfidence || value.culture || '',
      other: value.other || ''
    };
  }
  return {
    craftsmanship: '',
    culturalConfidence: '',
    other: ''
  };
}

function normalizeTeachingMethods(value) {
  if (Array.isArray(value)) {
    return {
      primary: value[0] || '',
      secondary: value.slice(1).map((item) => String(item).trim()).filter(Boolean)
    };
  }
  if (value && typeof value === 'object') {
    const secondary = Array.isArray(value.secondary)
      ? value.secondary
      : toStringArray(value.secondary || '');
    return {
      primary: value.primary || value.main || '',
      secondary
    };
  }
  if (typeof value === 'string') {
    return {
      primary: value,
      secondary: []
    };
  }
  return {
    primary: '',
    secondary: []
  };
}

function normalizeFrameworkContent(content, courseInfo = {}) {
  if (!content || typeof content !== 'object') return content;
  if (content.parsed === false) return content;

  const objectives = content.objectives || {};
  const modulesRaw = Array.isArray(content.modules) ? content.modules : [];

  const modules = modulesRaw.map((module, index) => ({
    number: toNumber(module.number, index + 1),
    name: module.name || `模块${index + 1}`,
    hours: toNumber(module.hours, 0),
    description: module.description || '',
    keyPoints: toStringArray(module.keyPoints || module.knowledgePoints),
    teachingMethods: module.teachingMethods || '',
    isCore: toBoolean(module.isCore ?? module.core)
  }));
  const targetTotalHours = toNumber(content.courseInfo?.totalHours ?? courseInfo.totalHours, 0);
  const currentTotalHours = modules.reduce((sum, item) => sum + toNumber(item.hours, 0), 0);
  if (targetTotalHours > 0 && modules.length > 0 && currentTotalHours > 0) {
    if (modules.length === 1) {
      modules[0].hours = targetTotalHours;
    } else if (Math.abs(currentTotalHours - targetTotalHours) > 1) {
      let assigned = 0;
      for (let i = 0; i < modules.length; i += 1) {
        if (i === modules.length - 1) {
          modules[i].hours = Math.max(1, targetTotalHours - assigned);
        } else {
          const scaled = Math.round((toNumber(modules[i].hours, 0) / currentTotalHours) * targetTotalHours);
          modules[i].hours = Math.max(1, scaled);
          assigned += modules[i].hours;
        }
      }
      const fixedSum = modules.reduce((sum, item) => sum + toNumber(item.hours, 0), 0);
      if (fixedSum !== targetTotalHours) {
        modules[modules.length - 1].hours = Math.max(
          1,
          toNumber(modules[modules.length - 1].hours, 0) + (targetTotalHours - fixedSum)
        );
      }
    }
  }
  return {
    courseInfo: {
      courseName: content.courseInfo?.courseName || courseInfo.name || '',
      courseCode: content.courseInfo?.courseCode || courseInfo.courseCode || '',
      totalHours: toNumber(content.courseInfo?.totalHours ?? courseInfo.totalHours, 0),
      theoryHours: toNumber(content.courseInfo?.theoryHours ?? courseInfo.theoryHours, 0),
      practiceHours: toNumber(content.courseInfo?.practiceHours ?? courseInfo.practiceHours, 0),
      targetGrade: content.courseInfo?.targetGrade || courseInfo.grade || '',
      prerequisite: content.courseInfo?.prerequisite || courseInfo.prerequisite || ''
    },
    objectives: {
      knowledge: toStringArray(objectives.knowledge),
      skills: toStringArray(objectives.skills),
      attitude: toStringArray(objectives.attitude || objectives.values)
    },
    modules,
    ideologicalElements: normalizeIdeologicalElements(content.ideologicalElements),
    teachingMethods: normalizeTeachingMethods(content.teachingMethods)
  };
}

function validateFrameworkContent(content, courseInfo = {}) {
  const errors = [];
  const warnings = [];
  const reviewReasons = [];

  if (!content || typeof content !== 'object') {
    errors.push('框架返回为空或不是对象');
    return { valid: false, errors, warnings, reviewNeeded: false, reviewReasons };
  }

  if (content.parsed === false) {
    errors.push('模型输出不是合法 JSON');
    return { valid: false, errors, warnings, reviewNeeded: false, reviewReasons };
  }

  if (!content.objectives) {
    errors.push('教学目标尚未生成 → 请进入「教学框架」阶段，点击「生成框架」重新生成');
  } else {
    if (!Array.isArray(content.objectives.knowledge) || content.objectives.knowledge.length === 0) {
      errors.push('知识目标缺失 → 请重新生成框架，或在编辑器中补充知识目标');
    }
    if (!Array.isArray(content.objectives.skills) || content.objectives.skills.length === 0) {
      errors.push('技能目标缺失 → 请重新生成框架，或在编辑器中补充技能目标');
    }
    if (!Array.isArray(content.objectives.attitude) || content.objectives.attitude.length === 0) {
      errors.push('情感目标缺失 → 请重新生成框架，或在编辑器中补充情感目标');
    }
  }

  if (!Array.isArray(content.modules) || content.modules.length === 0) {
    errors.push('教学模块尚未生成 → 请进入「教学框架」阶段，点击「生成框架」重新生成');
  } else {
    const invalidModule = content.modules.find((module) => !module.name || toNumber(module.hours, -1) < 0);
    if (invalidModule) {
      errors.push('模块数据不完整（缺少名称或学时）→ 请检查框架 JSON 中的 modules 字段');
    }
    const duplicateNames = content.modules.reduce((acc, module) => {
      const name = String(module?.name || '').trim();
      if (!name) return acc;
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {});
    const repeated = Object.keys(duplicateNames).filter((key) => duplicateNames[key] > 1);
    if (repeated.length) {
      warnings.push(`存在重复模块名称：${repeated.join('、')}`);
      reviewReasons.push('模块名称存在重复，建议人工确认是否需要合并或重排。');
    }
    const sparseModules = content.modules
      .filter((module) => !Array.isArray(module?.keyPoints || module?.knowledgePoints) || !(module?.keyPoints || module?.knowledgePoints).length)
      .map((module) => String(module?.name || '').trim())
      .filter(Boolean);
    if (sparseModules.length) {
      warnings.push(`以下模块缺少知识要点：${sparseModules.join('、')}`);
      reviewReasons.push('部分模块知识要点缺失，框架完整性需要人工补强。');
    }
    const sumHours = content.modules.reduce((sum, module) => sum + toNumber(module.hours, 0), 0);
    const targetHours = toNumber(content.courseInfo?.totalHours ?? courseInfo.totalHours, 0);
    if (targetHours > 0 && Math.abs(sumHours - targetHours) > 2) {
      warnings.push(`模块总学时(${sumHours})与课程总学时(${targetHours})差异较大`);
      reviewReasons.push('模块学时与课程总学时差异较大，建议人工复核教学安排。');
    }
  }

  if (!content.teachingMethods || !content.teachingMethods.primary) {
    warnings.push('教学方法 primary 为空');
    reviewReasons.push('主要教学方法缺失，建议人工补充。');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reviewNeeded: reviewReasons.length > 0,
    reviewReasons
  };
}

function chooseArkModel(courseInfo = {}) {
  const descriptionLength = String(courseInfo.description || '').length;
  const scheduleLength = Array.isArray(courseInfo.teachingSchedule) ? courseInfo.teachingSchedule.length : 0;
  const totalHours = toNumber(courseInfo.totalHours, 0);
  const practiceHours = toNumber(courseInfo.practiceHours, 0);
  const practiceRatio = totalHours > 0 ? practiceHours / totalHours : 0;

  if (descriptionLength > 220 || scheduleLength > 10) return 'deepseek';
  if (practiceRatio >= 0.6) return 'doubao';
  if (descriptionLength > 120) return 'kimi';
  return 'glm';
}

module.exports = {
  normalizeFrameworkContent,
  validateFrameworkContent,
  chooseArkModel
};

