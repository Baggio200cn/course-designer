function parseLineKV(line) {
  const match = String(line || '').match(/^[-*]?\s*([^:：]{2,30})\s*[:：]\s*(.+)$/);
  if (!match) return null;
  return { key: match[1].trim(), value: match[2].trim() };
}

function cleanConstraintText(value) {
  return String(value || '')
    .replace(/^(请|请你|希望|要求|建议)(大家|老师|生成时)?/, '')
    .replace(/[。；;]+$/, '')
    .trim();
}

function isControlDirective(value = '') {
  const text = cleanConstraintText(value);
  if (!text) return false;
  return [
    /更强调.+互动/,
    /加强.+互动/,
    /多一些.+互动/,
    /增加.+互动/,
    /更强调课堂/,
    /草稿/,
    /正式稿/,
    /要求栏/,
    /提示词/,
    /测试/,
    /控制/,
    /不要原样/,
    /不要直接写进正文/
  ].some((pattern) => pattern.test(text));
}

function applyControlDirective(value = '', controlHints = {}) {
  const text = cleanConstraintText(value);
  if (!text) return;
  if (/更强调.+互动|加强.+互动|多一些.+互动|增加.+互动|课堂互动/.test(text)) {
    controlHints.interactionEmphasis = true;
  }
  if (/多讨论|加强讨论|增加讨论/.test(text)) {
    controlHints.discussionEmphasis = true;
  }
  if (/多汇报|多表达|多复述|多输出/.test(text)) {
    controlHints.studentOutputEmphasis = true;
  }
}

function isContentDirective(value = '') {
  const text = cleanConstraintText(value);
  if (!text) return false;
  return [
    /^课后作业/,
    /^作业/,
    /^提交物/,
    /^课堂练习/,
    /^课堂活动/,
    /^评价标准/,
    /^补充案例/,
    /^案例补充/,
    /^增加案例/,
    /^新增案例/,
    /课后作业[:：]/,
    /提交物[:：]/,
    /设计一张/,
    /请学生完成/,
    /要求学生完成/
  ].some((pattern) => pattern.test(text));
}

function normalizeTeacherStyleRubric(rawText = '') {
  const text = String(rawText || '').trim();
  const constraints = {
    voice: [],
    pacing: [],
    interaction: [],
    forbidden: [],
    signaturePhrases: [],
    structure: [],
    sentenceRules: [],
    openingRules: [],
    moduleFlow: [],
    closingRules: [],
    contentDirectives: [],
    controlHints: {
      interactionEmphasis: false,
      discussionEmphasis: false,
      studentOutputEmphasis: false
    }
  };
  if (!text) return constraints;

  const lines = text.split(/\r?\n/).map((line) => String(line || '').trim()).filter(Boolean);
  lines.forEach((line) => {
    if (isControlDirective(line)) {
      applyControlDirective(line, constraints.controlHints);
      return;
    }
    const kv = parseLineKV(line);
    if (kv) {
      if (isControlDirective(kv.value) || isControlDirective(kv.key)) {
        applyControlDirective(kv.value || kv.key, constraints.controlHints);
        return;
      }
      const value = cleanConstraintText(kv.value);
      if (!value) return;
      const key = kv.key.toLowerCase();
      if (isContentDirective(`${kv.key}：${value}`) || /作业|提交物|案例|活动|练习|评价/.test(key)) {
        constraints.contentDirectives.push(`${kv.key}：${value}`);
        return;
      }
      if (/禁用|避免|不要/.test(key)) constraints.forbidden.push(value);
      else if (/口头禅|标志语|惯用/.test(key)) constraints.signaturePhrases.push(value);
      else if (/节奏|快慢|停顿/.test(key)) constraints.pacing.push(value);
      else if (/提问|互动|追问/.test(key)) constraints.interaction.push(value);
      else if (/结构|转承|收束/.test(key)) constraints.structure.push(value);
      else if (/断句|句式|句长/.test(key)) constraints.sentenceRules.push(value);
      else if (/开场|导入/.test(key)) constraints.openingRules.push(value);
      else if (/模块|推进|流程/.test(key)) constraints.moduleFlow.push(value);
      else if (/结尾|总结|预告/.test(key)) constraints.closingRules.push(value);
      else if (/口吻|语气|风格/.test(key)) constraints.voice.push(value);
      else constraints.voice.push(value);
      return;
    }

    const normalized = cleanConstraintText(line);
    if (!normalized) return;
    if (isContentDirective(normalized)) {
      constraints.contentDirectives.push(normalized);
      return;
    }
    if (/禁用|避免|不要/.test(line)) constraints.forbidden.push(normalized);
    else if (/提问|互动|追问/.test(line)) constraints.interaction.push(normalized);
    else if (/节奏|停顿/.test(line)) constraints.pacing.push(normalized);
    else if (/断句|句式|句长/.test(line)) constraints.sentenceRules.push(normalized);
    else if (/开场|导入/.test(line)) constraints.openingRules.push(normalized);
    else if (/模块|推进|流程/.test(line)) constraints.moduleFlow.push(normalized);
    else if (/结尾|总结|预告/.test(line)) constraints.closingRules.push(normalized);
    else if (/口头禅|标志语/.test(line)) constraints.signaturePhrases.push(normalized);
    else if (/结构|转承|收束/.test(line)) constraints.structure.push(normalized);
    else constraints.voice.push(normalized);
  });

  return {
    voice: constraints.voice.slice(0, 12),
    pacing: constraints.pacing.slice(0, 10),
    interaction: constraints.interaction.slice(0, 10),
    forbidden: constraints.forbidden.slice(0, 20),
    signaturePhrases: constraints.signaturePhrases.slice(0, 10),
    structure: constraints.structure.slice(0, 10),
    sentenceRules: constraints.sentenceRules.slice(0, 10),
    openingRules: constraints.openingRules.slice(0, 8),
    moduleFlow: constraints.moduleFlow.slice(0, 10),
    closingRules: constraints.closingRules.slice(0, 8),
    contentDirectives: constraints.contentDirectives.slice(0, 20),
    controlHints: constraints.controlHints
  };
}

module.exports = {
  normalizeTeacherStyleRubric
};
