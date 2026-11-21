import * as THREE from 'three';

// A closed spherical cap: outer face, inner face, and a real connecting rim.
// This is a selection swatch, independent of every toy and fracture factory.
export function createShellSampleGeometry(thickness, { rings = 20, segments = 72, radius = 1.2, angle = .88 } = {}) {
  const vertices = [], indices = [];
  for (let layer = 0; layer < 2; layer++) {
    const r = radius - layer * thickness;
    vertices.push(0, 0, r - radius * Math.cos(angle));
    for (let ring = 1; ring <= rings; ring++) {
      const theta = angle * ring / rings;
      for (let j = 0; j < segments; j++) {
        const phi = j / segments * Math.PI * 2;
        vertices.push(r * Math.sin(theta) * Math.cos(phi), r * Math.sin(theta) * Math.sin(phi) * .88, r * Math.cos(theta) - radius * Math.cos(angle));
      }
    }
  }
  const count = 1 + rings * segments;
  const face = (a, b, c, reverse) => indices.push(...(reverse ? [c, b, a] : [a, b, c]));
  for (let layer = 0; layer < 2; layer++) {
    const base = layer * count;
    for (let j = 0; j < segments; j++) face(base, base + 1 + j, base + 1 + (j + 1) % segments, layer === 1);
    for (let ring = 1; ring < rings; ring++) for (let j = 0; j < segments; j++) {
      const a = base + 1 + (ring - 1) * segments + j, b = base + 1 + (ring - 1) * segments + (j + 1) % segments;
      face(a, a + segments, b, layer === 1);
      face(b, a + segments, b + segments, layer === 1);
    }
  }
  const edge = 1 + (rings - 1) * segments;
  for (let j = 0; j < segments; j++) {
    const a = edge + j, b = edge + (j + 1) % segments;
    indices.push(a, b + count, b, a, a + count, b + count);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  geometry.userData.thickness = thickness;
  return geometry;
}
