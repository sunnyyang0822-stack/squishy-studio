const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

async function fixture(id = 'thick-wax') {
  const THREE = await import('three');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const mesh = readMesh('assets/models/squishy-orb.glb'), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3)); geometry.setIndex(mesh.indices);
  let now = 0;
  const wax = getWaxPreset(id).create({ geometry, clock: () => now });
  const deformation = getOrbFeel('clay').createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array);
  const baselinePositions = Float32Array.from(mesh.positions);
  const baselineNormals = Float32Array.from(mesh.normals);
  const baseline = getOrbFeel('clay').createDeformation(baselinePositions, baselineNormals);
  return { THREE, mesh, wax, geometry, deformation, baseline, baselinePositions,
    tick(dt = 1 / 60) { deformation.step(dt); baseline.step(dt); geometry.computeVertexNormals(); now += dt; wax.step(dt); },
    shellTick(dt) { now += dt; wax.step(dt); },
    begin(p = [0, 0, .9]) { deformation.begin(p); baseline.begin(p); wax.begin(p); },
    end() { deformation.release(); baseline.release(); wax.end(); },
    dispose() { wax.dispose(); geometry.dispose(); } };
}
function area(positions, a, b, c) {
  const u = [0, 1, 2].map(k => positions[b * 3 + k] - positions[a * 3 + k]);
  const v = [0, 1, 2].map(k => positions[c * 3 + k] - positions[a * 3 + k]);
  return Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) / 2;
}
function areas(snapshot) {
  const panels = new Map();
  for (let i = 0; i < snapshot.indices.length; i += 3) {
    const vertices = Array.from(snapshot.indices.slice(i, i + 3));
    if (vertices.every(r => snapshot.layers[r] === 1)) {
      const id = snapshot.panelIds[vertices[0]];
      panels.set(id, (panels.get(id) || 0) + area(snapshot.restSupportPositions, ...vertices));
    }
  }
  return panels;
}
function localThickness(snapshot, expected) {
  let checked = 0;
  for (let r = 0; r < snapshot.layers.length - 1; r++) if (snapshot.layers[r] === 0 && snapshot.layers[r + 1] === 1) {
    if ([0, 1, 2].every(k => snapshot.positions[r * 3 + k] === 0 && snapshot.positions[(r + 1) * 3 + k] === 0)) continue; // Expired geometry is intentionally removed.
    const length = Math.hypot(...[0, 1, 2].map(k => snapshot.positions[(r + 1) * 3 + k] - snapshot.positions[r * 3 + k]));
    assert.ok(Math.abs(length - expected) < 1e-5, `Local thickness panel ${snapshot.panelIds[r]}, vertex ${r}: ${length}`); checked++;
  }
  assert.ok(checked > 1000);
}

test('thick registry shares only verified behavior, frozen parameters and separate instance state', async () => {
  const { getWaxPreset, thickWaxParameters } = await import('../src/wax-presets.mjs');
  const { thinWaxParameters } = await import('../src/thin-wax.mjs');
  const preset = getWaxPreset('thick-wax');
  assert.ok(Object.isFrozen(preset)); assert.ok(Object.isFrozen(thickWaxParameters));
  assert.equal(preset.material, 'wax'); assert.equal(preset.thickness, 'thick');
  assert.notEqual(preset.parameters, thinWaxParameters);
  assert.equal(preset.parameters.thickness, thinWaxParameters.thickness * 3);
  assert.equal(preset.parameters.seedCount, 36);
  for (const key of Object.keys(thinWaxParameters)) if (key !== 'thickness') assert.equal(preset.parameters[key], thinWaxParameters[key], key);
  assert.equal(thinWaxParameters.thickness, .014); assert.equal(thinWaxParameters.gap, .004);
  assert.throws(() => getWaxPreset('medium-wax'), RangeError, 'Unshipped medium preset is not introduced or used');
  const a = await fixture(), b = await fixture('thin-wax'), c = await fixture();
  try {
    const originalB = b.wax.getSurfaceSnapshot(), originalC = c.wax.getSurfaceSnapshot();
    a.wax.begin([0, 0, .9]); a.shellTick(.501); a.wax.end();
    assert.ok(a.wax.getState().detached > 0);
    assert.deepEqual(b.wax.getSurfaceSnapshot().positions, originalB.positions);
    assert.deepEqual(c.wax.getSurfaceSnapshot().positions, originalC.positions);
    a.wax.dispose(); assert.equal(c.wax.getState().disposed, false);
    assert.deepEqual(a.geometry.attributes.position.array, Float32Array.from(a.mesh.positions));
  } finally { a.dispose(); b.dispose(); c.dispose(); }
});

