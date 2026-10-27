const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { modelAttribute } = require('./helpers/orb-probe.cjs');
const front = theta => [Math.sin(theta), .0175, Math.cos(theta)];
async function fixture(reducedMotion = false, feelId = 'slow-rebound') {
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const rest = modelAttribute('POSITION'), positions = rest.slice();
  return { rest, positions, d: getOrbFeel(feelId).createDeformation(positions, modelAttribute('NORMAL'), { reducedMotion }) };
}
function advance(d, seconds, dt = 1 / 60) {
  let result;
  for (let t = 0; t < seconds - 1e-9; t += dt) result = d.step(Math.min(dt, seconds - t));
  return result;
}
function depth(f, point) {
  let nearest = 0, minimum = Infinity;
  for (let i = 0; i < f.rest.length; i += 3) {
    const distance = point.reduce((sum, v, k) => sum + (v - f.rest[i + k]) ** 2, 0);
    if (distance < minimum) { minimum = distance; nearest = i; }
  }
  return Math.hypot(...[0, 1, 2].map(k => f.positions[nearest + k] - f.rest[nearest + k]));
}
function maximum(f) {
  let result = 0;
  for (let i = 0; i < f.rest.length; i += 3) result = Math.max(result, Math.hypot(...[0, 1, 2].map(k => f.positions[i + k] - f.rest[i + k])));
  return result;
}
function fullyRecover(f, seconds = 14) {
  const step = advance(f.d, seconds);
  assert.deepEqual(f.positions, f.rest, 'Every actual GLB coordinate naturally returns exactly to rest');
  assert.equal(maximum(f), 0);
  assert.deepEqual(step, { changed: false, atRest: true, needsFrame: false });
}
function stroke(f, seconds, from = -1, to = 1, dt = 1 / 60, inputHz = 60) {
  let lastEvent = -Infinity;
  for (let t = dt; t < seconds + dt / 2; t += dt) {
    if (t - lastEvent >= 1 / inputHz - 1e-9 || t >= seconds - 1e-9) {
      f.d.move(front(from + (to - from) * Math.min(1, t / seconds)), 1);
      lastEvent = t;
    }
    f.d.step(dt);
  }
}
function modelIndices() {
  const bytes = readFileSync('assets/models/squishy-orb.glb'), jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const accessor = gltf.accessors[gltf.meshes[0].primitives[0].indices], view = gltf.bufferViews[accessor.bufferView];
  const start = 28 + jsonLength + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = { 5121: 1, 5123: 2, 5125: 4 }[accessor.componentType];
  const read = { 1: 'readUInt8', 2: 'readUInt16LE', 4: 'readUInt32LE' }[stride];
  return Array.from({ length: accessor.count }, (_, i) => bytes[read](start + i * stride));
}
function safe(f) {
  const origin = [0, 1, 2].map(k => {
    const values = Array.from({ length: f.rest.length / 3 }, (_, i) => f.rest[i * 3 + k]);
    return (Math.min(...values) + Math.max(...values)) / 2;
  });
  for (let i = 0; i < f.rest.length; i += 3) {
    const before = origin.map((v, k) => f.rest[i + k] - v), after = origin.map((v, k) => f.positions[i + k] - v);
    assert.ok(after.every(Number.isFinite));
    assert.ok(Math.hypot(...after) >= Math.hypot(...before) * .49999);
    assert.ok(Math.hypot(...after) <= Math.hypot(...before) + 1e-6);
  }
  const indices = modelIndices();
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map(n => Array.from(f.positions.slice(n * 3, n * 3 + 3)));
    const ab = b.map((v, k) => v - a[k]), ac = c.map((v, k) => v - a[k]);
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    assert.ok(cross.reduce((sum, v, k) => sum + v * (a[k] + b[k] + c[k] - 3 * origin[k]), 0) > 0, 'Every GLB triangle faces outward');
  }
}

