const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

test('actual supported clay models: thin wax coverage, connected plates and live-core geometric diagnostics', async t => {
  const THREE = await import('three');
  const { createThinWax } = await import('../src/thin-wax.mjs');
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const { getOrbAppearance, getModelPresentationScale } = await import('../src/orb-appearance.mjs');
  const failures = [];
  for (const id of ((process.env.WAX_STYLE_GEOMETRY_CASE || process.env.WAX_STYLE) ? (process.env.WAX_STYLE_GEOMETRY_CASE || process.env.WAX_STYLE).split(',') : ['orb', 'cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star'])) {
    const style = getSquishyStyle(id), actual = readMesh(`.${style.modelUrl}`), rest = Float32Array.from(actual.positions), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(actual.normals, 3)); geometry.setIndex(actual.indices);
    const scale = getModelPresentationScale(getOrbAppearance('matte'), style.geometryAdapter);
    let now = 0; const wax = createThinWax({ geometry, restPositions: rest, restNormals: Float32Array.from(actual.normals), collectionEnabled: false, clock: () => now });
    wax.setWorldMatrix(new THREE.Matrix4().makeScale(...scale));
    const deform = getOrbFeel('clay').createDeformation(geometry.attributes.position.array, Float32Array.from(actual.normals), style.geometryAdapter === 'surface' ? { surfaceGeometry: createSurfaceGeometry(rest, Float32Array.from(actual.normals), actual.indices, style.geometryOptions) } : {});
    const snapshot = wax.getSurfaceSnapshot(), covered = new Float64Array(actual.indices.length / 3), panels = new Map();
    const area = (p, a, b, c) => new THREE.Vector3().fromArray(p, b * 3).sub(new THREE.Vector3().fromArray(p, a * 3)).cross(new THREE.Vector3().fromArray(p, c * 3).sub(new THREE.Vector3().fromArray(p, a * 3))).length() * .5;
    for (let i = 0; i < snapshot.indices.length; i += 3) {
      const ids = Array.from(snapshot.indices.slice(i, i + 3)); if (!ids.every(v => snapshot.layers[v] === 1)) continue;
      covered[snapshot.sourceFaces[i / 3]] += area(snapshot.restSupportPositions, ...ids);
      const panel = snapshot.panelIds[ids[0]], adjacency = panels.get(panel) || new Map();
      for (const a of ids) { if (!adjacency.has(a)) adjacency.set(a, new Set()); for (const b of ids) adjacency.get(a).add(b); } panels.set(panel, adjacency);
    }
    let maxAreaError = 0, disconnectedPanels = 0;
    for (let i = 0; i < covered.length; i++) maxAreaError = Math.max(maxAreaError, Math.abs(covered[i] - area(rest, ...actual.indices.slice(i * 3, i * 3 + 3))));
    for (const adjacency of panels.values()) { const seen = new Set(), queue = [adjacency.keys().next().value]; while (queue.length) { const v = queue.pop(); if (seen.has(v)) continue; seen.add(v); for (const other of adjacency.get(v)) if (!seen.has(other)) queue.push(other); } if (seen.size !== adjacency.size) disconnectedPanels++; }
    const record = { id, scale, modelBounds: [actual.low, actual.high], panels: panels.size, maxAreaError, disconnectedPanels, phases: [] };
    function check(label) { const m = wax.getMetrics({ exhaustive: true }); record.phases.push({ label, thickness: m.thickness, gap: m.gap, attachedMinGap: m.attachedMinGap, attachedMinSignedDistance: m.attachedMinSignedDistance, worstAttachedSample: m.worstAttachedSample, attachedCorrectionMax: m.attachedCorrectionMax, attachedCorrectionTotalMax: m.attachedCorrectionTotalMax, attachedCorrectedSamples: m.attachedCorrectedSamples, attachedViolations: m.attachedViolations, detachedViolations: m.detachedViolations, detachedMinSignedDistance: m.detachedMinSignedDistance, maxThicknessError: m.maxThicknessError, actualSweepQueries: m.detachedSweepSamples, logicalSweepSamples: m.logicalSweepSamples, duplicateSweepQueries: m.duplicateSweepSamples, attachedSurfaceSamples: m.attachedSurfaceSamples, detachedInteriorSamples: m.detachedInteriorSamples }); }
    check('intact');
    const targets = id === 'donut' ? [[.35, 0], [.55, .12]] : id === 'paw' ? [[0, .30], [-.3, .55]] : [[.15, .1], [-.25, -.15]];
    const contacts = targets.map(([x, y]) => { let best = Infinity, point; for (let i = 0; i < rest.length; i += 3) if (actual.normals[i + 2] > .25) { const d = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2; if (d < best) { best = d; point = Array.from(rest.slice(i, i + 3)); } } return point; });
    for (let contact = 0; contact < contacts.length; contact++) {
      deform.begin(contacts[contact]); wax.begin(contacts[contact]);
      for (let segment = 0; segment < 8; segment++) { for (let frame = 0; frame < 20; frame++) deform.step(1 / 60); geometry.computeVertexNormals(); now += 1 / 3; wax.step(1 / 3); wax.sync(); }
      check(`deep-${contact}`);
      if (contact === 0) {
        const pressed = wax.getSurfaceSnapshot(); let untouchedRemote = 0, unintendedChanges = 0;
        for (let r = 0; r < pressed.layers.length; r++) if (pressed.restSupportPositions[r * 3 + 2] < -.25 && !pressed.damage[r] && pressed.sourceUnmoved[r]) {
          untouchedRemote++; for (let k = 0; k < 3; k++) if (pressed.positions[r * 3 + k] !== snapshot.positions[r * 3 + k] || pressed.normals[r * 3 + k] !== snapshot.normals[r * 3 + k]) unintendedChanges++;
        }
        record.remoteUnmovedSamples = untouchedRemote; record.remoteUnintendedChanges = unintendedChanges;
      }
      deform.move(contacts[1 - contact], .8); wax.move(contacts[1 - contact]); for (let frame = 0; frame < 12; frame++) deform.step(1 / 60); geometry.computeVertexNormals(); now += .2; wax.step(.2); wax.sync(); check(`drag-${contact}`);
      deform.release(); wax.end(); for (let frame = 0; frame < 30; frame++) deform.step(1 / 60); geometry.computeVertexNormals(); now += .5; wax.step(.5); wax.sync(); check(`release-${contact}`);
    }
    deform.beginRestore(); deform.applyRestore(1); deform.step(1 / 60); geometry.computeVertexNormals(); now += .1; wax.step(.1); wax.sync(); check('restore');
    const centers = new Map();
    for (let r = 0; r < snapshot.layers.length; r++) if (snapshot.layers[r] === 1) { const pid = snapshot.panelIds[r], value = centers.get(pid) || { p: new THREE.Vector3(), count: 0 }; value.p.add(new THREE.Vector3().fromArray(snapshot.restSupportPositions, r * 3)); value.count++; centers.set(pid, value); }
    let maxLiving = 0;
    for (const value of centers.values()) { wax.begin(value.p.multiplyScalar(1 / value.count).toArray()); now += .501; wax.step(.501); wax.end(); maxLiving = Math.max(maxLiving, wax.getState().living); }
    record.uniquelyDetached = wax.getState().detached; record.maxLiving = maxLiving;
    now += 9; wax.step(9); record.cleanedBodies = wax.getState().expired;
    t.diagnostic(JSON.stringify(record));
    if (maxAreaError > 1e-8 || disconnectedPanels || panels.size > 180 || record.uniquelyDetached !== panels.size || maxLiving > 24 || record.remoteUnintendedChanges || record.phases.some(p => p.attachedViolations || p.detachedViolations || p.maxThicknessError > 1e-5)) failures.push(id);
    wax.dispose(); geometry.dispose();
  }
  assert.deepEqual(failures, [], `Unsupported geometry diagnostics: ${failures.join(', ')}`);
});
