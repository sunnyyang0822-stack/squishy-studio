const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

test('实际位移安全段检查首个折叠根，不能只接受同样合法的终点', async () => {
  const { createOffsetSafety } = await import('../src/surface-clay.mjs');
  const rest = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const directions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const constrain = createOffsetSafety(rest, directions, [0, 1, 2]);
  const from = new Float32Array(3), candidate = Float32Array.from([0, 2, 2]);
  // Endpoints both have +1 projected area; halfway collapses, then reverses.
  assert.equal((1 - candidate[1]) * (1 - candidate[2]), 1);
  const alpha = constrain(from, candidate);
  assert.ok(alpha > .35 && alpha < .36, `first root ${alpha}`);
  for (let i = 0; i <= 1000; i++) {
    const fraction = i / 1000;
    assert.ok((1 - candidate[1] * fraction) * (1 - candidate[2] * fraction) >= .08);
  }
  const restore = new Float32Array(3);
  assert.equal(constrain(candidate, restore), 1, 'Accepted state has an entirely safe route to exact rest');
  assert.deepEqual(restore, new Float32Array(3));
});

for (const feelId of ['clay', 'marshmallow']) test(`${feelId}：未限制的可选几何hook逐帧保留模板结果及生命周期`, async () => {
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const rest = Float32Array.from([0, 0, 1, 0, 0, -1, 1, 0, 0, -1, 0, 0]);
  const a = rest.slice(), b = rest.slice(); let calls = 0;
  const spatial = { directions: rest.slice(), radii: new Float32Array(4).fill(1),
    neighborhood: point => Array.from({ length: 4 }, (_, i) => [i, Math.hypot(...point.map((v, k) => v - rest[i * 3 + k]))]),
    path: (_from, to) => [to] };
  const ordinary = getOrbFeel(feelId).createDeformation(a, rest, { surfaceGeometry: spatial });
  const adapted = getOrbFeel(feelId).createDeformation(b, rest, { surfaceGeometry: { ...spatial, constrainOffsets() { calls++; return 1; } } });
  const run = (method, ...args) => { ordinary[method](...args); adapted[method](...args); assert.deepEqual(ordinary.getState(), adapted.getState()); };
  const frames = count => { for (let i = 0; i < count; i++) { assert.deepEqual(ordinary.step(1 / 60), adapted.step(1 / 60)); assert.deepEqual(a, b); } };
  run('begin', [0, 0, 1]); frames(170); run('move', [.1, 0, 1], .2); frames(30); run('release'); frames(120);
  run('begin', [0, 0, 1]); frames(20); run('cancel'); frames(120);
  run('beginRestore'); for (let i = 0; i <= 10; i++) { run('applyRestore', i / 10); frames(1); }
  run('begin', [0, 0, 1]); frames(5); run('reset'); frames(1);
  assert.ok(calls > 0); assert.deepEqual(a, rest); assert.deepEqual(b, rest);
});

for (const feelId of ['clay', 'marshmallow']) test(`${feelId}：真实厚猫爪所有输入生命周期保留原三角形面积安全裕量`, async () => {
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const mesh = readMesh('./assets/models/squishy-paw.glb');
  const rest = Float32Array.from(mesh.positions), positions = rest.slice(), normals = Float32Array.from(mesh.normals);
  const geometry = createSurfaceGeometry(rest, normals, mesh.indices, { depthAxis: 2 });
  assert.equal(typeof geometry.constrainOffsets, 'function', 'Nonstar padded asset uses actual segment safety');
  const deformation = getOrbFeel(feelId).createDeformation(positions, normals, { surfaceGeometry: geometry });
  function area(source, a, b, c) {
    const u = [0, 1, 2].map(k => source[b * 3 + k] - source[a * 3 + k]);
    const v = [0, 1, 2].map(k => source[c * 3 + k] - source[a * 3 + k]);
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  }
  const faces = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const tri = mesh.indices.slice(i, i + 3), n = area(rest, ...tri);
    faces.push({ tri, n, square: n.reduce((s, v) => s + v * v, 0) });
  }
  function check() {
    assert.ok(positions.every(Number.isFinite));
    for (const { tri, n, square } of faces) {
      const after = area(positions, ...tri);
      assert.ok(n.reduce((s, v, k) => s + v * after[k], 0) / square >= .08, 'Original normal-dot safety plus original .08 area margin');
    }
  }
  function advance(count) { for (let i = 0; i < count; i++) { deformation.step(1 / 60); if (i % 30 === 0) check(); } check(); }
  let selected = 0; for (let i = 0; i < rest.length; i += 3) if (rest[i + 2] > rest[selected + 2]) selected = i;
  const hit = Array.from(rest.slice(selected, selected + 3));
  for (let stroke = 0; stroke < 3; stroke++) {
    deformation.begin(hit); advance(180); deformation.move(hit.map((v, k) => v + (k === 0 ? .06 : 0)), .2); advance(30);
    deformation.release(); advance(60);
  }
  deformation.begin(hit); advance(15); deformation.cancel(); advance(60);
  deformation.beginRestore();
  for (let i = 0; i <= 20; i++) { deformation.applyRestore(i / 20); advance(1); }
  assert.deepEqual(positions, rest, 'Full restoration reaches this exact asset');
  deformation.begin(hit); advance(15); deformation.reset(); check(); assert.deepEqual(positions, rest);
});
