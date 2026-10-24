const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

async function fixture() {
  const THREE = await import('three');
  const { createThinWax, thinWaxParameters } = await import('../src/thin-wax.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const data = readMesh('./assets/models/squishy-orb.glb'), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3)); geometry.setIndex(data.indices);
  let now = 0;
  const wax = createThinWax({ geometry, color: '#ffeeaa', clock: () => now });
  const deformation = getOrbFeel('clay').createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array);
  const baselinePositions = Float32Array.from(data.positions);
  const baseline = getOrbFeel('clay').createDeformation(baselinePositions, Float32Array.from(data.normals));
  return { wax, geometry, deformation, baseline, baselinePositions, restPositions: Float32Array.from(data.positions), parameters: thinWaxParameters, advance(seconds) { now += seconds; return wax.step(seconds); }, setTime(value) { now = value; }, begin(point = [0, 0, .9]) { deformation.begin(point); baseline.begin(point); wax.begin(point); } };
}

test('thin wax is a separate closed-volume shell with independently owned color and measured nonzero thickness', async () => {
  const { wax, geometry } = await fixture();
  const shell = wax.group.children[0];
  assert.notEqual(shell.geometry, geometry); assert.equal(shell.material.color.getHexString(), 'ffeeaa');
  const metrics = wax.getMetrics();
  assert.equal(metrics.thickness, .008); assert.equal(metrics.gap, .004);
  assert.ok(metrics.attachedMinGap > .00399); assert.ok(metrics.maxThicknessError < metrics.tolerance);
  assert.equal(metrics.attachedViolations, 0); assert.equal(metrics.drawCalls, 1);
  assert.ok(metrics.shellTriangles > geometry.index.count / 3 * 2, 'Top, bottom and volumetric boundary walls');
  for (let k = 0; k < 3; k++) {
    const outer = shell.geometry.index.array[k], original = geometry.index.array[k];
    for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(shell.geometry.attributes.normal.array[outer * 3 + axis] - geometry.attributes.normal.array[original * 3 + axis]) < .000001, 'Smooth outer normals cannot be averaged with perpendicular fracture sidewalls');
  }
  wax.dispose(); geometry.dispose();
});

test('actual continuous dwell exceeds one second; first local burst is three chips with a decaying outward impulse', async () => {
  const f = await fixture(); f.begin();
  f.advance(.999); assert.equal(f.wax.getState().detached, 0);
  f.advance(.001); assert.equal(f.wax.getState().detached, 0);
  f.advance(.001); const initial = f.wax.getState(); assert.equal(initial.detached, 3); assert.equal(initial.firstBurst, 3);
  assert.equal(initial.burstInitialOutwardSpeed, 2);
  f.advance(.14); const afterImpulse = f.wax.getState();
  assert.ok(afterImpulse.maxOutwardOffset > initial.maxOutwardOffset + .1, 'Visible outward burst during first 140ms');
  f.advance(.30); assert.equal(f.wax.getState().detached, 4);
  assert.ok(f.wax.getState().detached < f.wax.getMetrics().patches / 50, 'Local chips, not whole-shell explosion');
  f.wax.end(); const count = f.wax.getState().detached; f.advance(5);
  assert.equal(f.wax.getState().detached, count); assert.equal(f.wax.getState().living, 0);
  f.wax.dispose();
});

test('short taps, cancellation, hit loss and sliding cannot borrow previous dwell time', async () => {
  const f = await fixture();
  for (let i = 0; i < 8; i++) { f.wax.begin([0, 0, .9]); f.advance(.3); f.wax.cancel(); f.advance(.01); }
  assert.equal(f.wax.getState().detached, 0); assert.ok(f.wax.getState().cracked > 0);
  f.wax.begin([0, 0, .9]); f.advance(.8); f.wax.move([.3, 0, .85]); f.advance(.4);
  assert.equal(f.wax.getState().detached, 0);
  f.wax.move(null); f.advance(3); assert.equal(f.wax.getState().detached, 0);
  assert.equal(f.wax.getState().active, false); f.wax.dispose();
});

