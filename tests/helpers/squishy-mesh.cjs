const fs = require('node:fs');

// Read exported GLB bytes, including interleaved accessors. No source-scene or
// test-generated stand-in geometry participates in these assertions.
function readMesh(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Invalid GLB header');
  const size = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + size).toString());
  const binary = 28 + size;
  const primitive = gltf.meshes[0].primitives[0];
  function accessor(id) {
    const a = gltf.accessors[id], view = gltf.bufferViews[a.bufferView];
    const count = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const width = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const read = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' }[a.componentType];
    const start = binary + (view.byteOffset || 0) + (a.byteOffset || 0);
    return Array.from({ length: a.count * count }, (_, i) => bytes[read](start + Math.floor(i / count) * (view.byteStride || count * width) + i % count * width));
  }
  const positions = accessor(primitive.attributes.POSITION), normals = accessor(primitive.attributes.NORMAL), indices = accessor(primitive.indices);
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { low[i % 3] = Math.min(low[i % 3], positions[i]); high[i % 3] = Math.max(high[i % 3], positions[i]); }
  return { bytes, gltf, primitive, positions, normals, indices, low, high };
}

function topology(mesh) {
  const unique = new Map(), vertex = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const key = mesh.positions.slice(i, i + 3).map(v => Math.round(v * 1e6)).join(',');
    if (!unique.has(key)) unique.set(key, unique.size);
    vertex.push(unique.get(key));
  }
  const edges = new Map(), neighbors = Array.from({ length: unique.size }, () => []);
  let degenerate = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const tri = mesh.indices.slice(i, i + 3).map(v => vertex[v]);
    if (new Set(tri).size !== 3) degenerate++;
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3], key = [Math.min(a, b), Math.max(a, b)].join(',');
      edges.set(key, (edges.get(key) || 0) + 1); neighbors[a].push(b); neighbors[b].push(a);
    }
  }
  const visited = new Set(); let components = 0;
  for (let v = 0; v < neighbors.length; v++) if (!visited.has(v)) {
    components++; const stack = [v]; visited.add(v);
    while (stack.length) for (const other of neighbors[stack.pop()]) if (!visited.has(other)) { visited.add(other); stack.push(other); }
  }
  return { vertices: unique.size, edges: edges.size, faces: mesh.indices.length / 3, euler: unique.size - edges.size + mesh.indices.length / 3, boundaryOrNonmanifold: [...edges.values()].filter(n => n !== 2).length, components, degenerate };
}
module.exports = { readMesh, topology };
