const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFixture, contactPoint } = require('./helpers/thick-nonpaw-geometry.cjs');
test('deep torus wax verifier distinguishes a concave-edge false sign from actual interior using independent ray parity', async t => {
  const f = await createFixture('donut', 'thick-wax', 'slow-rebound');
  try {
    const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
    f.begin(contactPoint(f.mesh, .38, 0, true)); f.run(31); f.tree.refit();
    const plain = createWaxCollisionTree(f.geometry), snapshot = f.wax.getSurfaceSnapshot();
    const a = new f.THREE.Vector3(), b = a.clone(), c = a.clone(), hit = a.clone();
    for (const example of [{ point: [.33528026938438416, -.04973401129245758, .2199999988079071], inside: false }, { point: [-.7, 0, 0], inside: true }]) {
      const point = new f.THREE.Vector3(...example.point), counts = [];
      if (!example.inside) {
        let distance = Infinity;
        for (let i = 0; i < snapshot.positions.length; i += 3) distance = Math.min(distance, Math.hypot(...[0, 1, 2].map(k => snapshot.positions[i + k] - example.point[k])));
        assert.ok(distance < 1e-6, 'The reproduced point belongs to the actual rendered thick wax');
      }
      for (const direction of [[1, .231, .643], [.317, 1, .173], [.413, .239, 1]]) {
        const ray = new f.THREE.Ray(point, new f.THREE.Vector3(...direction).normalize()), distances = [];
        for (let i = 0; i < f.mesh.indices.length; i += 3) {
          a.fromBufferAttribute(f.geometry.attributes.position, f.mesh.indices[i]);
          b.fromBufferAttribute(f.geometry.attributes.position, f.mesh.indices[i + 1]);
          c.fromBufferAttribute(f.geometry.attributes.position, f.mesh.indices[i + 2]);
          if (ray.intersectTriangle(a, b, c, false, hit)) { const d = hit.distanceTo(point); if (d > 1e-8) distances.push(d); }
        }
        distances.sort((a, b) => a - b);
        const unique = distances.filter((d, i) => !i || d - distances[i - 1] > 1e-7);
        counts.push(unique.length); assert.equal(unique.length % 2 === 1, example.inside);
      }
      const robust = f.tree.signedDistance(point), legacy = plain.signedDistance(point);
      assert.equal(robust < 0, example.inside);
      assert.ok(Math.abs(Math.abs(robust) - Math.abs(legacy)) < 1e-12);
      if (!example.inside) assert.ok(legacy < 0 && robust > 0);
      t.diagnostic(JSON.stringify({ ...example, rayCounts: counts, robust, legacy }));
    }
  } finally { f.dispose(); }
});
