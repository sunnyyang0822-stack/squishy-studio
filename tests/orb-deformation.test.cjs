const { readFileSync } = require('node:fs');
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

test('轻触100ms阻力明显，长按3秒超过旧硬限；实际接触邻域之外不变', async () => {
  const f = await fixture(), { rest, positions, deformation: d } = f;
  const point = [.5, .3, Math.sqrt(1 - .5 ** 2 - .3 ** 2)];
  d.begin(point); advance(d, .1); const early = d.getState().depth;
  assert.ok(early > 0 && early < .025, `100ms light-touch depth ${early}`);
  advance(d, 2.9); assert.ok(d.getState().depth > .30 && d.getState().depth < .92);
  let changed = 0;
  const normals = modelAttribute('NORMAL');
  for (let i = 0; i < rest.length; i += 3) {
    const distance = Math.hypot(...point.map((v, k) => rest[i + k] - v));
    if (distance > .66) for (let k = 0; k < 3; k++) assert.ok(positions[i + k] === rest[i + k], 'Vertices outside the contact neighborhood stay numerically unchanged');
    else if (positions[i] !== rest[i]) {
      changed++;
      const inward = [0, 1, 2].reduce((sum, k) => sum + (rest[i + k] - positions[i + k]) * normals[i + k], 0);
      assert.ok(inward >= -.000001, 'No outward rebound or surrounding lip');
    }
  }
  assert.ok(changed > 100 && changed < rest.length / 12);
  d.move(point, .5); advance(d, .8);
  assert.ok(d.getState().depth > .32 && d.getState().depth < .92);
});

for (const reduced of [false, true]) test(`释放只回弹15%，每顶点单调且无跳变；减少动态=${reduced}`, async () => {
  const { rest, positions, deformation: d } = await fixture(reduced);
  d.begin([-.5, .2, .84]); advance(d, 3.6);
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
  assert.ok(d.getState().retainedDepth > .27 && d.getState().retainedDepth < .40);
  const retained = positions.slice();
  assert.equal(d.step(1 / 60).atRest, false); assert.equal(d.step(1 / 60).needsFrame, false);
  advance(d, 2); assert.deepEqual(positions, retained);
});

test('高速稀疏move在球面插值，中段与起点终点同样留痕，弯折路径完整保留', async () => {
  const f = await fixture(), d = f.deformation;
  const start = front(-1), end = front(1);
  d.begin(start); d.move(end, 1); advance(d, 3.6);
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
  advance(sparse.deformation, 4); advance(dense.deformation, 4);
  let difference = 0;
  for (let i = 0; i < sparse.positions.length; i++) difference = Math.max(difference, Math.abs(sparse.positions[i] - dense.positions[i]));
  assert.ok(difference < .001, `Sparse/dense envelope difference ${difference}`);
  const before = dense.positions.slice();
  for (let i = 0; i < 100; i++) dense.deformation.move(front(1), 0);
  advance(dense.deformation, 2); assert.deepEqual(dense.positions, before, 'Revisiting or holding a saturated stroke adds no extra depth');
});

