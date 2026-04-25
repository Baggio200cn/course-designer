const assert = require('assert');
const {
  computeUnlockedStages,
  validateStageTransition
} = require('../src/main/v2/contracts');

function artifact(type, stage, patch = {}) {
  return {
    id: `${stage}-${type}`,
    type,
    stage,
    status: 'confirmed',
    confirmed: true,
    blockingIssues: [],
    updatedAt: '2026-04-02T12:00:00.000Z',
    createdAt: '2026-04-02T12:00:00.000Z',
    ...patch
  };
}

function run() {
  const emptyUnlocked = computeUnlockedStages([]);
  assert.deepStrictEqual(emptyUnlocked, ['framework']);

  const frameworkReady = [
    artifact('framework_json', 'framework'),
    artifact('framework_preview_md', 'framework')
  ];
  assert.deepStrictEqual(computeUnlockedStages(frameworkReady), ['framework', 'lecture']);
  assert.strictEqual(validateStageTransition({
    targetStage: 'lecture',
    artifacts: frameworkReady
  }).allowed, true);

  const lectureReady = [
    ...frameworkReady,
    artifact('lecture_final', 'lecture')
  ];
  assert.deepStrictEqual(computeUnlockedStages(lectureReady), ['framework', 'lecture', 'ppt']);
  assert.strictEqual(validateStageTransition({
    targetStage: 'ppt',
    artifacts: lectureReady
  }).allowed, true);

  const pptReady = [
    ...lectureReady,
    artifact('ppt_outline', 'ppt')
  ];
  assert.deepStrictEqual(computeUnlockedStages(pptReady), ['framework', 'lecture', 'ppt', 'video']);
  assert.strictEqual(validateStageTransition({
    targetStage: 'video',
    artifacts: pptReady
  }).allowed, true);

  const blockedLecture = validateStageTransition({
    targetStage: 'lecture',
    artifacts: [
      artifact('framework_json', 'framework', {
        blockingIssues: ['框架存在阻断问题']
      }),
      artifact('framework_preview_md', 'framework')
    ]
  });
  assert.strictEqual(blockedLecture.allowed, false);
  assert.ok(blockedLecture.blockingIssues.includes('框架存在阻断问题'));

  const reviewNeededConfirmed = validateStageTransition({
    targetStage: 'lecture',
    artifacts: [
      artifact('framework_json', 'framework', {
        status: 'review_needed',
        confirmed: true
      }),
      artifact('framework_preview_md', 'framework', {
        status: 'review_needed',
        confirmed: true
      })
    ]
  });
  assert.strictEqual(reviewNeededConfirmed.allowed, true);

  const lockedPpt = validateStageTransition({
    targetStage: 'ppt',
    artifacts: frameworkReady
  });
  assert.strictEqual(lockedPpt.allowed, false);
  assert.ok(lockedPpt.blockingIssues[0].includes('lecture/lecture_final'));

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    cases: 7
  }, null, 2));
}

run();
