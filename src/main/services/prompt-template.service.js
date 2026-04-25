function replaceVars(input, params) {
  return String(input || '').replace(/\{(\w+)\}/g, (_, key) => {
    const value = params && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : '';
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  });
}

class PromptTemplateService {
  constructor(db) {
    this.db = db;
    this.settingKey = 'prompt_templates_v1';
  }

  _readStore() {
    const raw = this.db.getSetting(this.settingKey);
    if (!raw) return {};
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    return raw;
  }

  _writeStore(store) {
    this.db.saveSetting(this.settingKey, JSON.stringify(store));
  }

  _buildKey(sceneType, model, scope, courseId) {
    const safeScene = sceneType || 'generic';
    const safeModel = model || 'default';
    const safeScope = scope || 'global';
    const safeCourse = courseId || 'none';
    return `${safeScene}:${safeModel}:${safeScope}:${safeCourse}`;
  }

  getPromptTemplate(sceneType, model, courseId) {
    const store = this._readStore();
    const keys = [
      this._buildKey(sceneType, model, 'course', courseId),
      this._buildKey(sceneType, model, 'personal', null),
      this._buildKey(sceneType, model, 'global', null)
    ];

    for (const key of keys) {
      if (store[key]) {
        return { ...store[key], key };
      }
    }

    return {
      key: null,
      sceneType,
      model,
      scope: 'global',
      template: sceneType === 'structured'
        ? '为教学环节生成插图：主题={topic}，教学内容={content}，风格={style}，要求清晰、课堂可用。'
        : '生成通用教学配图：主题={topic}，风格={style}，用途={usage}，画面简洁、可用于课件。'
    };
  }

  savePromptTemplate(sceneType, model, scope, template, courseId) {
    const store = this._readStore();
    const key = this._buildKey(sceneType, model, scope, scope === 'course' ? courseId : null);
    const record = {
      sceneType,
      model,
      scope,
      template: String(template || '').trim(),
      updatedAt: new Date().toISOString()
    };
    if (scope === 'course') {
      record.courseId = courseId;
    }
    store[key] = record;
    this._writeStore(store);
    return { key, ...record };
  }

  renderPrompt(template, params) {
    return replaceVars(template, params || {});
  }
}

module.exports = {
  PromptTemplateService
};
