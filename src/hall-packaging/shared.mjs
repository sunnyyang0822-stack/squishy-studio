// Shared by the build-time baker and the hall runtime: layout numbers and
// grid helpers only (no solver, no BVH), so the runtime bundle stays small.
import * as THREE from 'three';

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

// Shared layout derived from the spec; the runtime uses the same numbers for
// seals, zipper and tag so they always line up with the baked film.
export function layout(spec) {
  const bag = spec.bag, halfW = bag.width / 2;
  const sealTop = bag.bodyTop + bag.topSeal, sealBottom = bag.bodyBottom - bag.bottomSeal;
  return { halfW, sealTop, sealBottom, edgeZ: .006, holeY: bag.bodyTop + bag.topSeal * .55, holeX: bag.hole.x };
}

export function gridFor(spec, [nx, ny]) {
  const { halfW } = layout(spec), bag = spec.bag;
  return { nx, ny, x0: -halfW, y0: bag.bodyBottom, dx: bag.width / (nx - 1), dy: (bag.bodyTop - bag.bodyBottom) / (ny - 1) };
}

export function gridSampler(grid, z) {
  const { nx, ny, x0, y0, dx, dy } = grid;
  return (x, y) => {
    const fx = (x - x0) / dx, fy = (y - y0) / dy;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return null;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), u = fx - i, v = fy - j;
    const at = (a, b) => z[b * nx + a];
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
}

export function gridGeometry(grid, z) {
  const { nx, ny, x0, y0, dx, dy } = grid;
  const positions = new Float32Array(nx * ny * 3), uvs = new Float32Array(nx * ny * 2), index = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let n = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    positions[k * 3] = x0 + i * dx; positions[k * 3 + 1] = y0 + j * dy; positions[k * 3 + 2] = z[k];
    uvs[k * 2] = i / (nx - 1); uvs[k * 2 + 1] = j / (ny - 1);
    if (i < nx - 1 && j < ny - 1) { const a = k, b = k + 1, c = k + nx, d = k + nx + 1; index.set([a, b, d, a, d, c], n); n += 6; }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1)); geometry.computeVertexNormals();
  return geometry;
}


// Height of the film mesh exactly as triangulated at runtime (diagonal from
// k to k+nx+1), so clearance checks match what is drawn.
export function filmSampler(grid, z) {
  const { nx, ny, x0, y0, dx, dy } = grid;
  return (x, y) => {
    const fx = (x - x0) / dx, fy = (y - y0) / dy;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return null;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), u = fx - i, v = fy - j, k = j * nx + i;
    const a = z[k], b = z[k + 1], c = z[k + nx], d = z[k + nx + 1];
    return u >= v ? a + u * (b - a) + v * (d - b) : a + v * (c - a) + u * (d - c);
  };
}

// PVC tag layout shared by baker and runtime: hang hole at the top centre,
// name field below it filling the rest of the tag.
export function tagLayout(spec, kind = 'rounded') {
  // Hang hole at the centre of the tag's left end; the chain wraps round the
  // left edge. The printed name field fills the tag to the right of the hole.
  const t = spec.tag, w2 = t.width / 2, h2 = t.height / 2, inset = t.printInset;
  const holeX = -w2 + .09, left = holeX + .075, right = w2 - (kind === 'pill' ? t.height * .28 : kind === 'cloud' ? .1 : kind === 'ticket' ? .1 : inset);
  const vInset = kind === 'cloud' ? .075 : kind === 'scallop' ? .06 : kind === 'arch' ? .1 : inset * .8;
  return { hole: [holeX, 0], edge: [-1, 0], rim: holeX + w2, holeRadius: .035, bevel: .005, outline: tagOutline(kind, t.width, t.height), print: { x: (left + right) / 2, y: kind === 'arch' ? -.03 : 0, width: right - left, height: t.height - vInset * 2 } };
}

// Natural bag outline from first principles: PVC film barely stretches, so
// wherever the toy lifts the film, that row (or column) uses up extra length and
// pulls the bag edge inward. The profile is measured from the solved film at
// bake time, so each style's edges bend according to its own contents. The xy
// warp is zero over the rigid toy and grows towards the edges; corners curl up
// by different amounts (that lift is baked into film heights for clearance).
export function bagWarp(spec, seed, profile = null) {
  const bag = spec.bag, e = bag.edge, halfW = bag.width / 2;
  const top = bag.bodyTop + bag.topSeal, bottom = bag.bodyBottom - bag.bottomSeal, height = top - bottom, middle = (top + bottom) / 2;
  const random = rng(seed * 7 + 3), phase = [random() * 6.28, random() * 6.28, random() * 6.28, random() * 6.28];
  const curl = [0, 1, 2, 3].map(() => .45 + random() * .55);
  const corners = [[-halfW, top], [halfW, top], [-halfW, bottom], [halfW, bottom]];
  const sample = (values, from, to, at) => { if (!values) return 0; const f = Math.min(1, Math.max(0, (at - from) / (to - from))) * (values.length - 1), i = Math.min(values.length - 2, Math.floor(f)); return values[i] + (values[i + 1] - values[i]) * (f - i); };
  const xy = (x, y) => {
    const sideStart = profile ? profile.sideStart : halfW - e.reach, endStart = profile ? profile.endStart : height / 2 - e.reach * .7;
    const side = smoothstep(sideStart, halfW, Math.abs(x)), ends = smoothstep(endStart, height / 2, Math.abs(y - middle));
    const rowPull = sample(profile?.rows, bag.bodyBottom, bag.bodyTop, y), colPull = sample(profile?.cols, -halfW, halfW, x);
    const v = Math.min(1, Math.max(0, (y - bottom) / height)), u = Math.min(1, Math.max(0, (x + halfW) / bag.width));
    const pullX = (rowPull + e.wave * Math.sin(v * 9 + phase[x < 0 ? 0 : 1])) * side;
    const pullY = (colPull * .7 + e.wave * .6 * Math.sin(u * 8 + phase[y > middle ? 2 : 3])) * ends;
    return [x - Math.sign(x) * pullX, y - Math.sign(y - middle) * pullY];
  };
  const lift = (x, y) => {
    let z = 0;
    corners.forEach(([cx, cy], i) => { const d = Math.hypot(x - cx, y - cy), c = Math.max(0, 1 - d / e.cornerReach); z += e.cornerLift * curl[i] * c * c; });
    return z;
  };
  return { xy, lift };
}

