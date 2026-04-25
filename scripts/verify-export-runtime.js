const assert = require('assert');
const { createExportRuntime } = require('../src/main/v2/export-runtime');

async function run() {
  const events = [];
  const runtime = createExportRuntime({
    emitEvent(event) {
      events.push(event);
    }
  });

  const blocked = await runtime.run({
    notebookId: 1,
    stage: 'lecture',
    format: 'docx',
    variant: 'lecture-word',
    blockingIssues: ['正式讲稿未确认']
  }, async () => ({
    data: { unreachable: true }
  }));

  const completed = await runtime.run({
    notebookId: 1,
    stage: 'ppt',
    format: 'pptx',
    variant: 'course-ppt'
  }, async () => ({
    data: { filePath: 'C:/tmp/course.pptx' },
    eventArtifactId: 42,
    eventPayload: { filePath: 'C:/tmp/course.pptx', reviewNeeded: true }
  }));

  const failed = await runtime.run({
    notebookId: 1,
    stage: 'framework',
    format: 'pdf',
    variant: 'framework-merged'
  }, async () => {
    throw new Error('pdf print failed');
  });

  assert.strictEqual(blocked.success, false);
  assert.strictEqual(completed.success, true);
  assert.strictEqual(failed.success, false);

  const lectureRequestedIndex = events.findIndex((item) => item.type === 'export.requested' && item.stage === 'lecture');
  const lectureBlockedIndex = events.findIndex((item) => item.type === 'export.blocked' && item.stage === 'lecture');
  const pptRequestedIndex = events.findIndex((item) => item.type === 'export.requested' && item.stage === 'ppt');
  const pptCompletedIndex = events.findIndex((item) => item.type === 'export.completed' && item.stage === 'ppt');
  const frameworkRequestedIndex = events.findIndex((item) => item.type === 'export.requested' && item.stage === 'framework');
  const frameworkFailedIndex = events.findIndex((item) => item.type === 'export.failed' && item.stage === 'framework');

  assert.ok(lectureRequestedIndex >= 0);
  assert.ok(lectureBlockedIndex >= 0);
  assert.ok(lectureRequestedIndex < lectureBlockedIndex);
  assert.deepStrictEqual(events[lectureBlockedIndex].payload.blockingIssues, ['正式讲稿未确认']);

  assert.ok(pptRequestedIndex >= 0);
  assert.ok(pptCompletedIndex >= 0);
  assert.ok(pptRequestedIndex < pptCompletedIndex);
  assert.strictEqual(events[pptCompletedIndex].artifactId, 42);
  assert.strictEqual(events[pptCompletedIndex].payload.filePath, 'C:/tmp/course.pptx');
  assert.strictEqual(events[pptCompletedIndex].payload.reviewNeeded, true);

  assert.ok(frameworkRequestedIndex >= 0);
  assert.ok(frameworkFailedIndex >= 0);
  assert.ok(frameworkRequestedIndex < frameworkFailedIndex);
  assert.strictEqual(events[frameworkFailedIndex].payload.error, 'pdf print failed');

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    cases: 9
  }, null, 2));
}

run();
