const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

test('local live-triangle grid preserves full BVH results, including ties, dynamic refit and out-of-grid fallback', async t => {
  const THREE = await import('three');
  const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
  for (const id of ['orb', 'paw', 'donut']) {
    const mesh = readMesh(`./assets/models/squishy-${id}.glb`), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3)); geometry.setIndex(mesh.indices);
    const reference = createWaxCollisionTree(geometry), accelerated = createWaxCollisionTree(geometry, { nearestGrid: true });
    accelerated.getQueryCounters(true);
    let exercised = 0, sweepExercises = 0;
    for (let phase = 0; phase < 3; phase++) {
      if (phase) {
        const p = geometry.attributes.position;
        for (let i = 0; i < p.count; i++) if (phase === 2 || p.getZ(i) > 0 && Math.hypot(p.getX(i), p.getY(i)) < .6) p.setXYZ(i, p.getX(i) * (phase === 2 ? 2 : 1), p.getY(i), p.getZ(i) - (phase === 1 ? .2 : 0));
        reference.refit(); accelerated.refit();
      }
      const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), normal = a.clone(), actualNormal = a.clone(), expectedNormal = a.clone();
      for (let face = 0; face < mesh.indices.length / 3; face += Math.max(1, Math.floor(mesh.indices.length / 3 / 120))) {
        a.fromBufferAttribute(geometry.attributes.position, mesh.indices[face * 3]); b.fromBufferAttribute(geometry.attributes.position, mesh.indices[face * 3 + 1]); c.fromBufferAttribute(geometry.attributes.position, mesh.indices[face * 3 + 2]);
        new THREE.Triangle(a, b, c).getNormal(normal);
        for (const point of [a.clone(), a.clone().add(b).multiplyScalar(.5), a.clone().add(b).add(c).multiplyScalar(1 / 3)]) for (const offset of [-.004, 0, .004, .014]) {
          const query = point.clone().addScaledVector(normal, offset);
          const expected = reference.signedDistance(query, expectedNormal, face), actual = accelerated.signedDistance(query, actualNormal, face);
          assert.ok(Math.abs(actual - expected) < 1e-12, `${id}/${phase}/${face}: ${actual} vs ${expected}`);
          assert.ok(actualNormal.distanceTo(expectedNormal) < 1e-12, 'Ambiguous nearest faces must preserve BVH tie ordering');
          if (offset === .004) {
            const displacement = normal.clone().multiplyScalar(-.012);
            const expectedSweep = reference.sweep(query, displacement), actualSweep = accelerated.sweep(query, displacement);
            assert.ok(Math.abs(actualSweep - expectedSweep) < 1e-12, `${id}/${phase}/${face}: short live-triangle grid sweep ${actualSweep} vs ${expectedSweep}`);
          }
        }
      }
      exercised += accelerated.getQueryCounters().gridQueries;
      sweepExercises += accelerated.getQueryCounters().gridSweeps;
      if (phase === 2) assert.equal(accelerated.getQueryCounters().gridQueries, 0, 'Moving beyond the bounded grid must fall back to the live BVH');
    }
    assert.ok(exercised > 100, 'Actually exercise the grid rather than only its fallback');
    assert.ok(sweepExercises > 100, 'Actually exercise exact segment-grid queries rather than only BVH fallback');
    t.diagnostic(JSON.stringify({ id, actualGridQueries: exercised, actualGridSweeps: sweepExercises })); geometry.dispose();
  }
});

