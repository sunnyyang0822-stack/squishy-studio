const { test } = require('node:test');
const assert = require('node:assert/strict');
const state = import('../detail/state.mjs');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function harness(overrides = {}) {
  const { createDetailController } = await state;
  const prepared = [], committed = [], released = [], restored = [];
  let stopped = 0;
  const controller = createDetailController({
    recipe: { shellMaterial: 'polish', coreColor: 'mint', shellColor: 'rose' },
    renderer: {
      async prepare(config) {
        prepared.push(config);
        return { commit() { committed.push(config); }, dispose() { released.push(config); } };
      },
      restore(options) { restored.push(options); }, stopInput() { stopped++; }, dispose() {},
    },
    audio: { ready: false, setVolume() {}, dispose() {} },
    ...overrides,
  });
  return { controller, prepared, committed, released, restored, get stopped() { return stopped; } };
}

test('polish maps all non-paw styles and their three cores to the same independent shell; wax thickness has no effect', async () => {
  const { defaultRecipe, isPolishRecipe, previewFor, recipeKeyFor, canRestartShell, canRestartThinWax, styleNames } = await state;
  const recipe = { ...defaultRecipe, shellMaterial: 'polish', coreColor: 'mint', shellColor: 'sky' };
  for (const step of ['core', 'shell', 'decoration', 'making', 'play']) {
    const config = previewFor(step, recipe);
    assert.equal(config.shellPresetId, 'polish-shell');
    assert.equal(config.shellSupported, true);
    assert.equal(config.feelId, 'clay');
    assert.equal(config.appearanceId, 'matte');
    assert.equal(config.coreColor, 'mint'); assert.equal(config.shellColor, 'sky');
    assert.equal(config.mode, step === 'core' ? 'core' : step === 'making' ? 'hidden' : 'shell');
    assert.equal(config.color, step === 'core' ? 'mint' : 'sky');
    assert.equal(config.waxThickness, null);
    assert.equal(config.waxCollection, false, 'Polish never requests a debris collection stage');
    assert.equal(config.recipeKey, recipeKeyFor(recipe));
    assert.equal(canRestartShell(step, recipe), ['shell', 'decoration', 'play'].includes(step));
    assert.equal(canRestartThinWax(step, recipe), false, 'The wax contract remains wax-only');
  }
  for (const waxThickness of ['thin', 'medium', 'thick']) {
    assert.equal(recipeKeyFor({ ...recipe, waxThickness }), recipeKeyFor(recipe));
  }
  for (const styleId of Object.keys(styleNames)) for (const coreMaterial of ['clay', 'marshmallow', 'butter']) {
    const candidate = { ...recipe, styleId, coreMaterial }, supported = styleId !== 'paw';
    assert.equal(isPolishRecipe(candidate), supported);
    if (supported) {
      for (const step of ['core', 'shell', 'decoration', 'making', 'play']) {
        const config = previewFor(step, candidate);
        assert.equal(config.shellPresetId, 'polish-shell'); assert.equal(config.shellSupported, true);
        assert.equal(config.feelId, coreMaterial === 'butter' ? 'slow-rebound' : coreMaterial);
        assert.equal(config.appearanceId, coreMaterial === 'butter' ? 'full-matte' : 'matte');
        assert.equal(config.mode, step === 'core' ? 'core' : step === 'making' ? 'hidden' : 'shell');
        assert.equal(config.waxThickness, null); assert.equal(config.waxCollection, false);
        assert.equal(canRestartShell(step, candidate), ['shell', 'decoration', 'play'].includes(step));
      }
    } else {
      const config = previewFor('shell', candidate);
      assert.equal(config.shellSupported, false); assert.equal(config.shellPresetId, null);
      assert.equal(config.mode, 'core'); assert.equal(config.color, 'mint');
      assert.equal(canRestartShell('shell', candidate), false);
    }
  }
});

