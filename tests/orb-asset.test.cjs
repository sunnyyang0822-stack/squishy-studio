const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('圆球 GLB 是无外部依赖的单网格标准 PBR，网格预算与形变输入有效', () => {
  const bytes = readFileSync('assets/models/squishy-orb.glb');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.ok(bytes.length < 150 * 1024);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.equal(gltf.nodes.length, 1);
  assert.equal(gltf.nodes[0].name, 'Orb_Surface');
  assert.equal(gltf.meshes.length, 1);
  assert.equal(gltf.materials.length, 1);
  const p = gltf.meshes[0].primitives[0];
  const position = gltf.accessors[p.attributes.POSITION];
  assert.equal(position.count, 2562);
  assert.equal(gltf.accessors[p.indices].count / 3, 5120);
  assert.equal(gltf.accessors[p.attributes.NORMAL].count, position.count);
  assert.equal(gltf.accessors[p.attributes.COLOR_0].count, position.count);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(position.min[k] + 1) < 2e-7 && Math.abs(position.max[k] - 1) < 2e-7, 'A centered unit sphere has the same diameter on every axis');
  }
  assert.deepEqual(gltf.nodes[0].scale || [1, 1, 1], [1, 1, 1]);
  assert.equal(gltf.materials[0].pbrMetallicRoughness.metallicFactor, 0);
  assert.ok(gltf.materials[0].pbrMetallicRoughness.roughnessFactor >= .3);
  assert.equal(gltf.materials[0].doubleSided, undefined);
  assert.equal(gltf.images, undefined);
  assert.equal(gltf.textures, undefined);
  assert.equal(gltf.animations, undefined);
  assert.deepEqual(gltf.extensionsRequired || [], []);
  assert.ok(gltf.buffers.every(buffer => !buffer.uri));
  const binaryStart = 20 + bytes.readUInt32LE(12) + 8;
  const accessor = gltf.accessors[p.attributes.POSITION];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const offset = binaryStart + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const unique = new Set();
  for (let v = 0; v < accessor.count; v++) {
    const xyz = [0, 1, 2].map(i => bytes.readFloatLE(offset + v * 12 + i * 4));
    assert.ok(xyz.every(Number.isFinite));
    unique.add(xyz.join(','));
  }
  assert.equal(unique.size, accessor.count, 'No split seam vertices that could open during CPU deformation');
});

test('圆球是真正等半径球面，法线向外且闭合；所有内芯与外壳共享这一原始形状', async () => {
  const { readMesh, topology } = require('./helpers/squishy-mesh.cjs');
  const mesh = readMesh('assets/models/squishy-orb.glb');
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const point = mesh.positions.slice(i, i + 3), normal = mesh.normals.slice(i, i + 3);
    const radius = Math.hypot(...point), length = Math.hypot(...normal);
    assert.ok(Math.abs(radius - 1) < 2e-7, `Vertex ${i / 3} lies on the unit sphere, including its bottom: ${radius}`);
    assert.ok(Math.abs(length - 1) < 1e-6);
    assert.ok(point.reduce((sum, value, k) => sum + value * normal[k], 0) / radius > .999999, 'Smooth shading follows the actual spherical surface');
  }
  const structure = topology(mesh);
  assert.equal(structure.components, 1);
  assert.equal(structure.boundaryOrNonmanifold, 0);
  assert.equal(structure.euler, 2);
  assert.equal(structure.degenerate, 0);
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { getModelPresentationScale, getOrbAppearance } = await import('../src/orb-appearance.mjs');
  const { getOrbPreset } = await import('../src/orb-presets.mjs');
  for (const id of ['clay', 'marshmallow', 'slow-rebound']) {
    assert.equal(getSquishyStyle('orb').modelUrl, '/assets/models/squishy-orb.glb');
    const appearance = getOrbAppearance(getOrbPreset(id).appearanceId);
    assert.deepEqual(getModelPresentationScale(appearance, 'radial'), [1, 1, 1], `${id} must not turn the shared sphere into an ellipsoid`);
  }
});
