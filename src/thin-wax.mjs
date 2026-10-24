import * as THREE from 'three';

export const thinWaxParameters = Object.freeze({ thickness: .008, gap: .004, dwell: 1, localRadius: .16, fragmentInterval: .42, maxFragments: 24, lifetime: 3 });

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
    if (node.ids) for (const i of node.ids) node.box.union(triangleBox(i));
    else { refit(node.left); refit(node.right); node.box.union(node.left.box).union(node.right.box); }
  }
  const ray = new THREE.Ray();
  function sweep(origin, displacement) {
    let nearest = displacement.length(); if (nearest < 1e-8) return nearest;
    ray.set(origin, displacement.clone().normalize());
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
  function signedDistance(point) {
    let distance = Infinity, signed = Infinity;
    function visit(node) {
      if (node.box.distanceToPoint(point) > distance) return;
      if (node.ids) for (const i of node.ids) {
        triangle.set(a.fromBufferAttribute(p, index[i]), b.fromBufferAttribute(p, index[i + 1]), c.fromBufferAttribute(p, index[i + 2]));
        triangle.closestPointToPoint(point, closest); const d = closest.distanceTo(point);
        if (d < distance) { distance = d; triangle.getNormal(faceNormal); signed = point.clone().sub(closest).dot(faceNormal) < 0 ? -d : d; }
      } else { visit(node.left); visit(node.right); }
    }
    visit(root); return signed;
  }
  return { refit, sweep, signedDistance };
}

