const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

test('identical local queries reuse only unchanged live triangles and stay equal to a cache-disabled full BVH', async t => {
  const THREE = await import('three');
  const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
  for (const id of ['paw', 'donut']) {
    const mesh = readMesh(`./assets/models/squishy-${id}.glb`), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3)); geometry.setIndex(mesh.indices);
    const cached = createWaxCollisionTree(geometry, { nearestGrid: true }), reference = createWaxCollisionTree(geometry);
    cached.getQueryCounters(true);
    const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), normal = a.clone(), actualNormal = a.clone(), expectedNormal = a.clone(), cases = [];
    for (let face = 0; face < mesh.indices.length / 3; face += Math.max(1, Math.floor(mesh.indices.length / 3 / 180))) {
      a.fromBufferAttribute(geometry.attributes.position, mesh.indices[face * 3]); b.fromBufferAttribute(geometry.attributes.position, mesh.indices[face * 3 + 1]); c.fromBufferAttribute(geometry.attributes.position, mesh.indices[face * 3 + 2]);
      new THREE.Triangle(a, b, c).getNormal(normal);
      cases.push({ point: a.clone().add(b).add(c).multiplyScalar(1 / 3).addScaledVector(normal, .004), hint: { faceIndex: face } });
    }
    function compare() {
      for (const { point, hint } of cases) {
        const actual = cached.signedDistance(point, actualNormal, hint), expected = reference.signedDistance(point, expectedNormal, hint.faceIndex);
        assert.ok(Math.abs(actual - expected) < 1e-12, `${id}: ${actual} vs ${expected}`);
        assert.ok(actualNormal.distanceTo(expectedNormal) < 1e-12, 'Cached signed distance and actual nearest normal must both stay exact');
      }
    }
    compare(); compare();
    assert.ok(cached.getQueryCounters().cachedQueries > 100, 'Actually reuse proven unchanged queries');
    cached.refit(); reference.refit(); compare();
    assert.ok(cached.getQueryCounters().cachedQueries > 100, 'Unchanged refit must preserve valid local results');
    const priorHits = cached.getQueryCounters().cachedQueries;
    for (const item of cases) item.point.z += 1e-8;
    compare();
    assert.ok(cached.getQueryCounters().cachedQueries > priorHits + 100, 'Certified moving queries must recompute on the exact nearest face, not return a stale distance');
    for (let i = 0; i < geometry.attributes.position.count; i++) geometry.attributes.position.setZ(i, geometry.attributes.position.getZ(i) + 1e-8);
    cached.refit(); reference.refit(); compare();
    assert.ok(cached.getQueryCounters().cachedQueries > 100, 'A certified tiny movement of the entire core must recompute the live nearest face exactly');
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0 && Math.hypot(p.getX(i), p.getY(i)) < .5) p.setZ(i, p.getZ(i) - .18);
    cached.refit(); reference.refit(); compare(); compare();
    t.diagnostic(JSON.stringify({ id, counters: cached.getQueryCounters() }));
    geometry.dispose();
  }
});

test('a different triangle entering or leaving a cached search region invalidates the result; caches cannot cross tree instances', async () => {
  const THREE = await import('three');
  const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, .5, 1, 0, .5, 0, 1, .5], 3)); g.setIndex([0, 1, 2, 3, 4, 5]);
  const tree = createWaxCollisionTree(g, { nearestGrid: true }), oracle = createWaxCollisionTree(g), point = new THREE.Vector3(.2, .2, .004), hint = { faceIndex: 0 };
  tree.getQueryCounters(true); tree.signedDistance(point, undefined, hint); tree.signedDistance(point, undefined, hint);
  assert.equal(tree.getQueryCounters().cachedQueries, 1);
  for (const z of [.002, .5]) {
    for (let i = 3; i < 6; i++) g.attributes.position.setZ(i, z);
    tree.refit(); oracle.refit();
    assert.equal(tree.signedDistance(point, undefined, hint), oracle.signedDistance(point));
    assert.equal(tree.getQueryCounters().cachedQueries, 0, 'Moving an old or new triangle through the query region must invalidate it');
  }
  const otherGeometry = g.clone(); for (let i = 0; i < 3; i++) otherGeometry.attributes.position.setZ(i, -.01);
  const other = createWaxCollisionTree(otherGeometry, { nearestGrid: true }); other.getQueryCounters(true);
  assert.equal(other.signedDistance(point, undefined, hint), createWaxCollisionTree(otherGeometry).signedDistance(point));
  assert.equal(other.getQueryCounters().cachedQueries, 0, 'Per-site hints cannot carry a result from another toy');
  g.dispose(); otherGeometry.dispose();
});
