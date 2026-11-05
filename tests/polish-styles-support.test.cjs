const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');
const styles = (process.env.POLISH_SUPPORT_STYLES || 'cloud,cylinder,donut,pyramid,flower,star').split(',');
const feels = (process.env.POLISH_SUPPORT_FEELS || 'clay,marshmallow,slow-rebound').split(',');

for (const styleId of styles) for (const feelId of feels) test(`${styleId} ${feelId}: independent whole-core polish support and exact bare-core trajectory`, { timeout: 180000 }, async t => {
  const THREE = await import('three');
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { getOrbPreset } = await import('../src/orb-presets.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const { createPolishShell } = await import('../src/polish-shell.mjs');
  const { createWaxCollisionTree } = await import('../src/thin-wax.mjs');
  const style = getSquishyStyle(styleId), data = readMesh(`.${style.modelUrl}`);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3)); geometry.setIndex(data.indices);
  const rest = geometry.attributes.position.array.slice(), restNormals = geometry.attributes.normal.array.slice(), bare = geometry.clone();
  const computed = geometry.clone(); computed.computeVertexNormals(); const computedNormals = computed.attributes.normal.array.slice(); computed.dispose();
  const surfaceOptions = { ...style.geometryOptions, continuousFootprint: feelId === 'slow-rebound' };
  const surface = () => createSurfaceGeometry(rest.slice(), restNormals.slice(), data.indices, surfaceOptions);
  let direction = new THREE.Vector3(...style.camera).sub(new THREE.Vector3(0, -.02, 0)).normalize().toArray();
  const options = () => ({ surfaceGeometry: surface(), ...(feelId === 'slow-rebound' ? { getPressDirection: () => direction } : {}) });
  const core = getOrbPreset(feelId).createDeformation(geometry.attributes.position.array, restNormals.slice(), options());
  const naked = getOrbPreset(feelId).createDeformation(bare.attributes.position.array, restNormals.slice(), options());
  const shell = createPolishShell({ geometry, restPositions: rest, restNormals, feelId, surfaceGeometry: surface(), color: '#f7e1a3' });
  const tree = createWaxCollisionTree(geometry, { featureNormals: true, restPositions: rest });
  const edges = new Map(), index = geometry.index.array;
  for (let f = 0; f < index.length; f += 3) for (let k = 0; k < 3; k++) {
    const a = index[f + k], b = index[f + (k + 1) % 3]; edges.set(a < b ? `${a}:${b}` : `${b}:${a}`, [a, b]);
  }
  let comparedFrames = 0, totalSamples = 0;
  const phases = [], failures = [], p = new THREE.Vector3(), q = p.clone(), r = p.clone();
  function same() { assert.deepEqual(geometry.attributes.position.array, bare.attributes.position.array); assert.deepEqual(core.getState(), naked.getState()); }
  function act(method, ...args) { core[method](...args); naked[method](...args); same(); }
  function advance(frames) {
    for (let n = 0; n < frames; n++) {
      const step = core.step(1 / 60); assert.deepEqual(step, naked.step(1 / 60)); comparedFrames++; same();
      if (step.changed) {
        if (step.atRest) geometry.attributes.normal.array.set(restNormals);
        else {
          geometry.computeVertexNormals(); const normals = geometry.attributes.normal.array;
          for (let i = 0; i < normals.length; i += 3) {
            for (let k = 0; k < 3; k++) normals[i + k] += restNormals[i + k] - computedNormals[i + k];
            const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
            for (let k = 0; k < 3; k++) normals[i + k] /= Math.max(1e-8, length);
          }
        }
      }
      shell.step(1 / 60); same();
    }
  }
  function contact(x, y) {
    let best = Infinity, point;
    for (let i = 0; i < rest.length; i += 3) if (restNormals[i + 2] > .25) {
      const distance = (rest[i] - x) ** 2 + (rest[i + 1] - y) ** 2;
      if (distance < best) { best = distance; point = Array.from(rest.slice(i, i + 3)); }
    }
    return point;
  }
  const targets = styleId === 'donut' ? [[.38, 0], [-.38, .12]] : styleId === 'flower' ? [[.55, .05], [-.25, .15]] : styleId === 'star' ? [[.50, .15], [-.25, -.15]] : [[.15, .1], [-.25, -.15]];
  const [start, end] = targets.map(([x, y]) => contact(x, y));
  function inspect(label) {
    tree.refit(); const positions = shell.geometry.attributes.position;
    let min = Infinity, max = 0, violations = 0, samples = 0, worst;
    function query(point, kind, id) {
      const distance = tree.signedDistance(point); samples++;
      if (distance < min) { min = distance; worst = { kind, id, position: point.toArray() }; }
      max = Math.max(max, distance); if (distance < 0 || distance > .004) violations++;
    }
    for (let i = 0; i < positions.count; i++) query(p.fromBufferAttribute(positions, i), 'vertex', i);
    for (const [a, b] of edges.values()) query(p.fromBufferAttribute(positions, a).add(q.fromBufferAttribute(positions, b)).multiplyScalar(.5), 'edge', [a, b]);
    for (let face = 0; face < index.length; face += 3) query(p.fromBufferAttribute(positions, index[face]).add(q.fromBufferAttribute(positions, index[face + 1])).add(r.fromBufferAttribute(positions, index[face + 2])).multiplyScalar(1 / 3), 'centroid', face / 3);
    const result = { label, depth: core.getState().depth, samples, minSigned: min, maxNearestGap: max, violations, worst };
    phases.push(result); totalSamples += samples;
    if (violations) { failures.push(result); console.log(JSON.stringify({ supportFailure: true, styleId, feelId, ...result })); }
    same();
  }
  try {
    inspect('rest');
    act('begin', start); shell.begin(start); advance(9); inspect('shallow-150ms'); advance(171); inspect('deep-3s');
    assert.ok(core.getState().depth > .005, 'A real core indentation must be tested');
    for (let segment = 1; segment <= 12; segment++) {
      const point = contact(targets[0][0] + (targets[1][0] - targets[0][0]) * segment / 12, targets[0][1] + (targets[1][1] - targets[0][1]) * segment / 12);
      act('move', point, .8 / 12); shell.move(point); advance(3);
      if (segment % 4 === 0) inspect(`slide-${segment}/12`);
    }
    act('release'); shell.end(); const history = shell.getSurfaceSnapshot().damage;
    for (let phase = 0; phase < 3; phase++) { advance(30); inspect(`release-${(phase + 1) * .5}s`); assert.deepEqual(shell.getSurfaceSnapshot().damage, history); }
    for (const [cycle, point] of [end, start].entries()) {
      act('begin', point); shell.begin(point); advance(90); inspect(`repeat-${cycle}`); act('cancel'); shell.end(); advance(15);
    }
    const permanent = shell.getSurfaceSnapshot().damage;
    act('beginRestore');
    for (const progress of [0, .25, .5, .75, 1]) { act('applyRestore', progress); advance(1); inspect(`restore-${progress}`); assert.deepEqual(shell.getSurfaceSnapshot().damage, permanent); }
    assert.deepEqual(geometry.attributes.position.array, rest);
    t.diagnostic(JSON.stringify({ styleId, feelId, sourceModel: style.modelUrl, comparedFrames, totalSamples, contacts: [start, end], sampling: 'all actual shell vertices, unique edge midpoints, triangle centroids against whole core at all reported phases; same normal transport as scene', phases }));
    assert.deepEqual(failures, [], `${styleId}/${feelId}: whole-core shell support failed`);
  } finally { shell.dispose(); geometry.dispose(); bare.dispose(); }
});