test('same-panel edge deduplication preserves every distinct sampled position and exactly the same collision fraction', async t => {
  const THREE = await import('three');
  const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
  const { createWaxSweepSchedule } = await import('../src/thin-wax-panels.mjs');
  for (const id of ['orb', 'paw', 'donut']) {
    const mesh = readMesh(`./assets/models/squishy-${id}.glb`), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3)); geometry.setIndex(mesh.indices);
    const triangles = Array.from({ length: 100 }, (_, i) => mesh.indices.slice(i * 3, i * 3 + 3));
    const schedule = createWaxSweepSchedule(triangles), tree = createWaxCollisionTree(geometry);
    const ids = [...new Set(triangles.flat())], mapped = new Map(ids.map(i => {
      const support = new THREE.Vector3(...mesh.positions.slice(i * 3, i * 3 + 3)).addScaledVector(new THREE.Vector3(...mesh.normals.slice(i * 3, i * 3 + 3)), .004);
      return [i, { support, target: support.clone().addScaledVector(new THREE.Vector3(...mesh.normals.slice(i * 3, i * 3 + 3)), Math.sin(i * .37) * .03) }];
    }));
    const old = [], unique = [];
    const midpoint = (a, b) => ['support', 'target'].map(k => mapped.get(a)[k].clone().add(mapped.get(b)[k]).multiplyScalar(.5));
    for (const sample of schedule) {
      const centroid = ['support', 'target'].map(k => sample.triangle.reduce((v, i) => v.add(mapped.get(i)[k]), new THREE.Vector3()).multiplyScalar(1 / 3));
      old.push(centroid); unique.push(centroid);
      for (const edge of sample.edges) { old.push(midpoint(edge.a, edge.b)); if (edge.first) unique.push(midpoint(edge.a, edge.b)); }
    }
    const keys = list => [...new Set(list.map(pair => JSON.stringify(pair.map(v => v.toArray()))))].sort();
    assert.deepEqual(keys(unique), keys(old), 'No unique support/target sample pair may be removed');
    assert.ok(unique.length < old.length, 'Shared edges really eliminate duplicate queries');
    t.diagnostic(JSON.stringify({ id, logicalQueries: old.length, actualQueries: unique.length, distinctSamplePairs: keys(unique).length }));
    const fraction = list => Math.min(1, ...list.map(([support, target]) => { const d = target.clone().sub(support), length = d.length(); return length < 1e-8 ? 1 : tree.sweep(support, d) / length; }));
    assert.equal(fraction(unique), fraction(old));
    const again = createWaxSweepSchedule(triangles); assert.equal(again[0].edges[0].first, true, 'A distinct panel owns a distinct schedule and cannot borrow another crack target');
    geometry.dispose();
  }
});

