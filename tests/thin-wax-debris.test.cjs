const { test } = require('node:test');
const assert = require('node:assert/strict');
async function fixture(options = {}) {
  const THREE = await import('three');
  const { createWaxDebris } = await import('../src/thin-wax-debris.mjs');
  const thickness = .014, debris = createWaxDebris({ thickness, ...options });
  let time = 0;
  const triangles = [[0, 1, 2], [0, 2, 3]];
  function add(id, matrix = new THREE.Matrix4(), center = [0, .2, .7]) {
    const vertices = [[-.13, -.11, 0], [.11, -.10, 0], [.14, .10, 0], [-.10, .13, 0]].map(v => new THREE.Vector3(...v).applyMatrix4(matrix).add(new THREE.Vector3(...center)));
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    return debris.add(id, vertices, vertices.map(() => new THREE.Vector3(0, 0, 1).applyMatrix3(normalMatrix).normalize()), triangles, time);
  }
  function advance(seconds) { for (let left = seconds; left > 1e-9; left -= 1 / 120) { const dt = Math.min(left, 1 / 120); time += dt; debris.advance(dt, time); } }
  const snapshot = body => debris.points(body).map(p => p.toArray());
  return { THREE, debris, thickness, add, advance, snapshot, get time() { return time; } };
}
test('released bodies fall faster in world Y for three differently rotated source surfaces', async () => {
  const f = await fixture();
  for (const [id, rotation] of [[0, [0, 0, 0]], [1, [0, 0, Math.PI / 2]], [2, [Math.PI / 2, .7, -.4]]]) {
    const matrix = new f.THREE.Matrix4().makeRotationFromEuler(new f.THREE.Euler(...rotation));
    const body = f.add(id, matrix), before = body.position.clone();
    f.advance(.16);
    assert.ok(body.position.y < before.y - .14, `Rotation ${rotation}: actual world Y ${before.y} -> ${body.position.y}`);
    assert.ok(Math.hypot(body.position.x - before.x, body.position.z - before.z) < .015, 'No rotation-dependent sideways ejection');
    assert.ok(f.snapshot(body).flat().every(Number.isFinite));
  }
});