export function distanceToPolygon([x, y], polygon) {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[j], [bx, by] = polygon[i], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l));
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}

// PVC tag outlines. Every shape shares one footprint (width × height), a hang
// hole at the top centre and a rectangular name field below it, so the series
// stays consistent while each style gets its own silhouette.
export const tagShapes = ['pill', 'cloud', 'scallop', 'tab', 'rounded', 'ticket', 'arch'];
export function tagOutline(kind, width, height, segments = 10) {
  const w2 = width / 2, h2 = height / 2, pts = [];
  const arc = (cx, cy, r, a0, a1, n = segments) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  const roundedRect = r => { arc(w2 - r, -h2 + r, r, -Math.PI / 2, 0); arc(w2 - r, h2 - r, r, 0, Math.PI / 2); arc(-w2 + r, h2 - r, r, Math.PI / 2, Math.PI); arc(-w2 + r, -h2 + r, r, Math.PI, Math.PI * 1.5); };
  if (kind === 'pill') roundedRect(h2 * .98);
  else if (kind === 'rounded') roundedRect(.1);
  else if (kind === 'arch') { pts.push([-w2, -h2 + .06]); arc(-w2 + .06, -h2 + .06, .06, Math.PI, Math.PI * 1.5, 4); arc(w2 - .06, -h2 + .06, .06, -Math.PI / 2, 0, 4); const r = w2, cy = h2 - r * .42; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI; pts.push([Math.cos(a) * r, Math.min(h2, cy + Math.sin(a) * r * .42)]); } }
  else if (kind === 'tab') { const c = .17; pts.push([-w2 + .05, -h2], [w2 - .05, -h2], [w2, -h2 + .05], [w2, h2 - c], [w2 - c * 1.6, h2], [-w2 + c * 1.6, h2], [-w2, h2 - c], [-w2, -h2 + .05]); }
  else if (kind === 'ticket') { const n = .07; pts.push([-w2, -h2]); pts.push([w2, -h2]); arc(w2, 0, n, -Math.PI / 2, -Math.PI * 1.5, 6); pts.push([w2, h2], [-w2, h2]); arc(-w2, 0, n, Math.PI / 2, -Math.PI / 2, 6); }
  else if (kind === 'scallop') { const bumps = [9, 4], r = .035; const edge = (x0, y0, x1, y1, n) => { for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, mx = x0 + (x1 - x0) * (t0 + t1) / 2, my = y0 + (y1 - y0) * (t0 + t1) / 2, ang = Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2; for (let k = 0; k <= 4; k++) { const a = ang + Math.PI / 2 - k / 4 * Math.PI; pts.push([mx + Math.cos(a + Math.PI) * 0 + Math.cos(ang) * r * Math.sin(k / 4 * Math.PI) + (x1 - x0) / n * (k / 4 - .5), my + Math.sin(ang) * r * Math.sin(k / 4 * Math.PI) + (y1 - y0) / n * (k / 4 - .5)]); } } }; const iw = w2 - r, ih = h2 - r; edge(-iw, -ih, iw, -ih, bumps[0]); edge(iw, -ih, iw, ih, bumps[1]); edge(iw, ih, -iw, ih, bumps[0]); edge(-iw, ih, -iw, -ih, bumps[1]); }
  else if (kind === 'cloud') { const lobes = [[-w2 + .2, -h2 + .2, .2], [-.15, -h2 + .17, .18], [.22, -h2 + .18, .2], [w2 - .2, -h2 + .21, .21], [w2 - .19, h2 - .2, .2], [.18, h2 - .17, .18], [-.2, h2 - .19, .2], [-w2 + .2, h2 - .2, .2]]; const cx = 0, cy = 0; const all = []; for (let i = 0; i < 160; i++) { const a = i / 160 * Math.PI * 2, dir = [Math.cos(a), Math.sin(a)]; let best = 0; for (const [lx, ly, lr] of lobes) { const ox = lx - cx, oy = ly - cy, b = ox * dir[0] + oy * dir[1], c = ox * ox + oy * oy - lr * lr, disc = b * b - c; if (disc >= 0) best = Math.max(best, b + Math.sqrt(disc)); } all.push([dir[0] * Math.min(best, Math.hypot(w2, h2)), dir[1] * Math.min(best, Math.hypot(w2, h2))]); } all.forEach(p => pts.push([Math.max(-w2, Math.min(w2, p[0])), Math.max(-h2, Math.min(h2, p[1]))])); }
  return pts;
}
export function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
