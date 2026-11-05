const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture(preset, color, rotation, options = {}) {
  const THREE = await import('three');
  const geometry = new THREE.SphereGeometry(.9, 24, 16);
  const restPositions = geometry.attributes.position.array.slice();
  const restNormals = geometry.attributes.normal.array.slice();
  let now = 0;
  const wax = preset.create({ geometry, restPositions, restNormals, color,
    clock: () => now, worldMatrix: rotation, ...options });
  return { wax, geometry, restPositions, restNormals,
    advance(seconds) { now += seconds; wax.step(seconds); },
    dispose() { wax.dispose(); geometry.dispose(); } };
}

test('thin-wax registry is immutable, rejects unknown ids and reuses verified parameters', async () => {
  const { getWaxPreset, waxPresets } = await import('../src/wax-presets.mjs');
  const { thinWaxParameters } = await import('../src/thin-wax.mjs');
  const preset = getWaxPreset();
  assert.ok(Object.isFrozen(waxPresets)); assert.ok(Object.isFrozen(preset));
  assert.deepEqual(Object.keys(waxPresets), ['thin-wax', 'thick-wax']);
  assert.equal(preset, getWaxPreset('thin-wax'));
  assert.equal(preset.id, 'thin-wax'); assert.equal(preset.material, 'wax'); assert.equal(preset.thickness, 'thin');
  assert.equal(preset.parameters, thinWaxParameters);
  assert.ok(Object.isFrozen(preset.parameters));
  for (const id of ['unknown', 'medium-wax', '__proto__', 'constructor', null]) assert.throws(() => getWaxPreset(id), RangeError);
  assert.equal(Object.hasOwn(preset, 'feelId'), false);
  assert.equal(Object.hasOwn(preset, 'styleId'), false);
});

test('preset defaults to falling cleanup with permanent holes; collection requires explicit opt-in', async () => {
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const preset = getWaxPreset();
  for (const enabled of [false, true]) {
    const f = await fixture(preset, '#eed3af', undefined, enabled ? { collectionEnabled: true } : {});
    try {
      assert.equal(f.wax.getState().collectionEnabled, enabled);
      f.wax.begin([0, 0, .9]); f.advance(preset.parameters.dwell + .001); f.wax.end();
      const broken = f.wax.getState(); assert.ok(broken.detached > 0);
      const afterBreak = f.wax.getSurfaceSnapshot();
      const brokenPanelIds = new Set(Array.from(afterBreak.panelIds).filter((id, i) => afterBreak.detached[i]));
      for (let i = 0; i < 270; i++) f.advance(1 / 30);
      const afterFall = f.wax.getState();
      assert.equal(afterFall.detached, broken.detached, 'Cleanup never repairs the detached plate count');
      assert.equal(afterFall.living, 0);
      if (enabled) {
        assert.equal(afterFall.expired, 0);
        assert.equal(afterFall.settled, broken.detached);
        assert.ok(afterFall.debris.gridCells > 0);
      } else {
        assert.equal(afterFall.settled, 0);
        assert.equal(afterFall.debris.gridCells, 0);
        assert.equal(afterFall.debris.settled, 0);
        assert.equal(afterFall.expired, broken.detached);
        const snapshot = f.wax.getSurfaceSnapshot();
        for (let i = 0; i < snapshot.panelIds.length; i++) if (brokenPanelIds.has(snapshot.panelIds[i])) {
          assert.equal(snapshot.damage[i], 1, 'Expired fragments leave damage intact');
          for (let k = 0; k < 3; k++) assert.equal(snapshot.positions[i * 3 + k], 0, 'Expired plate stays absent instead of regrowing');
        }
      }
    } finally { f.dispose(); }
  }
});

test('preset instances isolate geometry, color, clock, damage, reset and disposal', async () => {
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const preset = getWaxPreset(), a = await fixture(preset, '#ffccaa'), b = await fixture(preset, '#99aaff');
  try {
    assert.notEqual(a.wax.group, b.wax.group);
    assert.notEqual(a.wax.group.children[0].geometry, b.wax.group.children[0].geometry);
    assert.notEqual(a.wax.group.children[0].material, b.wax.group.children[0].material);
    assert.equal(a.wax.group.children[0].material.color.getHexString(), 'ffccaa');
    assert.equal(b.wax.group.children[0].material.color.getHexString(), '99aaff');
    a.wax.begin([0, 0, .9]); b.wax.begin([0, 0, .9]);
    a.advance(preset.parameters.dwell + .001); b.advance(preset.parameters.dwell / 2);
    assert.ok(a.wax.getState().detached > 0);
    assert.equal(b.wax.getState().detached, 0, 'Independent clock must not inherit another contact age');
    a.wax.end(); b.wax.end();
    assert.deepEqual(a.geometry.attributes.position.array, a.restPositions, 'Shell damage never deforms its core');
    assert.deepEqual(a.geometry.attributes.normal.array, a.restNormals);
    a.wax.reset(); assert.equal(a.wax.getState().detached, 0);
    a.wax.dispose(); assert.equal(a.wax.getState().disposed, true);
    assert.equal(b.wax.getState().disposed, false);
    b.wax.begin([0, 0, .9]); b.advance(preset.parameters.dwell + .001);
    assert.ok(b.wax.getState().detached > 0, 'Other instance remains usable after disposal');
  } finally { a.dispose(); b.dispose(); }
});

test('preset accepts initial world matrix without moving caller-owned rest data', async () => {
  const { Matrix4 } = await import('three');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const matrix = new Matrix4().makeRotationZ(Math.PI / 2), savedMatrix = matrix.clone();
  const f = await fixture(getWaxPreset(), '#ffeeaa', matrix);
  try {
    const snapshot = f.wax.getSurfaceSnapshot();
    for (let i = 0; i < snapshot.positions.length; i += 3) {
      assert.ok(Math.abs(snapshot.worldPositions[i] + snapshot.positions[i + 1]) < 1e-6);
      assert.ok(Math.abs(snapshot.worldPositions[i + 1] - snapshot.positions[i]) < 1e-6);
      assert.ok(Math.abs(snapshot.worldPositions[i + 2] - snapshot.positions[i + 2]) < 1e-6);
    }
    assert.equal(matrix.equals(savedMatrix), true);
    assert.deepEqual(f.geometry.attributes.position.array, f.restPositions);
  } finally { f.dispose(); }
});
