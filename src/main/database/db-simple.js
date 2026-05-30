const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// ─── Phase-6 M3.1 内部 helper：operation 压缩摘要构造 ────
function _summarizeInput(input) {
  if (input == null) return null;
  // 对象类输入：仅保留对象大小提示
  if (typeof input === 'object') {
    try {
      const byteSize = JSON.stringify(input).length;
      return byteSize > 0 ? { _summary: 'compressed', byteSize } : null;
    } catch {
      return { _summary: 'compressed' };
    }
  }
  // 原始类型直接返回
  return input;
}

function _summarizeOutput(output) {
  if (output == null) return null;
  if (typeof output !== 'object') return output;
  // 仅保留 boolean / number 字段（指标类有用）
  const summary = {};
  for (const [key, value] of Object.entries(output)) {
    if (typeof value === 'boolean' || typeof value === 'number') {
      summary[key] = value;
    } else if (typeof value === 'string' && value.length <= 80) {
      summary[key] = value;
    }
  }
  return Object.keys(summary).length ? summary : { _summary: 'compressed' };
}

function _summarizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  const summary = {};
  // quality 字段含 valid/checks 是关键审计指标
  if (metadata.quality && typeof metadata.quality === 'object') {
    const q = metadata.quality;
    summary.quality = {
      valid: Boolean(q.valid),
    };
    if (q.checks && typeof q.checks === 'object') {
      // 只保留数字类指标（如 finalNarrationCharCount）
      summary.quality.checks = Object.fromEntries(
        Object.entries(q.checks).filter(([, v]) => typeof v === 'number')
      );
    }
    if (Array.isArray(q.errors) && q.errors.length) {
      summary.quality.errorCount = q.errors.length;
    }
  }
  return summary;
}

