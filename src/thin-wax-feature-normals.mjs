import * as THREE from 'three';

// Angle-weighted feature normals for an oriented closed triangle surface.
// Bærentzen & Aanæs (2005), DOI 10.1109/TVCG.2005.49. Face normals alone do
// not determine the inside/outside sign when the closest feature is an edge.
export function createWaxFeatureNormals(geometry, restPositions = geometry.attributes.position.array) {
  const index = geometry.index.array, canonical = [], ids = new Map(), vertices = [], edges = new Map(), topology = [];
  for (let i = 0; i < restPositions.length; i += 3) {
    const key = `${restPositions[i]},${restPositions[i + 1]},${restPositions[i + 2]}`;
    if (!ids.has(key)) { ids.set(key, vertices.length); vertices.push(new THREE.Vector3()); }
    canonical.push(ids.get(key));
  }
  for (let f = 0; f < index.length; f += 3) {
    const corners = [canonical[index[f]], canonical[index[f + 1]], canonical[index[f + 2]]], incident = [];
    for (let k = 0; k < 3; k++) {
      const a = corners[k], b = corners[(k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!edges.has(key)) edges.set(key, { normal: new THREE.Vector3(), faces: 0 });
      const edge = edges.get(key); edge.faces++; incident.push(edge);
    }
    topology.push({ corners, edges: incident });
  }
  function refit(faces) {
    for (const normal of vertices) normal.set(0, 0, 0);
    for (const edge of edges.values()) edge.normal.set(0, 0, 0);
    for (let i = 0; i < faces.length; i++) {
      const { ab: u, ac: v, normal } = faces[i], feature = topology[i];
      feature.points ||= [faces[i].triangle.a, faces[i].triangle.b, faces[i].triangle.c];
      // Keep the original face accumulation order and Float64 arithmetic.
      // Only reuse angles when both current triangle edges are bit-identical.
      const cached = feature.angles ||= new Float64Array(9);
      if (!feature.hasAngles || cached[0] !== u.x || cached[1] !== u.y || cached[2] !== u.z || cached[3] !== v.x || cached[4] !== v.y || cached[5] !== v.z) {
        const x = u.y * v.z - u.z * v.y, y = u.z * v.x - u.x * v.z, z = u.x * v.y - u.y * v.x;
        const area = Math.sqrt(x * x + y * y + z * z), dot = u.dot(v);
        cached[0]=u.x;cached[1]=u.y;cached[2]=u.z;cached[3]=v.x;cached[4]=v.y;cached[5]=v.z;
        cached[6]=Math.atan2(area,dot);cached[7]=Math.atan2(area,u.lengthSq()-dot);cached[8]=Math.atan2(area,v.lengthSq()-dot);feature.hasAngles=true;
      }
      vertices[feature.corners[0]].addScaledVector(normal, cached[6]);
      vertices[feature.corners[1]].addScaledVector(normal, cached[7]);
      vertices[feature.corners[2]].addScaledVector(normal, cached[8]);
      for (const edge of feature.edges) edge.normal.add(normal);
    }
    for (const normal of vertices) normal.normalize();
    for (const edge of edges.values()) edge.normal.normalize();
  }
  function normalAt(faceIndex, face, closest, out) {
    const feature = topology[faceIndex], corners = feature.points;
    for (let k = 0; k < 3; k++) if (closest.distanceToSquared(corners[k]) <= 1e-24) {
      const normal = vertices[feature.corners[k]];
      return out.copy(normal.lengthSq() > 1e-20 ? normal : face.normal);
    }
    for (let k = 0; k < 3; k++) {
      const a = corners[k], b = corners[(k + 1) % 3], x = b.x - a.x, y = b.y - a.y, z = b.z - a.z;
      const lengthSquared = x * x + y * y + z * z;
      if (!lengthSquared) continue;
      const weight = ((closest.x - a.x) * x + (closest.y - a.y) * y + (closest.z - a.z) * z) / lengthSquared;
      const dx = closest.x - a.x - x * weight, dy = closest.y - a.y - y * weight, dz = closest.z - a.z - z * weight;
      if (weight >= -1e-12 && weight <= 1 + 1e-12 && dx * dx + dy * dy + dz * dz <= 1e-24) {
        const edge = feature.edges[k], normal = edge.normal;
        return out.copy(edge.faces === 2 && normal.lengthSq() > 1e-20 ? normal : face.normal);
      }
    }
    return out.copy(face.normal);
  }
  return { refit, normalAt, topology: { vertices: vertices.length, edges: edges.size, boundaryEdges: [...edges.values()].filter(e => e.faces === 1).length, nonManifoldEdges: [...edges.values()].filter(e => e.faces > 2).length } };
}
