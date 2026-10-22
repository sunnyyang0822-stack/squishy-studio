const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { modelAttribute } = require('./helpers/orb-probe.cjs');
const front = a => [Math.sin(a), .0175, Math.cos(a)];
async function fixture(id = 'marshmallow') {
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const rest = modelAttribute('POSITION'), positions = rest.slice();
  return { rest, positions, d: getOrbFeel(id).createDeformation(positions, modelAttribute('NORMAL')) };
}
function advance(d, time, dt = 1 / 120) { for (let t = 0; t < time - 1e-9; t += dt) d.step(Math.min(dt, time - t)); }
function depth(f, a) {
  const point = front(a); let best = Infinity, index = 0;
  for (let i = 0; i < f.rest.length; i += 3) {
    const distance = Math.hypot(...point.map((v, k) => f.rest[i + k] - v));
    if (distance < best) { best = distance; index = i; }
  }
  return Math.hypot(...point.map((_, k) => f.positions[index + k] - f.rest[index + k]));
}
test('real GLB: visible progressive collapse, moderately faster than clay; release/cancel freezes every vertex and sleeps', async () => {
  for (const end of ['release', 'cancel']) {
    const f = await fixture(), clay = await fixture('clay');
    f.d.begin(front(0)); clay.d.begin(front(0));
    for (const t of [.008333333, .025, .05, .1]) {
      f.d.reset(); clay.d.reset(); f.d.begin(front(0)); clay.d.begin(front(0));
      advance(f.d, t); advance(clay.d, t);
      assert.ok(depth(f, 0) > depth(clay, 0) * 1.3 && depth(f, 0) < depth(clay, 0) * 3);
      assert.ok(depth(f, 0) < .04, 'A short press must stay shallow');
    }
    const snapshot = f.positions.slice(); f.d[end]();
    assert.deepEqual(f.positions, snapshot);
    for (const t of [.001, 1, 30]) { advance(f.d, t); assert.deepEqual(f.positions, snapshot); }
    assert.equal(f.d.step(.016).needsFrame, false);
    f.d.begin(front(.8)); assert.deepEqual(f.positions, snapshot); f.d.step(.016);
    assert.notDeepEqual(f.positions, snapshot);
  }
});
test('real GLB: fast/slow/long/reversed/crossing paths, sparse events, event density and frame steps', async () => {
  for (const duration of [.1, .6, 2]) for (const frames of [30, 60, 120]) for (const events of [2, 12, 60]) {
    const f = await fixture(); f.d.begin(front(-1));
    let next = 1;
    for (let t = 1 / frames; t < duration + 1 / frames - 1e-9; t += 1 / frames) {
      while (next <= events && next / events * duration <= t + 1e-9) { f.d.move(front(-1 + 2 * next / events), 1); next++; }
      f.d.step(Math.min(1 / frames, duration));
    }
    const samples = [-1, -.75, -.5, -.25, 0, .25, .5, .75, 1].map(a => depth(f, a));
    assert.ok(Math.min(...samples) > .04, JSON.stringify({ duration, frames, events, samples }));
    assert.ok(Math.max(...samples) - Math.min(...samples) < .065, JSON.stringify({ duration, frames, events, samples }));
    f.d.release(); const snapshot = f.positions.slice(); advance(f.d, 2); assert.deepEqual(f.positions, snapshot);
    for (let repeat = 0; repeat < 15; repeat++) {
      f.d.begin(front(1)); f.d.move(front(-1), 1); f.d.move([0, .94, 0], 1); f.d.move(front(1), 1);
      advance(f.d, .1); f.d.release();
    }
    assert.ok(f.positions.every(Number.isFinite)); assert.ok(f.d.getState().depth <= .700001);
    for (let i = 0; i < f.rest.length; i += 3) {
      const r = Math.hypot(f.rest[i], f.rest[i + 1] - .0175, f.rest[i + 2]);
      const current = Math.hypot(f.positions[i], f.positions[i + 1] - .0175, f.positions[i + 2]);
      assert.ok(current >= r * .239);
    }
  }
});
test('explicit restore, interruption, reset and instance isolation', async () => {
  const f = await fixture(), other = await fixture(); f.d.begin(front(0)); advance(f.d, .1); f.d.cancel();
  const before = f.positions.slice(); f.d.beginRestore(); assert.deepEqual(f.positions, before);
  f.d.applyRestore(.3); f.d.step(.016); const current = f.positions.slice();
  f.d.begin(front(.6)); assert.deepEqual(f.positions, current); f.d.applyRestore(1); assert.deepEqual(f.positions, current);
  advance(f.d, .1); f.d.release(); const dent = f.positions.slice(); advance(f.d, 1); assert.deepEqual(f.positions, dent);
  f.d.beginRestore(); f.d.applyRestore(1); assert.equal(f.d.step(.016).atRest, true);
  f.d.reset(); assert.deepEqual(f.positions, f.rest); assert.deepEqual(other.positions, other.rest);
});
test('measured GLB endpoint/middle curves with and without dwell: density and frame tolerances', async () => {
  const report = await require('./helpers/marshmallow-metrics.cjs')();
  for (const path of report.paths) {
    assert.ok(path.maxDifference < .065, JSON.stringify(path));
    assert.equal(path.releaseDrift, 0);
    const sameDuration = report.paths.filter(p => p.duration === path.duration && p.dwell === path.dwell);
    for (const other of sameDuration) for (let i = 0; i < path.samples.length; i++) {
      assert.ok(Math.abs(path.samples[i].depth - other.samples[i].depth) < .065);
    }
  }
});
test('optical material isolation preserves clay defaults and source, with separate soft fibre response', async () => {
  const { MeshStandardMaterial } = await import('three');
  const { createOrbMaterial } = await import('../src/orb-optics.mjs');
  const source = new MeshStandardMaterial(); const clay = createOrbMaterial(source, 'clay');
  const soft = createOrbMaterial(source, 'marshmallow');
  assert.equal(clay.roughness, .82); assert.equal(source.roughness, 1);
  assert.equal(soft.sheen, .8); assert.equal(soft.roughness, 1); soft.color.set('red');
  assert.equal(clay.color.getHex(), 0xffffff); assert.equal(source.color.getHex(), 0xffffff);
  source.dispose(); clay.dispose(); soft.dispose();
});
test('real GLB triangles retain outward winding after multidirectional crossing and repeated kneading; no input teleport', async () => {
  const f = await fixture(); f.d.begin(front(-1)); f.d.move(front(1), 1);
  assert.deepEqual(f.positions, f.rest); f.d.step(0); assert.deepEqual(f.positions, f.rest);
  const bytes = readFileSync('assets/models/squishy-orb.glb'), jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const accessor = gltf.accessors[gltf.meshes[0].primitives[0].indices], view = gltf.bufferViews[accessor.bufferView];
  const start = 28 + jsonLength + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = { 5121: 1, 5123: 2, 5125: 4 }[accessor.componentType];
  const read = stride === 4 ? 'readUInt32LE' : stride === 2 ? 'readUInt16LE' : 'readUInt8';
  const indices = Array.from({ length: accessor.count }, (_, i) => bytes[read](start + i * stride));
  const points = [[1, .0175, 0], [-1, .0175, 0], [0, .94, 0], [0, -.905, 0], front(0), [0, .0175, -1]];
  for (let repeat = 0; repeat < 30; repeat++) {
    f.d.begin(points[repeat % 6]); f.d.move(points[(repeat + 1) % 6], 1); advance(f.d, .2); f.d.release();
    for (let i = 0; i < indices.length; i += 3) {
      const p = indices.slice(i, i + 3).map(index => [f.positions[index * 3], f.positions[index * 3 + 1] - .0175, f.positions[index * 3 + 2]]);
      const u = p[1].map((v, k) => v - p[0][k]), v = p[2].map((v, k) => v - p[0][k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      assert.ok(n.reduce((sum, v, k) => sum + v * p[0][k], 0) > 0, 'No inverted triangle ' + i / 3);
    }
  }
});

test('deep collapse leaves a small bounded core and repeated strokes cannot drill through it', async () => {
  const f = await fixture();
  for (let n = 0; n < 40; n++) {
    f.d.begin(front(0)); advance(f.d, .5); f.d.release();
  }
  assert.ok(depth(f, 0) > .68 && depth(f, 0) <= .700001);
  let index = 0;
  for (let i = 3; i < f.rest.length; i += 3) if (f.rest[i + 2] > f.rest[index + 2]) index = i;
  const radius = Math.hypot(f.positions[index], f.positions[index + 1] - .0175, f.positions[index + 2]);
  assert.ok(radius > .23 && radius < .33, 'remaining front core radius: ' + radius);
  const frozen = f.positions.slice();
  advance(f.d, 30);
  assert.deepEqual(f.positions, frozen);
});

test('press has visible stages, one hold cannot hit the safety boundary, and a new press takes over continuously', async () => {
  const f = await fixture();
  f.d.begin(front(0));
  assert.equal(f.d.step(0).needsFrame, true, 'pressure ramp must wake even before first elapsed frame');
  const stages = [];
  for (let frame = 1; frame <= 180; frame++) {
    const previous = depth(f, 0); f.d.step(1 / 60);
    const current = depth(f, 0);
    assert.ok(current >= previous && current - previous < .007, 'smooth monotone press per frame');
    if ([1, 6, 18, 30, 60, 120, 180].includes(frame)) stages.push(current);
  }
  assert.ok(stages[0] > .002 && stages[0] < .007);
  assert.ok(stages[1] > .02 && stages[1] < .04);
  assert.ok(stages[2] > .06 && stages[2] < .10);
  assert.ok(stages[3] > .11 && stages[3] < .15);
  assert.ok(stages[4] > .21 && stages[4] < .26);
  assert.ok(stages[6] > .39 && stages[6] < .43);
  f.d.release(); const frozen = f.positions.slice(); advance(f.d, 5);
  assert.deepEqual(f.positions, frozen);
  f.d.begin(front(0)); assert.deepEqual(f.positions, frozen);
  f.d.step(1 / 60);
  assert.ok(depth(f, 0) > stages[6] && depth(f, 0) - stages[6] < .004);
});

test('stationary event density and frame rate do not accelerate pressing; reduced motion keeps its process', async () => {
  const reference = await fixture(); reference.d.begin(front(0)); advance(reference.d, .3);
  for (const hz of [30, 60, 120]) {
    const f = await fixture(); f.d.setReducedMotion(true); f.d.begin(front(0));
    for (let frame = 0; frame < hz * .3; frame++) {
      for (let event = 0; event < 20; event++) f.d.move(front(event % 2 ? .001 : -.001));
      f.d.step(1 / hz);
    }
    assert.ok(Math.abs(depth(f, 0) - depth(reference, 0)) < .005);
    f.d.cancel(); const frozen = f.positions.slice(); advance(f.d, 2);
    assert.deepEqual(f.positions, frozen);
  }
});

test('a stalled render cannot skip the visible press process or consume a whole hold', async () => {
  const f = await fixture(); f.d.begin(front(0));
  f.d.step(2);
  assert.ok(depth(f, 0) > .008 && depth(f, 0) < .02);
  assert.ok(f.d.getState().held <= .04 && f.d.step(0).needsFrame);
  const before = depth(f, 0);
  f.d.step(3);
  assert.ok(depth(f, 0) > before && depth(f, 0) - before < .02);
  f.d.release(); const frozen = f.positions.slice();
  f.d.step(10); assert.deepEqual(f.positions, frozen);
});
