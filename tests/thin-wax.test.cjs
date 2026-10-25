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
  return { THREE, wax, geometry, deformation, baseline, baselinePositions, restPositions: Float32Array.from(data.positions), parameters: thinWaxParameters, advance(seconds) { now += seconds; return wax.step(seconds); }, setTime(value) { now = value; }, begin(point = [0, 0, .9]) { deformation.begin(point); baseline.begin(point); wax.begin(point); } };
}

test('thin wax is a separate closed-volume shell with independently owned color and measured nonzero thickness', async () => {
  const { wax, geometry } = await fixture();
  const shell = wax.group.children[0];
  assert.notEqual(shell.geometry, geometry); assert.equal(shell.material.color.getHexString(), 'ffeeaa');
  const metrics = wax.getMetrics();
  assert.equal(metrics.thickness, .014); assert.equal(metrics.gap, .004);
  assert.ok(metrics.attachedMinGap > .00399); assert.ok(metrics.maxThicknessError < metrics.tolerance);
  assert.equal(metrics.attachedViolations, 0); assert.equal(metrics.drawCalls, 1);
  assert.ok(metrics.shellTriangles > geometry.index.count / 3 * 2, 'Top, bottom and volumetric boundary walls');
  const snapshot = wax.getSurfaceSnapshot(); let outerSamples = 0;
  for (let r = 0; r < snapshot.layers.length; r++) if (snapshot.layers[r] === 1) {
    for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(snapshot.normals[r * 3 + axis] - snapshot.restSupportNormals[r * 3 + axis]) < .000001, 'Smooth outer normals cannot be averaged with perpendicular fracture sidewalls');
    outerSamples++;
  }
  assert.ok(outerSamples > 5000);
  wax.dispose(); geometry.dispose();
});

test('actual continuous dwell exceeds 0.5 seconds; one brittle local wave retains most plates and releases only a few small chips', async () => {
  const f = await fixture(); f.begin();
  f.advance(.499); assert.equal(f.wax.getState().detached, 0);
  f.advance(.001); assert.equal(f.wax.getState().detached, 0);
  f.advance(.001); const initial = f.wax.getState(); assert.ok(initial.detached === 3); assert.equal(initial.firstBurst, initial.detached);
  assert.ok(initial.burstInitialOutwardSpeed <= .2, 'No outward ejection impulse');
  assert.equal(initial.maxDetachedPerContact, 180); assert.ok(initial.localDamaged >= 6); assert.ok(initial.localRetainedFraction >= .6);
  f.advance(.14); const afterImpulse = f.wax.getState();
  assert.ok(afterImpulse.maxOutwardOffset < .04, 'Small clearance plus projected gravity, no outward ejection');
  f.advance(.30); assert.equal(f.wax.getState().detached, initial.detached, 'Held clock alone must not eject another plate');
  assert.ok(f.wax.getState().detached < f.wax.getMetrics().patches / 20, 'Local chips, not whole-shell explosion');
  f.wax.end(); const count = f.wax.getState().detached; settle(f, 5);
  assert.equal(f.wax.getState().detached, count); assert.equal(f.wax.getState().living, 0);
  assert.equal(f.wax.getState().settled, count); assert.equal(f.wax.getState().expired, 0);
  f.wax.dispose();
});

test('released wax chips fall promptly under gravity instead of ejecting sideways', async () => {
  const f = await fixture(); f.wax.begin([0, 0, .9]); f.advance(.501);
  const before = f.wax.getSurfaceSnapshot();
  const panel = before.panelIds[before.detached.findIndex(Boolean)];
  f.wax.end(); f.advance(.4);
  const after = f.wax.getSurfaceSnapshot(); let count = 0, down = 0, sideways = 0;
  for (let r = 0; r < before.layers.length; r++) if (before.panelIds[r] === panel && before.layers[r] === 0) {
    down += before.positions[r * 3 + 1] - after.positions[r * 3 + 1];
    sideways += Math.abs(after.positions[r * 3] - before.positions[r * 3]); count++;
  }
  assert.ok(count > 20);
  assert.ok(down / count > .1, `Prompt downward fall: ${down / count}`);
  assert.ok(sideways / count < .05, `No sideways pop: ${sideways / count}`);
  const metrics = f.wax.getMetrics({ exhaustive: true });
  assert.equal(metrics.detachedViolations, 0); assert.equal(metrics.attachedViolations, 0);
  f.wax.dispose(); f.geometry.dispose();
});

