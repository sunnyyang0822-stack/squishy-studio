const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

test('paw core, cracks and actual shell uploads stay identical with certified nearest-query reuse disabled', async () => {
  const THREE = await import('three');
  const { createWaxCollisionTree, thinWaxParameters } = await import('../src/thin-wax.mjs');
  const { createVoronoiWax } = await import('../src/thin-wax-panels.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const mesh = readMesh('./assets/models/squishy-paw.glb'), rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setIndex(mesh.indices);
  const style = getSquishyStyle('paw'), core = getOrbFeel('clay').createDeformation(geometry.attributes.position.array, normals, { surfaceGeometry: createSurfaceGeometry(rest, normals, mesh.indices, style.geometryOptions) });
  let now = 0;
  const options = { geometry, restPositions: rest, restNormals: normals, clock: () => now, collectionEnabled: false };
  const cached = createVoronoiWax(options, thinWaxParameters, createWaxCollisionTree);
  const reference = createVoronoiWax(options, thinWaxParameters, (g, settings) => createWaxCollisionTree(g, { ...settings, queryCache: false }));
  function compare() {
    const a = cached.getSurfaceSnapshot(), b = reference.getSurfaceSnapshot();
    let error = 0;
    for (let i = 0; i < a.positions.length; i++) error = Math.max(error, Math.abs(a.positions[i] - b.positions[i]), Math.abs(a.normals[i] - b.normals[i]));
    assert.equal(error, 0, 'Actual Float32 shell positions and normals must remain byte-identical');
    assert.deepEqual(cached.getState(), reference.getState(), 'No change to damage timing, IDs, budgets, fallthrough or fracture state');
  }
  function frame() { core.step(1 / 60); geometry.computeVertexNormals(); now += 1 / 60; cached.step(1 / 60); reference.step(1 / 60); compare(); }
  const point = [0, .3, .2]; let distance = Infinity;
  for (let i = 0; i < rest.length; i += 3) if (normals[i + 2] > .25) { const d = rest[i] ** 2 + (rest[i + 1] - .3) ** 2; if (d < distance) { distance = d; point.splice(0, 3, ...rest.slice(i, i + 3)); } }
  core.begin(point); cached.begin(point); reference.begin(point);
  for (let i = 0; i < 90; i++) frame();
  for (let i = 0; i < 12; i++) { const p = [point[0] + i * .01, point[1] - i * .006, point[2]]; core.move(p, .01); cached.move(p); reference.move(p); frame(); }
  core.release(); cached.end(); reference.end(); for (let i = 0; i < 50; i++) frame();
  core.beginRestore();
  for (let i = 0; i <= 12; i++) { core.applyRestore(i / 12); frame(); }
  cached.dispose(); reference.dispose(); geometry.dispose();
});
