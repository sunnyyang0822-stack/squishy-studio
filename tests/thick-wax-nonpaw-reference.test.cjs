const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFixture, contactPoint, completeClearance } = require('./helpers/thick-nonpaw-geometry.cjs');
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

test('thick marshmallow donut caps inner-ring collision work while preserving fragment clearance and fracture timing', async t => {
  const fast = await createFixture('donut', 'thick-wax', 'marshmallow');
  const reference = await createFixture('donut', 'thick-wax', 'marshmallow', false, { feelId: undefined });
  const budget = { fastTotal: 0, referenceTotal: 0, fastPeak: 0, referencePeak: 0 };
  const checked = [];
  try {
    const contact = contactPoint(fast.mesh, .38, 0, true);
    fast.begin(contact); reference.begin(contact);
    for (let frame = 1; frame <= 110; frame++) {
      fast.tick(); reference.tick();
      assert.equal(fast.wax.getState().detached, reference.wax.getState().detached, `Fracture timing at frame ${frame}`);
      const fastQueries = fast.wax.getQueryCounters().detachedNearestSamples;
      const referenceQueries = reference.wax.getQueryCounters().detachedNearestSamples;
      budget.fastTotal += fastQueries; budget.referenceTotal += referenceQueries;
      budget.fastPeak = Math.max(budget.fastPeak, fastQueries);
      budget.referencePeak = Math.max(budget.referencePeak, referenceQueries);
      if ([78, 80, 83, 87].includes(frame)) {
        const clearance = completeClearance(fast, fast.wax.getSurfaceSnapshot(), { detachedOnly: true });
        assert.ok(clearance.samples > 1000);
        assert.ok(clearance.minimumSignedDistance >= .00049);
        checked.push({ frame, ...clearance });
      }
    }
    t.diagnostic(JSON.stringify({ ...budget, checked }));
    assert.ok(fast.wax.getState().detached > 0);
    assert.ok(budget.fastPeak < .75 * budget.referencePeak);
    assert.ok(budget.fastTotal < budget.referenceTotal);
  } finally { fast.dispose(); reference.dispose(); }
});
