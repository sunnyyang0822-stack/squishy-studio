const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');
const ids = ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
test('sculpted models retain identical dimensions across all feels while the original orb keeps its approved scale', async () => {
  const { getOrbAppearance, getModelPresentationScale } = await import('../src/orb-appearance.mjs');
  const { getOrbPreset } = await import('../src/orb-presets.mjs');
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  for (const id of ids) for (const feel of ['clay', 'marshmallow', 'slow-rebound']) {
    const appearance = getOrbAppearance(getOrbPreset(feel).appearanceId);
    const scale = getModelPresentationScale(appearance, getSquishyStyle(id).geometryAdapter);
    assert.deepEqual(scale, [1, 1, 1], `${id}/${feel}`);
    assert.ok(Object.isFrozen(scale));
  }
  const original = getOrbAppearance('full-matte');
  assert.strictEqual(getModelPresentationScale(original, getSquishyStyle('orb').geometryAdapter), original.scale);
  assert.deepEqual(original.scale, [1, 1.06, 1.1]);
});
function advance(d, n) { for (let i = 0; i < n; i++) d.step(1 / 60); }
function maximum(a, b) { let result = 0; for (let i = 0; i < a.length; i += 3) result = Math.max(result, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2])); return result; }
for (const id of ids) test(`${id}×slow-rebound: local progressive pressure, shallow sliding and exact model recovery`, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { getOrbPreset } = await import('../src/orb-presets.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const style = getSquishyStyle(id), mesh = readMesh(`.${style.modelUrl}`);
  assert.ok(style.supportedFeels.includes('slow-rebound'));
  const rest = Float32Array.from(mesh.positions), positions = rest.slice(), normals = Float32Array.from(mesh.normals);
  const surface = createSurfaceGeometry(rest, normals, mesh.indices, style.geometryOptions);
  const preset = getOrbPreset('slow-rebound'); assert.equal(preset.appearanceId, 'full-matte');
  const d = preset.createDeformation(positions, normals, { surfaceGeometry: surface });
  function hit(x, y) {
    let best = Infinity, vertex = -1;
    for (let i = 0; i < rest.length; i += 3) if (normals[i + 2] > .3) {
      const score = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2;
      if (score < best) { best = score; vertex = i; }
    }
    assert.ok(vertex >= 0); return { vertex, point: Array.from(rest.slice(vertex, vertex + 3)) };
  }
  const samples = id === 'donut' ? [[.72, 0], [1, .15], [.4, .2]] : [[0, -.2], [.55, .12], [-.4, .35]];
  for (const [x, y] of samples) {
    d.reset(); const h = hit(x, y); d.begin(h.point); advance(d, 6);
    const early = maximum(rest, positions); assert.ok(early > .0001 && early < .035);
    advance(d, 12); const middle = maximum(rest, positions); assert.ok(middle > early);
    advance(d, 102); const held = maximum(rest, positions);
    const contactDepth = Math.hypot(...h.point.map((v, k) => positions[h.vertex + k] - v));
    assert.ok(held > middle && held <= .460001 && contactDepth > .025, `${id}: real contact ${contactDepth}, max ${held}`);
    const footprint = new Set(surface.neighborhood(h.point, .60).map(([i]) => i));
    for (let i = 0; i < rest.length / 3; i++) if (!footprint.has(i)) for (let k = 0; k < 3; k++) assert.equal(positions[i * 3 + k], rest[i * 3 + k]);
    d.release(); advance(d, 30); const recovering = maximum(rest, positions);
    assert.ok(recovering > 0 && recovering < held, 'Release recovers gradually, not instant reset or frozen retention');
    assert.ok(Math.abs(recovering / held - Math.exp(-.8 * .5)) < .002, 'Confirmed .80/s recovery remains unchanged');
    advance(d, 900); assert.deepEqual(positions, rest, 'Recovery reaches this exact original model');
    assert.equal(d.step(1 / 60).needsFrame, false);
  }
  d.reset(); const a = hit(id === 'donut' ? .72 : -.45, .1), b = hit(id === 'donut' ? .7 : .45, -.15);
  d.begin(a.point);
  for (let i = 1; i <= 24; i++) { d.move(a.point.map((v, k) => v + (b.point[k] - v) * i / 24)); d.step(1 / 60); }
  const dragged = maximum(rest, positions); assert.ok(dragged > .002 && dragged <= .200001, 'Sliding remains shallow');
  const endpointBeforeDwell = Math.hypot(...b.point.map((v, k) => positions[b.vertex + k] - v));
  advance(d, 120);
  const endpointAfterDwell = Math.hypot(...b.point.map((v, k) => positions[b.vertex + k] - v));
  const geometricLimit = Math.min(.46, surface.radii[b.vertex / 3] * .5);
  if (endpointBeforeDwell >= geometricLimit - 1e-5) {
    // A thin ring may reach its physical limit even during a .4s swipe. It
    // must keep that boundary, then still deepen after a fresh shallow swipe.
    assert.ok(Math.abs(endpointAfterDwell - geometricLimit) < 1e-5);
    d.reset(); d.begin(a.point);
    for (let i = 1; i <= 24; i++) { d.move(a.point.map((v, k) => v + (b.point[k] - v) * i / 24)); d.step(.005); }
    const shallow = Math.hypot(...b.point.map((v, k) => positions[b.vertex + k] - v));
    advance(d, 120);
    const deep = Math.hypot(...b.point.map((v, k) => positions[b.vertex + k] - v));
    assert.ok(deep > shallow + .003, 'A fresh shallow swipe permits continued pressure at the actual endpoint');
  } else assert.ok(endpointAfterDwell > endpointBeforeDwell + .003, 'Stopping deepens the actual endpoint independently of old trail peaks');
  if (id === 'donut') for (let i = 0; i < rest.length; i += 3) if (rest[i] < -.35) for (let k = 0; k < 3; k++) assert.equal(positions[i + k], rest[i + k], 'Hole cannot transmit pressure to opposite rim');
  d.cancel(); advance(d, 1000); assert.deepEqual(positions, rest);
  d.begin(a.point); advance(d, 60); d.beginRestore(); d.applyRestore(.5); d.step(1 / 60);
  d.applyRestore(1); d.step(1 / 60); assert.deepEqual(positions, rest);
  d.begin(a.point); advance(d, 60); d.release(); d.setReducedMotion(true); advance(d, 240); assert.deepEqual(positions, rest);
});
