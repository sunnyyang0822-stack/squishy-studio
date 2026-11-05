const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

async function fixture(id) {
  const THREE = await import('three');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const data = readMesh('./assets/models/squishy-orb.glb'), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3)); geometry.setIndex(data.indices);
  let now = 0;
  const preset = getWaxPreset(id), wax = preset.create({ geometry, clock: () => now });
  const deformation = getOrbFeel('clay').createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array);
  return { THREE, geometry, wax, preset, deformation,
    advance(dt) { now += dt; wax.step(dt); },
    frame() { deformation.step(1 / 60); geometry.computeVertexNormals(); now += 1 / 60; wax.step(1 / 60); wax.sync(); },
    dispose() { wax.dispose(); geometry.dispose(); } };
}

function areas(snapshot) {
  const regions = new Map(), p = snapshot.restSupportPositions;
  for (let t = 0; t < snapshot.indices.length; t += 3) {
    const ids = Array.from(snapshot.indices.slice(t, t + 3));
    if (!ids.every(i => snapshot.layers[i] === 1)) continue;
    const [a, b, c] = ids.map(i => Array.from(p.slice(i * 3, i * 3 + 3)));
    const u = b.map((x, k) => x - a[k]), v = c.map((x, k) => x - a[k]);
    const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    const id = snapshot.panelIds[ids[0]]; regions.set(id, (regions.get(id) || 0) + area);
  }
  return [...regions.values()].sort((a, b) => a - b);
}

test('medium preset changes only physical thickness and real partition count', async () => {
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const { thinWaxParameters } = await import('../src/thin-wax.mjs');
  const thin = getWaxPreset(), medium = getWaxPreset('medium-wax');
  assert.equal(medium.name, '中蜡·双倍薄蜡厚度');
  assert.equal(thin.parameters, thinWaxParameters);
  assert.deepEqual(thin.parameters, { thickness: .014, gap: .004, dwell: .5, localRadius: .16, chainDuration: .063, visibleDeformation: .004, extraFractureDelay: .06, extraFractureStrain: .015, maxLocalFragments: 180, maxFragments: 180, maxLivingFragments: 24 });
  assert.equal(medium.material, 'wax'); assert.equal(medium.thickness, 'medium');
  assert.ok(Object.isFrozen(medium)); assert.ok(Object.isFrozen(medium.parameters));
  const { thickness, seedCount, ...inherited } = medium.parameters;
  assert.deepEqual(inherited, Object.fromEntries(Object.entries(thin.parameters).filter(([key]) => key !== 'thickness')));
  assert.equal(thickness, thin.parameters.thickness * 2);
  assert.equal(seedCount, 96);
  for (const id of ['cloud','paw','cylinder','donut','pyramid','flower','star']) {
    const p = medium.parametersForStyle(id), geometry = medium.geometryOptionsForStyle(id);
    assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(geometry));
    assert.equal(p.seedCount, id === 'paw' ? 128 : 96); assert.equal(p.partitionSpace, 'surface');
    assert.equal(p.thickness, thickness); assert.equal(p.dwell, thin.parameters.dwell);
    assert.equal(geometry.fullSurfaceSupport, id === 'paw');
    assert.equal(Boolean(geometry.performanceOptimizations), id !== 'paw');
    assert.equal(geometry.detachedQueryHints, true); assert.equal(geometry.supportClusters, true); assert.equal(geometry.featureTieConsensus, true);
  }
  assert.equal(medium.parametersForStyle('orb'), medium.parameters);
  assert.equal(Boolean(medium.geometryOptionsForStyle('orb').performanceOptimizations), false);
});