test('慢回弹独立登记且默认仍为clay；首帧/100ms渐进下陷，与黏土可量测区分', async t => {
  const { getOrbFeel, orbFeels } = await import('../src/orb-feels.mjs');
  assert.equal(getOrbFeel().id, 'clay');
  assert.ok(Object.isFrozen(orbFeels['slow-rebound']));
  assert.notEqual(getOrbFeel().createDeformation, getOrbFeel('slow-rebound').createDeformation);
  const slow = await fixture(), clay = await fixture(false, 'clay');
  slow.d.begin(front(0)); assert.deepEqual(slow.positions, slow.rest);
  slow.d.step(1 / 60); const first = maximum(slow);
  assert.ok(first > .0004 && first < .0007, 'A gentle onset makes the first-frame indentation small');
  advance(slow.d, .1 - 1 / 60); const short = maximum(slow);
  assert.ok(short > .015 && short < .025, '100ms shows the beginning of a gradual press');
  advance(slow.d, .2); const responsive = maximum(slow);
  assert.ok(responsive > .10 && responsive < .12, '300ms is visibly indented while the downward process continues');
  advance(slow.d, 2.7); const long = maximum(slow);
  assert.ok(long > .44 && long < .46, 'A sustained press continues to a deeper bounded indentation');
  clay.d.begin(front(0)); advance(clay.d, .1);
  advance(clay.d, 2.9);
  slow.d.release(); clay.d.release(); advance(slow.d, 2); advance(clay.d, 2);
  assert.ok(maximum(clay) > maximum(slow) * 3);
  t.diagnostic(JSON.stringify({ firstFrame: first, at100ms: short, at300ms: responsive, at3s: long, slowAfter2s: maximum(slow), clayAfter2s: maximum(clay) }));
  fullyRecover(slow);
});

test('厚实哑光外观独立于手感：仅full-matte增厚和加深，默认外观完全保留', async () => {
  const { getOrbAppearance, orbAppearances } = await import('../src/orb-appearance.mjs');
  assert.deepEqual(getOrbAppearance(), { id: 'matte', scale: [1, 1, 1], pigmentGain: 1 });
  assert.deepEqual(getOrbAppearance('full-matte'), { id: 'full-matte', scale: [1, 1, 1], pigmentGain: .94 });
  assert.ok(Object.isFrozen(orbAppearances) && Object.isFrozen(orbAppearances['full-matte'].scale));
  for (const id of ['slow-rebound', 'missing', 'constructor']) assert.throws(() => getOrbAppearance(id), RangeError);
});

test('反馈修订不改变用户确认的回弹曲线、减少动态恢复或最终收敛', async () => {
  const { slowReboundParameters: p } = await import('../src/orb-slow-rebound.mjs');
  assert.equal(p.recoveryRate, .80); assert.equal(p.reducedRecoveryRate, 5);
  assert.equal(p.convergence, .00001); assert.equal(p.maximumDepth, .46);
  const f = await fixture(); f.d.begin(front(0)); advance(f.d, .3); f.d.release();
  const before = maximum(f); advance(f.d, .5);
  assert.ok(Math.abs(maximum(f) / before - Math.exp(-.8 * .5)) < .000002);
  fullyRecover(f);
});

test('按压有平滑起步，120ms后匀速深入，没有先猛陷再缓慢逼近的尾段', async t => {
  const f = await fixture(); f.d.begin(front(0));
  advance(f.d, 1 / 60); assert.ok(maximum(f) < .003);
  advance(f.d, .12 - 1 / 60); const values = [maximum(f)];
  for (let i = 0; i < 2; i++) { advance(f.d, .05); values.push(maximum(f)); }
  const increments = values.slice(1).map((value, i) => value - values[i]);
  assert.ok(increments[0] > .02 && increments[0] < .025);
  for (const increment of increments) assert.ok(Math.abs(increment - increments[0]) < .000001);
  advance(f.d, .65); assert.ok(maximum(f) > .35 && maximum(f) < .38);
  advance(f.d, .4); assert.ok(maximum(f) > .44 && maximum(f) < .46);
  safe(f); f.d.release(); fullyRecover(f);
  t.diagnostic(JSON.stringify({ timesMs: [120, 170, 220], values, increments }));
});