test('a slanted curved chip contacting a high pile keeps its complete physical footprint inside the tray', async t => {
  const f = await fixture(), { Vector3 } = f.THREE;
  const triangles = Array.from({ length: 16 }, (_, i) => [0, i + 1, (i + 1) % 16 + 1]);
  for (let id = 0; id < 4; id++) {
    const vertices = [new Vector3(0, .4, 0), ...Array.from({ length: 16 }, (_, i) => new Vector3(1.16 * Math.cos(i * Math.PI / 8), .4, 1.16 * Math.sin(i * Math.PI / 8)))];
    const base = f.debris.add(100 + id, vertices, vertices.map(() => new Vector3(0, 1, 0)), triangles, f.time);
    f.advance(2); assert.ok(base.settled);
  }
  const vertices = [[-.28, -.08, -.19], [.27, .06, -.19], [.28, .09, .20], [-.27, -.05, .20], [0, .16, 0]].map(v => new Vector3(...v).add(new Vector3(1.3, .4, 0)));
  const body = f.debris.add(200, vertices, vertices.map(() => new Vector3(-.2, 1, 0).normalize()), [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]], f.time);
  const physical = () => f.debris.points(body).flatMap((p, i) => [p, p.clone().addScaledVector(body.normals[i].clone().applyQuaternion(body.rotation), f.thickness)]);
  assert.ok(Math.max(...physical().map(p => Math.hypot(p.x, p.z))) > 1.5, 'The incoming curved footprint starts outside the tray');
  for (let i = 0; i < 480 && body.contactTime === null; i++) f.advance(1 / 240);
  assert.notEqual(body.contactTime, null);
  const contactTop = Math.max(...physical().map(p => p.y)), contactRadius = Math.max(...physical().map(p => Math.hypot(p.x, p.z)));
  assert.ok(contactTop >= -1.015, `Exercise contact above the old low-height confinement gate: ${contactTop}`);
  assert.ok(contactRadius <= 1.35 + 1e-5, `Whole inner/outer curved footprint must be collected at high contact: ${contactRadius}`);
  f.advance(3); assert.ok(body.settled);
  const settledRadius = Math.max(...physical().map(p => Math.hypot(p.x, p.z)));
  assert.ok(settledRadius <= 1.35 + 1e-5);
  t.diagnostic(JSON.stringify({ contactTop, contactRadius, settledRadius, debris: f.debris.state() }));
});
test('floor contact preserves real bodies past the former lifetime and settled vertices remain exact', async () => {
  const f = await fixture(), body = f.add(1);
  f.advance(2);
  assert.equal(body.settled, true); assert.equal(f.debris.state().settled, 1); assert.equal(f.debris.state().moving, 0);
  const points = f.snapshot(body), state = f.debris.state();
  assert.ok(state.minY >= state.floorY - 1e-6 && state.minY < state.floorY + .01, JSON.stringify(state));
  assert.ok(state.maxRadius <= state.radius + .01);
  f.advance(30);
  assert.deepEqual(f.snapshot(body), points, 'A settled shard neither expires nor changes its real mesh');
  assert.equal(f.debris.get(1), body);
  assert.equal(f.add(1), body, 'Duplicate IDs cannot create a second shard or respawn the first');
  assert.equal(f.debris.state().settled, 1);
});
test('a body created at the end of a coarse frame cannot integrate motion before its birth', async () => {
  const f = await fixture(); f.advance(1);
  const body = f.add(7), before = body.position.clone();
  f.debris.advance(.5, 1);
  assert.ok(body.position.distanceTo(before) < .001, `A just-born body was advanced through the preceding half second: ${body.position.distanceTo(before)}`);
  f.advance(.1); assert.ok(body.position.y < before.y - .07, 'The same shard starts falling promptly during its actual first 100ms');
});
test('successive real polygon bodies accumulate above earlier surfaces and reset clears the support field', async () => {
  const f = await fixture({ radius: .42 }), bodies = [], amount = 12;
  for (let id = 0; id < amount; id++) { const body = f.add(id, undefined, [0, .2, 0]); f.advance(1.4); assert.ok(body.settled, `Body ${id} must finish landing`); bodies.push(body); }
  const state = f.debris.state(); assert.equal(state.settled, amount); assert.equal(state.moving, 0); assert.ok(state.gridCells > 4);
  assert.ok(state.minY >= state.floorY - 1e-6); assert.ok(state.pileTop > state.floorY + f.thickness * 3, 'Actual mesh pieces form multiple layers');
  // Sample the actual curved-body projection against each older triangle,
  // independently of the support grid used by the implementation.
  function projectedHeight(point, a, b, c) {
    const determinant = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(determinant) < 1e-9) return null;
    const u = ((b.z - c.z) * (point.x - c.x) + (c.x - b.x) * (point.z - c.z)) / determinant;
    const v = ((c.z - a.z) * (point.x - c.x) + (a.x - c.x) * (point.z - c.z)) / determinant;
    return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7 ? u * a.y + v * b.y + (1 - u - v) * c.y : null;
  }
  let overlapSamples = 0;
  for (let newer = 1; newer < bodies.length; newer++) for (let older = 0; older < newer; older++) {
    const oldBody = bodies[older], below = f.debris.points(oldBody).map((point, i) => point.clone().addScaledVector(oldBody.normals[i].clone().applyQuaternion(oldBody.rotation), f.thickness));
    for (const point of f.debris.points(bodies[newer])) for (const triangle of bodies[older].triangles) {
      const y = projectedHeight(point, ...triangle.map(i => below[i]));
      if (y === null) continue;
      overlapSamples++;
      assert.ok(point.y >= y - 1e-6, `New inner face must clear the older actual outer face: ${point.y - y}`);
    }
  }
  assert.ok(overlapSamples > 8, `Exercise overlapping projected meshes: ${overlapSamples}`);
  const saved = bodies.map(f.snapshot); f.advance(10); assert.deepEqual(bodies.map(f.snapshot), saved);
  f.debris.reset(); assert.deepEqual(f.debris.state(), { floorY: -1.35, radius: .42, moving: 0, settled: 0, minY: null, maxRadius: 0, pileTop: -1.35, gridCells: 0 });
  assert.equal(f.debris.get(0), undefined);
  const fresh = f.add(0, undefined, [.06, .2, 0]); f.advance(2);
  assert.ok(fresh.settled); assert.equal(f.debris.state().settled, 1);
  assert.ok(f.debris.state().pileTop < state.pileTop - f.thickness, 'Reset invalidates cached tall-pile support before an ID is reused');
});
