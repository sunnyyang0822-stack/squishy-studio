const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

for (const id of ['paw', 'donut']) test(`${id}: both cores share smaller connected wax plates with unchanged thickness and active budget`, async t => {
  const THREE = await import('three');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const mesh = readMesh(`./assets/models/squishy-${id}.glb`), rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setIndex(mesh.indices);
  const create = styleId => getWaxPreset('thin-wax').create({ styleId, geometry, restPositions: rest, restNormals: normals });
  const original = create(undefined), fine = create(id);
  function areas(wax) {
    const s = wax.getSurfaceSnapshot(), result = new Map(), p = new THREE.Vector3(), q = p.clone(), r = p.clone();
    for (let i = 0; i < s.indices.length; i += 3) {
      const [a, b, c] = s.indices.slice(i, i + 3); if (s.layers[a] !== 1 || s.layers[b] !== 1 || s.layers[c] !== 1) continue;
      p.fromArray(s.positions, a * 3); q.fromArray(s.positions, b * 3); r.fromArray(s.positions, c * 3);
      const key = s.panelIds[a]; result.set(key, (result.get(key) || 0) + q.sub(p).cross(r.sub(p)).length() * .5);
    }
    return [...result.values()].sort((a, b) => a - b);
  }
  const old = areas(original), small = areas(fine), average = values => values.reduce((a,b)=>a+b,0)/values.length;
  assert.ok(small.length > old.length * 1.3 && small.length <= 280);
  assert.ok(average(small) < average(old) * .78, 'Mean real surface area must shrink by at least 22%, rather than merely shrinking rendered fragments');
  assert.ok(small[Math.floor(small.length * .9)] < old[Math.floor(old.length * .9)], 'The large plate tail also gets smaller');
  const m = fine.getMetrics({ exhaustive: true }); assert.equal(m.thickness, .014); assert.equal(m.attachedViolations, 0); assert.ok(m.maxThicknessError < 1e-5);
  t.diagnostic(JSON.stringify({ id, oldCount: old.length, count: small.length, meanAreaRatio: average(small)/average(old), p90AreaRatio: small[Math.floor(small.length*.9)]/old[Math.floor(old.length*.9)] }));
  original.dispose(); fine.dispose(); geometry.dispose();
});
