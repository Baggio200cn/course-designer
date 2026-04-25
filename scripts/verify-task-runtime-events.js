const assert = require('assert');
const { createTaskRuntime } = require('../src/main/v2/task-runtime');

function createMockDb() {
  const operations = [];
  return {
    operations,
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
  const runtime = createTaskRuntime({
    db,
    emitEvent: (event) => events.push(event)
  });

  await runtime.runStageAction({
    notebookId: 1,
    stage: 'lecture',
    action: 'save',
    summary: '保存讲稿阶段'
  }, async () => ({
    output: { ok: true },
    warnings: ['warn-a'],
    outputArtifactIds: [101]
  }));

  let failed = false;
  try {
    await runtime.runStageAction({
      notebookId: 1,
      stage: 'ppt',
      action: 'confirm',
      summary: '确认 PPT 阶段'
    }, async () => {
      throw new Error('mock failure');
    });
  } catch {
    failed = true;
  }

  assert.strictEqual(failed, true);
  assert.ok(events.some((item) => item.type === 'operation.started' && item.stage === 'lecture'));
  assert.ok(events.some((item) => item.type === 'operation.completed' && item.stage === 'lecture'));
  assert.ok(events.some((item) => item.type === 'operation.started' && item.stage === 'ppt'));
  assert.ok(events.some((item) => item.type === 'operation.failed' && item.stage === 'ppt'));

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    cases: 4
  }, null, 2));
}

run();
