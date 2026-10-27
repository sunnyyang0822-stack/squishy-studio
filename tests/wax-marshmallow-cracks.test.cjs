const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

const styles = process.env.WAX_MARSHMALLOW_CRACK_STYLE?.split(',') || ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
for (const id of styles) test(`${id} marshmallow shallow sliding opens actual attached wax boundaries before fragment timing`, async t => {
  const THREE = await import('three');
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const style = getSquishyStyle(id), mesh = readMesh(`.${style.modelUrl}`), rest = Float32Array.from(mesh.positions), normal = Float32Array.from(mesh.normals);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3)); geometry.setIndex(mesh.indices);
  const positions = geometry.attributes.position.array, barePositions = rest.slice(), feel = getOrbFeel('marshmallow');
  const settings = () => ({ surfaceGeometry: createSurfaceGeometry(rest.slice(), normal.slice(), mesh.indices, { ...style.geometryOptions, continuousFootprint: false }) });
  const core = feel.createDeformation(positions, normal.slice(), settings()), bare = feel.createDeformation(barePositions, normal.slice(), settings());
  let seconds = 0;
  const wax = getWaxPreset('thin-wax').create({ styleId: id, geometry, restPositions: rest, restNormals: normal, fullSurfaceSupport: true, collectionEnabled: false, clock: () => seconds });
  const initial = wax.getSurfaceSnapshot();
  function contact(x, y) {
    let chosen = -1, best = Infinity;
    for (let i = 0; i < rest.length; i += 3) {
      if (normal[i + 2] <= .25 || id === 'donut' && rest[i] * normal[i] + rest[i + 1] * normal[i + 1] >= -.03) continue;
      const distance = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2;
      if (distance < best) { best = distance; chosen = i; }
    }
    assert.ok(chosen >= 0); return Array.from(rest.slice(chosen, chosen + 3));
  }
  function act(method, ...args) { core[method](...args); bare[method](...args); assert.deepEqual(positions, barePositions); assert.deepEqual(core.getState(), bare.getState()); }
  function frame() {
    assert.deepEqual(core.step(1 / 60), bare.step(1 / 60)); assert.deepEqual(positions, barePositions); assert.deepEqual(core.getState(), bare.getState());
    geometry.computeVertexNormals(); seconds += 1 / 60; const result = wax.step(1 / 60); if (!result.changed) wax.sync();
    assert.equal(wax.getState().detached, 0, 'Every actual shallow frame remains before the 0.5-second fragment threshold');
  }
  const start = id === 'donut' ? [.38, 0] : id === 'paw' ? [0, .17] : id === 'flower' ? [.55, .05] : id === 'star' ? [.50, .15] : [.15, .1];
  try {
    const point = contact(...start); act('begin', point); wax.begin(point);
    for (let i = 0; i < 6; i++) frame();
    for (let i = 1; i <= 12; i++) { const p = contact(start[0] - .3 * i / 12, start[1] + .08 * i / 12); act('move', p, .31 / 12); wax.move(p); frame(); }
    act('release'); wax.end();
    assert.ok(seconds < .5); assert.ok(core.getState().depth > .004, 'The original marshmallow core really has a shallow sliding deformation');
    const state = wax.getState(), snapshot = wax.getSurfaceSnapshot();
    assert.ok(state.cracked > 0 && state.visibleLongCrackEdges > 0, 'Damage state exists independently of visible geometry');
    const groups = new Map();
    for (let r = 0; r < snapshot.layers.length; r++) {
      if (snapshot.layers[r] !== 0 || !snapshot.openBoundary[r] || !snapshot.boundaryVertex[r] || snapshot.detached[r]) continue;
      const key = Array.from(snapshot.restSupportPositions.slice(r * 3, r * 3 + 3), x => Math.round(x * 1e5)).join(',');
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r);
    }
    let pairedBoundarySamples = 0, visiblySeparatedPairs = 0, maximumTangentGap = 0;
    const a = new THREE.Vector3(), b = a.clone(), normalA = a.clone(), normalB = a.clone(), delta = a.clone();
    for (const rows of groups.values()) for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const ra = rows[i], rb = rows[j];
      if (snapshot.panelIds[ra] === snapshot.panelIds[rb]) continue;
      if (a.fromArray(snapshot.restSupportPositions, ra * 3).distanceTo(b.fromArray(snapshot.restSupportPositions, rb * 3)) > 1e-6) continue;
      if (a.fromArray(snapshot.sourceSupportPositions, ra * 3).distanceTo(b.fromArray(snapshot.sourceSupportPositions, rb * 3)) > 1e-6) continue;
      pairedBoundarySamples++;
      delta.fromArray(snapshot.positions, ra * 3).sub(b.fromArray(snapshot.positions, rb * 3));
      // Inner uploaded normals point inward. Their common plane removes pure
      // lift, so damage flags or a raised plate alone cannot satisfy the test.
      normalA.fromArray(snapshot.normals, ra * 3); normalB.fromArray(snapshot.normals, rb * 3); normalA.add(normalB).normalize();
      delta.addScaledVector(normalA, -delta.dot(normalA));
      const tangentGap = delta.length(); maximumTangentGap = Math.max(maximumTangentGap, tangentGap);
      if (tangentGap > .00075) visiblySeparatedPairs++;
    }
    assert.ok(pairedBoundarySamples > 0, 'Measure attached neighbor panels at the same actual rest/core boundary point');
    assert.ok(visiblySeparatedPairs > 0 && maximumTangentGap > .0015, `Shallow strain must open a real local crack before dropping fragments: ${JSON.stringify({ id, pairedBoundarySamples, visiblySeparatedPairs, maximumTangentGap })}`);
    // A wall's normal also depends on its other endpoint. Likewise an unmoved
    // source vertex can have a legitimately changed normal when an incident
    // core face deforms. Select complete, untouched source neighborhoods rather
    // than calling a single unmoved wall endpoint a remote surface.
    const affectedNeighborhood = new Uint8Array(rest.length / 3);
    for (let face = 0; face < mesh.indices.length; face += 3) {
      const ids = mesh.indices.slice(face, face + 3);
      if (ids.some(index => [0, 1, 2].some(k => positions[index * 3 + k] !== rest[index * 3 + k]))) for (const index of ids) affectedNeighborhood[index] = 1;
    }
    const remoteRows = new Set();
    for (let triangle = 0; triangle < snapshot.sourceFaces.length; triangle++) {
      const sourceFace = snapshot.sourceFaces[triangle];
      if (sourceFace < 0 || mesh.indices.slice(sourceFace * 3, sourceFace * 3 + 3).some(index => affectedNeighborhood[index])) continue;
      const rows = Array.from(snapshot.indices.slice(triangle * 3, triangle * 3 + 3));
      if (rows.some(r => snapshot.layers[r] !== 1 || snapshot.damage[r] || !snapshot.sourceUnmoved[r] || snapshot.restSupportPositions[r * 3 + 2] >= -.25)) continue;
      for (const r of rows) remoteRows.add(r);
    }
    const unchangedRemote = remoteRows.size;
    assert.ok(unchangedRemote > 0, 'Measure actual surface primitives with untouched source neighborhoods');
    for (const r of remoteRows) for (let k = 0; k < 3; k++) {
      assert.equal(snapshot.positions[r * 3 + k], initial.positions[r * 3 + k], `${id}: remote surface position`);
      assert.equal(snapshot.normals[r * 3 + k], initial.normals[r * 3 + k], `${id}: remote surface normal`);
    }
    const metrics = wax.getMetrics({ exhaustive: true });
    assert.equal(metrics.attachedViolations, 0); assert.equal(metrics.detachedViolations, 0); assert.ok(metrics.attachedMinGap >= .004 - metrics.tolerance); assert.ok(metrics.maxThicknessError < 1e-5);
    t.diagnostic(JSON.stringify({ id, seconds, depth: core.getState().depth, detached: state.detached, cracked: state.cracked, pairedBoundarySamples, visiblySeparatedPairs, maximumTangentGap, unchangedRemote, maxActualInnerGap: metrics.attachedMaxSignedDistance, maxThicknessError: metrics.maxThicknessError }));
  } finally { wax.dispose(); geometry.dispose(); }
});
