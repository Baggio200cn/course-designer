function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeModuleHeadingText(text = '') {
  const normalized = cleanText(text)
    .replace(/^[：:]+/, '')
    .replace(/[：:]+$/, '');
  if (!normalized) return '';
  const matched = normalized.match(/^模块\s*(\d+)\s*[：:]?\s*(.*)$/);
  if (!matched) return normalized;
  const number = matched[1];
  const tail = cleanText(matched[2]).replace(/^[：:]+/, '').replace(/[：:]+$/, '');
  return tail ? `模块${number}：${tail}` : `模块${number}`;
}

function normalizeSectionHeading(line = '') {
  const trimmed = cleanText(line).replace(/^[-*]\s*/, '');
  if (!trimmed) return '';
  if (/^##\s+/.test(trimmed)) return trimmed;
  if (/^开场导入(?:[（(].*?[）)])?[：:]?$/.test(trimmed)) {
    return `## ${trimmed.replace(/[：:]$/, '')}`;
  }
  if (/^课堂练习与检查(?:[（(].*?[）)])?[：:]?$/.test(trimmed)) {
    return `## ${trimmed.replace(/[：:]$/, '')}`;
  }
  if (/^总结收束(?:[（(].*?[）)])?[：:]?$/.test(trimmed)) {
    return `## ${trimmed.replace(/[：:]$/, '')}`;
  }
  if (/^模块\s*\d+/.test(trimmed)) {
    return `## ${normalizeModuleHeadingText(trimmed)}`;
  }
  return '';
}

function splitInlineActionText(text = '') {
  const normalized = cleanText(text)
    .replace(/^[-*]\s*/, '')
    .replace(/[；;]+/g, '\n');
  if (!normalized) return [];
  const parts = normalized
    .split(/\n+/)
    .map((item) => cleanText(item).replace(/^[-*]\s*/, ''))
    .filter(Boolean);
  return parts.length ? parts : [normalized];
}

function pushLine(buffer, line) {
  if (!line) return;
  if (buffer[buffer.length - 1] === line) return;
  buffer.push(line);
}

function pushBlank(buffer) {
  if (buffer[buffer.length - 1] !== '') buffer.push('');
}

function normalizeLectureMarkdown(rawText = '', options = {}) {
  const titleOverride = cleanText(options.titleOverride);
  const lines = String(rawText || '').split(/\r?\n/);
  const result = [];
  let mode = '';
  let hasTitle = false;

  const pushNarration = (text) => {
    const line = cleanText(text);
    if (!line) return;
    pushLine(result, line);
  };

  const pushAction = (text) => {
    splitInlineActionText(text).forEach((item) => {
      pushLine(result, `- ${item}`);
    });
  };

  lines.forEach((rawLine) => {
    const trimmed = cleanText(rawLine);
    if (!trimmed) {
      pushBlank(result);
      return;
    }

    const markdownHeading = trimmed.match(/^#{1,2}\s+(.+)$/);
    if (markdownHeading) {
      const headingText = cleanText(markdownHeading[1]);
      if (trimmed.startsWith('# ')) {
        pushLine(result, `# ${titleOverride || headingText}`);
        hasTitle = true;
      } else {
        const normalizedSection = normalizeSectionHeading(`## ${headingText}`) || `## ${headingText}`;
        pushLine(result, normalizedSection);
      }
      mode = '';
      return;
    }

    const legacyTitle = trimmed.match(/^标题[：:]\s*(.+)$/);
    if (legacyTitle) {
      pushLine(result, `# ${titleOverride || cleanText(legacyTitle[1])}`);
      hasTitle = true;
      mode = '';
      return;
    }

    const sectionHeading = normalizeSectionHeading(trimmed);
    if (sectionHeading) {
      pushLine(result, sectionHeading);
      mode = '';
      return;
    }

    const spoken = trimmed.match(/^教师讲述[：:]\s*(.*)$/);
    if (spoken) {
      pushLine(result, '教师讲述：');
      mode = 'spoken';
      if (cleanText(spoken[1])) pushNarration(spoken[1]);
      return;
    }

    const actions = trimmed.match(/^(课堂动作附栏|课堂动作)[：:]\s*(.*)$/);
    if (actions) {
      pushLine(result, '课堂动作附栏：');
      mode = 'action';
      if (cleanText(actions[2])) pushAction(actions[2]);
      return;
    }

    if (mode === 'action') {
      pushAction(trimmed);
      return;
    }

    if (mode === 'spoken') {
      pushNarration(trimmed);
      return;
    }

    pushLine(result, trimmed);
  });

  if (!hasTitle && titleOverride) {
    result.unshift('', `# ${titleOverride}`);
  }

  return result
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  normalizeLectureMarkdown
};
