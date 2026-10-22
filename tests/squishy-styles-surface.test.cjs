const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh, topology } = require('./helpers/squishy-mesh.cjs');
const ids = ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
function displacement(rest, positions) {
  return Array.from({ length: rest.length / 3 }, (_, i) => Math.hypot(...[0, 1, 2].map(k => positions[i * 3 + k] - rest[i * 3 + k])));
}
function advance(d, frames = 240) { for (let i = 0; i < frames; i++) d.step(1 / 60); }
function faceNormal(p, a, b, c) {
  const u = [0, 1, 2].map(k => p[b * 3 + k] - p[a * 3 + k]), v = [0, 1, 2].map(k => p[c * 3 + k] - p[a * 3 + k]);
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

test('等价球空间查询严格保留模板逐帧阻力、85%留痕、取消和恢复时序', async () => {
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const rest = Float32Array.from([0, 0, 1, 0, 0, -1, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const a = rest.slice(), b = rest.slice();
  const spatial = { directions: rest.slice(), radii: new Float32Array(6).fill(1), neighborhood(point, radius) {
    return Array.from({ length: 6 }, (_, i) => [i, Math.hypot(...[0, 1, 2].map(k => rest[i * 3 + k] - point[k]))]).filter(([, d]) => d < radius);
  }, path(_from, to) { return [to]; } };
  const ordinary = getOrbFeel('clay').createDeformation(a, rest.slice());
  const adapted = getOrbFeel('clay').createDeformation(b, rest.slice(), { surfaceGeometry: spatial });
  const run = (method, ...args) => { ordinary[method](...args); adapted[method](...args); assert.deepEqual(ordinary.getState(), adapted.getState()); };
  const frames = count => { for (let i = 0; i < count; i++) { assert.deepEqual(ordinary.step(1 / 60), adapted.step(1 / 60)); assert.deepEqual(a, b); } };
  run('begin', [0, 0, 1]); frames(180); run('move', [0, 0, 1], .3); frames(60); run('release'); frames(120);
  run('begin', [0, 0, 1]); frames(20); run('cancel'); frames(120);
  run('beginRestore'); for (let i = 0; i <= 20; i++) { run('applyRestore', i / 20); frames(1); }
  assert.deepEqual(a, rest); assert.deepEqual(b, rest);
});

for (const id of ids) test(`${id}：真实导出几何的局部形变保持黏土85%留痕并恢复本体`, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { createSurfaceClay } = await import('../src/surface-clay.mjs');
  const mesh = readMesh(`.${getSquishyStyle(id).modelUrl}`), rest = Float32Array.from(mesh.positions), positions = rest.slice(), normals = Float32Array.from(mesh.normals);
  const d = createSurfaceClay(positions, normals, { indices: mesh.indices });
  // Choose an actual frontmost exported vertex, avoiding guessed sphere hits.
  let target = 0; for (let i = 0; i < rest.length; i += 3) if (rest[i + 2] > rest[target + 2]) target = i;
  const hit = Array.from(rest.slice(target, target + 3)); d.begin(hit); advance(d);
  const held = displacement(rest, positions), maximum = Math.max(...held);
  assert.ok(maximum > .025 && maximum < .7, `${id}: depth ${maximum}`);
  assert.ok(held.filter(v => v > 1e-5).length < held.length * .65, 'Local surface region');
  assert.ok(positions.every(Number.isFinite));
  for (let i = 0; i < held.length; i++) if (rest[i * 3 + 2] < mesh.low[2] + .1) assert.ok(held[i] < 1e-6, 'Front press cannot push through onto back skin');
  d.release(); advance(d);
  const retained = Math.max(...displacement(rest, positions));
  assert.ok(Math.abs(retained / maximum - .85) < .015, `clay retention: ${retained / maximum}`);
  const saved = positions.slice(); d.begin(hit); advance(d, 20); d.cancel(); advance(d);
  assert.deepEqual(positions, saved, 'Cancellation restores the previously retained surface');
  d.beginRestore(); d.applyRestore(.5); d.step(1 / 60); assert.ok(Math.max(...displacement(rest, positions)) < retained);
  d.applyRestore(1); d.step(1 / 60); assert.deepEqual(positions, rest, 'Restore ends at this model’s exact rest geometry');
  d.begin(hit); advance(d, 90); d.release(); advance(d); d.reset(); assert.deepEqual(positions, rest);
});

for (const id of ids) test(`${id}：中心、侧缘、连接区域反复深压无三角形翻转或塌陷`, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const mesh = readMesh(`.${getSquishyStyle(id).modelUrl}`), rest = Float32Array.from(mesh.positions), positions = rest.slice();
  const geometry = createSurfaceGeometry(positions, Float32Array.from(mesh.normals), mesh.indices);
  if (geometry.parameterization === 'star-convex') {
    const t = topology(mesh); assert.equal(t.components, 1); assert.equal(t.boundaryOrNonmanifold, 0); assert.equal(t.euler, 2);
  }
  const d = getOrbFeel('clay').createDeformation(positions, Float32Array.from(mesh.normals), { surfaceGeometry: geometry });
  const center = mesh.low.map((v, k) => (v + mesh.high[k]) / 2);
  const determinant = (source, tri) => {
    const [a, b, c] = tri.map(i => [0, 1, 2].map(k => source[i * 3 + k] - center[k]));
    return a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  };
  const targets = [[0, 0], [.55, .12], [-.45, .35], [.12, -.5]];
  for (const [x, y] of targets) {
    d.reset(); let vertex = -1, best = Infinity;
    for (let i = 0; i < rest.length; i += 3) if (rest[i + 2] > .05) {
      const score = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2;
      if (score < best) { best = score; vertex = i; }
    }
    assert.ok(vertex >= 0);
    const hit = Array.from(rest.slice(vertex, vertex + 3));
    for (let stroke = 0; stroke < 6; stroke++) { d.begin(hit); advance(d, 240); d.move(hit.map((v, k) => v + (k === 0 ? .04 : 0)), .1); advance(d, 40); d.release(); advance(d, 120); }
    if (geometry.parameterization === 'star-convex') for (let i = 0; i < rest.length; i += 3) {
      const a = center.map((v, k) => rest[i + k] - v), b = center.map((v, k) => positions[i + k] - v);
      const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      assert.ok(Math.hypot(...cross) < 1e-6, 'Star-convex deformation stays on original ray');
      assert.ok(a.reduce((sum, v, k) => sum + v * b[k], 0) > 0, 'Strictly positive radial scale');
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const tri = mesh.indices.slice(i, i + 3), before = faceNormal(rest, ...tri), after = faceNormal(positions, ...tri);
      assert.ok(Math.hypot(...after) > 1e-9, `${id} collapsed face ${i / 3}, hit ${hit}`);
      if (geometry.parameterization === 'star-convex') {
        // A steep dent can rotate a wall normal by >90° without folding the
        // skin. The stronger invariant is unchanged, one-to-one spherical
        // parameterization: closed genus-zero rest skin, positive face radial
        // determinants, and strictly positive ray scales at every vertex.
        assert.ok(determinant(rest, tri) > 0, `${id} rest radial fold ${i / 3}`);
        assert.ok(determinant(positions, tri) > 0, `${id} deformed radial fold ${i / 3}`);
      } else assert.ok(before.reduce((sum, n, k) => sum + n * after[k], 0) > 0, `${id} inverted normal-thickness face ${i / 3}, hit ${hit}`);
    }
  }
});

test('甜甜圈内圈压痕不跨孔牵扯另一侧，中孔射线仍畅通', async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { createSurfaceClay } = await import('../src/surface-clay.mjs');
  const mesh = readMesh(`.${getSquishyStyle('donut').modelUrl}`), positions = Float32Array.from(mesh.positions), rest = positions.slice();
  const d = createSurfaceClay(positions, Float32Array.from(mesh.normals), { indices: mesh.indices });
  let candidate = -1, score = Infinity;
  for (let i = 0; i < rest.length; i += 3) if (rest[i] > 0 && Math.abs(rest[i + 1]) < .12 && rest[i + 2] > 0) {
    const value = rest[i] + .5 * Math.abs(rest[i + 1]); if (value < score) { candidate = i; score = value; }
  }
  assert.ok(candidate >= 0); const hit = Array.from(rest.slice(candidate, candidate + 3)); d.begin(hit); advance(d);
  const depth = displacement(rest, positions); assert.ok(Math.max(...depth) > .02);
  // The thicker ring can legitimately carry a geodesic footprint around the
  // nearby upper arc. Check the directly opposite aperture edge at the same Y.
  for (let i = 0; i < depth.length; i++) if (rest[i * 3] < -hit[0] * .7 && Math.abs(rest[i * 3 + 1] - hit[1]) < .1) assert.ok(depth[i] < 1e-6, 'Directly opposite inner rim remains unchanged');
  // Any projected triangle containing XY=(0,0) would visibly cap the aperture.
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const p = mesh.indices.slice(i, i + 3).map(index => [positions[index * 3], positions[index * 3 + 1]]);
    const cross = p.map((a, k) => { const b = p[(k + 1) % 3]; return a[0] * b[1] - a[1] * b[0]; });
    assert.ok(!(cross.every(v => v > 1e-8) || cross.every(v => v < -1e-8)), 'Hole must not be filled by deformation');
  }
});
