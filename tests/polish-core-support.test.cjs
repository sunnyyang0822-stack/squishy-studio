const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

// Whole-live-core nearest distances are independent of the polish factory's
// source-face plane metrics. All vertices, unique edge midpoints and triangle
// centroids are checked at every reported phase; this is discrete coverage.
for (const feelId of ['marshmallow', 'slow-rebound']) for (const reducedMotion of [false, true]) {
  test(`round ${feelId} polish: whole-core support, unchanged core and recovery (${reducedMotion ? 'reduced' : 'normal'})`, { timeout: 120000 }, async t => {
    const THREE = await import('three');
    const { createPolishShell } = await import('../src/polish-shell.mjs');
    const { getOrbFeel } = await import('../src/orb-feels.mjs');
    const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
    const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
    const data = readMesh('assets/models/squishy-orb.glb');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    geometry.setIndex(data.indices);
    const rest = geometry.attributes.position.array.slice(), restNormals = geometry.attributes.normal.array.slice();
    const bareGeometry = geometry.clone();
    // Same outward, model-local ray direction as the formal orthographic
    // camera at [0,1.6,5], looking at [0,-.02,0]. Later rotation changes it.
    let direction = new THREE.Vector3(0, 1.62, 5).normalize().toArray();
    const options = () => {
      if (feelId !== 'slow-rebound') return { reducedMotion };
      const support = createSurfaceGeometry(rest.slice(), restNormals.slice(), data.indices);
      return { reducedMotion, getPressDirection: () => direction,
        constrainPress: support.createContactSafety(), getPressRadius: (i, d) => support.contactRadius(i, d) };
    };
    const core = getOrbFeel(feelId).createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array, options());
    const naked = getOrbFeel(feelId).createDeformation(bareGeometry.attributes.position.array, bareGeometry.attributes.normal.array, options());
    const shell = createPolishShell({ geometry, restPositions: rest, feelId, restNormals, color: '#f7e1a3' });
    const tree = createWaxCollisionTree(geometry, { featureNormals: true, restPositions: rest });
    const edges = new Map(), index = geometry.index.array;
    for (let face = 0; face < index.length; face += 3) for (let k = 0; k < 3; k++) {
      const a = index[face + k], b = index[face + (k + 1) % 3];
      edges.set(a < b ? `${a}:${b}` : `${b}:${a}`, [a, b]);
    }
    const records = [], point = new THREE.Vector3(), a = point.clone(), b = point.clone(), c = point.clone();
    let comparedFrames = 0, totalSamples = 0;
    function same() {
      assert.deepEqual(geometry.attributes.position.array, bareGeometry.attributes.position.array, `${feelId}: shell must leave every core position unchanged`);
      assert.deepEqual(core.getState(), naked.getState());
    }
    function act(method, ...args) { core[method](...args); naked[method](...args); same(); }
    function sync(result) {
      if (result.changed) {
        if (result.atRest) geometry.attributes.normal.array.set(restNormals);
        else geometry.computeVertexNormals();
      }
      shell.step(1 / 60); same();
    }
    function frame() {
      const result = core.step(1 / 60);
      assert.deepEqual(result, naked.step(1 / 60));
      sync(result); comparedFrames++;
    }
    function advance(seconds) { for (let i = 0; i < Math.round(seconds * 60); i++) frame(); }
    function contact(x = 0, y = .23) {
      let best = Infinity, output;
      for (let i = 0; i < rest.length; i += 3) if (restNormals[i + 2] > .4) {
        const d = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2;
        if (d < best) { best = d; output = Array.from(rest.slice(i, i + 3)); }
      }
      return output;
    }
    function begin(p = contact()) { act('begin', p); shell.begin(p); }
    function end(method = 'release') { act(method); shell.end(); }
    function history() { return shell.getSurfaceSnapshot().damage; }
    function measure(phase) {
      tree.refit();
      const positions = shell.geometry.attributes.position;
      let min = Infinity, max = 0, violations = 0, samples = 0, worst;
      function query(p, kind, id) {
        const d = tree.signedDistance(p); samples++;
        if (d < min) { min = d; worst = { kind, id, position: p.toArray() }; }
        max = Math.max(max, d); if (d < 0 || d > .004) violations++;
      }
      for (let i = 0; i < positions.count; i++) query(point.fromBufferAttribute(positions, i), 'vertex', i);
      for (const [i, j] of edges.values()) query(point.fromBufferAttribute(positions, i).add(a.fromBufferAttribute(positions, j)).multiplyScalar(.5), 'edge', [i, j]);
      for (let face = 0; face < index.length; face += 3) {
        point.fromBufferAttribute(positions, index[face]); a.fromBufferAttribute(positions, index[face + 1]); b.fromBufferAttribute(positions, index[face + 2]);
        query(point.add(a).add(b).multiplyScalar(1 / 3), 'centroid', face / 3);
      }
      const result = { phase, samples, minWholeCoreSignedDistance: min, maxWholeCoreNearestGap: max, violations, depth: core.getState().depth, maxDamage: shell.getState().maxDamage, maxOpening: shell.getState().maxOpening, worst };
      records.push(result); totalSamples += samples;
      assert.equal(violations, 0, JSON.stringify({ feelId, reducedMotion, ...result }));
      assert.ok(min >= 0); assert.ok(max <= .004);
      // Three independent ray directions verify the sign at the deepest shell
      // vertex, without using nearest face normals or a radial sphere proxy.
      const corePositions = geometry.attributes.position.array;
      let deepest = 0, depth = -1;
      for (let i = 0; i < corePositions.length; i += 3) {
        const d = Math.hypot(corePositions[i] - rest[i], corePositions[i + 1] - rest[i + 1], corePositions[i + 2] - rest[i + 2]);
        if (d > depth) { depth = d; deepest = i / 3; }
      }
      const origin = new THREE.Vector3().fromBufferAttribute(positions, deepest);
      for (const vector of [[1, .231, .643], [.317, 1, .173], [.413, .239, 1]]) {
        const ray = new THREE.Ray(origin, new THREE.Vector3(...vector).normalize()), distances = [];
        for (let face = 0; face < index.length; face += 3) {
          a.fromBufferAttribute(geometry.attributes.position, index[face]); b.fromBufferAttribute(geometry.attributes.position, index[face + 1]); c.fromBufferAttribute(geometry.attributes.position, index[face + 2]);
          if (ray.intersectTriangle(a, b, c, false, point)) { const d = point.distanceTo(origin); if (d > 1e-8) distances.push(d); }
        }
        distances.sort((x, y) => x - y);
        assert.equal(distances.filter((d, i) => !i || d - distances[i - 1] > 1e-7).length % 2, 0, `${phase}: deepest shell vertex outside by independent ray parity`);
      }
      same();
    }
    try {
      measure('rest');
      begin(); advance(.15); measure('shallow-150ms');
      advance(2.85); measure('deep-3s');
      assert.ok(core.getState().depth > .4, 'Actual core must reach a deep press before support is accepted');
      const deepHistory = history(), deepOpening = shell.getState().maxOpening;
      end();
      for (let step = 0; step < 4; step++) {
        advance(.5); measure(`released-${(step + 1) * .5}s`);
        assert.deepEqual(history(), deepHistory, 'Unloading must keep every vertex of the damage history');
      }
      if (feelId === 'marshmallow') assert.equal(shell.getState().maxOpening, deepOpening, 'Plastic marshmallow keeps its existing impression');
      else {
        assert.ok(shell.getState().maxOpening < deepOpening * .3, 'Slow recovery narrows current openings while retaining cracks');
        for (let i = 0; i < 1000 && core.getState().depth > 0; i++) frame();
        assert.deepEqual(geometry.attributes.position.array, rest, 'Slow rebound must restore its exact original geometry');
        assert.deepEqual(history(), deepHistory); measure('complete-natural-recovery');
      }
      begin(contact(-.45));
      for (let segment = 1; segment <= 24; segment++) {
        const p = contact(-.45 + .9 * segment / 24);
        act('move', p, segment / 24); shell.move(p); advance(.05);
        if (segment % 8 === 0) measure(`long-slide-${segment}/24`);
      }
      end('cancel'); advance(.3); measure('slide-cancelled');
      for (let cycle = 1; cycle <= 3; cycle++) {
        begin(); advance(.8); end(); advance(.15); measure(`repeat-${cycle}`);
      }
      const permanent = history();
      act('beginRestore');
      for (const progress of [0, .2, .5]) {
        act('applyRestore', progress);
        const result = core.step(0); assert.deepEqual(result, naked.step(0)); sync(result);
        measure(`explicit-restore-${progress}`); assert.deepEqual(history(), permanent);
      }
      const partiallyRestored = geometry.attributes.position.array.slice();
      // Rotating the object changes the input ray in local space. Preserve the
      // current restore geometry until the newly captured pressure starts.
      direction = new THREE.Vector3(.35, .2, 1).normalize().toArray();
      begin(contact(.22));
      assert.deepEqual(geometry.attributes.position.array, partiallyRestored, 'New begin must take over without a geometry jump');
      assert.equal(core.getState().restoring, false);
      advance(.5); measure('new-input-takes-over-mid-restore'); end('cancel');
      act('beginRestore');
      for (const progress of [.1, .5, .9, 1]) {
        act('applyRestore', progress);
        const result = core.step(0); assert.deepEqual(result, naked.step(0)); sync(result);
        measure(`final-restore-${progress}`);
      }
      assert.deepEqual(geometry.attributes.position.array, rest);
      assert.ok(shell.getState().maxDamage > 0, 'Restoring the core alone must not erase shell history');
      shell.reset(); assert.equal(shell.getState().maxDamage, 0); assert.equal(shell.getState().maxLocalContacts, 0);
      assert.equal(shell.step().needsFrame, false); measure('explicit-shell-reset');
      t.diagnostic(JSON.stringify({ model: 'assets/models/squishy-orb.glb', feelId, reducedMotion, comparedCoreFrames: comparedFrames, totalSamples, vertices: geometry.attributes.position.count, uniqueEdges: edges.size, faces: index.length / 3, sampling: 'all shell vertices, all unique edge midpoints, all face centroids at listed phases, plus independent ray parity at deepest vertex', records }));
    } finally { shell.dispose(); geometry.dispose(); bareGeometry.dispose(); }
  });
}
