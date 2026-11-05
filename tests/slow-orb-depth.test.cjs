const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');
function advance(d, seconds) { for (let i = 0; i < Math.round(seconds * 60); i++) d.step(1 / 60); }

test('贴边深度缩放仅影响当前接触；移回中央连续接管，松手全网格恢复', async t => {
  const { createSlowReboundDeformation, slowReboundOrbDepthLimits } = await import('../src/orb-slow-rebound.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = readMesh('assets/models/squishy-orb.glb'), rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  const p = rest.slice(), geometry = createSurfaceGeometry(rest, normals, mesh.indices);
  let scale = .78;
  const d = createSlowReboundDeformation(p, normals, { depthLimits: slowReboundOrbDepthLimits,
    getPressDirection: () => [0, 0, 1], getPressDepthScale: () => scale,
    constrainPress: geometry.createContactSafety({ uniform: true, adaptiveChart: true }), getPressRadius: (i, direction) => geometry.contactRadius(i, direction) });
  const hit = [0, 0, 1];
  d.begin(hit); advance(d, 3); const edgeDepth = d.getState().depth;
  assert.ok(edgeDepth > 1.35 && edgeDepth < 1.41);
  scale = 1; const snapshot = p.slice(); d.move(hit); assert.deepEqual(p, snapshot);
  advance(d, 2); const centerDepth = d.getState().depth;
  assert.ok(centerDepth > 1.79 && centerDepth < 1.800001);
  d.release(); advance(d, 16); assert.deepEqual(p, rest); assert.equal(d.step(1 / 60).needsFrame, false);
  scale = .78; d.begin(hit); advance(d, 1); d.reset(); d.step(1 / 60); assert.deepEqual(p, rest);
  t.diagnostic(JSON.stringify({ edgeDepth, centerDepth, finalError: 0 }));
});

test('最新正圆球深坑底部是圆缓盆底，消除尖锥收口且不扩大外侧范围', async t => {
  const { createSlowReboundDeformation, slowReboundOrbDepthLimits } = await import('../src/orb-slow-rebound.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = readMesh('assets/models/squishy-orb.glb'), rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  let contact = 0;
  for (let i = 0; i < rest.length; i += 3) if (rest[i + 2] > rest[contact + 2]) contact = i;
  const hit = Array.from(rest.slice(contact, contact + 3)), samples = [];
  let previousPositions;
  const transitionRadius = slowReboundOrbDepthLimits.rimRadius * Math.sqrt(slowReboundOrbDepthLimits.bottomSoftness);
  for (const bottomSoftness of [.15, slowReboundOrbDepthLimits.bottomSoftness]) {
    const p = rest.slice(), geometry = createSurfaceGeometry(rest, normals, mesh.indices);
    const d = createSlowReboundDeformation(p, normals, { depthLimits: { ...slowReboundOrbDepthLimits, bottomSoftness },
      getPressDirection: () => [0, 0, 1], constrainPress: geometry.createContactSafety({ uniform: true, adaptiveChart: true }),
      getPressRadius: (i, direction) => geometry.contactRadius(i, direction) });
    d.begin(hit); advance(d, 3);
    const centerDepth = rest[contact + 2] - p[contact + 2];
    const bottom = [], junction = []; let footprint = 0;
    for (let i = 0; i < rest.length; i += 3) {
      const distance = Math.hypot(...[0, 1, 2].map(k => rest[i + k] - hit[k]));
      const depth = rest[i + 2] - p[i + 2];
      if (distance >= .035 && distance <= .12) bottom.push(depth / centerDepth);
      if (distance >= .10 && distance <= .20) junction.push(depth / centerDepth);
      if (depth > .00001) footprint = Math.max(footprint, distance);
      if (distance >= .48) assert.ok([0, 1, 2].every(k => p[i + k] === rest[i + k]), 'Outer skin is exactly unchanged');
      if (previousPositions && distance >= transitionRadius) assert.ok([0, 1, 2].every(k => Math.abs(p[i + k] - previousPositions[i + k]) < 1e-6), 'Outer wall is identical to the preceding review');
    }
    assert.ok(bottom.length >= 5);
    assert.ok(junction.length >= 5);
    samples.push({ bottomSoftness, centerDepth, averageFloorDepthRatio: bottom.reduce((a, b) => a + b, 0) / bottom.length, averageJunctionDepthRatio: junction.reduce((a, b) => a + b, 0) / junction.length, footprint });
    previousPositions = p.slice();
    d.release(); advance(d, 16); assert.deepEqual(p, rest);
  }
  assert.ok(samples[1].averageFloorDepthRatio >= samples[0].averageFloorDepthRatio, 'The inner floor never becomes more pointed');
  assert.ok(samples[1].averageJunctionDepthRatio > samples[0].averageJunctionDepthRatio + .10, 'The floor/wall junction rounds out instead of continuing a conical taper');
  assert.ok(Math.abs(samples[1].centerDepth - samples[0].centerDepth) < 1e-6);
  assert.ok(samples[1].footprint <= .48 && Math.abs(samples[1].footprint - samples[0].footprint) < 1e-6);
  t.diagnostic(JSON.stringify(samples));
});

test('仅慢回弹圆球减小按入阻力，轻柔起步且1–2秒明显深压；恢复速率保持', async t => {
  const { createSlowReboundDeformation, slowReboundParameters, slowReboundOrbDepthLimits } = await import('../src/orb-slow-rebound.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = readMesh('assets/models/squishy-orb.glb');
  const rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  let contact = 0, best = Infinity;
  for (let i = 0; i < rest.length; i += 3) {
    const score = rest[i] ** 2 + (rest[i + 1] - .0175) ** 2 + (rest[i + 2] - 1) ** 2;
    if (score < best) { best = score; contact = i; }
  }
  const hit = Array.from(rest.slice(contact, contact + 3)), results = [];
  const depth = p => Math.hypot(...[0, 1, 2].map(k => p[contact + k] - rest[contact + k]));
  for (const depthLimits of [undefined, slowReboundOrbDepthLimits]) {
    const positions = rest.slice(), geometry = createSurfaceGeometry(rest, normals, mesh.indices);
    const d = createSlowReboundDeformation(positions, normals, { depthLimits,
      getPressDirection: () => [0, 0, 1], constrainPress: geometry.createContactSafety({ uniform: Boolean(depthLimits), adaptiveChart: Boolean(depthLimits) }),
      getPressRadius: (i, direction) => geometry.contactRadius(i, direction) });
    d.begin(hit); d.step(1 / 60); const first = depth(positions);
    advance(d, .3 - 1 / 60); const early = depth(positions);
    advance(d, .7); const at1s = depth(positions);
    advance(d, 1); const at2s = depth(positions);
    advance(d, 1); const long = depth(positions);
    assert.ok(positions.every(Number.isFinite));
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices.slice(i, i + 3);
      const cross = p => {
        const u = [0, 1, 2].map(k => p[b * 3 + k] - p[a * 3 + k]);
        const v = [0, 1, 2].map(k => p[c * 3 + k] - p[a * 3 + k]);
        return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      };
      const before = cross(rest), after = cross(positions);
      // At this depth a smooth wall can turn beyond 90° from the rest normal.
      // Parallel ray motion must instead preserve its signed ray projection;
      // with positive area this rules out a fold in that surface chart.
      assert.ok(Math.abs(after[2] - before[2]) < 2e-7, 'Every triangle keeps its signed press-ray projection');
      assert.ok(Math.hypot(...after) / Math.hypot(...before) >= .07999, 'Every real triangle retains its area safety margin');
    }
    const pressed = positions.slice(); d.release(); assert.deepEqual(positions, pressed);
    advance(d, .5); assert.ok(Math.abs(depth(positions) / long - Math.exp(-.8 * .5)) < .000002);
    advance(d, 16); assert.deepEqual(positions, rest);
    assert.deepEqual(d.step(1 / 60), { changed: false, atRest: true, needsFrame: false });
    d.begin(hit); advance(d, 2); d.reset(); d.step(1 / 60); assert.deepEqual(positions, rest);
    results.push({ first, early, at1s, at2s, long });
  }
  assert.ok(Object.isFrozen(slowReboundOrbDepthLimits));
  assert.equal(slowReboundParameters.maximumDepth, .46);
  assert.equal(slowReboundParameters.radialLimit, .5);
  assert.equal(slowReboundParameters.dragDepth, .20);
  assert.ok(results[1].long > 1.20 && results[1].long > .85 * 1.4, 'Actual depth grows at least 40% beyond the previous .85 review');
  assert.ok(results[1].first > 0 && results[1].first < .0015, 'No instant collapse on first frame');
  assert.ok(results[1].early > .23 && results[1].early < .27, '300ms shows easier progressive inward travel');
  assert.ok(results[1].at1s > .90 && results[1].at2s > 1.40, 'Deep contact is reached in 1–2 seconds');
  t.diagnostic(JSON.stringify({ original: results[0], review: results[1] }));
});

test('深压集中在原局部范围，恢复扩大前的宽度，中心深度和连续推进保留', async t => {
  const { createSlowReboundDeformation, slowReboundOrbDepthLimits } = await import('../src/orb-slow-rebound.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = readMesh('assets/models/squishy-orb.glb');
  const rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  let contact = 0;
  for (let i = 0; i < rest.length; i += 3) if (rest[i + 2] > rest[contact + 2]) contact = i;
  const results = [];
  for (const rimRadius of [.60, slowReboundOrbDepthLimits.rimRadius]) {
    const positions = rest.slice(), geometry = createSurfaceGeometry(rest, normals, mesh.indices);
    const d = createSlowReboundDeformation(positions, normals, {
      depthLimits: { ...slowReboundOrbDepthLimits, rimRadius }, getPressDirection: () => [0, 0, 1],
      constrainPress: geometry.createContactSafety({ uniform: true, adaptiveChart: true }), getPressRadius: (i, direction) => geometry.contactRadius(i, direction),
    });
    d.begin(Array.from(rest.slice(contact, contact + 3)));
    for (let frame = 0; frame < 300; frame++) {
      const previous = positions.slice(); d.step(1 / 60);
      assert.ok(positions.every((v, i) => Math.abs(v - previous[i]) <= slowReboundOrbDepthLimits.pressSpeed / 60 + 1e-6), 'Each vertex advances continuously within the configured inward speed');
    }
    let affectedVertices = 0, footprintExtent = 0;
    for (let i = 0; i < rest.length; i += 3) {
      const displacement = Math.hypot(...[0, 1, 2].map(k => positions[i + k] - rest[i + k]));
      const distance = Math.hypot(...[0, 1, 2].map(k => rest[i + k] - rest[contact + k]));
      if (displacement > .00001) { affectedVertices++; footprintExtent = Math.max(footprintExtent, distance); }
      if (distance >= rimRadius) assert.ok([0, 1, 2].every(k => positions[i + k] === rest[i + k]), 'Surface outside the local contact is exactly unchanged');
    }
    results.push({ rimRadius, affectedVertices, footprintExtent, depth: rest[contact + 2] - positions[contact + 2] });
    d.release(); advance(d, 16); assert.deepEqual(positions, rest);
  }
  assert.ok(results[1].affectedVertices < results[0].affectedVertices * .75, 'A substantially smaller actual footprint emphasizes depth');
  assert.ok(results[1].footprintExtent < .48);
  t.diagnostic(JSON.stringify(results));
  assert.ok(results[1].depth > 1.20, 'Concentrated press retains the substantially deeper center');
});

test('真实倾斜视线的深坑保持面积安全裕量、射线投影及背壁厚度，恢复路径全程安全', async t => {
  const { createSlowReboundDeformation, slowReboundOrbDepthLimits } = await import('../src/orb-slow-rebound.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = readMesh('assets/models/squishy-orb.glb'), rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  const positions = rest.slice(), geometry = createSurfaceGeometry(rest, normals, mesh.indices);
  const direction = [0, .30822551353379146, .9513133199986379];
  const d = createSlowReboundDeformation(positions, normals, { depthLimits: slowReboundOrbDepthLimits,
    getPressDirection: () => direction, constrainPress: geometry.createContactSafety({ uniform: true, adaptiveChart: true }),
    getPressRadius: (i, ray) => geometry.contactRadius(i, ray) });
  const cross = (p, a, b, c) => {
    const u = [0, 1, 2].map(k => p[b * 3 + k] - p[a * 3 + k]), v = [0, 1, 2].map(k => p[c * 3 + k] - p[a * 3 + k]);
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };
  const faces = Array.from({ length: mesh.indices.length / 3 }, (_, i) => cross(rest, ...mesh.indices.slice(i * 3, i * 3 + 3)));
  let minimumAreaRatio = Infinity, maximumDepth = 0;
  const check = () => {
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const before = faces[i / 3], after = cross(positions, ...mesh.indices.slice(i, i + 3));
      minimumAreaRatio = Math.min(minimumAreaRatio, Math.hypot(...after) / Math.hypot(...before));
      assert.ok(Math.hypot(...after) / Math.hypot(...before) >= .07999, 'All actual triangle areas keep at least the original 8% margin');
      assert.ok(Math.abs(after.reduce((sum, v, k) => sum + v * direction[k], 0) - before.reduce((sum, v, k) => sum + v * direction[k], 0)) < 2e-7, 'The original signed ray projection remains unchanged: no fold in the press direction');
    }
  };
  const wallLimits = Array.from({ length: rest.length / 3 }, (_, i) => geometry.contactRadius(i, direction) * slowReboundOrbDepthLimits.rayDepthRatio);
  d.begin([-.0000553063, .3164794860, .9409942525]);
  for (let i = 0; i < 180; i++) {
    d.step(1 / 60); if (i % 6 === 0) check();
  }
  for (let i = 0; i < positions.length; i += 3) {
    const depth = Math.hypot(...[0, 1, 2].map(k => positions[i + k] - rest[i + k]));
    maximumDepth = Math.max(maximumDepth, depth);
    assert.ok(depth <= wallLimits[i / 3] + 1e-6, 'Every ray retains at least 7.5% of its original front-to-back chord');
  }
  assert.ok(maximumDepth > 1.70);
  d.release();
  for (let i = 0; i < 960; i++) { d.step(1 / 60); if (i % 30 === 0) check(); }
  assert.deepEqual(positions, rest); assert.equal(d.step(1 / 60).needsFrame, false);
  t.diagnostic(JSON.stringify({ maximumDepth, minimumAreaRatio, finalError: 0 }));
});

test('斜按触发安全限制时整体保留圆滑轮廓，禁止逐三角形生成折面', async t => {
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = readMesh('assets/models/squishy-orb.glb');
  const rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  const geometry = createSurfaceGeometry(rest, normals, mesh.indices);
  const direction = [0, .12, Math.sqrt(1 - .12 ** 2)];
  const from = new Float32Array(rest.length), candidate = from.slice();
  const hit = [.45, .0175, Math.sqrt(1 - .45 ** 2)];
  for (let i = 0; i < rest.length; i += 3) {
    const q2 = [0, 1, 2].reduce((sum, k) => sum + (rest[i + k] - hit[k]) ** 2, 0) / .82 ** 2;
    const influence = q2 < 1 ? (1 - q2) ** 3 : 0;
    const depth = Math.min(.85, geometry.contactRadius(i / 3, direction) * .92) * influence;
    for (let k = 0; k < 3; k++) candidate[i + k] = depth * direction[k];
  }
  const requested = candidate.slice();
  const alpha = geometry.createContactSafety({ uniform: true })(from, candidate);
  assert.ok(alpha > 0 && alpha < .99, 'Oblique fixture actually activates the safety bound');
  assert.ok(candidate.every((v, i) => Math.abs(v - requested[i] * alpha) < 1e-7), 'Every vertex preserves one common smooth field, without local clipping patches');
  for (const progress of [.25, .5, 1]) {
    const p = rest.map((v, i) => v - candidate[i] * progress);
    for (let tri = 0; tri < mesh.indices.length; tri += 3) {
      const [a, b, c] = mesh.indices.slice(tri, tri + 3);
      const cross = positions => {
        const u = [0, 1, 2].map(k => positions[b * 3 + k] - positions[a * 3 + k]);
        const v = [0, 1, 2].map(k => positions[c * 3 + k] - positions[a * 3 + k]);
        return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      };
      const before = cross(rest), after = cross(p);
      const areaRatio = before.reduce((sum, v, k) => sum + v * after[k], 0) / before.reduce((sum, v) => sum + v * v, 0);
      assert.ok(areaRatio >= .07999, 'All faces retain the original 8% safety margin throughout restore');
    }
  }
  t.diagnostic(JSON.stringify({ acceptedFraction: alpha }));
});
