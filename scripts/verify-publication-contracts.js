const assert = require('assert');
const {
  buildFrameworkPublicationContract,
  buildLecturePublicationContract,
  buildPptPublicationContract
} = require('../src/main/v2/publication-contracts');

function artifact(id, patch = {}) {
  return {
    id,
    confirmed: true,
    reviewFlags: [],
    content: {},
    status: 'confirmed',
    ...patch
  };
}

function run() {
  const frameworkContract = buildFrameworkPublicationContract({
    notebookId: 1,
    notebook: { name: '课程A' },
    framework: { content: {} },
    modules: [{ name: '模块1', content: { structureImagePath: 'a.png' } }],
    schedule: [],
    structureSlots: [{ id: 'm1', imagePath: 'a.png' }],
    frameworkArtifactIds: [11, 12],
    infographicArtifacts: [{ id: 13 }],
    buildFrameworkMarkdown: () => '# ok',
    mergeDiscussionWithInfographics: (text) => text,
    resolveDiscussionMarkdown: (text) => text
  });
  assert.deepStrictEqual(frameworkContract.blockingIssues, []);

  const lectureBlocked = buildLecturePublicationContract({
    notebookId: 1,
    notebook: { name: '课程B' },
    lectureFinalArtifact: artifact(21, { confirmed: false }),
    lectureDraftsArtifact: artifact(20),
    lectureScript: ''
  });
  assert.strictEqual(lectureBlocked.blockingIssues.length >= 1, true);

  const lectureWarn = buildLecturePublicationContract({
    notebookId: 1,
    notebook: { name: '课程C' },
    lectureFinalArtifact: artifact(31, { content: { finalScript: '正文' } }),
    lectureDraftsArtifact: artifact(30),
    lectureScript: '没有标准结构'
  });
  assert.strictEqual(lectureWarn.blockingIssues.length, 0);
  assert.strictEqual(lectureWarn.reviewFlags.length >= 1, true);

  const lectureKeepReview = buildLecturePublicationContract({
    notebookId: 1,
    notebook: { name: '课程C2' },
    lectureFinalArtifact: artifact(32, {
      reviewFlags: [{ id: 'rf-1', stage: 'lecture', reason: '需人工复核' }],
      content: { finalScript: '教师讲述：\n- A\n\n课堂动作：\n- B' }
    }),
    lectureDraftsArtifact: artifact(33),
    lectureScript: '教师讲述：\n- A\n\n课堂动作：\n- B'
  });
  assert.strictEqual(lectureKeepReview.blockingIssues.length, 0);
  assert.strictEqual(lectureKeepReview.reviewFlags.length, 1);

  const pptBlocked = buildPptPublicationContract({
    notebookId: 1,
    outlineArtifact: artifact(41, { confirmed: false }),
    outlineContent: {},
    pptPages: []
  });
  assert.strictEqual(pptBlocked.blockingIssues.length >= 1, true);

  const pptWarn = buildPptPublicationContract({
    notebookId: 1,
    outlineArtifact: artifact(51),
    outlineContent: { templateKey: 'national' },
    pptPages: [{ pageNumber: 1, needImage: true, imagePath: '' }],
    pageImageArtifacts: []
  });
  assert.strictEqual(pptWarn.blockingIssues.length, 0);
  assert.strictEqual(pptWarn.reviewFlags.length >= 1, true);

  const pptKeepReview = buildPptPublicationContract({
    notebookId: 1,
    outlineArtifact: artifact(52, {
      reviewFlags: [{ id: 'rf-2', stage: 'ppt', reason: '存在待复审页面' }]
    }),
    outlineContent: { templateKey: 'national' },
    pptPages: [{ pageNumber: 1, needImage: false, imagePath: '' }],
    pageImageArtifacts: []
  });
  assert.strictEqual(pptKeepReview.blockingIssues.length, 0);
  assert.strictEqual(pptKeepReview.reviewFlags.length, 1);

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    cases: 7
  }, null, 2));
}

run();