function meshCenter(rest) {
  return [0, 1, 2].map(k => {
    const values = Array.from({ length: rest.length / 3 }, (_, i) => rest[i * 3 + k]);
    return (Math.min(...values) + Math.max(...values)) / 2;
  });
}
function modelIndices() {
  const bytes = readFileSync('assets/models/squishy-orb.glb'), jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const accessor = gltf.accessors[gltf.meshes[0].primitives[0].indices], view = gltf.bufferViews[accessor.bufferView];
  const start = 28 + jsonLength + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = { 5121: 1, 5123: 2, 5125: 4 }[accessor.componentType];
  assert.ok(stride, 'Read the real GLB index component type');
  const read = stride === 4 ? 'readUInt32LE' : stride === 2 ? 'readUInt16LE' : 'readUInt8';
  return Array.from({ length: accessor.count }, (_, i) => bytes[read](start + i * stride));
}
function assertRadialTopology(rest, positions) {
  const origin = meshCenter(rest);
  for (let i = 0; i < rest.length; i += 3) {
    const before = origin.map((v, k) => rest[i + k] - v), after = origin.map((v, k) => positions[i + k] - v);
    const radius = Math.hypot(...before), current = Math.hypot(...after);
    assert.ok(current >= radius * .08 - .000001 && current <= radius + .000001, 'Each vertex stays between the rest surface and its own 8% radial core');
    const cosine = before.reduce((sum, v, k) => sum + v * after[k], 0) / (radius * current);
    assert.ok(cosine > .999999, 'Radial displacement cannot cross or go around the center');
  }
  const indices = modelIndices();
  for (let i = 0; i < indices.length; i += 3) {
    const points = indices.slice(i, i + 3).map(index => origin.map((v, k) => positions[index * 3 + k] - v));
    const u = points[1].map((v, k) => v - points[0][k]), v = points[2].map((n, k) => n - points[0][k]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const outward = normal.reduce((sum, n, k) => sum + n * points[0][k], 0);
    assert.ok(outward > 0, `Real GLB triangle ${i / 3} must keep outward winding`);
  }
}

test('30次深压逐渐超出旧0.30硬限；85%回弹和径向软极限稳定无硬跳', async () => {
  const { rest, positions, deformation: d } = await fixture();
  let retained = positions.slice(), previousDepth = 0;
  const firstDepths = [];
  for (let repeat = 0; repeat < 30; repeat++) {
    d.begin([0, .2, .98]);
    for (let frame = 0; frame < 432; frame++) {
      const before = positions.slice(); d.step(1 / 120);
      let maximumStep = 0;
      for (let i = 0; i < positions.length; i++) maximumStep = Math.max(maximumStep, Math.abs(positions[i] - before[i]));
      assert.ok(maximumStep < .03, 'Press deformation grows continuously frame by frame');
    }
    assert.ok(d.getState().depth < .95);
    const pressed = positions.slice(); d.release(); advance(d, 2);
    for (let i = 0; i < positions.length; i++) assert.ok(Math.abs(positions[i] - (retained[i] + (pressed[i] - retained[i]) * .85)) < .000001);
    assert.ok(d.getState().retainedDepth >= previousDepth - .000001 && d.getState().retainedDepth < .95);
    previousDepth = d.getState().retainedDepth; retained = positions.slice();
    if (repeat < 5) firstDepths.push(previousDepth);
    assert.equal(d.step(1 / 60).needsFrame, false);
    assertRadialTopology(rest, positions);
  }
  assert.ok(firstDepths[0] > .30 && firstDepths[4] > .65, JSON.stringify(firstDepths));
  for (let i = 1; i < firstDepths.length; i++) assert.ok(firstDepths[i] > firstDepths[i - 1], 'The old 0.30 depth is no longer a stop');
  assert.ok(firstDepths[4] - firstDepths[3] < firstDepths[1] - firstDepths[0], 'Resistance rises smoothly near each radial limit');
  d.begin(front(-1)); d.move(front(1), .8);
  for (let i = 0; i < 20; i++) { d.step(.5); assertRadialTopology(rest, positions); }
  d.cancel(); advance(d, 2); assert.deepEqual(positions, retained);
  d.setReducedMotion(true); d.begin(front(-.8)); d.move(front(.8), 1); advance(d, .4);
  d.setReducedMotion(false); d.cancel(); advance(d, 2); assert.deepEqual(positions, retained);
  d.begin(front(.4)); advance(d, .3);
  d.reset(); assert.deepEqual(positions, rest, 'Hard reset immediately restores the CPU geometry');
  d.step(1 / 60); assert.ok(positions.every((v, i) => v === rest[i]));
  assert.equal(d.getState().active, false); assert.equal(d.getState().retainedDepth, 0);
  assert.equal(d.step(1 / 60).atRest, true);
});

test('多方向30次深压及路径留痕后，每个真实三角形保持朝外且顶点不越中心', async () => {
  const { rest, positions, deformation: d } = await fixture();
  const points = [[1, .0175, 0], [-1, .0175, 0], [0, .94, 0], [0, -.905, 0], [0, .0175, 1], [0, .0175, -1]];
  for (let repeat = 0; repeat < 30; repeat++) {
    d.begin(points[repeat % points.length]);
    if (repeat % 3 === 2) d.move(points[(repeat + 1) % points.length], 1);
    advance(d, 3.6); assertRadialTopology(rest, positions);
    d.release(); advance(d, 2); assertRadialTopology(rest, positions);
  }
  const retained = positions.slice();
  d.begin(front(-.8)); d.move(front(.8), 1); advance(d, .3); d.cancel(); advance(d, 2);
  assert.deepEqual(positions, retained); assert.equal(d.step(1 / 60).needsFrame, false);
  d.reset(); assert.deepEqual(positions, rest);
});

test('下一stroke从永久base继续，异处按压不擦除旧路径', async () => {
  const f = await fixture(), d = f.deformation;
  d.begin(front(-1)); d.move(front(-.6), .4); advance(d, 3.6); d.release(); advance(d, 2);
  const oldDepth = displacement(f, front(-.9));
  d.begin(front(1)); advance(d, 3.6); d.release(); advance(d, 2);
  assert.equal(displacement(f, front(-.9)), oldDepth);
  assert.ok(displacement(f, front(1)) > .17);
  const firstDepth = displacement(f, front(1));
  d.begin(front(1)); advance(d, 3.6); d.release(); advance(d, 2);
  assert.ok(displacement(f, front(1)) > firstDepth && displacement(f, front(1)) < .92);
});

function assertRestoreProgress(rest, snapshot, positions, progress) {
  const remaining = (1 - progress) ** 3;
  for (let i = 0; i < positions.length; i++) {
    const expected = rest[i] + (snapshot[i] - rest[i]) * remaining;
    assert.ok(Math.abs(positions[i] - expected) < .000001, `Vertex coordinate ${i} follows the shared color progress ${progress}`);
  }
}

for (const reduced of [false, true]) test(`颜色时钟驱动复原：启动不跳、同步中间态非零、结束精确归零停帧；减少动态=${reduced}`, async () => {
  const { rest, positions, deformation: d } = await fixture(reduced);
  d.begin(front(-.4)); advance(d, 3.6);
  const snapshot = positions.slice();
  d.beginRestore();
  assert.deepEqual(positions, snapshot, 'Beginning restoration cannot instantly reset the visible dent');
  assert.equal(d.getState().restoring, true); assert.equal(d.getState().active, false);
  assert.equal(d.getState().retainedDepth, 0);
  advance(d, .5); assert.deepEqual(positions, snapshot, 'Elapsed simulation time alone cannot advance the shared color clock');
  let previous = snapshot.slice();
  for (const progress of [0, .25, .5, .75]) {
    d.applyRestore(progress); d.step(1 / 120);
    assertRestoreProgress(rest, snapshot, positions, progress);
    assert.ok(d.getState().depth > 0 && d.getState().restoring, 'The dent remains during the color transition');
    for (let i = 0; i < positions.length; i++) assert.ok(Math.abs(positions[i] - rest[i]) <= Math.abs(previous[i] - rest[i]) + .000001);
    previous = positions.slice(); advance(d, .5);
    assert.deepEqual(positions, previous, 'No extra spring or recovery runs between supplied progress updates');
  }
  d.applyRestore(1); const finalStep = d.step(1 / 120);
  assert.ok(positions.every((v, i) => v === rest[i]), 'Color completion restores every coordinate exactly, allowing equivalent signed zeros');
  assert.equal(d.getState().restoring, false); assert.equal(d.getState().depth, 0);
  assert.equal(finalStep.atRest, true); assert.equal(finalStep.needsFrame, false);
  const frozen = positions.slice(); advance(d, .5); assert.deepEqual(positions, frozen);
});

test('快速再次换色从当前恢复帧接续；恢复中cancel不会突然归零', async () => {
  const { rest, positions, deformation: d } = await fixture();
  d.begin(front(.2)); advance(d, 3.6); d.release(); advance(d, 2);
  d.beginRestore(); d.applyRestore(.25); d.step(1 / 120);
  const current = positions.slice();
  d.beginRestore(); assert.deepEqual(positions, current);
  d.applyRestore(0); d.step(1 / 120); assert.deepEqual(positions, current);
  d.applyRestore(.5); d.step(1 / 120); assertRestoreProgress(rest, current, positions, .5);
  const beforeCancel = positions.slice();
  d.cancel(); assert.deepEqual(positions, beforeCancel, 'Cancelling input must not clear an in-progress color restoration');
  d.step(1 / 120); assert.deepEqual(positions, beforeCancel);
  assert.ok(d.getState().depth > 0);
  d.reset(); assert.deepEqual(positions, rest);
});

test('恢复中重新按压直接接续当前形态，取消只回到接续基准且旧恢复时钟无效', async () => {
  const { positions, deformation: d } = await fixture();
  d.begin(front(-.3)); advance(d, 3.6); d.release(); advance(d, 2);
  d.beginRestore(); d.applyRestore(.3); d.step(1 / 120);
  const current = positions.slice();
  d.begin(front(.6));
  assert.deepEqual(positions, current, 'A new press interrupts restoration without a visible jump');
  assert.equal(d.getState().restoring, false); assert.equal(d.getState().active, true);
  assert.ok(d.getState().retainedDepth > 0);
  d.applyRestore(1); assert.deepEqual(positions, current, 'A stale color progress update cannot erase the new press baseline');
  advance(d, .5); assert.notDeepEqual(positions, current);
  d.cancel(); d.step(1 / 120); assert.deepEqual(positions, current);
  assert.equal(d.getState().restoring, false); assert.equal(d.step(1 / 60).needsFrame, false);
});

test('显式interruptRestore保留当前形态，之后不再自动回弹且可继续按压', async () => {
  const { positions, deformation: d } = await fixture();
  d.begin(front(.3)); advance(d, 3.6);
  d.beginRestore(); d.applyRestore(.5); d.step(1 / 120);
  const current = positions.slice();
  d.interruptRestore(); assert.deepEqual(positions, current);
  assert.equal(d.getState().restoring, false); assert.ok(d.getState().retainedDepth > 0);
  d.applyRestore(1); advance(d, 1); assert.deepEqual(positions, current);
  d.begin(front(-.6)); advance(d, .5); assert.notDeepEqual(positions, current);
  d.cancel(); d.step(1 / 120); assert.deepEqual(positions, current);
});