for (const reduced of [false, true]) test(`松开初期保持凹陷；每个顶点单调恢复、精确归零且停帧；reduce=${reduced}`, async t => {
  const f = await fixture(reduced); f.d.begin(front(-.4)); advance(f.d, 4);
  const pressed = f.positions.slice(), initial = maximum(f); f.d.release();
  assert.deepEqual(f.positions, pressed);
  let result = f.d.step(1 / 60);
  assert.ok(maximum(f) > initial * (reduced ? .9 : .98)); assert.equal(result.needsFrame, true);
  let previous = f.positions.slice(), maxFinalStep = 0, stoppedAt;
  for (let frame = 1; frame <= 840; frame++) {
    result = f.d.step(1 / 60);
    for (let i = 0; i < f.rest.length; i++) assert.ok(Math.abs(f.positions[i] - f.rest[i]) <= Math.abs(previous[i] - f.rest[i]) + 1e-7);
    if (result.atRest) {
      maxFinalStep = Math.max(...previous.map((v, i) => Math.abs(v - f.positions[i])));
      stoppedAt = (frame + 1) / 60; break;
    }
    assert.equal(result.needsFrame, true); previous = f.positions.slice();
  }
  assert.ok(stoppedAt > (reduced ? 1 : 10) && stoppedAt < (reduced ? 2.5 : 14));
  assert.ok(maxFinalStep <= .000011, 'Final convergence is below 0.004 display pixels at 350px/model unit');
  fullyRecover(f, .1);
  t.diagnostic(JSON.stringify({ reduced, stoppedAt, maxFinalStep, finalError: maximum(f) }));
});

test('驻留起点→滑动→驻留终点：中段浅、松手不造坑，整条路径恢复', async t => {
  const f = await fixture(); f.d.begin(front(-1)); advance(f.d, 2.5);
  const initialDwell = depth(f, front(-1));
  stroke(f, .7); advance(f.d, 1.3);
  const measurements = [-1, 0, 1].map(angle => depth(f, front(angle)));
  assert.ok(initialDwell > measurements[1] * 3, 'The initial dwelling contact is deeper; it then recovers while the endpoint is held');
  assert.ok(measurements[2] > measurements[1] * 3);
  assert.ok(measurements[1] > .03 && measurements[1] < .06, 'The recovered middle stays visible and shallower than the held endpoint');
  const held = f.positions.slice(); f.d.release(); assert.deepEqual(f.positions, held);
  f.d.step(1 / 60); assert.ok(depth(f, front(1)) < measurements[2]);
  t.diagnostic(JSON.stringify({ angles: [-1, 0, 1], depths: measurements }));
  fullyRecover(f);
});

test('长按后移到新位置，只接收当前帧接触量，不继承旧压深', async () => {
  const f = await fixture(); f.d.begin(front(-1)); advance(f.d, 8);
  assert.equal(depth(f, front(1)), 0);
  f.d.move(front(1)); f.d.step(1 / 60);
  assert.ok(depth(f, front(1)) < .03, 'A sparse cross-surface path does not teleport a full deep press');
  advance(f.d, .1 - 1 / 60);
  assert.ok(depth(f, front(1)) > .085 && depth(f, front(1)) < .11);
  const early = depth(f, front(1)); advance(f.d, 2);
  assert.ok(depth(f, front(1)) > early * 1.05);
  f.d.release(); fullyRecover(f);
});

for (const seconds of [.12, .8, 4]) test(`连续滑动${seconds}s无驻留：无均匀深沟、路径连通且完全恢复`, async () => {
  const f = await fixture(); f.d.begin(front(-1.2)); stroke(f, seconds, -1.2, 1.2);
  const limits = seconds === 4 ? [.19, .201] : seconds === .8 ? [.16, .20] : [.02, .03];
  assert.ok(maximum(f) > limits[0] && maximum(f) < limits[1], 'Visible track remains shallower than a stationary press');
  for (const angle of [-1, -.5, 0, .5, 1]) assert.ok(depth(f, front(angle)) > .0001);
  safe(f); f.d.release(); fullyRecover(f);
});

test('折返、交叉、重复揉压有界；旧痕和新痕最终共同消失', async () => {
  const f = await fixture(); f.d.begin(front(-1));
  for (let repeat = 0; repeat < 8; repeat++) {
    stroke(f, .3, -1, 1); stroke(f, .3, 1, -1);
    f.d.move([0, .8, .5]); advance(f.d, .15); f.d.move(front(-1)); advance(f.d, .15);
    assert.ok(maximum(f) < .46); safe(f);
  }
  f.d.release(); advance(f.d, 1);
  const current = f.positions.slice(); f.d.begin(front(.8)); assert.deepEqual(f.positions, current);
  advance(f.d, 2); assert.ok(depth(f, front(-.6)) > 0 && depth(f, front(.8)) > .10);
  f.d.release(); fullyRecover(f);
});

test('深按、长按及多轮多方向按压无残差、不外翻、不越界', async () => {
  const f = await fixture();
  for (const point of [front(0), [1, .0175, 0], [-1, .0175, 0], [0, .94, 0], [0, -.905, 0], [0, .0175, -1]]) {
    f.d.begin(point); advance(f.d, 18); assert.ok(maximum(f) <= .460001); safe(f);
    f.d.release(); fullyRecover(f);
  }
});

