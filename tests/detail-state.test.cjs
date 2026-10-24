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

test('薄蜡预览保留独立芯壳颜色与配置身份，默认中蜡不改动', async () => {
  const { previewFor, defaultRecipe, recipeKeyFor } = await stateModule;
  assert.equal(defaultRecipe.waxThickness, 'medium');
  for (const coreMaterial of ['clay', 'marshmallow', 'butter']) {
    const recipe = { ...defaultRecipe, coreMaterial, coreColor: 'mint', shellColor: 'sky', waxThickness: 'thin' };
    const core = previewFor('core', recipe), shell = previewFor('shell', recipe);
    assert.equal(core.mode, 'core');
    assert.equal(core.color, 'mint');
    assert.equal(shell.mode, 'shell');
    assert.equal(shell.coreColor, 'mint');
    assert.equal(shell.shellColor, 'sky');
    assert.equal(shell.shellMaterial, 'wax');
    assert.equal(shell.waxThickness, 'thin');
    assert.equal(core.recipeKey, shell.recipeKey);
    assert.equal(shell.recipeKey, previewFor('play', recipe).recipeKey);
    assert.equal(shell.recipeKey, recipeKeyFor(Object.fromEntries(Object.entries(recipe).reverse())));
    for (const [key, value] of [['coreColor', 'lemon'], ['shellColor', 'lemon'], ['styleId', 'cloud'], ['waxThickness', 'thick'], ['shellMaterial', 'sugar']]) {
      assert.notEqual(shell.recipeKey, recipeKeyFor({ ...recipe, [key]: value }), key);
    }
    assert.equal(previewFor('shell', { ...recipe, shellMaterial: 'polish' }).waxThickness, null);
  }
});

test('同配方前后导航不修复损伤，壳设置或隐藏内芯色变化仍提交新配置', async () => {
  const { createDetailController } = await stateModule;
  const h = harness(createDetailController), c = h.controller;
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await c.load();
  await c.select('waxThickness', 'thin');
  c.setStep('shell'); await settle();
  const shellCount = h.prepared.length;
  c.setStep('decoration'); await settle();
  c.setStep('making'); c.setStep('play'); await settle();
  c.setStep('making'); c.setStep('decoration'); await settle();
  c.setStep('shell'); await settle();
  assert.equal(h.prepared.length, shellCount);
  assert.equal(h.restored, 0);
  assert.equal(h.stopped, 2);
  const previous = h.prepared.at(-1);
  await c.select('coreColor', 'mint');
  assert.equal(h.prepared.length, shellCount + 1);
  assert.equal(h.prepared.at(-1).color, previous.color);
  assert.notEqual(h.prepared.at(-1).recipeKey, previous.recipeKey);
  await c.select('waxThickness', 'medium');
  assert.equal(h.prepared.at(-1).waxThickness, 'medium');
  await c.select('shellMaterial', 'sugar');
  assert.equal(h.prepared.at(-1).waxThickness, null);
  const count = h.prepared.length;
  await c.select('waxThickness', 'thick');
  assert.equal(h.prepared.length, count, 'inactive wax thickness preference does not rebuild sugar');
  c.setStep('core'); await settle();
  assert.equal(h.prepared.at(-1).mode, 'core');
  c.setStep('shell'); await settle();
  assert.equal(h.prepared.at(-1).mode, 'shell');
  c.dispose();
});

test('重新开始仅作用于已就绪的圆球黏土薄蜡，不改变配方或步骤', async () => {
  const { createDetailController, canRestartThinWax, defaultRecipe } = await stateModule;
  const h = harness(createDetailController), c = h.controller;
  c.restart(); assert.equal(h.restored, 0);
  await c.load(); c.restart(); assert.equal(h.restored, 0);
  await c.select('waxThickness', 'thin');
  c.restart(); assert.equal(h.restored, 0, '裸芯试捏不显示重开');
  c.setStep('shell');
  c.restart(); assert.equal(h.restored, 0, '配置提交前不得恢复旧实例');
  await new Promise(resolve => setImmediate(resolve));
  const before = c.getState(), count = h.prepared.length;
  c.restart();
  assert.equal(h.restored, 1);
  assert.equal(h.prepared.length, count);
  assert.deepEqual(c.getState(), before);
  for (const step of ['core', 'making']) assert.equal(canRestartThinWax(step, before.recipe), false);
  for (const step of ['shell', 'decoration', 'play']) assert.equal(canRestartThinWax(step, before.recipe), true);
  for (const override of [{ styleId: 'donut' }, { coreMaterial: 'marshmallow' }, { coreMaterial: 'butter' }, { waxThickness: 'medium' }, { shellMaterial: 'sugar' }]) {
    assert.equal(canRestartThinWax('play', { ...defaultRecipe, waxThickness: 'thin', ...override }), false);
  }
  c.rendererUnavailable(); c.restart(); assert.equal(h.restored, 1);
  c.dispose(); c.restart(); assert.equal(h.restored, 1);
});

