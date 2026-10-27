const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

async function fixture({ reducedMotion = false } = {}) {
  const THREE = await import('three');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const mesh = readMesh('./assets/models/squishy-orb.glb'), rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setIndex(mesh.indices);
  const positions = geometry.attributes.position.array, barePositions = rest.slice();
  const feel = getOrbFeel('marshmallow'), core = feel.createDeformation(positions, normals.slice(), { reducedMotion }), bare = feel.createDeformation(barePositions, normals.slice(), { reducedMotion });
  let seconds = 0;
  const wax = getWaxPreset('thin-wax').create({ geometry, restPositions: rest, restNormals: normals, color: '#f8dcac', clock: () => seconds, reducedMotion });
  function same() { assert.deepEqual(positions, barePositions, 'The shell must never alter any core vertex'); assert.deepEqual(core.getState(), bare.getState()); }
  function act(method, ...args) { core[method](...args); bare[method](...args); same(); }
  function frame(dt = 1 / 60) {
    assert.deepEqual(core.step(dt), bare.step(dt)); same(); geometry.computeVertexNormals();
    seconds += dt; const result = wax.step(dt); if (!result.changed) wax.sync(); same(); return result;
  }
  const frames = count => { for (let i = 0; i < count; i++) frame(); };
  function contact(x = 0, y = .0175) {
    let closest = -1, distance = Infinity;
    for (let i = 0; i < rest.length; i += 3) if (normals[i + 2] > .25) { const d = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2; if (d < distance) { distance = d; closest = i; } }
    return Array.from(rest.slice(closest, closest + 3));
  }
  function begin(point = contact()) { act('begin', point); wax.begin(point); }
  function release() { act('release'); wax.end(); }
  function inspect(t, label) {
    const metrics = wax.getMetrics({ exhaustive: true });
    t.diagnostic(JSON.stringify({ label, core: core.getState(), shell: wax.getState(), geometry: metrics }));
    assert.equal(metrics.thickness, .014); assert.equal(metrics.gap, .004); assert.ok(metrics.maxThicknessError < 1e-5);
    assert.equal(metrics.attachedViolations, 0, `${label}: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.detachedViolations, 0, `${label}: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.attachedSurfaceSamples > 10000 && metrics.wallSamples > 1000, 'Inspect actual faces, edge interiors and volumetric fracture walls');
    return metrics;
  }
  return { rest, positions, barePositions, geometry, core, bare, wax, contact, act, frame, frames, begin, release, inspect, dispose() { wax.dispose(); geometry.dispose(); } };
}

for (const reducedMotion of [false, true]) test(`orb marshmallow + preset thin wax keeps the exact gradual 2-second core trajectory, fracture clock and frozen unload (${reducedMotion ? 'reduced' : 'normal'} motion)`, async t => {
  const f = await fixture({ reducedMotion }); f.begin();
  f.frames(29); assert.equal(f.wax.getState().detached, 0); assert.ok(f.wax.getState().cracked > 0);
  f.frames(3); assert.ok(f.wax.getState().detached > 0, 'The current wax preset starts breaking after 0.5 actual seconds');
  f.frames(88); const twoSecond = f.core.getState().depth;
  assert.ok(twoSecond > .30 && twoSecond < .43, `Confirmed gradual single-press depth at 2 seconds: ${twoSecond}`);
  const loaded = f.inspect(t, '2-second progressive collapse'); assert.ok(loaded.detachedInteriorSamples > 0);
  f.frames(60); assert.ok(f.core.getState().depth >= twoSecond && f.core.getState().depth < .43, 'Single press approaches its existing target, not the .70 safety limit');
  f.release(); const held = f.positions.slice(), damage = f.wax.getState().detached;
  f.frames(90); assert.deepEqual(f.positions, held, 'Release preserves 100% of marshmallow deformation');
  assert.equal(f.wax.getState().detached, damage, 'Release cannot cause new shell damage');
  f.inspect(t, 'frozen release with independent gravity');
  f.act('cancel'); f.frames(2); assert.deepEqual(f.positions, held, 'Cancellation also keeps every core coordinate');
  f.dispose();
});

test('orb marshmallow shallow sliding, repeated broken-rim presses and explicit restoration retain core and shell independence', async t => {
  const f = await fixture(), start = f.contact(-.55), end = f.contact(.55);
  f.begin(start);
  for (let i = 1; i <= 12; i++) { const p = f.contact(-.55 + 1.1 * i / 12); f.act('move', p, i / 12); f.wax.move(p); f.frame(); }
  f.release(); const shallow = f.positions.slice();
  assert.ok(f.core.getState().depth > .01 && f.core.getState().depth < .12, `Existing shallow trail depth ${f.core.getState().depth}`);
  f.frames(30); assert.deepEqual(f.positions, shallow, 'Departed shallow traces freeze without shell-driven relaxation');
  f.inspect(t, 'released shallow swept trail');
  for (const point of [end, f.contact(.38, .08), end]) {
    f.begin(point); f.frames(150); f.inspect(t, 'repeated press on an existing broken rim');
    assert.ok(f.core.getState().depth <= .700001); f.release(); f.frames(8);
  }
  assert.ok(f.core.getState().depth > .50, 'Repeated deliberate presses retain the confirmed deeper marshmallow behavior');
  const damaged = f.wax.getState().detached, cracked = f.wax.getState().cracked;
  f.act('beginRestore');
  for (let i = 0; i <= 30; i++) {
    f.act('applyRestore', i / 30); f.frame();
    if (i % 10 === 0) f.inspect(t, `explicit restore ${i}/30`);
  }
  assert.deepEqual(f.positions, f.rest, 'Explicit restore reaches the exact original real GLB positions');
  assert.equal(f.wax.getState().detached, damaged); assert.equal(f.wax.getState().cracked, cracked, 'Growing core cannot regrow broken shell');
  const restored = f.wax.getMetrics({ exhaustive: true }); assert.ok(restored.attachedMinGap > .00399); assert.equal(restored.attachedViolations, 0);
  f.dispose();
});
