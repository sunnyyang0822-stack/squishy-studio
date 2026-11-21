const { test } = require('node:test');
const assert = require('node:assert/strict');
const recipeModule = import('../make/recipe.mjs');
const controllerModule = import('../make/controller.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ support = () => ({ supported: true }), deferred } = {}) {
  const calls = [], compositions = [], scenes = [];
  const core = { update: async (recipe, context) => { calls.push({ kind: 'core', recipe, signal: context.signal }); }, stopInput() {}, dispose() { calls.push({ kind: 'core-disposed' }); } };
  const samples = { setActive() {}, update: async () => {}, compose: context => { compositions.push(context.signal); return deferred?.() || Promise.resolve(); }, completeComposition() {}, dispose() {} };
  const createFinished = () => {
    const scene = { disposed: false, recipe: null, initialize: async (recipe, context) => { scene.recipe = recipe; scene.signal = context.signal; },
      restore() { calls.push({ kind: 'restore', recipe: scene.recipe }); }, stopInput() {}, dispose() { scene.disposed = true; } };
    scenes.push(scene); return scene;
  };
  return { core, samples, createFinished, support, calls, compositions, scenes };
}
test('首版最小配方、三种内芯、独立壳色与蜡厚度，非法 URL 安全回退', async () => {
  const { normalizeDraft, effectiveRecipe, feelFor, styles, readLocation, writeLocation, updateKind } = await recipeModule;
  assert.equal(styles.length, 7); assert.ok(styles.every(style => style.id !== 'paw'));
  const draft = normalizeDraft({ coreMaterial: 'butter', shellColors: { wax: 'mint', polish: 'sky' }, waxThickness: 'thick' });
  assert.equal(feelFor(draft.coreMaterial), 'slow-rebound'); assert.equal(feelFor('marshmallow'), 'marshmallow'); assert.equal(feelFor('clay'), 'clay');
  assert.deepEqual(effectiveRecipe(draft), { styleId: 'orb', coreMaterial: 'butter', coreColor: 'rose', shellMaterial: 'wax', shellColor: 'mint', waxThickness: 'thick' });
  const polish = { ...draft, shellMaterial: 'polish' };
  assert.equal(effectiveRecipe(polish).waxThickness, null); assert.equal(polish.waxThickness, 'thick');
  assert.equal(effectiveRecipe(polish).shellColor, 'sky');
  const roundTrip = readLocation(writeLocation('http://localhost/make/', { draft: polish, step: 'play' }));
  assert.deepEqual(roundTrip, { draft: polish, step: 'play' });
  assert.equal(readLocation('http://localhost/make/?step=making&style=paw&coreMaterial=invalid&shellMaterial=sugar').step, 'shell');
  const invalid = normalizeDraft({ styleId: 'paw', coreColor: '__proto__', shellMaterial: 'sugar', waxThickness: 100 });
  assert.equal(invalid.styleId, 'orb'); assert.equal(invalid.coreColor, 'rose'); assert.equal(invalid.shellMaterial, 'wax');
  assert.equal(updateKind(effectiveRecipe(draft), effectiveRecipe(polish)), 'shell');
  assert.equal(updateKind(effectiveRecipe(draft), { ...effectiveRecipe(draft), coreMaterial: 'clay' }), 'scene');
  assert.ok(!Object.hasOwn(effectiveRecipe(draft), 'filling')); assert.ok(!Object.hasOwn(effectiveRecipe(draft), 'decoration'));
});
test('首版完整流程、恢复与返回修改保持配方，只创建实际成品实例', async () => {
  const { createMaker } = await controllerModule; const h = harness();
  const c = createMaker(h); await c.load();
  await c.select('coreMaterial', 'butter'); await c.select('coreColor', 'mint');
  await c.next(); assert.equal(c.getState().step, 'shell');
  await c.select('shellColor', 'sky'); await c.select('waxThickness', 'thick');
  await c.select('shellMaterial', 'polish'); await c.select('shellColor', 'coral');
  await c.select('shellMaterial', 'wax'); assert.equal(c.getState().recipe.shellColor, 'sky');
  await c.select('shellMaterial', 'polish'); assert.equal(c.getState().recipe.shellColor, 'coral');
  await c.next(); assert.equal(c.getState().step, 'play'); assert.equal(h.scenes.length, 1);
  const recipe = c.getState().recipe;
  assert.deepEqual(h.scenes[0].recipe, recipe); assert.equal(recipe.waxThickness, null);
  await c.restore(); assert.deepEqual(h.calls.at(-1), { kind: 'restore', recipe });
  assert.deepEqual(c.getState().recipe, recipe);
  await c.back(); assert.equal(c.getState().step, 'shell'); assert.equal(h.scenes[0].disposed, true);
  await c.back(); assert.equal(c.getState().recipe.coreColor, 'mint'); assert.equal(c.getState().draft.waxThickness, 'thick');
  assert.deepEqual(c.getState().draft.shellColors, { wax: 'sky', polish: 'coral' });
  c.dispose();
});
test('取消合成与晚到准备不覆盖当前步骤；错误可重试且不丢配置', async () => {
  const { createMaker } = await controllerModule; let resolveComposition;
  const h = harness({ deferred: () => new Promise(resolve => { resolveComposition = resolve; }) });
  const c = createMaker(h); await c.load(); await c.next();
  const old = c.next(); await tick(); assert.equal(c.getState().step, 'making');
  await c.back(); resolveComposition(); await old;
  assert.equal(c.getState().step, 'shell'); assert.equal(h.scenes[0].disposed, true);
  assert.equal(h.compositions[0].aborted, true);
  c.dispose(); assert.ok(h.calls.some(call => call.kind === 'core-disposed'));
  const h2 = harness(); let fail = true;
  h2.core.update = async () => { if (fail) throw new Error('model failed'); };
  const retry = createMaker(h2); await retry.load(); assert.equal(retry.getState().status, 'error');
  await retry.select('coreColor', 'mint'); fail = false; await retry.retry();
  assert.equal(retry.getState().status, 'ready'); assert.equal(retry.getState().recipe.coreColor, 'mint');
  retry.dispose();
});
test('未交接的成品能力阻止合成，play 直达退回可修改步骤', async () => {
  const { createMaker } = await controllerModule;
  const h = harness({ support: () => ({ supported: false, reason: '需要 B 的成品接口' }) });
  const c = createMaker({ ...h, initial: { step: 'play', draft: { styleId: 'donut' } } });
  await c.load(); assert.equal(c.getState().step, 'shell'); assert.equal(h.scenes.length, 0);
  await c.next(); assert.equal(h.scenes.length, 0); assert.equal(c.getState().error, '需要 B 的成品接口');
  c.dispose();
});
test('实际能力矩阵不把蜡预览冒充成品，不启用猫爪或未来糖壳', async () => {
  const { finishedSupport } = await import('../make/capabilities.mjs');
  const { defaultRecipe, styles } = await recipeModule;
  for (const { id } of styles) for (const coreMaterial of ['clay', 'marshmallow', 'butter']) {
    const base = { ...defaultRecipe, styleId: id, coreMaterial };
    assert.equal(finishedSupport({ ...base, shellMaterial: 'polish', waxThickness: null }).supported, true);
    for (const waxThickness of ['thin', 'medium', 'thick']) assert.equal(finishedSupport({ ...base, waxThickness }).supported, id === 'orb' && coreMaterial === 'clay');
  }
  assert.equal(finishedSupport({ ...defaultRecipe, styleId: 'paw' }).supported, false);
  assert.equal(finishedSupport({ ...defaultRecipe, shellMaterial: 'sugar' }).supported, false);
});
test('弧面壳片为独立闭合实体，三档真实厚度不同且无退化面', async () => {
  const { createShellSampleGeometry } = await import('../src/shell-sample-geometry.mjs');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  for (const [level, thickness] of [['thin', .014], ['medium', .028], ['thick', .042]]) {
    assert.equal(getWaxPreset(level + '-wax').parameters.thickness, thickness);
    const geometry = createShellSampleGeometry(thickness);
    const positions = geometry.attributes.position.array, indices = geometry.index.array;
    assert.ok(positions.every(Number.isFinite)); assert.equal(geometry.userData.thickness, thickness);
    const half = positions.length / 2; assert.ok(Math.abs(positions[2] - positions[half + 2] - thickness) < 1e-6);
    const edges = new Map();
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = Array.from(indices.slice(i, i + 3)); assert.equal(new Set(triangle).size, 3);
      for (let j = 0; j < 3; j++) { const a = triangle[j], b = triangle[(j + 1) % 3]; const key = [a, b].sort((a, b) => a - b).join(':'); edges.set(key, (edges.get(key) || 0) + 1); }
    }
    assert.ok([...edges.values()].every(count => count === 2)); geometry.dispose();
  }
});
