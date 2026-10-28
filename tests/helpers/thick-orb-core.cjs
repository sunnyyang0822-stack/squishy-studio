const assert = require('node:assert/strict');
const { readMesh } = require('./squishy-mesh.cjs');

async function createThickOrbCore(feelId, { reducedMotion = false, presetId = 'thick-wax' } = {}) {
  const THREE = await import('three');
  const { getOrbFeel } = await import('../../src/orb-feels.mjs');
  const { getWaxPreset } = await import('../../src/wax-presets.mjs');
  const { createSurfaceGeometry } = await import('../../src/surface-clay.mjs');
  const { createWaxCollisionTree } = await import('../../src/thin-wax.mjs');
  const mesh = readMesh('assets/models/squishy-orb.glb');
  const rest = Float32Array.from(mesh.positions), restNormals = Float32Array.from(mesh.normals);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(restNormals, 3)); geometry.setIndex(mesh.indices);
  const bareGeometry = geometry.clone();
  let direction = [0, 0, 1], time = 0, frames = 0;
  function options() {
    if (feelId !== 'slow-rebound') return { reducedMotion };
    const safety = createSurfaceGeometry(rest.slice(), restNormals.slice(), mesh.indices);
    return { reducedMotion, getPressDirection: () => direction,
      constrainPress: safety.createContactSafety(), getPressRadius: (i, d) => safety.contactRadius(i, d) };
  }
  const feel = getOrbFeel(feelId);
  const core = feel.createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array, options());
  const bare = feel.createDeformation(bareGeometry.attributes.position.array, bareGeometry.attributes.normal.array, options());
  const wax = getWaxPreset(presetId).create({ styleId: 'orb', geometry, restPositions: rest, restNormals,
    clock: () => time, color: '#ffbbdd', reducedMotion });
  const tree = createWaxCollisionTree(geometry);
  function same() {
    assert.deepEqual(geometry.attributes.position.array, bareGeometry.attributes.position.array, 'Wax must not alter any approved core coordinate');
    assert.deepEqual(geometry.attributes.normal.array, bareGeometry.attributes.normal.array, 'Wax must not alter any approved core normal');
    assert.deepEqual(core.getState(), bare.getState(), 'Wax must not change core behavior state');
  }
  function act(method, ...args) { core[method](...args); bare[method](...args); same(); }
  function frame(dt = 1 / 60) {
    const step = core.step(dt); assert.deepEqual(step, bare.step(dt)); same();
    if (step.changed) { geometry.computeVertexNormals(); bareGeometry.computeVertexNormals(); }
    time += dt;
    const result = wax.step(dt); if (step.changed && !result.changed) wax.sync();
    same(); frames++; return result;
  }
  const run = count => { for (let i = 0; i < count; i++) frame(); };
  function contact(x = 0, y = .02) {
    let point, distance = Infinity;
    for (let i = 0; i < rest.length; i += 3) if (restNormals[i + 2] > .25) {
      const d = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2;
      if (d < distance) { distance = d; point = Array.from(rest.slice(i, i + 3)); }
    }
    return point;
  }
  return { THREE, mesh, geometry, bareGeometry, rest, restNormals, core, bare, wax, tree, same, act, frame, run, contact,
    begin(p = contact()) { act('begin', p); wax.begin(p); },
    release() { act('release'); wax.end(); },
    move(p, distance = .03) { act('move', p, distance); wax.move(p); },
    direction(value) { direction = value; }, get frames() { return frames; },
    dispose() { wax.dispose(); geometry.dispose(); bareGeometry.dispose(); } };
}
function area(p, a, b, c) {
  const u = [0, 1, 2].map(k => p[b * 3 + k] - p[a * 3 + k]);
  const v = [0, 1, 2].map(k => p[c * 3 + k] - p[a * 3 + k]);
  return Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) / 2;
}
function partitionAreas(s, mesh) {
  const panels = new Map(), covered = new Float64Array(mesh.indices.length / 3);
  for (let i = 0; i < s.indices.length; i += 3) {
    const ids = Array.from(s.indices.slice(i, i + 3));
    if (!ids.every(r => s.layers[r] === 1)) continue;
    const a = area(s.restSupportPositions, ...ids), id = s.panelIds[ids[0]];
    panels.set(id, (panels.get(id) || 0) + a); covered[s.sourceFaces[i / 3]] += a;
  }
  for (let i = 0; i < covered.length; i++) assert.ok(Math.abs(covered[i] - area(mesh.positions, ...mesh.indices.slice(i * 3, i * 3 + 3))) < 1e-8, `Source triangle ${i} coverage`);
  const total = [...panels.values()].reduce((a, b) => a + b, 0);
  return { count: panels.size, mean: total / panels.size, total, minimum: Math.min(...panels.values()), maximum: Math.max(...panels.values()) };
}
function inspectWholeVolume(f, expectedThickness = .042) {
  f.tree.refit(); const s = f.wax.getSurfaceSnapshot(), p = new f.THREE.Vector3();
  let samples = 0, minimum = Infinity, thicknessSamples = 0, maximumThicknessError = 0;
  function point(v, context) {
    p.set(...v); const d = f.tree.signedDistance(p); samples++; minimum = Math.min(minimum, d);
    assert.ok(d >= -1e-5, `Complete volume penetration ${d}, ${context}`);
  }
  function thickness(a, b) {
    if ([0, 1, 2].every(k => s.positions[a * 3 + k] === 0 && s.positions[b * 3 + k] === 0)) return;
    const d = Math.hypot(...[0, 1, 2].map(k => s.positions[a * 3 + k] - s.positions[b * 3 + k]));
    maximumThicknessError = Math.max(maximumThicknessError, Math.abs(d - expectedThickness)); thicknessSamples++;
    assert.ok(Math.abs(d - expectedThickness) < 1e-5, `Local thickness panel ${s.panelIds[a]} ${d}`);
  }
  for (let r = 0; r < s.layers.length - 1; r++) if (s.layers[r] === 0 && s.layers[r + 1] === 1) thickness(r, r + 1);
  for (let i = 0; i < s.indices.length; i += 3) {
    const ids = Array.from(s.indices.slice(i, i + 3));
    if (ids.every(r => [0, 1, 2].every(k => s.positions[r * 3 + k] === 0))) continue;
    const context = `frame ${f.frames}, panel ${s.panelIds[ids[0]]}, triangle ${i / 3}, layer ${s.layers[ids[0]]}, detached ${s.detached[ids[0]]}`;
    for (const r of ids) point(Array.from(s.positions.slice(r * 3, r * 3 + 3)), context + ' vertex');
    for (let k = 0; k < 3; k++) point([0, 1, 2].map(c => (s.positions[ids[k] * 3 + c] + s.positions[ids[(k + 1) % 3] * 3 + c]) / 2), context + ' edge');
    point([0, 1, 2].map(c => ids.reduce((sum, r) => sum + s.positions[r * 3 + c], 0) / 3), context + ' face');
    if (s.layers[ids[0]] === -1 && i + 5 < s.indices.length) {
      const [a, b, c] = ids, [d, e, h] = s.indices.slice(i + 3, i + 6);
      if (a === d && c === e) { thickness(a, h); thickness(b, c); }
    }
  }
  assert.ok(samples > 10000 && thicknessSamples > 1000);
  const m = f.wax.getMetrics({ exhaustive: true });
  assert.equal(m.attachedViolations, 0); assert.equal(m.detachedViolations, 0); assert.ok(m.maxThicknessError < 1e-5);
  assert.ok(m.attachedMinGap >= .004 - 1e-5);
  return { samples, minimum, thicknessSamples, maximumThicknessError, attachedSamples: m.attachedSurfaceSamples,
    detachedSamples: m.detachedInteriorSamples, wallSamples: m.wallSamples, detached: f.wax.getState().detached };
}
module.exports = { createThickOrbCore, partitionAreas, inspectWholeVolume };