test('every local thick cross-section is triple thin; actual source partitions exceed twice linear size and cover identical holes', async t => {
  const thin = await fixture('thin-wax'), thick = await fixture();
  try {
    const a = thin.wax.getSurfaceSnapshot(), b = thick.wax.getSurfaceSnapshot();
    localThickness(a, .014); localThickness(b, .042);
    const aa = areas(a), ba = areas(b), sum = values => [...values].reduce((a, b) => a + b, 0);
    const thinTotal = sum(aa.values()), thickTotal = sum(ba.values());
    assert.ok(Math.abs(thinTotal - thickTotal) < 1e-6);
    assert.equal(aa.size, 180); assert.equal(ba.size, 36);
    const ratio = (thickTotal / ba.size) / (thinTotal / aa.size);
    assert.ok(ratio > 4); assert.ok(Math.sqrt(ratio) > 2);
    const metrics = thick.wax.getMetrics({ exhaustive: true });
    assert.ok(metrics.panelAreaCV > .35); assert.ok(metrics.panelAreaRange[1] / metrics.panelAreaRange[0] > 5);
    // Per source face coverage disallows missing areas and duplicate overlapping patches.
    const coverage = new Float64Array(thick.mesh.indices.length / 3);
    for (let i = 0; i < b.indices.length; i += 3) {
      const v = Array.from(b.indices.slice(i, i + 3));
      if (v.every(r => b.layers[r] === 1)) coverage[b.sourceFaces[i / 3]] += area(b.restSupportPositions, ...v);
    }
    for (let face = 0; face < coverage.length; face++) assert.ok(Math.abs(coverage[face] - area(thick.mesh.positions, ...thick.mesh.indices.slice(face * 3, face * 3 + 3))) < 1e-8);
    const releasedAreas = [];
    for (const [f, partitionAreas] of [[thin, aa], [thick, ba]]) {
      f.wax.begin([0, 0, .9]); f.shellTick(.501); f.wax.end();
      const snapshot = f.wax.getSurfaceSnapshot();
      const ids = new Set(Array.from(snapshot.panelIds).filter((id, i) => snapshot.detached[i]));
      assert.ok(ids.size > 0 && ids.size <= 3);
      releasedAreas.push(sum([...ids].map(id => partitionAreas.get(id))) / ids.size);
    }
    assert.ok(releasedAreas[1] / releasedAreas[0] > 4, 'Actual first detached fragments also exceed twice equivalent diameter');
    t.diagnostic(JSON.stringify({ releasedMeanAreas: releasedAreas, releasedAreaRatio: releasedAreas[1] / releasedAreas[0], thin: { patches: aa.size, meanArea: thinTotal / aa.size }, thick: { patches: ba.size, meanArea: thickTotal / ba.size, range: metrics.panelAreaRange, cv: metrics.panelAreaCV }, areaRatio: ratio, equivalentDiameterRatio: Math.sqrt(ratio) }));
  } finally { thin.dispose(); thick.dispose(); }
});