export function createThinWax({ geometry, color = '#eed3af', clock = () => performance.now() / 1000, reducedMotion = false } = {}) {
  if (!geometry?.index || !geometry.attributes.normal) throw new TypeError('Thin wax requires an indexed surface with normals');
  const config = thinWaxParameters, source = geometry.attributes.position, normals = geometry.attributes.normal, indices = geometry.index.array;
  const rest = source.array.slice(), patches = [], faceCount = indices.length / 3;
  const faceCenters = [], faceNormals = [], adjacency = Array.from({ length: faceCount }, () => []), edges = new Map();
  const v = new THREE.Vector3(), w = v.clone(), u = v.clone();
  for (let f = 0; f < faceCount; f++) {
    const ids = Array.from(indices.slice(f * 3, f * 3 + 3));
    v.fromBufferAttribute(source, ids[0]); w.fromBufferAttribute(source, ids[1]); u.fromBufferAttribute(source, ids[2]);
    faceCenters.push(v.clone().add(w).add(u).multiplyScalar(1 / 3)); faceNormals.push(w.sub(v).cross(u.sub(v)).normalize());
    for (let k = 0; k < 3; k++) {
      const x = ids[k], y = ids[(k + 1) % 3], key = x < y ? `${x}:${y}` : `${y}:${x}`;
      if (edges.has(key)) { const other = edges.get(key); adjacency[f].push(other); adjacency[other].push(f); } else edges.set(key, f);
    }
  }
  // Connected, locally near-planar chunks, never spatially bucketed across holes.
  const assigned = new Uint8Array(faceCount);
  for (let seed = 0; seed < faceCount; seed++) if (!assigned[seed]) {
    const faces = [], queue = [seed]; assigned[seed] = 1;
    while (queue.length) {
      const f = queue.pop(); faces.push(f);
      for (const n of adjacency[f]) if (!assigned[n] && faceCenters[n].distanceTo(faceCenters[seed]) < .09 && faceNormals[n].dot(faceNormals[seed]) > .65) { assigned[n] = 1; queue.push(n); }
    }
    const vertices = [...new Set(faces.flatMap(f => Array.from(indices.slice(f * 3, f * 3 + 3))))];
    const contactCenter = new THREE.Vector3(); for (const id of vertices) contactCenter.add(new THREE.Vector3().fromArray(rest, id * 3)); contactCenter.multiplyScalar(1 / vertices.length);
    patches.push({ faces, vertices, center: contactCenter, cracked: false, detached: false, dead: false, born: 0, offset: new THREE.Vector3(), outward: faceNormals[seed].clone() });
  }
  const records = [], outputIndices = [];
  for (const patch of patches) {
    patch.start = records.length; const local = new Map(); patch.local = local;
    for (const id of patch.vertices) { local.set(id, records.length); records.push({ id, layer: 0, patch }, { id, layer: 1, patch }); }
    const boundary = new Map();
    for (const f of patch.faces) {
      const ids = Array.from(indices.slice(f * 3, f * 3 + 3)), [a, b, c] = ids.map(id => local.get(id));
      outputIndices.push(a + 1, b + 1, c + 1, c, b, a);
      for (let k = 0; k < 3; k++) { const x = ids[k], y = ids[(k + 1) % 3], key = x < y ? `${x}:${y}` : `${y}:${x}`; if (boundary.has(key)) boundary.delete(key); else boundary.set(key, [x, y]); }
    }
    // Boundary walls own their vertices. Sharing them with the outer surface
    // averages perpendicular normals into every chunk, making wax look faceted.
    for (const [x, y] of boundary.values()) {
      const a = records.length, side = [x, y]; side.normal = new THREE.Vector3();
      records.push({ id: x, layer: 0, patch, side }, { id: y, layer: 0, patch, side }, { id: y, layer: 1, patch, side }, { id: x, layer: 1, patch, side });
      outputIndices.push(a, a + 1, a + 2, a, a + 2, a + 3);
    }
    patch.end = records.length;
  }
  const shellGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(records.length * 3);
  const shellNormals = new Float32Array(positions.length);
  shellGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)); shellGeometry.setIndex(outputIndices);
  shellGeometry.setAttribute('normal', new THREE.BufferAttribute(shellNormals, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.MeshStandardMaterial({ color, roughness: .63, metalness: 0 });
  const mesh = new THREE.Mesh(shellGeometry, material); mesh.frustumCulled = false;
  const group = new THREE.Group(); group.name = 'Thin_Wax'; group.add(mesh);
  const collisions = collisionTree(geometry), gravity = new THREE.Vector3(0, -1, 0);
  let active = false, anchor, contact, since = 0, lastDrop = 0, totalDetached = 0, disposed = false, dirty = true, lastNow = clock();
  let collisionSamples = 0;
  const point = value => Array.isArray(value) || ArrayBuffer.isView(value) ? new THREE.Vector3(...value) : new THREE.Vector3(value.x, value.y, value.z);
  function center(patch) { const result = new THREE.Vector3(); for (const id of patch.vertices) result.add(v.fromBufferAttribute(source, id)); return result.multiplyScalar(1 / patch.vertices.length); }
  function crack() {
    if (!contact) return;
    const nearest = patches.filter(p => !p.detached && p.center.distanceTo(contact) < .19).sort((a, b) => a.center.distanceToSquared(contact) - b.center.distanceToSquared(contact));
    for (const patch of nearest.slice(0, 4)) { patch.cracked = true; dirty = true; }
  }
  function begin(value) { if (disposed) return; active = true; anchor = contact = point(value); since = lastDrop = clock(); crack(); }
  function move(value) {
    if (!value) { end(); return; } if (!active) { begin(value); return; }
    contact = point(value);
    if (contact.distanceTo(anchor) > config.localRadius) { anchor = contact.clone(); since = lastDrop = clock(); }
    crack();
  }
  function end() { active = false; contact = anchor = null; }
  function sync() {
    if (disposed) return;
    collisions.refit();
    collisionSamples = 0;
    for (const patch of patches) {
      if (patch.dead) continue;
      const midpoint = center(patch), shrink = patch.cracked ? .962 : 1;
      // Shrink in the source surface's barycentric plane, before its outward
      // offset. A small crack opens between chunks without cutting the core.
      const desired = patch.offset, length = desired.length(); let fraction = 1;
      if (patch.detached && length > 1e-8) {
        function constrain(support) {
          const distance = collisions.sweep(support, desired); collisionSamples++;
          if (distance < length - 1e-6) fraction = Math.min(fraction, Math.max(0, distance - config.thickness * 2) / length);
        }
        for (const id of patch.vertices) constrain(new THREE.Vector3().fromBufferAttribute(source, id).addScaledVector(v.fromBufferAttribute(normals, id).normalize(), config.gap));
        for (const face of patch.faces) {
          const supports = Array.from(indices.slice(face * 3, face * 3 + 3)).map(id => new THREE.Vector3().fromBufferAttribute(source, id).addScaledVector(v.fromBufferAttribute(normals, id).normalize(), config.gap));
          constrain(supports[0].clone().add(supports[1]).add(supports[2]).multiplyScalar(1 / 3));
          for (let k = 0; k < 3; k++) constrain(supports[k].clone().add(supports[(k + 1) % 3]).multiplyScalar(.5));
        }
      }
      for (let r = patch.start; r < patch.end; r++) {
        const record = records[r], normal = v.fromBufferAttribute(normals, record.id).normalize();
        const base = w.fromBufferAttribute(source, record.id);
        // Offset follows the exact current vertex, with no radial assumption.
        // Crack inset is tangent-only and capped at 3 mm; geometry diagnostics
        // also sample face and edge interiors against the current core mesh.
        u.copy(midpoint).sub(base); u.addScaledVector(normal, -u.dot(normal)).multiplyScalar(1 - shrink);
        if (u.length() > .003) u.setLength(.003);
        base.add(u).addScaledVector(normal, config.gap + record.layer * config.thickness).addScaledVector(desired, fraction);
        positions[r * 3] = base.x; positions[r * 3 + 1] = base.y; positions[r * 3 + 2] = base.z;
        if (record.side) {
          if (record.id === record.side[0] && record.layer === 0) {
            const edge = w.fromBufferAttribute(source, record.side[1]).sub(u.fromBufferAttribute(source, record.side[0]));
            u.fromBufferAttribute(normals, record.side[0]).add(v.fromBufferAttribute(normals, record.side[1])).normalize();
            record.side.normal.copy(edge).cross(u).normalize();
          }
          const n = record.side.normal; shellNormals[r * 3] = n.x; shellNormals[r * 3 + 1] = n.y; shellNormals[r * 3 + 2] = n.z;
        } else {
          const sign = record.layer ? 1 : -1;
          shellNormals[r * 3] = normal.x * sign; shellNormals[r * 3 + 1] = normal.y * sign; shellNormals[r * 3 + 2] = normal.z * sign;
        }
      }
    }
    // Removed fragments collapse only their own triangles; holes never regrow.
    for (const patch of patches) if (patch.dead) for (let r = patch.start; r < patch.end; r++) positions.set([0, 0, 0], r * 3);
    shellGeometry.attributes.position.needsUpdate = true; shellGeometry.attributes.normal.needsUpdate = true; dirty = false;
  }
  function step(dt, now = clock()) {
    if (disposed) return { changed: false, needsFrame: false };
    lastNow = now;
    if (active && now - since > config.dwell && now - lastDrop >= config.fragmentInterval && totalDetached < config.maxFragments) {
      const candidates = patches.filter(p => !p.detached && p.center.distanceTo(contact) < .27).sort((a, b) => a.center.distanceToSquared(contact) - b.center.distanceToSquared(contact));
      const firstBurst = totalDetached === 0;
      for (const patch of candidates.slice(0, firstBurst ? 3 : 1)) {
        if (totalDetached >= config.maxFragments) break;
        patch.cracked = patch.detached = true; patch.born = now; patch.burst = firstBurst;
        patch.outward.set(0, 0, 0); for (const id of patch.vertices) patch.outward.add(v.fromBufferAttribute(normals, id)); patch.outward.normalize(); totalDetached++; lastDrop = now; dirty = true;
      }
    }
    let living = false;
    for (const patch of patches) if (patch.detached && !patch.dead) {
      const age = Math.max(0, now - patch.born); dirty = living = true;
      if (age >= config.lifetime) patch.dead = true;
      else {
        // First three chips receive a 140 ms outward impulse. The exponential
        // displacement has a high initial velocity, then rapidly decelerates.
        const burst = patch.burst ? (reducedMotion ? .035 : .14) * (1 - Math.exp(-age / .07)) : 0;
        patch.offset.copy(patch.outward).multiplyScalar(.012 + burst + age * (reducedMotion ? .09 : .24)).addScaledVector(gravity, (reducedMotion ? .1 : .42) * age * age);
      }
    }
    const changed = dirty; if (changed) sync();
    return { changed, needsFrame: active || living };
  }
  function reset() { end(); totalDetached = 0; for (const p of patches) { p.cracked = p.detached = p.dead = false; p.offset.set(0, 0, 0); } dirty = true; sync(); }
  function getMetrics({ exhaustive = false } = {}) {
    let minGap = Infinity, maxThicknessError = 0, samples = 0, violations = 0;
    for (const patch of patches) if (!patch.detached) for (let r = patch.start; r < patch.start + patch.vertices.length * 2; r += 2) {
      const id = records[r].id, normal = new THREE.Vector3().fromBufferAttribute(normals, id).normalize();
      const inner = new THREE.Vector3().fromArray(positions, r * 3), outer = new THREE.Vector3().fromArray(positions, (r + 1) * 3);
      const gap = inner.clone().sub(v.fromBufferAttribute(source, id)).dot(normal);
      minGap = Math.min(minGap, gap); maxThicknessError = Math.max(maxThicknessError, Math.abs(outer.distanceTo(inner) - config.thickness)); samples++;
      if (gap < config.gap - .00001) violations++;
    }
    let detachedMinSignedDistance = Infinity, detachedSamples = 0, detachedViolations = 0;
    for (const patch of patches) if (patch.detached && !patch.dead) for (let r = patch.start; r < patch.end; r += 2) {
      const distance = collisions.signedDistance(new THREE.Vector3().fromArray(positions, r * 3));
      detachedMinSignedDistance = Math.min(detachedMinSignedDistance, distance); detachedSamples++;
      if (distance < -.00001) detachedViolations++;
    }
    let attachedMinSignedDistance = Infinity, attachedSurfaceSamples = 0, detachedInteriorSamples = 0;
    // Exact nearest live-core triangle distances at rendered shell face and
    // edge centers. Default bounds diagnostics cost; exhaustive scans all.
    const stride = exhaustive ? 1 : Math.max(1, Math.ceil(faceCount / 192));
    for (const patch of patches) if (!patch.dead) for (const face of patch.faces) {
      if (!patch.detached && face % stride !== 0) continue;
      const points = Array.from(indices.slice(face * 3, face * 3 + 3)).map(id => new THREE.Vector3().fromArray(positions, patch.local.get(id) * 3));
      const check = [points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3)];
      for (let k = 0; k < 3; k++) check.push(points[k].clone().add(points[(k + 1) % 3]).multiplyScalar(.5));
      for (const position of check) {
        const distance = collisions.signedDistance(position);
        if (patch.detached) { detachedMinSignedDistance = Math.min(detachedMinSignedDistance, distance); detachedInteriorSamples++; if (distance < -.00001) detachedViolations++; }
        else { attachedMinSignedDistance = Math.min(attachedMinSignedDistance, distance); attachedSurfaceSamples++; if (distance < -.00001) violations++; }
      }
    }
    return { thickness: config.thickness, gap: config.gap, tolerance: .00001, attachedMinGap: minGap, attachedMinSignedDistance, maxThicknessError, attachedSamples: samples, attachedSurfaceSamples, attachedViolations: violations, detachedSweepSamples: collisionSamples, detachedMinSignedDistance: Number.isFinite(detachedMinSignedDistance) ? detachedMinSignedDistance : null, detachedSamples, detachedInteriorSamples, detachedViolations, drawCalls: 1, shellVertices: records.length, shellTriangles: outputIndices.length / 3, patches: patches.length, method: 'source normal clearance plus nearest live core triangle signed distance at vertices, face centers and edge centers; BVH segment sweeps; 3 mm tangent crack inset' };
  }
  function getState() { return { active, cracked: patches.filter(p => p.cracked).length, detached: totalDetached, living: patches.filter(p => p.detached && !p.dead).length, expired: patches.filter(p => p.dead).length, firstBurst: patches.filter(p => p.detached && p.burst).length, burstDuration: .14, burstInitialOutwardSpeed: reducedMotion ? .5 : 2, maxOutwardOffset: Math.max(0, ...patches.filter(p => p.detached && !p.dead).map(p => p.offset.dot(p.outward))), dwell: active ? Math.max(0, lastNow - since) : 0, disposed }; }
  function dispose() { if (disposed) return; end(); disposed = true; shellGeometry.dispose(); material.dispose(); group.removeFromParent(); }
  sync();
  return { group, begin, move, end, release: end, cancel: end, sync, step, reset, dispose, getState, getMetrics, setGravity(value) { gravity.copy(point(value)).normalize(); }, setReducedMotion(value) { reducedMotion = !!value; } };
}
