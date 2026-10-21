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
function displacement(f, point) {
  let nearest = 0, distance = Infinity;
  for (let i = 0; i < f.rest.length; i += 3) {
    const current = Math.hypot(...point.map((v, k) => f.rest[i + k] - v));
    if (current < distance) { distance = current; nearest = i; }
  }
  return Math.hypot(...[0, 1, 2].map(k => f.positions[nearest + k] - f.rest[nearest + k]));
}
const front = theta => [Math.sin(theta), .0175, Math.cos(theta)];

test('实际GLB接触邻域局部凹陷，无外鼓；较低按压强度随按住增强且有界', async () => {
  const f = await fixture(), { rest, positions, deformation: d } = f;
  const point = [.5, .3, Math.sqrt(1 - .5 ** 2 - .3 ** 2)];
  d.begin(point); advance(d, .1); const early = d.getState().depth;
  advance(d, 1.5); assert.ok(d.getState().depth > early && d.getState().depth <= .221);
  let changed = 0;
  const normals = modelAttribute('NORMAL');
  for (let i = 0; i < rest.length; i += 3) {
    const distance = Math.hypot(...point.map((v, k) => rest[i + k] - v));
    if (distance > .66) assert.deepEqual(positions.slice(i, i + 3), rest.slice(i, i + 3));
    else if (positions[i] !== rest[i]) {
      changed++;
      const inward = [0, 1, 2].reduce((sum, k) => sum + (rest[i + k] - positions[i + k]) * normals[i + k], 0);
      assert.ok(inward >= -.000001, 'No outward rebound or surrounding lip');
    }
  }
  assert.ok(changed > 100 && changed < rest.length / 12);
  d.move(point, .5); advance(d, .8);
  assert.ok(d.getState().depth > .23 && d.getState().depth <= .240001);
});

for (const reduced of [false, true]) test(`释放只回弹15%，每顶点单调且无跳变；减少动态=${reduced}`, async () => {
  const { rest, positions, deformation: d } = await fixture(reduced);
  d.begin([-.5, .2, .84]); advance(d, 1.4);
  const pressed = positions.slice(), previous = positions.slice();
  const target = pressed.map((v, i) => rest[i] + (v - rest[i]) * .85);
  d.release(); assert.deepEqual(positions, pressed, 'Release cannot synchronously jump the visible mesh');
  d.step(1 / 120);
  for (let i = 0; i < positions.length; i++) assert.ok(Math.abs(positions[i] - pressed[i]) < .01, 'A frame cannot snap to the retained position');
  for (let frame = 0; frame < 360; frame++) {
    d.step(1 / 120);
    for (let i = 0; i < positions.length; i++) {
      assert.ok(Math.abs(positions[i] - target[i]) <= Math.abs(previous[i] - target[i]) + .000001, 'No per-vertex overshoot or oscillation');
      previous[i] = positions[i];
    }
  }
  for (let i = 0; i < positions.length; i++) assert.ok(Math.abs(positions[i] - target[i]) < .000001);
  assert.ok(d.getState().retainedDepth > .17 && d.getState().retainedDepth < .19);
  const retained = positions.slice();
  assert.equal(d.step(1 / 60).atRest, false); assert.equal(d.step(1 / 60).needsFrame, false);
  advance(d, 2); assert.deepEqual(positions, retained);
});

test('高速稀疏move在球面插值，中段与起点终点同样留痕，弯折路径完整保留', async () => {
  const f = await fixture(), d = f.deformation;
  const start = front(-1), end = front(1);
  d.begin(start); d.move(end, 1); advance(d, .8);
  assert.ok(displacement(f, front(0)) > .22, 'A sparse crossing includes the front surface midpoint');
  assert.ok(displacement(f, start) > .22 && displacement(f, end) > .22);
  const corner = [.8, .45, .4];
  d.move(corner, 1); advance(d, .4); d.release(); advance(d, 2);
  assert.ok(displacement(f, front(-.5)) > .18 && displacement(f, front(.5)) > .18, 'Earlier path survives the final segment');
  assert.ok(displacement(f, corner) > .15, 'The bend and final end also remain');
  assert.equal(d.step(1 / 60).needsFrame, false);
});

test('单次stroke采用最大包络；重复采样与采样密度不会无界叠加', async () => {
  const sparse = await fixture(), dense = await fixture();
  for (const f of [sparse, dense]) f.deformation.begin(front(-1));
  sparse.deformation.move(front(1), 1);
  for (let i = 1; i <= 80; i++) dense.deformation.move(front(-1 + i / 40), 1);
  advance(sparse.deformation, 1); advance(dense.deformation, 1);
  let difference = 0;
  for (let i = 0; i < sparse.positions.length; i++) difference = Math.max(difference, Math.abs(sparse.positions[i] - dense.positions[i]));
  assert.ok(difference < .001, `Sparse/dense envelope difference ${difference}`);
  const before = dense.positions.slice();
  for (let i = 0; i < 100; i++) dense.deformation.move(front(1), 0);
  advance(dense.deformation, 2); assert.deepEqual(dense.positions, before, 'Revisiting or holding a saturated stroke adds no extra depth');
});

test('30次叠加上限0.30且每次仍只回弹15%；取消旧痕不丢失，reset清空', async () => {
  const { rest, positions, deformation: d } = await fixture();
  let retained = positions.slice(), previousDepth = 0;
  for (let repeat = 0; repeat < 30; repeat++) {
    d.begin([0, .2, .98]); advance(d, .9);
    assert.ok(d.getState().depth <= .300001);
    const pressed = positions.slice(); d.release(); advance(d, 2);
    for (let i = 0; i < positions.length; i++) assert.ok(Math.abs(positions[i] - (retained[i] + (pressed[i] - retained[i]) * .85)) < .000001);
    assert.ok(d.getState().retainedDepth >= previousDepth - .000001 && d.getState().retainedDepth <= .300001);
    previousDepth = d.getState().retainedDepth; retained = positions.slice();
    assert.equal(d.step(1 / 60).needsFrame, false);
  }
  d.begin(front(-1)); d.move(front(1), .8);
  for (let i = 0; i < 20; i++) { d.step(.5); assert.ok(d.getState().depth <= .300001); }
  d.cancel(); advance(d, 2); assert.deepEqual(positions, retained);
  d.setReducedMotion(true); d.begin(front(-.8)); d.move(front(.8), 1); advance(d, .4);
  d.setReducedMotion(false); d.cancel(); advance(d, 2); assert.deepEqual(positions, retained);
  d.reset(); d.step(1 / 60); assert.deepEqual(positions, rest);
  assert.equal(d.getState().active, false); assert.equal(d.getState().retainedDepth, 0);
  assert.equal(d.step(1 / 60).atRest, true);
});

test('下一stroke从永久base继续，异处按压不擦除旧路径', async () => {
  const f = await fixture(), d = f.deformation;
  d.begin(front(-1)); d.move(front(-.6), .4); advance(d, .8); d.release(); advance(d, 2);
  const oldDepth = displacement(f, front(-.9));
  d.begin(front(1)); advance(d, .8); d.release(); advance(d, 2);
  assert.equal(displacement(f, front(-.9)), oldDepth);
  assert.ok(displacement(f, front(1)) > .17);
  const firstDepth = displacement(f, front(1));
  d.begin(front(1)); advance(d, .8); d.release(); advance(d, 2);
  assert.ok(displacement(f, front(1)) > firstDepth && displacement(f, front(1)) <= .300001);
});
