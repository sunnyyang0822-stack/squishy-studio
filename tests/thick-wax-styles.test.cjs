const { test } = require('node:test');
const assert = require('node:assert/strict');
const { partitionStats, localThickness, createFixture, contactPoint, completeClearance } = require('./helpers/thick-wax-geometry.cjs');
const cases = process.env.THICK_WAX_STYLE_CASE ? process.env.THICK_WAX_STYLE_CASE.split(',') : ['cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
for (const id of cases) test(`${id}: thick wax has larger connected real fragments, local triple thickness and complete live-core clearance`, async t => {
  assert.ok(['cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star'].includes(id), 'Paw is deliberately excluded');
  const thin = await createFixture(id, 'thin-wax'), f = await createFixture(id);
  const record = { style: id, checks: [] };
  try {
    const thinSnapshot = thin.wax.getSurfaceSnapshot(), thickSnapshot = f.wax.getSurfaceSnapshot();
    const old = partitionStats(thinSnapshot, thin.mesh), current = partitionStats(thickSnapshot, f.mesh);
    localThickness(thinSnapshot, .014); localThickness(thickSnapshot, .042);
    assert.ok(Math.abs(old.all.total - current.all.total) < 1e-6);
    assert.ok(current.all.mean / old.all.mean > 4, `${id} actual mean fragment area must give >2x equivalent diameter`);
    assert.ok(current.all.median / old.all.median > 4);
    record.partitions = { thin: old.all, thick: current.all, meanAreaRatio: current.all.mean / old.all.mean };
    if (id === 'donut') {
      assert.ok(old.innerWholePanels.count > 0 && current.innerWholePanels.count > 0);
      assert.ok(current.innerWholePanels.mean / old.innerWholePanels.mean > 4, 'Complete physical fragments touching inner wall must grow');
      assert.ok(current.innerWholePanels.median / old.innerWholePanels.median > 4, 'Inner wall median cannot remain tiny despite global growth');
      assert.ok(current.innerWholePanels.p10 / old.innerWholePanels.p10 > 4, 'Inner wall small-fragment tail must also visibly grow');
      record.innerRing = { thinWholeFragments: old.innerWholePanels, thickWholeFragments: current.innerWholePanels, thinInnerSurfaceParts: old.inner, thickInnerSurfaceParts: current.inner };
    }
    const targets = { cloud: [[.4, .05], [.2, -.1]], cylinder: [[.12, .12], [-.25, -.15]], donut: [[.38, 0], [.35, .12]], pyramid: [[.15, -.25], [-.15, -.3]], flower: [[.55, .05], [.4, -.15]], star: [[.5, .15], [.35, -.05]] }[id];
    const contacts = targets.map(([x, y]) => contactPoint(f.mesh, x, y, id === 'donut'));
    let frames = 0, detachedSeen = false;
    function verify(label) {
      const snapshot = f.wax.getSurfaceSnapshot();
      assert.deepEqual(f.geometry.attributes.position.array, f.baselinePositions, 'Approved clay behavior remains point-for-point identical');
      const thickness = localThickness(snapshot, .042), clearance = completeClearance(f, snapshot), metrics = f.wax.getMetrics({ exhaustive: true });
      assert.equal(metrics.attachedViolations, 0); assert.equal(metrics.detachedViolations, 0); assert.ok(metrics.maxThicknessError < 1e-5);
      detachedSeen ||= f.wax.getState().detached > 0;
      record.checks.push({ label, frames, detached: f.wax.getState().detached, ...thickness, ...clearance });
    }
    function run(count, label) { for (let i = 0; i < count; i++) { f.tick(); frames++; } verify(label); }
    verify('intact');
    f.begin(contacts[0]); run(30, 'before-dwell'); run(2, 'separation'); run(58, 'deep-press');
    f.move(contacts[1], .3); run(24, 'inner-wall-or-connection-drag');
    f.wax.setWorldMatrix(new f.THREE.Matrix4().makeRotationFromEuler(new f.THREE.Euler(.4, .65, .7))); run(18, 'rotated');
    f.end(); run(30, 'released-core-recovery');
    f.begin(contacts[1]); run(60, 'repeated-deep-press'); f.end(); run(24, 'repeat-recovery');
    f.deformation.beginRestore(); f.baseline.beginRestore(); f.restore(.5); verify('explicit-restore-half'); f.restore(1); verify('explicit-restore-complete');
    assert.ok(detachedSeen, 'Exercise real large detached volumes, not only intact coat');
    assert.ok(record.checks.reduce((sum, value) => sum + value.samples, 0) > 100000);
    t.diagnostic(JSON.stringify(record));
  } catch (error) { t.diagnostic(JSON.stringify(record)); throw error; }
  finally { thin.dispose(); f.dispose(); }
});
