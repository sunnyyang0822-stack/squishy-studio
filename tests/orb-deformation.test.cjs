const { test } = require('node:test');
const assert = require('node:assert/strict');
const { modelAttribute } = require('./helpers/orb-probe.cjs');
const modulePromise = import('../src/orb-deformation.mjs');
async function fixture(reducedMotion = false) {
  const { createOrbDeformation } = await modulePromise;
  const rest = modelAttribute('POSITION'), positions = rest.slice();
  const deformation = createOrbDeformation(positions, modelAttribute('NORMAL'), { reducedMotion });
  return { rest, positions, deformation };
}
function advance(d, seconds) { for (let t = 0; t < seconds; t += 1 / 120) d.step(1 / 120); }

test('实际 GLB 的任意接触邻域局部凹陷，远侧不变，按住时间强度有上限', async () => {
  const { rest, positions, deformation: d } = await fixture();
  const point = [.5, .3, Math.sqrt(1 - .5 ** 2 - .3 ** 2)];
  d.begin(point); advance(d, .1); const early = d.getState().depth;
  advance(d, 1.5); assert.ok(d.getState().depth > early && d.getState().depth <= .36);
  let changed = 0;
  for (let i = 0; i < rest.length; i += 3) {
    const distance = Math.hypot(...point.map((v, k) => rest[i + k] - v));
    if (distance > .66) assert.deepEqual(positions.slice(i, i + 3), rest.slice(i, i + 3));
    else if (positions[i] !== rest[i]) changed++;
  }
  assert.ok(changed > 100 && changed < rest.length / 12);
  d.move(point, .5); advance(d, .8);
  assert.ok(d.getState().depth <= .36 && d.getState().depth > .33);
});

test('拖动从当前接触点连续跟随；连续操作与回弹不累积位移', async () => {
  const { rest, positions, deformation: d } = await fixture();
  for (let repeat = 0; repeat < 20; repeat++) {
    d.begin([-.5, .2, .84]); advance(d, .3);
    const before = d.getState(); d.move([.5, .2, .84], .5); d.step(1 / 120);
    assert.ok(d.getState().center[0] > before.center[0] && d.getState().center[0] < 0, 'No teleport to the new contact');
    advance(d, .5); assert.ok(d.getState().center[0] > .49);
    d.release();
    for (let i = 0; i < 300; i++) { d.step(1 / 120); assert.ok(d.getState().depth >= -.012); }
    assert.deepEqual(positions, rest);
    assert.equal(d.step(1 / 60).needsFrame, false);
  }
});

test('输入中断精确恢复，减少动态恢复不振荡，低帧间隔仍保持有界', async () => {
  const { rest, positions, deformation: d } = await fixture(true);
  d.begin([0, .2, .98]); advance(d, .7); d.release();
  let previous = d.getState().depth;
  for (let i = 0; i < 80; i++) { d.step(1 / 120); assert.ok(d.getState().depth >= 0 && d.getState().depth <= previous); previous = d.getState().depth; }
  assert.deepEqual(positions, rest);
  d.setReducedMotion(false); d.begin([0, .2, .98]);
  for (let i = 0; i < 20; i++) { d.step(.5); assert.ok(d.getState().depth <= .36); }
  d.reset(); d.step(1 / 60);
  assert.deepEqual(positions, rest); assert.equal(d.getState().active, false);
});
