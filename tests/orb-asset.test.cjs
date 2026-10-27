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
  assert.ok(position.min[1] > -.95 && position.max[1] < .95, 'Y-up with a soft flattened base');
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
