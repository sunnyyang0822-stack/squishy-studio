const { test } = require('node:test');
test('marshmallow real GPU: mouse/touch, frozen release/cancel/blur/background, color takeover, lifecycle and workflow', { timeout: 120000 }, async () => {
  await require('./helpers/marshmallow-browser.cjs')();
});
