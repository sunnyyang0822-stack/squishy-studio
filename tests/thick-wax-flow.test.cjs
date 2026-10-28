const { test } = require('node:test');
const assert = require('node:assert/strict');
const state = import('../detail/state.mjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
const audio = () => ({ ready: false, setVolume() {}, dispose() {} });

test('thick wax excludes paw and keeps non-orb final play independent; thin predicates, default and other recipes remain independent', async () => {
  const { defaultRecipe, styleNames, isThickWaxRecipe, isThinWaxRecipe, canRestartThinWax, canRestartWax } = await state;
  assert.equal(defaultRecipe.waxThickness, 'medium');
  for (const styleId of [...Object.keys(styleNames), 'unknown']) {
    for (const coreMaterial of ['clay', 'marshmallow', 'butter']) {
      for (const shellMaterial of ['wax', 'polish', 'sugar']) {
        for (const waxThickness of ['thin', 'medium', 'thick']) {
          const recipe = { ...defaultRecipe, styleId, coreMaterial, shellMaterial, waxThickness };
          const thick = ['orb', 'cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star'].includes(styleId) && coreMaterial === 'clay' && shellMaterial === 'wax' && waxThickness === 'thick';
          assert.equal(isThickWaxRecipe(recipe), thick, JSON.stringify(recipe));
          if (waxThickness === 'thick') {
            assert.equal(isThinWaxRecipe(recipe), false);
            assert.equal(canRestartThinWax('shell', recipe), false);
          }
          for (const step of ['core', 'shell', 'decoration', 'making', 'play', 'unknown']) {
            assert.equal(canRestartWax(step, recipe), canRestartThinWax(step, recipe) || thick && (['shell', 'decoration'].includes(step) || step === 'play' && styleId === 'orb'));
          }
        }
      }
    }
  }
});

test('clay orb thick-wax navigation preserves damage and colors through final play; explicit restart restores once', async () => {
  const { createDetailController } = await state;
  const prepared = [], restored = [], disposed = [];
  const controller = createDetailController({ audio: audio(), recipe: { waxThickness: 'thick', coreColor: 'mint', shellColor: 'sky' },
    renderer: {
      async prepare(config) { prepared.push(config); return { commit() {}, dispose() { disposed.push(config); } }; },
      restore(options) { restored.push(options); }, stopInput() {}, dispose() {},
    },
  });
  try {
    await controller.load();
    controller.restart(); assert.equal(restored.length, 0, 'No restart in bare-core step');
    controller.setStep('shell'); await settle();
    const shell = prepared.at(-1);
    assert.equal(shell.styleId, 'orb'); assert.equal(shell.feelId, 'clay'); assert.equal(shell.appearanceId, 'matte');
    assert.equal(shell.shellMaterial, 'wax'); assert.equal(shell.waxThickness, 'thick');
    assert.equal(shell.coreColor, 'mint'); assert.equal(shell.shellColor, 'sky'); assert.equal(shell.waxCollection, false);
    const before = controller.getState();
    controller.restart(); assert.deepEqual(restored, [undefined]); assert.deepEqual(controller.getState(), before);
    controller.setStep('decoration'); await settle();
    const count = prepared.length;
    controller.setStep('shell'); await settle();
    assert.equal(prepared.length, count, 'Same-mode navigation must not rebuild or repair');
    controller.setStep('making'); controller.setStep('play'); await settle();
    assert.deepEqual(restored, [undefined], 'Entering final play retains the damaged clay orb shell');
    assert.equal(prepared.at(-1).recipeKey, shell.recipeKey); assert.equal(prepared.at(-1).waxCollection, undefined);
    controller.setStep('shell'); await settle();
    assert.equal(prepared.at(-1).recipeKey, shell.recipeKey); assert.equal(prepared.at(-1).waxCollection, false);
    await controller.select('shellColor', 'lemon');
    assert.notEqual(prepared.at(-1).recipeKey, shell.recipeKey); assert.equal(prepared.at(-1).coreColor, 'mint');
    await controller.select('waxThickness', 'thin'); const thinKey = prepared.at(-1).recipeKey;
    await controller.select('waxThickness', 'thick');
    assert.notEqual(prepared.at(-1).recipeKey, thinKey, 'Changing preset must produce a fresh recipe identity');
    assert.ok(disposed.length > 0, 'Superseded renderer handles are released');
    controller.rendererUnavailable(); controller.restart(); assert.equal(restored.length, 1);
  } finally { controller.dispose(); }
});

test('rapid thin/thick/thin selection commits the latest recipe and disposes stale or late handles', async () => {
  const { createDetailController } = await state;
  const pending = [], committed = [], released = [], restored = [];
  const controller = createDetailController({ audio: audio(), step: 'shell', recipe: { waxThickness: 'thin' }, renderer: {
    prepare(config, { signal }) {
      return new Promise((resolve, reject) => pending.push({ config, signal, reject, resolve: () => resolve({
        commit() { committed.push(config.waxThickness); }, dispose() { released.push(config.waxThickness); },
      }) }));
    }, restore() { restored.push(true); }, dispose() {},
  } });
  const initial = controller.load(); pending[0].resolve(); await initial;
  const thick = controller.select('waxThickness', 'thick');
  controller.restart(); assert.equal(restored.length, 0, 'Cannot restart the old instance during a preset update');
  const thin = controller.select('waxThickness', 'thin');
  assert.equal(pending[1].signal.aborted, true);
  pending[2].resolve(); await thin; pending[1].resolve(); await thick;
  assert.deepEqual(committed, ['thin', 'thin']); assert.deepEqual(released, ['thin', 'thick']);
  assert.equal(controller.getState().recipe.waxThickness, 'thin');
  const late = controller.select('waxThickness', 'thick');
  controller.dispose(); assert.equal(pending[3].signal.aborted, true);
  pending[3].resolve(); await late;
  assert.deepEqual(committed, ['thin', 'thin']); assert.deepEqual(released, ['thin', 'thick', 'thin', 'thick']);
});

test('non-orb clay thick wax stays a making preview; final core restore preserves hidden shell damage', async () => {
  const { createDetailController } = await state;
  for (const styleId of ['cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star']) {
    const prepared = [], restored = [];
    const controller = createDetailController({ styleId, recipe: { waxThickness: 'thick', coreColor: 'mint', shellColor: 'sky' }, audio: audio(), renderer: {
      async prepare(config) { prepared.push(config); return { commit() {}, dispose() {} }; },
      restore(options) { restored.push(options); }, stopInput() {}, dispose() {},
    } });
    try {
      await controller.load(); controller.setStep('shell'); await settle();
      const key = prepared.at(-1).recipeKey;
      controller.setStep('decoration'); await settle();
      controller.setStep('making'); controller.setStep('play'); await settle();
      assert.deepEqual(restored, [{ preserveShell: true }], styleId);
      const finalCount = prepared.length;
      controller.restart(); assert.equal(prepared.length, finalCount); assert.equal(restored.length, 1);
      controller.setStep('shell'); await settle();
      assert.equal(prepared.at(-1).recipeKey, key); assert.equal(prepared.at(-1).waxCollection, false);
      controller.restart(); assert.deepEqual(restored, [{ preserveShell: true }, undefined]);
    } finally { controller.dispose(); }
  }
});