test('actual detached world vertices fall down after toy rotation, then remain fixed on the floor while the toy turns', async t => {
  for (const rotation of [[0, 0, 0], [0, 0, Math.PI / 2], [Math.PI / 2, .55, -.4]]) {
    const f = await fixture(), matrix = new f.THREE.Matrix4().makeRotationFromEuler(new f.THREE.Euler(...rotation));
    f.wax.setWorldMatrix(matrix); f.wax.begin([0, 0, .9]); f.advance(.501); f.wax.end();
    const before = f.wax.getSurfaceSnapshot(), panel = before.panelIds[before.detached.findIndex(Boolean)];
    f.advance(.12); const falling = f.wax.getSurfaceSnapshot();
    let count = 0, downward = 0, lateral = 0; const unique = new Set();
    for (let r = 0; r < before.layers.length; r++) if (before.panelIds[r] === panel && before.layers[r] === 0) {
      const key = before.restSupportPositions.slice(r * 3, r * 3 + 3).join(','); if (unique.has(key)) continue; unique.add(key);
      downward += before.worldPositions[r * 3 + 1] - falling.worldPositions[r * 3 + 1];
      lateral += Math.hypot(falling.worldPositions[r * 3] - before.worldPositions[r * 3], falling.worldPositions[r * 3 + 2] - before.worldPositions[r * 3 + 2]); count++;
    }
    assert.ok(count > 20); assert.ok(downward / count > .02, `Contact-constrained world Y falling under rotation ${rotation}: ${downward / count}`);
    // Rotation toward a flat landing posture can move individual corners;
    // direction is checked with unique actual vertices above. Core collision
    // correction may slow this contact phase; free-flight speed has its own
    // strict kernel test instead of assuming an unimpeded ballistic path here.
    assert.ok(lateral / count < .2);
    t.diagnostic(JSON.stringify({ rotation, uniqueVertices: count, meanWorldYDrop: downward / count, meanCornerLateral: lateral / count }));
    settle(f, 3); const landed = f.wax.getSurfaceSnapshot(), state = f.wax.getState();
    assert.equal(state.living, 0); assert.equal(state.expired, 0); assert.equal(state.settled, state.detached);
    const floor = f.wax.getMetrics().debris;
    assert.ok(floor.minY >= floor.floorY - 1e-5, JSON.stringify(floor)); assert.ok(floor.maxRadius <= floor.radius + .02);
    f.wax.setWorldMatrix(new f.THREE.Matrix4().makeRotationFromEuler(new f.THREE.Euler(-1.1, .8, 1.5))); f.advance(.05);
    const turned = f.wax.getSurfaceSnapshot(); let maximumError = 0, settledSamples = 0;
    for (let r = 0; r < landed.layers.length; r++) if (landed.settled[r]) {
      for (let k = 0; k < 3; k++) maximumError = Math.max(maximumError, Math.abs(landed.worldPositions[r * 3 + k] - turned.worldPositions[r * 3 + k]));
      settledSamples++;
    }
    assert.ok(settledSamples > 100); assert.ok(maximumError < 1e-6, `The floor pile cannot rotate with the toy: ${maximumError}`);
    const amount = f.wax.getState().detached; settle(f, 5); assert.equal(f.wax.getState().detached, amount); assert.equal(f.wax.getState().settled, amount);
    f.wax.reset(); const empty = f.wax.getMetrics().debris;
    assert.equal(f.wax.getState().settled, 0); assert.equal(empty.moving, 0); assert.equal(empty.settled, 0); assert.equal(empty.gridCells, 0);
    f.wax.dispose(); f.geometry.dispose();
  }
});

