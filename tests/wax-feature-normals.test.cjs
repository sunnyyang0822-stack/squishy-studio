const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

test('real folded paw distinguishes a false face-normal penetration from a true penetration using independent ray parity', async t => {
  const THREE = await import('three');
  const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
  const fixture = require('./fixtures/wax-paw-fold.json');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(fixture.asset)).digest('hex'), fixture.sha256);
  const mesh = readMesh(fixture.asset), a = new THREE.Vector3(), b = a.clone(), c = a.clone(), hit = a.clone();
  for (const example of fixture.cases) {
    const g = new THREE.BufferGeometry(), positions = Float32Array.from(mesh.positions);
    for (const [index, value] of example.changes) positions[index] = value;
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(mesh.indices);
    const robust = createWaxCollisionTree(g, { featureNormals: true, nearestGrid: true, restPositions: mesh.positions }), legacy = createWaxCollisionTree(g);
    const point = new THREE.Vector3(...example.point), counts = [];
    for (const direction of [[1, .231, .643], [.317, 1, .173], [.413, .239, 1]]) {
      const ray = new THREE.Ray(point, new THREE.Vector3(...direction).normalize()), distances = [];
      for (let f = 0; f < mesh.indices.length; f += 3) {
        a.fromBufferAttribute(g.attributes.position, mesh.indices[f]); b.fromBufferAttribute(g.attributes.position, mesh.indices[f + 1]); c.fromBufferAttribute(g.attributes.position, mesh.indices[f + 2]);
        if (ray.intersectTriangle(a, b, c, false, hit)) { const distance = hit.distanceTo(point); if (distance > 1e-8) distances.push(distance); }
      }
      distances.sort((a, b) => a - b);
      const unique = distances.filter((distance, i) => !i || distance - distances[i - 1] > 1e-7);
      counts.push(unique.length); assert.equal(unique.length % 2 === 1, example.expectedInside, 'All independent ray directions must agree on the live closed core');
    }
    const value = robust.signedDistance(point), old = legacy.signedDistance(point);
    assert.equal(value < 0, example.expectedInside);
    assert.ok(Math.abs(Math.abs(value) - Math.abs(old)) < 1e-12);
    if (!example.expectedInside) assert.ok(old < 0 && value > 0, 'This real fold must expose the old false-positive penetration');
    t.diagnostic(JSON.stringify({ expectedInside: example.expectedInside, independentUniqueRayHits: counts, robustSignedDistance: value, legacySignedDistance: old }));
    g.dispose();
  }
});

test('closed concave solid with duplicated seam vertices has analytic inside/outside signs after dynamic refit', async () => {
  const THREE = await import('three');
  const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
  const cubes = [[0, 0, 0], [1, 0, 0], [0, 1, 0]], occupancy = new Set(cubes.map(c => c.join(','))), positions = [], indices = [];
  const sides = [
    { d: [1, 0, 0], p: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { d: [-1, 0, 0], p: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { d: [0, 1, 0], p: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
    { d: [0, -1, 0], p: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { d: [0, 0, 1], p: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { d: [0, 0, -1], p: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  ];
  for (const cube of cubes) for (const side of sides) {
    if (occupancy.has(cube.map((v, k) => v + side.d[k]).join(','))) continue;
    const start = positions.length / 3; for (const point of side.p) positions.push(...point.map((v, k) => v + cube[k]));
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices);
  const rest = g.attributes.position.array.slice(), robust = createWaxCollisionTree(g, { featureNormals: true, nearestGrid: true, restPositions: rest }), reference = createWaxCollisionTree(g);
  const normal = new THREE.Vector3();
  for (const scale of [[1, 1, 1], [.8, 1.2, .9], [1, 1, 1]]) {
    for (let i = 0; i < rest.length; i += 3) g.attributes.position.setXYZ(i / 3, rest[i] * scale[0], rest[i + 1] * scale[1], rest[i + 2] * scale[2]);
    robust.refit(); reference.refit();
    for (const x of [-.2, .0001, .2, .8, 1.0001, 1.2, 1.8, 2.2]) for (const y of [-.2, .0001, .2, .8, 1.0001, 1.2, 1.8, 2.2]) for (const z of [-.2, .0001, .2, .8, 1.2]) {
      const point = new THREE.Vector3(x * scale[0], y * scale[1], z * scale[2]), inside = x > 0 && x < 2 && y > 0 && y < 2 && z > 0 && z < 1 && (x < 1 || y < 1);
      const value = robust.signedDistance(point, normal), old = reference.signedDistance(point);
      assert.equal(value < 0, inside, `Analytic solid at ${point.toArray()}: ${value}`);
      assert.ok(Math.abs(Math.abs(value) - Math.abs(old)) < 1e-12, 'Feature normals change the sign classification, never the exact distance');
      assert.ok(Math.abs(normal.length() - 1) < 1e-12);
    }
  }
  const point = new THREE.Vector3(.37, .21, 1.004), hint = {};
  robust.getQueryCounters(true);
  const value = robust.signedDistance(point, normal, hint), expectedNormal = normal.clone();
  robust.signedDistance(point, normal, hint); robust.signedDistance(point, normal, hint);
  assert.ok(robust.getQueryCounters().cachedQueries > 0, 'Actual feature-normal results must exercise identical-point reuse');
  assert.equal(robust.signedDistance(point, normal, hint), value); assert.deepEqual(normal, expectedNormal);
  // A distant change cannot invalidate local geometry, but still refits the
  // global angle-weighted normals. Its result must remain exactly the same.
  for (let i = 0; i < rest.length; i += 3) if (rest[i] >= 2) g.attributes.position.setX(i / 3, rest[i] + .001);
  robust.refit(); assert.equal(robust.signedDistance(point, normal, hint), value); assert.deepEqual(normal, expectedNormal);
  assert.equal(robust.getQueryCounters().cachedQueries, 1);
  g.dispose();
});
