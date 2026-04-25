function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function auditNotebookQuality({ notebook, modules, schedule, framework }) {
  const findings = [];
  let score = 100;

  if (!notebook) {
    return {
      score: 0,
      findings: [{ level: 'error', code: 'NOTEBOOK_MISSING', message: '未找到笔记本数据' }],
      summary: {
        moduleHours: 0,
        scheduleHours: 0,
        targetHours: 0
      }
    };
  }

  const moduleList = Array.isArray(modules) ? modules : [];
  const scheduleList = Array.isArray(schedule) ? schedule : [];

  const moduleHours = moduleList.reduce((sum, item) => sum + asNumber(item.hours), 0);
  const scheduleHours = scheduleList.reduce((sum, item) => sum + asNumber(item.hours), 0);
  const targetHours = asNumber(notebook.totalHours);

  if (moduleList.length === 0) {
    findings.push({ level: 'error', code: 'MODULE_EMPTY', message: '教学模块为空' });
    score -= 25;
  }

  const missingNameModules = moduleList.filter((m) => !(m.name || '').trim());
  if (missingNameModules.length > 0) {
    findings.push({
      level: 'error',
      code: 'MODULE_NAME_MISSING',
      message: `有 ${missingNameModules.length} 个模块缺少名称`
    });
    score -= Math.min(20, missingNameModules.length * 4);
  }

  const missingPointsModules = moduleList.filter(
    (m) => !Array.isArray(m.knowledgePoints) || m.knowledgePoints.length === 0
  );
  if (missingPointsModules.length > 0) {
    findings.push({
      level: 'warning',
      code: 'MODULE_POINTS_MISSING',
      message: `有 ${missingPointsModules.length} 个模块没有知识点`
    });
    score -= Math.min(12, missingPointsModules.length * 2);
  }

  const duplicateModuleNo = new Set();
  const seenModuleNo = new Set();
  moduleList.forEach((m) => {
    const no = asNumber(m.moduleNumber, null);
    if (no === null) return;
    if (seenModuleNo.has(no)) duplicateModuleNo.add(no);
    seenModuleNo.add(no);
  });
  if (duplicateModuleNo.size > 0) {
    findings.push({
      level: 'warning',
      code: 'MODULE_NUMBER_DUPLICATED',
      message: `模块序号重复: ${Array.from(duplicateModuleNo).join(', ')}`
    });
    score -= 8;
  }

  if (scheduleList.length === 0) {
    findings.push({ level: 'warning', code: 'SCHEDULE_EMPTY', message: '教学进度为空' });
    score -= 10;
  }

  const scheduleMissingTopic = scheduleList.filter((s) => !(s.topic || '').trim()).length;
  if (scheduleMissingTopic > 0) {
    findings.push({
      level: 'warning',
      code: 'SCHEDULE_TOPIC_MISSING',
      message: `有 ${scheduleMissingTopic} 条教学进度缺少主题`
    });
    score -= Math.min(10, scheduleMissingTopic * 2);
  }

  if (targetHours > 0) {
    const moduleDiff = Math.abs(moduleHours - targetHours);
    if (moduleDiff > 0.01) {
      findings.push({
        level: moduleDiff > 4 ? 'error' : 'warning',
        code: 'MODULE_HOURS_MISMATCH',
        message: `模块总学时(${moduleHours})与课程总学时(${targetHours})不一致`
      });
      score -= moduleDiff > 4 ? 15 : 8;
    }

    if (scheduleList.length > 0) {
      const scheduleDiff = Math.abs(scheduleHours - targetHours);
      if (scheduleDiff > 0.01) {
        findings.push({
          level: scheduleDiff > 4 ? 'error' : 'warning',
          code: 'SCHEDULE_HOURS_MISMATCH',
          message: `进度总学时(${scheduleHours})与课程总学时(${targetHours})不一致`
        });
        score -= scheduleDiff > 4 ? 15 : 8;
      }
    }
  }

  if (!framework) {
    findings.push({ level: 'warning', code: 'FRAMEWORK_MISSING', message: '尚未生成教学框架' });
    score -= 10;
  } else {
    const content = framework.content || framework;
    if (!Array.isArray(content.modules) || content.modules.length === 0) {
      findings.push({
        level: 'warning',
        code: 'FRAMEWORK_MODULES_EMPTY',
        message: '教学框架中缺少模块结构'
      });
      score -= 8;
    }
    if (!content.objectives) {
      findings.push({
        level: 'warning',
        code: 'FRAMEWORK_OBJECTIVES_MISSING',
        message: '教学框架中缺少教学目标'
      });
      score -= 6;
    }
  }

  score = Math.max(0, Math.round(score));

  return {
    score,
    findings,
    summary: {
      moduleHours,
      scheduleHours,
      targetHours
    }
  };
}

module.exports = {
  auditNotebookQuality
};