test('medium mapping supports every registered clay preview and preserves legacy final scope', async () => {
  const { createDetailController, isMediumWaxRecipe, canRestartWax, defaultRecipe, styleNames } = await import('../detail/state.mjs');
  for (const styleId of Object.keys(styleNames)) for (const coreMaterial of ['clay', 'marshmallow', 'butter']) {
    assert.equal(isMediumWaxRecipe({ ...defaultRecipe, styleId, coreMaterial }), styleId !== 'paw');
    assert.equal(canRestartWax('shell', { ...defaultRecipe, styleId, coreMaterial }), styleId !== 'paw');
    assert.equal(canRestartWax('play', { ...defaultRecipe, styleId, coreMaterial }), styleId === 'orb' && coreMaterial === 'clay');
  }
  for (const override of [{ shellMaterial: 'polish' }, { shellMaterial: 'sugar' }, { waxThickness: 'thick' }, { waxThickness: 'thin' }]) assert.equal(isMediumWaxRecipe({ ...defaultRecipe, ...override }), false);
  for (const step of ['shell', 'decoration', 'play']) assert.equal(canRestartWax(step, defaultRecipe), true);
  for (const step of ['core', 'making']) assert.equal(canRestartWax(step, defaultRecipe), false);
  let restores = 0; const prepared = [];
  const controller = createDetailController({ renderer: {
    async prepare(config) { prepared.push(config); return { commit() {}, dispose() {} }; }, restore() { restores++; }, stopInput() {}, dispose() {},
  }, audio: { ready: false, setVolume() {}, dispose() {} } });
  try {
    await controller.load();
    for (const step of ['shell', 'decoration', 'making', 'play']) { controller.setStep(step); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(restores, 0); controller.restart(); assert.equal(restores, 1);
    await controller.select('waxThickness', 'thin'); await controller.select('waxThickness', 'medium');
    assert.equal(prepared.at(-1).waxThickness, 'medium'); assert.equal(prepared.at(-1).coreColor, defaultRecipe.coreColor);
  } finally { controller.dispose(); }
  for (const styleId of Object.keys(styleNames)) {
    let calls = []; const configurations = [];
    const c = createDetailController({ styleId, step: 'shell', renderer: {
      async prepare(config) { configurations.push(config); return { commit() {}, dispose() {} }; },
      restore(options) { calls.push(options); }, stopInput() {}, dispose() {},
    }, audio: { ready: false, setVolume() {}, dispose() {} } });
    try {
      await c.load(); c.restart(); assert.equal(calls.length, 1);
      calls = [];
      for (const step of ['decoration', 'making', 'play']) { c.setStep(step); await new Promise(resolve => setImmediate(resolve)); }
      assert.deepEqual(calls, styleId === 'orb' ? [] : [{ preserveShell: true }]);
      c.setStep('shell'); await new Promise(resolve => setImmediate(resolve));
      assert.equal(configurations.at(-1).styleId, styleId); assert.equal(configurations.at(-1).waxThickness, 'medium');
      assert.equal(configurations.at(-1).waxCollection, false);
      await c.select('waxThickness', 'thin'); await c.select('waxThickness', 'medium');
      assert.equal(configurations.at(-1).waxThickness, 'medium');
    } finally { c.dispose(); }
  }
});

test('actual orb triangles have larger irregular regions and modestly thicker solid walls', async () => {
  const thin = await fixture('thin-wax'), medium = await fixture('medium-wax');
  try {
    const values = [thin, medium].map(f => {
      const a = areas(f.wax.getSurfaceSnapshot()), total = a.reduce((s, x) => s + x, 0), m = f.wax.getMetrics({ exhaustive: true });
      assert.ok(m.maxThicknessError < m.tolerance); assert.equal(m.attachedViolations, 0);
      assert.ok(Math.abs(m.attachedMinGap - .004) < m.tolerance); assert.ok(m.panelAreaCV > .35);
      assert.equal(m.patches, a.length);
      return { thickness: m.thickness, count: a.length, total, mean: total / a.length, median: (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2, min: a[0], max: a.at(-1), cv: m.panelAreaCV, thicknessError: m.maxThicknessError };
    });
    assert.equal(values[0].count, 180); assert.equal(values[1].count, 96);
    assert.ok(Math.abs(values[0].total - values[1].total) < 1e-6, 'Same covered source surface');
    assert.ok(values[1].mean > values[0].mean * 1.3); assert.ok(values[1].median > values[0].median * 1.2);
    console.log(JSON.stringify({ orbGeometryComparison: values, thicknessRatio: values[1].thickness / values[0].thickness, meanAreaRatio: values[1].mean / values[0].mean, medianAreaRatio: values[1].median / values[0].median }));
  } finally { thin.dispose(); medium.dispose(); }
});

test('medium timing, rigid detached shape, persistent damage and cleanup reuse thin contract', async () => {
  const f = await fixture('medium-wax'), other = await fixture('thin-wax');
  try {
    f.wax.begin([0, 0, .9]);
    f.advance(.5); assert.equal(f.wax.getState().detached, 0);
    const before = f.wax.getSurfaceSnapshot();
    f.advance(.001); assert.equal(f.wax.getState().detached, 3);
    const broken = f.wax.getSurfaceSnapshot(), groups = new Map();
    for (let i = 0; i < broken.layers.length; i++) if (broken.detached[i] && broken.layers[i] === 1) {
      const group = groups.get(broken.panelIds[i]) || []; group.push(i); groups.set(broken.panelIds[i], group);
    }
    const distance = (p, a, b) => Math.hypot(...[0, 1, 2].map(k => p[a * 3 + k] - p[b * 3 + k]));
    for (const group of groups.values()) for (const i of group) {
      assert.ok(Math.abs(distance(before.positions, group[0], i) - distance(broken.positions, group[0], i)) < 1e-5, 'Detached body retains original hole boundary lengths');
    }
    f.advance(1); assert.equal(f.wax.getState().detached, 3, 'Elapsed time alone never strips the shell');
    f.wax.end(); for (let i = 0; i < 270; i++) f.advance(1 / 30);
    assert.equal(f.wax.getState().expired, 3); assert.equal(f.wax.getState().detached, 3);
    assert.equal(f.wax.getState().living, 0); assert.equal(other.wax.getState().detached, 0);
    f.wax.reset(); assert.equal(f.wax.getState().detached, 0);
    let geometryDisposals = 0, materialDisposals = 0;
    f.wax.group.children[0].geometry.addEventListener('dispose', () => geometryDisposals++);
    f.wax.group.children[0].material.addEventListener('dispose', () => materialDisposals++);
    f.wax.dispose(); f.wax.dispose(); assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1);
    assert.equal(other.wax.getState().disposed, false);
  } finally { f.dispose(); other.dispose(); }
});

for (const rotation of [[0, 0, 0], [0, 0, Math.PI / 2], [Math.PI / 2, .55, -.4]]) test(`medium full fragment edges and walls stay outside deformed clay: ${rotation}`, async () => {
  const f = await fixture('medium-wax'); let detachedSamples = 0;
  try {
    f.wax.setWorldMatrix(new f.THREE.Matrix4().makeRotationFromEuler(new f.THREE.Euler(...rotation)));
    for (const [x, y] of [[0, 0], [.2, .04], [-.24, -.12]]) {
      const point = [x, y, Math.sqrt(.9 ** 2 - x * x - y * y)];
      f.deformation.begin(point); f.wax.begin(point);
      for (let i = 0; i < 145; i++) {
        f.frame();
        if (i % 15 === 0 || i === 144) {
          const m = f.wax.getMetrics({ exhaustive: true });
          assert.equal(m.attachedViolations, 0, JSON.stringify(m)); assert.equal(m.detachedViolations, 0, JSON.stringify(m));
          assert.ok(m.maxThicknessError < m.tolerance); assert.ok(m.wallSamples > 0);
          detachedSamples += m.detachedInteriorSamples;
        }
      }
      f.wax.move([-.1, .15, .88]); f.deformation.move([-.1, .15, .88], .5);
      for (let i = 0; i < 6; i++) f.frame();
      const moved = f.wax.getMetrics({ exhaustive: true }); assert.equal(moved.attachedViolations, 0); assert.equal(moved.detachedViolations, 0);
      f.wax.end(); f.deformation.release();
      for (let i = 0; i < 30; i++) f.frame();
    }
    assert.ok(detachedSamples > 0); assert.ok(f.wax.getState().detached > 0);
    const final = f.wax.getMetrics({ exhaustive: true }); assert.equal(final.attachedViolations, 0); assert.equal(final.detachedViolations, 0);
  } finally { f.dispose(); }
});
