class ImageVersionService {
  constructor(db) {
    this.db = db;
    this.settingKey = 'image_versions_v1';
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

  _nextVersion(items) {
    if (!Array.isArray(items) || items.length === 0) return 1;
    return Math.max(...items.map((item) => Number(item.version) || 0)) + 1;
  }

  createImageVersion(taskId, promptFinal, meta = {}) {
    if (!taskId) {
      throw new Error('taskId is required');
    }
    const store = this._readStore();
    const list = Array.isArray(store[taskId]) ? store[taskId] : [];
    const item = {
      id: Date.now() + Math.floor(Math.random() * 10000),
      taskId,
      version: this._nextVersion(list),
      promptFinal: String(promptFinal || ''),
      imagePath: meta.imagePath || null,
      imageUrl: meta.imageUrl || null,
      model: meta.model || null,
      status: meta.status || 'generated',
      createdAt: new Date().toISOString(),
      meta
    };
    list.push(item);
    store[taskId] = list;
    this._writeStore(store);
    return item;
  }

  listImageVersions(taskId) {
    const store = this._readStore();
    const list = Array.isArray(store[taskId]) ? store[taskId] : [];
    return list.sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0));
  }

  rollbackImageVersion(taskId, version) {
    const list = this.listImageVersions(taskId);
    const versionText = String(version ?? '').trim();
    const target = list.find((item) => {
      if (versionText && String(item.id) === versionText) return true;
      return Number(item.version) === Number(version);
    });
    if (!target) {
      throw new Error('version not found');
    }
    const current = this.createImageVersion(taskId, target.promptFinal, {
      ...target.meta,
      imagePath: target.imagePath,
      imageUrl: target.imageUrl,
      model: target.model,
      status: 'rollback',
      sourceVersion: target.version,
      sourceId: target.id
    });
    return {
      ...target,
      currentVersionId: current.id,
      currentVersion: current.version
    };
  }
}

module.exports = {
  ImageVersionService
};
