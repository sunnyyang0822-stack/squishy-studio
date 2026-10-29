const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createThickOrbCore, partitionAreas, inspectWholeVolume } = require('./helpers/thick-orb-core.cjs');
const cores = process.env.THICK_ORB_CORE_CASE ? process.env.THICK_ORB_CORE_CASE.split(',') : ['marshmallow', 'slow-rebound'];
for (const feelId of cores) for (const reducedMotion of [false, true]) test(`${feelId} orb thick wax: exact independent core, local thickness, large partitions and complete-volume safety (${reducedMotion ? 'reduced' : 'normal'})`, async t => {
  assert.ok(['marshmallow', 'slow-rebound'].includes(feelId));
  const f = await createThickOrbCore(feelId, { reducedMotion });
  const thin = await createThickOrbCore(feelId, { reducedMotion, presetId: 'thin-wax' });
  const record = { feelId, reducedMotion, checks: [] };
  function inspect(label) { record.checks.push({ label, frames: f.frames, ...inspectWholeVolume(f) }); }
  try {
    const intact = f.wax.getSurfaceSnapshot();
    const thickAreas = partitionAreas(intact, f.mesh), thinAreas = partitionAreas(thin.wax.getSurfaceSnapshot(), thin.mesh);
    assert.equal(thickAreas.count, 36); assert.equal(thinAreas.count, 180);
    assert.ok(thickAreas.mean / thinAreas.mean > 4); assert.ok(Math.sqrt(thickAreas.mean / thinAreas.mean) > 2);
    record.areas = { thick: thickAreas, thin: thinAreas, ratio: thickAreas.mean / thinAreas.mean };
    inspect('intact');
    f.begin(); thin.begin();
    for (let i = 0; i < 29; i++) { f.frame(); thin.frame(); assert.deepEqual(f.geometry.attributes.position.array, thin.geometry.attributes.position.array); }
    assert.ok(f.wax.getState().cracked > 0); assert.equal(f.wax.getState().detached, 0);
    for (let i = 0; i < 3; i++) { f.frame(); thin.frame(); }
    assert.ok(f.wax.getState().detached > 0); assert.equal(f.wax.getState().firstBurst, 3);
    inspect('first-separation');
    const separated = f.wax.getSurfaceSnapshot();
    for (let i = 0; i < 2; i++) { f.frame(); thin.frame(); }
    const falling = f.wax.getSurfaceSnapshot();
    assert.deepEqual(falling.indices, intact.indices, 'Detached plates keep the exact pre-cut hole topology');
    assert.deepEqual(falling.restSupportPositions, intact.restSupportPositions, 'Fragments retain their source-surface mapping');
    let rigidEdges = 0, maximumRigidError = 0;
    for (let i = 0; i < separated.indices.length; i += 3) {
      const [a, b] = separated.indices.slice(i, i + 2);
      if (!separated.detached[a] || !falling.detached[a]) continue;
      const distance = snapshot => Math.hypot(...[0, 1, 2].map(k => snapshot.positions[a * 3 + k] - snapshot.positions[b * 3 + k]));
      const error = Math.abs(distance(separated) - distance(falling));
      maximumRigidError = Math.max(maximumRigidError, error); rigidEdges++;
      assert.ok(error < 1e-6, 'Actual detached triangles must not scale while the core keeps pressing');
    }
    assert.ok(rigidEdges > 100); record.rigidity = { rigidEdges, maximumRigidError };
    for (let i = 0; i < 86; i++) { f.frame(); thin.frame(); assert.deepEqual(f.geometry.attributes.position.array, thin.geometry.attributes.position.array); }
    assert.ok(f.core.getState().depth > (feelId === 'slow-rebound' ? .4 : .3));
    inspect('two-second-deep-press');
    f.release(); thin.release(); const held = f.geometry.attributes.position.array.slice(), damage = f.wax.getState().detached, cracked = f.wax.getState().cracked;
    let previous = f.core.getState().depth;
    for (let i = 0; i < (feelId === 'slow-rebound' ? 900 : 90); i++) {
      f.frame(); thin.frame();
      assert.deepEqual(f.geometry.attributes.position.array, thin.geometry.attributes.position.array);
      assert.equal(f.wax.getState().detached, damage); assert.equal(f.wax.getState().cracked, cracked);
      if (feelId === 'marshmallow') assert.deepEqual(f.geometry.attributes.position.array, held, 'Marshmallow preserves all unload deformation');
      else { assert.ok(f.core.getState().depth <= previous + 1e-6); previous = f.core.getState().depth; }
      if ([1, 30, 120, 400, 800].includes(i)) inspect(`released-${i}`);
      if (feelId === 'slow-rebound' && f.core.getState().depth === 0) break;
    }
    if (feelId === 'slow-rebound') assert.deepEqual(f.geometry.attributes.position.array, f.rest, 'Natural rebound must finish exactly');
    inspect('released-complete');
    const start = f.contact(-.45); f.begin(start);
    for (let i = 0; i < 12; i++) { f.move(f.contact(-.45 + .9 * i / 11), .04); f.frame(); }
    f.act('cancel'); f.wax.end(); inspect('shallow-drag-cancel');
    const rim = f.contact(.22, .08); f.begin(rim); f.run(100); inspect('broken-rim-repeated-deep-press'); f.release();
    f.wax.setWorldMatrix(new f.THREE.Matrix4().makeRotationFromEuler(new f.THREE.Euler(.4, .6, .7))); f.run(18); inspect('rotated-falling-volume');
    f.act('beginRestore');
    for (let i = 0; i <= 12; i++) { f.act('applyRestore', i / 12); f.frame(); if ([0, 6, 12].includes(i)) inspect(`color-restore-${i}`); }
    assert.deepEqual(f.geometry.attributes.position.array, f.rest);
    f.wax.reset(); assert.equal(f.wax.getState().detached, 0); assert.equal(f.wax.getState().cracked, 0); inspect('restart');
    record.comparedFrames = f.frames; t.diagnostic(JSON.stringify(record));
  } catch (error) { t.diagnostic(JSON.stringify(record)); throw error; }
  finally { f.dispose(); thin.dispose(); }
});
