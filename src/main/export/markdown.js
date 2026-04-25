const fs = require('fs');

const toList = (arr) => (Array.isArray(arr) ? arr : []);

function buildFrameworkMarkdown({
  notebook,
  framework,
  modules,
  schedule
}) {
  const content = framework?.content || framework || {};
  const fwModules = toList(content.modules);
  const moduleList = toList(modules);
  const effectiveModules = moduleList.length
    ? moduleList
    : fwModules.map((m, idx) => ({
      moduleNumber: m.number || idx + 1,
      name: m.name || `模块${idx + 1}`,
      hours: Number(m.hours) || 0,
      description: m.description || '',
      knowledgePoints: toList(m.keyPoints || m.knowledgePoints),
      content: {
        structureImagePath: m.structureImagePath || '',
        structureImageUrl: m.structureImageUrl || ''
      }
    }));
  const scheduleList = toList(schedule);
  const lines = [];
  lines.push(`# 课程教学设计：${notebook?.name || '未命名课程'}`);
  lines.push('');
  lines.push(`- 专业代码：${notebook?.courseCode || '-'}`);
  lines.push(`- 总学时：${notebook?.totalHours || 0}`);
  lines.push(`- 理论学时：${notebook?.theoryHours || 0}`);
  lines.push(`- 实践学时：${notebook?.practiceHours || 0}`);
  lines.push(`- 授课对象：${notebook?.grade || '-'}`);
  lines.push(`- 先修课程：${notebook?.prerequisite || '-'}`);
  lines.push('');

  lines.push('## 教学目标');
  const obj = content?.objectives || {};
  lines.push('### 知识目标');
  toList(obj.knowledge).forEach((x) => lines.push(`- ${x}`));
  lines.push('### 技能目标');
  toList(obj.skills).forEach((x) => lines.push(`- ${x}`));
  lines.push('### 情感目标');
  toList(obj.attitude).forEach((x) => lines.push(`- ${x}`));
  lines.push('');

  lines.push('## 教学模块（含信息图）');
  effectiveModules.forEach((m, idx) => {
    lines.push(`### 模块${m.moduleNumber || idx + 1}：${m.name || '未命名'}（${m.hours || 0}学时）`);
    if (m.description) lines.push(m.description);
    toList(m.knowledgePoints).forEach((kp) => lines.push(`- ${kp}`));
    const imgPath = m?.content?.structureImagePath || m.structureImagePath || '';
    const imgUrl = m?.content?.structureImageUrl || m.structureImageUrl || '';
    if (imgPath) lines.push(`![模块信息图](${imgPath.replace(/\\/g, '/')})`);
    else if (imgUrl) lines.push(`![模块信息图](${imgUrl})`);
    lines.push('');
  });

  lines.push('## 教学进度');
  if (!scheduleList.length) {
    lines.push('- 暂无教学进度');
  } else {
    scheduleList.forEach((s, idx) => {
      lines.push(`- 第${s.week || idx + 1}周｜${s.topic || '-'}｜${s.hours || 0}学时｜${s.methods || '-'}`);
    });
  }
  lines.push('');
  return lines.join('\n');
}

function exportFrameworkMarkdown({
  notebook,
  framework,
  modules,
  schedule,
  outputPath
}) {
  const markdown = buildFrameworkMarkdown({ notebook, framework, modules, schedule });
  fs.writeFileSync(outputPath, markdown, 'utf8');
  return outputPath;
}

function exportDiscussionMarkdown({ discussionDraft, structureSlots, outputPath }) {
  const merged = mergeDiscussionWithInfographics(discussionDraft, structureSlots);
  const resolved = resolveDiscussionMarkdown(merged, structureSlots);
  fs.writeFileSync(outputPath, resolved, 'utf8');
  return outputPath;
}

function mergeDiscussionWithInfographics(discussionDraft, structureSlots = []) {
  const draft = String(discussionDraft || '');
  if (!draft.trim()) return draft;

  const hasSlotMarkers = /^!\[(?:结构图|信息图)-[^\]]*\]\(slot:\/\/[^)]+\)$/m.test(draft);
  if (hasSlotMarkers) return draft;

  const availableSlots = toList(structureSlots).filter((slot) => {
    const src = String(slot?.imagePath || slot?.imageUrl || '').trim();
    return Boolean(src) && Number.isFinite(Number(slot?.insertAfterLineIndex));
  });
  if (!availableSlots.length) return draft;

  const slotMap = new Map(
    availableSlots.map((slot) => [Number(slot.insertAfterLineIndex), slot])
  );

  const lines = draft.split(/\r?\n/);
  return lines.flatMap((line, idx) => {
    const cleanedLine = String(line || '').replace('[需结构图]', '').replace('[需信息图]', '').trimEnd();
    const slot = slotMap.get(idx);
    if (!slot) return [cleanedLine];
    const title = String(slot.title || `段落${idx + 1}`).trim();
    return [cleanedLine, `![信息图-${title}](slot://${slot.id})`];
  }).join('\n');
}

function resolveDiscussionMarkdown(discussionDraft, structureSlots = []) {
  const slotsById = new Map(
    toList(structureSlots).map((item) => [String(item.id), item])
  );
  return String(discussionDraft || '').replace(
    /^!\[((?:结构图|信息图)-[^\]]*)\]\(slot:\/\/([^)]+)\)$/gm,
    (full, alt, slotId) => {
      const slot = slotsById.get(String(slotId));
      if (!slot) return full;
      const src = String(slot.imagePath || slot.imageUrl || '').trim();
      if (!src) return full;
      return `![${alt}](${src.replace(/\\/g, '/')})`;
    }
  );
}

module.exports = {
  exportFrameworkMarkdown,
  buildFrameworkMarkdown,
  exportDiscussionMarkdown,
  resolveDiscussionMarkdown,
  mergeDiscussionWithInfographics
};