test('unchanged dwell and no timed emptying; detached large plates keep original hole topology and rigid size', async () => {
  const f = await fixture();
  try {
    const intact = f.wax.getSurfaceSnapshot();
    f.wax.begin([0, 0, .9]); f.shellTick(.5); assert.equal(f.wax.getState().detached, 0);
    f.shellTick(.001); const burst = f.wax.getState();
    assert.ok(burst.detached > 0 && burst.detached <= 3); assert.ok(burst.detached < burst.panels / 4);
    f.shellTick(.01); const before = f.wax.getSurfaceSnapshot();
    f.shellTick(.05); const after = f.wax.getSurfaceSnapshot();
    assert.deepEqual(after.indices, intact.indices); assert.deepEqual(after.panelIds, intact.panelIds);
    assert.deepEqual(after.restSupportPositions, intact.restSupportPositions);
    let edges = 0;
    for (let i = 0; i < before.indices.length; i += 3) {
      const [a, b] = before.indices.slice(i, i + 2);
      if (!before.detached[a] || !after.detached[a]) continue;
      const length = s => Math.hypot(...[0, 1, 2].map(k => s.positions[a * 3 + k] - s.positions[b * 3 + k]));
      assert.ok(Math.abs(length(before) - length(after)) < 1e-6, 'No size jump after separation'); edges++;
    }
    assert.ok(edges > 100); localThickness(after, .042);
    f.shellTick(.6); assert.equal(f.wax.getState().detached, burst.detached);
    f.wax.end(); const cracked = f.wax.getState().cracked;
    f.shellTick(.1); assert.equal(f.wax.getState().cracked, cracked);
    for (let i = 0; i < 180; i++) f.shellTick(1 / 30);
    assert.equal(f.wax.getState().living, 0); assert.equal(f.wax.getState().expired, burst.detached);
    f.wax.reset(); assert.equal(f.wax.getState().detached, 0);
  } finally { f.dispose(); }
});

test('deep press, drag, repeated press, rotation and recovery preserve clay and complete thick fragment clearance', async t => {
  const f = await fixture();
  const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
  const tree = createWaxCollisionTree(f.geometry);
  let samples = 0, frames = 0, minimum = Infinity, detachedSeen = false;
  function verify() {
    tree.refit(); const snapshot = f.wax.getSurfaceSnapshot(), point = new f.THREE.Vector3();
    const check = (x, y, z) => { const d = tree.signedDistance(point.set(x, y, z)); minimum = Math.min(minimum, d); assert.ok(d >= -1e-5, `Whole volume clearance ${d} at frame ${frames}`); samples++; };
    // Includes outer faces/edges and sidewalls, beyond default metrics' inner checks.
    for (let i = 0; i < snapshot.indices.length; i += 3) {
      const ids = Array.from(snapshot.indices.slice(i, i + 3));
      if (ids.every(r => snapshot.positions[r * 3] === 0 && snapshot.positions[r * 3 + 1] === 0 && snapshot.positions[r * 3 + 2] === 0)) continue;
      for (const r of ids) check(...snapshot.positions.slice(r * 3, r * 3 + 3));
      for (let k = 0; k < 3; k++) { const a = ids[k], b = ids[(k + 1) % 3]; check(...[0, 1, 2].map(c => (snapshot.positions[a * 3 + c] + snapshot.positions[b * 3 + c]) / 2)); }
      check(...[0, 1, 2].map(c => ids.reduce((s, r) => s + snapshot.positions[r * 3 + c], 0) / 3));
    }
    localThickness(snapshot, .042);
    assert.deepEqual(f.geometry.attributes.position.array, f.baselinePositions, 'Shell must not change approved clay deformation');
    const metrics = f.wax.getMetrics({ exhaustive: true });
    assert.equal(metrics.attachedViolations, 0); assert.equal(metrics.detachedViolations, 0);
    assert.ok(metrics.maxThicknessError < 1e-5); detachedSeen ||= f.wax.getState().detached > 0;
  }
  function run(count) { for (let i = 0; i < count; i++) { f.tick(); frames++; if (frames % 12 === 0 || frames >= 29 && frames <= 34) verify(); } }
  try {
    f.begin(); run(72);
    const p = [.3, .12, Math.sqrt(.9 ** 2 - .3 ** 2 - .12 ** 2)];
    f.deformation.move(p, .35); f.baseline.move(p, .35); f.wax.move(p); run(40);
    f.wax.setWorldMatrix(new f.THREE.Matrix4().makeRotationFromEuler(new f.THREE.Euler(.4, .6, .7))); run(24);
    f.end(); run(36); f.begin(p); run(40); f.end(); run(36);
    assert.ok(detachedSeen); assert.ok(samples > 100000);
    t.diagnostic(JSON.stringify({ frames, samples, minimumSignedDistance: minimum, detached: f.wax.getState().detached }));
  } finally { f.dispose(); }
});
