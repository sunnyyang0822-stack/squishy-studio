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

export function createSurfaceGeometry(source, sourceNormals, indices, { depthAxis } = {}) {
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
    const tree = build(triangles.map((_, i) => i));
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
      visit(tree); return best;
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
    for (let pass = 0; pass < 3; pass++) for (const tri of triangles) {
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
  function nearest(p) {
    let best = Infinity, index = 0;
    for (let i = 0; i < count; i++) { const d = distance(p, point(i)); if (d < best) { best = d; index = i; } }
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
    directions, radii, parameterization: starConvex ? 'star-convex' : 'normal-thickness',
    neighborhood(p, radius) { return search(p, radius).found; },
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
