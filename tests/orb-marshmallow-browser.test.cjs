const { test } = require('node:test');
// Existing Linux CI full-suite GPU runs take ~16 minutes. Allow headroom for
// both devices here; every interaction and geometry assertion stays bounded.
test('marshmallow real GPU: mouse/touch, frozen release/cancel/blur/background, color takeover, lifecycle and workflow', { timeout: 300000 }, async () => {
  await require('./helpers/marshmallow-browser.cjs')();
});
