const assert = require('assert');
const { createArtifactTracker } = require('../src/main/v2/artifact-tracker');

function createMockDb() {
  const artifacts = [];
  return {
    createArtifact(payload) {
      const item = {
        id: artifacts.length + 1,
        reviewFlags: [],
        blockingIssues: [],
        ...payload
      };
      artifacts.push(item);
      return item;
    },
    updateArtifact(id, patch) {
      const index = artifacts.findIndex((item) => item.id === id);
      artifacts[index] = { ...artifacts[index], ...patch };
      return artifacts[index];
    }
  };
}

function run() {
  const db = createMockDb();
  const events = [];
  const tracker = createArtifactTracker({
    db,
    emitEvent: (event) => events.push(event)
  });

  const created = tracker.create(1, {
    type: 'lecture_final',
    stage: 'lecture',
    status: 'review_needed',
    confirmed: false
  });
  const updated = tracker.update(created.id, {
    status: 'confirmed',
    confirmed: true
  });
  const reviewed = tracker.create(1, {
    type: 'framework_export_file',
    stage: 'framework',
    status: 'review_needed',
    confirmed: true
  });

  assert.strictEqual(created.id, 1);
  assert.strictEqual(updated.confirmed, true);
  assert.strictEqual(reviewed.confirmed, true);
  assert.ok(events.some((item) => item.type === 'artifact.changed' && item.payload.status === 'review_needed'));
  assert.ok(events.some((item) => item.type === 'artifact.changed' && item.payload.status === 'confirmed'));
  assert.ok(events.some((item) => item.type === 'artifact.confirmed' && item.artifactId === created.id));
  assert.ok(events.some((item) => item.type === 'artifact.confirmed' && item.artifactId === reviewed.id));

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    cases: 4
  }, null, 2));
}

run();
