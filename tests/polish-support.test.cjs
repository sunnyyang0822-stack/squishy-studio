const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

// This test deliberately uses the independently maintained whole-mesh BVH,
// rather than the polish implementation's corresponding-source-face metric.
// Every rendered vertex, every unique edge midpoint and every face centroid is
// checked at each listed phase. This is discrete coverage, not a continuous
// collision proof and not a substitute for the browser/GPU visual checks.
test('round clay polish stays outside the whole live core during deep pressure, sliding, repeats and restore', { timeout: 120000 }, async t => {
  const THREE = await import('three');
  const { createPolishShell } = await import('../src/polish-shell.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
  const data = readMesh('assets/models/squishy-orb.glb');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geometry.setIndex(data.indices);
  const rest = geometry.attributes.position.array.slice();
  const bare = geometry.clone();
  const core = getOrbFeel('clay').createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array);
  const nakedCore = getOrbFeel('clay').createDeformation(bare.attributes.position.array, bare.attributes.normal.array);
  const shell = createPolishShell({ geometry, restPositions: rest, color: '#f7e1a3' });
  const tree = createWaxCollisionTree(geometry, { featureNormals: true, restPositions: rest });
  const index = geometry.index.array, edges = new Map();
  for (let face = 0; face < index.length; face += 3) for (let k = 0; k < 3; k++) {
    const a = index[face + k], b = index[face + (k + 1) % 3];
    edges.set(a < b ? `${a}:${b}` : `${b}:${a}`, [a, b]);
  }
  let comparedFrames = 0, totalSamples = 0;
  const phases = [], p = new THREE.Vector3(), a = p.clone(), b = p.clone(), c = p.clone();
  function sameCore() {
    assert.deepEqual(geometry.attributes.position.array, bare.attributes.position.array, 'Adding a shell must never change the clay trajectory');
    assert.deepEqual(core.getState(), nakedCore.getState());
  }
  function advance(duration) {
    const frames = Math.round(duration * 60);
    for (let frame = 0; frame < frames; frame++) {
      assert.deepEqual(core.step(1 / 60), nakedCore.step(1 / 60));
      geometry.computeVertexNormals(); bare.computeVertexNormals();
      shell.step(1 / 60); sameCore(); comparedFrames++;
    }
  }
  function begin(point) { core.begin(point); nakedCore.begin(point); shell.begin(point); }
  function end() { core.release(); nakedCore.release(); shell.end(); }
  function measure(phase) {
    tree.refit();
    const positions = shell.geometry.attributes.position;
    let minimum = Infinity, maximum = -Infinity, violations = 0, samples = 0;
    let worst = null;
    function query(point, kind, id) {
      const value = tree.signedDistance(point);
      if (value < minimum) { minimum = value; worst = { kind, id, position: point.toArray() }; }
      maximum = Math.max(maximum, value); samples++;
      if (value < 0 || value > .004) violations++;
    }
    for (let i = 0; i < positions.count; i++) query(p.fromBufferAttribute(positions, i), 'vertex', i);
    for (const [i, j] of edges.values()) query(p.fromBufferAttribute(positions, i).add(a.fromBufferAttribute(positions, j)).multiplyScalar(.5), 'edge', [i, j]);
    for (let face = 0; face < index.length; face += 3) {
      p.fromBufferAttribute(positions, index[face]); a.fromBufferAttribute(positions, index[face + 1]); b.fromBufferAttribute(positions, index[face + 2]);
      query(p.add(a).add(b).multiplyScalar(1 / 3), 'centroid', face / 3);
    }
    const result = { phase, samples, minWholeCoreSignedDistance: minimum, maxWholeCoreNearestGap: maximum, violations, worst };
    phases.push(result); totalSamples += samples;
    assert.equal(violations, 0, JSON.stringify(result));
    assert.ok(minimum >= 0, JSON.stringify(result)); assert.ok(maximum <= .004, JSON.stringify(result));
    // Independent ray parity spot-checks the BVH sign at the largest dent.
    const corePositions = geometry.attributes.position.array;
    let deepest = 0, maxDepth = 0;
    for (let i = 0; i < corePositions.length; i += 3) {
      const depth = Math.hypot(corePositions[i] - rest[i], corePositions[i + 1] - rest[i + 1], corePositions[i + 2] - rest[i + 2]);
      if (depth > maxDepth) { maxDepth = depth; deepest = i / 3; }
    }
    const origin = new THREE.Vector3().fromBufferAttribute(positions, deepest);
    for (const direction of [[1, .231, .643], [.317, 1, .173], [.413, .239, 1]]) {
      const ray = new THREE.Ray(origin, new THREE.Vector3(...direction).normalize()), distances = [];
      for (let face = 0; face < index.length; face += 3) {
        a.fromBufferAttribute(geometry.attributes.position, index[face]); b.fromBufferAttribute(geometry.attributes.position, index[face + 1]); c.fromBufferAttribute(geometry.attributes.position, index[face + 2]);
        if (ray.intersectTriangle(a, b, c, false, p)) { const distance = p.distanceTo(origin); if (distance > 1e-8) distances.push(distance); }
      }
      distances.sort((x, y) => x - y);
      const unique = distances.filter((distance, i) => !i || distance - distances[i - 1] > 1e-7);
      assert.equal(unique.length % 2, 0, `${phase}: deepest actual shell vertex must be outside by independent ray parity`);
    }
    sameCore();
  }
  const front = theta => [Math.sin(theta), .0175, Math.cos(theta)];
  try {
    measure('rest');
    begin(front(0)); advance(.15); measure('shallow-150ms');
    advance(2.85); measure('deep-3s');
    end(); advance(.5); measure('released-clay-retained');
    begin(front(-.5));
    for (let segment = 1; segment <= 12; segment++) {
      const point = front(-.5 + segment / 12);
      core.move(point, segment / 12); nakedCore.move(point, segment / 12); shell.move(point);
      advance(.05);
      if (segment % 4 === 0) measure(`slide-${segment}/12`);
    }
    end(); advance(.25);
    for (let cycle = 1; cycle <= 4; cycle++) {
      begin(front(0)); advance(.5); end(); advance(.15); measure(`repeat-${cycle}`);
    }
    core.beginRestore(); nakedCore.beginRestore();
    for (const progress of [0, .1, .5, .9, 1]) {
      core.applyRestore(progress); nakedCore.applyRestore(progress);
      assert.deepEqual(core.step(0), nakedCore.step(0));
      geometry.computeVertexNormals(); bare.computeVertexNormals(); shell.sync();
      measure(`explicit-restore-${progress}`);
    }
    assert.ok(comparedFrames > 400); assert.ok(totalSamples > 200000);
    t.diagnostic(JSON.stringify({ model: 'assets/models/squishy-orb.glb', core: 'clay', comparedFrames, totalSamples, vertices: geometry.attributes.position.count, uniqueEdges: edges.size, faces: index.length / 3, sampling: 'all shell vertices, all unique edge midpoints, all face centroids at every reported phase; 3 independent ray directions at deepest vertex', phases }));
  } finally { shell.dispose(); geometry.dispose(); bare.dispose(); }
});
