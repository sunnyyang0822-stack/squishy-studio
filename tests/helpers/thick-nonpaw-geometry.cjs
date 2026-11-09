const assert = require('node:assert/strict');
const { readMesh } = require('./squishy-mesh.cjs');

function triangleArea(p, a, b, c) {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, total: sorted.reduce((a, b) => a + b, 0), mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    min: sorted[0], p10: sorted[Math.floor(sorted.length * .1)], median: sorted[Math.floor(sorted.length * .5)], p90: sorted[Math.floor(sorted.length * .9)], max: sorted.at(-1) };
}
function partitionStats(snapshot, mesh, { checkCoverage = true } = {}) {
  const areas = new Map(), innerAreas = new Map(), adjacency = new Map();
  const covered = new Float64Array(mesh.indices.length / 3);
  for (let i = 0; i < snapshot.indices.length; i += 3) {
    const [a, b, c] = snapshot.indices.slice(i, i + 3);
    if (snapshot.layers[a] !== 1 || snapshot.layers[b] !== 1 || snapshot.layers[c] !== 1) continue;
    const face = snapshot.sourceFaces[i / 3], area = triangleArea(snapshot.restSupportPositions, a, b, c), id = snapshot.panelIds[a];
    areas.set(id, (areas.get(id) || 0) + area); covered[face] += area;
    const graph = adjacency.get(id) || new Map();
    for (const x of [a, b, c]) { if (!graph.has(x)) graph.set(x, new Set()); for (const y of [a, b, c]) graph.get(x).add(y); }
    adjacency.set(id, graph);
    const ids = mesh.indices.slice(face * 3, face * 3 + 3);
    const cx = ids.reduce((s, v) => s + mesh.positions[v * 3], 0) / 3, cy = ids.reduce((s, v) => s + mesh.positions[v * 3 + 1], 0) / 3;
    const nx = ids.reduce((s, v) => s + mesh.normals[v * 3], 0) / 3, ny = ids.reduce((s, v) => s + mesh.normals[v * 3 + 1], 0) / 3;
    if (cx * nx + cy * ny < -.03) innerAreas.set(id, (innerAreas.get(id) || 0) + area);
  }
  if (checkCoverage) for (let face = 0; face < covered.length; face++) {
    const expected = triangleArea(mesh.positions, ...mesh.indices.slice(face * 3, face * 3 + 3));
    assert.ok(Math.abs(expected - covered[face]) < 1e-8, `Source face ${face} coverage ${covered[face]} vs ${expected}`);
  }
  for (const [id, graph] of adjacency) {
    const seen = new Set(), queue = [graph.keys().next().value];
    while (queue.length) { const x = queue.pop(); if (seen.has(x)) continue; seen.add(x); for (const y of graph.get(x)) if (!seen.has(y)) queue.push(y); }
    assert.equal(seen.size, graph.size, `Physical panel ${id} must be a connected source-surface island`);
  }
  return { areas, innerAreas, all: distribution(areas.values()), inner: distribution(innerAreas.values()), innerWholePanels: distribution([...innerAreas.keys()].map(id => areas.get(id))) };
}
function localThickness(snapshot, expected) {
  let pairs = 0, walls = 0, maximumError = 0;
  function check(a, b) {
    if ([0, 1, 2].every(k => snapshot.positions[a * 3 + k] === 0 && snapshot.positions[b * 3 + k] === 0)) return;
    const actual = Math.hypot(...[0, 1, 2].map(k => snapshot.positions[a * 3 + k] - snapshot.positions[b * 3 + k]));
    maximumError = Math.max(maximumError, Math.abs(actual - expected));
    assert.ok(Math.abs(actual - expected) < 1e-5, `Local thickness panel ${snapshot.panelIds[a]} records ${a}/${b}: ${actual} vs ${expected}`);
    pairs++;
  }
  for (let r = 0; r < snapshot.layers.length - 1; r++) if (snapshot.layers[r] === 0 && snapshot.layers[r + 1] === 1) check(r, r + 1);
  for (let i = 0; i < snapshot.indices.length - 5; i += 3) {
    const [a, b, c] = snapshot.indices.slice(i, i + 3);
    if (snapshot.layers[a] !== -1 || snapshot.layers[b] !== -1 || snapshot.layers[c] !== -1) continue;
    const [d, e, f] = snapshot.indices.slice(i + 3, i + 6);
    assert.equal(d, a); assert.equal(e, c); check(a, f); check(b, c); walls++; i += 3;
  }
  assert.ok(pairs > 1000 && walls > 100, 'Check actual shell pairs and all volumetric boundary walls');
  return { pairs, walls, maximumError };
}
async function createFixture(styleId, presetId = 'thick-wax', feelId = 'clay', reducedMotion = false, waxOptions = {}) {
  const THREE = await import('three');
  const { getWaxPreset } = await import('../../src/wax-presets.mjs');
  const { getSquishyStyle } = await import('../../src/squishy-styles.mjs');
  const { getOrbFeel } = await import('../../src/orb-feels.mjs');
  const { createSurfaceGeometry } = await import('../../src/surface-clay.mjs');
  const { createWaxCollisionTree } = await import('../../src/thin-wax.mjs');
  const style = getSquishyStyle(styleId), mesh = readMesh(`.${style.modelUrl}`), geometry = new THREE.BufferGeometry();
  const rest = Float32Array.from(mesh.positions), restNormals = Float32Array.from(mesh.normals);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(restNormals, 3)); geometry.setIndex(mesh.indices);
  const bareGeometry = geometry.clone(), normalReference = geometry.clone();
  normalReference.computeVertexNormals(); const computedRestNormals = normalReference.attributes.normal.array.slice(); normalReference.dispose();
  function updateNormals(target, step) {
    if (!step.changed) return;
    if (step.atRest) { target.attributes.normal.array.set(restNormals); return; }
    target.computeVertexNormals(); const normal = target.attributes.normal.array;
    for (let i = 0; i < normal.length; i += 3) {
      for (let k = 0; k < 3; k++) normal[i + k] += restNormals[i + k] - computedRestNormals[i + k];
      const length = Math.hypot(normal[i], normal[i + 1], normal[i + 2]);
      for (let k = 0; k < 3; k++) normal[i + k] /= Math.max(1e-8, length);
    }
  }
  const presentation = new THREE.Matrix4().makeTranslation(0, .4, 0);
  const worldMatrix = presentation.clone().multiply(new THREE.Matrix4().makeRotationY(styleId === 'pyramid' ? -.30 : 0));
  const cameraDirection = new THREE.Vector3(0, .92, 5).normalize();
  let now = 0, frames = 0, lastShellTime = 0;
  const options = () => ({ reducedMotion, surfaceGeometry: createSurfaceGeometry(rest.slice(), restNormals.slice(), mesh.indices, { ...style.geometryOptions, continuousFootprint: feelId === 'slow-rebound' }), ...(feelId === 'slow-rebound' ? { getPressDirection: () => cameraDirection.clone().transformDirection(worldMatrix.clone().invert()).toArray() } : {}) });
  const feel = getOrbFeel(feelId);
  const deformation = feel.createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array, options());
  const baseline = feel.createDeformation(bareGeometry.attributes.position.array, bareGeometry.attributes.normal.array, options());
  const wax = getWaxPreset(presetId).create({ styleId, feelId, geometry, restPositions: rest, restNormals, clock: () => now, reducedMotion, fullSurfaceSupport: feelId !== 'clay', compactPanels: presetId === 'thin-wax' && feelId === 'slow-rebound' && styleId === 'donut', ...waxOptions });
  const tree = createWaxCollisionTree(geometry, { featureNormals: true, queryCache: false, nearestGrid: false, restPositions: rest });
  function same() { assert.deepEqual(geometry.attributes.position.array, bareGeometry.attributes.position.array); assert.deepEqual(geometry.attributes.normal.array, bareGeometry.attributes.normal.array); assert.deepEqual(deformation.getState(), baseline.getState()); }
  function act(method, ...args) { deformation[method](...args); baseline[method](...args); same(); }
  wax.setWorldMatrix(worldMatrix);
  function tick(sync = true) { const step = deformation.step(1 / 60); assert.deepEqual(step, baseline.step(1 / 60)); same(); updateNormals(geometry, step); updateNormals(bareGeometry, step); now += 1 / 60; frames++; if (sync) { const changed = wax.step(now - lastShellTime); lastShellTime = now; if (step.changed && !changed.changed) wax.sync(); } same(); }
  return { THREE, mesh, style, feelId, geometry, wax, tree, deformation, baseline, rest, restNormals, same, act, get frames() { return frames; },
    sync() { wax.sync(); same(); },
    setRotationMatrix(value) { worldMatrix.copy(presentation).multiply(value); wax.setWorldMatrix(worldMatrix); },
    begin(p) { act('begin', p); wax.begin(p); }, move(p, distance) { act('move', p, distance); wax.move(p); }, end() { act('release'); wax.end(); }, tick,
    run(count) { for (let i = 0; i < count; i++) tick(); },
    restore(progress) { act('applyRestore', progress); tick(); },
    dispose() { wax.dispose(); geometry.dispose(); bareGeometry.dispose(); } };
}
function contactPoint(mesh, x, y, inner = false) {
  let best = Infinity, point;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (mesh.normals[i + 2] < .25 || inner && mesh.positions[i] * mesh.normals[i] + mesh.positions[i + 1] * mesh.normals[i + 1] >= -.03) continue;
    const d = (mesh.positions[i] - x) ** 2 + (mesh.positions[i + 1] - y) ** 2;
    if (d < best) { best = d; point = mesh.positions.slice(i, i + 3); }
  }
  assert.ok(point, 'Contact must lie on a real visible GLB face'); return point;
}
function completeClearance(f, snapshot, { detachedOnly = false } = {}) {
  f.tree.refit(); const vector = new f.THREE.Vector3(); let minimum = Infinity, samples = 0, uniqueQueries = 0;
  // This cache lives for one immutable snapshot only. Every logical triangle
  // site is still asserted; repeated indexed vertices and edges share an exact
  // independent query, with no geometric approximation or cross-frame reuse.
  const vertices = new Map(), edges = new Map(), count = snapshot.layers.length;
  function check(x, y, z, context, cache, key) {
    let distance = cache?.get(key);
    if (distance === undefined) { distance = f.tree.signedDistance(vector.set(x, y, z)); uniqueQueries++; cache?.set(key, distance); }
    minimum = Math.min(minimum, distance); samples++;
    assert.ok(distance >= -1e-5, `${f.style.id}: complete-volume penetration ${distance}; ${context}`);
  }
  for (let i = 0; i < snapshot.indices.length; i += 3) {
    const ids = Array.from(snapshot.indices.slice(i, i + 3));
    if (detachedOnly && !snapshot.detached[ids[0]]) continue;
    if (ids.every(r => [0, 1, 2].every(k => snapshot.positions[r * 3 + k] === 0))) continue;
    const context = `triangle ${i / 3}, panel ${snapshot.panelIds[ids[0]]}, layer ${snapshot.layers[ids[0]]}, detached ${snapshot.detached[ids[0]]}`;
    for (const r of ids) check(...snapshot.positions.slice(r * 3, r * 3 + 3), context + ' vertex', vertices, r);
    for (let k = 0; k < 3; k++) { const a = ids[k], b = ids[(k + 1) % 3]; check(...[0, 1, 2].map(c => (snapshot.positions[a * 3 + c] + snapshot.positions[b * 3 + c]) / 2), context + ' edge', edges, Math.min(a, b) * count + Math.max(a, b)); }
    check(...[0, 1, 2].map(c => ids.reduce((sum, r) => sum + snapshot.positions[r * 3 + c], 0) / 3), context + ' face');
  }
  return { minimumSignedDistance: minimum, samples, uniqueQueries };
}
module.exports = { triangleArea, distribution, partitionStats, localThickness, createFixture, contactPoint, completeClearance };