test('薄蜡范围之外的制作结束保留原有自动恢复', async () => {
  const { createDetailController } = await stateModule;
  for (const [group, value] of [['waxThickness', 'medium'], ['coreMaterial', 'marshmallow'], ['coreMaterial', 'butter'], ['styleId', 'donut'], ['shellMaterial', 'polish']]) {
    const h = harness(createDetailController), c = h.controller;
    await c.load(); await c.select('waxThickness', 'thin'); await c.select(group, value);
    c.setStep('making'); c.setStep('play');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.restored, 1, `${group}=${value}`);
    c.restart(); assert.equal(h.restored, 1);
    c.dispose();
  }
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


test('八种样式的三种预设均保留五步配方，慢回弹沿用full-matte外观', async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { createDetailController, styleNames } = await stateModule;
  const h = harness(createDetailController), c = h.controller;
  await c.load();
  assert.deepEqual(Object.keys(styleNames), ['orb', 'cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star']);
  for (const styleId of Object.keys(styleNames)) {
    assert.deepEqual(getSquishyStyle(styleId).supportedFeels, ['clay', 'marshmallow', 'slow-rebound']);
    for (const material of ['clay', 'marshmallow', 'butter']) {
      c.setStep('core'); await c.select('styleId', styleId); await c.select('coreMaterial', material);
      const feel = material === 'butter' ? 'slow-rebound' : material;
      assert.equal(c.getState().recipe.coreMaterial, material);
      assert.equal(h.prepared.at(-1).styleId, styleId);
      assert.equal(h.prepared.at(-1).presetId, feel);
      assert.equal(h.prepared.at(-1).feelId, feel);
      assert.equal(h.prepared.at(-1).appearanceId, material === 'butter' ? 'full-matte' : 'matte');
      assert.equal(c.getState().selectionNotice, '');
      await c.select('coreColor', 'mint'); await c.select('filling', 'rice');
      c.setStep('shell'); await c.select('shellColor', 'sky');
      c.setStep('decoration'); await c.select('decoration', 'three');
      c.next(); c.next(); await new Promise(resolve => setImmediate(resolve));
      const final = h.prepared.at(-1);
      assert.equal(c.getState().step, 'play'); assert.equal(final.recipe.styleId, styleId);
      assert.equal(final.recipe.coreMaterial, material); assert.equal(final.presetId, feel);
      assert.equal(final.feelId, feel); assert.equal(final.appearanceId, material === 'butter' ? 'full-matte' : 'matte');
      assert.equal(final.recipe.filling, 'rice'); assert.equal(final.recipe.decoration, 'three');
      assert.equal(final.recipe.coreColor, 'mint'); assert.equal(final.color, 'sky');
    }
  }
  c.setStep('core'); await c.select('coreMaterial', 'butter');
  for (const styleId of ['orb', 'donut', 'paw', 'flower']) {
    await c.select('styleId', styleId);
    assert.equal(c.getState().recipe.styleId, styleId); assert.equal(c.getState().recipe.coreMaterial, 'butter');
    assert.equal(c.getState().preview.presetId, 'slow-rebound');
    assert.equal(c.getState().preview.appearanceId, 'full-matte');
    assert.equal(c.getState().recipe.filling, 'rice'); assert.equal(c.getState().recipe.shellColor, 'sky');
  }
  c.dispose();
});

