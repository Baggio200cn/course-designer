const fs = require('fs');

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function collectPblScenes(coursePipeline = {}) {
  return toList(coursePipeline.scenes).filter(
    (scene) => String(scene?.type || '').toLowerCase() === 'pbl'
  );
}

function buildPblPackMarkdown({ notebook, coursePipeline }) {
  const pblScenes = collectPblScenes(coursePipeline);
  const lines = [];
  lines.push(`# PBL 项目任务包：${notebook?.name || '未命名课程'}`);
  lines.push('');
  lines.push('> 用于课程实施、精品课程申报与参赛材料附件。');
  lines.push('');

  if (!pblScenes.length) {
    lines.push('## 暂无 PBL 场景');
    lines.push('- 请先在“课程场景编排”中生成 `pbl` 场景。');
    return lines.join('\n');
  }

  pblScenes.forEach((scene, idx) => {
    const cfg = scene?.content?.projectConfig || {};
    const topic = cfg.projectTopic || scene.title || `PBL 项目 ${idx + 1}`;
    const desc = cfg.projectDescription || scene?.content?.summary || '围绕真实任务完成项目交付。';
    const skills = toList(cfg.targetSkills);
    const issueCount = Number(cfg.issueCount) || 3;

    lines.push(`## 项目 ${idx + 1}：${topic}`);
    lines.push('');
    lines.push('### 1) 项目任务书');
    lines.push(`- 项目主题：${topic}`);
    lines.push(`- 项目背景：${desc}`);
    lines.push(`- 目标技能：${skills.length ? skills.join('、') : '方案设计、执行协作、成果表达'}`);
    lines.push(`- 团队规模：建议 3-5 人/组`);
    lines.push(`- 议题数量：${issueCount}`);
    lines.push('');
    lines.push('### 2) 里程碑计划');
    lines.push('- 里程碑 M1（需求与分工）：确认选题、角色分工、时间表');
    lines.push('- 里程碑 M2（方案与制作）：完成方案初稿与核心素材');
    lines.push('- 里程碑 M3（评审与迭代）：基于反馈修改并提交终稿');
    lines.push('- 里程碑 M4（汇报与复盘）：完成展示、答辩和复盘记录');
    lines.push('');
    lines.push('### 3) 评分量规（建议总分 100）');
    lines.push('- 任务理解与目标对齐（20分）');
    lines.push('- 方案质量与专业性（30分）');
    lines.push('- 执行过程与协作效率（20分）');
    lines.push('- 成果展示与表达清晰度（20分）');
    lines.push('- 复盘质量与改进计划（10分）');
    lines.push('');
    lines.push('### 4) 申报亮点建议');
    lines.push('- 强调“真实任务驱动 + 可交付成果”');
    lines.push('- 提供里程碑过程证据（版本记录、评审记录、迭代说明）');
    lines.push('- 结合课堂测验与互动模块形成“教-学-评”闭环');
    lines.push('');
  });

  return lines.join('\n');
}

function exportPblPack({ notebook, coursePipeline, outputPath }) {
  const content = buildPblPackMarkdown({ notebook, coursePipeline });
  fs.writeFileSync(outputPath, content, 'utf8');
  return outputPath;
}

module.exports = {
  exportPblPack,
  buildPblPackMarkdown
};
