const assert = require('assert');
const { normalizeImageSize } = require('../src/main/services/image-generator.service');

function run() {
  assert.strictEqual(normalizeImageSize('1792x1024'), '2560x1440');
  assert.strictEqual(normalizeImageSize('1024x1024'), '2048x2048');
  assert.strictEqual(normalizeImageSize('2560x1440'), '2560x1440');
  assert.strictEqual(normalizeImageSize('900x900'), '');

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    cases: 4
  }, null, 2));
}

run();
