const assert = require('assert');
const { createV2Runtime } = require('../src/main/v2/runtime');

function createDbStub() {
  const operations = [];
  let currentId = 1;
  return {
    getNotebookById(id) {
      return { id, name: '测试课程', grade: '二年级', totalHours: 8 };
    },
    getCurrentFramework() {
      return null;
    },
    createFramework() {
      return { id: 11 };
    },
    updateFramework() {
      return { id: 11 };
    },
    replaceModules() {},
    saveTeachingSchedule() {},
    createOperation(data = {}) {
      const item = {
        id: currentId += 1,
        warnings: [],
        outputArtifactIds: [],
        metadata: {},
        ...data
      };
      operations.push(item);
      return item;
    },
    updateOperation(id, patch = {}) {
      const index = operations.findIndex((item) => item.id === id);
      operations[index] = { ...operations[index], ...patch };
      return operations[index];
    },
    listOperations() {
      return operations.slice();
    }
  };
}

async function run() {
  const db = createDbStub();
  const runtime = createV2Runtime({
    db,
    imageGeneratorService: {},
    imageVersionService: {},
    helpers: {
      ensureDb() {},
      ensureNotebookWorkspaceState(notebook) {
        return notebook;
      },
      normalizeFrameworkContent(framework) {
        return framework;
      },
      validateFrameworkContent() {
        return {
          valid: true,
          errors: [],
          warnings: [],
          reviewNeeded: false,
          reviewReasons: []
        };
      },
      normalizeModuleInput(item) {
        return item;
      },
      normalizeScheduleInput(schedule) {
        return schedule;
      },
      patchCourseProject() {},
      syncFrameworkArtifacts() {},
      buildFrameworkStageBundle() {
        return {
          frameworkRecord: { content: {} },
          notebook: { id: 1, name: '测试课程' }
        };
      },
      buildLectureStageBundle() {
        return {};
      },
      buildPptStageBundle() {
        return {};
      },
      buildVideoStageBundle() {
        return {};
      },
      normalizeLectureStagePayload(payload) {
        return payload;
      },
      upsertStageArtifact() {
        return { id: 21 };
      },
      normalizePptStagePayload(payload) {
        return payload;
      },
      upsertPptPageImageArtifacts() {
        return [];
      },
      resolveArtifactByRefOrLatest() {
        return null;
      },
      normalizePptPage(page) {
        return page;
      },
      findPptPageImageArtifact() {
        return null;
      },
      applyConfirmedModuleImagesToFramework() {},
      normalizeUnlockedStages(items) {
        return items;
      },
      ensureWorkflowStateForNotebook() {
        return { currentArtifactRefs: {} };
      },
      normalizeVideoStagePayload(payload) {
        return payload;
      },
      syncWorkflowStageAvailability() {},
      emitBackendEvent() {},
      createTrackedArtifact() {
        return { id: 31 };
      },
      updateTrackedArtifact() {
        return { id: 31 };
      }
    },
    constants: {
      PPT_TEMPLATE_PRESETS: { national: {} },
      PPT_FIXED_IMAGE_MODEL: 'test-model',
      buildPptLockedPrompt() {
        return 'prompt';
      },
      getPptPageTaskId() {
        return 'task-1';
      }
    }
  });

  const response = await runtime.saveFrameworkStage({
    notebookId: 1,
    framework: {},
    modules: [],
    schedule: []
  });

  assert.strictEqual(response.success, true);
  assert.ok(response.data);
  assert.ok(response.operation);
  assert.ok(Array.isArray(response.warnings));

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    cases: 4
  }, null, 2));
}

run();
