const { test } = require('node:test');
const assert = require('node:assert/strict');

test('finished contract preserves every real recipe: 63 wax and 21 polish, never paw or sugar', async () => {
  const { finishedStyles, finishedConfig, supportsFinishedRecipe } = await import('../src/finished-recipe.mjs');
  assert.equal(finishedStyles.length, 7);
  let count = 0;
  for (const styleId of finishedStyles) for (const coreMaterial of ['clay', 'marshmallow', 'butter']) for (const waxThickness of ['thin', 'medium', 'thick', null]) {
    const recipe = { styleId, coreMaterial, coreColor: 'mint', shellColor: 'rose', waxThickness, shellMaterial: waxThickness ? 'wax' : 'polish' };
    assert.ok(supportsFinishedRecipe(recipe));
    const config = finishedConfig(recipe);
    assert.deepEqual(config.recipe, recipe); assert.equal(config.mode, 'finished'); assert.equal(config.waxCollection, false);
    assert.equal(config.feelId, coreMaterial === 'butter' ? 'slow-rebound' : coreMaterial);
    assert.equal(config.appearanceId, coreMaterial === 'butter' ? 'full-matte' : 'matte');
    assert.equal(config.recipeKey, finishedConfig(Object.fromEntries(Object.entries(recipe).reverse())).recipeKey);
    for (const change of [{ styleId: 'paw' }, { styleId: 'unknown' }, { shellMaterial: 'sugar' }, { coreMaterial: 'unknown' }, { coreColor: 'no-color' }, { shellColor: 'no-color' }]) {
      assert.equal(supportsFinishedRecipe({ ...recipe, ...change }), false);
      assert.throws(() => finishedConfig({ ...recipe, ...change }), { code: 'UNSUPPORTED_RECIPE' });
    }
    count++;
  }
  assert.equal(count, 84);
});

test('events follow real vertex and shell changes; stationary holds and marshmallow release invent no motion', async () => {
  const { createSceneEvents } = await import('../src/scene-events.mjs');
  const rest = Float32Array.of(0, 0, 1), positions = rest.slice(), events = [];
  const observer = createSceneEvents(rest, event => events.push(event));
  const shell = { cracked: 0, detached: 0, panels: 10 };
  observer.configure({ recipeKey: 'one', feelId: 'marshmallow' }, positions, { ...shell });
  const frame = { elapsed: .1, active: true, restoring: false, time: 1 };
  observer.sample(positions, { ...shell }, frame); assert.equal(events.length, 0);
  positions[2] = .8; shell.cracked = 1;
  observer.sample(positions, { ...shell }, frame);
  assert.deepEqual(events.map(e => e.type), ['shell-crack', 'core-deform']);
  assert.ok(events[1].speed > 1.9 && events[1].speed < 2.1);
  observer.sample(positions, { ...shell }, frame);
  assert.equal(events.at(-1).type, 'core-motion-end');
  const stationaryCount = events.length;
  observer.sample(positions, { ...shell }, { ...frame, active: false }); assert.equal(events.length, stationaryCount);
  shell.detached = 1; observer.sample(positions, { ...shell }, frame);
  assert.equal(events.at(-1).type, 'shell-fracture'); assert.equal(events.at(-1).exposure, .1);
  positions[2] = .9; observer.sample(positions, { ...shell }, { ...frame, active: false });
  assert.equal(events.at(-1).type, 'core-recover');
  observer.dispose(); observer.sample(rest, { ...shell, cracked: 10 }, frame); assert.equal(events.at(-1).type, 'core-recover');
  assert.equal(new Set(events.map(e => e.sequence)).size, events.length);
});
