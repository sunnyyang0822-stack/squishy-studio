const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

const requested = process.env.WAX_MARSHMALLOW_GEOMETRY_CASE;
const styles = requested ? requested.split(',') : ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];

for (const id of styles) test(`${id} marshmallow reuses thin-wax preset without changing core; actual deep/drag/rim/restore geometry`, async t => {
  const THREE = await import('three');
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { getOrbPreset } = await import('../src/orb-presets.mjs');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const { createWaxCollisionTree, thinWaxParameters } = await import('../src/thin-wax.mjs');
  const { createVoronoiWax } = await import('../src/thin-wax-panels.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const { getOrbAppearance, getModelPresentationScale } = await import('../src/orb-appearance.mjs');
  const style = getSquishyStyle(id), actual = readMesh(`.${style.modelUrl}`);
  assert.equal(style.geometryAdapter, 'surface'); assert.ok(style.supportedFeels.includes('marshmallow'));
  const rest = Float32Array.from(actual.positions), normals = Float32Array.from(actual.normals), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setIndex(actual.indices);
  const positions = geometry.attributes.position.array, barePositions = rest.slice(), feel = getOrbFeel('marshmallow');
  // The two independent geometry adapters mirror the existing scene's factory
  // options. They must not share the mutable safety/history buffers.
  const options = () => ({ surfaceGeometry: createSurfaceGeometry(rest.slice(), normals.slice(), actual.indices, { ...style.geometryOptions, continuousFootprint: false }) });
  const core = feel.createDeformation(positions, normals.slice(), options());
  const bare = feel.createDeformation(barePositions, normals.slice(), options());
  const sourceMaterial = new THREE.MeshStandardMaterial(), coreMaterial = getOrbPreset('marshmallow').createMaterial(sourceMaterial);
  coreMaterial.color.set('#9cdbb6'); const coreColor = coreMaterial.color.clone();
  let seconds = 0;
  const waxOptions = { styleId: id, geometry, restPositions: rest, restNormals: normals, color: '#f8dcac', collectionEnabled: false, fullSurfaceSupport: true, captureCorrectionGeometry: Boolean(process.env.WAX_CORRECTION_SNAPSHOT_FILE), clock: () => seconds };
  const legacySign = process.env.WAX_LEGACY_COLLISION_SIGN === '1';
  const wax = legacySign
    ? createVoronoiWax(waxOptions, thinWaxParameters, (g, settings) => createWaxCollisionTree(g, { ...settings, featureNormals: false }))
    : getWaxPreset('thin-wax').create(waxOptions);
  const shellMaterial = wax.group.children.find(object => object.isMesh).material;
  const shellColor = shellMaterial.color.clone(), scale = getModelPresentationScale(getOrbAppearance('matte'), style.geometryAdapter);
  wax.setWorldMatrix(new THREE.Matrix4().makeScale(...scale));
  assert.notDeepEqual(shellColor.toArray(), coreColor.toArray());
  const record = { id, core: 'marshmallow', legacySign, scale, phases: [], comparedCoreFrames: 0 };
  function same() {
    assert.deepEqual(positions, barePositions, `${id}: the shell cannot alter any core vertex`);
    assert.deepEqual(core.getState(), bare.getState(), `${id}: the original feel state must remain identical`);
    assert.ok(coreMaterial.color.equals(coreColor)); assert.ok(shellMaterial.color.equals(shellColor));
  }
  function act(method, ...args) { core[method](...args); bare[method](...args); same(); }
  function advance(count, shellEvery = 1) {
    let pending = 0;
    for (let frame = 0; frame < count; frame++) {
      assert.deepEqual(core.step(1 / 60), bare.step(1 / 60)); record.comparedCoreFrames++; same(); pending++;
      if (pending === shellEvery || frame === count - 1) {
        geometry.computeVertexNormals(); seconds += pending / 60;
        const result = wax.step(pending / 60); if (!result.changed) wax.sync(); pending = 0; same();
      }
    }
  }
  function inspect(label) {
    const g = wax.getMetrics({ exhaustive: true });
    record.phases.push({ label, coreDepth: core.getState().depth, detached: wax.getState().detached, thickness: g.thickness, gap: g.gap,
      attachedMinGap: g.attachedMinGap, attachedMinSignedDistance: g.attachedMinSignedDistance, detachedMinSignedDistance: g.detachedMinSignedDistance,
      attachedViolations: g.attachedViolations, detachedViolations: g.detachedViolations, maxThicknessError: g.maxThicknessError,
      attachedSurfaceSamples: g.attachedSurfaceSamples, detachedInteriorSamples: g.detachedInteriorSamples, wallSamples: g.wallSamples,
      attachedCorrectionMax: g.attachedCorrectionMax, attachedCorrectionTotalMax: g.attachedCorrectionTotalMax,
      attachedMaxSignedDistance: g.attachedMaxSignedDistance, worstAttachedMaxSample: g.worstAttachedMaxSample, attachedOuterMaxSignedDistance: g.attachedOuterMaxSignedDistance, attachedWallMaxSignedDistance: g.attachedWallMaxSignedDistance, worstAttachedCorrection: g.worstAttachedCorrection });
    if (label === 'intact' && g.worstAttachedSample) {
      // Check that diagnostic triangle IDs actually locate the reported point
      // in the uploaded shell geometry, rather than merely naming a source face.
      const snapshot = wax.getSurfaceSnapshot(), worst = g.worstAttachedSample, point = new THREE.Vector3(...worst.point);
      if (worst.sampleKind.endsWith('-vertex')) {
        assert.equal(snapshot.panelIds[worst.renderedVertex], worst.panelId);
        assert.ok(new THREE.Vector3().fromArray(snapshot.positions, worst.renderedVertex * 3).distanceTo(point) < 1e-12);
      } else {
        const triangle = Array.from(snapshot.indices.slice(worst.renderTriangleId * 3, worst.renderTriangleId * 3 + 3));
        assert.equal(triangle.length, 3); assert.ok(triangle.every(i => snapshot.panelIds[i] === worst.panelId));
        const points = triangle.map(i => new THREE.Vector3().fromArray(snapshot.positions, i * 3));
        if (worst.sampleKind.endsWith('-edge-midpoint')) assert.ok(points.some((a, i) => a.clone().add(points[(i + 1) % 3]).multiplyScalar(.5).distanceTo(point) < 1e-12));
        else assert.ok(points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3).distanceTo(point) < 1e-12);
      }
      if (worst.sampleKind.startsWith('wall-')) assert.ok(worst.sourceVertexFaces.every(face => Number.isInteger(face) && face >= 0));
      else assert.ok(Number.isInteger(worst.sourceFace) && worst.sourceFace >= 0);
    }
    assert.equal(g.thickness, .014); assert.equal(g.gap, .004); assert.ok(g.maxThicknessError < 1e-5, JSON.stringify(g));
    assert.ok(g.attachedMinGap >= g.gap - g.tolerance, `${id}/${label}: ${JSON.stringify(g)}`);
    assert.equal(g.attachedViolations, 0, `${id}/${label}: ${JSON.stringify(g)}`);
    assert.equal(g.detachedViolations, 0, `${id}/${label}: ${JSON.stringify(g)}`);
    assert.ok(g.attachedSurfaceSamples > 10000 && g.wallSamples > 1000, 'Measure real faces, edge interiors and volumetric fracture walls');
    assert.equal(g.logicalSweepSamples, g.detachedSweepSamples + g.duplicateSweepSamples + g.zeroLengthSweepSamples, 'Every logical sample is queried, exactly zero length, or an identical shared edge');
    assert.equal(wax.getState().collectionEnabled, false); assert.ok(wax.getState().living <= 24);
    return g;
  }
  function contact(x, y, inner = id === 'donut') {
    let closest = -1, distance = Infinity;
    for (let i = 0; i < rest.length; i += 3) {
      if (normals[i + 2] <= .25 || inner && rest[i] * normals[i] + rest[i + 1] * normals[i + 1] >= -.03) continue;
      const d = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2;
      if (d < distance) { distance = d; closest = i; }
    }
    assert.ok(closest >= 0, 'Use a real outward source vertex in the requested structural region');
    return Array.from(rest.slice(closest, closest + 3));
  }
  const targets = id === 'donut' ? [[.38, 0], [-.38, .12]] : id === 'paw' ? [[0, .17], [-.30, .55]] : id === 'flower' ? [[.55, .05], [-.25, .15]] : id === 'star' ? [[.50, .15], [-.25, -.15]] : [[.15, .1], [-.25, -.15]];
  const [start, end] = targets.map(([x, y]) => contact(x, y));
  const initial = wax.getSurfaceSnapshot();
  try {
    inspect('intact');
    act('begin', start); wax.begin(start); advance(30);
    assert.ok(wax.getState().cracked > 0); assert.equal(wax.getState().detached, 0, 'No fragments at or before 0.5 actual seconds');
    advance(2); assert.ok(wax.getState().detached > 0, 'The same preset fractures after 0.5 seconds'); inspect('initial local fracture');
    // Every original core step is compared at 60Hz. Subsequent geometry checks
    // use 0.1s shell intervals, additionally exercising delayed-render safety.
    advance(118, 6); assert.ok(core.getState().depth > .01, 'The original marshmallow core really deforms under its shell'); inspect('deep structural press');
    const pressed = wax.getSurfaceSnapshot(); let untouched = 0;
    for (let r = 0; r < pressed.layers.length; r++) if (pressed.restSupportPositions[r * 3 + 2] < -.25 && !pressed.damage[r] && pressed.sourceUnmoved[r]) {
      untouched++; for (let k = 0; k < 3; k++) {
        assert.equal(pressed.positions[r * 3 + k], initial.positions[r * 3 + k], 'Unmoved remote skin cannot develop shell displacement');
        assert.equal(pressed.normals[r * 3 + k], initial.normals[r * 3 + k]);
      }
    }
    assert.ok(untouched > 0); record.remoteUnmovedSamples = untouched;
    for (let segment = 1; segment <= 12; segment++) {
      const p = contact(targets[0][0] + (targets[1][0] - targets[0][0]) * segment / 12, targets[0][1] + (targets[1][1] - targets[0][1]) * segment / 12);
      act('move', p, .8 / 12); wax.move(p); advance(1);
    }
    inspect('shallow swept trace and inner/connection traversal');
    act('release'); wax.end(); const released = positions.slice(), damage = wax.getState().detached;
    advance(30, 6); assert.deepEqual(positions, released, 'Release freezes every marshmallow position');
    assert.equal(wax.getState().detached, damage, 'Release cannot propagate additional damage'); inspect('frozen release with gravity');
    for (const [i, point] of [end, start].entries()) {
      act('begin', point); wax.begin(point); advance(120, 6); inspect(`repeated broken-rim press ${i}`);
      act('cancel'); wax.end(); const frozen = positions.slice(), detached = wax.getState().detached;
      advance(12, 6); assert.deepEqual(positions, frozen); assert.equal(wax.getState().detached, detached);
    }
    const detached = wax.getState().detached, cracked = wax.getState().cracked;
    act('beginRestore');
    for (let i = 0; i <= 12; i++) { act('applyRestore', i / 12); advance(1); if (i % 4 === 0) inspect(`growing restored core ${i}/12`); }
    assert.deepEqual(positions, rest, 'Explicit restoration returns exactly to the actual GLB rest surface');
    assert.equal(wax.getState().detached, detached); assert.equal(wax.getState().cracked, cracked, 'Restoring the core cannot regrow wax');
    seconds += 9; wax.step(9); assert.equal(wax.getState().living, 0); assert.equal(wax.getState().expired, detached);
    inspect('expired fragments with persistent holes'); same();
  } finally {
    if (process.env.WAX_CORRECTION_SNAPSHOT_FILE) {
      const fs = require('node:fs'), path = require('node:path'), target = path.resolve(process.env.WAX_CORRECTION_SNAPSHOT_FILE), temporary = path.resolve('.tmp') + path.sep;
      assert.ok(target.startsWith(temporary), 'Raw diagnostic mesh snapshots must stay inside the project .tmp');
      const captured = wax.getCorrectionDiagnosticSnapshot();
      if (captured) fs.writeFileSync(target, JSON.stringify({ ...captured, positions: Array.from(captured.positions), indices: Array.from(captured.indices) }) + '\n');
    }
    t.diagnostic(JSON.stringify(record)); wax.dispose(); geometry.dispose(); coreMaterial.dispose(); sourceMaterial.dispose();
  }
});