test('样式加载竞态只提交末次模型，失败保留已显示实例且可重试，离页释放', async () => {
  const { createDetailController } = await stateModule;
  const pending = [], committed = [], released = [];
  const h = harness(createDetailController, {
    prepare(config, { signal }) {
      return new Promise((resolve, reject) => pending.push({ config, signal, reject,
        resolve: () => resolve({ commit() { committed.push(config.styleId); }, dispose() { released.push(config.styleId); } }) }));
    }, dispose() {},
  });
  const c = h.controller;
  const initial = c.load(); pending[0].resolve(); await initial;
  const cloud = c.select('styleId', 'cloud'), donut = c.select('styleId', 'donut');
  assert.equal(pending[1].signal.aborted, true);
  pending[2].resolve(); await donut; pending[1].resolve(); await cloud;
  assert.deepEqual(committed, ['orb', 'donut']);
  assert.deepEqual(released, ['orb', 'cloud']);
  const star = c.select('styleId', 'star'); pending[3].reject(new Error('asset missing')); await star;
  assert.equal(c.getState().configError, true);
  assert.equal(c.getState().resource, 'ready');
  assert.ok(!released.includes('donut'));
  const retry = c.retry(); pending[4].resolve(); await retry;
  assert.deepEqual(committed, ['orb', 'donut', 'star']);
  assert.equal(c.getState().configError, false);
  const late = c.select('styleId', 'paw'); c.dispose();
  assert.equal(pending[5].signal.aborted, true);
  pending[5].resolve(); await late;
  assert.deepEqual(released, ['orb', 'cloud', 'donut', 'star', 'paw']);
});

test('直达配方合法化保留各样式慢回弹，非法枚举回到默认值', async () => {
  const { createDetailController } = await stateModule;
  const renderer = { async prepare() { return { commit() {}, dispose() {} }; } };
  const audio = { ready: false, setVolume() {}, dispose() {} };
  const c = createDetailController({ renderer, audio, styleId: 'donut', step: 'play', recipe: { coreMaterial: 'clay', coreColor: 'mint', shellColor: 'sky', filling: 'rice', decoration: 'three' } });
  await c.load();
  assert.equal(c.getState().step, 'play');
  assert.equal(c.getState().preview.styleId, 'donut');
  assert.equal(c.getState().recipe.coreColor, 'mint');
  assert.equal(c.getState().recipe.decoration, 'three');
  c.dispose();
  const invalid = createDetailController({ renderer, audio, styleId: 'star', step: 'bad', recipe: { coreMaterial: 'butter', coreColor: 'bad' } });
  assert.equal(invalid.getState().step, 'core');
  assert.equal(invalid.getState().recipe.coreMaterial, 'butter');
  assert.equal(invalid.getState().preview.presetId, 'slow-rebound');
  assert.equal(invalid.getState().preview.appearanceId, 'full-matte');
  assert.equal(invalid.getState().recipe.coreColor, 'rose');
  assert.equal(invalid.getState().selectionNotice, '');
  await invalid.restoreLocation({ styleId: 'paw', step: 'shell', recipe: { coreMaterial: 'butter', shellColor: 'sky', filling: 'rice' } });
  assert.equal(invalid.getState().recipe.styleId, 'paw');
  assert.equal(invalid.getState().recipe.coreMaterial, 'butter');
  assert.equal(invalid.getState().preview.presetId, 'slow-rebound');
  assert.equal(invalid.getState().preview.appearanceId, 'full-matte');
  assert.equal(invalid.getState().preview.color, 'sky');
  assert.equal(invalid.getState().recipe.filling, 'rice');
  invalid.dispose();
});


test('浏览器历史原子恢复样式配方与步骤，取消旧资源并在制作页停止输入', async () => {
  const { createDetailController } = await stateModule;
  const h = harness(createDetailController), c = h.controller;
  await c.load();
  await c.restoreLocation({ styleId: 'star', step: 'shell', recipe: { coreColor: 'mint', shellColor: 'sky', filling: 'rice' } });
  assert.equal(c.getState().recipe.styleId, 'star');
  assert.equal(c.getState().step, 'shell');
  assert.equal(h.prepared.at(-1).styleId, 'star');
  assert.equal(h.prepared.at(-1).color, 'sky');
  const count = h.prepared.length;
  await c.restoreLocation({ styleId: 'donut', step: 'making', recipe: { decoration: 'three' } });
  assert.equal(h.prepared.length, count);
  assert.equal(c.getState().preview.mode, 'hidden');
  assert.equal(c.getState().recipe.styleId, 'donut');
  assert.equal(c.getState().recipe.decoration, 'three');
  assert.equal(h.stopped, 2);
  await c.restoreLocation({ styleId: 'orb', step: 'core', recipe: { coreMaterial: 'marshmallow' } });
  assert.equal(h.prepared.at(-1).feelId, 'marshmallow');
  c.dispose();
});
