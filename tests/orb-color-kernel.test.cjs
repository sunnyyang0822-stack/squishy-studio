const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../src/orb-color.mjs');

test('顶部覆盖先于底部，结束精确统一颜色并停止更新', async () => {
  const { createOrbColor } = await modulePromise;
  const colors = new Float32Array(9);
  const c = createOrbColor(colors, [1, 0, 0]);
  c.select([0, 1, 0], new Float32Array([1, .5, 0]));
  c.step(.15);
  assert.ok(colors[1] > .5); assert.equal(colors[4], 0); assert.equal(colors[7], 0);
  c.step(.25); assert.ok(colors[4] > 0); assert.equal(colors[7], 0);
  c.step(.25); assert.deepEqual(colors, new Float32Array([0,1,0,0,1,0,0,1,0]));
  assert.deepEqual(c.step(1), { changed: false, needsFrame: false });
});

test('快速换色及动态偏好中断从当前每顶点颜色连续接续', async () => {
  const { createOrbColor } = await modulePromise;
  const colors = new Float32Array(9);
  const c = createOrbColor(colors, [.8, .4, .5]);
  const heights = new Float32Array([1, .5, 0]);
  c.select([.3, .7, .4], heights); c.step(.3);
  const visible = colors.slice(); c.select([.4, .5, .9], heights);
  assert.deepEqual(colors, visible); c.step(0); assert.deepEqual(colors, visible);
  c.step(.1); const interrupted = colors.slice(); c.setReducedMotion(true);
  assert.deepEqual(colors, interrupted); c.step(0); assert.deepEqual(colors, interrupted);
  c.step(.06);
  for (let i = 0; i < colors.length; i++) assert.ok(Math.abs(colors[i] - (interrupted[i] + [.4,.5,.9][i % 3]) / 2) < .000001);
  c.step(.06); assert.equal(c.step(1).needsFrame, false);
});
