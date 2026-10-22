const { test } = require('node:test');
const assert = require('node:assert/strict');
const stateModule = import('../detail/state.mjs');

function harness(createDetailController, renderer) {
  const prepared = [], committed = [], released = [], sound = [];
  let stopped = 0, restored = 0, disposed = 0;
  const preview = renderer || {
    async prepare(config) {
      prepared.push(config);
      return { commit() { committed.push(config); }, dispose() { released.push(config); } };
    },
    stopInput() { stopped++; }, restore() { restored++; }, dispose() {},
  };
  const controller = createDetailController({
    renderer: preview,
    audio: { ready: false, setVolume(value) { sound.push(value); }, dispose() { disposed++; } },
  });
  return { controller, prepared, committed, released, sound,
    get stopped() { return stopped; }, get restored() { return restored; },
    get disposed() { return disposed; } };
}

test('五步、默认配方；黏土、棉花糖和慢回弹独立映射，制作步骤结束输入', async () => {
  const { createDetailController, steps, defaultRecipe } = await stateModule;
  assert.deepEqual(steps, ['core', 'shell', 'decoration', 'making', 'play']);
  const h = harness(createDetailController), c = h.controller;
  assert.deepEqual(c.getState().recipe, defaultRecipe);
  assert.deepEqual(c.getState().effectiveRecipe, defaultRecipe);
  await c.load();
  for (const material of ['clay', 'marshmallow', 'butter']) {
    await c.select('coreMaterial', material);
    assert.equal(c.getState().recipe.coreMaterial, material);
    assert.equal(c.getState().preview.feelId, material === 'butter' ? 'slow-rebound' : material === 'marshmallow' ? 'marshmallow' : 'clay');
    assert.equal(c.getState().preview.appearanceId, material === 'butter' ? 'full-matte' : 'matte');
    assert.equal(h.prepared.at(-1).feelId, c.getState().preview.feelId);
  }
  assert.deepEqual(h.prepared.map(config => config.feelId), ['clay', 'marshmallow', 'slow-rebound']);
  assert.ok(h.prepared.some(config => config.feelId === 'marshmallow'));
  c.next(); assert.equal(c.getState().step, 'shell');
  c.next(); assert.equal(c.getState().step, 'decoration');
  c.next(); assert.equal(c.getState().step, 'making');
  assert.equal(c.getState().preview.mode, 'hidden');
  assert.equal(h.stopped, 1);
  c.next(); assert.equal(c.getState().step, 'play');
  assert.equal(h.restored, 1);
  c.previous(); assert.equal(c.getState().step, 'making');
  c.setStep('invalid'); assert.equal(c.getState().step, 'making');
  c.dispose();
});

test('填充物与装饰单选，内外颜色独立，往返和最终体验保留配方', async () => {
  const { createDetailController } = await stateModule;
  const h = harness(createDetailController), c = h.controller;
  await c.load();
  assert.equal(c.getState().recipe.filling, 'none');
  assert.equal(c.getState().recipe.decoration, 'one');
  for (const filling of ['perlite', 'rice', 'burst', 'none']) await c.select('filling', filling);
  await c.select('filling', 'rice');
  await c.select('coreColor', 'mint');
  assert.equal(c.getState().preview.color, 'mint');
  c.next(); await c.select('shellColor', 'sky');
  assert.equal(c.getState().preview.color, 'sky');
  for (const decoration of ['two', 'three', 'one']) await c.select('decoration', decoration);
  await c.select('decoration', 'three');
  c.next(); c.next(); c.next();
  assert.equal(c.getState().step, 'play');
  assert.equal(c.getState().recipe.filling, 'rice');
  assert.equal(c.getState().recipe.decoration, 'three');
  assert.equal(c.getState().preview.color, 'sky');
  c.setStep('core');
  assert.equal(c.getState().preview.color, 'mint');
  assert.equal(c.getState().recipe.shellColor, 'sky');
  assert.equal(c.getState().recipe.decoration, 'three');
  await c.select('decoration', 'invalid');
  assert.equal(c.getState().recipe.decoration, 'three');
  c.dispose();
});

test('共享十色与蜡厚度偏好；非蜡配方不应用厚度，切回恢复', async () => {
  const { createDetailController, colorNames } = await stateModule;
  const { orbColors } = await import('../detail/orb-colors.mjs');
  assert.equal(orbColors.length, 10);
  assert.equal(new Set(orbColors.map(color => color.hex)).size, 10);
  const h = harness(createDetailController), c = h.controller;
  await c.load();
  for (const color of orbColors) {
    assert.equal(colorNames[color.id], color.name);
    await c.select('coreColor', color.id);
    assert.equal(c.getState().recipe.coreColor, color.id);
  }
  await c.select('waxThickness', 'thick');
  await c.select('shellMaterial', 'polish');
  assert.equal(c.getState().recipe.waxThickness, 'thick');
  assert.equal(c.getState().effectiveRecipe.waxThickness, null);
  await c.select('shellMaterial', 'sugar');
  assert.equal(c.getState().effectiveRecipe.waxThickness, null);
  await c.select('shellMaterial', 'wax');
  assert.equal(c.getState().effectiveRecipe.waxThickness, 'thick');
  const count = h.prepared.length;
  await c.select('coreColor', 'invalid');
  await c.select('shellMaterial', 'wax');
  assert.equal(h.prepared.length, count);
  c.dispose();
});

