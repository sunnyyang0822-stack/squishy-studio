const { test } = require('node:test');
const assert = require('node:assert/strict');

// A closed thin box with a uniformly triangulated flat front. This supplies an
// analytic Euclidean surface-distance reference without opening the mesh.
function box() {
  const positions = [], indices = [], side = 21, layer = side * side;
  for (const z of [.25, -.25]) for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) positions.push((x - 10) / 10, (y - 10) / 10, z);
  for (let y = 0; y < side - 1; y++) for (let x = 0; x < side - 1; x++) {
    const a = y * side + x, b = a + 1, c = a + side, d = c + 1;
    indices.push(a, b, c, b, d, c, a + layer, c + layer, b + layer, b + layer, c + layer, d + layer);
  }
  const rim = [];
  for (let x = 0; x < side - 1; x++) rim.push(x);
  for (let y = 0; y < side - 1; y++) rim.push(y * side + side - 1);
  for (let x = side - 1; x > 0; x--) rim.push((side - 1) * side + x);
  for (let y = side - 1; y > 0; y--) rim.push(y * side);
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length];
    indices.push(a, a + layer, b, b, a + layer, b + layer);
  }
  const normals = positions.slice();
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(...normals.slice(i, i + 3));
    for (let k = 0; k < 3; k++) normals[i + k] /= length;
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices, side, layer };
}

test('掌垫沿三角形内部传播，比边图更接近已知平面距离；其他模型仍为原边图', async () => {
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = box();
  const graph = createSurfaceGeometry(mesh.positions, mesh.normals, mesh.indices);
  const wave = createSurfaceGeometry(mesh.positions, mesh.normals, mesh.indices, { depthAxis: 2 });
  const target = 13 * mesh.side + 16, hit = [0, 0, .25], exact = Math.hypot(.6, .3);
  const graphDistance = new Map(graph.neighborhood(hit, 1.2)).get(target);
  const waveDistance = new Map(wave.neighborhood(hit, 1.2)).get(target);
  assert.ok(Math.abs(graphDistance - .9) < 1e-6, 'Unconfigured models keep their original edge-graph distance');
  assert.ok(waveDistance >= exact - 1e-6 && waveDistance < exact + .06, `First-order triangle distance ${waveDistance}, exact ${exact}`);
  assert.ok(waveDistance < graphDistance - .1, 'Interior wave removes the directional mesh-edge detour');
  assert.deepEqual(wave.path(hit, [.6, .3, .25], .04), graph.path(hit, [.6, .3, .25], .04), 'Stroke routing is unchanged');
});

test('三角形压力波不直接跨越薄壳内部命中相近背面', async () => {
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = box(), wave = createSurfaceGeometry(mesh.positions, mesh.normals, mesh.indices, { depthAxis: 2 });
  const backCenter = mesh.layer + 10 * mesh.side + 10;
  // Back center is only .5 away in 3D; reaching it on the connected surface
  // requires travelling to the rim and back, beyond this .7 pressure radius.
  const neighborhood = new Map(wave.neighborhood([0, 0, .25], .7));
  assert.ok(neighborhood.size > 50);
  assert.equal(neighborhood.has(backCenter), false, 'No Euclidean shortcut through the interior');
});

test('slow-rebound opts into triangle-interior footprints without changing spatial limits or other feels', async () => {
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = box(), point = [0, 0, .25];
  const graph = createSurfaceGeometry(mesh.positions, mesh.normals, mesh.indices);
  const wave = createSurfaceGeometry(mesh.positions, mesh.normals, mesh.indices, { continuousFootprint: true });
  const pawWave = createSurfaceGeometry(mesh.positions, mesh.normals, mesh.indices, { depthAxis: 2 });
  assert.deepEqual(wave.directions, graph.directions);
  assert.deepEqual(wave.radii, graph.radii, 'Footprint interpolation does not retune the physical depth limit');
  assert.deepEqual(wave.neighborhood(point, 1.2), pawWave.neighborhood(point, 1.2));
  assert.deepEqual(wave.path(point, [.6, .3, .25], .04), graph.path(point, [.6, .3, .25], .04));
  let graphError = 0, waveError = 0, samples = 0;
  const gd = new Map(graph.neighborhood(point, 1.2)), wd = new Map(wave.neighborhood(point, 1.2));
  for (let y = 2; y <= 8; y++) for (let x = 2; x <= 8; x++) {
    const vertex = (10 + y) * mesh.side + 10 + x, exact = Math.hypot(x / 10, y / 10);
    if (!gd.has(vertex) || !wd.has(vertex)) continue;
    graphError += Math.abs(gd.get(vertex) - exact); waveError += Math.abs(wd.get(vertex) - exact); samples++;
  }
  assert.ok(samples > 20);
  assert.ok(waveError < graphError * .4, `Triangle footprints reduce directional error: ${waveError / samples} vs ${graphError / samples}`);
});
