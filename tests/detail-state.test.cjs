const { test } = require('node:test');
const assert = require('node:assert/strict');
const stateModule = import('../detail/state.mjs');

function harness(create, renderer) {
  const calls = [];
  let disposed = 0;
  const configurations = [];
  const controller = create({ renderer: renderer || { async prepare(config) { configurations.push(config); return { commit() {}, dispose() {} }; } }, audio: { ready: false, setVolume(value) { calls.push(value); }, dispose() { disposed++; } } });
  return { controller, calls, configurations, get disposed() { return disposed; } };
}

test('九种完整配置、独立分组及同值不重新初始化', async () => {
  const { createDetailController } = await stateModule;
  const { controller: c, configurations } = harness(createDetailController);
  await c.load();
  assert.deepEqual(c.getState().config, { thickness: 'medium', material: 'wax' });
  for (const thickness of ['thin', 'medium', 'thick']) for (const material of ['wax', 'polish', 'sugar']) {
    await c.select('thickness', thickness); await c.select('material', material);
    assert.deepEqual(c.getState().config, { thickness, material });
    assert.deepEqual(configurations.at(-1), { thickness, material });
  }
  const count = configurations.length;
  await c.select('material', 'sugar'); await c.select('thickness', 'thick'); await c.select('unknown', 'wax');
  assert.equal(configurations.length, count);
  c.dispose();
});

test('快速连续选择只提交最后一次；旧失败不覆盖新状态；离页取消并释放', async () => {
  const { createDetailController } = await stateModule;
  const pending = []; const commits = []; const releases = [];
  const h = harness(createDetailController, { prepare(config, { signal }) { return new Promise((resolve, reject) => pending.push({ config, signal, reject, resolve: () => resolve({ commit() { commits.push(config); }, dispose() { releases.push(config); } }) })); } });
  const c = h.controller;
  const first = c.load(); const second = c.select('material', 'sugar'); const third = c.select('thickness', 'thick');
  assert.equal(pending[0].signal.aborted, true);
  pending[2].resolve(); await third;
  pending[0].resolve(); await first;
  pending[1].reject(new Error('old failure')); await second;
  assert.deepEqual(commits, [{ thickness: 'thick', material: 'sugar' }]);
  assert.equal(releases.length, 1); assert.equal(c.getState().resource, 'ready');
  const late = c.select('material', 'wax'); c.dispose(); c.dispose();
  assert.equal(pending[3].signal.aborted, true); pending[3].resolve(); await late;
  assert.equal(commits.length, 1); assert.equal(releases.length, 3); assert.equal(h.disposed, 1);
});

test('真实资源失败、重试、不可用与配置状态独立', async () => {
  const { createDetailController } = await stateModule;
  let mode = 'error';
  const { controller: c } = harness(createDetailController, { async prepare() { if (mode === 'error') throw new Error('failed'); if (mode === 'unavailable') return null; return { commit() {}, dispose() {} }; } });
  await c.load(); assert.equal(c.getState().resource, 'error');
  mode = 'unavailable'; await c.select('material', 'polish');
  assert.equal(c.getState().resource, 'unavailable'); assert.equal(c.getState().config.material, 'polish');
  mode = 'ready'; await c.retry(); assert.equal(c.getState().resource, 'ready');
  mode = 'error'; await c.select('thickness', 'thin');
  assert.equal(c.getState().resource, 'ready'); assert.equal(c.getState().configError, true);
  c.setVolume(33); assert.equal(c.getState().audio.volume, 33); c.dispose();
});

test('音量接口：初始静音、首次50%、0静音、最近值恢复、边界及清理', async () => {
  const { createDetailController } = await stateModule;
  const h = harness(createDetailController); const c = h.controller;
  assert.deepEqual(h.calls, [{ volume: 0, muted: true }]); assert.equal(c.getState().audio.ready, false);
  c.toggleMute(); assert.deepEqual(h.calls.at(-1), { volume: .5, muted: false });
  c.setVolume(73); c.toggleMute(); assert.equal(c.getState().audio.volume, 0);
  c.toggleMute(); assert.deepEqual(h.calls.at(-1), { volume: .73, muted: false });
  c.setVolume(0); assert.equal(c.getState().audio.muted, true);
  c.setVolume(19); assert.equal(c.getState().audio.muted, false);
  c.setVolume(150); assert.equal(c.getState().audio.volume, 100);
  c.setVolume(-3); assert.equal(c.getState().audio.volume, 0);
  c.setVolume(NaN); assert.equal(c.getState().audio.volume, 0);
  const count = h.calls.length;
  await c.load(); await c.select('material', 'sugar'); assert.equal(h.calls.length, count);
  c.dispose(); c.toggleMute(); c.setVolume(99); assert.equal(h.calls.length, count); assert.equal(h.disposed, 1);
});

test('渲染上下文中断清除当前资源状态，重试恢复且晚到加载不能覆盖中断', async () => {
  const { createDetailController } = await stateModule;
  let resolve;
  let delayed = false;
  let released = 0;
  const handle = () => ({ commit() {}, dispose() { released++; } });
  const { controller: c } = harness(createDetailController, { prepare() { return delayed ? new Promise(r => resolve = r) : Promise.resolve(handle()); } });
  await c.load();
  c.rendererUnavailable();
  assert.equal(c.getState().resource, 'unavailable'); assert.equal(released, 1);
  await c.retry(); assert.equal(c.getState().resource, 'ready');
  delayed = true;
  const pending = c.select('material', 'sugar');
  c.rendererUnavailable(); resolve(handle()); await pending;
  assert.equal(c.getState().resource, 'unavailable');
  assert.equal(released, 3);
  c.dispose(); c.rendererUnavailable();
  assert.equal(released, 3);
});
