import { createVoronoiWax } from './thin-wax-panels.mjs';
import * as THREE from 'three';

export const thinWaxParameters = Object.freeze({ thickness: .014, gap: .004, dwell: .5, localRadius: .16, chainDuration: .063, visibleDeformation: .004, extraFractureDelay: .06, extraFractureStrain: .015, maxLocalFragments: 180, maxFragments: 180, maxLivingFragments: 24 });

// A refitted triangle BVH, used for segment sweeps against the actual deformed
// mesh. No sphere/radial proxy is used, including inside a torus hole.
export function createWaxCollisionTree(geometry, { leafSize = 4, nearestGrid = false, queryCache = true } = {}) {
  let countQueries = false;
  const p = geometry.attributes.position, index = geometry.index.array;
  const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), hit = a.clone();
  // Read the live mesh once per refit, rather than nine attribute reads for
  // every triangle visited by every fragment sample during this frame.
  const faces = Array.from({ length: index.length / 3 }, (_, face) => {
    const i = face * 3, triangle = new THREE.Triangle(new THREE.Vector3().fromBufferAttribute(p, index[i]), new THREE.Vector3().fromBufferAttribute(p, index[i + 1]), new THREE.Vector3().fromBufferAttribute(p, index[i + 2]));
    return { triangle, ab: new THREE.Vector3().subVectors(triangle.b, triangle.a), ac: new THREE.Vector3().subVectors(triangle.c, triangle.a), normal: triangle.getNormal(new THREE.Vector3()) };
  });
  const triangleBox = i => { const t = faces[i / 3].triangle; return new THREE.Box3().setFromPoints([t.a, t.b, t.c]); };
  function build(ids) {
    const box = new THREE.Box3(); for (const i of ids) box.union(triangleBox(i));
    if (ids.length <= leafSize) return { box, ids };
    const size = box.getSize(a), axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
    const centers = new Map(ids.map(i => [i, triangleBox(i).getCenter(new THREE.Vector3())[axis]]));
    ids.sort((x, y) => centers.get(x) - centers.get(y)); const mid = ids.length >> 1;
    return { box, left: build(ids.slice(0, mid)), right: build(ids.slice(mid)) };
  }
  const root = build(Array.from({ length: index.length / 3 }, (_, i) => i * 3));
  // Optional exact local-query broad phase for densely tessellated concave
  // surfaces. Each live triangle occupies every cell touched by its AABB.
  // Large/out-of-grid queries and ambiguous equal-distance faces use the BVH.
  const cellSize = .025, gridOrigin = root.box.min.clone().addScalar(-cellSize);
  const gridSize = root.box.getSize(new THREE.Vector3()).divideScalar(cellSize).ceil().addScalar(2);
  const gridCells = gridSize.x * gridSize.y * gridSize.z;
  const gridHeads = nearestGrid && gridCells <= 1000000 ? new Int32Array(gridCells) : null;
  const cellRevision = gridHeads ? new Uint32Array(gridCells) : null, markedFrame = gridHeads ? new Uint32Array(gridCells) : null;
  const cacheOwner = {}; let refitFrame = 0, cacheEpoch = 0;
  let frameMotionSquared = 0, accumulatedMotion = 0;
  function movementSquared(vertex, id) {
    const x = vertex.x - p.getX(id), y = vertex.y - p.getY(id), z = vertex.z - p.getZ(id);
    return x * x + y * y + z * z;
  }
  function markChangedTriangle(t) {
    if (!gridHeads) return;
    const { a, b, c } = t;
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - gridOrigin.x - 1e-10) / cellSize)), x1 = Math.min(gridSize.x - 1, Math.floor((Math.max(a.x, b.x, c.x) - gridOrigin.x + 1e-10) / cellSize));
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - gridOrigin.y - 1e-10) / cellSize)), y1 = Math.min(gridSize.y - 1, Math.floor((Math.max(a.y, b.y, c.y) - gridOrigin.y + 1e-10) / cellSize));
    const z0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - gridOrigin.z - 1e-10) / cellSize)), z1 = Math.min(gridSize.z - 1, Math.floor((Math.max(a.z, b.z, c.z) - gridOrigin.z + 1e-10) / cellSize));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 100000) { cacheEpoch++; return; }
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cell = (z * gridSize.y + y) * gridSize.x + x;
      if (markedFrame[cell] !== refitFrame) {
        markedFrame[cell] = refitFrame; cellRevision[cell]++;
        if (cellRevision[cell] === 0) cacheEpoch++;
      }
    }
  }
  const initialLinks = gridHeads ? Math.min(1000000, Math.max(16, faces.length * 8)) : 0;
  let gridValid = false, linkCount = 0, gridLinks = new Int32Array(initialLinks), gridFaces = new Int32Array(initialLinks);
  const querySeen = new Uint32Array(faces.length); let queryStamp = 0;
  function rebuildGrid() {
    if (!gridHeads) return;
    gridHeads.fill(-1); linkCount = 0; gridValid = true;
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
      const { a, b, c } = faces[faceIndex].triangle;
      const x0 = Math.floor((Math.min(a.x, b.x, c.x) - gridOrigin.x - 1e-10) / cellSize), x1 = Math.floor((Math.max(a.x, b.x, c.x) - gridOrigin.x + 1e-10) / cellSize);
      const y0 = Math.floor((Math.min(a.y, b.y, c.y) - gridOrigin.y - 1e-10) / cellSize), y1 = Math.floor((Math.max(a.y, b.y, c.y) - gridOrigin.y + 1e-10) / cellSize);
      const z0 = Math.floor((Math.min(a.z, b.z, c.z) - gridOrigin.z - 1e-10) / cellSize), z1 = Math.floor((Math.max(a.z, b.z, c.z) - gridOrigin.z + 1e-10) / cellSize);
      if (x0 < 0 || y0 < 0 || z0 < 0 || x1 >= gridSize.x || y1 >= gridSize.y || z1 >= gridSize.z || linkCount + (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 1000000) { gridValid = false; return; }
      for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (linkCount === gridLinks.length) {
          const capacity = Math.min(1000000, gridLinks.length * 2), links = new Int32Array(capacity), ids = new Int32Array(capacity);
          links.set(gridLinks); ids.set(gridFaces); gridLinks = links; gridFaces = ids;
        }
        const cell = (z * gridSize.y + y) * gridSize.x + x;
        gridFaces[linkCount] = faceIndex; gridLinks[linkCount] = gridHeads[cell]; gridHeads[cell] = linkCount++;
      }
    }
  }
  rebuildGrid();
  const counters = { sweepCalls: 0, sweepNodes: 0, sweepTriangles: 0, nearestCalls: 0, nearestNodes: 0, nearestTriangles: 0, gridQueries: 0, gridSweeps: 0, cachedQueries: 0 };
  let surfaceRevision = 0;
  function refit(node = root) {
    if (node === root) {
      for (const key of Object.keys(counters)) counters[key] = 0;
      frameMotionSquared = 0;
      if (++refitFrame === 0xffffffff) { refitFrame = 1; markedFrame?.fill(0); cacheEpoch++; }
    }
    let changed = false;
    if (node.ids) for (const i of node.ids) {
      const face = faces[i / 3], t = face.triangle;
      const faceChanged = t.a.x !== p.getX(index[i]) || t.a.y !== p.getY(index[i]) || t.a.z !== p.getZ(index[i]) || t.b.x !== p.getX(index[i + 1]) || t.b.y !== p.getY(index[i + 1]) || t.b.z !== p.getZ(index[i + 1]) || t.c.x !== p.getX(index[i + 2]) || t.c.y !== p.getY(index[i + 2]) || t.c.z !== p.getZ(index[i + 2]);
      if (!faceChanged) continue;
      changed = true;
      if (gridHeads) {
        frameMotionSquared = Math.max(frameMotionSquared, movementSquared(t.a, index[i]), movementSquared(t.b, index[i + 1]), movementSquared(t.c, index[i + 2]));
        markChangedTriangle(t);
      }
      t.a.fromBufferAttribute(p, index[i]); t.b.fromBufferAttribute(p, index[i + 1]); t.c.fromBufferAttribute(p, index[i + 2]); t.getNormal(face.normal);
      if (gridHeads) markChangedTriangle(t);
      face.ab.subVectors(t.b, t.a); face.ac.subVectors(t.c, t.a);
    }
    else {
      const leftChanged = refit(node.left), rightChanged = refit(node.right);
      changed = leftChanged || rightChanged;
      if (changed) node.box.copy(node.left.box).union(node.right.box);
    }
    if (changed && node.ids) {
      node.box.makeEmpty();
      for (const i of node.ids) { const t = faces[i / 3].triangle; node.box.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c); }
    }
    if (node === root && changed) {
      surfaceRevision++;
      if (frameMotionSquared > 0) accumulatedMotion += Math.sqrt(frameMotionSquared) + 64 * Number.EPSILON * Math.max(1, accumulatedMotion);
      rebuildGrid();
    }
    return changed;
  }
  const ray = new THREE.Ray();
  function intersectsSegmentBox(box, maximumDistance) {
    // Expanded scalar slabs avoid per-node axis arrays and dynamic property
    // lookup; clipping math is identical for inside, parallel and negative rays.
    let near = 0, far = maximumDistance + 1e-8, enter, exit, swap;
    const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
    const dx = ray.direction.x, dy = ray.direction.y, dz = ray.direction.z;
    if (dx === 0) { if (ox < box.min.x - 1e-8 || ox > box.max.x + 1e-8) return false; }
    else {
      enter = (box.min.x - 1e-8 - ox) / dx; exit = (box.max.x + 1e-8 - ox) / dx;
      if (enter > exit) { swap = enter; enter = exit; exit = swap; }
      near = Math.max(near, enter); far = Math.min(far, exit); if (near > far) return false;
    }
    if (dy === 0) { if (oy < box.min.y - 1e-8 || oy > box.max.y + 1e-8) return false; }
    else {
      enter = (box.min.y - 1e-8 - oy) / dy; exit = (box.max.y + 1e-8 - oy) / dy;
      if (enter > exit) { swap = enter; enter = exit; exit = swap; }
      near = Math.max(near, enter); far = Math.min(far, exit); if (near > far) return false;
    }
    if (dz === 0) { if (oz < box.min.z - 1e-8 || oz > box.max.z + 1e-8) return false; }
    else {
      enter = (box.min.z - 1e-8 - oz) / dz; exit = (box.max.z + 1e-8 - oz) / dz;
      if (enter > exit) { swap = enter; enter = exit; exit = swap; }
      near = Math.max(near, enter); far = Math.min(far, exit); if (near > far) return false;
    }
    return true;
  }
  function sweep(origin, displacement) {
    if (countQueries) counters.sweepCalls++;
    let nearest = displacement.length(); if (nearest < 1e-8) return nearest;
    ray.origin.copy(origin); ray.direction.copy(displacement).normalize();
    if (gridValid && nearest <= cellSize * 2) {
      const ex = origin.x + displacement.x, ey = origin.y + displacement.y, ez = origin.z + displacement.z;
      const x0 = Math.floor((Math.min(origin.x, ex) - gridOrigin.x - 1e-8) / cellSize), x1 = Math.floor((Math.max(origin.x, ex) - gridOrigin.x + 1e-8) / cellSize);
      const y0 = Math.floor((Math.min(origin.y, ey) - gridOrigin.y - 1e-8) / cellSize), y1 = Math.floor((Math.max(origin.y, ey) - gridOrigin.y + 1e-8) / cellSize);
      const z0 = Math.floor((Math.min(origin.z, ez) - gridOrigin.z - 1e-8) / cellSize), z1 = Math.floor((Math.max(origin.z, ez) - gridOrigin.z + 1e-8) / cellSize);
      if (x0 >= 0 && y0 >= 0 && z0 >= 0 && x1 < gridSize.x && y1 < gridSize.y && z1 < gridSize.z) {
        if (++queryStamp === 0xffffffff) { querySeen.fill(0); queryStamp = 1; }
        if (countQueries) counters.gridSweeps++;
        for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          for (let link = gridHeads[(z * gridSize.y + y) * gridSize.x + x]; link !== -1; link = gridLinks[link]) {
            const id = gridFaces[link]; if (querySeen[id] === queryStamp) continue; querySeen[id] = queryStamp;
            const face = faces[id], t = face.triangle, n = face.normal;
            const startSide = (origin.x - t.a.x) * n.x + (origin.y - t.a.y) * n.y + (origin.z - t.a.z) * n.z;
            const endSide = (ex - t.a.x) * n.x + (ey - t.a.y) * n.y + (ez - t.a.z) * n.z;
            if (startSide > 1e-10 && endSide > 1e-10 || startSide < -1e-10 && endSide < -1e-10) continue;
            if (countQueries) counters.sweepTriangles++;
            if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) { const distance = hit.distanceTo(origin); if (distance > 1e-6) nearest = Math.min(nearest, distance); }
          }
        }
        return nearest;
      }
    }
    let pending = 1; sweepStack[0] = root;
    while (pending) {
      const node = sweepStack[--pending];
      if (countQueries) counters.sweepNodes++;
      if (!intersectsSegmentBox(node.box, nearest)) continue;
      if (node.ids) for (const i of node.ids) {
        if (countQueries) counters.sweepTriangles++;
        const t = faces[i / 3].triangle;
        if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) { const distance = hit.distanceTo(origin); if (distance > 1e-6) nearest = Math.min(nearest, distance); }
      } else { sweepStack[pending++] = node.right; sweepStack[pending++] = node.left; }
    }
    return nearest;
  }
  const closest = new THREE.Vector3();
  function closestOnFace(face, point) {
    // Ericson's triangle Voronoi regions, with live edge vectors cached during
    // refit. Keep the same region tests and arithmetic order as THREE.Triangle.
    const { a, b, c } = face.triangle, u = face.ab, v = face.ac;
    let x = point.x - a.x, y = point.y - a.y, z = point.z - a.z;
    const d1 = u.x * x + u.y * y + u.z * z, d2 = v.x * x + v.y * y + v.z * z;
    if (d1 <= 0 && d2 <= 0) return closest.copy(a);
    x = point.x - b.x; y = point.y - b.y; z = point.z - b.z;
    const d3 = u.x * x + u.y * y + u.z * z, d4 = v.x * x + v.y * y + v.z * z;
    if (d3 >= 0 && d4 <= d3) return closest.copy(b);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); return closest.set(a.x + u.x * t, a.y + u.y * t, a.z + u.z * t); }
    x = point.x - c.x; y = point.y - c.y; z = point.z - c.z;
    const d5 = u.x * x + u.y * y + u.z * z, d6 = v.x * x + v.y * y + v.z * z;
    if (d6 >= 0 && d5 <= d6) return closest.copy(c);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); return closest.set(a.x + v.x * t, a.y + v.y * t, a.z + v.z * t); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return closest.set(b.x + (c.x - b.x) * t, b.y + (c.y - b.y) * t, b.z + (c.z - b.z) * t); }
    const denominator = 1 / (va + vb + vc), t = vb * denominator, s = vc * denominator;
    return closest.set((a.x + u.x * t) + v.x * s, (a.y + u.y * t) + v.y * s, (a.z + u.z * t) + v.z * s);
  }
  function boxDistanceSquared(box, point) {
    const x = Math.max(box.min.x - point.x, 0, point.x - box.max.x), y = Math.max(box.min.y - point.y, 0, point.y - box.max.y), z = Math.max(box.min.z - point.z, 0, point.z - box.max.z);
    return x * x + y * y + z * z;
  }
  let lastNearestFace = -1;
  // Reuse traversal storage across synchronous queries. A recursive closure per
  // sample otherwise allocates tens of thousands of closures during a squeeze.
  const nearestStack = [], nearestBounds = [], sweepStack = [];
  function rememberQuery(siteHint, point, x0, x1, y0, y1, z0, z1, faceIndex, distance, secondSquared) {
    if (!queryCache || !siteHint) return;
    const saved = siteHint.queryResult?.owner === cacheOwner ? siteHint.queryResult : { owner: cacheOwner, cells: [], revisions: [] };
    let count = 0;
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cell = (z * gridSize.y + y) * gridSize.x + x; saved.cells[count] = cell; saved.revisions[count++] = cellRevision[cell];
    }
    saved.cells.length = saved.revisions.length = count;
    const normal = faces[faceIndex].normal;
    saved.epoch = cacheEpoch; saved.motion = accumulatedMotion; saved.x = point.x; saved.y = point.y; saved.z = point.z;
    saved.faceIndex = faceIndex; saved.distance = distance; saved.nx = normal.x; saved.ny = normal.y; saved.nz = normal.z;
    // Every unvisited triangle lies outside this complete cell cube. The
    // nearest/runner-up distance gap certifies a small neighborhood in which
    // the same face remains nearest (both distances are 1-Lipschitz).
    const outsideBound = Math.min(point.x - gridOrigin.x - x0 * cellSize, gridOrigin.x + (x1 + 1) * cellSize - point.x, point.y - gridOrigin.y - y0 * cellSize, gridOrigin.y + (y1 + 1) * cellSize - point.y, point.z - gridOrigin.z - z0 * cellSize, gridOrigin.z + (z1 + 1) * cellSize - point.z);
    saved.movementRadius = Math.max(0, (Math.min(Math.sqrt(secondSquared), outsideBound) - Math.abs(distance)) * .5 - 1e-10);
    siteHint.queryResult = saved;
  }
  function signedDistance(point, outwardNormal, sourceFace = lastNearestFace) {
    if (countQueries) counters.nearestCalls++;
    const siteHint = typeof sourceFace === 'object' && sourceFace !== null ? sourceFace : null;
    const previous = siteHint?.queryResult;
    // A nearest-face certificate survives either an unchanged local region, or
    // a conservatively bounded motion of the complete core and query point.
    let reusable = false;
    if (queryCache && gridValid && previous?.owner === cacheOwner && previous.epoch === cacheEpoch) {
      const deltaSquared = (point.x - previous.x) ** 2 + (point.y - previous.y) ** 2 + (point.z - previous.z) ** 2;
      const allowance = previous.movementRadius - (accumulatedMotion - previous.motion) - 64 * Number.EPSILON * Math.max(1, accumulatedMotion);
      reusable = allowance > 0 && deltaSquared < allowance * allowance;
      if (!reusable && (deltaSquared === 0 || deltaSquared < previous.movementRadius ** 2)) {
        reusable = true;
        for (let i = 0; i < previous.cells.length; i++) if (cellRevision[previous.cells[i]] !== previous.revisions[i]) { reusable = false; break; }
      }
    }
    if (reusable) {
      if (countQueries) counters.cachedQueries++;
      lastNearestFace = previous.faceIndex; siteHint.faceIndex = previous.faceIndex;
      const face = faces[previous.faceIndex]; closestOnFace(face, point);
      outwardNormal?.copy(face.normal);
      const distance = closest.distanceTo(point), signed = (point.x - closest.x) * face.normal.x + (point.y - closest.y) * face.normal.y + (point.z - closest.z) * face.normal.z < 0 ? -1 : 1;
      return signed * distance;
    }
    sourceFace = siteHint ? siteHint.faceIndex ?? lastNearestFace : sourceFace;
    let distanceSquared = Infinity, sign = 1;
    // A previously nearest (or known support) triangle is only a search hint.
    // Re-evaluate its *current refitted coordinates* for a finite upper bound;
    // the complete conservative BVH search still chooses the true nearest face.
    let initialBound = Infinity;
    if (faces[sourceFace]) { closestOnFace(faces[sourceFace], point); const candidate = closest.distanceToSquared(point); initialBound = candidate + 32 * Number.EPSILON * Math.max(1, candidate); }
    const radius = Math.sqrt(initialBound) + 1e-9;
    if (gridValid && radius <= cellSize * 1.5) {
      const x0 = Math.floor((point.x - radius - gridOrigin.x) / cellSize), x1 = Math.floor((point.x + radius - gridOrigin.x) / cellSize);
      const y0 = Math.floor((point.y - radius - gridOrigin.y) / cellSize), y1 = Math.floor((point.y + radius - gridOrigin.y) / cellSize);
      const z0 = Math.floor((point.z - radius - gridOrigin.z) / cellSize), z1 = Math.floor((point.z + radius - gridOrigin.z) / cellSize);
      if (x0 >= 0 && y0 >= 0 && z0 >= 0 && x1 < gridSize.x && y1 < gridSize.y && z1 < gridSize.z) {
        if (++queryStamp === 0xffffffff) { querySeen.fill(0); queryStamp = 1; }
        let secondSquared = Infinity, nearestFace = -1;
        for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          for (let link = gridHeads[(z * gridSize.y + y) * gridSize.x + x]; link !== -1; link = gridLinks[link]) {
            const id = gridFaces[link]; if (querySeen[id] === queryStamp) continue; querySeen[id] = queryStamp;
            if (countQueries) counters.nearestTriangles++;
            const face = faces[id]; closestOnFace(face, point); const d = closest.distanceToSquared(point);
            if (d < distanceSquared) {
              secondSquared = distanceSquared; distanceSquared = d; nearestFace = id; outwardNormal?.copy(face.normal);
              sign = (point.x - closest.x) * face.normal.x + (point.y - closest.y) * face.normal.y + (point.z - closest.z) * face.normal.z < 0 ? -1 : 1;
            } else secondSquared = Math.min(secondSquared, d);
          }
        }
        if (Number.isFinite(distanceSquared) && secondSquared - distanceSquared > 64 * Number.EPSILON * Math.max(1, distanceSquared)) {
          if (countQueries) counters.gridQueries++;
          lastNearestFace = nearestFace; if (siteHint) siteHint.faceIndex = nearestFace;
          const distance = sign * Math.sqrt(distanceSquared);
          rememberQuery(siteHint, point, x0, x1, y0, y1, z0, z1, nearestFace, distance, secondSquared);
          return distance;
        }
        distanceSquared = Infinity; sign = 1;
      }
    }
    let pending = 1; nearestStack[0] = root; nearestBounds[0] = boxDistanceSquared(root.box, point);
    while (pending) {
      const node = nearestStack[--pending], lowerBound = nearestBounds[pending];
      if (countQueries) counters.nearestNodes++;
      if (lowerBound > Math.min(distanceSquared, initialBound)) continue;
      if (node.ids) for (const i of node.ids) {
        if (countQueries) counters.nearestTriangles++;
        const face = faces[i / 3];
        closestOnFace(face, point); const d = closest.distanceToSquared(point);
        if (d < distanceSquared) { distanceSquared = d; lastNearestFace = i / 3; outwardNormal?.copy(face.normal); sign = (point.x - closest.x) * face.normal.x + (point.y - closest.y) * face.normal.y + (point.z - closest.z) * face.normal.z < 0 ? -1 : 1; }
      } else {
        // The first nearby hit prunes far branches. The nearest surface and
        // signed-distance calculation stay exact against the same triangles.
        const leftBound = boxDistanceSquared(node.left.box, point), rightBound = boxDistanceSquared(node.right.box, point);
        if (leftBound <= rightBound) {
          nearestBounds[pending] = rightBound; nearestStack[pending++] = node.right;
          nearestBounds[pending] = leftBound; nearestStack[pending++] = node.left;
        } else {
          nearestBounds[pending] = leftBound; nearestStack[pending++] = node.left;
          nearestBounds[pending] = rightBound; nearestStack[pending++] = node.right;
        }
      }
    }
    // Equal-distance face selection can depend on BVH traversal order; those
    // answers are never cached across refits.
    if (siteHint) { siteHint.faceIndex = lastNearestFace; siteHint.queryResult = undefined; }
    return sign * Math.sqrt(distanceSquared);
  }
  return { refit, sweep, signedDistance, getLastNearestFace: () => lastNearestFace, getSurfaceRevision: () => surfaceRevision, getQueryCounters: (enable = false) => { if (enable) countQueries = true; return { enabled: countQueries, ...counters }; }, intersectsBox: box => root.box.intersectsBox(box) };
}

export const smallThinWaxParameters = Object.freeze({ ...thinWaxParameters, seedCount: 260, maxFragments: 280, maxLocalFragments: 280 });
export function createThinWax(options = {}) { return createVoronoiWax(options, options.fragmentSize === 'small' ? smallThinWaxParameters : thinWaxParameters, createWaxCollisionTree); }
