const { test } = require('node:test');
const assert = require('node:assert/strict');
const { modelAttribute } = require('./helpers/orb-probe.cjs');
test('immutable ready-to-use presets compose separate material and deformation instances', async () => {
  const { getOrbPreset, orbPresets } = await import('../src/orb-presets.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { MeshStandardMaterial } = await import('three');
  assert.ok(Object.isFrozen(orbPresets));
  assert.equal(getOrbPreset().id, 'clay');
  assert.throws(() => getOrbPreset('unknown'), RangeError);
  for (const id of ['clay', 'marshmallow', 'slow-rebound']) {
    const preset = getOrbPreset(id);
    assert.ok(Object.isFrozen(preset));
    assert.equal(preset.feelId, id);
    assert.equal(preset.createDeformation, getOrbFeel(id).createDeformation);
    assert.equal(preset.appearanceId, id === 'slow-rebound' ? 'full-matte' : 'matte');
    const source = new MeshStandardMaterial(), a = preset.createMaterial(source), b = preset.createMaterial(source);
    a.color.set('red'); assert.equal(b.color.getHex(), 0xffffff); assert.equal(source.color.getHex(), 0xffffff);
    if (id === 'marshmallow') { assert.equal(b.sheen, .8); assert.equal(b.roughness, 1); }
    const rest = modelAttribute('POSITION'), positions = rest.slice(), other = rest.slice();
    const d = preset.createDeformation(positions, modelAttribute('NORMAL'));
    const independent = preset.createDeformation(other, modelAttribute('NORMAL'));
    d.begin([0,.0175,1]); d.step(.03);
    assert.notDeepEqual(positions, rest); assert.deepEqual(other, rest);
    assert.equal(independent.getState().active, false);
    a.dispose(); b.dispose(); source.dispose();
  }
});