test('deep clay press and recovery keep original core behavior and measured shell clearance', async () => {
  const f = await fixture(); f.begin(); let samples = 0;
  for (let i = 0; i < 180; i++) {
    f.deformation.step(1 / 60); f.baseline.step(1 / 60);
    f.geometry.computeVertexNormals(); f.advance(1 / 60); f.wax.sync();
    if (i % 30 === 0) {
      const metrics = f.wax.getMetrics();
      assert.equal(metrics.attachedViolations, 0); assert.equal(metrics.detachedViolations, 0, JSON.stringify(metrics));
      assert.ok(metrics.attachedMinGap >= .00399); assert.ok(metrics.maxThicknessError < .00001);
      samples += metrics.detachedSamples;
    }
  }
  assert.ok(samples > 0, 'Nearest current triangle signed distance actually sampled detached geometry');
  const exhaustive = f.wax.getMetrics({ exhaustive: true });
  assert.equal(exhaustive.attachedViolations, 0); assert.equal(exhaustive.detachedViolations, 0);
  assert.ok(exhaustive.attachedSurfaceSamples > 10000, 'Scan actual rendered face and edge centers, not just support vertices');
  assert.ok(exhaustive.attachedMinSignedDistance > .0035);
  assert.ok(exhaustive.detachedInteriorSamples > 0);
  f.wax.end(); f.deformation.release(); f.baseline.release();
  const damaged = f.wax.getState().detached;
  for (let i = 0; i < 120; i++) { f.deformation.step(1 / 60); f.baseline.step(1 / 60); f.geometry.computeVertexNormals(); f.advance(1 / 60); f.wax.sync(); }
  assert.equal(f.wax.getState().detached, damaged);
  assert.deepEqual(f.geometry.attributes.position.array, f.baselinePositions, 'Wax never writes core positions; exact original clay result');
  f.wax.reset(); assert.equal(f.wax.getState().detached, 0); assert.equal(f.wax.getState().cracked, 0);
  f.wax.dispose();
});

test('bounded lifetime, unique chips, reduced motion and idempotent cleanup', async () => {
  const f = await fixture(); f.wax.setReducedMotion(true); f.wax.setGravity([0, -1, 0]); f.wax.begin([0, 0, .9]);
  for (let i = 0; i < 60; i++) f.advance(.5);
  assert.ok(f.wax.getState().detached <= f.parameters.maxFragments);
  assert.equal(f.wax.getState().firstBurst, 3);
  f.wax.end(); f.advance(4); assert.equal(f.wax.getState().living, 0);
  let geometries = 0, materials = 0;
  f.wax.group.children[0].geometry.addEventListener('dispose', () => geometries++);
  f.wax.group.children[0].material.addEventListener('dispose', () => materials++);
  f.wax.dispose(); f.wax.dispose(); assert.equal(geometries, 1); assert.equal(materials, 1);
  assert.deepEqual(f.wax.step(1), { changed: false, needsFrame: false });
});

function frontContact(f, x, y) {
  let best = Infinity, point;
  for (let i = 0; i < f.restPositions.length; i += 3) if (f.restPositions[i + 2] > 0) {
    const distance = (f.restPositions[i] - x) ** 2 + (f.restPositions[i + 1] - y) ** 2;
    if (distance < best) { best = distance; point = Array.from(f.restPositions.slice(i, i + 3)); }
  }
  return point;
}
function frames(f, count) {
  for (let i = 0; i < count; i++) {
    f.deformation.step(1 / 60); f.baseline.step(1 / 60);
    f.geometry.computeVertexNormals(); f.advance(1 / 60); f.wax.sync();
  }
}
function assertExhaustiveClearance(f, context) {
  const m = f.wax.getMetrics({ exhaustive: true });
  assert.equal(m.attachedViolations, 0, `${context}: ${JSON.stringify(m)}`);
  assert.equal(m.detachedViolations, 0, `${context}: ${JSON.stringify(m)}`);
  assert.ok(m.attachedMinGap > .00399 && m.attachedMinGap < .00401, `${context}: actual normal gap ${m.attachedMinGap}`);
  assert.ok(m.attachedMinSignedDistance > .002, `${context}: rendered triangle center/edge clearance ${m.attachedMinSignedDistance}`);
  assert.ok(m.maxThicknessError < m.tolerance, `${context}: thickness ${m.maxThicknessError}`);
  assert.ok(m.attachedSurfaceSamples > 10000, `${context}: complete face and edge sampling`);
  if (f.wax.getState().living) assert.ok(m.detachedInteriorSamples > 0 && m.detachedMinSignedDistance >= -m.tolerance);
  return m;
}