test('actual clay dent and dragged deformation all receive local crack geometry before any chip can fall', async () => {
  const f = await fixture(); f.begin(); frames(f, 18);
  const target = frontContact(f, .44, .12);
  f.deformation.move(target, .5); f.baseline.move(target, .5); f.wax.move(target); frames(f, 24);
  const snapshot = f.wax.getSurfaceSnapshot(), regions = new Map();
  for (let r = 0; r < snapshot.layers.length; r++) if (snapshot.layers[r] === 1) {
    const id = snapshot.panelIds[r], region = regions.get(id) || { displacement: 0, cracked: false, open: false, slit: 0 };
    region.displacement = Math.max(region.displacement, Math.hypot(...[0, 1, 2].map(k => snapshot.sourceSupportPositions[r * 3 + k] - snapshot.restSupportPositions[r * 3 + k])));
    region.cracked ||= Boolean(snapshot.damage[r]); region.open ||= Boolean(snapshot.openBoundary[r]); regions.set(id, region);
    if (snapshot.openBoundary[r]) {
      const delta = [0, 1, 2].map(k => snapshot.positions[r * 3 + k] - snapshot.sourceSupportPositions[r * 3 + k]);
      const normal = Array.from(snapshot.normals.slice(r * 3, r * 3 + 3)), projected = delta.reduce((sum, value, k) => sum + value * normal[k], 0);
      region.slit = Math.max(region.slit, Math.hypot(...delta.map((value, k) => value - projected * normal[k])));
    }
    if (snapshot.restSupportPositions[r * 3 + 2] < -.4) assert.equal(snapshot.damage[r], 0, 'Untouched back never gets global cracks');
  }
  let deformed = 0;
  for (const [id, region] of regions) if (region.displacement > .00401) {
    assert.ok(region.cracked && region.open, `Deformed panel ${id} (${region.displacement}) must have an actual open boundary`); deformed++;
    assert.ok(region.slit > .00025, `Panel ${id} must visibly separate along an edge, not just carry a damage flag: ${region.slit}`);
  }
  assert.ok(deformed >= 6, `Exercise the dent rim and dragged trail, not just the clicked cell: ${deformed}`);
  assert.equal(f.wax.getState().detached, 0, 'Visible deformation cracks do not bypass the 0.5-second fragment threshold');
  f.wax.end(); const stopped = f.wax.getState().cracked;
  f.deformation.release(); f.baseline.release(); frames(f, 20);
  assert.equal(f.wax.getState().cracked, stopped, 'No damage propagation after release');
  const metrics = f.wax.getMetrics({ exhaustive: true }); assert.equal(metrics.attachedViolations, 0);
  f.wax.dispose(); f.geometry.dispose();
});

test('additional chip reacts 60ms after initial fracture to small real new indentation, never elapsed time alone', async () => {
  const f = await fixture(); f.wax.begin([0, 0, .9]); f.advance(.501);
  assert.equal(f.wax.getState().detached, 3);
  const positions = f.geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) if (positions[i + 2] > .7 && Math.hypot(positions[i], positions[i + 1]) < .3) positions[i + 2] -= .025;
  f.geometry.computeVertexNormals(); f.advance(.058);
  assert.equal(f.wax.getState().detached, 3, 'Keep a small separation between first break and further strain response');
  f.advance(.003); assert.equal(f.wax.getState().detached, 4, 'Small further indentation responds immediately after 0.56s');
  f.advance(1); assert.equal(f.wax.getState().detached, 4, 'No continued stripping from a held timer');
  const metrics = f.wax.getMetrics({ exhaustive: true }); assert.equal(metrics.detachedViolations, 0);
  f.wax.dispose(); f.geometry.dispose();
});

