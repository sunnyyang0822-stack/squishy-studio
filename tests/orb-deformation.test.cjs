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

test('松开保留本次局部凹陷约三分之一，异处操作保留旧痕并稳定停帧', async () => {
  const { rest, positions, deformation: d } = await fixture();
  d.begin([-.5, .2, .84]); advance(d, 1.4);
  const pressed = positions.slice(); d.release(); advance(d, 3);
  const retained = positions.slice();
  let maximumError = 0;
  for (let i = 0; i < rest.length; i++) maximumError = Math.max(maximumError, Math.abs(retained[i] - rest[i] - (pressed[i] - rest[i]) / 3));
  assert.ok(maximumError < .00001, `Retention error ${maximumError}`);
  assert.ok(d.getState().retainedDepth > .08 && d.getState().retainedDepth <= .22);
  assert.equal(d.step(1 / 60).needsFrame, false);
  assert.equal(d.step(1 / 60).atRest, false);
  advance(d, 2); assert.deepEqual(positions, retained, 'Settled retained mesh cannot drift');
  d.begin([.5, .2, .84]); advance(d, .3);
  const before = d.getState(); d.move([0, .6, .8], .5); d.step(1 / 120);
  assert.ok(d.getState().center[0] < before.center[0] && d.getState().center[0] > 0, 'Continuous drag anchor');
  d.cancel(); advance(d, 3); assert.deepEqual(positions, retained, 'Cancellation discards only the unfinished press');
  d.begin([.5, .2, .84]); advance(d, 1); d.release(); advance(d, 3);
  let oldVertices = 0;
  for (let i = 0; i < rest.length; i += 3) if (rest[i] < -.5 && Math.abs(retained[i] - rest[i]) > .001) {
    assert.deepEqual(positions.slice(i, i + 3), retained.slice(i, i + 3)); oldVertices++;
  }
  assert.ok(oldVertices > 10, 'The older dent survives a separate new dent');
});

test('重复按压与慢帧有界；取消保留基准，reset才清空全部', async () => {
  const { rest, positions, deformation: d } = await fixture();
  let previousRetained = 0;
  for (let repeat = 0; repeat < 30; repeat++) {
    d.begin([0, .2, .98]); advance(d, .9);
    assert.ok(d.getState().depth <= .360001);
    d.release(); advance(d, 3);
    assert.ok(d.getState().retainedDepth >= previousRetained - .000001);
    assert.ok(d.getState().retainedDepth <= .220001);
    previousRetained = d.getState().retainedDepth;
    assert.equal(d.step(1 / 60).needsFrame, false);
  }
  const retained = positions.slice();
  d.begin([-.4, .5, .75]);
  for (let i = 0; i < 20; i++) { d.step(.5); assert.ok(d.getState().depth <= .360001); }
  d.cancel(); advance(d, 3); assert.deepEqual(positions, retained);
  d.reset(); d.step(1 / 60); assert.deepEqual(positions, rest);
  assert.equal(d.getState().active, false); assert.equal(d.getState().retainedDepth, 0);
  assert.equal(d.step(1 / 60).atRest, true);
});

test('减少动态每顶点无振荡恢复到留痕，运行中切换偏好仍稳定', async () => {
  const { positions, deformation: d } = await fixture(true);
  d.begin([0, .2, .98]); advance(d, .8); d.release();
  const previous = positions.slice();
  advance(d, 3); const target = positions.slice();
  d.begin([0, .2, .98]); advance(d, .7); d.cancel();
  const old = positions.slice();
  for (let frame = 0; frame < 180; frame++) {
    d.step(1 / 120);
    for (let i = 0; i < old.length; i++) { assert.ok(Math.abs(positions[i] - target[i]) <= Math.abs(old[i] - target[i]) + .000001); old[i] = positions[i]; }
  }
  assert.deepEqual(positions, target);
  assert.notDeepEqual(previous, target);
  d.begin([.4, .2, .88]); advance(d, .3); d.setReducedMotion(false); d.setReducedMotion(true); d.cancel(); advance(d, 3);
  assert.deepEqual(positions, target); assert.equal(d.step(1 / 60).needsFrame, false);
});
