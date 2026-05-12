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

  // ─── Phase-7.7 B12-A + B13（2026-04-29）─────────────────────────
  // 修复"AI 编造的 totalHours 优先于用户输入"导致用户填 2 学时却得到 6.5 学时的灾难级 bug。
  //
  // 旧代码：`content.courseInfo?.totalHours ?? courseInfo.totalHours`
  //   `??` 是 nullish coalescing：AI 输出非 null/undefined 时优先采纳 AI 值，
  //   只有 AI 给 null 时才回 fallback 用户输入。AI 几乎一定输出某个值（自由编造），
  //   结果用户的 totalHours 被永久覆盖。
  //
  // 新策略（B12-A）：用户输入优先，仅当用户填了 0/空时才借 AI 输出做兜底。
  // 兜底（B13）：返回的 framework.courseInfo.totalHours 强制 = 用户输入值（不再透传 AI 编造值）。
  // 半学时支持（B12-B）：Math.max(1, ...) → Math.max(0.5, ...)，让 4 模块 × 0.5 = 2 学时成立。
  const userTotalHours = toNumber(courseInfo.totalHours, 0);
  const aiTotalHours = toNumber(content.courseInfo?.totalHours, 0);
  const targetTotalHours = userTotalHours > 0 ? userTotalHours : aiTotalHours;

  const userTheoryHours = toNumber(courseInfo.theoryHours, 0);
  const userPracticeHours = toNumber(courseInfo.practiceHours, 0);
  // 理论/实践学时同样采用"用户优先"策略
  const finalTheoryHours = userTheoryHours > 0 || userTotalHours > 0
    ? userTheoryHours
    : toNumber(content.courseInfo?.theoryHours, 0);
  const finalPracticeHours = userPracticeHours > 0 || userTotalHours > 0
    ? userPracticeHours
    : toNumber(content.courseInfo?.practiceHours, 0);

  const currentTotalHours = modules.reduce((sum, item) => sum + toNumber(item.hours, 0), 0);
  if (targetTotalHours > 0 && modules.length > 0 && currentTotalHours > 0) {
    if (modules.length === 1) {
      modules[0].hours = targetTotalHours;
    } else if (Math.abs(currentTotalHours - targetTotalHours) > 0.5) {
      // B12-B：放宽到 0.5（半学时）阈值，避免 2 学时 + 4 模块时缩放挂死
      let assigned = 0;
      for (let i = 0; i < modules.length; i += 1) {
        if (i === modules.length - 1) {
          // 最后一个模块用减法兜底（防累积误差）
          modules[i].hours = Math.max(0.5, Math.round((targetTotalHours - assigned) * 2) / 2);
        } else {
          const scaled = Math.round((toNumber(modules[i].hours, 0) / currentTotalHours) * targetTotalHours * 2) / 2;
          modules[i].hours = Math.max(0.5, scaled);
          assigned += modules[i].hours;
        }
      }
      // 修正累加偏差，最终强制 ∑modules.hours = targetTotalHours
      const fixedSum = modules.reduce((sum, item) => sum + toNumber(item.hours, 0), 0);
      if (Math.abs(fixedSum - targetTotalHours) > 0.001) {
        modules[modules.length - 1].hours = Math.max(
          0.5,
          toNumber(modules[modules.length - 1].hours, 0) + (targetTotalHours - fixedSum)
        );
      }
    }
  }
  return {
    courseInfo: {
      courseName: content.courseInfo?.courseName || courseInfo.name || '',
      courseCode: content.courseInfo?.courseCode || courseInfo.courseCode || '',
      // B13：强制使用上面计算好的 targetTotalHours / finalTheoryHours / finalPracticeHours
      // 这样无论 AI 输出什么值，最终 framework 的学时数永远 = 用户输入
      totalHours: targetTotalHours,
      theoryHours: finalTheoryHours,
      practiceHours: finalPracticeHours,
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
    // B12-A：validate 阶段也按"用户输入优先"——若 normalize 已强制覆盖，
    // content.courseInfo.totalHours 就是用户值；仍保留对 courseInfo.totalHours 的 fallback。
    const targetHours = toNumber(courseInfo.totalHours, 0)
      || toNumber(content.courseInfo?.totalHours, 0);
    if (targetHours > 0 && Math.abs(sumHours - targetHours) > Math.max(0.5, targetHours * 0.1)) {
      // 阈值改为 max(0.5, 10%)，对 2 学时课程容忍 0.5 偏差，对 72 学时课程容忍 7.2
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

