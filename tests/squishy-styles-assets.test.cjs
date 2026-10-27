const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readMesh, topology } = require('./helpers/squishy-mesh.cjs');
const ids = ['orb', 'cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];

test('新增样式登记完整，资产与预览真实存在，未知样式不静默冒充圆球', async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const urls = new Set();
  for (const id of ids) {
    const style = getSquishyStyle(id);
    assert.equal(style.id, id); assert.ok(style.name); assert.ok(style.meshName);
    assert.match(style.modelUrl, /^\/assets\/models\/.+\.glb$/);
    assert.ok(fs.existsSync(`.${style.modelUrl}`)); assert.ok(fs.existsSync(`.${style.previewUrl}`));
    urls.add(style.modelUrl);
  }
  assert.equal(urls.size, ids.length);
  assert.throws(() => getSquishyStyle('missing-style'));
});

for (const id of ids.slice(1)) test(`${id}：实际 GLB 单连通闭合网格、法线、厚度及预算`, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const style = getSquishyStyle(id), mesh = readMesh(`.${style.modelUrl}`), { gltf, primitive, positions, normals, indices } = mesh;
  assert.equal(gltf.meshes.length, 1); assert.equal(gltf.meshes[0].primitives.length, 1);
  assert.equal(gltf.nodes.filter(n => n.mesh !== undefined).length, 1);
  assert.ok(gltf.nodes.some(n => n.name === style.meshName));
  assert.ok(gltf.buffers.every(buffer => !buffer.uri)); assert.deepEqual(gltf.extensionsRequired || [], []);
  assert.equal(gltf.animations, undefined); assert.equal(gltf.textures, undefined);
  assert.equal(primitive.mode ?? 4, 4); assert.equal(normals.length, positions.length);
  assert.ok(positions.every(Number.isFinite)); assert.ok(normals.every(Number.isFinite));
  assert.ok(indices.every(i => Number.isInteger(i) && i >= 0 && i < positions.length / 3));
  assert.ok(positions.length / 3 >= 1500 && positions.length / 3 < 30000);
  assert.ok(indices.length / 3 < 60000); assert.ok(mesh.bytes.length < 2 * 1024 * 1024);
  for (let i = 0; i < normals.length; i += 3) assert.ok(Math.abs(Math.hypot(...normals.slice(i, i + 3)) - 1) < .02, `unit normal ${i / 3}`);
  const spans = mesh.high.map((v, k) => v - mesh.low[k]);
  assert.ok(Math.min(...spans) > .45, `real volume ${spans}`); assert.ok(Math.max(...spans) < 4);
  const t = topology(mesh);
  assert.equal(t.components, 1, JSON.stringify(t)); assert.equal(t.boundaryOrNonmanifold, 0, JSON.stringify(t)); assert.equal(t.degenerate, 0);
  assert.equal(t.euler, id === 'donut' ? 0 : 2, 'One continuous outer skin; donut retains its genus-one hole');
  let signedVolume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map(v => positions.slice(v * 3, v * 3 + 3));
    const u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(Math.hypot(...n) > 1e-10, 'Triangle has real area');
    const averageNormal = [0, 1, 2].map(k => indices.slice(i, i + 3).reduce((sum, index) => sum + normals[index * 3 + k], 0));
    assert.ok(n.reduce((sum, value, k) => sum + value * averageNormal[k], 0) > 0, 'Winding agrees with exported normals');
    signedVolume += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  assert.ok(signedVolume / 6 > .1, 'Outward oriented solid with real enclosed volume');
});
