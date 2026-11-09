const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFixture, contactPoint } = require('./helpers/thick-nonpaw-geometry.cjs');
for (const feel of ['marshmallow', 'slow-rebound']) test(`thick donut ${feel} clearance proofs preserve full rigid output against exhaustive queries`, async t => {
  const fast = await createFixture('donut', 'thick-wax', feel);
  const reference = await createFixture('donut', 'thick-wax', feel, false, { detachedClearanceCertificates: false });
  let fastQueries = 0, referenceQueries = 0;
  try {
    fast.begin(contactPoint(fast.mesh, .38, 0, true)); reference.begin(contactPoint(reference.mesh, .38, 0, true));
    for (let frame = 0; frame < 48; frame++) {
      fast.tick(); reference.tick();
      const a = fast.wax.getSurfaceSnapshot({ renderOnly: true }), b = reference.wax.getSurfaceSnapshot({ renderOnly: true });
      assert.deepEqual(a.positions, b.positions, `Frame ${frame} positions`);
      assert.deepEqual(a.normals, b.normals, `Frame ${frame} normals`);
      assert.deepEqual(fast.wax.getState(), reference.wax.getState());
      fastQueries += fast.wax.getQueryCounters().detachedNearestSamples;
      referenceQueries += reference.wax.getQueryCounters().detachedNearestSamples;
    }
    assert.ok(fast.wax.getState().detached > 0);
    assert.ok(fastQueries < referenceQueries, `${fastQueries} vs ${referenceQueries}`);
    t.diagnostic(JSON.stringify({ feel, frames: 48, fastQueries, referenceQueries, savedFraction: 1 - fastQueries / referenceQueries }));
  } finally { fast.dispose(); reference.dispose(); }
});