class DatabaseManager {
  constructor() {
    // 鏁版嵁鏂囦欢璺緞
    const userDataPath = (app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : (process.env.ELECTRON_USER_DATA || process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd());
    this.dbPath = path.join(userDataPath, 'course-designer-data.json');
    
    
    // 鍒濆鍖栨暟鎹簱
    this.initDatabase();
  }

  // 2026-05-17 v4.2.0：内置默认 API 配置（火山引擎 Ark，老师装包即可用）
  _defaultArkSettings() {
    const apiKey = '3cfb5c8c-4c94-43f7-895d-ec89fdb228cc';
    const apiKeyB64 = Buffer.from(apiKey, 'utf8').toString('base64');
    const ts = new Date().toISOString();
    return {
      api_key_ark: apiKeyB64,
      api_key_ark_encrypted: true,
      api_key_ark_updated_at: ts,
      api_key_ark_endpoint_text: 'ep-m-20260327105914-k629s',
      api_key_ark_endpoint_text_updated_at: ts,
      api_key_ark_endpoint_lecture_formal: 'ep-20260429110329-cgh4p',
      api_key_ark_endpoint_lecture_formal_updated_at: ts,
      api_key_ark_endpoint_image: 'ep-20260302101322-8p5dc',
      api_key_ark_endpoint_image_updated_at: ts,
      api_key_ark_endpoint_video: 'ep-m-20260405031807-s6htf',
      api_key_ark_endpoint_video_updated_at: ts,
      api_key_ark_model_text_default: 'doubao_text',
    };
  }

  // 鍒濆鍖栨暟鎹簱
  initDatabase() {
    if (!fs.existsSync(this.dbPath)) {
      const initialData = {
        notebooks: [],
        modules: [],
        frameworks: [],
        artifacts: [],
        operations: [],
        backendEvents: [],
        workflowStates: [],
        resources: [],
        agent_memories: [],          // Phase-5C Step 4: Agent 跨会话记忆
        agent_pause_states: [],      // Phase-7.5 M7.5.1: Agent 暂停状态（每 notebook 至多 1 条）
        generation_audit: [],         // Phase-7.6 R8: LLM 生成调用审计日志
        settings: {
          app_version: '4.2.0',
          first_run: '1',
          // 2026-05-17 v4.2.0：首装即注入老师可立刻测试的默认 API 配置
          ...this._defaultArkSettings(),
        }
      };
      fs.writeFileSync(this.dbPath, JSON.stringify(initialData, null, 2), 'utf8');
    } else {
      const current = this._readData();
      let changed = false;
      if (!Array.isArray(current.artifacts)) {
        current.artifacts = [];
        changed = true;
      }
      if (!Array.isArray(current.operations)) {
        current.operations = [];
        changed = true;
      }
      if (!Array.isArray(current.backendEvents)) {
        current.backendEvents = [];
        changed = true;
      }
      if (!Array.isArray(current.workflowStates)) {
        current.workflowStates = [];
        changed = true;
      }
      // Migration: add agent_memories for Phase-5C Step 4
      if (!Array.isArray(current.agent_memories)) {
        current.agent_memories = [];
        changed = true;
      }
      // Migration: add agent_pause_states for Phase-7.5 M7.5.1
      if (!Array.isArray(current.agent_pause_states)) {
        current.agent_pause_states = [];
        changed = true;
      }
      // Migration: add generation_audit for Phase-7.6 R8
      if (!Array.isArray(current.generation_audit)) {
        current.generation_audit = [];
        changed = true;
      }
      // Migration: add enriched context fields to existing notebooks (Phase-5B)
      if (Array.isArray(current.notebooks)) {
        let notebooksChanged = false;
        current.notebooks = current.notebooks.map((nb) => {
          const next = { ...nb };
          let localChanged = false;
          if (next.softwareTools === undefined) { next.softwareTools = ''; localChanged = true; }
          if (next.jobTargets === undefined) { next.jobTargets = ''; localChanged = true; }
          if (next.industryScenarios === undefined) { next.industryScenarios = ''; localChanged = true; }
          if (next.learnerProfile === undefined) { next.learnerProfile = ''; localChanged = true; }
          if (next.teachingMaterials === undefined) { next.teachingMaterials = ''; localChanged = true; }
          if (next.linkedResources === undefined) { next.linkedResources = []; localChanged = true; }
          if (next.researchNotes === undefined) { next.researchNotes = null; localChanged = true; }
          if (localChanged) notebooksChanged = true;
          return localChanged ? next : nb;
        });
        changed = changed || notebooksChanged;
      }

      if (Array.isArray(current.artifacts)) {
        let artifactsChanged = false;
        current.artifacts = current.artifacts.map((item) => {
          const next = { ...item };
          let localChanged = false;
          if (!Array.isArray(next.reviewFlags)) {
            next.reviewFlags = [];
            localChanged = true;
          }
          if (!Array.isArray(next.validationResults)) {
            next.validationResults = [];
            localChanged = true;
          }
          if (!Array.isArray(next.sourceRefs)) {
            next.sourceRefs = [];
            localChanged = true;
          }
          if (!Array.isArray(next.blockingIssues)) {
            next.blockingIssues = [];
            localChanged = true;
          }
          if (!next.lifecycle || typeof next.lifecycle !== 'object') {
            next.lifecycle = {
              generatedAt: next.createdAt || new Date().toISOString(),
              confirmedAt: next.confirmed ? (next.updatedAt || next.createdAt || new Date().toISOString()) : null
            };
            localChanged = true;
          }
          // Phase-6 M2.1 迁移：为旧 artifact 添加 lockedByUser 字段
          // 策略（Q4 选项 B）：已 confirmed 的历史数据默认锁定，保护老用户的人工成果不被新 Agent 覆盖
          if (next.lockedByUser === undefined) {
            next.lockedByUser = Boolean(next.confirmed);
            localChanged = true;
          }
          if (localChanged) artifactsChanged = true;
          return localChanged ? next : item;
        });
        changed = changed || artifactsChanged;
      }
      if (changed) {
        this._writeData(current);
      }
    }
  }

  // 璇诲彇鏁版嵁
  _readData() {
    const data = fs.readFileSync(this.dbPath, 'utf8');
    const normalized = typeof data === 'string' ? data.replace(/^\uFEFF/, '') : data;
    return JSON.parse(normalized);
  }

  // 鍐欏叆鏁版嵁
  _writeData(data) {
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf8');
  }

  // ========================================
  // 绗旇鏈紙Notebooks锛夌浉鍏虫搷锟?
  // ========================================

  // 鍒涘缓绗旇锟?
  createNotebook(data) {
    const allData = this._readData();
    
    const notebook = {
      id: Date.now(),
      name: data.name,
      courseCode: data.courseCode || null,
      totalHours: data.totalHours,
      // P2（2026-05-17）：每次课学时 + 每学时分钟数（老师按学校标准配，无兜底）
      hoursPerSession: data.hoursPerSession || 0,
      minutesPerHour: data.minutesPerHour || 0,
      theoryHours: data.theoryHours || 0,
      practiceHours: data.practiceHours || 0,
      grade: data.grade || null,
      prerequisite: data.prerequisite || null,
      description: data.description || null,
      workspacePath: data.workspacePath || null,
      currentStage: data.currentStage || 'schedule',     // P2：v4.3.0 默认 schedule 起点（framework 已下线）
      teachingSchedule: null,
      currentFrameworkId: null,
      // P6（2026-05-18）补缺：教学进度表 header 关键字段（之前 v4.2.0 schema 漏掉，导致老师填了无效）
      teacher: data.teacher || '',
      school: data.school || '',
      department: data.department || '',
      semester: data.semester || '',
      className: data.className || '',
      textbook: data.textbook || '',
      // 课程富上下文（Phase-5B：用于提升 AI 生成质量）
      softwareTools: data.softwareTools || '',       // 具体软件工具，如"Blender 4.x"
      jobTargets: data.jobTargets || '',             // 目标职业岗位，如"橱窗陈列师"
      industryScenarios: data.industryScenarios || '',  // 行业应用场景
      learnerProfile: data.learnerProfile || '',     // 学情描述
      teachingMaterials: data.teachingMaterials || '', // 参考教材/课程标准
      linkedResources: data.linkedResources || [],   // 关联的本地素材库资源 IDs
      researchNotes: data.researchNotes || null,     // AI/联网研究结果
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    allData.notebooks.push(notebook);
    allData.workflowStates = Array.isArray(allData.workflowStates) ? allData.workflowStates : [];
    allData.workflowStates.push({
      notebookId: notebook.id,
      currentStage: notebook.currentStage || 'schedule',     // P2：v4.3.0
      unlockedStages: ['schedule'],                          // P2：起点 schedule
      currentArtifactRefs: {},
      updatedAt: new Date().toISOString()
    });
    this._writeData(allData);
    
    return notebook;
  }

  // 鑾峰彇鎵€鏈夌瑪璁版湰
  getAllNotebooks() {
    const data = this._readData();
    return data.notebooks.sort((a, b) => 
      new Date(b.updatedAt) - new Date(a.updatedAt)
    );
  }

  // 鑾峰彇鍗曚釜绗旇锟?
  getNotebookById(id) {
    const data = this._readData();
    return data.notebooks.find(nb => nb.id === id);
  }

  // 鏇存柊绗旇锟?
  updateNotebook(id, updateData) {
    const allData = this._readData();
    const index = allData.notebooks.findIndex(nb => nb.id === id);
    
    if (index !== -1) {
      allData.notebooks[index] = {
        ...allData.notebooks[index],
        ...updateData,
        updatedAt: new Date().toISOString()
      };
      this._writeData(allData);
      return allData.notebooks[index];
    }
    
    return null;
  }

  // 鍒犻櫎绗旇锟?
  deleteNotebook(id) {
    const allData = this._readData();
    allData.notebooks = allData.notebooks.filter(nb => nb.id !== id);
    // 鍚屾椂鍒犻櫎鐩稿叧鐨勬ā鍧楀拰妗嗘灦
    allData.modules = allData.modules.filter(m => m.notebookId !== id);
    allData.frameworks = allData.frameworks.filter(f => f.notebookId !== id);
    allData.artifacts = (allData.artifacts || []).filter(a => a.notebookId !== id);
    allData.operations = (allData.operations || []).filter(o => o.notebookId !== id);
    allData.backendEvents = (allData.backendEvents || []).filter(e => e.notebookId !== id);
    allData.workflowStates = (allData.workflowStates || []).filter(w => w.notebookId !== id);
    this._writeData(allData);
  }

  // ========================================
  // 妗嗘灦锛團rameworks锛夌浉鍏虫搷锟?
  // ========================================

  // 鍒涘缓妗嗘灦锛堟柊鐗堟湰锟?
  createFramework(notebookId, content, mode = 'append') {
    const allData = this._readData();
    const notebookIndex = allData.notebooks.findIndex(nb => nb.id === notebookId);
    if (notebookIndex === -1) {
      throw new Error('Notebook not found');
    }

    if (mode === 'overwrite' && allData.notebooks[notebookIndex].currentFrameworkId) {
      const updated = this.updateFramework(allData.notebooks[notebookIndex].currentFrameworkId, content);
      allData.notebooks[notebookIndex].updatedAt = new Date().toISOString();
      this._writeData(allData);
      return updated;
    }

    const versions = allData.frameworks
      .filter(f => f.notebookId === notebookId)
      .map(f => f.version || 0);
    const nextVersion = (versions.length ? Math.max(...versions) : 0) + 1;

    const framework = {
      id: Date.now(),
      notebookId,
      version: nextVersion,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    allData.frameworks.push(framework);
    allData.notebooks[notebookIndex].currentFrameworkId = framework.id;
    allData.notebooks[notebookIndex].updatedAt = new Date().toISOString();
    this._writeData(allData);
    return framework;
  }

  // 鏇存柊妗嗘灦锛堣鐩栧唴瀹癸級
  updateFramework(frameworkId, content) {
    const allData = this._readData();
    const index = allData.frameworks.findIndex(f => f.id === frameworkId);
    if (index === -1) {
      throw new Error('Framework not found');
    }
    allData.frameworks[index] = {
      ...allData.frameworks[index],
      content,
      updatedAt: new Date().toISOString()
    };
    this._writeData(allData);
    return allData.frameworks[index];
  }

  // 鑾峰彇妗嗘灦鍒楄〃
  listFrameworks(notebookId) {
    const data = this._readData();
    return data.frameworks
      .filter(f => f.notebookId === notebookId)
      .sort((a, b) => (b.version || 0) - (a.version || 0));
  }

  // 鑾峰彇褰撳墠妗嗘灦
  getCurrentFramework(notebookId) {
    const data = this._readData();
    const notebook = data.notebooks.find(nb => nb.id === notebookId);
    if (!notebook) return null;

    if (notebook.currentFrameworkId) {
      return data.frameworks.find(f => f.id === notebook.currentFrameworkId) || null;
    }

    return this.listFrameworks(notebookId)[0] || null;
  }

  // 璁剧疆褰撳墠妗嗘灦
  setCurrentFramework(notebookId, frameworkId) {
    const allData = this._readData();
    const notebookIndex = allData.notebooks.findIndex(nb => nb.id === notebookId);
    if (notebookIndex === -1) {
      throw new Error('Notebook not found');
    }
    const exists = allData.frameworks.find(f => f.id === frameworkId && f.notebookId === notebookId);
    if (!exists) {
      throw new Error('Framework not found');
    }
    allData.notebooks[notebookIndex].currentFrameworkId = frameworkId;
    allData.notebooks[notebookIndex].updatedAt = new Date().toISOString();
    this._writeData(allData);
    return exists;
  }

  getWorkflowState(notebookId) {
    const data = this._readData();
    const existing = (data.workflowStates || []).find((item) => item.notebookId === notebookId);
    if (existing) return existing;
    // v4.3.3 Sprint A.2（2026-05-18）：framework 是 v3.x 老阶段，已退役。
    //   新笔记本从 schedule 起步（v4.0+ 起点），unlocked 含 schedule。
    //   兼容 D12 后续真落地 sessionContext / artifact 时不需要再迁。
    return {
      notebookId,
      currentStage: 'schedule',
      unlockedStages: ['schedule'],
      currentArtifactRefs: {},
      updatedAt: new Date().toISOString()
    };
  }

  upsertWorkflowState(notebookId, patch = {}) {
    const allData = this._readData();
    allData.workflowStates = Array.isArray(allData.workflowStates) ? allData.workflowStates : [];
    const index = allData.workflowStates.findIndex((item) => item.notebookId === notebookId);
    const base = index === -1
      ? {
          // v4.3.3 Codex #4：framework 已彻底退役，新 workflow 从 schedule 起步
          notebookId,
          currentStage: 'schedule',
          unlockedStages: ['schedule'],
          currentArtifactRefs: {},
          updatedAt: new Date().toISOString()
        }
      : allData.workflowStates[index];
    const next = {
      ...base,
      ...patch,
      currentArtifactRefs: {
        ...(base.currentArtifactRefs || {}),
        ...((patch && patch.currentArtifactRefs) || {})
      },
      unlockedStages: Array.isArray(patch.unlockedStages)
        ? patch.unlockedStages
        : (Array.isArray(base.unlockedStages) ? base.unlockedStages : ['framework']),
      updatedAt: new Date().toISOString()
    };
    if (index === -1) allData.workflowStates.push(next);
    else allData.workflowStates[index] = next;
    this._writeData(allData);
    return next;
  }

  createArtifact(artifactData = {}) {
    const allData = this._readData();
    allData.artifacts = Array.isArray(allData.artifacts) ? allData.artifacts : [];
    const now = new Date().toISOString();
    const item = {
      id: Date.now() + Math.floor(Math.random() * 10000),
      // v4.3.3 D13（2026-05-18）：schemaVersion 用于跨版本迁移检测
      //   1 = v4.3.3 起的"标准 schema"（带 sourceArtifactIds / lessonNumber / status / confirmedAt / dirty）
      //   未来 schema 变化时 bump 这个 + 写 migration
      schemaVersion: Number(artifactData.schemaVersion) || 1,
      notebookId: artifactData.notebookId,
      type: artifactData.type || 'unknown',
      // v4.3.3 D14 兼容：framework 默认值已退役，但向后兼容老 artifact，新建 stage 必须显式传
      stage: artifactData.stage || 'unknown',
      title: artifactData.title || artifactData.type || '未命名产物',
      content: artifactData.content ?? null,
      // v4.3.3 Bug1 真根因修复（codex 审计 2026-05-29）：补存 metadata
      //   旧实现完全没存 metadata，导致 metadata.lessonNumber 全部丢失，
      //   PPT/讲稿/测验/作业/报告的"按节次匹配"全部失效（测验报"本节尚无 PPT"等）。
      metadata: (artifactData.metadata && typeof artifactData.metadata === 'object') ? artifactData.metadata : {},
      format: artifactData.format || 'json',
      status: artifactData.status || 'generated',
      version: Number(artifactData.version) || 1,
      confirmed: Boolean(artifactData.confirmed),
      // v4.3.3 D13：dirty 信号 · 上游 artifact 变化时下游标 dirty=true 提示老师重算
      dirty: Boolean(artifactData.dirty),
      dirtyReason: artifactData.dirtyReason || null,
      dirtyAt: artifactData.dirty ? now : null,
      // Phase-6 M2.1：用户保护锁
      // 默认策略：显式传入则取传入值；未传时与 confirmed 同步（confirm 自动锁，符合 Q2 选项 C）
      lockedByUser: artifactData.lockedByUser !== undefined
        ? Boolean(artifactData.lockedByUser)
        : Boolean(artifactData.confirmed),
      parentArtifactId: artifactData.parentArtifactId || null,
      sourceArtifactIds: Array.isArray(artifactData.sourceArtifactIds) ? artifactData.sourceArtifactIds : [],
      storagePath: artifactData.storagePath || null,
      previewText: artifactData.previewText || null,
      diffSummary: artifactData.diffSummary || null,
      reviewFlags: Array.isArray(artifactData.reviewFlags) ? artifactData.reviewFlags : [],
      validationResults: Array.isArray(artifactData.validationResults) ? artifactData.validationResults : [],
      sourceRefs: Array.isArray(artifactData.sourceRefs) ? artifactData.sourceRefs : [],
      blockingIssues: Array.isArray(artifactData.blockingIssues) ? artifactData.blockingIssues : [],
      lifecycle: artifactData.lifecycle && typeof artifactData.lifecycle === 'object'
        ? artifactData.lifecycle
        : {
            generatedAt: now,
            confirmedAt: artifactData.confirmed ? now : null
          },
      createdAt: now,
      updatedAt: now
    };
    allData.artifacts.push(item);
    this._writeData(allData);
    return item;
  }

  updateArtifact(artifactId, patch = {}) {
    const allData = this._readData();
    allData.artifacts = Array.isArray(allData.artifacts) ? allData.artifacts : [];
    const index = allData.artifacts.findIndex((item) => item.id === artifactId);
    if (index === -1) {
      throw new Error('Artifact not found');
    }
    // Phase-6 M2.1：confirm 自动锁定（Q2 选项 C 第一种触发场景）
    // 当 patch.confirmed=true 但未显式传 lockedByUser 时，自动设为 true
    // 保留显式传入的优先级（如调用方需要 confirm 但不锁——理论上不应出现，但 API 层不应强制）
    const normalizedPatch = { ...patch };
    if (patch.confirmed === true && patch.lockedByUser === undefined) {
      normalizedPatch.lockedByUser = true;
    }
    // v4.3.3 修复（codex 审计 2026-05-30）：显式撤销确认（confirmed:false）时，集中清掉确认残留，
    //   避免留下"confirmed=false 但 confirmedAt/lockedByUser 仍在"的状态（quiz/homework/video 保存共用此路径）。
    if (patch.confirmed === false) {
      normalizedPatch.confirmedAt = null;
      if (patch.lockedByUser === undefined) normalizedPatch.lockedByUser = false;
    }
    // v4.3.3 codex 复审（2026-05-30）：先算 lifecycle，撤销确认时强制 confirmedAt=null，
    //   即使调用方显式传了 lifecycle 也封死，不再保留旧确认时间（封死 DB 层不变量）。
    const _prevLifecycle = allData.artifacts[index].lifecycle || {};
    let _nextLifecycle = patch.lifecycle && typeof patch.lifecycle === 'object'
      ? { ..._prevLifecycle, ...patch.lifecycle }
      : {
          ..._prevLifecycle,
          confirmedAt: patch.confirmed
            ? (_prevLifecycle.confirmedAt || new Date().toISOString())
            : _prevLifecycle.confirmedAt || null,
        };
    if (patch.confirmed === false) _nextLifecycle = { ..._nextLifecycle, confirmedAt: null };
    allData.artifacts[index] = {
      ...allData.artifacts[index],
      ...normalizedPatch,
      sourceArtifactIds: Array.isArray(patch.sourceArtifactIds)
        ? patch.sourceArtifactIds
        : allData.artifacts[index].sourceArtifactIds || [],
      reviewFlags: Array.isArray(patch.reviewFlags)
        ? patch.reviewFlags
        : allData.artifacts[index].reviewFlags || [],
      validationResults: Array.isArray(patch.validationResults)
        ? patch.validationResults
        : allData.artifacts[index].validationResults || [],
      sourceRefs: Array.isArray(patch.sourceRefs)
        ? patch.sourceRefs
        : allData.artifacts[index].sourceRefs || [],
      blockingIssues: Array.isArray(patch.blockingIssues)
        ? patch.blockingIssues
        : allData.artifacts[index].blockingIssues || [],
      lifecycle: _nextLifecycle,
      updatedAt: new Date().toISOString()
    };
    this._writeData(allData);
    return allData.artifacts[index];
  }

  // ──────────────────────────────────────────────────────
  //  Phase-6 M2.1：用户保护锁（lockedByUser）helper
  // ──────────────────────────────────────────────────────
  /**
   * 显式设置 artifact 的用户锁状态。
   *
   * 调用场景：
   *  - 用户在编辑器手动 edit 了内容（M2.2 业务层调用，传 locked=true）
   *  - 用户主动点"重新生成"清除锁（业务层调用，传 locked=false）
   *
   * 注意：本方法不联动 confirmed 字段——锁与 confirm 是独立维度，
   *      由调用方按场景决定是否需要同步设置 confirmed。
   *
   * @param {number} artifactId
   * @param {boolean} locked
   * @returns {Object|null} 更新后的 artifact，未找到返回 null
   */
  setArtifactLock(artifactId, locked) {
    const allData = this._readData();
    allData.artifacts = Array.isArray(allData.artifacts) ? allData.artifacts : [];
    const index = allData.artifacts.findIndex((item) => item.id === artifactId);
    if (index === -1) return null;
    allData.artifacts[index] = {
      ...allData.artifacts[index],
      lockedByUser: Boolean(locked),
      updatedAt: new Date().toISOString(),
    };
    this._writeData(allData);
    return allData.artifacts[index];
  }

  /**
   * 查询 artifact 的用户锁状态。
   * 未找到的 artifact 返回 false（"无锁"对应"无保护"，调用方仍可读旧逻辑）。
   *
   * @param {number} artifactId
   * @returns {boolean}
   */
  isArtifactLocked(artifactId) {
    const data = this._readData();
    const item = (data.artifacts || []).find((a) => a.id === artifactId);
    return item ? Boolean(item.lockedByUser) : false;
  }

  /**
   * 查询某个 notebook 的指定 type+stage 最新 artifact 是否被用户锁定。
   * 用于 orchestrator 在 backtracking 前快速判断"是否会覆盖用户改动"。
   *
   * @param {number} notebookId
   * @param {string} type
   * @param {string} [stage]
   * @returns {boolean}
   */
  isLatestArtifactLocked(notebookId, type, stage = '') {
    const latest = this.getLatestArtifact(notebookId, type, stage);
    return latest ? Boolean(latest.lockedByUser) : false;
  }

  listArtifacts(filters = {}) {
    const data = this._readData();
    const notebookId = Number(filters.notebookId) || null;
    const type = filters.type || '';
    const stage = filters.stage || '';
    return (data.artifacts || [])
      .filter((item) => {
        if (notebookId && Number(item.notebookId) !== notebookId) return false;
        if (type && item.type !== type) return false;
        if (stage && item.stage !== stage) return false;
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }

  getLatestArtifact(notebookId, type, stage = '') {
    return this.listArtifacts({ notebookId, type, stage })[0] || null;
  }

  createOperation(operationData = {}) {
    const allData = this._readData();
    allData.operations = Array.isArray(allData.operations) ? allData.operations : [];
    const now = new Date().toISOString();
    const item = {
      id: Date.now() + Math.floor(Math.random() * 10000),
      notebookId: operationData.notebookId,
      stage: operationData.stage || 'framework',
      action: operationData.action || 'unknown',
      status: operationData.status || 'running',
      summary: operationData.summary || null,
      input: operationData.input ?? null,
      output: operationData.output ?? null,
      error: operationData.error || null,
      warnings: Array.isArray(operationData.warnings) ? operationData.warnings : [],
      outputArtifactIds: Array.isArray(operationData.outputArtifactIds) ? operationData.outputArtifactIds : [],
      metadata: operationData.metadata && typeof operationData.metadata === 'object' ? operationData.metadata : {},
      startedAt: operationData.startedAt || now,
      finishedAt: operationData.finishedAt || null,
      createdAt: now,
      updatedAt: now
    };
    allData.operations.push(item);
    this._writeData(allData);
    return item;
  }

  updateOperation(operationId, patch = {}) {
    const allData = this._readData();
    allData.operations = Array.isArray(allData.operations) ? allData.operations : [];
    const index = allData.operations.findIndex((item) => item.id === operationId);
    if (index === -1) {
      throw new Error('Operation not found');
    }
    const current = allData.operations[index];
    allData.operations[index] = {
      ...current,
      ...patch,
      warnings: Array.isArray(patch.warnings) ? patch.warnings : (current.warnings || []),
      outputArtifactIds: Array.isArray(patch.outputArtifactIds)
        ? patch.outputArtifactIds
        : (current.outputArtifactIds || []),
      metadata: patch.metadata && typeof patch.metadata === 'object'
        ? { ...(current.metadata || {}), ...patch.metadata }
        : (current.metadata || {}),
      updatedAt: new Date().toISOString()
    };
    this._writeData(allData);
    return allData.operations[index];
  }

  // ──────────────────────────────────────────────────────
  //  Phase-6 M3.1：长会话日志压缩
  // ──────────────────────────────────────────────────────
  /**
   * 压缩单个 operation 的详细字段，节省长流水线下的存储与读取成本。
   *
   * 永远保留的核心字段（不压缩）：
   *   id/notebookId/stage/action/status/summary
   *   startedAt/finishedAt/createdAt/updatedAt
   *   outputArtifactIds/error
   *
   * 可压缩字段（按 level 处理）：
   *   input/output/warnings/metadata
   *
   * level 选项：
   *   'auto' (默认)       — 仅当 status='completed' 且未压缩时压缩为 summary；其他状态保持原样
   *   'success_summary'   — 强制压缩（即使 status≠completed）
   *   'archive'           — 极致压缩，input/output/warnings 全部清空，仅留指标摘要
   *
   * 设计准则：
   *  - 失败 operation 不压缩（错误堆栈、warnings 对调试至关重要）
   *  - 已压缩的不重复处理（通过 _compressed 字段判断幂等）
   *  - 调用方拿到的 finalOperation（来自 updateOperation 返回值）保持原样，
   *    本方法仅修改持久化层；事件订阅者也接到原始对象
   *
   * @param {number} operationId
   * @param {Object} [options]
   * @param {string} [options.level='auto']
   * @returns {Object|null} 压缩后的 operation；不存在返回 null
   */
  compressOperationDetail(operationId, options = {}) {
    const allData = this._readData();
    allData.operations = Array.isArray(allData.operations) ? allData.operations : [];
    const index = allData.operations.findIndex((item) => item.id === operationId);
    if (index === -1) return null;
    const op = allData.operations[index];
    const level = options.level || 'auto';

    // 幂等：已压缩则跳过（auto 模式视任何已压缩状态为完成）
    if (op._compressed) {
      if (level === 'auto') return op;
      if (op._compressed === level) return op;
    }

    // auto 模式仅压缩"已完成且成功"的 operation；运行中/失败保持全量
    if (level === 'auto') {
      if (op.status !== 'completed') return op;
    }

    const compressed = { ...op };
    if (level === 'archive') {
      compressed.input = null;
      compressed.output = null;
      compressed.warnings = [];
      compressed.metadata = { _archived: true };
      compressed._compressed = 'archive';
    } else {
      // success_summary 或 auto + completed
      compressed.input = _summarizeInput(op.input);
      compressed.output = _summarizeOutput(op.output);
      compressed.warnings = Array.isArray(op.warnings) ? op.warnings.slice(0, 3) : [];
      compressed.metadata = _summarizeMetadata(op.metadata);
      compressed._compressed = 'success_summary';
    }
    compressed.updatedAt = new Date().toISOString();
    allData.operations[index] = compressed;
    this._writeData(allData);
    return compressed;
  }

  /**
   * 批量压缩某 notebook 下的历史 operation。
   * 调用场景：一次完整 Agent run 完成后清理空间，或定期维护。
   *
   * 返回 { compressedCount, skippedCount, byteSavedEstimate }（字节估算基于 JSON.stringify 长度）
   *
   * @param {number} notebookId
   * @param {Object} [options]
   * @param {string} [options.level='auto']
   * @param {string} [options.beforeIso] - ISO 时间字符串：仅压缩 createdAt < beforeIso 的 operation
   * @param {boolean} [options.includeRunning=false] - 是否压缩 status='running' 的（默认不）
   */
  compactOperationsByNotebook(notebookId, options = {}) {
    const allData = this._readData();
    allData.operations = Array.isArray(allData.operations) ? allData.operations : [];
    const level = options.level || 'auto';
    const beforeIso = typeof options.beforeIso === 'string' ? options.beforeIso : null;
    const includeRunning = Boolean(options.includeRunning);

    let compressedCount = 0;
    let skippedCount = 0;
    let byteSavedEstimate = 0;

    for (let i = 0; i < allData.operations.length; i++) {
      const op = allData.operations[i];
      if (Number(op.notebookId) !== Number(notebookId)) { skippedCount++; continue; }
      if (!includeRunning && op.status === 'running') { skippedCount++; continue; }
      if (beforeIso && (op.createdAt || '') >= beforeIso) { skippedCount++; continue; }
      if (op._compressed === level) { skippedCount++; continue; }

      const beforeBytes = JSON.stringify(op).length;
      const result = this.compressOperationDetail(op.id, { level });
      if (result && result._compressed) {
        compressedCount++;
        const afterBytes = JSON.stringify(result).length;
        byteSavedEstimate += Math.max(0, beforeBytes - afterBytes);
      } else {
        skippedCount++;
      }
    }
    return { compressedCount, skippedCount, byteSavedEstimate };
  }

  listOperations(filters = {}) {
    const data = this._readData();
    const notebookId = Number(filters.notebookId) || null;
    const stage = filters.stage || '';
    const status = filters.status || '';
    const action = filters.action || '';
    const limit = Number(filters.limit) || 0;
    const items = (data.operations || [])
      .filter((item) => {
        if (notebookId && Number(item.notebookId) !== notebookId) return false;
        if (stage && item.stage !== stage) return false;
        if (status && item.status !== status) return false;
        if (action && item.action !== action) return false;
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    return limit > 0 ? items.slice(0, limit) : items;
  }

  createBackendEvent(eventData = {}) {
    const allData = this._readData();
    allData.backendEvents = Array.isArray(allData.backendEvents) ? allData.backendEvents : [];
    const now = new Date().toISOString();
    const item = {
      id: Date.now() + Math.floor(Math.random() * 10000),
      notebookId: Number(eventData.notebookId) || null,
      scope: eventData.scope || 'system',
      type: eventData.type || 'unknown',
      stage: eventData.stage || '',
      artifactId: eventData.artifactId || null,
      payload: eventData.payload && typeof eventData.payload === 'object' ? eventData.payload : {},
      createdAt: now,
      updatedAt: now
    };
    allData.backendEvents.push(item);
    this._writeData(allData);
    return item;
  }

  listBackendEvents(filters = {}) {
    const data = this._readData();
    const notebookId = Number(filters.notebookId) || null;
    const type = String(filters.type || '').trim();
    const stage = String(filters.stage || '').trim();
    const limit = Number(filters.limit) || 0;
    const items = (data.backendEvents || [])
      .filter((item) => {
        if (notebookId && Number(item.notebookId) !== notebookId) return false;
        if (type && item.type !== type) return false;
        if (stage && item.stage !== stage) return false;
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    return limit > 0 ? items.slice(0, limit) : items;
  }

  // ========================================
  // 鏁欏杩涘害琛紙Teaching Schedule锟?
  // ========================================

  saveTeachingSchedule(notebookId, schedule) {
    const updated = this.updateNotebook(notebookId, { teachingSchedule: schedule });
    if (!updated) {
      throw new Error('Notebook not found');
    }
    return updated.teachingSchedule;
  }

  getTeachingSchedule(notebookId) {
    const notebook = this.getNotebookById(notebookId);
    return notebook ? (notebook.teachingSchedule || null) : null;
  }

  // ========================================
  // 妯″潡锛圡odules锛夌浉鍏虫搷锟?
  // ========================================

  // 鍒涘缓妯″潡
  createModule(notebookId, moduleData) {
    const allData = this._readData();
    
    const module = {
      id: Date.now(),
      notebookId: notebookId,
      moduleNumber: moduleData.moduleNumber,
      name: moduleData.name,
      hours: moduleData.hours,
      description: moduleData.description || null,
      objectives: moduleData.objectives || [],
      knowledgePoints: moduleData.knowledgePoints || [],
      teachingMethods: moduleData.teachingMethods || null,
      isCore: Boolean(moduleData.isCore),
      content: moduleData.content || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    allData.modules.push(module);
    this._writeData(allData);
    
    return module.id;
  }

  // 鑾峰彇绗旇鏈殑鎵€鏈夋ā锟?
  getModulesByNotebook(notebookId) {
    const data = this._readData();
    return data.modules
      .filter(m => m.notebookId === notebookId)
      .sort((a, b) => a.moduleNumber - b.moduleNumber);
  }

  getModuleById(moduleId) {
    const data = this._readData();
    return data.modules.find((m) => m.id === moduleId) || null;
  }

  // Update module
  updateModule(moduleId, updateData) {
    const allData = this._readData();
    const index = allData.modules.findIndex(m => m.id === moduleId);
    if (index === -1) {
      throw new Error('Module not found');
    }
    allData.modules[index] = {
      ...allData.modules[index],
      ...updateData,
      updatedAt: new Date().toISOString()
    };
    this._writeData(allData);
    return allData.modules[index];
  }

  // Delete module
  deleteModule(moduleId) {
    const allData = this._readData();
    const exists = allData.modules.some(m => m.id === moduleId);
    if (!exists) {
      throw new Error('Module not found');
    }
    allData.modules = allData.modules.filter(m => m.id !== moduleId);
    this._writeData(allData);
  }

  // Replace all modules for a notebook
  replaceModules(notebookId, modules) {
    const allData = this._readData();
    const previous = allData.modules.filter(m => m.notebookId === notebookId);
    allData.modules = allData.modules.filter(m => m.notebookId !== notebookId);
    const now = new Date().toISOString();
    const normalized = (modules || []).map((moduleData) => ({
      id: Date.now() + Math.floor(Math.random() * 10000),
      notebookId,
      moduleNumber: moduleData.moduleNumber,
      name: moduleData.name,
      hours: moduleData.hours,
      description: moduleData.description || null,
      objectives: moduleData.objectives || [],
      knowledgePoints: moduleData.knowledgePoints || [],
      teachingMethods: moduleData.teachingMethods || null,
      content: (() => {
        const matched = previous.find((item) => {
          const sameNumber = Number(item.moduleNumber) === Number(moduleData.moduleNumber);
          const sameName = String(item.name || '').trim() === String(moduleData.name || '').trim();
          return sameNumber || sameName;
        });
        const prevContent = matched && matched.content && typeof matched.content === 'object'
          ? matched.content
          : {};
        const nextContent = moduleData.content && typeof moduleData.content === 'object'
          ? moduleData.content
          : {};
        return { ...prevContent, ...nextContent };
      })(),
      isCore: Boolean(moduleData.isCore),
      createdAt: now,
      updatedAt: now
    }));
    allData.modules.push(...normalized);
    this._writeData(allData);
    return this.getModulesByNotebook(notebookId);
  }

  setModuleStructureImage(moduleId, imageData = {}) {
    const allData = this._readData();
    const index = allData.modules.findIndex((m) => m.id === moduleId);
    if (index === -1) {
      throw new Error('Module not found');
    }
    const prev = allData.modules[index];
    const prevContent = prev.content && typeof prev.content === 'object' ? prev.content : {};
    allData.modules[index] = {
      ...prev,
      content: {
        ...prevContent,
        structureImagePath: imageData.imagePath || null,
        structureImageUrl: imageData.imageUrl || null,
        structureImageMeta: {
          prompt: imageData.prompt || '',
          model: imageData.model || null,
          resourceId: imageData.resourceId || null,
          updatedAt: new Date().toISOString()
        }
      },
      updatedAt: new Date().toISOString()
    };
    this._writeData(allData);
    return allData.modules[index];
  }

  updateModuleContent(moduleId, contentPatch = {}, merge = true) {
    const allData = this._readData();
    const index = allData.modules.findIndex((m) => m.id === moduleId);
    if (index === -1) {
      throw new Error('Module not found');
    }
    const prev = allData.modules[index];
    const prevContent = prev.content && typeof prev.content === 'object' ? prev.content : {};
    allData.modules[index] = {
      ...prev,
      content: merge
        ? { ...prevContent, ...(contentPatch || {}) }
        : { ...(contentPatch || {}) },
      updatedAt: new Date().toISOString()
    };
    this._writeData(allData);
    return allData.modules[index];
  }

  // ========================================
  // 素材资源（Resources）相关操作
  // ========================================

  listResources(filters = {}) {
    const data = this._readData();
    const keyword = (filters.keyword || '').toLowerCase();
    const type = filters.type || '';
    const notebookId = filters.notebookId ? Number(filters.notebookId) : null;

    return (data.resources || [])
      .filter((item) => {
        if (type && item.type !== type) return false;
        if (notebookId && Number(item.notebookId) !== notebookId) return false;
        if (!keyword) return true;
        const text = [
          item.name,
          item.originalName,
          item.tags,
          item.description
        ]
          .flat()
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return text.includes(keyword);
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }

  createResource(resourceData) {
    const allData = this._readData();
    const resource = {
      id: Date.now() + Math.floor(Math.random() * 10000),
      name: resourceData.name || resourceData.originalName || '未命名素材',
      originalName: resourceData.originalName || resourceData.name || '未命名素材',
      type: resourceData.type || 'other',
      notebookId: resourceData.notebookId || null,
      sourcePath: resourceData.sourcePath || null,
      storagePath: resourceData.storagePath || null,
      size: resourceData.size || 0,
      tags: Array.isArray(resourceData.tags) ? resourceData.tags : [],
      description: resourceData.description || '',
      // 结构化标签字段
      moduleRef: resourceData.moduleRef || null,
      stage: resourceData.stage || null,
      usage: resourceData.usage || null,
      category: resourceData.category || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    allData.resources = Array.isArray(allData.resources) ? allData.resources : [];
    allData.resources.push(resource);
    this._writeData(allData);
    return resource;
  }

  upsertResourceByStoragePath(resourceData) {
    const allData = this._readData();
    allData.resources = Array.isArray(allData.resources) ? allData.resources : [];
    const index = allData.resources.findIndex((item) => item.storagePath === resourceData.storagePath);
    if (index === -1) {
      const resource = {
        id: Date.now() + Math.floor(Math.random() * 10000),
        name: resourceData.name || resourceData.originalName || '未命名素材',
        originalName: resourceData.originalName || resourceData.name || '未命名素材',
        type: resourceData.type || 'other',
        notebookId: resourceData.notebookId || null,
        sourcePath: resourceData.sourcePath || null,
        storagePath: resourceData.storagePath || null,
        size: resourceData.size || 0,
        tags: Array.isArray(resourceData.tags) ? resourceData.tags : [],
        description: resourceData.description || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      allData.resources.push(resource);
      this._writeData(allData);
      return resource;
    }
    allData.resources[index] = {
      ...allData.resources[index],
      ...resourceData,
      updatedAt: new Date().toISOString()
    };
    this._writeData(allData);
    return allData.resources[index];
  }

  // 按 ID 获取单个资源
  getResourceById(resourceId) {
    const data = this._readData();
    return (data.resources || []).find((item) => item.id === Number(resourceId)) || null;
  }

  // 更新资源字段
  updateResource(resourceId, patch = {}) {
    const allData = this._readData();
    allData.resources = Array.isArray(allData.resources) ? allData.resources : [];
    const index = allData.resources.findIndex((item) => item.id === Number(resourceId));
    if (index === -1) throw new Error('Resource not found');
    allData.resources[index] = {
      ...allData.resources[index],
      ...patch,
      tags: Array.isArray(patch.tags) ? patch.tags : allData.resources[index].tags,
      updatedAt: new Date().toISOString()
    };
    this._writeData(allData);
    return allData.resources[index];
  }

  // 给资源追加标签（不覆盖已有）
  addResourceTags(resourceId, newTags = []) {
    const allData = this._readData();
    allData.resources = Array.isArray(allData.resources) ? allData.resources : [];
    const index = allData.resources.findIndex((item) => item.id === Number(resourceId));
    if (index === -1) throw new Error('Resource not found');
    const existing = Array.isArray(allData.resources[index].tags) ? allData.resources[index].tags : [];
    const merged = [...new Set([...existing, ...newTags.filter(Boolean)])];
    allData.resources[index].tags = merged;
    allData.resources[index].updatedAt = new Date().toISOString();
    this._writeData(allData);
    return allData.resources[index];
  }

  // 按标签查询资源（多标签 AND）
  listResourcesByTags(tags = [], filters = {}) {
    const data = this._readData();
    const notebookId = filters.notebookId ? Number(filters.notebookId) : null;
    const type = filters.type || '';
    const tagsToMatch = tags.filter(Boolean).map(t => t.toLowerCase());
    return (data.resources || [])
      .filter((item) => {
        if (type && item.type !== type) return false;
        if (notebookId && Number(item.notebookId) !== notebookId) return false;
        if (!tagsToMatch.length) return true;
        const itemTags = (Array.isArray(item.tags) ? item.tags : []).map(t => String(t).toLowerCase());
        return tagsToMatch.every(t => itemTags.some(it => it.includes(t)));
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }

  // 按模块查询资源
  listResourcesByModule(notebookId, moduleRef) {
    return this.listResourcesByTags([`模块:${moduleRef}`], { notebookId });
  }

  // 获取笔记本下所有标签统计
  listResourceTags(notebookId) {
    const data = this._readData();
    const tagCount = {};
    (data.resources || [])
      .filter((item) => !notebookId || Number(item.notebookId) === Number(notebookId))
      .forEach((item) => {
        (Array.isArray(item.tags) ? item.tags : []).forEach((tag) => {
          tagCount[tag] = (tagCount[tag] || 0) + 1;
        });
      });
    return Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  deleteResource(resourceId) {
    const allData = this._readData();
    const exists = allData.resources.some((item) => item.id === Number(resourceId));
    if (!exists) {
      throw new Error('Resource not found');
    }
    allData.resources = allData.resources.filter((item) => item.id !== Number(resourceId));
    this._writeData(allData);
    return true;
  }

  // ========================================
  // 璁剧疆锛圫ettings锛夌浉鍏虫搷锟?
  // ========================================

  // 淇濆瓨API瀵嗛挜
  saveApiKey(provider, apiKey) {
    const allData = this._readData();
    
    // 绠€鍗曠殑base64缂栫爜
    const encoded = Buffer.from(apiKey).toString('base64');
    allData.settings[`api_key_${provider}`] = encoded;
    allData.settings[`api_key_${provider}_encrypted`] = true;
    allData.settings[`api_key_${provider}_updated_at`] = new Date().toISOString();
    
    this._writeData(allData);
  }

  // 鑾峰彇API瀵嗛挜
  getApiKey(provider) {
    const data = this._readData();
    const encoded = data.settings[`api_key_${provider}`];
    
    if (!encoded) return null;
    
    // 瑙ｇ爜
    if (data.settings[`api_key_${provider}_encrypted`]) {
      return Buffer.from(encoded, 'base64').toString('utf8');
    }
    
    return encoded;
  }

  // 淇濆瓨璁剧疆
  saveSetting(key, value) {
    const allData = this._readData();
    allData.settings[key] = value;
    allData.settings[`${key}_updated_at`] = new Date().toISOString();
    this._writeData(allData);
  }

  // 鑾峰彇璁剧疆
  getSetting(key) {
    const data = this._readData();
    return data.settings[key] || null;
  }

  // ========================================
  // 宸ュ叿鏂规硶
  // ========================================

  // 鍏抽棴鏁版嵁搴擄紙JSON鏂囦欢涓嶉渶瑕佸叧闂級

  // ========================================
  // Agent 记忆（agent_memories）Phase-5C Step 4
  // ========================================

  /**
   * 保存一条 Agent 记忆（upsert：同 notebookId 只保留最新一条）
   * 超出全局上限（50 条）时删除最旧的条目。
   */
  saveAgentMemory(entry) {
    const MAX_MEMORIES = 50;
    const allData = this._readData();
    allData.agent_memories = Array.isArray(allData.agent_memories) ? allData.agent_memories : [];

    // upsert：删除同 notebookId 的旧记录
    allData.agent_memories = allData.agent_memories.filter(
      (m) => m.notebookId !== entry.notebookId
    );

    // 全局上限：超出时删除最旧的条目
    while (allData.agent_memories.length >= MAX_MEMORIES) {
      allData.agent_memories.shift();
    }

    allData.agent_memories.push({ ...entry, id: Date.now() });
    this._writeData(allData);
  }

  /**
   * 获取所有 Agent 记忆（供 memory.js 检索使用）
   * @returns {Array}
   */
  getAgentMemories() {
    const data = this._readData();
    return Array.isArray(data.agent_memories) ? data.agent_memories : [];
  }

  // ──────────────────────────────────────────────────────
  //  Phase-7.5 M7.5.1：Agent 暂停状态持久化
  // ──────────────────────────────────────────────────────
  /**
   * 保存 Agent 暂停状态（用于失败时等待老师介入，再恢复）
   * 同一 notebookId 至多 1 条，重复保存覆盖。
   *
   * @param {Object} state - { notebookId, stage, reason, details, suggestions, stepLog, agentState, pausedAt }
   * @returns {Object} 保存后的状态
   */
  saveAgentPauseState(state = {}) {
    const allData = this._readData();
    allData.agent_pause_states = Array.isArray(allData.agent_pause_states) ? allData.agent_pause_states : [];
    const notebookId = Number(state.notebookId);
    if (!notebookId) throw new Error('saveAgentPauseState: notebookId 必填');
    const entry = {
      notebookId,
      stage: state.stage || 'unknown',
      reason: state.reason || '',
      details: state.details || {},
      suggestions: Array.isArray(state.suggestions) ? state.suggestions : [],
      stepLog: Array.isArray(state.stepLog) ? state.stepLog : [],
      agentState: state.agentState || {},
      pausedAt: state.pausedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // 同 notebookId 替换
    allData.agent_pause_states = allData.agent_pause_states.filter(
      (item) => Number(item.notebookId) !== notebookId
    );
    allData.agent_pause_states.push(entry);
    this._writeData(allData);
    return entry;
  }

  /**
   * 获取笔记本的 Agent 暂停状态。
   * @param {number} notebookId
   * @returns {Object|null}
   */
  getAgentPauseState(notebookId) {
    const data = this._readData();
    const id = Number(notebookId);
    return (data.agent_pause_states || []).find((item) => Number(item.notebookId) === id) || null;
  }

  /**
   * Phase-7.6 R8：写入生成审计日志（fire-and-forget 用）
   * 已构造好的 entry 直接 push；单 notebook 上限淘汰由 generation-audit.service 控制
   *
   * @param {Object} entry - 由 buildAuditEntry 构造的标准化对象
   * @returns {Object} 写入的 entry
   */
  createGenerationAudit(entry) {
    const allData = this._readData();
    allData.generation_audit = Array.isArray(allData.generation_audit) ? allData.generation_audit : [];
    allData.generation_audit.push(entry);
    // 单 notebook 上限淘汰（200 条）
    const MAX_PER_NB = 200;
    const sameNbCount = allData.generation_audit.filter(
      (e) => Number(e.notebookId) === Number(entry.notebookId)
    ).length;
    if (sameNbCount > MAX_PER_NB) {
      // 找到最老的 sameNbCount-MAX_PER_NB 条移除
      const sameNbSorted = allData.generation_audit
        .filter((e) => Number(e.notebookId) === Number(entry.notebookId))
        .sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? -1 : 1);
      const toRemove = new Set(sameNbSorted.slice(0, sameNbCount - MAX_PER_NB).map((e) => e.id));
      allData.generation_audit = allData.generation_audit.filter((e) => !toRemove.has(e.id));
    }
    this._writeData(allData);
    return entry;
  }

  /**
   * 清除笔记本的 Agent 暂停状态（恢复后调用）。
   * @param {number} notebookId
   * @returns {boolean} 是否有移除
   */
  clearAgentPauseState(notebookId) {
    const allData = this._readData();
    allData.agent_pause_states = Array.isArray(allData.agent_pause_states) ? allData.agent_pause_states : [];
    const id = Number(notebookId);
    const before = allData.agent_pause_states.length;
    allData.agent_pause_states = allData.agent_pause_states.filter(
      (item) => Number(item.notebookId) !== id
    );
    const removed = allData.agent_pause_states.length < before;
    if (removed) this._writeData(allData);
    return removed;
  }

  // ═══════════════════════════════════════════════════════════════
  //  v4.3.3 D13 · artifact dirty 信号传播（2026-05-18）
  //  当上游 stage artifact 改变（confirm / update content），下游 stage 的现有 artifact
  //  自动标 dirty=true，提示老师"上游改了，需要重算"。但不删除老 artifact。
  // ═══════════════════════════════════════════════════════════════

  /**
   * 上游某个 stage confirm 或 content 变化后，把下游所有 stage artifact 标 dirty
   * @param {number} notebookId
   * @param {string} upstreamStage - 上游 stage key（如 'lecture'）
   * @param {string} [reason] - 触发原因
   */
  markDownstreamDirty(notebookId, upstreamStage, reason = 'upstream changed') {
    const STAGE_ORDER = ['schedule', 'design', 'ppt', 'lecture', 'quiz', 'homework', 'video', 'report'];
    const upstreamIdx = STAGE_ORDER.indexOf(upstreamStage);
    if (upstreamIdx < 0) return { affected: 0 };  // 未知 stage
    const downstreamStages = STAGE_ORDER.slice(upstreamIdx + 1);
    if (downstreamStages.length === 0) return { affected: 0 };
    const data = this._readData();
    data.artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
    const now = new Date().toISOString();
    let affected = 0;
    data.artifacts = data.artifacts.map((a) => {
      if (Number(a.notebookId) !== Number(notebookId)) return a;
      if (!downstreamStages.includes(a.stage)) return a;
      // 已 dirty 就不重复标，但更新 reason
      if (a.dirty) return { ...a, dirtyReason: reason, dirtyAt: now };
      affected += 1;
      return { ...a, dirty: true, dirtyReason: reason, dirtyAt: now };
    });
    this._writeData(data);
    return { affected, downstreamStages };
  }

  /**
   * 显式清 dirty（老师重算 / 老师"沿用"上游变化时调用）
   */
  clearArtifactDirty(artifactId) {
    const data = this._readData();
    data.artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
    const idx = data.artifacts.findIndex((a) => Number(a.id) === Number(artifactId));
    if (idx < 0) return null;
    data.artifacts[idx] = {
      ...data.artifacts[idx],
      dirty: false,
      dirtyReason: null,
      dirtyAt: null,
      updatedAt: new Date().toISOString(),
    };
    this._writeData(data);
    return data.artifacts[idx];
  }

  // ═══════════════════════════════════════════════════════════════
  //  v4.3.3 D12 · SessionContext 真持久化（2026-05-18）
  //  之前所有 4 个 method 不存在，session.handlers 兜底返 null
  //  现在落到 data.sessions[notebookId] = { activeLessonNumber, activeDesignArtifactId, ... }
  // ═══════════════════════════════════════════════════════════════

  getSessionContext(notebookId) {
    const id = Number(notebookId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const data = this._readData();
    data.sessions = data.sessions && typeof data.sessions === 'object' ? data.sessions : {};
    return data.sessions[id] || null;
  }

  /**
   * 浅合并 patch 进现有 session
   * @param {number} notebookId
   * @param {object} patch - { activeLessonNumber, activeDesignArtifactId, activeLectureArtifactId, activePptOutlineId, activeQuizId, activeHomeworkId, activeMicroVideoId, activeReportId, lastStageKey, ... }
   */
  updateSessionContext(notebookId, patch = {}) {
    const id = Number(notebookId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const data = this._readData();
    data.sessions = data.sessions && typeof data.sessions === 'object' ? data.sessions : {};
    const existing = data.sessions[id] || {};
    const next = {
      ...existing,
      ...patch,
      notebookId: id,
      updatedAt: new Date().toISOString(),
    };
    data.sessions[id] = next;
    this._writeData(data);
    return next;
  }

  /**
   * 切节课：找出该 notebook 下第 N 节的最新 design / lecture / ppt / quiz / homework / micro_video artifact id
   * 并把它们写进 session，让所有 stage 切到第 N 节时数据一致
   */
  switchActiveLesson(notebookId, lessonNumber) {
    const id = Number(notebookId);
    const ln = Number(lessonNumber);
    if (!Number.isFinite(id) || id <= 0) return null;
    if (!Number.isFinite(ln) || ln <= 0) return null;
    const allArtifacts = this.listArtifacts({ notebookId: id }) || [];
    const pickLatestForLesson = (type, stage) => {
      const match = allArtifacts.filter((a) =>
        a.type === type && a.stage === stage
        && Number(a.metadata?.lessonNumber) === ln
      );
      if (match.length === 0) return null;
      return match.sort((a, b) =>
        new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
      )[0]?.id || null;
    };
    const patch = {
      activeLessonNumber: ln,
      activeDesignArtifactId: pickLatestForLesson('design_doc', 'design'),
      activeLectureArtifactId: pickLatestForLesson('lecture_final', 'lecture'),
      activePptOutlineId: pickLatestForLesson('ppt_outline', 'ppt'),
      activeQuizId: pickLatestForLesson('quiz_set', 'quiz'),
      activeHomeworkId: pickLatestForLesson('homework_set', 'homework'),
      // v4.3.3 Codex #3：统一为 video_prompt（实际生成 type），兜底兼容老 micro_video_plan
      activeMicroVideoId: pickLatestForLesson('video_prompt', 'video') || pickLatestForLesson('micro_video_plan', 'video'),
    };
    return this.updateSessionContext(id, patch);
  }

  /**
   * 单独切某类 artifact（如老师在历史版本里挑了不同 design）
   */
  setActiveArtifact(notebookId, kind, artifactId) {
    const id = Number(notebookId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const fieldMap = {
      design: 'activeDesignArtifactId',
      lecture: 'activeLectureArtifactId',
      ppt: 'activePptOutlineId',
      quiz: 'activeQuizId',
      homework: 'activeHomeworkId',
      microVideo: 'activeMicroVideoId',
      report: 'activeReportId',
    };
    const field = fieldMap[kind];
    if (!field) return null;
    return this.updateSessionContext(id, { [field]: Number(artifactId) || null });
  }

  close() {
  }

  transaction(callback) {
    return callback();
  }
}

module.exports = DatabaseManager;

