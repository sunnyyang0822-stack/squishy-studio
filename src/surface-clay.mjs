import { getOrbFeel } from './orb-feels.mjs';

// Only spatial queries belong here. All pressure, timing, retention, cancellation
// and restoration still run in the registered, shared clay factory.
export function createSurfaceClay(positions, normals, { indices, geometryOptions, reducedMotion = false } = {}) {
  return getOrbFeel('clay').createDeformation(positions, normals, {
    reducedMotion, surfaceGeometry: createSurfaceGeometry(positions, normals, indices, geometryOptions),
  });
}

class Heap {
  items = [];
  push(value) {
    const a = this.items; a.push(value); let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (a[p][0] <= value[0]) break; a[i] = a[p]; i = p; } a[i] = value;
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop();
    if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let c = i * 2 + 1; if (c + 1 < a.length && a[c + 1][0] < a[c][0]) c++; if (a[c][0] >= last[0]) break; a[i] = a[c]; i = c; } a[i] = last; }
    return first;
  }
}

// Geometry-only projection of an actual proposed displacement. Unlike an
// independent per-vertex box, this keeps the correlated, broad clay footprint.
// The rest face's projected signed area along a straight offset segment is a
// quadratic polynomial. Its first zero bounds every intermediate position.
export function createOffsetSafety(rest, directions, indices, { vectorOffsets = false } = {}) {
  const count = rest.length / 3, faces = new Float64Array(indices.length / 3 * 4);
  const previous = new Float64Array(rest.length), delta = new Float64Array(rest.length);
  const slots = vectorOffsets ? rest.length : count;
  const zeros = new Float32Array(slots);
  const incident = Array.from({ length: count }, () => []);
  const triangleCount = indices.length / 3;
  const queue = new Int32Array(triangleCount), queued = new Uint8Array(triangleCount), visits = new Uint8Array(triangleCount);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = rest[b] - rest[a], uy = rest[b + 1] - rest[a + 1], uz = rest[b + 2] - rest[a + 2];
    const vx = rest[c] - rest[a], vy = rest[c + 1] - rest[a + 1], vz = rest[c + 2] - rest[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const f = t / 3 * 4; faces[f] = x; faces[f + 1] = y; faces[f + 2] = z; faces[f + 3] = x * x + y * y + z * z;
    if (!(faces[f + 3] > 0)) throw new RangeError('Offset safety requires nondegenerate faces');
    for (let j = 0; j < 3; j++) incident[indices[t + j]].push(t / 3);
  }
  function segmentLimit(from, to, triangle = -1, margin = .08001) {
    function prepare(i) { for (let k = 0; k < 3; k++) {
      const j = i * 3 + k;
      previous[j] = rest[j] - (vectorOffsets ? from[j] : directions[j] * from[i]);
      delta[j] = vectorOffsets ? from[j] - to[j] : -directions[j] * (to[i] - from[i]);
    } }
    if (triangle >= 0) for (let k = 0; k < 3; k++) prepare(indices[triangle * 3 + k]);
    else for (let i = 0; i < count; i++) prepare(i);
    let limit = 1;
    const start = triangle < 0 ? 0 : triangle * 3, end = triangle < 0 ? indices.length : start + 3;
    for (let t = start; t < end; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3, f = t / 3 * 4;
      const ux = previous[b] - previous[a], uy = previous[b + 1] - previous[a + 1], uz = previous[b + 2] - previous[a + 2];
      const vx = previous[c] - previous[a], vy = previous[c + 1] - previous[a + 1], vz = previous[c + 2] - previous[a + 2];
      const dx = delta[b] - delta[a], dy = delta[b + 1] - delta[a + 1], dz = delta[b + 2] - delta[a + 2];
      const ex = delta[c] - delta[a], ey = delta[c + 1] - delta[a + 1], ez = delta[c + 2] - delta[a + 2];
      const nx = faces[f], ny = faces[f + 1], nz = faces[f + 2], area = faces[f + 3];
      const rawQ0 = (nx * (uy * vz - uz * vy) + ny * (uz * vx - ux * vz) + nz * (ux * vy - uy * vx)) / area - margin;
      const q1 = (nx * (dy * vz - dz * vy + uy * ez - uz * ey) + ny * (dz * vx - dx * vz + uz * ex - ux * ez) + nz * (dx * vy - dy * vx + ux * ey - uy * ex)) / area;
      const q2 = (nx * (dy * ez - dz * ey) + ny * (dz * ex - dx * ez) + nz * (dx * ey - dy * ex)) / area;
      if (rawQ0 < -2e-6) throw new RangeError('Offset safety received an unsafe previous surface');
      // Float32 offsets may round an accepted face a fraction below our extra
      // margin while remaining above .08. A stationary distant face must not
      // freeze a new, unrelated footprint for that numerical difference.
      const q0 = Math.max(0, rawQ0);
      const minimumAt = q2 > 0 ? Math.max(0, Math.min(limit, -q1 / (2 * q2))) : limit;
      const value = q0 + minimumAt * (q1 + minimumAt * q2);
      if (value >= 0 || minimumAt === 0) continue;
      // This interval ends at the first minimum, so it contains exactly the
      // first crossing even when the proposed endpoint is safe again.
      let low = 0, high = minimumAt;
      for (let step = 0; step < 30; step++) {
        const mid = (low + high) / 2;
        if (q0 + mid * (q1 + mid * q2) >= 0) low = mid; else high = mid;
      }
      limit = Math.min(limit, low * (1 - 1e-5));
    }
    return limit;
  }
  return function constrainOffsets(from, candidate) {
    let proposed = 0;
    for (let i = 0; i < slots; i++) proposed = Math.max(proposed, Math.abs(candidate[i] - from[i]));
    if (proposed === 0) return 1;
    queued.fill(1); visits.fill(0);
    for (let t = 0; t < triangleCount; t++) queue[t] = t;
    let head = 0, tail = triangleCount;
    const enqueue = t => { if (!queued[t]) { queued[t] = 1; queue[tail++ % triangleCount] = t; } };
    while (head < tail) {
      const t = queue[head++ % triangleCount]; queued[t] = 0;
      const alpha = segmentLimit(from, candidate, t);
      const restAlpha = segmentLimit(zeros, candidate, t, .08);
      if (alpha === 1 && restAlpha === 1) continue;
      const vertices = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
      const ids = vectorOffsets ? vertices.flatMap(i => [i * 3, i * 3 + 1, i * 3 + 2]) : vertices;
      const before = ids.map(i => candidate[i]);
      const assign = value => { for (let k = 0; k < ids.length; k++) { const i = ids[k]; candidate[i] = from[i] + (before[k] - from[i]) * value; } };
      let fraction = alpha;
      assign(fraction);
      // Each accepted face must also have a safe route to its own rest shape.
      if (segmentLimit(zeros, candidate, t, .08) < 1) {
        let low = 0, high = fraction;
        for (let step = 0; step < 20; step++) {
          const mid = (low + high) / 2; assign(mid);
          if (segmentLimit(zeros, candidate, t, .08) === 1) low = mid; else high = mid;
        }
        fraction = low; assign(fraction);
      }
      // Iterative local corrections can touch a neighbour already checked.
      // Requeue those faces. A stubborn local cycle freezes only these three
      // increments; it never scales or freezes a distant new footprint.
      if (fraction < 1e-5 || ++visits[t] >= 12 || ids.every((i, k) => candidate[i] === before[k])) assign(0);
      let changed = false;
      for (let k = 0; k < ids.length; k++) if (candidate[ids[k]] !== before[k]) {
        changed = true; for (const face of incident[vectorOffsets ? Math.floor(ids[k] / 3) : ids[k]]) enqueue(face);
      }
      if (!changed) throw new RangeError('Offset safety could not repair a previously accepted face');
    }
    if (segmentLimit(from, candidate) < 1 || segmentLimit(zeros, candidate, -1, .08) < 1) throw new RangeError('Offset safety did not converge');
    let accepted = 0;
    for (let i = 0; i < slots; i++) accepted = Math.max(accepted, Math.abs(candidate[i] - from[i]));
    return Math.min(1, accepted / proposed);
  };
}