test('short taps, cancellation, hit loss and sliding cannot borrow previous dwell time', async () => {
  const f = await fixture();
  for (let i = 0; i < 8; i++) { f.wax.begin([0, 0, .9]); f.advance(.3); f.wax.cancel(); f.advance(.01); }
  assert.equal(f.wax.getState().detached, 0); assert.ok(f.wax.getState().cracked > 0);
  f.wax.begin([0, 0, .9]); f.advance(.4); f.wax.move([.3, 0, .85]); f.advance(.35);
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
  assert.ok(damaged > 9, 'Real continuing clay pressure extends release into the deformed rim beyond the first nine cells');
  for (let i = 0; i < 120; i++) { f.deformation.step(1 / 60); f.baseline.step(1 / 60); f.geometry.computeVertexNormals(); f.advance(1 / 60); f.wax.sync(); }
  assert.equal(f.wax.getState().detached, damaged);
  assert.deepEqual(f.geometry.attributes.position.array, f.baselinePositions, 'Wax never writes core positions; exact original clay result');
  f.wax.reset(); assert.equal(f.wax.getState().detached, 0); assert.equal(f.wax.getState().cracked, 0);
  f.wax.dispose();
});

test('bounded moving budget, persistent settled chips, reduced motion and idempotent cleanup', async () => {
  const f = await fixture(); f.wax.setReducedMotion(true); f.wax.setGravity([0, -1, 0]); f.wax.begin([0, 0, .9]);
  for (let i = 0; i < 60; i++) f.advance(.5);
  assert.ok(f.wax.getState().detached <= f.parameters.maxFragments);
  assert.ok(f.wax.getState().firstBurst >= 1 && f.wax.getState().firstBurst <= 3);
  f.wax.end(); settle(f, 4); assert.equal(f.wax.getState().living, 0);
  assert.equal(f.wax.getState().settled, f.wax.getState().detached); assert.equal(f.wax.getState().expired, 0);
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
function settle(f, seconds = 4) {
  for (let remaining = seconds; remaining > 1e-9; remaining -= 1 / 30) f.advance(Math.min(remaining, 1 / 30));
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

for (const rotation of [[0, 0, 0], [0, 0, Math.PI / 2], [Math.PI / 2, .55, -.4]]) test(`broken rims remain outside the live clay after world rotation ${rotation}`, async () => {
  const f = await fixture(); f.wax.setWorldMatrix(new f.THREE.Matrix4().makeRotationFromEuler(new f.THREE.Euler(...rotation)));
  const center = frontContact(f, 0, 0), edge = frontContact(f, .18, .04);
  f.begin(center); frames(f, 165);
  assert.ok(f.wax.getState().detached >= 1 && f.wax.getState().detached <= f.parameters.maxLocalFragments); assertExhaustiveClearance(f, 'first deep crater');
  f.wax.end(); f.deformation.release(); f.baseline.release(); frames(f, 6);
  const firstDamage = f.wax.getState().detached;
  // The next press straddles existing broken rims and the sloped crater. Its
  // current geometry/normals differ substantially from the initial sphere.
  f.begin(edge); frames(f, 165); assertExhaustiveClearance(f, 'overlapping broken edge');
  assert.ok(f.wax.getState().detached >= firstDamage); assert.ok(f.wax.getState().attachedCracked >= 3, 'A repeatedly pressed crater retains fractured attached shell');
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

test('live chips stay capped at 24 while continued deep pressure can strip each local cohort', async () => {
  const f = await fixture(), positions = f.geometry.attributes.position.array;
  // A high source placement keeps the whole stress cohort airborne long
  // enough to exercise the moving ceiling rather than relying on a TTL.
  f.wax.setWorldMatrix(new f.THREE.Matrix4().makeTranslation(0, 100, 0));
  for (const contact of [[0, 0, .9], [0, 0, -.9], [.9, 0, 0]]) {
    f.wax.begin(contact); f.advance(.501);
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < positions.length; k++) positions[k] *= .97;
      f.geometry.computeVertexNormals(); f.advance(.061);
      assert.ok(f.wax.getState().living <= 24);
    }
    if (f.wax.getState().detached < 24) assert.equal(f.wax.getState().localDetached, f.wax.getState().localDamaged, 'Continued real indentation can remove every local shard');
    f.wax.end();
  }
  assert.equal(f.wax.getState().living, 24, 'Exercise the actual live-fragment ceiling');
  settle(f, 8); assert.equal(f.wax.getState().living, 0);
  const removed = f.wax.getState().detached;
  f.wax.begin([0, -.9, 0]); f.advance(.501); f.wax.end();
  assert.ok(f.wax.getState().detached > removed, 'Freed live capacity permits new shards without resurrecting old ones');
  assert.equal(f.wax.getState().detached, f.wax.getState().living + f.wax.getState().settled); assert.equal(f.wax.getState().expired, 0);
  f.wax.dispose(); f.geometry.dispose();
});

test('repeated local presses can strip the complete real shell once without duplicate cells or regrowth', async t => {
  const f = await fixture(); f.wax.setWorldMatrix(new f.THREE.Matrix4().makeTranslation(0, .7, 0));
  const initial = f.wax.getSurfaceSnapshot(), centers = new Map();
  for (let r = 0; r < initial.layers.length; r++) if (initial.layers[r] === 1) {
    const id = initial.panelIds[r], value = centers.get(id) || { sum: [0, 0, 0], count: 0 };
    for (let k = 0; k < 3; k++) value.sum[k] += initial.restSupportPositions[r * 3 + k];
    value.count++; centers.set(id, value);
  }
  for (const value of centers.values()) {
    f.wax.begin(value.sum.map(x => x / value.count)); f.advance(.501); f.wax.end();
    const state = f.wax.getState(); assert.ok(state.living <= 24);
    assert.equal(state.detached, state.living + state.settled); assert.equal(state.expired, 0);
  }
  assert.equal(f.wax.getState().detached, centers.size, 'All 180 real patches can be stripped through local interaction');
  settle(f, 4); const removed = f.wax.getState().detached;
  f.wax.begin([0, 0, .9]); settle(f, 2); f.wax.end();
  assert.equal(f.wax.getState().detached, removed); assert.equal(f.wax.getState().living, 0);
  assert.equal(f.wax.getState().expired, 0); assert.equal(f.wax.getState().settled, removed);
  const pile = f.wax.getSurfaceSnapshot(); assert.ok(pile.positions.some(value => value !== 0), 'Stripped shell remains as real mesh pieces in the pile');
  assert.ok(pile.settled.every(Boolean));
  const finalMetrics = f.wax.getMetrics({ exhaustive: true }), debris = finalMetrics.debris;
  assert.equal(debris.moving, 0); assert.equal(debris.settled, centers.size);
  assert.ok(debris.minY >= debris.floorY - 1e-5 && debris.maxRadius <= debris.radius + .02, JSON.stringify(debris));
  assert.equal(finalMetrics.detachedViolations, 0, 'The complete persistent pile must remain outside the core');
  let physicalMaxRadius = 0, physicalSamples = 0, physicalPileTop = -Infinity;
  for (let r = 0; r < pile.settled.length; r++) if (pile.settled[r]) {
    physicalMaxRadius = Math.max(physicalMaxRadius, Math.hypot(pile.worldPositions[r * 3], pile.worldPositions[r * 3 + 2])); physicalSamples++;
    physicalPileTop = Math.max(physicalPileTop, pile.worldPositions[r * 3 + 1]);
  }
  let coreBottom = Infinity;
  for (let i = 1; i < f.restPositions.length; i += 3) coreBottom = Math.min(coreBottom, f.restPositions[i] + .7);
  const pileCoreGap = coreBottom - physicalPileTop;
  t.diagnostic(JSON.stringify({ completeShellPanels: centers.size, debris, physicalMaxRadius, physicalSamples, coreBottom, physicalPileTop, pileCoreGap }));
  assert.ok(physicalPileTop <= debris.pileTop + .002, 'Frozen rendering must contain the final settled pose, not an earlier airborne pose');
  assert.ok(pileCoreGap > .1, `The complete 180-piece pile must leave a visible gap below the elevated core: ${pileCoreGap}`);
  assert.ok(physicalMaxRadius <= debris.radius + 1e-5, `Every actual inner, outer and wall vertex stays inside the tray: ${physicalMaxRadius}`);
  f.wax.reset(); assert.equal(f.wax.getState().detached, 0); assert.equal(f.wax.getState().cracked, 0);
  f.wax.dispose(); f.geometry.dispose();
});

test('one local press leaves remote real render positions, normals and colors exactly unchanged', async () => {
  const f = await fixture(); f.geometry.computeVertexNormals(); f.wax.sync();
  const before = f.wax.getSurfaceSnapshot(); f.begin(frontContact(f, 0, 0)); frames(f, 95);
  const after = f.wax.getSurfaceSnapshot(); let samples = 0;
  for (let r = 0; r < before.damage.length; r++) if (before.restSupportPositions[r * 3 + 2] < -.4) {
    assert.equal(after.damage[r], 0, 'Remote pre-cut boundaries are never exposed');
    for (let axis = 0; axis < 3; axis++) {
      const i = r * 3 + axis;
      assert.equal(after.positions[i], before.positions[i], 'Remote rendered position must remain bit-identical');
      assert.equal(after.normals[i], before.normals[i], 'Remote rendered normal must remain bit-identical');
      assert.equal(after.colors[i], before.colors[i], 'Remote rendered color must remain bit-identical');
    }
    samples++;
  }
  assert.ok(samples > 5000); assert.ok(f.wax.getState().detached > 0);
  f.wax.dispose(); f.geometry.dispose();
});

test('creating a shell over an old bare-core dent retains original contact coordinates', async () => {
  const f = await fixture(), initial = f.wax.getSurfaceSnapshot();
  f.deformation.begin([0, 0, .9]); for (let i = 0; i < 180; i++) f.deformation.step(1 / 60); f.geometry.computeVertexNormals();
  const { createThinWax } = await import('../src/thin-wax.mjs'); let time = 0;
  const wax = createThinWax({ geometry: f.geometry, restPositions: f.restPositions, restNormals: Float32Array.from(readMesh('./assets/models/squishy-orb.glb').normals), clock: () => time });
  assert.deepEqual(wax.getSurfaceSnapshot().restSupportPositions, initial.restSupportPositions);
  wax.begin([0, 0, .9]); assert.ok(wax.getState().cracked > 0); time = 1.01; wax.step(1.01);
  assert.ok(wax.getState().detached >= 1 && wax.getState().detached <= 3, 'Old dent cannot displace the recipe shell contact coordinates');
  assert.equal(wax.getMetrics({ exhaustive: true }).detachedViolations, 0);
  wax.dispose(); f.wax.dispose(); f.geometry.dispose();
});

test('detached curved plates retain frozen edge lengths while the original core continues deforming', async () => {
  const f = await fixture(); f.begin(); frames(f, 70); const before = f.wax.getSurfaceSnapshot();
  frames(f, 50); const after = f.wax.getSurfaceSnapshot();
  const first = new Map(); let checked = 0, maximumError = 0;
  for (let r = 0; r < before.layers.length; r++) if (before.detached[r] && after.detached[r] && before.layers[r] === 1) {
    const id = before.panelIds[r];
    if (!first.has(id)) { first.set(id, r); continue; }
    const start = first.get(id);
    const distance = snapshot => Math.hypot(...[0, 1, 2].map(axis => snapshot.positions[r * 3 + axis] - snapshot.positions[start * 3 + axis]));
    const error = Math.abs(distance(after) - distance(before)); maximumError = Math.max(maximumError, error); checked++;
  }
  assert.ok(checked > 50); assert.ok(maximumError < .000001, `Frozen plate edge-length error ${maximumError}`);
  const metrics = f.wax.getMetrics({ exhaustive: true }); assert.equal(metrics.detachedViolations, 0); assert.ok(metrics.wallSamples > 1000);
  f.wax.dispose(); f.geometry.dispose();
});

test('irregular area distribution, rapid connected cracking and strain-limited saturation replace regular scales and timed emptying', async () => {
  const f = await fixture(), metrics = f.wax.getMetrics();
  assert.ok(metrics.panelAreaCV > .35, `Unequal rendered plate area CV ${metrics.panelAreaCV}`);
  assert.ok(metrics.panelAreaRange[1] / metrics.panelAreaRange[0] > 5);
  f.wax.begin([0, 0, .9]); f.advance(.49); const before = f.wax.getState();
  assert.equal(before.detached, 0); assert.ok(before.cracked < 4);
  f.advance(.02); const wave = f.wax.getState();
  assert.equal(wave.chainWaveCount, 1); assert.ok(wave.cracked - before.cracked >= 5);
  assert.ok(wave.localRetainedFraction >= .6); assert.ok(wave.attachedCracked > wave.detached);
  const detached = wave.detached, cracked = wave.cracked;
  for (let i = 0; i < 10; i++) f.advance(.5);
  assert.equal(f.wax.getState().detached, detached, 'Elapsed time cannot sequentially empty the cracked region');
  assert.equal(f.wax.getState().cracked, cracked); assert.equal(f.wax.getState().chainWaveCount, 1);
  f.wax.end(); f.wax.begin([0, 0, .9]); f.advance(1.1); const repeated = f.wax.getState();
  assert.ok(repeated.detached > wave.detached, 'Repeated valid presses can release more of the already cracked local shell');
  f.wax.dispose(); f.geometry.dispose();
});

test('random Voronoi cutting covers the complete real orb GLB surface with no intact-shell holes', async () => {
  const f = await fixture(), snapshot = f.wax.getSurfaceSnapshot();
  function triangleArea(positions, a, b, c) {
    const x = [0, 1, 2].map(k => positions[b * 3 + k] - positions[a * 3 + k]);
    const y = [0, 1, 2].map(k => positions[c * 3 + k] - positions[a * 3 + k]);
    return Math.hypot(x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]) / 2;
  }
  let originalArea = 0, clippedArea = 0, triangles = 0;
  const coveredByFace = new Float64Array(f.geometry.index.array.length / 3);
  for (let i = 0; i < f.geometry.index.array.length; i += 3) originalArea += triangleArea(f.restPositions, ...f.geometry.index.array.slice(i, i + 3));
  for (let i = 0; i < snapshot.indices.length; i += 3) {
    const [a, b, c] = snapshot.indices.slice(i, i + 3);
    if ([a, b, c].every(r => snapshot.layers[r] === 1)) { const area = triangleArea(snapshot.restSupportPositions, a, b, c); clippedArea += area; coveredByFace[snapshot.sourceFaces[i / 3]] += area; triangles++; }
  }
  const relativeError = Math.abs(clippedArea - originalArea) / originalArea;
  assert.ok(triangles > f.geometry.index.array.length / 3);
  assert.ok(relativeError < .000001, `Clipped ${clippedArea}, original ${originalArea}, relative missing/overlap area ${relativeError}`);
  for (let face = 0; face < coveredByFace.length; face++) {
    const original = triangleArea(f.restPositions, ...f.geometry.index.array.slice(face * 3, face * 3 + 3));
    assert.ok(Math.abs(coveredByFace[face] - original) < .00000001, `Original triangle ${face} incomplete: ${coveredByFace[face]} vs ${original}`);
  }
  f.wax.dispose(); f.geometry.dispose();
});

test('retained shells open connected partial boundary chains while unbroken boundary bridges remain geometrically closed', async () => {
  const f = await fixture(), before = f.wax.getSurfaceSnapshot();
  f.wax.begin([0, 0, .9]); f.advance(1.01); f.advance(.08);
  const after = f.wax.getSurfaceSnapshot(), state = f.wax.getState();
  assert.ok(state.attachedPartialBranches >= 4, `Bound plates need open branches, not complete cell rings: ${JSON.stringify(state)}`);
  let unchangedBridges = 0, openCorners = 0;
  for (let r = 0; r < after.layers.length; r++) if (after.damage[r] && !after.detached[r] && !after.loose[r] && after.layers[r] === 1 && after.boundaryVertex[r]) {
    if (after.openBoundary[r]) { openCorners++; continue; }
    for (let axis = 0; axis < 3; axis++) assert.equal(after.positions[r * 3 + axis], before.positions[r * 3 + axis], 'Unbroken perimeter bridge cannot shrink or lift into a complete scale outline');
    unchangedBridges++;
  }
  assert.ok(unchangedBridges > 20 && openCorners > 20);
  const metrics = f.wax.getMetrics({ exhaustive: true }); assert.equal(metrics.attachedViolations, 0); assert.equal(metrics.detachedViolations, 0);
  f.wax.dispose(); f.geometry.dispose();
});
