const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');
const ids = ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
const advance = d => { for (let i = 0; i < 12; i++) d.step(1 / 60); };
const depths = (a, b) => Array.from({ length: a.length / 3 }, (_, i) => Math.hypot(...[0, 1, 2].map(k => a[i * 3 + k] - b[i * 3 + k])));
function normal(p, ids) {
  const [a, b, c] = ids, u = [0, 1, 2].map(k => p[b * 3 + k] - p[a * 3 + k]), v = [0, 1, 2].map(k => p[c * 3 + k] - p[a * 3 + k]);
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
for (const id of ids) test(`${id}×marshmallow: actual surface center/edge/join, frozen release/cancel and exact restore`, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const style = getSquishyStyle(id); assert.ok(style.supportedFeels.includes('marshmallow'));
  const mesh = readMesh(`.${style.modelUrl}`), rest = Float32Array.from(mesh.positions), p = rest.slice(), normals = Float32Array.from(mesh.normals);
  const surface = createSurfaceGeometry(p, normals, mesh.indices, style.geometryOptions);
  const d = getOrbFeel('marshmallow').createDeformation(p, normals, { surfaceGeometry: surface });
  for (const [x, y] of (id === 'donut' ? [[.72, 0], [1, .1], [.4, .2]] : [[0, 0], [.55, .12], [-.4, .35], [.1, -.5]])) {
    d.reset(); let target = 0, score = Infinity;
    for (let i = 0; i < rest.length; i += 3) if (rest[i + 2] > .05) {
      const s = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2;
      if (s < score) { score = s; target = i; }
    }
    const hit = Array.from(rest.slice(target, target + 3));
    for (let n = 0; n < 3; n++) { d.begin(hit); advance(d); d.move(hit, .1); advance(d); d.release(); }
    const moved = depths(rest, p), maximum = Math.max(...moved);
    assert.ok(maximum > .005 && maximum <= .700001, `${id}: ${maximum}`);
    assert.ok(moved.filter(v => v > 1e-6).length < moved.length * .65, 'Geodesic footprint stays local');
    assert.ok(p.every(Number.isFinite));
    if (surface.parameterization === 'star-convex') {
      const center = mesh.low.map((v, k) => (v + mesh.high[k]) / 2);
      for (let i = 0; i < rest.length; i += 3) {
        const a = center.map((v, k) => rest[i + k] - v), b = center.map((v, k) => p[i + k] - v);
        const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        assert.ok(Math.hypot(...cross) < 1e-6, 'Original radial parameterization remains exact');
        assert.ok(a.reduce((sum, v, k) => sum + v * b[k], 0) > 0, 'Every original ray retains positive radius');
      }
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const tri = mesh.indices.slice(i, i + 3), a = normal(rest, tri), b = normal(p, tri);
      if (surface.parameterization !== 'star-convex') assert.ok(a.reduce((sum, v, k) => sum + v * b[k], 0) > 0, `${id}: triangle ${i / 3} flipped`);
      assert.ok(Math.hypot(...b) > 1e-10, 'No collapsed triangles');
    }
    const snapshot = p.slice(); d.step(60); assert.deepEqual(p, snapshot); assert.equal(d.step(.1).needsFrame, false);
    d.begin(hit); d.step(.001); d.cancel(); const cancelled = p.slice(); d.step(60); assert.deepEqual(p, cancelled);
    d.beginRestore(); d.applyRestore(.5); d.step(1 / 60); assert.ok(Math.max(...depths(rest, p)) < maximum);
    d.applyRestore(1); d.step(1 / 60); assert.deepEqual(p, rest);
  }
  if (id === 'donut') {
    let target = 0; for (let i = 0; i < rest.length; i += 3) if (rest[i] > .5 && rest[i + 2] > rest[target + 2]) target = i;
    d.begin(Array.from(rest.slice(target, target + 3))); advance(d);
    for (let i = 0; i < rest.length; i += 3) if (rest[i] < -.35) for (let k = 0; k < 3; k++) assert.equal(p[i + k], rest[i + k], 'Opposite rim cannot move across hole');
  }
});