export function createSurfaceGeometry(source, sourceNormals, indices, { depthAxis, continuousFootprint = false, scalarThickness = true, fastNearest = false } = {}) {
  const rest = source.slice(), count = rest.length / 3;
  if (!indices?.length || sourceNormals.length !== rest.length) throw new TypeError('Surface clay requires indexed positions and normals');
  const directions = sourceNormals.slice(), radii = new Float32Array(count);
  const point = i => [rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]];
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const adjacency = Array.from({ length: count }, () => new Map());
  const triangles = [];
  for (let i = 0; i < indices.length; i += 3) {
    const ids = Array.from(indices.slice(i, i + 3)); triangles.push(ids);
    for (let k = 0; k < 3; k++) { const a = ids[k], b = ids[(k + 1) % 3], d = distance(point(a), point(b)); adjacency[a].set(b, d); adjacency[b].set(a, d); }
  }
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rest.length; i++) { low[i % 3] = Math.min(low[i % 3], rest[i]); high[i % 3] = Math.max(high[i % 3], rest[i]); }
  const center = low.map((v, k) => (v + high[k]) / 2);
  const radialVectors = Array.from({ length: count }, (_, i) => point(i).map((v, k) => v - center[k]));
  // A genuinely star-convex surface has a one-to-one radial parameterization.
  // Positive radial scales preserve its closed topology globally. Use that
  // exact geometric property where valid; no sphere projection is performed.
  const starConvex = radialVectors.every((v, i) => v.reduce((s, n, k) => s + n * directions[i * 3 + k], 0) > .05 * Math.hypot(...v)) && triangles.every(([a, b, c]) => {
    const u = radialVectors[a], v = radialVectors[b], w = radialVectors[c];
    return u[0] * (v[1] * w[2] - v[2] * w[1]) + u[1] * (v[2] * w[0] - v[0] * w[2]) + u[2] * (v[0] * w[1] - v[1] * w[0]) > 1e-10;
  });
    // A small triangle BVH makes inward thickness queries O(log triangles).
    function build(ids) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const t of ids) for (const v of triangles[t]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], rest[v * 3 + k]); hi[k] = Math.max(hi[k], rest[v * 3 + k]); }
      if (ids.length <= 12) return { lo, hi, ids };
      const axis = [0, 1, 2].sort((a, b) => (hi[b] - lo[b]) - (hi[a] - lo[a]))[0];
      ids.sort((a, b) => triangles[a].reduce((s, v) => s + rest[v * 3 + axis], 0) - triangles[b].reduce((s, v) => s + rest[v * 3 + axis], 0));
      const mid = ids.length >> 1;
      return { lo, hi, left: build(ids.slice(0, mid)), right: build(ids.slice(mid)) };
    }
    let thicknessTree;
    function thickness(origin, ray) {
      let best = Infinity;
      function visit(node) {
        let near = 0, far = best;
        for (let k = 0; k < 3; k++) {
          if (Math.abs(ray[k]) < 1e-10) { if (origin[k] < node.lo[k] - 1e-7 || origin[k] > node.hi[k] + 1e-7) return; }
          else { let a = (node.lo[k] - origin[k]) / ray[k], b = (node.hi[k] - origin[k]) / ray[k]; if (a > b) [a, b] = [b, a]; near = Math.max(near, a); far = Math.min(far, b); if (far < near) return; }
        }
        if (!node.ids) { visit(node.left); visit(node.right); return; }
        for (const id of node.ids) {
          if (scalarThickness) {
            // Same Möller–Trumbore arithmetic and tolerances as below. Reuse
            // scalars rather than allocating maps/reductions for every visited
            // static triangle of every pressure-radius ray.
            const tri = triangles[id], a = tri[0] * 3, b = tri[1] * 3, c = tri[2] * 3;
            const ex = rest[b] - rest[a], ey = rest[b + 1] - rest[a + 1], ez = rest[b + 2] - rest[a + 2];
            const fx = rest[c] - rest[a], fy = rest[c + 1] - rest[a + 1], fz = rest[c + 2] - rest[a + 2];
            const hx = ray[1] * fz - ray[2] * fy, hy = ray[2] * fx - ray[0] * fz, hz = ray[0] * fy - ray[1] * fx;
            const det = ex * hx + ey * hy + ez * hz; if (Math.abs(det) < 1e-10) continue;
            const sx = origin[0] - rest[a], sy = origin[1] - rest[a + 1], sz = origin[2] - rest[a + 2];
            const u = (sx * hx + sy * hy + sz * hz) / det; if (u < -1e-6 || u > 1.000001) continue;
            const qx = sy * ez - sz * ey, qy = sz * ex - sx * ez, qz = sx * ey - sy * ex;
            const v = (ray[0] * qx + ray[1] * qy + ray[2] * qz) / det; if (v < -1e-6 || u + v > 1.000001) continue;
            const t = (fx * qx + fy * qy + fz * qz) / det; if (t > 1e-5) best = Math.min(best, t);
            continue;
          }
          const [a, b, c] = triangles[id].map(point);
          const e = b.map((v, k) => v - a[k]), f = c.map((v, k) => v - a[k]);
          const h = [ray[1] * f[2] - ray[2] * f[1], ray[2] * f[0] - ray[0] * f[2], ray[0] * f[1] - ray[1] * f[0]];
          const det = e.reduce((s, v, k) => s + v * h[k], 0); if (Math.abs(det) < 1e-10) continue;
          const s = origin.map((v, k) => v - a[k]);
          const u = s.reduce((sum, v, k) => sum + v * h[k], 0) / det; if (u < -1e-6 || u > 1.000001) continue;
          const q = [s[1] * e[2] - s[2] * e[1], s[2] * e[0] - s[0] * e[2], s[0] * e[1] - s[1] * e[0]];
          const v = ray.reduce((sum, n, k) => sum + n * q[k], 0) / det; if (v < -1e-6 || u + v > 1.000001) continue;
          const t = f.reduce((sum, n, k) => sum + n * q[k], 0) / det;
          if (t > 1e-5) best = Math.min(best, t);
        }
      }
      visit(thicknessTree ??= build(triangles.map((_, i) => i))); return best;
    }
  if (starConvex) {
    for (let i = 0; i < count; i++) { const radius = Math.hypot(...radialVectors[i]); radii[i] = radius; for (let k = 0; k < 3; k++) directions[i * 3 + k] = radialVectors[i][k] / radius; }
  } else {
    // Use a continuous inward field across raised pads. Exported surface
    // normals describe the decorative pad curvature; following their rapidly
    // converging rays directly pinches a broad press into a narrow crease.
    // Diffusion regularizes only spatial directions; clay response is unchanged.
    for (let pass = 0; pass < 32; pass++) {
      const next = directions.slice();
      for (let i = 0; i < count; i++) {
        const sum = Array.from(directions.slice(i * 3, i * 3 + 3));
        for (const [j] of adjacency[i]) for (let k = 0; k < 3; k++) sum[k] += directions[j * 3 + k];
        const length = Math.hypot(...sum);
        for (let k = 0; k < 3; k++) next[i * 3 + k] = sum[k] / length;
      }
      directions.set(next);
    }
    if (depthAxis !== undefined) {
      // A padded front/back heightfield descends along its depth axis rather
      // than toward the centers of the decorative raised pads. Near the rim
      // the body-space radial components provide a continuous closed field.
      for (let i = 0; i < count; i++) {
        const p = point(i), depth = p[depthAxis] - center[depthAxis];
        const v = p.map((x, k) => k === depthAxis ? depth * 12 : (x - center[k]) * Math.exp(-((depth / .12) ** 2)));
        if (Math.abs(depth) >= .2) for (let k = 0; k < 3; k++) v[k] = k === depthAxis ? Math.sign(depth) : 0;
        const length = Math.hypot(...v);
        for (let k = 0; k < 3; k++) directions[i * 3 + k] = v[k] / length;
      }
    }
    for (let i = 0; i < count; i++) {
      const p = point(i), normal = Array.from(directions.slice(i * 3, i * 3 + 3)), length = Math.hypot(...normal);
      if (length < .5) throw new RangeError('Invalid surface normal');
      for (let k = 0; k < 3; k++) directions[i * 3 + k] = normal[k] /= length;
      let radius = depthAxis === undefined ? thickness(p, normal.map(v => -v)) / 2 : Math.abs(p[depthAxis] - center[depthAxis]) >= .2 ? Math.abs(p[depthAxis] - center[depthAxis]) : thickness(p, normal.map(v => -v)) / 2;
      // Convex curvature is a second geometric bound: normals must not pass
      // through their local center of curvature, including rounded star tips.
      for (const [j, edgeLength] of (depthAxis === undefined || Math.abs(p[depthAxis] - center[depthAxis]) < .2 ? adjacency[i] : [])) {
        const edge = point(j).map((v, k) => v - p[k]);
        const divergence = edge.reduce((sum, v, k) => sum + v * (directions[j * 3 + k] - normal[k]), 0);
        if (divergence > 1e-6) radius = Math.min(radius, edgeLength ** 2 / divergence);
      }
      if (!Number.isFinite(radius) || radius < 0) throw new RangeError('Surface must be closed with outward normals');
      radii[i] = radius;
    }
    // Bound the whole admissible displacement box for each triangle, not just
    // individual normal rays. Its projected signed area is multi-affine in the
    // three offsets, so checking the eight corners bounds every intermediate
    // combination as well. This prevents skinny triangles folding after many
    // retained strokes without touching the clay pressure/retention law.
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    for (let pass = 0; pass < (depthAxis === undefined ? 3 : 0); pass++) for (const tri of triangles) {
      const p = tri.map(point), n = tri.map(i => Array.from(directions.slice(i * 3, i * 3 + 3)));
      const face = cross(p[1].map((v, k) => v - p[0][k]), p[2].map((v, k) => v - p[0][k]));
      const area = face.reduce((s, v) => s + v * v, 0);
      function safe(scale) {
        for (let mask = 1; mask < 8; mask++) {
          const q = p.map((a, j) => a.map((v, k) => v - n[j][k] * radii[tri[j]] * .92 * scale * ((mask >> j) & 1)));
          const f = cross(q[1].map((v, k) => v - q[0][k]), q[2].map((v, k) => v - q[0][k]));
          if (face.reduce((s, v, k) => s + v * f[k], 0) < area * .08) return false;
        }
        return true;
      }
      if (!safe(1)) {
        let low = 0, high = 1;
        for (let step = 0; step < 16; step++) { const mid = (low + high) / 2; if (safe(mid)) low = mid; else high = mid; }
        for (const i of tri) radii[i] *= low;
      }
    }
    // Geometry limits must vary smoothly too: isolated short rays/slender
    // triangles otherwise create a hard speck in an otherwise broad clay dent.
    // Taking a Lipschitz lower envelope and then only decreasing local averages
    // preserves every ray/curvature/triangle safety bound established above.
    const boundsQueue = new Heap();
    for (let i = 0; i < count; i++) boundsQueue.push([radii[i], i]);
    while (boundsQueue.items.length) {
      const [r, i] = boundsQueue.pop(); if (r > radii[i] + 1e-7) continue;
      for (const [j, length] of adjacency[i]) {
        const bound = r + length * (depthAxis === undefined ? .5 : 1);
        if (radii[j] > bound + 1e-7) { radii[j] = bound; boundsQueue.push([radii[j], j]); }
      }
    }
    for (let pass = 0; pass < 12; pass++) {
      const next = radii.slice();
      for (let i = 0; i < count; i++) {
        let sum = radii[i], weight = 1;
        for (const [j] of adjacency[i]) { sum += radii[j]; weight++; }
        next[i] = Math.min(radii[i], sum / weight);
      }
      radii.set(next);
    }
  }
  // The padded paw's pressure wave crosses triangle interiors rather than
  // following only mesh-edge directions. This causal first-order fast marching
  // approximation stays on connected faces; it cannot jump a toe gap or hole.
  // Opt-in slow-rebound models share this wave; stroke routing and defaults
  // retain the original graph search.
  const waveFaces = depthAxis === undefined && !continuousFootprint ? null : Array.from({ length: count }, () => []);
  const waveMetrics = waveFaces ? new Float64Array(triangles.length * 9) : null;
  if (waveFaces) for (let t = 0; t < triangles.length; t++) {
    const ids = triangles[t];
    for (let k = 0; k < 3; k++) {
      waveFaces[ids[k]].push(t);
      const p = point(ids[k]), a = point(ids[(k + 1) % 3]), b = point(ids[(k + 2) % 3]);
      const length = distance(a, b);
      const u = p.reduce((sum, v, axis) => sum + (v - a[axis]) * (b[axis] - a[axis]), 0) / length;
      const height = Math.sqrt(Math.max(0, distance(p, a) ** 2 - u ** 2));
      const offset = t * 9 + k * 3;
      waveMetrics[offset] = length; waveMetrics[offset + 1] = u; waveMetrics[offset + 2] = height;
    }
  }
  function waveNeighborhood(p, radius) {
    const [seed] = nearest(p), distances = new Float64Array(count).fill(Infinity), settled = new Uint8Array(count), heap = new Heap(), found = [];
    // Keep the original one-ring source seeding and its subvertex continuity.
    for (const i of [seed, ...adjacency[seed].keys()]) { const d = distance(p, point(i)); distances[i] = d; heap.push([d, i]); }
    function offer(i, value) { if (!settled[i] && value < distances[i] && value <= radius) { distances[i] = value; heap.push([value, i]); } }
    while (heap.items.length) {
      const [d, i] = heap.pop(); if (d !== distances[i] || settled[i] || d > radius) continue;
      settled[i] = 1; found.push([i, d]);
      for (const [j, length] of adjacency[i]) offer(j, d + length);
      for (const t of waveFaces[i]) {
        const ids = triangles[t];
        for (let k = 0; k < 3; k++) {
          const target = ids[k], a = ids[(k + 1) % 3], b = ids[(k + 2) % 3];
          if (settled[target] || !settled[a] || !settled[b]) continue;
          const offset = t * 9 + k * 3, length = waveMetrics[offset], u = waveMetrics[offset + 1], height = waveMetrics[offset + 2];
          const slope = (distances[b] - distances[a]) / length;
          if (Math.abs(slope) >= 1) continue;
          const x = Math.max(0, Math.min(length, u - slope * height / Math.sqrt(1 - slope * slope)));
          const candidate = distances[a] + slope * x + Math.hypot(x - u, height);
          // Reject noncausal/obtuse updates; the single-edge fallback remains.
          if (candidate >= Math.max(distances[a], distances[b])) offer(target, candidate);
        }
      }
    }
    return found;
  }
  const nearestSeen = fastNearest ? new Uint32Array(count) : null, nearestStack = [];
  let nearestStamp = 0;
  const unusedVertices = [];
  if (fastNearest) {
    const referenced = new Uint8Array(count); for (const i of indices) referenced[i] = 1;
    for (let i = 0; i < count; i++) if (!referenced[i]) unusedVertices.push(i);
  }
  function nearest(p) {
    let best = Infinity, index = 0;
    if (!fastNearest) {
      for (let i = 0; i < count; i++) { const d = distance(p, point(i)); if (d < best) { best = d; index = i; } }
      return [index, best];
    }
    if ((nearestStamp = (nearestStamp + 1) >>> 0) === 0) { nearestSeen.fill(0); nearestStamp = 1; }
    const offer = i => {
      if (nearestSeen[i] === nearestStamp) return; nearestSeen[i] = nearestStamp;
      // Keep the exact original distance arithmetic and lowest-index ties.
      const d = distance(p, point(i)); if (d < best || d === best && i < index) { best = d; index = i; }
    };
    let pending = 1; nearestStack[0] = thicknessTree ??= build(triangles.map((_, i) => i));
    while (pending) {
      const node = nearestStack[--pending], x = Math.max(node.lo[0] - p[0], 0, p[0] - node.hi[0]), y = Math.max(node.lo[1] - p[1], 0, p[1] - node.hi[1]), z = Math.max(node.lo[2] - p[2], 0, p[2] - node.hi[2]), squared = best * best;
      if (x * x + y * y + z * z > squared + 64 * Number.EPSILON * Math.max(1, squared)) continue;
      if (node.ids) for (const t of node.ids) for (const i of triangles[t]) offer(i);
      else { nearestStack[pending++] = node.left; nearestStack[pending++] = node.right; }
    }
    for (const i of unusedVertices) offer(i);
    return [index, best];
  }
  function search(p, radius, target = -1) {
    const [seed, offset] = nearest(p), distances = new Float64Array(count).fill(Infinity), previous = new Int32Array(count).fill(-1), heap = new Heap(), found = [];
    // Seed the hit triangle's neighborhood so stamps do not snap to one vertex.
    for (const i of [seed, ...adjacency[seed].keys()]) { const d = distance(p, point(i)); distances[i] = d; heap.push([d, i]); }
    while (heap.items.length) {
      const [d, i] = heap.pop(); if (d !== distances[i] || d > radius) continue;
      found.push([i, d]); if (i === target) break;
      for (const [j, length] of adjacency[i]) { const next = d + length; if (next < distances[j] && next <= radius) { distances[j] = next; previous[j] = i; heap.push([next, j]); } }
    }
    return { found, previous, distances, seed, offset };
  }
  return {
    createContactSafety: () => createOffsetSafety(rest, null, indices, { vectorOffsets: true }),
    // Half the real shell chord along this input ray. Back-facing vertices are
    // outside this contact even if a surface neighborhood wraps over a rim.
    contactRadius(i, outward) {
      if (outward.reduce((sum, value, k) => sum + value * sourceNormals[i * 3 + k], 0) <= 1e-6) return 0;
      const chord = thickness(point(i), outward.map(value => -value));
      return Number.isFinite(chord) ? chord / 2 : 0;
    },
    directions, radii, parameterization: starConvex ? 'star-convex' : 'normal-thickness',
    ...(depthAxis !== undefined && !starConvex ? { constrainOffsets: createOffsetSafety(rest, directions, indices) } : {}),
    neighborhood(p, radius) { return waveFaces ? waveNeighborhood(p, radius) : search(p, radius).found; },
    path(from, to, spacing) {
      const straight = distance(from, to); if (straight < spacing) return [to];
      const [target] = nearest(to), result = search(from, straight * 1.6 + spacing * 2, target);
      // A pointer jumping an empty hole starts a separate footprint, never a
      // chord through the hole or a manufactured stroke around its whole rim.
      if (!Number.isFinite(result.distances[target])) return [to];
      const route = []; let i = target;
      while (i >= 0) { route.push(point(i)); i = result.previous[i]; }
      route.reverse(); route.push(to);
      const samples = []; let a = from;
      for (const b of route) { const steps = Math.max(1, Math.ceil(distance(a, b) / spacing)); for (let n = 1; n <= steps; n++) samples.push(a.map((v, k) => v + (b[k] - v) * n / steps)); a = b; }
      return samples;
    },
  };
}