test('快速换色只提交最后请求；过期失败不覆盖，离页释放', async () => {
  const { createDetailController } = await stateModule;
  const pending = [], committed = [], released = [];
  const h = harness(createDetailController, {
    prepare(config, { signal }) {
      return new Promise((resolve, reject) => pending.push({ config, signal, reject,
        resolve: () => resolve({ commit() { committed.push(config); }, dispose() { released.push(config); } }) }));
    }, dispose() {},
  });
  const c = h.controller;
  const first = c.load(), second = c.select('coreColor', 'mint'), third = c.select('coreColor', 'sky');
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(pending[1].signal.aborted, true);
  pending[2].resolve(); await third;
  pending[0].resolve(); await first;
  pending[1].reject(new Error('old failure')); await second;
  assert.deepEqual(committed.map(item => item.color), ['sky']);
  assert.equal(c.getState().resource, 'ready');
  assert.equal(released.length, 1);
  const late = c.select('coreColor', 'lemon');
  c.dispose(); c.dispose();
  assert.equal(pending[3].signal.aborted, true);
  pending[3].resolve(); await late;
  assert.equal(committed.length, 1);
  assert.equal(released.length, 3);
  assert.equal(h.disposed, 1);
});

test('已应用颜色遇到未完成换色后选回原色，取消旧请求并保持原色', async () => {
  const { createDetailController } = await stateModule;
  const pending = [], commits = [], releases = [];
  const h = harness(createDetailController, {
    prepare(config, { signal }) {
      return new Promise(resolve => pending.push({
        config, signal,
        resolve: () => resolve({ commit() { commits.push(config.color); }, dispose() { releases.push(config.color); } }),
      }));
    }, dispose() {},
  });
  const c = h.controller;
  const initial = c.load(); pending[0].resolve(); await initial;
  const mint = c.select('coreColor', 'mint');
  const rose = c.select('coreColor', 'rose');
  assert.equal(pending[1].signal.aborted, true);
  assert.equal(pending[2].config.color, 'rose');
  pending[2].resolve(); await rose;
  pending[1].resolve(); await mint;
  assert.deepEqual(commits, ['rose', 'rose']);
  assert.equal(c.getState().recipe.coreColor, 'rose');
  assert.equal(c.getState().resource, 'ready');
  assert.deepEqual(releases, ['rose', 'mint']);
  c.dispose();
});

test('最终体验向渲染器传入当前完整有效配方，非蜡厚度无效', async () => {
  const { createDetailController } = await stateModule;
  const h = harness(createDetailController), c = h.controller;
  await c.load();
  await c.select('coreMaterial', 'butter');
  await c.select('coreColor', 'mint');
  await c.select('filling', 'burst');
  await c.select('shellMaterial', 'sugar');
  await c.select('shellColor', 'sky');
  await c.select('waxThickness', 'thick');
  await c.select('decoration', 'three');
  c.setStep('making');
  c.setStep('play');
  await new Promise(resolve => setImmediate(resolve));
  const final = h.prepared.at(-1);
  assert.equal(final.mode, 'shell');
  assert.equal(final.feelId, 'slow-rebound');
  assert.equal(final.appearanceId, 'full-matte');
  assert.equal(final.color, 'sky');
  assert.deepEqual(final.recipe, {
    styleId: 'orb', coreMaterial: 'butter', coreColor: 'mint', filling: 'burst',
    shellMaterial: 'sugar', shellColor: 'sky', waxThickness: null, decoration: 'three',
  });
  assert.deepEqual(final.recipe, c.getState().effectiveRecipe);
  assert.equal(c.getState().recipe.waxThickness, 'thick');
  c.dispose();
});

test('模型失败仍可编辑和前进，重试保留选择；中断拒绝晚到资源', async () => {
  const { createDetailController } = await stateModule;
  let mode = 'error', resolveLate, releases = 0;
  const handle = () => ({ commit() {}, dispose() { releases++; } });
  const h = harness(createDetailController, { prepare() {
    if (mode === 'error') throw new Error('failed');
    if (mode === 'unavailable') return null;
    if (mode === 'late') return new Promise(resolve => resolveLate = resolve);
    return handle();
  }, dispose() {} });
  const c = h.controller;
  await c.load(); assert.equal(c.getState().resource, 'error');
  mode = 'unavailable'; await c.select('coreColor', 'mint');
  assert.equal(c.getState().resource, 'unavailable');
  c.next(); c.next(); c.next(); c.next();
  assert.equal(c.getState().step, 'play');
  assert.equal(c.getState().recipe.coreColor, 'mint');
  mode = 'ready'; await c.retry(); assert.equal(c.getState().resource, 'ready');
  mode = 'late'; const pending = c.select('shellColor', 'sky');
  c.rendererUnavailable(); resolveLate(handle()); await pending;
  assert.equal(c.getState().resource, 'unavailable');
  assert.equal(releases, 2);
  c.dispose();
});

test('音量初始静音、上次音量恢复、边界与清理', async () => {
  const { createDetailController } = await stateModule;
  const h = harness(createDetailController), c = h.controller;
  assert.deepEqual(h.sound, [{ volume: 0, muted: true }]);
  c.toggleMute(); assert.deepEqual(h.sound.at(-1), { volume: .5, muted: false });
  c.setVolume(73); c.toggleMute(); c.toggleMute();
  assert.deepEqual(h.sound.at(-1), { volume: .73, muted: false });
  c.setVolume(150); assert.equal(c.getState().audio.volume, 100);
  c.setVolume(-3); assert.equal(c.getState().audio.volume, 0);
  c.setVolume(NaN); assert.equal(c.getState().audio.volume, 0);
  const count = h.sound.length;
  await c.load(); await c.select('coreColor', 'mint');
  assert.equal(h.sound.length, count);
  c.dispose(); c.toggleMute();
  assert.equal(h.sound.length, count);
});
