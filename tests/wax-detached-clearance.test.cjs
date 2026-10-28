const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');
const { contactPoint } = require('./helpers/thick-wax-geometry.cjs');

test('donut detached clearance certificates preserve exact geometry, collisions, damage and lifetime against full queries', async t => {
  const THREE = await import('three');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = readMesh('assets/models/squishy-donut.glb'), geometry = new THREE.BufferGeometry();
  const rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setIndex(mesh.indices);
  const core = getOrbFeel('clay').createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array, { surfaceGeometry: createSurfaceGeometry(rest, normals, mesh.indices, {}) });
  let frames = 0;
  let now = 0, hits = 0, queries = 0, referenceQueries = 0, movingFrames = 0;
  const options = { styleId: 'donut', geometry, restPositions: rest, restNormals: normals, clock: () => now };
  const optimized = getWaxPreset('thick-wax').create(options);
  const reference = getWaxPreset('thick-wax').create({ ...options, detachedClearanceCertificates: false });
  optimized.getQueryCounters(true); reference.getQueryCounters(true);
  const aMesh = optimized.group.children[0].geometry, bMesh = reference.group.children[0].geometry;
  function compare() {
    assert.deepEqual(aMesh.attributes.position.array, bMesh.attributes.position.array, 'Every uploaded shell vertex remains exactly identical');
    assert.deepEqual(aMesh.attributes.normal.array, bMesh.attributes.normal.array);
    assert.deepEqual(optimized.getState(), reference.getState(), 'Includes damage, IDs, falling, collection and cleanup');
  }
  function frame(forceSync = false) {
    const dt = [1 / 144, 1 / 90, 1 / 60, 1 / 30, .055, .1][frames++ % 6];
    const coreStep = core.step(dt); geometry.computeVertexNormals(); now += dt;
    const aStep = optimized.step(dt), bStep = reference.step(dt);
    assert.equal(aStep.changed, bStep.changed);
    // Match the renderer: live core updates also sync an otherwise idle shell.
    if (forceSync || coreStep.changed && !aStep.changed) { optimized.sync(); reference.sync(); }
    compare();
    const a = optimized.getQueryCounters(), b = reference.getQueryCounters();
    if (aStep.changed || forceSync || coreStep.changed) {
      hits += a.detachedCertifiedSamples; queries += a.detachedNearestSamples; referenceQueries += b.detachedNearestSamples;
    }
    if (optimized.getState().living) movingFrames++;
  }
  const begin = p => { core.begin(p); optimized.begin(p); reference.begin(p); };
  const release = () => { core.release(); optimized.end(); reference.end(); };
  const run = count => { for (let i = 0; i < count; i++) frame(); };
  try {
    const p = contactPoint(mesh, .38, 0, true), q = contactPoint(mesh, .35, .12, true);
    begin(p); run(100);
    core.move(q, .3); optimized.move(q); reference.move(q); run(35);
    const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.7, .8, -.6));
    optimized.setWorldMatrix(rotation); reference.setWorldMatrix(rotation); run(20);
    release(); run(25); begin(q); run(45); release();
    // A sudden core recovery and a large object transform exhaust old proofs.
    core.beginRestore(); core.applyRestore(1); frame(true);
    const scale = new THREE.Matrix4().compose(new THREE.Vector3(.1, -.1, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(-1, .3, 1.1)), new THREE.Vector3(1.1, .9, 1.05));
    optimized.setWorldMatrix(scale); reference.setWorldMatrix(scale); run(12);
    core.beginRestore(); for (let i = 0; i <= 10; i++) { core.applyRestore(i / 10); frame(true); }
    run(180);
    assert.ok(hits > 10000 && movingFrames > 50, 'Exercise certified moving volume samples');
    assert.ok(queries < referenceQueries * .6, `Real nearest query reduction: ${queries}/${referenceQueries}`);
    optimized.reset(); reference.reset(); compare(); begin(p); run(35); release();
    t.diagnostic(JSON.stringify({ hits, queries, referenceQueries, movingFrames, reduction: 1 - queries / referenceQueries }));
  } finally { optimized.dispose(); reference.dispose(); geometry.dispose(); }
});

test('donut correction finishes after the old ten-pass budget is exhausted; all inner/outer edges and walls stay outside', async t => {
  const { createFixture, completeClearance, localThickness } = require('./helpers/thick-wax-geometry.cjs');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const f = await createFixture('donut');
  let now = 0;
  const old = getWaxPreset('thick-wax').create({ styleId: 'donut', geometry: f.geometry, clock: () => now, detachedClearanceCertificates: false, detachedCollisionIterations: 10 });
  const p = contactPoint(f.mesh, .38, 0, true);
  try {
    f.deformation.begin(p); f.wax.begin(p); old.begin(p);
    for (let i = 0; i <= 189; i++) {
      const coreStep = f.deformation.step(1 / 90); f.geometry.computeVertexNormals(); now += 1 / 90;
      const a = f.wax.step(1 / 90, now), b = old.step(1 / 90);
      if (coreStep.changed && !a.changed) f.wax.sync();
      if (coreStep.changed && !b.changed) old.sync();
    }
    const before = old.getMetrics({ exhaustive: true }), after = f.wax.getMetrics({ exhaustive: true });
    assert.ok(before.detachedViolations > 0 && before.detachedMinSignedDistance < -.005, 'Retain deterministic reproducer of original ten-pass collision exhaustion');
    assert.ok(f.wax.getState().detached > 0 && old.getState().detached > 0, 'Both clocks must reach real fragmentation before checking clearance');
    assert.equal(f.wax.getState().detached, old.getState().detached, 'Only collision completion changes, not fracture age or count');
    assert.equal(after.detachedViolations, 0); assert.equal(after.attachedViolations, 0);
    const snapshot = f.wax.getSurfaceSnapshot(), all = completeClearance(f, snapshot);
    localThickness(snapshot, .042); assert.ok(all.samples > 100000);
    t.diagnostic(JSON.stringify({ oldViolations: before.detachedViolations, oldMinimum: before.detachedMinSignedDistance, oldWorstSample: before.worstDetachedSample, newViolations: after.detachedViolations, newMinimum: after.detachedMinSignedDistance, completeVolume: all }));
  } finally { old.dispose(); f.dispose(); }
});
