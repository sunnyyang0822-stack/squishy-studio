const { test } = require('node:test');
const assert = require('node:assert/strict');
const stateModule = import('../detail/state.mjs');
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(createDetailController) {
  const prepared = [], restored = [];
  const controller = createDetailController({
    renderer: {
      async prepare(config) { prepared.push(config); return { commit() {}, dispose() {} }; },
      restore(options) { restored.push(options); }, stopInput() {}, dispose() {},
    },
    audio: { ready: false, setVolume() {}, dispose() {} },
  });
  return { controller, prepared, restored };
}

test('all registered marshmallow styles share the thin-wax making preview; slow rebound and legacy play remain excluded', async () => {
  const { isThinWaxRecipe, canRestartThinWax, defaultRecipe, styleNames } = await stateModule;
  const recipe = { ...defaultRecipe, coreMaterial: 'marshmallow', waxThickness: 'thin' };
  assert.equal(isThinWaxRecipe(recipe), true);
  for (const step of ['shell', 'decoration']) assert.equal(canRestartThinWax(step, recipe), true);
  for (const step of ['core', 'making', 'play']) assert.equal(canRestartThinWax(step, recipe), false);
  for (const styleId of Object.keys(styleNames)) {
    assert.equal(isThinWaxRecipe({ ...recipe, styleId }), true, styleId);
    assert.equal(canRestartThinWax('shell', { ...recipe, styleId }), true, styleId);
    assert.equal(canRestartThinWax('play', { ...recipe, styleId }), false, styleId);
    assert.equal(isThinWaxRecipe({ ...recipe, styleId, coreMaterial: 'clay' }), true, 'Existing clay scope stays enabled');
    assert.equal(isThinWaxRecipe({ ...recipe, styleId, coreMaterial: 'butter' }), styleId === 'orb', 'Only the locally reviewed slow-rebound orb joins the making preview');
  }
  for (const change of [{ waxThickness: 'medium' }, { waxThickness: 'thick' }, { shellMaterial: 'sugar' }, { shellMaterial: 'polish' }, { styleId: 'unknown' }]) {
    assert.equal(isThinWaxRecipe({ ...recipe, ...change }), false);
  }
  assert.equal(defaultRecipe.waxThickness, 'medium');
});

test('every marshmallow core to shell keeps independent colors, the same feel and recipe, and persistent preview damage', async () => {
  const { createDetailController, styleNames } = await stateModule;
  for (const styleId of Object.keys(styleNames)) {
  const { controller: c, prepared, restored } = harness(createDetailController);
  try {
    await c.load(); await c.select('styleId', styleId); await c.select('coreMaterial', 'marshmallow');
    await c.select('coreColor', 'mint'); await c.select('shellColor', 'sky'); await c.select('waxThickness', 'thin');
    const core = prepared.at(-1);
    assert.equal(core.mode, 'core'); assert.equal(core.color, 'mint');
    assert.equal(core.feelId, 'marshmallow'); assert.equal(core.presetId, 'marshmallow'); assert.equal(core.appearanceId, 'matte');
    c.next(); await settle(); const shell = prepared.at(-1);
    assert.equal(shell.mode, 'shell'); assert.equal(shell.coreColor, 'mint'); assert.equal(shell.shellColor, 'sky');
    assert.equal(shell.waxThickness, 'thin'); assert.equal(shell.shellMaterial, 'wax'); assert.equal(shell.waxCollection, false);
    assert.equal(shell.feelId, core.feelId); assert.equal(shell.recipeKey, core.recipeKey); assert.equal(shell.styleId, styleId);
    const count = prepared.length; c.next(); await settle(); c.previous(); await settle();
    assert.equal(prepared.length, count, 'Shell/decoration navigation must retain the same damage instance');
    assert.deepEqual(restored, []);
    c.restart(); assert.deepEqual(restored, [undefined], 'Explicit preview restart keeps the existing restore contract');
  } finally { c.dispose(); }
  }
});

test('every marshmallow legacy final restores core while preserving hidden shell, and return configures preview without repair', async () => {
  const { createDetailController, canRestartThinWax, styleNames } = await stateModule;
  for (const styleId of Object.keys(styleNames)) {
  const { controller: c, prepared, restored } = harness(createDetailController);
  try {
    await c.load(); await c.select('styleId', styleId); await c.select('coreMaterial', 'marshmallow'); await c.select('waxThickness', 'thin');
    c.setStep('shell'); await settle(); const shell = prepared.at(-1);
    c.setStep('making'); c.setStep('play'); await settle();
    assert.deepEqual(restored, [{ preserveShell: true }]);
    assert.equal(prepared.at(-1).waxCollection, undefined);
    assert.equal(prepared.at(-1).recipeKey, shell.recipeKey, 'Presentation flag is separate from recipe identity');
    assert.equal(canRestartThinWax('play', c.getState().recipe), false);
    c.restart(); assert.equal(restored.length, 1, 'No new final-experience restart action');
    const playCount = prepared.length; c.setStep('shell'); await settle();
    assert.equal(prepared.length, playCount + 1, 'Returning from final presentation must configure the preview');
    assert.equal(prepared.at(-1).waxCollection, false); assert.equal(prepared.at(-1).recipeKey, shell.recipeKey);
    assert.deepEqual(restored, [{ preserveShell: true }], 'Returning must not repair hidden preview damage');
  } finally { c.dispose(); }
  }
});
