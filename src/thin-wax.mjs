import { createVoronoiWax } from './thin-wax-panels.mjs';
import * as THREE from 'three';

export const thinWaxParameters = Object.freeze({ thickness: .014, gap: .004, dwell: .5, localRadius: .16, chainDuration: .063, visibleDeformation: .004, extraFractureDelay: .06, extraFractureStrain: .015, maxLocalFragments: 180, maxFragments: 180, maxLivingFragments: 24 });

// A refitted triangle BVH, used for segment sweeps against the actual deformed
// mesh. No sphere/radial proxy is used, including inside a torus hole.
function collisionTree(geometry) {
  const p = geometry.attributes.position, index = geometry.index.array;
  const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), hit = a.clone();
  const triangleBox = i => new THREE.Box3().setFromPoints([a.fromBufferAttribute(p, index[i]), b.fromBufferAttribute(p, index[i + 1]), c.fromBufferAttribute(p, index[i + 2])]);
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
    if (node.ids) for (const i of node.ids) node.box.expandByPoint(a.fromBufferAttribute(p, index[i])).expandByPoint(b.fromBufferAttribute(p, index[i + 1])).expandByPoint(c.fromBufferAttribute(p, index[i + 2]));
    else { refit(node.left); refit(node.right); node.box.union(node.left.box).union(node.right.box); }
  }
  const ray = new THREE.Ray();
  function sweep(origin, displacement) {
    let nearest = displacement.length(); if (nearest < 1e-8) return nearest;
    ray.origin.copy(origin); ray.direction.copy(displacement).normalize();
    function visit(node) {
      if (!ray.intersectsBox(node.box)) return;
      if (node.ids) for (const i of node.ids) {
        a.fromBufferAttribute(p, index[i]); b.fromBufferAttribute(p, index[i + 1]); c.fromBufferAttribute(p, index[i + 2]);
        if (ray.intersectTriangle(a, b, c, false, hit)) { const distance = hit.distanceTo(origin); if (distance > 1e-6) nearest = Math.min(nearest, distance); }
      } else { visit(node.left); visit(node.right); }
    }
    visit(root); return nearest;
  }
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3(), faceNormal = new THREE.Vector3();
  function signedDistance(point, outwardNormal) {
    let distance = Infinity, signed = Infinity;
    function visit(node) {
      if (node.box.distanceToPoint(point) > distance) return;
      if (node.ids) for (const i of node.ids) {
        triangle.set(a.fromBufferAttribute(p, index[i]), b.fromBufferAttribute(p, index[i + 1]), c.fromBufferAttribute(p, index[i + 2]));
        triangle.closestPointToPoint(point, closest); const d = closest.distanceTo(point);
        if (d < distance) { distance = d; triangle.getNormal(faceNormal); outwardNormal?.copy(faceNormal); signed = (point.x - closest.x) * faceNormal.x + (point.y - closest.y) * faceNormal.y + (point.z - closest.z) * faceNormal.z < 0 ? -d : d; }
      } else { visit(node.left); visit(node.right); }
    }
    visit(root); return signed;
  }
  return { refit, sweep, signedDistance, intersectsBox: box => root.box.intersectsBox(box) };
}

export function createThinWax(options = {}) { return createVoronoiWax(options, thinWaxParameters, collisionTree); }
