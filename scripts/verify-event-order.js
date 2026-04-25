const assert = require('assert');
const { createArtifactTracker } = require('../src/main/v2/artifact-tracker');
const { createTaskRuntime } = require('../src/main/v2/task-runtime');

function createMockDb() {
  const artifacts = [];
  const operations = [];
  return {
    createArtifact(payload) {
      const item = { id: artifacts.length + 1, ...payload };
      artifacts.push(item);
      return item;
    },
    updateArtifact(id, patch) {
      const index = artifacts.findIndex((item) => item.id === id);
      artifacts[index] = { ...artifacts[index], ...patch };
      return artifacts[index];
    },
    createOperation(payload) {
      const item = { id: operations.length + 1, ...payload };
      operations.push(item);
      return item;
    },
    updateOperation(id, patch) {
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
  const db = createMockDb();
  const events = [];
  const emitEvent = (event) => events.push(event);

  const tracker = createArtifactTracker({ db, emitEvent });
  const runtime = createTaskRuntime({ db, emitEvent });

  const created = tracker.create(1, {
    type: 'framework_export_file',
    stage: 'framework',
    status: 'review_needed',
    confirmed: true
  });

  await runtime.runStageAction({
    notebookId: 1,
    stage: 'lecture',
    action: 'save',
    summary: '保存讲稿阶段'
  }, async () => ({
    output: { ok: true }
  }));

  const artifactChangedIndex = events.findIndex((item) => item.type === 'artifact.changed' && item.artifactId === created.id);
  const artifactConfirmedIndex = events.findIndex((item) => item.type === 'artifact.confirmed' && item.artifactId === created.id);
  const opStartedIndex = events.findIndex((item) => item.type === 'operation.started' && item.stage === 'lecture');
  const opCompletedIndex = events.findIndex((item) => item.type === 'operation.completed' && item.stage === 'lecture');

  assert.ok(artifactChangedIndex >= 0);
  assert.ok(artifactConfirmedIndex >= 0);
  assert.ok(artifactChangedIndex < artifactConfirmedIndex);
  assert.ok(opStartedIndex >= 0);
  assert.ok(opCompletedIndex >= 0);
  assert.ok(opStartedIndex < opCompletedIndex);

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    cases: 4
  }, null, 2));
}

run();
