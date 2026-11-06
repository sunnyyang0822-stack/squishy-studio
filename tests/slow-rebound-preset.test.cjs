const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

test('slow-rebound feel and saved preset share the approved defaults, with no orb-only parameter override', async () => {
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { getOrbPreset } = await import('../src/orb-presets.mjs');
  const { slowReboundParameters: p } = await import('../src/orb-slow-rebound.mjs');
  assert.equal(getOrbFeel('slow-rebound').createDeformation, getOrbPreset('slow-rebound').createDeformation);
  assert.ok(Object.isFrozen(p));
  assert.deepEqual([p.radius, p.maximumDepth, p.radialLimit, p.pressSpeed, p.rayDepthRatio, p.concentration, p.bottomSoftness, p.shoulderFraction], [.48, 1.8, .92, 1.05, 1.85, 100, .30, .10]);
  assert.deepEqual([p.dragSpeed, p.dragDepth, p.pressOnsetSeconds, p.recoveryRate, p.reducedRecoveryRate, p.convergence], [1.1, .20, .12, .80, 5, .00001]);
  const source = require('node:fs').readFileSync('src/orb-preview.js', 'utf8');
  assert.ok(!source.includes('depthLimits:'), 'Scenes supply geometry, never a second slow-rebound tuning');
});

for (const id of ['orb', 'cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star']) {
  test(`${id}: unified preset is deeper than explicit old tuning; local footprint and exact recovery`, async t => {
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    const { getOrbPreset } = await import('../src/orb-presets.mjs');
    const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
    const style = getSquishyStyle(id), mesh = readMesh(`.${style.modelUrl}`);
    const rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
    const legacy = { maximumDepth: .46, radialLimit: .50, pressSpeed: .45, rimRadius: .60, concentration: 0, rayDepthRatio: .50 };
    let vertex = 0, score = Infinity;
    const x = id === 'donut' ? .72 : id === 'paw' ? -.24 : 0;
    const y = id === 'paw' ? -.46 : .03;
    for (let i = 0; i < rest.length; i += 3) if (normals[i + 2] > .45) {
      const value = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2;
      if (value < score) { score = value; vertex = i; }
    }
    const point = Array.from(rest.slice(vertex, vertex + 3)), depths = [];
    for (const depthLimits of [legacy, undefined]) {
      const positions = rest.slice();
      const spatial = createSurfaceGeometry(rest, normals, mesh.indices, { ...style.geometryOptions, continuousFootprint: true });
      const d = getOrbPreset('slow-rebound').createDeformation(positions, normals, {
        depthLimits, getPressDirection: () => [0, 0, 1],
        ...(id === 'orb' ? { getPressRadius: (i, ray) => spatial.contactRadius(i, ray), constrainPress: spatial.createContactSafety({ uniform: true, adaptiveChart: true }) } : { surfaceGeometry: spatial }),
      });
      d.begin(point); d.step(1 / 60);
      assert.ok(d.getState().depth > 0 && d.getState().depth < .0013, 'Gentle first-frame onset');
      for (let i = 1; i < 180; i++) d.step(1 / 60);
      const depth = Math.hypot(...point.map((v, k) => positions[vertex + k] - v));
      depths.push(depth);
      assert.ok(positions.every(Number.isFinite));
      if (!depthLimits) {
        const neighborhood = new Set(id === 'orb' ? [] : spatial.neighborhood(point, .48).map(([i]) => i));
        for (let i = 0; i < rest.length; i += 3) {
          const distance = Math.hypot(...point.map((v, k) => rest[i + k] - v));
          if (id === 'orb' ? distance >= .48 : !neighborhood.has(i / 3)) {
            for (let k = 0; k < 3; k++) assert.equal(positions[i + k], rest[i + k]);
          }
        }
      }
      d.release();
      for (let i = 0; i < 960; i++) d.step(1 / 60);
      assert.deepEqual(positions, rest, 'All vertices naturally return, no reset or explicit restore');
      assert.equal(d.step(1 / 60).needsFrame, false);
    }
    t.diagnostic(JSON.stringify({ style: id, oldDepth: depths[0], approvedDepth: depths[1], finalError: 0 }));
    // Paw's thin pad reaches its existing triangle safety bound before the
    // material limit. Require a visible >.05-unit gain there, never remove
    // the safety projection merely to match a thick sphere's travel.
    if (id === 'paw') assert.ok(depths[1] > depths[0] * 1.2 && depths[1] - depths[0] > .05, `${id}: thin-pad gain ${depths}`);
    else assert.ok(depths[1] > depths[0] * 1.4, `${id}: approved depth must exceed old depth by 40%, ${depths}`);
  });
}