test('finite-segment BVH pruning equals a complete live-triangle scan, including inside boxes, parallel axes and signed directions', async () => {
  const THREE = await import('three');
  const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
  for (const id of ['orb', 'paw', 'donut']) {
    const mesh = readMesh(`./assets/models/squishy-${id}.glb`), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3)); geometry.setIndex(mesh.indices);
    const tree = createWaxCollisionTree(geometry), ray = new THREE.Ray(), a = new THREE.Vector3(), b = a.clone(), c = a.clone(), hit = a.clone();
    function brute(origin, displacement) {
      let nearest = displacement.length(); if (nearest < 1e-8) return nearest;
      ray.origin.copy(origin); ray.direction.copy(displacement).normalize();
      for (let f = 0; f < mesh.indices.length; f += 3) {
        a.fromBufferAttribute(geometry.attributes.position, mesh.indices[f]); b.fromBufferAttribute(geometry.attributes.position, mesh.indices[f + 1]); c.fromBufferAttribute(geometry.attributes.position, mesh.indices[f + 2]);
        if (ray.intersectTriangle(a, b, c, false, hit)) { const distance = hit.distanceTo(origin); if (distance > 1e-6) nearest = Math.min(nearest, distance); }
      }
      return nearest;
    }
    const cases = [];
    for (const origin of [[0, 0, 0], [0, 0, 2], [0, 0, -2], [1, 0, 0], [0, 1, 0], [.35, 0, 0]]) {
      for (const displacement of [[0, 0, 3], [0, 0, -3], [3, 0, 0], [-3, 0, 0], [0, 3, 0], [0, -3, 0], [.0001, 0, 0], [0, 0, 0], [1e-12, 1, -1e-12]]) cases.push([origin, displacement]);
    }
    for (let i = 0; i < mesh.positions.length / 3; i += Math.max(1, Math.floor(mesh.positions.length / 3 / 70))) {
      const p = mesh.positions.slice(i * 3, i * 3 + 3), normal = mesh.normals.slice(i * 3, i * 3 + 3);
      cases.push([p, normal.map(x => x * -.1)]);
      cases.push([p.map((x, k) => x + normal[k] * .004), normal.map(x => x * -.02)]);
      cases.push([p.map((x, k) => x + normal[k] * .004), normal.map(x => x * .001)]);
    }
    const siteHints = Array.from({ length: 45 }, (_, i) => ({ faceIndex: i }));
    for (let phase = 0; phase < 2; phase++) {
      if (phase) { const p = geometry.attributes.position; for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0 && Math.hypot(p.getX(i), p.getY(i)) < .6) p.setZ(i, p.getZ(i) - .2); tree.refit(); }
      for (const [o, d] of cases) {
        const origin = new THREE.Vector3(...o), displacement = new THREE.Vector3(...d), expected = brute(origin, displacement), actual = tree.sweep(origin, displacement);
        assert.ok(Math.abs(actual - expected) <= 1e-12, `${id} phase ${phase}, ${JSON.stringify({ o, d, actual, expected })}`);
      }
      const triangle = new THREE.Triangle(), nearest = new THREE.Vector3(), faceNormal = new THREE.Vector3(), actualNormal = new THREE.Vector3();
      for (let sample = 0; sample < 45; sample++) {
        const point = new THREE.Vector3(Math.sin(sample * 7.13) * 1.25, Math.cos(sample * 3.57) * 1.25, Math.sin(sample * 1.17) * .7);
        let distance = Infinity, second = Infinity, signed = Infinity, expectedNormal;
        for (let f = 0; f < mesh.indices.length; f += 3) {
          triangle.set(a.fromBufferAttribute(geometry.attributes.position, mesh.indices[f]), b.fromBufferAttribute(geometry.attributes.position, mesh.indices[f + 1]), c.fromBufferAttribute(geometry.attributes.position, mesh.indices[f + 2]));
          triangle.closestPointToPoint(point, nearest); const d = nearest.distanceTo(point);
          if (d < distance) { second = distance; distance = d; triangle.getNormal(faceNormal); expectedNormal = faceNormal.clone(); signed = point.clone().sub(nearest).dot(faceNormal) < 0 ? -d : d; }
          else second = Math.min(second, d);
        }
        const actual = tree.signedDistance(point, actualNormal);
        assert.ok(Math.abs(Math.abs(actual) - Math.abs(signed)) < 1e-12, `${id} phase ${phase} nearest distance ${actual} vs ${signed}`);
        if (second - distance > 1e-10) { assert.ok(Math.abs(actual - signed) < 1e-12); assert.ok(actualNormal.distanceTo(expectedNormal) < 1e-12, 'Non-tied nearest face and its outward normal must stay exact'); }
        const hinted = tree.signedDistance(point, actualNormal, sample % (mesh.indices.length / 3));
        assert.ok(Math.abs(Math.abs(hinted) - Math.abs(signed)) < 1e-12, 'An arbitrary current source-face hint cannot change the exact nearest distance');
        if (second - distance > 1e-10) { assert.ok(Math.abs(hinted - signed) < 1e-12); assert.ok(actualNormal.distanceTo(expectedNormal) < 1e-12); }
        const siteValue = tree.signedDistance(point, actualNormal, siteHints[sample]);
        assert.ok(Math.abs(Math.abs(siteValue) - Math.abs(signed)) < 1e-12, 'Per-site face indices must be re-evaluated after refit, not reuse old distances');
        if (second - distance > 1e-10) { assert.ok(Math.abs(siteValue - signed) < 1e-12); assert.ok(actualNormal.distanceTo(expectedNormal) < 1e-12); }
      }
    }
    geometry.dispose();
  }
});