test('稀疏跨越、同帧重复move不加深；不同刷新与事件密度处于有限误差内', async t => {
  const sparse = await fixture(), repeated = await fixture();
  for (const f of [sparse, repeated]) f.d.begin(front(-1));
  sparse.d.move(front(1));
  for (let i = 1; i <= 100; i++) repeated.d.move(front(-1 + i / 50));
  sparse.d.step(.05); repeated.d.step(.05);
  assert.ok(depth(sparse, front(0)) > .0001);
  assert.ok(Math.max(...sparse.positions.map((v, i) => Math.abs(v - repeated.positions[i]))) < .0001);
  const results = [];
  for (const [dt, hz] of [[1 / 30, 30], [1 / 60, 60], [1 / 120, 120], [1 / 60, 10]]) {
    const f = await fixture(); f.d.begin(front(-1)); advance(f.d, 1, dt);
    stroke(f, 2, -1, 1, dt, hz); advance(f.d, .8, dt); f.d.release(); advance(f.d, .5, dt);
    results.push({ dt, hz, positions: f.positions.slice() }); fullyRecover(f);
  }
  const errors = results.map(f => Math.max(...f.positions.map((v, i) => Math.abs(v - results[1].positions[i]))));
  for (const error of errors) assert.ok(error < .004, `Sampling error ${error} (<1.2% of maximum depth)`);
  t.diagnostic(JSON.stringify({ configurations: results.map(({ dt, hz }) => ({ dt, hz })), maxCoordinateErrors: errors }));
});

test('显式换色恢复独占时钟；快速重启、取消与输入中断连续接管', async () => {
  const f = await fixture(); f.d.begin(front(-.6)); advance(f.d, 3); f.d.release();
  f.d.beginRestore(); const start = f.positions.slice(); advance(f.d, .4); assert.deepEqual(f.positions, start);
  f.d.applyRestore(.3); f.d.step(1 / 60);
  for (let i = 0; i < start.length; i++) assert.ok(Math.abs(f.positions[i] - (f.rest[i] + (start[i] - f.rest[i]) * .7 ** 3)) < 1e-6);
  const current = f.positions.slice(); f.d.cancel(); advance(f.d, .3); assert.deepEqual(f.positions, current);
  f.d.beginRestore(); f.d.applyRestore(0); f.d.step(1 / 60); assert.deepEqual(f.positions, current);
  f.d.begin(front(.7)); assert.deepEqual(f.positions, current); f.d.applyRestore(1); assert.deepEqual(f.positions, current);
  advance(f.d, 1); f.d.release(); fullyRecover(f);
  f.d.begin(front(0)); advance(f.d, 1); f.d.beginRestore(); f.d.applyRestore(.5); f.d.step(1 / 60);
  f.d.interruptRestore(); const interrupted = maximum(f); advance(f.d, .2); assert.ok(maximum(f) < interrupted);
  f.d.beginRestore(); f.d.applyRestore(1); const result = f.d.step(1 / 60);
  assert.deepEqual(f.positions, f.rest); assert.equal(result.needsFrame, false);
});

test('取消缓慢恢复；reset清空计时和旧路径；减少动态切换、实例和资产隔离', async () => {
  const f = await fixture(), other = await fixture();
  f.d.begin(front(-1)); advance(f.d, 2); f.d.move(front(1)); f.d.cancel();
  const before = f.positions.slice(); assert.deepEqual(f.positions, before); assert.equal(f.d.getState().active, false);
  assert.equal(f.d.step(1 / 60).needsFrame, true); fullyRecover(f);
  f.d.begin(front(-1)); advance(f.d, 2); f.d.move(front(1)); f.d.reset();
  assert.deepEqual(f.positions, f.rest); assert.equal(f.d.getState().held, 0);
  assert.deepEqual(f.d.step(.1), { changed: true, atRest: true, needsFrame: false });
  advance(f.d, 2); assert.deepEqual(f.positions, f.rest);
  f.d.begin(front(.5)); advance(f.d, 1); f.d.cancel(); f.d.setReducedMotion(true); fullyRecover(f, 2.5);
  f.d.setReducedMotion(false); f.d.begin(front(0)); advance(f.d, 1);
  assert.deepEqual(other.positions, other.rest); assert.deepEqual(modelAttribute('POSITION'), f.rest);
  f.d.release(); fullyRecover(f);
});
