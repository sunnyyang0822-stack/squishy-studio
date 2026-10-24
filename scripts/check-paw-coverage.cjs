// Reproducible CPU geometry evidence; browser/touch acceptance is recorded separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { readMesh, topology } = require('../tests/helpers/squishy-mesh.cjs');
const root = path.resolve(__dirname, '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const feelIds = (process.argv.find(arg => arg.startsWith('--feel='))?.slice(7) || 'clay').split(',');
assert.ok(feelIds.length && feelIds.every(id => ['clay', 'marshmallow'].includes(id)), 'Explicit known feel IDs are required');
const regions = [
  ['主垫中央', 0, -.4, 'front'], ['心形左肩', -.3, -.42, 'front'],
  ['心形右肩', .3, -.42, 'front'], ['主垫下缘', 0, -.72, 'front'],
  ['左外趾垫', -.76, .43, 'front'], ['左内趾垫', -.3, .78, 'front'],
  ['右内趾垫', .3, .78, 'front'], ['右外趾垫', .76, .43, 'front'],
  ['左趾连接', -.53, .42, 'front'], ['右趾连接', .53, .42, 'front'],
  ['掌背', 0, -.38, 'back'], ['左侧厚边', -1.02, .3, 'side'],
  ['底部厚边', 0, -1.08, 'side'],
];
function frames(deformation, count) { for (let i = 0; i < count; i++) deformation.step(1 / 60); }

async function main() {
  const load = relative => import(pathToFileURL(path.join(root, relative)).href);
  const [{ createSurfaceGeometry }, { getOrbFeel }, { getSquishyStyle }] = await Promise.all([
    load('src/surface-clay.mjs'), load('src/orb-feels.mjs'), load('src/squishy-styles.mjs'),
  ]);
  const style = getSquishyStyle('paw');
  const mesh = readMesh(path.join(root, style.modelUrl));
  const rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  const geometry = createSurfaceGeometry(rest, normals, mesh.indices, style.geometryOptions);
  const constraintDurations = [];
  if (geometry.constrainOffsets) {
    const project = geometry.constrainOffsets;
    geometry.constrainOffsets = (from, candidate) => {
      const start = performance.now();
      const alpha = project(from, candidate);
      constraintDurations.push(performance.now() - start);
      return alpha;
    };
  }
  const center = mesh.low.map((v, k) => (v + mesh.high[k]) / 2);
  const topo = topology(mesh);
  const radial = geometry.parameterization === 'star-convex';
  if (!radial) assert.equal(typeof geometry.constrainOffsets, 'function', 'Nonstar surface requires actual-segment geometry safety');
  assert.equal(topo.components, 1); assert.equal(topo.euler, 2);
  assert.equal(topo.boundaryOrNonmanifold, 0); assert.equal(topo.degenerate, 0);
  function determinant(positions, a, b, c) {
    const ax = positions[a * 3] - center[0], ay = positions[a * 3 + 1] - center[1], az = positions[a * 3 + 2] - center[2];
    const bx = positions[b * 3] - center[0], by = positions[b * 3 + 1] - center[1], bz = positions[b * 3 + 2] - center[2];
    const cx = positions[c * 3] - center[0], cy = positions[c * 3 + 1] - center[1], cz = positions[c * 3 + 2] - center[2];
    return ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  let restMinDet = Infinity, restMinNormalDot = Infinity;
  for (let i = 0; i < rest.length; i += 3) {
    const radial = center.map((v, k) => rest[i + k] - v);
    restMinNormalDot = Math.min(restMinNormalDot, radial.reduce((sum, v, k) => sum + v * normals[i + k], 0) / Math.hypot(...radial));
  }
  for (let i = 0; i < mesh.indices.length; i += 3) restMinDet = Math.min(restMinDet, determinant(rest, ...mesh.indices.slice(i, i + 3)));
  if (radial) assert.ok(restMinNormalDot > .05 && restMinDet > 1e-10);
  function normal(source, a, b, c) {
    const u = [0, 1, 2].map(k => source[b * 3 + k] - source[a * 3 + k]);
    const v = [0, 1, 2].map(k => source[c * 3 + k] - source[a * 3 + k]);
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  }
  const restFaces = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const tri = mesh.indices.slice(i, i + 3), n = normal(rest, ...tri);
    restFaces.push({ tri, n, square: n.reduce((s, v) => s + v * v, 0) });
  }
  const repeated = { regions: regions.length, strokesPerRegion: 8, strokes: 0, checkedStates: 0, minRadialScale: radial ? 1 : null, minFaceDeterminant: radial ? Infinity : null, minProjectedAreaRatio: radial ? null : Infinity, changedVerticesOutsideFootprint: 0 };
  const samples = [];
  for (const [name, x, y, view] of regions) {
    let vertex = -1, best = Infinity;
    for (let i = 0; i < rest.length; i += 3) {
      if (view === 'front' && normals[i + 2] < .3) continue;
      if (view === 'back' && normals[i + 2] > -.3) continue;
      if (view === 'side' && Math.abs(normals[i + 2]) > .4) continue;
      const score = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2 + (view === 'side' ? rest[i + 2] ** 2 : 0);
      if (score < best) { vertex = i / 3; best = score; }
    }
    assert.ok(vertex >= 0 && best < .08, `${name}: actual visible surface near target`);
    const hit = Array.from(rest.slice(vertex * 3, vertex * 3 + 3));
    const footprint = new Set(geometry.neighborhood(hit, .66).map(([i]) => i));
    const sample = { name, view, requestedXY: [x, y], vertex, hit, feels: {} };
    for (const feelId of feelIds) {
      const positions = rest.slice(), d = getOrbFeel(feelId).createDeformation(positions, normals, { surfaceGeometry: geometry });
      d.begin(hit); frames(d, 162);
      const depth = Math.hypot(...hit.map((v, k) => positions[vertex * 3 + k] - v));
      assert.ok(depth > (view === 'side' ? .04 : .08), `${name}/${feelId}: contact depth ${depth}`);
      d.release(); frames(d, 120);
      const retainedDepth = Math.hypot(...hit.map((v, k) => positions[vertex * 3 + k] - v));
      const ratio = retainedDepth / depth;
      assert.ok(Math.abs(ratio - (feelId === 'clay' ? .85 : 1)) < .002, `${name}/${feelId}: retained ratio ${ratio}`);
      d.beginRestore(); d.applyRestore(1); d.step(1 / 60); assert.deepEqual(positions, rest);
      sample.feels[feelId] = { holdSeconds: 2.7, contactDepth: depth, retainedDepth, retainedRatio: ratio, restoresExactRest: true };
    }
    const positions = rest.slice(), d = getOrbFeel('clay').createDeformation(positions, normals, { surfaceGeometry: geometry });
    function checkState() {
      for (let i = 0; i < rest.length; i += 3) {
        const displacement = Math.hypot(positions[i] - rest[i], positions[i + 1] - rest[i + 1], positions[i + 2] - rest[i + 2]);
        if (!footprint.has(i / 3) && displacement > 1e-7) repeated.changedVerticesOutsideFootprint++;
        if (!radial) continue;
        const a = center.map((v, k) => rest[i + k] - v), b = center.map((v, k) => positions[i + k] - v);
        const scale = Math.hypot(...b) / Math.hypot(...a);
        const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        assert.ok(Math.hypot(...cross) < 1e-6, `${name}: stays on original ray`);
        assert.ok(scale > .07999 && a.reduce((sum, v, k) => sum + v * b[k], 0) > 0, `${name}: positive radial scale`);
        repeated.minRadialScale = Math.min(repeated.minRadialScale, scale);
      }
      for (const { tri, n, square } of restFaces) {
        if (radial) {
          const det = determinant(positions, ...tri);
          assert.ok(det > 0, `${name}: radial face fold`);
          repeated.minFaceDeterminant = Math.min(repeated.minFaceDeterminant, det);
        } else {
          const after = normal(positions, ...tri);
          const ratio = n.reduce((s, v, k) => s + v * after[k], 0) / square;
          assert.ok(ratio >= .08, `${name}: original face normal/area safety ${ratio}`);
          repeated.minProjectedAreaRatio = Math.min(repeated.minProjectedAreaRatio, ratio);
        }
      }
      repeated.checkedStates++;
    }
    for (let stroke = 0; stroke < 8; stroke++) {
      d.begin(hit); frames(d, 240); checkState();
      d.release(); frames(d, 120); checkState(); repeated.strokes++;
    }
    samples.push(sample);
  }
  assert.equal(repeated.changedVerticesOutsideFootprint, 0);
  constraintDurations.sort((a, b) => a - b);
  const report = {
    schema: 1, generatedAt: new Date().toISOString(), feelIds, modelUrl: style.modelUrl,
    glbSha256: sha256(mesh.bytes), glbBytes: mesh.bytes.length,
    runtimeSha256: Object.fromEntries(['src/surface-clay.mjs', 'src/orb-deformation.mjs', ...(feelIds.includes('marshmallow') ? ['src/orb-marshmallow.mjs'] : [])].map(file => [file, sha256(fs.readFileSync(path.join(root, file)))])),
    method: `CPU simulation of actual exported GLB, fixed 60 Hz. 13 independent visible front/back/side contact vertices; 2.7 s holds for explicitly selected feels (${feelIds.join(', ')}); 8 repeated 4 s clay holds at each region. End-held and end-released states checked after every stroke. This is not browser or physical-device performance evidence.`,
    parameterization: geometry.parameterization, topology: topo,
    restGeometry: { minFaceRadialDeterminant: restMinDet, minRadialNormalCosine: restMinNormalDot },
    samples, repeated,
    constraintCpuTiming: { method: 'Wall time inside each geometry-only offset projection during this CPU simulation; excludes browser rendering and is not FPS or a physical-phone result.', calls: constraintDurations.length, medianMs: constraintDurations[Math.floor(constraintDurations.length / 2)] || null, p95Ms: constraintDurations[Math.floor(constraintDurations.length * .95)] || null, maxMs: constraintDurations.at(-1) || null },
    safetyArgument: radial ? 'Single closed genus-zero rest mesh has strictly positive radial face determinants. All deformed vertices remain on their original rays with scale at least 0.08; therefore face cones and the one-to-one radial projection remain unchanged. Continuous interpolation and retention cannot cross the origin; this covers intermediate frames beyond the explicitly sampled 208 endpoint states.' : 'Each actual proposed offset increment is projected before the first quadratic root at which any triangle would lose the original .08 rest-normal projected-area margin. The entire accepted segment and its straight route to rest are checked, not just endpoints. Original ray thickness and curvature bounds remain. This verifies local triangle nonfolding; it is not a general pairwise nonadjacent-triangle collision proof.',
  };
  const output = path.join(root, 'artifacts/issue-30-paw/coverage.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, glbSha256: report.glbSha256, contactRanges: Object.fromEntries(feelIds.map(id => [id, [Math.min(...samples.map(s => s.feels[id].contactDepth)), Math.max(...samples.map(s => s.feels[id].contactDepth))]])), repeated, constraintCpuTiming: report.constraintCpuTiming }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
