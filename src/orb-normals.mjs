// Same indexed, area-weighted accumulation and Float32 rounding as Three,
// without per-face BufferAttribute method calls or temporary vector objects.
export function updateIndexedNormals(geometry) {
  const p = geometry.attributes.position.array, n = geometry.attributes.normal.array, indices = geometry.index.array;
  n.fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const cx = p[c] - p[b], cy = p[c + 1] - p[b + 1], cz = p[c + 2] - p[b + 2];
    const ax = p[a] - p[b], ay = p[a + 1] - p[b + 1], az = p[a + 2] - p[b + 2];
    const x = cy * az - cz * ay, y = cz * ax - cx * az, z = cx * ay - cy * ax;
    for (const i of [a, b, c]) { n[i] += x; n[i + 1] += y; n[i + 2] += z; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const length = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]);
    const inverse = 1 / (length || 1);
    n[i] *= inverse; n[i + 1] *= inverse; n[i + 2] *= inverse;
  }
  geometry.attributes.normal.needsUpdate = true;
}
