const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');
const ids = ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
const advance = (d, count) => { for (let i = 0; i < count; i++) d.step(1 / 60); };
const depths = (a, b) => Array.from({ length: a.length / 3 }, (_, i) => Math.hypot(...[0, 1, 2].map(k => a[i * 3 + k] - b[i * 3 + k])));
function normal(p, ids) {
  const [a, b, c] = ids, u = [0, 1, 2].map(k => p[b * 3 + k] - p[a * 3 + k]), v = [0, 1, 2].map(k => p[c * 3 + k] - p[a * 3 + k]);
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
for (const id of ids) test(`${id}×marshmallow preset: gradual local press, shallow trail, immediate dwell, frozen old trail and unload`, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const { getOrbPreset } = await import('../src/orb-presets.mjs');
  const style = getSquishyStyle(id); assert.ok(style.supportedFeels.includes('marshmallow'));
  const mesh = readMesh(`.${style.modelUrl}`), rest = Float32Array.from(mesh.positions), p = rest.slice(), normals = Float32Array.from(mesh.normals);
  const surface = createSurfaceGeometry(p, normals, mesh.indices, style.geometryOptions);
  const d = getOrbPreset('marshmallow').createDeformation(p, normals, { surfaceGeometry: surface });
  function hit(x, y) {
    let target = 0, score = Infinity;
    for (let i = 0; i < rest.length; i += 3) if (rest[i + 2] > .05) {
      const s = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2;
      if (s < score) { score = s; target = i; }
    }
    return Array.from(rest.slice(target, target + 3));
  }
  for (const [x, y] of (id === 'donut' ? [[.72, 0], [1, .1], [.4, .2]] : [[0, 0], [.55, .12], [-.4, .35], [.1, -.5]])) {
    d.reset(); const point = hit(x, y); d.begin(point); advance(d, 3);
    const early = Math.max(...depths(rest, p)); assert.ok(early > .00001 && early < .04, `${id}: short press ${early}`);
    advance(d, 15); const middle = Math.max(...depths(rest, p)); assert.ok(middle > early, `${id}: middle press progresses`);
    advance(d, 60); const moved = depths(rest, p), maximum = Math.max(...moved);
    assert.ok(maximum > middle && maximum <= .700001, `${id}: ${maximum}`);
    const neighborhood = new Set(surface.neighborhood(point, .40).map(([i]) => i));
    for (let i = 0; i < moved.length; i++) if (!neighborhood.has(i)) assert.equal(moved[i], 0, 'Actual geodesic footprint outside .40 remains exact');
    assert.ok(p.every(Number.isFinite));
    if (surface.parameterization !== 'star-convex') for (let i = 0; i < mesh.indices.length; i += 3) {
      const tri = mesh.indices.slice(i, i + 3), a = normal(rest, tri), b = normal(p, tri);
      assert.ok(a.reduce((sum, v, k) => sum + v * b[k], 0) >= a.reduce((sum, v) => sum + v * v, 0) * .07999, 'Actual normal-area safety');
    }
    d.release(); const snapshot = p.slice(); d.step(60); assert.deepEqual(p, snapshot);
    d.begin(point); d.step(.016); d.cancel(); const cancelled = p.slice(); d.step(60); assert.deepEqual(p, cancelled);
    d.beginRestore(); d.applyRestore(.5); d.step(1 / 60); assert.ok(Math.max(...depths(rest, p)) < maximum);
    d.applyRestore(1); d.step(1 / 60); assert.deepEqual(p, rest);
  }
  d.reset(); const from = hit(id === 'donut' ? .72 : -.45, .1), to = hit(id === 'donut' ? .7 : .45, -.15);
  d.begin(from); d.step(.0001); d.move(to, .5); d.step(1 / 60);
  const arrived = p.slice(), local = new Set(surface.neighborhood(to, .40).map(([i]) => i));
  d.step(1 / 60); const nextFrame = p.slice();
  assert.ok(depths(arrived, nextFrame).some(v => v > 1e-6), 'Stopping deepens on next presented frame');
  advance(d, 50); const gain = depths(arrived, p); assert.ok(Math.max(...gain) > .005, 'Current contact continues deepening');
  for (let i = 0; i < rest.length / 3; i++) if (!local.has(i)) for (let k = 0; k < 3; k++) assert.equal(p[i * 3 + k], arrived[i * 3 + k], 'Departed shallow trail freezes exactly');
  d.release(); const unloaded = p.slice(); advance(d, 600); assert.deepEqual(p, unloaded);
  if (id === 'donut') for (let i = 0; i < rest.length; i += 3) if (rest[i] < -.35) for (let k = 0; k < 3; k++) assert.equal(p[i + k], rest[i + k], 'Opposite rim cannot move across hole');
});
