import { createVoronoiWax } from './thin-wax-panels.mjs';
import * as THREE from 'three';

export const thinWaxParameters = Object.freeze({ thickness: .014, gap: .004, dwell: .5, localRadius: .16, chainDuration: .063, visibleDeformation: .004, extraFractureDelay: .06, extraFractureStrain: .015, maxLocalFragments: 180, maxFragments: 180, maxLivingFragments: 24 });

// A refitted triangle BVH, used for segment sweeps against the actual deformed
// mesh. No sphere/radial proxy is used, including inside a torus hole.
function collisionTree(geometry) {
  const p = geometry.attributes.position, index = geometry.index.array;
  const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), hit = a.clone();
  // Read the live mesh once per refit, rather than nine attribute reads for
  // every triangle visited by every fragment sample during this frame.
  const faces = Array.from({ length: index.length / 3 }, (_, face) => {
    const i = face * 3, triangle = new THREE.Triangle(new THREE.Vector3().fromBufferAttribute(p, index[i]), new THREE.Vector3().fromBufferAttribute(p, index[i + 1]), new THREE.Vector3().fromBufferAttribute(p, index[i + 2]));
    return { triangle, normal: triangle.getNormal(new THREE.Vector3()) };
  });
  const triangleBox = i => { const t = faces[i / 3].triangle; return new THREE.Box3().setFromPoints([t.a, t.b, t.c]); };
  function build(ids) {
    const box = new THREE.Box3(); for (const i of ids) box.union(triangleBox(i));
    if (ids.length <= 12) return { box, ids };
    const size = box.getSize(a), axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
    const centers = new Map(ids.map(i => [i, triangleBox(i).getCenter(new THREE.Vector3())[axis]]));
    ids.sort((x, y) => centers.get(x) - centers.get(y)); const mid = ids.length >> 1;
    return { box, left: build(ids.slice(0, mid)), right: build(ids.slice(mid)) };
  }
  const root = build(Array.from({ length: index.length / 3 }, (_, i) => i * 3));
  function refit(node = root) {
    node.box.makeEmpty();
    if (node.ids) for (const i of node.ids) {
      const face = faces[i / 3], t = face.triangle;
      t.a.fromBufferAttribute(p, index[i]); t.b.fromBufferAttribute(p, index[i + 1]); t.c.fromBufferAttribute(p, index[i + 2]); t.getNormal(face.normal);
      node.box.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
    }
    else { refit(node.left); refit(node.right); node.box.union(node.left.box).union(node.right.box); }
  }
  const ray = new THREE.Ray();
  function sweep(origin, displacement) {
    let nearest = displacement.length(); if (nearest < 1e-8) return nearest;
    ray.origin.copy(origin); ray.direction.copy(displacement).normalize();
    function visit(node) {
      if (!ray.intersectsBox(node.box)) return;
      if (node.ids) for (const i of node.ids) {
        const t = faces[i / 3].triangle;
        if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) { const distance = hit.distanceTo(origin); if (distance > 1e-6) nearest = Math.min(nearest, distance); }
      } else { visit(node.left); visit(node.right); }
    }
    visit(root); return nearest;
  }
  const closest = new THREE.Vector3();
  function signedDistance(point, outwardNormal) {
    let distance = Infinity, signed = Infinity;
    function visit(node) {
      if (node.box.distanceToPoint(point) > distance) return;
      if (node.ids) for (const i of node.ids) {
        const face = faces[i / 3];
        face.triangle.closestPointToPoint(point, closest); const d = closest.distanceTo(point);
        if (d < distance) { distance = d; outwardNormal?.copy(face.normal); signed = (point.x - closest.x) * face.normal.x + (point.y - closest.y) * face.normal.y + (point.z - closest.z) * face.normal.z < 0 ? -d : d; }
      } else {
        // The first nearby hit prunes far branches. The nearest surface and
        // signed-distance calculation stay exact against the same triangles.
        if (node.left.box.distanceToPoint(point) <= node.right.box.distanceToPoint(point)) { visit(node.left); visit(node.right); }
        else { visit(node.right); visit(node.left); }
      }
    }
    visit(root); return signed;
  }
  return { refit, sweep, signedDistance, intersectsBox: box => root.box.intersectsBox(box) };
}

export function createThinWax(options = {}) { return createVoronoiWax(options, thinWaxParameters, collisionTree); }