for (const styleId of ['orb', 'cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star']) for (const coreMaterial of ['clay', 'marshmallow', 'butter']) test(`same ${styleId}/${coreMaterial} polish recipe preserves damage through every step; explicit restart is separate`, async () => {
  const h = await harness({ recipe: { styleId, coreMaterial, shellMaterial: 'polish', coreColor: 'mint', shellColor: 'rose' } }), c = h.controller;
  try {
    await c.load();
    c.restart(); assert.deepEqual(h.restored, [], 'Bare-core trial does not repair a hidden shell');
    c.setStep('shell'); await settle();
    const key = h.prepared.at(-1).recipeKey, count = h.prepared.length;
    for (const step of ['decoration', 'making', 'play', 'making', 'decoration', 'shell']) {
      c.setStep(step); await settle();
      assert.equal(c.getState().preview.recipeKey, key);
    }
    assert.deepEqual(h.restored, [], 'Navigation never restores the core or repairs polish');
    assert.equal(h.prepared.length, count, 'Same presentation and recipe do not configure new resources');
    assert.equal(h.stopped, 2);
    c.restart(); assert.deepEqual(h.restored, [undefined]);
    assert.equal(h.prepared.length, count, 'Restart uses the current instance');
    c.setStep('play'); await settle(); c.restart();
    assert.deepEqual(h.restored, [undefined, undefined]);
    const before = h.prepared.length;
    await c.select('waxThickness', 'thick');
    assert.equal(h.prepared.length, before, 'An inactive wax preference cannot repair polish');
    await c.select('shellColor', 'sky');
    assert.notEqual(h.prepared.at(-1).recipeKey, key);
    assert.equal(h.prepared.at(-1).coreColor, 'mint');
    assert.equal(h.prepared.at(-1).shellColor, 'sky');
    await c.select('coreColor', 'lemon');
    assert.equal(h.prepared.at(-1).coreColor, 'lemon'); assert.equal(h.prepared.at(-1).shellColor, 'sky');
  } finally { c.dispose(); }
});

test('unsupported polish selections remain explicit bare-core previews and clear the notice when supported again', async () => {
  const h = await harness({ step: 'shell' }), c = h.controller;
  try {
    await c.load();
    await c.select('styleId', 'paw');
    await c.select('coreMaterial', 'marshmallow');
    assert.match(c.getState().selectionNotice, /猫爪暂未支持.*裸芯/);
    assert.equal(h.prepared.at(-1).mode, 'core');
    assert.equal(h.prepared.at(-1).feelId, 'marshmallow');
    c.restart(); assert.deepEqual(h.restored, []);
    await c.select('styleId', 'orb');
    assert.equal(c.getState().selectionNotice, '');
    assert.equal(h.prepared.at(-1).shellPresetId, 'polish-shell');
    await c.select('styleId', 'paw');
    assert.match(c.getState().selectionNotice, /猫爪暂未支持/);
    assert.equal(h.prepared.at(-1).mode, 'core');
    await c.select('shellMaterial', 'wax');
    assert.equal(c.getState().selectionNotice, '');
    assert.equal(h.prepared.at(-1).waxThickness, 'medium');
    assert.equal(Object.hasOwn(h.prepared.at(-1), 'shellPresetId'), false);
  } finally { c.dispose(); }
});

test('rapid shell and colour requests commit only the latest polish recipe and dispose stale handles', async () => {
  const pending = [], committed = [], disposed = [];
  const h = await harness({ step: 'shell', renderer: {
    prepare(config, { signal }) {
      return new Promise(resolve => pending.push({ config, signal,
        resolve: () => resolve({ commit() { committed.push(config); }, dispose() { disposed.push(config); } }),
      }));
    }, dispose() {},
  } });
  const c = h.controller;
  try {
    const first = c.load(), second = c.select('shellMaterial', 'wax'), third = c.select('shellColor', 'sky'), last = c.select('shellMaterial', 'polish');
    assert.ok(pending.slice(0, 3).every(request => request.signal.aborted));
    c.restart();
    pending[3].resolve(); await last;
    for (const request of pending.slice(0, 3)) request.resolve();
    await Promise.all([first, second, third]);
    assert.equal(committed.length, 1);
    assert.equal(committed[0].shellPresetId, 'polish-shell');
    assert.equal(committed[0].shellColor, 'sky');
    assert.equal(committed[0].coreColor, 'mint');
    assert.equal(disposed.length, 3);
    assert.equal(c.getState().configStatus, 'applied');
  } finally { c.dispose(); }
});
