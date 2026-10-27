// Hall packaging geometry. Runs at build time in Node (scripts/build-hall-packaging.mjs):
// drapes a puffed PVC film over the confirmed toy model, adds limited contact,
// folds and seam pinches, and places the ball chain and stickers. The runtime
// only loads the baked result, so phones never run this solver.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { smoothstep, rng, layout, gridFor, filmSampler, tagLayout, bagWarp, pointInPolygon, distanceToPolygon } from './shared.mjs';

// Places the confirmed toy with the shared scale rule: the longest front
// silhouette side equals toyFill × bag width. Returns a new geometry.
export function placeToy(spec, id, source) {
  const style = spec.styles[id], bag = spec.bag;
  const geometry = source.clone();
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...style.rotation)));
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const scale = bag.toyFill * bag.width / Math.max(size.x, size.y);
  geometry.scale(scale, scale, scale); geometry.computeBoundingBox();
  const box = geometry.boundingBox, center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, bag.toyCenterY - center.y, .004 - box.min.z);
  geometry.computeBoundingBox();
  return { geometry, scale };
}

export function buildPackageGeometry(spec, id, toyGeometry) {
  const style = spec.styles[id], bag = spec.bag, random = rng(style.seed);
  const { halfW, sealTop, sealBottom, edgeZ, holeY, holeX } = layout(spec);
  const W = bag.width, bodyTop = bag.bodyTop, bodyBottom = bag.bodyBottom;
  const bvh = new MeshBVH(toyGeometry);
  const grid = gridFor(spec, bag.grid), { nx, ny } = grid, count = nx * ny;
  const X = k => grid.x0 + (k % nx) * grid.dx, Y = k => grid.y0 + Math.floor(k / nx) * grid.dy;

  // Toy height field seen from the front.
  const toyTop = new Float32Array(count).fill(-1);
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  let toyCells = 0;
  // Each film vertex takes the highest toy point within one grid step around it,
  // so the piecewise-linear film can never cut through the toy between vertices.
  for (let k = 0; k < count; k++) {
    let top = -1;
    for (const ox of [-1, -.5, 0, .5, 1]) for (const oy of [-1, -.5, 0, .5, 1]) {
      ray.origin.set(X(k) + ox * grid.dx, Y(k) + oy * grid.dy, 10);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
      if (hit) top = Math.max(top, hit.point.z);
    }
    if (top > 0) { toyTop[k] = top; toyCells++; }
  }

  // Two separate layers: the back sheet lies flat on the table under the toy;
  // the front sheet is a stiff OPP/PP sheet sealed to it at the four edges. It
  // spans from the edges to the toy's highest points in flat planes — the upper
  // convex hull of the edge rectangle and the toy — touching the toy only at
  // those top points, with straight creases where the planes meet.
  const lower = new Float32Array(count), film = new Float32Array(count);
  for (let k = 0; k < count; k++) lower[k] = toyTop[k] > 0 ? Math.max(edgeZ, toyTop[k] + bag.contactGap) : edgeZ;
  // The sheet presses onto the toy's upper face (smooth, bridging small dips)
  // and leaves its rim in straight slopes to the sealed edges: the upper convex
  // hull of the edge rectangle and the toy.
  const edgePoints = [];
  for (let i = 0; i <= 60; i++) { const f = i / 60; for (const [x, y] of [[-halfW + f * W, bodyBottom], [-halfW + f * W, bodyTop], [-halfW, bodyBottom + f * (bodyTop - bodyBottom)], [halfW, bodyBottom + f * (bodyTop - bodyBottom)]]) edgePoints.push(new THREE.Vector3(x, y, edgeZ), new THREE.Vector3(x, y, -1)); }
  const supportCells = []; for (let k = 0; k < count; k++) if (toyTop[k] > 0) supportCells.push(k);
  const hullHeights = raise => {
    const hull = new ConvexHull().setFromPoints([...edgePoints, ...supportCells.map(k => new THREE.Vector3(X(k), Y(k), lower[k] + raise))]), tris = [];
    for (const face of hull.faces) { if (face.normal.z <= 1e-4) continue; let e = face.edge; const vs = []; do { vs.push(e.head().point); e = e.next; } while (e !== face.edge); for (let i = 1; i < vs.length - 1; i++) tris.push(vs[0], vs[i], vs[i + 1]); }
    const hullBvh = new MeshBVH(new THREE.BufferGeometry().setFromPoints(tris)), z = new Float32Array(count);
    for (let k = 0; k < count; k++) { ray.origin.set(X(k), Y(k), 10); const hit = hullBvh.raycastFirst(ray, THREE.DoubleSide); z[k] = hit ? hit.point.z : edgeZ; }
    return z;
  };
  const hullZ = hullHeights(0);
  for (let k = 0; k < count; k++) film[k] = Math.max(lower[k], hullZ[k]);
  // A stiff sheet still sags a little between its supports (thickness-scaled).
  const sagAt = k => { const x = X(k), y = Y(k), e = Math.min(x + halfW, halfW - x, y - bodyBottom, bodyTop - y); return bag.sag * smoothstep(0, .6, e) * (toyTop[k] > 0 ? 0 : 1); };
  for (let k = 0; k < count; k++) film[k] = Math.max(lower[k], film[k] - sagAt(k));
  // the hinge where a ramp meets the table stays crisp (stiff OPP sheet)
  const boundary = k => { const i = k % nx, j = Math.floor(k / nx); return i === 0 || j === 0 || i === nx - 1 || j === ny - 1; };
  for (let k = 0; k < count; k++) if (boundary(k)) film[k] = edgeZ;
  const pressure = 0;

  // Folds as on the reference bags: a few long, straight creases with a sharp
  // ridge and flat film on either side, running from the toy's outermost
  // points toward the bag corners (plus one from the widest side), strongest at
  // the toy and fading out before the edge. Short pinches at the side seams.
  const fold = new Float32Array(count), folds = [];
  const addRidge = (start, end, amplitude, width, taper, record = true) => {
    const sx = end[0] - start[0], sy = end[1] - start[1], ll = sx * sx + sy * sy;
    for (let k = 0; k < count; k++) {
      const x = X(k), y = Y(k);
      const t = ((x - start[0]) * sx + (y - start[1]) * sy) / ll;
      if (t < -.05 || t > 1.05) continue;
      const tc = Math.min(1, Math.max(0, t)), d = Math.hypot(x - (start[0] + sx * tc), y - (start[1] + sy * tc));
      if (d < width) fold[k] += amplitude * taper(tc) * (1 - d / width) ** 1.6;   // sharp ridge, flat flanks
    }
    if (record) folds.push({ start, end, amplitude, width });
  };
  const box = toyGeometry.boundingBox, centroid = [0, bag.toyCenterY];
  const corners = [[-halfW, bodyTop], [halfW, bodyTop], [-halfW, bodyBottom], [halfW, bodyBottom]];
  const toyCellsXY = []; for (let k = 0; k < count; k += 2) if (toyTop[k] > 0) toyCellsXY.push([X(k), Y(k)]);
  const extreme = dir => toyCellsXY.reduce((best, p) => (p[0] * dir[0] + p[1] * dir[1] > best[0] * dir[0] + best[1] * dir[1] ? p : best), toyCellsXY[0]);
  const targets = [...corners.map(c => [c[0] * .92, c[1] + (c[1] > 0 ? -.12 : .12)])];
  targets.push(random() < .5 ? [-halfW * .95, bag.toyCenterY + (random() - .5) * .6] : [halfW * .95, bag.toyCenterY + (random() - .5) * .6]);
  for (const target of targets.slice(0, bag.folds)) {
    const dir = [target[0] - centroid[0], target[1] - centroid[1]], len = Math.hypot(...dir); dir[0] /= len; dir[1] /= len;
    const start = extreme(dir), jitter = (random() - .5) * .25;
    const end = [start[0] + (target[0] - start[0]) * (.82 + random() * .12) + jitter * dir[1], start[1] + (target[1] - start[1]) * (.82 + random() * .12) - jitter * dir[0]];
    addRidge(start, end, bag.foldAmplitude[0] + random() * (bag.foldAmplitude[1] - bag.foldAmplitude[0]), .14 + random() * .08, t => (1 - t) ** .8 * Math.min(1, t * 6));
  }
  // Standing flaps: the surplus film beside the toy's widest sides buckles up
  // into tall, sharp triangular flaps (as on the reference bags).
  for (let side = 0; side < bag.flaps.count; side++) {
    const s = side % 2 ? 1 : -1, tilt = (random() - .5) * .9 + (random() < .5 ? .35 : -.35);
    const dir = [s * Math.cos(tilt), Math.sin(tilt)], start = extreme(dir);
    const length = bag.flaps.length[0] + random() * (bag.flaps.length[1] - bag.flaps.length[0]);
    const end = [start[0] + dir[0] * length, start[1] + dir[1] * length];
    const height = bag.flaps.height[0] + random() * (bag.flaps.height[1] - bag.flaps.height[0]);
    addRidge([start[0] - dir[0] * .05, start[1] - dir[1] * .05], end, height, bag.flaps.width, t => Math.min(1, t * 4) * (1 - t) ** 1.2);
  }
  for (let c = 0; c < bag.pinches; c++) {
    const side = c % 2 ? 1 : -1, y = bodyBottom + .25 + random() * (bodyTop - bodyBottom - .5);
    const angle = (side > 0 ? Math.PI : 0) + (random() - .5) * .7, length = .14 + random() * .2;
    addRidge([side * halfW, y], [side * halfW + Math.cos(angle) * length, y + Math.sin(angle) * length], .008 + random() * .01, .03 + random() * .02, t => (1 - t) ** 1.5, false);
  }
  const ripple = Array.from({ length: 3 }, () => ({ a: random() * Math.PI, f: 5 + random() * 5, p: random() * 6.28 }));
  for (let k = 0; k < count; k++) {
    if (boundary(k)) { film[k] = edgeZ; continue; }
    const x = X(k), y = Y(k);
    const edge = Math.min(x + halfW, halfW - x, y - bodyBottom, bodyTop - y);
    const slack = toyTop[k] > 0 ? .45 : 1; // folds carry on over the crown as small lifted ridges
    let wave = 0; for (const r of ripple) wave += Math.sin((x * Math.cos(r.a) + y * Math.sin(r.a)) * r.f + r.p) * .0022;
    film[k] += (fold[k] + wave) * slack * smoothstep(0, .14, edge);
    film[k] = Math.max(film[k], toyTop[k] > 0 ? toyTop[k] + bag.contactGap : edgeZ * .5);
  }
  let contactCells = 0;
  for (let k = 0; k < count; k++) if (toyTop[k] > 0 && film[k] - toyTop[k] < .008) contactCells++;
  // Edge pull measured from the film: extra arc length per row/column.
  const excessRows = Array.from({ length: ny }, (_, j) => { let l = 0; for (let i = 1; i < nx; i++) l += Math.hypot(grid.dx, film[j * nx + i] - film[j * nx + i - 1]); return l - W; });
  const excessCols = Array.from({ length: nx }, (_, i) => { let l = 0; for (let j = 1; j < ny; j++) l += Math.hypot(grid.dy, film[j * nx + i] - film[(j - 1) * nx + i]); return l - (bodyTop - bodyBottom); });
  let toyMaxX = 0, toyMaxDY = 0; for (let k = 0; k < count; k++) if (toyTop[k] > 0) { toyMaxX = Math.max(toyMaxX, Math.abs(X(k))); toyMaxDY = Math.max(toyMaxDY, Math.abs(Y(k) - (sealTop + sealBottom) / 2)); }
  const sideStart = Math.min(halfW - .25, toyMaxX + .08), endStart = Math.min((sealTop - sealBottom) / 2 - .2, toyMaxDY + .08);
  const smooth = (values, radius) => values.map((_, i) => { let s = 0, w = 0; for (let k = -radius; k <= radius; k++) { const v = values[Math.min(values.length - 1, Math.max(0, i + k))], q = Math.exp(-(k * k) / (radius * radius / 2)); s += v * q; w += q; } return s / w; });
  // Kinks, not curves: where the toy uses up the most film (local peaks of the
  // excess length) the edge buckles inward in a V; elsewhere it stays straight.
  const toPull = (values, limit, span) => {
    const s = smooth(values, 4), min = Math.min(...s), max = Math.max(...s), out = new Array(s.length).fill(0);
    const peaks = s.map((v, i) => i > 0 && i < s.length - 1 && v >= s[i - 1] && v >= s[i + 1] && v - min > (max - min) * .6 ? i : -1).filter(i => i >= 0).sort((a, b) => s[b] - s[a]).slice(0, 2);
    const halfWidth = Math.round(s.length * bag.edge.kinkWidth / span);
    for (const p of peaks) {
      const depth = Math.min(limit, (s[p] - min) * bag.edge.pullScale), skew = .7 + random() * .6;
      for (let i = 0; i < s.length; i++) { const d = (i - p) / (halfWidth * (i < p ? skew : 2 - skew)); out[i] = Math.max(out[i], depth * Math.max(0, 1 - Math.abs(d)) ** 1.2); }
    }
    return smooth(out, 1).map(v => +v.toFixed(4));
  };
  const profile = { sideStart: +sideStart.toFixed(4), endStart: +endStart.toFixed(4), rows: toPull(excessRows, (halfW - sideStart) * .55, bodyTop - bodyBottom), cols: toPull(excessCols, ((sealTop - sealBottom) / 2 - endStart) * .45, W) };
  const warp = bagWarp(spec, style.seed, profile);
  for (let k = 0; k < count; k++) film[k] += warp.lift(X(k), Y(k));
  const filmAt = filmSampler(grid, film);

  // Back film lies flat on the (invisible) table under the toy.
  const backGrid = gridFor(spec, bag.backGrid), back = new Float32Array(backGrid.nx * backGrid.ny);
  for (let k = 0; k < back.length; k++) {
    const i = k % backGrid.nx, j = Math.floor(k / backGrid.nx);
    const x = backGrid.x0 + i * backGrid.dx, y = backGrid.y0 + j * backGrid.dy;
    back[k] = i === 0 || j === 0 || i === backGrid.nx - 1 || j === backGrid.ny - 1 ? 0 : -.003 - .003 * Math.sin(x * 3.1 + 1.3) * Math.sin(y * 2.3);
    back[k] += warp.lift(x, y);
  }

  // Soft contact shade the toy casts on the back film (it lies on it), as a
  // small single-channel texture over the bag body. Part of the object, not a floor.
  const shadeSize = [64, 56], shade = new Uint8Array(shadeSize[0] * shadeSize[1]);
  const silhouette = []; for (let k = 0; k < count; k += 3) if (toyTop[k] > 0) silhouette.push(X(k), Y(k));
  for (let j = 0; j < shadeSize[1]; j++) for (let i = 0; i < shadeSize[0]; i++) {
    const x = -halfW + i / (shadeSize[0] - 1) * W, y = bodyBottom + j / (shadeSize[1] - 1) * (bodyTop - bodyBottom);
    let d = Infinity; for (let s = 0; s < silhouette.length; s += 2) d = Math.min(d, Math.hypot(x - silhouette[s], y - silhouette[s + 1]));
    // light comes from the upper left, so the shade leans down-right
    const lean = Math.max(0, (x - centroid[0]) * .25 - (y - centroid[1]) * .35);
    shade[j * shadeSize[0] + i] = Math.round(255 * Math.min(1, .62 * Math.exp(-d / (.1 + .06 * lean))));
  }

  // Clearance helper: highest film point under a small disc (exact mesh heights).
  const filmMax = (x, y, r) => {
    // every film vertex inside the disc plus a ring of samples: the mesh is
    // piecewise linear, so its maximum over the disc is attained at one of these
    let z = -Infinity;
    const take = (px, py) => { const h = filmAt(px, py); if (h !== null) z = Math.max(z, h); };
    take(x, y); for (let a = 0; a < 12; a++) take(x + Math.cos(a * Math.PI / 6) * r, y + Math.sin(a * Math.PI / 6) * r);
    const i0 = Math.ceil((x - r - grid.x0) / grid.dx), i1 = Math.floor((x + r - grid.x0) / grid.dx), j0 = Math.ceil((y - r - grid.y0) / grid.dy), j1 = Math.floor((y + r - grid.y0) / grid.dy);
    for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++)
      if (Math.hypot(grid.x0 + i * grid.dx - x, grid.y0 + j * grid.dy - y) <= r) z = Math.max(z, film[j * nx + i]);
    return z;
  };
  const onBody = (x, y) => Math.abs(x) <= halfW && y >= bodyBottom && y <= bodyTop;
  const onSeal = (x, y) => Math.abs(x) <= halfW && ((y > bodyTop && y <= sealTop) || (y < bodyBottom && y >= sealBottom));
  const surfaceAt = (x, y) => onBody(x, y) ? (filmAt(x, y) ?? edgeZ) : onSeal(x, y) ? edgeZ + .0035 + warp.lift(x, y) : -Infinity;
  // Highest surface under a disc that may straddle film, seal and open air.
  const surfaceUnder = (x, y, r) => {
    let z = surfaceAt(x, y);
    for (let a = 0; a < 12; a++) z = Math.max(z, surfaceAt(x + Math.cos(a * Math.PI / 6) * r, y + Math.sin(a * Math.PI / 6) * r));
    return r > 0 ? Math.max(z, filmMax(x, y, r)) : z;
  };

  // ---------- PVC tag + ball chain (physically threaded) ----------
  // The tag hangs from a ball-chain loop threaded through the bag's hang hole
  // and the tag's hole. At each hole the chain goes front → through the hole →
  // behind the plate → round the nearest edge → front again. The bead behind the
  // tag props up its hole end, so the tag tilts onto it instead of floating.
  const chain = spec.chain, r = chain.beadRadius;
  const tagSpec = spec.tag, tagKind = style.tag?.shape || 'rounded', tagGeo = tagLayout(spec, tagKind);
  const tagHalfT = tagSpec.thickness / 2 + tagGeo.bevel;
  const holeLift = warp.lift(holeX, holeY);
  const hole = new THREE.Vector3(holeX, holeY, edgeZ / 2 + holeLift);
  const sealFront = (x, y) => edgeZ + .0035 + warp.lift(x, y), sealBack = (x, y) => -.0035 + warp.lift(x, y);

  // Tag frame: hole anchored at an offset from the bag hole, tilted in-plane.
  const anchor = new THREE.Vector2(hole.x + tagSpec.anchor[0], hole.y + tagSpec.anchor[1]);
  const yaw = THREE.MathUtils.degToRad(tagSpec.tilt + (style.tag?.turn || 0));
  const polygon = tagGeo.outline;
  const footprint = []; for (let i = 0; i <= 28; i++) for (let j = 0; j <= 14; j++) { const p = [(i / 28 - .5) * tagSpec.width, (j / 14 - .5) * tagSpec.height]; if (pointInPolygon(p, polygon)) footprint.push(p); }
  for (const p of polygon) footprint.push(p);
  // Under-bead: behind the tag, between hole and top edge, resting on the film.
  const tagObject = new THREE.Object3D();
  const poseTag = (pitch, z) => {
    tagObject.rotation.set(0, 0, 0); tagObject.position.set(0, 0, 0);
    tagObject.quaternion.setFromEuler(new THREE.Euler(pitch, 0, yaw, 'ZXY'));
    tagObject.updateMatrixWorld(true);
    const h = new THREE.Vector3(tagGeo.hole[0], tagGeo.hole[1], 0).applyMatrix4(tagObject.matrixWorld);
    tagObject.position.set(anchor.x - h.x, anchor.y - h.y, z); tagObject.updateMatrixWorld(true);
  };
  const worldOf = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(tagObject.matrixWorld);
  let best = null;
  for (let pitch = 0; pitch <= .2; pitch += .005) {           // tilt about the tag's x axis (hole end up)
    poseTag(-pitch, 0);
    // the chain behind the tag (from the hole to the top edge) props it up
    const supports = [.2, .45, .7, .95].map(f => [tagGeo.hole[0] + tagGeo.edge[0] * tagGeo.rim * f, tagGeo.hole[1] + tagGeo.edge[1] * tagGeo.rim * f + .004 * f]);
    let lift = -Infinity, gaps = [];
    for (const [lx, ly] of footprint) { const w = worldOf(lx, ly, -tagHalfT); const s = Math.max(0, surfaceUnder(w.x, w.y, .006)); lift = Math.max(lift, s - w.z); gaps.push([w, s]); }
    for (const [sx, sy] of supports) { const u = worldOf(sx, sy, -tagHalfT), w = worldOf(sx, sy, 0); lift = Math.max(lift, Math.max(0, surfaceUnder(w.x, w.y, r * 1.2)) + 2 * r + .006 - u.z); }
    const mean = gaps.reduce((sum, [w, s]) => sum + (w.z + lift - s), 0) / gaps.length;
    if (!best || mean < best.mean) best = { pitch, lift: lift + .0012, mean };
  }
  poseTag(-best.pitch, best.lift);
  const tagPose = { position: tagObject.position.toArray(), quaternion: tagObject.quaternion.toArray(), shape: tagKind };
  const tagHole = worldOf(tagGeo.hole[0], tagGeo.hole[1], 0);
  const tagNormal = new THREE.Vector3(0, 0, 1).transformDirection(tagObject.matrixWorld), tagUp = new THREE.Vector3(tagGeo.edge[0], tagGeo.edge[1], 0).transformDirection(tagObject.matrixWorld);
  const tagTopAt = (x, y) => {
    const local = tagObject.worldToLocal(new THREE.Vector3(x, y, tagObject.position.z));
    if (!pointInPolygon([local.x, local.y], polygon) && distanceToPolygon([local.x, local.y], polygon) > tagGeo.bevel + .004) return -Infinity;
    return worldOf(local.x, local.y, tagHalfT).z;
  };

  const holeR = bag.hole.radius;
  const blocked = (p, rad) => {
    const lift = warp.lift(p.x, p.y), front = edgeZ + .0035 + lift, backZ = -.0035 + lift;
    if (Math.abs(p.x) <= halfW + rad && p.y >= bodyTop - rad && p.y <= sealTop + rad && p.z >= backZ - rad && p.z <= front + rad && Math.hypot(p.x - hole.x, p.y - hole.y) > holeR - rad) { blocked.what = 'seal'; return Math.min(front + rad - p.z, p.z - (backZ - rad)); }
    const l = tagObject.worldToLocal(p.clone());
    if (Math.hypot(l.x - tagGeo.hole[0], l.y - tagGeo.hole[1]) > tagGeo.holeRadius - rad) {
      // tag = extruded outline (half thickness tagSpec.thickness/2) with a rounded bevel of radius `bevel`
      const core = tagSpec.thickness / 2, inside = pointInPolygon([l.x, l.y], polygon), out = inside ? 0 : distanceToPolygon([l.x, l.y], polygon);
      const depth = inside ? tagHalfT + rad - Math.abs(l.z) : rad + tagGeo.bevel - Math.hypot(out, Math.max(0, Math.abs(l.z) - core));
      if (depth > 0 && (inside || out < rad + tagGeo.bevel)) { blocked.what = `tag l=${l.toArray().map(v => v.toFixed(3))}`; return depth; }
    }
    if (onBody(p.x, p.y)) { const f = filmAt(p.x, p.y); if (f !== null && Math.abs(p.z - f) < rad) { blocked.what = `film ${f.toFixed(3)}`; return rad - Math.abs(p.z - f); } }
    return -Infinity;
  };
  // Control path of the loop (closed, in order). Each threading section goes:
  // front → straight down through the hole → behind the plate → round the
  // nearest edge on an arc that clears its bevel → back on the front.
  const W3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const edgeArc = (frame, edge, half, clear) => {   // half-circle round a plate edge, back → front
    const R = r + clear; return [-90, -45, 0, 45, 90].map(a => { const q = a * Math.PI / 180; return frame(edge - .012 + (.012 + R) * Math.cos(q), Math.sin(q) * (half + R) + (q === 0 ? 0 : 0)); });
  };
  const bagFrame = (y, side) => { const x = hole.x + .008; return W3(x, y, side >= 0 ? sealFront(x, y) + side * 0 + (side > 0 ? 0 : 0) : 0); };
  const sealThread = [
    { p: W3(hole.x - .015, hole.y - .06, sealFront(hole.x - .015, hole.y - .06) + r + .0015) },
    { p: W3(hole.x, hole.y, sealFront(hole.x, hole.y) + r + .003), wrap: true },
    { p: W3(hole.x, hole.y, hole.z), wrap: true },
    { p: W3(hole.x, hole.y, sealBack(hole.x, hole.y) - r - .003), wrap: true },
    ...[-90, -45, 0, 45, 90].map(a => { const q = a * Math.PI / 180, R = r + .008, y = sealTop - .012 + (.012 + R) * Math.cos(q), x = hole.x + .006 + .02 * (a + 90) / 180, mid = (sealFront(x, sealTop) + sealBack(x, sealTop)) / 2, half = (sealFront(x, sealTop) - sealBack(x, sealTop)) / 2; return { p: W3(x, y, mid + Math.sin(q) * (half + R)), wrap: true }; }),
    { p: W3(hole.x + .06, sealTop - .04, sealFront(hole.x + .06, sealTop - .04) + r + .0015) },
  ];
  const t = (along, out, normal) => tagHole.clone().addScaledVector(tagUp, along).addScaledVector(new THREE.Vector3().crossVectors(tagUp, tagNormal), out).addScaledVector(tagNormal, normal);
  const tagRim = tagGeo.rim;
  const tagThread = [
    { p: t(-.045, -.02, tagHalfT + r + .0015) },
    { p: t(0, 0, tagHalfT + r + .003), wrap: true },
    { p: tagHole.clone(), wrap: true },
    { p: t(0, 0, -tagHalfT - r - .003), wrap: true },
    ...[-90, -45, 0, 45, 90].map(a => { const q = a * Math.PI / 180, R = r + tagGeo.bevel + .008; return { p: t(tagRim - .012 + (.012 + R) * Math.cos(q), .02 * (a + 90) / 180, Math.sin(q) * (tagHalfT + R)), wrap: true }; }),
    { p: t(tagRim * .3, .08, tagHalfT + r + .0015) },
  ];
  const strand = (from, to, bend, n = 4) => { const out = []; const side = new THREE.Vector3(-(to.y - from.y), to.x - from.x, 0).normalize(); for (let i = 1; i < n; i++) { const f = i / n; out.push({ p: from.clone().lerp(to, f).addScaledVector(side, Math.sin(Math.PI * f) * bend) }); } return out; };
  const path = [...sealThread, ...strand(sealThread.at(-1).p, tagThread[0].p, .06), ...tagThread, ...strand(tagThread.at(-1).p, sealThread[0].p, -.05)];
  const controls = path.map(c => c.p);
  const loop = new THREE.CatmullRomCurve3(controls, true, 'centripetal');
  const lengths = loop.getLengths(2000), total = lengths[lengths.length - 1];
  const nearestParam = c => { let best = 0, bestD = Infinity; for (let i = 0; i < 2000; i++) { const d = loop.getPoint(i / 2000).distanceTo(c); if (d < bestD) { bestD = d; best = i / 2000; } } return best; };
  const arcAt = u => lengths[Math.round(u * 2000)];
  // Beads at one fixed pitch along the whole loop (a real ball chain cannot
  // bunch). The threading path decides where the chain goes through holes and
  // round edges; only beads on the two long strands rest on the surfaces.
  const lastWrap = start => { let i = start; while (path[i + 1]?.wrap) i++; return i; };
  const sealEnd = lastWrap(1), tagFirst = sealThread.length + 3 + 1, tagEnd = lastWrap(tagFirst);
  const strandArc = [sealEnd, tagEnd].map(i => arcAt(nearestParam(controls[i])));
  const strandEnd = [tagFirst, 1].map(i => arcAt(nearestParam(controls[i])));
  const onStrand = s => [0, 1].some(k => { const a = strandArc[k] + chain.pitch * .5, b = strandEnd[k] - chain.pitch * .5; return a <= b ? s >= a && s <= b : s >= a || s <= b; });
  const beadCount = Math.round(total / chain.pitch), positions = [], roles = [];
  for (let k = 0; k < beadCount; k++) {
    const s = k / beadCount * total, p = loop.getPointAt(k / beadCount);
    if (!onStrand(s)) { positions.push(p); roles.push(1); continue; }
    let under = Math.max(surfaceUnder(p.x, p.y, r), 0);
    for (const [ox, oy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) under = Math.max(under, tagTopAt(p.x + ox, p.y + oy));
    p.z = under + r + .0015; positions.push(p); roles.push(0);
  }
  // Relax resting beads: lift any bead (or both ends of any link) that touches
  // the seal, the tag or the film until nothing intersects.
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let b = 0; b < positions.length; b++) {
      const p = positions[b], q = positions[(b + 1) % positions.length];
      if (roles[b] === 0) { const d = blocked(p, chain.claspRadius); if (d > -1e-4) { p.z += d + .0015; moved = true; } }
      for (const f of [.25, .5, .75]) { const d = blocked(p.clone().lerp(q, f), chain.linkRadius); if (d > -1e-4) { if (roles[b] === 0) p.z += d + .0015; if (roles[(b + 1) % positions.length] === 0) q.z += d + .0015; if (roles[b] === 0 || roles[(b + 1) % positions.length] === 0) moved = true; } }
    }
    if (!moved) break;
  }
  const beads = positions.length, chainPoints = new Float32Array(beads * 3);
  positions.forEach((p, b) => chainPoints.set([p.x, p.y, p.z], b * 3));
  // Ball-chain connector replaces two beads in the middle of the longest resting run.
  let clasp = 0, run = 0, bestRun = 0;
  for (let b = 0; b < beads * 2; b++) { if (roles[b % beads] === 0) { run++; if (run > bestRun) { bestRun = run; clasp = (b - Math.floor(run / 2)) % beads; } } else run = 0; }
  { const p = positions[clasp], q = positions[(clasp + 1) % beads]; const lift = chain.claspRadius - r; p.z += lift; q.z += lift; chainPoints.set([p.x, p.y, p.z], clasp * 3); chainPoints.set([q.x, q.y, q.z], ((clasp + 1) % beads) * 3); }


  // Stickers: small, on slack film, away from toy, seals, edges and tag.
  const stickers = [], placed = [], stickerSegments = 16;
  const nearTag = (x, y) => { const local = tagObject.worldToLocal(new THREE.Vector3(x, y, tagObject.position.z)); return Math.abs(local.x) < tagSpec.width / 2 + .2 && Math.abs(local.y) < tagSpec.height / 2 + .2; };
  const nearToy = (x, y) => [[0, 0], [.14, 0], [-.14, 0], [0, .14], [0, -.14]].some(([ox, oy]) => { const i = Math.round((x + ox - grid.x0) / grid.dx), j = Math.round((y + oy - grid.y0) / grid.dy); return toyTop[j * nx + i] > 0; });
  for (const [s, kind] of style.stickers.slice(0, spec.stickers.max).entries()) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = (random() - .5) * (W - .5), y = bodyBottom + .28 + random() * (bodyTop - bodyBottom - .7);
      if (nearToy(x, y) || nearTag(x, y) || placed.some(p => Math.hypot(p[0] - x, p[1] - y) < .75)) continue;
      const edge = spec.stickers.size[0] + random() * (spec.stickers.size[1] - spec.stickers.size[0]);
      // stickers go on flat film only (never across a fold)
      // (a sloped but flat facet is fine; bending across a crease is not)
      const at = (a, c) => filmAt(x + (a - .5) * edge, y + (c - .5) * edge) ?? edgeZ;
      const c00 = at(0, 0), c10 = at(1, 0), c01 = at(0, 1), c11 = at(1, 1); let bend = 0;
      for (let a = 0; a <= 6; a++) for (let c = 0; c <= 6; c++) { const u = a / 6, v = c / 6; bend = Math.max(bend, Math.abs(at(u, v) - ((c00 * (1 - u) + c10 * u) * (1 - v) + (c01 * (1 - u) + c11 * u) * v))); }
      if (bend > .006) continue;
      const angle = (random() - .5) * .9, plane = new THREE.PlaneGeometry(edge, edge, stickerSegments, stickerSegments); plane.rotateZ(angle); plane.translate(x, y, 0);
      const p = plane.attributes.position, cell = edge / stickerSegments;
      for (let v = 0; v < p.count; v++) p.setZ(v, (filmAt(p.getX(v), p.getY(v)) ?? edgeZ) + .0016);
      plane.computeVertexNormals();
      stickers.push({ kind, variant: s % 2, geometry: plane, center: [x, y], angle, size: edge }); placed.push([x, y]);
      break;
    }
  }

  // Zipper: two clear ridges under the top seal, resting on the film.
  const zipperRadius = .011;
  const zipper = [0, .034].map(offset => {
    const y = bodyTop - bag.zipperDrop - offset, samples = 96, heights = [];
    for (let s = 0; s <= samples; s++) heights.push(Math.max(edgeZ, filmMax(-halfW + .015 + s / samples * (W - .03), y, zipperRadius)) + zipperRadius + .001);
    return { y, heights };
  });

  // Clearance audit on the shipped geometry. Any penetration fails the build.
  const audit = { toyFilm: -Infinity, toyBack: -Infinity, sticker: -Infinity, stickerFloat: -Infinity, chain: -Infinity, zipper: -Infinity };
  const tp = toyGeometry.attributes.position;
  for (let v = 0; v < tp.count; v++) {
    const x = tp.getX(v), y = tp.getY(v), z = tp.getZ(v), h = filmAt(x, y);
    if (h !== null) audit.toyFilm = Math.max(audit.toyFilm, z - h);
    audit.toyBack = Math.max(audit.toyBack, -z);
  }
  for (const { geometry } of stickers) {
    // sample the sticker surface densely (bilinear inside each quad) against the film mesh
    const p = geometry.attributes.position;
    const n = stickerSegments + 1;
    for (let qy = 0; qy < stickerSegments; qy++) for (let qx = 0; qx < stickerSegments; qx++) for (const [u, w] of [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]]) {
      const a = qy * n + qx, b = a + 1, c = a + n, d = a + n + 1;
      const lerp = get => (get(a) * (1 - u) + get(b) * u) * (1 - w) + (get(c) * (1 - u) + get(d) * u) * w;
      const x = lerp(i => p.getX(i)), y = lerp(i => p.getY(i)), z = lerp(i => p.getZ(i)), h = filmAt(x, y);
      if (h !== null) { audit.sticker = Math.max(audit.sticker, h - z); audit.stickerFloat = Math.max(audit.stickerFloat, z - h - .006); }
    }
  }
  const beadAt = b => new THREE.Vector3(chainPoints[b * 3], chainPoints[b * 3 + 1], chainPoints[b * 3 + 2]);
  for (let b = 0; b < beads; b++) {
    const p = beadAt(b), radius = b === clasp || b === (clasp + 1) % beads ? chain.claspRadius : r;
    const report = (what, depth, at) => { if (depth > 0 && process.env.DEBUG_AUDIT) console.log(what, blocked.what, b, roles[b], (b + 1) % beads, roles[(b + 1) % beads], depth.toFixed(4), at.toArray().map(v => v.toFixed(3))); return depth; };
    audit.chain = Math.max(audit.chain, report('bead', blocked(p, radius), p));
    const q = beadAt((b + 1) % beads);
    for (const f of [.25, .5, .75]) { const m = p.clone().lerp(q, f); audit.chain = Math.max(audit.chain, report('link', blocked(m, chain.linkRadius), m)); }
  }
  for (const { y, heights } of zipper) heights.forEach((h, s) => {
    const x = -halfW + .015 + s / (heights.length - 1) * (W - .03);
    for (const oy of [-zipperRadius, 0, zipperRadius]) { const f = filmAt(x, y + oy); if (f !== null) audit.zipper = Math.max(audit.zipper, f - (h - zipperRadius)); }
  });
  if (!globalThis.process?.env?.HALL_AUDIT_WARN) for (const [key, depth] of Object.entries(audit)) if (depth > 0) throw new Error(`${id}: clearance check ${key} failed by ${depth.toFixed(5)}`);

  return {
    film: { grid: [nx, ny], heights: film }, back: { grid: [backGrid.nx, backGrid.ny], heights: back },
    chainPoints, clasp, stickers, tagPose, zipper, warp: profile, folds: folds.map(f => ({ start: f.start.map(v => +v.toFixed(4)), end: f.end.map(v => +v.toFixed(4)), amplitude: +f.amplitude.toFixed(4), width: +f.width.toFixed(4) })), shade: { size: shadeSize, data: shade },
    audit: Object.fromEntries(Object.entries(audit).map(([k, v]) => [k, +v.toFixed(5)])), stats: { pressure: +pressure.toFixed(3), contactShare: +(contactCells / Math.max(1, toyCells)).toFixed(3), stickers: stickers.length, chainBeads: beads },
  };
}