for (const gravity of [[0, -1, 0], [1, 0, 0], [0, 0, 1]]) test(`broken rim repeated deep pressure and fast crossing strokes remain outside the live clay surface under local gravity ${gravity}`, async () => {
  const f = await fixture(); f.wax.setGravity(gravity);
  const center = frontContact(f, 0, 0), edge = frontContact(f, .18, .04);
  f.begin(center); frames(f, 165);
  assert.ok(f.wax.getState().detached >= 3); assertExhaustiveClearance(f, 'first deep crater');
  f.wax.end(); f.deformation.release(); f.baseline.release(); frames(f, 6);
  const firstDamage = f.wax.getState().detached;
  // The next press straddles existing broken rims and the sloped crater. Its
  // current geometry/normals differ substantially from the initial sphere.
  f.begin(edge); frames(f, 165); assertExhaustiveClearance(f, 'overlapping broken edge');
  assert.ok(f.wax.getState().detached > firstDamage);
  const points = [[-.45, .2], [.45, -.2], [-.3, -.25], [.3, .25], [0, 0]].map(([x, y]) => frontContact(f, x, y));
  for (const p of points) { f.deformation.move(p, .6); f.baseline.move(p, .6); f.wax.move(p); frames(f, 3); }
  assertExhaustiveClearance(f, 'rapid diagonal crossings through old crater');
  f.deformation.move(edge, .7); f.baseline.move(edge, .7); f.wax.move(edge); frames(f, 165);
  assertExhaustiveClearance(f, 'third deep pressure after crossings');
  f.wax.end(); f.deformation.release(); f.baseline.release(); const damaged = f.wax.getState().detached; frames(f, 60);
  assert.equal(f.wax.getState().detached, damaged); assertExhaustiveClearance(f, 'released changing normals');
  assert.deepEqual(f.geometry.attributes.position.array, f.baselinePositions);
  f.wax.dispose(); f.geometry.dispose();
});

test('the actual 24-chip budget is reached across fresh locations and cannot be reused after expiry or repeated pressure', async () => {
  const f = await fixture();
  let previous = 0;
  for (let i = 0; i < 60 && f.wax.getState().detached < f.parameters.maxFragments; i++) {
    const y = 1 - 2 * (i % 30 + .5) / 30, angle = i * 2.399963229728653;
    const p = [Math.sqrt(1 - y * y) * Math.cos(angle) * .9, y * .9, Math.sqrt(1 - y * y) * Math.sin(angle) * .9];
    f.wax.begin(p); f.advance(1.01); f.wax.end();
    const state = f.wax.getState();
    assert.ok(state.detached >= previous && state.detached <= 24);
    assert.equal(state.detached, state.living + state.expired, 'Each counted chip has one unique living or expired patch');
    previous = state.detached;
  }
  assert.equal(f.wax.getState().detached, 24, 'Test exercises the ceiling, not merely an unfulfilled upper bound');
  f.advance(4); assert.equal(f.wax.getState().expired, 24); assert.equal(f.wax.getState().living, 0);
  for (const p of [[0, 0, .9], [.9, 0, 0], [0, 0, -.9]]) { f.wax.begin(p); f.advance(3); f.wax.end(); }
  assert.equal(f.wax.getState().detached, 24); assert.equal(f.wax.getState().expired, 24);
  assert.equal(f.wax.getState().living, 0, 'Expiry cannot resurrect or duplicate a detached patch');
  f.wax.reset(); assert.equal(f.wax.getState().detached, 0); assert.equal(f.wax.getState().expired, 0);
  f.wax.dispose(); f.geometry.dispose();
});
