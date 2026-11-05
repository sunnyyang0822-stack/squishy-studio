import { createVoronoiWax } from './thin-wax-panels.mjs';
import * as THREE from 'three';
import { createWaxFeatureNormals } from './thin-wax-feature-normals.mjs';

export const thinWaxParameters = Object.freeze({ thickness: .014, gap: .004, dwell: .5, localRadius: .16, chainDuration: .063, visibleDeformation: .004, extraFractureDelay: .06, extraFractureStrain: .015, maxLocalFragments: 180, maxFragments: 180, maxLivingFragments: 24 });

// A refitted triangle BVH, used for segment sweeps against the actual deformed
// mesh. No sphere/radial proxy is used, including inside a torus hole.
export function createWaxCollisionTree(geometry, { leafSize = 4, nearestGrid = false, motionTracking = false, queryCache = true, featureNormals = false, lazyFeatureNormals = true, exactGridTies = true, trackChanges = false, trackRelativeMotion = false, restPositions, featureTieConsensus = false, performanceOptimizations = false } = {}) {
  let countQueries = false;
  const p = geometry.attributes.position, index = geometry.index.array;
  const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), hit = a.clone();
  // Read the live mesh once per refit, rather than nine attribute reads for
  // every triangle visited by every fragment sample during this frame.
  const faces = Array.from({ length: index.length / 3 }, (_, face) => {
    const i = face * 3, triangle = new THREE.Triangle(new THREE.Vector3().fromBufferAttribute(p, index[i]), new THREE.Vector3().fromBufferAttribute(p, index[i + 1]), new THREE.Vector3().fromBufferAttribute(p, index[i + 2]));
    const {a,b,c}=triangle;
    return { triangle, ab: new THREE.Vector3().subVectors(triangle.b, triangle.a), ac: new THREE.Vector3().subVectors(triangle.c, triangle.a), normal: triangle.getNormal(new THREE.Vector3()), minX:Math.min(a.x,b.x,c.x),maxX:Math.max(a.x,b.x,c.x),minY:Math.min(a.y,b.y,c.y),maxY:Math.max(a.y,b.y,c.y),minZ:Math.min(a.z,b.z,c.z),maxZ:Math.max(a.z,b.z,c.z), ...(trackRelativeMotion ? { delta: new Float64Array(9), changed: false } : {}) };
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
  function prepareMotion(node) {
    node.sweptBox = node.box.clone(); node.changed = false;
    if (!node.ids) { prepareMotion(node.left); prepareMotion(node.right); }
  }
  if (trackRelativeMotion) prepareMotion(root);
  // Resolve grid ties with precisely the same near-child-first order as the
  // BVH. At the first differing ancestor, its live child-box distances choose
  // the earlier leaf; within one leaf retain the original triangle order.
  // This avoids traversing the whole BVH again for a shared edge/vertex.
  const facePaths = exactGridTies && featureNormals && nearestGrid ? new Array(faces.length) : null;
  function indexPaths(node, path = []) {
    if (node.ids) for (let order = 0; order < node.ids.length; order++) facePaths[node.ids[order] / 3] = { path, order };
    else { indexPaths(node.left, [...path, node.left]); indexPaths(node.right, [...path, node.right]); }
  }
  if (facePaths) indexPaths(root);
  function visitsBefore(first, second, point) {
    const a = facePaths[first], b = facePaths[second];
    for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) if (a.path[i] !== b.path[i]) {
      const parent = i ? a.path[i - 1] : root;
      const leftFirst = boxDistanceSquared(parent.left.box, point) <= boxDistanceSquared(parent.right.box, point);
      return a.path[i] === (leftFirst ? parent.left : parent.right);
    }
    return a.order < b.order;
  }
  const features = featureNormals ? createWaxFeatureNormals(geometry, restPositions, { lazy: lazyFeatureNormals }) : null;
  features?.refit(faces);
  // Optional exact local-query broad phase for densely tessellated concave
  // surfaces. Each live triangle occupies every cell touched by its AABB.
  // Large/out-of-grid queries and legacy face-normal ties use the BVH.
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
  let gridPrevious = new Int32Array(initialLinks), faceNext = new Int32Array(initialLinks), linkCells = new Int32Array(initialLinks), freeLink = -1;
  const faceFirst = new Int32Array(faces.length).fill(-1), changedFaces = [];
  const querySeen = new Uint32Array(faces.length); let queryStamp = 0;
  // Queries are synchronous. Reuse scratch storage instead of allocating one
  // tuple per tied face and two Vector3s per edge/vertex query.
  const tieIds = new Int32Array(faces.length), tieDistances = new Float64Array(faces.length);
  const selectedPoint = new THREE.Vector3(), selectedNormal = new THREE.Vector3();
  function rebuildGridLegacy() {
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
  function rebuildGrid() {
    if(!performanceOptimizations)return rebuildGridLegacy();
    if (!gridHeads) return;
    const complete = !gridValid;
    if (complete) { gridHeads.fill(-1); faceFirst.fill(-1); linkCount = 0; freeLink = -1; }
    gridValid = true;
    const count = complete ? faces.length : changedFaces.length;
    for (let item = 0; item < count; item++) {
      const faceIndex = complete ? item : changedFaces[item], face = faces[faceIndex];
      const { a, b, c } = face.triangle;
      const x0 = Math.floor((Math.min(a.x, b.x, c.x) - gridOrigin.x - 1e-10) / cellSize), x1 = Math.floor((Math.max(a.x, b.x, c.x) - gridOrigin.x + 1e-10) / cellSize);
      const y0 = Math.floor((Math.min(a.y, b.y, c.y) - gridOrigin.y - 1e-10) / cellSize), y1 = Math.floor((Math.max(a.y, b.y, c.y) - gridOrigin.y + 1e-10) / cellSize);
      const z0 = Math.floor((Math.min(a.z, b.z, c.z) - gridOrigin.z - 1e-10) / cellSize), z1 = Math.floor((Math.max(a.z, b.z, c.z) - gridOrigin.z + 1e-10) / cellSize);
      if (x0 < 0 || y0 < 0 || z0 < 0 || x1 >= gridSize.x || y1 >= gridSize.y || z1 >= gridSize.z) { gridValid = false; return; }
      if (!complete && face.gx0===x0 && face.gx1===x1 && face.gy0===y0 && face.gy1===y1 && face.gz0===z0 && face.gz1===z1) continue;
      for(let link=faceFirst[faceIndex];link!==-1;){const next=faceNext[link],previous=gridPrevious[link],following=gridLinks[link];if(previous===-1)gridHeads[linkCells[link]]=following;else gridLinks[previous]=following;if(following!==-1)gridPrevious[following]=previous;faceNext[link]=freeLink;freeLink=link;link=next;}
      faceFirst[faceIndex]=-1;
      face.gx0=x0;face.gx1=x1;face.gy0=y0;face.gy1=y1;face.gz0=z0;face.gz1=z1;
      for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (freeLink===-1 && linkCount===1000000) { gridValid=false;return; }
        if (freeLink===-1 && linkCount === gridLinks.length) {
          const capacity = Math.min(1000000, gridLinks.length * 2), links = new Int32Array(capacity), ids = new Int32Array(capacity);
          links.set(gridLinks); ids.set(gridFaces); gridLinks = links; gridFaces = ids;
          const previous=new Int32Array(capacity),next=new Int32Array(capacity),cells=new Int32Array(capacity);previous.set(gridPrevious);next.set(faceNext);cells.set(linkCells);gridPrevious=previous;faceNext=next;linkCells=cells;
        }
        const cell = (z * gridSize.y + y) * gridSize.x + x, link=freeLink===-1?linkCount++:freeLink;
        if(freeLink!==-1)freeLink=faceNext[link];
        const head=gridHeads[cell];gridFaces[link]=faceIndex;gridLinks[link]=head;gridPrevious[link]=-1;linkCells[link]=cell;if(head!==-1)gridPrevious[head]=link;gridHeads[cell]=link;faceNext[link]=faceFirst[faceIndex];faceFirst[faceIndex]=link;
      }
    }
  }
  rebuildGrid();
  const counters = { sweepCalls: 0, sweepNodes: 0, sweepTriangles: 0, nearestCalls: 0, nearestNodes: 0, nearestTriangles: 0, gridQueries: 0, gridSweeps: 0, cachedQueries: 0 };
  let surfaceRevision = 0;
  const previousPositions = p.array.slice(), changedVertices = new Uint8Array(p.count);
  const changedBounds = new THREE.Box3();
  const changedLeafBounds = [];
  function refit(node = root) {
    if (trackRelativeMotion) node.sweptBox.copy(node.box);
    if (node === root) {
      changedBounds.makeEmpty();
      changedLeafBounds.length = 0;
      changedFaces.length = 0;
      for (const key of Object.keys(counters)) counters[key] = 0;
      frameMotionSquared = 0;
      const live = p.array;
      for (let v = 0; v < p.count; v++) {
        const i = v * 3, dx = previousPositions[i] - live[i], dy = previousPositions[i + 1] - live[i + 1], dz = previousPositions[i + 2] - live[i + 2];
        changedVertices[v] = dx !== 0 || dy !== 0 || dz !== 0 ? 1 : 0;
        frameMotionSquared = Math.max(frameMotionSquared, dx * dx + dy * dy + dz * dz);
      }
      previousPositions.set(live);
      if (++refitFrame === 0xffffffff) { refitFrame = 1; markedFrame?.fill(0); cacheEpoch++; }
    }
    let changed = false;
    if (node.ids) for (const i of node.ids) {
      const face = faces[i / 3], t = face.triangle;
      const faceChanged = changedVertices[index[i]] || changedVertices[index[i + 1]] || changedVertices[index[i + 2]];
      if (trackRelativeMotion) {
        face.changed = faceChanged;
        const delta = face.delta ||= new Float64Array(9);
        delta[0] = p.getX(index[i]) - t.a.x; delta[1] = p.getY(index[i]) - t.a.y; delta[2] = p.getZ(index[i]) - t.a.z;
        delta[3] = p.getX(index[i + 1]) - t.b.x; delta[4] = p.getY(index[i + 1]) - t.b.y; delta[5] = p.getZ(index[i + 1]) - t.b.z;
        delta[6] = p.getX(index[i + 2]) - t.c.x; delta[7] = p.getY(index[i + 2]) - t.c.y; delta[8] = p.getZ(index[i + 2]) - t.c.z;
      }
      if (!faceChanged) continue;
      changedFaces.push(i/3);
      if (!changed) { changedBounds.union(node.box); node.oldBox ||= new THREE.Box3(); node.oldBox.copy(node.box); changedLeafBounds.push(node.oldBox); }
      changed = true;
      if (changedBounds) changedBounds.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
      if (gridHeads || motionTracking) frameMotionSquared = Math.max(frameMotionSquared, movementSquared(t.a, index[i]), movementSquared(t.b, index[i + 1]), movementSquared(t.c, index[i + 2]));
      if (gridHeads) markChangedTriangle(t);
      t.a.fromBufferAttribute(p, index[i]); t.b.fromBufferAttribute(p, index[i + 1]); t.c.fromBufferAttribute(p, index[i + 2]); t.getNormal(face.normal);
      if (changedBounds) changedBounds.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
      if (gridHeads) markChangedTriangle(t);
      face.ab.subVectors(t.b, t.a); face.ac.subVectors(t.c, t.a);
      face.minX=Math.min(t.a.x,t.b.x,t.c.x);face.maxX=Math.max(t.a.x,t.b.x,t.c.x);face.minY=Math.min(t.a.y,t.b.y,t.c.y);face.maxY=Math.max(t.a.y,t.b.y,t.c.y);face.minZ=Math.min(t.a.z,t.b.z,t.c.z);face.maxZ=Math.max(t.a.z,t.b.z,t.c.z);
    }
    else {
      const leftChanged = refit(node.left), rightChanged = refit(node.right);
      changed = leftChanged || rightChanged;
      if (changed) node.box.copy(node.left.box).union(node.right.box);
    }
    if (changed && node.ids) {
      node.box.makeEmpty();
      for (const i of node.ids) { const t = faces[i / 3].triangle; node.box.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c); }
      changedBounds.union(node.box);
      changedLeafBounds.push(node.box);
    }
    if (trackRelativeMotion) { node.changed = changed; node.sweptBox.union(node.box); }
    if (node === root && changed) {
      surfaceRevision++;
      features?.refit(faces);
      if (frameMotionSquared > 0) accumulatedMotion += Math.sqrt(frameMotionSquared) + 64 * Number.EPSILON * Math.max(1, accumulatedMotion);
      rebuildGrid();
    }
    return changed;
  }
  const ray = new THREE.Ray();
  const motionStack = [];
  function relativeMotionInRegion(box, translation) {
    if (!trackRelativeMotion) return Infinity;
    let maximum = 0, pending = 1; motionStack[0] = root;
    while (pending) {
      const node = motionStack[--pending];
      if (!node.sweptBox.intersectsBox(box)) continue;
      if (!node.changed) { maximum = Math.max(maximum, translation.lengthSq()); continue; }
      if (node.ids) for (const i of node.ids) {
        const delta = faces[i / 3].delta;
        for (let k = 0; k < 9; k += 3) {
          const x = delta[k] - translation.x, y = delta[k + 1] - translation.y, z = delta[k + 2] - translation.z;
          maximum = Math.max(maximum, x * x + y * y + z * z);
        }
      } else { motionStack[pending++] = node.left; motionStack[pending++] = node.right; }
    }
    return Math.sqrt(maximum) + 1e-10;
  }
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
  function faceBound(face,p){const x=p.x<face.minX?face.minX-p.x:p.x>face.maxX?p.x-face.maxX:0,y=p.y<face.minY?face.minY-p.y:p.y>face.maxY?p.y-face.maxY:0,z=p.z<face.minZ?face.minZ-p.z:p.z>face.maxZ?p.z-face.maxZ:0;return x*x+y*y+z*z;}
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
  const featureNormal = new THREE.Vector3();
  function featureResult(point, outwardNormal, faceIndex) {
    const face = faces[faceIndex]; closestOnFace(face, point);
    features.normalAt(faceIndex, face, closest, featureNormal); outwardNormal?.copy(featureNormal);
    const sign = (point.x - closest.x) * featureNormal.x + (point.y - closest.y) * featureNormal.y + (point.z - closest.z) * featureNormal.z < 0 ? -1 : 1;
    return sign * closest.distanceTo(point);
  }
  function rememberQuery(siteHint, point, x0, x1, y0, y1, z0, z1, faceIndex, distance, secondSquared) {
    if (!queryCache || !siteHint) return;
    const saved = siteHint.queryResult?.owner === cacheOwner ? siteHint.queryResult : { owner: cacheOwner, cells: [], revisions: [] };
    let count = 0;
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cell = (z * gridSize.y + y) * gridSize.x + x; saved.cells[count] = cell; saved.revisions[count++] = cellRevision[cell];
    }
    saved.cells.length = saved.revisions.length = count;
    const normal = features ? featureNormal : faces[faceIndex].normal;
    saved.epoch = cacheEpoch; saved.motion = accumulatedMotion; saved.x = point.x; saved.y = point.y; saved.z = point.z;
    saved.faceIndex = faceIndex; saved.distance = distance; saved.nx = normal.x; saved.ny = normal.y; saved.nz = normal.z;
    // Every unvisited triangle lies outside this complete cell cube. The
    // nearest/runner-up distance gap certifies a small neighborhood in which
    // the same face remains nearest (both distances are 1-Lipschitz).
    const outsideBound = Math.min(point.x - gridOrigin.x - x0 * cellSize, gridOrigin.x + (x1 + 1) * cellSize - point.x, point.y - gridOrigin.y - y0 * cellSize, gridOrigin.y + (y1 + 1) * cellSize - point.y, point.z - gridOrigin.z - z0 * cellSize, gridOrigin.z + (z1 + 1) * cellSize - point.z);
    saved.positiveRadius = Math.max(0, Math.min(distance, outsideBound) - 1e-10);
    saved.movementRadius = Math.max(0, (Math.min(Math.sqrt(secondSquared), outsideBound) - Math.abs(distance)) * .5 - 1e-10);
    siteHint.queryResult = saved;
  }
  function signedDistance(point, outwardNormal, sourceFace = lastNearestFace, clearanceThreshold = Infinity) {
    if (performanceOptimizations && Number.isFinite(clearanceThreshold)) {
      const bound = boxDistanceSquared(root.box, point);
      if (bound > (clearanceThreshold + 1e-10) ** 2) return Math.sqrt(bound) - 1e-10;
    }
    if (countQueries) counters.nearestCalls++;
    const siteHint = typeof sourceFace === 'object' && sourceFace !== null ? sourceFace : null;
    const previous = siteHint?.queryResult;
    // For clearance-only callers, a positive ball in an unchanged COMPLETE
    // cell region remains safe even when the nearest feature has tied faces.
    // A moving face entering that region invalidates its cell revisions.
    if (performanceOptimizations && features && Number.isFinite(clearanceThreshold) && queryCache && gridValid && previous?.owner === cacheOwner && previous.epoch === cacheEpoch) {
      const allowance = previous.positiveRadius - clearanceThreshold - 1e-10;
      const dx = point.x - previous.x, dy = point.y - previous.y, dz = point.z - previous.z;
      const deltaSquared = dx * dx + dy * dy + dz * dz;
      if (allowance > 0 && deltaSquared < allowance * allowance) {
        let unchanged = true;
        for (let i = 0; i < previous.cells.length; i++) if (cellRevision[previous.cells[i]] !== previous.revisions[i]) { unchanged = false; break; }
        if (unchanged) {
          if (countQueries) counters.cachedQueries++;
          lastNearestFace = previous.faceIndex; siteHint.faceIndex = previous.faceIndex;
          return previous.positiveRadius - Math.sqrt(deltaSquared);
        }
      }
    }
    if (features && queryCache && gridValid && previous?.owner === cacheOwner && previous.epoch === cacheEpoch && previous.x === point.x && previous.y === point.y && previous.z === point.z) {
      let unchanged = true;
      for (let i = 0; i < previous.cells.length; i++) if (cellRevision[previous.cells[i]] !== previous.revisions[i]) { unchanged = false; break; }
      if (unchanged) {
        if (countQueries) counters.cachedQueries++;
        lastNearestFace = previous.faceIndex; siteHint.faceIndex = previous.faceIndex;
        outwardNormal?.set(previous.nx, previous.ny, previous.nz); return previous.distance;
      }
    }
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
      if (features) return featureResult(point, outwardNormal, lastNearestFace);
      const face = faces[previous.faceIndex]; closestOnFace(face, point);
      outwardNormal?.copy(face.normal);
      const distance = closest.distanceTo(point), signed = (point.x - closest.x) * face.normal.x + (point.y - closest.y) * face.normal.y + (point.z - closest.z) * face.normal.z < 0 ? -1 : 1;
      return signed * distance;
    }
    sourceFace = siteHint ? siteHint.faceIndex ?? lastNearestFace : sourceFace;
    let distanceSquared = Infinity, sign = 1, featureTieRegion;
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
        let secondSquared = performanceOptimizations ? initialBound : Infinity, nearestFace = -1;
        const ties = featureTieConsensus && features; let tieCount = 0;
        for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          for (let link = gridHeads[(z * gridSize.y + y) * gridSize.x + x]; link !== -1; link = gridLinks[link]) {
            const id = gridFaces[link]; if (querySeen[id] === queryStamp) continue; querySeen[id] = queryStamp;
            const face = faces[id]; if(performanceOptimizations && faceBound(face,point)>Math.min(secondSquared,initialBound))continue;
            if (countQueries) counters.nearestTriangles++;
            closestOnFace(face, point); const d = closest.distanceToSquared(point);
            const tieTolerance = 64 * Number.EPSILON * Math.max(1, d);
            if (ties && d <= distanceSquared + tieTolerance) {
              if (d < distanceSquared - tieTolerance) tieCount = 0;
              tieIds[tieCount] = id; tieDistances[tieCount++] = d;
            }
            if (d < distanceSquared) {
              secondSquared = performanceOptimizations ? Math.min(secondSquared, distanceSquared) : distanceSquared; distanceSquared = d; nearestFace = id; outwardNormal?.copy(face.normal);
              sign = (point.x - closest.x) * face.normal.x + (point.y - closest.y) * face.normal.y + (point.z - closest.z) * face.normal.z < 0 ? -1 : 1;
            } else {
              secondSquared = Math.min(secondSquared, d);
              if (facePaths && d === distanceSquared && visitsBefore(id, nearestFace, point)) nearestFace = id;
            }
          }
        }
        if (Number.isFinite(distanceSquared) && (features && facePaths || secondSquared - distanceSquared > 64 * Number.EPSILON * Math.max(1, distanceSquared))) {
          if (countQueries) counters.gridQueries++;
          lastNearestFace = nearestFace; if (siteHint) siteHint.faceIndex = nearestFace;
          const distance = features ? featureResult(point, outwardNormal, nearestFace) : sign * Math.sqrt(distanceSquared);
          rememberQuery(siteHint, point, x0, x1, y0, y1, z0, z1, nearestFace, distance, secondSquared);
          return distance;
        }
        // Incident faces can identify the same closest edge/vertex. Accept a
        // grid tie only when every tied face agrees on point, feature normal,
        // sign and distance; ambiguous folds still take the original full BVH.
        if (ties && Number.isFinite(distanceSquared)) {
          const distance = featureResult(point, outwardNormal, nearestFace); selectedPoint.copy(closest); selectedNormal.copy(featureNormal);
          let agrees = true, safelyPositive = distance > clearanceThreshold + 1e-10;
          for (let tie = 0; tie < tieCount; tie++) if (tieDistances[tie] - distanceSquared <= 64 * Number.EPSILON * Math.max(1, distanceSquared)) {
            const id = tieIds[tie];
            const alternative = featureResult(point, undefined, id);
            if (alternative <= clearanceThreshold + 1e-10) safelyPositive = false;
            if (Math.abs(alternative - distance) > 1e-12 || selectedPoint.distanceToSquared(closest) > 1e-24 || selectedNormal.distanceToSquared(featureNormal) > 1e-24) agrees = false;
          }
          if (!agrees && safelyPositive) {
            const safeDistance = Math.sqrt(distanceSquared) - 1e-10;
            lastNearestFace = nearestFace; if (siteHint) siteHint.faceIndex = nearestFace;
            featureNormal.copy(selectedNormal); outwardNormal?.copy(selectedNormal);
            rememberQuery(siteHint, point, x0, x1, y0, y1, z0, z1, nearestFace, safeDistance, distanceSquared);
            return safeDistance;
          }
          if (agrees) {
            if (countQueries) counters.gridQueries++;
            lastNearestFace = nearestFace; if (siteHint) siteHint.faceIndex = nearestFace;
            featureNormal.copy(selectedNormal); outwardNormal?.copy(selectedNormal);
            rememberQuery(siteHint, point, x0, x1, y0, y1, z0, z1, nearestFace, distance, distanceSquared);
            return distance;
          }
        }
        // Keep BVH's exact tie selection. Closed-surface feature results may
        // still reuse that *exact point* while the complete region is unchanged;
        // no nearest-face motion radius is claimed for an equidistant feature.
        if (features && Number.isFinite(distanceSquared)) featureTieRegion = [x0, x1, y0, y1, z0, z1];
        distanceSquared = Infinity; sign = 1;
      }
    }
    let pending = 1; nearestStack[0] = root; nearestBounds[0] = boxDistanceSquared(root.box, point);
    while (pending) {
      const node = nearestStack[--pending], lowerBound = nearestBounds[pending];
      if (countQueries) counters.nearestNodes++;
      if (lowerBound > Math.min(distanceSquared, initialBound)) continue;
      if (node.ids) for (const i of node.ids) {
        const face = faces[i / 3];
        if (countQueries) counters.nearestTriangles++;
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
    const distance = features ? featureResult(point, outwardNormal, lastNearestFace) : sign * Math.sqrt(distanceSquared);
    if (featureTieRegion) rememberQuery(siteHint, point, ...featureTieRegion, lastNearestFace, distance, distanceSquared);
    return distance;
  }
  return { refit, sweep, signedDistance, relativeMotionInRegion, getRefitFrame: () => refitFrame, intersectsChanges: box => !trackChanges || changedBounds.intersectsBox(box), clearanceDistance: performanceOptimizations ? (point, normal, hint, threshold) => signedDistance(point, normal, hint, threshold) : undefined, changedNearBox: performanceOptimizations ? box => changedBounds.intersectsBox(box) && changedLeafBounds.some(changed => changed.intersectsBox(box)) : undefined, getMotionBound: () => gridHeads || motionTracking ? accumulatedMotion : undefined, getLastNearestFace: () => lastNearestFace, getSurfaceTopology: () => features?.topology, getSurfaceRevision: () => surfaceRevision, getQueryCounters: (enable = false) => { if (enable) countQueries = true; return { enabled: countQueries, ...counters }; }, intersectsBox: box => root.box.intersectsBox(box) };
}

export const smallThinWaxParameters = Object.freeze({ ...thinWaxParameters, seedCount: 260, maxFragments: 280, maxLocalFragments: 280 });
export function createWaxShell(options, parameters) { return createVoronoiWax(options, parameters, createWaxCollisionTree); }
export function createThinWax(options = {}, parameters = options.fragmentSize === 'small' ? smallThinWaxParameters : thinWaxParameters) { return createWaxShell(options, parameters); }
